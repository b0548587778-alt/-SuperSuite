// רתמה לממשק מודול החשבון (modules/math/app.js): DOM מדומה מינימלי (innerHTML בלבד), שעון מזויף,
// localStorage שאפשר להכשיל ו-ssDialog מדומה. נבדקת התנהגות. location / speechSynthesis — לפי הצורך.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../../modules/math/logic.js');

const DIR = path.join(__dirname, '..', '..', 'modules', 'math');
const APP_SRC = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');

// hash — location.hash בפתיחה (קישור ישיר לפעולה); voices — הקולות של speechSynthesis (בלי — אין speechSynthesis)
function makeApp({ storage = {}, failWrites = null, dialog = {}, hash = '', voices = null } = {}) {
  let clock = Date.UTC(2026, 10, 5, 10, 0, 0);
  const timers = []; let tid = 0;
  const els = new Map(), handlers = {}, chooseCalls = [], prompts = [], alerts = [];
  function mkEl(id) {
    const el = { id, value: '', checked: false, disabled: false, hidden: false, dataset: {}, _text: '', writes: 0, _html: '', offsetWidth: 0,
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      focus() {}, setAttribute() {}, querySelectorAll() { return []; }, querySelector() { return null; } };
    // textContent מחליף את כל התוכן (גם כפתורים שב-innerHTML), כמו בדפדפן
    Object.defineProperty(el, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); this._html = String(v); } });
    Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); this.writes++; for (const m of this._html.matchAll(/\bid="([^"]+)"/g)) mkEl(m[1]); } });
    els.set(id, el);
    return el;
  }
  ['who', 'tabs', 'view', 'toast', 'live'].forEach(mkEl);
  const store = Object.assign({}, storage);
  const state = { fail: failWrites };
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem(k, v) { if (state.fail) throw state.fail; store[k] = String(v); },
    removeItem(k) { if (state.fail) throw state.fail; delete store[k]; }
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
  const ctx = {
    document: {
      body: { classList: { toggle(c, on) { bodyClasses[c] = !!on; } } },
      getElementById: id => els.get(id) || null,
      querySelectorAll: () => [],
      addEventListener(type, fn) { handlers[type] = fn; }
    },
    localStorage,
    ssDialog: {
      // תשובה מוכנה, או פונקציה של ההודעה (תרגיל ההורים — מחשבים את התשובה מהתרגיל שבהודעה)
      prompt: async msg => { prompts.push(String(msg)); const a = dialog.prompt ? dialog.prompt.shift() : null; return typeof a === 'function' ? a(String(msg)) : a; },
      choose: async (msg, choices) => { chooseCalls.push(choices); return dialog.choose ? dialog.choose.shift() : null; },
      confirm: async () => true,
      alert: async msg => { alerts.push(String(msg)); }
    },
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms | 0), fn }); return tid; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, ms) => { timers.push({ id: ++tid, at: clock + ms, fn, every: ms }); return tid; },
    clearInterval: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    Date: FakeDate, Math, console, MathLogic: M
  };
  ctx.window = ctx;
  const bodyClasses = {}, winHandlers = {}, spoken = [];
  ctx.location = { hash, pathname: '/index.html', search: '' };
  ctx.history = { replaceState(_s, _t, url) { ctx.location.hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : ''; } };
  ctx.addEventListener = (t, fn) => { winHandlers[t] = fn; };
  if (voices) {
    ctx.speechSynthesis = { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { spoken.push(u); } };
    ctx.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  }
  vm.createContext(ctx);
  vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });
  const api = {
    el: id => els.get(id) || null,
    view: () => els.get('view'),
    store, state, chooseCalls, prompts, alerts, bodyClasses, spoken, location: ctx.location,
    // המעטפת מחליפה את ה-hash (קישור ישיר לפעולה) — כמו בדפדפן: hashchange
    setHash(h) { ctx.location.hash = h; if (winHandlers.hashchange) winHandlers.hashchange({}); },
    toastText: () => els.get('toast').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    click(act, data) { handlers.click({ target: { closest: sel => (sel.includes('#tabs') ? null : { dataset: Object.assign({ act }, data || {}), disabled: false }) } }); },
    advance(ms) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        clock = t.at;
        if (t.every) t.at += t.every; else timers.shift();
        t.fn();
      }
      clock = end;
    },
    settle: async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); }
  };
  return api;
}
// פתרון תרגיל ההורים מתוך ההודעה ("... 14 × 7 = ?")
const solveAdult = msg => { const m = /(\d+) × (\d+)/.exec(msg); return m ? String(m[1] * m[2]) : ''; };
const learnersStore = (list, active) => ({ 'math:learners': JSON.stringify({ v: 1, active: active || list[0].id, list }) });

module.exports = { makeApp, solveAdult, learnersStore, M };
