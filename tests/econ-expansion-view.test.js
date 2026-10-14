// בדיקות התנהגות לתצוגות "עמותה ותרומות" ו"ייעוץ משכנתאות": unified-ui.js רץ ב-vm עם DOM מדומה.
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

async function makeHarness({ npo, madv, calls = [], buttons = {} }) {
  const elements = {};
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return (...args) => {
        calls.push({ name, args });
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
    assert.doesNotMatch(h.elements.view.innerHTML, /^<div class="loading">/, 'התצוגה רונדרה');
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
  assert.match(html, /<option value="submitted" selected>הוגש<\/option>/);
  assert.match(html, /אושר סופי/);
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
