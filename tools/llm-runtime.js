#!/usr/bin/env node
// רכיב ההרצה של המודל המקומי (node-llama-cpp) למחשב בסביבה מסוננת — NetFree חוסם את ההורדה מ-npm.
// ב-CI ההתקנה מצליחה; הסקריפט אורז את החבילה עם כל התלויות שלה לתיקייה אחת ב-ci-status,
// ובמחשב מעתיק אותה ל-node_modules, כך ש-build-local.js אורז אותה במתקין.
//
//   node tools/llm-runtime.js pack <תיקייה>   — ב-CI, אחרי ה-Build: npm ci --ignore-scripts מקובץ הנעילה הייעודי
//   node tools/llm-runtime.js fetch            — במחשב: git fetch של ci-status והתקנה
//   node tools/llm-runtime.js install <תיקייה> — במחשב: התקנה מתיקייה שכבר קיימת
//
// המבנה: הכול בתוך node_modules/node-llama-cpp — התלויות ב-node_modules שלה, ושום חבילה של הפרויקט לא נדרסת.
// את הסידור עושה npm עצמו: התקנה בתיקייה נפרדת עם --install-strategy=shallow (רק החבילה בשורש,
// כל התלויות מתחתיה). העתקה "שטוחה" מקובץ הנעילה של הפרויקט נכשלה בריצה #62: אותה חבילה בשתי גרסאות
// (ansi-regex בשורש ובתוך node-llama-cpp) הייתה צריכה את אותו מקום.
// גרסאות CUDA / Vulkan לא נארזות (כמו ב-package.json).
//
// קובץ נעילה ייעודי (סקירת קוד 2.11.2026): tools/llm-runtime-deps — package.json, package-lock.json ו-.npmrc
// (install-strategy=shallow). ההתקנה — npm ci --ignore-scripts: אותן גרסאות בדיוק בכל ריצה, ושום סקריפט התקנה
// של כ-140 התלויות לא רץ. הגרסה של node-llama-cpp וה-overrides חייבים להיות זהים לשורש (אחרת — שגיאה).
// לעדכון: בתיקייה — npm install --package-lock-only --ignore-scripts, ולבדוק שהגרסאות קיימות בקובץ הנעילה של השורש.
// ב-llm-runtime.json נרשם SHA-256 של העץ הארוז (treeHash); install מאמת אותו לפני ההעתקה.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT_PKG = 'node-llama-cpp';
const MANIFEST = 'llm-runtime.json';
const SKIP = /cuda|vulkan/i;
const DEPS_DIR = path.join('tools', 'llm-runtime-deps');
const DEPS_FILES = ['package.json', 'package-lock.json', '.npmrc'];

// ההתקנה בתיקייה הנפרדת — ברירת המחדל: npm ci מקובץ הנעילה, בלי סקריפטים. בבדיקות מוחלפת
const NPM_CI_ARGS = ['ci', '--ignore-scripts', '--install-strategy=shallow', '--omit=dev', '--no-audit', '--no-fund'];
function npmInstall(dir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, NPM_CI_ARGS, {
    cwd: dir, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: 'true' },
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function lockedVersion(dir) {
  const lock = readJson(path.join(dir, 'package-lock.json'));
  const info = lock && lock.packages && lock.packages['node_modules/' + ROOT_PKG];
  return info && info.version || null;
}

// טביעת SHA-256 של עץ קבצים: נתיב יחסי (/) ותמצית כל קובץ, בסדר קבוע — זהה בכל מערכת הפעלה
function treeHash(dir) {
  const files = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else files.push([r, path.join(d, e.name)]);
    }
  })(dir, '');
  const h = crypto.createHash('sha256');
  for (const [r, f] of files) h.update(r + '\0' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') + '\n');
  return h.digest('hex');
}

// רכיבי @node-llama-cpp שנארזו (בלי CUDA / Vulkan — נמחקים)
function pruneBinaries(pkgDir) {
  const scope = path.join(pkgDir, 'node_modules', '@node-llama-cpp');
  if (!fs.existsSync(scope)) return [];
  const kept = [];
  for (const name of fs.readdirSync(scope)) {
    if (SKIP.test(name)) fs.rmSync(path.join(scope, name), { recursive: true, force: true });
    else kept.push(name);
  }
  return kept.sort();
}

