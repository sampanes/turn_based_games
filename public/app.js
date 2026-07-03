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
let placementDrag = null;
let ignoreNextPlacementClick = false;
let oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null };

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
  ['home','lobby','placement','battle','connectFour','oneCard','mancala','ultimateTTT'].forEach(section => {
    const el = $(section);
    if (el) el.classList.toggle('hidden', section !== id);
  });
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
  if ($('mncBoard')) { $('mncBoard').innerHTML = ''; mncLastPits = null; mncLastMoveTag = null; mncAnimating = false; }
  if ($('utttBoard')) $('utttBoard').innerHTML = '';
  $('oneCardOpponents').innerHTML = '';
  resetOneCardHandUi();
  $('oneCardHand').innerHTML = '';
  lastBattleEventKey = null;
  lastBattleTurn = null;
  battleAimAnimation = null;
  const aim = $('battleAim');
  if (aim) aim.remove();
}

// ---------------- placement ----------------
function resetPlacement() {
  placedShips = [];
  selectedShip = null;
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
  if (existing) { rotatePlacedShip(existing); return; }
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
  if (ship) { rotatePlacedShip(ship); return; }
  placeAt(r, c);
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
    cell.title = ship ? `${ship.name} - tap or drag to move` : '';
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
    rotatePlacedShip(drag.original);
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
    if (fireable) cell.onclick = () => fire(r, c);
    el.appendChild(cell);
  }
}

function renderBattle(d, v) {
  buildGrid($('fireGrid'), true);
  buildGrid($('myGrid'), false);

  const shot = v.lastShot;
  const shotKey = shot ? `${shot.by}:${shot.r},${shot.c}:${shot.result}:${shot.sunk || ''}` : null;
  const newShot = !!shotKey && shotKey !== lastBattleEventKey;
  const turnChanged = v.turn !== lastBattleTurn;
  const yourTurn = v.phase === 'battle' && v.turn === d.you;
  const incomingNewShot = newShot && shot && shot.by !== d.you;
  if (incomingNewShot && !battleAimAnimation) startBattleAimAnimation(shot, d);
  const concealIncoming = battleAimAnimation && battleAimAnimation.key === shotKey;
  $('battle').classList.toggle('your-turn', yourTurn);
  $('fireGrid').classList.toggle('ready-to-fire', yourTurn);

  // firing grid = my shots on enemy
  document.querySelectorAll('#fireGrid .cell').forEach(cell => {
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const val = v.firingBoard[r][c];
    let cls = 'cell' + (val === 'hit' ? ' hit scored-hit' : val === 'miss' ? ' miss' : '');
    if (shot && shot.by === d.you && shot.r === r && shot.c === c) cls += ' last-shot outgoing-shot';
    cell.className = cls;
    cell.setAttribute('aria-label', val ? `Your ${val} at ${coordLabel(r, c)}` : `Fire at ${coordLabel(r, c)}`);
  });
  // my fleet grid, with enemy shots shown
  document.querySelectorAll('#myGrid .cell').forEach(cell => {
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const rawSq = v.myBoard[r][c];
    const hideShot = concealIncoming && shot && shot.r === r && shot.c === c;
    const sq = hideShot ? { ...rawSq, shot: null } : rawSq;
    let cls = 'cell';
    if (sq.shot === 'hit') cls += ' hit incoming-hit';
    else if (sq.shot === 'miss') cls += ' miss';
    else if (sq.ship) cls += ' ship';
    if (!hideShot && shot && shot.by !== d.you && shot.r === r && shot.c === c) cls += ' last-shot incoming-shot';
    cell.className = cls;
    const shipText = sq.ship ? 'ship' : 'water';
    cell.setAttribute('aria-label', sq.shot ? `Opponent ${sq.shot} on your ${shipText} at ${coordLabel(r, c)}` : `Your ${shipText} at ${coordLabel(r, c)}`);
  });

  $('enemyLeft').textContent = `${v.enemyShipsLeft} ship${v.enemyShipsLeft === 1 ? '' : 's'} afloat`;
  $('myLeft').textContent = `${v.myShipsLeft} ship${v.myShipsLeft === 1 ? '' : 's'} afloat`;

  const banner = $('statusBanner');
  if (v.phase === 'over') {
    const won = v.winner === d.you;
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY - enemy fleet destroyed' : 'DEFEAT - your fleet is sunk';
  } else if (yourTurn) {
    banner.className = 'status you';
    banner.textContent = battleStatusText(v, d) || 'YOUR TURN - tap enemy waters to fire';
  } else {
    banner.className = 'status them';
    banner.textContent = concealIncoming ? `${d.opponentName || 'Opponent'} is sweeping the grid...` : (battleStatusText(v, d) || `OPPONENT TURN - ${d.opponentName || 'opponent'} is taking aim...`);
  }

  if (newShot || turnChanged) {
    banner.classList.remove('activity');
    void banner.offsetWidth;
    banner.classList.add('activity');
  }
  if (newShot && shot && !concealIncoming) {
    const grid = shot.by === d.you ? $('fireGrid') : $('myGrid');
    grid.classList.remove(shot.result === 'hit' ? 'hit-flash' : 'miss-flash');
    void grid.offsetWidth;
    grid.classList.add(shot.result === 'hit' ? 'hit-flash' : 'miss-flash');
  }
  if (!concealIncoming) lastBattleEventKey = shotKey;
  lastBattleTurn = v.turn;
}

