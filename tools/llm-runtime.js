#!/usr/bin/env node
// רכיב ההרצה של המודל המקומי (node-llama-cpp) למחשב בסביבה מסוננת — NetFree חוסם את ההורדה מ-npm.
// ב-CI ההתקנה מצליחה; הסקריפט אורז את החבילה ואת כל התלויות שלה לתיקייה אחת ב-ci-status,
// ובמחשב מעתיק אותה ל-node_modules, כך ש-build-local.js אורז אותה במתקין.
//
//   node tools/llm-runtime.js pack <תיקייה>   — ב-CI, אחרי npm install (קורא את package-lock.json)
//   node tools/llm-runtime.js fetch            — במחשב: git fetch של ci-status והתקנה
//   node tools/llm-runtime.js install <תיקייה> — במחשב: התקנה מתיקייה שכבר קיימת
//
// המבנה: הכול בתוך node_modules/node-llama-cpp — התלויות ב-node_modules שלה. Node מחפש תלות קודם
// בתיקייה הזו, ולכן גרסה אחרת של אותה חבילה בשורש הפרויקט לא מתנגשת, ושום דבר מחוץ לחבילה לא נדרס.
// גרסאות CUDA / Vulkan לא נארזות (כמו ב-package.json), וגם לא רכיבים של מערכות אחרות שלא הותקנו.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_PKG = 'node-llama-cpp';
const MANIFEST = 'llm-runtime.json';
const SKIP = /cuda|vulkan/i;

// המיקום של התלות `dep` כפי ש-Node יחפש אותה מ-`from` (נתיב בקובץ הנעילה), או null
function resolveDep(packages, from, dep) {
  let base = from;
  for (;;) {
    const cand = (base ? base + '/' : '') + 'node_modules/' + dep;
    if (packages[cand]) return cand;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i < 0 ? '' : base.slice(0, i);
  }
}

// כל הנתיבים בקובץ הנעילה שהחבילה צריכה בזמן ריצה (תלויות ותלויות אופציונליות), רק כאלה שהותקנו בפועל
function closure(lock, exists = () => true) {
  const packages = (lock && lock.packages) || {};
  const start = 'node_modules/' + ROOT_PKG;
  if (!packages[start] || !exists(start)) return [];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const info = packages[cur] || {};
    const deps = { ...(info.dependencies || {}), ...(info.optionalDependencies || {}) };
    for (const dep of Object.keys(deps)) {
      if (SKIP.test(dep)) continue;
      const at = resolveDep(packages, cur, dep);
      if (!at || seen.has(at) || packages[at].link || !exists(at)) continue;
      seen.add(at);
      queue.push(at);
    }
  }
  return [...seen].sort();
}

// נתיב בקובץ הנעילה ← מיקום בתוך node_modules/node-llama-cpp
function targetOf(lockPath) {
  const prefix = 'node_modules/' + ROOT_PKG;
  if (lockPath === prefix || lockPath.startsWith(prefix + '/')) return lockPath;
  return prefix + '/' + lockPath;
}

function copyPackage(src, dest) {
  // בלי node_modules הפנימית — מה שנדרש ממנה נמצא ב-closure ומועתק בנפרד
  const own = path.join(src, 'node_modules');
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => p !== own && !p.startsWith(own + path.sep) });
}

function pack(projectDir, outDir) {
  const lockFile = path.join(projectDir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const list = closure(lock, (p) => fs.existsSync(path.join(projectDir, p, 'package.json')));
  if (!list.length) return { packed: false, reason: ROOT_PKG + ' לא הותקן' };
  const targets = new Map();
  for (const p of list) {
    const t = targetOf(p);
    if (targets.has(t)) throw new Error(`שתי גרסאות לאותו מיקום: ${targets.get(t)} ו-${p}`);
    targets.set(t, p);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [t, p] of targets) copyPackage(path.join(projectDir, p), path.join(outDir, t));
  const version = lock.packages['node_modules/' + ROOT_PKG].version;
  const binaries = list.filter((p) => p.includes('@node-llama-cpp/')).map((p) => p.split('/').pop());
  fs.writeFileSync(path.join(outDir, MANIFEST), JSON.stringify({ package: ROOT_PKG, version, binaries, packages: list.length }, null, 2) + '\n');
  return { packed: true, version, binaries, packages: list.length };
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
      console.log(r.packed ? `נארז ${ROOT_PKG} ${r.version}: ${r.packages} חבילות, רכיבים: ${r.binaries.join(', ') || 'אין'}` : 'לא נארז: ' + r.reason);
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

module.exports = { closure, resolveDep, targetOf, pack, install };
