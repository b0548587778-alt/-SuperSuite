'use strict';
// רגרסיה לבדיקת הקוד 23.10.2026 — שרת הרישוי, בדיקה חתומה ומצב מנהל-העל:
// ממצא 27 (בדיקה חתומה לפני lastSync), 31 (הרשמה לפי הצעה ישנה), 4 (מצב מנהל-העל קשור לפגישה),
// 26 (קבצי מנהל-העל מוצפנים במנוחה), 39 (זמן קצוב לגוף התשובה) והממצאים הנמוכים של התחום
// (שולח הבקשה בתיבה, אימות חוזר לפני התקנת עדכון, כתיבה עמידה)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-ro-'));
let seq = 0;
const mk = (name) => { const d = path.join(tmp, name + '-' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
test.after(() => {
  // ב-Windows קובץ מסד פתוח נעול — סוגרים את המסד של ה-IPC לפני המחיקה
  try { ipc.getDb().db.close(); } catch { /* כבר סגור */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Electron מדומה לחלק של מצב מנהל-העל (ipc.js)
const handlers = {};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_ro__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_ro__.js'] = { id: '/__electron_stub_audit_ro__.js', filename: '/__electron_stub_audit_ro__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } } };

const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const CK = require('../shell/licensing/checkin');
const UP = require('../shell/licensing/update');
const OC = require('../shell/licensing/owner-core');
const { createLicenseStore } = require('../shell/licensing/store');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createRemote, MAX_RESPONSE_BYTES } = require('../shell/licensing/remote');
const R = require('../server/license-relay');
const AR = require('../modules/econ/core/atRest');
const ownerCli = require('../tools/licensing/owner');
const ipc = require('../modules/econ/ipc');
const { AuthService: auth } = require('../modules/econ/services/authService');

const PASS = 'menahel-al-audit-2026';
const DAY = 24 * 60 * 60 * 1000;
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n'.repeat(3);
const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'free', name: 'גמ"ח קטן', priceAgorot: 0, months: 12, features: ['econ.gemach'], limits: { maxUsers: 2 } },
    { id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['econ', 'econ.npo'], limits: { maxUsers: 10, maxChildren: 3 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
};
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };

