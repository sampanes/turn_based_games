(function () {
  'use strict';

  // 8 x 8 board, one entry per square, index = row * 8 + col. Play is on the dark squares
  // only, the ones where row + col is odd.
  //   ''  empty      'a' / 'b'  a man of A / B      'A' / 'B'  a king of A / B
  // A starts on rows 5 to 7 and moves up the board (toward row 0); B starts on rows 0 to 2
  // and moves down. A moves first.
  //
  // Rules: men step one square diagonally forward, kings in all four diagonals. A jump over
  // a neighboring enemy piece onto the empty square behind it captures it. If you can jump
  // you must, and the same piece keeps jumping while it can. A man that reaches the far row
  // becomes a king and its turn ends there. You lose when you have no piece or no move.
  // Forty moves each with no capture and no man moved is a draw.
  const SIZE = 8;
  const QUIET_LIMIT = 80;

  function other(who) { return who === 'A' ? 'B' : 'A'; }
  function ownerOf(piece) { return piece ? piece.toUpperCase() : null; }
  function isKing(piece) { return piece === 'A' || piece === 'B'; }

  function startBoard() {
    const board = Array(SIZE * SIZE).fill('');
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 0) continue;
        if (r < 3) board[r * SIZE + c] = 'b';
        else if (r > 4) board[r * SIZE + c] = 'a';
      }
    }
    return board;
  }

  function directions(piece) {
    if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return piece === 'a' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }

  function pieceMoves(board, idx, capturesOnly) {
    const piece = board[idx];
    const who = ownerOf(piece);
    const r = Math.floor(idx / SIZE);
    const c = idx % SIZE;
    const moves = [];
    for (const [dr, dc] of directions(piece)) {
      const r1 = r + dr;
      const c1 = c + dc;
      if (r1 < 0 || r1 >= SIZE || c1 < 0 || c1 >= SIZE) continue;
      const over = r1 * SIZE + c1;
      if (!board[over]) {
        if (!capturesOnly) moves.push({ from: idx, to: over, capture: null });
        continue;
      }
      if (ownerOf(board[over]) === who) continue;
      const r2 = r1 + dr;
      const c2 = c1 + dc;
      if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) continue;
      if (!board[r2 * SIZE + c2]) moves.push({ from: idx, to: r2 * SIZE + c2, capture: over });
    }
    return moves;
  }

  // chain: the square of a piece that is partway through a run of jumps, or null.
  function legalMoves(board, who, chain) {
    if (chain != null) return pieceMoves(board, chain, true).filter(move => move.capture != null);
    const jumps = [];
    const steps = [];
    for (let idx = 0; idx < board.length; idx++) {
      if (ownerOf(board[idx]) !== who) continue;
      for (const move of pieceMoves(board, idx, false)) (move.capture != null ? jumps : steps).push(move);
    }
    return jumps.length ? jumps : steps;
  }

  // Plays one step or one jump. Returns the new board, whether a man was crowned, the
  // square to keep jumping from (or null), and who moves next.
  function step(board, who, move) {
    const next = board.slice();
    let piece = next[move.from];
    next[move.from] = '';
    if (move.capture != null) next[move.capture] = '';
    const row = Math.floor(move.to / SIZE);
    const crowned = !isKing(piece) && (piece === 'a' ? row === 0 : row === SIZE - 1);
    if (crowned) piece = piece.toUpperCase();
    next[move.to] = piece;
    const chain = move.capture != null && !crowned && pieceMoves(next, move.to, true).some(m => m.capture != null) ? move.to : null;
    return { board: next, crowned, chain, turn: chain != null ? who : other(who) };
  }

  function countPieces(board) {
    const counts = { A: 0, B: 0, kingsA: 0, kingsB: 0 };
    for (const piece of board) {
      if (!piece) continue;
      counts[ownerOf(piece)]++;
      if (isKing(piece)) counts['kings' + piece]++;
    }
    return counts;
  }

  // Positive is good for A.
  function evaluate(board) {
    let score = 0;
    for (let idx = 0; idx < board.length; idx++) {
      const piece = board[idx];
      if (!piece) continue;
      const r = Math.floor(idx / SIZE);
      const c = idx % SIZE;
      const centered = c >= 2 && c <= 5 ? 3 : 0;
      if (piece === 'a') score += 100 + (7 - r) * 4 + (r === 7 ? 8 : 0) + centered;
      else if (piece === 'b') score -= 100 + r * 4 + (r === 0 ? 8 : 0) + centered;
      else if (piece === 'A') score += 175 + centered;
      else score -= 175 + centered;
    }
    return score;
  }

  function search(board, who, chain, depth, alpha, beta) {
    const moves = legalMoves(board, who, chain);
    // No move left loses; the sooner the better for the winner.
    if (!moves.length) return who === 'A' ? -100000 - depth : 100000 + depth;
    // Never stop to count pieces in the middle of an exchange.
    if (depth <= 0 && moves[0].capture == null) return evaluate(board);
    if (who === 'A') {
      let best = -Infinity;
      for (const move of moves) {
        const s = step(board, who, move);
        best = Math.max(best, search(s.board, s.turn, s.chain, depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      const s = step(board, who, move);
      best = Math.min(best, search(s.board, s.turn, s.chain, depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  const checkers = {
    meta: {
      id: 'checkers',
      name: 'Checkers',
      description: 'Jump their pieces, crown your own. Take them all or leave them no move.',
      supportsComputer: true,
      ui: 'checkers',
    },

    init() {
      return {
        board: startBoard(),
        phase: 'battle',
        turn: 'A',
        winner: null,
        chain: null,
        quiet: 0,
        lastMove: null,
        moveNumber: 0,
      };
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    applyMove(state, who, move) {
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';
      const from = move ? Number(move.from) : NaN;
      const to = move ? Number(move.to) : NaN;
      if (!Number.isInteger(from) || !Number.isInteger(to)) return 'Invalid move.';
      const moves = legalMoves(state.board, who, state.chain);
      const chosen = moves.find(m => m.from === from && m.to === to);
      if (!chosen) {
        if (state.chain != null) return 'Keep jumping with the same piece.';
        if (moves.length && moves[0].capture != null) return 'You have a jump and must take it.';
        return 'That piece cannot move there.';
      }

      const wasMan = !isKing(state.board[from]);
      const s = step(state.board, who, chosen);
      state.board = s.board;
      state.chain = s.chain;
      state.turn = s.turn;
      state.quiet = chosen.capture != null || wasMan ? 0 : (state.quiet || 0) + 1;
      state.moveNumber = (state.moveNumber || 0) + 1;
      state.lastMove = { n: state.moveNumber, by: who, from, to, capture: chosen.capture, crowned: s.crowned };

      if (!legalMoves(state.board, state.turn, state.chain).length) {
        state.winner = other(state.turn);
        state.phase = 'over';
      } else if (state.quiet >= QUIET_LIMIT) {
        state.winner = 'draw';
        state.phase = 'over';
      }
      return null;
    },

    viewFor(state, who) {
      const isMyTurn = state.phase === 'battle' && state.turn === who;
      const moves = isMyTurn ? legalMoves(state.board, who, state.chain) : [];
      return {
        ui: 'checkers',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        size: SIZE,
        board: state.board.slice(),
        counts: countPieces(state.board),
        isMyTurn,
        moves,
        mustJump: moves.length > 0 && moves[0].capture != null,
        chain: state.chain,
        myPiece: who,
        lastMove: state.lastMove,
        moveNumber: state.moveNumber || 0,
      };
    },

    // easy: half the time any legal move, otherwise the best-looking single move.
    // normal: looks three moves ahead. hard: looks six moves ahead.
    computerMove(state, who, level = 'normal') {
      const moves = legalMoves(state.board, who, state.chain);
      if (!moves.length) return null;
      const pick = list => list[Math.floor(Math.random() * list.length)];
      if (level === 'easy' && Math.random() < 0.5) { const any = pick(moves); return { from: any.from, to: any.to }; }
      const depth = level === 'easy' ? 0 : level === 'hard' ? 5 : 2;
      const sign = who === 'A' ? 1 : -1;
      let best = [];
      let bestValue = -Infinity;
      for (const move of moves) {
        const s = step(state.board, who, move);
        const value = sign * search(s.board, s.turn, s.chain, depth, -Infinity, Infinity);
        if (value > bestValue) { bestValue = value; best = [move]; }
        else if (value === bestValue) best.push(move);
      }
      // Ties go to a random move so two games never play out the same way.
      const chosen = pick(best);
      return { from: chosen.from, to: chosen.to };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = checkers;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...checkers.meta, module: checkers });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.checkers = checkers;
    }
  }
})();
