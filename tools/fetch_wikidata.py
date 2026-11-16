#!/usr/bin/env python3
"""从 Wikidata 取结构化事实，补充作品词条。

    python3 tools/fetch_wikidata.py --work shuihu
    python3 tools/fetch_wikidata.py --work shuihu --offline      # 只用本地缓存
    python3 tools/fetch_wikidata.py --work shuihu --limit 5      # 试跑

为什么用 Wikidata 而不是维基百科正文：
  * Wikidata 的事实声明是 CC0，可自由复用；维基百科条目正文是 CC BY-SA，
    整段搬用会带来署名与继承许可的义务，本项目不复制百科正文。
  * 只取可结构化的事实（生卒、职业、职位、见于何作品）与条目链接，
    文字解释仍由项目自撰，并在词条里区分「小说叙事」与「外部参考」。

输出 works/<id>/wikidata.json（只含事实与外链），由构建器合并；
原始响应缓存在 tools/cache/wikidata/，该目录不入库，便于断点续跑。
网络不可达时不写任何东西，也不会伪造数据。
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache", "wikidata")
UA = "ChineseClassicsAtlas/1.0 (educational atlas; https://github.com/iihao/chinese-classics-atlas)"
API = "https://www.wikidata.org/w/api.php"

# 需要抓取的作品：源数据里哪些字段是人物名。
WORKS = {
    "shuihu": {"source": "works/shuihu/data.json", "section": "characters", "key": "name"},
    "sanguo": {"source": "works/sanguo/data.json", "section": "characters", "key": "name"},
    "xiyou": {"source": "works/xiyou/data.json", "section": "characters", "key": "name"},
}

FACT_PROPS = [
    ("P569", "生年"),
    ("P570", "卒年"),
    ("P106", "职业"),
    ("P39", "职位"),
    ("P1441", "见于作品"),
    ("P1344", "参与事件"),
]
MAX_LABELS = 4


def _get(params, retries=3, timeout=20):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Wikidata 请求失败：{last}")


def search_qid(name):
    """按中文标签检索实体；只接受标签完全一致的候选，避免张冠李戴。"""
    data = _get({"action": "wbsearchentities", "search": name, "language": "zh",
                 "uselang": "zh", "format": "json", "limit": 5, "type": "item"})
    hits = data.get("search") or []
    exact = [h for h in hits if h.get("label") == name or h.get("match", {}).get("text") == name]
    pick = (exact or hits or [None])[0]
    if not pick:
        return None
    return {"qid": pick["id"], "label": pick.get("label"), "description": pick.get("description")}


def fetch_entity(qid):
    data = _get({"action": "wbgetentities", "ids": qid, "format": "json",
                 "props": "claims|labels|descriptions|sitelinks",
                 "languages": "zh|en", "sitefilter": "zhwiki|enwiki"})
    return data["entities"][qid]


def _claim_values(entity, prop):
    out = []
    for claim in (entity.get("claims", {}).get(prop) or []):
        val = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
        if val is None:
            continue
        if isinstance(val, dict) and "time" in val:
            out.append(val["time"])
        elif isinstance(val, dict) and "id" in val:
            out.append(val["id"])
    return out


def _resolve_ids(ids):
    ids = [i for i in dict.fromkeys(ids) if i.startswith("Q")]
    if not ids:
        return {}
    data = _get({"action": "wbgetentities", "ids": "|".join(ids[:50]), "format": "json",
                 "props": "labels", "languages": "zh|en"})
    out = {}
    for qid, ent in (data.get("entities") or {}).items():
        labels = ent.get("labels") or {}
        out[qid] = (labels.get("zh") or labels.get("en") or {}).get("value")
    return out


def _year(iso):
    # +0161-00-00T00:00:00Z -> 161年；公元前用「前」
    s = iso.lstrip("+")
    bc = s.startswith("-")
    s = s.lstrip("-")
    year = s.split("-")[0].lstrip("0") or "0"
    return ("前" if bc else "") + year


def entity_facts(entity):
    facts = []
    dates = {}
    for prop, label in FACT_PROPS:
        vals = _claim_values(entity, prop)
        if not vals:
            continue
        if prop in ("P569", "P570"):
            years = sorted({_year(v) for v in vals})
            dates[label] = years[0]
            continue
        names = _resolve_ids(vals)
        picked = [names.get(v) for v in vals if names.get(v)]
        picked = list(dict.fromkeys(picked))[:MAX_LABELS]
        if picked:
            facts.append({"label": label, "value": "、".join(picked), "property": prop})
    if dates:
        if "生年" in dates and "卒年" in dates:
            facts.insert(0, {"label": "生卒", "value": f'{dates["生年"]}—{dates["卒年"]}', "property": "P569/P570"})
        elif "卒年" in dates:
            facts.insert(0, {"label": "卒年", "value": dates["卒年"], "property": "P570"})
        else:
            facts.insert(0, {"label": "生年", "value": dates["生年"], "property": "P569"})
    return facts


def sitelinks(entity):
    links = entity.get("sitelinks") or {}
    out = []
    for site, label in (("zhwiki", "维基百科"), ("enwiki", "Wikipedia (EN)")):
        title = (links.get(site) or {}).get("title")
        if not title:
            continue
        lang = site[:-4]
        out.append({"label": label,
                    "url": f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))})
    return out


def load_names(work):
    meta = WORKS[work]
    path = os.path.join(ROOT, meta["source"])
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [(c["id"], c[meta["key"]]) for c in data[meta["section"]]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, choices=sorted(WORKS))
    ap.add_argument("--offline", action="store_true", help="只用 tools/cache 里的响应")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.4, help="请求间隔秒数，默认 0.4")
    a = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    names = load_names(a.work)
    if a.limit:
        names = names[:a.limit]

    result = {"version": 1, "workId": a.work,
              "license": "Wikidata facts: CC0 1.0; links point to Wikipedia (CC BY-SA)",
              "source": "https://www.wikidata.org/",
              "entries": {}}
    missing, cached = [], 0
    for idx, (cid, name) in enumerate(names, 1):
        cache_file = os.path.join(CACHE, f'{a.work}-{cid}.json')
        if os.path.exists(cache_file):
            with open(cache_file, encoding="utf-8") as f:
                record = json.load(f)
            cached += 1
        else:
            if a.offline:
                missing.append(name)
                continue
            try:
                hit = search_qid(name)
                if not hit:
                    missing.append(name)
                    continue
                entity = fetch_entity(hit["qid"])
                record = {"qid": hit["qid"], "search": hit, "entity": entity}
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(record, f, ensure_ascii=False, indent=1)
                time.sleep(a.sleep)
            except RuntimeError as exc:
                print(f"! {name}: {exc}", file=sys.stderr)
                missing.append(name)
                continue
        entity = record["entity"]
        facts = entity_facts(entity)
        links = sitelinks(entity)
        if not facts and not links:
            missing.append(name)
            continue
        result["entries"][cid] = {"qid": record["qid"], "name": name,
                                  "facts": facts, "refs": links}
        if idx % 10 == 0:
            print(f"  … {idx}/{len(names)}")

    out = os.path.join(ROOT, "works", a.work, "wikidata.json")
    if not result["entries"]:
        print(f"没有可写入的条目（缓存命中 {cached}，缺失 {len(missing)}）。未写入 {out}。")
        if missing:
            print("缺失示例：" + "、".join(missing[:8]))
        return 0
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"✓ {out}")
    print(f"  条目 {len(result['entries'])} · 缓存命中 {cached} · 缺失 {len(missing)}")
    if missing:
        print("  缺失示例：" + "、".join(missing[:8]))
    return 0


if __name__ == "__main__":
    sys.exit(main())