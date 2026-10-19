const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, net, session, shell, Menu, safeStorage } = require('electron');
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
const TrainerCheck = require('./shell/trainer-backup-check');
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
const { createCrashGuard } = require('./shell/crash');
// יומן תקלות ורשת ביטחון לקריסות (PLAN.md 2.1–2.2) — מותקנים לפני כל דבר אחר, כדי לתפוס גם תקלה בעלייה
const logger = createLogger({ dir: app.getPath('userData') });
const crash = createCrashGuard({ logger, dialog, app, getWin: () => win, version: app.getVersion ? String(app.getVersion()) : '' });
crash.installProcessHandlers();
// בדיקת עלייה של הגרסה הארוזה (PLAN.md 3.5, CI בלבד): רק עם תיקיית נתונים נפרדת — לא נוגעים בנתונים אמיתיים
const Smoke = require('./shell/smoke');
const Splash = require('./shell/splash');
const smoke = Smoke.isSmoke(process.argv)
  ? (process.argv.some(a => a.startsWith('--user-data-dir=')) ? Smoke.createSmoke({ fs, path, dir: app.getPath('userData'), dialog, exit: (c) => app.exit(c), shots: Smoke.shotsDir(process.argv) }) : (app.exit(2), null))
  : null;
// תצוגות מותרות = הקטלוג + תצוגות חדשות שזוהו בסרגל הפנימי של המודול הכלכלי (סנכרון אוטומטי)
const ECON_EXTRAS = (() => {
  try { return Catalog.extrasFromHtml(fs.readFileSync(path.join(__dirname, 'modules', 'econ', 'views', 'index.html'), 'utf8')); }
  catch { return []; }
})();
const ECON_VIEWS = [...Catalog.ECON_VIEWS, ...ECON_EXTRAS.map(x => x.view)];
// מסכי מודול האימונים בסרגל האחיד: תצוגה ← הטקסט של הכפתור בסרגל הפנימי של המודול
const TRAINER_VIEWS = Catalog.TRAINER_VIEWS;
const TRAINER_BY_LABEL = Object.fromEntries(Object.entries(Catalog.TRAINER_LABELS).map(([v, l]) => [l, v]));
// האם מותר לפתוח תצוגה פנימית במודול
const moduleHasView = (id, view) => (id === 'econ' && ECON_VIEWS.includes(view)) || (id === 'trainer' && TRAINER_VIEWS.includes(view));

