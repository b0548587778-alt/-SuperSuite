// קובץ זיכויים במס"ב (תשלומים — כסף יוצא; PLAN שלב 10, 10.4): מבנה הרשומות, סוג תנועה 006,
// ורשומת הסה"כ — הסכום במיקום 22 ומספר התנועות במיקום 52 (הפוך מקובץ החיובים). בונה בלבד — לא מחובר למסך
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../modules/econ/core/masav');

const SETTINGS = { institution: '12345678', sender: '54321', name: 'גמח אור', hebrew: 'oldcode' };
const ITEMS = [
  { bank: '12', branch: '345', account: '678901', idNumber: '000000018', name: 'דפוס הנסיך', amountAg: 118000, reference: '1001' },
  { bank: '10', branch: '800', account: '55555', idNumber: '', name: 'אברהם לוי', amountAg: 50050, reference: '1002' },
];
// מיקום 1-based כמו במפרט
const at = (line, pos, len) => line.slice(pos - 1, pos - 1 + len);

function build(over = {}) {
  return M.buildCreditFile({ settings: SETTINGS, paymentDate: '2026-11-10', createdDate: '2026-11-01', items: ITEMS, ...over });
}

test('מבנה: כל שורה 128 תווים ו-CRLF; כותרת, תנועות ממוינות, סה"כ ושורת תשיעיות', () => {
  const r = build();
  assert.ok(r.text.endsWith('\r\n'));
  const lines = r.text.slice(0, -2).split('\r\n');
  assert.equal(lines.length, 5);
  assert.ok(lines.every(l => l.length === 128), 'כל שורה 128');
  assert.equal(lines[0][0], 'K');
  assert.ok(lines[0].endsWith('KOT'));
  assert.equal(at(lines[0], 2, 8), '12345678');
  assert.equal(at(lines[0], 12, 6), '261110', 'תאריך התשלום בכותרת');
  assert.equal(lines[4], '9'.repeat(128));
  assert.deepEqual([r.count, r.totalAg], [2, 168050]);
});

test('תנועה: סוג 006 במיקום 106, הסכום במיקום 62 (13), חשבון ובנק במקומם; ממוין לפי בנק', () => {
  const lines = build().text.split('\r\n');
  const [first, second] = [lines[1], lines[2]];
  assert.equal(first[0], '1');
  assert.equal(at(first, 106, 3), '006');
  assert.equal(at(first, 18, 2), '10', 'בנק 10 לפני 12');
  assert.equal(at(first, 20, 3), '800');
  assert.equal(at(first, 27, 9), '000055555');
  assert.equal(at(first, 62, 13), '0000000050050');
  assert.equal(at(second, 62, 13), '0000000118000');
  assert.equal(at(second, 37, 9), '000000018');
  assert.equal(at(second, 75, 20), '00000000000000001001', 'אסמכתה');
});

test('רשומת סה"כ: הסכום במיקום 22 (15) ומספר התנועות במיקום 52 (7), תואמים לתנועות', () => {
  const total = build().text.split('\r\n')[3];
  assert.equal(total[0], '5');
  assert.equal(at(total, 22, 15), '000000000168050');
  assert.equal(at(total, 37, 15), '0'.repeat(15));
  assert.equal(at(total, 52, 7), '0000002');
  // בקובץ החיובים זה הפוך: מספר התנועות ב-59 והסכום ב-37
  const debit = M.buildDebitFile({ settings: SETTINGS, chargeDate: '2026-11-10', createdDate: '2026-11-01',
    items: ITEMS.map(i => ({ ...i, reference: '100' + i.reference })) }).text.split('\r\n');
  const dTotal = debit[debit.length - 3];
  assert.equal(at(dTotal, 37, 15), '000000000168050');
  assert.equal(at(dTotal, 59, 7), '0000002');
  assert.equal(at(debit[1], 106, 3), '504');
});

test('קלט לא תקין נדחה בעברית', () => {
  assert.throws(() => build({ items: [{ ...ITEMS[0], amountAg: 0 }] }), /חייב להיות חיובי/);
  assert.throws(() => build({ items: [{ ...ITEMS[0], amountAg: -100 }] }), /חייב להיות חיובי/);
  assert.throws(() => build({ items: [{ ...ITEMS[0], amountAg: 10.5 }] }), /אינו תקין/);
  assert.throws(() => build({ items: [{ ...ITEMS[0], name: '' }] }), /שם המוטב/);
  assert.throws(() => build({ items: [{ ...ITEMS[0], account: '' }] }), /מספר החשבון/);
  assert.throws(() => build({ items: [] }), /אין תשלומים/);
  assert.throws(() => build({ paymentDate: '2026-02-31' }), /תאריך התשלום/);
  assert.throws(() => build({ items: [{ ...ITEMS[0], reference: '1'.repeat(21) }] }), /האסמכתה ארוכה/);
});

test('הבונה לא מחובר לשום ערוץ או מסך — עד בדיקה בסימולטור הבנק', () => {
  const root = path.join(__dirname, '..', 'modules', 'econ');
  for (const f of ['ipc.js', 'preload.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /buildCreditFile/, f);
  for (const f of fs.readdirSync(path.join(root, 'services'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'services', f), 'utf8'), /buildCreditFile/, f);
  }
});
