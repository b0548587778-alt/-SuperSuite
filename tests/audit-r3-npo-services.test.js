'use strict';
// רגרסיה לסקירת הקוד 2.11.2026 (סוכן "npo", חלק 2): שירותים מול מסד אמיתי, ערוצי IPC וממשק —
// נעילת מע"מ בתיווך, עמלת ייעוץ מעל היתרה, מחיקות שעוקפות הגנות, מס"ב, הוראות קבע, קרנות,
// מונה קבלות סעיף 46, יומן הפעולות, טופס 🏦, Escape בהמחאות דחויות וייצוא שמאות לרואה חשבון.
process.env.TZ = 'Asia/Jerusalem';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const EconUI = require('./helpers/econ-ui');
const SD = require('../modules/econ/core/sampleData');

// electron מדומה — לפני טעינת השירותים וה-IPC
const handlers = {};
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r3npo__.js' : realResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_r3npo__.js'] = { id: '/__electron_stub_r3npo__.js', filename: '/__electron_stub_r3npo__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3-npo-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let dirSeq = 0;
async function svc(name, file) {
  const { initializeDatabase } = require('../modules/econ/core/database');
  const dir = path.join(TMP, 'db' + (++dirSeq));
  fs.mkdirSync(dir);
  const db = await initializeDatabase(dir);
  const s = require('../modules/econ/services/' + file)[name];
  await s.initialize(db);
  return { s, db };
}

test.before(async () => {
  const dir = path.join(TMP, 'ipc');
  fs.mkdirSync(dir);
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(7), 'r3_admin', 'r3-strong-pass-2026');
  await handlers['auth:login'](ev(7), 'r3_admin', 'r3-strong-pass-2026');
});

// ---------- IPC (ראשונים: השירותים בהמשך מחליפים את המסד של השירותים המשותפים) ----------
test('IPC: מונה קבלות סעיף 46 לא מתאפס בשמירת הגדרות עם receiptSeq: 0 עוין', async () => {
  await handlers['npo:saveSettings'](ev(7), { orgName: 'עמותה', sec46Number: '46' });
  const a = await handlers['npo:addDonation'](ev(7), { date: '2026-04-01', donorName: 'א', amount: 10 });
  await handlers['npo:saveSettings'](ev(7), { orgName: 'עמותה', sec46Number: '46', receiptSeq: 0 });
  const b = await handlers['npo:addDonation'](ev(7), { date: '2026-04-02', donorName: 'ב', amount: 10 });
  assert.equal(b.receipt.number, a.receipt.number + 1);
});

test('IPC: הגדרות שמאות מקרקעין, תיק שומה ומסמכי משכנתא נרשמים ביומן הפעולות', async () => {
  await handlers['realestate:saveSettings'](ev(7), {});
  const c = await handlers['madv:createClient'](ev(7), { name: 'לקוח', requestedAmount: 500000 });
  await handlers['madv:toggleDoc'](ev(7), c.id, 'id', 'received');
  const actions = (await handlers['audit:list'](ev(7), {})).map(e => e.action);
  assert.ok(actions.includes('realestate.settings.save'), 'הגדרות שמאות');
  assert.ok(actions.includes('madv.doc.toggle'), 'מסמך משכנתא');
});

