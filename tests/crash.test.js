// רשת ביטחון לקריסות ויומן תקלות (PLAN.md 2.1–2.2): shell/crash.js, shell/logger.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createLogger, redact } = require('../shell/logger');
const { createCrashGuard } = require('../shell/crash');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-crash-'));

// dialog מדומה: מתעד מה הוצג, ועונה לפי התור (אינדקס הכפתור)
function fakeDialog(answers = []) {
  const shown = [];
  return {
    shown,
    async showMessageBox(_w, opts) { shown.push(opts); return { response: answers.length ? answers.shift() : 0 }; },
    async showSaveDialog() { return this.savePlan || { canceled: true }; },
  };
}
const fakeApp = () => ({ relaunched: 0, exited: null, relaunch() { this.relaunched++; }, exit(c) { this.exited = c; } });

test('redact: ת"ז, טלפון, דוא"ל ונתיב המשתמש לא נכתבים ליומן', () => {
  const out = redact('שגיאה אצל משה כהן ת"ז 123456782 טל 052-1234567 / 03-6123456 / +972 52 123 4567 moshe@example.org C:\\Users\\bunim seller\\AppData\\x.db', { home: 'C:\\Users\\B0548' });
  assert.doesNotMatch(out, /123456782|1234567|6123456|moshe@example\.org|bunim seller/);
  assert.match(out, /<id>/);
  assert.match(out, /<phone>/);
  assert.match(out, /<email>/);
  assert.match(out, /C:\\Users\\<user>/);
  // מספרים קצרים (שורה, קוד שגיאה) נשארים
  assert.match(redact('at app.js:1234 code 500'), /1234.*500/);
});

test('logger: כותב שורה עם רמה ומקור, מחליף קובץ כשהוא גדל ושומר עד 3 ישנים', () => {
  const dir = tmp();
  const log = createLogger({ dir, maxBytes: 300, home: dir });
  log.error('main', new Error('boom'));
  const first = fs.readFileSync(path.join(dir, 'crash.log'), 'utf8');
  assert.match(first, /\[error\] \[main\] Error: boom/);
  for (let i = 0; i < 40; i++) log.warn('x', 'line ' + 'z'.repeat(50) + i);
  const files = fs.readdirSync(dir).sort();
  assert.ok(files.includes('crash.1.log'), 'נוצר קובץ קודם');
  assert.ok(!files.includes('crash.4.log'), 'לא יותר מ-3 קבצים ישנים');
  assert.ok(fs.statSync(path.join(dir, 'crash.log')).size < 600, 'הקובץ הנוכחי לא גדל ללא גבול');
});

test('logger: תיקייה שאי אפשר לכתוב אליה — לא זורק', () => {
  const file = path.join(tmp(), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const log = createLogger({ dir: file });
  assert.doesNotThrow(() => log.error('main', new Error('x')));
});

test('logger.report: גרסה, מערכת ויומן — בלי מידע אישי', () => {
  const dir = tmp();
  const log = createLogger({ dir, home: dir });
  log.error('econ', new Error('SQLITE_BUSY אצל 0521234567'));
  const r = log.report({ version: '3.10.0' });
  assert.match(r, /דוח תקלה/);
  assert.match(r, /גרסה: 3\.10\.0/);
  assert.match(r, /SQLITE_BUSY/);
  assert.doesNotMatch(r, /0521234567/);
});

test('שגיאה שלא נתפסה: נרשמת ביומן ומוצגת הודעה בעברית — והתוכנה לא נסגרת', async () => {
  const dir = tmp();
  const logger = createLogger({ dir });
  const dialog = fakeDialog([0]);
  const app = fakeApp();
  const guard = createCrashGuard({ logger, dialog, app, getWin: () => null, version: '1' });
  const proc = new EventEmitter();
  guard.installProcessHandlers(proc);
  proc.emit('uncaughtException', new Error('TypeError: x is undefined'));
  await new Promise(r => setImmediate(r));
  assert.equal(dialog.shown.length, 1);
  assert.match(dialog.shown[0].message, /תקלה בלתי צפויה/);
  assert.match(dialog.shown[0].detail, /הנתונים שמורים/);
  assert.deepEqual(dialog.shown[0].buttons, ['המשך לעבוד', 'שמירת דוח תקלה', 'הפעלה מחדש']);
  assert.equal(app.exited, null, '"המשך לעבוד" לא סוגר את התוכנה');
  assert.match(fs.readFileSync(logger.file(), 'utf8'), /\[main\].*x is undefined/);
});

test('"הפעלה מחדש" מפעילה את התוכנה מחדש', async () => {
  const app = fakeApp();
  const guard = createCrashGuard({ logger: createLogger({ dir: tmp() }), dialog: fakeDialog([2]), app, getWin: () => null });
  await guard.onUncaught(new Error('x'));
  assert.equal(app.relaunched, 1);
  assert.equal(app.exited, 0);
});

test('הודעות לא נערמות: תקלה שנייה בזמן שדיאלוג פתוח — ליומן בלבד', async () => {
  const logger = createLogger({ dir: tmp() });
  let release;
  const dialog = { shown: [], showMessageBox(_w, o) { this.shown.push(o); return new Promise(r => { release = () => r({ response: 0 }); }); } };
  const guard = createCrashGuard({ logger, dialog, app: fakeApp(), getWin: () => null });
  const first = guard.onUncaught(new Error('a'));
  assert.equal(await guard.onUncaught(new Error('b')), null);
  assert.equal(dialog.shown.length, 1);
  release(); await first;
  assert.equal(guard.isBusy(), false);
  assert.match(fs.readFileSync(logger.file(), 'utf8'), /Error: b/);
});

test('דחייה שלא טופלה: ליומן בלבד, בלי דיאלוג', () => {
  const logger = createLogger({ dir: tmp() });
  const dialog = fakeDialog();
  createCrashGuard({ logger, dialog, app: fakeApp(), getWin: () => null }).onRejection(new Error('fetch failed'));
  assert.equal(dialog.shown.length, 0);
  assert.match(fs.readFileSync(logger.file(), 'utf8'), /\[warn\].*fetch failed/);
});

test('מסך שקרס: הודעה עם שם המודול, וטעינה מחדש של המסך בלבד', async () => {
  const logger = createLogger({ dir: tmp() });
  const dialog = fakeDialog([0]);
  const guard = createCrashGuard({ logger, dialog, app: fakeApp(), getWin: () => null });
  const wc = new EventEmitter();
  let reloads = 0;
  guard.wireContents('shamai', wc, () => { reloads++; });
  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 });
  await new Promise(r => setImmediate(r));
  assert.match(dialog.shown[0].message, /השמאות נסגר בגלל תקלה/);
  assert.equal(reloads, 1);
  // יציאה רגילה (סגירת התוכנה) — אינה תקלה
  wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  await new Promise(r => setImmediate(r));
  assert.equal(dialog.shown.length, 1);
});

