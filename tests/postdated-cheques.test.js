// המחאות דחויות — קבלה נפרדת לכל שנת מס לפי תאריך הפירעון ("תרומות ישראל", סעיף 2.3.2; PLAN.md 9.14א).
// שלב 1: בדיקות שמקבעות את ההתנהגות של היום, לפני שינוי. הפיצ'ר מוסיף שדות רשות בלבד,
// ולכן כל מה שכאן חייב להמשיך לעבור גם אחריו — תרומה רגילה לא משתנה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const N = require('../modules/econ/core/npo');
const X = require('../modules/econ/core/exports');
const BK = require('../modules/econ/core/backupCrypto');

let nextId = 0;
const SETTINGS = N.applySettings({}, {
  orgName: 'עמותת תפארת בחורים', regNumber: '580123456', sec46Number: '4512345', sec46ValidUntil: '2027-12-31'
}, new Set(), () => 'f' + (++nextId));

const donation = (over = {}, settings = SETTINGS) => {
  const clean = N.validateDonation({ date: '2026-11-20', donorName: 'יוסף ברגר', donorId: '000000018', amount: 1200, method: 'check', ...over }, settings);
  const { receipt, settings: next } = N.issueReceipt(clean, settings);
  return { d: { id: 'd' + (++nextId), ...clean, receipt, status: 'active' }, settings: next };
};

// ---------- מבנה הרשומה ----------

test('מצב קיים: תרומה בהמחאה — רשומה אחת, בלי שדות המחאה', () => {
  const clean = N.validateDonation({ date: '2026-11-20', donorName: 'יוסף ברגר', amount: 1200, method: 'check', reference: '000123' }, SETTINGS);
  assert.deepEqual(Object.keys(clean).sort(), [
    'ambassadorId', 'amount', 'campaignId', 'date', 'donorAddress', 'donorId', 'donorName', 'donorPhone', 'fundId', 'method', 'purpose', 'reference'
  ], 'שדה חדש בתרומה רגילה ישבור את הבדיקה הזו — הפיצ\'ר מוסיף שדות רק לתרומת המחאות');
  assert.equal(clean.method, 'check');
  assert.equal(N.METHODS.check, 'המחאה');
  assert.equal(clean.reference, '000123');
  // שדות שהממשק עלול לשלוח לא נכנסים לרשומה בלי ולידציה
  const extra = N.validateDonation({ date: '2026-11-20', donorName: 'א', amount: 1, cheques: [{ dueDate: '2027-01-01' }], receivedDate: '2026-11-20' }, SETTINGS);
  assert.equal(extra.cheques, undefined);
  assert.equal(extra.receivedDate, undefined);
});

test('מצב קיים: סכום מעוגל לאגורה ונשמר בשקלים', () => {
  assert.equal(N.validateDonation({ donorName: 'א', amount: 333.335 }, SETTINGS).amount, 333.34);
  assert.equal(N.validateDonation({ donorName: 'א', amount: '1000' }, SETTINGS).amount, 1000);
});

// ---------- מספור הקבלות ----------

test('מצב קיים: כמה קבלות ברצף (כמו בייבוא) — מספרים עוקבים, בלי דילוג ובלי כפילות', () => {
  let s = SETTINGS;
  const numbers = [];
  for (const date of ['2026-11-20', '2027-01-15', '2027-02-15']) {
    const r = N.issueReceipt(N.validateDonation({ date, donorName: 'א', amount: 400 }, s), s);
    numbers.push(r.receipt.number);
    s = r.settings;
  }
  assert.deepEqual(numbers, [1, 2, 3]);
  assert.equal(s.receiptSeq, 3);
  assert.equal(SETTINGS.receiptSeq, 0, 'issueReceipt לא משנה את ההגדרות שהתקבלו');
});

test('מצב קיים: זכאות סעיף 46 נקבעת לפי תאריך התרומה מול תוקף האישור', () => {
  assert.equal(donation({ date: '2027-12-31' }).d.receipt.sec46, true);
  const late = donation({ date: '2028-01-01' }).d;
  assert.equal(late.receipt.sec46, false, 'אחרי תום התוקף — בלי סעיף 46');
  assert.equal(N.taxStatus(late), 'not-required');
});

// ---------- שיוך לשנה ----------

test('מצב קיים: כל הסיכומים השנתיים לפי date של התרומה', () => {
  const a = donation({ date: '2026-12-31', amount: 500 }).d;
  const b = donation({ date: '2027-01-01', amount: 700 }).d;
  const list = [a, b];
  assert.equal(N.annualReport(list, [], SETTINGS, 2026).donationsTotal, 500);
  assert.equal(N.annualReport(list, [], SETTINGS, 2027).donationsTotal, 700);
  assert.equal(N.fundSummary(list, [], SETTINGS, 2027).total, 700);
  assert.equal(N.donorAnnualStatement(list, SETTINGS, 'id:000000018', 2026).total, 500);
  assert.equal(N.donorAnnualStatement(list, SETTINGS, 'id:000000018', 2027).total, 700);
  assert.equal(N.donorYearDonations(list, 'id:000000018', 2027).length, 1);
  assert.deepEqual(N.exportTable('donations', list, [], SETTINGS, 2027).rows.map(r => r[1]), ['2027-01-01']);
  assert.throws(() => N.donorAnnualStatement(list, SETTINGS, 'id:000000018', 2028), /לא נמצאו תרומות/);
});

