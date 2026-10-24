const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeDatabase } = require('../modules/econ/core/database');
const { AccountingService } = require('../modules/econ/services/accountingService');

async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
  const db = await initializeDatabase(dir);
  const svc = AccountingService;
  await svc.initialize(db);
  return { db, svc };
}

test('זרימה מלאה: חשבונית → גבייה → דוחות מאוזנים ומע"מ נכון', async () => {
  const { svc } = await freshDb();
  const inv = await svc.createInvoice({ customer: 'לקוח בדיקה', date: '2026-03-01', items: [{ description: 'ייעוץ', quantity: 2, unitPrice: 1000, kind: 'service' }] });
  assert.equal(inv.number, 1);
  assert.equal(inv.total, 2360);
  assert.equal(inv.vat, 360);
  await svc.recordPayment(inv.id, { date: '2026-03-10' });

  const r = await svc.getReports({ from: '2026-01-01', to: '2026-12-31' });
  assert.equal(r.trialBalance.balanced, true);
  assert.equal(r.balanceSheet.balanced, true);
  assert.equal(r.incomeStatement.totalRevenue, 2000);
  assert.deepEqual(r.vat, { outputVat: 360, inputVat: 0, netPayable: 360 });
  assert.equal(r.openInvoices, 0);
});

test('מספור חשבוניות רציף ושמירה אחרי הפעלה מחדש', async () => {
  const { db, svc } = await freshDb();
  await svc.createInvoice({ customer: 'א', items: [{ unitPrice: 10 }] });
  const second = await svc.createInvoice({ customer: 'ב', items: [{ unitPrice: 10 }] });
  assert.equal(second.number, 2);
  const again = AccountingService; // same singleton, reloads from DB
  const invoices = await again.getInvoices();
  assert.equal(invoices.length, 2);
  assert.ok(db);
});

test('רשומה לא מאוזנת נדחית ולא נשמרת', async () => {
  const { db, svc } = await freshDb();
  await assert.rejects(svc.createEntry({ date: '2026-01-01', lines: [{ account: '1000', debit: 5 }, { account: '4000', credit: 4 }] }), /לא מאוזנת/);
  assert.equal((await svc.getJournal()).length, 0);
  void db;
});

test('ביטול רשומה יוצר רשומת היפוך ומאזן נשאר מאוזן', async () => {
  const { svc } = await freshDb();
  const e = await svc.createEntry({ date: '2026-01-02', description: 'מכירה', lines: [{ account: '1000', debit: 300 }, { account: '4900', credit: 300 }] });
  await svc.reverseEntry(e.id);
  await assert.rejects(svc.reverseEntry(e.id), /כבר בוטלה/);
  // טווח פתוח: רשומת ההיפוך מקבלת את תאריך היום — טווח סגור ב-2026 נכשל מ-1.1.2027 (בדיקת קוד 23.10.2026, ממצא 44)
  const r = await svc.getReports({ from: '2026-01-01' });
  assert.equal(r.incomeStatement.totalRevenue, 0);
  assert.equal(r.trialBalance.balanced, true);
});

test('חשבונית לא ניתנת ליצירה בלי לקוח', async () => {
  const { svc } = await freshDb();
  await assert.rejects(svc.createInvoice({ customer: '', items: [{ unitPrice: 1 }] }), /לקוח/);
});

test('שיעור מע"מ ניתן לשינוי והמנוע משתמש בו', async () => {
  const { svc } = await freshDb();
  await svc.setVatRate(0.17);
  const inv = await svc.createInvoice({ customer: 'ג', items: [{ unitPrice: 100 }] });
  assert.equal(inv.vat, 17);
  await assert.rejects(svc.setVatRate(1.5), /לא תקין/);
});

