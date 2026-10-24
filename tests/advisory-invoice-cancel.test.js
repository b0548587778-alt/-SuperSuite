// חשבונית עמלה שבוטלה בהנהלת החשבונות (עוסק פטור: ביטול הגבייה ואז ביטול החשבונית) לא חוסמת את התשלום בתיק:
// אפשר להפיק לו חשבונית חדשה או למחוק אותו, והמספר של החשבונית שבוטלה לא מוצג כחשבונית בתוקף.
// הערה בבדיקת הקוד 21.10.2026 (docs/audit-parts/audit-mortgage-realty.md, "הערות קטנות")
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const handlers = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_advcancel__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_advcancel__.js'] = {
  id: '/__electron_stub_advcancel__.js', filename: '/__electron_stub_advcancel__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });
// המסד נשאר פתוח עד סוף התהליך (אי אפשר למחוק ב-Windows) — tools/run-tests.js מוחק את התיקייה הזמנית בסוף
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-advcancel-'));

// ביטול החשבונית כמו שעושים במסך החשבוניות: קודם הגבייה (הקבלה), אחר כך החשבונית
async function cancelInBooks(invoiceId) {
  await handlers['acct:unrecordPayment'](ev(71), invoiceId);
  const inv = await handlers['acct:cancelInvoice'](ev(71), invoiceId);
  assert.equal(inv.status, 'cancelled');
}

// הכנה לפני כל הבדיקות (ולא כבדיקה ראשונה): כל בדיקה רצה גם לבד או בסדר אחר
test.before(async () => {
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev(71), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(71), 'menahel', 'menahel-strong-pass-1');
});

test('ייעוץ משכנתאות: אחרי ביטול חשבונית העמלה — הפקה מחדש ומחיקה של התשלום', async () => {
  const c = await handlers['madv:createClient'](ev(71), { name: 'משפחת פרידמן', requestedAmount: 900000, feeType: 'fixed', feeValue: 3000 });
  const p1 = (await handlers['madv:addFeePayment'](ev(71), c.id, { date: '2026-10-05', amount: 1000, method: 'transfer' })).payment;
  const p2 = (await handlers['madv:addFeePayment'](ev(71), c.id, { date: '2026-10-06', amount: 500, method: 'check' })).payment;

  const first = await handlers['madv:issueFeeInvoice'](ev(71), c.id, p1.id, { confirmed: true, exempt: true });
  await assert.rejects(handlers['madv:issueFeeInvoice'](ev(71), c.id, p1.id, { confirmed: true, exempt: true }), /כבר הופקה/);
  await cancelInBooks(first.id);

  let pay = (await handlers['madv:getOverview'](ev(71))).clients.find(x => x.id === c.id).feePayments.find(x => x.id === p1.id);
  assert.equal(pay.invoiceNumber, null, 'חשבונית שבוטלה לא מוצגת כחשבונית בתוקף');
  assert.equal(pay.cancelledInvoice, first.number);

  const second = await handlers['madv:issueFeeInvoice'](ev(71), c.id, p1.id, { confirmed: true, exempt: true });
  assert.notEqual(second.number, first.number);
  assert.equal(second.total, 1000);
  pay = (await handlers['madv:getOverview'](ev(71))).clients.find(x => x.id === c.id).feePayments.find(x => x.id === p1.id);
  assert.equal(pay.invoiceNumber, second.number);
  assert.equal(pay.cancelledInvoice, null);
  await assert.rejects(handlers['madv:deleteFeePayment'](ev(71), c.id, p1.id), /הופקה חשבונית/, 'החשבונית החדשה בתוקף — חוסמת');

  // תשלום שני: חשבונית שבוטלה, ואז מחיקת התשלום
  const third = await handlers['madv:issueFeeInvoice'](ev(71), c.id, p2.id, { confirmed: true, exempt: true });
  await cancelInBooks(third.id);
  await handlers['madv:deleteFeePayment'](ev(71), c.id, p2.id);
  const left = (await handlers['madv:getOverview'](ev(71))).clients.find(x => x.id === c.id).feePayments;
  assert.deepEqual(left.map(x => x.id), [p1.id]);
});

test('תיווך (עוסק פטור): אחרי ביטול חשבונית דמי התיווך — הפקה מחדש ומחיקה של התשלום', async () => {
  await handlers['rlty:saveSettings'](ev(71), { brokerName: 'משרד תיווך', vatExempt: true });
  const seller = await handlers['rlty:createClient'](ev(71), { name: 'משפחת גולדברג', role: 'seller' });
  const buyer = await handlers['rlty:createClient'](ev(71), { name: 'משפחת וייס', role: 'buyer' });
  const prop = await handlers['rlty:createProperty'](ev(71), { city: 'ירושלים', street: 'רחוב בר אילן 3', asking: 2500000, ownerClientId: seller.id });
  const d = await handlers['rlty:createDeal'](ev(71), { propertyId: prop.id, buyerClientId: buyer.id, sellerClientId: seller.id, stage: 'contract' });
  await handlers['rlty:setCommissions'](ev(71), d.id, { buyer: { type: 'fixed', value: 10000 }, seller: { type: 'fixed', value: 8000 } });
  const pb = (await handlers['rlty:addCommissionPayment'](ev(71), d.id, { side: 'buyer', date: '2026-10-07', amount: 10000, method: 'transfer' })).payment;
  const ps = (await handlers['rlty:addCommissionPayment'](ev(71), d.id, { side: 'seller', date: '2026-10-08', amount: 8000, method: 'check' })).payment;

  const first = await handlers['rlty:issueCommissionInvoice'](ev(71), d.id, pb.id, { confirmed: true });
  await cancelInBooks(first.id);
  const payOf = async (id) => (await handlers['rlty:getOverview'](ev(71))).deals.find(x => x.id === d.id).commissionPayments.find(x => x.id === id);
  let pay = await payOf(pb.id);
  assert.equal(pay.invoiceNumber, null);
  assert.equal(pay.cancelledInvoice, first.number);

  const second = await handlers['rlty:issueCommissionInvoice'](ev(71), d.id, pb.id, { confirmed: true });
  assert.notEqual(second.number, first.number);
  pay = await payOf(pb.id);
  assert.equal(pay.invoiceNumber, second.number);
  await assert.rejects(handlers['rlty:deleteCommissionPayment'](ev(71), d.id, pb.id), /הופקה חשבונית/);

  const third = await handlers['rlty:issueCommissionInvoice'](ev(71), d.id, ps.id, { confirmed: true });
  await cancelInBooks(third.id);
  await handlers['rlty:deleteCommissionPayment'](ev(71), d.id, ps.id);
  assert.equal(await payOf(ps.id), undefined);
});

test('הממשק מציין שהחשבונית בוטלה, ומציג שוב את כפתור ההפקה', () => {
  for (const f of ['mortgage-advisor.js', 'realty.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', f), 'utf8');
    assert.match(src, /p\.cancelledInvoice \? `<small class="muted">חשבונית \$\{esc\(p\.cancelledInvoice\)\} בוטלה<\/small>`/, f);
  }
});
