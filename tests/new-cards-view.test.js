// רינדור הכרטיסים החדשים (קמפיינים, הנצחות, ייבוא, מאגר אנשים, פרטיות, הרחבות גמ"ח) ב-vm עם DOM מדומה.
// הנתונים נבנים בפונקציות הליבה עצמן — כך שצורת הנתונים זהה למה שהשרת מחזיר בפועל.
const test = require('node:test');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CMP = require('../modules/econ/core/campaigns');
const MEM = require('../modules/econ/core/memorials');
const P = require('../modules/econ/core/people');
const PR = require('../modules/econ/core/privacy');
const GX = require('../modules/econ/core/gemachExtra');

const ROOT = path.join(__dirname, '..');
const UI_SRC = EconUI.source();
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
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

async function render(view, responses) {
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return (...args) => { calls.push({ name, args }); return Promise.resolve(name in responses ? responses[name] : (/^get(Invoices|Products|Chart|Journal|PersonalEntries)$/.test(name) ? [] : {})); };
    }
  });
  const navButtons = VIEWS.map(v => fakeElement('', { dataset: { view: v } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  const i = VIEWS.indexOf(view);
  assert.ok(i >= 0, 'התצוגה קיימת: ' + view);
  navButtons[i]._listeners.click[0]();
  await settle();
  return { html: elements.view.innerHTML, calls };
}

const TODAY = '2026-10-14';
const campaign = { id: 'c1', ...CMP.validateCampaign({ name: 'בניין בית המדרש', goal: 10000, startDate: '2026-10-01', endDate: '2026-10-31', matchDonor: 'קרן ברגר', matchRatio: 1, matchCap: 2000, ambassadorsText: 'יוסי, Y1, 3000' }, { newId: () => 'a1' }) };
const donations = [
  { id: 'd1', date: '2026-10-02', donorName: 'משה כהן', amount: 500, method: 'card', fundId: 'general', status: 'active', campaignId: 'c1', ambassadorId: 'a1', receipt: { number: 3, sec46: false } },
  { id: 'd2', date: '2026-10-03', donorName: 'אהרן לוי', amount: 180, method: 'card', fundId: 'general', status: 'active', receipt: { number: null, external: true, source: 'nedarim', externalNumber: 'R-77', sec46: false }, import: { source: 'nedarim', externalId: 'A1' } }
];
const memorial = { id: 'm1', ...MEM.validateMemorial({ name: 'ר׳ יצחק', parentName: 'בן אברהם', hebrewDay: 30, hebrewMonth: 'Heshvan', contactName: 'יוסף', contactPhone: '050-1' }) };

const NPO = {
  year: 2026, settings: { orgName: 'עמותת תורה וחסד', funds: [] }, funds: [{ id: 'general', name: 'כללי' }],
  donations, grants: [], donors: [], fundSummary: { funds: [], restrictedTotal: 0, generalTotal: 0 },
  report: { donationsTotal: 680, largeDonors: [] }, tax: { counts: {}, toReport: 0 },
  campaigns: CMP.summarize([campaign], donations, TODAY)
};

test('עמותה: קמפיין עם הכפלה ושגרירים, קבלה חיצונית בלי PDF, כפתור ייבוא, הנצחה "לבירור"', async () => {
  const { html } = await render('npo', {
    getNpoOverview: NPO,
    getNpoStandingOrders: { month: '2026-10', rows: [] },
    getNpoMemorials: { list: [{ ...memorial, hebrewLabel: MEM.hebrewLabel(memorial) }], ...MEM.upcoming([memorial], '2028-11-01', 30) }
  });
  assert.match(html, /בניין בית המדרש/);
  assert.match(html, /הכפלה של קרן ברגר/);
  assert.match(html, /יוסי/);
  assert.match(html, /npoImportBtn/);
  assert.match(html, /נדרים פלוס R-77/, 'קבלה חיצונית מוצגת לפי ערוץ ומספר מקור');
  assert.doesNotMatch(html, /data-npo-pdf="d2"/, 'לקבלה חיצונית אין PDF מקומי');
  assert.match(html, /data-npo-pdf="d1"/);
  assert.match(html, /ר׳ יצחק/);
  assert.match(html, /לבירור/);
  assert.doesNotMatch(html, /data-cmp-del="c1"/, 'קמפיין עם תרומות — אין מחיקה');
});

test('עמותה: כפתור המחאות דחויות, סימון "דחויות" וכפתור "המחאה שחזרה" רק בקבלה פעילה של המחאות', async () => {
  const cheques = [{ number: '102', bank: '12', branch: '345', dueDate: '2026-11-15', amountAg: 40000 }];
  const list = [
    ...donations,
    { id: 'q1', date: '2026-10-05', donorName: 'יוסף ברגר', amount: 400, method: 'check', fundId: 'general', status: 'active', cheques, receivedDate: '2026-10-05', receipt: { number: 4, sec46: true } },
    { id: 'q2', date: '2026-10-05', donorName: 'יוסף ברגר', amount: 400, method: 'check', fundId: 'general', status: 'cancelled', cheques, bouncedCheque: { number: '102', bank: '12', dueDate: '2026-11-15' }, receivedDate: '2026-10-05', receipt: { number: 5, sec46: true } }
  ];
  const { html } = await render('npo', { getNpoOverview: { ...NPO, donations: list }, getNpoStandingOrders: { month: '2026-10', rows: [] }, getNpoMemorials: null });
  assert.match(html, /id="npoChequesBtn"/);
  assert.match(html, /1 דחויות/);
  assert.match(html, /data-npo-bounce="q1"/);
  assert.doesNotMatch(html, /data-npo-bounce="q2"/, 'קבלה מבוטלת — בלי כפתור');
  assert.doesNotMatch(html, /data-npo-bounce="d1"/, 'תרומה רגילה — בלי כפתור');
  assert.match(html, /class="bad">חזרה/);
});

test('חלון ההמחאות: כל שדה עם תווית, אין צבע hex, וההפקה רק אחרי תצוגה מקדימה', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/npo-cheques.js'), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/);
  assert.match(src, /aria-label="\$\{label\} — המחאה \$\{i \+ 1\}"/, 'שדות הטבלה — aria-label');
  assert.match(src, /aria-labelledby/);
  assert.match(src, /<button type="submit" class="primary" disabled>/, 'ההפקה כבויה עד לתצוגה המקדימה');
  assert.match(src, /addNpoChequeDonation\(input, \{ preview: true \}\)/);
  assert.match(src, /confirmWarnings: preview\.warnings \? true : undefined/);
  assert.doesNotMatch(src, /toAg|\* 100|Math\.round/, 'אין חישובי כסף בממשק — רק בשרת');
  const css = fs.readFileSync(path.join(ROOT, 'modules/econ/styles.css'), 'utf8');
  assert.match(css, /\.modal-form \[data-chq\]\[hidden\] \{ display: none; \}/);
});

test('מאגר אנשים: טבלה עם תפקידים וסימון "לפי שם"', async () => {
  const data = { npo: { donations, standingOrders: [], memorials: [memorial] }, gemach: { loans: [], deposits: [] }, chesed: { beneficiaries: [], volunteers: [{ id: 'v', name: 'יוסף', phone: '050-1' }] } };
  const { html, calls } = await render('people', { searchPeople: P.search(data, '', { today: TODAY }) });
  assert.ok(calls.some(c => c.name === 'searchPeople'));
  assert.match(html, /משה כהן/);
  assert.match(html, /לפי שם/);
  assert.match(html, /קרוב משפחה \(הנצחה\) · מתנדב|מתנדב · קרוב משפחה \(הנצחה\)/);
});

test('הגדרות: כרטיס הפרטיות למנהל, עם הסתייגות ומסנן צפייה בחסויים', async () => {
  const privacy = { ...PR.dataMap({ chesed: { beneficiaries: [{ tier: 'confidential' }] } }, { admin: 1 }), checklist: PR.INCIDENT_CHECKLIST };
  const { html } = await render('settings', { getAdvancedSettings: { isAdmin: true, kinds: [], counts: {}, me: { id: 'u1' } }, listUsers: [], listAudit: [], getPrivacyMap: privacy });
  assert.match(html, /הגנת הפרטיות — מיפוי מאגרים/);
  assert.match(html, /אינו ייעוץ משפטי/);
  assert.match(html, /privacyRetentionBtn/);
  assert.match(html, /צפייה בחסויים/);
});

test('הגדרות: כרטיס הפרטיות עם רמת אבטחה, מסמכים, יומן בקשות ומדיניות שמירה (PLAN 9.15)', async () => {
  const map = PR.dataMap({ gemach: { loans: [{}] } }, { admin: 1 });
  const privacy = { ...map, checklist: PR.INCIDENT_CHECKLIST, level: PR.suggestLevel(map), retentionKinds: PR.RETENTION_KINDS, requestTypes: PR.REQUEST_TYPES,
    noticeKinds: { donor: 'תורם' }, requests: [PR.requestView({ id: 'q1', ...PR.validateRequest({ type: 'access', name: 'יוסף כהן', receivedDate: '2026-01-01' }) }, '2026-10-18')] };
  const { html } = await render('settings', { getAdvancedSettings: { isAdmin: true, kinds: [], counts: {}, me: { id: 'u1' } }, listUsers: [], listAudit: [], getPrivacyMap: privacy });
  assert.match(html, /רמת אבטחה בינונית/);
  assert.match(html, /privacyDefinitionBtn/);
  assert.match(html, /יוסף כהן/);
  assert.match(html, /באיחור/);
  assert.match(html, /data-privacy-close="q1"/);
  assert.match(html, /לווים בהלוואות שנפרעו/);
});

test('גמ"ח: בקשות, חפצים באיחור ופיגורים לפי ערב', async () => {
  const item = { id: 'i1', ...GX.validateItem({ name: 'עגלת תינוק', deposit: 200 }) };
  const lending = { id: 'l1', ...GX.validateLending({ borrowerName: 'רחל', date: '2026-10-01', dueDate: '2026-10-10' }, item, []) };
  const loan = { id: 'L', borrowerName: 'שמעון', status: 'active', schedule: [{ seq: 1, dueDate: '2026-09-01', amountAg: 10000, paidAg: 0 }], guarantors: [{ name: 'דוד', id: '', phone: '052' }] };
  const { html } = await render('gemach', {
    getGemachOverview: {
      settings: {}, overview: {}, loans: [], deposits: [],
      applications: [{ id: 'ap', borrowerName: 'יעקב', requestDate: TODAY, amount: 1000, installments: 2, guarantors: [], status: 'verified', statusLabel: 'ערבים אומתו' }],
      guarantorArrears: GX.arrearsByGuarantor([loan], TODAY),
      items: GX.itemsOverview([item], [lending], TODAY)
    }
  });
  assert.match(html, /data-gx-move="ap" data-to="approved"/);
  assert.match(html, /עגלת תינוק/);
  assert.match(html, /באיחור/);
  assert.match(html, /data-gx-return="i1"/);
  assert.match(html, /פיגורים לפי ערב/);
  assert.match(html, /דוד/);
});

test('נתונים חסרים בכרטיסים החדשים לא מפילים את המסכים', async () => {
  for (const [view, r] of [['npo', { getNpoOverview: { ...NPO, campaigns: null }, getNpoMemorials: null }], ['people', { searchPeople: null }], ['gemach', { getGemachOverview: { settings: {}, overview: {} } }]]) {
    const { html } = await render(view, r);
    assert.doesNotMatch(html, /^<div class="loading"/, view);
  }
});
