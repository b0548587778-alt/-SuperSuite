// מסמכי מכירה (PLAN.md 9.3): הצעת מחיר → הזמנה → תעודת משלוח → חשבונית, חשבונית זיכוי, קבלה,
// חשבונית מס/קבלה, מיתוג המסמך והקבצים במבנה אחיד. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const SD = require('../modules/econ/core/salesDocs');
const A = require('../modules/econ/core/accounting');
const X = require('../modules/econ/core/exports');
const UF = require('../modules/econ/core/uniformFile');

// ipc.js דורש electron — מספיק ipcMain מדומה כדי לקרוא את permissionFor
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_docs__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_docs__.js'] = { id: '/__electron_stub_docs__.js', filename: '/__electron_stub_docs__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782', address: 'רחוב רבי עקיבא 1, בני ברק' };
const ITEMS = [{ description: 'סט משנה ברורה', quantity: 3, unitPrice: 333.33 }, { description: 'כריכה', quantity: 1, unitPrice: 0.07 }];

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-docs-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

const records = (buf) => buf.toString('latin1').split('\r\n').filter(Boolean);

test('מספור נפרד לכל סוג, במונה שלא יורד', () => {
  const docs = [{ kind: 'quote', number: 4 }, { kind: 'order', number: 1 }];
  assert.equal(SD.nextNumber(docs, 'quote'), 5);
  assert.equal(SD.nextNumber(docs, 'order', { order: 9 }), 10);
  assert.equal(SD.nextNumber(docs, 'receipt'), 1);
});

test('טיוטה: לקוח, תאריך ותוקף נבדקים; סוג לא מוכר נדחה', () => {
  assert.throws(() => SD.validateDraft('invoice', { customer: 'א', date: '2026-07-01', items: ITEMS }, 0.18), /סוג מסמך/);
  assert.throws(() => SD.validateDraft('quote', { date: '2026-07-01', items: ITEMS }, 0.18), /שם לקוח/);
  assert.throws(() => SD.validateDraft('quote', { customer: 'א', date: '2026-13-01', items: ITEMS }, 0.18), /תאריך/);
  assert.throws(() => SD.validateDraft('quote', { customer: 'א', date: '2026-07-01', validUntil: '2026-06-01', items: ITEMS }, 0.18), /תוקף/);
  const q = SD.validateDraft('quote', { customer: 'א', date: '2026-07-01', validUntil: '2026-07-31', items: ITEMS }, 0.18);
  assert.equal(q.validUntil, '2026-07-31');
  // הזמנה לא שומרת "בתוקף עד"
  assert.equal(SD.validateDraft('order', { customer: 'א', date: '2026-07-01', validUntil: '2026-07-31', items: ITEMS }, 0.18).validUntil, undefined);
});

test('הצעה → הזמנה → תעודת משלוח → חשבונית: סכומים זהים עד האגורה, והמקור מסומן כ"הומר"', async () => {
  const { svc, db } = await freshService();
  const quote = await svc.createSalesDoc('quote', { customer: 'ישיבת אור התורה', date: '2026-07-01', items: ITEMS });
  assert.equal(quote.number, 1);
  assert.equal(quote.kindLabel, 'הצעת מחיר');
  const journalBefore = (await db.load()).journal.length;
  const order = await svc.convertSalesDoc(quote.id, 'order', { date: '2026-07-02' });
  const delivery = await svc.convertSalesDoc(order.id, 'delivery', { date: '2026-07-03' });
  // הצעה, הזמנה ותעודת משלוח — לא ביומן
  assert.equal((await db.load()).journal.length, journalBefore);
  const target = await svc.convertSalesDoc(delivery.id, 'invoice', { date: '2026-07-04' });
  assert.equal(target.kind, 'invoice');
  const inv = await svc.getInvoice(target.id);
  assert.deepEqual([inv.net, inv.vat, inv.total], [quote.net, quote.vat, quote.total]);
  assert.deepEqual(inv.items.map(i => i.lineNet), quote.items.map(i => i.lineNet));
  assert.deepEqual(inv.sourceDoc, { kind: 'delivery', id: delivery.id, number: delivery.number });
  // אותו חישוב בדיוק כמו חשבונית שהוזנה ישירות
  const direct = A.computeInvoice({ items: ITEMS }, 0.18);
  assert.equal(A.toAg(inv.total), A.toAg(direct.total));

  const docs = await svc.getSalesDocs();
  assert.equal(docs.find(d => d.id === quote.id).status, 'converted');
  assert.equal(docs.find(d => d.id === delivery.id).convertedTo.number, inv.number);
  await assert.rejects(svc.convertSalesDoc(quote.id, 'invoice'), /כבר הומרה/);
  const openDelivery = await svc.createSalesDoc('delivery', { customer: 'א', date: '2026-07-05', items: ITEMS });
  await assert.rejects(svc.convertSalesDoc(openDelivery.id, 'order'), /לא ניתן להמיר תעודת משלוח להזמנה/);
  await assert.rejects(svc.cancelSalesDoc(quote.id), /כבר הומר/);
});

