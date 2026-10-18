// רישוי מרחוק: שרת הממסר (server/license-relay.js) ולקוח הסנכרון (shell/licensing/sync.js).
// שרת HTTP אמיתי על localhost, ושלוש "התקנות" נפרדות — מנהל-העל, לקוח ומערכת בת — בלי שום העברת קבצים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createRemote, validateUrl } = require('../shell/licensing/remote');
const { createServer, createRelay } = require('../server/license-relay');

const PASS = 'menahel-al-remote-2026';
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const tenantLimits = { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 2 };
const childLimits = { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 2 };

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-'));
  const server = createServer({ dataDir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, dataDir, close: () => new Promise(r => server.close(r)) };
}

// התקנה עצמאית: מצב רישוי + (אופציונלי) מנהל-העל + סנכרון, כמו ב-ipc.js
function installation(rootKeys, url, owner = null) {
  const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
  store.setRemoteSettings({ url });
  return { store, owner, sync: createLicenseSync({ store, owner, rootKeys, fetchImpl: fetch }) };
}

test('כתובת שרת: https בלבד (או localhost), בלי פרטי כניסה', () => {
  assert.equal(validateUrl('https://license.example.co.il/x'), 'https://license.example.co.il');
  assert.equal(validateUrl('http://localhost:8080'), 'http://localhost:8080');
  assert.throws(() => validateUrl('http://license.example.co.il'), /https/);
  assert.throws(() => validateUrl('https://user:pw@example.com'), /שם משתמש/);
  assert.throws(() => validateUrl('not a url'), /אינה תקינה/);
});

test('שרת: בקשה לא חתומה, חתימה מזויפת ושידור חוזר — נדחים; רק בעל המפתח קורא את התיבה שלו', async () => {
  const relay = createRelay({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-u-')) });
  const a = L.generateKeyPair(); const b = L.generateKeyPair();
  const signed = (k, op, payload, over = {}) => {
    const req = { pub: L.publicOf(k.privateJwk), ts: Date.now(), nonce: 'n-' + Math.random().toString(36).slice(2) + 'abcdefghij', op, payload, ...over };
    req.sig = L.signObject({ pub: req.pub, ts: req.ts, nonce: req.nonce, op, payload }, k.privateJwk);
    return req;
  };
  assert.throws(() => relay.handle({ pub: a.publicJwk, ts: Date.now(), nonce: 'x'.repeat(20), op: 'fetch', payload: {}, sig: 'AAAA' }), /חתימה/);
  const req = signed(a, 'send', { items: [{ to: b.keyId, kind: 'notices', body: '{}' }] });
  assert.equal(relay.handle(req).sent, 1);
  assert.throws(() => relay.handle(req), /כפולה/, 'שידור חוזר');
  const forged = signed(a, 'fetch', {});
  forged.pub = b.publicJwk; // מתחזה לבעל תיבה אחר
  assert.throws(() => relay.handle(forged), /חתימה/);
  assert.equal(relay.handle(signed(a, 'fetch', {})).messages.length, 0, 'התיבה של א ריקה');
  const got = relay.handle(signed(b, 'fetch', {})).messages;
  assert.equal(got.length, 1);
  assert.equal(got[0].from, a.keyId, 'השולח מזוהה לפי המפתח שלו');
  relay.handle(signed(b, 'ack', { ids: [got[0].id] }));
  assert.equal(relay.handle(signed(b, 'fetch', {})).messages.length, 0);
  assert.throws(() => relay.handle(signed(a, 'fetch', {}, { ts: Date.now() - 3600 * 1000 })), /שעון/);
  assert.throws(() => relay.handle(signed(a, 'send', { items: [{ to: 'bad', kind: 'notices', body: '' }] })), /לא תקינה/);
});

test('זרימה מלאה מרחוק: רישיון, מערכת בת באישור מנהל-העל, השבתה ב-Cascade — הכול דרך השרת', async () => {
  const srv = await startServer();
  try {
    const owner = createOwnerCore({ storage: mem() });
    const { publicKey } = owner.init(PASS);
    const rootKeys = [publicKey];
    const O = installation(rootKeys, srv.url, owner);
    const T = installation(rootKeys, srv.url);
    const K = installation(rootKeys, srv.url);

    // 1. לקוח שולח בקשת רישיון; מנהל-העל מקבל ומנפיק בלחיצה
    await T.sync.sendLicenseRequest('רשת חדרים אור תורה');
    assert.equal((await O.sync.ownerReceive()).added, 1);
    const req = owner.inbox()[0];
    assert.equal(req.summary.kind, 'license');
    const issued = owner.issue({ request: req.body, features: ['econ', 'econ.npo'], limits: tenantLimits, months: 12 });
    await O.sync.ownerReply(req.from, 'license', issued.package);
    owner.takeFromInbox(req.id);
    assert.equal((await T.sync.receive()).handled, 1);
    assert.equal(T.store.current().status, 'active');
    const tenantCode = T.store.syncInfo().nodeId;

    // 2. מערכת בת מבקשת מהלקוח לפי קוד; הלקוח מעביר לאישור; מנהל-העל מאשר
    await K.sync.sendRequestToParent('סניף רכסים', tenantCode);
    const recv = await T.sync.receive();
    assert.equal(recv.pending.length, 1);
    await T.sync.forwardChildRequest(recv.pending[0].keyId, { name: 'סניף רכסים', features: ['econ'], limits: childLimits, months: 12 });
    await O.sync.ownerReceive();
    const ask = owner.inbox()[0];
    assert.equal(ask.summary.kind, 'approval');
    assert.equal(ask.summary.parentName, 'רשת חדרים אור תורה');
    const ap = owner.approve({ request: ask.body });
    await O.sync.ownerReply(ask.from, 'approval', ap.package);
    owner.takeFromInbox(ask.id);

    // 3. הלקוח מקבל את האישור, מנפיק אוטומטית ושולח למערכת הבת
    await T.sync.receive();
    assert.equal(T.store.listChildren().length, 1);
    await K.sync.receive();
    assert.equal(K.store.current().status, 'active');
    assert.equal(K.store.current().limits.maxUsers, 3);

    // 4. מנהל-העל משבית את הלקוח — מגיע ללקוח ולמערכת הבת
    const hold = owner.notice({ type: 'hold', target: issued.id, kind: 'pending_payment', source: 'billing', reason: 'החיוב נכשל' });
    await O.sync.ownerPushNotices();
    await T.sync.receive();
    await K.sync.receive();
    assert.equal(T.store.current().status, 'pending_payment');
    assert.equal(K.store.current().status, 'pending_payment');

    // 5. הלקוח משבית את מערכת הבת בעצמו; מנהל-העל מחזיר את הלקוח — מערכת הבת נשארת מושבתת
    owner.notice({ type: 'release', target: issued.id, holdId: hold.id, reason: 'התשלום התקבל' });
    await O.sync.ownerPushNotices();
    await T.sync.receive();
    assert.equal(T.store.current().status, 'active');
    const childId = T.store.listChildren()[0].id;
    const own = T.store.noticeForChild({ type: 'hold', childId, kind: 'suspended', reason: 'הסניף בשיפוץ' });
    await T.sync.pushToChild(childId, own.package);
    await K.sync.receive();
    assert.equal(K.store.current().status, 'suspended');
    assert.equal(K.store.current().reasons[0].reason, 'הסניף בשיפוץ');

    // 6. נעילה גלובלית מגיעה לכולם
    owner.notice({ type: 'hold', target: '*', kind: 'locked', reason: 'תחזוקת חירום' });
    await O.sync.ownerPushNotices();
    await T.sync.receive();
    await K.sync.receive();
    assert.equal(T.store.current().status, 'locked');
    assert.equal(K.store.current().status, 'locked');
  } finally { await srv.close(); }
});

test('דחייה מרחוק: הלקוח מקבל את הסיבה', async () => {
  const srv = await startServer();
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init(PASS).publicKey];
    const O = installation(rootKeys, srv.url, owner);
    const T = installation(rootKeys, srv.url);
    const K = installation(rootKeys, srv.url);
    await T.sync.sendLicenseRequest('ישיבה');
    await O.sync.ownerReceive();
    const m = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(m.from, 'license', owner.issue({ request: m.body, features: ['econ'], limits: tenantLimits }).package);
    await T.sync.receive();
    await T.sync.sendApprovalRequest({ request: JSON.stringify(K.store.request('סניף')), name: 'סניף', features: ['econ'], limits: childLimits });
    await O.sync.ownerReceive();
    const ask = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(ask.from, 'rejection', JSON.stringify({ name: 'סניף', reason: 'אין צורך כרגע' }));
    const r = await T.sync.receive();
    assert.match(r.errors[0], /נדחתה: אין צורך כרגע/);
    assert.equal(T.store.listChildren().length, 0);
  } finally { await srv.close(); }
});

