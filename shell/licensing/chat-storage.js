// אחסון תיבת ההודעות (ממצא 26). בשולחן העבודה — messages.bin מוצפן ("SSDB1:" + AES-256-GCM, כמו המסד),
// במפתח שנגזר (HKDF) ממפתח הגיבוי האוטומטי (DPAPI) — קוד השחזור (🔑) פותח גם אותו.
// messages.json גלוי מגרסה קודמת מומר בקריאה הראשונה, ונמחק רק אחרי שהעותק המוצפן נכתב ונבדק.
// בלי הצפנת מערכת (אין DPAPI, או מפתח הגיבוי לא נקרא) ובלי קובץ מוצפן — נשאר גלוי, כמו המסד (plain-no-dpapi).
// הממשק: { read(): string|null, write(text), setAside(), legacy(), dropLegacy(text), setAsideLegacy() } — ראו createChatStore ב-chat.js.
//   read זורק שגיאה רגילה כשאי אפשר לקרוא עכשיו (קובץ תפוס) — התיבה לא נדרסת,
//   ושגיאה עם code: 'chat-damaged' כשהקובץ המוצפן לא ייפתח לעולם (פגום, מפתח שאינו מתאים, או מפתח שאבד
//   בחשבון הזה) — התיבה מעבירה אותו הצידה (setAside), כמו המסד הנעול (setAsideLockedDatabase)
const path = require('path');
const AR = require('../../modules/econ/core/atRest');

const INFO = 'SuperSuite chat store v1:';
// שגיאות של מפתח הגיבוי (auto-backup.js) שניסיון חוזר לא יתקן: לא קריא בחשבון הזה, חסר, או שאין הצפנת מערכת.
// בלי זה התיבה הייתה "לא זמינה" לצמיתות, ההודעות לא אושרו לשרת ומילאו את התיבה שם — עד שגם הרישוי נדחה
const LOST_KEY_CODES = new Set(['key-unreadable', 'no-key', 'no-encryption']);

function damagedError(cause, message = 'תיבת ההודעות המוצפנת אינה נפתחת (קובץ פגום או מפתח שאינו מתאים)') {
  const e = new Error(message);
  e.code = 'chat-damaged';
  e.cause = cause;
  return e;
}

