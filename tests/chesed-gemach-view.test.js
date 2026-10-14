// בדיקות התנהגות לתצוגות "גמ"ח" ו"חסד וחלוקות": unified-ui.js רץ ב-vm עם DOM מדומה.
// נבדק מה המשתמש רואה ומה נשלח ל-systemAPI — לא הטקסט של הקוד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

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

async function settle(n = 14) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

async function makeHarness({ calls = [], buttons = {}, responses = {} }) {
  const elements = {};
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return (...args) => {
        calls.push({ name, args });
        if (name in responses) return Promise.resolve(responses[name]);
        if (/^get(Invoices|Products|Chart|Journal|PersonalEntries)$/.test(name)) return Promise.resolve([]);
        return Promise.resolve({});
      };
    }
  });
  const navButtons = VIEWS.map(view => fakeElement('', { dataset: { view } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : (buttons[sel] || []); },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  vm.runInContext(UI_SRC, context, { filename: 'unified-ui.js' });
  await settle();
  return { elements, navButtons, calls };
}

async function goTo(h, view) {
  const i = VIEWS.indexOf(view);
  assert.ok(i >= 0, `התצוגה ${view} קיימת בניווט`);
  h.navButtons[i]._listeners.click[0]();
  await settle();
}

const CHESED = {
  canSeeConfidential: false,
  beneficiaries: [
    { id: 'b1', familyName: 'כהן', headName: 'משה', familySize: 6, area: 'מרכז', tier: 'regular', active: true, masked: false },
    { id: 'b2', familyName: 'משפחה חסויה', familySize: 4, area: 'צפון', tier: 'confidential', active: true, masked: true }
  ],
  volunteers: [
    { id: 'v1', name: 'יצחק', division: 'men', active: true },
    { id: 'v2', name: 'רבקה', division: 'women', active: true }
  ],
  rounds: [{
    id: 'R1', name: 'קמחא דפסחא', date: '2026-03-20', item: 'סל מזון', status: 'open', division: 'men', unitValue: 150,
    allocations: [
      { beneficiaryId: 'b1', units: 2, volunteerId: 'v1', delivered: false, deliveredAt: '' },
      { beneficiaryId: 'b2', units: 1, volunteerId: '', delivered: true, deliveredAt: '2026-03-21' }
    ],
    summary: { families: 2, delivered: 1, unassigned: 1, units: 3, deliveredUnits: 1, totalValue: 450, deliveredValue: 150 }
  }]
};

test('חסד: התצוגה מציגה סבב, נזקק חסוי מוסתר ללא כפתור עריכה, ומאגר מתנדבים לפי מחלקת הסבב', async () => {
  const h = await makeHarness({ responses: { getChesedOverview: CHESED } });
  await goTo(h, 'chesed');
  const html = h.elements.view.innerHTML;
  assert.match(html, /קמחא דפסחא/);
  assert.match(html, /1\/2 נמסרו/);
  assert.match(html, /משפחה חסויה/);
  assert.match(html, /🔒/);
  assert.doesNotMatch(html, /data-chesed-ben-edit="b2"/, 'אין עריכה לנזקק מוסתר');
  assert.match(html, /data-chesed-ben-edit="b1"/);
  assert.match(html, /<option value="v1" selected>יצחק<\/option>/);
  assert.doesNotMatch(html, /<option value="v2"/, 'סבב של מחלקת גברים לא מציע מתנדבת ממחלקת נשים');
  assert.match(html, /1 משפחות עדיין לא שובצו/);
  assert.match(html, /מוסתרים \(מוצגים למנהל בלבד\)/);
});

test('חסד: סימון מסירה ושיבוץ מתנדב נשלחים לשרת עם הסבב והנזקק הנכונים', async () => {
  const deliver = fakeElement('', { dataset: { chesedDeliver: 'R1', ben: 'b1' }, checked: true });
  const assign = fakeElement('', { dataset: { chesedAssign: 'R1', ben: 'b2' }, value: 'v1' });
  const allocate = fakeElement('', { dataset: { chesedAllocate: 'R1' } });
  const h = await makeHarness({
    responses: { getChesedOverview: CHESED, allocateChesedRound: { added: 3 } },
    buttons: { '[data-chesed-deliver]': [deliver], '[data-chesed-assign]': [assign], '[data-chesed-allocate]': [allocate] }
  });
  await goTo(h, 'chesed');
  deliver._listeners.change[0]();
  await settle();
  const d = h.calls.find(c => c.name === 'markChesedDelivered');
  assert.ok(d, 'נשלחה בקשת מסירה');
  assert.deepEqual(d.args.slice(0, 3), ['R1', 'b1', true]);
  assign._listeners.change[0]();
  await settle();
  assert.deepEqual(h.calls.find(c => c.name === 'assignChesedVolunteer').args, ['R1', 'b2', 'v1']);
  allocate._listeners.click[0]();
  await settle();
  assert.deepEqual(h.calls.find(c => c.name === 'allocateChesedRound').args, ['R1']);
});

test('חסד ו-גמ"ח: נתונים חסרים לא מפילים את התצוגה', async () => {
  const h = await makeHarness({ responses: { getChesedOverview: {}, getGemachOverview: {} } });
  await goTo(h, 'chesed');
  assert.match(h.elements.view.innerHTML, /אין סבבי חלוקה/);
  await goTo(h, 'gemach');
  assert.match(h.elements.view.innerHTML, /אין הלוואות עדיין/);
});

const GEMACH = {
  settings: { fundName: 'גמ"ח עזר מציון' },
  overview: { balance: 4000, depositsTotal: 5000, outstandingTotal: 1000, activeLoansCount: 1, lateLoansCount: 1, lateTotal: 250, licenseTier: 'exempt' },
  loans: [{ id: 'L1', borrowerName: 'יוסף לוי', borrowerId: '123456782', amount: 1000, outstanding: 1000, totalPaid: 0, status: 'active', lateCount: 1 }],
  deposits: [{ id: 'D1', date: '2026-01-01', depositorName: 'שמעון', amount: 5000 }]
};

test('גמ"ח: התצוגה מציגה יתרה, פיגור, הלוואה והפקדה; טעינת לוח סילוקין מבקשת את ההלוואה', async () => {
  const load = fakeElement('', { dataset: { gemachLoadSchedule: 'L1' } });
  const h = await makeHarness({
    responses: { getGemachOverview: GEMACH, getGemachLoan: { id: 'L1', schedule: [{ seq: 1, dueDate: '2026-02-01', amountAg: 100000, paidAg: 0, status: 'pending' }], guarantors: [{ name: 'ראובן' }] } },
    buttons: { '[data-gemach-load-schedule]': [load] }
  });
  await goTo(h, 'gemach');
  const html = h.elements.view.innerHTML;
  assert.match(html, /גמ&quot;ח עזר מציון/, 'השם מוצג (ומוגן מפני הזרקת HTML)');
  assert.match(html, /יוסף לוי/);
  assert.match(html, /1 תשלומים בפיגור/);
  assert.match(html, /kpi neg/, 'פיגור מסומן');
  assert.match(html, /שמעון/);
  assert.match(html, /data-gemach-cancel="L1"/, 'הלוואה בלי תשלומים ניתנת לביטול');
  load._listeners.click[0]();
  await settle();
  assert.deepEqual(h.calls.find(c => c.name === 'getGemachLoan').args, ['L1']);
  assert.match(h.elements.view.innerHTML, /ערבים: ראובן/);
  assert.match(h.elements.view.innerHTML, /data-gemach-pay="L1"/);
});


test('עמותה: עמודת דיווח לרשות המסים, כרטיס דיווח והתראות תמיכה; כפתור מסמך שולח סימון', async () => {
  const NPO2 = {
    year: 2026, settings: { orgName: 'עמותת חסד', sec46Number: '1', sec46ValidUntil: '2099-01-01' }, funds: [{ id: 'general', name: 'כללי' }],
    donations: [{ id: 'd1', date: '2026-10-01', donorName: 'משה', amount: 100, method: 'cash', fundId: 'general', status: 'active', receipt: { number: 3, sec46: true }, taxStatus: 'pending' }],
    grants: [{ id: 'g1', year: 2026, source: 'משרד הרווחה', status: 'requested', approved: 1000, received: 0, deadline: '2026-10-20', matchingPercent: 20, documents: [{ name: 'דוח כספי', done: false }] }],
    donors: [], fundSummary: { funds: [], restrictedTotal: 0, generalTotal: 0 }, report: { largeDonors: [] },
    grantAlerts: [{ id: 'g1', source: 'משרד הרווחה', program: '', deadline: '2026-10-20', overdue: false, soon: true, missingDocuments: 1, matchingRequired: 200 }],
    tax: { counts: { pending: 1, 'cancel-pending': 0, reported: 0 }, toReport: 1, missingDonorId: 1 }
  };
  const doc = fakeElement('', { dataset: { npoDoc: 'g1', docIndex: '0' } });
  const h = await makeHarness({ responses: { getNpoOverview: NPO2 }, buttons: { '[data-npo-doc]': [doc] } });
  await goTo(h, 'npo');
  const html = h.elements.view.innerHTML;
  assert.match(html, /data-npo-tax="d1"/);
  assert.match(html, /ממתין לדיווח/);
  assert.match(html, /דיווח ל&quot;תרומות ישראל&quot;|דיווח ל"תרומות ישראל"/);
  assert.match(html, /בלי ת\.ז\/ח\.פ/);
  assert.match(html, /הגשה עד 2026-10-20/);
  assert.match(html, /1 מסמכים חסרים/);
  assert.match(html, /○ דוח כספי/);
  doc._listeners.click[0]();
  await settle();
  assert.deepEqual(h.calls.find(c => c.name === 'toggleNpoGrantDocument').args, ['g1', 0]);
});
