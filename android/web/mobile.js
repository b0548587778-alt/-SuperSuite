// מעטפת לטלפון: פס עליון עם כפתור תפריט, מגירה לסרגל, וכפתור "אחורה" של אנדרואיד.
// נטען אחרי shell.js. לא משנה את הלוגיקה של המעטפת — רק את האינטראקציה.
(function () {
  'use strict';
  const api = window.shellAPI;
  const top = document.createElement('div');
  top.className = 'ss-top';
  top.innerHTML = '<button id="ssMenu" type="button" aria-label="תפריט">☰</button><b id="ssTitle">SuperSuite</b>';
  const scrim = document.createElement('div');
  scrim.className = 'ss-scrim';
  document.body.prepend(scrim);
  document.body.prepend(top);

  // כפתורים של אפשרויות שאין להן מקבילה באנדרואיד (main-android.js — NOT_ON_ANDROID): לא מציגים כפתור שלא עושה כלום
  for (const id of ['ds', 'crashReportBtn', 'userGuideBtn', 'userGuidePdfBtn']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  const drawer = on => document.body.classList.toggle('ss-drawer', on);
  const isOpen = () => document.body.classList.contains('ss-drawer');
  document.getElementById('ssMenu').onclick = () => drawer(!isOpen());
  scrim.onclick = () => drawer(false);
  // בחירה בסרגל סוגרת את המגירה (פריט, בית, גיבוי וכו')
  document.querySelector('.side').addEventListener('click', e => {
    if (e.target.closest('.it, .tools button, .hd')) setTimeout(() => drawer(false), 0);
  });
  // שם המסך הנוכחי בפס העליון — מתוך "איפה אני" של המעטפת
  const where = document.getElementById('navWhere');
  const title = document.getElementById('ssTitle');
  const syncTitle = () => { title.textContent = (where && where.textContent) || 'SuperSuite'; };
  if (where) new MutationObserver(syncTitle).observe(where, { childList: true, characterData: true, subtree: true });

  let hist = { canBack: false };
  let active = null;
  if (api.onHistory) api.onHistory(st => { hist = st || hist; });
  api.onActive(id => { active = id; syncTitle(); });

  // כפתור "אחורה" של המכשיר: מגירה ← דיאלוג פתוח ← היסטוריה ← מסך הבית. false = לצאת מהאפליקציה
  window.__ssBack = function () {
    if (isOpen()) { drawer(false); return true; }
    const dlg = document.querySelector('dialog[open]');
    // כמו Esc: אירוע cancel, כדי שהמעטפת תחזיר את המודול לתצוגה (closeDialog)
    if (dlg) { if (dlg.dispatchEvent(new Event('cancel', { cancelable: true }))) { dlg.close(); api.setOverlay(false); } return true; }
    if (hist.canBack) { api.historyGo(-1); return true; }
    if (active) { document.getElementById('hm').click(); return true; }
    return false;
  };
})();
