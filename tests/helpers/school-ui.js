// רתמה לממשק ניהול המוסד (modules/school/app.js): DOM מדומה קטן, localStorage בזיכרון (עם כשל כתיבה לפי הצורך,
// כמו המחסן המוצפן — SecurityError / QuotaExceededError), ssDialog מדומה והרשאות הפגישה (window.ssModulePerms).
// הקוד רץ ב-vm כמו בדפדפן: logic.js ואז app.js. נבדקת התנהגות (כפתורים, הודעות, מה נשמר), לא טקסט הקוד.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', '..', 'modules', 'school');

class Node {}
class Text extends Node {
  constructor(t) { super(); this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
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
    this.style = {};
    this._value = undefined;
    this.checked = false;
    this.open = false;
    this.selectionStart = 0;
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter(x => x && !c.includes(x)).join(' '); },
      contains: c => self.className.split(/\s+/).includes(c),
      toggle: c => (self.classList.contains(c) ? (self.classList.remove(c), false) : (self.classList.add(c), true))
    };
  }
  // select בלי ערך שנקבע — האפשרות המסומנת (selected) או הראשונה, כמו בדפדפן
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') { const o = this.querySelectorAll('option'); const sel = o.find(x => x.getAttribute('selected') !== null) || o[0]; return sel ? (sel._value !== undefined ? sel._value : sel.getAttribute('value') || '') : ''; }
    return '';
  }
  set value(v) { this._value = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; if (v !== '' && v !== null && v !== undefined) this.append(String(v)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'open') this.open = true; }
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
  replaceChildren(...kids) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this.append(...kids); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); n.parentNode = p; p.children[i] = n; this.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, extra = {}) {
    const ev = Object.assign({ type: t, target: this, preventDefault() {}, stopPropagation() {} }, extra);
    for (let n = this; n; n = n.parentNode) for (const fn of (n.listeners && n.listeners[t]) || []) fn(Object.assign({}, ev, { currentTarget: n }));
  }
  click() { this.dispatch('click'); }
  focus() {}
  setSelectionRange() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  matches(sel) {
    const m = /^([a-z0-9]*)(?:\.([\w-]+))?(?:\[([\w-]+)(?:=([\w-]+))?\])?$/i.exec(sel);
    if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !this.classList.contains(m[2])) return false;
    if (m[3]) {
      const v = m[3] === 'type' ? (this.attrs.type || '') : this.getAttribute(m[3]);
      if (v === null || (m[4] !== undefined && v !== m[4])) return false;
    }
    return true;
  }
  all() { const out = []; const walk = n => { for (const c of n.children) if (c instanceof El) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n instanceof El; n = n.parentNode) if (n.matches(sel)) return n; return null; }
}

