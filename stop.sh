#!/usr/bin/env bash
# 停止服务（pm2 守护）

set -e
cd "$(dirname "$0")"

npm run pm2:stop
