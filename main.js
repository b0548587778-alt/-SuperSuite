const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, net, session, shell, Menu, safeStorage, nativeTheme } = require('electron');
const Display = require('./shell/display');
const crypto = require('crypto');
const BK = require('./modules/econ/core/backupCrypto');
const AB = require('./modules/econ/core/features');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { canShellNavigate, canModuleOpen, EDITING_CHECK_JS } = require('./shell/nav-guard');
const AutoBk = require('./shell/auto-backup');
const DbRecovery = require('./shell/db-recovery');
const DbKey = require('./shell/db-key');
const SecureStore = require('./shell/secure-store');
const ModCounters = require('./shell/module-counters');
const Legacy = require('./shell/legacy-modules');
const Chat = require('./shell/licensing/chat');
const UsersBk = require('./modules/econ/core/usersBackup'); // משתמשים ויומן הפעולות בגיבוי המלא
const { issuedAfter } = require('./modules/econ/core/database');
const CodeGuard = require('./shell/code-guard');
const PlainBk = require('./shell/plain-backups');
const Catalog = require('./shell/catalog');
const Hebcal = require('./shell/hebcal');
const NavHistory = require('./shell/history');
const Layout = require('./shell/layout');
const SyncService = require('./shell/sync/service');
const LG = require('./shell/licensing/gate');
const LoginGate = require('./shell/login-gate');
const { createLogger } = require('./shell/logger');
const { createCrashGuard, MODULE_NAMES } = require('./shell/crash');
// יומן תקלות ורשת ביטחון לקריסות (PLAN.md 2.1–2.2) — מותקנים לפני כל דבר אחר, כדי לתפוס גם תקלה בעלייה
const logger = createLogger({ dir: app.getPath('userData') });
const crash = createCrashGuard({ logger, dialog, app, getWin: () => win, version: app.getVersion ? String(app.getVersion()) : '',
  beforeExit: () => flushPendingWrites() });
crash.installProcessHandlers();
// בדיקת עלייה של הגרסה הארוזה (PLAN.md 3.5, CI בלבד): רק עם תיקיית נתונים נפרדת — לא נוגעים בנתונים אמיתיים
const Smoke = require('./shell/smoke');
const Splash = require('./shell/splash');
const PrintPdf = require('./shell/print-pdf');
const smoke = Smoke.isSmoke(process.argv)
  ? (process.argv.some(a => a.startsWith('--user-data-dir=')) ? Smoke.createSmoke({ fs, path, dir: app.getPath('userData'), dialog, exit: (c) => app.exit(c), shots: Smoke.shotsDir(process.argv) }) : (app.exit(2), null))
  : null;
// תצוגות מותרות = הקטלוג + תצוגות חדשות שזוהו בסרגל הפנימי של המודול הכלכלי (סנכרון אוטומטי)
const ECON_EXTRAS = (() => {
  try { return Catalog.extrasFromHtml(fs.readFileSync(path.join(__dirname, 'modules', 'econ', 'views', 'index.html'), 'utf8')); }
  catch { return []; }
})();
const ECON_VIEWS = [...Catalog.ECON_VIEWS, ...ECON_EXTRAS.map(x => x.view)];
// האם מותר לפתוח תצוגה פנימית במודול (רק במודול הכלכלי יש תצוגות בסרגל)
const moduleHasView = (id, view) => id === 'econ' && ECON_VIEWS.includes(view);

const SIDEBAR = 264;
// היסטוריית ניווט (אחורה/קדימה). replaying: מעבר שמקורו בהיסטוריה עצמה לא נרשם כצעד חדש
const history = NavHistory.create();
let replaying = false;
// מודול האימונים (trainer) עבר למוצר החינוכי הנפרד — גיבוי ישן שכולל אותו משוחזר בלי החלק הזה (restoreAllRun)
const MODS = ['econ', 'shamai', 'tools'];
const LS_MODS = ['shamai', 'tools'];
const BACKUP_SCOPES = ['all', ...MODS];
const ENTRY = {
  // embedded=1: הסרגל הפנימי של המודול מוסתר — הניווט כולו בסרגל האחיד של המעטפת
  econ: 'app://econ/views/index.html?embedded=1',
  shamai: 'app://shamai/index.html',
  tools: 'app://tools/index.html'
};
const ZOOM_MIN = 0.8, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1;
// תקרת גודל לערך בודד ב-localStorage בזמן שחזור גיבוי (5MB — מגן מפני קובץ גיבוי נפוח/זדוני)
const LS_VALUE_MAX = 5 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let win;
let econ;
const views = {};
let active = null;
let econView = null; // התצוגה הפעילה במודול הכלכלי (לאכיפת הרישוי)
let zoom = 1;
// דיאלוג פתוח במעטפת: התצוגות מוסתרות כדי שלא יכסו אותו
let overlay = false;

function modulesRoot() { return path.join(__dirname, 'modules'); }

