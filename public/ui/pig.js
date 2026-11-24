// Pig screen. app.js fetches this file the first time the game is opened (see
// ensureGameCode there). It runs in the page's global scope next to app.js, which holds
// what every game shares: the session, the server calls, sounds, the status banner.
const PIG_TUMBLE_MS = 520;
let pigUi = { seenN: 0, seen: false, holdUntil: 0, landTimer: null, faceTimer: null, landed: null, d: null, seatSig: '', overFxDone: false };

function pigSfx(kind) {
  if (!battleFxOn) return;
  const audio = mncEnsureAudio();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  if (kind === 'rattle') {
    for (let i = 0; i < 6; i++) battleNoise(audio, t + i * 0.075, 0.05, { freq: 1800 + (i % 3) * 500, type: 'highpass', gain: 0.07 });
  } else if (kind === 'land') {
    battleTone(audio, t, 300, 0.07, { type: 'triangle', gain: 0.08, slideTo: 210 });
    battleTone(audio, t + 0.06, 520, 0.08, { type: 'triangle', gain: 0.05 });
  } else if (kind === 'bust') {
    battleTone(audio, t, 300, 0.3, { type: 'sawtooth', gain: 0.05, slideTo: 110 });
    battleTone(audio, t + 0.16, 180, 0.34, { type: 'sawtooth', gain: 0.05, slideTo: 70 });
  } else if (kind === 'bank') {
    [880, 1175, 1568].forEach((freq, i) => battleTone(audio, t + i * 0.06, freq, 0.16, { type: 'triangle', gain: 0.06 }));
  }
}

function pigName(v, d, slot) {
  if (slot === d.you) return 'You';
  const seat = (v.players || []).find(player => player.slot === slot);
  return (seat && seat.name) || 'Opponent';
}

function pigLastText(v, d) {
  const last = v.lastAction;
  if (!last) return 'Roll both dice as often as you dare. A pig loses the pot.';
  const actor = pigName(v, d, last.by);
  if (last.action === 'bank') return `${actor} banked ${last.banked} and ${actor === 'You' ? 'have' : 'has'} ${last.score}.`;
  if (last.result === 'wipe') return `Two pigs! ${actor} lost everything${last.lost ? `: ${last.lost} points` : ''}.`;
  if (last.result === 'bust') return `${actor} rolled a pig${last.lost ? ` and lost a pot of ${last.lost}` : ''}.`;
  return `${actor} rolled ${last.dice[0]} and ${last.dice[1]}.`;
}

// The dice spin through random faces, then renderPig draws the real roll.
function pigTumble() {
  const dice = Array.from($('pigDice').children);
  const spin = () => dice.forEach(die => { die.className = `pig-die rolling f${1 + Math.floor(Math.random() * 6)}`; });
  pigUi.holdUntil = Date.now() + PIG_TUMBLE_MS;
  clearInterval(pigUi.faceTimer);
  clearTimeout(pigUi.landTimer);
  spin();
  pigUi.faceTimer = setInterval(spin, 85);
  pigUi.landTimer = setTimeout(() => {
    clearInterval(pigUi.faceTimer);
    pigUi.holdUntil = 0;
    if (lastView && lastView.ui === 'pig' && pigUi.d) renderPig(pigUi.d, lastView);
  }, PIG_TUMBLE_MS);
  $('pigRoll').disabled = true;
  $('pigBank').disabled = true;
  pigSfx('rattle');
  battleVibrate([8, 40, 8, 40, 8]);
}

