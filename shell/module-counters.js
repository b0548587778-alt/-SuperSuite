// מונים של מסמכים ממוספרים במודולים שנשמרים ב-localStorage (בדיקת קוד 22.10.2026, ממצאים 4–5).
// שחזור גיבוי ישן לא מחזיר אותם אחורה: כל מונה = הגדול מבין הגיבוי למצב הנוכחי (כמו keepCounters במסד הכספים).
// ולפני האישור — כמה מסמכים הופקו אחרי הגיבוי (יחסרו בנתונים, אבל המספרים שלהם לא יינתנו שוב).
// משותף ל-main.js ולאנדרואיד (main-android.js). בלי require — פונקציות טהורות.
'use strict';

// מונה בערך משלו: { key } — JSON של מספר שלם. מונה בתוך אובייקט JSON: { key, field }.
// legacy — מפתחות ישנים שבהם המונה נשמר קודם (נקראים, לא נכתבים): הגבוה מבין כולם.
// ניהול מוסד (modules/school/logic.js): הנתונים מפוצלים למפתחות; מספר התשלום (הקבלה) האחרון ב-paySeq של 'school:core'.
// גיבוי ישן — הכול ב-'school:data' (המודול ממיר אותו בטעינה, והמונה = הגבוה מבין שני המפתחות).
// מונה חדש במודול — להוסיף כאן, אחרת שחזור גיבוי ישן יחזיר אותו אחורה ויינתנו מספרים כפולים
const MODULE_COUNTERS = {
  // השמאות: Storage ב-modules/shamai/src/core.js שומר JSON תחת התחילית shamai_v2_
  shamai: [
    { key: 'shamai_v2_purchaseSeq', label: 'שטרי קנייה' }, // purchase.js
    { key: 'shamai_v2_caseSeq', label: 'תיקי שמאות' },      // casefile.js
    { key: 'shamai_v2_reportSeq', label: 'דוחות שמאות' },   // report.js
  ],
  school: [
    { key: 'school:core', field: 'paySeq', legacy: ['school:data'], label: 'קבלות שכר לימוד' },
  ],
};

const parse = (items, key) => {
  if (!items || typeof items[key] !== 'string') return undefined;
  try { return JSON.parse(items[key]); } catch { return undefined; }
};
const okSeq = (n) => (Number.isSafeInteger(n) && n > 0 ? n : 0);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const seqAt = (items, key, field) => {
  const v = parse(items, key);
  if (!field) return okSeq(Number(v));
  return isObj(v) ? okSeq(Number(v[field])) : 0;
};
const seqOf = (items, key, field, legacy) => Math.max(seqAt(items, key, field), ...(legacy || []).map(k => seqAt(items, k, field)));

// next — הערכים מהגיבוי (עותק חדש מוחזר), current — מה שיש עכשיו במודול
function keepModuleCounters(id, next, current) {
  const list = MODULE_COUNTERS[id];
  if (!list || !next) return next;
  const out = { ...next };
  for (const { key, field, legacy } of list) {
    const cur = seqOf(current, key, field, legacy);
    if (cur <= seqOf(out, key, field, legacy)) continue;
    if (!field) { out[key] = JSON.stringify(cur); continue; }
    // בתוך אובייקט: רק השדה של המונה משתנה. גיבוי בלי האובייקט (או פגום) — אובייקט עם המונה בלבד; המודול משלים את השאר
    const obj = parse(out, key);
    out[key] = JSON.stringify({ ...(isObj(obj) ? obj : {}), [field]: cur });
  }
  return out;
}

// [{ label, count, last }] — מסמכים שהופקו אחרי הגיבוי, לפי המונה
function moduleIssuedAfter(id, backupItems, currentItems) {
  const out = [];
  for (const { key, field, label, legacy } of MODULE_COUNTERS[id] || []) {
    const was = seqOf(backupItems, key, field, legacy), now = seqOf(currentItems, key, field, legacy);
    if (now > was) out.push({ label, count: now - was, last: now });
  }
  return out;
}

// "בגיבוי חסרים 5 מסמכים שהופקו אחריו: חשבוניות — 3 (אחרון: 1234); קבלות — 2 (אחרון: 567)."
function issuedAfterText(items) {
  const list = (items || []).filter(x => x && x.count > 0);
  if (!list.length) return '';
  const total = list.reduce((s, x) => s + x.count, 0);
  return `בגיבוי חסרים ${total} מסמכים שהופקו אחריו: ${list.map(x => `${x.label} — ${x.count} (אחרון: ${x.last})`).join('; ')}. `
    + 'אחרי השחזור הם לא יופיעו בנתונים, אבל המספרים שלהם לא יינתנו שוב.';
}

module.exports = { MODULE_COUNTERS, keepModuleCounters, moduleIssuedAfter, issuedAfterText };
