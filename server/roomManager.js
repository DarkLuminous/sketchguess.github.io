// ─── server/roomManager.js ────────────────────────────────────────────────────
// CS323: Central shared state store — a Map of all active rooms on the server.
// Multiple rooms run in parallel on the same server, each with its own isolated
// game state. This Map is the single source of truth accessed by all socket events.

const { createGameState } = require('./gameState');

// CS323: Shared in-memory store — all concurrent socket events read/write here.
const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId) {
  let code;
  // Guarantee unique code even under concurrent creation
  do { code = generateRoomCode(); } while (rooms.has(code));

  const state = createGameState(code, hostId);
  rooms.set(code, state);
  return code;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function deleteRoom(code) {
  rooms.delete(code);
}

function getAllRooms() {
  return rooms.entries();
}

function getRoomCount() {
  return rooms.size;
}

module.exports = { createRoom, getRoom, deleteRoom, getAllRooms, getRoomCount };