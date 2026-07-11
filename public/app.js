const $ = id => document.getElementById(id);
let session = null;            // {room, token, you, game, mode}
let orient = 'H';              // H | V
let placedShips = [];          // [{name,size,cells:[]}]
let selectedShip = null;       // fleet index being placed
let fleetDef = [];             // from server view
let pollTimer = null;
let lastView = null;
let boardSize = 10;
let lastBattleEventKey = null;
let lastBattleTurn = null;
let battleAimAnimation = null;
let battleShellAnimation = null;
let battleFocus = 'fire';
let aimCell = null;            // {r,c} target picked but not fired yet
let pendingOutgoing = null;    // {r,c} fired, waiting to animate the result
let battleOverFxDone = false;
let battleIncomingHoldUntil = 0; // brief pause between your impact fx and the enemy's reticle sweep
let battleFxOn = localStorage.getItem('turnBasedGamesFx') !== 'off';
let placementDrag = null;
let ignoreNextPlacementClick = false;
let lastShipTap = null; // { name, time } for double-tap-to-rotate
let oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null, lastGesture: null };
let connectUi = { focusedCol: 3, lastMoveNumber: 0, boardSig: '', overFxDone: false };
let connectLastData = null;
let dotsUi = { lastMoveNumber: 0, boardSig: '', overFxDone: false };

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
function loadSession() { try { return JSON.parse(localStorage.getItem('turnBasedGames')); } catch { return null; } }
function setSession(s) { session = s; localStorage.setItem('turnBasedGames', JSON.stringify(s)); }
function clearSession() {
  if (session && window.TurnBasedGamesSolo) window.TurnBasedGamesSolo.clearRoom(session);
  session = null;
  localStorage.removeItem('turnBasedGames');
}

