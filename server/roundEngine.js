// ─── server/roundEngine.js ───────────────────────────────────────────────────
// CS323: PRIMARY DEMONSTRATION OF PARALLEL/DISTRIBUTED CONCEPTS
//
// This module contains all synchronization mechanisms for the game:
//
//  1. MUTEX (state.locked)
//     Prevents simultaneous state mutations from concurrent socket events.
//     When multiple players send guesses at the same millisecond, only the
//     first one passes through the lock. All others are rejected.
//
//  2. ATOMIC ROUND TRANSITIONS
//     When a round ends (timer or all-guessed), the room is locked immediately.
//     No guess events can be processed while the next round is being set up.
//
//  3. RACE CONDITION PREVENTION
//     player.hasGuessed flag ensures a player can't score twice even if they
//     spam the guess event before the server processes the first one.
//
//  4. SHARED STATE MANAGEMENT
//     All players in a room interact with the same state object (from roomManager).
//     No player has a private copy — all reads and writes go through this module.

const { getRoom, deleteRoom } = require('./roomManager');
const { getPublicState } = require('./gameState');
const { getRandomWord } = require('./wordList');

const ROUND_DURATION = 50; // seconds
const ROUNDS_PER_GAME = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskWord(word) {
  return word.split('').map(c => (c === ' ' ? ' ' : '_')).join(' ');
}

function revealLetter(word, masked, percent) {
  const letters = word.split('');
  const maskedArr = masked.split(' ');
  const hidden = letters.map((c, i) => (maskedArr[i] === '_' ? i : -1)).filter(i => i >= 0);
  const toReveal = Math.floor(hidden.length * percent);
  for (let i = 0; i < toReveal; i++) {
    const ri = Math.floor(Math.random() * hidden.length);
    const idx = hidden.splice(ri, 1)[0];
    maskedArr[idx] = letters[idx];
  }
  return maskedArr.join(' ');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// ── Core round logic ──────────────────────────────────────────────────────────

function startRound(io, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  room.round++;
  const maxRounds = ROUNDS_PER_GAME * Object.keys(room.players).length;
  if (room.round > maxRounds) {
    endGame(io, roomCode);
    return;
  }

  // Rotate drawer
  const playerIds = Object.keys(room.players);
  const drawerId = playerIds[(room.round - 1) % playerIds.length];

  Object.values(room.players).forEach(p => {
    p.isDrawing = false;
    p.hasGuessed = false; // CS323: reset per-round guess flag
  });

  room.players[drawerId].isDrawing = true;
  room.currentDrawer = drawerId;
  room.currentWord = getRandomWord();
  room.maskedWord = maskWord(room.currentWord);
  room.drawHistory = [];
  room.correctGuessers = new Set();
  room.state = 'drawing';
  room.timeLeft = ROUND_DURATION;

  // CS323: Unlock the room — new round is ready to accept events
  room.locked = false;

  console.log(`[Round] Room ${roomCode} | Round ${room.round} started | Word: "${room.currentWord}" | Drawer: ${room.players[drawerId].name}`);

  // Private word to drawer only
  io.to(drawerId).emit('your-word', { word: room.currentWord });

  // Broadcast round start (masked word only for guessers)
  io.to(roomCode).emit('round-start', getPublicState(room));
  io.to(roomCode).emit('clear-canvas');

  // Start countdown timer
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;

    // Hint at 50% time elapsed
    if (room.timeLeft === Math.floor(ROUND_DURATION * 0.5)) {
      room.maskedWord = revealLetter(room.currentWord, room.maskedWord, 0.3);
      io.to(roomCode).emit('word-hint', { maskedWord: room.maskedWord });
    }

    io.to(roomCode).emit('timer', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      // CS323: Timer expiry triggers atomic round-end transition
      resolveRoundEnd(io, roomCode);
    }
  }, 1000);
}

// CS323: ATOMIC ROUND TRANSITION
// The room is locked immediately when a round ends.
// Any guess events arriving after this point (network lag, etc.) are dropped.
function resolveRoundEnd(io, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  if (room.locked) return; // already transitioning, ignore duplicate calls

  // ── ACQUIRE LOCK ──────────────────────────────────────────────────────────
  room.locked = true;
  room.state = 'between';
  clearInterval(room.timer);

  console.log(`[Round] Room ${roomCode} | Round ${room.round} ended | Word was: "${room.currentWord}" | locked=true`);

  io.to(roomCode).emit('round-end', {
    word: room.currentWord,
    players: getPublicState(room).players
  });

  // Set up next round after pause — lock is held for the full 5-second gap
  setTimeout(() => {
    if (!getRoom(roomCode)) return; // room was deleted (all disconnected)
    startRound(io, roomCode); // startRound() releases the lock at the top
  }, 5000);
  // ── LOCK RELEASED inside startRound() ─────────────────────────────────────
}

// ── Guess handling ────────────────────────────────────────────────────────────

// CS323: MUTEX IN ACTION
// Multiple players can send 'guess' events at the exact same millisecond.
// Node.js processes them one at a time (single-threaded event loop), but
// without the lock, a slow correct-guess handler could be interrupted by
// another guess being processed mid-update.
//
// The lock + hasGuessed flag together form the synchronization mechanism:
//   - lock: prevents processing during round transitions
//   - hasGuessed: prevents a single player from scoring twice

