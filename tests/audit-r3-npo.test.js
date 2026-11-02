'use strict';
// רגרסיה לסקירת הקוד 2.11.2026 — עמותה, גמ"ח, נדל"ן ופרטיות (סוכן "npo"):
// טופסי עריכה שמרוקנים שדה, מזעור לווים ובקשות הלוואה, מזעור תורמים מסוף שנת המס, הצעת רמת אבטחה,
// תחילת תוקף אישור סעיף 46 והדוח השנתי לתורם.
process.env.TZ = 'Asia/Jerusalem';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');
const PR = require('../modules/econ/core/privacy');
const N = require('../modules/econ/core/npo');
const DI = require('../modules/econ/core/donationImport');
const BR = require('../modules/econ/core/brokerage');
const RL = require('../modules/econ/core/realty');

// ---------- ממשק: DOM מדומה מינימלי (כמו audit-econ-ui) ----------
function el(tag = 'div', extra = {}) {
  const listeners = {};
  const node = Object.assign({
    tagName: String(tag).toUpperCase(), textContent: '', value: '', innerHTML: '', className: '', style: {}, dataset: {}, children: [],
    disabled: false, hidden: false, selectedIndex: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeEventListener() {}, _listeners: listeners,
    append(...c) { node.children.push(...c); }, appendChild(c) { node.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, focus() {}, select() {}, remove() {}, click() {},
  }, extra);
  return node;
}
function loadUi() {
  const byId = {};
  const document = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById(id) { return (byId[id] ||= el('div', { id })); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { return el(tag); }, createTextNode(t) { return { textContent: t }; }, body: el('body'),
  };
  const context = { console, setTimeout, clearTimeout, setImmediate, Date, Intl, URLSearchParams, TextDecoder, location: { search: '' }, document };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  return { byId, run: (code) => vm.runInContext(code, context) };
}

test('טופס עריכה: שדה שרוקן נשלח כ-"" (בלעדיות "לא", מחיר שנמחק); בהוספה — לא נשלח', () => {
  const { byId, run } = loadUi();
  const fields = [
    { name: 'clientId', type: 'select', required: true }, { name: 'exclusive', type: 'select' },
    { name: 'price', type: 'number' }, { name: 'notes', type: 'textarea' }, { name: 'advisorId', type: 'select' }
  ];
  byId.f_clientId = el('select', { value: 'c1' });
  byId.f_exclusive = el('select', { value: '' });
  byId.f_price = el('input', { value: ' ' });
  byId.f_notes = el('textarea', { value: '' });
  // הערך השמור אינו באפשרויות (יועץ אחר) — הדפדפן מחזיר selectedIndex -1 ו-value ריק
  byId.f_advisorId = el('select', { value: '', selectedIndex: -1 });
  run('state.subForm = { fields: ' + JSON.stringify(fields) + ' }');
  run("state.editingId = 'o1'");
  const edit = JSON.parse(run('JSON.stringify(collectFormData(state.subForm.fields))'));
  assert.deepEqual(edit, { clientId: 'c1', exclusive: '', price: '', notes: '' });
  run('state.editingId = null');
  const add = JSON.parse(run('JSON.stringify(collectFormData(state.subForm.fields))'));
  assert.deepEqual(add, { clientId: 'c1' }, 'בהוספה — שדה ריק לא נשלח (ברירות המחדל של השרת)');
});

test('שירותים: "" מטופס עריכה מנקה — בלעדיות, מחיר בהזמנת תיווך, מחיר עסקה חוזר למבוקש', () => {
  const clients = [{ id: 'c1' }];
  const prev = BR.validateOrder({ clientId: 'c1', date: '2026-01-01', exclusive: 'yes', exclusiveUntil: '2026-03-01', marketing: 'שלטים', price: 1000000 }, {}, { clients });
  assert.equal(prev.exclusive, true);
  assert.equal(prev.priceAg, 100000000);
  const next = BR.validateOrder({ exclusive: '', exclusiveUntil: '', marketing: '', price: '' }, prev, { clients });
  assert.equal(next.exclusive, false);
  assert.equal(next.exclusiveUntil, '');
  assert.equal(next.priceAg, 0, 'מחיר שנמחק בטופס — מתנקה');
  assert.equal(BR.validateOrder({ notes: 'x' }, prev, { clients }).priceAg, 100000000, 'מפתח חסר — נשמר הקודם');

  const properties = [{ id: 'p1', askingAg: 200000000, listing: 'sale' }];
  const parties = [{ id: 'b1' }];
  const deal = RL.validateDeal({ propertyId: 'p1', buyerClientId: 'b1', price: 1500000 }, {}, { properties, clients: parties });
  assert.equal(deal.priceAg, 150000000);
  assert.equal(RL.validateDeal({ price: '' }, deal, { properties, clients: parties }).priceAg, 200000000, 'ריק — המחיר המבוקש');
});

// ---------- מזעור לווים ובקשות הלוואה ----------
function gemachData() {
  return {
    gemach: {
      loans: [
        { id: 'L1', borrowerName: 'לווה', borrowerId: '000000018', borrowerPhone: '050', borrowerAddress: 'רחוב', notes: 'הערה', status: 'closed',
          issueDate: '2018-01-01', applicationId: 'A1', schedule: [{ paidDate: '2019-01-01' }], guarantors: [{ name: 'ערב', id: '000000026', phone: '055' }] }
      ],
      applications: [
        { id: 'A1', status: 'approved', loanId: 'L1', borrowerName: 'לווה', borrowerId: '000000018', borrowerPhone: '050', borrowerAddress: 'רחוב',
          notes: 'הערה', purpose: 'חתונה', interviewNotes: 'מצב כלכלי קשה', guarantors: [{ name: 'ערב', id: '000000026', phone: '055' }], requestDate: '2017-12-01' },
        { id: 'A2', status: 'rejected', borrowerName: 'נדחה', borrowerPhone: '052', interviewNotes: 'חובות', rejectReason: 'אין ערבים', requestDate: '2018-02-01',
          guarantors: [], history: [{ status: 'rejected', at: '2018-03-01T10:00:00Z' }] },
        { id: 'A3', status: 'interview', borrowerName: 'חדש', borrowerPhone: '053', requestDate: '2026-10-01', guarantors: [] }
      ],
      lendings: []
    }
  };
}

test('מזעור לווים: גם בקשת ההלוואה שממנה נוצרה ההלוואה (טלפון, כתובת, הערות, ראיון, טלפון ערבים)', () => {
  const data = gemachData();
  const r = PR.applyRetention(data, 'borrowers', ['L1'], '2026-11-02', 3, '2026-11-02T10:00:00Z');
  assert.equal(r.minimized, 1);
  const a = data.gemach.applications.find(x => x.id === 'A1');
  assert.deepEqual([a.borrowerPhone, a.borrowerAddress, a.notes, a.purpose, a.interviewNotes, a.guarantors[0].phone],
    ['', '', '', '', '', '']);
  assert.equal(a.privacyMinimizedAt, '2026-11-02T10:00:00Z');
  assert.deepEqual([a.borrowerName, a.borrowerId, a.guarantors[0].id, a.status], ['לווה', '000000018', '000000026', 'approved']);
  assert.equal(data.gemach.applications.find(x => x.id === 'A2').borrowerPhone, '052', 'בקשה אחרת לא נגעה');
});

test('סוג מזעור חדש: בקשות הלוואה שנדחו או ישנות; בקשה פתוחה מהזמן האחרון ובקשה שאושרה אינן מועמדות', () => {
  assert.ok(PR.RETENTION_KINDS.applications, 'סוג applications קיים');
  const data = gemachData();
  assert.deepEqual(PR.candidatesFor(data, 'applications', '2026-11-02', 3).map(x => x.id), ['A2']);
  const r = PR.applyRetention(data, 'applications', ['A2', 'A3', 'A1'], '2026-11-02', 3, 'now');
  assert.deepEqual(r, { minimized: 1, skipped: 2 });
  const a2 = data.gemach.applications.find(x => x.id === 'A2');
  assert.deepEqual([a2.borrowerPhone, a2.interviewNotes, a2.rejectReason, a2.borrowerName], ['', '', '', 'נדחה']);
  assert.equal(PR.candidatesFor(data, 'applications', '2026-11-02', 3).length, 0, 'אחרי המזעור — לא מועמדת');
  // הלוואה שמוזערה לפני התיקון — הבקשה שלה מועמדת עכשיו
  const old = gemachData();
  old.gemach.loans[0].privacyMinimizedAt = '2025-01-01T00:00:00Z';
  assert.deepEqual(PR.candidatesFor(old, 'applications', '2026-11-02', 3).map(x => x.id).sort(), ['A1', 'A2']);
});

// ---------- מזעור תורמים: מסוף שנת המס ----------
test('מזעור תורמים: 7 שנים נספרות מסוף שנת המס של התרומה האחרונה', () => {
  const data = (date) => ({ npo: { donations: [{ id: 'd', donorName: 'תורם', donorId: '000000018', donorPhone: '050', donorAddress: 'רחוב', date, amount: 10,
    cheques: [{ number: '1', bank: '12', branch: '345', dueDate: date, amountAg: 1000 }] }], standingOrders: [] } });
  // דצמבר 2019 — הקבלה נשמרת עד סוף 2026: ב-2.11.2026 עוד לא מועמד
  assert.deepEqual(PR.candidatesFor(data('2019-12-15'), 'donors', '2026-11-02', 7), []);
  const old = data('2018-12-31');
  assert.deepEqual(PR.candidatesFor(old, 'donors', '2026-11-02', 7).map(x => x.id), ['id:000000018']);
  PR.applyRetention(old, 'donors', ['id:000000018'], '2026-11-02', 7, 'now');
  assert.equal(old.npo.donations[0].cheques[0].number, '');
  assert.match(PR.RETENTION_KINDS.donors.removes, /מסוף שנת המס/);
});

// ---------- הצעת רמת אבטחה ----------
test('רמת אבטחה: נתוני שמאות בלבד (שורה רגישה בלי כמות) — לא "בלי מידע רגיש"', () => {
  const only = PR.suggestLevel(PR.dataMap({}, { admin: 1 }, { shamai: true }));
  assert.equal(only.level, 'medium');
  assert.match(only.reasons[0], /שמאות/);
  assert.equal(PR.suggestLevel(PR.dataMap({}, { admin: 1 }, { shamai: false })).level, 'individual');
});

// ---------- סעיף 46: תחילת תוקף ----------
test('אישור סעיף 46 עם תאריך התחלה: תרומה מלפניו — קבלה בלי סעיף 46, ואזהרה בייבוא ובהמחאות', () => {
  const s = N.applySettings({}, { orgName: 'עמותה', sec46Number: '123', sec46ValidFrom: '2026-01-01', sec46ValidUntil: '2026-12-31' }, new Set(), () => 'x');
  assert.equal(s.sec46ValidFrom, '2026-01-01');
  assert.equal(N.issueReceipt({ date: '2025-06-01', fundId: 'general' }, s).receipt.sec46, false);
  assert.equal(N.issueReceipt({ date: '2026-06-01', fundId: 'general' }, s).receipt.sec46, true);
  assert.throws(() => N.applySettings({}, { orgName: 'ע', sec46ValidFrom: '2027-01-01', sec46ValidUntil: '2026-12-31' }, new Set(), () => 'x'), /אחרי סוף התוקף/);
  assert.throws(() => N.applySettings({}, { orgName: 'ע', sec46ValidFrom: '2026-02-31' }, new Set(), () => 'x'), /אינה תאריך תקין/);

  const csv = 'תאריך,שם,סכום\n2025-06-01,ראובן,100\n2026-06-01,שמעון,100\n';
  const mapping = { date: 'תאריך', donorName: 'שם', amount: 'סכום' };
  const { errors } = DI.buildRecords(csv, { source: 'bank', mapping, receipts: 'issue' }, [], s);
  assert.equal(errors.filter(e => e.warning && /סעיף 46/.test(e.message)).map(e => e.line).join(), '2');

  const plan = N.planChequeDonation({ donorName: 'לוי', receivedDate: '2025-12-20',
    cheques: [{ number: '1', bank: '12', branch: '1', dueDate: '2025-12-25', amountAg: 10000 }, { number: '2', bank: '12', branch: '1', dueDate: '2026-01-25', amountAg: 10000 }] }, s);
  assert.deepEqual(plan.warnings.map(w => [w.code, w.year]), [['sec46-not-yet', 2025]]);
});

// ---------- דוח שנתי לתורם וחבילת סוף שנה ----------
test('דוח שנתי לתורם: בלי זיכוי לתושב חוץ, ומספר האישור מהקבלות של אותה שנה (לא מההגדרות של היום)', () => {
  const rc = (n, sec46, num) => ({ number: n, sec46, sec46Number: sec46 ? num : '', sec46ValidUntil: sec46 ? '2025-12-31' : '', fundName: 'כללי' });
  const donations = [
    { id: '1', date: '2025-03-01', donorName: 'כהן', donorId: '000000018', amount: 100, receipt: rc(1, true, 'OLD-46'), status: 'active' },
    { id: '2', date: '2025-04-01', donorName: 'Smith', donorType: 'foreign', amount: 200, receipt: rc(2, true, 'OLD-46'), status: 'active' }
  ];
  const today = { orgName: 'עמותה', sec46Number: 'NEW-46', sec46ValidUntil: '2027-12-31' };
  const israeli = N.donorAnnualStatement(donations, today, 'id:000000018', 2025);
  assert.equal(israeli.sec46Total, 100);
  assert.equal(israeli.org.sec46Number, 'OLD-46');
  assert.equal(israeli.org.sec46ValidUntil, '2025-12-31');
  const foreign = N.donorAnnualStatement(donations, today, 'name:smith', 2025);
  assert.equal(foreign.sec46Total, 0);
  assert.equal(foreign.org.sec46Number, '');
  assert.equal(foreign.receipts[0].sec46, false);
  const pack = N.yearEndPack(donations, today, 2025, { onlySec46: true });
  assert.deepEqual(pack.statements.map(s => s.donor.name), ['כהן']);
  assert.equal(pack.totals.sec46Total, 100);
});
