#!/usr/bin/env python3
"""合并三国核心叙事数据与百科档案层。

core:  works/sanguo/data.json          人物、关系、事件、地点、回目
extra: works/sanguo/encyclopedia.json  史传事实字段与百科外链（不含百科正文）

构建器和本地服务都调用本模块，保证两边看到的字段一致。
"""
import json
import os

SECTIONS = ("characters", "events", "places")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load(root):
    root = os.fspath(root)
    data = _read(os.path.join(root, "works", "sanguo", "data.json"))
    enc_path = os.path.join(root, "works", "sanguo", "encyclopedia.json")
    enc = _read(enc_path) if os.path.exists(enc_path) else {}
    for section in SECTIONS:
        extra = enc.get(section) or {}
        for item in data.get(section) or []:
            add = extra.get(item["id"])
            if not add:
                continue
            if add.get("facts"):
                item["facts"] = add["facts"]
            if add.get("refs"):
                item["refs"] = add["refs"]
            if add.get("note"):
                item["encyclopediaNote"] = add["note"]
    if enc.get("note"):
        data["encyclopediaNote"] = enc["note"]
    if enc.get("factSource"):
        data["factSource"] = enc["factSource"]
    return data