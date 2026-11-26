'use strict';
// רגרסיה לבדיקת הקוד (23.10.2026) — מחסן הרישוי: הודעות סטטוס לא חתומות (ממצא 5), זמן הסנכרון מהקובץ הגלוי (28),
// איפוס הניסיון במחיקת שני קבצים (29), הצפת בקשות רישיון (30), קובץ רישוי שלא נקרא (35), בקשה ממערכת בת
// שנמחקה אחרי ההמתנה לרשת, וקבלת הודעות (chat:refresh) בהרשאת צפייה שהריצה את כל סנכרון הרישוי
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const LS = require('../shell/licensing/store');
const { createLicenseSync } = require('../shell/licensing/sync');
const { markActivated, allowIssuing } = require('./helpers/activation');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-lic-'));
// מסד שנפתח דרך ipc נשאר פתוח עד סוף התהליך (Windows לא מוחק אותו) — את השארית מנקה tools/run-tests.js
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ראו למעלה */ } });
const newDir = () => fs.mkdtempSync(path.join(tmp, 'd-'));

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const limits = { maxChildren: 3, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const childTerms = { features: ['econ'], limits: { maxChildren: 0, maxUsers: 1, maxStorageMb: 10, maxDepth: 2 } };

function issueFor(node, issuedAt = T0) {
  return L.issueLicense({ privateJwk: root.privateJwk }, { name: 'קהילת אור', publicKey: node.publicJwk, slot: 1, features: ['econ', 'tools'],
    limits, issuedAt, expiresAt: issuedAt + 365 * DAY, graceDays: 7 });
}
const licensePkg = (lic) => JSON.stringify({ type: LS.PKG_LICENSE, v: 1, chain: [lic], notices: [] });
const noticesPkg = (notices) => JSON.stringify({ type: LS.PKG_NOTICES, v: 1, notices });
const v2Secret = (node) => { const s = mem(); s.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } })); return s; };
const guardOf = (secret) => JSON.parse(secret.read()).guard;

// מערכת ברישיון שנתי (רישיון לקוח ישירות מהשורש)
function licensed({ clock = () => T0 + DAY, storage = mem() } = {}) {
  const node = L.generateKeyPair();
  const lic = issueFor(node);
  const secret = v2Secret(node);
  storage.write(JSON.stringify({ chain: [lic], notices: [], children: [] }));
  const store = allowIssuing(LS.createLicenseStore({ storage, secret, rootKeys, clock }));
  return { node, lic, id: lic.payload.id, storage, secret, store };
}
const rootHold = (target, over = {}) => S.createNotice({ privateJwk: root.privateJwk },
  { type: 'hold', target, kind: 'suspended', source: 'owner', reason: 'השעיה לבדיקה', issuedAt: T0 + DAY, ...over });
const junkNotice = (i, target, issuer = 'root') => ({ payload: { v: 1, id: 'junk-' + i, type: 'hold', target, issuer, issuedAt: T0,
  reason: 'זבל', kind: 'suspended', source: 'owner' }, sig: 'A'.repeat(86) });

// ---------- ממצא 5: הודעות סטטוס ----------
test('ממצא 5: הודעה בלי חתימה תקינה, ממפתח לא מוכר או למערכת אחרת — לא נקלטת ולא נרשמת בשומר', () => {
  const t = licensed();
  const stranger = L.generateKeyPair();
  const fromStranger = (() => {
    const payload = { v: 1, id: 'stranger-1', type: 'hold', target: t.id, issuer: stranger.keyId, issuedAt: T0 + DAY, reason: 'זר', kind: 'locked', source: 'parent' };
    return { payload, sig: L.signObject(payload, stranger.privateJwk) };
  })();
  const forged = { payload: { ...rootHold(t.id).payload, id: 'forged-1' }, sig: rootHold(t.id).sig };
  const otherSystem = rootHold(L.generateKeyPair().keyId);
  const r = t.store.importNotices(noticesPkg([forged, fromStranger, otherSystem, junkNotice(1, t.id)]));
  assert.deepEqual(r, { added: 0, rejected: 4 });
  assert.deepEqual(JSON.parse(t.storage.read()).notices, []);
  assert.deepEqual(guardOf(t.secret).notices, []);
  assert.equal(t.store.current().status, 'active');

  const hold = rootHold(t.id);
  assert.equal(t.store.importNotices(noticesPkg([hold])).added, 1);
  t.store.invalidate();
  assert.equal(t.store.current().status, 'suspended');
  assert.deepEqual(guardOf(t.secret).notices, [hold.payload.id]);
  // אותה הודעה שוב (כמו בכל סנכרון) — לא נוספת
  assert.equal(t.store.importNotices(noticesPkg([hold])).added, 0);
});

test('ממצא 5: הצפה ב-2000 הודעות זבל (מהשרת או בעריכת הקובץ) לא חוסמת השעיה אמיתית, והזבל לא ננעל בשומר', () => {
  const t = licensed();
  const junk = Array.from({ length: 2100 }, (_, i) => junkNotice(i, t.id));
  assert.equal(t.store.importNotices(noticesPkg(junk)).added, 0);
  // מי שכותב לקובץ ישירות — גם בשם המערכת עצמה (מנפיק מוכר בשרשרת)
  const d = JSON.parse(t.storage.read());
  d.notices = [...junk, ...Array.from({ length: 2100 }, (_, i) => junkNotice('self-' + i, t.id, t.id))];
  t.storage.write(JSON.stringify(d));
  t.store.invalidate();
  const hold = rootHold(t.id);
  assert.equal(t.store.importNotices(noticesPkg([hold])).added, 1, 'השעיה של מנהל-העל נקלטת');
  t.store.invalidate();
  assert.equal(t.store.current().status, 'suspended');
  assert.deepEqual(guardOf(t.secret).notices, [hold.payload.id], 'רק ההודעה החתומה נרשמה בשומר');
  // הסרת הזבל מהקובץ לא נחשבת "מחיקת השעיה"
  const clean = JSON.parse(t.storage.read());
  clean.notices = clean.notices.filter(n => n.payload.id === hold.payload.id);
  t.storage.write(JSON.stringify(clean));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'suspended');
});

