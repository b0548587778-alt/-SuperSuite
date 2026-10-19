// הלקוח לא רואה קוד (PLAN.md 3.5): כלי מפתחים חסומים בגרסת הפצה, מתגי Electron, כיווץ קוד ובדיקת עלייה.
// הבדיקות כאן רצות על הקוד המקורי. הגרסה הארוזה והמכווצת נבדקת ב-CI (tools/smoke-packaged.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CG = require('../shell/code-guard');
const Smoke = require('../shell/smoke');
const MIN = require('../tools/minify');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('מתגי Electron: בלי הרצה כ-Node ובלי דיבוג, עם בדיקת שלמות של app.asar', () => {
  assert.deepEqual(pkg.build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  });
  // הארכיון לא כבוי ובדיקת השלמות לא מבוטלת
  assert.notEqual(pkg.build.asar, false);
  assert.notEqual(pkg.build.disableAsarIntegrity, true);
});

test('devTools כבוי בגרסת הפצה ופתוח בפיתוח', () => {
  assert.equal(CG.guardPrefs({ sandbox: true }, true).devTools, false);
  assert.equal(CG.guardPrefs({ sandbox: true }, false).devTools, undefined);
  assert.equal(CG.guardPrefs({ sandbox: true }, true).sandbox, true, 'שאר ההגדרות נשמרות');
});

test('כלי מפתחים שנפתחו בכל זאת — נסגרים מיד (רק בגרסת הפצה)', () => {
  const make = () => { const h = {}; return { h, closed: 0, on(ev, fn) { h[ev] = fn; }, closeDevTools() { this.closed++; } }; };
  const wc = make();
  CG.wireDevToolsGuard(wc, true);
  wc.h['devtools-opened']();
  assert.equal(wc.closed, 1);
  const dev = make();
  CG.wireDevToolsGuard(dev, false);
  assert.equal(dev.h['devtools-opened'], undefined);
});

test('פרמטר דיבוג בגרסת הפצה ← לא עולה; בפיתוח ← עולה', () => {
  for (const a of ['--remote-debugging-port=9222', '--inspect', '--inspect=9229', '--inspect-brk', '--remote-debugging-pipe', '--js-flags=--expose-gc']) {
    assert.ok(CG.startupCheck({ argv: ['SuperSuite.exe', a], packaged: true }), a);
    assert.equal(CG.startupCheck({ argv: ['SuperSuite.exe', a], packaged: false }), null, a);
  }
  assert.equal(CG.startupCheck({ argv: ['SuperSuite.exe', '--smoke', '--lang=he'], packaged: true }), null);
  assert.equal(CG.startupCheck({ argv: ['SuperSuite.exe'], packaged: true, hasSwitch: (s) => s === 'remote-debugging-port' }), 'remote-debugging-port');
  // נתיב קובץ שמכיל את המילה — לא פרמטר
  assert.equal(CG.startupCheck({ argv: ['C:\\inspect\\SuperSuite.exe'], packaged: true }), null);
});

