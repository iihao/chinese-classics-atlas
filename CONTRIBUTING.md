# 参与贡献

欢迎补充人物、关系、判词、事件与地点。数据是纯文本（Python 结构），不需要数据库基础。

## 环境

- Python 3.8+（仅标准库）
- Node 18+（可选，只用来 `node --check` 校验前端语法）

## 工作流

```bash
git clone https://github.com/iihao/chinese-classics-atlas.git
cd chinese-classics-atlas
python3 tools/build_seed.py      # 生成 db/seed.json
python3 db/init_db.py --force    # 重建 SQLite
./start.sh                       # http://127.0.0.1:8600
```

改完数据后**两个命令都要重跑**，否则页面看到的还是旧库。

## 数据在哪

| 文件 | 内容 |
|---|---|
| `tools/build_seed.py` | 主体：人物、关系、谱系、判词、事件、回目 |
| `tools/enrich_data.py` | 富化：长文详述、别名、额外人物/事件/诗词、参考来源 |

## 新增人物

```python
person("pl-xxx", "姓名", alias="别号", family="rong", role="主子",
       summary="一句话提要。",
       detail="详细叙述，可分段落，用 \\n\\n 分隔。",
       tags=["标签"])
```

- `family` 用已有家族 id：`rong` `ning` `shi` `wang` `xue` `lin` `other`
- `role` 用：`主子` `妾室` `丫鬟` `仆役` `小厮` `清客` `僧道` `外人` `亲戚`
- 新人物请同时在 `EXTRA` 里补至少一条关系，否则会成为孤立节点

## 新增关系

```python
EXTRA = [
    ("pl-a", "pl-b", "父子"),   # a → b
]
```

关系**方向有意义**：`父子` 表示 a 是父、b 是子；前端在 b 的页面会自动显示成「父」。
常用标签：`父子 父女 母子 母女 夫妻 妾室 祖孙 兄弟 姐妹 主仆 陪房 小厮 知己 情人 师徒 镜像`

## 新增事件

```python
("ev-xxx", "事件名", "第X回", "一句话提要", "详细经过。")
```

并在 `EVENT_CAST` 里列出出场人物；未列的人会由构建脚本按正文自动补「涉及」关系。

## 新增谱系

在 `GENEALOGY` 里加一行：

```python
("pl-id", "显示名\n（说明）", "父id", "配偶id", 世代, "家族id"),
```

世代从 1 开始。配偶不必在本家族谱系里，只要词条存在即可。

## 三国数据

三国是可交互的小说叙事切片，源数据在 `works/sanguo/data.json`，不要直接改 `dist/` 或接口输出。

- 人物、地点、事件 id 使用稳定 ASCII；三类 id 全局唯一（事件统一以 `ev-` 开头）。
- 人物必须带 `faction`（取自顶层 `factions`）、`role`、`chapters`、`summary`；有史传差异时写 `history`。
- 地点必须带 `chapter`、`summary`，尽量补 `modern` 今地对照；事件用 `place` 指向地点 id。
- 事件必须带 `chapter`、`sourceTitle`、`place`、`cast`，并按回次递增排列；`chapter` 取 1–120。
- 关系必须带 `label`、`group`（`kin` / `serve` / `ally` / `friend` / `rival`）和 `chapter`；同一对人物只保留一条主关系，其余写进人物 `detail`。
- 每个新增人物至少要连上一条关系，否则会成为孤立节点。
- 小说增饰、史书无载或诸说并存的内容，写进 `history`，不要写成确定史实。

### 三国百科档案

生卒、籍贯、官职、交战方、结果等外部事实放在 `works/sanguo/encyclopedia.json`，不要塞回 `data.json`。

- 键是人物/事件/地点 id；`facts` 为 `{label, value}` 列表，`refs` 为 `{label, url}` 列表。
- 只写可核对的事实字段，不复制维基/百度正文；外链优先使用条目页，拿不准时用检索链接。
- 生卒年、地望有异说时写「约」「不详」或在 `note` 说明，不要补成确定值。
- `encyclopedia.json` 必须覆盖全部人物，且每个人物至少一条 `facts` 和 `refs`；校验器会检查。

改完运行：

```bash
python3 tools/validate_works.py
python3 tools/build_static.py
node --check js/works/sanguo.js
```

## 水浒数据

水浒与西游一样，源数据写在 Python 里（便于注释与断言），产物是 JSON：

| 文件 | 内容 |
|---|---|
| `tools/shuihu_data.py` | 人物（含座次、星号、绰号、山头、结局）、关系、地点、事件、招安阶段 |
| `tools/build_shuihu.py` | 生成 `works/shuihu/data.json` 并做结构断言 |

- 有座次者必须写全 `rank`（1–108）、`star`、`nickname`；未入一百单八将的（晁盖、高俅等）`rank` 写 `None`。
- `fate` 只能取 `阵亡 / 病故 / 被害 / 自尽 / 出家 / 归隐 / 存留 / 不明`，具体经过写在 `ending`。
- 山头取 `tools/shuihu_data.py` 里 `GROUPS` 的 id；新增山头要同时补 `GROUPS` 与颜色。
- 同一对人物只保留一条主关系；事件按回次递增排列，`cast` 与 `place` 必须可解析。
- 版本分歧（招安后情节、宋江结局等）写进 `history` 或 `ending`，不要写成唯一结论。

改完运行：

```bash
python3 tools/build_shuihu.py
python3 tools/validate_works.py
python3 tools/build_static.py
node --check js/works/shuihu.js
```

