// בדיקת מבנה של נתוני האימונים לפני שחזור (PLAN.md 3.4).
// השחזור מוחק את הנתונים הקיימים — לכן קודם בודקים שהקובץ באמת נתוני אימונים, ורק אז מוחקים.
// משמש את main.js ואת האנדרואיד (android/web/main-android.js). בלי תלות ב-Node או ב-Electron.

// המפתחות שהמודול כותב (modules-src/trainer/src/lib/db.js — K)
const FIXED = new Set(['trainer:profile', 'clients:index', 'studio:plans', 'studio:schedule']);
const PER_CLIENT = /^(client|program|sessions|measurements|assessments|memberships):[A-Za-z0-9_-]{1,64}$/;

const isKnownKey = (k) => FIXED.has(k) || PER_CLIENT.test(k);
// מפתחות שערכם רשימה; השאר (trainer:profile, client:, program:) — אובייקט שאינו רשימה
const LIST_FIXED = new Set(['studio:plans', 'studio:schedule']);
const LIST_PER_CLIENT = /^(sessions|measurements|assessments|memberships):/;
const isListKey = (k) => LIST_FIXED.has(k) || LIST_PER_CLIENT.test(k);

function parse(v) {
  try { return { ok: true, value: JSON.parse(v) }; } catch { return { ok: false }; }
}

// items: אובייקט מפתח ← מחרוזת (כמו localStorage). מחזיר { ok, clean, skipped } או { ok:false, error }.
// מפתח לא מוכר מדולג (לא נכתב) ולא פוסל את הקובץ; ערך פגום במפתח מוכר — פוסל.
function checkTrainerItems(items) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return { ok: false, error: 'הקובץ אינו גיבוי של ניהול האימונים' };
  const clean = {};
  let skipped = 0;
  for (const [k, v] of Object.entries(items)) {
    if (!isKnownKey(k)) { skipped++; continue; }
    if (typeof v !== 'string') return { ok: false, error: `הקובץ פגום: הערך של ${k} אינו תקין` };
    const p = parse(v);
    if (!p.ok) return { ok: false, error: `הקובץ פגום: הערך של ${k} אינו תקין` };
    if (k === 'clients:index' && !(Array.isArray(p.value) && p.value.every(id => typeof id === 'string'))) {
      return { ok: false, error: 'הקובץ פגום: רשימת המתאמנים אינה תקינה' };
    }
    // רשימות (המסכים עוברים עליהן ב-for...of / forEach) מול רשומה בודדת (אובייקט שאינו רשימה)
    const shapeOk = k === 'clients:index' || (isListKey(k) ? Array.isArray(p.value)
      : (p.value !== null && typeof p.value === 'object' && !Array.isArray(p.value)));
    if (!shapeOk) return { ok: false, error: `הקובץ פגום: הערך של ${k} אינו תקין` };
    clean[k] = v;
  }
  if (!Object.keys(clean).length) return { ok: false, error: 'הקובץ אינו גיבוי של ניהול האימונים — לא נמצאו בו נתוני מתאמנים' };
  return { ok: true, clean, skipped };
}

// קובץ ישן מכפתור "ייצוא גיבוי (JSON)" של מודול האימונים: אובייקט שטוח של מחרוזות, בלי suite.
// מומר לצורת גיבוי של SuperSuite (מודול האימונים בלבד), אחרי בדיקת המבנה.
function legacyTrainerBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.suite) return null;
  const r = checkTrainerItems(data);
  if (!r.ok) return null;
  return { suite: 'SuperSuite', version: 2, scope: 'trainer', legacy: 'trainer-json', econ: null, localStorage: { trainer: data } };
}

module.exports = { checkTrainerItems, legacyTrainerBackup, isKnownKey };