function startBattleAimAnimation(shot, d) {
  const grid = $('myGrid');
  if (!grid) return;
  const key = `${shot.by}:${shot.r},${shot.c}:${shot.result}:${shot.sunk || ''}`;
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
    const gr = grid.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    aim.style.width = `${cr.width}px`;
    aim.style.height = `${cr.height}px`;
    aim.style.transform = `translate(${cr.left - gr.left}px, ${cr.top - gr.top}px)`;
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
        grid.classList.remove(shot.result === 'hit' ? 'hit-flash' : 'miss-flash');
        void grid.offsetWidth;
        grid.classList.add(shot.result === 'hit' ? 'hit-flash' : 'miss-flash');
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

async function fire(r, c) {
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (lastView.firingBoard[r][c]) { toast('Already fired there.'); return; }
  const cell = document.querySelector(`#fireGrid .cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) { cell.classList.add('ripple'); setTimeout(() => cell.classList.remove('ripple'), 500); }
  try {
    await api('/api/move', 'POST', { room: session.room, move: { r, c } });
    poll();
  } catch (e) { toast(e.message); }
}


// ---------------- connect four ----------------
function connectCanMove(v, c) {
  return v.phase === 'battle' && v.turn === session.you && v.legalMoves.includes(c);
}

function renderConnectFour(d, v) {
  const cols = v.cols || 7;
  const rows = v.rows || 6;
  const columns = $('connectColumns');
  const board = $('connectBoard');
  const winning = new Set(v.winningCells || []);
  const last = v.lastMove ? `${v.lastMove.r},${v.lastMove.c}` : null;

  columns.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  columns.innerHTML = '';
  for (let c = 0; c < cols; c++) {
    const btn = document.createElement('button');
    btn.className = 'drop-btn';
    btn.textContent = '▼';
    btn.disabled = !connectCanMove(v, c);
    btn.setAttribute('aria-label', `Drop disc in column ${c + 1}`);
    btn.onclick = () => dropConnectDisc(c);
    columns.appendChild(btn);
  }

  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  board.innerHTML = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const owner = v.board[r][c];
    const key = `${r},${c}`;
    const cell = document.createElement('div');
    cell.className = 'connect-cell'
      + (owner ? ` ${owner}` : '')
      + (last === key ? ' last' : '')
      + (winning.has(key) ? ' win' : '');
    cell.setAttribute('aria-label', owner ? `${owner === d.you ? 'Your' : 'Opponent'} disc` : 'Empty slot');
    board.appendChild(cell);
  }

  const banner = $('connectStatus');
  if (v.phase === 'over') {
    const tied = !v.winner;
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - the grid is full' : won ? 'VICTORY - four connected' : 'DEFEAT - rival connected four';
  } else if (v.turn === d.you) {
    banner.className = 'status you';
    banner.textContent = 'YOUR DROP - choose a column';
  } else {
    banner.className = 'status them';
    banner.textContent = `Standing by - ${d.opponentName || 'opponent'} is lining up a drop...`;
  }
}

async function dropConnectDisc(c) {
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (!lastView.legalMoves.includes(c)) { toast('That column is full.'); return; }
  try {
    await api('/api/move', 'POST', { room: session.room, move: { c } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- UNO ----------------
function oneCardLabel(card) {
  if (!card) return '—';
  if (card.kind === 'wild4') return '+4';
  if (card.kind === 'wild') return 'WILD';
  if (card.kind === 'draw2') return '+2';
  if (card.kind === 'reverse') return '↺';
  if (card.kind === 'skip') return '⊘';
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
  oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null };
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
    : clampOneCardIndex(oneCardHandUi.selectedIndex || Math.floor((hand.length - 1) / 2), hand);
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
  setOneCardSelection(hand, targetIndex, true);
  oneCardHandUi.gesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    lastT: performance.now(),
    moved: false,
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
function renderOneCard(d, v) {
  const players = v.players || [];
  const me = players.find(player => player.you) || { name: d.youName, cards: (v.hand || []).length };
  const opponents = $('oneCardOpponents');
  opponents.innerHTML = '';
  players.filter(player => !player.you).forEach(player => {
    const tile = document.createElement('div');
    tile.className = 'one-opponent'
      + (v.turn === player.slot ? ' active' : '')
      + (player.cards === 1 ? ' uno' : '');
    const name = document.createElement('span');
    name.textContent = player.name;
    const count = document.createElement('strong');
    count.textContent = player.cards === 1 ? 'UNO!' : player.cards;
    tile.append(name, count);
    opponents.appendChild(tile);
  });

  $('oneCardCode').textContent = session.room;
  $('oneCardCodeWrap').classList.toggle('hidden', v.phase !== 'lobby');
  $('oneCardStart').classList.toggle('hidden', v.phase !== 'lobby' || !v.canStart);
  $('oneCardDraw').disabled = !(v.phase === 'battle' && v.turn === session.you);
  $('oneCardDraw').textContent = v.legalCardIds && v.legalCardIds.length ? 'Draw / pass (D)' : 'Draw card (D)';
  $('oneCardCount').textContent = `${me.cards || (v.hand || []).length} card${(me.cards || (v.hand || []).length) === 1 ? '' : 's'}`;
  $('oneCardDirection').textContent = v.direction === -1 ? '↺ counter-clockwise' : '↻ clockwise';
  $('oneCardDeckCount').textContent = `${v.drawCount || 0} in draw pile`;
  const colorName = v.currentColor ? v.currentColor[0].toUpperCase() + v.currentColor.slice(1) : 'None';
  const currentColorLabel = $('oneCardCurrentColor');
  if (currentColorLabel) currentColorLabel.textContent = `Current color: ${colorName}`;

  const top = v.topCard;
  const discard = $('oneCardDiscard');
  discard.className = `one-card-card discard ${oneCardColor(top, v.currentColor)}`;
  discard.innerHTML = `<span>${oneCardLabel(top)}</span><small>${oneCardName(top)}</small>`;

  const colorDots = $('oneCardColorDots');
  colorDots.innerHTML = '';
  ['red', 'gold', 'green', 'blue'].forEach(color => {
    const dot = document.createElement('span');
    dot.className = `color-dot ${color}` + (v.currentColor === color ? ' active' : '');
    colorDots.appendChild(dot);
  });

  const hand = $('oneCardHand');
  const cards = v.hand || [];
  hand.innerHTML = '';
  syncOneCardSelection(cards);
  cards.forEach((card, index) => {
    const btn = document.createElement('button');
    const canPlay = oneCardCanPlay(v, card);
    btn.className = `one-card-card ${oneCardColor(card)}` + (canPlay ? ' playable' : '');
    btn.type = 'button';
    btn.setAttribute('aria-disabled', canPlay ? 'false' : 'true');
    btn.setAttribute('aria-label', `${oneCardName(card)}${canPlay ? ', playable' : ', not playable'}`);
    const label = oneCardLabel(card);
    const color = card.color === 'wild' ? 'Wild' : card.color;
    btn.innerHTML = `<b class="corner top">${label}</b><span>${label}</span><small>${color}</small><b class="corner bottom">${label}</b>`;
    btn.onclick = event => {
      if (oneCardHandUi.gesture && oneCardHandUi.gesture.moved) return;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        event.preventDefault();
        setOneCardSelection(cards, index, true);
        return;
      }
      playOneCard(card);
    };
    btn.onpointerdown = event => startOneCardHandGesture(event, index);
    btn.onpointermove = moveOneCardHandGesture;
    btn.onpointerup = finishOneCardHandGesture;
    btn.onpointercancel = finishOneCardHandGesture;
    hand.appendChild(btn);
  });
  layoutOneCardFan(cards);

  const banner = $('oneCardStatus');
  if (v.phase === 'lobby') {
    banner.className = 'status them';
    banner.textContent = v.canStart ? 'Ready - start now or let more players join.' : `Share the code. UNO starts with ${v.minPlayers}+ players.`;
  } else if (v.phase === 'over') {
    const won = v.winner === d.you;
    const winner = players.find(player => player.slot === v.winner);
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY - UNO cleared' : `${winner ? winner.name : 'A rival'} emptied their hand.`;
  } else if (v.turn === d.you) {
    banner.className = 'status you';
    banner.textContent = v.legalCardIds.length ? 'YOUR PLAY - match color, number, or symbol' : 'No legal cards - draw one';
  } else {
    const current = players.find(player => player.slot === v.turn);
    banner.className = 'status them';
    banner.textContent = `${current ? current.name : 'A rival'} is choosing a card...`;
  }
  $('oneCardLast').textContent = v.lastAction ? v.lastAction.text : 'First to empty their hand wins. Call it what it is: UNO.';
}
function chooseWildColor() {
  const color = prompt('Choose a color: red, gold, green, or blue', lastView.currentColor || 'red');
  const clean = String(color || '').toLowerCase();
  return ['red', 'gold', 'green', 'blue'].includes(clean) ? clean : 'red';
}
async function startOneCard() {
  try {
    await api('/api/move', 'POST', { room: session.room, move: { action: 'start' } });
    poll();
  } catch (e) { toast(e.message); }
}
async function playOneCard(card) {
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  const move = { action: 'play', cardId: card.id };
  if (card.color === 'wild') move.color = chooseWildColor();
  try {
    await api('/api/move', 'POST', { room: session.room, move });
    poll();
  } catch (e) { toast(e.message); }
}
async function drawOneCard() {
  if (!lastView || lastView.ui !== 'onecard' || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  try {
    await api('/api/move', 'POST', { room: session.room, move: { action: 'draw' } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- Mancala ----------------
let mncAnimating = false;
let mncLastPits = null;
let mncLastMoveTag = null;
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

function mncSound(kind, variation = 0) {
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const tones = {
    pickup: 150,
    sow: 380 + (variation % 5) * 24,
    capture: 220,
    bonus: 620,
  };
  oscillator.type = kind === 'sow' ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(tones[kind] || 320, now);
  if (kind === 'capture') oscillator.frequency.exponentialRampToValueAtTime(110, now + 0.11);
  gain.gain.setValueAtTime(kind === 'sow' ? 0.035 : 0.045, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'sow' ? 0.055 : 0.12));
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.13);
}

function mncDotsHTML(count) {
  if (!count || count > 5) return '';
  // Dice-face positions in a 100×100 viewBox
  const faces = {
    1: [[50,50]],
    2: [[30,50],[70,50]],
    3: [[26,32],[50,62],[74,32]],
    4: [[28,28],[72,28],[28,72],[72,72]],
    5: [[28,28],[72,28],[50,50],[28,72],[72,72]],
  };
  const R = 9;
  const circles = faces[count].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="${R}"/>`).join('');
  return `<svg class="mnc-dots-svg" viewBox="0 0 100 100" aria-hidden="true">${circles}</svg>`;
}

function buildMancalaBoard(v, pits) {
  const mkStore = (pitIdx, who) => {
    const count = pits[pitIdx];
    return `<div class="mnc-store ${who}" id="mnc-p${pitIdx}" data-pit="${pitIdx}"
      style="grid-column:${who === 'opp' ? 1 : 3};grid-row:1/3">
      <div class="mnc-scount">${count}</div>
      <div class="mnc-slabel">${who === 'mine' ? 'You' : 'Opp'}</div>
    </div>`;
  };

  const mkPit = (pitIdx, who) => {
    const count = pits[pitIdx];
    const empty = count === 0;
    const valid = who === 'mine' && !mncAnimating && v.isMyTurn && v.validMoves.includes(pitIdx);
    const many = count > 5;
    const cls = `mnc-pit ${who}${empty ? ' empty' : ''}${valid ? ' valid' : ''}${many ? ' many' : ''}`;
    const tap = valid ? `onclick="moveMancala(${pitIdx})"` : '';
    return `<div class="${cls}" id="mnc-p${pitIdx}" data-pit="${pitIdx}" ${tap}>
      ${mncDotsHTML(count)}
      <span class="mnc-count">${count || ''}</span>
    </div>`;
  };

  return `
    ${mkStore(v.oppStoreIndex, 'opp')}
    <div class="mnc-row opp" style="grid-column:2;grid-row:1">
      ${v.oppPitIndices.map(i => mkPit(i, 'opp')).join('')}
    </div>
    <div class="mnc-row mine" style="grid-column:2;grid-row:2">
      ${v.myPitIndices.map(i => mkPit(i, 'mine')).join('')}
    </div>
    ${mkStore(v.myStoreIndex, 'mine')}
  `;
}

function mncUpdatePit(pitIdx, count, v) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  const isStore = el.classList.contains('mnc-store');
  const countEl = el.querySelector(isStore ? '.mnc-scount' : '.mnc-count');
  if (countEl) countEl.textContent = count || (isStore ? count : '');
  if (!isStore) {
    el.classList.toggle('empty', count === 0);
    el.classList.toggle('many', count > 5);
    const dotsEl = el.querySelector('.mnc-dots-svg');
    if (dotsEl) el.removeChild(dotsEl);
    if (count > 0 && count <= 5) el.insertAdjacentHTML('afterbegin', mncDotsHTML(count));
  }
}

