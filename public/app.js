const $ = id => document.getElementById(id);
let session = null;            // {room, token, you, game, mode}
let fleetDef = [];             // from server view
let pollTimer = null;
let lastView = null;
let boardSize = 10;
let battleFxOn = localStorage.getItem('turnBasedGamesFx') !== 'off';
let moveInFlight = false;       // one move POST at a time (double taps)

// ---- mobile / orientation ergonomics
function isLikelyPhone() {
  const uaPhone = /Android.*Mobile|iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 540;
  return uaPhone || (coarse && narrow);
}
function gameOrientationPreference(meta) {
  const preferred = (lastView && lastView.preferredOrientation) || (meta && meta.preferredOrientation) || 'portrait';
  const required = (lastView && lastView.requiredOrientation) || (meta && meta.requiredOrientation) || null;
  return { preferred, required };
}
function applyDeviceClasses(activeSection) {
  const meta = currentGameMeta();
  const { preferred, required } = gameOrientationPreference(meta);
  const phone = isLikelyPhone();
  const landscape = window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
  document.body.classList.toggle('is-phone', phone);
  document.body.classList.toggle('is-landscape', !!landscape);
  document.body.classList.toggle('is-portrait', !landscape);
  document.body.classList.toggle('needs-landscape', !!(phone && required === 'landscape' && activeSection !== 'home'));
  document.body.classList.toggle('needs-portrait', !!(phone && preferred === 'portrait' && !required && activeSection !== 'home'));
}

// ---- browser session persistence
// `turnBasedGames` is the game on screen. `turnBasedGamesSaved` remembers every
// game this browser holds a seat in (newest first) for the home screen list, so
// starting another game never strands an unfinished one.
const SAVED_KEY = 'turnBasedGamesSaved';
const SAVED_MAX = 12;
function loadSession() { try { return JSON.parse(localStorage.getItem('turnBasedGames')); } catch { return null; } }
function loadSavedGames() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY));
    return Array.isArray(list) ? list.filter(s => s && s.room && s.token) : [];
  } catch { return []; }
}
function storeSavedGames(list) {
  const sorted = list.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  sorted.slice(SAVED_MAX).forEach(s => window.TurnBasedGamesSolo && window.TurnBasedGamesSolo.clearRoom(s));
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(sorted.slice(0, SAVED_MAX))); } catch {}
}
function sameSavedGame(a, b) { return !!(a && b && a.room === b.room && a.mode === b.mode); }
function rememberGame(s, touch = true) {
  if (!s || !s.room || !s.token) return;
  const list = loadSavedGames();
  const prev = list.find(x => sameSavedGame(x, s));
  const entry = { ...(prev || {}), ...s, savedAt: touch || !prev ? Date.now() : prev.savedAt };
  storeSavedGames([entry, ...list.filter(x => !sameSavedGame(x, s))]);
}
function forgetGame(s) {
  if (!s) return;
  if (window.TurnBasedGamesSolo) window.TurnBasedGamesSolo.clearRoom(s);
  storeSavedGames(loadSavedGames().filter(x => !sameSavedGame(x, s)));
}
function setSession(s) {
  session = s;
  localStorage.setItem('turnBasedGames', JSON.stringify(s));
  rememberGame(s);
}
// Discard the current game on this device: its seat, saved entry and solo room.
function clearSession() {
  forgetGame(session);
  session = null;
  localStorage.removeItem('turnBasedGames');
}
// Step away from the current game but keep it in the saved list.
function detachSession() {
  session = null;
  localStorage.removeItem('turnBasedGames');
}

