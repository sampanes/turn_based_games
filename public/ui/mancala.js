// Mancala screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
// ---------------- Mancala ----------------
let mncAnimating = false;
let mncLastPits = null;
let mncLastMoveNumber = 0;
let mncBoardSig = '';
let mncOverFxDone = false;
let mncLastData = null;

function mncSfx(kind, i = 0) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'pickup') {
    battleNoise(audio, t, 0.08, { freq: 700, gain: 0.09 });
    battleTone(audio, t, 190, 0.1, { type: 'triangle', gain: 0.05 });
  } else if (kind === 'sow') {
    battleTone(audio, t, 420 + (i % 7) * 26, 0.06, { type: 'triangle', gain: 0.05 });
    battleNoise(audio, t, 0.03, { freq: 2400, type: 'highpass', gain: 0.05 });
  } else if (kind === 'store') {
    battleTone(audio, t, 310, 0.16, { type: 'triangle', gain: 0.08, slideTo: 230 });
    battleNoise(audio, t, 0.06, { freq: 900, gain: 0.06 });
  } else if (kind === 'capture') {
    battleTone(audio, t, 540, 0.28, { slideTo: 130, gain: 0.09 });
    battleNoise(audio, t + 0.05, 0.24, { freq: 750, gain: 0.14 });
  } else if (kind === 'bonus') {
    battleTone(audio, t, 620, 0.12, { type: 'triangle', gain: 0.08 });
    battleTone(audio, t + 0.11, 830, 0.18, { type: 'triangle', gain: 0.08 });
  } else if (kind === 'sweep') {
    battleTone(audio, t, 360 + (i % 8) * 32, 0.07, { type: 'triangle', gain: 0.045 });
  }
}

// Deterministic pseudo-random scatter so seed piles look organic but never
// jump around between rerenders.
function mncRand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function mncSeedStyle(pitIdx, k) {
  const slot = k % 24;
  const angle = slot * 2.39996 + mncRand(pitIdx * 31 + 7) * 6.283;
  const rad = Math.sqrt(slot + 0.6) / Math.sqrt(24.6) * 40;
  const x = 50 + Math.cos(angle) * rad;
  const y = 50 + Math.sin(angle) * rad;
  const rot = Math.floor(mncRand(pitIdx * 97 + k * 13) * 360);
  const sc = (0.82 + mncRand(pitIdx * 53 + k * 29) * 0.36).toFixed(2);
  return `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${rot}deg) scale(${sc})`;
}

const MNC_PIT_SEED_CAP = 18;
const MNC_STORE_SEED_CAP = 30;

function mncSeedsHTML(pitIdx, count, side, cap) {
  const n = Math.min(count, cap);
  let html = '';
  for (let k = 0; k < n; k++) {
    html += `<span class="mnc-sd ${side} v${k % 3}" style="${mncSeedStyle(pitIdx, k)}"></span>`;
  }
  return html;
}

function buildMancalaBoard(v, pits) {
  const winStore = v.phase === 'over' && v.winner && v.winner !== 'draw'
    ? (v.winner === v.myPiece ? v.myStoreIndex : v.oppStoreIndex) : -1;
  const store = (pitIdx, side, area) =>
    `<div class="mnc-store ${side} area-${area}${pitIdx === winStore ? ' winner' : ''}" id="mnc-p${pitIdx}" data-pit="${pitIdx}">
      ${mncSeedsHTML(pitIdx, pits[pitIdx], side, MNC_STORE_SEED_CAP)}
      <div class="mnc-scount">${pits[pitIdx]}</div>
      <div class="mnc-slabel">${side === 'mine' ? 'You' : 'Opp'}</div>
    </div>`;
  const pit = (pitIdx, side, area) => {
    const count = pits[pitIdx];
    const valid = side === 'mine' && !mncAnimating && v.isMyTurn && v.validMoves.includes(pitIdx);
    const cls = `mnc-pit ${side} area-${area}${count === 0 ? ' empty' : ''}${valid ? ' valid' : ''}`;
    return `<div class="${cls}" id="mnc-p${pitIdx}" data-pit="${pitIdx}" ${valid ? `onclick="moveMancala(${pitIdx})"` : ''}>
      ${mncSeedsHTML(pitIdx, count, side, MNC_PIT_SEED_CAP)}
      ${count > 0 ? `<span class="mnc-chip">${count}</span>` : ''}
    </div>`;
  };
  let html = store(v.oppStoreIndex, 'opp', 'os') + store(v.myStoreIndex, 'mine', 'ms');
  v.myPitIndices.forEach((p, i) => { html += pit(p, 'mine', 'm' + i); });
  v.oppPitIndices.forEach((p, i) => { html += pit(p, 'opp', 'od' + i); });
  return html;
}