function mncFlySeed(fromPit, toPit, who) {
  const board = $('mncBoard');
  const from = document.getElementById(`mnc-p${fromPit}`);
  const to = document.getElementById(`mnc-p${toPit}`);
  if (!board || !from || !to) return;
  const br = board.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const seed = document.createElement('span');
  seed.className = `mnc-floater ${who === 'opp' ? 'opp' : 'mine'}`;
  const sx = fr.left - br.left + fr.width / 2;
  const sy = fr.top - br.top + fr.height / 2;
  const ex = tr.left - br.left + tr.width / 2;
  const ey = tr.top - br.top + tr.height / 2;
  seed.style.left = `${sx}px`;
  seed.style.top = `${sy}px`;
  seed.style.setProperty('--dx', `${ex - sx}px`);
  seed.style.setProperty('--dy', `${ey - sy}px`);
  board.appendChild(seed);
  setTimeout(() => seed.remove(), 380);
}

function mncBounce(pitIdx) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  el.classList.remove('land');
  void el.offsetWidth;
  el.classList.add('land');
  setTimeout(() => el.classList.remove('land'), 280);
}

function mncAnimateMove(v, prevPits) {
  mncAnimating = true;
  const { moveSeq, movePickup, pits, extraTurn, captureCount, captureFrom, myStoreIndex } = v;

  const running = prevPits.slice();
  const frames = [];

  // Pickup: source pit goes to 0
  running[movePickup] = 0;
  frames.push({ pit: movePickup, count: 0, type: 'pickup' });

  // Sow: each stone drops into its pit
  for (const pitIdx of moveSeq) {
    running[pitIdx]++;
    frames.push({ pit: pitIdx, count: running[pitIdx], type: 'sow' });
  }

  // Capture: opponent pit clears, my store gains
  if (captureCount > 0 && captureFrom >= 0) {
    frames.push({ pit: captureFrom, count: 0, type: 'capture-clear' });
    frames.push({ pit: myStoreIndex, count: pits[myStoreIndex], type: 'capture-store' });
  }

  // Extra turn: store pulse
  if (extraTurn) {
    frames.push({ pit: myStoreIndex, count: pits[myStoreIndex], type: 'extraturn' });
  }

  const STEP = Math.max(80, Math.min(150, 900 / Math.max(1, moveSeq.length)));

  let i = 0;
  function step() {
    if (i >= frames.length) {
      mncAnimating = false;
      mncLastPits = pits.slice();
      const board = $('mncBoard');
      if (board) board.innerHTML = buildMancalaBoard(v, pits);
      // Flash special event in banner briefly
      const banner = $('mncStatus');
      if (banner && v.phase === 'battle') {
        if (extraTurn && captureCount > 0) {
          banner.textContent = `SNATCH +${captureCount} — BONUS SOW!`;
          banner.className = 'status win';
        } else if (extraTurn) {
          banner.textContent = 'BONUS SOW! — go again';
          banner.className = 'status win';
        } else if (captureCount > 0) {
          banner.textContent = `SNATCHED ${captureCount} seed${captureCount > 1 ? 's' : ''}!`;
          banner.className = 'status win';
        }
        if (extraTurn || captureCount > 0) {
          setTimeout(() => {
            if (banner && v.phase === 'battle') {
              banner.textContent = 'YOUR SOW — pick one of your pits';
              banner.className = 'status you';
            }
          }, 1600);
        }
      }
      return;
    }
    const frame = frames[i];
    if (frame.type === 'pickup') {
      mncSound('pickup');
      const source = document.getElementById(`mnc-p${frame.pit}`);
      if (source) {
        source.classList.remove('pickup');
        void source.offsetWidth;
        source.classList.add('pickup');
      }
    }
    if (frame.type === 'sow') {
      mncFlySeed(movePickup, frame.pit, v.myPitIndices.includes(movePickup) || movePickup === v.myStoreIndex ? 'mine' : 'opp');
      mncSound('sow', i);
    }
    mncUpdatePit(frame.pit, frame.count, v);
    if (frame.type === 'sow') mncBounce(frame.pit);
    if (frame.type === 'capture-store') mncSound('capture');
    if (frame.type === 'capture-store') {
      const storeEl = document.getElementById(`mnc-p${myStoreIndex}`);
      if (storeEl) {
        storeEl.classList.remove('capture-anim');
        void storeEl.offsetWidth;
        storeEl.classList.add('capture-anim');
      }
    }
    if (frame.type === 'extraturn') {
      mncSound('bonus');
      const storeEl = document.getElementById(`mnc-p${myStoreIndex}`);
      if (storeEl) {
        storeEl.classList.remove('extraturn-anim');
        void storeEl.offsetWidth;
        storeEl.classList.add('extraturn-anim');
      }
    }
    i++;
    setTimeout(step, frame.type === 'pickup' ? STEP * 0.6 : STEP);
  }
  step();
}

