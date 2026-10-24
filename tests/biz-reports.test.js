// דוחות לעסק (PLAN.md 9.5): כרטסת לקוח, יתרות, תזרים צפוי, מקדמות ומע"מ לפי תקופה, לוח בקרה, ערוצים וממשק.
// כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const BZ = require('../modules/econ/core/bizReports');
const UI = require('./helpers/econ-ui');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_biz__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_biz__.js'] = { id: '/__electron_stub_biz__.js', filename: '/__electron_stub_biz__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const item = (unitPrice, description = 'ייעוץ') => [{ description, quantity: 1, unitPrice }];
const YESHIVA = 'ישיבת אור התורה';
const TALMUD = 'תלמוד תורה בית יוסף';

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-biz-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: { name: 'משרד לדוגמה', taxId: '123456782' }, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

test('הגדרות: תנאי תשלום, תקופה ושיעור מקדמה בנקודות בסיס — בלי נקודה צפה', () => {
  assert.deepEqual(BZ.normalizeSettings(undefined), BZ.DEFAULTS);
  assert.deepEqual(BZ.normalizeSettings({ paymentTermsDays: -1, period: 'x', advanceRateBp: 1.5 }), BZ.DEFAULTS);
  assert.deepEqual(BZ.validateSettings({ paymentTermsDays: 45, period: 'monthly', advanceRatePct: '2.35' }),
    { paymentTermsDays: 45, period: 'monthly', advanceRateBp: 235 });
  assert.equal(BZ.validateSettings({ paymentTermsDays: 0, period: 'bimonthly', advanceRatePct: '7' }).advanceRateBp, 700);
  assert.equal(BZ.validateSettings({ paymentTermsDays: 0, period: 'bimonthly', advanceRatePct: '0.1' }).advanceRateBp, 10);
  assert.throws(() => BZ.validateSettings({ paymentTermsDays: 400, period: 'monthly', advanceRatePct: '1' }), /בין 0 ל-365/);
  assert.throws(() => BZ.validateSettings({ paymentTermsDays: 30, period: 'weekly', advanceRatePct: '1' }), /חודשית או דו-חודשית/);
  assert.throws(() => BZ.validateSettings({ paymentTermsDays: 30, period: 'monthly', advanceRatePct: '1.234' }), /אינו תקין/);
  assert.throws(() => BZ.validateSettings({ paymentTermsDays: 30, period: 'monthly', advanceRatePct: '150' }), /100%/);
});

test('תקופת דיווח: דו-חודשית מתחילה בחודש אי-זוגי, ומועד התשלום 15 בחודש שאחריה', () => {
  assert.deepEqual(BZ.periodOf('2026-04', 'bimonthly'), { start: '2026-03', end: '2026-04', from: '2026-03-01', to: '2026-04-30', due: '2026-05-15' });
  assert.deepEqual(BZ.periodOf('2026-12', 'bimonthly'), { start: '2026-11', end: '2026-12', from: '2026-11-01', to: '2026-12-31', due: '2027-01-15' });
  assert.deepEqual(BZ.periodOf('2026-02', 'monthly'), { start: '2026-02', end: '2026-02', from: '2026-02-01', to: '2026-02-28', due: '2026-03-15' });
  assert.equal(BZ.addMonths('2026-11', 3), '2027-02');
  assert.equal(BZ.addMonths('2026-01', -1), '2025-12');
  assert.equal(BZ.addDays('2026-12-15', 30), '2027-01-14');
  assert.equal(BZ.periodName('2026-09', '2026-10'), 'ספטמבר–אוקטובר 2026');
  assert.equal(BZ.periodName('2026-03', '2026-03'), 'מרץ 2026');
});

