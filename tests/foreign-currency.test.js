// מטבע זר בתרומות ובהפקדות לגמ"ח (PLAN.md עדיפות 4): הסכום והשער מוקלדים, הרשומה נשמרת בשקלים
// באגורה מדויקת, והמטבע והשער נשמרים לתיעוד — בקבלה, בייצוא ובמסך.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../modules/econ/core/currency');
const N = require('../modules/econ/core/npo');
const G = require('../modules/econ/core/gemach');
const X = require('../modules/econ/core/exports');
const { source } = require('./helpers/econ-ui');

let nextId = 0;
const SETTINGS = N.applySettings({}, { orgName: 'עמותת חסד ותורה', sec46Number: '4321' }, new Set(), () => 'f' + (++nextId));

test('המרה: סכום × שער באגורות שלמות, בעיגול אחד', () => {
  const f = C.parseForeign({ currency: 'USD', foreignAmount: 1000, rate: 3.7 });
  assert.deepEqual(f, { currency: 'USD', amountMinor: 100000, rateE4: 37000, ilsAg: 370000 });
  // 0.1 + 0.2 ושער עם 4 ספרות: 33.33 $ × 3.6789 = 122.617737 ← 122.62
  assert.equal(C.parseForeign({ currency: 'USD', foreignAmount: 33.33, rate: 3.6789 }).ilsAg, 12262);
  assert.equal(C.parseForeign({ currency: 'EUR', foreignAmount: '0.30', rate: '4' }).ilsAg, 120);
});

test('המרה: שקל או מטבע לא מוכר ← null (הסכום הרגיל)', () => {
  assert.equal(C.parseForeign({}), null);
  assert.equal(C.parseForeign({ currency: 'ILS', foreignAmount: 5, rate: 3 }), null);
  assert.equal(C.parseForeign({ currency: 'XYZ', foreignAmount: 5, rate: 3 }), null);
});

test('המרה: סכום או שער חסרים / לא תקינים ← שגיאה בעברית', () => {
  assert.throws(() => C.parseForeign({ currency: 'USD', rate: 3.7 }), /הסכום בדולר/);
  assert.throws(() => C.parseForeign({ currency: 'USD', foreignAmount: -1, rate: 3.7 }), /הסכום בדולר/);
  assert.throws(() => C.parseForeign({ currency: 'USD', foreignAmount: 10 }), /שער דולר/);
  assert.throws(() => C.parseForeign({ currency: 'EUR', foreignAmount: 10, rate: 0 }), /שער אירו/);
  assert.throws(() => C.parseForeign({ currency: 'GBP', foreignAmount: 10, rate: 0.00001 }), /שער לירה/);
  assert.throws(() => C.parseForeign({ currency: 'USD', foreignAmount: 10, rate: 370 }), /שער דולר/, 'שער מופרז — כנראה טעות הקלדה');
});

test('תרומה בדולר: נרשמת בשקלים, המטבע והשער נשמרים, והסכום שהוקלד בשקלים לא גובר', () => {
  const d = N.validateDonation({ donorName: 'יעקב לוי', currency: 'USD', foreignAmount: 1000, rate: 3.7, amount: 1 }, SETTINGS);
  assert.equal(d.amount, 3700);
  assert.deepEqual(d.foreign, { currency: 'USD', amountMinor: 100000, rateE4: 37000 });
  const plain = N.validateDonation({ donorName: 'יעקב לוי', amount: 180 }, SETTINGS);
  assert.equal(plain.amount, 180);
  assert.equal('foreign' in plain, false, 'תרומה בשקלים — בלי שדה foreign');
  assert.throws(() => N.validateDonation({ donorName: 'א', currency: 'USD', foreignAmount: 100 }, SETTINGS), /שער דולר/);
});

test('תרומה בדולר: הסיכום השנתי לתורם בשקלים', () => {
  const a = N.validateDonation({ date: '2026-02-01', donorName: 'יעקב לוי', currency: 'USD', foreignAmount: 100, rate: 3.65 }, SETTINGS);
  const b = N.validateDonation({ date: '2026-03-01', donorName: 'יעקב לוי', amount: 0.5 }, SETTINGS);
  const rows = [a, b].map(d => ({ ...d, receipt: { sec46: true } }));
  const r = N.annualReport(rows, [], SETTINGS, 2026);
  assert.equal(r.donationsTotal, 365.5);
});

test('המחאות דחויות — תמיד בשקלים, גם אם נשלח מטבע', () => {
  const plan = N.planChequeDonation({
    donorName: 'יעקב לוי', receivedDate: '2026-01-10', currency: 'USD', foreignAmount: 1, rate: 3.7,
    cheques: [{ number: '101', dueDate: '2026-02-01', amount: 100 }]
  }, SETTINGS);
  assert.equal(plan.donations[0].amount, 100);
  assert.equal('foreign' in plan.donations[0], false);
});

test('קבלה וייצוא: הסכום במטבע הזר והשער מופיעים', () => {
  const clean = N.validateDonation({ date: '2026-02-01', donorName: 'יעקב לוי', currency: 'USD', foreignAmount: 1000, rate: 3.7 }, SETTINGS);
  const { receipt } = N.issueReceipt(clean, SETTINGS);
  const html = X.renderDonationReceiptHtml({ ...clean, receipt, status: 'active' });
  assert.match(html, /התקבל במטבע זר/);
  assert.match(html, /\$ \(שער 3\.7\)/);
  assert.match(html, /3,700\.00/);
  const t = N.exportTable('donations', [{ ...clean, receipt }], [], SETTINGS, 2026);
  assert.equal(t.headers.at(-1), 'מטבע זר');
  assert.match(t.rows[0].at(-1), /\$ \(שער 3\.7\)/);
  const plainHtml = X.renderDonationReceiptHtml({ ...N.validateDonation({ donorName: 'א', amount: 5 }, SETTINGS), receipt, status: 'active' });
  assert.doesNotMatch(plainHtml, /מטבע זר/);
});

test('גמ"ח: הפקדה באירו נרשמת בשקלים ונכנסת ליתרת הקופה', () => {
  const dep = G.validateDepositInput({ date: '2026-01-01', depositorName: 'קרן משפחת כהן', currency: 'EUR', foreignAmount: 2500, rate: 4.02 });
  assert.equal(dep.amount, 10050);
  assert.deepEqual(dep.foreign, { currency: 'EUR', amountMinor: 250000, rateE4: 40200 });
  const ov = G.overview([], [dep, G.validateDepositInput({ date: '2026-01-02', depositorName: 'א', amount: 0.5 })], {});
  assert.equal(ov.depositsTotal, 10050.5);
  const t = G.exportTable('deposits', [], [dep], {});
  assert.deepEqual(t.headers, ['תאריך', 'מפקיד', 'סכום (₪)', 'מטבע זר', 'בטוחה להלוואה של', 'הערות']);
  assert.match(t.rows[0][3], /€ \(שער 4\.02\)/);
  assert.throws(() => G.validateDepositInput({ depositorName: 'א', currency: 'EUR', foreignAmount: 10 }), /שער אירו/);
});

test('ממשק: הטפסים כוללים את שדות המטבע, וההמרה לא נעשית בממשק', () => {
  const ui = source();
  assert.match(ui, /const CURRENCY_FIELDS = /);
  assert.equal((ui.match(/\.\.\.CURRENCY_FIELDS/g) || []).length, 2, 'טופס תרומה וטופס הפקדה');
  assert.doesNotMatch(ui, /rateE4\s*\/\s*10000\s*\*|amountMinor\s*\*\s*/, 'אין חישוב סכום בשקלים בממשק');
});
