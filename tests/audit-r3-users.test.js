'use strict';
// סקירת קוד 2.11.2026 — משתמשים והרשאות: כניסה עם Google במחשב משותף, "👤 משתמש" שמשאיר את המסך הקודם,
// טבלת "משתמשים והרשאות", ויומן הפעולות בגיבוי ובייצוא. רמת ipc.js (Electron מדומה) וממשק המודול הכלכלי (vm)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const EconUI = require('./helpers/econ-ui');
const UB = require('../modules/econ/core/usersBackup');
const { ROLES } = require('../modules/econ/core/database');

const handlers = {};
let saveTo = null; // הנתיב שחלון השמירה המדומה מחזיר
const STUB = '/__electron_stub_r3_users__.js';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? STUB : origResolve.call(this, req, ...rest); };
require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: {
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: { showSaveDialog: async () => (saveTo ? { canceled: false, filePath: saveTo } : { canceled: true }) },
} };
const ipc = require('../modules/econ/ipc');
const { AuthService: auth } = require('../modules/econ/services/authService');

const ev = (id) => ({ sender: { id } });
const ADMIN = ['menahel', 'menahel-pass-long-1'];
const CLIENT_ID = '1234567890-abcdefghijk.apps.googleusercontent.com';
const tmpDirs = [];
const mkTmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3-users-' + n + '-')); tmpDirs.push(d); return d; };
test.after(() => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* מסד פתוח */ } } });

// הדפדפן של Google מדומה: identity — מי שבחר בחשבון; gate — המתנה עד שמשחררים
const google = { identity: { sub: 'g-admin', email: 'admin@example.org' }, gate: null };
const code = { required: true, value: 'ABCDE-RECOVERY' };
async function boot(name) {
  const dir = mkTmp(name);
  await ipc.initEcon(dir, {
    relayUrl: '',
    googleClient: { clientId: '', clientSecret: '' },
    googleSignIn: async () => { if (google.gate) await google.gate; return google.identity; },
    recoveryCode: { available: () => code.required, verify: (c) => c === code.value },
  });
  return dir;
}
async function setupAdminWithGoogle(dir) {
  await handlers['auth:setup'](ev(1), ...ADMIN);
  await handlers['settings:saveGoogle'](ev(1), { enabled: true, clientId: CLIENT_ID, clientSecret: 'GOCSPX-abcdefghij' });
  return dir;
}

// ---------- ממצא "כניסה עם Google במחשב משותף" ----------
test('Google במחשב משותף: אחרי כניסה עם Google — איפוס סיסמה וניתוק Google של אחר רק עם הסיסמה של המנהל', async () => {
  await setupAdminWithGoogle(await boot('stepup'));
  google.identity = { sub: 'g-admin', email: 'admin@example.org' };
  await handlers['auth:google-link'](ev(1));
  const ed = await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  // "אורח" ליד המחשב: הדפדפן עדיין מחובר לחשבון של המנהל
  const guest = await handlers['auth:google-login'](ev(2));
  assert.equal(guest.username, 'menahel');
  await assert.rejects(handlers['users:resetPassword'](ev(2), ed.id, 'new-password-long-1'), /להקליד שוב את הסיסמה/);
  await assert.rejects(handlers['users:resetPassword'](ev(2), ed.id, 'new-password-long-1', 'wrong-password-123'), /הסיסמה שגויה/);
  assert.equal(await handlers['users:resetPassword'](ev(2), ed.id, 'new-password-long-1', ADMIN[1]), true);
  // בכניסה בסיסמה — בלי דרישה נוספת (הסיסמה כבר הוקלדה)
  assert.equal(await handlers['users:resetPassword'](ev(1), ed.id, 'new-password-long-2'), true);
  // קוד השחזור (main.js) — econ.confirmPassword בודק את הסיסמה של המחובר
  await assert.rejects(ipc.confirmPassword(2, 'wrong-password-123'), /הסיסמה שגויה/);
  assert.equal(await ipc.confirmPassword(2, ADMIN[1]), true);
  await assert.rejects(ipc.confirmPassword(99, ADMIN[1]), /נדרשת כניסה/);
});