test('ממצא 5: תקרה לכל מנפיק — מערכת שהציפה הודעות משלה עדיין מקבלת השעיה מהשורש; זבל בשמה לא תופס את המכסה', () => {
  const t = licensed();
  const child = L.generateKeyPair();
  const own = { privateJwk: t.node.privateJwk, license: t.lic };
  const base = JSON.parse(t.storage.read());
  base.children = [{ id: child.keyId, slot: 1, name: 'סניף', issuedAt: T0, license: { payload: { publicKey: child.publicJwk, expiresAt: T0 + 300 * DAY } } }];
  // 2000 הודעות זבל בשם המערכת — לא חתומות, ולכן לא נספרות
  base.notices = Array.from({ length: 2000 }, (_, i) => junkNotice('fake-' + i, child.keyId, t.id));
  t.storage.write(JSON.stringify(base));
  t.store.invalidate();
  const r = t.store.noticeForChild({ childId: child.keyId, type: 'hold', kind: 'suspended', reason: 'חוב פתוח' });
  assert.equal(r.notice.issuer, t.id);
  // 2000 הודעות חתומות של המערכת עצמה — המכסה שלה מלאה
  const mine = Array.from({ length: 2000 }, (_, i) => S.createNotice(own, { type: 'hold', target: child.keyId, kind: 'suspended', source: 'parent', reason: 'סבב ' + i, issuedAt: T0 + DAY }));
  const full = JSON.parse(t.storage.read());
  full.notices = mine;
  t.storage.write(JSON.stringify(full));
  t.store.invalidate();
  assert.throws(() => t.store.noticeForChild({ childId: child.keyId, type: 'hold', kind: 'suspended', reason: 'עוד אחת' }), /יותר מדי הודעות/);
  // השורש — בלי תקרה
  assert.equal(t.store.importNotices(noticesPkg([rootHold(t.id)])).added, 1);
  t.store.invalidate();
  assert.equal(t.store.current().status, 'suspended');
});

// ---------- ממצא 28: זמן הסנכרון ----------
// שומר מגרסה קודמת (בלי syncV): הזמן שבקובץ — מהגרסה הישנה — מועבר פעם אחת
const editLastSync = (storage, v) => { const d = JSON.parse(storage.read()); d.remote = { ...(d.remote || {}), lastSync: v }; storage.write(JSON.stringify(d)); };
test('ממצא 28: שומר מגרסה קודמת — הזמן בקובץ הגלוי מועבר פעם אחת בלבד, ולא מאוחר מ"עכשיו"', () => {
  let now = T0 + 10 * DAY;
  const t = licensed({ clock: () => now });
  editLastSync(t.storage, T0 + 400 * DAY);
  assert.equal(t.store.lastSyncTime(), now, 'ערך עתידי — עד "עכשיו"');
  assert.equal(guardOf(t.secret).lastSync, now, 'הועבר לשומר המוצפן');
  assert.equal(guardOf(t.secret).syncV, 1, 'השומר מסומן — לא יועבר שוב');
  const migrated = now;
  now += 40 * DAY;
  editLastSync(t.storage, now);
  assert.equal(t.store.lastSyncTime(), migrated, 'עריכה חוזרת של הקובץ — לא מחדשת את החיבור');
  // זמן שאינו חתום נחשב רק עד LEGACY_SYNC_CUTOFF (סקירה 24.10.2026, ממצא 1) — אחריו רק התשובה החתומה של השרת
  // (tests/audit-licensing-r2.test.js)
  t.store.setRemoteSettings({ lastSync: now });
  assert.ok(now > LS.LEGACY_SYNC_CUTOFF);
  assert.equal(t.store.lastSyncTime(), LS.LEGACY_SYNC_CUTOFF, 'זמן לא חתום בשומר — עד התאריך הקבוע');
  assert.equal(guardOf(t.secret).lastSync, now, 'נרשם בשומר כמו קודם');
});

test('ממצא 28 (סקירה): שומר מגרסה קודמת בלי זמן בקובץ — הסימון נכתב מיד, ועריכה מאוחרת של הקובץ לא נקלטת', () => {
  const now = T0 + 10 * DAY;
  const t = licensed({ clock: () => now });
  assert.equal(t.store.lastSyncTime(), 0);
  assert.equal(guardOf(t.secret).syncV, 1);
  editLastSync(t.storage, now);
  assert.equal(t.store.lastSyncTime(), 0);
  // גם כתיבה אחרת של השומר (lastSeen ב-compute) לפני הקריאה הראשונה מעבירה — ומסמנת
  const u = licensed({ clock: () => now });
  editLastSync(u.storage, T0 + 5 * DAY);
  u.store.setRemoteSettings({ url: 'https://relay.example.co.il' });
  assert.equal(guardOf(u.secret).lastSync, T0 + 5 * DAY);
  editLastSync(u.storage, now);
  assert.equal(u.store.lastSyncTime(), T0 + 5 * DAY);
});

test('ממצא 28 (סקירה): שומר מגרסה קודמת וקובץ תפוס בקריאה הראשונה — ההעברה נדחית, לא נאבדת', () => {
  const now = T0 + 10 * DAY;
  const dir = newDir();
  const file = path.join(dir, 'license.json');
  const node = L.generateKeyPair();
  fs.writeFileSync(file, JSON.stringify({ chain: [issueFor(node)], notices: [], children: [], remote: { lastSync: T0 + 5 * DAY } }));
  let busy = true;
  const flaky = { ...fs, readFileSync: (p, ...a) => { if (busy && p === file) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return fs.readFileSync(p, ...a); } };
  const secret = v2Secret(node);
  const s = LS.createLicenseStore({ storage: LS.fileStorage(flaky, file), secret, rootKeys, clock: () => now });
  assert.equal(s.lastSyncTime(), 0);
  assert.equal(guardOf(secret).syncV, undefined, 'לא סומן — ההעברה עוד לפניה');
  busy = false;
  assert.equal(s.lastSyncTime(), T0 + 5 * DAY);
  assert.equal(guardOf(secret).syncV, 1);
});

