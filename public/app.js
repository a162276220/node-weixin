/**
 * 多人在线聊天室前端
 * 对接 node-weixin 后端：/user/login /user/info /user/all /chat/history + socket.io 'chat'
 */
(() => {
	'use strict';

	const PAGE_SIZE = 30;
	const MAX_LEN = 100;

	/** @type {{name:string,id:number,avatar:string}|null} */
	let me = null;
	let socket = null;
	let oldestOffset = 0;
	let hasMore = false;
	let loadingMore = false;
	let memberTimer = null;
	const seenIds = new Set();
	const memberIds = new Set();

	/* ---------------- 工具 ---------------- */

	const $ = id => document.getElementById(id);

	const el = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	const AVATAR_COLORS = [
		'#5b8ff9', '#61ddaa', '#65789b', '#f6bd16', '#7262fd', '#78d3f8',
		'#9661bc', '#f6903d', '#008685', '#f08bb4', '#3d7eff', '#e8684a'
	];

	function avatarColor(seed) {
		const key = String(seed ?? '');
		let hash = 0;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
		return AVATAR_COLORS[hash % AVATAR_COLORS.length];
	}

	function initial(name) {
		const text = String(name ?? '').trim();
		return text ? text.slice(0, 1).toUpperCase() : '?';
	}

	/** 把后端 "2026-11-10 15:12:05" 解析成 Date（兼容 iOS） */
	function parseTime(value) {
		if (!value) return new Date();
		const normalized = String(value).replace(' ', 'T');
		const date = new Date(normalized);
		return Number.isNaN(date.getTime()) ? new Date() : date;
	}

	const pad = n => String(n).padStart(2, '0');

	function clockText(date) {
		return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function dayText(date) {
		const today = new Date();
		const sameDay = (a, b) =>
			a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		if (sameDay(date, today)) return '今天';
		const yesterday = new Date(today.getTime() - 86400000);
		if (sameDay(date, yesterday)) return '昨天';
		return `${date.getMonth() + 1}月${date.getDate()}日`;
	}

	let toastTimer = null;
	function toast(message) {
		const node = $('toast');
		node.textContent = message;
		node.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { node.hidden = true; }, 2400);
	}

	function makeAvatar(user, size = '') {
		const node = el('div', `avatar${size ? ' ' + size : ''}`, initial(user?.name));
		node.style.background = `linear-gradient(150deg, ${avatarColor(user?.id ?? user?.name)}, ${avatarColor(
			(user?.name ?? '') + 'x'
		)})`;
		return node;
	}

	function paintAvatar(node, user) {
		node.textContent = initial(user?.name);
		node.style.background = `linear-gradient(150deg, ${avatarColor(user?.id ?? user?.name)}, ${avatarColor(
			(user?.name ?? '') + 'x'
		)})`;
	}

	/* ---------------- 请求 ---------------- */

	async function api(path) {
		const res = await fetch(path, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}

	/* ---------------- 视图切换 ---------------- */

	function showLogin() {
		$('chat-view').hidden = true;
		$('login-view').hidden = false;
		$('login-name').focus();
	}

	function showChat() {
		$('login-view').hidden = true;
		$('chat-view').hidden = false;
	}

	/* ---------------- 登录 ---------------- */

	async function checkHealth() {
		const dot = $('login-dot');
		const label = $('login-status');
		try {
			const info = await api('/health');
			dot.dataset.state = 'ok';
			label.textContent = `服务正常 · ${info.env || 'unknown'}`;
		} catch {
			dot.dataset.state = 'bad';
			label.textContent = '无法连接服务，请刷新重试';
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
			/* 未登录或网络问题，落到登录页 */
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
			error.textContent = '请先输入昵称';
			error.hidden = false;
			input.focus();
			return;
		}

		btn.disabled = true;
		btn.textContent = '正在进入…';
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
			btn.textContent = '进入聊天室';
		}
	}

	/* ---------------- 聊天 ---------------- */

	function enterChat() {
		showChat();
		paintAvatar($('me-avatar'), me);
		$('me-name').textContent = me.name;
		$('me-id').textContent = `ID #${me.id}`;

		connectSocket();
		loadMembers();
		loadHistory({ reset: true });

		// 成员列表准实时：新面孔发言立即补拉，另有 30s 兜底轮询
		if (memberTimer) clearInterval(memberTimer);
		memberTimer = setInterval(() => {
			if (!document.hidden) loadMembers();
		}, 30000);

		$('input').focus();
	}

	function setConn(state, text) {
		const node = $('conn-status');
		node.dataset.state = state;
		node.textContent = text;
	}

	function connectSocket() {
		if (socket) socket.disconnect();
		socket = io({ transports: ['websocket', 'polling'] });

		socket.on('connect', () => setConn('ok', '已连接'));
		socket.on('disconnect', () => setConn('bad', '已断开'));
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

	async function loadMembers() {
		try {
			const data = await api('/user/all?limit=100');
			const users = Array.isArray(data.users) ? data.users : [];
			renderMembers(users);
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
			const empty = el('li', 'msg-empty', '暂无成员');
			empty.style.fontSize = '12px';
			list.appendChild(empty);
			return;
		}

		users
			.slice()
			.sort((a, b) => a.id - b.id)
			.forEach(user => {
				const isSelf = me && user.id === me.id;
				const item = el('li', `member${isSelf ? ' member-self' : ''}`);
				item.appendChild(makeAvatar(user, 'avatar-sm'));
				item.appendChild(el('span', 'member-name', user.name || '匿名'));
				if (isSelf) item.appendChild(el('span', 'member-tag', '我'));
				list.appendChild(item);
			});
	}

	async function loadHistory({ reset = false } = {}) {
		if (loadingMore) return;
		loadingMore = true;

		const box = $('messages');
		const offset = reset ? 0 : oldestOffset;

		try {
			const data = await api(`/chat/history?limit=${PAGE_SIZE}&offset=${offset}`);
			const history = Array.isArray(data.history) ? data.history : [];

			if (reset) {
				box.textContent = '';
				seenIds.clear();
				oldestOffset = 0;
			}

			const anchorHeight = box.scrollHeight;
			const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

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
					const empty = el('div', 'msg-empty', '还没有人说话，来打个招呼吧');
					box.appendChild(empty);
				}
				scrollToBottom();
			} else if (!nearBottom) {
				box.scrollTop += box.scrollHeight - anchorHeight;
			}
		} catch {
			if (reset) {
				box.textContent = '';
				box.appendChild(el('div', 'msg-empty', '消息加载失败，点击右上角刷新'));
			}
		} finally {
			loadingMore = false;
			const loading = $('msg-loading');
			if (loading) loading.remove();
		}
	}

	function renderLoadMore() {
		const box = $('messages');
		const existing = box.querySelector('.msg-load-more');
		if (existing) existing.remove();
		if (!hasMore) return;

		const btn = el('button', 'msg-load-more', '加载更早的消息');
		btn.type = 'button';
		btn.addEventListener('click', () => {
			btn.textContent = '加载中…';
			loadHistory({ reset: false });
		});
		box.prepend(btn);
	}

	function appendMessage(message, animate = false, position = 'append') {
		const box = $('messages');
		const empty = box.querySelector('.msg-empty');
		if (empty) empty.remove();

		const date = parseTime(message.time);
		const prev = position === 'append' ? lastMessageNode() : null;
		const gap = prev ? date - new Date(prev.dataset.ts) : Infinity;

		if (position === 'append' && (!prev || gap > 5 * 60 * 1000)) {
			box.appendChild(el('div', 'msg-day', dayText(date) + ' ' + clockText(date)));
		}

		const isSelf = me && message.user_id === me.id;
		const row = el('div', `msg${isSelf ? ' self' : ''}`);
		row.dataset.ts = date.toISOString();

		row.appendChild(makeAvatar({ name: message.username, id: message.user_id }));

		const body = el('div', 'msg-body');
		if (!isSelf) body.appendChild(el('p', 'msg-name', message.username || '匿名'));
		const bubble = el('div', 'bubble', message.content ?? '');
		body.appendChild(bubble);
		row.appendChild(body);

		if (!animate) row.style.animation = 'none';

		if (position === 'prepend') {
			const firstMsg = box.querySelector('.msg');
			if (firstMsg && firstMsg !== row) box.insertBefore(row, firstMsg);
			else box.appendChild(row);
		} else {
			box.appendChild(row);
			if (animate) {
				const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
				if (nearBottom || isSelf) scrollToBottom();
			}
		}
	}

	function lastMessageNode() {
		const nodes = $('messages').querySelectorAll('.msg');
		return nodes.length ? nodes[nodes.length - 1] : null;
	}

	function scrollToBottom() {
		const box = $('messages');
		box.scrollTop = box.scrollHeight;
	}

	/* ---------------- 发送 ---------------- */

	function updateComposerState() {
		const input = $('input');
		const value = input.value;
		$('counter').textContent = `${value.length}/${MAX_LEN}`;
		$('counter').dataset.warn = value.length >= MAX_LEN ? '1' : '0';
		$('send-btn').disabled = value.trim().length === 0;

		input.style.height = 'auto';
		input.style.height = Math.min(input.scrollHeight, 120) + 'px';
	}

	function send() {
		const input = $('input');
		const content = input.value.trim();
		if (!content) return;
		if (!socket || !socket.connected) {
			toast('连接已断开，正在重连…');
			return;
		}

		socket.emit('chat', { user_id: me.id, content: content.slice(0, MAX_LEN) });
		input.value = '';
		updateComposerState();
		input.focus();
	}

	/* ---------------- 退出 / 抽屉 ---------------- */

	async function logout() {
		if (socket) socket.disconnect();
		if (memberTimer) clearInterval(memberTimer);
		try {
			await api('/user/logout');
		} catch {
			/* 网络异常时也回到登录页 */
		}
		location.reload();
	}

	function toggleDrawer(open) {
		const sidebar = $('sidebar');
		const mask = $('drawer-mask');
		sidebar.classList.toggle('open', open);
		mask.hidden = !open;
	}

	/* ---------------- 事件绑定 ---------------- */

	$('login-form').addEventListener('submit', doLogin);
	$('refresh-btn').addEventListener('click', () => {
		loadMembers();
		loadHistory({ reset: true });
		toast('已刷新');
	});
	$('logout-btn').addEventListener('click', logout);
	$('drawer-btn').addEventListener('click', () => toggleDrawer(true));
	$('drawer-mask').addEventListener('click', () => toggleDrawer(false));
	$('send-btn').addEventListener('click', send);

	const input = $('input');
	input.addEventListener('input', updateComposerState);

	// 移动端不展示按键提示，避免占位文字被截断
	function syncPlaceholder() {
		const narrow = window.matchMedia('(max-width: 760px)').matches;
		input.placeholder = narrow ? '说点什么…' : '说点什么…（Enter 发送，Shift+Enter 换行）';
	}
	syncPlaceholder();
	window.addEventListener('resize', syncPlaceholder);
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
		}
	});

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') toggleDrawer(false);
	});

	updateComposerState();
	boot();
})();