// ---------- טבלה: קישור Google נקשר למי שהתחיל ----------
test('קישור Google: החלפת משתמש בזמן ההמתנה לדפדפן ← הקישור נדחה ולא נקשר למחובר החדש', async () => {
  await setupAdminWithGoogle(await boot('link-swap'));
  await handlers['users:create'](ev(1), { username: 'tzofe', password: 'tzofe-pass-long-12', role: 'viewer' });
  google.identity = { sub: 'g-swap', email: 'swap@example.org' };
  let release;
  google.gate = new Promise(r => { release = r; });
  const pending = handlers['auth:google-link'](ev(1));
  await new Promise(r => setTimeout(r, 20));
  // 👤 משתמש: המנהל יצא, צופה נכנס באותו חלון
  await handlers['auth:logout'](ev(1));
  await handlers['auth:login'](ev(1), 'tzofe', 'tzofe-pass-long-12');
  google.gate = null;
  release();
  await assert.rejects(pending, /התחלף/);
  const users = await (async () => { await handlers['auth:login'](ev(3), ...ADMIN); return handlers['users:list'](ev(3)); })();
  assert.ok(users.every(u => !u.google), 'אף משתמש לא קושר');
});

// ---------- טבלה: איפוס / חסימה מנתקים Google, וניתוק בידי המנהל ----------
test('איפוס סיסמה וחסימה מנתקים את Google; המנהל מנתק Google של משתמש אחר ונרשם ביומן', async () => {
  await setupAdminWithGoogle(await boot('unlink'));
  const ed = await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  let pass = 'orech-pass-long-12';
  const link = async (sub) => {
    await handlers['auth:login'](ev(2), 'orech', pass);
    google.identity = { sub, email: sub + '@example.org' };
    await handlers['auth:google-link'](ev(2));
  };
  const linked = async () => (await handlers['users:list'](ev(1))).find(u => u.id === ed.id).google;
  await link('g-ed-1');
  assert.equal(await linked(), 'g-ed-1@example.org');
  await handlers['users:resetPassword'](ev(1), ed.id, 'new-password-long-1');
  assert.equal(await linked(), null, 'איפוס מנתק');
  pass = 'new-password-long-1';
  await assert.rejects(handlers['auth:google-login'](ev(5)), /לא מקושר/);
  await handlers['auth:login'](ev(2), 'orech', 'new-password-long-1');
  google.identity = { sub: 'g-ed-2', email: 'g-ed-2@example.org' };
  await handlers['auth:google-link'](ev(2));
  await handlers['users:update'](ev(1), ed.id, { active: false });
  await handlers['users:update'](ev(1), ed.id, { active: true });
  assert.equal(await linked(), null, 'חסימה מנתקת — הפעלה מחדש לא מחזירה כניסה בלי סיסמה');
  await link('g-ed-3');
  // עורך לא מנתק אחרים; המנהל — כן
  await assert.rejects(handlers['users:unlinkGoogle'](ev(2), ed.id), /אין הרשאה/);
  assert.equal(await handlers['users:unlinkGoogle'](ev(1), ed.id), true);
  assert.equal(await linked(), null);
  const audit = await handlers['audit:list'](ev(1), { action: 'users.unlinkGoogle' });
  assert.equal(audit.length, 1);
  assert.match(audit[0].details, /orech/);
});

// ---------- טבלה: ת"ז כפולה לא חושפת נזקק חסוי ----------
test('ת"ז כפולה: עורך לא מגלה שת"ז שייכת לנזקק חסוי; מול נזקק רגיל — ההודעה נשארת', async () => {
  await boot('chesed');
  await handlers['auth:setup'](ev(1), ...ADMIN);
  await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  await handlers['auth:login'](ev(2), 'orech', 'orech-pass-long-12');
  await handlers['chesed:addBeneficiary'](ev(1), { familyName: 'חסוי', headName: 'ראובן', idNumber: '000000018', tier: 'confidential', familySize: 3 });
  await handlers['chesed:addBeneficiary'](ev(1), { familyName: 'רגיל', headName: 'שמעון', idNumber: '000000026', familySize: 2 });
  await assert.doesNotReject(handlers['chesed:addBeneficiary'](ev(2), { familyName: 'אחר', headName: 'לוי', idNumber: '000000018', familySize: 2 }));
  await assert.rejects(handlers['chesed:addBeneficiary'](ev(2), { familyName: 'אחר', headName: 'יהודה', idNumber: '000000026', familySize: 2 }), /כבר קיים נזקק/);
  // המנהל (רואה חסויים) — עדיין מקבל את ההודעה
  await assert.rejects(handlers['chesed:addBeneficiary'](ev(1), { familyName: 'אחר', headName: 'יששכר', idNumber: '000000018', familySize: 2 }), /כבר קיים נזקק/);
});

