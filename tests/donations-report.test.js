// "תרומות ישראל" — השלמת הנתיב הידני (PLAN.md 9.14א): המשפט ומספר האישור על הקבלה אחרי הדיווח,
// קוד תורם 999999999 / 888888888 בדיווח, ורשימת העבודה לייצוא. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../modules/econ/core/npo');
const X = require('../modules/econ/core/exports');

const settings = { orgName: 'עמותת חסדי אבות', sec46Number: '4512345', sec46ValidUntil: '2027-12-31' };
const donation = (over = {}) => {
  const clean = N.validateDonation({ date: '2026-03-10', donorName: 'משה כהן', amount: 180, ...over }, settings);
  return { id: 'd1', ...clean, ...N.issueReceipt(clean, settings), status: 'active' };
};

test('סוג תורם: בעילום שם / תושב חוץ — הקוד בדיווח, בלי לשמור אותו כ-ת.ז', () => {
  const anon = donation({ donorType: 'anonymous' });
  assert.equal(anon.donorType, 'anonymous');
  assert.equal(anon.donorId, '', 'לא נשמר כמספר זהות — כדי שלא יתאחדו לתורם אחד');
  assert.equal(N.reportId(anon), '999999999');
  assert.equal(N.reportId(donation({ donorType: 'foreign' })), '888888888');
  assert.equal(N.reportId(donation({ donorId: '000000018' })), '000000018');
  assert.equal(N.reportId(donation()), '', 'תושב ישראל בלי ת.ז — חסר');
  assert.equal(donation().donorType, undefined, 'ברירת מחדל: תושב ישראל, לא נשמר שדה');
  assert.throws(() => donation({ donorType: 'foreign', donorId: '000000018' }), /אין להזין ת\.ז/);
  assert.equal(donation({ donorType: 'xyz' }).donorType, undefined, 'סוג לא מוכר = תושב ישראל');
});

test('סיכום הדיווח: תורם בעילום שם או תושב חוץ לא נספר כ"חסר ת.ז"', () => {
  const s = N.taxSummary([donation(), donation({ donorType: 'anonymous' }), donation({ donorType: 'foreign' })]);
  assert.equal(s.counts.pending, 3);
  assert.equal(s.missingDonorId, 1);
  assert.equal(s.invalidDonorId, 0);
});

test('ייצוא רשימת העבודה: מזהה לדיווח, סוג התורם ואמצעי התשלום', () => {
  const t = N.exportTable('tax', [donation({ donorType: 'anonymous', method: 'cash' }), donation({ donorId: '000000018' })], [], settings, 2026);
  assert.deepEqual(t.headers, ['פעולה', 'מס\' קבלה', 'תאריך', 'תורם', 'מזהה לדיווח', 'סוג תורם', 'סכום', 'אמצעי תשלום', 'מס\' רישום קודם']);
  assert.equal(t.rows[0][4], '999999999');
  assert.equal(t.rows[0][5], 'בעילום שם / בלי ת.ז');
  assert.equal(t.rows[0][7], 'מזומן');
  assert.equal(t.rows[1][4], '000000018');
});

test('הקבלה: אחרי הדיווח — המשפט הבולט ומספר האישור; לפני — לא מודפס', () => {
  const d = donation({ donorId: '000000018' });
  const before = X.renderDonationReceiptHtml(d);
  assert.doesNotMatch(before, /דווחו לרשות המסים/, 'לפני הדיווח אסור לכתוב שדווח');
  const reported = N.recordTaxReport(d, { registrationNumber: 'TR-2026-001' }, '2026-03-11');
  const after = X.renderDonationReceiptHtml(reported);
  assert.match(after, /פרטי התרומה דווחו לרשות המסים/);
  assert.match(after, /מספר אישור דיווח התרומה לרשות המסים: <span dir="ltr">TR-2026-001<\/span>/);
  // קבלה בלי סעיף 46 אינה מדווחת — גם אם בטעות יש מספר
  const no46 = { ...reported, receipt: { ...reported.receipt, sec46: false } };
  assert.doesNotMatch(X.renderDonationReceiptHtml(no46), /דווחו לרשות המסים/);
});

test('הקבלה: תושב חוץ מסומן, ומספר הדיווח עובר בריחת HTML', () => {
  assert.match(X.renderDonationReceiptHtml(donation({ donorType: 'foreign' })), /· תושב חוץ/);
  const d = { ...donation(), taxReport: { registrationNumber: '<b>x</b>' } };
  assert.doesNotMatch(X.renderDonationReceiptHtml(d), /<b>x<\/b>/);
});

test('טופס התרומה כולל את סוג התורם', () => {
  const fs = require('fs');
  const path = require('path');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ui/npo.js'), 'utf8');
  assert.match(ui, /name: 'donorType'.*NPO_DONOR_TYPES/);
  for (const k of Object.keys(N.DONOR_TYPES)) assert.match(ui, new RegExp(`${k}: '${N.DONOR_TYPES[k].replace(/[/.]/g, '\\$&')}'`));
});
