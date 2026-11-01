// בדיקת קוד 23.10.2026 — "גיבוי, שחזור ועלייה": ממצאים 1, 2, 36, 38 והממצאים הנמוכים (שמות קבצים לפי UTC,
// app.exit בלי כתיבת המחסנים, fsync לפני מחיקה, שמירת מפתח ששוחזר מהקוד, שער השבת, path traversal ב-app://).
// main.js האמיתי נטען עם Electron מדומה (בתהליך הזה), ותרחישי העלייה — בתהליך נפרד, כמו ב-tests/db-recovery.test.js.
'use strict';
process.env.TZ = 'Asia/Jerusalem'; // שעה שבה UTC והתאריך המקומי הם ימים שונים — שם הקובץ חייב להיות לפי המקומי
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

const ROOT = path.join(__dirname, '..');
const Legacy = require('../shell/legacy-modules');
const AutoBk = require('../shell/auto-backup');
const AB = require('../modules/econ/core/features');
const BK = require('../modules/econ/core/backupCrypto');
const AR = require('../modules/econ/core/atRest');
const PB = require('../shell/plain-backups');
const DbKey = require('../shell/db-key');
const DbRecovery = require('../shell/db-recovery');
const SecureStore = require('../shell/secure-store');
const { createCrashGuard } = require('../shell/crash');
const { initializeDatabase } = require('../modules/econ/core/database');

const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-bs-' + p + '-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* מסד שעוד פתוח */ } } });

// 01:30 ב-15.10.2026 בישראל = 22:30 ב-14.10 לפי UTC (יום חמישי, יום חול)
const LOCAL_NIGHT = Date.UTC(2026, 9, 14, 22, 30);
const DAY = 24 * 3600 * 1000;
const SHABBAT = Date.parse('2026-10-24T09:00:00Z'); // שבת, 12:00 בירושלים
const PASS = 'sismat-gibui-aruka-2026';
// "עכשיו" קבוע בזמן קריאה אחת (new Date() ו-Date.now())
async function atTime(ms, fn) {
  const Real = Date;
  class FakeDate extends Real { constructor(...a) { super(...(a.length ? a : [ms])); } static now() { return ms; } }
  global.Date = FakeDate;
  try { return await fn(); } finally { global.Date = Real; }
}
// DPAPI מדומה: "הצפנה" הפיכה בתחילית
const fakeSS = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};
const newKey = () => crypto.randomBytes(32).toString('base64');

/* ================= יחידות ================= */

test('מודול האימונים עבר למוצר נפרד: נתוניו בגיבוי ישן מזוהים (להודעה), ו-trainer = {} — אין נתונים', () => {
  for (const v of [undefined, null, '', {}]) assert.equal(Legacy.hasLegacyModuleData({ localStorage: { trainer: v } }), false, JSON.stringify(v));
  for (const v of [{ 'clients:index': '[]' }, { other: '1' }, [], 'abc']) assert.equal(Legacy.hasLegacyModuleData({ localStorage: { trainer: v } }), true, JSON.stringify(v));
  for (const d of [null, {}, { localStorage: null }, { localStorage: { shamai: { a: '1' } } }, 'x']) assert.equal(Legacy.hasLegacyModuleData(d), false);
  assert.match(Legacy.LEGACY_NOTE, /[א-ת]/);
});

test('ממצא 1 (אנדרואיד): שחזור גיבוי מלא של ארגון בלי נתוני אימונים — הכספים משוחזרים', async () => {
  const MA = require('../android/web/main-android.js');
  const handlers = new Map();
  const alerts = [], moduleWrites = [];
  let restored = null;
  const econ = { getDb: () => ({ backup: async () => ({ donors: [] }), restore: async (d) => { restored = d; } }), assertAccess() {} };
  const frames = {
    _f: new Set(['econ']), exists: (id) => frames._f.has(id), ensure: (id) => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {}, moduleSenderIds: () => [],
    request: async (id, type) => { if (type === 'ls-restore') moduleWrites.push(id); return type === 'ls-dump' ? {} : true; }
  };
  const backup = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] },
    localStorage: { shamai: {}, trainer: {}, tools: {} } };
  MA.start({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} }, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m) => (m === 'openText' ? { text: JSON.stringify(backup) } : { ok: true }),
    senderOf: (id) => ({ econ: 2, shamai: 3, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: (v) => { o = v; } }; })(),
    alert: (m) => alerts.push(m), confirm: () => true, exit() {}
  });
  assert.deepEqual(await handlers.get('shell:restore-all')({ sender: { id: 1 } }, ''), { ok: true }, alerts.join(' | '));
  assert.deepEqual(restored.donors.map(d => d.name), ['אהרן לוי']);
  assert.deepEqual(moduleWrites, [], 'מודול ריק בגיבוי לא נכתב');
  assert.deepEqual(alerts, ['השחזור הושלם']);
});

test('ממצא 38: שני מחשבים מגבים לאותו יעד — כל אחד כותב את שלו, והסבב לא מוחק גיבוי של מחשב אחר', async () => {
  const dir = tmp('shared');
  const keyA = newKey(), keyB = newKey();
  assert.notEqual(AutoBk.installTag(keyA), AutoBk.installTag(keyB));
  assert.equal(AutoBk.installTag(keyA), AutoBk.installTag(keyA), 'אותו מפתח — אותה סדרה');
  const run = (key, day) => AutoBk.runAutoBackup({
    encryptionAvailable: true, customTarget: dir, defaultTarget: '',
    collect: async () => ({ suite: 'SuperSuite', econ: { who: key === keyA ? 'A' : 'B' } }),
    getKey: () => key, write: (o) => AB.writeEncryptedAutoBackup({ ...o, keep: 3 }), now: new Date(`${day}T12:00:00`)
  });
  // גיבויים ישנים בלי סימן (מלפני התיקון) — של ההתקנה או של מחשב אחר; נמחקים בסבב רגיל
  for (const d of ['2026-09-01', '2026-09-02']) fs.writeFileSync(path.join(dir, `auto-${d}.ssbk`), 'legacy');
  const a1 = await run(keyA, '2026-10-01');
  const b1 = await run(keyB, '2026-10-01');
  assert.equal(a1.ok, true);
  assert.equal(b1.ok, true);
  assert.notEqual(b1.skipped, true, 'המחשב השני לא מדלג ב"כבר קיים"');
  assert.notEqual(a1.file, b1.file);
  assert.equal((await run(keyA, '2026-10-01')).skipped, true, 'אותו מחשב באותו יום — מדלג');
  for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) await run(keyA, d);
  const files = fs.readdirSync(dir).sort();
  assert.ok(files.includes(path.basename(b1.file)), 'הגיבוי של המחשב השני לא נמחק: ' + files);
  assert.ok(!files.includes('auto-2026-09-01.ssbk') && !files.includes('auto-2026-09-02.ssbk'), 'גיבויים ישנים בלי סימן נמחקים בסבב');
  assert.deepEqual(files.filter(f => f.includes(AutoBk.installTag(keyA))),
    ['2026-10-02', '2026-10-03', '2026-10-04'].map(d => AutoBk.autoBackupName(d, AutoBk.installTag(keyA))), 'שלושה אחרונים של המחשב הזה');
  // מסד פגום: הגיבוי של המחשב הזה, גם כשגיבוי של מחשב אחר חדש ממנו
  await run(keyB, '2026-10-05');
  const open = (f) => JSON.parse(BK.decryptBackup(fs.readFileSync(f, 'utf8'), keyA));
  const usable = DbRecovery.latestUsableAutoBackup(dir, open);
  assert.equal(path.basename(usable.file), AutoBk.autoBackupName('2026-10-04', AutoBk.installTag(keyA)));
  assert.equal(usable.day, '2026-10-04');
  assert.equal(usable.skipped, 1);
});

