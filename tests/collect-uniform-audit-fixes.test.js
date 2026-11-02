// בדיקות רגרסיה לממצאי בדיקת הקוד "קבצים רשמיים וגבייה" (docs/audit-parts/audit-official-files.md):
// 1 — מספר דרישה ששולמה/בוטלה לא עובר להתאמה לפי שם; 5 — דרישה לחשבונית = היתרה אחרי זיכויים;
// 6 — סטטוס בדוח הסליקה ברשימה לבנה; 7 — ביטול תשלום בחשבונית מס/קבלה (320) חסום, ו-paymentRef מתאפס;
// 9 — תשלום חשבונית דרך דף התשלום נרשם בכרטיס אשראי עם מספר העסקה; 11 — פטור + "שולמה עכשיו" = 300 + קבלה 400;
// 12 — שיעור המע"מ בשדה 1268 נשמר בחשבונית; 13 — תאריכים מקומיים ולא UTC. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const P = require('../modules/econ/core/collect');
const UF = require('../modules/econ/core/uniformFile');
const { initializeDatabase } = require('../modules/econ/core/database');

const ROOT = path.join(__dirname, '..');
const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782', address: 'רחוב רבי עקיבא 1, בני ברק' };

async function setup() {
  const db = await initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-e-')));
  const fresh = (n) => { delete require.cache[require.resolve('../modules/econ/services/' + n)]; };
  for (const n of ['collectService', 'accountingService', 'npoService', 'gemachService']) fresh(n);
  const S = (n, k) => require('../modules/econ/services/' + n)[k];
  const acc = S('accountingService', 'AccountingService');
  const npo = S('npoService', 'NpoService');
  const gem = S('gemachService', 'GemachService');
  const col = S('collectService', 'CollectService');
  for (const s of [acc, npo, gem, col]) s.initialize(db);
  await acc.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  return { db, acc, npo, gem, col };
}

// רשימת דרישות לבדיקות הטהורות של matchReport
function requestsOf(list) {
  const s = P.normalizeSettings({});
  const reqs = [];
  for (const input of list) {
    const r = P.createRequest(input, s, reqs.length);
    s.nextNumber = r.settings.nextNumber;
    r.req.createdAt = '2026-10-01T08:00:00.000Z'; // לפני התאריכים שבדוחות (שורה מלפני הדרישה לא מותאמת לפי שם)
    reqs.push(r.req);
  }
  return reqs;
}

// פירוק הקובץ במבנה אחיד לרשומות, ושדה לפי מספרו — המיקום מחושב מ-LAYOUTS
const records = (buf) => buf.toString('latin1').split('\r\n').filter(Boolean);
function fieldOf(rec, no) {
  let pos = 0;
  for (const [n, , len] of UF.LAYOUTS[rec.slice(0, 4)]) {
    if (n === no) return rec.slice(pos, pos + len);
    pos += len;
  }
  throw new Error('שדה לא קיים ' + no);
}
const ofKind = (out, kind) => records(out.dataTxt).filter(r => r.startsWith(kind));
const docsOf = (out) => ofKind(out, 'C100').map(r => Number(fieldOf(r, 1203)));
const d120Of = (out) => ofKind(out, 'D120')
  .map(r => ({ type: Number(fieldOf(r, 1303)), method: fieldOf(r, 1306), cheque: fieldOf(r, 1310), amount: fieldOf(r, 1312) }));

// ---------- ממצא 1: מספר דרישה מפורש שכבר שולם / בוטל ----------
test('ממצא 1 (גמ"ח): שורה עם מספר דרישה ששולמה ידנית לא משויכת לתשלום הבא של אותו לווה', async () => {
  const { gem, col } = await setup();
  const loan = await gem.addLoan({ borrowerName: 'אברהם שטרן', borrowerId: '000000018', amount: 1200, installments: 12, issueDate: '2026-09-01' });
  const r1 = await col.createRequest({ kind: 'gemach', targetId: loan.id, seq: 1, amount: 100, payerName: 'אברהם שטרן' });
  const r2 = await col.createRequest({ kind: 'gemach', targetId: loan.id, seq: 2, amount: 100, payerName: 'אברהם שטרן' });
  await col.markPaid(r1.id, { date: '2026-10-01' }); // סימון ידני בלי מספר עסקה
  const csv = `תאריך,סכום,שם,הערה,מספר עסקה\n05/10/2026,100,אברהם שטרן,${r1.ref},T900\n`;
  const pv = await col.previewImport(csv);
  assert.deepEqual(pv.match.matched, [], 'לא שויך לתשלום 2');
  assert.equal(pv.match.unmatched.length, 1);
  assert.match(pv.match.unmatched[0].reason, /הדרישה כבר סומנה כשולמה/);
  const res = await col.importReport(csv, pv.mapping);
  assert.deepEqual(res.recorded, []);
  const schedule = (await gem.getLoan(loan.id)).schedule;
  assert.equal(schedule[0].paidAg, 10000);
  assert.equal(schedule[1].paidAg, 0, 'תשלום 2 לא סומן כנפרע');
  assert.equal((await col.getOverview()).requests.find(r => r.id === r2.id).status, 'open');
});

