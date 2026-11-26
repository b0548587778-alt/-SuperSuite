// מה מותר לקלוט מקובץ גיבוי בשחזור (main.js / android/web/main-android.js). קובץ הגיבוי הוא קלט חיצוני:
// המוצר שיצר אותו (product) נבדק לפני שסימוני הרישוי שבו נקלטים. בלי תלות ב-Electron או ב-Node — נבדק לבד ונארז לאנדרואיד.
// אותו כלל כמו ב-SuperSuite לימוד (shell/backup-scope.js שם), עם המזהה של המוצר הזה.
'use strict';

const { THIS_PRODUCT } = require('./licensing/products');

// המוצר שנרשם בכל גיבוי (collectBackup) — המזהה של התוכנה הזו בקטלוג המוצרים של מרכז הרישוי
const PRODUCT = THIS_PRODUCT;
// מודולים שיש רק ב-SuperSuite לימוד. גיבוי שלה מלפני שנרשם בו המוצר (בלי product) מכיל אותם תמיד, אפילו ריקים —
// וכך מבדילים אותו מגיבוי ישן של התוכנה הזו, שגם בו אין product
const OTHER_PRODUCT_MODULES = ['english', 'math', 'school'];

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// האם הגיבוי נוצר בתוכנה הזו. עם product — רק המזהה שלנו. בלי product (גיבוי מלפני שהשדה נוסף) — שלנו,
// אלא אם יש בו סימן של SuperSuite לימוד (מודול שלה, או גיבוי של מודול שלה)
function isOwnProduct(data) {
  if (!isPlainObject(data)) return false;
  if (data.product != null) return data.product === PRODUCT;
  if (OTHER_PRODUCT_MODULES.includes(data.scope)) return false;
  const ls = data.localStorage;
  return !(isPlainObject(ls) && OTHER_PRODUCT_MODULES.some(id => Object.prototype.hasOwnProperty.call(ls, id)));
}

// סימוני הרישוי לקליטה בשחזור (store.importMark — רק מחמירים, ולא מתבטלים לעולם), או null:
// - רק מגיבוי של המוצר הזה: גיבוי של מוצר אחר נושא את hadLicense / trialStart שלו, ונועל כאן את הניסיון לצמיתות
//   ("קובץ הרישוי חסר") — הרישיון של תוכנה אחת אינו עניינה של האחרת;
// - רק מקובץ מוצפן: JSON גלוי אפשר לערוך בעורך טקסט, וסימון hadLicense שנוסף בו נועל התקנה בתקופת ניסיון.
// שאר הגיבוי משוחזר כרגיל בשני המקרים — רק הסימונים לא נקלטים
function licenseMarksToMerge(data, { encrypted } = {}) {
  if (encrypted !== true || !isOwnProduct(data)) return null;
  const m = data.licenseMarks;
  return isPlainObject(m) ? m : null;
}

module.exports = { PRODUCT, OTHER_PRODUCT_MODULES, isOwnProduct, licenseMarksToMerge };
