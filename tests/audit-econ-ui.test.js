'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — ממשק המודול הכלכלי (modules/econ/ui):
// מסך הנדל"ן (break חסר), תאריכים מקומיים (תחילת שנה, היום, שם קובץ, יומן ביקורת), ייבוא CSV ב-windows-1255,
// רשומת מע"מ תשומות באגורות, מרוץ ב-switchView, Enter בטופס, חיפוש בהקלטות, שגיאות בעברית ושדה מספרי ריק.
process.env.TZ = 'Asia/Jerusalem'; // לפני כל שימוש בתאריך — בישראל UTC מזיז את היום בין חצות ל-03:00

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');
const A = require('../modules/econ/core/accounting');

const ROOT = path.join(__dirname, '..');
const tick = () => new Promise(r => setImmediate(r));

// שעון מדומה בתוך הממשק: new Date() בלי ארגומנטים = NOW
let NOW = new Date(2026, 0, 1, 1, 30).getTime();
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}

function el(tag = 'div', extra = {}) {
  const listeners = {};
  const node = Object.assign({
    tagName: String(tag).toUpperCase(), textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [],
    disabled: false, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeEventListener() {},
    _listeners: listeners,
    append(...c) { node.children.push(...c); }, appendChild(c) { node.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
  }, extra);
  return node;
}

function load(extra = {}) {
  const created = [];
  const byId = {};
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById(id) { return (byId[id] ||= el('div', { id })); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { const n = el(tag); created.push(n); return n; },
    createTextNode(t) { return { textContent: t }; },
    body: el('body'),
  };
  const context = { console, setTimeout, clearTimeout, setImmediate, Date: FakeDate, Intl, URLSearchParams, TextDecoder, location: { search: '' }, document, ...extra };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  return { context, created, byId, run: (code) => vm.runInContext(code, context) };
}

// ---------- ממצא 7 ----------
test('ממצא 7: מסך "נדל"ן ותיווך" מרנדר את renderRealty ולא נופל לשמאות המקרקעין', () => {
  const { context, byId, run } = load();
  context.renderRealty = () => '<p>REALTY</p>';
  context.renderRealEstate = () => '<p>REALESTATE</p>';
  context.attachViewHandlers = () => {};
  run("renderView('realty')");
  assert.match(byId.view.innerHTML, /REALTY/);
  assert.doesNotMatch(byId.view.innerHTML, /REALESTATE/);
  run("renderView('realestate')");
  assert.match(byId.view.innerHTML, /REALESTATE/);
});

// ---------- ממצאים 8 ו-9 ----------
test('ממצאים 8+9: תחילת השנה והיום — לפי השעון המקומי (1.1 בשעה 01:30 בישראל), גם בלוח הבקרה', async () => {
  assert.equal(new Date(2026, 0, 1).toISOString().slice(0, 10), '2025-12-31', 'הבדיקה רצה באזור זמן ישראל');
  NOW = new Date(2026, 0, 1, 1, 30).getTime();
  const { context, run } = load();
  assert.equal(run('yearStart()'), '2026-01-01');
  assert.equal(run('today()'), '2026-01-01');
  assert.equal(run('JSON.stringify(acctPeriod())'), '{"from":"2026-01-01","to":"2026-01-01"}');
  const ranges = [];
  context.systemAPI = new Proxy({}, { get: (t, k) => (k === 'getAccountingReports' ? (r) => { ranges.push(r); return Promise.resolve(null); } : () => Promise.resolve(null)) });
  await run('loadDashboardData()');
  assert.equal(JSON.stringify(ranges), '[{"from":"2026-01-01","to":"2026-01-01"}]', 'מדדי "מתחילת השנה" — בלי 31.12 של השנה הקודמת');
});

test('ממצא 9: המרת מסמך לחשבונית — הממשק לא שולח תאריך, והשרת קובע את "היום" המקומי', async () => {
  const { context, run } = load();
  const calls = [];
  context.systemAPI = { convertSalesDoc: async (id, to, opts) => { calls.push([id, to, opts]); return { kind: 'invoice', number: 12 }; } };
  context.askConfirm = async () => true;
  context.showToast = () => {};
  context.switchView = async () => {};
  context.showError = (m) => { throw new Error(m); };
  await run("handleConvertDoc('d1', 'invoice')");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].date, undefined);
});

