// רתמה לבדיקות הנגישות של המודול הכלכלי (r4-a11y-econ): index.html האמיתי ב-DOM מינימלי,
// ui/*.js האמיתיים, ו-systemAPI מדומה שמחזיר נתונים ריקים בצורה שהמסכים מצפים לה.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EconUI = require('./econ-ui');
const D = require('./mini-dom');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }

const ADMIN = { id: 'u1', username: 'מנהל', role: 'admin', permissions: ['data.view', 'data.edit', 'data.delete', 'data.backup', 'data.restore', 'data.export', 'users.manage'] };

// ערכי ברירת מחדל לפי שם הקריאה — רשימות מחזירות [], השאר אובייקט
const LIST_NAMES = ['getInvoices', 'getSalesDocs', 'getRecurring', 'getChart', 'getJournal', 'getPersonalEntries', 'getProducts',
  'listUsers', 'listAudit', 'listLicenseChildren', 'ownerInbox', 'ownerReleases', 'ownerSignups', 'chatStarred', 'searchPeople', 'aiSample'];
function defaultReturn(name) {
  if (name === 'getAdvancedSettings') return { isAdmin: true, startView: 'dashboard' };
  if (name === 'getLicenseStatus') return { mode: 'licensed', status: 'active', features: [], reasons: [] };
  if (name === 'getTasks') return { tasks: [] };
  if (name === 'getContacts') return { contacts: [] };
  if (name === 'getVoiceNotes') return { notes: [] };
  if (name === 'getCanvasBoards') return { boards: [] };
  if (name === 'getBusinessPlans') return { plans: [] };
  if (name === 'getMarketIntel') return { entries: [] };
  if (name === 'getMortgageScenarios') return { scenarios: [] };
  if (name === 'getMortgageAdvisor') return { clients: [] };
  if (name === 'aiStatus') return { available: false };
  if (name === 'aiPrefsGet') return {};
  if (/Summary|Analytics/.test(name)) return { income: 0, expense: 0, balance: 0, count: 0, categories: [] };
  if (LIST_NAMES.includes(name)) return [];
  if (name === 'getAccountingReports') return null;
  return {};
}

// שרת אמיתי בתהליך: modules/econ/ipc.js עם electron מדומה, ו-preload.js האמיתי שממפה שמות לערוצים.
// כך המסכים מתרנדרים עם נתוני הדוגמה (sample:add) — טבלאות מלאות, תגיות מצב וכפתורי פעולה.
let backend = null;
async function realBackend(dir) {
  if (backend) return backend;
  const Module = require('module');
  const handlers = {};
  const STUB = '/__electron_stub_a11y__.js';
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? STUB : orig.call(this, req, ...rest); };
  require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  } };
  const ipc = require(path.join(ROOT, 'modules/econ/ipc'));
  await ipc.initEcon(dir, { relayUrl: '', fetchImpl: async () => { throw new Error('אין רשת בבדיקה'); } });
  const ev = { sender: { id: 1 } };
  await handlers['auth:setup'](ev, 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev, 'menahel', 'menahel-pass-long-1');
  const SD = require(path.join(ROOT, 'modules/econ/core/sampleData'));
  await handlers['sample:add'](ev, Object.keys(SD.KINDS));
  // preload.js האמיתי: contextBridge לוכד את האובייקט, ipcRenderer.invoke קורא לשרת
  let api = null;
  const pre = fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8');
  const ctx = { console, require: (m) => m === 'electron' ? {
    contextBridge: { exposeInMainWorld: (_k, v) => { api = v; } },
    ipcRenderer: { invoke: (ch, ...a) => handlers[ch] ? Promise.resolve().then(() => handlers[ch](ev, ...a)) : Promise.reject(new Error('אין ערוץ ' + ch)), on() {}, send() {}, removeListener() {} },
  } : require(m) };
  vm.runInNewContext(pre, ctx);
  backend = { api, handlers, ipc };
  return backend;
}

