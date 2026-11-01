// צילומי מסך של כל מסכי מודול האימונים — להשוואה לפני ואחרי שינוי במבנה הקוד (PLAN.md 6.2). כלי פיתוח.
// מריץ את התוכנה בפרופיל זמני, יוצר מנהל ומתאמן לדוגמה, ועובר על כל מסך בקטלוג ועל לשוניות המתאמן.
//   node tools/trainer-shots.js <תיקיית פלט>
// בסוף נכתב report.json: טקסט כל מסך ושגיאות JavaScript — להשוואה בין שתי הרצות.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Catalog = require('../shell/catalog');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'trainer-shots'));
const PORT = 9337;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function target(match) {
  for (let i = 0; i < 60; i++) {
    try {
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- כלי צילומי מסך; פרוטוקול הניפוי של Chromium ב-127.0.0.1 בלבד
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find(x => x.type === 'page' && x.url.includes(match));
      if (t) return t;
    } catch { /* עוד לא עלה */ }
    await wait(500);
  }
  throw new Error('לא נמצא: ' + match);
}

function session(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const ready = new Promise(r => { ws.onopen = r; });
  const send = async (method, params = {}) => {
    await ready;
    return new Promise((resolve) => { const n = ++id; pending.set(n, d => resolve(d.result)); ws.send(JSON.stringify({ id: n, method, params })); });
  };
  return {
    errors, send,
    js: async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value,
    shot: async (name) => {
      await wait(700);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    },
    close: () => ws.close(),
  };
}

// לחיצה על כפתור לפי הטקסט שלו (בלי אייקון בתחילתו; מונה בסוף, כמו "מתאמנים1", מותר)
const clickText = (text) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/^[^\\u0590-\\u05FFA-Za-z0-9]+/,'').trim().replace(/\\d+$/,'')===${JSON.stringify(text)});if(b){b.click();return true}return false})()`;
// לשונית בכרטיס המתאמן — רק מחוץ לסרגל (שם יש כפתור באותו שם, למשל "תזונה")
const clickTab = (text) => `(()=>{const b=[...document.querySelectorAll('button')].filter(x=>!x.closest('aside')).find(x=>x.textContent.trim()===${JSON.stringify(text)});if(b){b.click();return true}return false})()`;
const clickMatch = (re) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.textContent));if(b){b.click();return true}return false})()`;

// מצב העיצוב של המסך (PLAN.md 6.4): לכל אלמנט גלוי — הצבעים, המסגרת והמידות, לפי סדר המסמך.
// משווים בין שתי בניות כדי לוודא שהעברת ערכת הצבעים לקוד המקור לא שינתה את המראה
const STYLE_DUMP = `(() => {
  const props = ['color', 'background-color', 'border-top-color', 'border-top-width', 'border-radius', 'box-shadow', 'min-height', 'font-size', 'font-weight', 'opacity'];
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).join('.');
    out.push(el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' :: ' + props.map(p => cs.getPropertyValue(p)).join(' | '));
  }
  return out;
})()`;

const CLIENT = { id: 'c1', name: 'יצחק ברגר', age: 45, gender: 'male', height: 175, weight: 88, level: 'beginner', goal: 'health',
  daysPerWeek: 3, medical: ['knee', 'back'], equipment: ['bw', 'dumbbells', 'bands'], phone: '050-0000000', createdAt: 1760000000000, updatedAt: 1760000000000 };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-trshots-'));
  // הגיבוי האוטומטי של פרופיל זמני — בתוך הפרופיל (ראו CLAUDE.md)
  fs.writeFileSync(path.join(prof, 'backup-settings.json'), JSON.stringify({ targetDir: path.join(prof, 'backups') }));
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const child = spawn(exe, ['.', '--user-data-dir=' + prof, `--remote-debugging-port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
  const report = {};
  try {
    const shell = session(await target('shell.html'));
    await wait(1500);
    await shell.js(`window.shellAPI.open('econ', 'dashboard')`);
    const econ = session(await target('app://econ'));
    await wait(2000);
    await econ.js(`window.systemAPI.setupAdmin('menahel', 'סיסמה-ארוכה-לצילום-2026').then(() => 1)`);
    await wait(800);
    await shell.js(`window.shellAPI.open('trainer')`);
    let tr = session(await target('app://trainer'));
    await wait(2500);
    // פרופיל מאמן ומתאמן אחד — אותם נתונים בכל הרצה
    await tr.js(`localStorage.setItem('trainer:profile', JSON.stringify({ name: 'משה לוי', business: 'סטודיו לדוגמה' }));
      localStorage.setItem('clients:index', JSON.stringify(['c1']));
      localStorage.setItem('client:c1', ${JSON.stringify(JSON.stringify(CLIENT))}); 1`);
    await wait(500);
    await tr.js('location.reload(), 1');
    tr.close();
    tr = session(await target('app://trainer'));
    await tr.send('Runtime.enable');
    await wait(3000);

    const styles = {};
    // השוואה יציבה: בלי מעברי אנימציה (צבע באמצע מעבר) ובלי ריחוף של הסמן האמיתי מעל אלמנט
    await tr.js(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); return 1; })()`);
    const capture = async (name) => {
      await tr.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await wait(900);
      report[name] = await tr.js('document.body.innerText');
      styles[name] = await tr.js(STYLE_DUMP);
      await tr.shot(name);
    };

    // כל מסך בסרגל (מהקטלוג — אותה רשימה שהסרגל האחיד משתמש בה)
    for (const [view, label] of Object.entries(Catalog.TRAINER_LABELS)) {
      const ok = await tr.js(clickText(label));
      if (!ok) { report[view] = '!! לא נמצא כפתור: ' + label; continue; }
      await capture('view-' + view);
    }

    // כרטיס המתאמן: יצירת תוכנית (אקראיות קבועה, כדי שהתוכנית תהיה זהה בין הרצות) וכל לשונית
    await tr.js(clickText('מתאמנים'));
    await wait(800);
    await tr.js(clickText('פתח'));
    await wait(1200);
    await tr.js(`(() => { let a = 1; Math.random = () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; return 1; })()`);
    await tr.js(clickTab('תוכנית אימון'));
    await wait(600);
    await tr.js(clickMatch('/צור תוכנית אוטומטית/'));
    await wait(1200);
    for (const tab of ['סקירה', 'מנוי ותשלומים', 'תוכנית אימון', 'תזונה', 'הערכה', 'התקדמות']) {
      if (!(await tr.js(clickTab(tab)))) { report['client-' + tab] = '!! לא נמצאה לשונית'; continue; }
      await capture('client-' + tab.replace(/\s+/g, '-'));
    }
    await tr.js(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>!x.closest('aside')).find(x=>/^אימונים \\(/.test(x.textContent.trim()));if(b){b.click();return true}return false})()`);
    await capture('client-אימונים');
    report.program = await tr.js(`localStorage.getItem('program:c1')`);
    report.errors = tr.errors;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(styles, null, 2));
    console.log('צולמו', Object.keys(report).length - 2, 'מסכים ←', OUT, '| שגיאות:', tr.errors.length);
    tr.close(); econ.close(); shell.close();
  } finally {
    child.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