// fetch מדומה שמעביר את הבקשה ישר לשרת (createRelay). tamper — שינוי התשובה בדרך (שרת מתחזה / שידור חוזר)
const relayFetch = (relay, tamper = (r) => r) => async (url, init) => {
  const body = JSON.parse(init.body);
  try {
    const r = tamper(await relay.handle(body, '127.0.0.1'), body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  } catch (e) {
    return { ok: false, status: e.status || 400, headers: { get: () => null }, json: async () => ({ ok: false, error: e.message }) };
  }
};
// התקנה עם מפתח מערכת וכתובת שרת
const RELAY_URL = 'https://relay.test';
function install(rootKeys, fetchImpl, clock, url = RELAY_URL) {
  const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
  store.syncKey(true);
  store.setRemoteSettings({ url });
  return { store, sync: createLicenseSync({ store, owner: null, rootKeys, fetchImpl, clock }) };
}
// מפתח שרת שנוצר "על השרת" ותעודה ממנהל-העל לכתובת השרת, כמו בשלב 7 של docs/LICENSING-ACTIVATION.md
function relayIdentity(owner, rootKeys, origin = RELAY_URL) {
  const dir = mk('relay');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  const g = R.generateRelayKey(keyFile);
  fs.writeFileSync(certFile, owner.relayCert(fs.readFileSync(g.pubFile, 'utf8'), { origin }).text);
  return { dir, keyFile, certFile, pubFile: g.pubFile, identity: R.loadRelayIdentity({ keyFile, certFile, rootKeys }) };
}
const signedReq = (kp, op, payload) => {
  const pub = kp.publicJwk, ts = Date.now(), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};

const owner = OC.createOwnerCore({ storage: mem() });
const rootKeys = [owner.init(PASS).publicKey];

// ---------- ממצא 27: בדיקה חתומה ----------

test('ממצא 27: שרת עם מפתח ותעודה ממנהל-העל — הסנכרון מאריך את תנאי ההפעלה', async () => {
  const d = relayIdentity(owner, rootKeys);
  assert.equal(d.identity.expired, false);
  const T = install(rootKeys, relayFetch(R.createRelay({ dataDir: d.dir, identity: d.identity })));
  assert.equal(T.store.lastSyncTime(), 0);
  const r = await T.sync.receive();
  assert.deepEqual(r.checkin, { ok: true, error: null, certExpiresAt: d.identity.expiresAt });
  assert.ok(T.store.lastSyncTime() > 0, 'lastSync — מהתשובה החתומה שנשמרה');
  assert.equal(T.store.getRemoteSettings().checkinError, null);
});

test('ממצא 27: שרת בלי מפתח (ישן, מקומי או כתובת שעברה לאחר) — אין lastSync, והסיבה נשמרת', async () => {
  const T = install(rootKeys, relayFetch(R.createRelay({ dataDir: mk('relay-plain') })));
  const r = await T.sync.receive();
  assert.equal(r.checkin.ok, false);
  assert.match(r.checkin.error, /לא אישר את החיבור/);
  assert.equal(T.store.lastSyncTime(), 0, 'שרת שאינו של הספק לא מאריך את ההפעלה');
  assert.match(T.store.getRemoteSettings().checkinError, /לא אישר/);
});

test('ממצא 27: תעודה ממפתח שורש אחר — נדחית אצל הלקוח, והשרת מסרב לעלות איתה', async () => {
  const other = OC.createOwnerCore({ storage: mem() });
  const otherKeys = [other.init(PASS).publicKey];
  const d = relayIdentity(other, null);
  assert.throws(() => R.loadRelayIdentity({ keyFile: d.keyFile, certFile: d.certFile, rootKeys }), /אינה של הספק/);
  assert.equal(R.loadRelayIdentity({ keyFile: d.keyFile, certFile: d.certFile, rootKeys: otherKeys }).relayId, d.identity.relayId);
  const T = install(rootKeys, relayFetch(R.createRelay({ dataDir: d.dir, identity: d.identity })));
  const r = await T.sync.receive();
  assert.equal(r.checkin.ok, false);
  assert.match(r.checkin.error, /אינה של הספק/);
  assert.equal(T.store.lastSyncTime(), 0);
});

test('ממצא 27: שידור חוזר של תשובה חתומה ישנה, וחתימה ששונתה — לא מאריכים', async () => {
  const d = relayIdentity(owner, rootKeys);
  const relay = R.createRelay({ dataDir: d.dir, identity: d.identity });
  let captured = null;
  const T = install(rootKeys, relayFetch(relay, (r) => { if (r.checkin && !captured) captured = { checkin: r.checkin, relayCert: r.relayCert }; return r; }));
  await T.sync.receive();
  const first = T.store.lastSyncTime();
  assert.ok(first > 0 && captured);
  // דקותיים אחר כך: "שרת" שמחזיר את התשובה החתומה מהפעם הקודמת (האתגר שונה)
  const later = () => Date.now() + 2 * 60 * 1000;
  const replay = createLicenseSync({ store: T.store, owner: null, rootKeys, clock: later,
    fetchImpl: relayFetch(relay, (r) => (r.checkin ? { ...r, ...captured } : r)) });
  const r2 = await replay.receive();
  assert.equal(r2.checkin.ok, false);
  assert.match(r2.checkin.error, /אינה שייכת לבקשה/);
  assert.equal(T.store.lastSyncTime(), first, 'שידור חוזר לא מקדם את lastSync');
  // שינוי של הזמן בתוך התשובה החתומה
  const forged = createLicenseSync({ store: T.store, owner: null, rootKeys, clock: later,
    fetchImpl: relayFetch(relay, (r) => (r.checkin ? { ...r, checkin: { ...r.checkin, payload: { ...r.checkin.payload, at: r.checkin.payload.at + 60000 } } } : r)) });
  const r3 = await forged.receive();
  assert.match(r3.checkin.error, /חתימת שרת הרישוי אינה תקינה/);
  assert.equal(T.store.lastSyncTime(), first);
});

test('ממצא 27: תעודה שפג תוקפה — נדחית; השרת עולה עם אזהרה (expired)', async () => {
  const old = OC.createOwnerCore({ storage: mem(), clock: () => Date.now() - 3 * 365 * DAY });
  const oldKeys = [old.init(PASS).publicKey];
  const d = relayIdentity(old, oldKeys);
  assert.equal(d.identity.expired, true);
  const T = install(oldKeys, relayFetch(R.createRelay({ dataDir: d.dir, identity: d.identity })));
  const r = await T.sync.receive();
  assert.match(r.checkin.error, /תוקף התעודה של שרת הרישוי פג/);
  assert.equal(T.store.lastSyncTime(), 0);
});

test('ממצא 27: התקנה בלי מפתח שורש (בלי רישוי) — כמו קודם, בלי דרישה לחתימה', async () => {
  const T = install([], relayFetch(R.createRelay({ dataDir: mk('relay-free') })));
  const r = await T.sync.receive();
  assert.equal(r.checkin.ok, true);
  assert.ok(T.store.getRemoteSettings().lastSync > 0);
});

test('ממצא 27: השרת חותם רק על אתגר תקין, ועל התיבה של השולח', () => {
  const d = relayIdentity(owner, rootKeys);
  const relay = R.createRelay({ dataDir: d.dir, identity: d.identity });
  const kp = L.generateKeyPair();
  assert.equal(relay.handle(signedReq(kp, 'fetch', {})).checkin, undefined);
  assert.equal(relay.handle(signedReq(kp, 'fetch', { checkin: 'short' })).checkin, undefined);
  const challenge = crypto.randomBytes(18).toString('base64url');
  const r = relay.handle(signedReq(kp, 'fetch', { checkin: challenge }));
  const att = { checkin: r.checkin, cert: r.relayCert };
  const ok = CK.verifyCheckin(att, { rootKeys, box: kp.keyId, challenge, origin: RELAY_URL });
  assert.equal(ok.relayId, d.identity.relayId);
  assert.deepEqual(ok.items, []);
  assert.throws(() => CK.verifyCheckin(att, { rootKeys, box: L.generateKeyPair().keyId, challenge, origin: RELAY_URL }), /אינה שייכת/);
  // הוכחת "סנכרון" אינה הוכחת "hello" ולהפך, ולכתובת אחרת — נדחית
  assert.throws(() => CK.verifyCheckin(att, { rootKeys, box: kp.keyId, challenge, origin: RELAY_URL, purpose: 'hello' }), /אינה שייכת/);
  assert.throws(() => CK.verifyCheckin(att, { rootKeys, box: kp.keyId, challenge, origin: 'https://other.test' }), /אינו מאושר/);
  const h = relay.handle(signedReq(kp, 'checkin', { checkin: challenge }));
  assert.equal(CK.verifyCheckin({ checkin: h.checkin, cert: h.relayCert }, { rootKeys, box: kp.keyId, challenge, origin: RELAY_URL, purpose: 'hello' }).items, null);
  assert.throws(() => CK.verifyCheckin({ checkin: h.checkin, cert: h.relayCert }, { rootKeys, box: kp.keyId, challenge, origin: RELAY_URL }), /אינה שייכת/);
  assert.throws(() => R.createRelay({ dataDir: mk('relay-noid') }).handle(signedReq(kp, 'checkin', { checkin: challenge })), /אינו מוגדר לבדיקה חתומה/);
});

test('ממצא 27: מפתח השרת — לא נדרס, וזוג חסר או לא תואם עוצר את השרת', () => {
  const dir = mk('relay-files');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  assert.equal(R.loadRelayIdentity({ keyFile, certFile, rootKeys }), null, 'בלי שניהם — שרת בלי בדיקה חתומה');
  const g = R.generateRelayKey(keyFile);
  assert.ok(!('d' in JSON.parse(fs.readFileSync(g.pubFile, 'utf8'))), 'הקובץ הציבורי בלי המפתח הפרטי');
  assert.throws(() => R.generateRelayKey(keyFile), /לא נדרס/);
  assert.throws(() => R.loadRelayIdentity({ keyFile, certFile, rootKeys }), /בלי תעודה/);
  // תעודה של מפתח שרת אחר
  const otherPub = L.generateKeyPair().publicJwk;
  fs.writeFileSync(certFile, owner.relayCert(otherPub, { origin: RELAY_URL }).text);
  assert.throws(() => R.loadRelayIdentity({ keyFile, certFile, rootKeys }), /מפתח שרת אחר/);
  fs.rmSync(keyFile);
  assert.throws(() => R.loadRelayIdentity({ keyFile, certFile, rootKeys }), /בלי מפתח השרת/);
});

test('ממצא 27: כלי מנהל-העל — תעודה למפתח השרת (relay-cert), ומפתח פרטי נדחה', () => {
  const dir = mk('owner-cli');
  const cli = ownerCli.createOwner({ dir, passphrase: PASS });
  cli.init();
  const kp = L.generateKeyPair();
  const r = cli.relayCert(JSON.stringify(kp.publicJwk), { origin: RELAY_URL + '/v1', months: 12 });
  const pub = JSON.parse(fs.readFileSync(path.join(dir, 'root.pub.json'), 'utf8'));
  assert.equal(CK.verifyRelayCert(r.text, [pub]).relayId, kp.keyId);
  assert.equal(r.origin, RELAY_URL, 'נשמר רק ה-origin');
  assert.throws(() => cli.relayCert(JSON.stringify(kp.privateJwk), { origin: RELAY_URL }), /מפתח פרטי/);
  assert.throws(() => cli.relayCert(JSON.stringify(kp.publicJwk), { origin: RELAY_URL, months: 100 }), /60 חודשים/);
  assert.throws(() => cli.relayCert(JSON.stringify(kp.publicJwk)), /חסרה כתובת השרת/);
  assert.throws(() => cli.relayCert(JSON.stringify(kp.publicJwk), { origin: 'http://relay.test' }), /https/);
  // הפקודה עצמה, עם הסיסמה מהמשתנה (לא משורת הפקודה)
  const pubFile = path.join(dir, 'relay-key.pub.json');
  const out = path.join(dir, 'relay-cert.json');
  fs.writeFileSync(pubFile, JSON.stringify(kp.publicJwk));
  const prev = process.env.SS_OWNER_PASSPHRASE;
  const log = console.log;
  process.env.SS_OWNER_PASSPHRASE = PASS;
  console.log = () => {};
  const out2 = path.join(dir, 'relay-cert-2.json');
  try {
    ownerCli.main(['relay-cert', '--dir', dir, '--relay-pub', pubFile, '--out', out]);
    ownerCli.main(['relay-cert', '--dir', dir, '--relay-pub', pubFile, '--url', RELAY_URL, '--out', out2]);
  } finally { console.log = log; if (prev === undefined) delete process.env.SS_OWNER_PASSPHRASE; else process.env.SS_OWNER_PASSPHRASE = prev; }
  // בלי --url — הכתובת המובנית
  const c1 = CK.verifyRelayCert(fs.readFileSync(out, 'utf8'), [pub]);
  assert.equal(c1.relayId, kp.keyId);
  assert.equal(c1.origin, new URL(require('../shell/licensing/default-relay').DEFAULT_RELAY_URL).origin);
  assert.equal(CK.verifyRelayCert(fs.readFileSync(out2, 'utf8'), [pub]).origin, RELAY_URL);
});

// ---------- סקירה: התשובה החתומה מכסה את ההודעות שבתיבה ואת הכתובת ----------

// מערכת עם רישיון ממנהל-העל, והשבתה שמנהל-העל שלח לה דרך השרת
async function heldTenant(relay, tamper) {
  const T = install(rootKeys, relayFetch(relay, tamper));
  const lic = owner.issue({ request: T.store.request('ישיבת שערי תורה'), features: ['econ'], limits: { maxUsers: 2, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 } });
  T.store.install(lic.package);
  const before = owner.noticesPackage(lic.id); // חבילת הודעות תקינה מלפני ההשבתה — "תוכן ישן" לשרת ביניים
  owner.notice({ type: 'hold', target: lic.id, kind: 'suspended', reason: 'חוב פתוח' });
  await createRemote({ url: RELAY_URL, fetchImpl: relayFetch(relay) }).send(owner.rootSigner(), [{ to: lic.id, kind: 'notices', body: owner.noticesPackage(lic.id) }]);
  return { T, id: lic.id, before };
}
const boxOf = (relay, kp) => relay.handle(signedReq(kp, 'fetch', {})).messages;

test('סקירה (27): שרת ביניים שמוחק את הודעת ההשבתה מהתשובה ומשאיר את החתימה — אין lastSync, וההודעה נשארת בשרת', async () => {
  const d = relayIdentity(owner, rootKeys);
  const relay = R.createRelay({ dataDir: d.dir, identity: d.identity });
  let drop = true;
  const h = await heldTenant(relay, (r, body) => (drop && body.op === 'fetch' ? { ...r, messages: [] } : r));
  const r1 = await h.T.sync.receive();
  assert.equal(r1.checkin.ok, false);
  assert.match(r1.checkin.error, /חלקית/);
  assert.equal(h.T.store.lastSyncTime(), 0, 'lastSync לא התקדם');
  assert.notEqual(h.T.store.current().status, 'suspended');
  // בלי שרת הביניים — ההשבתה מגיעה, ורק אז החיבור מאריך
  drop = false;
  const r2 = await h.T.sync.receive();
  assert.equal(r2.checkin.ok, true);
  assert.ok(h.T.store.lastSyncTime() > 0);
  assert.equal(h.T.store.current().status, 'suspended');
});

test('סקירה (27): שרת ביניים שמחליף את תוכן ההשבתה בתוכן ישן — לא נמחקת בשרת (ack לפי תמצית), ואין lastSync', async () => {
  const d = relayIdentity(owner, rootKeys);
  const relay = R.createRelay({ dataDir: d.dir, identity: d.identity });
  let swap = true;
  let h = null;
  h = await heldTenant(relay, (r, body) => (swap && body.op === 'fetch' && Array.isArray(r.messages)
    ? { ...r, messages: r.messages.map(m => (m.kind === 'notices' ? { ...m, body: h.before } : m)) } : r));
  const r1 = await h.T.sync.receive();
  assert.equal(r1.checkin.ok, false);
  assert.match(r1.checkin.error, /חלקית או ששונתה/);
  assert.equal(h.T.store.lastSyncTime(), 0);
  assert.notEqual(h.T.store.current().status, 'suspended');
  // הלקוח אישר (ack) את ההודעה "שקיבל" — אבל השרת לא מחק את ההודעה האמיתית
  const tenantKp = { publicJwk: L.publicOf(h.T.store.syncKey(false)), privateJwk: h.T.store.syncKey(false) };
  assert.equal(boxOf(relay, tenantKp).filter(m => m.kind === 'notices').length, 1, 'ההשבתה עדיין בשרת');
  swap = false;
  assert.equal((await h.T.sync.receive()).checkin.ok, true);
  assert.equal(h.T.store.current().status, 'suspended');
  // הודעת הסטטוס של השורש נשארת במקום השמור גם אחרי קבלה תקינה — לא נמחקת באישור (סקירה 24.10.2026, ממצא 3)
  assert.deepEqual(boxOf(relay, tenantKp).map(m => m.kind), ['notices'], 'נשארת במקום השמור');
});

test('סקירה (27): המחיקה בשרת (ack) — לפי תמצית התוכן; מזהים בלבד — תוכנה ישנה', () => {
  const relay = R.createRelay({ dataDir: mk('relay-ack') });
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  relay.handle(signedReq(a, 'send', { items: [{ to: b.keyId, kind: 'message', body: 'x1' }, { to: b.keyId, kind: 'message', body: 'x2' }] }));
  const [m1, m2] = boxOf(relay, b);
  assert.equal(relay.handle(signedReq(b, 'ack', { ids: [m1.id], items: [[m1.id, CK.messageDigest({ ...m1, body: 'אחר' })]] })).removed, 0, 'תמצית שונה — לא נמחקת');
  assert.equal(relay.handle(signedReq(b, 'ack', { ids: [m1.id], items: [[m1.id, CK.messageDigest(m1)]] })).removed, 1);
  assert.equal(relay.handle(signedReq(b, 'ack', { ids: [m2.id] })).removed, 1, 'תוכנה ישנה — לפי מזהה');
});

test('סקירה (27): שרת בכתובת אחרת שמעביר את הבקשות לשרת האמיתי — החתימה על כתובת השרת האמיתי, ואין lastSync', async () => {
  const d = relayIdentity(owner, rootKeys);
  // הלקוח פונה ל-old.test (למשל כתובת sslip.io שעברה לבעלים אחרים), וזה מעביר הכול לשרת האמיתי
  const T = install(rootKeys, relayFetch(R.createRelay({ dataDir: d.dir, identity: d.identity })), undefined, 'https://old.test');
  const r = await T.sync.receive();
  assert.equal(r.checkin.ok, false);
  assert.match(r.checkin.error, /אינו מאושר על ידי הספק/);
  assert.equal(T.store.lastSyncTime(), 0);
});

test('סקירה (sslip.io): פרטי הרשמה לא נשלחים ודף תשלום לא נפתח בלי הוכחה חתומה מהשרת', async () => {
  const offerText = owner.setOffer(OFFER).text;
  const writeOffer = (dir) => fs.writeFileSync(path.join(dir, 'offer.json'), JSON.stringify({ text: offerText, issuedAt: JSON.parse(offerText).payload.issuedAt }));
  const input = { offerText, planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true };
  // שרת בלי מפתח שרת (למשל מי שקיבל את כתובת ה-IP) — ההרשמה לא נשלחת אליו בכלל
  const plainDir = mk('relay-signup-plain');
  writeOffer(plainDir);
  const ops = [];
  const plain = R.createRelay({ dataDir: plainDir, billing: { rootKeys, provider: fakeProvider() } });
  const T1 = install(rootKeys, relayFetch(plain, (r, body) => { ops.push(body.op); return r; }));
  await assert.rejects(T1.sync.signup(input), /פרטי ההרשמה לא נשלחו/);
  assert.ok(!ops.includes('checkout'), 'checkout לא נשלח');
  assert.equal(T1.store.getRemoteSettings().signup, undefined);
  // השרת של הספק — ההרשמה נשלחת, והקישור נפתח רק אחרי הוכחה מאותה כתובת
  const d = relayIdentity(owner, rootKeys);
  writeOffer(d.dir);
  let good = true;
  const relay = R.createRelay({ dataDir: d.dir, billing: { rootKeys, provider: fakeProvider() }, identity: d.identity });
  const T2 = install(rootKeys, relayFetch(relay, (r, body) => (!good && body.op === 'checkin' ? { ok: true } : r)));
  const r = await T2.sync.signup(input);
  assert.equal(r.status, 'pending');
  assert.equal(T2.store.getRemoteSettings().signup.origin, RELAY_URL);
  assert.equal(await T2.sync.paymentUrl(), r.url);
  // השרת מפסיק להוכיח (הוחלף) — הקישור לא נפתח, וגם בדיקת המצב לא מעדכנת קישור
  good = false;
  await assert.rejects(T2.sync.paymentUrl(), /דף התשלום לא נפתח/);
  await assert.rejects(T2.sync.signupStatus(), /מצב התשלום לא נבדק/);
  // הכתובת הוחלפה מאז ההרשמה — הקישור הישן לא נפתח
  good = true;
  T2.store.setRemoteSettings({ url: 'https://other.test' });
  await assert.rejects(T2.sync.paymentUrl(), /לא התקבל מכתובת השרת הנוכחית/);
  // בלי מפתח שורש (בלי רישוי) — כמו קודם, בלי דרישה
  const free = install([], relayFetch(plain));
  free.store.setRemoteSettings({ signup: { url: 'https://pay.example/x', status: 'pending' } });
  assert.equal(await free.sync.paymentUrl(), 'https://pay.example/x');
});

test('סקירה (31): פרסום הצעה — נרשמת ההצעה שנשלחה, גם כשנשמרה הצעה חדשה בזמן הפרסום; הרשמה שלא נקלטה בגלל תקלה נשארת בשרת', async () => {
  let t = Date.now() - 10 * DAY;
  const o = OC.createOwnerCore({ storage: mem(), clock: () => t });
  const keys = [o.init(PASS).publicKey];
  const sent = o.setOffer(OFFER).text;
  const store = createLicenseStore({ storage: one(), secret: one(), rootKeys: keys });
  store.setRemoteSettings({ url: RELAY_URL });
  let later = null;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    // בזמן שהפרסום "ברשת" — מנהל-העל שומר הצעה חדשה
    if (body.op === 'setOffer') { t += DAY; later = o.setOffer({ ...OFFER, plans: [{ ...OFFER.plans[0], months: 24 }] }).text; }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
  };
  await createLicenseSync({ store, owner: o, rootKeys: keys, fetchImpl }).ownerPublishOffer();
  const issued = (text) => JSON.parse(text).payload.issuedAt;
  // ההצעה שנשלחה — "חיה"; זו שנשמרה בזמן הפרסום (לא פורסמה) — לבדיקה, לא נדחית
  const device = () => L.generateKeyPair();
  const delivery = (text) => JSON.stringify({ type: 'supersuite-signup-delivery', signup: text, payment: null });
  assert.equal(o.addSignup(delivery(signupOn(device(), sent, keys, 'free', t)), { at: t }).review, false);
  assert.equal(o.addSignup(delivery(signupOn(device(), later, keys, 'free', t)), { at: t }).review, true);
  assert.notEqual(issued(sent), issued(later));

  // ownerReceive: הרשמה שלא נקלטה בגלל תקלה (לא בגלל שהיא פגומה) — לא נמחקת בשרת
  const kp = L.generateKeyPair();
  const msg = { id: 'sig-1', from: 'relay', kind: 'signup', body: '{}', at: t };
  const acks = [];
  const box = (failure) => ({ rootSigner: () => kp.privateJwk, inbox: () => [], contacts: () => [],
    addSignup: () => { throw failure; } });
  const fetchBox = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.op === 'ack') acks.push(body.payload);
    const r = body.op === 'fetch' ? { ok: true, messages: [msg], more: false } : { ok: true };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  };
  await createLicenseSync({ store, owner: box(new Error('הקובץ תפוס')), rootKeys: keys, fetchImpl: fetchBox }).ownerReceive();
  assert.equal(acks.length, 0, 'תקלה — ההרשמה נשארת בשרת');
  await createLicenseSync({ store, owner: box(Object.assign(new Error('פגומה'), { code: 'signup-invalid' })), rootKeys: keys, fetchImpl: fetchBox }).ownerReceive();
  assert.deepEqual(acks[0].items, [['sig-1', CK.messageDigest(msg)]], 'הרשמה פגומה — נמחקת, עם תמצית התוכן');
});

