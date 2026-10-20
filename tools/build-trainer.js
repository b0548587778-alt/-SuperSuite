// בניית מודול האימונים מקוד המקור (PLAN.md 6.1): modules-src/trainer ← modules/trainer.
//   node tools/build-trainer.js           בנייה (דורש npm install ב-modules-src/trainer)
//   node tools/build-trainer.js --check   בדיקה מה חסר, בלי לבנות
// מה הסקריפט עושה אחרי vite build:
// - מעתיק את התוצר ל-modules/trainer ומוחק חבילות ישנות מ-assets (שם קובץ חדש בכל בנייה);
// - שומר את קובץ השילוב עם SuperSuite שאינו חלק מהבנייה: preload.js;
// - מוודא ששפת העיצוב (design-tokens.css, ui-kit.css) נטענת לפני ה-CSS של החבילה: ערכת הצבעים (src/theme.css)
//   נמצאת בתוך החבילה וממפה אליה, ובאותה עדיפות הכלל שנטען אחרון גובר (PLAN.md 6.4);
// - נכשל אם בתוצר יש פנייה לרשת (Google Fonts, CDN, שירות QR).
// בסביבה מסוננת (NetFree) npm install של vite נחסם — הבנייה רצה ב-GitHub Actions (.github/workflows/build.yml).
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'modules-src', 'trainer');
const OUT = path.join(ROOT, 'modules', 'trainer');
// קבצים ב-modules/trainer שאינם תוצר הבנייה — לא נמחקים ולא נדרסים
const KEEP = ['preload.js'];
const FORBIDDEN = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /api\.qrserver\.com/, /cdn\.jsdelivr\.net/, /unpkg\.com/];

// שפת העיצוב חייבת לבוא לפני ה-CSS של החבילה (Vite מוסיף אותו לסוף ה-head), ואין עוד ערכת צבעים חיצונית
function checkThemeOrder(html) {
  if (/suite-theme\.css/.test(html)) throw new Error('index.html: suite-theme.css הוסר — ערכת הצבעים ב-src/theme.css');
  const bundle = html.search(/<link rel="stylesheet"[^>]*href="\/assets\//);
  for (const href of ['/design-tokens.css', '/ui-kit.css']) {
    const at = html.indexOf(`href="${href}"`);
    if (at < 0) throw new Error('index.html: חסר הקישור ל-' + href);
    if (bundle >= 0 && at > bundle) throw new Error('index.html: ' + href + ' אחרי ה-CSS של החבילה');
  }
  for (const src of ['/screen-guard.js', '/ss-dialog.js']) {
    if (!html.includes(`<script src="${src}"></script>`)) throw new Error('index.html: חסר ' + src);
  }
  return html;
}

function findForbidden(dir) {
  const hits = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|html|css|webmanifest)$/.test(n)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${path.relative(dir, p)}: ${re.source}`);
    }
  })(dir);
  return hits;
}

// העתקת התוצר: מחיקת כל מה שאינו ב-KEEP, ואז העתקה
function install(dist, out = OUT) {
  for (const n of fs.readdirSync(out)) {
    if (KEEP.includes(n)) continue;
    fs.rmSync(path.join(out, n), { recursive: true, force: true });
  }
  fs.cpSync(dist, out, { recursive: true });
  for (const k of KEEP) if (!fs.existsSync(path.join(out, k))) throw new Error('חסר קובץ שילוב: ' + k);
  const index = path.join(out, 'index.html');
  checkThemeOrder(fs.readFileSync(index, 'utf8'));
  // ערכת הצבעים הישנה, אם נשארה מבנייה קודמת
  fs.rmSync(path.join(out, 'suite-theme.css'), { force: true });
}

function check() {
  const problems = [];
  if (!fs.existsSync(path.join(SRC, 'package.json'))) problems.push('לא נמצא קוד המקור ב-modules-src/trainer');
  const vite = path.join(SRC, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) problems.push('vite לא מותקן: יש להריץ "npm install" בתיקייה modules-src/trainer (בסביבה מסוננת — לבנות ב-GitHub Actions)');
  for (const k of KEEP) if (!fs.existsSync(path.join(OUT, k))) problems.push('חסר ב-modules/trainer: ' + k);
  return { ok: problems.length === 0, problems, vite };
}

function main(argv) {
  const c = check();
  if (argv.includes('--check')) {
    console.log(c.ok ? '✔ אפשר לבנות את מודול האימונים' : c.problems.map(p => '✖ ' + p).join('\n'));
    return c.ok ? 0 : 1;
  }
  if (!c.ok) { console.error(c.problems.map(p => '✖ ' + p).join('\n')); return 1; }
  // בלי shell: נתיב הפרויקט עלול להכיל רווח
  const r = spawnSync(process.execPath, [c.vite, 'build'], { cwd: SRC, stdio: 'inherit' });
  if (r.status !== 0) { console.error('✖ הבנייה נכשלה'); return r.status || 1; }
  const dist = path.join(SRC, 'dist');
  const bad = findForbidden(dist);
  if (bad.length) { console.error('✖ בתוצר יש פנייה לרשת:\n' + bad.join('\n')); return 1; }
  install(dist);
  console.log('✔ מודול האימונים נבנה והועתק ל-modules/trainer');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkThemeOrder, findForbidden, install, check, KEEP, FORBIDDEN };
