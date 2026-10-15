// אימות צולב: המימוש הטהור (crypto-lite, רץ באנדרואיד) מול OpenSSL (node:crypto) על קלטים אקראיים רבים.
// כל סטייה — גם בביט אחד — נכשלת כאן. בנוסף לוקטורי ה-RFC שב-licensing-chat.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const nc = require('crypto');
const C = require('../shell/licensing/crypto-lite');
const X = require('../shell/licensing/crypto');
const L = require('../shell/licensing/license');
const M = require('../shell/licensing/messages');

const N = Number(process.env.SS_CRYPTO_ROUNDS || 300);
const rnd = (n) => new Uint8Array(nc.randomBytes(n));
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

test('SHA-256 / SHA-512 / HMAC / HKDF: זהים ל-OpenSSL בכל אורך (כולל גבולות בלוק)', () => {
  for (let len = 0; len <= 300; len++) {
    const m = rnd(len);
    assert.ok(same(C.sha256(m), nc.createHash('sha256').update(m).digest()), 'sha256 ' + len);
    assert.ok(same(C.sha512(m), nc.createHash('sha512').update(m).digest()), 'sha512 ' + len);
    const k = rnd(len % 130);
    assert.ok(same(C.hmacSha256(k, m), nc.createHmac('sha256', k).update(m).digest()), 'hmac ' + len);
  }
  for (let i = 0; i < 50; i++) {
    const ikm = rnd(1 + i), salt = rnd(i % 40), info = rnd(i % 20), len = 1 + (i * 7) % 200;
    assert.ok(same(C.hkdfSha256(ikm, salt, info, len), Buffer.from(nc.hkdfSync('sha256', ikm, salt.length ? salt : new Uint8Array(32), info, len))), 'hkdf ' + i);
  }
});

test(`Ed25519: מפתח, חתימה ואימות זהים ל-OpenSSL (${N} סבבים)`, () => {
  for (let i = 0; i < N; i++) {
    const seed = rnd(32), msg = rnd(i % 200);
    const key = nc.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: C.b64uEncode(seed), x: C.b64uEncode(C.ed25519.getPublicKey(seed)) }, format: 'jwk' });
    const pubX = key.export({ format: 'jwk' }).x;
    assert.equal(C.b64uEncode(C.ed25519.getPublicKey(seed)), pubX, 'מפתח ציבורי ' + i);
    const sigN = nc.sign(null, msg, key);
    assert.ok(same(C.ed25519.sign(msg, seed), sigN), 'חתימה דטרמיניסטית זהה ' + i);
    assert.equal(C.ed25519.verify(new Uint8Array(sigN), msg, C.b64uDecode(pubX)), true);
    // חתימה משובשת: שני המימושים דוחים
    const bad = new Uint8Array(sigN); bad[i % 64] ^= 1 << (i % 8);
    const pub = nc.createPublicKey(key);
    assert.equal(C.ed25519.verify(bad, msg, C.b64uDecode(pubX)), nc.verify(null, msg, pub, bad), 'שיבוש ' + i);
  }
});

test(`X25519: סוד משותף זהה ל-OpenSSL, כולל המרה ממפתחות Ed25519 (${N} סבבים)`, () => {
  for (let i = 0; i < N; i++) {
    const a = rnd(32), b = rnd(32);
    const B = C.x25519.scalarMult(b, C.x25519.BASE);
    X._forceLite(false);
    const n = X.x25519.scalarMult(a, B);
    X._forceLite(true);
    const l = X.x25519.scalarMult(a, B);
    X._forceLite(false);
    assert.ok(same(n, l), 'x25519 ' + i);
    // ההמרה Ed25519 ← X25519: שני הצדדים מגיעים לאותו סוד
    const e1 = rnd(32), e2 = rnd(32);
    const s1 = X.x25519.scalarMult(X.x25519.fromEdSeed(e1), C.x25519.fromEdPublic(C.ed25519.getPublicKey(e2)));
    const s2 = X.x25519.scalarMult(X.x25519.fromEdSeed(e2), C.x25519.fromEdPublic(C.ed25519.getPublicKey(e1)));
    assert.ok(same(s1, s2), 'המרה ' + i);
  }
  X._forceLite(false);
  assert.throws(() => X.x25519.scalarMult(rnd(32), new Uint8Array(32)), /לא תקין/, 'נקודה בעלת סדר נמוך (OpenSSL)');
  X._forceLite(true);
  assert.throws(() => X.x25519.scalarMult(rnd(32), new Uint8Array(32)), /לא תקין/, 'נקודה בעלת סדר נמוך (JS)');
  X._forceLite(false);
});

test('הודעה שהוצפנה בשולחן העבודה (OpenSSL) נפתחת באנדרואיד (JS) ולהפך', () => {
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const toB = [{ id: a.keyId, name: 'א', publicKey: a.publicJwk }];
  const toA = [{ id: b.keyId, name: 'ב', publicKey: b.publicJwk }];
  for (const [sealLite, openLite] of [[false, true], [true, false], [true, true], [false, false]]) {
    X._forceLite(sealLite); L._forceLite(sealLite);
    const { envelope } = M.seal(a.privateJwk, b.publicJwk, { text: 'בדיקה הדדית', sentAt: 1 });
    X._forceLite(openLite); L._forceLite(openLite);
    assert.equal(M.open(b.privateJwk, envelope, toB).text, 'בדיקה הדדית', `seal=${sealLite} open=${openLite}`);
    const r = M.seal(b.privateJwk, a.publicJwk, { text: 'תשובה', sentAt: 2 });
    assert.equal(M.open(a.privateJwk, r.envelope, toA).text, 'תשובה');
  }
  X._forceLite(false); L._forceLite(false);
});

test('בשולחן העבודה משתמשים ב-OpenSSL', () => {
  assert.equal(X.NATIVE.x25519, true);
  assert.equal(X.NATIVE.hkdf, true);
  assert.equal(X.usingNative(), true);
});