test('מצב קיים: רשימת העבודה לדיווח — שורה לכל קבלה, מכל השנים', () => {
  const a = donation({ date: '2026-11-20' }).d;
  const b = donation({ date: '2027-03-01' }).d;
  const t = N.exportTable('tax', [b, a], [], SETTINGS, 2026);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows.map(r => r[6]), [1200, 1200]);
  assert.ok(t.rows.every(r => r[7] === 'המחאה'));
});

// ---------- הקבלה המודפסת ----------

test('מצב קיים: הקבלה מציגה "המחאה" ואסמכתא אחת, בלי טבלת המחאות', () => {
  const { d } = donation({ reference: '000777' });
  const html = X.renderDonationReceiptHtml(d);
  assert.match(html, /<span>אמצעי תשלום<\/span><span>המחאה · אסמכתא 000777<\/span>/);
  assert.match(html, /<strong>תאריך:<\/strong> 2026-11-20/);
  assert.doesNotMatch(html, /<table/, 'קבלה רגילה — בלי טבלה');
  assert.doesNotMatch(html, /פירעון/);
});

// ---------- הרשאות לערוצים המתוכננים ----------

const handlers = {};
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_cheques__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_cheques__.js'] = {
  id: '/__electron_stub_cheques__.js', filename: '/__electron_stub_cheques__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('permissionFor: שמות הערוצים המתוכננים מקבלים את ההרשאה הנכונה בלי חריג', () => {
  assert.equal(ipc.permissionFor('npo:addChequeDonation'), 'data.edit');
  assert.equal(ipc.permissionFor('npo:cancelCheque'), 'data.delete');
  assert.equal(ipc.permissionFor('npo:addDonation'), 'data.edit');
  assert.equal(ipc.permissionFor('npo:cancelDonation'), 'data.delete');
});

// ---------- IPC מול מסד אמיתי ----------

async function freshLogin(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cheques-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(id), 'cheque_admin', 'cheque-strong-pass-2026');
  await handlers['auth:login'](ev(id), 'cheque_admin', 'cheque-strong-pass-2026');
  await handlers['npo:saveSettings'](ev(id), { orgName: 'עמותת תפארת בחורים', sec46Number: '4512345', sec46ValidUntil: '2027-12-31' });
}

test('IPC מצב קיים: המחאות לשנתיים נרשמות היום כתרומה אחת בשנת ההזנה', async () => {
  await freshLogin(61);
  // 3 המחאות של 400 — אחת לנובמבר 2026 ושתיים ל-2027 — נרשמות היום כתרומה אחת של 1,200 בתאריך ההזנה
  const d = await handlers['npo:addDonation'](ev(61), { date: '2026-11-20', donorName: 'יוסף ברגר', donorId: '000000018', amount: 1200, method: 'check', reference: '101-103' });
  assert.equal(d.receipt.number, 1);
  assert.equal(d.method, 'check');
  const o26 = await handlers['npo:getOverview'](ev(61), 2026);
  const o27 = await handlers['npo:getOverview'](ev(61), 2027);
  assert.equal(o26.report.donationsTotal, 1200, 'כל הסכום בשנה של ההזנה — זה הפער שהפיצ\'ר סוגר');
  assert.equal(o27.report.donationsTotal, 0);
  assert.equal(o26.tax.counts.pending, 1, 'קבלה אחת לדיווח');
});

test('IPC מצב קיים: ביטול שורף את המספר, והקבלה הבאה ממשיכה את הרצף', async () => {
  await freshLogin(62);
  const a = await handlers['npo:addDonation'](ev(62), { date: '2026-11-20', donorName: 'א', amount: 100, method: 'check' });
  const c = await handlers['npo:cancelDonation'](ev(62), a.id);
  assert.equal(c.status, 'cancelled');
  assert.equal(c.receipt.number, 1, 'הקבלה נשארת עם המספר שלה');
  const b = await handlers['npo:addDonation'](ev(62), { date: '2026-11-21', donorName: 'א', amount: 100, method: 'check' });
  assert.equal(b.receipt.number, 2);
  const o = await handlers['npo:getOverview'](ev(62), 2026);
  assert.equal(o.settings.receiptSeq, 2);
});

test('IPC מצב קיים: קמפיין — תאריך התרומה חייב להיות בתוך התקופה, וצמצום תקופה נבדק מול date', async () => {
  await freshLogin(63);
  const cmp = await handlers['npo:saveCampaign'](ev(63), null, { name: 'בניין הישיבה', goal: 100000, startDate: '2026-11-01', endDate: '2026-12-31' });
  await assert.rejects(
    handlers['npo:addDonation'](ev(63), { date: '2027-01-15', donorName: 'א', amount: 400, method: 'check', campaignId: cmp.id }),
    /מחוץ לתקופת הקמפיין/);
  await handlers['npo:addDonation'](ev(63), { date: '2026-12-15', donorName: 'א', amount: 400, method: 'check', campaignId: cmp.id });
  await assert.rejects(
    handlers['npo:saveCampaign'](ev(63), cmp.id, { name: 'בניין הישיבה', goal: 100000, startDate: '2026-11-01', endDate: '2026-11-30' }),
    /מחוץ לתקופה החדשה/);
});

