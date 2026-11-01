// סימולציה של ה-WebView של אנדרואיד מעל Electron — לבדיקת קבצי ה-web בלי מכשיר.
// אותו דומיין, אותה חלוקה ל-origins, ואותו ממשק גשר (SuperSuiteBridge) — ממומש כאן על node:sqlite ו-crypto.
// מה שלא נבדק כאן: קוד ה-Java עצמו (SQLite של אנדרואיד, בוחר הקבצים, מסך ההדפסה).
//
//   node android/build-apk.js --web
//   node_modules/electron/dist/electron.exe android/dev/webview-sim.js [--auto <outDir>]
//
// --auto: מריץ תרחיש (כניסה, מעבר בין המודולים, גיבוי) ושומר צילומי מסך + report.json לתיקייה.
'use strict';
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const WWW = path.join(__dirname, '..', 'build', 'assets', 'www');
const DOMAIN = 'supersuite.androidplatform.net';
const MODS = ['shell', 'econ', 'shamai', 'tools'];
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2' };
const autoIdx = process.argv.indexOf('--auto');
const AUTO = autoIdx > 0 ? path.resolve(process.argv[autoIdx + 1] || 'sim-out') : null;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sim-'));
app.setPath('userData', PROFILE);

const TOKEN = crypto.randomBytes(32).toString('hex');
const DB_FILE = path.join(PROFILE, 'unified_economics.db');
const SAVED = path.join(PROFILE, 'saved');
fs.mkdirSync(SAVED, { recursive: true });

function serve(req) {
  const u = new URL(req.url);
  const mod = MODS.find(m => u.hostname === `${m}.${DOMAIN}`);
  if (!mod) return new Response('', { status: 403 });
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || !p) p = '/index.html';
  if (p.includes('..') || p.includes('\\')) return new Response('', { status: 403 });
  const file = path.join(WWW, mod, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('', { status: 404 });
  const ext = p.split('.').pop();
  return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[ext] || 'application/octet-stream' } });
}

// הגשר: קריאות סינכרוניות מה-preload (ipcRenderer.sendSync), כמו JavascriptInterface
let db = null;
const { DatabaseSync } = require('node:sqlite');
const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.t === 'b' ? Buffer.from(p.v, 'base64') : p.v));
const B = {
  randomBytes: n => crypto.randomBytes(n).toString('base64'),
  scrypt: (pw, salt, N, r, p, len) => crypto.scryptSync(Buffer.from(pw, 'base64'), Buffer.from(salt, 'base64'), len, { N, r, p, maxmem: 256 * 1024 * 1024 }).toString('base64'),
  aesGcm(enc, key, iv, data) {
    const k = Buffer.from(key, 'base64'), v = Buffer.from(iv, 'base64'), d = Buffer.from(data, 'base64');
    if (enc) { const c = crypto.createCipheriv('aes-256-gcm', k, v); return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]).toString('base64'); }
    const c = crypto.createDecipheriv('aes-256-gcm', k, v, { authTagLength: 16 });
    c.setAuthTag(d.subarray(d.length - 16));
    return Buffer.concat([c.update(d.subarray(0, d.length - 16)), c.final()]).toString('base64');
  },
  dbOpen() { if (!db) db = new DatabaseSync(DB_FILE); return true; },
  dbExec(sql) { db.exec(sql); return true; },
  dbRun(sql, params) { db.prepare(sql).run(...decode(params)); return true; },
  dbAll: (sql, params) => db.prepare(sql).all(...decode(params)).map(r => ({ ...r })),
  writeUri(uri, b64) { fs.writeFileSync(path.join(SAVED, path.basename(uri)), Buffer.from(b64, 'base64')); return true; },
  printHtml(html) { fs.writeFileSync(path.join(SAVED, `print-${Date.now()}.html`), html); return true; },
  exit() { return true; },
  // פעולות "בוחר קבצים": בסימולציה נשמרות לתיקייה זמנית
  createDocument(cb, name) { return { async: cb, value: { uri: 'sim://' + name, name } }; },
  saveBytes(cb, name, mime, b64) { fs.writeFileSync(path.join(SAVED, name), Buffer.from(b64, 'base64')); return { async: cb, value: { ok: true, name } }; },
  saveText(cb, name, mime, text) { fs.writeFileSync(path.join(SAVED, name), text); return { async: cb, value: { ok: true, name } }; },
  openText(cb) {
    const f = fs.readdirSync(SAVED).find(x => x.endsWith('.ssbk'));
    return { async: cb, value: f ? { text: fs.readFileSync(path.join(SAVED, f), 'utf8'), name: f } : {} };
  },
  // בוחר תיקייה: בסימולציה — תיקייה בתוך SAVED (נתיב יחסי בלבד, בלי "..")
  pickFolder(cb) { return { async: cb, value: { uri: 'sim-tree://folder', name: 'folder' } }; },
  treeExists(uri, rel) { return fs.existsSync(simTree(rel)); },
  treeMkdirs(uri, rel) { fs.mkdirSync(simTree(rel), { recursive: true }); return true; },
  treeWrite(uri, rel, b64) { const f = simTree(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return true; },
  // שרת הרישוי: אין רשת בסימולציה — כמו מכשיר בלי חיבור
  relayPost(cb) { return { async: cb, value: { error: 'אין רשת בסימולציה' } }; }
};
function simTree(rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (parts.some(p => p === '..' || p.includes('\\'))) throw new Error('נתיב לא תקין');
  return path.join(SAVED, 'folder', ...parts);
}
ipcMain.on('sim-bridge', (e, method, token, ...args) => {
  try {
    if (token !== TOKEN) throw new Error('forbidden');
    const r = B[method](...args);
    if (r && r.async !== undefined) {
      setTimeout(() => e.sender.executeJavaScript(`window.__ssAndroidCb(${r.async}, ${JSON.stringify(JSON.stringify(r.value))})`), 30);
      e.returnValue = JSON.stringify({ r: true });
      return;
    }
    e.returnValue = JSON.stringify({ r: r === undefined ? null : r });
  } catch (err) {
    e.returnValue = JSON.stringify({ e: err.message });
  }
});

