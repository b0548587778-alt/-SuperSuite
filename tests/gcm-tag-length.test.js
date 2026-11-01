// AES-256-GCM: פענוח מקבל רק תג אימות באורך מלא (16 בתים). בלי authTagLength, Node מקבל גם תג מקוצר —
// ותג אמיתי שנחתך ל-4 בתים עובר, כלומר זיוף דורש רק 2^32 ניסיונות. נמצא בסריקת semgrep (gcm-no-tag-length)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BK = require('../modules/econ/core/backupCrypto');
const AR = require('../modules/econ/core/atRest');
const L = require('../shell/licensing/license');
const M = require('../shell/licensing/messages');

test('גיבוי מוצפן: תג שנחתך ל-4 בתים נדחה', () => {
  const sealed = BK.encryptBackup('{"x":1}', 'סיסמה-חזקה-מאוד-1');
  assert.equal(BK.decryptBackup(sealed, 'סיסמה-חזקה-מאוד-1'), '{"x":1}');
  const payload = JSON.parse(Buffer.from(sealed.slice('SSBK1:'.length), 'base64').toString('utf8'));
  payload.tag = Buffer.from(payload.tag, 'base64').subarray(0, 4).toString('base64');
  const forged = 'SSBK1:' + Buffer.from(JSON.stringify(payload)).toString('base64');
  assert.throws(() => BK.decryptBackup(forged, 'סיסמה-חזקה-מאוד-1'), /שגויה או שהקובץ פגום/);
});

test('הודעה מהשרת: תג שנחתך ל-4 בתים נדחה', () => {
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const contacts = [{ id: a.keyId, name: 'א', publicKey: a.publicJwk }];
  const r = M.seal(a.privateJwk, b.publicJwk, { text: 'שלום', sentAt: 1 });
  assert.equal(M.open(b.privateJwk, r.envelope, contacts).text, 'שלום');
  const env = JSON.parse(r.envelope);
  const tag = Buffer.from(env.tag, 'base64url');
  env.tag = tag.subarray(0, 4).toString('base64url');
  assert.throws(() => M.open(b.privateJwk, JSON.stringify(env), contacts));
});

test('הצפנה במחשב (atRest): פענוח עם authTagLength — ערך תקין נפתח', () => {
  const c = AR.createCipher(crypto.randomBytes(32));
  assert.equal(c.open(c.seal('טקסט')), 'טקסט');
});

test('כל פענוח GCM בקוד המוצר מחייב תג באורך 16', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['modules/econ/core/backupCrypto.js', 'modules/econ/core/atRest.js', 'shell/sync/envelope.js', 'shell/licensing/messages.js', 'tools/android-key-backup.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const calls = src.match(/createDecipheriv\([^;]*;/g) || [];
    assert.ok(calls.length, f);
    for (const c of calls) assert.match(c, /authTagLength: 16/, f);
  }
  assert.match(fs.readFileSync(path.join(root, 'android/web/node-shims.js'), 'utf8'), /tag\.length !== 16/, 'גם התחליף באנדרואיד');
});