function renderMancala(d, v) {
  const board = $('mncBoard');
  if (!board) return;

  const moveTag = v.moveSeq && v.moveSeq.length > 0
    ? `${v.moveNumber || 0}:${v.movePickup}:${v.moveSeq.join(',')}` : '';
  const hasNewMove = moveTag && moveTag !== mncLastMoveTag && !!mncLastPits;
  const pitsChanged = mncLastPits && v.pits.some((p, i) => p !== mncLastPits[i]);

  if (!board.children.length) {
    board.innerHTML = buildMancalaBoard(v, v.pits);
    mncLastPits = v.pits.slice();
  } else if (hasNewMove && !mncAnimating && pitsChanged) {
    board.innerHTML = buildMancalaBoard(v, mncLastPits);
    mncAnimateMove(v, mncLastPits);
  } else if (!mncAnimating) {
    board.innerHTML = buildMancalaBoard(v, v.pits);
    mncLastPits = v.pits.slice();
  }

  if (!mncAnimating) mncLastMoveTag = moveTag || mncLastMoveTag;

  const myScore  = v.pits[v.myStoreIndex];
  const oppScore = v.pits[v.oppStoreIndex];
  const banner = $('mncStatus');

  if (v.phase === 'over') {
    const tied = v.winner === 'draw';
    const won  = v.winner === v.myPiece;
    banner.className = 'status ' + (tied ? 'them' : won ? 'win' : 'lose');
    banner.textContent = tied
      ? `DRAW — ${myScore} to ${oppScore}`
      : won
        ? `VICTORY — you captured ${myScore} seeds`
        : `DEFEAT — opponent captured ${oppScore} seeds`;
  } else if (v.isMyTurn) {
    banner.className = 'status you';
    banner.textContent = 'YOUR SOW — pick one of your pits';
  } else {
    banner.className = 'status them';
    banner.textContent = `OPPONENT TURN — ${d.opponentName || 'opponent'} is sowing...`;
  }

  const legend = $('mncLegend');
  if (legend) {
    legend.innerHTML =
      `<span><span class="mnc-seed mine"></span>You — <span class="mnc-legend-score mine">${myScore}</span></span>` +
      `<span>Opp — <span class="mnc-legend-score opp">${oppScore}</span><span class="mnc-seed opp" style="margin-left:5px"></span></span>`;
  }
}

