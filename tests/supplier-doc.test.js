// קליטת חשבונית ספק (PLAN שלב 10, 10.1ב): פרטי הספק נשמרים ברשומה (supplierDoc) גם בלי מע"מ,
// האסמכתה המקורית מבדילה בין A-100 ל-B-100, הצעת חשבון לפי שם עובדת, וחשבונית מעל סף ההקצאה
// בלי מספר הקצאה מקבלת אזהרה בטיוטה ו-issue בדוח PCN874 (לידיעה בלבד)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const IC = require('../modules/econ/core/invoiceCapture');
const PCN = require('../modules/econ/core/pcn874');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_supdoc__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_supdoc__.js'] = { id: '/__electron_stub_supdoc__.js', filename: '/__electron_stub_supdoc__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782' };
const SUPPLIER = '000000018';
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } } });

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-supdoc-'));
  dirs.push(dir);
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

const capture = (svc, extra) => svc.captureInvoice({ date: '2026-07-01', gross: '1180', expenseAccount: '6100', supplierName: 'דפוס הנסיך', supplierTaxId: SUPPLIER, docNumber: 'A-100', ...extra });

test('הטיוטה נושאת supplierDoc עם השם והאסמכתה המקורית; vatDoc נשאר בספרות ל-PCN874', () => {
  const r = IC.draftEntry({ date: '2026-07-01', gross: '1180', expenseAccount: '5000', supplierName: 'דפוס הנסיך', supplierTaxId: SUPPLIER, docNumber: 'A-100' }, { vatRate: 0.18, expenseAccounts: ['5000'] });
  assert.deepEqual(r.entry.supplierDoc, { name: 'דפוס הנסיך', taxId: SUPPLIER, reference: 'A-100', docDate: '2026-07-01' });
  assert.equal(r.entry.vatDoc.reference, '100');
  assert.throws(() => IC.validateSupplierDoc({ taxId: '123' }), /5–9 ספרות/);
  assert.throws(() => IC.validateSupplierDoc({ docDate: '2026-02-31' }), /אינו תקין/);
  assert.equal(IC.validateSupplierDoc({}), null);
});

test('A-100 ו-B-100 של אותו ספק אינן כפולות; A-100 פעמיים — נחסם', async () => {
  const { svc } = await freshService();
  const a = await capture(svc);
  await svc.createEntry(a.entry);
  const b = await capture(svc, { docNumber: 'B-100' });
  assert.equal(b.duplicate, null, 'אסמכתה אחרת — לא כפולה');
  await svc.createEntry(b.entry);
  const again = await capture(svc, { docNumber: 'a-100' });
  assert.ok(again.duplicate, 'אותה אסמכתה (בלי הבדל אותיות גדולות/קטנות) — כפולה');
  await assert.rejects(svc.createEntry(again.entry), (e) => e.code === 'duplicate-supplier-invoice' && /A-100|a-100/.test(e.message));
  await svc.createEntry({ ...again.entry, confirmDuplicate: true });
});

test('רשומה ישנה (vatDoc בספרות בלבד) עדיין חוסמת לפי הספרות', async () => {
  const { svc, db } = await freshService();
  const r = await capture(svc);
  const legacy = { ...r.entry };
  delete legacy.supplierDoc;
  await svc.createEntry(legacy);
  const data = await db.load();
  assert.equal(data.journal[data.journal.length - 1].supplierDoc, undefined);
  const dup = await capture(svc, { docNumber: 'X-100' });
  assert.ok(dup.duplicate, 'בלי אסמכתה מקורית ברשומה הישנה — ההשוואה לפי הספרות, כמו קודם');
});

