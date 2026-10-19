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

// הגיבוי האוטומטי האחרון בתיקייה (auto-YYYY-MM-DD.ssbk), או null
function latestAutoBackup(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => /^auto-\d{4}-\d{2}-\d{2}\.ssbk$/.test(f)).sort();
    if (!files.length) return null;
    const name = files[files.length - 1];
    return { file: path.join(dir, name), day: name.slice(5, 15) };
  } catch { return null; }
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
      : 'לא נמצא גיבוי אוטומטי בתיקיית הגיבוי. אם יש לכם גיבוי שנשמר בסיסמה, פנו לתמיכה או שחזרו אותו אחרי פתיחה ריקה.')
      + '\n\nהקובץ הפגום לא נמחק — הוא נשמר בצד בתיקיית הנתונים, ואפשר למסור אותו לתמיכה.\n\nלפנייה לתמיכה: "שמירת דוח תקלה" ושליחת הקובץ.',
    buttons
  };
}

module.exports = { classifyDbError, latestAutoBackup, setAsideDamaged, dialogFor, DB_NAME };
