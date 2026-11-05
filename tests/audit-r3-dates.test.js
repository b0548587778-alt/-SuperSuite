'use strict';
// סקירת קוד 2.11.2026 — בדיקות ותאריכים: יארצייט ל׳ בחודש חסר, מסך הבית בשקיעה, עריכת תאריך עברי בהנצחה,
// שדות רשות ב-askFields, רשימות בחירה בטפסי הרישוי, ותאריכי ברירת מחדל שמחושבים בכל פתיחה.
process.env.TZ = 'Asia/Jerusalem'; // לפני כל שימוש בתאריך

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../modules/econ/core/hebcal');
const MEM = require('../modules/econ/core/memorials');
const EconUI = require('./helpers/econ-ui');

const ROOT = path.join(__dirname, '..');
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const tick = () => new Promise(r => setImmediate(r));

/* ---------- יארצייט ל׳ בחודש שאין בו ל׳ ---------- */

// א׳ בחודש, שהחודש שלפניו (חשוון או כסלו) היה בן 29 יום — מתחילים מתאריך קבוע
function firstAfterShortMonth() {
  const start = H.civil('2026-09-01');
  for (let i = 1; i < 900; i++) {
    const t = start + i * DAY;
    const cur = H.hebrewDate(t), prev = H.hebrewDate(t - DAY);
    if (cur.day === 1 && prev.day === 29 && ['Heshvan', 'Kislev'].includes(prev.month)) return { t, prevMonth: prev.month };
  }
  throw new Error('לא נמצא חודש חסר');
}

test('יארצייט ל׳ בחודש חסר: מופיע (לבירור) גם כשהרשימה מתחילה בא׳ של החודש הבא', { skip: !H.available() }, () => {
  const { t, prevMonth } = firstAfterShortMonth();
  const m = { id: 'm1', name: 'פלוני', hebrewDay: 30, hebrewMonth: prevMonth, hebrewYear: null, adarRule: '' };
  const today = iso(t);
  const r = MEM.upcoming([m], today, 30);
  assert.equal(r.available, true);
  const row = r.rows.find(x => x.date === today);
  assert.ok(row, 'המופע של היום (א׳) נמצא: ' + JSON.stringify(r.rows));
  assert.equal(row.uncertain, true);
  assert.equal(row.daysLeft, 0);
  // כ״ט (אתמול) לא מוצג — רק מהיום והלאה
  assert.ok(r.rows.every(x => x.date >= today));
  // יום קודם: שני המופעים (כ״ט וא׳)
  const before = MEM.upcoming([m], iso(t - DAY), 30).rows.filter(x => x.uncertain).map(x => x.date);
  assert.deepEqual(before, [iso(t - DAY), today]);
});

/* ---------- עריכת תאריך עברי כשיש תאריך פטירה לועזי ---------- */

