const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(os.tmpdir(), `turn-based-games-smoke-${process.pid}.json`);

function request(port, method, pathname, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, data, raw });
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
  try { fs.unlinkSync(dataFile); } catch {}

  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await waitForServer(child);
  try {
    const page = await request(port, 'GET', '/', null);
    assert.strictEqual(page.status, 200);
    assert.match(page.raw, /TURN-BASED GAMES/);
    assert.match(page.raw, /connectFour/);
    assert.strictEqual((page.raw.match(/<script src="app\.js"><\/script>/g) || []).length, 1);

    const traversal = await request(port, 'GET', '/..%2Fpackage.json', null);
    assert.strictEqual(traversal.status, 403);

    const unknownGame = await request(port, 'POST', '/api/create', { game: 'not-a-game' });
    assert.strictEqual(unknownGame.status, 400);

    const created = await request(port, 'POST', '/api/create', { game: 'battleship', name: 'Alpha' });
    assert.strictEqual(created.status, 200);
    assert.strictEqual(created.data.you, 'A');
    assert.match(created.data.room, /^[A-Z2-9]{4}$/);

    const joined = await request(port, 'POST', '/api/join', { room: created.data.room, name: 'Bravo' });
    assert.strictEqual(joined.status, 200);
    assert.strictEqual(joined.data.you, 'B');

    const stateA = await request(port, 'GET', `/api/state?room=${created.data.room}&token=${created.data.token}`, null);
    assert.strictEqual(stateA.status, 200);
    assert.strictEqual(stateA.data.opponentJoined, true);
    assert.strictEqual(stateA.data.view.phase, 'placing');

    const setupA = await request(port, 'POST', '/api/setup', {
      room: created.data.room,
      token: created.data.token,
      ships: fleet(),
    });
    assert.strictEqual(setupA.status, 200);

    const setupB = await request(port, 'POST', '/api/setup', {
      room: joined.data.room,
      token: joined.data.token,
      ships: fleet(),
    });
    assert.strictEqual(setupB.status, 200);

    const afterSetup = await request(port, 'GET', `/api/state?room=${created.data.room}&token=${created.data.token}`, null);
    assert.strictEqual(afterSetup.status, 200);
    assert.strictEqual(afterSetup.data.view.phase, 'battle');
    assert.match(afterSetup.data.view.turn, /^[AB]$/);

    const shooter = afterSetup.data.view.turn === 'A' ? created.data : joined.data;
    const move = await request(port, 'POST', '/api/move', {
      room: created.data.room,
      token: shooter.token,
      move: { r: 0, c: 0 },
    });
    assert.strictEqual(move.status, 200);

    const connectCreated = await request(port, 'POST', '/api/create', { game: 'connectfour', name: 'Red' });
    assert.strictEqual(connectCreated.status, 200);
    assert.strictEqual(connectCreated.data.game, 'connectfour');

    const connectJoined = await request(port, 'POST', '/api/join', { room: connectCreated.data.room, name: 'Gold' });
    assert.strictEqual(connectJoined.status, 200);

    const connectState = await request(port, 'GET', `/api/state?room=${connectCreated.data.room}&token=${connectCreated.data.token}`, null);
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


    const oneCreated = await request(port, 'POST', '/api/create', { game: 'onecard', name: 'Host' });
    assert.strictEqual(oneCreated.status, 200);
    assert.strictEqual(oneCreated.data.game, 'onecard');

    const oneJoinB = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Blue' });
    assert.strictEqual(oneJoinB.status, 200);
    assert.strictEqual(oneJoinB.data.you, 'B');

    const oneJoinC = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Green' });
    assert.strictEqual(oneJoinC.status, 200);
    assert.strictEqual(oneJoinC.data.you, 'C');

    const oneLobby = await request(port, 'GET', `/api/state?room=${oneCreated.data.room}&token=${oneCreated.data.token}`, null);
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

    const oneState = await request(port, 'GET', `/api/state?room=${oneCreated.data.room}&token=${oneCreated.data.token}`, null);
    assert.strictEqual(oneState.status, 200);
    assert.strictEqual(oneState.data.view.phase, 'battle');
    assert.strictEqual(oneState.data.view.hand.length, 7);
    assert.strictEqual(oneState.data.view.players.length, 3);

    const oneJoinDeny = await request(port, 'POST', '/api/join', { room: oneCreated.data.room, name: 'Late' });
    assert.strictEqual(oneJoinDeny.status, 409);

    const badJoin = await request(port, 'POST', '/api/join', { room: created.data.room, name: 'Extra' });
    assert.strictEqual(badJoin.status, 409);
  } finally {
    child.kill();
    try { fs.unlinkSync(dataFile); } catch {}
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
