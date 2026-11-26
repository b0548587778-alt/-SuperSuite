'use strict';
// רגרסיה לסקירת האבטחה של הבדיקה החתומה (24.10.2026):
// 1 — "החיבור האחרון לשרת" מהתשובה החתומה השמורה; זמן לא חתום (שחזור עותק ישן של license-key.bin) — עד תאריך קבוע
// 2 — עדכוני סטטוס למערכות בת רק כשהשתנו; בשרת — הודעת סטטוס מחליפה את הקודמת; 429 אצל נמען אחד לא עוצר את הסנכרון
// 3 — מקום שמור בשרת להודעות של השורש (לא בתקרות, לא פגות, לא נמחקות באישור קבלה) ודוח מסירה למנהל-העל
// 4 — תפוגת התעודה של השרת: אזהרה יומית בשרת, תפוגה בתוצאת הסנכרון ואזהרה במסך הרישוי
// 5 — אישור מסירה חתום בצד השליחה; 6 — המדריך: נעילה מלאה ולא "קריאה בלבד"; 7 — דחייה רק ממנהל-העל
// והקשחה: תעודת שרת רק ל-https שאינו מקומי, חוץ ממצב בדיקה מפורש
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const L = require('../shell/licensing/license');
const CK = require('../shell/licensing/checkin');
const ACT = require('../shell/licensing/activation');
const OC = require('../shell/licensing/owner-core');
const LS = require('../shell/licensing/store');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createRemote, randomNonce } = require('../shell/licensing/remote');
const R = require('../server/license-relay');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-r2-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let seq = 0;
const mk = (name) => { const d = path.join(tmp, name + '-' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };

const PASS = 'menahel-al-r2-2026';
const DAY = 24 * 60 * 60 * 1000;
const RELAY_URL = 'https://relay.test';
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const TENANT_LIMITS = (maxChildren = 0) => ({ maxUsers: 5, maxChildren, maxStorageMb: 100, maxDepth: 2 });
const CHILD_LIMITS = { maxUsers: 1, maxChildren: 0, maxStorageMb: 10, maxDepth: 2 };

// fetch מדומה שמעביר את הבקשה ישר לשרת. tamper — שינוי התשובה בדרך
const relayFetch = (relay, tamper = (r) => r) => async (url, init) => {
  const body = JSON.parse(init.body);
  try {
    const r = tamper(await relay.handle(body, '127.0.0.1'), body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  } catch (e) {
    return { ok: false, status: e.status || 400, headers: { get: () => null }, json: async () => ({ ok: false, error: e.message }) };
  }
};
// שרת ביניים בין השולח לשרת: "שליחה" לא מגיעה לשרת, והתשובה {ok:true}
const dropSends = (relay) => async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.op === 'send') return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, sent: body.payload.items.length }) };
  return relayFetch(relay)(url, init);
};
const signedReq = (kp, op, payload) => {
  const pub = kp.publicJwk, ts = Date.now(), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
const boxOf = (relay, kp) => relay.handle(signedReq(kp, 'fetch', {})).messages;
const kpOf = (store) => { const k = store.syncKey(false); return { privateJwk: k, publicJwk: L.publicOf(k), keyId: L.keyId(k) }; };

// "עולם" לבדיקה: מנהל-העל, שרת עם מפתח ותעודה לכתובת https, ומערכות שמתחברות אליו
function world({ clock } = {}) {
  const owner = OC.createOwnerCore({ storage: mem(), ...(clock ? { clock } : {}) });
  const rootKeys = [owner.init(PASS).publicKey];
  const dir = mk('relay');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  const g = R.generateRelayKey(keyFile);
  fs.writeFileSync(certFile, owner.relayCert(fs.readFileSync(g.pubFile, 'utf8'), { origin: RELAY_URL }).text);
  const identity = R.loadRelayIdentity({ keyFile, certFile, rootKeys });
  const relay = R.createRelay({ dataDir: dir, identity, ...(clock ? { clock } : {}) });
  const W = { owner, rootKeys, dir, identity, relay, clock };
  // מערכת ברישיון ממנהל-העל
  W.tenant = ({ name = 'ישיבת אור תורה', maxChildren = 0, tamper, fetchImpl } = {}) => {
    const storage = one();
    const secret = one();
    const store = LS.createLicenseStore({ storage, secret, rootKeys, clock });
    store.syncKey(true);
    store.setRemoteSettings({ url: RELAY_URL });
    const lic = owner.issue({ request: store.request(name), features: ['econ'], limits: TENANT_LIMITS(maxChildren) });
    store.install(lic.package);
    const sync = createLicenseSync({ store, owner: null, rootKeys, fetchImpl: fetchImpl || relayFetch(relay, tamper), clock });
    return { store, sync, storage, secret, id: lic.id, name, kp: kpOf(store) };
  };
  // ההתקנה של מנהל-העל (שליחת עדכוני סטטוס)
  W.ownerSync = (fetchImpl = relayFetch(relay)) => {
    const store = LS.createLicenseStore({ storage: one(), secret: one(), rootKeys, clock });
    store.setRemoteSettings({ url: RELAY_URL });
    return createLicenseSync({ store, owner, rootKeys, fetchImpl, clock });
  };
  // מערכת בת: בקשה ← בקשת אישור מההורה ← אישור של מנהל-העל שנשלח להורה דרך השרת (ההורה מנפיק בסנכרון)
  W.addChild = async (P, name) => {
    const store = LS.createLicenseStore({ storage: one(), secret: one(), rootKeys, clock });
    store.setRemoteSettings({ url: RELAY_URL });
    const ask = P.store.requestChildApproval({ request: JSON.stringify(store.request(name)), name, features: ['econ'], limits: CHILD_LIMITS, months: 12 });
    const ap = owner.approve({ request: ask.package });
    await createRemote({ url: RELAY_URL, fetchImpl: relayFetch(relay), clock }).send(owner.rootSigner(), [{ to: P.id, kind: 'approval', body: ap.package }]);
    const sync = createLicenseSync({ store, owner: null, rootKeys, fetchImpl: relayFetch(relay), clock });
    return { store, sync, id: ask.childId, name, kp: kpOf(store) };
  };
  return W;
}

// ---------- ממצא 1: זמן הסנכרון ----------

test('ממצא 1: עותק ישן של license-key.bin (שומר בלי syncV) + עריכת license.json — הזמן לא עובר את LEGACY_SYNC_CUTOFF, והמערכת נעולה', () => {
  const root = L.generateKeyPair();
  const node = L.generateKeyPair();
  const now = LS.LEGACY_SYNC_CUTOFF + 40 * DAY;
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, { name: 'קהילת אור', publicKey: node.publicJwk, slot: 1, features: ['econ'],
    limits: TENANT_LIMITS(), issuedAt: now - 10 * DAY, expiresAt: now + 355 * DAY, graceDays: 7 });
  const storage = one();
  storage.write(JSON.stringify({ chain: [lic], notices: [], children: [], remote: { lastSync: now } }));
  const secret = one();
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } })); // העותק הישן
  const store = LS.createLicenseStore({ storage, secret, rootKeys: [root.publicJwk], clock: () => now });
  const t = store.lastSyncTime();
  assert.equal(t, LS.LEGACY_SYNC_CUTOFF, 'הזמן מהקובץ הגלוי — עד התאריך הקבוע בלבד');
  assert.equal(ACT.evaluate({ state: store.current(), leaf: store.leafPayload(), lastSync: t, now }).ok, false, 'אין חיבור חתום ב-30 הימים האחרונים');
  // שומר שנכתב עם זמן חדש (מספר לא חתום) — גם הוא עד התאריך הקבוע
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [], lastSync: now, syncV: 1 } }));
  assert.equal(store.lastSyncTime(), LS.LEGACY_SYNC_CUTOFF);
  // בלי רישוי (אין מפתח שורש) — כמו קודם
  assert.equal(LS.createLicenseStore({ storage: one(), secret, rootKeys: [], clock: () => now }).lastSyncTime(), now);
});

