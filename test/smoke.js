const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(os.tmpdir(), `turn-based-games-smoke-${process.pid}.json`);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// The page loads a game's rules and screen only when the game is opened. That holds
// together only if the home screen's list matches the games, every game has both files,
// and the always-loaded code never reaches into a file that may not be there yet.
function testGameCodeOnDemand(pageHtml) {
  const pub = path.join(root, 'public');
  const read = file => fs.readFileSync(path.join(pub, file), 'utf8');
  const fakeWindow = {};
  vm.runInNewContext(read('games/registry.js'), { window: fakeWindow });
  const listed = JSON.parse(JSON.stringify(fakeWindow.TurnBasedGamesRegistry.listGames())); // plain copies, out of the vm's realm
  const ruleFiles = fs.readdirSync(path.join(pub, 'games')).filter(f => f !== 'registry.js').map(f => f.replace(/\.js$/, '')).sort();
  assert.deepStrictEqual(listed.map(g => g.id).sort(), ruleFiles, 'registry.js lists exactly the games in public/games');
  const topLevelNames = source => new Set(Array.from(
    source.matchAll(/^(?:async\s+function\*?|function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm), m => m[1]));
  const usesName = (source, name) => new RegExp(`(?<![\\w$.'"\`])${name.replace(/\$/g, '\\$')}(?![\\w$'"\`])`).test(source.replace(/\/\/.*$/gm, ''));
  const screens = {};
  for (const game of listed) {
    const own = require(path.join(pub, 'games', `${game.id}.js`)).meta;
    assert.deepStrictEqual(game, JSON.parse(JSON.stringify(own)), `registry.js matches the ${game.id} file's own details`);
    assert.doesNotMatch(pageHtml, new RegExp(`<script src="(games|ui)/${game.id}\\.js"`), `${game.id} is not loaded with the page`);
    screens[game.id] = read(`ui/${game.id}.js`);
    new vm.Script(screens[game.id], { filename: `ui/${game.id}.js` });
  }
  const app = read('app.js');
  new vm.Script(app, { filename: 'app.js' });
  // Calls from app.js into a game's screen file. Each is safe only because it runs after
  // that game has been drawn (render and its key handlers) or is guarded by typeof.
  const allowed = new Set(['initPlacement', 'renderBattle', 'toggleOrient', 'updateAimUi', 'renderConnectFour', 'connectStepFocus',
    'connectUi', 'dropConnectDisc', 'renderDotsBoxes', 'renderMancala', 'renderOneCard', 'drawOneCard', 'layoutOneCardFan', 'renderUltimateTTT',
    'renderReversi', 'renderCheckers', 'renderPig']);
  for (const [id, source] of Object.entries(screens)) {
    for (const name of topLevelNames(source)) {
      if (!allowed.has(name)) assert.ok(!usesName(app, name), `app.js uses ${name}, which lives in ui/${id}.js and may not be loaded yet`);
      for (const [otherId, otherSource] of Object.entries(screens)) {
        if (otherId !== id) assert.ok(!usesName(otherSource, name), `ui/${otherId}.js uses ${name}, which lives in ui/${id}.js`);
      }
    }
  }
}

function requestBytes(port, pathname, headers) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

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

let pushOrigin = '';
function spawnServer() {
  return spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '', PORT: '0', DATA_FILE: dataFile, BOT_MOVE_DELAY_MS: '1', PUSH_TEST_ORIGIN: pushOrigin },
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

function testDotsBoxesScoring() {
  const dots = require('../public/games/dotsboxes');
  const state = dots.init();
  assert.strictEqual(dots.viewFor(state, 'A').legalMoves.length, 40);
  assert.strictEqual(dots.applyMove(state, 'A', { type: 'h', r: 0, c: 0 }), null);
  assert.strictEqual(state.turn, 'B');
  assert.strictEqual(dots.applyMove(state, 'B', { type: 'h', r: 1, c: 0 }), null);
  assert.strictEqual(state.turn, 'A');
  assert.strictEqual(dots.applyMove(state, 'A', { type: 'v', r: 0, c: 0 }), null);
  assert.strictEqual(state.turn, 'B');
  assert.strictEqual(dots.applyMove(state, 'B', { type: 'v', r: 0, c: 1 }), null);
  assert.strictEqual(state.scores.B, 1);
  assert.strictEqual(state.turn, 'B');
  assert.deepStrictEqual(state.lastMove.completed, ['0,0']);
  assert.strictEqual(dots.viewFor(state, 'B').legalMoves.length, 36);
}

function testBattleshipCanonicalCells() {
  const bs = require('../public/games/battleship');
  const state = bs.init();
  // Zero-padded cells must be stored canonically so shots can still hit them.
  const padded = fleet().map(s => ({ name: s.name, cells: s.cells.map(x => x.split(',').map(n => n.padStart(2, '0')).join(',')) }));
  assert.strictEqual(bs.validateSetup(state, 'A', padded), null);
  assert.deepStrictEqual(state.A.ships[0].cells, ['0,0', '0,1', '0,2', '0,3', '0,4']);
  const alias = fleet();
  alias[4] = { name: 'Destroyer', cells: ['00,0', '0,1'] };
  assert.strictEqual(bs.validateSetup(bs.init(), 'A', alias), 'Ships overlap.');
  assert.strictEqual(bs.validateSetup(bs.init(), 'A', [null, null, null, null, null]), 'Bad ship.');
}

function testReversiFlipsAndPasses() {
  const reversi = require('../public/games/reversi');
  const state = reversi.init();
  // The four opening squares for A, each flipping one disc.
  assert.deepStrictEqual(reversi.viewFor(state, 'A').validMoves, [19, 26, 37, 44].map(idx => ({ idx, flips: 1 })));
  assert.deepStrictEqual(reversi.viewFor(state, 'B').validMoves, []);
  assert.strictEqual(reversi.applyMove(state, 'A', { idx: 0 }), 'A disc there flips nothing.');
  assert.strictEqual(reversi.applyMove(state, 'B', { idx: 19 }), 'Not your turn.');
  assert.strictEqual(reversi.applyMove(state, 'A', { idx: 19 }), null);
  assert.deepStrictEqual(state.lastMove, { n: 1, by: 'A', idx: 19, flips: [27], passed: false });
  assert.deepStrictEqual(reversi.viewFor(state, 'A').counts, { A: 4, B: 1 });
  assert.strictEqual(state.turn, 'B');

  // B has nowhere to go after A's move, so A moves again.
  const pass = reversi.init();
  pass.board = Array(64).fill(null);
  [[0, 'A'], [1, 'B'], [54, 'B'], [63, 'A']].forEach(([idx, who]) => { pass.board[idx] = who; });
  assert.strictEqual(reversi.applyMove(pass, 'A', { idx: 2 }), null);
  assert.strictEqual(pass.lastMove.passed, true);
  assert.strictEqual(pass.turn, 'A');
  assert.strictEqual(pass.phase, 'battle');

  // Neither player can move: the game ends on the count.
  const end = reversi.init();
  end.board = Array(64).fill(null);
  [[0, 'A'], [1, 'B'], [63, 'B'], [62, 'B']].forEach(([idx, who]) => { end.board[idx] = who; });
  assert.strictEqual(reversi.applyMove(end, 'A', { idx: 2 }), null);
  assert.strictEqual(end.phase, 'over');
  assert.strictEqual(end.winner, 'A');
}

function testCheckersJumpsAndKings() {
  const checkers = require('../public/games/checkers');
  const state = checkers.init();
  assert.strictEqual(checkers.viewFor(state, 'A').moves.length, 7);
  assert.strictEqual(checkers.viewFor(state, 'A').counts.A, 12);
  assert.strictEqual(checkers.applyMove(state, 'A', { from: 40, to: 32 }), 'That piece cannot move there.');
  assert.strictEqual(checkers.applyMove(state, 'A', { from: 40, to: 33 }), null);
  assert.strictEqual(state.turn, 'B');

  // A jump must be taken, the same man keeps jumping, and the turn passes only after.
  const jump = checkers.init();
  jump.board = Array(64).fill('');
  jump.board[44] = 'a'; jump.board[60] = 'a'; jump.board[35] = 'b'; jump.board[19] = 'b'; jump.board[1] = 'b';
  assert.strictEqual(checkers.viewFor(jump, 'A').mustJump, true);
  assert.strictEqual(checkers.applyMove(jump, 'A', { from: 60, to: 53 }), 'You have a jump and must take it.');
  assert.strictEqual(checkers.applyMove(jump, 'A', { from: 44, to: 26 }), null);
  assert.strictEqual(jump.board[35], '');
  assert.strictEqual(jump.turn, 'A');
  assert.strictEqual(jump.chain, 26);
  assert.strictEqual(checkers.applyMove(jump, 'A', { from: 60, to: 53 }), 'Keep jumping with the same piece.');
  assert.strictEqual(checkers.applyMove(jump, 'A', { from: 26, to: 12 }), null);
  assert.strictEqual(jump.chain, null);
  assert.strictEqual(jump.turn, 'B');
  assert.deepStrictEqual(checkers.viewFor(jump, 'B').counts, { A: 2, B: 1, kingsA: 0, kingsB: 0 });

  // A man that reaches the far row is crowned, and a king moves backward.
  const crown = checkers.init();
  crown.board = Array(64).fill('');
  crown.board[10] = 'a'; crown.board[30] = 'b'; crown.board[56] = 'a';
  assert.strictEqual(checkers.applyMove(crown, 'A', { from: 10, to: 1 }), null);
  assert.strictEqual(crown.board[1], 'A');
  assert.strictEqual(crown.lastMove.crowned, true);
  assert.strictEqual(checkers.applyMove(crown, 'B', { from: 30, to: 21 }), 'That piece cannot move there.');
  assert.strictEqual(checkers.applyMove(crown, 'B', { from: 30, to: 37 }), null);
  assert.strictEqual(checkers.applyMove(crown, 'A', { from: 1, to: 10 }), null);

  // Taking the last piece wins.
  const last = checkers.init();
  last.board = Array(64).fill('');
  last.board[44] = 'a'; last.board[35] = 'b';
  assert.strictEqual(checkers.applyMove(last, 'A', { from: 44, to: 26 }), null);
  assert.strictEqual(last.phase, 'over');
  assert.strictEqual(last.winner, 'A');
}

function testPigPotsAndPigs() {
  const pig = require('../public/games/pig');
  const seats = [{ slot: 'A', name: 'Ann' }, { slot: 'B', name: 'Ben' }, { slot: 'C', name: 'Cy' }];
  const state = pig.init();
  pig.onPlayerJoined(state, 'A');
  assert.strictEqual(pig.viewFor(state, 'A', seats).canStart, false);
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'start' }, seats), 'Pig needs at least two players.');
  pig.onPlayerJoined(state, 'B');
  pig.onPlayerJoined(state, 'C');
  assert.strictEqual(pig.applyMove(state, 'B', { action: 'start' }, seats), 'Only the host can start the game.');
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'start' }, seats), null);
  pig.onPlayerJoined(state, 'D'); // too late: the game has started
  assert.deepStrictEqual(state.players, ['A', 'B', 'C']);

  assert.strictEqual(pig.applyMove(state, 'A', { action: 'bank' }, seats), 'Roll first: there is nothing to bank.');
  assert.strictEqual(pig.applyMove(state, 'B', { action: 'roll' }, seats), 'Not your turn.');
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'roll' }, seats, [3, 4]), null);
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'roll' }, seats, [6, 6]), null);
  assert.strictEqual(pig.viewFor(state, 'A', seats).pot, 19);
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'bank' }, seats), null);
  assert.strictEqual(state.scores.A, 19);
  assert.strictEqual(state.turn, 'B');

  // One pig loses the pot and keeps the score; the turn passes.
  state.scores.B = 30;
  assert.strictEqual(pig.applyMove(state, 'B', { action: 'roll' }, seats, [5, 5]), null);
  assert.strictEqual(pig.applyMove(state, 'B', { action: 'roll' }, seats, [1, 5]), null);
  assert.strictEqual(state.scores.B, 30);
  assert.strictEqual(state.turn, 'C');
  assert.strictEqual(state.lastAction.result, 'bust');
  assert.strictEqual(state.lastAction.lost, 10);

  // Two pigs wipe the score as well.
  state.scores.C = 44;
  assert.strictEqual(pig.applyMove(state, 'C', { action: 'roll' }, seats, [1, 1]), null);
  assert.strictEqual(state.scores.C, 0);
  assert.strictEqual(state.turn, 'A');

  // A roll sent by a player is ignored: only the fifth argument sets the dice.
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'roll', dice: [6, 6] }, seats, [2, 2]), null);
  assert.deepStrictEqual(state.dice, [2, 2]);

  // Banking to 100 wins.
  state.scores.A = 97;
  assert.strictEqual(pig.viewFor(state, 'A', seats).players[0].name, 'Ann');
  assert.strictEqual(pig.applyMove(state, 'A', { action: 'bank' }, seats), null);
  assert.strictEqual(state.phase, 'over');
  assert.strictEqual(state.winner, 'A');
  // The computer banks a pot that wins.
  const close = pig.init();
  ['A', 'B'].forEach(slot => pig.onPlayerJoined(close, slot));
  pig.applyMove(close, 'A', { action: 'start' }, seats);
  close.scores.A = 96; close.pot = 4;
  for (const level of ['easy', 'normal', 'hard']) assert.deepStrictEqual(pig.computerMove(close, 'A', level), { action: 'bank' });
}

