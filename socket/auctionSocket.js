const Player = require('../models/Player');
const Team = require('../models/Team');
const Bid = require('../models/Bid');
const AuctionState = require('../models/AuctionState');

// Set definitions for auto auction (basePrice thresholds)
const SET_CONFIG = {
  APP: { label: 'Set A++', basePrice: 200 },
  A: { label: 'Set A', basePrice: 150 },
  B: { label: 'Set B', basePrice: 100 },
  C: { label: 'Set C', basePrice: 50 },
  D: { label: 'Set D', basePrice: 20 },
};
const SET_ORDER = ['APP', 'A', 'B', 'C', 'D'];

let auctionTimer = null;
let timerValue = Number.parseInt(process.env.TIMER_DURATION) || 20;
let playerQueue = [];
let isAutoAuction = false;
let unsoldPlayers = [];
let isTeamSummaryShowing = false;
// Set-based auto auction state
let currentSetName = null;
let remainingSetOrder = [];
let setQueues = {};
let setIntroTimer = null;
let inUnsoldRound = false;
let isRandomMode = false;

const emitAdminError = (socket, message) => {
  socket.emit('admin:error', { message });
};

module.exports = (io) => {
  // Store connected clients
  const connectedTeams = new Map();
  const adminSockets = new Set();
  const bigScreenSockets = new Set();

  // Cleanup orphaned "IN_AUCTION" players on server start
  (async () => {
    try {
      const auctionState = await AuctionState.findOne();
      const currentPlayerId = auctionState?.currentPlayer?.toString();
      
      // Find all players marked as IN_AUCTION
      const playersInAuction = await Player.find({ status: 'IN_AUCTION' });
      
      for (const player of playersInAuction) {
        // If player is IN_AUCTION but not the current auction player, reset them
        if (!currentPlayerId || player._id.toString() !== currentPlayerId) {
          console.log(`Cleaning up orphaned IN_AUCTION player: ${player.name}`);
          player.status = 'UNSOLD';
          await player.save();
        }
      }
      
      console.log('Auction state cleanup completed');
    } catch (error) {
      console.error('Auction cleanup error:', error);
    }
  })();

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
            logo: teamData.logo,
            remainingPoints: teamData.remainingPoints,
            rosterSlotsFilled: teamData.rosterSlotsFilled,
            players: teamData.players
          }
        });

        // Notify admin and big screen
        broadcastTeamStatus();

        // Send current auction state to team
        console.log('📤 Sending auction state to team after login:', teamData.teamName);
        sendAuctionState(socket);

      } catch (error) {
        console.error('Login error:', error);
        socket.emit('auth:error', { message: 'Login failed' });
      }
    });

    // Handle team request for current auction state
    socket.on('team:getAuctionState', async () => {
      try {
        console.log('📡 Team requesting auction state...');
        // Send current auction state to any team (authenticated or not)
        await sendAuctionState(socket);
      } catch (error) {
        console.error('Get auction state error:', error);
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

        // Check if team has reached max squad size
        const MAX_SQUAD_SIZE = parseInt(process.env.MAX_SQUAD_SIZE) || 11;
        if (team.rosterSlotsFilled >= MAX_SQUAD_SIZE) {
          return socket.emit('bid:error', { 
            message: `Squad full! Maximum ${MAX_SQUAD_SIZE} players allowed` 
          });
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
        return emitAdminError(socket, 'Unauthorized');
      }

      // Block starting new auction if team summary is showing
      if (isTeamSummaryShowing) {
        return emitAdminError(socket, 'Please wait for team summary to complete');
      }

      try {
        const player = await Player.findById(playerId);
        if (!player || player.status === 'SOLD') {
          return emitAdminError(socket, 'Player not available');
        }

        // Check if player is marked as unavailable for auction
        if (player.availability === 'UNAVAILABLE') {
          return emitAdminError(socket, 'Player is marked as unavailable for auction');
        }

        // Use shared function
        await startAuctionForPlayer(io, playerId);

      } catch (error) {
        console.error('Start auction error:', error);
        emitAdminError(socket, 'Failed to start auction');
      }
    });

    socket.on('admin:pauseAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const auctionState = await AuctionState.findOne()
          .populate('currentPlayer')
          .populate('currentHighBid.team');
        if (auctionState && auctionState.isActive) {
          auctionState.isPaused = true;
          await auctionState.save();
          stopTimer();
          
          // Broadcast pause event
          io.emit('auction:paused');
          
          // Broadcast full auction state to all clients with current timer value
          io.emit('auction:state', {
            state: {
              ...auctionState.toObject(),
              timeRemaining: timerValue
            },
            timerValue: timerValue
          });
          console.log('Auction paused and state broadcasted');
        }
      } catch (error) {
        console.error('Pause error:', error);
      }
    });

    socket.on('admin:resumeAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const auctionState = await AuctionState.findOne()
          .populate('currentPlayer')
          .populate('currentHighBid.team');
        if (auctionState && auctionState.isPaused) {
          auctionState.isPaused = false;
          await auctionState.save();
          startTimer(io);
          
          // Broadcast resume event
          io.emit('auction:resumed');
          
          // Broadcast full auction state to all clients with current timer value
          io.emit('auction:state', {
            state: {
              ...auctionState.toObject(),
              timeRemaining: timerValue
            },
            timerValue: timerValue
          });
          console.log('Auction resumed and state broadcasted');
        }
      } catch (error) {
        console.error('Resume error:', error);
      }
    });

    socket.on('admin:resetAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const auctionState = await AuctionState.findOne().populate('currentPlayer');
        
        if (!auctionState || !auctionState.isActive) {
          return emitAdminError(socket, 'No active auction to reset');
        }

        const player = auctionState.currentPlayer;

        // Stop the timer
        stopTimer();

        // Reset player status to UNSOLD
        if (player) {
          player.status = 'UNSOLD';
          await player.save();
          console.log(`Auction reset: ${player.name} returned to UNSOLD status`);
        }

        // Clear auction state
        auctionState.isActive = false;
        auctionState.isPaused = false;
        auctionState.currentPlayer = null;
        auctionState.currentHighBid = { amount: 0, team: null };
        await auctionState.save();

        // Clear any bids for this player (optional - keeps bid history clean)
        if (player) {
          await Bid.deleteMany({ player: player._id });
        }

        // Broadcast reset event to all clients
        io.emit('auction:reset', {
          playerId: player?._id,
          playerName: player?.name,
          message: 'Auction has been reset'
        });

        // Broadcast updated auction state to all clients
        const updatedAuctionState = await AuctionState.findOne();
        io.emit('auction:state', {
          isActive: updatedAuctionState.isActive,
          isPaused: updatedAuctionState.isPaused,
          currentPlayer: null,
          currentHighBid: updatedAuctionState.currentHighBid
        });

        // Send updated auction state to admin
        await sendAuctionState(socket);

        console.log('Auction reset successfully');
      } catch (error) {
        console.error('Reset auction error:', error);
        emitAdminError(socket, 'Failed to reset auction');
      }
    });

    socket.on('admin:undoSale', async ({ playerId }) => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const player = await Player.findById(playerId);
        if (!player || player.status !== 'SOLD') {
          return emitAdminError(socket, 'Cannot undo this sale');
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

    // Remove player from IN_AUCTION status back to UNSOLD
    socket.on('admin:removeFromAuction', async ({ playerId }) => {
      if (!adminSockets.has(socket.id)) return;

      try {
        const player = await Player.findById(playerId);
        if (!player || player.status !== 'IN_AUCTION') {
          return emitAdminError(socket, 'Player is not in auction');
        }

        // Check if this player is currently in an active auction
        const auctionState = await AuctionState.findOne();
        const isCurrentAuctionPlayer = auctionState?.currentPlayer?.toString() === player._id.toString();

        if (isCurrentAuctionPlayer && auctionState.isActive) {
          // Stop the timer
          stopTimer();

          // Clear auction state
          auctionState.isActive = false;
          auctionState.isPaused = false;
          auctionState.currentPlayer = null;
          auctionState.currentHighBid = { amount: 0, team: null };
          await auctionState.save();

          // Broadcast auction state update
          io.emit('auction:state', {
            isActive: false,
            isPaused: false,
            currentPlayer: null,
            currentHighBid: { amount: 0, team: null }
          });
        }

        // Reset player status to UNSOLD
        player.status = 'UNSOLD';
        await player.save();

        // Delete any bids for this player
        await Bid.deleteMany({ player: player._id });

        // Broadcast to all clients
        io.emit('player:removedFromAuction', {
          playerId: player._id,
          playerName: player.name,
          message: `${player.name} removed from auction`
        });

        console.log(`Player removed from auction: ${player.name} -> UNSOLD`);

        // Send updated auction state to admin
        await sendAuctionState(socket);

      } catch (error) {
        console.error('Remove from auction error:', error);
        emitAdminError(socket, 'Failed to remove player from auction');
      }
    });

    // Start auto auction — mode: 'set' (Set A++→A→B→C→D with intros) or 'random' (all players shuffled)
    socket.on('admin:startAutoAuction', async ({ mode } = {}) => {
      if (!adminSockets.has(socket.id)) {
        return emitAdminError(socket, 'Unauthorized');
      }

      // Block starting new auction if team summary is showing
      if (isTeamSummaryShowing) {
        return emitAdminError(socket, 'Team summary is showing. Please wait.');
      }

      try {
        // Get all available players (not sold and marked as available)
        const availablePlayers = await Player.find({
          status: { $ne: 'SOLD' },
          availability: { $in: ['AVAILABLE', null] }
        });

        if (availablePlayers.length === 0) {
          return emitAdminError(socket, 'No players available for auction');
        }

        // Fisher-Yates shuffle helper
        const shuffle = (arr) => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        };

        playerQueue = [];
        unsoldPlayers = [];
        isAutoAuction = true;
        currentSetName = null;
        inUnsoldRound = false;
        isRandomMode = mode === 'random';

        if (isRandomMode) {
          // Random mode: shuffle ALL available players regardless of set/price
          playerQueue = shuffle(availablePlayers.map(p => p._id.toString()));
          remainingSetOrder = [];
          setQueues = {};

          io.to('admin').emit('autoAuction:started', {
            totalPlayers: availablePlayers.length,
            queueLength: availablePlayers.length,
            mode: 'random',
          });

          // Start immediately — no set intro needed
          await processNextPlayerInQueue(io);
        } else {
          // Set-wise mode: group by base price and show set intros
          const rawSets = { APP: [], A: [], B: [], C: [], D: [] };
          for (const player of availablePlayers) {
            if (player.basePrice >= 200) rawSets.APP.push(player._id.toString());
            else if (player.basePrice >= 150) rawSets.A.push(player._id.toString());
            else if (player.basePrice >= 100) rawSets.B.push(player._id.toString());
            else if (player.basePrice >= 50)  rawSets.C.push(player._id.toString());
            else                               rawSets.D.push(player._id.toString());
          }
          setQueues = {
            APP: shuffle(rawSets.APP),
            A: shuffle(rawSets.A),
            B: shuffle(rawSets.B),
            C: shuffle(rawSets.C),
            D: shuffle(rawSets.D),
          };

          remainingSetOrder = SET_ORDER.filter(s => setQueues[s].length > 0);
          if (remainingSetOrder.length === 0) {
            return emitAdminError(socket, 'No players available for auction');
          }

          const setBreakdown = {};
          SET_ORDER.forEach(s => { setBreakdown[s] = setQueues[s].length; });

          io.to('admin').emit('autoAuction:started', {
            totalPlayers: availablePlayers.length,
            queueLength: availablePlayers.length,
            setBreakdown,
            setsWithPlayers: remainingSetOrder,
            mode: 'set',
          });

          // Start intro for first set
          await startNextSetIntro(io);
        }

      } catch (error) {
        console.error('Auto auction start error:', error);
        emitAdminError(socket, 'Failed to start auto auction');
      }
    });

    // Stop auto auction
    socket.on('admin:stopAutoAuction', async () => {
      if (!adminSockets.has(socket.id)) return;

      isAutoAuction = false;
      isRandomMode = false;
      stopTimer();

      // Clear any pending set intro timer
      if (setIntroTimer) {
        clearTimeout(setIntroTimer);
        setIntroTimer = null;
      }
      currentSetName = null;
      remainingSetOrder = [];
      inUnsoldRound = false;

      io.emit('set:introAborted');
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
        totalRemaining: playerQueue.length + unsoldPlayers.length,
        currentSet: currentSetName,
        remainingSets: remainingSetOrder.length,
        inUnsoldRound,
        mode: isRandomMode ? 'random' : 'set',
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

        // Safety: if all big screens disconnect while summary flag is on, unblock auctions.
        if (bigScreenSockets.size === 0 && isTeamSummaryShowing) {
          isTeamSummaryShowing = false;
          io.to('admin').emit('teamSummary:showing', { isShowing: false });
        }
      }
    });
  });

  // Timer functions
  function startTimer(io) {
    stopTimer(); // Clear any existing timer
    timerValue = Number.parseInt(process.env.TIMER_DURATION) || 100;

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
    timerValue = 30;
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
            unsoldCount: unsoldPlayers.length,
            currentSet: currentSetName,
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
          teamName: winningTeam.teamName,
          logo: winningTeam.logo,
          remainingPoints: winningTeam.remainingPoints
        } : null,
        amount: soldPrice
      });

      // Broadcast auction ended event with updated state
      io.emit('auction:ended', {
        player: player,
        team: winningTeam ? {
          id: winningTeam._id,
          teamName: winningTeam.teamName,
          logo: winningTeam.logo,
          remainingPoints: winningTeam.remainingPoints
        } : null,
        amount: soldPrice,
        status: winningTeam ? 'SOLD' : 'UNSOLD'
      });

      // Broadcast updated auction state to all clients
      const updatedState = await AuctionState.findOne()
        .populate('currentPlayer')
        .populate('currentHighBid.team');
      io.emit('auction:state', {
        state: updatedState,
        timerValue: 0
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
      // Players still remaining in current set queue
      if (playerQueue.length > 0) {
        const playerId = playerQueue.shift();

        io.to('admin').emit('autoAuction:queueUpdate', {
          queueLength: playerQueue.length,
          unsoldCount: unsoldPlayers.length,
          totalRemaining: playerQueue.length + unsoldPlayers.length,
          currentSet: currentSetName,
          inUnsoldRound,
        });

        const player = await Player.findById(playerId);
        if (player && player.status !== 'SOLD') {
          await startAuctionForPlayer(io, playerId);
        } else {
          await processNextPlayerInQueue(io);
        }
        return;
      }

      // Current set queue is empty — retry unsold players once (not if already in retry round)
      if (!inUnsoldRound && unsoldPlayers.length > 0) {
        inUnsoldRound = true;
        const shuffledUnsold = [...unsoldPlayers];
        for (let i = shuffledUnsold.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledUnsold[i], shuffledUnsold[j]] = [shuffledUnsold[j], shuffledUnsold[i]];
        }
        playerQueue = shuffledUnsold;
        unsoldPlayers = [];

        const cfg = SET_CONFIG[currentSetName];
        io.to('admin').emit('autoAuction:unsoldRound', {
          message: `Re-auctioning unsold players from ${cfg ? cfg.label : 'current set'}`,
          count: playerQueue.length,
          currentSet: currentSetName,
        });
        await processNextPlayerInQueue(io);
        return;
      }

      // This set is fully done (including unsold retry)
      const cfg = SET_CONFIG[currentSetName];
      io.emit('set:complete', {
        set: currentSetName,
        label: cfg ? cfg.label : `Set ${currentSetName}`,
      });
      io.to('admin').emit('autoAuction:setComplete', {
        set: currentSetName,
        label: cfg ? cfg.label : `Set ${currentSetName}`,
      });

      inUnsoldRound = false;
      unsoldPlayers = [];
      playerQueue = [];

      if (remainingSetOrder.length > 0) {
        // 5-second pause, then start next set intro
        setTimeout(async () => {
          await startNextSetIntro(io);
        }, 5000);
      } else {
        isAutoAuction = false;
        io.to('admin').emit('autoAuction:completed', {
          message: 'All sets have been auctioned'
        });
        io.emit('auction:allCompleted');
      }
    } catch (error) {
      console.error('Queue processing error:', error);
    }
  }

  // Broadcast a 30-second set introduction then begin the set
  async function startNextSetIntro(io) {
    try {
      currentSetName = remainingSetOrder.shift();
      const cfg = SET_CONFIG[currentSetName];
      playerQueue = [...(setQueues[currentSetName] || [])];
      unsoldPlayers = [];
      inUnsoldRound = false;

      // Fetch full player documents for the intro screen
      const playersData = await Player.find({
        _id: { $in: setQueues[currentSetName] || [] },
        status: { $ne: 'SOLD' },
      });

      const INTRO_DURATION = 30000;

      io.emit('set:intro', {
        set: currentSetName,
        label: cfg.label,
        basePrice: cfg.basePrice,
        players: playersData,
        totalPlayers: playersData.length,
        duration: INTRO_DURATION,
      });

      io.to('admin').emit('autoAuction:setIntroStarted', {
        set: currentSetName,
        label: cfg.label,
        basePrice: cfg.basePrice,
        totalPlayers: playersData.length,
        remainingSets: remainingSetOrder.length,
      });

      console.log(`Set ${currentSetName} intro started (${INTRO_DURATION / 1000}s)`);

      setIntroTimer = setTimeout(async () => {
        setIntroTimer = null;
        io.emit('set:started', {
          set: currentSetName,
          label: cfg.label,
          basePrice: cfg.basePrice,
          remaining: playerQueue.length,
        });
        io.to('admin').emit('autoAuction:setStarted', {
          set: currentSetName,
          label: cfg.label,
          basePrice: cfg.basePrice,
          remaining: playerQueue.length,
        });
        await processNextPlayerInQueue(io);
      }, INTRO_DURATION);
    } catch (error) {
      console.error('startNextSetIntro error:', error);
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

      // Also broadcast full auction state for immediate sync
      const fullState = await AuctionState.findOne()
        .populate('currentPlayer')
        .populate('currentHighBid.team');
      io.emit('auction:state', {
        state: fullState,
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

      const stateData = {
        state: auctionState,
        timerValue: timerValue
      };

      console.log('🔄 Sending auction:state to socket:', {
        socketId: socket.id,
        hasState: !!auctionState,
        isActive: auctionState?.isActive,
        hasCurrentPlayer: !!auctionState?.currentPlayer,
        playerName: auctionState?.currentPlayer?.name,
        playerId: auctionState?.currentPlayer?._id,
        timerValue: timerValue,
        dataKeys: Object.keys(stateData)
      });

      socket.emit('auction:state', stateData);
      
      console.log('✅ auction:state emitted successfully');
    } catch (error) {
      console.error('❌ Send state error:', error);
    }
  }
};
