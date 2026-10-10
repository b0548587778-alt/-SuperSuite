// הצפנת גיבוי: AES-256-GCM עם מפתח שנגזר מסיסמה (scrypt). פורמט הקובץ: "SSBK1:" + JSON בבסיס 64.
const crypto = require('crypto');

const PREFIX = 'SSBK1:';
const MIN_PASSPHRASE = 8;
const SCRYPT = { N: 16384, r: 8, p: 1 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
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
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const payload = { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
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
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, Buffer.from(payload.salt, 'base64')), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('סיסמת הגיבוי שגויה או שהקובץ פגום');
  }
}

module.exports = { encryptBackup, decryptBackup, isEncryptedBackup, MIN_PASSPHRASE };
