const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, net, session, shell, Menu, safeStorage } = require('electron');
const crypto = require('crypto');
const BK = require('./modules/econ/core/backupCrypto');
const AB = require('./modules/econ/core/features');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { canShellNavigate, canModuleOpen, EDITING_CHECK_JS } = require('./shell/nav-guard');

const SIDEBAR = 200;
const MODS = ['econ', 'shamai', 'trainer', 'tools'];
const LS_MODS = ['shamai', 'trainer', 'tools'];
const ENTRY = {
  econ: 'app://econ/views/index.html',
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
let zoom = 1;

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
  if (input.control && input.shift && (input.key === 'B' || input.key === 'b')) { sendCmd('backup'); return true; }
  if (input.control && input.shift && (input.key === 'R' || input.key === 'r')) { sendCmd('restore'); return true; }
  return false;
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

function switchTo(id) {
  if (!MODS.includes(id)) return;
  const v = ensureView(id);
  for (const k of Object.keys(views)) views[k].setVisible(k === id);
  active = id;
  v.webContents.focus();
  if (win && !win.isDestroyed()) win.webContents.send('shell:active', id);
}

// חזרה למסך הבית: מסתירים את כל התצוגות כך שהמעטפת נשארת לבדה.
// זו הדרך "לצאת" ממודול בלי לסגור את התוכנה.
function goHome() {
  for (const k of Object.keys(views)) views[k].setVisible(false);
  active = null;
  if (win && !win.isDestroyed()) { win.webContents.focus(); win.webContents.send('shell:active', null); }
}

function setZoom(z) {
  zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
  for (const id of Object.keys(views)) views[id].webContents.setZoomFactor(zoom);
  saveJson(uiFile(), { zoom });
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
    backgroundColor: '#111a2e', title: 'SuperSuite', autoHideMenuBar: true,
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
  win.loadFile(path.join(__dirname, 'shell', 'shell.html'));
  // לא נכנסים לשום מודול אוטומטית: המשתמש בוחר מהמסך הראשי.
  // (קודם נכנסנו ל-'econ' מיד עם העלייה, וזה נעל את המשתמש בלי אפשרות לצאת.)
  win.on('closed', () => { win = null; });
}

/* ---------- גיבוי ושחזור ---------- */
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
    if (v.webContents.isLoading()) await new Promise(r => v.webContents.once('did-finish-load', r));
    try { out.localStorage[id] = JSON.parse(await v.webContents.executeJavaScript(DUMP)); } catch { out.localStorage[id] = {}; }
  }
  if (active) switchTo(active);
  return out;
}

// מפתח גיבוי אוטומטי לכל התקנה: נשמר מוצפן על ידי מערכת ההפעלה (Windows DPAPI), כך שהגיבוי קריא רק לחשבון הזה
function autoBackupKey() {
  const f = path.join(app.getPath('userData'), 'autobackup.key');
  if (fs.existsSync(f)) return safeStorage.decryptString(fs.readFileSync(f));
  const k = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(f, safeStorage.encryptString(k));
  return k;
}

/* גיבוי אוטומטי יומי — מוצפן בלבד. יעד: כונן חיצוני (USB) שהוגדר, ואם לא הוגדר — Documents\SuperSuite-Backups.
   אם הכונן לא מחובר — מדלגים (לא כותבים למקום אחר בשקט). */
async function autoBackup() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return; // בלי הצפנת מערכת — לא כותבים גיבוי
    const target = loadJson(backupSettingsFile()).targetDir || path.join(app.getPath('documents'), 'SuperSuite-Backups');
    if (!fs.existsSync(target)) { console.warn('auto-backup: target not available', target); return; }
    const out = await collectBackup('all');
    const r = AB.writeEncryptedAutoBackup({ dir: target, plainText: JSON.stringify(out), key: autoBackupKey(), keep: 14 });
    if (!r.ok) console.warn('auto-backup skipped:', r.reason);
  } catch (e) { console.error('auto-backup failed', e); }
}

async function backupAll(passphrase, scope = 'all') {
  if (typeof passphrase !== 'string' || passphrase.length < BK.MIN_PASSPHRASE) throw new Error(`סיסמת הגיבוי חייבת להכיל לפחות ${BK.MIN_PASSPHRASE} תווים`);
  const out = await collectBackup(scope);
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, { title: 'שמירת גיבוי מוצפן', defaultPath: `SuperSuite-${scope}-${stamp}.ssbk`, filters: [{ name: 'גיבוי SuperSuite', extensions: ['ssbk'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, BK.encryptBackup(JSON.stringify(out), passphrase), 'utf8');
  dialog.showMessageBox(win, { type: 'info', message: 'הגיבוי נשמר ומוצפן', detail: r.filePath });
  return { ok: true };
}

function openBackupText(text, passphrase) {
  if (!BK.isEncryptedBackup(text)) return text; // גיבוי ישן (JSON גלוי) — נקרא בלבד, לא נכתב
  if (passphrase) return BK.decryptBackup(text, passphrase);
  try { return BK.decryptBackup(text, autoBackupKey()); } catch {
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
    if (v.webContents.isLoading()) await new Promise(res => v.webContents.once('did-finish-load', res));
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
