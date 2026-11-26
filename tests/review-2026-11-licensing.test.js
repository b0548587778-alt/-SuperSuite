'use strict';
// רגרסיה לסקירת הקוד מ-11.2026, יחידת הרישוי בצד הלקוח (u01): אמון בהודעות ובאישורים, שעון, עדכון ממוצר אחר,
// חידוש מוקדם ורצפת הניסיון מיומן הביקורת (ממצאים f85, f12, f7, f9, f13, f87, f8)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const LS = require('../shell/licensing/store');
const CK = require('../shell/licensing/checkin');
const UP = require('../shell/licensing/update');
const { createLicenseSync } = require('../shell/licensing/sync');
const { mailboxOf, randomNonce } = require('../shell/licensing/remote');
const { createOwner } = require('../tools/licensing/owner');
const { closeEconDb, removeDirs } = require('./helpers/portable');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; }, aside() { v = null; } }; };
const dirs = [];
const newDir = (p = 'ss-rv11-lic-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
// ב-Windows המסד הפתוח נעול — סוגרים לפני המחיקה (ipc נטען למטה; עד הסוף הוא כבר מאותחל)
test.after(() => { closeEconDb(ipc); removeDirs(dirs); });

const parentLimits = { maxChildren: 3, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const childLimits = { maxChildren: 0, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const FEATURES = ['econ', 'tools', 'shamai'];
const rootLic = (publicKey, issuedAt, { limits = parentLimits, days = 365 } = {}) => L.issueLicense({ privateJwk: root.privateJwk },
  { name: 'תלמוד תורה', publicKey, slot: 1, features: FEATURES, limits, issuedAt, expiresAt: issuedAt + days * DAY, graceDays: 7 });
const licensePkg = (chain, notices = []) => JSON.stringify({ type: LS.PKG_LICENSE, v: 1, chain, notices });
const approvalOf = (parentLic, childPublicKey, { approvedAt, expiresAt }) => L.createApproval(root.privateJwk, {
  id: crypto.randomUUID(), parentId: parentLic.payload.id, childPublicKey, depth: 2, slot: 1, name: 'סניף',
  features: FEATURES, limits: childLimits, expiresAt, graceDays: 7, approvedAt });
const approvalPkg = (approval) => JSON.stringify({ type: LS.PKG_APPROVAL, v: 1, approval });
const childLic = (parent, parentLic, childPublicKey, approval, issuedAt) => L.issueLicense({ privateJwk: parent.privateJwk, license: parentLic }, {
  name: 'סניף', publicKey: childPublicKey, slot: 1, features: FEATURES, limits: childLimits, issuedAt,
  expiresAt: approval.payload.expiresAt, graceDays: 7, approval }, { rootKeys });

// מערכת עם מפתח שנוצר במחסן (request), כמו בפועל
function node({ now = () => T0 + DAY, mono } = {}) {
  const storage = mem();
  const secret = mem();
  const make = () => LS.createLicenseStore({ storage, secret, rootKeys, clock: () => now(), ...(mono ? { mono: () => mono() } : {}) });
  const store = make();
  const req = store.request('תלמוד תורה');
  return { storage, secret, store, make, pub: req.publicKey, id: req.keyId };
}

// ---------- f85: מעבר שקט להורה אחר ----------
test('f85: רישיון ממערכת מנפיקה אחרת לא מותקן בשקט (גם לא מהסנכרון) — רק אחרי אישור מפורש', () => {
  let now = T0 + DAY;
  const t = node({ now: () => now });
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  assert.equal(t.store.current().status, 'active');
  // הורה אחר (P2) מנפיק רישיון חדש יותר לאותה מערכת
  const p2 = L.generateKeyPair();
  const p2Lic = rootLic(p2.publicJwk, T0);
  const appr = approvalOf(p2Lic, t.pub, { approvedAt: T0 + DAY, expiresAt: T0 + 300 * DAY });
  const chain = [p2Lic, childLic(p2, p2Lic, t.pub, appr, T0 + 3 * DAY)];
  now = T0 + 3 * DAY;
  assert.throws(() => t.store.install(licensePkg(chain)), (e) => e.code === LS.PARENT_CHANGE_CODE && /מערכת מנפיקה אחרת/.test(e.message));
  t.store.invalidate();
  assert.equal(t.store.leafPayload().parentId, null, 'הרישיון הקודם נשאר');
  // חידוש מאותו מנפיק — כרגיל
  t.store.install(licensePkg([rootLic(t.pub, T0 + 2 * DAY)]));
  // אישור מפורש (התקנה ידנית) — עובר
  t.store.install(licensePkg(chain), { allowParentChange: true });
  assert.equal(t.store.leafPayload().parentId, p2Lic.payload.id);
});

test('f85: רישיון ממנפיק אחר שהגיע בסנכרון — לא מותקן, לא אובד: נשמר וממתין לאישור, ונמחק מהשרת', async () => {
  let now = T0 + DAY;
  const t = node({ now: () => now });
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il' });
  const p2 = L.generateKeyPair();
  const p2Lic = rootLic(p2.publicJwk, T0);
  const appr = approvalOf(p2Lic, t.pub, { approvedAt: T0 + DAY, expiresAt: T0 + 300 * DAY });
  now = T0 + 3 * DAY;
  const body = licensePkg([p2Lic, childLic(p2, p2Lic, t.pub, appr, T0 + 3 * DAY)]);
  const relay = fakeRelay();
  relay.push('license', body, p2Lic.payload.id);
  const sync = createLicenseSync({ store: t.store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => now });
  const r = await sync.receive();
  assert.ok(r.errors.some(e => /ממתין לאישור במסך הרישוי/.test(e)));
  assert.equal(relay.box.length, 0, 'ההודעה נמחקה מהשרת — אבל נשמרה מקומית');
  t.store.invalidate();
  assert.equal(t.store.leafPayload().parentId, null, 'לא הותקן בשקט');
  const held = t.store.getRemoteSettings().pendingLicense;
  assert.equal(held.body, body);
  assert.equal(held.name, 'סניף');
  assert.equal(held.expiresAt, T0 + 300 * DAY);
  // אישור המנהל — מותקן, והרישיון כבר לא ממתין
  t.store.install(held.body, { allowParentChange: true });
  assert.equal(t.store.leafPayload().parentId, p2Lic.payload.id);
  assert.equal(t.store.getRemoteSettings().pendingLicense, undefined);
});

test('f85: מנהל-העל — אישור מערכת בת שכבר שייכת להורה אחר (או לקוח ישיר) נדחה, ובסקירה מוצגת הבעיה', () => {
  let now = T0;
  const owner = createOwner({ dir: newDir(), passphrase: 'ohr-hachaim-owner-2026', clock: () => now });
  owner.init();
  const keys = [owner.pubkey()];
  const tenant = (name) => {
    const s = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys: keys, clock: () => now });
    const req = s.request(name);
    s.install(owner.issue({ request: req, features: FEATURES, limits: parentLimits, months: 12 }).package);
    return { store: s, req };
  };
  const p1 = tenant('תלמוד תורה א');
  const p2 = tenant('תלמוד תורה ב');
  now = T0 + DAY;
  const child = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys: keys, clock: () => now }).request('סניף');
  const terms = { features: ['econ'], limits: childLimits, months: 12 };
  owner.approve({ request: p1.store.requestChildApproval({ request: child, ...terms }).package });
  // חידוש אצל אותו הורה — כרגיל
  assert.equal(owner.review({ request: p1.store.requestChildApproval({ request: child, ...terms }).package }).problem, null);
  const other = p2.store.requestChildApproval({ request: child, ...terms }).package;
  assert.match(owner.review({ request: other }).problem, /כבר אושרה כמערכת בת של "תלמוד תורה א"/);
  assert.doesNotMatch(owner.review({ request: other }).problem, /יש לבטל את האישור/, 'הביטול מסיים את המערכת — לא מציעים אותו');
  assert.throws(() => owner.approve({ request: other }), /כבר אושרה כמערכת בת/);
  // לקוח ישיר כמערכת בת של לקוח אחר
  const asChild = p2.store.requestChildApproval({ request: p1.req, ...terms }).package;
  assert.match(owner.review({ request: asChild }).problem, /רשומה כלקוח ישיר/);
  assert.throws(() => owner.approve({ request: asChild }), /רשומה כלקוח ישיר/);
});

