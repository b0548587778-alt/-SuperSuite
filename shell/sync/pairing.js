// צימוד מכשירים (docs/SYNC-DESIGN.md). זרימה:
// 1. מכשיר A יוצר הזמנה: קוד (להעתקה / QR) עם המפתחות הציבוריים שלו וסוד חד-פעמי, תקף 10 דקות.
// 2. מכשיר B מקבל את הקוד ומחזיר תשובה חתומה, עם הוכחה שהוא מכיר את הסוד (HMAC).
//    התשובה כוללת התחייבות (גיבוב) למספר אקראי של B. A עונה במספר אקראי משלו, ורק אז B חושף את שלו.
// 3. בשני המכשירים מוצג קוד אימות בן 6 ספרות. המשתמש משווה בעיניים, ורק אז מאשר.
//    אם מישהו יירט את ההזמנה והתחזה — הקודים לא יתאימו (כמו בצימוד Bluetooth ובאימות של Signal).
//    הקוד תלוי בשני המספרים האקראיים, ומתחזה מתחייב למפתח שלו לפני שהוא יודע מה ייצא — אין לו מה "לטחון"
//    (בדיקת קוד 22.10.2026, ממצא 1: בגרסה 1 נמצא מפתח שנותן את אותו קוד אחרי כמיליון ניסיונות)
const crypto = require('crypto');
const { publicInfo, validatePublicInfo, privateKey, publicKey } = require('./identity');

const INVITE_TTL_MS = 10 * 60 * 1000;
const PREFIX = 'SSPAIR1.';
const VERSION = 2; // 2: התחייבות בצימוד ומפתח ההצפנה בקוד האימות (ממצאים 1–2)
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 בתים

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// הזמנה: הקוד מיועד למכשיר השני; pending (כולל הסוד) נשאר רק במכשיר המזמין
function createInvite(identity, { now = Date.now(), endpoint = null } = {}) {
  const secret = crypto.randomBytes(32).toString('base64url');
  const invite = { v: VERSION, peer: publicInfo(identity), secret, exp: now + INVITE_TTL_MS, endpoint };
  const code = PREFIX + Buffer.from(JSON.stringify(invite)).toString('base64url');
  return { code, pending: { secret, exp: invite.exp, used: false } };
}

function parseInvite(code, now = Date.now()) {
  if (typeof code !== 'string' || !code.startsWith(PREFIX) || code.length > 4096) throw fail('bad-invite', 'קוד הצימוד אינו תקין');
  let invite;
  try { invite = JSON.parse(Buffer.from(code.slice(PREFIX.length), 'base64url').toString('utf8')); }
  catch { throw fail('bad-invite', 'קוד הצימוד אינו תקין'); }
  if (invite && invite.v === 1) throw fail('old-version', 'קוד הצימוד נוצר בגרסה ישנה של התוכנה — עדכנו את שני המכשירים וצרו קוד חדש');
  if (!invite || invite.v !== VERSION || typeof invite.secret !== 'string' || !Number.isSafeInteger(invite.exp)) {
    throw fail('bad-invite', 'קוד הצימוד אינו תקין');
  }
  if (now > invite.exp) throw fail('expired', 'קוד הצימוד פג תוקף — צרו קוד חדש');
  return { peer: validatePublicInfo(invite.peer), secret: invite.secret, exp: invite.exp, endpoint: validEndpoint(invite.endpoint) };
}

// כתובת המכשיר המזמין (לחיבור הצימוד ברשת). שגויה — נדחית; חסרה — null (המשתמש יזין ידנית)
function validEndpoint(ep) {
  if (ep == null) return null;
  const okHost = ep && typeof ep.host === 'string' && ep.host.length > 0 && ep.host.length <= 253 && /^[A-Za-z0-9.:%[\]-]+$/.test(ep.host);
  if (!okHost || !Number.isInteger(ep.port) || ep.port < 1 || ep.port > 65535) throw fail('bad-invite', 'כתובת המכשיר בקוד הצימוד אינה תקינה');
  return { host: ep.host, port: ep.port };
}

