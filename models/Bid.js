const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    required: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isWinning: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for fast queries
bidSchema.index({ player: 1, timestamp: -1 });

module.exports = mongoose.model('Bid', bidSchema);