test('ביטול טיוטה: רק מסמך פתוח; תאריך המרה לפני המקור נדחה', async () => {
  const { svc } = await freshService();
  const q = await svc.createSalesDoc('quote', { customer: 'כולל חזון איש', date: '2026-07-10', items: ITEMS });
  await assert.rejects(svc.convertSalesDoc(q.id, 'invoice', { date: '2026-07-09' }), /לפני תאריך המקור/);
  const c = await svc.cancelSalesDoc(q.id);
  assert.equal(c.status, 'cancelled');
  await assert.rejects(svc.convertSalesDoc(q.id, 'invoice'), /בוטלה/);
});

test('טיוטה מותרת בתקופה נעולה (לא ביומן), אבל ההמרה לחשבונית — לא', async () => {
  const { svc } = await freshService();
  await svc.saveSettings({ business: BUSINESS, vatRate: 0.18, lockDate: '2026-06-30' });
  const q = await svc.createSalesDoc('quote', { customer: 'א', date: '2026-06-15', items: ITEMS });
  await assert.rejects(svc.convertSalesDoc(q.id, 'invoice', { date: '2026-06-20' }), /נעולה/);
});

test('זיכוי מלא: אותם סכומים, רשומת יומן הפוכה, והחשבונית לא ניתנת לגבייה או לביטול', async () => {
  const { svc, db } = await freshService();
  const inv = await svc.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: ITEMS });
  await assert.rejects(svc.createCreditNote(inv.id, { date: '2026-07-02' }), /סיבת הזיכוי/);
  await assert.rejects(svc.createCreditNote(inv.id, { date: '2026-06-30', reason: 'החזרה' }), /לפני תאריך החשבונית/);
  const credit = await svc.createCreditNote(inv.id, { date: '2026-07-02', reason: 'החזרת סחורה' });
  assert.equal(credit.number, 1);
  assert.equal(credit.kindLabel, 'חשבונית מס זיכוי');
  assert.deepEqual([credit.net, credit.vat, credit.total], [inv.net, inv.vat, inv.total]);
  assert.equal(credit.full, true);
  const data = await db.load();
  const entry = data.journal.find(e => e.id === credit.entryId);
  const sum = (acc, side) => entry.lines.filter(l => l.account === acc).reduce((t, l) => t + A.toAg(l[side]), 0);
  assert.equal(sum(A.SYS.AR, 'credit'), A.toAg(inv.total));
  assert.equal(sum(A.SYS.OUTPUT_VAT, 'debit'), A.toAg(inv.vat));
  const view = (await svc.getInvoices()).find(i => i.id === inv.id);
  assert.deepEqual([view.credited, view.balance], [inv.total, 0]);
  await assert.rejects(svc.recordPayment(inv.id, { date: '2026-07-03' }), /זוכתה במלואה/);
  await assert.rejects(svc.createCreditNote(inv.id, { date: '2026-07-03', reason: 'שוב' }), /זוכתה במלואה/);
  await assert.rejects(svc.cancelInvoice(inv.id), /זיכוי/);
  // רשומת הזיכוי לא מבוטלת ידנית ביומן
  await assert.rejects(svc.reverseEntry(credit.entryId));
});

