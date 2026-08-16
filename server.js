const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

// In-memory rooms repository
const rooms = {};

// Clean up inactive rooms older than 24 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (now - (room.updatedAt || 0) > 24 * 60 * 60 * 1000 && Object.keys(room.participants || {}).length === 0) {
      delete rooms[code];
    }
  }
}, 30 * 60 * 1000);

// -------------------------------------------------------------
// REST API
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    service: "StreamingCommunity WatchParty Server",
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/room/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const room = rooms[code] || {
    code,
    title: 'In attesa dell\'avvio del film dall\'app...',
    vixUrl: '',
    embedUrl: '',
    streamUrl: '',
    time: 0,
    isPlaying: true,
    host: 'Host',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    participants: {}
  };
  res.json({ success: true, room });
});

app.post('/api/room/:code/sync', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const data = req.body || {};

  const vixUrl = data.vixUrl || data.vix_url || data.embedUrl || data.embed_url || data.streamUrl || '';
  const title = data.title || 'Film Sincronizzato';

  console.log(`[HTTP POST SYNC] Stanza: ${code} | Titolo: ${title} | VixURL: ${vixUrl ? vixUrl.substring(0, 60) + '...' : 'NESSUNO'} | Play: ${data.isPlaying} | Time: ${data.time}`);

  if (!rooms[code]) {
    rooms[code] = {
      code,
      title: title,
      vixUrl: vixUrl,
      embedUrl: vixUrl,
      streamUrl: vixUrl,
      time: data.time || 0,
      isPlaying: data.isPlaying ?? true,
      host: data.user || 'Host',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      participants: {}
    };
  } else {
    if (data.title) rooms[code].title = data.title;
    if (vixUrl) {
      rooms[code].vixUrl = vixUrl;
      rooms[code].embedUrl = vixUrl;
      rooms[code].streamUrl = vixUrl;
    }
    if (data.time !== undefined) rooms[code].time = data.time;
    if (data.isPlaying !== undefined) rooms[code].isPlaying = data.isPlaying;
    rooms[code].updatedAt = Date.now();
  }

  // Broadcast via Socket.IO to all connected browsers in this room
  io.to(code).emit('sync_event', {
    type: data.type || 'stream_sync',
    ...rooms[code],
    action: data.action || data.type,
    time: data.time !== undefined ? data.time : rooms[code].time,
    isPlaying: data.isPlaying !== undefined ? data.isPlaying : rooms[code].isPlaying,
    senderId: data.senderId || 'server'
  });

  res.json({ success: true, room: rooms[code] });
});

