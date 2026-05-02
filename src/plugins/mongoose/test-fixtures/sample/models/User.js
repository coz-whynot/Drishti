const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  age: { type: Number, default: 0 },
  tags: [String],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
