/**
 * CHAT · BBS 终端风前端
 * 后端接口：/user/login /user/logout /user/info /user/all /chat/history + socket.io 'chat'
 */
(() => {
	'use strict';

	const PAGE_SIZE = 30;
	const MAX_LEN = 100;
	const NICK_COLORS = ['#6ab8c0', '#6ee7b7', '#e2c97e', '#e47474', '#a5b4fc', '#f0abfc', '#7dd3fc', '#86efac', '#fdba74', '#c4b5fd'];

	/** 站标：由脚本生成后粘贴，渲染时按最大宽度右侧补齐 */
	const ART_FACE = ["   =++++++++++++++++++++++++++++++++++=", " =%*==================================*%=", " %% :##: *%* :##:                      %%", " %# :**: =*= :**:                      #%", " %%::::::::::::::::::::::::::::::::::::%%", " %#.::::.:::.::::......................#%", " %#                                    #%", " %#                                    #%", " %#          ::.           ::          #%", " %#        +%@@@%+      -#@@@%*:       #%", " %#       #@@@@@@@*    -@@@@@@@@       #%", " %#       #@@@@@@@+    -@@@@@@@%       #%", " %#        +%@@@%=      -#@@@%*:       #%", " %#           :            ::          #%", " %#                                    #%", " %#                                    #%", " %#                                    #%", " %#          :#:           *=          #%", " %#           +##+=-::--+##*.          #%", " %#             :=+****+=-             #%", " %#                                    #%", " %#                                    #%", " %#                                    #%", " %#                                    #%", " %#                                    #%", " %#  :::::::::::::::.                  #%", " %#                                    #%", " %#                                    #%", " %% ::.:: ::.:-  -.:-                  #%", " %% -:  = --  = :-  =                  #%", " %#                                    #%", " %%                                    %%", " =%*==================================*%=", "   =++++++++++++++++++++++++++++++++++="];
	const ART_WORD = ["  ######    ##      ##      ##      ##########", "  ######    ##      ##      ##      ##########", "##          ##      ##    ##  ##        ##", "##          ##      ##    ##  ##        ##", "##          ##########  ##########      ##", "##          ##########  ##########      ##", "##          ##      ##  ##      ##      ##", "##          ##      ##  ##      ##      ##", "  ######    ##      ##  ##      ##      ##", "  ######    ##      ##  ##      ##      ##"];

	let me = null;
	let socket = null;
	let oldestOffset = 0;
	let hasMore = false;
	let loadingMore = false;
	let memberTimer = null;
	const seenIds = new Set();
	const memberIds = new Set();
	const memberNames = new Map();
	const cmdHistory = [];
	let historyCursor = -1;

	const $ = id => document.getElementById(id);

	const el = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	const pad2 = n => String(n).padStart(2, '0');
	const clockText = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

	function nickColor(id) {
		const key = String(id ?? '');
		let hash = 0;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
		return NICK_COLORS[hash % NICK_COLORS.length];
	}

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
		toastTimer = setTimeout(() => { node.hidden = true; }, 2000);
	}

	async function api(path) {
		const res = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}

	/* ---------- 站标 ---------- */

	function renderArt() {
		const face = $('art-face');
		const wordNode = $('art-word');
		if (face) {
			const w = Math.max(...ART_FACE.map(l => l.length));
			face.textContent = ART_FACE.map(l => l.padEnd(w)).join('\n');
		}
		if (wordNode) {
			const w = Math.max(...ART_WORD.map(l => l.length));
			wordNode.textContent = ART_WORD.map(l => l.padEnd(w)).join('\n');
		}
	}

	/* ---------- 视图 ---------- */

	function setStatus(text) {
		const node = $('status-line');
		if (node) node.textContent = text;
	}

	function showLogin() {
		$('chat-view').hidden = true;
		$('login-form').hidden = false;
		loadOnlineCount();
		$('login-name').focus();
	}

	function showChat() {
		$('login-form').hidden = true;
		$('chat-view').hidden = false;
	}

	async function loadOnlineCount() {
		try {
			const data = await api('/user/all?limit=100');
			syncMembers(Array.isArray(data.users) ? data.users : []);
		} catch { /* 忽略 */ }
	}

	function syncMembers(users) {
		$('online-count').textContent = String(users.length);
		memberIds.clear();
		memberNames.clear();
		users.forEach(user => {
			memberIds.add(user.id);
			memberNames.set(user.id, user.name);
		});
	}

	async function checkStatus() {
		try {
			const info = await api('/health');
			setStatus(`服务正常 · 环境 ${info.env || 'unknown'}`);
		} catch {
			setStatus('无法连接服务器，请稍后刷新');
		}
	}

	async function boot() {
		checkStatus();
		try {
			const info = await api('/user/info');
			if (info.status === 200 && info.user_info) {
				me = info.user_info;
				enterChat();
				return;
			}
		} catch { /* 未登录 */ }
		showLogin();
	}

	async function doLogin(event) {
		event.preventDefault();
		const input = $('login-name');
		const error = $('login-error');
		const username = input.value.trim();

		error.hidden = true;
		if (!username) {
			error.textContent = '代号不能为空';
			error.hidden = false;
			input.focus();
			return;
		}

		try {
			const data = await api(`/user/login?username=${encodeURIComponent(username)}`);
			if (data.status !== 200 || !data.user_info) throw new Error(data.message || '登录失败');
			me = data.user_info;
			enterChat();
		} catch (err) {
			error.textContent = err.message || '登录失败，请重试';
			error.hidden = false;
		}
	}

	/* ---------- 进入聊天 ---------- */

	function enterChat() {
		showChat();
		renderArt();
		loadOnlineCount();
		$('composer-prompt').textContent = `${me.name}#${me.id} $`;
		setStatus(`已登录 · 代号 ${me.name}#${me.id}`);
		connectSocket();
		loadHistory({ reset: true });

		if (memberTimer) clearInterval(memberTimer);
		memberTimer = setInterval(() => {
			if (!document.hidden) loadOnlineCount();
		}, 30000);

		$('input').focus();
	}

	function connectSocket() {
		if (socket) socket.disconnect();
		socket = io({ transports: ['websocket', 'polling'] });

		socket.on('connect', () => {
			setStatus(`已登录 · 代号 ${me.name}#${me.id} · 在线 ${memberIds.size} 人`);
			appendSystem(`Hi ${me.name}#${me.id}，欢迎加入 CHAT 聊天室！输入 /help 查看可用命令`);
		});
		socket.on('disconnect', () => {
			setStatus('连接已断开，正在重连…');
			appendSystem('连接已断开，正在尝试重连…', 'warn');
		});
		socket.on('connect_error', () => setStatus('连接失败，正在重试…'));

		socket.on('chat', message => {
			if (!message) return;
			if (message.id !== undefined && seenIds.has(message.id)) return;
			if (message.id !== undefined) seenIds.add(message.id);
			appendMessage(message, true);
			if (message.user_id !== undefined && !memberIds.has(message.user_id)) loadOnlineCount();
		});
	}

	/* ---------- 消息流 ---------- */

	function stream() {
		return $('messages');
	}

	function appendSystem(text, cls = '') {
		stream().appendChild(el('p', `sys ${cls}`.trim(), text));
		scrollToBottom();
	}

	function lastMessageTs() {
		const nodes = stream().querySelectorAll('.msg');
		if (!nodes.length) return null;
		const value = nodes[nodes.length - 1].dataset.ts;
		return value ? new Date(value) : null;
	}

	function appendMessage(message, animate = false, position = 'append') {
		const box = stream();
		const date = parseTime(message.time);
		const isSelf = me && message.user_id === me.id;

		const row = el('p', `msg${isSelf ? ' self' : ''}`);
		row.dataset.ts = date.toISOString();
		row.appendChild(el('span', 't', `[${clockText(date)}] `));

		const nick = el('span', 'n', `${message.username || '匿名'}> `);
		if (!isSelf) nick.style.color = nickColor(message.user_id);
		row.appendChild(nick);
		row.appendChild(el('span', 'c', message.content ?? ''));

		if (position === 'prepend') {
			const first = box.querySelector('.msg');
			if (first && first !== row) box.insertBefore(row, first);
			else box.appendChild(row);
			return;
		}

		const prevTs = lastMessageTs();
		if (!prevTs || date - prevTs > 5 * 60 * 1000) {
			box.appendChild(el('p', 'msg-day', `── ${dayLabel(date)} ${clockText(date)} ──`));
		}

		box.appendChild(row);

		if (animate) {
			const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 200;
			if (nearBottom || isSelf) scrollToBottom();
		}
	}

	function scrollToBottom() {
		const box = $('scroll');
		if (box) box.scrollTop = box.scrollHeight;
	}

	/* ---------- 历史 ---------- */

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

			const scroll = $('scroll');
			const before = scroll.scrollHeight;

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
				if (!history.length) box.appendChild(el('p', 'sys', '这里还很安静，说点什么吧 :)'));
				scrollToBottom();
			} else if (history.length) {
				scroll.scrollTop += scroll.scrollHeight - before;
			}
		} catch {
			if (reset) {
				box.textContent = '';
				box.appendChild(el('p', 'sys err', '聊天记录载入失败，刷新页面重试'));
			}
		} finally {
			loadingMore = false;
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

	/* ---------- 命令 ---------- */

	const COMMANDS = {
		'/help': {
			desc: '显示命令列表',
			run: () => {
				appendSystem('可用命令：');
				Object.entries(COMMANDS).forEach(([name, cmd]) => {
					appendSystem(`  ${name.padEnd(8, ' ')}${cmd.desc}`);
				});
				appendSystem('快捷键：↑↓ 翻历史输入 · Enter 发送');
			}
		},
		'/who': {
			desc: '列出在线成员',
			run: () => {
				const names = [...memberNames.entries()]
					.sort((a, b) => a[0] - b[0])
					.map(([id, name]) => `${name}#${id}`);
				appendSystem(`在线 ${names.length} 人：${names.join('  ') || '（空）'}`);
			}
		},
		'/clear': {
			desc: '清空当前屏幕',
			run: () => {
				stream().textContent = '';
				appendSystem('屏幕已清空，历史消息仍保存在服务端（刷新可重新载入）');
			}
		},
		'/quit': { desc: '退出登录', run: () => logout() }
	};

	function runCommand(raw) {
		const name = raw.split(/\s+/)[0].toLowerCase();
		const cmd = COMMANDS[name];
		if (!cmd) {
			appendSystem(`未知命令：${name}（输入 /help 查看可用命令）`, 'err');
			return;
		}
		cmd.run();
	}

	/* ---------- 发送 ---------- */

	function send() {
		const input = $('input');
		const content = input.value.trim();
		if (!content) return;

		input.value = '';
		input.focus();

		if (content.startsWith('/')) {
			cmdHistory.push(content);
			historyCursor = cmdHistory.length;
			runCommand(content);
			return;
		}

		if (!socket || !socket.connected) {
			appendSystem('发送失败：连接已断开，正在重连…', 'err');
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
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}

	/* ---------- 退出 ---------- */

	async function logout() {
		if (socket) socket.disconnect();
		if (memberTimer) clearInterval(memberTimer);
		try {
			await api('/user/logout');
		} catch { /* 网络异常也回登录页 */ }
		location.reload();
	}

	/* ---------- 事件 ---------- */

	$('login-form').addEventListener('submit', doLogin);

	const input = $('input');
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			send();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			browseHistory(-1);
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			browseHistory(1);
		}
	});

	document.addEventListener('keydown', event => {
		if (event.key === '/' && document.activeElement !== input && !$('chat-view').hidden) {
			event.preventDefault();
			input.focus();
		}
	});

	boot();
})();
