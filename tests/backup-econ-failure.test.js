// בדיקת הקוד 20.10.2026 — ממצא 1 (גיבוי שנכשל מדווח "הצליח" ומוחק גיבוי תקין) וממצא 6 (קובצי הגדרות בלי הגנה
// מניתוק חשמל). main.js האמיתי נטען עם Electron מדומה (כמו tests/main-behavior.test.js), עם "DPAPI" מדומה,
// והגיבוי האוטומטי נלכד מהטיימר של העלייה — כך נבדקת ההתנהגות ולא הטקסט של הקובץ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bkfail-'));
const bkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bkfail-target-'));
// יעד הגיבוי בתוך תיקייה זמנית, ומצב שבת כבוי — אחרת בשבת הגיבוי נדחה והבדיקה תלויה ביום
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));

const handlers = {};
const created = { views: [], windows: [] };
let noDocuments = false;
let moduleDumpFails = false; // קריאת localStorage של מודול נכשלת (בדיקת module-read-failed)
let readyCallback = null;

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

class WebContentsViewStub {
  constructor(opts = {}) {
    this.id = created.views.length + 100;
    this.opts = opts;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {},
      executeJavaScript: async () => { if (moduleDumpFails) throw new Error('Script failed to execute'); return '{}'; },
      // ה-localStorage הישן של מודול שעוד לא הועבר למחסן המוצפן (ממצא 36) — כאן ריק
      executeJavaScriptInIsolatedWorld: async () => '{}' });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}

class BrowserWindowStub {
  constructor() {
    created.windows.push(this);
    this.contentView = { addChildView() {} };
    this.webContents = chainable({ id: 1, isDestroyed: () => false });
  }
  isDestroyed() { return false; }
  isMaximized() { return false; }
  isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); }
  getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; }
  on() {}
  removeMenu() {}
  loadFile(p) { this.file = String(p); }
  maximize() {}
}

const dialogPlan = { save: { canceled: true }, open: { canceled: true, filePaths: [] } };
const dialogLog = [];
// "DPAPI" מדומה: הצפנה הפיכה בתחילית, כדי שמפתח הגיבוי האוטומטי ייווצר ויקרא כמו במחשב אמיתי
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};

const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    // noDocuments: מחשב שאין בו תיקיית "מסמכים" — Electron זורק (כמו במחשב של הבעלים, 24.10.2026)
    getPath: (name) => { if (name === 'documents' && noDocuments) throw new Error("Failed to get 'documents' path"); return userData; },
    on() {}, exit() {}, quit() {},
    isPackaged: false,
  }),
  BrowserWindow: BrowserWindowStub,
  WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} },
  dialog: {
    showSaveDialog: async () => { dialogLog.push(['save-dialog']); return dialogPlan.save; },
    showOpenDialog: async () => dialogPlan.open,
    showMessageBox: async (_w, o) => { dialogLog.push(['box', (o || _w).message]); return { response: 1 }; },
    showErrorBox(t, m) { dialogLog.push(['error', m]); },
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(),
  safeStorage,
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? '/__electron_stub_bkfail__.js' : origResolve.call(this, req, ...rest);
};
require.cache['/__electron_stub_bkfail__.js'] = {
  id: '/__electron_stub_bkfail__.js', filename: '/__electron_stub_bkfail__.js', loaded: true, exports: electronStub,
};

// הגיבוי האוטומטי מתוזמן 15 שניות אחרי העלייה: הבדיקה לוכדת אותו ומריצה אותו בעצמה (ולא ברקע)
let autoBackup = null;
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => {
  if (ms === 15000 && fn && fn.name === 'autoBackup') { autoBackup = fn; return { unref() {}, ref() {} }; }
  return realSetTimeout(fn, ms, ...rest).unref();
};
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

let ready = null;
function boot() {
  if (!ready) {
    ready = (async () => {
      require(path.join(ROOT, 'main.js'));
      await readyCallback();
      assert.equal(typeof autoBackup, 'function', 'הגיבוי האוטומטי תוזמן בעלייה');
      // מנהל ראשון מחובר במודול הכלכלי — הגיבוי מהמעטפת דורש הרשאת data.backup
      await handlers['shell:switch'](shellSender(), 'econ');
      const econView = created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
      await handlers['auth:setup']({ sender: { id: econView.id } }, 'admin_bk', 'admin-pass-long-1');
    })();
  }
  return ready;
}
const shellSender = () => ({ sender: { id: 1 } });
const econDb = () => require(path.join(ROOT, 'modules', 'econ', 'ipc.js')).getDb();

