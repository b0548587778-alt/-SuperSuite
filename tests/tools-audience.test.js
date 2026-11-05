// כלים לקהל היעד בארגז הכלים (PLAN.md 9.12): שכר נטו, מעשרות, הצמדה, גימטריה, הבראה ופיצויים — מול ערכים ידועים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../modules/tools/calc.js');

// טבלה פשוטה לבדיקה: מדרגה אחת 10% עד 10,000 ו-20% מעליה, נקודה = 200 ₪, ביטוח 1%+2% עד 5,000 ו-5%+5% עד 20,000
const T = { year: 2030, verified: true, creditPoint: 200, brackets: [[10000, 10], [null, 20]], social: { threshold: 5000, ceiling: 20000, reduced: [1, 2], full: [5, 5] } };

test('שכר נטו: מדרגות, נקודות זיכוי, ביטוח לאומי ובריאות בשתי מדרגות ותקרה, ופנסיה — באגורות', () => {
  const r = C.netSalary({ gross: '15000', creditPoints: 2, pensionPct: 5, table: T });
  assert.equal(r.taxBeforeCreditAg, 100000 + 100000, '10% מ-10,000 + 20% מ-5,000');
  assert.equal(r.creditAg, 40000);
  assert.equal(r.incomeTaxAg, 160000);
  assert.equal(r.bituachAg, 5000 + 50000, '1% מ-5,000 + 5% מ-10,000');
  assert.equal(r.healthAg, 10000 + 50000);
  assert.equal(r.pensionAg, 75000);
  assert.equal(r.netAg, 1500000 - 160000 - 55000 - 60000 - 75000);
  // מעל התקרה — ביטוח לא גדל; זיכוי גדול מהמס — מס 0
  const high = C.netSalary({ gross: 30000, creditPoints: 0, pensionPct: 0, table: T });
  assert.equal(high.bituachAg, 5000 + 75000);
  assert.equal(C.netSalary({ gross: 3000, creditPoints: 5, pensionPct: 0, table: T }).incomeTaxAg, 0);
  for (const k of ['incomeTaxAg', 'bituachAg', 'healthAg', 'pensionAg', 'netAg']) assert.ok(Number.isInteger(r[k]), k);
  assert.throws(() => C.netSalary({ gross: 'abc', table: T }), /שכר ברוטו/);
  assert.throws(() => C.netSalary({ gross: 1000, creditPoints: 30, table: T }), /נקודות הזיכוי/);
  // הטבלה המובנית מסומנת כלא מאומתת ומציגה את שנת התוקף
  assert.equal(C.SALARY_TABLE_DEFAULT.verified, false);
  assert.equal(C.netSalary({ gross: 12000 }).year, C.SALARY_TABLE_DEFAULT.year);
});

test('טבלת שכר מקובץ: נבדקת במלואה, ושגיאה בעברית על כל שדה', () => {
  const ok = C.parseSalaryTable(JSON.stringify(T));
  assert.deepEqual(ok.brackets, T.brackets);
  assert.equal(ok.verified, true);
  assert.throws(() => C.parseSalaryTable('{oops'), /JSON/);
  assert.throws(() => C.parseSalaryTable({ ...T, year: 1990 }), /שנת תוקף/);
  assert.throws(() => C.parseSalaryTable({ ...T, brackets: [[10000, 10], [5000, 20], [null, 30]] }), /מדרגה 2/);
  assert.throws(() => C.parseSalaryTable({ ...T, brackets: [[10000, 10], [20000, 20]] }), /מדרגה 2/, 'המדרגה האחרונה בלי תקרה');
  assert.throws(() => C.parseSalaryTable({ ...T, social: { ...T.social, full: [5] } }), /ביטוח לאומי/);
  assert.equal(C.parseSalaryTable({ ...T, verified: 'yes' }).verified, false, 'רק true מפורש');
});

test('מעשרות: 10% / 20%, יתרה, ופילוח לפי שנה עברית', () => {
  const e = [
    C.newMaaserEntry({ kind: 'income', amount: '10,000', date: '2026-08-10' }),
    C.newMaaserEntry({ kind: 'income', amount: '5000', date: '2026-10-19' }),
    C.newMaaserEntry({ kind: 'given', amount: '600.50', date: '2026-10-19', note: 'קופת צדקה' }),
  ];
  const r = C.maaserSummary(e, 10);
  assert.equal(r.incomeAg, 1500000);
  assert.equal(r.dueAg, 150000);
  assert.equal(r.givenAg, 60050);
  assert.equal(r.balanceAg, 89950);
  assert.deepEqual(r.years.map(y => y.year), ['5786', '5787'], 'אלול תשפ"ו מול תשרי תשפ"ז');
  assert.equal(C.maaserSummary(e, 20).dueAg, 300000);
  assert.throws(() => C.maaserSummary(e, 15), /10% או 20%/);
  assert.throws(() => C.newMaaserEntry({ kind: 'income', amount: '', date: '2026-10-19' }), /סכום/);
  assert.throws(() => C.newMaaserEntry({ kind: 'income', amount: '5', date: '19/10/2026' }), /תאריך/);
  // רשומה פגומה מהאחסון — מדולגת
  assert.equal(C.maaserSummary([...e, { kind: 'income', amountAg: 'x', date: '2026-10-19' }, null], 10).incomeAg, 1500000);
});

