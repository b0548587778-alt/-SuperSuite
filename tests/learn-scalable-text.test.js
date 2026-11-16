// גודל טקסט שגדל עם "גודל טקסט" בהגדרות התצוגה (תוכנית "כל אחד מסתדר", WP1): במודולי הלימוד ובארגז הכלים אין
// גודל גופן קבוע בפיקסלים — רק var(--ss-fs-*) או calc() מהם. (ב-SuperSuite המלאה — מודולי הלימוד בלבד;
// ארגז הכלים כאן הוא הגרסה של המוצר הכלכלי, והמעבר שלו לגדלים יחסיים — בנפרד.)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LEARN_MODS, moduleFiles } = require('./helpers/learn-modules');

const ROOT = path.join(__dirname, '..');
const PX_FONT = /font-size\s*:\s*[0-9.]+px|font\s*:[^;"'}]*?\b[0-9.]+px/g;

test('אין font-size / font בפיקסלים במודולי הלימוד', () => {
  const files = LEARN_MODS.flatMap(id => moduleFiles(id, /\.(css|html|js)$/));
  assert.ok(files.length > 8);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(PX_FONT)) bad.push(f + ': ' + m[0]);
  }
  assert.deepEqual(bad, []);
});
