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
  const r = checkTrainerItems({ ...good(), 'shamai_theme': 'light' });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, 1);
  assert.ok(!('shamai_theme' in r.clean));
});

test('קובץ לא תקין נפסל — עם הודעה בעברית', () => {
  const bad = [
    null, [], 'text', {},
    { 'shamai_theme': 'light' }, // אין שום נתון של אימונים
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

test('המודול: אין ייצוא JSON גלוי ואין שחזור שמוחק את האחסון', () => {
  const app = require('./helpers/trainer-src').trainerUiSource(); // כל קבצי הממשק (PLAN.md 6.2)
  assert.ok(!/ייצוא גיבוי \(JSON\)/.test(app));
  assert.ok(!/trainer-pro-backup/.test(app));
  assert.ok(!/application\/json/.test(app));
  assert.ok(!/new FileReader/.test(app));
  // "מחק הכל" נשאר — עם שני אישורים
  assert.equal((app.match(/localStorage\.clear\(\)/g) || []).length, 1);
  assert.match(app, /Ctrl\+Shift\+B/);
});

// בשחזור (מחשב ואנדרואיד): הבדיקה לפני האישור ולפני כל מחיקה, ונתוני האימונים נכתבים רק מהתוצאה שנבדקה
for (const [name, file] of [['main.js', ['main.js']], ['אנדרואיד', ['android', 'web', 'main-android.js']]]) {
  test(`שחזור (${name}): בדיקת האימונים לפני האישור, לפני שחזור הכספים ולפני כל מחיקה`, () => {
    const src = read(...file);
    const body = src.slice(src.indexOf('async function restoreAll'));
    const iCheck = body.indexOf('TrainerCheck.checkTrainerItems');
    const iLegacy = body.indexOf('TrainerCheck.legacyTrainerBackup');
    const iSuite = body.indexOf("data.suite !== 'SuperSuite'");
    const iConfirm = Math.max(body.indexOf('showMessageBox'), body.indexOf('ctx.confirm'));
    // הכתיבה (כספים ומודולים) — רק דרך applyRestore, אחרי הבדיקה והאישור
    const iEcon = body.indexOf('await applyRestore(');
    assert.ok(iLegacy > 0 && iLegacy < iSuite, 'קובץ ישן מומר לפני בדיקת ה-suite');
    assert.ok(iCheck > 0 && iCheck < iConfirm && iConfirm < iEcon, 'הבדיקה לפני האישור ולפני שחזור הכספים');
    assert.ok(!/getDb\(\)\.restore/.test(body.slice(0, iConfirm)), 'שחזור כספים לפני האישור');
    assert.match(body, /restoreItems\(data, id, trainerItems\)/);
    assert.match(src, /id === 'trainer' \? trainerItems/);
  });
}

test('CI: המודול הבנוי נשלח לענף ci-status (הורדת artifact חסומה ב-NetFree)', () => {
  const yml = read('.github', 'workflows', 'build.yml');
  const report = yml.slice(yml.indexOf('\n  report:'));
  assert.match(report, /name: trainer-module\s*\n\s*path: logs\/trainer-module/);
});

test('ניהול סטודיו (9.11): מפתחות המנויים והיומן נשמרים, וערך שאינו רשימה נפסל', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules-src', 'trainer', 'src', 'lib', 'db.js'), 'utf8');
  for (const k of ['studio:plans', 'studio:schedule']) { assert.ok(src.includes("'" + k + "'"), k); assert.ok(isKnownKey(k), k); }
  assert.ok(isKnownKey('memberships:c_1'));
  const bad = { ...good(), 'studio:schedule': JSON.stringify({}) };
  assert.equal(checkTrainerItems(bad).ok, false);
});
