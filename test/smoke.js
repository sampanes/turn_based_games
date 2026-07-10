const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(os.tmpdir(), `turn-based-games-smoke-${process.pid}.json`);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function request(port, method, pathname, body, headers = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        ...headers,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, data, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 5000);
    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      const match = text.match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });
    child.on('exit', code => {
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => child.once('exit', resolve));
}

function spawnServer() {
  return spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '', PORT: '0', DATA_FILE: dataFile, BOT_MOVE_DELAY_MS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function testUnoTurnSyncAndSorting() {
  const uno = require('../public/games/onecard');
  const state = uno.init();
  ['A', 'B', 'C', 'D'].forEach(slot => uno.onPlayerJoined(state, slot));
  const startErr = uno.applyMove(state, 'A', { action: 'start' }, [
    { slot: 'A', name: 'Human' },
    { slot: 'B', name: 'Bot Blue' },
    { slot: 'C', name: 'Bot Green' },
    { slot: 'D', name: 'Bot Gold' },
  ]);
  assert.strictEqual(startErr, null);
  assert.strictEqual(state.turn, 'A');

  state.hands.A = [
    { id: 'z-wild', color: 'wild', kind: 'wild' },
    { id: 'a-blue', color: 'blue', kind: 'number', rank: '4' },
    { id: 'm-red', color: 'red', kind: 'number', rank: '1' },
  ];
  state.discardPile = [{ id: 'top', color: 'red', kind: 'number', rank: '7' }];
  state.currentColor = 'red';
  state.currentValue = '7';
  state.turnIndex = 0;
  state.turn = 'A';

  const view = uno.viewFor(state, 'A', [{ slot: 'A', name: 'Human' }, { slot: 'B', name: 'Bot Blue' }]);
  assert.deepStrictEqual(view.hand.map(card => card.id), ['m-red', 'a-blue', 'z-wild']);
  assert.deepStrictEqual(view.legalCardIds.sort(), ['m-red', 'z-wild']);

  const playErr = uno.applyMove(state, 'A', { action: 'play', cardId: 'm-red' });
  assert.strictEqual(playErr, null);
  assert.strictEqual(state.turn, 'B');
}

function testMancalaMoveIdentity() {
  const mancala = require('../public/games/mancala');
  const state = mancala.init();
  assert.strictEqual(state.moveNumber, 0);
  assert.strictEqual(mancala.applyMove(state, 'A', { pit: 2 }), null);
  assert.strictEqual(state.moveNumber, 1);
  assert.strictEqual(mancala.viewFor(state, 'A').moveNumber, 1);
  const log = mancala.viewFor(state, 'A').moveLog;
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].n, 1);
  assert.strictEqual(log[0].pickup, 2);
  assert.deepStrictEqual(log[0].seq, [3, 4, 5, 6]);
}

function fleet() {
  return [
    { name: 'Carrier', cells: ['0,0', '0,1', '0,2', '0,3', '0,4'] },
    { name: 'Battleship', cells: ['1,0', '1,1', '1,2', '1,3'] },
    { name: 'Cruiser', cells: ['2,0', '2,1', '2,2'] },
    { name: 'Submarine', cells: ['3,0', '3,1', '3,2'] },
    { name: 'Destroyer', cells: ['4,0', '4,1'] },
  ];
}

