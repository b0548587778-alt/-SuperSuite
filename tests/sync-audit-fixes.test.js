// בדיקת קוד 22.10.2026 — סנכרון בין מכשירים (docs/audit-parts/audit-sync.md, ממצאים 1–10).
// כל בדיקה כאן נכשלת על הקוד שלפני התיקון. חיבורים אמיתיים על 127.0.0.1; safeStorage מדומה.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');

const ROOT = path.join(__dirname, '..');
const Identity = require(path.join(ROOT, 'shell/sync/identity.js'));
const Pairing = require(path.join(ROOT, 'shell/sync/pairing.js'));
const Cert = require(path.join(ROOT, 'shell/sync/cert.js'));
const T = require(path.join(ROOT, 'shell/sync/transport.js'));
const { createSyncService } = require(path.join(ROOT, 'shell/sync/service.js'));

const HOST = '127.0.0.1';
const NOW = Date.UTC(2026, 9, 22, 9, 0, 0);
const nonce = () => crypto.randomBytes(32).toString('base64url');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { for (let t = 0; t < ms; t += 25) { if (fn()) return true; await sleep(25); } return false; };
const once = (em, ev) => new Promise((r) => em.once(ev, (...a) => r(a)));

const nodes = [];
const services = [];
const dirs = [];
test.after(async () => {
  await Promise.all([...nodes.map(n => n.close()), ...services.map(s => s.close())]);
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* run-tests ינקה */ } }
});
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sync-af-')); dirs.push(d); return d; };

