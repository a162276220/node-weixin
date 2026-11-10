/**
 * CHAT · 复古终端版前端
 * 对接 node-weixin 后端：/user/login /user/logout /user/info /user/all /chat/history + socket.io 'chat'
 */
(() => {
	'use strict';

	const PAGE_SIZE = 30;
	const MAX_LEN = 100;

	/** ANSI 风格昵称色板（深色背景下可读） */
	const NICK_COLORS = [
		'#4fd6ff', '#8bd450', '#ffd75f', '#ff79c6', '#b48ead', '#66d9ef',
		'#f6a96b', '#a6e22e', '#ff9e64', '#7dcfff', '#e0b0ff', '#7ee787'
	];

	/** @type {{name:string,id:number,avatar:string}|null} */
	let me = null;
	let socket = null;
	let oldestOffset = 0;
	let hasMore = false;
	let loadingMore = false;
	let memberTimer = null;
	let clockTimer = null;
	const seenIds = new Set();
	const memberIds = new Set();
	const cmdHistory = [];
	let historyCursor = -1;

	/* ---------------- 基础工具 ---------------- */

	const $ = id => document.getElementById(id);

	const el = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	const pad = n => String(n).padStart(2, '0');
	const clockText = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

	function nickColor(id) {
		const key = String(id ?? '');
		let hash = 0;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
		return NICK_COLORS[hash % NICK_COLORS.length];
	}

	/** 后端时间串 "2026-11-10 15:12:05" → Date */
	function parseTime(value) {
		if (!value) return new Date();
		const date = new Date(String(value).replace(' ', 'T'));
		return Number.isNaN(date.getTime()) ? new Date() : date;
	}

	function dayLabel(date) {
		const today = new Date();
		const same = (a, b) =>
			a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		if (same(date, today)) return '今天';
		if (same(date, new Date(today.getTime() - 86400000))) return '昨天';
		return `${date.getMonth() + 1}月${date.getDate()}日`;
	}

	let toastTimer = null;
	function toast(message) {
		const node = $('toast');
		node.textContent = message;
		node.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
	}

	async function api(path) {
		const res = await fetch(path, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}

	/* ---------------- 站标（按宽度补齐，避免手写对齐） ---------------- */

	function buildBanner() {
		const W = 58;
		const art = [
			'',
			'   ██████╗██╗  ██╗ █████╗ ████████╗',
			'  ██╔════╝██║  ██║██╔══██╗╚══██╔══╝',
			'  ██║     ███████║███████║   ██║',
			'  ██║     ██╔══██║██╔══██║   ██║',
			'  ╚██████╗██║  ██║██║  ██║   ██║',
			'   ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝',
			'',
			'     m u l t i - u s e r   b u l l e t i n',
			'        b o a r d   s y s t e m   ·   2 0 2 6',
			''
		];

		const lines = ['╔' + '═'.repeat(W) + '╗'];
		art.forEach(line => lines.push('║' + line + ' '.repeat(Math.max(0, W - line.length)) + '║'));
		lines.push('╚' + '═'.repeat(W) + '╝');
		return lines.join('\n');
	}

	function renderBanner() {
		const node = $('login-banner');
		if (node) node.textContent = buildBanner();
	}

	/* ---------------- 视图切换 ---------------- */

	function showLogin() {
		$('chat-view').hidden = true;
		$('login-view').hidden = false;
		loadOnlineCount();
		$('login-name').focus();
	}

	function showChat() {
		$('login-view').hidden = true;
		$('chat-view').hidden = false;
	}

	/* ---------------- 登录页 ---------------- */

	async function loadOnlineCount() {
		try {
			const data = await api('/user/all?limit=100');
			const total = Array.isArray(data.users) ? data.users.length : 0;
			$('online-count').textContent = String(total);
		} catch {
			$('online-count').textContent = '--';
		}
	}

	async function checkHealth() {
		const label = $('login-status');
		try {
			const info = await api('/health');
			label.textContent = `在线 · 环境 ${info.env || 'unknown'}`;
			label.style.color = 'var(--ok)';
		} catch {
			label.textContent = '无法连接服务器，请稍后刷新';
			label.style.color = 'var(--err)';
		}
	}

	async function boot() {
		checkHealth();
		try {
			const info = await api('/user/info');
			if (info.status === 200 && info.user_info) {
				me = info.user_info;
				enterChat();
				return;
			}
		} catch {
			/* 未登录，落到登录页 */
		}
		showLogin();
	}

	async function doLogin(event) {
		event.preventDefault();
		const input = $('login-name');
		const error = $('login-error');
		const btn = $('login-btn');
		const username = input.value.trim();

		error.hidden = true;
		if (!username) {
			error.textContent = '代号不能为空';
			error.hidden = false;
			input.focus();
			return;
		}

		btn.disabled = true;
		btn.textContent = '[ 连接中 ]';
		try {
			const data = await api(`/user/login?username=${encodeURIComponent(username)}`);
			if (data.status !== 200 || !data.user_info) throw new Error(data.message || '登录失败');
			me = data.user_info;
			enterChat();
		} catch (err) {
			error.textContent = err.message || '登录失败，请重试';
			error.hidden = false;
		} finally {
			btn.disabled = false;
			btn.textContent = '[ 进入 ]';
		}
	}

	/* ---------------- 进入聊天 ---------------- */

	function enterChat() {
		showChat();
		$('me-tag').textContent = `代号: ${me.name}(#${me.id})`;
		$('composer-prompt').textContent = `${me.name}>`;

		const whoMe = $('who-me');
		if (whoMe) {
			whoMe.textContent = '';
			whoMe.appendChild(document.createTextNode(`代号: ${me.name}`));
			whoMe.appendChild(el('span', 'uid', ` (#${me.id})`));
		}

		connectSocket();
		loadMembers();
		loadHistory({ reset: true });
		startClock();
		syncHint();

		if (memberTimer) clearInterval(memberTimer);
		memberTimer = setInterval(() => {
			if (!document.hidden) loadMembers();
		}, 30000);

		$('input').focus();
	}

	function startClock() {
		const tick = () => { $('clock').textContent = clockText(new Date()); };
		tick();
		if (clockTimer) clearInterval(clockTimer);
		clockTimer = setInterval(tick, 20000);
	}

	function setConn(state, text) {
		const node = $('conn-status');
		node.dataset.state = state;
		node.textContent = text;
	}

	function connectSocket() {
		if (socket) socket.disconnect();
		socket = io({ transports: ['websocket', 'polling'] });

		socket.on('connect', () => {
			setConn('ok', '已连接');
			appendSystem('已连接到 CHAT，输入 /help 查看可用命令');
		});
		socket.on('disconnect', () => {
			setConn('bad', '已断开');
			appendSystem('连接已断开，正在尝试重连…', 'sys-warn');
		});
		socket.on('connect_error', () => setConn('bad', '连接失败'));
		socket.io.on('reconnect_attempt', () => setConn('connecting', '重连中'));

		socket.on('chat', message => {
			if (!message) return;
			if (message.id !== undefined && seenIds.has(message.id)) return;
			if (message.id !== undefined) seenIds.add(message.id);
			appendMessage(message, true);
			if (message.user_id !== undefined && !memberIds.has(message.user_id)) loadMembers();
		});
	}

	/* ---------------- 成员 ---------------- */

	async function loadMembers() {
		try {
			const data = await api('/user/all?limit=100');
			renderMembers(Array.isArray(data.users) ? data.users : []);
		} catch {
			renderMembers([]);
		}
	}

	function renderMembers(users) {
		const list = $('member-list');
		list.textContent = '';
		$('member-count').textContent = String(users.length);

		memberIds.clear();
		users.forEach(user => memberIds.add(user.id));

		if (!users.length) {
			list.appendChild(el('li', 'member dim', '（空）'));
			return;
		}

		users
			.slice()
			.sort((a, b) => a.id - b.id)
			.forEach(user => {
				const isSelf = me && user.id === me.id;
				const item = el('li', `member${isSelf ? ' member-self' : ''}`);
				item.appendChild(el('span', 'marker', '▸ '));
				item.appendChild(el('span', 'name', user.name || '匿名'));
				item.appendChild(el('span', 'uid', ` (#${user.id})`));
				if (isSelf) item.appendChild(document.createTextNode(' *'));
				if (!isSelf) item.style.color = nickColor(user.id);
				list.appendChild(item);
			});
	}

	/* ---------------- 消息渲染 ---------------- */

	function stream() {
		return $('messages');
	}

	function clearStream() {
		stream().textContent = '';
	}

	function appendSystem(text, cls = '') {
		const row = el('div', `sys ${cls}`.trim(), text);
		stream().appendChild(row);
		scrollToBottom();
		return row;
	}

	function appendDivider(text) {
		const row = el('div', 'stream-divider', text);
		stream().appendChild(row);
	}

	function lastMessageTs() {
		const nodes = stream().querySelectorAll('.msg');
		if (!nodes.length) return null;
		const value = nodes[nodes.length - 1].dataset.ts;
		return value ? new Date(value) : null;
	}

	function appendMessage(message, animate = false, position = 'append') {
		const box = stream();
		const empty = box.querySelector('.sys-empty');
		if (empty) empty.remove();

		const date = parseTime(message.time);
		const isSelf = me && message.user_id === me.id;

		const row = el('div', `msg${isSelf ? ' msg-self' : ''}`);
		row.dataset.ts = date.toISOString();

		row.appendChild(el('span', 'ts', `[${clockText(date)}] `));

		const nick = el('span', 'nick', message.username || '匿名');
		if (!isSelf) nick.style.color = nickColor(message.user_id);
		row.appendChild(nick);
		row.appendChild(document.createTextNode(' '));
		row.appendChild(el('span', 'text', message.content ?? ''));

		if (!animate) row.style.animation = 'none';

		if (position === 'prepend') {
			const first = box.querySelector('.msg');
			if (first && first !== row) box.insertBefore(row, first);
			else box.appendChild(row);
			return;
		}

		const prevTs = lastMessageTs();
		if (!prevTs || date - prevTs > 5 * 60 * 1000) {
			appendDivider(`── ${dayLabel(date)} ${clockText(date)} ──`);
		}

		box.appendChild(row);

		if (animate) {
			const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
			if (nearBottom || isSelf) scrollToBottom();
		}
	}

	function scrollToBottom() {
		const box = stream();
		box.scrollTop = box.scrollHeight;
	}

	/* ---------------- 历史记录 ---------------- */

	async function loadHistory({ reset = false } = {}) {
		if (loadingMore) return;
		loadingMore = true;

		const box = stream();
		const offset = reset ? 0 : oldestOffset;

		try {
			const data = await api(`/chat/history?limit=${PAGE_SIZE}&offset=${offset}`);
			const history = Array.isArray(data.history) ? data.history : [];

			if (reset) {
				box.textContent = '';
				seenIds.clear();
				oldestOffset = 0;
			}

			const beforeHeight = box.scrollHeight;

			history.forEach(message => {
				if (message.id !== undefined) {
					if (seenIds.has(message.id)) return;
					seenIds.add(message.id);
				}
				appendMessage(message, false, reset ? 'append' : 'prepend');
			});

			oldestOffset = offset + history.length;
			hasMore = history.length === PAGE_SIZE;
			renderLoadMore();

			if (reset) {
				if (!history.length) {
					box.appendChild(el('div', 'sys sys-empty', '这里还很安静，说点什么吧 :)'));
				}
				scrollToBottom();
			} else if (history.length) {
				box.scrollTop += box.scrollHeight - beforeHeight;
			}
		} catch {
			if (reset) {
				box.textContent = '';
				box.appendChild(el('div', 'sys sys-err', '聊天记录载入失败，按 Tab 或点击右上刷新'));
			}
		} finally {
			loadingMore = false;
			const loading = $('msg-loading');
			if (loading) loading.remove();
		}
	}

	function renderLoadMore() {
		const box = stream();
		const existing = box.querySelector('.load-more');
		if (existing) existing.remove();
		if (!hasMore) return;

		const btn = el('button', 'load-more', '[ 载入更早消息 ]');
		btn.type = 'button';
		btn.addEventListener('click', () => {
			btn.textContent = '[ 载入中… ]';
			loadHistory({ reset: false });
		});
		box.prepend(btn);
	}

	/* ---------------- 命令 ---------------- */

	const COMMANDS = {
		'/help': {
			desc: '显示命令列表',
			run: () => {
				appendSystem('可用命令：');
				Object.entries(COMMANDS).forEach(([name, cmd]) => {
					appendSystem(`  ${name.padEnd(8, ' ')}${cmd.desc}`);
				});
				appendSystem('快捷键：↑↓ 翻历史输入 · Tab 开关成员列表 · Enter 发送');
			}
		},
		'/who': {
			desc: '列出在线成员',
			run: () => {
				const names = [...$('member-list').querySelectorAll('.member')].map(
					node => node.textContent.trim()
				);
				appendSystem(`在线 ${names.length} 人：${names.join('  ') || '（空）'}`);
			}
		},
		'/clear': {
			desc: '清空当前屏幕',
			run: () => {
				clearStream();
				appendSystem('屏幕已清空，历史消息仍保存在服务端（刷新可重新载入）');
			}
		},
		'/quit': {
			desc: '退出登录',
			run: () => logout()
		}
	};

	function runCommand(raw) {
		const name = raw.split(/\s+/)[0].toLowerCase();
		const cmd = COMMANDS[name];

		if (!cmd) {
			appendSystem(`未知命令：${name}（输入 /help 查看可用命令）`, 'sys-err');
			return;
		}
		cmd.run();
	}

	/* ---------------- 发送 ---------------- */

	function updateComposerState() {
		const input = $('input');
		const value = input.value;
		$('counter').textContent = `${value.length}/${MAX_LEN}`;
		$('counter').dataset.warn = value.length >= MAX_LEN ? '1' : '0';
		$('send-btn').disabled = value.trim().length === 0;

		input.style.height = 'auto';
		input.style.height = Math.min(input.scrollHeight, 108) + 'px';
	}

	function send() {
		const input = $('input');
		const content = input.value.trim();
		if (!content) return;

		input.value = '';
		updateComposerState();
		input.focus();

		if (content.startsWith('/')) {
			cmdHistory.push(content);
			historyCursor = cmdHistory.length;
			runCommand(content);
			return;
		}

		if (!socket || !socket.connected) {
			appendSystem('发送失败：连接已断开，正在重连…', 'sys-err');
			return;
		}

		cmdHistory.push(content);
		historyCursor = cmdHistory.length;
		socket.emit('chat', { user_id: me.id, content: content.slice(0, MAX_LEN) });
	}

	function browseHistory(direction) {
		if (!cmdHistory.length) return;
		const input = $('input');

		historyCursor += direction;
		if (historyCursor < 0) historyCursor = 0;
		if (historyCursor > cmdHistory.length) historyCursor = cmdHistory.length;

		input.value = cmdHistory[historyCursor] || '';
		updateComposerState();
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}

	/* ---------------- 退出 / 抽屉 ---------------- */

	async function logout() {
		if (socket) socket.disconnect();
		if (memberTimer) clearInterval(memberTimer);
		if (clockTimer) clearInterval(clockTimer);
		try {
			await api('/user/logout');
		} catch {
			/* 网络异常也回登录页 */
		}
		location.reload();
	}

	function toggleDrawer(open) {
		const sidebar = $('sidebar');
		const mask = $('drawer-mask');
		const next = open === undefined ? !sidebar.classList.contains('open') : open;
		sidebar.classList.toggle('open', next);
		mask.hidden = !next;
	}

	/* ---------------- 提示文案随屏幕宽度变化 ---------------- */

	function syncHint() {
		const narrow = window.matchMedia('(max-width: 760px)').matches;
		const input = $('input');
		input.placeholder = narrow ? '说点什么…' : '说点什么…（Enter 发送，Shift+Enter 换行）';
		const hint = document.querySelector('.bar-bottom span');
		if (hint) {
			hint.textContent = narrow
				? 'Tab 成员 · Enter 发送 · /help 命令'
				: 'Enter 发送 · Shift+Enter 换行 · ↑↓ 历史 · /help 命令 · Tab 成员';
		}
	}

	/* ---------------- 事件绑定 ---------------- */

	$('login-form').addEventListener('submit', doLogin);
	$('logout-btn').addEventListener('click', logout);
	$('send-btn').addEventListener('click', send);
	$('drawer-btn').addEventListener('click', () => toggleDrawer());
	$('drawer-mask').addEventListener('click', () => toggleDrawer(false));

	const input = $('input');
	input.addEventListener('input', updateComposerState);

	input.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
			return;
		}
		if (event.key === 'ArrowUp' && !event.shiftKey) {
			event.preventDefault();
			browseHistory(-1);
			return;
		}
		if (event.key === 'ArrowDown' && !event.shiftKey) {
			event.preventDefault();
			browseHistory(1);
			return;
		}
		if (event.key === 'Tab') {
			if (window.matchMedia('(max-width: 760px)').matches) {
				event.preventDefault();
				toggleDrawer();
			}
		}
	});

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') toggleDrawer(false);
	});

	window.addEventListener('resize', syncHint);

	updateComposerState();
	renderBanner();
	boot();
})();