test('ממצא 1 (תרומות): דוח בלי עמודת מספר עסקה שנקלט פעמיים — קבלה אחת בלבד', async () => {
  const { npo, col } = await setup();
  await npo.saveSettings({ orgName: 'ישיבת אור החיים', regNumber: '580000003' });
  const r1 = await col.createRequest({ kind: 'donation', amount: 180, payerName: 'משה גרין', description: 'תרומה' });
  const r2 = await col.createRequest({ kind: 'donation', amount: 180, payerName: 'משה גרין', description: 'תרומה' });
  const csv = `תאריך,סכום,שם,הערה\n15/10/2026,180,משה גרין,${r1.ref}\n`;
  const pv = await col.previewImport(csv);
  const first = await col.importReport(csv, pv.mapping);
  assert.deepEqual(first.recorded.map(x => x.ref), [r1.ref]);
  const second = await col.importReport(csv, pv.mapping);
  assert.deepEqual(second.recorded, [], 'הקליטה החוזרת לא רושמת תרומה נוספת');
  assert.match(second.unmatched[0].reason, /הדרישה כבר סומנה כשולמה/);
  const donations = (await npo._load()).npo.donations;
  assert.equal(donations.length, 1, 'קבלת סעיף 46 אחת');
  assert.equal((await col.getOverview()).requests.find(r => r.id === r2.id).status, 'open');
});

test('ממצא 1: מספר דרישה שבוטלה — "הדרישה בוטלה"; שורה בלי מספר עדיין מותאמת לפי שם וסכום', () => {
  const reqs = requestsOf([
    { kind: 'other', amount: 50, payerName: 'ישיבת אור החיים' }, // P00001 — תבוטל
    { kind: 'other', amount: 50, payerName: 'ישיבת אור החיים' }, // P00002
  ]);
  reqs[0].status = 'cancelled';
  const csv = 'תאריך,סכום,שם,הערה\n15/10/2026,50,ישיבת אור החיים,P00001\n16/10/2026,50,ישיבת אור החיים,\n';
  const map = { date: 'תאריך', amount: 'סכום', name: 'שם', ref: 'הערה' };
  const m = P.matchReport(csv, map, reqs);
  assert.deepEqual(m.matched.map(x => `${x.line}:${x.ref}:${x.how}`), ['3:P00002:name']);
  assert.equal(m.unmatched.length, 1);
  assert.equal(m.unmatched[0].line, 2);
  assert.match(m.unmatched[0].reason, /הדרישה בוטלה/);
});

// ---------- ממצא 6: סטטוס — רשימה לבנה ----------
test('ממצא 6: רק סטטוס ריק או מילת הצלחה מוכרת נחשב תשלום; "ממתין"/pending — לא מוכר; נכשל — מדולג', () => {
  const names = ['אברהם שטרן', 'משה גרין', 'יעקב לוי', 'יצחק כהן', 'שמואל פרידמן', 'דוד ברגר', 'אהרן וייס', 'יוסף קליין'];
  const reqs = requestsOf(names.map(n => ({ kind: 'other', amount: 100, payerName: n })));
  const rows = [
    ['ממתין לאישור', 'P00001'], ['pending', 'P00002'], [' Approved ', 'P00003'], ['הצליחה', 'P00004'],
    ['נדחה', 'P00005'], ['', 'P00006'], ['לא שולם', 'P00007'], ['SUCCESS', 'P00008'],
  ];
  const csv = 'תאריך,סכום,הערה,סטטוס\n' + rows.map(([st, ref]) => `15/10/2026,100,${ref},${st}`).join('\n') + '\n';
  const m = P.matchReport(csv, { date: 'תאריך', amount: 'סכום', ref: 'הערה', status: 'סטטוס' }, reqs);
  assert.deepEqual(m.matched.map(x => x.ref).sort(), ['P00003', 'P00004', 'P00006', 'P00008']);
  assert.equal(m.skipped, 1, 'נדחה — מדולג כמו קודם');
  assert.deepEqual(m.unmatched.map(u => u.refText).sort(), ['P00001', 'P00002', 'P00007']);
  for (const u of m.unmatched) assert.match(u.reason, /סטטוס לא מוכר: /);
  assert.match(m.unmatched.find(u => u.refText === 'P00001').reason, /ממתין לאישור/);
});

