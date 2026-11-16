// שלב 4 ברישוי: חסימת מודולים לפי הרישיון ב-main.js, ומסך "מערכת מושבתת" במעטפת.
// main.js נטען עם Electron מדומה ומודול כלכלי מדומה שמצב הרישוי שלו נשלט מהבדיקה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const LG = require('../shell/licensing/gate');

const ROOT = path.join(__dirname, '..');
const LOCKED = { mode: 'licensed', status: 'locked', features: ['econ', 'shamai'], reasons: [{ kind: 'locked', reason: 'חוב פתוח' }] };
const SUSPENDED = { mode: 'licensed', status: 'suspended', features: ['econ', 'tools'], reasons: [{ kind: 'suspended', reason: 'בדיקה' }] };
const ACTIVE_ECON_ONLY = { mode: 'licensed', status: 'active', features: ['econ'], reasons: [] };

test('שער: מסכי רישוי והודעות תמיד פתוחים; סיכום מצב למעטפת', () => {
  assert.equal(LG.viewAllowed(LOCKED, 'econ', 'licensing'), true);
  assert.equal(LG.viewAllowed(LOCKED, 'econ', 'messages'), true);
  assert.equal(LG.viewAllowed(LOCKED, 'econ', 'dashboard'), false);
  assert.equal(LG.viewAllowed(LOCKED, 'shamai', 'licensing'), false, 'החריג רק במערכת הכלכלית');
  assert.deepEqual(LG.shellState({ mode: 'unlicensed' }).level, 'ok');
  const l = LG.shellState(LOCKED);
  assert.equal(l.level, 'blocked');
  assert.match(l.message, /נעולה: חוב פתוח/);
  assert.deepEqual(l.modules, { econ: false, shamai: false, tools: false, trainer: false, english: false, math: false, school: false });
  const s = LG.shellState(SUSPENDED);
  assert.equal(s.level, 'limited');
  assert.equal(s.modules.tools, true);
  assert.equal(s.modules.shamai, false, 'מודול שאינו ברישיון');
  assert.equal(s.modules.trainer, false, 'מודול לימוד שאינו ברישיון');
  assert.equal(LG.shellState(ACTIVE_ECON_ONLY).modules.shamai, false);
});

// ---------- main.js ----------
const sent = [];
const handlers = {};
const views = [];
let readyCallback = null;
let licState = { mode: 'unlicensed' };
let licListener = null;

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
const loadedContents = (id, log) => chainable({ id, isDestroyed: () => false, isLoading: () => false,
  send: (ch, arg) => log.push([ch, arg]) });
class WebContentsViewStub {
  constructor() { this.id = views.length + 100; this.visible = undefined; this.sent = []; views.push(this); this.webContents = loadedContents(this.id, this.sent); }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}
class BrowserWindowStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = loadedContents(1, sent); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; } on() {} removeMenu() {} loadFile() {} maximize() {}
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-shell-'));
const electronStub = {
  app: chainable({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false }),
  BrowserWindow: BrowserWindowStub, WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { (global.__ssOn = global.__ssOn || {})[ch] = fn; } },
  dialog: { showErrorBox() {}, showMessageBox: async () => ({ response: 1 }) },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(),
  safeStorage: chainable({ isEncryptionAvailable: () => false }),
};
const econStub = {
  initEcon: async () => {}, licenseState: () => licState, onLicenseChange: (fn) => { licListener = fn; },
  getDb: () => ({}), assertAccess: () => { throw new Error('אין הרשאה'); }, isLoggedIn: () => false,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? '/__electron_stub_lic__.js' : origResolve.call(this, req, ...rest);
};
require.cache['/__electron_stub_lic__.js'] = { id: '/__electron_stub_lic__.js', filename: '/__electron_stub_lic__.js', loaded: true, exports: electronStub };
const ipcPath = require.resolve(path.join(ROOT, 'modules/econ/ipc'));
require.cache[ipcPath] = { id: ipcPath, filename: ipcPath, loaded: true, exports: econStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...r) => realSetTimeout(fn, ms, ...r).unref();
global.setInterval = (fn, ms, ...r) => realSetInterval(fn, ms, ...r).unref();

let booted = null;
const boot = () => (booted ||= (async () => { require(path.join(ROOT, 'main.js')); await readyCallback(); })());
const shell = { sender: { id: 1 } };
const tick = () => new Promise(r => setImmediate(r));
const viewOf = (i) => views[i];