protocol.registerSchemesAsPrivileged([]);
app.whenReady().then(async () => {
  protocol.handle('https', serve);
  protocol.handle('http', () => new Response('', { status: 403 }));
  const win = new BrowserWindow({
    width: 412, height: 860, show: !AUTO, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'sim-preload.js'), additionalArguments: AUTO ? ['--ss-sim-auto'] : [], contextIsolation: false, sandbox: false, nodeIntegration: false, offscreen: !!AUTO }
  });
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const lvl = e.level, msg = e.message;
    if (lvl === 'error' || lvl === 3) errors.push(`${msg} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript(`window.__ssSetToken&&window.__ssSetToken(${JSON.stringify(TOKEN)})`));
  await win.loadURL(`https://shell.${DOMAIN}/shell.html`);
  if (!AUTO) return;

  fs.mkdirSync(AUTO, { recursive: true });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const frameOf = mod => win.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith(`https://${mod}.${DOMAIN}`));
  const shot = async name => { await wait(400); fs.writeFileSync(path.join(AUTO, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const report = { steps: [], errors };
  const step = (name, value) => { report.steps.push({ name, value }); console.log('•', name, JSON.stringify(value)); };
  try {
    await wait(800);
    await shot('01-home');
    await js(`document.getElementById('ssMenu').click()`);
    await shot('02-drawer');
    await js(`document.querySelector('.ss-scrim').click()`);

    await js(`window.shellAPI.open('econ', 'dashboard')`);
    await wait(2500);
    const econ = frameOf('econ');
    step('econ frame', !!econ);
    await shot('03-econ-before-login');
    step('econ authStatus', await econ.executeJavaScript(`window.systemAPI.authStatus()`));
    step('econ setup', await econ.executeJavaScript(`window.systemAPI.setupAdmin('admin','סיסמה-חזקה-123').then(()=>'ok',e=>e.message)`));
    step('econ login', await econ.executeJavaScript(`window.systemAPI.login('admin','סיסמה-חזקה-123').then(()=>'ok',e=>e.message)`));
    await econ.executeJavaScript(`location.reload()`);
    await wait(2500);
    await shot('04-econ-dashboard');
    await js(`window.shellAPI.open('econ', 'acct-invoices')`);
    await wait(1500);
    await shot('05-econ-invoices');

    for (const [i, mod] of [['06', 'shamai'], ['07', 'tools']]) {
      await js(`window.shellAPI.open(${JSON.stringify(mod)}, null)`);
      await wait(2500);
      step(mod + ' frame', !!frameOf(mod));
      await shot(`${i}-${mod}`);
    }
    // גיבוי מלא מהמעטפת (מוצפן), ואז בדיקה שהקובץ נפתח עם backupCrypto של שולחן העבודה
    step('shell backup', await js(`window.shellAPI.backupAll('backup-pass-1','all').then(r=>r,e=>e.message)`));
    const BK = require('../../modules/econ/core/backupCrypto');
    const f = fs.readdirSync(SAVED).find(x => x.endsWith('.ssbk'));
    const dec = f ? JSON.parse(BK.decryptBackup(fs.readFileSync(path.join(SAVED, f), 'utf8'), 'backup-pass-1')) : null;
    step('backup decrypts on desktop', !!dec && dec.suite === 'SuperSuite' && Object.keys(dec.localStorage).join(','));
    await js(`window.shellAPI.goHome()`);
    await shot('09-home-after');
  } catch (e) {
    step('FAILED', String(e && e.stack || e));
  }
  fs.writeFileSync(path.join(AUTO, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
