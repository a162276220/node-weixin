import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
	id: Number,
	username: String,
	user_id: Number,
	time: String,
	avatar: String,
	content: String,
});

chatSchema.index({ id: 1 });

const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);

export default Chat;
