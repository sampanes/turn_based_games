// Connect Four screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let connectGeneration = 0;
let connectUi = freshConnectUi();
let connectLastData = null;

// ---------------- connect four ----------------
const connectReducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function connectMotionOff() { return !!(connectReducedMotion && connectReducedMotion.matches); }

function freshConnectUi() {
  connectGeneration += 1;
  return {
    focusedCol: 3,
    lastMoveNumber: 0,
    seeded: false,        // first paint places discs without animating them
    overFxDone: false,
    winFxKey: '',
    builtFor: '',
    cells: [],            // cells[r][c] -> { el, token, owner }
    sending: false,
    animUntil: 0,
    finishTimer: null,
    generation: connectGeneration,
  };
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
  if (!(v.legalMoves || []).includes(c)) return { kind: 'full' };
  if (connectWouldWin(v, c, d.you)) return { kind: 'win' };
  if (connectWouldWin(v, c, connectOpponentSlot(d))) return { kind: 'block' };
  return { kind: 'open' };
}

function connectSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'release') {
    battleTone(audio, t, 660, 0.05, { type: 'triangle', gain: 0.04 });
  } else if (kind === 'land') {
    battleTone(audio, t, 290, 0.1, { type: 'triangle', slideTo: 140, gain: 0.08 });
    battleTone(audio, t + 0.012, 135, 0.16, { type: 'sine', slideTo: 72, gain: 0.1 });
    battleNoise(audio, t, 0.045, { freq: 1500, type: 'lowpass', gain: 0.05 });
  } else if (kind === 'select') {
    battleTone(audio, t, 920, 0.045, { type: 'square', gain: 0.035 });
  }
}

function connectAnimBusy() { return Date.now() < connectUi.animUntil; }

function connectSetFocus(c) {
  const cols = (lastView && lastView.cols) || 7;
  connectUi.focusedCol = Math.max(0, Math.min(cols - 1, c));
  connectUpdateAim();
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

function connectEnsureStage(v) {
  const rows = v.rows || 6;
  const cols = v.cols || 7;
  const key = `${rows}x${cols}`;
  const board = $('connectBoard');
  const zones = $('connectZones');
  if (!board || !zones) return;
  if (connectUi.builtFor === key && connectUi.cells.length === rows) return;

  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  zones.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  board.innerHTML = '';
  zones.innerHTML = '';
  connectUi.cells = [];
  for (let r = 0; r < rows; r++) {
    const rowCells = [];
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'connect-cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Empty slot, column ${c + 1}`);
      board.appendChild(cell);
      rowCells.push({ el: cell, token: null, owner: null });
    }
    connectUi.cells.push(rowCells);
  }
  // Hit zones span the full column (tray included), are built once, and
  // survive every poll render - so a tap can never lose its target to a
  // mid-gesture DOM rebuild.
  for (let c = 0; c < cols; c++) {
    const zone = document.createElement('button');
    zone.type = 'button';
    zone.className = 'cf-zone';
    zone.setAttribute('aria-label', `Drop disc in column ${c + 1}`);
    zone.addEventListener('pointerenter', () => connectSetFocus(c));
    zone.addEventListener('pointerdown', () => connectSetFocus(c));
    zone.addEventListener('click', () => dropConnectDisc(c));
    zones.appendChild(zone);
  }
  const winline = $('connectWinLine');
  if (winline) {
    winline.setAttribute('viewBox', `0 0 ${cols * 100} ${rows * 100}`);
    winline.classList.remove('on', 'you', 'opponent');
  }
  connectUi.builtFor = key;
}

