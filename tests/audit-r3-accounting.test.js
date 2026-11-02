// סקירת קוד 2.11.2026 — הנהלת חשבונות ומסמכים רשמיים: שליחה כפולה, ביטול חשבונית = חשבונית זיכוי,
// חובות פתוחים אחרי זיכויים, הדפסה חוזרת, עוסק פטור, עמלות, שמירה אחת בפעולות שחוצות שירותים ועוד
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const A = require('../modules/econ/core/accounting');
const SD = require('../modules/econ/core/salesDocs');
const X = require('../modules/econ/core/exports');
const PCN = require('../modules/econ/core/pcn874');
const BZ = require('../modules/econ/core/bizReports');
const { inOneSave } = require('../modules/econ/services/oneSave');

const BUSINESS = { name: 'ישיבת אור החיים', taxId: '123456782', address: 'רחוב הרב קוק 5, בני ברק' };
const TMP = [];
const tmpDir = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP.push(d); return d; };
test.after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });

// מסד בזיכרון (load/save של כל הנתונים, כמו Database)
function memoryDb(initial = {}) {
  let data = structuredClone({ accounts: [], journal: [], invoices: [], salesDocs: [], settings: {}, personal: [], products: [], recurringInvoices: [], bankLines: [], ...initial });
  return {
    saves: 0,
    async load() { return structuredClone(data); },
    async save(v) { this.saves++; data = structuredClone(v); },
    peek() { return data; }
  };
}

async function freshAcc() {
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = memoryDb();
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { acc: AccountingService, db };
}
const item = (unitPrice, kind = 'goods') => [{ description: 'ספרי קודש', quantity: 1, unitPrice, kind }];

// שעון קבוע — "היום" בשירות (localDay) נקבע לפי Date
function freezeDate(t, iso) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(iso + 'T10:00:00').getTime() });
}

// ---------- Ctrl+Enter: שליחה כפולה ----------
// הפונקציות האמיתיות מתוך קבצי הממשק, ב-vm עם תלויות מדומות
function extractFn(file, header) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const i = src.indexOf(header);
  assert.ok(i >= 0, header);
  const end = src.indexOf('\n}\n', i);
  return src.slice(i, end + 2);
}

test('Ctrl+Enter: שתי שליחות של אותו טופס בזמן שהשמירה רצה — נשמרת חשבונית אחת', async () => {
  const pending = [];
  const release = () => { while (pending.length) pending.shift()(); };
  const calls = [];
  const ctx = {
    state: { currentView: 'acct-invoices', editingId: null },
    elements: { submitBtn: { disabled: false } },
    currentSchema: () => ({ fields: [], create: async (d) => { calls.push(d); await new Promise(r => pending.push(r)); } }),
    collectFormData: () => ({ customer: 'משה כהן' }),
    showToast() {}, showError() {}, closeModal() {}, switchView: async () => {}, errMsg: (e) => String(e)
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('modules/econ/ui/forms.js', 'async function handleSubmit()'), ctx);
  const first = ctx.handleSubmit();
  await new Promise(r => setImmediate(r));
  const second = ctx.handleSubmit(); // הלחיצה השנייה — בזמן שהראשונה עוד שומרת
  const third = ctx.handleSubmit();
  await new Promise(r => setImmediate(r));
  release();
  await Promise.all([first, second, third]);
  assert.equal(calls.length, 1, 'נשלחה פעם אחת בלבד');
  assert.equal(ctx.state.submitting, false, 'הדגל משתחרר בסוף');
  // אחרי שהשמירה הסתיימה — שליחה חדשה מותרת
  const again = ctx.handleSubmit();
  await new Promise(r => setImmediate(r));
  release();
  await again;
  assert.equal(calls.length, 2);
});

