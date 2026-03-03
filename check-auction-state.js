const mongoose = require('mongoose');
require('dotenv').config();

const AuctionState = require('./models/AuctionState');
const Player = require('./models/Player');
const Team = require('./models/Team');

async function checkAuctionState() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cricket-auction');
    console.log('Connected to database');

    // Check auction state
    const auctionState = await AuctionState.findOne()
      .populate('currentPlayer')
      .populate('currentHighBid.team');

    console.log('\n=== AUCTION STATE ===');
    if (auctionState) {
      console.log('Exists:', 'YES');
      console.log('Is Active:', auctionState.isActive);
      console.log('Is Paused:', auctionState.isPaused);
      console.log('Current Player:', auctionState.currentPlayer ? auctionState.currentPlayer.name : 'NULL');
      console.log('Current High Bid:', auctionState.currentHighBid);
      console.log('Auction Started At:', auctionState.auctionStartedAt);
      console.log('Last Bid At:', auctionState.lastBidAt);
    } else {
      console.log('Exists:', 'NO - No auction state document found');
    }

    // Check for IN_AUCTION players
    const inAuctionPlayers = await Player.find({ status: 'IN_AUCTION' });
    
    console.log('\n=== IN_AUCTION PLAYERS ===');
    console.log('Count:', inAuctionPlayers.length);
    if (inAuctionPlayers.length > 0) {
      inAuctionPlayers.forEach(player => {
        console.log(`- ${player.name} (ID: ${player._id})`);
      });
    }

    // Check for inconsistency
    console.log('\n=== CONSISTENCY CHECK ===');
    if (inAuctionPlayers.length > 0 && (!auctionState || !auctionState.isActive || !auctionState.currentPlayer)) {
      console.log('❌ INCONSISTENCY DETECTED!');
      console.log('There are players with IN_AUCTION status but no active auction state.');
      console.log('\nFIXING...');
      
      for (const player of inAuctionPlayers) {
        player.status = 'UNSOLD';
        await player.save();
        console.log(`✓ Reset ${player.name} to UNSOLD`);
      }
      console.log('\n✅ Fixed all inconsistencies');
    } else if (auctionState && auctionState.isActive && auctionState.currentPlayer) {
      console.log('✅ Auction state is valid and active');
      console.log(`Current auction for: ${auctionState.currentPlayer.name}`);
    } else {
      console.log('✅ No active auction (this is normal)');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAuctionState();