## 红楼文字小游戏

剧情在 `works/honglou/game/scenes.json`，引擎在 `js/works/honglou-game.js`，不需要改引擎即可加场景。

- 场景字段：`id`、`title`、`chapter`、`place`、`text`（段落数组）、`choices`。
- 选项字段：`label`（动作，不写「善良/冷漠」这类判断）、`detail`（结果暗示）、`effects`、`set`（旗标）、
  `journal`（册子条目）、`next`（场景 id 或 `end`）。
- 条件只有两类：旗标（`if.flags` / `if.notFlags`）与三条暗线的上下限（`fenMin` 等）。
- 结局按顺序匹配，**最后一个必须是无条件兜底**；条件里引用的旗标必须有人 `set`，否则是永远不成立的分支。
- 改完剧本跑 `python3 tools/validate_game.py --stats`：它把**所有可能的走法穷举一遍**（目前 7 场戏、7936 条路线），
  确认每场戏、每个结局、每条册子记录都至少有一条路走得到，并且每条路都能落到结局、不成环。
  新增分支如果没有路口能进去（比如少写了一个旗标），这里会直接报错，不会悄悄变成死代码。
- 原则：玩家的选择改变「你在府里的位置」，不改变判词与十二钗的结局；不写攻略式选项，不把人物当资源。

## 外部数据（Wikidata）

- 事实型字段（生卒、职业、职位、见于作品）优先取 Wikidata；它的事实声明是 **CC0**，可直接复用。
- 维基百科正文是 **CC BY-SA**：不要整段复制进 `summary` / `detail`。只能作为延伸阅读链接。
- 抓取器只接受中文标签完全匹配的实体，拿不准就跳过，宁可缺数据也不要错配。

```bash
python3 tools/fetch_wikidata.py --work sanguo --limit 5   # 先小样本试跑
python3 tools/fetch_wikidata.py --work sanguo             # 写入 works/sanguo/wikidata.json
python3 tools/fetch_wikidata.py --work sanguo --offline   # 断网时用缓存
```

产物只含 `facts` 与 `refs`，由 `tools/wikidata_merge.py` 在构建时合并；原始响应缓存在
`tools/cache/`（已 gitignore）。抓取失败时脚本不会写文件，也不会用占位数据冒充。

## 提交前自检

```bash
python3 - <<'PY'
import json, collections
d = json.load(open('db/seed.json', encoding='utf-8'))
ids = [i['id'] for i in d['items']]
assert len(ids) == len(set(ids)), '重复 id'
idset = set(ids)
assert not [r for r in d['relations'] if r['a'] not in idset or r['b'] not in idset], '悬空关系'
assert not [g for g in d['genealogy'] if g['id'] not in idset], '谱系悬空'
print('OK', len(ids), '条目')
PY
node --check js/app.js
python3 tools/validate_game.py
```

CI 也会跑同样的检查，并通过 `tools/build_static.py` 验证静态构建。

## 内容规范

- 判词、诗词取通行本（程乙本为主）文字，节选标注「节选」
- 有争议的结局写「一说」「探佚」，不要写成定论
- 参考来源写进 `refs`，优先原典回目 + 《红楼梦大辞典》
- 不要复制受版权保护的现代译注长文

## 接入一部新作品（以西游为例）

一个作品要同时满足五条，才在 `works/catalog.json` 里登记为 `available`：

1. **自己的数据源**：`tools/<work>_data.py`（Python 里写便于注释与断言），
   构建器 `tools/build_<work>.py` 输出 `works/<work>/data.json`。
2. **自己的校验分支**：`tools/validate_works.py` 里为该作品写结构断言——
   id 唯一、跨引用不悬空、事件按回目不减、每个人物至少有一条关系。
   西游还额外校验：判定取值受限、隐语必须有 `basis`、路线站点不得写死坐标。
3. **入口页与渲染器**：`works/<work>/index.html` + `js/works/<work>.js` + `css/<work>.css`。
   渲染器不共用：红楼的谱系/判词/府邸、三国的势力图、西游的路线/难簿/隐语是三套代码。
   样式分层相反：顶栏、页头、数据条、工具条、筛选片、搜索框、缩放组、页脚、断点都在
   `css/atlas.css`，作品 css 只写自己的部件。页面按 `<link … css/<work>.css>` → `<link … css/atlas.css>` 的顺序加载，
   `<html data-work="<work>">` 声明身份色。新增样式先问：这是四部都该一样的，还是只有这部有？前者进 atlas。
4. **CI 冒烟**：`.github/workflows/ci.yml` 里补 `node --check`、`dist/` 文件存在性与数据包断言。
5. **文档**：README 作品表 + `docs/architecture.md` 的边界说明。

三条从西游留下的约定：

- **位置类数据不写死在源里**。路线站点只记 `leg` 与 `chapter`，坐标由渲染器算；
  否则每加一个站点都要重排整条线（`validate_works.py` 会拒绝带 `x`/`y` 的站点）。
- **解释性内容必须分级并给依据**。西游的隐语每条带 `basis` + `verdict`（通行 / 一说 / 存疑），
  难簿每条带 `omen` / `actual` / `verdict`（照应 / 拆分 / 补列 / 存疑）。
  没有依据的结论不入库；牵强的读法可以收，但必须标存疑。
- **版本差异要写进口径，并让校验器盯住**。唐僧出身故事在世德堂本被删并、通行本作第 9 回附录，
  因此凡文字里出现「第9回」的条目必须同时出现「附录」二字——这条断言就在 `validate_works.py` 里。
