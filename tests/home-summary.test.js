// מסך הבית של המעטפת: מדדים ומשימות להיום (core/homeSummary.js), והערוצים שהמעטפת מפעילה בשם המודול הכלכלי
// (shellCall ב-ipc.js) — דרך אותו שומר: כניסה, הרשאה ורישיון. הכול באגורות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HS = require('../modules/econ/core/homeSummary');
const M = require('../modules/econ/core/memorials');
const H = require('../modules/econ/core/hebcal');

const ALL = { acct: true, npo: true, gemach: true };
const inv = (o) => ({ id: o.number, status: 'open', customer: 'משה כהן', ...o });

test('monthRanges — החודש עד היום, ואותה תקופה בחודש הקודם (בלי יום שלא קיים בו)', () => {
  assert.deepEqual(HS.monthRanges('2026-10-22'), { cur: { from: '2026-10-01', to: '2026-10-22' }, prev: { from: '2026-09-01', to: '2026-09-22' } });
  assert.deepEqual(HS.monthRanges('2026-03-31').prev, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(HS.monthRanges('2026-01-15').prev, { from: '2025-12-01', to: '2025-12-15' });
});

test('חשבונאות — הכנסות באגורות מול אותה תקופה בחודש הקודם; חשבונית פתוחה אחרי זיכוי, מועד לפי תנאי התשלום', () => {
  const data = {
    settings: { reports: { paymentTermsDays: 30 } },
    invoices: [
      inv({ number: 1, date: '2026-10-05', net: 1000, total: 1180 }),
      inv({ number: 2, date: '2026-09-10', net: 500.5, total: 590.59 }), // החודש הקודם, לפני ה-22
      inv({ number: 3, date: '2026-09-28', net: 300, total: 354, status: 'paid' }), // אחרי ה-22 בחודש הקודם — לא בהשוואה
      inv({ number: 4, date: '2026-08-01', net: 100, total: 118 }),
    ],
    salesDocs: [{ kind: 'credit', invoiceId: 1, total: 180, status: 'issued' }, { kind: 'credit', invoiceId: 4, total: 118, status: 'issued' }],
  };
  const s = HS.homeSummary(data, '2026-10-22', { acct: true });
  assert.equal(s.kpis.incomeMonth, 100000);
  assert.equal(s.kpis.incomePrevMonth, 50050);
  // חשבונית 4 זוכתה במלואה — לא פתוחה; 1 פתוחה ב-1,000 אחרי זיכוי; 2 פתוחה במלואה
  assert.equal(s.kpis.openInvoices, 2);
  assert.equal(s.kpis.openInvoicesAmount, 100000 + 59059);
  assert.deepEqual(s.invoices.map(i => [i.number, i.amount, i.dueDate, i.late]), [[2, 59059, '2026-10-10', true], [1, 100000, '2026-11-04', false]]);
});

test('עמותה — תרומות החודש באגורות בלי מבוטלות; גמ"ח — הלוואות פעילות ותשלום פתוח בשבוע הקרוב או בפיגור', () => {
  const data = {
    npo: { donations: [
      { date: '2026-10-01', amount: 180, status: 'active' }, { date: '2026-10-21', amount: 36.5 },
      { date: '2026-10-02', amount: 1000, status: 'cancelled' }, { date: '2026-09-30', amount: 500 },
    ] },
    gemach: { loans: [
      { status: 'active', borrowerName: 'אברהם לוי', schedule: [{ dueDate: '2026-10-01', amountAg: 50000, paidAg: 50000 }, { dueDate: '2026-10-25', amountAg: 50000, paidAg: 10000 }] },
      { status: 'active', borrowerName: 'יעקב דוד', schedule: [{ dueDate: '2026-10-15', amountAg: 20000, paidAg: 0 }] },
      { status: 'active', borrowerName: 'רחוק', schedule: [{ dueDate: '2026-12-01', amountAg: 20000, paidAg: 0 }] },
      { status: 'closed', borrowerName: 'נפרעה', schedule: [{ dueDate: '2026-10-20', amountAg: 1, paidAg: 0 }] },
    ] },
  };
  const s = HS.homeSummary(data, '2026-10-22', { npo: true, gemach: true });
  assert.equal(s.kpis.donationsMonth, 21650);
  assert.equal(s.kpis.activeLoans, 3, 'רק הלוואות בסטטוס פעיל');
  assert.deepEqual(s.loans.map(l => [l.borrowerName, l.amount, l.dueDate, l.late]),
    [['יעקב דוד', 20000, '2026-10-15', true], ['אברהם לוי', 40000, '2026-10-25', false]]);
});

test('תחום סגור (רישיון או הרשאה) לא מחושב בכלל — המדד חסר, והרשימה ריקה', () => {
  const data = {
    invoices: [inv({ number: 1, date: '2026-10-05', net: 1000, total: 1180 })],
    npo: { donations: [{ date: '2026-10-01', amount: 180 }] },
    gemach: { loans: [{ status: 'active', borrowerName: 'א', schedule: [{ dueDate: '2026-10-20', amountAg: 100, paidAg: 0 }] }] },
  };
  const none = HS.homeSummary(data, '2026-10-22', {});
  assert.deepEqual(none.kpis, {});
  assert.deepEqual([none.invoices, none.loans, none.yahrzeits], [[], [], []]);
  const npoOnly = HS.homeSummary(data, '2026-10-22', { npo: true });
  assert.deepEqual(Object.keys(npoOnly.kpis), ['donationsMonth']);
  assert.equal('incomeMonth' in npoOnly.kpis, false, 'בלי חשבונאות — אין הכנסות');
  assert.throws(() => HS.homeSummary(data, '22.10.2026', ALL), /תאריך/);
});

test('יארצייטים בשבוע הקרוב — רק שדות התצוגה, בלי טלפון ואיש קשר', { skip: !H.available() }, () => {
  const memorial = { id: 'm1', ...M.validateMemorial({ name: 'ר׳ יצחק', parentName: 'שרה', hebrewDay: 23, hebrewMonth: 'Tishri', hebrewYear: 5786,
    contactName: 'בנו', contactPhone: '050-0000000' }) };
  const s = HS.homeSummary({ npo: { memorials: [memorial] } }, '2027-10-20', { npo: true });
  assert.equal(s.yahrzeits.length, 1);
  assert.deepEqual(Object.keys(s.yahrzeits[0]).sort(), ['daysLeft', 'hebrew', 'name', 'parentName', 'uncertain']);
  assert.equal(s.yahrzeits[0].daysLeft, 4);
  assert.equal(JSON.stringify(s).includes('050'), false, 'מספר הטלפון לא יוצא למסך הבית');
  assert.equal(HS.homeSummary({ npo: { memorials: [memorial] } }, '2027-09-01', { npo: true }).yahrzeits.length, 0, 'רחוק משבוע — לא מוצג');
});

// ---------- הזרימה האמיתית: shellCall דרך השומר של ipc.js ----------
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_home__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_home__.js'] = { id: '/__electron_stub_home__.js', filename: '/__electron_stub_home__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: {}, BrowserWindow: function () {} } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

