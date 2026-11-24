(function () {
  'use strict';

  // Pig, the two-dice kind, for 2 to 4 players. On your turn you roll both dice as often
  // as you dare. Each roll adds to the turn's pot; "bank" moves the pot into your score
  // and ends the turn. A 1 on either die is a pig: the pot is lost and the turn ends. Two
  // pigs at once also wipe your whole score. First to bank 100 wins.
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const TARGET = 100;
  const LOG_KEPT = 12;

  function rollDie() { return 1 + Math.floor(Math.random() * 6); }

  function nextTurn(state) {
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
    state.turn = state.players[state.turnIndex];
    state.pot = 0;
    state.rolls = 0;
  }

  function record(state, entry) {
    state.moveNumber = (state.moveNumber || 0) + 1;
    state.log = (state.log || []).slice(-(LOG_KEPT - 1));
    state.log.push({ n: state.moveNumber, ...entry });
    state.lastAction = state.log[state.log.length - 1];
  }

  // The pot a careful player banks at. Near the end the only thing that matters is
  // getting to the target before the leader's next turn.
  function holdAt(state, who, level) {
    const mine = state.scores[who] || 0;
    const toWin = TARGET - mine;
    if (level === 'easy') return Math.min(toWin, 8);
    const lead = Math.max(0, ...state.players.filter(slot => slot !== who).map(slot => state.scores[slot] || 0));
    if (level === 'hard') {
      if (lead >= TARGET - 20 || toWin <= 25) return toWin; // somebody is about to win: go for it
      const behind = lead - mine;
      return Math.min(toWin, behind > 25 ? 28 : behind < -25 ? 19 : 23);
    }
    return Math.min(toWin, 13);
  }

  const pig = {
    meta: {
      id: 'pig',
      name: 'Pig',
      description: 'Roll two dice and bank the pot, or risk it for more. First to 100 wins.',
      supportsComputer: true,
      ui: 'pig',
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    },

    init() {
      return {
        phase: 'lobby',
        players: [],
        scores: {},
        turnIndex: 0,
        turn: null,
        pot: 0,
        rolls: 0,
        dice: null,
        winner: null,
        lastAction: null,
        moveNumber: 0,
        log: [],
      };
    },

    onPlayerJoined(state, who) {
      if (state.phase !== 'lobby' || state.players.includes(who) || state.players.length >= MAX_PLAYERS) return;
      state.players.push(who);
      state.scores[who] = 0;
    },

    validateSetup() { return null; },
    computerSetup() { return null; },

    // dice: tests pass the roll in; play never does (see the server and solo.js, which
    // hand over only what the player sent, and a sent roll is ignored below).
    applyMove(state, who, move, players, dice) {
      if (!state.players.includes(who)) return 'You are not seated at this table.';
      const action = move && move.action;
      if (state.phase === 'lobby') {
        if (action !== 'start') return 'Waiting for the host to start the game.';
        if (who !== state.players[0]) return 'Only the host can start the game.';
        if (state.players.length < MIN_PLAYERS) return 'Pig needs at least two players.';
        state.phase = 'battle';
        state.turnIndex = 0;
        state.turn = state.players[0];
        state.pot = 0;
        state.rolls = 0;
        return null;
      }
      if (state.phase !== 'battle') return 'Game is already over.';
      if (state.turn !== who) return 'Not your turn.';

      if (action === 'roll') {
        const rolled = Array.isArray(dice) && dice.length === 2 ? dice.slice() : [rollDie(), rollDie()];
        state.dice = rolled;
        state.rolls = (state.rolls || 0) + 1;
        const pigs = rolled.filter(value => value === 1).length;
        if (pigs === 2) {
          const lost = (state.scores[who] || 0) + state.pot;
          state.scores[who] = 0;
          record(state, { by: who, action: 'roll', dice: rolled, result: 'wipe', lost, pot: 0, score: 0 });
          nextTurn(state);
        } else if (pigs === 1) {
          const lost = state.pot;
          record(state, { by: who, action: 'roll', dice: rolled, result: 'bust', lost, pot: 0, score: state.scores[who] || 0 });
          nextTurn(state);
        } else {
          state.pot += rolled[0] + rolled[1];
          record(state, { by: who, action: 'roll', dice: rolled, result: 'add', pot: state.pot, score: state.scores[who] || 0 });
        }
        return null;
      }

      if (action === 'bank') {
        if (!state.pot) return 'Roll first: there is nothing to bank.';
        const banked = state.pot;
        state.scores[who] = (state.scores[who] || 0) + banked;
        record(state, { by: who, action: 'bank', banked, pot: 0, score: state.scores[who] });
        if (state.scores[who] >= TARGET) {
          state.winner = who;
          state.phase = 'over';
          state.pot = 0;
        } else {
          nextTurn(state);
        }
        return null;
      }

      return 'Roll or bank.';
    },

    viewFor(state, who, players = []) {
      const names = Object.fromEntries(players.map(player => [player.slot, player.name]));
      const isMyTurn = state.phase === 'battle' && state.turn === who;
      return {
        ui: 'pig',
        phase: state.phase,
        turn: state.turn,
        winner: state.winner,
        canStart: state.phase === 'lobby' && who === state.players[0] && state.players.length >= MIN_PLAYERS,
        players: state.players.map(slot => ({ slot, name: names[slot] || slot, score: state.scores[slot] || 0, you: slot === who })),
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        target: TARGET,
        pot: state.pot || 0,
        rolls: state.rolls || 0,
        dice: state.dice ? state.dice.slice() : null,
        isMyTurn,
        canBank: isMyTurn && state.pot > 0,
        lastAction: state.lastAction,
        moveNumber: state.moveNumber || 0,
        moveLog: (state.log || []).slice(),
      };
    },

    // easy: banks at 8. normal: banks at 13. hard: banks around 23, more when far
    // behind, less when far ahead, and rolls for the win once anybody is close.
    computerMove(state, who, level = 'normal') {
      if (state.phase !== 'battle' || state.turn !== who) return null;
      if (!state.pot) return { action: 'roll' };
      return { action: state.pot >= holdAt(state, who, level) ? 'bank' : 'roll' };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = pig;
  if (typeof window !== 'undefined') {
    if (window.TurnBasedGamesRegistry) {
      window.TurnBasedGamesRegistry.registerGame({ ...pig.meta, module: pig });
    } else {
      window.TurnBasedGames = window.TurnBasedGames || {};
      window.TurnBasedGames.pig = pig;
    }
  }
})();
