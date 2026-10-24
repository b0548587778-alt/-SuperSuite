#!/usr/bin/env node
// רכיב ההרצה של המודל המקומי (node-llama-cpp) למחשב בסביבה מסוננת — NetFree חוסם את ההורדה מ-npm.
// ב-CI ההתקנה מצליחה; הסקריפט אורז את החבילה עם כל התלויות שלה לתיקייה אחת ב-ci-status,
// ובמחשב מעתיק אותה ל-node_modules, כך ש-build-local.js אורז אותה במתקין.
//
//   node tools/llm-runtime.js pack <תיקייה>   — ב-CI, אחרי npm install (אותה גרסה כמו בקובץ הנעילה)
//   node tools/llm-runtime.js fetch            — במחשב: git fetch של ci-status והתקנה
//   node tools/llm-runtime.js install <תיקייה> — במחשב: התקנה מתיקייה שכבר קיימת
//
// המבנה: הכול בתוך node_modules/node-llama-cpp — התלויות ב-node_modules שלה, ושום חבילה של הפרויקט לא נדרסת.
// את הסידור עושה npm עצמו: התקנה בתיקייה נפרדת עם --install-strategy=shallow (רק החבילה בשורש,
// כל התלויות מתחתיה). העתקה "שטוחה" מקובץ הנעילה של הפרויקט נכשלה בריצה #62: אותה חבילה בשתי גרסאות
// (ansi-regex בשורש ובתוך node-llama-cpp) הייתה צריכה את אותו מקום.
// גרסאות CUDA / Vulkan לא נארזות (כמו ב-package.json).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_PKG = 'node-llama-cpp';
const MANIFEST = 'llm-runtime.json';
const SKIP = /cuda|vulkan/i;

// ההתקנה בתיקייה הנפרדת — ברירת המחדל: npm. בבדיקות מוחלפת
function npmInstall(dir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--install-strategy=shallow', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: dir, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: 'true' },
  });
}

function lockedVersion(projectDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'));
    const info = lock.packages && lock.packages['node_modules/' + ROOT_PKG];
    return info && info.version || null;
  } catch { return null; }
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

function pack(projectDir, outDir, { installer = npmInstall } = {}) {
  const version = lockedVersion(projectDir);
  if (!version || !fs.existsSync(path.join(projectDir, 'node_modules', ROOT_PKG, 'package.json'))) {
    return { packed: false, reason: ROOT_PKG + ' לא הותקן' };
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-llm-pack-'));
  try {
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'ss-llm-runtime', private: true, dependencies: { [ROOT_PKG]: version } }));
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
    fs.writeFileSync(path.join(outDir, MANIFEST), JSON.stringify({ package: ROOT_PKG, version, binaries }, null, 2) + '\n');
    return { packed: true, version, binaries };
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
      console.log(r.packed ? `נארז ${ROOT_PKG} ${r.version}, רכיבים: ${r.binaries.join(', ')}` : 'לא נארז: ' + r.reason);
    } else if (cmd === 'install' && arg) {
      const m = install(path.resolve(arg), projectDir);
      console.log(`הותקן ${ROOT_PKG} ${m.version}. עכשיו: node build-local.js`);
    } else if (cmd === 'fetch') {
      const m = fetchAndInstall(projectDir);
      console.log(`הותקן ${ROOT_PKG} ${m.version} מ-ci-status. עכשיו: node build-local.js`);
    } else {
      console.log('שימוש: node tools/llm-runtime.js pack <תיקייה> | install <תיקייה> | fetch');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error('שגיאה: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { pack, install, pruneBinaries };
