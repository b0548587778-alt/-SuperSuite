// ייבוא תרומות מקובץ של ערוץ חיצוני: זיהוי עמודות, תאריכים וסכומים, כפילויות, ת.ז שגויה,
// קבלה חיצונית מול הפקה מקומית, שמירת ההתאמה לערוץ והרשאות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const DI = require('../modules/econ/core/donationImport');
const N = require('../modules/econ/core/npo');

const CSV = [
  '﻿תאריך,שם מלא,ת.ז.,סכום,מספר עסקה,מספר קבלה,טלפון,הערות',
  '15/09/2026 10:22,יעקב כהן,000000018,"1,800.00",A1,R-77,050-1234567,לעילוי נשמת',
  '16.09.26,משה לוי,123456789,₪360,A2,,,',
  'xx,שמעון גולד,,50,A3,,,',
  '17/09/2026,אהרן פרידמן,,0,A4,,,',
  '2026-09-14,יעקב כהן,000000018,1800,A1,R-77,,'
].join('\n');
const SETTINGS = { orgName: 'עמותת תורה וחסד', receiptSeq: 5 };

test('זיהוי עמודות לפי כותרות נפוצות, והתאמה שמורה גוברת', () => {
  const m = DI.guessMapping(['תאריך', 'שם מלא', 'ת.ז.', 'סכום', 'מספר עסקה']);
  assert.deepEqual(m, { date: 'תאריך', donorName: 'שם מלא', amount: 'סכום', donorId: 'ת.ז.', externalId: 'מספר עסקה' });
  const en = DI.guessMapping(['Date', 'Full Name', 'Amount', 'Transaction ID']);
  assert.equal(en.donorName, 'Full Name');
  assert.equal(en.externalId, 'Transaction ID');
  const saved = DI.guessMapping(['תאריך', 'שם', 'שם המשלם', 'סכום'], { donorName: 'שם המשלם' });
  assert.equal(saved.donorName, 'שם המשלם');
});

test('תאריכים וסכומים בפורמטים ישראליים', () => {
  assert.equal(DI.parseDate('15/09/2026'), '2026-09-15');
  assert.equal(DI.parseDate('5.1.26'), '2026-01-05');
  assert.equal(DI.parseDate('2026-09-15T10:00:00'), '2026-09-15');
  assert.equal(DI.parseDate('31/02/2026'), null);
  assert.equal(DI.parseDate('abc'), null);
  assert.equal(DI.parseAmount('₪1,800.50'), 1800.5);
  assert.equal(DI.parseAmount('360 ש"ח'), 360);
  assert.equal(DI.parseAmount('0'), null);
  assert.equal(DI.parseAmount('-50'), null);
});

test('בניית רשומות: שגיאות לפי שורה, ת.ז שגויה כאזהרה, כפילות בתוך הקובץ', () => {
  const pv = DI.preview(CSV, 'nedarim', SETTINGS);
  const r = DI.buildRecords(CSV, { source: 'nedarim', mapping: pv.mapping, receipts: 'external' }, [], SETTINGS);
  assert.equal(r.records.length, 2);
  assert.equal(r.skipped, 1, 'אותו מספר עסקה פעמיים');
  assert.equal(r.records[1].donorId, '', 'ת.ז שגויה לא נשמרת');
  assert.deepEqual(r.errors.map(e => [e.line, !!e.warning]), [[3, true], [4, false], [5, false]]);
  assert.equal(r.records[0].import.externalReceipt, 'R-77');
  assert.equal(r.records[0].method, 'card');
});

test('עמודת חובה חסרה או ערוץ לא מוכר — נדחה לפני עיבוד', () => {
  assert.throws(() => DI.buildRecords(CSV, { source: 'nedarim', mapping: { date: 'תאריך', amount: 'סכום' } }, [], SETTINGS), /שם התורם/);
  assert.throws(() => DI.buildRecords(CSV, { source: 'xxx', mapping: {} }, [], SETTINGS), /ערוץ/);
  assert.throws(() => DI.preview('a,a\n1,2', 'nedarim', SETTINGS), /אותה כותרת/);
});