test('Ctrl+Enter: חזרה אוטומטית של מקש מוחזק (e.repeat) לא שולחת', () => {
  let sent = 0;
  const ctx = {
    state: { currentView: 'acct-invoices' },
    elements: { modal: { classList: { contains: () => false } } },
    document: { querySelector: () => null, activeElement: null, getElementById: () => null },
    handleSubmit: () => { sent++; }, handleAdd() {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('modules/econ/ui/accounting.js', 'function acctInvoiceKeys(e)'), ctx);
  const ev = (repeat) => ({ ctrlKey: true, key: 'Enter', repeat, preventDefault() {} });
  ctx.acctInvoiceKeys(ev(false));
  ctx.acctInvoiceKeys(ev(true));
  ctx.acctInvoiceKeys(ev(true));
  assert.equal(sent, 1);
});

// ---------- ביטול חשבונית = חשבונית זיכוי מלאה ----------
test('ביטול חשבונית מפיק חשבונית זיכוי 330 ממוספרת, בלי היפוך יומן נוסף; החשבונית מסומנת בוטלה', async (t) => {
  freezeDate(t, '2026-10-20');
  const { acc, db } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'חברת אור', customerTaxId: '515555555', date: '2026-10-05', items: item(10000) });
  const cancelled = await acc.cancelInvoice(inv.id, { reason: 'הלקוח ביטל את ההזמנה' });
  const data = db.peek();
  const credit = data.salesDocs.find(d => d.kind === 'credit');
  assert.ok(credit, 'נוצרה חשבונית זיכוי');
  assert.equal(credit.number, 1);
  assert.equal(credit.invoiceId, inv.id);
  assert.equal(credit.invoiceNumber, inv.number);
  assert.equal(credit.total, 11800);
  assert.equal(credit.full, true);
  assert.equal(credit.date, '2026-10-20');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelCreditId, credit.id);
  assert.equal(cancelled.cancelCreditNumber, 1);
  assert.equal(cancelled.cancelledAt, credit.date, 'תאריך הביטול = תאריך הזיכוי');
  assert.equal(data.journal.filter(e => e.reversalOf).length, 0, 'אין היפוך נפרד — הזיכוי הוא ההיפוך');
  assert.deepEqual(A.vatReport(data.journal, {}), { outputVat: 0, inputVat: 0, netPayable: 0 }, 'מע"מ העסקאות מתבטל פעם אחת');
  // PCN874 של החודש: החשבונית והזיכוי, סה"כ 0 — לא מינוס כפול
  const pcn = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-10', months: 1, now: Date.now() });
  assert.equal(pcn.totals.taxableVat, 0);
  assert.equal(pcn.difference, 0);
  assert.equal(pcn.counts.S, 2, 'חשבונית וזיכוי ללקוח המזוהה');
  // הכרטסת והמקדמות — שורת הזיכוי בלבד
  const ledger = BZ.customerLedger(data, 'חברת אור');
  assert.deepEqual(ledger.rows.map(r => r.kind), ['invoice', 'credit']);
  assert.equal(ledger.closingAg, 0);
  assert.equal(BZ.turnoverAg(data, '2026-10-01', '2026-10-31'), 0);
  // אי אפשר לבטל שוב או לזכות חשבונית שבוטלה
  await assert.rejects(acc.cancelInvoice(inv.id), /כבר בוטלה/);
  await assert.rejects(acc.createCreditNote(inv.id, { date: '2026-10-21', reason: 'x' }), /בוטלה/);
});

test('ביטול חשבונית: הזיכוי במבנה האחיד (330 עם מסמך בסיס), והחשבונית אינה "מסמך מבוטל"', async (t) => {
  freezeDate(t, '2026-10-20');
  const { acc } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'חברת אור', date: '2026-10-05', items: item(1000) });
  await acc.cancelInvoice(inv.id);
  const out = await acc.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { now: Date.now() });
  const docs = Object.fromEntries(out.report.documents.map(d => [d.code, d]));
  assert.deepEqual([docs[305].count, docs[305].total], [1, 1180], 'החשבונית נשארת מסמך תקף');
  assert.deepEqual([docs[330].count, docs[330].total], [1, 1180], 'הזיכוי בקובץ');
  const text = out.dataTxt.toString('latin1');
  const c100 = text.split('\r\n').filter(l => l.startsWith('C100'));
  assert.equal(c100.length, 2);
});

