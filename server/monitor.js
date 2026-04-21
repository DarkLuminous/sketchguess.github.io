// ─── server/monitor.js ───────────────────────────────────────────────────────
// CS323: DEMONSTRATES PARALLEL ROOMS
// This monitor logs all active rooms every 10 seconds.
// During the defense, run 2+ browser sessions and point to this output
// to show multiple game rooms running in parallel on the same server.
//
// Defense talking point:
//   "Here you can see two rooms in different phases simultaneously —
//    Room A is mid-round (drawing), Room B is between rounds.
//    Both are managed by the same Node.js process using the event loop."

const { getAllRooms, getRoomCount } = require('./roomManager');

function startMonitor() {
  setInterval(() => {
    const count = getRoomCount();
    if (count === 0) {
      console.log(`\n[Monitor] No active rooms.`);
      return;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Monitor] Active rooms: ${count} | ${new Date().toLocaleTimeString()}`);
    console.log(`${'─'.repeat(60)}`);

    for (const [roomId, state] of getAllRooms()) {
      const playerList = Object.values(state.players)
        .map(p => `${p.name}(${p.score})${p.isDrawing ? '✏️' : ''}`)
        .join(', ');

      console.log(
        `  Room ${roomId}` +
        ` | phase: ${state.state.padEnd(10)}` +
        ` | round: ${state.round}` +
        ` | players: ${Object.keys(state.players).length}` +
        ` | locked: ${state.locked}` +
        ` | word: ${state.currentWord ? `"${state.currentWord}"` : 'none'}` +
        ` | timeLeft: ${state.timeLeft}s`
      );
      if (playerList) console.log(`         Players: ${playerList}`);
    }

    console.log(`${'─'.repeat(60)}`);
  }, 10000);

  console.log(`[Monitor] Started — logging every 10s.`);
}

module.exports = { startMonitor };