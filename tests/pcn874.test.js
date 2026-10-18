// דוח מע"מ מפורט — קובץ PCN874 (PLAN.md 9.16): מבנה הרשומות לפי נספח א', הסכומים מול דוח המע"מ,
// לקוח לא מזוהה במצטבר, זיכוי וביטול בסימן מינוס, תשומות עם פרטי ספק, ערוץ ההפקה. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const PCN = require('../modules/econ/core/pcn874');
const A = require('../modules/econ/core/accounting');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_pcn__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_pcn__.js'] = { id: '/__electron_stub_pcn__.js', filename: '/__electron_stub_pcn__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782' };
const NOW = new Date(2026, 7, 3, 10, 0).getTime();
const lines = (text) => text.split('\r\n').slice(0, -1);

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pcn-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

test('תקופה: חודש או חודשיים, כולל מעבר שנה; קלט שגוי נדחה', () => {
  assert.deepEqual(PCN.monthRange('2026-07'), { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(PCN.monthRange('2026-02', 1), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(PCN.monthRange('2026-11', 2), { from: '2026-11-01', to: '2026-12-31' });
  assert.deepEqual(PCN.monthRange('2026-12', 2), { from: '2026-12-01', to: '2027-01-31' });
  assert.throws(() => PCN.monthRange('2026-13'), /חודש הדיווח/);
  assert.throws(() => PCN.monthRange('2026-07', 3), /חודש או חודשיים/);
});

test('בלי מספר עוסק תקין לעסק — שגיאה בעברית', () => {
  assert.throws(() => PCN.buildPcn874({ data: { invoices: [], journal: [] }, business: { taxId: '12' }, month: '2026-07' }), /מספר עוסק מורשה/);
});

test('מבנה: O באורך 131, תנועות 60, X באורך 10, CRLF; שדות הכותרת במקומם', async () => {
  const { svc } = await freshService();
  await svc.createInvoice({ customer: 'ישיבת אור התורה', customerTaxId: '515555555', date: '2026-07-05', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000.4 }] });
  await svc.createInvoice({ customer: 'לקוח פרטי', date: '2026-07-06', items: [{ description: 'כריכה', quantity: 1, unitPrice: 100 }] });
  const out = await svc.getPcn874({ month: '2026-07' }, { now: NOW });
  assert.ok(out.text.endsWith('\r\n'));
  const recs = lines(out.text);
  assert.equal(recs[0].length, 131);
  assert.equal(recs[recs.length - 1], 'X123456782');
  recs.slice(1, -1).forEach(r => assert.equal(r.length, 60, r));
  const h = recs[0];
  assert.equal(h.slice(0, 1), 'O');
  assert.equal(h.slice(1, 10), '123456782');
  assert.equal(h.slice(10, 16), '202607');
  assert.equal(h.slice(16, 17), '1');
  assert.equal(h.slice(17, 25), '20260803');
  // עסקאות חייבות: 1000.40 + 100 → 1000 + 100 שקלים (עיגול לכל רשומה)
  assert.equal(h.slice(25, 37), '+00000001100');
  assert.equal(h.slice(37, 47), '+000000198'); // 180.07 → 180, 18 → 18
  // שיעור אחר — אפסים לשימוש עתידי
  assert.equal(h.slice(47, 59), '+' + '0'.repeat(11));
  assert.equal(h.slice(59, 69), '+' + '0'.repeat(9));
  assert.equal(h.slice(69, 78), '000000002'); // רשומות מכירה: S אחת ו-L אחת
  assert.equal(h.slice(78, 90), '+' + '0'.repeat(11)); // פטורות
  assert.equal(h.slice(90, 100), '+' + '0'.repeat(9)); // תשומות אחרות
  assert.equal(h.slice(100, 110), '+' + '0'.repeat(9)); // תשומות ציוד
  assert.equal(h.slice(110, 119), '0'.repeat(9)); // רשומות תשומה
  assert.equal(h.slice(119, 131), '+00000000198');
  assert.equal(out.totals.payable, 198);
});

test('רשומת S: ספק/לקוח, תאריך, אסמכתה 9 ימניות, מע"מ, סימן, סכום, ומספר הקצאה בשדה האחרון', () => {
  const data = {
    journal: [],
    invoices: [{ id: 'i1', number: 1234567890, date: '2026-07-05', customer: 'א', customerTaxId: '515555555', net: 6000.5, vat: 1080.09, total: 7080.59,
      status: 'open', allocationNumber: '2026000123456789', items: [] }]
  };
  const out = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-07', now: NOW });
  const s = lines(out.text)[1];
  assert.equal(s.slice(0, 1), 'S');
  assert.equal(s.slice(1, 10), '515555555');
  assert.equal(s.slice(10, 18), '20260705');
  assert.equal(s.slice(18, 22), '0000');
  assert.equal(s.slice(22, 31), '234567890');
  assert.equal(s.slice(31, 40), '000001080');
  assert.equal(s.slice(40, 41), '+');
  assert.equal(s.slice(41, 51), '0000006001'); // 6000.50 → 6001
  assert.equal(s.slice(51, 60), '123456789');
});

test('לקוחות לא מזוהים: רשומת L מצטברת בסוף התקופה, האסמכתה = מספר החשבוניות; פטורה — רשומה נפרדת', () => {
  const inv = (n, net, vat, extra = {}) => ({ id: 'i' + n, number: n, date: '2026-07-0' + n, customer: 'פרטי', net, vat, total: net + vat, status: 'open', items: [], ...extra });
  const data = { journal: [], invoices: [inv(1, 100, 18), inv(2, 200, 36), inv(3, 50, 0, { vatExempt: true })] };
  const out = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-07', now: NOW });
  const ls = lines(out.text).filter(r => r.startsWith('L'));
  assert.equal(ls.length, 2);
  assert.equal(ls[0].slice(1, 10), '000000000');
  assert.equal(ls[0].slice(10, 18), '20260731');
  assert.equal(Number(ls[0].slice(22, 31)), 2);
  assert.equal(Number(ls[0].slice(31, 40)), 54);
  assert.equal(Number(ls[0].slice(41, 51)), 300);
  assert.equal(Number(ls[1].slice(31, 40)), 0);
  assert.equal(Number(ls[1].slice(41, 51)), 50);
  assert.equal(out.totals.exemptNet, 50);
  assert.equal(out.totals.salesCount, 2);
});

test('זיכוי וביטול: סימן מינוס, הסכום חיובי; הכותרת מקזזת', async () => {
  const { svc } = await freshService();
  const a = await svc.createInvoice({ customer: 'א', customerTaxId: '515555555', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }] });
  await svc.createCreditNote(a.id, { date: '2026-07-10', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 100 }] });
  const out = await svc.getPcn874({ month: '2026-07' }, { now: NOW });
  const ss = lines(out.text).filter(r => r.startsWith('S'));
  assert.equal(ss.length, 2);
  const minus = ss.filter(r => r[40] === '-');
  assert.equal(minus.length, 1);
  assert.equal(Number(minus[0].slice(41, 51)), 100);
  assert.equal(Number(minus[0].slice(31, 40)), 18);
  assert.deepEqual([out.totals.taxableNet, out.totals.taxableVat], [900, 162]);
  assert.equal(out.difference, 0);
  assert.equal(lines(out.text)[0].slice(25, 37), '+00000000900');

  // ביטול חשבונית — בחודש הביטול (כמו רשומת ההיפוך ביומן), והמקור נשאר בחודש שלו
  const inv = { id: 'b', number: 2, date: '2026-07-02', customer: 'ב', customerTaxId: '515555555', net: 500, vat: 90, total: 590,
    status: 'cancelled', cancelledAt: '2026-08-03', items: [] };
  const july = PCN.buildPcn874({ data: { invoices: [inv], journal: [] }, business: BUSINESS, month: '2026-07', now: NOW });
  const aug = PCN.buildPcn874({ data: { invoices: [inv], journal: [] }, business: BUSINESS, month: '2026-08', now: NOW });
  assert.equal(lines(july.text)[1][40], '+');
  assert.equal(lines(aug.text)[1][40], '-');
  assert.equal(aug.totals.taxableVat, -90);
  assert.equal(lines(aug.text)[0].slice(37, 47), '-000000090');
  // ביטול באותו חודש — שתי רשומות מתקזזות
  const same = PCN.buildPcn874({ data: { invoices: [{ ...inv, cancelledAt: '2026-07-20' }], journal: [] }, business: BUSINESS, month: '2026-07', now: NOW });
  assert.equal(same.counts.S, 2);
  assert.equal(same.totals.taxableNet, 0);
});

