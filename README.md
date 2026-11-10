# node-weixin

nodejs + socket.io 的多人在线聊天室，**内置网页客户端**（`public/`，零构建，开箱即用）。

当前版本已完成现代化改造（Node 20+ / Express 5 / Mongoose 9 / Socket.IO 4 / 原生 ESM，无 Babel 构建步骤）。

## 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | >= 20（推荐 22 LTS） |
| MongoDB | >= 6（本地或副本集均可） |

## 快速开始

```bash
git clone https://github.com/a162276220/node-weixin.git
cd node-weixin
npm install

cp .env.example .env    # 按需修改 MONGO_URI / SESSION_SECRET

npm run dev             # 开发：node --watch，改动自动重启
npm start               # 生产：node index.js
```

启动后访问 <http://localhost:8003>，健康检查 <http://localhost:8003/health>。

> 项目本身不读取 `.env` 文件，请用 `export $(cat .env | xargs)`、direnv、systemd `EnvironmentFile` 或 pm2 `--env` 注入环境变量。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8003` | 监听端口 |
| `NODE_ENV` | `development` | `production` 时强制要求 `SESSION_SECRET` 且 cookie 带 `Secure` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/weixin` | MongoDB 连接串 |
| `SESSION_SECRET` | 开发用占位值 | **生产必填**，未设置会直接启动失败 |
| `SESSION_MAX_AGE` | `604800000`（7 天） | 会话有效期，单位毫秒 |
| `CORS_ORIGINS` | 空 | 允许跨域的前端来源，逗号分隔；开发环境留空表示放行全部 |
| `ROBOT_ENDPOINT` | 阿里云市场问答接口 | 第三方问答地址 |
| `ROBOT_APPCODE` | 空 | 第三方接口凭据；未配置时 `/robot/question` 返回 503 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/user/login?username=xxx` | 登录（同时写 session）。**同名复用原身份**，新昵称才注册新账号 |
| GET | `/user/logout` | 退出登录，销毁服务端 session 并清除 cookie |
| GET | `/user/info[?user_id=n]` | 当前用户信息，优先取 session |
| GET | `/user/all?limit=20&offset=0` | 用户列表 |
| GET | `/chat/history?limit=20&offset=0` | 聊天记录，按 id 正序返回 |
| GET | `/robot/question?question=xxx` | 第三方问答转发 |

WebSocket 事件（socket.io）：

| 事件 | 方向 | 载荷 |
|---|---|---|
| `chat` | 客户端 → 服务端 | `{ user_id, content }`，content 超 100 字截断 |
| `chat` | 服务端 → 全部 | `{ id, username, avatar, user_id, time, content }` |
| `chat:error` | 服务端 → 发送方 | `{ message }` |

## 从 2017 旧版升级

旧版依赖 Babel 6 运行时转译（`index.js` 里 `require('babel-core/register')`），在 Node 18+ 上已无法运行。本次升级的要点：

- **去掉 Babel**：原生 ESM（`"type": "module"`），删除 `.babelrc` 与 7 个 babel 依赖
- **Express 4 → 5**、**mongoose 4 → 9**、**socket.io 2 → 4**、**connect-mongo 1 → 6**
- **config-lite → `config/index.js`**，全部配置走环境变量
- **node-fetch → 内置 fetch**（Node 18+ 自带，且 node-fetch 3 只支持 ESM）
- **time-formater → `utils/datetime.js`**（30 行以内的本地实现）
- **自增 ID 改原子操作**：原 `findOne → ++ → save` 并发必然重号，现改为 `findOneAndUpdate($inc)` + `upsert`
- **补回 package-lock.json**（2017 年曾被删除，导致依赖不可复现）

### 旧数据迁移

旧的 `ids` 集合（单文档 `{ user_id, chat_id }`）已被 `counters` 集合取代。首次升级时执行一次：

```bash
MONGO_URI=mongodb://127.0.0.1:27017/weixin npm run init:counters
```

脚本会读取旧文档并取最大值对齐计数器，重复执行安全。

### 内置网页客户端

`public/` 下是随仓库分发的网页客户端，**不需要任何构建步骤**（无 Vue/React 工程、无打包产物）：

| 文件 | 作用 |
|---|---|
| `public/index.html` | 页面结构（登录 + 聊天，纯文字流） |
| `public/app.css` | 样式：黑底、像素质点、柔和 ANSI 配色 |
| `public/app.js` | 逻辑：登录、socket 实时收发、历史分页、命令 |
| `public/assets/` | 可选：自托管的像素字体（缺失时回退 CDN） |

视觉参考 BBS 终端：纯黑背景 + 像素质点字体（[俐方体 11 号](https://github.com/ACh-K/Cubic-11)，SIL OFL 1.1，CSS 里以本地优先、jsDelivr 兜底的方式引入）+ 双栏 ASCII 字符画。字符画与点阵站名在 `app.js` 里以数组常量存放、渲染时按最大宽度 `padEnd` 对齐，改图案只需改数组。

功能：昵称登录/退出、群聊实时消息、历史分页（30 条/页 + 载入更早）、在线人数、按 `user_id` 区分自己与别人的消息。

终端习惯的命令与快捷键：

| 命令 | 作用 |
|---|---|
| `/help` | 列出命令 |
| `/who` | 列出在线成员 |
| `/clear` | 清空当前屏幕（不动服务端历史） |
| `/quit` | 退出登录 |

`Enter` 发送、`↑` `↓` 翻历史输入、`/` 快速聚焦输入框。

> 前端按 `user_id` 判定消息归属，因此服务端登录必须是「同名即同一身份」，否则重新登录会拿到新 id，导致自己的历史消息显示成别人的。

## 部署

```bash
npm run pm2:start      # pm2 start index.js --name node-weixin
npm run pm2:restart
npm run pm2:stop
```

`start.sh` / `stop.sh` 仍然可用，内部调用 `npm run pm2:start|pm2:stop`。

因为项目本身不读 `.env`，用 pm2 托管生产环境时需要一个加载器（否则拿不到 `SESSION_SECRET` 会启动失败）：

```bash
cat > run.sh <<'EOF'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
set -a
[ -f .env ] && . ./.env
set +a
exec node index.js
EOF
chmod +x run.sh
pm2 start run.sh --name node-weixin --interpreter bash
pm2 save && pm2 startup
```

> 用 `run.sh` 而不是 `pm2 start index.js` 的好处：密钥只存在 `.env`（`chmod 600`），不会落进 `~/.pm2/dump.pm2`。

## 许可

MIT
