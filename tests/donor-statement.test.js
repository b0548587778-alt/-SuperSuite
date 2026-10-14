// סיכום שנתי לתורם: איסוף הקבלות לפי ת.ז או שם, החרגת מבוטלות ושנים אחרות, וחישוב החלק לפי סעיף 46 באגורות.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const core = p => require(path.join(__dirname, '..', 'modules', 'econ', 'core', p));
const N = core('npo');
const X = core('exports');

const settings = { orgName: 'עמותת חסד ואמת', regNumber: '580000000', sec46Number: '4455', funds: [] };
const don = (n, date, amount, extra = {}) => ({ id: 'd' + n, date, donorName: 'יעקב לוי', donorId: '123456782', amount, method: 'transfer',
  status: 'active', receipt: { number: n, sec46: true, fundName: 'כללי' }, ...extra });

const donations = [
  don(1, '2026-01-10', 100.10),
  don(2, '2026-06-01', 200.20, { receipt: { number: 2, sec46: false, fundName: 'כללי' } }),
  don(3, '2026-07-01', 999, { status: 'cancelled' }),
  don(4, '2025-12-31', 50),
  don(5, '2026-03-01', 70, { donorId: '000000018', donorName: 'אחר' }),
  { id: 'n1', date: '2026-02-02', donorName: 'משה כהן', donorId: '', amount: 36, method: 'cash', status: 'active', receipt: { number: 6, sec46: true } }
];

test('סיכום לפי ת.ז: רק השנה, בלי מבוטלות ובלי תורמים אחרים', () => {
  const st = N.donorAnnualStatement(donations, settings, 'id:123456782', 2026);
  assert.deepEqual(st.receipts.map(r => r.number), [1, 2]);
  assert.equal(st.total, 300.3);
  assert.equal(st.sec46Total, 100.1);
  assert.equal(st.org.sec46Number, '4455');
});

test('סיכום לפי שם, לתורם בלי ת.ז', () => {
  const st = N.donorAnnualStatement(donations, settings, 'name:משה כהן', 2026);
  assert.equal(st.receipts.length, 1);
  assert.equal(st.total, 36);
});

test('אין תרומות או שנה לא תקינה — שגיאה בעברית', () => {
  assert.throws(() => N.donorAnnualStatement(donations, settings, 'id:123456782', 2020), /לא נמצאו תרומות/);
  assert.throws(() => N.donorAnnualStatement(donations, settings, 'id:123456782', 'abc'), /שנה לא תקינה/);
});

test('המפתח מרשימת התורמים מתאים לסיכום', () => {
  const key = N.donorSummary(donations).find(d => d.name === 'יעקב לוי').key;
  assert.equal(N.donorAnnualStatement(donations, settings, key, 2026).receipts.length, 2);
});

test('ה-HTML מכיל את הנתונים ומנוטרל מתגיות', () => {
  const st = N.donorAnnualStatement(donations.map(d => d.id === 'd1' ? { ...d, donorName: '<b>יעקב</b>' } : d), settings, 'id:123456782', 2026);
  const html = X.renderDonorStatementHtml(st);
  assert.match(html, /סיכום תרומות לשנת 2026/);
  assert.match(html, /סעיף 46/);
  assert.doesNotMatch(html, /<b>יעקב/);
});