function registerProtocol() {
  protocol.handle('app', req => {
    const url = new URL(req.url);
    const mod = url.hostname;
    if (!MODS.includes(mod)) return new Response('Not found', { status: 404 });
    const root = path.join(modulesRoot(), mod);
    let rel;
    try { rel = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad request', { status: 400 }); }
    if (rel === '/' || rel === '') rel = '/index.html';
    // שפת העיצוב המשותפת (PLAN.md 7.1): קובץ אחד מהמעטפת לכל המודולים — רק הנתיב המדויק הזה
    if (rel === '/design-tokens.css') return net.fetch(pathToFileURL(path.join(__dirname, 'shell', 'design-tokens.css')).toString());
    // רשת ביטחון במסכים (PLAN.md 2.4) — אותו קובץ לכל המודולים
    if (rel === '/screen-guard.js') return net.fetch(pathToFileURL(path.join(__dirname, 'shell', 'screen-guard.js')).toString());
    if (rel === '/ui-kit.css') return net.fetch(pathToFileURL(path.join(__dirname, 'shell', 'ui-kit.css')).toString());
    if (rel === '/ss-dialog.js') return net.fetch(pathToFileURL(path.join(__dirname, 'shell', 'ss-dialog.js')).toString());
    // בועות העזרה "?" (נגישות, סבב 4) — display-preload.js מוסיף את התג בכל מודול
    if (rel === '/ss-help.js') return net.fetch(pathToFileURL(path.join(__dirname, 'shell', 'ss-help.js')).toString());
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function isExternal(u) { return /^(https?:|mailto:|tel:)/i.test(u); }

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  // בממשק Windows בעברית Electron מודד את x מהימין — viewBounds מתקן, אחרת המודול מכסה את הסרגל
  const b = Layout.viewBounds(w, h, SIDEBAR, app.getLocale());
  for (const id of Object.keys(views)) views[id].setBounds(b);
}

// קיצורי מקלדת: נתפסים גם בתוך המודולים וגם במעטפת. פקודות שאינן ניווט נשלחות למעטפת
function handleShortcut(input, wc) {
  if (input.type !== 'keyDown') return false;
  // חזרות אוטומטיות (החזקת מקש) לא מפעילות ניווט/זום — מונע "הצפה" בשינויי מצב
  if (input.isAutoRepeat) return false;
  if (input.control && !input.shift && /^[1-3]$/.test(input.key)) {
    // מבטלים את הקיצור תמיד (Ctrl+ספרה לא מכניס תו), ומעבירים מודול רק אם לא מקלידים בשדה
    const target = MODS[+input.key - 1];
    wc.executeJavaScript(EDITING_CHECK_JS)
      .then(editing => { if (!editing) switchTo(target); })
      .catch(() => {});
    return true;
  }
  // חלון הנגישות (♿): Alt+0 או Ctrl+Alt+A — לפי המקש הפיזי, כך שעובד גם במקלדת עברית
  if ((input.alt && !input.control && !input.shift && input.code === 'Digit0') || (input.control && input.alt && !input.shift && input.code === 'KeyA')) {
    if (win && !win.isDestroyed()) win.webContents.focus();
    sendCmd('a11y');
    return true;
  }
  if (input.control && (input.key === '=' || input.key === '+')) { setZoom(zoom + ZOOM_STEP); return true; }
  if (input.control && input.key === '-') { setZoom(zoom - ZOOM_STEP); return true; }
  if (input.control && input.key === '0') { setZoom(1); return true; }
  if (input.key === 'F1') { sendCmd('help'); return true; }
  // אחורה/קדימה כמו בדפדפן: Alt+חצים, ומקשי Back/Forward של מקלדות ועכברים
  if ((input.alt && input.key === 'ArrowLeft') || input.key === 'BrowserBack') { navigateHistory(-1); return true; }
  if ((input.alt && input.key === 'ArrowRight') || input.key === 'BrowserForward') { navigateHistory(1); return true; }
  if (input.control && !input.shift && (input.key === 'k' || input.key === 'K')) {
    // החיפוש יושב בסרגל של המעטפת: מעבירים אליה את הפוקוס של המקלדת
    if (win && !win.isDestroyed()) win.webContents.focus();
    sendCmd('search');
    return true;
  }
  if (input.control && input.shift && (input.key === 'B' || input.key === 'b')) { sendCmd('backup'); return true; }
  if (input.control && input.shift && (input.key === 'R' || input.key === 'r')) { sendCmd('restore'); return true; }
  return false;
}

function recordNav(loc) {
  if (!replaying) history.push(loc);
  if (win && !win.isDestroyed()) win.webContents.send('shell:history', history.state());
}

// ביצוע מעבר שמקורו בהיסטוריה: מודול + תצוגה פנימית, או מסך הבית
function navigateHistory(delta) {
  const loc = history.go(delta);
  if (!loc) return false;
  replaying = true;
  try {
    if (!loc.mod) goHome();
    else { switchTo(loc.mod); if (loc.view) openModuleView(loc.mod, loc.view); }
  } finally { replaying = false; }
  if (win && !win.isDestroyed()) win.webContents.send('shell:history', history.state());
  return true;
}

function sendCmd(cmd) {
  if (win && !win.isDestroyed()) win.webContents.send('shell:cmd', cmd);
}

// פעולות מכוונות בלבד (לא תזוזת עכבר): לחיצה, גלגלת, מקש, מגע וגלילה. פעם בכמה שניות לכל היותר
const ACTIVITY_INPUTS = new Set(['mouseDown', 'mouseWheel', 'contextMenu', 'rawKeyDown', 'keyDown', 'touchStart', 'gestureScrollBegin', 'gestureScrollUpdate', 'gestureTap', 'pointerDown']);
const ACTIVITY_THROTTLE_MS = 2000;
function wireView(id, wc) {
  wc.setWindowOpenHandler(({ url }) => { if (isExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('app://' + id + '/')) return;
    e.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  // עבודה במודול שדורש כניסה נחשבת פעילות — אחרת הניתוק האוטומטי מוציא באמצע עבודה.
  // גם עכבר, גלגלת ומגע (input-event), לא רק מקלדת: עבודה בעכבר בלבד נותקה אחרי 15 דקות והכתיבות נדחו (ממצא 37)
  let lastTouch = 0;
  const touchActivity = () => {
    // גם המסך הכלכלי: הקלדה בטופס בלי שמירה היא עבודה, ולא סיבה לנתק באמצע (סקירת קוד 2.11.2026)
    if ((id !== 'econ' && !loginGate.isLocked(id)) || !views.econ || !econ || !econ.touchSession) return;
    const t = Date.now();
    if (t - lastTouch < ACTIVITY_THROTTLE_MS) return;
    lastTouch = t;
    econ.touchSession(views.econ.webContents.id);
  };
  wc.on('before-input-event', (e, input) => {
    touchActivity();
    if (handleShortcut(input, wc)) e.preventDefault();
  });
  wc.on('input-event', (_e, input) => { if (input && ACTIVITY_INPUTS.has(input.type)) touchActivity(); });
  // מסך שקרס או נתקע — הודעה וטעינה מחדש של המודול בלבד (PLAN.md 2.1)
  crash.wireContents(id, wc, () => { if (!wc.isDestroyed()) wc.loadURL(ENTRY[id]); });
  CodeGuard.wireDevToolsGuard(wc, app.isPackaged);
  if (smoke) smoke.watch(id, wc);
}

// כפתורי העכבר הצדדיים (אחורה/קדימה) — Windows שולח אותם כ-app-command לחלון
function wireAppCommand(w) {
  w.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') navigateHistory(-1);
    if (cmd === 'browser-forward') navigateHistory(1);
  });
}

function ensureView(id) {
  if (views[id]) return views[id];
  const prefs = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true };
  if (id === 'econ') prefs.preload = path.join(modulesRoot(), 'econ', 'preload.js');
  const v = new WebContentsView({ webPreferences: CodeGuard.guardPrefs(prefs, app.isPackaged) });
  views[id] = v;
  v.setVisible(false); // תצוגות מוסתרות לא מציירות ולא קולטות קלט
  win.contentView.addChildView(v); // Electron: View.addChildView (לא addChild)
  v.webContents.setZoomFactor(zoom);
  wireView(id, v.webContents);
  layout();
  v.webContents.loadURL(ENTRY[id]);
  return v;
}

// רישוי (docs/LICENSING-DESIGN.md, שלב 4): מודול שאינו ברישיון או מערכת נעולה — לא נפתחים.
// במערכת הכלכלית "רישוי ומערכות" ו"הודעות" נשארים פתוחים, כדי שאפשר יהיה להתקין רישיון ולפנות לספק
function licenseNow() {
  try { return econ && econ.licenseState ? econ.licenseState() : { mode: 'unlicensed' }; } catch { return { mode: 'unlicensed' }; }
}
function sendLicenseToShell(state) {
  if (win && !win.isDestroyed()) win.webContents.send('shell:license', LG.shellState(state));
}
// שינוי סטטוס: עדכון המעטפת, ויציאה ממודול שנחסם
function enforceLicense(state) {
  sendLicenseToShell(state);
  if (!active) return;
  if (active === 'econ') { if (!LG.viewAllowed(state, 'econ', econView)) openEconView('licensing'); }
  else if (!LG.moduleAllowed(state, active)) goHome();
}

// שמאי — רק אחרי כניסה. בלי כניסה: מסך הכניסה במודול הכלכלי, והמודול נפתח אחרי הכניסה
const loginGate = LoginGate.createLoginGate({ isLoggedIn: () => econSessionAlive() });
function econSessionAlive() {
  const v = views.econ;
  return !!(v && !v.webContents.isDestroyed() && econ && econ.hasSession && econ.hasSession(v.webContents.id));
}
// אחרי כניסה — פותחים את המודול שחיכה. אחרי יציאה/ניתוק — יוצאים ממודול נעול למסך הכניסה
// כניסה או יציאה: מודולים נעולים שכבר נטענו נטענים מחדש — אחרי יציאה לא נשארים נתונים בזיכרון,
// ואחרי כניסה מודול שנטען בלי כניסה (למשל בגיבוי האוטומטי) מקבל את הנתונים
let lockedViewsSession = null;
function reloadLockedViewsOnSessionChange() {
  const now = econSessionAlive();
  if (lockedViewsSession === now) return;
  const first = lockedViewsSession === null;
  lockedViewsSession = now;
  // המעטפת מנקה את תשובת העוזר ואת נתוני מסך הבית בסוף פגישה (סקירת קוד 2.11.2026)
  if (win && !win.isDestroyed()) win.webContents.send('shell:session', now);
  if (first && !now) return;
  // ניתוק שקט אחרי חוסר פעילות: גם המסך הכלכלי עובר מיד למסך הכניסה, ולא ממשיך להציג נתונים עד הלחיצה הבאה
  if (!now && views.econ && !views.econ.webContents.isDestroyed()) views.econ.webContents.send('econ:auth-check');
  for (const id of LoginGate.LOCKED_MODS) {
    const v = views[id];
    if (v && !v.webContents.isDestroyed()) v.webContents.reload();
  }
}
function onEconAuthChange() {
  reloadLockedViewsOnSessionChange();
  if (loginGate.mustLeave(active)) { showLoginForLocked(); return; }
  const p = loginGate.takePending();
  if (p && (active === 'econ' || active === null)) { switchTo(p.id); if (p.view) openModuleView(p.id, p.view); }
}
function showLoginForLocked() {
  switchTo('econ');
  const v = views.econ;
  // הממשק הכלכלי בודק מחדש את הכניסה (אחרי ניתוק שקט הוא עוד לא יודע שהפגישה פגה)
  if (v) waitLoaded(v.webContents).then(() => { if (!v.webContents.isDestroyed()) v.webContents.send('econ:auth-check'); });
}

function switchTo(id) {
  if (!MODS.includes(id)) return;
  const lic = licenseNow();
  if (!LG.moduleAllowed(lic, id) && id !== 'econ') {
    sendLicenseToShell(lic);
    if (win && !win.isDestroyed()) win.webContents.send('shell:active', active);
    return;
  }
  // אחרי הרישוי: מודול שלא ברישיון לא מבקש כניסה
  if (loginGate.route(id) !== id) { showLoginForLocked(); return; }
  const v = ensureView(id);
  active = id;
  for (const k of Object.keys(views)) views[k].setVisible(!overlay && k === id);
  v.webContents.focus();
  if (win && !win.isDestroyed()) win.webContents.send('shell:active', id);
  // במודול הכלכלי התצוגה תדווח מיד (shell:econ-view) ותשלים את הרישום
  recordNav({ mod: id, view: null });
  if (id === 'econ' && !LG.moduleAllowed(lic, 'econ')) openEconView('licensing');
}

// חזרה למסך הבית: מסתירים את כל התצוגות כך שהמעטפת נשארת לבדה.
// זו הדרך "לצאת" ממודול בלי לסגור את התוכנה.
function goHome() {
  loginGate.clear();
  for (const k of Object.keys(views)) views[k].setVisible(false);
  active = null;
  // במצב שבת פעיל הכיסוי נשאר — אחרת מודול שנפתח אחר כך מופיע מעל מסך השבת (סקירת קוד 2.11.2026)
  if (!syncPaused()) overlay = false;
  if (win && !win.isDestroyed()) { win.webContents.focus(); win.webContents.send('shell:active', null); }
  recordNav({ mod: null, view: null });
}

// פתיחת תצוגה פנימית במודול הכלכלי. נשלח אחרי הטעינה; ה-preload שומר את הבקשה עד שהממשק מוכן
function openEconView(view) {
  if (!ECON_VIEWS.includes(view)) return false;
  if (!LG.viewAllowed(licenseNow(), 'econ', view)) view = 'licensing';
  const v = ensureView('econ');
  waitLoaded(v.webContents).then(() => {
    if (!v.webContents.isDestroyed()) v.webContents.send('econ:goto', view);
  });
  return true;
}

function openModuleView(id, view) {
  if (id === 'econ') return openEconView(view);
  return false;
}

// דיאלוג במעטפת: מסתירים את המודול הפעיל בזמן שהדיאלוג פתוח, ומחזירים אותו בסגירה
function setOverlay(on) {
  overlay = !!on;
  for (const k of Object.keys(views)) views[k].setVisible(!overlay && k === active);
  if (!overlay && active && views[active]) views[active].webContents.focus();
}

function setZoom(z) {
  zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
  for (const id of Object.keys(views)) views[id].webContents.setZoomFactor(zoom);
  // מיזוג: הקובץ מחזיק גם את הגדרות הלוח העברי — אסור לדרוס אותן
  saveJson(uiFile(), { ...loadJson(uiFile()), zoom });
}

/* ---------- לוח עברי ושבת ---------- */
function calendarSettings() { return Hebcal.resolveSettings(loadJson(uiFile()).calendar || {}); }
// מנקה קלט מהמעטפת: עיר מהרשימה, דקות הדלקה 0–60, דגלים בוליאניים
function sanitizeCalendar(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = {};
  if (Hebcal.CITIES.some(c => c.id === s.city)) out.city = s.city;
  if (s.candles === null || (Number.isInteger(s.candles) && s.candles >= 0 && s.candles <= 60)) out.candles = s.candles;
  if (typeof s.shabbatMode === 'boolean') out.shabbatMode = s.shabbatMode;
  if (typeof s.diaspora === 'boolean') out.diaspora = s.diaspora;
  return out;
}

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
const uiFile = () => path.join(app.getPath('userData'), 'ui-settings.json');
const backupSettingsFile = () => path.join(app.getPath('userData'), 'backup-settings.json');
// תיקיית הגיבוי האוטומטי: היעד שנבחר (USB), ואם לא נבחר — תיקיית המסמכים
// תיקיית "מסמכים" — במחשב שאין בו כזו app.getPath זורק, והגיבוי האוטומטי נכשל גם כשנבחרה תיקייה אחרת
// (נמצא במחשב של הבעלים 24.10.2026). אז — שולחן העבודה, ואחריו תיקיית הבית
function documentsDir() {
  for (const name of ['documents', 'desktop', 'home']) {
    try { const p = app.getPath(name); if (p) return p; } catch (e) { /* הבא בתור */ }
  }
  return process.env.USERPROFILE || process.cwd();
}
const defaultBackupDir = () => path.join(documentsDir(), 'SuperSuite-Backups');
const backupDir = () => loadJson(backupSettingsFile()).targetDir || defaultBackupDir();
function loadJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
// קובץ זמני ← דיסק (fsync) ← החלפה: ניתוק חשמל באמצע לא משאיר קובץ שבור (ש-loadJson היה קורא כ-{},
// ויעד הגיבוי ל-USB היה חוזר בשקט לתיקיית המסמכים). כשל — הקובץ הקודם נשאר, השגיאה ביומן, ומוחזר false
function saveJson(f, obj) {
  const tmp = f + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, f);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* אין מה לנקות */ }
    logger.error('settings-save', e);
    return false;
  }
}
function loadState() { return loadJson(stateFile()); }
function saveState() {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    saveJson(stateFile(), { ...b, max: win.isMaximized() });
  } catch {}
}

/* ---------- מסך פתיחה (PLAN.md 7.2) ----------
   עד שהמעטפת נטענת. נסגר לפני כל חלון הודעה או קוד שחזור, ובכל מקרה אחרי Splash.MAX_MS */