// ---------- שלב 2: הלוגיקה הטהורה ----------

const CHQ = (number, dueDate, amount, over = {}) => ({ number, bank: '12', branch: '345', dueDate, amount, ...over });
const BASE = { donorName: 'יוסף ברגר', donorId: '000000018', receivedDate: '2026-11-20' };

test('validateCheques: ממיין לפי פירעון, שומר אגורות שלמות, ובלי מספר חשבון', () => {
  const out = N.validateCheques([CHQ('103', '2027-01-15', 400), CHQ('101', '2026-11-20', 400.1), { ...CHQ('102', '2026-12-15', 0), amountAg: 39999, account: '999999' }], '2026-11-20');
  assert.deepEqual(out.map(c => c.number), ['101', '102', '103']);
  assert.deepEqual(out.map(c => c.amountAg), [40010, 39999, 40000]);
  assert.ok(out.every(c => Object.keys(c).join() === 'number,bank,branch,dueDate,amountAg'), 'שדה לא מוכר (כמו מספר חשבון) לא נשמר');
});

test('validateCheques: קלט שגוי — שגיאה בעברית עם מספר השורה', () => {
  const v = (list, rec = '2026-11-20') => () => N.validateCheques(list, rec);
  assert.throws(v([]), /לפחות המחאה אחת/);
  assert.throws(v([CHQ('1', '2026-11-19', 10)]), /המחאה 1: תאריך הפירעון .* מוקדם/);
  assert.throws(v([CHQ('1', '2032-01-01', 10)]), /רחוק מדי/);
  assert.throws(v([CHQ('1', '2027-01-01', 10), CHQ('1', '2027-02-01', 10)]), /המחאה 2: .*הוזנה פעמיים/);
  assert.throws(v([CHQ('12a', '2027-01-01', 10)]), /ספרות בלבד/);
  assert.throws(v([CHQ('1', '2027-01-01', 0)]), /הסכום אינו תקין/);
  assert.throws(v([CHQ('1', '2027-01-01', 10, { amountAg: 10.5 })]), /הסכום אינו תקין/, 'אגורות חייבות להיות שלמות');
  assert.throws(v([CHQ('1', '2027-01-01', 10, { bank: 'לאומי' })]), /קוד הבנק/);
  assert.throws(v([CHQ('1', '2027-01-01', 10)], '20-11-2026'), /תאריך קבלת ההמחאות/);
  assert.throws(v(Array.from({ length: N.MAX_CHEQUES + 1 }, (_, i) => CHQ(String(i + 1), '2027-01-01', 1))), /עד 60/);
  // אותו מספר בשני בנקים שונים — מותר
  assert.equal(N.validateCheques([CHQ('1', '2027-01-01', 10), CHQ('1', '2027-01-01', 10, { bank: '20' })], '2026-11-20').length, 2);
});

