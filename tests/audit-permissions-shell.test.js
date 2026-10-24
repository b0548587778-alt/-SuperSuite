'use strict';
// רגרסיה לבדיקת הקוד 23.10.2026 (קבוצת "הרשאות", סבב הסוקר): גיבוי, קוד שחזור ויעד הגיבוי — מנהל בלבד,
// בהתנהגות ולא רק בטקסט של main.js; המעטפת לא מציעה למשתמש אחר צעדים של מנהל בלבד;
// והמסכים האישיים (התוכנית הפיננסית, ההוצאות האישיות) מציגים הודעה למי שאינו מנהל — בלי פנייה לשרת.
// החלק הראשון — main.js האמיתי עם Electron מדומה, כמו ב-backup-recovery-code.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const EconUI = require('./helpers/econ-ui');
const OB = require('../shell/onboarding');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-perm-shell-'));
test.after(() => {
  // ב-Windows קובץ מסד פתוח נעול — סוגרים לפני המחיקה
  try { require('../modules/econ/ipc').getDb().db.close(); } catch { /* כבר סגור */ }
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const handlers = {};
const created = { views: [] };
let readyCallback = null;
const ui = { open: null };

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
  constructor() {
    this.id = created.views.length + 100;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {} });
  }
  setVisible() {} setBounds() {}
}
class WinStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; } on() {} removeMenu() {} loadFile() {} maximize() {}
}
// DPAPI מדומה — הפיך, כדי שמפתח הגיבוי יישמר ויקרא
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('dp:' + s, 'utf8'),
  decryptString: (b) => b.toString('utf8').slice(3),
};
const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false,
  }),
  BrowserWindow: WinStub, WebContentsView: ViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { (global.__ssOn = global.__ssOn || {})[ch] = fn; } },
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => (ui.open ? { canceled: false, filePaths: [ui.open] } : { canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 1 }),
    showErrorBox: () => {},
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(), safeStorage,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_perm_shell__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_perm_shell__.js'] = { id: '/__electron_stub_perm_shell__.js', filename: '/__electron_stub_perm_shell__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...r) => realSetTimeout(fn, ms, ...r).unref();
global.setInterval = (fn, ms, ...r) => realSetInterval(fn, ms, ...r).unref();

const ADMIN = ['menahel', 'menahel-pass-long-1'];
const EDITOR = ['orech', 'orech-pass-long-12'];
let ready = null;
const shell = () => ({ sender: { id: 1 } });
const econ = () => ({ sender: { id: created.views[0].id } });
// קריאה לערוץ מהמעטפת; שגיאה סינכרונית (shellGuard) הופכת לדחייה
const call = async (ch, ...args) => handlers[ch](shell(), ...args);
const loginAs = ([u, p]) => handlers['auth:login'](econ(), u, p);
function boot() {
  ready = ready || (async () => {
    require(path.join(__dirname, '..', 'main.js'));
    await readyCallback();
    await handlers['shell:switch'](shell(), 'econ');
    await handlers['auth:setup'](econ(), ...ADMIN);
    await loginAs(ADMIN);
    await handlers['users:create'](econ(), { username: EDITOR[0], password: EDITOR[1], role: 'editor' });
  })();
  return ready;
}

test('עורך מחובר: קוד השחזור, אישור הרישום, יעד הגיבוי, גיבוי ידני, שחזור והגיבויים הגלויים — נדחים במעטפת', async () => {
  await boot();
  await loginAs(EDITOR);
  ui.open = userData; // אם השומר היה עובר — חלון הבחירה היה מחזיר תיקייה
  for (const [ch, ...args] of [['shell:get-recovery-code'], ['shell:recovery-code-saved'], ['shell:pick-backup-target'],
    ['shell:backup-all', 'סיסמת-גיבוי-ארוכה-1', 'all'], ['shell:restore-all', 'סיסמת-גיבוי-ארוכה-1'], ['shell:plain-backups']]) {
    await assert.rejects(call(ch, ...args), /אין הרשאה/, ch);
  }
  ui.open = null;
  const settings = path.join(userData, 'backup-settings.json');
  const saved = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : {};
  assert.equal(saved.recoveryCodeSavedAt, undefined, 'העורך לא סימן את הקוד כרשום');
  assert.equal(saved.targetDir, undefined, 'העורך לא שינה את יעד הגיבוי');
  // סטטוס הגיבוי נשאר גלוי לכולם, אבל בלי תזכורת על פעולה שרק מנהל יכול לבצע
  assert.doesNotMatch(await call('shell:get-backup-status') || '', /קוד שחזור/);
  assert.equal(await call('shell:is-admin'), false);
});

test('מנהל מחובר: אותם ערוצים עוברים את השומר, והתזכורת על קוד השחזור מוצגת עד שנרשם', async () => {
  await boot();
  await loginAs(ADMIN);
  assert.equal(await call('shell:is-admin'), true);
  assert.equal(await handlers['shell:is-admin']({ sender: { id: 999 } }), false, 'רק מהמעטפת');
  assert.match(await call('shell:get-backup-status'), /טרם נרשם קוד שחזור/);
  assert.match(await call('shell:get-recovery-code'), /^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/);
  ui.open = userData;
  assert.equal(await call('shell:pick-backup-target'), userData);
  ui.open = null;
  const plain = await call('shell:plain-backups');
  assert.ok(plain && Array.isArray(plain.files));
  // השומר עבר — השגיאה היא על הסיסמה הקצרה, לא על ההרשאה
  await assert.rejects(call('shell:backup-all', 'קצר', 'all'), /סיסמת הגיבוי חייבת/);
  assert.equal(await call('shell:recovery-code-saved'), true);
  assert.doesNotMatch(await call('shell:get-backup-status') || '', /קוד שחזור/);
});

