// בדיקה חוזרת 21.10.2026 (audit-recheck-fixes.md, ממצא 1): מחסן מוצפן של מודול שהקובץ שלו לא נפתח (מצב locked).
// העמוד מקבל אחסון ריק, ו-collectBackup קרא אותו כ-{} — הגיבוי "הצליח" בלי נתוני המודול, והסבב מחק בגללו
// את הגיבויים הטובים. main.js האמיתי נטען עם Electron מדומה (כמו tests/backup-econ-failure.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bklock-'));
const bkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bklock-target-'));
// המסד עדיין פתוח בסוף ההרצה (Windows נועל אותו) — tools/run-tests.js מוחק את כל התיקייה הזמנית אחר כך
test.after(() => { for (const d of [userData, bkDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* נעול */ } } });
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
// קובץ המחסן של השמאות קיים ואינו נפתח (תקלת דיסק / קובץ פגום)
fs.writeFileSync(path.join(userData, 'secure-shamai.bin'), 'SSE1:corrupted-not-a-valid-envelope');

const handlers = {};
const created = { views: [] };
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
    // העמוד של מודול עם מחסן נעול מקבל אחסון ריק — בדיוק מה שהגיבוי קרא קודם
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, executeJavaScript: async () => '{}' });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}

class BrowserWindowStub {
  constructor() {
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

const dialogPlan = { save: { canceled: true } };
const dialogLog = [];
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};

const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData,
    on() {}, exit() {}, quit() {},
    isPackaged: false,
  }),
  BrowserWindow: BrowserWindowStub,
  WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} },
  dialog: {
    showSaveDialog: async () => { dialogLog.push(['save-dialog']); return dialogPlan.save; },
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async (_w, o) => { dialogLog.push(['box', (o || _w).message]); return { response: 1 }; },
    showErrorBox(t, m) { dialogLog.push(['error', m]); },
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(),
  safeStorage,
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? '/__electron_stub_bklock__.js' : origResolve.call(this, req, ...rest);
};
require.cache['/__electron_stub_bklock__.js'] = {
  id: '/__electron_stub_bklock__.js', filename: '/__electron_stub_bklock__.js', loaded: true, exports: electronStub,
};

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
      await handlers['shell:switch'](shellSender(), 'econ');
      const econView = created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
      await handlers['auth:setup']({ sender: { id: econView.id } }, 'admin_lock', 'admin-pass-long-1');
    })();
  }
  return ready;
}
const shellSender = () => ({ sender: { id: 1 } });

const OLD = Array.from({ length: 14 }, (_, i) => `auto-2000-01-${String(i + 1).padStart(2, '0')}.ssbk`);
const listDir = () => fs.readdirSync(bkDir).sort();
const snapshotDir = () => Object.fromEntries(listDir().map(f => [f, fs.readFileSync(path.join(bkDir, f), 'utf8')]));

test('גיבוי אוטומטי: מחסן נעול ← סטטוס כשל, לא נכתב קובץ ושום גיבוי ישן לא נמחק', async () => {
  await boot();
  for (const f of OLD) fs.writeFileSync(path.join(bkDir, f), 'old-' + f);
  const before = snapshotDir();
  const status = await autoBackup();
  assert.equal(status.ok, false, JSON.stringify(status));
  assert.equal(status.reason, 'module-read-failed');
  assert.deepEqual(snapshotDir(), before, 'אין קובץ חדש, ו-14 הגיבויים הישנים נשארו');
  const text = await handlers['shell:get-backup-status'](shellSender());
  assert.match(text, /^⚠ הגיבוי לא נשמר/);
  assert.match(text, /הנתונים המוצפנים של השמאות לא נפתחו/, 'אזהרה גלויה על המחסן הנעול, לא רק ביומן');
});

test('גיבוי ידני: מחסן נעול ← שגיאה בעברית שמסבירה את הסיבה, בלי חלון שמירה ובלי קובץ', async () => {
  await boot();
  for (const scope of ['all', 'shamai']) {
    const out = path.join(userData, `manual-${scope}.ssbk`);
    dialogPlan.save = { canceled: false, filePath: out };
    dialogLog.length = 0;
    await assert.rejects(handlers['shell:backup-all'](shellSender(), 'long-pass-123', scope), (e) => {
      assert.equal(e.code, 'module-read-failed');
      assert.match(e.message, /הנתונים המוצפנים של השמאות לא נפתחו.*הגיבוי לא נשמר/);
      assert.doesNotMatch(e.message, /secure store locked/, 'בלי טקסט טכני באנגלית למשתמש');
      return true;
    });
    assert.ok(!fs.existsSync(out), scope + ': לא נכתב קובץ');
    assert.deepEqual(dialogLog, [], scope + ': לא נפתח חלון שמירה');
  }
  dialogPlan.save = { canceled: true };
});

test('גיבוי של מודול אחר לא נחסם בגלל המחסן הנעול (בקרה)', async () => {
  await boot();
  const out = path.join(userData, 'manual-tools.ssbk');
  dialogPlan.save = { canceled: false, filePath: out };
  dialogLog.length = 0;
  const r = await handlers['shell:backup-all'](shellSender(), 'long-pass-123', 'tools');
  dialogPlan.save = { canceled: true };
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.existsSync(out));
});
