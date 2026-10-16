// Main Electron Application Entry Point
const { ipcMain, dialog, BrowserWindow, safeStorage } = require('electron');
const fs = require('fs');
const X = require('./core/exports');
const { initializeDatabase } = require('./core/database');
const { AuthService: authService } = require('./services/authService');
const { FinancialService: financialService } = require('./services/financialService');
const { MarketIntelService: marketIntelService } = require('./services/marketIntelService');
const { PersonalFinanceService: personalFinanceService } = require('./services/personalFinanceService');
const { MortgageService: mortgageService } = require('./services/mortgageService');
const { BusinessService: businessService } = require('./services/businessService');
const { CanvasService: canvasService } = require('./services/canvasService');
const { TasksService: tasksService } = require('./services/tasksService');
const { ContactsService: contactsService } = require('./services/contactsService');
const { FitnessService: fitnessService } = require('./services/fitnessService');
const { VoiceNotesService: voiceNotesService } = require('./services/voiceNotesService');
const { AccountingService: accountingService } = require('./services/accountingService');
const { NpoService: npoService } = require('./services/npoService');
const { GemachService: gemachService } = require('./services/gemachService');
const { CollectService: collectService } = require('./services/collectService');
const { ChesedService: chesedService } = require('./services/chesedService');
const { PeopleService: peopleService } = require('./services/peopleService');
const { PrivacyService: privacyService } = require('./services/privacyService');
const { MortgageAdvisorService: mortgageAdvisorService } = require('./services/mortgageAdvisorService');
const { MortgageLabService: mortgageLabService } = require('./services/mortgageLabService');
const BK = require('./core/backupCrypto');
const DP = require('./core/dataPorts');
const { IDLE_MIN_RANGE } = require('./services/authService');
const path = require('path');
const LG = require('../../shell/licensing/gate');
const GS = require('../../shell/google-signin');
const LS = require('../../shell/licensing/store');
const ROOT_KEYS = require('../../shell/licensing/root-keys');
const OC = require('../../shell/licensing/owner-core');
const { createLicenseSync } = require('../../shell/licensing/sync');
const { validateUrl } = require('../../shell/licensing/remote');
const { createChatStore } = require('../../shell/licensing/chat');
const UP = require('../../shell/licensing/update');
const PK = require('../../shell/licensing/prekeys');
const OF = require('../../shell/licensing/offer');

let db;
let licenseStore = null;
let ownerCore = null;
let licenseSync = null;
let chatStore = null;
let restTime = () => false; // מצב שבת (מוזרק מ-main.js)
let ownerChatStore = null;
let updateManager = null;
let updatesDir = null;
// הגרסה המותקנת. באנדרואיד: build-info.js (window.__ssBuildInfo) שנוצר בבנייה; בשולחן העבודה: package.json מהדיסק
// (לא require — ה-bundler של אנדרואיד אינו אורז JSON). אם חסרה — 0.0.0, וכל עדכון חתום חדש ממנה
function appVersionOf() {
  if (typeof window !== 'undefined' && window.__ssBuildInfo && window.__ssBuildInfo.version) return String(window.__ssBuildInfo.version);
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}

// מצב הרישיון הנוכחי (docs/LICENSING-DESIGN.md). לפני אתחול — כמו התקנה בלי רישוי
// כל שינוי סטטוס נרשם ביומן הביקורת ומודיע למאזינים (main.js — חסימת מודולים ומסך "מערכת מושבתת")
let lastLicenseKey = null;
const licenseListeners = [];
function licenseState() {
  const s = licenseStore ? licenseStore.current() : { mode: 'unlicensed' };
  const key = s.mode === 'unlicensed' ? 'unlicensed' : s.status;
  if (key !== lastLicenseKey) {
    const from = lastLicenseKey;
    lastLicenseKey = key;
    if (from !== null) {
      const details = JSON.stringify({ from, to: key, reasons: (s.reasons || []).map(r => ({ kind: r.kind, reason: r.reason })) });
      if (db) db.audit(null, 'license.status.change', details).catch(e => console.error('audit failed', e));
      for (const fn of licenseListeners) { try { fn(s); } catch (e) { console.error(e); } }
    }
  }
  return s;
}

// אחסון הרישוי: באנדרואיד הקוד רץ ב-WebView (יש window.localStorage, ו-fs הוא shim); בשולחן העבודה — קבצים ו-DPAPI
function licenseAdapters(userDataPath) {
  const ls = typeof window !== 'undefined' && window.localStorage;
  if (ls) return { storage: LS.webStorage(ls, 'supersuite.license'), secret: LS.webStorage(ls, 'supersuite.license.key'),
    owner: OC.prefixedWebStorage(ls, 'supersuite.owner.'),
    chat: LS.webStorage(ls, 'supersuite.chat'), ownerChat: LS.webStorage(ls, 'supersuite.owner.chat'),
    updates: LS.webStorage(ls, 'supersuite.updates'), platform: 'android',
    prekeys: LS.webStorage(ls, 'supersuite.prekeys'), ownerPrekeys: LS.webStorage(ls, 'supersuite.owner.prekeys') };
  return {
    storage: LS.fileStorage(fs, path.join(userDataPath, 'license.json')),
    secret: LS.encryptedFileSecret(fs, path.join(userDataPath, 'license-key.bin'), safeStorage),
    owner: OC.dirStorage(fs, path, path.join(userDataPath, 'owner')),
    chat: LS.fileStorage(fs, path.join(userDataPath, 'messages.json')),
    ownerChat: LS.fileStorage(fs, path.join(userDataPath, 'owner', 'messages.json')),
    updates: LS.fileStorage(fs, path.join(userDataPath, 'updates.json')),
    platform: 'win',
    // מפתחות זמניים להודעות — מוצפנים ב-DPAPI כמו מפתח המערכת
    prekeys: LS.encryptedFileSecret(fs, path.join(userDataPath, 'prekeys.bin'), safeStorage),
    ownerPrekeys: LS.encryptedFileSecret(fs, path.join(userDataPath, 'owner', 'prekeys.bin'), safeStorage),
  };
}

// מפתחות השורש שבשימוש בהתקנה הזו — לסימון "המפתח שלך מוגדר בתוכנה"
let rootKeysInUse = ROOT_KEYS;
const ROOT_KEYS_IN_USE = () => rootKeysInUse;

async function initEcon(userDataPath, { rootKeys = ROOT_KEYS, clock, licenseStorage, licenseSecret, ownerStorage, fetchImpl, chatStorage, ownerChatStorage,
  updateStorage, appVersion, platform, prekeyStorage, ownerPrekeyStorage, isRestTime = () => false, googleSignIn, openExternal } = {}) {
  restTime = isRestTime;
  googleDeps = { signIn: googleSignIn || GS.signIn, fetchImpl: fetchImpl || globalThis.fetch,
    openBrowser: openExternal || ((url) => { const sh = require('electron').shell; if (!sh || typeof sh.openExternal !== 'function') throw new Error('כניסה עם Google אינה זמינה במכשיר הזה'); return sh.openExternal(url); }) };
  const ad = licenseAdapters(userDataPath);
  // עדכוני גרסה: קבצים מאומתים נשמרים בתיקיית updates בתוך נתוני המשתמש
  updatesDir = path.join(userDataPath, 'updates');
  updateManager = UP.createUpdateManager({ storage: updateStorage || ad.updates, rootKeys, currentVersion: appVersion || appVersionOf(),
    platform: platform || ad.platform, fetchImpl: fetchImpl || globalThis.fetch, clock: clock || Date.now,
    saveFile: async (name, bytes) => {
      fs.mkdirSync(updatesDir, { recursive: true });
      const file = path.join(updatesDir, path.basename(name));
      fs.writeFileSync(file + '.part', bytes);
      fs.renameSync(file + '.part', file);
      return file;
    } });
  // מצב מנהל-העל: זמין בכל התקנה, אבל נפתח רק בסיסמה. המפתח נשמר מוצפן (SSBK1:)
  ownerCore = OC.createOwnerCore({ storage: ownerStorage || ad.owner, clock });
  rootKeysInUse = rootKeys;
  // עבודה מרחוק דרך שרת הרישוי — פעיל רק אחרי שהמנהל הגדיר כתובת (בלי כתובת: אופליין לגמרי)
  // קבצים מצורפים שמורים מקומית: באנדרואיד (localStorage מוגבל) — מעט מאוד
  const maxAttachmentBytes = ad.platform === 'android' ? 1024 * 1024 : 40 * 1024 * 1024;
  chatStore = createChatStore({ storage: chatStorage || ad.chat, clock, maxAttachmentBytes });
  ownerChatStore = createChatStore({ storage: ownerChatStorage || ad.ownerChat, clock, maxAttachmentBytes });
  // קודם המאגר ואז הסנכרון: הסנכרון מחזיק את המאגר שקיבל (בהפעלה ראשונה הוא היה null — מסך ההודעות נתקע)
  licenseStore = LS.createLicenseStore({ storage: licenseStorage || ad.storage, secret: licenseSecret || ad.secret, rootKeys, clock });
  licenseSync = createLicenseSync({ store: licenseStore, owner: ownerCore, rootKeys, fetchImpl: fetchImpl || globalThis.fetch, clock,
    chat: chatStore, ownerChat: ownerChatStore, updates: updateManager, isRestTime: () => restTime(),
    prekeys: PK.createPrekeyStore({ storage: prekeyStorage || ad.prekeys, clock: clock || Date.now }),
    ownerPrekeys: PK.createPrekeyStore({ storage: ownerPrekeyStorage || ad.ownerPrekeys, clock: clock || Date.now }) });
  db = await initializeDatabase(userDataPath);
  authService.initialize(db);
  financialService.initialize(db);
  marketIntelService.initialize(db);
  personalFinanceService.initialize(db);
  mortgageService.initialize(db);
  businessService.initialize(db);
  canvasService.initialize(db);
  tasksService.initialize(db);
  contactsService.initialize(db);
  fitnessService.initialize(db);
  voiceNotesService.initialize(db);
  accountingService.initialize(db);
  npoService.initialize(db);
  gemachService.initialize(db);
  collectService.initialize(db);
  chesedService.initialize(db);
  peopleService.initialize(db);
  privacyService.initialize(db);
  mortgageAdvisorService.initialize(db);
  mortgageLabService.initialize(db);
  const startSettings = (await db.load()).settings || {};
  authService.setIdleMinutes(startSettings.idleMinutes);
  googlePolicy = normalizeGoogle(startSettings.google);
  registerIpcHandlers();
  return db;
}

// כל ערוץ (מלבד כניסה/יציאה/סטטוס) דורש משתמש מחובר בצד השרת — לא רק במסך ה-UI
const PUBLIC_CHANNELS = new Set(['auth:status', 'auth:setup', 'auth:login', 'auth:logout', 'auth:google-login']);

// כל הפעולות על מסד הנתונים רצות אחת-אחת: כל פעולה טוענת את כל הנתונים, משנה ושומרת.
// הרצה במקביל גורמת לעדכונים שהולכים לאיבוד ולשגיאות טרנזקציה של SQLite.
let dbQueue = Promise.resolve();
function enqueue(task) {
  const run = dbQueue.then(task);
  dbQueue = run.catch(() => {});
  return run;
}

