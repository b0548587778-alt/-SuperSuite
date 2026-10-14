// ספרת ביקורת למספר זהות / ח"פ (modules/econ/core/israeliId.js) והשילוב שלה בעמותה, בגמ"ח ובחסד.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const core = p => require(path.join(__dirname, '..', 'modules', 'econ', 'core', p));
const I = core('israeliId');
const N = core('npo');
const G = core('gemach');
const C = core('chesed');

test('ספרת ביקורת: מספרים תקינים ושגויים', () => {
  for (const v of ['123456782', '000000018', '18', '111222337']) assert.equal(I.isValidIsraeliId(v), v.length >= 5, v);
  for (const v of ['123456789', '111222333', '000000000', 'abc', '']) assert.equal(I.isValidIsraeliId(v), false, v);
  assert.equal(I.isValidIsraeliId('00018'), true, 'מספר קצר מרופד באפסים');
});

test('שדה ריק מותר (תורם מחו"ל), מספר שגוי נחסם עם הודעה בעברית', () => {
  assert.equal(I.assertIsraeliId('', 'ת.ז'), '');
  assert.throws(() => I.assertIsraeliId('123456789', 'ת.ז'), /ספרת ביקורת/);
  assert.throws(() => I.assertIsraeliId('12a', 'ת.ז'), /5–9 ספרות/);
});

test('רשומה ישנה עם מספר שגוי ניתנת לעריכה כל עוד המספר לא שונה', () => {
  assert.equal(I.assertIsraeliId('123456789', 'ת.ז', '123456789'), '123456789');
  assert.throws(() => I.assertIsraeliId('123456780', 'ת.ז', '123456789'), /ספרת ביקורת/);
});

test('עמותה: תרומה עם ת.ז שגויה נחסמת', () => {
  const settings = { orgName: 'עמותה', funds: [] };
  assert.throws(() => N.validateDonation({ donorName: 'משה', donorId: '123456789', amount: 50 }, settings), /ספרת ביקורת/);
  assert.equal(N.validateDonation({ donorName: 'משה', donorId: '123456782', amount: 50 }, settings).donorId, '123456782');
});

test('עמותה: תרומות ישנות עם ת.ז שגויה נספרות בסיכום הדיווח', () => {
  const d = (id, donorId) => ({ id, donorId, amount: 10, status: 'active', receipt: { number: 1, sec46: true } });
  const s = N.taxSummary([d('a', '123456789'), d('b', '123456782'), d('c', '')]);
  assert.equal(s.invalidDonorId, 1);
  assert.equal(s.missingDonorId, 1);
});

test('גמ"ח וחסד: ת.ז שגויה נחסמת', () => {
  assert.throws(() => G.validateLoanInput({ borrowerName: 'לוי', borrowerId: '123456789', amount: 1000, installments: 10 }), /ספרת ביקורת/);
  assert.throws(() => C.validateBeneficiary({ familyName: 'כהן', idNumber: '123456789' }), /ספרת ביקורת/);
  assert.equal(C.validateBeneficiary({ familyName: 'כהן', idNumber: '123456789' }, { idNumber: '123456789' }).idNumber, '123456789');
});
