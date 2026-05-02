import mongoose from 'mongoose';

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: String,
  authorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  published: { type: Boolean, default: false },
});

export default mongoose.model('Post', postSchema);
