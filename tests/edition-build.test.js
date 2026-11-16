// בניית המהדורות (שלב 3 בתכנית docs/SPLIT-3-PRODUCTS-PLAN.md): tools/edition-build.js — מקור אחד ל-build-local.js ול-CI.
// המלאה נבנית בדיוק כמו היום (שמות, appId, תיקייה); כל מהדורה אחרת — dist/<id>/ עם שם, appId ותיקיית נתונים משלה.
// 🔧 הבנייה עצמה (NSIS, Windows) והרצת המתקינים — רק ב-CI / במחשב Windows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EB = require('../tools/edition-build');
const Edition = require('../shell/edition');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const tmpDirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-edbuild-')); tmpDirs.push(d); return d; };
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

test('edition-id.js במאגר = התבנית של full, ו-set כותב קובץ שנטען למהדורה הנכונה (בלי לגעת בקובץ שבמאגר)', () => {
  assert.equal(read('shell', 'edition-id.js'), EB.editionIdSource('full'));
  const dir = tmp();
  for (const id of Edition.IDS) {
    const file = path.join(dir, 'edition-id.js');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/edition-build.js'), 'set', id], { env: { ...process.env, SS_EDITION_FILE: file }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const m = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: m });
    assert.equal(m.exports, id);
    const win = {};
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: win });
    assert.equal(win.SUITE_EDITION_ID, id, 'גם בדפדפן (shell.html)');
  }
  assert.equal(read('shell', 'edition-id.js'), EB.editionIdSource('full'));
  assert.throws(() => EB.editionIdSource('trainer'), /מהדורה לא מוכרת/);
});

test('הגדרות electron-builder: המלאה בלי שינוי; לכל מהדורה appId, שם, תיקייה ושמות קבצים משלה', () => {
  assert.deepEqual(EB.builderArgs('full'), []);
  assert.deepEqual(EB.files('full'), ['dist/SuperSuite-Setup.exe', 'dist/SuperSuite-Portable.exe'], 'קישורי ההורדה של היום');
  assert.deepEqual(EB.app('full'), { dir: 'dist/win-unpacked', exe: 'SuperSuite.exe' });
  const pkg = require('../package.json');
  // במאגר של מוצר אחד (tools/split-product.js) — השם של המוצר
  const lock = EB.productLock();
  assert.equal(pkg.build.nsis.artifactName, lock ? `${Edition.get(lock[0]).artifact}-Setup.\${ext}` : 'SuperSuite-Setup.${ext}');
  const seen = new Set();
  for (const id of Edition.PARTIAL_IDS) {
    const ed = Edition.get(id);
    const args = EB.builderArgs(id);
    assert.ok(args.includes(`-c.appId=${ed.appId}`), id);
    assert.ok(args.includes(`-c.productName=${ed.product}`) && args.includes(`-c.extraMetadata.productName=${ed.product}`), id);
    assert.ok(args.includes(`-c.directories.output=dist/${id}`), id);
    assert.ok(args.includes(`-c.nsis.artifactName=${ed.artifact}-Setup.\${ext}`), id);
    for (const a of args) assert.match(a, /^-c\.[A-Za-z.]+=[^\r\n]+$/);
    for (const f of [...EB.files(id), EB.app(id).dir]) { assert.ok(!seen.has(f), f); seen.add(f); }
    assert.match(ed.product, /^SuperSuite [A-Za-z]+$/, 'שם הקובץ באנגלית (נתיב ההתקנה ב-Windows)');
  }
  assert.deepEqual(EB.ORDER, EB.productLock() || ['full', 'npo', 'realty', 'acct'], 'המלאה ראשונה; במאגר מוצר — רק הוא');
});

test('תיקיית הנתונים: המלאה — של היום; כל מהדורה — משלה; --user-data-dir גובר', () => {
  const join = (a, b) => a + '\\' + b;
  assert.equal(Edition.userDataDir('C:\\AppData', [], join), null);
  for (const id of Edition.PARTIAL_IDS) {
    assert.equal(Edition.userDataDir('C:\\AppData', [], join, Edition.get(id)), 'C:\\AppData\\' + Edition.get(id).product);
    assert.equal(Edition.userDataDir('C:\\AppData', ['--user-data-dir=C:\\x'], join, Edition.get(id)), null);
  }
  const main = read('main.js');
  const iSet = main.indexOf('Edition.userDataDir(app.getPath(\'appData\'), process.argv, path.join)');
  assert.ok(iSet > 0 && iSet < main.indexOf("createLogger({ dir: app.getPath('userData') })"), 'לפני כל שימוש ב-userData');
  assert.ok(iSet < main.indexOf('requestSingleInstanceLock'));
});

