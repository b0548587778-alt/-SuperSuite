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
  constructor(opts = {}) {
    this.id = created.views.length + 100;
    this.visible = undefined;
    this.opts = opts;
    this.sent = [];
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send: (...a) => this.sent.push(a),
      // בדיקות השחזור קובעות מה קוד שרץ בעמוד מחזיר או זורק
      executeJavaScript: async (code) => (global.__ssExec ? global.__ssExec(code, this) : chainable()) });
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
  loadFile(p) { this.file = String(p); }
  maximize() {}
}

const dialogPlan = { save: { canceled: true }, open: { canceled: true, filePaths: [] } };
const dialogLog = [];

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
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { (global.__ssOn = global.__ssOn || {})[ch] = fn; } },
  // dialog נשלט מהבדיקות: showSaveDialog מחזיר את הנתיב שהבדיקה קבעה
  dialog: {
    showSaveDialog: async () => dialogPlan.save,
    showOpenDialog: async () => dialogPlan.open,
    showMessageBox: async (_w, o) => { dialogLog.push(['box', o && o.message]); return { response: dialogPlan.boxResponse === undefined ? 1 : dialogPlan.boxResponse }; },
    showErrorBox(t, m) { dialogLog.push(['error', m]); },
  },
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
  // החלון הראשי = זה שטוען את המעטפת (לפניו נפתח מסך הפתיחה)
  const win = created.windows.find(w => /shell.html$/.test(w.file || ''));
  await handlers['shell:switch'](shellSender(), 'econ');
  // ארגז הכלים לא דורש כניסה (שמאי ואימונים — כן; ראו בדיקות login-gate)
  await handlers['shell:switch'](shellSender(), 'tools');

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

test('גיבוי ידני ליעד שנכשל בכתיבה (USB מלא/מנותק) מחזיר שגיאה בעברית', async () => {
  await boot();
  const econView = created.views[0];
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  AuthService.getSession(econView.id).permissions = ['data.view', 'data.backup'];
  // נתיב בתיקייה שאינה קיימת — כמו כונן שנותק בין בחירת הקובץ לשמירה
  dialogPlan.save = { canceled: false, filePath: path.join(userData, 'no-such-drive', 'b.ssbk') };
  await assert.rejects(handlers['shell:backup-all'](shellSender(), 'long-pass-123', 'econ'), /שמירת הגיבוי נכשלה/);
  dialogPlan.save = { canceled: true };
});

test('shell:open: פותח פריט מהקטלוג האחיד ומאמת מודול ותצוגה', async () => {
  await boot();
  const econView = created.views[0];
  assert.equal(await handlers['shell:open'](shellSender(), 'econ', 'acct-invoices'), true);
  assert.equal(econView.visible, true, 'המודול הכלכלי מוצג');
  assert.equal(await handlers['shell:open'](shellSender(), 'econ', 'no-such-view'), false, 'תצוגה לא מוכרת נחסמת');
  assert.equal(await handlers['shell:open'](shellSender(), 'shamai', 'acct-invoices'), false, 'תצוגה פנימית רק במודול הכלכלי');
  assert.equal(await handlers['shell:open'](shellSender(), 'evil'), false, 'מודול לא מוכר נחסם');
  assert.equal(await handlers['shell:open'](viewSender(econView), 'tools'), false, 'מודול לא מנווט דרך ערוץ המעטפת');
  assert.equal(await handlers['shell:open'](shellSender(), 'tools'), true);
});

test('shell:overlay: דיאלוג במעטפת מסתיר את המודול הפעיל ומחזיר אותו בסגירה', async () => {
  await boot();
  const econView = created.views[0];
  await handlers['shell:open'](shellSender(), 'econ', 'dashboard');
  assert.equal(await handlers['shell:overlay'](viewSender(econView), true), false, 'רק המעטפת רשאית');
  assert.equal(econView.visible, true);
  await handlers['shell:overlay'](shellSender(), true);
  assert.equal(econView.visible, false, 'המודול מוסתר בזמן הדיאלוג');
  await handlers['shell:switch'](shellSender(), 'econ');
  assert.equal(econView.visible, false, 'מעבר בזמן דיאלוג לא מכסה אותו');
  await handlers['shell:overlay'](shellSender(), false);
  assert.equal(econView.visible, true, 'בסגירה המודול חוזר');
});

