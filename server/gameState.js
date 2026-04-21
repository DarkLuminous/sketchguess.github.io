// ─── server/gameState.js ──────────────────────────────────────────────────────
// CS323: Defines the shared state model for each room.
// The `locked` flag is this project's mutex — it guards all state mutations
// and is the primary synchronization mechanism demonstrated in the defense.

function createGameState(code, hostId) {
  return {
    code,
    host: hostId,
    players: {},           // { [socketId]: { id, name, score, isDrawing, avatar, hasGuessed } }
    state: 'lobby',        // lobby | drawing | between | gameover
    round: 0,
    currentDrawer: null,
    currentWord: null,
    maskedWord: null,
    drawHistory: [],
    timer: null,
    timeLeft: 0,
    correctGuessers: new Set(),
    chat: [],

    // ── CS323 SYNCHRONIZATION MECHANISM ──────────────────────────────────────
    // `locked` is a mutex flag. When true, the room is mid-transition
    // (round ending, score being committed, next round being set up).
    // Any concurrent socket events that arrive during this window are rejected,
    // preventing race conditions on shared state.
    locked: false
  };
}

// Returns a sanitized, public view of room state safe to broadcast to all clients.
// The raw state (currentWord, locked flag, internal timers) is never sent directly.
function getPublicState(room) {
  return {
    code: room.code,
    state: room.state,
    round: room.round,
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isDrawing: p.isDrawing,
      avatar: p.avatar
    })),
    currentDrawer: room.currentDrawer,
    maskedWord: room.maskedWord,
    timeLeft: room.timeLeft,
    // Only reveal the word to everyone after the round ends
    currentWord: room.state === 'between' || room.state === 'gameover'
      ? room.currentWord
      : null
  };
}

module.exports = { createGameState, getPublicState };