// לוח הבוקר מחובר: ערוץ dashboard:getMorningBrief (דרך handle, הרשאת צפייה, תחומים לפי רישיון)
// ותצוגה במסך הבית של המודול הכלכלי. הנתונים לתצוגה נבנים ב-core/dashboard עצמו — אותה צורה כמו מהשרת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const EconUI = require('./helpers/econ-ui');
const D = require('../modules/econ/core/dashboard');

const handlers = {};
Module._resolveFilename_db = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_db__.js' : Module._resolveFilename_db.call(this, req, ...rest); };
require.cache['/__electron_stub_db__.js'] = { id: '/__electron_stub_db__.js', filename: '/__electron_stub_db__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');

const TODAY = '2026-10-14';
const rounds = (n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, name: 'סבב ' + (i + 1), date: TODAY, status: 'open' }));

test('הערוץ: הרשאת צפייה, ובלי כניסה — חסום', async () => {
  assert.equal(ipc.permissionFor('dashboard:getMorningBrief'), 'data.view');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mb-'));
  const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
  await ipc.initEcon(dir, { licenseStorage: mem(), licenseSecret: mem() });
  const ev = { sender: { id: 41 } };
  await assert.rejects(() => handlers['dashboard:getMorningBrief'](ev));
  await handlers['auth:setup'](ev, 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev, 'menahel', 'menahel-pass-long-1');
  assert.equal((await handlers['dashboard:getMorningBrief'](ev)).total, 0, 'מערכת ריקה — אין פריטים');
  await handlers['chesed:addRound'](ev, { name: 'קמחא דפסחא', date: '2026-04-01' });
  const b = await handlers['dashboard:getMorningBrief'](ev);
  assert.match(b.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(b.items.some(i => i.area === 'chesed' && i.title.includes('קמחא דפסחא') && i.view === 'chesed'));
});

test('הערוץ מסנן לפי התחומים שבקוד הרישוי (gate.peopleSources), לא מחזיר הכל', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  const body = src.slice(src.indexOf("handle('dashboard:getMorningBrief'"), src.indexOf("handle('chesed:getOverview'"));
  assert.match(body, /LG\.peopleSources\(licenseState\(\)\)/);
  // ובליבה: תחום שלא נפתח לא מופיע
  const data = { chesed: { rounds: rounds(1) }, gemach: { applications: [{ id: 'a', status: 'interview' }] } };
  assert.deepEqual(D.morningBrief(data, TODAY, { sources: ['gemach'] }).items.map(i => i.area), ['gemach']);
  assert.equal(D.morningBrief(data, TODAY, { sources: [] }).total, 0);
});

// --- תצוגה ---
function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({
    id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, remove() {}
  }, extra);
}
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

async function dashboard(responses) {
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      if (name === 'onGoto' || name === 'reportView') return undefined;
      return (...args) => {
        calls.push(name);
        if (name in responses) return responses[name] instanceof Error ? Promise.reject(responses[name]) : Promise.resolve(responses[name]);
        return Promise.resolve(/^get(Invoices|Products)$/.test(name) ? [] : null);
      };
    }
  });
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' } };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  return { html: elements.view.innerHTML, calls };
}

test('מסך הבית: פריטי הלוח לפי דחיפות, כל שורה עם כפתור למסך שלה', async () => {
  const data = { chesed: { rounds: rounds(1) }, gemach: { applications: [{ id: 'a', status: 'verified' }] } };
  const { html, calls } = await dashboard({ getMorningBrief: D.morningBrief(data, TODAY) });
  assert.ok(calls.includes('getMorningBrief'));
  assert.match(html, /מה דורש טיפול היום/);
  assert.match(html, /בקשת הלוואה אחת ממתינה/);
  assert.match(html, /סבב חלוקה פתוח: סבב 1/);
  assert.match(html, /data-goto="gemach"/);
  assert.match(html, /data-goto="chesed"/);
  assert.match(html, /✓ אין פריטים דחופים/);
});

test('מסך הבית: יותר משמונה פריטים — השאר מקופלים', async () => {
  const { html } = await dashboard({ getMorningBrief: D.morningBrief({ chesed: { rounds: rounds(11) } }, TODAY) });
  assert.match(html, /ועוד 3 פריטים/);
  assert.equal((html.match(/class="brief-row /g) || []).length, 11, 'כל הפריטים קיימים — חלקם בתוך details');
});

test('מסך הבית: שם עם תגיות מוצג כטקסט', async () => {
  const brief = D.morningBrief({ chesed: { rounds: [{ id: 'x', name: '<img src=x onerror=alert(1)>', status: 'open' }] } }, TODAY);
  const { html } = await dashboard({ getMorningBrief: brief });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('מסך הבית: בלי פריטים, ערוץ חסום ברישיון או תקלה — אין קטע לוח בוקר, והמסך עולה', async () => {
  for (const r of [D.morningBrief({}, TODAY), new Error('התחום אינו כלול ברישיון'), null]) {
    const { html } = await dashboard({ getMorningBrief: r });
    assert.doesNotMatch(html, /מה דורש טיפול היום/);
    assert.match(html, /מודולים נוספים בחבילה/, 'שאר מסך הבית מוצג');
  }
});
