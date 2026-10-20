// שמאות מקצועית — שלב 4 (PLAN.md 9.21): ניתוח רגישות, יומן שומות לקובץ CSV, ומסך צר.
// כל הסכומים באגורות. כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../modules/econ/core/realEstateAppraisal');
const X = require('../modules/econ/core/exports');
const { RealEstateServiceClass } = require('../modules/econ/services/realEstateService');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TODAY = '2026-10-20';

const base = (over = {}) => R.validateCase({
  client: { name: 'משה כהן', idNumber: '123456782' }, purpose: 'mortgage', effectiveDate: '2026-10-01', visitDate: '2026-10-01',
  property: { address: 'רחוב הרב קוק 5', city: 'בני ברק', block: '6123', parcel: '45', subParcel: '7', type: 'apartment', area: '100' },
  comparables: [
    { date: '2026-06-01', price: '2,000,000', area: '100', adjustments: [{ factor: 'time', pct: '2' }] },
    { date: '2026-03-15', price: '2,200,000', area: '110', adjustments: [{ factor: 'condition', pct: '-5' }] },
    { date: '2026-08-10', price: '1,800,000', area: '90', adjustments: [] },
  ],
  income: { enabled: true, monthlyRent: '6,000', vacancyPct: '5', annualExpenses: '4,000', capRatePct: '3' },
  ...over,
}, TODAY);

test('רגישות — גישת ההכנסות: שווי לפי שיעורי היוון סביב השיעור שנבחר', () => {
  const cs = base();
  const r = R.computeCase(cs);
  const sens = r.sensitivity.income;
  assert.deepEqual(sens.map(x => x.capRateBp), [200, 250, 300, 350, 400]);
  const mid = sens.find(x => x.base);
  assert.equal(mid.capRateBp, 300);
  assert.equal(mid.valueAg, r.income.valueAg, 'השורה של השיעור שנבחר = השווי בגישה');
  for (const x of sens) assert.equal(x.valueAg, Math.round(r.income.noiAg * 10000 / x.capRateBp));
  for (let i = 1; i < sens.length; i++) assert.ok(sens[i].valueAg < sens[i - 1].valueAg, 'שיעור גבוה יותר ← שווי נמוך יותר');
  // שיעור נמוך: רק שיעורים חיוביים
  const low = R.computeCase(base({ income: { enabled: true, monthlyRent: '6000', capRatePct: '0.5' } })).sensitivity.income;
  assert.deepEqual(low.map(x => x.capRateBp), [50, 100, 150]);
  // בלי גישת ההכנסות — אין רגישות שלה
  assert.equal(R.computeCase(base({ income: {} })).sensitivity.income, null);
});

test('רגישות — גישת ההשוואה: טווח לפי המחיר המותאם הנמוך, החציון והגבוה', () => {
  const cs = base();
  const r = R.computeCase(cs);
  const s = r.sensitivity.sales;
  assert.equal(s.lowAg, Math.round(r.sales.stats.minAg * r.sales.area));
  assert.equal(s.medianAg, Math.round(r.sales.stats.medianAg * r.sales.area));
  assert.equal(s.highAg, Math.round(r.sales.stats.maxAg * r.sales.area));
  assert.ok(s.lowAg <= r.sales.valueAg && r.sales.valueAg <= s.highAg);
  // עסקה אחת — אין טווח
  const one = R.computeCase(base({ comparables: [base().comparables[0]] }));
  assert.equal(one.sensitivity.sales, null);
});

