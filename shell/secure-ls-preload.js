// localStorage מוצפן לשמאות ולאימונים (PLAN.md 3.2). נרשם לכל ה-session (session.registerPreloadScript)
// ופועל רק במודולים האלה. רץ לפני קוד העמוד:
// 1. מקבל מהתהליך הראשי את הנתונים המפוענחים;
// 2. בפעם הראשונה — מעביר את ה-localStorage הגלוי הישן לתהליך הראשי, ומוחק אותו אחרי שנשמר מוצפן;
// 3. מחליף את window.localStorage בעמוד בעותק בזיכרון; כל שינוי נשלח לכתיבה מוצפנת ומחכה לאישור —
//    כתיבה שנדחתה זורקת QuotaExceededError (מקום) או SecurityError (כניסה, הרשאה, מחסן), כמו localStorage אמיתי.
//    בלי הצפנת Windows (plain) — אותו עותק בעמוד, והכתיבה ל-localStorage של הדפדפן רק אחרי אישור (secure-store:can-write).
// אין חשיפה של אובייקט חדש לעמוד: פונקציית השליחה עוברת כארגומנט ל-executeInMainWorld בלבד.
const { contextBridge, ipcRenderer } = require('electron');

const MOD = { 'shamai': 'shamai', 'trainer': 'trainer' }[location.protocol === 'app:' ? location.host : ''];

if (MOD && window === window.top) {
  let init = null;
  try { init = ipcRenderer.sendSync('secure-store:load', MOD); } catch { init = null; }
  if (init) {
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
        // ההעברה נכשלה (למשל הגיבוי שלפניה): ממשיכים עם האחסון הישן, כמו במצב plain (כתיבה רק באישור),
        // וננסה שוב בפתיחה הבאה
        init = { state: 'plain' };
      }
    }
    if (init) {
      // כל כתיבה מחכה לתשובה מהתהליך הראשי (sendSync). כתיבה שנדחתה (אין כניסה, אין הרשאה, אין מקום, הדיסק נכשל)
      // זורקת בעמוד כמו localStorage אמיתי, והעותק בזיכרון לא משתנה — כך "נשמר?" שקורא ממנו מקבל תשובה נכונה
      let send = (op, k, v) => { try { return ipcRenderer.sendSync('secure-store:write', MOD, op, k, v); } catch { return null; } };
      let data = init.data || {};
      if (init.state === 'plain') {
        // אין הצפנת Windows: הנתונים נשארים ב-localStorage של הדפדפן (גלוי, כמו קודם), אבל גם כאן כל כתיבה נבדקת קודם
        // בתהליך הראשי — כניסה, הרשאת עריכה ורישיון (ממצא 24) — ורק אחרי אישור נכתבת, מכאן (בעולם המבודד)
        data = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); data[k] = localStorage.getItem(k); }
        send = (op, k, v) => {
          if (op === 'flush') return { ok: true }; // הדפדפן כותב לדיסק בעצמו
          let r = null;
          try { r = ipcRenderer.sendSync('secure-store:can-write', MOD); } catch { r = null; }
          if (!r || !r.ok) return r;
          try {
            if (op === 'set') localStorage.setItem(k, v);
            else if (op === 'remove') localStorage.removeItem(k);
            else if (op === 'clear') localStorage.clear();
            else return { ok: false, name: 'SecurityError', message: 'השינוי לא נשמר: הנתון אינו תקין' };
            return { ok: true };
          } catch (e) {
            const quota = !!(e && e.name === 'QuotaExceededError');
            return { ok: false, name: quota ? 'QuotaExceededError' : 'SecurityError',
              message: quota ? 'השינוי לא נשמר: נגמר המקום באחסון של המודול — יש למחוק פריטים או תמונות ישנים' : 'השינוי לא נשמר' };
          }
        };
      }
      const readOnlyMessage = init.state === 'encrypted' || init.state === 'plain' ? ''
        : init.state === 'no-session' ? 'השינוי לא נשמר: יש להיכנס למערכת'
          : 'השינוי לא נשמר: הנתונים המוצפנים של המודול לא נפתחו — פנו לתמיכה עם דוח תקלה (F1)';
      // הפונקציה רצה בעולם של העמוד (מועתקת כטקסט): בלי משתנים מבחוץ — הכול עובר ב-args
      contextBridge.executeInMainWorld({
        func: (data, readOnlyMessage, send) => {
          const m = new Map(Object.entries(data));
          const str = (x) => String(x);
          const commit = (op, k, v) => {
            const r = readOnlyMessage ? null : send(op, k, v);
            if (r && r.ok) return;
            const name = r && r.name === 'QuotaExceededError' ? 'QuotaExceededError' : 'SecurityError';
            throw new DOMException((r && typeof r.message === 'string' && r.message) || readOnlyMessage || 'השינוי לא נשמר', name);
          };
          const api = {
            getItem: (k) => (m.has(str(k)) ? m.get(str(k)) : null),
            setItem: (k, v) => { const key = str(k), val = str(v); commit('set', key, val); m.set(key, val); },
            // גם מחיקה של מפתח שאינו קיים עוברת לאישור: מי שאינו רשאי לכתוב מקבל שגיאה, והעמוד לא מוחק בעקבותיה עותק
            // אחר (למשל תמונה ישנה ב-IndexedDB) כאילו המחיקה הצליחה.
            // מפתח שמור (לא נשמר לעולם): כתיבת המחסן לדיסק עכשיו, וזריקה אם נכשלה — כך השמאי מוחק עותק ישן רק
            // אחרי שהחדש באמת בקובץ (ImageDB ב-modules/shamai/src/core.js). בדפדפן רגיל — מחיקה של מפתח שלא קיים
            removeItem: (k) => {
              const key = str(k);
              if (key === '\u0000ss-flush') { commit('flush'); return; }
              commit('remove', key); m.delete(key);
            },
            clear: () => { commit('clear'); m.clear(); },
            key: (i) => { const keys = [...m.keys()]; return i >= 0 && i < keys.length ? keys[i] : null; },
            get length() { return m.size; }
          };
          const ls = new Proxy(api, {
            get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && m.has(k) ? m.get(k) : undefined)),
            set: (o, k, v) => { if (typeof k === 'string') api.setItem(k, v); return true; },
            has: (o, k) => k in o || (typeof k === 'string' && m.has(k)),
            deleteProperty: (o, k) => { if (typeof k === 'string' && m.has(k)) api.removeItem(k); return true; },
            ownKeys: () => [...m.keys()],
            getOwnPropertyDescriptor: (o, k) => (typeof k === 'string' && m.has(k) ? { value: m.get(k), enumerable: true, configurable: true, writable: true } : undefined)
          });
          Object.defineProperty(window, 'localStorage', { value: ls, configurable: false, enumerable: true });
        },
        args: [data, readOnlyMessage, send]
      });
    }
  }
}