test('שרת זדוני: רישיון מזויף או הודעה מזויפת שהגיעו מהשרת — נדחים בתוכנה', async () => {
  const owner = createOwnerCore({ storage: mem() });
  const rootKeys = [owner.init(PASS).publicKey];
  const T = createLicenseStore({ storage: one(), secret: one(), rootKeys });
  T.setRemoteSettings({ url: 'https://evil.example' });
  const fake = L.generateKeyPair();
  const myKey = T.syncKey(true);
  const forgedLicense = L.issueLicense({ privateJwk: fake.privateJwk }, { name: 'מזויף', publicKey: L.publicOf(myKey), slot: 1,
    features: ['econ', 'trainer'], limits: tenantLimits, issuedAt: Date.now(), expiresAt: Date.now() + 1e10 });
  let box = [{ id: 'm1', from: 'x'.repeat(22), kind: 'license', at: Date.now(), body: JSON.stringify({ type: 'supersuite-license', v: 1, chain: [forgedLicense], notices: [] }) }];
  const evilFetch = async (url, opts) => {
    const op = JSON.parse(opts.body).op;
    const out = op === 'fetch' ? { ok: true, messages: box } : { ok: true };
    if (op === 'ack') box = [];
    return { ok: true, json: async () => out };
  };
  const sync = createLicenseSync({ store: T, owner: null, rootKeys, fetchImpl: evilFetch });
  const r = await sync.receive();
  assert.match(r.errors[0], /חתימת הרישיון אינה תקינה/);
  // לא הותקן כלום — נשארת בתקופת הניסיון (לא רישיון מלא עם התחומים המזויפים)
  assert.ok(T.current().trial);
  assert.equal(T.leafPayload(), null);
});

test('אין שרת / אין רשת: הודעה ברורה בעברית', async () => {
  const T = createLicenseStore({ storage: one(), secret: one(), rootKeys: [L.generateKeyPair().publicJwk] });
  const sync = createLicenseSync({ store: T, owner: null, rootKeys: [L.generateKeyPair().publicJwk], fetchImpl: fetch });
  await assert.rejects(sync.sendLicenseRequest('x'), /לא הוגדר שרת/);
  T.setRemoteSettings({ url: 'http://127.0.0.1:1' });
  await assert.rejects(sync.sendLicenseRequest('x'), /אין חיבור לשרת/);
  const rm = createRemote({ url: 'http://localhost:1', fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, error: 'internal' }) }) });
  await assert.rejects(rm.fetch(L.generateKeyPair().privateJwk), /שרת הרישוי דחה/);
});
