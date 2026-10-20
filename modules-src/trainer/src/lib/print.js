// שמירה כ-PDF דרך מנגנון ההדפסה של התוכנה (PLAN.md 6.4).
// בתוך SuperSuite ה-preload של המודול מסמן data-ss-pdf ומאזין לאירוע ss:save-pdf: הוא מבקש מהתוכנה PDF
// של המסך בסגנון ההדפסה, וחלון "שמירה בשם" נפתח. מחוץ לתוכנה (vite dev) — הדפסה רגילה של הדפדפן.
import { showMessage } from './dialog.js';

// שגיאה בשמירה — ה-preload כותב אותה למאפיין ושולח ss:pdf-error (אין לו גישה לחלון ההודעה של העמוד)
if (typeof window !== 'undefined') {
  window.addEventListener('ss:pdf-error', () => {
    const root = document.documentElement;
    const msg = root.getAttribute('data-ss-pdf-error');
    root.removeAttribute('data-ss-pdf-error');
    if (msg) showMessage(msg);
  });
}

export function savePdf(name) {
  const root = document.documentElement;
  if (!root.hasAttribute('data-ss-pdf')) {
    window.print();
    return;
  }
  root.setAttribute('data-ss-pdf-name', String(name || '').slice(0, 120));
  window.dispatchEvent(new Event('ss:save-pdf'));
}

export function printNow() {
  window.print();
}