// ---------- f12: שידור חוזר של אישור ישן ----------
function fakeRelay() {
  const box = [];
  let seq = 0;
  const push = (kind, body, from) => box.push({ id: 'm' + (++seq), kind, body, at: T0, from });
  const fetchImpl = async (url, opts) => {
    const req = JSON.parse(opts.body);
    let data = { ok: true };
    if (req.op === 'fetch') data = { ok: true, messages: req.payload.after ? [] : box.slice() };
    else if (req.op === 'ack') { for (const id of req.payload.ids) { const i = box.findIndex(m => m.id === id); if (i >= 0) box.splice(i, 1); } }
    return { ok: true, headers: { get: () => null }, json: async () => data };
  };
  return { box, push, fetchImpl };
}

test('f12: אישור למערכת בת נקלט רק ממנהל-העל — משולח אחר נמחק בלי הנפקה', async () => {
  const t = node();
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il' });
  let issued = 0;
  // assertCanIssue — תנאי ההפעלה (סקירה 5.11.2026) נבדקים בנפרד; כאן רק השולח
  const store = { ...t.store, assertCanIssue: () => {}, issueChild: () => { issued++; throw new Error('לא בבדיקה הזו'); } };
  const relay = fakeRelay();
  relay.push('approval', '{}', 'x'.repeat(22));
  const sync = createLicenseSync({ store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  await sync.receive();
  assert.equal(issued, 0, 'שולח שאינו מנהל-העל — אין הנפקה');
  assert.equal(relay.box.length, 0, 'ההודעה נמחקה מהשרת');
  relay.push('approval', '{}', mailboxOf(rootKeys[0]));
  await sync.receive();
  assert.equal(issued, 1, 'ממנהל-העל — מטופל');
});

test('f12: הורה לא מנפיק לפי אישור ישן מזה של הרישיון שכבר הונפק לאותה מערכת בת', () => {
  const p = node();
  const pLic = rootLic(p.pub, T0);
  p.store.install(licensePkg([pLic]));
  const childKey = L.generateKeyPair();
  const oldA = approvalOf(pLic, childKey.publicJwk, { approvedAt: T0 + DAY / 2, expiresAt: T0 + 60 * DAY });
  const newA = approvalOf(pLic, childKey.publicJwk, { approvedAt: T0 + DAY - 1000, expiresAt: T0 + 360 * DAY });
  p.store.issueChild({ approval: approvalPkg(newA) });
  assert.throws(() => p.store.issueChild({ approval: approvalPkg(oldA) }), /האישור ישן/);
  assert.equal(p.store.listChildren()[0].expiresAt, T0 + 360 * DAY, 'הרישיון שהונפק לא הוחלף');
  // אותו אישור שוב (מסירה שנכשלה ונוסתה שוב) — מותר
  p.store.issueChild({ approval: approvalPkg(newA) });
});

test('f12: מערכת בת שעוברת לרישיון ישיר מהשורש (בלי אישור) — לא נחסמת כ"אישור ישן", רק באישור מעבר', () => {
  let now = T0 + 3 * DAY;
  const c = node({ now: () => now });
  const parent = L.generateKeyPair();
  const pLic = rootLic(parent.publicJwk, T0);
  const a = approvalOf(pLic, c.pub, { approvedAt: T0 + 2 * DAY, expiresAt: T0 + 360 * DAY });
  c.store.install(licensePkg([pLic, childLic(parent, pLic, c.pub, a, T0 + 2 * DAY)]));
  now = T0 + 4 * DAY;
  const direct = licensePkg([rootLic(c.pub, T0 + 4 * DAY, { limits: childLimits })]);
  assert.throws(() => c.store.install(direct), (e) => e.code === LS.PARENT_CHANGE_CODE);
  c.store.install(direct, { allowParentChange: true });
  assert.equal(c.store.leafPayload().parentId, null);
});

test('f12: מערכת בת לא מתקינה רישיון חדש יותר שנשען על אישור ישן (קיצור התוקף)', () => {
  let now = T0 + 3 * DAY;
  const c = node({ now: () => now });
  const parent = L.generateKeyPair();
  const pLic = rootLic(parent.publicJwk, T0);
  const newA = approvalOf(pLic, c.pub, { approvedAt: T0 + 2 * DAY, expiresAt: T0 + 360 * DAY });
  const oldA = approvalOf(pLic, c.pub, { approvedAt: T0 + DAY, expiresAt: T0 + 60 * DAY });
  c.store.install(licensePkg([pLic, childLic(parent, pLic, c.pub, newA, T0 + 2 * DAY)]));
  now = T0 + 4 * DAY;
  assert.throws(() => c.store.install(licensePkg([pLic, childLic(parent, pLic, c.pub, oldA, T0 + 4 * DAY)])), /אישור ישן/);
  assert.equal(c.store.leafPayload().expiresAt, T0 + 360 * DAY);
});

// ---------- f7: זמן עתידי ----------
test('f7: הודעה שנחתמה בשעון עתידי (שנה שגויה) לא מקדמת את הזמן ולא נועלת', () => {
  const t = node();
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  const future = S.createNotice({ privateJwk: root.privateJwk },
    { type: 'release', target: t.id, holdId: 'no-such-hold', reason: 'החזרה', issuedAt: T0 + 400 * DAY });
  t.store.importNotices(JSON.stringify({ type: LS.PKG_NOTICES, v: 1, notices: [future] }));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
  assert.ok(JSON.parse(t.storage.read()).lastSeen <= T0 + 2 * DAY + 60e3, 'הזמן שנשמר — עד יום אחרי השעון');
});

test('f7: הודעה עתידית לא דוחפת את הזמן קדימה יום אחרי יום בהפעלות חוזרות', () => {
  let now = T0 + DAY;
  let m = 0;
  const t = node({ now: () => now, mono: () => m });
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  const future = S.createNotice({ privateJwk: root.privateJwk },
    { type: 'release', target: t.id, holdId: 'no-such-hold', reason: 'החזרה', issuedAt: T0 + 400 * DAY });
  t.store.importNotices(JSON.stringify({ type: LS.PKG_NOTICES, v: 1, notices: [future] }));
  for (let i = 0; i < 60; i++) {
    now += 10 * 60 * 1000;
    m = 0;
    const s = t.make();
    assert.equal(s.current().status, 'active');
  }
  const ahead = JSON.parse(t.storage.read()).lastSeen - now;
  assert.ok(ahead <= DAY + 60e3, 'אחרי 60 הפעלות — עדיין לכל היותר יום לפני השעון (' + (ahead / DAY).toFixed(2) + ')');
  assert.ok(JSON.parse(t.secret.read()).guard.lastSeen - now <= DAY + 60e3, 'גם בשומר');
});

test('f7: זמן עתידי שכבר נשמר יורד בבדיקה חתומה של השרת שהשעון המקומי מסכים איתה', () => {
  let now = T0 + 400 * DAY; // שעון שקפץ קדימה
  const t = node({ now: () => now, mono: () => 0 });
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  assert.equal(t.store.current().status, 'pending_payment');
  now = T0 + 2 * DAY; // השעון תוקן
  const again = t.make();
  assert.equal(again.current().status, 'pending_payment', 'הזמן שנשמר נשאר — בלי בדיקה חתומה');
  const relay = L.generateKeyPair();
  const origin = CK.originOf('https://relay.test');
  const cert = CK.createRelayCert(root.privateJwk, relay.publicJwk, { origin, issuedAt: T0, months: 24 });
  const att = { checkin: CK.signCheckin(relay.privateJwk, { purpose: 'fetch', origin, box: t.id, challenge: randomNonce(), at: now, items: [] }), cert };
  again.setRemoteSettings({ checkin: att, lastSync: now });
  again.invalidate();
  assert.equal(again.current().status, 'active');
  assert.equal(JSON.parse(t.storage.read()).lastSeen, now);
  assert.equal(JSON.parse(t.secret.read()).guard.lastSeen, now, 'גם בשומר');
});

// ---------- f9: שעון שמוחזר בכל הפעלה ----------
test('f9: שעון שמוחזר לאותו תאריך בכל הפעלה — זמן הריצה מצטבר, והניסיון מסתיים', () => {
  let m = 0;
  const now = () => T0 + m; // השעון מתקדם בזמן הריצה, ומוחזר ל-T0 בכל הפעלה
  const storage = mem();
  const secret = mem();
  const make = () => LS.createLicenseStore({ storage, secret, rootKeys, clock: now, mono: () => m });
  const first = make();
  assert.equal(first.current().trial.daysLeft, 30);
  m = 20 * DAY;
  first.invalidate();
  assert.equal(first.current().trial.daysLeft, 10);
  // הפעלה חדשה: השעון ושעון התהליך מתחילים מחדש
  m = 0;
  const second = make();
  assert.equal(second.current().status, 'active');
  m = 11 * DAY;
  second.invalidate();
  assert.equal(second.current().status, 'trial_ended', '20 + 11 ימי שימוש');
});

test('f9: כל הפעלה שבה השעון מאחור מוסיפה זמן — גם הפעלות קצרות', () => {
  const storage = mem();
  const secret = mem();
  const make = () => LS.createLicenseStore({ storage, secret, rootKeys, clock: () => T0, mono: () => 0 });
  make().current();
  storage.write(JSON.stringify({ ...JSON.parse(storage.read()), lastSeen: T0 + DAY }));
  let prev = T0 + DAY;
  for (let i = 0; i < 3; i++) {
    make().current();
    const seen = JSON.parse(storage.read()).lastSeen;
    assert.ok(seen >= prev + 60e3, `הפעלה ${i + 1}: ${seen - prev}`);
    prev = seen;
  }
});

test('f9: רישיון — תפוגה גם כשהשעון מוחזר בכל הפעלה', () => {
  let m = 0;
  const t = node({ now: () => T0 + DAY + m, mono: () => m });
  t.store.install(licensePkg([rootLic(t.pub, T0)]));
  m = 200 * DAY;
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
  m = 0;
  const next = t.make();
  assert.equal(next.current().status, 'active', 'עלייה: השעון שוב ב-T0');
  m = 200 * DAY;
  next.invalidate();
  assert.equal(next.current().status, 'pending_payment', '400 ימי שימוש > שנה');
});

// ---------- f13: עדכון ממוצר אחר ----------
const BIN = crypto.randomBytes(2048);
const sha = crypto.createHash('sha256').update(BIN).digest('hex');
const rel = (over = {}) => UP.createRelease(root.privateJwk, { version: '3.9.0', fileName: 'SuperSuite-Setup.exe', size: BIN.length, sha256: sha,
  url: 'https://updates.example.org/SuperSuite-Setup.exe', ...over }, { issuedAt: 1000 });
function learnManager(storage = mem()) {
  return UP.createUpdateManager({ storage, rootKeys, currentVersion: '1.0.0', platform: 'win', product: 'supersuite-learn',
    saveFile: async (name) => '/updates/' + name, clock: () => 5 });
}

test('f13: התקנה מקובץ (USB) של מוצר אחר נדחית; מה שכבר נשמר ממוצר אחר לא מותקן ולא חוסם עדכונים', async () => {
  const m = learnManager();
  await assert.rejects(m.fromFile(rel({ product: 'super-suite' }), BIN), /מיועד לתוכנה אחרת/);
  await assert.rejects(m.fromFile(rel(), BIN), /מיועד לתוכנה אחרת/, 'תעודה בלי מוצר — של התוכנה הכלכלית');
  assert.equal((await m.fromFile(rel({ product: 'supersuite-learn', version: '1.0.1' }), BIN)).version, '1.0.1');

  // updates.json מגרסה קודמת, שבו נשמר עדכון של התוכנה הכלכלית
  const storage = mem();
  const other = rel({ product: 'super-suite' });
  storage.write(JSON.stringify({ available: { payload: UP.verifyRelease(other, rootKeys), text: other, at: 1 }, downloaded: { version: '3.9.0', path: '/updates/x.exe', at: 1 } }));
  const m2 = learnManager(storage);
  assert.throws(() => m2.readyToInstall(), /אין עדכון מוכן/);
  assert.equal(m2.status().available, null);
  assert.equal(m2.offer(rel({ product: 'supersuite-learn', version: '1.0.2' })).added, true, 'לא נחסם ב-known');
});

// ---------- f87: חידוש מוקדם ----------
test('f87: חידוש מוקדם של לקוח — התקופה החדשה נוספת לתוקף הנוכחי', () => {
  let now = T0;
  const owner = createOwner({ dir: newDir(), passphrase: 'ohr-hachaim-owner-2026', clock: () => now });
  owner.init();
  const req = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys: [owner.pubkey()], clock: () => now }).request('כולל');
  const exp = (pkg) => JSON.parse(pkg).chain[0].payload.expiresAt;
  const first = exp(owner.issue({ request: req, features: FEATURES, limits: parentLimits, months: 12 }).package);
  const term = first - T0;
  now = first - 30 * DAY;
  assert.equal(exp(owner.issue({ request: req, features: FEATURES, limits: parentLimits, months: 12 }).package), first + term);
  // אחרי שפג — מהיום
  now = first + 2 * term + 10 * DAY;
  assert.equal(exp(owner.issue({ request: req, features: FEATURES, limits: parentLimits, months: 12 }).package), now + term);
});