function show(id) {
  applyDeviceClasses(id);
  document.body.classList.toggle('battle-mode', id === 'battle');
  document.body.classList.toggle('mancala-mode', id === 'mancala');
  document.body.classList.toggle('uno-mode', id === 'oneCard');
  updateFxButton();
  ['home','lobby','placement','battle','connectFour','dotsBoxes','oneCard','mancala','ultimateTTT'].forEach(section => {
    const el = $(section);
    if (el) el.classList.toggle('hidden', section !== id);
  });
  if (id === 'home') updateResumeCard();
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
  };
}
function applyLaunchGame(gameId) {
  const select = $('gameSelect');
  if (!select || !gameId || !gameMeta(gameId)) return;
  select.value = gameId;
  applyDeviceClasses('home');
}
function clearLaunchParams() {
  if (!window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('mode');
  url.searchParams.delete('game');
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
}
function soloApi(path, method, body) {
  const payload = { ...(body || {}) };
  if (session && session.token && !payload.token) payload.token = session.token;
  return window.TurnBasedGamesSolo.handle(path, method, payload, session, { gameMeta, selectedGameId });
}

async function api(path, method, body) {
  if (session && session.mode === 'computer') return soloApi(path, method, body || {});
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

async function createGame() {
  try {
    const name = $('name1').value.trim() || 'Player 1';
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'online' });
    enterRoom();
  } catch (e) { toast(e.message); }
}
async function createBottyGame() {
  try {
    const meta = currentGameMeta();
    if (meta && meta.supportsComputer === false) return toast('Botty does not support that game yet.');
    const name = $('name1').value.trim() || 'Player 1';
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name, bot: true });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'online', bot: true });
    enterRoom();
  } catch (e) { toast(e.message); }
}
async function createComputerGame() {
  try {
    const name = $('name1').value.trim() || 'Player 1';
    session = { mode: 'computer' };
    const d = await api('/api/create', 'POST', { game: selectedGameId(), name });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'computer' });
    enterRoom();
  } catch (e) { clearSession(); toast(e.message); }
}
async function joinGame() {
  try {
    const room = $('joinCode').value.trim().toUpperCase();
    if (room.length !== 4) return toast('Codes are 4 letters/numbers.');
    const name = $('name2').value.trim() || 'Player 2';
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
    : 'battle';
}

function updateResumeCard() {
  const card = $('resumeCard');
  if (!card) return;
  const saved = session || loadSession();
  if (!saved || !saved.room) { card.classList.add('hidden'); return; }
  const meta = gameMeta(saved.game);
  const modeText = saved.mode === 'computer' ? 'offline vs computer' : saved.bot ? 'vs Botty' : 'live room';
  $('resumeText').textContent = `${(meta && meta.name) || saved.game || 'Game'} - ${modeText} - room ${saved.room}`;
  card.classList.remove('hidden');
}

function resumeSavedGame() {
  session = session || loadSession();
  if (!session || !session.room) { updateResumeCard(); return; }
  show(sectionForGame(session.game));
  enterRoom();
}

function discardSavedGame() {
  if (!confirm('Discard the saved game? The room code and seat are forgotten on this device.')) return;
  clearSession();
  updateResumeCard();
}

function leaveGame() {
  if (!confirm('Leave this game? This clears the saved local session for this device.')) return;
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

function enterRoom() { startPoll(); poll(); }

async function restartComputerGame() {
  if (!session || session.mode !== 'computer') return;
  const game = session.game || selectedGameId();
  const name = ($('name1') && $('name1').value.trim()) || 'Player 1';
  try {
    clearSession();
    resetGameUi();
    lastView = null;
    session = { mode: 'computer' };
    const d = await api('/api/create', 'POST', { game, name });
    setSession({ room: d.room, token: d.token, you: d.you, game: d.game, mode: 'computer' });
    toast('New game started.');
    enterRoom();
  } catch (e) { clearSession(); toast(e.message); }
}

function updateSoloRestartButtons() {
  document.querySelectorAll('.solo-restart').forEach(btn => {
    btn.classList.toggle('hidden', !(session && session.mode === 'computer'));
  });
}


function startPoll() { stopPoll(); pollTimer = setInterval(poll, 1000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  if (!session) return;
  try {
    const d = await api(`/api/state?room=${encodeURIComponent(session.room)}`, 'GET');
    render(d);
  } catch (e) {
    if (/No such game|Not in this game/.test(e.message)) { clearSession(); stopPoll(); show('home'); }
  }
}

function render(d) {
  updateSoloRestartButtons();
  const v = d.view;
  lastView = v;
  fleetDef = v.fleet || fleetDef || [];
  boardSize = v.size || boardSize;
  $('foot').textContent = `Game ${session.room} - ${d.youName}` + (d.opponentName ? ` vs ${d.opponentName}` : '');

  if (!d.opponentJoined) { show('lobby'); $('lobbyCode').textContent = session.room; return; }

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

// ---------------- shared UI reset ----------------
function resetGameUi() {
  resetPlacement();
  $('fireGrid').innerHTML = '';
  $('myGrid').innerHTML = '';
  $('connectColumns').innerHTML = '';
  $('connectBoard').innerHTML = '';
  connectUi = { focusedCol: 3, lastMoveNumber: 0, boardSig: '', overFxDone: false };
  connectLastData = null;
  if ($('connectEndBanner')) $('connectEndBanner').classList.add('hidden');
  if ($('dotsBoard')) $('dotsBoard').innerHTML = '';
  dotsUi = { lastMoveNumber: 0, boardSig: '', overFxDone: false };
  if ($('dotsEndBanner')) $('dotsEndBanner').classList.add('hidden');
  if ($('mncBoard')) {
    $('mncBoard').innerHTML = '';
    $('mncBoard').classList.remove('my-turn');
    mncLastPits = null; mncLastMoveNumber = 0; mncBoardSig = ''; mncAnimating = false; mncOverFxDone = false;
  }
  if ($('utttBoard')) $('utttBoard').innerHTML = '';
  utttUi = { lastMove: null, seen: false };
  $('oneCardOpponents').innerHTML = '';
  resetOneCardHandUi();
  $('oneCardHand').innerHTML = '';
  unoAnimating = false; unoPrevView = null; unoLastMoveNumber = 0; unoHandSig = '';
  unoOverFxDone = false; unoWasMyTurn = false; unoPendingWild = null;
  if ($('unoColorPick')) $('unoColorPick').classList.add('hidden');
  document.querySelectorAll('.uno-fly').forEach(el => el.remove());
  lastBattleEventKey = null;
  lastBattleTurn = null;
  battleAimAnimation = null;
  battleShellAnimation = null;
  aimCell = null;
  pendingOutgoing = null;
  battleOverFxDone = false;
  battleIncomingHoldUntil = 0;
  setBattleFocus('fire');
  ['battleAim', 'playerAim'].forEach(id => { const el = $(id); if (el) el.remove(); });
  document.querySelectorAll('.shell-tracer').forEach(el => el.remove());
  if ($('enemyFleetStrip')) $('enemyFleetStrip').innerHTML = '';
  if ($('myFleetStrip')) $('myFleetStrip').innerHTML = '';
}

// ---------------- placement ----------------
function resetPlacement() {
  placedShips = [];
  selectedShip = null;
  lastShipTap = null;
  orient = 'H';
  $('placeGrid').innerHTML = '';
  $('placeGrid').dataset.size = '';
  $('fleetList').innerHTML = '';
  $('orientBtn').textContent = 'Heading: East';
  $('readyBtn').disabled = true;
}

function initPlacement() {
  resetPlacement();
  const g = $('placeGrid');
  g.dataset.size = String(boardSize);
  g.onpointermove = dragPreviewPlacement;
  g.onpointerup = finishPlacementDrag;
  g.onpointercancel = cancelPlacementDrag;
  g.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell'; cell.dataset.r = r; cell.dataset.c = c;
    cell.onclick = () => {
      if (ignoreNextPlacementClick) { ignoreNextPlacementClick = false; return; }
      clickPlacementCell(r, c);
    };
    cell.onpointerdown = event => startPlacementDrag(event, r, c);
    cell.onpointermove = event => dragPreviewPlacement(event);
    cell.onpointerup = event => finishPlacementDrag(event);
    cell.onpointercancel = event => cancelPlacementDrag(event);
    cell.onmouseenter = () => previewPlacement(r, c);
    cell.onmouseleave = () => { if (!placementDrag) renderPlaceGrid(); };
    g.appendChild(cell);
  }
  // default selection = first ship
  selectedShip = 0;
  renderFleetList(); renderPlaceGrid();
}

function renderFleetList() {
  const list = $('fleetList'); list.innerHTML = '';
  fleetDef.forEach((s, i) => {
    const placed = placedShips.find(p => p.name === s.name);
    const row = document.createElement('div');
    row.className = 'ship-row' + (i === selectedShip ? ' active' : '') + (placed ? ' done' : '');
    const pips = Array.from({ length: s.size }, () => '<span class="pip"></span>').join('');
    row.innerHTML = `<span class="ship-name">${s.name}</span>
      <span style="display:flex;align-items:center;gap:10px">
        <span class="pips">${pips}</span>
        ${placed ? '<span class="check">ok</span>' : `<span style="color:var(--mute);font-size:12px">${s.size}</span>`}
      </span>`;
    row.onclick = () => {
      if (placed) { removePlacedShip(placed); return; }
      selectedShip = i; renderFleetList(); renderPlaceGrid();
    };
    list.appendChild(row);
  });
  $('readyBtn').disabled = placedShips.length !== fleetDef.length;
}

function parseGridCellKey(cell) {
  const [r, c] = cell.split(',').map(Number);
  return { r, c };
}

function shipCells(r, c, size, shipOrient = orient) {
  const cells = [];
  for (let i = 0; i < size; i++) cells.push(shipOrient === 'H' ? `${r},${c + i}` : `${r + i},${c}`);
  return cells;
}
function clampShipStart(r, c, size, shipOrient = orient) {
  const maxR = shipOrient === 'H' ? boardSize - 1 : boardSize - size;
  const maxC = shipOrient === 'H' ? boardSize - size : boardSize - 1;
  return { r: Math.max(0, Math.min(maxR, r)), c: Math.max(0, Math.min(maxC, c)) };
}
function placementCellFromPointer(event, drag = placementDrag) {
  const grid = $('placeGrid');
  const rect = grid.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
  const cell = rect.width / boardSize;
  const r = Math.floor(y / cell) - (drag && drag.offsetR || 0);
  const c = Math.floor(x / cell) - (drag && drag.offsetC || 0);
  return clampShipStart(r, c, drag && drag.size || (fleetDef[selectedShip] && fleetDef[selectedShip].size) || 1, drag && drag.orient || orient);
}

function occupiedSet(ignoreName) { const s = new Set(); placedShips.filter(p => p.name !== ignoreName).forEach(p => p.cells.forEach(x => s.add(x))); return s; }

function placeAt(r, c, opts = {}) {
  const existing = !opts.fromDrag && placedShipAt(`${r},${c}`);
  if (existing) { tapPlacedShip(existing); return; }
  if (selectedShip == null) return;
  const def = fleetDef[selectedShip];
  if (placedShips.find(p => p.name === def.name)) return; // already placed; tap list to pull back
  const start = clampShipStart(r, c, def.size, orient);
  const cells = shipCells(start.r, start.c, def.size, orient);
  const occ = occupiedSet();
  for (const cell of cells) {
    const [rr, cc] = cell.split(',').map(Number);
    if (rr < 0 || rr >= boardSize || cc < 0 || cc >= boardSize) { toast('Off the board.'); return; }
    if (occ.has(cell)) { toast('Ships cannot overlap.'); return; }
  }
  placedShips.push({ name: def.name, size: def.size, cells, orient });
  renderFleetList(); renderPlaceGrid();
}

function placedShipAt(key) {
  return placedShips.find(ship => ship.cells.includes(key));
}

function clickPlacementCell(r, c) {
  const ship = placedShipAt(`${r},${c}`);
  if (ship) { tapPlacedShip(ship); return; }
  placeAt(r, c);
}

// Single tap selects the ship; a second tap on it within the window rotates it.
function tapPlacedShip(ship) {
  const now = Date.now();
  const isDouble = lastShipTap && lastShipTap.name === ship.name && now - lastShipTap.time < 400;
  lastShipTap = isDouble ? null : { name: ship.name, time: now };
  if (isDouble) { rotatePlacedShip(ship); return; }
  selectedShip = fleetDef.findIndex(s => s.name === ship.name);
  if (ship.orient) {
    orient = ship.orient;
    $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
  }
  renderFleetList(); renderPlaceGrid();
}

function rotatePlacedShip(ship) {
  const oldOrient = ship.orient || 'H';
  const newOrient = oldOrient === 'H' ? 'V' : 'H';
  const head = parseGridCellKey(ship.cells[0]);
  const start = clampShipStart(head.r, head.c, ship.size, newOrient);
  const cells = shipCells(start.r, start.c, ship.size, newOrient);
  const occ = occupiedSet(ship.name);
  if (cells.some(cell => occ.has(cell))) { toast('No room to rotate there.'); return false; }
  ship.orient = newOrient;
  ship.cells = cells;
  selectedShip = fleetDef.findIndex(s => s.name === ship.name);
  orient = newOrient;
  $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
  renderFleetList(); renderPlaceGrid();
  return true;
}

function canPlaceCells(cells, ignoreName) {
  const occ = occupiedSet(ignoreName);
  return cells.every(cell => !occ.has(cell));
}

function findNearbyPlacement(r, c, size, shipOrient, ignoreName) {
  for (let radius = 0; radius < boardSize; radius++) {
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
      const start = clampShipStart(r + dr, c + dc, size, shipOrient);
      const cells = shipCells(start.r, start.c, size, shipOrient);
      if (canPlaceCells(cells, ignoreName)) return { ...start, cells };
    }
  }
  return null;
}

function removePlacedShip(ship) {
  if (!ship) return false;
  const idx = fleetDef.findIndex(s => s.name === ship.name);
  placedShips = placedShips.filter(p => p.name !== ship.name);
  selectedShip = idx === -1 ? selectedShip : idx;
  if (ship.orient) {
    orient = ship.orient;
    $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
  }
  renderFleetList(); renderPlaceGrid();
  return true;
}

function renderPlaceGrid(preview = []) {
  const occ = occupiedSet();
  const previewSet = new Set(preview.map(item => item.key));
  const blocked = preview.some(item => item.blocked);
  const overlap = preview.some(item => item.overlap);
  document.querySelectorAll('#placeGrid .cell').forEach(cell => {
    const key = `${cell.dataset.r},${cell.dataset.c}`;
    let cls = 'cell';
    const ship = placedShipAt(key);
    if (occ.has(key)) cls += ' ship';
    if (ship && ship.cells[0] === key) cls += ' ship-bow';
    if (previewSet.has(key)) cls += blocked ? ' blocked' : ' preview';
    if (previewSet.has(key) && overlap) cls += ' overlap-preview';
    cell.className = cls;
    cell.textContent = ship && ship.cells[0] === key ? ship.name[0] : '';
    cell.title = ship ? `${ship.name} - drag to move, double-tap to rotate` : '';
  });
}

function placementPreviewCells(r, c) {
  if (selectedShip == null || !fleetDef[selectedShip]) return [];
  const def = fleetDef[selectedShip];
  const start = clampShipStart(r, c, def.size, orient);
  const occ = occupiedSet(def.name);
  return shipCells(start.r, start.c, def.size, orient).map(key => {
    const [rr, cc] = key.split(',').map(Number);
    const overlap = occ.has(key);
    return { key, blocked: rr < 0 || rr >= boardSize || cc < 0 || cc >= boardSize || overlap, overlap };
  });
}

function previewPlacement(r, c) {
  if (selectedShip == null || !fleetDef[selectedShip]) return;
  const def = fleetDef[selectedShip];
  if (placedShips.find(p => p.name === def.name)) return;
  const preview = placementPreviewCells(r, c);
  renderPlaceGrid(preview);
}

function startPlacementDrag(event, r, c) {
  const key = `${r},${c}`;
  const ship = placedShipAt(key);
  const grid = $('placeGrid');
  if (event.pointerId != null) grid.setPointerCapture && grid.setPointerCapture(event.pointerId);
  if (ship) {
    const idx = ship.cells.indexOf(key);
    const offsetR = (ship.orient || 'H') === 'H' ? 0 : idx;
    const offsetC = (ship.orient || 'H') === 'H' ? idx : 0;
    placedShips = placedShips.filter(p => p.name !== ship.name);
    selectedShip = fleetDef.findIndex(s => s.name === ship.name);
    orient = ship.orient || 'H';
    placementDrag = { active: true, moved: false, fromShip: true, original: ship, name: ship.name, size: ship.size, orient, offsetR, offsetC };
  } else {
    if (selectedShip == null || !fleetDef[selectedShip]) return;
    const def = fleetDef[selectedShip];
    placementDrag = { active: true, moved: false, name: def.name, size: def.size, orient, offsetR: 0, offsetC: 0 };
  }
  const pos = placementCellFromPointer(event);
  previewPlacement(pos.r, pos.c);
  event.preventDefault();
}

function dragPreviewPlacement(event) {
  if (!placementDrag || !placementDrag.active || !(event.buttons & 1)) return;
  placementDrag.moved = true;
  const pos = placementCellFromPointer(event);
  previewPlacement(pos.r, pos.c);
}

function finishPlacementDrag(event) {
  if (!placementDrag || !placementDrag.active) return;
  const drag = placementDrag;
  const pos = placementCellFromPointer(event, drag);
  placementDrag = null;
  ignoreNextPlacementClick = true;
  if (drag.fromShip && !drag.moved) {
    placedShips.push(drag.original);
    tapPlacedShip(drag.original);
    event.preventDefault();
    return;
  }
  const cells = shipCells(pos.r, pos.c, drag.size, drag.orient);
  const final = canPlaceCells(cells, drag.name) ? { ...pos, cells } : findNearbyPlacement(pos.r, pos.c, drag.size, drag.orient, drag.name);
  if (!final) { toast('No clear water nearby.'); renderFleetList(); renderPlaceGrid(); event.preventDefault(); return; }
  placedShips = placedShips.filter(p => p.name !== drag.name);
  placedShips.push({ name: drag.name, size: drag.size, cells: final.cells, orient: drag.orient });
  selectedShip = fleetDef.findIndex(s => s.name === drag.name);
  orient = drag.orient;
  $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
  renderFleetList(); renderPlaceGrid();
  event.preventDefault();
}

function cancelPlacementDrag(event) {
  const drag = placementDrag;
  placementDrag = null;
  if (drag && drag.fromShip && !placedShips.find(p => p.name === drag.original.name)) placedShips.push(drag.original);
  renderFleetList(); renderPlaceGrid();
}


function toggleOrient() {
  orient = orient === 'H' ? 'V' : 'H';
  $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
  renderPlaceGrid();
}

function randomize() {
  placedShips = [];
  for (const def of fleetDef) {
    let ok = false, tries = 0;
    while (!ok && tries++ < 500) {
      const o = Math.random() < 0.5 ? 'H' : 'V';
      const r = Math.floor(Math.random() * boardSize), c = Math.floor(Math.random() * boardSize);
      const cells = [];
      for (let i = 0; i < def.size; i++) cells.push(o === 'H' ? `${r},${c + i}` : `${r + i},${c}`);
      const occ = occupiedSet();
      ok = cells.every(cell => {
        const [rr, cc] = cell.split(',').map(Number);
        return rr >= 0 && rr < boardSize && cc >= 0 && cc < boardSize && !occ.has(cell);
      });
      if (ok) placedShips.push({ name: def.name, size: def.size, cells, orient: o });
    }
  }
  selectedShip = null; renderFleetList(); renderPlaceGrid();
}

async function submitFleet() {
  try {
    await api('/api/setup', 'POST', { room: session.room, ships: placedShips });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- battle ----------------
function buildGrid(el, fireable) {
  if (el.dataset.size === String(boardSize) && el.children.length) return;
  el.dataset.size = String(boardSize);
  el.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  el.innerHTML = '';
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell'; cell.dataset.r = r; cell.dataset.c = c;
    if (fireable) cell.onclick = () => aimAt(r, c);
    el.appendChild(cell);
  }
}

function setBattleFocus(which) {
  battleFocus = which;
  const scene = $('battleScene');
  if (!scene) return;
  scene.classList.toggle('focus-fire', which === 'fire');
  scene.classList.toggle('focus-mine', which === 'mine');
}

function wireBattlePlanes() {
  const scene = $('battleScene');
  if (!scene || scene.dataset.wired) return;
  scene.dataset.wired = '1';
  [['firePlane', 'fire'], ['myPlane', 'mine']].forEach(([id, which]) => {
    $(id).addEventListener('click', event => {
      if (battleFocus === which) return;
      // capture-phase: bring the background board forward instead of clicking a cell
      event.stopPropagation();
      event.preventDefault();
      setBattleFocus(which);
    }, true);
  });
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

// ---- aiming + fire confirm
function aimAt(r, c) {
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (lastView.firingBoard[r][c]) { toast('Already fired there.'); return; }
  aimCell = { r, c };
  mncEnsureAudio();
  battleSfx('aim');
  battleVibrate(10);
  updateAimUi();
}

function updateAimUi() {
  const btn = $('fireBtn');
  if (!btn) return;
  const grid = $('fireGrid');
  const myTurn = !!(lastView && lastView.phase === 'battle' && session && lastView.turn === session.you);
  if (aimCell && lastView && lastView.firingBoard && lastView.firingBoard[aimCell.r][aimCell.c]) aimCell = null;
  let aim = $('playerAim');
  if (!myTurn || !aimCell) {
    if (aim && !aim.classList.contains('locked')) aim.remove();
    btn.disabled = true;
    btn.textContent = !lastView || lastView.phase !== 'battle' ? 'FIRE' : myTurn ? 'TAP A TARGET' : 'STANDBY';
    return;
  }
  if (!aim) {
    aim = document.createElement('div');
    aim.id = 'playerAim';
    aim.className = 'battle-aim player';
    aim.setAttribute('aria-hidden', 'true');
    grid.appendChild(aim);
  }
  const cell = grid.querySelector(`.cell[data-r="${aimCell.r}"][data-c="${aimCell.c}"]`);
  if (cell) {
    aim.style.width = `${cell.offsetWidth}px`;
    aim.style.height = `${cell.offsetHeight}px`;
    aim.style.transform = `translate(${cell.offsetLeft}px, ${cell.offsetTop}px)`;
  }
  btn.disabled = false;
  btn.textContent = `FIRE ${coordLabel(aimCell.r, aimCell.c)}`;
}

async function confirmFire() {
  if (!aimCell) return;
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  const { r, c } = aimCell;
  if (lastView.firingBoard[r][c]) { aimCell = null; updateAimUi(); return; }
  $('fireBtn').disabled = true;
  mncEnsureAudio();
  try {
    await api('/api/move', 'POST', { room: session.room, move: { r, c } });
    aimCell = null;
    pendingOutgoing = { r, c };
    const aim = $('playerAim');
    if (aim) { aim.classList.add('locked'); setTimeout(() => aim.remove(), 340); }
    battleSfx('fire');
    battleVibrate(15);
    poll();
  } catch (e) { toast(e.message); updateAimUi(); }
}

function startShellAnimation(r, c, done) {
  const grid = $('fireGrid');
  const target = grid && grid.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (!grid || !target) { done(); return; }
  const tracer = document.createElement('div');
  tracer.className = 'shell-tracer';
  tracer.style.left = `${grid.clientWidth / 2}px`;
  tracer.style.top = `${grid.clientHeight + 16}px`;
  grid.appendChild(tracer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tracer.style.left = `${target.offsetLeft + target.offsetWidth / 2}px`;
    tracer.style.top = `${target.offsetTop + target.offsetHeight / 2}px`;
  }));
  setTimeout(() => { tracer.remove(); done(); }, 430);
}

// ---- shared shot resolution effects (explosion/splash, flash, shake, sfx)
function shotFx(grid, r, c, result, sunkCells) {
  const cell = grid.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) {
    cell.classList.remove('boom', 'splash');
    void cell.offsetWidth;
    cell.classList.add(result === 'hit' ? 'boom' : 'splash');
  }
  grid.classList.remove('hit-flash', 'miss-flash', 'shake');
  void grid.offsetWidth;
  grid.classList.add(result === 'hit' ? 'hit-flash' : 'miss-flash');
  if (sunkCells) {
    grid.classList.add('shake');
    sunkCells.forEach(key => {
      const [rr, cc] = key.split(',');
      const el = grid.querySelector(`.cell[data-r="${rr}"][data-c="${cc}"]`);
      if (el) el.classList.add('sink-pop');
    });
  }
  battleSfx(sunkCells ? 'sunk' : result);
  battleVibrate(sunkCells ? [0, 80, 60, 140] : result === 'hit' ? [0, 70] : 25);
}

function renderFleetStrip(el, ships, mine) {
  if (!el) return;
  el.innerHTML = (ships || []).map(s => {
    const pips = Array.from({ length: s.size }, (_, i) =>
      `<span class="fs-pip${(s.sunk || (mine && i < (s.hits || 0))) ? ' hit' : ''}"></span>`).join('');
    return `<span class="fs-ship${s.sunk ? ' sunk' : ''}" title="${s.name}${s.sunk ? ' - sunk' : ''}">${pips}</span>`;
  }).join('');
}

function battleShotKey(shot) {
  return shot ? `${shot.by}:${shot.r},${shot.c}:${shot.result}:${shot.sunk || ''}` : null;
}

function renderBattle(d, v) {
  buildGrid($('fireGrid'), true);
  buildGrid($('myGrid'), false);
  wireBattlePlanes();
  updateFxButton();

  const shot = v.lastShot;
  const shotKey = battleShotKey(shot);
  const newShot = !!shotKey && shotKey !== lastBattleEventKey;
  const turnChanged = v.turn !== lastBattleTurn;
  const yourTurn = v.phase === 'battle' && v.turn === d.you;
  const incomingNewShot = newShot && shot && shot.by !== d.you;

  // outgoing shot: shell tracer flies to the target, result concealed until impact
  if (pendingOutgoing && !battleShellAnimation) {
    const { r, c } = pendingOutgoing;
    const result = v.firingBoard[r] && v.firingBoard[r][c];
    if (result) {
      // a sunk enemy ship containing this cell means this shot sank it
      const sunkShip = (v.enemyFleet || []).find(s => s.sunk && s.cells && s.cells.includes(`${r},${c}`));
      battleShellAnimation = { r, c };
      startShellAnimation(r, c, () => {
        battleShellAnimation = null;
        pendingOutgoing = null;
        battleIncomingHoldUntil = Date.now() + 900;
        if (lastView) renderBattle(d, lastView);
        shotFx($('fireGrid'), r, c, result, sunkShip ? sunkShip.cells : null);
        if (sunkShip && lastView && lastView.phase !== 'over') toast(`Enemy ${sunkShip.name} destroyed!`);
      });
    } else {
      pendingOutgoing = null;
    }
  }
  const concealOutgoing = battleShellAnimation;

  // incoming shot: reticle sweeps your board first (queued behind the shell fx)
  const incomingHeld = incomingNewShot && Date.now() < battleIncomingHoldUntil;
  if (incomingNewShot && !incomingHeld && !battleAimAnimation && !concealOutgoing) {
    setBattleFocus('mine');
    startBattleAimAnimation(shot, d);
  }
  const concealIncoming = battleAimAnimation && battleAimAnimation.key === shotKey;
  const animating = !!(battleAimAnimation || battleShellAnimation) || incomingHeld;

  if (turnChanged && yourTurn && !animating) setBattleFocus('fire');

  $('battle').classList.toggle('your-turn', yourTurn);
  $('fireGrid').classList.toggle('ready-to-fire', yourTurn);

  // while an animation conceals a shot, do not spoil a sink it just caused;
  // an incoming shot stays hidden through the pre-sweep hold as well
  const concealedOutKey = concealOutgoing ? `${concealOutgoing.r},${concealOutgoing.c}` : null;
  const concealedInKey = (concealIncoming || incomingHeld) && shot ? `${shot.r},${shot.c}` : null;
  const enemySunkCells = new Set();
  const enemyRevealCells = new Set();
  (v.enemyFleet || []).forEach(s => {
    if (!s.cells) return;
    if (s.sunk && !(concealedOutKey && s.cells.includes(concealedOutKey))) s.cells.forEach(key => enemySunkCells.add(key));
    else if (v.phase === 'over' && !animating) s.cells.forEach(key => enemyRevealCells.add(key));
  });
  const mySunkCells = new Set();
  (v.myFleet || []).forEach(s => {
    if (s.sunk && s.cells && !(concealedInKey && s.cells.includes(concealedInKey))) s.cells.forEach(key => mySunkCells.add(key));
  });

  // firing grid = my shots on enemy
  document.querySelectorAll('#fireGrid .cell').forEach(cell => {
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const key = `${r},${c}`;
    const hidden = concealOutgoing && concealOutgoing.r === r && concealOutgoing.c === c;
    const val = hidden ? null : v.firingBoard[r][c];
    let cls = 'cell' + (val === 'hit' ? ' hit scored-hit' : val === 'miss' ? ' miss' : '');
    if (val === 'hit' && enemySunkCells.has(key)) cls += ' sunk-ship';
    if (!val && enemyRevealCells.has(key)) cls += ' reveal-ship';
    if (!hidden && shot && shot.by === d.you && shot.r === r && shot.c === c) cls += ' last-shot outgoing-shot';
    cell.className = cls;
    cell.setAttribute('aria-label', val ? `Your ${val} at ${coordLabel(r, c)}` : `Aim at ${coordLabel(r, c)}`);
  });
  // my fleet grid, with enemy shots shown
  document.querySelectorAll('#myGrid .cell').forEach(cell => {
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const key = `${r},${c}`;
    const rawSq = v.myBoard[r][c];
    const hideShot = concealedInKey === key;
    const sq = hideShot ? { ...rawSq, shot: null } : rawSq;
    let cls = 'cell';
    if (sq.shot === 'hit') cls += ' hit incoming-hit';
    else if (sq.shot === 'miss') cls += ' miss';
    else if (sq.ship) cls += ' ship';
    if (sq.shot === 'hit' && mySunkCells.has(key)) cls += ' sunk-ship';
    if (!hideShot && shot && shot.by !== d.you && shot.r === r && shot.c === c) cls += ' last-shot incoming-shot';
    cell.className = cls;
    const shipText = sq.ship ? 'ship' : 'water';
    cell.setAttribute('aria-label', sq.shot ? `Opponent ${sq.shot} on your ${shipText} at ${coordLabel(r, c)}` : `Your ${shipText} at ${coordLabel(r, c)}`);
  });

  // fleet strips update immediately; hide only a sink still concealed by a
  // running shot animation so the strip cannot spoil the impact
  const stripEnemy = (v.enemyFleet || []).map(s =>
    (s.sunk && concealedOutKey && s.cells && s.cells.includes(concealedOutKey)) ? { ...s, sunk: false } : s);
  const stripMine = (v.myFleet || []).map(s => {
    if (!concealedInKey || shot.result !== 'hit' || !s.cells || !s.cells.includes(concealedInKey)) return s;
    return { ...s, sunk: false, hits: Math.max(0, (s.hits || 0) - 1) };
  });
  renderFleetStrip($('enemyFleetStrip'), stripEnemy, false);
  renderFleetStrip($('myFleetStrip'), stripMine, true);

  const banner = $('statusBanner');
  if (v.phase === 'over' && animating) {
    banner.className = 'status them';
    banner.textContent = concealIncoming ? `${d.opponentName || 'Opponent'} is sweeping the grid...` : 'Shell in the air...';
  } else if (v.phase === 'over') {
    const won = v.winner === d.you;
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY - enemy fleet destroyed' : 'DEFEAT - your fleet is sunk';
    if (!battleOverFxDone) {
      battleOverFxDone = true;
      setBattleFocus(won ? 'fire' : 'mine');
      battleSfx(won ? 'win' : 'lose');
      battleVibrate(won ? [0, 60, 60, 60, 60, 160] : [0, 240]);
    }
  } else if (yourTurn) {
    banner.className = concealIncoming || incomingHeld ? 'status them' : 'status you';
    banner.textContent = concealIncoming ? `${d.opponentName || 'Opponent'} is sweeping the grid...`
      : incomingHeld ? 'Incoming fire...'
      : (battleStatusText(v, d) || 'YOUR TURN - tap a target, then FIRE');
  } else {
    banner.className = 'status them';
    banner.textContent = concealIncoming ? `${d.opponentName || 'Opponent'} is sweeping the grid...` : (battleStatusText(v, d) || `OPPONENT TURN - ${d.opponentName || 'opponent'} is taking aim...`);
  }

  if (newShot || turnChanged) {
    banner.classList.remove('activity');
    void banner.offsetWidth;
    banner.classList.add('activity');
  }
  if (!concealIncoming && !concealOutgoing && !incomingHeld) lastBattleEventKey = shotKey;
  lastBattleTurn = v.turn;
  updateAimUi();
}

function startBattleAimAnimation(shot, d) {
  const grid = $('myGrid');
  if (!grid) return;
  const key = battleShotKey(shot);
  const aim = document.createElement('div');
  aim.id = 'battleAim';
  aim.className = 'battle-aim';
  aim.setAttribute('aria-hidden', 'true');
  grid.appendChild(aim);
  battleAimAnimation = { key, element: aim };

  const hops = 10;
  const cells = Array.from(grid.querySelectorAll('.cell'));
  const target = grid.querySelector(`.cell[data-r="${shot.r}"][data-c="${shot.c}"]`);
  const path = Array.from({ length: hops - 1 }, () => cells[Math.floor(Math.random() * cells.length)]).concat(target).filter(Boolean);
  let i = 0;
  function place(el) {
    // offset* is layout-based, so the reticle tracks cells even mid 3D transition
    aim.style.width = `${el.offsetWidth}px`;
    aim.style.height = `${el.offsetHeight}px`;
    aim.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
  }
  function hop() {
    if (!battleAimAnimation || battleAimAnimation.key !== key) return;
    if (i >= path.length) {
      aim.classList.add('locked');
      setTimeout(() => {
        if (aim.parentNode) aim.remove();
        battleAimAnimation = null;
        lastBattleEventKey = key;
        renderBattle({ ...d }, lastView);
        const sunkShip = shot.sunk && lastView ? (lastView.myFleet || []).find(s => s.name === shot.sunk) : null;
        shotFx(grid, shot.r, shot.c, shot.result, sunkShip && sunkShip.cells ? sunkShip.cells : null);
        setTimeout(() => {
          if (lastView && lastView.phase === 'battle' && session && lastView.turn === session.you
              && !battleAimAnimation && !battleShellAnimation) setBattleFocus('fire');
        }, 900);
      }, 360);
      return;
    }
    place(path[i]);
    const delay = 70 + i * 28;
    i++;
    setTimeout(hop, delay);
  }
  hop();
}

function coordLabel(r, c) {
  return `${String.fromCharCode(65 + r)}${c + 1}`;
}

function battleStatusText(v, d) {
  const ls = v.lastShot;
  if (!ls) return null;
  const actor = ls.by === d.you ? 'You' : (d.opponentName || 'Opponent');
  const target = ls.by === d.you ? 'enemy waters' : 'your fleet';
  const result = ls.result === 'hit' ? 'HIT' : 'MISS';
  const sunk = ls.sunk ? ` and sank ${ls.by === d.you ? 'their' : 'your'} ${ls.sunk}` : '';
  return `${actor} fired at ${coordLabel(ls.r, ls.c)} in ${target}: ${result}${sunk}. ${v.turn === d.you ? 'YOUR TURN.' : 'OPPONENT TURN.'}`;
}


// ---------------- connect four ----------------
function connectCanMove(v, c) {
  return !!(v && session && v.phase === 'battle' && v.turn === session.you && (v.legalMoves || []).includes(c));
}

function connectOpponentSlot(d) {
  const opponent = (d.players || []).find(player => player.slot !== d.you);
  return opponent ? opponent.slot : d.you === 'A' ? 'B' : 'A';
}

function connectDropRow(v, c) {
  if (!v || !v.board || c < 0 || c >= (v.cols || 7)) return -1;
  for (let r = (v.rows || 6) - 1; r >= 0; r--) {
    if (!v.board[r][c]) return r;
  }
  return -1;
}

function connectLineFrom(board, r, c, slot, rows, cols) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [[r, c]];
    for (const sign of [-1, 1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === slot) {
        cells.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (cells.length >= 4) return cells.slice(0, 4).map(([row, col]) => `${row},${col}`);
  }
  return null;
}

function connectWouldWin(v, c, slot) {
  const row = connectDropRow(v, c);
  if (row < 0) return false;
  const board = v.board.map(sourceRow => sourceRow.slice());
  board[row][c] = slot;
  return !!connectLineFrom(board, row, c, slot, v.rows || 6, v.cols || 7);
}

function connectColumnTone(v, c, d) {
  if (!(v.legalMoves || []).includes(c)) return { kind: 'full', label: 'Full' };
  if (connectWouldWin(v, c, d.you)) return { kind: 'win', label: 'Win' };
  if (connectWouldWin(v, c, connectOpponentSlot(d))) return { kind: 'block', label: 'Block' };
  if (c === Math.floor((v.cols || 7) / 2)) return { kind: 'center', label: 'Mid' };
  return { kind: 'open', label: String(c + 1) };
}

function connectSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'drop') {
    battleTone(audio, t, 460, 0.16, { type: 'triangle', slideTo: 210, gain: 0.07 });
    battleTone(audio, t + 0.14, 180, 0.08, { type: 'sine', gain: 0.08 });
  } else if (kind === 'select') {
    battleTone(audio, t, 920, 0.045, { type: 'square', gain: 0.035 });
  }
}

