/*
 * Web Push with no dependencies: VAPID (RFC 8292) and aes128gcm message
 * encryption (RFC 8291), using only node:crypto and the built-in fetch.
 *
 * The server's VAPID key pair lives in data.json (db.push). Deleting data.json
 * makes new keys, and every device has to turn turn alerts on again.
 *
 * Messages are encrypted for the receiving browser, so the push service that
 * relays them (Apple, Google, Mozilla, Microsoft) cannot read them.
 */
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = text => Buffer.from(String(text || ''), 'base64url');

// Only real browser push services may be stored as endpoints, so a subscriber
// cannot make this server POST to an arbitrary address.
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];
const MAX_SUBSCRIPTIONS_PER_SEAT = 4;

function vapidKeys(db) {
  if (db.push && db.push.privateJwk && db.push.publicKey) return db.push;
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  db.push = { publicKey, privateJwk: jwk };
  return db.push;
}

// Returns a cleaned { endpoint, keys: { p256dh, auth } } or null.
function cleanSubscription(sub, extraOrigin) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch { return null; }
  const allowedHost = url.protocol === 'https:' && !url.port && !url.username && !url.password
    && PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  if (!allowedHost && !(extraOrigin && url.origin === extraOrigin)) return null;
  const keys = sub.keys || {};
  const p256dh = fromB64u(keys.p256dh);
  const auth = fromB64u(keys.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: url.href, keys: { p256dh: b64u(p256dh), auth: b64u(auth) } };
}

function addSubscription(player, sub) {
  const list = (player.push || []).filter(s => s.endpoint !== sub.endpoint);
  list.push(sub);
  player.push = list.slice(-MAX_SUBSCRIPTIONS_PER_SEAT);
}

function removeSubscription(player, endpoint) {
  if (!player.push) return false;
  const before = player.push.length;
  player.push = player.push.filter(s => s.endpoint !== endpoint);
  if (!player.push.length) delete player.push;
  return before !== (player.push ? player.push.length : 0);
}

// RFC 8291 aes128gcm body. `salt` and `serverEcdh` are injectable for the RFC test vector.
function encrypt(plaintext, sub, { salt = crypto.randomBytes(16), serverEcdh } = {}) {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  const ecdh = serverEcdh || crypto.createECDH('prime256v1');
  if (!serverEcdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

function vapidAuthorization(keys, endpoint, contact, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// Sends one message to every device on a seat. Resolves true if any
// subscription was dropped (the device unsubscribed or the browser forgot it).
async function sendToSeat(keys, player, message, { contact, fetchImpl = fetch } = {}) {
  const subs = (player.push || []).slice();
  let dropped = false;
  await Promise.all(subs.map(async sub => {
    try {
      const res = await fetchImpl(sub.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'high',
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          Authorization: vapidAuthorization(keys, sub.endpoint, contact),
        },
        body: encrypt(JSON.stringify(message), sub),
      });
      if (res.status === 404 || res.status === 410) {
        if (removeSubscription(player, sub.endpoint)) dropped = true;
      } else if (res.status >= 400) {
        console.error(`Push to ${new URL(sub.endpoint).hostname} failed: HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`Push to ${new URL(sub.endpoint).hostname} failed: ${e.message}`);
    }
  }));
  return dropped;
}

module.exports = { vapidKeys, cleanSubscription, addSubscription, removeSubscription, encrypt, vapidAuthorization, sendToSeat };
