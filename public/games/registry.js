(function registerTurnBasedGamesRegistry(root) {
  const existing = root.TurnBasedGamesRegistry;
  const games = existing && existing.games ? existing.games : {};

  function registerGame(definition) {
    if (!definition || !definition.id || !definition.module) {
      throw new Error('Game registrations require id and module.');
    }
    games[definition.id] = {
      name: definition.name || definition.id,
      description: definition.description || '',
      supportsComputer: !!definition.supportsComputer,
      ui: definition.ui || definition.id,
      ...definition,
    };
    root.TurnBasedGames = root.TurnBasedGames || {};
    root.TurnBasedGames[definition.id] = definition.module;
    return games[definition.id];
  }

  function getGame(id) {
    return games[id] || null;
  }

  function listGames() {
    return Object.values(games);
  }

  // What the home screen needs to list the games before any of their files are here. A
  // game's own file registers again when it loads, with the same details plus its rules
  // module. test/smoke.js fails if this list and the games' own details ever disagree.
  [
    { id: 'battleship', name: 'Battleship', description: 'Classic hidden-fleet naval combat with one shot per turn.', supportsComputer: true, ui: 'battleship' },
    { id: 'connectfour', name: 'Connect Four', description: 'Drop glowing command discs and connect four before your rival does.', supportsComputer: true, ui: 'connectfour' },
    { id: 'dotsboxes', name: 'Dots and Boxes', description: 'Draw lines, close boxes, and keep the turn when you score.', supportsComputer: true, ui: 'dotsboxes' },
    { id: 'onecard', name: 'One Card', description: 'Classic color-and-number shedding chaos for 2-4 players.', supportsComputer: true, ui: 'onecard', minPlayers: 2, maxPlayers: 4 },
    { id: 'mancala', name: 'Mancala', description: 'Sow seeds around the board. Capture the most in your store to win.', supportsComputer: true, ui: 'mancala' },
    { id: 'ultimatettt', name: 'Ultimate Tic-Tac-Toe', description: 'Win three mini-boards in a row. Your move sends your opponent to a specific board.', supportsComputer: true, ui: 'ultimatettt' },
  ].forEach(listed => { if (!games[listed.id]) games[listed.id] = listed; });

  root.TurnBasedGamesRegistry = { games, registerGame, getGame, listGames };
})(window);