test('רשומה אישית: תאריך ברירת המחדל — היום בפתיחת הטופס, לא היום שבו המסך נטען', async () => {
  NOW = new Date(2026, 9, 20, 12, 0).getTime();
  const { context, run } = load();
  NOW = new Date(2026, 9, 22, 0, 30).getTime(); // יומיים אחר כך, אחרי חצות
  let html = '';
  context.showModal = (title, h) => { html = h; };
  run("state.currentView = 'acct-personal'");
  await run('handleAdd()');
  assert.match(html, /id="f_date" name="date" type="date" value="2026-10-22"/);
});

test('גיבוי ידני: שם הקובץ לפי השעון המקומי, לא UTC', async () => {
  NOW = new Date(2026, 0, 1, 1, 30, 5).getTime();
  const { context, created, run } = load({ URL: { createObjectURL: () => 'blob:1', revokeObjectURL() {} }, Blob });
  const toasts = [];
  context.askFields = async () => ({ pass: 'סיסמה-ארוכה-מאוד-1' });
  context.systemAPI = { backupEncrypted: async () => 'SSBK1:abc' };
  context.showToast = (m) => toasts.push(m);
  context.showError = (m) => { throw new Error(m); };
  run("state.user = { username: 'menahel', role: 'admin', isAdmin: true }");
  await run('handleBackup()');
  const a = created.filter(n => n.tagName === 'A').pop();
  assert.ok(a, 'נוצר קישור הורדה');
  assert.equal(a.download, 'גיבוי-מערכת-כלכלית-2026-01-01-01-30-05.ssbk');
});

test('יומן הביקורת במסך: המועד (נשמר ב-UTC) מוצג לפי השעון המקומי', () => {
  const { run } = load();
  const html = run(`renderSettings({ isAdmin: true, users: [], audit: [{ at: '2026-12-01T22:30:00.000Z', user: 'menahel', action: 'acct.invoice', details: '{}' }] })`);
  assert.match(html, /<td>2026-12-02 00:30<\/td>/);
  assert.doesNotMatch(html, /2026-12-01 22:30/);
});

