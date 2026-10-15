// צימוד מכשירים (docs/SYNC-DESIGN.md). זרימה:
// 1. מכשיר A יוצר הזמנה: קוד (להעתקה / QR) עם המפתחות הציבוריים שלו וסוד חד-פעמי, תקף 10 דקות.
// 2. מכשיר B מקבל את הקוד ומחזיר תשובה חתומה, עם הוכחה שהוא מכיר את הסוד (HMAC).
// 3. בשני המכשירים מוצג קוד אימות בן 6 ספרות. המשתמש משווה בעיניים, ורק אז מאשר.
//    אם מישהו יירט את ההזמנה והתחזה — הקודים לא יתאימו (כמו בצימוד Bluetooth ובאימות של Signal).
const crypto = require('crypto');
const { publicInfo, validatePublicInfo, privateKey, publicKey } = require('./identity');

const INVITE_TTL_MS = 10 * 60 * 1000;
const PREFIX = 'SSPAIR1.';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// הזמנה: הקוד מיועד למכשיר השני; pending (כולל הסוד) נשאר רק במכשיר המזמין
function createInvite(identity, { now = Date.now(), endpoint = null } = {}) {
  const secret = crypto.randomBytes(32).toString('base64url');
  const invite = { v: 1, peer: publicInfo(identity), secret, exp: now + INVITE_TTL_MS, endpoint };
  const code = PREFIX + Buffer.from(JSON.stringify(invite)).toString('base64url');
  return { code, pending: { secret, exp: invite.exp, used: false } };
}

function parseInvite(code, now = Date.now()) {
  if (typeof code !== 'string' || !code.startsWith(PREFIX) || code.length > 4096) throw fail('bad-invite', 'קוד הצימוד אינו תקין');
  let invite;
  try { invite = JSON.parse(Buffer.from(code.slice(PREFIX.length), 'base64url').toString('utf8')); }
  catch { throw fail('bad-invite', 'קוד הצימוד אינו תקין'); }
  if (!invite || invite.v !== 1 || typeof invite.secret !== 'string' || !Number.isSafeInteger(invite.exp)) {
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

// קוד אימות: נגזר ממפתחות החתימה וה-TLS של שני המכשירים ומהסוד, בסדר קבוע — זהה בשני המכשירים.
// מפתח ה-TLS נכלל: מי שהחליף רק אותו בהזמנה (כדי לשבת באמצע חיבור הצימוד) ייחשף בקוד שונה
function verificationCode(a, b, secret) {
  const keys = [a, b].map(k => [k.sign.x, k.tls.x, k.tls.y].join(',')).sort().join('|');
  const h = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update('SuperSuite-sync v1 sas|' + keys).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

const responseBytes = (r) => Buffer.from(JSON.stringify(['pair-response', r.v, r.peer.id, r.peer.sign.x, r.peer.dh.x, r.peer.tls.x, r.peer.tls.y, r.peer.name, r.to, r.ts]));

// במכשיר B: קבלת ההזמנה. מחזיר את התשובה לשליחה ל-A, את פרטי A ואת קוד האימות להצגה
function acceptInvite(identity, code, { now = Date.now() } = {}) {
  const inv = parseInvite(code, now);
  if (inv.peer.id === identity.id) throw fail('self', 'לא ניתן לצמד מכשיר לעצמו');
  const response = { v: 1, peer: publicInfo(identity), to: inv.peer.id, ts: now };
  const bytes = responseBytes(response);
  response.proof = crypto.createHmac('sha256', Buffer.from(inv.secret, 'base64url')).update(bytes).digest('base64url');
  response.sig = crypto.sign(null, bytes, privateKey(identity.sign)).toString('base64url');
  return { response, peer: inv.peer, endpoint: inv.endpoint, code: verificationCode(identity, inv.peer, inv.secret) };
}

// במכשיר A: בדיקת התשובה. ההזמנה חד-פעמית — מסומנת כמשומשת גם כשהבדיקה נכשלת אחרי שהגיעה תשובה
function completePairing(identity, pending, response, { now = Date.now() } = {}) {
  if (!pending || pending.used) throw fail('used', 'קוד הצימוד כבר נוצל — צרו קוד חדש');
  if (now > pending.exp) throw fail('expired', 'קוד הצימוד פג תוקף — צרו קוד חדש');
  pending.used = true;
  if (!response || response.v !== 1 || response.to !== identity.id || typeof response.proof !== 'string' || typeof response.sig !== 'string') {
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
  const sig = Buffer.from(response.sig, 'base64url');
  if (sig.length !== 64 || !crypto.verify(null, bytes, publicKey(peer.sign), sig)) {
    throw fail('bad-signature', 'חתימת המכשיר השני אינה תקפה');
  }
  return { peer, code: verificationCode(identity, peer, pending.secret) };
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

module.exports = { createInvite, parseInvite, acceptInvite, completePairing, verificationCode, addPeer, revokePeer, trustedPeer, INVITE_TTL_MS };
