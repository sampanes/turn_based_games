#!/usr/bin/env node
/*
 * Turn-Based Games - a tiny self-hosted server for turn-based games
 * with one other person, async, with no accounts and no ads.
 *
 * Zero external dependencies. Runs on any host with Node 16+:
 *     node server.js
 *
 * State lives in ./data.json next to this file. Back it up to preserve
 * in-progress games; deleting it wipes all rooms.
 *
 * Game rules live in ./server/games and shared browser rules live in ./public/games.
 * The server owns rooms, turns, identity, API
 * routing, static files, and persistence.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const games = require('./server/games');

function envInteger(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

const PORT = envInteger('PORT', 8080, 0, 65535);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = envInteger('MAX_BODY_BYTES', 64 * 1024, 1024, 1024 * 1024);
const MAX_ROOMS = envInteger('MAX_ROOMS', 200, 1, 10000);
const ROOM_TTL_DAYS = envInteger('ROOM_TTL_DAYS', 90, 1, 3650);
const ROOM_TTL_MS = ROOM_TTL_DAYS * 24 * 60 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = envInteger('RATE_LIMIT_PER_MINUTE', 900, 60, 10000);

// ---------------------------------------------------------------- persistence
let db = { rooms: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.error('Could not read data.json, starting fresh:', e.message); }
if (!db || typeof db !== 'object' || !db.rooms || typeof db.rooms !== 'object') db = { rooms: {} };

let saveTimer = null;
function save() {
  // debounce writes so rapid moves do not churn disk writes
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const temporary = `${DATA_FILE}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(db));
      fs.renameSync(temporary, DATA_FILE);
    }
    catch (e) { console.error('save failed:', e.message); }
  }, 300);
}

function cleanupRooms(now = Date.now()) {
  let removed = 0;
  for (const [code, room] of Object.entries(db.rooms)) {
    const lastActivity = Number(room && (room.updatedAt || room.createdAt)) || now;
    if (!room || now - lastActivity > ROOM_TTL_MS) {
      delete db.rooms[code];
      removed++;
    }
  }
  if (removed) save();
  return removed;
}

function token() { return crypto.randomBytes(16).toString('hex'); }
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let c;
  do {
    c = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (db.rooms[c]);
  return c;
}

// ----------------------------------------------------------------- room helpers
function playerOf(room, tok) {
  for (const [slot, player] of Object.entries(room.players || {})) {
    if (player && player.token === tok) return slot;
  }
  return null;
}

const PLAYER_SLOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function gameMeta(type) { return (games[type] && games[type].meta) || {}; }
function maxPlayers(type) { return gameMeta(type).maxPlayers || 2; }
function minPlayers(type) { return gameMeta(type).minPlayers || 2; }
function roomPlayers(room) { return Object.keys(room.players).filter(slot => room.players[slot]); }
function nextSlot(room) { return PLAYER_SLOTS.find(slot => !room.players[slot]); }
function publicPlayers(room) {
  return roomPlayers(room).map(slot => ({ slot, name: room.players[slot].name }));
}
function notifyJoin(room, slot) {
  if (typeof games[room.game].onPlayerJoined === 'function') games[room.game].onPlayerJoined(room.state, slot);
}

function cleanName(value, fallback) {
  const name = String(value || '').trim().slice(0, 32);
  return name || fallback;
}

function cleanRoomCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function requestToken(req, body) {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.match(/^Bearer\s+([a-f0-9]{32})$/i);
  return bearer ? bearer[1] : (body && body.token);
}

const rateBuckets = new Map();
function requestIdentity(req) {
  const tailnetUser = req.headers['tailscale-user-login'];
  return String(tailnetUser || req.socket.remoteAddress || 'local').slice(0, 256);
}
function allowApiRequest(req, now = Date.now()) {
  if (rateBuckets.size > 1000) {
    for (const [key, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= 60_000) rateBuckets.delete(key);
    }
  }
  const key = requestIdentity(req);
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_PER_MINUTE;
}

// ----------------------------------------------------------------------- routes
function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(obj));
}

function handleApi(req, res, body) {
  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  if (route === '/api/create' && req.method === 'POST') {
    const requested = body.game || 'battleship';
    if (!games[requested]) return send(res, 400, { error: 'Unknown game.' });
    cleanupRooms();
    if (Object.keys(db.rooms).length >= MAX_ROOMS) {
      return send(res, 503, { error: 'The room limit has been reached. Remove old games or try again later.' });
    }
    const type = requested;
    const code = roomCode();
    const tok = token();
    db.rooms[code] = {
      code, game: type, createdAt: Date.now(), updatedAt: Date.now(),
      players: Object.fromEntries(PLAYER_SLOTS.slice(0, maxPlayers(type)).map(slot => [slot, null])),
      state: games[type].init(),
    };
    db.rooms[code].players.A = { token: tok, name: cleanName(body.name, 'Player 1') };
    notifyJoin(db.rooms[code], 'A');
    save();
    return send(res, 200, { room: code, token: tok, you: 'A', game: type });
  }

  if (route === '/api/join' && req.method === 'POST') {
    const room = db.rooms[cleanRoomCode(body.room)];
    if (!room) return send(res, 404, { error: 'No game with that code.' });
    const joined = roomPlayers(room);
    if (joined.length >= maxPlayers(room.game)) return send(res, 409, { error: 'That game is already full.' });
    if (joined.length >= minPlayers(room.game) && room.state && room.state.phase !== 'lobby') return send(res, 409, { error: 'That game already started.' });
    const slot = nextSlot(room);
    const tok = token();
    room.players[slot] = { token: tok, name: cleanName(body.name, `Player ${joined.length + 1}`) };
    notifyJoin(room, slot);
    room.updatedAt = Date.now();
    save();
    return send(res, 200, { room: room.code, token: tok, you: slot, game: room.game });
  }

  if (route === '/api/setup' && req.method === 'POST') {
    const room = db.rooms[cleanRoomCode(body.room)];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, requestToken(req, body));
    if (!who) return send(res, 403, { error: 'Not in this game.' });
    const err = games[room.game].validateSetup(room.state, who, body.ships);
    if (err) return send(res, 400, { error: err });
    room.updatedAt = Date.now();
    save();
    return send(res, 200, { ok: true });
  }

  if (route === '/api/move' && req.method === 'POST') {
    const room = db.rooms[cleanRoomCode(body.room)];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, requestToken(req, body));
    if (!who) return send(res, 403, { error: 'Not in this game.' });
    const err = games[room.game].applyMove(room.state, who, body.move, publicPlayers(room));
    if (err) return send(res, 400, { error: err });
    room.updatedAt = Date.now();
    save();
    return send(res, 200, { ok: true });
  }

  if (route === '/api/state' && req.method === 'GET') {
    const room = db.rooms[cleanRoomCode(url.searchParams.get('room'))];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, requestToken(req, body));
    if (!who) return send(res, 403, { error: 'Not in this game.' });
    const opp = roomPlayers(room).filter(slot => slot !== who).map(slot => room.players[slot]);
    return send(res, 200, {
      game: room.game,
      you: who,
      youName: room.players[who].name,
      opponentJoined: roomPlayers(room).length >= minPlayers(room.game),
      opponentName: opp.length === 1 ? opp[0].name : (opp.length ? `${opp.length} rivals` : null),
      players: publicPlayers(room),
      minPlayers: minPlayers(room.game),
      maxPlayers: maxPlayers(room.game),
      view: games[room.game].viewFor(room.state, who, publicPlayers(room)),
    });
  }

  return send(res, 404, { error: 'Unknown endpoint.' });
}

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const STATIC_SECURITY_HEADERS = {
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/') p = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, '.' + p);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      ...STATIC_SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

// ------------------------------------------------------------------- the server
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    if (!allowApiRequest(req)) return send(res, 429, { error: 'Too many requests. Wait a moment and try again.' });
    const contentLength = Number.parseInt(req.headers['content-length'] || '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return send(res, 413, { error: 'Request body is too large.' });
    }
    let raw = '';
    let bodyTooLarge = false;
    req.on('data', d => {
      if (bodyTooLarge) return;
      raw += d;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        bodyTooLarge = true;
        send(res, 413, { error: 'Request body is too large.' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) return;
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Bad JSON.' }); } }
      try { handleApi(req, res, body); }
      catch (e) { console.error(e); send(res, 500, { error: 'Server error.' }); }
    });
  } else {
    serveStatic(req, res);
  }
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

const cleanupTimer = setInterval(cleanupRooms, 6 * 60 * 60 * 1000);
cleanupTimer.unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - a forgotten Turn-Based Games`);
    console.error(`instance (or something else) is holding it. Run stop-server.bat,`);
    console.error(`or find it with ..\\find-js-processes.bat, then start again.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`Turn-Based Games running at http://${HOST}:${actualPort}`);
  if (HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1') {
    console.log('Private remote access can be added with Tailscale Serve.');
  } else {
    console.log(`Network clients can open http://<server-ip>:${actualPort}`);
  }
});