test('תשומות: רשומת T עם ספק ומספר חשבונית; ציוד בנפרד; בלי ספק — לא בקובץ ומופיע ברשימת הבדיקה', async () => {
  const { svc } = await freshService();
  await svc.createInvoice({ customer: 'א', customerTaxId: '515555555', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }] });
  await assert.rejects(svc.createEntry({ date: '2026-07-03', description: 'נייר', lines: [{ account: '6900', debit: 100 }, { account: '1300', debit: 18 }, { account: '1000', credit: 118 }],
    vatDoc: { supplierTaxId: '12345' } }), /9 ספרות/);
  await svc.createEntry({ date: '2026-07-03', description: 'נייר', lines: [{ account: '6900', debit: 100 }, { account: '1300', debit: 18 }, { account: '1000', credit: 118 }],
    vatDoc: { supplierTaxId: '514444444', reference: 'INV-778', docDate: '2026-07-02' } });
  await svc.createEntry({ date: '2026-07-04', description: 'מחשב', lines: [{ account: '1500', debit: 3000 }, { account: '1300', debit: 540 }, { account: '1000', credit: 3540 }],
    vatDoc: { supplierTaxId: '513333333', reference: '55' } });
  await svc.createEntry({ date: '2026-07-05', description: 'קפה למשרד', lines: [{ account: '6900', debit: 50 }, { account: '1300', debit: 9 }, { account: '1000', credit: 59 }] });
  const out = await svc.getPcn874({ month: '2026-07' }, { now: NOW });
  const ts = lines(out.text).filter(r => r.startsWith('T'));
  assert.equal(ts.length, 2);
  assert.equal(ts[0].slice(1, 10), '514444444');
  assert.equal(ts[0].slice(10, 18), '20260702');
  assert.equal(ts[0].slice(22, 31), '000000778');
  assert.equal(Number(ts[0].slice(31, 40)), 18);
  assert.equal(Number(ts[0].slice(41, 51)), 100);
  assert.deepEqual([out.totals.otherInputVat, out.totals.equipmentInputVat, out.totals.inputsCount], [18, 540, 2]);
  assert.equal(out.totals.payable, 180 - 18 - 540);
  const h = lines(out.text)[0];
  assert.equal(h.slice(119, 131), '-00000000378');
  assert.equal(out.issues.length, 1);
  assert.equal(out.issues[0].kind, 'input-no-supplier');
  // ההפרש מול היומן = התשומה שלא נכללה
  assert.equal(out.difference, -9);
});

