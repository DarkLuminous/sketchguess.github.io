// ─── public/game.js ───────────────────────────────────────────────────────────
// CS323: Client-side logic.
// Communicates with the server via Socket.io (WebSocket / async I/O).
// All game state lives on the SERVER — the client only renders what the server sends.
// This is the "network communication" layer of the distributed system.

// ─── Global state ─────────────────────────────────────────────────────────────
let socket;
let myId, myRoomCode, isHost = false, isDrawing = false;
let currentWord = null;

let canvas, ctx;
let drawingFlag = false, lastX = 0, lastY = 0;
let currentColor = '#000000', currentSize = 5, eraserMode = false;
let selectedAvatar = '🐼';

const AVATAR_LIST = [
  '🐶','🐱','🐭','🐹','🐰','🦊',
  '🐻','🐼','🐨','🐸','🐙','🦄',
  '🐧','🐦','🐌','🎃','🤖','👻','⭐','🌈'
];

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

// ─── Avatar Picker ────────────────────────────────────────────────────────────
function buildAvatarPicker() {
  const container = document.getElementById('avatar-selector');
  if (!container) return;
  container.innerHTML = '';
  AVATAR_LIST.forEach(emoji => {
    const div = document.createElement('div');
    div.className = 'char-option' + (selectedAvatar === emoji ? ' active' : '');
    div.textContent = emoji;
    div.onclick = () => {
      selectedAvatar = emoji;
      document.querySelectorAll('.char-option').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
    };
    container.appendChild(div);
  });
}

// ─── Socket & Room Logic ──────────────────────────────────────────────────────

function initSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => { myId = socket.id; });

  socket.on('room-joined', ({ code, playerId, room }) => {
    myId = playerId;
    myRoomCode = code;
    isHost = room.players[0]?.id === myId;

    if (room.state !== 'lobby') {
      showGame();
      updateGameState(room);
      isDrawing = (room.currentDrawer === myId);
      setupDrawingMode();
      setupChatMode();
      updateFloatingArtist(room);
      if (isDrawing) showDrawerHintTemporary();
      socket.emit('request-history');
    } else {
      showWaiting(room);
    }
  });

  socket.on('player-joined', ({ player, room }) => {
    updateWaiting(room);
    addSystemMsg(`${escapeHtml(player.name)} joined!`);
    if (document.getElementById('game').style.display === 'grid') {
      updateLeaderboardUI(room.players);
    }
  });

  socket.on('player-left', ({ name, room }) => {
    updateWaiting(room);
    addSystemMsg(`${escapeHtml(name)} left.`);
    if (document.getElementById('game').style.display === 'grid') {
      updateLeaderboardUI(room.players);
    }
  });

  socket.on('new-host', ({ playerId }) => {
    if (playerId === myId) {
      isHost = true;
      document.getElementById('start-btn').style.display = 'block';
      addSystemMsg('You are the new host!');
    }
  });

  socket.on('round-start', (room) => {
    hideOverlays();
    showGame();
    isDrawing = (room.currentDrawer === myId);
    updateGameState(room);
    setupDrawingMode();
    setupChatMode();
    updateFloatingArtist(room);

    if (isDrawing) {
      addSystemMsg('🎨 You are drawing!');
      showDrawerHintTemporary();
      if (currentWord) {
        document.getElementById('word-display').innerHTML =
          `✏️ DRAW: ${currentWord.toUpperCase()}`;
      }
    } else {
      const drawer = room.players.find(p => p.id === room.currentDrawer);
      addSystemMsg(`✏️ ${escapeHtml(drawer?.name || 'Someone')} is drawing!`);
    }
  });

  socket.on('your-word', ({ word }) => {
    currentWord = word;
    document.getElementById('word-display').innerHTML =
      `<span style="font-size:0.7rem;">DRAW THIS ✏️</span><br>${word.toUpperCase()}`;
  });

  socket.on('word-hint', ({ maskedWord }) => {
    if (!isDrawing) document.getElementById('word-display').textContent = maskedWord.toUpperCase();
  });

  socket.on('draw', (data) => { if (!isDrawing) renderStroke(data); });
  socket.on('clear-canvas', () => { if (ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } });
  socket.on('draw-history', ({ history }) => { history.forEach(d => renderStroke(d)); });
  socket.on('timer', ({ timeLeft }) => updateTimer(timeLeft));

  socket.on('correct-guess', ({ playerId, name, players }) => {
    updateLeaderboardUI(players);
    addSystemMsg(`✅ ${escapeHtml(name)} guessed correctly!`, 'correct');
    if (playerId === myId) triggerConfetti();
  });

  socket.on('chat', ({ name, message, isClose }) => {
    addChatMsg(name, message, false, isClose);
  });

  socket.on('round-end', ({ word, players }) => {
    document.getElementById('revealed-word').textContent = word.toUpperCase();
    document.getElementById('round-end-overlay').classList.add('show');
    updateLeaderboardUI(players);
    isDrawing = false;
    setupDrawingMode();
    setupChatMode();
    updateFloatingArtist(null);
  });

  socket.on('game-over', ({ players }) => {
    const sb = document.getElementById('final-scoreboard');
    sb.innerHTML = players
      .map((p, i) => `<li><span>${['🥇','🥈','🥉'][i] || (i + 1) + '.'}</span> <span>${escapeHtml(p.name)}</span> <strong>${p.score}</strong></li>`)
      .join('');
    document.getElementById('gameover-overlay').classList.add('show');
    triggerConfetti();
  });

  socket.on('game-reset', ({ room }) => {
    hideOverlays();
    showWaiting(room);
    addSystemMsg('New game ready!');
  });

  socket.on('error', ({ message }) => showError(message));
}

