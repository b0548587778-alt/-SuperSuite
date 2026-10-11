// בדיקות התנהגות ל-main.js: הקובץ נטען באמת, עם Electron מדומה שמתעד את הקריאות.
// כך בודקים מה main.js עושה (הוספת תצוגות, החלפת נראות, בקרת הרשאות) ולא את הטקסט של הקובץ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-main-'));
const handlers = {};
const created = { views: [], windows: [] };
let readyCallback = null;

// אובייקט "לכל דבר": כל מאפיין או קריאה מחזירים עוד אובייקט כזה, עד שמגדירים ערך ספציפי.
function chainable(props = {}) {
  const target = function () { return chainable(); };
  return new Proxy(target, {
    get(_t, key) {
      if (key in props) return props[key];
      if (key === 'then') return undefined; // לא להפוך לפרומיס בטעות
      if (key === Symbol.toPrimitive) return () => 0;
      return chainable();
    },
    apply() { return chainable(); },
  });
}

class WebContentsViewStub {
  constructor() {
    this.id = created.views.length + 100;
    this.visible = undefined;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}

class BrowserWindowStub {
  constructor() {
    created.windows.push(this);
    this.calls = [];
    this.contentView = { addChildView: (v) => this.calls.push(['addChildView', v]) };
    this.webContents = chainable({ id: 1, isDestroyed: () => false });
  }
  isDestroyed() { return false; }
  isMaximized() { return false; }
  isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getContentBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
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
    getPath: () => userData,
    on() {},
    exit() {},
    quit() {},
    isPackaged: false,
  }),
  BrowserWindow: BrowserWindowStub,
  WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: chainable(),
  protocol: chainable(),
  net: chainable(),
  session: chainable(),
  shell: chainable(),
  Menu: chainable(),
  safeStorage: chainable({ isEncryptionAvailable: () => false }),
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? '/__electron_stub_main__.js' : origResolve.call(this, req, ...rest);
};
require.cache['/__electron_stub_main__.js'] = {
  id: '/__electron_stub_main__.js', filename: '/__electron_stub_main__.js', loaded: true, exports: electronStub,
};

const ROOT = path.join(__dirname, '..');

// main.js מתזמן גיבוי אוטומטי (setTimeout/setInterval) שמחזיק את התהליך פתוח.
// בזמן הבדיקות הטיימרים לא צריכים לחסום את סיום הקובץ, לכן הם נעשים unref.
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms, ...rest).unref();
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();
let ready = null;

async function boot() {
  if (ready) return ready;
  ready = (async () => {
    require(path.join(ROOT, 'main.js'));
    assert.equal(typeof readyCallback, 'function', 'main.js רושם callback ל-whenReady');
    await readyCallback();
  })();
  return ready;
}

const shellSender = () => ({ sender: { id: 1 } });
const viewSender = (view) => ({ sender: { id: view.id } });

test('תצוגות מודול מתווספות לחלון ומוחלפות לפי המודול הפעיל', async () => {
  await boot();
  const win = created.windows[0];
  await handlers['shell:switch'](shellSender(), 'econ');
  await handlers['shell:switch'](shellSender(), 'shamai');

  const econView = created.views.find(v => v.id >= 100 && v.webContents.id === v.id);
  const added = win.calls.filter(c => c[0] === 'addChildView').map(c => c[1]);
  assert.ok(added.length >= 2, 'שני מודולים נוספו לחלון');
  assert.ok(added.includes(created.views[0]), 'התצוגה הראשונה נוספה לחלון');
  assert.equal(created.views[0].visible, false, 'מודול שאינו פעיל מוסתר');
  assert.equal(created.views[1].visible, true, 'המודול הפעיל מוצג');
  assert.ok(econView);
});

test('shell:switch: תצוגת מודול לא יכולה לנווט דרך הערוץ של המעטפת', async () => {
  await boot();
  const moduleView = created.views[0];
  const result = await handlers['shell:switch'](viewSender(moduleView), 'tools');
  assert.equal(result, false, 'מודול לא מנווט דרך shell:switch');
});

test('shell:open-module: מודול יכול לפתוח מודול אחר, ושולח זר נחסם', async () => {
  await boot();
  const econView = created.views[0];
  assert.equal(await handlers['shell:open-module'](viewSender(econView), 'trainer'), true);
  assert.equal(await handlers['shell:open-module'](shellSender(), 'trainer'), false, 'המעטפת לא עוברת את הערוץ הזה');
  assert.equal(await handlers['shell:open-module'](viewSender(econView), 'evil'), false, 'מזהה לא מוכר נחסם');
});

test('גיבוי מהמעטפת דורש הרשאה של המשתמש במודול הכלכלי ולא "יש כניסה כלשהי"', async () => {
  await boot();
  // שולח שאינו המעטפת נדחה מיד
  assert.throws(() => handlers['shell:backup-all']({ sender: { id: 999 } }, 'pass', 'all'), /מתוך המעטפת בלבד/);
  // המעטפת בלי כניסה למודול הכלכלי נדחית
  assert.throws(() => handlers['shell:backup-all'](shellSender(), 'pass', 'all'));
});

test('שחזור מהמעטפת: מודול כלכלי מחובר בלי הרשאת שחזור נדחה', async () => {
  await boot();
  const econView = created.views[0];
  const econSender = viewSender(econView);
  await handlers['auth:setup'](econSender, 'restore_viewer', 'viewer-pass-long-1');
  await handlers['auth:login'](econSender, 'restore_viewer', 'viewer-pass-long-1');
  // מוריד את ההרשאות לצפייה בלבד, כמו במשתמש שאינו רשאי לשחזר
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  AuthService.getSession(econView.id).permissions = ['data.view'];
  assert.throws(() => handlers['shell:restore-all'](shellSender(), 'pass'));
});
