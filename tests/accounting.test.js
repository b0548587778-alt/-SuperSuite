const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../modules/econ/core/accounting');

const accounts = A.DEFAULT_CHART;

test('מסרב לרשומה לא מאוזנת', () => {
  assert.throws(() => A.validateEntry({ date: '2026-01-05', lines: [
    { account: '1000', debit: 100 }, { account: '4000', credit: 99 }
  ] }, accounts), /לא מאוזנת/);
});

test('מסרב לחשבון שלא קיים ולשורה עם חובה וזכות', () => {
  assert.throws(() => A.validateEntry({ date: '2026-01-05', lines: [
    { account: '9999', debit: 1 }, { account: '1000', credit: 1 }
  ] }, accounts), /לא קיים/);
  assert.throws(() => A.validateEntry({ date: '2026-01-05', lines: [
    { account: '1000', debit: 1, credit: 1 }, { account: '4000', credit: 0 }
  ] }, accounts), /חובה וזכות/);
});

test('מסרב לתאריך שגוי', () => {
  assert.throws(() => A.validateEntry({ date: '05/01/2026', lines: [
    { account: '1000', debit: 1 }, { account: '4000', credit: 1 }
  ] }, accounts), /תאריך/);
});

test('חישוב חשבונית עם מע"מ 18% בלי שגיאות עיגול', () => {
  const c = A.computeInvoice({ items: [{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 99.99, kind: 'service' }] });
  assert.equal(c.net, 100.29);
  assert.equal(c.vat, 18.05);   // 100.29 * 0.18 = 18.0522
  assert.equal(c.total, 118.34);
});

test('חשבונית פטורה ממע"מ', () => {
  const c = A.computeInvoice({ vatExempt: true, items: [{ quantity: 2, unitPrice: 50 }] });
  assert.equal(c.vat, 0);
  assert.equal(c.total, 100);
});

test('רישום חשבונית: מאוזן, עם מע"מ עסקאות ופיצול הכנסות לפי סוג', () => {
  const inv = { number: 1, date: '2026-02-01', customer: 'לקוח א', items: [
    { quantity: 1, unitPrice: 1000 }, { quantity: 1, unitPrice: 500, kind: 'service' }
  ] };
  const c = A.computeInvoice(inv);
  const entry = A.validateEntry(A.invoiceToEntry(inv, c), accounts);
  assert.equal(entry.total, 1770);
  const byAcc = Object.fromEntries(entry.lines.map(l => [l.account, l]));
  assert.equal(byAcc['1100'].debit, 1770);
  assert.equal(byAcc['4000'].credit, 1000);
  assert.equal(byAcc['4100'].credit, 500);
  assert.equal(byAcc['2100'].credit, 270);
});

test('מספור חשבוניות רציף', () => {
  assert.equal(A.nextInvoiceNumber([]), 1);
  assert.equal(A.nextInvoiceNumber([{ number: 1 }, { number: 2 }]), 3);
});

test('מאזן בוחן מאוזן, דוח רווח והפסד, מאזן ודוח מע"מ עולים בקנה אחד', () => {
  const entries = [];
  const add = (e) => entries.push(A.validateEntry(e, accounts));
  // הון פתיחה
  add({ date: '2026-01-01', lines: [{ account: '1000', debit: 10000 }, { account: '3000', credit: 10000 }] });
  // הוצאת שכירות עם מע"מ תשומות
  add({ date: '2026-01-10', lines: [{ account: '6100', debit: 1000 }, { account: '1300', debit: 180 }, { account: '1000', credit: 1180 }] });
  // מכירה עם חשבונית
  const inv = { number: 1, date: '2026-01-20', customer: 'x', items: [{ quantity: 2, unitPrice: 2000 }] };
  add(A.invoiceToEntry(inv, A.computeInvoice(inv)));
  // גביית הלקוח
  add({ date: '2026-01-25', lines: [{ account: '1000', debit: 4720 }, { account: '1100', credit: 4720 }] });

  const tb = A.trialBalance(entries, accounts);
  assert.equal(tb.balanced, true);

  const pl = A.incomeStatement(entries, accounts);
  assert.equal(pl.totalRevenue, 4000);
  assert.equal(pl.totalExpenses, 1000);
  assert.equal(pl.netProfit, 3000);

  const bs = A.balanceSheet(entries, accounts, { asOf: '2026-12-31' });
  assert.equal(bs.balanced, true);
  assert.equal(bs.totalAssets, 13720);   // מזומנים 13,540 + מע"מ תשומות 180
  assert.equal(bs.totalLiabilities, 720); // מע"מ עסקאות
  assert.equal(bs.totalEquity, 13000);    // הון 10,000 + רווח 3,000

  const vat = A.vatReport(entries, { from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(vat, { outputVat: 720, inputVat: 180, netPayable: 540 });
});