test('generateCheques: חלוקה שווה באגורות, שארית בהמחאה האחרונה, וסוף חודש', () => {
  const list = N.generateCheques({ total: 1000, count: 3, firstDueDate: '2027-01-31', firstNumber: '000098', bank: '12', branch: '345' });
  assert.deepEqual(list.map(c => c.amountAg), [33333, 33333, 33334]);
  assert.equal(list.reduce((t, c) => t + c.amountAg, 0), 100000, 'הסכום הכולל נשמר עד האגורה');
  assert.deepEqual(list.map(c => c.dueDate), ['2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(list.map(c => c.number), ['000098', '000099', '000100'], 'האפסים שבהתחלה נשמרים');
  assert.deepEqual(N.generateCheques({ total: 1200, count: 12, firstDueDate: '2026-11-15', firstNumber: '1' }).map(c => c.dueDate).slice(1, 3), ['2026-12-15', '2027-01-15'], 'מעבר שנה');
  assert.throws(() => N.generateCheques({ total: 100, count: 0, firstDueDate: '2027-01-01', firstNumber: '1' }), /בין 1 ל-60/);
  assert.throws(() => N.generateCheques({ total: 0.02, count: 3, firstDueDate: '2027-01-01', firstNumber: '1' }), /הסכום הכולל/);
});

test('planChequeDonation: תרומה לכל שנת מס, date לפי הכלל, וסכום לפי ההמחאות של אותה שנה', () => {
  const plan = N.planChequeDonation({ ...BASE, cheques: [CHQ('101', '2026-12-15', 400), CHQ('102', '2027-01-15', 400), CHQ('103', '2027-02-15', 400)] }, SETTINGS);
  assert.equal(plan.totalAg, 120000);
  assert.equal(plan.donations.length, 2);
  const [a, b] = plan.donations;
  assert.equal(a.date, '2026-11-20', 'בשנת הקבלה — יום הקבלה');
  assert.equal(b.date, '2027-01-15', 'בשנה אחרת — הפירעון הראשון בה');
  assert.deepEqual([a.amount, b.amount], [400, 800]);
  assert.deepEqual(b.cheques.map(c => c.number), ['102', '103']);
  assert.equal(a.reference, '101');
  assert.equal(b.reference, '102–103');
  assert.ok(plan.donations.every(d => d.method === 'check' && d.receivedDate === '2026-11-20' && d.donorId === '000000018'));
  assert.equal(plan.donations.some(d => 'receipt' in d), false, 'תכנון בלבד — בלי קבלה');
  assert.deepEqual(plan.warnings, []);
});

test('planChequeDonation: כל ההמחאות בשנה הבאה — קבלה אחת בתאריך הפירעון הראשון', () => {
  const plan = N.planChequeDonation({ ...BASE, cheques: [CHQ('7', '2027-03-01', 500), CHQ('8', '2027-04-01', 500)] }, SETTINGS);
  assert.equal(plan.donations.length, 1);
  assert.equal(plan.donations[0].date, '2027-03-01');
});

test('planChequeDonation: אישור סעיף 46 שפג לפני שנה מסוימת — אזהרה, לא חסימה', () => {
  const plan = N.planChequeDonation({ ...BASE, cheques: [CHQ('1', '2027-06-01', 100), CHQ('2', '2028-01-15', 100)] }, SETTINGS);
  assert.equal(plan.donations.length, 2);
  assert.deepEqual(plan.warnings.map(w => [w.code, w.year]), [['sec46-lapsed', 2028]]);
  assert.match(plan.warnings[0].text, /בלי זיכוי לפי סעיף 46/);
  const noApproval = N.applySettings(SETTINGS, { orgName: 'א', sec46Number: '' }, new Set(), () => 'x');
  assert.deepEqual(N.planChequeDonation({ ...BASE, cheques: [CHQ('2', '2028-01-15', 100)] }, noApproval).warnings, [], 'בלי אישור בכלל — אין מה להזהיר');
});

test('planChequeDonation: פרטי התורם עוברים את אותה ולידציה כמו תרומה רגילה', () => {
  assert.throws(() => N.planChequeDonation({ ...BASE, donorName: '', cheques: [CHQ('1', '2027-01-01', 10)] }, SETTINGS), /שם התורם/);
  assert.throws(() => N.planChequeDonation({ ...BASE, donorId: '123', cheques: [CHQ('1', '2027-01-01', 10)] }, SETTINGS), /זהות/);
  assert.throws(() => N.planChequeDonation({ ...BASE, fundId: 'nope', cheques: [CHQ('1', '2027-01-01', 10)] }, SETTINGS), /הקרן/);
  const anon = N.planChequeDonation({ ...BASE, donorId: '', donorType: 'anonymous', cheques: [CHQ('1', '2027-01-01', 10)] }, SETTINGS);
  assert.equal(N.reportId(anon.donations[0]), '999999999');
});

test('issueChequeReceipts: מספרים עוקבים, וזכאות סעיף 46 לפי התאריך של כל קבלה', () => {
  const plan = N.planChequeDonation({ ...BASE, cheques: [CHQ('1', '2026-12-01', 100), CHQ('2', '2027-06-01', 100), CHQ('3', '2028-01-15', 100)] }, SETTINGS);
  const s0 = { ...SETTINGS, receiptSeq: 41 };
  const { donations, settings } = N.issueChequeReceipts(plan.donations, s0);
  assert.deepEqual(donations.map(d => d.receipt.number), [42, 43, 44]);
  assert.equal(settings.receiptSeq, 44);
  assert.equal(s0.receiptSeq, 41, 'ההגדרות שהתקבלו לא השתנו');
  assert.deepEqual(donations.map(d => d.receipt.sec46), [true, true, false]);
});

test('קבלות ההמחאות משתלבות בסיכומים השנתיים הקיימים בלי שינוי בהם', () => {
  const plan = N.planChequeDonation({ ...BASE, cheques: [CHQ('101', '2026-12-15', 400), CHQ('102', '2027-01-15', 400), CHQ('103', '2027-02-15', 400)] }, SETTINGS);
  const list = N.issueChequeReceipts(plan.donations, SETTINGS).donations.map((d, i) => ({ id: 'c' + i, ...d, status: 'active' }));
  assert.equal(N.annualReport(list, [], SETTINGS, 2026).donationsTotal, 400);
  assert.equal(N.annualReport(list, [], SETTINGS, 2027).donationsTotal, 800);
  assert.equal(N.donorAnnualStatement(list, SETTINGS, 'id:000000018', 2027).total, 800);
  assert.equal(N.taxSummary(list).counts.pending, 2, 'כל קבלה מדווחת בנפרד');
  assert.equal(N.exportTable('tax', list, [], SETTINGS, 2026).rows.length, 2);
});

test('chequeBounce: המחאה שחזרה — היתרה של אותה שנה בקבלה חדשה, ובלי יתרה — אין קבלה', () => {
  const plan = N.planChequeDonation({ ...BASE, purpose: 'בניין', cheques: [CHQ('101', '2026-12-15', 400), CHQ('102', '2027-01-15', 400), CHQ('103', '2027-02-15', 400)] }, SETTINGS);
  const [y26, y27] = N.issueChequeReceipts(plan.donations, SETTINGS).donations.map((d, i) => ({ id: 'c' + i, ...d, status: 'active', chequeGroupId: 'g1' }));

  const r = N.chequeBounce(y27, '102');
  assert.equal(r.bounced.number, '102');
  assert.equal(r.replacement.amount, 400);
  assert.equal(r.replacement.date, '2027-02-15', 'הפירעון הראשון שנותר בשנה');
  assert.deepEqual(r.replacement.cheques.map(c => c.number), ['103']);
  assert.equal(r.replacement.replacesId, y27.id);
  assert.equal(r.replacement.purpose, 'בניין');
  assert.equal(r.replacement.chequeGroupId, 'g1');
  assert.equal('receipt' in r.replacement, false, 'הקבלה החדשה מופקת בשירות');

  assert.equal(N.chequeBounce(y27, '103').replacement.date, '2027-01-15');
  assert.equal(N.chequeBounce(y26, '101').replacement, null, 'ההמחאה היחידה של השנה — רק ביטול');

  assert.throws(() => N.chequeBounce(y27, '999'), /לא נמצאה/);
  assert.throws(() => N.chequeBounce({ ...y27, status: 'cancelled' }, '102'), /כבר בוטלה/);
  assert.throws(() => N.chequeBounce(donation().d, '1'), /אינה תרומה בהמחאות/);
  const twin = { ...y27, cheques: [CHQ('5', '2027-01-15', 1, { amountAg: 100 }), CHQ('5', '2027-02-15', 1, { bank: '20', amountAg: 100 })] };
  assert.throws(() => N.chequeBounce(twin, '5'), /לציין את הבנק/);
  assert.equal(N.chequeBounce(twin, '5', '20').bounced.bank, '20');
});

// ---------- שלב 3: השירות מול מסד אמיתי ----------
// הערוצים נוספים בשלב 4 — כאן קוראים לשירות עצמו, שמחובר לאותו מסד אחרי initEcon

const { NpoService: svc } = require('../modules/econ/services/npoService');
const THREE = [CHQ('101', '2026-12-15', 400), CHQ('102', '2027-01-15', 400), CHQ('103', '2027-02-15', 400)];
// סופר שמירות למסד: כל פעולה = שמירה אחת (כלל האטומיות)
async function countSaves(fn) {
  const orig = svc.db.save;
  let n = 0;
  svc.db.save = function (...a) { n++; return orig.apply(this, a); };
  try { return { result: await fn(), saves: n }; } finally { svc.db.save = orig; }
}

test('שירות: תצוגה מקדימה לא שומרת ולא צורכת מספר קבלה', async () => {
  await freshLogin(71);
  const { result: pv, saves } = await countSaves(() => svc.addChequeDonation({ ...BASE, cheques: THREE }, { preview: true }));
  assert.equal(saves, 0);
  assert.deepEqual(pv.years.map(y => [y.year, y.date, y.amount, y.sec46]), [[2026, '2026-11-20', 400, true], [2027, '2027-01-15', 800, true]]);
  assert.equal(pv.totalAg, 120000);
  const o = await handlers['npo:getOverview'](ev(71), 2026);
  assert.equal(o.donations.length, 0);
  assert.equal(o.settings.receiptSeq, 0);
});

test('שירות: חבילת המחאות — קבלה לכל שנה בשמירה אחת, והסיכומים מתחלקים לפי שנה', async () => {
  await freshLogin(72);
  await handlers['npo:addDonation'](ev(72), { date: '2026-11-01', donorName: 'א', amount: 50 });
  const { result: r, saves } = await countSaves(() => svc.addChequeDonation({ ...BASE, cheques: THREE }));
  assert.equal(saves, 1, 'כל הקבלות באותה שמירה');
  assert.deepEqual(r.donations.map(d => d.receipt.number), [2, 3]);
  assert.ok(r.donations.every(d => d.chequeGroupId === r.chequeGroupId && d.status === 'active' && d.id));
  const o26 = await handlers['npo:getOverview'](ev(72), 2026);
  const o27 = await handlers['npo:getOverview'](ev(72), 2027);
  assert.equal(o26.report.donationsTotal, 450, '400 של ההמחאות + 50');
  assert.equal(o27.report.donationsTotal, 800);
  assert.equal(o26.settings.receiptSeq, 3);
  assert.equal(o26.tax.counts.pending, 3, 'כל קבלה ממתינה לדיווח בנפרד');
  // נשמר כמו שהוא — בלי מספר חשבון, אגורות שלמות
  const stored = o26.donations.find(d => d.reference === '102–103');
  assert.deepEqual(stored.cheques.map(c => c.amountAg), [40000, 40000]);
});

test('שירות: אזהרת סעיף 46 — בלי אישור לא מופק דבר; עם אישור — מופק', async () => {
  await freshLogin(73);
  const input = { ...BASE, cheques: [CHQ('1', '2027-06-01', 100), CHQ('2', '2028-01-15', 100)] };
  const { saves } = await countSaves(() => assert.rejects(svc.addChequeDonation(input), /בלי זיכוי לפי סעיף 46/));
  assert.equal(saves, 0);
  assert.equal((await handlers['npo:getOverview'](ev(73), 2027)).settings.receiptSeq, 0, 'שום מספר לא נצרך');
  assert.equal((await svc.addChequeDonation({ ...input, confirmWarnings: 'כן' }).catch(e => e)).constructor, Error, 'רק true מפורש');
  const r = await svc.addChequeDonation({ ...input, confirmWarnings: true });
  assert.deepEqual(r.donations.map(d => d.receipt.sec46), [true, false]);
});

test('שירות: בלי פרטי עמותה, או קלט שגוי — שום דבר לא נשמר', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cheques-'));
  await ipc.initEcon(dir);
  await assert.rejects(svc.addChequeDonation({ ...BASE, cheques: THREE }), /פרטי העמותה/);
  await freshLogin(74);
  const { saves } = await countSaves(() => assert.rejects(svc.addChequeDonation({ ...BASE, cheques: [...THREE, CHQ('104', '2026-01-01', 1)] }), /המחאה 4/));
  assert.equal(saves, 0);
});

test('שירות: קמפיין נבדק מול יום קבלת ההמחאות, וקבלות בשנה הבאה לא חוסמות עריכת קמפיין', async () => {
  await freshLogin(75);
  const cmp = await handlers['npo:saveCampaign'](ev(75), null, { name: 'בניין הישיבה', goal: 100000, startDate: '2026-11-01', endDate: '2026-12-31' });
  const r = await svc.addChequeDonation({ ...BASE, campaignId: cmp.id, cheques: THREE });
  assert.ok(r.donations.every(d => d.campaignId === cmp.id));
  assert.equal(r.donations[1].date, '2027-01-15', 'קבלת 2027 מחוץ לתקופה, אבל ההמחאות התקבלו בתוכה');
  await handlers['npo:saveCampaign'](ev(75), cmp.id, { name: 'בניין הישיבה (עודכן)', goal: 120000, startDate: '2026-11-01', endDate: '2026-12-31' });
  await assert.rejects(
    handlers['npo:saveCampaign'](ev(75), cmp.id, { name: 'בניין הישיבה', goal: 100000, startDate: '2026-12-01', endDate: '2026-12-31' }),
    /2 תרומות משויכות לקמפיין מחוץ לתקופה החדשה/, 'יום הקבלה 20.11 — מחוץ לתקופה המצומצמת');
  await assert.rejects(svc.addChequeDonation({ ...BASE, receivedDate: '2027-01-02', campaignId: cmp.id, cheques: [CHQ('9', '2027-02-01', 10)] }), /מחוץ לתקופת הקמפיין/);
});

test('שירות: המחאה שחזרה — ביטול וקבלה חדשה ליתרה בשמירה אחת, והמספר הישן נשרף', async () => {
  await freshLogin(76);
  const { donations: [y26, y27] } = await svc.addChequeDonation({ ...BASE, cheques: THREE });
  const { result: r, saves } = await countSaves(() => svc.cancelCheque(y27.id, '102'));
  assert.equal(saves, 1);
  assert.equal(r.cancelled.status, 'cancelled');
  assert.deepEqual(r.cancelled.bouncedCheque, { number: '102', bank: '12', dueDate: '2027-01-15' });
  assert.equal(r.cancelled.replacedBy, r.replacement.id);
  assert.equal(r.replacement.receipt.number, 3, 'מספר חדש; 2 נשאר מבוטל');
  assert.equal(r.replacement.amount, 400);
  assert.equal(r.replacement.replacesId, y27.id);
  assert.equal(r.replacement.chequeGroupId, y27.chequeGroupId);
  const o27 = await handlers['npo:getOverview'](ev(76), 2027);
  assert.equal(o27.report.donationsTotal, 400);
  assert.equal(o27.donations.filter(d => String(d.date).startsWith('2027')).length, 2, 'הקבלה המבוטלת נשארת ברשימה');

  // ההמחאה היחידה של 2026 — ביטול בלבד, בלי קבלה ובלי מספר חדש
  const only = await svc.cancelCheque(y26.id, '101');
  assert.equal(only.replacement, null);
  assert.equal((await handlers['npo:getOverview'](ev(76), 2026)).settings.receiptSeq, 3);
  await assert.rejects(svc.cancelCheque(y26.id, '101'), /כבר בוטלה/);
  await assert.rejects(svc.cancelCheque('nope', '1'), /לא נמצאה/);
  const plain = await handlers['npo:addDonation'](ev(76), { date: '2026-11-21', donorName: 'א', amount: 5 });
  await assert.rejects(svc.cancelCheque(plain.id, '1'), /אינה תרומה בהמחאות/);
});

test('שירות: קבלות ההמחאות נכנסות לגיבוי המוצפן', async () => {
  await freshLogin(77);
  await svc.addChequeDonation({ ...BASE, cheques: THREE });
  const enc = await handlers['data:backupEncrypted'](ev(77), 'backup-pass-123');
  assert.doesNotMatch(enc, /יוסף ברגר|102–103/, 'אין טקסט גלוי בגיבוי');
  const plain = JSON.parse(BK.decryptBackup(enc, 'backup-pass-123'));
  assert.equal(plain.npo.donations.filter(d => Array.isArray(d.cheques)).length, 2);
});

// ---------- שלב 4: ערוצים ו-preload ----------

const { AuthService } = require('../modules/econ/services/authService');

test('ערוצים: דרך handle(), דורשים כניסה, והרשאה לפי התפקיד', async () => {
  await freshLogin(81);
  await assert.rejects(handlers['npo:addChequeDonation'](ev(99), { ...BASE, cheques: THREE }), /נדרשת כניסה/);
  await assert.rejects(handlers['npo:cancelCheque'](ev(99), 'x', '1'), /נדרשת כניסה/);
  const { donations: [, y27] } = await handlers['npo:addChequeDonation'](ev(81), { ...BASE, cheques: THREE });
  AuthService.getSession(81).permissions = ['data.view'];
  await assert.rejects(handlers['npo:addChequeDonation'](ev(81), { ...BASE, cheques: THREE }), /אין הרשאה/);
  await assert.rejects(handlers['npo:addChequeDonation'](ev(81), { ...BASE, cheques: THREE }, { preview: true }), /אין הרשאה/, 'גם תצוגה מקדימה — ערוץ עריכה');
  AuthService.getSession(81).permissions = ['data.view', 'data.edit'];
  await assert.rejects(handlers['npo:cancelCheque'](ev(81), y27.id, '102'), /אין הרשאה/, 'ביטול דורש data.delete');
  AuthService.getSession(81).permissions = ['data.view', 'data.edit', 'data.delete'];
  const r = await handlers['npo:cancelCheque'](ev(81), y27.id, '102');
  assert.equal(r.replacement.amount, 400);
});

test('ערוצים: preview רק כשנשלח true מפורש; קלט שאינו אובייקט — שגיאה בעברית', async () => {
  await freshLogin(82);
  const pv = await handlers['npo:addChequeDonation'](ev(82), { ...BASE, cheques: THREE }, { preview: true });
  assert.equal(pv.years.length, 2);
  assert.equal((await handlers['npo:getOverview'](ev(82), 2026)).donations.length, 0);
  const r = await handlers['npo:addChequeDonation'](ev(82), { ...BASE, cheques: THREE }, { preview: 'yes' });
  assert.equal(r.donations.length, 2, 'ערך שאינו true — הפקה רגילה');
  await assert.rejects(handlers['npo:addChequeDonation'](ev(82), 'garbage'), /לפחות המחאה אחת/);
});

test('ערוצים: יומן הפעולות רושם מספרי קבלות בלבד — בלי מספרי המחאות, בנקים ושמות', async () => {
  await freshLogin(83);
  const { donations: [, y27] } = await handlers['npo:addChequeDonation'](ev(83), { ...BASE, cheques: THREE });
  await handlers['npo:cancelCheque'](ev(83), y27.id, '102');
  const rows = await ipc.getDb().all("SELECT action, details FROM audit_events WHERE action LIKE 'npo.cheques.%' ORDER BY created_at");
  assert.deepEqual(rows.map(r => r.action), ['npo.cheques.add', 'npo.cheques.bounce']);
  assert.deepEqual(JSON.parse(rows[0].details), { receipts: [1, 2], years: 2 });
  assert.deepEqual(JSON.parse(rows[1].details), { receipt: 2, replacement: 3 });
  assert.ok(rows.every(r => !/102|345|ברגר|000000018/.test(r.details)));
});

test('preload: חשיפת שני הערוצים בשמות המתוכננים', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/preload.js'), 'utf8');
  assert.match(preload, /addNpoChequeDonation: \(input, options\) => ipcRenderer\.invoke\('npo:addChequeDonation', input, options\)/);
  assert.match(preload, /cancelNpoCheque: \(id, number, bank\) => ipcRenderer\.invoke\('npo:cancelCheque', id, number, bank\)/);
});

