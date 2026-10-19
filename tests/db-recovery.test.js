// מסד נתונים פגום או נעול בעלייה (PLAN.md 2.3): הודעה בעברית ואפשרויות במקום שגיאה טכנית וסגירה,
// שחזור מהגיבוי האוטומטי האחרון, והקובץ הפגום לעולם לא נמחק.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const R = require('../shell/db-recovery');
const { initializeDatabase } = require('../modules/econ/core/database');

const ROOT = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-dbrec-' + p + '-'));

// מסד אמיתי ואז שיבוש של הדפים — כמו נזק בדיסק או כיבוי באמצע כתיבה
async function damagedDb(dir) {
  const db = await initializeDatabase(dir);
  for (let i = 0; i < 2000; i++) await db.audit(null, 'test', 'פרטים ' + i);
  db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.db.close();
  const f = path.join(dir, R.DB_NAME);
  const b = fs.readFileSync(f);
  for (let i = 8192; i < b.length; i += 5) b[i] = 0x55;
  fs.writeFileSync(f, b);
}

test('סיווג השגיאות של SQLite: פגום, לא מסד, נעול — ושגיאה אחרת לא מסווגת', async () => {
  const garbage = tmp('g');
  fs.writeFileSync(path.join(garbage, R.DB_NAME), 'not a database '.repeat(400));
  const e1 = await initializeDatabase(garbage).catch(e => e);
  assert.equal(R.classifyDbError(e1), 'corrupt');

  const mid = tmp('m');
  await damagedDb(mid);
  const e2 = await initializeDatabase(mid).catch(e => e);
  assert.equal(R.classifyDbError(e2), 'corrupt', String(e2 && e2.message));

  const locked = tmp('l');
  const a = await initializeDatabase(locked);
  a.db.exec('BEGIN EXCLUSIVE');
  a.db.exec("INSERT INTO schema_migrations VALUES (999, 'x')");
  const e3 = await initializeDatabase(locked).catch(e => e);
  assert.equal(R.classifyDbError(e3), 'locked');
  a.db.exec('ROLLBACK');
  a.db.close();

  assert.equal(R.classifyDbError(new Error('הנתונים מוצפנים')), null);
  assert.equal(R.classifyDbError(null), null);
});

test('כשל בפתיחה סוגר את הקובץ — אפשר להעביר אותו הצידה גם ב-Windows', async () => {
  const dir = tmp('close');
  await damagedDb(dir);
  await assert.rejects(initializeDatabase(dir));
  const aside = R.setAsideDamaged(dir, 7);
  assert.ok(fs.existsSync(aside), 'הקובץ הפגום נשמר');
  assert.ok(!fs.existsSync(path.join(dir, R.DB_NAME)));
  const fresh = await initializeDatabase(dir);
  assert.deepEqual((await fresh.load()).donors, []);
  fresh.db.close();
});

test('הגיבוי האוטומטי האחרון: לפי התאריך בשם, רק קבצי auto-*.ssbk', () => {
  const dir = tmp('bk');
  assert.equal(R.latestAutoBackup(dir), null);
  for (const n of ['auto-2026-10-01.ssbk', 'auto-2026-10-17.ssbk', 'auto-2026-10-09.ssbk', 'auto-2026-10-30.json', 'other.ssbk']) fs.writeFileSync(path.join(dir, n), 'x');
  assert.deepEqual(R.latestAutoBackup(dir), { file: path.join(dir, 'auto-2026-10-17.ssbk'), day: '2026-10-17' });
  assert.equal(R.latestAutoBackup(path.join(dir, 'missing')), null);
});

test('ההודעה: עברית, שחזור רק כשיש גיבוי, ותמיד תיקיית נתונים, דוח תקלה ויציאה', () => {
  const withBk = R.dialogFor('corrupt', { file: 'x', day: '2026-10-17' });
  assert.deepEqual(withBk.buttons.map(b => b.id), ['restore', 'folder', 'report', 'quit']);
  assert.match(withBk.buttons[0].label, /2026-10-17/);
  assert.match(withBk.detail, /לא נמחק/);
  assert.deepEqual(R.dialogFor('corrupt', null).buttons.map(b => b.id), ['folder', 'report', 'quit']);
  const locked = R.dialogFor('locked', null);
  assert.deepEqual(locked.buttons.map(b => b.id), ['retry', 'folder', 'report', 'quit']);
  assert.match(locked.detail, /מחשב אחר/);
  for (const d of [withBk, locked]) assert.doesNotMatch(d.message + d.detail, /SQLITE|malformed|errcode/i);
});

