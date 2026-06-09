const $ = id => document.getElementById(id);
let session = null;            // {room, token, you, game, mode}
let orient = 'H';              // H | V
let placedShips = [];          // [{name,size,cells:[]}]
let selectedShip = null;       // fleet index being placed
let fleetDef = [];             // from server view
let pollTimer = null;
let lastView = null;
let boardSize = 10;

// ---- browser session persistence
function loadSession() { try { return JSON.parse(localStorage.getItem('armada')); } catch { return null; } }
function setSession(s) { session = s; localStorage.setItem('armada', JSON.stringify(s)); }
function clearSession() {
  if (session && window.CouchArmadaSolo) window.CouchArmadaSolo.clearRoom(session);
  session = null;
  localStorage.removeItem('armada');
}

function show(id) {
  ['home','lobby','placement','battle','connectFour','oneCard'].forEach(section => {
    const el = $(section);
    if (el) el.classList.toggle('hidden', section !== id);
  });
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function gameCatalog() {
  if (window.CouchArmadaRegistry) return window.CouchArmadaRegistry.listGames();
  return Object.entries(window.CouchArmadaGames || {}).map(([id, module]) => ({ id, name: id, module }));
}
function gameMeta(id) {
  if (window.CouchArmadaRegistry) return window.CouchArmadaRegistry.getGame(id);
  const module = (window.CouchArmadaGames || {})[id];
  return module ? { id, name: id, module } : null;
}
function availableGames() {
  return Object.fromEntries(gameCatalog().map(game => [game.id, game.module]));
}
function currentGameMeta() { return gameMeta(session && session.game) || gameMeta(selectedGameId()); }
function selectedGameId() { return $('gameSelect').value || 'battleship'; }
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
  return window.CouchArmadaSolo.handle(path, method, body, session, { gameMeta, selectedGameId });
}

async function api(path, method, body) {
  if (session && session.mode === 'computer') return soloApi(path, method, body || {});
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
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

function startPoll() { stopPoll(); pollTimer = setInterval(poll, 3000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  if (!session) return;
  try {
    const d = await api(`/api/state?room=${session.room}&token=${session.token}`, 'GET');
    render(d);
  } catch (e) {
    if (/No such game|Not in this game/.test(e.message)) { clearSession(); stopPoll(); show('home'); }
  }
}

function render(d) {
  const v = d.view;
  lastView = v;
  fleetDef = v.fleet || fleetDef || [];
  boardSize = v.size || boardSize;
  $('foot').textContent = `Game ${session.room} - ${d.youName}` + (d.opponentName ? ` vs ${d.opponentName}` : '');

  if (!d.opponentJoined) { show('lobby'); $('lobbyCode').textContent = session.room; return; }

  const meta = currentGameMeta();
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
  $('oneCardOpponents').innerHTML = '';
  $('oneCardHand').innerHTML = '';
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
  g.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell'; cell.dataset.r = r; cell.dataset.c = c;
    cell.onclick = () => placeAt(r, c);
    cell.onmouseenter = () => previewPlacement(r, c);
    cell.onmouseleave = () => renderPlaceGrid();
    cell.ontouchstart = () => previewPlacement(r, c);
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
      if (placed) { placedShips = placedShips.filter(p => p.name !== s.name); }
      selectedShip = i; renderFleetList(); renderPlaceGrid();
    };
    list.appendChild(row);
  });
  $('readyBtn').disabled = placedShips.length !== fleetDef.length;
}

function shipCells(r, c, size) {
  const cells = [];
  for (let i = 0; i < size; i++) cells.push(orient === 'H' ? `${r},${c + i}` : `${r + i},${c}`);
  return cells;
}
function occupiedSet() { const s = new Set(); placedShips.forEach(p => p.cells.forEach(x => s.add(x))); return s; }

function placeAt(r, c) {
  if (selectedShip == null) return;
  const def = fleetDef[selectedShip];
  if (placedShips.find(p => p.name === def.name)) return; // already placed; tap list to pull back
  const cells = shipCells(r, c, def.size);
  const occ = occupiedSet();
  for (const cell of cells) {
    const [rr, cc] = cell.split(',').map(Number);
    if (rr < 0 || rr >= boardSize || cc < 0 || cc >= boardSize) { toast('Off the board.'); return; }
    if (occ.has(cell)) { toast('Ships cannot overlap.'); return; }
  }
  placedShips.push({ name: def.name, size: def.size, cells });
  // advance to next unplaced
  const nextIdx = fleetDef.findIndex(s => !placedShips.find(p => p.name === s.name));
  selectedShip = nextIdx === -1 ? null : nextIdx;
  renderFleetList(); renderPlaceGrid();
}

