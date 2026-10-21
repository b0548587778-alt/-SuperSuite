// בדיקת ייעוץ משכנתאות ונדל"ן 21.10.2026 (audit-mortgage-realty.md, ממצא 1): האופטימייזר יצר את כל החלוקות
// לפני בדיקת התקרה — 6 אבני בניין בצעד 1% = 96.5 מיליון מערכים, והתהליך הראשי נגמר מזיכרון.
// עכשיו הספירה מחושבת קודם, והגבולות (מינימום/מקסימום לאבן) נאכפים בתוך היצירה.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const E = require('../modules/econ/core/mixEngine');

// היצירה הישנה (הכול ואז סינון) — כמקור השוואה בגדלים קטנים
function bruteForce(n, u, bounds) {
  const all = (k, left) => (k === 1 ? [[left]] : Array.from({ length: left + 1 }, (_, i) => left - i).flatMap(f => all(k - 1, left - f).map(r => [f, ...r])));
  return all(n, u).filter(g => g.every((x, i) => x / u >= bounds[i].min - 1e-9 && x / u <= bounds[i].max + 1e-9));
}
const toRanges = (u, bounds) => bounds.map(b => [Math.max(0, Math.ceil(b.min * u - 1e-9 * u)), Math.min(u, Math.floor(b.max * u + 1e-9 * u))]);

test('ממצא 1: הרשת עם גבולות זהה לרשת הישנה אחרי סינון — באותו סדר — והספירה תואמת', () => {
  const cases = [
    [2, 10, [{ min: 0, max: 1 }, { min: 0, max: 2 / 3 }]],
    [3, 10, [{ min: 0.1, max: 0.5 }, { min: 0, max: 1 }, { min: 1 / 3, max: 1 }]],
    [4, 20, [{ min: 0.05, max: 0.4 }, { min: 0.1, max: 0.35 }, { min: 0, max: 1 }, { min: 0.25, max: 0.25 }]],
    [3, 10, [{ min: 0.6, max: 1 }, { min: 0.6, max: 1 }, { min: 0, max: 1 }]], // אין חלוקה אפשרית
    [1, 10, [{ min: 0, max: 1 }]],
  ];
  for (const [n, u, bounds] of cases) {
    const ranges = toRanges(u, bounds);
    const expected = bruteForce(n, u, bounds);
    assert.deepEqual(E.shareGrid(n, u, ranges), expected, `n=${n} u=${u}`);
    assert.equal(E.countShareGrid(n, u, ranges), expected.length);
  }
  assert.deepEqual(E.shareGrid(3, 4), bruteForce(3, 4, [0, 1, 2].map(() => ({ min: 0, max: 1 }))), 'בלי גבולות — כמו קודם');
});

test('ממצא 1: 6 אבני בניין בצעד 1% — שגיאה מיידית עם מספר המועמדים, בלי ליצור אותם', () => {
  const blocks = Array.from({ length: 6 }, () => ({ track: { type: 'FIXED_UNLINKED', termMonths: 300, annualRate: 0.049 } }));
  const t0 = Date.now();
  assert.throws(() => E.optimizeMix({ principal: 1000000, blocks, step: 0.01 }, { forecast: E.DEMO_FORECAST, asOf: '2026-10-14' }), (e) => {
    assert.match(e.message, /יותר מדי מועמדים \(96560646\)/);
    return true;
  });
  assert.ok(Date.now() - t0 < 1000, 'הספירה לא יוצרת את החלוקות');
});

test('ממצא 1: גבולות צרים ב-6 אבנים בצעד 1% — רץ בתהליך עם זיכרון מוגבל (לפני התיקון: נגמר הזיכרון)', () => {
  // כל אבן 15%–18% (סכום 100% → מעט חלוקות). הקוד הישן יצר 96.5 מיליון חלוקות לפני הסינון
  const script = `
    const E = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'econ', 'core', 'mixEngine.js'))});
    const blocks = Array.from({ length: 6 }, () => ({ track: { type: 'FIXED_UNLINKED', termMonths: 300, annualRate: 0.049 }, minShare: 0.15, maxShare: 0.18 }));
    const r = E.optimizeMix({ principal: 1000000, blocks, step: 0.01 }, { forecast: E.DEMO_FORECAST, asOf: '2026-10-14' });
    process.stdout.write(JSON.stringify({ evaluated: r.evaluated, n: r.candidates.length }));`;
  const res = spawnSync(process.execPath, ['--max-old-space-size=192', '-e', script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(res.status, 0, `התהליך נכשל: ${res.signal || ''} ${String(res.stderr).slice(-300)}`);
  const out = JSON.parse(res.stdout);
  assert.ok(out.evaluated > 0 && out.evaluated <= 5000, JSON.stringify(out));
  assert.ok(out.n > 0);
});
