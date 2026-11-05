#!/usr/bin/env node
// בניית מהדורה (shell/edition.js, docs/SPLIT-3-PRODUCTS-PLAN.md שלב 3): מקור אחד ל-build-local.js ול-CI.
//
//   node tools/edition-build.js set <id>        כותב את shell/edition-id.js (במאגר — תמיד full; CI ובנייה מקומית)
//   node tools/edition-build.js --args <id>     הגדרות electron-builder למהדורה — דגל אחד בשורה (mapfile -t, כמו code-signing)
//   node tools/edition-build.js files <id>      קבצי ההפצה (מתקין ונייד), יחסית לשורש — שורה לכל קובץ
//   node tools/edition-build.js app <id>        תיקיית win-unpacked ושם ה-EXE, מופרדים בטאב (לבדיקת העלייה)
//   node tools/edition-build.js list            כל המהדורות, המלאה ראשונה
//
// המלאה נבנית כמו היום (dist/SuperSuite-Setup.exe, appId ותיקיית התקנה של היום) — קישורי ההורדה הקיימים לא משתנים.
// כל מהדורה אחרת — dist/<id>/ עם שם, appId, תיקיית התקנה וקיצורי דרך משלה.
// SS_EDITION_FILE — נתיב חלופי ל-edition-id.js (בדיקות: לא לגעת בקובץ של המאגר כשבדיקות אחרות רצות במקביל).
'use strict';
const fs = require('fs');
const path = require('path');
const Edition = require('../shell/edition');

const ROOT = path.join(__dirname, '..');
const editionFile = () => process.env.SS_EDITION_FILE || path.join(ROOT, 'shell', 'edition-id.js');

function need(id) {
  const ed = Edition.get(id);
  if (!ed) throw new Error(`מהדורה לא מוכרת: "${id}" — אחת מ: ${Edition.IDS.join(', ')}`);
  return ed;
}

// התוכן של edition-id.js לכל מהדורה — תבנית קבועה, לא קריאה של הקובץ: ב-CI הקבצים כבר מכווצים (tools/minify.js)
// לפני הבנייה. הקובץ שבמאגר זהה ל-editionIdSource('full') (tests/edition-build.test.js)
function editionIdSource(id) {
  need(id);
  return [
    '// המהדורה של הבנייה הזו — נכתב בזמן הבנייה (tools/edition-build.js set <id>; build-local.js --product, CI).',
    "// במאגר תמיד 'full' (המהדורה המלאה = ההתנהגות של היום). אין לערוך ידנית לפני commit — tests/edition.test.js בודק.",
    '(function (root) {',
    `  const id = '${id}';`,
    "  if (typeof module !== 'undefined' && module.exports) module.exports = id;",
    '  else root.SUITE_EDITION_ID = id;',
    "})(typeof window !== 'undefined' ? window : this);",
    '',
  ].join('\n');
}
function setEdition(id) {
  fs.writeFileSync(editionFile(), editionIdSource(id));
  return editionFile();
}

const outDir = (ed) => (ed.dist ? `dist/${ed.dist}` : 'dist');
const setupName = (ed) => (ed.id === 'full' ? 'SuperSuite-Setup.exe' : `${ed.artifact}-Setup.exe`);
const portableName = (ed) => (ed.id === 'full' ? 'SuperSuite-Portable.exe' : `${ed.artifact}-Portable.exe`);
const exeName = (ed) => `${ed.product}.exe`;

// הגדרות electron-builder (-c.x=y): המלאה — בלי שינוי (package.json כמו שהוא)
function builderArgs(id) {
  const ed = need(id);
  if (ed.id === 'full') return [];
  const args = [
    `-c.appId=${ed.appId}`,
    `-c.productName=${ed.product}`,
    `-c.extraMetadata.productName=${ed.product}`,
    `-c.directories.output=${outDir(ed)}`,
    `-c.nsis.artifactName=${ed.artifact}-Setup.\${ext}`,
    `-c.portable.artifactName=${portableName(ed)}`,
    `-c.nsis.shortcutName=${ed.product}`,
  ];
  // סמל משלה — אם הוכן (build/icon-<id>.ico, tools/make-icon.js); אחרת הסמל המשותף
  const icon = `build/icon-${ed.id}.ico`;
  if (fs.existsSync(path.join(ROOT, icon))) args.push(`-c.win.icon=${icon}`, `-c.icon=${icon}`);
  for (const a of args) if (/[\r\n]/.test(a)) throw new Error('ערך עם ירידת שורה');
  return args;
}

function files(id) {
  const ed = need(id);
  return [`${outDir(ed)}/${setupName(ed)}`, `${outDir(ed)}/${portableName(ed)}`];
}
function app(id) {
  const ed = need(id);
  return { dir: `${outDir(ed)}/win-unpacked`, exe: exeName(ed) };
}
// המלאה ראשונה: אם בנייה של מהדורה חלקית נכשלת, המתקין של היום כבר קיים
const ORDER = ['full', ...Edition.PARTIAL_IDS];

module.exports = { editionIdSource, setEdition, builderArgs, files, app, ORDER, setupName, portableName, exeName, outDir };

if (require.main === module) {
  const [cmd, id] = process.argv.slice(2);
  try {
    if (cmd === 'set') console.log('המהדורה: ' + need(id).name + ' ← ' + path.relative(ROOT, setEdition(id)));
    else if (cmd === '--args') process.stdout.write(builderArgs(id).map(a => a + '\n').join(''));
    else if (cmd === 'files') process.stdout.write(files(id).map(f => f + '\n').join(''));
    else if (cmd === 'app') { const a = app(id); process.stdout.write(a.dir + '\t' + a.exe + '\n'); }
    else if (cmd === 'list') process.stdout.write(ORDER.map(x => x + '\n').join(''));
    else { console.error('שימוש: node tools/edition-build.js set|--args|files|app <id> / list'); process.exitCode = 2; }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
