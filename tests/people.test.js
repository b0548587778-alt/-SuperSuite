// מאגר אנשים מאוחד: שיוך לפי ת.ז, שיוך לפי שם רק כשהוא חד-משמעי, חיסיון נזקקים, חיפוש וכרטיס, ו-IPC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const P = require('../modules/econ/core/people');

const loan = (o) => ({ id: 'l1', borrowerName: 'שמעון גרוס', borrowerId: '000000026', amount: 1000, status: 'active', installments: 1, issueDate: '2026-01-01',
  schedule: [{ seq: 1, dueDate: '2026-02-01', amountAg: 100000, paidAg: 0 }], guarantors: [], ...o });
const DATA = {
  npo: {
    donations: [
      { id: 'd1', donorName: 'יעקב כהן', donorId: '000000018', amount: 100, date: '2026-01-01', status: 'active', receipt: { number: 1 } },
      { id: 'd2', donorName: 'יעקב  כהן', donorId: '', amount: 50.1, date: '2026-02-01', status: 'active', receipt: { number: 2 } },
      { id: 'd3', donorName: 'יעקב כהן', donorId: '', amount: 999, date: '2026-03-01', status: 'cancelled', receipt: { number: 3 } },
      { id: 'd4', donorName: 'משה לוי', donorId: '', amount: 70, date: '2026-02-01', status: 'active', receipt: { number: null, external: true, externalNumber: 'R-9' } }
    ],
    standingOrders: [], memorials: [{ id: 'm1', name: 'ר׳ אברהם', contactName: 'משה לוי', contactPhone: '050-1111111' }]
  },
  gemach: { loans: [loan({ guarantors: [{ name: 'יעקב כהן', id: '18', phone: '' }] })], deposits: [{ id: 'p1', depositorName: 'שמעון גרוס', amount: 500, date: '2026-01-05' }] },
  chesed: {
    beneficiaries: [
      { id: 'b1', familyName: 'כהן', headName: 'יעקב כהן', idNumber: '000000018', tier: 'confidential', active: true },
      { id: 'b2', familyName: 'לוי', headName: 'משה לוי', tier: 'regular', active: true }
    ],
    volunteers: [{ id: 'v1', name: 'משה לוי', phone: '050-1111111', active: true }]
  }
};
const opts = { today: '2026-10-14' };
const find = (r, key) => r.rows.find(x => x.key === key);

test('שיוך לפי ת.ז (כולל ת.ז קצרה), ותרומה בלי ת.ז משויכת לפי שם כשהשם חד-משמעי', () => {
  const r = P.search(DATA, '', opts);
  const y = find(r, 'id:000000018');
  assert.equal(y.donationsCount, 2, 'מבוטלת לא נספרת');
  assert.equal(y.donationsTotal, 150.1);
  assert.equal(y.activeGuarantees, 1, 'ערב עם ת.ז "18" — אותו אדם');
  assert.equal(y.late, true);
  assert.equal(y.name, 'יעקב כהן', 'רווחים כפולים מנורמלים');
  const c = P.card(DATA, 'id:000000018', opts);
  assert.deepEqual(c.donations.map(d => [d.id, d.byName]), [['d3', true], ['d2', true], ['d1', false]]);
});

test('שם שמתאים לשני אנשים עם ת.ז שונות — לא משויך, מסומן "כמה אפשרויות"', () => {
  const data = structuredClone(DATA);
  data.npo.donations.push({ id: 'd5', donorName: 'יעקב כהן', donorId: '000000026', amount: 1, date: '2026-04-01', status: 'active', receipt: { number: 5 } });
  const r = P.search(data, 'יעקב', opts);
  const nameOnly = find(r, 'name:יעקב כהן');
  assert.ok(nameOnly && nameOnly.nameOnly && nameOnly.ambiguous);
  assert.equal(find(r, 'id:000000018').donationsCount, 1);
});