// ─── Room actions ─────────────────────────────────────────────────────────────

function createRoom() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) return showError('Enter your name');
  if (!selectedAvatar) selectedAvatar = '🐼';
  initSocket();
  socket.emit('create-room', { name, avatar: selectedAvatar });
  isHost = true;
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name || !code) return showError('Name & room code required');
  initSocket();
  socket.emit('join-room', { code, name, avatar: selectedAvatar });
}

function startGame() { socket.emit('start-game'); }
function newGame()   { if (isHost) socket.emit('new-game'); else addSystemMsg('Only the host can start a new game.'); }

function exitToLobby() {
  if (socket) socket.disconnect();
  location.reload();
}

function showError(msg) {
  const el = document.getElementById('lobby-error');
  if (el) { el.textContent = msg; setTimeout(() => el.textContent = '', 3000); }
}

// ─── UI screens ───────────────────────────────────────────────────────────────

function showWaiting(room) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('waiting').style.display = 'flex';
  document.getElementById('game').style.display = 'none';
  document.getElementById('waiting-code').textContent = room.code;
  document.getElementById('start-btn').style.display = isHost ? 'block' : 'none';
  updateWaiting(room);
}

function updateWaiting(room) {
  if (!room) return;
  const grid = document.getElementById('waiting-players');
  if (grid) {
    grid.innerHTML = room.players
      .map(p => `
        <div class="player-chip ${p.id === room.players[0]?.id ? 'host' : ''}">
          <div class="player-avatar">${p.avatar || '🐼'}</div>
          <span>${escapeHtml(p.name)}</span>
          ${p.id === room.players[0]?.id ? '👑' : ''}
        </div>`)
      .join('');
  }
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = room.players.length;
}

function showGame() {
  document.getElementById('waiting').style.display = 'none';
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'grid';
  initCanvas();
  if (myRoomCode) document.getElementById('game-room-code').textContent = `ROOM: ${myRoomCode}`;
}

function updateGameState(room) {
  document.getElementById('top-round').textContent = room.round;
  if (!isDrawing && room.maskedWord) {
    document.getElementById('word-display').textContent = room.maskedWord.toUpperCase();
  }
  updateLeaderboardUI(room.players);
  updateTimer(room.timeLeft);
}

function updateLeaderboardUI(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const container = document.getElementById('leaderboard');
  container.innerHTML = sorted.map((p, idx) => {
    const medal = ['🥇 ', '🥈 ', '🥉 '][idx] || '';
    return `<div class="player-row ${p.isDrawing ? 'drawing' : ''}"
      style="${idx < 3 ? 'background:rgba(255,209,102,0.1); border-left:3px solid var(--accent2);' : ''}">
      <div class="player-avatar-sm">${p.avatar || '🎨'}</div>
      <span>${medal}${escapeHtml(p.name)}</span>
      ${p.isDrawing ? '<span style="font-size:0.7rem;">✏️</span>' : ''}
      <span class="score">${p.score}</span>
    </div>`;
  }).join('');
}

