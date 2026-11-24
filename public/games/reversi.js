(function () {
  'use strict';

  // 8 x 8 board, one entry per square: null, 'A' or 'B'. Square index = row * 8 + col.
  // A moves first. A disc placed must trap at least one line of the other player's
  // discs between itself and another of your own; every trapped disc flips. A player
  // with no such square misses the turn, and the game ends when neither can move.
  const SIZE = 8;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // How much a square is worth to hold: corners can never be flipped back, the squares
  // beside a corner hand it to the other player.
  const WEIGHTS = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120,
  ];

  function other(who) { return who === 'A' ? 'B' : 'A'; }

  function flipsFor(board, who, idx) {
    if (board[idx]) return [];
    const foe = other(who);
    const r0 = Math.floor(idx / SIZE);
    const c0 = idx % SIZE;
    const flips = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let r = r0 + dr;
      let c = c0 + dc;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === foe) {
        line.push(r * SIZE + c);
        r += dr;
        c += dc;
      }
      if (line.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === who) flips.push(...line);
    }
    return flips;
  }

  function legalMoves(board, who) {
    const moves = [];
    for (let idx = 0; idx < SIZE * SIZE; idx++) {
      if (board[idx]) continue;
      const flips = flipsFor(board, who, idx);
      if (flips.length) moves.push({ idx, flips });
    }
    return moves;
  }

  function place(board, who, move) {
    const next = board.slice();
    next[move.idx] = who;
    for (const idx of move.flips) next[idx] = who;
    return next;
  }

  function countDiscs(board) {
    const counts = { A: 0, B: 0 };
    for (const cell of board) if (cell) counts[cell]++;
    return counts;
  }

  // Positive is good for A.
  function evaluate(board) {
    let score = 0;
    let empties = 0;
    for (let idx = 0; idx < board.length; idx++) {
      if (board[idx] === 'A') score += WEIGHTS[idx];
      else if (board[idx] === 'B') score -= WEIGHTS[idx];
      else empties++;
    }
    if (empties > 12) score += 6 * (legalMoves(board, 'A').length - legalMoves(board, 'B').length);
    else { const counts = countDiscs(board); score += 8 * (counts.A - counts.B); }
    return score;
  }

  function finalScore(board) {
    const counts = countDiscs(board);
    return (counts.A - counts.B) * 1000;
  }

  function search(board, who, depth, alpha, beta, passed) {
    const moves = legalMoves(board, who);
    if (!moves.length) {
      if (passed) return finalScore(board);
      return search(board, other(who), depth, alpha, beta, true);
    }
    if (depth <= 0) return evaluate(board);
    // Likeliest best first (corners, then edges), so more of the rest can be skipped.
    moves.sort((x, y) => WEIGHTS[y.idx] - WEIGHTS[x.idx]);
    if (who === 'A') {
      let best = -Infinity;
      for (const move of moves) {
        best = Math.max(best, search(place(board, who, move), 'B', depth - 1, alpha, beta, false));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      best = Math.min(best, search(place(board, who, move), 'A', depth - 1, alpha, beta, false));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  function startBoard() {
    const board = Array(SIZE * SIZE).fill(null);
    board[3 * SIZE + 3] = 'B';
    board[4 * SIZE + 4] = 'B';
    board[3 * SIZE + 4] = 'A';
    board[4 * SIZE + 3] = 'A';
    return board;
  }

  const reversi = {
    meta: {
      id: 'reversi',
      name: 'Reversi',
      description: 'Trap a line of their discs between two of yours to flip them. Most discs wins.',
      supportsComputer: true,
      ui: 'reversi',
    },

    init() {
      return {
        board: startBoard(),
        phase: 'battle',
        turn: 'A',
        winner: null,
        lastMove: null,
        moveNumber: 0,
      };
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    applyMove(state, who, move) {
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';
      const idx = move && Number.isInteger(move.idx) ? move.idx : parseInt(move && move.idx, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= SIZE * SIZE) return 'Invalid move.';
      if (state.board[idx]) return 'That square is taken.';
      const flips = flipsFor(state.board, who, idx);
      if (!flips.length) return 'A disc there flips nothing.';

      state.board = place(state.board, who, { idx, flips });
      state.moveNumber = (state.moveNumber || 0) + 1;
      const foe = other(who);
      // passed: the other player had nowhere to go, so the mover goes again.
      let passed = false;
      if (legalMoves(state.board, foe).length) {
        state.turn = foe;
      } else if (legalMoves(state.board, who).length) {
        passed = true;
      } else {
        const counts = countDiscs(state.board);
        state.winner = counts.A > counts.B ? 'A' : counts.B > counts.A ? 'B' : 'draw';
        state.phase = 'over';
      }
      state.lastMove = { n: state.moveNumber, by: who, idx, flips, passed };
      return null;
    },

    viewFor(state, who) {
      const isMyTurn = state.phase === 'battle' && state.turn === who;
      return {
        ui: 'reversi',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        size: SIZE,
        board: state.board.slice(),
        counts: countDiscs(state.board),
        isMyTurn,
        validMoves: isMyTurn ? legalMoves(state.board, who).map(move => ({ idx: move.idx, flips: move.flips.length })) : [],
        myPiece: who,
        lastMove: state.lastMove,
        moveNumber: state.moveNumber || 0,
      };
    },

    // easy: half the time any legal square, otherwise the one that flips the most.
    // normal: weighs the squares and looks two moves ahead. hard: looks four moves
    // ahead and plays the last eight squares out to the end.
    computerMove(state, who, level = 'normal') {
      const moves = legalMoves(state.board, who);
      if (!moves.length) return null;
      const pick = list => list[Math.floor(Math.random() * list.length)];
      if (level === 'easy') {
        if (Math.random() < 0.5) return { idx: pick(moves).idx };
        const most = Math.max(...moves.map(move => move.flips.length));
        return { idx: pick(moves.filter(move => move.flips.length === most)).idx };
      }
      const empties = state.board.filter(cell => !cell).length;
      const depth = level === 'hard' ? (empties <= 8 ? 10 : 3) : 1;
      const sign = who === 'A' ? 1 : -1;
      let best = [];
      let bestValue = -Infinity;
      for (const move of moves) {
        const value = sign * search(place(state.board, who, move), other(who), depth, -Infinity, Infinity, false);
        if (value > bestValue) { bestValue = value; best = [move]; }
        else if (value === bestValue) best.push(move);
      }
      // Ties go to a random square so two games never play out the same way.
      return { idx: pick(best).idx };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = reversi;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...reversi.meta, module: reversi });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.reversi = reversi;
    }
  }
})();
