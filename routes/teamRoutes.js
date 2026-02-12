const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const QRCode = require('qrcode');

// Get all teams
router.get('/', async (req, res) => {
  try {
    const teams = await Team.find()
      .select('-pin')
      .populate('players');
    res.json({ success: true, teams });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single team
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .select('-pin')
      .populate('players');
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ 
      success: true, 
      team: {
        ...team.toObject(),
        maxBid: team.getMaxBid()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate QR code for team login
router.get('/:id/qrcode', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const loginData = {
      teamId: team.teamId,
      teamName: team.teamName
    };

    const qrCode = await QRCode.toDataURL(JSON.stringify(loginData));
    
    res.json({ success: true, qrCode });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update team
router.put('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Update basic fields
    if (req.body.teamName) team.teamName = req.body.teamName;
    if (req.body.captainName) team.captainName = req.body.captainName;
    if (req.body.teamId) {
      // Check if new teamId already exists
      const existingTeam = await Team.findOne({ teamId: req.body.teamId, _id: { $ne: team._id } });
      if (existingTeam) {
        return res.status(400).json({ success: false, message: 'Team ID already exists' });
      }
      team.teamId = req.body.teamId;
    }
    
    // Update PIN if provided (will be hashed by pre-save middleware)
    if (req.body.pin) {
      team.pin = req.body.pin;
    }

    await team.save();

    res.json({ 
      success: true, 
      message: 'Team updated successfully',
      team: {
        _id: team._id,
        teamName: team.teamName,
        captainName: team.captainName,
        teamId: team.teamId,
        remainingPoints: team.remainingPoints,
        rosterSlotsFilled: team.rosterSlotsFilled
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Delete team
router.delete('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    if (team.rosterSlotsFilled > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete team with players' });
    }

    await team.deleteOne();
    res.json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Download team info as CSV
router.get('/:id/download', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('players');
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Create CSV content
    let csvContent = 'Team Information\n';
    csvContent += `Team Name,${team.teamName}\n`;
    csvContent += `Captain,${team.captainName}\n`;
    csvContent += `Total Points Spent,${(parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints}\n`;
    csvContent += `Remaining Points,${team.remainingPoints}\n`;
    csvContent += `Players Count,${team.rosterSlotsFilled}\n\n`;
    
    csvContent += 'Player Details\n';
    csvContent += 'Name,Category,Base Price,Sold Price\n';
    
    team.players.forEach(player => {
      csvContent += `${player.name},${player.category},${player.basePrice},${player.soldPrice}\n`;
    });

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${team.teamName.replace(/\s+/g, '_')}_squad.csv"`);
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download all teams info as CSV (for admin)
router.get('/download/all-teams', async (req, res) => {
  try {
    const teams = await Team.find().populate('players');
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'No teams found' });
    }

    let csvContent = 'All Teams Summary\n\n';
    
    teams.forEach((team, index) => {
      if (index > 0) csvContent += '\n';
      
      csvContent += `Team ${index + 1}\n`;
      csvContent += `Team Name,${team.teamName}\n`;
      csvContent += `Captain,${team.captainName}\n`;
      csvContent += `Total Points Spent,${(parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints}\n`;
      csvContent += `Remaining Points,${team.remainingPoints}\n`;
      csvContent += `Players Count,${team.rosterSlotsFilled}\n\n`;
      
      if (team.players.length > 0) {
        csvContent += 'Name,Category,Base Price,Sold Price\n';
        team.players.forEach(player => {
          csvContent += `${player.name},${player.category},${player.basePrice},${player.soldPrice}\n`;
        });
      }
      csvContent += '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="all_teams_auction_results.csv"');
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
