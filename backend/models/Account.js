const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  bio: { type: String, default: '' },
  followersCount: { type: Number, default: 0 },
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }]
});

module.exports = mongoose.model('Account', accountSchema);
