import { showSaveError } from './dialog.js';
// localStorage-backed storage adapter.
// Implements the same API as Claude artifact window.storage so App.jsx works unchanged.
// All data is stored locally in the browser — nothing leaves the device.

// כתיבה שנדחתה: ב-SuperSuite ה-localStorage המוצפן זורק עם סיבה בעברית (צפייה בלבד, הכניסה פגה, רישיון,
// אין מקום, הדיסק נכשל — shell/secure-ls-preload.js). פעם רק "אחסון מלא" הוצג, וכל השאר נבלע בשקט
// (בדיקת קוד 23.10.2026, ממצא 3)
export function saveErrorText(e) {
  if (e && typeof e.message === 'string' && /[֐-׿]/.test(e.message)) return e.message;
  if (e && e.name === 'QuotaExceededError') return 'השינוי לא נשמר: אין מקום באחסון — יש למחוק מתאמנים או נתונים ישנים';
  return 'השינוי לא נשמר';
}

if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      try {
        const v = localStorage.getItem(key);
        return v !== null ? { key, value: v } : null;
      } catch (e) {
        console.error('storage.get failed:', e);
        return null;
      }
    },

    async set(key, value) {
      try {
        localStorage.setItem(key, String(value));
        return { key, value };
      } catch (e) {
        console.error('storage.set failed:', e);
        showSaveError(saveErrorText(e));
        return null;
      }
    },

    async delete(key) {
      try {
        localStorage.removeItem(key);
        return { key, deleted: true };
      } catch (e) {
        console.error('storage.delete failed:', e);
        showSaveError(saveErrorText(e));
        return null;
      }
    },

    async list(prefix = '') {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        return { keys };
      } catch (e) {
        console.error('storage.list failed:', e);
        return { keys: [] };
      }
    }
  };
}

// Utility: export all data as JSON string (for backup)
export function exportAllData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    data[k] = localStorage.getItem(k);
  }
  return JSON.stringify(data, null, 2);
}

// Utility: import data from JSON string (for restore)
export function importAllData(jsonStr) {
  const data = JSON.parse(jsonStr);
  Object.entries(data).forEach(([k, v]) => {
    localStorage.setItem(k, v);
  });
}