test('ממצא 38 (תקופת המעבר): מחשב שעוד לא שודרג כותב לאותו יעד בלי סימן — הסבב של המחשב המשודרג לא מוחק את הגיבויים שלו', () => {
  const dir = tmp('mixed');
  const key = newKey(), tag = AutoBk.installTag(key);
  const write = (day) => AB.writeEncryptedAutoBackup({ dir, plainText: '{"suite":"SuperSuite"}', key, keep: 3, today: day, tag });
  // לפני השדרוג: גיבויים בלי סימן — נמחקים בסבב (כמו קודם)
  for (const d of ['2026-09-01', '2026-09-02']) fs.writeFileSync(path.join(dir, `auto-${d}.ssbk`), 'legacy');
  // אחרי השדרוג: המחשב השני (גרסה ישנה) ממשיך לכתוב auto-<day>.ssbk, פעם ביומיים
  const oldMachine = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'];
  for (let i = 1; i <= 9; i++) {
    const day = `2026-10-0${i}`;
    if (oldMachine.includes(day)) fs.writeFileSync(path.join(dir, `auto-${day}.ssbk`), 'B');
    const r = write(day);
    assert.equal(r.ok, true, day);
    assert.ok(!(r.removed || []).some(f => oldMachine.some(d => f === `auto-${d}.ssbk`)), `${day}: נמחק גיבוי של המחשב השני: ${r.removed}`);
  }
  const files = fs.readdirSync(dir).sort();
  for (const d of oldMachine) assert.ok(files.includes(`auto-${d}.ssbk`), `הגיבוי של המחשב השני מ-${d} נשאר: ${files}`);
  assert.ok(!files.includes('auto-2026-09-01.ssbk') && !files.includes('auto-2026-09-02.ssbk'), 'הגיבויים שמלפני השדרוג נמחקו');
  assert.deepEqual(files.filter(f => f.includes(tag)), ['2026-10-07', '2026-10-08', '2026-10-09'].map(d => AutoBk.autoBackupName(d, tag)),
    'שלושה אחרונים של המחשב הזה — הגיבויים של המחשב השני לא נספרים במכסה שלו');
});

test('ממצא 1 (אנדרואיד): גיבוי של מודול האימונים בלבד, בלי מתאמנים — הודעה שאין מה לשחזר, ולא "השחזור הושלם"', async () => {
  const MA = require('../android/web/main-android.js');
  const handlers = new Map();
  const alerts = [], confirms = [], moduleWrites = [];
  let restored = null;
  const econ = { getDb: () => ({ backup: async () => ({ donors: [] }), restore: async (d) => { restored = d; } }), assertAccess() {} };
  const frames = {
    _f: new Set(['econ']), exists: (id) => frames._f.has(id), ensure: (id) => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {}, moduleSenderIds: () => [],
    request: async (id, type) => { if (type === 'ls-restore') moduleWrites.push(id); return type === 'ls-dump' ? {} : true; }
  };
  const backup = { suite: 'SuperSuite', version: 2, scope: 'trainer', econ: null, localStorage: { trainer: {} } };
  MA.start({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} }, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m) => (m === 'openText' ? { text: JSON.stringify(backup) } : { ok: true }),
    senderOf: (id) => ({ econ: 2, shamai: 3, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: (v) => { o = v; } }; })(),
    alert: (m) => alerts.push(m), confirm: (m) => { confirms.push(m); return true; }, exit() {}
  });
  assert.deepEqual(await handlers.get('shell:restore-all')({ sender: { id: 1 } }, ''), { ok: false });
  assert.deepEqual(alerts, ['שגיאה: אין בקובץ נתונים לשחזור — הנתונים הקיימים לא השתנו']);
  assert.deepEqual(confirms, [], 'אין חלון "השחזור יחליף את הנתונים"');
  assert.equal(restored, null);
  assert.deepEqual(moduleWrites, []);
});

test('סבב הגיבויים: fsync לקובץ החדש לפני ההחלפה ולפני מחיקת הישנים', () => {
  const dir = tmp('fsync');
  for (const d of ['2026-01-01', '2026-01-02']) fs.writeFileSync(path.join(dir, `auto-${d}.ssbk`), 'old');
  const order = [];
  const orig = { fsyncSync: fs.fsyncSync, renameSync: fs.renameSync, unlinkSync: fs.unlinkSync };
  fs.fsyncSync = (fd) => { order.push('fsync'); return orig.fsyncSync(fd); };
  fs.renameSync = (a, b) => { order.push('rename'); return orig.renameSync(a, b); };
  fs.unlinkSync = (f) => { order.push('unlink:' + path.basename(f)); return orig.unlinkSync(f); };
  let r;
  try { r = AB.writeEncryptedAutoBackup({ dir, plainText: '{"suite":"SuperSuite"}', key: 'k'.repeat(44), keep: 2, today: '2026-01-03', tag: 'abcdef12' }); }
  finally { Object.assign(fs, orig); }
  assert.equal(r.ok, true);
  assert.deepEqual(order, ['fsync', 'rename', 'unlink:auto-2026-01-01.ssbk']);
});

test('גיבוי גלוי שמוצפן: fsync לקובץ המוצפן לפני ההחלפה ולפני מחיקת המקור', () => {
  const dir = tmp('plain-fsync');
  fs.writeFileSync(path.join(dir, 'auto-2026-01-01.json'), JSON.stringify({ suite: 'SuperSuite', version: 2, localStorage: {} }));
  const order = [];
  const fsx = { ...fs,
    fsyncSync: (fd) => { order.push('fsync'); return fs.fsyncSync(fd); },
    renameSync: (a, b) => { order.push('rename'); return fs.renameSync(a, b); },
    unlinkSync: (f) => { order.push('unlink'); return fs.unlinkSync(f); } };
  assert.equal(PB.encryptFile({ dir, name: 'auto-2026-01-01.json', key: 'k'.repeat(44), fsx }).file, 'auto-2026-01-01.ssbk');
  assert.deepEqual(order, ['fsync', 'rename', 'unlink']);
});

