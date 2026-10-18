// כיווץ קוד ה-JavaScript לגרסת הפצה (PLAN.md 3.5) — רץ ב-GitHub Actions בלבד (esbuild נחסם ב-NetFree).
// מכווץ במקום את קבצי הבנייה (package.json → build.files) — ולכן רץ רק כש-CI מוגדר:
// ב-GitHub העותק נזרק אחרי הבנייה; במחשב הפרויקט לא משתנה לעולם.
//
// כללים:
// - בלי שינוי שמות ברמה העליונה: ב-modules/econ/ui/*.js כל הקבצים חולקים טווח שמות גלובלי (CLAUDE.md),
//   ו-main.js / preload / שירותים מייצאים שמות. לכן minifyIdentifiers רק בתוך פונקציות (esbuild עושה זאת
//   כשהקובץ אינו מודול ES — format לא מוגדר), ובקבצים הגלובליים: רק רווחים והערות.
// - מודול האימונים כבר מכווץ (Vite) — לא נוגעים בו, חוץ מ-preload.js.
// - קובץ שהכיווץ נכשל בו — הבנייה נכשלת (לא נארז קוד חצי מכווץ).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// קבצים שהשמות ברמה העליונה שלהם משותפים לכמה קבצים (סקריפטים רגילים בדף) — רק רווחים
const GLOBAL_SCOPE = [/^modules[\\/]econ[\\/]ui[\\/]/, /^shell[\\/](shell|catalog|hebcal|onboarding|history)\.js$/, /^modules[\\/](tools|shamai)[\\/]/];
// קבצים שלא מכווצים בכלל
const SKIP = [/^modules[\\/]trainer[\\/](?!preload\.js$)/, /\.min\.js$/, /[\\/]sw\.js$/, /[\\/]lib[\\/]/];

const rel = (f) => path.relative(ROOT, f);
const matches = (list, r) => list.some(re => re.test(r));

// אוסף את הקבצים לפי build.files (תבניות פשוטות: קובץ, או תיקייה/**/*)
function buildFiles(pkg) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else out.push(p);
    }
  };
  for (const pattern of pkg.build.files) {
    const m = pattern.match(/^(.*)\/\*\*\/\*$/);
    const p = path.join(ROOT, m ? m[1] : pattern);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p); else out.push(p);
  }
  return out;
}

// מצב הכיווץ לקובץ: null = העתקה כמו שהוא
function modeFor(r) {
  if (!r.endsWith('.js') || matches(SKIP, r)) return null;
  return matches(GLOBAL_SCOPE, r) ? 'whitespace' : 'full';
}

function optionsFor(mode) {
  // אין format: הקוד נשאר CommonJS / סקריפט רגיל, ו-esbuild לא משנה שמות ברמה העליונה
  const base = { target: 'es2022', charset: 'utf8', legalComments: 'none', minifyWhitespace: true, minifySyntax: true };
  return mode === 'full' ? { ...base, minifyIdentifiers: true } : { ...base, minifyIdentifiers: false };
}

// files: רשימת קבצים (ברירת מחדל: build.files). כל קובץ JS מוחלף בגרסה המכווצת שלו
async function run({ files, esbuild = require('esbuild'), log = console.log, env = process.env } = {}) {
  if (!env.CI) throw new Error('הכיווץ משנה קבצים במקום — רץ רק ב-CI (GitHub Actions)');
  const list = files || buildFiles(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
  let before = 0, after = 0, count = 0;
  // קודם מכווצים הכול לזיכרון, ורק אז כותבים — כישלון באמצע לא משאיר קוד חצי מכווץ
  const out = [];
  for (const f of list) {
    const r = rel(f);
    const mode = modeFor(r);
    if (!mode) continue;
    const src = fs.readFileSync(f, 'utf8');
    let code;
    try { code = (await esbuild.transform(src, { ...optionsFor(mode), sourcefile: r })).code; }
    catch (e) { throw new Error(`הכיווץ נכשל ב-${r}: ${e.message}`); }
    out.push([f, code]);
    before += src.length; after += code.length; count++;
  }
  for (const [f, code] of out) fs.writeFileSync(f, code);
  log(`כווצו ${count} קבצים: ${Math.round(before / 1024)}KB ← ${Math.round(after / 1024)}KB`);
  return { count, before, after };
}

if (require.main === module) {
  run().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { run, modeFor, optionsFor, buildFiles, GLOBAL_SCOPE, SKIP };