function show(id) {
  applyDeviceClasses(id);
  document.body.classList.toggle('battle-mode', id === 'battle');
  document.body.classList.toggle('mancala-mode', id === 'mancala');
  document.body.classList.toggle('uno-mode', id === 'oneCard');
  updateFxButton();
  ['home','invite','settings','lobby','placement','battle','connectFour','dotsBoxes','oneCard','mancala','ultimateTTT','reversi','checkers','pig'].forEach(section => {
    const el = $(section);
    if (el) el.classList.toggle('hidden', section !== id);
  });
  if (id === 'home') { updateNameRow(); updateResumeCard(); }
  else stopSavedStatusPoll();
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function gameCatalog() {
  if (window.TurnBasedGamesRegistry) return window.TurnBasedGamesRegistry.listGames();
  return Object.entries(window.TurnBasedGames || {}).map(([id, module]) => ({ id, name: id, module }));
}
function gameMeta(id) {
  if (window.TurnBasedGamesRegistry) return window.TurnBasedGamesRegistry.getGame(id);
  const module = (window.TurnBasedGames || {})[id];
  return module ? { id, name: id, module } : null;
}
function availableGames() {
  return Object.fromEntries(gameCatalog().map(game => [game.id, game.module]));
}
function currentGameMeta() { return gameMeta(session && session.game) || gameMeta(selectedGameId()); }
function selectedGameId() { return $('gameSelect').value || 'battleship'; }

function launchParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('mode'),
    game: params.get('game'),
    room: params.get('room'),
    play: params.get('play'),
  };
}
function applyLaunchGame(gameId) {
  const select = $('gameSelect');
  if (!select || !gameId || !gameMeta(gameId)) return;
  select.value = gameId;
  syncGameTiles();
  applyDeviceClasses('home');
}
function clearLaunchParams() {
  if (!window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('mode');
  url.searchParams.delete('game');
  url.searchParams.delete('room');
  url.searchParams.delete('play');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

function populateGameSelect() {
  const select = $('gameSelect');
  if (!select) return;
  select.innerHTML = '';
  for (const game of gameCatalog()) {
    const option = document.createElement('option');
    option.value = game.id;
    option.textContent = game.name;
    if (game.description) option.title = game.description;
    select.appendChild(option);
  }
  // The tiles are the picker people see; the hidden select stays the one place
  // the chosen game is stored, so everything that reads it keeps working.
  const tiles = $('gameTiles');
  if (!tiles) return;
  tiles.innerHTML = '';
  for (const game of gameCatalog()) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'game-tile';
    tile.dataset.game = game.id;
    tile.setAttribute('role', 'radio');
    if (game.description) tile.title = game.description;
    const emblem = document.createElement('span');
    emblem.className = 'emblem g-' + game.id;
    emblem.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'game-tile-name';
    name.textContent = game.name;
    tile.append(emblem, name);
    tile.onclick = () => pickGame(game.id);
    tiles.appendChild(tile);
  }
  syncGameTiles();
}
function pickGame(gameId) {
  const select = $('gameSelect');
  if (!select || select.value === gameId) return;
  select.value = gameId;
  select.dispatchEvent(new Event('change'));
}
function syncGameTiles() {
  const tiles = $('gameTiles');
  if (!tiles) return;
  const picked = selectedGameId();
  Array.from(tiles.children).forEach(tile => tile.setAttribute('aria-checked', tile.dataset.game === picked ? 'true' : 'false'));
}
// ---- game code on demand
// The home screen needs only the list of games (games/registry.js). A game's rules
// (games/<id>.js) and its screen (ui/<id>.js) are fetched the first time that game is
// opened, picked on the home screen, or found in the saved list.
const gameCodeLoads = {};
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false; // run in the order added: a game's rules before its screen
    el.onload = resolve;
    el.onerror = () => { el.remove(); reject(new Error(src)); };
    document.head.appendChild(el);
  });
}
function ensureGameCode(id) {
  if (!gameMeta(id)) return Promise.resolve(); // not a game this page knows: the server will say so
  if (!gameCodeLoads[id]) {
    gameCodeLoads[id] = Promise.all([loadScript(`games/${id}.js`), loadScript(`ui/${id}.js`)]).catch(() => {
      delete gameCodeLoads[id]; // so the next try fetches again
      throw new Error('Could not load that game. Check the connection and try again.');
    });
  }
  return gameCodeLoads[id];
}
function preloadGameCode(ids) {
  Array.from(new Set(ids)).filter(id => gameMeta(id)).slice(0, 3).forEach(id => ensureGameCode(id).catch(() => {}));
}

function soloApi(path, method, body) {
  const payload = { ...(body || {}) };
  if (session && session.token && !payload.token) payload.token = session.token;
  return window.TurnBasedGamesSolo.handle(path, method, payload, session, { gameMeta, selectedGameId });
}

async function api(path, method, body) {
  if (session && session.mode === 'computer') {
    // the offline engine plays by the game's rules file, so that has to be here first
    await ensureGameCode(session.game || (body && body.game) || selectedGameId());
    return soloApi(path, method, body || {});
  }
  const headers = { 'Content-Type': 'application/json' };
  if (session && session.mode === 'online' && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  const opt = { method, headers };
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(path, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ------------------------------------------------------------ name, server, settings
const NAME_KEY = 'turnBasedGamesName';
function savedPlayerName() { try { return (localStorage.getItem(NAME_KEY) || '').trim(); } catch { return ''; } }
function savePlayerName(value) {
  const name = String(value || '').trim().slice(0, 16);
  try { if (name) localStorage.setItem(NAME_KEY, name); else localStorage.removeItem(NAME_KEY); } catch {}
}
// The home screen asks for a name only until one is saved; after that it lives in Settings.
function updateNameRow() {
  const name = savedPlayerName();
  $('nameRow').classList.toggle('hidden', !!name);
  $('homeHello').textContent = name ? `Hi, ${name}` : 'Welcome';
}
function playerName(fallback) {
  const typed = !$('nameRow').classList.contains('hidden') && $('nameFirst').value.trim();
  if (typed) { savePlayerName(typed); updateNameRow(); }
  return savedPlayerName() || fallback;
}

// GitHub Pages has no server: hide friend games and play the computer offline.
let hasServer = !/\.github\.io$/i.test(window.location.hostname);
function applyServerMode() { document.body.classList.toggle('no-server', !hasServer); }

function openSettings() {
  $('playerName').value = savedPlayerName();
  $('moveCodeOut').classList.add('hidden');
  $('moveCodeIn').value = '';
  show('settings');
  updateAlertsCard();
}
function closeSettings() {
  savePlayerName($('playerName').value);
  saveBotLevel();
  show('home');
}

// One button for the computer: Botty (saved on the server) when there is one.
function playComputer() { return hasServer ? createBottyGame() : createComputerGame(); }

// ---- moving games between browsers (Discord's browser, Safari, the home-screen app)
const MOVE_PREFIX = 'TBG1.';
function moveCode() {
  const games = loadSavedGames().filter(e => e.mode === 'online' && !e.over)
    .map(e => ({ r: e.room, t: e.token, y: e.you, g: e.game, b: e.bot ? 1 : 0, l: e.level || undefined, o: e.opponent || undefined }));
  if (!games.length) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(games));
  return MOVE_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function copyMoveCode() {
  const code = moveCode();
  if (!code) return toast('No unfinished games with a friend or Botty to move.');
  const out = $('moveCodeOut');
  out.value = code;
  out.classList.remove('hidden');
  try {
    await navigator.clipboard.writeText(code);
    toast('Copied. Paste it in Settings in the other browser.');
  } catch {
    out.focus();
    out.select();
    toast('Select the code and copy it.');
  }
}
async function importMoveCode() {
  const text = $('moveCodeIn').value.replace(/\s+/g, '');
  let games = null;
  try {
    if (!text.startsWith(MOVE_PREFIX)) throw new Error('prefix');
    const b64 = text.slice(MOVE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    games = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), ch => ch.charCodeAt(0))));
  } catch { return toast('That is not a games code. Copy it again from the other browser.'); }
  if (!Array.isArray(games)) return toast('That is not a games code.');
  let added = 0, gone = 0;
  for (const g of games.slice(0, 12)) {
    if (!g || !/^[A-Z0-9]{4}$/.test(g.r) || !/^[a-f0-9]{32}$/i.test(g.t)) continue;
    try {
      const res = await fetch(`/api/state?room=${encodeURIComponent(g.r)}`, { headers: { Authorization: `Bearer ${g.t}` }, cache: 'no-store' });
      if (!res.ok) { gone++; continue; }
      const d = await res.json();
      rememberGame({ room: g.r, token: g.t, you: d.you || g.y, game: d.game || g.g, mode: 'online',
        ...(g.b ? { bot: true } : {}), ...(g.l ? { level: g.l } : {}), opponent: d.opponentName || g.o || '', over: d.view && d.view.phase === 'over' });
      added++;
    } catch { gone++; }
  }
  $('moveCodeIn').value = '';
  if (added) registerAllAlerts();
  toast(added ? `Added ${added} game${added === 1 ? '' : 's'}.${gone ? ` ${gone} had ended.` : ''}` : 'None of those games are still going.');
}