test('main.js: רק המודולים של המהדורה מוגשים ונטענים; הגיבוי — כל המודולים (נתונים לא אובדים)', () => {
  const main = read('main.js');
  assert.match(main, /const ACTIVE_MODS = MODS\.filter\(m => Edition\.modAllowed\(m\)\);/);
  assert.match(main, /if \(!ACTIVE_MODS\.includes\(mod\)\) return new Response\('Not found', \{ status: 404 \}\);/);
  assert.match(main, /\['shell', \.\.\.ACTIVE_MODS\], waitLoaded, capture\)/);
  assert.match(main, /const BACKUP_SCOPES = \['all', \.\.\.MODS\];/);
});

test('CI: ארבע המהדורות במשימת build אחת (לולאה, לא matrix), בדיקת עלייה לכל אחת, וכל הקבצים בפרסום', () => {
  const yml = read('.github', 'workflows', 'build.yml');
  assert.doesNotMatch(yml, /matrix:/);
  const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  publish:'));
  const publish = yml.slice(yml.indexOf('\n  publish:'), yml.indexOf('\n  report:'));
  assert.match(build, /for ED in \$\(node tools\/edition-build\.js list\); do\n\s+node tools\/edition-build\.js set "\$ED"/);
  assert.match(build, /trap 'node tools\/edition-build\.js set full' EXIT/);
  assert.match(build, /node tools\/smoke-packaged\.js --edition "\$ED"/);
  assert.match(build, /exit \$FAIL/, 'מהדורה שנכשלה בבדיקת העלייה — הצעד נכשל ואין פרסום');
  for (const id of EB.ORDER) {
    for (const f of EB.files(id)) {
      assert.ok(build.includes('\n            ' + f + '\n'), 'נשמר לפרסום: ' + f);
      assert.ok(publish.includes('\n            ' + f + '\n'), 'משוחזר בפרסום: ' + f);
      assert.ok(publish.includes(' ' + f), 'מועלה: ' + f);
    }
  }
  // בצעד עם הסודות אין התקנת חבילות ואין npx (tests/audit-ci-tools-tests.test.js) — גם לא דרך כלי המהדורות
  const eb = read('tools', 'edition-build.js');
  assert.doesNotMatch(eb, /require\('(child_process|https?|net)'\)/);
});

test('build-local.js --product ו-build-exe.bat: מהדורה אחת, כמה, או all; מהדורה לא מוכרת — יציאה 2 לפני כל בנייה', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'build-local.js'), '--product=xyz'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /מהדורה לא מוכרת: xyz/);
  const src = read('build-local.js');
  assert.match(src, /finally \{\n\s+EB\.setEdition\('full'\);/, 'edition-id.js חוזר ל-full גם אחרי כישלון');
  assert.match(src, /if \(i < 0\) return require\('\.\/tools\/edition-build'\)\.productLock\(\) \|\| \['full'\];/, 'בלי --product — המלאה, כמו קודם (במאגר מוצר — המוצר)');
  const bat = read('build-exe.bat');
  assert.match(bat, /if "%PRODUCT%"=="" set "PRODUCT=all"/);
  assert.match(bat, /node build-local\.js --product=%PRODUCT%/);
  assert.equal(require('../package.json').scripts['dist:all'], 'node build-local.js --product=all');
});

test('בדיקת העלייה של הגרסה הארוזה: --edition בוחר את התיקייה ואת ה-EXE, והיומן מצטבר', () => {
  const src = read('tools', 'smoke-packaged.js');
  assert.match(src, /EB\.app\(EDITION\)\.dir/);
  assert.match(src, /path\.basename\(EXE\)/, 'בדיקת השלמות על ה-EXE של המהדורה');
  assert.doesNotMatch(src, /writeFileSync\(LOG/);
});