test('נזקק חסוי — רק למורשה; נזקק רגיל — לכולם', () => {
  assert.ok(!find(P.search(DATA, '', opts), 'id:000000018').roles.includes('beneficiary'));
  assert.ok(find(P.search(DATA, '', { ...opts, canSeeConfidential: true }), 'id:000000018').roles.includes('beneficiary'));
  assert.equal(P.card(DATA, 'id:000000018', opts).beneficiary.length, 0);
  const levy = find(P.search(DATA, '', opts), 'name:משה לוי');
  assert.deepEqual(levy.roles.sort(), ['beneficiary', 'donor', 'memorial', 'volunteer']);
});

test('חיפוש לפי שם, ת.ז וטלפון; ספרות בודדות לא מחפשות במספרים', () => {
  assert.deepEqual(P.search(DATA, 'לוי', opts).rows.map(x => x.name), ['משה לוי']);
  assert.deepEqual(P.search(DATA, '1111111', opts).rows.map(x => x.name), ['משה לוי']);
  assert.deepEqual(P.search(DATA, '000026', opts).rows.map(x => x.name), ['שמעון גרוס']);
  assert.equal(P.search(DATA, '05', opts).total, 0);
});

test('לווה ומפקיד: אותו שם, ההפקדה (בלי ת.ז) משויכת ללווה', () => {
  const c = P.card(DATA, 'id:000000026', opts);
  assert.equal(c.loans.length, 1);
  assert.equal(c.loans[0].lateCount, 1);
  assert.equal(c.deposits.length, 1);
  assert.equal(c.activeLoansOutstanding, 1000);
  assert.throws(() => P.card(DATA, 'id:nope', opts), /לא נמצא/);
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_pp = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_pp__.js' : Module._resolveFilename_pp.call(this, req, ...rest); };
require.cache['/__electron_stub_pp__.js'] = {
  id: '/__electron_stub_pp__.js', filename: '/__electron_stub_pp__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: חיפוש וכרטיס מנתונים אמיתיים; נזקק חסוי מוסתר ממי שאינו מנהל', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pp-')));
  await handlers['auth:setup'](ev(97), 'pp_admin', 'pp-strong-pass-2026');
  await handlers['auth:login'](ev(97), 'pp_admin', 'pp-strong-pass-2026');
  await handlers['npo:saveSettings'](ev(97), { orgName: 'עמותת תורה וחסד' });
  await handlers['npo:addDonation'](ev(97), { donorName: 'אהרן ברגר', donorId: '000000018', amount: 180, date: '2026-09-01' });
  await handlers['chesed:addBeneficiary'](ev(97), { familyName: 'ברגר', headName: 'אהרן ברגר', idNumber: '000000018', familySize: 4, tier: 'confidential' });
  let r = await handlers['people:search'](ev(97), 'ברגר');
  assert.equal(r.total, 1);
  assert.ok(r.rows[0].roles.includes('beneficiary'), 'מנהל רואה');
  AuthService.getSession(97).permissions = ['data.view'];
  r = await handlers['people:search'](ev(97), 'ברגר');
  assert.deepEqual(r.rows[0].roles, ['donor']);
  const c = await handlers['people:getCard'](ev(97), r.rows[0].key);
  assert.equal(c.beneficiary.length, 0);
  assert.equal(c.donations[0].amount, 180);
  AuthService.getSession(97).permissions = [];
  await assert.rejects(handlers['people:search'](ev(97), ''), /אין הרשאה/);
});

test('שואל חפץ בגמ"ח מופיע בכרטיס, עם חפצים שטרם הוחזרו', () => {
  const data = structuredClone(DATA);
  data.gemach.items = [{ id: 'i1', name: 'עגלת תינוק' }];
  data.gemach.lendings = [
    { id: 'x1', itemId: 'i1', borrowerName: 'משה לוי', date: '2026-10-01', dueDate: '2026-10-10', returnedAt: '' },
    { id: 'x2', itemId: 'i1', borrowerName: 'משה לוי', date: '2026-08-01', dueDate: '', returnedAt: '2026-08-05' }
  ];
  const p = P.search(data, 'לוי', opts).rows[0];
  assert.ok(p.roles.includes('itemBorrower'));
  assert.equal(p.itemsOut, 1);
  const c = P.card(data, p.key, opts);
  assert.deepEqual(c.lendings.map(l => [l.item, l.overdue, l.returned]), [['עגלת תינוק', true, false], ['עגלת תינוק', false, true]]);
});
