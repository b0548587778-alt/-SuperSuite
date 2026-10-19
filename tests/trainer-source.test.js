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
  assert.match(html, /href="\/suite-theme\.css"/);
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

test('build-trainer: ערכת הצבעים מוזזת לסוף ה-head (אחרי ה-CSS ש-Vite מוסיף)', () => {
  const built = '<html><head>\n<link rel="stylesheet" href="/suite-theme.css">\n<script type="module" src="/assets/index-X.js"></script>\n<link rel="stylesheet" href="/assets/index-Y.css">\n</head><body></body></html>';
  const out = BT.fixThemeOrder(built);
  assert.ok(out.indexOf('/suite-theme.css') > out.indexOf('/assets/index-Y.css'));
  assert.equal(out.match(/suite-theme\.css/g).length, 1);
  assert.throws(() => BT.fixThemeOrder('<head></head>'), /suite-theme/);
});

test('build-trainer: התקנה מוחקת חבילות ישנות ושומרת את קבצי השילוב', () => {
  const out = tmp();
  const dist = tmp();
  fs.mkdirSync(path.join(out, 'assets'));
  fs.writeFileSync(path.join(out, 'assets', 'index-OLD.js'), 'old');
  fs.writeFileSync(path.join(out, 'preload.js'), 'PRELOAD');
  fs.writeFileSync(path.join(out, 'suite-theme.css'), 'THEME');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'index-NEW.js'), 'new');
  fs.writeFileSync(path.join(dist, 'index.html'), '<head><link rel="stylesheet" href="/suite-theme.css"><link rel="stylesheet" href="/assets/index-NEW.css"></head>');
  BT.install(dist, out);
  assert.ok(!fs.existsSync(path.join(out, 'assets', 'index-OLD.js')), 'חבילה ישנה נמחקה');
  assert.ok(fs.existsSync(path.join(out, 'assets', 'index-NEW.js')));
  assert.equal(fs.readFileSync(path.join(out, 'preload.js'), 'utf8'), 'PRELOAD');
  assert.equal(fs.readFileSync(path.join(out, 'suite-theme.css'), 'utf8'), 'THEME');
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.indexOf('/suite-theme.css') > html.indexOf('/assets/index-NEW.css'));
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
