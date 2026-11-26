// עזרים לבדיקות שרצות גם ב-Windows (CI על windows-latest, checkout עם core.autocrlf — קבצים עם CRLF):
// readText — קריאת טקסט של קובץ מקור עם שורות LF בלבד, כדי שביטוי רגולרי עם \n או חיתוך לפי '\n' יעבדו בשתי המערכות.
// closeEconDb / removeDirs — ב-Windows קובץ מסד פתוח נעול (EBUSY): סוגרים את המסד של ה-IPC לפני המחיקה,
// והמחיקה עם ניסיונות חוזרים ובלי להפיל את קובץ הבדיקות (run-tests.js מוחק את התיקייה הזמנית בסוף בכל מקרה).
'use strict';
const fs = require('fs');
const path = require('path');

const toLf = (s) => String(s).replace(/\r\n/g, '\n');
const readText = (...parts) => toLf(fs.readFileSync(path.join(...parts), 'utf8'));

function closeEconDb(ipc) {
  try { const d = ipc && ipc.getDb && ipc.getDb(); if (d && typeof d.close === 'function') d.close(); } catch { /* כבר סגור */ }
}

function removeDirs(dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* עדיין נעול — run-tests.js מנקה */ }
  }
}

module.exports = { toLf, readText, closeEconDb, removeDirs };
