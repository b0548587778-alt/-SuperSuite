#!/usr/bin/env node
// בניית APK לאנדרואיד — בלי Gradle ובלי npm (חסומים בסביבה המסוננת).
// כלים: JDK (javac/keytool), Android build-tools (aapt2, aapt, d8, zipalign, apksigner) ו-android.jar.
// כולם בתיקייה אחת: SS_ANDROID_TOOLCHAIN (ברירת מחדל: %USERPROFILE%\android-toolchain). ראו android/README.md.
//
//   node android/build-apk.js          בנייה מלאה → dist/SuperSuite.apk
//   node android/build-apk.js --check  בדיקה שכל הכלים קיימים, בלי לבנות
//   node android/build-apk.js --web    רק הכנת קבצי ה-web (android/build/assets) — לבדיקות
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { bundle } = require('./lib/bundle');

const ROOT = path.resolve(__dirname, '..');
const AND = __dirname;
const OUT = path.join(AND, 'build');
const WWW = path.join(OUT, 'assets', 'www');
const KEYDIR = path.join(AND, 'keystore');
const DIST = path.join(ROOT, 'dist');
const MODS = ['econ', 'shamai', 'tools'];
const ENTRY_HTML = { econ: 'views/index.html', shamai: 'index.html', tools: 'index.html' };
const PRELOADS = { econ: 'modules/econ/preload.js' };
const DOMAIN = 'supersuite.androidplatform.net';
// אנדרואיד 9 ומעלה (בדיקת קוד 23.10.2026, ממצא 57): כל אוסף של המודול הכלכלי נשמר כשורה אחת ב-SQLite,
// והחלון הגדול (64MB) לקריאתה — new CursorWindow(name, size) — קיים רק מ-API 28. ב-8.0/8.1 התקרה 2MB:
// הכתיבה מצליחה והטעינה הבאה נכשלת ("Row too big"), כלומר הנתונים ננעלים. אנדרואיד 8 לא מקבל עדכוני אבטחה מ-2021
const MIN_SDK = 28;
const TARGET_SDK = 35;

const args = new Set(process.argv.slice(2));
const log = m => console.log('• ' + m);

/* ---------- כלים ---------- */
function findTools() {
  const tc = process.env.SS_ANDROID_TOOLCHAIN || path.join(os.homedir(), 'android-toolchain');
  const exe = process.platform === 'win32' ? '.exe' : '';
  const jdk = fs.existsSync(tc) ? fs.readdirSync(tc).filter(d => /^jdk/i.test(d)).map(d => path.join(tc, d)).find(d => fs.existsSync(path.join(d, 'bin', 'javac' + exe))) : null;
  const bt = path.join(tc, 'build-tools');
  const t = {
    root: tc,
    java: jdk && path.join(jdk, 'bin', 'java' + exe),
    javac: jdk && path.join(jdk, 'bin', 'javac' + exe),
    keytool: jdk && path.join(jdk, 'bin', 'keytool' + exe),
    jar: jdk && path.join(jdk, 'bin', 'jar' + exe),
    aapt2: path.join(bt, 'aapt2' + exe),
    zipalign: path.join(bt, 'zipalign' + exe),
    d8: path.join(bt, 'lib', 'd8.jar'),
    apksigner: path.join(bt, 'lib', 'apksigner.jar'),
    lambdaStubs: path.join(bt, 'core-lambda-stubs.jar'),
    androidJar: path.join(tc, 'android-' + TARGET_SDK, 'android.jar')
  };
  const missing = Object.entries(t).filter(([k, v]) => k !== 'root' && (!v || !fs.existsSync(v))).map(([k]) => k);
  return { t, missing };
}

function run(cmd, argv, opts = {}) {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- כלי בנייה; הפקודה והארגומנטים מהסקריפט עצמו, בלי shell
  const r = spawnSync(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    process.stderr.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    throw new Error(`נכשל: ${path.basename(cmd)} ${argv.slice(0, 3).join(' ')}… (קוד ${r.status})`);
  }
  return r.stdout;
}

