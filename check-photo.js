require('dotenv').config();
const mongoose = require('mongoose');
const Player = require('./models/Player');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const player = await Player.findOne({ name: 'Testing Time' });
    if (player) {
      console.log('\n=== Testing Time Player ===');
      console.log('Name:', player.name);
      console.log('Photo:', player.photo);
      console.log('Photo type:', typeof player.photo);
      console.log('Photo includes http:', player.photo ? player.photo.includes('http') : 'N/A');
      console.log('Photo includes res.cloudinary:', player.photo ? player.photo.includes('res.cloudinary.com') : 'N/A');
    } else {
      console.log('Testing Time player not found');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
