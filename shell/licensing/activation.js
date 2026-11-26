// תנאי ההפעלה של מערכת ברישיון: בלי שניהם התוכנה נעולה (חוץ ממסכי הרישוי, הכניסה וההודעות).
// 1. רישיון שנתי פעיל — הונפק ל-12 חודשים לפחות (365 יום), ולא פג.
// 2. חיבור לשרת הרישוי ב-30 הימים האחרונים — כך השבתה, חוב ועדכון סטטוס מגיעים לכל מערכת.
//    החלטת הבעלים (סקירה 2.11.2026): בין יום 30 ליום 60 בלי בדיקה חתומה — צפייה בלבד (readOnly: קריאה, ייצוא
//    וגיבוי, כמו חוב); נעילה מלאה רק אחרי LOCK_DAYS. מערכת שעוד לא התחברה אף פעם — נעולה כמו קודם
// כניסה עם Google אינה תנאי: במחשבים מסוננים Google חסום לעיתים (PLAN.md 4.1). היא נשארת אפשרות כניסה בלבד.
// פונקציה טהורה: בלי קבצים ובלי רשת. הזמנים נשמרים ב-store (מחוץ למסד הנתונים — שחזור גיבוי לא מאפס אותם).
// התקנה בלי רישוי (root-keys.js ריק) — אין דרישות, כמו קודם.
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TERM_DAYS = 365;
const CHECK_DAYS = 30;
// בלי חיבור יותר מ-CHECK_DAYS ועד LOCK_DAYS — צפייה בלבד; אחרי זה — נעולה
const LOCK_DAYS = 60;
// כמה ימים לפני הנעילה מציגים תזכורת להתחבר לשרת
const REMIND_DAYS = 7;
// סטייה קטנה בשעון (מחשבים שונים, אזורי זמן) — לא נחשבת "רישיון קצר"
const TERM_SLACK_DAYS = 2;

/* state — תוצאת store.current(); leaf — ה-payload של הרישיון של המערכת (issuedAt, expiresAt).
   lastSync — זמן (ms) של הסנכרון האחרון שהצליח.
   now — הזמן האפקטיבי (כבר מוגן מהחזרת שעון ב-store). */
// מערכת בת (סקירת קוד 2.11.2026, ממצא f2 — החלטת הבעלים): התוקף שלה מוגבל לתוקף ההורה, ולכן מערכת בת שהונפקה
// באמצע השנה של ההורה מקבלת פחות מ-365 יום. היא פטורה מבדיקת המשך כשהתוקף שלה הוא בדיוק התוקף של רישיון מעליה
// בשרשרת (כלומר הוגבל בגללו), ורישיון זה עצמו עומד בתנאי (או מוגבל באותה צורה לרישיון שמעליו).
// chain — ה-payloads של השרשרת המאומתת, מהשורש ועד המערכת (האחרון = leaf)
function termOk(leaf, chain, minTermDays) {
  const min = (minTermDays - TERM_SLACK_DAYS) * DAY_MS;
  const long = (p) => Number(p.expiresAt) - Number(p.issuedAt) >= min;
  if (long(leaf)) return true;
  const list = Array.isArray(chain) ? chain.filter(p => p && typeof p === 'object') : [];
  // לפי זהות האובייקט או לפי מזהה הרישיון (השרשרת והעלה נקראים לעיתים בשתי קריאות נפרדות)
  const at = list.findIndex(p => p === leaf || (leaf.id != null && p.id === leaf.id));
  if (at <= 0) return false;
  for (let i = at - 1; i >= 0; i--) {
    if (Number(list[i].expiresAt) !== Number(leaf.expiresAt)) return false;
    if (long(list[i])) return true;
  }
  return false;
}

function evaluate({ state, leaf, chain = null, lastSync = 0, now, checkDays = CHECK_DAYS, lockDays = LOCK_DAYS, minTermDays = MIN_TERM_DAYS }) {
  if (!state || state.mode !== 'licensed') return { required: false, ok: true, missing: [], steps: [], nextDue: null, dueSoon: false, readOnly: false, lockAt: null, lockSoon: false };
  const windowMs = checkDays * DAY_MS;
  const valid = (t) => Number.isFinite(t) && t > 0 && t <= now + DAY_MS;
  const fresh = (t) => valid(t) && now - t <= windowMs;
  const dueAt = (t) => (fresh(t) ? t + windowMs : null);
  // אחרי חלון החיבור ועד הנעילה — צפייה בלבד
  const grace = valid(lastSync) && !fresh(lastSync) && now - lastSync <= lockDays * DAY_MS;
  const lockAt = valid(lastSync) ? lastSync + lockDays * DAY_MS : null;

  const licenseOk = state.status === 'active' && !!leaf && termOk(leaf, chain, minTermDays);
  const licenseReason = !leaf ? 'לא הותקן רישיון למערכת'
    : state.status !== 'active' ? 'הרישיון אינו פעיל'
      : !licenseOk ? `הרישיון הונפק לפחות משנה — נדרש רישיון שנתי (${minTermDays} יום לפחות)` : '';

  const steps = [
    { id: 'license', label: 'רישיון שנתי פעיל', ok: licenseOk, reason: licenseReason,
      until: leaf && licenseOk ? Number(leaf.expiresAt) : null },
    { id: 'server', label: 'חיבור לשרת הרישוי', ok: fresh(lastSync),
      reason: fresh(lastSync) ? '' : grace ? `לא היה חיבור לשרת ב-${checkDays} הימים האחרונים — צפייה בלבד; אחרי ${lockDays} יום בלי חיבור המערכת תינעל`
        : lastSync ? `לא היה חיבור לשרת ב-${lockDays} הימים האחרונים` : 'עדיין לא היה חיבור לשרת', until: dueAt(lastSync) },
  ];
  const missing = steps.filter(s => !s.ok).map(s => s.id);
  // התאריך שבו יידרש חיבור מחדש — לתזכורת לפני שהמערכת ננעלת
  const nextDue = steps.filter(s => s.ok && s.id !== 'license' && s.until).reduce((m, s) => Math.min(m, s.until), Infinity);
  const due = Number.isFinite(nextDue) ? nextDue : null;
  // המערכת פתוחה, אבל הנעילה בעוד פחות מ-REMIND_DAYS — מציגים תזכורת
  const dueSoon = missing.length === 0 && due != null && due - now <= REMIND_DAYS * DAY_MS;
  // חסר רק החיבור, ועוד לא עברו LOCK_DAYS — צפייה בלבד (ולא נעילה)
  const readOnly = missing.length === 1 && missing[0] === 'server' && grace;
  const lockSoon = readOnly && lockAt - now <= REMIND_DAYS * DAY_MS;
  return { required: true, ok: missing.length === 0, missing, steps, nextDue: due, dueSoon, readOnly, lockAt: missing.length === 0 || readOnly ? lockAt : null, lockSoon };
}

// הודעה קצרה למסך / לשגיאת ערוץ חסום
function message(act) {
  if (!act || act.ok) return '';
  const first = act.steps.find(s => !s.ok);
  if (act.readOnly) return 'צפייה בלבד: ' + (first ? first.reason : 'אין חיבור לשרת הרישוי');
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

module.exports = { evaluate, message, termMs, DAY_MS, MIN_TERM_DAYS, CHECK_DAYS, LOCK_DAYS, REMIND_DAYS };
