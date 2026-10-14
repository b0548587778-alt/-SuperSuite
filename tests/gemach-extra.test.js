// הרחבות גמ"ח: תהליך בקשה (מעברים, אישור יוצר הלוואה), גמ"ח חפצים (השאלה, החזרה, פיקדון), ופיגורים לפי ערב.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const GX = require('../modules/econ/core/gemachExtra');

test('מעברי שלבים: אישור רק אחרי אימות ערבים; אין אימות בלי ערבים; הוכרעה — סופית', () => {
  const a = (status, guarantors = [{ name: 'א' }]) => ({ status, guarantors });
  assert.throws(() => GX.assertTransition(a('draft'), 'approved'), /לא ניתן לעבור/);
  assert.throws(() => GX.assertTransition(a('interview', []), 'verified'), /אין ערבים/);
  assert.throws(() => GX.assertTransition(a('approved'), 'rejected'), /לא ניתן לעבור/);
  assert.throws(() => GX.assertTransition(a('draft'), 'x'), /לא מוכר/);
  GX.assertTransition(a('verified'), 'approved');
  GX.assertTransition(a('draft'), 'rejected');
});

test('בקשה נבדקת בכללי ההלוואה כבר בשמירה', () => {
  assert.throws(() => GX.validateApplication({ borrowerName: 'א', amount: 0, installments: 1 }), /סכום/);
  assert.throws(() => GX.validateApplication({ borrowerName: 'א', amount: 100, installments: 1, borrowerId: '123456789' }), /ספרת ביקורת/);
  const v = GX.validateApplication({ borrowerName: 'יעקב', amount: 1000, installments: 10, guarantorsText: 'משה, 000000018, 050' });
  assert.equal(v.guarantors.length, 1);
});

test('חפצים: השאלה, פריט מושאל/בתיקון, החזרה עם ניכוי פיקדון', () => {
  const item = { id: 'i1', ...GX.validateItem({ name: 'עגלת תינוק', deposit: 200 }) };
  const l = GX.validateLending({ borrowerName: 'שרה', date: '2026-10-01', dueDate: '2026-10-20' }, item, []);
  assert.equal(l.depositHeld, 200, 'ברירת מחדל — הפיקדון של הפריט');
  assert.throws(() => GX.validateLending({ borrowerName: 'רבקה' }, item, [l]), /כבר מושאל/);
  assert.throws(() => GX.validateLending({ borrowerName: 'רבקה' }, { ...item, condition: 'repair' }, []), /בתיקון/);
  assert.throws(() => GX.validateLending({ borrowerName: 'רבקה', date: '2026-10-05', dueDate: '2026-10-01' }, item, []), /לפני/);
  assert.throws(() => GX.applyReturn(l, { date: '2026-10-10', depositReturned: 250 }), /לעלות על/);
  const r = GX.applyReturn(l, { date: '2026-10-10', depositReturned: 150, condition: 'worn' });
  assert.deepEqual([r.returnedAt, r.depositReturned, r.returnCondition], ['2026-10-10', 150, 'worn']);
  assert.throws(() => GX.applyReturn(r, {}), /כבר הוחזר/);
  const ov = GX.itemsOverview([item], [l], '2026-10-25');
  assert.equal(ov.overdueCount, 1);
  assert.equal(ov.depositsHeld, 200);
});

