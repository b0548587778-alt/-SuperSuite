// הצפנת הנתונים בתוך unified_economics.db (PLAN.md 3.1).
// המפתח נגזר ממפתח הגיבוי האוטומטי (DPAPI), ולכן קוד השחזור (🔑) פותח גם את המסד.
// פורמט ערך מוצפן: "SSDB1:" + base64(iv[12] | tag[16] | ciphertext). ערך בלי התחילית = טקסט גלוי (מסד ישן).
const crypto = require('crypto');

const PREFIX = 'SSDB1:';
const INFO = 'SuperSuite at-rest database v1';

function keyError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// מפתח גיבוי (base64 של 32 בתים) ← מפתח נפרד למסד. HKDF: מפתח אחד לא משמש לשתי מטרות
function deriveDbKey(autoBackupKey) {
  const raw = Buffer.from(String(autoBackupKey || ''), 'base64');
  if (raw.length !== 32) throw keyError('db-key-invalid', 'מפתח ההצפנה של הנתונים אינו תקין');
  return Buffer.from(crypto.hkdfSync('sha256', raw, Buffer.alloc(0), INFO, 32));
}

const isSealed = (text) => typeof text === 'string' && text.startsWith(PREFIX);

// cipher = { seal(text), open(text) }. בלי מפתח: seal מחזיר טקסט גלוי (אין DPAPI / אנדרואיד),
// ו-open של ערך מוצפן נכשל בשגיאה db-key-missing — לעולם לא מחזירים נתונים ריקים בשקט
function createCipher(key) {
  if (!key) {
    return {
      enabled: false,
      seal: (text) => text,
      open: (text) => {
        if (isSealed(text)) throw keyError('db-key-missing', 'הנתונים מוצפנים, ומפתח ההצפנה אינו זמין במחשב הזה');
        return text;
      }
    };
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) throw keyError('db-key-invalid', 'מפתח ההצפנה של הנתונים אינו תקין');
  return {
    enabled: true,
    seal(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
    },
    open(text) {
      if (!isSealed(text)) return text; // ערך ישן שעוד לא הומר
      const all = Buffer.from(text.slice(PREFIX.length), 'base64');
      if (all.length < 28) throw keyError('db-key-wrong', 'הנתונים המוצפנים פגומים');
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
        d.setAuthTag(all.subarray(12, 28));
        return Buffer.concat([d.update(all.subarray(28)), d.final()]).toString('utf8');
      } catch {
        throw keyError('db-key-wrong', 'מפתח ההצפנה אינו מתאים לנתונים — ייתכן שהם נוצרו במחשב או בחשבון אחר');
      }
    }
  };
}

module.exports = { deriveDbKey, createCipher, isSealed, PREFIX };
