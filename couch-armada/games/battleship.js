const FLEET = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];
const SIZE = 10;

function parseCell(cell) {
  if (typeof cell !== 'string') return null;
  const parts = cell.split(',');
  if (parts.length !== 2) return null;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r, c };
}

module.exports = {
  init() {
    return {
      phase: 'placing',          // placing | battle | over
      turn: null,                // 'A' | 'B' once battle starts
      winner: null,
      A: { ships: null, incoming: {} },
      B: { ships: null, incoming: {} },
      lastShot: null,
    };
  },

  validateSetup(state, who, ships) {
    if (state.phase !== 'placing') return 'Game already started.';
    if (state[who].ships) return 'You already placed your fleet.';
    if (!Array.isArray(ships) || ships.length !== FLEET.length) return 'Wrong number of ships.';

    const wantSizes = FLEET.map(s => s.size).sort().join(',');
    const gotSizes = ships.map(s => (s.cells || []).length).sort().join(',');
    if (wantSizes !== gotSizes) return 'Fleet sizes are wrong.';

    const occupied = new Set();
    for (const ship of ships) {
      const cells = ship.cells || [];
      for (const cell of cells) {
        const parsed = parseCell(cell);
        if (!parsed) return 'Bad ship cell.';
        const { r, c } = parsed;
        if (!(r >= 0 && r < SIZE && c >= 0 && c < SIZE)) return 'Ship off the board.';
        if (occupied.has(cell)) return 'Ships overlap.';
        occupied.add(cell);
      }

      const rs = cells.map(x => Number(x.split(',')[0]));
      const cs = cells.map(x => Number(x.split(',')[1]));
      const sameRow = rs.every(v => v === rs[0]);
      const sameCol = cs.every(v => v === cs[0]);
      if (!sameRow && !sameCol) return 'Ships must be straight.';

      const line = (sameRow ? cs : rs).slice().sort((a, b) => a - b);
      for (let i = 1; i < line.length; i++) {
        if (line[i] !== line[i - 1] + 1) return 'Ships must be contiguous.';
      }
    }

    state[who].ships = ships.map(s => ({ name: s.name, size: s.cells.length, cells: s.cells, hits: 0 }));

    if (state.A.ships && state.B.ships) {
      state.phase = 'battle';
      state.turn = Math.random() < 0.5 ? 'A' : 'B';
    }
    return null;
  },

  applyMove(state, who, move) {
    if (state.phase !== 'battle') return 'Not firing yet.';
    if (state.turn !== who) return "Not your turn.";
    const { r, c } = move || {};
    if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE)) {
      return 'Bad target.';
    }

    const enemy = who === 'A' ? 'B' : 'A';
    const key = r + ',' + c;
    if (state[enemy].incoming[key]) return 'Already fired there.';

    let result = 'miss';
    let sunk = null;
    for (const ship of state[enemy].ships) {
      if (ship.cells.includes(key)) {
        result = 'hit';
        ship.hits++;
        if (ship.hits >= ship.size) sunk = ship.name;
        break;
      }
    }
    state[enemy].incoming[key] = result;
    state.lastShot = { by: who, r, c, result, sunk };

    if (state[enemy].ships.every(s => s.hits >= s.size)) {
      state.phase = 'over';
      state.winner = who;
    } else {
      state.turn = enemy;
    }
    return null;
  },

  viewFor(state, who) {
    const me = state[who];
    const enemy = who === 'A' ? state.B : state.A;

    const myBoard = [];
    const shipCells = new Set();
    if (me.ships) me.ships.forEach(s => s.cells.forEach(c => shipCells.add(c)));
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        const key = r + ',' + c;
        row.push({ ship: shipCells.has(key), shot: me.incoming[key] || null });
      }
      myBoard.push(row);
    }

    const firingBoard = [];
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) row.push(enemy.incoming[r + ',' + c] || null);
      firingBoard.push(row);
    }

    return {
      phase: state.phase,
      turn: state.turn,
      winner: state.winner,
      youPlaced: !!me.ships,
      opponentPlaced: !!enemy.ships,
      fleet: FLEET,
      size: SIZE,
      myBoard,
      firingBoard,
      myShipsLeft: me.ships ? me.ships.filter(s => s.hits < s.size).length : FLEET.length,
      enemyShipsLeft: enemy.ships ? enemy.ships.filter(s => s.hits < s.size).length : FLEET.length,
      lastShot: state.lastShot,
    };
  },
};
