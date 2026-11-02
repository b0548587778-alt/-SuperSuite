// חשבונית חוזרת וחוויית עבודה מהירה (PLAN.md 9.6): טיוטות מחושבות בלי הפקה אוטומטית, גם אחרי חודשים
// שבהם התוכנה לא נפתחה; הפקה ודילוג באישור; השלמת לקוחות, חיפוש ושכפול; לוח הבוקר; ערוצים וממשק.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const RC = require('../modules/econ/core/recurring');
const D = require('../modules/econ/core/dashboard');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_rec__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_rec__.js'] = { id: '/__electron_stub_rec__.js', filename: '/__electron_stub_rec__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const TEMPLATE = { customer: 'תלמוד תורה אור החיים', customerTaxId: '515555555', dayOfMonth: 31, startMonth: '2026-01',
  items: [{ description: 'שירותי הנהלת חשבונות', quantity: 1, unitPrice: 1000 }] };

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rec-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: { name: 'משרד לדוגמה', taxId: '123456782' }, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

test('תבנית: לקוח, יום בחודש, חודש התחלה וסיום נבדקים', () => {
  assert.throws(() => RC.validateTemplate({ ...TEMPLATE, customer: '' }, 0.18), /שם לקוח/);
  assert.throws(() => RC.validateTemplate({ ...TEMPLATE, dayOfMonth: 32 }, 0.18), /בין 1 ל-31/);
  assert.throws(() => RC.validateTemplate({ ...TEMPLATE, startMonth: '2026-1' }, 0.18), /חודש ההתחלה/);
  assert.throws(() => RC.validateTemplate({ ...TEMPLATE, endMonth: '2025-12' }, 0.18), /חודש הסיום/);
  assert.throws(() => RC.validateTemplate({ ...TEMPLATE, customerTaxId: '123456789' }, 0.18), /אינו תקין/);
  const t = RC.validateTemplate(TEMPLATE, 0.18);
  assert.equal(t.items[0].unitPrice, 1000);
});

test('טיוטה אחת לכל חודש שהגיע מועדו — גם על חודשים שבהם התוכנה לא נפתחה; יום 31 בחודש קצר = היום האחרון', () => {
  const t = { id: 't1', ...RC.validateTemplate(TEMPLATE, 0.18), issued: {}, skipped: [] };
  assert.deepEqual(RC.pendingMonths(t, '2026-01-30'), []);
  assert.deepEqual(RC.pendingMonths(t, '2026-01-31'), ['2026-01']);
  // התוכנה לא נפתחה עד מאי: ינואר–אפריל ממתינים, ומאי עוד לא הגיע (31.5)
  assert.deepEqual(RC.pendingMonths(t, '2026-05-30'), ['2026-01', '2026-02', '2026-03', '2026-04']);
  const d = RC.drafts([t], '2026-03-01', 0.18);
  assert.deepEqual(d.map(x => x.date), ['2026-01-31', '2026-02-28']);
  assert.deepEqual([d[0].net, d[0].vat, d[0].total], [1000, 180, 1180]);
  // הופק / דולג / מושהה / אחרי הסיום — לא מופיע
  assert.deepEqual(RC.pendingMonths({ ...t, issued: { '2026-01': 'x' }, skipped: ['2026-02'] }, '2026-03-31'), ['2026-03']);
  assert.deepEqual(RC.pendingMonths({ ...t, paused: true }, '2026-03-31'), []);
  assert.deepEqual(RC.pendingMonths({ ...t, endMonth: '2026-02' }, '2026-06-30'), ['2026-01', '2026-02']);
  // לא יותר מ-24 טיוטות פתוחות לתבנית
  assert.equal(RC.pendingMonths({ ...t, startMonth: '2020-01' }, '2026-06-30').length, RC.MAX_BACKLOG);
});

test('שירות: אין יצירה אוטומטית — רק הפקה באישור; כל חודש מופק פעם אחת; דילוג', async () => {
  const { svc, db } = await freshService();
  const t = await svc.saveRecurring(TEMPLATE);
  // קריאה לרשימה לא כותבת כלום
  const before = JSON.stringify((await db.load()).invoices);
  const r = await svc.getRecurring({ today: '2026-03-31' });
  assert.equal(r.drafts.length, 3);
  assert.equal(JSON.stringify((await db.load()).invoices), before);
  const inv = await svc.issueRecurring(t.id, '2026-01', { today: '2026-03-31' });
  assert.equal(inv.date, '2026-01-31');
  assert.equal(inv.total, 1180);
  assert.deepEqual(inv.recurring, { templateId: t.id, month: '2026-01' });
  await assert.rejects(svc.issueRecurring(t.id, '2026-01', { today: '2026-03-31' }), /אין טיוטה פתוחה/);
  await assert.rejects(svc.issueRecurring(t.id, '2026-04', { today: '2026-03-31' }), /אין טיוטה פתוחה/);
  await svc.skipRecurring(t.id, '2026-02', { today: '2026-03-31' });
  assert.deepEqual((await svc.getRecurring({ today: '2026-03-31' })).drafts.map(x => x.month), ['2026-03']);
  // תבנית שהופקו ממנה חשבוניות — לא נמחקת, ולא ניתן להזיז את ההתחלה אחרי חודש שהופק
  await assert.rejects(svc.deleteRecurring(t.id), /לעצור/);
  await assert.rejects(svc.saveRecurring({ ...TEMPLATE, startMonth: '2026-02' }, t.id), /חודש ההתחלה/);
  const paused = await svc.saveRecurring({ ...TEMPLATE, paused: true }, t.id);
  assert.equal(paused.paused, true);
  assert.deepEqual(paused.issued, { '2026-01': inv.id });
  assert.equal((await svc.getRecurring({ today: '2026-03-31' })).drafts.length, 0);
  const fresh = await svc.saveRecurring({ ...TEMPLATE, customer: 'כולל' });
  assert.equal(await svc.deleteRecurring(fresh.id), true);
});