test('shell:econ-view: רק המודול הכלכלי מדווח, ורק על תצוגה מוכרת', async () => {
  await boot();
  const econView = created.views[0];
  const otherView = created.views[1];
  assert.equal(await handlers['shell:econ-view'](viewSender(econView), 'tasks'), true);
  assert.equal(await handlers['shell:econ-view'](viewSender(econView), 'evil'), false);
  assert.equal(await handlers['shell:econ-view'](viewSender(otherView), 'tasks'), false);
  assert.equal(await handlers['shell:econ-view'](shellSender(), 'tasks'), false);
});

test('מסכי האימונים בסרגל האחיד: פתיחה לפי הקטלוג, preload ייעודי, ודיווח רק מהמודול עצמו', async () => {
  await boot();
  const Catalog = require(path.join(ROOT, 'shell', 'catalog.js'));
  const econView = created.views[0];
  assert.equal(await handlers['shell:open'](shellSender(), 'trainer', 'nutrition'), true);
  const trainerView = created.views.find(v => /trainer[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
  assert.ok(trainerView, 'מודול האימונים נטען עם ה-preload שלו');
  assert.equal(trainerView.visible, true);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(trainerView.sent.at(-1), ['trainer:goto', Catalog.TRAINER_LABELS.nutrition], 'נשלח הטקסט של הכפתור בסרגל הפנימי');
  assert.equal(await handlers['shell:open'](shellSender(), 'trainer', 'acct-invoices'), false, 'תצוגה של מודול אחר נחסמת');
  assert.equal(await handlers['shell:open'](shellSender(), 'econ', 'nutrition'), false);
  // דיווח המסך הפעיל
  assert.equal(await handlers['shell:trainer-view'](viewSender(trainerView), Catalog.TRAINER_LABELS.cardio), true);
  assert.equal(await handlers['shell:trainer-view'](viewSender(trainerView), 'לא קיים'), false, 'טקסט לא מוכר נדחה');
  assert.equal(await handlers['shell:trainer-view'](viewSender(trainerView), { x: 1 }), false);
  assert.equal(await handlers['shell:trainer-view'](viewSender(econView), Catalog.TRAINER_LABELS.cardio), false, 'מודול אחר לא מדווח בשם האימונים');
  assert.equal(await handlers['shell:trainer-view'](shellSender(), Catalog.TRAINER_LABELS.cardio), false);
});

test('trainer:save-pdf: רק מתצוגת האימונים, PDF מהתצוגה עצמה לקובץ שנבחר (PLAN.md 6.4)', async () => {
  await boot();
  await handlers['shell:open'](shellSender(), 'trainer', 'nutrition');
  const trainerView = created.views.find(v => /trainer[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
  const econView = created.views[0];
  const printed = [];
  const sender = { id: trainerView.id, printToPDF: async (o) => { printed.push(o); return Buffer.from('%PDF-1.4 test'); } };
  // מודול אחר והמעטפת — נדחים בלי חלון שמירה
  dialogPlan.save = { canceled: false, filePath: path.join(userData, 'x.pdf') };
  assert.deepEqual(await handlers['trainer:save-pdf']({ sender: { ...sender, id: econView.id } }, 'א'), { ok: false });
  assert.deepEqual(await handlers['trainer:save-pdf']({ sender: { ...sender, id: 1 } }, 'א'), { ok: false });
  assert.equal(printed.length, 0);
  // ביטול בחלון השמירה — בלי הדפסה
  dialogPlan.save = { canceled: true };
  assert.deepEqual(await handlers['trainer:save-pdf']({ sender }, 'תוכנית אימון'), { ok: false });
  assert.equal(printed.length, 0);
  const out = path.join(userData, 'trainer-test.pdf');
  dialogPlan.save = { canceled: false, filePath: out };
  assert.deepEqual(await handlers['trainer:save-pdf']({ sender }, 'תוכנית אימון — יצחק'), { ok: true });
  assert.equal(fs.readFileSync(out, 'utf8'), '%PDF-1.4 test');
  assert.equal(printed[0].pageSize, 'A4');
  assert.equal(printed[0].printBackground, true);
  // שגיאת כתיבה — הודעה בעברית, לא קריסה
  dialogPlan.save = { canceled: false, filePath: path.join(userData, 'no-such-dir', 'y.pdf') };
  const r = await handlers['trainer:save-pdf']({ sender }, 'א');
  assert.equal(r.ok, false);
  assert.match(r.error, /שמירת הקובץ נכשלה/);
  dialogPlan.save = { canceled: true };
});

test('shell:catalog-extras: רק המעטפת מקבלת את רשימת המסכים החדשים', async () => {
  await boot();
  const r = await handlers['shell:catalog-extras'](shellSender());
  assert.ok(Array.isArray(r));
  assert.deepEqual(await handlers['shell:catalog-extras'](viewSender(created.views[0])), []);
});

test('הגדרות לוח: נשמרות מהמעטפת בלבד, קלט לא תקין מסונן, והזום לא מוחק אותן', async () => {
  await boot();
  assert.equal(await handlers['shell:save-calendar'](viewSender(created.views[0]), { city: 'haifa' }), null);
  const s = await handlers['shell:save-calendar'](shellSender(), { city: 'haifa', candles: 99, shabbatMode: 'x', evil: 1 });
  assert.equal(s.city, 'haifa');
  assert.equal(s.candles, 30, 'ערך מחוץ לטווח נפסל ונשאר ברירת המחדל של העיר');
  assert.equal(s.shabbatMode, true);
  assert.equal('evil' in s, false);
  const ui = path.join(userData, 'ui-settings.json');
  const before = JSON.parse(fs.readFileSync(ui, 'utf8'));
  fs.writeFileSync(ui, JSON.stringify({ ...before, zoom: 1.2 }));
  assert.equal((await handlers['shell:get-calendar'](shellSender())).city, 'haifa');
});

test('אחורה/קדימה: חזרה למודול הקודם ולמסך הבית; רק המעטפת רשאית', async () => {
  await boot();
  await handlers['shell:home'](shellSender());
  await handlers['shell:switch'](shellSender(), 'tools');
  await handlers['shell:switch'](shellSender(), 'shamai');
  const visible = () => created.views.filter(v => v.visible).length;
  assert.equal(await handlers['shell:history-go'](shellSender(), -1), true);
  assert.equal(visible(), 1, 'חזר למודול הקודם');
  assert.equal(await handlers['shell:history-go'](shellSender(), -1), true);
  assert.equal(visible(), 0, 'חזר למסך הבית — כל המודולים מוסתרים');
  assert.equal(await handlers['shell:history-go'](shellSender(), 1), true, 'קדימה');
  assert.equal(visible(), 1);
  assert.equal(await handlers['shell:history-go'](viewSender(created.views[0]), -1), false, 'מודול לא מנווט בהיסטוריה');
});

test('מכשירים מחוברים: כל ערוצי sync: רשומים, ונדחים משולח זר ומהמעטפת בלי כניסת מנהל', async () => {
  await boot();
  const channels = ['sync:status', 'sync:set-enabled', 'sync:rename', 'sync:set-port', 'sync:create-invite', 'sync:cancel-invite',
    'sync:join', 'sync:approve', 'sync:reject', 'sync:connect', 'sync:ping', 'sync:revoke'];
  for (const ch of channels) {
    assert.equal(typeof handlers[ch], 'function', ch + ' רשום');
    assert.throws(() => handlers[ch]({ sender: { id: 999 } }), /מתוך המעטפת בלבד/, ch + ': שולח זר');
  }
  // תצוגת מודול (לא המעטפת) — נדחית גם היא
  assert.throws(() => handlers['sync:set-enabled'](viewSender(created.views[0]), true), /מתוך המעטפת בלבד/);
});

test('שמאי ואימונים: בלי כניסה — מסך הכניסה, ואחרי כניסה המודול נפתח; יציאה — חזרה למסך הכניסה', async () => {
  await boot();
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  const econView = created.views[0];
  const econSender = viewSender(econView);
  await handlers['shell:home'](shellSender());
  AuthService.sessions.clear();
  const visibleViews = () => created.views.filter(v => v.visible);

  await handlers['shell:open'](shellSender(), 'trainer', 'nutrition');
  assert.deepEqual(visibleViews(), [econView], 'במקום האימונים — המודול הכלכלי (מסך הכניסה)');
  await new Promise(r => setImmediate(r));
  assert.ok(econView.sent.some(([ch]) => ch === 'econ:auth-check'), 'הממשק הכלכלי מתבקש לבדוק שוב את הכניסה');

  // כניסה ← האימונים נפתחים, כולל המסך שנבחר
  await handlers['auth:login'](econSender, 'restore_viewer', 'viewer-pass-long-1');
  const trainerView = created.views.find(v => /trainer[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
  assert.deepEqual(visibleViews(), [trainerView], 'אחרי הכניסה — מודול האימונים');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(trainerView.sent.at(-1), ['trainer:goto', require(path.join(ROOT, 'shell', 'catalog.js')).TRAINER_LABELS.nutrition]);

  // יציאה בזמן שהאימונים פתוחים ← חזרה למסך הכניסה, והאימונים חוזרים אחרי כניסה נוספת
  await handlers['auth:logout'](econSender);
  assert.deepEqual(visibleViews(), [econView]);
  await handlers['auth:login'](econSender, 'restore_viewer', 'viewer-pass-long-1');
  assert.deepEqual(visibleViews(), [trainerView]);

  // ארגז הכלים פתוח גם בלי כניסה
  AuthService.sessions.clear();
  await handlers['shell:switch'](shellSender(), 'tools');
  assert.equal(visibleViews().length, 1);
  assert.notEqual(visibleViews()[0], econView);
  // בלי כניסה, מעבר לארגז הכלים ביטל בקשה ישנה: כניסה לא פותחת שום מודול אחר
  await handlers['shell:switch'](shellSender(), 'shamai');
  await handlers['shell:switch'](shellSender(), 'tools');
  const toolsView = visibleViews()[0];
  await handlers['auth:login'](econSender, 'restore_viewer', 'viewer-pass-long-1');
  assert.deepEqual(visibleViews(), [toolsView]);
});

// PLAN.md 3.4: קובץ שאינו נתוני אימונים תקינים נעצר לפני האישור — הנתונים הקיימים לא נמחקים
test('שחזור: קובץ אימונים פגום נעצר לפני האישור ולפני כל מחיקה; קובץ JSON ישן תקין מגיע לאישור', async () => {
  await boot();
  const econView = created.views[0];
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  await handlers['auth:login'](viewSender(econView), 'restore_viewer', 'viewer-pass-long-1');
  AuthService.getSession(econView.id).permissions = ['data.view', 'data.restore'];
  const file = (name, data) => { const f = path.join(userData, name); fs.writeFileSync(f, JSON.stringify(data)); return f; };

  // גיבוי של SuperSuite שבו נתוני האימונים פגומים (רשימת מתאמנים שאינה רשימה)
  const broken = { suite: 'SuperSuite', version: 2, scope: 'trainer', econ: null,
    localStorage: { trainer: { 'clients:index': '{"a":1}', 'client:c_1': '{}' } } };
  dialogPlan.open = { canceled: false, filePaths: [file('broken.json', broken)] };
  dialogLog.length = 0;
  assert.deepEqual(await handlers['shell:restore-all'](shellSender(), ''), { ok: false });
  assert.equal(dialogLog.length, 1);
  assert.equal(dialogLog[0][0], 'error', 'שגיאה — בלי חלון אישור');
  assert.match(dialogLog[0][1], /רשימת המתאמנים.*לא שוחזר דבר/);

  // קובץ JSON של "ייצוא גיבוי" הישן של המודול: מזוהה ומגיע לאישור (המשתמש מבטל בבדיקה)
  const legacy = { 'trainer:profile': '{"name":"משה כהן"}', 'clients:index': '["c_1"]', 'client:c_1': '{"id":"c_1","name":"יעקב לוי"}' };
  dialogPlan.open = { canceled: false, filePaths: [file('trainer-pro-backup.json', legacy)] };
  dialogLog.length = 0;
  assert.deepEqual(await handlers['shell:restore-all'](shellSender(), ''), { ok: false });
  assert.deepEqual(dialogLog, [['box', 'השחזור יחליף את הנתונים הקיימים (גיבוי ישן של ניהול האימונים)']]);

  // קובץ JSON אחר לגמרי — לא גיבוי
  dialogPlan.open = { canceled: false, filePaths: [file('other.json', { name: 'קובץ אחר' })] };
  dialogLog.length = 0;
  await handlers['shell:restore-all'](shellSender(), '');
  assert.deepEqual(dialogLog, [['error', 'הקובץ אינו גיבוי של SuperSuite']]);
  dialogPlan.open = { canceled: true, filePaths: [] };
});

// PLAN.md 3.6: ערוצי הגיבויים הגלויים — רק מהמעטפת ורק עם הרשאת גיבוי
test('גיבויים גלויים: ערוצים חסומים לתצוגת מודול ולמשתמש בלי הרשאת גיבוי', async () => {
  await boot();
  const econView = created.views[0];
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  await handlers['auth:login'](viewSender(econView), 'restore_viewer', 'viewer-pass-long-1');
  for (const ch of ['shell:plain-backups', 'shell:plain-backup-encrypt', 'shell:plain-backup-delete']) {
    assert.throws(() => handlers[ch](viewSender(econView), 'x.json'), /מתוך המעטפת בלבד/, ch);
  }
  AuthService.getSession(econView.id).permissions = ['data.view'];
  for (const ch of ['shell:plain-backups', 'shell:plain-backup-encrypt', 'shell:plain-backup-delete']) {
    assert.throws(() => handlers[ch](shellSender(), 'x.json'), ch);
  }
  // עם הרשאה: הרשימה מתיקיית הגיבוי שנבחרה
  AuthService.getSession(econView.id).permissions = ['data.view', 'data.backup'];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pb-'));
  fs.writeFileSync(path.join(dir, 'auto-2026-01-01.json'), JSON.stringify({ suite: 'SuperSuite', version: 2, localStorage: {} }));
  const settings = path.join(userData, 'backup-settings.json');
  const before = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null;
  fs.writeFileSync(settings, JSON.stringify({ targetDir: dir }));
  try {
    const r = handlers['shell:plain-backups'](shellSender());
    assert.deepEqual(r.files.map(f => f.name), ['auto-2026-01-01.json']);
    assert.match(r.warning, /לא מוצפן/);
    // בלי הצפנת Windows (במדומה) — אין הצפנה, רק מחיקה
    assert.equal(r.canEncrypt, false);
    assert.throws(() => handlers['shell:plain-backup-encrypt'](shellSender(), 'auto-2026-01-01.json'), /אינה זמינה/);
    assert.ok(fs.existsSync(path.join(dir, 'auto-2026-01-01.json')), 'לא נמחק');
    handlers['shell:plain-backup-delete'](shellSender(), 'auto-2026-01-01.json');
    assert.ok(!fs.existsSync(path.join(dir, 'auto-2026-01-01.json')));
  } finally {
    if (before === null) fs.rmSync(settings, { force: true }); else fs.writeFileSync(settings, before);
  }
});

// שחזור מלא שנכשל באמצע: הכספים כבר שוחזרו ומודול אחר נכשל ← הכול חוזר למצב שלפני, בלי "השחזור הושלם"
test('שחזור: כשל באמצע מחזיר את הכספים למצב שלפני השחזור', async () => {
  await boot();
  const econView = created.views[0];
  const { AuthService } = require(path.join(ROOT, 'modules/econ/services/authService'));
  await handlers['auth:login'](viewSender(econView), 'restore_viewer', 'viewer-pass-long-1');
  AuthService.getSession(econView.id).permissions = ['data.view', 'data.restore'];
  const db = require(path.join(ROOT, 'modules/econ/ipc')).getDb();
  const current = await db.backup();
  current.organization = { ...(current.organization || {}), name: 'גמ"ח אהבת חסד — לפני' };
  await db.restore(current);

  const incoming = await db.backup();
  incoming.organization = { ...incoming.organization, name: 'גמ"ח אהבת חסד — מהגיבוי' };
  const file = path.join(userData, 'partial.json');
  fs.writeFileSync(file, JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: incoming, localStorage: { tools: { 'tools:last': 'מחשבון' } } }));

  let writes = 0;
  global.__ssExec = async (code) => {
    if (code.includes('localStorage.clear()')) { writes++; if (writes === 1) throw new Error('המודול לא נטען'); return undefined; }
    return JSON.stringify({ 'tools:last': 'ישן' });
  };
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.boxResponse = 0;
  dialogLog.length = 0;
  try {
    assert.deepEqual(await handlers['shell:restore-all'](shellSender(), ''), { ok: false });
  } finally {
    delete global.__ssExec; delete dialogPlan.boxResponse;
    dialogPlan.open = { canceled: true, filePaths: [] };
  }
  assert.equal((await db.backup()).organization.name, 'גמ"ח אהבת חסד — לפני', 'הכספים לא הוחזרו');
  assert.equal(writes, 2, 'המודול לא הוחזר לנתונים הישנים');
  const err = dialogLog.find(d => d[0] === 'error');
  assert.ok(err && /המודול לא נטען.*הוחזרו למצב שלפני/.test(err[1]), JSON.stringify(dialogLog));
  assert.ok(!dialogLog.some(d => d[1] === 'השחזור הושלם'));
});