async function boot({ api = {}, user = ADMIN, simple = false, real = null } = {}) {
  const doc = D.documentFromHtml(HTML);
  doc.readyState = 'complete';
  if (simple) doc.documentElement.setAttribute('data-ss-simple', 'on');
  const calls = [];
  const realApi = real ? (await realBackend(real)).api : null;
  const systemAPI = realApi ? new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (name === 'onGoto' || name === 'onAuthCheck') return () => {};
      if (Object.prototype.hasOwnProperty.call(api, name)) return (...a) => Promise.resolve().then(() => api[name](...a));
      const f = realApi[name];
      return typeof f === 'function' ? (...a) => { calls.push({ name, args: a }); return f(...a); } : f;
    }
  }) : new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (name === 'onGoto' || name === 'onAuthCheck') return () => {};
      if (Object.prototype.hasOwnProperty.call(api, name)) {
        return (...a) => { calls.push({ name, args: a }); return Promise.resolve().then(() => api[name](...a)); };
      }
      if (name === 'authStatus') return () => Promise.resolve({ user, configured: true });
      return (...a) => { calls.push({ name, args: a }); return Promise.resolve(defaultReturn(name)); };
    }
  });
  const errors = [];
  const timers = [];
  const context = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')), info() {} },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => setImmediate(fn),
    Date, Intl, URLSearchParams, TextDecoder, TextEncoder,
    Blob: class { constructor(p) { this.p = p; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    location: { search: '?embedded=1' },
    document: doc,
    navigator: { language: 'he' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
  };
  context.window = context;
  context.window.systemAPI = systemAPI;
  context.addEventListener = (t, fn, o) => doc.addEventListener(t, fn, o);
  context.removeEventListener = (t, fn) => doc.removeEventListener(t, fn);
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  const run = (code) => vm.runInContext(code, context);
  async function go(view) {
    const btn = doc.querySelector(`button.nav[data-view="${view}"]`);
    if (btn) btn.click(); else run(`switchView(${JSON.stringify(view)})`);
    await settle();
  }
  // הפעלת טיימרים שממתינים (טוסטים וכו')
  function runTimers(upTo = Infinity) {
    for (const t of [...timers]) if (t.ms <= upTo) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  }
  const key = (target, k, extra = {}) => D.dispatch(target || doc.activeElement || doc.body, { type: 'keydown', key: k, ...extra });
  return { doc, context, calls, errors, timers, run, go, settle, runTimers, key, view: () => doc.getElementById('view') };
}

// ---------- בדיקת נגישות של עץ DOM (מסך שרונדר / חלון) ----------
const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option', 'details', 'form']);
function effectiveLevel(h) {
  const al = h.getAttribute('aria-level');
  if (al) return Number(al);
  const m = /^h([1-6])$/.exec(h.localName);
  return m ? Number(m[1]) : null;
}
function audit(root, { startLevel = 1 } = {}) {
  const doc = root.ownerDocument;
  const problems = [];
  const where = (e) => `<${e.localName}${e.id ? '#' + e.id : ''}${e.className ? '.' + e.className.split(/\s+/).join('.') : ''}> "${e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
  const all = root.descendants();
  for (const e of all) {
    if (D.isHiddenTree(e)) continue;
    const tag = e.localName;
    if (['input', 'select', 'textarea'].includes(tag) && e.type !== 'hidden' && !D.accessibleName(e)) problems.push('שדה בלי שם: ' + where(e) + ' name=' + e.name);
    if (tag === 'button' && !D.accessibleName(e)) problems.push('כפתור בלי שם: ' + where(e));
    if (tag === 'a' && e.hasAttribute('href') && !D.accessibleName(e)) problems.push('קישור בלי שם: ' + where(e));
    if (tag === 'img' && !e.hasAttribute('alt')) problems.push('תמונה בלי alt: ' + where(e));
    if (tag === 'table') {
      if (!e.querySelector('caption') && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')) problems.push('טבלה בלי כותרת (caption / aria-label): ' + where(e));
      for (const th of e.querySelectorAll('th')) if (!th.getAttribute('scope')) { problems.push('th בלי scope: ' + where(th)); break; }
    }
    // מאזין לחיצה על רכיב שאינו פעיל במקלדת
    if ((e.listeners.click || []).length && !INTERACTIVE.has(tag)) {
      const ok = e.getAttribute('role') && e.getAttribute('tabindex') !== null && (e.listeners.keydown || []).length;
      if (!ok) problems.push('לחיצה בעכבר בלבד: ' + where(e));
    }
    // סטטוס בצבע בלבד: תגית / נקודה בלי טקסט
    if (/\b(badge|pill|dot|status-dot|ss-badge|chip)\b/.test(e.className) && !/[֐-׿A-Za-z0-9]/.test(e.textContent) && !e.getAttribute('aria-label') && !e.getAttribute('title')) {
      problems.push('סטטוס בצבע בלבד: ' + where(e));
    }
    if (e.getAttribute('aria-describedby')) {
      for (const id of e.getAttribute('aria-describedby').split(/\s+/)) if (!doc.getElementById(id)) problems.push('aria-describedby מפנה למזהה שלא קיים: ' + id);
    }
  }
  // מזהים כפולים
  const ids = {};
  for (const e of doc.descendants()) if (e.id) ids[e.id] = (ids[e.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1 && root.descendants().some(x => x.id === id)) problems.push(`מזהה כפול: ${id} ×${n}`);
  // סדר כותרות: אין קפיצה של יותר מרמה אחת
  let prev = startLevel;
  for (const h of all.filter(x => /^h[1-6]$/.test(x.localName) || x.getAttribute('role') === 'heading')) {
    if (D.isHiddenTree(h)) continue;
    const lvl = effectiveLevel(h);
    if (lvl > prev + 1) problems.push(`קפיצה בכותרות: h${prev} ← h${lvl} ${where(h)}`);
    prev = lvl;
  }
  return [...new Set(problems)];
}

module.exports = { boot, audit, VIEWS, HTML, ADMIN, settle, tick };
