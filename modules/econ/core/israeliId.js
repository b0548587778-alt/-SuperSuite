// ספרת ביקורת למספר זהות / ח"פ / ע"ר ישראלי (אלגוריתם לוהן מותאם, 9 ספרות).
// משותף לעמותה, לגמ"ח ולחסד — שיוך זיכוי מס ב"תרומות ישראל" נכשל כשמספר הזהות שגוי.

// ריפוד באפסים ל-9 ספרות; מחזיר null לקלט שאינו 5–9 ספרות
function normalizeId(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{5,9}$/.test(s)) return null;
  return s.padStart(9, '0');
}

// הכפלה לסירוגין ב-1 וב-2 משמאל, סכום ספרות המכפלות — ומספר תקין מתחלק ב-10
function isValidIsraeliId(v) {
  const id = normalizeId(v);
  if (!id || /^0+$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

// בדיקת שדה בטופס. ריק — מותר (תורם מחו"ל / בלי מספר).
// prev: הערך השמור לפני העריכה. רשומה ישנה שנשמרה עם מספר שגוי לא נחסמת אם המספר לא שונה.
function assertIsraeliId(v, label, prev) {
  if (!v) return v;
  if (!/^\d{5,9}$/.test(v)) throw new Error(`${label} חייב להכיל 5–9 ספרות`);
  if (!isValidIsraeliId(v) && v !== prev) throw new Error(`${label} אינו תקין (ספרת ביקורת). אם הוא נכון — בדוק שהוקלד במלואו`);
  return v;
}

module.exports = { normalizeId, isValidIsraeliId, assertIsraeliId };