test('הצמדה למדד: עלייה, ירידה ורצפה', () => {
  assert.deepEqual(C.indexLinkage({ amount: '100000', baseIndex: 100, currentIndex: 103.5 }), { amountAg: 10000000, linkedAg: 10350000, diffAg: 350000, changePct: 3.5 });
  assert.equal(C.indexLinkage({ amount: 1000, baseIndex: 105, currentIndex: 100 }).linkedAg, 95238);
  assert.equal(C.indexLinkage({ amount: 1000, baseIndex: 105, currentIndex: 100, floor: true }).linkedAg, 100000);
  assert.throws(() => C.indexLinkage({ amount: 1000, baseIndex: 0, currentIndex: 100 }), /מדד/);
});

test('גימטריה ומספר לאותיות', () => {
  assert.equal(C.gematria('שלום').total, 376);
  assert.equal(C.gematria('ישראל').total, 541);
  assert.equal(C.gematria('בְּרֵאשִׁית').total, 913, 'ניקוד מדולג');
  assert.equal(C.gematria('מלך').total, 90);
  assert.equal(C.gematria('מלך', { finals: true }).total, 570);
  assert.deepEqual(C.gematria('תורה, אמת!').words, [{ word: 'תורה', value: 611 }, { word: 'אמת', value: 441 }]);
  assert.equal(C.gematria('abc 123').total, 0);
  assert.equal(C.numberToHebrew(15), 'ט״ו');
  assert.equal(C.numberToHebrew(16), 'ט״ז');
  assert.equal(C.numberToHebrew(613), 'תרי״ג');
  assert.equal(C.numberToHebrew(5786), 'ה׳תשפ״ו');
  assert.equal(C.numberToHebrew(1), 'א׳');
  assert.equal(C.numberToHebrew(900), 'תת״ק');
  assert.throws(() => C.numberToHebrew(0), /1 ל-9999/);
});

test('דמי הבראה לפי ותק והיקף משרה, ופיצויים לפי חודשים מלאים', () => {
  assert.deepEqual(C.havraa({ years: 0.5 }), { days: 0, amountAg: 0, eligible: false });
  assert.equal(C.havraa({ years: 1, dayRate: 418 }).days, 5);
  assert.equal(C.havraa({ years: 2.5, dayRate: 418 }).days, 6);
  assert.deepEqual(C.havraa({ years: 4.5, dayRate: 418, jobPct: 50 }), { days: 7, amountAg: 146300, eligible: true });
  assert.equal(C.havraa({ years: 25, dayRate: 400 }).days, 10);
  assert.throws(() => C.havraa({ years: 3, dayRate: '' }), /שווי יום/);
  // תאריך הסיום — יום העבודה האחרון, כולל (סקירת קוד 2.11.2026)
  assert.deepEqual(C.severance({ salary: '10000', from: '2020-01-01', to: '2025-12-31' }), { days: 2192, years: 6, amountAg: 6000000, eligible: true });
  assert.equal(C.severance({ salary: 10000, from: '2024-03-15', to: '2025-09-14' }).amountAg, 1500000);
  assert.equal(C.severance({ salary: 8000, from: '2025-01-01', to: '2025-07-01' }).eligible, false);
  assert.throws(() => C.severance({ salary: 8000, from: '2025-07-01', to: '2025-01-01' }), /אחרי/);
});

test('חיבור: חמשת הכרטיסים בדף, טעינת טבלה מקובץ, אזהרת "לא מאומתת", הפניה לרב, ובלי רשת', () => {
  const dir = path.join(__dirname, '..', 'modules', 'tools');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const id of ['sgG', 'sgO', 'sgW', 'sgIn', 'mAdd', 'mO', 'mList', 'ixA', 'ixO', 'gmT', 'gmO', 'gmH', 'hvO', 'svO']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /יש לשאול רב/);
  assert.doesNotMatch(html, /שלושה-עשר כלים/);
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  assert.ok(app.includes("(table.verified?'':'⚠ ')"), 'טבלה לא מאומתת מסומנת ⚠');
  assert.match(String(C.SALARY_TABLE_DEFAULT.note), /לא אומתו/);
  assert.match(app, /parseSalaryTable\(saved\)/, 'טבלה שמורה נבדקת שוב');
  for (const src of [app, fs.readFileSync(path.join(dir, 'calc.js'), 'utf8')]) assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\//);
});

// בדיקת קוד 23.10.2026 (נמוך): רשומה בלי תאריך (או null) הפילה את המיון ברשימת המעשרות — וכל הדף אחריה לא עבד
test('מעשרות: רשימת התצוגה מדלגת על רשומה פגומה, החדש למעלה, עד 100', () => {
  const list = C.maaserRecent([
    { id: 'a', kind: 'income', amountAg: 1000, date: '2026-01-05' },
    null, 'זבל', { id: 'b', kind: 'given', amountAg: 100 }, { id: 'c', kind: 'given', amountAg: 50, date: 7 },
    { id: 'd', kind: 'given', amountAg: 100, date: '2026-03-01' },
  ]);
  assert.deepEqual(list.map(e => e.id), ['d', 'a']);
  assert.deepEqual(C.maaserRecent('לא רשימה'), []);
  const many = Array.from({ length: 150 }, (_, i) => ({ id: String(i), date: '2026-01-' + String(1 + (i % 28)).padStart(2, '0') }));
  assert.equal(C.maaserRecent(many).length, 100);
  // הדף משתמש בה (ולא במיון ישיר שנופל על רשומה בלי תאריך)
  const app = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'app.js'), 'utf8');
  assert.match(app, /C\.maaserRecent\(M[,)]/);
  assert.doesNotMatch(app, /b\.date\.localeCompare\(a\.date\)/);
});