function device(name, opts = {}) {
  const identity = opts.identity || Identity.createIdentity(name);
  const dev = { identity, peers: opts.peers || [], states: [], logs: [] };
  dev.node = T.createPeerNode({
    identity, getPeers: () => dev.peers, savePeers: (l) => { dev.peers = l; },
    state: opts.state === undefined ? null : opts.state,
    onState: (s) => { if (dev.failState) { const e = new Error('EPERM: operation not permitted, open sync-state.bin'); e.code = 'EPERM'; throw e; } dev.states.push(s); },
    now: opts.now, limits: { handshakeMs: 3000, pairingMs: 3000 },
  });
  dev.node.on('log', (e) => dev.logs.push(e));
  nodes.push(dev.node);
  return dev;
}
async function pairedPair() {
  const a = device('מחשב המשרד'), b = device('מחשב הבית');
  a.peers = Pairing.addPeer([], Identity.publicInfo(b.identity));
  b.peers = Pairing.addPeer([], Identity.publicInfo(a.identity));
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  return { a, b, ep: { host: HOST, port } };
}
// חיבור TLS גולמי עם תעודה של זהות כלשהי — כמו מכשיר זר ברשת
function rawClient(ep, identity = Identity.createIdentity('זר')) {
  const { cert, key } = Cert.selfSignedCert(identity.tls, { commonName: 'x' });
  return new Promise((resolve, reject) => {
    const s = tls.connect({ ...ep, cert, key, ALPNProtocols: [T.ALPN], rejectUnauthorized: false, minVersion: 'TLSv1.3', checkServerIdentity: () => undefined });
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
}
// קוד הזמנה עם סוד אחר — מי שלא ראה את ההזמנה האמיתית
function forgedInvite(code) {
  const inv = JSON.parse(Buffer.from(code.slice('SSPAIR1.'.length), 'base64url').toString('utf8'));
  inv.secret = crypto.randomBytes(32).toString('base64url');
  return 'SSPAIR1.' + Buffer.from(JSON.stringify(inv)).toString('base64url');
}

// ── ממצא 1: התחייבות בצימוד ──
test('ממצא 1: הקוד אצל המזמין תלוי במספר שהוא בוחר אחרי התשובה — אי אפשר לטחון מפתח שייתן קוד ידוע מראש', () => {
  const a = Identity.createIdentity('א'), m = Identity.createIdentity('מתחזה');
  const { code, pending } = Pairing.createInvite(a, { now: NOW });
  const accepted = Pairing.acceptInvite(m, code, { now: NOW });
  assert.equal(accepted.code, undefined, 'המצטרף לא יודע את הקוד לפני שהמזמין ענה');
  // אותה תשובה בדיוק (אותם מפתחות של התוקף), שתי הזמנות עם אותו סוד — קודים שונים
  const codes = new Set();
  for (let i = 0; i < 6; i++) {
    const done = Pairing.completePairing(a, { ...pending, used: false }, accepted.response, { now: NOW });
    codes.add(done.finish(accepted.reveal(done.nonce).nonce).code);
  }
  assert.ok(codes.size >= 5, 'הקוד אינו נקבע מראש מהמפתחות');
});

test('ממצא 1: המצטרף לא יכול להחליף את המספר שלו אחרי שראה את המספר של המזמין', () => {
  const a = Identity.createIdentity('א'), b = Identity.createIdentity('ב');
  const { code, pending } = Pairing.createInvite(a, { now: NOW });
  const accepted = Pairing.acceptInvite(b, code, { now: NOW });
  const done = Pairing.completePairing(a, pending, accepted.response, { now: NOW });
  assert.throws(() => done.finish(nonce()), { code: 'bad-commit' });
  const shown = accepted.reveal(done.nonce);
  assert.equal(done.finish(shown.nonce).code, shown.code);
});

// ── ממצא 2: מפתח ההצפנה בקוד האימות ──
test('ממצא 2: החלפה של מפתח ההצפנה (X25519) בלבד בהזמנה — קוד אחר', () => {
  const a = Identity.createIdentity('א'), b = Identity.createIdentity('ב'), m = Identity.createIdentity('מתחזה');
  const pa = Identity.publicInfo(a), pb = Identity.publicInfo(b);
  const swapped = { ...pa, dh: Identity.publicInfo(m).dh };
  const s = crypto.randomBytes(32).toString('base64url'), nA = nonce(), nB = nonce();
  assert.notEqual(Pairing.verificationCode(pa, pb, s, nA, nB), Pairing.verificationCode(swapped, pb, s, nA, nB));
});

test('ממצא 2: הגרסה הועלתה — קוד צימוד מהגרסה הקודמת נדחה בהודעה ברורה', () => {
  const a = Identity.createIdentity('א');
  const old = 'SSPAIR1.' + Buffer.from(JSON.stringify({ v: 1, peer: Identity.publicInfo(a), secret: 'x'.repeat(43), exp: NOW + 60000, endpoint: null })).toString('base64url');
  assert.throws(() => Pairing.parseInvite(old, NOW), (e) => e.code === 'old-version' && /גרסה ישנה/.test(e.message));
  assert.equal(JSON.parse(Buffer.from(Pairing.createInvite(a, { now: NOW }).code.slice(8), 'base64url').toString()).v, 2);
});

// ── ממצא 3: מונה ומצב ──
test('ממצא 3ב: מכשיר שאיבד את קובץ המצב — ההודעות שלו עדיין מתקבלות (המונה מתחיל מהשעון)', async () => {
  const { a, b, ep } = await pairedPair();
  await b.node.connect(a.identity.id, ep);
  for (let i = 0; i < 5; i++) { const got = once(a.node, 'message'); b.node.send(a.identity.id, { n: i }); await got; }
  await b.node.close();
  await until(() => !a.node.connected().length);
  // אותה זהות, בלי מצב (הקובץ נמחק / לא נקרא)
  const b2 = device('מחשב הבית', { identity: b.identity, peers: b.peers, state: null, now: () => Date.now() + 5 });
  await b2.node.connect(a.identity.id, ep);
  const got = once(a.node, 'message');
  b2.node.send(a.identity.id, { n: 'אחרי איפוס' });
  const [, body] = await Promise.race([got, sleep(1500).then(() => [null, null])]);
  assert.deepEqual(body, { n: 'אחרי איפוס' });
});

test('ממצא 3ג: צימוד מחדש מאפס את חלון השידור החוזר של אותו מכשיר', async () => {
  const a = device('מחשב'), b = device('טלפון');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const ep = { host: HOST, port };
  // צימוד ראשון, והודעות עם מונה גבוה
  let code = a.node.openPairing(ep);
  let req = once(a.node, 'pair-request');
  let joined = await b.node.joinPairing(code);
  (await req)[0].approve(); joined.approve();
  await b.node.connect(a.identity.id, ep);
  const got1 = once(a.node, 'message');
  b.node.send(a.identity.id, { n: 1 });
  await got1;
  await b.node.close();
  // אותו מכשיר עם מונה שהתחיל מחדש (מצב ישן): ביטול אצל A וצימוד מחדש
  a.node.revoke(b.identity.id);
  const b2 = device('טלפון', { identity: b.identity, state: { outSeq: 0, replay: {} } });
  code = a.node.openPairing(ep);
  req = once(a.node, 'pair-request');
  joined = await b2.node.joinPairing(code);
  (await req)[0].approve(); joined.approve();
  await b2.node.connect(a.identity.id, ep);
  const got = once(a.node, 'message');
  b2.node.send(a.identity.id, { n: 'אחרי צימוד מחדש' });
  const [, body] = await Promise.race([got, sleep(1500).then(() => [null, null])]);
  assert.deepEqual(body, { n: 'אחרי צימוד מחדש' });
});

const fakeSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(s).map(b => b ^ 0x5a)]),
  decryptString: (b) => { if (b.subarray(0, 4).toString() !== 'ENC:') throw new Error('x'); return Buffer.from(b.subarray(4).map(c => c ^ 0x5a)).toString(); },
});
const freePort = () => new Promise((resolve) => { const srv = net.createServer().listen(0, HOST, () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });
async function service(dir = tmp()) {
  const svc = createSyncService({ dir, safeStorage: fakeSafeStorage(), discovery: false, limits: { handshakeMs: 3000, pairingMs: 3000 } });
  services.push(svc);
  await svc.init();
  return { svc, dir };
}

test('ממצא 3א: כתיבה שנקטעה באמצע (ניתוק חשמל) לא שוברת את קובץ המצב', async () => {
  const { svc, dir } = await service();
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  const id = svc.status().device.id;
  await svc.close();
  const file = path.join(dir, 'sync-state.bin');
  const before = fs.readFileSync(file);
  // "ניתוק חשמל": כל כתיבה לקובץ נכתבת עד חציה ואז נכשלת
  const orig = { writeFileSync: fs.writeFileSync, writeSync: fs.writeSync };
  fs.writeFileSync = function (f, data, ...rest) {
    if (String(f).includes('sync-state')) { const b = Buffer.from(data); orig.writeFileSync.call(fs, f, b.subarray(0, b.length >> 1)); throw Object.assign(new Error('EIO'), { code: 'EIO' }); }
    return orig.writeFileSync.call(this, f, data, ...rest);
  };
  fs.writeSync = function (fd, data, ...rest) {
    const b = Buffer.from(data); orig.writeSync.call(fs, fd, b.subarray(0, b.length >> 1)); throw Object.assign(new Error('EIO'), { code: 'EIO' });
  };
  let p;
  try { p = svc.setPort(await Promise.resolve(48123)); } finally { Object.assign(fs, orig); }
  await assert.rejects(p);
  assert.deepEqual(fs.readFileSync(file), before, 'הקובץ הקודם שלם');
  const { svc: again } = await service(dir);
  assert.equal(again.status().error, null);
  assert.equal(again.status().device.id, id);
});

// ── ממצא 4: מסגרות ──
test('ממצא 4: מכשיר זר בזמן הזמנה פתוחה — מסגרת גדולה מנותקת מיד, בלי לאסוף אותה לזיכרון', async () => {
  const a = device('מחשב');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  a.node.openPairing({ host: HOST, port });
  const s = await rawClient({ host: HOST, port });
  const closed = new Promise((r) => s.once('close', () => r(true)));
  s.on('error', () => {});
  const head = Buffer.alloc(4); head.writeUInt32BE(5 * 1024 * 1024);
  s.write(Buffer.concat([head, Buffer.alloc(64 * 1024, 0x20)]));
  assert.equal(await Promise.race([closed, sleep(1000).then(() => false)]), true, 'נותק לפני הזמן הקצוב של הצימוד');
  assert.ok(T.PAIRING_MAX_FRAME <= 64 * 1024);
});

test('ממצא 4: מסגרת של 9MB ב-576 חלקים — זמן ליניארי', () => {
  const frame = T.encodeFrame({ t: 'env', pad: 'x'.repeat(T.MAX_FRAME - 64) });
  const parts = [];
  for (let i = 0; i < frame.length; i += 16 * 1024) parts.push(frame.subarray(i, i + 16 * 1024));
  let got = 0;
  const read = T.frameReader(() => got++, (e) => { throw e; });
  const t0 = process.hrtime.bigint();
  for (const p of parts) read(p);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(got, 1);
  assert.ok(parts.length >= 500);
  assert.ok(ms < 1000, `${ms.toFixed(0)}ms`);
});

// ── ממצא 5: שמירת מצב שנכשלה ──
test('ממצא 5: שמירת המצב נכשלת בזמן הודעה נכנסת — בלי חריגה שלא נתפסה; נרשם ביומן והחיבור נסגר', async () => {
  const { a, b, ep } = await pairedPair();
  await b.node.connect(a.identity.id, ep);
  await until(() => a.node.connected().length === 1);
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    a.failState = true;
    let delivered = 0;
    a.node.on('message', () => delivered++);
    const dropped = once(a.node, 'disconnected');
    b.node.send(a.identity.id, { type: 'ping', nonce: 'n1' });
    await Promise.race([dropped, sleep(1500)]);
    await sleep(50);
    assert.equal(uncaught.length, 0, uncaught.map(e => e.message).join());
    assert.equal(delivered, 0, 'הודעה שלא נשמר עליה מצב לא מועברת');
    assert.ok(a.logs.some(l => l.level === 'error' && l.code === 'EPERM'));
    assert.deepEqual(a.node.connected(), []);
    // גם בשליחה: בלי שמירה — לא שולחים
    b.failState = true;
    await b.node.connect(a.identity.id, ep).catch(() => {});
    if (b.node.connected().length) assert.throws(() => b.node.send(a.identity.id, { x: 1 }), { code: 'state-save' });
  } finally { process.off('uncaughtException', onUncaught); a.failState = false; b.failState = false; }
});

