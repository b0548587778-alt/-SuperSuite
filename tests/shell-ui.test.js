// בדיקות התנהגות ל-shell/shell.js: הסקריפט רץ ב-vm עם DOM ו-shellAPI מדומים,
// ובודקים מה הוא עושה כשהמשתמש נכנס למודול הכלכלי (ולא את הטקסט של הקובץ).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');
const CATALOG_SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'catalog.js'), 'utf8');
const HEBCAL_SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'hebcal.js'), 'utf8');

function fakeElement() {
  const l = {};
  return {
    _l: l, hidden: false, focus() {}, blur() {}, select() {},
    textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { l[ev] = fn; }, appendChild() {}, querySelector() { return fakeElement(); },
    querySelectorAll() { return []; }, showModal() {}, close() {}, setAttribute() {},
  };
}

function load(overrides = {}) {
  const elements = {};
  const listeners = { active: null, cmd: null, activeView: null };
  const calls = { getBackupTarget: 0, isLoggedIn: 0, open: [], overlay: [] };
  let loggedIn = false;
  let target = '/backups/east';
  const shellAPI = {
    switchTo: async () => true,
    backupAll: async () => ({ ok: false }),
    restoreAll: async () => ({ ok: false }),
    isLoggedIn: async () => { calls.isLoggedIn++; return loggedIn; },
    getBackupTarget: async () => { calls.getBackupTarget++; return target; },
    pickBackupTarget: async () => null,
    goHome: async () => {},
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    setOverlay: async (on) => { calls.overlay.push(on); return true; },
    onActiveView: (cb) => { listeners.activeView = cb; },
    quit: async () => {},
    onActive: (cb) => { listeners.active = cb; },
    onCmd: (cb) => { listeners.cmd = cb; },
    ...overrides,
  };
  const document = {
    getElementById(id) { return (elements[id] ||= fakeElement()); },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return fakeElement(); },
    body: fakeElement(),
  };
  const context = { document, window: {}, console, confirm: () => true, alert() {}, prompt: () => null, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, Intl, Date, Math, localStorage: { getItem: () => null, setItem() {} } };
  context.window = context;
  context.shellAPI = shellAPI;
  context.window.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  vm.runInContext(HEBCAL_SRC, context, { filename: 'hebcal.js' });
  vm.runInContext(CATALOG_SRC, context, { filename: 'catalog.js' });
  vm.runInContext(SRC, context, { filename: 'shell.js' });
  return {
    ctx: context, calls, elements,
    setLoggedIn(v) { loggedIn = v; },
    emitActive(id) { listeners.active && listeners.active(id); },
    emitCmd(cmd) { listeners.cmd && listeners.cmd(cmd); },
  };
}

const flush = () => new Promise(r => setImmediate(r));

test('יעד הגיבוי לא מבוקש לפני כניסה למודול הכלכלי', async () => {
  const s = load();
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 0, 'לא מבקשים יעד בלי כניסה');
  assert.equal(s.calls.isLoggedIn, 1, 'בודקים בשקט אם יש כניסה');
});

test('אחרי כניסה, מעבר למודול הכלכלי מציג את יעד הגיבוי', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 1);
  assert.equal(s.elements.tgInfo.textContent, 'גיבוי אוטומטי ליעד: /backups/east');
});

test('מעבר למודול אחר לא מפעיל את הרענון', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('shamai');
  await flush();
  assert.equal(s.calls.isLoggedIn, 0);
  assert.equal(s.calls.getBackupTarget, 0);
});

test('אחרי שהיעד הוצג פעם אחת, לא מבקשים אותו שוב', async () => {
  const s = load();
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  s.emitActive('econ');
  await flush();
  assert.equal(s.calls.getBackupTarget, 1);
});

test('אם אין יעד מוגדר, מוצג טקסט ברירת המחדל', async () => {
  const s = load({ getBackupTarget: async () => '' });
  s.setLoggedIn(true);
  s.emitActive('econ');
  await flush();
  assert.equal(s.elements.tgInfo.textContent, 'גיבוי אוטומטי: תיקיית המסמכים');
});

test('לחיצה על פריט בסרגל פותחת את המודול והתצוגה המתאימים', () => {
  const s = load();
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'econ:acct-invoices' } }) } });
  assert.deepEqual(s.calls.open.at(-1), ['econ', 'acct-invoices']);
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'shamai' } }) } });
  assert.deepEqual(s.calls.open.at(-1), ['shamai', null]);
  s.elements.nav.onclick({ target: { closest: () => ({ dataset: { key: 'evil' } }) } });
  assert.equal(s.calls.open.length, 2, 'מפתח לא מוכר לא פותח דבר');
});

test('חיפוש מסנן את הסרגל לפי שם הפריט', () => {
  const s = load();
  s.elements.q.value = 'חשבוניות';
  s.elements.q._l.input();
  const html = s.elements.nav.innerHTML;
  assert.match(html, /data-key="econ:acct-invoices"/);
  assert.doesNotMatch(html, /data-key="trainer"/);
  s.elements.q.value = 'אין-כזה-דבר';
  s.elements.q._l.input();
  assert.match(s.elements.nav.innerHTML, /לא נמצא/);
});

test('מסך הבית מציג את כל התחומים ואת כל הפריטים', () => {
  const s = load();
  const html = s.elements.groups.innerHTML;
  for (const it of s.ctx.SUITE_CATALOG.ITEMS) assert.ok(html.includes('data-key="' + it.key + '"'), it.key);
});

test('דיאלוג המדריך מסתיר את המודול הפעיל ומחזיר אותו בסגירה', () => {
  const s = load();
  s.emitCmd('help');
  assert.deepEqual(s.calls.overlay, [true]);
  s.elements.guideOk.onclick();
  assert.deepEqual(s.calls.overlay, [true, false]);
});