test('ממצא 1: "החיבור האחרון" — מהתשובה החתומה שנשמרה; עותק ישן מחזיר רק את הזמן הישן; שינוי, מערכת אחרת ושעון שהוחזר — לא נחשבים', async () => {
  let now = LS.LEGACY_SYNC_CUTOFF + 10 * DAY; // אחרי התאריך הקבוע — כדי שהבדיקה לא תלויה בשעון האמיתי
  const clock = () => now;
  const W = world({ clock });
  const T = W.tenant();
  assert.equal((await T.sync.receive()).checkin.ok, true);
  const saved = JSON.parse(T.storage.read()).remote.checkin;
  assert.ok(saved && saved.checkin && typeof saved.cert === 'string', 'התשובה החתומה נשמרה בקובץ הרישוי');
  const at1 = saved.checkin.payload.at;
  assert.equal(T.store.lastSyncTime(), at1);
  const oldFile = T.storage.read();
  now += 2 * DAY;
  await T.sync.receive();
  assert.equal(T.store.lastSyncTime(), now);
  const fresh = T.storage.read();
  // שחזור עותק ישן של license.json — רק הזמן הישן שבו
  T.storage.write(oldFile);
  assert.equal(T.store.lastSyncTime(), at1);
  // תשובה ישנה לא דורסת חדשה
  T.storage.write(fresh);
  T.store.setRemoteSettings({ checkin: saved });
  assert.equal(T.store.lastSyncTime(), now);
  // עריכת הזמן בתשובה השמורה — החתימה נפסלת; נשאר רק הזמן הלא-חתום, עד התאריך הקבוע
  const d = JSON.parse(T.storage.read());
  d.remote.checkin.checkin.payload.at = now + 20 * DAY;
  T.storage.write(JSON.stringify(d));
  assert.equal(T.store.lastSyncTime(), Math.min(now, LS.LEGACY_SYNC_CUTOFF));
  T.storage.write(fresh);
  // תשובה חתומה של מערכת אחרת — לא נחשבת ולא נשמרת
  const U = W.tenant({ name: 'כולל חזון איש' });
  const ud = JSON.parse(U.storage.read());
  ud.remote.checkin = saved;
  U.storage.write(JSON.stringify(ud));
  assert.equal(U.store.lastSyncTime(), 0);
  delete ud.remote.checkin;
  U.storage.write(JSON.stringify(ud));
  U.store.setRemoteSettings({ checkin: saved });
  assert.equal(JSON.parse(U.storage.read()).remote.checkin, undefined);
  // שעון שהוחזר אחורה: חתימה "מהעתיד" לא נחשבת עד שהזמן מגיע אליה
  const later = now;
  now -= DAY;
  assert.equal(T.store.lastSyncTime(), Math.min(later, LS.LEGACY_SYNC_CUTOFF));
  now = later;
  assert.equal(T.store.lastSyncTime(), later);
});