// -------------------------------------------------------------
// WEB APP & WATCH PARTY SYNCHRONIZATION HUB
// -------------------------------------------------------------
function renderPlayerPage(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamingCommunity Watch Party Sincronizzato</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="/socket.io/socket.io.js"></script>
  <style>
    :root {
      --primary: #3b82f6;
      --accent: #a855f7;
      --bg: #090d16;
      --card: rgba(19, 27, 46, 0.85);
      --border: rgba(255, 255, 255, 0.1);
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 10%, #1e1b4b 0%, var(--bg) 80%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .header {
      width: 100%;
      max-width: 1100px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 1.1rem;
      background: linear-gradient(135deg, #fff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 10px #22c55e;
    }
    .main-box {
      width: 95%;
      max-width: 1100px;
      background: var(--card);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 20px 24px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.7);
      margin-bottom: 25px;
    }
    .player-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .movie-title {
      font-size: 1.35rem;
      font-weight: 800;
      margin: 0;
      color: #fff;
    }
    .room-badge-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .room-badge {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: #c084fc;
      padding: 6px 14px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 0.88rem;
    }
    .video-wrapper {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 10px 35px rgba(0,0,0,0.8);
      border: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      position: absolute;
      inset: 0;
      z-index: 5;
    }
    .sync-overlay-hud {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.15);
      padding: 8px 16px;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      pointer-events: auto;
    }
    .waiting-screen {
      text-align: center;
      padding: 40px 20px;
      z-index: 2;
    }
    .waiting-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(168, 85, 247, 0.2);
      border-top-color: #a855f7;
      border-radius: 50%;
      animation: spin 1s infinite linear;
      margin: 0 auto 16px;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    .vix-action-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      margin-top: 18px;
    }
    .vix-btn-open {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #a855f7 0%, #3b82f6 100%);
      color: #fff;
      font-size: 1.05rem;
      font-weight: 700;
      padding: 14px 28px;
      border-radius: 16px;
      text-decoration: none;
      box-shadow: 0 10px 25px rgba(168, 85, 247, 0.4);
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
    }
    .vix-btn-open:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(168, 85, 247, 0.6);
    }
    .sync-controls-panel {
      margin-top: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      background: rgba(255,255,255,0.03);
      padding: 12px 18px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .sync-btn-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sync-ctrl-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
      padding: 8px 16px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 0.88rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .sync-ctrl-btn:hover {
      background: rgba(168, 85, 247, 0.3);
      border-color: rgba(168, 85, 247, 0.5);
    }
    .reactions {
      display: flex;
      gap: 8px;
    }
    .react-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #fff;
      font-size: 1.2rem;
      padding: 6px 12px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .react-btn:hover {
      transform: scale(1.15);
      background: rgba(168, 85, 247, 0.25);
    }
    .floating-emoji {
      position: absolute;
      bottom: 20px;
      font-size: 2.2rem;
      animation: floatUp 2.5s forwards cubic-bezier(0.1, 0.8, 0.3, 1);
      pointer-events: none;
      z-index: 30;
    }
    @keyframes floatUp {
      0% { opacity: 1; transform: translateY(0) scale(0.8); }
      100% { opacity: 0; transform: translateY(-200px) scale(1.6); }
    }
    .room-input-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .sync-state-pill {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 700;
      transition: all 0.3s ease;
      font-size: 0.88rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-badge">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
      <span>StreamingCommunity Watch Party</span>
    </div>
    <div class="status-pill">
      <span class="status-dot"></span>
      <span id="sync-status">Cloud Sync Attivo</span>
    </div>
  </div>

  <div class="main-box" id="main-container">
    <div class="player-header">
      <h1 class="movie-title" id="film-title">In attesa dell'avvio del film dall'app...</h1>
      <div class="room-badge-container">
        <div class="room-badge" id="room-badge">Stanza: <strong id="room-code-txt">CARICAMENTO...</strong></div>
        <button class="room-input-btn" id="btn-change-room" title="Inserisci o cambia codice stanza">Cambia Stanza</button>
      </div>
    </div>

    <div class="video-wrapper" id="video-wrapper">
      <div class="sync-overlay-hud" id="hud-bar" style="display:none;">
        <span class="sync-state-pill" id="hud-status-badge">▶️ In Riproduzione</span>
        <span id="hud-time-txt" style="font-weight:700; color:#fff;">⏱ 00:00</span>
      </div>

      <div class="waiting-screen" id="waiting-screen">
        <div class="waiting-spinner"></div>
        <h3 style="margin:0 0 8px;" id="waiting-headline">Stanza Watch Party Connessa</h3>
        <p style="color:var(--muted); margin:0 0 16px;" id="waiting-desc">Non appena clicchi sull'icona 🔗 o avvii il film nell'app, il link Vixcloud e la sincronizzazione si attiveranno qui.</p>
        
        <div class="vix-action-card" id="vix-action-card" style="display:none;">
          <a href="#" target="_blank" rel="noreferrer" id="btn-vix-direct" class="vix-btn-open">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <span>Apri Player Vixcloud Diretto</span>
          </a>
          <span style="font-size:0.82rem; color:var(--muted);">Usa questa finestra come telecomando sincronizzato in tempo reale!</span>
        </div>
      </div>

      <iframe id="vix-frame" src="" referrerpolicy="no-referrer" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen style="display:none;"></iframe>
      <div id="emoji-container"></div>
    </div>

    <div class="sync-controls-panel">
      <div class="sync-btn-group">
        <button class="sync-ctrl-btn" onclick="sendSyncAction('play')">▶️ Play</button>
        <button class="sync-ctrl-btn" onclick="sendSyncAction('pause')">⏸️ Pausa</button>
        <button class="sync-ctrl-btn" onclick="sendSyncAction('seek_back')">⏪ -10s</button>
        <button class="sync-ctrl-btn" onclick="sendSyncAction('seek_fwd')">⏩ +10s</button>
      </div>
      <div class="reactions">
        <button class="react-btn" onclick="sendEmoji('🍿')">🍿</button>
        <button class="react-btn" onclick="sendEmoji('🔥')">🔥</button>
        <button class="react-btn" onclick="sendEmoji('😂')">😂</button>
        <button class="react-btn" onclick="sendEmoji('❤️')">❤️</button>
        <button class="react-btn" onclick="sendEmoji('😱')">😱</button>
      </div>
    </div>
  </div>

  <script>
    function extractRoomCode() {
      const urlParams = new URLSearchParams(window.location.search);
      let code = urlParams.get('party') || urlParams.get('room');
      if (code) return code.toUpperCase().trim();

      const path = window.location.pathname.replace(/^\\/+/, '').trim();
      if (path && !path.startsWith('api') && path !== 'health') {
        const segments = path.split('/');
        const last = segments[segments.length - 1].toUpperCase().trim();
        if (last.startsWith('SC-') || last.length >= 4) return last;
      }
      return '';
    }

    let roomCode = extractRoomCode();
    if (!roomCode) {
      roomCode = 'SC-' + Math.floor(1000 + Math.random() * 9000);
      window.history.replaceState({}, '', '/?party=' + roomCode);
    }

    const filmTitleEl = document.getElementById('film-title');
    const roomCodeTxt = document.getElementById('room-code-txt');
    const waitingScreen = document.getElementById('waiting-screen');
    const waitingHeadline = document.getElementById('waiting-headline');
    const waitingDesc = document.getElementById('waiting-desc');
    const vixActionCard = document.getElementById('vix-action-card');
    const btnVixDirect = document.getElementById('btn-vix-direct');
    const vixFrame = document.getElementById('vix-frame');
    const hudBar = document.getElementById('hud-bar');
    const hudStatusBadge = document.getElementById('hud-status-badge');
    const hudTimeTxt = document.getElementById('hud-time-txt');
    const emojiContainer = document.getElementById('emoji-container');
    const syncStatus = document.getElementById('sync-status');
    const btnChangeRoom = document.getElementById('btn-change-room');

    roomCodeTxt.textContent = roomCode;
    let currentVixUrl = null;
    let currentFilmTime = 0;
    let isFilmPlaying = true;

    if (btnChangeRoom) {
      btnChangeRoom.addEventListener('click', () => {
        const newCode = prompt("Inserisci il codice della stanza (es. SC-1234):", roomCode);
        if (newCode && newCode.trim()) {
          const clean = newCode.toUpperCase().trim();
          window.location.href = '/?party=' + clean;
        }
      });
    }

    const socket = io();

    socket.on('connect', () => {
      syncStatus.textContent = '🟢 Cloud Online (' + roomCode + ')';
      socket.emit('join_room', {
        roomCode: roomCode,
        user: 'Ospite Web ' + Math.floor(Math.random() * 100)
      });
    });

    socket.on('initial_state', (data) => {
      handleSyncState(data);
    });

    socket.on('sync_event', (data) => {
      handleSyncState(data);
    });

    socket.on('state_updated', (data) => {
      handleSyncState(data);
    });

    socket.on('reaction', (data) => {
      spawnEmoji(data.emoji);
    });

    // Auto-poll state every 1.5 seconds for instant backup
    function pollRoomState() {
      fetch('/api/room/' + roomCode)
        .then(r => r.json())
        .then(res => {
          if (res && res.room && (res.room.vixUrl || res.room.embedUrl || res.room.streamUrl)) {
            handleSyncState(res.room);
          }
        })
        .catch(() => {});
    }

    pollRoomState();
    setInterval(pollRoomState, 1500);

    function handleSyncState(data) {
      if (!data) return;

      if (data.title && data.title !== 'In attesa dell\'avvio del film dall\'app...') {
        filmTitleEl.textContent = data.title;
        document.title = data.title + ' - Watch Party';
      }

      const targetVixUrl = data.vixUrl || data.embedUrl || data.streamUrl;
      if (targetVixUrl && targetVixUrl !== currentVixUrl) {
        currentVixUrl = targetVixUrl;
        vixActionCard.style.display = 'flex';
        btnVixDirect.href = targetVixUrl;
        waitingHeadline.textContent = '🎬 Film Pronto!';
        waitingDesc.textContent = 'Clicca sul pulsante qui sotto per aprire il player originale di Vixcloud a schermo intero senza blocchi:';
        
        hudBar.style.display = 'flex';

        // Also try embedded iframe with no-referrer
        vixFrame.src = targetVixUrl;
        vixFrame.style.display = 'block';
        waitingScreen.style.display = 'none';
      }

      if (data.isPlaying !== undefined) {
        isFilmPlaying = data.isPlaying;
        if (isFilmPlaying) {
          hudStatusBadge.textContent = '▶️ In Riproduzione';
          hudStatusBadge.style.color = '#4ade80';
          hudStatusBadge.style.borderColor = 'rgba(34, 197, 94, 0.4)';
          hudStatusBadge.style.background = 'rgba(34, 197, 94, 0.15)';
        } else {
          hudStatusBadge.textContent = '⏸ In Pausa';
          hudStatusBadge.style.color = '#f87171';
          hudStatusBadge.style.borderColor = 'rgba(248, 113, 113, 0.4)';
          hudStatusBadge.style.background = 'rgba(248, 113, 113, 0.15)';
        }
      }

      if (data.time !== undefined) {
        currentFilmTime = data.time;
        const mins = Math.floor(currentFilmTime / 60);
        const secs = Math.floor(currentFilmTime % 60).toString().padStart(2, '0');
        hudTimeTxt.textContent = '⏱ ' + mins + ':' + secs + ' (Sincronizzato)';
      }

      // Forward postMessage to embedded iframe if active
      if (vixFrame && vixFrame.contentWindow) {
        try {
          if (data.type === 'play' || isFilmPlaying === true) {
            vixFrame.contentWindow.postMessage({ type: 'play', action: 'play' }, '*');
          } else if (data.type === 'pause' || isFilmPlaying === false) {
            vixFrame.contentWindow.postMessage({ type: 'pause', action: 'pause' }, '*');
          }
        } catch (e) {}
      }
    }

    function sendSyncAction(action) {
      let newTime = currentFilmTime;
      let playing = isFilmPlaying;

      if (action === 'play') {
        playing = true;
      } else if (action === 'pause') {
        playing = false;
      } else if (action === 'seek_back') {
        newTime = Math.max(0, currentFilmTime - 10);
      } else if (action === 'seek_fwd') {
        newTime = currentFilmTime + 10;
      }

      socket.emit('sync_event', {
        roomCode: roomCode,
        type: action,
        isPlaying: playing,
        time: newTime
      });

      fetch('/api/room/' + roomCode + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: action,
          isPlaying: playing,
          time: newTime,
          user: 'Ospite Web'
        })
      }).catch(() => {});
    }

    function sendEmoji(emoji) {
      spawnEmoji(emoji);
      socket.emit('reaction', { roomCode: roomCode, emoji: emoji });
    }

    function spawnEmoji(emoji) {
      const el = document.createElement('div');
      el.className = 'floating-emoji';
      el.textContent = emoji;
      el.style.left = Math.floor(20 + Math.random() * 60) + '%';
      emojiContainer.appendChild(el);
      setTimeout(() => el.remove(), 2500);
    }
  </script>
