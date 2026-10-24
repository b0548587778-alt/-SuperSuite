// זמן הריצה של חלון המעטפת בגרסת אנדרואיד. מחליף את התהליך הראשי של Electron:
//  - ipcMain מדומה: ערוצי המודול הכלכלי (ipc.js המקורי) וערוצי המעטפת (main-android.js) במאגר אחד.
//  - כל מודול הוא iframe ב-origin נפרד; זהות השולח נקבעת לפי event.source ולא לפי מה שההודעה טוענת.
//  - הגשר ל-Java (SuperSuiteBridge) דורש אסימון שנמסר רק לחלון הראשי — iframe של מודול לא יכול לגשת למסד.
(function () {
  'use strict';
  const BRIDGE = window.SuperSuiteBridge;
  const SUFFIX = location.host.replace(/^shell\./, '');
  const originOf = id => location.protocol + '//' + id + '.' + SUFFIX;
  const SHELL_ID = 1;
  const SENDER = { econ: 2, shamai: 3, trainer: 4, tools: 5 };
  const info = window.__ssBuildInfo || {};

  function fatal(msg) {
    document.addEventListener('DOMContentLoaded', () => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f1a30;color:#fff;padding:24px;font:16px sans-serif;direction:rtl';
      d.textContent = msg;
      document.body.appendChild(d);
    });
  }
  if (!BRIDGE) { fatal('שגיאה: הגשר לאנדרואיד לא נמצא. יש להפעיל את האפליקציה מתוך ה-APK.'); }

  /* ---------- הגשר ---------- */
  let token = null;
  let tokenResolve;
  const tokenReady = new Promise(r => { tokenResolve = r; });
  window.__ssSetToken = t => { if (!token && typeof t === 'string') { token = t; tokenResolve(); } };
  const SYNC = ['randomBytes', 'scrypt', 'aesGcm', 'dbOpen', 'dbExec', 'dbRun', 'dbAll', 'writeUri', 'printHtml', 'exit',
    'treeExists', 'treeMkdirs', 'treeWrite'];
  const raw = {};
  for (const m of SYNC) raw[m] = (...a) => BRIDGE[m](token, ...a);
  const shims = createNodeShims(raw);

  let cbSeq = 0;
  const cbPending = new Map();
  window.__ssAndroidCb = (id, json) => {
    const p = cbPending.get(id);
    if (!p) return;
    cbPending.delete(id);
    try { p(JSON.parse(json)); } catch { p(null); }
  };
  // פעולה אסינכרונית ב-Java (בוחר קבצים): התוצאה חוזרת ב-__ssAndroidCb
  function bridgeAsync(method, ...args) {
    const id = ++cbSeq;
    return new Promise((resolve, reject) => {
      cbPending.set(id, resolve);
      const out = JSON.parse(BRIDGE[method](token, id, ...args));
      if (out && out.e) { cbPending.delete(id); reject(new Error(out.e)); }
    });
  }

  /* ---------- ipcMain ---------- */
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); }, on() {} };
  let ready = null;
  async function invoke(senderId, channel, args) {
    await ready;
    const fn = handlers.get(channel);
    // ערוץ שאין לו מקבילה באנדרואיד — הודעה בעברית (ולא השגיאה הגולמית של Electron באנגלית)
    if (!fn) throw new Error(`Error invoking remote method '${channel}': Error: הפעולה אינה זמינה בגרסת אנדרואיד`);
    try {
      return await fn({ sender: { id: senderId } }, ...args);
    } catch (e) {
      // כמו Electron: הודעת השגיאה מגיעה לממשק עם הקידומת הזו (הממשק יודע להסיר אותה)
      throw new Error(`Error invoking remote method '${channel}': Error: ${(e && e.message) || e}`);
    }
  }

  /* ---------- דיאלוגים וחלון PDF למודול הכלכלי (node-shims.js) ---------- */
  const electronMain = Object.assign({ ipcMain }, createElectronShims(shims, { bridgeAsync, alert: m => window.alert(m) }));

  /* ---------- מודולים (iframes) ---------- */
  const frames = {};
  let lsSeq = 0;
  const lsPending = new Map();
  // קריאה בלבד לפי הרישיון בשמאות ובאימונים (main-android.js — syncWriteBlocks; האכיפה ב-frame.js): ההודעה לכל מודול
  // עוברת בכתובת ה-iframe ביצירה (ss-ro) — כך היא בתוקף כבר בטעינה — ונשלחת למסגרת בכל שינוי ובכל טעינה
  const writeBlocks = {};
  const withWriteBlock = (id, entry) => (writeBlocks[id] ? entry + (entry.includes('?') ? '&' : '?') + 'ss-ro=' + encodeURIComponent(writeBlocks[id]) : entry);
  const postWriteBlock = id => {
    if (frames[id] && Object.prototype.hasOwnProperty.call(writeBlocks, id)) frames[id].el.contentWindow.postMessage({ ss: 'write-block', message: writeBlocks[id] }, originOf(id));
  };
  // פעילות במודול (frame.js — רק "הייתה פעילות", לכל היותר פעם בכמה שניות): main-android.js מאריך בה את הכניסה
  const activityListeners = [];
  const frameApi = {
    onActivity(fn) { if (typeof fn === 'function') activityListeners.push(fn); },
    exists: id => !!frames[id],
    ensure(id, entry) {
      if (frames[id]) return frames[id];
      const el = document.createElement('iframe');
      el.className = 'ss-frame';
      el.title = id;
      el.hidden = true;
      el.setAttribute('allow', 'clipboard-read; clipboard-write');
      const f = { el, loaded: false, waiters: [] };
      frames[id] = f;
      el.src = originOf(id) + withWriteBlock(id, entry);
      (document.getElementById('ssFrames') || document.body).appendChild(el);
      return f;
    },
    setVisible(id, on) { if (frames[id]) frames[id].el.hidden = !on; },
    // message — הודעה בעברית (כתיבה נחסמת) או null (מותר)
    setWriteBlock(id, message) {
      writeBlocks[id] = typeof message === 'string' && message ? message : null;
      postWriteBlock(id);
    },
    whenReady(id) {
      const f = frames[id];
      if (!f) return Promise.reject(new Error('no frame ' + id));
      return f.loaded ? Promise.resolve() : new Promise(r => f.waiters.push(r));
    },
    send(id, channel, ...args) {
      const f = frames[id];
      if (f) f.el.contentWindow.postMessage({ ss: 'send', channel, args }, originOf(id));
    },
    async request(id, type, data) {
      await frameApi.whenReady(id);
      const rid = ++lsSeq;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { lsPending.delete(rid); reject(new Error('timeout')); }, 15000);
        // התשובה מתקבלת רק מהמסגרת שנשאלה — מודול אחר לא יכול לזייף נתוני גיבוי של מודול אחר
        lsPending.set(rid, { id, done: v => { clearTimeout(t); resolve(v); } });
        frames[id].el.contentWindow.postMessage({ ss: type, id: rid, data }, originOf(id));
      });
    },
    reloadAll() {
      for (const id of Object.keys(frames)) {
        frames[id].loaded = false;
        frames[id].el.contentWindow.postMessage({ ss: 'reload' }, originOf(id));
      }
    },
    moduleSenderIds: () => Object.keys(frames).map(id => SENDER[id])
  };

  window.addEventListener('message', e => {
    const id = Object.keys(frames).find(k => frames[k].el.contentWindow === e.source);
    if (!id || e.origin !== originOf(id)) return; // רק iframe מוכר מה-origin שלו
    const m = e.data;
    if (!m || typeof m.ss !== 'string') return;
    const f = frames[id];
    // בכל טעינה (גם טעינה מחדש של המודול עצמו) — מצב הכתיבה העדכני
    if (m.ss === 'ready') { f.loaded = true; postWriteBlock(id); f.waiters.splice(0).forEach(r => r()); return; }
    if (m.ss === 'ls') { const p = lsPending.get(m.id); if (p && p.id === id) { lsPending.delete(m.id); p.done(m.data); } return; }
    // המודול נקבע לפי event.source — מסגרת לא יכולה לדווח פעילות בשם מודול אחר
    if (m.ss === 'activity') { for (const fn of activityListeners) { try { fn(id); } catch (err) { console.error(err); } } return; }
    if (m.ss === 'invoke') {
      const channel = String(m.channel);
      // כל מודול — רק הערוצים של ה-preload שלו בשולחן העבודה (MA.moduleMayInvoke); שמאות וארגז הכלים — אף ערוץ
      const run = MA.moduleMayInvoke(id, channel)
        ? invoke(SENDER[id], channel, Array.isArray(m.args) ? m.args : [])
        : Promise.reject(new Error(`Error invoking remote method '${channel}': Error: הפעולה אינה מותרת מתוך המודול הזה`));
      run
        .then(value => { if (m.id) e.source.postMessage({ ss: 'reply', id: m.id, ok: true, value }, e.origin); })
        .catch(err => { if (m.id) e.source.postMessage({ ss: 'reply', id: m.id, ok: false, error: String(err.message || err) }, e.origin); });
      return;
    }
    if (m.ss === 'print' && typeof m.html === 'string') {
      tokenReady.then(() => shims.call('printHtml', m.html, originOf(id) + '/')).catch(err => window.alert('ההדפסה נכשלה: ' + err.message));
      return;
    }
    if (m.ss === 'save' && typeof m.b64 === 'string') {
      bridgeAsync('saveBytes', String(m.name || 'file').slice(0, 200), String(m.mime || 'application/octet-stream'), m.b64)
        .catch(err => window.alert('השמירה נכשלה: ' + err.message));
    }
  });

  /* ---------- ipcRenderer של המעטפת עצמה ---------- */
  const shellListeners = new Map();
  const clone = v => (v === undefined ? undefined : structuredClone(v));
  const shellRenderer = {
    invoke: (channel, ...args) => invoke(SHELL_ID, channel, clone(args)).then(clone),
    on(channel, cb) { if (!shellListeners.has(channel)) shellListeners.set(channel, []); shellListeners.get(channel).push(cb); }
  };
  function emitShell(channel, ...args) {
    for (const cb of shellListeners.get(channel) || []) { try { cb({}, ...clone(args)); } catch (err) { console.error(err); } }
  }
  const contextBridge = { exposeInMainWorld(key, api) { window[key] = api; } };

  const req = name => window.__ssHost.require(name, {
    electron: Object.assign({ contextBridge, ipcRenderer: shellRenderer }, electronMain),
    fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url
  });
  window.Buffer = shims.Buffer;

  // window.shellAPI חייב להיות קיים לפני ש-shell.js נטען; הקריאות עצמן ממתינות ל-ready
  req('shell-preload');
  const MA = req('main-android');

  const UI_KEY = 'ss-ui-settings';
  const ui = {
    load() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { return {}; } },
    save(o) { localStorage.setItem(UI_KEY, JSON.stringify(o)); }
  };
  ready = tokenReady.then(async () => {
    const econ = req('econ-ipc');
    // רישוי כמו בשולחן העבודה: החיבור לשרת הרישוי בלבד (relay-fetch.js ← Java), בלי סנכרון בשבת ויום טוב
    await econ.initEcon(shims.DATA_ROOT, MA.econOptions({ ui, bridgeAsync, version: info.version, licenseState: () => econ.licenseState() }));
    MA.start({
      ipcMain, econ, frames: frameApi, emitShell, bridgeAsync, SHELL_ID,
      senderOf: id => SENDER[id],
      econExtras: info.econExtras,
      version: info.version,
      about: info.about,
      ui,
      alert: m => window.alert(m),
      confirm: m => window.confirm(m),
      exit: () => raw.exit()
    });
  });
  ready.catch(err => {
    console.error(err);
    fatal('שגיאה בפתיחת המערכת הכלכלית: ' + ((err && err.message) || err));
  });
})();
