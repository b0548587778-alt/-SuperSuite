// localStorage מוצפן לשמאות ולאימונים (PLAN.md 3.2). נרשם לכל ה-session (session.registerPreloadScript)
// ופועל רק במודולים האלה. רץ לפני קוד העמוד:
// 1. מקבל מהתהליך הראשי את הנתונים המפוענחים;
// 2. בפעם הראשונה — מעביר את ה-localStorage הגלוי הישן לתהליך הראשי, ומוחק אותו אחרי שנשמר מוצפן;
// 3. מחליף את window.localStorage בעמוד בעותק בזיכרון, שכל שינוי בו נשלח לכתיבה מוצפנת.
// אין חשיפה של אובייקט חדש לעמוד: פונקציית השליחה עוברת כארגומנט ל-executeInMainWorld בלבד.
const { contextBridge, ipcRenderer } = require('electron');

const MOD = { 'shamai': 'shamai', 'trainer': 'trainer' }[location.protocol === 'app:' ? location.host : ''];

if (MOD && window === window.top) {
  let init = null;
  try { init = ipcRenderer.sendSync('secure-store:load', MOD); } catch { init = null; }
  if (init && init.state !== 'plain') {
    if (init.state === 'encrypted' && !init.migrated) {
      // כאן (בעולם המבודד) localStorage הוא עדיין האחסון האמיתי של הדפדפן
      const items = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        items[k] = localStorage.getItem(k);
      }
      let r = null;
      try { r = ipcRenderer.sendSync('secure-store:migrate', MOD, items); } catch { r = null; }
      if (r && r.ok) {
        localStorage.clear();
        init = ipcRenderer.sendSync('secure-store:load', MOD);
      } else {
        // ההעברה נכשלה (למשל הגיבוי שלפניה): ממשיכים עם האחסון הישן, וננסה שוב בפתיחה הבאה
        init = null;
      }
    }
    if (init) {
      const send = (op, k, v) => ipcRenderer.send('secure-store:write', MOD, op, k, v);
      contextBridge.executeInMainWorld({
        func: (data, readOnly, send) => {
          const m = new Map(Object.entries(data));
          const str = (x) => String(x);
          const api = {
            getItem: (k) => (m.has(str(k)) ? m.get(str(k)) : null),
            setItem: (k, v) => { if (readOnly) return; m.set(str(k), str(v)); send('set', str(k), str(v)); },
            removeItem: (k) => { if (readOnly || !m.has(str(k))) return; m.delete(str(k)); send('remove', str(k)); },
            clear: () => { if (readOnly) return; m.clear(); send('clear'); },
            key: (i) => { const keys = [...m.keys()]; return i >= 0 && i < keys.length ? keys[i] : null; },
            get length() { return m.size; }
          };
          const ls = new Proxy(api, {
            get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && m.has(k) ? m.get(k) : undefined)),
            set: (o, k, v) => { if (typeof k === 'string') api.setItem(k, v); return true; },
            has: (o, k) => k in o || (typeof k === 'string' && m.has(k)),
            deleteProperty: (o, k) => { if (typeof k === 'string') api.removeItem(k); return true; },
            ownKeys: () => [...m.keys()],
            getOwnPropertyDescriptor: (o, k) => (typeof k === 'string' && m.has(k) ? { value: m.get(k), enumerable: true, configurable: true, writable: true } : undefined)
          });
          Object.defineProperty(window, 'localStorage', { value: ls, configurable: false, enumerable: true });
        },
        args: [init.data || {}, init.state !== 'encrypted', send]
      });
    }
  }
}
