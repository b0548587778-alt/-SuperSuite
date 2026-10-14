// הוראות קבע (מעקב בלבד): לוח מצב חודשי, כישלונות ברצף, הפקת קבלה בסימון "התקבל", הרשאות ומחיקה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const S = require('../modules/econ/core/standingOrders');

const base = (extra = {}) => ({ id: 'a', ...S.validateStandingOrder({ donorName: 'יעקב לוי', amount: 100, dayOfMonth: 10, startMonth: '2026-07' }), history: [], ...extra });

test('ולידציה: סכום, יום, חודשים, קרן ות.ז', () => {
  assert.throws(() => S.validateStandingOrder({ donorName: '', amount: 10 }), /שם התורם/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 0 }), /הסכום/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 10, dayOfMonth: 32 }), /יום החיוב/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 10, startMonth: '2026-13' }), /חודש ההתחלה/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 10, startMonth: '2026-05', endMonth: '2026-04' }), /לפני/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 10, fundId: 'x' }), /הקרן/);
  assert.throws(() => S.validateStandingOrder({ donorName: 'א', amount: 10, donorId: '123456789' }), /ספרת ביקורת/);
  assert.equal(S.validateStandingOrder({ donorName: 'א', amount: 10.005 }).amount, 10.01);
});

test('יום חיוב בחודש קצר — היום האחרון בחודש', () => {
  assert.equal(S.dueDate('2026-02', 31), '2026-02-28');
  assert.equal(S.dueDate('2028-02', 30), '2028-02-29');
});

test('מצב חודשי: התקבל, נכשל, לא סומן, צפוי', () => {
  const o = base({ history: [{ month: '2026-07', status: 'received' }, { month: '2026-08', status: 'failed' }] });
  assert.equal(S.monthStatus(o, '2026-07', '2026-10-14'), 'received');
  assert.equal(S.monthStatus(o, '2026-08', '2026-10-14'), 'failed');
  assert.equal(S.monthStatus(o, '2026-09', '2026-10-14'), 'missed');
  assert.equal(S.monthStatus(o, '2026-10', '2026-10-05'), 'due');
  assert.equal(S.monthStatus(o, '2026-10', '2026-10-14'), 'missed', 'מועד ה-10 עבר');
  assert.equal(S.consecutiveFailures(o, '2026-10-14'), 3);
});

test('סיכום: צפוי מול התקבל, הוראה שהסתיימה לא נספרת', () => {
  const live = base({ history: [{ month: '2026-10', status: 'received' }] });
  const ended = base({ id: 'b', endMonth: '2026-08', amount: 50 });
  const s = S.summarize([live, ended], '2026-10-14');
  assert.equal(s.activeCount, 1);
  assert.equal(s.expected, 100);
  assert.equal(s.received, 100);
  assert.equal(s.rows.find(r => r.id === 'b').status, 'ended');
});

test('לא ניתן לסמן חודש מחוץ לתקופה או "התקבל" פעמיים', () => {
  const o = base({ endMonth: '2026-12', history: [{ month: '2026-07', status: 'received' }] });
  assert.throws(() => S.assertCanRecord(o, '2026-06', 'received'), /אינה פעילה/);
  assert.throws(() => S.assertCanRecord(o, '2027-01', 'received'), /אינה פעילה/);
  assert.throws(() => S.assertCanRecord(o, '2026-07', 'received'), /כבר נרשם/);
  assert.throws(() => S.assertCanRecord(o, '2026-08', 'other'), /סטטוס/);
  S.assertCanRecord(o, '2026-08', 'failed');
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_so = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_so__.js' : Module._resolveFilename_so.call(this, req, ...rest); };
require.cache['/__electron_stub_so__.js'] = {
  id: '/__electron_stub_so__.js', filename: '/__electron_stub_so__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: סימון "התקבל" מפיק קבלה רגילה, "נכשל" לא; צפייה בלבד לא מסמנת; הוראה עם קבלות לא נמחקת', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-so-')));
  await handlers['auth:setup'](ev(81), 'so_admin', 'so-strong-pass-2026');
  await handlers['auth:login'](ev(81), 'so_admin', 'so-strong-pass-2026');
  await handlers['npo:saveSettings'](ev(81), { orgName: 'עמותת תורה וחסד', sec46Number: '1234' });
  const o = await handlers['npo:saveStandingOrder'](ev(81), null, { donorName: 'אברהם כהן', donorId: '123456782', amount: 180, dayOfMonth: 5, startMonth: '2026-09' });
  const r = await handlers['npo:recordStandingPayment'](ev(81), o.id, '2026-09', 'received');
  assert.equal(r.donation.amount, 180);
  assert.equal(r.donation.date, '2026-09-05');
  assert.equal(r.donation.standingOrderId, o.id);
  assert.ok(r.donation.receipt.number > 0);
  const f = await handlers['npo:recordStandingPayment'](ev(81), o.id, '2026-10', 'failed');
  assert.equal(f.donation, null);
  await assert.rejects(handlers['npo:recordStandingPayment'](ev(81), o.id, '2026-09', 'received'), /כבר נרשם/);
  const ov = await handlers['npo:getOverview'](ev(81), 2026);
  assert.equal(ov.donations.length, 1, 'רק "התקבל" יוצר תרומה');
  const st = await handlers['npo:getStandingOrders'](ev(81), '2026-10-14');
  assert.equal(st.rows[0].failures, 1);
  await assert.rejects(handlers['npo:deleteStandingOrder'](ev(81), o.id), /חודש סיום/);
  AuthService.getSession(81).permissions = ['data.view'];
  await assert.rejects(handlers['npo:recordStandingPayment'](ev(81), o.id, '2026-11', 'received'), /אין הרשאה/);
});
