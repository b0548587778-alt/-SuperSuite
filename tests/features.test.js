const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../modules/econ/core/features');
const X = require('../modules/econ/core/exports');
const BK = require('../modules/econ/core/backupCrypto');

test('סיכום תקופתי: הכנסות, הוצאות, מע"מ ורווח מחושבים מהיומן', () => {
  const accounts = [
    { code: '1000', name: 'בנק', type: 'asset' }, { code: '1100', name: 'לקוחות', type: 'asset' },
    { code: '1300', name: 'מע"מ תשומות', type: 'asset' }, { code: '2100', name: 'מע"מ עסקאות', type: 'liability' },
    { code: '4000', name: 'מכירות', type: 'revenue' }, { code: '5000', name: 'שכירות', type: 'expense' }
  ];
  const entries = [
    { date: '2026-03-01', lines: [{ account: '1100', debit: 118, credit: 0 }, { account: '4000', debit: 0, credit: 100 }, { account: '2100', debit: 0, credit: 18 }] },
    { date: '2026-03-05', lines: [{ account: '5000', debit: 30, credit: 0 }, { account: '1300', debit: 5.4, credit: 0 }, { account: '1000', debit: 0, credit: 35.4 }] },
    { date: '2026-04-01', lines: [{ account: '1000', debit: 50, credit: 0 }, { account: '4000', debit: 0, credit: 50 }] }
  ];
  const s = F.periodSummary(entries, accounts, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(s.income, 100);
  assert.equal(s.expenses, 30);
  assert.equal(s.outputVat, 18);
  assert.equal(s.inputVat, 5.4);
  assert.equal(s.vatPayable, 12.6);
  assert.equal(s.profit, 70);
  assert.equal(s.cashAfterVat, 57.4, 'רווח אחרי מע"מ = רווח פחות מע"מ לתשלום');
});

test('הוצאות אישיות: נשמרות ברשימה נפרדת ולא מופיעות ביומן', () => {
  const e = F.validatePersonalEntry({ date: '2026-03-02', kind: 'expense', amount: '120.456', category: ' מזון ', note: 'סופר' });
  assert.equal(e.amount, 120.46, 'סכום מעוגל לאגורות');
  assert.equal(e.category, 'מזון');
  assert.throws(() => F.validatePersonalEntry({ date: '2026-03-02', kind: 'expense', amount: -5, category: 'x' }), /סכום/);
  assert.throws(() => F.validatePersonalEntry({ date: '2026-03-02', kind: 'other', amount: 5, category: 'x' }), /סוג/);
  assert.throws(() => F.validatePersonalEntry({ date: '2026-03-02', kind: 'expense', amount: 5, category: '' }), /קטגוריה/);
  assert.throws(() => F.validatePersonalEntry({ date: '2026-03-02', kind: 'expense', amount: 5, category: 'x' }, F.MAX_PERSONAL), /מקסימלי/);

  const list = [
    { date: '2026-03-02', kind: 'expense', amount: 100, category: 'מזון' },
    { date: '2026-03-03', kind: 'expense', amount: 40, category: 'מזון' },
    { date: '2026-03-04', kind: 'income', amount: 500, category: 'משכורת' },
    { date: '2026-05-01', kind: 'expense', amount: 999, category: 'חשמל' }
  ];
  const sum = F.personalSummary(list, { from: '2026-03-01', to: '2026-03-31' });
  assert.equal(sum.income, 500);
  assert.equal(sum.expense, 140);
  assert.equal(sum.balance, 360);
  assert.equal(sum.count, 3);
  assert.equal(sum.categories[0].category, 'משכורת', 'מיון לפי סכום');
});

test('ניתוח חשבוניות: סיכום חודשי ולקוחות חוזרים, בלי חשבוניות שבוטלו', () => {
  const invoices = [
    { number: 1, date: '2026-01-10', customer: 'יוסי', net: 100, vat: 18, total: 118, status: 'paid' },
    { number: 2, date: '2026-01-20', customer: 'דנה', net: 200, vat: 36, total: 236, status: 'open' },
    { number: 3, date: '2026-02-03', customer: '  יוסי ', net: 50, vat: 9, total: 59, status: 'open' },
    { number: 4, date: '2026-02-05', customer: 'מיכל', net: 10, vat: 1.8, total: 11.8, status: 'cancelled' }
  ];
  const a = F.invoiceAnalytics(invoices);
  assert.equal(a.totalInvoices, 3, 'חשבונית שבוטלה לא נספרת');
  assert.deepEqual(a.monthly.map(m => [m.month, m.count, m.total]), [['2026-01', 2, 354], ['2026-02', 1, 59]]);
  assert.equal(a.customers, 2);
  assert.equal(a.repeatCustomers.length, 1);
  assert.equal(a.repeatCustomers[0].customer, 'יוסי');
  assert.equal(a.repeatCustomers[0].total, 177);
  assert.equal(a.repeatShare, 50);
  assert.equal(a.totalRevenue, 413);
});

test('CSV: קריאה עם מרכאות, BOM ושורות ריקות', () => {
  const rows = F.parseCsv('﻿name,kind\r\n"מוצר, מיוחד","שירות"\r\n\r\nx,"say ""hi"""\r\n');
  assert.deepEqual(rows, [['name', 'kind'], ['מוצר, מיוחד', 'שירות'], ['x', 'say "hi"']]);
  assert.throws(() => F.parseCsv('a,"b'), /לא נסגרה/);
});

test('ייבוא מחירון: שורות תקינות נשמרות, שגויות מדווחות עם מספר שורה', () => {
  const csv = 'name,kind,cost,markupPct,vatExempt\nקפה,goods,10,50,no\n,goods,5,10,no\nשיעור,service,100,30,yes\nעלות,goods,abc,10,no\n';
  const r = F.parseProductsCsv(csv);
  assert.equal(r.products.length, 2);
  assert.equal(r.products[1].vatExempt, true);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.errors.map(e => e.line), [3, 5]);
  assert.throws(() => F.parseProductsCsv('cost,markupPct\n1,2\n'), /name/);
  assert.throws(() => F.parseProductsCsv('name\n'), /ריק/);
});