// ---------- טבלה: צפייה בחסוי דרך החיפוש במאגר האנשים נרשמת ----------
test('מאגר אנשים: חיפוש שמציג נזקק חסוי למנהל נרשם ביומן; עורך לא רואה ולא נרשם', async () => {
  await boot('people');
  await handlers['auth:setup'](ev(1), ...ADMIN);
  await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  await handlers['auth:login'](ev(2), 'orech', 'orech-pass-long-12');
  await handlers['chesed:addBeneficiary'](ev(1), { familyName: 'נסתר', headName: 'זבולון', idNumber: '000000034', tier: 'confidential', familySize: 3 });
  const views = async () => (await handlers['audit:list'](ev(1), { action: 'chesed.confidential.view' })).filter(a => /people-search/.test(a.details));
  const r = await handlers['people:search'](ev(1), 'זבולון');
  assert.equal(r.rows.length, 1);
  assert.equal((await views()).length, 1);
  const r2 = await handlers['people:search'](ev(2), 'זבולון');
  assert.equal(r2.rows.length, 0);
  assert.equal((await views()).length, 1);
});

// ---------- טבלה: שחזור מרענן את זמן הניתוק ואת מדיניות Google ----------
test('שחזור: זמן הניתוק ומדיניות Google מהגיבוי חלים מיד, בלי הפעלה מחדש', async () => {
  await boot('restore-settings');
  await handlers['auth:setup'](ev(1), ...ADMIN);
  const db = ipc.getDb();
  const data = await db.backup();
  data.settings = { ...data.settings, idleMinutes: 42, google: { enabled: true, clientId: CLIENT_ID, clientSecret: 'GOCSPX-abcdefghij', onlineRequiresGoogle: false } };
  assert.notEqual(auth.idleMs, 42 * 60000);
  assert.equal((await handlers['auth:status'](ev(9))).google.enabled, false);
  await db.restore(data); // אותו מסלול כמו main.js / אנדרואיד / data:restore
  assert.equal(auth.idleMs, 42 * 60000);
  assert.equal((await handlers['auth:status'](ev(9))).google.enabled, true);
});

// ---------- טבלה + פרטיות: משתמשים ויומן בגיבוי המלא ----------
test('גיבוי המשתמשים: מיזוג — משתמש קיים לא משתנה, חסר נוסף עם הסיסמה והתפקיד, היומן מתווסף ומוצפן במסד', async () => {
  await setupAdminWithGoogle(await boot('users-src'));
  google.identity = { sub: 'g-src', email: 'src@example.org' };
  await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  await handlers['users:create'](ev(1), { username: 'roeh', password: 'roeh-pass-long-123', role: 'accountant' });
  await handlers['auth:login'](ev(2), 'orech', 'orech-pass-long-12');
  await handlers['auth:google-link'](ev(2));
  const snap = await ipc.usersBackup();
  assert.equal(snap.users.length, 3);
  assert.ok(snap.audit.some(a => a.action === 'users.create' && /roeh/.test(a.details)), 'פרטי היומן פתוחים בתוך הגיבוי המוצפן');
  // בדיקת הקובץ לפני חלון האישור
  const clean = UB.usersFromBackup(JSON.parse(JSON.stringify(snap)));
  assert.equal(UB.usersFromBackup(undefined), null, 'גיבוי ישן בלי users');
  assert.throws(() => UB.usersFromBackup({ v: 1, users: [{ id: 'x' }] }), /פגומים/);
  assert.deepEqual(UB.ROLES, ROLES);

  // מחשב אחר: מנהל אחר בשם זהה (menahel) עם סיסמה אחרת
  await boot('users-dst');
  await handlers['auth:setup'](ev(1), 'menahel', 'other-admin-pass-1');
  const before = (await handlers['users:list'](ev(1)))[0];
  const r = await ipc.usersRestore(clean);
  assert.deepEqual({ added: r.added, existing: r.existing }, { added: 2, existing: 1 });
  assert.ok(r.audit > 0);
  // המנהל הנוכחי נכנס כמו קודם; הסיסמה מהגיבוי לא חלה עליו
  await assert.doesNotReject(handlers['auth:login'](ev(3), 'menahel', 'other-admin-pass-1'));
  await assert.rejects(handlers['auth:login'](ev(4), ...ADMIN), /שגויים/);
  const users = await handlers['users:list'](ev(1));
  assert.equal(users.find(u => u.username === 'menahel').id, before.id);
  assert.equal(users.find(u => u.username === 'roeh').role, 'accountant');
  assert.equal(users.find(u => u.username === 'orech').google, 'src@example.org');
  await assert.doesNotReject(handlers['auth:login'](ev(5), 'roeh', 'roeh-pass-long-123'));
  // שחזור שני — בלי כפילויות ביומן
  assert.equal((await ipc.usersRestore(clean)).audit, 0);
  // פרטי היומן נכתבו במסד דרך cipher.seal (כאן בלי מפתח — כמו שאר היומן); הרשומות מהגיבוי נקראות
  const audit = await handlers['audit:list'](ev(1), { action: 'users.create' });
  assert.ok(audit.some(a => /roeh/.test(a.details) && a.user === 'menahel'), 'הפעולה מקושרת למנהל לפי השם');
});

