// ארגז הכלים — תיקונים מסקירת הקוד 2.11.2026 (docs/CODE-AUDIT-2026-11-02.md, "ארגז הכלים"):
// פיצויים עם תאריך סיום כולל, פסיק בסכום רק כמפריד אלפים, אחוזים במחשבון, משימות פגומות,
// Enter במחשבון, רשימת מעשרות ארוכה, כתיב מעריכי, שגיאות בעברית ו-Base64 גדול.
// app.js רץ ב-vm עם DOM מדומה — נבדקת ההתנהגות בפועל.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const C = require('../modules/tools/calc.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'app.js'), 'utf8');

// DOM מדומה: אלמנט לכל מזהה (נוצר בפנייה הראשונה), מאזין keydown אחד על המסמך
function loadApp(storage = {}) {
  const els = {};
  const keydown = [];
  const mk = (id) => ({
    id, tagName: 'DIV', value: '', textContent: '', innerHTML: '', checked: false, dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {} },
    replaceChildren(...kids) { this.children = kids; },
    querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; }, click() {}, focus() {},
  });
  const document = {
    getElementById: (id) => (els[id] ||= mk(id)),
    createElement: (tag) => ({ ...mk(''), tagName: tag.toUpperCase() }),
    addEventListener: (ev, fn) => { if (ev === 'keydown') keydown.push(fn); },
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { tagName: 'BODY' },
  };
  document.activeElement = document.body;
  // ערכי ברירת המחדל מ-index.html שהכלים קוראים בטעינה
  for (const [id, v] of Object.entries({ uType: 'אורך', sgG: '12000', sgC: '2.25', sgP: '6' })) document.getElementById(id).value = v;
  const errors = [];
  const localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  const ctx = {
    document, localStorage, navigator: {}, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, Intl, console,
    // שגיאה שנזרקת מחוץ לזרם (tool) — נאספת, כמו ש-screen-guard היה מקבל אותה
    setTimeout: (fn) => { try { fn(); } catch (e) { errors.push(e); } return 0; },
    setInterval: () => 0, clearInterval() {}, ssDialog: { confirm: async () => true },
  };
  ctx.window = ctx;
  ctx.window.ToolsCalc = C;
  vm.createContext(ctx);
  vm.runInContext(APP, ctx, { filename: 'app.js' });
  const $ = (id) => document.getElementById(id);
  const press = (...keys) => { for (const k of keys) $('cKeys').onclick({ target: { dataset: { k } } }); return $('cDisp').textContent; };
  return { els, $, press, document, keydown, errors, storage };
}

test('פיצויים: תאריך הסיום כולל — 1.1–31.12 היא שנה מלאה, זכאי, והסכום לפי אותו ותק', () => {
  const r = C.severance({ salary: '10000', from: '2025-01-01', to: '2025-12-31' });
  assert.equal(r.eligible, true);
  assert.equal(r.years, 1);
  assert.equal(r.amountAg, 1000000);
  // יום לפני שנה מלאה — לא זכאי, והזכאות תואמת את הוותק
  const s = C.severance({ salary: '10000', from: '2025-01-01', to: '2025-12-30' });
  assert.equal(s.eligible, false);
  assert.ok(s.amountAg < 1000000);
});

test('סכום בשקלים: פסיק רק כמפריד אלפים בקבוצות של 3', () => {
  assert.equal(C.toAg('10,50'), null);
  assert.equal(C.toAg('12,5'), null);
  assert.equal(C.toAg('1,23'), null);
  assert.equal(C.toAg('1,2345'), null);
  assert.equal(C.toAg('1,234.50'), 123450);
  assert.equal(C.toAg('₪ 1,234,567'), 123456700);
  assert.equal(C.toAg('1234.5'), 123450);
  // הסכום השגוי לא נשמר במעשרות
  assert.throws(() => C.newMaaserEntry({ kind: 'income', amount: '10,50', date: '2026-01-01' }), /סכום/);
  assert.equal(C.newMaaserEntry({ kind: 'income', amount: '1,050', date: '2026-01-01' }).amountAg, 105000);
});

test('מחשבון: אחוזים בחיבור ובחיסור הם מהסכום, בכפל — חלק ממאה', () => {
  const a = loadApp();
  assert.equal(a.press('C', '1', '0', '0', '−', '1', '5', '%', '='), '85');
  assert.equal(a.press('C', '2', '0', '0', '+', '1', '0', '%', '='), '220');
  assert.equal(a.press('C', '5', '0', '×', '1', '0', '%', '='), '5');
  assert.equal(a.press('C', '5', '0', '%', '='), '0.5');
  assert.equal(a.press('C', '1', '0', '+', '5', '0', '%', '×', '2', '='), '11', 'אחוז שהוא חלק מכפל — לא אחוז מהסכום');
});

