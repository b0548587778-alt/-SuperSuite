// ממצא 3 בדוח הבדיקה: גיבוי ידני בסיסמה — scrypt חזק יותר (v2, הפרמטרים בקובץ, רשימה סגורה), 12 תווים לגיבוי חדש,
// וגיבויים ישנים (v1, גם בסיסמה בת 8 תווים) ממשיכים להיפתח. סיסמאות המשתמשים — "scrypt2$", וישן מוחלף בכניסה.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../modules/econ/core/backupCrypto');
const { initializeDatabase } = require('../modules/econ/core/database');

const PREFIX = 'SSBK1:';
const payloadOf = (text) => JSON.parse(Buffer.from(text.slice(PREFIX.length), 'base64').toString('utf8'));
const pack = (payload) => PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

// גיבוי כפי שנכתב לפני התיקון: v1, N=2^14 r=8 p=1, בלי פרמטרים בקובץ
function legacyBackup(plain, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return pack({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

test('גיבוי חדש — v2 עם הפרמטרים בקובץ, ונפתח', () => {
  const plain = JSON.stringify({ suite: 'SuperSuite', note: 'קופת צדקה ₪' });
  const enc = C.encryptBackup(plain, 'תפארת-ישראל-1');
  const p = payloadOf(enc);
  assert.equal(p.v, 2);
  assert.deepEqual(p.scrypt, { N: 16384, r: 8, p: 5 });
  assert.equal(C.decryptBackup(enc, 'תפארת-ישראל-1'), plain);
});

test('גיבוי חדש דורש 12 תווים; פתיחה של גיבוי ישן — גם בסיסמה של 8 תווים', () => {
  assert.equal(C.MIN_PASSPHRASE, 12);
  assert.throws(() => C.encryptBackup('x', 'abcdefghijk'), /לפחות 12 תווים/);
  assert.ok(C.encryptBackup('x', 'abcdefghijkl'));
  const old = legacyBackup('{"a":1}', 'shalom12');
  assert.equal(C.decryptBackup(old, 'shalom12'), '{"a":1}');
  assert.throws(() => C.decryptBackup(old, 'shalom13'), /שגויה/);
});

test('גיבוי ישן בלי שדה v נפתח כ-v1', () => {
  const p = payloadOf(legacyBackup('ok', 'old-pass-1'));
  delete p.v;
  assert.equal(C.decryptBackup(pack(p), 'old-pass-1'), 'ok');
});

test('פרמטרים שנערכו בקובץ נדחים מיד — בלי חישוב ענק ובלי לנסות פרמטרים אחרים', () => {
  const enc = C.encryptBackup('{"a":1}', 'סיסמה-ארוכה-12');
  const big = payloadOf(enc);
  big.scrypt = { N: 2 ** 20, r: 8, p: 5 };
  const t0 = Date.now();
  assert.throws(() => C.decryptBackup(pack(big), 'סיסמה-ארוכה-12'), /פגום/);
  assert.ok(Date.now() - t0 < 200, 'לא רץ scrypt על פרמטרים מהקובץ');

  const weak = payloadOf(enc);
  weak.scrypt = { N: 16384, r: 8, p: 1 };
  assert.throws(() => C.decryptBackup(pack(weak), 'סיסמה-ארוכה-12'), /פגום/);

  const downgraded = payloadOf(enc);
  downgraded.v = 1; delete downgraded.scrypt;
  assert.throws(() => C.decryptBackup(pack(downgraded), 'סיסמה-ארוכה-12'), /שגויה|פגום/, 'הורדת גרסה = מפתח אחר, GCM דוחה');

  for (const v of [3, '2', 0, -1, 1.5, null]) {
    const p = payloadOf(enc); p.v = v;
    assert.throws(() => C.decryptBackup(pack(p), 'סיסמה-ארוכה-12'), /גרסה חדשה יותר|פגום/, `v=${v}`);
  }
  for (const bad of [pack(null), pack([]), pack({ v: 2 }), pack('x')]) {
    assert.throws(() => C.decryptBackup(bad, 'סיסמה-ארוכה-12'), /פגום/);
  }
});

test('הפרמטרים של v2 עובדים גם במגבלת הזיכרון של Scrypt.java (512MiB) ובברירת המחדל של Node', () => {
  const p = C.PARAMS[2];
  assert.ok(128 * p.N * p.r <= 32 * 1024 * 1024, 'בתוך maxmem של Node בלי הגדרה מיוחדת');
  assert.ok(p.N * p.r * p.p >= 16384 * 8 * 5, 'לפחות החלופה של OWASP: N=2^14, r=8, p=5');
});

test('חלון הגיבוי במעטפת דורש 12 תווים (השחזור — בלי מינימום)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');
  assert.match(src, /if \(!optional && v\.length < 12\)/);
  assert.doesNotMatch(src, /v\.length < 8\b/);
});

async function freshDb() {
  return initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pwhash-')));
}

test('סיסמת משתמש חדשה נשמרת כ-scrypt2', async () => {
  const db = await freshDb();
  await db.setupAdmin('menahel', 'סיסמת-מנהל-חזקה');
  const [row] = await db.all('SELECT password_hash FROM auth_users WHERE username = ?', ['menahel']);
  assert.match(row.password_hash, /^scrypt2\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(await db.authenticate('menahel', 'סיסמת-מנהל-חזקה'));
  await assert.rejects(db.authenticate('menahel', 'סיסמה-אחרת-לגמרי'), /שגויים/);
});

test('משתמש עם hash ישן נכנס כרגיל, וה-hash מוחלף לחזק בכניסה', async () => {
  const db = await freshDb();
  await db.setupAdmin('gabai', 'סיסמה-זמנית-ארוכה');
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = `scrypt$${salt}$${crypto.scryptSync('בית-המדרש-2026', salt, 64).toString('hex')}`;
  await db.run('UPDATE auth_users SET password_hash = ? WHERE username = ?', [legacy, 'gabai']);

  await assert.rejects(db.authenticate('gabai', 'בית-המדרש-2027'), /שגויים/);
  let [row] = await db.all('SELECT password_hash, failed_attempts FROM auth_users WHERE username = ?', ['gabai']);
  assert.equal(row.password_hash, legacy, 'כניסה כושלת לא מחליפה את ה-hash');
  assert.equal(row.failed_attempts, 1);

  const user = await db.authenticate('gabai', 'בית-המדרש-2026');
  assert.equal(user.username, 'gabai');
  [row] = await db.all('SELECT password_hash, failed_attempts FROM auth_users WHERE username = ?', ['gabai']);
  assert.match(row.password_hash, /^scrypt2\$/);
  assert.equal(row.failed_attempts, 0);
  assert.ok(await db.authenticate('gabai', 'בית-המדרש-2026'), 'נכנס גם אחרי ההחלפה');
});

test('hash עם תחילית לא מוכרת לא מתקבל', async () => {
  const db = await freshDb();
  await db.setupAdmin('rav', 'סיסמה-של-הרב-12');
  const [row] = await db.all('SELECT password_hash FROM auth_users WHERE username = ?', ['rav']);
  await db.run('UPDATE auth_users SET password_hash = ? WHERE username = ?', [row.password_hash.replace(/^scrypt2\$/, 'scrypt9$'), 'rav']);
  await assert.rejects(db.authenticate('rav', 'סיסמה-של-הרב-12'), /שגויים/);
});
