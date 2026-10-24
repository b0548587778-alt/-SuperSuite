// שכבת האחסון של מודול האימונים: מעל window.storage (lib/storage.js; ב-SuperSuite — localStorage מוצפן).
// כל מפתח חדש — להוסיף גם ב-shell/trainer-backup-check.js, אחרת הוא לא ישוחזר מגיבוי.

export const S = {
  async get(key) {
    try {
      if (!window.storage) return null;
      const r = await window.storage.get(key);
      return r?.value ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  // true — נשמר; false — לא נשמר (אחסון מלא, צפייה בלבד, הכניסה פגה). פעם הכישלון נבלע, והמסך הציג תשלום או ניכוי
  // שנעלמו בטעינה הבאה (בדיקת קוד 23.10.2026). lib/storage.js מחזיר null כשהשמירה נכשלה, ומציג את הסיבה.
  // מי שקורא — לא מעדכן את המסך כשהתשובה false
  async set(key, value) {
    try {
      if (!window.storage) return false;
      const r = await window.storage.set(key, JSON.stringify(value));
      return r !== null && r !== undefined;
    } catch (e) { console.error('set failed', key, e); return false; }
  },
  // true — נמחק (או לא היה); false — המחיקה נדחתה (צפייה בלבד, הכניסה פגה), וההודעה כבר הוצגה ב-lib/storage.js
  async del(key) {
    try {
      if (!window.storage) return false;
      const r = await window.storage.delete(key);
      return r !== null && r !== undefined;
    } catch { return false; }
  },
  async list(prefix) {
    try {
      if (!window.storage) return [];
      const r = await window.storage.list(prefix);
      return r?.keys || [];
    } catch { return []; }
  },
};

export const K = {
  trainer: 'trainer:profile',
  clientIndex: 'clients:index',
  client: (id) => `client:${id}`,
  program: (clientId) => `program:${clientId}`,
  sessions: (clientId) => `sessions:${clientId}`,
  measurements: (clientId) => `measurements:${clientId}`,
  assessments: (clientId) => `assessments:${clientId}`,
  // ניהול סטודיו (PLAN.md 9.11)
  plans: 'studio:plans',
  schedule: 'studio:schedule',
  memberships: (clientId) => `memberships:${clientId}`,
};