// ---------- ממצא 20 ----------
const CP1255 = Buffer.from([0xF9, 0xED, 0x2C, 0xE8, 0xEC, 0xF4, 0xE5, 0xEF]); // "שם,טלפון" ב-windows-1255
const UTF8_BOM = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('שם,טלפון', 'utf8')]);
const fileOf = (buf) => ({ size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

async function pick(env, code, buf) {
  const p = env.run(code);
  const input = env.created.filter(n => n.tagName === 'INPUT').pop();
  input.files = [fileOf(buf)];
  await input._listeners.change[0]();
  return p;
}

test('ממצא 20: ייבוא CSV / vCard / עסקאות השוואה — קובץ Excel בעברית (windows-1255) מפוענח, ו-UTF-8 עם BOM נשאר תקין', async () => {
  const env = load();
  assert.equal(await pick(env, "pickFileText('.csv,text/csv')", CP1255), 'שם,טלפון');
  assert.equal(await pick(env, "pickFileText('.vcf,text/vcard')", UTF8_BOM), 'שם,טלפון');
  assert.equal(await pick(env, 'pickCsvAnyEncoding()', CP1255), 'שם,טלפון');
});

test('ממצא 20: ייבוא מחירון מ-CSV — אותו זיהוי קידוד', async () => {
  const env = load();
  const sent = [];
  env.context.systemAPI = { importProducts: async (text) => { sent.push(text); return { added: 1, errors: [] }; } };
  env.context.showToast = () => {};
  env.context.switchView = async () => {};
  env.context.showError = (m) => { throw new Error(m); };
  await pick(env, 'handleImportCsv()', CP1255);
  await tick();
  assert.deepEqual(sent, ['שם,טלפון']);
});

// ---------- מע"מ תשומות באגורות ----------
test('רשומת יומן עם מע"מ תשומות: 100.005 + 18.005 — רשומה מאוזנת באגורות (השרת מקבל אותה)', async () => {
  const { context, run } = load();
  const entries = [];
  context.systemAPI = { createEntry: async (e) => { entries.push(JSON.parse(JSON.stringify(e))); return { id: 'e1' }; } };
  const accounts = [{ code: '6100' }, { code: '1300' }, { code: '1000' }];
  await run(`formSchemas['acct-journal'].create({ date: '2026-10-20', description: 'ספרי קודש', debitAccount: '6100', creditAccount: '1000', amount: 100.005, inputVat: 18.005 })`);
  const v = A.validateEntry(entries[0], accounts);
  assert.equal(v.total, 118.02);
  assert.deepEqual(v.lines.map(l => [l.account, l.debit, l.credit]), [['6100', 100.01, 0], ['1300', 18.01, 0], ['1000', 0, 118.02]]);
  await run(`formSchemas['acct-journal'].create({ date: '2026-10-20', description: 'נייר', debitAccount: '6100', creditAccount: '1000', amount: 50.005 })`);
  assert.equal(A.validateEntry(entries[1], accounts).total, 50.01);
});

// ---------- מרוץ ב-switchView ----------
test('switchView: טעינה איטית של מסך קודם לא מתרנדרת מעל מסך שנפתח אחריה; שגיאה — בעברית', async () => {
  const { context, run } = load();
  const rendered = [];
  const errors = [];
  let slow;
  context.loadViewData = (v) => (v === 'tasks' ? new Promise((res, rej) => { slow = { res, rej }; }) : Promise.resolve());
  context.renderView = (v) => rendered.push(v);
  context.showError = (m) => errors.push(m);
  context.systemAPI = {};
  const first = run("switchView('tasks')");
  await run("switchView('contacts')");
  slow.res();
  await first;
  assert.deepEqual(rendered, ['contacts']);
  assert.equal(run('state.currentView'), 'contacts');
  const second = run("switchView('tasks')");
  await run("switchView('contacts')");
  slow.rej(new Error('נכשל'));
  await second;
  assert.deepEqual(errors, [], 'כשל מאוחר של מסך קודם — בלי הודעה מעל המסך החדש');
  context.loadViewData = () => Promise.reject(new Error("Error invoking remote method 'tasks:get': Error: אין הרשאה לפעולה"));
  await run("switchView('tasks')");
  assert.deepEqual(errors, ['שגיאה בטעינת התצוגה: אין הרשאה לפעולה']);
});

// ---------- Enter בטופס ----------
test('Enter בטופס עם שדה אחד: ה-CSP חוסם שליחת טופס, והטופס הראשי לא נשלח (בלי רענון המודול)', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  assert.match(csp, /form-action 'none'/);
  const { context, byId, run } = load();
  const errors = [];
  context.systemAPI = { authStatus: async () => ({ user: { username: 'menahel' }, configured: true }), getAdvancedSettings: async () => ({}) };
  context.switchView = async () => {};
  context.showToast = () => {};
  context.showError = (m) => errors.push(m);
  await run('init()');
  assert.deepEqual(errors, []);
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  const submit = byId.modalForm._listeners.submit || [];
  assert.ok(submit.length >= 1, 'יש מאזין submit לטופס הראשי');
  for (const fn of submit) fn(ev);
  assert.equal(ev.prevented, true);
});

// ---------- חיפוש בהקלטות ----------
test('חיפוש בהערות הקוליות: התוצאות נכתבות למפתח שממנו המסך קורא, ומוצגות', async () => {
  const { context, byId, run } = load();
  context.systemAPI = { searchVoiceNotes: async () => [{ id: 'n1', title: 'שיעור בגמרא', description: '', notes: '', tags: [], duration: 60, recordedAt: '2026-10-20' }] };
  context.attachViewHandlers = () => {};
  run("state.currentView = 'voice-notes'; state.data.voiceNotes = { notes: [] }");
  await run("performSearch('גמרא')");
  assert.equal(run('state.data.voiceNotes.notes.length'), 1);
  assert.equal(run("state.data['voice-notes']"), undefined);
  assert.match(byId.view.innerHTML, /שיעור בגמרא/);
});

test('חיפוש בהערות הקוליות: תוצאה שחזרה אחרי מעבר לאנשי קשר / אחרי חיפוש חדש יותר — לא נכתבת ולא מוצגת', async () => {
  const { context, run } = load();
  const pending = [];
  const rendered = [];
  const errors = [];
  context.systemAPI = { searchVoiceNotes: (q) => new Promise((res, rej) => pending.push({ q, res, rej })) };
  context.loadViewData = () => Promise.resolve();
  context.renderView = (v) => rendered.push(v);
  context.showError = (m) => errors.push(m);
  const note = (title) => [{ id: title, title, description: '', notes: '', tags: [], duration: 60, recordedAt: '2026-10-20' }];
  run("state.currentView = 'voice-notes'; state.data.voiceNotes = { notes: [] }; state.data.contacts = { contacts: [{ id: 'c1', name: 'משה כהן' }] }");

  // מעבר מסך בזמן החיפוש
  const search = run("performSearch('גמרא')");
  await run("switchView('contacts')");
  pending[0].res(note('שיעור בגמרא'));
  await search;
  assert.deepEqual(JSON.parse(run('JSON.stringify(state.data.contacts)')), { contacts: [{ id: 'c1', name: 'משה כהן' }] });
  assert.equal(run('state.data.voiceNotes.notes.length'), 0);
  assert.deepEqual(rendered, ['contacts']);

  // כשל מאוחר אחרי מעבר מסך — בלי הודעה מעל המסך החדש
  run("state.currentView = 'voice-notes'");
  const failing = run("performSearch('משנה')");
  await run("switchView('contacts')");
  pending[1].rej(new Error('נכשל'));
  await failing;
  assert.deepEqual(errors, []);

  // שני חיפושים: הישן חוזר אחרון — התוצאה של החדש נשארת
  run("state.currentView = 'voice-notes'");
  rendered.length = 0;
  const older = run("performSearch('גמ')");
  const newer = run("performSearch('גמרא')");
  pending[3].res(note('שיעור בגמרא'));
  await newer;
  pending[2].res(note('ישן'));
  await older;
  assert.deepEqual(JSON.parse(run('JSON.stringify(state.data.voiceNotes.notes.map(n => n.title))')), ['שיעור בגמרא']);
  assert.deepEqual(rendered, ['voice-notes']);
});

// ---------- שגיאות בעברית ----------
test('שמירה / מחיקה / חיפוש / יציאה: הודעת השגיאה בלי הקידומת האנגלית של Electron', async () => {
  const { context, run } = load();
  const errors = [];
  context.showError = (m) => errors.push(m);
  context.askConfirm = async () => true;
  context.showToast = () => {};
  context.switchView = async () => {};
  run(`var remoteErr = (m) => new Error("Error invoking remote method 'x:y': Error: " + m);
    formSchemas.__t = { title: 'בדיקה', fields: [], create: async () => { throw remoteErr('השמירה נכשלה'); },
      remove: async () => { throw remoteErr('אין הרשאה'); }, search: async () => { throw remoteErr('החיפוש נכשל'); } };
    state.currentView = '__t'; state.user = { username: 'menahel' };`);
  context.systemAPI = { logout: () => vm.runInContext("Promise.reject(remoteErr('היציאה נכשלה'))", context) };
  await run('handleSubmit()');
  await run("handleDelete('1')");
  await run("performSearch('תורה')");
  await run('handleUser()');
  assert.deepEqual(errors, ['שגיאה בשמירה: השמירה נכשלה', 'שגיאה במחיקה: אין הרשאה', 'שגיאה בחיפוש: החיפוש נכשל', 'שגיאה בניהול משתמש: היציאה נכשלה']);
});

// ---------- שדה מספרי ריק ----------
const fakeDialog = (build) => new Promise((resolve) => build(el('div'), resolve));

test('הגדרות דוחות לעסק: תנאי תשלום ריק לא נשמר כ-0', async () => {
  const { context, created, run } = load();
  const saved = [];
  context.systemAPI = { saveBizSettings: async (v) => { saved.push(v); } };
  context.showToast = () => {};
  context.openDialog = fakeDialog;
  run("state.data.bizReports = { settings: { paymentTermsDays: 30, period: 'monthly', advanceRateBp: 250 } }");
  const p = run('handleBizSettings()');
  const form = created.find(n => n.tagName === 'FORM');
  const days = created.filter(n => n.tagName === 'INPUT')[0];
  assert.equal(days.value, '30');
  days.value = '';
  form._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(saved.length, 0, 'שדה ריק — לא נשמר');
  assert.ok(created.some(n => n.tagName === 'DIV' && /תנאי תשלום/.test(n.textContent)), 'הודעה ליד השדה');
  days.value = '45';
  form._listeners.submit[0]({ preventDefault() {} });
  await p;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].paymentTermsDays, 45);
});

