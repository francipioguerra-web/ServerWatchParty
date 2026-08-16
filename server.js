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
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
// API: HOME CATALOG
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

// -------------------------------------------------------------
// API: SEARCH
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// API: TITLE DETAILS & SEASONS
// -------------------------------------------------------------
app.get('/api/sc/title/:id', async (req, res) => {
  const id = req.params.id;
  const slug = req.query.slug || '';
  const pathUrl = slug ? `/it/titles/${id}-${slug}` : `/it/titles/${id}`;

  try {
    const fetched = await fetchWithFallback(pathUrl);
    if (!fetched) return res.status(404).json({ success: false, error: 'Titolo non trovato' });

    const match = fetched.text.match(/data-page=["'](.*?)["']/);
    if (!match) return res.status(404).json({ success: false, error: 'Dettagli non trovati' });

    const raw = unescapeHtml(match[1]);
    const dp = JSON.parse(raw);
    const props = dp.props || {};
    const titleObj = props.title || {};
    const cdn = props.cdn_url || 'https://cdn.streamingcommunityz.luxe';

    res.json({
      success: true,
      title: {
        id: titleObj.id,
        name: titleObj.name,
        type: titleObj.type || 'movie',
        slug: titleObj.slug || '',
        release_date: titleObj.release_date || titleObj.year || '',
        plot: titleObj.plot || '',
        poster: titleObj.images && titleObj.images[0] ? `${cdn}/images/${titleObj.images[0].filename}` : '',
        backdrop: titleObj.images && titleObj.images[1] ? `${cdn}/images/${titleObj.images[1].filename}` : '',
        seasons: (titleObj.seasons || []).map(s => ({
          id: s.id,
          number: s.number,
          episodes_count: s.episodes_count || 0
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: SEASON EPISODES
// -------------------------------------------------------------
app.get('/api/sc/season/:id/:num', async (req, res) => {
  const { id, num } = req.params;
  const slug = req.query.slug || '';
  const pathUrl = slug ? `/it/titles/${id}-${slug}/stagione-${num}` : `/it/titles/${id}`;

  try {
    const fetched = await fetchWithFallback(pathUrl);
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

    res.json({ success: true, episodes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: VIXCLOUD STREAM EXTRACTION (SIGNED M3U8)
// -------------------------------------------------------------
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
    // 1. Fetch SC Watch Page
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

    // 2. Fetch SC Iframe to get Vixcloud URL
    const resIfr = await fetch(embedUrl, { headers: { ...headers, 'Referer': targetWatchUrl }, redirect: 'follow' });
    const htmlIfr = await resIfr.text();
    let vixEmbed = embedUrl;
    const matchVix = htmlIfr.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/);
    if (matchVix) vixEmbed = unescapeHtml(matchVix[1]);

    // 3. Fetch Vixcloud embed to get signed token & playlist
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
  console.log(` 🚀 STREAMINGCOMMUNITY UNIVERSAL WEB APP ATTIVO`);
  console.log(` • Porta: ${PORT}`);
  console.log(` • Pronto per deploy su Render.com`);
  console.log(`========================================================`);
});