// קריאת הכספים נכשלת (מפתח שהשתנה, קובץ נעול, תקלת דיסק) — כמו בהרצה שבדוח
async function withBrokenEcon(fn) {
  const db = econDb();
  db.backup = async () => { const e = new Error('db-key-mismatch'); e.code = 'db-key-mismatch'; throw e; };
  try { return await fn(); } finally { delete db.backup; }
}

const OLD = Array.from({ length: 14 }, (_, i) => `auto-2000-01-${String(i + 1).padStart(2, '0')}.ssbk`);
const listDir = () => fs.readdirSync(bkDir).sort();
const snapshotDir = () => Object.fromEntries(listDir().map(f => [f, fs.readFileSync(path.join(bkDir, f), 'utf8')]));
const backupSettings = () => JSON.parse(fs.readFileSync(path.join(userData, 'backup-settings.json'), 'utf8'));
// כל בדיקה מתחילה מתיקיית גיבוי עם 14 גיבויים ישנים בלבד ומהגדרות ידועות — לא ממה שבדיקה אחרת השאירה
// (גיבוי של היום, יעד אחר), כדי שתרוץ גם לבד או בסדר אחר
function freshBackupState(settings = {}) {
  for (const f of fs.readdirSync(bkDir)) fs.rmSync(path.join(bkDir, f), { recursive: true, force: true });
  for (const f of OLD) fs.writeFileSync(path.join(bkDir, f), 'old-' + f);
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir, ...settings }));
}

test('גיבוי אוטומטי: כשל בקריאת הכספים ← סטטוס כשל, לא נכתב קובץ ולא נמחק גיבוי ישן', async () => {
  await boot();
  freshBackupState();
  const before = snapshotDir();
  const status = await withBrokenEcon(() => autoBackup());
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'econ-read-failed');
  assert.deepEqual(snapshotDir(), before, 'אין קובץ חדש, אין .tmp, ושום גיבוי ישן לא נמחק');
  assert.equal(backupSettings().lastAutoBackup.reason, 'econ-read-failed', 'הסטטוס נשמר להצגה במסך הבית');
  // מסך הבית: אזהרה ברורה, לעולם לא "הצליח"
  const text = await handlers['shell:get-backup-status'](shellSender());
  assert.match(text, /^⚠ הגיבוי לא נשמר — קריאת הנתונים הכספיים נכשלה/);
  assert.doesNotMatch(text, /הצליח/);
  // הסיבה המקורית נרשמה ביומן התקלות (לתמיכה)
  assert.match(fs.readFileSync(path.join(userData, 'crash.log'), 'utf8'), /\[backup-econ-read\][^\n]*db-key-mismatch/);
});

test('גיבוי אוטומטי תקין (בקרה): נכתב גיבוי עם הכספים, והישן ביותר מתחלף רק אז', async () => {
  await boot();
  freshBackupState();
  const status = await autoBackup();
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.ok(!listDir().includes(OLD[0]), 'הרוטציה (14) רצה רק אחרי גיבוי תקין');
  assert.equal(listDir().filter(f => /^auto-.*\.ssbk$/.test(f)).length, 14);
  const BK = require(path.join(ROOT, 'modules', 'econ', 'core', 'backupCrypto.js'));
  const key = safeStorage.decryptString(fs.readFileSync(path.join(userData, 'autobackup.key')));
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(status.file, 'utf8'), key));
  assert.ok(data.econ && typeof data.econ === 'object', 'הגיבוי מכיל את הכספים');
  assert.equal('econError' in data, false);
  assert.match(await handlers['shell:get-backup-status'](shellSender()), /גיבוי אחרון הצליח/);
});

test('גיבוי ידני: כשל בקריאת הכספים ← שגיאה בעברית, בלי חלון שמירה, בלי קובץ ובלי "הגיבוי נשמר"', async () => {
  await boot();
  for (const scope of ['all', 'econ']) {
    const out = path.join(userData, `manual-${scope}.ssbk`);
    dialogPlan.save = { canceled: false, filePath: out };
    dialogLog.length = 0;
    await withBrokenEcon(() => assert.rejects(handlers['shell:backup-all'](shellSender(), 'long-pass-123', scope), (e) => {
      assert.equal(e.code, 'econ-read-failed');
      assert.match(e.message, /הנתונים הכספיים.*הגיבוי לא נשמר/);
      assert.doesNotMatch(e.message, /db-key-mismatch/, 'בלי טקסט טכני באנגלית למשתמש');
      return true;
    }));
    assert.ok(!fs.existsSync(out), scope + ': לא נכתב קובץ');
    assert.deepEqual(dialogLog, [], scope + ': לא נפתח חלון שמירה ולא הוצגה הודעת "נשמר"');
  }
  dialogPlan.save = { canceled: true };
});