// כתיבה אטומית: קובץ זמני, fsync והחלפה — ניתוק חשמל באמצע לא משאיר קובץ שבור
function durableWrite(fs, file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); // למשל owner/ — אולי עוד לא קיימת
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// getBackupKey(create) ← מפתח הגיבוי האוטומטי (base64) או שגיאה. scope — מפתח נפרד לכל תיבה ('system' / 'owner')
function encryptedChatStorage({ fs, file, legacyFile, getBackupKey, scope, clock = Date.now, onError = () => {} }) {
  let cipher = null;
  // create=false כשכבר יש קובץ מוצפן: מפתח חדש לא יפתח אותו
  function cipherFor(create) {
    if (!cipher) {
      if (typeof getBackupKey !== 'function') throw new Error('אין מפתח הצפנה לתיבת ההודעות');
      cipher = AR.createCipher(AR.deriveDbKey(getBackupKey(create), INFO + scope));
    }
    return cipher;
  }
  const optionalCipher = () => { try { return cipherFor(true); } catch { return null; } };

  // המרה חד-פעמית: כתיבה מוצפנת ← בדיקה שהעותק נפתח וזהה ← מחיקת הגלוי (התוכן זהה). כשל — הגלוי נשאר, וננסה שוב
  function migrate(plain) {
    const c = optionalCipher();
    if (!c) return; // אין הצפנת מערכת — נשאר גלוי
    try {
      durableWrite(fs, file, c.seal(plain));
      if (c.open(fs.readFileSync(file, 'utf8')) !== plain) throw new Error('encrypted copy does not match');
    } catch (e) {
      try { fs.rmSync(file, { force: true }); } catch { /* הקובץ המוצפן יידרס בהמרה הבאה */ }
      onError('chat-migrate', e);
      return;
    }
    try { fs.rmSync(legacyFile, { force: true }); } catch (e) { onError('chat-storage', e); /* יימחק אחרי המיזוג בעלייה הבאה */ }
  }

  function read() {
    if (fs.existsSync(file)) {
      let c;
      try { c = cipherFor(false); } catch (e) {
        // המפתח אבד בחשבון הזה — כמו קובץ שלא נפתח: מועבר הצידה (קוד השחזור 🔑 עדיין פותח אותו), לא נמחק
        if (e && LOST_KEY_CODES.has(e.code)) throw damagedError(e, 'מפתח ההצפנה של תיבת ההודעות אינו קריא במחשב הזה');
        throw e;
      }
      const text = fs.readFileSync(file, 'utf8');
      if (!AR.isSealed(text)) throw damagedError(new Error('not sealed'));
      let plain;
      try { plain = c.open(text); } catch (e) { throw damagedError(e); }
      return plain;
    }
    if (!fs.existsSync(legacyFile)) return null;
    const plain = fs.readFileSync(legacyFile, 'utf8');
    migrate(plain);
    return plain;
  }

  // הכתיבה לא נוגעת בקובץ הגלוי: הוא נמחק רק אחרי שהתוכן שלו נמצא בתיבה המוצפנת (migrate / dropLegacy).
  // בעבר נמחק לפי השוואת זמני השינוי — וכל כתיבה הפכה אותו ל"ישן", גם כשהיו בו הודעות שאינן בתיבה
  function write(text) {
    const c = fs.existsSync(file) ? cipherFor(false) : optionalCipher();
    if (c) { durableWrite(fs, file, c.seal(text)); return; }
    durableWrite(fs, legacyFile, text); // בלי הצפנת מערכת — גלוי, כמו קודם
  }

  // קובץ פגום מועבר הצידה (לא נמחק) — אפשר יהיה לפתוח אותו בקוד השחזור
  function setAside() {
    const target = fs.existsSync(file) ? file : legacyFile;
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.unreadable-${clock()}`);
  }

  // קובץ גלוי שנמצא ליד המוצפן: המחיקה אחרי ההמרה נכשלה, או שגרסה ישנה רצה אחריה וכתבה בו הודעות חדשות
  // (שכבר אושרו לשרת). התיבה (chat.js) ממזגת אותו, ורק אחרי שהתיבה הממוזגת נכתבה הוא נמחק (dropLegacy)
  function legacy() {
    if (!fs.existsSync(file) || !fs.existsSync(legacyFile)) return null;
    return fs.readFileSync(legacyFile, 'utf8');
  }
  // רק אם לא השתנה מאז שנקרא (גרסה ישנה שכתבה בינתיים — ימוזג בעלייה הבאה)
  function dropLegacy(text) {
    try {
      if (fs.existsSync(legacyFile) && fs.readFileSync(legacyFile, 'utf8') === text) fs.rmSync(legacyFile, { force: true });
    } catch (e) { onError('chat-storage', e); }
  }
  // קובץ גלוי שאינו JSON — הצידה, לא נמחק
  function setAsideLegacy() {
    if (fs.existsSync(legacyFile)) fs.renameSync(legacyFile, `${legacyFile}.unreadable-${clock()}`);
  }

  return { read, write, setAside, legacy, dropLegacy, setAsideLegacy };
}

// אנדרואיד: localStorage של חלון המעטפת (גלוי — כמו שאר הנתונים שם). תוכן פגום מועבר למפתח צדדי.
// אין מקום לעותק (המכסה מלאה) — התוכן הפגום (JSON שבור; כאן אין הצפנה ואין מפתח שאבד) לא קריא בכל מקרה,
// והשארתו הייתה תוקעת את התיבה לצמיתות: כל הודעה "לא זמינה", לא מאושרת לשרת, והתיבה בשרת מתמלאת
function webChatStorage(ls, key, clock = Date.now, onError = () => {}) {
  return {
    read: () => ls.getItem(key),
    write: (text) => ls.setItem(key, text),
    setAside() {
      const v = ls.getItem(key);
      if (v == null) return;
      try { ls.setItem(`${key}.unreadable-${clock()}`, v); } catch (e) { onError('chat-damaged', e); }
      ls.removeItem(key);
    },
  };
}

module.exports = { encryptedChatStorage, webChatStorage };
