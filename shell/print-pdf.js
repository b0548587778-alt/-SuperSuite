// שמירת מסך של מודול כ-PDF דרך מנגנון ההדפסה של התוכנה (PLAN.md 6.4) — כמו במודול הכלכלי:
// printToPDF של התצוגה עצמה (עם סגנון ההדפסה של העמוד, @media print) ← חלון "שמירה בשם" ← קובץ.
// המודול שולח רק שם מוצע לקובץ; הנתיב נבחר בחלון השמירה, והשם מנוקה (בלי תיקיות ותווים אסורים).
'use strict';

const path = require('path');

const MAX_NAME = 80;

// שם קובץ בטוח מהטקסט שהמודול שלח (שם מתאמן הוא קלט חופשי)
function pdfFileName(name) {
  const clean = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_NAME)
    .trim();
  return (clean || 'מסמך') + '.pdf';
}

// wc — ה-webContents של המודול ששלח את הבקשה; dir — תיקיית ברירת המחדל (המסמכים של המשתמש)
async function savePagePdf({ dialog, fs, win, wc, name, dir }) {
  const r = await dialog.showSaveDialog(win, {
    title: 'שמירה כ-PDF',
    defaultPath: path.join(dir, pdfFileName(name)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  const pdf = await wc.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(r.filePath, pdf);
  return { ok: true };
}

module.exports = { pdfFileName, savePagePdf, MAX_NAME };