test('נעילת תקופה: חוסמת רישום, ביטול וגבייה לפני תאריך הנעילה', async () => {
  const { svc } = await freshDb();
  await svc.saveSettings({ business: { name: 'עסק בדיקה' }, vatRate: 0.18, lockDate: '2026-03-31' });
  await assert.rejects(svc.createEntry({ date: '2026-03-15', lines: [{ account: '1000', debit: 1 }, { account: '4900', credit: 1 }] }), /נעולה/);
  const open = await svc.createEntry({ date: '2026-04-02', lines: [{ account: '1000', debit: 1 }, { account: '4900', credit: 1 }] });
  const rev = await svc.reverseEntry(open.id); // רשומה אחרי הנעילה ניתנת לביטול
  assert.ok(rev.reversalOf === open.id);
  const inv = await svc.createInvoice({ customer: 'ד', date: '2026-04-03', items: [{ unitPrice: 10 }] });
  assert.equal(inv.total, 11.8);
  await assert.rejects(svc.recordPayment(inv.id, { date: '2026-03-01' }), /נעולה/);
});

test('הגדרות עסק: שם חובה, ונעילה מתבטלת כשהשדה ריק', async () => {
  const { svc } = await freshDb();
  await assert.rejects(svc.saveSettings({ business: { name: '' } }), /שם העסק/);
  await assert.rejects(svc.saveSettings({ business: { name: 'א' }, lockDate: '31/03/2026' }), /נעילה לא תקין/);
  await svc.saveSettings({ business: { name: 'א' }, lockDate: '2026-03-31' });
  const s1 = await svc.getSettings();
  assert.equal(s1.lockDate, '2026-03-31');
  await svc.saveSettings({ business: { name: 'א' }, lockDate: '' });
  assert.equal((await svc.getSettings()).lockDate, '');
});

test('ייצוא: שורות יומן מפורטות ומאזן בוחן עם כותרות בעברית', async () => {
  const { svc } = await freshDb();
  await svc.createInvoice({ customer: 'ה', date: '2026-05-01', items: [{ unitPrice: 100 }] });
  const j = await svc.getExportData('journal', {});
  assert.equal(j.headers[0], 'תאריך');
  assert.equal(j.rows.length, 3); // חובה לקוחות, זכות הכנסה, זכות מע"מ
  const tb = await svc.getExportData('trialBalance', {});
  assert.ok(tb.rows.length >= 3);
  await assert.rejects(svc.getExportData('bogus', {}), /לא נתמך/);
});

test('ביטול חשבונית: חשבונית זיכוי מאפסת הכנסה ומע"מ, והמאזן נשאר מאוזן', async () => {
  const { svc } = await freshDb();
  const inv = await svc.createInvoice({ customer: 'ביטול', date: '2026-02-01', items: [{ unitPrice: 1000 }] });
  await svc.cancelInvoice(inv.id);
  await assert.rejects(svc.cancelInvoice(inv.id), /כבר בוטלה/);
  // טווח פתוח: חשבונית הזיכוי נרשמת בתאריך היום (ממצא 44 — טווח סגור ב-2026 נכשל מ-1.1.2027)
  const r = await svc.getReports({ from: '2026-01-01' });
  assert.equal(r.incomeStatement.totalRevenue, 0);
  assert.equal(r.vat.outputVat, 0);
  assert.equal(r.openInvoices, 0);
  assert.equal(r.trialBalance.balanced, true);
  assert.equal(r.balanceSheet.balanced, true);
  const list = await svc.getInvoices();
  assert.equal(list[0].status, 'cancelled');
});

test('חשבונית ששולמה לא מבוטלת ישירות', async () => {
  const { svc } = await freshDb();
  const inv = await svc.createInvoice({ customer: 'שולם', date: '2026-02-01', items: [{ unitPrice: 100 }] });
  await svc.recordPayment(inv.id, { date: '2026-02-10' });
  await assert.rejects(svc.cancelInvoice(inv.id), /שולמה/);
});

test('גיול חייבים: חלוקה לדליים לפי גיל החשבונית', async () => {
  const { svc } = await freshDb();
  await svc.createInvoice({ customer: 'צעיר', date: '2026-09-20', items: [{ unitPrice: 100 }] });   // 20 יום
  await svc.createInvoice({ customer: 'בינוני', date: '2026-07-15', items: [{ unitPrice: 200 }] }); // ~87 יום
  await svc.createInvoice({ customer: 'ישן', date: '2026-01-01', items: [{ unitPrice: 300 }] });    // >90 יום
  const r = await svc.getReports({ from: '2026-01-01', to: '2026-10-10' });
  const [a, b, c, d] = r.aged.buckets;
  assert.equal(a.count, 1); assert.equal(a.total, 118);
  assert.equal(c.count, 1); assert.equal(c.total, 236);
  assert.equal(d.count, 1); assert.equal(d.total, 354);
  assert.equal(r.aged.items[0].customer, 'ישן');
});

