// צילומי מסך למדריך המשתמש (PLAN.md 1.6) — כלי פיתוח, לא נארז בתוכנה.
// מריץ את התוכנה מהקוד בפרופיל זמני (רק בפיתוח — בהפצה פרמטר דיבוג מסרב לעלות), מפעיל אותה דרך
// DevTools Protocol (WebSocket מובנה ב-Node) ושומר את הצילומים ב-shell/guide/img.
//   node tools/guide-shots.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shell', 'guide', 'img');
const PORT = 9333;
const PASS = 'סיסמה-לדוגמה-2026';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function targets() {
  // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- כלי צילומי מסך; פרוטוקול הניפוי של Chromium ב-127.0.0.1 בלבד
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}
async function target(match) {
  for (let i = 0; i < 60; i++) {
    try { const t = (await targets()).find(x => x.type === 'page' && x.url.includes(match)); if (t) return t; } catch { /* עוד לא עלה */ }
    await wait(500);
  }
  throw new Error('לא נמצא: ' + match);
}

function session(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const ready = new Promise(r => { ws.onopen = r; });
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (d) => (d.error ? reject(new Error(d.error.message)) : resolve(d.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  };
  return {
    js: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(expr + ': ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
      return r.result.value;
    },
    shot: async (name) => {
      await wait(500);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('•', name);
    },
    close: () => ws.close(),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-guide-'));
  // הגיבוי האוטומטי של פרופיל זמני — בתוך הפרופיל, לא בתיקיית המסמכים האמיתית (ראו CLAUDE.md)
  fs.writeFileSync(path.join(prof, 'backup-settings.json'), JSON.stringify({ targetDir: path.join(prof, 'backups') }));
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const child = spawn(exe, ['.', '--user-data-dir=' + prof, `--remote-debugging-port=${PORT}`, '--lang=he'], { cwd: ROOT, stdio: 'ignore' });
  try {
    const shell = session(await target('shell.html'));
    await wait(1500);
    await shell.js(`window.resizeTo && 0`);
    await shell.shot('01-home');

    await shell.js(`window.shellAPI.open('econ', 'dashboard')`);
    const econ = session(await target('econ'));
    await wait(2000);
    await econ.shot('02-first-admin');
    await econ.js(`window.systemAPI.setupAdmin('menahel', ${JSON.stringify(PASS)}).then(() => 1)`);
    await econ.js(`location.reload(), 1`);
    await wait(2500);
    await econ.shot('03-sample-offer');

    await econ.js(`window.systemAPI.saveNpoSettings({ orgName: 'עמותת חסד לדוגמה', regNumber: '580000000' }).then(() => 1)`);
    await econ.js(`window.systemAPI.addSampleData(['npo']).then(() => 1)`);
    await econ.js(`switchView('npo').then(() => 1)`);
    await wait(1200);
    await econ.shot('04-npo');
    await econ.js(`handleAdd(), 1`);
    await wait(800);
    await econ.shot('05-donation-form');
    await econ.js(`closeModal(), 1`);

    await shell.js(`window.shellAPI.goHome().then(() => 1)`);
    await wait(800);
    await shell.js(`document.getElementById('bk').click(), 1`);
    await wait(800);
    await shell.shot('06-backup');
    await shell.js(`document.querySelectorAll('dialog[open]').forEach(d => d.close()), 1`);
    await shell.js(`document.getElementById('hp').click(), 1`);
    await wait(600);
    await shell.shot('07-help');
    shell.close(); econ.close();
  } finally {
    child.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
