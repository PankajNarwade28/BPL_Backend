const express = require('express');
const router = express.Router();
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const Player = require('../models/Player');
const { uploadPlayerPhoto, uploadToCloudinary } = require('../config/cloudinary');

// Player self-registration with photo upload
router.post('/register', uploadPlayerPhoto.single('photo'), async (req, res) => {
  try {
    const { name, category, basePrice } = req.body;

    // Validate required fields
    if (!name || !category) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and category are required' 
      });
    }

    // Upload photo to Cloudinary if provided
    let photoUrl = null;
    if (req.file) {
      try {
        console.log('Uploading photo to Cloudinary:', req.file.path);
        photoUrl = await uploadToCloudinary(req.file.path, 'players');
        console.log('Cloudinary upload successful:', photoUrl);
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to upload photo to Cloudinary: ' + uploadError.message 
        });
      }
    }

    // Create player
    const player = new Player({
      name,
      category,
      photo: photoUrl || null,
      basePrice: Number.parseInt(basePrice) || 30
    });

    await player.save();

    res.status(201).json({ 
      success: true, 
      message: 'Registration successful! Your profile will be reviewed by admin.',
      player: {
        _id: player._id,
        name: player.name,
        category: player.category,
        photo: player.photo
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Get all players
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    
    const players = await Player.find(filter).populate('soldTo', 'teamName');
    res.json({ success: true, players });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single player
router.get('/:id', async (req, res) => {
  try {
    const player = await Player.findById(req.params.id).populate('soldTo', 'teamName');
    
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    res.json({ success: true, player });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create single player
router.post('/', async (req, res) => {
  try {
    const player = new Player(req.body);
    await player.save();
    res.status(201).json({ success: true, player });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Update player
router.put('/:id', uploadPlayerPhoto.single('photo'), async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    // Update basic fields
    if (req.body.name) player.name = req.body.name;
    if (req.body.category) player.category = req.body.category;
    if (req.body.basePrice) player.basePrice = Number.parseInt(req.body.basePrice);

    // Update photo if provided
    if (req.file) {
      const photoUrl = await uploadToCloudinary(req.file.path, 'players');
      player.photo = photoUrl;
    }

    await player.save();

    res.json({ 
      success: true, 
      message: 'Player updated successfully',
      player 
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Delete player
router.delete('/:id', async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    if (player.status === 'SOLD') {
      return res.status(400).json({ success: false, message: 'Cannot delete a sold player' });
    }

    await player.deleteOne();
    res.json({ success: true, message: 'Player deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Bulk upload via CSV
const multer = require('multer');
const csvStorage = multer.diskStorage({
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

const csvUpload = multer({ 
  storage: csvStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

router.post('/bulk-upload', csvUpload.single('csvFile'), async (req, res) => {
  try {
    console.log('CSV Upload - File received:', req.file);
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const players = [];
    const filePath = req.file.path;
    console.log('CSV Upload - Reading file:', filePath);

    // Helper function to normalize category
    const normalizeCategory = (category) => {
      const normalized = category.trim();
      // Map common variations to valid enum values
      const categoryMap = {
        'batsman': 'Batsman',
        'batter': 'Batsman',
        'bowler': 'Bowler',
        'all-rounder': 'All-Rounder',
        'allrounder': 'All-Rounder',
        'wicket-keeper': 'Wicket-Keeper',
        'wicketkeeper': 'Wicket-Keeper',
        'keeper': 'Wicket-Keeper'
      };
      
      const lowerCategory = normalized.toLowerCase();
      return categoryMap[lowerCategory] || normalized;
    };

    // Parse CSV
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        console.log('CSV Upload - Row parsed:', row);
        
        const category = row.category || row.Category;
        const normalizedCategory = normalizeCategory(category);
        
        // Skip rows with invalid categories like #N/A
        if (normalizedCategory === '#N/A' || !normalizedCategory) {
          console.log('CSV Upload - Skipping row with invalid category:', row.name);
          return;
        }
        
        players.push({
          name: row.name || row.Name,
          category: normalizedCategory,
          photo: row.photo || row.Photo || 'https://res.cloudinary.com/dz8q0fb8m/image/upload/v1772197979/defaultPlayer_kad3xb.png',
          basePrice: Number.parseInt(row.basePrice || row['Base Price']) || 5
        });
      })
      .on('end', async () => {
        try {
          console.log('CSV Upload - Total players parsed:', players.length);
          
          if (players.length === 0) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'No valid players found in CSV' });
          }

          console.log('CSV Upload - Inserting players:', players.length);
          const insertedPlayers = await Player.insertMany(players);
          console.log('CSV Upload - Success:', insertedPlayers.length);
          
          // Delete uploaded file
          fs.unlinkSync(filePath);
          
          res.json({ 
            success: true, 
            message: `${insertedPlayers.length} players uploaded successfully`,
            players: insertedPlayers 
          });
        } catch (error) {
          console.error('CSV Upload - Database error:', error);
          // Clean up file on error
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          res.status(400).json({ success: false, message: error.message });
        }
      })
      .on('error', (error) => {
        console.error('CSV Upload - Parsing error:', error);
        // Clean up file on parsing error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        res.status(400).json({ success: false, message: 'CSV parsing error: ' + error.message });
      });

  } catch (error) {
    console.error('CSV Upload - Server error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
