const ROWS = 6;
const COLS = 7;
const CONNECT = 4;
const EMPTY = null;

function other(player) { return player === 'A' ? 'B' : 'A'; }
function freshBoard() { return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => EMPTY)); }
function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
function legalMoves(board) { return board[0].map((cell, c) => (cell === EMPTY ? c : null)).filter(c => c !== null); }
function cloneBoard(board) { return board.map(row => row.slice()); }

function dropDisc(board, col, player) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === EMPTY) {
      board[r][col] = player;
      return { r, c: col };
    }
  }
  return null;
}

function winningLine(board, r, c, player) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of directions) {
    const cells = [[r, c]];
    for (const sign of [-1, 1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (inBounds(rr, cc) && board[rr][cc] === player) {
        cells.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (cells.length >= CONNECT) return cells.slice(0, CONNECT).map(([row, col]) => `${row},${col}`);
  }
  return null;
}

function wouldWin(board, col, player) {
  const copy = cloneBoard(board);
  const move = dropDisc(copy, col, player);
  if (!move) return false;
  return !!winningLine(copy, move.r, move.c, player);
}

function scoreWindow(cells, player) {
  const enemy = other(player);
  const mine = cells.filter(v => v === player).length;
  const theirs = cells.filter(v => v === enemy).length;
  const empty = cells.filter(v => v === EMPTY).length;
  if (mine && theirs) return 0;
  if (mine === 3 && empty === 1) return 80;
  if (mine === 2 && empty === 2) return 18;
  if (mine === 1 && empty === 3) return 3;
  if (theirs === 3 && empty === 1) return -70;
  if (theirs === 2 && empty === 2) return -12;
  return 0;
}

function scoreBoard(board, player) {
  let score = 0;
  const center = Math.floor(COLS / 2);
  for (let r = 0; r < ROWS; r++) if (board[r][center] === player) score += 7;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - CONNECT; c++) score += scoreWindow(board[r].slice(c, c + CONNECT), player);
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - CONNECT; r++) score += scoreWindow([0, 1, 2, 3].map(i => board[r + i][c]), player);
  }
  for (let r = 0; r <= ROWS - CONNECT; r++) {
    for (let c = 0; c <= COLS - CONNECT; c++) score += scoreWindow([0, 1, 2, 3].map(i => board[r + i][c + i]), player);
  }
  for (let r = 0; r <= ROWS - CONNECT; r++) {
    for (let c = CONNECT - 1; c < COLS; c++) score += scoreWindow([0, 1, 2, 3].map(i => board[r + i][c - i]), player);
  }
  return score;
}

function pickComputerMove(state, player) {
  const moves = legalMoves(state.board);
  const enemy = other(player);
  for (const col of moves) if (wouldWin(state.board, col, player)) return { c: col };
  for (const col of moves) if (wouldWin(state.board, col, enemy)) return { c: col };

  const centerOrder = moves.slice().sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3));
  let best = centerOrder[0];
  let bestScore = -Infinity;
  for (const col of centerOrder) {
    const copy = cloneBoard(state.board);
    dropDisc(copy, col, player);
    const score = scoreBoard(copy, player) - Math.abs(col - 3);
    if (score > bestScore) {
      best = col;
      bestScore = score;
    }
  }
  return { c: best };
}

function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }
function centerFirst(moves) { return moves.slice().sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3)); }

// A beginner: usually sees its own win, often misses yours, and otherwise
// plays somewhere near the middle.
function easyComputerMove(state, player) {
  const moves = legalMoves(state.board);
  if (Math.random() < 0.7) for (const col of moves) if (wouldWin(state.board, col, player)) return { c: col };
  if (Math.random() < 0.4) for (const col of moves) if (wouldWin(state.board, col, other(player))) return { c: col };
  return { c: pickRandom(moves.flatMap(col => new Array(4 - Math.abs(col - 3)).fill(col))) };
}

