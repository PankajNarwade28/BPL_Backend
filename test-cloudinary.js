// Test Cloudinary Configuration
const dotenv = require('dotenv');
dotenv.config();

console.log('\n========================================');
console.log('CLOUDINARY CONFIGURATION TEST');
console.log('========================================\n');

console.log('Environment Variables:');
console.log('- CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME || '❌ NOT SET');
console.log('- CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? '✅ SET (' + process.env.CLOUDINARY_API_KEY.substring(0, 4) + '...)' : '❌ NOT SET');
console.log('- CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✅ SET (***hidden***)' : '❌ NOT SET');

console.log('\n----------------------------------------\n');

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('Testing Cloudinary Connection...\n');

// Test the connection by listing resources (limited to 1)
cloudinary.api.resources({ max_results: 1 })
  .then(result => {
    console.log('✅ SUCCESS! Cloudinary is configured correctly.');
    console.log(`   Found ${result.resources.length} resources in your account.\n`);
    console.log('========================================\n');
    process.exit(0);
  })
  .catch(error => {
    console.log('❌ ERROR! Cloudinary configuration failed.');
    console.log('   Error message:', error.message);
    console.log('   Error details:', error.error);
    console.log('\n   Common issues:');
    console.log('   - Check that CLOUDINARY_CLOUD_NAME is correct');
    console.log('   - Check that CLOUDINARY_API_KEY is correct');
    console.log('   - Check that CLOUDINARY_API_SECRET is correct');
    console.log('   - Make sure .env file is in the backend folder');
    console.log('\n========================================\n');
    process.exit(1);
  });
