#!/usr/bin/env bash
# 中国古典名著图谱 · 一键启动
set -euo pipefail
cd "$(dirname "$0")"
[ -f db/honglou.db ] || python3 db/init_db.py
exec python3 server/app.py "$@"