function renderPlaceGrid(preview = []) {
  const occ = occupiedSet();
  const previewSet = new Set(preview.map(item => item.key));
  const blocked = preview.some(item => item.blocked);
  document.querySelectorAll('#placeGrid .cell').forEach(cell => {
    const key = `${cell.dataset.r},${cell.dataset.c}`;
    let cls = 'cell';
    if (occ.has(key)) cls += ' ship';
    if (previewSet.has(key)) cls += blocked ? ' blocked' : ' preview';
    cell.className = cls;
  });
}

function previewPlacement(r, c) {
  if (selectedShip == null || !fleetDef[selectedShip]) return;
  const def = fleetDef[selectedShip];
  if (placedShips.find(p => p.name === def.name)) return;
  const occ = occupiedSet();
  const preview = shipCells(r, c, def.size).map(key => {
    const [rr, cc] = key.split(',').map(Number);
    return { key, blocked: rr < 0 || rr >= boardSize || cc < 0 || cc >= boardSize || occ.has(key) };
  });
  renderPlaceGrid(preview);
}

function toggleOrient() {
  orient = orient === 'H' ? 'V' : 'H';
  $('orientBtn').textContent = orient === 'H' ? 'Heading: East' : 'Heading: South';
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
      if (ok) placedShips.push({ name: def.name, size: def.size, cells });
    }
  }
  selectedShip = null; renderFleetList(); renderPlaceGrid();
}