test('ספק פטור (בלי מע"מ): פרטי הספק נשמרים וכפילות נחסמת', async () => {
  const { svc, db } = await freshService();
  const r = await capture(svc, { exempt: true, gross: '500', docNumber: '77' });
  assert.equal(r.entry.vatDoc && r.entry.lines.some(l => l.account === '1300'), false, 'אין שורת מע"מ');
  const saved = await svc.createEntry(r.entry);
  assert.equal(saved.vatDoc, undefined, 'vatDoc רק כשיש מע"מ תשומות');
  assert.deepEqual(saved.supplierDoc, { name: 'דפוס הנסיך', taxId: SUPPLIER, reference: '77', docDate: '2026-07-01' });
  assert.ok((await db.load()).journal.find(e => e.id === saved.id).supplierDoc);
  const dup = await capture(svc, { exempt: true, gross: '500', docNumber: '77' });
  assert.ok(dup.duplicate);
  await assert.rejects(svc.createEntry(dup.entry), (e) => e.code === 'duplicate-supplier-invoice');
});

test('הצעת חשבון לפי שם הספק (בלי ע.מ) עובדת', async () => {
  const { svc } = await freshService();
  const r = await capture(svc, { expenseAccount: '6100' });
  await svc.createEntry(r.entry);
  const byName = await svc.captureInvoice({ date: '2026-07-02', gross: '236', expenseAccount: '6100', supplierName: 'דפוס הנסיך' });
  assert.ok(byName.suggestion, 'נמצאה הצעה לפי שם');
  assert.equal(byName.suggestion.account, '6100');
});

test('סף מספר ההקצאה: 5,001 ₪ נטו מ-1.7.2026 בלי מספר ← אזהרה; 5,000 ₪, תאריך מ-2024 או עם מספר — בלי', async () => {
  const { svc } = await freshService();
  const warn = (r) => r.warnings.some(w => /סף מספר ההקצאה/.test(w));
  assert.equal(warn(await capture(svc, { gross: '5901.18', net: '5001', docNumber: '1' })), true);
  assert.equal(warn(await capture(svc, { gross: '5900', net: '5000', docNumber: '2' })), false);
  assert.equal(warn(await capture(svc, { date: '2024-07-01', gross: '5851.17', net: '5001', vatRate: 0.17, docNumber: '3' })), false);
  assert.equal(warn(await capture(svc, { gross: '5901.18', net: '5001', docNumber: '4', allocation: '123456789' })), false);
  assert.equal(warn(await capture(svc, { gross: '6000', exempt: true, docNumber: '5' })), false, 'פטור — אין מע"מ');
});

test('PCN874: תשומה מעל הסף בלי מספר הקצאה ← issue לבדיקה, והרשומה עדיין בקובץ', async () => {
  const { svc, db } = await freshService();
  const over = await capture(svc, { gross: '5901.18', net: '5001', docNumber: '11' });
  await svc.createEntry(over.entry);
  const under = await capture(svc, { gross: '1180', docNumber: '12' });
  await svc.createEntry(under.entry);
  const data = await db.load();
  const out = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-07' });
  const issues = out.issues.filter(i => i.kind === 'input-no-allocation');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].entryId, data.journal.find(e => e.vatDoc && e.vatDoc.reference === '11').id);
  const tLines = out.text.split('\r\n').filter(l => l.startsWith('T'));
  assert.equal(tLines.length, 2, 'שתי התשומות בקובץ');
});

test('טופס התרומה והוראת הקבע: הסבר ש"שכר לימוד אינו תרומה" מתחת לשדה הייעוד (10.1ה)', () => {
  const npoUi = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/npo.js'), 'utf8');
  assert.match(npoUi, /const TUITION_HINT = '[^']*שכר לימוד[^']*אינם תרומה/);
  assert.equal((npoUi.match(/hint: TUITION_HINT/g) || []).length, 2);
  const forms = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/forms.js'), 'utf8');
  assert.match(forms, /f\.hint \? `[^`]*<small class="ss-hint"[^>]*>\$\{esc\(f\.hint\)\}<\/small>/, 'ההסבר עובר esc');
  const shamai = fs.readFileSync(path.join(__dirname, '../modules/shamai/src/analytics.js'), 'utf8');
  assert.match(shamai, /שווי מלאי \(הערכת שוק, לא עלות\)/);
});
