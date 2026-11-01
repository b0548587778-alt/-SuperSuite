// ממצאי CodeQL בקוד המוצר (1.11.2026): caseSetPath בתיק השמאות לא כותב למפתחות אב-טיפוס,
// ו-pctToBp מסיר את כל סימני האחוז (לא רק את הראשון)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RE = require('../modules/econ/core/realEstateAppraisal');

function loadSetPath() {
  const src = fs.readFileSync(path.join(__dirname, '../modules/shamai/src/case-ui.js'), 'utf8');
  const keys = /const CASE_UNSAFE_KEYS = [^\n]*\n/.exec(src);
  const fn = /function caseSetPath\(obj, path, value\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(keys && fn, 'נמצאו ההגדרות');
  const ctx = vm.createContext({});
  vm.runInContext(keys[0] + fn[0] + '\nthis.caseSetPath = caseSetPath;', ctx);
  return ctx.caseSetPath;
}

test('caseSetPath: כותב לנתיב רגיל, ודוחה __proto__ / constructor / prototype', () => {
  const set = loadSetPath();
  const c = { client: { name: '' } };
  set(c, 'client.name', 'משה');
  assert.equal(c.client.name, 'משה');
  set(c, '__proto__.polluted', 'כן');
  set(c, 'constructor.prototype.polluted', 'כן');
  set(c, 'client.__proto__.polluted', 'כן');
  assert.equal(({}).polluted, undefined, 'Object.prototype לא שונה');
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('pctToBp: "5%" תקין, "5%%" — כל סימני האחוז מוסרים', () => {
  assert.equal(RE.pctToBp('5%', 'התאמה'), 500);
  assert.equal(RE.pctToBp('-2.5%', 'התאמה'), -250);
  assert.equal(RE.pctToBp('5%%', 'התאמה'), 500);
  assert.throws(() => RE.pctToBp('5%x', 'התאמה'), /יש להזין אחוז/);
});
