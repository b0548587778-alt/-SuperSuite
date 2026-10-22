// Main Electron Application Entry Point
const { ipcMain, dialog, BrowserWindow, safeStorage } = require('electron');
const fs = require('fs');
const X = require('./core/exports');
const L = require('./core/npoLetters'); // מכתבים לעמותה — טהור; כאן רק לעטיפת HTML ל-PDF
const { initializeDatabase, issuedAfter, defaults: DB_DEFAULTS } = require('./core/database');
const ModCounters = require('../../shell/module-counters');
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
const { SampleService: sampleService } = require('./services/sampleService');
const { PrivacyService: privacyService } = require('./services/privacyService');
const { MortgageAdvisorService: mortgageAdvisorService } = require('./services/mortgageAdvisorService');
const { RealtyService: realtyService } = require('./services/realtyService');
const MR = require('./core/mortgageReport');
const BR = require('./core/brokerage');
const RI = require('./core/realtyInvest');
// שפת העיצוב מוטמעת במסמכי PDF (חלון ה-PDF אינו טוען קבצים). בלי הקובץ (אנדרואיד) — ברירות המחדל של הדפדפן
let tokensCache = null;
function designTokensCss() {
  if (tokensCache === null) {
    try { tokensCache = fs.readFileSync(path.join(__dirname, '..', '..', 'shell', 'design-tokens.css'), 'utf8'); } catch { tokensCache = ''; }
  }
  return tokensCache;
}
const { MortgageLabService: mortgageLabService } = require('./services/mortgageLabService');
const { RealEstateService: realEstateService } = require('./services/realEstateService');
const BK = require('./core/backupCrypto');
const DP = require('./core/dataPorts');
const MB = require('./core/dashboard');
const HS = require('./core/homeSummary');
const { IDLE_MIN_RANGE } = require('./services/authService');
const path = require('path');
const LG = require('../../shell/licensing/gate');
const TP = require('./core/trainerPayments');
const GS = require('../../shell/google-signin');
const GOOGLE_CLIENT = require('../../shell/google-client');
const LS = require('../../shell/licensing/store');
const ROOT_KEYS = require('../../shell/licensing/root-keys');
const OC = require('../../shell/licensing/owner-core');
const { createLicenseSync } = require('../../shell/licensing/sync');
const { validateUrl } = require('../../shell/licensing/remote');
const { DEFAULT_RELAY_URL } = require('../../shell/licensing/default-relay');
const { createChatStore } = require('../../shell/licensing/chat');
const UP = require('../../shell/licensing/update');
const MP = require('../../shell/ai/model-pack');
const PK = require('../../shell/licensing/prekeys');
const OF = require('../../shell/licensing/offer');
const ACT = require('../../shell/licensing/activation');
const LIC = require('../../shell/licensing/license');
const AI = require('../../shell/ai');
const AI_RULES = require('../../shell/ai/rules'); // טהור — לזיהוי התחום ולקביעת התקופה, כדי שהסיכום והתשובה יתאימו

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
// תנאי ההפעלה (shell/licensing/activation.js): רישיון שנתי וחיבור לשרת ב-30 הימים האחרונים
function activationState(base) {
  const s = base || (licenseStore ? licenseStore.current() : { mode: 'unlicensed' });
  if (!licenseStore || s.mode !== 'licensed') return ACT.evaluate({ state: s });
  const r = licenseStore.getRemoteSettings();
  const now = Math.max(clockNow(), Number(s.seenAt) || 0);
  return ACT.evaluate({ state: s, leaf: licenseStore.leafPayload(), lastSync: Number(r.lastSync) || 0, now });
}
// מערכת שלא הופעלה = נעולה (רק רישוי, כניסה והודעות פתוחים). רישיון לא פעיל — נשאר הסטטוס שלו (חוב: קריאה בלבד)
function withActivation(s) {
  // בתקופת ניסיון אין תנאי הפעלה (אין רישיון שנתי ואין חיבור לשרת)
  if (!s || s.mode !== 'licensed' || s.status !== 'active' || s.trial) return s;
  const act = activationState(s);
  if (act.ok) return s;
  const first = act.steps.find(x => !x.ok);
  return { ...s, status: 'locked', activation: act, reasons: [{ kind: 'locked', reason: ACT.message(act), source: 'activation', step: first && first.id }, ...(s.reasons || [])] };
}
let clockNow = () => Date.now();
// מקור תשלומי האימונים (main.js): (senderId) ← נתוני מחסן האימונים. בלי מקור (אנדרואיד, בדיקות) — לא זמין
let trainerSource = null;
// עוזר ה-AI (shell/ai): { status, prefsGet, prefsSave, run, explain } — נבנה ב-initEcon, ושומר את העדפותיו
let aiAssistant = null;
let aiOptions = null;
// הפונקציות של הערוצים dashboard:getHomeSummary ו-ai:run — המעטפת קוראת להן דרך shellCall (אותו שומר בדיוק)
let homeSummaryFn = null;
let aiRunFn = null;
// רשימת המודולים לכניסה בעוזר — מוגבלת לרישיון ההתקנה (ופה אין את לקוח השרת) — בלי פונקציה (אנדרואיד, בדיקות) המודול סגור
let moduleLicensed = null;
// הקשר זמני לעוזר ה-AI (מקום אחד לכל חלון): { shamai, trainer } — נמחק אחרי כל שאלה ואינו נשמר לדיסק
const aiContextBySender = new Map();
let aiUserDataPath = '';
// כניסה/קישור עם Google שאומתו מול Google — תנאי ההפעלה מתעדכן, והמערכת נפתחת מיד אם זה היה התנאי החסר
function markGoogleActivation() {
  if (!licenseStore) return;
  try { licenseStore.markGoogleSignIn(clockNow()); } catch (e) { console.error('activation google mark failed', e); }
  licenseStore.invalidate();
  licenseState();
}

