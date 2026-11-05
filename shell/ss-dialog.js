// חלון הודעה, אישור ושאלה משותף לכל המסכים — במקום alert / confirm / prompt של הדפדפן.
// prompt() אינו נתמך ב-Electron (זורק שגיאה), ו-confirm / alert מציגים חלון אפור של Windows
// שלא נראה כמו התוכנה. כאן: אותו חלון בכל המודולים, בצבעי design-tokens.css.
// נטען בשמאות, בארגז הכלים ובמעטפת (main.js מגיש אותו מ-app://<מודול>/ss-dialog.js; באנדרואיד — עותק בבנייה).
//   await ssDialog.confirm('למחוק?', { danger: true })  → true / false
//   await ssDialog.prompt('בכמה ימים?', '7')            → מחרוזת / null (ביטול)
//   await ssDialog.alert('נשמר')                         → undefined
//   await ssDialog.choose('לייבא?', [{ label, value }])  → value / null
(function (root) {
  'use strict';

  const STYLE_ID = 'ss-dialog-style';
  const FIELD = {}; // ערך כפתור = התוכן של שדה הקלט
  let seq = 0; // מזהים ייחודיים לכותרת ולהודעה (חלון בתוך חלון)
  // צבעים רק משפת העיצוב (tests/ss-dialog.test.js)
  const CSS = [
    '.ss-dlg-back{position:fixed;inset:0;z-index:2147483646;background:var(--ss-overlay);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.ss-dlg{direction:rtl;background:var(--ss-surface);color:var(--ss-text);border:1px solid var(--ss-border);border-radius:var(--ss-radius-lg);box-shadow:var(--ss-shadow-lg);width:min(440px,100%);max-height:100%;overflow:auto;padding:20px 22px;font:calc(var(--ss-fs-md) + 1px)/1.5 var(--ss-font)}',
    '.ss-dlg h2{margin:0 0 8px;font:700 var(--ss-fs-lg) var(--ss-font-title);color:var(--ss-text)}',
    '.ss-dlg p{margin:0 0 14px;white-space:pre-line;color:var(--ss-text-2)}',
    '.ss-dlg input{width:100%;box-sizing:border-box;margin:0 0 14px;padding:9px 11px;font:inherit;color:var(--ss-text);background:var(--ss-surface-input,var(--ss-surface));border:1px solid var(--ss-border-strong);border-radius:var(--ss-radius-sm)}',
    '.ss-dlg .ss-dlg-row{display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap}',
    '.ss-dlg button{font:600 var(--ss-fs-md) var(--ss-font);min-height:max(36px,var(--ss-target-min));padding:8px 18px;border-radius:var(--ss-radius-sm);border:1px solid var(--ss-border-strong);background:var(--ss-surface-2);color:var(--ss-text);cursor:pointer}',
    '.ss-dlg button.ss-ok{background:var(--ss-primary);border-color:var(--ss-primary);color:var(--ss-surface)}',
    '.ss-dlg button.ss-danger{background:var(--ss-danger);border-color:var(--ss-danger);color:var(--ss-surface)}'
  ].join('\n');

  function make(win) {
    const doc = win.document;

    function ensureStyle() {
      if (doc.getElementById(STYLE_ID)) return;
      const s = doc.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(s);
    }

    // buttons: [{ label, value, kind: 'ok' | 'danger' | '' }]; Escape / רקע = cancelValue
    function open({ title, message, input, buttons, cancelValue }) {
      ensureStyle();
      return new Promise(resolve => {
        const back = doc.createElement('div');
        back.className = 'ss-dlg-back';
        const box = doc.createElement('div');
        box.className = 'ss-dlg';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        if (title) {
          const h = doc.createElement('h2');
          h.id = 'ss-dlg-title-' + (++seq);
          h.textContent = title;
          box.setAttribute('aria-labelledby', h.id);
          box.appendChild(h);
        }
        const p = doc.createElement('p');
        p.textContent = String(message == null ? '' : message);
        // ההודעה מוקראת יחד עם הכותרת כשהחלון נפתח (נגישות, סבב 4)
        p.id = 'ss-dlg-msg-' + (++seq);
        box.setAttribute('aria-describedby', p.id);
        box.appendChild(p);
        let field = null;
        if (input) {
          field = doc.createElement('input');
          field.type = input.type || 'text';
          field.value = input.value == null ? '' : String(input.value);
          field.setAttribute('aria-label', String(message || title || ''));
          box.appendChild(field);
        }
        const row = doc.createElement('div');
        row.className = 'ss-dlg-row';
        let done = false;
        const prevFocus = doc.activeElement;
        const finish = v => {
          if (done) return;
          done = true;
          doc.removeEventListener('keydown', onKey, true);
          back.remove();
          if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
          resolve(v);
        };
        let first = null;
        for (const b of buttons) {
          const el = doc.createElement('button');
          el.type = 'button';
          el.textContent = b.label;
          if (b.kind) el.className = 'ss-' + b.kind;
          el.addEventListener('click', () => finish(b.value === FIELD ? (field ? field.value : '') : b.value));
          row.appendChild(el);
          if (!first) first = el;
        }
        box.appendChild(row);
        const onKey = e => {
          if (e.key === 'Escape') { e.preventDefault(); finish(cancelValue); }
          else if (e.key === 'Enter' && field && doc.activeElement === field) { e.preventDefault(); first && first.click(); }
          // מלכודת מיקוד: Tab ו-Shift+Tab נשארים בתוך החלון (נגישות, סבב 4)
          else if (e.key === 'Tab') {
            const list = [...box.querySelectorAll('button, input')];
            if (!list.length) return;
            const i = list.indexOf(doc.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
            else if (!e.shiftKey && (i < 0 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
          }
        };
        doc.addEventListener('keydown', onKey, true);
        back.addEventListener('click', e => { if (e.target === back) finish(cancelValue); });
        back.appendChild(box);
        (doc.body || doc.documentElement).appendChild(back);
        const focusEl = field || first;
        if (focusEl && typeof focusEl.focus === 'function') focusEl.focus();
        if (field && typeof field.select === 'function') field.select();
      });
    }

    return {
      confirm(message, opts = {}) {
        return open({
          title: opts.title || 'אישור', message, cancelValue: false,
          buttons: [
            { label: opts.okText || 'אישור', value: true, kind: opts.danger ? 'danger' : 'ok' },
            { label: opts.cancelText || 'ביטול', value: false }
          ]
        });
      },
      prompt(message, value = '', opts = {}) {
        return open({
          title: opts.title || '', message, input: { value, type: opts.type }, cancelValue: null,
          buttons: [
            { label: opts.okText || 'אישור', value: FIELD, kind: 'ok' },
            { label: 'ביטול', value: null }
          ]
        });
      },
      alert(message, opts = {}) {
        return open({
          title: opts.title || '', message, cancelValue: undefined,
          buttons: [{ label: 'סגור', value: undefined, kind: 'ok' }]
        });
      },
      choose(message, choices, opts = {}) {
        return open({
          title: opts.title || 'בחירה', message, cancelValue: null,
          buttons: [...choices.map((c, i) => ({ label: c.label, value: c.value, kind: c.kind || (i === 0 ? 'ok' : '') })),
            { label: 'ביטול', value: null }]
        });
      }
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { make, CSS };
  if (root && root.document) root.ssDialog = make(root);
})(typeof window !== 'undefined' ? window : null);
