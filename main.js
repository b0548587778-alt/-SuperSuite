const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, net, session, shell, Menu, safeStorage } = require('electron');
const crypto = require('crypto');
const BK = require('./modules/econ/core/backupCrypto');
const AB = require('./modules/econ/core/features');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { canShellNavigate, canModuleOpen, EDITING_CHECK_JS } = require('./shell/nav-guard');
const AutoBk = require('./shell/auto-backup');
const Catalog = require('./shell/catalog');
const Hebcal = require('./shell/hebcal');
const NavHistory = require('./shell/history');
const LG = require('./shell/licensing/gate');
// תצוגות מותרות = הקטלוג + תצוגות חדשות שזוהו בסרגל הפנימי של המודול הכלכלי (סנכרון אוטומטי)
const ECON_EXTRAS = (() => {
  try { return Catalog.extrasFromHtml(fs.readFileSync(path.join(__dirname, 'modules', 'econ', 'views', 'index.html'), 'utf8')); }
  catch { return []; }
})();
const ECON_VIEWS = [...Catalog.ECON_VIEWS, ...ECON_EXTRAS.map(x => x.view)];

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
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function isExternal(u) { return /^(https?:|mailto:|tel:)/i.test(u); }

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const b = { x: 0, y: 0, width: Math.max(0, w - SIDEBAR), height: h };
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
    else { switchTo(loc.mod); if (loc.view) openEconView(loc.view); }
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
  wc.on('before-input-event', (e, input) => { if (handleShortcut(input, wc)) e.preventDefault(); });
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
  const v = new WebContentsView({ webPreferences: prefs });
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

function switchTo(id) {
  if (!MODS.includes(id)) return;
  const lic = licenseNow();
  if (!LG.moduleAllowed(lic, id) && id !== 'econ') {
    sendLicenseToShell(lic);
    if (win && !win.isDestroyed()) win.webContents.send('shell:active', active);
    return;
  }
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

function createWindow() {
  const st = loadState();
  zoom = Number(loadJson(uiFile()).zoom) || 1;
  win = new BrowserWindow({
    width: st.width || 1500, height: st.height || 940, x: st.x, y: st.y, minWidth: 1100, minHeight: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0f1a30', title: 'SuperSuite', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'shell', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  if (st.max) win.maximize();
  win.on('close', saveState);
  win.on('resize', layout);
  win.on('maximize', layout); win.on('unmaximize', layout); win.on('enter-full-screen', layout); win.on('leave-full-screen', layout);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input, win.webContents)) e.preventDefault(); });
  wireAppCommand(win);
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
    console.error('auto-backup failed', e);
    status = { ok: false, reason: e.code || 'error', at: new Date().toISOString() };
  }
  if (!status.ok) console.warn('auto-backup skipped:', status.reason, status.target || '');
  saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), lastAutoBackup: status });
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
  if (passphrase) return BK.decryptBackup(text, passphrase);
  let key;
  try { key = autoBackupKey(false); }
  catch (e) {
    // אין מפתח מקומי: ייתכן שזה גיבוי ידני (סיסמה) או גיבוי אוטומטי ממחשב אחר — אומרים את שתי האפשרויות
    throw new Error('הקובץ מוצפן. אם זה גיבוי ידני — הזן את סיסמת הגיבוי. ' + e.message);
  }
  try { return BK.decryptBackup(text, key); } catch {
    throw new Error('הקובץ מוצפן בסיסמת גיבוי — הזן אותה כדי לשחזר');
  }
}