let splash = null;
function openSplash() {
  splash = Splash.createSplash({ open: () => {
    const w = new BrowserWindow({ width: 420, height: 300, frame: false, resizable: false, movable: true, center: true, skipTaskbar: false,
      show: true, backgroundColor: '#0f1a30', title: 'SuperSuite', icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: CodeGuard.guardPrefs({ contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false }, app.isPackaged) });
    w.removeMenu();
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.loadFile(path.join(__dirname, 'shell', 'splash.html'));
    return w;
  } });
}
/* ---------- מדריך המשתמש (PLAN.md 1.6) ---------- */
const USER_GUIDE = path.join(__dirname, 'shell', 'guide', 'index.html');
function guideWindow(show) {
  const w = new BrowserWindow({ width: 900, height: 860, show, title: 'SuperSuite — מדריך למשתמש', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: CodeGuard.guardPrefs({ contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false }, app.isPackaged) });
  w.removeMenu();
  CodeGuard.wireDevToolsGuard(w.webContents, app.isPackaged);
  w.webContents.on('will-navigate', ev => ev.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}
let guideWin = null;
function openUserGuide() {
  if (guideWin && !guideWin.isDestroyed()) { guideWin.focus(); return; }
  guideWin = guideWindow(true);
  guideWin.on('closed', () => { guideWin = null; });
  guideWin.loadFile(USER_GUIDE);
}
function closeSplash() { if (splash) { splash.close(); splash = null; } }
// בזמן העלייה (עד שהחלון הראשי נוצר) סגירת כל החלונות אינה יציאה: מסך הפתיחה נסגר לפני חלון קוד השחזור
// ולפני הודעות ההתאוששות, ו-window-all-closed סגר את התוכנה לפניהם (בדיקת קוד 23.10.2026, ממצא 2)
let booting = true;
// חלונות העלייה שהמשתמש צריך לראות: חלון קוד השחזור, וחלונות ההודעה (bootDialog) שפתוחים כרגע
let bootWindow = null;
let bootPrompts = 0;
// חלון הודעה בזמן העלייה: מסך הפתיחה נסגר לפניו (אחרת ההודעה מוסתרת מאחוריו)
async function bootDialog(opts) {
  closeSplash();
  bootPrompts++;
  try { return await dialog.showMessageBox(opts); } finally { bootPrompts--; }
}
// הפעלה נוספת לפני שהחלון הראשי קיים (עלייה ארוכה — למשל המרת המסד להצפנה): חלון קוד השחזור לחזית; אם אין שום
// חלון גלוי (מסך הפתיחה נסגר אחרי MAX_MS) — מסך הפתיחה מוצג שוב, כדי שלא ייראה שהתוכנה לא נפתחה (בדיקת קוד, ממצא 2)
function onSecondInstance() {
  const front = (w) => { if (w.isMinimized()) w.restore(); w.focus(); };
  if (win) { front(win); return; }
  if (!booting || smoke) return;
  if (bootWindow && !bootWindow.isDestroyed()) { front(bootWindow); return; }
  if (!bootPrompts && !(splash && splash.isOpen())) openSplash();
}
// תקלה בלתי צפויה בעלייה, לפני שהחלון הראשי נוצר: הודעה ויציאה — אחרת התהליך נשאר פתוח בלי חלון
function bootFailed(err) {
  logger.error('boot', err);
  // בדיקת עלייה: השגיאה נרשמת ב-smoke.json (ויציאה 1), במקום יציאה בלי דוח
  if (smoke) { smoke.add('boot', (err && err.stack) || String(err)); smoke.finish('boot-failed'); return; }
  if (!booting) return;
  closeSplash();
  booting = false;
  try { dialog.showErrorBox('שגיאה בהפעלת התוכנה', 'התוכנה לא הצליחה לעלות. נסו להפעיל אותה שוב; אם התקלה חוזרת — פנו לתמיכה.\n\nנתיב: ' + app.getPath('userData')); }
  finally { app.quit(); }
}

function createWindow() {
  const st = loadState();
  zoom = Number(loadJson(uiFile()).zoom) || 1;
  // מיקום שמור — רק אם הוא עדיין על אחד המסכים המחוברים (סקירת קוד 2.11.2026)
  let displays = null;
  try { displays = require('electron').screen.getAllDisplays(); } catch { /* לפני ready / סביבת בדיקה */ }
  const pos = Layout.restorePosition(st, displays);
  win = new BrowserWindow({
    width: st.width || 1500, height: st.height || 940, x: pos.x, y: pos.y, minWidth: 1100, minHeight: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0f1a30', title: 'SuperSuite', autoHideMenuBar: true,
    webPreferences: CodeGuard.guardPrefs({ preload: path.join(__dirname, 'shell', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }, app.isPackaged)
  });
  win.removeMenu();
  CodeGuard.wireDevToolsGuard(win.webContents, app.isPackaged);
  if (smoke) smoke.watch('shell', win.webContents);
  if (st.max) win.maximize();
  win.on('close', saveState);
  win.on('resize', layout);
  win.on('maximize', layout); win.on('unmaximize', layout); win.on('enter-full-screen', layout); win.on('leave-full-screen', layout);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input, win.webContents)) e.preventDefault(); });
  wireAppCommand(win);
  crash.wireContents('shell', win.webContents, () => { if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'shell', 'shell.html')); });
  win.webContents.once('did-finish-load', closeSplash);
  win.webContents.once('did-fail-load', closeSplash);
  win.loadFile(path.join(__dirname, 'shell', 'shell.html'));
  // לא נכנסים לשום מודול אוטומטית: המשתמש בוחר מהמסך הראשי.
  // (קודם נכנסנו ל-'econ' מיד עם העלייה, וזה נעל את המשתמש בלי אפשרות לצאת.)
  win.on('closed', () => { win = null; });
}

/* ---------- גיבוי ושחזור ---------- */
// ממתין לטעינת תצוגה. גם כשל טעינה משחרר — אחרת גיבוי/שחזור נתקעים לנצח על מודול שלא נטען
function waitLoaded(wc) {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise(r => { wc.once('did-finish-load', r); wc.once('did-fail-load', r); });
}
// scope: 'all' או שם מודול בודד ('econ' | 'shamai' | 'tools')
// כשל בקריאת הכספים = כשל של הגיבוי כולו (code: 'econ-read-failed'): קודם נכתב גיבוי בלי הכספים, הסטטוס
// הראה "הצליח", והסבב האוטומטי מחק בגללו את הגיבוי התקין הישן ביותר. עכשיו לא נכתב דבר ולא נמחק דבר
// כך גם כשל בקריאת מודול (code: 'module-read-failed') — קודם נשמר {} בשקט, והגיבוי נראה שלם בלי נתוני המודול.
// וכך גם תיבת ההודעות (chat) — חלק מהגיבוי המלא
const BACKUP_PART_NAMES = { ...MODULE_NAMES, chat: 'תיבת ההודעות' };
function moduleReadError(id, cause, locked = false) {
  logger.error('backup-module-read', cause);
  const name = BACKUP_PART_NAMES[id] || id;
  const err = new Error(locked
    ? `הנתונים המוצפנים של ${name} לא נפתחו (קובץ פגום או מפתח שאינו מתאים), ולכן הגיבוי לא נשמר — כדי שהגיבויים הקודמים, שבהם הנתונים קיימים, לא יימחקו. שמרו דוח תקלה (F1) ופנו לתמיכה.`
    : `לא ניתן היה לקרוא את נתוני ${name}, ולכן הגיבוי לא נשמר. נסו שוב בעוד רגע; אם התקלה חוזרת — שמרו דוח תקלה (F1) ופנו לתמיכה.`);
  err.code = 'module-read-failed';
  return err;
}
const LS_DUMP = 'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))';
// עולם JavaScript מבודד משלנו בעמוד המודול: בו localStorage הוא האחסון האמיתי של הדפדפן
// (secure-ls-preload.js מחליף אותו רק בעולם של העמוד). 999 הוא העולם של ה-preload — לא נוגעים בו
const LEGACY_LS_WORLD = 1099;
// כל הנתונים של מודול, לגיבוי ולמצב שלפני שחזור. כשל נזרק — לעולם לא {} במקום הנתונים
async function readModuleItems(id) {
  if (SecureStore.MODULES.includes(id)) {
    const s = secureStore(id);
    // מחסן נעול (קובץ שלא נפתח): העמוד מקבל אחסון ריק, והגיבוי היה נשמר עם {} ומוחק בסבב את הגיבויים הטובים
    if (s.state === 'locked') throw Object.assign(new Error('המחסן של המודול נעול'), { locked: true });
    // מחסן מוצפן: קוראים ממנו ישירות — בלי לפתוח את המודול (שבלי כניסה מקבל אחסון ריק)
    if (s.state === 'encrypted') {
      if (s.migrated) return s.snapshot();
      // אחרי שדרוג, עד שהמודול נפתח בכניסה, הנתונים הישנים עדיין ב-localStorage הגלוי ולא במחסן. גיבוי
      // בלעדיהם הוא גיבוי חלקי, והסבב היה מוחק בגללו גיבויים מלאים (בדיקת קוד 23.10.2026, ממצא 36)
      const v = ensureView(id);
      await waitLoaded(v.webContents);
      const legacy = JSON.parse(await v.webContents.executeJavaScriptInIsolatedWorld(LEGACY_LS_WORLD, [{ code: LS_DUMP }]));
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('הנתונים הישנים של המודול לא נקראו');
      // כמו בהעברה (secure-store migrate): מה שכבר במחסן גובר. המחסן נקרא אחרי ההמתנה — אם ההעברה קרתה בינתיים
      return { ...legacy, ...s.snapshot() };
    }
    // plain (אין הצפנת Windows): בעולם של העמוד localStorage הוא עותק של ה-preload (ובלי כניסה — ריק);
    // הנתונים עצמם ב-localStorage של הדפדפן — נקראים מהעולם המבודד שלנו
    if (s.state === 'plain') {
      const v = ensureView(id);
      await waitLoaded(v.webContents);
      return JSON.parse(await v.webContents.executeJavaScriptInIsolatedWorld(LEGACY_LS_WORLD, [{ code: LS_DUMP }]));
    }
  }
  const v = ensureView(id);
  await waitLoaded(v.webContents);
  return JSON.parse(await v.webContents.executeJavaScript(LS_DUMP));
}
async function collectBackup(scope = 'all') {
  const out = { suite: 'SuperSuite', version: 2, scope, createdAt: new Date().toISOString(), econ: null, localStorage: {} };
  // סימוני הרישוי (תחילת הניסיון, "הותקן רישיון") בכל גיבוי — שחזור להתקנה נקייה לא מתחיל ניסיון חדש (ipc.js, ממצא 29)
  if (econ.licenseMarks) out.licenseMarks = econ.licenseMarks();
  if (scope === 'all' || scope === 'econ') {
    try {
      out.econ = await econ.getDb().backup();
      // משתמשים, תפקידים, קישורי Google ויומן הפעולות — בגיבוי המלא בלבד (סקירת קוד 2.11.2026): התאוששות ממסד פגום
      // ומעבר מחשב לא מאבדים אותם. השחזור ממזג (ipc.js → usersRestore)
      if (scope === 'all' && typeof econ.usersBackup === 'function') out.users = await econ.usersBackup();
    }
    catch (e) {
      logger.error('backup-econ-read', e);
      const err = new Error('לא ניתן היה לקרוא את הנתונים הכספיים, ולכן הגיבוי לא נשמר. נסו שוב בעוד רגע; אם התקלה חוזרת — שמרו דוח תקלה (F1) ופנו לתמיכה.');
      err.code = 'econ-read-failed';
      throw err;
    }
  }
  for (const id of LS_MODS) {
    if (scope !== 'all' && scope !== id) continue;
    try { out.localStorage[id] = await readModuleItems(id); }
    catch (e) { throw moduleReadError(id, e, !!e.locked); }
  }
  // תיבת ההודעות של המערכת (החלטת הבעלים) — בגיבוי המלא: הודעות, תוויות, הערות פנימיות והגדרות העסק; תוכן הקבצים
  // המצורפים עד Chat.BACKUP_ATTACHMENT_CHARS (מעבר לזה — רק פרטי הקובץ). נקראת מהזיכרון אחרי כתיבת מה שממתין.
  // תיבה שלא נקראה (קובץ תפוס) = כשל של הגיבוי כולו, כמו מודול. תיבת מנהל-העל — לא בגיבוי (ipc.js → chatBackup)
  if (scope === 'all' && typeof econ.chatBackup === 'function') {
    try { out.chat = econ.chatBackup({ attachmentChars: Chat.BACKUP_ATTACHMENT_CHARS }); }
    catch (e) { throw moduleReadError('chat', e); }
  }
  // ensureView יוצר תצוגות מוסתרות ואינו משנה את המודול הפעיל — אין צורך להחזיר פוקוס,
  // אחרת הגיבוי האוטומטי גונב את הפוקוס מהמשתמש כל 6 שעות
  return out;
}

// מפתח גיבוי אוטומטי לכל התקנה: נשמר מוצפן על ידי מערכת ההפעלה (Windows DPAPI), כך שהגיבוי קריא רק לחשבון הזה
const autoBackupKeyFile = () => path.join(app.getPath('userData'), 'autobackup.key');
// מפתח ששוחזר מקוד השחזור בעלייה ולא נשמר בקובץ (db-key.js): בשימוש עד סוף ההפעלה — אחרת autoBackupKey(true)
// היה יוצר מפתח אחר בשקט, והגיבויים וקוד השחזור (🔑) לא היו של המסד
let sessionBackupKey = null;
function autoBackupKey(create = true) {
  if (sessionBackupKey) return sessionBackupKey;
  return AutoBk.loadAutoBackupKey({ file: autoBackupKeyFile(), safeStorage, create });
}

/* ---------- הצפנת מסד הנתונים (PLAN.md 3.1) ----------
   המפתח נגזר ממפתח הגיבוי האוטומטי (DPAPI) — קוד השחזור (🔑) פותח גם את המסד.
   מפתח שאבד: חלון קטן מבקש את קוד השחזור. לעולם לא נוצר מפתח חדש מעל נתונים מוצפנים. */