test('licForm: שדה מספרי ריק (גם כשאינו חובה) נדחה ולא הופך ל-0', async () => {
  const { context, created, run } = load();
  context.openDialog = fakeDialog;
  let result = 'pending';
  run("licForm('תנאים', [{ name: 'graceDays', label: 'ימי חסד', type: 'number', min: 0, max: 90, value: 7 }], 'שמירה')").then(v => { result = v; });
  const form = created.find(n => n.tagName === 'FORM');
  const input = created.filter(n => n.tagName === 'INPUT')[0];
  input.value = '';
  form._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(result, 'pending');
  assert.ok(created.some(n => n.tagName === 'DIV' && /ימי חסד: מספר שלם/.test(n.textContent)));
  input.value = '0';
  form._listeners.submit[0]({ preventDefault() {} });
  await tick();
  assert.equal(JSON.stringify(result), '{"graceDays":0}', 'אפס שהוקלד — תקין');
});

test('עורך התכניות: מחיר ריק לא יוצר תכנית חינם; מחיר שהוקלד — באגורות', async () => {
  const { context, created, run } = load();
  context.openDialog = fakeDialog;
  context.__cur = { seller: { name: 'ספק', taxId: '' }, terms: { version: '1.0', title: 'תקנון', text: 'נוסח' },
    plans: [{ id: 'basic', name: 'בסיסי', priceAgorot: 4900, months: 12, features: ['econ'], limits: { maxUsers: 3, maxChildren: 0 } }] };
  let result = 'pending';
  run('offerEditor(__cur)').then(v => { result = v; });
  const priceInputs = () => created.filter(n => n.tagName === 'LABEL' && n.children[0] && /^מחיר/.test(n.children[0].textContent)).map(l => l.children[1]);
  const button = (text) => created.filter(n => n.tagName === 'BUTTON' && n.textContent === text).pop();
  const errDiv = () => created.filter(n => n.tagName === 'DIV' && n.className === 'bad').pop();
  assert.equal(String(priceInputs().pop().value), '49');
  priceInputs().pop().value = '';
  // הוספת תכנית מרנדרת מחדש — המחיר הריק נשאר ריק ולא הופך ל-0
  button('＋ תכנית נוספת').onclick();
  const afterAdd = priceInputs();
  assert.equal(String(afterAdd[afterAdd.length - 2].value), '', 'תכנית 1 — עדיין ריק');
  button('חתימה ושמירה').onclick();
  await tick();
  assert.equal(result, 'pending', 'לא נשמר');
  assert.match(errDiv().textContent, /תכנית 1: יש להקליד מחיר/);
  const prices = priceInputs();
  prices[prices.length - 2].value = '49.90';
  created.filter(n => n.tagName === 'LABEL' && n.children[0] && n.children[0].textContent === 'שם').pop().children[1].value = 'מורחב';
  button('חתימה ושמירה').onclick();
  await tick();
  assert.notEqual(result, 'pending');
  assert.deepEqual(result.plans.map(p => p.priceAgorot), [4990, 0]);
});

