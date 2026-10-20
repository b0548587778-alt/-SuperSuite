// קוד המקור של מודול האימונים (PLAN.md 6.1): modules-src/trainer ← tools/build-trainer.js ← modules/trainer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BT = require('../tools/build-trainer');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'modules-src', 'trainer');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-trainer-'));

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = path.join(dir, n);
    fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

test('קוד המקור קיים: package.json, נקודת כניסה, ומתאם האחסון', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.build, 'vite build');
  for (const dep of ['react', 'react-dom', 'recharts']) assert.ok(pkg.dependencies[dep], dep);
  assert.ok(fs.existsSync(path.join(SRC, 'src', 'main.jsx')));
  assert.ok(fs.existsSync(path.join(SRC, 'src', 'lib', 'storage.js')));
});

test('קוד המקור לא פונה לרשת (Google Fonts, שירות QR, CDN)', () => {
  const files = walk(SRC).filter(f => /\.(jsx?|html|css)$/.test(f));
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of BT.FORBIDDEN) assert.doesNotMatch(text, re, path.relative(SRC, f));
  }
  assert.doesNotMatch(read('src/lib/sharing.js'), /qrCodeUrl/);
});

test('index.html של המקור: CSP, גופנים מקומיים, ערכת הצבעים, נקודת הכניסה של Vite', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy[^>]+script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.match(html, /--font-display:/);
  assert.doesNotMatch(html, /suite-theme\.css/, 'ערכת הצבעים בתוך החבילה (src/theme.css, PLAN.md 6.4)');
  assert.ok(html.indexOf('href="/design-tokens.css"') > 0 && html.indexOf('href="/design-tokens.css"') < html.indexOf('href="/ui-kit.css"'));
  assert.equal(BT.checkThemeOrder(html), html);
  assert.match(html, /src="\/src\/main\.jsx"/);
  assert.doesNotMatch(html, /\/assets\//, 'אין הפניה לחבילה מהודרת ישנה');
});

test('המקור תואם למודול שרץ היום: כל טקסט ממשק במקור קיים בחבילה המהודרת', () => {
  const html = fs.readFileSync(path.join(ROOT, 'modules', 'trainer', 'index.html'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'modules', 'trainer', html.match(/src="\/(assets\/index-[^"]+\.js)"/)[1]), 'utf8');
  // תוויות הניווט של הסרגל הפנימי — מהן נגזר הסרגל האחיד (shell/catalog.js)
  const Catalog = require('../shell/catalog');
  const app = require('./helpers/trainer-src').trainerUiSource(); // כל קבצי הממשק (PLAN.md 6.2)
  for (const label of Object.values(Catalog.TRAINER_LABELS)) {
    assert.ok(app.includes(label), 'תווית בסרגל חסרה במקור: ' + label);
    assert.ok(bundle.includes(label), 'תווית בסרגל חסרה בחבילה: ' + label);
  }
});

// ה-head כפי ש-Vite מוציא אותו: הקישורים מ-index.html, ואחריהם החבילה
const BUILT_HEAD = '<head><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/ui-kit.css">'
  + '<script src="/screen-guard.js"></script><script src="/ss-dialog.js"></script>'
  + '<script type="module" src="/assets/index-X.js"></script><link rel="stylesheet" href="/assets/index-Y.css"></head>';

test('build-trainer: שפת העיצוב לפני ה-CSS של החבילה, ואין ערכת צבעים חיצונית (PLAN.md 6.4)', () => {
  assert.equal(BT.checkThemeOrder(BUILT_HEAD), BUILT_HEAD);
  // design-tokens אחרי החבילה — המשתנים עדיין עובדים, אבל ui-kit היה גובר על המיפוי שבחבילה
  const late = BUILT_HEAD.replace('<link rel="stylesheet" href="/ui-kit.css">', '').replace('</head>', '<link rel="stylesheet" href="/ui-kit.css"></head>');
  assert.throws(() => BT.checkThemeOrder(late), /ui-kit\.css אחרי/);
  assert.throws(() => BT.checkThemeOrder(BUILT_HEAD.replace('<link rel="stylesheet" href="/design-tokens.css">', '')), /design-tokens/);
  assert.throws(() => BT.checkThemeOrder(BUILT_HEAD.replace('</head>', '<link rel="stylesheet" href="/suite-theme.css"></head>')), /suite-theme/);
});

test('build-trainer: התקנה מוחקת חבילות ישנות ואת ערכת הצבעים הישנה, ושומרת את קובץ השילוב', () => {
  const out = tmp();
  const dist = tmp();
  fs.mkdirSync(path.join(out, 'assets'));
  fs.writeFileSync(path.join(out, 'assets', 'index-OLD.js'), 'old');
  fs.writeFileSync(path.join(out, 'preload.js'), 'PRELOAD');
  fs.writeFileSync(path.join(out, 'suite-theme.css'), 'THEME');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'index-NEW.js'), 'new');
  fs.writeFileSync(path.join(dist, 'index.html'), BUILT_HEAD);
  BT.install(dist, out);
  assert.ok(!fs.existsSync(path.join(out, 'assets', 'index-OLD.js')), 'חבילה ישנה נמחקה');
  assert.ok(fs.existsSync(path.join(out, 'assets', 'index-NEW.js')));
  assert.equal(fs.readFileSync(path.join(out, 'preload.js'), 'utf8'), 'PRELOAD');
  assert.ok(!fs.existsSync(path.join(out, 'suite-theme.css')), 'ערכת הצבעים הישנה הוסרה');
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), BUILT_HEAD);
});

test('ערכת הצבעים בקוד המקור: main.jsx מייבא את theme.css אחרי Tailwind', () => {
  const main = read('src/main.jsx');
  assert.ok(main.indexOf("import './theme.css';") > main.indexOf("import './index.css';"), 'theme.css אחרי index.css (Tailwind)');
  assert.ok(main.indexOf("import './index.css';") > 0);
  assert.ok(fs.existsSync(path.join(SRC, 'src', 'theme.css')));
});

test('build-trainer: תוצר עם פנייה לרשת נדחה', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.js'), 'link.href="https://fonts.googleapis.com/css2"');
  fs.writeFileSync(path.join(d, 'b.js'), 'ok');
  const hits = BT.findForbidden(d);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /a\.js/);
});

test('modules-src לא נארז בתוכנה, ותוצרי הבנייה שלו לא נשמרים ב-git', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(!pkg.build.files.some(f => f.startsWith('modules-src')));
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /modules-src\/\*\/node_modules\//);
  assert.match(ignore, /modules-src\/\*\/dist\//);
});
