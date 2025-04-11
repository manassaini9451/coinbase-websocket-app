const mongoose = require('mongoose');
const subscriptionSchema = new mongoose.Schema({
  userId: String,
  products: [String],
  lastUpdated: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Subscription', subscriptionSchema);