// מרכז הרישוי: לכל תכנית "תוכנה / חבילה", ותחומים לכל תוכנה בהיקף — לפי הקטלוג (shell/licensing/products.js)
test('עורך התכניות: חבילת לימוד — תחומים לכל תוכנה בחבילה; תכנית ישנה נשמרת כתכנית של SuperSuite', async () => {
  const { context, created, run } = load();
  context.openDialog = fakeDialog;
  context.__cat = require('../shell/licensing/products').catalog();
  context.__cur = { seller: { name: 'ספק', taxId: '' }, terms: { version: '1.0', title: 'תקנון', text: 'נוסח' },
    plans: [{ id: 'basic', name: 'בסיסי', priceAgorot: 4900, months: 12, features: ['econ'], limits: { maxUsers: 3, maxChildren: 0 } }] };
  let result = 'pending';
  run('offerEditor(__cur, __cat)').then(v => { result = v; });
  const selects = () => created.filter(n => n.tagName === 'SELECT');
  const boxes = (pid) => created.filter(n => n.tagName === 'INPUT' && n.type === 'checkbox' && n.dataset.product === pid);
  const button = (text) => created.filter(n => n.tagName === 'BUTTON' && n.textContent === text).pop();
  assert.equal(selects().pop().value, 'supersuite');
  button('＋ תכנית נוספת').onclick();
  const sel = selects().pop();
  sel.value = 'family:learn';
  sel.onchange();
  // אחרי הציור מחדש: לכל אחת משלוש התוכנות בחבילה — התחומים שלה בלבד
  const learnBoxes = boxes('learn').slice(-9);
  assert.ok(learnBoxes.some(c => c.value === 'english'));
  assert.ok(!boxes('shir-studio').slice(-1).some(c => c.value === 'econ'));
  for (const c of learnBoxes) if (c.value === 'econ' || c.value === 'math') c.checked = true;
  boxes('shir-studio').pop().checked = true;
  boxes('vidlearn').pop().checked = true;
  created.filter(n => n.tagName === 'LABEL' && n.children[0] && n.children[0].textContent === 'שם').pop().children[1].value = 'חבילת לימוד';
  button('חתימה ושמירה').onclick();
  await tick();
  assert.notEqual(result, 'pending');
  assert.equal(result.plans[0].scope, 'supersuite');
  assert.deepEqual(JSON.parse(JSON.stringify(result.plans[0].features)), { supersuite: ['econ'] });
  assert.equal(result.plans[1].scope, 'family:learn');
  assert.deepEqual(JSON.parse(JSON.stringify(result.plans[1].features)), { learn: ['econ', 'math'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] });
  // מה שהמסך מחזיר — עובר את הבדיקה בשרת (הצעה ראשית)
  const OF = require('../shell/licensing/offer');
  const m = OF.cleanMaster({ ...JSON.parse(JSON.stringify(result)), terms: { version: '1.0', text: 'נוסח התקנון המלא לבדיקה, ארוך מספיק כדי לעבור את הבדיקה של אורך מינימלי.' } });
  assert.deepEqual(m.plans[1].products, ['learn', 'shir-studio', 'vidlearn']);
});

