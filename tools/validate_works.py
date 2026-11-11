#!/usr/bin/env python3
"""校验系列作品目录与数据包约定（单站、按作品路由/数据加载）。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
catalog = json.loads((ROOT / 'works/catalog.json').read_text(encoding='utf-8'))
assert catalog['version'] == 1
seen = set()
for work in catalog['works']:
    wid = work['id']
    assert wid.isascii() and wid.replace('-', '').isalnum() and wid not in seen, wid
    seen.add(wid)
    assert work['entry'] == f'works/{wid}/', wid
    assert work['data'] == f'api/works/{wid}.json', wid
    assert (ROOT / work['entry'] / 'index.html').is_file(), wid
    if wid == 'honglou':
        seed = json.loads((ROOT / 'db/seed.json').read_text(encoding='utf-8'))
        ids = {item['id'] for item in seed['items']}
        assert len(ids) == len(seed['items'])
        assert all(r['a'] in ids and r['b'] in ids for r in seed['relations'])
        assert all(g['id'] in ids or g['id'].startswith('vg-') for g in seed['genealogy'])
    else:
        # 作品新增时必须在构建器中注册并有自己的数据源；不能只挂一个空壳路由。
        raise ValueError(f'{wid}: 尚未实现作品构建；请先补充数据源和导出器')
print('OK: ' + ', '.join(sorted(seen)))