// Reconcile a pit's DOM (seeds, chip/count, empty state) to a target count.
function mncSetPit(pitIdx, count, opts = {}) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  const isStore = el.classList.contains('mnc-store');
  const side = el.classList.contains('mine') ? 'mine' : 'opp';
  const cap = isStore ? MNC_STORE_SEED_CAP : MNC_PIT_SEED_CAP;
  const seeds = el.querySelectorAll('.mnc-sd');
  const want = Math.min(count, cap);
  for (let k = seeds.length - 1; k >= want; k--) seeds[k].remove();
  for (let k = seeds.length; k < want; k++) {
    const s = document.createElement('span');
    s.className = `mnc-sd ${side} v${k % 3}${opts.drop ? ' drop-in' : ''}`;
    s.style.cssText = mncSeedStyle(pitIdx, k);
    el.appendChild(s);
  }
  if (isStore) {
    const countEl = el.querySelector('.mnc-scount');
    if (countEl) countEl.textContent = count;
  } else {
    el.classList.toggle('empty', count === 0);
    let chip = el.querySelector('.mnc-chip');
    if (count === 0) {
      if (chip) chip.remove();
    } else {
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'mnc-chip';
        el.appendChild(chip);
      }
      chip.textContent = count;
      if (opts.drop) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    }
  }
}

function mncPitFx(pitIdx, cls, ms) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// ---- the sowing hand
function mncHandPlace(hand, pitIdx) {
  const el = document.getElementById(`mnc-p${pitIdx}`);
  if (!el) return;
  hand.style.left = `${el.offsetLeft + el.offsetWidth / 2}px`;
  hand.style.top = `${el.offsetTop + el.offsetHeight / 2}px`;
}
function mncHandShow(side, pitIdx, count) {
  const board = $('mncBoard');
  if (!board) return;
  let hand = $('mncHand');
  if (!hand) {
    hand = document.createElement('div');
    hand.id = 'mncHand';
    board.appendChild(hand);
  }
  hand.className = `mnc-hand ${side}`;
  hand.style.transition = 'none';
  mncHandPlace(hand, pitIdx);
  hand.style.opacity = '0';
  void hand.offsetWidth;
  hand.style.transition = '';
  hand.style.opacity = '1';
  hand.textContent = count;
}
function mncHandTo(pitIdx, remaining) {
  const hand = $('mncHand');
  if (!hand) return;
  mncHandPlace(hand, pitIdx);
  hand.textContent = remaining > 0 ? remaining : '';
}
function mncHandHide() {
  const hand = $('mncHand');
  if (hand) hand.style.opacity = '0';
}

// Seed in flight from one pit to another (captures + endgame sweep).
function mncFly(fromPit, toPit, side) {
  const board = $('mncBoard');
  const from = document.getElementById(`mnc-p${fromPit}`);
  const to = document.getElementById(`mnc-p${toPit}`);
  if (!board || !from || !to) return;
  const seed = document.createElement('span');
  seed.className = `mnc-floater ${side}`;
  const sx = from.offsetLeft + from.offsetWidth / 2;
  const sy = from.offsetTop + from.offsetHeight / 2;
  const ex = to.offsetLeft + to.offsetWidth / 2 + (Math.random() * 20 - 10);
  const ey = to.offsetTop + to.offsetHeight / 2 + (Math.random() * 14 - 7);
  seed.style.setProperty('--dx', `${ex - sx}px`);
  seed.style.setProperty('--dy', `${ey - sy}px`);
  board.appendChild(seed);
  seed.style.left = `${sx - seed.offsetWidth / 2}px`;
  seed.style.top = `${sy - seed.offsetHeight / 2}px`;
  setTimeout(() => seed.remove(), 500);
}