function connectUpdateAim() {
  const v = lastView;
  const d = connectLastData;
  if (!v || v.ui !== 'connectfour' || !d || !connectUi.cells.length) return;
  const rows = v.rows || 6;
  const cols = v.cols || 7;
  const focused = connectUi.focusedCol;
  const yourTurn = !!(session && v.phase === 'battle' && v.turn === d.you);
  const canDrop = yourTurn && (v.legalMoves || []).includes(focused);
  const tone = canDrop ? connectColumnTone(v, focused, d) : { kind: 'idle' };
  const previewRow = canDrop ? connectDropRow(v, focused) : -1;

  const tray = $('connectTray');
  const aimer = $('connectAimer');
  const badge = $('connectAimerBadge');
  if (tray) tray.classList.toggle('idle', !yourTurn);
  if (aimer) {
    aimer.style.setProperty('--cf-col', String(focused));
    aimer.classList.toggle('blocked', yourTurn && !canDrop);
    aimer.classList.toggle('hint-win', tone.kind === 'win');
    aimer.classList.toggle('hint-block', tone.kind === 'block');
  }
  if (badge) badge.textContent = tone.kind === 'win' ? 'Drop to win' : tone.kind === 'block' ? 'Block them' : '';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = connectUi.cells[r][c];
      if (!cell) continue;
      const preview = r === previewRow && c === focused;
      cell.el.classList.toggle('lit', canDrop && c === focused && !cell.owner);
      cell.el.classList.toggle('preview', preview);
      cell.el.classList.toggle('danger', preview && tone.kind === 'block');
      cell.el.classList.toggle('hot', preview && tone.kind === 'win');
    }
  }
  connectUpdateBanner();
}

function connectUpdateBanner() {
  const v = lastView;
  const d = connectLastData;
  const banner = $('connectStatus');
  if (!banner || !v || v.ui !== 'connectfour' || !d) return;
  let desired;
  let text;
  if (v.phase === 'over') {
    if (connectAnimBusy()) return; // hold the old line until the last disc lands
    const tied = !v.winner;
    const won = v.winner === d.you;
    desired = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
    text = tied ? 'DRAW - the grid is full' : won ? 'VICTORY - four connected' : 'DEFEAT - rival connected four';
  } else if (session && v.turn === d.you) {
    const legal = v.legalMoves || [];
    const winningDrops = legal.filter(c => connectColumnTone(v, c, d).kind === 'win');
    const blocks = legal.filter(c => connectColumnTone(v, c, d).kind === 'block');
    desired = 'status you';
    if (winningDrops.length) text = `YOUR DROP - win in column ${winningDrops[0] + 1}`;
    else if (blocks.length) text = `YOUR DROP - block column ${blocks[0] + 1}`;
    else text = `YOUR DROP - column ${connectUi.focusedCol + 1}`;
  } else {
    desired = 'status them';
    text = `OPPONENT TURN - ${d.opponentName || 'Opponent'}`;
  }
  if (banner.classList.contains('activity')) desired += ' activity';
  if (banner.className !== desired) banner.className = desired;
  if (banner.textContent !== text) banner.textContent = text;
}

function connectGravityMs(distance) {
  return Math.sqrt((2 * Math.max(distance, 0.5)) / 4200) * 1000;
}

function connectBuildDrop(distance, tile) {
  const accel = 'cubic-bezier(.34,0,.72,.38)';
  const decel = 'cubic-bezier(.28,.62,.66,1)';
  const fall = Math.max(140, Math.min(560, Math.round(connectGravityMs(distance))));
  const b1 = Math.min(distance * 0.16, tile * 0.42);
  const b2 = b1 * 0.34;
  const t1 = Math.min(200, Math.max(60, connectGravityMs(b1)));
  const t2 = Math.min(140, Math.max(45, connectGravityMs(b2)));
  const total = fall + 2 * t1 + 2 * t2 + 70;
  const at = ms => Math.min(1, ms / total);
  const keyframes = [
    { transform: `translateY(${-distance}px) scale(1, 1)`, easing: accel, offset: 0 },
    { transform: 'translateY(0) scale(1.07, .9)', easing: decel, offset: at(fall) },
    { transform: `translateY(${-b1}px) scale(1, 1)`, easing: accel, offset: at(fall + t1) },
    { transform: 'translateY(0) scale(1.04, .95)', easing: decel, offset: at(fall + 2 * t1) },
    { transform: `translateY(${-b2}px) scale(1, 1)`, easing: accel, offset: at(fall + 2 * t1 + t2) },
    { transform: 'translateY(0) scale(1.015, .985)', easing: decel, offset: at(fall + 2 * t1 + 2 * t2) },
    { transform: 'translateY(0) scale(1, 1)', offset: 1 },
  ];
  return { keyframes, total: Math.round(total), fall };
}