// Every skill level must play only legal moves and finish a game.
function testBotLevelsPlayLegalGames() {
  const two = [{ slot: 'A', name: 'A' }, { slot: 'B', name: 'B' }];
  const setups = {
    battleship: (g, s) => { g.validateSetup(s, 'A', g.computerSetup()); g.validateSetup(s, 'B', g.computerSetup()); },
    onecard: (g, s) => { ['A', 'B'].forEach(x => g.onPlayerJoined(s, x)); g.applyMove(s, 'A', { action: 'start' }, two); },
    pig: (g, s) => { ['A', 'B'].forEach(x => g.onPlayerJoined(s, x)); g.applyMove(s, 'A', { action: 'start' }, two); },
  };
  for (const id of ['battleship', 'connectfour', 'dotsboxes', 'mancala', 'onecard', 'ultimatettt', 'reversi', 'checkers', 'pig']) {
    const game = require(`../public/games/${id}`);
    for (const [a, b] of [['easy', 'hard'], ['hard', 'normal'], ['normal', 'easy'], [undefined, 'bogus']]) {
      const levels = { A: a, B: b };
      const state = game.init();
      if (setups[id]) setups[id](game, state);
      for (let n = 0; state.phase !== 'over'; n++) {
        assert.ok(n < 3000, `${id} ${a} vs ${b} never finished`);
        const who = state.turn;
        const move = game.computerMove(state, who, levels[who]);
        assert.ok(move, `${id} ${levels[who]} returned no move`);
        assert.strictEqual(game.applyMove(state, who, move, two), null, `${id} ${levels[who]} played ${JSON.stringify(move)}`);
      }
    }
  }
}

