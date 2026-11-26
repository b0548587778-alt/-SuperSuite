// רתמה לממשק מודול האנגלית (modules/english/app.js): DOM מדומה קטן, localStorage בזיכרון (עם כשל כתיבה לפי
// הצורך, כמו המחסן המוצפן — SecurityError עם סיבה בעברית), ssDialog מדומה ושעון קבוע.
// הקוד רץ ב-vm כמו בדפדפן: words.js, grammar.js, logic.js ואז app.js. נבדקת התנהגות, לא טקסט הקוד.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', '..', 'modules', 'english');

class Node {}
class Text extends Node {
  constructor(t) { super(); this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
}

// סלקטור פשוט: tag, #id, .class, [attr] / [attr="v"] — וצירוף צאצא ברווח
function parseSimple(sel) {
  const out = { tag: '', id: '', classes: [], attrs: [] };
  const re = /([a-z][a-z0-9]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="?([^"\]]*)"?)?\]/gi;
  let m;
  while ((m = re.exec(sel))) {
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push([m[4], m[5]]);
  }
  return out;
}

class El extends Node {
  constructor(tag, doc) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.selected = false;
    this._value = undefined;
    const self = this;
    this.style = { setProperty(k, v) { this[k] = v; } };
    const list = () => self.className.split(/\s+/).filter(Boolean);
    this.classList = {
      add: (...c) => { const s = new Set(list()); c.forEach(x => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = list().filter(x => !c.includes(x)).join(' '); },
      contains: c => list().includes(c),
      toggle: (c, force) => {
        const on = force === undefined ? !self.classList.contains(c) : !!force;
        if (on) self.classList.add(c); else self.classList.remove(c);
        return on;
      }
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => self.attrs['data-' + String(k)],
      set: (_, k, v) => { self.attrs['data-' + String(k)] = String(v); return true; }
    });
  }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') { const o = this.querySelectorAll('option'); const s = o.find(x => x.selected) || o[0]; return s ? s.value : ''; }
    return '';
  }
  set value(v) { this._value = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; if (v !== '' && v != null) this.append(String(v)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...kids) {
    for (const k of kids) {
      const n = k instanceof Node ? k : new Text(k);
      if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n);
      n.parentNode = this;
      this.children.push(n);
    }
  }
  prepend(...kids) { const old = this.children; this.children = []; this.append(...kids); for (const c of old) { if (c.parentNode === this) this.children.push(c); } }
  replaceChildren(...kids) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this.append(...kids); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, extra = {}) {
    const ev = Object.assign({ type: t, target: this, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, extra);
    for (let n = this; n; n = n.parentNode) {
      for (const fn of (n.listeners && n.listeners[t]) || []) { ev.currentTarget = n; fn(ev); }
    }
    return ev;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  matchesSimple(p) {
    if (p.tag && this.tagName !== p.tag) return false;
    if (p.id && this.id !== p.id) return false;
    for (const c of p.classes) if (!this.classList.contains(c)) return false;
    for (const [k, v] of p.attrs) { const a = this.getAttribute(k); if (a === null || (v !== undefined && a !== v)) return false; }
    return true;
  }
  matches(sel) {
    const parts = sel.trim().split(/\s+/).map(parseSimple);
    if (!this.matchesSimple(parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    for (let n = this.parentNode; n instanceof El && i >= 0; n = n.parentNode) if (n.matchesSimple(parts[i])) i--;
    return i < 0;
  }
  all() { const out = []; const walk = n => { for (const c of n.children) if (c instanceof El) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n instanceof El; n = n.parentNode) if (n.matches(sel)) return n; return null; }
}

function makeStorage(items, fail) {
  const m = new Map(Object.entries(items || {}));
  const check = (op, k) => {
    const f = typeof fail === 'function' ? fail(op, k) : null;
    if (f) { const e = new Error(f.message || ''); e.name = f.name || 'SecurityError'; throw e; }
  };
  return {
    map: m,
    setFail: f => { fail = f; },
    ls: {
      getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { check('set', String(k)); m.set(String(k), String(v)); },
      removeItem: k => { check('remove', String(k)); m.delete(String(k)); }
    }
  };
}

const tick = () => new Promise(r => setImmediate(r));

// items — תוכן ה-localStorage; fail(op, key) ← { name, message } או null; now — השעה (ms) שהמודול רואה
// hash — location.hash בפתיחה (קישור ישיר לפעולה); voices — הקולות של speechSynthesis (בלי — אין speechSynthesis)
function createEnglishUI({ items = {}, fail = null, now = Date.UTC(2026, 10, 5, 10), userAgent = 'Mozilla/5.0 (Windows NT 10.0)', hash = '', voices = null } = {}) {
  const doc = {};
  const mk = tag => new El(tag, doc);
  doc.createElement = mk;
  doc.createTextNode = t => new Text(t);
  doc.documentElement = mk('html');
  doc.body = mk('body');
  doc.documentElement.append(doc.body);
  const docListeners = {};
  doc.addEventListener = (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); };
  doc.activeElement = doc.body;
  const add = (parent, tag, id, props = {}) => { const e = mk(tag); if (id) e.id = id; Object.assign(e, props); parent.append(e); return e; };
  const app = add(doc.body, 'div', 'app');
  const box = add(app, 'div', 'learnerBox');
  add(box, 'select', 'learnerSel');
  add(box, 'button', 'learnerAdd');
  const welcome = add(app, 'section', 'welcome');
  add(welcome, 'input', 'welcomeName');
  add(welcome, 'button', 'welcomeGo');
  const main = add(app, 'div', 'main');
  add(main, 'div', 'roBanner', { hidden: true });
  const tabs = add(main, 'nav', 'tabs');
  for (const t of ['home', 'cards', 'quiz', 'words', 'grammar', 'progress', 'settings']) {
    const b = add(tabs, 'button', '');
    b.className = 'ss-tab';
    b.setAttribute('data-tab', t);
  }
  for (const t of ['home', 'cards', 'quiz', 'words', 'grammar', 'progress', 'settings']) add(main, 'section', 'view-' + t);
  const toastEl = add(doc.body, 'div', 'toast');
  doc.getElementById = id => doc.body.all().find(e => e.id === id) || null;
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.querySelector = sel => doc.documentElement.querySelector(sel);

  const store = makeStorage(items, fail);
  const log = { toasts: [], alerts: [], prompts: [], spoken: [] };
  Object.defineProperty(toastEl, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = String(v); this.children.forEach(c => { c.parentNode = null; }); this.children = []; if (v) log.toasts.push(String(v)); } });
  const answers = { confirm: [], prompt: [] };
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const longTimers = new Set();
  const win = {
    document: doc, Node, localStorage: store.ls, navigator: { userAgent },
    ssDialog: {
      confirm: () => Promise.resolve(answers.confirm.length ? answers.confirm.shift() : true),
      // תשובה מוכנה, או פונקציה של ההודעה (תרגיל ההורים)
      prompt: msg => { log.prompts.push(String(msg)); const a = answers.prompt.length ? answers.prompt.shift() : ''; return Promise.resolve(typeof a === 'function' ? a(String(msg)) : a); },
      alert: msg => { log.alerts.push(String(msg)); return Promise.resolve(); }
    },
    scrollTo() {},
    // טיימרים קצרים — מיד; ארוכים (5 שניות ומעלה — משך ההודעה וחלון הביטול) נשמרים ב-longTimers ונגמרים
    // רק כשהבדיקה מבקשת (expireLong) — אחרת עומס במחשב היה סוגר את חלון הביטול לפני הלחיצה
    setTimeout: (fn, ms) => { if ((ms || 0) >= 5000) { const t = { fn, ms }; longTimers.add(t); return t; } return setTimeout(fn, Math.min(ms || 0, 5)); },
    clearTimeout: t => { if (longTimers.has(t)) longTimers.delete(t); else clearTimeout(t); },
    Date: FixedDate, Intl, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp, Proxy, console
  };
  win.window = win;
  const winListeners = {};
  win.location = { hash, pathname: '/index.html', search: '' };
  win.history = { replaceState(_s, _t, url) { win.location.hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : ''; } };
  win.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
  if (voices) {
    win.speechSynthesis = { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { log.spoken.push(u); } };
    win.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  }
  const ctx = vm.createContext(win);
  for (const f of ['words.js', 'grammar.js', 'logic.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: 'modules/english/' + f });

  const L = win.EnglishLogic;
  const api = {
    win, doc, store, log, answers, L, W: win.EnglishWords, tick,
    // הטיימרים הארוכים שממתינים (משך במילישניות), והפעלה של אלה שעד maxMs — כאילו הזמן עבר
    longTimers: () => [...longTimers].map(t => t.ms),
    expireLong(maxMs = Infinity) { for (const t of [...longTimers]) if (t.ms <= maxMs) { longTimers.delete(t); t.fn(); } },
    setHash(h) { win.location.hash = h; for (const fn of winListeners.hashchange || []) fn({}); },
    today: () => L.dayIndex(new FixedDate()),
    view: tab => doc.getElementById('view-' + tab),
    text: el => (el || doc.body).textContent,
    buttons: root => (root || doc.body).querySelectorAll('button'),
    button(text, root) {
      const b = api.buttons(root).find(x => x.textContent.trim() === text || x.getAttribute('aria-label') === text || x.textContent.trim().startsWith(text));
      if (!b) throw new Error('אין כפתור: ' + text + ' | ' + api.buttons(root).map(x => x.textContent.trim()).join(', '));
      return b;
    },
    async click(text, root) { api.button(text, root).click(); await tick(); },
    async go(tab) { tabs.querySelector('[data-tab="' + tab + '"]').click(); await tick(); },
    // מקש במסמך; אם לא בוטל — פעולת ברירת המחדל של כפתור שבמיקוד (Enter / רווח = לחיצה)
    key(key) {
      const ev = { key, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, target: doc.activeElement };
      for (const fn of docListeners.keydown || []) fn(ev);
      const a = doc.activeElement;
      if (!ev.defaultPrevented && a instanceof El && a.tagName === 'BUTTON' && (key === 'Enter' || key === ' ')) a.click();
      return ev;
    },
    change(el, value) { if (el.attrs.type === 'checkbox' || el.type === 'checkbox') el.checked = !!value; else el.value = String(value); el.dispatch('change'); }
  };
  return api;
}

module.exports = { createEnglishUI, El };