// ---------- f8 (המשך): כל הסימונים נמחקו — יומן הביקורת נותן רצפה ----------
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_rv11_lic__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_rv11_lic__.js'] = { id: '/__electron_stub_rv11_lic__.js', filename: '/__electron_stub_rv11_lic__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
// אתחול חוזר על אותה תיקייה: המסד הקודם נסגר קודם (כמו closeEconDb ב-main.js) — אחרת ב-Windows הקובץ נשאר נעול
const initEcon = (dir, opts) => { closeEconDb(ipc); return ipc.initEcon(dir, opts); };
const ev = (id) => ({ sender: { id } });
const PASS = 'a-very-long-pass-2026';
const wipeMarks = async (dir) => {
  for (const f of ['license.json', 'license-key.bin', 'install-marks.json']) fs.rmSync(path.join(dir, f), { force: true });
  await ipc.getDb().run('DELETE FROM license_marks');
};

test('f8: תחילת הניסיון נרשמת ביומן; מחיקת כל הסימונים (גם במסד) לא נותנת ניסיון חדש', async () => {
  const dir = newDir();
  let off = 0;
  const opts = () => ({ rootKeys, clock: () => Date.now() + off, relayUrl: '' });
  await initEcon(dir, opts());
  await handlers['auth:setup'](ev(301), 'menahel_rv11', PASS);
  assert.equal((await handlers['license:getStatus'](ev(301))).status, 'active');
  await handlers['license:getStatus'](ev(301)); // התור: הרישום ביומן הסתיים
  assert.ok((await ipc.getDb().listAudit({})).some(a => a.action === 'license.trial.start'), 'נרשם ביומן');

  await wipeMarks(dir);
  off = 40 * DAY;
  await initEcon(dir, opts());
  await handlers['auth:login'](ev(302), 'menahel_rv11', PASS);
  const st = await handlers['license:getStatus'](ev(302));
  assert.equal(st.status, 'trial_ended');
});

test('f8: התקנה שהרישוי לא רץ בה מעולם — ניסיון רגיל של 30 יום', async () => {
  const dir = newDir();
  await initEcon(dir, { rootKeys: [], relayUrl: '' }); // גרסה בלי רישוי
  await handlers['auth:setup'](ev(311), 'menahel_rv11b', PASS);
  assert.equal((await ipc.getDb().listAudit({})).some(a => /^license\./.test(a.action)), false);
  await initEcon(dir, { rootKeys, clock: () => Date.now() + 40 * DAY, relayUrl: '' });
  await handlers['auth:login'](ev(312), 'menahel_rv11b', PASS);
  const st = await handlers['license:getStatus'](ev(312));
  assert.equal(st.status, 'active');
  assert.equal(st.trial.daysLeft, 30);
});
