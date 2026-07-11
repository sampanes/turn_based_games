(function () {
  'use strict';

  const BOX_ROWS = 4;
  const BOX_COLS = 4;

  function other(player) { return player === 'A' ? 'B' : 'A'; }
  function edgeId(type, r, c) { return `${type}-${r}-${c}`; }

  function freshEdges() {
    return {
      h: Array.from({ length: BOX_ROWS + 1 }, () => Array.from({ length: BOX_COLS }, () => null)),
      v: Array.from({ length: BOX_ROWS }, () => Array.from({ length: BOX_COLS + 1 }, () => null)),
    };
  }

  function freshBoxes() {
    return Array.from({ length: BOX_ROWS }, () => Array.from({ length: BOX_COLS }, () => null));
  }

  function cloneEdges(edges) {
    return {
      h: edges.h.map(row => row.slice()),
      v: edges.v.map(row => row.slice()),
    };
  }

  function cloneBoxes(boxes) {
    return boxes.map(row => row.slice());
  }

  function normalizeMove(move) {
    if (!move) return null;
    if (typeof move.id === 'string') {
      const match = move.id.match(/^([hv])-(\d+)-(\d+)$/);
      if (match) return { type: match[1], r: Number(match[2]), c: Number(match[3]) };
    }
    const type = move.type === 'h' || move.type === 'v' ? move.type : null;
    const r = Number.isInteger(move.r) ? move.r : Number.parseInt(move.r, 10);
    const c = Number.isInteger(move.c) ? move.c : Number.parseInt(move.c, 10);
    return type && Number.isFinite(r) && Number.isFinite(c) ? { type, r, c } : null;
  }

  function isValidEdge(move) {
    if (!move) return false;
    if (move.type === 'h') return move.r >= 0 && move.r <= BOX_ROWS && move.c >= 0 && move.c < BOX_COLS;
    if (move.type === 'v') return move.r >= 0 && move.r < BOX_ROWS && move.c >= 0 && move.c <= BOX_COLS;
    return false;
  }

  function edgeOwner(edges, move) {
    return isValidEdge(move) ? edges[move.type][move.r][move.c] : null;
  }

  function setEdge(edges, move, player) {
    edges[move.type][move.r][move.c] = player;
  }

  function adjacentBoxes(move) {
    const boxes = [];
    if (move.type === 'h') {
      if (move.r > 0) boxes.push([move.r - 1, move.c]);
      if (move.r < BOX_ROWS) boxes.push([move.r, move.c]);
    } else {
      if (move.c > 0) boxes.push([move.r, move.c - 1]);
      if (move.c < BOX_COLS) boxes.push([move.r, move.c]);
    }
    return boxes;
  }

  function boxSides(edges, r, c) {
    return [
      edges.h[r][c],
      edges.h[r + 1][c],
      edges.v[r][c],
      edges.v[r][c + 1],
    ];
  }

  function sideCount(edges, r, c) {
    return boxSides(edges, r, c).filter(Boolean).length;
  }

  function isBoxComplete(edges, r, c) {
    return sideCount(edges, r, c) === 4;
  }

  function legalMovesFromEdges(edges) {
    const moves = [];
    for (let r = 0; r <= BOX_ROWS; r++) {
      for (let c = 0; c < BOX_COLS; c++) {
        if (!edges.h[r][c]) moves.push({ id: edgeId('h', r, c), type: 'h', r, c });
      }
    }
    for (let r = 0; r < BOX_ROWS; r++) {
      for (let c = 0; c <= BOX_COLS; c++) {
        if (!edges.v[r][c]) moves.push({ id: edgeId('v', r, c), type: 'v', r, c });
      }
    }
    return moves;
  }

  function totalBoxes(scores) {
    return (scores.A || 0) + (scores.B || 0);
  }

  function applyClaim(state, who, move) {
    setEdge(state.edges, move, who);
    const completed = [];
    for (const [r, c] of adjacentBoxes(move)) {
      if (!state.boxes[r][c] && isBoxComplete(state.edges, r, c)) {
        state.boxes[r][c] = who;
        state.scores[who] = (state.scores[who] || 0) + 1;
        completed.push(`${r},${c}`);
      }
    }
    return completed;
  }

  function simulateClaim(state, who, move) {
    const copy = {
      edges: cloneEdges(state.edges),
      boxes: cloneBoxes(state.boxes),
      scores: { A: state.scores.A || 0, B: state.scores.B || 0 },
    };
    const completed = applyClaim(copy, who, move);
    return { state: copy, completed };
  }

  function dangerCount(state) {
    let count = 0;
    for (let r = 0; r < BOX_ROWS; r++) {
      for (let c = 0; c < BOX_COLS; c++) {
        if (!state.boxes[r][c] && sideCount(state.edges, r, c) === 3) count++;
      }
    }
    return count;
  }

  function setupScore(state, move, who) {
    const sim = simulateClaim(state, who, move);
    const completed = sim.completed.length;
    if (completed) return 1000 + completed * 100;

    const beforeDanger = dangerCount(state);
    const afterDanger = dangerCount(sim.state);
    let adjacentPressure = 0;
    for (const [r, c] of adjacentBoxes(move)) {
      if (!sim.state.boxes[r][c]) adjacentPressure += sideCount(sim.state.edges, r, c);
    }
    const centerBias = 8 - Math.abs(move.r - BOX_ROWS / 2) - Math.abs(move.c - BOX_COLS / 2);
    return (beforeDanger - afterDanger) * 80 + adjacentPressure * 4 + centerBias;
  }

  const dotsboxes = {
    meta: {
      id: 'dotsboxes',
      name: 'Dots and Boxes',
      description: 'Draw lines, close boxes, and keep the turn when you score.',
      supportsComputer: true,
      ui: 'dotsboxes',
    },

    init() {
      return {
        phase: 'battle',
        turn: 'A',
        winner: null,
        edges: freshEdges(),
        boxes: freshBoxes(),
        scores: { A: 0, B: 0 },
        lastMove: null,
        moveNumber: 0,
        log: [],
      };
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    applyMove(state, who, move) {
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';
      const claim = normalizeMove(move);
      if (!isValidEdge(claim)) return 'Pick a valid line.';
      if (edgeOwner(state.edges, claim)) return 'That line is already claimed.';

      const completed = applyClaim(state, who, claim);
      state.lastMove = { ...claim, by: who, completed: completed.slice() };
      state.moveNumber = (state.moveNumber || 0) + 1;
      state.log = (state.log || []).slice(-20);
      state.log.push({
        n: state.moveNumber,
        by: who,
        id: edgeId(claim.type, claim.r, claim.c),
        type: claim.type,
        r: claim.r,
        c: claim.c,
        completed: completed.slice(),
      });

      if (totalBoxes(state.scores) === BOX_ROWS * BOX_COLS) {
        state.phase = 'over';
        state.winner = state.scores.A > state.scores.B ? 'A'
          : state.scores.B > state.scores.A ? 'B'
          : 'draw';
      } else if (!completed.length) {
        state.turn = other(who);
      }
      return null;
    },

    viewFor(state, who, players) {
      const isMyTurn = state.phase === 'battle' && state.turn === who;
      const legalMoves = isMyTurn ? legalMovesFromEdges(state.edges) : [];
      return {
        ui: 'dotsboxes',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        boxRows: BOX_ROWS,
        boxCols: BOX_COLS,
        edges: cloneEdges(state.edges),
        boxes: cloneBoxes(state.boxes),
        scores: { A: state.scores.A || 0, B: state.scores.B || 0 },
        players: (players || []).map(player => ({ ...player, you: player.slot === who })),
        isMyTurn,
        legalMoves,
        lastMove: state.lastMove ? { ...state.lastMove, completed: (state.lastMove.completed || []).slice() } : null,
        moveNumber: state.moveNumber || 0,
        moveLog: (state.log || []).slice(),
      };
    },

    computerMove(state, who) {
      const moves = legalMovesFromEdges(state.edges);
      if (!moves.length) return null;
      let best = moves[0];
      let bestScore = -Infinity;
      for (const move of moves) {
        const score = setupScore(state, move, who);
        if (score > bestScore) {
          best = move;
          bestScore = score;
        }
      }
      return { type: best.type, r: best.r, c: best.c };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = dotsboxes;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...dotsboxes.meta, module: dotsboxes });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.dotsboxes = dotsboxes;
    }
  }
})();
