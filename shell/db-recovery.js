// מסד נתונים פגום או נעול בעלייה (PLAN.md 2.3) — בלי תלות ב-Electron, כדי שייבדק.
// במקום שגיאה טכנית וסגירה: הודעה בעברית ואפשרויות — שחזור מהגיבוי האוטומטי האחרון,
// פתיחת תיקיית הנתונים, דוח תקלה. המסד הפגום לעולם לא נמחק — הוא מועבר הצידה.
const fs = require('fs');
const path = require('path');

// קודי SQLite: 5 = BUSY, 6 = LOCKED, 11 = CORRUPT, 26 = NOTADB
function classifyDbError(err) {
  if (!err) return null;
  const code = Number(err.errcode);
  const msg = String(err.message || '');
  if (code === 5 || code === 6 || /database is locked|SQLITE_BUSY/i.test(msg)) return 'locked';
  if (code === 11 || code === 26 || /malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(msg)) return 'corrupt';
  return null;
}

const DB_NAME = 'unified_economics.db';

// קובצי הגיבוי האוטומטי בתיקייה (auto-YYYY-MM-DD.ssbk, ומאז ממצא 38 גם auto-YYYY-MM-DD-<סימן ההתקנה>.ssbk), מהישן
// לחדש. ביעד משותף יש גם גיבויים של מחשבים אחרים — latestUsableAutoBackup מדלג על מה שלא נפתח במפתח של המחשב הזה
function autoBackupFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => /^auto-\d{4}-\d{2}-\d{2}(-[0-9a-f]{8})?\.ssbk$/.test(f)).sort(); } catch { return []; }
}
const backupInfo = (dir, name) => ({ file: path.join(dir, name), day: name.slice(5, 15) });

// הגיבוי האוטומטי האחרון בתיקייה (auto-YYYY-MM-DD.ssbk), או null
function latestAutoBackup(dir) {
  const files = autoBackupFiles(dir);
  return files.length ? backupInfo(dir, files[files.length - 1]) : null;
}

// הגיבוי האוטומטי החדש ביותר שמכיל את הנתונים הכספיים. גיבויים שנכתבו לפני התיקון (בדיקת הקוד 20.10.2026,
// ממצא 1) עשויים להיות בלי הכספים (econ: null) — השחזור מהם היה נכשל. open(file) מפענח ומחזיר את התוכן או זורק.
// מחזיר { file, day, data, skipped } (skipped — כמה גיבויים חדשים יותר דולגו). אם אף גיבוי לא מתאים —
// האחרון בלי data (כמו קודם), כדי שהשחזור ינסה אותו ויציג את הסיבה (למשל מפתח של מחשב אחר). אין גיבוי — null
function latestUsableAutoBackup(dir, open) {
  const files = autoBackupFiles(dir);
  if (!files.length) return null;
  for (let i = files.length - 1; i >= 0; i--) {
    const info = backupInfo(dir, files[i]);
    let data = null;
    try { data = open(info.file); } catch { /* לא נפתח — ממשיכים לישן יותר */ }
    if (data && data.suite === 'SuperSuite' && data.econ) return { ...info, data, skipped: files.length - 1 - i };
  }
  return backupInfo(dir, files[files.length - 1]);
}

// העברת המסד הפגום הצידה (עם קבצי WAL), כדי שאפשר יהיה לפתוח מסד חדש ולשחזר לתוכו
function setAsideDamaged(userDataPath, now = Date.now()) {
  const base = path.join(userDataPath, DB_NAME);
  const target = `${base}.damaged-${now}`;
  if (fs.existsSync(base)) fs.renameSync(base, target);
  for (const ext of ['-wal', '-shm']) { if (fs.existsSync(base + ext)) fs.renameSync(base + ext, target + ext); }
  return target;
}

// הטקסט והכפתורים של ההודעה. backup — מ-latestAutoBackup
function dialogFor(kind, backup) {
  if (kind === 'locked') {
    return {
      message: 'הנתונים פתוחים כרגע בתוכנה אחרת',
      detail: 'ייתכן ש-SuperSuite כבר פתוחה במחשב אחר שעובד על אותה תיקייה (למשל תיקייה משותפת ברשת), או שהתוכנה לא נסגרה עד הסוף.\n\nסגרו את התוכנה במחשב השני, או המתינו דקה, ונסו שוב.',
      buttons: [{ id: 'retry', label: 'נסו שוב' }, { id: 'folder', label: 'פתיחת תיקיית הנתונים' }, { id: 'report', label: 'שמירת דוח תקלה' }, { id: 'quit', label: 'יציאה' }]
    };
  }
  const buttons = [];
  if (backup) buttons.push({ id: 'restore', label: `שחזור מהגיבוי האוטומטי (${backup.day})` });
  buttons.push({ id: 'folder', label: 'פתיחת תיקיית הנתונים' }, { id: 'report', label: 'שמירת דוח תקלה' }, { id: 'quit', label: 'יציאה' });
  return {
    message: 'קובץ הנתונים פגום ולא ניתן לפתוח אותו',
    detail: (backup
      ? `נמצא גיבוי אוטומטי מתאריך ${backup.day}. השחזור פותח קובץ נתונים חדש ומכניס אליו את הגיבוי. נתונים שנרשמו אחרי הגיבוי לא יחזרו.`
        + (backup.skipped ? `\n\nגיבויים חדשים יותר (${backup.skipped}) דולגו: הם אינם מכילים את הנתונים הכספיים או שלא ניתן לפתוח אותם.` : '')
      : 'לא נמצא גיבוי אוטומטי בתיקיית הגיבוי. אם יש לכם גיבוי שנשמר בסיסמה, פנו לתמיכה או שחזרו אותו אחרי פתיחה ריקה.')
      + '\n\nהקובץ הפגום לא נמחק — הוא נשמר בצד בתיקיית הנתונים, ואפשר למסור אותו לתמיכה.\n\nלפנייה לתמיכה: "שמירת דוח תקלה" ושליחת הקובץ.',
    buttons
  };
}

module.exports = { classifyDbError, latestAutoBackup, latestUsableAutoBackup, setAsideDamaged, dialogFor, DB_NAME };