// main.js האמיתי, בתהליך נפרד, מול מסד פגום וגיבוי אוטומטי אמיתי
const SCRIPT = (userData, plan) => `
const Module = require('module'), path = require('path'), fs = require('fs');
const log = []; const plan = ${JSON.stringify(plan)};
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => k in p ? p[k] : (k === 'then' ? undefined : ch()), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
let ready;
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch() {} }; } }),
    getPath: () => ${JSON.stringify(userData)}, on() {}, exit() {}, quit() { log.push(['quit']); }, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: class { constructor() { this.webContents = ch({ id: 1, isDestroyed: () => false }); this.contentView = { addChildView() {} }; } isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; } on() {} once() {} removeMenu() {} maximize() {} show() {} focus() {} setMenu() {} getNormalBounds() { return this.getContentBounds(); } getContentSize() { return [1000, 800]; } loadFile() {} getContentBounds() { return { x: 0, y: 0, width: 1000, height: 800 }; } getBounds() { return this.getContentBounds(); } },
  WebContentsView: class { constructor() { this.webContents = ch({ id: 9, isDestroyed: () => false, isLoading: () => false }); } setVisible() {} setBounds() {} },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  dialog: { showMessageBox: async (a, b) => { const o = b || a; log.push(['box', o.message, (o.buttons || []).join('|')]); const r = plan.shift(); return { response: r === undefined ? (o.buttons || []).length - 1 : r }; },
    showErrorBox: (t, m) => log.push(['error', t, m]), showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: ch(), net: ch(), session: ch(), shell: ch({ openPath: (p) => log.push(['open', p]) }), Menu: ch(), safeStorage: ss, screen: ch()
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? '/__e__.js' : orig.call(this, r, ...a); };
require.cache['/__e__.js'] = { id: '/__e__.js', filename: '/__e__.js', loaded: true, exports: stub };
global.setTimeout = ((st) => (fn, ms, ...r) => st(fn, ms, ...r).unref())(global.setTimeout);
global.setInterval = ((si) => (fn, ms, ...r) => si(fn, ms, ...r).unref())(global.setInterval);
require(${JSON.stringify(path.join(ROOT, 'main.js'))});
(async () => {
  await ready();
  const econ = require(${JSON.stringify(path.join(ROOT, 'modules', 'econ', 'ipc.js'))});
  let donors = null;
  try { donors = (await econ.getDb().load()).donors.map(d => d.name); } catch {}
  process.stdout.write('RESULT' + JSON.stringify({ log, donors, files: fs.readdirSync(${JSON.stringify(userData)}) }));
})().catch(e => process.stdout.write('RESULT' + JSON.stringify({ log, fatal: String(e && e.stack) })));
`;

function runMain(userData, plan) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT(userData, plan)], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  return JSON.parse(r.stdout.slice(i + 6));
}

// גיבוי אוטומטי אמיתי, מוצפן במפתח שנשמר ב-"DPAPI" המדומה
function seedBackup(userData, donorName) {
  const BK = require('../modules/econ/core/backupCrypto');
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(path.join(userData, 'autobackup.key'), Buffer.from('K:' + key));
  const bkDir = path.join(userData, 'bk');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
  const out = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: donorName }] }, localStorage: {} };
  fs.writeFileSync(path.join(bkDir, 'auto-2026-10-17.ssbk'), BK.encryptBackup(JSON.stringify(out), key));
}

test('main.js: מסד פגום + גיבוי ← "שחזור" מחזיר את הנתונים, והפגום נשמר בצד', async () => {
  const userData = tmp('main-restore');
  await damagedDb(userData);
  seedBackup(userData, 'אהרן לוי');
  const res = runMain(userData, [0, 0]);
  assert.ok(!res.fatal, res.fatal);
  const box = res.log.find(l => l[0] === 'box');
  assert.equal(box[1], 'קובץ הנתונים פגום ולא ניתן לפתוח אותו');
  assert.match(box[2], /שחזור מהגיבוי האוטומטי \(2026-10-17\)/);
  assert.ok(!res.log.some(l => l[0] === 'error'), 'אין שגיאה טכנית: ' + JSON.stringify(res.log));
  assert.ok(!res.log.some(l => l[0] === 'quit'), 'התוכנה לא נסגרה');
  assert.deepEqual(res.donors, ['אהרן לוי']);
  assert.ok(res.files.some(f => f.startsWith(R.DB_NAME + '.damaged-')), 'הקובץ הפגום נשמר: ' + res.files);
});

test('main.js: מסד פגום בלי גיבוי ← "תיקיית הנתונים" ואז יציאה; לא נמחק דבר', async () => {
  const userData = tmp('main-nobk');
  await damagedDb(userData);
  const before = fs.readFileSync(path.join(userData, R.DB_NAME));
  const res = runMain(userData, [0, 2]);
  assert.ok(!res.fatal, res.fatal);
  const boxes = res.log.filter(l => l[0] === 'box');
  assert.equal(boxes.length, 2, 'אחרי פתיחת התיקייה ההודעה חוזרת');
  assert.doesNotMatch(boxes[0][2], /שחזור/);
  assert.deepEqual(res.log.find(l => l[0] === 'open'), ['open', userData]);
  assert.ok(res.log.some(l => l[0] === 'quit'));
  assert.ok(!res.log.some(l => l[0] === 'error'), 'אין שגיאה טכנית');
  assert.deepEqual(fs.readFileSync(path.join(userData, R.DB_NAME)), before, 'המסד הפגום לא השתנה');
});

test('main.js: גיבוי שלא נפתח (מפתח אחר) ← הודעה, והמסד הפגום נשאר במקומו', async () => {
  const userData = tmp('main-badkey');
  await damagedDb(userData);
  seedBackup(userData, 'אהרן לוי');
  fs.writeFileSync(path.join(userData, 'autobackup.key'), Buffer.from('K:' + crypto.randomBytes(32).toString('base64')));
  const res = runMain(userData, [0]);
  assert.ok(!res.fatal, res.fatal);
  const err = res.log.find(l => l[0] === 'error');
  assert.equal(err && err[1], 'השחזור לא הצליח');
  assert.ok(fs.existsSync(path.join(userData, R.DB_NAME)), 'המסד הפגום לא הוזז');
  assert.ok(!res.files.some(f => f.includes('.damaged-')));
});