// Looks HARD_DEPTH moves ahead (alpha-beta), scoring the leaves with the
// same window heuristic the normal bot uses for its one-move look.
const HARD_DEPTH = 6;
const WIN_SCORE = 1000000;
function negamax(board, player, depth, alpha, beta) {
  const moves = centerFirst(legalMoves(board));
  if (!moves.length) return 0;
  for (const col of moves) if (wouldWin(board, col, player)) return WIN_SCORE + depth;
  if (depth === 0) return scoreBoard(board, player);
  let best = -Infinity;
  for (const col of moves) {
    const copy = cloneBoard(board);
    dropDisc(copy, col, player);
    const value = -negamax(copy, other(player), depth - 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function hardComputerMove(state, player) {
  const moves = centerFirst(legalMoves(state.board));
  for (const col of moves) if (wouldWin(state.board, col, player)) return { c: col };
  let best = [], bestScore = -Infinity;
  for (const col of moves) {
    const copy = cloneBoard(state.board);
    dropDisc(copy, col, player);
    const value = -negamax(copy, other(player), HARD_DEPTH - 1, -Infinity, Infinity);
    if (value > bestScore) { best = [col]; bestScore = value; }
    else if (value === bestScore) best.push(col);
  }
  return { c: pickRandom(best) };
}

const connectfour = {
  meta: {
    id: 'connectfour',
    name: 'Connect Four',
    description: 'Drop glowing command discs and connect four before your rival does.',
    supportsComputer: true,
    ui: 'connectfour',
  },

  computerSetup() { return null; },
  computerMove(state, who, level) {
    if (!legalMoves(state.board).length) return null;
    if (level === 'easy') return easyComputerMove(state, who);
    if (level === 'hard') return hardComputerMove(state, who);
    return pickComputerMove(state, who);
  },

  init() {
    return {
      phase: 'battle',
      turn: 'A',
      winner: null,
      board: freshBoard(),
      lastMove: null,
      winningCells: [],
      moveNumber: 0,
      log: [],
    };
  },

  validateSetup() { return null; },

  applyMove(state, who, move) {
    if (state.phase !== 'battle') return 'Game is already over.';
    if (state.turn !== who) return 'Not your turn.';
    const col = move && Number.isInteger(move.c) ? move.c : move && Number.isInteger(move.col) ? move.col : null;
    if (col === null || col < 0 || col >= COLS) return 'Pick a column.';
    const dropped = dropDisc(state.board, col, who);
    if (!dropped) return 'That column is full.';

    const line = winningLine(state.board, dropped.r, dropped.c, who);
    state.lastMove = { by: who, r: dropped.r, c: dropped.c };
    // Rolling move log so clients can replay and pace every drop since their
    // last poll (solo bots resolve inside the same call as the human move).
    state.moveNumber = (state.moveNumber || 0) + 1;
    state.log = (state.log || []).slice(-15);
    state.log.push({
      n: state.moveNumber,
      by: who,
      r: dropped.r,
      c: dropped.c,
      win: line ? line.slice() : null,
      draw: !line && legalMoves(state.board).length === 0,
    });
    if (line) {
      state.phase = 'over';
      state.winner = who;
      state.winningCells = line;
    } else if (legalMoves(state.board).length === 0) {
      state.phase = 'over';
      state.winner = null;
      state.winningCells = [];
    } else {
      state.turn = other(who);
    }
    return null;
  },

  viewFor(state) {
    return {
      ui: 'connectfour',
      phase: state.phase,
      turn: state.turn,
      winner: state.winner,
      rows: ROWS,
      cols: COLS,
      board: state.board.map(row => row.slice()),
      legalMoves: state.phase === 'battle' ? legalMoves(state.board) : [],
      lastMove: state.lastMove,
      winningCells: state.winningCells || [],
      moveNumber: state.moveNumber || 0,
      moveLog: (state.log || []).slice(),
    };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = connectfour;
if (typeof window !== 'undefined') {
  if (window.TurnBasedGamesRegistry) {
    window.TurnBasedGamesRegistry.registerGame({ ...connectfour.meta, module: connectfour });
  } else {
    window.TurnBasedGames = window.TurnBasedGames || {};
    window.TurnBasedGames.connectfour = connectfour;
  }
}
