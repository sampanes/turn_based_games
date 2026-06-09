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

const connectfour = {
  meta: {
    id: 'connectfour',
    name: 'Connect Four',
    description: 'Drop glowing command discs and connect four before your rival does.',
    supportsComputer: true,
    ui: 'connectfour',
  },

  computerSetup() { return null; },
  computerMove(state, who) { return pickComputerMove(state, who); },

  init() {
    return {
      phase: 'battle',
      turn: 'A',
      winner: null,
      board: freshBoard(),
      lastMove: null,
      winningCells: [],
    };
  },

  validateSetup() { return null; },

  applyMove(state, who, move) {
    if (state.phase !== 'battle') return 'Game is already over.';
    if (state.turn !== who) return 'Not your turn.';
    const col = move && Number.isInteger(move.c) ? move.c : move && Number.isInteger(move.col) ? move.col : null;
    const dropped = dropDisc(state.board, col, who);
    if (!dropped) return 'That column is full.';

    const line = winningLine(state.board, dropped.r, dropped.c, who);
    state.lastMove = { by: who, r: dropped.r, c: dropped.c };
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
