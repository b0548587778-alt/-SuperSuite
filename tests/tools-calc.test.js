const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../modules/tools/calc.js');

test('רשימת קניות: מתארגנת לפי קטגוריה, כמות ברירת מחדל 1, ומתעלמת משורות ריקות', () => {
  const g = C.groupShoppingList('חלב, 2, מוצרי חלב\n\nלחם\nעגבניות, 6, ירקות\nגבינה, 1, מוצרי חלב\n');
  assert.deepEqual(g.map(x => x.category), ['מוצרי חלב', 'שונות', 'ירקות']);
  assert.deepEqual(g[0].items, [{ name: 'חלב', qty: 2 }, { name: 'גבינה', qty: 1 }]);
  const text = C.shoppingListText(g);
  assert.match(text, /☐ חלב \(×2\)/);
  assert.match(text, /☐ לחם\n/);
});

test('רשימת קניות: כמות שאינה מספר נחשבת קטגוריה', () => {
  const g = C.groupShoppingList('תפוחים, ירקות');
  assert.deepEqual(g, [{ category: 'ירקות', items: [{ name: 'תפוחים', qty: 1 }] }]);
});

test('עלות חשמל: 2000 וואט x 3 שעות x 30 יום x 0.6 ₪ = 108 ₪', () => {
  const r = C.powerCost({ watts: 2000, hoursPerDay: 3, pricePerKwh: 0.6, days: 30 });
  assert.equal(r.kwhPerDay, 6);
  assert.equal(r.kwhPeriod, 180);
  assert.equal(r.costPeriod, 108);
  assert.throws(() => C.powerCost({ watts: 100, hoursPerDay: 25, pricePerKwh: 1 }), /לא תקינים/);
});

test('הפרש תאריכים: ימים, שבועות וחודשים מלאים', () => {
  assert.deepEqual(C.dateDiff('2026-01-15', '2026-03-10'), { days: 54, weeks: 7, months: 1 });
  assert.deepEqual(C.dateDiff('2026-01-01', '2026-01-01'), { days: 0, weeks: 0, months: 0 });
  assert.equal(C.dateDiff('2026-03-10', '2026-01-15').days, -54);
  assert.throws(() => C.dateDiff('10/03/2026', '2026-01-01'), /תאריך לא תקין/);
});

test('הוספת ימים חוצה חודש ושנה', () => {
  assert.equal(C.addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.throws(() => C.addDays('2026-03-01', 1.5), /ימים/);
});

test('ריבית דריבית: הפקדה חודשית, תואמת את הנוסחה הסגורה', () => {
  const r = C.compoundInterest({ principal: 10000, monthlyDeposit: 500, annualRate: 4, years: 10 });
  const i = 0.04 / 12, n = 120;
  const fv = 10000 * Math.pow(1 + i, n) + 500 * ((Math.pow(1 + i, n) - 1) / i);
  assert.ok(Math.abs(r.final - Math.round(fv * 100) / 100) < 0.02, `final ${r.final} vs ${fv}`);
  assert.equal(r.deposited, 70000);
  assert.equal(r.interest, Math.round((r.final - 70000) * 100) / 100);
  assert.deepEqual(C.compoundInterest({ principal: 1000, annualRate: 0, years: 2 }).final, 1000);
});