function connectSetFocus(c, renderAgain = true) {
  const cols = (lastView && lastView.cols) || 7;
  connectUi.focusedCol = Math.max(0, Math.min(cols - 1, c));
  if (renderAgain && connectLastData && lastView && lastView.ui === 'connectfour') {
    renderConnectFour(connectLastData, lastView);
  }
}

function connectStepFocus(delta) {
  if (!lastView || lastView.ui !== 'connectfour') return;
  const cols = lastView.cols || 7;
  let next = connectUi.focusedCol;
  for (let i = 0; i < cols; i++) {
    next = (next + delta + cols) % cols;
    if (!lastView.legalMoves || lastView.legalMoves.includes(next)) break;
  }
  connectSetFocus(next);
  connectSfx('select');
}

function renderConnectFour(d, v) {
  const cols = v.cols || 7;
  const rows = v.rows || 6;
  const columns = $('connectColumns');
  const board = $('connectBoard');
  const winning = new Set(v.winningCells || []);
  const last = v.lastMove ? `${v.lastMove.r},${v.lastMove.c}` : null;
  const boardSig = v.board.map(row => row.map(cell => cell || '-').join('')).join('/');
  const newMove = (v.moveNumber || 0) > (connectUi.lastMoveNumber || 0) && connectUi.boardSig && boardSig !== connectUi.boardSig;
  const opponentSlot = connectOpponentSlot(d);
  const opponentName = d.opponentName || 'Opponent';
  const legal = v.legalMoves || [];
  const yourTurn = v.phase === 'battle' && v.turn === d.you;

  connectLastData = d;
  if (connectUi.focusedCol >= cols) connectUi.focusedCol = Math.floor(cols / 2);
  if (!legal.includes(connectUi.focusedCol) && legal.length) {
    connectUi.focusedCol = legal.includes(Math.floor(cols / 2)) ? Math.floor(cols / 2) : legal[0];
  }
  const focused = connectUi.focusedCol;
  const focusedTone = connectColumnTone(v, focused, d);
  const previewRow = yourTurn && connectCanMove(v, focused) ? connectDropRow(v, focused) : -1;

  const youPanel = $('connectYouPanel');
  const opponentPanel = $('connectOpponentPanel');
  const turnBadge = $('connectTurnBadge');
  if (youPanel) youPanel.className = `connect-player you${v.phase === 'battle' && v.turn === d.you ? ' active' : ''}`;
  if (opponentPanel) opponentPanel.className = `connect-player opponent${v.phase === 'battle' && v.turn === opponentSlot ? ' active' : ''}`;
  if ($('connectYouName')) $('connectYouName').textContent = d.youName || 'You';
  if ($('connectOpponentName')) $('connectOpponentName').textContent = opponentName;
  if (turnBadge) turnBadge.className = `connect-turn${v.phase === 'battle' && v.turn !== d.you ? ' opponent' : ''}`;
  if ($('connectTurnText')) $('connectTurnText').textContent = v.phase === 'over' ? 'Done' : v.turn === d.you ? 'You' : 'Them';

  columns.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  columns.onclick = event => {
    const source = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
    const target = source ? source.closest('.drop-btn') : null;
    if (!target || target.disabled) return;
    const col = Number(target.dataset.col);
    if (Number.isInteger(col)) dropConnectDisc(col);
  };
  columns.innerHTML = '';
  for (let c = 0; c < cols; c++) {
    const tone = connectColumnTone(v, c, d);
    const canDrop = yourTurn && connectCanMove(v, c);
    const focusColumn = () => {
      if (!canDrop) return;
      connectSetFocus(c, false);
    };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drop-btn'
      + (c === focused ? ' selected' : '')
      + (tone.kind === 'win' ? ' win-now' : '')
      + (tone.kind === 'block' ? ' block-now' : '');
    btn.dataset.col = String(c);
    btn.disabled = !canDrop;
    btn.setAttribute('aria-label', `Drop disc in column ${c + 1}`);
    const arrow = document.createElement('span');
    arrow.className = 'drop-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'drop-label';
    label.textContent = tone.label;
    btn.append(arrow, label);
    btn.onpointerenter = focusColumn;
    btn.onpointerdown = () => { if (canDrop) connectSetFocus(c, false); };
    btn.onfocus = () => { if (canDrop) connectSetFocus(c, false); };
    columns.appendChild(btn);
  }

  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  board.className = `connect-board${v.phase === 'over' && v.winner ? ' win' : ''}`;
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', 'Connect Four board');
  board.innerHTML = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const owner = v.board[r][c];
    const key = `${r},${c}`;
    const isPreview = !owner && r === previewRow && c === focused;
    const canDrop = yourTurn && connectCanMove(v, c);
    const relation = owner ? owner === d.you ? ' you' : ' opponent' : '';
    const cell = document.createElement('div');
    cell.className = 'connect-cell'
      + relation
      + (canDrop ? ' playable' : '')
      + (isPreview ? ' preview' : '')
      + (isPreview && focusedTone.kind === 'block' ? ' danger-preview' : '')
      + (last === key ? ' last' : '')
      + (last === key && newMove ? ' drop-in' : '')
      + (winning.has(key) ? ' win' : '');
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', owner ? `${owner === d.you ? 'Your' : opponentName} disc` : `Empty slot, column ${c + 1}`);
    cell.onpointerenter = () => { if (canDrop) connectSetFocus(c, false); };
    cell.onpointerdown = () => { if (canDrop) connectSetFocus(c, false); };
    if (canDrop) cell.onclick = () => dropConnectDisc(c);
    if (owner) {
      const token = document.createElement('span');
      token.className = 'connect-token';
      cell.appendChild(token);
    }
    board.appendChild(cell);
  }

  const banner = $('connectStatus');
  const end = $('connectEndBanner');
  if (v.phase === 'over') {
    const tied = !v.winner;
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - the grid is full' : won ? 'VICTORY - four connected' : 'DEFEAT - rival connected four';
    if (end) {
      end.className = 'connect-end ' + (tied ? 'draw' : won ? 'win' : 'lose');
      $('connectEndTitle').textContent = tied ? 'Draw' : won ? 'Victory' : 'Defeat';
      $('connectEndSub').textContent = tied ? 'No lanes left' : 'Four in a row';
    }
    if (!connectUi.overFxDone) {
      battleSfx(tied ? 'miss' : won ? 'win' : 'lose');
      battleVibrate(tied ? 18 : [18, 55, 18]);
      connectUi.overFxDone = true;
    }
  } else if (v.turn === d.you) {
    banner.className = 'status you';
    const winningDrops = legal.filter(c => connectColumnTone(v, c, d).kind === 'win');
    const blocks = legal.filter(c => connectColumnTone(v, c, d).kind === 'block');
    if (winningDrops.length) banner.textContent = `YOUR DROP - win in column ${winningDrops[0] + 1}`;
    else if (blocks.length) banner.textContent = `YOUR DROP - block column ${blocks[0] + 1}`;
    else banner.textContent = `YOUR DROP - column ${focused + 1}`;
    if (end) end.classList.add('hidden');
    connectUi.overFxDone = false;
  } else {
    banner.className = 'status them';
    banner.textContent = `OPPONENT TURN - ${opponentName}`;
    if (end) end.classList.add('hidden');
    connectUi.overFxDone = false;
  }
  if (newMove) {
    banner.classList.add('activity');
    connectSfx('drop');
    battleVibrate(12);
  }
  connectUi.lastMoveNumber = v.moveNumber || 0;
  connectUi.boardSig = boardSig;
}

