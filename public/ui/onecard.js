// One Card screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
let oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null, lastGesture: null };

// ---------------- One Card ----------------
let unoAnimating = false;
let unoPrevView = null;      // discard/counts snapshot animations run from
let unoLastMoveNumber = 0;
let unoHandSig = '';
let unoOverFxDone = false;
let unoWasMyTurn = false;
let unoPendingWild = null;
let unoLastData = null;

function oneCardLabel(card) {
  if (!card) return '-';
  if (card.kind === 'wild4') return '+4';
  if (card.kind === 'wild') return 'WILD';
  if (card.kind === 'draw2') return '+2';
  if (card.kind === 'reverse') return 'REV';
  if (card.kind === 'skip') return 'SKIP';
  return card.rank;
}
function oneCardColor(card, fallback) {
  if (!card) return fallback || 'red';
  return card.color === 'wild' ? (fallback || 'wild') : card.color;
}
function oneCardName(card) {
  if (!card) return 'Empty discard';
  const color = card.color === 'wild' ? 'Wild' : card.color;
  return `${color} ${oneCardLabel(card)}`;
}
function oneCardCanPlay(v, card) {
  return v.phase === 'battle' && v.turn === session.you && v.legalCardIds.includes(card.id);
}
function resetOneCardHandUi() {
  oneCardHandUi = { selectedIndex: 0, selectedCardId: null, raised: false, gesture: null, lastGesture: null };
}
function clampOneCardIndex(index, hand) {
  if (!hand.length) return 0;
  return Math.max(0, Math.min(hand.length - 1, index));
}
function syncOneCardSelection(hand) {
  if (!hand.length) {
    oneCardHandUi.selectedIndex = 0;
    oneCardHandUi.selectedCardId = null;
    oneCardHandUi.raised = false;
    return;
  }
  const existing = hand.findIndex(card => card.id === oneCardHandUi.selectedCardId);
  oneCardHandUi.selectedIndex = existing >= 0
    ? existing
    : clampOneCardIndex(oneCardHandUi.selectedCardId == null ? Math.floor((hand.length - 1) / 2) : oneCardHandUi.selectedIndex, hand);
  oneCardHandUi.selectedCardId = hand[oneCardHandUi.selectedIndex].id;
}
function setOneCardSelection(hand, index, raised = true) {
  oneCardHandUi.selectedIndex = clampOneCardIndex(index, hand);
  oneCardHandUi.selectedCardId = hand[oneCardHandUi.selectedIndex] ? hand[oneCardHandUi.selectedIndex].id : null;
  oneCardHandUi.raised = !!(raised && hand.length);
  layoutOneCardFan(hand);
}
function oneCardFanMetrics(hand) {
  const n = Math.max(1, hand.length);
  const handEl = $('oneCardHand');
  const width = Math.max(280, (handEl && handEl.clientWidth) || window.innerWidth || 360);
  const cardWidth = Math.max(54, Math.min(92, 92 - Math.max(0, n - 7) * 4));
  const usable = Math.max(0, width - cardWidth - 20);
  const step = n <= 1 ? 0 : Math.min(cardWidth * 0.64, usable / (n - 1));
  return { n, cardWidth, step };
}
function layoutOneCardFan(hand) {
  const handEl = $('oneCardHand');
  if (!handEl) return;
  syncOneCardSelection(hand);
  const { n, cardWidth, step } = oneCardFanMetrics(hand);
  const selected = oneCardHandUi.selectedIndex;
  handEl.style.setProperty('--hand-card-w', `${cardWidth}px`);
  handEl.style.setProperty('--hand-count', String(n));
  handEl.style.setProperty('--selected-index', String(selected));
  handEl.classList.toggle('raised', oneCardHandUi.raised);
  handEl.querySelectorAll('.one-card-card').forEach((cardEl, i) => {
    const offset = i - (n - 1) / 2;
    const fromSelected = i - selected;
    const absSelected = Math.abs(fromSelected);
    const selectedLift = oneCardHandUi.raised && i === selected ? -72 : 0;
    const neighborLift = oneCardHandUi.raised && absSelected === 1 ? -18 : 0;
    cardEl.style.setProperty('--fan-x', `${offset * step}px`);
    cardEl.style.setProperty('--fan-y', `${Math.abs(offset) * 4 + selectedLift + neighborLift}px`);
    cardEl.style.setProperty('--fan-rot', `${offset * Math.max(3.3, 7 - n * 0.18)}deg`);
    cardEl.style.setProperty('--fan-scale', oneCardHandUi.raised && i === selected ? '1.08' : '1');
    cardEl.style.setProperty('--fan-z', String(50 + (oneCardHandUi.raised ? 30 - absSelected : i) + (i === selected ? 100 : 0)));
    cardEl.classList.toggle('selected', i === selected);
    cardEl.classList.toggle('peek-left', oneCardHandUi.raised && fromSelected === -1);
    cardEl.classList.toggle('peek-right', oneCardHandUi.raised && fromSelected === 1);
  });
}
function startOneCardHandGesture(event, index) {
  if (!lastView || lastView.ui !== 'onecard' || !(lastView.hand || []).length) return;
  const hand = lastView.hand;
  const targetIndex = Number.isFinite(index) ? index : oneCardHandUi.selectedIndex;
  const targetCard = hand[clampOneCardIndex(targetIndex, hand)];
  const wasSelected = oneCardHandUi.raised && !!targetCard && oneCardHandUi.selectedCardId === targetCard.id;
  setOneCardSelection(hand, targetIndex, true);
  oneCardHandUi.gesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    lastT: performance.now(),
    moved: false,
    wasSelected,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
function moveOneCardHandGesture(event) {
  const gesture = oneCardHandUi.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId || !lastView) return;
  const hand = lastView.hand || [];
  const { step } = oneCardFanMetrics(hand);
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) gesture.moved = true;
  if (gesture.startIndex == null) gesture.startIndex = oneCardHandUi.selectedIndex;
  const deltaCards = Math.round(dx / Math.max(28, step * 0.72));
  const nextIndex = clampOneCardIndex(gesture.startIndex + deltaCards, hand);
  if (nextIndex !== oneCardHandUi.selectedIndex) setOneCardSelection(hand, nextIndex, true);
  gesture.lastX = event.clientX;
  gesture.lastY = event.clientY;
  gesture.lastT = performance.now();
  event.preventDefault();
}
function finishOneCardHandGesture(event) {
  const gesture = oneCardHandUi.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId || !lastView) return;
  const hand = lastView.hand || [];
  const dx = event.clientX - gesture.startX;
  const dy = event.clientY - gesture.startY;
  const elapsed = Math.max(1, performance.now() - gesture.lastT);
  const vy = (event.clientY - gesture.lastY) / elapsed;
  const selected = hand[oneCardHandUi.selectedIndex];
  oneCardHandUi.gesture = null;
  oneCardHandUi.lastGesture = gesture;
  if (dy < -86 || vy < -0.75) {
    if (selected && oneCardCanPlay(lastView, selected)) {
      oneCardHandUi.raised = false;
      layoutOneCardFan(hand);
      playOneCard(selected);
    } else {
      toast('That card is not legal right now.');
      setOneCardSelection(hand, oneCardHandUi.selectedIndex, true);
    }
  } else if (dy > 64 || vy > 0.75) {
    oneCardHandUi.raised = false;
    layoutOneCardFan(hand);
  } else {
    setOneCardSelection(hand, oneCardHandUi.selectedIndex, true);
  }
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) event.preventDefault();
}
function unoSnapshot(v) {
  return {
    top: v.topCard,
    color: v.currentColor,
    direction: v.direction,
    drawCount: v.drawCount || 0,
    counts: Object.fromEntries((v.players || []).map(p => [p.slot, p.cards])),
  };
}
function unoSlotName(v, slot) {
  const p = (v.players || []).find(x => x.slot === slot);
  return p ? (p.you ? 'You' : p.name) : slot;
}
function unoActionText(v, a) {
  if (!a) return '';
  if (a.card) {
    let t = `${unoSlotName(v, a.by)} played ${a.card}.`;
    if (a.drawTarget) t += ` ${unoSlotName(v, a.drawTarget)} picked up the penalty.`;
    return t;
  }
  if (a.by) return `${unoSlotName(v, a.by)} ${a.drawn ? 'drew a card and passed.' : 'had nothing to draw and passed.'}`;
  return a.text || '';
}

function unoSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'play') {
    battleNoise(audio, t, 0.06, { freq: 1800, type: 'highpass', gain: 0.1 });
    battleTone(audio, t, 340, 0.08, { type: 'triangle', gain: 0.06 });
  } else if (kind === 'skip') {
    battleTone(audio, t, 700, 0.09, { type: 'square', gain: 0.05 });
    battleTone(audio, t + 0.09, 500, 0.12, { type: 'square', gain: 0.05 });
  } else if (kind === 'reverse') {
    battleTone(audio, t, 420, 0.1, { type: 'triangle', gain: 0.06, slideTo: 640 });
    battleTone(audio, t + 0.1, 640, 0.1, { type: 'triangle', gain: 0.06, slideTo: 420 });
  } else if (kind === 'wild') {
    [420, 530, 660].forEach((f, i) => battleTone(audio, t + i * 0.07, f, 0.12, { type: 'triangle', gain: 0.06 }));
  } else if (kind === 'penalty') {
    battleTone(audio, t, 520, 0.3, { slideTo: 150, gain: 0.09 });
    battleNoise(audio, t + 0.04, 0.2, { freq: 700, gain: 0.12 });
  } else if (kind === 'draw') {
    battleNoise(audio, t, 0.1, { freq: 900, gain: 0.08 });
  } else if (kind === 'uno') {
    battleTone(audio, t, 880, 0.1, { type: 'square', gain: 0.06 });
    battleTone(audio, t + 0.12, 880, 0.14, { type: 'square', gain: 0.07 });
  } else if (kind === 'turn') {
    battleTone(audio, t, 1000, 0.06, { type: 'square', gain: 0.04 });
  }
}