// ---------- שלב 5: קבלה, ייצוא ופרטיות ----------

const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');
const chequeDonations = () => {
  const plan = N.planChequeDonation({ ...BASE, donorPhone: '050-1234567', cheques: THREE }, SETTINGS);
  return N.issueChequeReceipts(plan.donations, SETTINGS).donations.map((d, i) => ({ id: 'c' + i, ...d, status: 'active', chequeGroupId: 'g1' }));
};

test('קבלה: שנת המס, יום הקבלה וטבלת ההמחאות של אותה שנה בלבד', () => {
  const [y26, y27] = chequeDonations();
  const html = X.renderDonationReceiptHtml(y27);
  assert.match(html, /<span>שנת מס<\/span><span>2027<\/span>/);
  assert.match(html, /<span>ההמחאות התקבלו<\/span><span>2026-11-20<\/span>/);
  assert.match(html, /<td dir="ltr">102<\/td><td>12<\/td><td>345<\/td><td>2027-01-15<\/td>/);
  assert.match(html, /<td dir="ltr">103<\/td>/);
  assert.doesNotMatch(html, />101</, 'המחאה של שנה אחרת לא מופיעה');
  assert.match(html, /<strong>תאריך:<\/strong> 2027-01-15/);
  assert.match(X.renderDonationReceiptHtml(y26), /<span>שנת מס<\/span><span>2026<\/span>/);
});