async function main() {
  testUnoTurnSyncAndSorting();
  testMancalaMoveIdentity();
  try { fs.unlinkSync(dataFile); } catch {}
  fs.writeFileSync(dataFile, JSON.stringify({
    rooms: {
      OLDD: { code: 'OLDD', createdAt: 1, players: {}, state: {} },
    },
  }));

  let child = spawnServer();
  let port = await waitForServer(child);
  try {
    const page = await request(port, 'GET', '/', null);
    assert.strictEqual(page.status, 200);
    assert.match(page.raw, /TURN-BASED GAMES/);
    assert.match(page.raw, /connectFour/);
    assert.doesNotMatch(page.raw, /fonts\.googleapis|fonts\.gstatic/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.strictEqual((page.raw.match(/<script src="app\.js"><\/script>/g) || []).length, 1);

    const traversal = await request(port, 'GET', '/..%2Fpackage.json', null);
    assert.strictEqual(traversal.status, 403);

    const unknownGame = await request(port, 'POST', '/api/create', { game: 'not-a-game' });
    assert.strictEqual(unknownGame.status, 400);

    const oversized = await request(port, 'POST', '/api/create', { padding: 'x'.repeat(70 * 1024) });
    assert.strictEqual(oversized.status, 413);

    const created = await request(port, 'POST', '/api/create', { game: 'battleship', name: 'Alpha' });
    assert.strictEqual(created.status, 200);
    assert.strictEqual(created.data.you, 'A');
    assert.match(created.data.room, /^[A-Z2-9]{4}$/);
    await delay(350);
    const firstSave = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.strictEqual(firstSave.rooms[created.data.room].players.A.name, 'Alpha');
    assert.strictEqual(firstSave.rooms.OLDD, undefined);

    const joined = await request(port, 'POST', '/api/join', { room: created.data.room, name: 'Bravo' });
    assert.strictEqual(joined.status, 200);
    assert.strictEqual(joined.data.you, 'B');
    await delay(350);
    assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rooms[created.data.room].players.B.name, 'Bravo');

    const stateWithoutToken = await request(port, 'GET', `/api/state?room=${created.data.room}`, null);
    assert.strictEqual(stateWithoutToken.status, 403);

    const stateA = await request(port, 'GET', `/api/state?room=${created.data.room}`, null, {
      Authorization: `Bearer ${created.data.token}`,
    });
    assert.strictEqual(stateA.status, 200);
    assert.strictEqual(stateA.data.opponentJoined, true);
    assert.strictEqual(stateA.data.view.phase, 'placing');

    const setupA = await request(port, 'POST', '/api/setup', {
      room: created.data.room,
      ships: fleet(),
    }, {
      Authorization: `Bearer ${created.data.token}`,
    });
    assert.strictEqual(setupA.status, 200);

    const setupB = await request(port, 'POST', '/api/setup', {
      room: joined.data.room,
      token: joined.data.token,
      ships: fleet(),
    });
    assert.strictEqual(setupB.status, 200);

    const afterSetup = await request(port, 'GET', `/api/state?room=${created.data.room}`, null, {
      Authorization: `Bearer ${created.data.token}`,
    });
    assert.strictEqual(afterSetup.status, 200);
    assert.strictEqual(afterSetup.data.view.phase, 'battle');
    assert.match(afterSetup.data.view.turn, /^[AB]$/);

    const shooter = afterSetup.data.view.turn === 'A' ? created.data : joined.data;
    const move = await request(port, 'POST', '/api/move', {
      room: created.data.room,
      move: { r: 0, c: 0 },
    }, {
      Authorization: `Bearer ${shooter.token}`,
    });
    assert.strictEqual(move.status, 200);

    const connectCreated = await request(port, 'POST', '/api/create', { game: 'connectfour', name: 'Red' });
    assert.strictEqual(connectCreated.status, 200);
    assert.strictEqual(connectCreated.data.game, 'connectfour');

    const connectJoined = await request(port, 'POST', '/api/join', { room: connectCreated.data.room, name: 'Gold' });
    assert.strictEqual(connectJoined.status, 200);

    const connectState = await request(port, 'GET', `/api/state?room=${connectCreated.data.room}`, null, {
      Authorization: `Bearer ${connectCreated.data.token}`,
    });
    assert.strictEqual(connectState.status, 200);
    assert.strictEqual(connectState.data.view.ui, 'connectfour');
    assert.strictEqual(connectState.data.view.phase, 'battle');
    assert.deepStrictEqual(connectState.data.view.legalMoves, [0, 1, 2, 3, 4, 5, 6]);

    const connectMove = await request(port, 'POST', '/api/move', {
      room: connectCreated.data.room,
      token: connectCreated.data.token,
      move: { c: 3 },
    });
    assert.strictEqual(connectMove.status, 200);

    const connectAfterMove = await request(port, 'GET', `/api/state?room=${connectCreated.data.room}`, null, {
      Authorization: `Bearer ${connectCreated.data.token}`,
    });
    assert.strictEqual(connectAfterMove.status, 200);
    assert.strictEqual(connectAfterMove.data.view.moveNumber, 1);
    assert.deepStrictEqual(
      connectAfterMove.data.view.moveLog.map(entry => [entry.n, entry.by, entry.r, entry.c, entry.win, entry.draw]),
      [[1, 'A', 5, 3, null, false]],
    );

    const botCreated = await request(port, 'POST', '/api/create', {
      game: 'connectfour',
      name: 'Human',
      bot: true,
    });
    assert.strictEqual(botCreated.status, 200);
    assert.strictEqual(botCreated.data.bot, true);

    const botInitial = await request(port, 'GET', `/api/state?room=${botCreated.data.room}`, null, {
      Authorization: `Bearer ${botCreated.data.token}`,
    });
    assert.strictEqual(botInitial.status, 200);
    assert.strictEqual(botInitial.data.opponentName, 'Botty');
    assert.strictEqual(botInitial.data.view.turn, 'A');

    const botJoinDeny = await request(port, 'POST', '/api/join', {
      room: botCreated.data.room,
      name: 'Unexpected',
    });
    assert.strictEqual(botJoinDeny.status, 409);

    const humanBotMove = await request(port, 'POST', '/api/move', {
      room: botCreated.data.room,
      move: { c: 3 },
    }, {
      Authorization: `Bearer ${botCreated.data.token}`,
    });
    assert.strictEqual(humanBotMove.status, 200);
    await delay(5);

    const botAfterMove = await request(port, 'GET', `/api/state?room=${botCreated.data.room}`, null, {
      Authorization: `Bearer ${botCreated.data.token}`,
    });
    assert.strictEqual(botAfterMove.status, 200);
    assert.strictEqual(botAfterMove.data.view.turn, 'A');
    assert.strictEqual(botAfterMove.data.view.board.flat().filter(Boolean).length, 2);

    for (const game of ['battleship', 'mancala', 'onecard', 'ultimatettt']) {
      const availableBot = await request(port, 'POST', '/api/create', {
        game,
        name: 'Human',
        bot: true,
      });
      assert.strictEqual(availableBot.status, 200);
      const availableState = await request(port, 'GET', `/api/state?room=${availableBot.data.room}`, null, {
        Authorization: `Bearer ${availableBot.data.token}`,
      });
      assert.strictEqual(availableState.status, 200);
      assert.strictEqual(availableState.data.opponentJoined, true);
      assert.strictEqual(availableState.data.opponentName, 'Botty');
    }

    const oneCreated = await request(port, 'POST', '/api/create', { game: 'onecard', name: 'Host' });
    assert.strictEqual(oneCreated.status, 200);
    assert.strictEqual(oneCreated.data.game, 'onecard');

    const oneJoinB = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Blue' });
    assert.strictEqual(oneJoinB.status, 200);
    assert.strictEqual(oneJoinB.data.you, 'B');

    const oneJoinC = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Green' });
    assert.strictEqual(oneJoinC.status, 200);
    assert.strictEqual(oneJoinC.data.you, 'C');

    const oneLobby = await request(port, 'GET', `/api/state?room=${oneCreated.data.room}`, null, {
      Authorization: `Bearer ${oneCreated.data.token}`,
    });
    assert.strictEqual(oneLobby.status, 200);
    assert.strictEqual(oneLobby.data.view.ui, 'onecard');
    assert.strictEqual(oneLobby.data.view.phase, 'lobby');
    assert.strictEqual(oneLobby.data.view.canStart, true);
    assert.strictEqual(oneLobby.data.players.length, 3);

    const oneStart = await request(port, 'POST', '/api/move', {
      room: oneCreated.data.room,
      token: oneCreated.data.token,
      move: { action: 'start' },
    });
    assert.strictEqual(oneStart.status, 200);

    const oneState = await request(port, 'GET', `/api/state?room=${oneCreated.data.room}`, null, {
      Authorization: `Bearer ${oneCreated.data.token}`,
    });
    assert.strictEqual(oneState.status, 200);
    assert.strictEqual(oneState.data.view.phase, 'battle');
    assert.strictEqual(oneState.data.view.hand.length, 7);
    assert.strictEqual(oneState.data.view.players.length, 3);

    const oneJoinDeny = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Late' });
    assert.strictEqual(oneJoinDeny.status, 409);

    const badJoin = await request(port, 'POST', '/api/join', { room: created.data.room, name: 'Extra' });
    assert.strictEqual(badJoin.status, 409);

    await delay(350);
    const savedBotRoom = JSON.parse(fs.readFileSync(dataFile, 'utf8')).rooms[botCreated.data.room];
    assert.strictEqual(savedBotRoom.botRoom, true);
    assert.strictEqual(savedBotRoom.players.B.name, 'Botty');

    const expectedBoard = botAfterMove.data.view.board;
    child.kill();
    await waitForExit(child);
    child = spawnServer();
    port = await waitForServer(child);

    const resumedBot = await request(port, 'GET', `/api/state?room=${botCreated.data.room}`, null, {
      Authorization: `Bearer ${botCreated.data.token}`,
    });
    assert.strictEqual(resumedBot.status, 200);
    assert.strictEqual(resumedBot.data.opponentName, 'Botty');
    assert.deepStrictEqual(resumedBot.data.view.board, expectedBoard);
  } finally {
    child.kill();
    try { fs.unlinkSync(dataFile); } catch {}
    try { fs.unlinkSync(`${dataFile}.tmp`); } catch {}
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
