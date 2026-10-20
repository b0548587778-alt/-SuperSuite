// הגדרות תצוגה (PLAN.md 7.4) — נרשם לכל ה-session (session.registerPreloadScript) ופועל במעטפת ובכל מודול (app://).
// מקבל מהתהליך הראשי את מאפייני data-ss-* (ערכה, הדגשה, צפיפות, טקסט, פינות, ניגודיות, תנועה) ומציב אותם על <html>;
// העיצוב עצמו ב-design-tokens.css. שינוי בחלון "תצוגה" מגיע באירוע display:changed — בלי טעינה מחדש.
// לעמוד נחשפת פעולה אחת בלבד: ssDisplay.setTheme('light' | 'dark') (כפתור הערכה בשמאות).
const { contextBridge, ipcRenderer } = require('electron');

const OURS = location.protocol === 'app:' || (location.protocol === 'file:' && /\/shell\/shell\.html$/.test(location.pathname));

if (OURS && window === window.top) {
  let attrs = null;
  const apply = () => {
    const el = document.documentElement;
    if (!el || !attrs || typeof attrs !== 'object') return;
    for (const [k, v] of Object.entries(attrs)) {
      if (/^data-ss-[a-z]+$/.test(k) && typeof v === 'string' && /^[a-z]+$/.test(v) && el.getAttribute(k) !== v) el.setAttribute(k, v);
    }
  };
  try { attrs = ipcRenderer.sendSync('display:get'); } catch { attrs = null; }
  apply();
  // בזמן ה-preload ייתכן שעדיין אין <html> — מציבים שוב ברגע שהוא נוצר
  document.addEventListener('readystatechange', apply);
  document.addEventListener('DOMContentLoaded', apply);
  ipcRenderer.on('display:changed', (e, next) => { attrs = next; apply(); });
  try {
    contextBridge.exposeInMainWorld('ssDisplay', {
      setTheme: (theme) => ipcRenderer.invoke('display:set-theme', theme === 'dark' ? 'dark' : 'light'),
    });
  } catch { /* העמוד בלי בידוד הקשר — אין חשיפה */ }
}
