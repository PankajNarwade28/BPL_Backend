// Reset legacy team logos to null
const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const Team = require('./models/Team');

console.log('\n========================================');
console.log('RESET LEGACY TEAM LOGOS');
console.log('========================================\n');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');
    
    // Find teams with legacy logo paths
    const teams = await Team.find({
      logo: { $regex: /^\/uploads\// }
    });
    
    console.log(`Found ${teams.length} teams with legacy logo paths\n`);
    
    if (teams.length === 0) {
      console.log('No teams to fix!');
      process.exit(0);
    }
    
    for (const team of teams) {
      console.log(`Team: ${team.teamName} (${team.teamId})`);
      console.log(`  Old logo: ${team.logo}`);
      
      team.logo = null;
      await team.save();
      
      console.log(`  New logo: null (will use default)`);
      console.log(`  ✅ Reset successfully\n`);
    }
    
    console.log('========================================');
    console.log(`✅ Reset ${teams.length} team logos`);
    console.log('\nNext steps:');
    console.log('1. Go to Admin Panel');
    console.log('2. Edit each team');
    console.log('3. Re-upload logo (will save to Cloudinary)');
    console.log('========================================\n');
    
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
