// מסכי השמאות (שמאות מקרקעין במודול הכלכלי ותיק השמאות בשמאי) בנויים רק מרכיבי shell/ui-kit.css —
// בקשת הבעלים (20.10.2026): נדל"ן, שמאות, משכנתאות וחשבונות באותו סגנון
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KIT = read('shell/ui-kit.css');

// כל המחלקות שמופיעות בתבניות של קובץ (class="..."; ביטויי ${...} — מדולגים)
function classesOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) out.add(c);
  }
  for (const m of src.matchAll(/'(ss-[a-z-]+)'/g)) out.add(m[1]);
  return out;
}

for (const [file, screen] of [['modules/econ/ui/realestate.js', 'שמאות מקרקעין'], ['modules/shamai/src/case-ui.js', 'תיק השמאות']]) {
  test(`${screen}: רק מחלקות של ספריית הרכיבים, וכל אחת קיימת בה`, () => {
    const classes = [...classesOf(read(file))];
    assert.ok(classes.length > 20, 'לא נמצאו מחלקות');
    for (const c of classes) {
      assert.match(c, /^ss-/, `${screen}: מחלקה פרטית ${c}`);
      assert.ok(new RegExp(`\\.${c}(?![a-z-])`).test(KIT), `${screen}: ${c} חסרה ב-ui-kit.css`);
    }
  });
}

test('אין CSS פרטי למסכי השמאות במודולים', () => {
  const econ = read('modules/econ/styles.css');
  assert.doesNotMatch(econ, /\.realestate\s|\.re-(form|photo|warn|import|comps|adj)/);
  const shamai = read('modules/shamai/style.css');
  assert.doesNotMatch(shamai, /\.cs-(toolbar|row|list|item|line|photo|stone|tests|filter|status|form|sub|saved|acts|no)\b/);
});

test('ui-kit: רכיבי המבנה של מסכי השמאות — בלי hex', () => {
  for (const c of ['.ss-form-grid', '.ss-field', '.ss-row', '.ss-list-row', '.ss-photos', '.ss-toolbar', '.ss-card-warning', '.ss-stack']) {
    assert.ok(KIT.includes(c), 'חסר רכיב: ' + c);
  }
  assert.doesNotMatch(KIT, /#[0-9a-f]{3,8}\b/i);
});