test('גיבוי המשתמשים: משתמש שנחסם כאן לא חוזר לפעול, ומעבר למכסת הרישיון — נוסף חסום', async () => {
  await boot('users-block');
  await handlers['auth:setup'](ev(1), ...ADMIN);
  const ed = await handlers['users:create'](ev(1), { username: 'orech', password: 'orech-pass-long-12', role: 'editor' });
  const snap = UB.usersFromBackup(await ipc.usersBackup());
  await handlers['users:update'](ev(1), ed.id, { active: false });
  await ipc.usersRestore(snap);
  assert.equal((await handlers['users:list'](ev(1))).find(u => u.username === 'orech').active, false);
  // מכסה: importUsers עם maxActive
  snap.users.push({ id: 'u-new', username: 'chadash', passwordHash: snap.users[0].passwordHash, active: true, createdAt: 'x', updatedAt: 'x', role: 'viewer' });
  const r = await ipc.getDb().importUsers(snap, { maxActive: 1 });
  assert.equal(r.blocked, 1);
  assert.equal((await handlers['users:list'](ev(1))).find(u => u.username === 'chadash').active, false);
});

test('ייצוא היומן: כל האירועים, בלי חיתוך שקט ב-5,000', async () => {
  const dir = await boot('audit-export');
  await handlers['auth:setup'](ev(1), ...ADMIN);
  const db = ipc.getDb();
  await db.exec('BEGIN');
  for (let i = 0; i < 5100; i++) await db.audit(null, 'test.bulk', '');
  await db.exec('COMMIT');
  saveTo = path.join(dir, 'audit.csv');
  try {
    const r = await handlers['audit:export'](ev(1), {});
    assert.equal(r.ok, true);
    assert.ok(r.rows >= 5100, 'כל השורות: ' + r.rows);
    assert.ok(fs.readFileSync(saveTo, 'utf8').split('\n').filter(l => /test\.bulk/.test(l)).length === 5100);
  } finally { saveTo = null; }
});

// ---------- טבלה: auth:setup במסד ששוחזר בלי משתמשים ----------
test('מסד ששוחזר אחרי תקלה בלי משתמשים: יצירת מנהל רק עם קוד השחזור', async () => {
  await boot('setup-recovery');
  const db = ipc.getDb();
  const d = await db.load();
  d.donors = [{ id: 'd1', name: 'אהרן' }];
  await db.save(d);
  // התקנה רגילה / מסד ישן — בלי דרישה
  assert.equal((await handlers['auth:status'](ev(1))).recoveryCodeRequired, undefined);
  await db.markSetupNeedsRecoveryCode(); // main.js → recoverDatabase, גיבוי בלי users
  assert.equal((await handlers['auth:status'](ev(1))).recoveryCodeRequired, true);
  await assert.rejects(handlers['auth:setup'](ev(1), ...ADMIN), /קוד השחזור/);
  await assert.rejects(handlers['auth:setup'](ev(1), ...ADMIN, 'WRONG'), /קוד השחזור/);
  assert.equal((await handlers['auth:status'](ev(1))).configured, false);
  const u = await handlers['auth:setup'](ev(1), ...ADMIN, code.value);
  assert.equal(u.username, 'menahel');
  assert.equal(await db.setupNeedsRecoveryCode(), false, 'הסימון נמחק');
  assert.equal((await handlers['audit:list'](ev(1), { action: 'auth.setup.recovery' })).length, 1);
});

test('מסד ששוחזר בלי משתמשים, במחשב בלי קוד שחזור — יצירת מנהל רגילה (אין במה להוכיח)', async () => {
  code.required = false;
  try {
    await boot('setup-nocode');
    await ipc.getDb().markSetupNeedsRecoveryCode();
    assert.equal((await handlers['auth:setup'](ev(1), ...ADMIN)).username, 'menahel');
  } finally { code.required = true; }
});