function renderPig(d, v) {
  pigUi.d = d;
  const log = v.moveLog || [];
  const newest = log.length ? log[log.length - 1] : null;
  const fresh = pigUi.seen && newest && newest.n > pigUi.seenN ? newest : null;
  pigUi.seenN = v.moveNumber || 0;
  pigUi.seen = true;
  if (fresh) {
    pigUi.landed = fresh;
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (fresh.action === 'roll' && !still) pigTumble();
  }
  // A roll is in the air: the timer in pigTumble draws the result when it lands.
  if (Date.now() < pigUi.holdUntil) return;

  const lobby = v.phase === 'lobby';
  const over = v.phase === 'over';
  const players = v.players || [];
  const me = players.find(player => player.you) || { score: 0 };
  const turnName = pigName(v, d, v.turn);

  const seatSig = JSON.stringify([players, v.turn, v.phase, v.winner]);
  if (seatSig !== pigUi.seatSig) {
    const sigils = seatSigils(players.map(player => ({ slot: player.slot, name: player.name })));
    const seats = $('pigSeats');
    seats.innerHTML = '';
    for (const player of players) {
      const seat = document.createElement('div');
      seat.className = 'pig-seat ' + (player.you ? 'you' : 'opponent')
        + (!lobby && !over && v.turn === player.slot ? ' active' : '')
        + (over && v.winner === player.slot ? ' winner' : '');
      seat.style.setProperty('--sg', sigils.get(player.slot));
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = player.you ? 'You' : player.name;
      const score = document.createElement('strong');
      score.textContent = player.score;
      const bar = document.createElement('i');
      const fill = document.createElement('b');
      fill.style.width = `${Math.min(100, Math.round(player.score / (v.target || 100) * 100))}%`;
      bar.appendChild(fill);
      seat.append(name, score, bar);
      seats.appendChild(seat);
    }
    pigUi.seatSig = seatSig;
  }

  $('pigLobby').classList.toggle('hidden', !lobby);
  $('pigTable').classList.toggle('hidden', lobby);
  $('pigCode').textContent = session.room;
  $('pigStart').classList.toggle('hidden', !lobby || !v.canStart);

  const landed = pigUi.landed;
  pigUi.landed = null;
  const values = v.dice || [6, 6];
  const bust = !!(v.lastAction && v.lastAction.action === 'roll' && v.lastAction.result !== 'add');
  // Dice left over from the turn before are dimmed until the next player rolls.
  const stale = !v.dice || (!over && !v.rolls);
  Array.from($('pigDice').children).forEach((die, i) => {
    die.className = `pig-die f${values[i]}`
      + (stale ? ' stale' : '')
      + (v.dice && bust && values[i] === 1 ? ' pig' : '')
      + (landed && landed.action === 'roll' ? (landed.result === 'add' ? ' land' : ' thud') : '');
    die.setAttribute('aria-label', !v.dice ? 'Not rolled yet' : values[i] === 1 ? 'Pig' : String(values[i]));
  });
  $('pigPot').textContent = v.pot || 0;
  $('pigPotLabel').textContent = lobby || over ? 'Pot' : v.isMyTurn ? 'Your pot' : `${turnName}'s pot`;
  $('pigLast').textContent = pigLastText(v, d);

  const wins = v.isMyTurn && me.score + (v.pot || 0) >= (v.target || 100);
  const roll = $('pigRoll');
  const bank = $('pigBank');
  roll.disabled = !v.isMyTurn;
  roll.textContent = v.pot ? 'Roll again' : 'Roll';
  bank.disabled = !v.canBank;
  bank.textContent = wins ? 'Bank to win' : v.canBank ? `Bank ${v.pot}` : 'Bank';
  bank.classList.toggle('wins', wins);

  const banner = $('pigStatus');
  const end = $('pigEndBanner');
  if (over) {
    const won = v.winner === d.you;
    banner.className = 'status ' + (won ? 'win' : 'lose');
    banner.textContent = won ? `VICTORY - first to ${v.target}` : `DEFEAT - ${pigName(v, d, v.winner)} reached ${v.target}`;
    end.className = 'dots-end ' + (won ? 'win' : 'lose');
    $('pigEndTitle').textContent = won ? 'Victory' : 'Defeat';
    $('pigEndSub').textContent = players.map(player => `${player.you ? 'You' : player.name} ${player.score}`).join(', ');
    if (!pigUi.overFxDone) {
      battleSfx(won ? 'win' : 'lose');
      battleVibrate([18, 55, 18]);
      pigUi.overFxDone = true;
    }
  } else {
    end.classList.add('hidden');
    pigUi.overFxDone = false;
    if (lobby) {
      banner.className = 'status ' + (v.canStart ? 'you' : 'them');
      banner.textContent = v.canStart
        ? (players.length >= v.maxPlayers || document.body.classList.contains('vs-bot') ? 'READY - start the game' : 'READY - start now or wait for more players')
        : `Waiting for ${pigName(v, d, players[0] && players[0].slot)} to start the game`;
    } else if (v.isMyTurn) {
      banner.className = 'status you';
      banner.textContent = wins ? 'BANK IT - that wins the game' : v.pot ? `Roll again or bank ${v.pot}` : 'YOUR TURN - roll the dice';
    } else {
      banner.className = 'status them';
      banner.textContent = `Standing by - ${turnName} is rolling...`;
    }
    if (landed && landed.action === 'roll') {
      pigSfx(landed.result === 'add' ? 'land' : 'bust');
      if (landed.result !== 'add') battleVibrate([30, 60, 30]);
    } else if (landed && landed.action === 'bank') {
      pigSfx('bank');
    }
  }
}

async function rollPig() {
  if (!lastView || lastView.ui !== 'pig' || lastView.phase !== 'battle' || !lastView.isMyTurn) { toast('Not your turn.'); return; }
  mncEnsureAudio();
  await postMove({ action: 'roll' });
}

async function bankPig() {
  if (!lastView || lastView.ui !== 'pig' || !lastView.canBank) { toast(lastView && lastView.isMyTurn ? 'Roll first: there is nothing to bank.' : 'Not your turn.'); return; }
  mncEnsureAudio();
  await postMove({ action: 'bank' });
}

async function startPig() {
  mncEnsureAudio();
  await postMove({ action: 'start' });
}

// Called by resetGameUi() in app.js before another game takes the screen.
function resetPigUi() {
  clearInterval(pigUi.faceTimer);
  clearTimeout(pigUi.landTimer);
  if ($('pigSeats')) $('pigSeats').innerHTML = '';
  if ($('pigEndBanner')) $('pigEndBanner').classList.add('hidden');
  pigUi = { seenN: 0, seen: false, holdUntil: 0, landTimer: null, faceTimer: null, landed: null, d: null, seatSig: '', overFxDone: false };
}