let dbAtRest = { status: 'plain' };
const AT_REST_WARNINGS = {
  'pending-backup': '⚠ הנתונים עוד לא הוצפנו: הגיבוי שלפני ההצפנה נכשל (ננסה שוב בהפעלה הבאה)',
  'plain-no-dpapi': '⚠ הנתונים במחשב הזה אינם מוצפנים: הצפנת Windows אינה זמינה בחשבון',
  'plain-key-unreadable': '⚠ הנתונים אינם מוצפנים: מפתח הגיבוי האוטומטי אינו קריא בחשבון הזה',
  'vacuum-pending': '⚠ הנתונים הוצפנו, אבל ניקוי העותקים הישנים מהקובץ לא הושלם (ייתכן שהכונן מלא) — ננסה שוב בהפעלה הבאה'
};
function dbAtRestOptions() {
  return {
    resolveCipher: async ({ hasSealedData, verify }) => {
      const r = await DbKey.resolveDbKey({ fs, file: autoBackupKeyFile(), safeStorage, hasSealedData, verify, promptRecoveryCode,
        onError: (scope, e) => logger.error(scope, e) });
      const { unsavedBackupKey, ...rest } = r;
      if (unsavedBackupKey) sessionBackupKey = unsavedBackupKey;
      dbAtRest = rest;
      if (dbAtRest.status === 'plain-no-dpapi' || dbAtRest.status === 'plain-key-unreadable') logger.error('db-at-rest', new Error(dbAtRest.status));
      return dbAtRest;
    },
    // גיבוי מוצפן של כל הנתונים לפני ההמרה. בלי גיבוי תקין — ההמרה לא מתחילה
    beforeEncrypt: async (db) => {
      const dir = loadJson(backupSettingsFile()).targetDir || defaultBackupDir();
      fs.mkdirSync(dir, { recursive: true });
      const out = { suite: 'SuperSuite', version: 2, scope: 'econ', createdAt: new Date().toISOString(), econ: await db.backup(), localStorage: {} };
      const file = path.join(dir, `before-encryption-${AutoBk.localDay()}-${Date.now()}.ssbk`);
      fs.writeFileSync(file + '.tmp', BK.encryptBackup(JSON.stringify(out), autoBackupKey(false)), 'utf8');
      fs.renameSync(file + '.tmp', file);
      // וידוא: הקובץ שנכתב נפתח במפתח, לפני שנוגעים במסד
      JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), autoBackupKey(false)));
      dbAtRest.backupFile = file;
    }
  };
}

// חלון קוד השחזור — לפני שהחלון הראשי קיים. מחזיר את הקוד, או null אם המשתמש ביטל
function promptRecoveryCode({ message }) {
  closeSplash();
  return new Promise((resolve) => {
    const w = new BrowserWindow({ width: 520, height: 420, resizable: false, title: 'SuperSuite — קוד שחזור', autoHideMenuBar: true,
      webPreferences: CodeGuard.guardPrefs({ preload: path.join(__dirname, 'shell', 'recovery-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }, app.isPackaged) });
    let done = false;
    bootWindow = w; // הפעלה נוספת בזמן שהחלון פתוח — מביאה אותו לחזית
    const finish = (v) => { if (done) return; done = true; if (bootWindow === w) bootWindow = null; ipcMain.removeHandler('recovery:submit'); ipcMain.removeHandler('recovery:info'); if (!w.isDestroyed()) w.close(); resolve(v); };
    ipcMain.handle('recovery:info', (e) => (e.sender.id === w.webContents.id ? { message: message || '' } : null));
    ipcMain.handle('recovery:submit', (e, code) => { if (e.sender.id === w.webContents.id) finish(typeof code === 'string' ? code.slice(0, 200) : null); });
    w.on('closed', () => finish(null));
    w.loadFile(path.join(__dirname, 'shell', 'recovery.html'));
  });
}

/* ---------- מחסן מוצפן לשמאות (PLAN.md 3.2) ----------
   shell/secure-ls-preload.js מחליף את localStorage בעמוד; כאן — הקריאה, הכתיבה והעברת הנתונים הישנים.
   כל בקשה נבדקת מול התצוגה של אותו מודול: מודול אחד לא קורא ולא כותב נתונים של אחר. */
const secureStores = {};
function secureStore(mod) {
  if (!secureStores[mod]) {
    secureStores[mod] = SecureStore.createSecureStore({ fs, dir: app.getPath('userData'), mod,
      getBackupKey: (create) => autoBackupKey(create), onError: (scope, e) => logger.error(scope, e) });
  }
  return secureStores[mod];
}
const fromView = (e, mod) => !!(views[mod] && !views[mod].webContents.isDestroyed() && e.sender.id === views[mod].webContents.id);
const fromModuleView = (e, mod) => SecureStore.MODULES.includes(mod) && fromView(e, mod);

/* עוזר ה-AI: „מה הערכת השווי האחרונה?” — התיק האחרון שננעל בשמאות (shell/ai/module-context.js).
   קריאה בלבד, רק מתצוגת המודול הכלכלי (ערוץ ai:run, ב-handle()), רק ברישיון לשמאות ורק ממחסן מוצפן */
function shamaiDataForEcon(senderId) {
  if (!fromView({ sender: { id: senderId } }, 'econ')) throw new Error('נתוני השמאות זמינים רק מתוך המערכת הכלכלית');
  if (!LG.moduleAllowed(licenseNow(), 'shamai')) throw new Error('מודול השמאות אינו כלול ברישיון');
  const s = secureStore('shamai');
  if (s.state !== 'encrypted') throw new Error('נתוני השמאות אינם זמינים (המחסן המוצפן של המודול לא נפתח)');
  // בלי התמונות (קבצים נפרדים) — ההקשר צריך רק את התיקים
  return s.dataSnapshot();
}
/* ---------- הגדרות תצוגה (PLAN.md 7.4) ----------
   נשמרות ב-ui-settings.json → display. shell/display-preload.js מציב אותן כמאפייני data-ss-* בכל מסך,
   והעיצוב — ב-design-tokens.css. גם ערכת המערכת (פסי גלילה, שדות תאריך) עוברת לכהה דרך nativeTheme */
function displaySettings() { return Display.sanitize(loadJson(uiFile()).display); }
function displayAttrs() { return Display.attrsFor(displaySettings(), !!(nativeTheme && nativeTheme.shouldUseDarkColors)); }
function applyNativeTheme() { if (nativeTheme) nativeTheme.themeSource = displaySettings().theme; }
function broadcastDisplay() {
  const attrs = displayAttrs();
  const all = [win && !win.isDestroyed() ? win.webContents : null, ...Object.values(views).map(v => v.webContents)];
  for (const wc of all) if (wc && !wc.isDestroyed()) wc.send('display:changed', attrs);
}
function saveDisplay(input) {
  const ui = loadJson(uiFile());
  saveJson(uiFile(), { ...ui, display: Display.sanitize(input) });
  applyNativeTheme();
  broadcastDisplay();
  return displaySettings();
}
function wireDisplay() {
  session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'shell', 'display-preload.js') });
  applyNativeTheme();
  if (nativeTheme) nativeTheme.on('updated', () => { if (displaySettings().theme === 'system') broadcastDisplay(); });
  // קריאה בלבד — כל מסך שלנו מקבל את המאפיינים
  ipcMain.on('display:get', (e) => { e.returnValue = displayAttrs(); });
  ipcMain.handle('shell:get-display', (e) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return null;
    return displaySettings();
  });
  ipcMain.handle('shell:save-display', (e, input) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return null;
    return saveDisplay(input);
  });
  // כפתור הערכה במודול (שמאות) — רק בהיר/כהה, ורק מהמעטפת או מתצוגת מודול
  ipcMain.handle('display:set-theme', (e, theme) => {
    const fromShell = win && !win.isDestroyed() && e.sender.id === win.webContents.id;
    const fromModule = Object.values(views).some(v => v.webContents.id === e.sender.id);
    if ((!fromShell && !fromModule) || !['light', 'dark'].includes(theme)) return null;
    return saveDisplay({ ...displaySettings(), theme });
  });
}
function wireSecureStore() {
  session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'shell', 'secure-ls-preload.js') });
  ipcMain.on('secure-store:load', (e, mod) => {
    if (!fromModuleView(e, mod)) { e.returnValue = null; return; }
    const s = secureStore(mod);
    // בלי כניסה (PLAN.md 3.3): העמוד מקבל אחסון ריק לקריאה בלבד — נטען מחדש עם הנתונים אחרי הכניסה.
    // גם במצב plain (אין הצפנת Windows): ה-preload מחליף שם את localStorage באותו אופן
    if (s.state !== 'locked' && !econSessionAlive()) { e.returnValue = { state: 'no-session', migrated: true, data: {} }; return; }
    // התמונות (קבצים נפרדים, סקירת קוד 2.11.2026) — רק הרשימה; העמוד מבקש כל תמונה כשהוא קורא אותה (secure-store:get)
    if (s.state === 'plain') { e.returnValue = { state: s.state, migrated: s.migrated, data: {} }; return; }
    e.returnValue = { state: s.state, migrated: s.migrated, data: s.dataSnapshot(), blobKeys: s.blobKeys(), blobPrefixes: SecureStore.blobPrefixes(mod) };
  });
  // תמונה אחת לפי דרישה — באותם תנאים כמו הטעינה: רק מתצוגת המודול ורק בכניסה פעילה. null — אין
  ipcMain.on('secure-store:get', (e, mod, k) => {
    if (!fromModuleView(e, mod) || !econSessionAlive()) { e.returnValue = null; return; }
    try { e.returnValue = secureStore(mod).get(String(k)); }
    catch (err) { logger.error('secure-store', err); e.returnValue = null; }
  });
  // גיבוי מוצפן של הנתונים הישנים לפני ההעברה. בלי גיבוי — אין העברה
  ipcMain.on('secure-store:migrate', (e, mod, items) => {
    if (!fromModuleView(e, mod) || !econSessionAlive()) { e.returnValue = { ok: false }; return; }
    e.returnValue = secureStore(mod).migrate(items, (plain) => {
      const dir = loadJson(backupSettingsFile()).targetDir || defaultBackupDir();
      fs.mkdirSync(dir, { recursive: true });
      const out = { suite: 'SuperSuite', version: 2, scope: mod, createdAt: new Date().toISOString(), econ: null, localStorage: { [mod]: plain } };
      const file = path.join(dir, `before-encryption-${mod}-${AutoBk.localDay()}-${Date.now()}.ssbk`);
      fs.writeFileSync(file + '.tmp', BK.encryptBackup(JSON.stringify(out), autoBackupKey(false)), 'utf8');
      fs.renameSync(file + '.tmp', file);
      JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), autoBackupKey(false)));
    });
  });
  // כל כתיבה מקבלת תשובה (sendSync): דחייה נזרקת בעמוד ולא נבלעת בשקט (ממצא 3)
  ipcMain.on('secure-store:write', (e, mod, op, k, v) => {
    if (!fromModuleView(e, mod)) { e.returnValue = SecureStore.rejectWrite('sender'); return; }
    try { e.returnValue = secureWriteBlock(mod) || secureStore(mod).write(op, k, v); }
    catch (err) { logger.error('secure-store', err); e.returnValue = SecureStore.rejectWrite('error'); }
  });
  // בלי הצפנת Windows (plain), או לפני שהנתונים הישנים הועברו: ה-preload כותב ל-localStorage של הדפדפן בעצמו —
  // אבל רק אחרי אישור מכאן, באותם תנאים כמו כתיבה למחסן (כניסה, data.edit, רישיון; ממצא 24)
  ipcMain.on('secure-store:can-write', (e, mod) => {
    if (!fromModuleView(e, mod)) { e.returnValue = SecureStore.rejectWrite('sender'); return; }
    try {
      const s = secureStore(mod);
      const browserStorage = s.state === 'plain' || (s.state === 'encrypted' && !s.migrated);
      e.returnValue = !browserStorage ? SecureStore.rejectWrite('unavailable') : (secureWriteBlock(mod) || { ok: true });
    } catch (err) { logger.error('secure-store', err); e.returnValue = SecureStore.rejectWrite('error'); }
  });
}
// מי רשאי לשנות נתונים בשמאי (ממצא 24): כניסה פעילה עם data.edit — צופה ורואה חשבון קוראים בלבד —
// ורישיון שמאפשר עבודה (סוף תקופת ניסיון / ממתין לתשלום — קריאה בלבד, כמו במודול הכלכלי).
// בדיקה שקטה: כתיבה אינה "פעילות" (שמירה אוטומטית לא תמנע ניתוק). null = מותר, אחרת תשובת דחייה לעמוד
function secureWriteBlock(mod) {
  if (!econSessionAlive()) return SecureStore.rejectWrite('no-session', 'השינוי לא נשמר: הכניסה למערכת פגה — יש להיכנס שוב');
  if (!(econ.sessionCan && econ.sessionCan(econSenderId(), 'data.edit'))) return SecureStore.rejectWrite('forbidden', 'השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד');
  const lic = licenseNow();
  if (lic && lic.mode !== 'unlicensed') {
    if (!LG.moduleAllowed(lic, mod)) return SecureStore.rejectWrite('license', 'השינוי לא נשמר: המודול אינו כלול ברישיון');
    if (lic.status !== 'active') return SecureStore.rejectWrite('license', 'השינוי לא נשמר: ' + LG.statusMessage(lic));
  }
  return null;
}

