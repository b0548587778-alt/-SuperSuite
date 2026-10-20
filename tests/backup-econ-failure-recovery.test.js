// בדיקת הקוד 20.10.2026 — ממצא 1, המשך: טקסט הסטטוס במסך הבית, סבב הגיבוי האוטומטי בלי כתיבה ובלי רוטציה,
// הגיבוי הידני באנדרואיד, ושחזור מסד פגום מהגיבוי האוטומטי החדש ביותר שבאמת מכיל את הכספים
// (גיבויים שנכתבו לפני התיקון עשויים להיות בלעדיהם).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const AutoBk = require('../shell/auto-backup');
const R = require('../shell/db-recovery');
const BK = require('../modules/econ/core/backupCrypto');
const { writeEncryptedAutoBackup } = require('../modules/econ/core/features');
const { initializeDatabase } = require('../modules/econ/core/database');

const ROOT = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bkrec-' + p + '-'));
const econReadError = () => { const e = new Error('לא ניתן היה לקרוא את הנתונים הכספיים'); e.code = 'econ-read-failed'; return e; };

test('סטטוס במסך הבית: econ-read-failed ← אזהרה ברורה בעברית, לעולם לא "הצליח"', () => {
  const at = new Date(2026, 9, 20, 12, 0).toISOString();
  const text = AutoBk.describeStatus({ ok: false, reason: 'econ-read-failed', at });
  assert.equal(text, '⚠ הגיבוי לא נשמר — קריאת הנתונים הכספיים נכשלה (הגיבויים הקודמים נשמרו) (2026-10-20 12:00)');
  assert.doesNotMatch(text, /הצליח/);
});

test('runAutoBackup: איסוף שנכשל ← השגיאה עולה, בלי כתיבה, בלי מפתח ובלי מחיקת גיבויים ישנים', async () => {
  const dir = tmp('run');
  const old = Array.from({ length: 14 }, (_, i) => `auto-2000-02-${String(i + 1).padStart(2, '0')}.ssbk`);
  for (const f of old) fs.writeFileSync(path.join(dir, f), 'x');
  const calls = [];
  await assert.rejects(AutoBk.runAutoBackup({
    encryptionAvailable: true, customTarget: dir, defaultTarget: dir,
    collect: async () => { throw econReadError(); },
    getKey: () => { calls.push('key'); return 'k'.repeat(44); },
    write: (o) => { calls.push('write'); return writeEncryptedAutoBackup(o); },
    now: new Date(2026, 9, 20, 12, 0)
  }), (e) => e.code === 'econ-read-failed');
  assert.deepEqual(calls, []);
  assert.deepEqual(fs.readdirSync(dir).sort(), old);
});

/* ---------- אנדרואיד: גיבוי ידני ---------- */
// main-android.js נטען ישירות ב-Node (בלי המאגד — הקוד שנבדק כאן לא תלוי ב-shims), עם מודול כלכלי מדומה
function startAndroid({ econFails }) {
  const MA = require('../android/web/main-android.js');
  const handlers = new Map();
  const alerts = [], saved = [];
  const econ = {
    getDb: () => ({ backup: async () => { if (econFails) { const e = new Error('SQLITE_IOERR: disk I/O error'); e.errcode = 10; throw e; } return { contacts: [{ id: 'c1', name: 'אהרן לוי' }] }; } }),
    assertAccess() {}
  };
  const frames = {
    _f: new Set(['econ']), exists: (id) => frames._f.has(id), ensure: (id) => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {}, moduleSenderIds: () => [],
    request: async (id, type) => (type === 'ls-dump' ? { k: 'v-' + id } : true)
  };
  MA.start({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} }, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m, name, mime, text) => { saved.push({ m, name, text }); return { ok: true, name }; },
    senderOf: (id) => ({ econ: 2, shamai: 3, trainer: 4, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: (v) => { o = v; } }; })(),
    alert: (m) => alerts.push(m), confirm: () => true, exit() {}
  });
  const call = (ch, ...a) => handlers.get(ch)({ sender: { id: 1 } }, ...a);
  return { call, alerts, saved };
}

test('אנדרואיד: כשל בקריאת הכספים ← שגיאה, לא נשמר קובץ ולא מוצג "הגיבוי נשמר"', async () => {
  for (const scope of ['all', 'econ']) {
    const a = startAndroid({ econFails: true });
    await assert.rejects(a.call('shell:backup-all', 'backup-pass-1', scope), (e) => {
      assert.equal(e.code, 'econ-read-failed');
      assert.match(e.message, /הנתונים הכספיים.*הגיבוי לא נשמר/);
      assert.doesNotMatch(e.message, /SQLITE/);
      return true;
    });
    assert.deepEqual(a.saved, [], scope + ': לא נפתח בוחר קבצים ולא נכתב דבר');
    assert.deepEqual(a.alerts, [], scope + ': אין הודעת "נשמר"');
  }
});

test('אנדרואיד (בקרה): גיבוי תקין נשמר מוצפן עם הכספים; גיבוי מודול בלי כספים לא נפגע מתקלה בכספים', async () => {
  const ok = startAndroid({ econFails: false });
  assert.deepEqual(await ok.call('shell:backup-all', 'backup-pass-1', 'all'), { ok: true });
  const data = JSON.parse(BK.decryptBackup(ok.saved[0].text, 'backup-pass-1'));
  assert.deepEqual(data.econ.contacts.map(c => c.name), ['אהרן לוי']);
  assert.equal('econError' in data, false);
  assert.match(ok.alerts[0], /^הגיבוי נשמר ומוצפן/);
  const tools = startAndroid({ econFails: true });
  assert.deepEqual(await tools.call('shell:backup-all', 'backup-pass-1', 'tools'), { ok: true });
  assert.deepEqual(JSON.parse(BK.decryptBackup(tools.saved[0].text, 'backup-pass-1')).localStorage, { tools: { k: 'v-tools' } });
});