test('גיבוי אוטומטי ליעד: מוצפן בלבד, מדלג כשהיעד חסר, ושומר רק N אחרונים', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-usb-'));
  const plain = JSON.stringify({ suite: 'SuperSuite', company: 'חברה סודית בע"מ', econ: {} });
  const key = 'k'.repeat(44);

  const missing = F.writeEncryptedAutoBackup({ dir: path.join(dir, 'no-such-usb'), plainText: plain, key });
  assert.deepEqual(missing, { ok: false, reason: 'target-missing' });

  const r = F.writeEncryptedAutoBackup({ dir, plainText: plain, key, today: '2026-03-01', keep: 2 });
  assert.equal(r.ok, true);
  const raw = fs.readFileSync(r.file, 'utf8');
  assert.ok(raw.startsWith('SSBK1:'), 'הקובץ מוצפן');
  assert.ok(!raw.includes('סודית'), 'אין טקסט גלוי בקובץ');
  assert.equal(BK.decryptBackup(raw, key), plain);

  // אותו יום — לא כותבים שוב
  assert.equal(F.writeEncryptedAutoBackup({ dir, plainText: plain, key, today: '2026-03-01', keep: 2 }).skipped, true);

  F.writeEncryptedAutoBackup({ dir, plainText: plain, key, today: '2026-03-02', keep: 2 });
  const third = F.writeEncryptedAutoBackup({ dir, plainText: plain, key, today: '2026-03-03', keep: 2 });
  assert.deepEqual(third.removed, ['auto-2026-03-01.ssbk']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['auto-2026-03-02.ssbk', 'auto-2026-03-03.ssbk']);

  assert.deepEqual(F.writeEncryptedAutoBackup({ dir, plainText: plain, key: 'short', today: '2026-03-04' }), { ok: false, reason: 'no-key' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CSV ליצוא: תאי נוסחה מנוטרלים (הזרקת נוסחאות), מספרים שליליים נשארים מספרים', () => {
  const csv = X.toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['@sum'], ['-5'], ['-שם'], ['רגיל']]);
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.deepEqual(lines.slice(1), [
    `"'=HYPERLINK(""x"")"`,
    "'+1",
    "'@sum",
    '-5',
    "'-שם",
    'רגיל'
  ]);
});
