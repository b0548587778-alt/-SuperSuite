// בדיקת קוד 23.10.2026, ממצאים 3 ו-24 — מודול האימונים: ה-localStorage המוצפן זורק כשכתיבה נדחתה (צפייה בלבד, הכניסה
// פגה, רישיון, אין מקום, הדיסק נכשל). פעם lib/storage.js הציג הודעה רק ב"אחסון מלא" (והפנה לייצוא שהוסר), וכל השאר
// נבלע: המסך הציג מתאמן, תוכנית או מדידה שנעלמו בטעינה הבאה. עכשיו — הסיבה בעברית, S.set / S.del מחזירים false,
// והמסכים לא מתעדכנים בלי שמירה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// localStorage של SuperSuite שדוחה כתיבה, וחלון הודעה שנרשם
console.error = () => {}; // lib/storage.js רושם כל כישלון ליומן המסוף
const alerts = [];
let reject = null;
const mem = new Map();
global.window = { ssDialog: { alert: (m) => { alerts.push(m); return new Promise((r) => setTimeout(r, 20)); } } };
global.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (reject) throw new DOMException(reject.message, reject.name); mem.set(k, String(v)); },
  removeItem: (k) => { if (reject) throw new DOMException(reject.message, reject.name); mem.delete(k); },
  clear: () => { if (reject) throw new DOMException(reject.message, reject.name); mem.clear(); },
};
let S, K, St;
test.before(async () => {
  St = await import(pathToFileURL(path.join(SRC, 'lib', 'storage.js')).href);
  ({ S, K } = await import(pathToFileURL(path.join(SRC, 'lib', 'db.js')).href));
});
const settle = () => new Promise((r) => setTimeout(r, 40));

test('שמירה שנדחתה (צפייה בלבד) — S.set ו-S.del מחזירים false, והסיבה בעברית מוצגת פעם אחת', async () => {
  assert.equal(await S.set(K.trainer, { name: 'משה' }), true);
  assert.equal(await S.del(K.program('c1')), true, 'מחיקה של מפתח שלא קיים — מאושרת');
  reject = { message: 'השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד', name: 'SecurityError' };
  try {
    assert.equal(await S.set(K.trainer, { name: 'זדוני' }), false);
    assert.equal(await S.del(K.trainer), false);
    assert.equal(await S.set(K.clientIndex, ['x']), false);
  } finally { reject = null; }
  await settle();
  assert.deepEqual(alerts, ['השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד'], 'הודעה אחת לכמה כישלונות ברצף');
  assert.deepEqual(await S.get(K.trainer), { name: 'משה' }, 'הנתון לא השתנה');
});

test('אין מקום — הודעה בלי ההפניה לייצוא שהוסר מהמודול; שגיאה באנגלית לא מוצגת למשתמש', async () => {
  alerts.length = 0;
  reject = { message: 'The quota has been exceeded.', name: 'QuotaExceededError' };
  try { assert.equal(await S.set(K.sessions('c1'), [1]), false); } finally { reject = null; }
  await settle();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^השינוי לא נשמר: אין מקום באחסון/);
  assert.doesNotMatch(alerts[0], /ייצא|לייצא|גיבוי/);
  assert.equal(St.saveErrorText(new Error('boom')), 'השינוי לא נשמר');
  assert.equal(St.saveErrorText(new DOMException('השינוי לא נשמר: הכניסה למערכת פגה — יש להיכנס שוב', 'SecurityError')), 'השינוי לא נשמר: הכניסה למערכת פגה — יש להיכנס שוב');
});

test('המסכים לא מתעדכנים כשהשמירה נכשלה (מתאמן, תוכנית, אימון, מדידה, הערכה, הגדרות, מחיקה)', () => {
  const app = read('App.jsx');
  assert.match(app, /const saveTrainer = async \(t\) => \{\s*if \(!\(await S\.set\(K\.trainer, t\)\)\) return false;\s*setTrainer\(t\);/);
  assert.match(app, /const saveClient = async \(c\) => \{\s*if \(!\(await S\.set\(K\.client\(c\.id\), c\)\)\) return false;/);
  assert.match(app, /if \(!\(await S\.set\(K\.clientIndex, idx\)\)\) return false;/);
  // מחיקה: קודם מהרשימה, ורק אם נשמר — מהמסך
  const del = app.slice(app.indexOf('const deleteClient'), app.indexOf('if (loading)'));
  assert.match(del, /if \(!\(await S\.set\(K\.clientIndex, idx\.filter\(\(i\) => i !== id\)\)\)\) return false;\s*setClients/);
  assert.match(app, /onSave=\{async \(t\) => \{ if \(await saveTrainer\(t\)\) setView/);
  assert.match(app, /onSave=\{async \(c\) => \{ if \(await saveClient\(c\)\) setView/);
  const clients = read('features/clients.jsx');
  assert.match(clients, /if \(!\(await S\.set\(K\.program\(client\.id\), newProgram\)\)\) return;\s*setProgram\(newProgram\)/);
  assert.match(clients, /if \(!\(await S\.set\(K\.program\(client\.id\), p\)\)\) return false;\s*setProgram\(p\)/);
  assert.match(clients, /if \(!\(await S\.set\(K\.sessions\(client\.id\), newSess\)\)\) return false;\s*setSessions\(newSess\)/);
  assert.match(clients, /if \(!\(await S\.set\(K\.measurements\(client\.id\), newM\)\)\) return false;\s*setMeasurements\(newM\)/);
  assert.match(clients, /if \(await saveClient\(updated\)\) setClient\(updated\)/);
  assert.match(clients, /if \(await saveClient\(c\)\) \{ setEditing\(false\); reload\(\); \}/);
  assert.match(clients, /&& await onDelete\(client\.id\)\) setView\(\{ name: 'clients' \}\)/);
  assert.match(clients, /if \(!\(await onAdd\(m\)\)\) return;\s*setForm/, 'מדידה שלא נשמרה — הטופס נשאר מלא');
  assert.match(read('features/program.jsx'), /if \(await onLogSession\(logOpen, logNotes\)\) setLogOpen\(null\)/);
  assert.match(read('features/tools.jsx'), /if \(!\(await S\.set\(`assessments:\$\{client\.id\}`, newHistory\)\)\) return;\s*setHistory/);
  const home = read('features/home.jsx');
  assert.match(home, /if \(!\(await onSave\(d\)\)\) return;\s*setSaved\(true\)/);
  assert.match(home, /try \{ localStorage\.clear\(\); \} catch \(e\) \{ showMessage\(saveErrorText\(e\)\); return; \}/, 'מחיקת הכול אצל צופה — הודעה, לא "משהו השתבש"');
  // בלי שתי הודעות ברצף: הסיבה מ-lib/storage.js, וההודעה הכללית של המסך דרך אותו showSaveError
  assert.match(read('studio.jsx'), /showSaveError\('השמירה נכשלה/);
  assert.doesNotMatch(read('lib/storage.js'), /לייצא גיבוי/);
});
