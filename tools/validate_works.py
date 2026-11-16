#!/usr/bin/env python3
"""校验已发布作品的目录、源数据和跨引用（单站多作品）。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
catalog = json.loads((ROOT / 'works/catalog.json').read_text(encoding='utf-8'))
assert catalog['version'] == 1
seen = set()
for work in catalog['works']:
    wid = work['id']
    assert re.fullmatch(r'[a-z][a-z0-9-]*', wid) and wid not in seen, wid
    seen.add(wid)
    assert work['status'] == 'available', wid
    assert work['entry'] == f'works/{wid}/', wid
    assert work['data'] == f'api/works/{wid}.json', wid
    assert (ROOT / work['entry'] / 'index.html').is_file(), wid
    if wid == 'honglou':
        game_path = ROOT / 'works/honglou/game/scenes.json'
        if game_path.is_file():
            g = json.loads(game_path.read_text(encoding='utf-8'))
            assert g['version'] == 1 and g['workId'] == wid
            assert g['title'] and g['intro'] and g['meters']
            scenes = {s['id']: s for s in g['scenes']}
            assert len(scenes) == len(g['scenes']), '游戏场景 id 重复'
            assert g['start'] in scenes, '起始场景不存在'
            assert g['endings'], '缺少结局'
            visited, stack = set(), [g['start']]
            while stack:
                sid = stack.pop()
                if sid in visited:
                    continue
                visited.add(sid)
                scene = scenes[sid]
                assert scene['title'] and scene['text'], sid
                for ev in scene['text']:
                    assert isinstance(ev, str) and ev.strip(), sid
                assert scene['choices'], f'{sid}: 没有选项'
                for choice in scene['choices']:
                    assert choice['label'], sid
                    nxt = choice.get('next')
                    assert nxt == 'end' or nxt in scenes, f'{sid}: 指向未知场景 {nxt}'
                    if nxt and nxt != 'end':
                        stack.append(nxt)
                    if choice.get('journal'):
                        assert choice['journal'].get('title'), sid
            orphans = set(scenes) - visited
            assert not orphans, f'游戏存在不可达场景: {sorted(orphans)}'
            for ending in g['endings']:
                assert ending['id'] and ending['title'] and ending['text'], ending
                cond = ending.get('if') or {}
                allowed = {'flags', 'notFlags', 'fenMin', 'fenMax', 'qingMin', 'qingMax',
                           'fengMin', 'fengMax'}
                assert set(cond) <= allowed, f'{ending["id"]}: 未知条件 {set(cond) - allowed}'
            assert g['endings'][-1].get('if') in ({}, None), '最后一个结局必须是无条件兜底'
        seed = json.loads((ROOT / 'db/seed.json').read_text(encoding='utf-8'))
        ids = {item['id'] for item in seed['items']}
        assert len(ids) == len(seed['items'])
        assert all(r['a'] in ids and r['b'] in ids for r in seed['relations'])
        assert all(g['id'] in ids or g['id'].startswith('vg-') for g in seed['genealogy'])
    elif wid == 'sanguo':
        data = json.loads((ROOT / 'works/sanguo/data.json').read_text(encoding='utf-8'))
        assert data['version'] == 1 and data['workId'] == wid
        assert data['source'] and data['scope'] and data['layer'] == 'novel'
        factions = {f['id'] for f in data['factions']}
        assert len(factions) == len(data['factions'])
        chars, places, events = data['characters'], data['places'], data['events']
        assert chars and places and events and data['relations']
        all_ids = [x['id'] for x in chars + places + events]
        assert len(all_ids) == len(set(all_ids)), '三国条目 id 重复'
        people = {x['id'] for x in chars}
        place_ids = {x['id'] for x in places}
        groups = {'kin', 'serve', 'ally', 'friend', 'rival'}
        for p in chars:
            assert p['name'] and p['summary'] and p['faction'] in factions, p['id']
            assert isinstance(p['chapters'], list) and p['chapters']
            assert all(isinstance(n, int) and 1 <= n <= 120 for n in p['chapters']), p['id']
        for place in places:
            assert place['name'] and place['summary']
            assert isinstance(place['chapter'], int) and 1 <= place['chapter'] <= 120
        last = 0
        for event in events:
            assert event['cast'] and all(i in people for i in event['cast']), event['id']
            assert event['place'] in place_ids, event['id']
            assert event['sourceTitle'] and event['summary']
            assert isinstance(event['chapter'], int) and 1 <= event['chapter'] <= 120
            assert event['chapter'] >= last, f'事件未按回次排列: {event["id"]}'
            last = event['chapter']
        pairs = set()
        for relation in data['relations']:
            assert relation['a'] in people and relation['b'] in people, relation
            assert relation['a'] != relation['b'] and relation['label']
            assert relation['group'] in groups, relation
            assert isinstance(relation['chapter'], int) and 1 <= relation['chapter'] <= 120
            pair = tuple(sorted((relation['a'], relation['b'])))
            assert pair not in pairs, f'同一对人物重复连线: {pair}'
            pairs.add(pair)
        for person in chars:
            assert any(person['id'] in (r['a'], r['b']) for r in data['relations']), \
                f'{person["id"]} 没有关系'
        # 百科档案层：只允许补充事实字段与外链，不改动核心叙事字段。
        enc = json.loads((ROOT / 'works/sanguo/encyclopedia.json').read_text(encoding='utf-8'))
        assert enc['version'] == 1 and enc['note'] and enc['factSource']
        for section, source in (('characters', chars), ('events', events), ('places', places)):
            ids = {x['id'] for x in source}
            extra = enc[section]
            assert set(extra) == ids, f'百科档案与 {section} 不一致'
            for key, item in extra.items():
                if 'facts' in item:
                    assert item['facts'], key
                    for f in item['facts']:
                        assert f['label'] and f['value'], key
                if 'refs' in item:
                    assert item['refs'], key
                    for r in item['refs']:
                        assert r['label'] and r['url'].startswith(('https://', 'http://')), key
        assert all(enc['characters'][c['id']].get('facts') for c in chars)
        assert all(enc['characters'][c['id']].get('refs') for c in chars)
    elif wid == 'xiyou':
        data = json.loads((ROOT / 'works/xiyou/data.json').read_text(encoding='utf-8'))
        assert data['version'] == 1 and data['workId'] == wid
        assert data['source'] and data['scope'] and data['layer'] == 'novel'
        groups = {g['id'] for g in data['groups']}
        assert groups == set(data['groupOrder']), '分组与顺序不一致'
        chars, places, events = data['characters'], data['places'], data['events']
        ids = [x['id'] for x in chars + places + events]
        assert len(ids) == len(set(ids)), '西游条目 id 重复'
        people = {x['id'] for x in chars}
        place_ids = {x['id'] for x in places}
        ggroups = {'master', 'kin', 'serve', 'ally', 'friend', 'rival'}
        for c in chars:
            assert c['name'] and c['summary'] and c['role'], c['id']
            assert c['group'] in groups, c['id']
            assert c['chapters'] and all(1 <= n <= 100 for n in c['chapters']), c['id']
        pairs = set()
        for r in data['relations']:
            assert r['a'] in people and r['b'] in people, r
            assert r['a'] != r['b'] and r['label'] and r['group'] in ggroups, r
            assert r.get('inv'), f'关系缺 inv（b 端称谓）: {r}'
            assert 1 <= r['chapter'] <= 100, r
            key = (r['a'], r['b'], r['label'])
            assert key not in pairs, f'重复连线: {key}'
            pairs.add(key)
        linked = {x for r in data['relations'] for x in (r['a'], r['b'])}
        assert people <= linked, f'没有关系的人物: {sorted(people - linked)}'
        # 路线：leg 0—6 为西行段（渲染器按 leg 分行、按回目排座次），9 为神界不入路线
        allowed_legs = set(range(0, 7)) | {9}
        for p in places:
            assert p['name'] and p['summary'] and p['kind'], p['id']
            assert 1 <= p['chapter'] <= 100, p['id']
            assert p['leg'] in allowed_legs, p['id']
            assert 'x' not in p and 'y' not in p, f'{p["id"]}: 坐标应交给渲染器计算'
            if p.get('owner'):
                assert p['owner'] in people, p['id']
        # 同段内回目不得倒退
        by_leg = {}
        for p in places:  # 按数据原始顺序校验；预先排序会让「递增」断言恒真
            last = by_leg.get(p['leg'], 0)
            assert p['chapter'] >= last, f'路段 {p["leg"]} 内回目倒退: {p["id"]}'
            by_leg[p['leg']] = p['chapter']
        last = 0
        for e in events:
            assert e['place'] in place_ids, e['id']
            assert e['cast'] and all(i in people for i in e['cast']), e['id']
            assert e['name'] and e['summary'], e['id']
            assert 1 <= e['chapter'] <= 100 and e['chapter'] >= last, e['id']
            last = e['chapter']
        tv = {'照应', '拆分', '补列', '存疑'}
        assert data['trials']['items'] and data['trials']['note']
        for t in data['trials']['items']:
            assert t['name'] and t['omen'] and t['actual'], t['name']
            assert t['verdict'] in tv, t['name']
            assert 1 <= t['chapter'] <= 100, t['name']
            assert all(w in people for w in t.get('who', [])), t['name']
        wv = {'通行', '一说', '存疑'}
        wk = {'拆字·会意', '内丹代号', '名号反语·游戏', '名号寓意', '地名寓意', '佛典用事', '谐音·附会'}
        assert data['wordplay']
        for w in data['wordplay']:
            assert w['word'] and w['meaning'] and w['basis'], w['word']
            assert w['kind'] in wk and w['verdict'] in wv, w['word']
            if w.get('person'):
                assert w['person'] in people, w['word']
        # 口径：唐僧出身故事必须标「附录」，不得假装两本一致
        for t in data['trials']['items'] + data['events']:
            txt = str(t)
            if '第9回' in txt or '第 9 回' in txt:
                assert '附录' in txt, f'第9回未标版本口径: {t.get("id") or t.get("name")}'
    elif wid == 'shuihu':
        data = json.loads((ROOT / 'works/shuihu/data.json').read_text(encoding='utf-8'))
        assert data['version'] == 1 and data['workId'] == wid
        assert data['source'] and data['scope'] and data['layer'] == 'novel'
        groups = {g['id'] for g in data['groups']}
        assert groups == set(data['groupOrder']), '山头分组与顺序不一致'
        chars, places, events = data['characters'], data['places'], data['events']
        ids = [x['id'] for x in chars + places + events]
        assert len(ids) == len(set(ids)), '水浒条目 id 重复'
        people = {x['id'] for x in chars}
        place_ids = {x['id'] for x in places}
        rgroups = {'kin', 'serve', 'ally', 'friend', 'rival'}
        fates = set(data['fateOrder'])
        ranks = []
        for c in chars:
            assert c['name'] and c['summary'] and c['detail'] and c['ending'], c['id']
            assert c['group'] in groups and c['role'], c['id']
            assert c['fate'] in fates, c['id']
            assert c['chapters'] and all(1 <= n <= 120 for n in c['chapters']), c['id']
            if c['rank'] is not None:
                assert 1 <= c['rank'] <= 108 and c['star'] and c['nickname'], c['id']
                assert c.get('duty'), f'{c["id"]}: 有座次者必须有梁山职司'
                ranks.append(c['rank'])
            assert c.get('refs'), f'{c["id"]}: 缺少延伸阅读链接'
            for ref in c['refs']:
                assert ref['label'] and ref['url'].startswith(('https://', 'http://')), c['id']
            if c.get('nicknameNote') is not None:
                assert c['nicknameNote'].strip(), c['id']
        assert sorted(r for r in ranks if r <= 36) == list(range(1, 37)), '天罡三十六未收全'
        assert len(ranks) == len(set(ranks)), '座次重复'
        assert all(c['star'] is None for c in chars if c['rank'] is None), '未入座次者不应有星号'
        pairs = set()
        for r in data['relations']:
            assert r['a'] in people and r['b'] in people, r
            assert r['a'] != r['b'] and r['label'] and r['group'] in rgroups, r
            assert 1 <= r['chapter'] <= 120, r
            pair = tuple(sorted((r['a'], r['b'])))
            assert pair not in pairs, f'同一对人物重复连线: {pair}'
            pairs.add(pair)
        linked = {x for r in data['relations'] for x in (r['a'], r['b'])}
        assert people <= linked, f'没有关系的人物: {sorted(people - linked)}'
        for place in places:
            assert place['name'] and place['summary'] and place['modern'], place['id']
            assert 1 <= place['chapter'] <= 120, place['id']
        last = 0
        for event in events:
            assert event['place'] in place_ids, event['id']
            assert event['cast'] and all(i in people for i in event['cast']), event['id']
            assert event['name'] and event['summary'] and event['sourceTitle'], event['id']
            assert 1 <= event['chapter'] <= 120 and event['chapter'] >= last, event['id']
            last = event['chapter']
        amnesty_chs = [s['chapter'] for s in data['amnesty']]
        assert amnesty_chs and amnesty_chs == sorted(amnesty_chs), '招安时间线未按回次排列'
        for step in data['amnesty']:
            assert step['name'] and step['summary'] and 1 <= step['chapter'] <= 120, step['id']
        counts = data['counts']
        assert counts['characters'] == len(chars) and counts['relations'] == len(data['relations'])
        assert counts['ranked'] == len(ranks) and counts['heaven'] == 36
        assert counts['heaven'] + counts['earth'] == counts['ranked'], '座次统计口径不一致'
        assert counts['earth'] == sum(1 for r in ranks if r > 36), '地煞数与座次不符'
        assert counts['places'] == len(places) and counts['events'] == len(events)
    else:
        raise ValueError(f'{wid}: 尚未实现作品构建；请先补充数据源和导出器')
print('OK: ' + ', '.join(sorted(seen)))