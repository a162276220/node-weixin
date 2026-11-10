import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import history from 'connect-history-api-fallback';
import { Server } from 'socket.io';

import config from './config/index.js';
import { connectMongo } from './mongodb/db.js';
import routes from './routes/index.js';
import UserModel from './models/user.js';
import ChatModel from './models/chat.js';
import { nextChatId } from './models/id.js';
import { formatDateTime } from './utils/datetime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_CONTENT_LENGTH = 100;

/** CORS：默认只放行白名单；开发环境未配置白名单时放行全部。 */
function cors(req, res, next) {
	const origin = req.headers.origin;
	const allowed = config.allowAllOrigins || (origin && config.corsOrigins.includes(origin));
	if (origin && allowed) {
		res.header('Access-Control-Allow-Origin', origin);
		res.header('Access-Control-Allow-Credentials', 'true');
		res.header('Vary', 'Origin');
	}
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
	res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
	if (req.method === 'OPTIONS') {
		res.sendStatus(204);
		return;
	}
	next();
}

function createSessionMiddleware() {
	const store = MongoStore.create({
		mongoUrl: config.mongoUrl,
		collectionName: 'sessions',
		ttl: config.sessionMaxAge / 1000,
	});
	store.on('error', err => console.error('[session] store 异常:', err));
	return session({
		name: config.sessionName,
		secret: config.sessionSecret,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: config.isProd,
			maxAge: config.sessionMaxAge,
		},
		store,
	});
}

function attachSocket(server) {
	const io = new Server(server, {
		cors: {
			origin: config.allowAllOrigins ? true : config.corsOrigins,
			credentials: true,
		},
		// 兼容仍在使用 socket.io-client 2.x 的旧前端产物
		allowEIO3: true,
	});

	io.on('connection', socket => {
		socket.on('chat', async payload => {
			try {
				const user_id = Number(payload?.user_id);
				const content = String(payload?.content ?? '').trim().slice(0, MAX_CONTENT_LENGTH);
				if (!Number.isInteger(user_id) || user_id <= 0) throw new Error('用户ID参数错误');
				if (!content) throw new Error('发表对话信息错误');

				const user = await UserModel.findOne({ id: user_id }, 'name avatar').lean();
				if (!user) throw new Error('用户不存在');

				const chatObj = {
					id: await nextChatId(),
					username: user.name,
					avatar: user.avatar,
					user_id,
					time: formatDateTime(),
					content,
				};
				await ChatModel.create(chatObj);
				io.emit('chat', chatObj);
			} catch (err) {
				console.error('[socket] 聊天处理失败:', err.message);
				socket.emit('chat:error', { message: err.message });
			}
		});
	});

	return io;
}

export default async function bootstrap() {
	await connectMongo();

	const app = express();
	app.disable('x-powered-by');
	app.set('trust proxy', 1);

	app.use(cors);
	app.use(cookieParser());
	app.use(createSessionMiddleware());

	app.get('/health', (req, res) => {
		res.json({
			status: 'ok',
			env: config.env,
			uptime: Math.round(process.uptime()),
		});
	});

	routes(app);

	app.use(history());
	app.use(express.static(PUBLIC_DIR));

	const server = http.createServer(app);
	const io = attachSocket(server);

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(config.port, () => {
			server.off('error', reject);
			resolve();
		});
	});

	const shutdown = signal => {
		console.log(`[server] 收到 ${signal}，正在关闭...`);
		io.close();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 5000).unref();
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	return { app, server, io, port: config.port };
}