// קוד אימות: נגזר מכל המפתחות הציבוריים של שני המכשירים (חתימה, הצפנה ו-TLS), מהסוד ומשני המספרים
// האקראיים, בסדר קבוע — זהה בשני המכשירים. כל מפתח נכלל: מי שהחליף בהזמנה רק את מפתח ה-TLS (כדי לשבת
// באמצע חיבור הצימוד) או רק את מפתח ההצפנה (כדי לפתוח את ההודעות — ממצא 2) ייחשף בקוד שונה.
// inviterNonce — של המזמין (A), joinerNonce — של המצטרף (B)
function verificationCode(a, b, secret, inviterNonce, joinerNonce) {
  if (!NONCE_RE.test(String(inviterNonce)) || !NONCE_RE.test(String(joinerNonce))) throw fail('bad-nonce', 'תשובת הצימוד אינה תקינה');
  const keys = [a, b].map(k => [k.sign.x, k.dh.x, k.tls.x, k.tls.y].join(',')).sort().join('|');
  const h = crypto.createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update('SuperSuite-sync v2 sas|' + keys + '|' + inviterNonce + '|' + joinerNonce).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
// התחייבות למספר האקראי של המצטרף — קשורה למזהה שלו, כדי שאי אפשר יהיה להעתיק התחייבות של אחר
const commitOf = (nonce, deviceId) => crypto.createHash('sha256').update('SuperSuite-sync v2 commit|' + deviceId + '|' + nonce).digest('base64url');
const newNonce = () => crypto.randomBytes(32).toString('base64url');

const responseBytes = (r) => Buffer.from(JSON.stringify(['pair-response', r.v, r.peer.id, r.peer.sign.x, r.peer.dh.x, r.peer.tls.x, r.peer.tls.y, r.peer.name, r.to, r.ts, r.commit]));

// במכשיר B: קבלת ההזמנה. מחזיר את התשובה לשליחה ל-A ואת פרטי A. הקוד להצגה — מ-reveal(המספר של A),
// שמחזיר גם את המספר של B לחשיפה. המספר של B לא יוצא מכאן לפני שהגיע המספר של A
function acceptInvite(identity, code, { now = Date.now() } = {}) {
  const inv = parseInvite(code, now);
  if (inv.peer.id === identity.id) throw fail('self', 'לא ניתן לצמד מכשיר לעצמו');
  const nonce = newNonce();
  const response = { v: VERSION, peer: publicInfo(identity), to: inv.peer.id, ts: now, commit: commitOf(nonce, identity.id) };
  const bytes = responseBytes(response);
  response.proof = crypto.createHmac('sha256', Buffer.from(inv.secret, 'base64url')).update(bytes).digest('base64url');
  response.sig = crypto.sign(null, bytes, privateKey(identity.sign)).toString('base64url');
  const reveal = (inviterNonce) => ({ nonce, code: verificationCode(identity, inv.peer, inv.secret, inviterNonce, nonce) });
  return { response, peer: inv.peer, endpoint: inv.endpoint, reveal };
}

// במכשיר A: בדיקת התשובה. ההזמנה חד-פעמית — נשרפת אחרי הוכחה תקינה בלבד: מי שלא מחזיק בסוד (256 ביט,
// אי אפשר לנחש) לא שורף אותה (ממצא 6). מחזיר את המספר של A לשליחה, ו-finish(המספר של B) ← קוד האימות
function completePairing(identity, pending, response, { now = Date.now() } = {}) {
  if (!pending || pending.used) throw fail('used', 'קוד הצימוד כבר נוצל — צרו קוד חדש');
  if (now > pending.exp) throw fail('expired', 'קוד הצימוד פג תוקף — צרו קוד חדש');
  if (response && response.v === 1) throw fail('old-version', 'המכשיר השני משתמש בגרסה ישנה של התוכנה — עדכנו את שני המכשירים');
  if (!response || response.v !== VERSION || response.to !== identity.id || typeof response.proof !== 'string' || typeof response.sig !== 'string'
    || typeof response.commit !== 'string' || !NONCE_RE.test(response.commit)) {
    throw fail('bad-response', 'תשובת הצימוד אינה תקינה');
  }
  const peer = validatePublicInfo(response.peer);
  if (peer.id === identity.id) throw fail('self', 'לא ניתן לצמד מכשיר לעצמו');
  const bytes = responseBytes({ ...response, peer });
  const expected = crypto.createHmac('sha256', Buffer.from(pending.secret, 'base64url')).update(bytes).digest();
  const proof = Buffer.from(response.proof, 'base64url');
  if (proof.length !== expected.length || !crypto.timingSafeEqual(proof, expected)) {
    throw fail('bad-proof', 'המכשיר השני אינו מחזיק בקוד הצימוד');
  }
  pending.used = true;
  const sig = Buffer.from(response.sig, 'base64url');
  if (sig.length !== 64 || !crypto.verify(null, bytes, publicKey(peer.sign), sig)) {
    throw fail('bad-signature', 'חתימת המכשיר השני אינה תקפה');
  }
  const nonce = newNonce();
  const finish = (joinerNonce) => {
    const got = Buffer.from(commitOf(String(joinerNonce), peer.id));
    const want = Buffer.from(response.commit);
    if (!NONCE_RE.test(String(joinerNonce)) || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      throw fail('bad-commit', 'המכשיר השני לא עמד בהתחייבות שלו — ייתכן ניסיון התחזות. צרו קוד חדש');
    }
    return { code: verificationCode(identity, peer, pending.secret, nonce, joinerNonce) };
  };
  return { peer, nonce, finish };
}

// רשימת העמיתים המצומדים — מידע ציבורי בלבד. עמית נכנס לרשימה רק אחרי שהמשתמש אישר שהקודים זהים
function addPeer(peers, peer, { now = Date.now() } = {}) {
  const valid = validatePublicInfo(peer);
  const rest = peers.filter(p => p.id !== valid.id);
  return [...rest, { ...valid, pairedAt: now, revoked: false }];
}
function revokePeer(peers, id, { now = Date.now() } = {}) {
  return peers.map(p => (p.id === id ? { ...p, revoked: true, revokedAt: now } : p));
}
// עמית מבוטל לא נחשב מצומד — חיבור והודעה ממנו נדחים
function trustedPeer(peers, id) {
  return peers.find(p => p.id === id && !p.revoked) || null;
}

module.exports = { createInvite, parseInvite, acceptInvite, completePairing, verificationCode, addPeer, revokePeer, trustedPeer, INVITE_TTL_MS, VERSION };