// גם בשרת: ערוץ שנקרא שלא דרך הממשק לא הופך שדה ריק ל-0
test('בשרת: מחיר חסר בתכנית (null / \'\' / NaN אחרי JSON) נדחה; 0 שהוקלד — תקין', () => {
  const L = require('../shell/licensing/license');
  const OF = require('../shell/licensing/offer');
  const root = L.generateKeyPair();
  const offer = (priceAgorot) => ({ seller: { name: 'ספק' }, terms: { version: '1.0', title: 'תקנון', text: 'תקנון השימוש במערכת. התשלום מראש לתקופה שנבחרה.\n'.repeat(4) },
    plans: [{ id: 'basic', name: 'בסיסי', priceAgorot, months: 12, features: ['econ'] }] });
  for (const bad of [null, undefined, '', '  ', JSON.parse(JSON.stringify({ v: NaN })).v, false, []]) {
    assert.throws(() => OF.createOffer(root.privateJwk, offer(bad)), /המחיר בתכנית "בסיסי" אינו תקין/, JSON.stringify(bad));
  }
  const ok = (price) => JSON.parse(OF.createOffer(root.privateJwk, offer(price))).payload.plans[0].priceAgorot;
  assert.equal(ok(0), 0);
  assert.equal(ok('4990'), 4990);
  // הצעה חתומה קיימת (מחיר מספרי) עדיין מאומתת
  assert.equal(OF.verifyOffer(OF.createOffer(root.privateJwk, offer(4990)), [root.publicJwk]).plans[0].priceAgorot, 4990);
});