const SIDEBAR = 264;
// היסטוריית ניווט (אחורה/קדימה). replaying: מעבר שמקורו בהיסטוריה עצמה לא נרשם כצעד חדש
const history = NavHistory.create();
let replaying = false;
const MODS = ['econ', 'shamai', 'trainer', 'tools'];
const LS_MODS = ['shamai', 'trainer', 'tools'];
const ENTRY = {
  // embedded=1: הסרגל הפנימי של המודול מוסתר — הניווט כולו בסרגל האחיד של המעטפת
  econ: 'app://econ/views/index.html?embedded=1',
  shamai: 'app://shamai/index.html',
  trainer: 'app://trainer/index.html',
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
  if (input.control && !input.shift && /^[1-4]$/.test(input.key)) {
    // מבטלים את הקיצור תמיד (Ctrl+ספרה לא מכניס תו), ומעבירים מודול רק אם לא מקלידים בשדה
    const target = MODS[+input.key - 1];
    wc.executeJavaScript(EDITING_CHECK_JS)
      .then(editing => { if (!editing) switchTo(target); })
      .catch(() => {});
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

function wireView(id, wc) {
  wc.setWindowOpenHandler(({ url }) => { if (isExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('app://' + id + '/')) return;
    e.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  wc.on('before-input-event', (e, input) => {
    // עבודה במודול שדורש כניסה נחשבת פעילות — אחרת הניתוק האוטומטי מוציא באמצע עבודה
    if (loginGate.isLocked(id) && views.econ && econ && econ.touchSession) econ.touchSession(views.econ.webContents.id);
    if (handleShortcut(input, wc)) e.preventDefault();
  });
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
  // מודול האימונים: preload בלי חשיפה לעמוד — ניווט מהסרגל האחיד ודיווח המסך הפעיל
  if (id === 'trainer') prefs.preload = path.join(modulesRoot(), 'trainer', 'preload.js');
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

// שמאי ואימונים — רק אחרי כניסה. בלי כניסה: מסך הכניסה במודול הכלכלי, והמודול נפתח אחרי הכניסה
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
  overlay = false;
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

// פתיחת תצוגה במודול האימונים: ה-preload לוחץ על הכפתור המתאים בסרגל הפנימי (ושומר את הבקשה עד שהוא קיים)
function openTrainerView(view) {
  if (!TRAINER_VIEWS.includes(view)) return false;
  // לפני כניסה — התצוגה נשמרת עם המודול הממתין ונפתחת אחרי הכניסה
  if (loginGate.pending && loginGate.pending.id === 'trainer') { loginGate.setPendingView('trainer', view); return true; }
  const v = ensureView('trainer');
  waitLoaded(v.webContents).then(() => {
    if (!v.webContents.isDestroyed()) v.webContents.send('trainer:goto', Catalog.TRAINER_LABELS[view]);
  });
  return true;
}

function openModuleView(id, view) {
  if (id === 'econ') return openEconView(view);
  if (id === 'trainer') return openTrainerView(view);
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
const backupDir = () => loadJson(backupSettingsFile()).targetDir || path.join(app.getPath('documents'), 'SuperSuite-Backups');
function loadJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveJson(f, obj) { try { fs.writeFileSync(f, JSON.stringify(obj)); } catch {} }
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
function closeSplash() { if (splash) { splash.close(); splash = null; } }

function createWindow() {
  const st = loadState();
  zoom = Number(loadJson(uiFile()).zoom) || 1;
  win = new BrowserWindow({
    width: st.width || 1500, height: st.height || 940, x: st.x, y: st.y, minWidth: 1100, minHeight: 700,
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
// scope: 'all' או שם מודול בודד ('econ' | 'shamai' | 'trainer' | 'tools')
async function collectBackup(scope = 'all') {
  const out = { suite: 'SuperSuite', version: 2, scope, createdAt: new Date().toISOString(), econ: null, localStorage: {} };
  if (scope === 'all' || scope === 'econ') {
    try { out.econ = await econ.getDb().backup(); } catch (e) { out.econError = String(e.message || e); }
  }
  const DUMP = 'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))';
  for (const id of LS_MODS) {
    if (scope !== 'all' && scope !== id) continue;
    // מחסן מוצפן: קוראים ממנו ישירות — בלי לפתוח את המודול (שבלי כניסה מקבל אחסון ריק)
    if (SecureStore.MODULES.includes(id) && secureStore(id).state === 'encrypted') { out.localStorage[id] = secureStore(id).snapshot(); continue; }
    const v = ensureView(id);
    await waitLoaded(v.webContents);
    try { out.localStorage[id] = JSON.parse(await v.webContents.executeJavaScript(DUMP)); } catch { out.localStorage[id] = {}; }
  }
  // ensureView יוצר תצוגות מוסתרות ואינו משנה את המודול הפעיל — אין צורך להחזיר פוקוס,
  // אחרת הגיבוי האוטומטי גונב את הפוקוס מהמשתמש כל 6 שעות
  return out;
}

// מפתח גיבוי אוטומטי לכל התקנה: נשמר מוצפן על ידי מערכת ההפעלה (Windows DPAPI), כך שהגיבוי קריא רק לחשבון הזה
const autoBackupKeyFile = () => path.join(app.getPath('userData'), 'autobackup.key');
function autoBackupKey(create = true) {
  return AutoBk.loadAutoBackupKey({ file: autoBackupKeyFile(), safeStorage, create });
}

/* ---------- הצפנת מסד הנתונים (PLAN.md 3.1) ----------
   המפתח נגזר ממפתח הגיבוי האוטומטי (DPAPI) — קוד השחזור (🔑) פותח גם את המסד.
   מפתח שאבד: חלון קטן מבקש את קוד השחזור. לעולם לא נוצר מפתח חדש מעל נתונים מוצפנים. */
let dbAtRest = { status: 'plain' };
const AT_REST_WARNINGS = {
  'pending-backup': '⚠ הנתונים עוד לא הוצפנו: הגיבוי שלפני ההצפנה נכשל (ננסה שוב בהפעלה הבאה)',
  'plain-no-dpapi': '⚠ הנתונים במחשב הזה אינם מוצפנים: הצפנת Windows אינה זמינה בחשבון',
  'plain-key-unreadable': '⚠ הנתונים אינם מוצפנים: מפתח הגיבוי האוטומטי אינו קריא בחשבון הזה'
};
function dbAtRestOptions() {
  return {
    resolveCipher: async ({ hasSealedData, verify }) => {
      dbAtRest = await DbKey.resolveDbKey({ fs, file: autoBackupKeyFile(), safeStorage, hasSealedData, verify, promptRecoveryCode });
      if (dbAtRest.status === 'plain-no-dpapi' || dbAtRest.status === 'plain-key-unreadable') logger.error('db-at-rest', new Error(dbAtRest.status));
      return dbAtRest;
    },
    // גיבוי מוצפן של כל הנתונים לפני ההמרה. בלי גיבוי תקין — ההמרה לא מתחילה
    beforeEncrypt: async (db) => {
      const dir = loadJson(backupSettingsFile()).targetDir || path.join(app.getPath('documents'), 'SuperSuite-Backups');
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
    const finish = (v) => { if (done) return; done = true; ipcMain.removeHandler('recovery:submit'); ipcMain.removeHandler('recovery:info'); if (!w.isDestroyed()) w.close(); resolve(v); };
    ipcMain.handle('recovery:info', (e) => (e.sender.id === w.webContents.id ? { message: message || '' } : null));
    ipcMain.handle('recovery:submit', (e, code) => { if (e.sender.id === w.webContents.id) finish(typeof code === 'string' ? code.slice(0, 200) : null); });
    w.on('closed', () => finish(null));
    w.loadFile(path.join(__dirname, 'shell', 'recovery.html'));
  });
}

/* ---------- מחסן מוצפן לשמאות ולאימונים (PLAN.md 3.2) ----------
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

/* תשלומי האימונים למסך הגבייה (PLAN.md 9.11): המערכת הכלכלית מקבלת את נתוני האימונים לקריאה בלבד, ורק
   מתצוגת המודול הכלכלי (הערוצים עצמם — ב-handle() של ipc.js: כניסה, הרשאה ורישיון החשבוניות). מודול האימונים
   לא שולח ולא מקבל דבר; בלי רישיון לאימונים, או כשהמחסן שלו לא מוצפן/נעול — אין נתונים */
function trainerDataForEcon(senderId) {
  if (!fromView({ sender: { id: senderId } }, 'econ')) throw new Error('תשלומי האימונים זמינים רק מתוך המערכת הכלכלית');
  if (!LG.moduleAllowed(licenseNow(), 'trainer')) throw new Error('מודול האימונים אינו כלול ברישיון');
  const s = secureStore('trainer');
  if (s.state !== 'encrypted') throw new Error('נתוני האימונים אינם זמינים (המחסן המוצפן של המודול לא נפתח)');
  return s.snapshot();
}
function wireSecureStore() {
  session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'shell', 'secure-ls-preload.js') });
  ipcMain.on('secure-store:load', (e, mod) => {
    if (!fromModuleView(e, mod)) { e.returnValue = null; return; }
    const s = secureStore(mod);
    // בלי כניסה (PLAN.md 3.3): העמוד מקבל אחסון ריק לקריאה בלבד — נטען מחדש עם הנתונים אחרי הכניסה
    if (s.state === 'encrypted' && !econSessionAlive()) { e.returnValue = { state: 'no-session', migrated: true, data: {} }; return; }
    e.returnValue = { state: s.state, migrated: s.migrated, data: s.state === 'plain' ? {} : s.snapshot() };
  });
  // גיבוי מוצפן של הנתונים הישנים לפני ההעברה. בלי גיבוי — אין העברה
  ipcMain.on('secure-store:migrate', (e, mod, items) => {
    if (!fromModuleView(e, mod)) { e.returnValue = { ok: false }; return; }
    e.returnValue = secureStore(mod).migrate(items, (plain) => {
      const dir = loadJson(backupSettingsFile()).targetDir || path.join(app.getPath('documents'), 'SuperSuite-Backups');
      fs.mkdirSync(dir, { recursive: true });
      const out = { suite: 'SuperSuite', version: 2, scope: mod, createdAt: new Date().toISOString(), econ: null, localStorage: { [mod]: plain } };
      const file = path.join(dir, `before-encryption-${mod}-${AutoBk.localDay()}-${Date.now()}.ssbk`);
      fs.writeFileSync(file + '.tmp', BK.encryptBackup(JSON.stringify(out), autoBackupKey(false)), 'utf8');
      fs.renameSync(file + '.tmp', file);
      JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), autoBackupKey(false)));
    });
  });
  ipcMain.on('secure-store:write', (e, mod, op, k, v) => {
    if (!fromModuleView(e, mod) || !econSessionAlive()) return;
    const s = secureStore(mod);
    if (op === 'set') s.set(k, v); else if (op === 'remove') s.remove(k); else if (op === 'clear') s.clear();
  });
}

/* ---------- מסד נתונים פגום או נעול בעלייה (PLAN.md 2.3) ----------
   נעול ← "נסו שוב". פגום ← שחזור מהגיבוי האוטומטי האחרון למסד חדש; הפגום מועבר הצידה, לא נמחק.
   מחזיר true אם המערכת הכלכלית עלתה, false ליציאה. */
const econInitOptions = () => ({ isRestTime: syncPaused, dbOptions: dbAtRestOptions(), trainerData: trainerDataForEcon });
async function recoverDatabase(firstErr) {
  let err = firstErr;
  for (let round = 0; round < 20; round++) {
    const kind = DbRecovery.classifyDbError(err);
    logger.error('db-open', err);
    const backupDir = loadJson(backupSettingsFile()).targetDir || path.join(app.getPath('documents'), 'SuperSuite-Backups');
    const backup = kind === 'corrupt' ? DbRecovery.latestAutoBackup(backupDir) : null;
    const d = DbRecovery.dialogFor(kind, backup);
    const r = await dialog.showMessageBox({ type: 'error', buttons: d.buttons.map(b => b.label), defaultId: 0, cancelId: d.buttons.length - 1,
      noLink: true, message: d.message, detail: d.detail });
    const choice = (d.buttons[r.response] || {}).id || 'quit';
    if (choice === 'quit') return false;
    if (choice === 'folder') { shell.openPath(app.getPath('userData')); continue; }
    if (choice === 'report') { await crash.saveReport(); continue; }
    try {
      if (choice === 'restore') {
        // פענוח לפני שנוגעים במסד: גיבוי שלא נפתח — המסד הפגום נשאר במקומו
        const data = JSON.parse(BK.decryptBackup(fs.readFileSync(backup.file, 'utf8'), autoBackupKey(false)));
        if (!data || data.suite !== 'SuperSuite' || !data.econ) throw new Error('קובץ הגיבוי האוטומטי אינו מכיל נתונים כלכליים');
        const aside = DbRecovery.setAsideDamaged(app.getPath('userData'));
        logger.error('db-open', new Error('damaged database set aside: ' + path.basename(aside)));
        await econ.initEcon(app.getPath('userData'), econInitOptions());
        await econ.getDb().restore(data.econ);
        await dialog.showMessageBox({ type: 'info', message: 'הנתונים שוחזרו מהגיבוי האוטומטי', detail: `גיבוי מתאריך ${backup.day}. הקובץ הפגום נשמר בצד בתיקיית הנתונים.` });
        return true;
      }
      await econ.initEcon(app.getPath('userData'), econInitOptions()); // נסו שוב
      return true;
    } catch (e) {
      if (DbRecovery.classifyDbError(e)) { err = e; continue; }
      logger.error('db-restore', e);
      dialog.showErrorBox('השחזור לא הצליח', String(e.message || e) + '\n\nאפשר לנסות שוב, או לשמור דוח תקלה ולפנות לתמיכה.');
    }
  }
  return false;
}

/* גיבוי אוטומטי יומי — מוצפן בלבד. יעד: כונן חיצוני (USB) שהוגדר, ואם לא הוגדר — Documents\SuperSuite-Backups.
   אם הכונן לא מחובר — מדלגים (לא כותבים למקום אחר בשקט). הסטטוס נשמר ומוצג במעטפת. */
async function autoBackup() {
  let status;
  // בשבת וביום טוב התוכנה לא מבצעת פעולות אוטומטיות; הגיבוי יתבצע בסבב הבא אחרי הצאת
  const cal = calendarSettings();
  if (cal.shabbatMode && Hebcal.shabbatStatus(Date.now(), cal).active) return { ok: false, reason: 'shabbat', at: new Date().toISOString() };
  try {
    status = await AutoBk.runAutoBackup({
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      customTarget: loadJson(backupSettingsFile()).targetDir || '',
      defaultTarget: path.join(app.getPath('documents'), 'SuperSuite-Backups'),
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
  const out = await collectBackup(scope);
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, { title: 'שמירת גיבוי מוצפן', defaultPath: `SuperSuite-${scope}-${stamp}.ssbk`, filters: [{ name: 'גיבוי SuperSuite', extensions: ['ssbk'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, BK.encryptBackup(JSON.stringify(out), passphrase), 'utf8'); }
  catch (e) { throw new Error('שמירת הגיבוי נכשלה — ייתכן שהכונן מלא, מוגן מפני כתיבה או נותק (' + (e.code || 'שגיאה') + ')'); }
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

async function restoreAll(passphrase) {
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
  // קובץ JSON ישן מכפתור הייצוא של מודול האימונים (לפני PLAN.md 3.4)
  data = TrainerCheck.legacyTrainerBackup(data) || data;
  if (!data || data.suite !== 'SuperSuite') { dialog.showErrorBox('שגיאה', 'הקובץ אינו גיבוי של SuperSuite'); return { ok: false }; }
  // נתוני האימונים נבדקים לפני האישור ולפני כל מחיקה — קובץ פגום לא נוגע בשום דבר
  let trainerItems = null;
  if (data.localStorage && data.localStorage.trainer) {
    const t = TrainerCheck.checkTrainerItems(data.localStorage.trainer);
    if (!t.ok) { dialog.showErrorBox('שגיאה', t.error + '. לא שוחזר דבר, והנתונים הקיימים לא השתנו.'); return { ok: false }; }
    trainerItems = t.clean;
  }
  const scopeText = data.legacy ? '(גיבוי ישן של ניהול האימונים)' : data.scope && data.scope !== 'all' ? `(גיבוי של מודול: ${data.scope})` : '(גיבוי מלא)';
  const c = await dialog.showMessageBox(win, { type: 'warning', buttons: ['שחזר', 'ביטול'], defaultId: 1, cancelId: 1, message: 'השחזור יחליף את הנתונים הקיימים ' + scopeText, detail: 'מומלץ לבצע גיבוי לפני כן.' });
  if (c.response !== 0) return { ok: false };
  try { if (data.econ) await econ.getDb().restore(data.econ); } catch (e) { dialog.showErrorBox('שגיאה בשחזור המערכת הכלכלית', String(e.message || e)); }
  for (const id of LS_MODS) {
    const items = id === 'trainer' ? trainerItems : data.localStorage && data.localStorage[id];
    if (!items) continue;
    // קובץ הגיבוי הוא קלט חיצוני: מוודאים שכל ערך הוא מחרוזת בגודל סביר
    // לפני שכותבים אותו ל-localStorage של המודול. ערך לא-מחרוזתי או ענק נפסל בשקט.
    if (typeof items !== 'object' || Array.isArray(items)) continue;
    const clean = {};
    for (const [k, val] of Object.entries(items)) {
      if (typeof k !== 'string' || k.length > 256) continue;
      if (typeof val !== 'string' || val.length > LS_VALUE_MAX) continue;
      clean[k] = val;
    }
    if (!Object.keys(clean).length) continue;
    // מודול עם מחסן מוצפן: כותבים ישירות למחסן (ולא דרך העמוד), כדי שהטעינה מחדש תראה את הנתונים מיד
    if (SecureStore.MODULES.includes(id) && secureStore(id).state === 'encrypted') {
      const s = secureStore(id);
      s.clear();
      for (const [k, val] of Object.entries(clean)) s.set(k, val);
      s.flush();
      continue;
    }
    const v = ensureView(id);
    await waitLoaded(v.webContents);
    await v.webContents.executeJavaScript(`(()=>{const d=${JSON.stringify(clean)};localStorage.clear();for(const k in d)localStorage.setItem(k,d[k]);})()`);
  }
  for (const id of Object.keys(views)) views[id].webContents.reload();
  dialog.showMessageBox(win, { type: 'info', message: 'השחזור הושלם' });
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
  h('sync:status', () => sync.status());
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
  sync.init().catch((err) => logger.error('sync-init', err));
}
app.on('will-quit', () => { if (sync) sync.close().catch(() => {}); for (const s of Object.values(secureStores)) s.flush(); });

/* ---------- הפעלה ---------- */
// גרסת הפצה עם פרמטר דיבוג (--remote-debugging-port, --inspect...) — לא עולה (PLAN.md 3.5)
const debugSwitch = CodeGuard.startupCheck({ argv: process.argv, packaged: app.isPackaged,
  hasSwitch: (s) => app.commandLine && app.commandLine.hasSwitch(s) });
if (debugSwitch) { logger.error('code-guard', new Error('debug switch: ' + debugSwitch)); app.exit(1); }
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (!smoke) openSplash();
  registerProtocol();
  wireSecureStore();

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
      const c = await dialog.showMessageBox({ type: 'warning', buttons: ['פתיחה ריקה לשחזור מגיבוי', 'יציאה'], defaultId: 1, cancelId: 1,
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
  } catch (err) {
    closeSplash();
    // מסד פגום או נעול (PLAN.md 2.3): הודעה בעברית ואפשרויות, במקום שגיאה טכנית וסגירה
    if (!(DbRecovery.classifyDbError(err) && await recoverDatabase(err))) {
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
  // מודול האימונים מדווח על המסך הפעיל (לפי הטקסט בסרגל הפנימי) — רק מתצוגת המודול עצמה
  ipcMain.handle('shell:trainer-view', (e, label) => {
    const v = views.trainer;
    if (!v || v.webContents.isDestroyed() || e.sender.id !== v.webContents.id) return false;
    const view = typeof label === 'string' ? TRAINER_BY_LABEL[label] : undefined;
    if (!view) return false;
    if (win && !win.isDestroyed()) win.webContents.send('shell:active-view', view, 'trainer');
    if (active === 'trainer') recordNav({ mod: 'trainer', view });
    return true;
  });
  ipcMain.handle('shell:history-go', (e, delta) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    return navigateHistory(delta === 1 ? 1 : -1);
  });
  ipcMain.handle('shell:home', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; goHome(); return true; });
  ipcMain.handle('shell:quit', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; app.quit(); return true; });
  // דוח תקלה לתמיכה — היומן בלבד, בלי נתונים (PLAN.md 2.2)
  ipcMain.handle('shell:save-crash-report', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    return crash.saveReport();
  });
  ipcMain.handle('shell:is-logged-in', (e) => {
    if (!win || e.sender.id !== win.webContents.id) return false;
    return econLoggedIn();
  });
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
    if (!s.recoveryCodeSavedAt && safeStorage.isEncryptionAvailable()) parts.push('⚠ טרם נרשם קוד שחזור (🔑)');
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
  // קוד השחזור של הגיבוי האוטומטי: נוצר מהמפתח (ויוצר אותו אם אין עדיין). מי שמורשה לגבות — מורשה לראות
  ipcMain.handle('shell:get-recovery-code', (e) => {
    shellGuard(e, 'data.backup');
    return AutoBk.recoveryCodeFromKey(autoBackupKey(true));
  });
  ipcMain.handle('shell:recovery-code-saved', (e) => {
    shellGuard(e, 'data.backup');
    saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), recoveryCodeSavedAt: new Date().toISOString() });
    return true;
  });
  ipcMain.handle('shell:pick-backup-target', async (e) => {
    shellGuard(e, 'data.backup');
    const r = await dialog.showOpenDialog(win, { title: 'בחירת יעד לגיבוי אוטומטי (למשל כונן USB)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '';
    saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), targetDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  registerSyncHandlers();
  createWindow();
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
});

app.on('window-all-closed', () => app.quit());
