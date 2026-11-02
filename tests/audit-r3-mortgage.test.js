// סקירת קוד 2.11.2026 — מעבדת המשכנתאות ושמאות מקרקעין: גרייס בהשוואת אישורים, שדות של סוג מסלול אחר,
// "שנים" מול termMonths, האופטימייזר, וחותמות זמן UTC שמוצגות כתאריך
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');
const E = require('../modules/econ/core/mixEngine');
const M = require('../modules/econ/core/mortgageAdvisor');
const { uiTrack } = require('../modules/econ/services/mortgageLabService');
const { stampDay } = require('../modules/econ/core/dates');
const RA = require('../modules/econ/core/realEstateAppraisal');

const ctx = { forecast: E.DEMO_FORECAST, asOf: '2026-10-14' };
const origTz = process.env.TZ;
test.before(() => { process.env.TZ = 'Asia/Jerusalem'; });
test.after(() => { if (origTz === undefined) delete process.env.TZ; else process.env.TZ = origTz; });

test('השוואת אישורים: הגרייס נכלל — התוצאה זהה לחישוב הישיר', () => {
  const grace = { type: 'PARTIAL', months: 24 };
  const r = E.compareApprovals([{ id: 'a', lender: 'א', tracks: [{ type: 'FIXED_UNLINKED', share: 1, termMonths: 240, annualRate: 0.05, grace }] }], 1000000, ctx);
  const direct = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 1000000, termMonths: 240, annualRate: 0.05, grace }], ctx);
  const got = r.offers[0].result.summary;
  assert.equal(got.firstPayment, direct.summary.firstPayment);
  assert.equal(got.totalPayments, direct.summary.totalPayments);
  assert.equal(got.firstPayment, 4166.67, 'בגרייס חלקי — ריבית בלבד');
});

test('מסלול מהטופס: שדות של סוג אחר לא נכנסים לחישוב, ו"שנים" גובר על termMonths', () => {
  // ריבית קבועה שנשארה אחרי מעבר למשתנה / לפריים
  const v = uiTrack({ type: 'VARIABLE_UNLINKED', amount: 400000, years: 25, ratePct: 4.9, spreadPct: 0.5, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }, 0);
  assert.equal(v.annualRate, undefined);
  assert.equal(v.spread, 0.005);
  const p = uiTrack({ type: 'PRIME', amount: 400000, years: 25, ratePct: 4.9, spreadPct: -0.5, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }, 0);
  assert.equal(p.annualRate, undefined);
  assert.equal(p.resetEveryMonths, undefined);
  assert.equal(p.anchorKey, undefined);
  assert.doesNotThrow(() => E.calculateMix([p], ctx), 'מסלול פריים מחושב');
  const f = uiTrack({ type: 'FIXED_UNLINKED', amount: 400000, years: 25, ratePct: 4.9, spreadPct: 0.5, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }, 0);
  assert.equal(f.spread, undefined);
  assert.equal(f.annualRate, 0.049);
  // תרחיש שמור שנטען (termMonths 300) ושונה ל-15 שנים
  assert.equal(uiTrack({ type: 'FIXED_UNLINKED', amount: 600000, years: 15, termMonths: 300, ratePct: 4 }, 0).termMonths, 180);
  assert.equal(uiTrack({ type: 'FIXED_UNLINKED', amount: 600000, termMonths: 300, ratePct: 4 }, 0).termMonths, 300, 'בלי שנים — termMonths');
});

test('אישור שנשמר בתיק: שדות של סוג אחר לא נשמרים', () => {
  const a = M.validateApproval({ lender: 'בנק א', tracks: [
    { type: 'VARIABLE_UNLINKED', share: 50, years: 25, ratePct: 4.9, spreadPct: 0.5, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' },
    { type: 'FIXED_UNLINKED', share: 50, years: 25, ratePct: 4.9, spreadPct: 0.5, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }
  ] });
  assert.equal(a.tracks[0].ratePct, undefined);
  assert.equal(a.tracks[0].spreadPct, 0.5);
  assert.equal(a.tracks[0].anchorKey, 'GOV_BOND_5Y');
  assert.deepEqual(Object.keys(a.tracks[1]).sort(), ['ratePct', 'repayment', 'share', 'type', 'years']);
});

// ----- ממשק המעבדה ב-vm עם DOM מינימלי -----
function fakeElement(extra = {}) {
  return Object.assign({
    id: '', textContent: '', value: '', innerHTML: '', type: 'text', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (this._l ||= {})[ev] = fn; },
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, focus() {}, remove() {}
  }, extra);
}