test('מפתח ששוחזר מהקוד: החלפה אטומית; כתיבה שנכשלה משאירה את הקובץ הקיים, נרשמת, והמפתח חוזר לשימוש בזיכרון', async () => {
  const original = newKey();
  const realKey = AR.deriveDbKey(original);
  const code = AutoBk.recoveryCodeFromKey(original);
  const ask = async () => code;
  // הצלחה: המפתח בקובץ, עותק של הישן בצד, בלי קובץ זמני
  const dir = tmp('dbkey-ok');
  const file = path.join(dir, 'autobackup.key');
  fs.writeFileSync(file, 'unreadable');
  const r = await DbKey.resolveDbKey({ fs, file, safeStorage: fakeSS, hasSealedData: true, verify: (k) => k.equals(realKey), promptRecoveryCode: ask });
  assert.equal(r.status, 'encrypted');
  assert.equal(r.unsavedBackupKey, undefined);
  assert.equal(fakeSS.decryptString(fs.readFileSync(file)), original);
  const old = fs.readdirSync(dir).filter(f => f.startsWith('autobackup.key.old-'));
  assert.equal(old.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, old[0]), 'utf8'), 'unreadable', 'הקובץ הישן נשמר בצד');
  assert.ok(!fs.existsSync(file + '.tmp'));
  // כשל בכתיבה (דיסק מלא): בעבר הקובץ הוזז הצידה, השגיאה נבלעה, ואחר כך נוצר בשקט מפתח אחר
  const dir2 = tmp('dbkey-fail');
  const file2 = path.join(dir2, 'autobackup.key');
  fs.writeFileSync(file2, 'unreadable');
  const errors = [];
  const failing = { ...fs, writeSync: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  const r2 = await DbKey.resolveDbKey({ fs: failing, file: file2, safeStorage: fakeSS, hasSealedData: true, verify: (k) => k.equals(realKey),
    promptRecoveryCode: ask, onError: (scope, e) => errors.push([scope, e.code]) });
  assert.equal(r2.status, 'encrypted');
  assert.ok(r2.key.equals(realKey), 'המסד נפתח בהפעלה הזו');
  assert.equal(r2.unsavedBackupKey, original, 'המפתח חוזר לשימוש בזיכרון עד סוף ההפעלה');
  assert.equal(fs.readFileSync(file2, 'utf8'), 'unreadable', 'הקובץ הקיים במקומו — לא הוזז');
  assert.ok(!fs.existsSync(file2 + '.tmp'));
  assert.deepEqual(errors, [['db-key-save', 'ENOSPC']]);
  // הקובץ במקומו — "צור אם חסר" לא יוצר מפתח אחר בשקט
  assert.throws(() => AutoBk.loadAutoBackupKey({ file: file2, safeStorage: fakeSS, create: true }), (e) => e.code === 'key-unreadable');
});

test('קריסה ← "הפעלה מחדש": המחסנים נכתבים לפני app.exit; תקלה בכתיבה לא עוצרת את ההפעלה מחדש', async () => {
  const order = [];
  const logger = { error: (s) => order.push('log:' + s), warn() {}, report: () => '' };
  const app = { relaunch: () => order.push('relaunch'), exit: (c) => order.push('exit:' + c) };
  const dialog = { showMessageBox: async () => ({ response: 2 }) };
  await createCrashGuard({ logger, dialog, app, getWin: () => null, beforeExit: () => order.push('flush') }).onUncaught(new Error('x'));
  assert.deepEqual(order, ['log:main', 'flush', 'relaunch', 'exit:0']);
  order.length = 0;
  await createCrashGuard({ logger, dialog, app, getWin: () => null, beforeExit: () => { throw new Error('disk'); } }).onUncaught(new Error('y'));
  assert.deepEqual(order, ['log:main', 'log:crash-exit', 'relaunch', 'exit:0']);
});

test('תאריכים בשמות קבצים: דוח תקלה ו-localDay() בלי ארגומנט — לפי התאריך המקומי ולא UTC', async () => {
  let defaultPath = null;
  const dialog = { showSaveDialog: async (_w, o) => { defaultPath = o.defaultPath; return { canceled: true }; } };
  const guard = createCrashGuard({ logger: { error() {}, warn() {}, report: () => '' }, dialog, app: {}, getWin: () => null });
  await atTime(LOCAL_NIGHT, () => guard.saveReport());
  assert.equal(defaultPath, 'SuperSuite-דוח-תקלה-2026-10-15.txt');
  // main.js קרא AutoBk.localDay() בלי ארגומנט וקרס — הגיבוי שלפני הצפנת המסד ושלפני העברת נתוני המודולים נכשל תמיד
  assert.equal(await atTime(LOCAL_NIGHT, () => AutoBk.localDay()), '2026-10-15');
});

/* ================= main.js האמיתי, בתהליך הזה ================= */

const userData = tmp('main');
const bkDir = tmp('main-bk');
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
const KEY = newKey();
fs.writeFileSync(path.join(userData, 'autobackup.key'), fakeSS.encryptString(KEY));
// מחסן השמאות אחרי שדרוג: כבר יש בו ערך, אבל הנתונים הישנים עוד לא הועברו (המודול לא נפתח בכניסה)
{
  const s = SecureStore.createSecureStore({ fs, dir: userData, mod: 'shamai', getBackupKey: () => KEY, schedule: () => null });
  s.set('shamai_v2_props', '["מהמחסן"]');
  s.flush();
}
// ה-localStorage הגלוי הישן של המודולים (כמו שהוא בדפדפן)
const LEGACY = {
  shamai: { shamai_v2_props: '["ישן"]', shamai_v2_purchaseSeq: '4' }
};
const legacyFail = new Set();

const handlers = {}, onHandlers = {};
const created = { views: [] };
let readyCallback = null, protocolHandler = null, autoBackupFn = null, uncaught = null, onExit = null;
const dialogPlan = { save: { canceled: true }, open: { canceled: true, filePaths: [] }, box: 1 };
const dialogLog = [];
let lastSave = null;

function chainable(props = {}) {
  const target = function () { return chainable(); };
  return new Proxy(target, {
    get(_t, key) {
      if (key in props) return props[key];
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 0;
      return chainable();
    },
    apply() { return chainable(); },
  });
}
class ViewStub {
  constructor(opts = {}) {
    this.id = created.views.length + 100;
    this.opts = opts;
    this.isolated = [];
    created.views.push(this);
    const self = this;
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {},
      loadURL: (u) => { self.url = String(u); },
      executeJavaScript: async () => '{}',
      executeJavaScriptInIsolatedWorld: async (world) => {
        const mod = (/^app:\/\/(\w+)\//.exec(self.url || '') || [])[1];
        self.isolated.push(world);
        if (legacyFail.has(mod)) throw new Error('Script failed to execute');
        return JSON.stringify(LEGACY[mod] || {});
      } });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}
class WinStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; } on() {} removeMenu() {} loadFile() {} maximize() {}
}
const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, quit() {}, relaunch() {}, isPackaged: false, getVersion: () => '0',
    exit: () => { if (onExit) onExit(); },
  }),
  BrowserWindow: WinStub, WebContentsView: ViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { onHandlers[ch] = fn; }, removeHandler() {} },
  dialog: {
    showSaveDialog: async (_w, o) => { lastSave = o; return dialogPlan.save; },
    showOpenDialog: async () => dialogPlan.open,
    showMessageBox: async (_w, o) => { const b = o || _w; dialogLog.push(['box', b.message, b.detail]); return { response: dialogPlan.box }; },
    showErrorBox(t, m) { dialogLog.push(['error', m]); },
  },
  protocol: { registerSchemesAsPrivileged() {}, handle: (_s, fn) => { protocolHandler = fn; } },
  net: { fetch: async (u) => ({ fetched: String(u) }) },
  session: chainable(), shell: chainable(), Menu: chainable(), safeStorage: fakeSS,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_bs__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_bs__.js'] = { id: '/__electron_stub_audit_bs__.js', filename: '/__electron_stub_audit_bs__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
let holdStoreFlush = false; // הכתיבה המתוזמנת של המחסן (300ms) לא רצה — רק כתיבה מפורשת
global.setTimeout = (fn, ms, ...rest) => {
  if (ms === 15000 && fn && fn.name === 'autoBackup') { autoBackupFn = fn; return { unref() {}, ref() {} }; }
  if (holdStoreFlush && ms === 300) return { unref() {}, ref() {} };
  return realSetTimeout(fn, ms, ...rest).unref();
};
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

const shell = () => ({ sender: { id: 1 } });
const econView = () => created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
const viewOf = (mod) => created.views.find(v => (v.url || '').startsWith(`app://${mod}/`));
const econDb = () => require(path.join(ROOT, 'modules', 'econ', 'ipc.js')).getDb();
const relogin = () => handlers['auth:login']({ sender: { id: econView().id } }, 'menahel', 'menahel-pass-long-1');
let ready = null;
function boot() {
  ready = ready || (async () => {
    // מסד ישן גלוי (כמו לפני הצפנת המסד) — ההמרה תרוץ בעלייה
    const plain = await initializeDatabase(userData);
    const d = await plain.load();
    d.donors = [{ id: 'd1', name: 'אהרן לוי' }];
    await plain.save(d);
    plain.db.close();
    // תפיסת הטיפול בשגיאה שלא נתפסה (crash.installProcessHandlers) — בלי לרשום אותו באמת בתהליך הבדיקות
    const origOn = process.on;
    process.on = function (ev, fn) {
      if (ev === 'uncaughtException' && !uncaught) { uncaught = fn; return process; }
      if (ev === 'unhandledRejection') return process;
      return origOn.call(this, ev, fn);
    };
    try { require(path.join(ROOT, 'main.js')); } finally { process.on = origOn; }
    await readyCallback();
    await handlers['shell:switch'](shell(), 'econ');
    await handlers['auth:setup']({ sender: { id: econView().id } }, 'menahel', 'menahel-pass-long-1');
  })();
  return ready;
}

test('הצפנת מסד ישן בעלייה: הגיבוי שלפני ההמרה נכתב, והמסד מוצפן (בעבר localDay() קרס והמסד נשאר גלוי)', async () => {
  await boot();
  const files = fs.readdirSync(bkDir).filter(f => /^before-encryption-\d{4}-\d{2}-\d{2}-\d+\.ssbk$/.test(f));
  assert.equal(files.length, 1, fs.readdirSync(bkDir).join(','));
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(path.join(bkDir, files[0]), 'utf8'), KEY));
  assert.deepEqual(data.econ.donors.map(x => x.name), ['אהרן לוי']);
  assert.equal(econDb().atRestStatus, 'encrypted');
  assert.doesNotMatch(await handlers['shell:get-backup-status'](shell()) || '', /עוד לא הוצפנו/);
});

test('app://: אין יציאה מתיקיית המודול (path traversal), קידוד פגום ← 400, מודול לא מוכר ← 404', async () => {
  await boot();
  assert.equal(typeof protocolHandler, 'function');
  const get = (url) => protocolHandler({ url });
  const inside = (r, mod) => {
    assert.ok(r && r.fetched, JSON.stringify(r));
    const p = fileURLToPath(r.fetched);
    assert.ok(p.startsWith(path.join(ROOT, 'modules', mod) + path.sep), p);
    return p;
  };
  assert.equal(inside(await get('app://shamai/index.html'), 'shamai'), path.join(ROOT, 'modules', 'shamai', 'index.html'));
  assert.equal(inside(await get('app://shamai/'), 'shamai'), path.join(ROOT, 'modules', 'shamai', 'index.html'));
  for (const url of ['app://shamai/..%2f..%2fmain.js', 'app://shamai/..%2f..%2fshell%2fsecure-store.js',
    'app://shamai/..%2fshamai-evil%2fx.js', 'app://tools/..%2f..%2f..%2f..%2fWindows%2fwin.ini', 'app://econ/..%2ftrainer%2findex.html']) {
    const r = await get(url);
    assert.ok(r instanceof Response, url + ' ← ' + JSON.stringify(r));
    assert.equal(r.status, 403, url);
  }
  // נקודות מקודדות שה-URL עצמו מנרמל — נשארות בתוך התיקייה
  inside(await get('app://shamai/%2e%2e/%2e%2e/main.js'), 'shamai');
  // לוכסן הפוך (מפריד ב-Windows): נחסם, או נשאר בתוך התיקייה במערכת אחרת
  { const r = await get('app://shamai/..%5c..%5cmain.js'); if (r instanceof Response) assert.equal(r.status, 403); else inside(r, 'shamai'); }
  assert.equal((await get('app://shamai/%E0%A4%A')).status, 400);
  assert.equal((await get('app://evil/index.html')).status, 404);
  // קבצי המעטפת המשותפים — רק הנתיב המדויק
  assert.equal(fileURLToPath((await get('app://tools/design-tokens.css')).fetched), path.join(ROOT, 'shell', 'design-tokens.css'));
  // מודול האימונים עבר למוצר נפרד — אין לו תיקייה ואין לו כתובת
  assert.equal((await get('app://trainer/index.html')).status, 404);
});

test('ממצא 36: אחרי שדרוג, הגיבוי האוטומטי כולל את נתוני השמאות שעוד לא הועברו למחסן', async () => {
  await boot();
  const status = await atTime(LOCAL_NIGHT, () => autoBackupFn());
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(path.basename(status.file), AutoBk.autoBackupName('2026-10-15', AutoBk.installTag(KEY)), 'שם לפי היום המקומי, עם סימן ההתקנה');
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(status.file, 'utf8'), KEY));
  assert.equal(data.localStorage.shamai.shamai_v2_props, '["מהמחסן"]', 'מה שכבר במחסן גובר (כמו בהעברה)');
  assert.equal(data.localStorage.shamai.shamai_v2_purchaseSeq, '4', 'הנתונים הישנים בגיבוי');
  assert.equal(data.localStorage.trainer, undefined, 'מודול האימונים (עבר למוצר נפרד) אינו בגיבוי');
  assert.deepEqual(data.econ.donors.map(x => x.name), ['אהרן לוי']);
  // נקרא בעולם מבודד משלנו — לא בעולם של העמוד (שם ה-preload מחליף את localStorage) ולא בעולם של ה-preload
  const worlds = viewOf('shamai').isolated;
  assert.ok(worlds.length && worlds.every(w => Number.isInteger(w) && w !== 0 && w !== 999), JSON.stringify(worlds));
});