function licenseState() {
  const s = withActivation(licenseStore ? licenseStore.current() : { mode: 'unlicensed' });
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

async function initEcon(userDataPath, opts = {}) {
  aiContextBySender.clear();
  const { rootKeys = ROOT_KEYS, relayUrl = DEFAULT_RELAY_URL, clock, licenseStorage, licenseSecret, ownerStorage, fetchImpl, chatStorage, ownerChatStorage,
  updateStorage, appVersion, platform, prekeyStorage, ownerPrekeyStorage, isRestTime = () => false, googleSignIn, openExternal, dbOptions, trainerData, googleClient } = opts;
  restTime = isRestTime;
  trainerSource = typeof trainerData === 'function' ? trainerData : null;
  // שם הפרמטר חופף למשתנה הגלובלי — כאן מעדכנים רק את הגלובלי (הצהרה מחודשת הייתה אסורה)
  aiOptions = typeof opts.aiOptions === 'function' ? opts.aiOptions : null;
  moduleLicensed = typeof opts.moduleLicensed === 'function' ? opts.moduleLicensed : null;
  clockNow = clock || (() => Date.now());
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
  // עבודה מרחוק דרך שרת הרישוי — כתובת ברירת מחדל ב-default-relay.js; המנהל יכול להחליף או למחוק (מחיקה: אופליין לגמרי)
  // קבצים מצורפים שמורים מקומית: באנדרואיד (localStorage מוגבל) — מעט מאוד
  const maxAttachmentBytes = ad.platform === 'android' ? 1024 * 1024 : 40 * 1024 * 1024;
  chatStore = createChatStore({ storage: chatStorage || ad.chat, clock, maxAttachmentBytes });
  ownerChatStore = createChatStore({ storage: ownerChatStorage || ad.ownerChat, clock, maxAttachmentBytes });
  // מחסן הרישוי נוצר לפני הסנכרון: createLicenseSync שומר את ההפניה, ו-null כאן הפיל כל פעולה מרחוק
  licenseStore = LS.createLicenseStore({ storage: licenseStorage || ad.storage, secret: licenseSecret || ad.secret, rootKeys, clock, defaultUrl: relayUrl });
  licenseSync = createLicenseSync({ store: licenseStore, owner: ownerCore, rootKeys, fetchImpl: fetchImpl || globalThis.fetch, clock,
    chat: chatStore, ownerChat: ownerChatStore, updates: updateManager, isRestTime: () => restTime(),
    prekeys: PK.createPrekeyStore({ storage: prekeyStorage || ad.prekeys, clock: clock || Date.now }),
    ownerPrekeys: PK.createPrekeyStore({ storage: ownerPrekeyStorage || ad.ownerPrekeys, clock: clock || Date.now }) });
  // dbOptions: הצפנת המסד (PLAN.md 3.1) — המפתח והגיבוי לפני ההמרה מגיעים מ-main.js
  db = await initializeDatabase(userDataPath, dbOptions);
  // עוזר ה-AI: מקבל את מפתח הגיבוי האוטומטי דרך aiOptions (קריאה לא יוצרת מפתח). בלי find-backupKey — אין העדפות שמורות וקוראים ברירת מחדל
  const aiOpts = (aiOptions ? aiOptions() : null) || {};
  aiUserDataPath = userDataPath;
  aiAssistant = AI.createAI({
    userDataPath,
    getBackupKey: typeof aiOpts.getBackupKey === 'function' ? aiOpts.getBackupKey : () => null,
    onError: (scope, e) => errorLogger(scope, e),
    clock: () => clockNow(),
    // המודל המקומי נפתח רק ברישיון פעיל עם 'ai.local' (localLicensed ב-shell/ai/router.js)
    licenseState: () => licenseState(),
  });
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
  sampleService.initialize(db);
  privacyService.initialize(db);
  mortgageAdvisorService.initialize(db);
  realtyService.initialize(db);
  mortgageLabService.initialize(db);
  realEstateService.initialize(db);
  const startSettings = (await db.load()).settings || {};
  authService.setIdleMinutes(startSettings.idleMinutes);
  // באנדרואיד אין כניסה עם Google (אין http ואין דפדפן חיצוני) — גם לא עם המזהה המובנה
  googleBuiltIn = ad.platform === 'android' ? null : builtInGoogle(googleClient === undefined ? GOOGLE_CLIENT : googleClient);
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
  // הגדרות משרד הייעוץ (מי רואה אילו תיקים) — מנהל בלבד
  if (channel === 'madv:saveSettings' || channel === 'madv:saveBrand' || channel === 'madv:setBrandLogo') return 'users.manage';
  // פרטי המשרד בהזמנת התיווך (שם, רישיון, עוסק פטור) — מנהל בלבד
  if (channel === 'rlty:saveSettings') return 'users.manage';
  // פרטי השמאי והצהרתו בכל דוח שומה — מנהל בלבד
  if (channel === 'realestate:saveSettings') return 'users.manage';
  // אימות טבלת מס רכישה משנה את האזהרות לכל המשתמשים — מנהל בלבד (כמו אימות כללים במעבדה)
  if (channel === 'rlty:verifyTaxTable' || channel === 'rlty:unverifyTaxTable') return 'users.manage';
  if (channel === 'rlty:readTaxTableFile') return 'data.edit';
  // מיפוי מאגרים ומזעור נתונים (תיקון 13) — מנהל בלבד
  if (channel.startsWith('privacy:')) return 'users.manage';
  // מכתבים לעמותה: הכנת הטיוטה — קריאה בלבד (לא נשמר דבר); שמירה ל-PDF — ייצוא
  if (channel === 'npo:getThankYouLetter' || channel === 'npo:getAnnualNarrative' || channel === 'npo:getGrantDraft') return 'data.view';
  if (/^npo:(exportThankYou|exportAnnualNarrative|exportGrantDraft)Pdf$/.test(channel)) return 'data.export';
  // רישוי: התקנה, הנפקת מערכות בת והשבתתן — מנהל בלבד. מצב הרישיון — לכל משתמש מחובר
  if (channel.startsWith('license:') && channel !== 'license:getStatus') return 'users.manage';
  if (channel.startsWith('owner:')) return 'users.manage';
  // עוזר ה-AI: קריאה — לכל משתמש; שאלה — עריכה (מוגבלת לקריאה בכל מקרה); שינוי העדפות, הסכמה לענן ובדיקת הגדרות — מנהל בלבד
  if (channel === 'ai:status' || channel === 'ai:prefs:get' || channel === 'ai:modules' || channel === 'ai:sample' || channel === 'ai:explain') return 'data.view';
  if (channel === 'ai:run') return 'data.edit';
  // העוזר שמבקש תצוגה אחרת (עמותה, שמאות, אימונים) — קריאה בלבד, בלי שינוי דבר
  if (channel === 'ai:open') return 'data.view';
  // העברת הקשר זמני (הערכה אחרונה מהשמאות, דוח מן האימונים) — דורש גם הרשאת צפייה בחשבונות
  if (channel === 'ai:context') return 'data.view';
  // חיפוש בשפה טבעית (Ctrl+K) — קריאה בלבד; מצב המודל — לכל משתמש. התקנה, אימות והסרה — נופלים ל-users.manage למטה
  if (channel === 'ai:search' || channel === 'ai:model:status') return 'data.view';
  if (channel.startsWith('ai:')) return 'users.manage';
  // עדכוני גרסה: כל משתמש רואה שיש עדכון; הורדה והתקנה — מנהל בלבד
  if (channel === 'update:getStatus') return 'data.view';
  if (channel.startsWith('update:')) return 'users.manage';
  // גבייה: קישור התשלום קובע לאן נכנס כסף — מנהל בלבד; קליטת דוח וסימון "שולם" — עריכה; ביטול — מחיקה (לפי השם)
  if (channel === 'collect:saveSettings') return 'users.manage';
  if (channel === 'collect:previewImport' || channel === 'collect:getMessage') return 'data.view';
  // קליטת חשבונית ספק: רק מחזיר טיוטה — לא נכתב דבר (השמירה ב-acct:createEntry, בהרשאת עריכה)
  if (channel === 'acct:captureInvoice') return 'data.view';
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
// יומן התקלות (shell/logger.js) — main.js מחבר אותו דרך setErrorLogger. בלעדיו (בדיקות) — הקונסול
let errorLogger = (scope, e) => console.error(scope, e);
function setErrorLogger(fn) { errorLogger = typeof fn === 'function' ? fn : errorLogger; }
function toUserError(e) {
  const msg = String((e && e.message) || e || '');
  if (HEBREW.test(msg)) return e instanceof Error ? e : new Error(msg);
  try { errorLogger('econ', e); } catch { /* היומן לא מפיל פעולה */ }
  return new Error('הפעולה נכשלה עקב שגיאה פנימית. אם התקלה חוזרת — יש לבצע גיבוי ולפנות לתמיכה.');
}

// ערוצים שהמעטפת רשאית להפעיל בשם המודול הכלכלי — רשימה סגורה, קריאה בלבד או שאלה לעוזר
const SHELL_CHANNELS = {
  'dashboard:getHomeSummary': () => homeSummaryFn,
  'ai:run': () => aiRunFn,
};
function shellCall(channel, senderId, ...args) {
  const get = SHELL_CHANNELS[channel];
  const fn = get && get();
  if (!fn) return Promise.reject(new Error('הפעולה אינה זמינה מהמעטפת'));
  const event = { sender: { id: senderId } };
  return enqueue(async () => {
    try { return await runGuarded(channel, fn, event, args); }
    catch (e) { throw toUserError(e); }
  });
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
// מזהה מובנה (PLAN.md 4.7, shell/google-client.js): כשהמנהל לא שמר הגדרות — הכניסה פעילה איתו, בלי שום הגדרה.
// הגדרות שנשמרו גוברות: כיבוי נשאר כבוי, ומזהה משלו (ארגון) מחליף את המובנה. מזהה ריק בהגדרות = המובנה.
let googleDeps = null;
let googleBuiltIn = null;
let googlePolicy = { enabled: false, clientId: '', clientSecret: '', onlineRequiresGoogle: false, source: 'none' };
let googleBusy = false;
function builtInGoogle(c) {
  if (!c || !c.clientId) return null;
  try { return GS.validateConfig(c); } catch (e) { console.error('google-client.js: ' + e.message); return null; }
}
function normalizeGoogle(g) {
  const saved = g && typeof g === 'object';
  const x = saved ? g : {};
  const own = String(x.clientId || '');
  const enabled = saved ? x.enabled === true : !!googleBuiltIn;
  const useBuiltIn = !own && !!googleBuiltIn;
  return { enabled: enabled && (!!own || useBuiltIn),
    clientId: useBuiltIn ? googleBuiltIn.clientId : own,
    clientSecret: useBuiltIn ? googleBuiltIn.clientSecret : String(x.clientSecret || ''),
    onlineRequiresGoogle: enabled && x.onlineRequiresGoogle === true,
    source: own ? 'custom' : (useBuiltIn ? 'builtin' : 'none'), ownSecret: !!x.clientSecret };
}
// מה המסך מקבל: בלי שום סוד, ומזהה רק כשהוא של הארגון (המובנה — רק "יש")
function googleSettingsView(g) {
  return { enabled: g.enabled, clientId: g.source === 'custom' ? g.clientId : '', hasSecret: g.source === 'custom' && g.ownSecret,
    onlineRequiresGoogle: g.onlineRequiresGoogle, builtIn: !!googleBuiltIn, source: g.source };
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
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, devTools: !(require('electron').app && require('electron').app.isPackaged) } });
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

/* שחזור ממסך המערכת הכלכלית: קובץ גיבוי של התוכנה כולה (suite) — רק החלק הכלכלי שבו; קובץ ישן של המערכת הכלכלית — כמו שהוא.
   בלי זה, קובץ של התוכנה כולה "שוחזר" כמסד ריק ומחק את כל הנתונים הכלכליים; וקובץ שאינו גיבוי כלכלי — כנ"ל */
function econFromBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('קובץ הגיבוי אינו תקין');
  if (data.suite === 'SuperSuite') {
    if (data.econ && typeof data.econ === 'object' && !Array.isArray(data.econ)) return data.econ;
    throw new Error('בקובץ הגיבוי הזה אין נתונים כלכליים. גיבוי של מודול אחר משחזרים מהמסך הראשי של התוכנה');
  }
  if (!Object.keys(DB_DEFAULTS).some(k => k !== 'version' && Object.hasOwn(data, k))) throw new Error('הקובץ אינו גיבוי של המערכת הכלכלית');
  return data;
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
    markGoogleActivation();
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
    markGoogleActivation();
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
  // קליטת חשבונית ספק: טיוטה בלבד — אין שמירה בערוץ הזה; השמירה דרך acct:createEntry
  handle('acct:captureInvoice', async (event, input) => {
    const result = await accountingService.captureInvoice(input);
    // ביומן הפעולות אין פרטי ספק — רק שהטיוטה הוכנה (אינה נשמרת בשום מקום)
    await auditEvent(event, 'acct.capture.draft', {});
    return result;
  });
  handle('acct:reverseEntry',async (event, entryId) => {
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
    await auditEvent(event, 'acct.invoice.paid', { id: result && (result.id || result.number), method: result && result.paymentMethod });
    return result;
  });
  // חשבונית חוזרת (PLAN.md 9.6): הטיוטות מחושבות בכל קריאה, ההפקה רק באישור המשתמש
  handle('acct:getRecurring', async () => accountingService.getRecurring({ today: localDay(Date.now()) }));
  handle('acct:saveRecurring', async (event, input, templateId) => {
    const result = await accountingService.saveRecurring(input || {}, templateId || null);
    await auditEvent(event, templateId ? 'acct.recurring.update' : 'acct.recurring.create', { id: result.id, customer: result.customer });
    return result;
  });
  handle('acct:deleteRecurring', async (event, templateId) => {
    await accountingService.deleteRecurring(templateId);
    await auditEvent(event, 'acct.recurring.delete', { id: templateId });
    return true;
  });
  handle('acct:issueRecurring', async (event, templateId, month) => {
    const result = await accountingService.issueRecurring(templateId, String(month || ''), { today: localDay(Date.now()) });
    await auditEvent(event, 'acct.recurring.issue', { id: templateId, month, number: result.number });
    return result;
  });
  handle('acct:skipRecurring', async (event, templateId, month) => {
    await accountingService.skipRecurring(templateId, String(month || ''), { today: localDay(Date.now()) });
    await auditEvent(event, 'acct.recurring.skip', { id: templateId, month });
    return true;
  });
  handle('acct:getCustomerDirectory', async () => accountingService.getCustomerDirectory());
  // התאמת בנק (PLAN.md 9.4): דף בנק מקובץ שהמשתמש בחר — בלי חיבור לבנק
  const bankCsv = (t) => {
    if (typeof t !== 'string' || t.length > 20 * 1024 * 1024) throw new Error('קובץ דף הבנק אינו תקין או גדול מדי (עד 20MB)');
    return t;
  };
  handle('acct:getBankLines', async () => accountingService.getBankLines());
  handle('acct:previewBankFile', async (event, csvText) => accountingService.previewBankFile(bankCsv(csvText)));
  handle('acct:importBankFile', async (event, csvText, mapping) => {
    const r = await accountingService.importBankFile(bankCsv(csvText), mapping && typeof mapping === 'object' ? mapping : {});
    await auditEvent(event, 'acct.bank.import', { added: r.added, skipped: r.skipped, errors: r.errors.length });
    return r;
  });
  handle('acct:matchBankLine', async (event, lineId, target) => {
    const line = await accountingService.matchBankLine(lineId, target && typeof target === 'object' ? target : {});
    await auditEvent(event, 'acct.bank.match', { id: lineId, type: line.match.type, entryId: line.match.entryId || '', invoiceId: line.match.invoiceId || '' });
    return line;
  });
  handle('acct:createEntryFromBankLine', async (event, lineId, input) => {
    const entry = await accountingService.createEntryFromBankLine(lineId, input && typeof input === 'object' ? input : {});
    await auditEvent(event, 'acct.bank.entry', { id: lineId, entryId: entry.id });
    return entry;
  });
  handle('acct:unmatchBankLine', async (event, lineId) => {
    await accountingService.unmatchBankLine(lineId);
    await auditEvent(event, 'acct.bank.unmatch', { id: lineId });
    return true;
  });
  handle('acct:deleteBankLine', async (event, lineId) => {
    await accountingService.deleteBankLine(lineId);
    await auditEvent(event, 'acct.bank.delete', { id: lineId });
    return true;
  });
  handle('acct:searchDocuments', async (event, query) => accountingService.searchDocuments(String(query || '').slice(0, 100)));
  handle('acct:getDuplicateInput', async (event, kind, id) => accountingService.getDuplicateInput(String(kind || ''), id));
  // מסמכי מכירה (PLAN.md 9.3): הצעת מחיר, הזמנה, תעודת משלוח, חשבונית זיכוי וקבלה
  handle('acct:getSalesDocs', async () => accountingService.getSalesDocs());
  handle('acct:createSalesDoc', async (event, kind, input) => {
    const result = await accountingService.createSalesDoc(String(kind || ''), input);
    await auditEvent(event, 'acct.doc.create', { kind: result.kind, number: result.number });
    return result;
  });
  handle('acct:convertSalesDoc', async (event, docId, to, opts) => {
    const result = await accountingService.convertSalesDoc(docId, String(to || ''), opts || {});
    await auditEvent(event, 'acct.doc.convert', { from: docId, to: result.kind, number: result.number });
    return result;
  });
  handle('acct:cancelSalesDoc', async (event, docId) => {
    const result = await accountingService.cancelSalesDoc(docId);
    await auditEvent(event, 'acct.doc.cancel', { kind: result.kind, number: result.number });
    return result;
  });
  handle('acct:createCreditNote', async (event, invoiceId, input) => {
    const result = await accountingService.createCreditNote(invoiceId, input || {});
    await auditEvent(event, 'acct.credit.create', { number: result.number, invoice: result.invoiceNumber, total: result.total });
    return result;
  });
  handle('acct:exportSalesDocPdf', async (event, docId) => {
    const d = await accountingService.getSalesDoc(docId);
    const { business } = await accountingService.getSettings();
    const html = d.kind === 'receipt' ? X.renderReceiptHtml(d, business) : X.renderInvoiceHtml(d, business);
    const r = await saveHtmlAsPdf(html, `${d.kindLabel}-${d.number}.pdf`.replace(/[\\/:*?"<>|]/g, ''));
    if (r.ok) await auditEvent(event, 'acct.doc.pdf', { kind: d.kind, number: d.number });
    return r;
  });
  // לוגו למסמכים: בחירת קובץ PNG / JPEG מקומי (עד 200KB). remove — הסרת הלוגו
  handle('acct:setLogo', async (event, remove) => {
    if (remove === true) {
      const result = await accountingService.setLogo(null);
      await auditEvent(event, 'acct.settings.logo', { removed: true });
      return result;
    }
    const pick = await dialog.showOpenDialog({ title: 'בחירת לוגו למסמכים', properties: ['openFile'], filters: [{ name: 'תמונה', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { canceled: true };
    const file = pick.filePaths[0];
    if (fs.statSync(file).size > 200 * 1024) throw new Error('קובץ הלוגו גדול מדי (עד 200KB)');
    const result = await accountingService.setLogo(fs.readFileSync(file), path.extname(file).slice(1));
    await auditEvent(event, 'acct.settings.logo', { removed: false });
    return result;
  });
  handle('acct:getReports', async (event, range) => accountingService.getReports(range || {}));
  // דוחות לעסק (PLAN.md 9.5) — "היום" נקבע כאן לפי השעון המקומי, לא מהממשק
  const bizStr = (v, n = 200) => String(v ?? '').slice(0, n);
  const bizDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : undefined);
  handle('acct:getBizSettings', async () => accountingService.getBizSettings());
  handle('acct:saveBizSettings', async (event, input) => {
    const saved = await accountingService.saveBizSettings(input || {});
    await auditEvent(event, 'acct.reports.settings', { period: saved.period, terms: saved.paymentTermsDays, advanceRateBp: saved.advanceRateBp });
    return saved;
  });
  handle('acct:getCustomerBalances', async () => accountingService.getCustomerBalances({ today: localDay(Date.now()) }));
  handle('acct:getCustomerLedger', async (event, customer, range) => accountingService.getCustomerLedger(bizStr(customer),
    { from: bizDay(range && range.from), to: bizDay(range && range.to) }));
  handle('acct:getCashForecast', async (event, opts) => accountingService.getCashForecast({ today: localDay(Date.now()),
    months: Number(opts && opts.months) || 3, includeExpenses: !(opts && opts.includeExpenses === false) }));
  handle('acct:getAdvancesReport', async (event, year) => accountingService.getAdvancesReport({ year: Number(year) || undefined, today: localDay(Date.now()) }));
  handle('acct:getBizDashboard', async () => accountingService.getBizDashboard({ today: localDay(Date.now()) }));
  // כרטסת לקוח לקובץ: הנתונים נקראים שוב מהספרים, לא מהממשק
  handle('acct:exportCustomerLedger', async (event, customer, range) => {
    const l = await accountingService.getCustomerLedger(bizStr(customer), { from: bizDay(range && range.from), to: bizDay(range && range.to) });
    const n = (ag) => (ag / 100).toFixed(2);
    const rows = [...(l.from ? [[l.from, '', 'יתרת פתיחה', '', '', n(l.openingAg)]] : []),
      ...l.rows.map(r => [r.date, r.ref, r.label, r.debitAg ? n(r.debitAg) : '', r.creditAg ? n(r.creditAg) : '', n(r.balanceAg)])];
    const name = 'כרטסת ' + l.customer.replace(/[\\/:*?"<>|]/g, '_');
    const result = await saveCsv({ headers: ['תאריך', 'מסמך', 'פרטים', 'חובה', 'זכות', 'יתרה'], rows, name });
    if (result.ok) await auditEvent(event, 'acct.export.ledger', { rows: rows.length });
    return result;
  });
  // כרטסת לקוח להדפסה (PDF) — מאותם נתונים, ובלוגו ובפרטי העסק
  handle('acct:exportCustomerLedgerPdf', async (event, customer, range) => {
    const l = await accountingService.getCustomerLedger(bizStr(customer), { from: bizDay(range && range.from), to: bizDay(range && range.to) });
    const { business } = await accountingService.getSettings();
    const safe = l.customer.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'לקוח';
    const r = await saveHtmlAsPdf(X.renderCustomerLedgerHtml(l, business), `כרטסת-${safe}.pdf`);
    if (r.ok) await auditEvent(event, 'acct.export.ledger.pdf', { rows: l.rows.length });
    return r;
  });
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
  // מספר הקצאה בנתיב הידני (PLAN.md 9.2א) — בלי רשת
  handle('acct:setAllocation', async (event, invoiceId, input) => {
    const { invoice, previous } = await accountingService.setAllocation(invoiceId, input || {});
    await auditEvent(event, 'acct.invoice.allocation', { number: invoice.number, replaced: !!previous });
    return invoice;
  });
  handle('acct:waiveAllocation', async (event, invoiceId, input) => {
    const result = await accountingService.waiveAllocation(invoiceId, input || {});
    await auditEvent(event, 'acct.invoice.allocation-waived', { number: result.number, reason: result.allocationWaived.reason });
    return result;
  });
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
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, devTools: !(require('electron').app && require('electron').app.isPackaged) } });
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
  // קבצים במבנה אחיד (PLAN.md 9.1): בחירת תיקייה, כתיבת OPENFRMT\<עוסק>.<שנה>\<MMDDhhmm>\ עם INI.TXT, BKMVDATA.zip
  // ודוח ההפקה (PDF). הקבצים עצמם אינם מוצפנים — הם מיועדים להעברה לרשות המסים או לרואה החשבון
  handle('acct:exportUniformFile', async (event, range) => {
    const user = authService.getSession(event.sender.id);
    const out = await accountingService.getUniformFile(range || {}, { user: (user && (user.username || user.name)) || '', version: appVersionOf() });
    const pick = await dialog.showOpenDialog({ title: 'בחירת תיקייה לשמירת הקבצים במבנה אחיד', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false };
    const dir = path.join(pick.filePaths[0], out.folder.root, out.folder.company, out.folder.run);
    if (fs.existsSync(path.join(dir, 'INI.TXT'))) throw new Error('בתיקייה הזו כבר יש הפקה מאותה דקה — נסו שוב בעוד דקה');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'INI.TXT'), out.iniTxt);
    fs.writeFileSync(path.join(dir, 'BKMVDATA.zip'), out.zip);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, devTools: !(require('electron').app && require('electron').app.isPackaged) } });
    try {
      await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(X.renderUniformReportHtml(out.report), 'utf8').toString('base64'));
      fs.writeFileSync(path.join(dir, 'דוח-הפקה.pdf'), await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
    } finally {
      win.destroy();
    }
    await auditEvent(event, 'acct.export.uniform', { from: out.report.from, to: out.report.to, records: out.report.total });
    return { ok: true, path: dir, report: out.report };
  });
  // דוח מע"מ מפורט — קובץ PCN874 (PLAN.md 9.16). הקובץ נשמר במחשב; ההגשה — באתר רשות המסים, בידי המשתמש
  handle('acct:exportPcn874', async (event, input) => {
    const out = await accountingService.getPcn874(input || {});
    const r = await dialog.showSaveDialog({ defaultPath: out.fileName, filters: [{ name: 'קובץ טקסט', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, out.text, 'ascii');
    await auditEvent(event, 'acct.export.pcn874', { month: out.month, months: out.months, records: out.counts, issues: out.issues.length });
    return { ok: true, path: r.filePath, totals: out.totals, issues: out.issues, counts: out.counts, journalVat: out.journalVat, difference: out.difference, range: out.range };
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
  // המחאות דחויות: קבלה לכל שנת מס לפי הפירעון. options.preview — החלוקה לשנים בלי שמירה.
  // ביומן הפעולות רק מספרי הקבלות — בלי מספרי המחאות ובנקים
  handle('npo:addChequeDonation', async (event, input, options) => {
    const preview = !!(options && options.preview === true);
    const r = await npoService.addChequeDonation(input && typeof input === 'object' ? input : {}, { preview });
    if (!preview) await auditEvent(event, 'npo.cheques.add', { receipts: r.donations.map(d => d.receipt.number), years: r.donations.length });
    return r;
  });
  handle('npo:cancelCheque', async (event, id, number, bank) => {
    const r = await npoService.cancelCheque(id, number, bank);
    await auditEvent(event, 'npo.cheques.bounce', { receipt: r.cancelled.receipt.number, replacement: r.replacement ? r.replacement.receipt.number : null });
    return r;
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
  // מס"ב (PLAN.md 9.17): קובץ חיובים וקליטת החזרות — קבצים בלבד, בלי רשת. אותם ערוצים לעמותה ולגמ"ח
  for (const [prefix, svc] of [['npo', npoService], ['gemach', gemachService]]) {
    handle(`${prefix}:saveMasavSettings`, async (event, input) => {
      const s = await svc.saveMasavSettings(input || {});
      await auditEvent(event, `${prefix}.masav.settings`, { institution: s.institution });
      return s;
    });
    handle(`${prefix}:createMasavFile`, async (event, input) => {
      const args = { month: String((input && input.month) || ''), chargeDate: String((input && input.chargeDate) || '') };
      const today = localDay(Date.now());
      const pv = await svc.createMasavBatch(args, { today, preview: true });
      const r = await dialog.showSaveDialog({ defaultPath: pv.fileName, filters: [{ name: 'קובץ מס"ב', extensions: ['txt', 'msv'] }] });
      if (r.canceled || !r.filePath) return { ok: false };
      const out = await svc.createMasavBatch(args, { today });
      fs.writeFileSync(r.filePath, out.text, 'latin1');
      await auditEvent(event, `${prefix}.masav.file`, { batchId: out.batchId, month: args.month, chargeDate: args.chargeDate, count: out.count, totalAg: out.totalAg });
      return { ok: true, path: r.filePath, count: out.count, totalAg: out.totalAg };
    });
    handle(`${prefix}:importMasavReturns`, async (event, text) => {
      if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) throw new Error('קובץ ההחזרות אינו תקין או גדול מדי (עד 20MB)');
      const r = await svc.importMasavReturns(text);
      await auditEvent(event, `${prefix}.masav.returns`, { returned: r.returned, skipped: r.skipped, unmatched: r.unmatched.length });
      return r;
    });
    handle(`${prefix}:closeMasavBatch`, async (event, batchId) => {
      const r = await svc.closeMasavBatch(batchId);
      await auditEvent(event, `${prefix}.masav.close`, { batchId, paid: r.paid });
      return r;
    });
    handle(`${prefix}:cancelMasavBatch`, async (event, batchId) => {
      const r = await svc.cancelMasavBatch(batchId);
      await auditEvent(event, `${prefix}.masav.cancel`, { batchId });
      return r;
    });
  }
  // פרטי חשבון לחיוב — נרשם ביומן הפעולות בלי המספר עצמו
  handle('npo:setStandingBank', async (event, id, input) => {
    const r = await npoService.setStandingBank(id, input && typeof input === 'object' ? input : null);
    await auditEvent(event, r.bankMasked ? 'npo.standing.bank.set' : 'npo.standing.bank.clear', { id });
    return r;
  });
  handle('gemach:setLoanBank', async (event, loanId, input) => {
    const r = await gemachService.setLoanBank(loanId, input && typeof input === 'object' ? input : null);
    await auditEvent(event, r.bankMasked ? 'gemach.loan.bank.set' : 'gemach.loan.bank.clear', { id: loanId });
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
  // תיק תורם לשנה: הסיכום השנתי וכל הקבלות שהופקו במערכת — בקובץ אחד
  handle('npo:exportDonorFilePdf', async (event, donorKey, year) => {
    const { statement: st, donations } = await npoService.getDonorFile(donorKey, year);
    const safe = String(st.donor.name).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'תורם';
    const r = await saveHtmlAsPdf(X.renderDonorFileHtml(st, donations), `תיק-תורם-${st.year}-${safe}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.donorfile.pdf', { year: st.year, receipts: st.receipts.length });
    return r;
  });
  handle('npo:exportReceiptPdf', async (event, id) => {
    const d = await npoService.getDonation(id);
    if (d.receipt && d.receipt.external) throw new Error('הקבלה לתרומה זו הופקה בערוץ התרומה עצמו — יש להפיק אותה משם');
    const r = await saveHtmlAsPdf(X.renderDonationReceiptHtml(d), `קבלה-${d.receipt.number}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.receipt.pdf', { receipt: d.receipt.number });
    return r;
  });
  // מכתבים ותבניות (core/npoLetters.js) — טיוטה לתצוגה ולעריכה במסך. שום דבר לא נשמר בשרת.
  // החישוב על נתוני השנה בלבד דרך המנוע הקיים (donorAnnualStatement / annualReport)
  handle('npo:getThankYouLetter', async (event, donorKey, year, options) => npoService.getThankYouLetter(donorKey, year, options));
  handle('npo:getAnnualNarrative', async (event, year, options) => npoService.getAnnualNarrative(year, options));
  handle('npo:getGrantDraft', async (event, year, input) => npoService.getGrantDraft(year, input));
  handle('npo:exportThankYouPdf', async (event, donorKey, year, options) => {
    const { letter, org } = await npoService.getThankYouLetter(donorKey, year, options);
    const safe = String(letter.donor).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'תורם';
    const r = await saveHtmlAsPdf(L.renderLetterHtml(letter, org), `מכתב-תודה-${letter.year}-${safe}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.letters.thankyou.pdf', { year: letter.year });
    return r;
  });
  handle('npo:exportAnnualNarrativePdf', async (event, year, options) => {
    const { letter, org } = await npoService.getAnnualNarrative(year, options);
    const r = await saveHtmlAsPdf(L.renderLetterHtml(letter, org), `נרטיב-לדוח-שנתי-${letter.year}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.letters.narrative.pdf', { year: letter.year });
    return r;
  });
  handle('npo:exportGrantDraftPdf', async (event, year, input) => {
    const { letter, org } = await npoService.getGrantDraft(year, input);
    const safe = String(letter.fundName).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'קרן';
    const r = await saveHtmlAsPdf(L.renderLetterHtml(letter, org), `בקשת-מענק-${safe}.pdf`);
    if (r.ok) await auditEvent(event, 'npo.letters.grant.pdf', { year: letter.year });
    return r;
  });

  // גמ"ח: הלוואות ללא ריבית, ערבים, לוח סילוקין, הפקדות ופיגורים — נפרד מהעמותה ומהיומן העסקי
  // ---------- גבייה מלקוחות של הארגון (core/collect.js) ----------
  // התשלום נרשם בתחום אחר (חשבוניות / עמותה / גמ"ח) — ולכן נבדק גם הרישיון של אותו תחום, לא רק של הערוץ
  const COLLECT_DOMAIN = { invoice: 'acct:x', donation: 'npo:x', gemach: 'gemach:x' };
  const assertCollectDomain = (kind, perm = 'data.edit') => {
    const ch = COLLECT_DOMAIN[kind];
    const denied = ch && LG.checkChannel(licenseState(), ch, perm);
    if (denied) throw new Error(denied);
  };
  // דרישה קיימת: הרישיון של התחום שלה (הודעה ללקוח, ביטול, סימון "שולם")
  const assertCollectRequest = async (id, perm) => {
    const { payments } = await collectService._load();
    const req = payments.requests.find(x => x.id === id);
    if (req) assertCollectDomain(req.kind, perm);
  };
  // מסך הגבייה מציג רק דרישות של תחומים פתוחים — אחרת הוא חושף חשבוניות / תרומות / הלוואות של תחום שלא ברישיון
  const collectVisible = (kind) => { const ch = COLLECT_DOMAIN[kind]; return !ch || !LG.checkChannel(licenseState(), ch, 'data.view'); };
  handle('collect:getOverview', async () => collectService.getOverview(collectVisible));
  handle('collect:saveSettings', async (event, input) => {
    const s = await collectService.saveSettings(input || {});
    await auditEvent(event, 'collect.settings', { provider: s.provider, link: !!s.linkTemplate });
    return s;
  });
  handle('collect:createRequest', async (event, input) => {
    // רישיון למערכת בת — רק ממסך הרישוי (license:childPaymentRequest, מנהל בלבד)
    if (input && input.kind === 'license') throw new Error('דרישת תשלום על רישיון נוצרת ממסך הרישוי');
    assertCollectDomain(input && input.kind);
    const r = await collectService.createRequest(input || {});
    await auditEvent(event, 'collect.request', { ref: r.ref, kind: r.kind, amountAg: r.amountAg });
    return r;
  });
  handle('collect:getMessage', async (event, id) => {
    await assertCollectRequest(String(id || ''), 'data.view');
    const { npo } = await npoService._load();
    return collectService.getMessage(String(id || ''), npo.settings.orgName);
  });
  handle('collect:cancelRequest', async (event, id) => {
    await assertCollectRequest(String(id || ''), 'data.delete');
    const r = await collectService.cancelRequest(String(id || ''));
    await auditEvent(event, 'collect.cancel', { ref: r.ref });
    return r;
  });
  handle('collect:markPaid', async (event, id, input) => {
    await assertCollectRequest(id, 'data.edit');
    const r = await collectService.markPaid(String(id || ''), input || {});
    await auditEvent(event, 'collect.paid', { ref: r.ref, source: 'manual', txId: r.payment.txId });
    return r;
  });
  handle('collect:previewImport', async (event, csvText) => collectService.previewImport(String(csvText || ''), collectVisible));
  handle('collect:importReport', async (event, csvText, mapping) => {
    // תחום שאינו ברישיון — לא קולטים (אחרת הייבוא היה רושם בו תשלומים)
    const { payments } = await collectService._load();
    for (const kind of new Set(payments.requests.filter(r => r.status === 'open').map(r => r.kind))) assertCollectDomain(kind);
    const r = await collectService.importReport(String(csvText || ''), mapping || {});
    await auditEvent(event, 'collect.import', { recorded: r.recorded.length, failed: r.failed.length, unmatched: r.unmatched.length });
    return r;
  });
  // תשלומי מנויים ממודול האימונים (PLAN.md 9.11) ← חשבונית מס/קבלה. main.js מאמת שהבקשה מתצוגת המודול הכלכלי,
  // שמודול האימונים ברישיון ושהמחסן שלו פתוח; הסכום, התאריך והשם נקראים שוב מהמחסן — לא מהממשק
  const trainerItems = (event) => {
    if (!trainerSource) throw new Error('תשלומי האימונים אינם זמינים במכשיר הזה');
    return trainerSource(event.sender.id);
  };
  handle('collect:getTrainerPayments', async (event) => {
    assertCollectDomain('invoice');
    if (!trainerSource) return { available: false, reason: 'תשלומי האימונים אינם זמינים במכשיר הזה', payments: [] };
    const payments = TP.readPayments(trainerItems(event));
    const { invoices } = await accountingService._load();
    // סוג המסמך המוצע — כמו בהפקה האחרונה (עוסק פטור / מורשה)
    const last = invoices.filter(i => i.trainerPayment).sort((a, b) => b.number - a.number)[0];
    return { available: true, exemptDefault: !!(last && last.vatExempt), payments: TP.withReceipts(payments, invoices) };
  });
  // אישור מפורש של המשתמש (confirmed) — אחרת לא מופקת חשבונית. exempt: עוסק פטור — חשבונית עסקה וקבלה, בלי מע"מ
  handle('collect:issueTrainerReceipt', async (event, key, opts) => {
    assertCollectDomain('invoice');
    if (!opts || opts.confirmed !== true) throw new Error('הפקת חשבונית דורשת אישור מפורש');
    const p = TP.readPayments(trainerItems(event)).find(x => x.key === String(key || ''));
    if (!p) throw new Error('התשלום לא נמצא במודול האימונים (ייתכן שנמחק)');
    const exempt = opts.exempt === true;
    const created = await accountingService.createTrainerReceipt({ ...TP.invoiceInput(p), exempt });
    const inv = await accountingService.getInvoice(created.id);
    await auditEvent(event, 'acct.invoice.create', { id: inv.id, number: inv.number, source: 'trainer', amountAg: p.amountAg, exempt });
    return { id: inv.id, number: inv.number, total: inv.total, customer: inv.customer, exempt, ...(inv.receiptNumber ? { receiptNumber: inv.receiptNumber } : {}) };
  });

  handle('gemach:getOverview', async (event, asOf) => gemachService.getOverview(asOf));
  handle('gemach:getLoan', async (event, id) => gemachService.getLoan(id));
  // דף חשבון ללווה (PDF): לוח הסילוקין, מה ששולם ומה שנותר; חשבון הבנק ממוסך בלבד
  handle('gemach:exportLoanStatementPdf', async (event, id) => {
    const { loan, fundName } = await gemachService.getLoanStatement(id);
    const asOf = localDay(Date.now());
    const safe = String(loan.borrowerName).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'לווה';
    const r = await saveHtmlAsPdf(X.renderLoanStatementHtml(loan, { fundName, asOf }), `דף-חשבון-${safe}-${asOf}.pdf`);
    if (r.ok) await auditEvent(event, 'gemach.statement.pdf', { id: loan.id });
    return r;
  });
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
  // נתוני דוגמה (PLAN.md 1.5): רק בבחירת המשתמש, רק לתחומים הפתוחים ברישיון, ומחיקה של הדוגמה בלבד
  handle('sample:getStatus', async () => sampleService.getStatus(licenseState()));
  handle('sample:add', async (event, kinds) => {
    const r = await sampleService.add(kinds, licenseState(), localDay(Date.now()));
    await auditEvent(event, 'sample.add', r.added);
    return r;
  });
  handle('sample:deleteAll', async (event) => {
    const r = await sampleService.removeAll();
    await auditEvent(event, 'sample.delete', { removed: r.removed });
    return r;
  });
  // מאגר אנשים — קריאה בלבד. נזקק חסוי נכלל רק למי שמורשה לראות חסויים (כמו במסך החסד)
  // רק התחומים הפתוחים ברישיון — כרטיס אדם לא חושף תחום סגור (סקירת אבטחה 10.2026, ממצא 6)
  // המתאמנים (PLAN.md 6.4): רק כשמודול האימונים ברישיון ונתוניו פתוחים (trainerSource בודק ב-main.js). בלי — המאגר בלעדיהם, בלי שגיאה
  const peopleTrainerClients = (event, sources) => {
    if (!trainerSource || (sources && !sources.includes('trainer'))) return [];
    try { return TP.readClients(trainerSource(event.sender.id), localDay(Date.now())); } catch { return []; }
  };
  handle('people:search', async (event, query) => {
    const sources = LG.peopleSources(licenseState());
    return peopleService.search(query, canSeeConfidential(event), sources, peopleTrainerClients(event, sources));
  });
  handle('people:getCard', async (event, key) => {
    const sources = LG.peopleSources(licenseState());
    const c = await peopleService.getCard(key, canSeeConfidential(event), sources, peopleTrainerClients(event, sources));
    if (c.beneficiary.some(b => b.confidential)) await auditEvent(event, 'chesed.confidential.view', { via: 'people', key });
    return c;
  });
  // לוח בוקר: מה דורש טיפול היום בעמותה, בגמ"ח ובחסד. מצרף כמה תחומים — ולכן רק הפתוחים ברישיון
  handle('dashboard:getMorningBrief', async () => {
    const sources = LG.peopleSources(licenseState());
    const acct = !LG.checkChannel(licenseState(), 'acct:getInvoices', 'data.view');
    return MB.morningBrief(await db.load(), localDay(Date.now()), { sources: sources || MB.SOURCES, acct });
  });
  // מסך הבית של המעטפת: מדדים ומשימות להיום. קריאה בלבד, ורק תחומים שפתוחים ברישיון
  homeSummaryFn = async () => {
    const state = licenseState();
    const sources = LG.peopleSources(state) || MB.SOURCES;
    const open = {
      acct: !LG.checkChannel(state, 'acct:getInvoices', 'data.view'),
      npo: sources.includes('npo'),
      gemach: sources.includes('gemach'),
    };
    return HS.homeSummary(await db.load(), localDay(clockNow()), open);
  };
  handle('dashboard:getHomeSummary', homeSummaryFn);
  handle('chesed:getOverview', async (event) => {
    const o = await chesedService.getOverview(canSeeConfidential(event));
    const shown = o.beneficiaries.filter(b => b.tier === 'confidential' && !b.masked).length;
    if (shown) await auditEvent(event, 'chesed.confidential.view', { via: 'overview', count: shown });
    return o;
  });
  // מזעור לפי סוג — רק בתחום שפתוח ברישיון (אחרת: רשימת שמות ושינוי נתונים של תחום סגור)
  const RETENTION_DOMAIN = { beneficiaries: 'chesed:x', donors: 'npo:x', borrowers: 'gemach:x', mortgageClients: 'madv:x', realtyClients: 'rlty:x' };
  handle('privacy:getMap', async () => {
    const m = await privacyService.getMap(await db.listUsers());
    const open = Object.entries(m.retentionKinds || {}).filter(([k]) => !LG.checkChannel(licenseState(), RETENTION_DOMAIN[k] || 'econ:x', 'data.view'));
    return { ...m, retentionKinds: Object.fromEntries(open) };
  });
  const assertRetentionKind = (kind, perm) => {
    const msg = LG.checkChannel(licenseState(), RETENTION_DOMAIN[kind || 'beneficiaries'] || 'econ:x', perm);
    if (msg) throw new Error(msg);
  };
  handle('privacy:retentionPreview', async (event, years, kind) => {
    assertRetentionKind(kind, 'data.view');
    return privacyService.retentionPreview(years, undefined, kind);
  });
  handle('privacy:minimize', async (event, ids, years, kind) => {
    assertRetentionKind(kind, 'data.edit');
    const r = await privacyService.minimize(ids, years, undefined, kind);
    await auditEvent(event, kind && kind !== 'beneficiaries' ? 'privacy.minimize' : 'chesed.privacy.minimize', { kind: kind || 'beneficiaries', years, minimized: r.minimized, skipped: r.skipped });
    return r;
  });
  // מסמכים לתיקון 13 (PLAN.md 9.15) — PDF במקום שהמנהל בוחר
  handle('privacy:exportDefinitionPdf', async (event) => {
    const r = await saveHtmlAsPdf(await privacyService.definitionHtml(await db.listUsers()), 'מסמך-הגדרות-מאגר.pdf');
    if (r.ok) await auditEvent(event, 'privacy.doc.export', { doc: 'definition' });
    return r;
  });
  handle('privacy:exportProcedurePdf', async (event) => {
    const r = await saveHtmlAsPdf(await privacyService.procedureHtml(await db.listUsers()), 'נוהל-אבטחת-מידע.pdf');
    if (r.ok) await auditEvent(event, 'privacy.doc.export', { doc: 'procedure' });
    return r;
  });
  handle('privacy:exportNoticePdf', async (event, kind) => {
    const r = await saveHtmlAsPdf(await privacyService.noticeHtml(kind), `הודעת-יידוע-${String(kind).replace(/[^a-z]/gi, '')}.pdf`);
    if (r.ok) await auditEvent(event, 'privacy.doc.export', { doc: 'notice', kind });
    return r;
  });
  // זכות עיון: מנהל בלבד (permissionFor), התחומים הפתוחים ברישיון בלבד, והייצוא נרשם ביומן
  handle('privacy:exportSubjectPdf', async (event, idNumber) => {
    const { report, html } = await privacyService.subject(idNumber, {
      canSeeConfidential: canSeeConfidential(event), sources: LG.peopleSources(licenseState()),
      acct: !LG.checkChannel(licenseState(), 'acct:getInvoices', 'data.view'),
      realty: !LG.checkChannel(licenseState(), 'rlty:getOverview', 'data.view'),
      madv: !LG.checkChannel(licenseState(), 'madv:getOverview', 'data.view'),
      realestate: !LG.checkChannel(licenseState(), 'realestate:getOverview', 'data.view')
    });
    const r = await saveHtmlAsPdf(html, `מידע-על-${report.idNumber}.pdf`);
    if (r.ok) await auditEvent(event, 'privacy.subject.export', { idNumber: report.idNumber, records: report.count });
    return { ...r, count: report.count };
  });
  handle('privacy:addRequest', async (event, input) => {
    const r = await privacyService.addRequest(input);
    await auditEvent(event, 'privacy.request.add', { id: r.id, type: r.type });
    return r;
  });
  handle('privacy:closeRequest', async (event, requestId, input) => {
    const r = await privacyService.closeRequest(requestId, input);
    await auditEvent(event, 'privacy.request.close', { id: r.id, status: r.status });
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

  // ייעוץ משכנתאות: משרד עם כמה יועצים — כל פעולה מקבלת את המשתמש (madvActor), והשירות מסנן לפי ההרשאה
  const madvActor = (event) => {
    const s = authService.getSession(event.sender.id);
    return { id: s.id, username: s.username, isManager: Array.isArray(s.permissions) && s.permissions.includes('users.manage') };
  };
  handle('madv:getOverview', async (event) => ({
    ...(await mortgageAdvisorService.getOverview(madvActor(event), { today: localDay(Date.now()), realty: !LG.checkChannel(licenseState(), 'rlty:getOverview', 'data.view') })),
    canInvoice: !LG.checkChannel(licenseState(), 'acct:x', 'data.edit') && authService.hasPermission(event.sender.id, 'data.edit')
  }));
  handle('madv:calcTracks', async (event, input) => mortgageAdvisorService.calcTracks(input || {}));
  handle('madv:createClient', async (event, input) => {
    const c = await mortgageAdvisorService.createClient(input, madvActor(event));
    await auditEvent(event, 'madv.client.create', { id: c.id, advisorId: c.advisorId || null });
    return c;
  });
  handle('madv:updateClient', async (event, id, input) => {
    const c = await mortgageAdvisorService.updateClient(id, input || {}, madvActor(event));
    await auditEvent(event, 'madv.client.update', { id, status: c.status, advisorId: c.advisorId || null });
    return c;
  });
  handle('madv:deleteClient', async (event, id) => {
    await mortgageAdvisorService.deleteClient(id, madvActor(event));
    await auditEvent(event, 'madv.client.delete', { id });
    return true;
  });
  handle('madv:toggleDoc', async (event, id, key, docState) => mortgageAdvisorService.toggleDoc(id, key, madvActor(event), docState));
  handle('madv:getMissingDocsMessage', async (event, id) => mortgageAdvisorService.getMissingDocsMessage(id, madvActor(event)));
  // אישורים עקרוניים: נשמרים בתיק, ומושווים במנוע של מעבדת התמהיל (אותה תחזית, אותו חישוב)
  handle('madv:saveApprovals', async (event, id, list) => {
    const r = await mortgageAdvisorService.saveApprovals(id, list, madvActor(event));
    await auditEvent(event, 'madv.approvals.save', { id, count: r.length });
    return r;
  });
  handle('madv:chooseApproval', async (event, id, approvalId) => {
    const r = await mortgageAdvisorService.chooseApproval(id, approvalId, madvActor(event));
    await auditEvent(event, 'madv.approvals.choose', { id, approvalId: approvalId || null });
    return r;
  });
  handle('madv:calcApprovals', async (event, id) => mortgageLabService.calcApprovals(await mortgageAdvisorService.approvalsInput(id, madvActor(event))));
  handle('madv:addOffer', async (event, input) => {
    const o = await mortgageAdvisorService.addOffer(input, madvActor(event));
    await auditEvent(event, 'madv.offer.add', { id: o.id, clientId: o.clientId });
    return o;
  });
  handle('madv:deleteOffer', async (event, id) => {
    await mortgageAdvisorService.deleteOffer(id, madvActor(event));
    await auditEvent(event, 'madv.offer.delete', { id });
    return true;
  });
  // עמלות: תשלומים בתיק, וחשבונית מס/קבלה בהנהלת החשבונות — רק כשהיא ברישיון ובאישור מפורש
  handle('madv:addFeePayment', async (event, id, input) => {
    const r = await mortgageAdvisorService.addFeePayment(id, input || {}, madvActor(event));
    await auditEvent(event, 'madv.fee.payment', { id, paymentId: r.payment.id, amountAg: r.payment.amountAg });
    return r;
  });
  handle('madv:deleteFeePayment', async (event, id, paymentId) => {
    const r = await mortgageAdvisorService.deleteFeePayment(id, paymentId, madvActor(event));
    await auditEvent(event, 'madv.fee.payment.delete', { id, paymentId });
    return r;
  });
  handle('madv:issueFeeInvoice', async (event, id, paymentId, opts) => {
    const denied = LG.checkChannel(licenseState(), 'acct:x', 'data.edit');
    if (denied) throw new Error(denied);
    if (!opts || opts.confirmed !== true) throw new Error('הפקת חשבונית דורשת אישור מפורש');
    const p = await mortgageAdvisorService.feePaymentForInvoice(id, paymentId, madvActor(event));
    const inv = await accountingService.createAdvisoryReceipt({ ...p, exempt: opts.exempt === true });
    await mortgageAdvisorService.linkFeeInvoice(id, paymentId, inv);
    await auditEvent(event, 'acct.invoice.create', { id: inv.id, number: inv.number, source: 'madv', amountAg: p.grossAgorot });
    return { id: inv.id, number: inv.number, total: inv.total };
  });
  handle('madv:getIncome', async (event, year) => mortgageAdvisorService.getIncome(year, madvActor(event)));
  // מיתוג המשרד לדוח ללקוח (מנהל בלבד). הלוגו נבחר בחלון קובץ — לא מגיע מהמסך
  handle('madv:saveBrand', async (event, input) => {
    const b = await mortgageAdvisorService.saveBrand(input || {});
    await auditEvent(event, 'madv.brand.save', { officeName: b.officeName });
    return { ...b, logo: undefined, hasLogo: !!b.logo };
  });
  handle('madv:setBrandLogo', async (event, remove) => {
    if (remove === true) {
      const r = await mortgageAdvisorService.setBrandLogo('');
      await auditEvent(event, 'madv.brand.logo', { removed: true });
      return r;
    }
    const pick = await dialog.showOpenDialog({ title: 'בחירת לוגו לדוח ללקוח', properties: ['openFile'], filters: [{ name: 'תמונה', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { canceled: true };
    const file = pick.filePaths[0];
    if (fs.statSync(file).size > 200 * 1024) throw new Error('קובץ הלוגו גדול מדי (עד 200KB)');
    const ext = path.extname(file).slice(1).toLowerCase();
    const r = await mortgageAdvisorService.setBrandLogo(`data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,` + fs.readFileSync(file).toString('base64'));
    await auditEvent(event, 'madv.brand.logo', { removed: false });
    return r;
  });
  // דוח ממותג ללקוח (PDF): ההשוואה והתוצאה של האישור הנבחר — מהמנוע של המעבדה
  handle('madv:exportClientReportPdf', async (event, id) => {
    const d = await mortgageAdvisorService.reportData(id, madvActor(event));
    const comparison = d.approvalsInput ? await mortgageLabService.calcApprovals(d.approvalsInput) : null;
    const hit = comparison && d.chosen && comparison.offers.find(x => x.offer.id === d.chosen.id);
    const asOf = localDay(Date.now());
    const html = MR.renderClientReportHtml({ ...d, asOf, comparison, chosenResult: hit && hit.result }, designTokensCss());
    const safe = String(d.client.name).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'לקוח';
    const r = await saveHtmlAsPdf(html, `סיכום-ייעוץ-${safe}-${asOf}.pdf`);
    if (r.ok) await auditEvent(event, 'madv.report.pdf', { id });
    return r;
  });
  // ---------- נדל"ן ותיווך (rlty ← econ.realestate) ----------
  const rltyUser = (event) => { const s = authService.getSession(event.sender.id); return s && s.id; };
  // ייעוץ המשכנתאות פתוח ברישיון — רק אז מוצג ונפתח תיק משכנתא מתוך עסקה
  const rltyMortgage = () => !LG.checkChannel(licenseState(), 'madv:getOverview', 'data.view');
  handle('rlty:getOverview', async (event) => ({
    ...(await realtyService.getOverview(localDay(Date.now()), { mortgage: rltyMortgage(), actor: madvActor(event) })),
    canMortgage: rltyMortgage() && authService.hasPermission(event.sender.id, 'data.edit'),
    canInvoice: !LG.checkChannel(licenseState(), 'acct:x', 'data.edit') && authService.hasPermission(event.sender.id, 'data.edit'),
    isManager: authService.hasPermission(event.sender.id, 'users.manage')
  }));
  handle('rlty:getMatches', async (event, kind, id, minScore) => realtyService.getMatches(kind === 'client' ? 'client' : 'property', String(id || ''), minScore));
  for (const [kind, label] of [['Property', 'property'], ['Client', 'client'], ['Deal', 'deal']]) {
    const withActor = kind === 'Deal';
    handle(`rlty:create${kind}`, async (event, input) => {
      const r = await realtyService[`create${kind}`](input || {}, withActor ? rltyUser(event) : undefined);
      await auditEvent(event, `realty.${label}.create`, { id: r.id });
      return r;
    });
    handle(`rlty:update${kind}`, async (event, id, input) => {
      const r = await realtyService[`update${kind}`](String(id || ''), input || {}, withActor ? rltyUser(event) : undefined);
      await auditEvent(event, `realty.${label}.update`, withActor ? { id: r.id, stage: r.stage } : { id: r.id });
      return r;
    });
    handle(`rlty:delete${kind}`, async (event, id) => {
      await realtyService[`delete${kind}`](String(id || ''));
      await auditEvent(event, `realty.${label}.delete`, { id });
      return true;
    });
  }
  // עמלות תיווך: גובה לכל צד, תשלומים, וחשבונית מס/קבלה — רק כשהנהלת החשבונות ברישיון ובאישור מפורש
  handle('rlty:setCommissions', async (event, dealId, input) => {
    const r = await realtyService.setCommissions(String(dealId || ''), input || {});
    await auditEvent(event, 'realty.commission.set', { id: r.id });
    return r;
  });
  handle('rlty:addCommissionPayment', async (event, dealId, input) => {
    const r = await realtyService.addCommissionPayment(String(dealId || ''), input || {}, rltyUser(event));
    await auditEvent(event, 'realty.commission.payment', { id: dealId, paymentId: r.payment.id, side: r.payment.side, amountAg: r.payment.amountAg });
    return r;
  });
  handle('rlty:deleteCommissionPayment', async (event, dealId, paymentId) => {
    await realtyService.deleteCommissionPayment(String(dealId || ''), String(paymentId || ''));
    await auditEvent(event, 'realty.commission.payment.delete', { id: dealId, paymentId });
    return true;
  });
  handle('rlty:issueCommissionInvoice', async (event, dealId, paymentId, opts) => {
    const denied = LG.checkChannel(licenseState(), 'acct:x', 'data.edit');
    if (denied) throw new Error(denied);
    if (!opts || opts.confirmed !== true) throw new Error('הפקת חשבונית דורשת אישור מפורש');
    const p = await realtyService.commissionPaymentForInvoice(String(dealId || ''), String(paymentId || ''));
    const inv = await accountingService.createAdvisoryReceipt(p);
    await realtyService.linkCommissionInvoice(dealId, paymentId, inv);
    await auditEvent(event, 'acct.invoice.create', { id: inv.id, number: inv.number, source: 'rlty', amountAg: p.grossAgorot });
    return { id: inv.id, number: inv.number, total: inv.total };
  });
  // הזמנת שירותי תיווך: שמירה, בדיקת "מה חסר" (בתצוגה), וטופס PDF להחתמה
  handle('rlty:saveOrder', async (event, id, input) => {
    const r = await realtyService.saveOrder(id ? String(id) : '', input || {});
    await auditEvent(event, id ? 'realty.order.update' : 'realty.order.create', { id: r.id });
    return r;
  });
  handle('rlty:deleteOrder', async (event, id) => {
    await realtyService.deleteOrder(String(id || ''));
    await auditEvent(event, 'realty.order.delete', { id });
    return true;
  });
  handle('rlty:exportOrderPdf', async (event, id) => {
    const d = await realtyService.orderDocument(String(id || ''));
    const html = BR.renderOrderHtml(d.order, d, designTokensCss());
    const r = await saveHtmlAsPdf(html, `הזמנת-שירותי-תיווך-${d.order.date}.pdf`);
    if (r.ok) await auditEvent(event, 'realty.order.pdf', { id });
    return r;
  });
  // כדאיות השקעה ומס רכישה: טבלאות המדרגות מוקלדות או נטענות מקובץ — אין ערכים בקוד ואין רשת
  handle('rlty:calcInvestment', async (event, input) => realtyService.calcInvestment(input || {}));
  handle('rlty:saveTaxTable', async (event, input) => {
    const t = await realtyService.saveTaxTable(input || {});
    await auditEvent(event, 'realty.taxTable.save', { id: t.id, year: t.year, kind: t.kind });
    return t;
  });
  // קובץ טקסט / CSV מקומי: "עד סכום, שיעור" בכל שורה. התוכן מוחזר למסך לבדיקה לפני שמירה
  handle('rlty:readTaxTableFile', async () => {
    const pick = await dialog.showOpenDialog({ title: 'טבלת מדרגות מס רכישה', properties: ['openFile'], filters: [{ name: 'טבלה', extensions: ['csv', 'txt'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { canceled: true };
    if (fs.statSync(pick.filePaths[0]).size > 64 * 1024) throw new Error('הקובץ גדול מדי לטבלת מדרגות');
    const text = fs.readFileSync(pick.filePaths[0], 'utf8').replace(/^﻿/, '');
    return { text: RI.bracketsText(RI.parseBrackets(text)) };
  });
  handle('rlty:deleteTaxTable', async (event, id) => {
    await realtyService.deleteTaxTable(String(id || ''));
    await auditEvent(event, 'realty.taxTable.delete', { id });
    return true;
  });
  handle('rlty:verifyTaxTable', async (event, id, note) => {
    const t = await realtyService.verifyTaxTable(String(id || ''), note, true);
    await auditEvent(event, 'realty.taxTable.verify', { id: t.id, year: t.year, kind: t.kind, note: t.verifyNote });
    return t;
  });
  handle('rlty:unverifyTaxTable', async (event, id) => {
    const t = await realtyService.verifyTaxTable(String(id || ''), '', false);
    await auditEvent(event, 'realty.taxTable.unverify', { id: t.id });
    return t;
  });
  handle('rlty:saveAnalysis', async (event, id, input) => {
    const a = await realtyService.saveAnalysis(id ? String(id) : '', input || {});
    await auditEvent(event, id ? 'realty.analysis.update' : 'realty.analysis.create', { id: a.id });
    return a;
  });
  handle('rlty:deleteAnalysis', async (event, id) => {
    await realtyService.deleteAnalysis(String(id || ''));
    await auditEvent(event, 'realty.analysis.delete', { id });
    return true;
  });
  // "פתח תיק משכנתא": תיק ייעוץ חדש לקונה (משויך למי שפתח) וקישור בשני הצדדים
  handle('rlty:openMortgageCase', async (event, dealId, input) => {
    if (!rltyMortgage()) throw new Error('ייעוץ המשכנתאות אינו פתוח ברישיון');
    const caseInput = await realtyService.mortgageCaseInput(String(dealId || ''), input || {});
    const c = await mortgageAdvisorService.createClient(caseInput, madvActor(event));
    await realtyService.linkMortgageCase(String(dealId), c.id);
    await auditEvent(event, 'madv.client.create', { id: c.id, advisorId: c.advisorId || null, source: 'rlty' });
    await auditEvent(event, 'realty.deal.mortgageLink', { id: dealId, caseId: c.id });
    return c;
  });
  handle('rlty:unlinkMortgageCase', async (event, dealId) => {
    await realtyService.unlinkMortgageCase(String(dealId || ''), madvActor(event));
    await auditEvent(event, 'realty.deal.mortgageUnlink', { id: dealId });
    return true;
  });
  handle('rlty:calcProject', async (event, input) => realtyService.calcProject(input || {}));
  handle('rlty:saveProject', async (event, id, input) => {
    const p = await realtyService.saveProject(id ? String(id) : '', input || {});
    await auditEvent(event, id ? 'realty.project.update' : 'realty.project.create', { id: p.id });
    return p;
  });
  handle('rlty:deleteProject', async (event, id) => {
    await realtyService.deleteProject(String(id || ''));
    await auditEvent(event, 'realty.project.delete', { id });
    return true;
  });
  handle('rlty:saveSettings', async (event, input) => {
    const s = await realtyService.saveSettings(input || {});
    await auditEvent(event, 'realty.settings.save', { licenseNo: s.licenseNo });
    return s;
  });
  handle('madv:saveSettings', async (event, input) => {
    const s = await mortgageAdvisorService.saveSettings(input || {});
    await auditEvent(event, 'madv.settings.save', s);
    return s;
  });
  handle('madv:exportSchedule', async (event, offerId) => {
    const r = await saveCsv(await mortgageAdvisorService.getScheduleExport(offerId, madvActor(event)));
    if (r.ok) await auditEvent(event, 'madv.export.schedule', { offerId });
    return r;
  });

  // שמאות מקרקעין: תיק שומה, עסקאות השוואה (הקלדה או קובץ — בלי רשת), שלוש גישות, נעילה ודוח
  // isManager — פרטי השמאי (בכל דוח) משתנים רק בידי מנהל
  handle('realestate:getOverview', async (event) => ({ ...(await realEstateService.getOverview()), isManager: authService.hasPermission(event.sender.id, 'users.manage') }));
  handle('realestate:getCase', async (event, id) => realEstateService.getCase(String(id || '')));
  handle('realestate:createCase', async (event, input) => {
    const c = await realEstateService.createCase(input || {});
    await auditEvent(event, 'realestate.case.create', { id: c.id, no: c.no });
    return c;
  });
  handle('realestate:updateCase', async (event, id, input) => realEstateService.updateCase(String(id || ''), input || {}));
  handle('realestate:deleteCase', async (event, id) => {
    await realEstateService.deleteCase(String(id || ''));
    await auditEvent(event, 'realestate.case.delete', { id });
    return true;
  });
  handle('realestate:importComparables', async (event, id, text, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const r = await realEstateService.importComparables(String(id || ''), String(text || '').slice(0, 2000000), { source: String(o.source || '').slice(0, 80), apply: o.apply === true });
    if (o.apply === true) await auditEvent(event, 'realestate.comps.import', { id, added: r.added });
    return r;
  });
  handle('realestate:finalizeCase', async (event, id) => {
    const s = await realEstateService.finalizeCase(String(id || ''));
    await auditEvent(event, 'realestate.case.finalize', { id: s.id, reportNo: s.reportNo });
    return s;
  });
  handle('realestate:reopenCase', async (event, id) => {
    const s = await realEstateService.reopenCase(String(id || ''));
    await auditEvent(event, 'realestate.case.reopen', { id: s.id, reportNo: s.reportNo });
    return s;
  });
  handle('realestate:addPhoto', async (event, id, input) => realEstateService.addPhoto(String(id || ''), input || {}));
  handle('realestate:deletePhoto', async (event, id, photoId) => realEstateService.deletePhoto(String(id || ''), String(photoId || '')));
  handle('realestate:saveSettings', async (event, input) => realEstateService.saveSettings(input || {}));
  handle('realestate:getReportHtml', async (event, id) => realEstateService.getReportHtml(String(id || '')));
  handle('realestate:exportRegister', async (event) => {
    const r = await saveCsv(await realEstateService.getRegisterExport());
    if (r.ok) await auditEvent(event, 'realestate.register.export', { rows: r.rows });
    return r;
  });
  handle('realestate:exportReport', async (event, id) => {
    const d = await realEstateService.getReportHtml(String(id || ''));
    const r = await saveHtmlAsPdf(d.html, d.name.replace(/[\\/:*?"<>|]/g, '') + '.pdf');
    if (r && r.ok) await auditEvent(event, 'realestate.report.export', { id, final: d.final });
    return r;
  });
  // הדוח של גרסה קודמת שנמסרה (לפני גרסה מתוקנת)
  handle('realestate:exportRevisionReport', async (event, id, rev) => {
    const d = await realEstateService.getRevisionReportHtml(String(id || ''), Number(rev));
    const r = await saveHtmlAsPdf(d.html, d.name.replace(/[\\/:*?"<>|]/g, '') + '.pdf');
    if (r && r.ok) await auditEvent(event, 'realestate.report.export', { id, rev: Number(rev), final: true });
    return r;
  });

  // מעבדת תמהיל: מנוע התמהיל המלא, סלים אחידים, כושר החזר, מחזור, אישורים, עמלת פירעון ואופטימייזר
  handle('mlab:getOverview', async (event) => mortgageLabService.getOverview(madvActor(event)));
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
    const sc = await mortgageLabService.saveScenario(input || {}, madvActor(event));
    await auditEvent(event, 'mlab.scenario.save', { id: sc.id, clientId: sc.clientId });
    return sc;
  });
  handle('mlab:deleteScenario', async (event, id) => {
    await mortgageLabService.deleteScenario(id, madvActor(event));
    await auditEvent(event, 'mlab.scenario.delete', { id });
    return true;
  });
  handle('mlab:exportScenario', async (event, id) => {
    const r = await saveCsv(await mortgageLabService.getScenarioExport(id, madvActor(event)));
    if (r.ok) await auditEvent(event, 'mlab.export.schedule', { id });
    return r;
  });

  // ---------- הגדרות מתקדמות ----------
  const VIEWS_ALLOWED = ['dashboard', 'acct-reports', 'acct-invoices', 'acct-journal', 'personal-finance', 'finance', 'contacts', 'tasks', 'npo', 'gemach', 'chesed', 'people', 'mortgage-advisor', 'mortgage-lab', 'realestate'];
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
    return googleSettingsView(googlePolicy);
  });
  handle('settings:saveGoogle', async (event, input = {}) => {
    const i = input && typeof input === 'object' ? input : {};
    const enabled = i.enabled === true;
    // סוד ריק = משאירים את הקיים (המסך לא מציג אותו)
    const clientId = String(i.clientId || '').trim();
    const keep = googlePolicy.source === 'custom' ? googlePolicy.clientSecret : '';
    const secret = clientId ? (i.clientSecret === undefined || i.clientSecret === '' ? keep : String(i.clientSecret)) : '';
    const next = { enabled, clientId, clientSecret: secret.trim(), onlineRequiresGoogle: enabled && i.onlineRequiresGoogle === true };
    // מזהה ריק = המזהה המובנה; בלי מזהה מובנה — חובה מזהה משלכם
    if (enabled && (clientId || !googleBuiltIn)) GS.validateConfig(next);
    const data = await db.load();
    data.settings = { ...(data.settings || {}), google: next };
    await db.save(data);
    googlePolicy = normalizeGoogle(next);
    await auditEvent(event, 'settings.google.save', { enabled, clientId: next.clientId, onlineRequiresGoogle: next.onlineRequiresGoogle });
    return googleSettingsView(googlePolicy);
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

  // כל מערכת משלמת להורה שלה: בקשת אישור לרישיון של מערכת בת (חדש או חידוש) — רק אחרי תשלום שעוד לא נוצל
  async function requireChildPayment(childId) {
    const p = await collectService.licensePayment(String(childId || ''));
    if (!p) throw new Error('לפני בקשת רישיון למערכת הבת יש ליצור דרישת תשלום על הרישיון השנתי — כל מערכת משלמת למערכת שמעליה');
    if (!p.ready) throw new Error(`דרישת התשלום ${p.ref} עדיין ממתינה לתשלום. כשהתשלום יתקבל — סמנו "שולם" במסך הגבייה או קלטו את דוח חברת הסליקה`);
    return p;
  }

  // ---------- עבודה מרחוק (שרת רישוי) ----------
  handle('license:getRemote', async () => {
    const r = licenseStore.getRemoteSettings();
    const info = licenseStore.syncInfo();
    return { url: r.url || '', lastSync: r.lastSync || null, myCode: info.nodeId,
      pending: await Promise.all((r.pendingChildRequests || []).map(async ({ keyId, name, at }) => ({ keyId, name, at, payment: await collectService.licensePayment(keyId) }))) };
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
    licenseStore.invalidate();
    licenseState();
    return r;
  });
  handle('license:remoteForwardChild', async (event, input = {}) => {
    const { keyId, ...terms } = input || {};
    const pay = await requireChildPayment(keyId);
    const r = await licenseSync.forwardChildRequest(keyId, { ...terms, months: pay.months });
    await collectService.useLicensePayment(pay.id, { childId: keyId });
    await auditEvent(event, 'license.remote.childApprovalRequest', { childId: r.childId, features: terms.features, limits: terms.limits, paid: pay.ref });
    return r;
  });
  // תשלום מערכת בת להורה: דרישת תשלום במסך הגבייה, לפי קוד המערכת (בקשה מהשרת) או לפי קובץ הבקשה
  handle('license:childPaymentRequest', async (event, input = {}) => {
    const v = input || {};
    let childId = String(v.keyId || '');
    let name = String(v.name || '');
    if (v.request) {
      let req;
      try { req = typeof v.request === 'string' ? JSON.parse(v.request) : v.request; } catch { throw new Error('קובץ הבקשה אינו תקין'); }
      if (!req || !req.publicKey) throw new Error('קובץ הבקשה אינו תקין');
      childId = LIC.keyId(req.publicKey);
      name = name || String(req.name || '');
    } else if (!name) {
      const p = (licenseStore.getRemoteSettings().pendingChildRequests || []).find(x => x.keyId === childId);
      name = p ? p.name : '';
    }
    const r = await collectService.createRequest({ kind: 'license', targetId: childId, months: v.months, amount: v.amount,
      payerName: name || 'מערכת בת', payerPhone: v.payerPhone, payerEmail: v.payerEmail,
      description: 'רישיון שנתי' + (name ? ' — ' + name : '') });
    await auditEvent(event, 'license.child.paymentRequest', { childId, ref: r.ref, amountAg: r.amountAg, months: r.target.months });
    return r;
  });
  handle('license:childPaymentStatus', async (event, keyId) => collectService.licensePayment(String(keyId || '')));
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
  // מנהל-העל: חתימת מודל AI מקומי — בוחרים קובץ GGUF, מחושבת תמצית (בזרימה, בלי לטעון 1GB לזיכרון),
  // ונשמרת לידו תעודה ‎.ssmodel. אותו מסלול אמון כמו שחרור גרסה: המפתח הפרטי נשאר בתוך ownerCore
  handle('owner:modelSign', async (event, input = {}) => {
    const pick = await dialog.showOpenDialog({ title: 'בחירת קובץ המודל (‎.gguf)', properties: ['openFile'],
      filters: [{ name: 'קובץ מודל', extensions: ['gguf'] }] });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false };
    const file = pick.filePaths[0];
    const st = fs.statSync(file);
    if (st.size > MP.MAX_SIZE) throw new Error('קובץ המודל גדול מ-3GB');
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (head.toString('latin1') !== MP.GGUF_MAGIC) throw new Error('הקובץ אינו מודל GGUF');
    const x = input || {};
    const text = MP.createModelManifest(ownerCore.rootSigner(), {
      id: x.id, name: x.name, license: x.license, quant: x.quant, contextSize: x.contextSize,
      fileName: path.basename(file), size: st.size, sha256: await MP.hashFile(fs, file),
    }, { issuedAt: clockNow() });
    const p = MP.verifyModelManifest(text, [ownerCore.pubkey()]);
    const out = file.replace(/\.gguf$/i, '') + '.ssmodel';
    fs.writeFileSync(out, text, 'utf8');
    await ownerAudit(event, 'model.sign', { id: p.id, sha256: p.sha256, size: p.size });
    return { ok: true, id: p.id, name: p.name, size: p.size, path: out };
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
    const trial = s.trial ? { startedAt: s.trial.startedAt, endsAt: s.trial.endsAt, daysLeft: s.trial.daysLeft, warn: !!s.trial.warn } : null;
    // תנאי ההפעלה — למסך הרישוי: מה חסר, ועד מתי צריך להתחבר שוב. בתקופת ניסיון — אין תנאים
    const act = trial ? { required: false, ok: true, missing: [], nextDue: null, dueSoon: false, steps: [] } : activationState();
    // תוקף הרישיון של המערכת — למסך הרישוי ("עומד לפוג"). בתקופת ניסיון אין רישיון
    const leaf = trial ? null : licenseStore.leafPayload();
    return { mode: s.mode, status: s.status,
      reasons: (s.reasons || []).map(r => ({ kind: r.kind, reason: r.reason, ...(r.source ? { source: String(r.source) } : {}), ...(r.step ? { step: String(r.step) } : {}) })),
      graceUntil: s.graceUntil || null, expiresAt: leaf && Number.isSafeInteger(leaf.expiresAt) ? leaf.expiresAt : null, features: s.features, limits: s.limits, trial,
      activation: { required: act.required, ok: act.ok, missing: act.missing, nextDue: act.nextDue, dueSoon: act.dueSoon,
        steps: act.steps.map(({ id, label, ok, reason, until }) => ({ id, label, ok, reason, until })) } };
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
    // קודם בדיקת הבקשה והתנאים (בלי תופעות לוואי), ואז התשלום — ומשך הרישיון לפי מה ששולם
    const { childId } = licenseStore.requestChildApproval(input || {});
    const pay = await requireChildPayment(childId);
    const r = licenseStore.requestChildApproval({ ...(input || {}), months: pay.months });
    await collectService.useLicensePayment(pay.id, { childId });
    await auditEvent(event, 'license.child.approvalRequest', { childId: r.childId, features: (input || {}).features, limits: (input || {}).limits, paid: pay.ref });
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
  // סוג של תחום שנפתח ברישיון בנפרד (מחירון ← הנה"ח, תיקי משכנתא ← ייעוץ, תמיכות ← עמותה) נבדק כמו הערוצים של התחום עצמו
  const portDenied = (kind, perm) => { const d = DP.kindDomain(kind); return d ? LG.checkChannel(licenseState(), d + ':x', perm) : null; };
  const assertPortKind = (kind, perm) => { const denied = portDenied(kind, perm); if (denied) throw new Error(denied); };
  handle('ports:listKinds', async () => DP.listKinds((domain) => !LG.checkChannel(licenseState(), domain + ':x', 'data.view')));
  handle('ports:export', async (event, kind) => {
    assertPortKind(kind, 'data.export');
    const r = await saveCsv(DP.exportTable(kind, await db.load()));
    if (r.ok) await auditEvent(event, 'ports.export', { kind, rows: r.rows });
    return r;
  });
  handle('ports:exportTemplate', async (event, kind) => { assertPortKind(kind, 'data.export'); return saveCsv(DP.templateTable(kind)); });
  handle('ports:import', async (event, kind, csvText) => {
    assertPortKind(kind, 'data.edit');
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
  // גיבוי ישן מהמסמך האחרון שהופק (בדיקת קוד 22.10.2026, ממצא 5): בלי opts.confirmedOld — לא משחזרים,
  // ומחזירים { needsConfirm, message } לאישור נוסף. אחרי האישור — אותה קריאה עם confirmedOld: true
  const restoreEcon = async (event, econData, opts, encrypted) => {
    if (!(opts && opts.confirmedOld === true)) {
      const missing = ModCounters.issuedAfterText(issuedAfter(econData, await db.load()));
      if (missing) return { needsConfirm: true, message: missing };
    }
    await db.restore(econData);
    await auditEvent(event, 'data.restore', { encrypted });
    return true;
  };
  handle('data:restoreEncrypted', async (event, text, passphrase, opts) => {
    if (!BK.isEncryptedBackup(text)) throw new Error('הקובץ אינו גיבוי מוצפן של המערכת');
    const plain = BK.decryptBackup(text, passphrase);
    let data;
    try { data = JSON.parse(plain); } catch { throw new Error('קובץ הגיבוי פגום'); }
    return restoreEcon(event, econFromBackup(data), opts, true);
  });
  // ערוץ גיבוי גלוי הוסר: גיבוי לא מוצפן לא יוצא מהמערכת. השחזור מקובץ JSON ישן נשאר (המסך הראשי מקבל רק קובץ של התוכנה כולה)
  handle('data:restore', async (event, backupData, opts) => restoreEcon(event, econFromBackup(backupData), opts, false));

  // ===== עוזר ה-AI — „שאל את התוכנה” =====
  // מקומי בלבד: מנוע הכללים + נתונים שהמנוע הקיים מחזיר. אין רשת, אין מסד חופשי, ואין לוג של שאלות.
  // כל נתון נכנס להקשר רק כשהתחום פתוח — לפי הרשאת המשתמש וגם לפי הרישיון (ctx.opened ב-rules.js).

  // הזכאות לענן: רישיון עם 'ai.cloud' בלבד. featureOpen נכון ל-fallback ל'econ', ולכן נבדק מפורשות
  const aiCloudLicensed = (state) => !!state && state.mode === 'licensed'
    && (state.features || []).includes('ai.cloud') && state.status === 'active';
  const canRead = (event, perm) => authService.hasPermission(event.sender.id, perm);

  // מה המנוע מתאר למשתמש: התוכנית, ומה פתוח — בלבד
  // בלי main.js (בדיקות) — רישיון פתוח כמו ההתנהגות הקיימת של LG.moduleAllowed
  const moduleLicensedFlag = (mod) => (typeof moduleLicensed === 'function' ? moduleLicensed(mod) : LG.moduleAllowed(licenseState(), mod));
  // תחום עמותה פתוח — אותה בדיקה שהשער עושה בפתיחת ערוץ npo: רישיון (econ.npo או econ) + רשות צפייה
  const npoOpen = (event) => !LG.checkChannel(licenseState(), 'npo:getOverview', 'data.view') && canRead(event, 'data.view');
  const aiModules = (event) => ([
    { id: 'acct', label: 'חשבונאות וחשבוניות', opened: canRead(event, 'data.view') && moduleLicensedFlag('econ') },
    { id: 'npo', label: 'עמותה ותרומות', opened: npoOpen(event) },
    { id: 'shamai', label: 'שמאות', opened: moduleLicensedFlag('shamai') && canRead(event, 'data.view') },
    { id: 'trainer', label: 'אימונים', opened: moduleLicensedFlag('trainer') && canRead(event, 'data.view') },
  ]);

  // ניקוי טקסט שהגיע מהממשק — בלי תווי בקרה, באורך מוגבל
  const clipText = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  // טווח מהממשק — קלט לא מהימן: רק תאריכים בצורה YYYY-MM / YYYY-MM-DD, ותווית קצרה. טווח לא תקין = אין טווח
  const DATE_SHAPE = /^\d{4}-\d{2}(-\d{2})?$/;
  function cleanAiRange(raw) {
    const r = raw && typeof raw === 'object' ? raw : null;
    if (!r) return null;
    const from = DATE_SHAPE.test(String(r.from ?? '')) ? String(r.from) : null;
    const to = DATE_SHAPE.test(String(r.to ?? '')) ? String(r.to) : null;
    if (!from && !to) return null;
    return { from, to, label: clipText(r.label, 40) || null };
  }

  // הקשר מהמנוע הקיים. כל קריאה כפופה להרשאה ולרישיון של התחום שלה
  // range (אופציונלי) — הטווח המבוקש; הסיכום נטען לתקופה עצמה, לא לכל הזמן
  async function aiRulesContext(event, today, range = null) {
    const ctx = { today, opened: {} };
    const lic = licenseState();
    const acctCanSee = !LG.checkChannel(lic, 'acct:getInvoices', 'data.view') && canRead(event, 'data.view');
    const npoCanSee = !LG.checkChannel(lic, 'npo:getOverview', 'data.view') && canRead(event, 'data.view');
    ctx.opened.acct = acctCanSee;
    ctx.opened.npo = npoCanSee;
    ctx.opened.shamai = moduleLicensedFlag('shamai') && canRead(event, 'data.view');
    ctx.opened.trainer = moduleLicensedFlag('trainer') && canRead(event, 'data.view');
    if (acctCanSee) {
      const period = { from: range && range.from, to: range && range.to };
      try { ctx.summary = await accountingService.getPeriodSummary(period); } catch { ctx.summary = null; }
      try { ctx.invoices = await accountingService.getInvoices(); } catch { ctx.invoices = null; }
      try { ctx.analytics = await accountingService.getInvoiceAnalytics(); } catch { ctx.analytics = null; }
    }
    if (npoCanSee) {
      try { ctx.npo = await npoService.getOverview(Number(String(today).slice(0, 4)) || undefined); } catch { ctx.npo = null; }
    }
    // הקשר הזמני שהועבר מהשמאות או מהאימונים — נשרף אחרי השימוש, ולא נשמר
    const extra = aiContextBySender.get(event.sender.id);
    aiContextBySender.delete(event.sender.id);
    if (extra) {
      if (ctx.opened.shamai && extra.shamai) ctx.shamai = extra.shamai;
      if (ctx.opened.trainer && extra.trainer) ctx.trainer = extra.trainer;
    }
    return ctx;
  }

  // הקשר מהשמאות/האימונים — קלט לא מהימן: רק השדות המוכרים, בגבולות גודל. לא נשמר לשום מקום
  const clipAg = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000_000 ? v : null);
  function cleanAiContext(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    const s = r.shamai && typeof r.shamai === 'object' ? r.shamai : null;
    if (s) {
      const valueAg = clipAg(s.valueAg);
      if (valueAg != null) {
        const conf = Number(s.confidence);
        out.shamai = {
          label: clipText(s.label, 80),
          valueAg,
          confidence: Number.isFinite(conf) && conf >= 0 && conf <= 100 ? Math.round(conf) : null,
          factors: (Array.isArray(s.factors) ? s.factors.slice(0, 20) : []).map(f => ({
            name: clipText(f && f.name, 60), bp: Math.round(Number(f && f.bp)) || 0 })).filter(f => f.name && Math.abs(f.bp) <= 10000),
          warnings: (Array.isArray(s.warnings) ? s.warnings.slice(0, 10) : []).map(w => clipText(w, 200)).filter(Boolean),
        };
      }
    }
    const t = r.trainer && typeof r.trainer === 'object' ? r.trainer : null;
    if (t) {
      const alerts = (Array.isArray(t.alerts) ? t.alerts.slice(0, 50) : []).map(a => ({
        title: clipText(a && a.title, 60),
        detail: clipText(a && a.detail, 160),
        tone: ['red', 'yellow', 'info'].includes(a && a.tone) ? a.tone : 'info',
      })).filter(a => a.title);
      const clients = Number(t.clients);
      out.trainer = { alerts, clients: Number.isFinite(clients) && clients >= 0 ? Math.round(clients) : undefined };
    }
    return out;
  }

  handle('ai:status', async (event) => {
    const st = aiAssistant.status();
    const state = licenseState();
    const licensed = aiCloudLicensed(state);
    return {
      ...st,
      cloud: { ...st.cloud, licensed, eligible: licensed && st.cloud.consented === true, ready: false },
      opened: Object.fromEntries(aiModules(event).map(m => [m.id, m.opened])),
    };
  });
  handle('ai:prefs:get', async () => aiAssistant.prefsGet());
  handle('ai:prefs:save', async (event, patch) => {
    const saved = aiAssistant.prefsSave(patch || {});
    await auditEvent(event, 'ai.prefs.save', { engine: saved.engine, conceal: saved.conceal });
    return saved;
  });
  // הסכמה לענן — נפרדת ומפורשת. בלי זכאות אין הסכמה, גם אם התבקשה
  handle('ai:consent', async (event, consented) => {
    if (consented === true && !aiCloudLicensed(licenseState())) {
      throw new Error('שירות ה-AI בענן אינו כלול ברישיון של המערכת. העוזר המקומי עובד תמיד, בלי רשת');
    }
    const saved = aiAssistant.prefsSave({ consent: { cloud: consented === true } });
    await auditEvent(event, 'ai.consent', { cloud: saved.consent.cloud });
    return saved;
  });
  handle('ai:modules', async (event) => aiModules(event));
  handle('ai:context', async (event, raw) => {
    aiContextBySender.set(event.sender.id, cleanAiContext(raw));
    return { ok: true };
  });
  // שאלה — נתוני קריאה בלבד. חוסר הרשאה לתחום אינו שגיאה: עונים בשפה פשוטה שהתחום סגור (runRules)
  aiRunFn = async (event, question, extra = {}) => {
    const q = String(question || '');
    if (!q.trim()) throw new Error('כתבו שאלה');
    if (q.length > 500) throw new Error('השאלה ארוכה מדי — עד 500 תווים');
    const today = localDay(clockNow());
    // התקופה של הסיכום חייבת להיות בדיוק זו שעליה runRules מדווח. runRules גוזר את הטווח בעצמו
    // (resolveRange) ודורס ctx.range — ולכן הטווח כאן חייב להסכים איתו, אחרת הסיכום ייספר מתקופה אחרת
    // מהתקופה שמוצגת בתשובה. טווח מפורש מהממשק („החודש שעבר” וכו') מתקבל רק לתחום החשבונות ולמי שרשאי לראותו,
    // ורק כשהוא מסכים עם הטווח של השאלה (rangeAgrees); אחרת — הטווח של הכללים
    const wantsRange = !!extra && typeof extra.range === 'object' && !Array.isArray(extra.range);
    const domain = AI_RULES.detectDomain(q);
    const acctOpen = canRead(event, 'data.view') && !LG.checkChannel(licenseState(), 'acct:getInvoices', 'data.view');
    const fallback = AI_RULES.resolveRange(q, today);
    const hint = (wantsRange && acctOpen && (!domain || domain === 'acct')) ? cleanAiRange(extra.range) : null;
    // הרמז מתקבל רק כשהוא מסכים עם הטווח שהכללים גזרו מהשאלה (ראו rangeAgrees) — אחרת השאלה קובעת
    const range = hint && AI_RULES.rangeAgrees(hint, fallback) ? hint : fallback;
    const ctx = await aiRulesContext(event, today, range);
    if (ctx.opened.acct) ctx.range = range;
    const result = aiAssistant.run(q, ctx);
    // קשר השמאות/האימונים נשרף בכל שאלה — גם כשהוא לא נוצל (בלי כשירות לאימות/canRead) — והוא לא נשמר
    aiContextBySender.delete(event.sender.id);
    return result;
  };
  handle('ai:run', aiRunFn);
  handle('ai:explain', async (event, payload) => aiAssistant.explain(payload || {}));
  // חיפוש בשפה טבעית (Ctrl+K): מסכים מהרשימה הסגורה ורשומות קיימות בלבד — לעולם לא טקסט חופשי של המודל.
  // ההקשר זהה לשאלה (aiRulesContext) — רשומות רק מתחומים שפתוחים למשתמש ולרישיון
  handle('ai:search', async (event, text) => {
    const q = String(text || '');
    if (q.length > 200) throw new Error('החיפוש ארוך מדי — עד 200 תווים');
    const ctx = await aiRulesContext(event, localDay(clockNow()));
    return aiAssistant.search(q, ctx);
  });
  // המודל המקומי (תוסף): מצב — לכל משתמש; התקנה, אימות והסרה — מנהל בלבד (permissionFor).
  // הקבצים נבחרים בחלון של המערכת כאן בתהליך הראשי — נתיב לא מתקבל מהמסך
  handle('ai:model:status', async () => aiAssistant.model.status());
  handle('ai:model:install', async (event) => {
    const pickM = await dialog.showOpenDialog({ title: 'בחירת תעודת המודל (‎.ssmodel)', properties: ['openFile'], filters: [{ name: 'תעודת מודל', extensions: ['ssmodel'] }] });
    if (pickM.canceled || !pickM.filePaths.length) return { canceled: true };
    const pickG = await dialog.showOpenDialog({ title: 'בחירת קובץ המודל (‎.gguf)', defaultPath: path.dirname(pickM.filePaths[0]), properties: ['openFile'], filters: [{ name: 'קובץ מודל', extensions: ['gguf'] }] });
    if (pickG.canceled || !pickG.filePaths.length) return { canceled: true };
    const manifest = fs.readFileSync(pickM.filePaths[0], 'utf8');
    if (manifest.length > 64 * 1024) throw new Error('תעודת המודל אינה תקינה');
    const res = await aiAssistant.model.install(manifest, pickG.filePaths[0]);
    await auditEvent(event, 'ai.model.install', { id: res && res.id });
    // בלי נתיב פנימי למסך
    return { id: res.id, name: res.name, size: res.size };
  });
  handle('ai:model:verify', async () => aiAssistant.model.verify());
  handle('ai:model:remove', async (event) => {
    const res = await aiAssistant.model.remove();
    await auditEvent(event, 'ai.model.remove', {});
    return res;
  });
  // העוזר מצביע על המסך שבו אפשר לראות את הנתונים. רשימת יעדים סגורה — בלי ניווט חופשי
  const AI_VIEW_TARGETS = new Set(['acct-invoices', 'acct-reports', 'npo', 'realestate', 'trainer']);
  handle('ai:open', async (event, target) => {
    const view = AI_VIEW_TARGETS.has(target) ? target : null;
    if (!view) throw new Error('המסך המבוקש אינו מוכר');
    await auditEvent(event, 'ai.open', { view });
    return { view };
  });
  // דוגמת שאלות — לפי התחומים שפתוחים למשתמש הזה
  handle('ai:sample', async (event) => {
    const open = await aiModules(event);
    const qs = [];
    if (open.find(m => m.id === 'acct').opened) qs.push('כמה גבייתי החודש?', 'מי לא שילם?', 'מה דוח המע"מ של החודש?');
    if (open.find(m => m.id === 'npo').opened) qs.push('אילו תורמים תרמו השנה?');
    if (open.find(m => m.id === 'shamai').opened) qs.push('מה הערכת השווי האחרונה?');
    if (open.find(m => m.id === 'trainer').opened) qs.push('איזה מתאמנים דורשים תשומת לב?');
    qs.push('איך מוציאים חשבונית?');
    return qs;
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
    // מערכת ברישיון מסתנכרנת תמיד (תנאי ההפעלה: חיבור לשרת כל 7 ימים) — לא רק כשקבלת הודעות אוטומטית מופעלת.
    // בשבת וביום טוב אין סנכרון (למעלה) — 7 ימים מספיקים גם אחרי יום טוב של שלושה ימים
    const licensed = licenseStore.current().mode === 'licensed' && !!licenseStore.leafPayload();
    if ((chatStore.settings().autoFetch || licensed) && licenseStore.syncKey(false)) {
      try { out.system = await licenseSync.receive(); licenseStore.invalidate(); licenseState(); } catch (e) { out.systemError = e.message; }
    }
    if (ownerChatStore.settings().autoFetch && ownerCore && ownerCore.isUnlocked()) { try { out.owner = await licenseSync.ownerReceive(); } catch (e) { out.ownerError = e.message; } }
  } finally { autoFetchBusy = false; }
  return out;
}

module.exports = { toUserError, setErrorLogger, initEcon, chatAutoFetch, permissionFor, licenseState, onLicenseChange: (fn) => { licenseListeners.push(fn); }, invalidateLicense: () => licenseStore && licenseStore.invalidate(), getDb: () => db, isLoggedIn: () => authService.sessions.size > 0, assertAccess,
  // מודולים שדורשים כניסה: בדיקה שקטה, רישום פעילות (עבודה במודול כזה מונעת ניתוק), ואירוע כניסה/יציאה
  hasSession: (senderId) => authService.peekSession(senderId),
  touchSession: (senderId) => { authService.getSession(senderId); },
  // המעטפת (main.js) בשם המודול הכלכלי: אותו ערוץ, אותו תור ואותו שומר (כניסה, הרשאה, רישיון) — כמו קריאה מהמודול
  shellCall,
  onAuthChange: (fn) => { authListeners.push(fn); } };