// ---------- ממצא 39: זמן קצוב גם לגוף התשובה ----------

test('ממצא 39: שרת ששולח כותרות ואז לא מסיים את הגוף — הבקשה נכשלת בזמן', async () => {
  const k = L.generateKeyPair().privateJwk;
  const rm = createRemote({ url: 'https://relay.test', timeoutMs: 50,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise(() => {}) }) });
  const t0 = Date.now();
  await assert.rejects(rm.fetch(k), /לא השלים את התשובה בזמן/);
  assert.ok(Date.now() - t0 < 5000);
  const stuck = createRemote({ url: 'https://relay.test', timeoutMs: 50, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(stuck.fetch(k), /אין חיבור לשרת הרישוי/);
});

test('ממצא 39: גוף תשובה גדול מהתקרה — נדחה בלי לקרוא את כולו', async () => {
  const k = L.generateKeyPair().privateJwk;
  let reads = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const big = createRemote({ url: 'https://relay.test', fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => (++reads < 100 ? { done: false, value: chunk } : { done: true }), cancel: async () => {} }) } }) });
  await assert.rejects(big.fetch(k), /תשובה לא תקינה/);
  assert.ok(reads <= MAX_RESPONSE_BYTES / chunk.length + 1, 'הקריאה נעצרה בתקרה');
  const declared = createRemote({ url: 'https://relay.test', fetchImpl: async () => ({ ok: true, status: 200,
    headers: { get: (h) => (h === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) }, json: async () => ({ ok: true, messages: [] }) }) });
  await assert.rejects(declared.fetch(k), /תשובה לא תקינה/);
  // תשובה רגילה דרך אותו קורא
  const okBody = new TextEncoder().encode(JSON.stringify({ ok: true, messages: [] }));
  let sent = false;
  const fine = createRemote({ url: 'https://relay.test', fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: okBody })), cancel: async () => {} }) } }) });
  assert.deepEqual(await fine.fetch(k), []);
});

