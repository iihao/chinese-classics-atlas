#!/usr/bin/env python3
"""导出静态站点到 dist/，供 GitHub Pages / 任意静态托管使用。

    python3 tools/build_static.py

结构：
    dist/index.html
    dist/css/atlas.css  dist/css/style.css  dist/js/app.js
    dist/works/catalog.json  dist/works/honglou/index.html
    dist/api/works/<id>.json       按作品加载的数据
    dist/404.html
"""
import json
import os
import shutil
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import sanguo_data  # noqa: E402

DB = os.path.join(ROOT, "db", "honglou.db")
OUT = os.path.join(ROOT, "dist")


def rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


def build():
    if not os.path.exists(DB):
        sys.exit("数据库不存在，请先运行 python3 db/init_db.py")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    tags = {}
    for r in conn.execute("SELECT item_id, name FROM item_tags JOIN tags ON tags.id=item_tags.tag_id"):
        tags.setdefault(r["item_id"], []).append(r["name"])

    items = []
    for r in conn.execute("SELECT * FROM v_items ORDER BY sort"):
        items.append({
            "id": r["id"], "cat": r["cat"], "type": r["type"], "name": r["name"],
            "alias": r["alias"], "family": r["family"], "familyName": r["family_name"],
            "role": r["role"], "seq": r["seq"], "summary": r["summary"],
            "detail": r["detail"], "quote": r["quote"],
            "ending": r["ending"], "comment": r["comment"], "zhipi": r["zhipi"],
            "refs": json.loads(r["refs"]) if r["refs"] and r["refs"].startswith("[") else ([r["refs"]] if r["refs"] else []),
            "tags": tags.get(r["id"], []),
        })

    rels = [{"a": r["a"], "b": r["b"], "label": r["label"]}
            for r in conn.execute("SELECT a,b,label FROM relations")]

    gen = [{"id": r["item_id"], "family": r["family"], "parent": r["parent_id"],
            "spouse": r["spouse_id"], "gen": r["gen"], "label": r["label"],
            "rk": r["rk"] or "", "title": r["title"] or "", "inher": bool(r["inher"]),
            "house": r["house"] or "", "ord": r["ord"] or 0}
           for r in conn.execute("SELECT * FROM genealogy")]

    notes = {r["family"]: r["note"] for r in conn.execute("SELECT * FROM family_notes")}

    panels = []
    for r in conn.execute("SELECT title,note,kind,payload FROM panels ORDER BY sort"):
        p = {"title": r["title"], "desc": r["note"], "kind": r["kind"]}
        p.update(json.loads(r["payload"] or "{}"))
        panels.append(p)

    lore = {}
    for r in conn.execute("SELECT kind, payload FROM lore ORDER BY sort"):
        lore.setdefault(r["kind"], []).append(json.loads(r["payload"]))

    meta = {r["key"]: r["value"] for r in conn.execute("SELECT key,value FROM meta")}

    data = {
        "title": "红楼梦图谱",
        "families": rows(conn, "SELECT id,name,color,note FROM families ORDER BY sort"),
        "roles": [r["name"] for r in conn.execute("SELECT name FROM roles ORDER BY sort")],
        "items": items, "relations": rels, "genealogy": gen,
        "genealogyNotes": notes, "panels": panels,
        "wordplay": lore.get("wordplay", []),
        "foreshadow": lore.get("foreshadow", []),
        "map": {
            "meta": json.loads(meta.get("lore:map") or "{}"),
            "panels": lore.get("panel", []),
            "rooms": lore.get("room", []),
        },
    }
    conn.close()

    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "api", "works"))

    for f in ("index.html",):
        shutil.copy2(os.path.join(ROOT, f), os.path.join(OUT, f))
    for d in ("css", "js", "en"):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d))
    # 作品清单以 catalog 为准：新增作品只改 catalog 与校验器，不动构建器。
    catalog = json.loads(open(os.path.join(ROOT, "works", "catalog.json"), encoding="utf-8").read())
    os.makedirs(os.path.join(OUT, "works"), exist_ok=True)
    shutil.copy2(os.path.join(ROOT, "works", "catalog.json"),
                 os.path.join(OUT, "works", "catalog.json"))
    def _skip_source(_dir, names):
        # 源数据只走 /api/works/*.json，不在作品目录里重复发布。
        drop = {"data.json", "encyclopedia.json", "wikidata.json"}
        return [n for n in names if n in drop]

    for w in catalog["works"]:
        wid = w["id"]
        shutil.copytree(os.path.join(ROOT, "works", wid),
                        os.path.join(OUT, "works", wid),
                        dirs_exist_ok=True, ignore=_skip_source)
        # 作品数据包：红楼由上面的 SQLite 结果写出；三国有百科档案层，需合并；
        # 其余作品直接复制各自的源 data.json。
        pkg = os.path.join(OUT, "api", "works", wid + ".json")
        src = os.path.join(ROOT, "works", wid, "data.json")
        if wid == "sanguo":
            with open(pkg, "w", encoding="utf-8") as f:
                json.dump(sanguo_data.load(ROOT), f, ensure_ascii=False, separators=(",", ":"))
        elif wid != "honglou":
            if not os.path.exists(src):
                sys.exit(f"作品 {wid} 缺少源数据 {src}；先运行对应的 tools/build_{wid}.py")
            shutil.copy2(src, pkg)
    # 英文页引用的演示图、社交预览图与各作品的 og:image（不打包内部发布素材）。
    os.makedirs(os.path.join(OUT, "docs"))
    for f in ("demo.gif", "screenshot-graph.png", "social-preview.png",
              "screenshot-sanguo.png", "screenshot-xiyou-graph.png"):
        shutil.copy2(os.path.join(ROOT, "docs", f), os.path.join(OUT, "docs", f))

    with open(os.path.join(OUT, "api", "works", "honglou.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    # GitHub Pages 的 404 回退到首页（hash 路由不依赖服务端）
    notfound = os.path.join(OUT, "404.html")
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(notfound, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"✓ 静态站点已生成：{OUT}")
    print(f"  红楼 {len(items)} 条目 · {len(rels)} 关系 · {len(gen)} 谱系 · "
          f"数据 {round(os.path.getsize(os.path.join(OUT, 'api', 'works', 'honglou.json')) / 1024)} KB")
    # 其余作品按 catalog 顺序报告自己的 counts（各作品字段略有差别，不做硬编码）。
    for w in catalog["works"]:
        if w["id"] == "honglou":
            continue
        pkg = json.load(open(os.path.join(OUT, "api", "works", w["id"] + ".json"), encoding="utf-8"))
        c = pkg.get("counts") or {
            "characters": len(pkg.get("characters", [])),
            "relations": len(pkg.get("relations", [])),
            "events": len(pkg.get("events", [])),
            "places": len(pkg.get("places", [])),
        }
        extra = ""
        if c.get("ranked"):
            extra += f" · 座次 {c['ranked']}"
        if c.get("trials"):
            extra += f" · 难簿 {c['trials']}"
        if c.get("wordplay"):
            extra += f" · 隐语 {c['wordplay']}"
        print(f"  {w['name']} {c.get('characters', 0)} 人物 · {c.get('relations', 0)} 关系 · "
              f"{c.get('events', 0)} 事件 · {c.get('places', 0)} 地点{extra}")


if __name__ == "__main__":
    build()
