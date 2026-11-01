// מבנה אחיד — מסמך הבסיס ב-D110 (שדות 1256/1257, עמודות 50–52 ו-53–72; PLAN שלב 10, 10.1ג):
// חשבונית שהומרה מתעודת משלוח, תעודת משלוח שהומרה מהזמנה, וזיכוי לפי החשבונית שהוא מזכה
const test = require('node:test');
const assert = require('node:assert/strict');
const UF = require('../modules/econ/core/uniformFile');
const A = require('../modules/econ/core/accounting');

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782', address: 'רחוב רבי עקיבא 1, בני ברק' };
const NOW = new Date(2026, 6, 15, 9, 5).getTime();
const item = (n) => [{ description: 'סט שס', quantity: 1, unitPrice: n, lineNet: n, account: '4000' }];

function sampleData() {
  const invoices = [
    { id: 'i1', number: 1, date: '2026-07-01', customer: 'ישיבת אור התורה', net: 1000, vat: 180, total: 1180, status: 'open',
      createdAt: '2026-07-01T08:00:00.000Z', items: item(1000), sourceDoc: { kind: 'delivery', id: 'd7', number: 7 } },
    { id: 'i2', number: 2, date: '2026-07-02', customer: 'כולל חזון איש', net: 50, vat: 9, total: 59, status: 'open',
      createdAt: '2026-07-02T08:00:00.000Z', items: item(50) },
    { id: 'i3', number: 3, date: '2026-07-03', customer: 'מהצעת מחיר', net: 10, vat: 1.8, total: 11.8, status: 'open',
      createdAt: '2026-07-03T08:00:00.000Z', items: item(10), sourceDoc: { kind: 'quote', id: 'q1', number: 4 } },
    { id: 'i4', number: 4, date: '2026-07-04', customer: 'עוסק פטור', net: 100, vat: 0, total: 100, vatExempt: true, status: 'open',
      createdAt: '2026-07-04T08:00:00.000Z', items: item(100) },
  ];
  const salesDocs = [
    { id: 'd7', kind: 'delivery', number: 7, date: '2026-06-30', customer: 'ישיבת אור התורה', net: 1000, vat: 180, total: 1180, status: 'open',
      createdAt: '2026-06-30T08:00:00.000Z', items: item(1000), sourceDoc: { kind: 'order', id: 'o3', number: 3 } },
    { id: 'c1', kind: 'credit', number: 1, date: '2026-07-05', customer: 'כולל חזון איש', invoiceId: 'i2', invoiceNumber: 2, net: 50, vat: 9, total: 59,
      status: 'open', createdAt: '2026-07-05T08:00:00.000Z', items: item(50) },
    { id: 'c2', kind: 'credit', number: 2, date: '2026-07-06', customer: 'עוסק פטור', invoiceId: 'i4', invoiceNumber: 4, net: 100, vat: 0, total: 100,
      status: 'open', createdAt: '2026-07-06T08:00:00.000Z', items: item(100) },
  ];
  return { accounts: A.DEFAULT_CHART.map(a => ({ ...a })), journal: [], invoices, salesDocs, settings: {} };
}

function records(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) { out.push(buf.subarray(start, i)); start = i + 2; i++; }
  }
  return out;
}
const ascii = (b, from, to) => Buffer.from(b.subarray(from - 1, to)).toString('latin1');

test('D110: סוג ומספר מסמך הבסיס במקומם, ואורכי הרשומות לא השתנו', () => {
  const out = UF.buildUniformFile({ data: sampleData(), business: BUSINESS, range: { from: '2026-01-01', to: '2026-12-31' }, now: NOW, user: 'יעקב', primaryId: '123456789012345' });
  const d110 = records(out.dataTxt).filter(r => ascii(r, 1, 4) === 'D110');
  assert.ok(d110.every(r => r.length === UF.RECORD_LENGTHS.D110));
  // מפתח: סוג המסמך (1253) ומספרו (1254)
  const byDoc = new Map(d110.map(r => [`${ascii(r, 23, 25)}:${ascii(r, 26, 45).trim()}`, r]));
  const base = (key) => { const r = byDoc.get(key); assert.ok(r, key); return [ascii(r, 50, 52), ascii(r, 53, 72).trim()]; };
  assert.deepEqual(base('305:1'), ['200', '7'], 'חשבונית מתעודת משלוח 7');
  assert.deepEqual(base('200:7'), ['100', '3'], 'תעודת משלוח מהזמנה 3');
  assert.deepEqual(base('330:1'), ['305', '2'], 'זיכוי לחשבונית מס 2');
  assert.deepEqual(base('330:2'), ['300', '4'], 'זיכוי לחשבונית עסקה של עוסק פטור');
  assert.deepEqual(base('305:2'), ['000', ''], 'בלי מסמך בסיס — ריק');
  assert.deepEqual(base('305:3'), ['000', ''], 'הצעת מחיר אינה בקובץ — לא מסמך בסיס');
});