function handleGuess(io, socket, roomCode, message) {
  const room = getRoom(roomCode);
  if (!room) return;
  if (room.state !== 'drawing') return;

  // CS323: CHECK LOCK — reject events during round transitions
  if (room.locked) {
    console.log(`[Sync] Room ${roomCode} | Guess rejected — room is locked (mid-transition)`);
    return;
  }

  const player = room.players[socket.id];
  if (!player || room.currentDrawer === socket.id) return;

  // CS323: RACE CONDITION PREVENTION
  // Two players might send the correct guess within milliseconds.
  // The first one sets hasGuessed = true. The second one hits this check and is rejected.
  if (player.hasGuessed) {
    io.to(roomCode).emit('chat', { name: player.name, message, correct: false, isSystem: false });
    return;
  }

  const isCorrect = message.trim().toLowerCase() === room.currentWord.toLowerCase();

  if (isCorrect) {
    // ── ACQUIRE LOCK for score mutation ───────────────────────────────────────
    room.locked = true;

    player.hasGuessed = true;
    room.correctGuessers.add(socket.id);

    const bonus = Math.ceil((room.timeLeft / ROUND_DURATION) * 150);
    player.score += 100 + bonus;
    room.players[room.currentDrawer].score += 30;

    console.log(`[Guess] Room ${roomCode} | ${player.name} guessed correctly! (+${100 + bonus} pts) | locked=true`);

    io.to(roomCode).emit('correct-guess', {
      playerId: socket.id,
      name: player.name,
      players: getPublicState(room).players
    });

    // ── RELEASE LOCK ──────────────────────────────────────────────────────────
    room.locked = false;

    // Check if all non-drawers have guessed
    const nonDrawers = Object.keys(room.players).filter(id => id !== room.currentDrawer);
    if (room.correctGuessers.size >= nonDrawers.length) {
      clearInterval(room.timer);
      // CS323: All players guessed — trigger atomic round end
      resolveRoundEnd(io, roomCode);
    }
  } else {
    const isClose = levenshtein(message.toLowerCase(), room.currentWord.toLowerCase()) <= 2;
    io.to(roomCode).emit('chat', {
      name: player.name,
      message,
      correct: false,
      isClose,
      isSystem: false
    });
  }
}

// ── Game lifecycle ────────────────────────────────────────────────────────────

function endGame(io, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  clearInterval(room.timer);
  room.state = 'gameover';
  room.locked = false;

  const sorted = Object.values(room.players).sort((a, b) => b.score - a.score);
  console.log(`[Game] Room ${roomCode} | Game over | Winner: ${sorted[0]?.name}`);

  io.to(roomCode).emit('game-over', {
    players: sorted.map(p => ({ name: p.name, score: p.score, avatar: p.avatar }))
  });
}

function resetGame(io, roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  clearInterval(room.timer);
  Object.values(room.players).forEach(p => {
    p.score = 0;
    p.isDrawing = false;
    p.hasGuessed = false;
  });
  room.round = 0;
  room.state = 'lobby';
  room.currentDrawer = null;
  room.currentWord = null;
  room.maskedWord = null;
  room.drawHistory = [];
  room.correctGuessers = new Set();
  room.timeLeft = 0;
  room.locked = false;

  console.log(`[Game] Room ${roomCode} | Reset to lobby`);
  io.to(roomCode).emit('game-reset', { room: getPublicState(room) });
}

// ── Disconnect handling ───────────────────────────────────────────────────────

// CS323: Disconnect is an async event that can arrive at any time —
// even mid-round or mid-transition. We must handle it safely.

function handleDisconnect(io, socket) {
  const roomCode = socket.data.roomCode;
  const room = getRoom(roomCode);
  if (!roomCode || !room) return;

  const name = socket.data.name || 'Someone';
  delete room.players[socket.id];

  console.log(`[Disconnect] ${name} (${socket.id}) left room ${roomCode} | Players left: ${Object.keys(room.players).length}`);

  io.to(roomCode).emit('player-left', {
    playerId: socket.id,
    name,
    room: getPublicState(room)
  });

  // Room is now empty — clean it up
  if (Object.keys(room.players).length === 0) {
    clearInterval(room.timer);
    deleteRoom(roomCode);
    console.log(`[Room] ${roomCode} deleted (empty)`);
    return;
  }

  // Transfer host if the host left
  if (room.host === socket.id) {
    room.host = Object.keys(room.players)[0];
    io.to(roomCode).emit('new-host', { playerId: room.host });
    console.log(`[Room] ${roomCode} | New host: ${room.players[room.host].name}`);
  }

  // If the drawer disconnected mid-round, end the round immediately
  if (room.state === 'drawing' && room.currentDrawer === socket.id) {
    clearInterval(room.timer);
    io.to(roomCode).emit('chat', {
      name: 'System',
      message: `${name} (the drawer) disconnected — ending round early.`,
      isSystem: true
    });
    resolveRoundEnd(io, roomCode);
  }
}

module.exports = {
  startRound,
  resolveRoundEnd,
  handleGuess,
  endGame,
  resetGame,
  handleDisconnect,
  ROUND_DURATION,
  ROUNDS_PER_GAME
};