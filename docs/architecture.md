# Chinese Classics Atlas · 单仓库架构（第一阶段）

一个仓库、一个站点、一次构建与部署。作品是站内路由与独立数据包，不是独立 GitHub 项目。

## 当前可运行的纵向切片

- `/`：系列首页，从 `works/catalog.json` 读取已上线作品。
- `/works/honglou/`：原红楼完整界面，原有 hash 路由保持不变；根目录旧链接 `/#graph`、`/#item/pl-baoyu` 等重定向到红楼。
- `/api/works/honglou.json`：红楼专属数据包。本地服务与静态站使用同一 URL；首页不加载这份数据。
- `/en/`：既有英文落地页（暂时介绍红楼；后续改为系列英文首页）。

旧 `/api/bootstrap` 暂作为本地兼容端点；新前端不使用它。原有数据生成脚本、SQLite schema 和红楼渲染器暂不迁移，以保证迁移期间的页面与条目不退化。

## 目录与演进边界

```
works/catalog.json             已上线作品目录（只注册真正可构建的作品）
works/honglou/index.html       红楼专属页面
js/app.js                      目前仍是红楼专属渲染器
js/map-art.js                  红楼府邸绘图，不能视为通用地图组件
db/seed.json                   红楼源数据的生成结果
tools/validate_works.py        作品注册、引用校验入口
tools/build_static.py          唯一站点构建器
dist/api/works/<id>.json       按作品拆包（构建产物）
```

不提前为三国/西游建立空数据或无效入口。第二部作品落地时，先用其真实切片验证公共数据契约，再把**确实复用**的路由、搜索、详情、来源、关系图交互从红楼 `app.js` 抽出来。判词、府邸、战役、取经路线是可选的作品模块，不强迫每部作品支持。聊斋以篇目集组织，不套统一时间线。

新增作品的最小交付：有自己的数据源、构建输出、校验规则、入口页面（或已验证的公共页面）和 CI 冒烟测试，再在 catalog 中登记。不能只改目录宣称作品已上线。数据包带作品标识时应校验跨作品引用，出处必须标明作品/版本；三国小说情节与史料不能当同一层事实。

## 构建与验收

```bash
python3 tools/build_seed.py
python3 tools/validate_works.py
python3 db/init_db.py --force
python3 tools/build_static.py
./start.sh
```

访问 `/`、`/works/honglou/#graph`；根路径 `/#graph` 应转到红楼；本地预览与静态产物应有一致的作品数据。Pages 与 CI 都执行作品校验。不要把 `dist/`、工作区运营材料或内部截图脚本放进发布目录。