async function submitFleet() {
  try {
    await api('/api/setup', 'POST', { room: session.room, token: session.token, ships: placedShips });
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

  // firing grid = my shots on enemy
  document.querySelectorAll('#fireGrid .cell').forEach(cell => {
    const val = v.firingBoard[+cell.dataset.r][+cell.dataset.c];
    cell.className = 'cell' + (val === 'hit' ? ' hit' : val === 'miss' ? ' miss' : '');
  });
  // my fleet grid, with enemy shots shown
  document.querySelectorAll('#myGrid .cell').forEach(cell => {
    const sq = v.myBoard[+cell.dataset.r][+cell.dataset.c];
    let cls = 'cell';
    if (sq.shot === 'hit') cls += ' hit';
    else if (sq.shot === 'miss') cls += ' miss';
    else if (sq.ship) cls += ' ship';
    cell.className = cls;
  });

  $('enemyLeft').textContent = `${v.enemyShipsLeft} ship${v.enemyShipsLeft === 1 ? '' : 's'} afloat`;
  $('myLeft').textContent = `${v.myShipsLeft} ship${v.myShipsLeft === 1 ? '' : 's'} afloat`;

  const banner = $('statusBanner');
  if (v.phase === 'over') {
    const won = v.winner === d.you;
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY - enemy fleet destroyed' : 'DEFEAT - your fleet is sunk';
  } else if (v.turn === d.you) {
    banner.className = 'status you';
    banner.textContent = sunkNote(v, d) || 'YOUR MOVE - tap enemy waters to fire';
  } else {
    banner.className = 'status them';
    banner.textContent = sunkNote(v, d) || `Standing by - ${d.opponentName || 'opponent'} is taking aim...`;
  }
}

function sunkNote(v, d) {
  const ls = v.lastShot;
  if (!ls) return null;
  if (ls.sunk) {
    return ls.by === d.you ? `You sank their ${ls.sunk}!` : `They sank your ${ls.sunk}.`;
  }
  return null;
}

async function fire(r, c) {
  if (!lastView || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (lastView.firingBoard[r][c]) { toast('Already fired there.'); return; }
  const cell = document.querySelector(`#fireGrid .cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) { cell.classList.add('ripple'); setTimeout(() => cell.classList.remove('ripple'), 500); }
  try {
    await api('/api/move', 'POST', { room: session.room, token: session.token, move: { r, c } });
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
    await api('/api/move', 'POST', { room: session.room, token: session.token, move: { c } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- one-card ----------------
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
function renderOneCard(d, v) {
  const players = v.players || [];
  const me = players.find(player => player.you) || { name: d.youName, cards: (v.hand || []).length };
  const opponents = $('oneCardOpponents');
  opponents.innerHTML = '';
  players.filter(player => !player.you).forEach(player => {
    const tile = document.createElement('div');
    tile.className = 'one-opponent' + (v.turn === player.slot ? ' active' : '');
    tile.innerHTML = `<span>${player.name}</span><strong>${player.cards}</strong>`;
    opponents.appendChild(tile);
  });

  $('oneCardCode').textContent = session.room;
  $('oneCardCodeWrap').classList.toggle('hidden', v.phase !== 'lobby');
  $('oneCardStart').classList.toggle('hidden', v.phase !== 'lobby' || !v.canStart);
  $('oneCardDraw').disabled = !(v.phase === 'battle' && v.turn === session.you);
  $('oneCardCount').textContent = `${me.cards || (v.hand || []).length} card${(me.cards || (v.hand || []).length) === 1 ? '' : 's'}`;
  $('oneCardDirection').textContent = v.direction === -1 ? 'counter-clockwise' : 'clockwise';
  $('oneCardDeckCount').textContent = `${v.drawCount || 0} in draw pile`;

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
  hand.innerHTML = '';
  (v.hand || []).forEach(card => {
    const btn = document.createElement('button');
    btn.className = `one-card-card ${oneCardColor(card)}` + (oneCardCanPlay(v, card) ? ' playable' : '');
    btn.disabled = !oneCardCanPlay(v, card);
    btn.innerHTML = `<span>${oneCardLabel(card)}</span><small>${card.color === 'wild' ? 'Wild' : card.color}</small>`;
    btn.onclick = () => playOneCard(card);
    hand.appendChild(btn);
  });

  const banner = $('oneCardStatus');
  if (v.phase === 'lobby') {
    banner.className = 'status them';
    banner.textContent = v.canStart ? 'Ready - start now or let more players join.' : `Share the code. One-Card starts with ${v.minPlayers}+ players.`;
  } else if (v.phase === 'over') {
    const won = v.winner === d.you;
    const winner = players.find(player => player.slot === v.winner);
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY - you emptied your hand' : `${winner ? winner.name : 'A rival'} emptied their hand.`;
  } else if (v.turn === d.you) {
    banner.className = 'status you';
    banner.textContent = v.legalCardIds.length ? 'YOUR PLAY - match color, number, or symbol' : 'No legal cards - draw one';
  } else {
    const current = players.find(player => player.slot === v.turn);
    banner.className = 'status them';
    banner.textContent = `${current ? current.name : 'A rival'} is choosing a card...`;
  }
  $('oneCardLast').textContent = v.lastAction ? v.lastAction.text : 'First to empty their hand wins.';
}
function chooseWildColor() {
  const color = prompt('Choose a color: red, gold, green, or blue', lastView.currentColor || 'red');
  const clean = String(color || '').toLowerCase();
  return ['red', 'gold', 'green', 'blue'].includes(clean) ? clean : 'red';
}
async function startOneCard() {
  try {
    await api('/api/move', 'POST', { room: session.room, token: session.token, move: { action: 'start' } });
    poll();
  } catch (e) { toast(e.message); }
}
async function playOneCard(card) {
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  const move = { action: 'play', cardId: card.id };
  if (card.color === 'wild') move.color = chooseWildColor();
  try {
    await api('/api/move', 'POST', { room: session.room, token: session.token, move });
    poll();
  } catch (e) { toast(e.message); }
}
async function drawOneCard() {
  if (!lastView || lastView.ui !== 'onecard' || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  try {
    await api('/api/move', 'POST', { room: session.room, token: session.token, move: { action: 'draw' } });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------------- boot ----------------
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.addEventListener('keydown', e => {
  if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (!session) return;
  if (e.key.toLowerCase() === 'r' && !$('placement').classList.contains('hidden')) toggleOrient();
  const n = Number(e.key);
  if (n >= 1 && n <= 7 && lastView && lastView.ui === 'connectfour') dropConnectDisc(n - 1);
  if (e.key.toLowerCase() === 'd' && lastView && lastView.ui === 'onecard') drawOneCard();
});

populateGameSelect();
session = loadSession();
if (session) { show('battle'); enterRoom(); }
else show('home');