// ---------- ממצא "👤 משתמש משאיר את המסך של המשתמש הקודם" ----------
function el(tag = 'div') {
  const listeners = {};
  const classes = new Set();
  const node = {
    tagName: String(tag).toUpperCase(), textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [],
    disabled: false, hidden: false,
    classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, toggle() {}, contains(c) { return classes.has(c); } },
    addEventListener(e, fn) { (listeners[e] ||= []).push(fn); }, removeEventListener() {}, _listeners: listeners,
    append(...c) { node.children.push(...c); }, appendChild(c) { node.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
  };
  return node;
}
function loadUi(api) {
  const byId = {};
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById(id) { return (byId[id] ||= el('div')); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: (t) => el(t), createTextNode: (t) => ({ textContent: t }), body: el('body'),
  };
  const context = { console, setTimeout, clearTimeout, setImmediate, Date, Intl, URLSearchParams, TextDecoder, location: { search: '' }, document };
  context.window = context;
  context.systemAPI = api;
  vm.createContext(context);
  EconUI.run(context);
  return { context, byId, run: (c) => vm.runInContext(c, context) };
}

test('👤 משתמש: איפוס מלא, חלון כניסה אחד (גם אחרי סיסמה שגויה), והמסך נטען מחדש בשם המשתמש החדש', async () => {
  const logins = [];
  const api = {
    logout: async () => true,
    authStatus: async () => ({ configured: true, user: null }),
  };
  const { context, byId, run } = loadUi(api);
  const toasts = [];
  context.showToast = (m) => toasts.push(m);
  context.showError = (m) => toasts.push('E:' + m);
  // מסך הכניסה המדומה: הניסיון הראשון — סיסמה שגויה, השני — צופה
  const attempts = [{ username: 'tzofe', password: 'bad' }, { username: 'tzofe', password: 'good' }];
  let dialogs = 0, open = 0, maxOpen = 0;
  context.askFields = async () => { dialogs++; open++; maxOpen = Math.max(maxOpen, open); await new Promise(r => setImmediate(r)); open--; return attempts.shift(); };
  api.login = async (u, p) => { logins.push(p); if (p !== 'good') throw new Error('שם משתמש או סיסמה שגויים'); return { username: u, roles: ['viewer'], permissions: ['data.view'] }; };
  const rendered = [];
  context.switchView = async (v) => { rendered.push([v, run('state.user && state.user.username'), byId.view.innerHTML]); };
  // מצב "של המנהל": מסך ההוצאות האישיות, נתונים בזיכרון, תשובת עוזר, מעבדה ושמאות
  run(`state.user = { username: 'menahel', roles: ['admin'] }; state.currentView = 'acct-personal';
    state.data = { personal: [{ amount: 5000 }] }; state.lab = { x: 1 }; state.re = { caseId: 'c1' }; state.chatDraft = 'טיוטה';
    aiUi.answer = { text: 'סודי' }; rltyUi.deal = { id: 'd' };`);
  byId.view.innerHTML = '<p>הוצאות אישיות של המנהל</p>';
  // econ:auth-check שמגיע תוך כדי (main.js שולח ביציאה) — לא פותח חלון שני
  const p = run('handleUser()');
  run('maybeRelogin("נדרשת כניסה")');
  await p;
  assert.equal(maxOpen, 1, 'לעולם לא שני חלונות כניסה יחד');
  assert.equal(dialogs, 2, 'אחרי סיסמה שגויה — חלון הכניסה חוזר, המסך לא נשאר גלוי');
  assert.deepEqual(logins, ['bad', 'good']);
  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0], ['acct-personal', 'tzofe', ''], 'המסך הקודם נמחק, והתצוגה נטענת מחדש בשם המשתמש החדש');
  assert.equal(JSON.stringify(run('state.data')), '{}');
  assert.equal(run('state.lab'), undefined);
  assert.equal(run('state.re'), undefined);
  assert.equal(run('state.chatDraft'), undefined);
  assert.equal(run('aiUi.answer'), null);
  assert.equal(run('rltyUi.deal'), null);
});

test('👤 משתמש בלי משתמש מחובר: אותו חלון כניסה, וכשל ביציאה מדווח', async () => {
  const api = { authStatus: async () => ({ configured: true, user: null }), login: async (u) => ({ username: u, roles: [] }), logout: async () => { throw new Error('היציאה נכשלה'); } };
  const { context, run } = loadUi(api);
  const errs = [];
  context.showToast = () => {};
  context.showError = (m) => errs.push(m);
  context.askFields = async () => ({ username: 'a', password: 'b' });
  context.switchView = async () => {};
  await run('handleUser()');
  assert.equal(run('state.user.username'), 'a');
  await run('handleUser()');
  assert.deepEqual(errs, ['שגיאה בניהול משתמש: היציאה נכשלה']);
});
