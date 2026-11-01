// ארגז הכלים — תיקונים לפי בדיקת הקוד מ-20.10.2026 (docs/audit-parts/audit-trainer-tools.md), ממצאים 6, 10, 12:
// היסטוריית המחשבון כטקסט בלבד, מע"מ באגורות שלמות, ותאריכי ברירת מחדל לפי היום המקומי (לא UTC)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../modules/tools/calc.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
// הכותרת המשותפת ($, store) + בלוק אחד מתוך app.js, כמו שהוא
const block = (from, to) => APP.slice(0, APP.indexOf('/* מחשבון */')) + APP.slice(APP.indexOf(from), APP.indexOf(to));

// DOM מינימלי: אלמנט לפי מזהה, createElement, ורישום של כל השמה ל-innerHTML
function fakeDom(storage) {
  const els = {};
  const htmlWrites = [];
  const mk = (tag) => {
    const el = { tagName: tag, value: '', textContent: '', children: [], classList: { add() {}, remove() {} },
      replaceChildren(...kids) { this.children = kids; } };
    Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set(v) { htmlWrites.push(String(v)); } });
    return el;
  };
  const document = {
    getElementById: (id) => (els[id] ||= mk('DIV')),
    createElement: (tag) => mk(tag.toUpperCase()),
    addEventListener() {},
    activeElement: { tagName: 'BODY' },
  };
  const localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  return { els, htmlWrites, ctx: { document, localStorage, window: { ToolsCalc: C }, navigator: {}, setTimeout } };
}

test('ממצא 10: היסטוריית המחשבון משגיב שוחזר מוצגת כטקסט — לא כ-HTML', () => {
  const evil = '<a href="https://example.invalid">לחצו לעדכון</a><img src=x>';
  const dom = fakeDom({ tb_calcHist: JSON.stringify(['1+1 = 2', evil]) });
  vm.runInNewContext(block('/* מחשבון */', '/* ממיר יחידות */'), dom.ctx);
  const rows = dom.els.cHist.children;
  assert.deepEqual(rows.map(r => r.textContent), [evil, '1+1 = 2'], 'החדש למעלה, הטקסט כמו שהוא');
  assert.ok(rows.every(r => r.tagName === 'DIV'));
  assert.ok(!dom.htmlWrites.some(h => h.includes('example.invalid')), 'שום השמה ל-innerHTML עם תוכן ההיסטוריה');
  // ערך שאינו רשימה (קובץ פגום) — לא קורס
  const dom2 = fakeDom({ tb_calcHist: JSON.stringify({ x: 1 }) });
  assert.doesNotThrow(() => vm.runInNewContext(block('/* מחשבון */', '/* ממיר יחידות */'), dom2.ctx));
  assert.deepEqual(dom2.els.cHist.children, []);
});

test('ממצא 12: vatCalc — באגורות שלמות, מע"מ מעוגל לאגורה, ונטו + מע"מ = הסכום', () => {
  const v = C.vatCalc('99.99', '17');
  assert.deepEqual(v, { amountAg: 9999, addVatAg: 1700, addTotalAg: 11699, removeNetAg: 8546, removeVatAg: 1453 });
  const w = C.vatCalc('1000', '18');
  assert.deepEqual([w.addVatAg, w.addTotalAg, w.removeNetAg, w.removeVatAg], [18000, 118000, 84746, 15254]);
  for (const [a, r] of [['0.01', '18'], ['1234567.89', '18'], ['5', '0'], ['333.33', '17.5']]) {
    const x = C.vatCalc(a, r);
    assert.ok(Object.values(x).every(Number.isSafeInteger), `${a} / ${r} — מספרים שלמים`);
    assert.equal(x.removeNetAg + x.removeVatAg, x.amountAg);
    assert.equal(x.addTotalAg - x.addVatAg, x.amountAg);
  }
  for (const [a, r] of [['99.999', '18'], ['-5', '18'], ['abc', '18'], ['', '18'], ['100', '150'], ['100', 'x'], ['100', '']]) {
    assert.equal(C.vatCalc(a, r), null, `${a} / ${r} — לא תקין`);
  }
});

test('ממצא 12: מסך המע"מ מציג שתי ספרות אחרי הנקודה (₪), בלי 117.9882', () => {
  const dom = fakeDom({});
  const el = (id) => dom.ctx.document.getElementById(id);
  el('vA').value = '99.99'; el('vR').value = '17';
  vm.runInNewContext(block('/* מע״מ */', '/* תאריך עברי */'), dom.ctx);
  const lines = dom.els.vO.children.map(c => c.textContent);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /הוספת מע״מ: ₪116\.99 \(מע״מ ₪17\.00\)/);
  assert.match(lines[1], /הסרת מע״מ: ₪85\.46 \(מע״מ ₪14\.53\)/);
  assert.doesNotMatch(lines.join(' '), /\d\.\d{3}/, 'לא יותר משתי ספרות');
  el('vA').value = '99.999';
  el('vA').oninput();
  assert.match(dom.els.vO.children[0].textContent, /לא תקינים/);
});

test('ממצא 6: ברירת המחדל בכלי התאריכים — היום המקומי (localDay), לא toISOString', () => {
  assert.equal(C.localDay(new Date(2026, 9, 21, 1, 30)), '2026-10-21', 'אחרי חצות — כבר היום החדש');
  assert.equal(C.localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.doesNotMatch(APP, /toISOString\(\)\.slice\(0,\s*10\)/, 'אין יום ב-UTC כברירת מחדל');
  assert.match(APP, /\$\('hD'\)\.value=window\.ToolsCalc\.localDay\(\)/, 'תאריך עברי');
  assert.match(APP, /const t=C\.localDay\(\);\$\('dA'\)\.value=t/, 'הפרש תאריכים / הוספת ימים');
});

