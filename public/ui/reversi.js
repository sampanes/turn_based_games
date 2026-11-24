// Reversi screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let rvUi = { lastMoveNumber: 0, seen: false, domSig: '', overFxDone: false };

function rvSfx(flips) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  battleTone(audio, t, 520, 0.07, { type: 'triangle', gain: 0.06 });
  for (let i = 0; i < Math.min(flips, 8); i++) battleTone(audio, t + 0.09 + i * 0.05, 700 + i * 60, 0.05, { type: 'triangle', gain: 0.035 });
}

function renderReversi(d, v) {
  const size = v.size || 8;
  const board = $('rvBoard');
  const rival = rivalSlot(d);
  const rivalName = seatName(d, rival);
  const counts = v.counts || { A: 0, B: 0 };
  const mine = counts[d.you] || 0;
  const theirs = counts[rival] || 0;
  const last = v.lastMove;
  const over = v.phase === 'over';
  const newMove = rvUi.seen && (v.moveNumber || 0) > rvUi.lastMoveNumber;

  applySeatSigils(d);
  $('rvYouName').textContent = d.youName || 'You';
  $('rvOpponentName').textContent = rivalName;
  $('rvYouScore').textContent = mine;
  $('rvOpponentScore').textContent = theirs;
  $('rvProgress').textContent = `${mine + theirs}/${size * size}`;
  $('rvTurnText').textContent = over ? 'Done' : v.turn === d.you ? 'You' : rivalName;
  $('rvTurn').classList.toggle('opponent', !over && v.turn !== d.you);

  const valid = new Map((v.validMoves || []).map(move => [move.idx, move.flips]));
  // Rebuilding on every poll would destroy the square under a finger mid-tap.
  const domSig = JSON.stringify([d.you, v.board, [...valid.keys()], v.moveNumber]);
  if (domSig !== rvUi.domSig) {
    board.innerHTML = '';
    const flipped = new Set(newMove && last ? last.flips : []);
    const lastRow = last ? Math.floor(last.idx / size) : 0;
    const lastCol = last ? last.idx % size : 0;
    for (let idx = 0; idx < size * size; idx++) {
      const row = Math.floor(idx / size);
      const col = idx % size;
      const owner = v.board[idx];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sq-cell rv-cell' + (valid.has(idx) ? ' valid' : '') + (last && last.idx === idx ? ' last' : '');
      cell.disabled = !valid.has(idx);
      cell.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}: `
        + (owner ? (owner === d.you ? 'your disc' : `${rivalName}'s disc`) : valid.has(idx) ? `open, flips ${valid.get(idx)}` : 'empty'));
      if (owner) {
        const side = owner === d.you ? 'you' : 'opponent';
        const disc = document.createElement('span');
        if (flipped.has(idx)) {
          // The old color turns edge-on, then the new one turns to face you; discs
          // further from the one just placed turn later.
          const wait = Math.max(Math.abs(row - lastRow), Math.abs(col - lastCol));
          const old = document.createElement('span');
          old.className = 'cf-disc rv-out ' + (side === 'you' ? 'opponent' : 'you');
          old.style.setProperty('--i', wait);
          cell.appendChild(old);
          disc.className = `cf-disc rv-in ${side}`;
          disc.style.setProperty('--i', wait);
        } else {
          disc.className = `cf-disc ${side}` + (newMove && last && last.idx === idx ? ' rv-new' : '');
        }
        cell.appendChild(disc);
      }
      if (valid.has(idx)) cell.onclick = () => placeReversiDisc(idx);
      board.appendChild(cell);
    }
  }

  const banner = $('rvStatus');
  const end = $('rvEndBanner');
  if (over) {
    const tied = v.winner === 'draw' || !v.winner;
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
    banner.textContent = tied ? 'DRAW - the board is split' : won ? 'VICTORY - most discs are yours' : `DEFEAT - ${rivalName} holds more discs`;
    end.className = 'dots-end ' + (tied ? 'draw' : won ? 'win' : 'lose');
    $('rvEndTitle').textContent = tied ? 'Draw' : won ? 'Victory' : 'Defeat';
    $('rvEndSub').textContent = `${mine} to ${theirs}`;
    if (!rvUi.overFxDone) {
      battleSfx(tied ? 'miss' : won ? 'win' : 'lose');
      battleVibrate(tied ? 18 : [18, 55, 18]);
      rvUi.overFxDone = true;
    }
  } else {
    end.classList.add('hidden');
    rvUi.overFxDone = false;
    const passed = !!(last && last.passed);
    if (v.turn === d.you) {
      banner.className = 'status you';
      banner.textContent = passed ? `${rivalName} has no move - go again` : 'YOUR MOVE - trap their discs';
    } else {
      banner.className = 'status them';
      banner.textContent = passed ? `No move for you - ${rivalName} goes again` : `Standing by - ${rivalName} is choosing a square...`;
    }
  }

  if (!last) {
    $('rvLast').textContent = 'Place a disc so a line of theirs is trapped between two of yours.';
  } else {
    const count = last.flips.length;
    $('rvLast').textContent = `${last.by === d.you ? 'You' : rivalName} flipped ${count} disc${count === 1 ? '' : 's'}.`;
  }

  if (newMove && last) {
    rvSfx(last.flips.length);
    battleVibrate(last.by === d.you ? 8 : 14);
  }
  rvUi.lastMoveNumber = v.moveNumber || 0;
  rvUi.seen = true;
  rvUi.domSig = domSig;
}

async function placeReversiDisc(idx) {
  if (!lastView || lastView.ui !== 'reversi' || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  mncEnsureAudio();
  await postMove({ idx });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetReversiUi() {
  if ($('rvBoard')) $('rvBoard').innerHTML = '';
  if ($('rvEndBanner')) $('rvEndBanner').classList.add('hidden');
  rvUi = { lastMoveNumber: 0, seen: false, domSig: '', overFxDone: false };
}
