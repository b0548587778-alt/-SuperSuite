// חשבונית מס/קבלה להרשמה ששולמה: סכום כולל מע"מ מדויק לאגורה, חשבונית + גבייה ביומן, ותצוגה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../modules/econ/core/accounting');
const X = require('../modules/econ/core/exports');

test('מחיר כולל מע"מ: הסה"כ שווה בדיוק לסכום ששולם בכל סכום, והמע"מ סוטה לכל היותר באגורה', () => {
  for (const rate of [0.18, 0.17]) {
    for (let g = 1; g < 120000; g += 7) {
      const net = Math.round(A.netFromGross(g, rate) * 100);
      const c = A.computeInvoice({ grossAgorot: g, items: [{ quantity: 1, unitPrice: net / 100 }] }, rate);
      assert.equal(Math.round(c.total * 100), g, `${g} @ ${rate}`);
      assert.ok(Math.abs(Math.round(c.vat * 100) - Math.round(net * rate)) <= 1, `vat ${g}`);
    }
  }
  // דוגמה: ₪49 — בלי חישוב הפרש היה יוצא 48.99 או 49.01
  const n = A.netFromGross(4900, 0.18);
  assert.equal(A.computeInvoice({ grossAgorot: 4900, items: [{ quantity: 1, unitPrice: n }] }, 0.18).total, 49);
});

test('שירות הנה"ח: חשבונית מס/קבלה — שולמה, רשומות מכירה וגבייה מאוזנות, אסמכתא', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-inv-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  AccountingService.initialize(db);
  const inv = await AccountingService.createPaidInvoice({ customer: 'ישיבת תורת חיים', customerTaxId: '515555555',
    description: 'מנוי SuperSuite — מוסדות (12 חודשים)', grossAgorot: 49900, ref: 'TEST-ab12', date: '2026-10-15' });
  assert.equal(inv.status, 'paid');
  assert.equal(inv.total, 499);
  assert.equal(Math.round((inv.net + inv.vat) * 100), 49900);
  assert.equal(inv.kind, 'tax-invoice-receipt');
  assert.equal(inv.paymentRef, 'TEST-ab12');
  const all = await AccountingService.getInvoices();
  assert.equal(all.length, 1);
  const second = await AccountingService.createPaidInvoice({ customer: 'כולל', description: 'מנוי', grossAgorot: 4900, date: '2026-10-15' });
  assert.equal(second.number, inv.number + 1, 'מספור רציף');
  assert.equal(second.total, 49);
  await assert.rejects(AccountingService.createPaidInvoice({ customer: 'x', description: 'y', grossAgorot: 0 }), /אינו תקין/);
  const html = X.renderInvoiceHtml(inv, { name: 'בונים סלר', taxId: '512345678' });
  assert.match(html, /חשבונית מס\/קבלה/);
  assert.match(html, /TEST-ab12/);
  assert.match(html, /515555555/);
  assert.match(html, /סה"כ שולם/);
  assert.match(html, /הקצאת מספר מרשות המסים/, 'ההבהרה על מספר הקצאה נשמרת');
});

test('ipc: הנפקה להרשמה ששולמה מפיקה חשבונית לפני הרישיון', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  const i = src.indexOf("handle('owner:signupIssue'");
  const body = src.slice(i, src.indexOf("handle('owner:signupDocument'", i));
  assert.ok(body.indexOf('createPaidInvoice') > 0 && body.indexOf('createPaidInvoice') < body.indexOf('issueSignup'), 'חשבונית לפני הנפקה');
  assert.match(body, /localDay\(/, 'תאריך מקומי ולא UTC');
});
