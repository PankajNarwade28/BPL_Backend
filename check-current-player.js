require('dotenv').config();
const mongoose = require('mongoose');
const Player = require('./models/Player');
const AuctionState = require('./models/AuctionState');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB\n');
    
    // Get auction state
    const auction = await AuctionState.findOne();
    if (auction && auction.currentPlayer) {
      console.log('=== Current Auction Player ===');
      const player = await Player.findById(auction.currentPlayer);
      if (player) {
        console.log('ID:', player._id);
        console.log('Name:', player.name);
        console.log('Photo URL:', player.photo);
        console.log('Cloud name in URL:', player.photo ? player.photo.match(/cloudinary\.com\/([^/]+)/)?.[1] : 'N/A');
      }
    }
    
    // Also check Testing Time
    console.log('\n=== Testing Time Player ===');
    const testPlayer = await Player.findOne({ name: 'Testing Time' });
    if (testPlayer) {
      console.log('ID:', testPlayer._id);
      console.log('Name:', testPlayer.name);
      console.log('Photo URL:', testPlayer.photo);
      console.log('Cloud name in URL:', testPlayer.photo ? testPlayer.photo.match(/cloudinary\.com\/([^/]+)/)?.[1] : 'N/A');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