// Cells of art/cards.png. A draw card keeps its count as text under the stamp.
const UNO_STAMP = { skip: 0, reverse: 1, draw2: 2, wild: 3, wild4: 3 };
function unoCardFaceHTML(card) {
  const label = oneCardLabel(card);
  const stamp = card ? UNO_STAMP[card.kind] : undefined;
  if (stamp == null) return `<span${label.length > 2 ? ' class="sm"' : ''}>${label}</span>`;
  const count = card.kind === 'draw2' || card.kind === 'wild4';
  return `<i class="card-stamp s${stamp}" aria-hidden="true"></i>`
    + `<span class="${count ? 'count' : 'word' + (label.length > 2 ? ' sm' : '')}">${label}</span>`;
}
function unoSetDiscard(top, color) {
  const discard = $('oneCardDiscard');
  if (!discard) return;
  discard.className = `one-card-card ${oneCardColor(top, color)}`;
  discard.innerHTML = `${unoCardFaceHTML(top)}<small>${oneCardName(top)}</small>`;
}
function unoSetColorDots(color) {
  const colorDots = $('oneCardColorDots');
  if (!colorDots) return;
  colorDots.innerHTML = '';
  ['red', 'gold', 'green', 'blue'].forEach(c => {
    const dot = document.createElement('span');
    dot.className = `color-dot ${c}` + (color === c ? ' active' : '');
    colorDots.appendChild(dot);
  });
}
function unoSetDirection(direction) {
  const el = $('oneCardDirection');
  if (!el) return;
  el.textContent = direction === -1 ? '<<' : '>>';
  el.title = direction === -1 ? 'Play order reversed' : 'Normal play order';
}
function unoChipEl(slot) { return document.getElementById(`uno-opp-${slot}`); }
function unoSetOppCount(slot, count) {
  const chip = unoChipEl(slot);
  if (!chip) return;
  const ct = chip.querySelector('.ct');
  if (ct) {
    ct.textContent = count === 1 ? 'ONE!' : count;
    ct.classList.remove('tick');
    void ct.offsetWidth;
    ct.classList.add('tick');
  }
  chip.classList.toggle('uno', count === 1);
}

