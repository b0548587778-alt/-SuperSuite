// זמן ריצה לכל מודול (iframe) בגרסת אנדרואיד. נטען ראשון ב-<head> של המודול, לפני ה-preload והקוד שלו.
// תפקידים:
//  1. ipcRenderer מדומה: invoke/on עוברים ב-postMessage למעטפת (חלון האב) בלבד, עם אימות origin.
//  2. הדפסה: window.print שולח צילום HTML של המסמך למעטפת, והיא פותחת את מסך ההדפסה של אנדרואיד.
//  3. הורדות: קישור download עם blob/data נשמר דרך בוחר הקבצים של אנדרואיד (WebView לא מוריד blob).
//  4. Service Worker כבוי: הקבצים כבר מקומיים, ו-SW מעל מארח מיורט לא עובד באנדרואיד.
//  5. קריאה בלבד בשמאות (רישיון, כניסה והרשאת עריכה): כתיבה ל-localStorage נחסמת (write-block).
//  6. פעילות בשמאות מאריכה את הכניסה למערכת (activity).
//  7. הגדרות התצוגה והנגישות (data-ss-* על <html>, כמו display-preload.js במחשב) ובועות העזרה (ss-help.js).
(function () {
  'use strict';
  if (window.parent === window) return; // לא בתוך המעטפת
  const SHELL_ORIGIN = location.protocol + '//' + location.host.replace(/^[a-z]+\./, 'shell.');
  const post = msg => window.parent.postMessage(msg, SHELL_ORIGIN);

  let seq = 0;
  const pending = new Map();
  const listeners = new Map();

  const ipcRenderer = {
    invoke(channel, ...args) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ ss: 'invoke', id, channel, args });
      });
    },
    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(cb);
      return ipcRenderer;
    },
    send(channel, ...args) { post({ ss: 'invoke', id: 0, channel, args }); }
  };
  const contextBridge = { exposeInMainWorld(key, api) { Object.defineProperty(window, key, { value: Object.freeze(api), configurable: false }); } };
  window.__ssElectron = { ipcRenderer, contextBridge };

  /* ---------- קריאה בלבד (שמאות) ---------- */
  // כמו secureWriteBlock ב-main.js: בלי כניסה פעילה, תפקיד בלי הרשאת עריכה (צופה / רואה חשבון), סוף תקופת ניסיון,
  // ממתין לתשלום, מושעה או מודול שאינו ברישיון —
  // כתיבה ל-localStorage זורקת SecurityError עם ההודעה מהמעטפת, והנתונים לא משתנים. המצב מגיע בכתובת ה-iframe
  // (ss-ro, ביצירה) ובהודעת write-block (בכל שינוי ובכל טעינה), ונשמר ב-sessionStorage — כך טעינה מחדש של
  // המודול לא מתחילה ממצב ישן. השחזור מהמעטפת (ls-restore) עוקף את החסימה, כמו בשולחן העבודה (כותב ישירות למחסן)
  const GUARDED = /^shamai\./.test(location.host);
  const RO_KEY = 'ss-write-block';
  let writeBlock = null;
  let restoring = false;
  function setWriteBlock(message) {
    writeBlock = typeof message === 'string' && message ? message : null;
    try { window.sessionStorage.setItem(RO_KEY, writeBlock || ''); } catch { /* בלי sessionStorage — רק בזיכרון */ }
  }
  if (GUARDED) {
    let saved = null;
    try { saved = window.sessionStorage.getItem(RO_KEY); } catch { saved = null; }
    writeBlock = saved !== null ? (saved || null) : (new URLSearchParams(location.search || '').get('ss-ro') || null);
    let LS = null;
    try { LS = window.localStorage; } catch { LS = null; } // אין אחסון בכלל — אין גם מה לחסום, ושאר frame.js ממשיך
    const proto = LS && Object.getPrototypeOf(LS);
    // על אב-הטיפוס (Storage.prototype): השמה ל-localStorage.setItem הייתה נשמרת כפריט ולא מחליפה את הפעולה.
    // sessionStorage חולק את אב-הטיפוס — נבדק לפי this
    if (proto) {
      for (const op of ['setItem', 'removeItem', 'clear']) {
        const raw = proto[op];
        proto[op] = function (...args) {
          if (this === LS && writeBlock && !restoring) throw new DOMException(writeBlock, 'SecurityError');
          return raw.apply(this, args);
        };
      }
    }
  }

  /* ---------- פעילות בשמאות ---------- */
  // כמו touchActivity ב-main.js: לחיצה, מקש, מגע וגלילה מאריכים את הכניסה למערכת (main-android.js) — אחרת הניתוק
  // האוטומטי היה חוסם את הכתיבה ומוציא למסך הכניסה באמצע עבודה. נשלח רק "הייתה פעילות", בלי פרטים, ולכל היותר פעם ב-2 שניות.
  // במסגרת הלכידה (capture) של window — נקלט לפני כל מאזין של המודול
  if (GUARDED) {
    const ACTIVITY_MS = 2000;
    let lastActivity = 0;
    const activity = () => {
      const t = Date.now();
      if (t - lastActivity < ACTIVITY_MS) return;
      lastActivity = t;
      post({ ss: 'activity' });
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) window.addEventListener(type, activity, { capture: true, passive: true });
  }

  const handlers = {
    reply(m) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
    },
    send(m) { for (const cb of listeners.get(m.channel) || []) { try { cb({}, ...m.args); } catch (e) { console.error(e); } } },
    // גיבוי/שחזור: המעטפת קוראת וכותבת את ה-localStorage של המודול (כמו executeJavaScript בשולחן העבודה)
    'ls-dump'(m) { post({ ss: 'ls', id: m.id, data: Object.fromEntries(Object.entries(localStorage)) }); },
    // כשל (למשל אין מקום) חוזר כשגיאה מיד — ולא נתקע עד שתם הזמן. quota = אין מקום באחסון של המכשיר:
    // המעטפת מחזירה את הנתונים הקודמים של המודול וממשיכה בשאר השחזור (main-android.js — applyRestore)
    'ls-restore'(m) {
      restoring = true;
      try {
        localStorage.clear();
        for (const k of Object.keys(m.data)) localStorage.setItem(k, m.data[k]);
        post({ ss: 'ls', id: m.id, data: true });
      } catch (e) {
        const quota = !!e && (e.name === 'QuotaExceededError' || e.code === 22);
        post({ ss: 'ls', id: m.id, data: { error: String((e && e.message) || e), quota } });
      } finally { restoring = false; }
    },
    // קריאה בלבד לפי הרישיון (main-android.js — syncWriteBlocks): הודעה בעברית או null
    'write-block'(m) { if (GUARDED) setWriteBlock(m.message); },
    // הגדרות התצוגה והנגישות (main-android.js — broadcastDisplay): רק data-ss-* עם ערך פשוט
    display(m) { applyDisplay(m.attrs); },
    reload() { location.reload(); }
  };
  window.addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== SHELL_ORIGIN) return;
    const m = e.data;
    if (m && typeof m.ss === 'string' && Object.prototype.hasOwnProperty.call(handlers, m.ss)) handlers[m.ss](m);
  });

  /* ---------- Service Worker ---------- */
  if (navigator.serviceWorker) {
    try {
      Object.defineProperty(navigator.serviceWorker, 'register', { value: () => new Promise(() => {}), configurable: true });
    } catch { /* אין מה לעשות — SW פשוט ייכשל */ }
  }

  /* ---------- הדפסה ---------- */
  // צילום המסמך: ערכי שדות נכתבים כמאפיינים, קנבס (למשל חתימה) הופך לתמונה, סקריפטים מוסרים
  function snapshotHtml() {
    const live = document.documentElement;
    const clone = live.cloneNode(true);
    const liveCanvases = live.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((c, i) => {
      const src = liveCanvases[i];
      if (!src) return;
      const img = document.createElement('img');
      try { img.src = src.toDataURL('image/png'); } catch { return; }
      img.style.cssText = src.style.cssText;
      img.width = src.width; img.height = src.height;
      img.className = src.className;
      c.replaceWith(img);
    });
    const liveFields = live.querySelectorAll('input,textarea,select');
    clone.querySelectorAll('input,textarea,select').forEach((f, i) => {
      const src = liveFields[i];
      if (!src) return;
      if (f.tagName === 'TEXTAREA') f.textContent = src.value;
      else if (f.tagName === 'SELECT') Array.from(f.options).forEach((o, j) => { if (src.options[j] && src.options[j].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
      else if (f.type === 'checkbox' || f.type === 'radio') { if (src.checked) f.setAttribute('checked', ''); else f.removeAttribute('checked'); }
      else f.setAttribute('value', src.value);
    });
    clone.querySelectorAll('script').forEach(s => s.remove());
    return '<!doctype html>\n' + clone.outerHTML;
  }
  window.print = function () {
    window.dispatchEvent(new Event('beforeprint'));
    let html;
    try { html = snapshotHtml(); } finally { setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0); }
    post({ ss: 'print', html, base: location.href });
  };

  /* ---------- הורדות ---------- */
  const blobs = new Map();
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const u = origCreate(obj);
    if (obj instanceof Blob) blobs.set(u, obj);
    return u;
  };
  // כתובת data: ← Blob, בלי קריאה ל-fetch — ה-CSP של המודולים חוסם אותה, ובאנדרואיד אין פנייה לרשת מהעמוד
  function dataUrlBlob(href) {
    const comma = href.indexOf(',');
    if (comma < 0) return null;
    const meta = href.slice(5, comma);
    const payload = href.slice(comma + 1);
    const b64 = /;base64$/i.test(meta);
    const type = meta.replace(/;base64$/i, '').split(';')[0] || 'text/plain';
    let bytes;
    if (b64) {
      const bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return new Blob([bytes], { type });
  }
  async function saveAnchor(a) {
    const href = a.href;
    let blob = blobs.get(href);
    if (!blob && href.startsWith('data:')) blob = dataUrlBlob(href);
    if (!blob) return false;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    post({ ss: 'save', name: a.getAttribute('download') || 'file', mime: blob.type || 'application/octet-stream', b64: btoa(bin) });
    return true;
  }
  const isDownload = a => a && a.hasAttribute('download') && /^(blob|data):/.test(a.href || '');
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { saveAnchor(this).catch(e => console.error('save failed', e)); return; }
    return origClick.call(this);
  };
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (isDownload(a)) { e.preventDefault(); saveAnchor(a).catch(err => console.error('save failed', err)); }
  }, true);

  window.addEventListener('load', () => post({ ss: 'ready' }));

  /* ---------- תצוגה ונגישות (סבב 4) ---------- */
  // כמו display-preload.js במחשב: המאפיינים מגיעים מהמעטפת (הודעת display, בכל טעינה ובכל שינוי) ונשמרים
  // ב-sessionStorage, כדי שטעינה מחדש של המודול תתחיל מיד במצב הנכון (למשל מצב פשוט וטקסט גדול)
  const DISPLAY_KEY = 'ss-display';
  function applyDisplay(attrs, keep) {
    if (!attrs || typeof attrs !== 'object') return;
    const el = document.documentElement;
    if (!el || typeof el.setAttribute !== 'function') return;
    for (const [k, v] of Object.entries(attrs)) {
      if (/^data-ss-[a-z]+$/.test(k) && typeof v === 'string' && /^[a-z]+$/.test(v)) el.setAttribute(k, v);
    }
    if (keep !== false) { try { window.sessionStorage.setItem(DISPLAY_KEY, JSON.stringify(attrs)); } catch { /* רק בזיכרון */ } }
  }
  try { applyDisplay(JSON.parse(window.sessionStorage.getItem(DISPLAY_KEY) || 'null'), false); } catch { /* אין מצב שמור */ }
  // בועות העזרה "?" (data-ss-help) — אותו קובץ כמו במחשב, מועתק לכל מודול בבנייה (android/build-apk.js)
  function addHelp() {
    if (!document.head || typeof document.querySelector !== 'function' || document.querySelector('script[data-ss-help-loader]')) return;
    const s = document.createElement('script');
    s.src = '/ss-help.js';
    s.setAttribute('data-ss-help-loader', '');
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', addHelp);
  else addHelp();
})();
