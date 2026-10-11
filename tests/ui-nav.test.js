// בדיקת התנהגות לניווט של מערכת הניהול: כל כפתור ניווט מציג כותרת בעברית, לא את מזהה התצוגה.
// unified-ui.js רץ ב-vm עם DOM מדומה, כפתורי הניווט נלקחים מ-views/index.html,
// ונלחץ כל כפתור כדי לבדוק את הכותרת שמוצגת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

function fakeElement(extra = {}) {
  const listeners = {};
  return Object.assign({
    textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    _listeners: listeners,
    appendChild() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
    showModal() {}, close() {}, scrollIntoView() {},
  }, extra);
}

test('כל תצוגת ניווט במערכת הכלכלית מציגה כותרת בעברית ולא מזהה גולמי', async () => {
  assert.ok(VIEWS.length >= 15, `נמצאו ${VIEWS.length} תצוגות בניווט`);

  const navButtons = VIEWS.map(view => fakeElement({ dataset: { view } }));
  const pageTitle = fakeElement();
  const systemAPI = new Proxy({}, { get: () => () => Promise.resolve(null) });
  const elements = {};
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= (id === 'pageTitle' ? pageTitle : fakeElement())); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {},
    createElement() { return fakeElement(); },
    body: fakeElement(),
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.systemAPI = systemAPI;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  vm.runInContext(UI_SRC, context, { filename: 'unified-ui.js' });
  await new Promise(r => setImmediate(r));

  for (let i = 0; i < VIEWS.length; i++) {
    const view = VIEWS[i];
    const handlers = navButtons[i]._listeners.click || [];
    assert.ok(handlers.length >= 1, `לכפתור ${view} יש מאזין לחיצה`);
    handlers[0]();
    const title = pageTitle.textContent;
    assert.match(title, /[֐-׿]/, `לתצוגה ${view} יש כותרת בעברית (התקבל: "${title}")`);
    assert.notEqual(title, view, `לתצוגה ${view} יש כותרת ידידותית, לא המזהה`);
  }
});
