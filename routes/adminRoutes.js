const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Bid = require('../models/Bid');
const AuctionState = require('../models/AuctionState');

// Configure multer for team logo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'team-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
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

// Create single team/captain with logo upload
router.post('/create-captain', upload.single('logo'), async (req, res) => {
  try {
    // Log received data for debugging
    console.log('Received body:', req.body);
    console.log('Received file:', req.file);
    
    // Trim and extract fields from FormData
    const teamName = req.body.teamName?.trim();
    const captainName = req.body.captainName?.trim();
    const teamId = req.body.teamId?.trim();
    const pin = req.body.pin?.trim();
    
    console.log('Parsed fields:', { teamName, captainName, teamId, pin });
    
    // Validate required fields
    if (!teamName || !captainName || !teamId || !pin) {
      console.log('Validation failed - missing fields');
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required: teamName, captainName, teamId, pin' 
      });
    }

    // Check if teamId already exists
    const existingTeam = await Team.findOne({ teamId });
    if (existingTeam) {
      return res.status(400).json({ 
        success: false, 
        message: 'Team ID already exists' 
      });
    }

    // Get logo path
    const logoPath = req.file ? `/uploads/${req.file.filename}` : null;

    // Create new team
    const newTeam = new Team({
      teamName,
      captainName,
      teamId,
      pin, // Will be hashed by pre-save middleware
      logo: logoPath,
      remainingPoints: Number.parseInt(process.env.INITIAL_BUDGET) || 110,
      rosterSlotsFilled: 0,
      players: []
    });

    await newTeam.save();

    console.log('Team created successfully:', newTeam.teamId);

    res.json({ 
      success: true, 
      message: 'Captain created successfully',
      team: {
        _id: newTeam._id,
        teamName: newTeam.teamName,
        captainName: newTeam.captainName,
        teamId: newTeam.teamId,
        pin: pin // Return unhashed PIN (only time it's shown)
      }
    });
  } catch (error) {
    console.error('Error creating captain:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Generate teams with PINs
router.post('/generate-teams', async (req, res) => {
  try {
    const { count = 20, prefix = 'TEAM' } = req.body;
    
    const teams = [];
    for (let i = 1; i <= count; i++) {
      const teamNumber = String(i).padStart(2, '0');
      const pin = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit PIN
      
      teams.push({
        teamName: `${prefix} ${teamNumber}`,
        captainName: `Captain ${teamNumber}`,
        teamId: `${prefix}${teamNumber}`,
        pin: pin,
        remainingPoints: Number.parseInt(process.env.INITIAL_BUDGET) || 110,
        rosterSlotsFilled: 0,
        players: []
      });
    }

    const createdTeams = await Team.insertMany(teams);
    
    // Return teams with unhashed PINs for display (only once)
    const teamsWithPins = createdTeams.map((team, index) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      captainName: team.captainName,
      pin: teams[index].pin, // Original unhashed PIN
      _id: team._id
    }));

    res.json({ 
      success: true, 
      message: `${createdTeams.length} teams created`,
      teams: teamsWithPins
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Reset entire auction
router.post('/reset', async (req, res) => {
  try {
    // Reset all players
    await Player.updateMany(
      {},
      {
        status: 'UNSOLD',
        soldTo: null,
        soldPrice: null,
        soldAt: null
      }
    );

    // Reset all teams
    await Team.updateMany(
      {},
      {
        remainingPoints: Number.parseInt(process.env.INITIAL_BUDGET) || 110,
        rosterSlotsFilled: 0,
        players: [],
        isOnline: false
      }
    );

    // Clear all bids
    await Bid.deleteMany({});

    // Reset auction state
    await AuctionState.deleteMany({});

    res.json({ 
      success: true, 
      message: 'Auction reset successfully' 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete all data (complete reset)
router.delete('/clear-all', async (req, res) => {
  try {
    await Player.deleteMany({});
    await Team.deleteMany({});
    await Bid.deleteMany({});
    await AuctionState.deleteMany({});

    res.json({ 
      success: true, 
      message: 'All data cleared successfully' 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const teams = await Team.find()
      .select('-pin')
      .populate('players', 'name category soldPrice');
    
    const players = await Player.find();
    
    const auctionState = await AuctionState.findOne()
      .populate('currentPlayer')
      .populate('currentHighBid.team', 'teamName');

    res.json({
      success: true,
      data: {
        teams,
        players: {
          total: players.length,
          sold: players.filter(p => p.status === 'SOLD').length,
          unsold: players.filter(p => p.status === 'UNSOLD').length,
          inAuction: players.filter(p => p.status === 'IN_AUCTION').length
        },
        auctionState,
        onlineTeams: teams.filter(t => t.isOnline).length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update team details
router.put('/teams/:id', async (req, res) => {
  try {
    const { teamName, captainName } = req.body;
    
    const team = await Team.findByIdAndUpdate(
      req.params.id,
      { teamName, captainName },
      { new: true }
    ).select('-pin');

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, team });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Clear all data
router.post('/clear-all-data', async (req, res) => {
  try {
    // Delete all records from all collections
    await Promise.all([
      Player.deleteMany({}),
      Team.deleteMany({}),
      Bid.deleteMany({}),
      AuctionState.deleteMany({})
    ]);

    // Reinitialize auction state
    await AuctionState.create({
      currentPlayer: null,
      currentBid: null,
      isActive: false,
      timerValue: Number.parseInt(process.env.TIMER_DURATION) || 20
    });

    res.json({ 
      success: true, 
      message: 'All data cleared successfully. Players, teams, bids, and auction state have been reset.' 
    });
  } catch (error) {
    console.error('Clear data error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to clear data: ' + error.message 
    });
  }
});

module.exports = router;