test('זיכוי חלקי: באותו שיעור מע"מ; מעבר ליתרה נדחה; אחרי זיכוי חלקי צריך לפרט שורות; הגבייה על היתרה', async () => {
  const { svc, db } = await freshService();
  const inv = await svc.createInvoice({ customer: 'כולל חזון איש', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }] });
  // שינוי המע"מ אחרי החשבונית לא משנה את שיעור הזיכוי
  await svc.saveSettings({ business: BUSINESS, vatRate: 0.17 });
  const part = await svc.createCreditNote(inv.id, { date: '2026-07-02', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 100 }] });
  assert.deepEqual([part.net, part.vat, part.total], [100, 18, 118]);
  assert.equal(part.full, false);
  await assert.rejects(svc.createCreditNote(inv.id, { date: '2026-07-02', reason: 'שוב' }), /לפרט את השורות/);
  await assert.rejects(svc.createCreditNote(inv.id, { date: '2026-07-02', reason: 'יותר מדי', items: [{ description: 'x', quantity: 1, unitPrice: 901 }] }), /גבוה מהיתרה/);
  const paid = await svc.recordPayment(inv.id, { date: '2026-07-05', method: 'transfer', reference: 'TR-77' });
  assert.equal(paid.paymentMethod, 'transfer');
  const data = await db.load();
  const pay = data.journal.find(e => e.id === paid.paymentEntryId);
  assert.equal(pay.lines.find(l => l.account === A.SYS.BANK).debit, 1180 - 118);
  const receipt = data.salesDocs.find(d => d.kind === 'receipt');
  assert.deepEqual([receipt.number, receipt.total, receipt.method, receipt.reference], [1, 1062, 'transfer', 'TR-77']);
});

test('קבלה: מספור משלה, מבוטלת עם ביטול התשלום, והמספר הבא לא חוזר', async () => {
  const { svc } = await freshService();
  const a = await svc.createInvoice({ customer: 'א', date: '2026-07-01', items: ITEMS });
  const b = await svc.createInvoice({ customer: 'ב', date: '2026-07-01', items: ITEMS });
  await svc.recordPayment(a.id, { date: '2026-07-02', method: 'cash' });
  const view = (await svc.getInvoices()).find(i => i.id === a.id);
  assert.equal(view.receiptNumber, 1);
  assert.ok(view.receiptId);
  await svc.unrecordPayment(a.id);
  const r1 = (await svc.getSalesDocs()).find(d => d.kind === 'receipt');
  assert.equal(r1.status, 'cancelled');
  assert.equal((await svc.getInvoices()).find(i => i.id === a.id).receiptNumber, undefined);
  await svc.recordPayment(b.id, { date: '2026-07-02', method: 'check', reference: '000123' });
  await svc.recordPayment(a.id, { date: '2026-07-03', method: 'bitcoin' });
  const receipts = (await svc.getSalesDocs()).filter(d => d.kind === 'receipt').sort((x, y) => x.number - y.number);
  assert.deepEqual(receipts.map(r => r.number), [1, 2, 3]);
  // אמצעי לא מוכר נשמר כ"אחר"
  assert.equal(receipts[2].method, 'other');
  assert.equal(receipts[2].methodLabel, 'אחר');
});

test('חשבונית מס/קבלה: שולמה בעת ההפקה — שמירה אחת, בלי קבלה נפרדת', async () => {
  const { svc, db } = await freshService();
  const inv = await svc.createInvoice({ customer: 'א', date: '2026-07-01', items: ITEMS, paidNow: { method: 'card', reference: '4455' } });
  assert.equal(inv.status, 'paid');
  assert.equal(inv.kind, 'tax-invoice-receipt');
  assert.equal(inv.paymentMethod, 'card');
  assert.equal(inv.paymentRef, '4455');
  assert.equal((await db.load()).salesDocs.filter(d => d.kind === 'receipt').length, 0);
});

