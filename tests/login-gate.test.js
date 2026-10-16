// שמאי ואימונים נפתחים רק אחרי כניסה: הכלל המשותף (shell/login-gate.js) לדסקטופ ולאנדרואיד
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createLoginGate, LOCKED_MODS } = require('../shell/login-gate');

test('המודולים הנעולים: שמאי ואימונים בלבד', () => {
  assert.deepEqual(LOCKED_MODS, ['shamai', 'trainer']);
});

test('בלי כניסה: מודול נעול מנותב למסך הכניסה ונשמר; אחרי כניסה — נפתח פעם אחת', () => {
  let logged = false;
  const g = createLoginGate({ isLoggedIn: () => logged });
  assert.equal(g.route('tools'), 'tools', 'ארגז הכלים פתוח');
  assert.equal(g.route('econ'), 'econ');
  assert.equal(g.route('trainer', 'nutrition'), 'econ');
  assert.deepEqual(g.pending, { id: 'trainer', view: 'nutrition' });
  assert.equal(g.route('econ'), 'econ', 'מסך הכניסה עצמו לא מבטל את הבקשה');
  assert.equal(g.takePending(), null, 'לפני כניסה לא נמסר');
  logged = true;
  assert.deepEqual(g.takePending(), { id: 'trainer', view: 'nutrition' });
  assert.equal(g.takePending(), null, 'נמסר פעם אחת בלבד');
  assert.equal(g.route('shamai'), 'shamai', 'אחרי כניסה — נפתח ישירות');
});

test('מעבר למודול אחר או למסך הבית מבטל את הבקשה הממתינה', () => {
  const g = createLoginGate({ isLoggedIn: () => false });
  g.route('shamai');
  g.route('tools');
  assert.equal(g.pending, null);
  g.route('shamai');
  g.clear();
  assert.equal(g.pending, null);
  g.route('trainer');
  g.setPendingView('trainer', 'cardio');
  g.setPendingView('shamai', 'x');
  assert.deepEqual(g.pending, { id: 'trainer', view: 'cardio' });
});

test('יציאה/פגישה שפגה במודול נעול — חובה לצאת, והמודול חוזר אחרי הכניסה', () => {
  let logged = true;
  const g = createLoginGate({ isLoggedIn: () => logged });
  assert.equal(g.mustLeave('shamai'), false);
  logged = false;
  assert.equal(g.mustLeave('tools'), false);
  assert.equal(g.mustLeave('econ'), false);
  assert.equal(g.mustLeave(null), false);
  assert.equal(g.mustLeave('shamai'), true);
  logged = true;
  assert.deepEqual(g.takePending(), { id: 'shamai', view: null });
});

test('בדיקה שקטה של הפגישה לא מאריכה אותה; רישום פעילות — כן', () => {
  const { AuthService } = require('../modules/econ/services/authService');
  const saved = { now: AuthService.now, idle: AuthService.idleMs };
  let t = 1000;
  AuthService.now = () => t;
  AuthService.idleMs = 100;
  try {
    AuthService.setSession(42, { id: 'u', permissions: [] });
    t = 1090;
    assert.equal(AuthService.peekSession(42), true);
    t = 1150;
    assert.equal(AuthService.peekSession(42), false, 'הבדיקה השקטה לא רשמה פעילות ב-1090');
    AuthService.setSession(43, { id: 'u', permissions: [] });
    t = 1240;
    AuthService.getSession(43); // פעילות
    t = 1300;
    assert.equal(AuthService.peekSession(43), true);
  } finally {
    AuthService.now = saved.now;
    AuthService.idleMs = saved.idle;
    AuthService.sessions.delete(42);
    AuthService.sessions.delete(43);
  }
});

test('הכלל מחובר בדסקטופ ובאנדרואיד, אחרי בדיקת הרישוי', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const sw = main.slice(main.indexOf('function switchTo(id)'), main.indexOf('function goHome()'));
  assert.ok(sw.indexOf('LG.moduleAllowed') >= 0 && sw.indexOf('loginGate.route') > sw.indexOf('LG.moduleAllowed'),
    'מודול שאינו ברישיון לא מבקש כניסה');
  assert.match(main, /econ\.onAuthChange\(onEconAuthChange\)/);
  assert.match(main, /econ\.touchSession/, 'עבודה במודול נעול נחשבת פעילות');
  const android = fs.readFileSync(path.join(__dirname, '..', 'android', 'web', 'main-android.js'), 'utf8');
  assert.match(android, /require\('\.\.\/\.\.\/shell\/login-gate'\)/);
  assert.match(android, /loginGate\.route\(id\) !== id/);
});