test('main.js: כל חלון ותצוגה עוברים דרך guardPrefs, והבדיקה בעלייה לפני כל דבר אחר', () => {
  const src = read('main.js');
  const prefs = src.match(/webPreferences:\s*[^\n]+/g);
  assert.ok(prefs.length >= 3);
  for (const p of prefs) assert.match(p, /CodeGuard\.guardPrefs\(/, p);
  assert.ok(src.indexOf('CodeGuard.startupCheck') < src.indexOf('app.requestSingleInstanceLock()'));
  assert.match(src, /CodeGuard\.wireDevToolsGuard\(wc, app\.isPackaged\)/);
  assert.match(src, /CodeGuard\.wireDevToolsGuard\(win\.webContents, app\.isPackaged\)/);
  // חלונות ה-PDF הנסתרים ב-ipc.js
  const ipc = read('modules', 'econ', 'ipc.js');
  for (const w of ipc.match(/new BrowserWindow\(\{[^\n]+/g)) assert.match(w, /devTools: !\(require\('electron'\)\.app && require\('electron'\)\.app\.isPackaged\)/, w);
});

// ---------- כיווץ ----------
test('כיווץ: קבצים גלובליים (ui/*.js, המעטפת, שמאות, כלים) — רק רווחים; השאר — מלא; האימונים — לא', () => {
  assert.equal(MIN.modeFor('modules/econ/ui/core.js'), 'whitespace');
  assert.equal(MIN.modeFor('shell/shell.js'), 'whitespace');
  assert.equal(MIN.modeFor('shell/catalog.js'), 'whitespace');
  assert.equal(MIN.modeFor('modules/tools/app.js'), 'whitespace');
  assert.equal(MIN.modeFor('modules/shamai/app.js'), 'whitespace');
  assert.equal(MIN.modeFor('main.js'), 'full');
  assert.equal(MIN.modeFor('modules/econ/ipc.js'), 'full');
  assert.equal(MIN.modeFor('modules/econ/core/database.js'), 'full');
  assert.equal(MIN.modeFor('modules/trainer/assets/index-X.js'), null);
  assert.equal(MIN.modeFor('modules/trainer/preload.js'), 'full');
  assert.equal(MIN.modeFor('modules/shamai/sw.js'), null);
  assert.equal(MIN.modeFor('shell/shell.html'), null);
  assert.equal(MIN.optionsFor('whitespace').minifyIdentifiers, false);
  assert.equal(MIN.optionsFor('full').minifyIdentifiers, true);
  for (const m of ['full', 'whitespace']) assert.equal(MIN.optionsFor(m).format, undefined, 'בלי format — השמות ברמה העליונה נשמרים');
});

test('כיווץ: כל קבצי ה-JS בבנייה מסווגים, וכל קובץ ב-ui/*.js של המודול הכלכלי — רק רווחים', () => {
  const files = MIN.buildFiles(pkg).map(f => path.relative(ROOT, f));
  const ui = files.filter(f => /^modules[\\/]econ[\\/]ui[\\/].+\.js$/.test(f));
  assert.ok(ui.length > 5);
  for (const f of ui) assert.equal(MIN.modeFor(f), 'whitespace', f);
  assert.ok(files.some(f => f === 'main.js'));
});

test('כיווץ: לא רץ מחוץ ל-CI (משנה קבצים במקום)', async () => {
  await assert.rejects(MIN.run({ env: {}, esbuild: {}, files: [] }), /CI/);
});

test('כיווץ: כישלון בקובץ אחד ← שום קובץ לא נכתב', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-min-'));
  // קבצים בתיקייה זמנית מחוץ לפרויקט — modeFor מקבל נתיב יחסי עם ../ ולכן 'full'
  const a = path.join(dir, 'a.js'); const b = path.join(dir, 'b.js');
  fs.writeFileSync(a, 'const x = 1;'); fs.writeFileSync(b, 'const y = 2;');
  let calls = 0;
  const esbuild = { transform: async (src) => { if (++calls === 2) throw new Error('syntax'); return { code: 'MIN' }; } };
  await assert.rejects(MIN.run({ env: { CI: 'true' }, esbuild, files: [a, b], log: () => {} }), /הכיווץ נכשל/);
  assert.equal(fs.readFileSync(a, 'utf8'), 'const x = 1;');
  assert.equal(fs.readFileSync(b, 'utf8'), 'const y = 2;');
});

test('CI: כיווץ לפני electron-builder, ובדיקת עלייה של הגרסה הארוזה אחריו', () => {
  const yml = read('.github', 'workflows', 'build.yml');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const iMin = build.indexOf('node tools/minify.js');
  const iEb = build.indexOf('npx electron-builder');
  const iSmoke = build.indexOf('node tools/smoke-packaged.js');
  const iUpload = build.indexOf('name: SuperSuite-Windows');
  assert.ok(iMin > 0 && iMin < iEb && iEb < iSmoke && iSmoke < iUpload);
  // הבדיקות הרגילות רצות על הקוד המקורי (משימת trainer), לא אחרי הכיווץ
  const trainer = yml.slice(yml.indexOf('\n  trainer:'), yml.indexOf('\n  build:'));
  assert.match(trainer, /npm test/);
  assert.ok(!/minify/.test(trainer));
});

// ---------- בדיקת עלייה ----------
function fakeSmoke() {
  const files = {};
  const dialog = {};
  let exitCode = null;
  const timers = [];
  const s = Smoke.createSmoke({ fs: { writeFileSync: (f, t) => { files[path.basename(f)] = JSON.parse(t); } }, path, dir: '/x', dialog,
    exit: (c) => { exitCode = c; }, setTimer: (fn) => { timers.push(fn); return {}; } });
  const wc = () => { const h = {}; return { h, on(ev, fn) { h[ev] = fn; } }; };
  return { s, files, dialog, wc, timers, code: () => exitCode };
}

test('smoke: הכול נטען בלי שגיאות ← יציאה 0 ו-smoke.json', async () => {
  const f = fakeSmoke();
  const views = { shell: f.wc(), econ: f.wc() };
  for (const [k, v] of Object.entries(views)) f.s.watch(k, v);
  const p = f.s.run((id) => views[id], ['shell', 'econ'], async () => {});
  await new Promise(r => setImmediate(r));
  f.timers.at(-1)(); // סוף זמן ההמתנה
  await p;
  assert.equal(f.code(), 0);
  assert.deepEqual(f.files['smoke.json'].loaded, ['shell', 'econ']);
  assert.equal(f.files['smoke.json'].ok, true);
});

test('smoke: שגיאת JS, preload או חלון הודעה ← יציאה 1 עם הפירוט', async () => {
  const f = fakeSmoke();
  const v = f.wc();
  f.s.watch('econ', v);
  v.h['console-message']({ level: 'error', message: 'ReferenceError: x is not defined' });
  v.h['preload-error']({}, 'preload.js', new Error('boom'));
  v.h['console-message']({ level: 'info', message: 'רגיל' });
  f.dialog.showErrorBox('שגיאה', 'משהו');
  const r = await f.dialog.showMessageBox({}, { message: 'שאלה', cancelId: 1 });
  assert.equal(r.response, 1, 'חלון הודעה לא נפתח — מוחזר ביטול');
  const p = f.s.run(() => v, ['econ'], async () => {});
  await new Promise(r2 => setImmediate(r2));
  f.timers.at(-1)();
  await p;
  assert.equal(f.code(), 1);
  const where = f.files['smoke.json'].errors.map(e => e.where);
  assert.deepEqual(where, ['console:econ', 'preload:econ', 'dialog', 'dialog']);
});

test('smoke: מופעל רק עם --smoke, ורק עם תיקיית נתונים נפרדת', () => {
  assert.equal(Smoke.isSmoke(['SuperSuite.exe']), false);
  assert.equal(Smoke.isSmoke(['SuperSuite.exe', '--smoke']), true);
  const src = read('main.js');
  assert.match(src, /process\.argv\.some\(a => a\.startsWith\('--user-data-dir='\)\)/);
  // בבדיקה אין גיבוי אוטומטי (כותב לתיקיית המסמכים האמיתית)
  const at = src.indexOf('smoke.run(');
  assert.ok(at > 0);
  const tail = src.slice(at);
  assert.ok(tail.indexOf('return;') < tail.indexOf('setTimeout(autoBackup'));
});