test('מסך שאינו מגיב: "המתנה" לא טוענת מחדש, "טעינה מחדש" כן', async () => {
  const dialog = fakeDialog([0, 1]);
  const guard = createCrashGuard({ logger: createLogger({ dir: tmp() }), dialog, app: fakeApp(), getWin: () => null });
  let reloads = 0;
  await guard.onUnresponsive('econ', () => { reloads++; });
  assert.equal(reloads, 0);
  assert.match(dialog.shown[0].message, /המערכת הכלכלית אינו מגיב/);
  await guard.onUnresponsive('econ', () => { reloads++; });
  assert.equal(reloads, 1);
});

test('שגיאת JavaScript במסך נרשמת ביומן (גם בפורמט החדש של Electron)', () => {
  const logger = createLogger({ dir: tmp() });
  const guard = createCrashGuard({ logger, dialog: fakeDialog(), app: fakeApp(), getWin: () => null });
  const wc = new EventEmitter();
  guard.wireContents('tools', wc, () => {});
  wc.emit('console-message', { level: 'error', message: 'ReferenceError: foo', sourceId: 'app://tools/app.js', lineNumber: 7 });
  wc.emit('console-message', {}, 3, 'TypeError: bar', 9, 'app://tools/calc.js');
  wc.emit('console-message', { level: 'info', message: 'רגיל' });
  const text = fs.readFileSync(logger.file(), 'utf8');
  assert.match(text, /\[render:tools\] ReferenceError: foo \(app:\/\/tools\/app\.js:7\)/);
  assert.match(text, /TypeError: bar/);
  assert.doesNotMatch(text, /רגיל/);
});

test('דוח תקלה נשמר לקובץ שהמשתמש בחר — היומן בלבד', async () => {
  const dir = tmp();
  const logger = createLogger({ dir, home: dir });
  logger.error('main', new Error('boom'));
  const dialog = fakeDialog();
  dialog.savePlan = { canceled: false, filePath: path.join(dir, 'report.txt') };
  const guard = createCrashGuard({ logger, dialog, app: fakeApp(), getWin: () => null, version: '3.10.0' });
  assert.equal(await guard.saveReport(), true);
  const text = fs.readFileSync(path.join(dir, 'report.txt'), 'utf8');
  assert.match(text, /גרסה: 3\.10\.0/);
  assert.match(text, /boom/);
  dialog.savePlan = { canceled: true };
  assert.equal(await guard.saveReport(), false);
});

test('main.js מחבר את רשת הביטחון: תהליך, כל מסך, ודוח תקלה למעטפת בלבד', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(src, /crash\.installProcessHandlers\(\)/);
  assert.match(src, /function wireView[\s\S]*?crash\.wireContents\(id, wc/);
  assert.match(src, /crash\.wireContents\('shell', win\.webContents/);
  assert.match(src, /'shell:save-crash-report', \(e\) => \{\s*if \(!win \|\| e\.sender\.id !== win\.webContents\.id\) return false;/);
  assert.match(src, /econ\.setErrorLogger/);
  assert.doesNotMatch(src, /console\.error/, 'שגיאות בתהליך הראשי נכתבות ליומן');
});