test('מחירון: הוספה, חישוב לפי שיעור המע"מ הפעיל, מחיקה, וחישוב חי', async () => {
  const { svc } = await freshDb();
  const p = await svc.addProduct({ name: 'שירות תחזוקה', kind: 'service', cost: 100, markupPct: 50 });
  let list = await svc.getProducts();
  assert.equal(list[0].pricing.priceInc, 177);
  await svc.setVatRate(0.17);
  list = await svc.getProducts();
  assert.equal(list[0].pricing.vat, 25.5);
  const live = await svc.calcPrice({ cost: 200, markupPct: 10, vatExempt: true });
  assert.equal(live.priceInc, 220);
  await svc.deleteProduct(p.id);
  assert.equal((await svc.getProducts()).length, 0);
  await assert.rejects(svc.addProduct({ name: '' }), /שם/);
});

test('ביטול חשבונית הוא אטומי: כשלון באמצע לא משאיר רשומת ביטול בלי עדכון החשבונית', async () => {
  const { db, svc } = await freshDb();
  const inv = await svc.createInvoice({ customer: 'אטומיות', date: '2026-02-01', items: [{ unitPrice: 100 }] });
  const realSave = db.save.bind(db);
  let calls = 0;
  db.save = async (v) => { calls += 1; if (calls === 1) throw new Error('כשל מדומה בשמירה'); return realSave(v); };
  await assert.rejects(svc.cancelInvoice(inv.id), /כשל מדומה/);
  db.save = realSave;
  const [after] = await svc.getInvoices();
  assert.equal(after.status, 'open', 'החשבונית חייבת להישאר פתוחה');
  const journal = await svc.getJournal({});
  assert.equal(journal.filter(e => e.reversalOf).length, 0, 'לא אמורה להירשם רשומת ביטול');
  // וניתן לבטל אחר כך כרגיל
  await svc.cancelInvoice(inv.id);
  assert.equal((await svc.getInvoices())[0].status, 'cancelled');
});

// בדיקת קוד 23.10.2026, ממצא 44 ("פצצת תאריך"): הבדיקות של ביטול רשומה וביטול חשבונית נכשלו מ-1.1.2027,
// כי ההיפוך נרשם בתאריך היום והטווח בבדיקה היה סגור ב-2026. כאן "היום" הוא 5.1.2027 (שעון מוזרק)
test('ביטול בשנה שאחרי הרשומה: ההיפוך בתאריך היום, וטווח פתוח מאוזן גם בשנה הבאה', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2027, 0, 5, 10, 0) });
  const { svc } = await freshDb();
  const e = await svc.createEntry({ date: '2026-12-20', description: 'מכירה', lines: [{ account: '1000', debit: 300 }, { account: '4900', credit: 300 }] });
  const rev = await svc.reverseEntry(e.id);
  assert.equal(rev.date, '2027-01-05', 'ההיפוך — בתאריך היום (המקומי)');
  const open = await svc.getReports({ from: '2026-01-01' });
  assert.equal(open.incomeStatement.totalRevenue, 0);
  assert.equal(open.trialBalance.balanced, true);
  // וזו הסיבה שהטווח הסגור נכשל: ההכנסה ב-2026, ההיפוך ב-2027
  const closed = await svc.getReports({ from: '2026-01-01', to: '2026-12-31' });
  assert.equal(closed.incomeStatement.totalRevenue, 300);
  const inv = await svc.createInvoice({ customer: 'שנה הבאה', date: '2026-12-21', items: [{ unitPrice: 1000 }] });
  const cancelled = await svc.cancelInvoice(inv.id);
  assert.equal(cancelled.cancelledAt, '2027-01-05');
  const r = await svc.getReports({ from: '2026-01-01' });
  assert.equal(r.incomeStatement.totalRevenue, 0);
  assert.equal(r.vat.outputVat, 0);
  assert.equal(r.balanceSheet.balanced, true);
});
