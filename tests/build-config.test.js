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
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  assert.match(build, /npm test/);
  assert.match(build, /actions\/checkout@v4\s*\n\s*with:\s*\{\s*fetch-depth:\s*0\s*\}/);
});

test('CI: המתקין אורז את מודול האימונים שנבנה מהמקור באותה ריצה (PLAN.md 6.1)', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const iTrainer = build.indexOf('node tools/build-trainer.js');
  assert.ok(iTrainer > 0 && iTrainer < build.indexOf('npx electron-builder'), 'המודול נבנה באותה משימה, לפני האריזה');
  assert.match(yml, /if \[ -f package-lock\.json \]; then CMD="npm ci"/);
});

test('CI: בלי artifacts בין משימות — מכסת אחסון מלאה לא עוצרת את הבנייה, והיומנים מגיעים ל-ci-status', () => {
  // ריצות #54–#59: הבדיקות עברו, ההעלאה נכשלה על המכסה, והבנייה דולגה בלי יומנים
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(yml, /upload-artifact|download-artifact/);
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const i = build.indexOf('- name: logs to ci-status');
  assert.ok(i > build.indexOf('node tools/smoke-packaged.js'), 'הצעד האחרון');
  assert.match(build.slice(i, i + 120), /if: always\(\)/);
  assert.match(build, /cp -r modules\/trainer ci-logs\/trainer-module/);
  assert.ok(build.indexOf('cp -r modules/trainer') < build.indexOf('node tools/minify.js'), 'המודול למחשב — לפני הכיווץ');
  // קובץ הנעילה של השורש נשמר, ו-npm ci רק כשהוא כולל את node-llama-cpp
  assert.match(build, /cp package-lock\.json ci-logs\/root-package-lock\.json/);
  assert.match(build, /grep -q '"node_modules\/node-llama-cpp"' package-lock\.json; then CMD="npm ci"/);
});

test('CI: הדוח ממתין שהמשימות ייסגרו לפני שהוא קורא את הודעות השגיאה', () => {
  // ריצה #59: המשימה עוד סומנה in_progress, ולכן לא נרשמה אף הודעת שגיאה
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const report = yml.slice(yml.indexOf('\n  report:'));
  const iWait = report.indexOf('.status != "completed"');
  assert.ok(iWait > 0 && iWait < report.indexOf('check-runs/$id/annotations'));
  assert.ok(report.includes('git log -1 --format=%s FETCH_HEAD | grep -q "^CI #$GITHUB_RUN_NUMBER "'), 'מעל היומנים של אותה ריצה בלבד');
});

test('המודל המקומי: node-llama-cpp תלות אופציונלית, הקבצים הטבעיים מחוץ ל-asar, בלי CUDA, והרישיון ב-NOTICES', () => {
  // אופציונלית — npm install בסביבה מסוננת לא נכשל בגללה; בלעדיה העוזר עובד בכללים בלבד (runtimeAvailable)
  assert.ok(pkg.optionalDependencies && pkg.optionalDependencies['node-llama-cpp']);
  assert.ok(!(pkg.dependencies || {})['node-llama-cpp'], 'לא תלות חובה');
  // קובץ ‎.node לא נטען מתוך app.asar
  assert.ok(pkg.build.asarUnpack.includes('node_modules/node-llama-cpp/**'));
  assert.ok(pkg.build.asarUnpack.includes('node_modules/@node-llama-cpp/**'));
  assert.ok(pkg.build.files.includes('!node_modules/@node-llama-cpp/*cuda*/**'), 'גרסת CUDA (מאות MB) לא נארזת');
  assert.ok(pkg.build.files.includes('!node_modules/@node-llama-cpp/*vulkan*/**'), 'גם לא Vulkan — מעבד בלבד');
  const worker = require('fs').readFileSync(require('path').join(__dirname, '..', 'shell', 'ai', 'engines', 'llm-worker.js'), 'utf8');
  assert.match(worker, /getLlama\(\{[^}]*gpu: false/, 'התהליך לא מחפש גרסה גרפית שלא נארזה');
  assert.equal(pkg.build.npmRebuild, false, 'בינאריים מוכנים — בלי בניית llama.cpp בזמן האריזה');
  const notices = require('fs').readFileSync(require('path').join(__dirname, '..', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.match(notices, /node-llama-cpp/);
  assert.match(notices, /llama\.cpp/);
});
