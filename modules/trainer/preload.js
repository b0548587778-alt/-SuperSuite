// מודול האימונים בתוך הסרגל האחיד. המודול הוא חבילה מהודרת בלי API, ולכן ה-preload עובד מול ה-DOM:
// - trainer:goto (מ-main.js, עם הטקסט של הכפתור) — לחיצה על הכפתור המתאים בסרגל הפנימי;
// - דיווח המסך הפעיל (shell:trainer-view) — כדי שהסרגל האחיד יסמן אותו גם כשעוברים מסך מתוך המודול;
// - הסתרת הסרגל הפנימי — הניווט כולו בסרגל האחיד (כמו embedded=1 במודול הכלכלי).
// אין חשיפה לעמוד (contextBridge) — המודול לא מקבל שום יכולת חדשה.
const { ipcRenderer } = require('electron');

// הכפתור הפעיל מסומן במחלקה הזו בחבילה המהודרת
const ACTIVE_CLASS = 'bg-indigo-500/15';

// הטקסט של כפתור בלי האייקון שלפניו ("🥗תזונה" ← "תזונה")
function labelOf(btn) {
  return btn.textContent.replace(/^[^֐-׿]+/, '').trim();
}
function navButtons() {
  return [...document.querySelectorAll('aside button')].filter(b => labelOf(b));
}

let pending = null;
function tryGo() {
  if (!pending) return;
  const btn = navButtons().find(b => labelOf(b) === pending);
  if (btn) { pending = null; btn.click(); }
}

let reported = null;
function report() {
  const btn = navButtons().find(b => String(b.className).split(/\s+/).includes(ACTIVE_CLASS));
  const label = btn ? labelOf(btn) : null;
  if (label && label !== reported) {
    reported = label;
    ipcRenderer.invoke('shell:trainer-view', label).catch(() => {});
  }
}

// הבקשה נשמרת עד שהסרגל הפנימי קיים (למשל אחרי מסך ההגדרה הראשונית)
ipcRenderer.on('trainer:goto', (_e, label) => {
  pending = typeof label === 'string' ? label : null;
  tryGo();
});

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = 'aside{display:none !important}';
  document.head.appendChild(style);
  new MutationObserver(() => { tryGo(); report(); })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  tryGo();
  report();
});