test('main: מודול שאינו ברישיון לא נפתח; במערכת נעולה — המודול הכלכלי נפתח רק למסך הרישוי', async () => {
  await boot();
  licState = ACTIVE_ECON_ONLY;
  sent.length = 0;
  // ספירה יחסית: הבדיקה לא מניחה שהיא הראשונה שיוצרת תצוגות (רצה גם לבד או בסדר אחר)
  const before = views.length;
  await handlers['shell:open'](shell, 'shamai');
  assert.equal(views.length, before, 'תצוגת השמאי לא נוצרה');
  assert.ok(sent.some(([ch, st]) => ch === 'shell:license' && st.modules.shamai === false), 'המעטפת קיבלה את המצב');

  licState = LOCKED;
  await handlers['shell:open'](shell, 'econ', 'acct-invoices');
  await tick();
  const econ = viewOf(before);
  assert.ok(econ, 'המודול הכלכלי נפתח');
  const gotos = econ.sent.filter(([ch]) => ch === 'econ:goto').map(([, v]) => v);
  assert.ok(gotos.length && gotos.every(v => v === 'licensing'), 'כל ניווט הופנה למסך הרישוי: ' + gotos);
  // ניווט פנימי במודול למסך חסום — מוחזר למסך הרישוי
  econ.sent.length = 0;
  assert.equal(await handlers['shell:econ-view']({ sender: { id: econ.id } }, 'dashboard'), false);
  await tick();
  assert.deepEqual(econ.sent.filter(([ch]) => ch === 'econ:goto').map(([, v]) => v), ['licensing']);
  assert.equal(await handlers['shell:econ-view']({ sender: { id: econ.id } }, 'messages'), true, 'הודעות פתוחות');
  assert.equal(handlers['shell:license-state'](shell).level, 'blocked');
  assert.equal(handlers['shell:license-state']({ sender: { id: econ.id } }), null, 'רק המעטפת');
});

test('main: שינוי סטטוס בזמן עבודה — יוצאים ממודול שנחסם', async () => {
  await boot();
  licState = SUSPENDED;
  await handlers['shell:open'](shell, 'tools');
  const tools = views.find(v => v.visible);
  assert.ok(tools, 'ארגז הכלים פתוח במצב השבתה זמנית (קריאה בלבד)');
  licState = LOCKED;
  sent.length = 0;
  licListener(LOCKED);
  assert.equal(tools.visible, false, 'המודול הוסתר');
  assert.ok(sent.some(([ch, id]) => ch === 'shell:active' && id === null), 'חזרה למסך הבית');
  assert.ok(sent.some(([ch, st]) => ch === 'shell:license' && st.level === 'blocked'));
});

// ---------- המעטפת ----------
function loadShell(state) {
  const elements = {};
  const calls = { open: [] };
  let onLic = null;
  const fake = () => ({ hidden: false, focus() {}, blur() {}, select() {}, textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {},
    querySelector() { return fake(); }, querySelectorAll() { return []; }, showModal() {}, close() {}, setAttribute() {} });
  const shellAPI = { switchTo: async () => true, goHome: async () => {}, open: async (id, view) => { calls.open.push([id, view]); return true; },
    onActive() {}, onCmd() {}, isLoggedIn: async () => false, getLicenseState: async () => state, onLicense: (cb) => { onLic = cb; } };
  const document = { getElementById: (id) => (elements[id] ||= fake()), querySelector: () => fake(), querySelectorAll: () => [], addEventListener() {},
    createElement: () => fake(), body: fake() };
  const ctx = { document, console, confirm: () => true, alert() {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, Date, Math,
    localStorage: { getItem: () => null, setItem() {} } };
  ctx.window = ctx; ctx.window.shellAPI = shellAPI;
  vm.createContext(ctx);
  for (const f of ['hebcal.js', 'catalog.js', 'shell.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'shell', f), 'utf8'), ctx, { filename: f });
  const click = (key) => elements.home.onclick({ target: { closest: () => ({ dataset: { key } }) } });
  return { elements, calls, click, emit: (st) => onLic(st) };
}

test('מעטפת: מסך "מערכת מושבתת" עם סיבה, פריטים חסומים, ומעבר למסך הרישוי', async () => {
  const s = loadShell(LG.shellState(LOCKED));
  await tick();
  assert.equal(s.elements.licBlock.hidden, false);
  assert.match(s.elements.licBlock.innerHTML, /נעולה: חוב פתוח/);
  assert.match(s.elements.licBlock.innerHTML, /לא נמחקו/);
  assert.match(s.elements.nav.innerHTML, /class="it[^"]* off" data-key="shamai"/);
  assert.doesNotMatch(s.elements.nav.innerHTML, /off" data-key="econ:licensing"/, 'מסך הרישוי לא חסום');
  s.click('shamai');
  assert.deepEqual(s.calls.open, [], 'פריט חסום לא נפתח');
  s.click('econ:licensing');
  assert.deepEqual(s.calls.open, [['econ', 'licensing']]);
  // חידוש הרישיון — המסך נעלם
  s.emit(LG.shellState({ mode: 'licensed', status: 'active', features: ['econ', 'shamai', 'tools'] }));
  assert.equal(s.elements.licBlock.hidden, true);
  assert.equal(s.elements.licBar.hidden, true);
});

test('מעטפת: השבתה זמנית — פס אזהרה "צפייה, ייצוא וגיבוי בלבד"', async () => {
  const s = loadShell(LG.shellState(SUSPENDED));
  await tick();
  assert.match(s.elements.licBar.textContent, /צפייה, ייצוא וגיבוי בלבד/);
  assert.match(s.elements.licBlock.className, /limited/);
});
