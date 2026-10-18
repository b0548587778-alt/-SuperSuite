// מספר הקצאה בנתיב הידני (PLAN.md 9.2א): הסף לפי תאריך, הזנת המספר, סימון "לא נדרש",
// הדפסה על החשבונית, לוח הבוקר והערוצים. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AL = require('../modules/econ/core/allocation');
const X = require('../modules/econ/core/exports');
const D = require('../modules/econ/core/dashboard');
const Module = require('module');

// ipc.js דורש electron — מספיק ipcMain מדומה כדי לקרוא את permissionFor
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_alloc__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_alloc__.js'] = { id: '/__electron_stub_alloc__.js', filename: '/__electron_stub_alloc__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const inv = (over = {}) => ({ id: 'i1', number: 7, date: '2026-07-01', net: 5000.01, vat: 900, total: 5900.01, status: 'open', items: [], customer: 'ישיבת אור התורה', ...over });

test('הסף לפי תאריך: 20,000 ב-2025, 10,000 מ-1.1.2026, 5,000 מ-1.6.2026; לפני 2025 — לא נבדק', () => {
  assert.equal(AL.thresholdFor('2025-12-31'), 2000000);
  assert.equal(AL.thresholdFor('2026-01-01'), 1000000);
  assert.equal(AL.thresholdFor('2026-05-31'), 1000000);
  assert.equal(AL.thresholdFor('2026-06-01'), 500000);
  assert.equal(AL.thresholdFor('2024-12-31'), Infinity);
});

test('"גבוה מהסף" — 5,000 בדיוק לא דורש, 5,000.01 דורש', () => {
  assert.equal(AL.allocationState(inv({ net: 5000 })), 'not-required');
  assert.equal(AL.allocationState(inv()), 'pending');
  // לפני 1.6.2026 הסף 10,000
  assert.equal(AL.allocationState(inv({ date: '2026-05-31' })), 'not-required');
  assert.equal(AL.allocationState(inv({ date: '2026-05-31', net: 10000.01 })), 'pending');
});

test('בלי מע"מ, פטורה או מבוטלת — לא נדרש', () => {
  assert.equal(AL.allocationState(inv({ vatExempt: true, vat: 0 })), 'not-required');
  assert.equal(AL.allocationState(inv({ vat: 0 })), 'not-required');
  assert.equal(AL.allocationState(inv({ status: 'cancelled' })), 'not-required');
  assert.equal(AL.allocationState(inv({ allocationWaived: { reason: 'customer' } })), 'waived');
  assert.equal(AL.allocationState(inv({ allocationNumber: '123456789' })), 'assigned');
});

test('מספר הקצאה: ספרות בלבד, 9 לפחות; רווחים ומקפים מוסרים; על החשבונית 9 הימניות', () => {
  assert.equal(AL.normalizeAllocationNumber(' 123-456 789 '), '123456789');
  assert.throws(() => AL.normalizeAllocationNumber('12345678'), /9 ספרות/);
  assert.throws(() => AL.normalizeAllocationNumber('12345678a'), /9 ספרות/);
  assert.throws(() => AL.normalizeAllocationNumber('000000000'), /אינו תקין/);
  assert.equal(AL.printedDigits('2026000123456789'), '123456789');
});

test('הדפסה: מספר מודפס, ממתינה — "אין לנכות מס תשומות", מתחת לסף — כלום', () => {
  const withNum = X.renderInvoiceHtml(inv({ allocationNumber: '2026000123456789' }));
  assert.match(withNum, /הקצאה מספר: <b dir="ltr">123456789<\/b>/);
  assert.doesNotMatch(withNum, /אין לנכות/);
  assert.match(X.renderInvoiceHtml(inv()), /אין לנכות מס תשומות בגין חשבונית זו/);
  // "לא נדרש" = הלקוח אינו עוסק מורשה או לא דרש — אין מה להדפיס
  assert.doesNotMatch(X.renderInvoiceHtml(inv({ allocationWaived: { reason: 'customer' } })), /אין לנכות|הקצאה מספר/);
  const small = X.renderInvoiceHtml(inv({ net: 100, vat: 18, total: 118 }));
  assert.doesNotMatch(small, /אין לנכות|הקצאה מספר/);
});

test('לוח הבוקר: חשבוניות ממתינות — רק כשהנהלת החשבונות פתוחה', () => {
  const data = { invoices: [inv(), inv({ id: 'i2', number: 8, net: 100, vat: 18 }), inv({ id: 'i3', number: 9, allocationNumber: '111111111' })] };
  assert.equal(D.morningBrief(data, '2026-10-14').total, 0, 'בלי acct — לא מוצג');
  const b = D.morningBrief(data, '2026-10-14', { acct: true });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].area, 'acct');
  assert.equal(b.items[0].view, 'acct-invoices');
  assert.match(b.items[0].title, /חשבונית אחת ממתינה למספר הקצאה/);
  assert.match(b.items[0].detail, /חשבוניות 7/);
});