// ---- invitation links
function openInvite(code) {
  $('inviteCode').textContent = code;
  $('inviteName').value = savedPlayerName();
  show('invite');
}
async function joinInvite() {
  const name = $('inviteName').value.trim();
  if (name) savePlayerName(name);
  $('joinCode').value = $('inviteCode').textContent;
  await joinGame();
}

async function createGame() {
  try {
    const name = playerName('Player 1');
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'online' });
    enterRoom();
  } catch (e) { toast(e.message); }
}
const BOT_LEVEL_KEY = 'turnBasedGamesBotLevel';
const BOT_LEVEL_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
function botLevel() {
  const v = $('botLevel') && $('botLevel').value;
  return BOT_LEVEL_NAMES[v] ? v : 'normal';
}
function saveBotLevel() { try { localStorage.setItem(BOT_LEVEL_KEY, botLevel()); } catch {} }
function loadBotLevel() {
  let v = null;
  try { v = localStorage.getItem(BOT_LEVEL_KEY); } catch {}
  if ($('botLevel')) $('botLevel').value = BOT_LEVEL_NAMES[v] ? v : 'normal';
}
async function createBottyGame() {
  try {
    const meta = currentGameMeta();
    if (meta && meta.supportsComputer === false) return toast('Botty does not support that game yet.');
    const name = playerName('Player 1');
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name, bot: true, level: botLevel() });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'online', bot: true, level: d.level || botLevel() });
    enterRoom();
  } catch (e) { toast(e.message); }
}
async function createComputerGame() {
  try {
    const name = playerName('Player 1');
    session = { mode: 'computer' };
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name, level: botLevel() });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'computer', level: d.level });
    enterRoom();
  } catch (e) { clearSession(); toast(e.message); }
}
async function joinGame() {
  try {
    const room = $('joinCode').value.trim().toUpperCase();
    if (room.length !== 4) return toast('Codes are 4 letters/numbers.');
    const name = playerName('Player 2');
    const d = await api('/api/join', 'POST', { room, name });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'online' });
    enterRoom();
  } catch (e) { toast(e.message); }
}
function sectionForGame(gameId) {
  const meta = gameMeta(gameId);
  const ui = (meta && meta.ui) || '';
  return ui === 'connectfour' ? 'connectFour'
    : ui === 'dotsboxes' ? 'dotsBoxes'
    : ui === 'onecard' ? 'oneCard'
    : ui === 'mancala' ? 'mancala'
    : ui === 'ultimatettt' ? 'ultimateTTT'
    : ui === 'reversi' || ui === 'checkers' || ui === 'pig' ? ui
    : 'battle';
}

function timeAgo(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// ------------------------------------------------------------ turn alerts
// Web Push through the server. The server only sends to games with a person
// in them, and not while that player's game screen is open. On iPhone this
// works only in the home-screen app, which keeps its own saved games.
let pushKey = null; // the server's VAPID key; stays null without a server (GitHub Pages)
const alertsRegistered = new Set();
let alertsOn = false; // last known: does this device have a push subscription

function isIos() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
}
function alertableGames() { return loadSavedGames().filter(e => e.mode === 'online' && !e.bot && !e.over); }

