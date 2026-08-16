const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CANDIDATE_DOMAINS = [
  'https://streamingcommunityz.luxe',
  'https://streamingcommunityz.miami',
  'https://streamingcommunityz.boats',
  'https://streamingcommunityz.hair',
  'https://streamingcommunityz.bio'
];
let activeScDomain = CANDIDATE_DOMAINS[0];

// In-memory data store for Users, Friendships, and Notifications
const users = {}; // email -> { email, name, avatar, lastSeen }
const friendships = {}; // email -> { friends: Set of emails, incoming: Set of emails, outgoing: Set of emails }
const notifications = {}; // email -> Array of { id, type, fromEmail, fromName, filmTitle, streamUrl, poster, timestamp, read }

function getOrCreateUserRelations(email) {
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail) return null;

  if (!friendships[normEmail]) {
    friendships[normEmail] = {
      friends: new Set(),
      incoming: new Set(),
      outgoing: new Set()
    };
  }
  if (!notifications[normEmail]) {
    notifications[normEmail] = [];
  }
  return friendships[normEmail];
}

function unescapeHtml(safe) {
  if (!safe) return '';
  return safe
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");
}

async function fetchWithFallback(pathUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  for (const domain of CANDIDATE_DOMAINS) {
    try {
      const target = `${domain}${pathUrl.startsWith('/') ? pathUrl : '/' + pathUrl}`;
      const res = await fetch(target, { headers, redirect: 'follow' });
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('data-page')) {
          activeScDomain = domain;
          return { domain, text };
        }
      }
    } catch (e) {}
  }
  return null;
}

// -------------------------------------------------------------
// USER AUTH & PROFILE APIs
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, name, avatar } = req.body || {};
  const normEmail = (email || '').toLowerCase().trim();

  if (!normEmail) {
    return res.status(400).json({ success: false, error: 'Email richiesta per il login' });
  }

  users[normEmail] = {
    email: normEmail,
    name: name || normEmail.split('@')[0],
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || normEmail.split('@')[0])}&background=6366f1&color=fff&size=128`,
    lastSeen: Date.now()
  };

  getOrCreateUserRelations(normEmail);

  res.json({
    success: true,
    user: users[normEmail]
  });
});

// -------------------------------------------------------------
// FRIENDS MANAGEMENT APIs
// -------------------------------------------------------------
app.get('/api/friends/list', (req, res) => {
  const normEmail = (req.query.email || '').toLowerCase().trim();
  if (!normEmail) return res.json({ success: true, friends: [], incoming: [], outgoing: [] });

  const rel = getOrCreateUserRelations(normEmail);
  const friendsList = Array.from(rel.friends).map(e => users[e] || { email: e, name: e.split('@')[0], avatar: '' });
  const incomingList = Array.from(rel.incoming).map(e => users[e] || { email: e, name: e.split('@')[0], avatar: '' });
  const outgoingList = Array.from(rel.outgoing).map(e => users[e] || { email: e, name: e.split('@')[0], avatar: '' });

  res.json({
    success: true,
    friends: friendsList,
    incoming: incomingList,
    outgoing: outgoingList
  });
});

app.post('/api/friends/request', (req, res) => {
  const fromEmail = (req.body.fromEmail || '').toLowerCase().trim();
  const toEmail = (req.body.toEmail || '').toLowerCase().trim();

  if (!fromEmail || !toEmail) {
    return res.status(400).json({ success: false, error: 'Email mittente e destinatario richieste' });
  }

  if (fromEmail === toEmail) {
    return res.status(400).json({ success: false, error: 'Non puoi inviare una richiesta a te stesso' });
  }

  const fromRel = getOrCreateUserRelations(fromEmail);
  const toRel = getOrCreateUserRelations(toEmail);

  if (fromRel.friends.has(toEmail)) {
    return res.json({ success: false, error: 'Siete già amici!' });
  }

  fromRel.outgoing.add(toEmail);
  toRel.incoming.add(fromEmail);

  // Send notification to recipient
  const fromUser = users[fromEmail] || { name: fromEmail.split('@')[0], email: fromEmail };
  notifications[toEmail].unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: 'friend_request',
    fromEmail: fromEmail,
    fromName: fromUser.name,
    fromAvatar: fromUser.avatar,
    timestamp: Date.now(),
    read: false
  });

  res.json({ success: true, message: `Richiesta di amicizia inviata a ${toEmail}` });
});

app.post('/api/friends/respond', (req, res) => {
  const userEmail = (req.body.userEmail || '').toLowerCase().trim();
  const fromEmail = (req.body.fromEmail || '').toLowerCase().trim();
  const accept = Boolean(req.body.accept);

  if (!userEmail || !fromEmail) {
    return res.status(400).json({ success: false, error: 'Parametri mancanti' });
  }

  const userRel = getOrCreateUserRelations(userEmail);
  const fromRel = getOrCreateUserRelations(fromEmail);

  userRel.incoming.delete(fromEmail);
  fromRel.outgoing.delete(userEmail);

  if (accept) {
    userRel.friends.add(fromEmail);
    fromRel.friends.add(userEmail);

    // Notify the other user that request was accepted
    const userObj = users[userEmail] || { name: userEmail.split('@')[0], email: userEmail };
    notifications[fromEmail].unshift({
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'friend_accepted',
      fromEmail: userEmail,
      fromName: userObj.name,
      fromAvatar: userObj.avatar,
      timestamp: Date.now(),
      read: false
    });
  }

  res.json({ success: true, accepted: accept });
});

// -------------------------------------------------------------
// SHARE FILM TO FRIEND API
// -------------------------------------------------------------
app.post('/api/share/film', async (req, res) => {
  const fromEmail = (req.body.fromEmail || '').toLowerCase().trim();
  const toEmail = (req.body.toEmail || '').toLowerCase().trim();
  const { filmTitle, streamUrl, vixUrl, poster, watchUrl } = req.body || {};

  if (!fromEmail || !toEmail || !filmTitle) {
    return res.status(400).json({ success: false, error: 'Dati incompleti per la condivisione' });
  }

  getOrCreateUserRelations(toEmail);
  const fromUser = users[fromEmail] || { name: fromEmail.split('@')[0], email: fromEmail };

  const finalStreamUrl = streamUrl || vixUrl || watchUrl || '';

  notifications[toEmail].unshift({
    id: `film_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: 'film_share',
    fromEmail: fromEmail,
    fromName: fromUser.name,
    fromAvatar: fromUser.avatar,
    filmTitle: filmTitle,
    streamUrl: finalStreamUrl,
    poster: poster || '',
    timestamp: Date.now(),
    read: false
  });

  res.json({ success: true, message: `Film "${filmTitle}" inviato con successo a ${toEmail}!` });
});

