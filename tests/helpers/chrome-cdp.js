// דפדפן Chromium אמיתי לבדיקות נגישות (r4-a11y-shell): מופעל בלי ממשק, בפרופיל זמני, ונשלט דרך
// DevTools Protocol (WebSocket מובנה ב-Node 22) — בלי תלות npm. אם אין דפדפן במחשב — find() מחזיר null
// והבדיקות מדולגות (הבדיקות שבלי דפדפן — ב-tests/r4-a11y-shell.test.js).
//   SS_CHROME=<נתיב> — דפדפן מסוים; SS_CHROME=0 — בלי דפדפן
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
function find() {
  const env = process.env.SS_CHROME;
  if (env === '0') return null;
  if (env) return fs.existsSync(env) ? env : null;
  // ב-Windows (CI) — רק כשמוגדר במפורש
  if (process.platform === 'win32') return null;
  return CANDIDATES.find(p => fs.existsSync(p)) || null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cdp-'));
  const proc = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--lang=he', 'about:blank'],
  { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 300 && !port; i++) {
    try { port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { await wait(100); }
  }
  if (!port) { proc.kill(); throw new Error('chrome did not start'); }
  const close = async () => {
    proc.kill();
    await new Promise(r => (proc.exitCode !== null ? r() : proc.once('exit', r)));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ננקה בפעם הבאה */ }
  };
  return { port, close };
}

// דף חדש: initScript רץ לפני כל סקריפט של העמוד (shellAPI מדומה וכו')
async function page(port, url, { initScript = '', width = 1280, height = 800 } = {}) {
  // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- דפדפן בדיקה מקומי ב-127.0.0.1
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, d => (d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await viewport(width, height);
  if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  const loaded = new Promise(r => { const prev = ws.onmessage; ws.onmessage = (m) => { prev(m); if (JSON.parse(m.data).method === 'Page.loadEventFired') r(); }; });
  await send('Page.navigate', { url });
  await loaded;
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };
  // מקש אמיתי (Tab, Escape, Enter) — עובר במנגנון המיקוד של הדפדפן
  const KEYS = { Tab: 9, Escape: 27, Enter: 13, Space: 32 };
  const key = async (k, mods = 0) => {
    const base = { key: k === 'Space' ? ' ' : k, code: k, windowsVirtualKeyCode: KEYS[k] || 0, modifiers: mods };
    // Enter ורווח מפעילים כפתור רק כשיש להם טקסט
    const text = k === 'Enter' ? '\r' : (k === 'Space' ? ' ' : undefined);
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  return { js, key, viewport, errors, send, close: async () => { try { ws.close(); } catch { /* */ } } };
}

// שרת קבצים מקומי למודול אחד — כמו הפרוטוקול app://<mod>/ ב-main.js: השורש = תיקיית המודול, והקבצים המשותפים
// (design-tokens.css, ui-kit.css, ss-dialog.js, ss-help.js, screen-guard.js) מתיקיית המעטפת
const SHARED = ['/design-tokens.css', '/ui-kit.css', '/ss-dialog.js', '/ss-help.js', '/screen-guard.js'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serve(root, mod) {
  const http = require('http');
  const server = http.createServer((req, res) => {
    let sub = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (sub === '/') sub = '/index.html';
    const base = path.join(root, 'modules', mod);
    const file = SHARED.includes(sub) ? path.join(root, 'shell', sub) : path.normalize(path.join(base, sub));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(c => server.close(c)) })));
}

module.exports = { find, launch, page, wait, serve };
