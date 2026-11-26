'use strict';
// רגרסיה לסקירת הקוד מ-2.11.2026, נושא 1 — הרישוי נפתח כשמשהו נכשל (ממצאים f1, f8, f10, f11):
// חריגה בחישוב ← נעול (לא "בלי רישוי"); מבנה לא צפוי ב-license.json ← פגום; שרשרת ישנה בעריכה ידנית ← נעול;
// שחזור עותק ישן של שני קבצי הרישוי ← נעול מול הסימונים הבלתי תלויים; מחיקת קבצי הרישוי והחזרת שעון ← בלי ניסיון חדש
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const LS = require('../shell/licensing/store');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; }, aside() { v = null; } }; };
const limits = { maxChildren: 3, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const issueFor = (node, issuedAt, features = ['econ', 'tools', 'shamai']) => L.issueLicense({ privateJwk: root.privateJwk },
  { name: 'תלמוד תורה', publicKey: node.publicJwk, slot: 1, features, limits, issuedAt, expiresAt: issuedAt + 365 * DAY, graceDays: 7 });
const licensePkg = (lic, notices = []) => JSON.stringify({ type: LS.PKG_LICENSE, v: 1, chain: [lic], notices });
const noticesPkg = (notices) => JSON.stringify({ type: LS.PKG_NOTICES, v: 1, notices });
const hold = (target, issuedAt) => S.createNotice({ privateJwk: root.privateJwk },
  { type: 'hold', target, kind: 'locked', source: 'owner', reason: 'חוב פתוח', issuedAt });

// מערכת ברישיון שהותקן דרך install (כמו בפועל: request ← install)
function installed({ now = () => T0 + DAY, markStorage = null } = {}) {
  const storage = mem();
  const secret = mem();
  const store = LS.createLicenseStore({ storage, secret, rootKeys, clock: () => now(), markStorage });
  const req = store.request('תלמוד תורה');
  const node = { publicJwk: req.publicKey };
  return { storage, secret, store, node, id: req.keyId };
}

test('f1: notices שאינו מערך / ערך אינסופי / children שאינו מערך — נעול, ולא "בלי רישוי"', () => {
  for (const tamper of [{ notices: 1 }, { notices: {} }, { children: 'x' }, { chain: [1] }, { lastSeen: 'x' }]) {
    const t = installed();
    t.store.install(licensePkg(issueFor(t.node, T0)));
    assert.equal(t.store.current().status, 'active');
    t.storage.write(JSON.stringify({ ...JSON.parse(t.storage.read()), ...tamper }));
    t.store.invalidate();
    const st = t.store.current();
    assert.equal(st.mode, 'licensed', JSON.stringify(tamper));
    assert.equal(st.status, 'locked', JSON.stringify(tamper));
  }
  // 1e999 בהודעה: JSON.parse נותן Infinity, והחישוב זורק — נעול, לא חריגה ולא "בלי רישוי"
  const t = installed();
  t.store.install(licensePkg(issueFor(t.node, T0)));
  const d = JSON.parse(t.storage.read());
  t.storage.write(JSON.stringify({ ...d, notices: [{ payload: { id: 'x', target: t.id } }] }).replace('"id":"x"', '"id":"x","n":1e999'));
  // השומר "מכיר" את ההודעה, כדי שהחישוב יגיע לטביעה (canonical זורק על Infinity)
  const sec = JSON.parse(t.secret.read());
  sec.guard.notices.push('x');
  sec.guard.hashes = { ...(sec.guard.hashes || {}), x: 'aa' };
  t.secret.write(JSON.stringify(sec));
  t.store.invalidate();
  let st;
  assert.doesNotThrow(() => { st = t.store.current(); });
  assert.equal(st.mode, 'licensed');
  assert.equal(st.status, 'locked');
});

test('f1: licenseNow במחשב ובאנדרואיד — חריגה מחזירה מצב נעול', () => {
  for (const f of ['main.js', 'android/web/main-android.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const m = src.match(/function licenseNow\(\) \{[\s\S]*?\n\s*\}/);
    assert.ok(m, f);
    assert.doesNotMatch(m[0], /catch \{ return \{ mode: 'unlicensed' \}/, f);
    assert.match(m[0], /catch \{ return licenseFailed\(\); \}/, f);
    assert.match(src, /const licenseFailed = \(\) => \(\{ mode: 'licensed', status: 'locked', features: \[\]/, f);
  }
});

test('f10: החזרת השרשרת הקודמת (עם יותר תחומים) ל-license.json בעריכה ידנית — נעול', () => {
  let now = T0 + DAY;
  const t = installed({ now: () => now });
  const old = issueFor(t.node, T0, ['econ', 'tools', 'shamai']);
  t.store.install(licensePkg(old));
  const oldFile = t.storage.read();
  now = T0 + 100 * DAY;
  const renewed = issueFor(t.node, T0 + 100 * DAY, ['econ', 'tools']);
  t.store.install(licensePkg(renewed));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
  assert.ok(!t.store.current().features.includes('shamai'));
  // העריכה: השרשרת הישנה חוזרת
  t.storage.write(oldFile);
  t.store.invalidate();
  const st = t.store.current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /ישן מהרישיון שהותקן/);
  // אותו זמן הנפקה, תוכן שונה (חתימה של רישיון אחר) — נעול
  const other = issueFor(t.node, T0 + 100 * DAY, ['econ']);
  t.storage.write(JSON.stringify({ ...JSON.parse(oldFile), chain: [other] }));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'locked');
  // הרישיון העדכני חוזר — פעיל
  t.store.install(licensePkg(renewed));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
});

test('f11: שחזור עותק ישן של license.json ושל license-key.bin יחד, מלפני השעיה — נעול מול הסימון הבלתי תלוי', () => {
  const marks = mem();
  let now = T0 + DAY;
  const t = installed({ now: () => now, markStorage: marks });
  t.store.install(licensePkg(issueFor(t.node, T0)));
  assert.equal(t.store.current().status, 'active');
  const oldFile = t.storage.read();
  const oldKey = t.secret.read();
  now = T0 + 10 * DAY;
  t.store.importNotices(noticesPkg([hold(t.id, T0 + 10 * DAY)]));
  t.store.invalidate();
  assert.notEqual(t.store.current().status, 'active', 'ההשעיה נקלטה');
  assert.ok(JSON.parse(marks.read()).notices[t.id].length, 'מזהה ההודעה נרשם גם בסימון');
  // שחזור שני הקבצים מגיבוי של התיקייה — עקביים זה עם זה, אבל לא עם הסימון
  t.storage.write(oldFile);
  t.secret.write(oldKey);
  const again = LS.createLicenseStore({ storage: t.storage, secret: t.secret, rootKeys, clock: () => now, markStorage: marks });
  const st = again.current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /חסרות 1 הודעות/);
});

test('f11: סימון של מערכת אחרת (גיבוי ממחשב אחר) לא נועל — המזהים נשמרים לכל רישיון בנפרד', () => {
  const t = installed();
  t.store.install(licensePkg(issueFor(t.node, T0)));
  t.store.importMark({ notices: { 'other-node-id': ['notice-of-another-system'] } });
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
});

test('f8: מחיקת שני קבצי הרישוי והחזרת השעון אחרי סוף הניסיון — אין ניסיון חדש (lastSeen בסימונים)', () => {
  const marks = mem();
  let now = T0;
  const a = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks });
  assert.equal(a.current().status, 'active');
  now = T0 + 31 * DAY;
  a.invalidate();
  assert.equal(a.current().status, 'trial_ended');
  // המשתמש מוחק license.json ו-license-key.bin ומחזיר את השעון ליום אחרי ההתקנה
  now = T0 + DAY;
  const b = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks });
  assert.equal(b.current().status, 'trial_ended');
  // ולפני ההתקנה — תחילת הניסיון "עתידית", והזמן לא חוזר אחורה
  now = T0 - 5 * DAY;
  const c = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now, markStorage: marks });
  assert.equal(c.current().status, 'trial_ended');
});

