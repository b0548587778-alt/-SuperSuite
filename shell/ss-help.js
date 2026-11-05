// בועות עזרה "?" לכל המסכים (נגישות, סבב 4): כל רכיב עם data-ss-help="הסבר בעברית" מקבל אחריו כפתור "?"
// שפותח בועה עם ההסבר. מקלדת: Enter/רווח פותח וסוגר, Esc סוגר ומחזיר את המיקוד לכפתור. קורא מסך: הכפתור
// מקריא "הסבר: <שם הרכיב>", aria-expanded, והבועה מקושרת אליו (aria-controls) ולרכיב (aria-describedby).
// העיצוב ב-ui-kit.css (.ss-help); הכפתור גלוי בכל מצב, ובמצב פשוט (data-ss-simple="on") — גדול יותר.
// נטען במעטפת (תג), ובכל מודול — ה-preload של התצוגה (במחשב) או frame.js (באנדרואיד) מוסיפים את התג
// <script src="/ss-help.js">, ו-main.js מגיש את הקובץ מ-app://<מודול>/ss-help.js. נטען פעמיים — רץ פעם אחת.
// תוכן חדש בעמוד (מסכים שנבנים בקוד) — נסרק אוטומטית (MutationObserver), או ידנית: ssHelp.scan(root).
(function (root) {
  'use strict';

  const TEXT_MAX = 600;
  let seq = 0;

  // שם קצר לרכיב לטובת הכפתור: aria-label, תווית <label for>, או הטקסט שלו
  function nameOf(el) {
    const doc = el.ownerDocument;
    const a = el.getAttribute('aria-label');
    if (a) return a.trim();
    if (el.id && doc) {
      const l = doc.querySelector('label[for="' + String(el.id).replace(/["\\]/g, '') + '"]');
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const t = (el.textContent || el.placeholder || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 60);
  }

  function make(win) {
    const doc = win.document;
    let openTip = null;

    function close(tip, focusBtn) {
      if (!tip) return;
      tip.hidden = true;
      const btn = tip.__ssBtn;
      if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn && typeof btn.focus === 'function') btn.focus(); }
      if (openTip === tip) openTip = null;
    }
    function toggle(btn, tip) {
      const show = tip.hidden;
      if (openTip && openTip !== tip) close(openTip, false);
      tip.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
      openTip = show ? tip : null;
    }

    // רכיב אחד: מוסיף אחריו <span class="ss-help"> עם כפתור ובועה (פעם אחת; טקסט חדש מעדכן את הבועה הקיימת)
    function enhance(el) {
      const text = String(el.getAttribute('data-ss-help') || '').trim().slice(0, TEXT_MAX);
      if (!text) return null;
      const prev = el.__ssHelp;
      if (prev && prev.wrap.isConnected) { prev.tip.textContent = text; return prev.wrap; }
      const id = 'ss-help-' + (++seq);
      const wrap = doc.createElement('span');
      wrap.className = 'ss-help';
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-help-btn';
      btn.textContent = '?';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', id);
      const nm = nameOf(el);
      btn.setAttribute('aria-label', nm ? 'הסבר: ' + nm : 'הסבר');
      btn.title = 'הסבר';
      const tip = doc.createElement('span');
      tip.className = 'ss-help-tip';
      tip.id = id;
      tip.setAttribute('role', 'note');
      tip.hidden = true;
      tip.textContent = text;
      tip.__ssBtn = btn;
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(btn, tip); });
      wrap.appendChild(btn);
      wrap.appendChild(tip);
      // בתוך <label> או כפתור — הבועה אחרי הרכיב, כדי שלחיצה עליה לא תפעיל אותו
      const host = el.closest && el.closest('label, button, a') ? el.closest('label, button, a') : el;
      host.insertAdjacentElement('afterend', wrap);
      const desc = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (!desc.includes(id)) el.setAttribute('aria-describedby', [...desc, id].join(' '));
      el.__ssHelp = { wrap, tip, btn };
      return wrap;
    }

    function scan(rootEl) {
      const r = rootEl || doc;
      const list = [];
      if (r.nodeType === 1 && r.hasAttribute && r.hasAttribute('data-ss-help')) list.push(r);
      if (r.querySelectorAll) list.push(...r.querySelectorAll('[data-ss-help]'));
      return list.map(enhance).filter(Boolean).length;
    }

    // Esc סוגר את הבועה הפתוחה; לחיצה מחוץ לבועה — גם
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openTip) { e.stopPropagation(); close(openTip, true); }
    }, true);
    doc.addEventListener('click', (e) => {
      if (openTip && !(e.target && e.target.closest && e.target.closest('.ss-help'))) close(openTip, false);
    });

    let observer = null;
    function watch() {
      if (observer || typeof win.MutationObserver !== 'function' || !doc.body) return;
      observer = new win.MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes') { if (m.target.hasAttribute('data-ss-help')) enhance(m.target); continue; }
          for (const n of m.addedNodes) if (n.nodeType === 1 && !(n.classList && n.classList.contains('ss-help'))) scan(n);
        }
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ss-help'] });
    }
    function start() { scan(doc); watch(); }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();

    return { scan, enhance, close: () => close(openTip, false) };
  }

  if (typeof module === 'object' && module.exports) module.exports = { make, nameOf };
  if (root && root.document && !root.ssHelp) root.ssHelp = make(root);
})(typeof window !== 'undefined' ? window : null);