// הרשאה נדרשת לפי סוג הפעולה. ערוצי auth דורשים רק כניסה. ברירת מחדל לכתיבה: data.edit
function permissionFor(channel) {
  const name = channel.includes(':') ? channel.split(':')[1] : channel;
  if (channel.startsWith('auth:')) return null;
  if (channel.startsWith('users:') || channel.startsWith('audit:') || channel === 'settings:saveAdvanced') return 'users.manage';
  // הגדרות Google קובעות מי נכנס לתוכנה — מנהל בלבד (גם הצפייה: כוללת את פרטי הלקוח)
  if (channel === 'settings:getGoogle' || channel === 'settings:saveGoogle') return 'users.manage';
  // אימות כלל רגולטורי משנה את האזהרות לכל המשתמשים — מנהל בלבד
  if (channel === 'mlab:verifyRule' || channel === 'mlab:unverifyRule') return 'users.manage';
  // מיפוי מאגרים ומזעור נתונים (תיקון 13) — מנהל בלבד
  if (channel.startsWith('privacy:')) return 'users.manage';
  // רישוי: התקנה, הנפקת מערכות בת והשבתתן — מנהל בלבד. מצב הרישיון — לכל משתמש מחובר
  if (channel.startsWith('license:') && channel !== 'license:getStatus') return 'users.manage';
  if (channel.startsWith('owner:')) return 'users.manage';
  // עדכוני גרסה: כל משתמש רואה שיש עדכון; הורדה והתקנה — מנהל בלבד
  if (channel === 'update:getStatus') return 'data.view';
  if (channel.startsWith('update:')) return 'users.manage';
  // גבייה: קישור התשלום קובע לאן נכנס כסף — מנהל בלבד; קליטת דוח וסימון "שולם" — עריכה; ביטול — מחיקה (לפי השם)
  if (channel === 'collect:saveSettings') return 'users.manage';
  if (channel === 'collect:previewImport' || channel === 'collect:getMessage') return 'data.view';
  if (channel === 'collect:importReport') return 'data.edit';
  // הודעות: קריאה — לכל משתמש; שליחה ועריכה — data.edit; מחיקה — data.delete; הגדרות העסק (תשובות אוטומטיות, פרופיל) — מנהל
  if (['chat:overview', 'chat:thread', 'chat:refresh', 'chat:search', 'chat:starred', 'chat:getSettings', 'chat:saveAttachment'].includes(channel)) return 'data.view';
  if (channel === 'chat:deleteForMe' || channel === 'chat:deleteForAll') return 'data.delete';
  if (channel === 'chat:saveSettings' || channel === 'chat:publishProfile') return 'users.manage';
  if (channel.startsWith('chat:')) return 'data.edit';
  if (/backup/i.test(name)) return 'data.backup';
  if (/restore/i.test(name)) return 'data.restore';
  if (/export/i.test(name)) return 'data.export';
  if (/^(delete|remove|reverse|cancel|unrecord)/i.test(name) || /delete/i.test(name)) return 'data.delete';
  if (/^(get|calc|search|list|report)/i.test(name)) return 'data.view';
  return 'data.edit';
}

// בדיקת גישה לפי מזהה חלון (ה-session נשמר לפי מזהה ה-webContents שבו בוצעה הכניסה).
// משמשת קוד שלא עובר דרך handle — למשל גיבוי/שחזור מהמעטפת.
function assertAccess(senderId, permission) {
  if (!authService.getSession(senderId)) throw new Error('נדרשת כניסה למערכת (או שהפגישה פגה לאחר חוסר פעילות)');
  if (permission && !authService.hasPermission(senderId, permission)) throw new Error('אין הרשאה לפעולה זו');
  return authService.getSession(senderId);
}

// רשת ביטחון לכלל 8: שגיאה שאינה בעברית (SQLite, מערכת קבצים, באג) לא מוצגת למשתמש כמו שהיא.
// המקור נרשם ללוג, והמשתמש מקבל הודעה בעברית.
const HEBREW = /[֐-׿]/;
function toUserError(e) {
  const msg = String((e && e.message) || e || '');
  if (HEBREW.test(msg)) return e instanceof Error ? e : new Error(msg);
  console.error('econ: internal error', e);
  return new Error('הפעולה נכשלה עקב שגיאה פנימית. אם התקלה חוזרת — יש לבצע גיבוי ולפנות לתמיכה.');
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => enqueue(async () => {
    try { return await runGuarded(channel, fn, event, args); }
    catch (e) { throw toUserError(e); }
  }));
}

async function runGuarded(channel, fn, event, args) {
  if (PUBLIC_CHANNELS.has(channel)) return fn(event, ...args);
  if (!authService.getSession(event.sender.id)) {
    throw new Error('נדרשת כניסה למערכת (או שהפגישה פגה לאחר חוסר פעילות)');
  }
  const perm = permissionFor(channel);
  if (perm && !authService.hasPermission(event.sender.id, perm)) {
    throw new Error('אין הרשאה לפעולה זו');
  }
  // מדיניות: ההודעות (החלק המקוון שמזהה את השולח) רק למי שנכנס עם Google — כשהמנהל הפעיל זאת
  const gDenied = googleOnlineDenied(channel, authService.getSession(event.sender.id));
  if (gDenied) throw new Error(gDenied);
  // ההרשאה בפועל = חיתוך של התפקיד עם הרישיון: תחום שלא נפתח / מערכת מושבתת
  const denied = LG.checkChannel(licenseState(), channel, perm);
  if (denied) throw new Error(denied);
  return fn(event, ...args);
}

// ---------- כניסה עם Google ----------
// הגדרות (data.settings.google): enabled, clientId, clientSecret, onlineRequiresGoogle.
// הכניסה בסיסמה נשארת תמיד — התוכנה עובדת גם בלי אינטרנט.
let googleDeps = null;
let googlePolicy = { enabled: false, clientId: '', clientSecret: '', onlineRequiresGoogle: false };
let googleBusy = false;
function normalizeGoogle(g) {
  const x = g && typeof g === 'object' ? g : {};
  return { enabled: x.enabled === true, clientId: String(x.clientId || ''), clientSecret: String(x.clientSecret || ''),
    onlineRequiresGoogle: x.enabled === true && x.onlineRequiresGoogle === true };
}
const ONLINE_GOOGLE_CHANNELS = /^chat:/;
function googleOnlineDenied(channel, session) {
  if (!googlePolicy.onlineRequiresGoogle || !ONLINE_GOOGLE_CHANNELS.test(channel)) return null;
  return session && session.via === 'google' ? null : 'ההודעות זמינות רק אחרי כניסה עם Google. צאו והיכנסו עם Google';
}

/* ערוץ שממתין לכניסה בדפדפן (עד 3 דקות). ההמתנה רצה מחוץ לתור של מסד הנתונים — אחרת כל התוכנה נתקעת;
   הבדיקות והכתיבה (לפני ואחרי) עוברות בתור, דרך אותה אכיפת הרשאות כמו כל ערוץ */
function handleGoogle(channel, { loginHint } = {}, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (googleBusy) throw new Error('כניסה עם Google כבר פתוחה בדפדפן — השלימו אותה או המתינו');
      googleBusy = true;
      try {
        const pre = await enqueue(() => runGuarded(channel, async (ev) => {
          if (!googlePolicy.enabled) throw new Error('כניסה עם Google לא הופעלה במערכת הזו');
          return loginHint ? await loginHint(ev) : undefined;
        }, event, []));
        const identity = await googleDeps.signIn({ clientId: googlePolicy.clientId, clientSecret: googlePolicy.clientSecret },
          { openBrowser: googleDeps.openBrowser, fetchImpl: googleDeps.fetchImpl, loginHint: pre || undefined });
        return await enqueue(() => runGuarded(channel, (ev) => fn(ev, identity, ...args), event, []));
      } finally { googleBusy = false; }
    } catch (e) { throw toUserError(e); }
  });
}

// כניסה/יציאה — המעטפת פותחת או סוגרת את המודולים שדורשים כניסה (shell/login-gate.js)
const authListeners = [];
function emitAuthChange() {
  for (const fn of authListeners) { try { fn(); } catch (e) { console.error('auth listener failed', e); } }
}

// תאריך מקומי (לא UTC — בישראל toISOString מזיז את היום בין חצות ל-03:00)
function localDay(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// רישום ביקורת: מי עשה מה ומתי (נשמר בטבלת audit_events)
async function auditEvent(event, action, details) {
  const user = authService.getSession(event.sender.id);
  try { await db.audit(user && user.id, action, JSON.stringify(details || {})); } catch (e) { console.error('audit failed', e); }
}

// הפקת PDF מ-HTML: רינדור בחלון נסתר בלי JavaScript, ואז שמירה במקום שהמשתמש בוחר
async function saveHtmlAsPdf(html, defaultPath) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    const r = await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } finally {
    win.destroy();
  }
}