test('גיבוי ידני של מודול בלי כספים לא נפגע מתקלה בכספים (בקרה: הודעת "נשמר" כן מוצגת)', async () => {
  await boot();
  const out = path.join(userData, 'manual-tools.ssbk');
  dialogPlan.save = { canceled: false, filePath: out };
  dialogLog.length = 0;
  const r = await withBrokenEcon(() => handlers['shell:backup-all'](shellSender(), 'long-pass-123', 'tools'));
  dialogPlan.save = { canceled: true };
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.existsSync(out));
  assert.ok(dialogLog.some(d => d[0] === 'box' && d[1] === 'הגיבוי נשמר ומוצפן'));
});


// כשל בקריאת מודול (ארגז הכלים / שמאות / אימונים) — גם הוא כשל של הגיבוי כולו, ולא {} שקט
async function withBrokenModules(fn) {
  moduleDumpFails = true;
  try { return await fn(); } finally { moduleDumpFails = false; }
}

test('גיבוי: כשל בקריאת מודול ← שגיאה בעברית, בלי קובץ; בגיבוי האוטומטי — סטטוס כשל בלי מחיקה', async () => {
  await boot();
  const out = path.join(userData, 'manual-tools-broken.ssbk');
  dialogPlan.save = { canceled: false, filePath: out };
  dialogLog.length = 0;
  await withBrokenModules(() => assert.rejects(handlers['shell:backup-all'](shellSender(), 'long-pass-123', 'tools'), (e) => {
    assert.equal(e.code, 'module-read-failed');
    assert.match(e.message, /ארגז הכלים.*הגיבוי לא נשמר/);
    assert.doesNotMatch(e.message, /Script failed/, 'בלי טקסט טכני באנגלית למשתמש');
    return true;
  }));
  dialogPlan.save = { canceled: true };
  assert.ok(!fs.existsSync(out), 'לא נכתב קובץ');
  assert.deepEqual(dialogLog, [], 'לא נפתח חלון שמירה ולא הוצגה הודעת "נשמר"');
  // תיקייה בלי גיבוי של היום — אחרת הסבב מדלג בלי לאסוף
  freshBackupState();
  const before = snapshotDir();
  const status = await withBrokenModules(() => autoBackup());
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'module-read-failed');
  assert.deepEqual(snapshotDir(), before, 'אין קובץ חדש ושום גיבוי ישן לא נמחק');
  assert.match(await handlers['shell:get-backup-status'](shellSender()), /^⚠ הגיבוי לא נשמר — קריאת הנתונים של אחד המודולים נכשלה/);
  assert.match(fs.readFileSync(path.join(userData, 'crash.log'), 'utf8'), /\[backup-module-read\][^\n]*Script failed/);
});
/* ---------- ממצא 6: saveJson — קובץ זמני והחלפה ---------- */
const uiFile = path.join(userData, 'ui-settings.json');
const crashLog = () => (fs.existsSync(path.join(userData, 'crash.log')) ? fs.readFileSync(path.join(userData, 'crash.log'), 'utf8') : '');

