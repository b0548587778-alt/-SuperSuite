// בחירת מפתח ההצפנה של מסד הנתונים בעלייה (PLAN.md 3.1) — בלי תלות ב-Electron, כדי שתיבדק.
// כלל ברזל: לעולם לא נוצר מפתח חדש בשקט כשיש במסד נתונים מוצפנים — מפתח חדש לא יפתח אותם.
const AutoBk = require('./auto-backup');
const AR = require('../modules/econ/core/atRest');

// מחזיר { key: Buffer|null, status }:
//   encrypted          — יש מפתח, הנתונים מוצפנים
//   plain-no-dpapi     — אין הצפנת Windows: עובדים כמו פעם, עם אזהרה
//   plain-key-unreadable — קובץ המפתח לא נקרא ואין עדיין נתונים מוצפנים: לא מצפינים (כדי לא לאבד את קוד השחזור הקיים)
//   missing            — יש נתונים מוצפנים, והמשתמש ביטל את הזנת קוד השחזור
// מפתח ששוחזר מהקוד ולא נשמר בקובץ — מוחזר גם ב-unsavedBackupKey, כדי שהתהליך הראשי ישתמש בו עד סוף ההפעלה
// (ולא ייצור מפתח אחר בשקט). onError(scope, e) — יומן תקלות
async function resolveDbKey({ fs, file, safeStorage, hasSealedData, verify, promptRecoveryCode, onError = () => {} }) {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  let backupKey = null;
  let problem = null;
  if (encryptionAvailable) {
    try { backupKey = AutoBk.loadAutoBackupKey({ file, safeStorage, create: !hasSealedData }); }
    catch (e) { problem = e.code || 'error'; }
  } else problem = 'no-encryption';

  if (backupKey) {
    const key = AR.deriveDbKey(backupKey);
    if (!hasSealedData || verify(key)) return { key, status: 'encrypted' };
    problem = 'key-wrong';
  }
  if (!hasSealedData) return { key: null, status: problem === 'no-encryption' ? 'plain-no-dpapi' : 'plain-key-unreadable' };

  // יש נתונים מוצפנים בלי מפתח תקין: רק קוד השחזור יפתח אותם
  let message = '';
  for (;;) {
    const code = await promptRecoveryCode({ reason: problem, message });
    if (code === null || code === undefined) return { key: null, status: 'missing' };
    let recovered;
    try { recovered = AutoBk.keyFromRecoveryCode(code); }
    catch (e) { message = e.message; continue; }
    const key = AR.deriveDbKey(recovered);
    if (!verify(key)) { message = 'קוד השחזור אינו של הנתונים במחשב הזה'; continue; }
    // שומרים את המפתח מחדש בחשבון הזה, כדי שבפעם הבאה לא יידרש הקוד. הקובץ הישן נשמר בצד (עותק) ולא נמחק.
    // החלפה אטומית: בעבר הישן הועבר הצידה לפני כתיבה ישירה; כשהכתיבה נכשלה בשקט לא נשאר קובץ, ובהמשך נוצר
    // מפתח אחר — וקוד שחזור שנרשם ממנו לא פותח את המסד (בדיקת קוד 23.10.2026). עכשיו בכל רגע יש קובץ מפתח
    if (encryptionAvailable) {
      try {
        if (fs.existsSync(file)) fs.copyFileSync(file, file + '.old-' + Date.now());
        AutoBk.writeFileDurable(fs, file, safeStorage.encryptString(recovered));
      } catch (e) {
        // לא נשמר — יידרש הקוד שוב בפעם הבאה; בהפעלה הזו המפתח נשאר בזיכרון
        onError('db-key-save', e);
        return { key, status: 'encrypted', recovered: true, unsavedBackupKey: recovered };
      }
    }
    return { key, status: 'encrypted', recovered: true };
  }
}

module.exports = { resolveDbKey };
