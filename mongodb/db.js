import mongoose from 'mongoose';
import config from '../config/index.js';

export async function connectMongo() {
	mongoose.connection.on('error', err => {
		console.error('[db] 连接异常:', err.message);
	});
	mongoose.connection.on('disconnected', () => {
		console.warn('[db] 连接断开，驱动会自动重连');
	});

	await mongoose.connect(config.mongoUrl, {
		serverSelectionTimeoutMS: 5000,
	});
	console.log('[db] 已连接', config.mongoUrl.replace(/\/\/.*@/, '//***@'));
	return mongoose.connection;
}

export default mongoose.connection;