// החלפה זמנית של פונקציות fs (main.js משתמש באותו אובייקט fs). fdPath — לאיזה קובץ שייך מתאר פתוח
function patchFs(overrides) {
  const orig = {};
  const fdPath = new Map();
  orig.openSync = fs.openSync;
  fs.openSync = function (p, ...rest) { const fd = orig.openSync.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  for (const [name, make] of Object.entries(overrides)) {
    orig[name] = orig[name] || fs[name];
    fs[name] = make(orig[name], (a) => (typeof a === 'number' ? fdPath.get(a) || '' : String(a)));
  }
  return () => { for (const [name, fn] of Object.entries(orig)) fs[name] = fn; };
}

test('saveJson: כתיבה לקובץ זמני, fsync והחלפה — בלי שארית', async () => {
  await boot();
  const renames = [];
  let fsyncs = 0;
  const restore = patchFs({
    renameSync: (orig) => function (a, b) { renames.push([String(a), String(b)]); return orig.call(fs, a, b); },
    fsyncSync: (orig) => function (fd) { fsyncs++; return orig.call(fs, fd); },
  });
  try { await handlers['shell:save-calendar'](shellSender(), { city: 'haifa' }); } finally { restore(); }
  assert.deepEqual(renames.filter(r => r[1] === uiFile), [[uiFile + '.tmp', uiFile]]);
  assert.ok(fsyncs >= 1, 'התוכן נכתב לדיסק לפני ההחלפה');
  assert.ok(!fs.existsSync(uiFile + '.tmp'));
  const saved = JSON.parse(fs.readFileSync(uiFile, 'utf8'));
  assert.equal(saved.calendar.city, 'haifa');
  assert.equal(saved.calendar.shabbatMode, false, 'מיזוג — שאר ההגדרות נשמרו');
});

test('saveJson: ניתוק באמצע הכתיבה ← הקובץ הקודם שלם, הזמני נמחק, והשגיאה ביומן', async () => {
  await boot();
  const before = fs.readFileSync(uiFile, 'utf8');
  // חצי מהתוכן נכתב ואז הכונן "נעלם" — כמו כיבוי באמצע
  const restore = patchFs({
    writeFileSync: (orig, target) => function (a, data, ...rest) {
      if (target(a).startsWith(uiFile)) { orig.call(fs, a, String(data).slice(0, 7), ...rest); const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e; }
      return orig.call(fs, a, data, ...rest);
    },
  });
  try { await handlers['shell:save-calendar'](shellSender(), { city: 'bnei-brak' }); } finally { restore(); }
  assert.equal(fs.readFileSync(uiFile, 'utf8'), before, 'הקובץ הקודם לא נפגע');
  JSON.parse(fs.readFileSync(uiFile, 'utf8'));
  assert.ok(!fs.existsSync(uiFile + '.tmp'), 'אין שארית של קובץ זמני');
  assert.match(crashLog(), /\[settings-save\][^\n]*ENOSPC/);
});

test('saveJson: החלפה שנכשלה ← הקובץ הקודם נשאר; יעד גיבוי שלא נשמר מחזיר שגיאה בעברית', async () => {
  await boot();
  // הגדרות ידועות עם סטטוס גיבוי קודם — כדי לבדוק שהמיזוג לא מוחק אותו (בלי להסתמך על בדיקה קודמת)
  freshBackupState({ lastAutoBackup: { ok: true, at: '2026-10-01T08:00:00.000Z' } });
  const settingsFile = path.join(userData, 'backup-settings.json');
  const before = fs.readFileSync(settingsFile, 'utf8');
  const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bkfail-usb-'));
  dialogPlan.open = { canceled: false, filePaths: [usb] };
  const restore = patchFs({
    renameSync: (orig) => function (a, b) {
      if (String(b) === settingsFile) { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; }
      return orig.call(fs, a, b);
    },
  });
  try {
    await assert.rejects(handlers['shell:pick-backup-target'](shellSender()), /בחירת יעד הגיבוי לא נשמרה/);
  } finally { restore(); dialogPlan.open = { canceled: true, filePaths: [] }; }
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), before, 'היעד הקודם (וכל ההגדרות) נשארו');
  assert.equal(backupSettings().targetDir, bkDir);
  assert.ok(!fs.existsSync(settingsFile + '.tmp'));
  assert.match(crashLog(), /\[settings-save\][^\n]*EPERM/);
  // בלי תקלה — היעד נשמר
  dialogPlan.open = { canceled: false, filePaths: [usb] };
  try { assert.equal(await handlers['shell:pick-backup-target'](shellSender()), usb); }
  finally { dialogPlan.open = { canceled: true, filePaths: [] }; }
  assert.equal(backupSettings().targetDir, usb);
  assert.ok(backupSettings().lastAutoBackup, 'מיזוג — הסטטוס הקודם לא נמחק');
});

test('גיבוי אוטומטי: מחשב בלי תיקיית "מסמכים" — הגיבוי נכתב לתיקייה שנבחרה (פעם — שגיאה בכל סבב)', async () => {
  await boot();
  noDocuments = true;
  try {
    const before = fs.readdirSync(bkDir).filter(f => /^auto-.*.ssbk$/.test(f)).length;
    const status = await autoBackup();
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.ok(fs.readdirSync(bkDir).filter(f => /^auto-.*.ssbk$/.test(f)).length >= Math.min(before + 1, 1), 'נכתב גיבוי');
  } finally { noDocuments = false; }
});
