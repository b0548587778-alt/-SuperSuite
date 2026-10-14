// לוגיקת הגיבוי האוטומטי היומי — ללא תלות ב-Electron, כדי שתיבדק בבדיקות.
// main.js מזריק את התלויות (safeStorage, איסוף הנתונים, כתיבה) ומקבל סטטוס שנשמר ומוצג במעטפת.
const fs = require('fs');
const path = require('path');

// קריאת מפתח הגיבוי האוטומטי. create=false (בשחזור): לא יוצרים מפתח חדש בשקט —
// מפתח חדש לעולם לא יפענח גיבוי ישן, והשגיאה הייתה מטעה ("הזן סיסמה").
function loadAutoBackupKey({ file, safeStorage, create }) {
  if (!safeStorage.isEncryptionAvailable()) {
    const err = new Error('הצפנת המערכת (DPAPI) אינה זמינה בחשבון זה');
    err.code = 'no-encryption';
    throw err;
  }
  if (fs.existsSync(file)) {
    try { return safeStorage.decryptString(fs.readFileSync(file)); }
    catch {
      const err = new Error('מפתח הגיבוי האוטומטי אינו קריא בחשבון זה (נוצר במחשב או משתמש אחר)');
      err.code = 'key-unreadable';
      throw err;
    }
  }
  if (!create) {
    const err = new Error('אין במחשב הזה מפתח גיבוי אוטומטי — גיבוי אוטומטי ניתן לשחזר רק במחשב ובחשבון שבו נוצר');
    err.code = 'no-key';
    throw err;
  }
  const k = require('crypto').randomBytes(32).toString('base64');
  fs.writeFileSync(file, safeStorage.encryptString(k));
  return k;
}

const todayName = (now) => `auto-${now.toISOString().slice(0, 10)}.ssbk`;

// מריץ סבב גיבוי אחד ומחזיר סטטוס { ok, reason?, file?, at, target }.
// customTarget: יעד שהמשתמש בחר (USB) — לעולם לא נוצר אם חסר (כונן לא מחובר).
// defaultTarget: תיקיית המסמכים — נוצרת אם אינה קיימת (בהתקנה חדשה היא לא קיימת).
async function runAutoBackup({ encryptionAvailable, customTarget, defaultTarget, collect, getKey, write, now = new Date() }) {
  const target = customTarget || defaultTarget;
  const at = now.toISOString();
  if (!encryptionAvailable) return { ok: false, reason: 'no-encryption', target, at };
  if (!customTarget) {
    try { fs.mkdirSync(defaultTarget, { recursive: true }); } catch {}
  }
  if (!target || !fs.existsSync(target)) return { ok: false, reason: 'target-missing', target, at };
  // אם הגיבוי של היום כבר קיים — לא אוספים נתונים בכלל (האיסוף טוען את כל המודולים)
  const name = todayName(now);
  if (fs.existsSync(path.join(target, name))) return { ok: true, skipped: true, file: path.join(target, name), target, at };
  const plainText = JSON.stringify(await collect());
  const r = write({ dir: target, plainText, key: getKey(), keep: 14, today: now.toISOString().slice(0, 10) });
  return { ...r, target, at };
}

// טקסט למשתמש עבור סטטוס הגיבוי האחרון
function describeStatus(s) {
  if (!s || !s.at) return '';
  const when = String(s.at).slice(0, 16).replace('T', ' ');
  if (s.ok) return `גיבוי אחרון הצליח (${when})`;
  const why = {
    'no-encryption': 'הצפנת המערכת אינה זמינה — גיבוי אוטומטי כבוי',
    'target-missing': 'יעד הגיבוי לא נמצא (כונן לא מחובר?)',
    'no-key': 'אין מפתח גיבוי',
    'key-unreadable': 'מפתח הגיבוי אינו קריא בחשבון זה',
    'write-failed': 'הכתיבה ליעד נכשלה (כונן מלא או מוגן מפני כתיבה?)',
    'shabbat': 'נדחה — שבת/יום טוב; יתבצע אחרי הצאת',
    'error': 'שגיאה בגיבוי'
  }[s.reason] || 'הגיבוי לא בוצע';
  return `⚠ ${why} (${when})`;
}

module.exports = { loadAutoBackupKey, runAutoBackup, describeStatus };
