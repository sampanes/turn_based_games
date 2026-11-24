// Checkers screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let ckUi = { lastMoveNumber: 0, seen: false, domSig: '', overFxDone: false, selected: null, d: null };

function ckSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'jump') {
    battleTone(audio, t, 300, 0.09, { type: 'triangle', gain: 0.08, slideTo: 180 });
    battleNoise(audio, t + 0.05, 0.08, { freq: 1400, gain: 0.07 });
  } else if (kind === 'crown') {
    [660, 880, 1100].forEach((freq, i) => battleTone(audio, t + i * 0.07, freq, 0.14, { type: 'triangle', gain: 0.06 }));
  } else {
    battleTone(audio, t, 420, 0.06, { type: 'triangle', gain: 0.06 });
  }
}

function renderCheckers(d, v) {
  const size = v.size || 8;
  const board = $('ckBoard');
  const rival = rivalSlot(d);
  const rivalName = seatName(d, rival);
  const counts = v.counts || { A: 0, B: 0 };
  const mine = counts[d.you] || 0;
  const theirs = counts[rival] || 0;
  const last = v.lastMove;
  const over = v.phase === 'over';
  const newMove = ckUi.seen && (v.moveNumber || 0) > ckUi.lastMoveNumber;
  // Each player sees their own pieces at the bottom; B's board is A's turned around.
  const turned = d.you === 'B';
  ckUi.d = d;

  applySeatSigils(d);
  $('ckYouName').textContent = d.youName || 'You';
  $('ckOpponentName').textContent = rivalName;
  $('ckYouScore').textContent = mine;
  $('ckOpponentScore').textContent = theirs;
  $('ckTurnText').textContent = over ? 'Done' : v.turn === d.you ? 'You' : rivalName;
  $('ckTurn').classList.toggle('opponent', !over && v.turn !== d.you);
  $('ckProgress').textContent = v.mustJump ? 'Must jump' : `Move ${(v.moveNumber || 0) + (over ? 0 : 1)}`;

  const moves = v.isMyTurn ? (v.moves || []) : [];
  const movable = new Set(moves.map(move => move.from));
  if (!v.isMyTurn) ckUi.selected = null;
  else if (v.chain != null) ckUi.selected = v.chain;
  else if (ckUi.selected != null && !movable.has(ckUi.selected)) ckUi.selected = null;
  if (v.isMyTurn && ckUi.selected == null && movable.size === 1) ckUi.selected = [...movable][0];
  const dests = new Map(moves.filter(move => move.from === ckUi.selected).map(move => [move.to, move]));

  // Rebuilding on every poll would destroy the square under a finger mid-tap.
  const domSig = JSON.stringify([d.you, v.board, v.moveNumber, v.isMyTurn, ckUi.selected]);
  if (domSig !== ckUi.domSig) {
    board.innerHTML = '';
    for (let place = 0; place < size * size; place++) {
      const idx = turned ? size * size - 1 - place : place;
      const row = Math.floor(idx / size);
      const col = idx % size;
      if ((row + col) % 2 === 0) {
        const light = document.createElement('div');
        light.className = 'sq-cell ck-light';
        board.appendChild(light);
        continue;
      }
      const piece = v.board[idx];
      const owner = piece ? piece.toUpperCase() : null;
      const king = !!piece && piece === owner;
      const dest = dests.get(idx);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sq-cell ck-cell'
        + (movable.has(idx) ? ' can' : '')
        + (ckUi.selected === idx ? ' sel' : '')
        + (dest ? ' dest' : '')
        + (dest && dest.capture != null ? ' jump' : '')
        + (last && (last.from === idx || last.to === idx) ? ' last' : '');
      cell.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}: `
        + (piece ? `${owner === d.you ? 'your' : `${rivalName}'s`} ${king ? 'king' : 'man'}` : dest ? 'move here' : 'empty'));
      if (newMove && last && last.capture === idx) {
        const ghost = document.createElement('span');
        ghost.className = 'cf-disc ck-ghost ' + (last.by === d.you ? 'opponent' : 'you');
        cell.appendChild(ghost);
      }
      if (piece) {
        const disc = document.createElement('span');
        disc.className = `cf-disc ${owner === d.you ? 'you' : 'opponent'}` + (king ? ' ck-king' : '');
        if (king) {
          const crown = document.createElement('i');
          crown.className = 'ck-crown' + (newMove && last && last.to === idx && last.crowned ? ' fresh' : '');
          crown.textContent = 'K';
          disc.appendChild(crown);
        }
        if (newMove && last && last.to === idx) {
          const turn = turned ? -1 : 1;
          disc.classList.add('ck-slide');
          disc.style.setProperty('--dx', (last.from % size - col) * turn);
          disc.style.setProperty('--dy', (Math.floor(last.from / size) - row) * turn);
        }
        cell.appendChild(disc);
      }
      if (dest) cell.onclick = () => moveChecker(dest.from, dest.to);
      else if (movable.has(idx)) cell.onclick = () => selectChecker(idx);
      else if (v.isMyTurn && owner === d.you) cell.onclick = () => toast(v.chain != null ? 'Keep jumping with the same piece.' : v.mustJump ? 'You have a jump and must take it.' : 'That piece has nowhere to go.');
      else cell.disabled = true;
      board.appendChild(cell);
    }
  }

  const banner = $('ckStatus');
  const end = $('ckEndBanner');
  if (over) {
    const tied = v.winner === 'draw' || !v.winner;
    const won = v.winner === d.you;
    const wiped = (won ? theirs : mine) === 0;
    banner.className = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - forty quiet moves each'
      : won ? (wiped ? 'VICTORY - every piece captured' : `VICTORY - ${rivalName} has no move left`)
      : (wiped ? 'DEFEAT - all your pieces are gone' : 'DEFEAT - you have no move left');
    end.className = 'dots-end ' + (tied ? 'draw' : won ? 'win' : 'lose');
    $('ckEndTitle').textContent = tied ? 'Draw' : won ? 'Victory' : 'Defeat';
    $('ckEndSub').textContent = `${mine} to ${theirs} pieces left`;
    if (!ckUi.overFxDone) {
      battleSfx(tied ? 'miss' : won ? 'win' : 'lose');
      battleVibrate(tied ? 18 : [18, 55, 18]);
      ckUi.overFxDone = true;
    }
  } else {
    end.classList.add('hidden');
    ckUi.overFxDone = false;
    if (v.isMyTurn) {
      banner.className = 'status you';
      banner.textContent = v.chain != null ? 'KEEP JUMPING - same piece'
        : v.mustJump ? 'YOUR MOVE - you must jump'
        : ckUi.selected != null ? 'YOUR MOVE - pick a square' : 'YOUR MOVE - pick a piece';
    } else {
      banner.className = 'status them';
      banner.textContent = `Standing by - ${rivalName} is moving...`;
    }
  }

  if (!last) {
    $('ckLast').textContent = 'Men move forward on the dark squares. A jump must be taken.';
  } else {
    const actor = last.by === d.you ? 'You' : rivalName;
    $('ckLast').textContent = `${actor} ${last.capture != null ? 'jumped a piece' : 'moved'}${last.crowned ? ' and crowned a king' : ''}.`;
  }

  if (newMove && last) {
    ckSfx(last.crowned ? 'crown' : last.capture != null ? 'jump' : 'move');
    battleVibrate(last.capture != null ? [10, 30, 10] : 8);
  }
  ckUi.lastMoveNumber = v.moveNumber || 0;
  ckUi.seen = true;
  ckUi.domSig = domSig;
}

function selectChecker(idx) {
  if (!lastView || lastView.ui !== 'checkers' || !lastView.isMyTurn || lastView.chain != null) return;
  ckUi.selected = ckUi.selected === idx ? null : idx;
  battleVibrate(6);
  renderCheckers(ckUi.d, lastView);
}

async function moveChecker(from, to) {
  if (!lastView || lastView.ui !== 'checkers' || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  mncEnsureAudio();
  ckUi.selected = null;
  await postMove({ from, to });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetCheckersUi() {
  if ($('ckBoard')) $('ckBoard').innerHTML = '';
  if ($('ckEndBanner')) $('ckEndBanner').classList.add('hidden');
  ckUi = { lastMoveNumber: 0, seen: false, domSig: '', overFxDone: false, selected: null, d: null };
}
