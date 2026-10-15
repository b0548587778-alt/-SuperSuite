// סנכרון, שלב 2: תעודה, חיבור TLS 1.3 + mTLS עם הצמדת מפתח, צימוד ברשת וגילוי ברשת המקומית.
// הבדיקות פותחות חיבורים אמיתיים על 127.0.0.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const tls = require('tls');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Identity = require(path.join(ROOT, 'shell/sync/identity.js'));
const Cert = require(path.join(ROOT, 'shell/sync/cert.js'));
const T = require(path.join(ROOT, 'shell/sync/transport.js'));
const D = require(path.join(ROOT, 'shell/sync/discovery.js'));
const Pairing = require(path.join(ROOT, 'shell/sync/pairing.js'));

const HOST = '127.0.0.1';

// מכשיר לבדיקה: זהות, רשימת עמיתים בזיכרון ומצב
function device(name) {
  const identity = Identity.createIdentity(name);
  const dev = { identity, peers: [], states: [] };
  dev.node = T.createPeerNode({
    identity, getPeers: () => dev.peers, savePeers: (l) => { dev.peers = l; },
    state: null, onState: (s) => dev.states.push(s), limits: { handshakeMs: 3000, pairingMs: 3000 },
  });
  opened.push(dev.node);
  return dev;
}
const opened = [];
test.after(() => Promise.all(opened.map(n => n.close())));
const once = (em, ev) => new Promise((r) => em.once(ev, (...a) => r(a)));

// שני מכשירים מצומדים ישירות (בלי רשת) — לבדיקות החיבור
async function pairedDevices() {
  const a = device('מחשב המשרד'), b = device('מחשב הבית');
  a.peers = Pairing.addPeer([], Identity.publicInfo(b.identity));
  b.peers = Pairing.addPeer([], Identity.publicInfo(a.identity));
  const addr = await a.node.listen({ host: HOST, port: 0 });
  return { a, b, ep: { host: HOST, port: addr.port } };
}

test('תעודה: X.509 תקינה בחתימה עצמית, עם המפתח של המכשיר, לא רשות אישורים', () => {
  const id = Identity.createIdentity('א');
  const { cert } = Cert.selfSignedCert(id.tls, { commonName: id.id });
  const x = new crypto.X509Certificate(cert);
  assert.ok(x.verify(x.publicKey));
  assert.equal(x.ca, false);
  assert.match(x.subject, new RegExp(id.id));
  assert.ok(Cert.sameTlsKey(Cert.certPublicJwk(x.raw), Identity.publicInfo(id).tls));
  assert.equal(Cert.sameTlsKey(Cert.certPublicJwk(x.raw), Identity.publicInfo(Identity.createIdentity('ב')).tls), false);
});

test('חיבור: TLS 1.3, הודעות בשני הכיוונים (כולל עברית), והמצב נשמר', async () => {
  const { a, b, ep } = await pairedDevices();
  const atA = once(a.node, 'connected');
  const session = await b.node.connect(a.identity.id, ep);
  await atA;
  const gotA = once(a.node, 'message');
  session.send({ type: 'chat', text: 'שלום מהבית' });
  assert.deepEqual(await gotA, [b.identity.id, { type: 'chat', text: 'שלום מהבית' }]);
  const gotB = once(b.node, 'message');
  a.node.send(b.identity.id, { type: 'chat', text: 'קיבלתי' });
  assert.deepEqual((await gotB)[1], { type: 'chat', text: 'קיבלתי' });
  assert.ok(b.states.at(-1).outSeq >= 1 && a.states.some(s => s.replay[b.identity.id]));
  await b.node.close(); await a.node.close();
});

test('חיבור: שרת שמציג מפתח אחר מהמוצמד (התחזות) — נדחה', async () => {
  const { a, b, ep } = await pairedDevices();
  const impostor = device('מתחזה');
  const imp = await impostor.node.listen({ host: HOST, port: 0 });
  await assert.rejects(b.node.connect(a.identity.id, { host: HOST, port: imp.port }), { code: 'pin-mismatch' });
  await Promise.all([a.node.close(), b.node.close(), impostor.node.close()]);
});