test('קבלה חיצונית ממוינת אחרי הקבלות המקומיות ומוצגת לפי מספר המקור', () => {
  const local = { date: '2026-01-01', receipt: { number: 3 } };
  const ext = { date: '2026-01-01', receipt: { number: null, external: true, externalNumber: 'R-77' } };
  assert.deepEqual([ext, local].sort(N.byReceipt), [local, ext]);
  assert.equal(N.receiptLabel(ext), 'חיצונית R-77');
  assert.equal(N.receiptLabel(local), 3);
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_di = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_di__.js' : Module._resolveFilename_di.call(this, req, ...rest); };
require.cache['/__electron_stub_di__.js'] = {
  id: '/__electron_stub_di__.js', filename: '/__electron_stub_di__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: קבלה חיצונית לא צורכת מספור, הפקה מקומית כן; ייבוא חוזר מדלג; ההתאמה נשמרת', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-di-')));
  await handlers['auth:setup'](ev(91), 'di_admin', 'di-strong-pass-2026');
  await handlers['auth:login'](ev(91), 'di_admin', 'di-strong-pass-2026');
  await assert.rejects(handlers['npo:importDonations'](ev(91), CSV, { source: 'nedarim', mapping: {} }), /פרטי העמותה/);
  await handlers['npo:saveSettings'](ev(91), { orgName: 'עמותת תורה וחסד' });
  await handlers['npo:addDonation'](ev(91), { donorName: 'דוד שפירא', amount: 100, date: '2026-09-01' });

  const pv = await handlers['npo:previewImport'](ev(91), CSV, 'nedarim');
  const mapping = { ...pv.mapping, donorPhone: 'טלפון' };
  const r = await handlers['npo:importDonations'](ev(91), CSV, { source: 'nedarim', mapping, receipts: 'external' });
  assert.equal(r.imported, 2);
  assert.equal(r.total, 2160);
  let ov = await handlers['npo:getOverview'](ev(91), 2026);
  assert.equal(ov.settings.receiptSeq, 1, 'קבלה חיצונית לא מקדמת את המספור');
  const ext = ov.donations.find(d => d.import && d.import.externalId === 'A1');
  assert.equal(ext.receipt.external, true);
  assert.equal(ext.taxStatus, 'not-required', 'הדיווח נעשה על ידי הערוץ');
  await assert.rejects(handlers['npo:exportReceiptPdf'](ev(91), ext.id), /בערוץ התרומה/);
  assert.deepEqual(ov.settings.importMappings.nedarim, mapping);

  const again = await handlers['npo:importDonations'](ev(91), CSV, { source: 'nedarim', mapping, receipts: 'external' });
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 3);

  const bank = 'תאריך,שם,סכום\n02/10/2026,חיים ברגר,250\n01/10/2026,נחום רוזן,90';
  const b = await handlers['npo:importDonations'](ev(91), bank, { source: 'bank', mapping: { date: 'תאריך', donorName: 'שם', amount: 'סכום' }, receipts: 'issue' });
  assert.equal(b.imported, 2);
  ov = await handlers['npo:getOverview'](ev(91), 2026);
  const byName = n => ov.donations.find(d => d.donorName === n);
  assert.equal(byName('נחום רוזן').receipt.number, 2, 'מספור לפי סדר התאריכים');
  assert.equal(byName('חיים ברגר').receipt.number, 3);
  assert.equal(byName('חיים ברגר').method, 'transfer');
  const csv = await handlers['npo:exportCsv'](ev(91), 'donations', 2026);
  assert.equal(csv.ok, false, 'דיאלוג השמירה בוטל בבדיקה — אבל הבנייה לא קרסה');

  AuthService.getSession(91).permissions = ['data.view'];
  await assert.rejects(handlers['npo:importDonations'](ev(91), bank, { source: 'bank', mapping: {} }), /אין הרשאה/);
});
