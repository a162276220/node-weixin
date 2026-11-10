import express from 'express';
import ChatModel from '../models/chat.js';

const router = express.Router();

function toInt(value, fallback, max) {
	const num = Number.parseInt(value, 10);
	if (!Number.isFinite(num) || num < 0) return fallback;
	return Math.min(num, max);
}

router.get('/history', async (req, res) => {
	const limit = Math.max(1, toInt(req.query.limit, 20, 100));
	const offset = toInt(req.query.offset, 0, 100000);

	try {
		const history = await ChatModel.find({}, '-_id')
			.sort({ id: -1 })
			.skip(offset)
			.limit(limit)
			.lean();
		res.send({ status: 200, history: history.reverse() });
	} catch (err) {
		console.error('[chat] 获取聊天记录失败:', err);
		res.send({ status: 0, message: '获取聊天记录失败' });
	}
});

export default router;