test('פיגורים לפי ערב: ערב לשתי הלוואות מאוחד לפי ת.ז, הלוואה בלי פיגור לא נכללת', () => {
  const sched = (paid) => [{ seq: 1, dueDate: '2026-09-01', amountAg: 50000, paidAg: paid }, { seq: 2, dueDate: '2026-11-01', amountAg: 50000, paidAg: 0 }];
  const loans = [
    { id: 'a', borrowerName: 'לווה א', status: 'active', schedule: sched(0), guarantors: [{ name: 'משה', id: '18', phone: '050' }] },
    { id: 'b', borrowerName: 'לווה ב', status: 'active', schedule: sched(20000), guarantors: [{ name: 'משה לוי', id: '000000018', phone: '' }, { name: 'דוד', id: '', phone: '' }] },
    { id: 'c', borrowerName: 'לווה ג', status: 'active', schedule: sched(50000), guarantors: [{ name: 'אהרן', id: '', phone: '' }] }
  ];
  const r = GX.arrearsByGuarantor(loans, '2026-10-14');
  assert.deepEqual(r.map(g => [g.name, g.loans.length, g.lateAmount]), [['משה', 2, 800], ['דוד', 1, 300]]);
  assert.equal(r[0].phone, '050');
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_gx = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_gx__.js' : Module._resolveFilename_gx.call(this, req, ...rest); };
require.cache['/__electron_stub_gx__.js'] = {
  id: '/__electron_stub_gx__.js', filename: '/__electron_stub_gx__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: בקשה עד אישור יוצרת הלוואה; שינוי ערבים מחזיר לראיון; חפץ — השאלה והחזרה', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gx-')));
  await handlers['auth:setup'](ev(103), 'gx_admin', 'gx-strong-pass-2026');
  await handlers['auth:login'](ev(103), 'gx_admin', 'gx-strong-pass-2026');
  const a = await handlers['gemach:saveApplication'](ev(103), null, { borrowerName: 'יעקב כהן', amount: 3000, installments: 3, guarantorsText: 'משה לוי, 000000018, 050-1' });
  assert.equal(a.status, 'draft');
  await handlers['gemach:moveApplication'](ev(103), a.id, 'interview');
  await handlers['gemach:moveApplication'](ev(103), a.id, 'verified');
  const ed = await handlers['gemach:saveApplication'](ev(103), a.id, { guarantorsText: 'משה לוי, 000000018, 050-1\nדוד, , 052' });
  assert.equal(ed.status, 'interview', 'ערבים השתנו אחרי אימות');
  await handlers['gemach:moveApplication'](ev(103), a.id, 'verified');
  const r = await handlers['gemach:moveApplication'](ev(103), a.id, 'approved', { issueDate: '2026-10-01' });
  assert.equal(r.loan.amount, 3000);
  assert.equal(r.loan.applicationId, a.id);
  assert.equal(r.loan.schedule.length, 3);
  assert.equal(r.loan.guarantors.length, 2);
  await assert.rejects(handlers['gemach:saveApplication'](ev(103), a.id, { amount: 1 }), /הוכרעה/);
  await assert.rejects(handlers['gemach:deleteApplication'](ev(103), a.id), /קשורה להלוואה/);
  let ov = await handlers['gemach:getOverview'](ev(103), '2026-10-14');
  assert.equal(ov.loans.length, 1);
  assert.equal(ov.applications[0].statusLabel, 'אושרה');

  const it = await handlers['gemach:saveItem'](ev(103), null, { name: 'מיטת תינוק', deposit: 100 });
  await handlers['gemach:lendItem'](ev(103), it.id, { borrowerName: 'רחל', date: '2026-10-01', dueDate: '2026-10-10' });
  await assert.rejects(handlers['gemach:lendItem'](ev(103), it.id, { borrowerName: 'לאה' }), /כבר מושאל/);
  ov = await handlers['gemach:getOverview'](ev(103), '2026-10-14');
  assert.equal(ov.items.overdueCount, 1);
  await handlers['gemach:returnItem'](ev(103), it.id, { date: '2026-10-12', condition: 'repair', depositReturned: 100 });
  ov = await handlers['gemach:getOverview'](ev(103), '2026-10-14');
  assert.equal(ov.items.rows[0].condition, 'repair');
  assert.equal(ov.items.lentCount, 0);
  await assert.rejects(handlers['gemach:deleteItem'](ev(103), it.id), /היסטוריית השאלות/);

  AuthService.getSession(103).permissions = ['data.view'];
  await assert.rejects(handlers['gemach:saveItem'](ev(103), null, { name: 'x' }), /אין הרשאה/);
  await assert.rejects(handlers['gemach:moveApplication'](ev(103), a.id, 'rejected'), /אין הרשאה/);
});