test('שירות: כרטסת לקוח — חשבונית, זיכוי, גבייה, ביטול, יתרה מצטברת ויתרת פתיחה', async () => {
  const { svc } = await freshService();
  const a = await svc.createInvoice({ customer: YESHIVA, date: '2026-03-02', items: item(1000) });   // 1,180
  const b = await svc.createInvoice({ customer: YESHIVA, date: '2026-04-10', items: item(500) });    // 590
  await svc.createInvoice({ customer: TALMUD, date: '2026-04-11', items: item(200) });
  await svc.createCreditNote(a.id, { date: '2026-03-20', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 100 }] }); // 118
  await svc.recordPayment(a.id, { date: '2026-04-01', method: 'transfer', reference: '777' });
  const c = await svc.createInvoice({ customer: YESHIVA, date: '2026-05-01', items: item(100) });
  const cancelled = await svc.cancelInvoice(c.id);
  c.cancelledAt = cancelled.cancelledAt;
  const l = await svc.getCustomerLedger(YESHIVA);
  assert.deepEqual(l.rows.map(r => [r.date, r.kind, r.debitAg, r.creditAg, r.balanceAg]), [
    ['2026-03-02', 'invoice', 118000, 0, 118000],
    ['2026-03-20', 'credit', 0, 11800, 106200],
    ['2026-04-01', 'payment', 0, 106200, 0],
    ['2026-04-10', 'invoice', 59000, 0, 59000],
    ['2026-05-01', 'invoice', 11800, 0, 70800],
    [c.cancelledAt, 'cancel', 0, 11800, 59000]
  ]);
  assert.equal(l.closingAg, 59000, 'היתרה = החשבונית הפתוחה בלבד');
  assert.match(l.rows[2].label, /777/);
  // טווח: יתרת פתיחה מחושבת מכל מה שלפניו
  const part = await svc.getCustomerLedger(YESHIVA, { from: '2026-04-05', to: '2026-04-30' });
  assert.equal(part.openingAg, 0);
  assert.deepEqual(part.rows.map(r => r.kind), ['invoice']);
  assert.equal(part.closingAg, 59000);
  const mid = await svc.getCustomerLedger(YESHIVA, { from: '2026-03-15' });
  assert.equal(mid.openingAg, 118000);
  await assert.rejects(svc.getCustomerLedger(''), /לבחור לקוח/);
  // יתרות: הלקוח עם החוב הגבוה ראשון, עם גיל החשבונית הוותיקה
  const bal = await svc.getCustomerBalances({ today: '2026-05-10' });
  assert.deepEqual(bal.map(x => [x.customer, x.openAg, x.openCount, x.oldestDays]), [[YESHIVA, 59000, 1, 30], [TALMUD, 23600, 1, 29]]);
  assert.equal(bal[0].invoicedAg, 118000 - 11800 + 59000, 'מחזור אחרי זיכוי, בלי חשבונית שבוטלה');
  assert.ok(b.id);
});

test('כרטסת לקוח: חשבונית פטורה — "חשבונית עסקה", גם בנתונים ישנים שסומנו חשבונית מס/קבלה (כמו בהדפסה)', () => {
  const data = { invoices: [
    { id: '1', number: 1, customer: 'ישיבת אור', date: '2026-03-01', total: 100, status: 'open', vatExempt: true },
    { id: '2', number: 2, customer: 'ישיבת אור', date: '2026-03-02', total: 100, status: 'open', vatExempt: true, kind: 'tax-invoice-receipt' },
    { id: '3', number: 3, customer: 'ישיבת אור', date: '2026-03-03', total: 118, status: 'open', kind: 'tax-invoice-receipt' },
    { id: '4', number: 4, customer: 'ישיבת אור', date: '2026-03-04', total: 118, status: 'open' },
  ] };
  assert.deepEqual(BZ.customerLedger(data, 'ישיבת אור').rows.map(r => r.label), ['חשבונית עסקה', 'חשבונית עסקה', 'חשבונית מס/קבלה', 'חשבונית מס']);
});

