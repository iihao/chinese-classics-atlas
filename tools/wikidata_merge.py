#!/usr/bin/env python3
"""把 tools/fetch_wikidata.py 产出的 wikidata.json 合并进作品数据。

只补充事实与链接，不改动叙事字段（summary/detail/ending/history）。
文件不存在时原样返回，便于离线与 CI 环境。
"""
import json
import os


def merge(root, work, data, section="characters"):
    path = os.path.join(os.fspath(root), "works", work, "wikidata.json")
    if not os.path.exists(path):
        return data
    with open(path, encoding="utf-8") as f:
        extra = json.load(f)
    entries = (extra.get("entries") or {})
    by_id = {x["id"]: x for x in data.get(section) or []}
    merged = 0
    for cid, item in entries.items():
        target = by_id.get(cid)
        if not target:
            continue
        facts = list(item.get("facts") or [])
        if facts:
            # 外部事实单独标注来源，避免与本项目自撰的说明混为一谈。
            for f in facts:
                f["source"] = "wikidata"
            target["wikidataFacts"] = facts
        if item.get("refs"):
            urls = {r["url"] for r in target.get("refs") or []}
            refs = list(target.get("refs") or [])
            for ref in item["refs"]:
                if ref.get("url") and ref["url"] not in urls:
                    refs.append(ref)
            target["refs"] = refs
        target["wikidataQid"] = item.get("qid")
        merged += 1
    if merged:
        data["wikidata"] = {"source": extra.get("source"),
                            "license": extra.get("license"),
                            "count": merged}
    return data