async function dropConnectDisc(c) {
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (!lastView.legalMoves.includes(c)) { toast('That column is full.'); return; }
  connectSetFocus(c, false);
  try {
    connectSfx('drop');
    battleVibrate(10);
    await api('/api/move', 'POST', { room: session.room, move: { c } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- dots and boxes ----------------
function dotsEdgeId(type, r, c) { return `${type}-${r}-${c}`; }
function dotsOpponentSlot(d) {
  const opponent = (d.players || []).find(player => player.slot !== d.you);
  return opponent ? opponent.slot : d.you === 'A' ? 'B' : 'A';
}
function dotsPlayerName(d, slot) {
  if (slot === d.you) return d.youName || 'You';
  const player = (d.players || []).find(p => p.slot === slot);
  return (player && player.name) || d.opponentName || 'Opponent';
}
function dotsOwnerClass(owner, d) {
  if (!owner) return '';
  return owner === d.you ? ' you' : ' opponent';
}
function dotsEdgeOwner(v, type, r, c) {
  return v.edges && v.edges[type] && v.edges[type][r] ? v.edges[type][r][c] : null;
}
function dotsBoxOwner(v, r, c) {
  return v.boxes && v.boxes[r] ? v.boxes[r][c] : null;
}
function dotsBoxSideCount(v, r, c) {
  return [
    dotsEdgeOwner(v, 'h', r, c),
    dotsEdgeOwner(v, 'h', r + 1, c),
    dotsEdgeOwner(v, 'v', r, c),
    dotsEdgeOwner(v, 'v', r, c + 1),
  ].filter(Boolean).length;
}
function dotsAdjacentBoxes(v, type, r, c) {
  const rows = v.boxRows || 4;
  const cols = v.boxCols || 4;
  const boxes = [];
  if (type === 'h') {
    if (r > 0) boxes.push([r - 1, c]);
    if (r < rows) boxes.push([r, c]);
  } else {
    if (c > 0) boxes.push([r, c - 1]);
    if (c < cols) boxes.push([r, c]);
  }
  return boxes;
}
function dotsMoveCompletesBox(v, type, r, c) {
  return dotsAdjacentBoxes(v, type, r, c)
    .some(([br, bc]) => !dotsBoxOwner(v, br, bc) && dotsBoxSideCount(v, br, bc) === 3);
}
function dotsSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'box') {
    [440, 554, 659].forEach((freq, i) => battleTone(audio, t + i * 0.055, freq, 0.12, { type: 'triangle', gain: 0.055 }));
  } else {
    battleTone(audio, t, 760, 0.055, { type: 'square', gain: 0.035 });
  }
}
function dotsLastMoveText(d, v) {
  const last = v.lastMove;
  if (!last) return 'Draw a line. Close a box to keep the turn.';
  const actor = last.by === d.you ? 'You' : dotsPlayerName(d, last.by);
  const line = last.type === 'h' ? 'horizontal' : 'vertical';
  const completed = (last.completed || []).length;
  return `${actor} drew a ${line} line${completed ? ` and claimed ${completed} box${completed === 1 ? '' : 'es'}` : ''}.`;
}
function renderDotsBoxes(d, v) {
  const rows = v.boxRows || 4;
  const cols = v.boxCols || 4;
  const board = $('dotsBoard');
  const legal = new Set((v.legalMoves || []).map(move => move.id));
  const lastId = v.lastMove ? dotsEdgeId(v.lastMove.type, v.lastMove.r, v.lastMove.c) : '';
  const completed = new Set(v.lastMove && v.lastMove.completed ? v.lastMove.completed : []);
  const boardSig = JSON.stringify([v.edges, v.boxes, v.scores]);
  const newMove = (v.moveNumber || 0) > (dotsUi.lastMoveNumber || 0) && dotsUi.boardSig && boardSig !== dotsUi.boardSig;
  const opponentSlot = dotsOpponentSlot(d);
  const scores = v.scores || { A: 0, B: 0 };
  const total = rows * cols;
  const youScore = scores[d.you] || 0;
  const opponentScore = scores[opponentSlot] || 0;

  $('dotsYouName').textContent = d.youName || 'You';
  $('dotsOpponentName').textContent = dotsPlayerName(d, opponentSlot);
  $('dotsYouScore').textContent = youScore;
  $('dotsOpponentScore').textContent = opponentScore;
  $('dotsProgress').textContent = `${youScore + opponentScore}/${total}`;
  $('dotsTurnText').textContent = v.phase === 'over' ? 'Done' : v.turn === d.you ? 'Your line' : `${dotsPlayerName(d, v.turn)} line`;

  board.style.gridTemplateColumns = Array.from({ length: cols * 2 + 1 }, (_, i) => i % 2 ? 'minmax(38px, 1fr)' : 'var(--dots-dot)').join(' ');
  board.style.gridTemplateRows = Array.from({ length: rows * 2 + 1 }, (_, i) => i % 2 ? 'minmax(38px, 1fr)' : 'var(--dots-dot)').join(' ');
  board.innerHTML = '';

  for (let gr = 0; gr < rows * 2 + 1; gr++) {
    for (let gc = 0; gc < cols * 2 + 1; gc++) {
      if (gr % 2 === 0 && gc % 2 === 0) {
        const dot = document.createElement('div');
        dot.className = 'db-dot';
        board.appendChild(dot);
      } else if (gr % 2 === 0) {
        const r = gr / 2;
        const c = Math.floor(gc / 2);
        const owner = dotsEdgeOwner(v, 'h', r, c);
        const id = dotsEdgeId('h', r, c);
        const edge = document.createElement('button');
        edge.type = 'button';
        edge.className = 'db-edge h'
          + dotsOwnerClass(owner, d)
          + (owner ? ' claimed' : '')
          + (legal.has(id) ? ' can-play' : '')
          + (lastId === id ? ' last' : '')
          + (!owner && dotsMoveCompletesBox(v, 'h', r, c) ? ' scores' : '');
        edge.disabled = !legal.has(id);
        edge.setAttribute('aria-label', `Draw horizontal line ${r + 1}, ${c + 1}`);
        edge.onclick = () => claimDotsEdge('h', r, c);
        board.appendChild(edge);
      } else if (gc % 2 === 0) {
        const r = Math.floor(gr / 2);
        const c = gc / 2;
        const owner = dotsEdgeOwner(v, 'v', r, c);
        const id = dotsEdgeId('v', r, c);
        const edge = document.createElement('button');
        edge.type = 'button';
        edge.className = 'db-edge v'
          + dotsOwnerClass(owner, d)
          + (owner ? ' claimed' : '')
          + (legal.has(id) ? ' can-play' : '')
          + (lastId === id ? ' last' : '')
          + (!owner && dotsMoveCompletesBox(v, 'v', r, c) ? ' scores' : '');
        edge.disabled = !legal.has(id);
        edge.setAttribute('aria-label', `Draw vertical line ${r + 1}, ${c + 1}`);
        edge.onclick = () => claimDotsEdge('v', r, c);
        board.appendChild(edge);
      } else {
        const r = Math.floor(gr / 2);
        const c = Math.floor(gc / 2);
        const owner = dotsBoxOwner(v, r, c);
        const box = document.createElement('div');
        box.className = 'db-box'
          + dotsOwnerClass(owner, d)
          + (completed.has(`${r},${c}`) ? ' completed' : '');
        box.setAttribute('aria-label', owner ? `${owner === d.you ? 'Your' : dotsPlayerName(d, owner)} box` : 'Open box');
        board.appendChild(box);
      }
    }
  }

  const banner = $('dotsStatus');
  const end = $('dotsEndBanner');
  if (v.phase === 'over') {
    const tied = v.winner === 'draw' || !v.winner;
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - every box claimed' : won ? 'VICTORY - most boxes claimed' : 'DEFEAT - opponent claimed more boxes';
    if (end) {
      end.className = 'dots-end ' + (tied ? 'draw' : won ? 'win' : 'lose');
      $('dotsEndTitle').textContent = tied ? 'Draw' : won ? 'Victory' : 'Defeat';
      $('dotsEndSub').textContent = `${youScore} to ${opponentScore}`;
    }
    if (!dotsUi.overFxDone) {
      battleSfx(tied ? 'miss' : won ? 'win' : 'lose');
      battleVibrate(tied ? 18 : [18, 55, 18]);
      dotsUi.overFxDone = true;
    }
  } else if (v.turn === d.you) {
    const closing = (v.legalMoves || []).find(move => dotsMoveCompletesBox(v, move.type, move.r, move.c));
    banner.className = 'status you';
    banner.textContent = closing ? 'YOUR LINE - close the box' : 'YOUR LINE - draw an open edge';
    if (end) end.classList.add('hidden');
    dotsUi.overFxDone = false;
  } else {
    banner.className = 'status them';
    banner.textContent = `Standing by - ${dotsPlayerName(d, v.turn)} is drawing a line...`;
    if (end) end.classList.add('hidden');
    dotsUi.overFxDone = false;
  }

  $('dotsLast').textContent = dotsLastMoveText(d, v);
  if (newMove) {
    const boxed = v.lastMove && (v.lastMove.completed || []).length;
    dotsSfx(boxed ? 'box' : 'line');
    battleVibrate(boxed ? [10, 30, 10] : 8);
  }
  dotsUi.lastMoveNumber = v.moveNumber || 0;
  dotsUi.boardSig = boardSig;
}

async function claimDotsEdge(type, r, c) {
  if (!lastView || lastView.ui !== 'dotsboxes' || lastView.phase !== 'battle' || lastView.turn !== session.you) {
    toast('Not your turn.');
    return;
  }
  const id = dotsEdgeId(type, r, c);
  if (!(lastView.legalMoves || []).some(move => move.id === id)) {
    toast('That line is already claimed.');
    return;
  }
  try {
    dotsSfx('line');
    battleVibrate(8);
    await api('/api/move', 'POST', { room: session.room, move: { type, r, c } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- UNO ----------------
let unoAnimating = false;
let unoPrevView = null;      // discard/counts snapshot animations run from
let unoLastMoveNumber = 0;
let unoHandSig = '';
let unoOverFxDone = false;
let unoWasMyTurn = false;
let unoPendingWild = null;
let unoLastData = null;

function oneCardLabel(card) {
  if (!card) return '-';
  if (card.kind === 'wild4') return '+4';
  if (card.kind === 'wild') return 'WILD';
  if (card.kind === 'draw2') return '+2';
  if (card.kind === 'reverse') return 'REV';
  if (card.kind === 'skip') return 'SKIP';
  return card.rank;
}
function oneCardColor(card, fallback) {
  if (!card) return fallback || 'red';
  return card.color === 'wild' ? (fallback || 'wild') : card.color;
}
function oneCardName(card) {
  if (!card) return 'Empty discard';
  const color = card.color === 'wild' ? 'Wild' : card.color;
  return `${color} ${oneCardLabel(card)}`;
}
function oneCardCanPlay(v, card) {
  return v.phase === 'battle' && v.turn === session.you && v.legalCardIds.includes(card.id);
}
function resetOneCardHandUi() {
  oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null, lastGesture: null };
}
function clampOneCardIndex(index, hand) {
  if (!hand.length) return 0;
  return Math.max(0, Math.min(hand.length - 1, index));
}
function syncOneCardSelection(hand) {
  if (!hand.length) {
    oneCardHandUi.selectedIndex = 0;
    oneCardHandUi.selectedCardId = null;
    oneCardHandUi.raised = false;
    return;
  }
  const existing = hand.findIndex(card => card.id === oneCardHandUi.selectedCardId);
  oneCardHandUi.selectedIndex = existing >= 0
    ? existing
    : clampOneCardIndex(oneCardHandUi.selectedCardId == null ? Math.floor((hand.length - 1) / 2) : oneCardHandUi.selectedIndex, hand);
  oneCardHandUi.selectedCardId = hand[oneCardHandUi.selectedIndex].id;
}
function setOneCardSelection(hand, index, raised = true) {
  oneCardHandUi.selectedIndex = clampOneCardIndex(index, hand);
  oneCardHandUi.selectedCardId = hand[oneCardHandUi.selectedIndex] ? hand[oneCardHandUi.selectedIndex].id : null;
  oneCardHandUi.raised = !!(raised && hand.length);
  layoutOneCardFan(hand);
}
function oneCardFanMetrics(hand) {
  const n = Math.max(1, hand.length);
  const handEl = $('oneCardHand');
  const width = Math.max(280, (handEl && handEl.clientWidth) || window.innerWidth || 360);
  const cardWidth = Math.max(54, Math.min(92, 92 - Math.max(0, n - 7) * 4));
  const usable = Math.max(0, width - cardWidth - 20);
  const step = n <= 1 ? 0 : Math.min(cardWidth * 0.64, usable / (n - 1));
  return { n, cardWidth, step };
}
function layoutOneCardFan(hand) {
  const handEl = $('oneCardHand');
  if (!handEl) return;
  syncOneCardSelection(hand);
  const { n, cardWidth, step } = oneCardFanMetrics(hand);
  const selected = oneCardHandUi.selectedIndex;
  handEl.style.setProperty('--hand-card-w', `${cardWidth}px`);
  handEl.style.setProperty('--hand-count', String(n));
  handEl.style.setProperty('--selected-index', String(selected));
  handEl.classList.toggle('raised', oneCardHandUi.raised);
  handEl.querySelectorAll('.one-card-card').forEach((cardEl, i) => {
    const offset = i - (n - 1) / 2;
    const fromSelected = i - selected;
    const absSelected = Math.abs(fromSelected);
    const selectedLift = oneCardHandUi.raised && i === selected ? -72 : 0;
    const neighborLift = oneCardHandUi.raised && absSelected === 1 ? -18 : 0;
    cardEl.style.setProperty('--fan-x', `${offset * step}px`);
    cardEl.style.setProperty('--fan-y', `${Math.abs(offset) * 4 + selectedLift + neighborLift}px`);
    cardEl.style.setProperty('--fan-rot', `${offset * Math.max(3.3, 7 - n * 0.18)}deg`);
    cardEl.style.setProperty('--fan-scale', oneCardHandUi.raised && i === selected ? '1.08' : '1');
    cardEl.style.setProperty('--fan-z', String(50 + (oneCardHandUi.raised ? 30 - absSelected : i) + (i === selected ? 100 : 0)));
    cardEl.classList.toggle('selected', i === selected);
    cardEl.classList.toggle('peek-left', oneCardHandUi.raised && fromSelected === -1);
    cardEl.classList.toggle('peek-right', oneCardHandUi.raised && fromSelected === 1);
  });
}
function startOneCardHandGesture(event, index) {
  if (!lastView || lastView.ui !== 'onecard' || !(lastView.hand || []).length) return;
  const hand = lastView.hand;
  const targetIndex = Number.isFinite(index) ? index : oneCardHandUi.selectedIndex;
  const targetCard = hand[clampOneCardIndex(targetIndex, hand)];
  const wasSelected = oneCardHandUi.raised && !!targetCard && oneCardHandUi.selectedCardId === targetCard.id;
  setOneCardSelection(hand, targetIndex, true);
  oneCardHandUi.gesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    lastT: performance.now(),
    moved: false,
    wasSelected,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
function moveOneCardHandGesture(event) {
  const gesture = oneCardHandUi.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId || !lastView) return;
  const hand = lastView.hand || [];
  const { step } = oneCardFanMetrics(hand);
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) gesture.moved = true;
  if (gesture.startIndex == null) gesture.startIndex = oneCardHandUi.selectedIndex;
  const deltaCards = Math.round(dx / Math.max(28, step * 0.72));
  const nextIndex = clampOneCardIndex(gesture.startIndex + deltaCards, hand);
  if (nextIndex !== oneCardHandUi.selectedIndex) setOneCardSelection(hand, nextIndex, true);
  gesture.lastX = event.clientX;
  gesture.lastY = event.clientY;
  gesture.lastT = performance.now();
  event.preventDefault();
}
function finishOneCardHandGesture(event) {
  const gesture = oneCardHandUi.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId || !lastView) return;
  const hand = lastView.hand || [];
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  const elapsed = Math.max(1, performance.now() - gesture.lastT);
  const vy = (event.clientY - gesture.lastY) / elapsed;
  const selected = hand[oneCardHandUi.selectedIndex];
  oneCardHandUi.gesture = null;
  oneCardHandUi.lastGesture = gesture;
  if (dy < -86 || vy < -0.75) {
    if (selected && oneCardCanPlay(lastView, selected)) {
      oneCardHandUi.raised = false;
      layoutOneCardFan(hand);
      playOneCard(selected);
    } else {
      toast('That card is not legal right now.');
      setOneCardSelection(hand, oneCardHandUi.selectedIndex, true);
    }
  } else if (dy > 64 || vy > 0.75) {
    oneCardHandUi.raised = false;
    layoutOneCardFan(hand);
  } else {
    setOneCardSelection(hand, oneCardHandUi.selectedIndex, true);
  }
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) event.preventDefault();
}
function unoSnapshot(v) {
  return {
    top: v.topCard,
    color: v.currentColor,
    direction: v.direction,
    drawCount: v.drawCount || 0,
    counts: Object.fromEntries((v.players || []).map(p => [p.slot, p.cards])),
  };
}
function unoSlotName(v, slot) {
  const p = (v.players || []).find(x => x.slot === slot);
  return p ? (p.you ? 'You' : p.name) : slot;
}
function unoActionText(v, a) {
  if (!a) return '';
  if (a.card) {
    let t = `${unoSlotName(v, a.by)} played ${a.card}.`;
    if (a.drawTarget) t += ` ${unoSlotName(v, a.drawTarget)} picked up the penalty.`;
    return t;
  }
  if (a.by) return `${unoSlotName(v, a.by)} ${a.drawn ? 'drew a card and passed.' : 'had nothing to draw and passed.'}`;
  return a.text || '';
}

function unoSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'play') {
    battleNoise(audio, t, 0.06, { freq: 1800, type: 'highpass', gain: 0.1 });
    battleTone(audio, t, 340, 0.08, { type: 'triangle', gain: 0.06 });
  } else if (kind === 'skip') {
    battleTone(audio, t, 700, 0.09, { type: 'square', gain: 0.05 });
    battleTone(audio, t + 0.09, 500, 0.12, { type: 'square', gain: 0.05 });
  } else if (kind === 'reverse') {
    battleTone(audio, t, 420, 0.1, { type: 'triangle', gain: 0.06, slideTo: 640 });
    battleTone(audio, t + 0.1, 640, 0.1, { type: 'triangle', gain: 0.06, slideTo: 420 });
  } else if (kind === 'wild') {
    [420, 530, 660].forEach((f, i) => battleTone(audio, t + i * 0.07, f, 0.12, { type: 'triangle', gain: 0.06 }));
  } else if (kind === 'penalty') {
    battleTone(audio, t, 520, 0.3, { slideTo: 150, gain: 0.09 });
    battleNoise(audio, t + 0.04, 0.2, { freq: 700, gain: 0.12 });
  } else if (kind === 'draw') {
    battleNoise(audio, t, 0.1, { freq: 900, gain: 0.08 });
  } else if (kind === 'uno') {
    battleTone(audio, t, 880, 0.1, { type: 'square', gain: 0.06 });
    battleTone(audio, t + 0.12, 880, 0.14, { type: 'square', gain: 0.07 });
  } else if (kind === 'turn') {
    battleTone(audio, t, 1000, 0.06, { type: 'square', gain: 0.04 });
  }
}

