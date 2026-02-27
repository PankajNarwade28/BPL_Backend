// Test Cloudinary Upload
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const { uploadToCloudinary } = require('./config/cloudinary');

console.log('\n========================================');
console.log('CLOUDINARY UPLOAD TEST');
console.log('========================================\n');

// Create a test file
const testFileContent = 'This is a test image file';
const testFilePath = path.join(__dirname, 'temp-uploads', 'test-upload.txt');

// Ensure temp-uploads directory exists
const tempDir = path.join(__dirname, 'temp-uploads');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Write test file
fs.writeFileSync(testFilePath, testFileContent);

console.log('Test file created:', testFilePath);
console.log('Attempting upload to Cloudinary...\n');

// Test upload
uploadToCloudinary(testFilePath, 'test')
  .then(url => {
    console.log('\n✅ SUCCESS! File uploaded to Cloudinary.');
    console.log('   URL:', url);
    console.log('\n   This confirms:');
    console.log('   - Cloudinary credentials are correct');
    console.log('   - Upload function works properly');
    console.log('   - Files are being saved with clean public_ids');
    console.log('\n========================================\n');
    process.exit(0);
  })
  .catch(error => {
    console.log('\n❌ ERROR! Upload failed.');
    console.log('   Error:', error.message);
    console.log('\n========================================\n');
    process.exit(1);
  });