test('מקדמות ומע"מ: מחזור בלי מע"מ פחות זיכויים וביטולים, מקדמה מעוגלת לאגורה, מצב תקופה', async () => {
  const { svc } = await freshService();
  await svc.saveBizSettings({ paymentTermsDays: 30, period: 'bimonthly', advanceRatePct: '2.5' });
  const a = await svc.createInvoice({ customer: YESHIVA, date: '2026-01-05', items: item(1000.33) });
  await svc.createInvoice({ customer: TALMUD, date: '2026-02-20', items: item(2000) });
  await svc.createCreditNote(a.id, { date: '2026-02-01', reason: 'החזרה', items: [{ description: 'החזרה', quantity: 1, unitPrice: 100 }] });
  const r = await svc.getAdvancesReport({ year: 2026, today: '2026-03-10' });
  assert.equal(r.rows.length, 6);
  const jan = r.rows[0];
  assert.deepEqual([jan.start, jan.end, jan.due, jan.state], ['2026-01', '2026-02', '2026-03-15', 'closed']);
  assert.equal(jan.turnoverAg, 100033 + 200000 - 10000);
  assert.equal(jan.advanceAg, Math.round(290033 * 250 / 10000), '7,250.83 ← 7,250.83 מעוגל');
  assert.equal(jan.vatNetAg, jan.outputVatAg - jan.inputVatAg);
  assert.equal(jan.outputVatAg, Math.round(100033 * 0.18) + 36000 - 1800);
  assert.equal(r.rows[1].state, 'current');
  assert.equal(r.rows[2].state, 'future');
  assert.equal(r.totals.advanceAg, jan.advanceAg);
  // חודשי: 12 שורות; שנה לא תקינה נדחית
  await svc.saveBizSettings({ paymentTermsDays: 30, period: 'monthly', advanceRatePct: '2.5' });
  assert.equal((await svc.getAdvancesReport({ year: 2026, today: '2026-03-10' })).rows.length, 12);
  await assert.rejects(svc.getAdvancesReport({ year: 1900, today: '2026-03-10' }), /שנה/);
  // שמירת הגדרות הדוחות לא נוגעת בשאר ההגדרות
  const st = await svc.getSettings();
  assert.equal(st.business.name, 'משרד לדוגמה');
  assert.equal(st.vatRate, 0.18);
});

test('תזרים צפוי: יתרת בנק, חשבוניות פתוחות לפי תנאי תשלום, באיחור — היום, חשבונית חוזרת, מע"מ ומקדמה, הוצאות משוערות', async () => {
  const { svc } = await freshService();
  await svc.saveBizSettings({ paymentTermsDays: 30, period: 'bimonthly', advanceRatePct: '1' });
  // כסף בבנק: חשבונית ששולמה
  const paid = await svc.createInvoice({ customer: TALMUD, date: '2026-07-01', items: item(5000) });
  await svc.recordPayment(paid.id, { date: '2026-07-03', method: 'transfer' });
  // הוצאה בבנק ביולי (רשומת יומן)
  await svc.createEntry({ date: '2026-07-10', description: 'שכירות', lines: [{ account: '6100', debit: 3000 }, { account: '1000', credit: 3000 }] });
  const late = await svc.createInvoice({ customer: YESHIVA, date: '2026-07-15', items: item(1000) });   // מועד 14.8 — באיחור ב-1.9
  const soon = await svc.createInvoice({ customer: YESHIVA, date: '2026-08-20', items: item(500) });    // מועד 19.9
  await svc.saveRecurring({ customer: TALMUD, dayOfMonth: 1, startMonth: '2026-09', items: item(100) });
  const f = await svc.getCashForecast({ today: '2026-09-01', months: 3 });
  assert.equal(f.openingAg, 590000 - 300000);
  assert.deepEqual(f.buckets.map(b => b.month), ['2026-09', '2026-10', '2026-11']);
  const sep = f.buckets[0];
  const lateItem = sep.items.find(i => i.source === 'invoice' && i.late);
  assert.equal(lateItem.date, '2026-09-01');
  assert.equal(lateItem.amountAg, 118000);
  assert.equal(f.overdueAg, 118000);
  assert.ok(sep.items.some(i => i.source === 'invoice' && i.date === '2026-09-19' && i.amountAg === 59000));
  // חוזרת: ספטמבר (טיוטה פתוחה) — 1.10 עם תנאי תשלום, וכך גם אוקטובר ונובמבר
  const rec = f.buckets.flatMap(b => b.items).filter(i => i.source === 'recurring');
  assert.deepEqual(rec.map(i => [i.date, i.amountAg]), [['2026-10-01', 11800], ['2026-10-31', 11800], ['2026-12-01', 11800]].filter(([d]) => d <= '2026-11-30'));
  // מע"מ ומקדמה: יולי–אוגוסט ← 15.9; ספטמבר–אוקטובר ← 15.11 (חלקי)
  const vatSep = sep.items.find(i => i.source === 'vat');
  assert.equal(vatSep.date, '2026-09-15');
  assert.equal(vatSep.label, 'מע"מ יולי–אוגוסט 2026');
  assert.equal(vatSep.amountAg, -(90000 + 18000 + 9000));
  const advSep = sep.items.find(i => i.source === 'advance');
  assert.equal(advSep.amountAg, -Math.round((500000 + 100000 + 50000) * 100 / 10000));
  const nov = f.buckets[2].items.find(i => i.source === 'vat');
  assert.ok(!nov, 'ספטמבר–אוקטובר בלי חשבוניות — אין מע"מ');
  // הוצאות משוערות: ממוצע יוני–אוגוסט = 3,000 / 3
  const exp = sep.items.find(i => i.source === 'expenses');
  assert.equal(exp.amountAg, -100000);
  assert.equal(exp.estimate, true);
  // היתרות מצטברות
  assert.equal(sep.openingAg, f.openingAg);
  assert.equal(sep.closingAg, sep.openingAg + sep.inAg - sep.outAg);
  assert.equal(f.buckets[1].openingAg, sep.closingAg);
  assert.equal(f.closingAg, f.buckets[2].closingAg);
  // בלי הוצאות משוערות
  const g = await svc.getCashForecast({ today: '2026-09-01', months: 3, includeExpenses: false });
  assert.ok(!g.buckets.flatMap(b => b.items).some(i => i.source === 'expenses'));
  assert.equal(g.closingAg - f.closingAg, 300000);
  // תקרה של 12 חודשים
  assert.equal((await svc.getCashForecast({ today: '2026-09-01', months: 99 })).months, 12);
  assert.ok(soon.id && late.id);
});