/* ---------- שחזור מסד פגום: הגיבוי החדש ביותר שמכיל את הכספים ---------- */
const KEY = crypto.randomBytes(32).toString('base64');
function writeAuto(dir, day, econ) {
  const out = { suite: 'SuperSuite', version: 2, scope: 'all', econ, localStorage: {} };
  if (!econ) out.econError = 'db-key-mismatch'; // כך נראה גיבוי שנכתב לפני התיקון
  fs.writeFileSync(path.join(dir, `auto-${day}.ssbk`), BK.encryptBackup(JSON.stringify(out), KEY));
}
const opener = (log) => (file) => { log.push(path.basename(file)); return JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), KEY)); };

test('latestUsableAutoBackup: מדלג על גיבויים בלי הכספים ועל קבצים שלא נפתחים, מהחדש לישן', () => {
  const dir = tmp('usable');
  assert.equal(R.latestUsableAutoBackup(dir, opener([])), null);
  assert.equal(R.latestUsableAutoBackup(path.join(dir, 'missing'), opener([])), null);
  writeAuto(dir, '2026-10-14', { donors: [{ id: 'd0', name: 'ישן יותר' }] });
  writeAuto(dir, '2026-10-15', { donors: [{ id: 'd1', name: 'אהרן לוי' }] });
  writeAuto(dir, '2026-10-16', null);
  fs.writeFileSync(path.join(dir, 'auto-2026-10-17.ssbk'), 'SSBK1:garbage');
  writeAuto(dir, '2026-10-18', null);
  fs.writeFileSync(path.join(dir, 'other.ssbk'), 'x');
  const log = [];
  const b = R.latestUsableAutoBackup(dir, opener(log));
  assert.equal(b.day, '2026-10-15');
  assert.equal(b.file, path.join(dir, 'auto-2026-10-15.ssbk'));
  assert.deepEqual(b.data.econ.donors.map(d => d.name), ['אהרן לוי']);
  assert.equal(b.skipped, 3);
  assert.deepEqual(log, ['auto-2026-10-18.ssbk', 'auto-2026-10-17.ssbk', 'auto-2026-10-16.ssbk', 'auto-2026-10-15.ssbk'], 'עוצר בגיבוי הראשון שמתאים');
  // ההודעה מספרת שגיבויים חדשים יותר דולגו
  const d = R.dialogFor('corrupt', b);
  assert.match(d.buttons[0].label, /2026-10-15/);
  assert.match(d.detail, /גיבויים חדשים יותר \(3\) דולגו/);
  assert.doesNotMatch(R.dialogFor('corrupt', { ...b, skipped: 0 }).detail, /דולגו/);
});

test('latestUsableAutoBackup: אף גיבוי לא נפתח (מפתח של מחשב אחר) ← האחרון, כמו קודם, כדי שהשחזור יציג את הסיבה', () => {
  const dir = tmp('nokey');
  writeAuto(dir, '2026-10-15', { donors: [] });
  writeAuto(dir, '2026-10-16', null);
  const b = R.latestUsableAutoBackup(dir, () => { throw new Error('מפתח הגיבוי האוטומטי אינו קריא בחשבון זה'); });
  assert.deepEqual(b, { file: path.join(dir, 'auto-2026-10-16.ssbk'), day: '2026-10-16' });
});

// main.js האמיתי בתהליך נפרד, מול מסד פגום (כמו tests/db-recovery.test.js)
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
  dialog: { showMessageBox: async (a, b) => { const o = b || a; log.push(['box', o.message, (o.buttons || []).join('|'), o.detail || '']); const r = plan.shift(); return { response: r === undefined ? (o.buttons || []).length - 1 : r }; },
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

test('main.js: מסד פגום, והגיבוי האחרון נכתב בלי הכספים ← השחזור מהגיבוי הקודם שמכיל אותם', async () => {
  const userData = tmp('main');
  await damagedDb(userData);
  fs.writeFileSync(path.join(userData, 'autobackup.key'), Buffer.from('K:' + KEY));
  const dir = path.join(userData, 'bk');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: dir }));
  writeAuto(dir, '2026-10-16', { donors: [{ id: 'd1', name: 'אהרן לוי' }] });
  writeAuto(dir, '2026-10-17', null);
  writeAuto(dir, '2026-10-18', null);
  const res = runMain(userData, [0]);
  assert.ok(!res.fatal, res.fatal);
  const box = res.log.find(l => l[0] === 'box');
  assert.match(box[2], /שחזור מהגיבוי האוטומטי \(2026-10-16\)/);
  assert.match(box[3], /גיבויים חדשים יותר \(2\) דולגו/);
  assert.ok(!res.log.some(l => l[0] === 'error'), 'השחזור לא נכשל: ' + JSON.stringify(res.log));
  assert.deepEqual(res.donors, ['אהרן לוי']);
  assert.ok(res.files.some(f => f.startsWith(R.DB_NAME + '.damaged-')), 'הקובץ הפגום נשמר בצד');
});
