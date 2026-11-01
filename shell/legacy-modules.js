// מודולים שהיו בתוכנה ועברו למוצר אחר. גיבוי מגרסה ישנה שכולל אותם משוחזר בלי החלק הזה — בלי שגיאה,
// ובלי לגעת בשאר הנתונים. משותף ל-main.js ולאנדרואיד (android/web/main-android.js). בלי תלות ב-Node או ב-Electron.
// trainer (ניהול אימונים) — עבר למוצר החינוכי הנפרד. הנתונים שלו בגיבוי לא נקראים ולא נבדקים כאן.
'use strict';

const LEGACY_MODULES = ['trainer'];

const nonEmpty = (v) => !!v && (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);

// האם בגיבוי יש נתונים של מודול שעבר למוצר אחר (trainer = {} בגיבוי מלא — אין נתונים)
function hasLegacyModuleData(data) {
  const ls = data && typeof data === 'object' && data.localStorage;
  if (!ls || typeof ls !== 'object') return false;
  return LEGACY_MODULES.some(id => nonEmpty(ls[id]));
}

// הערה לחלון האישור, ופתיח להודעת "אין מה לשחזר" כשזה כל מה שיש בקובץ
const LEGACY_NOTE = 'נתוני ניהול האימונים שבגיבוי לא ישוחזרו כאן — המודול עבר למוצר נפרד.';
const LEGACY_ONLY = 'בקובץ יש רק נתוני ניהול אימונים, והמודול עבר למוצר נפרד. ';

module.exports = { LEGACY_MODULES, hasLegacyModuleData, LEGACY_NOTE, LEGACY_ONLY };
