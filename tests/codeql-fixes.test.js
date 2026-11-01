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

test('אייקון במצב ריק עובר esc, ותמונה מוגדלת בשמאי מקבלת src דרך המאפיין (js/xss-through-dom)', () => {
  const core = fs.readFileSync(path.join(__dirname, '../modules/econ/ui/core.js'), 'utf8');
  assert.match(/function emptyIcon\(view\) \{[\s\S]*?\n\}/.exec(core)[0], /return esc\(icon \|\| '📭'\);/);
  const opp = fs.readFileSync(path.join(__dirname, '../modules/shamai/src/opp-extras.js'), 'utf8');
  const zoom = /function showPhotoZoom\(src\) \{[\s\S]*?\n\}/.exec(opp)[0];
  assert.doesNotMatch(zoom, /\$\{src\}/, 'הכתובת לא נכנסת לתבנית ה-HTML');
  assert.match(zoom, /querySelector\('img'\)\.src = String\(src \|\| ''\)/);
  // בדיקה התנהגותית: כתובת עם מרכאות ותג לא יוצרת אלמנט נוסף
  let html = '';
  const img = { src: '' };
  const modal = { className: '', set innerHTML(v) { html = v; }, querySelector: () => img, addEventListener() {}, remove() {} };
  const ctx = vm.createContext({ document: { createElement: () => modal, body: { appendChild() {} } } });
  vm.runInContext(zoom + '\nthis.showPhotoZoom = showPhotoZoom;', ctx);
  ctx.showPhotoZoom('x" onerror="alert(1)');
  assert.doesNotMatch(html, /onerror/);
  assert.equal(img.src, 'x" onerror="alert(1)');
});

test('רשימת החריגים של CodeQL: לכל חריג כלל, קובץ קיים ונימוק', () => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '../.github/codeql/allowlist.json'), 'utf8'));
  assert.ok(Array.isArray(list) && list.length > 0);
  for (const a of list) {
    assert.match(a.rule, /^(js|py)\/[a-z-]+$/, a.rule);
    assert.ok(fs.existsSync(path.join(__dirname, '..', a.path)), a.path);
    assert.ok(String(a.reason || '').length > 20, 'נימוק: ' + a.path);
  }
});
