#!/usr/bin/env node
// בדיקה לפני בניית גרסה להפצה (PLAN.md 4.5): בלי מפתח שורש ב-root-keys.js התוכנה נשלחת ללקוחות בלי רישוי —
// הכול פתוח לתמיד. בבנייה הרגילה (כל דחיפה ל-master) הבדיקה לא רצה; רק כשבוחרים "גרסה להפצה" ב-GitHub Actions.
//   node tools/release-check.js            יציאה 0 = מוכן, 1 = לא מוכן (עם הסבר בעברית)
'use strict';
const path = require('path');
const L = require('../shell/licensing/license');

// keys = תוכן root-keys.js, relayUrl = כתובת השרת המוגדרת מראש. מחזיר רשימת בעיות (ריקה = מוכן)
function releaseProblems(keys, relayUrl) {
  const problems = [];
  if (!Array.isArray(keys) || !keys.length) {
    problems.push('shell/licensing/root-keys.js ריק — גרסה כזו תעבוד אצל הלקוחות בלי רישוי. ' +
      'יש להפעיל קודם את המפתח לפי docs/LICENSING-ACTIVATION.md');
  } else {
    keys.forEach((k, i) => {
      if (!k || typeof k !== 'object') { problems.push(`מפתח ${i + 1} ב-root-keys.js אינו תקין`); return; }
      if ('d' in k) { problems.push(`מפתח ${i + 1} ב-root-keys.js הוא מפתח פרטי! רק המפתח הציבורי נכנס לתוכנה`); return; }
      try { L.keyId(k); } catch { problems.push(`מפתח ${i + 1} ב-root-keys.js אינו מפתח ציבורי תקין`); }
    });
  }
  if (!/^https:\/\//.test(String(relayUrl || ''))) problems.push('כתובת שרת הרישוי (shell/licensing/default-relay.js) חסרה או אינה https');
  return problems;
}

function main() {
  const keys = require(path.join(__dirname, '..', 'shell', 'licensing', 'root-keys.js'));
  const { DEFAULT_RELAY_URL } = require(path.join(__dirname, '..', 'shell', 'licensing', 'default-relay.js'));
  const problems = releaseProblems(keys, DEFAULT_RELAY_URL);
  if (problems.length) {
    console.error('הגרסה אינה מוכנה להפצה:');
    for (const p of problems) console.error(' ✖ ' + p);
    return 1;
  }
  console.log(`מוכן להפצה: ${keys.length} מפתחות שורש (${keys.map(k => L.keyId(k)).join(', ')}), שרת ${DEFAULT_RELAY_URL}`);
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { releaseProblems, main };