// RFC 8291 Appendix A: the encrypted body must match byte for byte.
function testPushEncryptionVector() {
  const push = require('../server/push');
  const serverEcdh = crypto.createECDH('prime256v1');
  serverEcdh.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const body = push.encrypt('When I grow up, I want to be a watermelon', {
    keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  }, { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), serverEcdh });
  assert.strictEqual(body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  assert.strictEqual(push.cleanSubscription({ endpoint: 'https://evil.example/x', keys: {} }), null);
}

// A stand-in push service: records each POST; `status` is what it answers.
function startFakePush() {
  const received = [];
  const fake = { received, status: 201 };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(fake.status);
      res.end();
    });
  });
  return new Promise(resolve => fake.server.listen(0, '127.0.0.1', () => resolve(fake)));
}

// What the browser does with a push: decrypt the aes128gcm body.
function decryptPush(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const shared = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idLen);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  assert.strictEqual(plain[plain.length - 1], 2);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

function verifyVapid(headers, publicKey, origin) {
  const match = String(headers.authorization).match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(match, 'vapid authorization header');
  assert.strictEqual(match[4], publicKey);
  const raw = Buffer.from(publicKey, 'base64url');
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${match[1]}.${match[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(match[3], 'base64url')));
  const claims = JSON.parse(Buffer.from(match[2], 'base64url').toString('utf8'));
  assert.strictEqual(claims.aud, origin);
  assert.ok(claims.exp > Date.now() / 1000 && /^(mailto:|https:)/.test(claims.sub));
  assert.strictEqual(headers['content-encoding'], 'aes128gcm');
  assert.ok(Number(headers.ttl) > 0);
}

