/**
 * 把旧版 `ids` 集合（{ user_id, chat_id } 单文档）迁移到新的 `counters` 集合。
 * 只在从旧版本升级时需要执行一次，重复执行是幂等的（取最大值）。
 *
 * 用法：MONGO_URI=... npm run init:counters
 */
import mongoose from 'mongoose';
import config from '../config/index.js';
import Counter from '../models/id.js';

const LEGACY_COLLECTION = 'ids';

async function run() {
	await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
	console.log('[init] 已连接', config.mongoUrl.replace(/\/\/.*@/, '//***@'));

	const legacy = await mongoose.connection
		.collection(LEGACY_COLLECTION)
		.findOne({}, { projection: { user_id: 1, chat_id: 1 } });

	if (!legacy) {
		console.log('[init] 未发现旧版 ids 文档，跳过');
	} else {
		for (const [key, value] of [
			['user_id', legacy.user_id],
			['chat_id', legacy.chat_id],
		]) {
			if (!Number.isFinite(value)) continue;
			await Counter.updateOne(
				{ _id: key },
				{ $max: { seq: value } },
				{ upsert: true }
			);
			console.log(`[init] ${key} 计数器对齐到 ${value}`);
		}
	}

	const counters = await Counter.find().lean();
	console.log('[init] 当前计数器:', counters.map(c => `${c._id}=${c.seq}`).join(', ') || '(空)');
	await mongoose.disconnect();
}

run().catch(err => {
	console.error('[init] 失败:', err);
	process.exit(1);
});
