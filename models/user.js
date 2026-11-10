import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
	name: String,
	id: Number,
	avatar: { type: String, default: 'default.jpg' },
});

userSchema.index({ id: 1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
