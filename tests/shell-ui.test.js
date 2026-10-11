// בדיקות התנהגות ל-shell/shell.js: הסקריפט רץ ב-vm עם DOM ו-shellAPI מדומים,
// ובודקים מה הוא עושה כשהמשתמש נכנס למודול הכלכלי (ולא את הטקסט של הקובץ).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');

function fakeElement() {
  return {
    textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, querySelector() { return fakeElement(); },
    querySelectorAll() { return []; }, showModal() {}, close() {}, setAttribute() {},
  };
}

function load(overrides = {}) {
  const elements = {};
  const listeners = { active: null, cmd: null };
  const calls = { getBackupTarget: 0, isLoggedIn: 0 };
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
  const context = { document, window: {}, console, confirm: () => true, alert() {}, prompt: () => null, setTimeout, clearTimeout };
  context.window = context;
  context.shellAPI = shellAPI;
  context.window.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: 'shell.js' });
  return {
    ctx: context, calls, elements,
    setLoggedIn(v) { loggedIn = v; },
    emitActive(id) { listeners.active && listeners.active(id); },
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
