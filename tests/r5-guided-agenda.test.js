// "מה יש לעשות היום" (סבב 5, מצב פשוט): הליבה הטהורה (core/dashboard.js → agenda), הערוצים (לוח הבוקר ומסך הבית),
// לוח הבקרה במודול הכלכלי ומסך הבית של המעטפת — עד 5 פריטים, לכל אחד "לטפל" אחד, ושום דבר לא קורה לבד.
// וגם: כפתור "עזרה" בכל מסך כלכלי, והודעות שגיאה ידידותיות מהשרת.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const MB = require('../modules/econ/core/dashboard');
const HS = require('../modules/econ/core/homeSummary');
const G = require('../modules/econ/core/gemach');
const H = require('./helpers/econ-a11y-harness');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-guided-agenda-'));
test.after(() => { fs.rmSync(DIR, { recursive: true, force: true }); });
const textOf = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
const TODAY = '2026-11-05';

function sampleData() {
  const loan = { id: 'loan-1', borrowerName: 'משה לוי', amount: 1000, installments: 2, issueDate: '2026-08-01', status: 'active', guarantors: [],
    schedule: G.buildSchedule(1000, 2, '2026-08-01') };
  return {
    gemach: { loans: [loan], deposits: [], items: [], lendings: [], applications: [] },
    npo: { donations: [], grants: [], standingOrders: [], memorials: [] },
    invoices: [
      { id: 'i1', number: 1, customer: 'א', date: '2026-01-01', total: 100, status: 'open' },
      { id: 'i2', number: 2, customer: 'ב', date: '2026-11-04', total: 50, status: 'open' },
      { id: 'i3', number: 3, customer: 'ג', date: '2026-01-01', total: 70, status: 'paid' },
    ],
    salesDocs: [],
    settings: {},
  };
}

test('agenda (טהור): פיגור בהלוואה ← "לטפל" פותח את אשף ההחזר עם מזהה ההלוואה; חשבוניות פתוחות ← אשף הקבלה', () => {
  const data = sampleData();
  const brief = MB.morningBrief(data, TODAY, { acct: true });
  const late = brief.items.find(i => i.kind === 'loan-late');
  assert.equal(late.ref, 'loan-1', 'מזהה ההלוואה בפריט');
  const inv = HS.openInvoices(data, TODAY);
  assert.equal(inv.length, 2);
  const a = MB.agenda(brief, { openInvoices: { count: inv.length, late: inv.filter(i => i.late).length } });
  assert.equal(a.total, a.items.length);
  const l = a.items.find(i => i.kind === 'loan-late');
  assert.match(l.text, /^הלוואה שלא הוחזרה בזמן: משה לוי$/);
  assert.equal(l.task, 'loanPayment');
  assert.deepEqual(l.prefill, { name: 'משה לוי' }, 'בחוזה של המעטפת');
  assert.equal(l.ref, 'loan-1');
  assert.ok(require('../shell/tasks').validateTask('loanPayment', l.prefill), 'עובר את validateTask');
  assert.equal(l.view, 'gemach');
  const o = a.items.find(i => i.kind === 'open-invoices');
  assert.equal(o.text, '2 חשבוניות עוד לא שולמו');
  assert.equal(o.detail, 'אחת מהן כבר באיחור');
  assert.equal(o.task, 'receipt');
  assert.equal(o.level, 'urgent');
  // דחוף ראשון
  assert.equal(a.items[0].level, 'urgent');
  // בלי חשבונות ברישיון — אין פריט חשבוניות
  assert.ok(!MB.agenda(brief, {}).items.some(i => i.kind === 'open-invoices'));
});