async function saveCsv({ headers, rows, name }) {
  const r = await dialog.showSaveDialog({ defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, X.toCsv(headers, rows), 'utf8');
  return { ok: true, path: r.filePath, rows: rows.length };
}

function registerIpcHandlers() {
  // Auth handlers
  handle('auth:status', async (event) => {
    const st = await authService.getStatus(event.sender.id);
    return { ...st, google: { enabled: googlePolicy.enabled } };
  });
  
  // יצירת המנהל הראשון (רק כשאין אף משתמש) — והוא מחובר מיד. בלי זה הממשק נראה מחובר
  // אבל לשרת אין פגישה, וכל פעולה נכשלת עד כניסה נוספת
  handle('auth:setup', async (event, username, password) => {
    const user = await authService.setupAdmin(username, password);
    authService.setSession(event.sender.id, user, 'password');
    emitAuthChange();
    return user;
  });
  
  handle('auth:login', async (event, username, password) => {
    const user = await authService.login(username, password);
    authService.setSession(event.sender.id, user, 'password');
    emitAuthChange();
    return user;
  });

  // כניסה עם Google — רק למשתמש שכבר קישר את החשבון (אחרי כניסה בסיסמה)
  handleGoogle('auth:google-login', {}, async (event, g) => {
    const user = await db.authenticateGoogle(g.sub);
    authService.setSession(event.sender.id, user, 'google');
    emitAuthChange();
    await db.audit(user.id, 'auth.google.login', JSON.stringify({ email: g.email }));
    return user;
  });
  // קישור החשבון של המשתמש המחובר. הדפדפן מציע את החשבון המקושר (אם יש) כברירת מחדל
  handleGoogle('auth:google-link', { loginHint: async (ev) => {
    const me = authService.getSession(ev.sender.id);
    const cur = await db.googleLinkOf(me.id);
    return cur && cur.email;
  } }, async (event, g) => {
    const me = authService.getSession(event.sender.id);
    const r = await db.linkGoogle(me.id, g);
    await auditEvent(event, 'auth.google.link', { email: g.email });
    return r;
  });
  handle('auth:google-unlink', async (event) => {
    const me = authService.getSession(event.sender.id);
    await db.unlinkGoogle(me.id);
    await auditEvent(event, 'auth.google.unlink', {});
    return true;
  });
  handle('auth:google-status', async (event) => {
    const me = authService.getSession(event.sender.id);
    return { enabled: googlePolicy.enabled, onlineRequiresGoogle: googlePolicy.onlineRequiresGoogle,
      link: await db.googleLinkOf(me.id), via: me.via || 'password' };
  });
  
  handle('auth:logout', async (event) => {
    const r = await authService.logout(event.sender.id);
    emitAuthChange();
    return r;
  });
  
  handle('auth:change-password', async (event, currentPassword, newPassword) => {
    const user = authService.getSession(event.sender.id);
    return await authService.changePassword(user.id, currentPassword, newPassword);
  });

  // Financial handlers
  handle('financial:calculateMetrics', async (event, data) => {
    return await financialService.calculateMetrics(data);
  });
  
  handle('financial:exportCSV', async (event, data, filename) => {
    return await financialService.exportToCSV(data, filename);
  });

  // Market Intelligence handlers
  handle('marketIntel:get', async (event) => {
    return await marketIntelService.getIntel(event.sender.id);
  });
  
  handle('marketIntel:update', async (event, intelData) => {
    return await marketIntelService.updateIntel(event.sender.id, intelData);
  });

  // Personal Finance handlers
  handle('personalFinance:get', async (event) => {
    return await personalFinanceService.getFinance(event.sender.id);
  });
  
  handle('personalFinance:update', async (event, financeData) => {
    return await personalFinanceService.updateFinance(event.sender.id, financeData);
  });
  
  handle('personalFinance:calculateLoan', async (event, loanData) => {
    return await personalFinanceService.calculateLoan(loanData);
  });
  
  handle('personalFinance:addIncome', async (event, incomeData) => {
    return await personalFinanceService.addIncome(event.sender.id, incomeData);
  });
  
  handle('personalFinance:addExpense', async (event, expenseData) => {
    return await personalFinanceService.addExpense(event.sender.id, expenseData);
  });
  
  handle('personalFinance:addInvestment', async (event, investmentData) => {
    return await personalFinanceService.addInvestment(event.sender.id, investmentData);
  });
  
  handle('personalFinance:addCashFlowEntry', async (event, cashFlowData) => {
    return await personalFinanceService.addCashFlowEntry(event.sender.id, cashFlowData);
  });

  // פריטי התוכנית הפיננסית: הוספה / עריכה / מחיקה לפי סוג (incomes/expenses/investments/cashFlowEntries)
  handle('personalFinance:addItem', async (event, kind, data) => personalFinanceService.addItem(event.sender.id, kind, data));
  handle('personalFinance:updateItem', async (event, kind, id, data) => personalFinanceService.updateItem(event.sender.id, kind, id, data));
  handle('personalFinance:deleteItem', async (event, kind, id) => {
    await personalFinanceService.deleteItem(event.sender.id, kind, id);
    await auditEvent(event, 'personalFinance.item.delete', { kind, id });
    return true;
  });

  // Mortgage handlers
  handle('mortgage:getScenarios', async (event) => {
    return await mortgageService.getScenarios(event.sender.id);
  });
  
  handle('mortgage:saveScenario', async (event, scenarioData) => {
    return await mortgageService.saveScenario(event.sender.id, scenarioData);
  });
  
  handle('mortgage:deleteScenario', async (event, scenarioId) => {
    return await mortgageService.deleteScenario(event.sender.id, scenarioId);
  });
  
  handle('mortgage:calculateLoan', async (event, loanData) => {
    return await mortgageService.calculateLoan(loanData);
  });

  // Business handlers
  handle('business:getPlans', async (event) => {
    return await businessService.getBusinessPlans(event.sender.id);
  });
  
  handle('business:savePlan', async (event, planData) => {
    return await businessService.saveBusinessPlan(event.sender.id, planData);
  });
  
  handle('business:deletePlan', async (event, planId) => {
    return await businessService.deleteBusinessPlan(event.sender.id, planId);
  });
  
  handle('business:updatePlan', async (event, planId, updates) => {
    return await businessService.updateBusinessPlan(event.sender.id, planId, updates);
  });

  // Canvas handlers
  handle('canvas:getBoards', async (event) => {
    return await canvasService.getBoards(event.sender.id);
  });
  
  handle('canvas:saveBoard', async (event, boardData) => {
    return await canvasService.saveBoard(event.sender.id, boardData);
  });
  
  handle('canvas:deleteBoard', async (event, boardId) => {
    return await canvasService.deleteBoard(event.sender.id, boardId);
  });
  
  handle('canvas:updateBoard', async (event, boardId, updates) => {
    return await canvasService.updateBoard(event.sender.id, boardId, updates);
  });

  // Tasks handlers
  handle('tasks:get', async (event) => {
    return await tasksService.getTasks(event.sender.id);
  });
  
  handle('tasks:create', async (event, taskData) => {
    return await tasksService.createTask(event.sender.id, taskData);
  });
  
  handle('tasks:update', async (event, taskId, updates) => {
    return await tasksService.updateTask(event.sender.id, taskId, updates);
  });
  
  handle('tasks:delete', async (event, taskId) => {
    return await tasksService.deleteTask(event.sender.id, taskId);
  });

  handle('tasks:getOverdueTasks', async (event) => {
    return await tasksService.getOverdueTasks(event.sender.id);
  });

  handle('tasks:getTasksByCategory', async (event, category) => {
    return await tasksService.getTasksByCategory(event.sender.id, category);
  });

  handle('tasks:getTasksByPriority', async (event, priority) => {
    return await tasksService.getTasksByPriority(event.sender.id, priority);
  });

  // Contacts handlers
  handle('contacts:get', async (event) => {
    return await contactsService.getContacts(event.sender.id);
  });
  
  handle('contacts:create', async (event, contactData) => {
    return await contactsService.createContact(event.sender.id, contactData);
  });
  
  handle('contacts:update', async (event, contactId, updates) => {
    return await contactsService.updateContact(event.sender.id, contactId, updates);
  });
  
  handle('contacts:delete', async (event, contactId) => {
    return await contactsService.deleteContact(event.sender.id, contactId);
  });

  handle('contacts:search', async (event, query) => {
    return await contactsService.searchContacts(event.sender.id, query);
  });

  // Fitness handlers
  handle('fitness:get', async (event) => {
    return await fitnessService.getFitnessData(event.sender.id);
  });
  
  handle('fitness:createWorkout', async (event, workoutData) => {
    return await fitnessService.createWorkout(event.sender.id, workoutData);
  });
  
  handle('fitness:createNutrition', async (event, nutritionData) => {
    return await fitnessService.createNutrition(event.sender.id, nutritionData);
  });
  
  handle('fitness:createMetric', async (event, metricData) => {
    return await fitnessService.createMetric(event.sender.id, metricData);
  });
  
  handle('fitness:getWorkoutsByType', async (event, type) => {
    return await fitnessService.getWorkoutsByType(event.sender.id, type);
  });
  
  handle('fitness:getMetricsByDateRange', async (event, startDate, endDate) => {
    return await fitnessService.getMetricsByDateRange(event.sender.id, startDate, endDate);
  });

  // Voice Notes handlers
  handle('voiceNotes:get', async (event) => {
    return await voiceNotesService.getVoiceNotes(event.sender.id);
  });
  
  handle('voiceNotes:create', async (event, noteData) => {
    return await voiceNotesService.createVoiceNote(event.sender.id, noteData);
  });
  
  handle('voiceNotes:update', async (event, noteId, updates) => {
    return await voiceNotesService.updateVoiceNote(event.sender.id, noteId, updates);
  });
  
  handle('voiceNotes:delete', async (event, noteId) => {
    return await voiceNotesService.deleteVoiceNote(event.sender.id, noteId);
  });

  handle('voiceNotes:search', async (event, query) => {
    return await voiceNotesService.searchVoiceNotes(event.sender.id, query);
  });

  // Market Intelligence: delete and update entry
  handle('marketIntel:deleteEntry', async (event, entryId) => {
    return await marketIntelService.deleteEntry(event.sender.id, entryId);
  });
  handle('marketIntel:updateEntry', async (event, entryId, updates) => {
    return await marketIntelService.updateEntry(event.sender.id, entryId, updates);
  });
  
  // Mortgage: update scenario
  handle('mortgage:updateScenario', async (event, scenarioId, updates) => {
    return await mortgageService.updateScenario(event.sender.id, scenarioId, updates);
  });

  // Accounting: תוכנית חשבונות, יומן, חשבוניות, דוחות ומע"מ
  handle('acct:getChart', async () => accountingService.getChart());
  handle('acct:addAccount', async (event, account) => {
    const result = await accountingService.addAccount(account);
    await auditEvent(event, 'acct.account.add', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getJournal', async (event, range) => accountingService.getJournal(range || {}));
  handle('acct:createEntry', async (event, entry) => {
    const result = await accountingService.createEntry(entry);
    await auditEvent(event, 'acct.entry.create', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:reverseEntry', async (event, entryId) => {
    const result = await accountingService.reverseEntry(entryId);
    await auditEvent(event, 'acct.entry.reverse', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getInvoices', async () => accountingService.getInvoices());
  handle('acct:createInvoice', async (event, invoice) => {
    const result = await accountingService.createInvoice(invoice);
    await auditEvent(event, 'acct.invoice.create', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:recordPayment', async (event, invoiceId, payment) => {
    const result = await accountingService.recordPayment(invoiceId, payment || {});
    await auditEvent(event, 'acct.invoice.paid', { id: result && (result.id || result.number) });
    return result;
  });
  handle('acct:getReports', async (event, range) => accountingService.getReports(range || {}));
  handle('acct:setVatRate', async (event, rate) => accountingService.setVatRate(rate));
  handle('acct:getSettings', async () => accountingService.getSettings());
  handle('acct:getProducts', async () => accountingService.getProducts());
  handle('acct:importProducts', async (event, csvText) => {
    const result = await accountingService.importProducts(csvText);
    await auditEvent(event, 'acct.product.import', { added: result.added, errors: result.errors.length });
    return result;
  });
  handle('acct:getPeriodSummary', async (event, range) => accountingService.getPeriodSummary(range || {}));
  handle('acct:getInvoiceAnalytics', async () => accountingService.getInvoiceAnalytics());
  handle('acct:unrecordPayment', async (event, invoiceId) => {
    const result = await accountingService.unrecordPayment(invoiceId);
    await auditEvent(event, 'acct.invoice.unpaid', { number: result.number });
    return result;
  });

  // הוצאות אישיות/משפחתיות — רשימה נפרדת מהיומן העסקי
  handle('personal:getEntries', async (event, range) => accountingService.getPersonal(range || {}));
  handle('personal:getSummary', async (event, range) => accountingService.getPersonalSummary(range || {}));
  handle('personal:addEntry', async (event, entry) => {
    const result = await accountingService.addPersonal(entry);
    await auditEvent(event, 'personal.entry.add', { id: result.id });
    return result;
  });
  handle('personal:deleteEntry', async (event, entryId) => {
    await accountingService.deletePersonal(entryId);
    await auditEvent(event, 'personal.entry.delete', { id: entryId });
    return true;
  });
  handle('acct:addProduct', async (event, product) => {
    const result = await accountingService.addProduct(product);
    await auditEvent(event, 'acct.product.add', { id: result.id });
    return result;
  });
  handle('acct:deleteProduct', async (event, productId) => {
    await accountingService.deleteProduct(productId);
    await auditEvent(event, 'acct.product.delete', { id: productId });
    return true;
  });
  handle('acct:calcPrice', async (event, input) => accountingService.calcPrice(input));
  handle('acct:cancelInvoice', async (event, invoiceId) => {
    const result = await accountingService.cancelInvoice(invoiceId);
    await auditEvent(event, 'acct.invoice.cancel', { number: result.number });
    return result;
  });
  handle('acct:saveSettings', async (event, input) => {
    const saved = await accountingService.saveSettings(input);
    await auditEvent(event, 'acct.settings.save', { lockDate: saved.lockDate, vatRate: saved.vatRate });
    return saved;
  });
  handle('acct:exportInvoicePdf', async (event, invoiceId) => {
    const inv = await accountingService.getInvoice(invoiceId);
    const { business } = await accountingService.getSettings();
    const html = X.renderInvoiceHtml(inv, business);
    // רינדור במופע חלון נסתר ואז הדפסה ל-PDF, כך שהפלט זהה למה שרואים
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      const r = await dialog.showSaveDialog({ defaultPath: `חשבונית-${inv.number}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return { ok: false };
      fs.writeFileSync(r.filePath, pdf);
      await auditEvent(event, 'acct.invoice.pdf', { number: inv.number });
      return { ok: true, path: r.filePath };
    } finally {
      win.destroy();
    }
  });
  handle('acct:exportCsv', async (event, kind, range) => {
    const { headers, rows, name } = await accountingService.getExportData(kind, range || {});
    const r = await dialog.showSaveDialog({ defaultPath: `${name}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, X.toCsv(headers, rows), 'utf8');
    await auditEvent(event, 'acct.export.csv', { kind, rows: rows.length });
    return { ok: true, path: r.filePath };
  });

  // עמותות: תרומות וקבלות סעיף 46, קרנות, תמיכות ודוח שנתי — נפרד מהיומן העסקי
  handle('npo:getOverview', async (event, year) => npoService.getOverview(year));
  handle('npo:saveSettings', async (event, input) => {
    const saved = await npoService.saveSettings(input || {});
    await auditEvent(event, 'npo.settings.save', { vatStatus: saved.vatStatus, funds: saved.funds.length });
    return saved;
  });
  handle('npo:addDonation', async (event, input) => {
    const d = await npoService.addDonation(input);
    await auditEvent(event, 'npo.donation.add', { receipt: d.receipt.number });
    return d;
  });
  handle('npo:cancelDonation', async (event, id) => {
    const d = await npoService.cancelDonation(id);
    await auditEvent(event, 'npo.donation.cancel', { receipt: d.receipt.number });
    return d;
  });
  handle('npo:addGrant', async (event, input) => {
    const g = await npoService.addGrant(input);
    await auditEvent(event, 'npo.grant.add', { id: g.id });
    return g;
  });
  handle('npo:updateGrant', async (event, id, input) => {
    const g = await npoService.updateGrant(id, input || {});
    await auditEvent(event, 'npo.grant.update', { id });
    return g;
  });
  handle('npo:toggleGrantDocument', async (event, id, index) => {
    const g = await npoService.toggleGrantDocument(id, index);
    await auditEvent(event, 'npo.grant.document', { id, index });
    return g;
  });
  handle('npo:recordTaxReport', async (event, id, input) => {
    const d = await npoService.recordTaxReport(id, input || {});
    await auditEvent(event, 'npo.tax.report', { receipt: d.receipt.number, status: d.taxStatus });
    return d;
  });
  handle('npo:deleteGrant', async (event, id) => {
    await npoService.deleteGrant(id);
    await auditEvent(event, 'npo.grant.delete', { id });
    return true;
  });
  handle('npo:exportCsv', async (event, kind, year) => {
    const r = await saveCsv(await npoService.getExportData(kind, year));
    if (r.ok) await auditEvent(event, 'npo.export.csv', { kind, year, rows: r.rows });
    return r;
  });
  // הוראות קבע — מעקב בלבד. סימון "התקבל" מפיק קבלה רגילה
  handle('npo:getStandingOrders', async (event, today) => npoService.getStandingOrders(today));
  handle('npo:saveStandingOrder', async (event, id, input) => {
    const o = await npoService.saveStandingOrder(id || null, input);
    await auditEvent(event, id ? 'npo.standing.update' : 'npo.standing.create', { id: o.id, amount: o.amount });
    return o;
  });
  handle('npo:recordStandingPayment', async (event, id, month, status, date) => {
    const r = await npoService.recordStandingPayment(id, month, status, date);
    await auditEvent(event, 'npo.standing.' + status, { id, month, receipt: r.donation ? r.donation.receipt.number : null });
    return r;
  });
  handle('npo:deleteStandingOrder', async (event, id) => {
    await npoService.deleteStandingOrder(id);
    await auditEvent(event, 'npo.standing.delete', { id });
    return true;
  });
  // קמפיינים — יעד, תקופה ותורם מכפיל; ההתקדמות מגיעה עם getOverview
  handle('npo:saveCampaign', async (event, id, input) => {
    const cmp = await npoService.saveCampaign(id || null, input);
    await auditEvent(event, id ? 'npo.campaign.update' : 'npo.campaign.create', { id: cmp.id, goal: cmp.goal });
    return cmp;
  });
  handle('npo:deleteCampaign', async (event, id) => {
    await npoService.deleteCampaign(id);
    await auditEvent(event, 'npo.campaign.delete', { id });
    return true;
  });
  // הנצחות ויארצייטים — לפי תאריך עברי
  handle('npo:getMemorials', async (event, today, days) => npoService.getMemorials(today, days));
  handle('npo:saveMemorial', async (event, id, input) => {
    const m = await npoService.saveMemorial(id || null, input);
    await auditEvent(event, id ? 'npo.memorial.update' : 'npo.memorial.create', { id: m.id });
    return m;
  });
  handle('npo:deleteMemorial', async (event, id) => {
    await npoService.deleteMemorial(id);
    await auditEvent(event, 'npo.memorial.delete', { id });
    return true;
  });
  handle('npo:exportMemorialsCsv', async (event) => {
    const r = await saveCsv(await npoService.getMemorialsExport());
    if (r.ok) await auditEvent(event, 'npo.memorial.export', { rows: r.rows });
    return r;
  });
  // ייבוא תרומות מקובץ של ערוץ חיצוני (נדרים פלוס וכדומה) — קובץ בלבד, ללא חיבור לרשת
  handle('npo:previewImport', async (event, csvText, source) => npoService.previewImport(csvText, source));
  handle('npo:importDonations', async (event, csvText, options) => {
    const r = await npoService.importDonations(csvText, options || {});
    await auditEvent(event, 'npo.donation.import', { source: options && options.source, receipts: options && options.receipts, imported: r.imported, total: r.total, skipped: r.skipped, errors: r.errors.length });
    return r;
  });
  handle('npo:exportDonorStatementPdf', async (event, donorKey, year) => {
    const st = await npoService.getDonorStatement(donorKey, year);
    const safe = String(st.donor.name).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'תורם';
    const r = await saveHtmlAsPdf(X.renderDonorStatementHtml(st), `סיכום-תרומות-${st.year}-${safe}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.statement.pdf', { year: st.year, receipts: st.receipts.length });
    return r;
  });
  handle('npo:exportReceiptPdf', async (event, id) => {
    const d = await npoService.getDonation(id);
    if (d.receipt && d.receipt.external) throw new Error('הקבלה לתרומה זו הופקה בערוץ התרומה עצמו — יש להפיק אותה משם');
    const r = await saveHtmlAsPdf(X.renderDonationReceiptHtml(d), `קבלה-${d.receipt.number}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.receipt.pdf', { receipt: d.receipt.number });
    return r;
  });

  // גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים — נפרד מהעמותה ומהיומן העסקי
  // ---------- גבייה מלקוחות של הארגון (core/collect.js) ----------
  // התשלום נרשם בתחום אחר (חשבוניות / עמותה / גמ"ח) — ולכן נבדק גם הרישיון של אותו תחום, לא רק של הערוץ
  const COLLECT_DOMAIN = { invoice: 'acct:x', donation: 'npo:x', gemach: 'gemach:x' };
  const assertCollectDomain = (kind) => {
    const ch = COLLECT_DOMAIN[kind];
    const denied = ch && LG.checkChannel(licenseState(), ch, 'data.edit');
    if (denied) throw new Error(denied);
  };
  handle('collect:getOverview', async () => collectService.getOverview());
  handle('collect:saveSettings', async (event, input) => {
    const s = await collectService.saveSettings(input || {});
    await auditEvent(event, 'collect.settings', { provider: s.provider, link: !!s.linkTemplate });
    return s;
  });
  handle('collect:createRequest', async (event, input) => {
    assertCollectDomain(input && input.kind);
    const r = await collectService.createRequest(input || {});
    await auditEvent(event, 'collect.request', { ref: r.ref, kind: r.kind, amountAg: r.amountAg });
    return r;
  });
  handle('collect:getMessage', async (event, id) => {
    const { npo } = await npoService._load();
    return collectService.getMessage(String(id || ''), npo.settings.orgName);
  });
  handle('collect:cancelRequest', async (event, id) => {
    const r = await collectService.cancelRequest(String(id || ''));
    await auditEvent(event, 'collect.cancel', { ref: r.ref });
    return r;
  });
  handle('collect:markPaid', async (event, id, input) => {
    const { payments } = await collectService._load();
    const req = payments.requests.find(x => x.id === id);
    if (req) assertCollectDomain(req.kind);
    const r = await collectService.markPaid(String(id || ''), input || {});
    await auditEvent(event, 'collect.paid', { ref: r.ref, source: 'manual', txId: r.payment.txId });
    return r;
  });
  handle('collect:previewImport', async (event, csvText) => collectService.previewImport(String(csvText || '')));
  handle('collect:importReport', async (event, csvText, mapping) => {
    // תחום שאינו ברישיון — לא קולטים (אחרת הייבוא היה רושם בו תשלומים)
    const { payments } = await collectService._load();
    for (const kind of new Set(payments.requests.filter(r => r.status === 'open').map(r => r.kind))) assertCollectDomain(kind);
    const r = await collectService.importReport(String(csvText || ''), mapping || {});
    await auditEvent(event, 'collect.import', { recorded: r.recorded.length, failed: r.failed.length, unmatched: r.unmatched.length });
    return r;
  });

  handle('gemach:getOverview', async (event, asOf) => gemachService.getOverview(asOf));
  handle('gemach:getLoan', async (event, id) => gemachService.getLoan(id));
  handle('gemach:saveSettings', async (event, input) => {
    const saved = await gemachService.saveSettings(input || {});
    await auditEvent(event, 'gemach.settings.save', { fundName: saved.fundName });
    return saved;
  });
  handle('gemach:addLoan', async (event, input) => {
    const l = await gemachService.addLoan(input);
    await auditEvent(event, 'gemach.loan.add', { id: l.id, amount: l.amount });
    return l;
  });
  handle('gemach:recordPayment', async (event, loanId, seq, input) => {
    const l = await gemachService.recordPayment(loanId, seq, input || {});
    await auditEvent(event, 'gemach.loan.payment', { id: loanId, seq });
    return l;
  });
  handle('gemach:cancelLoan', async (event, loanId) => {
    const l = await gemachService.cancelLoan(loanId);
    await auditEvent(event, 'gemach.loan.cancel', { id: loanId });
    return l;
  });
  handle('gemach:addDeposit', async (event, input) => {
    const d = await gemachService.addDeposit(input);
    await auditEvent(event, 'gemach.deposit.add', { id: d.id, amount: d.amount });
    return d;
  });
  handle('gemach:deleteDeposit', async (event, id) => {
    await gemachService.deleteDeposit(id);
    await auditEvent(event, 'gemach.deposit.delete', { id });
    return true;
  });
  // בקשות הלוואה — אישור יוצר הלוואה
  handle('gemach:saveApplication', async (event, id, input) => {
    const a = await gemachService.saveApplication(id || null, input || {});
    await auditEvent(event, id ? 'gemach.application.update' : 'gemach.application.create', { id: a.id, amount: a.amount });
    return a;
  });
  handle('gemach:moveApplication', async (event, id, to, input) => {
    const r = await gemachService.moveApplication(id, to, input || {});
    await auditEvent(event, 'gemach.application.' + to, { id, loanId: r.loan ? r.loan.id : null });
    return r;
  });
  handle('gemach:deleteApplication', async (event, id) => {
    await gemachService.deleteApplication(id);
    await auditEvent(event, 'gemach.application.delete', { id });
    return true;
  });
  // גמ"ח חפצים
  handle('gemach:saveItem', async (event, id, input) => {
    const it = await gemachService.saveItem(id || null, input || {});
    await auditEvent(event, id ? 'gemach.item.update' : 'gemach.item.create', { id: it.id });
    return it;
  });
  handle('gemach:deleteItem', async (event, id) => {
    await gemachService.deleteItem(id);
    await auditEvent(event, 'gemach.item.delete', { id });
    return true;
  });
  handle('gemach:lendItem', async (event, id, input) => {
    const l = await gemachService.lendItem(id, input || {});
    await auditEvent(event, 'gemach.item.lend', { itemId: id, deposit: l.depositHeld });
    return l;
  });
  handle('gemach:returnItem', async (event, id, input) => {
    const l = await gemachService.returnItem(id, input || {});
    await auditEvent(event, 'gemach.item.return', { itemId: id, depositReturned: l.depositReturned });
    return l;
  });
  handle('gemach:exportCsv', async (event, kind) => {
    const r = await saveCsv(await gemachService.getExportData(kind));
    if (r.ok) await auditEvent(event, 'gemach.export.csv', { kind, rows: r.rows });
    return r;
  });

  // חסד וחלוקות: נזקקים, מתנדבים וסבבי חלוקה. פרטי נזקק חסוי (מתן בסתר) — למנהל בלבד
  const canSeeConfidential = (event) => authService.hasPermission(event.sender.id, 'users.manage');
  // מאגר אנשים — קריאה בלבד. נזקק חסוי נכלל רק למי שמורשה לראות חסויים (כמו במסך החסד)
  handle('people:search', async (event, query) => peopleService.search(query, canSeeConfidential(event)));
  handle('people:getCard', async (event, key) => {
    const c = await peopleService.getCard(key, canSeeConfidential(event));
    if (c.beneficiary.some(b => b.confidential)) await auditEvent(event, 'chesed.confidential.view', { via: 'people', key });
    return c;
  });
  handle('chesed:getOverview', async (event) => {
    const o = await chesedService.getOverview(canSeeConfidential(event));
    const shown = o.beneficiaries.filter(b => b.tier === 'confidential' && !b.masked).length;
    if (shown) await auditEvent(event, 'chesed.confidential.view', { via: 'overview', count: shown });
    return o;
  });
  handle('privacy:getMap', async () => privacyService.getMap(await db.listUsers()));
  handle('privacy:retentionPreview', async (event, years) => privacyService.retentionPreview(years));
  handle('privacy:minimize', async (event, ids, years) => {
    const r = await privacyService.minimize(ids, years);
    await auditEvent(event, 'chesed.privacy.minimize', { years, minimized: r.minimized, skipped: r.skipped });
    return r;
  });
  handle('chesed:addBeneficiary', async (event, input) => {
    const b = await chesedService.addBeneficiary(input, canSeeConfidential(event));
    await auditEvent(event, 'chesed.beneficiary.add', { id: b.id, tier: b.tier });
    return b;
  });
  handle('chesed:updateBeneficiary', async (event, id, input) => {
    const b = await chesedService.updateBeneficiary(id, input || {}, canSeeConfidential(event));
    await auditEvent(event, 'chesed.beneficiary.update', { id });
    return b;
  });
  handle('chesed:deleteBeneficiary', async (event, id) => {
    await chesedService.deleteBeneficiary(id);
    await auditEvent(event, 'chesed.beneficiary.delete', { id });
    return true;
  });
  handle('chesed:addVolunteer', async (event, input) => {
    const v = await chesedService.addVolunteer(input);
    await auditEvent(event, 'chesed.volunteer.add', { id: v.id });
    return v;
  });
  handle('chesed:updateVolunteer', async (event, id, input) => {
    const v = await chesedService.updateVolunteer(id, input || {});
    await auditEvent(event, 'chesed.volunteer.update', { id });
    return v;
  });
  handle('chesed:deleteVolunteer', async (event, id) => {
    await chesedService.deleteVolunteer(id);
    await auditEvent(event, 'chesed.volunteer.delete', { id });
    return true;
  });
  handle('chesed:addRound', async (event, input) => {
    const r = await chesedService.addRound(input);
    await auditEvent(event, 'chesed.round.add', { id: r.id, name: r.name });
    return r;
  });
  handle('chesed:allocateRound', async (event, roundId) => {
    const r = await chesedService.allocateRound(roundId);
    await auditEvent(event, 'chesed.round.allocate', { id: roundId, added: r.added });
    return r;
  });
  handle('chesed:assignVolunteer', async (event, roundId, beneficiaryId, volunteerId) => {
    const r = await chesedService.assignVolunteer(roundId, beneficiaryId, volunteerId || '');
    await auditEvent(event, 'chesed.round.assign', { id: roundId, beneficiaryId, volunteerId: volunteerId || '' });
    return r;
  });
  handle('chesed:markDelivered', async (event, roundId, beneficiaryId, delivered, date) => {
    const s = await chesedService.markDelivered(roundId, beneficiaryId, !!delivered, date);
    await auditEvent(event, 'chesed.round.deliver', { id: roundId, beneficiaryId, delivered: !!delivered });
    return s;
  });
  handle('chesed:closeRound', async (event, roundId) => {
    const r = await chesedService.closeRound(roundId);
    await auditEvent(event, 'chesed.round.close', { id: roundId });
    return r;
  });
  handle('chesed:deleteRound', async (event, roundId) => {
    await chesedService.deleteRound(roundId);
    await auditEvent(event, 'chesed.round.delete', { id: roundId });
    return true;
  });
  handle('chesed:exportCsv', async (event, kind, roundId) => {
    const r = await saveCsv(await chesedService.getExportData(kind, canSeeConfidential(event), roundId));
    if (r.ok) await auditEvent(event, 'chesed.export.csv', { kind, roundId: roundId || '', rows: r.rows, confidential: canSeeConfidential(event) });
    return r;
  });

  // ייעוץ משכנתאות: תיקים, הצעות, השוואה, עמלה ומסמכים
  handle('madv:getOverview', async () => mortgageAdvisorService.getOverview());
  handle('madv:calcTracks', async (event, input) => mortgageAdvisorService.calcTracks(input || {}));
  handle('madv:createClient', async (event, input) => {
    const c = await mortgageAdvisorService.createClient(input);
    await auditEvent(event, 'madv.client.create', { id: c.id });
    return c;
  });
  handle('madv:updateClient', async (event, id, input) => {
    const c = await mortgageAdvisorService.updateClient(id, input || {});
    await auditEvent(event, 'madv.client.update', { id, status: c.status });
    return c;
  });
  handle('madv:deleteClient', async (event, id) => {
    await mortgageAdvisorService.deleteClient(id);
    await auditEvent(event, 'madv.client.delete', { id });
    return true;
  });
  handle('madv:toggleDoc', async (event, id, key) => mortgageAdvisorService.toggleDoc(id, key));
  handle('madv:addOffer', async (event, input) => {
    const o = await mortgageAdvisorService.addOffer(input);
    await auditEvent(event, 'madv.offer.add', { id: o.id, clientId: o.clientId });
    return o;
  });
  handle('madv:deleteOffer', async (event, id) => {
    await mortgageAdvisorService.deleteOffer(id);
    await auditEvent(event, 'madv.offer.delete', { id });
    return true;
  });
  handle('madv:exportSchedule', async (event, offerId) => {
    const r = await saveCsv(await mortgageAdvisorService.getScheduleExport(offerId));
    if (r.ok) await auditEvent(event, 'madv.export.schedule', { offerId });
    return r;
  });

  // מעבדת תמהיל: מנוע התמהיל המלא, סלים אחידים, כושר החזר, מחזור, אישורים, עמלת פירעון ואופטימייזר
  handle('mlab:getOverview', async () => mortgageLabService.getOverview());
  handle('mlab:calcMix', async (event, input) => mortgageLabService.calcMix(input || {}));
  handle('mlab:calcBaskets', async (event, input) => mortgageLabService.calcBaskets(input || {}));
  handle('mlab:calcAffordability', async (event, input) => mortgageLabService.calcAffordability(input || {}));
  handle('mlab:calcRefinance', async (event, input) => mortgageLabService.calcRefinance(input || {}));
  handle('mlab:calcApprovals', async (event, input) => mortgageLabService.calcApprovals(input || {}));
  handle('mlab:calcPrepayment', async (event, input) => mortgageLabService.calcPrepayment(input || {}));
  handle('mlab:calcOptimize', async (event, input) => mortgageLabService.calcOptimize(input || {}));
  handle('mlab:saveForecast', async (event, input) => {
    const r = await mortgageLabService.saveForecast(input || {});
    await auditEvent(event, 'mlab.forecast.save', { id: r.id });
    return r;
  });
  handle('mlab:resetForecast', async (event) => {
    const r = await mortgageLabService.resetForecast();
    await auditEvent(event, 'mlab.forecast.reset', {});
    return r;
  });
  handle('mlab:verifyRule', async (event, ruleId, note) => {
    const me = authService.getSession(event.sender.id);
    await mortgageLabService.verifyRule(ruleId, note, me && me.id);
    await auditEvent(event, 'mlab.rule.verify', { ruleId, note });
    return true;
  });
  handle('mlab:unverifyRule', async (event, ruleId) => {
    await mortgageLabService.unverifyRule(ruleId);
    await auditEvent(event, 'mlab.rule.unverify', { ruleId });
    return true;
  });
  handle('mlab:saveScenario', async (event, input) => {
    const sc = await mortgageLabService.saveScenario(input || {});
    await auditEvent(event, 'mlab.scenario.save', { id: sc.id, clientId: sc.clientId });
    return sc;
  });
  handle('mlab:deleteScenario', async (event, id) => {
    await mortgageLabService.deleteScenario(id);
    await auditEvent(event, 'mlab.scenario.delete', { id });
    return true;
  });
  handle('mlab:exportScenario', async (event, id) => {
    const r = await saveCsv(await mortgageLabService.getScenarioExport(id));
    if (r.ok) await auditEvent(event, 'mlab.export.schedule', { id });
    return r;
  });

  // ---------- הגדרות מתקדמות ----------
  const VIEWS_ALLOWED = ['dashboard', 'acct-reports', 'acct-invoices', 'acct-journal', 'personal-finance', 'finance', 'contacts', 'tasks', 'npo', 'gemach', 'chesed', 'people', 'mortgage-advisor', 'mortgage-lab'];
  handle('settings:getAdvanced', async (event) => {
    const data = await db.load();
    const st = data.settings || {};
    const me = authService.getSession(event.sender.id);
    const counts = {};
    for (const k of DP.listKinds()) counts[k.id] = DP.KINDS[k.id].store.get(data).length;
    return {
      idleMinutes: Math.round(authService.idleMs / 60000), idleRange: IDLE_MIN_RANGE,
      startView: VIEWS_ALLOWED.includes(st.startView) ? st.startView : 'dashboard',
      views: VIEWS_ALLOWED, isAdmin: !!(me && me.permissions.includes('users.manage')),
      me: me ? { id: me.id, username: me.username, roles: me.roles } : null,
      kinds: DP.listKinds(), counts
    };
  });
  handle('settings:saveAdvanced', async (event, input = {}) => {
    const data = await db.load();
    const idle = Number(input.idleMinutes);
    if (!Number.isInteger(idle) || idle < IDLE_MIN_RANGE[0] || idle > IDLE_MIN_RANGE[1]) throw new Error(`זמן הניתוק חייב להיות בין ${IDLE_MIN_RANGE[0]} ל-${IDLE_MIN_RANGE[1]} דקות`);
    const startView = VIEWS_ALLOWED.includes(input.startView) ? input.startView : 'dashboard';
    data.settings = { ...(data.settings || {}), idleMinutes: idle, startView };
    await db.save(data);
    authService.setIdleMinutes(idle);
    await auditEvent(event, 'settings.advanced.save', { idleMinutes: idle, startView });
    return { idleMinutes: idle, startView };
  });

  // ---------- כניסה עם Google: הגדרות (מנהל בלבד) ----------
  handle('settings:getGoogle', async () => {
    const g = googlePolicy;
    return { enabled: g.enabled, clientId: g.clientId, hasSecret: !!g.clientSecret, onlineRequiresGoogle: g.onlineRequiresGoogle };
  });
  handle('settings:saveGoogle', async (event, input = {}) => {
    const i = input && typeof input === 'object' ? input : {};
    const enabled = i.enabled === true;
    // סוד ריק = משאירים את הקיים (המסך לא מציג אותו)
    const secret = i.clientSecret === undefined || i.clientSecret === '' ? googlePolicy.clientSecret : String(i.clientSecret);
    const next = { enabled, clientId: String(i.clientId || '').trim(), clientSecret: secret.trim(), onlineRequiresGoogle: enabled && i.onlineRequiresGoogle === true };
    if (enabled) GS.validateConfig(next);
    const data = await db.load();
    data.settings = { ...(data.settings || {}), google: next };
    await db.save(data);
    googlePolicy = normalizeGoogle(next);
    await auditEvent(event, 'settings.google.save', { enabled, clientId: next.clientId, onlineRequiresGoogle: next.onlineRequiresGoogle });
    return { enabled, clientId: next.clientId, hasSecret: !!next.clientSecret, onlineRequiresGoogle: next.onlineRequiresGoogle };
  });

  // ---------- משתמשים ותפקידים (מנהל בלבד) ----------
  handle('users:list', async () => db.listUsers());
  // מגבלת משתמשים פעילים לפי הרישיון
  const assertUserLimit = async (extra) => {
    const active = (await db.listUsers()).filter(u => u.active).length;
    const denied = LG.checkUserLimit(licenseState(), active + extra);
    if (denied) throw new Error(denied);
  };
  handle('users:create', async (event, input = {}) => {
    await assertUserLimit(1);
    const u = await db.createUser(String(input.username || '').trim(), String(input.password || ''), input.role);
    await auditEvent(event, 'users.create', { username: u.username, role: u.role });
    return u;
  });
  handle('users:update', async (event, id, input = {}) => {
    const me = authService.getSession(event.sender.id);
    if (me && me.id === id && (input.active === false || (input.role && input.role !== 'admin'))) throw new Error('לא ניתן לחסום או להוריד את ההרשאות של המשתמש המחובר עצמו');
    if (input.active === true) {
      const cur = (await db.listUsers()).find(x => x.id === id);
      if (cur && !cur.active) await assertUserLimit(1);
    }
    const u = await db.updateUser(id, { role: input.role, active: input.active });
    authService.dropUser(id);
    await auditEvent(event, 'users.update', { username: u.username, role: u.role, active: u.active });
    return u;
  });
  handle('users:resetPassword', async (event, id, password) => {
    await db.resetPassword(id, String(password || ''));
    authService.dropUser(id);
    await auditEvent(event, 'users.resetPassword', { id });
    return true;
  });
  // שמירת קובץ רישוי (בקשה / רישיון / אישור / הודעות) בבוחר שמירה — המשתמש מעביר אותו בעצמו
  async function saveLicenseFile(text, name) {
    const safe = String(name || 'license').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 60) || 'license';
    const r = await dialog.showSaveDialog({ defaultPath: safe + '.sslic', filters: [{ name: 'קובץ רישוי', extensions: ['sslic'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, String(text), 'utf8');
    return { ok: true, path: r.filePath };
  }
  handle('license:saveFile', async (event, text, name) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('תוכן הקובץ אינו תקין');
    return saveLicenseFile(text, name);
  });

  // ---------- מצב מנהל-העל (Owner) ----------
  const ownerAudit = (event, action, details) => auditEvent(event, 'owner.' + action, details);
  handle('owner:getState', async () => {
    const initialized = ownerCore.isInitialized();
    const unlocked = ownerCore.isUnlocked();
    if (!initialized || !unlocked) return { initialized, unlocked: false };
    const configured = (ROOT_KEYS_IN_USE() || []).some(k => k.x === ownerCore.pubkey().x);
    return { initialized, unlocked, publicKey: ownerCore.pubkey(), configured, recovery: ownerCore.recoveryInfo(), ...ownerCore.list() };
  });
  handle('owner:init', async (event, passphrase) => {
    const r = ownerCore.init(passphrase);
    await ownerAudit(event, 'init', { keyId: r.keyId });
    return { keyId: r.keyId, publicKey: r.publicKey };
  });
  handle('owner:unlock', async (event, passphrase) => {
    try { const r = ownerCore.unlock(passphrase); await ownerAudit(event, 'unlock', r); return r; }
    catch (e) { await ownerAudit(event, 'unlock.failed', {}); throw e; }
  });
  handle('owner:lock', async () => { ownerCore.lock(); return true; });
  handle('owner:openRequest', async (event, text) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('הקובץ אינו תקין');
    return ownerCore.openRequest(text);
  });
  handle('owner:issue', async (event, input = {}) => {
    const r = ownerCore.issue(input || {});
    await ownerAudit(event, 'tenant.issue', { id: r.id, name: r.name, slot: r.slot, renewal: r.renewal, features: (input || {}).features, limits: (input || {}).limits });
    return r;
  });
  handle('owner:approve', async (event, input = {}) => {
    const r = ownerCore.approve(input || {});
    await ownerAudit(event, 'child.approve', { childId: r.childId, name: r.name, parent: r.parentName, slot: r.slot });
    return r;
  });
  handle('owner:reject', async (event, input = {}) => {
    const rv = ownerCore.review(input || {});
    const reason = String((input || {}).reason || '').trim();
    if (!reason) throw new Error('חובה לציין סיבה');
    await ownerAudit(event, 'child.reject', { childId: rv.childId, name: rv.name, parent: rv.parentName, reason });
    return true;
  });
  handle('owner:notice', async (event, input = {}) => {
    const n = ownerCore.notice(input || {});
    await ownerAudit(event, 'notice.' + n.type, { target: n.target, kind: n.kind, holdId: n.holdId, reason: n.reason });
    return n;
  });
  handle('owner:revoke', async (event, input = {}) => {
    const n = ownerCore.revoke(input || {});
    await ownerAudit(event, 'child.revoke', { childId: n.target, reason: n.reason });
    return n;
  });
  handle('owner:noticesPackage', async (event, target) => ownerCore.noticesPackage(String(target || '')));

  // ---------- עבודה מרחוק (שרת רישוי) ----------
  handle('license:getRemote', async () => {
    const r = licenseStore.getRemoteSettings();
    const info = licenseStore.syncInfo();
    return { url: r.url || '', lastSync: r.lastSync || null, myCode: info.nodeId,
      pending: (r.pendingChildRequests || []).map(({ keyId, name, at }) => ({ keyId, name, at })) };
  });
  handle('license:setRemote', async (event, url) => {
    const clean = url ? validateUrl(url) : '';
    licenseStore.setRemoteSettings({ url: clean });
    await auditEvent(event, 'license.remote.set', { url: clean });
    return { url: clean };
  });
  handle('license:remoteRequest', async (event, name) => {
    const r = await licenseSync.sendLicenseRequest(name);
    await auditEvent(event, 'license.remote.request', r);
    return r;
  });
  handle('license:remoteRequestFromParent', async (event, name, parentCode) => {
    const r = await licenseSync.sendRequestToParent(name, parentCode);
    await auditEvent(event, 'license.remote.requestParent', { parent: parentCode, keyId: r.keyId });
    return r;
  });
  handle('license:remoteSync', async (event) => {
    const r = await licenseSync.receive();
    if (r.handled) await auditEvent(event, 'license.remote.sync', { handled: r.handled, errors: r.errors.length });
    licenseState();
    return r;
  });
  handle('license:remoteForwardChild', async (event, input = {}) => {
    const { keyId, ...terms } = input || {};
    const r = await licenseSync.forwardChildRequest(keyId, terms);
    await auditEvent(event, 'license.remote.childApprovalRequest', { childId: r.childId, features: terms.features, limits: terms.limits });
    return r;
  });
  handle('license:remoteDismissChild', async (event, keyId) => {
    licenseSync.dismissChildRequest(keyId);
    await auditEvent(event, 'license.remote.childDismiss', { keyId });
    return true;
  });
  // השבתה/החזרה/סיום של מערכת בת — ומיד שליחה אליה כשיש שרת
  handle('license:remotePushChild', async (event, childId) => {
    const pkg = licenseStore.noticesForChild(String(childId || ''));
    if (!pkg) throw new Error('מערכת הבת לא נמצאה');
    await licenseSync.pushToChild(childId, pkg);
    return true;
  });

  // מנהל-העל מרחוק: קליטת בקשות, אישור/דחייה ושליחה ישירה, ועדכון כל הלקוחות
  handle('owner:remoteReceive', async () => licenseSync.ownerReceive());
  handle('owner:inbox', async () => ownerCore.inbox().map(({ id, from, at, summary }) => ({ id, from, at, summary })));
  handle('owner:inboxIssue', async (event, input = {}) => {
    const m = ownerCore.peekInbox(String((input || {}).id || ''));
    const r = ownerCore.issue({ ...(input || {}), request: m.body });
    await licenseSync.ownerReply(m.from, 'license', r.package);
    ownerCore.takeFromInbox(m.id);
    await ownerAudit(event, 'tenant.issue', { id: r.id, name: r.name, slot: r.slot, renewal: r.renewal, remote: true });
    return { id: r.id, name: r.name, slot: r.slot };
  });
  handle('owner:inboxApprove', async (event, id) => {
    const m = ownerCore.peekInbox(String(id || ''));
    const r = ownerCore.approve({ request: m.body });
    await licenseSync.ownerReply(m.from, 'approval', r.package);
    ownerCore.takeFromInbox(m.id);
    await ownerAudit(event, 'child.approve', { childId: r.childId, name: r.name, parent: r.parentName, slot: r.slot, remote: true });
    return { childId: r.childId, name: r.name, parentName: r.parentName };
  });
  handle('owner:inboxReject', async (event, id, reason) => {
    const why = String(reason || '').trim();
    if (!why) throw new Error('חובה לציין סיבה');
    const m = ownerCore.peekInbox(String(id || ''));
    const name = (m.summary && m.summary.name) || '';
    await licenseSync.ownerReply(m.from, 'rejection', JSON.stringify({ name, reason: why }));
    ownerCore.takeFromInbox(m.id);
    await ownerAudit(event, 'request.reject', { from: m.from, name, reason: why, remote: true });
    return true;
  });
  handle('owner:remotePush', async (event) => {
    const r = await licenseSync.ownerPushNotices();
    await ownerAudit(event, 'notices.push', r);
    return r;
  });

  // ---------- הרשמה, תשלום וחתימה על התקנון ----------
  handle('license:getOffer', async () => {
    const r = await licenseSync.getOffer();
    return { text: r.text, offer: r.offer };
  });
  handle('license:signup', async (event, input = {}) => {
    const r = await licenseSync.signup(input || {});
    await auditEvent(event, 'license.signup', { id: r.id, planId: (input || {}).planId, free: r.free });
    return r;
  });
  handle('license:signupStatus', async () => licenseSync.signupStatus());
  // פתיחת דף התשלום של הספק בדפדפן — רק הכתובת שהשרת החזיר להרשמה הזו, ורק https (או localhost בבדיקות)
  handle('license:openPayment', async () => {
    const cur = licenseStore.getRemoteSettings().signup;
    if (!cur || !cur.url) throw new Error('אין תשלום פתוח');
    const u = new URL(cur.url);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('כתובת התשלום אינה מאובטחת');
    await require('electron').shell.openExternal(u.toString());
    return true;
  });

  // ---------- שמירה על מפתח מנהל-העל ----------
  handle('owner:changePassphrase', async (event, oldPass, newPass) => {
    const r = ownerCore.changePassphrase(String(oldPass || ''), String(newPass || ''));
    await ownerAudit(event, 'passphrase.change', r);
    return true;
  });
  handle('owner:recoveryCodes', async (event, n, k) => {
    const r = ownerCore.recoveryCodes(Number(n) || 5, Number(k) || 3);
    await ownerAudit(event, 'recovery.create', { setId: r.setId, n: r.n, k: r.k });
    return r;
  });
  handle('owner:recoveryInfo', async () => ownerCore.recoveryInfo());
  handle('owner:recover', async (event, codes, newPass) => {
    const r = ownerCore.recoverFromCodes(Array.isArray(codes) ? codes.map(String).slice(0, 255) : [], String(newPass || ''));
    await ownerAudit(event, 'recovery.use', { keyId: r.keyId });
    return r;
  });
  handle('owner:exportBackup', async (event, passphrase) => {
    const text = ownerCore.exportBackup(String(passphrase || ''));
    const r = await dialog.showSaveDialog({ defaultPath: 'גיבוי-מנהל-העל.ssowner', filters: [{ name: 'גיבוי מנהל-העל', extensions: ['ssowner'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, text, 'utf8');
    await ownerAudit(event, 'backup.export', {});
    return { ok: true, path: r.filePath };
  });
  handle('owner:importBackup', async (event, text, passphrase) => {
    if (typeof text !== 'string' || text.length > 50 * 1024 * 1024) throw new Error('קובץ הגיבוי אינו תקין');
    const r = ownerCore.importBackup(text, String(passphrase || ''));
    await ownerAudit(event, 'backup.import', r);
    return r;
  });

  handle('owner:getOffer', async () => { const o = ownerCore.offer(); return o ? o.offer : null; });
  handle('owner:setOffer', async (event, input) => {
    const r = ownerCore.setOffer(input || {});
    await ownerAudit(event, 'offer.set', { plans: r.offer.plans.map(p => ({ id: p.id, priceAgorot: p.priceAgorot })), terms: r.offer.terms.version });
    return r.offer;
  });
  handle('owner:publishOffer', async (event) => {
    const r = await licenseSync.ownerPublishOffer();
    await ownerAudit(event, 'offer.publish', {});
    return r;
  });
  handle('owner:signups', async () => ownerCore.signups().map(({ signup, ...x }) => x));
  handle('owner:signupIssue', async (event, id) => {
    const sid = String(id || '');
    const x = ownerCore.signups().find(y => y.id === sid);
    if (!x) throw new Error('ההרשמה לא נמצאה');
    // חשבונית קודם (אם שולם ועוד אין) — כך שלא יונפק רישיון בתשלום בלי מסמך חשבונאי
    let invoice = x.invoice || null;
    if (!invoice && x.payment && x.payment.amountAgorot > 0) {
      const inv = await accountingService.createPaidInvoice({ customer: x.customer.org, customerTaxId: x.customer.taxId,
        description: `מנוי SuperSuite — ${x.planName} (${x.months} חודשים)`, grossAgorot: x.payment.amountAgorot,
        ref: x.payment.providerRef, date: localDay(x.payment.paidAt || Date.now()) });
      invoice = { id: inv.id, number: inv.number };
      ownerCore.setSignupInvoice(sid, invoice);
      await auditEvent(event, 'acct.invoice.create', { id: inv.id, number: inv.number, source: 'signup', signup: sid });
    }
    const r = ownerCore.issueSignup(sid);
    await licenseSync.ownerReply(r.keyId, 'license', r.package);
    await ownerAudit(event, 'signup.issue', { id: sid, tenant: r.id, name: r.name, invoice: invoice && invoice.number });
    return { name: r.name, invoice };
  });
  handle('owner:signupDocument', async (event, id) => {
    const d = ownerCore.signedDocument(String(id || ''));
    return saveHtmlAsPdf(d.html, d.name.replace(/[\\/:*?"<>|]/g, '') + '.pdf');
  });

  // ---------- עדכוני גרסה חתומים ----------
  handle('update:getStatus', async () => updateManager.status());
  handle('update:download', async (event) => {
    const r = await updateManager.download();
    await auditEvent(event, 'update.download', { version: r.version });
    return r;
  });
  // התקנה מקובץ (USB): בוחרים את תעודת הגרסה (.ssupdate) ואת קובץ ההתקנה שלידה
  handle('update:fromFile', async (event) => {
    const pick = await dialog.showOpenDialog({ title: 'בחירת קובץ עדכון (.ssupdate)', properties: ['openFile'],
      filters: [{ name: 'עדכון SuperSuite', extensions: ['ssupdate'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false };
    const relFile = pick.filePaths[0];
    if (fs.statSync(relFile).size > 64 * 1024) throw new Error('קובץ העדכון אינו תקין');
    const text = fs.readFileSync(relFile, 'utf8');
    const p = UP.verifyRelease(text, ROOT_KEYS_IN_USE());
    // קובץ ההתקנה — ליד התעודה בשם שבתעודה, ואם אינו שם — המשתמש בוחר
    let bin = path.join(path.dirname(relFile), path.basename(p.fileName));
    if (!fs.existsSync(bin)) {
      const pb = await dialog.showOpenDialog({ title: 'בחירת קובץ ההתקנה ' + p.fileName, properties: ['openFile'],
        filters: [{ name: 'קובץ התקנה', extensions: UP.PLATFORMS[p.platform] }] });
      if (pb.canceled || !pb.filePaths || !pb.filePaths[0]) return { ok: false };
      bin = pb.filePaths[0];
    }
    if (fs.statSync(bin).size !== p.size) throw new Error('גודל הקובץ אינו תואם לעדכון החתום — הקובץ נדחה');
    const r = await updateManager.fromFile(text, fs.readFileSync(bin));
    await auditEvent(event, 'update.fromFile', { version: r.version });
    return { ok: true, ...r };
  });
  // הפעלת ההתקנה: בדיקה חוזרת של הקובץ בדיסק (אולי הוחלף), ואז פתיחת המתקין וסגירת התוכנה
  handle('update:install', async (event) => {
    const r = updateManager.readyToInstall();
    const file = path.resolve(r.path);
    if (path.dirname(file) !== path.resolve(updatesDir)) throw new Error('קובץ ההתקנה אינו במקום הצפוי');
    UP.checkFile(r.payload, fs.readFileSync(file));
    await auditEvent(event, 'update.install', { version: r.version });
    const electron = require('electron');
    const err = await electron.shell.openPath(file);
    if (err) throw new Error('פתיחת ההתקנה נכשלה: ' + err);
    setTimeout(() => { try { electron.app.quit(); } catch { /* */ } }, 1500);
    return { ok: true, version: r.version };
  });

  // מנהל-העל: שחרור גרסה — בוחרים קובץ התקנה, מחושבת תמצית, נחתמת תעודה ונשמרת ליד הקובץ
  handle('owner:releaseCreate', async (event, input = {}) => {
    const pick = await dialog.showOpenDialog({ title: 'בחירת קובץ ההתקנה (EXE / APK)', properties: ['openFile'],
      filters: [{ name: 'קובץ התקנה', extensions: ['exe', 'apk'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false };
    const bin = pick.filePaths[0];
    const st = fs.statSync(bin);
    if (st.size > UP.MAX_SIZE) throw new Error('הקובץ גדול מדי');
    const bytes = fs.readFileSync(bin);
    const text = UP.createRelease(ownerCore.rootSigner(), { version: (input || {}).version, url: (input || {}).url, notes: (input || {}).notes,
      fileName: path.basename(bin), size: bytes.length, sha256: UP.hashBytes(bytes) });
    const payload = UP.verifyRelease(text, [ownerCore.pubkey()]);
    ownerCore.addRelease(text, payload);
    // התעודה נשמרת ליד קובץ ההתקנה — כך מעבירים את שניהם יחד ב-USB
    const relPath = bin.replace(/\.(exe|apk)$/i, '') + '.ssupdate';
    fs.writeFileSync(relPath, text, 'utf8');
    await ownerAudit(event, 'release.create', { version: payload.version, platform: payload.platform, sha256: payload.sha256 });
    return { ok: true, version: payload.version, platform: payload.platform, path: relPath, sha256: payload.sha256 };
  });
  handle('owner:releases', async () => ownerCore.releases().map(({ text, ...r }) => r));
  handle('owner:releasePublish', async (event, version, platform) => {
    const rel = ownerCore.releases().find(r => r.version === String(version) && r.platform === String(platform));
    if (!rel) throw new Error('הגרסה לא נמצאה');
    const r = await licenseSync.ownerPublishUpdate(rel.text);
    await ownerAudit(event, 'release.publish', { version: rel.version, platform: rel.platform, sent: r.sent });
    return r;
  });

  // ---------- הודעות מאובטחות בין המערכות (מוצפנות מקצה לקצה) ----------
  // as: 'owner' — בשם מנהל-העל (דורש מצב מנהל-העל פתוח והרשאת מנהל)
  const asOwner = (event, as) => {
    if (as !== 'owner') return false;
    if (!authService.hasPermission(event.sender.id, 'users.manage')) throw new Error('אין הרשאה לפעולה זו');
    if (!ownerCore.isUnlocked()) throw new Error('יש לפתוח את מצב מנהל-העל בסיסמה');
    return true;
  };
  const chatContacts = (owner) => (owner ? ownerCore.contacts() : licenseSync.myContacts()).map(({ id, name, role }) => ({ id, name, role }));
  const chatBox = (owner) => (owner ? ownerChatStore : chatStore);
  const str = (v, max = 64) => String(v == null ? '' : v).slice(0, max);
  handle('chat:overview', async (event, as, filter) => {
    const owner = asOwner(event, as);
    const box = chatBox(owner);
    const s = box.settings();
    const contacts = chatContacts(owner);
    return { conversations: box.conversations(contacts, str(filter, 40) || 'all'), contacts, remote: !!licenseStore.getRemoteSettings().url,
      unread: box.unreadTotal(), labels: s.labels, quickReplies: s.quickReplies, lists: s.lists.map(({ id, name, members }) => ({ id, name, count: members.length })) };
  });
  // השיחה + פרטי איש הקשר (תוויות, הערה פנימית, הפרופיל העסקי שלו)
  handle('chat:thread', async (event, peerId, as) => {
    const owner = asOwner(event, as);
    const box = chatBox(owner);
    const id = str(peerId);
    const thread = box.thread(id);
    try { await licenseSync.chatOps(owner).markRead(id); } catch { /* לא קריטי */ }
    return { messages: thread, meta: box.meta(id), now: Date.now() };
  });
  handle('chat:send', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const { peerId, subject, text, replyTo, att } = input || {};
    const r = await licenseSync.chatOps(owner).send(str(peerId), { subject, text, replyTo, att });
    await auditEvent(event, 'chat.send', { to: peerId, mid: r.mid, owner, attachment: att ? str(att.name, 100) : undefined });
    return r;
  });
  handle('chat:edit', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const r = await licenseSync.chatOps(owner).edit(str(input.mid), input.text);
    await auditEvent(event, 'chat.edit', { mid: input.mid, owner });
    return r;
  });
  handle('chat:deleteForAll', async (event, mid, as) => {
    const owner = asOwner(event, as);
    const r = await licenseSync.chatOps(owner).deleteForAll(str(mid));
    await auditEvent(event, 'chat.deleteForAll', { mid, owner });
    return r;
  });
  handle('chat:deleteForMe', async (event, mids, as) => {
    const owner = asOwner(event, as);
    return chatBox(owner).deleteForMe((Array.isArray(mids) ? mids : [mids]).slice(0, 500).map(m => str(m)));
  });
  handle('chat:forward', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const r = await licenseSync.chatOps(owner).forward(str(input.mid), str(input.peerId));
    await auditEvent(event, 'chat.forward', { mid: input.mid, to: input.peerId, owner });
    return r;
  });
  handle('chat:star', async (event, input = {}, as) => chatBox(asOwner(event, as)).star(str(input.mid), !!input.on));
  handle('chat:starred', async (event, as) => chatBox(asOwner(event, as)).starred());
  handle('chat:setMeta', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const { peerId, ...patch } = input || {};
    if (!chatContacts(owner).some(c => c.id === peerId)) throw new Error('איש הקשר אינו מוכר');
    return chatBox(owner).setMeta(str(peerId), patch);
  });
  handle('chat:broadcast', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const { listId, subject, text, att } = input || {};
    const r = await licenseSync.chatOps(owner).broadcast(str(listId), { subject, text, att });
    await auditEvent(event, 'chat.broadcast', { listId, sent: r.sent, failed: r.failed.length, owner });
    return r;
  });
  handle('chat:getSettings', async (event, as) => {
    const owner = asOwner(event, as);
    return { settings: chatBox(owner).settings(), contacts: chatContacts(owner) };
  });
  handle('chat:saveSettings', async (event, input = {}, as) => {
    const owner = asOwner(event, as);
    const s = chatBox(owner).saveSettings(input);
    await auditEvent(event, 'chat.settings', { owner, greeting: s.greeting.enabled, away: s.away.enabled, autoFetch: s.autoFetch });
    return s;
  });
  handle('chat:publishProfile', async (event, as) => licenseSync.chatOps(asOwner(event, as)).publishProfile());
  // שמירת קובץ מצורף לדיסק — בחלון שמירה של מערכת ההפעלה
  handle('chat:saveAttachment', async (event, mid, as) => {
    const owner = asOwner(event, as);
    const a = chatBox(owner).attachment(str(mid));
    const r = await dialog.showSaveDialog({ defaultPath: path.basename(a.name) });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, Buffer.from(a.data, 'base64'));
    return { saved: true };
  });
  handle('chat:refresh', async (event, as) => licenseSync.chatOps(asOwner(event, as)).receive());
  handle('chat:search', async (event, q, as) => chatBox(asOwner(event, as)).search(str(q, 200)));

  // מצב הרישיון — לכל משתמש מחובר (פתוח גם במערכת מושבתת, כדי להציג את הסיבה)
  handle('license:getStatus', async () => {
    const s = licenseState();
    if (s.mode === 'unlicensed') return { mode: 'unlicensed', status: 'active' };
    return { mode: s.mode, status: s.status, reasons: (s.reasons || []).map(r => ({ kind: r.kind, reason: r.reason })),
      graceUntil: s.graceUntil || null, features: s.features, limits: s.limits };
  });
  handle('license:getRequest', async (event, name) => {
    const r = licenseStore.request(name);
    await auditEvent(event, 'license.request', { keyId: r.keyId });
    return JSON.stringify(r);
  });
  handle('license:install', async (event, text) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('קובץ הרישוי אינו תקין');
    const r = licenseStore.install(text);
    await auditEvent(event, 'license.install', r);
    licenseState();
    return r;
  });
  handle('license:importNotices', async (event, text) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('קובץ ההודעות אינו תקין');
    const r = licenseStore.importNotices(text);
    await auditEvent(event, 'license.notices.import', r);
    licenseState();
    return r;
  });
  handle('license:listChildren', async () => licenseStore.listChildren());
  // מערכת בת: קודם בקשת אישור ממנהל-העל, ורק עם האישור החתום — הנפקה
  handle('license:requestChildApproval', async (event, input = {}) => {
    const r = licenseStore.requestChildApproval(input || {});
    await auditEvent(event, 'license.child.approvalRequest', { childId: r.childId, features: (input || {}).features, limits: (input || {}).limits });
    return r;
  });
  handle('license:issueChild', async (event, input = {}) => {
    const r = licenseStore.issueChild(input || {});
    await auditEvent(event, 'license.child.issue', { id: r.child.id, name: r.child.name, slot: r.child.slot, features: r.child.features, limits: r.child.limits });
    return r;
  });
  // השבתה / החזרה / סיום של מערכת בת — סיבה חובה (נבדק ב-createNotice)
  const childNotice = (type) => async (event, input = {}) => {
    const r = licenseStore.noticeForChild({ ...(input || {}), type });
    await auditEvent(event, 'license.child.' + type, { childId: r.notice.target, kind: r.notice.kind, holdId: r.notice.holdId, reason: r.notice.reason });
    return r;
  };
  handle('license:holdChild', childNotice('hold'));
  handle('license:releaseChild', childNotice('release'));
  handle('license:terminateChild', childNotice('terminate'));
  handle('audit:list', async (event, filter = {}) => db.listAudit(filter || {}));
  handle('audit:export', async (event, filter = {}) => {
    const rows = await db.listAudit({ ...(filter || {}), limit: 5000 });
    return saveCsv({ name: 'יומן-ביקורת-' + new Date().toISOString().slice(0, 10), headers: ['מועד', 'משתמש', 'פעולה', 'פרטים'], rows: rows.map(r => [r.at, r.user, r.action, r.details]) });
  });

  // ---------- ייבוא וייצוא לכל סוגי הנתונים ----------
  handle('ports:listKinds', async () => DP.listKinds());
  handle('ports:export', async (event, kind) => {
    const r = await saveCsv(DP.exportTable(kind, await db.load()));
    if (r.ok) await auditEvent(event, 'ports.export', { kind, rows: r.rows });
    return r;
  });
  handle('ports:exportTemplate', async (event, kind) => saveCsv(DP.templateTable(kind)));
  handle('ports:import', async (event, kind, csvText) => {
    if (typeof csvText !== 'string' || csvText.length > 20 * 1024 * 1024) throw new Error('קובץ הייבוא אינו תקין או גדול מדי (עד 20MB)');
    const data = await db.load();
    const r = DP.parseImport(kind, csvText, data);
    if (r.records.length) await db.save(DP.applyImport(kind, data, r.records));
    await auditEvent(event, 'ports.import', { kind, added: r.records.length, skipped: r.skipped, errors: r.errors.length });
    return { added: r.records.length, skipped: r.skipped, errors: r.errors.slice(0, 50) };
  });
  handle('ports:importVcard', async (event, vcfText) => {
    if (typeof vcfText !== 'string' || vcfText.length > 20 * 1024 * 1024) throw new Error('קובץ אנשי הקשר אינו תקין או גדול מדי');
    const data = await db.load();
    const r = DP.importContactsVcard(vcfText, data);
    if (r.records.length) await db.save(DP.applyImport('contacts', data, r.records));
    await auditEvent(event, 'ports.import', { kind: 'contacts-vcard', added: r.records.length, skipped: r.skipped });
    return { added: r.records.length, skipped: r.skipped, errors: r.errors.slice(0, 50) };
  });
  handle('ports:exportVcard', async (event) => {
    const text = DP.contactsToVcard(await db.load());
    const res = await dialog.showSaveDialog({ defaultPath: 'אנשי-קשר.vcf', filters: [{ name: 'vCard', extensions: ['vcf'] }] });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, text, 'utf8');
    await auditEvent(event, 'ports.export', { kind: 'contacts-vcard' });
    return { ok: true, path: res.filePath };
  });

  // גיבוי ושחזור: ההצפנה נעשית כאן, והממשק מקבל ומחזיר רק טקסט מוצפן (SSBK1:)
  handle('data:backupEncrypted', async (event, passphrase) => {
    const plain = JSON.stringify(await db.backup());
    const out = BK.encryptBackup(plain, passphrase);
    await auditEvent(event, 'data.backup', { encrypted: true });
    return out;
  });
  handle('data:restoreEncrypted', async (event, text, passphrase) => {
    if (!BK.isEncryptedBackup(text)) throw new Error('הקובץ אינו גיבוי מוצפן של המערכת');
    const data = JSON.parse(BK.decryptBackup(text, passphrase));
    await db.restore(data);
    await auditEvent(event, 'data.restore', { encrypted: true });
    return true;
  });
  // ערוץ גיבוי גלוי הוסר: גיבוי לא מוצפן לא יוצא מהמערכת
  handle('data:restore', async (event, backupData) => {
    await auditEvent(event, 'data.restore', { encrypted: false });
    return await db.restore(backupData);
  });
}
// קבלת הודעות אוטומטית (כדי שהודעות פתיחה והיעדרות יישלחו גם כשאיש לא לוחץ "קבלת הודעות").
// רק כשהמנהל הפעיל זאת בהגדרות, יש שרת מוגדר, ולא בשבת וביום טוב. תיבת מנהל-העל — רק כשהמצב פתוח
let autoFetchBusy = false;
async function chatAutoFetch() {
  if (autoFetchBusy || !licenseSync || !licenseStore || restTime()) return { skipped: true };
  if (!licenseStore.getRemoteSettings().url) return { skipped: true };
  autoFetchBusy = true;
  const out = {};
  try {
    if (chatStore.settings().autoFetch && licenseStore.syncKey(false)) { try { out.system = await licenseSync.receive(); } catch (e) { out.systemError = e.message; } }
    if (ownerChatStore.settings().autoFetch && ownerCore && ownerCore.isUnlocked()) { try { out.owner = await licenseSync.ownerReceive(); } catch (e) { out.ownerError = e.message; } }
  } finally { autoFetchBusy = false; }
  return out;
}

module.exports = { toUserError, initEcon, chatAutoFetch, permissionFor, licenseState, onLicenseChange: (fn) => { licenseListeners.push(fn); }, invalidateLicense: () => licenseStore && licenseStore.invalidate(), getDb: () => db, isLoggedIn: () => authService.sessions.size > 0, assertAccess,
  // מודולים שדורשים כניסה: בדיקה שקטה, רישום פעילות (עבודה במודול כזה מונעת ניתוק), ואירוע כניסה/יציאה
  hasSession: (senderId) => authService.peekSession(senderId),
  touchSession: (senderId) => { authService.getSession(senderId); },
  onAuthChange: (fn) => { authListeners.push(fn); } };
