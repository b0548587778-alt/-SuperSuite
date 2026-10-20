// ממצא 4 בדוח הבדיקה: שחזור גיבוי ישן החזיר את מוני המסמכים אחורה — מספרים שכבר נמסרו ללקוח / לרשות המסים / לבנק
// היו מוקצים שוב. ממצא 7: מחיר כולל מע"מ שלא מתאים לפריט נדחה בהודעה ברורה (לא "רשומה לא מאוזנת").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeDatabase, keepCounters } = require('../modules/econ/core/database');
const A = require('../modules/econ/core/accounting');
const { AccountingService } = require('../modules/econ/services/accountingService');
const { NpoService } = require('../modules/econ/services/npoService');

async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-counters-'));
  return initializeDatabase(dir);
}

test('keepCounters: כל מונה = הגדול מבין הגיבוי למה שכבר הוקצה', () => {
  const current = {
    settings: { invoiceSeq: 7, docSeq: { receipt: 3, credit: 1 } },
    invoices: [{ number: 9 }],
    salesDocs: [{ kind: 'receipt', number: 5 }, { kind: 'quote', number: 2 }],
    npo: { settings: { receiptSeq: 4 }, donations: [{ receipt: { number: 6 } }, { receipt: { external: true, number: null } }], masav: { refSeq: 2 }, standingOrders: [{ masavRef: '3' }] },
    gemach: { masav: { refSeq: 5 }, loans: [] },
    payments: { settings: { nextNumber: 4 }, requests: [{ number: 8 }] },
    realEstate: { seq: 2, cases: [{ no: 3 }] }
  };
  const backup = {
    settings: { invoiceSeq: 2, docSeq: { receipt: 1 }, vatRate: 0.18 },
    npo: { settings: { receiptSeq: 1, orgName: 'עמותת תפארת' }, masav: { refSeq: 0, batches: [] } },
    gemach: { masav: { refSeq: 9 } },
    payments: { settings: { nextNumber: 2, provider: 'x' } },
    realEstate: { seq: 1, cases: [] }
  };
  keepCounters(backup, current);
  assert.equal(backup.settings.invoiceSeq, 9, 'החשבונית הגבוהה במסד');
  assert.equal(backup.settings.vatRate, 0.18, 'שאר ההגדרות מהגיבוי');
  assert.deepEqual(backup.settings.docSeq, { receipt: 5, credit: 1, quote: 2 });
  assert.equal(backup.npo.settings.receiptSeq, 6);
  assert.equal(backup.npo.settings.orgName, 'עמותת תפארת');
  assert.equal(backup.npo.masav.refSeq, 3);
  assert.deepEqual(backup.npo.masav.batches, []);
  assert.equal(backup.gemach.masav.refSeq, 9, 'מונה גבוה יותר בגיבוי — נשאר');
  assert.equal(backup.payments.settings.nextNumber, 9, 'המספר הבא אחרי הדרישה 8');
  assert.equal(backup.payments.settings.provider, 'x');
  assert.equal(backup.realEstate.seq, 3);
});

test('keepCounters: נתונים פגומים במסד לא מפילים ולא מורידים מונה', () => {
  const backup = { settings: { invoiceSeq: 4 } };
  keepCounters(backup, { settings: { invoiceSeq: 'abc', docSeq: { __proto__x: 5, 'Bad Kind': 9 } }, invoices: [null, { number: -3 }, { number: 1.5 }], npo: null, salesDocs: 'x' });
  assert.equal(backup.settings.invoiceSeq, 4);
  assert.equal(backup.settings.docSeq, undefined, 'סוג מסמך לא תקין לא נכנס');
});

test('שחזור גיבוי ישן: החשבונית הבאה מקבלת מספר חדש — לא מספר שכבר הופק', async () => {
  const db = await freshDb();
  const acct = AccountingService;
  await acct.initialize(db);
  const item = [{ description: 'שיעורי תורה', quantity: 1, unitPrice: 100, kind: 'service' }];
  await acct.createInvoice({ customer: 'ישיבת אור החיים', items: item, date: '2026-10-01' });
  const old = await db.backup();
  const second = await acct.createInvoice({ customer: 'כולל בית יוסף', items: item, date: '2026-10-02' });
  assert.equal(second.number, 2);

  await db.restore(old);
  const after = await acct.createInvoice({ customer: 'קהילת שערי חסד', items: item, date: '2026-10-03' });
  assert.equal(after.number, 3, 'מספר 2 כבר נמסר ללקוח — לא מוקצה שוב');
});

test('שחזור גיבוי ישן: מספור הקבלות בעמותה לא חוזר אחורה', async () => {
  const db = await freshDb();
  await NpoService.initialize(db);
  await NpoService.saveSettings({ orgName: 'עמותת חסדי אבות', regNumber: '580000003' });
  const donation = (name) => NpoService.addDonation({ donorName: name, amount: 180, date: '2026-10-01', method: 'cash' });
  await donation('אברהם כהן');
  const old = await db.backup();
  const r2 = await donation('יצחק לוי');
  await db.restore(old);
  const r3 = await donation('יעקב פרידמן');
  const num = (d) => (d.receipt || (d.donation && d.donation.receipt) || {}).number;
  assert.equal(num(r2), 2);
  assert.equal(num(r3), 3, 'קבלה 2 כבר נמסרה לתורם');
});

test('שחזור למסד ריק (שחזור אחרי תקלה): המונים מהגיבוי', async () => {
  const db = await freshDb();
  const data = await db.load();
  await db.save({ ...data, settings: { ...data.settings, invoiceSeq: 12 } });
  const backup = await db.backup();
  const db2 = await freshDb();
  await db2.restore(backup);
  assert.equal((await db2.load()).settings.invoiceSeq, 12);
});

test('מחיר כולל מע"מ שאינו תואם לפריט — הודעה ברורה, ולא נוצרת חשבונית', async () => {
  const items = [{ description: 'מנוי שנתי', quantity: 1, unitPrice: 100 }];
  assert.throws(() => A.computeInvoice({ grossAgorot: 5000, items }, 0.18), /נמוך מהמחיר לפני מע"מ/);
  assert.throws(() => A.computeInvoice({ grossAgorot: 20000, items }, 0.18), /אינו תואם/);
  assert.equal(A.computeInvoice({ grossAgorot: 11800, items }, 0.18).total, 118);
  assert.equal(A.computeInvoice({ grossAgorot: 11801, items }, 0.18).total, 118.01, 'אגורה של עיגול — מותר');
  assert.equal(A.computeInvoice({ grossAgorot: 5000, vatExempt: true, items }, 0.18).total, 100, 'פטור — המחיר הכולל לא משפיע');

  const db = await freshDb();
  await AccountingService.initialize(db);
  const before = (await db.load()).invoices.length;
  await assert.rejects(AccountingService.createInvoice({ customer: 'משה גרין', items, grossAgorot: 5000, date: '2026-10-05' }), /נמוך מהמחיר לפני מע"מ/);
  assert.equal((await db.load()).invoices.length, before);
});