function updateFloatingArtist(room) {
  const floatingDiv = document.getElementById('floating-artist');
  if (!floatingDiv) return;
  if (room && room.currentDrawer) {
    const drawer = room.players.find(p => p.id === room.currentDrawer);
    if (drawer) {
      document.getElementById('artist-avatar').textContent = drawer.avatar || '🎨';
      document.getElementById('artist-name').textContent = `${escapeHtml(drawer.name)} is drawing!`;
      floatingDiv.style.display = 'flex';
      return;
    }
  }
  floatingDiv.style.display = 'none';
}

function setupDrawingMode() {
  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', !isDrawing);
  if (canvas) canvas.style.cursor = isDrawing ? 'crosshair' : 'default';
}

// Disable chat input for the drawer — they know the word so guessing makes no sense
function setupChatMode() {
  const input  = document.getElementById('guess-input');
  const btn    = document.querySelector('.chat-input-wrap button');
  const wrap   = document.querySelector('.chat-input-wrap');
  if (!input) return;

  if (isDrawing) {
    input.disabled    = true;
    input.placeholder = '🎨 You are drawing — no guessing!';
    if (btn)  btn.disabled  = true;
    if (wrap) wrap.style.opacity = '0.4';
  } else {
    input.disabled    = false;
    input.placeholder = 'Type your guess…';
    if (btn)  btn.disabled  = false;
    if (wrap) wrap.style.opacity = '1';
  }
}

function showDrawerHintTemporary() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute; bottom:70px; background:var(--accent); padding:8px 20px; border-radius:40px;';
  banner.innerText = '✏️ You are the artist! Draw the word!';
  document.querySelector('.canvas-wrap')?.appendChild(banner);
  setTimeout(() => banner.remove(), 3000);
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function initCanvas() {
  canvas = document.getElementById('drawing-canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  buildToolbarUI();
  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', doDraw);
  canvas.addEventListener('pointerup', endDraw);
  socket.emit('request-history');
}

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;

  // On mobile the wrap can be very short — use its real dimensions.
  // Give 60px headroom for the floating toolbar at the bottom.
  const maxW = wrapW - 16;
  const maxH = wrapH - 60;

  // Keep a 3:2 aspect ratio; never exceed 700px wide
  let w = Math.min(maxW, 700);
  let h = Math.round(w * (2 / 3));

  // If height doesn't fit, constrain by height instead
  if (h > maxH) {
    h = maxH;
    w = Math.round(h * (3 / 2));
  }

  // Don't let canvas go below a usable minimum
  w = Math.max(w, 100);
  h = Math.max(h, 60);

  canvas.width  = w;
  canvas.height = h;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function startDraw(e) {
  if (!isDrawing) return;
  drawingFlag = true;
  const pos = getPos(e);
  lastX = pos.x; lastY = pos.y;
  e.preventDefault();
}

let lastEmitTime = 0;

function doDraw(e) {
  if (!drawingFlag || !isDrawing) return;
  const pos = getPos(e);
  const data = {
    x0: lastX, y0: lastY, x1: pos.x, y1: pos.y,
    color: eraserMode ? '#ffffff' : currentColor,
    size: eraserMode ? currentSize * 3 : currentSize
  };
  renderStroke(data);

  // Throttle socket emits to ~60fps — prevents flooding the server on mobile
  const now = Date.now();
  if (now - lastEmitTime >= 16) {
    socket.emit('draw', data); // CS323: message passing — stroke sent to server
    lastEmitTime = now;
  }

  lastX = pos.x; lastY = pos.y;
  e.preventDefault();
}

function endDraw() { drawingFlag = false; }

function renderStroke(d) {
  ctx.beginPath();
  ctx.moveTo(d.x0, d.y0);
  ctx.lineTo(d.x1, d.y1);
  ctx.strokeStyle = d.color;
  ctx.lineWidth   = d.size;
  ctx.lineCap     = 'round';
  ctx.stroke();
}

function clearCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear-canvas');
}

function toggleEraser() {
  eraserMode = !eraserMode;
  document.getElementById('eraser-btn')?.classList.toggle('active', eraserMode);
}

