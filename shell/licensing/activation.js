// תנאי ההפעלה של מערכת ברישיון: בלי שניהם התוכנה נעולה (חוץ ממסכי הרישוי, הכניסה וההודעות).
// 1. רישיון שנתי פעיל — הונפק ל-12 חודשים לפחות (365 יום), ולא פג.
// 2. חיבור לשרת הרישוי ב-30 הימים האחרונים — כך השבתה, חוב ועדכון סטטוס מגיעים לכל מערכת.
// כניסה עם Google אינה תנאי: במחשבים מסוננים Google חסום לעיתים (PLAN.md 4.1). היא נשארת אפשרות כניסה בלבד.
// פונקציה טהורה: בלי קבצים ובלי רשת. הזמנים נשמרים ב-store (מחוץ למסד הנתונים — שחזור גיבוי לא מאפס אותם).
// התקנה בלי רישוי (root-keys.js ריק) — אין דרישות, כמו קודם.
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TERM_DAYS = 365;
const CHECK_DAYS = 30;
// כמה ימים לפני הנעילה מציגים תזכורת להתחבר לשרת
const REMIND_DAYS = 7;
// סטייה קטנה בשעון (מחשבים שונים, אזורי זמן) — לא נחשבת "רישיון קצר"
const TERM_SLACK_DAYS = 2;

/* state — תוצאת store.current(); leaf — ה-payload של הרישיון של המערכת (issuedAt, expiresAt).
   lastSync — זמן (ms) של הסנכרון האחרון שהצליח.
   now — הזמן האפקטיבי (כבר מוגן מהחזרת שעון ב-store). */
function evaluate({ state, leaf, lastSync = 0, now, checkDays = CHECK_DAYS, minTermDays = MIN_TERM_DAYS }) {
  if (!state || state.mode !== 'licensed') return { required: false, ok: true, missing: [], steps: [], nextDue: null, dueSoon: false };
  const windowMs = checkDays * DAY_MS;
  const fresh = (t) => Number.isFinite(t) && t > 0 && t <= now + DAY_MS && now - t <= windowMs;
  const dueAt = (t) => (fresh(t) ? t + windowMs : null);

  const licenseOk = state.status === 'active' && !!leaf
    && Number(leaf.expiresAt) - Number(leaf.issuedAt) >= (minTermDays - TERM_SLACK_DAYS) * DAY_MS;
  const licenseReason = !leaf ? 'לא הותקן רישיון למערכת'
    : state.status !== 'active' ? 'הרישיון אינו פעיל'
      : !licenseOk ? `הרישיון הונפק לפחות משנה — נדרש רישיון שנתי (${minTermDays} יום לפחות)` : '';

  const steps = [
    { id: 'license', label: 'רישיון שנתי פעיל', ok: licenseOk, reason: licenseReason,
      until: leaf && licenseOk ? Number(leaf.expiresAt) : null },
    { id: 'server', label: 'חיבור לשרת הרישוי', ok: fresh(lastSync),
      reason: fresh(lastSync) ? '' : lastSync ? `לא היה חיבור לשרת ב-${checkDays} הימים האחרונים` : 'עדיין לא היה חיבור לשרת', until: dueAt(lastSync) },
  ];
  const missing = steps.filter(s => !s.ok).map(s => s.id);
  // התאריך שבו יידרש חיבור מחדש — לתזכורת לפני שהמערכת ננעלת
  const nextDue = steps.filter(s => s.ok && s.id !== 'license' && s.until).reduce((m, s) => Math.min(m, s.until), Infinity);
  const due = Number.isFinite(nextDue) ? nextDue : null;
  // המערכת פתוחה, אבל הנעילה בעוד פחות מ-REMIND_DAYS — מציגים תזכורת
  const dueSoon = missing.length === 0 && due != null && due - now <= REMIND_DAYS * DAY_MS;
  return { required: true, ok: missing.length === 0, missing, steps, nextDue: due, dueSoon };
}

// הודעה קצרה למסך / לשגיאת ערוץ חסום
function message(act) {
  if (!act || act.ok) return '';
  const first = act.steps.find(s => !s.ok);
  return 'המערכת לא הופעלה: ' + (first ? first.reason || first.label : 'חסרים תנאי הפעלה');
}

/* משך רישיון לפי חודשים: שנים מלאות = 365 יום לשנה (ולא 12×30=360 — אחרת "שנה" לא עוברת את הבדיקה).
   פחות מ-12 חודשים — נדחה: הרישיון שנתי לפחות */
function termMs(months) {
  const m = Number(months);
  if (!Number.isSafeInteger(m) || m < 12) throw new Error('הרישיון הוא לשנה לפחות (12 חודשים ומעלה)');
  if (m > 60) throw new Error('התקופה ארוכה מדי (עד 60 חודשים)');
  const years = Math.floor(m / 12);
  return (years * 365 + (m % 12) * 30) * DAY_MS;
}

module.exports = { evaluate, message, termMs, DAY_MS, MIN_TERM_DAYS, CHECK_DAYS, REMIND_DAYS };
