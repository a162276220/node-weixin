/**
 * 端到端冒烟测试：真实启动 server（子进程）+ 真实 MongoDB，跑通全部接口与 socket 事件。
 *
 * 用法：
 *   MONGO_URI=mongodb://127.0.0.1:27017/weixin_test npm test
 *
 * 未设置 MONGO_URI 时会退回 mongodb-memory-server（本地开发方便，CI 里用 service 容器即可）。
 */
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = Number(process.env.SMOKE_PORT) || 18003;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function check(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

async function resolveMongoUri() {
	if (process.env.MONGO_URI) {
		console.log('[smoke] 使用 MONGO_URI:', process.env.MONGO_URI.replace(/\/\/.*@/, '//***@'));
		return { uri: process.env.MONGO_URI, stop: async () => {} };
	}
	const { MongoMemoryServer } = await import('mongodb-memory-server');
	const mongod = await MongoMemoryServer.create();
	const uri = mongod.getUri('weixin_test');
	console.log('[smoke] 未提供 MONGO_URI，使用内存 MongoDB:', uri);
	return { uri, stop: () => mongod.stop() };
}

async function waitForHealth(timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) return await res.json();
		} catch {}
		await new Promise(r => setTimeout(r, 300));
	}
	throw new Error('服务未在预期时间内就绪');
}

async function main() {
	const mongo = await resolveMongoUri();

	const child = spawn(process.execPath, ['index.js'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			PORT: String(PORT),
			MONGO_URI: mongo.uri,
			NODE_ENV: process.env.NODE_ENV || 'test',
			SESSION_SECRET: process.env.SESSION_SECRET || 'smoke-test-secret',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const serverLog = [];
	child.stdout.on('data', d => serverLog.push(d.toString().trim()));
	child.stderr.on('data', d => serverLog.push('[err] ' + d.toString().trim()));

	try {
		const health = await waitForHealth();
		check('服务启动 /health', health.status === 'ok', JSON.stringify(health));

		const loginRes = await fetch(`${BASE}/user/login?username=${encodeURIComponent('胡萝卜')}`);
		const login = await loginRes.json();
		check('注册 /user/login', login.status === 200 && login.user_info.id >= 1, JSON.stringify(login));
		const cookie =
			loginRes.headers.getSetCookie?.().join('; ') || loginRes.headers.get('set-cookie') || '';

		const info = await (await fetch(`${BASE}/user/info`, { headers: { cookie } })).json();
		check(
			'会话 /user/info（靠 cookie）',
			info.status === 200 && info.user_info.name === '胡萝卜',
			JSON.stringify(info)
		);

		const empty = await (await fetch(`${BASE}/user/login?username=%20`)).json();
		check('空用户名被拒', empty.status === 0, JSON.stringify(empty));

		const second = await (await fetch(`${BASE}/user/login?username=second`)).json();
		check(
			'ID 自增不重复',
			second.user_info.id === login.user_info.id + 1,
			`first=${login.user_info.id} second=${second.user_info.id}`
		);

		const again = await (
			await fetch(`${BASE}/user/login?username=${encodeURIComponent('胡萝卜')}`)
		).json();
		check(
			'同名登录复用原身份',
			again.user_info.id === login.user_info.id &&
				again.user_info.avatar === login.user_info.avatar,
			`first=${login.user_info.id} again=${again.user_info.id}`
		);

		const all = await (await fetch(`${BASE}/user/all?limit=10&offset=0`)).json();
		check('用户列表 /user/all', all.status === 200 && all.users.length === 2, `count=${all.users?.length}`);

		const history0 = await (await fetch(`${BASE}/chat/history`)).json();
		check('聊天记录初始为空', history0.status === 200 && history0.history.length === 0, JSON.stringify(history0));

		const socket = io(BASE, { transports: ['websocket'], reconnection: false });
		await new Promise((resolve, reject) => {
			socket.on('connect', resolve);
			socket.on('connect_error', reject);
			setTimeout(() => reject(new Error('socket 连接超时')), 15000);
		});
		check('socket.io 连接', socket.connected === true, `id=${socket.id}`);

		const received = new Promise(resolve => socket.once('chat', resolve));
		socket.emit('chat', { user_id: login.user_info.id, content: '你好，世界' });
		const msg = await Promise.race([
			received,
			new Promise((_, r) => setTimeout(() => r(new Error('未收到广播')), 10000)),
		]);
		check(
			'发送并广播聊天',
			msg.content === '你好，世界' && msg.username === '胡萝卜' && msg.id === 1,
			JSON.stringify(msg)
		);

		const errEvent = new Promise(resolve => socket.once('chat:error', resolve));
		socket.emit('chat', { user_id: 9999, content: 'ghost' });
		const errMsg = await Promise.race([
			errEvent,
			new Promise((_, r) => setTimeout(() => r(new Error('无错误事件')), 10000)),
		]);
		check('不存在的用户被拒', /用户不存在/.test(errMsg.message), JSON.stringify(errMsg));

		const longMsg = new Promise(resolve => socket.once('chat', resolve));
		socket.emit('chat', { user_id: login.user_info.id, content: 'x'.repeat(200) });
		const truncated = await Promise.race([
			longMsg,
			new Promise((_, r) => setTimeout(() => r(new Error('未收到广播')), 10000)),
		]);
		check('内容截断到 100 字', truncated.content.length === 100, `len=${truncated.content.length}`);

		socket.close();

		const history1 = await (await fetch(`${BASE}/chat/history?limit=10`)).json();
		check('聊天记录落库', history1.status === 200 && history1.history.length === 2, `count=${history1.history?.length}`);
		check(
			'历史按时间正序',
			history1.history[0].id < history1.history[1].id,
			history1.history.map(h => h.id).join(',')
		);

		const robotRes = await fetch(`${BASE}/robot/question?question=hi`);
		check('未配 APPCODE 时 /robot 明确报错', robotRes.status === 503, `http=${robotRes.status}`);

		const preflight = await fetch(`${BASE}/user/all`, {
			method: 'OPTIONS',
			headers: { origin: 'http://localhost:8080', 'access-control-request-method': 'GET' },
		});
		check(
			'CORS 预检放行配置来源',
			preflight.status === 204 &&
				preflight.headers.get('access-control-allow-origin') === 'http://localhost:8080',
			`http=${preflight.status} acao=${preflight.headers.get('access-control-allow-origin')}`
		);

		const logout = await (await fetch(`${BASE}/user/logout`, { headers: { cookie } })).json();
		check('退出登录 /user/logout', logout.status === 200, JSON.stringify(logout));

		const afterLogout = await (await fetch(`${BASE}/user/info`, { headers: { cookie } })).json();
		check('退出后会话失效', afterLogout.status === 0, JSON.stringify(afterLogout));
	} finally {
		child.kill();
		await new Promise(r => setTimeout(r, 800));
		await mongo.stop();
		if (results.some(r => !r.ok)) {
			console.log('\n--- 服务端日志 ---\n' + serverLog.slice(-40).join('\n'));
		}
	}

	const failed = results.filter(r => !r.ok);
	console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
	if (failed.length) {
		console.log('失败项:', failed.map(f => f.name).join(' | '));
		process.exit(1);
	}
}

main().catch(err => {
	console.error('[smoke] 异常:', err);
	process.exit(1);
});