test('PDF: כותרת לפי סוג, "על פי" המסמך המקור, סיבת זיכוי, קבלה עם אמצעי תשלום, ומיתוג', () => {
  const brand = { ...BUSINESS, brandColor: '#0f766e', signature: 'בברכה, משה כהן', logo: 'data:image/png;base64,iVBORw0KGgo=' };
  const quote = SD.docView({ kind: 'quote', number: 3, date: '2026-07-01', validUntil: '2026-07-31', customer: 'ישיבת אור התורה', status: 'open',
    ...A.computeInvoice({ items: ITEMS }, 0.18) });
  const qh = X.renderInvoiceHtml(quote, brand);
  assert.match(qh, /<h1>הצעת מחיר<\/h1>/);
  assert.match(qh, /בתוקף עד:<\/strong> 2026-07-31/);
  assert.match(qh, /מסמך זה אינו חשבונית מס/);
  assert.doesNotMatch(qh, /הקצאה|אין לנכות/);
  assert.match(qh, /#0f766e/);
  assert.match(qh, /<img class="logo" src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(qh, /בברכה, משה כהן/);

  const credit = SD.docView({ kind: 'credit', number: 2, date: '2026-07-02', invoiceNumber: 17, reason: 'החזרת סחורה', customer: 'א', status: 'open',
    ...A.computeInvoice({ items: ITEMS }, 0.18) });
  const ch = X.renderInvoiceHtml(credit, BUSINESS);
  assert.match(ch, /<h1>חשבונית מס זיכוי<\/h1>/);
  assert.match(ch, /לחשבונית מס:<\/strong> 17/);
  assert.match(ch, /סיבת הזיכוי:<\/strong> החזרת סחורה/);
  assert.match(ch, /סה"כ זיכוי/);

  const inv = { number: 9, date: '2026-07-04', customer: 'א', items: [], net: 1, vat: 0.18, total: 1.18, status: 'open', sourceDoc: { kind: 'quote', number: 3 } };
  assert.match(X.renderInvoiceHtml(inv, BUSINESS), /על פי:<\/strong> הצעת מחיר 3/);

  const rh = X.renderReceiptHtml(SD.docView({ kind: 'receipt', number: 5, date: '2026-07-05', customer: 'א', invoiceNumber: 9, total: 1.18, method: 'check', reference: '000123', status: 'open' }), brand);
  assert.match(rh, /<h1>קבלה<\/h1>/);
  assert.match(rh, /עבור:<\/strong> חשבונית מס 9/);
  assert.match(rh, /המחאה/);
  assert.match(rh, /000123/);
});

test('מיתוג: צבע לא תקין נדחה; לוגו רק data:image (בלי טעינה מבחוץ); לוגו עד 200KB, PNG / JPEG אמיתי', async () => {
  const evil = X.renderInvoiceHtml({ number: 1, date: '2026-07-01', customer: 'א', items: [], net: 0, vat: 0, total: 0, status: 'open' },
    { name: 'א', brandColor: 'red;background:url(http://x)', logo: 'http://example.org/a.png' });
  assert.doesNotMatch(evil, /http:\/\/(x|example)/);
  assert.doesNotMatch(evil, /<img/);

  const { svc } = await freshService();
  await assert.rejects(svc.saveSettings({ business: { ...BUSINESS, brandColor: 'כחול' }, vatRate: 0.18 }), /צבע/);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  await assert.rejects(svc.setLogo(png, 'gif'), /PNG או JPEG/);
  await assert.rejects(svc.setLogo(Buffer.from('not an image'), 'png'), /אינו תמונה/);
  await assert.rejects(svc.setLogo(Buffer.concat([png, Buffer.alloc(200 * 1024)]), 'png'), /גדול מדי/);
  assert.deepEqual(await svc.setLogo(png, 'png'), { logo: true });
  // שמירת הגדרות מהטופס לא מוחקת את הלוגו, ושומרת צבע וחתימה
  await svc.saveSettings({ business: { ...BUSINESS, brandColor: '#0f766e', signature: 'משה כהן' }, vatRate: 0.18 });
  const { business } = await svc.getSettings();
  assert.match(business.logo, /^data:image\/png;base64,/);
  assert.equal(business.brandColor, '#0f766e');
  assert.equal(business.signature, 'משה כהן');
  assert.deepEqual(await svc.setLogo(null), { logo: false });
  assert.equal((await svc.getSettings()).business.logo, undefined);
});

test('מבנה אחיד: הזמנה 100, תעודת משלוח 200, זיכוי 330 וקבלה 400 — אורכים, אמצעי תשלום ומספר המחאה', async () => {
  const { svc, db } = await freshService();
  const q = await svc.createSalesDoc('quote', { customer: 'א', date: '2026-07-01', items: ITEMS });
  const o = await svc.convertSalesDoc(q.id, 'order', { date: '2026-07-01' });
  const dl = await svc.convertSalesDoc(o.id, 'delivery', { date: '2026-07-02' });
  const t = await svc.convertSalesDoc(dl.id, 'invoice', { date: '2026-07-03' });
  await svc.createCreditNote(t.id, { date: '2026-07-04', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 10 }] });
  await svc.recordPayment(t.id, { date: '2026-07-05', method: 'check', reference: '000123' });
  const paidNow = await svc.createInvoice({ customer: 'ב', date: '2026-07-06', items: ITEMS, paidNow: { method: 'check', reference: '4567' } });
  const out = UF.buildUniformFile({ data: await db.load(), business: BUSINESS, range: { from: '2026-01-01', to: '2026-12-31' }, primaryId: '123456789012345' });
  const recs = records(out.dataTxt);
  for (const r of recs) assert.equal(r.length, UF.RECORD_LENGTHS[r.slice(0, 4)], r.slice(0, 4));
  const types = recs.filter(r => r.startsWith('C100')).map(r => Number(r.slice(22, 25)));
  // הצעת מחיר אינה בנספח 1 — לא נכנסת לקובץ
  assert.deepEqual(types.sort((a, b) => a - b), [100, 200, 305, 320, 330, 400]);
  const counts = Object.fromEntries(out.report.documents.map(x => [x.code, x.count]));
  assert.deepEqual([counts[100], counts[200], counts[330], counts[400]], [1, 1, 1, 1]);
  const d120 = recs.filter(r => r.startsWith('D120'));
  assert.equal(d120.length, 2);
  for (const r of d120) assert.equal(r.slice(49, 50), '2'); // 1306 — המחאה
  const checks = d120.map(r => r.slice(85, 95)).sort();
  assert.deepEqual(checks, ['0000000123', '0000004567']);
  const rec400 = recs.find(r => r.startsWith('C100') && r.slice(22, 25) === '400');
  const view = (await svc.getInvoices()).find(i => i.id === t.id);
  assert.equal(Number(rec400.slice(347, 362)), A.toAg(view.balance)); // 1223 — סכום הקבלה = היתרה אחרי הזיכוי
  assert.ok(paidNow.number > 0);
});

test('ערוצים: הרשאות, חשיפה ב-preload ובממשק', () => {
  const { permissionFor } = require('../modules/econ/ipc');
  assert.equal(permissionFor('acct:getSalesDocs'), 'data.view');
  assert.equal(permissionFor('acct:createSalesDoc'), 'data.edit');
  assert.equal(permissionFor('acct:convertSalesDoc'), 'data.edit');
  assert.equal(permissionFor('acct:cancelSalesDoc'), 'data.delete');
  assert.equal(permissionFor('acct:createCreditNote'), 'data.edit');
  assert.equal(permissionFor('acct:exportSalesDocPdf'), 'data.export');
  assert.equal(permissionFor('acct:setLogo'), 'data.edit');
  const ipc = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../modules/econ/preload.js'), 'utf8');
  for (const ch of ['getSalesDocs', 'createSalesDoc', 'convertSalesDoc', 'cancelSalesDoc', 'createCreditNote', 'exportSalesDocPdf', 'setLogo']) {
    assert.match(ipc, new RegExp(`handle\\('acct:${ch}'`), ch);
    assert.match(preload, new RegExp(`'acct:${ch}'`), ch);
  }
  const ui = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/accounting.js'), 'utf8');
  assert.match(ui, /data-doc-new="quote"/);
  assert.match(ui, /data-action="credit"/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/ui/forms.js'), 'utf8'), /handleCreditNote/);
});
