const mongoose = require('mongoose');

const auctionStateSchema = new mongoose.Schema({
  currentPlayer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    default: null
  },
  timerValue: {
    type: Number,
    default: 20
  },
  isActive: {
    type: Boolean,
    default: false
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  currentHighBid: {
    amount: { type: Number, default: 5 },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null }
  },
  auctionStartedAt: {
    type: Date,
    default: null
  },
  lastBidAt: {
    type: Date,
    default: null
  },
  recentlySold: [{
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    amount: Number,
    soldAt: Date
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('AuctionState', auctionStateSchema);
