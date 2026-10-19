// רשת ביטחון במסכים (PLAN.md 2.4): תקלה בתוך מסך של שמאות, אימונים או ארגז הכלים
// לא משאירה מסך לבן. מוצג פס בעברית עם "טען מחדש"; אם המסך התרוקן לגמרי — הודעה על כל המסך.
// נטען ראשון בכל מודול (main.js מגיש אותו מ-app://<מודול>/screen-guard.js; באנדרואיד — עותק בבנייה).
(function (root) {
  'use strict';

  const MESSAGE = 'משהו השתבש במסך הזה. הנתונים שלך שמורים.';

  // האם המסך ריק: אין תוכן גלוי מלבד הפס שלנו
  function isBlank(doc) {
    const body = doc.body;
    if (!body) return true;
    const main = doc.getElementById('root') || doc.getElementById('app') || body;
    return !String(main.textContent || '').trim();
  }

  function install(win) {
    const doc = win.document;
    let shown = null;

    // React מרוקן את המסך רק אחרי שהשגיאה מדווחת — לכן הבדיקה אם המסך ריק נדחית לסבב הבא
    let pending = false;
    function show(detail) {
      if (shown || pending) return;
      pending = true;
      win.setTimeout(() => { pending = false; render(detail); }, 0);
    }

    function render(detail) {
      if (shown) return;
      const full = isBlank(doc);
      const box = doc.createElement('div');
      box.id = 'ss-screen-guard';
      box.setAttribute('role', 'alert');
      box.dir = 'rtl';
      // צבעים רק משפת העיצוב (design-tokens.css נטען בכל מודול)
      box.style.cssText = full
        ? 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--ss-bg);color:var(--ss-text);font:16px "Segoe UI",Arial,sans-serif;text-align:center;padding:24px'
        : 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--ss-surface);color:var(--ss-text);border:1px solid var(--ss-border);border-radius:var(--ss-radius);box-shadow:var(--ss-shadow-lg);font:15px "Segoe UI",Arial,sans-serif;padding:12px 16px';
      const text = doc.createElement('span');
      text.textContent = MESSAGE;
      text.style.flex = '1';
      box.appendChild(text);
      const reload = doc.createElement('button');
      reload.type = 'button';
      reload.textContent = 'טען מחדש';
      reload.addEventListener('click', () => win.location.reload());
      box.appendChild(reload);
      if (!full) {
        const close = doc.createElement('button');
        close.type = 'button';
        close.textContent = 'סגור';
        close.addEventListener('click', () => { box.remove(); shown = null; });
        box.appendChild(close);
      }
      (doc.body || doc.documentElement).appendChild(box);
      shown = { full, detail };
    }

    // שגיאה בטעינת משאב (תמונה וכו') לא מגיעה לכאן — המאזין על window בלי capture תופס רק שגיאות קוד
    win.addEventListener('error', e => show(e && e.message));
    win.addEventListener('unhandledrejection', e => show(e && e.reason && e.reason.message));
    win.__ssScreenGuard = { show, render, state: () => shown };
    return win.__ssScreenGuard;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { install, isBlank, MESSAGE };
  else if (root && root.document) install(root);
})(typeof window !== 'undefined' ? window : null);