test('ממצא 1: תשובה חתומה שמורה — נחשבת גם אחרי שתעודת השרת פגה, אבל רק אם נחתמה בתוקף התעודה ולסנכרון (fetch)', () => {
  const root = L.generateKeyPair();
  const relay = L.generateKeyPair();
  const issuedAt = Date.UTC(2026, 0, 1);
  const certText = CK.createRelayCert(root.privateJwk, relay.publicJwk, { origin: RELAY_URL, issuedAt, months: 1 });
  const cert = CK.verifyRelayCert(certText, [root.publicJwk], issuedAt);
  const box = L.generateKeyPair().keyId;
  const att = (at, purpose = 'fetch', b = box) => ({ checkin: CK.signCheckin(relay.privateJwk, { purpose, origin: RELAY_URL, box: b, challenge: randomNonce(), at, items: [] }), cert: certText });
  const opts = { rootKeys: [root.publicJwk], box, now: cert.expiresAt + 100 * DAY };
  assert.equal(CK.storedCheckinTime(att(issuedAt + DAY), opts).at, issuedAt + DAY, 'נחתמה בתוקף — נחשבת גם אחרי התפוגה');
  assert.equal(CK.storedCheckinTime(att(cert.expiresAt + DAY), opts), null, 'נחתמה אחרי שהתעודה פגה');
  assert.equal(CK.storedCheckinTime(att(issuedAt + DAY, 'hello'), opts), null, 'הוכחת hello אינה סנכרון');
  assert.equal(CK.storedCheckinTime(att(issuedAt + DAY, 'fetch', L.generateKeyPair().keyId), opts), null, 'תיבה של מערכת אחרת');
  assert.equal(CK.storedCheckinTime(att(issuedAt + 2 * DAY), { ...opts, now: issuedAt + DAY }), null, 'מהעתיד');
  assert.equal(CK.storedCheckinTime(att(issuedAt + DAY), { ...opts, rootKeys: [L.generateKeyPair().publicJwk] }), null, 'מפתח שורש אחר');
});

// ---------- ממצא 2: עדכוני סטטוס למערכות הבת ----------

