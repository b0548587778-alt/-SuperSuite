// קבצים ללקוח (PLAN.md 9.13, דרך 1): דף חשבון ללווה בגמ"ח, כרטסת לקוח להדפסה ותיק תורם — סיכום שנתי וכל הקבלות בקובץ אחד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = p => require(path.join(__dirname, '..', 'modules', 'econ', 'core', p));
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const X = core('exports');
const N = core('npo');
const G = core('gemach');
const Module = require('module');

// ipc.js דורש electron — מספיק ipcMain מדומה כדי לקרוא את permissionFor
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_clientfiles__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_clientfiles__.js'] = { id: '/__electron_stub_clientfiles__.js', filename: '/__electron_stub_clientfiles__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

// ---------- דף חשבון ללווה
const loanWith = (payments) => {
  let loan = { id: 'l1', borrowerName: 'אברהם כהן', borrowerId: '123456782', borrowerAddress: 'רחוב הרב קוק 5, בני ברק',
    amount: 1000, installments: 3, issueDate: '2026-01-10', status: 'active', purpose: 'הוצאות חתונה',
    guarantors: [{ name: 'יצחק לוי' }], bankMasked: '12-345-•••789', schedule: G.buildSchedule(1000, 3, '2026-01-10') };
  for (const [seq, input] of payments) loan = G.recordPayment(loan, seq, input);
  return loan;
};

test('דף חשבון: שולם, נותר ובפיגור באגורות; שארית העיגול בתשלום האחרון', () => {
  const loan = loanWith([[1, { amount: 333.33, date: '2026-02-10' }], [2, { amount: 100, date: '2026-03-12' }]]);
  const html = X.renderLoanStatementHtml(loan, { fundName: 'גמ"ח עזר מציון', asOf: '2026-04-20' });
  assert.match(html, /דף חשבון הלוואה/);
  assert.match(html, /גמ&quot;ח עזר מציון/);
  assert.match(html, /שולם עד כה<\/span><span>₪433\.33/);
  assert.match(html, /יתרה לפירעון<\/span><span>₪566\.67/);
  // תשלום 2 (חלקי, מועדו עבר) ותשלום 3 (מועדו 2026-04-10 עבר) — בפיגור: 233.33 + 333.34
  assert.match(html, /מתוכו בפיגור<\/span><span>₪566\.67/);
  assert.match(html, /₪333\.34/);
  assert.match(html, /<tr class="paid">/);
  assert.match(html, /<tr class="late">/);
  assert.match(html, /<bdi dir="ltr">12-345-•••789<\/bdi>/);
  assert.match(html, /יצחק לוי/);
});

test('דף חשבון: הלוואה שנפרעה — בלי פיגור; הלוואה מבוטלת מסומנת', () => {
  const closed = loanWith([[1, {}], [2, {}], [3, {}]]);
  assert.equal(closed.status, 'closed');
  const html = X.renderLoanStatementHtml(closed, { asOf: '2027-01-01' });
  assert.doesNotMatch(html, /בפיגור/);
  assert.match(html, /יתרה לפירעון<\/span><span>₪0\.00/);
  const cancelled = X.renderLoanStatementHtml({ ...loanWith([]), status: 'cancelled' }, { asOf: '2027-01-01' });
  assert.match(cancelled, /ההלוואה בוטלה/);
  assert.doesNotMatch(cancelled, /<tr class="late">/);
});

