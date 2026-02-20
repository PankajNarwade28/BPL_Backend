const Player = require('../models/Player');
const Team = require('../models/Team');
const Bid = require('../models/Bid');
const AuctionState = require('../models/AuctionState');

let auctionTimer = null;
let timerValue = Number.parseInt(process.env.TIMER_DURATION) || 20;
let playerQueue = [];
let isAutoAuction = false;
let unsoldPlayers = [];
let isTeamSummaryShowing = false;

module.exports = (io) => {
  // Store connected clients
  const connectedTeams = new Map();
  const adminSockets = new Set();
  const bigScreenSockets = new Set();

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle team login
    socket.on('team:login', async ({ teamId, pin }) => {
      try {
        const team = await Team.findOne({ teamId });
        
        if (!team) {
          return socket.emit('auth:error', { message: 'Invalid team ID' });
        }

        const isValidPin = await team.comparePin(pin);
        if (!isValidPin) {
          return socket.emit('auth:error', { message: 'Invalid PIN' });
        }

        // Update team status
        team.isOnline = true;
        team.lastActive = new Date();
        await team.save();

        // Store connection
        connectedTeams.set(socket.id, team._id);
        socket.join(`team:${team._id}`);

        // Send team data
        const teamData = await Team.findById(team._id).populate('players');
        socket.emit('auth:success', {
          team: {
            id: teamData._id,
            teamName: teamData.teamName,
            captainName: teamData.captainName,
            remainingPoints: teamData.remainingPoints,
            rosterSlotsFilled: teamData.rosterSlotsFilled,
            players: teamData.players
          }
        });

        // Notify admin and big screen
        broadcastTeamStatus();

      } catch (error) {
        console.error('Login error:', error);
        socket.emit('auth:error', { message: 'Login failed' });
      }
    });

    // Handle admin login
    socket.on('admin:login', ({ password }) => {
      // Simple password check (in production, use proper auth)
      if (password === process.env.ADMIN_PASSWORD || password === 'admin123') {
        adminSockets.add(socket.id);
        socket.join('admin');
        socket.emit('auth:success', { role: 'admin' });
        
        // Send current auction state
        sendAuctionState(socket);
      } else {
        socket.emit('auth:error', { message: 'Invalid admin password' });
      }
    });

    // Handle big screen connection
    socket.on('bigscreen:connect', () => {
      bigScreenSockets.add(socket.id);
      socket.join('bigscreen');
      socket.emit('connected', { message: 'Big screen connected' });
      
      // Send current auction state
      sendAuctionState(socket);
    });

    // Handle big screen team summary status
    socket.on('bigscreen:summaryStarting', () => {
      isTeamSummaryShowing = true;
      console.log('Team summary started - blocking new auctions');
      // Notify admin that summary is showing
      io.to('admin').emit('teamSummary:showing', { isShowing: true });
    });

    socket.on('bigscreen:summaryComplete', () => {
      isTeamSummaryShowing = false;
      console.log('Team summary complete - allowing new auctions');
      // Notify admin that summary is complete
      io.to('admin').emit('teamSummary:showing', { isShowing: false });
    });

    // Handle bid placement
    socket.on('bid:place', async ({ amount }) => {
      try {
        const teamId = connectedTeams.get(socket.id);
        if (!teamId) {
          return socket.emit('bid:error', { message: 'Not authenticated' });
        }

        const auctionState = await AuctionState.findOne();
        if (!auctionState || !auctionState.isActive || auctionState.isPaused) {
          return socket.emit('bid:error', { message: 'Auction not active' });
        }

        const team = await Team.findById(teamId);
        const player = await Player.findById(auctionState.currentPlayer);

        if (!player || player.status !== 'IN_AUCTION') {
          return socket.emit('bid:error', { message: 'Player not in auction' });
        }

        // Validate bid amount
        const currentHighBid = auctionState.currentHighBid.amount;
        const hasNoBids = !auctionState.currentHighBid.team; // No bids placed yet
        
        // Allow base price bid if no bids yet, otherwise must be at least 5L higher
        if (hasNoBids) {
          if (amount < currentHighBid) {
            return socket.emit('bid:error', { 
              message: `Bid must be at least ₹${currentHighBid}L` 
            });
          }
        } else {
          // Must be higher than current bid (any increment allowed)
          if (amount <= currentHighBid) {
            return socket.emit('bid:error', { 
              message: `Bid must be higher than ₹${currentHighBid}L` 
            });
          }
        }


        // Check if team has enough points
        if (amount > team.remainingPoints) {
          return socket.emit('bid:error', { 
            message: `Insufficient points. You have ₹${team.remainingPoints}L remaining` 
          });
        }

        // Prevent team from bidding against themselves
        if (!hasNoBids && auctionState.currentHighBid.team && 
            auctionState.currentHighBid.team.toString() === team._id.toString()) {
          return socket.emit('bid:error', { 
            message: 'You are already the highest bidder' 
          });
        }

        // Record bid
        const bid = new Bid({
          player: player._id,
          team: team._id,
          amount: amount,
          isWinning: false
        });
        await bid.save();

        // Update auction state
        auctionState.currentHighBid = {
          amount: amount,
          team: team._id
        };
        auctionState.lastBidAt = new Date();
        await auctionState.save();

        // Reset timer
        resetTimer(io);

        // Broadcast bid to all clients with full team data
        const bidData = {
          amount: amount,
          teamName: team.teamName,
          teamId: team._id.toString(),
          team: {
            _id: team._id,
            teamName: team.teamName,
            logo: team.logo,
            purseBudget: team.purseBudget,
            remainingPoints: team.remainingPoints
          },
          timestamp: new Date()
        };

        io.emit('bid:new', bidData);
        socket.emit('bid:success');

        console.log(`New bid: ₹${amount}L by ${team.teamName} for ${player.name}`);

      } catch (error) {
        console.error('Bid error:', error);
        socket.emit('bid:error', { message: 'Failed to place bid' });
      }
    });

    // Admin controls
    socket.on('admin:startAuction', async ({ playerId }) => {
      if (!adminSockets.has(socket.id)) {
        return socket.emit('error', { message: 'Unauthorized' });
      }

      // Block starting new auction if team summary is showing
      if (isTeamSummaryShowing) {
        return socket.emit('error', { message: 'Please wait for team summary to complete' });
      }

      try {
        const player = await Player.findById(playerId);
        if (!player || player.status === 'SOLD') {
          return socket.emit('error', { message: 'Player not available' });
        }

        // Use shared function
        await startAuctionForPlayer(io, playerId);

      } catch (error) {
        console.error('Start auction error:', error);
        socket.emit('error', { message: 'Failed to start auction' });
      }
    });

    socket.on('admin:pauseAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const auctionState = await AuctionState.findOne();
        if (auctionState) {
          auctionState.isPaused = true;
          await auctionState.save();
          stopTimer();
          io.emit('auction:paused');
        }
      } catch (error) {
        console.error('Pause error:', error);
      }
    });

    socket.on('admin:resumeAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const auctionState = await AuctionState.findOne();
        if (auctionState && auctionState.isPaused) {
          auctionState.isPaused = false;
          await auctionState.save();
          startTimer(io);
          io.emit('auction:resumed');
        }
      } catch (error) {
        console.error('Resume error:', error);
      }
    });

    socket.on('admin:undoSale', async ({ playerId }) => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const player = await Player.findById(playerId);
        if (!player || player.status !== 'SOLD') {
          return socket.emit('error', { message: 'Cannot undo this sale' });
        }

        const team = await Team.findById(player.soldTo);
        if (team) {
          // Restore team points
          team.remainingPoints += player.soldPrice;
          team.rosterSlotsFilled -= 1;
          team.players = team.players.filter(p => p.toString() !== player._id.toString());
          await team.save();
        }

        // Reset player
        player.status = 'UNSOLD';
        player.soldTo = null;
        player.soldPrice = null;
        player.soldAt = null;
        await player.save();

        // Delete bids
        await Bid.deleteMany({ player: player._id });

        io.emit('sale:undone', { player, team });

      } catch (error) {
        console.error('Undo error:', error);
      }
    });

    // Start auto auction with all available players
    socket.on('admin:startAutoAuction', async () => {
      if (!adminSockets.has(socket.id)) {
        return socket.emit('error', { message: 'Unauthorized' });
      }

      try {
        // Get all available players (not sold)
        const availablePlayers = await Player.find({ 
          status: { $ne: 'SOLD' }
        });

        if (availablePlayers.length === 0) {
          return socket.emit('error', { message: 'No players available for auction' });
        }

        // Group players by base price
        const playersByPrice = {};
        availablePlayers.forEach(player => {
          const price = player.basePrice;
          if (!playersByPrice[price]) {
            playersByPrice[price] = [];
          }
          playersByPrice[price].push(player);
        });

        // Sort prices in descending order (highest to lowest)
        const sortedPrices = Object.keys(playersByPrice)
          .map(Number)
          .sort((a, b) => b - a);

        // Shuffle players within each price group and flatten
        const shuffledPlayers = [];
        sortedPrices.forEach(price => {
          const playersAtPrice = playersByPrice[price];
          // Fisher-Yates shuffle algorithm
          for (let i = playersAtPrice.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playersAtPrice[i], playersAtPrice[j]] = [playersAtPrice[j], playersAtPrice[i]];
          }
          shuffledPlayers.push(...playersAtPrice);
        });

        // Initialize queue
        playerQueue = shuffledPlayers.map(p => p._id.toString());
        unsoldPlayers = [];
        isAutoAuction = true;

        // Broadcast queue status
        io.to('admin').emit('autoAuction:started', {
          totalPlayers: playerQueue.length,
          queueLength: playerQueue.length
        });

        // Start first player auction
        await processNextPlayerInQueue(io);

      } catch (error) {
        console.error('Auto auction start error:', error);
        socket.emit('error', { message: 'Failed to start auto auction' });
      }
    });

    // Stop auto auction
    socket.on('admin:stopAutoAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      isAutoAuction = false;
      stopTimer();
      
      io.to('admin').emit('autoAuction:stopped', {
        remainingInQueue: playerQueue.length,
        unsoldCount: unsoldPlayers.length
      });
    });

    // Get auto auction status
    socket.on('admin:getAutoAuctionStatus', () => {
      if (!adminSockets.has(socket.id)) return;

      socket.emit('autoAuction:status', {
        isActive: isAutoAuction,
        queueLength: playerQueue.length,
        unsoldCount: unsoldPlayers.length,
        totalRemaining: playerQueue.length + unsoldPlayers.length
      });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Handle team disconnect
      const teamId = connectedTeams.get(socket.id);
      if (teamId) {
        try {
          await Team.findByIdAndUpdate(teamId, { 
            isOnline: false,
            lastActive: new Date()
          });
          connectedTeams.delete(socket.id);
          broadcastTeamStatus();
        } catch (error) {
          console.error('Disconnect error:', error);
        }
      }

      // Handle admin disconnect
      if (adminSockets.has(socket.id)) {
        adminSockets.delete(socket.id);
      }

      // Handle big screen disconnect
      if (bigScreenSockets.has(socket.id)) {
        bigScreenSockets.delete(socket.id);
      }
    });
  });

  // Timer functions
  function startTimer(io) {
    stopTimer(); // Clear any existing timer
    timerValue = Number.parseInt(process.env.TIMER_DURATION) || 20;

    // Broadcast initial timer value
    io.emit('timer:update', { value: timerValue });

    auctionTimer = setInterval(async () => {
      timerValue--;
      
      // Broadcast timer update
      io.emit('timer:update', { value: timerValue });

      // Timer hit zero - auto SOLD
      if (timerValue <= 0) {
        stopTimer();
        await handleAutoSold(io);
      }
    }, 1000);
  }

  function stopTimer() {
    if (auctionTimer) {
      clearInterval(auctionTimer);
      auctionTimer = null;
    }
  }

  function resetTimer(io) {
    // Reset timer to 10 seconds on every new bid (standard auction behavior)
    timerValue = 10;
    io.emit('timer:reset', { value: timerValue });
  }

  async function handleAutoSold(io) {
    stopTimer();

    try {
      const auctionState = await AuctionState.findOne()
        .populate('currentPlayer')
        .populate('currentHighBid.team');

      if (!auctionState || !auctionState.currentPlayer) return;

      const player = auctionState.currentPlayer;
      const winningTeam = auctionState.currentHighBid.team;
      const soldPrice = auctionState.currentHighBid.amount;

      if (winningTeam) {
        // Update player
        player.status = 'SOLD';
        player.soldTo = winningTeam._id;
        player.soldPrice = soldPrice;
        player.soldAt = new Date();
        await player.save();

        // Update team
        winningTeam.remainingPoints -= soldPrice;
        winningTeam.rosterSlotsFilled += 1;
        winningTeam.players.push(player._id);
        await winningTeam.save();

        // Update recently sold
        auctionState.recentlySold.unshift({
          player: player._id,
          team: winningTeam._id,
          amount: soldPrice,
          soldAt: new Date()
        });
        if (auctionState.recentlySold.length > 10) {
          auctionState.recentlySold = auctionState.recentlySold.slice(0, 10);
        }
      } else {
        // No bids - mark unsold
        player.status = 'UNSOLD';
        await player.save();

        // Add to unsold queue if in auto auction mode
        if (isAutoAuction && !unsoldPlayers.includes(player._id.toString())) {
          unsoldPlayers.push(player._id.toString());
          io.to('admin').emit('autoAuction:playerUnsold', {
            playerId: player._id,
            playerName: player.name,
            unsoldCount: unsoldPlayers.length
          });
        }
      }

      // Reset auction state
      auctionState.isActive = false;
      auctionState.currentPlayer = null;
      auctionState.currentHighBid = { amount: 5, team: null };
      await auctionState.save();

      // Broadcast SOLD event
      io.emit('player:sold', {
        player: player,
        team: winningTeam ? {
          id: winningTeam._id,
          teamName: winningTeam.teamName
        } : null,
        amount: soldPrice
      });

      // Update team status
      broadcastTeamStatus();

      // If in auto auction mode, process next player
      if (isAutoAuction) {
        setTimeout(async () => {
          await processNextPlayerInQueue(io);
        }, 17000); // 17 seconds delay: 5s sold animation + 10s team summary + 2s buffer
      }

    } catch (error) {
      console.error('Auto-sold error:', error);
    }
  }

  async function processNextPlayerInQueue(io) {
    try {
      // Check if there are players in the main queue
      if (playerQueue.length > 0) {
        const playerId = playerQueue.shift();
        
        // Broadcast queue update
        io.to('admin').emit('autoAuction:queueUpdate', {
          queueLength: playerQueue.length,
          unsoldCount: unsoldPlayers.length,
          totalRemaining: playerQueue.length + unsoldPlayers.length
        });

        // Start auction for this player
        const player = await Player.findById(playerId);
        if (player && player.status !== 'SOLD') {
          await startAuctionForPlayer(io, playerId);
        } else {
          // Skip sold player and move to next
          await processNextPlayerInQueue(io);
        }
      } 
      // If main queue is empty but there are unsold players, add them back
      else if (unsoldPlayers.length > 0) {
        playerQueue = [...unsoldPlayers];
        unsoldPlayers = [];
        
        io.to('admin').emit('autoAuction:unsoldRound', {
          message: 'Starting auction for previously unsold players',
          count: playerQueue.length
        });

        // Process first unsold player
        await processNextPlayerInQueue(io);
      } 
      // Queue is completely empty
      else {
        isAutoAuction = false;
        io.to('admin').emit('autoAuction:completed', {
          message: 'All players have been auctioned'
        });
        io.emit('auction:allCompleted');
      }
    } catch (error) {
      console.error('Queue processing error:', error);
    }
  }

  async function startAuctionForPlayer(io, playerId) {
    try {
      const player = await Player.findById(playerId);
      if (!player || player.status === 'SOLD') {
        return;
      }

      // Update player status
      player.status = 'IN_AUCTION';
      await player.save();

      // Get or create auction state
      let auctionState = await AuctionState.findOne();
      if (!auctionState) {
        auctionState = new AuctionState();
      }

      auctionState.currentPlayer = player._id;
      auctionState.isActive = true;
      auctionState.isPaused = false;
      auctionState.currentHighBid = {
        amount: player.basePrice,
        team: null
      };
      auctionState.auctionStartedAt = new Date();
      await auctionState.save();

      // Start timer
      startTimer(io);

      // Broadcast to all clients
      io.emit('auction:started', {
        player: player,
        basePrice: player.basePrice,
        timerValue: timerValue
      });
    } catch (error) {
      console.error('Start auction for player error:', error);
    }
  }

  async function broadcastTeamStatus() {
    try {
      const teams = await Team.find().select('-pin');
      io.emit('teams:status', { teams });
    } catch (error) {
      console.error('Broadcast error:', error);
    }
  }

  async function sendAuctionState(socket) {
    try {
      const auctionState = await AuctionState.findOne()
        .populate('currentPlayer')
        .populate('currentHighBid.team')
        .populate('recentlySold.player')
        .populate('recentlySold.team');

      socket.emit('auction:state', {
        state: auctionState,
        timerValue: timerValue
      });
    } catch (error) {
      console.error('Send state error:', error);
    }
  }
};
