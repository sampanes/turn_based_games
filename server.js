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

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- persistence
let db = { rooms: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.error('Could not read data.json, starting fresh:', e.message); }

let saveTimer = null;
function save() {
  // debounce writes so rapid moves do not churn disk writes
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); }
    catch (e) { console.error('save failed:', e.message); }
  }, 300);
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

// ----------------------------------------------------------------------- routes
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function handleApi(req, res, body) {
  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  if (route === '/api/create' && req.method === 'POST') {
    const requested = body.game || 'battleship';
    if (!games[requested]) return send(res, 400, { error: 'Unknown game.' });
    const type = requested;
    const code = roomCode();
    const tok = token();
    db.rooms[code] = {
      code, game: type, createdAt: Date.now(),
      players: Object.fromEntries(PLAYER_SLOTS.slice(0, maxPlayers(type)).map(slot => [slot, null])),
      state: games[type].init(),
    };
    db.rooms[code].players.A = { token: tok, name: cleanName(body.name, 'Player 1') };
    notifyJoin(db.rooms[code], 'A');
    save();
    return send(res, 200, { room: code, token: tok, you: 'A', game: type });
  }

  if (route === '/api/join' && req.method === 'POST') {
    const room = db.rooms[(body.room || '').toUpperCase()];
    if (!room) return send(res, 404, { error: 'No game with that code.' });
    const joined = roomPlayers(room);
    if (joined.length >= maxPlayers(room.game)) return send(res, 409, { error: 'That game is already full.' });
    if (joined.length >= minPlayers(room.game) && room.state && room.state.phase !== 'lobby') return send(res, 409, { error: 'That game already started.' });
    const slot = nextSlot(room);
    const tok = token();
    room.players[slot] = { token: tok, name: cleanName(body.name, `Player ${joined.length + 1}`) };
    notifyJoin(room, slot);
    save();
    return send(res, 200, { room: room.code, token: tok, you: slot, game: room.game });
  }

  if (route === '/api/setup' && req.method === 'POST') {
    const room = db.rooms[(body.room || '').toUpperCase()];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, body.token);
    if (!who) return send(res, 403, { error: 'Not in this game.' });
    const err = games[room.game].validateSetup(room.state, who, body.ships);
    if (err) return send(res, 400, { error: err });
    save();
    return send(res, 200, { ok: true });
  }

  if (route === '/api/move' && req.method === 'POST') {
    const room = db.rooms[(body.room || '').toUpperCase()];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, body.token);
    if (!who) return send(res, 403, { error: 'Not in this game.' });
    const err = games[room.game].applyMove(room.state, who, body.move, publicPlayers(room));
    if (err) return send(res, 400, { error: err });
    save();
    return send(res, 200, { ok: true });
  }

  if (route === '/api/state' && req.method === 'GET') {
    const room = db.rooms[(url.searchParams.get('room') || '').toUpperCase()];
    if (!room) return send(res, 404, { error: 'No such game.' });
    const who = playerOf(room, url.searchParams.get('token'));
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------------- the server
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    let raw = '';
    req.on('data', d => { raw += d; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Bad JSON.' }); } }
      try { handleApi(req, res, body); }
      catch (e) { console.error(e); send(res, 500, { error: 'Server error.' }); }
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`Turn-Based Games running at http://${HOST}:${actualPort}`);
  console.log(`LAN clients can open http://<server-ip>:${actualPort}`);
});
