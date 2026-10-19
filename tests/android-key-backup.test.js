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
// מאיפה הבנייה לוקחת את המפתח (PLAN.md 0.1) — קבצים זמניים בלבד, לא המפתח האמיתי
const os = require('os');
const { resolveSigningKey, ensureKeystore } = require('../android/build-apk');
const { openBackup } = require('../tools/android-key-backup');

const JKS = Buffer.from([9, 8, 7, 6, 5]);
const PAPER = 'הסיסמה-שעל-הנייר';

// תיקייה זמנית: keystore/ (אופציונלי), password.txt (אופציונלי), וגיבוי מוצפן (אופציונלי)
function sandbox({ jks = null, passTxt = null, backup = false, backupJks = JKS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-signkey-'));
  const keystore = path.join(dir, 'release.jks');
  const passFile = path.join(dir, 'password.txt');
  const backupFile = path.join(dir, 'key.sskey');
  if (jks) fs.writeFileSync(keystore, jks);
  if (passTxt != null) fs.writeFileSync(passFile, passTxt);
  if (backup) {
    const files = { 'supersuite-release.jks': backupJks.toString('base64'), 'password.txt': Buffer.from('key-pass\n').toString('base64') };
    fs.writeFileSync(backupFile, encrypt(files, PAPER));
  }
  return { keystore, passFile, backupFile };
}

test('הגיבוי נפתח בזיכרון: המפתח וסיסמת המפתח, בלי לכתוב לדיסק', () => {
  const { backupFile } = sandbox({ backup: true });
  const k = openBackup(fs.readFileSync(backupFile), PAPER);
  assert.ok(k.jks.equals(JKS));
  assert.equal(k.pass, 'key-pass');
  const noPass = encrypt({ 'a.jks': JKS.toString('base64') }, PAPER);
  assert.throws(() => openBackup(noPass, PAPER), /אין את סיסמת המפתח/);
});

test('יש גיבוי: מקלידים רק את הסיסמה שעל הנייר, פעם אחת', async () => {
  const s = sandbox({ backup: true });
  const prompts = [];
  const key = await resolveSigningKey({ ...s, env: {}, isTTY: true, openBackup, ask: async p => { prompts.push(p); return PAPER; } });
  assert.equal(key.source, 'backup');
  assert.equal(key.pass, 'key-pass');
  assert.ok(key.jksBytes.equals(JKS));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /נייר/);
});

test('סיסמה שגויה — מבקשים שוב, ואחרי 3 ניסיונות עוצרים', async () => {
  const s = sandbox({ backup: true });
  let n = 0;
  const key = await resolveSigningKey({ ...s, env: {}, isTTY: true, openBackup, ask: async () => (++n < 3 ? 'לא-נכון' : PAPER) });
  assert.equal(key.source, 'backup');
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(resolveSigningKey({ ...s, env: {}, isTTY: true, openBackup, ask: async () => { n++; return 'לא-נכון'; } }), /סיסמה שגויה/);
  assert.equal(n, 3);
});

test('מפתח בתיקייה שונה מהמפתח שבגיבוי — עוצרים ולא מנחשים', async () => {
  const s = sandbox({ jks: Buffer.from([1, 1, 1]), backup: true });
  await assert.rejects(resolveSigningKey({ ...s, env: {}, isTTY: true, openBackup, ask: async () => PAPER }), /שונה מהמפתח שבגיבוי/);
  const same = sandbox({ jks: JKS, backup: true });
  const key = await resolveSigningKey({ ...same, env: {}, isTTY: true, openBackup, ask: async () => PAPER });
  assert.equal(key.source, 'backup');
});

test('גיבוי בלי מסוף — שגיאה בעברית ולא בנייה', async () => {
  const s = sandbox({ backup: true });
  await assert.rejects(resolveSigningKey({ ...s, env: {}, isTTY: false, openBackup, ask: async () => PAPER }), /בחלון רגיל/);
});

test('בלי גיבוי: המפתח שבתיקייה — משתנה הסביבה, אחר כך password.txt, אחר כך הקלדה', async () => {
  const s = sandbox({ jks: JKS, passTxt: 'from-file\r\n' });
  assert.equal((await resolveSigningKey({ ...s, env: { SS_KS_PASS: ' from-env ' } })).pass, 'from-env');
  assert.equal((await resolveSigningKey({ ...s, env: {} })).pass, 'from-file');
  fs.rmSync(s.passFile);
  const typed = await resolveSigningKey({ ...s, env: {}, isTTY: true, ask: async () => 'typed' });
  assert.deepEqual([typed.source, typed.pass, typed.jks], ['folder', 'typed', s.keystore]);
  await assert.rejects(resolveSigningKey({ ...s, env: {}, isTTY: false }), /חסרה סיסמת מפתח החתימה/);
});

test('אין מפתח ואין גיבוי — לא נוצר מפתח חדש בלי --new-key', async () => {
  const s = sandbox();
  await assert.rejects(resolveSigningKey({ ...s, env: {}, isTTY: true, openBackup, ask: async () => 'x' }), /לא נוצר מפתח חדש/);
  assert.equal(fs.existsSync(s.keystore), false);
  assert.equal((await resolveSigningKey({ ...s, env: {}, allowNew: true })).source, 'new');
});

test('מפתח מהגיבוי נכתב לקובץ זמני בלבד, שנמחק בסוף', () => {
  const ks = ensureKeystore({}, { source: 'backup', jksBytes: JKS, pass: 'key-pass' });
  assert.ok(fs.readFileSync(ks.jks).equals(JKS));
  assert.ok(ks.jks.startsWith(os.tmpdir()));
  ks.cleanup();
  assert.equal(fs.existsSync(path.dirname(ks.jks)), false);
});

test('לחיצה כפולה: build-apk.bat מריץ את הבנייה ועוצר בשגיאה', () => {
  const bat = fs.readFileSync(path.join(__dirname, '..', 'build-apk.bat'), 'utf8');
  assert.match(bat, /cd \/d "%~dp0"/);
  assert.match(bat, /node android\/build-apk\.js/);
  assert.ok(!/--new-key/.test(bat), 'הקובץ ללחיצה לא יוצר מפתח חדש');
  assert.match(bat, /\r\n/, 'שורות CRLF');
});