function mncBanner(v, d) {
  const banner = $('mncStatus');
  if (!banner) return;
  const myScore = v.pits[v.myStoreIndex];
  const oppScore = v.pits[v.oppStoreIndex];
  if (v.phase === 'over') {
    const tied = v.winner === 'draw';
    const won = v.winner === v.myPiece;
    banner.className = 'status ' + (tied ? 'them draw' : won ? 'win' : 'lose');
    banner.textContent = tied
      ? `DRAW -- ${myScore} to ${oppScore}`
      : won
        ? `VICTORY -- you banked ${myScore} seeds`
        : `DEFEAT -- opponent banked ${oppScore} seeds`;
    if (!mncOverFxDone) {
      mncOverFxDone = true;
      battleSfx(won ? 'win' : 'lose');
      battleVibrate(won ? [40, 60, 40, 60, 120] : [200]);
    }
  } else if (v.isMyTurn) {
    banner.className = 'status you';
    banner.textContent = 'YOUR SOW -- pick one of your pits';
  } else {
    banner.className = 'status them';
    banner.textContent = `OPPONENT TURN -- ${(d && d.opponentName) || 'opponent'} is sowing...`;
  }
}

// Replays every logged move since the last poll as one continuous timeline:
// hand picks up, walks the pits dropping seeds, captures raid the store,
// and the endgame sweep flies leftovers home.
function mncAnimateMoves(v, entries, basePits) {
  mncAnimating = true;
  const board = $('mncBoard');
  if (board) board.classList.remove('my-turn');
  const banner = $('mncStatus');
  const running = basePits.slice();
  const frames = [];
  let dropCount = 0;

  for (const e of entries) {
    const mover = e.by === v.myPiece ? 'mine' : 'opp';
    const store = e.by === v.myPiece ? v.myStoreIndex : v.oppStoreIndex;
    frames.push({ type: 'pickup', pit: e.pickup, mover, count: e.seq.length });
    running[e.pickup] = 0;
    e.seq.forEach((pitIdx, j) => {
      running[pitIdx]++;
      dropCount++;
      frames.push({
        type: 'drop', pit: pitIdx, count: running[pitIdx],
        left: e.seq.length - j - 1, isStore: pitIdx === 6 || pitIdx === 13,
      });
    });
    frames.push({ type: 'hand-hide' });
    if (e.capture > 0 && e.captureFrom >= 0) {
      const last = e.seq[e.seq.length - 1];
      frames.push({ type: 'capture', from: e.captureFrom, last, store, gained: e.capture, mover });
      running[store] += e.capture;
      running[e.captureFrom] = 0;
      running[last] = 0;
      frames.push({ type: 'settle', pits: [[e.captureFrom, 0], [last, 0], [store, running[store]]] });
    }
    if (e.extraTurn) frames.push({ type: 'bonus', store, mover });
  }

  if (v.phase === 'over') {
    for (let i = 0; i < 14; i++) {
      if (i === 6 || i === 13) continue;
      if (running[i] !== v.pits[i] && running[i] > 0) {
        const store = i <= 5 ? 6 : 13;
        frames.push({ type: 'sweep', pit: i, store, n: running[i] });
        running[store] += running[i];
        running[i] = 0;
        frames.push({ type: 'settle', pits: [[i, 0], [store, running[store]]] });
      }
    }
  }

  const STEP = Math.max(130, Math.min(230, 2800 / Math.max(1, dropCount)));

  let idx = 0;
  function run() {
    if (!mncAnimating) return; // cancelled by reset/leave
    const f = frames[idx++];
    if (!f) { finish(); return; }
    let delay = STEP;
    if (f.type === 'pickup') {
      mncHandShow(f.mover, f.pit, f.count);
      mncSetPit(f.pit, 0);
      mncPitFx(f.pit, 'pickup-anim', 320);
      mncSfx('pickup');
      if (banner) {
        banner.className = 'status ' + (f.mover === 'mine' ? 'you' : 'them');
        banner.textContent = f.mover === 'mine' ? 'SOWING...' : 'OPPONENT SOWS...';
      }
      delay = 300;
    } else if (f.type === 'drop') {
      mncHandTo(f.pit, f.left);
      const dropIdx = idx;
      setTimeout(() => {
        mncSetPit(f.pit, f.count, { drop: true });
        mncPitFx(f.pit, 'land', 280);
        mncSfx(f.isStore ? 'store' : 'sow', dropIdx);
      }, STEP * 0.55);
    } else if (f.type === 'hand-hide') {
      mncHandHide();
      delay = 140;
    } else if (f.type === 'capture') {
      mncSfx('capture');
      battleVibrate([12, 40, 18]);
      mncPitFx(f.from, 'raided', 600);
      mncPitFx(f.last, 'raided', 600);
      const flights = Math.min(f.gained, 10);
      for (let k = 0; k < flights; k++) {
        setTimeout(() => mncFly(k % 3 === 2 ? f.last : f.from, f.store, f.mover), k * 45);
      }
      const storeEl = document.getElementById(`mnc-p${f.store}`);
      if (storeEl) { storeEl.classList.remove('capture-anim'); void storeEl.offsetWidth; storeEl.classList.add('capture-anim'); }
      if (banner) {
        banner.className = 'status ' + (f.mover === 'mine' ? 'win' : 'lose');
        banner.textContent = (f.mover === 'mine' ? 'YOU SNATCH ' : 'OPPONENT SNATCHES ') + f.gained + ' SEEDS!';
      }
      delay = 620;
    } else if (f.type === 'settle') {
      f.pits.forEach(([p, c]) => mncSetPit(p, c, { drop: true }));
      delay = 220;
    } else if (f.type === 'bonus') {
      mncSfx('bonus');
      battleVibrate(30);
      const storeEl = document.getElementById(`mnc-p${f.store}`);
      if (storeEl) { storeEl.classList.remove('extraturn-anim'); void storeEl.offsetWidth; storeEl.classList.add('extraturn-anim'); }
      if (banner && v.phase === 'battle') {
        banner.className = 'status ' + (f.mover === 'mine' ? 'win' : 'them');
        banner.textContent = f.mover === 'mine' ? 'BONUS SOW -- GO AGAIN!' : 'OPPONENT SOWS AGAIN...';
      }
      delay = 600;
    } else if (f.type === 'sweep') {
      const side = f.store === v.myStoreIndex ? 'mine' : 'opp';
      const flights = Math.min(f.n, 6);
      for (let k = 0; k < flights; k++) setTimeout(() => mncFly(f.pit, f.store, side), k * 40);
      mncSetPit(f.pit, 0);
      mncSfx('sweep', idx);
      delay = 170;
    }
    setTimeout(run, delay);
  }

  function finish() {
    if (!mncAnimating) return; // cancelled by reset/leave
    mncAnimating = false;
    mncLastPits = v.pits.slice();
    mncLastMoveNumber = entries[entries.length - 1].n;
    mncBoardSig = '';
    if (lastView && lastView.ui === 'mancala') renderMancala(mncLastData, lastView);
  }

  run();
}