test('ממצא 36: הנתונים הישנים לא נקראו ← הגיבוי לא נשמר, ושום גיבוי קודם לא נמחק', async () => {
  await boot();
  const before = fs.readdirSync(bkDir).sort();
  legacyFail.add('shamai');
  let status;
  try { status = await atTime(LOCAL_NIGHT + DAY, () => autoBackupFn()); } finally { legacyFail.delete('shamai'); }
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'module-read-failed');
  assert.deepEqual(fs.readdirSync(bkDir).sort(), before);
});

test('העברת נתוני השמאות למחסן: הגיבוי שלפניה נכתב (בעבר localDay() קרס וההעברה נכשלה תמיד)', async () => {
  await boot();
  const e = { sender: { id: viewOf('shamai').id } };
  onHandlers['secure-store:migrate'](e, 'shamai', LEGACY.shamai);
  assert.equal(e.returnValue && e.returnValue.ok, true, JSON.stringify(e.returnValue));
  const files = fs.readdirSync(bkDir).filter(n => /^before-encryption-shamai-\d{4}-\d{2}-\d{2}-\d+\.ssbk$/.test(n));
  assert.equal(files.length, 1, fs.readdirSync(bkDir).join(','));
  assert.deepEqual(JSON.parse(BK.decryptBackup(fs.readFileSync(path.join(bkDir, files[0]), 'utf8'), KEY)).localStorage.shamai, LEGACY.shamai);
});

test('ממצא 1 (main.js): שחזור גיבוי מלא של ארגון בלי נתוני אימונים — הכספים משוחזרים', async () => {
  await boot();
  const db = econDb();
  const incoming = await db.backup();
  incoming.donors = [{ id: 'd2', name: 'שמעון כהן' }];
  const file = path.join(userData, 'full.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: incoming,
    localStorage: { shamai: {}, trainer: {}, tools: {} } }), PASS));
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.box = 0;
  dialogLog.length = 0;
  try {
    assert.deepEqual(await handlers['shell:restore-all'](shell(), PASS), { ok: true }, JSON.stringify(dialogLog));
  } finally { dialogPlan.open = { canceled: true, filePaths: [] }; dialogPlan.box = 1; }
  assert.deepEqual((await db.load()).donors.map(x => x.name), ['שמעון כהן']);
  assert.ok(!dialogLog.some(x => x[0] === 'error'), JSON.stringify(dialogLog));
  assert.ok(dialogLog.some(x => x[1] === 'השחזור הושלם'));
});

test('ממצא 1 (main.js): גיבוי של מודול האימונים בלבד, בלי מתאמנים — הודעה שאין מה לשחזר, ולא "השחזור הושלם"', async () => {
  await boot();
  const db = econDb();
  const donorsBefore = (await db.load()).donors.map(x => x.name);
  const file = path.join(userData, 'trainer-empty.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'trainer', econ: null,
    localStorage: { trainer: {} } }), PASS));
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.box = 0; // אם יוצג חלון האישור — "שחזר"
  dialogLog.length = 0;
  try {
    assert.deepEqual(await handlers['shell:restore-all'](shell(), PASS), { ok: false }, JSON.stringify(dialogLog));
  } finally { dialogPlan.open = { canceled: true, filePaths: [] }; dialogPlan.box = 1; }
  assert.deepEqual(dialogLog, [['error', 'אין בקובץ נתונים לשחזור — הנתונים הקיימים לא השתנו']]);
  assert.deepEqual((await db.load()).donors.map(x => x.name), donorsBefore, 'הכספים לא השתנו');
});

// גיבוי מלא מגרסה שכללה את מודול האימונים (עבר למוצר החינוכי הנפרד): שאר הנתונים משוחזרים, האימונים — לא,
// בלי שגיאה ובלי לבדוק את המבנה שלהם (גם נתוני אימונים פגומים לא עוצרים את השחזור)
const OLD_TRAINER = { 'trainer:profile': JSON.stringify({ name: 'משה כהן' }), 'clients:index': 'לא JSON', 'client:c_1': JSON.stringify({ id: 'c_1', name: 'יעקב לוי' }) };

test('גיבוי ישן עם נתוני אימונים (main.js): הכספים והשמאות משוחזרים, האימונים מדולגים עם הודעה — בלי שגיאה', async () => {
  await boot();
  const db = econDb();
  const incoming = await db.backup();
  incoming.donors = [{ id: 'd3', name: 'ראובן שטרן' }];
  const file = path.join(userData, 'full-with-trainer.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: incoming,
    localStorage: { shamai: { shamai_v2_from_old: '["מהגיבוי"]' }, trainer: OLD_TRAINER, tools: {} } }), PASS));
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.box = 0;
  dialogLog.length = 0;
  try {
    assert.deepEqual(await handlers['shell:restore-all'](shell(), PASS), { ok: true }, JSON.stringify(dialogLog));
  } finally { dialogPlan.open = { canceled: true, filePaths: [] }; dialogPlan.box = 1; }
  assert.ok(!dialogLog.some(x => x[0] === 'error'), JSON.stringify(dialogLog));
  const confirm = dialogLog.find(x => x[0] === 'box' && /השחזור יחליף/.test(x[1]));
  assert.ok(confirm && confirm[2].includes(Legacy.LEGACY_NOTE), 'חלון האישור אומר שהאימונים לא ישוחזרו');
  assert.ok(dialogLog.some(x => x[1] === 'השחזור הושלם'));
  assert.deepEqual((await db.load()).donors.map(x => x.name), ['ראובן שטרן']);
  assert.equal(SecureStore.MODULES.includes('trainer'), false);
  assert.ok(!fs.existsSync(path.join(userData, 'secure-trainer.bin')), 'לא נוצר מחסן לאימונים');
  assert.ok(!created.views.some(v => /^app:\/\/trainer\//.test(v.url || '')), 'לא נפתחה תצוגה למודול האימונים');
});

test('גיבוי ישן של מודול האימונים בלבד, עם נתונים (main.js): הודעה ברורה, ושום דבר לא משתנה', async () => {
  await boot();
  const db = econDb();
  const donorsBefore = (await db.load()).donors.map(x => x.name);
  const file = path.join(userData, 'trainer-only.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'trainer', econ: null,
    localStorage: { trainer: OLD_TRAINER } }), PASS));
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.box = 0;
  dialogLog.length = 0;
  try {
    assert.deepEqual(await handlers['shell:restore-all'](shell(), PASS), { ok: false }, JSON.stringify(dialogLog));
  } finally { dialogPlan.open = { canceled: true, filePaths: [] }; dialogPlan.box = 1; }
  assert.deepEqual(dialogLog, [['error', Legacy.LEGACY_ONLY + 'אין בקובץ נתונים לשחזור — הנתונים הקיימים לא השתנו']]);
  assert.deepEqual((await db.load()).donors.map(x => x.name), donorsBefore, 'הכספים לא השתנו');
});

