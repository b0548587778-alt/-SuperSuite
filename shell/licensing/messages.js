// הודעות בין המערכות לאורך העץ (מנהל-העל ← לקוחות ← מערכות בת), מוצפנות מקצה לקצה.
// השרת רואה רק מוען, נמען וטקסט מוצפן. ההצפנה: X25519 (מפתחות המערכת, מומרים מ-Ed25519) + HKDF-SHA256 + AES-256-GCM,
// וכל הודעה חתומה ב-Ed25519 של השולח — כך שאי אפשר לזייף שולח גם עם גישה לשרת.
// מי מדבר עם מי: רק הורה↔ילד ישיר, ומנהל-העל עם כולם. הנמענים נגזרים מהרישיונות החתומים, לא ממה שהשרת אומר.
const crypto = require('crypto');
const L = require('./license');
// עקומות, HKDF ו-SHA דרך שכבת הקריפטוגרפיה: OpenSSL בשולחן העבודה, JS טהור באנדרואיד
const C = require('./crypto');

const MAX_TEXT = 4000;
const MAX_SUBJECT = 120;
// קובץ מצורף: מוגבל כך שההודעה המוצפנת תיכנס בתקרה של שרת הממסר (256KB להודעה)
const MAX_ATTACHMENT = 110 * 1024;
const ATTACHMENT_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
const MID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const KINDS = ['text', 'receipt', 'edit', 'delete', 'profile'];
const INFO = C.utf8('supersuite-message-v1');
const INFO2 = C.utf8('supersuite-message-v2');

function randomBytes(n) {
  const b = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b.set(crypto.randomBytes(n));
  return b;
}

// AES-256-GCM דרך node:crypto (בשולחן העבודה) או ה-shim של אנדרואיד — אותו ממשק
function aesGcm(encrypt, key, iv, data, tag) {
  if (encrypt) {
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const out = C.concat(new Uint8Array(c.update(data)), new Uint8Array(c.final()));
    return { ct: out, tag: new Uint8Array(c.getAuthTag()) };
  }
  // תג באורך מלא בלבד: תג מקוצר (4 בתים) מהשרת היה מתקבל ומקל על זיוף
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return C.concat(new Uint8Array(d.update(data)), new Uint8Array(d.final()));
}

// גרסה 2: שלושה חישובי Diffie-Hellman (כמו X3DH):
//   DH1 = חד-פעמי(שולח) × קבוע(נמען)     — סודיות קדימה מצד השולח
//   DH2 = חד-פעמי(שולח) × זמני(נמען)      — סודיות קדימה מצד הנמען (המפתח הזמני נמחק אחרי 30 יום)
//   DH3 = קבוע(שולח) × קבוע(נמען)         — קשירה לזהות השולח
// בלי מפתח זמני (הנמען עוד לא פרסם) — DH2 מושמט, והמעטפה מסומנת בהתאם
function sharedKeyV2({ eph, recipientStaticX, recipientPrekeyX, senderStaticSeed, senderStaticPubX, recipientStaticSeed, ephPub, recipientPrekeyPriv }, salt, info = INFO2) {
  let dh1, dh2 = new Uint8Array(0), dh3 = new Uint8Array(0);
  if (eph) {
    dh1 = C.x25519.scalarMult(eph, recipientStaticX);
    if (recipientPrekeyX) dh2 = C.x25519.scalarMult(eph, recipientPrekeyX);
    if (senderStaticSeed) dh3 = C.x25519.scalarMult(C.x25519.fromEdSeed(senderStaticSeed), recipientStaticX);
  } else {
    const mine = C.x25519.fromEdSeed(recipientStaticSeed);
    dh1 = C.x25519.scalarMult(mine, ephPub);
    if (recipientPrekeyPriv) dh2 = C.x25519.scalarMult(recipientPrekeyPriv, ephPub);
    if (senderStaticPubX) dh3 = C.x25519.scalarMult(mine, senderStaticPubX);
  }
  return C.hkdfSha256(C.concat(dh1, dh2, dh3), salt, info, 32);
}