function buildToolbarUI() {
  const COLORS = [
    '#000000','#ffffff','#ef4444','#f97316',
    '#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4'
  ];

  const paletteDiv = document.getElementById('color-palette');
  paletteDiv.innerHTML = '';
  COLORS.forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (c === currentColor ? ' active' : '');
    swatch.style.backgroundColor = c;
    swatch.onclick = () => {
      currentColor = c;
      eraserMode = false;
      document.getElementById('eraser-btn')?.classList.remove('active');
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    };
    paletteDiv.appendChild(swatch);
  });

  const sizes = [3, 7, 12];
  const sizeDiv = document.getElementById('size-btns');
  sizeDiv.innerHTML = '';
  sizes.forEach((sz, i) => {
    const btn = document.createElement('button');
    btn.className = 'size-btn' + (sz === currentSize ? ' active' : '');
    btn.style.cssText = `width:${16 + i * 8}px; height:${16 + i * 8}px; background:var(--muted);`;
    btn.onclick = () => {
      currentSize = sz;
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    sizeDiv.appendChild(btn);
  });
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function updateTimer(t) {
  t = t || 0;
  document.getElementById('timer-text').innerText = t;
  const circ = 2 * Math.PI * 18;
  document.getElementById('timer-arc').setAttribute('stroke-dashoffset', circ * (1 - t / 80));
}

// ─── Chat / Guesses ───────────────────────────────────────────────────────────

function sendGuess() {
  if (isDrawing) return; // drawer cannot guess
  const input = document.getElementById('guess-input');
  const msg = input.value.trim();
  if (msg) {
    socket.emit('guess', { message: msg }); // CS323: message passing to server
    input.value = '';
  }
}

function addChatMsg(name, message, correct = false, isClose = false) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${correct ? 'correct' : ''} ${isClose ? 'close' : ''}`;
  div.innerHTML = `<span class="sender">${escapeHtml(name)}:</span> ${escapeHtml(message)}${isClose ? ' 🔥 close!' : ''}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  notifyMobileChat();
}

function addSystemMsg(msg, cls = '') {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `chat-msg system ${cls}`;
  div.innerText = msg;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  notifyMobileChat();
}

function hideOverlays() {
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show'));
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function triggerConfetti() {
  const cc = document.getElementById('confetti');
  const cx = cc.getContext('2d');
  cc.width  = window.innerWidth;
  cc.height = window.innerHeight;
  const parts = Array.from({ length: 100 }, () => ({
    x: Math.random() * cc.width,
    y: Math.random() * -cc.height,
    r: Math.random() * 6 + 4,
    d: Math.random() * 2 + 1,
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    tilt: 0
  }));
  let frame = 0;
  function draw() {
    cx.clearRect(0, 0, cc.width, cc.height);
    parts.forEach(p => {
      p.y += p.d + 1.5;
      cx.fillStyle = p.color;
      cx.beginPath();
      cx.ellipse(p.x + p.tilt, p.y, p.r, p.r / 2, 0, 0, Math.PI * 2);
      cx.fill();
    });
    frame++;
    if (frame < 150) requestAnimationFrame(draw);
    else cx.clearRect(0, 0, cc.width, cc.height);
  }
  draw();
}

// ─── Mobile tab switching ─────────────────────────────────────────────────────
// Only active on mobile (≤700px). Tabs switch between canvas, leaderboard, chat.

function switchMobileTab(tab) {
  // Update tab button states
  document.querySelectorAll('.mobile-tab').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById('tab-' + tab);
  if (activeBtn) activeBtn.classList.add('active');

  // Hide both panels first
  const left  = document.querySelector('.sidebar-left');
  const right = document.querySelector('.sidebar-right');
  if (left)  left.classList.remove('mobile-panel-active');
  if (right) right.classList.remove('mobile-panel-active');

  if (tab === 'scores' && left)  left.classList.add('mobile-panel-active');
  if (tab === 'chat'   && right) right.classList.add('mobile-panel-active');

  // If switching to chat, auto-scroll to latest message
  if (tab === 'chat') {
    const box = document.getElementById('chat-messages');
    if (box) setTimeout(() => box.scrollTop = box.scrollHeight, 50);
  }
}

// Auto-switch to chat tab on mobile when a new guess/message arrives
function notifyMobileChat() {
  const chatTab = document.getElementById('tab-chat');
  if (!chatTab) return;
  // Only add badge if not already on chat tab
  if (!chatTab.classList.contains('active')) {
    chatTab.style.color = 'var(--accent)';
    setTimeout(() => { chatTab.style.color = ''; }, 2000);
  }
}

// ─── Init ───────────────────────────────────────────────────────────────
buildAvatarPicker();