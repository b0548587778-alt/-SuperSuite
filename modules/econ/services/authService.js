// Authentication Service - Handles user authentication and authorization
const crypto = require('crypto');

// ניתוק אוטומטי אחרי 15 דקות ללא פעילות. הבדיקה נעשית בכל פעולה (לא בטיימר).
const IDLE_MS = 15 * 60 * 1000;

class AuthService {
  constructor() {
    this.sessions = new Map();
    this.db = null;
    this.now = () => Date.now(); // ניתן להחלפה בבדיקות
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
      throw new Error('Username and password are required');
    }
    
    const user = await this.db.setupAdmin(username, password);
    return user;
  }

async login(username, password) {
    if (!username || !password) {
      throw new Error('Username and password are required');
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
    if (this.now() - s.lastSeen > IDLE_MS) {
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

  logout(senderId) {
    this.sessions.delete(senderId);
    return true;
  }

  async changePassword(userId, currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
      throw new Error('Current and new passwords are required');
    }
    
    await this.db.changePassword(userId, currentPassword, newPassword);
    return true;
  }
}

module.exports = { AuthService: new AuthService() };