async function restoreAll(passphrase) {
  const r = await dialog.showOpenDialog(win, { title: 'בחירת קובץ גיבוי', properties: ['openFile'], filters: [{ name: 'גיבוי SuperSuite', extensions: ['ssbk', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let data;
  try {
    data = JSON.parse(openBackupText(fs.readFileSync(r.filePaths[0], 'utf8'), passphrase));
  } catch (e) {
    dialog.showErrorBox('שגיאה', e.message || 'הקובץ אינו גיבוי תקין');
    return { ok: false };
  }
  if (!data || data.suite !== 'SuperSuite') { dialog.showErrorBox('שגיאה', 'הקובץ אינו גיבוי של SuperSuite'); return { ok: false }; }
  const scopeText = data.scope && data.scope !== 'all' ? `(גיבוי של מודול: ${data.scope})` : '(גיבוי מלא)';
  const c = await dialog.showMessageBox(win, { type: 'warning', buttons: ['שחזר', 'ביטול'], defaultId: 1, cancelId: 1, message: 'השחזור יחליף את הנתונים הקיימים ' + scopeText, detail: 'מומלץ לבצע גיבוי לפני כן.' });
  if (c.response !== 0) return { ok: false };
  try { if (data.econ) await econ.getDb().restore(data.econ); } catch (e) { dialog.showErrorBox('שגיאה בשחזור המערכת הכלכלית', String(e.message || e)); }
  for (const id of LS_MODS) {
    const items = data.localStorage && data.localStorage[id];
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
    const v = ensureView(id);
    await waitLoaded(v.webContents);
    await v.webContents.executeJavaScript(`(()=>{const d=${JSON.stringify(clean)};localStorage.clear();for(const k in d)localStorage.setItem(k,d[k]);})()`);
  }
  for (const id of Object.keys(views)) views[id].webContents.reload();
  dialog.showMessageBox(win, { type: 'info', message: 'השחזור הושלם' });
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

/* ---------- הפעלה ---------- */
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerProtocol();

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission);
    cb(ok && String(details.requestingUrl || '').startsWith('app://'));
  });

  try {
    econ = require('./modules/econ/ipc');
    await econ.initEcon(app.getPath('userData'));
  } catch (err) {
    dialog.showErrorBox('שגיאה בפתיחת המערכת הכלכלית', String(err && err.message ? err.message : err) + '\n\nנתיב: ' + app.getPath('userData'));
    app.quit(); return;
  }

  // רישוי: שינוי סטטוס (התקנה, עדכון, סנכרון, או פקיעה עם הזמן — נבדק כל דקה) נאכף מיד
  if (econ.onLicenseChange) econ.onLicenseChange(enforceLicense);
  const licTimer = setInterval(licenseNow, 60 * 1000);
  if (licTimer.unref) licTimer.unref();
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
    if (view != null && (id !== 'econ' || !ECON_VIEWS.includes(view))) return false;
    switchTo(id);
    if (view) openEconView(view);
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
    if (win && !win.isDestroyed()) win.webContents.send('shell:active-view', view);
    if (active === 'econ') recordNav({ mod: 'econ', view });
    return true;
  });
  ipcMain.handle('shell:history-go', (e, delta) => {
    if (!win || win.isDestroyed() || !canShellNavigate(e.sender.id, win.webContents.id)) return false;
    return navigateHistory(delta === 1 ? 1 : -1);
  });
  ipcMain.handle('shell:home', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; goHome(); return true; });
  ipcMain.handle('shell:quit', (e) => { if (!win || e.sender.id !== win.webContents.id) return false; app.quit(); return true; });
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
    return AutoBk.describeStatus(loadJson(backupSettingsFile()).lastAutoBackup);
  });
  ipcMain.handle('shell:pick-backup-target', async (e) => {
    shellGuard(e, 'data.backup');
    const r = await dialog.showOpenDialog(win, { title: 'בחירת יעד לגיבוי אוטומטי (למשל כונן USB)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '';
    saveJson(backupSettingsFile(), { ...loadJson(backupSettingsFile()), targetDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  createWindow();
  setTimeout(autoBackup, 15000);
  setInterval(autoBackup, 6 * 3600 * 1000);
});

app.on('window-all-closed', () => app.quit());
