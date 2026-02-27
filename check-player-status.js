const mongoose = require('mongoose');
require('dotenv').config();

const Player = require('./models/Player');
const AuctionState = require('./models/AuctionState');

async function checkPlayerStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find the "Testing Time" player
    const player = await Player.findOne({ name: /Testing Time/i });
    
    if (player) {
      console.log('\n=== Testing Time Player Status ===');
      console.log(`Name: ${player.name}`);
      console.log(`Status: ${player.status}`);
      console.log(`Base Price: ₹${player.basePrice}L`);
      console.log(`Category: ${player.category}`);
      console.log(`ID: ${player._id}`);
    } else {
      console.log('\nPlayer "Testing Time" not found');
    }

    // Check auction state
    const auctionState = await AuctionState.findOne();
    console.log('\n=== Auction State ===');
    if (auctionState && auctionState.currentPlayer) {
      console.log(`Current Player: ${auctionState.currentPlayer}`);
      console.log(`Is Active: ${auctionState.isActive}`);
      console.log(`Is Paused: ${auctionState.isPaused}`);
    } else {
      console.log('No active auction');
    }

    // Find all IN_AUCTION players
    const inAuctionPlayers = await Player.find({ status: 'IN_AUCTION' });
    console.log(`\n=== Players with IN_AUCTION status: ${inAuctionPlayers.length} ===`);
    inAuctionPlayers.forEach(p => {
      console.log(`- ${p.name} (${p._id})`);
    });

    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPlayerStatus();
