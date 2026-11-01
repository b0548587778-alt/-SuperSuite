// בדיקות על הגרסה הארוזה (PLAN.md 3.5) — רץ ב-GitHub Actions אחרי electron-builder.
// 1. --smoke: התוכנה המכווצת עולה, וכל המודולים נטענים בלי שגיאות.
// 2. פרמטר דיבוג (--remote-debugging-port, --inspect): התוכנה מסרבת לעלות.
// 3. החלפת קובץ בתוך app.asar: התוכנה מסרבת לעלות (בדיקת השלמות של Electron).
// כל הרצה עם תיקיית נתונים זמנית — בלי לגעת בנתונים אמיתיים. התוצאה ב-ci-logs/smoke.log.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'dist', 'win-unpacked');
const EXE = path.join(APP, 'SuperSuite.exe');
const LOG = process.env.SMOKE_LOG || path.join(ROOT, 'ci-logs', 'smoke.log');

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-smoke-' + n + '-'));

function launch(exe, args, timeout = 150 * 1000) {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- כלי CI; מריץ את התוכנה הארוזה עצמה, בלי shell
  const r = spawnSync(exe, args, { timeout, encoding: 'utf8', windowsHide: true });
  return { code: r.status, signal: r.signal, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), error: r.error && r.error.message };
}

function checkSmoke() {
  const dir = tmp('ok');
  const r = launch(EXE, ['--smoke', `--user-data-dir=${dir}`]);
  let result = null;
  try { result = JSON.parse(fs.readFileSync(path.join(dir, 'smoke.json'), 'utf8')); } catch { /* לא נכתב */ }
  log(`smoke: יציאה ${r.code}${r.timedOut ? ' (זמן תם)' : ''}`);
  if (result) {
    log(`  נטענו: ${result.loaded.join(', ')} (${result.ms}ms)`);
    for (const e of result.errors) log(`  שגיאה [${e.where}] ${e.message}`);
  } else log('  smoke.json לא נכתב');
  return r.code === 0 && result && result.ok;
}

// התוכנה לא אמורה לעלות: יציאה עם קוד שאינו 0, ובלי smoke.json (לא הגיעה לבדיקה)
function refuses(name, exe, args) {
  const dir = tmp(name);
  const r = launch(exe, [...args, '--smoke', `--user-data-dir=${dir}`], 60 * 1000);
  const ran = fs.existsSync(path.join(dir, 'smoke.json'));
  const ok = !ran && r.code !== 0;
  log(`${name}: ${ok ? 'מסרבת לעלות ✓' : 'עלתה! ✗'} (יציאה ${r.code}${r.timedOut ? ', זמן תם' : ''}${ran ? ', smoke רץ' : ''})`);
  return ok;
}

function checkTamper() {
  const asar = require('@electron/asar');
  const copy = tmp('tamper-app');
  fs.cpSync(APP, copy, { recursive: true });
  const archive = path.join(copy, 'resources', 'app.asar');
  const ex = tmp('tamper-src');
  asar.extractAll(archive, ex);
  // שינוי קטן בקובץ אחד, ואריזה מחדש
  fs.appendFileSync(path.join(ex, 'main.js'), '\n// tampered\n');
  return asar.createPackage(ex, archive).then(() => refuses('tamper', path.join(copy, 'SuperSuite.exe'), []));
}

async function main() {
  if (!fs.existsSync(EXE)) throw new Error('לא נמצא ' + EXE);
  const results = {
    smoke: checkSmoke(),
    debugPort: refuses('debug-port', EXE, ['--remote-debugging-port=9222']),
    inspect: refuses('inspect', EXE, ['--inspect=9229']),
    tamper: await checkTamper(),
  };
  const ok = Object.values(results).every(Boolean);
  log(`סיכום: ${ok ? 'עבר' : 'נכשל'} ${JSON.stringify(results)}`);
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, lines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main().catch((e) => { log('שגיאה: ' + e.message); fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, lines.join('\n') + '\n'); process.exit(1); });

module.exports = { refuses, launch };
