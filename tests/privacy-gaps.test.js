// מיפוי המאגרים ומזעור (PLAN שלב 10, 10.1ד): בקשות הלוואה, שואלי חפצים, לקוחות בחשבוניות, ספקים ביומן
// והמודולים המוצפנים מופיעים במיפוי; סוג מזעור חדש לשואלי חפצים שהחזירו; ספק שהוא עוסק יחיד בדוח זכות העיון
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');

const SUPPLIER = '000000018';
const data = () => ({
  npo: {}, chesed: {},
  gemach: {
    applications: [{ id: 'a1', borrowerName: 'משה', borrowerId: '' }],
    lendings: [
      { id: 'l1', itemId: 'i1', borrowerName: 'אברהם לוי', borrowerId: '', borrowerPhone: '050-1234567', date: '2023-01-05', returnedAt: '2023-02-01', notes: 'החזיר בזמן' },
      { id: 'l2', itemId: 'i2', borrowerName: 'יצחק כהן', borrowerId: '', borrowerPhone: '052-7654321', date: '2023-01-05', returnedAt: '' },
      { id: 'l3', itemId: 'i3', borrowerName: 'יעקב שטרן', borrowerId: '', borrowerPhone: '053-1111111', date: '2026-09-01', returnedAt: '2026-10-01' },
    ],
  },
  invoices: [{ id: 'v1', number: 1, customer: 'לקוח', customerTaxId: '' }],
  journal: [
    { id: 'e1', date: '2026-07-01', total: 1180, lines: [], vatDoc: { supplierTaxId: SUPPLIER, reference: '100', docDate: '2026-07-01' }, supplierDoc: { name: 'דפוס הנסיך', taxId: SUPPLIER, reference: 'A-100', docDate: '2026-07-01' } },
    { id: 'e2', date: '2026-07-02', total: 500, lines: [], supplierDoc: { name: 'ספק פטור', taxId: SUPPLIER, reference: '77' } },
    { id: 'e3', date: '2026-07-03', total: 10, lines: [] },
  ],
});

test('המיפוי כולל את המאגרים שחסרו, עם מספר הרשומות', () => {
  const rows = PR.dataMap(data()).rows;
  const row = (re) => rows.find(r => re.test(r.area));
  assert.equal(row(/בקשות הלוואה/).count, 1);
  assert.equal(row(/שואלים/).count, 3);
  assert.equal(row(/לקוחות בחשבוניות/).count, 1);
  assert.equal(row(/ספקים ביומן/).count, 2, 'רק רשומות עם פרטי ספק');
  assert.equal(row(/^שמאות \(במחסן/).count, null);
  assert.ok(!rows.some(r => /אימונים/.test(r.area + r.fields)), 'מודול האימונים עבר למוצר נפרד');
  assert.ok(rows.every(r => r.sensitivityLabel), 'לכל שורה תווית רגישות');
});

test('מזעור שואלי חפצים: רק השאלה שהוחזרה לפני התקופה; טלפון והערות נמחקים, שם ופריט נשמרים', () => {
  assert.ok(PR.RETENTION_KINDS.itemBorrowers);
  const d = data();
  const cand = PR.candidatesFor(d, 'itemBorrowers', '2026-11-01', 2);
  assert.deepEqual(cand.map(c => c.id), ['l1'], 'השאלה פתוחה והשאלה חדשה — לא מועמדות');
  assert.throws(() => PR.candidatesFor(d, 'itemBorrowers', '2026-11-01', 0), /לפחות 1/);
  const r = PR.applyRetention(d, 'itemBorrowers', ['l1', 'l2', 'l3'], '2026-11-01', 2, '2026-11-01T10:00:00Z');
  assert.deepEqual(r, { minimized: 1, skipped: 2 });
  const l1 = d.gemach.lendings.find(l => l.id === 'l1');
  assert.equal(l1.borrowerPhone, '');
  assert.equal(l1.notes, '');
  assert.equal(l1.borrowerName, 'אברהם לוי');
  assert.equal(l1.itemId, 'i1');
  assert.equal(l1.privacyMinimizedAt, '2026-11-01T10:00:00Z');
  assert.equal(d.gemach.lendings.find(l => l.id === 'l2').borrowerPhone, '052-7654321');
  assert.equal(PR.candidatesFor(d, 'itemBorrowers', '2026-11-01', 2).length, 0, 'רשומה שמוזערה לא חוזרת');
});

test('המזעור החדש בודק את רישיון הגמ"ח', () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  assert.match(src, /RETENTION_DOMAIN = \{[^}]*itemBorrowers: 'gemach:x'/);
  for (const k of Object.keys(PR.RETENTION_KINDS)) assert.match(src, new RegExp(`RETENTION_DOMAIN = \\{[^}]*\\b${k}:`), k);
});

test('דוח זכות עיון: ספק שהוא עוסק יחיד — רק כשהנהלת החשבונות פתוחה', () => {
  const open = PD.subjectReport(data(), SUPPLIER, { sources: [], acct: true });
  const sup = open.sections.filter(s => s.title === 'חשבונית ספק ביומן');
  assert.equal(sup.length, 2);
  const f = Object.fromEntries(sup[0].fields.map(x => [x.label, x.value]));
  assert.equal(f['שם הספק'], 'דפוס הנסיך');
  assert.equal(f['אסמכתה'], 'A-100');
  const closed = PD.subjectReport(data(), SUPPLIER, { sources: [], acct: false });
  assert.equal(closed.sections.length, 0);
});