function sharedKey(myPrivateJwk, peerPublicJwk, salt) {
  const secret = C.x25519.scalarMult(C.x25519.fromEdSeed(C.b64uDecode(myPrivateJwk.d)), C.x25519.fromEdPublic(C.b64uDecode(peerPublicJwk.x)));
  return C.hkdfSha256(secret, salt, INFO, 32);
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

// קובץ מצורף: { name, type, data (base64) } — סוג מרשימה סגורה, שם בלי נתיב, גודל מוגבל
function cleanAttachment(att) {
  if (att == null) return null;
  const type = String(att.type || '');
  if (!ATTACHMENT_TYPES[type]) throw new Error('סוג הקובץ אינו נתמך (תמונה, PDF, טקסט, CSV, Excel או Word)');
  const data = String(att.data || '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || !data) throw new Error('הקובץ פגום');
  const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (size > MAX_ATTACHMENT) throw new Error('הקובץ גדול מדי — עד ' + Math.floor(MAX_ATTACHMENT / 1024) + 'KB');
  let name = cleanText(att.name, 100).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '');
  if (!name) name = 'קובץ';
  if (!name.toLowerCase().endsWith('.' + ATTACHMENT_TYPES[type])) name += '.' + ATTACHMENT_TYPES[type];
  return { name, type, size, data };
}
const cleanMid = (v) => (MID_RE.test(String(v || '')) ? String(v) : null);
function cleanProfileFields(p) {
  const v = p && typeof p === 'object' ? p : {};
  const out = {};
  for (const [k, max] of [['name', 80], ['about', 500], ['address', 200], ['phone', 30], ['email', 120], ['website', 200]]) out[k] = cleanText(v[k], max);
  return out;
}

// הצפנה וחתימה של הודעה לנמען. from/to = מזהי מפתח
// kind: 'text' (הודעה; אופציונלי: replyTo, forwarded, auto, bc, att), 'receipt' (אישור קריאה של mids),
//       'edit' (target + text — עריכת הודעה שלי), 'delete' (target — מחיקה אצל כולם), 'profile' (פרופיל עסקי)
// prekey: { id, pub } — המפתח הזמני המאומת של הנמען (verifyBundle). בלי — סודיות קדימה מצד השולח בלבד
function seal(senderJwk, recipientPub, { subject, text, sentAt, mid, kind = 'text', mids, target, replyTo, forwarded, auto, bc, att, profile }, { prekey } = {}) {
  const body = { v: 1, kind, mid: mid || C.b64uEncode(randomBytes(12)), from: L.keyId(senderJwk), to: L.keyId(recipientPub), sentAt,
    subject: cleanText(subject, MAX_SUBJECT), text: cleanText(text, MAX_TEXT) };
  if (kind === 'receipt') body.mids = (Array.isArray(mids) ? mids : []).map(String).slice(0, 500);
  else if (kind === 'edit' || kind === 'delete') {
    body.target = cleanMid(target);
    if (!body.target) throw new Error('הודעה לא תקינה');
    if (kind === 'edit' && !body.text) throw new Error('ההודעה ריקה');
  } else if (kind === 'profile') body.profile = cleanProfileFields(profile);
  else if (kind === 'text') {
    const a = cleanAttachment(att);
    if (a) body.att = a;
    if (!body.text && !a) throw new Error('ההודעה ריקה');
    if (cleanMid(replyTo)) body.replyTo = String(replyTo);
    if (forwarded) body.forwarded = true;
    if (auto === 'greeting' || auto === 'away') body.auto = auto;
    if (bc) body.bc = true;
  } else throw new Error('סוג הודעה לא מוכר');
  const salt = randomBytes(16), iv = randomBytes(12), eph = randomBytes(32);
  const ephPub = C.x25519.scalarMult(eph, C.x25519.BASE);
  const plain = C.utf8(JSON.stringify({ ...body, sig: L.signObject(body, senderJwk) }));
  const key = sharedKeyV2({ eph, recipientStaticX: C.x25519.fromEdPublic(C.b64uDecode(recipientPub.x)),
    recipientPrekeyX: prekey ? C.b64uDecode(prekey.pub) : null, senderStaticSeed: C.b64uDecode(senderJwk.d) }, salt);
  eph.fill(0); // המפתח החד-פעמי לא נשמר
  const { ct, tag } = aesGcm(true, key, iv, plain);
  const envelope = () => JSON.stringify({ type: 'supersuite-message', v: 2, from: body.from, to: body.to, eph: C.b64uEncode(ephPub),
    pk: prekey ? prekey.id : null, salt: C.b64uEncode(salt), iv: C.b64uEncode(iv), ct: C.b64uEncode(ct), tag: C.b64uEncode(tag) });
  return { mid: body.mid, envelope: envelope(), forwardSecret: !!prekey };
}

// פתיחה: מפענחים במפתח שלנו ומאמתים את חתימת השולח מול המפתח הציבורי הידוע שלו (מהרישיונות)
// prekeyPriv(id) → המפתח הפרטי הזמני (Uint8Array) או null אם נמחק
function open(myJwk, envelopeText, contacts, { prekeyPriv } = {}) {
  let env;
  try { env = JSON.parse(envelopeText); } catch { throw new Error('הודעה פגומה'); }
  if (!env || env.type !== 'supersuite-message' || env.to !== L.keyId(myJwk)) throw new Error('ההודעה אינה מיועדת למערכת הזו');
  const peer = contacts.find(c => c.id === env.from);
  if (!peer) throw new Error('הודעה ממערכת שאינה מוכרת — נדחתה');
  let plain;
  try {
    let key;
    if (env.v === 2) {
      let pkPriv = null;
      if (env.pk) {
        pkPriv = prekeyPriv ? prekeyPriv(env.pk) : null;
        if (!pkPriv) throw new Error('expired');
      }
      key = sharedKeyV2({ ephPub: C.b64uDecode(env.eph), recipientStaticSeed: C.b64uDecode(myJwk.d), recipientPrekeyPriv: pkPriv,
        senderStaticPubX: C.x25519.fromEdPublic(C.b64uDecode(peer.publicKey.x)) }, C.b64uDecode(env.salt));
    } else {
      key = sharedKey(myJwk, peer.publicKey, C.b64uDecode(env.salt));
    }
    plain = aesGcm(false, key, C.b64uDecode(env.iv), C.b64uDecode(env.ct), C.b64uDecode(env.tag));
  } catch (e) {
    // קובץ המפתחות הזמניים לא נקרא (תפוס לרגע) — לא "ישנה מדי": ההודעה נשארת בשרת (sync.js → keepOnServer, f84)
    if (e && e.code === 'prekeys-unavailable') throw e;
    throw new Error(e && e.message === 'expired' ? 'ההודעה ישנה מדי — המפתח הזמני שלה כבר נמחק' : 'לא ניתן לפענח את ההודעה');
  }
  let msg;
  try { msg = JSON.parse(new TextDecoder().decode(plain)); } catch { throw new Error('הודעה פגומה'); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('הודעה פגומה');
  const { sig, ...body } = msg;
  if (body.from !== env.from || body.to !== env.to || !L.verifyObject(body, sig, peer.publicKey)) throw new Error('חתימת ההודעה אינה תקינה');
  // גם השולח (מוכר וחתום) עלול לשלוח תוכן חריג — הכול נבדק שוב כאן, כמו ב-seal (ממצא 49:
  // text שהוא מספר הפיל את מסך ההודעות והחיפוש לצמיתות)
  const kind = body.kind == null ? 'text' : body.kind;
  const mid = cleanMid(body.mid);
  if (!KINDS.includes(kind) || !mid || typeof body.sentAt !== 'number' || !Number.isFinite(body.sentAt)) throw new Error('הודעה לא תקינה');
  const out = { kind, mid, mids: kind === 'receipt' && Array.isArray(body.mids) ? body.mids.slice(0, 500).map(cleanMid).filter(Boolean) : [],
    from: body.from, fromName: peer.name, subject: cleanText(body.subject, MAX_SUBJECT), text: cleanText(body.text, MAX_TEXT), sentAt: body.sentAt };
  if (out.kind === 'edit' || out.kind === 'delete') out.target = cleanMid(body.target);
  if (out.kind === 'profile') out.profile = cleanProfileFields(body.profile);
  if (out.kind === 'text') {
    if (body.att) { try { out.att = cleanAttachment(body.att); } catch { out.att = null; } }
    if (cleanMid(body.replyTo)) out.replyTo = body.replyTo;
    if (body.forwarded) out.forwarded = true;
    if (body.auto === 'greeting' || body.auto === 'away') out.auto = body.auto;
    if (body.bc) out.bc = true;
  }
  return out;
}

// אנשי הקשר של מערכת לפי הרישיונות: ההורה הישיר, הילדים הישירים, ומנהל-העל
function contactsOf({ chain, children = [], rootKeys = [], ownerName = 'מנהל-העל' }) {
  const out = [];
  for (const k of rootKeys) out.push({ id: L.keyId(k), name: ownerName, publicKey: L.publicOf(k), role: 'owner' });
  if (Array.isArray(chain) && chain.length > 1) {
    const parent = chain[chain.length - 2].payload;
    out.push({ id: parent.id, name: parent.name, publicKey: parent.publicKey, role: 'parent' });
  }
  for (const c of children) out.push({ id: c.id, name: c.name, publicKey: c.publicKey, role: 'child' });
  return out;
}

// מעטפה מוצפנת לנתונים (לא הודעת צ'אט) — אותה הצפנה כמו seal (X25519 + HKDF + AES-256-GCM), בלי מפתח זמני ובלי
// תקרת טקסט. purpose נכנס ל-HKDF (מעטפה של מטרה אחת לא נפתחת כמטרה אחרת). senderJwk — אופציונלי: עם מפתח השולח
// המעטפה קשורה לזהותו (DH3); בלעדיו — שולח אנונימי (השרת מצפין חבילה ישנה, סקירה 2.11.2026 f89).
// האמינות של התוכן — מהחתימה שבתוכו, לא מהמעטפה
const SEALED_TYPE = 'supersuite-sealed';
const sealedInfo = (purpose) => C.utf8('supersuite-sealed-v1:' + String(purpose));
function sealData(senderJwk, recipientPub, text, purpose) {
  const salt = randomBytes(16), iv = randomBytes(12), eph = randomBytes(32);
  const ephPub = C.x25519.scalarMult(eph, C.x25519.BASE);
  const key = sharedKeyV2({ eph, recipientStaticX: C.x25519.fromEdPublic(C.b64uDecode(recipientPub.x)), recipientPrekeyX: null,
    senderStaticSeed: senderJwk ? C.b64uDecode(senderJwk.d) : null }, salt, sealedInfo(purpose));
  eph.fill(0);
  const { ct, tag } = aesGcm(true, key, iv, C.utf8(String(text)));
  return JSON.stringify({ type: SEALED_TYPE, v: 1, purpose: String(purpose), from: senderJwk ? L.keyId(senderJwk) : null, to: L.keyId(recipientPub),
    eph: C.b64uEncode(ephPub), salt: C.b64uEncode(salt), iv: C.b64uEncode(iv), ct: C.b64uEncode(ct), tag: C.b64uEncode(tag) });
}
// פתיחה במפתח הנמען. senderPub — המפתח הציבורי של השולח (למעטפה עם from); בלי from — אנונימית
function openData(myJwk, envelopeText, purpose, { senderPub = null } = {}) {
  let env;
  try { env = typeof envelopeText === 'string' ? JSON.parse(envelopeText) : envelopeText; } catch { throw new Error('המעטפה פגומה'); }
  if (!env || env.type !== SEALED_TYPE || env.purpose !== String(purpose) || env.to !== L.keyId(myJwk)) throw new Error('המעטפה אינה מיועדת למערכת הזו');
  if (env.from != null && (!senderPub || L.keyId(senderPub) !== env.from)) throw new Error('השולח של המעטפה אינו תואם');
  try {
    const key = sharedKeyV2({ ephPub: C.b64uDecode(env.eph), recipientStaticSeed: C.b64uDecode(myJwk.d), recipientPrekeyPriv: null,
      senderStaticPubX: env.from != null ? C.x25519.fromEdPublic(C.b64uDecode(senderPub.x)) : null }, C.b64uDecode(env.salt), sealedInfo(purpose));
    return new TextDecoder().decode(aesGcm(false, key, C.b64uDecode(env.iv), C.b64uDecode(env.ct), C.b64uDecode(env.tag)));
  } catch { throw new Error('לא ניתן לפענח את המעטפה'); }
}

module.exports = { seal, open, sealData, openData, SEALED_TYPE, contactsOf, cleanAttachment, cleanText, MAX_TEXT, MAX_SUBJECT, MAX_ATTACHMENT, ATTACHMENT_TYPES };
