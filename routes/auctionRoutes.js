const express = require('express');
const router = express.Router();
const AuctionState = require('../models/AuctionState');
const Player = require('../models/Player');
const Bid = require('../models/Bid');

// Get current auction state
router.get('/state', async (req, res) => {
  try {
    const state = await AuctionState.findOne()
      .populate('currentPlayer')
      .populate('currentHighBid.team', 'teamName')
      .populate({
        path: 'recentlySold.player',
        select: 'name photo category'
      })
      .populate({
        path: 'recentlySold.team',
        select: 'teamName'
      });

    res.json({ success: true, state });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get bid history for a player
router.get('/bids/:playerId', async (req, res) => {
  try {
    const bids = await Bid.find({ player: req.params.playerId })
      .populate('team', 'teamName')
      .sort({ timestamp: -1 });

    res.json({ success: true, bids });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get auction statistics
router.get('/stats', async (req, res) => {
  try {
    const totalPlayers = await Player.countDocuments();
    const soldPlayers = await Player.countDocuments({ status: 'SOLD' });
    const unsoldPlayers = await Player.countDocuments({ status: 'UNSOLD' });
    
    const totalBids = await Bid.countDocuments();
    
    const highestSale = await Player.findOne({ status: 'SOLD' })
      .sort({ soldPrice: -1 })
      .populate('soldTo', 'teamName');

    res.json({
      success: true,
      stats: {
        totalPlayers,
        soldPlayers,
        unsoldPlayers,
        totalBids,
        highestSale
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