function pack(projectDir, outDir, { installer = npmInstall, depsDir = path.join(projectDir, DEPS_DIR) } = {}) {
  const version = lockedVersion(depsDir);
  if (!version) return { packed: false, reason: 'אין קובץ נעילה ל-' + ROOT_PKG + ' ב-' + DEPS_DIR };
  // קובץ הנעילה הייעודי מול השורש: אותה גרסה ואותם overrides (גרסה מתוקנת של תלות) — אחרת נארזת גרסה אחרת מהנבדקת
  const rootVersion = lockedVersion(projectDir);
  if (rootVersion && rootVersion !== version) {
    throw new Error(`הגרסה בקובץ הנעילה הייעודי (${version}) שונה מהשורש (${rootVersion}) — לעדכן את ${DEPS_DIR}`);
  }
  const depsPkg = readJson(path.join(depsDir, 'package.json')) || {};
  const rootPkg = readJson(path.join(projectDir, 'package.json')) || {};
  if (JSON.stringify(depsPkg.overrides || {}) !== JSON.stringify(rootPkg.overrides || {})) {
    throw new Error('ה-overrides ב-' + DEPS_DIR + '/package.json שונים מהשורש — לעדכן את התיקייה ואת קובץ הנעילה שלה');
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-llm-pack-'));
  try {
    for (const f of DEPS_FILES) if (fs.existsSync(path.join(depsDir, f))) fs.copyFileSync(path.join(depsDir, f), path.join(work, f));
    installer(work);
    const top = path.join(work, 'node_modules');
    // shallow: בשורש רק החבילה עצמה — כל דבר אחר שם לא היה נארז, והחבילה לא הייתה עובדת במחשב
    const extra = fs.readdirSync(top).filter((n) => n !== ROOT_PKG && !n.startsWith('.'));
    if (extra.length) throw new Error('בשורש ההתקנה יש חבילות נוספות: ' + extra.join(', '));
    const src = path.join(top, ROOT_PKG);
    const got = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
    if (got !== version) throw new Error(`הותקנה גרסה ${got} במקום ${version}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    const dest = path.join(outDir, 'node_modules', ROOT_PKG);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => !p.includes(path.sep + '.bin') });
    const binaries = pruneBinaries(dest);
    if (!binaries.length) throw new Error('לא הותקן רכיב מוכן למעבד (@node-llama-cpp)');
    const sha256 = treeHash(path.join(outDir, 'node_modules'));
    fs.writeFileSync(path.join(outDir, MANIFEST), JSON.stringify({ package: ROOT_PKG, version, binaries, sha256 }, null, 2) + '\n');
    return { packed: true, version, binaries, sha256 };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function install(srcDir, projectDir) {
  const manifestFile = path.join(srcDir, MANIFEST);
  if (!fs.existsSync(manifestFile)) throw new Error('בתיקייה אין ' + MANIFEST + ' — זה לא רכיב ההרצה מ-ci-status');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const from = path.join(srcDir, 'node_modules', ROOT_PKG);
  if (manifest.package !== ROOT_PKG || !fs.existsSync(path.join(from, 'package.json'))) throw new Error('רכיב ההרצה בתיקייה אינו שלם');
  // הטביעה שנרשמה באריזה — עץ שהשתנה או נקטע בדרך לא מותקן
  if (!/^[0-9a-f]{64}$/.test(String(manifest.sha256 || ''))) throw new Error('ב-' + MANIFEST + ' אין טביעת SHA-256 — לארוז מחדש ב-CI');
  if (treeHash(path.join(srcDir, 'node_modules')) !== manifest.sha256) throw new Error('רכיב ההרצה שונה מזה שנארז (SHA-256 לא תואם)');
  const dest = path.join(projectDir, 'node_modules', ROOT_PKG);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(from, dest, { recursive: true });
  return manifest;
}

// במחשב: הענף ci-status לתיקייה זמנית, בלי לגעת באינדקס ובקבצים של המאגר
function fetchAndInstall(projectDir) {
  const git = (args, env) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: projectDir, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  git(['fetch', 'origin', 'ci-status']);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-llm-runtime-'));
  try {
    git(['--work-tree=' + tmp, 'checkout', 'FETCH_HEAD', '--', 'llm-runtime'], { GIT_INDEX_FILE: path.join(tmp, '.index') });
    return install(path.join(tmp, 'llm-runtime'), projectDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const projectDir = path.join(__dirname, '..');
  try {
    if (cmd === 'pack' && arg) {
      const r = pack(projectDir, path.resolve(arg));
      console.log(r.packed ? `נארז ${ROOT_PKG} ${r.version}, רכיבים: ${r.binaries.join(', ')}, SHA-256: ${r.sha256}` : 'לא נארז: ' + r.reason);
    } else if (cmd === 'install' && arg) {
      const m = install(path.resolve(arg), projectDir);
      console.log(`הותקן ${ROOT_PKG} ${m.version} (SHA-256 ${m.sha256}). עכשיו: node build-local.js`);
    } else if (cmd === 'fetch') {
      const m = fetchAndInstall(projectDir);
      console.log(`הותקן ${ROOT_PKG} ${m.version} מ-ci-status (SHA-256 ${m.sha256} — להשוות ליומן הבנייה). עכשיו: node build-local.js`);
    } else {
      console.log('שימוש: node tools/llm-runtime.js pack <תיקייה> | install <תיקייה> | fetch');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error('שגיאה: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { pack, install, pruneBinaries, treeHash, NPM_CI_ARGS, DEPS_DIR };