// ---------- אשף ההתחלה במעטפת ----------

test('אשף ההתחלה: למי שאינו מנהל — בלי צעדי המשתמשים, יעד הגיבוי, קוד השחזור והתוכנית הפיננסית', () => {
  const keys = ['econ:settings', 'econ:personal-finance', 'econ:finance', 'econ:acct-personal', 'econ:tasks', 'econ:npo', 'econ:people', 'econ:dashboard'];
  const admin = OB.plan(['household', 'npo'], keys);
  const ids = admin.steps.map(s => s.id);
  for (const id of ['users', 'backup-target', 'recovery-code', 'household-plan']) assert.ok(ids.includes(id), id);
  assert.ok(admin.screens.includes('econ:personal-finance'), 'ברירת המחדל — מנהל, כמו קודם');

  const other = OB.plan(['household', 'npo'], keys, { admin: false });
  const otherIds = other.steps.map(s => s.id);
  for (const id of ['users', 'backup-target', 'recovery-code', 'household-plan']) assert.equal(otherIds.includes(id), false, id);
  assert.ok(otherIds.includes('npo-settings'), 'שאר הצעדים נשארים');
  for (const k of OB.ADMIN_KEYS) assert.equal(other.screens.includes(k), false, k);
  assert.ok(other.screens.includes('econ:tasks'));

  // המעטפת מעבירה את הדגל לאשף, ומעדכנת אותו מהשרת
  const shellJs = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');
  assert.equal((shellJs.match(/OB\.plan\(.*\{ admin: shellAdmin \}\)/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'shell', 'preload.js'), 'utf8'), /isAdmin: \(\) => ipcRenderer\.invoke\('shell:is-admin'\)/);
});

// ---------- המודול הכלכלי: מסכים של מנהל בלבד ----------

function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({
    id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, remove() {}
  }, extra);
}
async function settle(n = 14) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

async function econUi(permissions, { startView } = {}) {
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1', permissions }, configured: true });
      if (name === 'getAdvancedSettings') return () => Promise.resolve({ startView: startView || 'dashboard' });
      return (...args) => {
        calls.push(name);
        if (/^get(Invoices|Products|Chart|Journal|PersonalEntries)$/.test(name)) return Promise.resolve([]);
        if (name === 'getPersonalSummary') return Promise.resolve({ income: 0, expense: 0, balance: 0, count: 0, categories: [] });
        return Promise.resolve({});
      };
    }
  });
  const html = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'views', 'index.html'), 'utf8');
  const views = [...new Set([...html.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];
  const navButtons = views.map(view => fakeElement('', { dataset: { view } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  const goTo = async (view) => { navButtons[views.indexOf(view)]._listeners.click[0](); await settle(); };
  return { elements, calls, goTo, view: () => elements.view.innerHTML };
}

const PERSONAL_CALLS = ['getPersonalFinance', 'getPersonalEntries', 'getPersonalSummary'];

test('עורך: התוכנית הפיננסית, תכנון פיננסי וההוצאות האישיות — הודעה "למנהל בלבד", בלי פנייה לשרת', async () => {
  const h = await econUi(['data.view', 'data.edit', 'data.export']);
  for (const view of ['personal-finance', 'finance', 'acct-personal']) {
    await h.goTo(view);
    assert.match(h.view(), /למנהל המערכת בלבד/, view);
    assert.doesNotMatch(h.view(), /שגיאה|אין הרשאה/, view);
    assert.equal(h.elements.addBtn.hidden, true, `${view}: בלי כפתור הוספה`);
  }
  assert.deepEqual(h.calls.filter(c => PERSONAL_CALLS.includes(c)), [], 'גם לוח הבקרה לא מבקש את התוכנית הפיננסית');
  // מסך רגיל ממשיך לעבוד
  await h.goTo('acct-journal');
  assert.doesNotMatch(h.view(), /למנהל המערכת בלבד/);
});

test('עורך שמסך הפתיחה שהוגדר (בידי המנהל) הוא מסך אישי — נוחת על הודעה ולא על שגיאה', async () => {
  const h = await econUi(['data.view', 'data.edit'], { startView: 'personal-finance' });
  assert.match(h.view(), /למנהל המערכת בלבד/);
  assert.equal(h.calls.includes('getPersonalFinance'), false);
});

test('מנהל: המסכים האישיים נטענים כרגיל', async () => {
  const h = await econUi(['data.view', 'data.edit', 'users.manage']);
  assert.ok(h.calls.includes('getPersonalFinance'), 'לוח הבקרה של המנהל כולל את התוכנית');
  await h.goTo('acct-personal');
  assert.doesNotMatch(h.view(), /למנהל המערכת בלבד/);
  assert.ok(h.calls.includes('getPersonalEntries'));
  await h.goTo('personal-finance');
  assert.doesNotMatch(h.view(), /למנהל המערכת בלבד/);
});