async function alertsSubscription() {
  if (!pushKey || !pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function seatAlerts(entry, path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.token}` },
      body: JSON.stringify({ room: entry.room, ...body }),
    });
    return res.ok;
  } catch { return false; }
}

// Tell the server this device wants alerts for one game (once per page load).
async function registerAlertsFor(entry, sub) {
  if (!entry || entry.mode !== 'online' || entry.bot || alertsRegistered.has(entry.room)) return;
  sub = sub || await alertsSubscription();
  if (!sub) return;
  if (await seatAlerts(entry, '/api/push/subscribe', { subscription: sub.toJSON() })) alertsRegistered.add(entry.room);
}

async function updateAlertsCard() {
  const card = $('alertsCard');
  if (!card) return;
  if (!pushKey) { card.classList.add('hidden'); $('gearDot').classList.add('hidden'); return; }
  const text = $('alertsText');
  const btn = $('alertsBtn');
  let message, label = null;
  if (isIos() && !isStandalone()) {
    message = 'On iPhone, alerts work only in the home-screen app. In Discord or another app? Open this page in Safari first, from that app\'s menu. Then tap Share, Add to Home Screen, open the game from the new icon, and turn alerts on there. The icon keeps its own games; bring them over with Move games below.';
  } else if (!pushSupported()) {
    message = 'This browser cannot show turn alerts.';
  } else if (Notification.permission === 'denied') {
    message = 'Alerts are blocked for this site. Allow notifications for it in the device settings, then come back.';
  } else if ((alertsOn = !!(await alertsSubscription()))) {
    message = 'On for this device. You get an alert when it is your turn in a game with a person, unless that game is already open.';
    label = 'Turn off';
  } else {
    message = 'Get an alert on this device when it is your turn in a game with a person.';
    label = 'Turn on alerts';
  }
  card.classList.remove('hidden');
  text.textContent = message;
  btn.classList.toggle('hidden', !label);
  if (label) btn.textContent = label;
  const helps = !alertsOn && alertableGames().length > 0 && (label || (isIos() && !isStandalone()));
  $('gearDot').classList.toggle('hidden', !helps);
}
function registerAllAlerts() {
  alertsSubscription().then(sub => { if (sub) alertableGames().forEach(e => registerAlertsFor(e, sub)); }).catch(() => {});
}

async function toggleAlerts() {
  const btn = $('alertsBtn');
  // Ask before any await, while the tap still counts as a user gesture (iPhone requires it).
  const asking = alertsOn ? null : Notification.requestPermission();
  btn.disabled = true;
  try {
    const existing = await alertsSubscription();
    if (existing) {
      await Promise.all(alertableGames().map(e => seatAlerts(e, '/api/push/unsubscribe', { endpoint: existing.endpoint })));
      await existing.unsubscribe();
      alertsRegistered.clear();
      toast('Turn alerts are off on this device.');
      return;
    }
    const permission = await (asking || Notification.requestPermission());
    if (permission !== 'granted') { toast('Alerts were not allowed.'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) });
    alertsRegistered.clear();
    await Promise.all(alertableGames().map(e => registerAlertsFor(e, sub)));
    toast('Turn alerts are on.');
  } catch (e) {
    console.error(e);
    toast('Could not turn on alerts: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    updateAlertsCard();
  }
}

async function initAlerts() {
  try {
    const res = await fetch('/api/push/key', { cache: 'no-store' });
    if (!res.ok) { hasServer = false; applyServerMode(); return; }
    pushKey = (await res.json()).publicKey || null;
  } catch { hasServer = false; applyServerMode(); return; }
  if (pushKey && pushSupported()) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      // A server that made new keys (data.json was reset) needs a fresh subscription.
      const sub = await reg.pushManager.getSubscription();
      const key = sub && sub.options && sub.options.applicationServerKey;
      if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== pushKey) {
        await sub.unsubscribe();
      } else if (sub) {
        alertableGames().forEach(e => registerAlertsFor(e, sub));
      }
    } catch (e) { console.error(e); }
  }
  updateAlertsCard();
}

// A tapped alert opens its game, in this window if the app is already open.
function openGameFromAlert(room) {
  const entry = room && loadSavedGames().find(e => e.room === String(room).toUpperCase());
  if (entry) resumeSavedGame(entry);
  else toast('That game is not saved on this device.');
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'open-game') return;
    try { openGameFromAlert(new URL(event.data.url).searchParams.get('play')); } catch {}
  });
}

// Live turn status for online saved games, keyed by room:
// { state: 'you' | 'them' | 'waiting' | 'over', at: last activity in ms }.
const savedStatus = new Map();
const SAVED_STATUS_POLL_MS = 5000;
let savedStatusTimer = null;

function savedTurnState(d) {
  const v = d.view || {};
  if (v.phase === 'over') return 'over';
  if (!d.opponentJoined || v.phase === 'lobby') return 'waiting';
  if (v.phase === 'placing') return v.youPlaced ? 'them' : 'you';
  return v.turn === d.you ? 'you' : 'them';
}

async function refreshSavedStatus() {
  const online = loadSavedGames().filter(e => e.mode === 'online' && !e.over);
  if (!online.length || document.hidden) return;
  let changed = false;
  await Promise.all(online.map(async entry => {
    try {
      const res = await fetch(`/api/state?room=${encodeURIComponent(entry.room)}`, {
        headers: { Authorization: `Bearer ${entry.token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const d = await res.json();
      const next = { state: savedTurnState(d), at: Number(d.updatedAt) || 0 };
      const prev = savedStatus.get(entry.room);
      if (!prev || prev.state !== next.state || prev.at !== next.at) {
        savedStatus.set(entry.room, next);
        changed = true;
      }
    } catch {} // offline or room expired: keep the last known status
  }));
  if (changed && !$('home').classList.contains('hidden')) renderSavedList();
}

