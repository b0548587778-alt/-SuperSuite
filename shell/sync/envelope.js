// מעטפת הודעה מוצפנת וחתומה בין שני עמיתים (docs/SYNC-DESIGN.md → "מעטפת הודעה").
// X25519 → HKDF-SHA-256 → AES-256-GCM; הכותרת היא AAD; חתימת Ed25519 על כל המעטפה.
// בפתיחה: מבנה → יעד ושולח → חתימה → זמן → מספר סידורי → פענוח. החתימה נבדקת לפני כל פענוח.
const crypto = require('crypto');
const { privateKey, publicKey } = require('./identity');

const VERSION = 1;
const INFO = Buffer.from('SuperSuite-sync v1 envelope');
const MAX_SKEW_MS = 10 * 60 * 1000;
// חייב להיכנס במסגרת של transport.js (MAX_FRAME, 9MB) אחרי base64url (×4/3): 8MB היו 10.7MB, והגבול בפועל
// היה כ-6.7MB (בדיקת קוד 23.10.2026). 6MB ← כ-8MB במסגרת
const MAX_BODY = 6 * 1024 * 1024;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// מפתח משותף לזוג. ה-salt הוא שני המזהים ממוינים — אותו מפתח בשני הצדדים, ושונה לכל זוג.
// info מפריד בין שימושים (מעטפה / גילוי ברשת) — מפתח לכל מטרה (NIST SP 800-57)
function deriveKey(identity, peer, info = INFO) {
  const shared = crypto.diffieHellman({ privateKey: privateKey(identity.dh), publicKey: publicKey(peer.dh) });
  // נקודה מסדר נמוך מחזירה סוד אפסים (RFC 7748 §6.1) — לא מקבלים אותה
  if (shared.every(b => b === 0)) throw fail('bad-key', 'מפתח העמית אינו בטוח');
  const salt = Buffer.from([identity.id, peer.id].sort().join('|'));
  return Buffer.from(crypto.hkdfSync('sha256', shared, salt, info, 32));
}

// סדר שדות קבוע — אותו מחרוזת בחתימה ובאימות, ובכל מימוש (גם WebCrypto)
const headerBytes = (h) => Buffer.from(JSON.stringify([h.v, h.from, h.to, h.seq, h.ts]));
const signedBytes = (env) => Buffer.concat([headerBytes(env), Buffer.from('|' + env.nonce + '|' + env.ct + '|' + env.tag)]);

function seal({ identity, peer, seq, body, now = Date.now() }) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw fail('bad-seq', 'מספר סידורי לא תקין');
  const plain = Buffer.from(JSON.stringify(body));
  if (plain.length > MAX_BODY) throw fail('too-large', 'ההודעה גדולה מדי');
  const env = { v: VERSION, from: identity.id, to: peer.id, seq, ts: now };
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(identity, peer), nonce);
  cipher.setAAD(headerBytes(env));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  env.nonce = nonce.toString('base64url');
  env.ct = ct.toString('base64url');
  env.tag = cipher.getAuthTag().toString('base64url');
  env.sig = crypto.sign(null, signedBytes(env), privateKey(identity.sign)).toString('base64url');
  return env;
}

// lastSeq: המספר הסידורי האחרון שהתקבל מהעמית הזה (נשמר אצל המקבל). מחזיר { seq, ts, body }
function open({ identity, peer, env, lastSeq = 0, now = Date.now() }) {
  const str = (x) => typeof x === 'string' && x.length > 0;
  if (!env || typeof env !== 'object' || env.v !== VERSION || !str(env.from) || !str(env.to)
    || !Number.isSafeInteger(env.seq) || env.seq < 1 || !Number.isSafeInteger(env.ts)
    || !str(env.nonce) || typeof env.ct !== 'string' || !str(env.tag) || !str(env.sig)) {
    throw fail('malformed', 'הודעה לא תקינה');
  }
  if (env.to !== identity.id) throw fail('wrong-recipient', 'ההודעה לא נועדה למכשיר זה');
  if (env.from !== peer.id) throw fail('wrong-sender', 'השולח אינו העמית הצפוי');
  const sig = Buffer.from(env.sig, 'base64url');
  if (sig.length !== 64 || !crypto.verify(null, signedBytes(env), publicKey(peer.sign), sig)) {
    throw fail('bad-signature', 'חתימת ההודעה אינה תקפה');
  }
  if (Math.abs(now - env.ts) > MAX_SKEW_MS) throw fail('stale', 'ההודעה ישנה מדי או שהשעון במכשירים אינו מכוון');
  if (env.seq <= lastSeq) throw fail('replay', 'הודעה שכבר התקבלה (שידור חוזר)');
  const nonce = Buffer.from(env.nonce, 'base64url');
  const tag = Buffer.from(env.tag, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16) throw fail('malformed', 'הודעה לא תקינה');
  let plain;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(identity, peer), nonce);
    decipher.setAAD(headerBytes(env));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64url')), decipher.final()]);
  } catch {
    throw fail('decrypt', 'לא ניתן לפענח את ההודעה');
  }
  return { seq: env.seq, ts: env.ts, body: JSON.parse(plain.toString('utf8')) };
}

module.exports = { seal, open, deriveKey, VERSION, MAX_SKEW_MS, MAX_BODY };
