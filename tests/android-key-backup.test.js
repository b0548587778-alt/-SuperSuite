// גיבוי מוצפן של מפתח האנדרואיד (PLAN.md 0.1) — על נתונים מדומים בלבד, לא על המפתח האמיתי
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, MAGIC } = require('../tools/android-key-backup');

const FILES = { 'demo.jks': Buffer.from([1, 2, 3, 250, 0, 7]).toString('base64'), 'password.txt': Buffer.from('דוגמה').toString('base64') };

test('הצפנה ופענוח עם אותה סיסמה מחזירים את הקבצים בדיוק', () => {
  const back = decrypt(encrypt(FILES, 'סיסמה-ארוכה-1234'), 'סיסמה-ארוכה-1234');
  assert.deepEqual(back.files, FILES);
});

test('סיסמה שגויה — הודעה בעברית, בלי תוכן', () => {
  const buf = encrypt(FILES, 'סיסמה-ארוכה-1234');
  assert.throws(() => decrypt(buf, 'סיסמה-אחרת-1234'), /סיסמה שגויה/);
});

test('קובץ ששונה אפילו בבית אחד — נדחה', () => {
  const buf = encrypt(FILES, 'סיסמה-ארוכה-1234');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => decrypt(buf, 'סיסמה-ארוכה-1234'), /סיסמה שגויה|פגום/);
});

test('הקובץ המוצפן לא מכיל את התוכן הגלוי, ומתחיל בסימון', () => {
  const buf = encrypt(FILES, 'סיסמה-ארוכה-1234');
  assert.ok(buf.subarray(0, MAGIC.length).equals(MAGIC));
  assert.ok(!buf.includes(Buffer.from('password.txt')));
  assert.ok(!buf.includes(Buffer.from(FILES['demo.jks'])));
});

test('המפתח עצמו לא נכנס לגיט', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^android\/keystore\/?$/m);
  assert.match(ignore, /\.sskey$/m, 'גם קובץ הגיבוי המוצפן לא נכנס למאגר');
});

// בניית ה-APK בלי password.txt (PLAN.md 0.1) — קבצים זמניים בלבד, לא המפתח האמיתי
const os = require('os');
const { resolveKeystorePass } = require('../android/build-apk');

function tmpPassFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-kspass-'));
  const f = path.join(dir, 'password.txt');
  if (content != null) fs.writeFileSync(f, content);
  return f;
}

test('סיסמת המפתח: משתנה הסביבה גובר על הקובץ', async () => {
  const f = tmpPassFile('from-file\n');
  assert.equal(await resolveKeystorePass({ env: { SS_KS_PASS: ' from-env ' }, passFile: f }), 'from-env');
});

test('סיסמת המפתח: בלי משתנה סביבה — מהקובץ, אם עוד קיים', async () => {
  const f = tmpPassFile('from-file\r\n');
  assert.equal(await resolveKeystorePass({ env: {}, passFile: f }), 'from-file');
});

test('סיסמת המפתח: אחרי מחיקת password.txt — הקלדה במסוף', async () => {
  const f = tmpPassFile(null);
  let asked = 0;
  const pass = await resolveKeystorePass({ env: {}, passFile: f, isTTY: true, ask: async () => { asked++; return 'typed'; } });
  assert.equal(pass, 'typed');
  assert.equal(asked, 1);
});

test('סיסמת המפתח: בלי מסוף ובלי קובץ — שגיאה בעברית שמפנה לגיבוי (לא בנייה עם סיסמה ריקה)', async () => {
  const f = tmpPassFile(null);
  await assert.rejects(resolveKeystorePass({ env: {}, passFile: f, isTTY: false, ask: async () => 'x' }), /חסרה סיסמת מפתח החתימה.*android-key-backup/);
  await assert.rejects(resolveKeystorePass({ env: { SS_KS_PASS: '   ' }, passFile: f, isTTY: true, ask: async () => '' }), /חסרה סיסמת/);
});