test('agenda (טהור): עד 5 פריטים, total סופר הכול; ריק — 0; לא משנה את הנתונים', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ kind: 'yahrzeit', level: i % 2 ? 'info' : 'soon', title: 'יארצייט ' + i, detail: '', view: 'npo', count: 1 }));
  const a = MB.agenda({ items });
  assert.equal(a.total, 9);
  assert.equal(a.items.length, MB.AGENDA_MAX);
  assert.equal(MB.AGENDA_MAX, 5);
  assert.ok(a.items.every(i => i.level === 'soon'), 'הדחופים יותר קודם');
  assert.deepEqual(MB.agenda(null), { total: 0, items: [] });
  const data = sampleData();
  const snap = JSON.stringify(data);
  MB.agenda(MB.morningBrief(data, TODAY, { acct: true }), { openInvoices: { count: 1, late: 0 } });
  assert.equal(JSON.stringify(data), snap, 'קריאה בלבד');
  // התרומות לדיווח — במילים פשוטות
  assert.equal(MB.agenda({ items: [{ kind: 'tax-report', level: 'soon', title: 'x', count: 3, view: 'npo' }] }).items[0].text, '3 תרומות שצריך לדווח לרשות המסים');
});

test('הערוצים: לוח הבוקר ומסך הבית מחזירים agenda — רק לתחומים הפתוחים', async () => {
  const h = await H.boot({ real: DIR });
  const api = h.run('window.systemAPI');
  const brief = await api.getMorningBrief();
  assert.ok(brief.agenda && Array.isArray(brief.agenda.items), 'agenda בלוח הבוקר');
  assert.ok(brief.agenda.items.length <= 5);
  for (const it of brief.agenda.items) {
    assert.ok(typeof it.text === 'string' && it.text, 'טקסט');
    assert.ok(h.run(`Object.prototype.hasOwnProperty.call(viewTitles, ${JSON.stringify(it.view)})`), 'מסך קיים: ' + it.view);
    if (it.task) assert.ok(h.run('GUIDED_TASK_IDS').includes(it.task), it.task);
  }
  const ipc = require('../modules/econ/ipc');
  const home = await ipc.shellCall('dashboard:getHomeSummary', 1);
  assert.ok(home.agenda && Number.isInteger(home.agenda.total), 'agenda במסך הבית');
  const src = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  assert.match(src, /out\.agenda = briefWithAgenda\(data, today, sources, open\.acct\)\.agenda/, 'מסך הבית — לפי התחומים הפתוחים');
});

// ---------- לוח הבקרה במודול הכלכלי ----------
const BRIEF = {
  items: [], total: 0, counts: {},
  agenda: { total: 7, items: [
    { kind: 'loan-late', level: 'urgent', text: 'הלוואה שלא הוחזרה בזמן: משה לוי', detail: 'תשלום אחד בפיגור', view: 'gemach', task: 'loanPayment', prefill: { name: 'משה לוי' }, ref: 'loan-1' },
    { kind: 'yahrzeit', level: 'soon', text: 'יארצייט מחר: אברהם', detail: '', view: 'npo' },
  ] },
};
const LOANS = { loans: [{ id: 'loan-1', borrowerName: 'משה לוי', status: 'active', outstanding: 500 }] };

test('לוח הבקרה במצב פשוט: "היום יש N דברים לטפל בהם" בראש המסך, ולכל פריט "לטפל" אחד', async () => {
  const h = await H.boot({ simple: true, api: { getMorningBrief: () => BRIEF, getLicenseStatus: () => ({ mode: 'unlicensed' }), getGemachOverview: () => LOANS } });
  await h.go('dashboard');
  const sec = h.view().querySelector('.agenda');
  assert.ok(sec, 'סדר היום');
  assert.equal(h.view().children[0], sec, 'המסך מתחיל בו');
  assert.equal(textOf(h.doc.getElementById('agendaTitle')), 'היום יש 7 דברים לטפל בהם');
  assert.equal(h.doc.getElementById(sec.getAttribute('aria-labelledby')), h.doc.getElementById('agendaTitle'));
  const btns = sec.querySelectorAll('button[data-agenda]');
  assert.equal(btns.length, 2);
  assert.equal(textOf(btns[0]), 'לטפל');
  assert.equal(btns[0].getAttribute('aria-label'), 'לטפל: הלוואה שלא הוחזרה בזמן: משה לוי');
  assert.match(textOf(sec), /ועוד 5/);
  assert.deepEqual(H.audit(sec, { startLevel: 1 }), []);
  // "לטפל" על פיגור ← אשף ההחזר, עם ההלוואה כבר בחורה — ובלי שמירה
  btns[0].click();
  await h.settle();
  const wiz = h.doc.querySelector('.modal.wiz');
  assert.equal(wiz.getAttribute('data-task'), 'loanPayment');
  assert.equal(h.doc.querySelector('input[name="wizChoice"]:checked').value, 'loan-1');
  assert.equal(h.calls.filter(c => c.name === 'recordGemachPayment').length, 0);
  h.key(h.doc.activeElement, 'Escape'); await h.settle();
  // פריט בלי אשף ← המסך שלו
  h.view().querySelectorAll('button[data-agenda]')[1].click();
  await h.settle();
  assert.equal(h.run('state.currentView'), 'npo');
});

