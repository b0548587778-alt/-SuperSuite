// אשף התחלה: shell/onboarding.js (טהור) והחיבור שלו במסך הבית (shell.js ב-vm, כמו ב-shell-ui.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const OB = require('../shell/onboarding');
const CAT = require('../shell/catalog');

const KEYS = CAT.ITEMS.map(it => it.key);

test('כל המסכים והצעדים של הפרופילים קיימים בקטלוג', () => {
  for (const p of OB.PROFILES) {
    for (const k of p.screens) assert.ok(KEYS.includes(k), `${p.id}: ${k}`);
    for (const s of p.steps) assert.ok(!s.key || KEYS.includes(s.key), `${p.id}: ${s.key}`);
  }
  for (const s of OB.COMMON_STEPS) assert.ok(!s.key || KEYS.includes(s.key), s.key);
});

test('תכנית: איחוד בלי כפילויות, צעדים משותפים בסוף, פרופיל לא מוכר מושמט', () => {
  const p = OB.plan(['npo', 'gemach', 'evil'], KEYS);
  assert.deepEqual(p.profiles, ['npo', 'gemach']);
  assert.deepEqual(p.screens, ['econ:npo', 'econ:people', 'econ:gemach']);
  assert.deepEqual(p.steps.slice(-3).map(s => s.id), ['users', 'backup-target', 'recovery-code']);
  assert.ok(p.steps.findIndex(s => s.id === 'npo-settings') < p.steps.findIndex(s => s.id === 'gemach-settings'));
});

test('תכנית: מסך שאינו בקטלוג (למשל גרסה ישנה) מושמט; תקרת מסכים', () => {
  assert.deepEqual(OB.plan(['npo'], ['econ:npo']).screens, ['econ:npo']);
  const all = OB.plan(OB.PROFILES.map(p => p.id), KEYS);
  assert.equal(all.screens.length, OB.MAX_SCREENS);
});

test('מצב שמור הוא קלט לא מהימן', () => {
  assert.deepEqual(OB.normalizeState('x'), { profiles: [], done: [], dismissed: false, completed: false });
  assert.deepEqual(OB.normalizeState({ profiles: ['npo', 7, 'evil'], done: ['a', {}], dismissed: 'yes', completed: true }).profiles, ['npo']);
});

// ---------- מסך הבית ----------
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'shell', f), 'utf8');

function fakeElement() {
  return {
    hidden: false, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    focus() {}, blur() {}, select() {}, click() { if (this.onclick) this.onclick(); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, querySelector() { return fakeElement(); },
    querySelectorAll() { return []; }, showModal() { this.open = true; }, close() { this.open = false; }, setAttribute() {},
  };
}

function load() {
  const elements = {};
  const store = new Map();
  const calls = { open: [], pick: 0, recovery: 0 };
  const shellAPI = {
    switchTo: async () => true, isLoggedIn: async () => false, getBackupTarget: async () => '',
    pickBackupTarget: async () => { calls.pick++; return 'E:\\גיבוי'; },
    getRecoveryCode: async () => { calls.recovery++; return 'AAAAA'; },
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    setOverlay: async () => true, onActiveView() {}, onActive() {}, onCmd() {}, quit: async () => {}, goHome: async () => {},
  };
  const document = {
    getElementById(id) { return (elements[id] ||= fakeElement()); },
    querySelector() { return fakeElement(); }, querySelectorAll() { return []; }, addEventListener() {},
    createElement() { return fakeElement(); }, body: fakeElement(),
  };
  const ctx = { document, console, confirm: () => true, alert() {}, prompt: () => null, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, Intl, Date, Math, navigator: {},
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  ctx.window = ctx;
  ctx.shellAPI = shellAPI;
  ctx.HTMLElement = function () {};
  vm.createContext(ctx);
  for (const f of ['hebcal.js', 'catalog.js', 'onboarding.js', 'shell.js']) vm.runInContext(read(f), ctx, { filename: f });
  const $ = (id) => document.getElementById(id);
  // בחירה בדיאלוג: querySelectorAll של הבחירות מחזיר את התיבות המסומנות
  const choose = (ids) => { $('obChoices').querySelectorAll = () => ids.map(value => ({ value })); $('obForm').onsubmit({ preventDefault() {} }); };
  const target = (attr, value) => ({ closest: (sel) => (sel.includes(attr) ? { dataset: { [attr === 'data-ob-step' ? 'obStep' : 'obDone']: value }, checked: true } : null) });
  return { $, calls, store, choose, target, state: () => JSON.parse(store.get('suite.onboarding') || 'null') };
}
const flush = () => new Promise(r => setImmediate(r));

test('התקנה חדשה: הזמנה לאשף, בלי "המסכים שלי"; "לא עכשיו" מסתיר', () => {
  const s = load();
  assert.equal(s.$('obInvite').hidden, false);
  assert.equal(s.$('mineSec').hidden, true);
  s.$('obLater').onclick();
  assert.equal(s.$('obInvite').hidden, true);
  assert.equal(s.state().dismissed, true);
});

test('בחירה בדיאלוג: נשמרת, "המסכים שלי" מוצג, וצעדים ראשונים', () => {
  const s = load();
  s.$('obStart').onclick();
  assert.equal(s.$('obDlg').open, true);
  assert.match(s.$('obChoices').innerHTML, /עמותה/);
  assert.match(s.$('obChoices').innerHTML, /class="ob-icon"/, 'כרטיס עם אייקון');
  assert.match(s.$('obCount').textContent, /עדיין לא נבחר/);
  s.choose([]);
  assert.match(s.$('obErr').textContent, /לפחות אפשרות אחת/);
  s.choose(['npo']);
  assert.equal(s.$('obDlg').open, false);
  assert.deepEqual(s.state().profiles, ['npo']);
  assert.equal(s.$('obInvite').hidden, true);
  assert.equal(s.$('mineSec').hidden, false);
  assert.match(s.$('mine').innerHTML, /data-key="econ:npo"/);
  assert.equal(s.$('obSteps').hidden, false);
  assert.match(s.$('obList').innerHTML, /הגדרות העמותה/);
  assert.match(s.$('obProgress').textContent, /^0 מתוך/);
});

test('צעד: לחיצה פותחת את המסך או את הפעולה; "בוצע" נשמר; בחירת יעד גיבוי מסמנת לבד', async () => {
  const s = load();
  s.$('obStart').onclick();
  s.choose(['npo']);
  s.$('obList').onclick({ target: s.target('data-ob-step', 'npo-settings') });
  await flush();
  assert.deepEqual(s.calls.open.at(-1), ['econ', 'npo']);
  s.$('obList').onclick({ target: s.target('data-ob-step', 'recovery-code') });
  await flush();
  assert.equal(s.calls.recovery, 1);
  s.$('obList').onchange({ target: s.target('data-ob-done', 'npo-import') });
  assert.ok(s.state().done.includes('npo-import'));
  s.$('obList').onclick({ target: s.target('data-ob-step', 'backup-target') });
  await flush(); await flush();
  assert.equal(s.calls.pick, 1);
  assert.ok(s.state().done.includes('backup-target'));
  // המסך של העמותה נפתח, ולכן מסך הבית לא צויר מחדש ברקע — הוא מתעדכן בחזרה הביתה
  s.$('hm').onclick();
  assert.match(s.$('obProgress').textContent, /^2 מתוך 5$/);
  assert.equal(s.$('obMeter').style.width, '40%', 'מד ההתקדמות');
});