test('ממצא 2: הורה שולח עדכון סטטוס למערכת בת רק כשהשתנה; מערכת שהסתיימה מקבלת את הסיום פעם אחת', async () => {
  let now = Date.now();
  const clock = () => now;
  const W = world({ clock });
  let noticeSends = 0;
  const P = W.tenant({ name: 'רשת חדרים', maxChildren: 3, tamper: (r, body) => {
    if (body.op === 'send') noticeSends += body.payload.items.filter(it => it.kind === 'notices').length;
    return r;
  } });
  const A = await W.addChild(P, 'סניף א');
  const B = await W.addChild(P, 'סניף ב');
  await P.sync.receive();
  assert.equal(P.store.listChildren().length, 2);
  assert.equal(noticeSends, 2, 'פעם אחת לכל מערכת בת');
  for (let i = 0; i < 4; i++) await P.sync.receive();
  assert.equal(noticeSends, 2, 'בלי שינוי — לא נשלח שוב (פעם: בכל סנכרון)');
  await A.sync.receive();
  await B.sync.receive();
  assert.equal(B.store.current().status, 'active');
  // סיום של סניף ב — נשלח פעם אחת, ורק אליו
  P.store.noticeForChild({ type: 'terminate', childId: B.id, reason: 'הסניף נסגר' });
  await P.sync.receive();
  assert.equal(noticeSends, 3);
  for (let i = 0; i < 3; i++) await P.sync.receive();
  assert.equal(noticeSends, 3);
  await B.sync.receive();
  assert.equal(B.store.current().status, 'terminated');
  // חודש אחר כך: למערכת פעילה — רענון (כדי שלא תפוג בשרת); למערכת שהסתיימה — לא
  now += 31 * DAY;
  await P.sync.receive();
  assert.equal(noticeSends, 4);
  assert.equal(W.relay.handle(signedReqAt(A.kp, 'fetch', {}, now)).messages.filter(m => m.from === P.id && m.kind === 'notices').length, 1);
  assert.equal(W.relay.handle(signedReqAt(B.kp, 'fetch', {}, now)).messages.filter(m => m.from === P.id).length, 0, 'הסיום לא נשלח שוב');
});

test('ממצא 2 (שרת): הודעת סטטוס שטרם נקראה מאותו שולח לאותה תיבה — מוחלפת ולא מצטברת', () => {
  const relay = R.createRelay({ dataDir: mk('relay-replace') });
  const a = L.generateKeyPair(), b = L.generateKeyPair(), c = L.generateKeyPair();
  for (const body of ['v1', 'v2', 'v3']) relay.handle(signedReq(a, 'send', { items: [{ to: b.keyId, kind: 'notices', body }] }));
  relay.handle(signedReq(a, 'send', { items: [{ to: b.keyId, kind: 'message', body: 'הודעה' }] }));
  relay.handle(signedReq(c, 'send', { items: [{ to: b.keyId, kind: 'notices', body: 'c1' }] }));
  const box = boxOf(relay, b);
  assert.deepEqual(box.filter(m => m.from === a.keyId).map(m => [m.kind, m.body]), [['notices', 'v3'], ['message', 'הודעה']]);
  assert.deepEqual(box.filter(m => m.from === c.keyId).map(m => m.body), ['c1'], 'שולח אחר — לא מושפע');
  // 100 הודעות סטטוס ברצף לא מגיעות לתקרת השולח (MAX_FROM_SENDER_IN_BOX). שרת עם שעון שמתקדם — המכסה לדקה
  // היא לפי המפתח המאומת (סקירה 2.11.2026, f16)
  let t = Date.now();
  const slow = R.createRelay({ dataDir: mk('relay-replace-slow'), clock: () => t });
  for (let i = 0; i < R.MAX_FROM_SENDER_IN_BOX + 5; i++) { t = Date.now() + i * 2000 - 120000; slow.handle(signedReq(a, 'send', { items: [{ to: b.keyId, kind: 'notices', body: 'n' + i }] }), '10.4.' + Math.floor(i / 15) + '.1'); }
  assert.equal(boxOf(slow, b).filter(m => m.from === a.keyId && m.kind === 'notices').length, 1);
});