// Diffed hand render: only rebuild the fan when the cards themselves change,
// so polling never destroys an in-progress swipe gesture.
function renderOneCardHand(v) {
  const handEl = $('oneCardHand');
  if (!handEl) return;
  const cards = v.hand || [];
  handEl.classList.toggle('empty', !cards.length);
  const sig = cards.map(c => c.id).join(',');
  if (sig !== unoHandSig) {
    unoHandSig = sig;
    handEl.innerHTML = '';
    cards.forEach((card, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.cardId = card.id;
      const label = oneCardLabel(card);
      const colorName = card.color === 'wild' ? 'Wild' : card.color;
      btn.innerHTML = `<b class="corner top">${label}</b>${unoCardFaceHTML(card)}<small>${colorName}</small><b class="corner bottom">${label}</b>`;
      btn.onclick = () => {
        const g = oneCardHandUi.lastGesture;
        oneCardHandUi.lastGesture = null;
        if (g && g.moved) return;
        if (!lastView) return;
        const cur = (lastView.hand || []).find(c => c.id === card.id);
        if (!cur) return;
        // First tap raises the card; tapping the raised card plays it.
        // Keyboard activation (no pointer gesture) plays directly.
        if (!g || g.wasSelected) playOneCard(cur);
      };
      btn.onpointerdown = event => startOneCardHandGesture(event, index);
      btn.onpointermove = moveOneCardHandGesture;
      btn.onpointerup = finishOneCardHandGesture;
      btn.onpointercancel = finishOneCardHandGesture;
      handEl.appendChild(btn);
    });
  }
  handEl.querySelectorAll('button').forEach((btn, i) => {
    const card = cards[i];
    if (!card) return;
    const canPlay = oneCardCanPlay(v, card);
    btn.className = `one-card-card ${oneCardColor(card)}` + (canPlay ? ' playable' : '');
    btn.setAttribute('aria-disabled', canPlay ? 'false' : 'true');
    btn.setAttribute('aria-label', `${oneCardName(card)}${canPlay ? ', playable' : ', not playable'}`);
  });
  layoutOneCardFan(cards);
}

function unoBanner(d, v) {
  const banner = $('oneCardStatus');
  if (!banner) return;
  const players = v.players || [];
  if (v.phase === 'lobby') {
    banner.className = 'status them';
    const solo = session && (session.mode === 'computer' || session.bot);
    banner.textContent = solo ? 'READY -- deal the cards when you are'
      : v.canStart ? 'READY -- start now or wait for more players' : `Share the code -- One Card starts with ${v.minPlayers}+ players`;
  } else if (v.phase === 'over') {
    const won = v.winner === session.you;
    const winner = players.find(p => p.slot === v.winner);
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? 'VICTORY -- hand cleared!' : `${winner ? winner.name : 'A rival'} emptied their hand`;
    if (!unoOverFxDone) {
      unoOverFxDone = true;
      battleSfx(won ? 'win' : 'lose');
      battleVibrate(won ? [40, 60, 40, 60, 120] : [200]);
    }
  } else if (v.turn === session.you) {
    banner.className = 'status you';
    banner.textContent = (v.legalCardIds || []).length ? 'YOUR PLAY -- match color, number, or symbol' : 'NO LEGAL CARDS -- draw one';
  } else {
    const current = players.find(p => p.slot === v.turn);
    banner.className = 'status them';
    banner.textContent = `${current ? current.name : 'A rival'} is choosing a card...`;
  }
}

function renderOneCardStatic(d, v, hold) {
  const snap = hold && unoPrevView ? unoPrevView : unoSnapshot(v);
  const players = v.players || [];
  const myTurn = v.phase === 'battle' && v.turn === session.you;

  const opponents = $('oneCardOpponents');
  opponents.innerHTML = '';
  const sigils = seatSigils(players);
  players.filter(p => !p.you).forEach(p => {
    const cards = snap.counts[p.slot] != null ? snap.counts[p.slot] : p.cards;
    const tile = document.createElement('div');
    tile.id = `uno-opp-${p.slot}`;
    tile.className = 'uno-opp'
      + (!hold && v.phase === 'battle' && v.turn === p.slot ? ' active' : '')
      + (!hold && v.phase === 'over' && v.winner === p.slot ? ' active' : '')
      + (cards === 1 ? ' uno' : '');
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = p.name;
    const count = document.createElement('strong');
    count.className = 'ct';
    count.textContent = cards === 1 ? 'ONE!' : cards;
    tile.append(name, count);
    tile.style.setProperty('--sg', sigils.get(p.slot));
    opponents.appendChild(tile);
  });

  const lobby = v.phase === 'lobby';
  $('oneCardCodeWrap').classList.toggle('hidden', !lobby);
  $('unoCenter').classList.toggle('hidden', lobby);
  $('oneCardLast').classList.toggle('hidden', lobby);
  $('oneCardHand').classList.toggle('hidden', lobby);
  $('oneCardCode').textContent = session.room;
  $('oneCardStart').classList.toggle('hidden', !lobby || !v.canStart);

  $('oneCardDeckCount').textContent = snap.drawCount;
  $('oneCardDeck').disabled = !(myTurn && !hold);
  unoSetDiscard(snap.top, snap.color);
  unoSetColorDots(snap.color);
  unoSetDirection(snap.direction);

  const drawBtn = $('oneCardDraw');
  drawBtn.disabled = !(myTurn && !hold);
  drawBtn.textContent = v.phase !== 'battle' ? 'DRAW'
    : !myTurn ? 'STANDBY'
    : (v.legalCardIds || []).length ? 'DRAW + PASS' : 'DRAW A CARD';

  renderOneCardHand(v);

  if (!hold) {
    unoBanner(d, v);
    $('oneCardLast').textContent = v.lastAction ? unoActionText(v, v.lastAction) : 'First to empty their hand wins.';
    if (myTurn && !unoWasMyTurn) { unoSfx('turn'); battleVibrate(12); }
    unoWasMyTurn = myTurn;
  }
}

