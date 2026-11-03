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

function randomFleet() {
  const ships = [];
  const occupied = new Set();
  for (const def of FLEET) {
    for (let tries = 0; tries < 1000; tries++) {
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const cells = Array.from({ length: def.size }, (_, i) => horizontal ? `${r},${c + i}` : `${r + i},${c}`);
      const ok = cells.every(cell => {
        const [rr, cc] = cell.split(',').map(Number);
        return rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && !occupied.has(cell);
      });
      if (ok) {
        cells.forEach(cell => occupied.add(cell));
        ships.push({ name: def.name, size: def.size, cells });
        break;
      }
    }
  }
  return ships;
}

// Skill levels. easy: fires at random and only now and then follows up a hit.
// normal: random hunting, then works the cells around an unsunk hit.
// hard: scores every cell by how many ways the ships still afloat could cover
// it (only through unsunk hits while it has one), and fires at the best.
function computerShot(state, who, level = 'normal') {
  const view = battleship.viewFor(state, who);
  const n = view.size;
  const at = (r, c) => view.firingBoard[r][c];
  const inside = (r, c) => r >= 0 && r < n && c >= 0 && c < n;
  const pick = list => list[Math.floor(Math.random() * list.length)] || null;
  // Sunk ships are public, so their hits no longer need following up.
  const sunkCells = new Set(view.enemyFleet.filter(s => s.sunk && s.cells).flatMap(s => s.cells));
  const open = [];
  const live = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!at(r, c)) open.push({ r, c });
    else if (at(r, c) === 'hit' && !sunkCells.has(`${r},${c}`)) live.push({ r, c });
  }
  if (!open.length) return null;

  const near = [];
  const seen = new Set();
  for (const h of live) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = h.r + dr, c = h.c + dc;
    if (inside(r, c) && !at(r, c) && !seen.has(`${r},${c}`)) { seen.add(`${r},${c}`); near.push({ r, c }); }
  }

  if (level === 'easy') return near.length && Math.random() < 0.25 ? pick(near) : pick(open);
  if (level !== 'hard') return pick(near.length ? near : open);

  const liveSet = new Set(live.map(h => `${h.r},${h.c}`));
  const blocked = (r, c) => at(r, c) === 'miss' || sunkCells.has(`${r},${c}`);
  const score = Array.from({ length: n }, () => new Array(n).fill(0));
  const sizes = view.enemyFleet.filter(s => !s.sunk).map(s => s.size);
  for (const size of sizes) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cells = [];
      for (let i = 0; i < size; i++) cells.push([r + dr * i, c + dc * i]);
      if (!cells.every(([rr, cc]) => inside(rr, cc) && !blocked(rr, cc))) continue;
      const hits = cells.filter(([rr, cc]) => liveSet.has(`${rr},${cc}`)).length;
      if (live.length && !hits) continue;
      const weight = Math.pow(20, hits);
      for (const [rr, cc] of cells) if (!at(rr, cc)) score[rr][cc] += weight;
    }
  }
  let best = [], bestScore = 0;
  for (const cell of open) {
    const s = score[cell.r][cell.c];
    if (s > bestScore) { best = [cell]; bestScore = s; }
    else if (s === bestScore && s > 0) best.push(cell);
  }
  return pick(best.length ? best : (near.length ? near : open));
}

const battleship = {
  computerSetup() {
    return randomFleet();
  },

  computerMove(state, who, level) {
    return computerShot(state, who, level);
  },

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
    if (!ships.every(s => s && typeof s === 'object' && Array.isArray(s.cells))) return 'Bad ship.';
    const gotSizes = ships.map(s => s.cells.length).sort().join(',');
    if (wantSizes !== gotSizes) return 'Fleet sizes are wrong.';

    // Shots look cells up by their canonical "r,c" text, so store only that form
    // ("01,02" would pass the bounds check yet never be hit).
    const canonical = [];
    const occupied = new Set();
    for (const ship of ships) {
      const cells = [];
      for (const cell of ship.cells) {
        const parsed = parseCell(cell);
        if (!parsed) return 'Bad ship cell.';
        const { r, c } = parsed;
        if (!(r >= 0 && r < SIZE && c >= 0 && c < SIZE)) return 'Ship off the board.';
        const key = `${r},${c}`;
        if (occupied.has(key)) return 'Ships overlap.';
        occupied.add(key);
        cells.push(key);
      }
      canonical.push({ name: ship.name, cells });

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

    state[who].ships = canonical.map(s => ({ name: s.name, size: s.cells.length, cells: s.cells, hits: 0 }));

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

    const over = state.phase === 'over';
    const myFleet = me.ships
      ? me.ships.map(s => ({ name: s.name, size: s.size, hits: s.hits, sunk: s.hits >= s.size, cells: s.cells }))
      : FLEET.map(s => ({ name: s.name, size: s.size, hits: 0, sunk: false, cells: [] }));
    // Enemy ship positions stay hidden until a ship is sunk (or the game ends).
    const enemyFleet = enemy.ships
      ? enemy.ships.map(s => {
          const sunk = s.hits >= s.size;
          return { name: s.name, size: s.size, sunk, cells: (sunk || over) ? s.cells : null };
        })
      : FLEET.map(s => ({ name: s.name, size: s.size, sunk: false, cells: null }));

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
      myFleet,
      enemyFleet,
      myShipsLeft: me.ships ? me.ships.filter(s => s.hits < s.size).length : FLEET.length,
      enemyShipsLeft: enemy.ships ? enemy.ships.filter(s => s.hits < s.size).length : FLEET.length,
      lastShot: state.lastShot,
    };
  },
};

battleship.meta = {
  id: 'battleship',
  name: 'Battleship',
  description: 'Classic hidden-fleet naval combat with one shot per turn.',
  supportsComputer: true,
  ui: 'battleship',
};

if (typeof module !== 'undefined' && module.exports) module.exports = battleship;
if (typeof window !== 'undefined') {
  if (window.TurnBasedGamesRegistry) {
    window.TurnBasedGamesRegistry.registerGame({ ...battleship.meta, module: battleship });
  } else {
    window.TurnBasedGames = window.TurnBasedGames || {};
    window.TurnBasedGames.battleship = battleship;
  }
}
