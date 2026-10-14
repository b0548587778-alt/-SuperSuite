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
  setSession(senderId, user) {
    this.sessions.set(senderId, { ...user, lastSeen: this.now() });
  }

  // מחזיר את המשתמש המחובר, או null אם אין כניסה או שהפגישה פגה (ואז הפגישה נמחקת)
  getSession(senderId) {
    const s = this.sessions.get(senderId);
    if (!s) return null;
    if (this.now() - s.lastSeen > this.idleMs) {
      this.sessions.delete(senderId);
      return null;
    }
    s.lastSeen = this.now();
    return s;
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
    for (const [k, v] of this.sessions) if (v.id === userId) this.sessions.delete(k);
  }

  logout(senderId) {
    this.sessions.delete(senderId);
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