test('ממצא 28 (סקירה): רישיון שהותקן עכשיו ועוד לא סונכרן — עריכת license.json לא נותנת 30 יום', () => {
  const now = T0 + DAY;
  const storage = mem();
  const secret = mem();
  const s = LS.createLicenseStore({ storage, secret, rootKeys, clock: () => now });
  assert.ok(s.current().trial);
  const req = s.request('קהילת אור');
  s.install(licensePkg(issueFor({ publicJwk: req.publicKey })));
  assert.equal(s.current().status, 'active');
  assert.equal(s.lastSyncTime(), 0);
  editLastSync(storage, now);
  s.invalidate();
  assert.equal(s.lastSyncTime(), 0, 'הקובץ הגלוי לא נקרא בשומר של הגרסה הזו');
  s.setRemoteSettings({ lastSync: now });
  assert.equal(s.lastSyncTime(), now);
});

// ---------- ממצא 29: איפוס תקופת הניסיון ----------
test('ממצא 29: מחיקת קובץ הרישוי וקובץ המפתח לא מתחילה ניסיון חדש — הסימון השלישי גובר', () => {
  let now = T0;
  let db = {};
  const mk = () => LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, onMark: (m) => { db = m; } });
  const a = mk();
  a.setMark({});
  assert.equal(a.current().status, 'active');
  assert.equal(db.trialStart, T0, 'תחילת הניסיון נרשמה גם מחוץ לקבצי הרישוי');

  now = T0 + 31 * DAY;
  const b = mk(); // שני הקבצים נמחקו — רק המסד נשאר
  b.setMark(db);
  const st = b.current();
  assert.equal(st.status, 'trial_ended');
  assert.equal(st.trial.startedAt, T0);
  // תחילת הניסיון לא זזה קדימה
  b.setMark({ trialStart: now });
  b.invalidate();
  assert.equal(b.current().trial.startedAt, T0);

  // אחרי רישיון: מחיקת הקבצים — נעול, לא ניסיון
  const marks = [];
  const t = licensed();
  const store = LS.createLicenseStore({ storage: t.storage, secret: t.secret, rootKeys, clock: () => T0 + DAY, onMark: (m) => marks.push(m) });
  assert.equal(store.current().status, 'active');
  assert.equal(marks.at(-1).hadLicense, true);
  const fresh = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => T0 + DAY });
  fresh.setMark(marks.at(-1));
  assert.equal(fresh.current().status, 'locked');
  assert.match(fresh.current().reasons[0].reason, /קובץ הרישוי חסר/);
});

test('ממצא 29: מסד שחסר בו הסימון מקבל אותו מהקבצים (עדכון מגרסה קודמת)', () => {
  const storage = mem();
  storage.write(JSON.stringify({ chain: null, notices: [], children: [], lastSeen: 0, trialStart: T0 }));
  let db = null;
  const s = LS.createLicenseStore({ storage, secret: mem(), rootKeys, clock: () => T0 + DAY, onMark: (m) => { db = m; } });
  s.current();
  s.setMark({});
  assert.equal(db.trialStart, T0);
});

// ---------- ממצא 35: קובץ שלא נקרא / פגום ----------
test('ממצא 35: קובץ רישוי שלא נקרא (EBUSY) או פגום — לא נדרס בגרסה ריקה; פגום מועבר הצידה רק בהתקנה מחדש', () => {
  const dir = newDir();
  const file = path.join(dir, 'license.json');
  const node = L.generateKeyPair();
  const lic = issueFor(node);
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [], children: [{ id: 'x' }], remote: { url: 'https://relay.example.co.il' } }));
  const original = fs.readFileSync(file, 'utf8');
  let busy = true;
  const flaky = { ...fs, readFileSync: (p, ...a) => { if (busy && p === file) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); return fs.readFileSync(p, ...a); } };
  const store = LS.createLicenseStore({ storage: LS.fileStorage(flaky, file), secret: v2Secret(node), rootKeys, clock: () => T0 + DAY });

  assert.throws(() => store.setRemoteSettings({ pendingChildRequests: [], lastSync: T0 + DAY }), /לא ניתן לקרוא כרגע/);
  assert.throws(() => store.install(licensePkg(lic)), /לא ניתן לקרוא כרגע/);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'הקובץ לא נדרס');
  assert.match(store.current().reasons[0].reason, /לא ניתן לקרוא כרגע/);
  busy = false;
  assert.equal(store.current().status, 'active', 'שגיאה רגעית לא נשמרת במטמון');

  // קובץ פגום (לא שגיאת קריאה) — מועבר הצידה, לא נמחק ולא נדרס בתוכן
  const broken = '{ "chain": [ חתוך';
  fs.writeFileSync(file, broken);
  store.invalidate();
  store.setRemoteSettings({ url: 'https://relay.example.co.il' });
  const aside = fs.readdirSync(dir).filter(f => f.startsWith('license.json.unreadable-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), broken);
  // הרישיון היה מותקן — בלי הקובץ: נעול עד התקנה מחדש (לא ניסיון)
  store.invalidate();
  assert.match(store.current().reasons[0].reason, /קובץ הרישוי חסר/);
  store.install(licensePkg(lic));
  store.invalidate();
  assert.equal(store.current().status, 'active');
});

