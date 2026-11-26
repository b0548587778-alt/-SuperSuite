// מודולים שנפתחים רק אחרי כניסה (בסיסמה או עם Google). הכניסה עצמה נעשית במודול הכלכלי.
// משותף ל-main.js ולאנדרואיד (android/web/main-android.js).
// פתיחה בלי כניסה ← מעבר למסך הכניסה, והמודול המבוקש נשמר ונפתח מיד אחרי הכניסה.
'use strict';

// אימונים וניהול מוסד (מודולי הלימוד במהדורה המלאה) — רק אחרי כניסה; אנגלית, חשבון וארגז הכלים — פתוחים
const LOCKED_MODS = ['shamai', 'trainer', 'school'];

/* isLoggedIn() — בדיקה שקטה: לא נחשבת "פעילות" ולא מאריכה את הפגישה */
function createLoginGate({ isLoggedIn, locked = LOCKED_MODS } = {}) {
  let pending = null;
  const isLocked = (id) => locked.includes(id);
  return {
    isLocked,
    // לאן לנווט בפועל. מודול נעול בלי כניסה ← 'econ' (מסך הכניסה), והבקשה נשמרת
    route(id, view = null) {
      if (isLocked(id) && !isLoggedIn()) { pending = { id, view: view || null }; return 'econ'; }
      if (id !== 'econ') pending = null; // מעבר למודול אחר מבטל את הבקשה הממתינה
      return id;
    },
    // תצוגה פנימית שנבחרה אחרי שהבקשה כבר נשמרה (shell:open פותח מודול ואז תצוגה)
    setPendingView(id, view) { if (pending && pending.id === id) pending.view = view || null; },
    // אחרי כניסה: המודול שחיכה (פעם אחת)
    takePending() {
      if (!pending || !isLoggedIn()) return null;
      const p = pending;
      pending = null;
      return p;
    },
    // יציאה/פגישה שפגה בזמן שמודול נעול פתוח — חייבים לצאת ממנו (והוא יחזור אחרי הכניסה)
    mustLeave(active) {
      if (!isLocked(active) || isLoggedIn()) return false;
      pending = { id: active, view: null };
      return true;
    },
    clear() { pending = null; },
    get pending() { return pending; }
  };
}

module.exports = { createLoginGate, LOCKED_MODS };
