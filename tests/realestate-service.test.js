// שמאות מקרקעין: השירות (שמירה, ייבוא, נעילה וגרסה מתוקנת), הרישוי, הקטלוג, והמסך (ui/realestate.js ב-vm).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('../modules/econ/core/realEstateAppraisal');
const { RealEstateServiceClass } = require('../modules/econ/services/realEstateService');
const LG = require('../shell/licensing/gate');
const OFFER = require('../shell/licensing/offer');
const catalog = require('../shell/catalog');
const EconUI = require('./helpers/econ-ui');

const ROOT = path.join(__dirname, '..');

function memDb(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  return { load: async () => JSON.parse(JSON.stringify(data)), save: async (d) => { data = JSON.parse(JSON.stringify(d)); }, peek: () => data };
}
function service(db = memDb()) {
  const s = new RealEstateServiceClass(db);
  s.today = () => '2026-10-20';
  return s;
}

const COMPS = [
  { date: '2026-05-10', price: '2,100,000', area: '100', address: 'רחוב הרב קוק 5', source: 'מאגר העסקאות', adjustments: [{ factor: 'time', pct: '2' }] },
  { date: '2026-06-01', price: '2,000,000', area: '95', address: 'רחוב חזון איש 12', source: 'מאגר העסקאות', adjustments: [{ factor: 'floor', pct: '-3' }] },
  { date: '2026-07-15', price: '2,250,000', area: '105', address: 'רחוב רבי עקיבא 40', source: 'מאגר העסקאות' },
];
const FULL = {
  client: { name: 'אברהם כהן', idNumber: '000000018', phone: '050-0000000' },
  purpose: 'mortgage', visitDate: '2026-10-15', effectiveDate: '2026-10-15',
  property: { address: 'רחוב הרב קוק 7', city: 'בני ברק', block: '6123', parcel: '45', subParcel: '12', area: '100', rooms: '4', floor: '3' },
  comparables: COMPS,
};

test('שירות: יצירה, עדכון בשקלים ← אגורות, וחישוב שווי', async () => {
  const s = service();
  const c = await s.createCase({ client: { name: 'אברהם כהן' } });
  assert.equal(c.no, 1);
  assert.equal(c.status, 'draft');
  const r = await s.updateCase(c.id, FULL);
  assert.equal(r.case.comparables[0].priceAg, 210000000);
  assert.equal(r.case.comparables[0].adjustments[0].bp, 200);
  assert.ok(r.case.comparables.every(x => x.id), 'לכל עסקה מזהה');
  assert.equal(r.result.sales.ok, true);
  assert.equal(r.result.final.valueAg, r.result.final.roundedAg);
  assert.equal(r.result.final.valueAg % 100000, 0, 'עיגול ברירת מחדל ל-1,000 ₪');
  assert.deepEqual(r.problems, []);
  const o = await s.getOverview();
  assert.equal(o.cases.length, 1);
  assert.equal(o.cases[0].valueAg, r.result.final.valueAg);
  assert.equal(o.lists.purposes.mortgage, R.PURPOSES.mortgage);
});

test('שירות: קלט שגוי נדחה בעברית ולא נשמר', async () => {
  const db = memDb();
  const s = service(db);
  const c = await s.createCase({});
  await assert.rejects(() => s.updateCase(c.id, { comparables: [{ date: '2026-02-30', price: '100', area: '50' }] }), /תאריך/);
  await assert.rejects(() => s.updateCase(c.id, { client: { idNumber: '123456789' } }), /זהות/);
  assert.equal(db.peek().realEstate.cases[0].comparables.length, 0);
  await assert.rejects(() => s.getCase('אין-כזה'), /התיק לא נמצא/);
});

test('שירות: ייבוא CSV — תצוגה מקדימה בלי שמירה, כפולות לא נכנסות פעמיים', async () => {
  const db = memDb();
  const s = service(db);
  const c = await s.createCase({});
  const csv = 'תאריך עסקה,כתובת,מחיר,שטח\n10/05/2026,רחוב הרב קוק 5,2100000,100\n01/06/2026,רחוב חזון איש 12,2000000,95\nשגוי,—,abc,0\n';
  const pre = await s.importComparables(c.id, csv, { source: 'מאגר' });
  assert.equal(pre.found, 2);
  assert.equal(pre.added, 2);
  assert.equal(pre.errors.length, 1);
  assert.equal(db.peek().realEstate.cases[0].comparables.length, 0, 'תצוגה מקדימה לא שומרת');
  const done = await s.importComparables(c.id, csv, { source: 'מאגר', apply: true });
  assert.equal(done.added, 2);
  assert.equal(db.peek().realEstate.cases[0].comparables.length, 2);
  const again = await s.importComparables(c.id, csv, { apply: true });
  assert.equal(again.duplicates, 2);
  assert.equal(again.added, 0);
  assert.equal(db.peek().realEstate.cases[0].comparables.length, 2);
});

test('שירות: נעילה רק כשהתיק שלם; תיק נעול לא משתנה; גרסה מתוקנת עם סיומת', async () => {
  const s = service();
  const c = await s.createCase({ client: { name: 'אברהם כהן' } });
  await assert.rejects(() => s.finalizeCase(c.id), /גוש וחלקה/);
  const r = await s.updateCase(c.id, FULL);
  const sum = await s.finalizeCase(c.id);
  assert.equal(sum.status, 'final');
  assert.equal(sum.valueAg, r.result.final.valueAg);
  await assert.rejects(() => s.updateCase(c.id, { client: { name: 'אחר' } }), /נעול/);
  await assert.rejects(() => s.importComparables(c.id, 'תאריך,מחיר,שטח\n2026-01-01,1,1'), /נעול/);
  await assert.rejects(() => s.finalizeCase(c.id), /כבר נעול/);
  const html = (await s.getReportHtml(c.id));
  assert.equal(html.final, true);
  assert.match(html.name, /שומה-1$/);
  const re = await s.reopenCase(c.id);
  assert.equal(re.reportNo, '1-1');
  assert.equal(re.status, 'draft');
  const full = await s.getCase(c.id);
  assert.equal(full.case.history.length, 1);
  assert.equal(full.case.history[0].valueAg, r.result.final.valueAg);
});

