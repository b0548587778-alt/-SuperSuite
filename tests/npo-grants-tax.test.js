// עמותה — הרחבות: מעקב תמיכות (מועד הגשה, מימון תואם, מסמכים) ומעקב דיווח ל"תרומות ישראל".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const N = require('../modules/econ/core/npo');

// ---------- לוגיקה ----------

test('תמיכה: מסמכים משורות, סימון "הוגש" נשמר לפי שם בעריכה, ומימון תואם באגורות', () => {
  const g = N.validateGrant({ source: 'משרד הרווחה', approved: 1000.01, matchingPercent: 25, documentsText: 'אישור ניהול תקין\nדוח כספי\nדוח כספי\n' });
  assert.deepEqual(g.documents.map(d => d.name), ['אישור ניהול תקין', 'דוח כספי'], 'כפילויות מסוננות');
  const prev = [{ name: 'דוח כספי', done: true }];
  const g2 = N.validateGrant({ source: 'א', documentsText: 'דוח כספי\nפרוטוקול ועד' }, prev);
  assert.deepEqual(g2.documents, [{ name: 'דוח כספי', done: true }, { name: 'פרוטוקול ועד', done: false }]);
  assert.equal(N.matchingRequired(g), 250, '25% מ-1000.01 מעוגל לאגורה');
  assert.throws(() => N.validateGrant({ source: 'א', matchingPercent: 120 }), /מימון התואם/);
  assert.throws(() => N.validateGrant({ source: 'א', deadline: '2026-13-40' }), /מועד ההגשה/);
});

test('התראות תמיכה: מועד שעבר, מועד קרוב, ומסמכים חסרים; תמיכה ששולמה לא מתריעה', () => {
  const grants = [
    { id: 'a', source: 'עירייה', status: 'requested', deadline: '2026-10-01', documents: [{ name: 'x', done: false }], approved: 0 },
    { id: 'b', source: 'משרד החינוך', status: 'requested', deadline: '2026-10-30', documents: [], approved: 0 },
    { id: 'c', source: 'קרן', status: 'requested', deadline: '2027-06-01', documents: [], approved: 0 },
    { id: 'd', source: 'שולם', status: 'paid', deadline: '2026-10-01', documents: [], approved: 0 }
  ];
  const al = N.grantAlerts(grants, '2026-10-14');
  assert.deepEqual(al.map(a => a.id), ['a', 'b']);
  assert.equal(al[0].overdue, true);
  assert.equal(al[0].missingDocuments, 1);
  assert.equal(al[1].soon, true);
});

test('תרומות ישראל: סטטוס לפי סעיף 46, ביטול אחרי דיווח דורש דיווח ביטול', () => {
  const d = { id: 'd1', amount: 100, donorId: '123456782', status: 'active', receipt: { number: 1, sec46: true } };
  assert.equal(N.taxStatus(d), 'pending');
  assert.equal(N.taxStatus({ ...d, receipt: { number: 2, sec46: false } }), 'not-required');
  assert.equal(N.taxStatus({ ...d, status: 'cancelled' }), 'not-required', 'בוטלה לפני דיווח');
  assert.throws(() => N.recordTaxReport(d, { registrationNumber: '!' }), /מספר הרישום/);
  const rep = N.recordTaxReport(d, { registrationNumber: '7788123' }, '2026-10-14');
  assert.equal(N.taxStatus(rep), 'reported');
  assert.throws(() => N.recordTaxReport(rep, { registrationNumber: '1234' }), /כבר נרשם/);
  const cancelled = { ...rep, status: 'cancelled' };
  assert.equal(N.taxStatus(cancelled), 'cancel-pending');
  const done = N.recordTaxReport(cancelled, {}, '2026-10-15');
  assert.equal(N.taxStatus(done), 'cancel-reported');
  assert.equal(done.taxReport.registrationNumber, '7788123', 'מספר הרישום המקורי נשמר');
  const sum = N.taxSummary([d, { ...d, id: 'x', donorId: '' }, cancelled]);
  assert.equal(sum.toReport, 3);
  assert.equal(sum.missingDonorId, 1);
});

// ---------- IPC ----------

const handlers = {};
let saveTarget = null;
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_npo2__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_npo2__.js'] = {
  id: '/__electron_stub_npo2__.js', filename: '/__electron_stub_npo2__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => (saveTarget ? { canceled: false, filePath: saveTarget } : { canceled: true }) }
  }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npo2-')));
  await handlers['auth:setup'](ev(id), 'npo2_admin', 'npo2-strong-pass-2026');
  await handlers['auth:login'](ev(id), 'npo2_admin', 'npo2-strong-pass-2026');
}

test('IPC: מסמך תמיכה מסומן ונשמר בעריכה; צפייה בלבד לא מסמנת', async () => {
  await freshLogin(91);
  const g = await handlers['npo:addGrant'](ev(91), { source: 'משרד הרווחה', year: 2026, documentsText: 'דוח כספי\nאישור ניהול תקין' });
  await handlers['npo:toggleGrantDocument'](ev(91), g.id, 1);
  const upd = await handlers['npo:updateGrant'](ev(91), g.id, { documentsText: 'אישור ניהול תקין\nפרוטוקול' });
  assert.deepEqual(upd.documents, [{ name: 'אישור ניהול תקין', done: true }, { name: 'פרוטוקול', done: false }]);
  AuthService.getSession(91).permissions = ['data.view'];
  await assert.rejects(handlers['npo:toggleGrantDocument'](ev(91), g.id, 0), /אין הרשאה/);
});

test('IPC: דיווח תרומות ישראל — רישום, ביטול, ייצוא רשימת עבודה', async () => {
  await freshLogin(92);
  await handlers['npo:saveSettings'](ev(92), { orgName: 'עמותת חסד', sec46Number: '4321' });
  const a = await handlers['npo:addDonation'](ev(92), { date: '2026-10-01', donorName: 'משה', donorId: '123456782', amount: 100 });
  const b = await handlers['npo:addDonation'](ev(92), { date: '2026-10-02', donorName: 'אהרן', amount: 50 });
  let o = await handlers['npo:getOverview'](ev(92), 2026);
  assert.equal(o.tax.toReport, 2);
  assert.equal(o.tax.missingDonorId, 1);
  await handlers['npo:recordTaxReport'](ev(92), a.id, { registrationNumber: '55500011' });
  await handlers['npo:cancelDonation'](ev(92), a.id);
  o = await handlers['npo:getOverview'](ev(92), 2026);
  assert.equal(o.donations.find(d => d.id === a.id).taxStatus, 'cancel-pending');
  saveTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npo2-csv-')), 't.csv');
  const r = await handlers['npo:exportCsv'](ev(92), 'tax', 2026);
  saveTarget = null;
  const csv = fs.readFileSync(r.path, 'utf8');
  assert.match(csv, /דיווח ביטול/);
  assert.match(csv, /55500011/);
  assert.match(csv, /אהרן.*חסר/, 'תורם בלי ת.ז מסומן');
  await handlers['npo:recordTaxReport'](ev(92), a.id, {});
  await handlers['npo:recordTaxReport'](ev(92), b.id, { registrationNumber: '55500012' });
  assert.equal((await handlers['npo:getOverview'](ev(92), 2026)).tax.toReport, 0);
});