test('קבלה: המחאה שחזרה — על הקבלה המבוטלת, ועל החלופה מספר הקבלה שהיא מחליפה', () => {
  const [, y27] = chequeDonations();
  const { bounced, replacement } = N.chequeBounce(y27, '102');
  const cancelled = { ...y27, status: 'cancelled', bouncedCheque: { number: bounced.number, bank: bounced.bank, dueDate: bounced.dueDate } };
  const a = X.renderDonationReceiptHtml(cancelled);
  assert.match(a, /class="void">מבוטלת/);
  assert.match(a, /המחאה מספר 102 \(פירעון 2027-01-15\) חזרה — הקבלה בוטלה/);
  const { receipt } = N.issueReceipt(replacement, { ...SETTINGS, receiptSeq: 2 });
  const b = X.renderDonationReceiptHtml({ ...replacement, receipt, status: 'active' });
  assert.match(b, /<span>מחליפה את קבלה<\/span><span>2 \(המחאה שחזרה\)<\/span>/);
});

test('קבלה: שדות ההמחאה עוברים בריחת HTML', () => {
  const [, y27] = chequeDonations();
  const evil = { ...y27, cheques: [{ ...y27.cheques[0], bank: '<b>x</b>' }] };
  assert.doesNotMatch(X.renderDonationReceiptHtml(evil), /<b>x<\/b>/);
});