/* ---------- מסד נתונים פגום או נעול בעלייה (PLAN.md 2.3) ----------
   נעול ← "נסו שוב". פגום ← שחזור מהגיבוי האוטומטי האחרון למסד חדש; הפגום מועבר הצידה, לא נמחק.
   מחזיר true אם המערכת הכלכלית עלתה, false ליציאה. */
const econInitOptions = () => ({
  isRestTime: syncPaused,
  dbOptions: dbAtRestOptions(),
  shamaiData: shamaiDataForEcon,
  // עוזר ה-AI: מפתח הגיבוי להצפנת ההעדפות (קריאה לא יוצרת מפתח), ופתיחת מודול — לפי הרישיון של ההתקנה
  aiOptions: () => ({ getBackupKey: (create) => autoBackupKey(create) }),
  moduleLicensed: (mod) => LG.moduleAllowed(licenseNow(), mod),
  // הצפנת תיבות ההודעות בדיסק (messages.bin, ממצא 26) — במפתח שנגזר ממפתח הגיבוי האוטומטי
  getBackupKey: (create) => autoBackupKey(create),
  // מסד עם נתונים ובלי משתמשים (שוחזר מגיבוי ישן אחרי תקלה): יצירת מנהל רק עם קוד השחזור (🔑) של המחשב
  // (ipc.js → auth:setup, סקירת קוד 2.11.2026). בלי מפתח גיבוי אין קוד — ואין דרישה
  recoveryCode: {
    available: () => { try { return !!autoBackupKey(false); } catch { return false; } },
    verify: (code) => { try { return AutoBk.keyFromRecoveryCode(code) === autoBackupKey(false); } catch { return false; } },
  },
  // פניות לרשת (שרת הרישוי, עדכונים, מפתחות Google) — דרך הרשת של Chromium, שסומכת על התעודות של Windows.
  // fetch של Node לא מכיר אותן, ו-NetFree מציג תעודה משלו — כל חיבור נדחה במחשב מסונן (25.10.2026).
  // האבטחה לא תלויה ב-TLS: תשובות השרת חתומות ונבדקות בתוכנה (checkin.js)
  fetchImpl: (url, opts) => net.fetch(url, opts),
});
const openAutoBackup = (file) => JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), autoBackupKey(false)));
async function recoverDatabase(firstErr) {
  let err = firstErr;
  for (let round = 0; round < 20; round++) {
    const kind = DbRecovery.classifyDbError(err);
    logger.error('db-open', err);
    const backupDir = loadJson(backupSettingsFile()).targetDir || defaultBackupDir();
    // הגיבוי החדש ביותר שבאמת מכיל את הכספים: גיבויים מלפני תיקון collectBackup עשויים להיות בלעדיהם
    const backup = kind === 'corrupt' ? DbRecovery.latestUsableAutoBackup(backupDir, openAutoBackup) : null;
    const d = DbRecovery.dialogFor(kind, backup);
    const r = await bootDialog({ type: 'error', buttons: d.buttons.map(b => b.label), defaultId: 0, cancelId: d.buttons.length - 1,
      noLink: true, message: d.message, detail: d.detail });
    const choice = (d.buttons[r.response] || {}).id || 'quit';
    if (choice === 'quit') return false;
    if (choice === 'folder') { shell.openPath(app.getPath('userData')); continue; }
    if (choice === 'report') { await crash.saveReport(); continue; }
    let aside = null;
    try {
      if (choice === 'restore') {
        // פענוח לפני שנוגעים במסד: גיבוי שלא נפתח — המסד הפגום נשאר במקומו
        const data = backup.data || openAutoBackup(backup.file);
        if (!data || data.suite !== 'SuperSuite' || !data.econ) throw new Error('קובץ הגיבוי האוטומטי אינו מכיל נתונים כלכליים');
        aside = DbRecovery.setAsideDamaged(app.getPath('userData'));
        logger.error('db-open', new Error('damaged database set aside: ' + path.basename(aside)));
        await econ.initEcon(app.getPath('userData'), econInitOptions());
        await econ.getDb().restore(data.econ);
        // המשתמשים, התפקידים ויומן הפעולות מהגיבוי (סקירת קוד 2.11.2026) — אחרת המסד החדש בלי משתמשים, והראשון
        // שמגיע למסך נעשה מנהל. גיבוי ישן בלעדיהם — יצירת מנהל רק עם קוד השחזור (ipc.js → auth:setup)
        try { if (econ.usersRestore) await econ.usersRestore(econ.usersFromBackup(data.users)); } catch (e) { logger.error('restore-users', e); }
        try { if (!(await econ.getDb().hasUsers())) await econ.getDb().markSetupNeedsRecoveryCode(); } catch (e) { logger.error('restore-users', e); }
        // המסד החדש בלי סימוני הרישוי — מהגיבוי (רק מחמיר: ניסיון ממשיך מהתאריך המקורי)
        try { if (econ.mergeLicenseMarks) econ.mergeLicenseMarks(data.licenseMarks); } catch (e) { logger.error('restore-license-marks', e); }
        await bootDialog({ type: 'info', message: 'הנתונים שוחזרו מהגיבוי האוטומטי', detail: `גיבוי מתאריך ${backup.day}. הקובץ הפגום נשמר בצד בתיקיית הנתונים.` });
        return true;
      }
      await econ.initEcon(app.getPath('userData'), econInitOptions()); // נסו שוב
      return true;
    } catch (e) {
      // שחזור שנכשל באמצע: המסד החלקי נסגר ומועבר הצידה, והפגום חוזר למקומו — ניסיון חוזר וההפעלה הבאה מציעים
      // שוב שחזור, במקום מסד ריק בלי הצעה (סקירת קוד 2.11.2026)
      if (aside) {
        try { const cur = econ.getDb(); if (cur && cur.db) cur.db.close(); } catch { /* כבר סגור */ }
        try { DbRecovery.undoSetAside(app.getPath('userData'), aside); } catch (u) { logger.error('db-restore-undo', u); }
      }
      if (DbRecovery.classifyDbError(e)) { err = e; continue; }
      logger.error('db-restore', e);
      dialog.showErrorBox('השחזור לא הצליח', String(e.message || e) + '\n\nאפשר לנסות שוב, או לשמור דוח תקלה ולפנות לתמיכה.');
    }
  }
  return false;
}

/* גיבוי אוטומטי יומי — מוצפן בלבד. יעד: כונן חיצוני (USB) שהוגדר, ואם לא הוגדר — Documents\SuperSuite-Backups.
   אם הכונן לא מחובר — מדלגים (לא כותבים למקום אחר בשקט). הסטטוס נשמר ומוצג במעטפת. */
// גיבוי ושחזור לא רצים יחד: גיבוי אוטומטי באמצע שחזור שמר תערובת של נתונים ישנים וחדשים כגיבוי היום,
// והסבב מחק גיבוי טוב ישן (בדיקת קוד 23.10.2026)
let backupBusy = null; // 'backup' | 'restore' | null
async function autoBackup() {
  if (backupBusy) return { ok: false, reason: 'busy', at: new Date().toISOString() };
  backupBusy = 'backup';
  try { return await autoBackupRun(); } finally { backupBusy = null; }
}
async function autoBackupRun() {
  let status;
  // בשבת וביום טוב התוכנה לא מבצעת פעולות אוטומטיות; הגיבוי יתבצע בסבב הבא אחרי הצאת
  const cal = calendarSettings();
  if (cal.shabbatMode && Hebcal.shabbatStatus(Date.now(), cal).active) return { ok: false, reason: 'shabbat', at: new Date().toISOString() };
  try {
    status = await AutoBk.runAutoBackup({
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      customTarget: loadJson(backupSettingsFile()).targetDir || '',
      defaultTarget: defaultBackupDir(),
      collect: () => collectBackup('all'),
      getKey: () => autoBackupKey(true),
      write: AB.writeEncryptedAutoBackup
    });
  } catch (e) {
    logger.error('auto-backup', e);
    status = { ok: false, reason: e.code || 'error', at: new Date().toISOString() };
  }
  if (!status.ok) console.warn('auto-backup skipped:', status.reason, status.target || '');
  // גיבויים ישנים לא מוצפנים בתיקייה (PLAN.md 3.6) — נספרים כאן, ומוצגים במסך הבית
  let plainBackups = 0;
  try { plainBackups = PlainBk.scan(status.target || backupDir()).length; } catch { /* תיקייה לא זמינה */ }
  saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), lastAutoBackup: status, plainBackups });
  return status;
}

