// Check and fix team logo URLs in database
const dotenv = require('dotenv');
const path = require('path');
dotenv.config();

const mongoose = require('mongoose');
const Team = require('./models/Team');

console.log('\n========================================');
console.log('TEAM LOGO URL CHECK & FIX');
console.log('========================================\n');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');
    
    const teams = await Team.find({});
    console.log(`Found ${teams.length} teams in database\n`);
    
    if (teams.length === 0) {
      console.log('No teams found. Database is empty.');
      process.exit(0);
    }
    
    console.log('Checking logo URLs...\n');
    
    let fixedCount = 0;
    
    for (const team of teams) {
      console.log(`\nTeam: ${team.teamName} (${team.teamId})`);
      console.log(`  Current logo: ${team.logo || 'NULL'}`);
      
      if (team.logo) {
        // Check if logo URL is valid Cloudinary URL
        if (team.logo.startsWith('https://res.cloudinary.com/')) {
          console.log('  Status: ✅ Valid Cloudinary URL');
        } else if (team.logo.startsWith('/uploads/') || team.logo.startsWith('uploads/')) {
          console.log('  Status: ⚠️  Local file path (legacy)');
          console.log('  Note: This team needs to re-upload logo via admin panel');
        } else if (team.logo.includes('cricket-auction/teams/')) {
          console.log('  Status: ❌ Malformed Cloudinary URL');
          console.log('  Issue: URL appears to be incorrectly constructed');
          
          // Try to fix by setting to null so default logo is used
          team.logo = null;
          await team.save();
          fixedCount++;
          console.log('  Action: ✅ Reset to null (will use default logo)');
        } else {
          console.log('  Status: ❓ Unknown URL format');
        }
      } else {
        console.log('  Status: ℹ️  No logo set (will use default)');
      }
    }
    
    console.log('\n========================================');
    console.log(`\nSummary:`);
    console.log(`  Total teams: ${teams.length}`);
    console.log(`  Fixed/reset: ${fixedCount}`);
    console.log('\n========================================\n');
    
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
