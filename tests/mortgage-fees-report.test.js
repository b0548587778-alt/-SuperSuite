// משרד ייעוץ (שלב 3): עמלות ותשלומים, הכנסות המשרד, חשבונית מס/קבלה, ודוח ממותג ללקוח.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const M = require('../modules/econ/core/mortgageAdvisor');
const R = require('../modules/econ/core/mortgageReport');

// ---------- עמלות ----------

test('תשלום עמלה: ולידציה בעברית, באגורות, אמצעי לא מוכר ← העברה', () => {
  assert.throws(() => M.validateFeePayment({ date: '2026-13-01', amount: 100 }), /תאריך/);
  assert.throws(() => M.validateFeePayment({ date: '2026-10-01', amount: 0 }), /סכום/);
  assert.throws(() => M.validateFeePayment({ date: '2026-10-01', amount: 'x' }), /סכום/);
  const p = M.validateFeePayment({ date: '2026-10-01', amount: 1234.56, method: 'zzz' });
  assert.equal(p.amountAg, 123456);
  assert.equal(p.method, 'transfer');
});

test('מצב העמלה: טרם שולם ← חלקית ← שולם; מקדמה ויתרה באגורות', () => {
  const base = { id: 'c', name: 'משפחת כהן', requestedAmount: 1000000, feeType: 'fixed', feeValue: 5000, feeDeposit: 1000 };
  const c = { ...M.validateClient(base), id: 'c' };
  const vat = 0.18;
  let st = M.feeStatus(c, vat);
  assert.equal(st.state, 'open');
  assert.equal(st.totalAg, 590000, '5,000 + מע"מ 18%');
  assert.equal(st.depositAg, 100000);
  assert.equal(st.depositDueAg, 100000);
  c.feePayments = [{ id: 'p1', date: '2026-10-01', amountAg: 100000 }];
  st = M.feeStatus(c, vat);
  assert.equal(st.state, 'partial');
  assert.equal(st.depositDueAg, 0);
  assert.equal(st.balanceAg, 490000);
  c.feePayments.push({ id: 'p2', date: '2026-11-01', amountAg: 490000 });
  assert.equal(M.feeStatus(c, vat).state, 'paid');
  assert.equal(M.feeStatus({ ...c, feeValue: 0, feeFixedAg: 0, feePayments: [] }, vat).state, 'none');
  assert.throws(() => M.validateClient({ ...base, feeDeposit: -1 }), /מקדמה/);
});

test('הכנסות המשרד: לפי חודש וליועץ, רק השנה המבוקשת; תיק שלא התקדם — בלי יתרה פתוחה', () => {
  const mk = (id, advisorId, status, payments) => ({ ...M.validateClient({ name: id, requestedAmount: 1, feeType: 'fixed', feeValue: 1000, status }), id, advisorId, feePayments: payments });
  const clients = [
    mk('א', 'A', 'closed', [{ date: '2026-01-10', amountAg: 50000 }, { date: '2025-12-30', amountAg: 70000 }]),
    mk('ב', 'B', 'lead', [{ date: '2026-03-05', amountAg: 20000 }]),
    mk('ג', 'B', 'lost', [])
  ];
  const inc = M.officeIncome(clients, { year: 2026, vatRate: 0.18, advisorName: (id) => 'יועץ ' + id });
  assert.equal(inc.receivedAg, 70000);
  assert.equal(inc.months[0].receivedAg, 50000);
  assert.equal(inc.months[2].receivedAg, 20000);
  const b = inc.advisors.find(a => a.advisorId === 'B');
  assert.equal(b.cases, 2);
  assert.equal(b.outstandingAg, 118000 - 20000, 'תיק "לא התקדם" אינו נספר ביתרה');
  const a = inc.advisors.find(x => x.advisorId === 'A');
  assert.equal(a.closedCases, 1);
  assert.equal(a.outstandingAg, 0, 'שולם במלואו (כולל תשלום מהשנה הקודמת)');
});

// ---------- דוח ממותג ----------

test('מיתוג: צבע #RRGGBB בלבד, לוגו PNG/JPEG בלבד, שדות נחתכים, ערך קודם נשמר כשלא נשלח', () => {
  assert.throws(() => R.normalizeBrand({ brandColor: 'red' }), /RRGGBB/);
  assert.throws(() => R.validateLogo('data:image/svg+xml;base64,AAAA'), /PNG או JPEG/);
  assert.equal(R.validateLogo(''), '');
  const b = R.normalizeBrand({ officeName: 'א'.repeat(300), brandColor: '#123abc' });
  assert.equal(b.officeName.length, 120);
  const kept = R.normalizeBrand({ phone: '03-0000000' }, { ...b, logo: 'data:image/png;base64,AAAA' });
  assert.equal(kept.brandColor, '#123abc');
  assert.equal(kept.logo, 'data:image/png;base64,AAAA');
});