// ---------- שירותים ----------
test('תיווך: מעמד המע"מ ננעל בעסקה בתשלום הראשון — מעבר לעוסק מורשה לא יוצר חוב ולא משנה את החשבונית', async () => {
  const { s, db } = await svc('RealtyService', 'realtyService');
  await s.saveSettings({ vatExempt: true });
  const seller = await s.createClient({ name: 'מוכר', role: 'seller' });
  const buyer = await s.createClient({ name: 'קונה', role: 'buyer' });
  const p = await s.createProperty({ city: 'בני ברק', asking: 2000000, ownerClientId: seller.id });
  const d = await s.createDeal({ propertyId: p.id, buyerClientId: buyer.id });
  await s.setCommissions(d.id, { buyer: { type: 'fixed', value: 3000 } });
  const r = await s.addCommissionPayment(d.id, { side: 'buyer', date: '2026-10-01', amount: 3000 });
  await s.saveSettings({ vatExempt: false });
  const deal = (await s.getOverview('2026-11-02')).deals.find(x => x.id === d.id);
  assert.equal(deal.commission.balance, 0, 'שולם כעוסק פטור — אין יתרה של מע"מ');
  assert.equal((await s.commissionPaymentForInvoice(d.id, r.payment.id)).exempt, true, 'החשבונית לפי המעמד בתשלום');
  // עסקה חדשה אחרי המעבר — לפי ההגדרה החדשה
  const d2 = await s.createDeal({ propertyId: p.id, buyerClientId: buyer.id });
  await s.setCommissions(d2.id, { buyer: { type: 'fixed', value: 1000 } });
  assert.equal((await s.getOverview('2026-11-02')).deals.find(x => x.id === d2.id).commission.total, 1180);
  assert.equal((await db.load()).realty.deals.find(x => x.id === d.id).feeVatExempt, true);
});

test('נדל"ן: נכס עם הזמנת שירותי תיווך לא נמחק', async () => {
  const { s } = await svc('RealtyService', 'realtyService');
  const c = await s.createClient({ name: 'לקוח', role: 'buyer' });
  const p = await s.createProperty({ city: 'ירושלים', asking: 1500000 });
  await s.saveOrder('', { clientId: c.id, propertyId: p.id, date: '2026-10-01' });
  await assert.rejects(s.deleteProperty(p.id), /הזמנת שירותי תיווך/);
});

test('ייעוץ משכנתאות: תשלום עמלה מעל היתרה נדחה; תיק עם תשלום שהופקה עליו חשבונית לא נמחק', async () => {
  const { s, db } = await svc('MortgageAdvisorService', 'mortgageAdvisorService');
  const c = await s.createClient({ name: 'לקוח', requestedAmount: 1000000, feeType: 'fixed', feeValue: 4000 });
  await assert.rejects(s.addFeePayment(c.id, { date: '2026-10-01', amount: 47200 }), /גבוה מיתרת העמלה/);
  const r = await s.addFeePayment(c.id, { date: '2026-10-01', amount: 4720 });
  assert.equal(r.status.state, 'paid');
  await assert.rejects(s.addFeePayment(c.id, { date: '2026-10-02', amount: 1 }), /גבוה מיתרת העמלה/);
  const data = await db.load();
  data.invoices = [...(data.invoices || []), { id: 'inv1', number: 7, status: 'active' }];
  const cc = data.mortgageAdvisor.clients.find(x => x.id === c.id);
  cc.feePayments[0].invoiceId = 'inv1';
  cc.feePayments[0].invoiceNumber = 7;
  await db.save(data);
  await assert.rejects(s.deleteClient(c.id), /הופקה עליו חשבונית \(מספר 7\)/);
  assert.equal((await db.load()).mortgageAdvisor.clients.length, 1);
});

test('נתוני דוגמה: רשומת דוגמה שרשומה אמיתית מפנה אליה — נשארת (וגם מה שהיא מפנה אליו)', () => {
  const data = { realty: {
    properties: [{ id: 'sp', sample: true, ownerClientId: 'sc' }, { id: 'sp2', sample: true }],
    clients: [{ id: 'sc', sample: true }, { id: 'rc' }],
    deals: [{ id: 'rd', propertyId: 'sp', buyerClientId: 'rc' }], projects: [] },
  npo: { donations: [{ id: 'sd', sample: true }] }, gemach: { loans: [] } };
  const out = {};
  const n = SD.remove(data, out);
  assert.equal(n, 2, 'נמחקו רק sp2 והתרומה');
  assert.deepEqual(data.realty.properties.map(p => p.id), ['sp']);
  assert.deepEqual(data.realty.clients.map(c => c.id), ['sc', 'rc'], 'הבעלים של נכס הדוגמה שנשאר — נשאר');
  assert.equal(out.kept, 2);
});

