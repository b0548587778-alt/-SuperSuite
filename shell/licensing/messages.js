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
const INFO = C.utf8('supersuite-message-v1');

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
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return C.concat(new Uint8Array(d.update(data)), new Uint8Array(d.final()));
}

function sharedKey(myPrivateJwk, peerPublicJwk, salt) {
  const secret = C.x25519.scalarMult(C.x25519.fromEdSeed(C.b64uDecode(myPrivateJwk.d)), C.x25519.fromEdPublic(C.b64uDecode(peerPublicJwk.x)));
  return C.hkdfSha256(secret, salt, INFO, 32);
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

// הצפנה וחתימה של הודעה לנמען. from/to = מזהי מפתח
// kind: 'text' (הודעה) או 'receipt' (אישור קריאה של mids)
function seal(senderJwk, recipientPub, { subject, text, sentAt, mid, kind = 'text', mids }) {
  const body = { v: 1, kind, mid: mid || C.b64uEncode(randomBytes(12)), from: L.keyId(senderJwk), to: L.keyId(recipientPub), sentAt,
    subject: cleanText(subject, MAX_SUBJECT), text: cleanText(text, MAX_TEXT) };
  if (kind === 'receipt') body.mids = (Array.isArray(mids) ? mids : []).map(String).slice(0, 500);
  else if (kind !== 'text') throw new Error('סוג הודעה לא מוכר');
  else if (!body.text) throw new Error('ההודעה ריקה');
  const salt = randomBytes(16), iv = randomBytes(12);
  const plain = C.utf8(JSON.stringify({ ...body, sig: L.signObject(body, senderJwk) }));
  const envelope = () => JSON.stringify({ type: 'supersuite-message', v: 1, from: body.from, to: body.to,
    salt: C.b64uEncode(salt), iv: C.b64uEncode(iv), ct: C.b64uEncode(ct), tag: C.b64uEncode(tag) });
  const { ct, tag } = aesGcm(true, sharedKey(senderJwk, recipientPub, salt), iv, plain);
  return { mid: body.mid, envelope: envelope() };
}

// פתיחה: מפענחים במפתח שלנו ומאמתים את חתימת השולח מול המפתח הציבורי הידוע שלו (מהרישיונות)
function open(myJwk, envelopeText, contacts) {
  let env;
  try { env = JSON.parse(envelopeText); } catch { throw new Error('הודעה פגומה'); }
  if (!env || env.type !== 'supersuite-message' || env.to !== L.keyId(myJwk)) throw new Error('ההודעה אינה מיועדת למערכת הזו');
  const peer = contacts.find(c => c.id === env.from);
  if (!peer) throw new Error('הודעה ממערכת שאינה מוכרת — נדחתה');
  let plain;
  try {
    plain = aesGcm(false, sharedKey(myJwk, peer.publicKey, C.b64uDecode(env.salt)), C.b64uDecode(env.iv), C.b64uDecode(env.ct), C.b64uDecode(env.tag));
  } catch { throw new Error('לא ניתן לפענח את ההודעה'); }
  const msg = JSON.parse(new TextDecoder().decode(plain));
  const { sig, ...body } = msg;
  if (body.from !== env.from || body.to !== env.to || !L.verifyObject(body, sig, peer.publicKey)) throw new Error('חתימת ההודעה אינה תקינה');
  return { kind: body.kind || 'text', mid: body.mid, mids: body.mids || [], from: body.from, fromName: peer.name, subject: body.subject, text: body.text, sentAt: body.sentAt };
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

module.exports = { seal, open, contactsOf, MAX_TEXT, MAX_SUBJECT };
