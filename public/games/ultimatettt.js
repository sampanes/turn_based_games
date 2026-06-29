(function () {
  'use strict';

  const EMPTY = 0, X = 1, O = 2, DRAW = 3;
  const WIN_PATTERNS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  function getMiniIndices(mini) {
    const br = Math.floor(mini / 3) * 3, bc = (mini % 3) * 3;
    const out = [];
    for (let lr = 0; lr < 3; lr++) for (let lc = 0; lc < 3; lc++) out.push((br + lr) * 9 + bc + lc);
    return out;
  }
  function checkMiniWin(cells) {
    for (const [a, b, c] of WIN_PATTERNS) {
      const v = cells[a];
      if (v !== EMPTY && v !== DRAW && cells[b] === v && cells[c] === v) return v;
    }
    return cells.every(c => c !== EMPTY) ? DRAW : EMPTY;
  }
  function getMiniIndex(idx) {
    const r = Math.floor(idx / 9), c = idx % 9;
    return Math.floor(r / 3) * 3 + Math.floor(c / 3);
  }
  function getNextMini(idx) {
    return (Math.floor(idx / 9) % 3) * 3 + (idx % 9) % 3;
  }
  function validMoves(board, lastMove, miniWinners) {
    const free = () => board.reduce((a, v, i) => { if (v === EMPTY && miniWinners[getMiniIndex(i)] === EMPTY) a.push(i); return a; }, []);
    if (lastMove === null) return free();
    const next = getNextMini(lastMove);
    if (miniWinners[next] !== EMPTY) return free();
    return getMiniIndices(next).filter(i => board[i] === EMPTY);
  }
  function checkUltimateWin(miniWinners) {
    for (const [a, b, c] of WIN_PATTERNS) {
      const v = miniWinners[a];
      if (v !== EMPTY && v !== DRAW && miniWinners[b] === v && miniWinners[c] === v) return v;
    }
    return miniWinners.every(w => w !== EMPTY) ? DRAW : null;
  }
  function simPlace(board, miniWinners, idx, piece) {
    const b2 = board.slice(), mw2 = miniWinners.slice();
    b2[idx] = piece;
    const mi = getMiniIndex(idx);
    const mr = checkMiniWin(getMiniIndices(mi).map(i => b2[i]));
    if (mr !== EMPTY) mw2[mi] = mr;
    return { board: b2, miniWinners: mw2 };
  }

  const ultimatettt = {
    meta: {
      id: 'ultimatettt',
      name: 'Ultimate Tic-Tac-Toe',
      description: 'Win three mini-boards in a row. Your move sends your opponent to a specific board.',
      supportsComputer: true,
      ui: 'ultimatettt',
    },

    init() {
      return {
        board: new Array(81).fill(EMPTY),
        miniWinners: new Array(9).fill(EMPTY),
        lastMove: null,
        winner: null,
        phase: 'battle',
        turn: 'A',
      };
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    applyMove(state, who, move) {
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';
      const idx = move && Number.isInteger(move.idx) ? move.idx : parseInt(move && move.idx, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx > 80) return 'Invalid cell index.';
      const valid = validMoves(state.board, state.lastMove, state.miniWinners);
      if (!valid.includes(idx)) return 'That cell is not a legal move.';

      const piece = who === 'A' ? X : O;
      state.board[idx] = piece;
      state.lastMove = idx;

      const mi = getMiniIndex(idx);
      const mr = checkMiniWin(getMiniIndices(mi).map(i => state.board[i]));
      if (mr !== EMPTY) state.miniWinners[mi] = mr;

      const ult = checkUltimateWin(state.miniWinners);
      if (ult !== null) {
        state.phase = 'over';
        state.winner = ult === DRAW ? 'draw' : (ult === X ? 'A' : 'B');
      } else {
        state.turn = who === 'A' ? 'B' : 'A';
      }
      return null;
    },

    viewFor(state, who) {
      const myTurn = state.phase === 'battle' && state.turn === who;
      const valid = myTurn ? validMoves(state.board, state.lastMove, state.miniWinners) : [];
      let activeMini = -1;
      if (state.phase === 'battle' && state.lastMove !== null) {
        const next = getNextMini(state.lastMove);
        activeMini = state.miniWinners[next] === EMPTY ? next : -1;
      }
      return {
        ui: 'ultimatettt',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        board: state.board.slice(),
        miniWinners: state.miniWinners.slice(),
        lastMove: state.lastMove,
        isMyTurn: myTurn,
        validMoves: valid,
        activeMini,
        myPiece: who === 'A' ? 'X' : 'O',
      };
    },

    computerMove(state, who) {
      const myPiece = who === 'A' ? X : O;
      const oppPiece = who === 'A' ? O : X;
      const valid = validMoves(state.board, state.lastMove, state.miniWinners);
      if (!valid.length) return null;

      const winsGame = (idx, piece) => {
        const { miniWinners: mw } = simPlace(state.board, state.miniWinners, idx, piece);
        return checkUltimateWin(mw) === piece;
      };
      const winsMini = (idx, piece) => {
        if (state.miniWinners[getMiniIndex(idx)] !== EMPTY) return false;
        const { board: b2 } = simPlace(state.board, state.miniWinners, idx, piece);
        return checkMiniWin(getMiniIndices(getMiniIndex(idx)).map(i => b2[i])) === piece;
      };

      for (const idx of valid) if (winsGame(idx, myPiece)) return { idx };
      for (const idx of valid) if (winsGame(idx, oppPiece)) return { idx };
      for (const idx of valid) if (winsMini(idx, myPiece)) return { idx };
      for (const idx of valid) if (winsMini(idx, oppPiece)) return { idx };
      return { idx: valid[Math.floor(Math.random() * valid.length)] };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ultimatettt;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...ultimatettt.meta, module: ultimatettt });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.ultimatettt = ultimatettt;
    }
  }
})();
