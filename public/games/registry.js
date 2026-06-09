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

  root.TurnBasedGamesRegistry = { games, registerGame, getGame, listGames };
})(window);
