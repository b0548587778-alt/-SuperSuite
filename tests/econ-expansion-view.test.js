// בדיקות התנהגות לתצוגות "עמותה ותרומות" ו"ייעוץ משכנתאות": ממשק המודול (modules/econ/ui) רץ ב-vm עם DOM מדומה.
// נבדק מה המשתמש רואה ומה נשלח ל-systemAPI — לא הטקסט של הקוד.
const test = require('node:test');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

async function settle(n = 14) { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); }

async function makeHarness({ npo, madv, calls = [], buttons = {}, responses = {} }) {
  const elements = {};
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return (...args) => {
        calls.push({ name, args });
        if (name in responses) return Promise.resolve(responses[name]);
        if (name === 'getNpoOverview') return Promise.resolve(npo);
        if (name === 'getMortgageAdvisor') return Promise.resolve(madv);
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
  EconUI.run(context);
  await settle();
  return { elements, navButtons, calls };
}

async function goTo(h, view) {
  const i = VIEWS.indexOf(view);
  assert.ok(i >= 0, `התצוגה ${view} קיימת בניווט`);
  h.navButtons[i]._listeners.click[0]();
  await settle();
}

const NPO = {
  year: 2026,
  settings: { orgName: 'עמותת חסד ותורה', regNumber: '580123456', sec46Number: '4321', sec46ValidUntil: '2099-12-31', vatStatus: 'exempt', funds: [{ id: 'f1', name: 'קופת צדקה', restricted: true }] },
  funds: [{ id: 'general', name: 'כללי' }, { id: 'f1', name: 'קופת צדקה', restricted: true }],
  donations: [
    { id: 'd1', date: '2026-03-01', donorName: 'משה כהן', amount: 180, method: 'cash', fundId: 'f1', status: 'active', receipt: { number: 7, sec46: true } },
    { id: 'd2', date: '2026-03-02', donorName: 'אהרן לוי', amount: 50, method: 'check', fundId: 'general', status: 'cancelled', receipt: { number: 8, sec46: true } }
  ],
  grants: [{ id: 'g1', year: 2026, source: 'משרד החינוך', program: 'תמיכה בתלמודי תורה', status: 'approved', approved: 10000, received: 4000, fundId: 'general' }],
  donors: [{ name: 'משה כהן', count: 1, total: 180, lastDate: '2026-03-01' }],
  fundSummary: { funds: [{ id: 'general', name: 'כללי', total: 4000 }, { id: 'f1', name: 'קופת צדקה', restricted: true, total: 180 }], restrictedTotal: 180, generalTotal: 4000 },
  report: { donationsTotal: 180, sec46Total: 180, grantsReceived: 4000, donorsCount: 1, largeDonors: [], largeDonorThreshold: 20000 }
};

test('עמותה: התצוגה מציגה קבלות, קרנות ותמיכות, ומבחינה בקבלה מבוטלת', async () => {
  const h = await makeHarness({ npo: NPO });
  await goTo(h, 'npo');
  const html = h.elements.view.innerHTML;
  assert.match(html, /עמותת חסד ותורה/);
  assert.match(html, /פטורה ממע(&quot;|")מ/, 'מעמד מע"מ ברירת מחדל מוצג');
  assert.match(html, /סעיף 46 · 4321/);
  assert.match(html, /קופת צדקה/);
  assert.match(html, /משרד החינוך/);
  assert.match(html, /data-npo-cancel="d1"/, 'לקבלה פעילה יש ביטול');
  assert.doesNotMatch(html, /data-npo-cancel="d2"/, 'לקבלה מבוטלת אין כפתור ביטול');
  assert.match(html, /data-npo-pdf="d2"/, 'גם מבוטלת ניתנת להדפסה (מסומנת "מבוטלת")');
  assert.match(html, /ההגשה עצמה נעשית ידנית/);
  assert.equal(h.elements.addBtn.disabled, false);
});

test('עמותה: נתונים חסרים או פגומים לא מפילים את התצוגה', async () => {
  for (const npo of [null, {}, { settings: null, donations: 'x', fundSummary: { funds: null } }]) {
    const h = await makeHarness({ npo });
    await goTo(h, 'npo');
    assert.doesNotMatch(h.elements.view.innerHTML, /^<div class="loading"/, 'התצוגה רונדרה');
    assert.equal(h.elements.addBtn.disabled, false);
  }
});

test('עמותה: הוספת תרומה טוענת את הקרנות לטופס ושולחת addNpoDonation', async () => {
  const h = await makeHarness({ npo: NPO });
  await goTo(h, 'npo');
  await h.elements.addBtn._listeners.click[0]();
  const form = h.elements.modalForm.innerHTML;
  assert.match(form, /קופת צדקה \(ייעודי\)/, 'הקרנות הייעודיות בבחירה');
  Object.assign(h.elements, {
    f_date: { value: '2026-05-01' }, f_donorName: { value: 'יעקב שטרן' }, f_amount: { value: '360' },
    f_method: { value: 'transfer' }, f_fundId: { value: 'f1' }, f_donorId: { value: '' }
  });
  await h.elements.submitBtn._listeners.click[0]();
  const call = h.calls.find(c => c.name === 'addNpoDonation');
  assert.ok(call);
  assert.equal(call.args[0].amount, 360);
  assert.equal(call.args[0].fundId, 'f1');
  assert.equal('donorId' in call.args[0], false, 'שדה ריק אינו נשלח');
});

test('עמותה: טופס ההגדרות (טופס משני) שולח saveNpoSettings, ולא את טופס התרומה', async () => {
  const h = await makeHarness({ npo: NPO });
  await goTo(h, 'npo');
  await h.elements.npoSettingsBtn._listeners.click[0]();
  assert.equal(h.elements.modalTitle.textContent, 'הגדרות עמותה');
  assert.equal(h.elements.f_fundsText.value, 'קופת צדקה', 'הקרנות הקיימות ממולאות בטופס');
  Object.assign(h.elements, { f_orgName: { value: 'עמותת חסד ותורה' }, f_vatStatus: { value: 'malkar' }, f_fundsText: { value: '' } });
  await h.elements.submitBtn._listeners.click[0]();
  const call = h.calls.find(c => c.name === 'saveNpoSettings');
  assert.ok(call, 'נשלחו ההגדרות');
  assert.equal(call.args[0].vatStatus, 'malkar');
  assert.equal(call.args[0].fundsText, '', 'ריקון הקרנות נשלח במפורש');
  assert.equal(h.calls.find(c => c.name === 'addNpoDonation'), undefined);
  // אחרי סגירת הטופס המשני, "הוספה" חוזר לטופס התרומה
  await h.elements.addBtn._listeners.click[0]();
  assert.match(h.elements.modalTitle.textContent, /תרומה חדשה/);
});

test('עמותה: עריכת תמיכה ממלאת את הטופס ושולחת updateNpoGrant עם המזהה', async () => {
  const editBtn = fakeElement('', { dataset: { npoGrantEdit: 'g1' } });
  const h = await makeHarness({ npo: NPO, buttons: { '[data-npo-grant-edit]': [editBtn] } });
  await goTo(h, 'npo');
  await editBtn._listeners.click[0]();
  await settle();
  assert.equal(h.elements.modalTitle.textContent, 'עריכת תמיכה');
  assert.equal(h.elements.f_source.value, 'משרד החינוך', 'הטופס מולא מהרשומה');
  Object.assign(h.elements, { f_received: { value: '7000' }, f_year: { value: '2026' } });
  await h.elements.submitBtn._listeners.click[0]();
  const call = h.calls.find(c => c.name === 'updateNpoGrant');
  assert.ok(call, 'נשלח עדכון ולא יצירה');
  assert.equal(call.args[0], 'g1');
  assert.equal(call.args[1].received, 7000);
  assert.equal(h.calls.find(c => c.name === 'addNpoGrant'), undefined);
});

const MADV = {
  clients: [{
    id: 'c1', name: 'יוסף פרידמן', phone: '050-0000000', bank: 'בנק א', requestedAmount: 900000, ltv: 60, status: 'submitted',
    feeType: 'percent', feeValue: 0.5, fee: { net: 4500, vat: 810, total: 5310 },
    docs: { done: 1, total: 2, items: [{ key: 'id', label: 'תעודות זהות', done: true }, { key: 'tabu', label: 'נסח טאבו', done: false }] },
    offers: [{ id: 'o1', bank: 'בנק א', summary: { tracks: [{ label: 'פריים', amount: 900000, rate: 5.5, years: 25 }], principal: 900000, firstPayment: 5526.9, maxPayment: 5526.9, totalInterest: 1, totalIndexation: 0, totalPaid: 1658070 }, yearly: [{ year: 1, payment: 1, interest: 1, principal: 1, indexation: 0, balance: 1 }] }],
    comparison: [{ id: 'o1', bank: 'בנק א', firstPayment: 5526.9, maxPayment: 5526.9, totalPaid: 1658070, costOfCredit: 758070, diffFromBest: 0, cheapest: true }]
  }]
};

test('ייעוץ משכנתאות: תיק מציג סטטוס, עמלה, מסמכים והשוואה; יש עריכה ומחיקה', async () => {
  const h = await makeHarness({ madv: MADV });
  await goTo(h, 'mortgage-advisor');
  const html = h.elements.view.innerHTML;
  assert.match(html, /יוסף פרידמן/);
  assert.match(html, /<option value="submitted" selected>הוגש לבנקים<\/option>/);
  assert.match(html, /אישור סופי/);
  assert.match(html, /מימון 60%/);
  assert.match(html, /מסמכים \(1\/2\)/);
  assert.match(html, /data-madv-doc="c1" data-key="id" checked/);
  assert.match(html, /★ הזולה/);
  assert.match(html, /data-action="edit" data-id="c1"/);
  assert.match(html, /data-action="delete" data-id="c1"/);
  for (const t of ['קבועה צמודה', 'קבועה לא צמודה', 'משתנה כל 5 שנים', 'פריים']) assert.match(html, new RegExp(t));
});

test('ייעוץ משכנתאות: מחשבון שולח את המסלולים שמולאו בלבד ומציג תוצאה', async () => {
  const h = await makeHarness({ madv: { clients: [] } });
  await goTo(h, 'mortgage-advisor');
  h.elements['calc_prime_amount'] = fakeElement('', { value: '500000' });
  h.elements['calc_prime_rate'] = fakeElement('', { value: '5' });
  h.elements['calc_prime_years'] = fakeElement('', { value: '20' });
  h.elements['calc_cpi'] = fakeElement('', { value: '2' });
  h.elements.madvCalcOut = fakeElement('madvCalcOut');
  await h.elements.madvCalcBtn._listeners.click[0]();
  await settle();
  const call = h.calls.find(c => c.name === 'calcMortgageTracks');
  assert.ok(call);
  assert.equal(call.args[0].prime_amount, 500000);
  assert.equal('fixed-indexed_amount' in call.args[0], false, 'מסלול ריק לא נשלח');
});

test('ייעוץ משכנתאות: הצעת בנק נפתחת עם ערכי המחשבון ושולחת addMortgageOffer', async () => {
  const h = await makeHarness({ madv: MADV });
  await goTo(h, 'mortgage-advisor');
  h.elements['calc_prime_amount'] = fakeElement('', { value: '900000' });
  await h.elements.madvOfferBtn._listeners.click[0]();
  assert.equal(h.elements.modalTitle.textContent, 'הצעת בנק חדשה');
  assert.equal(h.elements.f_prime_amount.value, '900000', 'ערך המחשבון עבר לטופס');
  assert.match(h.elements.modalForm.innerHTML, /יוסף פרידמן/, 'בחירת לקוח');
  Object.assign(h.elements, { f_clientId: { value: 'c1' }, f_bank: { value: 'בנק ב' }, f_prime_rate: { value: '5.1' }, f_prime_years: { value: '25' } });
  await h.elements.submitBtn._listeners.click[0]();
  const call = h.calls.find(c => c.name === 'addMortgageOffer');
  assert.ok(call);
  assert.equal(call.args[0].bank, 'בנק ב');
  assert.equal(call.args[0].prime_amount, 900000);
});

test('תצוגת המשכנתא הקיימת מפנה לכלי הייעוץ המלא', async () => {
  const h = await makeHarness({});
  await goTo(h, 'mortgage');
  assert.match(h.elements.view.innerHTML, /data-goto="mortgage-advisor"/);
});

const ADV = {
  idleMinutes: 30, startView: 'dashboard', isAdmin: true, me: { id: 'u1', username: 'admin_one' },
  kinds: [{ id: 'contacts', label: 'אנשי קשר' }, { id: 'tasks', label: 'משימות' }], counts: { contacts: 3, tasks: 0 }
};
const USERS = [{ id: 'u1', username: 'admin_one', role: 'admin', active: true }, { id: 'u2', username: 'editor_one', role: 'editor', active: true }];

test('הגדרות מתקדמות: מנהל רואה משתמשים, יומן ומרכז ייבוא/ייצוא', async () => {
  const h = await makeHarness({ responses: { getAdvancedSettings: ADV, listUsers: USERS, listAudit: [{ at: '2026-10-14T09:00', user: 'admin_one', action: 'users:create', details: 'editor_one' }] } });
  await goTo(h, 'settings');
  const html = h.elements.view.innerHTML;
  assert.match(html, /30 דקות/);
  assert.match(html, /editor_one/);
  assert.match(html, /users:create/);
  assert.match(html, /data-port-export="contacts"/);
  assert.match(html, /data-vcard-export/);
  // המשתמש המחובר אינו יכול לחסום את עצמו
  assert.doesNotMatch(html, /data-user-toggle="u1"/);
  assert.match(html, /data-user-toggle="u2"/);
});

test('הגדרות מתקדמות: משתמש שאינו מנהל — לא נשלחת בקשה לרשימת משתמשים או ליומן', async () => {
  const calls = [];
  const h = await makeHarness({ calls, responses: { getAdvancedSettings: { ...ADV, isAdmin: false } } });
  await goTo(h, 'settings');
  assert.ok(!calls.some(c => c.name === 'listUsers' || c.name === 'listAudit'));
  assert.doesNotMatch(h.elements.view.innerHTML, /משתמשים ותפקידים/);
});

test('אנשי קשר: פס ייבוא/ייצוא כולל vCard מוצג מעל התצוגה', async () => {
  const h = await makeHarness({ responses: { getContacts: [] } });
  await goTo(h, 'contacts');
  const html = h.elements.view.innerHTML;
  assert.match(html, /data-port-import="contacts"/);
  assert.match(html, /data-vcard-import/);
});

// ---------- מעבדת תמהיל ----------
const LAB = {
  forecast: { isDemo: true, id: 'demo-2026-10', source: 'נתוני הדגמה בלבד', publishedAt: '2026-10-01', boiPct: [4.25, 4], inflationAnnualPct: 2.5, anchors: { GOV_BOND_5Y: { first: 3, last: 3.25, months: 61 } } },
  anchorKeys: ['GOV_BOND_5Y'], rulesVersion: '2026.10.1', engineVersion: '1.0.0',
  rules: [
    { id: 'boi.prime.spread', description: 'מרווח פריים מעל ריבית בנק ישראל', source: 'מקור', value: 0.015, needsVerification: true },
    { id: 'boi.329.maxLtv', description: 'שיעור מימון מקסימלי', source: 'מקור', value: { SINGLE_HOME: 0.75 }, needsVerification: false, verifiedAt: '2026-10-10T08:00:00Z', verifiedNote: 'נבדק מול 329' }
  ],
  clients: [{ id: 'c1', name: 'משפחת גולדברג' }],
  scenarios: [{ id: 's1', name: 'תמהיל שנחתם', clientName: 'משפחת גולדברג', startDate: '2022-01-15', rulesVersion: '2026.10.1', forecastId: 'demo', summary: { principal: 1200000, firstPayment: 6654.81, totalPayments: 2201230.66 }, tracks: [{ type: 'PRIME', amount: 1200000, termMonths: 300, spreadPct: -0.5 }] }],
  retention: [{ kind: 'RATE_RESET', label: 'נקודת שינוי ריבית במסלול 3 — הזדמנות למחזור', date: '2027-01-15', days: 93, clientName: 'משפחת גולדברג', scenarioName: 'תמהיל שנחתם' }]
};
const LAB_RESULT = {
  summary: { principal: 1200000, firstPayment: 6654.81, maxPayment: 7100.5, maxPaymentMonth: 61, totalInterest: 900000, totalIndexation: 100000, totalCost: 1001230.66, totalPayments: 2201230.66, irrAnnual: 0.05 },
  yearly: [{ year: 1, payments: 79857.72, interest: 50000, principal: 29857.72, indexation: 1000, closingBalance: 1171142.28 }],
  tracks: [{ label: 'פריים', principal: 400000, termMonths: 300, initialRate: 0.0525, isCpiLinked: false, summary: { firstPayment: 2400, maxPayment: 2400, totalPayments: 720000 } }],
  warnings: [{ code: 'PTI_WARNING', label: 'יחס ההחזר להכנסה גבוה', actual: 0.44, limit: 0.4, needsVerification: true }],
  assumptions: { forecastSource: 'נתוני הדגמה בלבד', forecastPublishedAt: '2026-10-01', forecastNeedsVerification: true, boiRateAtStart: 0.0425, primeSpread: 0.015, primeSpreadNeedsVerification: true, firstYearInflation: 0.025, rateConvention: 'NOMINAL', rulesVersion: '2026.10.1', engineVersion: '1.0.0' }
};

function labTabButton(tab) { return fakeElement('', { dataset: { labTab: tab } }); }

test('מעבדת תמהיל: נפתחת עם באנר הדגמה/אימות, לשוניות ועורך מסלולים ברירת מחדל', async () => {
  const h = await makeHarness({ responses: { getMortgageLab: LAB } });
  await goTo(h, 'mortgage-lab');
  const html = h.elements.view.innerHTML;
  assert.match(html, /התחזית היא נתוני הדגמה/);
  assert.match(html, /1 כללים רגולטוריים טרם אומתו/);
  assert.match(html, /data-lab-tab="opt"/);
  assert.equal((html.match(/data-f="type"/g) || []).length, 3, 'שלושה מסלולים בעורך');
  assert.match(html, /value="GOV_BOND_5Y" selected/, 'העוגן מהתחזית נבחר');
  assert.equal(h.elements.addBtn.disabled, true, 'אין טופס הוספה במעבדה');
});

test('מעבדת תמהיל: "חשב" שולח את המסלולים ומציג סיכום, אזהרות והנחות', async () => {
  const h = await makeHarness({ responses: { getMortgageLab: LAB, calcLabMix: LAB_RESULT } });
  await goTo(h, 'mortgage-lab');
  await h.elements.labCalcMix._listeners.click[0]();
  await settle();
  const call = h.calls.find(c => c.name === 'calcLabMix');
  assert.ok(call);
  assert.equal(call.args[0].tracks.length, 3);
  assert.equal(call.args[0].tracks[1].type, 'PRIME');
  const html = h.elements.view.innerHTML;
  assert.match(html, /6,654\.81/);
  assert.match(html, /יחס ההחזר להכנסה גבוה/);
  assert.match(html, /הנחות החישוב/);
  assert.match(html, /שמירה כתרחיש/, 'אחרי חישוב אפשר לשמור');
});

test('מעבדת תמהיל: לשוניות שימור, תרחישים ותחזית וכללים', async () => {
  const tabs = ['retention', 'scenarios', 'settings'].map(labTabButton);
  const h = await makeHarness({ responses: { getMortgageLab: LAB }, buttons: { '[data-lab-tab]': tabs } });
  await goTo(h, 'mortgage-lab');
  tabs[0]._listeners.click.at(-1)();
  assert.match(h.elements.view.innerHTML, /נקודת שינוי ריבית במסלול 3/);
  assert.match(h.elements.view.innerHTML, /93 ימים/);
  tabs[1]._listeners.click.at(-1)();
  assert.match(h.elements.view.innerHTML, /data-lab-export="s1"/);
  assert.match(h.elements.view.innerHTML, /data-lab-load="s1"/);
  tabs[2]._listeners.click.at(-1)();
  const html = h.elements.view.innerHTML;
  assert.match(html, /data-lab-verify="boi.prime.spread"/, 'כלל שלא אומת — כפתור אימות');
  assert.doesNotMatch(html, /data-lab-verify="boi.329.maxLtv"/);
  assert.match(html, /נבדק מול 329/);
  assert.match(html, /מוצגים נתוני הדגמה בלבד/);
});

test('מעבדת תמהיל: נתונים חסרים או פגומים לא מפילים את התצוגה', async () => {
  for (const lab of [null, {}, { rules: 'x', scenarios: null, retention: {}, forecast: {} }]) {
    const h = await makeHarness({ responses: { getMortgageLab: lab } });
    await goTo(h, 'mortgage-lab');
    assert.match(h.elements.view.innerHTML, /lab-tabs/, 'התצוגה רונדרה');
  }
});

test('ייעוץ משכנתאות מפנה למעבדת התמהיל המלאה', async () => {
  const h = await makeHarness({ madv: { clients: [] } });
  await goTo(h, 'mortgage-advisor');
  assert.match(h.elements.view.innerHTML, /data-goto="mortgage-lab"/);
});
