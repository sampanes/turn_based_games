// Dots and Boxes screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let dotsUi = { lastMoveNumber: 0, boardSig: '', domSig: '', overFxDone: false };

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

  applySeatSigils(d);
  $('dotsYouName').textContent = d.youName || 'You';
  $('dotsOpponentName').textContent = dotsPlayerName(d, opponentSlot);
  $('dotsYouScore').textContent = youScore;
  $('dotsOpponentScore').textContent = opponentScore;
  $('dotsProgress').textContent = `${youScore + opponentScore}/${total}`;
  $('dotsTurnText').textContent = v.phase === 'over' ? 'Done' : v.turn === d.you ? 'Your line' : `${dotsPlayerName(d, v.turn)} line`;

  board.style.gridTemplateColumns = Array.from({ length: cols * 2 + 1 }, (_, i) => i % 2 ? 'minmax(38px, 1fr)' : 'var(--dots-dot)').join(' ');
  board.style.gridTemplateRows = Array.from({ length: rows * 2 + 1 }, (_, i) => i % 2 ? 'minmax(38px, 1fr)' : 'var(--dots-dot)').join(' ');
  // Rebuilding every poll destroyed the edge button under a finger mid-tap.
  const domSig = JSON.stringify([rows, cols, d.you, v.edges, v.boxes, v.lastMove, [...legal]]);
  const rebuild = domSig !== dotsUi.domSig;
  if (rebuild) board.innerHTML = '';

  for (let gr = 0; rebuild && gr < rows * 2 + 1; gr++) {
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
    banner.className = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
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
  dotsUi.domSig = domSig;
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
  mncEnsureAudio();
  battleVibrate(8);
  await postMove({ type, r, c });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetDotsBoxesUi() {
  if ($('dotsBoard')) $('dotsBoard').innerHTML = '';
  dotsUi = { lastMoveNumber: 0, boardSig: '', domSig: '', overFxDone: false };
  if ($('dotsEndBanner')) $('dotsEndBanner').classList.add('hidden');
}
