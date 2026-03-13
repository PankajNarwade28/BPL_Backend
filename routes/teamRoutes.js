const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const fs = require('fs');

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
// Helper to handle currency parsing and math safely
const parsePrice = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/['"₹L\s,]/g, '');
        return parseFloat(cleaned) || 0;
    }
    return 0;
};

// Reusable function to draw the stats box
const drawStatsBox = (doc, y, initialBudget, remainingBudget, playersBought) => {
    const budgetSpent = initialBudget - remainingBudget;
    const avgPrice = playersBought > 0 ? (budgetSpent / playersBought).toFixed(2) : 0;

    doc.roundedRect(40, y, 515, 85, 8).fillAndStroke('#f8fafc', '#3b82f6');
    
    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10);
    // Column 1
    doc.text('BUDGET SPENT', 60, y + 20);
    doc.text('REMAINING', 60, y + 50);
    // Column 2
    doc.text('PLAYERS BOUGHT', 310, y + 20);
    doc.text('AVG PRICE', 310, y + 50);

    doc.fillColor('#000000').font('Helvetica').fontSize(14);
    doc.text(`₹${budgetSpent}L`, 180, y + 18);
    doc.fillColor('#059669').text(`₹${remainingBudget}L`, 180, y + 48);
    doc.fillColor('#000000').text(`${playersBought}`, 430, y + 18);
    doc.fillColor('#7c3aed').text(`₹${avgPrice}L`, 430, y + 48);
    
    return y + 105; // Return next Y position
};

// --- ROUTES ---

router.get('/download/all-teams', async (req, res) => {
    try {
        const teams = await Team.find().populate('players');
        if (!teams.length) return res.status(404).send('No teams found');

        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Full_Auction_Report.pdf"');
        doc.pipe(res);

        const initialBudget = Number(process.env.INITIAL_BUDGET) || 1000;

        teams.forEach((team, index) => {
            if (index > 0) doc.addPage();

            // Header
            doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(26).text(team.teamName.toUpperCase(), { align: 'center' });
            doc.fillColor('#64748b').fontSize(12).font('Helvetica').text(`Captain: ${team.captainName}`, { align: 'center' });
            doc.moveDown(1.5);

            // Stats
            const nextY = drawStatsBox(doc, doc.y, initialBudget, parsePrice(team.remainingPoints), team.players.length);
            doc.y = nextY;

            // Table
            if (team.players.length > 0) {
                renderPlayerTable(doc, team.players);
            } else {
                doc.moveDown(2).fillColor('#94a3b8').text('No players acquired yet.', { align: 'center' });
            }

            // Page Numbering
            doc.fontSize(8).fillColor('#94a3b8').text(`Page ${index + 1} of ${teams.length}`, 40, doc.page.height - 50, { align: 'center' });
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logic for the Table (Reusable)
function renderPlayerTable(doc, players) {
    const tableTop = doc.y + 10;
    const col = { no: 30, name: 190, cat: 100, base: 90, sold: 105 };
    const startX = 40;

    // Header Row
    doc.rect(startX, tableTop, 515, 25).fill('#1e3a8a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
    doc.text('#', startX + 5, tableTop + 7);
    doc.text('PLAYER', startX + col.no, tableTop + 7);
    doc.text('CATEGORY', startX + col.no + col.name, tableTop + 7);
    doc.text('BASE', startX + col.no + col.name + col.cat, tableTop + 7, { width: col.base, align: 'center' });
    doc.text('SOLD', startX + col.no + col.name + col.cat + col.base, tableTop + 7, { width: col.sold, align: 'center' });

    let currentY = tableTop + 25;

    players.forEach((p, i) => {
        // Auto-pagination
        if (currentY > 750) {
            doc.addPage();
            currentY = 50;
        }

        const isEven = i % 2 === 0;
        if (isEven) doc.rect(startX, currentY, 515, 25).fill('#f1f5f9');

        doc.fillColor('#1e293b').font('Helvetica').fontSize(9);
        doc.text(i + 1, startX + 5, currentY + 8);
        doc.font('Helvetica-Bold').text(p.name, startX + col.no, currentY + 8, { width: col.name - 10, ellipsis: true });
        
        // Category Styling
        const catColor = { 'Batsman': '#b91c1c', 'Bowler': '#15803d', 'All-Rounder': '#c2410c' }[p.category] || '#475569';
        doc.fillColor(catColor).font('Helvetica').text(p.category, startX + col.no + col.name, currentY + 8);

        doc.fillColor('#1e293b').text(`₹${parsePrice(p.basePrice)}L`, startX + col.no + col.name + col.cat, currentY + 8, { width: col.base, align: 'center' });
        doc.font('Helvetica-Bold').fillColor('#059669').text(`₹${parsePrice(p.soldPrice)}L`, startX + col.no + col.name + col.cat + col.base, currentY + 8, { width: col.sold, align: 'center' });

        currentY += 25;
    });
}

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
      team: team.toObject()
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



module.exports = router;