test('הנצחה: יום / חודש עברי שהוקלדו ושונים מתאריך הפטירה הלועזי — שגיאה בעברית, לא נזרקים בשקט', { skip: !H.available() }, () => {
  const base = MEM.validateMemorial({ name: 'פלוני', deathDate: '2025-05-12', afterSunset: false });
  // חדש: תאריך לועזי והקלדה סותרת
  assert.throws(() => MEM.validateMemorial({ name: 'פלוני', deathDate: '2025-05-12', hebrewDay: base.hebrewDay === 1 ? 2 : 1, hebrewMonth: base.hebrewMonth }),
    /התאריך העברי מחושב מתאריך הפטירה הלועזי/);
  assert.throws(() => MEM.validateMemorial({ name: 'פלוני', deathDate: '2025-05-12', hebrewDay: base.hebrewDay, hebrewMonth: 'Tishri' }), /החודש/);
  // הקלדה תואמת — תקין
  assert.equal(MEM.validateMemorial({ name: 'פלוני', deathDate: '2025-05-12', hebrewDay: base.hebrewDay, hebrewMonth: base.hebrewMonth }).hebrewDay, base.hebrewDay);
  // עריכה: הטופס מחזיר את הערכים העבריים הקודמים (נגזרים) ותאריך לועזי חדש — מחושב מחדש, בלי שגיאה
  const prev = { ...base, id: 'x' };
  const moved = MEM.validateMemorial({ ...prev, deathDate: '2025-06-12' }, { prev });
  assert.equal(moved.hebrewDay, MEM.hebrewOfDeath('2025-06-12', false).day);
  assert.equal(moved.hebrewMonth, MEM.hebrewOfDeath('2025-06-12', false).month);
  // "אחרי השקיעה" השתנה — גם כן מחושב מחדש
  assert.equal(MEM.validateMemorial({ ...prev, afterSunset: true }, { prev }).hebrewDay, MEM.hebrewOfDeath('2025-05-12', true).day);
  // עריכה: שינוי היום העברי בלבד כשהתאריך הלועזי נשאר — שגיאה (לפני התיקון: נשמר הישן בשקט)
  assert.throws(() => MEM.validateMemorial({ ...prev, hebrewDay: base.hebrewDay === 1 ? 2 : 1 }, { prev }), /לרוקן את תאריך הפטירה הלועזי/);
  // בלי תאריך לועזי — היום העברי נקבע ישירות
  assert.equal(MEM.validateMemorial({ ...prev, deathDate: '', hebrewDay: 5 }, { prev }).hebrewDay, 5);
});

test('npoService.saveMemorial מעביר את הרשומה הקודמת לבדיקה', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/services/npoService.js'), 'utf8');
  assert.match(src, /MEM\.validateMemorial\(\{ \.\.\.\(prev \|\| \{\}\), \.\.\.input \}, \{ count: prev \? 0 : list\.length, prev \}\)/);
});

/* ---------- מסך הבית בשקיעה ---------- */

const SHELL = fs.readFileSync(path.join(ROOT, 'shell/shell.js'), 'utf8');
const CATALOG = fs.readFileSync(path.join(ROOT, 'shell/catalog.js'), 'utf8');
const HEBCAL = fs.readFileSync(path.join(ROOT, 'shell/hebcal.js'), 'utf8');

function fakeEl() {
  return {
    hidden: false, focus() {}, blur() {}, select() {}, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    showModal() {}, close() {}, setAttribute() {},
  };
}

function loadShell(clock) {
  const elements = {};
  const intervals = [];
  let summaries = 0;
  const shellAPI = {
    getCalendar: async () => ({ shabbatMode: false }), switchTo: async () => true, goHome: async () => {},
    isLoggedIn: async () => false, onActiveView() {}, onActive() {}, onCmd() {}, quit: async () => {},
    getHomeSummary: async () => { summaries++; return null; },
  };
  const FakeDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  };
  const document = {
    getElementById(id) { return (elements[id] ||= fakeEl()); }, querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, createElement() { return fakeEl(); }, body: fakeEl(),
  };
  const context = { document, console, confirm: () => true, alert() {}, prompt: () => null, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { intervals.push([fn, ms]); return intervals.length; }, clearInterval() {}, Intl, Date: FakeDate, Math,
    localStorage: { getItem: () => null, setItem() {} } };
  context.window = context;
  context.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  vm.runInContext(HEBCAL, context, { filename: 'hebcal.js' });
  vm.runInContext(CATALOG, context, { filename: 'catalog.js' });
  vm.runInContext(SHELL, context, { filename: 'shell.js' });
  return { elements, minute: () => intervals.filter(([, ms]) => ms === 60000).forEach(([fn]) => fn()), summaries: () => summaries };
}