test('ממצא 2: 429 אצל מערכת בת אחת לא עוצר את האישור לשרת — הרישיון של מערכת בת חדשה באותו סנכרון נמסר, והעדכון ינוסה שוב', async () => {
  const W = world();
  const P = W.tenant({ name: 'רשת סניפים', maxChildren: 3 });
  const A = await W.addChild(P, 'סניף א');
  await P.sync.receive();
  await A.sync.receive();
  assert.equal(A.store.current().status, 'active');
  // התיבה של סניף א מלאה ב-100 הודעות שטרם נקראו מההורה (סניף א כתב להורה — אין מכסה לכתובת)
  W.relay.handle(signedReq(A.kp, 'send', { items: [{ to: P.id, kind: 'message', body: 'שלום' }] }));
  for (let i = 0; i < 2; i++) W.relay.handle(signedReq(P.kp, 'send', { items: Array.from({ length: 50 }, () => ({ to: A.id, kind: 'message', body: 'x' })) }));
  P.store.noticeForChild({ type: 'hold', childId: A.id, kind: 'suspended', reason: 'בירור חשבון' });
  const B = await W.addChild(P, 'סניף ב');
  const r = await P.sync.receive();
  assert.ok(r.errors.some(e => /סניף א/.test(e) && /שטרם נקראו/.test(e)), r.errors.join(' | '));
  assert.equal(boxOf(W.relay, P.kp).filter(m => m.kind === 'approval').length, 0, 'האישור טופל ונמחק בשרת — לא יונפק שוב');
  await B.sync.receive();
  assert.equal(B.store.current().status, 'active', 'הרישיון של מערכת הבת החדשה נמסר');
  // סניף א קורא את התיבה — העדכון שלא נמסר נשלח בסנכרון הבא
  await A.sync.receive();
  await P.sync.receive();
  await A.sync.receive();
  assert.equal(A.store.current().status, 'suspended');
});

// ---------- ממצא 3: מקום שמור להודעות של השורש ----------

test('ממצא 3: מערכת שמילאה את התיבה של עצמה (500) — מנהל-העל עדיין מוסר השבתה, עם אישור מסירה חתום', async () => {
  const W = world();
  const T = W.tenant();
  const senders = Array.from({ length: 5 }, () => L.generateKeyPair().keyId);
  fs.writeFileSync(path.join(W.dir, T.id + '.json'), JSON.stringify(Array.from({ length: R.MAX_MAILBOX }, (_, i) =>
    ({ id: 'f' + i, from: senders[i % 5], kind: 'message', body: 'x', at: Date.now() }))));
  W.owner.notice({ type: 'hold', target: T.id, kind: 'suspended', reason: 'חוב פתוח' });
  const r = await W.ownerSync().ownerPushNotices();
  assert.deepEqual(r, { sent: 1, total: 1, failed: [] });
  const box = boxOf(W.relay, T.kp);
  assert.equal(box[0].kind, 'notices', 'בראש התיבה — בחלק הראשון של כל משיכה');
  const s = await T.sync.receive();
  assert.equal(s.checkin.ok, true);
  assert.equal(T.store.current().status, 'suspended');
});

test('ממצא 3: הודעת השורש לא פגה אחרי 60 יום, ולא נמחקת באישור קבלה של מי שמחזיק את מפתח המערכת', async () => {
  let now = Date.now();
  const clock = () => now;
  const W = world({ clock });
  const T = W.tenant();
  W.owner.notice({ type: 'hold', target: T.id, kind: 'suspended', reason: 'חוב פתוח' });
  assert.equal((await W.ownerSync().ownerPushNotices()).sent, 1);
  W.relay.handle({ ...signedReqAt(L.generateKeyPair(), 'send', { items: [{ to: T.id, kind: 'message', body: 'רגילה' }] }, now) });
  // מי שמחזיק את מפתח המערכת מאשר "קבלה" לפני שהתוכנה סנכרנה
  const box = W.relay.handle(signedReqAt(T.kp, 'fetch', {}, now)).messages;
  const root = box.find(m => m.kind === 'notices');
  assert.equal(W.relay.handle(signedReqAt(T.kp, 'ack', { ids: [root.id], items: [[root.id, CK.messageDigest(root)]] }, now)).removed, 0);
  assert.equal(W.relay.handle(signedReqAt(T.kp, 'ack', { ids: [root.id] }, now)).removed, 0, 'גם לפי מזהה בלבד');
  // 61 יום בלי חיבור: ההודעה הרגילה פגה, ההשבתה נשארת
  now += 61 * DAY;
  W.relay.expireMessages();
  assert.deepEqual(W.relay.handle(signedReqAt(T.kp, 'fetch', {}, now)).messages.map(m => m.kind), ['notices']);
  await T.sync.receive();
  assert.equal(T.store.current().status, 'suspended');
});
function signedReqAt(kp, op, payload, ts) {
  const pub = kp.publicJwk, nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
}