// ---------- ממצא 31: הרשמה לפי הצעה ישנה ----------

function fakeProvider() {
  let n = 0;
  return { name: 'fake', async createCheckout() { const id = 'c' + (++n); return { checkoutId: id, url: 'https://pay.example/' + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody) };
}
const signupOn = (device, offerText, keys, planId, at) => SU.createSignup({ deviceJwk: device.privateJwk, offerText, rootKeys: keys,
  planId, customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at }).text;

test('ממצא 31: השרת — הרשמה לפי הצעה שהוחלפה, הרשמה ישנה, ובלי הצעה מפורסמת — נדחות', async () => {
  const root = L.generateKeyPair();
  const dir = mk('relay-signup');
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys: [root.publicJwk], provider: fakeProvider() } });
  const device = L.generateKeyPair();
  const oldOffer = OF.createOffer(root.privateJwk, { ...OFFER, plans: [{ ...OFFER.plans[1], priceAgorot: 100 }] }, { issuedAt: Date.now() - 30 * DAY });
  const cur = OF.createOffer(root.privateJwk, OFFER, { issuedAt: Date.now() - DAY });
  await assert.rejects(async () => relay.handle(signedReq(device, 'checkout', { signup: signupOn(device, cur, [root.publicJwk], 'pro') })), /עדיין לא פרסם/);
  fs.writeFileSync(path.join(dir, 'offer.json'), JSON.stringify({ text: cur, issuedAt: JSON.parse(cur).payload.issuedAt }));
  // הצעה חתומה ישנה עם מחיר זול — חתימה תקינה, אבל כבר לא בתוקף
  await assert.rejects(async () => relay.handle(signedReq(device, 'checkout', { signup: signupOn(device, oldOffer, [root.publicJwk], 'pro') })), /עודכנו/);
  await assert.rejects(async () => relay.handle(signedReq(device, 'checkout', { signup: signupOn(device, cur, [root.publicJwk], 'pro', Date.now() - 2 * DAY) })), /ההרשמה ישנה/);
  const ok = await relay.handle(signedReq(device, 'checkout', { signup: signupOn(device, cur, [root.publicJwk], 'pro') }));
  assert.equal(ok.status, 'pending');
  assert.ok(ok.url);
});