test('ממצא 35 (סקירה): קובץ פגום בתקופת ניסיון — מועבר הצידה והניסיון ממשיך מהתאריך המקורי; אחרי רישיון — נעול', () => {
  const dir = newDir();
  const file = path.join(dir, 'license.json');
  let now = T0;
  const secret = mem();
  const mk = () => LS.createLicenseStore({ storage: LS.fileStorage(fs, file), secret, rootKeys, clock: () => now });
  assert.equal(mk().current().trial.startedAt, T0);
  now = T0 + 10 * DAY;
  fs.writeFileSync(file, '{ חתוך');
  const st = mk().current();
  assert.equal(st.status, 'active', 'לא נעול לתמיד');
  assert.equal(st.trial.startedAt, T0, 'לא ניסיון חדש');
  const aside = fs.readdirSync(dir).filter(f => f.startsWith('license.json.unreadable-'));
  assert.deepEqual(aside.map(f => fs.readFileSync(path.join(dir, f), 'utf8')), ['{ חתוך']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).trialStart, T0, 'קובץ חדש נכתב');

  const dir2 = newDir();
  const file2 = path.join(dir2, 'license.json');
  const t = licensed({ storage: LS.fileStorage(fs, file2) });
  assert.equal(t.store.current().status, 'active');
  fs.writeFileSync(file2, 'garbage');
  const again = LS.createLicenseStore({ storage: LS.fileStorage(fs, file2), secret: t.secret, rootKeys, clock: () => T0 + DAY });
  assert.match(again.current().reasons[0].reason, /קובץ הרישוי חסר/);
  again.install(licensePkg(t.lic));
  again.invalidate();
  assert.equal(again.current().status, 'active');
});

// קובץ שתפוס בזמן שהדגל מורם, או רק ב-failNext הקריאות הבאות
function flakyFile(file) {
  const state = { busy: false, failNext: 0 };
  const flaky = { ...fs, readFileSync: (p, ...a) => {
    if (p === file && (state.busy || state.failNext > 0)) {
      if (state.failNext > 0) state.failNext--;
      throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    }
    return fs.readFileSync(p, ...a);
  } };
  return { state, storage: LS.fileStorage(flaky, file) };
}

test('ממצא 35 (סקירה): קובץ תפוס — getRemoteSettings זורק עם קוד (לא {}), Google מדלג, והנפקה לא נבלעת', () => {
  const dir = newDir();
  const file = path.join(dir, 'license.json');
  const f = flakyFile(file);
  const t = licensed({ storage: f.storage });
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il', pendingChildRequests: [{ keyId: 'k', name: 'א', at: T0, body: '{}' }] });
  t.store.current();
  f.state.busy = true;
  assert.throws(() => t.store.getRemoteSettings(), (e) => e.code === LS.READ_ERROR_CODE && /לא ניתן לקרוא כרגע/.test(e.message));
  assert.doesNotThrow(() => t.store.markGoogleSignIn(T0 + DAY));
  assert.throws(() => t.store.syncInfo(), (e) => e.code === LS.READ_ERROR_CODE);
  t.store.invalidate();
  assert.throws(() => t.store.issueChild({ approval: '{}' }), (e) => e.code === LS.READ_ERROR_CODE);
  assert.throws(() => t.store.importNotices(noticesPkg([])), (e) => e.code === LS.READ_ERROR_CODE);
  f.state.busy = false;
  assert.equal(t.store.getRemoteSettings().pendingChildRequests.length, 1);
});

// ---------- ממצא 30 + בקשה שנמחקה: שרת ממסר מדומה ----------
function fakeRelay() {
  const box = [];
  const sent = [];
  let onSend = null;
  let onFetch = null;
  let seq = 0;
  const push = (kind, body, at = T0, from = 'x'.repeat(22)) => box.push({ id: 'm' + (++seq), kind, body, at, from });
  const fetchImpl = async (url, opts) => {
    const req = JSON.parse(opts.body);
    let data = { ok: true };
    if (req.op === 'fetch') { data = { ok: true, messages: req.payload.after ? [] : box.slice() }; if (onFetch) onFetch(); }
    else if (req.op === 'ack') { for (const id of req.payload.ids) { const i = box.findIndex(m => m.id === id); if (i >= 0) box.splice(i, 1); } }
    else if (req.op === 'send') { sent.push(...req.payload.items); if (onSend) onSend(); }
    return { ok: true, headers: { get: () => null }, json: async () => data };
  };
  return { box, sent, push, fetchImpl, setOnSend: (fn) => { onSend = fn; }, setOnFetch: (fn) => { onFetch = fn; } };
}
const childRequestBody = (extra = {}) => {
  const k = L.generateKeyPair();
  return { key: k, body: JSON.stringify({ type: LS.PKG_REQUEST, v: 1, name: 'סניף בני ברק', publicKey: k.publicJwk, keyId: k.keyId, ...extra }) };
};

