// מחשבון שכר נטו — טבלת 2026 (PLAN שלב 10, 10.2): ריווח המדרגות בתיקון 288 (20% עד 19,000, 31% עד 25,100),
// וסף הביטוח הלאומי 7,703 ותקרה 51,910. הטבלה נשארת "לא מאומתת" (ממקורות משניים)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../modules/tools/calc.js');

test('הטבלה המובנית: 2026, מדרגות אחרי הריווח, ועדיין לא מאומתת', () => {
  const t = C.SALARY_TABLE_DEFAULT;
  assert.equal(t.year, 2026);
  assert.equal(t.verified, false);
  assert.match(t.note, /לא אומתו/);
  assert.deepEqual(t.brackets.map(b => b[0]), [7010, 10060, 19000, 25100, 46690, 60130, null]);
  assert.deepEqual([t.social.threshold, t.social.ceiling], [7703, 51910]);
});

test('ברוטו 18,000: מדרגת 20% מכסה 10,060–18,000, ואין מדרגת 31%', () => {
  const r = C.netSalary({ gross: 18000, creditPoints: 2.25, pensionPct: 0 });
  assert.deepEqual(r.steps.map(s => s.rate), [10, 14, 20]);
  assert.equal(r.steps[2].partAg, (18000 - 10060) * 100);
  // 701 + 427 + 1,588 = 2,716 ₪ לפני זיכוי; זיכוי 2.25 × 242 = 544.50
  assert.equal(r.taxBeforeCreditAg, 271600);
  assert.equal(r.incomeTaxAg, 271600 - 54450);
});

test('ברוטו 8,000: 7,703 ₪ בשיעור המופחת ו-297 ₪ בשיעור המלא', () => {
  const r = C.netSalary({ gross: 8000, creditPoints: 2.25, pensionPct: 0 });
  assert.equal(r.bituachAg, Math.round(770300 * 0.0104) + Math.round(29700 * 0.07));
  assert.equal(r.healthAg, Math.round(770300 * 0.0323) + Math.round(29700 * 0.0517));
});