test('f8: הסימון מגיבוי (importMark) — lastSeen עתידי לא נקלט מעבר לעכשיו', () => {
  const now = T0 + DAY;
  const s = LS.createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock: () => now });
  s.importMark({ lastSeen: Date.UTC(2100, 0, 1) });
  assert.equal(s.mark().lastSeen, now);
  assert.equal(s.current().status, 'active');
});

test('f10 (אימות): שחזור license.json ו-license-key.bin יחד מלפני החידוש — נעול מול הסימון הבלתי תלוי', () => {
  const marks = mem();
  let now = T0 + DAY;
  const t = installed({ now: () => now, markStorage: marks });
  t.store.install(licensePkg(issueFor(t.node, T0, ['econ', 'tools', 'shamai'])));
  t.store.current();
  const oldFile = t.storage.read();
  const oldKey = t.secret.read();
  now = T0 + 100 * DAY;
  t.store.install(licensePkg(issueFor(t.node, T0 + 100 * DAY, ['econ'])));
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
  t.storage.write(oldFile);
  t.secret.write(oldKey);
  const again = LS.createLicenseStore({ storage: t.storage, secret: t.secret, rootKeys, clock: () => now, markStorage: marks });
  assert.equal(again.current().status, 'locked');
});

test('אימות: שעון שקפץ קדימה, תוקן, והותקן רישיון חדש במפתח חדש — לא ננעל בגלל lastSeen שבסימונים', () => {
  const marks = mem();
  let now = T0 + DAY;
  const a = installed({ now: () => now, markStorage: marks });
  a.store.install(licensePkg(issueFor(a.node, T0)));
  now = T0 + 732 * DAY; // השעון קפץ שנתיים קדימה
  a.store.invalidate();
  a.store.current();
  now = T0 + 2 * DAY; // השעון תוקן; התקנה מחדש (מפתח חדש) ורישיון חדש מהספק
  const b = installed({ now: () => now, markStorage: marks });
  b.store.install(licensePkg(issueFor(b.node, T0 + 2 * DAY)));
  b.store.invalidate();
  assert.equal(b.store.current().status, 'active');
});

test('אימות: סימון מגיבוי לא מכניס מזהי הודעות או רישיון (לא חתומים — גיבוי ערוך לא נועל)', () => {
  const t = installed();
  t.store.install(licensePkg(issueFor(t.node, T0)));
  t.store.importMark({ notices: { [t.id]: ['fake-notice'] }, leaves: { [t.id]: { at: T0 + 999 * DAY, hash: 'x' } } });
  t.store.invalidate();
  assert.equal(t.store.current().status, 'active');
  assert.equal(t.store.mark().leaves[t.id].at, T0);
});