test('מס"ב בגמ"ח: תשלום ידני בזמן שהחיוב באצווה פתוחה — הסגירה מתריעה על גבייה כפולה', async () => {
  const { s, db } = await svc('GemachService', 'gemachService');
  const loan = await s.addLoan({ borrowerName: 'שמואל פרידמן', borrowerId: '000000018', amount: 1200, installments: 12, issueDate: '2026-10-05' });
  await s.saveMasavSettings({ institution: '12345678', sender: '54321', name: 'גמח אור', hebrew: 'oldcode' });
  await s.setLoanBank(loan.id, { bank: '12', branch: '345', account: '678901' });
  const month = loan.schedule[0].dueDate.slice(0, 7);
  await s.createMasavBatch({ month, chargeDate: `${month}-20` }, { today: '2026-10-18' });
  await s.recordPayment(loan.id, 1, { amount: 100, date: `${month}-15` });
  const c = await s.closeMasavBatch((await db.load()).gemach.masav.batches[0].id);
  assert.equal(c.manual.length, 1);
  assert.match(c.manual[0].why, /גבה גם 100\.00/);
});

test('הוראת קבע: ביטול הקבלה מחזיר את החודש — אפשר לסמן "נכשל" או לחייב שוב', async () => {
  const { s, db } = await svc('NpoService', 'npoService');
  await s.saveSettings({ orgName: 'עמותה' });
  const o = await s.saveStandingOrder(null, { donorName: 'לוי', amount: 50, dayOfMonth: 10, startMonth: '2026-09', method: 'standing' });
  const { donation } = await s.recordStandingPayment(o.id, '2026-10', 'received', '2026-10-10');
  await s.cancelDonation(donation.id);
  await s.recordStandingPayment(o.id, '2026-10', 'failed');
  const saved = (await db.load()).npo.standingOrders[0];
  assert.deepEqual(saved.history.map(h => h.status), ['failed']);
  assert.equal(saved.cancelledHistory[0].donationId, donation.id);
});

test('קרן של הוראת קבע פעילה — לא מוסרת ולא עוברת לארכיון', async () => {
  const { s, db } = await svc('NpoService', 'npoService');
  await s.saveSettings({ orgName: 'עמותה', fundsText: 'בניין' });
  const fund = (await db.load()).npo.settings.funds[0];
  const o = await s.saveStandingOrder(null, { donorName: 'לוי', amount: 50, dayOfMonth: 10, startMonth: '2026-09', method: 'standing', fundId: fund.id });
  await assert.rejects(s.saveSettings({ orgName: 'עמותה', fundsText: '' }), /משמשת את הוראת הקבע של לוי/);
  await s.saveStandingOrder(o.id, { endMonth: '2026-09' });
  await s.saveSettings({ orgName: 'עמותה', fundsText: '' });
});

test('סקירת העמותה: רק התרומות של השנה המבוקשת', async () => {
  const { s } = await svc('NpoService', 'npoService');
  await s.saveSettings({ orgName: 'עמותה' });
  await s.addDonation({ date: '2025-05-01', donorName: 'א', amount: 10 });
  await s.addDonation({ date: '2026-05-01', donorName: 'ב', amount: 20 });
  const o = await s.getOverview(2026);
  assert.deepEqual(o.donations.map(d => d.donorName), ['ב']);
  assert.equal(o.donors.length, 2, 'רשימת התורמים — כל השנים');
});

