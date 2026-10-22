// סקירת אבטחה, ממצא 3: הכנסת המפתח הציבורי של השורש לתוכנה — owner.js install-root.
// הבדיקה עובדת על עותק זמני של root-keys.js, לעולם לא על הקובץ האמיתי
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const { createOwner, rootKeysSource, installRoot } = require('../tools/licensing/owner');

const REAL = path.join(__dirname, '..', 'shell', 'licensing', 'root-keys.js');
const PASS = 'סיסמת-מנהל-על-ארוכה-2026';

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-root-'));
  const dir = path.join(base, 'owner-data');
  const file = path.join(base, 'root-keys.js');
  // מתחילים מקובץ ריק משלנו — לא מהאמיתי, שאולי כבר מכיל את מפתח הבעלים (CLAUDE.md: אין להניח ריק או מלא)
  fs.writeFileSync(file, 'module.exports = [];\n');
  const r = createOwner({ dir, passphrase: PASS }).init();
  return { dir, file, r };
}

test('init ואז install-root: המפתח הציבורי בקובץ, והקובץ נטען כמערך תקין', () => {
  const { dir, file, r } = setup();
  const before = fs.readFileSync(REAL, 'utf8');
  const out = installRoot(dir, file);
  assert.equal(out.added, true);
  assert.equal(out.keyId, r.keyId);
  delete require.cache[require.resolve(file)];
  const keys = require(file);
  assert.equal(keys.length, 1);
  assert.equal(L.keyId(keys[0]), r.keyId);
  assert.ok(!('d' in keys[0]), 'אין חלק פרטי');
  assert.equal(fs.readFileSync(REAL, 'utf8'), before, 'הקובץ האמיתי לא נגע');
});

test('הרצה שנייה — בלי שינוי; מפתח נוסף נשמר לצד הקיים (החלפת מפתח)', () => {
  const { dir, file } = setup();
  installRoot(dir, file);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(installRoot(dir, file).added, false);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  const second = setup();
  const r2 = installRoot(second.dir, file);
  assert.equal(r2.added, true);
  delete require.cache[require.resolve(file)];
  assert.equal(require(file).length, 2);
});

test('מפתח פרטי נדחה — לא נארז בטעות בתוכנה', () => {
  const k = L.generateKeyPair();
  assert.throws(() => rootKeysSource([], k.privateJwk), /מפתח פרטי/);
  assert.throws(() => rootKeysSource([], null), /אינו תקין/);
});

test('בלי init — הודעה ברורה', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-root-'));
  assert.throws(() => installRoot(path.join(base, 'none'), path.join(base, 'x.js')), /יש להריץ קודם init/);
});

test('רישיון שהונפק במפתח הזה מאומת מול הקובץ שנוצר', () => {
  const { dir, file } = setup();
  installRoot(dir, file);
  delete require.cache[require.resolve(file)];
  const rootKeys = require(file);
  const owner = createOwner({ dir, passphrase: PASS });
  const node = L.generateKeyPair();
  const request = JSON.stringify({ type: 'supersuite-license-request', v: 1, name: 'ישיבת תורת חיים', publicKey: node.publicJwk, keyId: L.keyId(node.publicJwk) });
  const pkg = JSON.parse(owner.issue({ request, features: ['econ'], limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 1 }, months: 12 }).package);
  assert.equal(L.verifyChain(pkg.chain, rootKeys).id, L.keyId(node.publicJwk));
});
