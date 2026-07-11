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

  // ------------------------------------------------------------------
  // Champion neural bot (browser only).
  // The certified strongest net from the ultimate-ttt-RL project, fetched
  // cross-origin from its GitHub Pages so both sites share one model:
  //   https://sampanes.github.io/ultimate-ttt-RL/  (CHAMPIONS.md, RESULT_M2_5.md)
  // onnxruntime-web is injected from CDN on first solo game. Until the model
  // is ready -- or if anything fails, or offline -- the win/block heuristic
  // below keeps playing, so solo mode never depends on the network.
  // The brain is async but computerMove must return synchronously: it returns
  // null while a result is computing (the solo poll loop re-arms and retries)
  // and hands back the cached answer on a later poll.
  // ------------------------------------------------------------------

  const MODELS_BASE = 'https://sampanes.github.io/ultimate-ttt-RL/models/';
  const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

  const brain = { status: 'idle', session: null, policyName: 'policy_logits', pendingKey: null, answer: null };

  function brainUsable() {
    return typeof window !== 'undefined' && typeof fetch === 'function';
  }

  function loadOrtScript() {
    return new Promise((resolve, reject) => {
      if (window.ort) return resolve();
      const s = document.createElement('script');
      s.src = ORT_CDN + 'ort.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('onnxruntime-web script failed to load'));
      document.head.appendChild(s);
    });
  }

  async function brainInit() {
    brain.status = 'loading';
    try {
      await loadOrtScript();
      const cfgUrl = MODELS_BASE + 'champion_config.json';
      const resp = await fetch(cfgUrl);
      if (!resp.ok) throw new Error('config HTTP ' + resp.status);
      const config = await resp.json();
      if (config.outputs && config.outputs.policy) brain.policyName = config.outputs.policy;
      window.ort.env.wasm.wasmPaths = ORT_CDN;
      brain.session = await window.ort.InferenceSession.create(
        new URL(config.file, cfgUrl).href,
        { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
      );
      brain.status = 'ready';
    } catch (err) {
      brain.status = 'failed'; // heuristic takes over permanently this session
    }
  }

  function stateKey(state) {
    return state.board.join('') + '|' + state.turn + '|' + state.lastMove;
  }

  // Mirrors the training repo's input encoding (7x9x9 planes, NCHW):
  // X pieces, O pieces, side-to-move, legal mask, mini winners, last move, bias.
  function buildInputTensor(state, valid) {
    const data = new Float32Array(7 * 81);
    for (let i = 0; i < 81; i++) {
      if (state.board[i] === X) data[i] = 1.0;
      else if (state.board[i] === O) data[81 + i] = 1.0;
    }
    data.fill(state.turn === 'A' ? 1.0 : -1.0, 162, 243);
    for (const c of valid) data[243 + c] = 1.0;
    for (let m = 0; m < 9; m++) {
      const w = state.miniWinners[m];
      if (w === X || w === O) {
        const v = (w === X) ? 1.0 : -1.0;
        for (const c of getMiniIndices(m)) data[324 + c] = v;
      }
    }
    if (state.lastMove !== null && state.lastMove >= 0) data[405 + state.lastMove] = 1.0;
    data.fill(1.0, 486, 567);
    return new window.ort.Tensor('float32', data, [1, 7, 9, 9]);
  }

  // 1-ply tactical pool, mirroring the certified "tactical" mode the champion
  // was benchmarked in: take an immediate game win if one exists; otherwise
  // exclude moves that hand the opponent an immediate game win (falling back
  // to all legal moves if everything loses). The net picks within the pool.
  function tacticalPool(state, valid, myPiece, oppPiece) {
    const wins = [];
    for (const idx of valid) {
      const sim = simPlace(state.board, state.miniWinners, idx, myPiece);
      if (checkUltimateWin(sim.miniWinners) === myPiece) wins.push(idx);
    }
    if (wins.length) return wins;
    const safe = [];
    for (const idx of valid) {
      const sim = simPlace(state.board, state.miniWinners, idx, myPiece);
      if (checkUltimateWin(sim.miniWinners) !== null) { safe.push(idx); continue; }
      let losing = false;
      for (const r of validMoves(sim.board, idx, sim.miniWinners)) {
        const sim2 = simPlace(sim.board, sim.miniWinners, r, oppPiece);
        if (checkUltimateWin(sim2.miniWinners) === oppPiece) { losing = true; break; }
      }
      if (!losing) safe.push(idx);
    }
    return safe.length ? safe : valid;
  }

  async function brainCompute(state, key, valid, myPiece, oppPiece) {
    try {
      const input = buildInputTensor(state, valid);
      const results = await brain.session.run({ input });
      const logits = results[brain.policyName].data;
      const pool = tacticalPool(state, valid, myPiece, oppPiece);
      let best = pool[0];
      for (const idx of pool) if (logits[idx] > logits[best]) best = idx;
      brain.answer = { key, idx: best };
    } catch (err) {
      brain.status = 'failed';
    } finally {
      brain.pendingKey = null;
    }
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
      if (valid.length === 1) return { idx: valid[0] };

      // Champion net first (browser). While it computes, return null so the
      // poll loop retries; while it loads (or if it failed), play heuristic.
      if (brainUsable()) {
        if (brain.status === 'idle') brainInit();
        if (brain.status === 'ready') {
          const key = stateKey(state);
          if (brain.answer && brain.answer.key === key) {
            const idx = brain.answer.idx;
            brain.answer = null;
            return { idx };
          }
          if (brain.pendingKey !== key) {
            brain.pendingKey = key;
            brainCompute(state, key, valid, myPiece, oppPiece);
          }
          return null;
        }
      }

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