function connectImpactFx(gen, entry, d) {
  if (connectUi.generation !== gen) return;
  if (!lastView || lastView.ui !== 'connectfour') return;
  connectSfx('land');
  battleVibrate(entry.by === d.you ? 12 : 8);
  const banner = $('connectStatus');
  if (banner) { banner.classList.remove('activity'); void banner.offsetWidth; banner.classList.add('activity'); }
  const shell = $('connectShell');
  if (shell && shell.animate) {
    shell.animate([
      { transform: 'translateY(0)' },
      { transform: 'translateY(3px)' },
      { transform: 'translateY(0)' },
    ], { duration: 120, easing: 'ease-out' });
  }
}

function connectStartDrop(token, drop, gen, entry, d) {
  token.style.visibility = '';
  if (!token.animate) { connectImpactFx(gen, entry, d); return; }
  token.style.transformOrigin = '50% 100%';
  const anim = token.animate(drop.keyframes, { duration: drop.total, easing: 'linear', fill: 'both' });
  anim.onfinish = () => { try { anim.cancel(); } catch {} };
  setTimeout(() => connectImpactFx(gen, entry, d), Math.round(drop.fall));
}

function connectQueueDrops(entries, d) {
  const viewport = $('connectViewport');
  const gen = connectUi.generation;
  const reveal = entry => {
    const cell = connectUi.cells[entry.r] && connectUi.cells[entry.r][entry.c];
    if (cell && cell.token) cell.token.style.visibility = '';
  };
  const viewRect = viewport ? viewport.getBoundingClientRect() : null;
  if (!viewRect || !viewRect.height || connectMotionOff()) {
    entries.forEach(reveal);
    if (entries.length) { connectSfx('land'); battleVibrate(10); }
    return;
  }
  let delay = 40;
  for (const entry of entries) {
    const cell = connectUi.cells[entry.r] && connectUi.cells[entry.r][entry.c];
    if (!cell || !cell.token) continue;
    const token = cell.token;
    const cellRect = cell.el.getBoundingClientRect();
    const tile = cellRect.height || 1;
    const distance = Math.max(cellRect.top - viewRect.top + tile, tile * 0.8);
    const drop = connectBuildDrop(distance, tile);
    setTimeout(() => {
      if (connectUi.generation !== gen) return;
      if (cell.token !== token) return;
      connectStartDrop(token, drop, gen, entry, d);
    }, delay);
    delay += drop.total + 130;
  }
  connectUi.animUntil = Date.now() + delay + 240;
  clearTimeout(connectUi.finishTimer);
  connectUi.finishTimer = setTimeout(() => {
    if (connectUi.generation !== gen) return;
    if (connectLastData && lastView && lastView.ui === 'connectfour') renderConnectFour(connectLastData, lastView);
  }, delay + 250);
}

