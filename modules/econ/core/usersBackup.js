// משתמשים, תפקידים, קישורי Google ויומן הפעולות בגיבוי המלא — השדה users ברמה העליונה (סקירת קוד 2.11.2026).
// בדיקת הקלט מהקובץ (קלט חיצוני) לפני חלון האישור: מבנה פגום ← שגיאה, ולא שחזור חלקי. טהור, בלי מסד.
// הכתיבה עצמה — Database.importUsers (מיזוג: משתמש קיים לא משתנה)
'use strict';

const ROLES = ['admin', 'editor', 'viewer', 'accountant'];
const MAX_USERS = 10000;
const MAX_AUDIT = 1000000;
const HASH_RE = /^[a-z0-9]{1,16}\$[0-9a-f]{8,128}\$[0-9a-f]{16,256}$/;

const str = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;

function bad() { return new Error('רשימת המשתמשים או יומן הפעולות בקובץ הגיבוי פגומים'); }

// null — אין בגיבוי משתמשים (גיבוי ישן): השחזור לא נוגע במשתמשים וביומן
function usersFromBackup(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) throw bad();
  const { users, google = [], audit = [] } = raw;
  if (!Array.isArray(users) || !Array.isArray(google) || !Array.isArray(audit)) throw bad();
  if (users.length > MAX_USERS || google.length > MAX_USERS || audit.length > MAX_AUDIT) throw bad();
  const names = new Set(), ids = new Set();
  const outUsers = [];
  for (const u of users) {
    if (!u || typeof u !== 'object' || !str(u.id, 64, 1) || !str(u.username, 64, 1) || !str(u.passwordHash, 512) ||
      !HASH_RE.test(u.passwordHash) || typeof u.active !== 'boolean' || !str(u.createdAt, 40, 1) || !str(u.updatedAt, 40, 1)) throw bad();
    if (names.has(u.username) || ids.has(u.id)) continue;
    names.add(u.username); ids.add(u.id);
    outUsers.push({ id: u.id, username: u.username, passwordHash: u.passwordHash, active: u.active,
      createdAt: u.createdAt, updatedAt: u.updatedAt, role: ROLES.includes(u.role) ? u.role : 'viewer' });
  }
  const outGoogle = [];
  for (const g of google) {
    if (!g || typeof g !== 'object' || !str(g.userId, 64, 1) || !str(g.sub, 255, 1) || !str(g.email || '', 254) || !str(g.linkedAt, 40, 1)) throw bad();
    outGoogle.push({ userId: g.userId, sub: g.sub, email: g.email || '', linkedAt: g.linkedAt });
  }
  const outAudit = [];
  for (const a of audit) {
    if (!a || typeof a !== 'object' || !str(a.id, 64, 1) || !(a.userId == null || str(a.userId, 64, 1)) || !str(a.action, 200, 1) ||
      !str(a.details || '', 200000) || !str(a.at, 40, 1)) throw bad();
    outAudit.push({ id: a.id, userId: a.userId || null, action: a.action, details: a.details || '', at: a.at });
  }
  return { users: outUsers, google: outGoogle, audit: outAudit };
}

// שורה לחלון האישור ולהודעה בסוף
function restoreNote(snap) {
  if (!snap) return '';
  return `משתמשים מהגיבוי שאינם קיימים כאן (${snap.users.length} בגיבוי) יתווספו עם הסיסמאות והתפקידים שלהם; ` +
    'משתמשים קיימים — כולל את/ה — לא ישתנו. יומן הפעולות מהגיבוי יתווסף ליומן הקיים.';
}

// סיכום אחרי המיזוג (database.js → importUsers)
function resultNote(r) {
  if (!r) return '';
  const parts = [r.added ? `נוספו ${r.added} משתמשים מהגיבוי` : 'לא נוספו משתמשים (כולם כבר קיימים כאן)'];
  if (r.blocked) parts.push(`${r.blocked} מהם נוספו חסומים — מעבר למכסת המשתמשים ברישיון`);
  if (r.audit) parts.push(`${r.audit} רשומות נוספו ליומן הפעולות`);
  return parts.join('; ') + '.';
}

module.exports = { usersFromBackup, restoreNote, resultNote, ROLES };
