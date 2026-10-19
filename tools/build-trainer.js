// בניית מודול האימונים מקוד המקור (PLAN.md 6.1): modules-src/trainer ← modules/trainer.
//   node tools/build-trainer.js           בנייה (דורש npm install ב-modules-src/trainer)
//   node tools/build-trainer.js --check   בדיקה מה חסר, בלי לבנות
// מה הסקריפט עושה אחרי vite build:
// - מעתיק את התוצר ל-modules/trainer ומוחק חבילות ישנות מ-assets (שם קובץ חדש בכל בנייה);
// - שומר את קבצי השילוב עם SuperSuite שאינם חלק מהבנייה: preload.js, suite-theme.css;
// - מזיז את suite-theme.css לסוף ה-head — Vite מוסיף את ה-CSS המהודר אחריו, ואז ערכת הצבעים לא גוברת;
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
const KEEP = ['preload.js', 'suite-theme.css'];
const FORBIDDEN = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /api\.qrserver\.com/, /cdn\.jsdelivr\.net/, /unpkg\.com/];

// ערכת הצבעים חייבת לבוא אחרי כל CSS אחר ב-head
// רשת הביטחון (screen-guard.js, PLAN.md 2.4) וחלון ההודעה המשותף (ss-dialog.js) נשארים מיד אחריה
function fixThemeOrder(html) {
  const tag = /\s*<link rel="stylesheet" href="\/suite-theme\.css">/;
  const guard = /\s*(<!--[^>]*2\.4[^>]*-->\s*)?<script src="\/screen-guard\.js"><\/script>/;
  const dialog = /\s*<script src="\/ss-dialog\.js"><\/script>/;
  if (!tag.test(html)) throw new Error('index.html: חסר הקישור ל-suite-theme.css');
  const out = html.replace(tag, '').replace(guard, '').replace(dialog, '');
  return out.replace('</head>', '    <!-- ערכת הצבעים של SuperSuite — אחרי ה-CSS המהודר כדי לגבור עליו -->\n    <link rel="stylesheet" href="/suite-theme.css">\n    <script src="/screen-guard.js"></script>\n    <script src="/ss-dialog.js"></script>\n  </head>');
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
  fs.writeFileSync(index, fixThemeOrder(fs.readFileSync(index, 'utf8')));
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

module.exports = { fixThemeOrder, findForbidden, install, check, KEEP, FORBIDDEN };