test('שירות: הזנה, כפילות, החלפה, סימון "לא נדרש", ומספר העוסק של הלקוח נבדק', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-alloc-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  AccountingService.initialize(db);
  const mk = (unitPrice, extra = {}) => AccountingService.createInvoice({ customer: 'כולל חזון איש', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice }], ...extra });
  await assert.rejects(mk(6000, { customerTaxId: '123456789' }), /אינו תקין/);
  const big = await mk(6000, { customerTaxId: '515555555' });
  assert.equal(big.customerTaxId, '515555555');
  const small = await mk(100);
  const list = await AccountingService.getInvoices();
  assert.equal(list.find(i => i.id === big.id).allocation, 'pending');
  assert.equal(list.find(i => i.id === small.id).allocation, 'not-required');

  await assert.rejects(AccountingService.waiveAllocation(small.id), /אינה דורשת/);
  await assert.rejects(AccountingService.setAllocation(big.id, { number: '123' }), /9 ספרות/);
  const r = await AccountingService.setAllocation(big.id, { number: '2026000123456789' });
  assert.equal(r.previous, null);
  assert.equal(r.invoice.allocationNumber, '2026000123456789');
  await assert.rejects(AccountingService.setAllocation(small.id, { number: '2026000123456789' }), new RegExp(`כבר רשום בחשבונית ${big.number}`));
  await assert.rejects(AccountingService.waiveAllocation(big.id), /כבר יש מספר/);
  const r2 = await AccountingService.setAllocation(big.id, { number: '2026000999999999' });
  assert.equal(r2.previous, '2026000123456789', 'החלפה מדווחת ליומן');

  const big2 = await mk(7000);
  const w = await AccountingService.waiveAllocation(big2.id);
  assert.equal(w.allocationWaived.reason, 'customer');
  assert.equal((await AccountingService.getInvoices()).find(i => i.id === big2.id).allocation, 'waived');
  // הזנת מספר אחרי "לא נדרש" — מבטלת את הסימון
  const r3 = await AccountingService.setAllocation(big2.id, { number: '333333333' });
  assert.equal(r3.invoice.allocationWaived, undefined);

  await AccountingService.cancelInvoice((await mk(8000)).id);
  const cancelled = (await AccountingService.getInvoices()).find(i => i.status === 'cancelled');
  await assert.rejects(AccountingService.setAllocation(cancelled.id, { number: '444444444' }), /בוטלה/);
});

test('ערוצים: עוברים דרך handle עם הרשאת עריכה, נרשמים ביומן, וחשופים ב-preload; אין פנייה לרשת', () => {
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  for (const ch of ['acct:setAllocation', 'acct:waiveAllocation']) assert.match(ipc, new RegExp(`handle\\('${ch}'`));
  assert.match(ipc, /'acct\.invoice\.allocation'/);
  assert.match(ipc, /'acct\.invoice\.allocation-waived'/);
  const { permissionFor } = require('../modules/econ/ipc');
  assert.equal(permissionFor('acct:setAllocation'), 'data.edit');
  assert.equal(permissionFor('acct:waiveAllocation'), 'data.edit');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/preload.js'), 'utf8');
  assert.match(pre, /setAllocation: .*'acct:setAllocation'/);
  assert.match(pre, /waiveAllocation: .*'acct:waiveAllocation'/);
  const core = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/core/allocation.js'), 'utf8');
  assert.doesNotMatch(core, /\bfetch\(|require\(['"](https?|net)['"]\)/, 'נתיב ידני — בלי רשת');
  // לוח הבוקר מקבל את החשבוניות רק כשהרישיון פותח את הנהלת החשבונות
  const brief = ipc.slice(ipc.indexOf("handle('dashboard:getMorningBrief'"), ipc.indexOf("handle('chesed:getOverview'"));
  assert.match(brief, /LG\.checkChannel\(licenseState\(\), 'acct:getInvoices'/);
});

// --- תצוגה: מסך החשבוניות ---
test('מסך החשבוניות: ממתינה — אזהרה ושני כפתורים; עם מספר — המספר; מתחת לסף — כלום. שדה ע.מ בטופס', () => {
  const vm = require('vm');
  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const html = vm.runInContext(`renderAcctInvoices({ invoices: [
    { id: 'a', number: 1, customer: 'א', date: '2026-07-01', net: 6000, vat: 1080, total: 7080, status: 'open', allocation: 'pending' },
    { id: 'b', number: 2, customer: 'ב', date: '2026-07-01', net: 6000, vat: 1080, total: 7080, status: 'paid', allocation: 'assigned', allocationNumber: '2026000123456789' },
    { id: 'c', number: 3, customer: 'ג', date: '2026-07-01', net: 100, vat: 18, total: 118, status: 'open', allocation: 'not-required' }
  ] })`, context);
  const card = (n) => html.split(/<div class="card [^-]/).find(c => c.includes(`חשבונית ${n} ·`));
  assert.match(card(1), /דרוש מספר הקצאה/);
  assert.match(card(1), /data-action="alloc" data-id="a"/);
  assert.match(card(1), /data-action="alloc-waive" data-id="a"/);
  assert.match(card(2), /הקצאה מספר: <span dir="ltr">123456789<\/span>/);
  assert.doesNotMatch(card(2), /data-action="alloc/);
  assert.doesNotMatch(card(3), /הקצאה|data-action="alloc/);
  const fields = vm.runInContext(`acctFormSchemas['acct-invoices'].fields.map(f => f.name)`, context);
  assert.ok(fields.includes('customerTaxId'));
});