function connectPlayWinFx(d, v) {
  const key = (v.winningCells || []).join('|');
  if (!key || connectUi.winFxKey === key) return;
  connectUi.winFxKey = key;
  const winnerIsYou = v.winner === d.you;
  const shell = $('connectShell');
  if (shell) shell.classList.add(winnerIsYou ? 'win-you' : 'win-opp');

  const points = (v.winningCells || [])
    .map(k => k.split(',').map(Number))
    .filter(([r, c]) => Number.isFinite(r) && Number.isFinite(c))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 2) return;
  points.forEach(([r, c], i) => {
    const cell = connectUi.cells[r] && connectUi.cells[r][c];
    if (cell && cell.token && cell.token.animate && !connectMotionOff()) {
      cell.token.animate([
        { filter: 'brightness(1)' },
        { filter: 'brightness(2)' },
        { filter: 'brightness(1)' },
      ], { duration: 320, delay: i * 90, easing: 'ease-out' });
    }
  });

  const line = $('connectWinLine');
  const glow = $('connectWinGlow');
  const core = $('connectWinCore');
  if (!line || !glow || !core) return;
  const [r1, c1] = points[0];
  const [r2, c2] = points[points.length - 1];
  const x1 = c1 * 100 + 50, y1 = r1 * 100 + 50, x2 = c2 * 100 + 50, y2 = r2 * 100 + 50;
  [glow, core].forEach(el => {
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  });
  line.classList.remove('you', 'opponent');
  line.classList.add('on', winnerIsYou ? 'you' : 'opponent');
  const len = Math.hypot(x2 - x1, y2 - y1) + 1;
  [glow, core].forEach((el, i) => {
    el.style.strokeDasharray = String(len);
    if (el.animate && !connectMotionOff()) {
      el.style.strokeDashoffset = '0';
      el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: 460, delay: 320 + i * 40, easing: 'ease-out', fill: 'backwards' });
    } else {
      el.style.strokeDashoffset = '0';
    }
  });
}

function connectUpdateEnd(d, v) {
  const end = $('connectEndBanner');
  const shell = $('connectShell');
  const winline = $('connectWinLine');
  if (v.phase !== 'over') {
    if (end) end.classList.add('hidden');
    if (shell) shell.classList.remove('win-you', 'win-opp');
    if (winline) winline.classList.remove('on', 'you', 'opponent');
    connectUi.overFxDone = false;
    connectUi.winFxKey = '';
    return;
  }
  if (connectAnimBusy()) return; // let the winning disc land before the fanfare
  const tied = !v.winner;
  const won = v.winner === d.you;
  if (end) {
    end.className = 'connect-end ' + (tied ? 'draw' : won ? 'win' : 'lose');
    if ($('connectEndTitle')) $('connectEndTitle').textContent = tied ? 'Draw' : won ? 'Victory' : 'Defeat';
    if ($('connectEndSub')) $('connectEndSub').textContent = tied ? 'No lanes left' : 'Four in a row';
  }
  if (!connectUi.overFxDone) {
    battleSfx(tied ? 'miss' : won ? 'win' : 'lose');
    battleVibrate(tied ? 18 : [18, 55, 18]);
    connectUi.overFxDone = true;
  }
  if (v.winner && (v.winningCells || []).length) connectPlayWinFx(d, v);
}