async function waitFor(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await delay(25); }
  return check();
}

async function testTurnAlerts(port, fake) {
  const key = await request(port, 'GET', '/api/push/key', null);
  assert.strictEqual(key.status, 200);
  assert.strictEqual(Buffer.from(key.data.publicKey, 'base64url').length, 65);

  const host = await request(port, 'POST', '/api/create', { game: 'connectfour', name: 'John' });
  const sis = await request(port, 'POST', '/api/join', { room: host.data.room, name: 'Sis' });
  const room = host.data.room;
  const as = who => ({ Authorization: `Bearer ${who.data.token}` });
  const move = (who, c) => request(port, 'POST', '/api/move', { room, move: { c } }, as(who));

  const uaEcdh = crypto.createECDH('prime256v1');
  uaEcdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const subscription = { endpoint: `${pushOrigin}/push/sis`, keys: { p256dh: uaEcdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
  const subscribe = sub => request(port, 'POST', '/api/push/subscribe', { room, subscription: sub }, as(sis));

  assert.strictEqual((await subscribe({ ...subscription, endpoint: 'https://evil.example/x' })).status, 400);
  assert.strictEqual((await subscribe({ ...subscription, endpoint: 'https://web.push.apple.com:8443/x' })).status, 400);
  assert.strictEqual((await request(port, 'POST', '/api/push/subscribe', { room, subscription }, {})).status, 403);
  assert.strictEqual((await subscribe(subscription)).status, 200);
  const stored = await request(port, 'GET', `/api/state?room=${room}`, null, as(sis));
  assert.doesNotMatch(stored.raw, /push\/sis/, 'subscriptions never leave the server');

  // John moves while Sis is away: she gets one encrypted, signed alert.
  assert.strictEqual((await move(host, 0)).status, 200);
  assert.ok(await waitFor(() => fake.received.length === 1), 'alert delivered');
  const alert = fake.received[0];
  assert.strictEqual(alert.path, '/push/sis');
  verifyVapid(alert.headers, key.data.publicKey, pushOrigin);
  assert.deepStrictEqual(decryptPush(alert.body, uaEcdh, authSecret), {
    title: 'Connect Four', body: 'John moved. Your turn.', tag: room, url: `./?play=${room}`,
  });

  // Her own move alerts nobody (John has no alerts on).
  assert.strictEqual((await move(sis, 1)).status, 200);
  await delay(200);
  assert.strictEqual(fake.received.length, 1);

  // A browser that dropped the subscription answers 410: the server forgets it.
  fake.status = 410;
  assert.strictEqual((await move(host, 0)).status, 200);
  assert.ok(await waitFor(() => fake.received.length === 2));
  await delay(400);
  const afterGone = JSON.parse(fs.readFileSync(dataFile, 'utf8')).rooms[room].players.B;
  assert.strictEqual(afterGone.push, undefined);
  fake.status = 201;

  // With her game screen open (seen=1 polls), she gets no alert.
  assert.strictEqual((await subscribe(subscription)).status, 200);
  await request(port, 'GET', `/api/state?room=${room}&seen=1`, null, as(sis));
  assert.strictEqual((await move(sis, 1)).status, 200);
  assert.strictEqual((await move(host, 0)).status, 200);
  await delay(300);
  assert.strictEqual(fake.received.length, 2);

  // Turning alerts off removes the device.
  assert.strictEqual((await request(port, 'POST', '/api/push/unsubscribe', { room, endpoint: subscription.endpoint }, as(sis))).status, 200);
  await delay(400);
  assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rooms[room].players.B.push, undefined);
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
  testDotsBoxesScoring();
  testBattleshipCanonicalCells();
  testReversiFlipsAndPasses();
  testCheckersJumpsAndKings();
  testPigPotsAndPigs();
  testBotLevelsPlayLegalGames();
  testPushEncryptionVector();
  const fakePush = await startFakePush();
  pushOrigin = `http://127.0.0.1:${fakePush.server.address().port}`;
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
    testGameCodeOnDemand(page.raw);

    const traversal = await request(port, 'GET', '/..%2Fpackage.json', null);
    assert.strictEqual(traversal.status, 403);

    // Static files: compressed when the browser accepts it, and not sent again when unchanged.
    assert.ok(page.headers.etag, 'static files carry an ETag');
    assert.strictEqual(page.headers['content-encoding'], undefined);
    const zipped = await requestBytes(port, '/app.js', { 'Accept-Encoding': 'gzip, deflate' });
    assert.strictEqual(zipped.headers['content-encoding'], 'gzip');
    assert.strictEqual(zipped.headers.vary, 'Accept-Encoding');
    const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'));
    assert.ok(zipped.body.length < appSource.length / 2, 'app.js is sent compressed');
    assert.ok(zlib.gunzipSync(zipped.body).equals(appSource), 'the compressed copy unpacks to the file');
    const unchanged = await requestBytes(port, '/app.js', { 'If-None-Match': zipped.headers.etag });
    assert.strictEqual(unchanged.status, 304);
    assert.strictEqual(unchanged.body.length, 0);
    const picture = await requestBytes(port, '/art/home.png', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(picture.headers['content-encoding'], undefined);
    assert.ok(picture.body.equals(fs.readFileSync(path.join(root, 'public', 'art', 'home.png'))));
    assert.strictEqual((await requestBytes(port, '/games', {})).status, 404);

    await testTurnAlerts(port, fakePush);

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

    const dotsCreated = await request(port, 'POST', '/api/create', { game: 'dotsboxes', name: 'Dot' });
    assert.strictEqual(dotsCreated.status, 200);
    assert.strictEqual(dotsCreated.data.game, 'dotsboxes');

    const dotsJoined = await request(port, 'POST', '/api/join', { room: dotsCreated.data.room, name: 'Box' });
    assert.strictEqual(dotsJoined.status, 200);

    const dotsState = await request(port, 'GET', `/api/state?room=${dotsCreated.data.room}`, null, {
      Authorization: `Bearer ${dotsCreated.data.token}`,
    });
    assert.strictEqual(dotsState.status, 200);
    assert.strictEqual(dotsState.data.view.ui, 'dotsboxes');
    assert.strictEqual(dotsState.data.view.phase, 'battle');
    assert.strictEqual(dotsState.data.view.legalMoves.length, 40);

    const dotsMove = await request(port, 'POST', '/api/move', {
      room: dotsCreated.data.room,
      move: { type: 'h', r: 0, c: 0 },
    }, {
      Authorization: `Bearer ${dotsCreated.data.token}`,
    });
    assert.strictEqual(dotsMove.status, 200);

    const dotsAfterMove = await request(port, 'GET', `/api/state?room=${dotsCreated.data.room}`, null, {
      Authorization: `Bearer ${dotsCreated.data.token}`,
    });
    assert.strictEqual(dotsAfterMove.status, 200);
    assert.strictEqual(dotsAfterMove.data.view.moveNumber, 1);
    assert.strictEqual(dotsAfterMove.data.view.edges.h[0][0], 'A');
    assert.strictEqual(dotsAfterMove.data.view.turn, 'B');

    const botCreated = await request(port, 'POST', '/api/create', {
      game: 'connectfour',
      name: 'Human',
      bot: true,
      level: 'easy',
    });
    assert.strictEqual(botCreated.status, 200);
    assert.strictEqual(botCreated.data.bot, true);
    assert.strictEqual(botCreated.data.level, 'easy');

    const botInitial = await request(port, 'GET', `/api/state?room=${botCreated.data.room}`, null, {
      Authorization: `Bearer ${botCreated.data.token}`,
    });
    assert.strictEqual(botInitial.status, 200);
    assert.strictEqual(botInitial.data.opponentName, 'Botty');
    assert.strictEqual(botInitial.data.botLevel, 'easy');
    assert.strictEqual(botInitial.data.view.turn, 'A');

    const oddLevel = await request(port, 'POST', '/api/create', { game: 'mancala', name: 'Human', bot: true, level: 'nightmare' });
    assert.strictEqual(oddLevel.data.level, 'normal');

    const botJoinDeny = await request(port, 'POST', '/api/join', {
      room: botCreated.data.room,
      name: 'Unexpected',
    });
    assert.strictEqual(botJoinDeny.status, 409);

    // Botty has no token; a request with none must not be treated as Botty.
    const tokenless = await request(port, 'GET', `/api/state?room=${botCreated.data.room}`, null, {});
    assert.strictEqual(tokenless.status, 403);
    const tokenlessMove = await request(port, 'POST', '/api/move', { room: botCreated.data.room, move: { c: 0 } }, {});
    assert.notStrictEqual(tokenlessMove.status, 200);

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

    for (const game of ['battleship', 'dotsboxes', 'mancala', 'onecard', 'ultimatettt', 'reversi', 'checkers', 'pig']) {
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
    fakePush.server.close();
    child.kill();
    try { fs.unlinkSync(dataFile); } catch {}
    try { fs.unlinkSync(`${dataFile}.tmp`); } catch {}
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