async function labUi() {
  const sel = {};
  const elements = {};
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement({ id })); }, querySelector() { return fakeElement(); },
    querySelectorAll(s) { return sel[s] || []; }, addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const systemAPI = new Proxy({}, { get: (_t, name) => (name === 'authStatus'
    ? () => Promise.resolve({ user: { id: 'u1' }, configured: true }) : () => Promise.resolve({})) });
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r));
  vm.runInContext('renderView = () => {};', context);
  return { context, sel, el: fakeElement, lab: context.labState() };
}

test('ממשק המעבדה: מעבר מקבועה למשתנה מוחק את הריבית הקבועה', async () => {
  const { context, sel, el, lab } = await labUi();
  lab.editors.mix = [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 400000, years: 25, ratePct: 4.9 }];
  sel['[data-ed]'] = [
    el({ dataset: { ed: 'mix', i: '0', f: 'type' }, type: 'select-one', value: 'VARIABLE_UNLINKED' }),
    el({ dataset: { ed: 'mix', i: '0', f: 'years' }, type: 'number', value: '25' })
  ];
  context.labCollect();
  assert.equal(lab.editors.mix[0].type, 'VARIABLE_UNLINKED');
  assert.equal('ratePct' in lab.editors.mix[0], false);
  // אותו דבר באישורים
  lab.approvals[0].tracks = [{ type: 'PRIME', share: 100, years: 25, ratePct: 4.75, spreadPct: -0.4, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }];
  sel['[data-ed]'] = [];
  context.labCollect();
  assert.deepEqual(Object.keys(lab.approvals[0].tracks[0]).sort(), ['share', 'spreadPct', 'type', 'years']);
});

test('ממשק המעבדה: תרחיש שנטען לא מעביר termMonths — "שנים" שבעריכה קובע', async () => {
  const { context, sel, el, lab } = await labUi();
  vm.runInContext(`state.data = { mortgageLab: { scenarios: [{ id: 's1', tracks: [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 600000, years: 25, termMonths: 300, ratePct: 4, spreadPct: null, resetMonths: null, anchorKey: null }] }] } };`, context);
  const btn = el({ dataset: { labLoad: 's1' } });
  sel['[data-lab-load]'] = [btn];
  context.attachLabHandlers();
  btn._l.click();
  const row = lab.editors.mix[0];
  assert.equal('termMonths' in row, false);
  assert.equal('spreadPct' in row, false);
  assert.equal(row.years, 25);
});

test('אופטימייזר: התוצאה מתנקה בשינוי השורות, והתוויות לפי המסלולים שנשלחו', async () => {
  const { context, sel, el, lab } = await labUi();
  lab.results.opt = { evaluated: 1, rejected: 0, candidates: [{ shares: [0.6, 0.4], summary: { firstPayment: 1, maxPayment: 1, totalPayments: 1 }, warnings: [] }], blockTypes: ['PRIME', 'FIXED_LINKED'] };
  // העורך כבר השתנה — התווית נשארת לפי מה שחושב
  lab.editors.opt = [{ type: 'FIXED_UNLINKED' }, { type: 'VARIABLE_LINKED' }];
  const html = context.labTabOpt({}, lab);
  assert.match(html, /פריים 60%/);
  assert.match(html, /קבועה צמודה 40%/);
  const del = el({ dataset: { labDelrow: 'opt', i: '1' } });
  sel['[data-lab-delrow]'] = [del];
  context.attachLabHandlers();
  del._l.click();
  assert.equal(lab.results.opt, null);
});

test('חותמות זמן UTC מוצגות לפי היום המקומי', async () => {
  const late = '2026-10-14T22:30:00.000Z'; // 01:30 ב-15.10 בישראל
  assert.equal(stampDay(late), '2026-10-15');
  assert.equal(stampDay('2026-10-14'), '2026-10-14', 'תאריך יום — כמו שהוא');
  assert.equal(stampDay(''), '');
  const reg = RA.registerExport([{ no: 1, reportNo: '1', status: 'draft', updatedAt: late, comps: 0, warnings: 0 }], '2026-10-15');
  assert.equal(reg.rows[0][11], '2026-10-15');
  const { context } = await labUi();
  assert.equal(context.labStampDay(late), '2026-10-15');
});
