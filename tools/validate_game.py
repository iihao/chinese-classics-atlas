#!/usr/bin/env python3
"""红楼文字小游戏 · 剧本校验

    python3 tools/validate_game.py            # 校验 works/honglou/game/scenes.json
    python3 tools/validate_game.py --stats    # 另外打印每条路线的分布

校验三层：

1. 结构：id 唯一、start 与 next 都有指向、每场至少两个选项、文案非空、
   效果只落在声明的暗线上且不越界、条件里出现的旗标必须有人设置、结局必须有兜底。
2. 可达：把所有可能的走法穷举一遍（条件照着引擎的判断来），确认每场戏、
   每个结局、每条册子记录都至少有一条路走得到——写死的分支不会悄悄变成死代码。
3. 收尾：每条路都必须落到某个结局，不能走到一半没有出口；路线不允许成环。
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "works", "honglou", "game", "scenes.json")
METER_MAX = 8           # 与 js/works/honglou-game.js 的 METER_MAX 一致
MAX_TURNS = 40          # 兜底：正常路线不超过 10 步

COND_KEYS = {"flags", "notFlags", "fenMin", "fenMax", "qingMin", "qingMax", "fengMin", "fengMax"}


def fail(msg):
    print("✗ " + msg)
    sys.exit(1)


def load():
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def structural(data):
    meters = data.get("meters") or {}
    if not meters:
        fail("缺少 meters")
    scenes = data.get("scenes") or []
    endings = data.get("endings") or []
    if not scenes or not endings:
        fail("scenes / endings 为空")

    ids = [s.get("id") for s in scenes]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        fail("场景 id 重复: %s" % sorted(dup))
    index = {s["id"]: s for s in scenes}

    if data.get("start") not in index:
        fail("start 指向不存在的场景: %r" % data.get("start"))

    flags_set, flags_read = set(), set()
    journal_total, turns_max = 0, 0

    for s in scenes:
        sid = s["id"]
        if not s.get("title"):
            fail("%s 缺少 title" % sid)
        if not (s.get("text") or []):
            fail("%s 没有正文" % sid)
        for p in s["text"]:
            if not str(p).strip():
                fail("%s 有空段落" % sid)
            if "<" in str(p) or ">" in str(p):
                fail("%s 的正文里有尖括号，引擎会当纯文本转义" % sid)
        choices = s.get("choices") or []
        if len(choices) < 2:
            fail("%s 只有 %d 个选项，至少要两个" % (sid, len(choices)))
        turns_max += 1
        for n, c in enumerate(choices):
            where = "%s 第 %d 个选项「%s」" % (sid, n + 1, c.get("label", "?"))
            if not c.get("label"):
                fail(where + " 缺少 label")
            nxt = c.get("next")
            if nxt not in index and nxt != "end":
                fail(where + " 指向不存在的场景: %r" % nxt)
            eff = c.get("effects") or {}
            for k, v in eff.items():
                if k not in meters:
                    fail(where + " 改了未声明的暗线: %s" % k)
                if not isinstance(v, int) or v == 0:
                    fail(where + " 的效果必须是整数且不为 0: %s=%r" % (k, v))
                if abs(v) > METER_MAX:
                    fail(where + " 的效果超出 ±%d: %s=%r" % (METER_MAX, k, v))
            for f in c.get("set") or []:
                if not f:
                    fail(where + " 设置了空旗标")
                flags_set.add(f)
            cond = c.get("if") or {}
            unknown = set(cond) - COND_KEYS
            if unknown:
                fail(where + " 有未知的条件字段: %s" % sorted(unknown))
            flags_read.update(cond.get("flags") or [])
            flags_read.update(cond.get("notFlags") or [])
            for k in ("fenMin", "fenMax", "qingMin", "qingMax", "fengMin", "fengMax"):
                if k in cond and not isinstance(cond[k], int):
                    fail(where + " 的条件 %s 必须是整数" % k)
            j = c.get("journal")
            if j:
                if not j.get("title") or not j.get("text") or not j.get("source"):
                    fail(where + " 的册子记录缺 title/text/source")
                journal_total += 1

    for e in endings:
        eid = e.get("id")
        if not eid or not e.get("title"):
            fail("结局缺少 id/title: %r" % eid)
        if not (e.get("text") or []):
            fail("结局 %s 没有正文" % eid)
        cond = e.get("if") or {}
        unknown = set(cond) - COND_KEYS
        if unknown:
            fail("结局 %s 有未知的条件字段: %s" % (eid, sorted(unknown)))
        flags_read.update(cond.get("flags") or [])
        flags_read.update(cond.get("notFlags") or [])

    eids = [e.get("id") for e in endings]
    if len(set(eids)) != len(eids):
        fail("结局 id 重复")
    if (endings[-1].get("if") or {}):
        fail("最后一个结局必须是无条件兜底，否则有路线走不到结局")

    unused = flags_read - flags_set
    if unused:
        fail("条件里引用了没人设置的旗标（永远不成立）: %s" % sorted(unused))

    return index, endings, journal_total, turns_max


def cond_met(cond, flags, meters):
    if not cond:
        return True
    if cond.get("flags") and not all(f in flags for f in cond["flags"]):
        return False
    if any(f in flags for f in cond.get("notFlags") or []):
        return False
    for k in ("fen", "qing", "feng"):
        lo, hi = cond.get(k + "Min"), cond.get(k + "Max")
        if isinstance(lo, int) and meters[k] < lo:
            return False
        if isinstance(hi, int) and meters[k] > hi:
            return False
    return True


def walk(data, index, endings, stats):
    """穷举所有走法。状态很小（7 场 × 若干旗标 × 三档暗线），一遍就完。"""
    journal_titles = {c["journal"]["title"] for s in data["scenes"] for c in s["choices"] if c.get("journal")}
    hit_journal, hit_scene, hit_ending = set(), set(), set()
    paths = 0

    def visit(sid, flags, meters, seen, depth):
        nonlocal paths
        if depth > MAX_TURNS:
            fail("路线越过 %d 步仍未结束，可能成了环: %s" % (MAX_TURNS, " → ".join(seen)))
        if sid in seen:
            fail("路线成环: %s → %s" % (" → ".join(seen), sid))
        seen = seen + [sid]
        hit_scene.add(sid)
        scene = index[sid]
        for c in scene["choices"]:
            if not cond_met(c.get("if"), flags, meters):
                continue
            nf = flags | set(c.get("set") or [])
            nm = dict(meters)
            for k, v in (c.get("effects") or {}).items():
                nm[k] = max(-METER_MAX, min(METER_MAX, nm[k] + v))
            if c.get("journal"):
                hit_journal.add(c["journal"]["title"])
            nxt = c.get("next")
            if nxt == "end":
                paths += 1
                ending = next((e for e in endings if cond_met(e.get("if"), nf, nm)), None)
                if ending is None:
                    fail("这条路走到了 end 却没有结局接住: %s" % " → ".join(seen))
                hit_ending.add(ending["id"])
                stats["ending"][ending["id"]] = stats["ending"].get(ending["id"], 0) + 1
                stats["turns"][len(seen)] = stats["turns"].get(len(seen), 0) + 1
                for k in ("fen", "qing", "feng"):
                    stats["end"][k][nm[k]] = stats["end"][k].get(nm[k], 0) + 1
            else:
                visit(nxt, frozenset(nf), nm, seen, depth + 1)

    start = data["start"]
    zero = {k: 0 for k in data["meters"]}
    visit(start, frozenset(), zero, [], 0)

    missing_scene = set(index) - hit_scene
    if missing_scene:
        fail("这些场景没有任何走法能到: %s" % sorted(missing_scene))
    missing_ending = {e["id"] for e in endings} - hit_ending
    if missing_ending:
        fail("这些结局没有任何走法能到: %s" % sorted(missing_ending))
    missing_journal = journal_titles - hit_journal
    if missing_journal:
        fail("这些册子记录没有任何走法能拿: %s" % sorted(missing_journal))

    return paths, hit_ending, hit_journal, journal_titles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true", help="打印路线与结局分布")
    args = ap.parse_args()

    data = load()
    index, endings, journal_total, turns_max = structural(data)
    stats = {"turns": {}, "end": {k: {} for k in data["meters"]}, "ending": {}}
    paths, hit_ending, hit_journal, journal_titles = walk(data, index, endings, stats)

    print("OK: %d 场 · %d 个选项 · %d 条册子记录 · %d 个结局 · %d 条路线"
          % (len(data["scenes"]), sum(len(s["choices"]) for s in data["scenes"]),
             journal_total, len(endings), paths))

    if args.stats:
        print("\n结局分布（路线数 / 占比）：")
        for e in endings:
            n = stats["ending"].get(e["id"], 0)
            print("  %-10s %5d  %5.1f%%" % (e["id"], n, 100.0 * n / paths))
        print("\n单条路线的场次数：", dict(sorted(stats["turns"].items())))
        print("册子总量：%d 条" % len(journal_titles))
        print("\n走到过的点：场景 %d / 结局 %d / 册子 %d"
              % (len(index), len(hit_ending), len(hit_journal)))


if __name__ == "__main__":
    main()