/* ---------- קבצים ---------- */
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (!filter(s, e)) continue;
    // aapt מדלג על קבצים/תיקיות שמתחילים ב-"." או "_" — עדיף להיכשל מאשר לקבל APK חסר
    if (/^[._]/.test(e.name)) throw new Error(`שם שלא ייכלל ב-APK (מתחיל ב-. או _): ${path.relative(ROOT, s)}`);
    if (e.isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}
function listFiles(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext)); else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// עטיפת preload של Electron לסקריפט רגיל: require('electron') ← ה-ipc המדומה של frame.js
function wrapPreload(src) {
  return `/* נוצר על ידי android/build-apk.js — preload של Electron כסקריפט רגיל בתוך ה-iframe */
(function () {
const require = name => { if (name === 'electron') return window.__ssElectron; throw new Error('preload: ' + name); };
${src}
})();
`;
}

function injectIntoHead(html, tags, file) {
  // אחרי ה-CSP (כדי שיחול גם עליהם) ולפני כל סקריפט של הדף
  const csp = /<meta[^>]+Content-Security-Policy[^>]*>/i.exec(html);
  if (csp) return html.slice(0, csp.index + csp[0].length) + '\n' + tags + html.slice(csp.index + csp[0].length);
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new Error('אין <head> ב-' + file);
  return html.slice(0, head.index + head[0].length) + '\n' + tags + html.slice(head.index + head[0].length);
}