test('לוח הבקרה: בלי פריטים — "אין דברים שמחכים לטיפול"; במצב רגיל — בלי סדר היום (לוח הבוקר הרגיל)', async () => {
  const empty = await H.boot({ simple: true, api: { getMorningBrief: () => ({ items: [], agenda: { total: 0, items: [] } }) } });
  await empty.go('dashboard');
  assert.equal(textOf(empty.doc.getElementById('agendaTitle')), 'היום אין דברים שמחכים לטיפול ✓');
  const normal = await H.boot({ api: { getMorningBrief: () => BRIEF } });
  await normal.go('dashboard');
  assert.equal(normal.view().querySelector('.agenda'), null);
});

// ---------- מסך הבית של המעטפת ----------
function el(id) {
  const attrs = {};
  return {
    id, _l: {}, attrs, hidden: false, open: false, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, isConnected: true,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    focus() {}, blur() {}, select() {}, addEventListener(ev, fn) { this._l[ev] = fn; }, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    showModal() { this.open = true; }, close() { this.open = false; },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
  };
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const flush = () => new Promise(r => setImmediate(r));
function loadShell({ simple = true, admin = true, home, backup = '', startTask } = {}) {
  const D = require('../shell/display');
  const elements = {};
  const calls = { open: [], start: [], backup: 0 };
  const disp = D.sanitize(simple ? { simple: 'on' } : {});
  const shellAPI = {
    getCalendar: async () => ({ shabbatMode: false }), switchTo: async () => true, goHome: async () => {},
    open: async (id, view) => { calls.open.push([id, view]); return true; },
    setOverlay: async () => true, backupAll: async () => { calls.backup++; return { ok: false }; },
    isLoggedIn: async () => true, isAdmin: async () => admin, getBackupTarget: async () => '', getBackupStatus: async () => backup,
    getHomeSummary: async () => home, onActive: () => {}, onCmd: () => {}, onActiveView: () => {},
    getDisplay: async () => disp, saveDisplay: async (x) => x,
    ...(startTask ? { startTask: async (t, p) => { calls.start.push([t, p]); return { ok: true }; }, taskAccess: async () => ['donation', 'receipt', 'expense', 'invoice', 'loanPayment', 'gemachLoan', 'contact'] } : {}),
  };
  const document = {
    getElementById(id) { return (elements[id] ||= el(id)); }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, createElement() { return el('x'); }, body: el('body'), documentElement: el('html'), activeElement: null,
  };
  const store = { 'suite.a11yAsked': 'no' };
  const context = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, Date, Math, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  context.window = context;
  context.shellAPI = shellAPI;
  context.HTMLElement = function () {};
  vm.createContext(context);
  for (const f of ['shell/hebcal.js', 'shell/catalog.js', 'shell/display.js', 'shell/simple-mode.js', 'shell/tasks.js', 'shell/intents.js', 'shell/ss-dialog.js', 'shell/shell.js']) vm.runInContext(read(f), context, { filename: f });
  return { elements, calls, ctx: context };
}
const clickAg = (s, i) => s.elements.agendaList.onclick({ target: { closest: (sel) => (sel === '[data-ag]' ? { dataset: { ag: String(i) } } : null) } });

test('מסך הבית (מעטפת, מצב פשוט): "היום יש N דברים", פריט גיבוי שנכשל למנהל, ו"לטפל" פותח מסך / אשף', async () => {
  const home = { kpis: {}, invoices: [], yahrzeits: [], loans: [], agenda: BRIEF.agenda };
  const s = loadShell({ home, backup: '⚠ יעד הגיבוי לא נמצא (כונן לא מחובר?) (5.11.2026 10:00) · ⚠ טרם נרשם קוד שחזור (🔑)', startTask: true });
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(s.elements.agendaSec.hidden, false);
  assert.equal(s.elements.agendaHead.textContent, 'היום יש 8 דברים לטפל בהם');
  const html = s.elements.agendaList.innerHTML;
  assert.match(html, /הגיבוי האחרון לא הצליח/);
  assert.match(html, /יעד הגיבוי לא נמצא/);
  assert.doesNotMatch(html, /קוד שחזור/, 'רק סטטוס הגיבוי האחרון');
  assert.equal((html.match(/data-ag=/g) || []).length, 3);
  assert.match(html, /aria-label="לטפל: הלוואה שלא הוחזרה בזמן: משה לוי">לטפל</);
  clickAg(s, 0);
  await flush();
  assert.equal(s.calls.backup, 0, 'הגיבוי לא רץ לבד — חלון הסיסמה');
  // משימה עם אשף — במסלול של "מה תרצה לעשות?" (shell:start-task), עם מטען בחוזה של shell/tasks.js
  clickAg(s, 1);
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls.start.pop())), ['loanPayment', { name: 'משה לוי' }]);
  assert.ok(require('../shell/tasks').validateTask('loanPayment', { name: 'משה לוי' }), 'המטען עובר את האימות של main.js');
  clickAg(s, 2);
  assert.deepEqual(s.calls.open.pop(), ['econ', 'npo']);
});

