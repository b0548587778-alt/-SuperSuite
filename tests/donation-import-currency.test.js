// בדיקת קוד 22.10.2026 (audit-changes-since-20-10.md, ממצא 3): ייבוא תרומות בדולרים נרשם כשקלים בשקט —
// parseAmount הסיר את "$" ועמודת המטבע לא זוהתה. עכשיו: מטבע מעמודה או מהסימן, שער מעמודה או מהדיאלוג.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DI = require('../modules/econ/core/donationImport');
const P = require('../modules/econ/core/collect');

const SETTINGS = { orgName: 'עמותת תורה וחסד', receiptSeq: 5 };
// קובץ בסגנון Charidy: סכום עם סימן, ועמודת מטבע
const CSV = [
  'Date,Full Name,Amount,Currency,Transaction ID',
  '2026-10-01,Yaakov Levi,$1000,USD,C1',
  '2026-10-02,Moshe Cohen,500,EUR,C2',
  '2026-10-03,אברהם גולד,360,ILS,C3',
  '2026-10-04,שמעון כץ,180,,C4',
].join('\n');

test('ממצא 3: מטבע מזוהה מהעמודה ומהסימן; בלי שער — השורה נדחית, לא נרשמת כשקלים', () => {
  const pv = DI.preview(CSV, 'charidy', {});
  assert.equal(pv.mapping.currency, 'Currency', 'עמודת המטבע מזוהה');
  const r = DI.buildRecords(CSV, { source: 'charidy', mapping: pv.mapping }, [], SETTINGS);
  assert.deepEqual(r.records.map(x => [x.donorName, x.amount, x.foreign || null]), [['אברהם גולד', 360, null], ['שמעון כץ', 180, null]]);
  const msgs = r.errors.map(e => `${e.line}:${e.message}`);
  assert.ok(msgs.some(m => /^2:תרומה במטבע זר \(USD\) — יש לבחור עמודת שער או להזין שער/.test(m)), msgs.join(' | '));
  assert.ok(msgs.some(m => /^3:תרומה במטבע זר \(EUR\)/.test(m)));
});

test('ממצא 3: שער מהדיאלוג (לכל מטבע) או מעמודה — הסכום נשמר בשקלים, המטבע והשער לתיעוד', () => {
  const pv = DI.preview(CSV, 'charidy', {});
  const r = DI.buildRecords(CSV, { source: 'charidy', mapping: pv.mapping, rates: { USD: '3.7', EUR: '4.05' } }, [], SETTINGS);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const levi = r.records.find(x => x.donorName === 'Yaakov Levi');
  assert.equal(levi.amount, 3700);
  assert.deepEqual(levi.foreign, { currency: 'USD', amountMinor: 100000, rateE4: 37000 });
  assert.equal(r.records.find(x => x.donorName === 'Moshe Cohen').amount, 2025);
  // עמודת שער גוברת על השער הכללי
  const withRate = 'Date,Name,Amount,Currency,Rate\n2026-10-01,Yaakov Levi,1000,USD,3.65\n';
  const m = { date: 'Date', donorName: 'Name', amount: 'Amount', currency: 'Currency', rate: 'Rate' };
  assert.equal(DI.buildRecords(withRate, { source: 'causematch', mapping: m, rates: { USD: '9' } }, [], SETTINGS).records[0].amount, 3650);
});

test('ממצא 3: סימן בסכום בלי עמודת מטבע; סתירה ומטבע לא מוכר — שגיאה בשורה', () => {
  const m = { date: 'תאריך', donorName: 'שם', amount: 'סכום', currency: 'מטבע' };
  const csv = 'תאריך,שם,סכום,מטבע\n2026-10-01,א,$100,\n2026-10-02,ב,€100,USD\n2026-10-03,ג,100,CHF\n2026-10-04,ד,₪100,שקל\n2026-10-05,ה,1000 USD,\n';
  const r = DI.buildRecords(csv, { source: 'other', mapping: m }, [], SETTINGS);
  const byLine = Object.fromEntries(r.errors.map(e => [e.line, e.message]));
  assert.match(byLine[2], /מטבע זר \(USD\)/);
  assert.match(byLine[3], /שונה מהסימן/);
  assert.match(byLine[4], /מטבע לא מוכר: "CHF"/);
  assert.match(byLine[6], /מטבע זר \(USD\)/);
  assert.deepEqual(r.records.map(x => x.amount), [100]);
  assert.equal(DI.currencyOf('ש"ח'), 'ILS');
  assert.equal(DI.currencyOf('דולר'), 'USD');
});

test('ממצא 3 (גם בגבייה): דוח סליקה עם סכום בדולרים לא מותאם לדרישה בשקלים', () => {
  const s = P.normalizeSettings({});
  const { req } = P.createRequest({ kind: 'other', amount: 100, payerName: 'משה כהן' }, s, 0);
  req.createdAt = '2026-10-01T08:00:00.000Z';
  const m = P.matchReport('תאריך,סכום,שם,הערה\n05/10/2026,$100,משה כהן,P00001\n', { date: 'תאריך', amount: 'סכום', name: 'שם', ref: 'הערה' }, [req]);
  assert.deepEqual(m.matched, []);
  assert.match(m.errors[0].message, /מטבע זר \(USD\).*בשקלים בלבד/);
});

test('ממצא 3: הדיאלוג שולח שערים, וההמרה לא בממשק', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'npo.js'), 'utf8');
  assert.ok(ui.includes('NPO_IMPORT_RATES') && ui.includes('rates: { ...rates }'));
  assert.doesNotMatch(ui.slice(ui.indexOf('async function importNpoDonations')), /\*\s*Number\(rates/, 'בלי חישוב בממשק');
});

// סקירה חוזרת של התיקון: השער "3,7" (פסיק עשרוני, כמו שמקלידים בעברית) נקרא 37 — 100$ נרשמו כ-3,700 ₪ בשקט
test('ממצא 3: שער עם פסיק עשרוני — 3,7 הוא 3.7 ולא 37 (בעמודה ובשער שהוקלד)', () => {
  const m = { date: 'תאריך', amount: 'סכום', donorName: 'שם', currency: 'מטבע' };
  const one = 'תאריך,סכום,שם,מטבע\n2026-10-01,100,יוסף כהן,USD\n';
  for (const rate of ['3.7', '3,7', '3,70', ' 3,7 ']) {
    const r = DI.buildRecords(one, { source: 'other', mapping: m, rates: { USD: rate } }, [], SETTINGS);
    assert.deepEqual(r.errors, [], rate);
    assert.equal(r.records[0].amount, 370, rate);
    assert.equal(r.records[0].foreign.rateE4, 37000, rate);
  }
  const col = 'תאריך,סכום,שם,מטבע,שער\n2026-10-01,100,יוסף כהן,USD,"3,65"\n';
  const r = DI.buildRecords(col, { source: 'other', mapping: { ...m, rate: 'שער' } }, [], SETTINGS);
  assert.equal(r.records[0].amount, 365);
  // מספר עם נקודה — הפסיק הוא מפריד אלפים (ושער כזה גבוה מהתקרה — נדחה, לא מומר בשקט)
  const big = DI.buildRecords(one, { source: 'other', mapping: m, rates: { USD: '1,234.5' } }, [], SETTINGS);
  assert.deepEqual(big.records, []);
  assert.match(big.errors[0].message, /שער דולר תקין/);
});
