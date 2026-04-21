// ─── server/index.js ─────────────────────────────────────────────────────────
// CS323: Entry point. Wires all socket events to their handlers.
// Demonstrates: network communication via Socket.io (async I/O / event-driven),
// concurrent request handling (Node.js event loop processes all socket events),
// and message passing (each emit/on is a message passed between server and clients).

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { createRoom, getRoom, deleteRoom } = require('./roomManager');
const { getPublicState } = require('./gameState');
const { startRound, handleGuess, resetGame, handleDisconnect, ROUNDS_PER_GAME } = require('./roundEngine');
const { startMonitor } = require('./monitor');
const { WORD_COUNT } = require('./wordList');

const app = express();
const server = http.createServer(app);

// CS323: Socket.io — bidirectional async I/O over WebSockets.
// Multiple clients maintain persistent connections; the server handles all their
// events concurrently via the Node.js event loop (non-blocking I/O).
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Socket event wiring ──────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── Create Room ────────────────────────────────────────────────────────────
  socket.on('create-room', ({ name, avatar }) => {
    const code = createRoom(socket.id);
    const room = getRoom(code);
    room.players[socket.id] = {
      id: socket.id, name, score: 0,
      isDrawing: false, avatar: avatar || '🐼', hasGuessed: false
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;

    socket.emit('room-joined', { code, playerId: socket.id, room: getPublicState(room) });
    console.log(`[Room] ${name} created room ${code}`);
  });

  // ── Join Room ──────────────────────────────────────────────────────────────
  socket.on('join-room', ({ code, name, avatar }) => {
    const upperCode = code.toUpperCase();
    const room = getRoom(upperCode);
    if (!room) { socket.emit('error', { message: 'Room not found!' }); return; }
    if (Object.keys(room.players).length >= 10) { socket.emit('error', { message: 'Room is full (max 10)!' }); return; }

    room.players[socket.id] = {
      id: socket.id, name, score: 0,
      isDrawing: false, avatar: avatar || '🐼', hasGuessed: false
    };
    socket.join(upperCode);
    socket.data.roomCode = upperCode;
    socket.data.name = name;

    socket.emit('room-joined', { code: upperCode, playerId: socket.id, room: getPublicState(room) });
    socket.emit('draw-history', { history: room.drawHistory });

    // Sync late-joiner to current game state
    if (room.state === 'drawing') {
      socket.emit('round-start', getPublicState(room));
      socket.emit('timer', { timeLeft: room.timeLeft });
      if (room.maskedWord) socket.emit('word-hint', { maskedWord: room.maskedWord });
    } else if (room.state === 'between') {
      socket.emit('round-end', { word: room.currentWord, players: getPublicState(room).players });
    } else if (room.state === 'gameover') {
      const sorted = Object.values(room.players).sort((a, b) => b.score - a.score);
      socket.emit('game-over', { players: sorted.map(p => ({ name: p.name, score: p.score, avatar: p.avatar })) });
    }

    socket.to(upperCode).emit('player-joined', {
      player: { id: socket.id, name, score: 0, avatar: avatar || '🐼' },
      room: getPublicState(room)
    });
    console.log(`[Room] ${name} joined ${upperCode} (state: ${room.state})`);
  });

  // ── Start Game ─────────────────────────────────────────────────────────────
  socket.on('start-game', () => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start!' }); return;
    }
    if (room.state !== 'lobby' && room.state !== 'gameover') {
      socket.emit('error', { message: 'Game already in progress!' }); return;
    }
    if (room.state === 'gameover') resetGame(io, code);
    room.round = 0;
    startRound(io, code);
  });

  // ── New Game (after game over) ─────────────────────────────────────────────
  socket.on('new-game', () => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room || room.host !== socket.id) return;
    resetGame(io, code);
  });

  // ── Drawing events ─────────────────────────────────────────────────────────
  socket.on('draw', (data) => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room || room.currentDrawer !== socket.id) return;
    room.drawHistory.push(data);
    socket.to(code).emit('draw', data);
  });

  socket.on('clear-canvas', () => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room || room.currentDrawer !== socket.id) return;
    room.drawHistory = [];
    socket.to(code).emit('clear-canvas');
  });

  socket.on('request-history', () => {
    const code = socket.data.roomCode;
    const room = getRoom(code);
    if (!room) return;
    socket.emit('draw-history', { history: room.drawHistory });
  });

  // ── Guess ──────────────────────────────────────────────────────────────────
  // CS323: This is where concurrent guess events are handled.
  // See roundEngine.js → handleGuess() for the mutex implementation.
  socket.on('guess', ({ message }) => {
    const code = socket.data.roomCode;
    handleGuess(io, socket, code, message);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  // CS323: Disconnects are async events that may arrive during any game phase.
  // handleDisconnect() safely cleans up state and re-locks if needed.
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleDisconnect(io, socket);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 SketchGuess running at http://localhost:${PORT} | Words: ${WORD_COUNT}`);
  // CS323: Start room monitor — shows parallel rooms running simultaneously
  startMonitor();
});