function startSavedStatusPoll() {
  stopSavedStatusPoll();
  refreshSavedStatus();
  savedStatusTimer = setInterval(refreshSavedStatus, SAVED_STATUS_POLL_MS);
}
function stopSavedStatusPoll() {
  if (savedStatusTimer) clearInterval(savedStatusTimer);
  savedStatusTimer = null;
}

// Sort key: your turn, their turn, waiting for a player, vs computer, finished.
// Within a turn group the game that has waited longest comes first; computer
// and finished games list the most recent first.
const SAVED_RANK = { you: 0, them: 1, waiting: 2, computer: 3, over: 4 };
const SAVED_NEWEST_FIRST = new Set(['computer', 'over']);
function savedEntryStatus(entry) {
  if (entry.over) return { state: 'over', at: entry.savedAt || 0 };
  if (entry.mode === 'computer') return { state: 'computer', at: entry.savedAt || 0 };
  const live = savedStatus.get(entry.room);
  if (live) return { state: live.state, at: live.at || entry.savedAt || 0 };
  return { state: entry.opponent || entry.bot ? 'them' : 'waiting', at: entry.savedAt || 0, unknown: true };
}

// Home screen list of every saved game (kept under its old name: show('home') calls it).
function updateResumeCard() {
  renderSavedList();
  startSavedStatusPoll();
  updateAlertsCard();
}

function renderSavedList() {
  const wrap = $('savedGames');
  const list = $('savedList');
  if (!wrap || !list) return;
  const games = loadSavedGames().map(entry => ({ entry, status: savedEntryStatus(entry) }));
  games.sort((a, b) => (SAVED_RANK[a.status.state] - SAVED_RANK[b.status.state])
    || (SAVED_NEWEST_FIRST.has(a.status.state) ? b.status.at - a.status.at : a.status.at - b.status.at));
  wrap.classList.toggle('hidden', !games.length);
  list.innerHTML = '';
  games.forEach(({ entry, status }) => {
    const meta = gameMeta(entry.game);
    const skill = BOT_LEVEL_NAMES[entry.level] ? ` (${BOT_LEVEL_NAMES[entry.level].toLowerCase()})` : '';
    const who = entry.mode === 'computer' ? 'vs computer' + skill
      : entry.bot ? 'vs Botty' + skill
      : entry.opponent ? `vs ${entry.opponent}` : `room ${entry.room}, waiting`;
    const yours = status.state === 'you' && !status.unknown;
    const theirs = status.state === 'them' && !status.unknown;
    const row = document.createElement('div');
    row.className = 'saved-game' + (entry.over ? ' over' : '') + (yours ? ' yours' : '') + (theirs ? ' theirs' : '');
    const info = document.createElement('div');
    info.className = 'saved-info';
    if (yours || theirs) {
      const turn = document.createElement('span');
      turn.className = 'saved-turn';
      turn.textContent = yours ? 'Your turn' : 'Their turn';
      info.append(turn);
    }
    const name = document.createElement('span');
    name.className = 'saved-name';
    name.textContent = (meta && meta.name) || entry.game || 'Game';
    const sub = document.createElement('span');
    sub.className = 'saved-meta';
    sub.textContent = [who, entry.over ? 'finished' : null, timeAgo(status.at || Date.now())].filter(Boolean).join(' - ');
    info.append(name, sub);
    const resume = document.createElement('button');
    resume.className = entry.over || theirs ? 'ghost' : 'primary';
    resume.textContent = entry.over ? 'View' : yours ? 'Play' : 'Resume';
    resume.onclick = () => resumeSavedGame(entry);
    const drop = document.createElement('button');
    drop.className = 'ghost saved-drop';
    drop.textContent = '\u00d7'; // multiplication sign
    drop.setAttribute('aria-label', `Discard ${name.textContent} ${who}`);
    drop.onclick = () => discardSavedGame(entry);
    if (meta) {
      const emblem = document.createElement('span');
      emblem.className = 'emblem g-' + entry.game;
      emblem.setAttribute('aria-hidden', 'true');
      row.append(emblem);
    }
    row.append(info, resume, drop);
    list.appendChild(row);
  });
}

function resumeSavedGame(entry) {
  if (!entry || !entry.room) { updateResumeCard(); return; }
  stopPoll();
  resetGameUi();
  lastView = null;
  setSession({ ...entry });
  show(sectionForGame(entry.game));
  enterRoom();
}

function discardSavedGame(entry) {
  if (!entry) return;
  const prompt = entry.over ? null
    : entry.mode === 'computer' ? 'Delete this offline game?'
    : `Forget this game? Your seat in room ${entry.room} cannot be recovered on this device.`;
  if (prompt && !confirm(prompt)) return;
  forgetGame(entry);
  if (sameSavedGame(session, entry)) detachSession();
  updateResumeCard();
}

// Keep the saved entry's opponent name and finished flag current for the home list.
function noteSavedGame(d, v) {
  if (!session || !session.room) return;
  const opponent = d.opponentName || '';
  const over = v.phase === 'over';
  const level = BOT_LEVEL_NAMES[d.botLevel] ? d.botLevel : session.level;
  if ((session.opponent || '') === opponent && !!session.over === over && session.level === level) return;
  setSession({ ...session, opponent, over, ...(level ? { level } : {}) });
}

// Back to the home screen. An unfinished game stays saved; a finished one is cleared.
function leaveGame() {
  if (session && lastView && lastView.phase === 'over') clearSession();
  else detachSession();
  stopPoll();
  resetGameUi();
  lastView = null;
  show('home');
  $('foot').textContent = '';
}

