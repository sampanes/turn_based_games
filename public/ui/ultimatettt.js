// Ultimate Tic-Tac-Toe screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
// ---------------- Ultimate TTT ----------------
let utttUi = { lastMove: null, seen: false, domSig: '' };

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

  const domSig = JSON.stringify([v.board, v.miniWinners, v.validMoves, v.lastMove, v.activeMini, v.isMyTurn]);
  const rebuild = domSig !== utttUi.domSig;
  if (rebuild) board.innerHTML = '';
  for (let mini = 0; rebuild && mini < 9; mini++) {
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
          + ' m' + ((idx + Math.floor(idx / 9)) % 3) // which of the three brushed marks this cell uses
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
  utttUi = { lastMove: v.lastMove, seen: true, domSig };

  const banner = $('utttStatus');
  if (v.phase === 'over') {
    const tied = v.winner === 'draw';
    const won = v.winner === d.you;
    banner.className = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
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
  mncEnsureAudio();
  await postMove({ idx });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetUltimateTttUi() {
  if ($('utttBoard')) $('utttBoard').innerHTML = '';
  utttUi = { lastMove: null, seen: false, domSig: '' };
}
