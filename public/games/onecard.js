const ONECARD_COLORS = ['red', 'gold', 'green', 'blue'];
const ONECARD_HAND_SIZE = 7;
const ONECARD_MIN_PLAYERS = 2;
const ONECARD_MAX_PLAYERS = 4;

function oneOther(players, current, direction) {
  if (!players.length) return current;
  const index = Math.max(0, players.indexOf(current));
  return players[(index + direction + players.length) % players.length];
}
function syncTurn(state) {
  state.turn = currentTurn(state);
}
function oneCardName(card) {
  if (!card) return '';
  if (card.kind === 'wild4') return '+4 Wild';
  if (card.kind === 'wild') return 'Wild';
  if (card.kind === 'draw2') return `${card.color} +2`;
  return `${card.color} ${card.rank || card.kind}`;
}
function makeDeck() {
  let id = 1;
  const deck = [];
  const add = card => deck.push({ id: `oc${id++}`, ...card });
  for (const color of ONECARD_COLORS) {
    add({ color, kind: 'number', rank: '0' });
    for (let copy = 0; copy < 2; copy++) {
      for (let n = 1; n <= 9; n++) add({ color, kind: 'number', rank: String(n) });
      add({ color, kind: 'skip' });
      add({ color, kind: 'reverse' });
      add({ color, kind: 'draw2' });
    }
  }
  for (let i = 0; i < 4; i++) {
    add({ color: 'wild', kind: 'wild' });
    add({ color: 'wild', kind: 'wild4' });
  }
  return shuffle(deck);
}
function shuffle(cards) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function ensurePlayer(state, who) {
  if (!state.players.includes(who)) state.players.push(who);
  state.hands[who] = state.hands[who] || [];
}
function drawCard(state) {
  if (!state.drawPile.length && state.discardPile.length > 1) {
    const top = state.discardPile.pop();
    state.drawPile = shuffle(state.discardPile);
    state.discardPile = [top];
  }
  return state.drawPile.pop() || null;
}
function drawMany(state, who, count) {
  ensurePlayer(state, who);
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = drawCard(state);
    if (card) {
      state.hands[who].push(card);
      drawn.push(card.id);
    }
  }
  return drawn;
}
function activePlayers(state) { return state.players.filter(who => !state.eliminated.includes(who)); }
function currentTurn(state) { return activePlayers(state)[state.turnIndex] || null; }
function normalizeColor(color) { return ONECARD_COLORS.includes(color) ? color : ONECARD_COLORS[0]; }
function cardValue(card) { return card.kind === 'number' ? card.rank : card.kind; }
function isPlayable(card, state) {
  const top = state.discardPile[state.discardPile.length - 1];
  if (!card || !top) return false;
  if (card.color === 'wild') return true;
  return card.color === state.currentColor || cardValue(card) === state.currentValue;
}
function legalCards(state, who) { return (state.hands[who] || []).filter(card => isPlayable(card, state)); }
function advanceTurn(state, steps = 1) {
  const players = activePlayers(state);
  if (!players.length) { state.turn = null; return; }
  const current = currentTurn(state) || players[0];
  let index = players.indexOf(current);
  for (let i = 0; i < steps; i++) index = (index + state.direction + players.length) % players.length;
  state.turnIndex = index;
  syncTurn(state);
}
function beginBattle(state, players) {
  const active = players.map(p => p.slot).filter(Boolean);
  if (active.length < ONECARD_MIN_PLAYERS) return 'UNO needs at least two players.';
  state.players = active.slice(0, ONECARD_MAX_PLAYERS);
  state.hands = {};
  state.drawPile = makeDeck();
  state.discardPile = [];
  state.eliminated = [];
  state.players.forEach(who => { state.hands[who] = []; drawMany(state, who, ONECARD_HAND_SIZE); });
  let top;
  do { top = drawCard(state); } while (top && top.color === 'wild' && (state.drawPile.unshift(top), true));
  state.discardPile.push(top || { id: 'fallback', color: 'red', kind: 'number', rank: '0' });
  state.currentColor = state.discardPile[0].color;
  state.currentValue = cardValue(state.discardPile[0]);
  state.phase = 'battle';
  state.turnIndex = 0;
  state.direction = 1;
  state.moveNumber = 0;
  state.log = [];
  syncTurn(state);
  state.lastAction = { text: 'Game started. First player: A.' };
  return null;
}
function mostCommonColor(hand) {
  const counts = Object.fromEntries(ONECARD_COLORS.map(color => [color, 0]));
  hand.forEach(card => { if (counts[card.color] != null) counts[card.color]++; });
  return ONECARD_COLORS.slice().sort((a, b) => counts[b] - counts[a])[0];
}
function firstLegalMove(state, who) {
  const card = legalCards(state, who)[0];
  if (!card) return { action: 'draw' };
  return { action: 'play', cardId: card.id, color: card.color === 'wild' ? mostCommonColor(state.hands[who]) : card.color };
}
// Rolling public-action log so clients can animate every play/draw since
// their last poll (solo bots resolve several turns inside a single poll).
// Only public information goes in here: played cards and draw COUNTS.
function logAction(state, entry) {
  state.moveNumber = (state.moveNumber || 0) + 1;
  state.log = (state.log || []).slice(-15);
  state.log.push({ n: state.moveNumber, ...entry });
}

