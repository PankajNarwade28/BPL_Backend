const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teamSchema = new mongoose.Schema({
  teamName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  captainName: {
    type: String,
    required: true,
    trim: true
  },
  teamId: {
    type: String,
    required: true,
    unique: true
  },
  pin: {
    type: String,
    required: true
  },
  remainingPoints: {
    type: Number,
    required: true,
    default: 110
  },
  rosterSlotsFilled: {
    type: Number,
    default: 0,
    min: 0,
    max: 14
  },
  players: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player'
  }],
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash PIN before saving
teamSchema.pre('save', async function(next) {
  if (!this.isModified('pin')) return next();
  this.pin = await bcrypt.hash(this.pin, 10);
  next();
});

// Method to compare PIN
teamSchema.methods.comparePin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.pin);
};

// Method to calculate max bid
teamSchema.methods.getMaxBid = function() {
  const remainingSlots = 14 - this.rosterSlotsFilled;
  if (remainingSlots <= 0) return 0;
  return this.remainingPoints - (remainingSlots * 30);
};

module.exports = mongoose.model('Team', teamSchema);