test('ביטול חשבונית עתידית: הזיכוי בתאריך החשבונית — PCN874 של כל חודש מתאים ליומן (לא −180 / +180)', async (t) => {
  freezeDate(t, '2026-11-02');
  const { acc, db } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'לקוח', date: '2026-12-01', items: item(1000) });
  const c = await acc.cancelInvoice(inv.id);
  assert.equal(c.cancelledAt, '2026-12-01');
  const data = db.peek();
  for (const month of ['2026-11', '2026-12']) {
    const pcn = PCN.buildPcn874({ data, business: BUSINESS, month, months: 1, now: Date.now() });
    assert.equal(pcn.totals.taxableVat, 0, month);
    assert.equal(pcn.difference, 0, month);
  }
});

test('ביטול ישן (היפוך יומן בלי זיכוי) עדיין מדווח במינוס ב-PCN874', () => {
  const data = {
    invoices: [{ id: 'i1', number: 1, date: '2026-10-05', customer: 'א', net: 100, vat: 18, total: 118, status: 'cancelled', cancelledAt: '2026-10-07', reversalEntryId: 'r1' }],
    salesDocs: [], journal: []
  };
  const pcn = PCN.buildPcn874({ data, business: BUSINESS, month: '2026-10', months: 1, now: Date.now() });
  assert.equal(pcn.totals.taxableVat, 0, '+18 ו-18−');
});

// ---------- חובות פתוחים וגיל חובות אחרי זיכויים ----------
test('חובות פתוחים וגיל חובות — לפי היתרה אחרי זיכויים; זוכתה במלואה אינה חוב', async () => {
  const { acc } = await freshAcc();
  const full = await acc.createInvoice({ customer: 'א', date: '2026-10-01', items: item(1000) });
  const part = await acc.createInvoice({ customer: 'ב', date: '2026-10-01', items: item(1000) });
  await acc.createCreditNote(full.id, { date: '2026-10-02', reason: 'החזרה' });
  await acc.createCreditNote(part.id, { date: '2026-10-02', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 100 }] });
  const r = await acc.getReports({ to: '2026-10-10' });
  assert.equal(r.openInvoices, 1062, 'רק יתרת החשבונית שזוכתה בחלקה');
  assert.equal(r.aged.buckets[0].total, 1062);
  assert.equal(r.aged.buckets[0].count, 1);
  assert.deepEqual(r.aged.items.map(i => [i.customer, i.total]), [['ב', 1062]]);
  const list = await acc.getInvoices();
  const f = list.find(i => i.id === full.id);
  assert.deepEqual([f.credited, f.balance, f.netBalance], [1180, 0, 0]);
});

test('getInvoices עם limit — לוח הבקרה מקבל רק את האחרונות', async () => {
  const { acc } = await freshAcc();
  for (let i = 0; i < 7; i++) await acc.createInvoice({ customer: 'א', date: '2026-10-01', items: item(10) });
  const top = await acc.getInvoices({ limit: 5 });
  assert.deepEqual(top.map(i => i.number), [7, 6, 5, 4, 3]);
  assert.equal((await acc.getInvoices()).length, 7);
});

// ---------- שכפול ----------
test('שכפול חשבונית שירות שומר את סוג הפריט (4100, לא 4000)', async () => {
  const { acc } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'א', date: '2026-10-01', items: item(500, 'service') });
  assert.equal(inv.items[0].account, A.SYS.SERVICES);
  const dup = await acc.getDuplicateInput('invoice', inv.id);
  assert.equal(dup.items[0].kind, 'service');
  const again = await acc.createInvoice({ customer: dup.customer, date: '2026-10-02', items: dup.items.map(({ description, quantity, unitPrice, kind }) => ({ description, quantity, unitPrice, kind })) });
  assert.equal(again.items[0].account, A.SYS.SERVICES);
});