test('גיבוי ישן עם נתוני אימונים (אנדרואיד): הכספים משוחזרים, האימונים מדולגים עם הודעה', async () => {
  const MA = require('../android/web/main-android.js');
  const handlers = new Map();
  const alerts = [], confirms = [], moduleWrites = [];
  let restored = null;
  const econ = { getDb: () => ({ backup: async () => ({ donors: [] }), restore: async (d) => { restored = d; } }), assertAccess() {} };
  const frames = {
    _f: new Set(['econ']), exists: (id) => frames._f.has(id), ensure: (id) => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {}, moduleSenderIds: () => [],
    request: async (id, type) => { if (type === 'ls-restore') moduleWrites.push(id); return type === 'ls-dump' ? {} : true; }
  };
  const backup = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] },
    localStorage: { shamai: {}, trainer: OLD_TRAINER, tools: {} } };
  MA.start({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} }, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m) => (m === 'openText' ? { text: JSON.stringify(backup) } : { ok: true }),
    senderOf: (id) => ({ econ: 2, shamai: 3, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: (v) => { o = v; } }; })(),
    alert: (m) => alerts.push(m), confirm: (m) => { confirms.push(m); return true; }, exit() {}
  });
  assert.deepEqual(await handlers.get('shell:restore-all')({ sender: { id: 1 } }, ''), { ok: true }, alerts.join(' | '));
  assert.deepEqual(restored.donors.map(d => d.name), ['אהרן לוי']);
  assert.ok(confirms[0].includes(Legacy.LEGACY_NOTE), confirms[0]);
  assert.deepEqual(moduleWrites, [], 'אין כתיבה למודול האימונים (ולא למודולים ריקים)');
  assert.ok(!frames.exists('trainer'));
  assert.deepEqual(alerts, ['השחזור הושלם']);
});

test('גיבוי ידני: שם הקובץ המוצע לפי התאריך המקומי ולא UTC', async () => {
  await boot();
  lastSave = null;
  dialogPlan.save = { canceled: true };
  assert.deepEqual(await atTime(LOCAL_NIGHT, () => handlers['shell:backup-all'](shell(), PASS, 'econ')), { ok: false });
  assert.equal(lastSave && lastSave.defaultPath, 'SuperSuite-econ-2026-10-15.ssbk');
});

test('שער השבת: במצב שבת הגיבוי האוטומטי נדחה והסנכרון לא מאזין; ביום חול — הגיבוי רץ', async () => {
  await boot();
  handlers['shell:save-calendar'](shell(), { shabbatMode: true });
  try {
    const filesBefore = fs.readdirSync(bkDir).sort();
    const settingsBefore = fs.readFileSync(path.join(userData, 'backup-settings.json'), 'utf8');
    const st = await atTime(SHABBAT, () => autoBackupFn());
    assert.equal(st.ok, false);
    assert.equal(st.reason, 'shabbat');
    assert.deepEqual(fs.readdirSync(bkDir).sort(), filesBefore, 'לא נכתב ולא נמחק דבר');
    assert.equal(fs.readFileSync(path.join(userData, 'backup-settings.json'), 'utf8'), settingsBefore, 'בשבת לא נכתב גם קובץ הסטטוס');
    await atTime(SHABBAT, async () => {
      await relogin(); // הפגישה נמדדת בשעון — כאן "עכשיו" הוא שבת
      await handlers['sync:set-enabled'](shell(), true);
      const s = await handlers['sync:status'](shell());
      assert.equal(s.enabled, true);
      assert.equal(s.paused, true, 'בשבת הסנכרון מושהה');
      assert.equal(s.listening, null, 'ולא מאזין לרשת');
      await handlers['sync:set-enabled'](shell(), false);
    });
    // יום שלישי 20.10 — הגיבוי רץ
    const weekday = await atTime(LOCAL_NIGHT + 5 * DAY, () => autoBackupFn());
    assert.equal(weekday.ok, true, JSON.stringify(weekday));
    assert.ok(fs.existsSync(weekday.file));
  } finally { handlers['shell:save-calendar'](shell(), { shabbatMode: false }); }
});

test('קריסה ← "הפעלה מחדש" ב-main.js: כתיבה אחרונה במחסן נשמרת בדיסק לפני app.exit', async () => {
  await boot();
  assert.equal(typeof uncaught, 'function');
  await relogin(); // בדיקות קודמות הזיזו את השעון — הפגישה פגה
  const e = { sender: { id: viewOf('shamai').id } };
  holdStoreFlush = true;
  onHandlers['secure-store:write'](e, 'shamai', 'set', 'shamai_v2_note', 'נכתב רגע לפני');
  assert.equal(e.returnValue && e.returnValue.ok, true, JSON.stringify(e.returnValue));
  let atExit = null;
  onExit = () => { atExit = SecureStore.createSecureStore({ fs, dir: userData, mod: 'shamai', getBackupKey: () => KEY, schedule: () => null }).snapshot(); };
  dialogPlan.box = 2; // "הפעלה מחדש"
  try {
    uncaught(new Error('תקלה לדוגמה'));
    for (let i = 0; i < 200 && !atExit; i++) await new Promise(r => setImmediate(r));
  } finally { dialogPlan.box = 1; onExit = null; holdStoreFlush = false; }
  assert.ok(atExit, 'app.exit נקרא');
  assert.equal(atExit.shamai_v2_note, 'נכתב רגע לפני', 'app.exit מדלג על will-quit — המחסן נכתב לפני');
});

