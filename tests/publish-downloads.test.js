// פרסום למאגר ההורדות הציבורי (PLAN.md 1.1) — בדיקה סטטית של ה-workflow
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
const publish = yml.slice(yml.indexOf('\n  publish:\n'), yml.indexOf('\n  report:\n'));

test('פרסום רק מתגית גרסה או בהפעלה ידנית, ורק אחרי בנייה שעברה', () => {
  assert.ok(publish.length > 100, 'יש משימת publish');
  assert.match(yml, /tags: \['v\*'\]/);
  assert.match(publish, /needs: \[build\]/);
  assert.match(publish, /inputs\.publish \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(publish, /needs\.build\.result == 'success'/);
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
  assert.match(yml, /needs: \[trainer, build, publish\]/);
  assert.match(yml, /needs\.publish\.result/);
});

test('יש מדריך לבעלים', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'DOWNLOADS.md'), 'utf8');
  assert.match(doc, /releases\/latest\/download\/SuperSuite-Setup\.exe/);
  assert.match(doc, /SS_DOWNLOADS_TOKEN/);
  assert.match(doc, /SS_DOWNLOADS_REPO/);
});
