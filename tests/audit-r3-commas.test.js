// סקירת קוד 2.11.2026 — "אותו באג בשני מקומות": פסיק שאינו מפריד אלפים לא נמחק בשקט מסכום
const test = require('node:test');
const assert = require('node:assert/strict');
const IC = require('../modules/econ/core/invoiceCapture');

const base = { supplierName: 'ספק', date: '2026-10-01', expenseAccount: '6100' };

test('חשבונית ספק: "10,50" נדחה ולא נקרא ₪1,050', () => {
  assert.throws(() => IC.draftEntry({ ...base, gross: '10,50' }), /פסיק רק כמפריד אלפים/);
  assert.throws(() => IC.draftEntry({ ...base, gross: '12,5' }), /פסיק רק כמפריד אלפים/);
});

test('חשבונית ספק: מפריד אלפים תקין עדיין נקרא', () => {
  const a = IC.draftEntry({ ...base, gross: '1,180.00' });
  const b = IC.draftEntry({ ...base, gross: '1180' });
  assert.deepEqual(a.lines, b.lines);
  assert.ok(IC.draftEntry({ ...base, gross: '₪ 1,234,567.5' }));
});
