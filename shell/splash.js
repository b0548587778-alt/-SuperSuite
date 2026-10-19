// מסך פתיחה (PLAN.md 7.2): חלון קטן עם הלוגו עד שהחלון הראשי מוכן להצגה.
// לעולם לא נשאר תקוע: נסגר כשהחלון הראשי מוכן, לפני כל חלון הודעה / קוד שחזור, ובכל מקרה אחרי MAX_MS.
'use strict';

const MAX_MS = 20 * 1000;

// open(): יוצר את החלון ומחזיר אותו (BrowserWindow). מוזרק — כך הלוגיקה נבדקת בלי Electron
function createSplash({ open, setTimer = setTimeout, clearTimer = clearTimeout, maxMs = MAX_MS }) {
  let w = null;
  try { w = open(); } catch { w = null; } // מסך פתיחה שנכשל לא עוצר את העלייה
  let timer = setTimer(() => close(), maxMs);
  function close() {
    if (timer) { clearTimer(timer); timer = null; }
    const cur = w;
    w = null;
    try { if (cur && !cur.isDestroyed()) cur.destroy(); } catch { /* כבר נסגר */ }
  }
  return { close, isOpen: () => !!(w && !w.isDestroyed()) };
}

module.exports = { createSplash, MAX_MS };