/* ---------- web ---------- */
function buildWeb() {
  rmrf(path.join(OUT, 'assets'));
  fs.mkdirSync(WWW, { recursive: true });
  const frameJs = fs.readFileSync(path.join(AND, 'web', 'frame.js'), 'utf8');

  for (const mod of MODS) {
    const src = path.join(ROOT, 'modules', mod);
    const dst = path.join(WWW, mod);
    // בצד הכלכלי רק הממשק נכנס ל-iframe; הלוגיקה (ipc/core/services) נארזת לחלון המעטפת
    const skip = mod === 'econ' ? new Set(['core', 'services', 'utils', 'ipc.js', 'preload.js']) : new Set();
    copyDir(src, dst, (s) => !(path.dirname(s) === src && skip.has(path.basename(s))));
    const ssDir = path.join(dst, 'ss-android');
    fs.mkdirSync(ssDir, { recursive: true });
    fs.writeFileSync(path.join(ssDir, 'frame.js'), frameJs);
    let tags = '<script src="/ss-android/frame.js"></script>';
    if (PRELOADS[mod]) {
      fs.writeFileSync(path.join(ssDir, 'preload.js'), wrapPreload(fs.readFileSync(path.join(ROOT, PRELOADS[mod]), 'utf8')));
      tags += '\n<script src="/ss-android/preload.js"></script>';
    }
    // שפת העיצוב המשותפת (PLAN.md 7.1) — במחשב main.js מגיש אותה לכל מודול; כאן עותק בשורש של כל מודול
    fs.copyFileSync(path.join(ROOT, 'shell', 'design-tokens.css'), path.join(dst, 'design-tokens.css'));
    fs.copyFileSync(path.join(ROOT, 'shell', 'screen-guard.js'), path.join(dst, 'screen-guard.js'));
    fs.copyFileSync(path.join(ROOT, 'shell', 'ss-dialog.js'), path.join(dst, 'ss-dialog.js'));
    fs.copyFileSync(path.join(ROOT, 'shell', 'ui-kit.css'), path.join(dst, 'ui-kit.css'));
    const entry = path.join(dst, ENTRY_HTML[mod]);
    fs.writeFileSync(entry, injectIntoHead(fs.readFileSync(entry, 'utf8'), tags, entry));
  }

  // המעטפת
  const shellDst = path.join(WWW, 'shell');
  fs.mkdirSync(shellDst, { recursive: true });
  for (const f of ['display.js', 'hebcal.js', 'catalog.js', 'onboarding.js', 'shell.js', 'design-tokens.css', 'ui-kit.css', 'ss-dialog.js']) fs.copyFileSync(path.join(ROOT, 'shell', f), path.join(shellDst, f));
  for (const f of ['node-shims.js', 'host.js', 'mobile.js']) fs.copyFileSync(path.join(AND, 'web', f), path.join(shellDst, f));

  const host = bundle({
    'econ-ipc': path.join(ROOT, 'modules', 'econ', 'ipc.js'),
    'main-android': path.join(AND, 'web', 'main-android.js'),
    'shell-preload': path.join(ROOT, 'shell', 'preload.js')
  }, { root: ROOT, globalName: '__ssHost' });
  fs.writeFileSync(path.join(shellDst, 'host-bundle.js'), host.code);

  const Catalog = require(path.join(ROOT, 'shell', 'catalog.js'));
  const econExtras = Catalog.extrasFromHtml(fs.readFileSync(path.join(ROOT, 'modules', 'econ', 'views', 'index.html'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // "אודות" (shell:get-about): אותם קבצים שהמחשב קורא מתיקיית ההתקנה — כאן נארזים בבנייה
  const txt = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
  const about = { license: txt('LICENSE.txt'), eula: txt('build/eula.txt'), notices: txt('THIRD-PARTY-NOTICES.txt') };
  fs.writeFileSync(path.join(shellDst, 'build-info.js'),
    `window.__ssBuildInfo = ${JSON.stringify({ version: pkg.version, econExtras, about })};\n`);

  let html = fs.readFileSync(path.join(ROOT, 'shell', 'shell.html'), 'utf8');
  const frames = MODS.map(m => `https://${m}.${DOMAIN}`).join(' ');
  const cspBefore = html;
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")default-src 'self';/, `$1default-src 'self'; frame-src ${frames};`);
  if (html === cspBefore) throw new Error('shell.html: לא נמצא CSP להוספת frame-src');
  // העמוד עצמו לא פונה לרשת: שרת הרישוי מגיע דרך הגשר ב-Java (relay-fetch.js). connect-src נשאר 'self' בלבד
  if (!/connect-src 'self'[;"]/.test(html)) throw new Error("shell.html: ה-CSP חייב לכלול connect-src 'self' בלבד");
  html = html.replace(/<meta charset="utf-8">/i, m => m + '\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
  const mobileCss = fs.readFileSync(path.join(AND, 'web', 'mobile.css'), 'utf8');
  html = html.replace(/<\/head>/i, `<style>\n${mobileCss}</style>\n</head>`);
  const firstScript = '<script src="hebcal.js"></script>';
  if (!html.includes(firstScript)) throw new Error('shell.html: לא נמצא ' + firstScript);
  html = html.replace(firstScript,
    '<div id="ssFrames" class="ss-frames"></div>\n' +
    '<script src="build-info.js"></script>\n<script src="node-shims.js"></script>\n' +
    '<script src="host-bundle.js"></script>\n<script src="host.js"></script>\n' + firstScript);
  html = html.replace('<script src="shell.js"></script>', '<script src="shell.js"></script>\n<script src="mobile.js"></script>');
  fs.writeFileSync(path.join(shellDst, 'shell.html'), html);
  log(`קבצי web: ${host.files.length} קבצי מקור נארזו ל-host-bundle.js`);
  return { version: pkg.version };
}

/* ---------- מפתח חתימה ---------- */
// מפתח קבוע לכל הבניות: עדכון APK מותקן אפשרי רק עם אותו מפתח. לא נכנס ל-git (.gitignore).
const KEYSTORE = path.join(KEYDIR, 'supersuite-release.jks');
const PASS_FILE = path.join(KEYDIR, 'password.txt');

// מאיפה מגיע מפתח החתימה (PLAN.md 0.1) — הבעלים צריך לזכור סיסמה אחת בלבד, זו שעל הנייר:
//   1. גיבוי מוצפן (Documents\SuperSuite-android-key-backup.sskey) ← מקלידים את סיסמת הגיבוי, והמפתח
//      והסיסמה שלו נפתחים בזיכרון. לא נשמר שום דבר גלוי בדיסק (רק קובץ זמני שנמחק בסוף הבנייה).
//   2. בלי גיבוי — המפתח שבתיקייה, עם SS_KS_PASS או password.txt (אם עוד קיים).
//   3. אין מפתח ואין גיבוי — נעצרים. **לא נוצר מפתח חדש לבד**: מפתח חדש = אי אפשר לעדכן את האפליקציה המותקנת.
//      יצירה מכוונת בלבד: --new-key.
async function resolveSigningKey({ env = process.env, keystore = KEYSTORE, passFile = PASS_FILE, backupFile = null,
  ask = null, isTTY = process.stdin.isTTY, openBackup = null, allowNew = false } = {}) {
  if (backupFile && fs.existsSync(backupFile) && openBackup) {
    if (!(ask && isTTY)) throw new Error('יש להריץ את הבנייה בחלון רגיל, כדי להקליד את סיסמת הגיבוי');
    for (let tries = 1; ; tries++) {
      const pw = String(await ask('הקלידו את הסיסמה שרשמתם על הנייר (סיסמת הגיבוי): '));
      try {
        const k = openBackup(fs.readFileSync(backupFile), pw);
        // מפתח בתיקייה שאינו המפתח שבגיבוי — לא מנחשים איזה נכון
        if (fs.existsSync(keystore) && !fs.readFileSync(keystore).equals(k.jks)) {
          throw new Error('המפתח שבתיקייה android/keystore שונה מהמפתח שבגיבוי. לא נבנה כלום — יש לבדוק איזה מהם נכון.');
        }
        return { source: 'backup', jksBytes: k.jks, pass: k.pass };
      } catch (e) {
        if (tries >= 3 || !/סיסמה שגויה/.test(e.message)) throw e;
        console.log('הסיסמה לא נכונה. נסו שוב.');
      }
    }
  }
  if (fs.existsSync(keystore)) {
    if (env.SS_KS_PASS && env.SS_KS_PASS.trim()) return { source: 'folder', jks: keystore, pass: env.SS_KS_PASS.trim() };
    if (fs.existsSync(passFile)) return { source: 'folder', jks: keystore, pass: fs.readFileSync(passFile, 'utf8').trim() };
    if (ask && isTTY) {
      const p = String(await ask('סיסמת מפתח החתימה: ')).trim();
      if (p) return { source: 'folder', jks: keystore, pass: p };
    }
    throw new Error('חסרה סיסמת מפתח החתימה, ולא נמצא הגיבוי המוצפן ב-Documents.');
  }
  if (allowNew) return { source: 'new' };
  throw new Error('לא נמצא מפתח החתימה ולא נמצא הגיבוי המוצפן.\n' +
    'שימו את הקובץ SuperSuite-android-key-backup.sskey (מ-Google Drive או מהמייל) בתיקיית המסמכים (Documents), ונסו שוב.\n' +
    'לא נוצר מפתח חדש: עם מפתח חדש לא אפשר לעדכן את האפליקציה שכבר מותקנת אצל הלקוחות.');
}

// מחזיר { jks, pass, cleanup }. מפתח מהגיבוי נכתב לקובץ זמני (keytool/apksigner צריכים קובץ) ונמחק ב-cleanup
function ensureKeystore(t, key) {
  if (key.source === 'backup') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sign-'));
    const jks = path.join(tmp, 'release.jks');
    fs.writeFileSync(jks, key.jksBytes, { mode: 0o600 });
    return { jks, pass: key.pass, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }
  if (key.source === 'new') {
    fs.mkdirSync(KEYDIR, { recursive: true });
    const pass = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(PASS_FILE, pass, { mode: 0o600 });
    run(t.keytool, ['-genkeypair', '-keystore', KEYSTORE, '-storetype', 'PKCS12', '-alias', 'supersuite', '-keyalg', 'RSA', '-keysize', '3072',
      '-validity', '36500', '-dname', 'CN=SuperSuite, O=Bunim Seller', '-storepass:env', 'SS_KS_PASS', '-keypass:env', 'SS_KS_PASS'],
      { env: { ...process.env, SS_KS_PASS: pass } });
    log('נוצר מפתח חתימה חדש: ' + path.relative(ROOT, KEYSTORE) + ' — יש לגבות אותו מיד (node tools/android-key-backup.js backup)');
    return { jks: KEYSTORE, pass, cleanup: () => {} };
  }
  return { jks: key.jks, pass: key.pass, cleanup: () => {} };
}

/* ---------- APK ---------- */
function copyResDir(from, to) {
  if (!fs.existsSync(from)) throw new Error('חסרה תיקיית משאבים: ' + path.relative(ROOT, from));
  for (const dir of fs.readdirSync(from)) {
    fs.mkdirSync(path.join(to, dir), { recursive: true });
    for (const f of fs.readdirSync(path.join(from, dir))) fs.copyFileSync(path.join(from, dir, f), path.join(to, dir, f));
  }
}

function buildApk(t, version, key) {
  const work = path.join(OUT, 'work');
  rmrf(work);
  fs.mkdirSync(work, { recursive: true });
  const env = { ...process.env, JAVA_HOME: path.dirname(path.dirname(t.java)), PATH: path.dirname(t.java) + path.delimiter + process.env.PATH };

  // משאבים: אייקון לכל צפיפות ולוגו הפתיחה (build/android — tools/make-icon.js), וערכת מסך הפתיחה (android/app/res)
  copyResDir(path.join(ROOT, 'build', 'android'), path.join(work, 'res'));
  copyResDir(path.join(AND, 'app', 'res'), path.join(work, 'res'));
  const resZip = path.join(work, 'res.zip');
  run(t.aapt2, ['compile', '--dir', path.join(work, 'res'), '-o', resZip]);

  const [maj, min, pat] = String(version).split('.').map(n => parseInt(n, 10) || 0);
  const versionCode = maj * 10000 + min * 100 + pat;
  const unsigned = path.join(work, 'unsigned.apk');
  run(t.aapt2, ['link', '-o', unsigned, '-I', t.androidJar, '--manifest', path.join(AND, 'app', 'AndroidManifest.xml'),
    '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK),
    '--version-code', String(versionCode), '--version-name', String(version), resZip]);
  log('aapt2 link');

  const classes = path.join(work, 'classes');
  const javaFiles = listFiles(path.join(AND, 'app', 'java'), '.java');
  run(t.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', t.androidJar, '-classpath', t.lambdaStubs, '-Xlint:-options', '-nowarn',
    '-d', classes, ...javaFiles], { env });
  log(`javac: ${javaFiles.length} קבצים`);

  const dex = path.join(work, 'dex');
  fs.mkdirSync(dex, { recursive: true });
  run(t.java, ['-cp', t.d8, 'com.android.tools.r8.D8', '--release', '--min-api', String(MIN_SDK), '--lib', t.androidJar,
    '--output', dex, ...listFiles(classes, '.class')], { env });
  // קבצי web ו-dex נוספים עם jar ולא עם aapt2 -A / aapt add: ב-Windows הם שומרים את הנתיב עם "\"
  // (assets/www\econ\...), ואנדרואיד לא מוצא אף קובץ. jar תמיד כותב "/".
  run(t.jar, ['uf', unsigned, '-C', OUT, 'assets', '-C', dex, 'classes.dex'], { env });
  assertZipNames(unsigned);
  log('d8 + classes.dex');

  const aligned = path.join(work, 'aligned.apk');
  run(t.zipalign, ['-f', '-p', '4', unsigned, aligned]);

  const ks = ensureKeystore(t, key);
  fs.mkdirSync(DIST, { recursive: true });
  const apk = path.join(DIST, 'SuperSuite.apk');
  const signEnv = { ...env, SS_KS_PASS: ks.pass };
  try {
    run(t.java, ['-jar', t.apksigner, 'sign', '--ks', ks.jks, '--ks-key-alias', 'supersuite', '--ks-pass', 'env:SS_KS_PASS',
      '--key-pass', 'env:SS_KS_PASS', '--min-sdk-version', String(MIN_SDK), '--out', apk, aligned], { env: signEnv });
  } finally {
    ks.cleanup();
  }
  run(t.java, ['-jar', t.apksigner, 'verify', '--min-sdk-version', String(MIN_SDK), apk], { env });
  log('נחתם ואומת');
  return { apk, versionCode };
}

// בדיקת שמות הקבצים בתוך ה-APK: בלי "\", וכל קבצי ה-web נמצאים
function assertZipNames(apk) {
  const b = fs.readFileSync(apk);
  const names = [];
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) !== 0x06054b50) continue;
    let p = b.readUInt32LE(i + 16);
    const n = b.readUInt16LE(i + 10);
    for (let k = 0; k < n; k++) {
      const len = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32);
      names.push({ name: b.toString('utf8', p + 46, p + 46 + len), method: b.readUInt16LE(p + 10) });
      p += 46 + len + extra + comment;
    }
    break;
  }
  const bad = names.filter(x => x.name.includes('\\'));
  if (bad.length) throw new Error('נתיב עם "\\" ב-APK: ' + bad[0].name);
  const arsc = names.find(x => x.name === 'resources.arsc');
  if (!arsc || arsc.method !== 0) throw new Error('resources.arsc חייב להישמר בלי דחיסה');
  const expected = listFiles(WWW, '').map(f => 'assets/www/' + path.relative(WWW, f).split(path.sep).join('/'));
  const have = new Set(names.map(x => x.name));
  const missing = expected.filter(x => !have.has(x));
  if (missing.length) throw new Error('חסרים ב-APK: ' + missing.slice(0, 5).join(', '));
  if (!have.has('classes.dex')) throw new Error('חסר classes.dex');
}

async function main() {
  const { t, missing } = findTools();
  if (args.has('--check')) {
    console.log('תיקיית כלים:', t.root);
    for (const [k, v] of Object.entries(t)) if (k !== 'root') console.log(`  ${missing.includes(k) ? '✗' : '✓'} ${k}: ${v || '(לא נמצא)'}`);
    process.exit(missing.length ? 1 : 0);
  }
  const { version } = buildWeb();
  if (args.has('--web')) return;
  if (missing.length) {
    console.error('חסרים כלים: ' + missing.join(', ') + '\nראו android/README.md (או הריצו עם --check).');
    process.exit(1);
  }
  // המפתח לפני הבנייה הארוכה — כדי שלא תיכשל רק בסוף
  const kb = require('../tools/android-key-backup');
  const key = await resolveSigningKey({
    backupFile: process.env.SS_KEY_BACKUP || kb.DEFAULT_BACKUP(),
    ask: kb.askHidden, openBackup: kb.openBackup, allowNew: args.has('--new-key'),
  });
  if (key.source === 'backup') log('המפתח נפתח מהגיבוי המוצפן');
  const { apk, versionCode } = buildApk(t, version, key);
  const mb = (fs.statSync(apk).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ ${apk}  (${mb}MB, גרסה ${version}, versionCode ${versionCode})`);
}

if (require.main === module) {
  main().catch(e => { console.error('\n✗ ' + e.message); process.exit(1); });
}
module.exports = { buildWeb, findTools, wrapPreload, injectIntoHead, resolveSigningKey, ensureKeystore, WWW, DOMAIN, MIN_SDK };