function renderConnectFour(d, v) {
  connectLastData = d;
  connectEnsureStage(v);
  if (!connectUi.cells.length) return;
  const rows = v.rows || 6;
  const cols = v.cols || 7;
  const opponentSlot = connectOpponentSlot(d);
  const opponentName = d.opponentName || 'Opponent';
  applySeatSigils(d);
  const legal = v.legalMoves || [];
  const yourTurn = v.phase === 'battle' && v.turn === d.you;

  if (connectUi.focusedCol >= cols) connectUi.focusedCol = Math.floor(cols / 2);
  if (yourTurn && legal.length && !legal.includes(connectUi.focusedCol)) {
    connectUi.focusedCol = legal.includes(Math.floor(cols / 2)) ? Math.floor(cols / 2) : legal[0];
  }

  const youPanel = $('connectYouPanel');
  const opponentPanel = $('connectOpponentPanel');
  const turnBadge = $('connectTurnBadge');
  if (youPanel) youPanel.className = `connect-player you${v.phase === 'battle' && v.turn === d.you ? ' active' : ''}`;
  if (opponentPanel) opponentPanel.className = `connect-player opponent${v.phase === 'battle' && v.turn === opponentSlot ? ' active' : ''}`;
  if ($('connectYouName')) $('connectYouName').textContent = d.youName || 'You';
  if ($('connectOpponentName')) $('connectOpponentName').textContent = opponentName;
  if (turnBadge) turnBadge.className = `connect-turn${v.phase === 'battle' && v.turn !== d.you ? ' opponent' : ''}`;
  if ($('connectTurnText')) $('connectTurnText').textContent = v.phase === 'over' ? 'Done' : v.turn === d.you ? 'You' : 'Them';

  // moves that arrived since the last paint fall in with the drop animation
  const latest = v.moveNumber || 0;
  let fresh = [];
  if (connectUi.seeded && latest > connectUi.lastMoveNumber) {
    fresh = (v.moveLog || []).filter(entry => entry.n > connectUi.lastMoveNumber);
    if (!fresh.length && v.lastMove) fresh = [{ n: latest, by: v.lastMove.by, r: v.lastMove.r, c: v.lastMove.c }];
    if (fresh.length > 3) fresh = fresh.slice(-3); // snap a long backlog, animate the tail
  }
  const freshKeys = new Set(fresh.map(entry => `${entry.r},${entry.c}`));

  const winning = new Set(v.winningCells || []);
  const lastKey = v.lastMove ? `${v.lastMove.r},${v.lastMove.c}` : null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = connectUi.cells[r][c];
      const owner = (v.board[r] && v.board[r][c]) || null;
      const key = `${r},${c}`;
      if (owner !== cell.owner) {
        if (cell.token) { cell.token.remove(); cell.token = null; }
        if (owner) {
          const token = document.createElement('span');
          token.className = `cf-disc connect-token ${owner === d.you ? 'you' : 'opponent'}`;
          if (freshKeys.has(key)) token.style.visibility = 'hidden'; // revealed when its drop starts
          cell.el.appendChild(token);
          cell.token = token;
        }
        cell.owner = owner;
        cell.el.setAttribute('aria-label', owner ? `${owner === d.you ? 'Your' : opponentName} disc` : `Empty slot, column ${c + 1}`);
      }
      cell.el.classList.toggle('last', key === lastKey && !winning.size);
      cell.el.classList.toggle('win', winning.has(key));
    }
  }

  if (fresh.length) connectQueueDrops(fresh, d);
  connectUi.lastMoveNumber = Math.max(connectUi.lastMoveNumber, latest);
  connectUi.seeded = true;

  connectUpdateAim();
  connectUpdateEnd(d, v);
}

async function dropConnectDisc(c) {
  if (!lastView || lastView.ui !== 'connectfour' || !session) return;
  if (lastView.phase !== 'battle') return;
  if (lastView.turn !== session.you) { toast('Not your turn.'); return; }
  if (!(lastView.legalMoves || []).includes(c)) { toast('That column is full.'); return; }
  if (connectUi.sending) return;
  connectUi.sending = true;
  connectSetFocus(c);
  connectSfx('release');
  battleVibrate(10);
  try {
    await api('/api/move', 'POST', { room: session.room, move: { c } });
    await poll();
  } catch (e) {
    toast(e.message);
  } finally {
    connectUi.sending = false;
  }
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetConnectFourUi() {
  $('connectBoard').innerHTML = '';
  if ($('connectZones')) $('connectZones').innerHTML = '';
  if ($('connectWinLine')) $('connectWinLine').classList.remove('on', 'you', 'opponent');
  if ($('connectShell')) $('connectShell').classList.remove('win-you', 'win-opp');
  if ($('connectTray')) $('connectTray').classList.add('idle');
  connectUi = freshConnectUi();
  connectLastData = null;
  if ($('connectEndBanner')) $('connectEndBanner').classList.add('hidden');
}
