const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Cloudinary with credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Log configuration status (without exposing secrets)
console.log('Cloudinary Configuration:');
console.log('- Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME || 'NOT SET');
console.log('- API Key:', process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET');
console.log('- API Secret:', process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET');

// Create temporary storage for multer (files will be uploaded to Cloudinary then deleted)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../temp-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

// Create multer upload instances
const uploadPlayerPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const uploadTeamLogo = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper function to upload file to Cloudinary
const uploadToCloudinary = async (filePath, folder) => {
  try {
    console.log(`Attempting to upload to Cloudinary:`);
    console.log(`- File path: ${filePath}`);
    console.log(`- Folder: cricket-auction/${folder}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Generate a clean public_id (without file extension)
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const publicId = `${timestamp}-${randomString}`;
    
    const result = await cloudinary.uploader.upload(filePath, {
      folder: `cricket-auction/${folder}`,
      public_id: publicId,
      resource_type: 'auto',
      overwrite: false
    });
    
    console.log(`Cloudinary upload successful:`);
    console.log(`- Public ID: ${result.public_id}`);
    console.log(`- Secure URL: ${result.secure_url}`);
    
    // Delete temporary file after upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Temporary file deleted: ${filePath}`);
    }
    
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload failed:', error.message);
    console.error('Error details:', error);
    
    // Delete temporary file on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Temporary file deleted after error: ${filePath}`);
    }
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadPlayerPhoto,
  uploadTeamLogo,
  uploadToCloudinary
};

