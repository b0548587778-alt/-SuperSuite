// נתוני השמאות לעוזר ה-AI — פונקציות טהורות מעל תמונת המחסן המוצפן של המודול (מפתח ← מחרוזת JSON).
// התהליך הראשי קורא את התמונה רק לבקשת המודול הכלכלי (main.js: shamaiDataForEcon), ו-ipc.js
// מעביר לכאן רק כשהתחום פתוח לרישיון ולהרשאה. בלי זה שאלת הדוגמה על השמאות נענתה תמיד „אין נתונים”.
// הנתונים הגיעו מעמוד — קלט לא מהימן: רשומה פגומה מדולגת, לא מפילה. קריאה בלבד.
// בלי פרטי הלקוח של השמאות (שם, ת״ז) — רק מה שהתשובה צריכה. כסף באגורות שלמות.
'use strict';

const MAX_AG = 100_000_000_000; // כמו clipAg ב-ipc.js
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const okAg = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_AG;

// תאריך מקומי YYYY-MM-DD אמיתי (2026-02-31 נדחה). בלי toISOString — UTC מזיז את היום בלילה
function isDay(v) {
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}
const shortHe = (s) => `${Number(s.slice(8, 10))}.${Number(s.slice(5, 7))}.${s.slice(0, 4)}`;

function parse(items, key) {
  const v = items[key];
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ---------- שמאות ----------
const SHAMAI_CASES = 'shamai_v2_cases'; // Storage.prefix + 'cases' (modules/shamai/src/core.js, casefile.js)
const BASIS_HE = { market: 'שווי שוק', replacement: 'שווי החלפה', liquidation: 'שווי מימוש', melt: 'ערך התכה' };

// הערכת השווי האחרונה = תיק השמאות האחרון שננעל (finalizeCase: frozen.totalAg בשקלים, באגורות).
// בלי שם הלקוח ובלי ת״ז — רק מספר התיק, התאריך, מספר הפריטים ובסיס השווי. אין תיק סופי — null
function shamaiContext(items) {
  if (!items || typeof items !== 'object') return null;
  const list = parse(items, SHAMAI_CASES);
  if (!Array.isArray(list)) return null;
  const when = (c) => String(c.finalizedAt || c.reportDate || '');
  const finals = list.filter(c => c && typeof c === 'object' && c.status === 'final' && c.frozen && typeof c.frozen === 'object' && okAg(c.frozen.totalAg));
  if (!finals.length) return null;
  const c = finals.reduce((a, b) => (when(b) > when(a) ? b : a));
  const rev = Number.isSafeInteger(c.rev) && c.rev > 0 ? `-${c.rev}` : '';
  const parts = [`תיק ${clip(c.no, 20)}${rev}`];
  if (isDay(c.reportDate)) parts.push(`מ-${shortHe(c.reportDate)}`);
  const count = Array.isArray(c.items) ? c.items.length : 0;
  const details = [count === 1 ? 'פריט אחד' : `${count} פריטים`];
  if (BASIS_HE[c.basis]) details.push(BASIS_HE[c.basis]);
  const warnings = [];
  if (c.currency && c.currency !== 'ILS') warnings.push('הדוח הופק במטבע זר — הסכום כאן בשקלים, לפי השער שנשמר בנעילה.');
  const finalizedAt = when(c);
  if (list.some(d => d && typeof d === 'object' && d.status === 'draft' && String(d.created || '') > finalizedAt)) {
    warnings.push('יש תיק טיוטה חדש יותר שטרם ננעל — הוא אינו כלול בתשובה.');
  }
  return { label: `${parts.join(' ')}, ${details.join(', ')}`, valueAg: c.frozen.totalAg, confidence: null, factors: [], warnings };
}

module.exports = { shamaiContext, SHAMAI_CASES };