test('ממצא 30: בקשת רישיון ממערכת בת נשמרת בגוף מצומצם; גוף ענק או מזויף נדחה, ורשומות ישנות מנופחות מנוקות', async () => {
  const relay = fakeRelay();
  const t = licensed();
  // רשומה ישנה ענקית מגרסה קודמת
  const old = childRequestBody({ pad: 'z'.repeat(250 * 1024) });
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il', pendingChildRequests: [{ keyId: old.key.keyId, name: 'ישן', at: T0, body: old.body }] });
  const ok = childRequestBody({ pad: 'y'.repeat(1000) });
  const huge = childRequestBody({ pad: 'x'.repeat(300 * 1024) });
  const wrongId = JSON.parse(childRequestBody().body);
  wrongId.keyId = L.generateKeyPair().keyId;
  relay.push('license-request', ok.body);
  relay.push('license-request', huge.body);
  relay.push('license-request', JSON.stringify(wrongId));
  const sync = createLicenseSync({ store: t.store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  const r = await sync.receive();
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.pending.map(p => p.keyId), [ok.key.keyId]);
  const pending = t.store.getRemoteSettings().pendingChildRequests;
  assert.equal(pending.length, 1);
  const body = JSON.parse(pending[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['keyId', 'name', 'publicKey', 'type', 'v']);
  assert.ok(t.storage.read().length < 10 * 1024, 'קובץ הרישוי לא מתנפח');
  // הגוף המצומצם עדיין משמש לבקשת אישור
  assert.equal(t.store.requestChildApproval({ request: pending[0].body, ...childTerms }).childId, ok.key.keyId);
});

test('forwardChildRequest: בקשה חדשה שהגיעה בזמן ההמתנה לרשת לא נמחקת', async () => {
  const relay = fakeRelay();
  const t = licensed();
  const a = childRequestBody();
  const b = childRequestBody();
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il', pendingChildRequests: [{ keyId: a.key.keyId, name: 'א', at: T0, body: a.body }] });
  // בזמן השליחה — סנכרון ברקע מוסיף בקשה חדשה
  relay.setOnSend(() => {
    const cur = t.store.getRemoteSettings().pendingChildRequests || [];
    t.store.setRemoteSettings({ pendingChildRequests: [...cur, { keyId: b.key.keyId, name: 'ב', at: T0, body: b.body }] });
  });
  const sync = createLicenseSync({ store: t.store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  await sync.forwardChildRequest(a.key.keyId, childTerms);
  assert.equal(relay.sent[0].kind, 'approval-request');
  assert.deepEqual(t.store.getRemoteSettings().pendingChildRequests.map(p => p.keyId), [b.key.keyId]);
});

test('ממצא 35 (סקירה): קובץ תפוס אחרי קבלת ההודעות — הבקשות הממתינות לא נמחקות, ושום הודעה לא מאושרת לשרת', async () => {
  const relay = fakeRelay();
  const f = flakyFile(path.join(newDir(), 'license.json'));
  const t = licensed({ storage: f.storage });
  const a = childRequestBody();
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il', pendingChildRequests: [{ keyId: a.key.keyId, name: 'א', at: T0, body: a.body }] });
  relay.push('notices', noticesPkg([rootHold(t.id)]));
  const sync = createLicenseSync({ store: t.store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  // רק הקריאה הראשונה אחרי קבלת ההודעות נכשלת — הכתיבה בסוף הייתה מצליחה ודורסת ברשימה ריקה
  relay.setOnFetch(() => { f.state.failNext = 1; });
  await assert.rejects(sync.receive(), /לא ניתן לקרוא כרגע/);
  assert.equal(relay.box.length, 1, 'הודעת הסטטוס נשארת בשרת');
  assert.equal(f.state.failNext, 0);
  relay.setOnFetch(null);
  assert.deepEqual(t.store.getRemoteSettings().pendingChildRequests.map(p => p.keyId), [a.key.keyId], 'הרשימה לא נדרסה');
  const r = await sync.receive();
  assert.equal(r.handled, 1);
  assert.equal(relay.box.length, 0);
  t.store.invalidate();
  assert.equal(t.store.current().status, 'suspended');
  assert.deepEqual(t.store.getRemoteSettings().pendingChildRequests.map(p => p.keyId), [a.key.keyId]);
});

test('ממצא 35 (סקירה): הודעה שנכשלה בגלל קובץ תפוס (התקנה / הודעות / הנפקה) לא מאושרת לשרת — שאר ההודעות כן', async () => {
  const relay = fakeRelay();
  const t = licensed();
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il' });
  const busy = () => { throw Object.assign(new Error('לא ניתן לקרוא כרגע את קובץ הרישוי'), { code: LS.READ_ERROR_CODE }); };
  const store = { ...t.store, importNotices: busy, issueChild: busy };
  relay.push('notices', noticesPkg([rootHold(t.id)]));
  // אישור — רק ממנהל-העל (ממצא f12, סקירה 11.2026)
  relay.push('approval', '{}', T0, require('../shell/licensing/remote').mailboxOf(rootKeys[0]));
  relay.push('rejection', JSON.stringify({ name: 'סניף', reason: 'חסר תשלום' }));
  const sync = createLicenseSync({ store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  const r = await sync.receive();
  assert.equal(r.handled, 1);
  assert.deepEqual(relay.box.map(m => m.kind), ['notices', 'approval'], 'נשארו לסנכרון הבא');
});

test('forwardChildRequest (סקירה): קובץ תפוס אחרי שהבקשה נשלחה — התוצאה חוזרת (והתשלום יירשם כמנוצל)', async () => {
  const relay = fakeRelay();
  const f = flakyFile(path.join(newDir(), 'license.json'));
  const t = licensed({ storage: f.storage });
  const a = childRequestBody();
  t.store.setRemoteSettings({ url: 'https://relay.example.co.il', pendingChildRequests: [{ keyId: a.key.keyId, name: 'א', at: T0, body: a.body }] });
  relay.setOnSend(() => { f.state.busy = true; });
  const sync = createLicenseSync({ store: t.store, rootKeys, fetchImpl: relay.fetchImpl, clock: () => T0 + DAY });
  const r = await sync.forwardChildRequest(a.key.keyId, childTerms);
  assert.equal(r.childId, a.key.keyId);
  assert.equal(relay.sent[0].kind, 'approval-request');
  f.state.busy = false;
  assert.deepEqual(t.store.getRemoteSettings().pendingChildRequests.map(p => p.keyId), [a.key.keyId], 'נשארה ברשימה — אפשר לבטל');
});

// ---------- ממצא 29 (סקירה): תאריך עתידי, עותק מחוץ למסד, גיבוי ----------
test('ממצא 29 (סקירה): תחילת ניסיון עתידית (בסימון, בקובץ או בשומר) לא נקלטת — אין ניסיון קבוע', () => {
  const now = T0 + 40 * DAY;
  const future = Date.UTC(2100, 0, 1);
  const s = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now });
  s.setMark({ trialStart: future });
  // סקירה 2.11.2026 (f8): תאריך עתידי בעותק מקומי = שעון שהוחזר אחורה — נשמר כרצפה לזמן, לא כתחילת ניסיון
  assert.deepEqual(s.mark(), { lastSeen: future });
  assert.equal(s.current().trial.startedAt, now, 'לא מהתאריך העתידי');
  assert.equal(s.current().status, 'trial_ended', 'רצפת הזמן — לא ניסיון קבוע');
  s.importMark({ trialStart: future });
  s.invalidate();
  assert.equal(s.current().trial.startedAt, now);

  const storage = mem();
  storage.write(JSON.stringify({ chain: null, notices: [], children: [], trialStart: future, lastSeen: future }));
  const secret = mem();
  secret.write(JSON.stringify({ v: 2, key: L.generateKeyPair().privateJwk, guard: { lastSeen: 0, notices: [], trialStart: future } }));
  const f = LS.createLicenseStore({ storage, secret, rootKeys, clock: () => now }).current();
  assert.equal(f.trial.startedAt, now);
  assert.equal(f.status, 'trial_ended', 'lastSeen עתידי בקובץ לא מאריך');
  // תחילה מוקדמת (אמיתית) מהסימון — גוברת
  const g = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now });
  g.setMark({ trialStart: T0 });
  assert.equal(g.current().trial.startedAt, T0);
});

test('ממצא 29 (סקירה): עותק הסימון מחוץ למסד (markStorage) — מחיקת שני קבצי הרישוי והמסד לא נותנת ניסיון חדש', () => {
  let now = T0;
  const marks = mem();
  const a = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks });
  a.setMark({}); // מסד חדש
  assert.equal(a.current().trial.startedAt, T0);
  assert.equal(JSON.parse(marks.read()).trialStart, T0);
  now = T0 + 31 * DAY;
  let db = null;
  const b = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks, onMark: (m) => { db = m; } });
  b.setMark({}); // גם המסד נמחק
  assert.equal(b.current().status, 'trial_ended');
  assert.equal(b.current().trial.startedAt, T0);
  assert.equal(db.trialStart, T0, 'המסד החדש מקבל את הסימון בחזרה');
  // הקובץ נמחק והמסד נשאר — הקובץ נכתב מחדש
  const marks2 = mem();
  const c = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks2 });
  c.setMark({ trialStart: T0, hadLicense: true });
  assert.deepEqual(JSON.parse(marks2.read()), { trialStart: T0, hadLicense: true });
  assert.match(c.current().reasons[0].reason, /קובץ הרישוי חסר/);
});

