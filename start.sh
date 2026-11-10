#!/usr/bin/env bash
# 启动服务（pm2 守护）

set -e
cd "$(dirname "$0")"

npm run pm2:start
