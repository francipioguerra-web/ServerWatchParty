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

// Clean up inactive rooms older than 12 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (now - (room.updatedAt || 0) > 12 * 60 * 60 * 1000 && Object.keys(room.participants || {}).length === 0) {
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
  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ success: false, error: "Stanza non trovata" });
  }
  res.json({ success: true, room });
});

app.post('/api/room/:code/sync', (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  const data = req.body || {};

  if (!rooms[code]) {
    rooms[code] = {
      code,
      title: data.title || 'Film Sincronizzato',
      streamUrl: data.streamUrl || '',
      time: data.time || 0,
      isPlaying: data.isPlaying ?? true,
      host: data.user || 'Host',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      participants: {}
    };
  } else {
    if (data.title) rooms[code].title = data.title;
    if (data.streamUrl) rooms[code].streamUrl = data.streamUrl;
    if (data.time !== undefined) rooms[code].time = data.time;
    if (data.isPlaying !== undefined) rooms[code].isPlaying = data.isPlaying;
    rooms[code].updatedAt = Date.now();
  }

  // Broadcast via Socket.IO
  io.to(code).emit('state_updated', {
    ...rooms[code],
    senderId: data.senderId || 'server'
  });

  res.json({ success: true, room: rooms[code] });
});

// HTML Landing & Status Page
app.get('/', (req, res) => {
  const partyParam = req.query.party || req.query.room;
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamingCommunity Watch Party Cloud Server</title>
  <style>
    :root {
      --primary: #3b82f6;
      --accent: #a855f7;
      --bg: #0b0f19;
      --card: #131b2e;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, var(--bg) 80%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 580px;
      margin: 20px;
      padding: 36px 32px;
      background: rgba(19, 27, 46, 0.85);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 700;
      margin-bottom: 20px;
    }
    .pulse {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 10px #22c55e;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 1.8rem;
      font-weight: 800;
      background: linear-gradient(135deg, #fff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 0 0 24px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 16px;
      border-radius: 14px;
    }
    .stat-val {
      font-size: 1.4rem;
      font-weight: 800;
      color: #a855f7;
    }
    .stat-lbl {
      font-size: 0.78rem;
      color: var(--muted);
      margin-top: 4px;
    }
    .party-banner {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%);
      border: 1px dashed rgba(168, 85, 247, 0.4);
      padding: 16px;
      border-radius: 14px;
      margin-top: 10px;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="pulse"></span> Server Cloud Online
    </div>
    <h1>Watch Party Sync Hub</h1>
    <p>Server di sincronizzazione in tempo reale per lo streaming sincronizzato a distanza di film e serie TV.</p>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val" id="room-count">${Object.keys(rooms).length}</div>
        <div class="stat-lbl">Stanze Attive</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">WebSocket & REST</div>
        <div class="stat-lbl">Protocollo Sync</div>
      </div>
    </div>

    ${partyParam ? `
    <div class="party-banner">
      🎉 <strong>Sei stato invitato alla stanza: <span style="color:#a855f7; font-size:1.1rem;">${partyParam}</span></strong><br>
      <span style="color: var(--muted); font-size:0.82rem;">Apri l'app StreamingCommunity su Mac/PC o telefono per unirti alla sincronizzazione automatica!</span>
    </div>
    ` : `
    <div class="party-banner">
      ⚡ Connessione WebSocket e Socket.io pronta per StreamingCommunity App.
    </div>
    `}
  </div>
</body>
</html>`);
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
    if (!currentRoom || !rooms[currentRoom]) return;

    if (payload.title) rooms[currentRoom].title = payload.title;
    if (payload.streamUrl) rooms[currentRoom].streamUrl = payload.streamUrl;
    if (payload.time !== undefined) rooms[currentRoom].time = payload.time;
    if (payload.isPlaying !== undefined) rooms[currentRoom].isPlaying = payload.isPlaying;
    rooms[currentRoom].updatedAt = Date.now();

    // Broadcast event to other participants in the room
    socket.to(currentRoom).emit('sync_event', {
      ...payload,
      senderId: socket.id
    });
  });

  socket.on('chat_message', (msg) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat_message', {
      user: currentUser,
      text: msg.text || '',
      time: Date.now(),
      senderId: socket.id
    });
  });

  socket.on('reaction', (reaction) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('reaction', {
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
