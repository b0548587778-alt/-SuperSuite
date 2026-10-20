// הצפנת גיבוי: AES-256-GCM עם מפתח שנגזר מסיסמה (scrypt). פורמט הקובץ: "SSBK1:" + JSON בבסיס 64.
// v1 — N=2^14, r=8, p=1 (גיבויים ישנים, נפתחים כמו קודם). v2 — p=5: שקול להמלצת OWASP (N=2^17, r=8, p=1) מבחינת
// עבודה לכל ניחוש, באותו זיכרון של v1 (16MiB) — חשוב לאנדרואיד, שם scrypt רץ ב-Java (Scrypt.java). הפרמטרים נשמרים
// בקובץ, ונבדקים מול רשימה סגורה: קובץ שנערך לא יכול לגרום להקצאת זיכרון ענקית או לחישוב של דקות.
const crypto = require('crypto');

const PREFIX = 'SSBK1:';
// גיבוי חדש: 12 תווים לפחות (דוח הבדיקה, ממצא 3). פתיחה — כל סיסמה, גם של גיבוי ישן בן 8 תווים
const MIN_PASSPHRASE = 12;
const PARAMS = { 1: { N: 16384, r: 8, p: 1 }, 2: { N: 16384, r: 8, p: 5 } };
const VERSION = 2;

function deriveKey(passphrase, salt, params) {
  return crypto.scryptSync(passphrase, salt, 32, params);
}

// הפרמטרים של הקובץ: רק גרסה מוכרת, ואם נשמרו בו פרמטרים — בדיוק אלה של הגרסה
function paramsOf(payload) {
  const v = payload.v === undefined ? 1 : payload.v;
  const known = Number.isInteger(v) && Object.hasOwn(PARAMS, v) ? PARAMS[v] : null;
  if (!known) throw new Error('קובץ הגיבוי נוצר בגרסה חדשה יותר של התוכנה, או שהוא פגום');
  const s = payload.scrypt;
  if (s !== undefined && (!s || s.N !== known.N || s.r !== known.r || s.p !== known.p)) throw new Error('קובץ הגיבוי פגום');
  return known;
}

function isEncryptedBackup(text) {
  return typeof text === 'string' && text.startsWith(PREFIX);
}

function encryptBackup(plainText, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`סיסמת הגיבוי חייבת להכיל לפחות ${MIN_PASSPHRASE} תווים`);
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const params = PARAMS[VERSION];
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, params), iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const payload = { v: VERSION, scrypt: { ...params }, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  return PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// זורק שגיאה ברורה אם הסיסמה שגויה או שהקובץ פגום (GCM בודק שלמות)
function decryptBackup(text, passphrase) {
  if (!isEncryptedBackup(text)) throw new Error('הקובץ אינו מוצפן');
  if (typeof passphrase !== 'string' || !passphrase) throw new Error('נדרשת סיסמת גיבוי לפתיחת הקובץ');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(text.slice(PREFIX.length), 'base64').toString('utf8'));
  } catch {
    throw new Error('קובץ הגיבוי פגום');
  }
  if (!payload || typeof payload !== 'object' || typeof payload.salt !== 'string') throw new Error('קובץ הגיבוי פגום');
  const params = paramsOf(payload);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, Buffer.from(payload.salt, 'base64'), params), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('סיסמת הגיבוי שגויה או שהקובץ פגום');
  }
}

module.exports = { encryptBackup, decryptBackup, isEncryptedBackup, MIN_PASSPHRASE, PARAMS };