let dir = null;
// ב-Windows אי אפשר למחוק את התיקייה כשהמסד פתוח — סוגרים קודם (כמו ב-aiassist-gate.test.js)
test.after(() => {
  if (!dir) return;
  try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

test('shellCall — רשימה סגורה, בלי כניסה נחסם, ועם כניסה מחזיר את מסך הבית ותשובת העוזר', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  await ipc.initEcon(dir, { relayUrl: '' });
  assert.equal(typeof handlers['dashboard:getHomeSummary'], 'function', 'נרשם גם כערוץ רגיל');

  await assert.rejects(ipc.shellCall('dashboard:getHomeSummary', 7), /נדרשת כניסה/);
  await assert.rejects(ipc.shellCall('ai:run', 7, 'כמה גביתי החודש?'), /נדרשת כניסה/);

  await handlers['auth:setup'](ev(7), 'home_admin', 'home-admin-pass-1');
  await handlers['auth:login'](ev(7), 'home_admin', 'home-admin-pass-1');
  // ערוץ שלא ברשימה — נחסם גם עם כניסה: המעטפת לא כותבת נתונים בשם המודול
  await assert.rejects(ipc.shellCall('acct:createInvoice', 7, { customer: 'א', items: [{ unitPrice: 1 }] }), /אינה זמינה מהמעטפת/);
  await assert.rejects(ipc.shellCall('users:list', 7), /אינה זמינה מהמעטפת/);

  await handlers['acct:createInvoice'](ev(7), { customer: 'משה כהן', items: [{ unitPrice: 100 }] });
  const s = await ipc.shellCall('dashboard:getHomeSummary', 7);
  assert.equal(s.kpis.openInvoices, 1);
  assert.equal(s.kpis.incomeMonth, 10000, '100 ש"ח לפני מע"מ = 10,000 אגורות');
  assert.ok(s.kpis.openInvoicesAmount > 10000, 'כולל מע"מ');
  assert.equal(s.invoices[0].customer, 'משה כהן');

  const r = await ipc.shellCall('ai:run', 7, 'כמה גביתי החודש?');
  assert.equal(typeof r.text, 'string');
  assert.ok(r.text.length > 0);
  await assert.rejects(ipc.shellCall('ai:run', 7, '   '), /כתבו שאלה/);
});