async function moveMancala(pitIdx) {
  if (!lastView || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  if (!lastView.validMoves.includes(pitIdx)) { toast('That pit is empty.'); return; }

  try {
    mncEnsureAudio();
    await api('/api/move', 'POST', { room: session.room, move: { pit: pitIdx } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- Ultimate TTT ----------------
function renderUltimateTTT(d, v) {
  const EMPTY = 0, X = 1, O = 2, DRAW = 3;
  const board = $('utttBoard');
  const validSet = new Set(v.validMoves || []);

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
          + (isLast ? ' last' : '');
        if (val === X) cell.textContent = 'X';
        else if (val === O) cell.textContent = 'O';
        if (isValid) cell.onclick = () => moveUltimateTTT(idx);
        miniEl.appendChild(cell);
      }
    }

    if (miniWinner !== EMPTY) {
      const ov = document.createElement('div');
      ov.className = 'uttt-mini-winner';
      ov.textContent = miniWinner === X ? 'X' : miniWinner === O ? 'O' : '—';
      miniEl.appendChild(ov);
    }

    board.appendChild(miniEl);
  }

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
});
window.addEventListener('orientationchange', () => setTimeout(() => {
  applyDeviceClasses(document.querySelector('section:not(.hidden)')?.id || 'home');
  if (lastView && lastView.ui === 'onecard') layoutOneCardFan(lastView.hand || []);
}, 80));
document.addEventListener('keydown', e => {
  if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (!session) return;
  if (e.key.toLowerCase() === 'r' && !$('placement').classList.contains('hidden')) toggleOrient();
  const n = Number(e.key);
  if (n >= 1 && n <= 7 && lastView && lastView.ui === 'connectfour') dropConnectDisc(n - 1);
  if (e.key.toLowerCase() === 'd' && lastView && lastView.ui === 'onecard') drawOneCard();
});

populateGameSelect();
const params = launchParams();
applyLaunchGame(params.game);
session = loadSession();
if (session) { show('battle'); enterRoom(); }
else if (params.mode === 'computer') {
  show('home');
  createComputerGame().finally(clearLaunchParams);
} else show('home');
