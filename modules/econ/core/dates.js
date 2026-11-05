// תאריך יום (YYYY-MM-DD) — עזר משותף לשירותים, ל-ipc.js ולקבצי core. בלי require — נארז גם לאנדרואיד.
// isDay — רק תאריך שקיים בלוח: 2026-02-31 נדחה (בדיקת regex לבדה, או Date.parse שמגלגל ל-3.3, קיבלו אותו).
// localDay — "היום" לפי השעון המקומי, לא toISOString (בישראל UTC מזיז את היום בין חצות ל-03:00).
// בדיקה חוזרת 24.10.2026: בדיקות תאריך מקומיות שנשארו עם regex בלבד — ראו tests/audit-r2-dates.test.js
'use strict';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BAD_DAY = 'תאריך לא תקין (YYYY-MM-DD)';

function isDay(s) {
  const m = typeof s === 'string' && DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const pad = (n) => String(n).padStart(2, '0');
function localDay(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ערך ריק ← ברירת המחדל (היום המקומי, או fallback אחר — null לטווח פתוח); תאריך קיים ← כמו שהוא;
// כל ערך אחר ← שגיאה בעברית. לא "היום" בשקט במקום התאריך שהמשתמש הקליד
function dayOr(v, fallback = localDay) {
  if (v === undefined || v === null || v === '') return typeof fallback === 'function' ? fallback() : fallback;
  if (!isDay(v)) throw new Error(BAD_DAY);
  return v;
}

// היום המקומי של חותמת זמן (createdAt / updatedAt ב-UTC). סקירת קוד 2.11.2026: slice(0, 10) של חותמת UTC
// הציג בין חצות ל-03:00 את אתמול. תאריך יום (בלי שעה) — כמו שהוא; ערך לא מזוהה — 10 התווים הראשונים
function stampDay(v) {
  const s = String(v ?? '');
  if (!s || DAY_RE.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? localDay(t) : s.slice(0, 10);
}

module.exports = { isDay, localDay, dayOr, stampDay, BAD_DAY };