test('ממצא 3: הודעה חדשה של השורש מחליפה את הקודמת (אחת לתיבה); כישלון אצל נמען אחד — בדוח, והאחרים מקבלים', async () => {
  const W = world();
  const A = W.tenant({ name: 'ישיבת שערי תורה' });
  const B = W.tenant({ name: 'תלמוד תורה בית יוסף' });
  const owner = W.ownerSync();
  const hold = W.owner.notice({ type: 'hold', target: A.id, kind: 'suspended', reason: 'חוב פתוח' });
  await owner.ownerPushNotices();
  W.owner.notice({ type: 'release', target: A.id, holdId: hold.id, reason: 'שולם' });
  await owner.ownerPushNotices();
  const roots = boxOf(W.relay, A.kp).filter(m => m.kind === 'notices');
  assert.equal(roots.length, 1, 'אחת לתיבה');
  assert.match(roots[0].body, /שולם/, 'האחרונה');
  // התיבה של ב לא נקראת (תקלת דיסק) — ב בדוח, א מקבל
  fs.rmSync(path.join(W.dir, B.id + '.json'), { force: true });
  fs.mkdirSync(path.join(W.dir, B.id + '.json'));
  W.owner.notice({ type: 'hold', target: A.id, kind: 'suspended', reason: 'בירור' });
  const r = await owner.ownerPushNotices();
  assert.equal(r.sent, 1);
  assert.deepEqual(r.failed.map(f => [f.to, f.name]), [[B.id, 'תלמוד תורה בית יוסף']]);
  assert.match(r.failed[0].error, /[֐-׿]/);
  await A.sync.receive();
  assert.equal(A.store.current().status, 'suspended');
});

// ---------- ממצא 4: תפוגת תעודת השרת ----------

test('ממצא 4: השרת מזהיר מ-30 יום לפני התפוגה (בדיקה יומית); הסנכרון מחזיר את התפוגה; מסך הרישוי מזהיר מ-60 יום', async () => {
  const now = Date.UTC(2026, 9, 24, 12);
  assert.equal(R.certWarning({ expiresAt: now + 45 * DAY }, now), null);
  assert.match(R.certWarning({ expiresAt: now + 20 * DAY }, now), /תפוג בעוד 20 ימים/);
  assert.match(R.certWarning({ expiresAt: now - DAY }, now), /פג/);
  assert.equal(R.certWarning(null, now), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'license-relay.js'), 'utf8');
  assert.match(src, /setInterval\(warnCert, 24 \* 60 \* 60 \* 1000\)/, 'בדיקה יומית, לא רק בעלייה');

  const W = world();
  const T = W.tenant();
  const r = await T.sync.receive();
  assert.equal(r.checkin.certExpiresAt, W.identity.expiresAt);
  assert.equal(T.store.syncProof().certExpiresAt, W.identity.expiresAt);
  assert.equal(T.store.getRemoteSettings().certExpiresAt, W.identity.expiresAt);

  // מסך הרישוי (modules/econ/ui/licensing.js)
  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const warn = (d) => vm.runInContext(`licCertWarning(${JSON.stringify(d)}, ${now})`, context);
  const admin = warn({ isAdmin: true, remote: { certExpiresAt: now + 30 * DAY } });
  assert.match(admin, /ss-card-warning/);
  assert.match(admin, /תפוג בעוד 30 ימים/);
  assert.match(admin, /פנו לספק/);
  assert.match(warn({ isAdmin: true, owner: { unlocked: true }, remote: { certExpiresAt: now + 10 * DAY } }), /relay-cert/);
  assert.match(warn({ isAdmin: true, remote: { certExpiresAt: now - DAY } }), /פגה/);
  assert.equal(warn({ isAdmin: true, remote: { certExpiresAt: now + 90 * DAY } }), '');
  assert.equal(warn({ isAdmin: false, remote: { certExpiresAt: now + 10 * DAY } }), '', 'רק למנהל');
  assert.equal(warn({ isAdmin: true, remote: {} }), '');
});