test('לוח בקרה: יתרה, חייבים מובילים ותשלומים קרובים לרשויות; קריאה בלבד', async () => {
  const { svc, db } = await freshService();
  await svc.saveBizSettings({ paymentTermsDays: 0, period: 'monthly', advanceRatePct: '0' });
  await svc.createInvoice({ customer: YESHIVA, date: '2026-09-01', items: item(1000) });
  const before = JSON.stringify(await db.load());
  const s = await svc.getBizDashboard({ today: '2026-09-02' });
  assert.equal(JSON.stringify(await db.load()), before, 'הדוחות לא כותבים כלום');
  assert.equal(s.topDebtors[0].customer, YESHIVA);
  assert.equal(s.payments.length, 1);
  assert.equal(s.payments[0].source, 'vat');
  assert.equal(s.payments[0].date, '2026-10-15');
  assert.equal(s.advanceRateBp, 0);
  assert.equal(s.months.length, 3);
});

test('ערוצים: דרך handle(), "היום" נקבע בשרת, ייצוא כרטסת קורא מהספרים; שמירת הגדרות בהרשאת עריכה', () => {
  const ipc = read('modules/econ/ipc.js');
  for (const ch of ['getBizSettings', 'saveBizSettings', 'getCustomerBalances', 'getCustomerLedger', 'getCashForecast', 'getAdvancesReport', 'getBizDashboard', 'exportCustomerLedger']) {
    // handleSave — ייצוא: חלון השמירה מחוץ לתור (ממצא 39), אותו שומר
    assert.match(ipc, new RegExp(`handle(?:Save)?\\('acct:${ch}'`), ch);
    assert.match(read('modules/econ/preload.js'), new RegExp(`'acct:${ch}'`), ch);
  }
  assert.match(ipc, /acct:getCashForecast[^\n]*localDay\(Date\.now\(\)\)/);
  assert.match(ipc, /acct:exportCustomerLedger[\s\S]{0,200}accountingService\.getCustomerLedger/);
  const { permissionFor } = require('../modules/econ/ipc');
  if (typeof permissionFor === 'function') {
    assert.equal(permissionFor('acct:getCashForecast'), 'data.view');
    assert.equal(permissionFor('acct:saveBizSettings'), 'data.edit');
  }
});

