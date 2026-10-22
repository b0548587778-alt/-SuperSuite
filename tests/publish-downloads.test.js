// פרסום למאגר ההורדות הציבורי (PLAN.md 1.1) — בדיקה סטטית של ה-workflow
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
// הפרסום — צעד במשימת build (בלי artifact בין משימות), מ-"GitHub Release" עד הצעד הבא
const build = yml.slice(yml.indexOf('\n  build:\n'), yml.indexOf('\n  report:\n'));
const publish = build.slice(build.indexOf('- name: GitHub Release'), build.indexOf('- name: logs to ci-status'));

test('פרסום רק מתגית גרסה או בהפעלה ידנית, ורק אחרי בנייה ובדיקת עלייה שעברו', () => {
  assert.ok(publish.length > 100, 'יש צעד פרסום');
  assert.match(yml, /tags: \['v\*'\]/);
  assert.match(publish, /if: \$\{\{ inputs\.publish \|\| startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/);
  // צעד בלי always() רץ רק אם כל הצעדים שלפניו עברו — כולל האריזה ובדיקת העלייה
  assert.doesNotMatch(publish, /always\(\)|failure\(\)/);
  assert.ok(build.indexOf('node tools/smoke-packaged.js') < build.indexOf('- name: GitHub Release'));
});

test('פרסום למאגר נפרד בטוקן ייעודי — לא GITHUB_TOKEN ולא המאגר הפרטי', () => {
  assert.match(publish, /secrets\.SS_DOWNLOADS_TOKEN/);
  assert.match(publish, /vars\.SS_DOWNLOADS_REPO/);
  assert.match(publish, /--repo "\$REPO"/);
  assert.doesNotMatch(publish, /GITHUB_TOKEN|GITHUB_REPOSITORY/);
});

test('גרסה קיימת לא נדרסת, ותגית שלא תואמת את package.json לא מפורסמת', () => {
  assert.match(publish, /gh release view "v\$V"/);
  assert.match(publish, /GITHUB_REF_NAME\}" != "v\$V"/);
  assert.match(publish, /SuperSuite-Setup\.exe/);
});

test('electron-builder עצמו לא מפרסם, והתוצאה מגיעה ל-ci-status', () => {
  assert.match(yml, /--publish never/);
  assert.match(yml, /publish: \$\{\{ steps\.publish\.outcome \}\}/);
  assert.match(yml, /needs\.build\.outputs\.publish/);
});

test('יש מדריך לבעלים', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'DOWNLOADS.md'), 'utf8');
  assert.match(doc, /releases\/latest\/download\/SuperSuite-Setup\.exe/);
  assert.match(doc, /SS_DOWNLOADS_TOKEN/);
  assert.match(doc, /SS_DOWNLOADS_REPO/);
});
