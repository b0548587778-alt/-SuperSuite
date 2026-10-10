const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../modules/econ/core/exports');

test('CSV: escapes commas, quotes and newlines and starts with BOM', () => {
  const csv = X.toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', 3]]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"x,y","say ""hi"""'));
  assert.ok(csv.includes('"line\nbreak",3'));
});

test('חשבונית HTML: מוגנת מ-XSS ומכילה את הסכומים', () => {
  const html = X.renderInvoiceHtml({
    number: 7, date: '2026-04-01', customer: '<img src=x onerror=alert(1)>',
    items: [{ description: 'שירות & ייעוץ', quantity: 2, unitPrice: 100, lineNet: 200 }],
    net: 200, vat: 36, total: 236, vatExempt: false
  }, { name: 'עסק <b>בדיקה</b>', taxId: '123' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('שירות &amp; ייעוץ'));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(html.includes('₪236.00'));
  assert.ok(html.includes('עסק &lt;b&gt;'));
});

test('מגבלות אורך וכמות נאכפות (הגנה מקלט מנופח)', () => {
  const A = require('../modules/econ/core/accounting');
  const P = require('../modules/econ/core/pricing');
  assert.throws(() => A.validateAccount({ code: '9999', name: 'x'.repeat(121), type: 'asset' }, []), /ארוך מדי/);
  assert.throws(() => A.validateEntry({ date: '2026-01-01', description: 'x'.repeat(501), lines: [{ account: '1000', debit: 1 }, { account: '4000', credit: 1 }] }, A.DEFAULT_CHART), /ארוך מדי/);
  assert.throws(() => P.validateProduct({ name: 'x'.repeat(201) }), /ארוך מדי/);
});
