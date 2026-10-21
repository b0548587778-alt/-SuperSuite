// כניסה חובה (PLAN.md 3.3): בלי כניסה אף ערוץ לא מחזיר נתונים.
// 1. המודול הכלכלי: כל ערוץ שנרשם (חוץ מערוצי הכניסה הציבוריים) נכשל ב"נדרשת כניסה" — נבדק אוטומטית לכל ערוץ, גם חדש.
// 2. main.js: ערוצי המעטפת והמחסן המוצפן של שמאות ואימונים לא מחזירים נתונים בלי כניסה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_login__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_login__.js'] = { id: '/__electron_stub_login__.js', filename: '/__electron_stub_login__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } } };

const ipc = require('../modules/econ/ipc');
const PUBLIC = ['auth:status', 'auth:setup', 'auth:login', 'auth:logout', 'auth:google-login'];

test('כל ערוץ של המודול הכלכלי (חוץ מערוצי הכניסה) נכשל בלי כניסה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-login-'));
  await ipc.initEcon(dir, { googleSignIn: async () => { throw new Error('לא אמור להגיע לדפדפן'); }, openExternal: async () => {} });
  const channels = Object.keys(handlers).filter(ch => !PUBLIC.includes(ch));
  assert.ok(channels.length > 200, 'נמצאו כל הערוצים (' + channels.length + ')');
  const leaked = [];
  for (const ch of channels) {
    try {
      const r = await handlers[ch]({ sender: { id: 4242 } }, {}, {}, {});
      leaked.push(`${ch} → ${JSON.stringify(r).slice(0, 60)}`);
    } catch (e) {
      // ערוץ Google נעצר לפני הדפדפן (המדיניות כבויה) — גם זה לא חשיפה. כל השאר: "נדרשת כניסה"
      if (!/נדרשת כניסה/.test(e.message) && !/Google/.test(e.message)) leaked.push(`${ch} → ${e.message}`);
    }
  }
  assert.deepEqual(leaked, [], 'ערוצים שלא דרשו כניסה');
  assert.equal(ipc.isLoggedIn(), false);
});

test('ערוצי הכניסה הציבוריים לא מחזירים נתונים עסקיים', async () => {
  const st = await handlers['auth:status']({ sender: { id: 4243 } });
  const allowed = new Set(['configured', 'user', 'google']);
  for (const k of Object.keys(st)) assert.ok(allowed.has(k), 'מפתח לא צפוי ב-auth:status: ' + k);
  assert.equal(st.user ?? null, null);
  assert.deepEqual(Object.keys(st.google), ['enabled'], 'רק האם Google מופעל — בלי מזהה לקוח');
});

// main.js: הבדיקות על הקוד — הרצת main.js המלא נבדקת ב-main-behavior
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const handlerBody = (ch) => {
  const i = MAIN.search(new RegExp(`ipcMain\\.(handle|on)\\('${ch.replace(/[:]/g, '\\$&')}'`));
  assert.ok(i >= 0, ch);
  return MAIN.slice(i, i + 700);
};

test('main.js: מחסן השמאות והאימונים — בלי כניסה אין נתונים ואין כתיבה', () => {
  const load = handlerBody('secure-store:load');
  assert.match(load, /!econSessionAlive\(\)\) \{ e\.returnValue = \{ state: 'no-session', migrated: true, data: \{\} \}/);
  const write = handlerBody('secure-store:write');
  assert.match(write, /!fromModuleView\(e, mod\) \|\| !econSessionAlive\(\)\) return/);
});

test('main.js: ערוצי המעטפת שמחזירים נתונים או מגבים — רק עם כניסה', () => {
  assert.match(handlerBody('shell:backup-all'), /shellGuard\(e, 'data\.backup'\)/);
  assert.match(handlerBody('shell:restore-all'), /shellGuard\(e, 'data\.restore'\)/);
  assert.match(handlerBody('shell:get-recovery-code'), /shellGuard\(e, 'data\.backup'\)/);
  assert.match(handlerBody('shell:get-backup-target'), /if \(!econLoggedIn\(\)\) return null/);
  assert.match(handlerBody('shell:get-backup-status'), /if \(!econLoggedIn\(\)\) return null/);
});

test('main.js: גיבוי קורא את המחסן ישירות, ומודולים נעולים נטענים מחדש בכניסה וביציאה', () => {
  const collect = MAIN.slice(MAIN.indexOf('async function collectBackup'), MAIN.indexOf('// ensureView יוצר תצוגות'));
  // המחסן נקרא ישירות; מחסן נעול — שגיאה ולא גיבוי ריק (tests/backup-locked-store.test.js)
  assert.match(collect, /const s = secureStore\(id\);[\s\S]*?s\.snapshot\(\)/);
  const fn = MAIN.slice(MAIN.indexOf('function reloadLockedViewsOnSessionChange'), MAIN.indexOf('function onEconAuthChange() {'));
  assert.match(fn, /LoginGate\.LOCKED_MODS/);
  assert.match(fn, /webContents\.reload\(\)/);
  assert.match(MAIN, /function onEconAuthChange\(\) \{\s*reloadLockedViewsOnSessionChange\(\);/);
  assert.match(MAIN, /setInterval\(\(\) => \{ reloadLockedViewsOnSessionChange\(\);/, 'גם ניתוק שקט אחרי חוסר פעילות');
  assert.ok(fn.includes("views.econ.webContents.send('econ:auth-check')"), 'המסך הכלכלי עובר למסך הכניסה בניתוק');
  const core = fs.readFileSync(path.join(ROOT, 'modules', 'econ', 'ui', 'core.js'), 'utf8');
  assert.ok(core.includes("elements.view.innerHTML = ''"), 'הנתונים שעל המסך מוסתרים');
});

test('מסך הבית: "אחרונים" וחיפוש מציגים רק שמות מסכים מהקטלוג, לא נתונים', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'shell', 'shell.js'), 'utf8');
  assert.match(shell, /filter\(k => BY_KEY\.has\(k\)\)/, 'אחרונים — רק מפתחות קטלוג');
  assert.doesNotMatch(shell, /systemAPI|getMorningBrief|people:/, 'המעטפת לא קוראת נתונים עסקיים');
});