// ---------- דרך ipc: הסימון במסד, וקבלת הודעות בהרשאת צפייה ----------
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_lic__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_lic__.js'] = { id: '/__electron_stub_audit_lic__.js', filename: '/__electron_stub_audit_lic__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });
const PASS = 'a-very-long-pass-2026';

test('ipc / ממצא 29: אחרי מחיקת קובץ הרישוי — הניסיון ממשיך מהמסד ולא מתחיל מחדש', async () => {
  const dir = newDir();
  let now = T0;
  const opts = () => ({ rootKeys, clock: () => now, relayUrl: '' });
  await ipc.initEcon(dir, opts());
  await handlers['auth:setup'](ev(71), 'menahel_trial', PASS);
  const first = await handlers['license:getStatus'](ev(71));
  assert.equal(first.trial.startedAt, T0);
  await handlers['license:getStatus'](ev(71)); // התור: הכתיבה למסד הסתיימה

  now = T0 + 31 * DAY;
  fs.rmSync(path.join(dir, 'license.json'), { force: true });
  fs.rmSync(path.join(dir, 'license-key.bin'), { force: true });
  await ipc.initEcon(dir, opts());
  await handlers['auth:login'](ev(72), 'menahel_trial', PASS);
  const st = await handlers['license:getStatus'](ev(72));
  assert.equal(st.status, 'trial_ended');
  assert.equal(st.trial.startedAt, T0);
});

test('ipc: chat:refresh בהרשאת צפייה — הודעות בלבד; רישיונות והודעות סטטוס נשארים לסנכרון של המנהל', async () => {
  assert.equal(ipc.permissionFor('chat:refresh'), 'data.view', 'קריאת הודעות — לכל משתמש');
  const dir = newDir();
  const now = T0 + DAY;
  const relay = fakeRelay();
  const node = L.generateKeyPair();
  const lic = issueFor(node);
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ chain: [lic], notices: [] }));
  markActivated(dir, now);
  await ipc.initEcon(dir, { rootKeys, clock: () => now, licenseSecret: v2Secret(node), fetchImpl: relay.fetchImpl, relayUrl: 'https://relay.example.co.il' });
  await handlers['auth:setup'](ev(81), 'menahel_chat', PASS);
  await handlers['users:create'](ev(81), { username: 'tzofe_chat', password: 'another-long-pass-2026', role: 'viewer' });
  await handlers['auth:login'](ev(82), 'tzofe_chat', 'another-long-pass-2026');

  const hold = rootHold(lic.payload.id);
  relay.push('notices', noticesPkg([hold]));
  const asViewer = await handlers['chat:refresh'](ev(82));
  assert.equal(asViewer.handled, 0);
  assert.equal(relay.box.length, 1, 'הודעת הסטטוס לא אושרה — נשארת בשרת');
  assert.equal((await handlers['license:getStatus'](ev(82))).status, 'active', 'צופה לא מתקין דבר');

  const asAdmin = await handlers['chat:refresh'](ev(81));
  assert.equal(asAdmin.handled, 1);
  assert.equal(relay.box.length, 0);
  assert.equal((await handlers['license:getStatus'](ev(81))).status, 'suspended');
  // המערכת מושבתת עכשיו — היומן נקרא ישירות מהמסד
  const audit = await ipc.getDb().listAudit({});
  assert.ok(audit.some(a => a.action === 'license.remote.sync'), 'הסנכרון המלא נרשם ביומן');
});