// ---------- ממצא 5: אישור מסירה חתום ----------

test('ממצא 5: שרת ביניים שמפיל עדכון סטטוס ועונה "נשלח" — מנהל-העל רואה כישלון בדוח, והורה — שגיאה', async () => {
  const W = world();
  const T = W.tenant();
  W.owner.notice({ type: 'hold', target: T.id, kind: 'suspended', reason: 'חוב פתוח' });
  const r = await W.ownerSync(dropSends(W.relay)).ownerPushNotices();
  assert.equal(r.sent, 0);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /לא אישר בחתימה/);
  assert.equal(boxOf(W.relay, T.kp).length, 0, 'באמת לא הגיע');
  // בלי שרת הביניים — נמסר ומאושר
  assert.deepEqual(await W.ownerSync().ownerPushNotices(), { sent: 1, total: 1, failed: [] });
  // הורה ← מערכת בת
  const child = L.generateKeyPair().keyId;
  const mitm = createLicenseSync({ store: T.store, owner: null, rootKeys: W.rootKeys, fetchImpl: dropSends(W.relay) });
  await assert.rejects(mitm.pushToChild(child, '{"type":"supersuite-license-notices"}'), /לא אישר בחתימה/);
  await T.sync.pushToChild(child, '{"type":"supersuite-license-notices"}');
});

test('ממצא 5: אישור המסירה — חתום על האתגר, הנמען והתוכן; שידור חוזר, תוכן אחר או אישור ששונה — נדחים', () => {
  const W = world();
  const kp = L.generateKeyPair();
  const to = L.generateKeyPair().keyId;
  const items = [{ to, kind: 'notices', body: 'חבילה' }];
  const challenge = randomNonce();
  const r = W.relay.handle(signedReq(kp, 'send', { items, receipt: challenge }));
  const opts = { rootKeys: W.rootKeys, box: kp.keyId, challenge, origin: RELAY_URL, sent: items };
  assert.deepEqual(CK.verifySendReceipt(r, opts), [true]);
  assert.throws(() => CK.verifySendReceipt(r, { ...opts, challenge: randomNonce() }), /אינו שייך/, 'שידור חוזר לבקשה אחרת');
  assert.throws(() => CK.verifySendReceipt(r, { ...opts, box: L.generateKeyPair().keyId }), /אינו שייך/);
  assert.deepEqual(CK.verifySendReceipt(r, { ...opts, sent: [{ to, kind: 'notices', body: 'אחר' }] }), [false], 'תוכן אחר');
  assert.deepEqual(CK.verifySendReceipt(r, { ...opts, sent: [{ to: kp.keyId, kind: 'notices', body: 'חבילה' }] }), [false], 'נמען אחר');
  const bad = JSON.parse(JSON.stringify(r));
  bad.receipt.payload.items[0][2] = 'A'.repeat(43);
  assert.throws(() => CK.verifySendReceipt(bad, opts), /אינה תקינה/);
  assert.throws(() => CK.verifySendReceipt({ ok: true, sent: 1 }, opts), /לא אישר בחתימה/);
  assert.throws(() => CK.verifySendReceipt(r, { ...opts, origin: 'https://other.test' }), /אינו מאושר/);
  // שרת ישן (בלי מפתח ותעודה) — אין אישור: עם מפתח שורש זה מוצג כ"לא אושר", וההודעה עצמה נשמרת (סדר הפריסה במדריך)
  const old = R.createRelay({ dataDir: mk('relay-old') });
  const o = old.handle(signedReq(kp, 'send', { items, receipt: challenge }));
  assert.equal(o.receipt, undefined);
  assert.equal(boxOf(old, { publicJwk: kp.publicJwk, privateJwk: kp.privateJwk }).length, 0);
});

// ---------- ממצא 6: המדריך ----------

test('ממצא 6: המדריך — בלי חיבור חתום המערכת ננעלת לגמרי (לא "קריאה בלבד")', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'LICENSING-ACTIVATION.md'), 'utf8');
  assert.doesNotMatch(doc, /קריאה בלבד אחרי 30 יום/);
  assert.doesNotMatch(doc, /ייכנסו לקריאה בלבד/);
  assert.match(doc, /ננעלות לגמרי/);
  assert.match(doc, /אישור המסירה אומר שההודעה נשמרה בשרת, לא שהמערכת כבר קיבלה אותה/);
});

