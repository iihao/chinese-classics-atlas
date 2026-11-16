#!/usr/bin/env python3
"""由 tools/shuihu_data.py 生成 works/shuihu/data.json。

    python3 tools/build_shuihu.py

与西游同一条思路：数据源写在 Python 里（便于注释、断言、排序），
产物是单文件 JSON，前端一次加载。改完重跑本脚本，再跑 validate_works.py。
"""
import json
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shuihu_data as S
import wikidata_merge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "works", "shuihu", "data.json")

GROUP_ORDER = {"kin": 0, "serve": 1, "ally": 2, "friend": 3, "rival": 4}


def build():
    ids = [c[3] for c in S.C]
    byid = {c[3]: c for c in S.C}
    groups = {g["id"] for g in S.GROUPS}
    place_ids = {p[0] for p in S.P}
    event_ids = [e[0] for e in S.E]

    assert len(ids) == len(set(ids)), "人物 id 重复"
    assert len(place_ids) == len(S.P), "地点 id 重复"
    assert len(event_ids) == len(set(event_ids)), "事件 id 重复"

    characters = []
    for rank, star, nickname, cid, name, group, role, chapters, summary, detail, ending, fate, history in S.C:
        assert group in groups, cid
        assert name and summary and detail and ending, cid
        assert fate in S.FATE_ORDER, cid
        assert chapters and all(1 <= n <= 120 for n in chapters), cid
        if rank is not None:
            assert 1 <= rank <= 108
            assert star and nickname, cid
        else:
            assert star is None, cid
        entry = {
            "id": cid, "name": name, "nickname": nickname, "star": star,
            "rank": rank, "group": group, "role": role,
            "chapters": chapters, "summary": summary, "detail": detail,
            "ending": ending, "fate": fate, "history": history,
        }
        if cid in S.DUTY:
            entry["duty"] = S.DUTY[cid]
        if cid in S.NICK:
            entry["nicknameNote"] = S.NICK[cid]
        if cid in S.BEFORE:
            entry["before"] = S.BEFORE[cid]
        # 延伸阅读：只给检索入口，不假定条目页存在。
        entry["refs"] = [
            {"label": "维基百科检索", "url": "https://zh.wikipedia.org/w/index.php?search=" +
             quote(name)},
            {"label": "百度百科检索", "url": "https://baike.baidu.com/search/word?word=" +
             quote(name)},
        ]
        characters.append(entry)

    for c in characters:
        if c["rank"]:
            assert c.get("duty"), f'{c["id"]}: 有座次者必须有职司'
            assert c["refs"], c["id"]

    # 座次不得重复；本切片收全三十六天罡，地煞按需选录，序号因此不连续。
    ranks = sorted(c["rank"] for c in characters if c["rank"])
    assert len(ranks) == len(set(ranks)), "座次重复"
    assert sorted(r for r in ranks if r <= 36) == list(range(1, 37)), "天罡三十六未收全"

    relations = []
    seen = set()
    for a, b, label, group, chapter in S.R:
        assert a in byid and b in byid, (a, b)
        assert a != b and label, (a, b)
        assert group in GROUP_ORDER, label
        assert 1 <= chapter <= 120, label
        pair = tuple(sorted((a, b)))
        assert pair not in seen, f"同一对人物重复连线: {pair}"
        seen.add(pair)
        relations.append({"a": a, "b": b, "label": label, "group": group, "chapter": chapter})

    linked = {x for r in relations for x in (r["a"], r["b"])}
    orphan = [c["name"] for c in characters if c["id"] not in linked]
    assert not orphan, f"没有关系的人物: {orphan}"

    places = []
    last = 0
    for pid, name, modern, chapter, summary in S.P:
        assert name and summary and modern, pid
        assert 1 <= chapter <= 120, pid
        places.append({"id": pid, "name": name, "modern": modern, "chapter": chapter, "summary": summary})

    events = []
    for eid, name, chapter, source_title, place, cast, summary, detail, history in S.E:
        assert place in place_ids, eid
        assert cast and all(c in byid for c in cast), eid
        assert name and summary and detail and source_title, eid
        assert 1 <= chapter <= 120, eid
        assert chapter >= last, f"事件未按回次排列: {eid}"
        last = chapter
        events.append({"id": eid, "name": name, "chapter": chapter, "sourceTitle": source_title,
                       "place": place, "cast": cast, "summary": summary, "detail": detail,
                       "history": history})

    amnesty = [{"id": i, "name": n, "chapter": ch, "summary": s} for i, n, ch, s in S.AMNESTY]
    assert amnesty and amnesty[0]["chapter"] <= amnesty[-1]["chapter"]

    heavens = [c for c in characters if c["rank"] and c["rank"] <= 36]
    earths = [c for c in characters if c["rank"] and c["rank"] > 36]
    data = {
        "version": 1,
        "workId": S.WORK["workId"],
        "title": S.WORK["title"],
        "subtitle": S.WORK["subtitle"],
        "scope": S.WORK["scope"],
        "source": S.WORK["source"],
        "factSource": S.FACT_NOTE,
        "layer": S.WORK["layer"],
        "groups": S.GROUPS,
        "groupOrder": S.GROUP_ORDER,
        "fateOrder": S.FATE_ORDER,
        "characters": characters,
        "relations": relations,
        "places": places,
        "events": events,
        "amnesty": amnesty,
        "counts": {
            "characters": len(characters),
            "ranked": len(heavens) + len(earths),
            "heaven": len(heavens),
            "earth": len(earths),
            "relations": len(relations),
            "places": len(places),
            "events": len(events),
        },
    }

    data = wikidata_merge.merge(ROOT, S.WORK["workId"], data)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"✓ {OUT}")
    print(f"  人物 {len(characters)}（天罡 {len(heavens)} · 地煞 {len(earths)}）· 关系 {len(relations)} · "
          f"地点 {len(places)} · 事件 {len(events)} · 招安阶段 {len(amnesty)}")


if __name__ == "__main__":
    build()