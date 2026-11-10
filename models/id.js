import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
	{
		_id: String,
		seq: { type: Number, default: 0 },
	},
	{ versionKey: false }
);

const Counter =
	mongoose.models.Counter || mongoose.model('Counter', counterSchema, 'counters');

/**
 * 原子自增。旧实现是 findOne → ++ → save，并发下必然产生重复 ID。
 */
export async function nextId(name) {
	const doc = await Counter.findOneAndUpdate(
		{ _id: name },
		{ $inc: { seq: 1 } },
		{ new: true, upsert: true, setDefaultsOnInsert: true }
	);
	return doc.seq;
}

export const nextUserId = () => nextId('user_id');
export const nextChatId = () => nextId('chat_id');

export default Counter;
