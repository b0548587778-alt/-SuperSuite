'use strict';
// main.js האמיתי עם Electron מדומה, יחד עם ה-preload של המחסן (shell/secure-ls-preload.js): עולם מבודד
// (require('electron') ו-localStorage של הדפדפן) ועולם העמוד, שאליו הפונקציה מועתקת כטקסט — כמו executeInMainWorld,
// כך שמשתנה מבחוץ שהפונקציה נשענת עליו היה נכשל כאן. כל קובץ בדיקה רץ בתהליך משלו — main.js נטען פעם אחת לקובץ.
// משמש את tests/audit-secure-store.test.js (עם הצפנת Windows) ואת tests/audit-secure-store-plain.test.js (בלי).
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const Module = require('module');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'shell', 'secure-ls-preload.js'), 'utf8');

// localStorage של הדפדפן: המפתחות הם מאפיינים (Object.entries מחזיר רק נתונים, כמו בדפדפן),
// ומעבר למכסה — QuotaExceededError. limits.quota ניתן לשינוי בבדיקה
function browserStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  const limits = { quota: Infinity };
  const used = () => { let n = 0; for (const [k, v] of mem) n += k.length + v.length; return n; };
  const api = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => {
      const key = String(k), val = String(v), before = mem.get(key);
      mem.set(key, val);
      if (used() > limits.quota) {
        if (before === undefined) mem.delete(key); else mem.set(key, before);
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    },
    removeItem: (k) => { mem.delete(String(k)); },
    clear: () => mem.clear(),
  };
  const ls = new Proxy(api, {
    get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && mem.has(k) ? mem.get(k) : undefined)),
    ownKeys: () => [...mem.keys()],
    getOwnPropertyDescriptor: (o, k) => (typeof k === 'string' && mem.has(k) ? { value: mem.get(k), enumerable: true, configurable: true, writable: true } : undefined),
  });
  return { ls, mem, limits };
}

function createMainHarness({ encryption = true } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-store-main-'));
  test.after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* המסד פתוח */ } });
  fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: path.join(userData, 'bk') }));
  fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
  const safeStorage = {
    isEncryptionAvailable: () => encryption,
    encryptString: (s) => { if (!encryption) throw new Error('אין הצפנה'); return Buffer.from('K:' + s); },
    decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
  };
  const handlers = {};
  const onHandlers = {};
  const created = { views: [] };
  const dialogPlan = { save: { canceled: true }, log: [] };
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
      this.url = '';
      this.listeners = {};
      this.browser = browserStorage();
      created.views.push(this);
      const self = this;
      this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {},
        loadURL: (u) => { self.url = String(u); },
        on: (ev, fn) => { (self.listeners[ev] = self.listeners[ev] || []).push(fn); return self.webContents; },
        executeJavaScript: async () => '{}',
        // העולם המבודד של main.js: שם localStorage הוא האחסון של הדפדפן (ולא העותק של ה-preload)
        executeJavaScriptInIsolatedWorld: async (_world, scripts) => vm.runInNewContext(scripts[0].code, { localStorage: self.browser.ls }) });
    }
    emit(ev, ...args) { for (const fn of this.listeners[ev] || []) fn(...args); }
    setVisible(v) { this.visible = v; }
    setBounds() {}
  }
  class BrowserWindowStub {
    constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
    isDestroyed() { return false; }
    isMaximized() { return false; }
    isMinimized() { return false; }
    getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
    getNormalBounds() { return this.getBounds(); }
    getContentBounds() { return this.getBounds(); }
    getContentSize() { return [1500, 940]; }
    on() {}
    removeMenu() {}
    loadFile() {}
    maximize() {}
  }
  const electronStub = {
    app: chainable({
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
      getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false,
    }),
    BrowserWindow: BrowserWindowStub, WebContentsView: WebContentsViewStub,
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { onHandlers[ch] = fn; }, removeHandler() {} },
    dialog: {
      showSaveDialog: async () => dialogPlan.save,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async (a, b) => { dialogPlan.log.push((b || a).message); return { response: 0 }; },
      showErrorBox: (t, m) => { dialogPlan.log.push(m); }
    },
    protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(), safeStorage,
  };
  const STUB = '/__electron_stub_secure_store_main__.js';
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? STUB : origResolve.call(this, req, ...rest); };
  require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: electronStub };
  const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
  global.setTimeout = (fn, ms, ...rest) => (ms === 15000 && fn && fn.name === 'autoBackup' ? { unref() {}, ref() {} } : realSetTimeout(fn, ms, ...rest).unref());
  global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

  const shellSender = () => ({ sender: { id: 1 } });
  const econView = () => created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
  const modView = (mod) => created.views.find(v => v.url.startsWith(`app://${mod}/`));
  const econ = () => ({ sender: { id: econView().id } });
  const ADMIN = ['menahel', 'menahel-pass-long-1'];
  let ready = null;
  function boot() {
    ready = ready || (async () => {
      require(path.join(ROOT, 'main.js'));
      await readyCallback();
      await handlers['shell:switch'](shellSender(), 'econ');
      await handlers['auth:setup'](econ(), ...ADMIN);
      for (const [username, role] of [['tzofe', 'viewer'], ['roeh_cheshbon', 'accountant'], ['orech', 'editor']]) {
        await handlers['users:create'](econ(), { username, password: username + '-pass-long-1', role });
      }
      await handlers['shell:switch'](shellSender(), 'shamai');
      await handlers['shell:switch'](shellSender(), 'trainer');
      assert.ok(modView('shamai') && modView('trainer'), 'שתי התצוגות נוצרו');
    })();
    return ready;
  }
  const loginAs = (username) => handlers['auth:login'](econ(), username, username === ADMIN[0] ? ADMIN[1] : username + '-pass-long-1');

  // קריאה לערוץ sync כמו מה-preload: התשובה ב-returnValue
  function ipcSync(view, ch, ...args) {
    const e = { sender: { id: view.id } };
    onHandlers[ch](e, ...args);
    return e.returnValue;
  }

  // ה-preload האמיתי בטעינה של עמוד המודול. legacy — נתונים ב-localStorage של הדפדפן לפני הטעינה
  function runPreload(mod, legacy = {}) {
    const view = modView(mod);
    for (const [k, v] of Object.entries(legacy)) view.browser.mem.set(k, v);
    const page = vm.createContext({ DOMException });
    page.window = page;
    const electron = {
      ipcRenderer: { sendSync: (ch, ...a) => ipcSync(view, ch, ...a), send: (ch, ...a) => { ipcSync(view, ch, ...a); } },
      contextBridge: { executeInMainWorld: ({ func, args }) => vm.runInContext('(' + func.toString() + ')', page)(...args) },
    };
    const iso = { location: { protocol: 'app:', host: mod } };
    iso.top = iso;
    vm.runInNewContext(PRELOAD, { require: (m) => { assert.equal(m, 'electron'); return electron; }, location: iso.location, localStorage: view.browser.ls, window: iso });
    return { page, browser: view.browser, legacyMem: view.browser.mem, run: (code) => vm.runInContext(code, page) };
  }

  return { ROOT, userData, handlers, onHandlers, created, dialogPlan, boot, loginAs, ipcSync, runPreload, shellSender, econView, modView, econ, ADMIN };
}

module.exports = { createMainHarness, browserStorage };
