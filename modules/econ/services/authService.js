// Authentication Service - Handles user authentication and authorization
const crypto = require('crypto');

// ניתוק אוטומטי אחרי 15 דקות ללא פעילות. הבדיקה נעשית בכל פעולה (לא בטיימר).
const DEFAULT_IDLE_MIN = 15;
const IDLE_MIN_RANGE = [5, 240];

class AuthService {
  constructor() {
    this.sessions = new Map();
    this.db = null;
    this.now = () => Date.now(); // ניתן להחלפה בבדיקות
    this.idleMs = DEFAULT_IDLE_MIN * 60 * 1000;
    this.endListeners = [];
  }

  // סוף פגישה — יציאה, ניתוק בחוסר פעילות, חסימת המשתמש או כניסה חדשה באותו חלון. fn(senderId, session).
  // כך ipc.js נועל את מצב מנהל-העל יחד עם הפגישה שפתחה אותו (בדיקת קוד 23.10.2026, ממצא 4)
  onSessionEnd(fn) {
    this.endListeners.push(fn);
    return () => { this.endListeners = this.endListeners.filter(x => x !== fn); };
  }

  _ended(senderId, session) {
    for (const fn of this.endListeners) {
      try { fn(senderId, session); } catch (e) { console.error('session end listener failed', e); }
    }
  }

  initialize(db) {
    this.db = db;
  }

  async getStatus(senderId) {
    const user = this.getSession(senderId);
    const configured = await this.db.hasUsers();
    return { configured, user };
  }

  async setupAdmin(username, password) {
    if (!username || !password) {
      throw new Error('יש להזין שם משתמש וסיסמה');
    }
    
    const user = await this.db.setupAdmin(username, password);
    return user;
  }

async login(username, password) {
    if (!username || !password) {
      throw new Error('יש להזין שם משתמש וסיסמה');
    }
    
    const user = await this.db.authenticate(username, password);
    return user;
  }
  
  // Helper to set session after login
  // via: 'password' | 'google' — לפי מדיניות ההודעות של Google
  setSession(senderId, user, via = 'password') {
    const prev = this.sessions.get(senderId);
    this.sessions.set(senderId, { ...user, via, lastSeen: this.now() });
    if (prev) this._ended(senderId, prev);
  }

  // מחזיר את המשתמש המחובר, או null אם אין כניסה או שהפגישה פגה (ואז הפגישה נמחקת)
  getSession(senderId) {
    const s = this.sessions.get(senderId);
    if (!s) return null;
    if (this.now() - s.lastSeen > this.idleMs) {
      this.sessions.delete(senderId);
      this._ended(senderId, s);
      return null;
    }
    s.lastSeen = this.now();
    return s;
  }

  // בדיקה שקטה: האם יש פגישה בתוקף — בלי לרשום פעילות (לבדיקות תקופתיות של המעטפת)
  peekSession(senderId) {
    const s = this.sessions.get(senderId);
    return !!(s && this.now() - s.lastSeen <= this.idleMs);
  }

  hasPermission(senderId, permission) {
    const s = this.getSession(senderId);
    return !!(s && Array.isArray(s.permissions) && s.permissions.includes(permission));
  }

  // זמן ניתוק אוטומטי בדקות (5–240), מתוך ההגדרות המתקדמות
  setIdleMinutes(min) {
    const n = Number(min);
    const m = Number.isInteger(n) && n >= IDLE_MIN_RANGE[0] && n <= IDLE_MIN_RANGE[1] ? n : DEFAULT_IDLE_MIN;
    this.idleMs = m * 60 * 1000;
    return m;
  }

  // משתמש שנחסם או שתפקידו שונה — כל הפגישות הפתוחות שלו נסגרות מיד (ההרשאות נטענות בכניסה)
  dropUser(userId) {
    for (const [k, v] of this.sessions) if (v.id === userId) { this.sessions.delete(k); this._ended(k, v); }
  }

  logout(senderId) {
    const s = this.sessions.get(senderId);
    this.sessions.delete(senderId);
    if (s) this._ended(senderId, s);
    return true;
  }

  async changePassword(userId, currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
      throw new Error('יש להזין סיסמה נוכחית וסיסמה חדשה');
    }
    
    await this.db.changePassword(userId, currentPassword, newPassword);
    return true;
  }
}

module.exports = { AuthService: new AuthService(), DEFAULT_IDLE_MIN, IDLE_MIN_RANGE };