test('רגישות בדוח: פרק "ניתוח רגישות", עם הערה שאינו חלק מקביעת השווי, ובאנגלית בדוח דו-לשוני', () => {
  const he = R.renderReportHtml(base(), { name: 'יוסף לוי' }, TODAY);
  assert.match(he, /<h2>ניתוח רגישות<\/h2>/);
  assert.match(he, /אינה חלק מקביעת השווי/);
  assert.match(he, /שיעור היוון/);
  assert.doesNotMatch(he, /Sensitivity/);
  const en = R.renderReportHtml({ ...base(), reportLang: 'he-en' }, {}, TODAY);
  assert.match(en, /Sensitivity analysis/);
  // בלי גישת הכנסות ועם עסקה אחת — אין פרק
  const none = R.renderReportHtml(base({ income: {}, comparables: [base().comparables[0]] }), {}, TODAY);
  assert.doesNotMatch(none, /ניתוח רגישות/);
  assert.doesNotMatch(he, /#[0-9a-f]{6}\b/i, 'בלי צבע hex');
});

test('תיק נעול מגרסה קודמת (בלי רגישות בעותק הנעול) — הרגישות מחושבת מהעותק', () => {
  const cs = R.finalizeCase(base(), TODAY);
  delete cs.frozen.sensitivity;
  const html = R.renderReportHtml(cs, {}, TODAY);
  assert.match(html, /ניתוח רגישות/);
  assert.deepEqual(R.sensitivity(cs, cs.frozen).income.map(x => x.capRateBp), [200, 250, 300, 350, 400]);
});

// ----- יומן שומות -----
function memDb(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  return { load: async () => JSON.parse(JSON.stringify(data)), save: async (d) => { data = JSON.parse(JSON.stringify(d)); } };
}
function service() {
  const s = new RealEstateServiceClass(memDb());
  s.today = () => TODAY;
  return s;
}

test('יומן שומות: עמודות בעברית, שווי בשקלים, מצב בעברית, לפי מספר תיק', async () => {
  const s = service();
  const a = await s.createCase({ client: { name: 'אברהם כהן' } });
  await s.updateCase(a.id, { client: { name: 'אברהם כהן' }, property: { address: 'רחוב חזון איש 3', city: 'בני ברק', block: '6200', parcel: '12', area: '80' },
    comparables: [{ date: '2026-07-01', price: '1,600,000', area: '80' }] });
  await s.createCase({ client: { name: '=HYPERLINK("x")' } });
  const d = await s.getRegisterExport();
  assert.equal(d.name, 'יומן-שומות-2026-10-20');
  assert.deepEqual(d.headers, ['מספר דוח', 'מצב', 'המועד הקובע', 'המזמין', 'כתובת', 'גוש', 'חלקה', 'מטרת השומה', 'שווי (₪)', 'עסקאות השוואה', 'אזהרות', 'עדכון אחרון']);
  assert.equal(d.rows.length, 2);
  const [first, second] = d.rows;
  assert.equal(first[1], 'טיוטה');
  assert.equal(first[3], 'אברהם כהן');
  assert.equal(first[4], 'רחוב חזון איש 3, בני ברק');
  assert.equal(first[5], '6200');
  assert.equal(first[8], '1600000.00', 'שווי בשקלים עם שתי ספרות');
  assert.equal(first[9], 1);
  assert.equal(second[8], '', 'בלי שווי — תא ריק');
  // ההגנה מנוסחה ב-Excel נעשית ב-toCsv
  assert.match(X.toCsv(d.headers, d.rows), /'=HYPERLINK/);
});

test('יומן שומות: ערוץ ייצוא בהרשאת ייצוא, נרשם ביומן הפעולות, וכפתור במסך הרשימה', () => {
  const ipc = read('modules/econ/ipc.js');
  const h = ipc.slice(ipc.indexOf("handle('realestate:exportRegister'"));
  assert.ok(ipc.includes("handle('realestate:exportRegister'"));
  assert.match(h.slice(0, 400), /saveCsv\(await realEstateService\.getRegisterExport\(\)\)/);
  assert.match(h.slice(0, 400), /auditEvent\(event, 'realestate\.register\.export'/);
  assert.match(read('modules/econ/preload.js'), /exportRealEstateRegister: \(\) => ipcRenderer\.invoke\('realestate:exportRegister'\)/);

  const ui = read('modules/econ/ui/realestate.js');
  assert.match(ui, /id="reRegister"/);
  assert.match(ui, /on\('reRegister'/);
  assert.match(ui, /api\.exportRealEstateRegister\(\)/);
});

test('מסך: ניתוח רגישות בתוצאות התיק, רק ממחלקות ui-kit', () => {
  const ui = read('modules/econ/ui/realestate.js');
  const fn = ui.slice(ui.indexOf('function reSensitivityHtml('), ui.indexOf('function reEditorHtml('));
  assert.ok(fn.length > 50, 'יש פונקציה לניתוח רגישות במסך');
  assert.match(fn, /ניתוח רגישות/);
  assert.doesNotMatch(fn, /class="(?!ss-)[a-z]/, 'רק מחלקות ss-*');
  assert.match(ui, /reSensitivityHtml\(r\.sensitivity/);
});

test('מסך צר: רשתות לא חורגות מהרוחב, ופריסה בעמודה אחת במסך צר', () => {
  const kit = read('shell/ui-kit.css');
  // רגרסיה: טבלת העסקאות הרחיבה את כל המסך (עמודת grid בגודל התוכן) — הגלילה חייבת להיות בתוך .ss-scroll
  assert.match(kit, /\.ss-stack \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.ok(kit.includes('.ss-grid > *, .ss-form-grid > * { min-width: 0; }'));
  assert.match(kit, /\.ss-grid \{[^}]*minmax\(min\(300px, 100%\), 1fr\)/);
  assert.match(kit, /\.ss-form-grid \{[^}]*minmax\(min\(190px, 100%\), 1fr\)/);
  const m = kit.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'בלוק למסך צר');
  assert.match(m[1], /\.ss-page-head/);
  assert.match(m[1], /\.ss-actions/);
  assert.match(m[1], /\.ss-row/);
  assert.doesNotMatch(m[1], /#[0-9a-f]{3,6}\b/i);
});
