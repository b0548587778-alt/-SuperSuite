// בנייה מקומית של SuperSuite ל-EXE — ממה שקיים במחשב, בלי הורדות.
//
// הרעיון: בסביבה מסוננת (NetFree ואחרים) הורדות נחסמות. אבל הכל כבר קיים בדיסק —
// node_modules, ארכיון ה-Electron, ומטמון electron-builder (nsis, winCodeSign, 7zip).
// הסקריפט הזה מאתר את מה שקיים, מגדיר ל-electron-builder את נתיבי המטמון במפורש,
// ומבנה. אין בו ניסיון לעקוף סינון; אם פריט באמת חסר, הבנייה תיכשל בשקיפות.
//
// נקודה מרכזית: electron-builder מחפש את **ארכיון** ה-Electron (zip) ולא את
// node_modules/electron/dist. אם ה-zip כבר קיים במטמון של Electron בדיסק,
// מעבירים אותו ל-electron-builder דרך הגדרת electronDist — וכך אין הורדה כלל.
//
// הרצה:  node build-local.js                     (המהדורה המלאה, כמו קודם)
//        node build-local.js --product=all       (ארבע המהדורות: מלאה, עמותות, נדל"ן ועסקים, חשבונאות)
//        node build-local.js --product=npo       (מהדורה אחת: npo / realty / acct / full)
// או:    node build-local.js --check     (רק לבדוק מה קיים, בלי לבנות)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CHECK_ONLY = process.argv.includes('--check');
// --product=<id> / --product <id> / --product=all (shell/edition.js). בלי — המלאה בלבד, כמו קודם
function parseProducts(argv) {
  const ids = require('./shell/edition').IDS;
  const i = argv.findIndex(a => a === '--product' || a.startsWith('--product='));
  // מאגר של מוצר אחד (edition-product.json) — המוצר שלו; אחרת המלאה, כמו קודם
  if (i < 0) return require('./tools/edition-build').productLock() || ['full'];
  const v = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  if (v === 'all') return require('./tools/edition-build').ORDER;
  const list = String(v || '').split(',').filter(Boolean);
  const bad = list.filter(x => !ids.includes(x));
  if (!list.length || bad.length) throw new Error('מהדורה לא מוכרת: ' + (bad.join(', ') || '(ריק)') + ' — אחת מ: ' + ids.join(', ') + ' או all');
  return list;
}
let PRODUCTS;
try { PRODUCTS = parseProducts(process.argv); }
catch (e) { console.error(e.message); process.exit(2); }

// --- פלט ברור: כותרת, וסימון הצלחה/כישלון ---
const ok = (msg) => console.log('  ✔ ' + msg);
const bad = (msg) => console.log('  ✖ ' + msg);
const info = (msg) => console.log('    ' + msg);
const step = (msg) => console.log('\n' + msg);

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// נתיב תיקיית ההגדרות של המשתמש ב-Windows (איפה יושב המטמון של electron-builder).
function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

// עוברים על מועמדים ומייצרים את הרשימה שמוסיפים ל-PATH, בסדר עדיפות:
// קודם ה-.bin של הפרויקט (הכלי המקומי), ואם צריך גם תיקיות bin של Node עצמו.
function pathPrefixes() {
  const out = [];
  const bin = path.join(ROOT, 'node_modules', '.bin');
  if (exists(bin)) out.push(bin);
  // נתיב ה-node שמריץ אותנו כרגע — כדי שה-spawn הפנימי של electron-builder ימצא אותו.
  const nodeDir = path.dirname(process.execPath);
  if (exists(nodeDir)) out.push(nodeDir);
  return out;
}

// גרסת ה-Electron שהפרויקט דורש (מתוך devDependencies ב-package.json).
function electronVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const dep = (pkg.devDependencies && pkg.devDependencies.electron) || '';
    const m = /(\d+\.\d+\.\d+)/.exec(dep);
    if (m) return m[1];
  } catch { /* ניפול לברירת מחדל למטה */ }
  // אם לא הצלחנו לקרוא — לוקחים את הגרסה מהחבילה המותקנת.
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  } catch { return null; }
}