test('הפקה בתקופה נעולה נדחית, והתבנית לא מסומנת', async () => {
  const { svc } = await freshService();
  await svc.saveSettings({ business: { name: 'משרד לדוגמה', taxId: '123456782' }, vatRate: 0.18, lockDate: '2026-01-31' });
  const t = await svc.saveRecurring(TEMPLATE);
  await assert.rejects(svc.issueRecurring(t.id, '2026-01', { today: '2026-02-28' }), /נעולה/);
  assert.deepEqual((await svc.getRecurring({ today: '2026-02-28' })).drafts.map(x => x.month), ['2026-01', '2026-02']);
});

test('השלמת לקוחות: שם ו-ע.מ, לפי שכיחות; חיפוש בכל המסמכים; שכפול', async () => {
  const { svc } = await freshService();
  const a = await svc.createInvoice({ customer: 'ישיבת אור התורה', customerTaxId: '515555555', date: '2026-07-01', items: [{ description: 'סט משנה ברורה', quantity: 2, unitPrice: 300 }] });
  await svc.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-02', items: [{ description: 'כריכה', quantity: 1, unitPrice: 50 }] });
  const q = await svc.createSalesDoc('quote', { customer: 'כולל חזון איש', date: '2026-07-03', items: [{ description: 'ארון ספרים', quantity: 1, unitPrice: 2000 }] });
  const dir = await svc.getCustomerDirectory();
  assert.deepEqual(dir[0], { name: 'ישיבת אור התורה', taxId: '515555555' });
  assert.equal(dir.length, 2);
  assert.deepEqual((await svc.searchDocuments('משנה')).map(r => r.id), [a.id]);
  assert.deepEqual((await svc.searchDocuments('חזון')).map(r => r.kind), ['quote']);
  assert.equal((await svc.searchDocuments(String(a.number))).some(r => r.id === a.id), true);
  assert.deepEqual(await svc.searchDocuments('  '), []);
  const dup = await svc.getDuplicateInput('invoice', a.id);
  assert.deepEqual(dup, { kind: 'invoice', customer: 'ישיבת אור התורה', customerTaxId: '515555555', vatExempt: false,
    items: [{ description: 'סט משנה ברורה', quantity: 2, unitPrice: 300, account: '4000', kind: 'goods' }] });
  assert.equal((await svc.getDuplicateInput('quote', q.id)).kind, 'quote');
  await assert.rejects(svc.getDuplicateInput('invoice', 'nope'), /לא נמצא/);
});

test('לוח הבוקר: חשבוניות חוזרות ממתינות — רק כשהנהלת החשבונות פתוחה ברישיון', () => {
  const t = { id: 't1', ...RC.validateTemplate(TEMPLATE, 0.18), issued: {}, skipped: [] };
  const data = { invoices: [], recurringInvoices: [t] };
  assert.equal(D.morningBrief(data, '2026-02-28', { sources: [] }).total, 0);
  const b = D.morningBrief(data, '2026-02-28', { sources: [], acct: true });
  assert.equal(b.total, 1);
  assert.equal(b.items[0].view, 'acct-invoices');
  assert.match(b.items[0].title, /2 חשבוניות חוזרות ממתינות לאישור/);
});

test('ערוצים: הרשאות, חשיפה ב-preload, ממשק וקיצורי מקלדת', () => {
  const { permissionFor } = require('../modules/econ/ipc');
  assert.equal(permissionFor('acct:getRecurring'), 'data.view');
  assert.equal(permissionFor('acct:saveRecurring'), 'data.edit');
  assert.equal(permissionFor('acct:issueRecurring'), 'data.edit');
  assert.equal(permissionFor('acct:skipRecurring'), 'data.edit');
  assert.equal(permissionFor('acct:deleteRecurring'), 'data.delete');
  assert.equal(permissionFor('acct:searchDocuments'), 'data.view');
  assert.equal(permissionFor('acct:getCustomerDirectory'), 'data.view');
  const ipc = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../modules/econ/preload.js'), 'utf8');
  for (const ch of ['getRecurring', 'saveRecurring', 'deleteRecurring', 'issueRecurring', 'skipRecurring', 'getCustomerDirectory', 'searchDocuments', 'getDuplicateInput']) {
    assert.match(ipc, new RegExp(`handle\\('acct:${ch}'`), ch);
    assert.match(preload, new RegExp(`'acct:${ch}'`), ch);
  }
  const ui = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/accounting.js'), 'utf8');
  assert.match(ui, /id="acctDocSearch"/);
  assert.match(ui, /data-rec-issue/);
  assert.match(ui, /data-dup-id/);
  assert.match(ui, /e\.altKey && \(e\.key === 'n'/);
  assert.match(ui, /e\.ctrlKey && e\.key === 'Enter'/);
  // אין הפקה אוטומטית: הקוד בממשק לא קורא ל-issueRecurring בלי לחיצה
  assert.equal((ui.match(/issueRecurring\(/g) || []).length, 1);
});
