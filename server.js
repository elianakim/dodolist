'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT          = 3000;
const ROOT          = __dirname;
const DATA_FILE     = path.join(ROOT, 'data', 'todos.json');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const GIFS_DIR      = path.join(ROOT, 'data', 'gifs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.gif':  'image/gif',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Ensure data directories exist
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.mkdirSync(GIFS_DIR, { recursive: true });

// Bootstrap missing data files with sensible defaults
const DEFAULT_SETTINGS = {
  gifs: ['/data/gifs/twerking_pikachu.gif'],
  celebrationMessages: ['Yay!', 'Well done!'],
  fontScale: 1,
  gifNames: {},
  colors: {
    bg: '#eef6fc', surface: '#ffffff', border: '#d0e6f4', borderSoft: '#e5f1fa',
    text: '#1F232F', muted: '#6b8fa3', light: '#a4c3d5', today: '#0ea5e9',
    p0: '#27254C', p1: '#564A94', p2: '#9B8AB4', p3: '#C5B8D9',
  },
};

const DEFAULT_TODOS = {
  todos: [{
    id: 'example-task-001',
    text: 'Your first task — click the text to edit, press Enter to save',
    priority: 'p0',
    done: false, doneAt: null,
    createdAt: Date.now(), dueDate: null,
    pinnedToToday: false, notes: '', subtasks: [], recurring: null, order: 0,
  }],
  archive: [], lastCleanup: null, tab: 'p0',
  sort:     { p0: 'manual', p1: 'manual', p2: 'manual', p3: 'manual' },
  doneOpen: { today: false, p0: false, p1: false, p2: false, p3: false },
  arcOpen:  { p0: true,  p1: true,  p2: true,  p3: true  },
};

if (!fs.existsSync(SETTINGS_FILE))
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
if (!fs.existsSync(DATA_FILE))
  fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_TODOS, null, 2), 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const params  = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');

  // ── GET /api/data ────────────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/data') {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
    return;
  }

  // ── POST /api/data ───────────────────────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/data') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body);
        fs.writeFileSync(DATA_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid JSON"}');
      }
    });
    return;
  }

  // ── GET /api/settings ────────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/settings') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
    return;
  }

  // ── POST /api/settings ───────────────────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/settings') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        JSON.parse(body);
        fs.writeFileSync(SETTINGS_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid JSON"}');
      }
    });
    return;
  }

  // ── POST /api/gifs — upload a GIF file to data/gifs/ ─────────────
  if (req.method === 'POST' && urlPath === '/api/gifs') {
    const rawName  = params.get('name') || 'upload.gif';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
    const dest     = path.join(GIFS_DIR, safeName);
    if (!dest.startsWith(GIFS_DIR + path.sep)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"invalid filename"}');
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      // Validate GIF magic bytes: GIF8
      if (buf.length < 4 || buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x38) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"not a gif"}');
        return;
      }
      try {
        fs.writeFileSync(dest, buf);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: `/data/gifs/${safeName}` }));
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"write failed"}');
      }
    });
    return;
  }

  // ── DELETE /api/gifs — remove a GIF file from data/gifs/ ─────────
  if (req.method === 'DELETE' && urlPath === '/api/gifs') {
    const rawName  = params.get('name') || '';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
    const dest     = path.join(GIFS_DIR, safeName);
    if (!dest.startsWith(GIFS_DIR + path.sep)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"invalid filename"}');
      return;
    }
    try { fs.unlinkSync(dest); } catch { /* already gone */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // ── Static files ─────────────────────────────────────────────────
  const filePath = urlPath === '/'
    ? path.join(ROOT, 'index.html')
    : path.join(ROOT, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'text/plain; charset=utf-8';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  todos  →  http://localhost:${PORT}\n`);
});