// ---------- עוסק פטור ----------
test('עוסק פטור: "חשבונית זיכוי" ו"חשבונית עסקה" בזיכוי ובקבלה — לא "חשבונית מס"', async () => {
  const { acc, db } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'א', date: '2026-10-01', vatExempt: true, items: item(1000), paidNow: { method: 'cash' } });
  const receipt = db.peek().salesDocs.find(d => d.kind === 'receipt');
  const r = await acc.getSalesDoc(receipt.id);
  assert.equal(r.baseLabel, 'חשבונית עסקה');
  const rHtml = X.renderReceiptHtml(r, BUSINESS);
  assert.match(rHtml, /עבור:<\/strong> חשבונית עסקה 1/);
  assert.doesNotMatch(rHtml, /חשבונית מס/);
  // זיכוי לחשבונית עסקה (חשבונית אחרת, פתוחה)
  const inv2 = await acc.createInvoice({ customer: 'ב', date: '2026-10-01', vatExempt: true, items: item(500) });
  const credit = await acc.createCreditNote(inv2.id, { date: '2026-10-02', reason: 'החזרה' });
  assert.equal(credit.kindLabel, 'חשבונית זיכוי');
  const cHtml = X.renderInvoiceHtml(await acc.getSalesDoc(credit.id), BUSINESS);
  assert.match(cHtml, /<h1>חשבונית זיכוי<\/h1>/);
  assert.match(cHtml, /לחשבונית עסקה:<\/strong> 2/);
  assert.doesNotMatch(cHtml, /חשבונית מס/);
  assert.ok(inv.id);
  // עוסק מורשה — ללא שינוי
  assert.equal(SD.docView({ kind: 'credit' }).kindLabel, 'חשבונית מס זיכוי');
});

// ---------- הדפסה חוזרת ----------
test('הדפסה חוזרת: פרטי העסק מיום ההפקה, בלי גבייה וזיכויים שנוספו אחר כך; "מקור" / "העתק"', async () => {
  const { acc } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'א', date: '2026-10-01', items: item(1000) });
  await acc.saveSettings({ business: { name: 'שם חדש לעסק', taxId: '999999998' }, vatRate: 0.18 });
  await acc.createCreditNote(inv.id, { date: '2026-10-02', reason: 'הנחה', items: [{ description: 'הנחה', quantity: 1, unitPrice: 100 }] });
  await acc.recordPayment(inv.id, { date: '2026-10-03', method: 'cash' });
  const view = await acc.getInvoice(inv.id);
  const { business } = await acc.getSettings();
  const html = X.renderInvoiceHtml(view, business, { copy: false });
  assert.match(html, /ישיבת אור החיים/);
  assert.match(html, /123456782/);
  assert.doesNotMatch(html, /שם חדש לעסק/);
  assert.doesNotMatch(html, /התקבל תשלום|סה"כ שולם|<span>זוכה<\/span>/, 'מה שנוסף אחרי ההפקה אינו חלק מהמסמך');
  assert.match(html, /<div class="copy">מקור<\/div>/);
  assert.match(X.renderInvoiceHtml(view, business, { copy: true }), /העתק נאמן למקור/);
  // ההדפסה הראשונה נרשמת פעם אחת
  assert.equal(await acc.markPrinted('invoice', inv.id), true);
  assert.equal(await acc.markPrinted('invoice', inv.id), false);
  assert.ok((await acc.getInvoice(inv.id)).printedAt);
});

test('חשבונית שבוטלה מודפסת עם סימון הביטול ומספר חשבונית הזיכוי', async (t) => {
  freezeDate(t, '2026-10-20');
  const { acc } = await freshAcc();
  const inv = await acc.createInvoice({ customer: 'א', date: '2026-10-05', items: item(1000) });
  await acc.cancelInvoice(inv.id);
  const html = X.renderInvoiceHtml(await acc.getInvoice(inv.id), BUSINESS);
  assert.match(html, /החשבונית בוטלה בחשבונית זיכוי מספר 1 מתאריך 2026-10-20/);
});

// ---------- עמלות: ע.מ של הלקוח ----------
test('חשבונית עמלה: ע.מ של הלקוח נשמר בחשבונית; מספר שגוי נדחה', async () => {
  const { acc } = await freshAcc();
  const inv = await acc.createAdvisoryReceipt({ customer: 'חברת אור', customerTaxId: '515555555', date: '2026-10-01', grossAgorot: 118000, description: 'עמלת ייעוץ', method: 'transfer', key: 'madv:c1:p1' });
  assert.equal(inv.customerTaxId, '515555555');
  await assert.rejects(acc.createAdvisoryReceipt({ customer: 'א', customerTaxId: '515555556', date: '2026-10-01', grossAgorot: 1000, description: 'x', key: 'madv:c1:p2' }), /ספרת ביקורת/);
});