test('מסך הבית: לא מנהל — בלי פריט גיבוי; בלי startTask — רק פתיחת המסך; מצב רגיל — מוסתר', async () => {
  const home = { kpis: {}, agenda: BRIEF.agenda };
  const s = loadShell({ home, admin: false, backup: '⚠ שגיאה בגיבוי (x)' });
  for (let i = 0; i < 6; i++) await flush();
  assert.doesNotMatch(s.elements.agendaList.innerHTML, /הגיבוי/);
  clickAg(s, 0);
  assert.deepEqual(s.calls.open.pop(), ['econ', 'gemach']);
  const normal = loadShell({ home, simple: false });
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(normal.elements.agendaSec.hidden, true);
  const html = read('shell/shell.html');
  assert.match(html, /<section class="agenda-sec ss-simple-only" id="agendaSec" aria-labelledby="agendaHead" hidden>/);
});

// ---------- עזרה בכל מסך ----------
test('כפתור "עזרה" בכל מסך כלכלי: aria-expanded, הסבר VIEW_HELP ו-2–3 פעולות כלחצנים; Escape סוגר ומחזיר מיקוד', async () => {
  const h = await H.boot({ real: DIR });
  const views = Object.keys(h.run('viewTitles'));
  const help = h.run('VIEW_HELP');
  for (const v of views) {
    await h.go(v);
    const btn = h.doc.getElementById('helpBtn');
    assert.equal(btn.getAttribute('aria-controls'), 'helpPanel');
    assert.equal(btn.getAttribute('aria-expanded'), 'false', v);
    btn.click();
    await h.settle();
    const panel = h.doc.getElementById('helpPanel');
    assert.equal(panel.hidden, false, v);
    assert.equal(btn.getAttribute('aria-expanded'), 'true', v);
    assert.ok(help[v], v + ': יש הסבר ב-VIEW_HELP');
    assert.match(textOf(panel), new RegExp(help[v].slice(0, 20).replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')), v);
    assert.equal(h.doc.activeElement, h.doc.getElementById('helpPanelTitle'), v + ': מיקוד בכותרת העזרה');
    const acts = panel.querySelectorAll('[data-help-act]');
    assert.ok(acts.length >= 2 && acts.length <= 3, `${v}: ${acts.length} פעולות`);
    assert.deepEqual(H.audit(panel, { startLevel: 1 }), [], v);
    h.key(h.doc.activeElement, 'Escape');
    await h.settle();
    assert.equal(panel.hidden, true, v + ': Escape');
    assert.equal(h.doc.activeElement, btn, v + ': המיקוד חזר');
  }
  // פעולה מהעזרה: במסך העמותה — האשף
  await h.go('npo');
  h.doc.getElementById('helpBtn').click();
  await h.settle();
  const first = h.doc.getElementById('helpPanel').querySelector('[data-help-act]');
  assert.equal(textOf(first), 'רישום תרומה — צעד אחר צעד');
});

// ---------- שגיאות ידידותיות ----------
test('שגיאות מהשרת שהאשפים והטפסים מגיעים אליהן: מה חסר ואיך מתקנים, בעברית בלבד', async () => {
  const N = require('../modules/econ/core/npo');
  const A = require('../modules/econ/core/accounting');
  const msg = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };
  const cases = [
    msg(() => N.validateDonation({ donorName: '', amount: 10 }, {})),
    msg(() => N.validateDonation({ donorName: 'א', amount: 0 }, {})),
    msg(() => G.validateLoanInput({ borrowerName: '', amount: 100, installments: 1 })),
    msg(() => G.validateLoanInput({ borrowerName: 'א', amount: 0, installments: 1 })),
    msg(() => G.validateLoanInput({ borrowerName: 'א', amount: 100, installments: 0 })),
    msg(() => A.computeInvoice({ items: [{ unitPrice: 'x' }] })),
  ];
  for (const m of cases) {
    assert.ok(m, 'נזרקה שגיאה');
    assert.doesNotMatch(m, /[A-Za-z]{3,}/, 'בלי אנגלית: ' + m);
    assert.match(m, / — /, 'מה חסר — ואיך מתקנים: ' + m);
    assert.match(m, /כתבו|בחרו/, 'הוראה מה לעשות: ' + m);
  }
  assert.match(cases[0], /^חסר שם התורם — ממי התרומה\?/);
  assert.match(cases[1], /^חסר סכום התרומה — כמה נתרם\?/);
  // האשף מציג אותה עם "חזרה לתיקון", בלי קידומת אנגלית של Electron
  const h = await H.boot({ api: { getLicenseStatus: () => ({ mode: 'unlicensed' }), createContact: () => { throw new Error("Error invoking remote method 'contacts:create': Error: חסר שם — איך קוראים לאיש הקשר? כתבו שם."); } } });
  h.run("econStartTask('contact', { name: 'x' })");
  await h.settle();
  for (let i = 0; i < 4; i++) { h.doc.getElementById('wizNext').click(); await h.settle(); }
  assert.equal(textOf(h.doc.getElementById('wizError')), 'לא נשמר — חסר שם — איך קוראים לאיש הקשר? כתבו שם. אפשר ללחוץ "חזרה לתיקון".');
  // תרומה בלי פרטי העמותה — נאמר לפני השאלה הראשונה
  const n = await H.boot({ api: { getLicenseStatus: () => ({ mode: 'unlicensed' }), getNpoOverview: () => ({ settings: {} }) } });
  n.run("econStartTask('donation')");
  await n.settle();
  assert.equal(n.doc.querySelector('.modal.wiz'), null);
  assert.match(textOf(n.doc.getElementById('toastContainer')), /צריך קודם למלא את פרטי העמותה/);
});