// ---------- ממצא 5: דרישה לחשבונית = היתרה אחרי זיכויים ----------
test('ממצא 5: דרישה לחשבונית שזוכתה חלקית — בסכום היתרה; זוכתה במלואה — נחסמת', async () => {
  const { acc, col, db } = await setup();
  const inv = await acc.createInvoice({ customer: 'ישיבת אור החיים', date: '2026-10-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }] });
  await acc.createCreditNote(inv.id, { date: '2026-10-02', reason: 'החזרת ספר', items: [{ description: 'ספר', quantity: 1, unitPrice: 100 }] });
  assert.equal((await acc.getInvoice(inv.id)).balance, 1062);
  await assert.rejects(col.createRequest({ kind: 'invoice', targetId: inv.id, amount: 1180, payerName: 'ישיבת אור החיים' }), /1062/);
  const r = await col.createRequest({ kind: 'invoice', targetId: inv.id, amount: 1062, payerName: 'ישיבת אור החיים' });
  assert.equal(r.amountAg, 106200);
  await col.markPaid(r.id, { date: '2026-10-05' });
  const receipt = (await db.load()).salesDocs.find(d => d.kind === 'receipt');
  assert.equal(receipt.total, 1062, 'הקבלה = מה שהלקוח התבקש לשלם');

  const full = await acc.createInvoice({ customer: 'משה גרין', date: '2026-10-01', items: [{ description: 'שירות', quantity: 1, unitPrice: 100 }] });
  await acc.createCreditNote(full.id, { date: '2026-10-02', reason: 'ביטול העסקה' });
  await assert.rejects(col.createRequest({ kind: 'invoice', targetId: full.id, amount: 118, payerName: 'משה גרין' }), /אין יתרה/);
  await assert.rejects(col.createRequest({ kind: 'invoice', targetId: full.id, amount: 0.01, payerName: 'משה גרין' }), /אין יתרה/);
});

test('ממצא 5: זיכוי שהופק אחרי יצירת הדרישה — התשלום לא נרשם בסכום אחר מזה שהלקוח שילם', async () => {
  const { acc, col } = await setup();
  const inv = await acc.createInvoice({ customer: 'אברהם שטרן', date: '2026-10-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }] });
  const r = await col.createRequest({ kind: 'invoice', targetId: inv.id, amount: 1180, payerName: 'אברהם שטרן' });
  await acc.createCreditNote(inv.id, { date: '2026-10-02', reason: 'החזרת ספר', items: [{ description: 'ספר', quantity: 1, unitPrice: 100 }] });
  await assert.rejects(col.markPaid(r.id, { date: '2026-10-05' }), /שונה מסכום הדרישה/);
  assert.equal((await acc.getInvoice(inv.id)).status, 'open', 'לא נרשמה גבייה חלקית בשקט');
  assert.equal((await col.getOverview()).requests.find(x => x.id === r.id).status, 'open');
});

test('ממצא 5 (ממשק): דרישה חדשה לחשבונית — הסכום הוא היתרה, וחשבונית בלי יתרה לא מוצעת', async () => {
  const EconUI = require('./helpers/econ-ui');
  const created = [];
  const offered = [];
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  context.systemAPI = {
    getInvoices: async () => [
      { id: 'a', number: 7, customer: 'ישיבת אור החיים', status: 'open', total: 1180, credited: 118, balance: 1062 },
      { id: 'b', number: 8, customer: 'משה גרין', status: 'open', total: 118, credited: 118, balance: 0 },
    ],
    collectCreateRequest: async (input) => { created.push(input); return { id: 'r1' }; },
    collectGetMessage: async () => ({ text: '', link: '', ref: 'P00001' }),
  };
  let step = 0;
  context.licForm = async (title, fields) => {
    step += 1;
    if (step === 1) return { kind: 'invoice' };
    offered.push(...fields[0].options.map(o => o[0]));
    return { targetId: 'a', payerPhone: '' };
  };
  context.collectMessageDialog = async () => null;
  assert.equal(await vm.runInContext('collectNewRequest()', context), true);
  assert.deepEqual(offered, ['a'], 'חשבונית שזוכתה במלואה לא מוצעת');
  assert.equal(created.length, 1);
  assert.equal(created[0].amount, 1062);
});

// ---------- ממצא 9: תשלום חשבונית דרך דף התשלום ----------
test('ממצא 9: חשבונית ששולמה דרך דף התשלום — קבלה בכרטיס אשראי עם מספר העסקה (או מספר הדרישה)', async () => {
  const { acc, col, db } = await setup();
  const a = await acc.createInvoice({ customer: 'יעקב לוי', date: '2026-10-01', items: [{ description: 'שירות', quantity: 1, unitPrice: 100 }] });
  const b = await acc.createInvoice({ customer: 'יצחק כהן', date: '2026-10-01', items: [{ description: 'שירות', quantity: 1, unitPrice: 50 }] });
  const ra = await col.createRequest({ kind: 'invoice', targetId: a.id, amount: a.total, payerName: 'יעקב לוי' });
  const rb = await col.createRequest({ kind: 'invoice', targetId: b.id, amount: b.total, payerName: 'יצחק כהן' });
  await col.markPaid(ra.id, { date: '2026-10-05', txId: 'T-555' });
  await col.markPaid(rb.id, { date: '2026-10-05' });
  const receipts = (await db.load()).salesDocs.filter(d => d.kind === 'receipt').sort((x, y) => x.number - y.number);
  assert.deepEqual(receipts.map(r => [r.invoiceId, r.method, r.reference]), [[a.id, 'card', 'T-555'], [b.id, 'card', rb.ref]]);
  assert.equal((await acc.getInvoice(a.id)).paymentMethod, 'card');
  const out = await acc.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { now: Date.now() });
  assert.deepEqual(d120Of(out).map(d => d.method), ['3', '3'], 'שדה 1306 = 3 (כרטיס אשראי)');
});

// ---------- ממצא 7: חשבונית מס/קבלה (320) ----------
test('ממצא 7: ביטול תשלום בחשבונית מס/קבלה חסום — ההפניה לחשבונית זיכוי, ופרטי התקבול בקובץ לא משתנים', async () => {
  const { acc } = await setup();
  const inv = await acc.createInvoice({ customer: 'ישיבת אור החיים', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 1000 }],
    paidNow: { method: 'check', reference: '123' } });
  assert.equal(inv.kind, 'tax-invoice-receipt');
  await assert.rejects(acc.unrecordPayment(inv.id), /חשבונית זיכוי/);
  const after = await acc.getInvoice(inv.id);
  assert.equal(after.status, 'paid');
  assert.equal(after.paymentMethod, 'check');
  assert.equal(after.paymentRef, '123');
  const out = await acc.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { now: Date.now() });
  assert.deepEqual(d120Of(out), [{ type: 320, method: '2', cheque: '0000000123', amount: '+00000000118000' }], 'D120 אחד, מההמחאה המקורית');
  // הדרך הנכונה — חשבונית זיכוי על ה-320
  const credit = await acc.createCreditNote(inv.id, { date: '2026-07-10', reason: 'ההמחאה חזרה' });
  assert.equal(credit.total, 1180);
});

