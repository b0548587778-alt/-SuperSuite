// גיבוי האימונים מוצפן ומאומת (PLAN.md 3.4):
// אין ייצוא JSON גלוי במודול, ושחזור קובץ לא תקין לא מוחק את הנתונים הקיימים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkTrainerItems, legacyTrainerBackup, isKnownKey } = require('../shell/trainer-backup-check');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// נתונים בצורה שהמודול כותב (App.jsx — K)
const ID = 'c_1729000000000_ab12cd';
const good = () => ({
  'trainer:profile': JSON.stringify({ name: 'משה כהן', businessName: 'סטודיו כושר' }),
  'clients:index': JSON.stringify([ID]),
  [`client:${ID}`]: JSON.stringify({ id: ID, name: 'יעקב לוי' }),
  [`program:${ID}`]: JSON.stringify({ days: [] }),
  [`sessions:${ID}`]: JSON.stringify([]),
  [`measurements:${ID}`]: JSON.stringify([]),
  [`assessments:${ID}`]: JSON.stringify([]),
  [`memberships:${ID}`]: JSON.stringify([]),
  'studio:plans': JSON.stringify([]),
  'studio:schedule': JSON.stringify([]),
});

test('מפתחות מוכרים: כל מה שהמודול כותב, ולא שום דבר אחר', () => {
  for (const k of Object.keys(good())) assert.ok(isKnownKey(k), k);
  for (const k of ['client:', 'client:../x', 'x:1', 'auth', 'clients:index2', '__proto__']) assert.ok(!isKnownKey(k), k);
});

test('קובץ תקין עובר במלואו', () => {
  const r = checkTrainerItems(good());
  assert.equal(r.ok, true);
  assert.deepEqual(r.clean, good());
});

test('מפתח לא מוכר מדולג ולא נכתב, ושאר הנתונים עוברים', () => {
  const r = checkTrainerItems({ ...good(), 'english:theme': 'light' });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, 1);
  assert.ok(!('english:theme' in r.clean));
});

test('קובץ לא תקין נפסל — עם הודעה בעברית', () => {
  const bad = [
    null, [], 'text', {},
    { 'english:theme': 'light' }, // אין שום נתון של אימונים
    { ...good(), 'clients:index': 'לא JSON' },
    { ...good(), 'clients:index': JSON.stringify({ a: 1 }) },
    { ...good(), 'clients:index': JSON.stringify([1, 2]) },
    { ...good(), [`client:${ID}`]: JSON.stringify('מחרוזת') },
    { ...good(), [`program:${ID}`]: 42 },
  ];
  for (const items of bad) {
    const r = checkTrainerItems(items);
    assert.equal(r.ok, false, JSON.stringify(items));
    assert.match(r.error, /[א-ת]/);
  }
});

test('קובץ JSON ישן מהמודול: מומר לגיבוי של האימונים בלבד', () => {
  const r = legacyTrainerBackup(good());
  assert.equal(r.suite, 'SuperSuite');
  assert.equal(r.scope, 'trainer');
  assert.equal(r.econ, null);
  assert.deepEqual(r.localStorage.trainer, good());
});

test('קובץ ישן: גיבוי של SuperSuite או קובץ שאינו של האימונים — לא מומר', () => {
  assert.equal(legacyTrainerBackup({ suite: 'SuperSuite', localStorage: {} }), null);
  assert.equal(legacyTrainerBackup({ name: 'קובץ אחר' }), null);
  assert.equal(legacyTrainerBackup([good()]), null);
  assert.equal(legacyTrainerBackup(null), null);
});

// בדיקות קוד המקור של המודול, ה-CI שבונה אותו ושחזור האנדרואיד — במאגר SuperSuite לימוד (modules-src/trainer שם).
// כאן החבילה הבנויה מועתקת משם; השחזור במחשב (בדיקה לפני האישור) — ב-tests/audit-backup-startup.test.js ו-main-behavior.