// ── ממצא 6: שריפת הזמנה ──
test('ממצא 6: מכשיר זר שלא מכיר את הסוד לא שורף את ההזמנה — המכשיר האמיתי עדיין מצטרף', async () => {
  const a = device('מחשב'), b = device('טלפון'), stranger = device('זר');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const code = a.node.openPairing({ host: HOST, port });
  await assert.rejects(stranger.node.joinPairing(forgedInvite(code)), { code: 'bad-proof' });
  assert.equal(a.node.pairingOpen(), true);
  const req = once(a.node, 'pair-request');
  const joined = await b.node.joinPairing(code);
  assert.equal((await req)[0].code, joined.code);
  assert.equal(a.node.pairingOpen(), false, 'אחרי שימוש אמיתי — נשרפת');
});

// ── ממצא 7: הקוד המוצג אחרי שימוש ודחייה ──
test('ממצא 7: אחרי שההזמנה נוצלה, ואחרי "לא זהים — ביטול", הקוד המשומש לא מוצג כתקף', async () => {
  const { svc: a } = await service(), { svc: b } = await service();
  await a.setPort(await freePort()); await b.setPort(await freePort());
  await a.setEnabled(true); await b.setEnabled(true);
  const inv = a.createInvite(HOST);
  assert.ok(a.status().pairing);
  await b.join(inv.code);
  assert.ok(await until(() => a.status().approvals.length === 1));
  assert.equal(a.status().pairing, null, 'נוצלה — לא מוצגת');
  a.reject(a.status().approvals[0].reqId);
  assert.equal(a.status().pairing, null);
});

