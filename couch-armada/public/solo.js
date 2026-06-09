(function registerSoloClient(root) {
  function soloKey(room) { return `armada-solo-${room}`; }
  function soloToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function soloRoomCode() { return 'CPU' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function loadRoom(session) { return JSON.parse(root.localStorage.getItem(soloKey(session.room))); }
  function storeRoom(room) { root.localStorage.setItem(soloKey(room.code), JSON.stringify({ ...room, game: undefined })); }
  function clearRoom(session) {
    if (session && session.mode === 'computer') root.localStorage.removeItem(soloKey(session.room));
  }

  function computerSetup(game) {
    if (typeof game.computerSetup !== 'function') throw new Error('This game does not have a computer setup yet.');
    return game.computerSetup();
  }

  function computerMove(room) {
    if (typeof room.game.computerMove !== 'function') throw new Error('This game does not have a computer opponent yet.');
    return room.game.computerMove(room.state, 'B');
  }

  function advanceComputer(room) {
    if (room.state.phase === 'battle' && room.state.turn === 'B') {
      const move = computerMove(room);
      if (move) room.game.applyMove(room.state, 'B', move);
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
    const room = {
      code,
      gameName,
      game,
      humanToken: tok,
      humanName: body.name || 'Player 1',
      computerName: 'Computer',
      state: game.init(),
    };
    storeRoom(room);
    return { room: code, token: tok, you: 'A', game: gameName, mode: 'computer' };
  }

  function requireRoom(session, token, helpers) {
    const room = loadRoom(session);
    if (!room || room.humanToken !== token) throw new Error('Not in this game.');
    const meta = helpers.gameMeta(room.gameName);
    room.game = meta && meta.module;
    if (!room.game) throw new Error('That game is not available for solo play yet.');
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
      const cpuErr = room.game.validateSetup(room.state, 'B', computerSetup(room.game));
      if (cpuErr) throw new Error(cpuErr);
      advanceComputer(room);
      storeRoom(room);
      return { ok: true };
    }

    if (route.endsWith('/api/move') && method === 'POST') {
      const err = room.game.applyMove(room.state, 'A', body.move);
      if (err) throw new Error(err);
      advanceComputer(room);
      storeRoom(room);
      return { ok: true };
    }

    if (route.endsWith('/api/state') && method === 'GET') {
      advanceComputer(room);
      storeRoom(room);
      return {
        game: room.gameName,
        you: 'A',
        youName: room.humanName,
        opponentJoined: true,
        opponentName: room.computerName,
        view: room.game.viewFor(room.state, 'A'),
      };
    }

    throw new Error('Unknown solo endpoint.');
  }

  root.CouchArmadaSolo = { handle, clearRoom };
})(window);