// A live room nobody has joined yet: cancelling throws it away.
function cancelLobby() {
  clearSession();
  stopPoll();
  resetGameUi();
  lastView = null;
  show('home');
  $('foot').textContent = '';
}

async function copyRoomCode() {
  if (!session || !session.room) return;
  try {
    await navigator.clipboard.writeText(session.room);
    toast('Room code copied.');
  } catch {
    toast(`Code: ${session.room}`);
  }
}

function inviteLink() {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('room', session.room);
  return url.toString();
}
function updateInvite() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if ($('inviteLink').value !== inviteLink()) $('inviteLink').value = inviteLink();
  $('inviteLocalWarning').classList.toggle('hidden', !local);
}
async function copyInvite() {
  if (!session || !session.room) return;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (local) return toast('Open the private HTTPS address first.');
  const message = `Come play with me! Open ${inviteLink()} and tap Join.`;
  try {
    await navigator.clipboard.writeText(message);
    toast('Invitation copied.');
  } catch {
    $('inviteLink').focus();
    $('inviteLink').select();
    toast('Select and copy the link.');
  }
}

function enterRoom() { startPoll(); poll(); registerAlertsFor(session); }

// Sends one move, then waits for the fresh view before accepting another tap,
// so a double tap cannot post twice off a stale view.
async function postMove(move) {
  if (moveInFlight) return false;
  moveInFlight = true;
  try {
    await api('/api/move', 'POST', { room: session.room, move });
    await poll();
    return true;
  } catch (e) { toast(e.message); return false; }
  finally { moveInFlight = false; }
}

// Solo rooms live in localStorage under their own key; drop any that no saved
// game points at, so discarded or overflowed offline games do not pile up.
function pruneSoloRooms() {
  try {
    const prefix = 'turn-based-games-solo-';
    const keep = new Set(loadSavedGames().filter(s => s.mode === 'computer').map(s => prefix + s.room));
    if (session && session.mode === 'computer' && session.room) keep.add(prefix + session.room);
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix) && !keep.has(k))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

async function restartComputerGame() {
  if (!session || session.mode !== 'computer') return;
  // Battleship and UTTT report no moveNumber; treat any battle there as in progress.
  const midGame = lastView && lastView.phase === 'battle' && (lastView.moveNumber == null || lastView.moveNumber > 0);
  if (midGame && !confirm('Start a new game? This one will be lost.')) return;
  const game = session.game || selectedGameId();
  const level = session.level || botLevel();
  const name = savedPlayerName() || 'Player 1';
  try {
    clearSession();
    resetGameUi();
    lastView = null;
    session = { mode: 'computer' };
    const d = await api('/api/create', 'POST', { game, name, level });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'computer', level: d.level });
    toast('New game started.');
    enterRoom();
  } catch (e) { clearSession(); toast(e.message); }
}

function updateSoloRestartButtons() {
  document.querySelectorAll('.solo-restart').forEach(btn => {
    btn.classList.toggle('hidden', !(session && session.mode === 'computer'));
  });
  // Offline and Botty rooms have nobody to invite.
  const private_ = !!(session && (session.mode === 'computer' || session.bot));
  document.querySelectorAll('.room-share').forEach(el => el.classList.toggle('hidden', private_));
  // Shows Botty's face in the status banner (see body.vs-bot in index.html).
  document.body.classList.toggle('vs-bot', private_);
}

// Botty nods off when it is left waiting on your turn. Any touch or key wakes it.
const BOTTY_NAP_MS = 45000;
let bottyNapTimer = null;
function wakeBotty() {
  document.body.classList.remove('botty-asleep');
  clearTimeout(bottyNapTimer);
  bottyNapTimer = setTimeout(() => document.body.classList.add('botty-asleep'), BOTTY_NAP_MS);
}
['pointerdown', 'touchstart', 'keydown'].forEach(type => document.addEventListener(type, wakeBotty, { capture: true, passive: true }));
wakeBotty();