// -------------------------------------------------------------
// NOTIFICATIONS APIs
// -------------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.json({ success: true, notifications: [], unreadCount: 0 });

  getOrCreateUserRelations(email);
  const list = notifications[email] || [];
  const unreadCount = list.filter(n => !n.read).length;

  res.json({
    success: true,
    notifications: list,
    unreadCount: unreadCount
  });
});

app.post('/api/notifications/read', (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (email && notifications[email]) {
    notifications[email].forEach(n => { n.read = true; });
  }
  res.json({ success: true });
});

// -------------------------------------------------------------
// STREAMINGCOMMUNITY CATALOG & RESOLVER APIs
// -------------------------------------------------------------
app.get('/api/sc/home', async (req, res) => {
  try {
    const fetched = await fetchWithFallback('/it');
    if (!fetched) {
      return res.status(500).json({ success: false, error: 'Impossibile connettersi a StreamingCommunity' });
    }

    const match = fetched.text.match(/data-page=["'](.*?)["']/);
    if (!match) {
      return res.status(500).json({ success: false, error: 'Nessun dato catalogo trovato' });
    }

    const raw = unescapeHtml(match[1]);
    const dp = JSON.parse(raw);
    const props = dp.props || {};
    const sliders = props.sliders || [];
    const cdn = props.cdn_url || 'https://cdn.streamingcommunityz.luxe';

    const cleanSliders = sliders.map(s => ({
      name: s.name || 'Catalogo',
      titles: (s.titles || []).map(t => ({
        id: t.id,
        name: t.name,
        type: t.type || 'movie',
        slug: t.slug || '',
        release_date: t.release_date || t.year || '2024',
        poster: t.images && t.images[0] ? `${cdn}/images/${t.images[0].filename}` : 'https://via.placeholder.com/300x450',
        backdrop: t.images && t.images[1] ? `${cdn}/images/${t.images[1].filename}` : (t.images && t.images[0] ? `${cdn}/images/${t.images[0].filename}` : ''),
        plot: t.plot || 'Nessuna trama disponibile.'
      }))
    }));

    res.json({
      success: true,
      domain: fetched.domain,
      sliders: cleanSliders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sc/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.json({ success: true, titles: [] });

  try {
    const fetched = await fetchWithFallback(`/it/search?q=${encodeURIComponent(query)}`);
    if (!fetched) return res.json({ success: true, titles: [] });

    const match = fetched.text.match(/data-page=["'](.*?)["']/);
    if (!match) return res.json({ success: true, titles: [] });

    const raw = unescapeHtml(match[1]);
    const dp = JSON.parse(raw);
    const props = dp.props || {};
    const titles = props.titles || [];
    const cdn = props.cdn_url || 'https://cdn.streamingcommunityz.luxe';

    const cleanTitles = titles.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type || 'movie',
      slug: t.slug || '',
      release_date: t.release_date || t.year || '',
      poster: t.images && t.images[0] ? `${cdn}/images/${t.images[0].filename}` : 'https://via.placeholder.com/300x450',
      plot: t.plot || 'Nessuna trama disponibile.'
    }));

    res.json({ success: true, titles: cleanTitles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sc/title/:id', async (req, res) => {
  const id = req.params.id;
  const slug = req.query.slug || '';
  const pathUrl = slug ? `/it/titles/${id}-${slug}` : `/it/titles/${id}`;

  try {
    let fetched = await fetchWithFallback(pathUrl);
    if (!fetched) fetched = await fetchWithFallback(`/it/titles/${id}`);
    if (!fetched) fetched = await fetchWithFallback(`/it/watch/${id}`);
    if (!fetched) return res.status(404).json({ success: false, error: 'Titolo non trovato' });

    const match = fetched.text.match(/data-page=["'](.*?)["']/);
    if (!match) return res.status(404).json({ success: false, error: 'Dettagli non trovati' });

    const raw = unescapeHtml(match[1]);
    const dp = JSON.parse(raw);
    const props = dp.props || {};
    const titleObj = props.title || props.loadedTitle || props.media || {};
    const cdn = props.cdn_url || 'https://cdn.streamingcommunityz.luxe';
    const loadedSeason = props.loadedSeason || {};

    const episodesList = (loadedSeason.episodes || []).map(ep => ({
      id: ep.id,
      number: ep.number,
      name: ep.name || `Episodio ${ep.number}`,
      plot: ep.plot || '',
      watch_url: `${activeScDomain}/it/watch/${id}?e=${ep.id}`
    }));

    res.json({
      success: true,
      title: {
        id: titleObj.id || id,
        name: titleObj.name || titleObj.title || 'Titolo Streaming',
        type: titleObj.type || (titleObj.seasons && titleObj.seasons.length > 0 ? 'tv' : 'movie'),
        slug: titleObj.slug || slug || '',
        release_date: titleObj.release_date || titleObj.year || '',
        plot: titleObj.plot || '',
        poster: titleObj.images && titleObj.images[0] ? `${cdn}/images/${titleObj.images[0].filename}` : '',
        backdrop: titleObj.images && titleObj.images[1] ? `${cdn}/images/${titleObj.images[1].filename}` : '',
        seasons: (titleObj.seasons || []).map(s => ({
          id: s.id,
          number: s.number,
          episodes_count: s.episodes_count || 0
        })),
        current_season: loadedSeason.number || 1,
        episodes: episodesList
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sc/season/:id/:num', async (req, res) => {
  const { id, num } = req.params;
  const slug = req.query.slug || '';

  const candidates = [
    slug ? `/it/titles/${id}-${slug}/stagione-${num}` : `/it/titles/${id}/stagione-${num}`,
    `/it/titles/${id}/stagione-${num}`,
    slug ? `/it/titles/${id}-${slug}` : `/it/titles/${id}`,
    `/it/watch/${id}`
  ];

  try {
    let fetched = null;
    for (const cPath of candidates) {
      fetched = await fetchWithFallback(cPath);
      if (fetched) break;
    }

    if (!fetched) return res.status(404).json({ success: false, error: 'Stagione non trovata' });

    const match = fetched.text.match(/data-page=["'](.*?)["']/);
    if (!match) return res.status(404).json({ success: false, error: 'Episodi non trovati' });

    const raw = unescapeHtml(match[1]);
    const dp = JSON.parse(raw);
    const loadedSeason = dp.props?.loadedSeason || {};
    const episodes = (loadedSeason.episodes || []).map(ep => ({
      id: ep.id,
      number: ep.number,
      name: ep.name || `Episodio ${ep.number}`,
      plot: ep.plot || '',
      watch_url: `${activeScDomain}/it/watch/${id}?e=${ep.id}`
    }));

    res.json({ success: true, season_number: num, episodes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vixcloud/extract', async (req, res) => {
  const { url, titleId, episodeId, lang } = req.body || {};
  let targetWatchUrl = url;

  if (!targetWatchUrl && titleId) {
    targetWatchUrl = `${activeScDomain}/it/watch/${titleId}${episodeId ? `?e=${episodeId}` : ''}`;
  }

  if (!targetWatchUrl) {
    return res.status(400).json({ success: false, error: 'Nessun URL fornito' });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': activeScDomain
  };

  try {
    const resWatch = await fetch(targetWatchUrl, { headers, redirect: 'follow' });
    const htmlWatch = await resWatch.text();

    let embedUrl = '';
    const matchDp = htmlWatch.match(/data-page=["'](.*?)["']/);
    if (matchDp) {
      try {
        const dp = JSON.parse(unescapeHtml(matchDp[1]));
        embedUrl = dp.props?.embedUrl || '';
      } catch (e) {}
    }

    if (!embedUrl) {
      const matchIfr = htmlWatch.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/);
      if (matchIfr) embedUrl = matchIfr[1];
    }

    if (!embedUrl) {
      const scwsMatch = htmlWatch.match(/\/(?:iframe|embed)\/(\d+)/);
      if (scwsMatch) embedUrl = `${activeScDomain}/it/iframe/${scwsMatch[1]}`;
    }

    if (!embedUrl) {
      return res.json({
        success: true,
        master_m3u8: targetWatchUrl,
        vix_url: targetWatchUrl,
        is_direct: true
      });
    }

    const resIfr = await fetch(embedUrl, { headers: { ...headers, 'Referer': targetWatchUrl }, redirect: 'follow' });
    const htmlIfr = await resIfr.text();
    let vixEmbed = embedUrl;
    const matchVix = htmlIfr.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/);
    if (matchVix) vixEmbed = unescapeHtml(matchVix[1]);

    const resVix = await fetch(vixEmbed, { headers: { ...headers, 'Referer': embedUrl }, redirect: 'follow' });
    const htmlVix = await resVix.text();

    const tokenM = htmlVix.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
    const expM = htmlVix.match(/['"]expires['"]\s*:\s*['"]?(\d+)['"]?/);
    const plM = htmlVix.match(/url\s*:\s*['"]([^'"]+)['"]/);

    if (tokenM && expM && plM) {
      let playlistUrl = plM[1];
      if (!playlistUrl.endsWith('.m3u8')) playlistUrl += '.m3u8';

      const token = tokenM[1];
      const expires = expM[1];
      const audioLang = lang === 'orig' ? 'orig' : 'it';
      const signedM3u8 = `${playlistUrl}?b=1&token=${token}&expires=${expires}&h=1&scz=1&lang=${audioLang}`;

      return res.json({
        success: true,
        master_m3u8: signedM3u8,
        vix_url: signedM3u8,
        embed_url: vixEmbed,
        token: token,
        expires: expires
      });
    }

    return res.json({
      success: true,
      master_m3u8: vixEmbed,
      vix_url: vixEmbed,
      embed_url: vixEmbed
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback index route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================================`);
  console.log(` 🚀 STREAMINGCOMMUNITY SOCIAL & UNIVERSAL WEB APP`);
  console.log(` • Porta: ${PORT}`);
  console.log(` • Google Auth, Friends & Notifications attivi`);
  console.log(`========================================================`);
});
