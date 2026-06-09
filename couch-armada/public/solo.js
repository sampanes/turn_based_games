(function registerSoloClient(root) {
  function soloKey(room) { return `armada-solo-${room}`; }
  function soloToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function soloRoomCode() { return 'CPU' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function loadRoom(session) { return JSON.parse(root.localStorage.getItem(soloKey(session.room))); }
  function storeRoom(room) { root.localStorage.setItem(soloKey(room.code), JSON.stringify({ ...room, game: undefined })); }
  function clearRoom(session) {
    if (session && session.mode === 'computer') root.localStorage.removeItem(soloKey(session.room));
  }

  function publicPlayers(room) {
    return room.players.map(player => ({ slot: player.slot, name: player.name }));
  }

  function computerSetup(game) {
    if (typeof game.computerSetup !== 'function') throw new Error('This game does not have a computer setup yet.');
    return game.computerSetup();
  }

  function computerMove(room, slot) {
    if (typeof room.game.computerMove !== 'function') throw new Error('This game does not have a computer opponent yet.');
    return room.game.computerMove(room.state, slot);
  }

  function advanceComputer(room) {
    let guard = 0;
    while (room.state.phase === 'battle' && room.state.turn && room.state.turn !== 'A' && guard++ < 40) {
      const move = computerMove(room, room.state.turn);
      if (!move) break;
      room.game.applyMove(room.state, room.state.turn, move, publicPlayers(room));
    }
  }

  function createRoom(body, helpers) {
    const gameName = body.game || helpers.selectedGameId();
    const meta = helpers.gameMeta(gameName);
    const game = meta && meta.module;
    if (!game) throw new Error('That game is not available for solo play yet.');
    if (meta && meta.supportsComputer === false) throw new Error('That game does not have a computer opponent yet.');

    const code = soloRoomCode();
    const tok = soloToken();
    const computers = typeof game.computerPlayers === 'function'
      ? game.computerPlayers()
      : [{ slot: 'B', name: 'Computer' }];
    const room = {
      code,
      gameName,
      game,
      humanToken: tok,
      players: [{ slot: 'A', name: body.name || 'Player 1', human: true }, ...computers],
      state: game.init(),
    };
    if (typeof game.onPlayerJoined === 'function') room.players.forEach(player => game.onPlayerJoined(room.state, player.slot));
    storeRoom(room);
    return { room: code, token: tok, you: 'A', game: gameName, mode: 'computer' };
  }

  function requireRoom(session, token, helpers) {
    const room = loadRoom(session);
    if (!room || room.humanToken !== token) throw new Error('Not in this game.');
    const meta = helpers.gameMeta(room.gameName);
    room.game = meta && meta.module;
    if (!room.game) throw new Error('That game is not available for solo play yet.');
    if (!room.players) room.players = [
      { slot: 'A', name: room.humanName || 'Player 1', human: true },
      { slot: 'B', name: room.computerName || 'Computer' },
    ];
    return room;
  }

  function handle(path, method, body, session, helpers) {
    const url = new URL(path, root.location.href);
    const route = url.pathname;
    if (route.endsWith('/api/create') && method === 'POST') return createRoom(body, helpers);

    const token = (body && body.token) || url.searchParams.get('token');
    const room = requireRoom(session, token, helpers);

    if (route.endsWith('/api/setup') && method === 'POST') {
      const err = room.game.validateSetup(room.state, 'A', body.ships);
      if (err) throw new Error(err);
      for (const player of room.players.filter(p => !p.human)) {
        const cpuErr = room.game.validateSetup(room.state, player.slot, computerSetup(room.game));
        if (cpuErr) throw new Error(cpuErr);
      }
      advanceComputer(room);
      storeRoom(room);
      return { ok: true };
    }

    if (route.endsWith('/api/move') && method === 'POST') {
      const err = room.game.applyMove(room.state, 'A', body.move, publicPlayers(room));
      if (err) throw new Error(err);
      advanceComputer(room);
      storeRoom(room);
      return { ok: true };
    }

    if (route.endsWith('/api/state') && method === 'GET') {
      advanceComputer(room);
      storeRoom(room);
      const opponents = room.players.filter(player => player.slot !== 'A');
      return {
        game: room.gameName,
        you: 'A',
        youName: room.players.find(player => player.slot === 'A').name,
        opponentJoined: true,
        opponentName: opponents.length === 1 ? opponents[0].name : `${opponents.length} rivals`,
        players: publicPlayers(room),
        minPlayers: (room.game.meta && room.game.meta.minPlayers) || 2,
        maxPlayers: (room.game.meta && room.game.meta.maxPlayers) || 2,
        view: room.game.viewFor(room.state, 'A', publicPlayers(room)),
      };
    }

    throw new Error('Unknown solo endpoint.');
  }

  root.CouchArmadaSolo = { handle, clearRoom };
})(window);