async function backupAll(passphrase, scope = 'all') {
  if (typeof passphrase !== 'string' || passphrase.length < BK.MIN_PASSPHRASE) throw new Error(`סיסמת הגיבוי חייבת להכיל לפחות ${BK.MIN_PASSPHRASE} תווים`);
  // סוג לא מוכר יצר גיבוי ריק (בלי נתונים כספיים ובלי מודולים) שדווח "נשמר" (בדיקת קוד 23.10.2026)
  if (!BACKUP_SCOPES.includes(scope)) throw new Error('סוג הגיבוי אינו מוכר — הגיבוי לא נשמר');
  // גם הגיבוי הידני לא רץ יחד עם שחזור או עם הגיבוי האוטומטי (סקירת קוד 2.11.2026) — רק בזמן איסוף הנתונים,
  // כדי שחלון השמירה הפתוח לא יחסום את הגיבוי האוטומטי
  if (backupBusy) throw new Error(backupBusy === 'restore' ? 'שחזור רץ כרגע — נסו לגבות שוב בעוד דקה' : 'גיבוי אוטומטי רץ כרגע — נסו שוב בעוד דקה');
  backupBusy = 'backup';
  let out;
  try { out = await collectBackup(scope); } finally { backupBusy = null; }
  const stamp = AutoBk.localDay(new Date()); // תאריך מקומי — toISOString (UTC) נתן בין חצות ל-03:00 את התאריך של אתמול
  const r = await dialog.showSaveDialog(win, { title: 'שמירת גיבוי מוצפן', defaultPath: `SuperSuite-${scope}-${stamp}.ssbk`, filters: [{ name: 'גיבוי SuperSuite', extensions: ['ssbk'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  // קובץ זמני, fsync והחלפה: כתיבה ישירה שנכשלה באמצע (דיסק-און-קי מלא או נותק) כבר דרסה את הגיבוי הקודם באותו שם
  const tmp = r.filePath + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, BK.encryptBackup(JSON.stringify(out), passphrase), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, r.filePath);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* הכונן נותק */ }
    throw new Error('שמירת הגיבוי נכשלה, והגיבוי הקודם (אם היה) לא נפגע — ייתכן שהכונן מלא, מוגן מפני כתיבה או נותק (' + (e.code || 'שגיאה') + ')');
  }
  dialog.showMessageBox(win, { type: 'info', message: 'הגיבוי נשמר ומוצפן', detail: r.filePath });
  return { ok: true };
}

function openBackupText(text, passphrase) {
  if (!BK.isEncryptedBackup(text)) return text; // גיבוי ישן (JSON גלוי) — נקרא בלבד, לא נכתב
  // קוד שחזור (גיבוי אוטומטי ממחשב אחר) — מזוהה לפי הצורה; אם לא נפתח בו, ננסה אותו כסיסמה רגילה
  if (passphrase && AutoBk.looksLikeRecoveryCode(passphrase)) {
    let codeError;
    try { return BK.decryptBackup(text, AutoBk.keyFromRecoveryCode(passphrase)); } catch (e) { codeError = e; }
    try { return BK.decryptBackup(text, passphrase); } catch { /* לא סיסמה — מדווחים על הקוד */ }
    throw /קוד השחזור/.test(codeError.message) ? codeError : new Error('קוד השחזור אינו של הגיבוי הזה — ייתכן שהגיבוי נוצר במחשב אחר');
  }
  if (passphrase) return BK.decryptBackup(text, passphrase);
  let key;
  try { key = autoBackupKey(false); }
  catch (e) {
    // אין מפתח מקומי: ייתכן שזה גיבוי ידני (סיסמה) או גיבוי אוטומטי ממחשב אחר — אומרים את שתי האפשרויות
    throw new Error('הקובץ מוצפן. אם זה גיבוי ידני — הזן את סיסמת הגיבוי; אם זה גיבוי אוטומטי ממחשב אחר — הזן את קוד השחזור שלו. ' + e.message);
  }
  try { return BK.decryptBackup(text, key); } catch {
    throw new Error('הקובץ מוצפן בסיסמת גיבוי — הזן אותה כדי לשחזר');
  }
}

// אחרי שחזור מקובץ גלוי: הצפנה (עותק .ssbk לידו, ואז מחיקת המקור), מחיקה, או השארה. בלי הצפנת Windows — רק מחיקה
async function offerPlainFile(file, text) {
  if (!PlainBk.isPlainBackupText(String(text || '').replace(/^﻿/, ''))) return;
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const buttons = canEncrypt ? ['הצפן את הקובץ', 'מחק את הקובץ', 'השאר'] : ['מחק את הקובץ', 'השאר'];
  const c = await dialog.showMessageBox(win, { type: 'warning', buttons, defaultId: 0, cancelId: buttons.length - 1,
    message: 'קובץ הגיבוי ששוחזר אינו מוצפן', detail: path.basename(file) + '\nכל מי שיש לו גישה לקובץ יכול לקרוא את הנתונים. מומלץ להצפין אותו או למחוק אותו.' });
  const action = buttons[c.response];
  try {
    const dir = path.dirname(file), name = path.basename(file);
    if (action === 'הצפן את הקובץ') { const out = PlainBk.encryptFile({ dir, name, key: autoBackupKey(true) }); dialog.showMessageBox(win, { type: 'info', message: 'הקובץ הוצפן: ' + out.file }); }
    else if (action === 'מחק את הקובץ') PlainBk.deleteFile({ dir, name });
    else return;
    logger.warn('plain-backup', (action === 'מחק את הקובץ' ? 'deleted ' : 'encrypted ') + name);
  } catch (e) { dialog.showErrorBox('שגיאה', e.message || 'הפעולה נכשלה'); }
}

// ערכי מודול מקובץ גיבוי (קלט חיצוני): רק מחרוזות בגודל סביר. null — אין מה לשחזר במודול הזה
function restoreItems(data, id) {
  const items = data.localStorage && data.localStorage[id];
  if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
  const clean = {};
  for (const [k, val] of Object.entries(items)) {
    if (typeof k !== 'string' || k.length > 256) continue;
    if (typeof val !== 'string' || val.length > LS_VALUE_MAX) continue;
    clean[k] = val;
  }
  return Object.keys(clean).length ? clean : null;
}
// המצב הנוכחי של מה שעומד להתחלף — אם אי אפשר לקרוא אותו, לא משחזרים. withChat — כל תיבת ההודעות, עם כל הקבצים
async function snapshotFor(withEcon, mods, withChat = false) {
  const out = { econ: null, localStorage: {}, chat: null };
  if (withEcon) out.econ = await econ.getDb().backup();
  for (const id of mods) out.localStorage[id] = await readModuleItems(id);
  if (withChat) out.chat = econ.chatBackup();
  return out;
}
// המחסן המוצפן של מודול לא נכתב לדיסק בזמן שחזור
function storeWriteError(id) {
  return `לא ניתן היה לשמור בדיסק את נתוני ${BACKUP_PART_NAMES[id] || id} — ייתכן שהכונן מלא, או שתוכנה אחרת (למשל אנטי-וירוס) תופסת את הקובץ.`;
}
// כתיבת הנתונים: הכספים, כל מודול, ואז תיבת ההודעות. כל כשל נזרק (גם ערך שהמחסן דחה, מחסן שלא נכתב לדיסק,
// וגם כתיבה של התיבה שנכשלה).
// chat — { data, except } (chat.js → restoreMailbox): data מהגיבוי (אחרי mailboxFromBackup), או המצב שלפני בהחזרה
async function applyRestore(econData, modItems, chat = null) {
  if (econData) await econ.getDb().restore(econData);
  for (const [id, clean] of modItems) {
    // מודול עם מחסן מוצפן: כותבים ישירות למחסן (ולא דרך העמוד), כדי שהטעינה מחדש תראה את הנתונים מיד
    if (SecureStore.MODULES.includes(id) && secureStore(id).state === 'encrypted') {
      const s = secureStore(id);
      // הנתונים הישנים עוד לא הועברו (ההעברה נכשלה — למשל הגיבוי שלפניה, כשכונן הגיבוי לא מחובר): העמוד עובד על
      // ה-localStorage של הדפדפן. השחזור מחליף את כולם — המחסן מסומן "הועבר", ורק אחרי שנכתב לקובץ ה-localStorage הישן
      // נמחק. בלי זה העמוד המשיך להציג את הישן אחרי "השחזור הושלם", וההעברה הבאה ("המחסן גובר") מחקה בשקט עריכות
      // שנעשו אחרי השחזור. ההחזרה למצב שלפני עובדת כרגיל: before מכיל את הישן ואת המחסן יחד (readModuleItems)
      const legacy = !s.migrated;
      // החלפה בזיכרון בבת אחת, ואז כתיבה אחת לקובץ — בקובץ תמיד המצב שלפני או המצב החדש, לא מחסן חלקי
      const r = s.replaceAll(clean);
      if (!r.ok) throw new Error(r.name === 'QuotaExceededError' ? 'הנתונים של המודול גדולים מדי למחסן' : storeWriteError(id));
      // כתיבה שנכשלה (אנטי-וירוס, כונן מלא) נזרקת — וההחזרה למצב שלפני רצה, כמו בכשל של תיבת ההודעות
      if (!(legacy ? s.markMigrated() : s.flush())) throw new Error(storeWriteError(id));
      if (legacy) {
        // המחסן כבר בקובץ ומסומן "הועבר" — הנתונים בטוחים גם אם המחיקה נכשלת (ה-preload לא קורא יותר את הישן)
        try {
          const v = ensureView(id);
          await waitLoaded(v.webContents);
          await v.webContents.executeJavaScriptInIsolatedWorld(LEGACY_LS_WORLD, [{ code: 'localStorage.clear()' }]);
        } catch (e) { logger.error('restore-legacy-clear', e); }
      }
      continue;
    }
    const v = ensureView(id);
    await waitLoaded(v.webContents);
    const code = `(()=>{const d=${JSON.stringify(clean)};localStorage.clear();for(const k in d)localStorage.setItem(k,d[k]);})()`;
    // plain: ישירות ל-localStorage של הדפדפן (העולם המבודד), לא דרך העותק של ה-preload בעמוד — התצוגות נטענות מחדש אחרי השחזור
    if (SecureStore.MODULES.includes(id) && secureStore(id).state === 'plain') await v.webContents.executeJavaScriptInIsolatedWorld(LEGACY_LS_WORLD, [{ code }]);
    else await v.webContents.executeJavaScript(code);
  }
  if (chat && chat.data) {
    try { econ.chatRestore(chat.data, chat.except ? { except: chat.except } : undefined); }
    catch (e) {
      logger.error('restore-chat', e);
      throw new Error('לא ניתן היה לשמור את תיבת ההודעות' + (e && e.code ? ` (${e.code})` : '') + '.');
    }
  }
}

async function restoreAll(passphrase) {
  if (backupBusy) throw new Error('גיבוי רץ כרגע — נסו לשחזר שוב בעוד דקה');
  backupBusy = 'restore';
  try { return await restoreAllRun(passphrase); } finally { backupBusy = null; }
}
async function restoreAllRun(passphrase) {
  const r = await dialog.showOpenDialog(win, { title: 'בחירת קובץ גיבוי', properties: ['openFile'], filters: [{ name: 'גיבוי SuperSuite', extensions: ['ssbk', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let data, text;
  try {
    text = fs.readFileSync(r.filePaths[0], 'utf8');
    data = JSON.parse(openBackupText(text, passphrase));
  } catch (e) {
    dialog.showErrorBox('שגיאה', e.message || 'הקובץ אינו גיבוי תקין');
    return { ok: false };
  }
  if (!data || data.suite !== 'SuperSuite') { dialog.showErrorBox('שגיאה', 'הקובץ אינו גיבוי של SuperSuite'); return { ok: false }; }
  // גיבוי מגרסה שכללה את מודול האימונים (עבר למוצר החינוכי הנפרד): localStorage.trainer לא נקרא ולא נבדק —
  // LS_MODS בלעדיו — ושאר הגיבוי משוחזר כרגיל. ההודעה בחלון האישור אומרת שהחלק הזה לא שוחזר
  const legacyData = Legacy.hasLegacyModuleData(data);
  // תיבת ההודעות (גיבוי מלא מגרסה שכוללת אותה) — נבדקת כאן, לפני האישור ולפני כל מחיקה. גיבוי ישן בלי chat לא נוגע בתיבה
  let chatData = null;
  if (data.chat != null) {
    try { chatData = Chat.mailboxFromBackup(data.chat); }
    catch (e) { dialog.showErrorBox('שגיאה', e.message + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
  }
  // המשתמשים ויומן הפעולות (גיבוי מלא מגרסה שכוללת אותם) — נבדקים לפני האישור. גיבוי ישן בלי users לא נוגע בהם
  let usersData = null;
  if (data.users != null && econ.usersFromBackup) {
    try { usersData = econ.usersFromBackup(data.users); }
    catch (e) { dialog.showErrorBox('שגיאה', e.message + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
  }
  const scopeText = data.scope && data.scope !== 'all' ? `(גיבוי של מודול: ${data.scope})` : '(גיבוי מלא)';
  const mods = LS_MODS.filter(id => restoreItems(data, id));
  // אין מה לשחזר (למשל גיבוי של מודול האימונים בלבד): לא מציגים "השחזור הושלם" כשלא שוחזר דבר
  if (!data.econ && !mods.length && !chatData) {
    dialog.showErrorBox('שגיאה', (legacyData ? Legacy.LEGACY_ONLY : '') + 'אין בקובץ נתונים לשחזור — הנתונים הקיימים לא השתנו');
    return { ok: false };
  }
  // גיבוי ישן מהמסמך האחרון שהופק — אזהרה בחלון האישור (בדיקת קוד 22.10.2026, ממצא 5). קריאה בלבד; כשל — בלי אזהרה
  let missing = '';
  try {
    const items = data.econ ? issuedAfter(data.econ, await econ.getDb().load()) : [];
    for (const id of mods.filter(m => ModCounters.MODULE_COUNTERS[m])) {
      items.push(...ModCounters.moduleIssuedAfter(id, restoreItems(data, id), (await snapshotFor(false, [id])).localStorage[id]));
    }
    missing = ModCounters.issuedAfterText(items);
  } catch (e) { logger.error('restore-missing-docs', e); }
  const chatNote = chatData ? 'תיבת ההודעות תשוחזר מהגיבוי; הודעות שהתקבלו או נשלחו אחרי הגיבוי יישארו בה.\n\n' : '';
  const usersNote = usersData ? UsersBk.restoreNote(usersData) + '\n\n' : '';
  const c = await dialog.showMessageBox(win, { type: 'warning', buttons: ['שחזר', 'ביטול'], defaultId: 1, cancelId: 1, message: 'השחזור יחליף את הנתונים הקיימים ' + scopeText, detail: (missing ? '⚠ ' + missing + '\n\n' : '') + chatNote + usersNote + (legacyData ? Legacy.LEGACY_NOTE + '\n\n' : '') + 'מומלץ לבצע גיבוי לפני כן.' });
  if (c.response !== 0) return { ok: false };
  // מה שהשחזור יחליף נשמר קודם בזיכרון: כשל באמצע (למשל הכספים שוחזרו ומודול אחר נכשל) מחזיר הכול למצב שלפני
  let before;
  try { before = await snapshotFor(!!data.econ, mods, !!chatData); }
  catch (e) { dialog.showErrorBox('שגיאה', 'לא ניתן לשמור את המצב הנוכחי לפני השחזור, ולכן לא שוחזר דבר. ' + (e.message || '')); return { ok: false }; }
  try {
    // מוני המסמכים במודולים (שטרי קנייה, תיקים ודוחות בשמאות) לא חוזרים אחורה — כמו keepCounters בכספים
    await applyRestore(data.econ, mods.map(id => [id, ModCounters.keepModuleCounters(id, restoreItems(data, id), before.localStorage[id])]),
      chatData && { data: chatData });
  } catch (e) {
    let back = '';
    // התיבה חוזרת למצב שלפני, בלי מה שהגיע מהגיבוי — אבל עם הודעה שהתקבלה בינתיים (chat.js → restoreMailbox)
    try { await applyRestore(before.econ, mods.map(id => [id, before.localStorage[id] || {}]), before.chat && { data: before.chat, except: chatData }); back = 'הנתונים הוחזרו למצב שלפני השחזור.'; }
    catch (e2) { logger.error('restore-rollback', e2); back = 'גם ההחזרה למצב הקודם נכשלה — שחזרו מגיבוי אחר, ופנו לתמיכה עם דוח תקלה.'; }
    logger.error('restore', e);
    for (const id of Object.keys(views)) views[id].webContents.reload();
    dialog.showErrorBox('השחזור נכשל', String(e.message || e) + ' ' + back);
    return { ok: false };
  }
  // סימוני הרישוי מהגיבוי — רק מחמירים (ipc.js, ממצא 29)
  try { if (econ.mergeLicenseMarks) econ.mergeLicenseMarks(data.licenseMarks); } catch (e) { logger.error('restore-license-marks', e); }
  // משתמשים ויומן הפעולות — מיזוג בטרנזקציה אחת אחרי שהשאר נשמר; כשל לא מבטל את השחזור, ומדווח
  let usersMsg = '';
  if (usersData) {
    try { usersMsg = UsersBk.resultNote(await econ.usersRestore(usersData)); }
    catch (e) { logger.error('restore-users', e); usersMsg = 'המשתמשים ויומן הפעולות מהגיבוי לא שוחזרו — המשתמשים הקיימים נשארו כמו שהיו.'; }
  }
  for (const id of Object.keys(views)) views[id].webContents.reload();
  dialog.showMessageBox(win, { type: 'info', message: 'השחזור הושלם', ...(usersMsg ? { detail: usersMsg } : {}) });
  // שוחזר מקובץ לא מוצפן (PLAN.md 3.6): מציעים להצפין אותו או למחוק — שהמידע לא יישאר גלוי במחשב
  if (!BK.isEncryptedBackup(text)) await offerPlainFile(r.filePaths[0], text);
  return { ok: true };
}

/* ---------- אבטחה: גיבוי/שחזור מהמעטפת ----------
   הכניסה נשמרת ב-session של מזהה חלון המודול הכלכלי (שם מתבצעת הכניסה).
   לכן הבדיקה נעשית מול session זה ולא מול "יש כניסה כלשהי". הקריאה חייבת לבוא מהמעטפת עצמה. */
function econSenderId() {
  const v = views.econ;
  return v && !v.webContents.isDestroyed() ? v.webContents.id : -1;
}
function shellGuard(event, permission) {
  if (!win || event.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
  econ.assertAccess(econSenderId(), permission);
}

/* תשאול שקט: האם המודול הכלכלי מחובר כרגע?
   המעטפת משתמשת בו כדי לדעת מתי לבקש את יעד הגיבוי — בלי לקרוא לערוץ מוגן
   לפני שהמשתמש התחבר, שאז נדחה ונרשם ללוג כחריגה מיותרת. */
function econLoggedIn() {
  const v = views.econ;
  if (!v || v.webContents.isDestroyed()) return false;
  try { econ.assertAccess(v.webContents.id, 'data.view'); return true; } catch { return false; }
}

/* ---------- מכשירים מחוברים (סנכרון עמית-לעמית, docs/SYNC-DESIGN.md) ----------
   כבוי כברירת מחדל. כל פעולה — מהמעטפת בלבד ולמנהל בלבד (users.manage): צימוד נותן למכשיר אחר
   גישה לכל הנתונים. בשבת וביום טוב (מצב שבת) השירות לא מאזין ולא מתחבר. */
let sync = null;
function syncPaused() {
  const cal = calendarSettings();
  return !!(cal.shabbatMode && Hebcal.shabbatStatus(Date.now(), cal).active);
}
function registerSyncHandlers() {
  sync = SyncService.createSyncService({ dir: app.getPath('userData'), safeStorage, isPaused: syncPaused });
  sync.on('changed', () => { if (win && !win.isDestroyed()) win.webContents.send('shell:sync-changed'); });
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...args) => { shellGuard(e, 'users.manage'); return fn(...args); });
  const str = (v) => (typeof v === 'string' ? v : '');
  // מצב הסנכרון מתבקש ברקע בכל אירוע ברשת (משואה של מכשיר מצומד כל 30 שניות, חיבור, ניתוק), ולכן הבדיקה
  // כאן לא רושמת פעילות. דרך shellGuard (getSession) הפגישה של המנהל לא פקעה לעולם (בדיקת קוד 23.10.2026, ממצא 55)
  ipcMain.handle('sync:status', (e) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    const id = econSenderId();
    if (!econ || !econ.hasSession(id)) throw new Error('נדרשת כניסה למערכת (או שהפגישה פגה לאחר חוסר פעילות)');
    if (!econ.sessionCan(id, 'users.manage')) throw new Error('אין הרשאה לפעולה זו');
    return sync.status();
  });
  h('sync:set-enabled', (on) => sync.setEnabled(on === true));
  h('sync:rename', (name) => sync.rename(str(name)));
  h('sync:set-port', (port) => sync.setPort(Number(port)));
  h('sync:create-invite', (host) => sync.createInvite(str(host)));
  h('sync:cancel-invite', () => sync.cancelInvite());
  h('sync:join', (code, endpoint) => sync.join(str(code), str(endpoint)));
  h('sync:approve', (reqId) => sync.approve(str(reqId)));
  h('sync:reject', (reqId) => sync.reject(str(reqId)));
  h('sync:connect', (peerId, endpoint) => sync.connect(str(peerId), str(endpoint)));
  h('sync:ping', (peerId) => sync.ping(str(peerId)));
  h('sync:revoke', (peerId) => sync.revoke(str(peerId)));
  h('sync:reset-identity', () => sync.resetIdentity());
  // שגיאות של שכבת החיבור (למשל שמירת מצב שנכשלה) — ליומן התקלות, ולא חריגה שמקפיצה חלון קריסה
  sync.on('log', (entry) => { if (entry && entry.level === 'error') logger.error('sync', String(entry.msg || '') + (entry.code ? ' (' + entry.code + ')' : '')); });
  sync.init().catch((err) => logger.error('sync-init', err));
}
// כתיבה לדיסק של מה שעוד ממתין (המחסנים המוצפנים — 300ms אחרונים, וההודעות). גם לפני app.exit בהפעלה מחדש
// אחרי קריסה — שם will-quit לא נורה
function flushPendingWrites() {
  for (const s of Object.values(secureStores)) s.flush();
  if (econ && econ.flushChat) econ.flushChat();
}
app.on('will-quit', () => { if (sync) sync.close().catch(() => {}); flushPendingWrites(); });

/* ---------- הפעלה ---------- */
// גרסת הפצה עם פרמטר דיבוג (--remote-debugging-port, --inspect...) — לא עולה (PLAN.md 3.5)
const debugSwitch = CodeGuard.startupCheck({ argv: process.argv, packaged: app.isPackaged,
  hasSwitch: (s) => app.commandLine && app.commandLine.hasSwitch(s) });
if (debugSwitch) { logger.error('code-guard', new Error('debug switch: ' + debugSwitch)); app.exit(1); }
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', onSecondInstance);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (!smoke) openSplash();
  registerProtocol();
  wireSecureStore();
  wireDisplay();

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission);
    cb(ok && String(details.requestingUrl || '').startsWith('app://'));
  });

  try {
    econ = require('./modules/econ/ipc');
    if (econ.setErrorLogger) econ.setErrorLogger((scope, e) => logger.error(scope, e));
    // בשבת וביום טוב (מצב שבת) — אין תשובות אוטומטיות בהודעות
    try { await econ.initEcon(app.getPath('userData'), econInitOptions()); }
    catch (err) {
      if (!err || err.code !== 'db-key-missing') throw err;
      closeSplash();
      // אין קוד שחזור: בלי האפשרות הזו התוכנה לא עולה, ואי אפשר גם לשחזר מגיבוי בסיסמה
      const c = await bootDialog({ type: 'warning', buttons: ['פתיחה ריקה לשחזור מגיבוי', 'יציאה'], defaultId: 1, cancelId: 1,
        message: 'הנתונים מוצפנים ואין קוד שחזור',
        detail: 'אפשר לפתוח את התוכנה ריקה ולשחזר מגיבוי שנשמר בסיסמה (Ctrl+Shift+R). הקובץ המוצפן לא נמחק — הוא נשמר בצד בתיקיית הנתונים, ואם הקוד יימצא אפשר יהיה להחזיר אותו.' });
      if (c.response !== 0) { app.quit(); return; }
      const aside = require('./modules/econ/core/database').setAsideLockedDatabase(app.getPath('userData'));
      logger.error('db-at-rest', new Error('locked database set aside: ' + path.basename(aside)));
      await econ.initEcon(app.getPath('userData'), econInitOptions());
    }
    // ההמרה נדחתה (הגיבוי שלפניה נכשל) — המצב נקבע במסד עצמו
    const dbNow = econ.getDb && econ.getDb();
    if (dbNow && dbNow.atRestStatus === 'pending-backup') { dbAtRest.status = 'pending-backup'; logger.error('db-at-rest', dbNow.atRestError || new Error('pending-backup')); }
    // הערכים מוצפנים, אבל ה-VACUUM שמנקה את העותקים הגלויים הישנים נכשל (כונן מלא?) — ננסה שוב בעלייה הבאה
    if (dbNow && dbNow.atRestVacuumError) { dbAtRest.vacuumPending = true; logger.error('db-at-rest-vacuum', dbNow.atRestVacuumError); }
  } catch (err) {
    closeSplash();
    // מסד פגום או נעול (PLAN.md 2.3): הודעה בעברית ואפשרויות, במקום שגיאה טכנית וסגירה
    if (!(DbRecovery.classifyDbError(err) && await recoverDatabase(err))) {
      closeSplash(); // ייתכן שהפעלה נוספת הציגה אותו שוב בזמן ההתאוששות
      if (!DbRecovery.classifyDbError(err)) dialog.showErrorBox('שגיאה בפתיחת המערכת הכלכלית', String(err && err.message ? err.message : err) + '\n\nנתיב: ' + app.getPath('userData'));
      app.quit(); return;
    }
  }

  // רישוי: שינוי סטטוס (התקנה, עדכון, סנכרון, או פקיעה עם הזמן — נבדק כל דקה) נאכף מיד
  if (econ.onLicenseChange) econ.onLicenseChange(enforceLicense);
  if (econ.onAuthChange) econ.onAuthChange(onEconAuthChange);
  // ניתוק אוטומטי (חוסר פעילות) קורה בשקט — בודקים מדי פעם אם מודול נעול פתוח בלי כניסה
  const gateTimer = setInterval(() => { reloadLockedViewsOnSessionChange(); if (loginGate.mustLeave(active)) showLoginForLocked(); }, 20 * 1000);
  if (gateTimer.unref) gateTimer.unref();
  const licTimer = setInterval(licenseNow, 60 * 1000);
  if (licTimer.unref) licTimer.unref();
  // הודעות: קבלה אוטומטית כל 3 דקות — רק אם הופעלה בהגדרות העסק (ולא בשבת — נבדק בפנים)
  if (econ.chatAutoFetch) {
    const chatTimer = setInterval(() => { econ.chatAutoFetch().catch(() => {}); }, 3 * 60 * 1000);
    if (chatTimer.unref) chatTimer.unref();
  }
  ipcMain.handle('shell:license-state', (e) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return null;
    return LG.shellState(licenseNow());
  });

  ipcMain.handle('shell:switch', (e, id) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    switchTo(id);
    return true;
  });
  // מודול (למשל לוח הבקרה של econ) מבקש לפתוח מודול אחר. נבדק שהשולח הוא תצוגת מודול קיימת.
  ipcMain.handle('shell:open-module', (e, id) => {
    const moduleViewIds = Object.values(views).map(v => v.webContents.id);
    if (!win || win.isDestroyed() || !canModuleOpen(e.sender.id, moduleViewIds, id, MODS)) return false;
    switchTo(id);
    return true;
  });
  // פתיחת פריט מהקטלוג האחיד: מודול, ובמודול הכלכלי גם תצוגה פנימית מאומתת
  ipcMain.handle('shell:open', (e, id, view) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    if (!MODS.includes(id)) return false;
    if (view != null && !moduleHasView(id, view)) return false;
    switchTo(id);
    if (view) openModuleView(id, view);
    return true;
  });
  // תצוגות חדשות במודול הכלכלי שעוד לא נכנסו לקטלוג — המעטפת מציגה אותן תחת "נוספו לאחרונה"
  ipcMain.handle('shell:catalog-extras', (e) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return [];
    return ECON_EXTRAS.map(x => ({ ...x }));
  });
  // הגדרות לוח עברי (עיר, דקות הדלקה, מצב שבת, חוץ לארץ) — קריאה ושמירה מהמעטפת בלבד
  ipcMain.handle('shell:get-calendar', (e) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return null;
    const { cityObj, ...s } = calendarSettings();
    return s;
  });
  ipcMain.handle('shell:save-calendar', (e, input) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return null;
    const ui = loadJson(uiFile());
    saveJson(uiFile(), { ...ui, calendar: { ...(ui.calendar || {}), ...sanitizeCalendar(input) } });
    const { cityObj, ...s } = calendarSettings();
    return s;
  });
  ipcMain.handle('shell:overlay', (e, on) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    setOverlay(on);
    return true;
  });
  // המודול הכלכלי מדווח על התצוגה הפעילה, כדי שהסרגל האחיד יסמן אותה
  ipcMain.handle('shell:econ-view', (e, view) => {
    const v = views.econ;
    if (!v || v.webContents.isDestroyed() || e.sender.id !== v.webContents.id) return false;
    if (!ECON_VIEWS.includes(view)) return false;
    econView = view;
    if (!LG.viewAllowed(licenseNow(), 'econ', view)) { openEconView('licensing'); return false; }
    if (win && !win.isDestroyed()) win.webContents.send('shell:active-view', view, 'econ');
    if (active === 'econ') recordNav({ mod: 'econ', view });
    return true;
  });
  ipcMain.handle('shell:history-go', (e, delta) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    return navigateHistory(delta === 1 ? 1 : -1);
  });
  ipcMain.handle('shell:home', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; goHome(); return true; });
  ipcMain.handle('shell:quit', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; app.quit(); return true; });
  // אודות (PLAN.md 5.1): גרסה, זכויות יוצרים, הסכם הרישיון ורכיבי צד שלישי — מהקבצים שנארזו עם התוכנה
  ipcMain.handle('shell:get-about', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return null;
    const txt = (rel) => { try { return fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/^﻿/, ''); } catch { return ''; } };
    return { version: app.getVersion(), license: txt('LICENSE.txt'), eula: txt('build/eula.txt'), notices: txt('THIRD-PARTY-NOTICES.txt') };
  });
  // מדריך המשתמש (PLAN.md 1.6): חלון נפרד, בלי סקריפט; ושמירה כ-PDF
  ipcMain.handle('shell:open-user-guide', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    openUserGuide();
    return true;
  });
  ipcMain.handle('shell:save-user-guide-pdf', async (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    const r = await dialog.showSaveDialog(win, { title: 'שמירת מדריך המשתמש', defaultPath: path.join(documentsDir(), 'SuperSuite-מדריך.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return false;
    const w = guideWindow(false);
    try {
      await w.loadFile(USER_GUIDE);
      fs.writeFileSync(r.filePath, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } }));
    } finally { w.destroy(); }
    return true;
  });
  // דוח תקלה לתמיכה — היומן בלבד, בלי נתונים (PLAN.md 2.2)
  ipcMain.handle('shell:save-crash-report', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    return crash.saveReport();
  });
  ipcMain.handle('shell:is-logged-in', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    return econLoggedIn();
  });
  // האם המחובר מנהל — כדי שהמעטפת לא תציע צעדים של מנהל בלבד (יעד גיבוי, קוד שחזור). בדיקה שקטה, בלי לרשום פעילות
  ipcMain.handle('shell:is-admin', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    return !!(econ && econ.sessionCan && econ.sessionCan(econSenderId(), 'users.manage'));
  });
  // data.backup / data.restore — למנהל בלבד (מיגרציה 10 ב-core/database.js; החלטת הבעלים 23.10.2026)
  ipcMain.handle('shell:backup-all', (e, pass, scope) => { shellGuard(e, 'data.backup'); return backupAll(pass, scope || 'all'); });
  ipcMain.handle('shell:restore-all', (e, pass) => { shellGuard(e, 'data.restore'); return restoreAll(pass); });
  // יעד הגיבוי: מחזיר null (ולא שגיאה) כשעדיין אין כניסה, כדי שהמעטפת תדע לחכות ולא לרשום חריגה
  ipcMain.handle('shell:get-backup-target', (e) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econLoggedIn()) return null;
    return loadJson(backupSettingsFile()).targetDir || '';
  });
  // סטטוס הגיבוי האוטומטי האחרון (טקסט למשתמש) — כדי שכשל שקט (אין DPAPI / כונן מנותק) ייראה
  ipcMain.handle('shell:get-backup-status', (e) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econLoggedIn()) return null;
    const s = loadJson(backupSettingsFile());
    const text = AutoBk.describeStatus(s.lastAutoBackup);
    // בלי קוד שחזור רשום, תקלה במחשב = אובדן כל הגיבויים האוטומטיים — מזכירים עד שנרשם
    const parts = [text];
    if (dbAtRest.status !== 'encrypted' && dbAtRest.status !== 'plain') parts.push(AT_REST_WARNINGS[dbAtRest.status] || '');
    if (dbAtRest.vacuumPending) parts.push(AT_REST_WARNINGS['vacuum-pending']);
    // מחסן מוצפן שלא נפתח: המודול נראה ריק, והגיבוי לא נשמר עד שהתקלה מטופלת — מזכירים כאן ולא רק ביומן
    for (const mod of SecureStore.MODULES) {
      if (secureStore(mod).state === 'locked') parts.push(`⚠ הנתונים המוצפנים של ${MODULE_NAMES[mod] || mod} לא נפתחו — פנו לתמיכה עם דוח תקלה (F1)`);
    }
    // קוד השחזור — למנהל בלבד (shellGuard ב-shell:get-recovery-code); לאחרים התזכורת רק מבלבלת
    if (!s.recoveryCodeSavedAt && safeStorage.isEncryptionAvailable() && econ.sessionCan(econSenderId(), 'users.manage')) parts.push('⚠ טרם נרשם קוד שחזור (🔑)');
    return parts.filter(Boolean).join(' · ');
  });
  // גיבויים ישנים לא מוצפנים בתיקיית הגיבוי (PLAN.md 3.6): רשימה, הצפנה (ואז מחיקת המקור), מחיקה. שום דבר לא אוטומטי
  const savePlainCount = () => saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), plainBackups: PlainBk.scan(backupDir()).length });
  ipcMain.handle('shell:plain-backups', (e) => {
    shellGuard(e, 'data.backup');
    const list = PlainBk.scan(backupDir());
    return { dir: backupDir(), files: list, warning: PlainBk.warningText(list), canEncrypt: safeStorage.isEncryptionAvailable() };
  });
  ipcMain.handle('shell:plain-backup-encrypt', (e, name) => {
    shellGuard(e, 'data.backup');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('הצפנת Windows אינה זמינה בחשבון הזה — אפשר רק למחוק את הקובץ');
    const r = PlainBk.encryptFile({ dir: backupDir(), name, key: autoBackupKey(true) });
    logger.warn('plain-backup', 'encrypted ' + r.file);
    savePlainCount();
    return r;
  });
  ipcMain.handle('shell:plain-backup-delete', (e, name) => {
    shellGuard(e, 'data.backup');
    const r = PlainBk.deleteFile({ dir: backupDir(), name });
    logger.warn('plain-backup', 'deleted ' + r.deleted);
    savePlainCount();
    return r;
  });
  // קוד השחזור של הגיבוי האוטומטי: נוצר מהמפתח (ויוצר אותו אם אין עדיין). מנהל בלבד (החלטת הבעלים 23.10.2026):
  // הקוד פותח את המסד, את כל הגיבויים האוטומטיים ואת המחסנים המוצפנים
  // הסיסמה של המנהל המחובר נבדקת שוב בתהליך הראשי לפני כל הצגה (סקירת קוד 2.11.2026): אחרי כניסה עם Google
  // במחשב משותף, או מחשב שנשאר פתוח — הקוד לא מוצג בלי הסיסמה
  ipcMain.handle('shell:get-recovery-code', async (e, password) => {
    shellGuard(e, 'users.manage');
    await econ.confirmPassword(econSenderId(), password);
    return AutoBk.recoveryCodeFromKey(autoBackupKey(true));
  });
  // מסך הבית: מדדים ומשימות להיום, ושאלה לעוזר — בשם המודול הכלכלי, דרך אותו שומר (כניסה, הרשאה, רישיון).
  // בלי כניסה — null (המסך מציג "—"), בלי לרשום פעילות בפגישה שפגה
  ipcMain.handle('shell:get-home-summary', (e) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econ || !econ.hasSession(econSenderId())) return null;
    return econ.shellCall('dashboard:getHomeSummary', econSenderId());
  });
  ipcMain.handle('shell:ai-ask', (e, question) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('הפעולה מותרת מתוך המעטפת בלבד');
    if (!econ || !econ.hasSession(econSenderId())) throw new Error('כדי לשאול את העוזר יש להיכנס למערכת הכספים');
    return econ.shellCall('ai:run', econSenderId(), String(question || ''));
  });
  ipcMain.handle('shell:recovery-code-saved', (e) => {
    shellGuard(e, 'users.manage');
    saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), recoveryCodeSavedAt: new Date().toISOString() });
    return true;
  });
  // יעד הגיבוי האוטומטי — מנהל בלבד (החלטת הבעלים 23.10.2026)
  ipcMain.handle('shell:pick-backup-target', async (e) => {
    shellGuard(e, 'users.manage');
    const r = await dialog.showOpenDialog(win, { title: 'בחירת יעד לגיבוי אוטומטי (למשל כונן USB)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '';
    // יעד שלא נשמר לא מוצג כאילו נבחר — אחרת הגיבוי ממשיך בשקט ליעד הקודם
    if (!saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), targetDir: r.filePaths[0] })) {
      throw new Error('בחירת יעד הגיבוי לא נשמרה (שגיאת כתיבה בתיקיית הנתונים). נסו שוב.');
    }
    return r.filePaths[0];
  });

  registerSyncHandlers();
  createWindow();
  booting = false;
  // בדיקת עלייה: טוענים את המעטפת וכל מודול, ויוצאים. בלי גיבוי אוטומטי (הוא כותב לתיקיית המסמכים האמיתית)
  if (smoke) {
    // --shots: כל מודול מוצג בתורו (בלי הסרגל של הכניסה/הרישוי) ומצולם
    const capture = async (id) => {
      for (const k of Object.keys(views)) views[k].setVisible(false);
      if (id === 'shell') { await new Promise(r => setTimeout(r, 400)); return win.webContents.capturePage(); }
      views[id].setVisible(true);
      layout();
      await new Promise(r => setTimeout(r, 1200));
      return views[id].webContents.capturePage();
    };
    smoke.run((id) => (id === 'shell' ? win.webContents : ensureView(id).webContents), ['shell', ...MODS], waitLoaded, capture);
    return;
  }
  setTimeout(autoBackup, 15000);
  setInterval(autoBackup, 6 * 3600 * 1000);
}).catch(bootFailed);

app.on('window-all-closed', () => { if (!booting) app.quit(); });
