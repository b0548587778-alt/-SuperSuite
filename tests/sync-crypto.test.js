// סנכרון עמית-לעמית, שלב 1: זהות מכשיר, מעטפת הודעה וצימוד (docs/SYNC-DESIGN.md).
// כולל וקטורי בדיקה רשמיים מה-RFC, כדי לוודא שהפרימיטיבים הם התקניים (ויתאימו למימוש WebCrypto).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Identity = require(path.join(ROOT, 'shell/sync/identity.js'));
const Envelope = require(path.join(ROOT, 'shell/sync/envelope.js'));
const Pairing = require(path.join(ROOT, 'shell/sync/pairing.js'));

const hex = (h) => Buffer.from(h, 'hex');
const u = (h) => hex(h).toString('base64url');
const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);

// ── וקטורי RFC ──
test('RFC 8032 §7.1 (Ed25519, בדיקה 1): חתימה זהה לווקטור הרשמי', () => {
  const key = crypto.createPrivateKey({ format: 'jwk', key: {
    kty: 'OKP', crv: 'Ed25519',
    d: u('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'),
    x: u('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
  } });
  const sig = crypto.sign(null, Buffer.alloc(0), key).toString('hex');
  assert.equal(sig, 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
});

test('RFC 7748 §6.1 (X25519): הסוד המשותף זהה לווקטור הרשמי, בשני הכיוונים', () => {
  const alice = { kty: 'OKP', crv: 'X25519', d: u('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'), x: u('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a') };
  const bob = { kty: 'OKP', crv: 'X25519', d: u('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb'), x: u('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f') };
  const expected = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(crypto.diffieHellman({ privateKey: Identity.privateKey(alice), publicKey: Identity.publicKey(bob) }).toString('hex'), expected);
  assert.equal(crypto.diffieHellman({ privateKey: Identity.privateKey(bob), publicKey: Identity.publicKey(alice) }).toString('hex'), expected);
});

test('RFC 5869 נספח A.1 (HKDF-SHA-256): הפלט זהה לווקטור הרשמי', () => {
  const okm = crypto.hkdfSync('sha256', Buffer.alloc(22, 0x0b), hex('000102030405060708090a0b0c'), hex('f0f1f2f3f4f5f6f7f8f9'), 42);
  assert.equal(Buffer.from(okm).toString('hex'), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});

// ── זהות ──
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(s).map(b => b ^ 0x5a)]),
  decryptString: (b) => { if (b.subarray(0, 4).toString() !== 'ENC:') throw new Error('x'); return Buffer.from(b.subarray(4).map(c => c ^ 0x5a)).toString(); },
});