test('ממצא 7: ביטול תשלום בחשבונית רגילה מוחק גם את האסמכתה — לא נשארת אסמכתה ישנה לתשלום החדש', async () => {
  const { acc } = await setup();
  const inv = await acc.createInvoice({ customer: 'משה גרין', date: '2026-07-01', items: [{ description: 'שירות', quantity: 1, unitPrice: 100 }] });
  await acc.recordPayment(inv.id, { date: '2026-07-02', method: 'check', reference: '000456' });
  const unpaid = await acc.unrecordPayment(inv.id);
  assert.equal(unpaid.status, 'open');
  assert.equal(unpaid.paymentRef, undefined);
  const repaid = await acc.recordPayment(inv.id, { date: '2026-07-03', method: 'transfer' });
  assert.equal(repaid.paymentMethod, 'transfer');
  assert.equal(repaid.paymentRef, undefined, 'אין שארית של מספר ההמחאה');
});

test('ממצא 7 (ממשק): בחשבונית מס/קבלה אין כפתור "בטל תשלום" — יש חשבונית זיכוי; בחשבונית רגילה ששולמה — יש', () => {
  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const html = vm.runInContext(`renderAcctInvoices({ invoices: [
    { id: 'a', number: 1, customer: 'א', date: '2026-07-01', net: 100, vat: 18, total: 118, balance: 118, status: 'paid', kind: 'tax-invoice-receipt' },
    { id: 'b', number: 2, customer: 'ב', date: '2026-07-01', net: 100, vat: 18, total: 118, balance: 118, status: 'paid' }
  ] })`, context);
  const card = (n) => html.split(/<div class="card [^-]/).find(c => c.includes(`חשבונית ${n} ·`));
  assert.doesNotMatch(card(1), /data-action="unpay"/);
  assert.match(card(1), /data-action="credit" data-id="a"/);
  assert.match(card(2), /data-action="unpay" data-id="b"/);
});

// ---------- ממצא 11: פטור + "שולמה עכשיו" ----------
test('ממצא 11: חשבונית פטורה ששולמה בשמירה — חשבונית עסקה (300) וקבלה (400), לא 320', async () => {
  const { acc, db } = await setup();
  const inv = await acc.createInvoice({ customer: 'יעקב לוי', date: '2026-07-01', vatExempt: true,
    items: [{ description: 'שיעור פרטי', quantity: 1, unitPrice: 200 }], paidNow: { method: 'cash' } });
  assert.notEqual(inv.kind, 'tax-invoice-receipt');
  assert.equal(inv.status, 'paid');
  const receipts = (await db.load()).salesDocs.filter(d => d.kind === 'receipt');
  assert.deepEqual(receipts.map(r => [r.invoiceId, r.total, r.method]), [[inv.id, 200, 'cash']]);
  const out = await acc.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { now: Date.now() });
  assert.deepEqual(docsOf(out), [300, 400]);
  // חשבונית מס/קבלה רגילה (לא פטורה) — עדיין 320 בלי קבלה נפרדת
  const taxed = await acc.createInvoice({ customer: 'משה גרין', date: '2026-07-02', items: [{ description: 'ספר', quantity: 1, unitPrice: 100 }], paidNow: { method: 'card' } });
  assert.equal(taxed.kind, 'tax-invoice-receipt');
  assert.equal((await db.load()).salesDocs.filter(d => d.kind === 'receipt').length, 1);
});