test('ממשק: מסך בקטלוג, כפתור, כותרת, שלוש לשוניות, כרטיס בלוח הבקרה, ובלי צבע hex', () => {
  assert.ok(require('../shell/catalog').ECON_VIEWS.includes('biz-reports'));
  const html = read('modules/econ/views/index.html');
  assert.match(html, /data-view="biz-reports"/);
  assert.ok(html.indexOf('ui/biz-reports.js') > html.indexOf('ui/accounting.js') && html.indexOf('ui/biz-reports.js') < html.indexOf('ui/boot.js'));
  assert.doesNotMatch(read('modules/econ/ui/biz-reports.js'), /#[0-9a-f]{3,6}\b/i);

  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  UI.run(context);
  assert.equal(vm.runInContext(`viewTitles['biz-reports']`, context), 'תזרים צפוי, כרטסת לקוחות ומקדמות');
  const S = { paymentTermsDays: 30, period: 'bimonthly', advanceRateBp: 250 };
  const forecast = { today: '2026-09-01', months: 1, settings: S, openingAg: 100000, overdueAg: 5000, closingAg: -2000, negative: true,
    lowest: { month: '2026-09', closingAg: -2000 },
    buckets: [{ month: '2026-09', openingAg: 100000, closingAg: -2000, inAg: 5000, outAg: 107000,
      items: [{ date: '2026-09-01', source: 'invoice', label: 'חשבונית 3 — <b>ישיבה</b>', amountAg: 5000, late: true },
        { date: '2026-09-15', source: 'vat', label: 'מע"מ', amountAg: -107000 }] }] };
  const f = vm.runInContext('renderBizReports', context)({ ui: { tab: 'forecast', months: 3 }, settings: S, forecast });
  assert.match(f, /יורדת מתחת לאפס/);
  assert.match(f, /&lt;b&gt;ישיבה/, 'תוויות מוברחות');
  assert.match(f, /<svg class="biz-chart"/);
  assert.match(f, /aria-pressed="true"/);
  const c = vm.runInContext('renderBizReports', context)({ ui: { tab: 'customers', customer: YESHIVA }, settings: S,
    balances: [{ customer: YESHIVA, invoicedAg: 100, openAg: 100, openCount: 1, oldestDays: 40 }],
    ledger: { customer: YESHIVA, from: null, openingAg: 0, rows: [{ date: '2026-01-01', ref: 1, label: 'חשבונית מס', debitAg: 100, creditAg: 0, balanceAg: 100 }], debitAg: 100, creditAg: 0, closingAg: 100 } });
  assert.match(c, /כרטסת — ישיבת אור התורה/);
  assert.match(c, /id="bizLedgerCsv"/);
  assert.match(vm.runInContext('renderBizReports', context)({ ui: { tab: 'customers' }, settings: S, balances: [] }), /אין לקוחות עדיין/);
  const a = vm.runInContext('renderBizReports', context)({ ui: { tab: 'advances' }, settings: S,
    advances: { year: 2026, settings: { ...S, advanceRateBp: 0 }, rows: [{ start: '2026-01', end: '2026-02', state: 'closed', turnoverAg: 1, advanceAg: 0, outputVatAg: 0, inputVatAg: 0, vatNetAg: 0, due: '2026-03-15' }], totals: { turnoverAg: 1, advanceAg: 0, vatNetAg: 0 } } });
  assert.match(a, /ינואר–פברואר 2026/);
  assert.match(a, /לא הוגדר/);
  const dash = vm.runInContext('renderBizDashCard', context)({ bankAg: 1, overdueAg: 0, negative: false, months: [{ month: '2026-09', closingAg: 1 }], topDebtors: [], payments: [], advanceRateBp: 0 });
  assert.match(dash, /data-biz-goto="forecast"/);
  assert.equal(vm.runInContext('renderBizDashCard', context)(null), '');
  assert.match(vm.runInContext('renderDashboard', context)({ biz: { bankAg: 0, months: [], topDebtors: [], payments: [] }, accounting: {} }), /תזרים צפוי/);
});
