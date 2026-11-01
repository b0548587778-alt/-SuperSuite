// מודולים שהיו בתוכנה ועברו למוצר אחר. גיבוי מגרסה ישנה שכולל אותם משוחזר בלי החלק הזה — בלי שגיאה,
// ובלי לגעת בשאר הנתונים. משותף ל-main.js ולאנדרואיד (android/web/main-android.js). בלי תלות ב-Node או ב-Electron.
// trainer (ניהול אימונים) — עבר למוצר החינוכי הנפרד (SuperSuite לימוד). הנתונים שלו בגיבוי לא משוחזרים כאן;
// מזהים אותם רק כדי להזהיר על קובץ גלוי (נתוני בריאות) בתיקיית הגיבוי — plain-backups.js.
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

// קובץ ישן מכפתור "ייצוא גיבוי (JSON)" של מודול האימונים (trainer-pro-backup-*.json): אובייקט שטוח
// מפתח ← מחרוזת JSON, עם לפחות מפתח אחד של המודול. נתוני בריאות של מתאמנים — גלויים
const TRAINER_FIXED = new Set(['trainer:profile', 'clients:index', 'studio:plans', 'studio:schedule']);
const TRAINER_PER_CLIENT = /^(client|program|sessions|measurements|assessments|memberships):[A-Za-z0-9_-]{1,64}$/;
const isTrainerKey = (k) => TRAINER_FIXED.has(k) || TRAINER_PER_CLIENT.test(k);
function isLegacyTrainerBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.suite) return false;
  const keys = Object.keys(data).filter(isTrainerKey);
  if (!keys.length) return false;
  return keys.every(k => {
    if (typeof data[k] !== 'string') return false;
    try { JSON.parse(data[k]); return true; } catch { return false; }
  });
}

// גיבוי (מלא או של המודול) שיש בו נתוני אימונים — בקובץ ישן או בגיבוי של SuperSuite עם localStorage.trainer
function hasTrainerData(data) {
  return isLegacyTrainerBackup(data) || (!!data && data.suite === 'SuperSuite' && hasLegacyModuleData(data));
}

module.exports = { LEGACY_MODULES, hasLegacyModuleData, isLegacyTrainerBackup, hasTrainerData, LEGACY_NOTE, LEGACY_ONLY };