test('ממצא 11: נתונים ישנים — פטור שסומן כחשבונית מס/קבלה מדווח כ-300', () => {
  assert.equal(UF.docTypeOf({ vatExempt: true, kind: 'tax-invoice-receipt' }), 300);
  assert.equal(UF.docTypeOf({ vatExempt: false, kind: 'tax-invoice-receipt' }), 320);
  assert.equal(UF.docTypeOf({}), 305);
});

// ---------- ממצא 12: שיעור המע"מ בשדה 1268 ----------
test('ממצא 12: שיעור המע"מ נשמר בחשבונית ונכתב לשדה 1268 גם בחשבונית קטנה', async () => {
  const { acc } = await setup();
  const inv = await acc.createInvoice({ customer: 'יצחק כהן', date: '2026-07-01', items: [{ description: 'עט', quantity: 1, unitPrice: 2.75 }] });
  assert.equal(inv.vat, 0.5);
  assert.equal(inv.vatRate, 0.18);
  const exempt = await acc.createInvoice({ customer: 'יצחק כהן', date: '2026-07-01', vatExempt: true, items: [{ description: 'עט', quantity: 1, unitPrice: 2.75 }] });
  assert.equal(exempt.vatRate, undefined, 'בחשבונית פטורה אין שיעור');
  const out = await acc.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { now: Date.now() });
  const d110 = ofKind(out, 'D110').map(r => [Number(fieldOf(r, 1253)), fieldOf(r, 1268)]);
  assert.deepEqual(d110, [[300, '0000'], [305, '1800']]);
});