test('מחשבון: תוצאה קטנה מאוד מוצגת בלי כתיב מעריכי, ואפשר להמשיך לחשב ממנה', () => {
  const a = loadApp();
  assert.equal(a.press('C', '1', '÷', '1', '0', '0', '0', '0', '0', '0', '0', '='), '0.0000001');
  assert.equal(a.press('+', '1', '='), '1.0000001');
  assert.equal(a.press('C', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '×', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '='), '9999999999900000000000');
});

test('מחשבון: Enter על כפתור מחוץ למחשבון (למשל „אישור” בחלון) לא נחסם ולא מחושב', () => {
  const a = loadApp();
  a.press('C', '2', '+', '2');
  let prevented = false;
  const ev = { key: 'Enter', preventDefault() { prevented = true; } };
  a.document.activeElement = { tagName: 'BUTTON', closest: () => null };
  a.keydown.forEach(fn => fn(ev));
  assert.equal(prevented, false);
  assert.equal(a.$('cDisp').textContent, '2+2');
  // מיקוד בתוך המחשבון — Enter מחשב
  a.document.activeElement = { tagName: 'BUTTON', closest: (sel) => (sel === '.calc' ? {} : null) };
  a.keydown.forEach(fn => fn(ev));
  assert.equal(prevented, true);
  assert.equal(a.$('cDisp').textContent, '4');
});

test('משימות שמורות שאינן רשימה לא מפילות את הכלים שאחריהן (שכר נטו, מעשרות)', () => {
  const a = loadApp({ tb_todos: JSON.stringify({ x: 1 }) });
  assert.deepEqual(a.errors.map(e => e.stack), []);
  assert.match(a.$('tList').innerHTML, /אין משימות/);
  assert.match(a.$('sgO').innerHTML, /נטו משוער/);
  assert.match(a.$('mO').innerHTML, /הכנסות/);
  const b = loadApp({ tb_todos: JSON.stringify([null, { t: 'לקנות לחם', d: true }, 5]) });
  assert.match(b.$('tList').innerHTML, /data-i="0"/);
  assert.doesNotMatch(b.$('tList').innerHTML, /data-i="1"/);
});

test('מעשרות: יותר מ-100 רשומות — „הצג עוד” מציג גם את הישנות (ואפשר למחוק אותן)', () => {
  const list = Array.from({ length: 150 }, (_, i) => ({ id: 'e' + i, kind: 'income', amountAg: 100, date: `2020-01-01` }));
  list[149] = { id: 'old', kind: 'income', amountAg: 100, date: '2019-05-05' };
  const a = loadApp({ tb_maaser: JSON.stringify(list) });
  const rows = () => (a.$('mList').innerHTML.match(/data-mx=/g) || []).length;
  assert.equal(rows(), 100);
  assert.match(a.$('mList').innerHTML, /הצג עוד \(50/);
  a.$('mList').onclick({ target: { dataset: { mmore: '1' } } });
  assert.equal(rows(), 150);
  assert.match(a.$('mList').innerHTML, /data-mx="old"/);
  assert.doesNotMatch(a.$('mList').innerHTML, /הצג עוד/);
});

test('שגיאות למשתמש — בעברית, לא הודעות JavaScript באנגלית', () => {
  const heb = /[א-ת]/;
  for (const bad of [{ year: 2026, creditPoint: 242, brackets: [1, 2, 3] },
    { year: 2026, creditPoint: 242, brackets: [[7000, 10], [null, 20]], social: { threshold: 1, ceiling: 2 } }]) {
    assert.throws(() => C.parseSalaryTable(bad), (e) => heb.test(e.message) && !(e instanceof TypeError));
  }
  assert.throws(() => C.addDays('2026-01-01', 1e9), (e) => heb.test(e.message));
  const a = loadApp();
  a.$('jIn').value = '{bad json';
  a.$('jFmt').onclick();
  assert.match(a.$('jOut').textContent, /^שגיאה: .*JSON/);
  assert.doesNotMatch(a.$('jOut').textContent, /Unexpected|token|position/i);
  a.$('jIn').value = '@@@ לא base64';
  a.$('b64d').onclick();
  assert.match(a.$('jOut').textContent, /^שגיאה: .*Base64/);
  assert.doesNotMatch(a.$('jOut').textContent, /[A-Za-z]{6,}/, 'בלי הודעת דפדפן באנגלית');
  // הוספת ימים עם מספר ענק
  a.$('dX').value = '2026-01-01'; a.$('dN').value = '100000000';
  a.$('dN').onchange();
  assert.match(a.$('dAdd').textContent, /^שגיאה: [^A-Za-z]+$/);
});

test('Base64: טקסט של כ-300KB מקודד ומפוענח בלי שגיאה', () => {
  const a = loadApp();
  const big = 'שלום עולם 123 '.repeat(15000);
  a.$('jIn').value = big;
  a.$('b64e').onclick();
  const enc = a.$('jOut').textContent;
  assert.doesNotMatch(enc, /^שגיאה/);
  assert.equal(Buffer.from(enc, 'base64').toString('utf8'), big);
  a.$('jIn').value = enc;
  a.$('b64d').onclick();
  assert.equal(a.$('jOut').textContent, big);
});
