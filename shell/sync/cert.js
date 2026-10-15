// תעודת X.509 בחתימה עצמית (RFC 5280) למפתח ה-TLS של המכשיר — בלי ספריות חיצוניות.
// התעודה היא רק "עטיפה" שפרוטוקול TLS דורש: האמון לא נשען עליה (אין רשות אישורים), אלא על
// הצמדת המפתח הציבורי שהתקבל בצימוד (pinning). לכן תוקף ושם בתעודה אינם משמשים לאימות.
const crypto = require('crypto');

// ── קידוד DER מינימלי ──
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, body) => tlv(0xa0 + n, body);

function oid(str) {
  const parts = str.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk = [p & 0x7f];
    for (let v = p >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function integer(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bitString = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octets = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));

// UTCTime עד 2049, GeneralizedTime מ-2050 (RFC 5280 §4.1.2.5)
function time(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const y = d.getUTCFullYear();
  const rest = p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  return y < 2050 ? tlv(0x17, Buffer.from(p(y % 100) + rest)) : tlv(0x18, Buffer.from(p(y, 4) + rest));
}

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_CN = '2.5.4.3';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';

// tlsJwk: מפתח פרטי ECDSA P-256 (identity.tls). מחזיר { cert, key } ב-PEM, מוכנים ל-tls
function selfSignedCert(tlsJwk, { commonName, now = new Date() } = {}) {
  const priv = crypto.createPrivateKey({ key: tlsJwk, format: 'jwk' });
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const sigAlg = seq(oid(OID_ECDSA_SHA256));
  const name = seq(set(seq(oid(OID_CN), utf8(String(commonName || 'SuperSuite').slice(0, 64)))));
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(Date.UTC(9999, 11, 31, 23, 59, 59)); // "ללא תוקף" (RFC 5280 §4.1.2.5)
  const extensions = ctx(3, seq(
    seq(oid(OID_BASIC_CONSTRAINTS), bool(true), octets(seq())),                  // לא רשות אישורים
    seq(oid(OID_KEY_USAGE), bool(true), octets(tlv(0x03, Buffer.from([0x07, 0x80])))), // digitalSignature בלבד
  ));
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))), // v3
    integer(crypto.randomBytes(16)),
    sigAlg, name, seq(time(notBefore), time(notAfter)), name,
    spki, extensions,
  );
  const sig = crypto.sign('sha256', tbs, priv); // ECDSA בקידוד DER — מה ש-X.509 דורש
  const der = seq(tbs, sigAlg, bitString(sig));
  const pem = (label, b) => `-----BEGIN ${label}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { cert: pem('CERTIFICATE', der), key: priv.export({ type: 'pkcs8', format: 'pem' }) };
}

// המפתח הציבורי בתעודה שהעמית הציג ב-TLS (getPeerCertificate().raw) — כ-JWK להשוואה מול הצמדה
function certPublicJwk(rawDer) {
  const { kty, crv, x, y } = new crypto.X509Certificate(rawDer).publicKey.export({ format: 'jwk' });
  return { kty, crv, x, y };
}

// השוואה בזמן קבוע של מפתח שהוצג מול המפתח המוצמד
function sameTlsKey(a, b) {
  if (!a || !b || a.kty !== 'EC' || b.kty !== 'EC' || a.crv !== 'P-256' || b.crv !== 'P-256') return false;
  const A = Buffer.from(a.x + '.' + a.y);
  const B = Buffer.from(b.x + '.' + b.y);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

module.exports = { selfSignedCert, certPublicJwk, sameTlsKey };
