const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  photo: {
    type: String,
    default: '/placeholder-player.jpg'
  },
  category: {
    type: String,
    required: true,
    enum: ['Batsman', 'Bowler', 'All-Rounder', 'Wicket-Keeper']
  },
  basePrice: {
    type: Number,
    required: true,
    default: 5
  },
  status: {
    type: String,
    enum: ['UNSOLD', 'SOLD', 'IN_AUCTION'],
    default: 'UNSOLD'
  },
  soldTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null
  },
  soldPrice: {
    type: Number,
    default: null
  },
  soldAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Player', playerSchema);
