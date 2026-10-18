// הגדרות הבנייה ל-Windows
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('קובץ ה-EXE נושא את שם התוכנה והאייקון שלה, ולא "Electron / GitHub, Inc."', () => {
  // signAndEditExecutable:false מבטל גם את עריכת המשאבים (אייקון, שם, גרסה) — ולא רק את החתימה.
  // לדילוג על חתימה בלבד: signExecutable:false (העריכה נעשית ב-resedit מקומי, בלי הורדות).
  assert.notEqual(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.win.signExecutable, false, 'אין תעודת חתימה — מדלגים על החתימה בלבד');
  assert.equal(pkg.build.productName, 'SuperSuite');
  assert.ok(pkg.build.copyright, 'זכויות יוצרים בפרטי הקובץ');
  assert.ok(pkg.build.win.icon);
});

test('CI: משימת הבדיקות מורידה היסטוריה מלאה (בדיקת השדרוג קוראת את 3.10.0 מ-git)', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8');
  const trainer = yml.slice(yml.indexOf('\n  trainer:'), yml.indexOf('\n  build:'));
  assert.match(trainer, /actions\/checkout@v4\s*\n\s*with:\s*\{\s*fetch-depth:\s*0\s*\}/);
});
