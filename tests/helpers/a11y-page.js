// סקריפטים שרצים בתוך העמוד בבדיקות הנגישות בדפדפן (r4-a11y-shell-browser):
//   shellMock(opts) — window.shellAPI מדומה למעטפת (מחזיק את הגדרות התצוגה בזיכרון, ומציב data-ss-* כמו display-preload)
//   AUDIT — window.__a11yAudit(root): בדיקות כלליות על מה שגלוי כרגע במסך
'use strict';

// baseSeen: ההודעה החד-פעמית "המסך התחדש" כבר הוצגה (ברירת מחדל — כדי שלא תכסה את המסך בבדיקות אחרות)
function shellMock({ display = {}, admin = true, licensed = true, asked = true, baseSeen = true } = {}) {
  return `(() => {
  ${baseSeen ? "try { localStorage.setItem('suite.simpleBaseSeen', 'ok'); } catch {}" : "try { localStorage.removeItem('suite.simpleBaseSeen'); } catch {}"}
  ${asked ? "try { localStorage.setItem('suite.a11yAsked', '1'); } catch {}" : "try { localStorage.removeItem('suite.a11yAsked'); } catch {}"}
  window.__calls = { open: [], overlay: [], saveDisplay: [], goHome: 0, backup: 0 };
  let disp = ${JSON.stringify(display)};
  const applyAttrs = () => { if (window.SUITE_DISPLAY) window.SUITE_DISPLAY.applyTo(document, window.SUITE_DISPLAY.attrsFor(disp, false)); };
  document.addEventListener('DOMContentLoaded', applyAttrs);
  const noop = async () => null;
  window.shellAPI = {
    switchTo: async () => true,
    open: async (id, view) => { __calls.open.push([id, view]); return true; },
    setOverlay: async (on) => { __calls.overlay.push(on); return true; },
    getCatalogExtras: async () => [],
    getCalendar: async () => ({ shabbatMode: false }),
    saveCalendar: async (s) => s,
    getDisplay: async () => disp,
    saveDisplay: async (s) => { __calls.saveDisplay.push(s); disp = window.SUITE_DISPLAY.sanitize(s); applyAttrs(); return disp; },
    onActiveView: () => {},
    backupAll: async () => { __calls.backup++; return { ok: false }; },
    restoreAll: async () => ({ ok: false }),
    isLoggedIn: async () => true,
    isAdmin: async () => ${admin ? 'true' : 'false'},
    getBackupTarget: async () => '/backups',
    getBackupStatus: noop,
    getHomeSummary: noop,
    aiAsk: noop,
    getRecoveryCode: noop, recoveryCodeSaved: noop, plainBackups: noop, plainBackupEncrypt: noop, plainBackupDelete: noop,
    pickBackupTarget: noop,
    goHome: async () => { __calls.goHome++; },
    historyGo: noop, onHistory: () => {}, quit: noop, saveCrashReport: noop,
    getAbout: async () => ({ version: '0', license: '', eula: '', notices: '' }),
    openUserGuide: noop, saveUserGuidePdf: noop,
    onActive: (cb) => { window.__emitActive = cb; },
    onCmd: (cb) => { window.__emitCmd = cb; },
    getLicenseState: async () => (${licensed ? "{ level: 'ok', message: '', modules: {} }" : "{ level: 'ok', message: 'אינו כלול ברישיון', modules: { shamai: false, econ: true, tools: true } }"}),
    onLicense: () => {}, onSession: () => {},
    sync: { status: noop, onChanged: () => {} },
  };
})();`;
}

// בדיקות כלליות לכל מה שגלוי: שם נגיש לפקדים, גודל מטרה, גלילה אופקית, כותרות, אזורים
const AUDIT = `window.__a11yAudit = function (root, opts) {
  root = root || document;
  opts = opts || {};
  const minTarget = opts.minTarget || 24;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[inert]'); };
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) return l.textContent.trim(); }
    const wrap = el.closest('label'); if (wrap) return wrap.textContent.trim();
    if (el.tagName === 'INPUT' && el.placeholder) return '';
    if (el.title && el.tagName !== 'INPUT') return el.title.trim();
    return (el.textContent || el.value || '').trim();
  };
  const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')].filter(visible);
  const unnamed = ctl.filter(el => !nameOf(el)).map(el => el.outerHTML.slice(0, 120));
  // 2.5.8 (AA): 24×24 לפחות, חוץ מקישור בתוך שורת טקסט
  const small = ctl.filter(el => { if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
    // תיבת סימון / רדיו עם תווית: התווית היא חלק מהמטרה (לחיצה עליה מסמנת) — 20 לפחות לתיבה עצמה
    if (el.matches('input[type=checkbox], input[type=radio]') && (el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')))) {
      const r = el.getBoundingClientRect();
      if (r.width >= 19.5 && r.height >= 19.5) return false;
      const lb = el.closest('label');
      return !(lb && lb.getBoundingClientRect().height >= minTarget);
    }
    const r = el.getBoundingClientRect(); return r.width < minTarget - 0.5 || r.height < minTarget - 0.5; })
    .map(el => { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + el.outerHTML.slice(0, 100); });
  const hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  const imgs = [...root.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).map(i => i.outerHTML.slice(0, 80));
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  const dupIds = Object.keys(ids).filter(k => ids[k] > 1);
  return { unnamed, small, hScroll, imgs, dupIds, count: ctl.length };
};`;

module.exports = { shellMock, AUDIT };