test('בשרת: תנאי תשלום ריקים (\'\' / null / חסר) נדחים ולא נשמרים כ-0 ימים', () => {
  const BZ = require('../modules/econ/core/bizReports');
  const base = { period: 'monthly', advanceRatePct: '2.5' };
  for (const bad of ['', '  ', null, undefined, false]) {
    assert.throws(() => BZ.validateSettings({ ...base, paymentTermsDays: bad }), /בין 0 ל-365/, JSON.stringify(bad));
  }
  assert.equal(BZ.validateSettings({ ...base, paymentTermsDays: 0 }).paymentTermsDays, 0);
  assert.equal(BZ.validateSettings({ ...base, paymentTermsDays: '45' }).paymentTermsDays, 45);
});

// ---------- ייצוא יומן הביקורת (ipc.js) ----------
test('ייצוא יומן הביקורת: המועדים ושם הקובץ לפי השעון המקומי', async () => {
  const Module = require('module');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-econ-ui-'));
  test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* קובץ נעול ב-Windows */ } });
  const handlers = {};
  const saves = [];
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_ui__.js' : orig.call(this, req, ...rest); };
  require.cache['/__electron_stub_audit_ui__.js'] = {
    id: '/__electron_stub_audit_ui__.js', filename: '/__electron_stub_audit_ui__.js', loaded: true,
    exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
      dialog: { showSaveDialog: async (o) => { saves.push(o.defaultPath); return { canceled: false, filePath: path.join(tmp, 'audit.csv') }; } } }
  };
  const ipc = require('../modules/econ/ipc');
  const ev = { sender: { id: 7301 } };
  await ipc.initEcon(path.join(tmp, 'data'), { relayUrl: '' });
  await handlers['auth:setup'](ev, 'menahel_audit', 'audit-strong-pass-2026');
  await handlers['auth:login'](ev, 'menahel_audit', 'audit-strong-pass-2026');
  await handlers['users:create'](ev, { username: 'yaakov_audit', password: 'yaakov-strong-pass-2026', role: 'viewer' });
  const list = await handlers['audit:list'](ev, {});
  assert.ok(list.length >= 1, 'יש אירועים ביומן');
  const r = await handlers['audit:export'](ev, {});
  assert.equal(r.ok, true);
  const pad = (n) => String(n).padStart(2, '0');
  const local = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const now = new Date();
  assert.equal(saves[0], `יומן-ביקורת-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`);
  const csv = fs.readFileSync(path.join(tmp, 'audit.csv'), 'utf8');
  for (const row of list) assert.ok(csv.includes(local(row.at)), `מועד מקומי בקובץ: ${local(row.at)}`);
  assert.doesNotMatch(csv, /\d{4}-\d\d-\d\dT\d\d:\d\d/, 'בלי מועד UTC גולמי');
});