test('מסך הבית: בשקיעה מתעדכנים גם הברכה, שורת התאריך ו"היום" — לא רק כרטיס הזמנים', async () => {
  // יום רביעי 21.10.2026: 15:00 בישראל ← 19:30 (אחרי השקיעה, התאריך העברי התחלף)
  const clock = { now: Date.UTC(2026, 9, 21, 12, 0) };
  const s = loadShell(clock);
  await tick();
  const before = s.elements.dates.innerHTML;
  const greetBefore = s.elements.greet.textContent;
  assert.ok(before && !/אור ליום/.test(before), before);
  clock.now = Date.UTC(2026, 9, 21, 16, 30);
  s.minute();
  assert.notEqual(s.elements.dates.innerHTML, before, 'שורת התאריך העברי התחלפה');
  assert.match(s.elements.dates.innerHTML, /אור ליום/);
  assert.notEqual(s.elements.greet.textContent, greetBefore, 'הברכה התחלפה (ערב)');
  assert.notEqual(s.elements.todayDate.textContent, '', 'תג "היום"');
  // דקה נוספת בלי שינוי — רק כרטיס הזמנים (בלי בנייה מחדש של כל המסך)
  const html = s.elements.dates.innerHTML;
  s.elements.dates.innerHTML = 'X';
  clock.now += 60000;
  s.minute();
  assert.equal(s.elements.dates.innerHTML, 'X');
  void html;
  // חצות — יום אזרחי חדש: גם נתוני "היום" נטענים מחדש
  const n = s.summaries();
  clock.now = Date.UTC(2026, 9, 21, 21, 5); // 00:05 בישראל
  s.minute();
  await tick();
  assert.ok(s.summaries() > n, 'loadHome ביום חדש');
});

/* ---------- ממשק המודול הכלכלי ---------- */

let NOW = new Date(2026, 0, 1, 10, 0).getTime();
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}
function el(tag = 'div', extra = {}) {
  const listeners = {};
  const node = Object.assign({
    tagName: String(tag).toUpperCase(), textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [],
    disabled: false, hidden: false, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); }, removeEventListener() {}, _listeners: listeners,
    append(...c) { node.children.push(...c); }, prepend(...c) { node.children.unshift(...c); }, appendChild(c) { node.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
  }, extra);
  return node;
}
// select כמו בדפדפן: value נגזר מהאפשרות הנבחרת; ערך שאין לו אפשרות ← בלי בחירה ('')
function selectEl() {
  const node = el('select');
  let idx = 0;
  Object.defineProperty(node, 'selectedIndex', { get: () => (node.children.length ? idx : -1), set: (v) => { idx = v; } });
  Object.defineProperty(node, 'value', {
    get: () => (node.children[idx] ? node.children[idx].value : ''),
    set: (v) => { idx = node.children.findIndex(o => o.value === String(v)); },
  });
  return node;
}
function loadEcon() {
  const created = [];
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById(id) { return el('div', { id }); }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { const n = tag === 'select' ? selectEl() : el(tag); created.push(n); return n; },
    createTextNode(t) { return { textContent: t }; }, body: el('body'),
  };
  const context = { console, setTimeout, clearTimeout, setImmediate, Date: FakeDate, Intl, URLSearchParams, TextDecoder, location: { search: '' }, document };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  context.openDialog = (build) => new Promise((resolve) => build(el('div', { parentNode: el('div') }), resolve));
  return { context, created, run: (code) => vm.runInContext(code, context) };
}

test('askFields: שדה רשות (optional) נשלח ריק; שדה חובה ריק נדחה', async () => {
  const { created, run } = loadEcon();
  let result = 'pending';
  run(`askFields('בדיקה', [{ name: 'a', label: 'שם' }, { name: 'b', label: 'סיבה (לא חובה)', optional: true }], 'שמירה')`).then(v => { result = v; });
  const form = created.find(n => n.tagName === 'FORM');
  const [a, b] = created.filter(n => n.tagName === 'INPUT');
  a.value = 'x'; b.value = '';
  form._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(JSON.stringify(result), '{"a":"x","b":""}');
  // חובה ריק — נדחה
  let r2 = 'pending';
  run(`askFields('בדיקה', [{ name: 'a', label: 'שם' }], 'שמירה')`).then(v => { r2 = v; });
  const form2 = created.filter(n => n.tagName === 'FORM')[1];
  form2._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(r2, 'pending');
});