// ---------- היפוך חשבונית ספק מבטל את מס התשומות ----------
test('היפוך חשבונית ספק מבטל את מס התשומות — בתקופת ההיפוך, והמקור נשאר בתקופה שלו', async (t) => {
  freezeDate(t, '2026-11-10');
  const { acc, db } = await freshAcc();
  const e = await acc.createEntry({ date: '2026-10-03', description: 'נייר', lines: [{ account: '6900', debit: 100 }, { account: '1300', debit: 18 }, { account: '1000', credit: 118 }],
    vatDoc: { supplierTaxId: '514444447', reference: 'INV-778', docDate: '2026-10-02' } });
  await acc.reverseEntry(e.id);
  const { journal } = db.peek();
  assert.equal(A.vatReport(journal, { from: '2026-10-01', to: '2026-10-31' }).inputVat, 18);
  assert.equal(A.vatReport(journal, { from: '2026-11-01', to: '2026-11-30' }).inputVat, -18);
  assert.equal(A.vatReport(journal, {}).inputVat, 0, 'ביחד — אפס');
  const nov = PCN.buildPcn874({ data: db.peek(), business: BUSINESS, month: '2026-11', months: 1, now: Date.now() });
  assert.equal(nov.totals.otherInputVat, -18, 'ההיפוך מדווח בפרטי הספק המקוריים');
  assert.equal(nov.difference, 0);
});

// ---------- שמירה אחת בפעולות שחוצות שירותים ----------
test('inOneSave: כשל באמצע — שום דבר לא נשמר; הצלחה — שמירה אחת; שאר פעולות המסד עוברות', async () => {
  const db = memoryDb();
  db.listUsers = async function () { return this === db ? ['ok'] : []; };
  const s1 = { db }, s2 = { db };
  await assert.rejects(inOneSave([s1, s2], async () => {
    const d = await s1.db.load(); d.invoices.push({ id: 'x' }); await s1.db.save(d);
    assert.deepEqual(await s2.db.listUsers(), ['ok']);
    throw new Error('כשל מדומה');
  }), /כשל מדומה/);
  assert.equal(db.saves, 0);
  assert.equal(s1.db, db, 'המסד חזר לשירותים');
  await inOneSave([s1, s2], async () => {
    const a = await s1.db.load(); a.invoices.push({ id: 'a' }); await s1.db.save(a);
    const b = await s2.db.load(); b.salesDocs.push({ id: 'b' }); await s2.db.save(b);
    // קריאה מקוננת ממשיכה באותה עטיפה
    await inOneSave([s2], async () => { const c = await s2.db.load(); c.journal.push({ id: 'c' }); await s2.db.save(c); });
  });
  assert.equal(db.saves, 1);
  assert.deepEqual([db.peek().invoices.length, db.peek().salesDocs.length, db.peek().journal.length], [1, 1, 1]);
});

// ---------- IPC: עמלת תיווך, PDF ----------
const handlers = {};
const pdfHtml = [];
let saveTo = null;
Module._resolveFilename_orig_r3acct = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r3acct__.js' : Module._resolveFilename_orig_r3acct.call(this, req, ...rest); };
require.cache['/__electron_stub_r3acct__.js'] = {
  id: '/__electron_stub_r3acct__.js', filename: '/__electron_stub_r3acct__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    BrowserWindow: function () {
      const listeners = {};
      return { loadURL: async (u) => { pdfHtml.push(Buffer.from(u.split(',')[1], 'base64').toString('utf8')); },
        webContents: { printToPDF: async () => Buffer.from('%PDF'), on: (ev, fn) => { listeners[ev] = fn; }, setWindowOpenHandler: (fn) => { listeners.open = fn; } },
        destroy() {}, _listeners: listeners };
    },
    dialog: { showSaveDialog: async () => (saveTo ? { canceled: false, filePath: saveTo } : { canceled: true }) }
  }
};
const ev = (id) => ({ sender: { id } });
let ipc;
test.before(async () => {
  ipc = require('../modules/econ/ipc');
  await ipc.initEcon(tmpDir('ss-r3acct-'), { relayUrl: '' });
  await handlers['auth:setup'](ev(301), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(301), 'menahel', 'menahel-strong-pass-1');
  await handlers['acct:saveSettings'](ev(301), { business: BUSINESS, vatRate: 0.18 });
});

