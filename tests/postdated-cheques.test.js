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