// ---------- ממשק (vm עם DOM מדומה) ----------
function el(tag = 'div', extra = {}) {
  const listeners = {};
  const memo = {};
  const node = Object.assign({
    tagName: String(tag).toUpperCase(), textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [],
    disabled: false, hidden: false, elements: { confirmWarnings: { checked: false }, donorName: { focus() {} } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(e, fn) { (listeners[e] ||= []).push(fn); }, removeEventListener() {}, _listeners: listeners,
    append() {}, appendChild(c) { return c; }, insertAdjacentHTML() {},
    querySelector(sel) { return (memo[sel] ||= el('div')); }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
  }, extra);
  node.parentNode = { setAttribute() {} };
  return node;
}
function loadUi() {
  const byId = {};
  const winListeners = {};
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById(id) { return (byId[id] ||= el('div', { id })); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { return el(tag); }, createTextNode(t) { return { textContent: t }; }, body: el('body'),
  };
  const context = { console, setTimeout, clearTimeout, setImmediate, Date, Intl, URLSearchParams, TextDecoder, location: { search: '' }, document,
    FormData: class { entries() { return [][Symbol.iterator](); } },
    addEventListener(e, fn) { (winListeners[e] ||= []).push(fn); },
    removeEventListener(e, fn) { winListeners[e] = (winListeners[e] || []).filter(f => f !== fn); } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  return { context, byId, winListeners, run: (code) => vm.runInContext(code, context) };
}
const tick = () => new Promise(r => setImmediate(r));

test('טופס 🏦: שמירה ריקה של חשבון שמור לא מוחקת בלי אישור', async () => {
  const { context, run } = loadUi();
  const saved = [];
  let asked = 0;
  context.licForm = async () => ({ bank: '', branch: '', account: '' });
  context.askConfirm = async () => { asked++; return false; };
  run('licForm = window.licForm; askConfirm = window.askConfirm;');
  const r = await run("masavBankForm('חשבון', '12-345-•••901', async (v) => { window.__saved = v; })");
  saved.push(context.__saved);
  assert.equal(r, false);
  assert.equal(asked, 1, 'נשאל לפני הסרה');
  assert.equal(saved[0], undefined, 'לא נשמר / לא נמחק');
});

test('המחאות דחויות: Escape בזמן ההפקה לא סוגר את החלון', async () => {
  const { context, winListeners, run } = loadUi();
  let resolveApi;
  let built = null;
  context.systemAPI = {
    addNpoChequeDonation: (input, opts) => (opts && opts.preview ? Promise.resolve({ warnings: [], years: [] }) : new Promise(r => { resolveApi = r; }))
  };
  context.openDialog = (build) => new Promise((resolve) => { const card = el('div'); built = card; build(card, resolve); });
  context.npoChequePreviewHtml = () => '';
  context.switchView = async () => {};
  context.showToast = () => {};
  run('openDialog = window.openDialog; npoChequePreviewHtml = window.npoChequePreviewHtml; switchView = window.switchView; showToast = window.showToast;');
  const p = run('openNpoChequesDialog()');
  const f = built.querySelector('form');
  await f.querySelector('[data-act="preview"]')._listeners.click[0]();
  f._listeners.submit[0]({ preventDefault() {} });
  await tick();
  let stopped = false;
  const esc = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
  for (const fn of winListeners.keydown || []) fn(esc);
  assert.equal(stopped, true, 'Escape נחסם בזמן ההפקה');
  resolveApi({ donations: [] });
  await p;
  assert.equal((winListeners.keydown || []).length, 0, 'המאזין הוסר בסגירה');
});

test('שמאות מקרקעין: רואה חשבון מייצא דוח טיוטה בלי שמירה קודמת', async () => {
  const { context, byId, run } = loadUi();
  const calls = [];
  context.systemAPI = new Proxy({}, { get: (t, k) => (...a) => { calls.push(k); return Promise.resolve(k === 'exportRealEstateReport' ? { ok: true } : {}); } });
  context.renderView = () => {};
  context.showToast = () => {};
  run('renderView = window.renderView; showToast = window.showToast;');
  run("state.user = { permissions: ['data.view', 'data.export'] }; state.re = { caseId: 'c1', current: { case: { status: 'draft' } }, form: {} };");
  run('attachRealEstateHandlers()');
  await byId.reExport._listeners.click[0]();
  assert.deepEqual(calls.filter(c => /RealEstate/.test(c)), ['exportRealEstateReport'], 'בלי updateRealEstateCase');
});