// Card flying across the table (plays into the discard, draws off the deck).
function unoFly(fromEl, toEl, cls, html) {
  const sect = $('oneCard');
  if (!sect || !fromEl || !toEl) return;
  const sr = sect.getBoundingClientRect();
  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `uno-fly one-card-card ${cls}`;
  el.innerHTML = html || '';
  el.style.left = `${fr.left - sr.left + fr.width / 2}px`;
  el.style.top = `${fr.top - sr.top + fr.height / 2}px`;
  sect.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.left = `${tr.left - sr.left + tr.width / 2}px`;
    el.style.top = `${tr.top - sr.top + tr.height / 2}px`;
  }));
  setTimeout(() => el.remove(), 460);
}
function unoFlySource(by) {
  return by === session.you ? $('oneCardHand') : (unoChipEl(by) || $('oneCardDeck'));
}

// Replays every logged play/draw since the last poll (solo bots resolve
// several turns inside one poll; this shows them one by one).
function unoAnimateEntries(d, v, entries) {
  unoAnimating = true;
  const banner = $('oneCardStatus');
  const cur = unoPrevView
    ? { ...unoPrevView, counts: { ...unoPrevView.counts } }
    : unoSnapshot(v);

  const frames = [];
  for (const e of entries) {
    if (e.action === 'play' && e.card) {
      frames.push({ type: 'play', e });
      if (e.drawTarget && e.drawn) frames.push({ type: 'penalty', target: e.drawTarget, count: e.drawn });
    } else if (e.action === 'draw') {
      frames.push({ type: 'draw', target: e.by, count: e.count || 0 });
    }
  }

  let idx = 0;
  function run() {
    if (!unoAnimating) return; // cancelled by reset/leave
    const f = frames[idx++];
    if (!f) { finish(); return; }
    let delay = 460;
    if (f.type === 'play') {
      const e = f.e;
      const card = e.card;
      const mine = e.by === session.you;
      unoFly(unoFlySource(e.by), $('oneCardDiscard'), oneCardColor(card, e.color), unoCardFaceHTML(card));
      if (banner) {
        banner.className = 'status ' + (mine ? 'you' : 'them');
        banner.textContent = `${unoSlotName(v, e.by).toUpperCase()} PLAYS ${oneCardName(card).toUpperCase()}`;
      }
      setTimeout(() => {
        cur.top = card;
        cur.color = e.color;
        cur.direction = e.direction;
        unoSetDiscard(card, e.color);
        unoSetColorDots(e.color);
        unoSetDirection(e.direction);
        if (!mine) {
          cur.counts[e.by] = e.handLeft;
          unoSetOppCount(e.by, e.handLeft);
        }
        const kind = card.kind;
        unoSfx(kind === 'skip' ? 'skip'
          : kind === 'reverse' ? 'reverse'
          : (kind === 'wild' || kind === 'wild4') ? 'wild'
          : 'play');
        if (e.handLeft === 1) unoSfx('uno');
      }, 320);
      delay = 580;
    } else if (f.type === 'penalty') {
      unoSfx('penalty');
      if (f.target === session.you) battleVibrate([20, 40, 20]);
      const toEl = f.target === session.you ? $('oneCardHand') : unoChipEl(f.target);
      const flights = Math.min(f.count, 4);
      for (let k = 0; k < flights; k++) {
        setTimeout(() => unoFly($('oneCardDeck'), toEl, 'uno-back', '<span>+1</span>'), k * 110);
      }
      cur.drawCount = Math.max(0, cur.drawCount - f.count);
      setTimeout(() => {
        $('oneCardDeckCount').textContent = cur.drawCount;
        if (f.target !== session.you) {
          cur.counts[f.target] = (cur.counts[f.target] || 0) + f.count;
          unoSetOppCount(f.target, cur.counts[f.target]);
        }
      }, flights * 110 + 260);
      delay = flights * 110 + 500;
    } else if (f.type === 'draw') {
      unoSfx('draw');
      const toEl = f.target === session.you ? $('oneCardHand') : unoChipEl(f.target);
      if (f.count > 0) unoFly($('oneCardDeck'), toEl, 'uno-back', '');
      cur.drawCount = Math.max(0, cur.drawCount - f.count);
      setTimeout(() => {
        $('oneCardDeckCount').textContent = cur.drawCount;
        if (f.target !== session.you && f.count > 0) {
          cur.counts[f.target] = (cur.counts[f.target] || 0) + f.count;
          unoSetOppCount(f.target, cur.counts[f.target]);
        }
      }, 300);
      delay = 470;
    }
    setTimeout(run, delay);
  }

  function finish() {
    if (!unoAnimating) return; // cancelled by reset/leave
    unoAnimating = false;
    unoLastMoveNumber = entries[entries.length - 1].n;
    unoPrevView = cur;
    if (lastView && lastView.ui === 'onecard') renderOneCard(unoLastData, lastView);
  }

  run();
}

