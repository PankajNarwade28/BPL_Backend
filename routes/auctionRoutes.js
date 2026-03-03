const express = require('express');
const router = express.Router();
const AuctionState = require('../models/AuctionState');
const Player = require('../models/Player');
const Bid = require('../models/Bid');

// Get current auction state with timer calculation
router.get('/state', async (req, res) => {
  try {
    const state = await AuctionState.findOne()
      .populate('currentPlayer')
      .populate('currentHighBid.team', 'teamName logo remainingPoints')
      .populate({
        path: 'recentlySold.player',
        select: 'name photo category'
      })
      .populate({
        path: 'recentlySold.team',
        select: 'teamName'
      });

    // If no auction state exists or not active, check for any player in IN_AUCTION status
    if (!state || !state.isActive) {
      const playerInAuction = await Player.findOne({ status: 'IN_AUCTION' });
      
      if (playerInAuction) {
        // Found a player in auction but no active state - reset the player
        console.log('Found orphaned IN_AUCTION player:', playerInAuction.name);
        playerInAuction.status = 'UNSOLD';
        await playerInAuction.save();
      }
      
      return res.json({ 
        success: true, 
        state: state || null,
        timerValue: 0,
        isActive: false
      });
    }

    // Calculate timer value (you'll need to import this from socket handler or use a shared module)
    // For now, return a default or calculate based on last bid time
    const timerDuration = Number.parseInt(process.env.TIMER_DURATION) || 20;
    let calculatedTimer = timerDuration;
    
    if (state.lastBidAt) {
      const timeSinceLastBid = Math.floor((Date.now() - new Date(state.lastBidAt).getTime()) / 1000);
      calculatedTimer = Math.max(0, timerDuration - timeSinceLastBid);
    } else if (state.auctionStartedAt) {
      const timeSinceStart = Math.floor((Date.now() - new Date(state.auctionStartedAt).getTime()) / 1000);
      calculatedTimer = Math.max(0, timerDuration - timeSinceStart);
    }

    res.json({ 
      success: true, 
      state,
      timerValue: calculatedTimer,
      isActive: state.isActive
    });
  } catch (error) {
    console.error('Get auction state error:', error);
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