test('ייצוא התרומות: עמודת המחאות (פירעון) — ריקה בתרומה רגילה', () => {
  const list = [...chequeDonations(), { ...donation({ date: '2027-03-01' }).d }];
  const t = N.exportTable('donations', list, [], SETTINGS, 2027);
  assert.equal(t.headers[10], 'המחאות (פירעון)');
  assert.ok(t.rows.every(r => r.length === t.headers.length));
  assert.deepEqual(t.rows.map(r => r[10]), ['102 (2027-01-15); 103 (2027-02-15)', '']);
});

test('זכות עיון: ההמחאות מוצגות בעברית, בלי המזהים הפנימיים', () => {
  const data = { npo: { donations: chequeDonations().map(d => ({ ...d, replacesId: 'r1', replacedBy: 'r2' })) } };
  const rep = PD.subjectReport(data, '000000018', { sources: ['npo'] });
  assert.equal(rep.count, 2);
  const labels = rep.sections.flatMap(s => s.fields.map(f => f.label));
  for (const l of ['המחאות', 'ההמחאות התקבלו']) assert.ok(labels.includes(l), l);
  for (const raw of ['cheques', 'receivedDate', 'chequeGroupId', 'replacesId', 'replacedBy']) assert.ok(!labels.includes(raw), raw);
  const cheques = rep.sections[1].fields.find(f => f.label === 'המחאות').value;
  assert.equal(cheques, '102 · בנק 12 · סניף 345 · פירעון 2027-01-15 · 400.00 ₪; 103 · בנק 12 · סניף 345 · פירעון 2027-02-15 · 400.00 ₪');
});