async function commissionDeal(name) {
  const seller = await handlers['rlty:createClient'](ev(301), { name: 'משפחת לוי ' + name, role: 'seller' });
  const buyer = await handlers['rlty:createClient'](ev(301), { name: 'חברת ' + name, role: 'buyer' });
  const p = await handlers['rlty:createProperty'](ev(301), { city: 'בני ברק', street: 'רחוב רבי עקיבא 10', asking: 2000000, ownerClientId: seller.id });
  const d = await handlers['rlty:createDeal'](ev(301), { propertyId: p.id, buyerClientId: buyer.id, stage: 'contract' });
  await handlers['rlty:setCommissions'](ev(301), d.id, { buyer: { type: 'fixed', value: 10000 } });
  const pay = await handlers['rlty:addCommissionPayment'](ev(301), d.id, { side: 'buyer', date: '2026-10-20', amount: 11800, method: 'transfer' });
  return { d, pay };
}

test('IPC: חשבונית עמלת תיווך עם ע.מ של הלקוח שהוקלד', async () => {
  const { d, pay } = await commissionDeal('אור');
  const inv = await handlers['rlty:issueCommissionInvoice'](ev(301), d.id, pay.payment.id, { confirmed: true, customerTaxId: '515555555' });
  const stored = (await handlers['acct:getInvoices'](ev(301))).find(i => i.id === inv.id);
  assert.equal(stored.customerTaxId, '515555555');
});

test('IPC: כשל בקישור החשבונית לתשלום — החשבונית לא נשמרת (שמירה אחת)', async () => {
  const { d, pay } = await commissionDeal('אמונה');
  const before = (await handlers['acct:getInvoices'](ev(301))).length;
  const { RealtyService } = require('../modules/econ/services/realtyService');
  const orig = RealtyService.linkCommissionInvoice;
  RealtyService.linkCommissionInvoice = async () => { throw new Error('כשל מדומה בקישור'); };
  try {
    await assert.rejects(handlers['rlty:issueCommissionInvoice'](ev(301), d.id, pay.payment.id, { confirmed: true }), /כשל מדומה/);
  } finally { RealtyService.linkCommissionInvoice = orig; }
  assert.equal((await handlers['acct:getInvoices'](ev(301))).length, before, 'אין חשבונית ממוספרת בלי קישור');
  // ניסיון חוזר מצליח, עם המספר הבא ברצף
  const inv = await handlers['rlty:issueCommissionInvoice'](ev(301), d.id, pay.payment.id, { confirmed: true });
  assert.ok(inv.number > 0);
});

test('IPC: PDF של חשבונית — CSP בלי רשת, "מקור" בהדפסה הראשונה ו"העתק" אחריה', async () => {
  const inv = await handlers['acct:createInvoice'](ev(301), { customer: 'משה כהן', date: '2026-10-01', items: item(100) });
  saveTo = path.join(tmpDir('ss-r3acct-pdf-'), 'a.pdf');
  try {
    pdfHtml.length = 0;
    const r1 = await handlers['acct:exportInvoicePdf'](ev(301), inv.id);
    assert.equal(r1.ok, true);
    const r2 = await handlers['acct:exportInvoicePdf'](ev(301), inv.id);
    assert.equal(r2.ok, true);
  } finally { saveTo = null; }
  assert.equal(pdfHtml.length, 2);
  assert.match(pdfHtml[0], /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">/);
  assert.match(pdfHtml[0], /<div class="copy">מקור<\/div>/);
  assert.match(pdfHtml[1], /העתק נאמן למקור/);
  // ביטול השמירה בחלון — ההדפסה לא נרשמת
  const inv2 = await handlers['acct:createInvoice'](ev(301), { customer: 'משה כהן', date: '2026-10-01', items: item(100) });
  await handlers['acct:exportInvoicePdf'](ev(301), inv2.id);
  assert.equal((await handlers['acct:getInvoices'](ev(301))).find(i => i.id === inv2.id).printedAt, undefined);
});