test('דוח ללקוח: שם הלקוח בלבד (בלי טלפון/ת"ז/הערות), השוואה, המלצה, חסרים והסתייגות; בלי hex מלבד צבע המותג', () => {
  const html = R.renderClientReportHtml({
    client: { name: 'משפחת לוי', requestedAmount: 900000, propertyValue: 1500000, phone: '050-1234567', idNumber: '000000018', notes: 'הערה פנימית' },
    brand: { officeName: 'משרד דוגמה', licenseNo: '123', brandColor: '#204060' },
    asOf: '2026-10-20',
    comparison: { offers: [{ offer: { id: 'x', lender: 'בנק א' }, result: { summary: { firstPayment: 4000, maxPayment: 4500 } }, totalCostWithFees: 1400000, expired: true }], byTotalCost: ['x'] },
    chosen: { lender: 'בנק א', tracks: [{ type: 'PRIME', share: 100, years: 25, spreadPct: -0.5 }] },
    chosenResult: { summary: { firstPayment: 4000, maxPayment: 4500, totalPaid: 1390000 }, yearly: [{ year: 1, payment: 48000, balance: 880000 }] },
    missingDocs: ['תלושי שכר']
  }, ':root{--ss-text:#000}');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /משפחת לוי/);
  assert.match(html, /משרד דוגמה/);
  assert.match(html, /פג תוקף/);
  assert.match(html, /פריים/);
  assert.match(html, /תלושי שכר/);
  assert.match(html, /אינו הצעה מחייבת/);
  assert.match(html, /60%/, 'שיעור מימון');
  for (const s of ['050-1234567', '000000018', 'הערה פנימית']) assert.ok(!html.includes(s), 'מזעור: ' + s);
  const ownCss = html.replace(':root{--ss-text:#000}', '').replace('#204060', '');
  assert.doesNotMatch(ownCss, /#[0-9a-fA-F]{3,6}\b/, 'צבעים רק מ--ss-*');
  assert.doesNotMatch(html, /<script/i);
  assert.ok(!R.renderClientReportHtml({ client: { name: '<b>' }, brand: {} }, '').includes('<b>'), 'קידוד HTML');
});

// ---------- IPC ----------

