// שכבת הקריפטוגרפיה של הרישוי וההודעות — נקודת כניסה אחת.
// בשולחן העבודה: node:crypto (OpenSSL — מימוש שעבר ביקורות אבטחה בעולם) לכל הפעולות.
// באנדרואיד: crypto-lite.js (JS טהור) — ה-shim אינו כולל עקומות; המימוש נבדק מול וקטורי RFC
// ומול OpenSSL בבדיקות (tests/licensing-crypto.test.js), כך שכל סטייה נתפסת.
const nodeCrypto = require('crypto');
const C = require('./crypto-lite');

const HAS = (fn) => !!(nodeCrypto && typeof nodeCrypto[fn] === 'function');
const NATIVE = {
  ed25519: HAS('sign') && HAS('createPrivateKey'),
  x25519: HAS('diffieHellman') && HAS('createPrivateKey'),
  hash: HAS('createHash') && HAS('createHmac'),
  hkdf: HAS('hkdfSync'),
};
let forceLite = false;
const native = (k) => NATIVE[k] && !forceLite;

// עטיפות DER למפתחות X25519 גולמיים (RFC 8410)
const X_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const X_SPKI = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);
const u8 = (b) => new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);

function sha256(bytes) { return native('hash') ? u8(nodeCrypto.createHash('sha256').update(bytes).digest()) : C.sha256(bytes); }
function sha512(bytes) { return native('hash') ? u8(nodeCrypto.createHash('sha512').update(bytes).digest()) : C.sha512(bytes); }
function hmacSha256(key, msg) { return native('hash') ? u8(nodeCrypto.createHmac('sha256', key).update(msg).digest()) : C.hmacSha256(key, msg); }
function hkdfSha256(ikm, salt, info, length = 32) {
  if (native('hkdf')) return u8(Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt && salt.length ? salt : new Uint8Array(32), info, length)));
  return C.hkdfSha256(ikm, salt, info, length);
}

// X25519: סוד משותף. נקודה בעלת סדר נמוך (תוצאה אפס) — נדחית בשני המימושים
function x25519(scalar, u) {
  if (!native('x25519')) return C.x25519.scalarMult(scalar, u);
  let out;
  try {
    const privateKey = nodeCrypto.createPrivateKey({ key: Buffer.concat([X_PKCS8, scalar]), format: 'der', type: 'pkcs8' });
    const publicKey = nodeCrypto.createPublicKey({ key: Buffer.concat([X_SPKI, u]), format: 'der', type: 'spki' });
    out = u8(nodeCrypto.diffieHellman({ privateKey, publicKey }));
  } catch { throw new Error('מפתח לא תקין'); }
  if (out.every(b => b === 0)) throw new Error('מפתח לא תקין');
  return out;
}

module.exports = {
  NATIVE, _forceLite: (v) => { forceLite = !!v; }, usingNative: () => !forceLite && NATIVE.x25519,
  sha256, sha512, hmacSha256, hkdfSha256,
  x25519: { scalarMult: x25519, BASE: C.x25519.BASE, fromEdPublic: C.x25519.fromEdPublic, fromEdSeed: (seed) => sha512(seed).subarray(0, 32) },
  utf8: C.utf8, concat: C.concat, b64uEncode: C.b64uEncode, b64uDecode: C.b64uDecode,
};
