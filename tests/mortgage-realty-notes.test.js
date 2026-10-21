// הערות קטנות מבדיקת ייעוץ המשכנתאות והנדל"ן 21.10.2026 (docs/audit-parts/audit-mortgage-realty.md, "הערות קטנות").
// ביטול חשבונית העמלה — ב-tests/advisory-invoice-cancel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../modules/econ/core/realEstateAppraisal');
const I = require('../modules/econ/core/realtyInvest');
const { RealEstateServiceClass } = require('../modules/econ/services/realEstateService');

// קובץ עם n עסקאות תקינות ושונות זו מזו (מחיר אחר בכל שורה)
const csvOf = (n) => 'תאריך,מחיר,שטח,כתובת\n'
  + Array.from({ length: n }, (_, i) => `2026-03-01,${1500000 + i * 1000},80,רחוב הרב שך ${i + 1}`).join('\n');

const CAP = 500;

test('ייבוא CSV: שורות אחרי ה-500 לא נעלמות — נספרות כ"מעבר למגבלה"', async () => {
  const parsed = R.parseComparablesCsv(csvOf(CAP + 3));
  assert.equal(parsed.rows.length, CAP);
  assert.equal(parsed.unread, 3);
  assert.equal(R.parseComparablesCsv(csvOf(10)).unread, 0);

  let data = {};
  const db = { load: async () => JSON.parse(JSON.stringify(data)), save: async (d) => { data = JSON.parse(JSON.stringify(d)); } };
  const s = new RealEstateServiceClass(db);
  s.today = () => '2026-10-20';
  const c = await s.createCase({ client: { name: 'יעקב לוין' }, purpose: 'mortgage', property: { address: 'רחוב הרב שך 1', city: 'בני ברק', area: '80' } });
  const out = await s.importComparables(c.id, csvOf(CAP + 3));
  assert.equal(out.found, CAP);
  assert.equal(out.added, R.MAX_COMPS);
  assert.equal(out.skipped, CAP - R.MAX_COMPS + 3, 'גם 3 השורות שלא נקראו');
  assert.equal(R.MAX_CSV_ROWS, CAP);
});

test('מס רכישה: אזהרה כשטבלת השנה חלה רק מאמצע השנה', () => {
  const base = { id: 't', ...I.validateTaxTable({ year: 2026, kind: 'single', bracketsText: '1,000,000, 0\nמעל, 5', source: 'הוקלד לבדיקה' }) };
  const input = { price: 1500000, taxYear: 2026, taxKind: 'single' };
  const late = I.investment(input, [{ ...base, validFrom: '2026-01-16' }]);
  assert.ok(late.warnings.some(w => /חלה מ-2026-01-16.*לפני תאריך זה חלות מדרגות אחרות/.test(w)), late.warnings.join(' | '));
  assert.equal(late.tax.taxAg, 2500000, 'החישוב עצמו לא השתנה');
  for (const validFrom of ['', '2026-01-01']) {
    const r = I.investment(input, [{ ...base, validFrom }]);
    assert.ok(!r.warnings.some(w => /חלה מ-/.test(w)), validFrom || 'בלי תאריך');
  }
});