function makeStorage({ items, fail }) {
  const m = new Map(Object.entries(items || {}));
  const writes = [];
  // fail(op, key, value, map) — value ו-map למכסה של כל המקור (localStorage של הדפדפן — אנדרואיד / plain)
  const check = (op, k, v) => {
    const f = typeof fail === 'function' ? fail(op, k, v, m) : null;
    if (f) { const e = new Error('השינוי לא נשמר'); e.name = f; throw e; }
  };
  const ls = {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { check('set', String(k), String(v)); m.set(String(k), String(v)); writes.push(['set', String(k)]); },
    removeItem: k => { check('remove', String(k)); m.delete(String(k)); writes.push(['remove', String(k)]); },
    clear: () => { check('clear'); m.clear(); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
  return { ls, map: m, writes, setFail: f => { fail = f; } };
}

const tick = () => new Promise(r => setImmediate(r));

// items — תוכן ה-localStorage של המודול; perms — window.ssModulePerms (null = בלי מידע); fail(op, key) ← שם שגיאה או null
// hash — location.hash בפתיחה (קישור ישיר לפעולה מהמעטפת)
function createSchoolUI({ items = {}, perms = { export: true, delete: true, user: 'מנהל' }, fail = null, theme = '', hash = '' } = {}) {
  const doc = { title: '' };
  const mk = tag => new El(tag, doc);
  doc.createElement = mk;
  doc.createTextNode = t => new Text(t);
  doc.documentElement = mk('html');
  if (theme) doc.documentElement.setAttribute('data-ss-theme', theme);
  doc.body = mk('body');
  doc.documentElement.append(doc.body);
  const byId = {};
  for (const id of ['app', 'instName', 'instSub', 'headActions', 'tabs', 'view', 'toast', 'printArea', 'dlg', 'dlgTitle', 'dlgClose', 'dlgBody', 'dlgFoot']) {
    const e = mk(id === 'dlg' ? 'dialog' : 'div');
    e.id = id;
    byId[id] = e;
    doc.body.append(e);
  }
  doc.getElementById = id => doc.body.all().find(e => e.id === id) || byId[id] || null;

  const store = makeStorage({ items, fail });
  const log = { alerts: [], confirms: [], prompts: [], toasts: [], downloads: [], prints: [], errors: [] };
  const answers = { confirm: [], prompt: [] };
  const ssDialog = {
    alert: (msg, o) => { log.alerts.push(String(msg)); return Promise.resolve(); },
    confirm: (msg) => { log.confirms.push(String(msg)); return Promise.resolve(answers.confirm.length ? answers.confirm.shift() : true); },
    prompt: (msg) => { log.prompts.push(String(msg)); return Promise.resolve(answers.prompt.length ? answers.prompt.shift() : ''); }
  };
  const winListeners = {};
  const longTimers = new Set();
  const win = {
    document: doc, Node, localStorage: store.ls, ssDialog,
    ssModulePerms: perms ? Object.freeze(Object.assign({}, perms)) : undefined,
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    URL: { createObjectURL: b => { log.downloads.push(b.text); return 'blob:x'; }, revokeObjectURL() {} },
    print: () => { log.prints.push(doc.documentElement.getAttribute('data-ss-theme')); },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    // טיימרים קצרים — מיד; ארוכים (5 שניות ומעלה — משך ההודעה וחלון הביטול) נשמרים ב-longTimers ונגמרים
    // רק כשהבדיקה מבקשת (expireLong) — אחרת עומס במחשב היה סוגר את חלון הביטול לפני הלחיצה
    setTimeout: (fn, ms) => { if ((ms || 0) >= 5000) { const t = { fn, ms }; longTimers.add(t); return t; } return setTimeout(fn, Math.min(ms || 0, 5)); },
    clearTimeout: t => { if (longTimers.has(t)) longTimers.delete(t); else clearTimeout(t); },
    Intl, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp, console
  };
  win.window = win;
  win.location = { hash, pathname: '/index.html', search: '' };
  win.history = { replaceState(_s, _t, url) { win.location.hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : ''; } };
  // toast נרשם ביומן
  const toastEl = byId.toast;
  Object.defineProperty(toastEl, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = String(v); this.children.forEach(c => { c.parentNode = null; }); this.children = []; if (v) log.toasts.push(String(v)); } });
  const ctx = vm.createContext(win);
  for (const f of ['logic.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: 'modules/school/' + f });

  const view = byId.view;
  const buttons = (root = doc.body) => root.querySelectorAll('button');
  const findButton = (text, root = doc.body) => buttons(root).find(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text);
  const api = {
    win, doc, store, log, answers, view, tick,
    // הטיימרים הארוכים שממתינים (משך במילישניות), והפעלה של אלה שעד maxMs — כאילו הזמן עבר
    longTimers: () => [...longTimers].map(t => t.ms),
    expireLong(maxMs = Infinity) { for (const t of [...longTimers]) if (t.ms <= maxMs) { longTimers.delete(t); t.fn(); } },
    text: (root = view) => root.textContent,
    hasButton: (text, root) => !!findButton(text, root),
    buttonTexts: (root = doc.body) => buttons(root).map(b => b.textContent.trim()),
    async click(text, root) {
      const b = findButton(text, root);
      if (!b) throw new Error('אין כפתור: ' + text + ' | ' + api.buttonTexts(root).join(', '));
      b.click();
      await tick(); await tick();
    },
    async go(tab) {
      const b = byId.tabs.querySelectorAll('button').find(x => x.getAttribute('data-tab') === tab);
      if (!b) throw new Error('אין לשונית ' + tab);
      b.click();
      await tick();
    },
    // מילוי שדות בחלון הטופס לפי התווית, ולחיצה על כפתור השליחה
    async submitDialog(values, submitText) {
      const body = byId.dlgBody;
      for (const [label, value] of Object.entries(values)) {
        const lab = body.querySelectorAll('label').find(l => l.textContent.replace(/ \*$/, '').trim() === label);
        if (!lab) throw new Error('אין שדה ' + label);
        const input = body.all().find(e => e.id === lab.getAttribute('for'));
        if (input.attrs.type === 'checkbox') input.checked = !!value; else input.value = String(value);
      }
      await api.click(submitText, byId.dlgFoot);
    },
    dialogText: () => byId.dlgBody.textContent + ' ' + byId.dlgTitle.textContent,
    data: () => vm.runInContext('void 0', ctx),
    fire: (type, e = {}) => { for (const fn of winListeners[type] || []) fn(e); },
    setHash(h) { win.location.hash = h; api.fire('hashchange'); },
    byId
  };
  return api;
}

module.exports = { createSchoolUI, El, Node };
