// מונים של מסמכים ממוספרים במודולים שנשמרים ב-localStorage (בדיקת קוד 22.10.2026, ממצאים 4–5).
// שחזור גיבוי ישן לא מחזיר אותם אחורה: כל מונה = הגדול מבין הגיבוי למצב הנוכחי (כמו keepCounters במסד הכספים).
// ולפני האישור — כמה מסמכים הופקו אחרי הגיבוי (יחסרו בנתונים, אבל המספרים שלהם לא יינתנו שוב).
// משותף ל-main.js ולאנדרואיד (main-android.js). בלי require — פונקציות טהורות.
'use strict';

// השמאות: Storage ב-modules/shamai/src/core.js שומר JSON תחת התחילית shamai_v2_
const MODULE_COUNTERS = {
  shamai: [
    { key: 'shamai_v2_purchaseSeq', label: 'שטרי קנייה' }, // purchase.js
    { key: 'shamai_v2_caseSeq', label: 'תיקי שמאות' },      // casefile.js
    { key: 'shamai_v2_reportSeq', label: 'דוחות שמאות' },   // report.js
  ],
};

const seqOf = (items, key) => {
  if (!items || typeof items[key] !== 'string') return 0;
  try { const n = Number(JSON.parse(items[key])); return Number.isSafeInteger(n) && n > 0 ? n : 0; } catch { return 0; }
};

// next — הערכים מהגיבוי (עותק חדש מוחזר), current — מה שיש עכשיו במודול
function keepModuleCounters(id, next, current) {
  const list = MODULE_COUNTERS[id];
  if (!list || !next) return next;
  const out = { ...next };
  for (const { key } of list) {
    const cur = seqOf(current, key);
    if (cur > seqOf(out, key)) out[key] = JSON.stringify(cur);
  }
  return out;
}

// [{ label, count, last }] — מסמכים שהופקו אחרי הגיבוי, לפי המונה
function moduleIssuedAfter(id, backupItems, currentItems) {
  const out = [];
  for (const { key, label } of MODULE_COUNTERS[id] || []) {
    const was = seqOf(backupItems, key), now = seqOf(currentItems, key);
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