test('מזעור תורם: מספר ההמחאה, הבנק והסניף נמחקים; הפירעון, הסכום והקבלה נשמרים', () => {
  const list = chequeDonations().map(d => ({ ...d, date: d.date.replace(/^20(26|27)/, m => String(Number(m) - 10)) }));
  const data = { npo: { donations: list.map(d => ({ ...d, donorPhone: '' })), standingOrders: [] } };
  const cands = PR.candidatesFor(data, 'donors', '2026-11-20', 7);
  assert.deepEqual(cands.map(c => c.id), ['id:000000018'], 'מספרי המחאות בלי טלפון — עדיין מועמד');
  const r = PR.applyRetention(data, 'donors', ['id:000000018'], '2026-11-20', 7, '2026-11-20T10:00:00Z');
  assert.equal(r.minimized, 1);
  for (const d of data.npo.donations) {
    assert.ok(d.cheques.every(c => c.number === '' && c.bank === '' && c.branch === '' && c.dueDate && c.amountAg === 40000));
    assert.equal(d.reference, '');
    assert.ok(d.receipt.number && d.amount && d.privacyMinimizedAt);
  }
  assert.deepEqual(PR.candidatesFor(data, 'donors', '2026-11-20', 7), [], 'אחרי המזעור — כבר לא מועמד');
  assert.match(PR.RETENTION_KINDS.donors.removes, /מספר ההמחאה, הבנק והסניף/);
});

test('הלוגיקה של ההמחאות בלי require חדש (אנדרואיד) ובלי toISOString לתאריכים', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/core/npo.js'), 'utf8');
  assert.deepEqual([...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]), ['./israeliId']);
  const block = src.slice(src.indexOf('// ---------- המחאות דחויות'), src.indexOf('// רשימת מסמכים לתמיכה'));
  assert.doesNotMatch(block, /toISOString/);
});
