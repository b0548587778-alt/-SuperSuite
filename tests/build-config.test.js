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

test('CI: המתקין אורז את מודול האימונים שנבנה מהמקור באותה ריצה (PLAN.md 6.1)', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  publish:'));
  require('assert').match(build, /needs: \[trainer\]/);
  const dl = build.indexOf('name: trainer-module');
  require('assert').ok(build.indexOf('rm -rf modules/trainer') < dl && dl > 0 && dl < build.indexOf('electron-builder'), 'המודול הבנוי לא מחליף את העותק שבמאגר לפני האריזה');
  require('assert').match(yml, /if \[ -f package-lock\.json \]; then CMD="npm ci"/);
});

test('המודל המקומי: node-llama-cpp תלות אופציונלית, הקבצים הטבעיים מחוץ ל-asar, בלי CUDA, והרישיון ב-NOTICES', () => {
  // אופציונלית — npm install בסביבה מסוננת לא נכשל בגללה; בלעדיה העוזר עובד בכללים בלבד (runtimeAvailable)
  assert.ok(pkg.optionalDependencies && pkg.optionalDependencies['node-llama-cpp']);
  assert.ok(!(pkg.dependencies || {})['node-llama-cpp'], 'לא תלות חובה');
  // קובץ ‎.node לא נטען מתוך app.asar
  assert.ok(pkg.build.asarUnpack.includes('node_modules/node-llama-cpp/**'));
  assert.ok(pkg.build.asarUnpack.includes('node_modules/@node-llama-cpp/**'));
  assert.ok(pkg.build.files.includes('!node_modules/@node-llama-cpp/*cuda*/**'), 'גרסת CUDA (מאות MB) לא נארזת');
  assert.equal(pkg.build.npmRebuild, false, 'בינאריים מוכנים — בלי בניית llama.cpp בזמן האריזה');
  const notices = require('fs').readFileSync(require('path').join(__dirname, '..', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.match(notices, /node-llama-cpp/);
  assert.match(notices, /llama\.cpp/);
});