function unoCardFaceHTML(card) {
  const label = oneCardLabel(card);
  const sm = label.length > 2 ? ' class="sm"' : '';
  return `<span${sm}>${label}</span>`;
}
function unoSetDiscard(top, color) {
  const discard = $('oneCardDiscard');
  if (!discard) return;
  discard.className = `one-card-card ${oneCardColor(top, color)}`;
  discard.innerHTML = `${unoCardFaceHTML(top)}<small>${oneCardName(top)}</small>`;
}
function unoSetColorDots(color) {
  const colorDots = $('oneCardColorDots');
  if (!colorDots) return;
  colorDots.innerHTML = '';
  ['red', 'gold', 'green', 'blue'].forEach(c => {
    const dot = document.createElement('span');
    dot.className = `color-dot ${c}` + (color === c ? ' active' : '');
    colorDots.appendChild(dot);
  });
}
function unoSetDirection(direction) {
  const el = $('oneCardDirection');
  if (!el) return;
  el.textContent = direction === -1 ? '<<' : '>>';
  el.title = direction === -1 ? 'Play order reversed' : 'Normal play order';
}
function unoChipEl(slot) { return document.getElementById(`uno-opp-${slot}`); }
function unoSetOppCount(slot, count) {
  const chip = unoChipEl(slot);
  if (!chip) return;
  const ct = chip.querySelector('.ct');
  if (ct) {
    ct.textContent = count === 1 ? 'UNO!' : count;
    ct.classList.remove('tick');
    void ct.offsetWidth;
    ct.classList.add('tick');
  }
  chip.classList.toggle('uno', count === 1);
}

