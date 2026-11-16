#!/usr/bin/env python3
"""由 tools/xiyou_data.py 生成 works/xiyou/data.json。

    python3 tools/build_xiyou.py

与红楼同一条思路：数据源写在 Python 里（便于注释、断言、排序），
产物是单文件 JSON，前端一次加载。改完重跑本脚本，再跑 validate_works.py。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xiyou_data as X

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "works", "xiyou", "data.json")

GROUP_ORDER = {"master": 0, "kin": 1, "serve": 2, "ally": 3, "friend": 4, "rival": 5}
KIND_ORDER = {"拆字·会意": 0, "拆字": 0, "内丹代号": 1, "名号反语·游戏": 2,
              "名号寓意": 3, "地名寓意": 4, "佛典用事": 5, "谐音·附会": 6}
VERDICT_ORDER = {"通行": 0, "一说": 1, "存疑": 2}


def check():
    ids = [c["id"] for c in X.C]
    assert len(ids) == len(set(ids)), "人物 id 重复"
    byid = {c["id"]: c for c in X.C}
    groups = {g["id"] for g in X.GROUPS}
    pids = [p["id"] for p in X.P]
    assert len(pids) == len(set(pids)), "地点 id 重复"

    for c in X.C:
        assert c["group"] in groups, c["id"]
        assert c["name"] and c["summary"] and c["role"], c["id"]
        assert isinstance(c["chapters"], list) and c["chapters"], c["id"]
        assert all(isinstance(n, int) and 1 <= n <= 100 for n in c["chapters"]), c["id"]

    for r in X.R:
        assert r["a"] in byid and r["b"] in byid, r
        assert r["a"] != r["b"] and r["label"] and r["group"] in GROUP_ORDER, r
        assert 1 <= r["chapter"] <= 100, r
        assert (r["a"], r["b"], r["label"]) not in [
            (x["a"], x["b"], x["label"]) for x in X.R if x is not r], f'重复连线 {r}'

    for p in X.P:
        assert p["name"] and p["summary"] and p["kind"], p["id"]
        assert isinstance(p["leg"], int), p["id"]
        assert 1 <= p["chapter"] <= 100, p["id"]
        if p.get("owner"):
            assert p["owner"] in byid, p["id"]

    last = 0
    eids = [e["id"] for e in X.E]
    assert len(eids) == len(set(eids)), "事件 id 重复"
    for e in X.E:
        assert e["place"] in set(pids), e["id"]
        assert e["cast"] and all(i in byid for i in e["cast"]), e["id"]
        assert e["name"] and e["summary"], e["id"]
        assert isinstance(e["chapter"], int) and 1 <= e["chapter"] <= 100, e["id"]
        assert e["chapter"] >= last, f'事件未按回次排列: {e["id"]}'
        last = e["chapter"]

    for t in X.T:
        assert t["verdict"] in ("照应", "拆分", "补列", "存疑"), t["name"]
        assert t["omen"] and t["actual"], t["name"]
        assert 1 <= t["chapter"] <= 100, t["name"]

    for w in X.W:
        assert w["verdict"] in VERDICT_ORDER, w["word"]
        assert w["basis"], w["word"]
        if w.get("person"):
            assert w["person"] in byid, w["word"]

    # 每个人物至少有一条关系（红楼同款约束：图上不许有孤岛）
    linked = set()
    for r in X.R:
        linked.add(r["a"]); linked.add(r["b"])
    orphan = [i for i in ids if i not in linked]
    assert not orphan, f"没有关系的人物: {orphan}"


def build():
    # 事件按回目排序后再校验：数据可以分块追加，但产物必须有序（前端时间线依赖这一点）
    X.E.sort(key=lambda e: (e["chapter"], e["id"]))
    check()

    data = dict(X.WORK)
    data["groups"] = X.GROUPS
    data["groupOrder"] = ["tu", "fo", "tian", "dao", "yao", "ren"]
    data["characters"] = sorted(X.C, key=lambda c: (
        ["tu", "fo", "tian", "dao", "yao", "ren"].index(c["group"]), c["chapters"][0]))
    data["relations"] = sorted(X.R, key=lambda r: (r["chapter"], GROUP_ORDER[r["group"]]))
    data["places"] = sorted(X.P, key=lambda p: (p["leg"], p["chapter"]))
    data["events"] = X.E
    data["trials"] = dict(X.TRIAL_META)
    data["trials"]["items"] = sorted(X.T, key=lambda t: t["chapter"])
    data["wordplay"] = sorted(X.W, key=lambda w: (KIND_ORDER.get(w["kind"], 9),
                                                  VERDICT_ORDER[w["verdict"]]))
    data["counts"] = {
        "characters": len(data["characters"]),
        "relations": len(data["relations"]),
        "places": len(data["places"]),
        "events": len(data["events"]),
        "trials": len(data["trials"]["items"]),
        "wordplay": len(data["wordplay"]),
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")

    c = data["counts"]
    print(f"✓ {os.path.relpath(OUT, ROOT)}")
    print(f"  人物 {c['characters']} · 关系 {c['relations']} · 地点 {c['places']} · "
          f"事件 {c['events']} · 难簿 {c['trials']} · 隐语 {c['wordplay']}")


if __name__ == "__main__":
    build()
