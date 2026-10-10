const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../modules/econ/core/pricing');

test('מחיר לפי עלות ורווח: 100 ש"ח עלות + 50% רווח = 150 לפני מע"מ, 177 כולל מע"מ', () => {
  const r = P.calcPrice({ cost: 100, markupPct: 50, vatRate: 0.18 });
  assert.equal(r.priceEx, 150);
  assert.equal(r.vat, 27);
  assert.equal(r.priceInc, 177);
  assert.equal(r.profit, 50);
  assert.equal(r.marginPct, 33.33);
});

test('פטור ממע"מ: המחיר הכולל שווה למחיר לפני מע"מ', () => {
  const r = P.calcPrice({ cost: 80, markupPct: 25, vatRate: 0.18, vatExempt: true });
  assert.equal(r.priceEx, 100);
  assert.equal(r.vat, 0);
  assert.equal(r.priceInc, 100);
});

test('אין שגיאות עיגול נקודה צפה (0.1 + 0.2 לא מזיז את התוצאה)', () => {
  const r = P.calcPrice({ cost: 0.1, markupPct: 100, vatRate: 0 });
  assert.equal(r.priceEx, 0.2);
});

test('קלט לא תקין נדחה', () => {
  assert.throws(() => P.calcPrice({ cost: -1, markupPct: 10, vatRate: 0.18 }), /עלות/);
  assert.throws(() => P.calcPrice({ cost: 1, markupPct: -5, vatRate: 0.18 }), /רווח/);
  assert.throws(() => P.calcPrice({ cost: 1, markupPct: 10, vatRate: 1.2 }), /מע"מ/);
  assert.throws(() => P.validateProduct({ name: '  ' }), /שם/);
});