// ---------- סקירה: הסימון בגיבוי ובשחזור, העותק מחוץ למסד, ותשלום מערכת בת ----------
test('ipc / ממצא 29 (סקירה): הסימון בגיבוי — שחזור להתקנה נקייה ממשיך את הניסיון, ואחרי רישיון נועל; install-marks.json לבדו מספיק', async () => {
  let now = T0;
  const opts = () => ({ rootKeys, clock: () => now, relayUrl: '' });
  const dir1 = newDir();
  await ipc.initEcon(dir1, opts());
  await handlers['auth:setup'](ev(91), 'menahel_bk1', PASS);
  assert.equal((await handlers['license:getStatus'](ev(91))).trial.startedAt, T0);
  const marks = ipc.licenseMarks(); // מה שנכנס לכל גיבוי (collectBackup)
  assert.deepEqual(marks, { trialStart: T0, lastSeen: T0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir1, 'install-marks.json'), 'utf8')), { trialStart: T0, lastSeen: T0 });

  // התקנה נקייה (בלי קבצי רישוי ובלי מסד) ושחזור הגיבוי
  now = T0 + 31 * DAY;
  const dir2 = newDir();
  await ipc.initEcon(dir2, opts());
  await handlers['auth:setup'](ev(92), 'menahel_bk2', PASS);
  ipc.mergeLicenseMarks(marks);
  const st = await handlers['license:getStatus'](ev(92));
  assert.equal(st.status, 'trial_ended');
  assert.equal(st.trial.startedAt, T0);
  assert.equal((await ipc.getDb().getLicenseMarks()).trialStart, String(T0), 'נשמר גם במסד החדש');
  // גיבוי ישן לא מאריך: תאריך מאוחר יותר לא משנה דבר
  ipc.mergeLicenseMarks({ trialStart: T0 + 20 * DAY });
  assert.equal((await handlers['license:getStatus'](ev(92))).trial.startedAt, T0);
  // גיבוי ממערכת שהיה בה רישיון — נעול עד התקנת רישיון, לא ניסיון
  ipc.mergeLicenseMarks({ hadLicense: true });
  assert.match((await handlers['license:getStatus'](ev(92))).reasons[0].reason, /קובץ הרישוי חסר/);

  // נמחקו שני קבצי הרישוי וגם המסד — רק העותק שמחוץ למסד נשאר
  const dir3 = newDir();
  fs.copyFileSync(path.join(dir1, 'install-marks.json'), path.join(dir3, 'install-marks.json'));
  await ipc.initEcon(dir3, opts());
  await handlers['auth:setup'](ev(93), 'menahel_bk3', PASS);
  const st3 = await handlers['license:getStatus'](ev(93));
  assert.equal(st3.status, 'trial_ended');
  assert.equal(st3.trial.startedAt, T0);
});

test('ipc (סקירה): קובץ הרישוי תפוס אחרי שבקשת האישור נשלחה — התשלום מסומן כנוצל (תשלום אחד, בקשה אחת)', async () => {
  const now = T0 + DAY;
  const dir = newDir();
  const file = path.join(dir, 'license.json');
  const f = flakyFile(file);
  const node = L.generateKeyPair();
  const a = childRequestBody();
  fs.writeFileSync(file, JSON.stringify({ chain: [issueFor(node)], notices: [], children: [],
    remote: { pendingChildRequests: [{ keyId: a.key.keyId, name: 'סניף אלעד', at: T0, body: a.body }] } }));
  markActivated(dir, now);
  const relay = fakeRelay();
  await ipc.initEcon(dir, { rootKeys, clock: () => now, licenseStorage: f.storage, licenseSecret: v2Secret(node), fetchImpl: relay.fetchImpl, relayUrl: 'https://relay.example.co.il' });
  await handlers['auth:setup'](ev(95), 'menahel_fw', PASS);
  const pay = await handlers['license:childPaymentRequest'](ev(95), { keyId: a.key.keyId, amount: 600 });
  await handlers['collect:markPaid'](ev(95), pay.id, {});
  relay.setOnSend(() => { f.state.busy = true; });
  try {
    const r = await handlers['license:remoteForwardChild'](ev(95), { keyId: a.key.keyId, ...childTerms });
    assert.equal(r.childId, a.key.keyId);
  } finally { f.state.busy = false; }
  assert.equal(relay.sent.filter(x => x.kind === 'approval-request').length, 1);
  assert.equal(await handlers['license:childPaymentStatus'](ev(95), a.key.keyId), null, 'התשלום נוצל');
  await assert.rejects(handlers['license:remoteForwardChild'](ev(95), { keyId: a.key.keyId, ...childTerms }), /דרישת תשלום/);
});

// גוף הפונקציה בקובץ המקור — עד הפונקציה הבאה
function fnBody(src, name) {
  const i = src.indexOf(name);
  assert.ok(i >= 0, name);
  const rest = src.slice(i + name.length);
  const end = rest.search(/\n\s*(async )?function [A-Za-z]/);
  return name + (end < 0 ? rest : rest.slice(0, end));
}
test('גיבוי ושחזור (סקירה): הסימון נכלל בכל גיבוי ונקלט בשחזור — במחשב ובאנדרואיד', () => {
  const ROOT = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const android = fs.readFileSync(path.join(ROOT, 'android', 'web', 'main-android.js'), 'utf8');
  assert.match(fnBody(main, 'async function collectBackup('), /out\.licenseMarks = econ\.licenseMarks\(\)/);
  // רק מגיבוי מוצפן של התוכנה הזו (shell/backup-scope.js) — לא ישירות מהקובץ
  assert.match(fnBody(main, 'async function restoreAllRun('), /BackupScope\.licenseMarksToMerge\(data, \{ encrypted \}\)[\s\S]*econ\.mergeLicenseMarks\(marks\)/);
  assert.match(fnBody(main, 'async function recoverDatabase('), /restore\(data\.econ\);[\s\S]*BackupScope\.licenseMarksToMerge\(data, \{ encrypted: true \}\)[\s\S]*econ\.mergeLicenseMarks\(marks\)/);
  assert.match(fnBody(android, 'async function collectBackup('), /out\.licenseMarks = econ\.licenseMarks\(\)/);
  assert.match(fnBody(android, 'async function restoreAll('), /BackupScope\.licenseMarksToMerge\(data, \{ encrypted \}\)[\s\S]*econ\.mergeLicenseMarks\(marks\)/);
  for (const src of [main, android]) {
    assert.doesNotMatch(src, /mergeLicenseMarks\(data\.licenseMarks\)/, 'אין קליטה ישירה מהקובץ');
    assert.match(src, /product: BackupScope\.PRODUCT/, 'המוצר נרשם בכל גיבוי');
  }
});