function startPoll() { stopPoll(); pollTimer = setInterval(poll, 1000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  if (!session) return;
  const asked = session;
  const stillHere = () => session && session.room === asked.room && session.token === asked.token;
  try {
    const seen = document.visibilityState === 'visible' ? '&seen=1' : '';
    const code = asked.game ? ensureGameCode(asked.game) : null;
    if (code) code.catch(() => {}); // a failed load is reported by the await below
    const d = await api(`/api/state?room=${encodeURIComponent(asked.room)}${seen}`, 'GET');
    await (code || ensureGameCode(d.game || (d.view && d.view.ui) || 'battleship'));
    // The player may have gone Home or opened another game while this was in flight.
    if (!stillHere()) return;
    render(d);
  } catch (e) {
    if (!stillHere()) return;
    if (/No such game|Not in this game/.test(e.message)) {
      clearSession(); stopPoll(); show('home'); updateResumeCard();
      toast('That game has ended.');
    } else if (/^Could not load/.test(e.message)) {
      toast(e.message); // the next poll tries again
    } else {
      console.error(e);
    }
  }
}

function render(d) {
  updateSoloRestartButtons();
  const v = d.view;
  lastView = v;
  noteSavedGame(d, v);
  fleetDef = v.fleet || fleetDef || [];
  boardSize = v.size || boardSize;
  $('foot').textContent = `Game ${session.room} - ${d.youName}` + (d.opponentName ? ` vs ${d.opponentName}` : '')
    + (BOT_LEVEL_NAMES[d.botLevel] ? ` (${BOT_LEVEL_NAMES[d.botLevel]})` : '');

  if (!d.opponentJoined) { show('lobby'); $('lobbyCode').textContent = session.room; updateInvite(); return; }

  const meta = currentGameMeta();
  if ((v.ui || (meta && meta.ui)) === 'mancala') {
    show('mancala');
    renderMancala(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'ultimatettt') {
    show('ultimateTTT');
    renderUltimateTTT(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'connectfour') {
    show('connectFour');
    renderConnectFour(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'dotsboxes') {
    show('dotsBoxes');
    renderDotsBoxes(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'onecard') {
    show('oneCard');
    renderOneCard(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'reversi') {
    show('reversi');
    renderReversi(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'checkers') {
    show('checkers');
    renderCheckers(d, v);
    return;
  }
  if ((v.ui || (meta && meta.ui)) === 'pig') {
    show('pig');
    renderPig(d, v);
    return;
  }

  if (v.phase === 'placing') {
    if (v.youPlaced) {
      show('placement'); document.querySelectorAll('#placement .grid, #placement .fleet, #placement .row, #readyBtn, #placeHint').forEach(el => el.classList.add('hidden'));
      $('placeWait').classList.remove('hidden');
    } else {
      show('placement'); $('placeWait').classList.add('hidden');
      document.querySelectorAll('#placement .grid, #placement .fleet, #placement .row, #readyBtn, #placeHint').forEach(el => el.classList.remove('hidden'));
      if (!$('placeGrid').children.length || $('placeGrid').dataset.size !== String(boardSize)) initPlacement();
    }
    return;
  }

  show('battle');
  renderBattle(d, v);
}

// ---------------- sound and haptics (every game uses these) ----------------
let mncAudioContext = null;

function mncEnsureAudio() {
  if (!mncAudioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    mncAudioContext = new AudioContext();
  }
  if (mncAudioContext.state !== 'running') mncAudioContext.resume().catch(() => {}); // suspended, or iOS 'interrupted'
  return mncAudioContext;
}

// ---- battle sound + haptics (WebAudio synth, no assets)
function toggleBattleFx() {
  battleFxOn = !battleFxOn;
  localStorage.setItem('turnBasedGamesFx', battleFxOn ? 'on' : 'off');
  updateFxButton();
  if (battleFxOn) { mncEnsureAudio(); battleSfx('aim'); }
}
function updateFxButton() {
  document.querySelectorAll('.fx-btn').forEach(btn => { btn.textContent = battleFxOn ? 'FX on' : 'FX off'; });
}
function battleVibrate(pattern) {
  if (!battleFxOn || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}
function battleTone(audio, at, freq, dur, opts = {}) {
  const { type = 'sine', gain = 0.12, slideTo = null } = opts;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(amp).connect(audio.destination);
  osc.start(at); osc.stop(at + dur + 0.02);
}
function battleNoise(audio, at, dur, opts = {}) {
  const { freq = 800, type = 'lowpass', gain = 0.2 } = opts;
  const len = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, len, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const amp = audio.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(filter).connect(amp).connect(audio.destination);
  src.start(at);
}
function battleSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'aim') battleTone(audio, t, 1250, 0.05, { type: 'square', gain: 0.04 });
  else if (kind === 'fire') {
    battleNoise(audio, t, 0.16, { freq: 1200, type: 'highpass', gain: 0.12 });
    battleTone(audio, t, 640, 0.3, { slideTo: 170, gain: 0.07 });
  } else if (kind === 'miss') battleNoise(audio, t, 0.4, { freq: 480, gain: 0.22 });
  else if (kind === 'hit') {
    battleTone(audio, t, 95, 0.45, { slideTo: 42, gain: 0.3 });
    battleNoise(audio, t, 0.25, { freq: 900, gain: 0.18 });
  } else if (kind === 'sunk') {
    battleTone(audio, t, 95, 0.5, { slideTo: 40, gain: 0.3 });
    battleNoise(audio, t, 0.3, { freq: 900, gain: 0.2 });
    battleTone(audio, t + 0.22, 70, 0.7, { slideTo: 34, gain: 0.32 });
    battleNoise(audio, t + 0.22, 0.5, { freq: 500, gain: 0.22 });
  } else if (kind === 'win') {
    [523, 659, 784, 1047].forEach((f, i) => battleTone(audio, t + i * 0.14, f, 0.28, { type: 'triangle', gain: 0.11 }));
  } else if (kind === 'lose') {
    [330, 262, 208, 165].forEach((f, i) => battleTone(audio, t + i * 0.18, f, 0.34, { type: 'triangle', gain: 0.11 }));
  }
}

// ---------------- shared UI reset ----------------
// Each game's screen file resets its own board (resetBattleshipUi and so on). A game
// that has not been opened since the page loaded has no file here and nothing to reset.
const GAME_UI_RESETS = ['resetBattleshipUi', 'resetConnectFourUi', 'resetDotsBoxesUi', 'resetOneCardUi', 'resetMancalaUi', 'resetUltimateTttUi',
  'resetReversiUi', 'resetCheckersUi', 'resetPigUi'];
function resetGameUi() {
  GAME_UI_RESETS.forEach(name => { if (typeof window[name] === 'function') window[name](); });
}

// ---------------- player sigils ----------------
// art/sigils.png holds nine marks. A seat takes its mark from the player's
// name, so one person keeps one mark from game to game. Seats are settled in
// slot order and a repeat moves on to the next mark, so both phones agree.
const SIGIL_COUNT = 9;
function sigilForName(name) {
  let hash = 0;
  for (const ch of String(name || '').trim().toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % SIGIL_COUNT;
}
// [{ slot, name }] -> Map of slot -> position along the strip, as a CSS percentage.
function seatSigils(seats) {
  const taken = new Set();
  const map = new Map();
  seats.slice().sort((a, b) => (a.slot < b.slot ? -1 : 1)).forEach(seat => {
    let mark = sigilForName(seat.name);
    while (taken.has(mark) && taken.size < SIGIL_COUNT) mark = (mark + 1) % SIGIL_COUNT;
    taken.add(mark);
    map.set(seat.slot, `${mark / (SIGIL_COUNT - 1) * 100}%`);
  });
  return map;
}
function applySeatSigils(d) {
  const opponent = (d.players || []).find(player => player.slot !== d.you);
  const theirSlot = opponent ? opponent.slot : (d.you === 'A' ? 'B' : 'A');
  const sigils = seatSigils([
    { slot: d.you, name: d.youName || 'You' },
    { slot: theirSlot, name: (opponent && opponent.name) || d.opponentName || 'Opponent' },
  ]);
  document.body.style.setProperty('--sg-you', sigils.get(d.you));
  document.body.style.setProperty('--sg-opp', sigils.get(theirSlot));
}

// ---------------- seats in a two-player game ----------------
function rivalSlot(d) {
  const rival = (d.players || []).find(player => player.slot !== d.you);
  return rival ? rival.slot : d.you === 'A' ? 'B' : 'A';
}
function seatName(d, slot) {
  if (slot === d.you) return d.youName || 'You';
  const seat = (d.players || []).find(player => player.slot === slot);
  return (seat && seat.name) || d.opponentName || 'Opponent';
}

// ---------------- boot ----------------
document.addEventListener('visibilitychange', () => { if (!document.hidden && pollTimer) poll(); });
['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(type => document.addEventListener(type, mncEnsureAudio, { passive: true }));
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('gameSelect').addEventListener('change', () => { syncGameTiles(); applyDeviceClasses('home'); preloadGameCode([selectedGameId()]); });
window.addEventListener('resize', () => {
  applyDeviceClasses(document.querySelector('section:not(.hidden)')?.id || 'home');
  if (lastView && lastView.ui === 'onecard') layoutOneCardFan(lastView.hand || []);
  if (document.body.classList.contains('battle-mode') && typeof updateAimUi === 'function') updateAimUi();
});
window.addEventListener('orientationchange', () => setTimeout(() => {
  applyDeviceClasses(document.querySelector('section:not(.hidden)')?.id || 'home');
  if (lastView && lastView.ui === 'onecard') layoutOneCardFan(lastView.hand || []);
}, 80));
document.addEventListener('keydown', e => {
  if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (!session) return;
  if (e.key.toLowerCase() === 'r' && !$('placement').classList.contains('hidden')) toggleOrient();
  if (lastView && lastView.ui === 'connectfour') {
    if (e.key === 'ArrowLeft') { e.preventDefault(); connectStepFocus(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); connectStepFocus(1); return; }
    if ((e.key === 'Enter' || e.key === ' ') && !(e.target && e.target.tagName === 'BUTTON' && !e.target.classList.contains('cf-zone'))) { e.preventDefault(); dropConnectDisc(connectUi.focusedCol); return; }
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 7 && lastView && lastView.ui === 'connectfour') { e.preventDefault(); dropConnectDisc(n - 1); }
  if (e.key.toLowerCase() === 'd' && lastView && lastView.ui === 'onecard') drawOneCard();
});

populateGameSelect();
loadBotLevel();
applyServerMode();
const params = launchParams();
applyLaunchGame(params.game);
const inviteRoom = params.room && /^[A-Z0-9]{4}$/i.test(params.room) ? params.room.toUpperCase() : null;
session = loadSession();
if (session && session.room) rememberGame(session, false); // carry over a pre-list single save
pruneSoloRooms();
// The home screen is always the landing page, listing saved games instead of
// auto-teleporting into one; only an explicit ?mode=computer&game=x launch link
// jumps straight into play: the newest unfinished offline game of that kind, or
// a new one. Other saved games stay saved either way.
const launchGame = params.mode === 'computer' && params.game && gameMeta(params.game) ? params.game : null;
if (launchGame && !(session && session.mode === 'computer' && session.game === launchGame)) {
  const saved = loadSavedGames().find(s => s.mode === 'computer' && s.game === launchGame && !s.over);
  detachSession();
  if (saved) setSession({ ...saved });
}
if (session && launchGame) {
  show(sectionForGame(session.game));
  enterRoom();
  clearLaunchParams();
} else if (!session && params.mode === 'computer') {
  show('home');
  createComputerGame().finally(clearLaunchParams);
} else {
  // Landing on the home screen means no game is open. A game that was on screen when the
  // tab closed is already in the saved list; left behind as the session, an offline one
  // would send the next "Play the computer" or friend game to the offline engine, and
  // the server would then answer that the game does not exist.
  detachSession();
  show('home');
  clearLaunchParams();
  if (params.play) openGameFromAlert(params.play);
  else if (inviteRoom && !loadSavedGames().some(e => e.room === inviteRoom)) openInvite(inviteRoom);
}
initAlerts();

// With the home screen up, fetch the code for the games most likely to be opened next
// (saved games first, then the picked tile), so the first tap does not wait on it.
setTimeout(() => {
  if (!session) preloadGameCode([...loadSavedGames().filter(entry => !entry.over).map(entry => entry.game), selectedGameId()]);
}, 1200);