test('חיבור: מכשיר שאינו מצומד מנותק מיד; לקוח בלי תעודה או ב-TLS 1.2 — נכשל', async () => {
  const { a, ep } = await pairedDevices();
  const stranger = device('זר');
  stranger.peers = Pairing.addPeer([], Identity.publicInfo(a.identity)); // הוא "מכיר" את a, אבל a לא מכיר אותו
  let msgs = 0;
  a.node.on('message', () => msgs++);
  const s = await stranger.node.connect(a.identity.id, ep).catch(() => null);
  if (s) { try { s.send({ x: 1 }); } catch {} }
  await new Promise(r => setTimeout(r, 300));
  assert.equal(msgs, 0);
  assert.deepEqual(a.node.connected(), []);

  const noCert = await new Promise((resolve) => {
    const c = tls.connect({ ...ep, rejectUnauthorized: false, ALPNProtocols: [T.ALPN] });
    c.on('secureConnect', () => c.once('close', () => resolve('closed')));
    c.on('error', () => resolve('error'));
  });
  assert.ok(['closed', 'error'].includes(noCert));
  const old = await new Promise((resolve) => {
    const c = tls.connect({ ...ep, rejectUnauthorized: false, maxVersion: 'TLSv1.2' });
    c.on('secureConnect', () => { c.destroy(); resolve('connected'); });
    c.on('error', () => resolve('error'));
  });
  assert.equal(old, 'error', 'TLS 1.2 לא מתקבל');
  await Promise.all([a.node.close(), stranger.node.close()]);
});