</body>
</html>`);
}

// Intercept all GET requests (except /health and /api) to render the player page
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }
  renderPlayerPage(req, res);
});

// -------------------------------------------------------------
// SOCKET.IO REALTIME ENGINE
// -------------------------------------------------------------
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  console.log(`[SOCKET CONNECT] Nuovo socket connesso: ${socket.id}`);

  socket.on('join_room', (data) => {
    const code = (data.roomCode || data.code || '').toUpperCase().trim();
    if (!code) return;

    currentRoom = code;
    currentUser = data.user || 'Amico';
    socket.join(code);

    console.log(`[SOCKET JOIN] Utente '${currentUser}' è entrato nella stanza '${code}'`);

    if (!rooms[code]) {
      rooms[code] = {
        code,
        title: data.title || 'Film Sincronizzato',
        vixUrl: data.vixUrl || '',
        embedUrl: data.vixUrl || '',
        streamUrl: data.vixUrl || '',
        time: data.time || 0,
        isPlaying: data.isPlaying ?? true,
        host: currentUser,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        participants: {}
      };
    }

    rooms[code].participants[socket.id] = {
      name: currentUser,
      avatar: data.avatar || '',
      joinedAt: Date.now()
    };

    // Send current state to newly joined user
    socket.emit('initial_state', rooms[code]);

    // Broadcast user joined
    socket.to(code).emit('user_joined', {
      user: currentUser,
      avatar: data.avatar || '',
      participantsCount: Object.keys(rooms[code].participants).length
    });
  });

  socket.on('sync_event', (payload) => {
    const code = (payload.roomCode || currentRoom || '').toUpperCase().trim();
    if (!code) return;

    const vixUrl = payload.vixUrl || payload.vix_url || payload.embedUrl || payload.streamUrl || '';

    console.log(`[SOCKET SYNC] Stanza: ${code} | Evento: ${payload.type} | VixUrl: ${vixUrl ? 'PRESENTE' : 'NONE'} | Time: ${payload.time}`);

    if (!rooms[code]) {
      rooms[code] = {
        code,
        title: payload.title || 'Film Sincronizzato',
        vixUrl: vixUrl,
        embedUrl: vixUrl,
        streamUrl: vixUrl,
        time: payload.time || 0,
        isPlaying: payload.isPlaying ?? true,
        host: currentUser || 'Host',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        participants: {}
      };
    } else {
      if (payload.title) rooms[code].title = payload.title;
      if (vixUrl) {
        rooms[code].vixUrl = vixUrl;
        rooms[code].embedUrl = vixUrl;
        rooms[code].streamUrl = vixUrl;
      }
      if (payload.time !== undefined) rooms[code].time = payload.time;
      if (payload.isPlaying !== undefined) rooms[code].isPlaying = payload.isPlaying;
      rooms[code].updatedAt = Date.now();
    }

    // Broadcast event to other participants in the room
    socket.to(code).emit('sync_event', {
      ...rooms[code],
      ...payload,
      senderId: socket.id
    });
  });

  socket.on('chat_message', (msg) => {
    const code = (msg.roomCode || currentRoom || '').toUpperCase().trim();
    if (!code) return;
    io.to(code).emit('chat_message', {
      user: currentUser,
      text: msg.text || '',
      time: Date.now(),
      senderId: socket.id
    });
  });

  socket.on('reaction', (reaction) => {
    const code = (reaction.roomCode || currentRoom || '').toUpperCase().trim();
    if (!code) return;
    socket.to(code).emit('reaction', {
      emoji: reaction.emoji || '❤️',
      user: currentUser
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].participants[socket.id];
      socket.to(currentRoom).emit('user_left', {
        user: currentUser,
        participantsCount: Object.keys(rooms[currentRoom].participants).length
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(` 🚀 WATCH PARTY REALTIME SYNC SERVER ATTIVO`);
  console.log(` • In ascolto su: http://0.0.0.0:${PORT}`);
  console.log(` • Pronto per deploy su Render.com`);
  console.log(`========================================================`);
});
