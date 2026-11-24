// Battleship screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let orient = 'H';              // H | V
let placedShips = [];          // [{name,size,cells:[]}]
let selectedShip = null;       // fleet index being placed
let lastBattleEventKey = null;
let lastBattleTurn = null;
let battleAimAnimation = null;
let battleShellAnimation = null;
let battleFocus = 'fire';
let aimCell = null;            // {r,c} target picked but not fired yet
let pendingOutgoing = null;    // {r,c} fired, waiting to animate the result
let battleOverFxDone = false;
let battleIncomingHoldUntil = 0; // brief pause between your impact fx and the enemy's reticle sweep
let placementDrag = null;
let ignoreNextPlacementClick = false;
let lastShipTap = null; // { name, time } for double-tap-to-rotate

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

// Ship art. fleet.png holds each ship twice: lying east in the left 5 x 5 cells (row =
// ship, column = cell from the stern) and heading south in the right 5 x 5 (column = ship,
// row = cell from the stern). Returns cell key -> background-position for that cell.
const FLEET_ART_ROW = { Carrier: 0, Battleship: 1, Cruiser: 2, Submarine: 3, Destroyer: 4 };
function shipArtMap(ships) {
  const map = new Map();
  (ships || []).forEach(ship => {
    const row = FLEET_ART_ROW[ship.name];
    if (row == null || !ship.cells || !ship.cells.length) return;
    const cells = ship.cells.map(key => key.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const south = cells.length > 1 && cells[0][1] === cells[1][1];
    cells.forEach(([r, c], i) => map.set(`${r},${c}`,
      south ? `${(5 + row) / 9 * 100}% ${i / 4 * 100}%` : `${i / 9 * 100}% ${row / 4 * 100}%`));
  });
  return map;
}
// Call after setting cell.className: that assignment drops the class.
function paintShipArt(cell, position) {
  cell.classList.toggle('shipart', !!position);
  cell.style.backgroundPosition = position || '';
  // the same position again for the mask that draws a sunk ship's outline
  if (position) cell.style.setProperty('--ship-at', position);
  else cell.style.removeProperty('--ship-at');
}

function renderFleetList() {
  const list = $('fleetList'); list.innerHTML = '';
  fleetDef.forEach((s, i) => {
    const placed = placedShips.find(p => p.name === s.name);
    const row = document.createElement('div');
    row.className = 'ship-row' + (i === selectedShip ? ' active' : '') + (placed ? ' done' : '');
    const artRow = FLEET_ART_ROW[s.name];
    const pips = artRow == null
      ? `<span class="pips">${Array.from({ length: s.size }, () => '<span class="pip"></span>').join('')}</span>`
      : `<span class="ship-pic" style="width:${s.size * 20}px;background-size:${1000 / s.size}% 500%;background-position:0 ${artRow * 25}%"></span>`;
    row.innerHTML = `<span class="ship-name">${s.name}</span>
      <span style="display:flex;align-items:center;gap:10px">
        ${pips}
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
  const art = shipArtMap(placedShips);
  document.querySelectorAll('#placeGrid .cell').forEach(cell => {
    const key = `${cell.dataset.r},${cell.dataset.c}`;
    let cls = 'cell';
    const ship = placedShipAt(key);
    if (occ.has(key)) cls += ' ship';
    if (ship && ship.cells[0] === key) cls += ' ship-bow';
    if (previewSet.has(key)) cls += blocked ? ' blocked' : ' preview';
    if (previewSet.has(key) && overlap) cls += ' overlap-preview';
    cell.className = cls;
    paintShipArt(cell, !previewSet.has(key) && art.get(key));
    cell.textContent = ship && ship.cells[0] === key && !art.has(key) ? ship.name[0] : '';
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

function nextUnplacedShip(fallback) {
  const i = fleetDef.findIndex(s => !placedShips.find(p => p.name === s.name));
  return i >= 0 ? i : fallback;
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
    if (placedShips.find(p => p.name === def.name)) return; // open water never moves a placed ship
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
  selectedShip = nextUnplacedShip(fleetDef.findIndex(s => s.name === drag.name));
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

// Fleet tracker: each ship as its small picture. Your own ships carry a damage bar
// underneath; an enemy ship only changes when it sinks.
function renderFleetStrip(el, ships, mine) {
  if (!el) return;
  el.innerHTML = (ships || []).map(s => {
    const title = `${s.name}${s.sunk ? ' - sunk' : ''}`;
    const artRow = FLEET_ART_ROW[s.name];
    if (artRow == null) {
      const pips = Array.from({ length: s.size }, (_, i) =>
        `<span class="fs-pip${(s.sunk || (mine && i < (s.hits || 0))) ? ' hit' : ''}"></span>`).join('');
      return `<span class="fs-ship${s.sunk ? ' sunk' : ''}" title="${title}">${pips}</span>`;
    }
    const size = `${1000 / s.size}% 500%`;
    const at = `0 ${artRow * 25}%`;
    const hits = s.sunk ? s.size : Math.min(s.size, s.hits || 0);
    const bar = mine ? `<span class="fs-bar"><i style="width:${hits / s.size * 100}%"></i></span>` : '';
    return `<span class="fs-ship art${s.sunk ? ' sunk' : ''}" title="${title}">`
      + `<span class="fs-pic" style="width:calc(var(--fs-cell, 11px) * ${s.size});background-size:${size};background-position:${at};`
      + `-webkit-mask-size:${size};mask-size:${size};-webkit-mask-position:${at};mask-position:${at}"></span>${bar}</span>`;
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
        // The player may have gone Home, or into another game, while the shell was in the
        // air; lastView is then missing or belongs to that other game.
        if (!lastView || !lastView.firingBoard) return;
        renderBattle(d, lastView);
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

  const myArt = shipArtMap(v.myFleet);
  const enemyArt = shipArtMap(v.enemyFleet);
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
    // a sunk enemy ship shows itself; at the end the ships never found do too
    paintShipArt(cell, (val === 'hit' ? enemySunkCells.has(key) : !val && enemyRevealCells.has(key)) && enemyArt.get(key));
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
    paintShipArt(cell, sq.ship && myArt.get(key)); // a hit leaves the ship in view under its mark
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

// Called by resetGameUi() in app.js before another game takes the screen.
function resetBattleshipUi() {
  resetPlacement();
  $('fireGrid').innerHTML = '';
  $('myGrid').innerHTML = '';
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