test('ממצא 31: מנהל-העל — הרשמה לפי הצעה שהוחלפה ("לבדיקה", גם חינם) מונפקת רק באישור', () => {
  let t = Date.now() - 100 * DAY;
  const o = OC.createOwnerCore({ storage: mem(), clock: () => t });
  const keys = [o.init(PASS).publicKey];
  const offer1 = o.setOffer(OFFER).text;
  o.offerPublished();
  const device = () => L.generateKeyPair();
  const delivery = (text, paid) => JSON.stringify({ type: 'supersuite-signup-delivery', signup: text, payment: paid ? { amountAgorot: 49900, providerRef: 'r1' } : null });
  const freeOld = signupOn(device(), offer1, keys, 'free', t);
  const freeEarly = signupOn(device(), offer1, keys, 'free', t);
  const paidLate = signupOn(device(), offer1, keys, 'pro', t);
  const paidSoon = signupOn(device(), offer1, keys, 'pro', t);
  t += 10 * DAY;
  o.setOffer({ ...OFFER, plans: [{ ...OFFER.plans[1], priceAgorot: 59900 }] });
  const T2 = t;
  o.offerPublished();
  // חינם לפי הצעה שהוחלפה — לא נדחית (השרת מוחק אותה אחרי הקליטה), אלא "לבדיקה" ולא מונפקת בלחיצה
  const freeLate = o.addSignup(delivery(freeOld, false), { at: T2 + 2 * 60 * 60 * 1000 });
  assert.equal(freeLate.review, true);
  assert.match(o.signups().find(x => x.id === freeLate.id).problem, /אינה המפורסמת/);
  assert.throws(() => o.issueSignup(freeLate.id), /אינה המפורסמת/);
  assert.equal(o.addSignup(delivery(freeEarly, false), { at: T2 - 1000 }).review, false, 'נמסרה לפני שההצעה הוחלפה');
  // הרשמה לא תקינה — signup-invalid (נדחית ונמחקת בשרת); תקלה אחרת — לא
  assert.throws(() => o.addSignup('{bad'), (e) => e.code === 'signup-invalid');
  assert.throws(() => o.addSignup(JSON.stringify({ signup: '{}' })), (e) => e.code === 'signup-invalid');
  assert.equal(o.addSignup(delivery(paidSoon, true), { at: T2 + 5 * DAY }).review, false, 'בתשלום — מרווח לתשלום שהתעכב');
  const late = o.addSignup(delivery(paidLate, true), { at: T2 + 40 * DAY });
  assert.equal(late.review, true);
  const row = o.signups().find(x => x.id === late.id);
  assert.equal(row.status, 'review');
  assert.match(row.problem, /הוחלפה/);
  assert.throws(() => o.issueSignup(late.id), /הוחלפה/);
  const issued = o.issueSignup(late.id, { force: true });
  assert.ok(issued.package);
  assert.equal(o.signups().find(x => x.id === late.id).status, 'issued');
});