/* ================= עלייה: main.js בתהליך נפרד ================= */
// חלונות מדומים שסופרים את עצמם: סגירת האחרון יורה window-all-closed, כמו ב-Electron.
// בעבר: סגירת מסך הפתיחה לפני חלון ההתאוששות ← window-all-closed ← app.quit() — והתוכנה נסגרה במקום להציג אותו
const BOOT_SCRIPT = (dir, opts) => `
const Module = require('module'), path = require('path'), fs = require('fs');
const log = []; const opts = ${JSON.stringify(opts)}; const plan = (opts.plan || []).slice();
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => (k in p ? p[k] : (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => 0 : ch()))), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
let ready = null, autoBackup = null, booted = false, nextId = 1, onFail = null;
const appOn = {}, ipc = {}, open = new Set(), splashTimers = [], secondAt = new Set(opts.second || []);
// המשתמש לוחץ שוב על התוכנה (נעילת המופע היחיד מעבירה את זה ל-second-instance)
const second = () => { log.push(['second']); (appOn['second-instance'] || []).forEach(f => f()); };
class Win {
  constructor() { this.id = nextId++; this.ev = {}; this.destroyed = false; this.contentView = { addChildView() {} };
    this.webContents = ch({ id: this.id, isDestroyed: () => this.destroyed }); open.add(this); }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; open.delete(this);
    (this.ev.closed || []).forEach(f => f());
    if (!open.size) { log.push(['all-closed', booted]); (appOn['window-all-closed'] || []).forEach(f => f()); }
  }
  close() { this.destroy(); }
  on(ev, fn) { (this.ev[ev] = this.ev[ev] || []).push(fn); } once(ev, fn) { this.on(ev, fn); }
  removeMenu() {} maximize() {} show() {} focus() { log.push(['focus', path.basename(this.file || '')]); } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1000, height: 800 }; } getNormalBounds() { return this.getBounds(); }
  getContentBounds() { return this.getBounds(); } getContentSize() { return [1000, 800]; }
  loadFile(f) {
    this.file = String(f);
    log.push(['load', path.basename(this.file)]);
    if (/recovery\\.html$/.test(this.file)) setImmediate(() => {
      log.push(['recovery-window']);
      if (secondAt.has('recovery')) second();
      if (opts.code) ipc['recovery:submit']({ sender: { id: this.id } }, opts.code); else this.close();
    });
    return Promise.resolve();
  }
}
class View { constructor() { this.webContents = ch({ id: nextId++, isDestroyed: () => false, isLoading: () => false,
  executeJavaScript: async () => '{}', executeJavaScriptInIsolatedWorld: async () => '{}' }); } setVisible() {} setBounds() {} }
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch: (h) => { onFail = h; } }; } }),
    getPath: () => ${JSON.stringify(dir)}, on: (ev, fn) => { (appOn[ev] = appOn[ev] || []).push(fn); },
    exit: (c) => log.push(['exit', c]), quit: () => log.push(['quit', booted]), relaunch() {}, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: Win, WebContentsView: View,
  ipcMain: { handle: (c, fn) => { ipc[c] = fn; }, on: (c, fn) => { ipc[c] = fn; }, removeHandler: (c) => { delete ipc[c]; } },
  dialog: { showMessageBox: async (a, b) => { const o = b || a; log.push(['box', o.message, (o.buttons || []).join('|')]); if (secondAt.has('box')) second(); const r = plan.shift(); return { response: r === undefined ? (o.buttons || []).length - 1 : r }; },
    showErrorBox: (t, m) => log.push(['error', t, m]), showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: opts.failProtocol ? { registerSchemesAsPrivileged() {}, handle() { throw new Error('boom-protocol'); } } : ch(),
  net: ch(), session: ch(), shell: ch({ openPath: () => {} }), Menu: ch(), safeStorage: ss
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? '/__e_boot__.js' : orig.call(this, r, ...a); };
require.cache['/__e_boot__.js'] = { id: '/__e_boot__.js', filename: '/__e_boot__.js', loaded: true, exports: stub };
global.setTimeout = ((st) => (fn, ms, ...r) => {
  if (ms === 15000 && fn && fn.name === 'autoBackup') { autoBackup = fn; return { unref() {} }; }
  if (secondAt.size && ms === 20000) { splashTimers.push(fn); return { unref() {} }; } // מסך הפתיחה נסגר מעצמו — כשהבדיקה מחליטה
  return st(fn, ms, ...r).unref();
})(global.setTimeout);
global.setInterval = ((si) => (fn, ms, ...r) => si(fn, ms, ...r).unref())(global.setInterval);
require(${JSON.stringify(path.join(ROOT, 'main.js'))});
(async () => {
  const p = ready();
  // עלייה ארוכה: מסך הפתיחה נסגר אחרי MAX_MS לפני שהעלייה הסתיימה, והמשתמש לוחץ שוב על התוכנה
  if (secondAt.has('early')) { log.push(['splash-timeout']); splashTimers.splice(0).forEach(f => f()); second(); }
  try { await p; } catch (e) {
    log.push(['boot-rejected']);
    if (onFail) onFail(e);
    process.stdout.write('RESULT' + JSON.stringify({ log, files: fs.readdirSync(${JSON.stringify(dir)}) }));
    return;
  }
  booted = true;
  log.push(['ready']);
  const out = { log };
  if (opts.runBackup) out.backup = await autoBackup();
  try { out.donors = (await require(${JSON.stringify(path.join(ROOT, 'modules', 'econ', 'ipc.js'))}).getDb().load()).donors.map(d => d.name); } catch (e) { out.donorsError = String(e); }
  // אחרי העלייה המשתמש סוגר את כל החלונות — עכשיו זו יציאה
  for (const w of [...open]) w.destroy();
  out.files = fs.readdirSync(${JSON.stringify(dir)});
  process.stdout.write('RESULT' + JSON.stringify(out));
})().catch(e => process.stdout.write('RESULT' + JSON.stringify({ log, fatal: String(e && e.stack) })));
`;
function runBoot(dir, opts = {}) {
  const r = spawnSync(process.execPath, ['-e', BOOT_SCRIPT(dir, opts), ...(opts.args ? ['--', ...opts.args] : [])], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  const res = JSON.parse(r.stdout.slice(i + 6));
  assert.ok(!res.fatal, res.fatal);
  return res;
}
// לא יוצאים באמצע העלייה; אחרי שהחלון הראשי נוצר — סגירת כל החלונות היא יציאה
function assertNoQuitDuringBoot(res) {
  const readyAt = res.log.findIndex(l => l[0] === 'ready');
  assert.ok(readyAt > 0, JSON.stringify(res.log));
  assert.ok(res.log.slice(0, readyAt).some(l => l[0] === 'all-closed'), 'בתרחיש נסגרו כל החלונות באמצע העלייה: ' + JSON.stringify(res.log));
  assert.ok(!res.log.slice(0, readyAt).some(l => l[0] === 'quit' || l[0] === 'exit'), 'התוכנה יצאה באמצע העלייה: ' + JSON.stringify(res.log));
  assert.ok(res.log.slice(readyAt).some(l => l[0] === 'quit' && l[1] === true), 'אחרי העלייה סגירת החלונות סוגרת את התוכנה');
}
function bootDir(name) {
  const dir = tmp(name);
  fs.writeFileSync(path.join(dir, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
  return dir;
}
async function sealedDb(dir, key, donor) {
  const db = await initializeDatabase(dir, { resolveCipher: async () => ({ key: AR.deriveDbKey(key), status: 'encrypted' }) });
  const d = await db.load();
  d.donors = [{ id: 'd1', name: donor }];
  await db.save(d);
  db.db.close();
}

test('ממצא 2: מסד פגום בעלייה ← חלון השחזור מוצג אחרי סגירת מסך הפתיחה, והשחזור מהגיבוי האוטומטי מצליח', async () => {
  const dir = bootDir('boot-corrupt');
  // מסד אמיתי ששובשו הדפים שלו
  const db = await initializeDatabase(dir);
  for (let i = 0; i < 2000; i++) await db.audit(null, 'test', 'פרטים ' + i);
  db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.db.close();
  const f = path.join(dir, DbRecovery.DB_NAME);
  const b = fs.readFileSync(f);
  for (let i = 8192; i < b.length; i += 5) b[i] = 0x55;
  fs.writeFileSync(f, b);
  // גיבוי אוטומטי בשם עם סימן ההתקנה (ממצא 38)
  const key = newKey();
  fs.writeFileSync(path.join(dir, 'autobackup.key'), fakeSS.encryptString(key));
  const bk = path.join(dir, 'bk');
  fs.mkdirSync(bk);
  fs.writeFileSync(path.join(dir, 'backup-settings.json'), JSON.stringify({ targetDir: bk }));
  const out = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] }, localStorage: {} };
  fs.writeFileSync(path.join(bk, AutoBk.autoBackupName('2026-10-17', AutoBk.installTag(key))), BK.encryptBackup(JSON.stringify(out), key));
  const res = runBoot(dir, { plan: [0, 0] });
  const box = res.log.find(l => l[0] === 'box');
  assert.equal(box && box[1], 'קובץ הנתונים פגום ולא ניתן לפתוח אותו', JSON.stringify(res.log));
  assert.match(box[2], /שחזור מהגיבוי האוטומטי \(2026-10-17\)/);
  assertNoQuitDuringBoot(res);
  assert.deepEqual(res.donors, ['אהרן לוי']);
});

