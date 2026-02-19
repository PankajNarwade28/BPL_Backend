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

// Download all teams info as PDF (for admin) - MUST come before /:id routes
router.get('/download/all-teams', async (req, res) => {
  try {
    const teams = await Team.find().populate('players');
    
    if (teams.length === 0) {
      return res.status(404).json({ success: false, message: 'No teams found' });
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="all_teams_auction_results.pdf"');
    
    // Pipe PDF to response
    doc.pipe(res);

    // Title Page
    doc.fontSize(24).font('Helvetica-Bold').text('Cricket Auction Results', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica').text(`Total Teams: ${teams.length}`, { align: 'center' });
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Loop through each team
    teams.forEach((team, index) => {
      if (index > 0) {
        doc.addPage();
      }

      // Team Header
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e40af').text(team.teamName, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica').fillColor('#000000').text(`Captain: ${team.captainName}`, { align: 'center' });
      doc.moveDown(1.5);

      // Team Stats Box
      const statsY = doc.y;
      const statsBoxHeight = 80;
      
      // Draw stats box background
      doc.rect(50, statsY, 495, statsBoxHeight).fillAndStroke('#f3f4f6', '#d1d5db');
      
      // Stats content
      doc.fillColor('#000000');
      const statsStartY = statsY + 15;
      
      doc.fontSize(11).font('Helvetica-Bold').text('Budget Spent:', 60, statsStartY);
      doc.font('Helvetica').text(`₹${(Number.parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints}L`, 180, statsStartY);
      
      doc.font('Helvetica-Bold').text('Remaining Budget:', 300, statsStartY);
      doc.font('Helvetica').text(`₹${team.remainingPoints}L`, 430, statsStartY);
      
      doc.font('Helvetica-Bold').text('Players Bought:', 60, statsStartY + 25);
      doc.font('Helvetica').text(team.rosterSlotsFilled.toString(), 180, statsStartY + 25);
      
      doc.font('Helvetica-Bold').text('Avg Player Price:', 300, statsStartY + 25);
      const avgPrice = team.rosterSlotsFilled > 0 
        ? Math.round(((Number.parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints) / team.rosterSlotsFilled)
        : 0;
      doc.font('Helvetica').text(`₹${avgPrice}L`, 430, statsStartY + 25);

      doc.y = statsY + statsBoxHeight + 20;

      // Players Table
      if (team.players.length > 0) {
        doc.fontSize(14).font('Helvetica-Bold').text('Squad Players', { underline: true });
        doc.moveDown(0.8);

        // Table headers
        const tableTop = doc.y;
        const colWidths = { no: 30, name: 160, category: 100, base: 85, sold: 85 };
        let startX = 50;

        // Header background
        doc.rect(startX, tableTop - 5, 495, 25).fillAndStroke('#3b82f6', '#2563eb');
        
        // Header text
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('#', startX + 5, tableTop + 2, { width: colWidths.no, align: 'center' });
        doc.text('Player Name', startX + colWidths.no, tableTop + 2, { width: colWidths.name });
        doc.text('Category', startX + colWidths.no + colWidths.name, tableTop + 2, { width: colWidths.category });
        doc.text('Base Price', startX + colWidths.no + colWidths.name + colWidths.category, tableTop + 2, { width: colWidths.base, align: 'center' });
        doc.text('Sold Price', startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, tableTop + 2, { width: colWidths.sold, align: 'center' });

        doc.y = tableTop + 25;

        // Table rows
        team.players.forEach((player, pIndex) => {
          const rowY = doc.y;
          
          // Alternate row colors
          if (pIndex % 2 === 0) {
            doc.rect(startX, rowY, 495, 20).fillAndStroke('#f9fafb', '#e5e7eb');
          }

          doc.fontSize(9).font('Helvetica').fillColor('#000000');
          doc.text((pIndex + 1).toString(), startX + 5, rowY + 5, { width: colWidths.no, align: 'center' });
          doc.text(player.name, startX + colWidths.no + 5, rowY + 5, { width: colWidths.name - 10 });
          doc.text(player.category, startX + colWidths.no + colWidths.name, rowY + 5, { width: colWidths.category });
          doc.text(`₹${player.basePrice}L`, startX + colWidths.no + colWidths.name + colWidths.category, rowY + 5, { width: colWidths.base, align: 'center' });
          doc.text(`₹${player.soldPrice}L`, startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, rowY + 5, { width: colWidths.sold, align: 'center' });

          doc.y = rowY + 20;
        });
      }

      // Footer
      doc.fontSize(8).fillColor('#6b7280').text(
        `Page ${index + 1} of ${teams.length} | Generated by Cricket Auction System`,
        50,
        doc.page.height - 50,
        { align: 'center' }
      );
    });

    // Finalize PDF
    doc.end();
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

// Download team info as PDF
router.get('/:id/download', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate('players');
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${team.teamName.replace(/\s+/g, '_')}_squad.pdf"`);
    
    // Pipe PDF to response
    doc.pipe(res);

    // Title
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#1e40af').text(team.teamName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).font('Helvetica').fillColor('#4b5563').text(`Captain: ${team.captainName}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#6b7280').text(`Generated on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
    doc.moveDown(2);

    // Team Statistics Box
    const boxY = doc.y;
    const boxHeight = 120;
    
    // Draw gradient-like box with border
    doc.rect(50, boxY, 495, boxHeight).fillAndStroke('#eff6ff', '#3b82f6');
    
    // Stats Title
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e40af').text('Team Statistics', 60, boxY + 15);
    
    // Stats Grid
    const statsY = boxY + 45;
    doc.fillColor('#000000');
    
    // Left Column
    doc.fontSize(11).font('Helvetica-Bold').text('Initial Budget:', 70, statsY);
    doc.font('Helvetica').text(`₹${Number.parseInt(process.env.INITIAL_BUDGET) || 110}L`, 200, statsY);
    
    doc.font('Helvetica-Bold').text('Total Spent:', 70, statsY + 20);
    doc.font('Helvetica').text(`₹${(Number.parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints}L`, 200, statsY + 20);
    
    doc.font('Helvetica-Bold').text('Remaining Budget:', 70, statsY + 40);
    doc.font('Helvetica').text(`₹${team.remainingPoints}L`, 200, statsY + 40);
    
    // Right Column
    doc.font('Helvetica-Bold').text('Players Bought:', 320, statsY);
    doc.font('Helvetica').text(`${team.rosterSlotsFilled} / ${Number.parseInt(process.env.MAX_SQUAD_SIZE) || 11}`, 450, statsY);
    
    const avgPrice = team.rosterSlotsFilled > 0 
      ? Math.round(((Number.parseInt(process.env.INITIAL_BUDGET) || 110) - team.remainingPoints) / team.rosterSlotsFilled)
      : 0;
    doc.font('Helvetica-Bold').text('Average Price:', 320, statsY + 20);
    doc.font('Helvetica').text(`₹${avgPrice}L`, 450, statsY + 20);
    
    doc.font('Helvetica-Bold').text('Roster Slots Left:', 320, statsY + 40);
    doc.font('Helvetica').text(((Number.parseInt(process.env.MAX_SQUAD_SIZE) || 11) - team.rosterSlotsFilled).toString(), 450, statsY + 40);

    doc.y = boxY + boxHeight + 30;

    // Squad Players Title
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e40af').text('Squad Players', { underline: true });
    doc.moveDown(1);

    if (team.players.length > 0) {
      // Table setup
      const tableTop = doc.y;
      const colWidths = { no: 35, name: 170, category: 110, base: 90, sold: 90 };
      const startX = 50;

      // Table Header Background
      doc.rect(startX, tableTop - 5, 495, 28).fillAndStroke('#3b82f6', '#2563eb');
      
      // Table Headers
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('#', startX + 8, tableTop + 3, { width: colWidths.no - 8, align: 'left' });
      doc.text('Player Name', startX + colWidths.no + 5, tableTop + 3, { width: colWidths.name });
      doc.text('Category', startX + colWidths.no + colWidths.name + 5, tableTop + 3, { width: colWidths.category });
      doc.text('Base Price', startX + colWidths.no + colWidths.name + colWidths.category + 5, tableTop + 3, { width: colWidths.base - 10, align: 'center' });
      doc.text('Sold Price', startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base + 5, tableTop + 3, { width: colWidths.sold - 10, align: 'center' });

      doc.y = tableTop + 28;

      // Table Rows
      team.players.forEach((player, index) => {
        const rowY = doc.y;
        const rowHeight = 25;
        
        // Check if we need a new page
        if (rowY + rowHeight > doc.page.height - 100) {
          doc.addPage();
          doc.y = 50;
        }
        
        const currentRowY = doc.y;
        
        // Alternate row colors
        const bgColor = index % 2 === 0 ? '#f9fafb' : '#ffffff';
        doc.rect(startX, currentRowY, 495, rowHeight).fillAndStroke(bgColor, '#e5e7eb');

        // Row content
        doc.fontSize(10).font('Helvetica').fillColor('#000000');
        doc.text((index + 1).toString(), startX + 8, currentRowY + 7, { width: colWidths.no - 8, align: 'left' });
        doc.text(player.name, startX + colWidths.no + 5, currentRowY + 7, { width: colWidths.name - 5, ellipsis: true });
        
        // Category with color coding
        const categoryColors = {
          'Batsman': '#ef4444',
          'Bowler': '#22c55e', 
          'All-Rounder': '#f59e0b',
          'Wicket-Keeper': '#3b82f6'
        };
        doc.fillColor(categoryColors[player.category] || '#6b7280');
        doc.font('Helvetica-Bold').text(player.category, startX + colWidths.no + colWidths.name + 5, currentRowY + 7, { width: colWidths.category });
        
        doc.fillColor('#000000').font('Helvetica');
        doc.text(`₹${player.basePrice}L`, startX + colWidths.no + colWidths.name + colWidths.category + 5, currentRowY + 7, { width: colWidths.base - 10, align: 'center' });
        doc.font('Helvetica-Bold').text(`₹${player.soldPrice}L`, startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base + 5, currentRowY + 7, { width: colWidths.sold - 10, align: 'center' });

        doc.y = currentRowY + rowHeight;
      });
    } else {
      doc.fontSize(12).fillColor('#6b7280').text('No players in squad yet.', { align: 'center' });
    }

    // Footer
    doc.fontSize(8).fillColor('#9ca3af').text(
      `${team.teamName} Squad | Cricket Auction System | Generated: ${new Date().toLocaleString()}`,
      50,
      doc.page.height - 50,
      { align: 'center', width: 495 }
    );

    // Finalize PDF
    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
