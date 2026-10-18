// localStorage-backed storage adapter.
// Implements the same API as Claude artifact window.storage so App.jsx works unchanged.
// All data is stored locally in the browser — nothing leaves the device.

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
        if (e.name === 'QuotaExceededError') {
          alert('אחסון מקומי מלא. מומלץ לייצא גיבוי של נתוני המתאמנים ולמחוק ישנים.');
        }
        return null;
      }
    },

    async delete(key) {
      try {
        localStorage.removeItem(key);
        return { key, deleted: true };
      } catch (e) {
        console.error('storage.delete failed:', e);
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
