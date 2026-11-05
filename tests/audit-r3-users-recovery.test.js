// סקירת קוד 2.11.2026 — התאוששות ממסד פגום (main.js → recoverDatabase): המשתמשים, התפקידים ויומן הפעולות חוזרים
// מהגיבוי האוטומטי; גיבוי ישן בלעדיהם ← המסד מסומן, ויצירת מנהל דורשת את קוד השחזור (לא "הראשון שמגיע נעשה מנהל")
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
const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3rec-' + p + '-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

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

const SCRIPT = (userData) => `
const Module = require('module'), path = require('path');
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => k in p ? p[k] : (k === 'then' ? undefined : ch()), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
let ready;
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch() {} }; } }),
    getPath: () => ${JSON.stringify(userData)}, on() {}, exit() {}, quit() {}, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: class { constructor() { this.webContents = ch({ id: 1, isDestroyed: () => false }); this.contentView = { addChildView() {} }; } isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; } on() {} once() {} removeMenu() {} maximize() {} show() {} focus() {} setMenu() {} getNormalBounds() { return this.getContentBounds(); } getContentSize() { return [1000, 800]; } loadFile() {} getContentBounds() { return { x: 0, y: 0, width: 1000, height: 800 }; } getBounds() { return this.getContentBounds(); } },
  WebContentsView: class { constructor() { this.webContents = ch({ id: 9, isDestroyed: () => false, isLoading: () => false }); } setVisible() {} setBounds() {} },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
  dialog: { showMessageBox: async () => ({ response: 0 }), showErrorBox() {}, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: ch(), net: ch(), session: ch(), shell: ch(), Menu: ch(), safeStorage: ss, screen: ch()
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
  const db = econ.getDb();
  const users = (await db.listUsers()).map(u => u.username + ':' + u.role);
  const audit = (await db.listAudit({ all: true })).filter(a => a.action === 'demo.action').map(a => a.details);
  const needCode = typeof db.setupNeedsRecoveryCode === 'function' ? await db.setupNeedsRecoveryCode() : false;
  process.stdout.write('RESULT' + JSON.stringify({ users, audit, needCode }));
})().catch(e => process.stdout.write('RESULT' + JSON.stringify({ fatal: String(e && e.stack) })));
`;

function runMain(userData) {
  const r = spawnSync(process.execPath, ['-e', SCRIPT(userData)], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  return JSON.parse(r.stdout.slice(i + 6));
}

function seedBackup(userData, users) {
  const BK = require('../modules/econ/core/backupCrypto');
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(path.join(userData, 'autobackup.key'), Buffer.from('K:' + key));
  const bkDir = path.join(userData, 'bk');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
  const out = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] }, localStorage: {}, ...(users ? { users } : {}) };
  fs.writeFileSync(path.join(bkDir, 'auto-2026-10-17.ssbk'), BK.encryptBackup(JSON.stringify(out), key));
}

test('התאוששות ממסד פגום: המשתמשים, התפקידים ויומן הפעולות חוזרים מהגיבוי האוטומטי', async () => {
  // המשתמשים והיומן כמו שהם מיוצאים ממסד אמיתי
  const src = tmp('src');
  const sdb = await initializeDatabase(src);
  const admin = await sdb.setupAdmin('menahel', 'menahel-pass-long-1');
  await sdb.createUser('orech', 'orech-pass-long-12', 'editor');
  await sdb.audit(admin.id, 'demo.action', 'פעולה לדוגמה');
  const users = await sdb.exportUsers();
  sdb.db.close();

  const userData = tmp('rec');
  await damagedDb(userData);
  seedBackup(userData, users);
  const res = runMain(userData);
  assert.ok(!res.fatal, res.fatal);
  assert.deepEqual(res.users.sort(), ['menahel:admin', 'orech:editor']);
  assert.deepEqual(res.audit, ['פעולה לדוגמה']);
  assert.equal(res.needCode, false);
});

test('התאוששות מגיבוי ישן בלי משתמשים: המסד מסומן — יצירת מנהל רק עם קוד השחזור', async () => {
  const userData = tmp('old');
  await damagedDb(userData);
  seedBackup(userData, null);
  const res = runMain(userData);
  assert.ok(!res.fatal, res.fatal);
  assert.deepEqual(res.users, []);
  assert.equal(res.needCode, true);
});