test('ממצא 12: חשבונית ישנה בלי שיעור — מתיישרת לשיעור החוקי הקרוב; שיעור שנשמר גובר', () => {
  assert.equal(UF.vatRateCode({ net: 2.75, vat: 0.5 }), 1800);
  assert.equal(UF.vatRateCode({ net: 0.85, vat: 0.15 }), 1800);
  assert.equal(UF.vatRateCode({ net: 100, vat: 18 }), 1800);
  assert.equal(UF.vatRateCode({ net: 100, vat: 17 }), 1700, '17% (2015–2024)');
  assert.equal(UF.vatRateCode({ net: 0.85, vat: 0.15, vatRate: 0.17 }), 1700);
  assert.equal(UF.vatRateCode({ net: 100, vat: 0, vatExempt: true }), 0);
  // סכום קטן ששני השיעורים מסבירים — השיעור החוקי בתאריך החשבונית, ואחריו השיעור שבהגדרות
  assert.equal(UF.vatRateCode({ net: 0.85, vat: 0.15, date: '2024-06-01' }), 1700);
  assert.equal(UF.vatRateCode({ net: 0.85, vat: 0.15, date: '2026-06-01' }), 1800);
  assert.equal(UF.vatRateCode({ net: 0.85, vat: 0.15, date: '2014-06-01' }, { fallbackRate: 0.17 }), 1700);
  // שיעור התאריך שלא מסביר את הסכומים — לא נכפה
  assert.equal(UF.vatRateCode({ net: 100, vat: 17, date: '2026-06-01' }), 1700);
});