// Diffed hand render: only rebuild the fan when the cards themselves change,
// so polling never destroys an in-progress swipe gesture.
function renderOneCardHand(v) {
  const handEl = $('oneCardHand');
  if (!handEl) return;
  const cards = v.hand || [];
  handEl.classList.toggle('empty', !cards.length);
  const sig = cards.map(c => c.id).join(',');
  if (sig !== unoHandSig) {
    unoHandSig = sig;
    handEl.innerHTML = '';
    cards.forEach((card, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.cardId = card.id;
      const label = oneCardLabel(card);
      const colorName = card.color === 'wild' ? 'Wild' : card.color;
      btn.innerHTML = `<b class="corner top">${label}</b>${unoCardFaceHTML(card)}<small>${colorName}</small><b class="corner bottom">${label}</b>`;
      btn.onclick = () => {
        const g = oneCardHandUi.lastGesture;
        oneCardHandUi.lastGesture = null;
        if (g && g.moved) return;
        if (!lastView) return;
        const cur = (lastView.hand || []).find(c => c.id === card.id);
        if (!cur) return;
        // First tap raises the card; tapping the raised card plays it.
        // Keyboard activation (no pointer gesture) plays directly.
        if (!g || g.wasSelected) playOneCard(cur);
      };
      btn.onpointerdown = event => startOneCardHandGesture(event, index);
      btn.onpointermove = moveOneCardHandGesture;
      btn.onpointerup = finishOneCardHandGesture;
      btn.onpointercancel = finishOneCardHandGesture;
      handEl.appendChild(btn);
    });
  }
  handEl.querySelectorAll('button').forEach((btn, i) => {
    const card = cards[i];
    if (!card) return;
    const canPlay = oneCardCanPlay(v, card);
    btn.className = `one-card-card ${oneCardColor(card)}` + (canPlay ? ' playable' : '');
    btn.setAttribute('aria-disabled', canPlay ? 'false' : 'true');
    btn.setAttribute('aria-label', `${oneCardName(card)}${canPlay ? ', playable' : ', not playable'}`);
  });
  layoutOneCardFan(cards);
}

function unoBanner(d, v) {
  const banner = $('oneCardStatus');
  if (!banner) return;
  const players = v.players || [];
  if (v.phase === 'lobby') {
    banner.className = 'status them';
    banner.textContent = v.canStart ? 'READY -- start now or wait for more players' : `Share the code -- UNO starts with ${v.minPlayers}+ players`;
  } else if (v.phase === 'over') {
    const won = v.winner === session.you;
    const winner = players.find(p => p.slot === v.winner);
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY -- hand cleared!' : `${winner ? winner.name : 'A rival'} emptied their hand`;
    if (!unoOverFxDone) {
      unoOverFxDone = true;
      battleSfx(won ? 'win' : 'lose');
      battleVibrate(won ? [40, 60, 40, 60, 120] : [200]);
    }
  } else if (v.turn === session.you) {
    banner.className = 'status you';
    banner.textContent = (v.legalCardIds || []).length ? 'YOUR PLAY -- match color, number, or symbol' : 'NO LEGAL CARDS -- draw one';
  } else {
    const current = players.find(p => p.slot === v.turn);
    banner.className = 'status them';
    banner.textContent = `${current ? current.name : 'A rival'} is choosing a card...`;
  }
}

function renderOneCardStatic(d, v, hold) {
  const snap = hold && unoPrevView ? unoPrevView : unoSnapshot(v);
  const players = v.players || [];
  const myTurn = v.phase === 'battle' && v.turn === session.you;

  const opponents = $('oneCardOpponents');
  opponents.innerHTML = '';
  players.filter(p => !p.you).forEach(p => {
    const cards = snap.counts[p.slot] != null ? snap.counts[p.slot] : p.cards;
    const tile = document.createElement('div');
    tile.id = `uno-opp-${p.slot}`;
    tile.className = 'uno-opp'
      + (!hold && v.phase === 'battle' && v.turn === p.slot ? ' active' : '')
      + (!hold && v.phase === 'over' && v.winner === p.slot ? ' active' : '')
      + (cards === 1 ? ' uno' : '');
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = p.name;
    const count = document.createElement('strong');
    count.className = 'ct';
    count.textContent = cards === 1 ? 'UNO!' : cards;
    tile.append(name, count);
    opponents.appendChild(tile);
  });

  const lobby = v.phase === 'lobby';
  $('oneCardCodeWrap').classList.toggle('hidden', !lobby);
  $('unoCenter').classList.toggle('hidden', lobby);
  $('oneCardLast').classList.toggle('hidden', lobby);
  $('oneCardHand').classList.toggle('hidden', lobby);
  $('oneCardCode').textContent = session.room;
  $('oneCardStart').classList.toggle('hidden', !lobby || !v.canStart);

  $('oneCardDeckCount').textContent = snap.drawCount;
  $('oneCardDeck').disabled = !(myTurn && !hold);
  unoSetDiscard(snap.top, snap.color);
  unoSetColorDots(snap.color);
  unoSetDirection(snap.direction);

  const drawBtn = $('oneCardDraw');
  drawBtn.disabled = !(myTurn && !hold);
  drawBtn.textContent = v.phase !== 'battle' ? 'DRAW'
    : !myTurn ? 'STANDBY'
    : (v.legalCardIds || []).length ? 'DRAW + PASS' : 'DRAW A CARD';

  renderOneCardHand(v);

  if (!hold) {
    unoBanner(d, v);
    $('oneCardLast').textContent = v.lastAction ? unoActionText(v, v.lastAction) : 'First to empty their hand wins.';
    if (myTurn && !unoWasMyTurn) { unoSfx('turn'); battleVibrate(12); }
    unoWasMyTurn = myTurn;
  }
}

// Card flying across the table (plays into the discard, draws off the deck).
function unoFly(fromEl, toEl, cls, html) {
  const sect = $('oneCard');
  if (!sect || !fromEl || !toEl) return;
  const sr = sect.getBoundingClientRect();
  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `uno-fly one-card-card ${cls}`;
  el.innerHTML = html || '';
  el.style.left = `${fr.left - sr.left + fr.width / 2}px`;
  el.style.top = `${fr.top - sr.top + fr.height / 2}px`;
  sect.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.left = `${tr.left - sr.left + tr.width / 2}px`;
    el.style.top = `${tr.top - sr.top + tr.height / 2}px`;
  }));
  setTimeout(() => el.remove(), 460);
}
function unoFlySource(by) {
  return by === session.you ? $('oneCardHand') : (unoChipEl(by) || $('oneCardDeck'));
}

// Replays every logged play/draw since the last poll (solo bots resolve
// several turns inside one poll; this shows them one by one).
function unoAnimateEntries(d, v, entries) {
  unoAnimating = true;
  const banner = $('oneCardStatus');
  const cur = unoPrevView
    ? { ...unoPrevView, counts: { ...unoPrevView.counts } }
    : unoSnapshot(v);

  const frames = [];
  for (const e of entries) {
    if (e.action === 'play' && e.card) {
      frames.push({ type: 'play', e });
      if (e.drawTarget && e.drawn) frames.push({ type: 'penalty', target: e.drawTarget, count: e.drawn });
    } else if (e.action === 'draw') {
      frames.push({ type: 'draw', target: e.by, count: e.count || 0 });
    }
  }

  let idx = 0;
  function run() {
    if (!unoAnimating) return; // cancelled by reset/leave
    const f = frames[idx++];
    if (!f) { finish(); return; }
    let delay = 460;
    if (f.type === 'play') {
      const e = f.e;
      const card = e.card;
      const mine = e.by === session.you;
      unoFly(unoFlySource(e.by), $('oneCardDiscard'), oneCardColor(card, e.color), unoCardFaceHTML(card));
      if (banner) {
        banner.className = 'status ' + (mine ? 'you' : 'them');
        banner.textContent = `${unoSlotName(v, e.by).toUpperCase()} PLAYS ${oneCardName(card).toUpperCase()}`;
      }
      setTimeout(() => {
        cur.top = card;
        cur.color = e.color;
        cur.direction = e.direction;
        unoSetDiscard(card, e.color);
        unoSetColorDots(e.color);
        unoSetDirection(e.direction);
        if (!mine) {
          cur.counts[e.by] = e.handLeft;
          unoSetOppCount(e.by, e.handLeft);
        }
        const kind = card.kind;
        unoSfx(kind === 'skip' ? 'skip'
          : kind === 'reverse' ? 'reverse'
          : (kind === 'wild' || kind === 'wild4') ? 'wild'
          : 'play');
        if (e.handLeft === 1) unoSfx('uno');
      }, 320);
      delay = 580;
    } else if (f.type === 'penalty') {
      unoSfx('penalty');
      if (f.target === session.you) battleVibrate([20, 40, 20]);
      const toEl = f.target === session.you ? $('oneCardHand') : unoChipEl(f.target);
      const flights = Math.min(f.count, 4);
      for (let k = 0; k < flights; k++) {
        setTimeout(() => unoFly($('oneCardDeck'), toEl, 'uno-back', '<span>+1</span>'), k * 110);
      }
      cur.drawCount = Math.max(0, cur.drawCount - f.count);
      setTimeout(() => {
        $('oneCardDeckCount').textContent = cur.drawCount;
        if (f.target !== session.you) {
          cur.counts[f.target] = (cur.counts[f.target] || 0) + f.count;
          unoSetOppCount(f.target, cur.counts[f.target]);
        }
      }, flights * 110 + 260);
      delay = flights * 110 + 500;
    } else if (f.type === 'draw') {
      unoSfx('draw');
      const toEl = f.target === session.you ? $('oneCardHand') : unoChipEl(f.target);
      if (f.count > 0) unoFly($('oneCardDeck'), toEl, 'uno-back', '');
      cur.drawCount = Math.max(0, cur.drawCount - f.count);
      setTimeout(() => {
        $('oneCardDeckCount').textContent = cur.drawCount;
        if (f.target !== session.you && f.count > 0) {
          cur.counts[f.target] = (cur.counts[f.target] || 0) + f.count;
          unoSetOppCount(f.target, cur.counts[f.target]);
        }
      }, 300);
      delay = 470;
    }
    setTimeout(run, delay);
  }

  function finish() {
    if (!unoAnimating) return; // cancelled by reset/leave
    unoAnimating = false;
    unoLastMoveNumber = entries[entries.length - 1].n;
    unoPrevView = cur;
    if (lastView && lastView.ui === 'onecard') renderOneCard(unoLastData, lastView);
  }

  run();
}

