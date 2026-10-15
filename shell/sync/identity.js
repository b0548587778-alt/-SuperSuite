// זהות מכשיר לסנכרון עמית-לעמית (docs/SYNC-DESIGN.md).
// לכל מכשיר שלושה זוגות מפתחות: Ed25519 לחתימה (וממנו המזהה), X25519 להסכמת מפתח, ו-ECDSA P-256
// לתעודת ה-TLS. ל-TLS מפתח נפרד: Electron בנוי על BoringSSL, שתמיכתו בתעודות Ed25519 מוגבלת,
// ו-P-256 נתמך בכל מקום (כולל אנדרואיד). המפתחות נשמרים כ-JWK
// (RFC 7517) כדי שאותו פורמט ישמש גם את אפליקציית האנדרואיד (WebCrypto).
// ללא תלות ב-Electron: safeStorage מוזרק (כמו ב-auto-backup.js).
const crypto = require('crypto');
const fs = require('fs');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

// מזהה המכשיר נגזר מהמפתח הציבורי לחתימה — אי אפשר לזייף מזהה בלי המפתח הפרטי
function deviceIdFromSignKey(signJwk) {
  if (!signJwk || signJwk.kty !== 'OKP' || signJwk.crv !== 'Ed25519' || typeof signJwk.x !== 'string') {
    throw new Error('מפתח חתימה לא תקין');
  }
  return b64u(crypto.createHash('sha256').update(Buffer.from(signJwk.x, 'base64url')).digest().subarray(0, 16));
}

function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return s || 'מכשיר';
}

function createIdentity(name) {
  const sign = crypto.generateKeyPairSync('ed25519');
  const dh = crypto.generateKeyPairSync('x25519');
  const signPriv = sign.privateKey.export({ format: 'jwk' });
  return {
    v: 1,
    id: deviceIdFromSignKey(signPriv),
    name: cleanName(name),
    sign: signPriv,
    dh: dh.privateKey.export({ format: 'jwk' }),
    tls: newTlsKey(),
  };
}

function newTlsKey() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
}

// מה שמותר לשלוח לעמית — בלי השדה d (המפתח הפרטי)
function publicInfo(identity) {
  const pub = ({ kty, crv, x }) => ({ kty, crv, x });
  const { kty, crv, x, y } = identity.tls;
  return { id: identity.id, name: identity.name, sign: pub(identity.sign), dh: pub(identity.dh), tls: { kty, crv, x, y } };
}

// בדיקת מידע ציבורי שהגיע מעמית: מבנה, עקומות, והתאמת המזהה למפתח
function validatePublicInfo(info) {
  if (!info || typeof info !== 'object') throw new Error('פרטי עמית חסרים');
  const okp = (k, crv) => k && k.kty === 'OKP' && k.crv === crv && typeof k.x === 'string'
    && Buffer.from(k.x, 'base64url').length === 32 && !('d' in k);
  const ec = (k) => k && k.kty === 'EC' && k.crv === 'P-256' && typeof k.x === 'string' && typeof k.y === 'string'
    && Buffer.from(k.x, 'base64url').length === 32 && Buffer.from(k.y, 'base64url').length === 32 && !('d' in k);
  if (!okp(info.sign, 'Ed25519') || !okp(info.dh, 'X25519') || !ec(info.tls)) throw new Error('מפתחות עמית לא תקינים');
  // נקודה שאינה על העקומה — נדחית כבר כאן
  try { crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: info.tls.x, y: info.tls.y }, format: 'jwk' }); }
  catch { throw new Error('מפתחות עמית לא תקינים'); }
  if (info.id !== deviceIdFromSignKey(info.sign)) throw new Error('מזהה העמית אינו תואם את המפתח שלו');
  return { id: info.id, name: cleanName(info.name), sign: { kty: 'OKP', crv: 'Ed25519', x: info.sign.x }, dh: { kty: 'OKP', crv: 'X25519', x: info.dh.x }, tls: { kty: 'EC', crv: 'P-256', x: info.tls.x, y: info.tls.y } };
}

// טעינה/יצירה של הזהות. הקובץ מוצפן ב-DPAPI; בלי הצפנת מערכת — אין סנכרון (לעולם לא מפתח גלוי בדיסק)
function loadIdentity({ file, safeStorage, create = false, name }) {
  if (!safeStorage.isEncryptionAvailable()) {
    const err = new Error('הצפנת המערכת (DPAPI) אינה זמינה — לא ניתן לשמור את מפתחות הסנכרון בבטחה');
    err.code = 'no-encryption';
    throw err;
  }
  if (fs.existsSync(file)) {
    let identity;
    try { identity = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); }
    catch {
      const err = new Error('זהות הסנכרון אינה קריאה בחשבון זה (נוצרה במחשב או משתמש אחר)');
      err.code = 'identity-unreadable';
      throw err;
    }
    if (identity.id !== deviceIdFromSignKey(identity.sign)) throw new Error('קובץ זהות הסנכרון פגום');
    // זהות משלב 1, בלי מפתח TLS — משלימים ושומרים (המזהה לא משתנה)
    if (!identity.tls) {
      identity.tls = newTlsKey();
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(identity)), { mode: 0o600 });
    }
    return identity;
  }
  if (!create) {
    const err = new Error('במכשיר זה עדיין לא הוגדר סנכרון');
    err.code = 'no-identity';
    throw err;
  }
  const identity = createIdentity(name);
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(identity)), { mode: 0o600 });
  return identity;
}

const privateKey = (jwk) => crypto.createPrivateKey({ key: jwk, format: 'jwk' });
const publicKey = (jwk) => crypto.createPublicKey({ key: jwk.kty === 'EC'
  ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
  : { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });

module.exports = { createIdentity, loadIdentity, publicInfo, validatePublicInfo, deviceIdFromSignKey, privateKey, publicKey };