test('חיבור: מכשיר שבוטל מנותק מיד ולא יכול להתחבר שוב', async () => {
  const { a, b, ep } = await pairedDevices();
  const atA = once(a.node, 'connected');
  await b.node.connect(a.identity.id, ep);
  await atA;
  const dropped = once(a.node, 'disconnected');
  a.node.revoke(b.identity.id);
  await dropped;
  assert.ok(a.peers[0].revoked);
  // ההצמדה של b עדיין תקפה, ולכן לחיצת היד עוברת — אבל a סוגר מיד, והסשן אצל b נסגר
  const s = await b.node.connect(a.identity.id, ep);
  for (let i = 0; i < 20 && !s.closed; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(s.closed, true, 'החיבור של מכשיר מבוטל נסגר');
  assert.deepEqual(a.node.connected(), []);
  await Promise.all([a.node.close(), b.node.close()]);
});

test('חלון שידור חוזר: הודעות בסדר שונה מתקבלות, כפולות וישנות מדי נדחות', () => {
  let w = null;
  for (const seq of [5, 3, 4, 10]) { assert.equal(T.replaySeen(w, seq), false); w = T.replayAccept(w, seq); }
  assert.ok(T.replaySeen(w, 4) && T.replaySeen(w, 10));
  w = T.replayAccept(w, 5000);
  assert.ok(T.replaySeen(w, 10), 'מחוץ לחלון — נחשב ישן');
  assert.equal(T.replaySeen(w, 4999), false);
  assert.ok(w.recent.length <= T.REPLAY_WINDOW);
});

test('מסגרות: גודל לא חוקי ו-JSON פגום נדחים; מסגרות מפוצלות מורכבות נכון', () => {
  const frames = [], errors = [];
  const read = T.frameReader((f) => frames.push(f), (e) => errors.push(e.code));
  const buf = Buffer.concat([T.encodeFrame({ t: 'a' }), T.encodeFrame({ t: 'ב' })]);
  for (const byte of buf) read(Buffer.from([byte]));
  assert.deepEqual(frames, [{ t: 'a' }, { t: 'ב' }]);
  const huge = Buffer.alloc(4); huge.writeUInt32BE(T.MAX_FRAME + 1);
  T.frameReader(() => {}, (e) => errors.push(e.code))(huge);
  const bad = Buffer.from('xxxx'); bad.writeUInt32BE(2);
  T.frameReader(() => {}, (e) => errors.push(e.code))(Buffer.concat([bad.subarray(0, 4), Buffer.from('{]')]));
  assert.deepEqual(errors, ['frame-size', 'frame-json']);
});

test('צימוד ברשת: הקוד מגיע לשני הצדדים זהה, ואחרי אישור — חיבור מאובטח עובד', async () => {
  const a = device('מחשב'), b = device('טלפון');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const code = a.node.openPairing({ host: HOST, port });
  const req = once(a.node, 'pair-request');
  const joined = await b.node.joinPairing(code);
  const [request] = await req;
  assert.match(joined.code, /^\d{6}$/);
  assert.equal(request.code, joined.code, 'אותו קוד אימות בשני המסכים');
  assert.equal(request.peer.id, b.identity.id);
  assert.equal(a.peers.length, 0, 'לא נשמר לפני אישור המשתמש');
  request.approve(); joined.approve();

  const atA = once(a.node, 'connected');
  await b.node.connect(a.identity.id, { host: HOST, port });
  await atA;
  const got = once(a.node, 'message');
  b.node.send(a.identity.id, { type: 'chat', text: 'מצומד!' });
  assert.equal((await got)[1].text, 'מצומד!');
  // ההזמנה חד-פעמית
  await assert.rejects(device('שלישי').node.joinPairing(code), { code: 'closed' });
  await Promise.all([a.node.close(), b.node.close()]);
});

test('צימוד ברשת: בלי הזמנה פתוחה — אין צימוד; קוד שבוטל — נדחה', async () => {
  const a = device('מחשב'), b = device('טלפון');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const code = a.node.openPairing({ host: HOST, port });
  a.node.cancelPairing();
  await assert.rejects(b.node.joinPairing(code));
  assert.equal(a.peers.length, 0);
  await Promise.all([a.node.close(), b.node.close()]);
});

test('גילוי: רק עמית מצומד מזהה את המשואה; אין בה מזהה; משואה חוזרת/ישנה/מזויפת — מתעלמים', () => {
  const a = Identity.createIdentity('א'), b = Identity.createIdentity('ב'), c = Identity.createIdentity('ג');
  const pa = Identity.publicInfo(a), pb = Identity.publicInfo(b);
  const keysA = D.discoveryKeys(a, Pairing.addPeer([], pb));
  const keysB = D.discoveryKeys(b, Pairing.addPeer([], pa));
  const keysC = D.discoveryKeys(c, Pairing.addPeer([], pa)); // c "מכיר" את a, אבל a לא צומד עם c
  const now = Date.now();
  const beacon = D.buildBeacon(keysA, 4433, now);
  const text = beacon.toString();
  for (const secret of [a.id, pa.sign.x, pa.tls.x, 'א']) assert.ok(!text.includes(secret), 'אין מזהה במשואה');
  const rinfo = { address: '192.168.1.20' };

  assert.deepEqual(D.parseBeacon(keysB, beacon, rinfo, new Set(), now), { peerId: a.id, host: '192.168.1.20', port: 4433 });
  assert.equal(D.parseBeacon(keysC, beacon, rinfo, new Set(), now), null, 'מי שאינו מצומד לא מזהה');
  const seen = new Set();
  D.parseBeacon(keysB, beacon, rinfo, seen, now);
  assert.equal(D.parseBeacon(keysB, beacon, rinfo, seen, now), null, 'שידור חוזר');
  assert.equal(D.parseBeacon(keysB, beacon, rinfo, new Set(), now + 11 * 60 * 1000), null, 'ישנה');
  const forged = JSON.parse(text); forged.p = 9999; // הפניה לפורט אחר — התגית לא תואמת
  assert.equal(D.parseBeacon(keysB, Buffer.from(JSON.stringify(forged)), rinfo, new Set(), now), null);
  assert.equal(D.parseBeacon(keysB, Buffer.from('{'), rinfo, new Set(), now), null);
  assert.notEqual(D.buildBeacon(keysA, 4433, now).toString(), text, 'כל משואה שונה — אי אפשר לעקוב');
  assert.ok(JSON.parse(text).t.length >= 8, 'תגיות דמה מסתירות את מספר העמיתים');
  // המשואה של a חוזרת אל a עצמו (multicast loopback) — לא מזוהה כמשואה של b
  assert.equal(D.parseBeacon(keysA, beacon, rinfo, new Set(), now), null, 'מכשיר לא מזהה את המשואה של עצמו');
});

test('גילוי: משואה אמיתית ב-UDP מגיעה לעמית המצומד', async (t) => {
  const a = Identity.createIdentity('א'), b = Identity.createIdentity('ב');
  const peersA = Pairing.addPeer([], Identity.publicInfo(b)), peersB = Pairing.addPeer([], Identity.publicInfo(a));
  const port = 40000 + crypto.randomInt(10000);
  const found = [];
  const da = D.startDiscovery({ identity: a, getPeers: () => peersA, listenPort: 5555, onFound: () => {}, port, intervalMs: 200 });
  const db = D.startDiscovery({ identity: b, getPeers: () => peersB, listenPort: 6666, onFound: (f) => found.push(f), port, intervalMs: 200 });
  await Promise.all([da.ready, db.ready]);
  for (let i = 0; i < 15 && !found.length; i++) await new Promise(r => setTimeout(r, 200));
  await Promise.all([da.stop(), db.stop()]);
  if (!found.length) return t.skip('multicast אינו זמין בסביבה זו');
  assert.equal(found[0].peerId, a.id);
  assert.equal(found[0].port, 5555);
});
