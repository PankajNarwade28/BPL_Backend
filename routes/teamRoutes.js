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

    // Helper function to safely parse numbers and remove unwanted characters
    const parsePrice = (value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        // Remove quotes, L, ₹ and any other non-numeric characters except decimal point
        return parseFloat(value.replace(/['"₹L\s]/g, '')) || 0;
      }
      return 0;
    };

    // Create PDF document with better margins
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    
    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="all_teams_auction_results.pdf"');
    
    // Pipe PDF to response
    doc.pipe(res);

    // Title Page with improved design
    doc.fontSize(32).font('Helvetica-Bold').fillColor('#1e3a8a').text('Cricket Auction Results', { align: 'center' });
    doc.moveDown(0.8);
    doc.fontSize(16).font('Helvetica').fillColor('#374151').text(`Total Teams: ${teams.length}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#6b7280').text(`Generated on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });
    doc.moveDown(2);

    // Calculate initial budget once
    const initialBudget = Number.parseInt(process.env.INITIAL_BUDGET) || 1000;

    // Loop through each team
    teams.forEach((team, index) => {
      if (index > 0) {
        doc.addPage({ margin: 40 });
      }

      // Team Header with improved styling
      doc.fontSize(28).font('Helvetica-Bold').fillColor('#1e3a8a').text(team.teamName, { align: 'center' });
      doc.moveDown(0.4);
      doc.fontSize(13).font('Helvetica').fillColor('#374151').text(`Captain: ${team.captainName}`, { align: 'center' });
      doc.moveDown(1.5);

      // Team Statistics Box
      const statsY = doc.y;
      const statsBoxHeight = 90;
      
      // Enhanced stats box with rounded corners
      doc.roundedRect(40, statsY, 515, statsBoxHeight, 5).fillAndStroke('#f0f9ff', '#3b82f6');
      
      // Calculate values with proper number parsing
      const remainingBudget = parsePrice(team.remainingPoints);
      const budgetSpent = initialBudget - remainingBudget;
      const playersBought = team.rosterSlotsFilled || 0;
      const avgPrice = playersBought > 0 ? Math.round(budgetSpent / playersBought) : 0;
      
      // Stats content with better layout
      doc.fillColor('#1e3a8a');
      const statsStartY = statsY + 20;
      
      // Left Column
      doc.fontSize(10).font('Helvetica-Bold').text('Budget Spent:', 60, statsStartY, { width: 110 });
      doc.fillColor('#000000').font('Helvetica').fontSize(13).text(`₹${budgetSpent}L`, 170, statsStartY - 1);
      
      doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold').text('Remaining Budget:', 60, statsStartY + 30, { width: 110 });
      doc.fillColor('#059669').font('Helvetica').fontSize(13).text(`₹${remainingBudget}L`, 170, statsStartY + 29);
      
      // Right Column
      doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold').text('Players Bought:', 310, statsStartY, { width: 110 });
      doc.fillColor('#000000').font('Helvetica').fontSize(13).text(`${playersBought}`, 420, statsStartY - 1);
      
      doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold').text('Avg Player Price:', 310, statsStartY + 30, { width: 110 });
      doc.fillColor('#7c3aed').font('Helvetica').fontSize(13).text(`₹${avgPrice}L`, 420, statsStartY + 29);

      doc.y = statsY + statsBoxHeight + 20;

      // Squad Players Section
      if (team.players && team.players.length > 0) {
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e3a8a').text('Squad Players');
        doc.moveDown(0.8);

        // Enhanced table design
        const tableTop = doc.y;
        const colWidths = { no: 35, name: 175, category: 100, base: 90, sold: 95 };
        const startX = 40;
        const tableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

        // Table Header with better design
        doc.roundedRect(startX, tableTop, tableWidth, 28, 3).fillAndStroke('#2563eb', '#1e40af');
        
        // Header text
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('#', startX + 10, tableTop + 8, { width: colWidths.no - 10 });
        doc.text('Player Name', startX + colWidths.no + 5, tableTop + 8, { width: colWidths.name });
        doc.text('Category', startX + colWidths.no + colWidths.name + 5, tableTop + 8, { width: colWidths.category });
        doc.text('Base Price', startX + colWidths.no + colWidths.name + colWidths.category, tableTop + 8, { width: colWidths.base, align: 'center' });
        doc.text('Sold Price', startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, tableTop + 8, { width: colWidths.sold, align: 'center' });

        doc.y = tableTop + 28;

        // Table rows with improved styling
        team.players.forEach((player, pIndex) => {
          const rowY = doc.y;
          const rowHeight = 26;
          
          // Check for pagination
          if (rowY + rowHeight > doc.page.height - 80) {
            doc.addPage({ margin: 40 });
            doc.y = 60;
          }
          
          const currentRowY = doc.y;
          
          // Alternating row colors
          const bgColor = pIndex % 2 === 0 ? '#f8fafc' : '#ffffff';
          doc.rect(startX, currentRowY, tableWidth, rowHeight).fillAndStroke(bgColor, '#e2e8f0');

          // Parse prices properly
          const basePrice = parsePrice(player.basePrice);
          const soldPrice = parsePrice(player.soldPrice);

          // Row content
          doc.fontSize(9).font('Helvetica').fillColor('#1f2937');
          doc.text((pIndex + 1).toString(), startX + 10, currentRowY + 8, { width: colWidths.no - 10 });
          doc.font('Helvetica-Bold').text(player.name, startX + colWidths.no + 5, currentRowY + 8, { width: colWidths.name - 5, ellipsis: true });
          
          // Category with colors
          const categoryColors = {
            'Batsman': '#dc2626',
            'Bowler': '#16a34a', 
            'All-Rounder': '#ea580c',
            'Wicket-Keeper': '#2563eb'
          };
          doc.fillColor(categoryColors[player.category] || '#6b7280').font('Helvetica');
          doc.text(player.category, startX + colWidths.no + colWidths.name + 5, currentRowY + 8, { width: colWidths.category });
          
          // Prices
          doc.fillColor('#374151').font('Helvetica');
          doc.text(`₹${basePrice}L`, startX + colWidths.no + colWidths.name + colWidths.category, currentRowY + 8, { width: colWidths.base, align: 'center' });
          doc.fillColor('#059669').font('Helvetica-Bold');
          doc.text(`₹${soldPrice}L`, startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, currentRowY + 8, { width: colWidths.sold, align: 'center' });

          doc.y = currentRowY + rowHeight;
        });
      } else {
        doc.fontSize(11).fillColor('#9ca3af').font('Helvetica').text('No players in squad yet.', { align: 'center' });
        doc.moveDown(1);
      }

      // Footer with clean design
      doc.fontSize(8).fillColor('#6b7280').font('Helvetica');
      doc.text(
        `Page ${index + 1} of ${teams.length}`,
        40,
        doc.page.height - 55,
        { align: 'center', width: 515 }
      );
    });

    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
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

    // Helper function to safely parse numbers and remove unwanted characters
    const parsePrice = (value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        // Remove quotes, L, ₹ and any other non-numeric characters except decimal point
        return parseFloat(value.replace(/['"₹L\s]/g, '')) || 0;
      }
      return 0;
    };

    // Create PDF document with better margins
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    
    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${team.teamName.replace(/\s+/g, '_')}_squad.pdf"`);
    
    // Pipe PDF to response
    doc.pipe(res);

    // Title Section with improved styling
    doc.fontSize(32).font('Helvetica-Bold').fillColor('#1e3a8a').text(team.teamName, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica').fillColor('#374151').text(`Captain: ${team.captainName}`, { align: 'center' });
    doc.moveDown(2);

    // Team Statistics Section
    const boxY = doc.y;
    const boxHeight = 100;
    
    // Main statistics box with improved design
    doc.roundedRect(40, boxY, 515, boxHeight, 5).fillAndStroke('#f0f9ff', '#3b82f6');
    
    // Calculate values with proper number parsing
    const initialBudget = Number.parseInt(process.env.INITIAL_BUDGET) || 1000;
    const remainingBudget = parsePrice(team.remainingPoints);
    const budgetSpent = initialBudget - remainingBudget;
    const playersBought = team.rosterSlotsFilled || 0;
    const avgPrice = playersBought > 0 ? Math.round(budgetSpent / playersBought) : 0;

    // Statistics Grid - Left Column
    const statsStartY = boxY + 20;
    doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold');
    
    doc.text('Budget Spent:', 60, statsStartY, { width: 120 });
    doc.fillColor('#000000').font('Helvetica').fontSize(13);
    doc.text(`₹${budgetSpent}L`, 180, statsStartY - 1);
    
    doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold');
    doc.text('Remaining Budget:', 60, statsStartY + 30, { width: 120 });
    doc.fillColor('#059669').font('Helvetica').fontSize(13);
    doc.text(`₹${remainingBudget}L`, 180, statsStartY + 29);

    // Statistics Grid - Right Column
    doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold');
    doc.text('Players Bought:', 310, statsStartY, { width: 120 });
    doc.fillColor('#000000').font('Helvetica').fontSize(13);
    doc.text(`${playersBought}`, 430, statsStartY - 1);
    
    doc.fillColor('#1e3a8a').fontSize(10).font('Helvetica-Bold');
    doc.text('Avg Player Price:', 310, statsStartY + 30, { width: 120 });
    doc.fillColor('#7c3aed').font('Helvetica').fontSize(13);
    doc.text(`₹${avgPrice}L`, 430, statsStartY + 29);

    doc.y = boxY + boxHeight + 25;

    // Squad Players Section
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e3a8a').text('Squad Players', 40);
    doc.moveDown(0.8);

    if (team.players && team.players.length > 0) {
      // Enhanced table design
      const tableTop = doc.y;
      const colWidths = { no: 35, name: 180, category: 100, base: 85, sold: 95 };
      const startX = 40;
      const tableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

      // Table Header with gradient effect
      doc.roundedRect(startX, tableTop, tableWidth, 30, 3).fillAndStroke('#2563eb', '#1e40af');
      
      // Header Text
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('#', startX + 10, tableTop + 9, { width: colWidths.no - 10 });
      doc.text('Player Name', startX + colWidths.no + 5, tableTop + 9, { width: colWidths.name });
      doc.text('Category', startX + colWidths.no + colWidths.name + 5, tableTop + 9, { width: colWidths.category });
      doc.text('Base Price', startX + colWidths.no + colWidths.name + colWidths.category, tableTop + 9, { width: colWidths.base, align: 'center' });
      doc.text('Sold Price', startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, tableTop + 9, { width: colWidths.sold, align: 'center' });

      doc.y = tableTop + 30;

      // Table Rows with improved styling
      team.players.forEach((player, index) => {
        const rowY = doc.y;
        const rowHeight = 28;
        
        // Pagination check
        if (rowY + rowHeight > doc.page.height - 80) {
          doc.addPage({ margin: 40 });
          doc.y = 60;
        }
        
        const currentRowY = doc.y;
        
        // Alternating row colors with subtle design
        const bgColor = index % 2 === 0 ? '#f8fafc' : '#ffffff';
        const borderColor = '#e2e8f0';
        doc.rect(startX, currentRowY, tableWidth, rowHeight).fillAndStroke(bgColor, borderColor);

        // Parse prices properly
        const basePrice = parsePrice(player.basePrice);
        const soldPrice = parsePrice(player.soldPrice);

        // Row content
        doc.fontSize(10).font('Helvetica').fillColor('#1f2937');
        doc.text((index + 1).toString(), startX + 10, currentRowY + 9, { width: colWidths.no - 10 });
        doc.font('Helvetica-Bold').text(player.name, startX + colWidths.no + 5, currentRowY + 9, { width: colWidths.name - 5, ellipsis: true });
        
        // Category badge with colors
        const categoryColors = {
          'Batsman': '#dc2626',
          'Bowler': '#16a34a', 
          'All-Rounder': '#ea580c',
          'Wicket-Keeper': '#2563eb'
        };
        doc.fillColor(categoryColors[player.category] || '#6b7280').font('Helvetica');
        doc.text(player.category, startX + colWidths.no + colWidths.name + 5, currentRowY + 9, { width: colWidths.category });
        
        // Prices
        doc.fillColor('#374151').font('Helvetica');
        doc.text(`₹${basePrice}L`, startX + colWidths.no + colWidths.name + colWidths.category, currentRowY + 9, { width: colWidths.base, align: 'center' });
        doc.fillColor('#059669').font('Helvetica-Bold');
        doc.text(`₹${soldPrice}L`, startX + colWidths.no + colWidths.name + colWidths.category + colWidths.base, currentRowY + 9, { width: colWidths.sold, align: 'center' });

        doc.y = currentRowY + rowHeight;
      });
    } else {
      doc.fontSize(12).fillColor('#9ca3af').font('Helvetica').text('No players in squad yet.', { align: 'center' });
      doc.moveDown(2);
    }

    // Footer with clean design
    const footerY = doc.page.height - 60;
    doc.fontSize(8).fillColor('#6b7280').font('Helvetica');
    doc.text(
      `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      40,
      footerY,
      { align: 'center', width: 515 }
    );

    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
