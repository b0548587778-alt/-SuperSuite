// חתימת קוד: הדגלים ל-electron-builder נגזרים ממשתני סביבה (tools/code-signing.js, docs/CODE-SIGNING.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { signingArgs } = require('../tools/code-signing');

const SHA1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

test('בלי תעודה: בנייה לא חתומה, בלי דגלים — כמו קודם', () => {
  assert.deepEqual(signingArgs({}), { mode: 'none', args: [] });
});

test('בלי תעודה עם SS_SIGN_REQUIRED=1: נכשל, לא בונה לא חתום בשקט', () => {
  assert.throws(() => signingArgs({ SS_SIGN_REQUIRED: '1' }), /לא הוגדרה תעודת חתימה/);
});

test('תעודה מ-Windows (טוקן): טביעת אצבע באותיות גדולות, רווחים מוסרים', () => {
  const r = signingArgs({ SS_SIGN_SHA1: SHA1.replace(/(.{8})/g, '$1 ') });
  assert.equal(r.mode, 'store');
  assert.ok(r.args.includes('-c.win.signExecutable=true'));
  assert.ok(r.args.includes('-c.win.signtoolOptions.certificateSha1=' + SHA1.toUpperCase()));
  assert.ok(!r.args.some(a => a.includes('forceCodeSigning')));
});

test('טביעת אצבע לא תקינה נדחית', () => {
  assert.throws(() => signingArgs({ SS_SIGN_SHA1: 'abc' }), /40 תווים/);
  assert.throws(() => signingArgs({ SS_SIGN_SHA1: 'z'.repeat(40) }), /40 תווים/);
});

test('PFX: דורש סיסמה; electron-builder קורא את הקובץ בעצמו (לא מועבר בדגלים)', () => {
  assert.throws(() => signingArgs({ CSC_LINK: 'c:/c.pfx' }), /CSC_KEY_PASSWORD/);
  const r = signingArgs({ CSC_LINK: 'c:/c.pfx', CSC_KEY_PASSWORD: 'x', SS_SIGN_REQUIRED: '1' });
  assert.equal(r.mode, 'pfx');
  assert.ok(r.args.includes('-c.win.forceCodeSigning=true'));
  assert.ok(!r.args.join(' ').includes('c.pfx'), 'נתיב התעודה והסיסמה לא נכנסים לשורת הפקודה');
});

test('Azure: כל השדות החובה, וחסר — שגיאה שמפרטת מה חסר', () => {
  assert.throws(() => signingArgs({ SS_AZURE_ENDPOINT: 'https://weu.codesigning.azure.net' }), /SS_AZURE_ACCOUNT, SS_AZURE_PROFILE, SS_SIGN_PUBLISHER/);
  const r = signingArgs({ SS_AZURE_ENDPOINT: 'https://weu.codesigning.azure.net', SS_AZURE_ACCOUNT: 'acc', SS_AZURE_PROFILE: 'prof', SS_SIGN_PUBLISHER: 'Bunim Seller' });
  assert.equal(r.mode, 'azure');
  assert.ok(r.args.includes('-c.win.azureSignOptions.codeSigningAccountName=acc'));
  assert.ok(r.args.includes('-c.win.azureSignOptions.publisherName=Bunim Seller'));
  assert.ok(!r.args.some(a => a.includes('signtoolOptions')), 'Azure ו-signtool אינם משולבים');
});

test('שתי דרכי חתימה יחד — שגיאה, לא בחירה שקטה', () => {
  assert.throws(() => signingArgs({ SS_SIGN_SHA1: SHA1, CSC_LINK: 'c:/c.pfx', CSC_KEY_PASSWORD: 'x' }), /יותר מדרך חתימה אחת/);
});

test('שרת חותמת זמן: רק http/https', () => {
  const r = signingArgs({ SS_SIGN_SHA1: SHA1, SS_SIGN_TIMESTAMP: 'http://time.certum.pl' });
  assert.ok(r.args.includes('-c.win.signtoolOptions.rfc3161TimeStampServer=http://time.certum.pl/'));
  assert.throws(() => signingArgs({ SS_SIGN_SHA1: SHA1, SS_SIGN_TIMESTAMP: 'file:///x' }), /http/);
});

test('הדגלים קיימים בסכימת electron-builder המותקנת', () => {
  const schemePath = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'scheme.json');
  if (!fs.existsSync(schemePath)) return; // בלי node_modules מלאים
  const d = JSON.parse(fs.readFileSync(schemePath, 'utf8')).definitions;
  const win = d.WindowsConfiguration.properties;
  for (const k of ['signExecutable', 'forceCodeSigning', 'signtoolOptions', 'azureSignOptions']) assert.ok(win[k], k);
  for (const k of ['certificateSha1', 'rfc3161TimeStampServer']) assert.ok(d.WindowsSigntoolConfiguration.properties[k], k);
  for (const k of ['endpoint', 'codeSigningAccountName', 'certificateProfileName', 'publisherName', 'timestampRfc3161']) {
    assert.ok(d.WindowsAzureSigningConfiguration.properties[k], k);
  }
});

test('build-local וה-CI משתמשים במודול החתימה', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'build-local.js'), 'utf8'), /tools\/code-signing/);
  assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8'), /tools\/code-signing\.js --args/);
});
