import express from 'express';
import config from '../config/index.js';

const router = express.Router();

router.get('/question', async (req, res) => {
	const question = String(req.query.question ?? '').trim();

	if (!question) {
		res.send({ status: 0, message: '问题不能为空' });
		return;
	}
	if (!config.robotAppCode) {
		// 原实现把 APPCODE 硬编码在源码里，这里改为环境变量，缺失时直接说明
		res.status(503).send({ status: 0, message: '未配置 ROBOT_APPCODE，问答功能不可用' });
		return;
	}

	const url = `${config.robotEndpoint}?question=${encodeURIComponent(question)}`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `APPCODE ${config.robotAppCode}`,
				Accept: 'application/json',
			},
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			throw new Error(`上游返回 HTTP ${response.status}`);
		}

		const payload = await response.json();
		res.send({
			status: 200,
			content: payload?.result?.content ?? '',
		});
	} catch (err) {
		console.error('[robot] 获取问答数据失败:', err.message);
		res.send({ status: 0, message: '获取聊天数据失败' });
	}
});

export default router;