// main.js האמיתי בתהליך נפרד (כמו tests/db-recovery.test.js): מסד פגום ← שחזור מהגיבוי האוטומטי, שבו הסימון
const SPAWN_SCRIPT = (userData, plan) => `
const Module = require('module');
const plan = ${JSON.stringify(plan)};
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => k in p ? p[k] : (k === 'then' ? undefined : ch()), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
let ready;
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch() {} }; } }),
    getPath: () => ${JSON.stringify(userData)}, on() {}, exit() {}, quit() {}, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: class { constructor() { this.webContents = ch({ id: 1, isDestroyed: () => false }); this.contentView = { addChildView() {} }; } isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; } on() {} once() {} removeMenu() {} maximize() {} show() {} focus() {} setMenu() {} getNormalBounds() { return this.getContentBounds(); } getContentSize() { return [1000, 800]; } loadFile() {} getContentBounds() { return { x: 0, y: 0, width: 1000, height: 800 }; } getBounds() { return this.getContentBounds(); } },
  WebContentsView: class { constructor() { this.webContents = ch({ id: 9, isDestroyed: () => false, isLoading: () => false }); } setVisible() {} setBounds() {} },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  dialog: { showMessageBox: async (a, b) => { const o = b || a; const r = plan.shift(); return { response: r === undefined ? (o.buttons || []).length - 1 : r }; },
    showErrorBox: () => {}, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: ch(), net: ch(), session: ch(), shell: ch(), Menu: ch(), safeStorage: ss, screen: ch()
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? '/__e__.js' : orig.call(this, r, ...a); };
require.cache['/__e__.js'] = { id: '/__e__.js', filename: '/__e__.js', loaded: true, exports: stub };
global.setTimeout = ((st) => (fn, ms, ...r) => st(fn, ms, ...r).unref())(global.setTimeout);
global.setInterval = ((si) => (fn, ms, ...r) => si(fn, ms, ...r).unref())(global.setInterval);
require(${JSON.stringify(path.join(__dirname, '..', 'main.js'))});
(async () => {
  await ready();
  const econ = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'))});
  let donors = null;
  try { donors = (await econ.getDb().load()).donors.map(d => d.name); } catch {}
  process.stdout.write('RESULT' + JSON.stringify({ donors, marks: econ.licenseMarks() }));
})().catch(e => process.stdout.write('RESULT' + JSON.stringify({ fatal: String(e && e.stack) })));
`;

// מסד פגום + גיבוי אוטומטי מוצפן אחד בתיקיית הגיבוי, ושחזור ממנו בעלייה; extra — שדות נוספים בגיבוי (product וכו')
async function recoverFromAutoBackup(trialStart, extra = {}) {
  const { spawnSync } = require('child_process');
  const crypto = require('crypto');
  const R = require('../shell/db-recovery');
  const { initializeDatabase } = require('../modules/econ/core/database');
  const BK = require('../modules/econ/core/backupCrypto');
  const userData = newDir();
  const db = await initializeDatabase(userData);
  for (let i = 0; i < 2000; i++) await db.audit(null, 'test', 'פרטים ' + i);
  db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.db.close();
  const f = path.join(userData, R.DB_NAME);
  const b = fs.readFileSync(f);
  for (let i = 8192; i < b.length; i += 5) b[i] = 0x55;
  fs.writeFileSync(f, b);
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(path.join(userData, 'autobackup.key'), Buffer.from('K:' + key));
  const bkDir = path.join(userData, 'bk');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
  const out = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'משה כהן' }] }, localStorage: {},
    licenseMarks: { trialStart, hadLicense: true }, ...extra };
  fs.writeFileSync(path.join(bkDir, 'auto-2026-10-17.ssbk'), BK.encryptBackup(JSON.stringify(out), key));

  const r = spawnSync(process.execPath, ['-e', SPAWN_SCRIPT(userData, [0, 0])], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  const res = JSON.parse(r.stdout.slice(i + 6));
  assert.ok(!res.fatal, res.fatal);
  assert.deepEqual(res.donors, ['משה כהן'], 'הנתונים שוחזרו');
  return { res, userData };
}

test('main.js (סקירה): מסד פגום ← שחזור מהגיבוי האוטומטי מחזיר גם את סימוני הרישוי', async () => {
  const trialStart = Date.UTC(2026, 0, 1);
  // גיבוי ישן של התוכנה הזו (בלי product) — נקלט כמו קודם
  const { res, userData } = await recoverFromAutoBackup(trialStart);
  assert.deepEqual(res.marks, { trialStart, hadLicense: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'install-marks.json'), 'utf8')), { trialStart, hadLicense: true });
  // וגם גיבוי חדש, שנושא את המוצר של התוכנה הזו
  const own = await recoverFromAutoBackup(trialStart, { product: require('../shell/backup-scope').PRODUCT });
  assert.deepEqual(own.res.marks, { trialStart, hadLicense: true });
});

test('main.js: מסד פגום ← גיבוי אוטומטי של מוצר אחר שהונח בתיקייה משוחזר בלי סימוני הרישוי שלו', async () => {
  const trialStart = Date.UTC(2026, 0, 1);
  // עם product של SuperSuite לימוד, או גיבוי מלא ישן שלה בלי product (המודולים שלה קיימים בו תמיד)
  for (const extra of [{ product: 'supersuite-learn' }, { localStorage: { english: {}, math: {}, school: {}, tools: {} } }]) {
    const { res } = await recoverFromAutoBackup(trialStart, extra);
    assert.notEqual(res.marks.hadLicense, true, 'hadLicense של המוצר האחר לא נקלט: ' + JSON.stringify(extra));
    assert.notEqual(res.marks.trialStart, trialStart, 'תחילת הניסיון של המוצר האחר לא נקלטה');
  }
});