function mncSig(v) {
  return v.pits.join(',') + '|' + v.phase + '|' + v.isMyTurn + '|' + (v.validMoves || []).join('.');
}

function renderMancala(d, v) {
  const board = $('mncBoard');
  if (!board) return;
  mncLastData = d;

  if (!board.children.length || !mncLastPits) {
    board.innerHTML = buildMancalaBoard(v, v.pits);
    mncLastPits = v.pits.slice();
    mncLastMoveNumber = v.moveNumber || 0;
    mncBoardSig = mncSig(v);
  } else if (!mncAnimating) {
    const entries = (v.moveLog || []).filter(e => e.n > mncLastMoveNumber);
    if (entries.length) {
      mncAnimateMoves(v, entries, mncLastPits);
    } else {
      const sig = mncSig(v);
      if (sig !== mncBoardSig) {
        board.innerHTML = buildMancalaBoard(v, v.pits);
        mncBoardSig = sig;
      }
      mncLastPits = v.pits.slice();
      mncLastMoveNumber = v.moveNumber || 0;
    }
  }

  board.classList.toggle('my-turn', !mncAnimating && v.isMyTurn && v.phase === 'battle');
  if (!mncAnimating) mncBanner(v, d);
}

async function moveMancala(pitIdx) {
  if (mncAnimating) return;
  if (!lastView || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  if (!lastView.validMoves.includes(pitIdx)) { toast('That pit is empty.'); return; }

  mncEnsureAudio();
  battleVibrate(10);
  await postMove({ pit: pitIdx });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetMancalaUi() {
  if (!$('mncBoard')) return;
  $('mncBoard').innerHTML = '';
  $('mncBoard').classList.remove('my-turn');
  mncLastPits = null; mncLastMoveNumber = 0; mncBoardSig = ''; mncAnimating = false; mncOverFxDone = false;
}