test('ממצא 31: ההצעה בהרשמה חייבת להיות ההצעה הנוכחית (verifySignup עם current)', () => {
  const root = L.generateKeyPair();
  const a = OF.createOffer(root.privateJwk, OFFER, { issuedAt: 1000 });
  const b = OF.createOffer(root.privateJwk, OFFER, { issuedAt: 2000 });
  const s = signupOn(L.generateKeyPair(), a, [root.publicJwk], 'pro');
  assert.equal(SU.verifySignup(s, [root.publicJwk], { current: OF.verifyOffer(a, [root.publicJwk]) }).plan.id, 'pro');
  assert.throws(() => SU.verifySignup(s, [root.publicJwk], { current: OF.verifyOffer(b, [root.publicJwk]) }), /עודכנו/);
});

// ---------- ממצאים נמוכים: שולח הבקשה, עדכון לפני התקנה, כתיבה עמידה ----------

test('נמוך: בקשת רישיון בתיבת מנהל-העל שנשלחה ממפתח אחר — "לא תקינה" ואי אפשר להנפיק לפיה', () => {
  const o = OC.createOwnerCore({ storage: mem() });
  o.init(PASS);
  const T = createLicenseStore({ storage: one(), secret: one(), rootKeys: [o.pubkey()] });
  const req = T.request('ישיבת אור תורה');
  const body = JSON.stringify(req);
  o.addToInbox({ id: 'm1', from: L.generateKeyPair().keyId, at: Date.now(), body });
  assert.equal(o.inbox()[0].summary.kind, 'invalid');
  assert.throws(() => o.inboxRequest('m1'), /לא נשלחה מהמערכת שביקשה/);
  o.addToInbox({ id: 'm2', from: L.keyId(req.publicKey), at: Date.now(), body });
  assert.equal(o.inbox().find(m => m.id === 'm2').summary.kind, 'license');
  assert.equal(o.inboxRequest('m2').id, 'm2');
});

test('נמוך: התקנת עדכון — התעודה נבדקת שוב, וה-payload שמוחזר הוא החתום', async () => {
  const root = L.generateKeyPair();
  const BIN = crypto.randomBytes(2048);
  const sha = crypto.createHash('sha256').update(BIN).digest('hex');
  const rel = UP.createRelease(root.privateJwk, { version: '3.9.0', fileName: 'SuperSuite-Setup-3.9.0.exe', size: BIN.length, sha256: sha,
    url: 'https://updates.example.org/SuperSuite-Setup-3.9.0.exe', notes: 'שיפורים' }, { issuedAt: 1000 });
  const storage = one();
  const m = UP.createUpdateManager({ storage, rootKeys: [root.publicJwk], currentVersion: '3.8.0', platform: 'win',
    saveFile: async (name) => '/updates/' + name, clock: () => 5 });
  await m.fromFile(rel, BIN);
  assert.equal(m.readyToInstall().payload.sha256, sha);
  // מי שכותב ל-updates.json מחליף את התמצית שלידה — מוחזרת התמצית מהתעודה החתומה
  const d = JSON.parse(storage.read());
  storage.write(JSON.stringify({ ...d, available: { ...d.available, payload: { ...d.available.payload, sha256: '0'.repeat(64), size: 1 } } }));
  assert.equal(m.readyToInstall().payload.sha256, sha);
  assert.equal(m.readyToInstall().payload.size, BIN.length);
  // תעודה ששונתה בקובץ — נדחית
  const t = JSON.parse(d.available.text);
  t.payload.sha256 = '0'.repeat(64);
  storage.write(JSON.stringify({ ...d, available: { ...d.available, text: JSON.stringify(t) } }));
  assert.throws(() => m.readyToInstall());
  storage.write(JSON.stringify({ ...d, available: { ...d.available, text: undefined } }));
  assert.throws(() => m.readyToInstall(), /אין עדכון מוכן/);
});

