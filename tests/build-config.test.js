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
  assert.match(build, /actions\/checkout@v4\s*\n\s*with:\s*\{\s*fetch-depth:\s*0[,\s}]/);
});

test('CI: המתקין אורז את מודול האימונים שנבנה מהמקור באותה ריצה (PLAN.md 6.1)', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  report:'));
  const iTrainer = build.indexOf('node tools/build-trainer.js');
  assert.ok(iTrainer > 0 && iTrainer < build.indexOf('node node_modules/electron-builder/out/cli/cli.js'), 'המודול נבנה באותה משימה, לפני האריזה');
  assert.match(yml, /if \[ -f package-lock\.json \]; then CMD="npm ci"/);
});

test('CI: בלי artifacts בין משימות — מכסת אחסון מלאה לא עוצרת את הבנייה, והיומנים מגיעים ל-ci-status', () => {
  // ריצות #54–#59: הבדיקות עברו, ההעלאה נכשלה על המכסה, והבנייה דולגה בלי יומנים
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(yml, /upload-artifact|download-artifact/);
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  publish:'));
  const i = build.indexOf('- name: logs for report');
  assert.ok(i > build.indexOf('node tools/smoke-packaged.js'), 'הצעד האחרון');
  assert.match(build.slice(i, i + 200), /if: always\(\)[\s\S]*actions\/cache\/save@v4[\s\S]*path: ci-logs/);
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
  // היומנים של הריצה הזו בלבד (מפתח לפי מספר הריצה והניסיון), גם כשמשימת build נכשלה
  assert.match(report, /actions\/cache\/restore@v4[\s\S]*key: ci-logs-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(report, /actions\/artifacts/, 'אין artifacts — אין מה לספור או למחוק');
  assert.doesNotMatch(report, /actions: write/);
});

test('CI: קוד של צד שלישי רץ בלי טוקן כתיבה — רק משימת report דוחפת, וריצה אחת בכל פעם', () => {
  // משימת build מריצה npm install / electron-builder: סקריפט התקנה זדוני לא יכול לדחוף למאגר או לקרוא את טוקן הפרסום
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  // בלי שורות ההערה (ההערה של משימת publish נמצאת לפני הכותרת שלה)
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  publish:')).replace(/^\s*#.*$/gm, '');
  assert.match(build, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(build, /contents: write|GITHUB_TOKEN|SS_DOWNLOADS_TOKEN|git push/);
  assert.match(build, /actions\/checkout@v4\s*\n\s*with:\s*\{[^}]*persist-credentials: false/, 'הטוקן לא נשאר ב-.git/config');
  // ci-status נדרס בכל ריצה — שתי ריצות חופפות היו מוחקות זו לזו את היומנים
  assert.match(yml, /\nconcurrency:\n\s+group: ci-status\n\s+cancel-in-progress: false/);
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