test('askFields: השדות שמסומנים "לא חובה" / "אם נמסר" במסכים — optional', () => {
  const src = EconUI.source();
  assert.match(src, /\{ name: 'lostReason', label: 'סיבה \(לא חובה\)', optional: true \}/);
  assert.match(src, /\{ name: 'idNumber', label: 'מספר זהות \(אם נמסר\)', optional: true \}/);
  assert.match(src, /optional: status !== 'rejected'/);
  // כל קריאה ל-askFields עם שדה שהתווית שלו אומרת "לא חובה" — מסומן optional
  for (const m of src.matchAll(/askFields\([^;]*?\{ name: '(\w+)', label: '[^']*לא חובה[^']*'([^}]*)\}/g)) {
    assert.match(m[2], /optional/, m[1]);
  }
});

test('licForm: רשימת בחירה בלי ערך מוגדר — האפשרות הראשונה נבחרת (לא רשימה ריקה)', async () => {
  const { created, run } = loadEcon();
  let result = 'pending';
  run(`licForm('בדיקה', [{ name: 'provider', label: 'ספק', type: 'select', options: [['a', 'א'], ['b', 'ב']] },
    { name: 'kind', label: 'סוג', type: 'select', options: [['x', 'X'], ['y', 'Y']], value: 'y' },
    { name: 'gone', label: 'ערך שכבר אינו ברשימה', type: 'select', options: [['p', 'P']], value: 'old' }], 'שמירה')`).then(v => { result = v; });
  const form = created.find(n => n.tagName === 'FORM');
  form._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(JSON.stringify(result), '{"provider":"a","kind":"y","gone":"p"}');
});

test('תקופת הדוחות: ברירת המחדל מחושבת בכל פתיחה (תוכנה שנשארה פתוחה אחרי חצות / בתחילת שנה)', () => {
  NOW = new Date(2026, 11, 31, 23, 50).getTime();
  const { run } = loadEcon();
  assert.equal(run('JSON.stringify(acctPeriod())'), '{"from":"2026-01-01","to":"2026-12-31"}');
  NOW = new Date(2027, 0, 1, 0, 10).getTime();
  assert.equal(run('JSON.stringify(acctPeriod())'), '{"from":"2027-01-01","to":"2027-01-01"}');
  // תקופה שהמשתמש בחר — נשמרת
  run("state.acctPeriod = { from: '2026-03-01', to: '2026-03-31' }");
  NOW = new Date(2027, 0, 2, 9, 0).getTime();
  assert.equal(run('JSON.stringify(acctPeriod())'), '{"from":"2026-03-01","to":"2026-03-31"}');
});

test('נדל"ן: תאריך הזמנת תיווך, שנת טבלת מס ורבעון פרויקט — מחושבים בכל פתיחת טופס', async () => {
  NOW = new Date(2026, 4, 10, 12, 0).getTime();
  const { context, run } = loadEcon();
  context.rltyData = () => ({ clients: [], properties: [], transactions: {}, feeTypes: {}, taxKinds: {} });
  const field = (schema, name) => run(`${schema}.fields.find(x => x.name === '${name}').value`);
  await run('rltyOrderSchema.prepare(rltyOrderSchema)');
  await run('rltyTaxTableSchema.prepare(rltyTaxTableSchema)');
  await run('rltyProjectSchema.prepare(rltyProjectSchema)');
  assert.equal(field('rltyOrderSchema', 'date'), '2026-05-10');
  NOW = new Date(2027, 1, 3, 12, 0).getTime();
  await run('rltyOrderSchema.prepare(rltyOrderSchema)');
  await run('rltyTaxTableSchema.prepare(rltyTaxTableSchema)');
  await run('rltyProjectSchema.prepare(rltyProjectSchema)');
  assert.equal(field('rltyOrderSchema', 'date'), '2027-02-03', 'לא התאריך של הפתיחה הראשונה');
  assert.equal(field('rltyTaxTableSchema', 'year'), 2027);
  assert.equal(field('rltyProjectSchema', 'startMonth'), '2027-02');
});