const handlers = {};
const pdfHtml = [];
Module._resolveFilename_orig_fee = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_fee__.js' : Module._resolveFilename_orig_fee.call(this, req, ...rest); };
require.cache['/__electron_stub_fee__.js'] = {
  id: '/__electron_stub_fee__.js', filename: '/__electron_stub_fee__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    // חלון ה-PDF: שומר את ה-HTML שנטען כדי לבדוק את תוכן הדוח
    BrowserWindow: function () {
      return { loadURL: async (u) => { pdfHtml.push(Buffer.from(u.split(',')[1], 'base64').toString('utf8')); },
        webContents: { printToPDF: async () => Buffer.from('') }, destroy() {} };
    },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: תשלומים, חשבונית מס/קבלה פעם אחת לתשלום, הכנסות, מיתוג למנהל בלבד; יועץ אחר לא רואה', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-fee-')), { relayUrl: '' });
  await handlers['auth:setup'](ev(81), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(81), 'menahel', 'menahel-strong-pass-1');
  await handlers['users:create'](ev(81), { username: 'yoetz_c', password: 'yoetz-c-strong-pass', role: 'editor' });
  await handlers['auth:login'](ev(82), 'yoetz_c', 'yoetz-c-strong-pass');

  const c = await handlers['madv:createClient'](ev(81), { name: 'משפחת שפירא', requestedAmount: 800000, feeType: 'fixed', feeValue: 4000, feeDeposit: 1000 });
  await assert.rejects(handlers['madv:addFeePayment'](ev(81), c.id, { date: '2026-10-01', amount: -5 }), /סכום/);
  const r1 = await handlers['madv:addFeePayment'](ev(81), c.id, { date: '2026-10-01', amount: 1000, method: 'check' });
  assert.equal(r1.status.state, 'partial');
  const r2 = await handlers['madv:addFeePayment'](ev(81), c.id, { date: '2026-10-15', amount: 3720, method: 'transfer' });
  assert.equal(r2.status.state, 'paid');

  let ov = await handlers['madv:getOverview'](ev(81));
  assert.equal(ov.canInvoice, true);
  assert.equal(ov.clients[0].feePayments.length, 2);
  assert.equal(ov.clients[0].feeStatus.balance, 0);

  await assert.rejects(handlers['madv:issueFeeInvoice'](ev(81), c.id, r1.payment.id, {}), /אישור מפורש/);
  const inv = await handlers['madv:issueFeeInvoice'](ev(81), c.id, r1.payment.id, { confirmed: true });
  assert.ok(inv.number);
  assert.equal(inv.total, 1000);
  await assert.rejects(handlers['madv:issueFeeInvoice'](ev(81), c.id, r1.payment.id, { confirmed: true }), /כבר הופקה/);
  await assert.rejects(handlers['madv:deleteFeePayment'](ev(81), c.id, r1.payment.id), /הופקה חשבונית/);
  const invoices = await handlers['acct:getInvoices'](ev(81));
  const stored = (invoices.invoices || invoices).find(i => i.id === inv.id);
  assert.equal(stored.kind, 'tax-invoice-receipt');
  assert.equal(stored.status, 'paid');
  assert.equal(Math.round(stored.total * 100), 100000);

  await handlers['madv:deleteFeePayment'](ev(81), c.id, r2.payment.id);
  ov = await handlers['madv:getOverview'](ev(81));
  assert.equal(ov.clients[0].feeStatus.state, 'partial');

  const inc = await handlers['madv:getIncome'](ev(81), 2026);
  assert.equal(inc.receivedAg, 100000);
  assert.equal(inc.months[9].receivedAg, 100000);

  // יועץ אחר: לא רואה את התיק, ואין לו מיתוג
  await assert.rejects(handlers['madv:addFeePayment'](ev(82), c.id, { date: '2026-10-01', amount: 1 }), /לא נמצא/);
  await assert.rejects(handlers['madv:exportClientReportPdf'](ev(82), c.id), /לא נמצא/);
  assert.equal((await handlers['madv:getIncome'](ev(82), 2026)).receivedAg, 0);
  await assert.rejects(handlers['madv:saveBrand'](ev(82), { officeName: 'x' }), /הרשאה|מנהל/);

  const b = await handlers['madv:saveBrand'](ev(81), { officeName: 'משרד הייעוץ', brandColor: '#204060' });
  assert.equal(b.officeName, 'משרד הייעוץ');
  assert.equal(b.logo, undefined, 'הלוגו לא חוזר למסך');
  await assert.rejects(handlers['madv:saveBrand'](ev(81), { brandColor: 'blue' }), /RRGGBB/);
  assert.deepEqual(await handlers['madv:setBrandLogo'](ev(81), false), { canceled: true });
  ov = await handlers['madv:getOverview'](ev(81));
  assert.equal(ov.brand.officeName, 'משרד הייעוץ');
  assert.equal(ov.brand.hasLogo, false);
  const pdf = await handlers['madv:exportClientReportPdf'](ev(81), c.id);
  assert.equal(pdf.ok, false, 'חלון השמירה בוטל — בלי קובץ');
  const html = pdfHtml.at(-1);
  assert.match(html, /משרד הייעוץ/);
  assert.match(html, /משפחת שפירא/);
  assert.match(html, /--ss-/, 'שפת העיצוב מוטמעת');
});

test('המסך: תשלומים, חשבונית, הכנסות, מיתוג ודוח; ערוצים חשופים ב-preload; מיתוג רק למנהל', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-advisor.js'), 'utf8');
  for (const s of ['data-madv-pay', 'data-madv-paydel', 'data-madv-invoice', 'data-madv-report', 'madvIncomeBtn', 'madvSaveBrand', 'madvLogoBtn', 'attachMadvFeeHandlers']) assert.ok(ui.includes(s), s);
  assert.doesNotMatch(ui, /\b(alert|confirm|prompt)\(/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['madv:addFeePayment', 'madv:deleteFeePayment', 'madv:issueFeeInvoice', 'madv:getIncome', 'madv:saveBrand', 'madv:setBrandLogo', 'madv:exportClientReportPdf']) assert.ok(preload.includes(`'${ch}'`), ch);
  assert.equal(ipc.permissionFor('madv:saveBrand'), 'users.manage');
  assert.equal(ipc.permissionFor('madv:setBrandLogo'), 'users.manage');
  assert.equal(ipc.permissionFor('madv:getIncome'), 'data.view');
  assert.equal(ipc.permissionFor('madv:deleteFeePayment'), 'data.delete');
});