test('זהות: נוצרת פעם אחת, נשמרת מוצפנת, ונטענת זהה; בלי DPAPI — אין סנכרון', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sync-'));
  const file = path.join(dir, 'sync-identity.bin');
  const ss = fakeSafeStorage();
  assert.throws(() => Identity.loadIdentity({ file, safeStorage: ss }), { code: 'no-identity' });
  const a = Identity.loadIdentity({ file, safeStorage: ss, create: true, name: 'מחשב המשרד' });
  assert.ok(!fs.readFileSync(file, 'utf8').includes(a.sign.d), 'המפתח הפרטי לא נשמר גלוי');
  const again = Identity.loadIdentity({ file, safeStorage: ss, create: true });
  assert.deepEqual(again, a, 'טעינה חוזרת לא יוצרת זהות חדשה');
  assert.throws(() => Identity.loadIdentity({ file: path.join(dir, 'x'), safeStorage: fakeSafeStorage(false), create: true }), { code: 'no-encryption' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('זהות משלב 1 (בלי מפתח TLS) מושלמת בטעינה ונשמרת, והמזהה לא משתנה', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sync-'));
  const file = path.join(dir, 'sync-identity.bin');
  const ss = fakeSafeStorage();
  const old = Identity.createIdentity('ישן');
  delete old.tls;
  fs.writeFileSync(file, ss.encryptString(JSON.stringify(old)));
  const loaded = Identity.loadIdentity({ file, safeStorage: ss });
  assert.equal(loaded.id, old.id);
  assert.equal(loaded.tls.crv, 'P-256');
  assert.deepEqual(Identity.loadIdentity({ file, safeStorage: ss }).tls, loaded.tls, 'נשמר — לא נוצר מפתח חדש בכל טעינה');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('זהות: המידע הציבורי בלי מפתח פרטי, ומזהה שלא תואם למפתח נדחה', () => {
  const a = Identity.createIdentity('א');
  const pub = Identity.publicInfo(a);
  assert.ok(!('d' in pub.sign) && !('d' in pub.dh));
  assert.deepEqual(Identity.validatePublicInfo(pub).id, a.id);
  const b = Identity.createIdentity('ב');
  assert.throws(() => Identity.validatePublicInfo({ ...pub, id: b.id }), /אינו תואם/);
  assert.throws(() => Identity.validatePublicInfo({ ...pub, sign: a.sign }), /לא תקינים/, 'מפתח פרטי בתוך מידע ציבורי נדחה');
  assert.throws(() => Identity.validatePublicInfo({ ...pub, dh: { ...pub.dh, crv: 'Ed25519' } }), /לא תקינים/);
});

// ── מעטפת ──
function pair() {
  const a = Identity.createIdentity('מחשב');
  const b = Identity.createIdentity('טלפון');
  return { a, b, pa: Identity.publicInfo(a), pb: Identity.publicInfo(b) };
}

test('מעטפת: הודעה עוברת בשלמותה, כולל עברית; התוכן לא גלוי במעטפה', () => {
  const { a, b, pa, pb } = pair();
  const body = { type: 'chat', text: 'שלום, הקבלה מוכנה', amount: 18000 };
  const env = Envelope.seal({ identity: a, peer: pb, seq: 1, body, now: NOW });
  assert.ok(!JSON.stringify(env).includes('18000') && !JSON.stringify(env).includes(Buffer.from('שלום').toString('base64')));
  assert.deepEqual(Envelope.open({ identity: b, peer: pa, env, now: NOW + 1000 }).body, body);
  assert.deepEqual(Envelope.deriveKey(a, pb), Envelope.deriveKey(b, pa), 'אותו מפתח בשני הצדדים');
});

test('מעטפת: שינוי של כל שדה, שידור חוזר, יעד שגוי, שולח מתחזה וזמן ישן — נדחים', () => {
  const { a, b, pa, pb } = pair();
  const env = Envelope.seal({ identity: a, peer: pb, seq: 5, body: { x: 1 }, now: NOW });
  const open = (e, extra = {}) => Envelope.open({ identity: b, peer: pa, env: e, now: NOW, ...extra });

  for (const field of ['seq', 'ts', 'nonce', 'ct', 'tag', 'from', 'to']) {
    const bad = { ...env };
    bad[field] = typeof env[field] === 'number' ? env[field] + 1 : env[field].slice(0, -2) + (env[field].endsWith('AA') ? 'AB' : 'AA');
    assert.throws(() => open(bad), (e) => ['bad-signature', 'wrong-recipient', 'wrong-sender', 'malformed'].includes(e.code), 'שינוי ב-' + field);
  }
  assert.throws(() => open(env, { lastSeq: 5 }), { code: 'replay' });
  assert.throws(() => open(env, { now: NOW + Envelope.MAX_SKEW_MS + 1 }), { code: 'stale' });

  const c = Identity.createIdentity('זר');
  assert.throws(() => Envelope.open({ identity: c, peer: pa, env, now: NOW }), { code: 'wrong-recipient' });
  // מכשיר זר חותם בעצמו ומתחזה ל-a — החתימה לא עוברת מול המפתח של a
  const forged = Envelope.seal({ identity: { ...c, id: a.id }, peer: pb, seq: 9, body: { x: 2 }, now: NOW });
  assert.throws(() => open(forged), { code: 'bad-signature' });
  assert.throws(() => open(null), { code: 'malformed' });
  assert.throws(() => open({ ...env, v: 2 }), { code: 'malformed' });
});

test('מעטפת: מפתח עמית מסדר נמוך (סוד אפסים) נדחה', () => {
  const { a } = pair();
  const evil = { id: 'x', dh: { kty: 'OKP', crv: 'X25519', x: Buffer.alloc(32).toString('base64url') } };
  assert.throws(() => Envelope.deriveKey(a, evil));
});

// ── צימוד ──
test('צימוד: שני המכשירים מגיעים לאותו קוד אימות ולפרטים הנכונים זה של זה', () => {
  const { a, b } = pair();
  const { code, pending } = Pairing.createInvite(a, { now: NOW });
  const accepted = Pairing.acceptInvite(b, code, { now: NOW + 1000 });
  const done = Pairing.completePairing(a, pending, accepted.response, { now: NOW + 2000 });
  assert.match(done.code, /^\d{6}$/);
  assert.equal(done.code, accepted.code);
  assert.equal(done.peer.id, b.id);
  assert.equal(accepted.peer.id, a.id);
  assert.ok(!code.includes(a.sign.d) && !code.includes(a.dh.d), 'ההזמנה בלי מפתח פרטי');
});

test('צימוד: הזמנה חד-פעמית, פגת תוקף, ותשובה ממי שלא מחזיק בקוד — נדחות', () => {
  const { a, b } = pair();
  const { code, pending } = Pairing.createInvite(a, { now: NOW });
  assert.throws(() => Pairing.acceptInvite(b, code, { now: NOW + Pairing.INVITE_TTL_MS + 1 }), { code: 'expired' });

  // תוקף שלא מכיר את הסוד מנחש אותו — ההוכחה לא עוברת, וההזמנה נשרפת
  const c = Identity.createIdentity('תוקף');
  const fakeInvite = Pairing.createInvite(a, { now: NOW });
  const forged = Pairing.acceptInvite(c, fakeInvite.code, { now: NOW }).response;
  assert.throws(() => Pairing.completePairing(a, pending, forged, { now: NOW }), { code: 'bad-proof' });
  assert.throws(() => Pairing.completePairing(a, pending, Pairing.acceptInvite(b, code, { now: NOW }).response, { now: NOW }), { code: 'used' });

  // החלפת המפתח בתשובה אחרי החתימה
  const inv2 = Pairing.createInvite(a, { now: NOW });
  const r2 = Pairing.acceptInvite(b, inv2.code, { now: NOW }).response;
  const tampered = { ...r2, peer: { ...r2.peer, name: 'שם אחר' } };
  assert.throws(() => Pairing.completePairing(a, inv2.pending, tampered, { now: NOW }), { code: 'bad-proof' });

  assert.throws(() => Pairing.acceptInvite(a, Pairing.createInvite(a, { now: NOW }).code, { now: NOW }), { code: 'self' });
  assert.throws(() => Pairing.parseInvite('SSPAIR1.@@@', NOW), { code: 'bad-invite' });
  assert.throws(() => Pairing.parseInvite('אחר', NOW), { code: 'bad-invite' });
});

test('צימוד: מי שיירט את ההזמנה מקבל קוד אימות שונה — המשתמש יזהה את ההתחזות', () => {
  const { a, b } = pair();
  const mitm = Identity.createIdentity('מתחזה');
  const { code } = Pairing.createInvite(a, { now: NOW });
  const real = Pairing.acceptInvite(b, code, { now: NOW });
  const fake = Pairing.acceptInvite(mitm, code, { now: NOW });
  assert.notEqual(real.code, fake.code);
});

test('רשימת עמיתים: עמית מבוטל אינו מהימן; צימוד חוזר מחליף ולא משכפל', () => {
  const { pa, pb } = pair();
  let peers = Pairing.addPeer([], pb, { now: NOW });
  peers = Pairing.addPeer(peers, pa, { now: NOW });
  peers = Pairing.addPeer(peers, pb, { now: NOW + 1 });
  assert.equal(peers.length, 2);
  assert.equal(Pairing.trustedPeer(peers, pb.id).id, pb.id);
  peers = Pairing.revokePeer(peers, pb.id, { now: NOW + 2 });
  assert.equal(Pairing.trustedPeer(peers, pb.id), null);
  assert.ok(Pairing.trustedPeer(peers, pa.id));
});