// ---------- ממצא 13: תאריכים מקומיים ----------
// תהליך נפרד עם TZ=Asia/Jerusalem ושעון קפוא על 1.8.2026 01:30 (שעון קיץ, UTC+3 = 31.7 22:30 UTC)
test('ממצא 13: ביטול חשבונית, רשומת ההיפוך וסימון "שולם" בגבייה ב-1.8 בשעה 01:30 — בתאריך 2026-08-01', () => {
  const svc = (n) => JSON.stringify(path.join(ROOT, 'modules', 'econ', 'services', n));
  const SCRIPT = `
    const FIXED = Date.UTC(2026, 6, 31, 22, 30);
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(FIXED); }
      static now() { return FIXED; }
    }
    globalThis.Date = FrozenDate;
    (async () => {
      const fs = require('fs'), os = require('os'), path = require('path');
      const { initializeDatabase } = require(${JSON.stringify(path.join(ROOT, 'modules', 'econ', 'core', 'database'))});
      const db = await initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-e-tz-')));
      const acc = require(${svc('accountingService')}).AccountingService;
      const col = require(${svc('collectService')}).CollectService;
      for (const s of [acc, col, require(${svc('npoService')}).NpoService, require(${svc('gemachService')}).GemachService]) s.initialize(db);
      await acc.saveSettings({ business: { name: 'ישיבת אור החיים', taxId: '123456782' }, vatRate: 0.18 });
      const now = new Date();
      const local = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate() + ' ' + now.getHours() + ':' + now.getMinutes();
      const inv = await acc.createInvoice({ customer: 'משה גרין', date: '2026-07-20', items: [{ description: 'ספר', quantity: 1, unitPrice: 100 }] });
      const cancelled = await acc.cancelInvoice(inv.id);
      // ביטול = חשבונית זיכוי; רשומת היומן שלה היא ההיפוך (סקירת קוד 2.11.2026)
      const snap = await db.load();
      const reversal = snap.journal.find(e => e.id === snap.salesDocs.find(d => d.id === cancelled.cancelCreditId).entryId);
      const undated = await acc.createInvoice({ customer: 'משה גרין', items: [{ description: 'ספר', quantity: 1, unitPrice: 100 }] });
      const paid = await acc.recordPayment(undated.id, { method: 'cash' });
      const req = await col.createRequest({ kind: 'other', amount: 50, payerName: 'אברהם שטרן' });
      const marked = await col.markPaid(req.id, {});
      process.stdout.write(JSON.stringify({ local, cancelledAt: cancelled.cancelledAt, reversalDate: reversal.date,
        invoiceDate: undated.date, paidAt: paid.paidAt, markPaidDate: marked.payment.date }));
    })().catch(e => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ['-e', SCRIPT], { encoding: 'utf8', timeout: 60000, env: { ...process.env, TZ: 'Asia/Jerusalem' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.local, '2026-8-1 1:30', 'השעון הקפוא בשעון ישראל');
  assert.deepEqual(out, { local: out.local, cancelledAt: '2026-08-01', reversalDate: '2026-08-01',
    invoiceDate: '2026-08-01', paidAt: '2026-08-01', markPaidDate: '2026-08-01' });
});

// בדיקה חוזרת 21.10.2026 (audit-recheck-fixes.md, ממצא 2): דוח של "30 הימים האחרונים" חופף לדוח הקודם.
// שורה בלי מספר דרישה ובלי מספר עסקה, שכבר נרשמה לפי שם, הותאמה שוב לדרישה החדשה של אותו לווה
test('בדיקה חוזרת 2: תשלום שכבר נקלט לפי שם לא נרשם שוב לדרישה חדשה באותו שם וסכום', () => {
  const map = { date: 'תאריך', amount: 'סכום', name: 'שם' };
  const reqs = requestsOf([
    { kind: 'other', amount: 500, payerName: 'אברהם גולדברג' }, // P00001 — שולם בספטמבר
    { kind: 'other', amount: 500, payerName: 'אברהם גולדברג' }, // P00002 — התשלום של אוקטובר
  ]);
  reqs[0].createdAt = '2026-09-01T08:00:00.000Z';
  reqs[0].status = 'paid';
  reqs[0].payment = { date: '2026-09-05', source: 'report', how: 'name', name: 'אברהם גולדברג', txId: '' };
  const csv = 'תאריך,סכום,שם\n05/09/2026,500,אברהם גולדברג\n';
  const m = P.matchReport(csv, map, reqs);
  assert.deepEqual(m.matched, [], 'השורה של 5.9 לא משויכת ל-P00002');
  assert.equal(m.unmatched.length, 1);
  assert.match(m.unmatched[0].reason, /ייתכן שהתשלום כבר נקלט \(P00001/);
  // התשלום האמיתי של אוקטובר — עדיין מותאם
  const oct = P.matchReport('תאריך,סכום,שם\n05/10/2026,500,אברהם גולדברג\n', map, reqs);
  assert.deepEqual(oct.matched.map(x => `${x.ref}:${x.how}`), ['P00002:name']);
  // מספרי עסקה שונים — שני תשלומים שונים באותו יום, לא חשד
  reqs[0].payment.txId = 'T1';
  const other = P.matchReport('תאריך,סכום,שם,מספר עסקה\n05/09/2026,500,אברהם גולדברג,T2\n', { ...map, txId: 'מספר עסקה' }, reqs);
  assert.deepEqual(other.unmatched.map(u => u.reason).filter(r => /כבר נקלט/.test(r)), []);
});

test('בדיקה חוזרת 2: שורה מתאריך שלפני יצירת הדרישה לא מותאמת לה לפי שם', () => {
  const map = { date: 'תאריך', amount: 'סכום', name: 'שם' };
  const reqs = requestsOf([{ kind: 'other', amount: 500, payerName: 'אברהם גולדברג' }]);
  reqs[0].createdAt = '2026-10-01T08:00:00.000Z';
  const m = P.matchReport('תאריך,סכום,שם\n05/09/2026,500,אברהם גולדברג\n30/09/2026,500,אברהם גולדברג\n', map, reqs);
  assert.deepEqual(m.matched, [], 'תשלומים מספטמבר אינם של דרישה מ-1.10');
  assert.equal(m.unmatched.length, 2);
  // אותו יום — כן (הקישור נשלח והלקוח שילם מיד). 01:30 בלילה בישראל = 22:30 UTC ביום הקודם
  reqs[0].createdAt = '2026-09-30T22:30:00.000Z';
  const sameDay = P.matchReport('תאריך,סכום,שם\n01/10/2026,500,אברהם גולדברג\n', map, reqs);
  assert.deepEqual(sameDay.matched.map(x => x.ref), ['P00001']);
  // מספר הדרישה בשורה גובר על התאריך (שיוך מפורש)
  reqs[0].createdAt = '2026-10-01T08:00:00.000Z';
  const byRef = P.matchReport('תאריך,סכום,שם,הערה\n30/09/2026,500,אברהם גולדברג,P00001\n', { ...map, ref: 'הערה' }, reqs);
  assert.deepEqual(byRef.matched.map(x => `${x.ref}:${x.how}`), ['P00001:ref']);
});