function renderOneCard(d, v) {
  unoLastData = d;
  if (unoAnimating) return;
  const entries = unoPrevView && v.phase !== 'lobby'
    ? (v.moveLog || []).filter(e => e.n > unoLastMoveNumber)
    : [];
  if (entries.length) {
    renderOneCardStatic(d, v, true);
    unoAnimateEntries(d, v, entries);
    return;
  }
  renderOneCardStatic(d, v, false);
  unoPrevView = unoSnapshot(v);
  unoLastMoveNumber = v.moveNumber || 0;
}

async function startOneCard() {
  try {
    await api('/api/move', 'POST', { room: session.room, move: { action: 'start' } });
    poll();
  } catch (e) { toast(e.message); }
}
function playOneCard(card) {
  if (unoAnimating) { toast('Hold on, the table is still playing.'); return; }
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  mncEnsureAudio();
  if (card.color === 'wild') {
    unoPendingWild = card;
    $('unoColorPick').classList.remove('hidden');
    return;
  }
  sendOneCardPlay({ action: 'play', cardId: card.id });
}
function pickWildColor(color) {
  const card = unoPendingWild;
  unoPendingWild = null;
  $('unoColorPick').classList.add('hidden');
  if (!card) return;
  if (!oneCardCanPlay(lastView, card)) { toast('That card is not legal right now.'); return; }
  sendOneCardPlay({ action: 'play', cardId: card.id, color });
}
function cancelWildColor() {
  unoPendingWild = null;
  $('unoColorPick').classList.add('hidden');
}
async function sendOneCardPlay(move) {
  battleVibrate(10);
  await postMove(move);
}
async function drawOneCard() {
  if (unoAnimating) { toast('Hold on, the table is still playing.'); return; }
  if (!lastView || lastView.ui !== 'onecard' || lastView.phase !== 'battle' || lastView.turn !== session.you) { toast('Not your turn.'); return; }
  mncEnsureAudio();
  battleVibrate(10);
  await postMove({ action: 'draw' });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetOneCardUi() {
  $('oneCardOpponents').innerHTML = '';
  resetOneCardHandUi();
  $('oneCardHand').innerHTML = '';
  unoAnimating = false; unoPrevView = null; unoLastMoveNumber = 0; unoHandSig = '';
  unoOverFxDone = false; unoWasMyTurn = false; unoPendingWild = null;
  if ($('unoColorPick')) $('unoColorPick').classList.add('hidden');
  document.querySelectorAll('.uno-fly').forEach(el => el.remove());
}