function cardSortKey(card) {
  const colorOrder = { red: 0, gold: 1, green: 2, blue: 3, wild: 4 };
  const kindOrder = { number: 0, skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 };
  return [colorOrder[card.color] ?? 99, kindOrder[card.kind] ?? 99, Number(card.rank || 0), card.id].join(':');
}
function sortHand(hand) {
  return hand.slice().sort((a, b) => cardSortKey(a).localeCompare(cardSortKey(b), undefined, { numeric: true }));
}

const onecard = {
  meta: {
    id: 'onecard',
    name: 'UNO',
    description: 'Classic color-and-number shedding chaos for 2-4 players.',
    supportsComputer: true,
    ui: 'onecard',
    minPlayers: ONECARD_MIN_PLAYERS,
    maxPlayers: ONECARD_MAX_PLAYERS,
  },

  computerPlayers() {
    return [
      { slot: 'B', name: 'Bot Blue' },
      { slot: 'C', name: 'Bot Green' },
      { slot: 'D', name: 'Bot Gold' },
    ];
  },
  computerSetup() { return null; },
  computerMove(state, who) { return firstLegalMove(state, who); },
  onPlayerJoined(state, who) { ensurePlayer(state, who); },

  init() {
    return {
      phase: 'lobby',
      players: [],
      hands: {},
      drawPile: [],
      discardPile: [],
      eliminated: [],
      turnIndex: 0,
      direction: 1,
      currentColor: null,
      currentValue: null,
      turn: null,
      winner: null,
      lastAction: null,
      moveNumber: 0,
      log: [],
    };
  },

  validateSetup() { return null; },

  applyMove(state, who, move, players = []) {
    if (!state.players.includes(who)) return 'You are not seated at this table.';
    const action = move && move.action;
    if (state.phase === 'lobby') {
      if (action !== 'start') return 'Waiting for the host to start the hand.';
      if (who !== 'A') return 'Only the host can start UNO.';
      return beginBattle(state, players.length ? players : state.players.map(slot => ({ slot })));
    }
    if (state.phase !== 'battle') return 'Game is already over.';
    if (currentTurn(state) !== who) return 'Not your turn.';

    if (action === 'draw') {
      const drawn = drawMany(state, who, 1);
      state.lastAction = {
        by: who,
        text: drawn.length ? `${who} drew a card and passed.` : `${who} had nothing to draw and passed.`,
        drawn: drawn.length,
      };
      logAction(state, { by: who, action: 'draw', count: drawn.length });
      advanceTurn(state);
      return null;
    }

    if (action !== 'play') return 'Choose a card or draw.';
    const hand = state.hands[who] || [];
    const index = hand.findIndex(card => card.id === move.cardId);
    if (index === -1) return 'That card is not in your hand.';
    const card = hand[index];
    if (!isPlayable(card, state)) return 'That card does not match the color, number, or symbol.';

    hand.splice(index, 1);
    state.discardPile.push(card);
    state.currentColor = card.color === 'wild' ? normalizeColor(move.color) : card.color;
    state.currentValue = cardValue(card);
    state.lastAction = { by: who, card: oneCardName(card), color: state.currentColor, text: `${who} played ${oneCardName(card)}.` };

    if (hand.length === 0) {
      state.phase = 'over';
      state.winner = who;
      state.turn = null;
      logAction(state, {
        by: who,
        action: 'play',
        card: { id: card.id, color: card.color, kind: card.kind, rank: card.rank || null },
        color: state.currentColor,
        handLeft: 0,
        drawTarget: null,
        drawn: 0,
        direction: state.direction,
      });
      return null;
    }

    let steps = 1;
    if (card.kind === 'skip') steps = 2;
    if (card.kind === 'reverse') {
      state.direction *= -1;
      steps = activePlayers(state).length === 2 ? 2 : 1;
    }
    if (card.kind === 'draw2' || card.kind === 'wild4') {
      const target = oneOther(activePlayers(state), who, state.direction);
      drawMany(state, target, card.kind === 'draw2' ? 2 : 4);
      state.lastAction.drawTarget = target;
      state.lastAction.text += ` ${target} drew ${card.kind === 'draw2' ? 2 : 4}.`;
      steps = 2;
    }
    logAction(state, {
      by: who,
      action: 'play',
      card: { id: card.id, color: card.color, kind: card.kind, rank: card.rank || null },
      color: state.currentColor,
      handLeft: hand.length,
      drawTarget: state.lastAction.drawTarget || null,
      drawn: state.lastAction.drawTarget ? (card.kind === 'draw2' ? 2 : 4) : 0,
      direction: state.direction,
    });
    advanceTurn(state, steps);
    return null;
  },

  viewFor(state, who, players = []) {
    syncTurn(state);
    const hand = sortHand(state.hands[who] || []);
    const visiblePlayers = (players.length ? players : state.players.map(slot => ({ slot, name: slot }))).filter(p => state.players.includes(p.slot));
    return {
      ui: 'onecard',
      phase: state.phase,
      turn: state.turn,
      winner: state.winner,
      canStart: state.phase === 'lobby' && who === 'A' && state.players.length >= ONECARD_MIN_PLAYERS,
      players: visiblePlayers.map(p => ({
        slot: p.slot,
        name: p.name || p.slot,
        cards: (state.hands[p.slot] || []).length,
        you: p.slot === who,
      })),
      minPlayers: ONECARD_MIN_PLAYERS,
      maxPlayers: ONECARD_MAX_PLAYERS,
      direction: state.direction,
      currentColor: state.currentColor,
      topCard: state.discardPile[state.discardPile.length - 1] || null,
      hand,
      legalCardIds: state.phase === 'battle' && currentTurn(state) === who ? legalCards(state, who).map(card => card.id) : [],
      drawCount: state.drawPile.length,
      discardCount: state.discardPile.length,
      lastAction: state.lastAction,
      moveNumber: state.moveNumber || 0,
      moveLog: (state.log || []).slice(),
    };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = onecard;
if (typeof window !== 'undefined') {
  if (window.TurnBasedGamesRegistry) {
    window.TurnBasedGamesRegistry.registerGame({ ...onecard.meta, module: onecard });
  } else {
    window.TurnBasedGames = window.TurnBasedGames || {};
    window.TurnBasedGames.onecard = onecard;
  }
}