// fs עטוף שרושם את סדר הקריאות — fsync על אותו קובץ לפני ההחלפה (rename)
function recordingFs() {
  const calls = [];
  const wrap = (name) => (...args) => { const r = fs[name](...args); calls.push([name, name === 'openSync' ? r : args[0]]); return r; };
  const rec = { ...fs };
  for (const n of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'writeFileSync']) rec[n] = wrap(n);
  return { fs: rec, calls };
}
function assertDurableWrite(calls, label) {
  const names = calls.map(c => c[0]);
  assert.deepEqual(names, ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync'], label + ': קובץ זמני ← fsync ← החלפה');
  const fd = calls[0][1];
  assert.equal(calls[1][1], fd, label + ': הכתיבה לאותו קובץ');
  assert.equal(calls[2][1], fd, label + ': fsync על אותו קובץ');
  assert.equal(calls[3][1], fd);
}

test('נמוך: dirStorage — כתיבה עמידה: קובץ זמני, fsync, סגירה ואז החלפה; בלי שאריות', () => {
  const dir = mk('dirstore');
  const r = recordingFs();
  const st = OC.dirStorage(r.fs, path, dir);
  st.write('registry.json', '{"a":1}');
  assertDurableWrite(r.calls, 'dirStorage.write');
  r.calls.length = 0;
  st.write('registry.json', '{"a":2}');
  assert.equal(st.read('registry.json'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(dir), ['registry.json'], 'אין קובץ ‎.tmp שנשאר');
  assert.equal(st.read('missing.json'), null);
});

test('נמוך: החלפת סיסמה — root.key נכתב באותו מסלול עמיד (fsync לפני החלפה)', () => {
  const dir = mk('dirstore-pass');
  const r = recordingFs();
  const o = OC.createOwnerCore({ storage: OC.dirStorage(r.fs, path, dir) });
  o.init(PASS);
  r.calls.length = 0;
  o.changePassphrase(PASS, PASS + '-new');
  // הכתיבה היחידה בהחלפת הסיסמה היא של root.key (הקבצים האחרים כבר מוצפנים — אין המרה)
  const start = r.calls.findIndex(c => c[0] === 'openSync');
  assert.ok(start >= 0);
  assertDurableWrite(r.calls.slice(start, start + 5), 'root.key');
  assert.equal(r.calls.length, start + 5);
  assert.ok(String(r.calls[start + 4][1]).endsWith('root.key.tmp'));
  o.lock();
  o.unlock(PASS + '-new');
});

// ---------- ממצא 26: קבצי מנהל-העל מוצפנים במנוחה — במפתח השורש ----------

const onDiskOf = (dir) => (n) => fs.readFileSync(path.join(dir, n), 'utf8');

test('ממצא 26: נתוני הלקוחות מוצפנים במפתח השורש — נפתחים רק במצב פתוח, ובכל מחשב עם התיקייה והסיסמה', () => {
  const dir = mk('owner-sealed');
  const onDisk = onDiskOf(dir);
  const o = OC.createOwnerCore({ storage: OC.dirStorage(fs, path, dir) });
  o.init(PASS);
  const T = createLicenseStore({ storage: one(), secret: one(), rootKeys: [o.pubkey()] });
  const req = T.request('ישיבת אור תורה — 050-1234567');
  o.addToInbox({ id: 'm1', from: L.keyId(req.publicKey), at: 1, body: JSON.stringify(req) });
  o.issue({ request: JSON.stringify(req), features: ['econ'], limits: { maxUsers: 2, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 } });
  for (const n of OC.SEALED_OWNER_FILES.filter(n => n !== 'signups.json')) {
    assert.ok(onDisk(n).startsWith(OC.OWNER_SEAL_PREFIX), n + ' מוצפן');
    assert.ok(!onDisk(n).includes('050-1234567'), n + ' בלי טקסט גלוי');
  }
  // המפתח (מוצפן בסיסמה) והמפתח הציבורי — כמו שהם
  assert.ok(onDisk('root.key').startsWith('SSBK1:'));
  assert.equal(JSON.parse(onDisk('root.pub.json')).x, o.pubkey().x);
  // נעול: אין קריאה של נתוני לקוחות — גם לא רשימה ריקה
  o.lock();
  assert.throws(() => o.inbox(), /לפתוח את מצב מנהל-העל/);
  assert.throws(() => o.signups(), /לפתוח את מצב מנהל-העל/);
  assert.throws(() => o.list(), /לפתוח את מצב מנהל-העל/);
  assert.throws(() => o.peekInbox('m1'), /לפתוח את מצב מנהל-העל/);
  assert.equal(o.pubkey().x, JSON.parse(onDisk('root.pub.json')).x, 'המפתח הציבורי — גם כשנעול');
  // "מחשב אחר": עותק של התיקייה, בלי מפתח המסד — נפתח בסיסמה, גם בכלי שורת הפקודה
  const copy = mk('owner-copy');
  for (const n of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, n), path.join(copy, n));
  const o2 = OC.createOwnerCore({ storage: OC.dirStorage(fs, path, copy) });
  o2.unlock(PASS);
  assert.equal(o2.inbox()[0].id, 'm1');
  assert.equal(o2.list().tenants.length, 1);
  assert.equal(ownerCli.createOwner({ dir: copy, passphrase: PASS }).list().length, 1);
  assert.throws(() => ownerCli.createOwner({ dir: copy, passphrase: 'not-the-owner-pass' }).list(), /שגויה/);
  // קובץ פגום — שגיאה בעברית, לא "ריק"
  fs.writeFileSync(path.join(copy, 'registry.json'), OC.OWNER_SEAL_PREFIX + 'AAAA' + onDisk('registry.json').slice(OC.OWNER_SEAL_PREFIX.length + 4));
  assert.throws(() => o2.list(), /אינו נפתח במפתח השורש/);
});

test('ממצא 26: קבצים ישנים — גלויים או מוצפנים במפתח המסד (גרסת ביניים) — מוצפנים במפתח השורש מיד בפתיחה', () => {
  const dir = mk('owner-legacy');
  const onDisk = onDiskOf(dir);
  const inner = OC.dirStorage(fs, path, dir);
  const o = OC.createOwnerCore({ storage: inner });
  o.init(PASS);
  o.lock();
  // הרשמות גלויות מגרסה קודמת, ותיבה + הצעה שהוצפנו במפתח המסד
  const db = AR.createCipher(AR.deriveDbKey(crypto.randomBytes(32).toString('base64')));
  inner.write('signups.json', JSON.stringify([{ id: 's1', customer: CUSTOMER }]));
  inner.write('inbox.json', db.seal(JSON.stringify([{ id: 'm9', from: 'x', at: 1, body: '{}', summary: { kind: 'invalid' } }])));
  inner.write('offer.json', db.seal(JSON.stringify({ text: 'x', published: [] })));
  // בלי הצופן של המסד — הקובץ לא נפתח (שגיאה בעברית), ונשאר כמו שהוא
  const noDb = OC.createOwnerCore({ storage: inner });
  noDb.unlock(PASS);
  assert.throws(() => noDb.inbox(), /הוצפן במפתח של המחשב הזה/);
  assert.ok(AR.isSealed(onDisk('inbox.json')));
  // ההרשמות הגלויות הוצפנו כבר בפתיחה — לא רק כשנקראו
  assert.ok(onDisk('signups.json').startsWith(OC.OWNER_SEAL_PREFIX));
  assert.ok(!onDisk('signups.json').includes('050-1234567'));
  // עם הצופן של המסד: הכול מומר בפתיחה
  const withDb = OC.createOwnerCore({ storage: inner, legacyCipher: () => db });
  withDb.unlock(PASS);
  assert.ok(onDisk('inbox.json').startsWith(OC.OWNER_SEAL_PREFIX));
  assert.equal(JSON.parse(onDisk('offer.json')).text, 'x', 'ההצעה ציבורית — חוזרת לטקסט גלוי');
  assert.equal(withDb.inbox()[0].id, 'm9');
  assert.equal(withDb.signups()[0].customer.phone, CUSTOMER.phone);
});

test('ממצא 26: גיבוי מלא — נתוני הלקוחות מוצפנים בו במפתח השורש, ונפתחים אחרי שחזור במחשב אחר', () => {
  const s1 = mem();
  const o = OC.createOwnerCore({ storage: s1 });
  o.init(PASS);
  const T = createLicenseStore({ storage: one(), secret: one(), rootKeys: [o.pubkey()] });
  o.issue({ request: JSON.stringify(T.request('כולל חזון איש')), features: ['econ'], limits: { maxUsers: 2, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 } });
  const backup = o.exportBackup('backup-pass-12345');
  const s2 = mem();
  const o2 = OC.createOwnerCore({ storage: s2 });
  assert.equal(o2.importBackup(backup, 'backup-pass-12345').tenants, 1);
  assert.ok(s2.read('registry.json').startsWith(OC.OWNER_SEAL_PREFIX), 'גם אחרי השחזור — מוצפן');
  assert.throws(() => o2.list(), /לפתוח/);
  o2.unlock(PASS);
  assert.equal(o2.list().tenants[0].name, 'כולל חזון איש');
});

// ---------- ממצא 4: מצב מנהל-העל קשור לפגישה שפתחה אותו (דרך ipc.js האמיתי) ----------

const OPASS = 'menahel-al-owner-pass';
const ev = (id) => ({ sender: { id } });
const state = (id) => handlers['owner:getState'](ev(id));
let booted = null;
async function boot() {
  if (booted) return booted;
  await ipc.initEcon(mk('econ'), { rootKeys: [], relayUrl: '', fetchImpl: async () => { throw new Error('אין רשת בבדיקות'); } });
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-strong-pass-1');
  const b = await handlers['users:create'](ev(1), { username: 'menahel_b', password: 'menahel-b-strong-pass', role: 'admin' });
  await handlers['auth:login'](ev(2), 'menahel_b', 'menahel-b-strong-pass');
  await handlers['owner:init'](ev(1), OPASS);
  booted = { b };
  return booted;
}

test('ממצא 4: מי שפתח — נשאר פתוח; מנהל אחר בחלון אחר מקבל מצב נעול', async () => {
  await boot();
  await handlers['owner:unlock'](ev(1), OPASS);
  assert.equal((await state(1)).unlocked, true);
  assert.equal((await state(1)).unlocked, true, 'שימוש רגיל לא נועל');
  assert.equal((await state(2)).unlocked, false);
  await handlers['owner:unlock'](ev(1), OPASS);
  await assert.rejects(handlers['owner:recoveryCodes'](ev(2), OPASS, 5, 3), /לפתוח את מצב מנהל-העל/);
});

test('ממצא 4: יציאה, ניתוק בחוסר פעילות, חסימה/איפוס של המשתמש וכניסה מחדש — נועלים', async () => {
  const { b } = await boot();
  // הפגישה מוחזרת אחרי האירוע — כדי לבדוק שהנעילה באה מהאירוע עצמו ולא מהחלפת הפגישה
  const reopen = (id, s) => { s.lastSeen = auth.now(); auth.sessions.set(id, s); };

  await handlers['owner:unlock'](ev(1), OPASS);
  let s1 = auth.sessions.get(1);
  await handlers['auth:logout'](ev(1));
  reopen(1, s1);
  assert.equal((await state(1)).unlocked, false, 'יציאה');

  await handlers['owner:unlock'](ev(1), OPASS);
  s1 = auth.sessions.get(1);
  const realNow = auth.now;
  auth.now = () => Date.now() + auth.idleMs + 60000;
  try { await assert.rejects(handlers['users:list'](ev(1)), /נדרשת כניסה/); } finally { auth.now = realNow; }
  reopen(1, s1);
  assert.equal((await state(1)).unlocked, false, 'ניתוק בחוסר פעילות');

  await handlers['owner:unlock'](ev(2), OPASS);
  const s2 = auth.sessions.get(2);
  await handlers['users:resetPassword'](ev(1), b.id, 'menahel-b-new-pass-1');
  reopen(2, s2);
  assert.equal((await state(2)).unlocked, false, 'איפוס סיסמה / חסימה (dropUser)');

  await handlers['owner:unlock'](ev(1), OPASS);
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-strong-pass-1');
  assert.equal((await state(1)).unlocked, false, 'כניסה מחדש באותו חלון');
});

test('ממצא 4: קודי שחזור — רק עם סיסמת מנהל-העל, גם כשהמצב פתוח', async () => {
  await boot();
  await handlers['owner:unlock'](ev(1), OPASS);
  await assert.rejects(handlers['owner:recoveryCodes'](ev(1), undefined, 5, 3), /לפחות/);
  await assert.rejects(handlers['owner:recoveryCodes'](ev(1), 'not-the-owner-pass', 5, 3), /הסיסמה שגויה/);
  const r = await handlers['owner:recoveryCodes'](ev(1), OPASS, 5, 3);
  assert.equal(r.codes.length, 5);
  assert.equal(r.k, 3);
});

test('ממצא 4: ההרשמות, תיבת הבקשות והמסמך החתום — רק במצב פתוח ובפגישה שפתחה אותו', async () => {
  await boot();
  await handlers['owner:unlock'](ev(1), OPASS);
  assert.deepEqual(await handlers['owner:signups'](ev(1)), []);
  assert.deepEqual(await handlers['owner:inbox'](ev(1)), []);
  // מנהל אחר בחלון אחר — נעול (ownerCheck), ואין נתוני לקוחות
  await assert.rejects(handlers['owner:signups'](ev(2)), /לפתוח את מצב מנהל-העל/);
  await assert.rejects(handlers['owner:inbox'](ev(1)), /לפתוח את מצב מנהל-העל/, 'המצב ננעל');
  await assert.rejects(handlers['owner:signupDocument'](ev(1), 'x'), /לפתוח את מצב מנהל-העל/);
  await handlers['owner:unlock'](ev(2), OPASS);
  await assert.rejects(handlers['owner:signupDocument'](ev(1), 'x'), /לפתוח את מצב מנהל-העל/);
});

test('ממצא 26: בהתקנה — קבצי מנהל-העל מוצפנים במפתח השורש (לא במפתח המסד), וקובץ מגרסת הביניים מומר', async () => {
  await boot();
  // מסד חדש עם הצפנה (כמו main.js עם DPAPI); המסד הקודם נסגר כדי שאפשר יהיה למחוק אותו
  try { ipc.getDb().db.close(); } catch { /* */ }
  const dir = mk('econ-sealed');
  const key = crypto.randomBytes(32).toString('base64');
  await ipc.initEcon(dir, { rootKeys: [], relayUrl: '', fetchImpl: async () => { throw new Error('אין רשת בבדיקות'); },
    dbOptions: { resolveCipher: async () => ({ key: AR.deriveDbKey(key), status: 'encrypted' }) } });
  await handlers['auth:setup'](ev(9), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(9), 'menahel', 'menahel-strong-pass-1');
  await handlers['owner:init'](ev(9), OPASS);
  const ownerDir = path.join(dir, 'owner');
  const file = (n) => fs.readFileSync(path.join(ownerDir, n), 'utf8');
  assert.ok(file('registry.json').startsWith(OC.OWNER_SEAL_PREFIX));
  assert.ok(file('notices.json').startsWith(OC.OWNER_SEAL_PREFIX));
  assert.ok(file('root.key').startsWith('SSBK1:'));
  assert.ok(JSON.parse(file('root.pub.json')).x);
  const st = await state(9);
  assert.equal(st.unlocked, true);
  assert.deepEqual(st.tenants, []);
  // תיבה שהוצפנה במפתח המסד (גרסת הביניים) — מומרת למפתח השורש בפתיחה הבאה
  fs.writeFileSync(path.join(ownerDir, 'inbox.json'), ipc.getDb().cipher.seal(JSON.stringify([{ id: 'm1', from: 'x', at: 1, body: '{}', summary: { kind: 'invalid' } }])));
  await handlers['owner:lock'](ev(9));
  await handlers['owner:unlock'](ev(9), OPASS);
  assert.ok(file('inbox.json').startsWith(OC.OWNER_SEAL_PREFIX));
  assert.equal((await handlers['owner:inbox'](ev(9)))[0].id, 'm1');
  // גיבוי של התיקייה פותח את הנתונים בכל מחשב עם הסיסמה — בלי מפתח המסד
  const copy = mk('econ-owner-copy');
  for (const n of fs.readdirSync(ownerDir)) if (n.endsWith('.json') || n === 'root.key') fs.copyFileSync(path.join(ownerDir, n), path.join(copy, n));
  const elsewhere = OC.createOwnerCore({ storage: OC.dirStorage(fs, path, copy) });
  elsewhere.unlock(OPASS);
  assert.equal(elsewhere.inbox()[0].id, 'm1');
});
