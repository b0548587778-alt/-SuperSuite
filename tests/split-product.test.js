// מעבר לשלושה מאגרים (שלב 6): tools/split-product.js מכין מאגר לתוכנה אחת — עם ההיסטוריה, נעול לבנייה שלה.
// (הבדיקות המלאות בתוך עותק כזה רצו ידנית ועברו; כאן — מה שהכלי משנה, מהר)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SP = require('../tools/split-product');
const EB = require('../tools/edition-build');
const Edition = require('../shell/edition');
const YML = fs.readFileSync(path.join(ROOT, '.github/workflows/build.yml'), 'utf8').replace(/\r\n/g, '\n');
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('build.yml למוצר: רק הקבצים שלו נשמרים ומועלים, ופקודת הפרסום נשארת תקינה', () => {
  for (const id of Edition.PARTIAL_IDS) {
    const y = SP.workflowFor(YML, id);
    const mine = EB.files(id);
    const others = Edition.IDS.filter(x => x !== id).flatMap(x => EB.files(x));
    for (const f of mine) assert.ok(y.includes(f), id + ': ' + f);
    for (const f of others) assert.ok(!y.includes(f), id + ': נשאר ' + f);
    // אין המשך שורה שבולע את השורה הבאה
    const lines = y.split('\n');
    lines.forEach((l, i) => { if (/\\\s*$/.test(l)) assert.match(lines[i + 1], /^\s+dist\//, id + ': שורה ' + (i + 1)); });
    assert.match(y, new RegExp(`gh release create[^\\n]*\\\\\\n\\s+${mine[0].replace(/\./g, '\\.')} ${mine[1].replace(/\./g, '\\.')}\\n`), id);
  }
});

test('package.json למוצר: שם, appId ושמות הקבצים של המוצר', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const p = SP.packageFor(pkg, 'realty');
  assert.equal(p.name, 'supersuite-realty');
  assert.equal(p.build.appId, 'com.bunimseller.supersuite.realty');
  assert.equal(p.build.productName, 'SuperSuite Nadlan');
  assert.equal(p.build.nsis.artifactName, 'SuperSuite-Nadlan-Setup.${ext}');
  assert.equal(p.build.portable.artifactName, 'SuperSuite-Nadlan-Portable.exe');
  assert.equal(pkg.build.appId, 'com.bunimseller.supersuite', 'המקור לא השתנה');
  assert.deepEqual(p.dependencies, pkg.dependencies, 'התלויות זהות — קובץ הנעילה תקף');
});

test('split: עותק עם היסטוריה, commit אחד של המוצר, בלי remote; יעד לא ריק / בתוך המאגר / המלאה — נדחים', (t) => {
  const r0 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (r0.status !== 0) { t.skip('אין git כאן'); return; }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-split-')); dirs.push(base);
  const dest = path.join(base, 'acct');
  SP.split('acct', dest);
  const git = (...a) => spawnSync('git', a, { cwd: dest, encoding: 'utf8' }).stdout.trim();
  assert.match(git('log', '-1', '--format=%s'), /^מאגר המוצר SuperSuite חשבונאות/);
  assert.equal(git('rev-parse', 'HEAD~1'), r0.stdout.trim(), 'ההיסטוריה של המאגר המשותף');
  assert.equal(git('remote'), '', 'בלי origin — הבעלים מוסיף את המאגר החדש');
  assert.equal(git('status', '--porcelain'), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest, 'edition-product.json'), 'utf8')), { products: ['acct'] });
  assert.deepEqual(EB.productLock(dest), ['acct']);
  assert.equal(fs.readFileSync(path.join(dest, 'shell/edition-id.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'shell/edition-id.js'), 'utf8'), 'הקוד נשאר full — המהדורה נקבעת בבנייה');
  assert.match(fs.readFileSync(path.join(dest, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n'), /^# .*\n\n> \*\*מאגר המוצר SuperSuite חשבונאות\*\*/);
  assert.ok(!fs.existsSync(path.join(dest, 'node_modules')));

  assert.throws(() => SP.split('acct', dest), /אינה ריקה/);
  assert.throws(() => SP.split('full', path.join(base, 'x')), /מוצר לא מוכר/);
  assert.throws(() => SP.split('npo', path.join(ROOT, 'tmp-split')), /מחוץ למאגר/);
});

test('edition-product.json פגום או עם מהדורה לא מוכרת — שגיאה בעברית, לא בנייה של מוצר אחר', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-split-lock-')); dirs.push(d);
  assert.equal(EB.productLock(d), null);
  fs.writeFileSync(path.join(d, 'edition-product.json'), '{');
  assert.throws(() => EB.productLock(d), /פגום/);
  fs.writeFileSync(path.join(d, 'edition-product.json'), '{"products":["trainer"]}');
  assert.throws(() => EB.productLock(d), /מהדורה לא מוכרת/);
  fs.writeFileSync(path.join(d, 'edition-product.json'), '{"products":[]}');
  assert.throws(() => EB.productLock(d), /מהדורה לא מוכרת/);
});