// מאתר ארכיון Electron (zip) שכבר קיים במחשב, בשם שהמפרט דורש:
// electron-v<version>-<platform>-<arch>.zip
//
// electron-builder מחפש קובץ כזה כשהוא אורז; הוא **לא** משתמש ב-node_modules/electron/dist.
// לכן אם ה-zip קיים — מעבירים לו את התיקייה שמכילה אותו כ-electronDist, ואין הורדה.
function findLocalElectronZip(version) {
  if (!version) return null;
  const fileName = `electron-v${version}-win32-x64.zip`;
  const roots = [
    // המטמון הרשמי של @electron/get (ושמור במחשב הזה גם תחת תת-תיקיות לפי hash).
    path.join(localAppData(), 'electron', 'Cache'),
    // המטמון של electron-builder — בכל תת-תיקייה אפשרית.
    path.join(localAppData(), 'electron-builder', 'Cache'),
    // ולמקרה שהוגדר אחרת בסביבה.
    process.env.ELECTRON_CACHE || '',
  ].filter(Boolean);

  for (const root of roots) {
    if (!exists(root)) continue;
    // סריקה רדודה-עד-שתי רמות: Cache/<hash>/<file> או Cache/<file>.
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      const p = path.join(root, d.name);
      if (d.isFile() && d.name === fileName) return p;          // ישירות ב-root
      if (d.isDirectory()) {
        const candidate = path.join(p, fileName);                // בתת-תיקייה (hash)
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

async function main() {
  console.log('===== SuperSuite: בנייה מקומית =====');
  console.log('תיקיית הפרויקט: ' + ROOT);
  console.log('\nהסקריפט בונה ממה שקיים במחשב בלבד. אין בו הורדות מהרשת.');

  let missing = 0;

  // --- 1. Electron ואלקטרון-בילדר מותקנים מקומית? ---
  step('1. בדיקת חבילות מקומיות (node_modules)');
  const electronPkg = path.join(ROOT, 'node_modules', 'electron');
  const builderPkg = path.join(ROOT, 'node_modules', 'electron-builder');
  const electronExe = path.join(electronPkg, 'dist', 'electron.exe');

  if (exists(electronPkg)) ok('electron מותקן'); else { bad('electron חסר ב-node_modules'); missing++; }
  if (exists(builderPkg)) ok('electron-builder מותקן'); else { bad('electron-builder חסר ב-node_modules'); missing++; }
  if (exists(electronExe)) ok('electron.exe קיים ב-node_modules/electron/dist');
  // מ-Electron 42 אין הורדה ב-postinstall — הפריסה ב-node node_modules/electron/install.js (גם מהמטמון המקומי)
  else info('electron.exe עוד לא נפרס (Electron 42 ומעלה): node node_modules/electron/install.js — לא נדרש לבנייה עם ארכיון zip');

  // הנתון הקריטי: האם יש ארכיון Electron מקומי. זה מה שמונע את ההורדה בזמן האריזה.
  const version = electronVersion();
  const localZip = findLocalElectronZip(version);
  // חלופה בלי zip: electron-builder 26 מקבל גם תיקיית Electron פרוסה (electronDist=<dir> בלי zip בתוכה).
  // משתמשים בה רק אם הגרסה בתיקייה זהה לגרסה שהפרויקט מצהיר עליה.
  const unpackedDist = path.join(electronPkg, 'dist');
  const unpackedVersion = (() => { try { return fs.readFileSync(path.join(unpackedDist, 'version'), 'utf8').trim().replace(/^v/, ''); } catch { return null; } })();
  const useUnpacked = !localZip && exists(electronExe) && unpackedVersion && unpackedVersion === version;
  if (localZip) {
    ok(`ארכיון Electron מקומי נמצא (v${version}) — הבנייה לא תוריד אותו`);
    info(localZip);
  } else if (useUnpacked) {
    ok(`אין ארכיון zip, אבל Electron v${version} פרוס ב-node_modules — הבנייה תשתמש בו ולא תוריד דבר`);
    info(unpackedDist);
  } else {
    bad(`ארכיון Electron (electron-v${version || '?'}-win32-x64.zip) לא נמצא במחשב`);
    info('בלעדיו, electron-builder ינסה להוריד אותו — וזה עלול להיחסם בסינון.');
    info('הארכיון נשמר בדרך כלל ב: ' + path.join(localAppData(), 'electron', 'Cache'));
    if (unpackedVersion && unpackedVersion !== version) info(`ב-node_modules/electron/dist יש גרסה ${unpackedVersion}, שאינה תואמת ל-${version}.`);
    missing++;
  }

  // --- 2. מטמון electron-builder: nsis, winCodeSign, 7zip ---
  // אם המטמון קיים, electron-builder לא מנסה להוריד כלום בזמן build.
  step('2. בדיקת מטמון electron-builder');
  const cacheDir = path.join(localAppData(), 'electron-builder', 'Cache');
  const needed = ['nsis', 'nsis-resources-3.4.1', 'winCodeSign', '7zip@1.0.0'];
  if (exists(cacheDir)) {
    ok('תיקיית המטמון קיימת: ' + cacheDir);
    for (const name of needed) {
      if (exists(path.join(cacheDir, name))) ok('במטמון: ' + name);
      else info('לא במטמון (ייתכן שלא נדרש): ' + name);
    }
  } else {
    // אין מטמון — ייתכן ש-electron-builder עדיין יעבוד אם הוא מוריד, או ייכשל מסונן.
    bad('אין תיקיית מטמון: ' + cacheDir);
    info('בלי המטמון, electron-builder עלול לנסות להורדה — שעלולה להיחסם בסינון.');
    missing++;
  }

  // --- 3. קבצים חיוניים לפרויקט ---
  step('3. בדיקת קבצי הפרויקט הנדרשים לחבילה');
  for (const rel of ['main.js', 'package.json', 'build/icon.ico', 'build/icon.png']) {
    if (exists(path.join(ROOT, rel))) ok(rel); else { bad('חסר: ' + rel); missing++; }
  }

  if (missing > 0) {
    console.log('\nנמצאו ' + missing + ' פריטים חסרים.');
    console.log('אין לסקריפט הזה דרך להוריד אותם: יש להשלים אותם במחשב שבו');
    console.log('הסינון מאפשר, ואז להריץ שוב.');
    if (CHECK_ONLY) {
      console.log('\n(--check) לא בונה. להרצה מלאה: node build-local.js');
      return;
    }
    // ממשיכים בכל זאת: ייתכן שפריט שדווח כחסר אינו חוסם את הבנייה בפועל,
    // ו-electron-builder עצמו ייתן שגיאה מדויקת אם באמת חסר משהו הכרחי.
    console.log('ממשיך בכל זאת — הבנייה תיכשל עם שגיאה מדויקת אם הפריט הכרחי.');
  } else {
    console.log('\nכל מה שנדרש קיים מקומית.');
    if (CHECK_ONLY) {
      console.log('\n(--check) לא בונה. להרצה מלאה: node build-local.js');
      return;
    }
  }

  // --- 4. בנייה ---
  // מריצים את electron-builder המקומי ישירות (לא דרך npm), עם PATH מוגדר,
  // וכך לא נוגעים בכלל ברשת. הסביבה מעבירה הלאה את כל משתני הסינון הקיימים.
  step('4. בנייה (electron-builder מקומי)');

  // מריצים את קובץ ה-JS של electron-builder דרך ה-node הנוכחי — לא דרך ה-wrapper
  // ב-.bin. ה-wrapper הוא קובץ אצווה, והרצתו דורשת shell; אבל נתיב הפרויקט עשוי
  // להכיל רווחים (למשל "bunim seller"), ו-shell מפרק את הפקודה על הרווח ושובר אותה.
  // קריאה ישירה ל-JS עם argv נפרד עובדת תמיד, בלי shell ובלי escaping.
  const builderJs = path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  if (!exists(builderJs)) {
    bad('לא נמצא electron-builder להרצה: ' + builderJs);
    process.exitCode = 1;
    return;
  }

  const env = Object.assign({}, process.env, {
    PATH: pathPrefixes().concat(process.env.PATH || '').join(path.delimiter),
    // מגדירים במפורש את תיקיית המטמון, כדי שלא ינסה לחפש/להוריד במקום אחר.
    ELECTRON_BUILDER_CACHE: cacheDir,
    // לא לנסות לעדכן/להתקין תלות native בזמן build.
    ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: 'true',
  });

  // אם מצאנו ארכיון Electron מקומי, מעבירים ל-electron-builder את התיקייה שמכילה
  // אותו דרך electronDist (הגדרה רשמית: "folder of electron zips"). כך האריזה
  // מתבצעת מהקובץ המקומי, ואין פנייה לרשת כלל.
  const builderArgs = ['--win', 'nsis', 'portable'];
  if (localZip) {
    const zipDir = path.dirname(localZip);
    builderArgs.push('-c.electronDist=' + zipDir);
    console.log('  שימוש בארכיון Electron מקומי: ' + localZip);
  } else if (useUnpacked) {
    builderArgs.push('-c.electronDist=' + unpackedDist);
    console.log('  שימוש ב-Electron הפרוס מקומית: ' + unpackedDist);
  } else {
    console.log('  אין ארכיון מקומי — electron-builder ינסה להוריד (עלול להיחסם).');
  }

  // חתימת קוד — רק אם הוגדרה תעודה במשתני הסביבה (docs/CODE-SIGNING.md). בלי תעודה: לא חתום, כמו קודם
  let signing;
  try { signing = require('./tools/code-signing').signingArgs(process.env); }
  catch (e) {
    bad('הגדרות חתימת הקוד: ' + e.message);
    process.exitCode = 1;
    return;
  }
  builderArgs.push(...signing.args);
  console.log('  חתימת קוד: ' + require('./tools/code-signing').MODE_TEXT[signing.mode]);
  if (signing.mode !== 'none') info('החתימה פונה לשרת חותמת הזמן של ספק התעודה — אם הוא חסום בסינון, הבנייה תיכשל בשלב החתימה.');

  // המהדורות (shell/edition.js): כל אחת בתורה. edition-id.js חוזר ל-full בסוף — גם אחרי כישלון
  const EB = require('./tools/edition-build');
  const built = [];
  try {
    for (const id of PRODUCTS) {
      const ed = require('./shell/edition').get(id);
      step(`4. בנייה — ${ed.name} (electron-builder מקומי)`);
      EB.setEdition(id);
      const args = [...builderArgs, ...EB.builderArgs(id)];
      console.log('  מריץ: electron-builder --win nsis portable' + (id === 'full' ? '' : ' (' + id + ')'));
      console.log('  (ייתכן שייקח מספר דקות)\n');
      const res = spawnSync(process.execPath, [builderJs, ...args], { cwd: ROOT, env, stdio: 'inherit' });
      if (res.error) {
        console.log('\nשגיאה בהרצת הבנייה: ' + res.error.message);
        process.exitCode = 1;
        return;
      }
      if (res.status !== 0) {
        console.log('\nהבנייה נכשלה (קוד ' + res.status + ').');
        console.log('אם השגיאה מזכירה הורדה/רשת — כנראה פריט חסר במטמון; ראו שלב 2 לעיל.');
        process.exitCode = res.status || 1;
        return;
      }
      built.push(id);
    }
  } finally {
    EB.setEdition('full');
  }

  // --- 5. סיכום ---
  step('5. סיום');
  let notFound = 0;
  for (const id of built) {
    for (const f of EB.files(id)) {
      if (exists(path.join(ROOT, f))) ok(f.replace(/\//g, '\\'));
      else { bad('חסר: ' + f); notFound++; }
    }
  }
  if (notFound) {
    bad('הבנייה דיווחה הצלחה אך חלק מהקבצים לא נמצאו ב-dist\\');
    process.exitCode = 1;
    return;
  }
  console.log('\nהקבצים נמצאים ב: ' + path.join(ROOT, 'dist'));
  console.log('חשוב: יש להריץ כל EXE פעם אחת ולבדוק עלייה, התחברות וגיבוי —');
  console.log('הבדיקות אינן מכסות את המתקין עצמו.');
}

main().catch((e) => {
  console.error('\nשגיאה לא צפויה: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