// ── ממצא 8: חיוג בו-זמני ──
test('ממצא 8: שני המכשירים מחייגים זה לזה באותו רגע — נשאר חיבור אחד, והוא עובד', async () => {
  const a = device('א'), b = device('ב');
  a.peers = Pairing.addPeer([], Identity.publicInfo(b.identity));
  b.peers = Pairing.addPeer([], Identity.publicInfo(a.identity));
  const epA = { host: HOST, port: (await a.node.listen({ host: HOST, port: 0 })).port };
  const epB = { host: HOST, port: (await b.node.listen({ host: HOST, port: 0 })).port };
  await Promise.allSettled([a.node.connect(b.identity.id, epB), b.node.connect(a.identity.id, epA)]);
  await sleep(300);
  assert.deepEqual(a.node.connected(), [b.identity.id]);
  assert.deepEqual(b.node.connected(), [a.identity.id]);
  const got = once(b.node, 'message');
  a.node.send(b.identity.id, { type: 'chat', text: 'שלום' });
  const [, body] = await Promise.race([got, sleep(1500).then(() => [null, null])]);
  assert.deepEqual(body, { type: 'chat', text: 'שלום' });
});

// ── ממצא 9: זהות או מצב שאינם קריאים ──
test('ממצא 9: זהות שאינה קריאה — "יצירת זהות חדשה" מהמסך; הקובץ הישן נשמר בצד', async () => {
  const { svc, dir } = await service();
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  const oldId = svc.status().device.id;
  await svc.close();
  fs.writeFileSync(path.join(dir, 'sync-identity.bin'), 'not-dpapi-of-this-account');
  const { svc: again } = await service(dir);
  await again.setEnabled(true).catch(() => {});
  assert.equal(again.status().identityUnreadable, true);
  const st = await again.resetIdentity();
  assert.equal(st.identityUnreadable, false);
  assert.ok(st.device && st.device.id && st.device.id !== oldId, 'זהות חדשה');
  assert.ok(st.listening);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('sync-identity.bin.unreadable-')), 'הקובץ הישן הועבר הצידה');
  const devices = fs.readFileSync(path.join(ROOT, 'shell/devices.js'), 'utf8');
  assert.ok(devices.includes('api.resetIdentity()') && devices.includes('st.identityUnreadable'));
  assert.match(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'), /h\('sync:reset-identity'/);
});

test('ממצא 9: קובץ מצב שאינו קריא — מוצגת הודעה, והוא מועבר הצידה ולא נדרס', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'sync-state.bin'), 'not-dpapi-of-this-account');
  const { svc } = await service(dir);
  assert.equal(svc.status().stateUnreadable, true);
  await svc.setPort(await freePort());
  const aside = fs.readdirSync(dir).filter(f => f.startsWith('sync-state.bin.unreadable-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), 'not-dpapi-of-this-account');
  assert.equal(svc.status().stateUnreadable, false);
});

// ── ממצא 10: מזהה בתעודה ──
test('ממצא 10: סריקה של הפורט לא מחזירה את מזהה המכשיר בתעודה', async () => {
  const a = device('מחשב');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  a.node.openPairing({ host: HOST, port }); // כדי שהחיבור לא ייסגר לפני שקוראים את התעודה
  const s = await rawClient({ host: HOST, port });
  const cn = s.getPeerCertificate().subject.CN;
  s.destroy();
  assert.notEqual(cn, a.identity.id);
  assert.equal(cn, T.CERT_NAME);
});
