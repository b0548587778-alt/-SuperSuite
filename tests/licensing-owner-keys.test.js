// שמירה על מפתח מנהל-העל: קודי שחזור (Shamir), החלפת סיסמה, גיבוי מלא ושחזור במחשב חדש
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const SH = require('../shell/licensing/shamir');
const L = require('../shell/licensing/license');
const { createOwnerCore } = require('../shell/licensing/owner-core');

const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t), m }; };
const PASS = 'menahel-al-keys-2026';
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

test('Shamir: כל k מתוך n משחזרים; פחות מ-k — לא; כל צירוף מניב אותו סוד', () => {
  const secret = new Uint8Array(crypto.randomBytes(32));
  const shares = SH.split(secret, 5, 3);
  for (const combo of [[0, 1, 2], [0, 2, 4], [4, 3, 1], [1, 2, 3, 4]]) assert.ok(eq(SH.combine(combo.map(i => shares[i])), secret), String(combo));
  // שני חלקים בלבד נותנים תוצאה שאינה הסוד
  assert.ok(!eq(SH.combine([shares[0], shares[1]]), secret));
  assert.throws(() => SH.split(secret, 2, 3), /אינו תקין/);
  assert.throws(() => SH.combine([shares[0], shares[0]]), /פעמיים/);
});

test('Shamir: חלק בודד אינו מגלה דבר — כל ערך אפשרי באותה מידה (k=2)', () => {
  // עם k=2: y = s + a*x. לחלק קבוע, כל סוד אפשרי מתאים לבדיוק a אחד — לכן אין מידע
  const seen = new Set();
  // 5000 דגימות: כל 256 הערכים צפויים להופיע (הסתברות להחמצה ~10^-6)
  for (let i = 0; i < 5000; i++) seen.add(SH.split(new Uint8Array([7]), 2, 2)[0].y[0]);
  assert.equal(seen.size, 256, 'החלק הראשון מתפזר על כל הערכים');
});

test('קודים טקסטואליים: ספרת ביקורת, סט שונה, פורמט', () => {
  const secret = new Uint8Array(crypto.randomBytes(32));
  const a = SH.splitToCodes(secret, 5, 3);
  const b = SH.splitToCodes(secret, 5, 3);
  assert.match(a.codes[0], /^SSK1-[A-Z0-9]{8}-3-1-[A-Z0-9]+-[A-Z0-9]{4}$/);
  assert.ok(eq(SH.combineCodes([a.codes[4], a.codes[0], a.codes[2]]), secret));
  assert.ok(eq(SH.combineCodes(a.codes.slice(1, 4).map(c => c.toLowerCase().replace(/-/g, '-'))), secret), 'אותיות קטנות מתקבלות');
  assert.throws(() => SH.combineCodes([a.codes[0], b.codes[1], a.codes[2]]), /אינם מאותו גיבוי/);
  assert.throws(() => SH.combineCodes(a.codes.slice(0, 2)), /לפחות 3/);
  const typo = a.codes[0].replace(/-(\w)(\w+)-(\w{4})$/, (m, c1, rest, chk) => `-${c1 === 'A' ? 'B' : 'A'}${rest}-${chk}`);
  assert.throws(() => SH.decodeShare(typo), /שגיאה/);
});

test('מנהל-העל: קודי שחזור משחזרים את המפתח במחשב חדש, והרישיונות שנחתמו ממשיכים להיות תקפים', () => {
  const pc1 = createOwnerCore({ storage: mem() });
  const { publicKey } = pc1.init(PASS);
  const signed = L.signObject({ hello: 'שלום' }, pc1.rootSigner());
  const r = pc1.recoveryCodes(5, 3);
  assert.equal(r.codes.length, 5);
  assert.equal(pc1.recoveryInfo().k, 3);

  const pc2 = createOwnerCore({ storage: mem() });
  assert.throws(() => pc2.recoverFromCodes(r.codes.slice(0, 2), 'new-strong-pass-1'), /לפחות 3/);
  const rec = pc2.recoverFromCodes([r.codes[1], r.codes[3], r.codes[4]], 'new-strong-pass-1');
  assert.equal(rec.keyId, L.keyId(publicKey));
  assert.deepEqual(pc2.pubkey(), publicKey);
  assert.ok(L.verifyObject({ hello: 'שלום' }, L.signObject({ hello: 'שלום' }, pc2.rootSigner()), publicKey));
  assert.ok(L.verifyObject({ hello: 'שלום' }, signed, pc2.pubkey()));
  // הסיסמה החדשה פועלת
  pc2.lock();
  assert.throws(() => pc2.unlock(PASS), /שגויה/);
  pc2.unlock('new-strong-pass-1');

  // קודים של מפתח אחר לא נכנסים למחשב שכבר יש בו מפתח
  const other = createOwnerCore({ storage: mem() });
  other.init(PASS);
  const otherCodes = other.recoveryCodes(3, 2).codes;
  assert.throws(() => pc1.recoverFromCodes(otherCodes.slice(0, 2), 'another-pass-123'), /מפתח אחר/);
});

test('מנהל-העל: החלפת סיסמה ושחזור מגיבוי מלא כולל רשימת הלקוחות', () => {
  const s1 = mem();
  const pc1 = createOwnerCore({ storage: s1 });
  pc1.init(PASS);
  const dev = L.generateKeyPair();
  pc1.issue({ request: JSON.stringify({ type: 'supersuite-license-request', v: 1, name: 'כולל חזון איש', publicKey: dev.publicJwk, keyId: dev.keyId }),
    features: ['econ'], limits: { maxUsers: 2, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 } });
  assert.throws(() => pc1.changePassphrase('wrong-pass-12345', 'new-pass-123456'), /שגויה/);
  pc1.changePassphrase(PASS, 'new-pass-123456');
  pc1.lock();
  pc1.unlock('new-pass-123456');

  const backup = pc1.exportBackup('backup-pass-12345');
  assert.doesNotMatch(backup, /חזון איש/, 'הגיבוי מוצפן');
  const pc2 = createOwnerCore({ storage: mem() });
  assert.throws(() => pc2.importBackup(backup, 'wrong-pass-00000'), /שגויה/);
  const r = pc2.importBackup(backup, 'backup-pass-12345');
  assert.equal(r.tenants, 1);
  assert.equal(pc2.isUnlocked(), false, 'אחרי שחזור — כניסה בסיסמת מנהל-העל');
  pc2.unlock('new-pass-123456');
  assert.equal(pc2.list().tenants[0].name, 'כולל חזון איש');
  pc1.lock();
  assert.throws(() => pc1.exportBackup('x'.repeat(12)), /לפתוח/, 'גיבוי רק כשפתוח');
});
