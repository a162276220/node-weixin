import express from 'express';
import UserModel from '../models/user.js';
import { nextUserId } from '../models/id.js';

const router = express.Router();
const MAX_NAME_LENGTH = 20;
const AVATAR_COUNT = 20;

function toInt(value, fallback, max) {
	const num = Number.parseInt(value, 10);
	if (!Number.isFinite(num) || num < 0) return fallback;
	return Math.min(num, max);
}

router.get('/login', async (req, res) => {
	const username = String(req.query.username ?? '').trim().slice(0, MAX_NAME_LENGTH);
	if (!username) {
		res.send({ status: 0, message: '用户名不能为空' });
		return;
	}

	try {
		const id = await nextUserId();
		const avatar = `${Math.ceil(Math.random() * AVATAR_COUNT)}.jpg`;
		await UserModel.create({ name: username, id, avatar });
		req.session.user_id = id;
		res.send({
			status: 200,
			message: '注册成功',
			user_info: { name: username, id, avatar },
		});
	} catch (err) {
		console.error('[user] 注册失败:', err);
		res.send({ status: 0, message: '注册失败' });
	}
});

router.get('/info', async (req, res) => {
	const sessionUserId = req.session?.user_id;
	const queryUserId = Number(req.query.user_id);
	const user_id = sessionUserId || (Number.isFinite(queryUserId) ? queryUserId : null);

	if (!user_id) {
		res.send({ status: 0, message: '用户未登陆' });
		return;
	}

	try {
		const userData = await UserModel.findOne({ id: user_id }, '-_id').lean();
		if (!userData) {
			res.send({ status: 0, message: '未找到当前用户' });
			return;
		}
		res.send({ status: 200, user_info: userData });
	} catch (err) {
		console.error('[user] 获取用户信息失败:', err);
		res.send({ status: 0, message: '获取用户信息失败' });
	}
});

router.get('/all', async (req, res) => {
	const limit = Math.max(1, toInt(req.query.limit, 20, 100));
	const offset = toInt(req.query.offset, 0, 100000);
	try {
		const users = await UserModel.find({}, '-_id -__v')
			.sort({ id: 1 })
			.skip(offset)
			.limit(limit)
			.lean();
		res.send({ status: 200, users });
	} catch (err) {
		console.error('[user] 获取用户列表失败:', err);
		res.send({ type: 'ERROR_TO_GET_USER_LIST', message: '获取用户列表失败' });
	}
});

export default router;
