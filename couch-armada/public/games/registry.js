(function registerArmadaRegistry(root) {
  const existing = root.CouchArmadaRegistry;
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
    root.CouchArmadaGames = root.CouchArmadaGames || {};
    root.CouchArmadaGames[definition.id] = definition.module;
    return games[definition.id];
  }

  function getGame(id) {
    return games[id] || null;
  }

  function listGames() {
    return Object.values(games);
  }

  root.CouchArmadaRegistry = { games, registerGame, getGame, listGames };
})(window);
