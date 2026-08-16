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
    title: 'In attesa dell\'avvio del film...',
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

  const embedUrl = data.vixUrl || data.embedUrl || data.embed_url || (data.streamUrl && data.streamUrl.includes('embed') ? data.streamUrl : '') || data.streamUrl || '';
  const streamUrl = data.streamUrl || embedUrl;

  if (!rooms[code]) {
    rooms[code] = {
      code,
      title: data.title || 'Film Sincronizzato',
      embedUrl: embedUrl,
      streamUrl: streamUrl,
      time: data.time || 0,
      isPlaying: data.isPlaying ?? true,
      host: data.user || 'Host',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      participants: {}
    };
  } else {
    if (data.title) rooms[code].title = data.title;
    if (embedUrl) rooms[code].embedUrl = embedUrl;
    if (streamUrl) rooms[code].streamUrl = streamUrl;
    if (data.time !== undefined) rooms[code].time = data.time;
    if (data.isPlaying !== undefined) rooms[code].isPlaying = data.isPlaying;
    rooms[code].updatedAt = Date.now();
  }

  // Broadcast via Socket.IO
  io.to(code).emit('sync_event', {
    type: 'stream_sync',
    ...rooms[code],
    senderId: data.senderId || 'server'
  });

  res.json({ success: true, room: rooms[code] });
});

// -------------------------------------------------------------
// WEB APP & SYNC PLAYER PAGE
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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
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
    .controls-bar {
      margin-top: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
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
      z-index: 10;
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
    .sync-indicator-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      color: #cbd5e1;
    }
    .sync-state-pill {
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      padding: 3px 10px;
      border-radius: 10px;
      font-weight: 700;
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
      <div class="waiting-screen" id="waiting-screen">
        <div class="waiting-spinner"></div>
        <h3 style="margin:0 0 8px;" id="waiting-headline">Connesso alla Stanza Sincronizzata</h3>
        <p style="color:var(--muted); margin:0;" id="waiting-desc">Non appena avvii o selezioni il film nell'app, il lettore Vixcloud apparirà qui in streaming simultaneo.</p>
      </div>
      <iframe id="vix-iframe" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" referrerpolicy="no-referrer" style="display:none;"></iframe>
      <div id="emoji-container"></div>
    </div>

    <div class="controls-bar">
      <div class="sync-indicator-bar" id="user-info-bar">
        <span class="sync-state-pill" id="sync-state-badge">⚡ In Attesa</span>
        <span id="sync-details-txt">Sincronizzazione real-time attiva con l'app</span>
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
    const vixIframe = document.getElementById('vix-iframe');
    const emojiContainer = document.getElementById('emoji-container');
    const syncStatus = document.getElementById('sync-status');
    const btnChangeRoom = document.getElementById('btn-change-room');
    const syncStateBadge = document.getElementById('sync-state-badge');
    const syncDetailsTxt = document.getElementById('sync-details-txt');

    roomCodeTxt.textContent = roomCode;

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
      syncStatus.textContent = '🟢 Connesso al Cloud (' + roomCode + ')';
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

    // Auto-poll state every 2.5 seconds
    function pollRoomState() {
      fetch('/api/room/' + roomCode)
        .then(r => r.json())
        .then(res => {
          if (res && res.room && (res.room.embedUrl || res.room.streamUrl)) {
            handleSyncState(res.room);
          }
        })
        .catch(() => {});
    }

    pollRoomState();
    setInterval(pollRoomState, 2500);

    function handleSyncState(data) {
      if (!data) return;

      if (data.title && data.title !== 'In attesa dell\'avvio del film...') {
        filmTitleEl.textContent = data.title;
        document.title = data.title + ' - Watch Party';
      }

      const targetEmbed = data.embedUrl || data.vixUrl || data.streamUrl;
      if (targetEmbed) {
        loadEmbed(targetEmbed);
      }

      if (data.isPlaying !== undefined) {
        if (data.isPlaying) {
          syncStateBadge.textContent = '▶️ In Riproduzione';
          syncStateBadge.style.color = '#4ade80';
          syncStateBadge.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        } else {
          syncStateBadge.textContent = '⏸ In Pausa';
          syncStateBadge.style.color = '#f87171';
          syncStateBadge.style.borderColor = 'rgba(248, 113, 113, 0.4)';
        }
      }

      if (data.time !== undefined && data.time > 0) {
        const mins = Math.floor(data.time / 60);
        const secs = Math.floor(data.time % 60).toString().padStart(2, '0');
        syncDetailsTxt.textContent = '⏱ Posizione film: ' + mins + ':' + secs + ' (Sincronizzato)';
      }

      // Forward sync actions to iframe
      try {
        if (vixIframe && vixIframe.contentWindow) {
          if (data.type === 'play' || data.isPlaying === true) {
            vixIframe.contentWindow.postMessage({ type: 'play', action: 'play' }, '*');
          } else if (data.type === 'pause' || data.isPlaying === false) {
            vixIframe.contentWindow.postMessage({ type: 'pause', action: 'pause' }, '*');
          }
          if (data.time !== undefined) {
            vixIframe.contentWindow.postMessage({ type: 'seek', time: data.time }, '*');
          }
        }
      } catch (e) {}
    }

    function loadEmbed(url) {
      if (!url) return;
      waitingScreen.style.display = 'none';
      vixIframe.style.display = 'block';

      if (vixIframe.src !== url) {
        vixIframe.src = url;
      }
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

  socket.on('join_room', (data) => {
    const code = (data.roomCode || data.code || '').toUpperCase().trim();
    if (!code) return;

    currentRoom = code;
    currentUser = data.user || 'Amico';
    socket.join(code);

    if (!rooms[code]) {
      rooms[code] = {
        code,
        title: data.title || 'Film Sincronizzato',
        embedUrl: data.embedUrl || data.streamUrl || '',
        streamUrl: data.streamUrl || '',
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

    const embedUrl = payload.vixUrl || payload.embedUrl || payload.embed_url || payload.streamUrl || '';

    if (!rooms[code]) {
      rooms[code] = {
        code,
        title: payload.title || 'Film Sincronizzato',
        embedUrl: embedUrl,
        streamUrl: payload.streamUrl || embedUrl,
        time: payload.time || 0,
        isPlaying: payload.isPlaying ?? true,
        host: currentUser || 'Host',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        participants: {}
      };
    } else {
      if (payload.title) rooms[code].title = payload.title;
      if (embedUrl) rooms[code].embedUrl = embedUrl;
      if (payload.streamUrl) rooms[code].streamUrl = payload.streamUrl;
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
