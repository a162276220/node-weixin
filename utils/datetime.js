const pad = value => String(value).padStart(2, '0');

/** 替代已停止维护的 time-formater，输出 YYYY-MM-DD HH:mm:ss（本地时区）。 */
export function formatDateTime(date = new Date()) {
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}