function renderOneCard(d, v) {
  unoLastData = d;
  if (unoAnimating) return;
  const entries = unoPrevView && v.phase !== 'lobby'
    ? (v.moveLog || []).filter(e => e.n > unoLastMoveNumber)
    : [];
  if (entries.length) {
    renderOneCardStatic(d, v, true);
    unoAnimateEntries(d, v, entries);
    return;
  }
  renderOneCardStatic(d, v, false);
  unoPrevView = unoSnapshot(v);
  unoLastMoveNumber = v.moveNumber || 0;
}

async function startOneCard() {
  try {
    await api('/api/move', 'POST', { room: session.room, move: { action: 'start' } });
    poll();
  } catch (e) { toast(e.message); }
}
function playOneCard(card) {
  if (unoAnimating) return;
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  mncEnsureAudio();
  if (card.color === 'wild') {
    unoPendingWild = card;
    $('unoColorPick').classList.remove('hidden');
    return;
  }
  sendOneCardPlay({ action: 'play', cardId: card.id });
}
function pickWildColor(color) {
  const card = unoPendingWild;
  unoPendingWild = null;
  $('unoColorPick').classList.add('hidden');
  if (!card) return;
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  sendOneCardPlay({ action: 'play', cardId: card.id, color });
}
function cancelWildColor() {
  unoPendingWild = null;
  $('unoColorPick').classList.add('hidden');
}
async function sendOneCardPlay(move) {
  try {
    battleVibrate(10);
    await api('/api/move', 'POST', { room: session.room, move });
    poll();
  } catch (e) { toast(e.message); }
}
async function drawOneCard() {
  if (unoAnimating) return;
  if (!lastView || lastView.ui !== 'onecard' || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  try {
    mncEnsureAudio();
    battleVibrate(10);
    await api('/api/move', 'POST', { room: session.room, move: { action: 'draw' } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- Mancala ----------------
let mncAnimating = false;
let mncLastPits = null;
let mncLastMoveNumber = 0;
let mncBoardSig = '';
let mncOverFxDone = false;
let mncLastData = null;
let mncAudioContext = null;

function mncEnsureAudio() {
  if (!mncAudioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    mncAudioContext = new AudioContext();
  }
  if (mncAudioContext.state === 'suspended') mncAudioContext.resume().catch(() => {});
  return mncAudioContext;
}

function mncSfx(kind, i = 0) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'pickup') {
    battleNoise(audio, t, 0.08, { freq: 700, gain: 0.09 });
    battleTone(audio, t, 190, 0.1, { type: 'triangle', gain: 0.05 });
  } else if (kind === 'sow') {
    battleTone(audio, t, 420 + (i % 7) * 26, 0.06, { type: 'triangle', gain: 0.05 });
    battleNoise(audio, t, 0.03, { freq: 2400, type: 'highpass', gain: 0.05 });
  } else if (kind === 'store') {
    battleTone(audio, t, 310, 0.16, { type: 'triangle', gain: 0.08, slideTo: 230 });
    battleNoise(audio, t, 0.06, { freq: 900, gain: 0.06 });
  } else if (kind === 'capture') {
    battleTone(audio, t, 540, 0.28, { slideTo: 130, gain: 0.09 });
    battleNoise(audio, t + 0.05, 0.24, { freq: 750, gain: 0.14 });
  } else if (kind === 'bonus') {
    battleTone(audio, t, 620, 0.12, { type: 'triangle', gain: 0.08 });
    battleTone(audio, t + 0.11, 830, 0.18, { type: 'triangle', gain: 0.08 });
  } else if (kind === 'sweep') {
    battleTone(audio, t, 360 + (i % 8) * 32, 0.07, { type: 'triangle', gain: 0.045 });
  }
}

// Deterministic pseudo-random scatter so seed piles look organic but never
// jump around between rerenders.
function mncRand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function mncSeedStyle(pitIdx, k) {
  const slot = k % 24;
  const angle = slot * 2.39996 + mncRand(pitIdx * 31 + 7) * 6.283;
  const rad = Math.sqrt(slot + 0.6) / Math.sqrt(24.6) * 40;
  const x = 50 + Math.cos(angle) * rad;
  const y = 50 + Math.sin(angle) * rad;
  const rot = Math.floor(mncRand(pitIdx * 97 + k * 13) * 360);
  const sc = (0.82 + mncRand(pitIdx * 53 + k * 29) * 0.36).toFixed(2);
  return `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${rot}deg) scale(${sc})`;
}

const MNC_PIT_SEED_CAP = 18;
const MNC_STORE_SEED_CAP = 30;

function mncSeedsHTML(pitIdx, count, side, cap) {
  const n = Math.min(count, cap);
  let html = '';
  for (let k = 0; k < n; k++) {
    html += `<span class="mnc-sd ${side} v${k % 3}" style="${mncSeedStyle(pitIdx, k)}"></span>`;
  }
  return html;
}

function buildMancalaBoard(v, pits) {
  const winStore = v.phase === 'over' && v.winner && v.winner !== 'draw'
    ? (v.winner === v.myPiece ? v.myStoreIndex : v.oppStoreIndex) : -1;
  const store = (pitIdx, side, area) =>
    `<div class="mnc-store ${side} area-${area}${pitIdx === winStore ? ' winner' : ''}" id="mnc-p${pitIdx}" data-pit="${pitIdx}">
      ${mncSeedsHTML(pitIdx, pits[pitIdx], side, MNC_STORE_SEED_CAP)}
      <div class="mnc-scount">${pits[pitIdx]}</div>
      <div class="mnc-slabel">${side === 'mine' ? 'You' : 'Opp'}</div>
    </div>`;
  const pit = (pitIdx, side, area) => {
    const count = pits[pitIdx];
    const valid = side === 'mine' && !mncAnimating && v.isMyTurn && v.validMoves.includes(pitIdx);
    const cls = `mnc-pit ${side} area-${area}${count === 0 ? ' empty' : ''}${valid ? ' valid' : ''}`;
    return `<div class="${cls}" id="mnc-p${pitIdx}" data-pit="${pitIdx}" ${valid ? `onclick="moveMancala(${pitIdx})"` : ''}>
      ${mncSeedsHTML(pitIdx, count, side, MNC_PIT_SEED_CAP)}
      ${count > 0 ? `<span class="mnc-chip">${count}</span>` : ''}
    </div>`;
  };
  let html = store(v.oppStoreIndex, 'opp', 'os') + store(v.myStoreIndex, 'mine', 'ms');
  v.myPitIndices.forEach((p, i) => { html += pit(p, 'mine', 'm' + i); });
  v.oppPitIndices.forEach((p, i) => { html += pit(p, 'opp', 'od' + i); });
  return html;
}

// Reconcile a pit's DOM (seeds, chip/count, empty state) to a target count.
function mncSetPit(pitIdx, count, opts = {}) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  const isStore = el.classList.contains('mnc-store');
  const side = el.classList.contains('mine') ? 'mine' : 'opp';
  const cap = isStore ? MNC_STORE_SEED_CAP : MNC_PIT_SEED_CAP;
  const seeds = el.querySelectorAll('.mnc-sd');
  const want = Math.min(count, cap);
  for (let k = seeds.length - 1; k >= want; k--) seeds[k].remove();
  for (let k = seeds.length; k < want; k++) {
    const s = document.createElement('span');
    s.className = `mnc-sd ${side} v${k % 3}${opts.drop ? ' drop-in' : ''}`;
    s.style.cssText = mncSeedStyle(pitIdx, k);
    el.appendChild(s);
  }
  if (isStore) {
    const countEl = el.querySelector('.mnc-scount');
    if (countEl) countEl.textContent = count;
  } else {
    el.classList.toggle('empty', count === 0);
    let chip = el.querySelector('.mnc-chip');
    if (count === 0) {
      if (chip) chip.remove();
    } else {
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'mnc-chip';
        el.appendChild(chip);
      }
      chip.textContent = count;
      if (opts.drop) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
  }
}

function mncPitFx(pitIdx, cls, ms) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// ---- the sowing hand
function mncHandPlace(hand, pitIdx) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  hand.style.left = `${el.offsetLeft + el.offsetWidth / 2}px`;
  hand.style.top = `${el.offsetTop + el.offsetHeight / 2}px`;
}
function mncHandShow(side, pitIdx, count) {
  const board = $('mncBoard');
  if (!board) return;
  let hand = $('mncHand');
  if (!hand) {
    hand = document.createElement('div');
    hand.id = 'mncHand';
    board.appendChild(hand);
  }
  hand.className = `mnc-hand ${side}`;
  hand.style.transition = 'none';
  mncHandPlace(hand, pitIdx);
  hand.style.opacity = '0';
  void hand.offsetWidth;
  hand.style.transition = '';
  hand.style.opacity = '1';
  hand.textContent = count;
}
function mncHandTo(pitIdx, remaining) {
  const hand = $('mncHand');
  if (!hand) return;
  mncHandPlace(hand, pitIdx);
  hand.textContent = remaining > 0 ? remaining : '';
}
function mncHandHide() {
  const hand = $('mncHand');
  if (hand) hand.style.opacity = '0';
}

// Seed in flight from one pit to another (captures + endgame sweep).
function mncFly(fromPit, toPit, side) {
  const board = $('mncBoard');
  const from = document.getElementById(`mnc-p${fromPit}`);
  const to = document.getElementById(`mnc-p${toPit}`);
  if (!board || !from || !to) return;
  const seed = document.createElement('span');
  seed.className = `mnc-floater ${side}`;
  const sx = from.offsetLeft + from.offsetWidth / 2;
  const sy = from.offsetTop + from.offsetHeight / 2;
  const ex = to.offsetLeft + to.offsetWidth / 2 + (Math.random() * 20 - 10);
  const ey = to.offsetTop + to.offsetHeight / 2 + (Math.random() * 14 - 7);
  seed.style.setProperty('--dx', `${ex - sx}px`);
  seed.style.setProperty('--dy', `${ey - sy}px`);
  board.appendChild(seed);
  seed.style.left = `${sx - seed.offsetWidth / 2}px`;
  seed.style.top = `${sy - seed.offsetHeight / 2}px`;
  setTimeout(() => seed.remove(), 500);
}

function mncBanner(v, d) {
  const banner = $('mncStatus');
  if (!banner) return;
  const myScore = v.pits[v.myStoreIndex];
  const oppScore = v.pits[v.oppStoreIndex];
  if (v.phase === 'over') {
    const tied = v.winner === 'draw';
    const won = v.winner === v.myPiece;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied
      ? `DRAW -- ${myScore} to ${oppScore}`
      : won
        ? `VICTORY -- you banked ${myScore} seeds`
        : `DEFEAT -- opponent banked ${oppScore} seeds`;
    if (!mncOverFxDone) {
      mncOverFxDone = true;
      battleSfx(won ? 'win' : 'lose');
      battleVibrate(won ? [40, 60, 40, 60, 120] : [200]);
    }
  } else if (v.isMyTurn) {
    banner.className = 'status you';
    banner.textContent = 'YOUR SOW -- pick one of your pits';
  } else {
    banner.className = 'status them';
    banner.textContent = `OPPONENT TURN -- ${(d && d.opponentName) || 'opponent'} is sowing...`;
  }
}

// Replays every logged move since the last poll as one continuous timeline:
// hand picks up, walks the pits dropping seeds, captures raid the store,
// and the endgame sweep flies leftovers home.
function mncAnimateMoves(v, entries, basePits) {
  mncAnimating = true;
  const board = $('mncBoard');
  if (board) board.classList.remove('my-turn');
  const banner = $('mncStatus');
  const running = basePits.slice();
  const frames = [];
  let dropCount = 0;

  for (const e of entries) {
    const mover = e.by === v.myPiece ? 'mine' : 'opp';
    const store = e.by === v.myPiece ? v.myStoreIndex : v.oppStoreIndex;
    frames.push({ type: 'pickup', pit: e.pickup, mover, count: e.seq.length });
    running[e.pickup] = 0;
    e.seq.forEach((pitIdx, j) => {
      running[pitIdx]++;
      dropCount++;
      frames.push({
        type: 'drop', pit: pitIdx, count: running[pitIdx],
        left: e.seq.length - j - 1, isStore: pitIdx === 6 || pitIdx === 13,
      });
    });
    frames.push({ type: 'hand-hide' });
    if (e.capture > 0 && e.captureFrom >= 0) {
      const last = e.seq[e.seq.length - 1];
      frames.push({ type: 'capture', from: e.captureFrom, last, store, gained: e.capture, mover });
      running[store] += e.capture;
      running[e.captureFrom] = 0;
      running[last] = 0;
      frames.push({ type: 'settle', pits: [[e.captureFrom, 0], [last, 0], [store, running[store]]] });
    }
    if (e.extraTurn) frames.push({ type: 'bonus', store, mover });
  }

  if (v.phase === 'over') {
    for (let i = 0; i < 14; i++) {
      if (i === 6 || i === 13) continue;
      if (running[i] !== v.pits[i] && running[i] > 0) {
        const store = i <= 5 ? 6 : 13;
        frames.push({ type: 'sweep', pit: i, store, n: running[i] });
        running[store] += running[i];
        running[i] = 0;
        frames.push({ type: 'settle', pits: [[i, 0], [store, running[store]]] });
      }
    }
  }

  const STEP = Math.max(130, Math.min(230, 2800 / Math.max(1, dropCount)));

  let idx = 0;
  function run() {
    if (!mncAnimating) return; // cancelled by reset/leave
    const f = frames[idx++];
    if (!f) { finish(); return; }
    let delay = STEP;
    if (f.type === 'pickup') {
      mncHandShow(f.mover, f.pit, f.count);
      mncSetPit(f.pit, 0);
      mncPitFx(f.pit, 'pickup-anim', 320);
      mncSfx('pickup');
      if (banner) {
        banner.className = 'status ' + (f.mover === 'mine' ? 'you' : 'them');
        banner.textContent = f.mover === 'mine' ? 'SOWING...' : 'OPPONENT SOWS...';
      }
      delay = 300;
    } else if (f.type === 'drop') {
      mncHandTo(f.pit, f.left);
      const dropIdx = idx;
      setTimeout(() => {
        mncSetPit(f.pit, f.count, { drop: true });
        mncPitFx(f.pit, 'land', 280);
        mncSfx(f.isStore ? 'store' : 'sow', dropIdx);
      }, STEP * 0.55);
    } else if (f.type === 'hand-hide') {
      mncHandHide();
      delay = 140;
    } else if (f.type === 'capture') {
      mncSfx('capture');
      battleVibrate([12, 40, 18]);
      mncPitFx(f.from, 'raided', 600);
      mncPitFx(f.last, 'raided', 600);
      const flights = Math.min(f.gained, 10);
      for (let k = 0; k < flights; k++) {
        setTimeout(() => mncFly(k % 3 === 2 ? f.last : f.from, f.store, f.mover), k * 45);
      }
      const storeEl = document.getElementById(`mnc-p${f.store}`);
      if (storeEl) { storeEl.classList.remove('capture-anim'); void storeEl.offsetWidth; storeEl.classList.add('capture-anim'); }
      if (banner) {
        banner.className = 'status ' + (f.mover === 'mine' ? 'win' : 'lose');
        banner.textContent = (f.mover === 'mine' ? 'YOU SNATCH ' : 'OPPONENT SNATCHES ') + f.gained + ' SEEDS!';
      }
      delay = 620;
    } else if (f.type === 'settle') {
      f.pits.forEach(([p, c]) => mncSetPit(p, c, { drop: true }));
      delay = 220;
    } else if (f.type === 'bonus') {
      mncSfx('bonus');
      battleVibrate(30);
      const storeEl = document.getElementById(`mnc-p${f.store}`);
      if (storeEl) { storeEl.classList.remove('extraturn-anim'); void storeEl.offsetWidth; storeEl.classList.add('extraturn-anim'); }
      if (banner && v.phase === 'battle') {
        banner.className = 'status ' + (f.mover === 'mine' ? 'win' : 'them');
        banner.textContent = f.mover === 'mine' ? 'BONUS SOW -- GO AGAIN!' : 'OPPONENT SOWS AGAIN...';
      }
      delay = 600;
    } else if (f.type === 'sweep') {
      const side = f.store === v.myStoreIndex ? 'mine' : 'opp';
      const flights = Math.min(f.n, 6);
      for (let k = 0; k < flights; k++) setTimeout(() => mncFly(f.pit, f.store, side), k * 40);
      mncSetPit(f.pit, 0);
      mncSfx('sweep', idx);
      delay = 170;
    }
    setTimeout(run, delay);
  }

  function finish() {
    if (!mncAnimating) return; // cancelled by reset/leave
    mncAnimating = false;
    mncLastPits = v.pits.slice();
    mncLastMoveNumber = entries[entries.length - 1].n;
    mncBoardSig = '';
    if (lastView && lastView.ui === 'mancala') renderMancala(mncLastData, lastView);
  }

  run();
}

function mncSig(v) {
  return v.pits.join(',') + '|' + v.phase + '|' + v.isMyTurn + '|' + (v.validMoves || []).join('.');
}

function renderMancala(d, v) {
  const board = $('mncBoard');
  if (!board) return;
  mncLastData = d;

  if (!board.children.length || !mncLastPits) {
    board.innerHTML = buildMancalaBoard(v, v.pits);
    mncLastPits = v.pits.slice();
    mncLastMoveNumber = v.moveNumber || 0;
    mncBoardSig = mncSig(v);
  } else if (!mncAnimating) {
    const entries = (v.moveLog || []).filter(e => e.n > mncLastMoveNumber);
    if (entries.length) {
      mncAnimateMoves(v, entries, mncLastPits);
    } else {
      const sig = mncSig(v);
      if (sig !== mncBoardSig) {
        board.innerHTML = buildMancalaBoard(v, v.pits);
        mncBoardSig = sig;
      }
      mncLastPits = v.pits.slice();
      mncLastMoveNumber = v.moveNumber || 0;
    }
  }

  board.classList.toggle('my-turn', !mncAnimating && v.isMyTurn && v.phase === 'battle');
  if (!mncAnimating) mncBanner(v, d);
}

async function moveMancala(pitIdx) {
  if (mncAnimating) return;
  if (!lastView || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  if (!lastView.validMoves.includes(pitIdx)) { toast('That pit is empty.'); return; }

  try {
    mncEnsureAudio();
    battleVibrate(10);
    await api('/api/move', 'POST', { room: session.room, move: { pit: pitIdx } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- Ultimate TTT ----------------
let utttUi = { lastMove: null, seen: false };

function utttSfx(mine) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  battleTone(audio, t, mine ? 640 : 420, 0.07, { type: 'triangle', gain: 0.05 });
  battleTone(audio, t + 0.05, mine ? 860 : 560, 0.06, { type: 'triangle', gain: 0.04 });
}

function renderUltimateTTT(d, v) {
  const EMPTY = 0, X = 1, O = 2, DRAW = 3;
  const board = $('utttBoard');
  const validSet = new Set(v.validMoves || []);
  const newMove = utttUi.seen && v.lastMove !== null && v.lastMove !== utttUi.lastMove;

  board.innerHTML = '';
  for (let mini = 0; mini < 9; mini++) {
    const miniWinner = v.miniWinners[mini];
    const baseRow = Math.floor(mini / 3) * 3;
    const baseCol = (mini % 3) * 3;

    const isFreeChoice = v.isMyTurn && v.activeMini === -1;
    const isActive = v.isMyTurn && (isFreeChoice ? miniWinner === EMPTY : v.activeMini === mini);

    const miniEl = document.createElement('div');
    miniEl.className = 'uttt-mini'
      + (miniWinner === X ? ' won-X' : miniWinner === O ? ' won-O' : miniWinner === DRAW ? ' won-draw' : '')
      + (isActive && !isFreeChoice ? ' active' : '')
      + (isActive && isFreeChoice && miniWinner === EMPTY ? ' free' : '');

    for (let lr = 0; lr < 3; lr++) {
      for (let lc = 0; lc < 3; lc++) {
        const idx = (baseRow + lr) * 9 + (baseCol + lc);
        const val = v.board[idx];
        const isValid = validSet.has(idx);
        const isLast = v.lastMove === idx;

        const cell = document.createElement('div');
        cell.className = 'uttt-cell'
          + (val === X ? ' X' : val === O ? ' O' : '')
          + (isValid ? ' valid' : '')
          + (isLast ? ' last' : '')
          + (isLast && newMove ? ' pop' : '');
        if (val === X) cell.textContent = 'X';
        else if (val === O) cell.textContent = 'O';
        if (isValid) cell.onclick = () => moveUltimateTTT(idx);
        miniEl.appendChild(cell);
      }
    }

    if (miniWinner !== EMPTY) {
      const ov = document.createElement('div');
      ov.className = 'uttt-mini-winner';
      ov.textContent = miniWinner === X ? 'X' : miniWinner === O ? 'O' : '-';
      miniEl.appendChild(ov);
    }

    board.appendChild(miniEl);
  }

  if (newMove) {
    const mineJustPlayed = v.board[v.lastMove] === (v.myPiece === 'X' ? X : O);
    utttSfx(mineJustPlayed);
    battleVibrate(mineJustPlayed ? 8 : 14);
  }
  utttUi = { lastMove: v.lastMove, seen: true };

  const banner = $('utttStatus');
  if (v.phase === 'over') {
    const tied = v.winner === 'draw';
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - all boards claimed' : won ? 'VICTORY - three boards in a row' : 'DEFEAT - opponent claimed three boards in a row';
  } else if (v.isMyTurn) {
    const where = v.activeMini === -1 ? 'any open board' : `board ${v.activeMini + 1}`;
    banner.className = 'status you';
    banner.textContent = `YOUR MOVE - play in ${where}`;
  } else {
    banner.className = 'status them';
    banner.textContent = `OPPONENT TURN - ${d.opponentName || 'opponent'} is thinking...`;
  }

  const legend = $('utttLegend');
  if (legend) {
    const youPiece = v.myPiece;
    const oppPiece = youPiece === 'X' ? 'O' : 'X';
    legend.innerHTML = `<span><span class="uttt-piece ${youPiece}">${youPiece}</span>You</span>`
      + `<span>Opponent<span class="uttt-piece ${oppPiece}" style="margin-left:4px">${oppPiece}</span></span>`;
  }
}

async function moveUltimateTTT(idx) {
  if (!lastView || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  try {
    await api('/api/move', 'POST', { room: session.room, move: { idx } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- boot ----------------
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
document.addEventListener('pointerdown', mncEnsureAudio, { once: true });
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('gameSelect').addEventListener('change', () => applyDeviceClasses('home'));
window.addEventListener('resize', () => {
  applyDeviceClasses(document.querySelector('section:not(.hidden)')?.id || 'home');
  if (lastView && lastView.ui === 'onecard') layoutOneCardFan(lastView.hand || []);
  if (document.body.classList.contains('battle-mode')) updateAimUi();
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
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropConnectDisc(connectUi.focusedCol); return; }
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 7 && lastView && lastView.ui === 'connectfour') { e.preventDefault(); dropConnectDisc(n - 1); }
  if (e.key.toLowerCase() === 'd' && lastView && lastView.ui === 'onecard') drawOneCard();
});

populateGameSelect();
const params = launchParams();
applyLaunchGame(params.game);
session = loadSession();
// The home screen is always the landing page. A saved session becomes a
// Resume card there instead of auto-teleporting into the old game; only an
// explicit ?mode=computer&game=x launch link jumps straight into play.
const launchGame = params.mode === 'computer' && params.game && gameMeta(params.game) ? params.game : null;
if (session && launchGame && !(session.mode === 'computer' && session.game === launchGame)) {
  clearSession();
}
if (session && launchGame) {
  show(sectionForGame(session.game));
  enterRoom();
  clearLaunchParams();
} else if (!session && params.mode === 'computer') {
  show('home');
  createComputerGame().finally(clearLaunchParams);
} else {
  show('home');
  clearLaunchParams();
}