test('שירות: פרטי השמאי נשמרים מנוקים, ומחיקת תיק', async () => {
  const db = memDb();
  const s = service(db);
  const st = await s.saveSettings({ name: '  יעקב לוי  ', license: '1234', extra: 'x' });
  assert.equal(st.name, 'יעקב לוי');
  assert.equal(st.extra, undefined);
  const c = await s.createCase({});
  await s.deleteCase(c.id);
  assert.equal(db.peek().realEstate.cases.length, 0);
  await assert.rejects(() => s.deleteCase(c.id), /לא נמצא/);
  const c2 = await s.createCase({});
  assert.equal(c2.no, 2, 'מספור התיקים לא חוזר אחורה');
});

test('רישוי, קטלוג ומסד: תחום נפרד econ.realestate', () => {
  assert.equal(LG.ECON_SUB_FEATURES.realestate, 'econ.realestate');
  assert.ok(OFFER.FEATURES.includes('econ.realestate'));
  const without = { mode: 'licensed', status: 'active', features: ['econ'] };
  assert.ok(LG.checkChannel(without, 'realestate:getOverview', 'data.view'), 'בלי התחום — חסום');
  assert.equal(LG.checkChannel({ ...without, features: ['econ', 'econ.realestate'] }, 'realestate:getOverview', 'data.view'), null);
  assert.ok(catalog.ECON_VIEWS.includes('realestate'), 'המסך בקטלוג');
  assert.ok(catalog.GROUPS.find(g => g.id === 'realty').items.some(i => i.view === 'realestate'), 'בתחום משכנתאות ונדל"ן');
  const dbSrc = fs.readFileSync(path.join(ROOT, 'modules/econ/core/database.js'), 'utf8');
  assert.match(dbSrc, /realEstate: \{ cases: \[\], seq: 0, settings: \{\} \}/);
  const ipc = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  for (const ch of ['getOverview', 'getCase', 'createCase', 'updateCase', 'deleteCase', 'importComparables', 'finalizeCase', 'reopenCase', 'saveSettings', 'getReportHtml', 'exportReport']) {
    assert.match(ipc, new RegExp(`handle\\('realestate:${ch}'`), ch);
  }
});

// ----- המסך -----
function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({
    id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, remove() {}, setSelectionRange() {}
  }, extra);
}
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

async function harness(responses) {
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return (...args) => { calls.push({ name, args }); return Promise.resolve(name in responses ? responses[name] : (/^get(Invoices|Products|Chart|Journal|PersonalEntries)$/.test(name) ? [] : {})); };
    }
  });
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  return { context, elements, calls };
}

test('מסך: רשימת תיקים, עורך התיק, וטופס ← שרת בלי איבוד נתונים', async () => {
  const s = service();
  const c = await s.createCase({ client: { name: 'אברהם כהן' } });
  const full = await s.updateCase(c.id, FULL);
  const overview = await s.getOverview();
  const h = await harness({ getRealEstate: overview, getRealEstateCase: full });
  await h.context.switchView('realestate');
  await settle();
  const list = h.elements.view.innerHTML;
  assert.match(list, /תיק שומה חדש/);
  assert.match(list, /אברהם כהן/);
  assert.match(list, new RegExp(`data-re-open="${c.id}"`));
  assert.doesNotMatch(list, /#[0-9a-f]{6}\b/i, 'בלי צבע hex');

  await h.context.reOpenCase(c.id);
  const ed = h.elements.view.innerHTML;
  assert.match(ed, /טבלת התאמות/);
  assert.match(ed, /data-re="comparables\.0\.adj\.time\.pct" value="2"/);
  assert.match(ed, /data-re="comparables\.0\.price" value="2100000"/);
  assert.match(ed, /שווי השומה/);
  assert.match(ed, /נעילת השומה/);

  // הטופס חוזר לשרת ומאומת לאותם ערכים בדיוק
  const back = R.validateCase(JSON.parse(JSON.stringify(h.context.reFromForm(h.context.reToForm(full.case)))), '2026-10-20');
  const strip = (x) => ({ ...x, comparables: x.comparables.map(({ id, ...rest }) => rest) });
  const orig = R.validateCase(full.case, '2026-10-20');
  assert.deepEqual(strip(back), strip(orig));
});

test('מסך: תיק נעול — שדות מושבתים ואין כפתור שמירה', async () => {
  const s = service();
  const c = await s.createCase({});
  await s.updateCase(c.id, FULL);
  await s.finalizeCase(c.id);
  const h = await harness({ getRealEstate: await s.getOverview(), getRealEstateCase: await s.getCase(c.id) });
  await h.context.switchView('realestate');
  await h.context.reOpenCase(c.id);
  const ed = h.elements.view.innerHTML;
  assert.match(ed, /פתיחת גרסה מתוקנת/);
  assert.doesNotMatch(ed, /id="reSave"/);
  assert.match(ed, /data-re="client\.name" value="אברהם כהן" disabled/);
});
