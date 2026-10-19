// המסכים הראשונים (PLAN.md 7.2): מסך כניסה ומנהל ראשון, מצב ריק אחיד
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');

// DOM מינימלי — מספיק לדיאלוגים של ui/dialogs.js
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), children: [], parent: null, className: '', textContent: '', innerHTML: '', value: '', type: '', name: '',
    style: {}, attrs: {}, listeners: {}, focused: false,
    classList: { add: (c) => { e.className = (e.className + ' ' + c).trim(); }, remove() {}, contains: (c) => e.className.split(' ').includes(c) },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    prepend(c) { c.parent = this; this.children.unshift(c); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    fire(t, ev = {}) { (this.listeners[t] || []).forEach(fn => fn({ preventDefault() {}, ...ev })); },
    focus() { this.focused = true; },
  };
  return e;
}
const all = (root) => [root, ...root.children.flatMap(all)];
const find = (root, pred) => all(root).find(pred);
const text = (root) => all(root).map(x => x.textContent).join(' ');

function boot(api) {
  const docListeners = {};
  const body = el('body');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', body, createElement: el, addEventListener(t, fn) { docListeners[t] = fn; }, removeEventListener() {},
      getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  context.window.systemAPI = api;
  vm.createContext(context);
  EconUI.run(context);
  vm.runInContext('elements.toastContainer = { appendChild() {} }', context);
  return { context, body, docListeners };
}

test('מנהל ראשון: מסך מלא עם לוגו, הסבר על הסיסמה, אימות סיסמה ובלי "ביטול"', async () => {
  const calls = [];
  const { context, body, docListeners } = boot({ setupAdmin: async (u, p) => { calls.push([u, p]); return { username: u }; } });
  const done = vm.runInContext('setupAdmin()', context);
  const overlay = body.children[0];
  assert.match(overlay.className, /auth-screen/);
  const card = overlay.children[0];
  assert.match(card.className, /auth-card/);
  assert.match(find(card, x => /auth-head/.test(x.className)).innerHTML, /<svg[\s\S]*SuperSuite/);
  const t = text(card);
  assert.match(t, /יצירת מנהל ראשון/);
  assert.match(t, /אי אפשר לשחזר/);
  assert.match(t, /(בוקר טוב|צהריים טובים|ערב טוב|לילה טוב) — ברוכים הבאים/);
  assert.ok(!find(card, x => x.tagName === 'BUTTON' && x.textContent === 'ביטול'), 'אין ביטול במסך מלא');

  // Escape לא סוגר את המסך
  docListeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(body.children.length, 1);

  const inputs = all(card).filter(x => x.tagName === 'INPUT');
  assert.deepEqual(inputs.map(i => i.name), ['username', 'password', 'password2']);
  assert.equal(inputs[1].autocomplete, 'new-password');
  const form = find(card, x => x.tagName === 'FORM');
  const err = form.children.find(x => x.tagName === 'DIV' && x.style.color);
  inputs[0].value = 'menahel'; inputs[1].value = 'a-very-long-pass-2026'; inputs[2].value = 'other-pass-2026-xxx';
  form.fire('submit');
  assert.match(err.textContent, /אינה זהה/);
  assert.equal(calls.length, 0);

  inputs[2].value = 'a-very-long-pass-2026';
  form.fire('submit');
  await done;
  assert.deepEqual(calls, [['menahel', 'a-very-long-pass-2026']], 'רק שם וסיסמה נשלחים — הערוץ לא השתנה');
  assert.equal(body.children.length, 0);
});

test('כניסה: מסך מלא, ו-Google רק כשהוא מוגדר', async () => {
  for (const enabled of [false, true]) {
    const { context, body } = boot({
      authStatus: async () => ({ configured: true, google: { enabled } }),
      googleLogin: async () => ({ username: 'g' }),
      login: async (u) => ({ username: u }),
    });
    const done = vm.runInContext('loginUser()', context);
    await new Promise(r => setImmediate(r));
    const card = body.children[0].children[0];
    assert.match(body.children[0].className, /auth-screen/);
    assert.match(text(card), /התחברות למערכת/);
    assert.match(text(card), /נא להתחבר/);
    const google = find(card, x => x.tagName === 'BUTTON' && x.textContent === 'כניסה עם Google');
    assert.equal(!!google, enabled);
    const inputs = all(card).filter(x => x.tagName === 'INPUT');
    inputs[0].value = 'menahel'; inputs[1].value = 'pass';
    find(card, x => x.tagName === 'FORM').fire('submit');
    await done;
    assert.equal(vm.runInContext('state.user && state.user.username', context), 'menahel');
  }
});

test('ברכה לפי השעה', () => {
  const { context } = boot({});
  const at = (h) => vm.runInContext(`authGreeting(new Date(2026, 0, 1, ${h}))`, context);
  assert.equal(at(8), 'בוקר טוב');
  assert.equal(at(13), 'צהריים טובים');
  assert.equal(at(19), 'ערב טוב');
  assert.equal(at(23), 'לילה טוב');
  assert.equal(at(3), 'לילה טוב');
});

test('דיאלוג רגיל לא השתנה: יש "ביטול" ו-Escape סוגר', async () => {
  const { context, body, docListeners } = boot({});
  const done = vm.runInContext(`askFields('שם', [{ name: 'a', label: 'א' }], 'שמור')`, context);
  const card = body.children[0].children[0];
  assert.doesNotMatch(body.children[0].className, /auth-screen/);
  assert.ok(find(card, x => x.tagName === 'BUTTON' && x.textContent === 'ביטול'));
  docListeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(await done, null);
});

test('מצב ריק: אייקון מהסרגל, כותרת והסבר, וכפתור הוספה רק בתצוגה עם טופס', () => {
  const { context } = boot({});
  vm.runInContext(`elements.navButtons = [{ dataset: { view: 'tasks' }, firstChild: { textContent: '✅ ' } }]; state.currentView = 'tasks';`, context);
  const html = vm.runInContext(`renderEmpty('אין משימות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל')`, context);
  assert.match(html, /^<div class="empty">/);
  assert.match(html, /<div class="empty-icon" aria-hidden="true">✅<\/div>/);
  assert.match(html, /<div class="empty-title">אין משימות עדיין<\/div>/);
  assert.doesNotMatch(html, /empty-hint/, 'ההסבר "לחץ... כדי להתחיל" מוחלף בכפתור');
  assert.match(html, /data-empty-add/);

  const withHint = vm.runInContext(`renderEmpty('אין תרחישים — חשבו תמהיל ושמרו אותו')`, context);
  assert.match(withHint, /<div class="empty-hint">חשבו תמהיל ושמרו אותו<\/div>/);
  assert.doesNotMatch(withHint, /data-empty-add/);

  vm.runInContext(`state.currentView = 'no-such-view'`, context);
  const plain = vm.runInContext(`renderEmpty('אין נתונים להצגה')`, context);
  assert.match(plain, /📭/);
  assert.doesNotMatch(plain, /data-empty-add/, 'בלי טופס — בלי כפתור');
});

test('מצב ריק: כל הממשק עובר דרך renderEmpty, וכפתור ההוספה מחובר', () => {
  const src = EconUI.source();
  const raw = src.split('\n').filter(l => /class="empty"/.test(l) && !/function renderEmpty|return `<div class="empty">/.test(l));
  assert.deepEqual(raw, [], 'מצב ריק שנכתב ידנית — להשתמש ב-renderEmpty');
  assert.match(src, /querySelectorAll\('\[data-empty-add\]'\)\.forEach\(b => b\.addEventListener\('click', \(\) => handleAdd\(\)\)\)/);
});
