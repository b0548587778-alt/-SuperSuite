#!/usr/bin/env node
// מעבר לשלושה מאגרים (שלב 6 בתכנית docs/SPLIT-3-PRODUCTS-PLAN.md): מכין עותק של המאגר לתוכנה אחת.
//
//   node tools/split-product.js <npo|realty|acct> <תיקיית-יעד>
//
// מה נעשה: git clone של המאגר עם ההיסטוריה (רק מה שב-commit — בלי node_modules, dist ושינויים לא שמורים),
// edition-product.json בשורש (tools/edition-build.js: הבנייה וה-CI בונים רק את התוכנה הזו),
// package.json עם השם וה-appId של התוכנה, ו-build.yml שמפרסם רק את הקבצים שלה. שורת פתיחה ב-CLAUDE.md
// וב-README.md אומרת איזה מוצר זה.
// מה לא נעשה: הקוד של התחומים האחרים נשאר (השער של המהדורה סוגר אותם — shell/edition.js); הסרה שלו —
// בהמשך, בתוך כל מאגר, עם הבדיקות שלו. edition-id.js נשאר 'full' בקוד המקור: הבדיקות רצות על הכול,
// והמהדורה נקבעת בבנייה (tools/edition-build.js set).
// השינויים נשמרים ב-commit אחד. אחרי ההכנה: git remote add origin <המאגר הריק ב-GitHub> ו-git push -u origin master.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Edition = require('../shell/edition');
const EB = require('./edition-build');

const ROOT = path.join(__dirname, '..');

// build.yml: רק הקבצים של התוכנה הזו נשמרים לפרסום ומועלים (השורות של המהדורות האחרות נמחקות)
function workflowFor(yml, id) {
  const keep = new Set(EB.files(id));
  const all = Edition.IDS.flatMap(x => EB.files(x));
  const drop = all.filter(f => !keep.has(f));
  const lines = yml.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    // שורת נתיב בודדת ברשימת path: של המטמון
    if (drop.includes(line.trim())) continue;
    // שורת gh release / המשך שלה — מוציאים את הקבצים האחרים מתוכה
    let l = line;
    for (const f of drop) l = l.split(' ' + f).join('');
    if (l !== line && /^\s*\\?\s*$/.test(l.replace(/\\\s*$/, ''))) continue;
    // הודעות "פורסם:" של מוצרים אחרים
    if (/^\s*echo ".*releases\/latest\/download\//.test(l) && !EB.files(id).some(f => l.includes(path.basename(f)))) continue;
    out.push(l);
  }
  // המשך שורה (\) שנשאר אחרי הקובץ האחרון של הפקודה — מסירים, אחרת השורה הבאה נבלעת בפקודה
  for (let i = 0; i < out.length; i++) {
    if (/\\\s*$/.test(out[i]) && !(out[i + 1] && /^\s+dist\//.test(out[i + 1]))) out[i] = out[i].replace(/\s*\\\s*$/, '');
  }
  return out.join('\n');
}

function packageFor(pkg, id) {
  const ed = Edition.get(id);
  const p = JSON.parse(JSON.stringify(pkg));
  p.name = 'supersuite-' + id;
  p.productName = ed.product;
  p.build.appId = ed.appId;
  p.build.productName = ed.product;
  p.build.nsis.artifactName = `${ed.artifact}-Setup.\${ext}`;
  p.build.portable.artifactName = EB.portableName(ed);
  p.build.directories = { ...(p.build.directories || {}), output: EB.outDir(ed) };
  return p;
}

const banner = (id) => {
  const ed = Edition.get(id);
  return `> **מאגר המוצר ${ed.name}** (\`${id}\`, appId \`${ed.appId}\`) — נוצר ב-\`tools/split-product.js\` מהמאגר המשותף. ` +
    `הבנייה וה-CI בונים רק את התוכנה הזו (\`edition-product.json\`). תיקון בקוד המשותף — לעשות גם בשאר המאגרים.\n\n`;
};
function withBanner(md, id) {
  const i = md.indexOf('\n');
  return i < 0 ? banner(id) + md : md.slice(0, i + 1) + '\n' + banner(id) + md.slice(i + 1);
}

function split(id, dest, { root = ROOT } = {}) {
  const ed = Edition.get(id);
  if (!ed || id === 'full') throw new Error(`מוצר לא מוכר: "${id}" — אחד מ: ${Edition.PARTIAL_IDS.join(', ')} (המלאה נשארת במאגר הזה)`);
  if (!dest) throw new Error('חסרה תיקיית יעד');
  const target = path.resolve(dest);
  if (target === path.resolve(root) || target.startsWith(path.resolve(root) + path.sep)) throw new Error('תיקיית היעד חייבת להיות מחוץ למאגר');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('תיקיית היעד אינה ריקה: ' + target);
  // עותק עם ההיסטוריה (git clone): הבדיקות קוראות גרסאות ישנות מ-git (tests/at-rest.test.js — שדרוג מ-3.10.0),
  // ותיקון עתידי אפשר להעביר בין המאגרים ב-cherry-pick. רק מה שנשמר ב-commit — שינוי לא שמור לא עובר
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- git עם ארגומנטים קבועים, בלי shell
  git(['clone', '--quiet', '--no-local', '--no-hardlinks', path.resolve(root), target], root);
  git(['remote', 'remove', 'origin'], target);
  const files = git(['ls-files'], target).split('\n').filter(Boolean);
  fs.writeFileSync(path.join(target, 'edition-product.json'), JSON.stringify({ products: [id] }, null, 2) + '\n');
  const pkgFile = path.join(target, 'package.json');
  fs.writeFileSync(pkgFile, JSON.stringify(packageFor(JSON.parse(fs.readFileSync(pkgFile, 'utf8')), id), null, 2) + '\n');
  const wf = path.join(target, '.github', 'workflows', 'build.yml');
  if (fs.existsSync(wf)) fs.writeFileSync(wf, workflowFor(fs.readFileSync(wf, 'utf8'), id));
  for (const md of ['CLAUDE.md', 'README.md']) {
    const f = path.join(target, md);
    if (fs.existsSync(f)) fs.writeFileSync(f, withBanner(fs.readFileSync(f, 'utf8'), id));
  }
  // השינויים של המוצר ב-commit אחד, כדי שהמאגר מוכן לדחיפה
  git(['add', '-A'], target);
  git(['-c', 'user.name=SuperSuite', '-c', 'user.email=split@supersuite.invalid', 'commit', '--quiet', '-m',
    `מאגר המוצר ${ed.name} (tools/split-product.js ${id})`], target);
  return { target, files: files.length };
}

module.exports = { split, workflowFor, packageFor, withBanner };

if (require.main === module) {
  const [id, dest] = process.argv.slice(2);
  try {
    const r = split(id, dest);
    console.log(`הוכן מאגר ל-${Edition.get(id).name}: ${r.target} (${r.files} קבצים)`);
    console.log('הצעד הבא: git remote add origin <המאגר הריק ב-GitHub> ואז git push -u origin HEAD:master');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