// ---------- ממצא 7: דחייה ----------

test('ממצא 7: "דחייה" ממשולח שאינו מנהל-העל — נמחקת בלי להציג את הטקסט; ממנהל-העל — מוצגת', async () => {
  const W = world();
  const P = W.tenant({ maxChildren: 2 });
  const eve = L.generateKeyPair();
  W.relay.handle(signedReq(eve, 'send', { items: [{ to: P.id, kind: 'rejection', body: JSON.stringify({ name: 'סניף', reason: 'התקשרו מיד למספר 03-0000000' }) }] }));
  const r1 = await P.sync.receive();
  assert.ok(!r1.errors.some(e => /03-0000000|נדחתה/.test(e)), r1.errors.join(' | '));
  assert.equal(boxOf(W.relay, P.kp).filter(m => m.kind === 'rejection').length, 0, 'נמחקה');
  await createRemote({ url: RELAY_URL, fetchImpl: relayFetch(W.relay) }).send(W.owner.rootSigner(),
    [{ to: P.id, kind: 'rejection', body: JSON.stringify({ name: 'סניף רכסים', reason: 'אין צורך כרגע' }) }]);
  const r2 = await P.sync.receive();
  assert.ok(r2.errors.some(e => /סניף רכסים" נדחתה: אין צורך כרגע/.test(e)));
});

// ---------- הקשחה: תעודת שרת רק ל-https שאינו מקומי ----------

test('הקשחה: תעודת שרת ל-http או לכתובת מקומית — נדחית ביצירה, בשרת ובתוכנה; רק במצב בדיקה מפורש מתקבלת', async () => {
  const W = world();
  const relayKp = L.generateKeyPair();
  for (const origin of ['http://127.0.0.1:8443', 'http://localhost:8443']) assert.throws(() => W.owner.relayCert(relayKp.publicJwk, { origin }), /https/);
  for (const origin of ['https://localhost:8443', 'https://127.0.0.1', 'https://app.localhost', 'https://[::1]:8443']) {
    assert.throws(() => W.owner.relayCert(relayKp.publicJwk, { origin }), /מקומית/, origin);
  }
  const local = W.owner.relayCert(relayKp.publicJwk, { origin: 'http://127.0.0.1:8443', allowLocal: true });
  assert.throws(() => CK.verifyRelayCert(local.text, W.rootKeys), /https/);
  assert.equal(CK.verifyRelayCert(local.text, W.rootKeys, Date.now(), { allowLocal: true }).origin, 'http://127.0.0.1:8443');
  // השרת מסרב לעלות עם תעודה כזו (כשמפתח השורש ידוע)
  const dir = mk('relay-local');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  const g = R.generateRelayKey(keyFile);
  const text = W.owner.relayCert(fs.readFileSync(g.pubFile, 'utf8'), { origin: 'http://127.0.0.1:8443', allowLocal: true }).text;
  fs.writeFileSync(certFile, text);
  assert.throws(() => R.loadRelayIdentity({ keyFile, certFile, rootKeys: W.rootKeys }), /https/);
  // התוכנה (בלי מצב בדיקה) — אין "חיבור" מול שרת מקומי עם תעודה כזו
  const identity = R.loadRelayIdentity({ keyFile, certFile, rootKeys: null });
  const relay = R.createRelay({ dataDir: dir, identity });
  const store = LS.createLicenseStore({ storage: one(), secret: one(), rootKeys: W.rootKeys });
  store.syncKey(true);
  store.setRemoteSettings({ url: 'http://127.0.0.1:8443' });
  const lic = W.owner.issue({ request: store.request('ישיבת אור'), features: ['econ'], limits: TENANT_LIMITS() });
  store.install(lic.package);
  const r = await createLicenseSync({ store, owner: null, rootKeys: W.rootKeys, fetchImpl: relayFetch(relay) }).receive();
  assert.equal(r.checkin.ok, false);
  assert.match(r.checkin.error, /https/);
  assert.equal(store.lastSyncTime(), 0);
  // במצב בדיקה מפורש — מתקבלת
  const ok = await createLicenseSync({ store, owner: null, rootKeys: W.rootKeys, fetchImpl: relayFetch(relay), allowLocalRelay: true }).receive();
  assert.equal(ok.checkin.ok, true);
  assert.ok(store.lastSyncTime() > 0);
});
