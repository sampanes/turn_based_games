(function () {
  'use strict';

  // Pit layout (14 total):
  //   0-5  : A's pits (sow order left→right)
  //   6    : A's store (Mancala)
  //   7-12 : B's pits (B7 = first after A's store in sow order)
  //   13   : B's store
  //
  // Sow path (counter-clockwise): 0→1→…→5→6→7→…→12→13→0→…
  //   A skips index 13;  B skips index 6
  //
  // Display from A's view:
  //   [B-store=13] | B12 B11 B10 B9 B8 B7 | [A-store=6]
  //                | A0  A1  A2  A3 A4  A5 |
  //
  // Opposite pits for captures: pit i  ↔  pit (12 − i)
  //   A0↔B12, A1↔B11, …, A5↔B7

  function sowStones(pits, pitIdx, who) {
    const p = pits.slice();
    let stones = p[pitIdx];
    p[pitIdx] = 0;
    const skip = who === 'A' ? 13 : 6;
    const seq = [];
    let cur = pitIdx;
    while (stones > 0) {
      cur = (cur + 1) % 14;
      if (cur === skip) continue;
      p[cur]++;
      seq.push(cur);
      stones--;
    }
    return { pits: p, last: cur, seq };
  }

  function tryCapture(pits, last, who) {
    const isMyPit = who === 'A' ? (last >= 0 && last <= 5) : (last >= 7 && last <= 12);
    if (!isMyPit || pits[last] !== 1) return { pits, count: 0, from: -1 };
    const opp = 12 - last;
    if (pits[opp] === 0) return { pits, count: 0, from: -1 };
    const myStore = who === 'A' ? 6 : 13;
    const p = pits.slice();
    const count = p[opp] + 1;
    p[myStore] += count;
    p[opp] = 0;
    p[last] = 0;
    return { pits: p, count, from: opp };
  }

  function isSideEmpty(pits, who) {
    return who === 'A'
      ? pits.slice(0, 6).every(v => v === 0)
      : pits.slice(7, 13).every(v => v === 0);
  }

  function sweepBoard(pits) {
    const p = pits.slice();
    if (isSideEmpty(p, 'A')) {
      for (let i = 7; i <= 12; i++) { p[13] += p[i]; p[i] = 0; }
    } else {
      for (let i = 0; i <= 5; i++) { p[6] += p[i]; p[i] = 0; }
    }
    return p;
  }

  function isGameOver(pits) {
    return isSideEmpty(pits, 'A') || isSideEmpty(pits, 'B');
  }

  function calcWinner(pits) {
    return pits[6] > pits[13] ? 'A' : pits[13] > pits[6] ? 'B' : 'draw';
  }

  function minimax(pits, who, depth, alpha, beta) {
    if (isGameOver(pits)) {
      const fp = sweepBoard(pits);
      return (fp[6] - fp[13]) * 200;
    }
    if (depth === 0) return pits[6] - pits[13];

    const myRange = who === 'A' ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
    const moves = myRange.filter(i => pits[i] > 0);
    if (!moves.length) return pits[6] - pits[13];

    const myStore = who === 'A' ? 6 : 13;

    if (who === 'A') {
      let best = -Infinity;
      for (const idx of moves) {
        const s = sowStones(pits, idx, 'A');
        const cap = tryCapture(s.pits, s.last, 'A');
        const nextWho = s.last === myStore ? 'A' : 'B';
        const val = minimax(cap.pits, nextWho, depth - 1, alpha, beta);
        if (val > best) best = val;
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const idx of moves) {
        const s = sowStones(pits, idx, 'B');
        const cap = tryCapture(s.pits, s.last, 'B');
        const nextWho = s.last === myStore ? 'B' : 'A';
        const val = minimax(cap.pits, nextWho, depth - 1, alpha, beta);
        if (val < best) best = val;
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  const mancala = {
    meta: {
      id: 'mancala',
      name: 'Mancala',
      description: 'Sow seeds around the board. Capture the most in your store to win.',
      supportsComputer: true,
      ui: 'mancala',
    },

    init() {
      return {
        pits: [4,4,4,4,4,4,0, 4,4,4,4,4,4,0],
        phase: 'battle',
        turn: 'A',
        winner: null,
        lastSeq: [],
        lastPickup: null,
        lastExtraTurn: false,
        lastCapture: 0,
        lastCaptureFrom: -1,
        moveNumber: 0,
      };
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    applyMove(state, who, move) {
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';

      const pitIdx = move && Number.isInteger(move.pit) ? move.pit : parseInt(move && move.pit, 10);
      if (!Number.isFinite(pitIdx)) return 'Invalid move.';

      const myRange = who === 'A' ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
      if (!myRange.includes(pitIdx)) return 'Not your pit.';
      if (state.pits[pitIdx] === 0) return 'That pit is empty.';

      const myStore = who === 'A' ? 6 : 13;
      const s = sowStones(state.pits, pitIdx, who);
      const cap = tryCapture(s.pits, s.last, who);
      const extraTurn = s.last === myStore;

      state.pits = cap.pits;
      state.lastSeq = s.seq;
      state.lastPickup = pitIdx;
      state.lastExtraTurn = extraTurn;
      state.lastCapture = cap.count;
      state.lastCaptureFrom = cap.from;
      state.moveNumber = (state.moveNumber || 0) + 1;

      if (isGameOver(state.pits)) {
        state.pits = sweepBoard(state.pits);
        state.winner = calcWinner(state.pits);
        state.phase = 'over';
      } else {
        state.turn = extraTurn ? who : (who === 'A' ? 'B' : 'A');
      }

      return null;
    },

    viewFor(state, who) {
      const isMyTurn = state.phase === 'battle' && state.turn === who;
      const myRange = who === 'A' ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
      const validMoves = isMyTurn ? myRange.filter(i => state.pits[i] > 0) : [];

      return {
        ui: 'mancala',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        pits: state.pits.slice(),
        isMyTurn,
        validMoves,
        // Board layout (each player sees their own pits at the bottom)
        myPitIndices:  who === 'A' ? [0,1,2,3,4,5] : [12,11,10,9,8,7],
        oppPitIndices: who === 'A' ? [12,11,10,9,8,7] : [5,4,3,2,1,0],
        myStoreIndex:  who === 'A' ? 6 : 13,
        oppStoreIndex: who === 'A' ? 13 : 6,
        myPiece: who,
        // Animation data
        moveSeq:      state.lastSeq,
        movePickup:   state.lastPickup,
        extraTurn:    state.lastExtraTurn,
        captureCount: state.lastCapture,
        captureFrom:  state.lastCaptureFrom,
        moveNumber:   state.moveNumber || 0,
      };
    },

    computerMove(state, who) {
      const myRange = who === 'A' ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
      const moves = myRange.filter(i => state.pits[i] > 0);
      if (!moves.length) return null;

      const myStore = who === 'A' ? 6 : 13;
      const sign = who === 'A' ? 1 : -1;
      let bestIdx = moves[0], bestVal = -Infinity;

      for (const idx of moves) {
        const s = sowStones(state.pits, idx, who);
        const cap = tryCapture(s.pits, s.last, who);
        const nextWho = s.last === myStore ? who : (who === 'A' ? 'B' : 'A');
        const val = sign * minimax(cap.pits, nextWho, 6, -Infinity, Infinity);
        if (val > bestVal) { bestVal = val; bestIdx = idx; }
      }

      return { pit: bestIdx };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = mancala;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...mancala.meta, module: mancala });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.mancala = mancala;
    }
  }
})();