test('היפוך תשומה ביומן: רשומת T במינוס בחודש ההיפוך, עם הספק של המקור', () => {
  const orig = { id: 'e1', date: '2026-06-28', description: 'נייר', vatDoc: { supplierTaxId: '514444444', reference: '778' },
    lines: [{ account: '6900', debit: 100, credit: 0 }, { account: '1300', debit: 18, credit: 0 }, { account: '1000', debit: 0, credit: 118 }] };
  const rev = { id: 'e2', date: '2026-07-02', description: 'ביטול: נייר', reversalOf: 'e1',
    lines: orig.lines.map(l => ({ account: l.account, debit: l.credit, credit: l.debit })) };
  const out = PCN.buildPcn874({ data: { invoices: [], journal: [orig, rev] }, business: BUSINESS, month: '2026-07', now: NOW });
  const ts = lines(out.text).filter(r => r.startsWith('T'));
  assert.equal(ts.length, 1);
  assert.equal(ts[0][40], '-');
  assert.equal(ts[0].slice(1, 10), '514444444');
  assert.equal(Number(ts[0].slice(41, 51)), 100);
  assert.equal(out.totals.otherInputVat, -18);
  assert.equal(lines(out.text)[0].slice(90, 100), '-000000018');
});

test('פרטי הספק נשמרים רק ברשומה עם מע"מ תשומות', async () => {
  const { svc, db } = await freshService();
  const e = await svc.createEntry({ date: '2026-07-03', description: 'שכירות', lines: [{ account: '6100', debit: 100 }, { account: '1000', credit: 100 }],
    vatDoc: { supplierTaxId: '514444444' } });
  assert.equal((await db.load()).journal.find(x => x.id === e.id).vatDoc, undefined);
  assert.equal(PCN.validateVatDoc({}), null);
  assert.deepEqual(PCN.validateVatDoc({ supplierTaxId: '514-444-444', reference: 'A12', equipment: true }), { supplierTaxId: '514444444', reference: '12', equipment: true });
});

test('מחוץ לתקופה — לא נכלל; סכום ארוך מהשדה — שגיאה ולא חיתוך', () => {
  const data = { journal: [], invoices: [{ id: 'x', number: 1, date: '2026-08-01', customer: 'א', customerTaxId: '515555555', net: 10, vat: 1.8, total: 11.8, status: 'open', items: [] }] };
  const out = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-07', now: NOW });
  assert.equal(lines(out.text).length, 2);
  const big = { journal: [], invoices: [{ ...data.invoices[0], date: '2026-07-01', net: 1e11, vat: 1.8e10 }] };
  assert.throws(() => PCN.buildPcn874({ data: big, business: BUSINESS, month: '2026-07' }), /ארוך מהמותר/);
});

test('ערוץ: הרשאת ייצוא, חשיפה ב-preload, כפתור במסך הדוחות ושדות הספק בטופס היומן', () => {
  const { permissionFor } = require('../modules/econ/ipc');
  assert.equal(permissionFor('acct:exportPcn874'), 'data.export');
  const ipc = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  assert.match(ipc, /handle\('acct:exportPcn874'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/preload.js'), 'utf8'), /exportPcn874: \(input\) => ipcRenderer\.invoke\('acct:exportPcn874', input\)/);
  const ui = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/accounting.js'), 'utf8');
  assert.match(ui, /id="acctPcn874"/);
  assert.match(ui, /name: 'supplierTaxId'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/ui/forms.js'), 'utf8'), /handlePcn874/);
});
