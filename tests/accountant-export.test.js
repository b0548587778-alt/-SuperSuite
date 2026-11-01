// מבנה אחיד ויומן לרו"ח (PLAN שלב 10, 10.3א): חשבון נגדי בשדה 1365 של B100, אסמכתת ספק (1357),
// סוג 700 (1358) ותאריך החשבונית (1363) ברשומת ספק, ועמודות נוספות בקובץ היומן (CSV)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const UF = require('../modules/econ/core/uniformFile');
const A = require('../modules/econ/core/accounting');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_accexp__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_accexp__.js'] = { id: '/__electron_stub_accexp__.js', filename: '/__electron_stub_accexp__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782', address: 'רחוב רבי עקיבא 1, בני ברק' };
const NOW = new Date(2026, 6, 15, 9, 5).getTime();
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } } });

const invoiceEntry = { id: 'e1', date: '2026-07-01', description: 'חשבונית 1', createdAt: '2026-07-01T08:00:00.000Z',
  lines: [{ account: '1200', debit: 1180, credit: 0 }, { account: '4000', debit: 0, credit: 1000 }, { account: '2200', debit: 0, credit: 180 }] };
const supplierEntry = { id: 'e2', date: '2026-07-03', description: 'דפוס הנסיך — מס\' A-12345', createdAt: '2026-07-03T08:00:00.000Z',
  lines: [{ account: '6100', debit: 1000, credit: 0, memo: 'חשבונית A-12345' }, { account: '1300', debit: 180, credit: 0 }, { account: '2000', debit: 0, credit: 1180 }],
  vatDoc: { supplierTaxId: '000000018', reference: '12345', docDate: '2026-06-30' },
  supplierDoc: { name: 'דפוס הנסיך', taxId: '000000018', reference: 'A-12345', docDate: '2026-06-30' } };

test('counterAccountOf: השורה היחידה בצד השני, ואם יש כמה — הגדולה', () => {
  assert.equal(UF.counterAccountOf(invoiceEntry, 0), '4000', 'חובה 1200 מול 4000 (1000) ו-2200 (180)');
  assert.equal(UF.counterAccountOf(invoiceEntry, 1), '1200');
  assert.equal(UF.counterAccountOf(invoiceEntry, 2), '1200');
  assert.equal(UF.counterAccountOf(supplierEntry, 2), '6100');
  assert.equal(UF.counterAccountOf(supplierEntry, 1), '2000');
  assert.equal(UF.counterAccountOf({ lines: [] }, 0), '');
});

function records(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) { out.push(buf.subarray(start, i)); start = i + 2; i++; }
  }
  return out;
}
const ascii = (b, from, to) => Buffer.from(b.subarray(from - 1, to)).toString('latin1');
// עמודות B100 לפי LAYOUTS (מחושב, כדי שלא יהיו מספרים קסומים)
function colOf(kind, fieldNo) {
  let pos = 1;
  for (const [no, , len] of UF.LAYOUTS[kind]) { if (no === fieldNo) return [pos, pos + len - 1]; pos += len; }
  throw new Error('no field ' + fieldNo);
}

test('B100: חשבון נגדי בכל שורה; ברשומת ספק — אסמכתה מקורית, סוג 700 ותאריך החשבונית; אורך הרשומה לא השתנה', () => {
  const data = { accounts: A.DEFAULT_CHART.map(a => ({ ...a })), journal: [invoiceEntry, supplierEntry],
    invoices: [{ id: 'i1', number: 1, date: '2026-07-01', customer: 'ישיבת אור התורה', net: 1000, vat: 180, total: 1180, status: 'open', entryId: 'e1',
      createdAt: '2026-07-01T08:00:00.000Z', items: [{ description: 'סט שס', quantity: 1, unitPrice: 1000, lineNet: 1000, account: '4000' }] }],
    salesDocs: [], settings: {} };
  const out = UF.buildUniformFile({ data, business: BUSINESS, range: { from: '2026-01-01', to: '2026-12-31' }, now: NOW, user: 'יעקב', primaryId: '123456789012345' });
  const b = records(out.dataTxt).filter(r => ascii(r, 1, 4) === 'B100');
  assert.equal(b.length, 6);
  assert.ok(b.every(r => r.length === UF.RECORD_LENGTHS.B100));
  const f = (r, no) => ascii(r, ...colOf('B100', no)).trim();
  assert.deepEqual(b.slice(0, 3).map(r => f(r, 1365)), ['4000', '1200', '1200']);
  assert.deepEqual(b.slice(3).map(r => f(r, 1365)), ['2000', '2000', '6100']);
  // רשומת החשבונית: נשארת לפי המסמך (305 ומספר 1)
  assert.deepEqual([f(b[0], 1357), f(b[0], 1358)], ['1', '305']);
  // רשומת הספק
  assert.deepEqual([f(b[3], 1357), f(b[3], 1358), f(b[3], 1363), f(b[3], 1362)], ['A-12345', '700', '20260630', '20260703']);
});

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-accexp-'));
  dirs.push(dir);
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { svc: AccountingService };
}

test('CSV של היומן: חשבון נגדי, פרטי השורה, אסמכתה, תאריך אסמכתה וע.מ ספק; טווח לא תקין נדחה בעברית', async () => {
  const { svc } = await freshService();
  const draft = await svc.captureInvoice({ date: '2026-07-03', gross: '1180', expenseAccount: '6100', supplierName: 'דפוס הנסיך', supplierTaxId: '000000018', docNumber: 'A-12345' });
  await svc.createEntry(draft.entry);
  const out = await svc.getExportData('journal', { from: '2026-07-01', to: '2026-07-31' });
  const h = (name) => out.headers.indexOf(name);
  for (const name of ['חשבון נגדי', 'פרטי השורה', 'אסמכתה', 'תאריך אסמכתה', 'ע.מ ספק']) assert.ok(h(name) >= 0, name);
  assert.equal(out.rows.length, 3);
  const ap = out.rows.find(r => r[2] === '2000');
  assert.equal(ap[h('חשבון נגדי')], '6100');
  assert.equal(ap[h('אסמכתה')], 'A-12345');
  assert.equal(ap[h('תאריך אסמכתה')], '2026-07-03');
  assert.equal(ap[h('ע.מ ספק')], '000000018');
  await assert.rejects(svc.getExportData('journal', { from: '2026-02-31' }), /טווח התאריכים/);
});