test('ממצא 2: נתונים מוצפנים בלי מפתח ← חלון קוד השחזור, ואחרי שנסגר — "פתיחה ריקה" (לא יציאה)', async () => {
  const dir = bootDir('boot-nokey');
  await sealedDb(dir, newKey(), 'אהרן לוי');
  const res = runBoot(dir, { plan: [0] });
  assert.ok(res.log.some(l => l[0] === 'recovery-window'), 'חלון קוד השחזור נפתח: ' + JSON.stringify(res.log));
  assert.ok(res.log.some(l => l[0] === 'box' && l[1] === 'הנתונים מוצפנים ואין קוד שחזור'), JSON.stringify(res.log));
  assertNoQuitDuringBoot(res);
  assert.deepEqual(res.donors, [], 'נפתח מסד ריק');
  assert.ok(res.files.some(n => n.startsWith(DbRecovery.DB_NAME + '.locked-')), 'הקובץ המוצפן נשמר בצד: ' + res.files);
});

test('ממצא 2 + שמירת המפתח: קוד שחזור נכון, שמירת המפתח נכשלת ← המסד נפתח, והגיבוי האוטומטי במפתח שבקוד', async () => {
  const dir = bootDir('boot-code');
  const key = newKey();
  await sealedDb(dir, key, 'אהרן לוי');
  fs.writeFileSync(path.join(dir, 'autobackup.key'), 'garbage'); // מפתח של חשבון אחר / Windows שהותקן מחדש
  fs.mkdirSync(path.join(dir, 'autobackup.key.tmp', 'blocker'), { recursive: true }); // הכתיבה של המפתח נכשלת
  const bk = path.join(dir, 'bk');
  fs.mkdirSync(bk);
  fs.writeFileSync(path.join(dir, 'backup-settings.json'), JSON.stringify({ targetDir: bk }));
  const res = runBoot(dir, { code: AutoBk.recoveryCodeFromKey(key), runBackup: true });
  assertNoQuitDuringBoot(res);
  assert.deepEqual(res.donors, ['אהרן לוי'], 'המסד נפתח בקוד');
  assert.equal(res.backup && res.backup.ok, true, JSON.stringify(res.backup));
  // הגיבוי במפתח שבקוד (לא במפתח חדש שנוצר בשקט) — קוד השחזור שרשום אצל המשתמש פותח אותו
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(res.backup.file, 'utf8'), key));
  assert.deepEqual(data.econ.donors.map(x => x.name), ['אהרן לוי']);
  assert.equal(path.basename(res.backup.file).includes(AutoBk.installTag(key)), true);
  assert.equal(fs.readFileSync(path.join(dir, 'autobackup.key'), 'utf8'), 'garbage', 'קובץ המפתח לא הוחלף במפתח אחר');
  assert.match(fs.readFileSync(path.join(dir, 'crash.log'), 'utf8'), /\[db-key-save\]/, 'הכשל נרשם ביומן');
});

test('ממצא 2: עלייה ארוכה — מסך הפתיחה נסגר אחרי MAX_MS, והפעלה נוספת מציגה אותו שוב (לא נשארים בלי שום חלון)', async () => {
  const res = runBoot(bootDir('boot-long'), { second: ['early'] });
  const at = res.log.findIndex(l => l[0] === 'second');
  assert.ok(at > 0, JSON.stringify(res.log));
  assert.ok(res.log.slice(0, at).some(l => l[0] === 'all-closed' && l[1] === false), 'מסך הפתיחה נסגר לפני ההפעלה הנוספת: ' + JSON.stringify(res.log));
  assert.deepEqual(res.log[at + 1], ['load', 'splash.html'], 'מסך הפתיחה הוצג שוב: ' + JSON.stringify(res.log));
  assertNoQuitDuringBoot(res);
});

test('ממצא 2: הפעלה נוספת בזמן חלון קוד השחזור או חלון הודעה בעלייה — החלון לחזית, בלי מסך פתיחה מעליו', async () => {
  const dir = bootDir('boot-second');
  await sealedDb(dir, newKey(), 'אהרן לוי');
  const res = runBoot(dir, { plan: [0], second: ['recovery', 'box'] });
  const seconds = res.log.map((l, i) => (l[0] === 'second' ? i : -1)).filter(i => i >= 0);
  assert.equal(seconds.length, 2, JSON.stringify(res.log));
  assert.deepEqual(res.log[seconds[0] + 1], ['focus', 'recovery.html'], 'חלון קוד השחזור הובא לחזית: ' + JSON.stringify(res.log));
  assert.equal(res.log[seconds[1] - 1][0], 'box');
  assert.ok(!res.log.slice(seconds[0]).some(l => l[0] === 'load' && l[1] === 'splash.html'), 'מסך הפתיחה לא נפתח מעל החלונות: ' + JSON.stringify(res.log));
  assertNoQuitDuringBoot(res);
  assert.deepEqual(res.donors, []);
});

test('bootFailed: תקלה בעלייה ← הודעה בעברית ויציאה; בבדיקת עלייה (--smoke) — smoke.json עם השגיאה ויציאה 1', async () => {
  const plain = runBoot(bootDir('boot-fail'), { failProtocol: true });
  assert.ok(plain.log.some(l => l[0] === 'error' && l[1] === 'שגיאה בהפעלת התוכנה'), JSON.stringify(plain.log));
  assert.ok(plain.log.some(l => l[0] === 'quit'), JSON.stringify(plain.log));
  const dir = bootDir('boot-fail-smoke');
  const res = runBoot(dir, { failProtocol: true, args: ['--smoke', '--user-data-dir=' + dir] });
  assert.ok(res.log.some(l => l[0] === 'exit' && l[1] === 1), JSON.stringify(res.log));
  assert.ok(!res.log.some(l => l[0] === 'quit'), 'יוצאים דרך smoke.finish ולא app.quit: ' + JSON.stringify(res.log));
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'smoke.json'), 'utf8'));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(x => x.where === 'boot' && /boom-protocol/.test(x.message)), JSON.stringify(report.errors));
  assert.ok(report.errors.some(x => x.where === 'smoke' && x.message === 'boot-failed'), JSON.stringify(report.errors));
});