test('דף חשבון: הנתונים מוברחים, ומספר חשבון מלא לא מגיע למסמך', () => {
  const loan = { ...loanWith([]), borrowerName: '<script>x</script>', bankAccount: '12-345-678989' };
  const html = X.renderLoanStatementHtml(loan, { asOf: '2026-01-11' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(read('modules/econ/services/gemachService.js'), /async getLoanStatement[\s\S]{0,120}this\.getLoan\(/);
});

// ---------- כרטסת לקוח
const ledger = {
  customer: 'חברת אור תורה', from: '2026-01-01', to: '2026-06-30', openingAg: 50000,
  rows: [
    { date: '2026-02-01', ref: '101', label: 'חשבונית מס', debitAg: 117000, creditAg: 0, balanceAg: 167000 },
    { date: '2026-03-01', ref: '101', label: 'גבייה', debitAg: 0, creditAg: 167000, balanceAg: 0 }
  ],
  debitAg: 117000, creditAg: 167000, closingAg: 0
};

test('כרטסת להדפסה: יתרת פתיחה, תנועות, סיכום ויתרת סגירה', () => {
  const html = X.renderCustomerLedgerHtml(ledger, { name: 'דפוס הנשר', taxId: '515555555', brandColor: '#123456' });
  assert.match(html, /כרטסת לקוח/);
  assert.match(html, /יתרת פתיחה<\/td><td><\/td><td><\/td><td class="n">₪500\.00/);
  assert.match(html, /₪1,170\.00/);
  assert.match(html, /החשבון מאוזן/);
  assert.match(html, /#123456/);
  assert.match(html, /מ-2026-01-01 עד 2026-06-30/);
  assert.match(X.renderCustomerLedgerHtml({ ...ledger, closingAg: 2500 }), /יתרה לתשלום: ₪25\.00/);
  assert.match(X.renderCustomerLedgerHtml({ ...ledger, closingAg: -2500 }), /יתרת זכות ללקוח: ₪25\.00/);
  assert.match(X.renderCustomerLedgerHtml({ ...ledger, from: null, to: null }), /כל התקופה/);
});

test('כרטסת להדפסה: צבע ולוגו שאינם תקינים לא נכנסים', () => {
  const html = X.renderCustomerLedgerHtml(ledger, { brandColor: 'red;}body{x', logo: 'https://example.com/a.png' });
  assert.doesNotMatch(html, /red;\}/);
  assert.doesNotMatch(html, /example\.com/);
});

// ---------- תיק תורם
const settings = { orgName: 'עמותת חסד ואמת', regNumber: '580000000', sec46Number: '4455', funds: [] };
const don = (n, date, amount, extra = {}) => ({ id: 'd' + n, date, donorName: 'יעקב לוי', donorId: '123456782', amount, method: 'transfer',
  status: 'active', receipt: { number: n, sec46: true, fundName: 'כללי', org: { name: 'עמותת חסד ואמת' } }, ...extra });
const donations = [
  don(1, '2026-01-10', 100),
  don(2, '2026-06-01', 200),
  don(3, '2026-07-01', 999, { status: 'cancelled' }),
  don(4, '2026-08-01', 50, { receipt: { external: true, externalNumber: 'N-77', sec46: false, fundName: 'כללי' } })
];

test('תיק תורם: הסיכום ואחריו כל קבלה שהופקה במערכת בעמוד משלה; חיצונית ומבוטלת לא מצורפות', () => {
  const rows = N.donorYearDonations(donations, 'id:123456782', 2026);
  assert.deepEqual(rows.map(d => d.id), ['d1', 'd2', 'd4']);
  const st = N.donorAnnualStatement(donations, settings, 'id:123456782', 2026);
  const html = X.renderDonorFileHtml(st, rows);
  assert.match(html, /סיכום תרומות לשנת 2026/);
  assert.equal((html.match(/<section class="rc page">/g) || []).length, 2);
  assert.equal((html.match(/קבלה על תרומה<\/h1>/g) || []).length, 2);
  assert.match(html, /מצורפות 2 קבלות[^<]*<\/div><div class="notice">/);
  assert.match(html, /1 קבלות שהופקו בערוץ התרומה עצמו אינן מצורפות/);
  assert.match(html, /\.page \{ break-before: page; \}/);
  assert.equal((html.match(/@page/g) || []).length, 1);
});

test('תיק תורם: העיצובים של הסיכום ושל הקבלה מעוגנים כל אחד תחת המחלקה שלו', () => {
  const css = X.scopeCss('\n  @page { size: A4; }\n  body { margin: 0; }\n  header, .meta { color: red; }\n', '.rc');
  assert.doesNotMatch(css, /@page/);
  assert.match(css, /\.rc \{ margin: 0; \}/);
  assert.match(css, /\.rc header, \.rc \.meta \{ color: red; \}/);
});

test('המסמכים הקיימים לא השתנו: קבלה וסיכום שנתי עדיין מסמך שלם', () => {
  const r = X.renderDonationReceiptHtml(donations[0]);
  assert.match(r, /^<!doctype html>\n<html lang="he" dir="rtl">/);
  assert.match(r, /<title>קבלה על תרומה 1<\/title>/);
  assert.match(r, /border-bottom: 3px solid #0f766e/);
  const s = X.renderDonorStatementHtml(N.donorAnnualStatement(donations, settings, 'id:123456782', 2026));
  assert.match(s, /<title>סיכום תרומות לשנת 2026<\/title>/);
});

// ---------- ערוצים
test('ערוצים: דרך handle(), חשופים ב-preload, נרשמים ביומן, ויש להם כפתור', () => {
  const ipc = read('modules/econ/ipc.js');
  const preload = read('modules/econ/preload.js');
  for (const [ch, audit] of [['gemach:exportLoanStatementPdf', 'gemach.statement.pdf'], ['acct:exportCustomerLedgerPdf', 'acct.export.ledger.pdf'], ['npo:exportDonorFilePdf', 'npo.donorfile.pdf']]) {
    assert.match(ipc, new RegExp(`handle\\('${ch}'[\\s\\S]{0,700}saveHtmlAsPdf[\\s\\S]{0,300}auditEvent\\(event, '${audit.replace(/\./g, '\\.')}'`), ch);
    assert.match(preload, new RegExp(`'${ch}'`), ch);
  }
  const { permissionFor } = require('../modules/econ/ipc');
  for (const ch of ['gemach:exportLoanStatementPdf', 'acct:exportCustomerLedgerPdf', 'npo:exportDonorFilePdf']) assert.equal(permissionFor(ch), 'data.export');
  assert.match(read('modules/econ/ui/gemach.js'), /data-gemach-statement=[\s\S]*exportGemachLoanStatementPdf/);
  assert.match(read('modules/econ/ui/biz-reports.js'), /id="bizLedgerPdf"[\s\S]*exportCustomerLedgerPdf/);
  assert.match(read('modules/econ/ui/npo.js'), /data-npo-donor-file=[\s\S]*exportNpoDonorFilePdf/);
});
