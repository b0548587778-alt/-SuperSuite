'use strict';
// כפתור עם רקע שקוף בלי צבע טקסט מקבל את צבע ברירת המחדל של הדפדפן (שחור) — בערכה הכהה הוא נעלם.
// כך נעלם איש הקשר "מנהל-העל" ברשימת ההודעות (25.10.2026)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('במודול הכלכלי: כל כלל עם רקע שקוף קובע גם צבע טקסט', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, sel, body] = m;
    if (/(^|;)\s*background(-color)?\s*:\s*transparent/.test(body) && !/(^|;)\s*color\s*:/.test(body)) bad.push(sel.trim());
  }
  assert.deepEqual(bad, [], 'להוסיף color (למשל inherit)');
});
