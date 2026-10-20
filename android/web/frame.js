// זמן ריצה לכל מודול (iframe) בגרסת אנדרואיד. נטען ראשון ב-<head> של המודול, לפני ה-preload והקוד שלו.
// תפקידים:
//  1. ipcRenderer מדומה: invoke/on עוברים ב-postMessage למעטפת (חלון האב) בלבד, עם אימות origin.
//  2. הדפסה: window.print שולח צילום HTML של המסמך למעטפת, והיא פותחת את מסך ההדפסה של אנדרואיד.
//  3. הורדות: קישור download עם blob/data נשמר דרך בוחר הקבצים של אנדרואיד (WebView לא מוריד blob).
//  4. Service Worker כבוי: הקבצים כבר מקומיים, ו-SW מעל מארח מיורט לא עובד באנדרואיד.
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
    // כשל (למשל אין מקום) חוזר כשגיאה מיד — ולא נתקע עד שתם הזמן
    'ls-restore'(m) {
      try {
        localStorage.clear();
        for (const k of Object.keys(m.data)) localStorage.setItem(k, m.data[k]);
        post({ ss: 'ls', id: m.id, data: true });
      } catch (e) {
        post({ ss: 'ls', id: m.id, data: { error: String((e && e.message) || e) } });
      }
    },
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
  async function saveAnchor(a) {
    const href = a.href;
    let blob = blobs.get(href);
    if (!blob && href.startsWith('data:')) blob = await (await fetch(href)).blob();
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
})();
