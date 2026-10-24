// בדיקת קוד 23.10.2026 — הנהלת חשבונות, מסמכים, ייבוא וחישובים (ממצאים 10, 19, 52 והממצאים הנמוכים של התחום)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const A = require('../modules/econ/core/accounting');
const SD = require('../modules/econ/core/salesDocs');
const X = require('../modules/econ/core/exports');
const P = require('../modules/econ/core/dataPorts');
const IC = require('../modules/econ/core/invoiceCapture');
const C = require('../modules/econ/utils/calculations');
const { calculateFinancialMetrics } = require('../modules/econ/core/financial');

// מסד בזיכרון לשירותים (load/save של כל הנתונים, כמו Database)
function memoryDb(initial) {
  let data = structuredClone(initial);
  return {
    saves: 0,
    async load() { return structuredClone(data); },
    async save(v) { this.saves++; data = structuredClone(v); },
    peek() { return data; }
  };
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- ממצא 10: זיכוי חלקי ----------
test('ממצא 10: זיכוי חלקי שני שמכסה את יתרת הנטו לוקח את יתרת המע"מ — לא נשארת אגורה שאי אפשר לזכות', () => {
  const computed = A.computeInvoice({ items: [{ description: 'א', quantity: 1, unitPrice: 10.25 }, { description: 'ב', quantity: 1, unitPrice: 10.25 }] }, 0.18);
  const inv = { id: 'inv1', number: 7, date: '2026-10-01', customer: 'משה כהן', status: 'open', vatRate: 0.18, ...computed };
  assert.equal(inv.total, 24.19);
  const docs = [];
  const first = SD.validateCredit(inv, { date: '2026-10-02', reason: 'החזרה', items: [{ description: 'א', quantity: 1, unitPrice: 10.25 }] }, docs);
  assert.equal(first.total, 12.1);
  docs.push({ ...first, id: 'c1', status: 'open' });
  // קודם: 12.10 מול יתרה 12.09 — נדחה, וגם זיכוי מלא נחסם
  const second = SD.validateCredit(inv, { date: '2026-10-03', reason: 'החזרה', items: [{ description: 'ב', quantity: 1, unitPrice: 10.25 }] }, docs);
  assert.equal(second.net, 10.25);
  assert.equal(second.vat, 1.84);
  assert.equal(second.total, 12.09);
  docs.push({ ...second, id: 'c2', status: 'open' });
  assert.equal(SD.creditedAg(docs, inv.id), A.toAg(inv.total), 'החשבונית זוכתה עד האגורה');
  // הרשומה ביומן מאוזנת
  assert.equal(A.validateEntry(SD.creditToEntry(second, 2), A.DEFAULT_CHART).total, 12.09);
  // זיכוי נוסף — אין יתרה
  assert.throws(() => SD.validateCredit(inv, { date: '2026-10-04', reason: 'x', items: [{ description: 'ב', quantity: 1, unitPrice: 0.01 }] }, docs), /זוכתה במלואה/);
});

test('ממצא 10: זיכוי חלקי שאינו מכסה את כל הנטו — המע"מ מחושב לפי השיעור כמו קודם', () => {
  const computed = A.computeInvoice({ items: [{ description: 'א', quantity: 3, unitPrice: 100 }] }, 0.18);
  const inv = { id: 'inv2', number: 8, date: '2026-10-01', customer: 'לקוח', status: 'open', vatRate: 0.18, ...computed };
  const part = SD.validateCredit(inv, { date: '2026-10-02', reason: 'החזרה', items: [{ description: 'א', quantity: 1, unitPrice: 100 }] }, []);
  assert.deepEqual([part.net, part.vat, part.total], [100, 18, 118]);
  assert.throws(() => SD.validateCredit(inv, { date: '2026-10-02', reason: 'x', items: [{ description: 'א', quantity: 4, unitPrice: 100 }] }, []), /גבוה מהיתרה/);
});

// ---------- ממצא 19 + quoted-printable ----------
test('ממצא 19: ייבוא vCard שומר טלפון עם + בלי גרש, וערכים עם פסיק או מירכאות כמו שהם', () => {
  const v = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:אברהם לוי\r\nTEL;TYPE=CELL:+972-50-1234567\r\nNOTE:שורה\\, עם פסיק ו"מירכאות"\r\nEND:VCARD\r\n'
    + 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:שרה כהן\r\nTEL:=1+2\r\nEND:VCARD\r\n';
  const r = P.importContactsVcard(v, { contacts: [] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].phone, '+972-50-1234567');
  assert.equal(r.records[0].notes, 'שורה, עם פסיק ו"מירכאות"');
  assert.equal(r.records[1].phone, '=1+2', 'ניטרול נוסחאות שייך לייצוא בלבד');
  // ייבוא חוזר — כפילות לפי שם וטלפון
  const again = P.importContactsVcard(v, { contacts: r.records });
  assert.equal(again.records.length, 0);
  assert.equal(again.skipped, 2);
});

test('ממצא 19: ייצוא אנשי קשר ל-CSV וייבוא חוזר — הטלפון חוזר בלי הגרש של הגנת הנוסחאות', () => {
  const data = { contacts: [{ id: 'c1', name: 'אברהם לוי', phone: '+972-50-1234567', email: '', company: '', role: '', address: '', notes: "-5 ו-'=x" }] };
  const t = P.exportTable('contacts', data);
  const csv = X.toCsv(t.headers, t.rows);
  assert.match(csv, /'\+972-50-1234567/, 'בקובץ עצמו — מנוטרל');
  const r = P.parseImport('contacts', csv, { contacts: [] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.records[0].phone, '+972-50-1234567');
  assert.equal(r.records[0].notes, "-5 ו-'=x", 'גרש שלא נוסף בייצוא נשאר');
  // גרש לפני ערך שלא היה מנוטרל (מספר שלילי) — שייך לערך המקורי
  const own = P.parseImport('contacts', "שם,טלפון\nשרה כהן,'-5\n", { contacts: [] });
  assert.equal(own.records[0].phone, "'-5");
});

test('vCard 2.1 עם quoted-printable ושבירת שורה רכה — השם המלא, לא "אברה"', () => {
  const hex = (s) => [...Buffer.from(s, 'utf8')].map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
  const full = hex('אברהם בן דוד');
  const cut = full.indexOf('=', 20);
  const v = 'BEGIN:VCARD\r\nVERSION:2.1\r\n'
    + `FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${full.slice(0, cut)}=\r\n${full.slice(cut)}\r\n`
    + 'TEL;CELL:050-1234567\r\nEND:VCARD\r\n';
  const rows = P.vcardToRows(v);
  assert.equal(rows[0].name, 'אברהם בן דוד');
  assert.equal(rows[0].phone, '050-1234567');
});

test('CSV: ההגנה מנוסחאות תופסת גם "-1+1" ו-"-2+cmd", ומספרים שליליים נשארים מספרים', () => {
  const csv = X.toCsv(['a'], [['-1+1'], ['-2+cmd|x'], ['-5'], ['-1,234.56'], ['-12.5'], ['+972501234567'], ['רגיל']]);
  const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1);
  assert.deepEqual(lines, ["'-1+1", "'-2+cmd|x", '-5', '"-1,234.56"', '-12.5', "'+972501234567", 'רגיל']);
});

// ---------- קליטת חשבונית ספק ----------
test('ע.מ הספק: ספרת ביקורת נבדקת, 10 ספרות לא נקטעות, 8 ספרות מרופדות ונכנסות ל-PCN874', () => {
  const base = { date: '2026-10-15', gross: '1180', expenseAccount: '5000', docNumber: '77' };
  const opts = { vatRate: 0.18, expenseAccounts: ['5000'] };
  assert.throws(() => IC.draftEntry({ ...base, supplierTaxId: '5141234540' }, opts), /5–9 ספרות/);
  assert.throws(() => IC.draftEntry({ ...base, supplierTaxId: '514123456' }, opts), /ספרת ביקורת/);
  const short = IC.draftEntry({ ...base, supplierTaxId: '12345674' }, opts);
  assert.equal(short.entry.vatDoc.supplierTaxId, '012345674');
  assert.equal(short.supplier.taxId, '012345674');
  assert.equal(IC.draftEntry({ ...base, supplierTaxId: '' }, opts).entry.vatDoc, undefined);
});

function freshAccounting(initial) {
  delete require.cache[require.resolve('../modules/econ/services/accountingService')];
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = memoryDb({ accounts: A.DEFAULT_CHART.map(a => ({ ...a })), journal: [], invoices: [], settings: {}, ...initial });
  AccountingService.initialize(db);
  return { acc: AccountingService, db };
}

test('קליטת חשבונית: המע"מ מפוצל לפי תאריך החשבונית (17% ב-2024), ובתקופה הנוכחית — לפי ההגדרות', async () => {
  const { acc } = freshAccounting({ settings: { vatRate: 0.18 } });
  const old = await acc.captureInvoice({ date: '2024-06-01', gross: '1170', expenseAccount: '6100' });
  assert.deepEqual(old.amountsAg, { net: 100000, vat: 17000, gross: 117000 });
  const now = await acc.captureInvoice({ date: '2026-06-01', gross: '1180', expenseAccount: '6100' });
  assert.deepEqual(now.amountsAg, { net: 100000, vat: 18000, gross: 118000 });
});

test('קליטת חשבונית: שינוי שיעור בהגדרות חל מיום השינוי — חשבונית מלפניו מפוצלת בשיעור שהיה אז', async () => {
  const { acc, db } = freshAccounting({ settings: { vatRate: 0.18 } });
  const business = { name: 'עסק לדוגמה' };
  await acc.saveSettings({ vatRate: 0.19, business });
  const today = localDay();
  assert.deepEqual(db.peek().settings.vatRateChanges, [{ from: today, rate: 0.19, prev: 0.18 }]);
  // חשבונית מלפני השינוי, שנקלטת אחריו — 18%, בלי אזהרה
  const before = await acc.captureInvoice({ date: '2025-06-01', gross: '1180', expenseAccount: '6100' });
  assert.equal(before.amountsAg.vat, 18000);
  assert.ok(!before.warnings.some(w => w.includes('שיעור המע"מ בטיוטה')));
  // מיום השינוי — השיעור החדש (שינוי שהמשתמש רשם: בלי אזהרה גם אם הטבלה עוד לא עודכנה)
  const after = await acc.captureInvoice({ date: today, gross: '1190', expenseAccount: '6100' });
  assert.equal(after.amountsAg.vat, 19000);
  assert.ok(!after.warnings.some(w => w.includes('שיעור המע"מ בטיוטה')));
  // תקופה שנסגרה — לפי הטבלה
  assert.equal((await acc.captureInvoice({ date: '2024-06-01', gross: '1170', expenseAccount: '6100' })).amountsAg.vat, 17000);
  // תיקון הקלדה באותו יום — חוזר למצב הקודם, בלי שינוי רשום
  await acc.setVatRate(0.18);
  assert.deepEqual(db.peek().settings.vatRateChanges, []);
  assert.equal((await acc.captureInvoice({ date: today, gross: '1180', expenseAccount: '6100' })).amountsAg.vat, 18000);
  // שמירת הגדרות בלי שינוי שיעור לא רושמת שינוי
  await acc.saveSettings({ business });
  assert.deepEqual(db.peek().settings.vatRateChanges, []);
});

test('קליטת חשבונית: שיעור בהגדרות בלי שינוי רשום, ששונה מהשיעור הידוע לתאריך — אזהרה', async () => {
  const { acc } = freshAccounting({ settings: { vatRate: 0.19 } });
  const r = await acc.captureInvoice({ date: '2025-06-01', gross: '1190', expenseAccount: '6100' });
  assert.equal(r.amountsAg.vat, 19000);
  assert.ok(r.warnings.some(w => w.includes('שיעור המע"מ בטיוטה (19%)') && w.includes('(18%)')));
  // שיעור שהוקלד בטיוטה עצמה — בלי אזהרה
  const typed = await acc.captureInvoice({ date: '2025-06-01', gross: '1190', vatRate: 0.19, expenseAccount: '6100' });
  assert.ok(!typed.warnings.some(w => w.includes('שיעור המע"מ בטיוטה')));
});

test('טופס היומן הידני: ע.מ ספק עם ספרת ביקורת שגויה נדחה ולא נכנס ל-PCN874', async () => {
  const { acc, db } = freshAccounting();
  const lines = [{ account: '6900', debit: 100 }, { account: '1300', debit: 18 }, { account: '1000', credit: 118 }];
  await assert.rejects(acc.createEntry({ date: '2026-10-15', description: 'נייר', lines, vatDoc: { supplierTaxId: '514123456', reference: '9' } }), /ספרת ביקורת/);
  assert.equal(db.peek().journal.length, 0);
  const ok = await acc.createEntry({ date: '2026-10-15', description: 'נייר', lines, vatDoc: { supplierTaxId: '514123454', reference: '9' } });
  assert.equal(ok.vatDoc.supplierTaxId, '514123454');
});

test('suggestAccount: ספק שהוקלד ב-8 ספרות מזוהה מול הערך השמור המרופד ל-9', () => {
  const journal = [{ createdAt: '2026-01-10', vatDoc: { supplierTaxId: '012345674' }, lines: [{ account: '5000', debit: 100 }, { account: '1300', debit: 18 }] }];
  assert.equal(IC.suggestAccount({ supplierTaxId: '12345674' }, journal, ['5000']).account, '5000');
  assert.equal(IC.suggestAccount({ supplierTaxId: '012-345674' }, journal, ['5000']).account, '5000');
  assert.equal(IC.suggestAccount({ supplierTaxId: '12345675' }, journal, ['5000']), null);
});

test('ממצא 10: אחרי זיכוי חלקי — ההודעה והחשבונית מציגות את יתרת הנטו, והקלדתה סוגרת את החשבונית עד האגורה', async () => {
  const { acc } = freshAccounting({ settings: { vatRate: 0.18, business: { name: 'עסק לדוגמה' } } });
  const items = [{ description: 'א', quantity: 1, unitPrice: 10.25 }, { description: 'ב', quantity: 1, unitPrice: 10.25 }];
  const inv = await acc.createInvoice({ customer: 'משה כהן', date: '2026-10-01', items });
  await acc.createCreditNote(inv.id, { date: '2026-10-02', reason: 'החזרה', items: [{ description: 'א', quantity: 1, unitPrice: 10.25 }] });
  assert.equal((await acc.getInvoice(inv.id)).netBalance, 10.25);
  await assert.rejects(acc.createCreditNote(inv.id, { date: '2026-10-03', reason: 'יתרה' }), /זיכוי חלקי[\s\S]*לפני מע"מ: 10\.25 ₪/);
  const last = await acc.createCreditNote(inv.id, { date: '2026-10-03', reason: 'יתרה', items: [{ description: 'יתרה', quantity: 1, unitPrice: 10.25 }] });
  assert.equal(last.total, 12.09);
  const after = await acc.getInvoice(inv.id);
  assert.deepEqual([after.balance, after.netBalance], [0, 0]);
});

test('הממשק: טופס הזיכוי אחרי זיכוי חלקי — ברירת מחדל "זיכוי חלקי" ביתרת הנטו', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'modules', 'econ', 'ui', 'accounting.js'), 'utf8');
  const fn = ui.slice(ui.indexOf('async function handleCreditNote'), ui.indexOf('// ---------- חשבונית חוזרת'));
  assert.match(fn, /netBalance/);
  assert.match(fn, /value: partly \? 'partial'/);
});

test('ממצא 52: חשבונית ספק שכבר נרשמה — אזהרה בטיוטה, חסימה ברישום, ורישום רק באישור מפורש', async () => {
  const { acc, db } = freshAccounting();
  const input = { supplierName: 'ספק לדוגמה', supplierTaxId: '514123454', docNumber: 'INV-77', date: '2026-10-15', gross: '1180', expenseAccount: '6100' };
  const draft = await acc.captureInvoice(input);
  assert.equal(draft.duplicate, null);
  const first = await acc.createEntry(draft.entry);
  assert.deepEqual(first.vatDoc, { supplierTaxId: '514123454', reference: '77', docDate: '2026-10-15' });

  const again = await acc.captureInvoice(input);
  assert.equal(again.duplicate.entryId, first.id);
  assert.match(again.warnings[0], /כבר נרשמה ביומן/);
  await assert.rejects(acc.createEntry(again.entry), /כבר נרשמה ביומן[\s\S]*לאשר במפורש/);
  assert.equal(db.peek().journal.length, 1, 'לא נרשם כלום');
  // ספק אחר או אסמכתה אחרת — לא כפילות
  await acc.createEntry({ ...again.entry, vatDoc: { ...again.entry.vatDoc, reference: '78' } });
  // אישור מפורש — נרשם
  const forced = await acc.createEntry({ ...again.entry, confirmDuplicate: true });
  assert.ok(forced.id);
  assert.equal('confirmDuplicate' in forced, false, 'האישור לא נשמר ברשומה');
  assert.equal(db.peek().journal.length, 3);
});

test('ממצא 52: אחרי ביטול הרשומה המקורית אפשר לרשום את החשבונית שוב בלי אישור', async () => {
  const { acc } = freshAccounting();
  const input = { supplierTaxId: '514123454', docNumber: '500', date: '2026-10-15', gross: '118', expenseAccount: '6100' };
  const e1 = await acc.createEntry((await acc.captureInvoice(input)).entry);
  await acc.reverseEntry(e1.id);
  const draft = await acc.captureInvoice(input);
  assert.equal(draft.duplicate, null);
  assert.ok((await acc.createEntry(draft.entry)).id);
});

// ---------- תאריכים ----------
test('isDate קפדני: 2026-02-31 נדחה (לא מתגלגל ל-3.3) — ברשומת יומן, במסמך מכירה, בקליטה ובייבוא', () => {
  const lines = [{ account: '1000', debit: 1 }, { account: '4000', credit: 1 }];
  assert.throws(() => A.validateEntry({ date: '2026-02-31', lines }, A.DEFAULT_CHART), /תאריך/);
  assert.throws(() => A.validateEntry({ date: '2026-13-01', lines }, A.DEFAULT_CHART), /תאריך/);
  assert.equal(A.validateEntry({ date: '2028-02-29', lines }, A.DEFAULT_CHART).date, '2028-02-29');
  assert.throws(() => A.validateEntry({ date: '2027-02-29', lines }, A.DEFAULT_CHART), /תאריך/);
  assert.throws(() => SD.validateDraft('quote', { customer: 'א', date: '2026-02-31', items: [{ quantity: 1, unitPrice: 1 }] }, 0.18), /תאריך/);
  assert.throws(() => IC.draftEntry({ date: '2026-04-31', gross: '118', expenseAccount: '5000' }, { expenseAccounts: ['5000'] }), /תאריך/);
  const r = P.parseImport('tasks', 'כותרת,תאריך יעד\nמשימה,2026-02-31\nאחרת,2026-02-28\n', { tasks: [] });
  assert.equal(r.records.length, 1);
  assert.match(r.errors[0].message, /תאריך/);
});

test('תאריך נעילת תקופה: 2026-02-31 נדחה', async () => {
  const { acc } = freshAccounting();
  const business = { name: 'עסק לדוגמה' };
  await assert.rejects(acc.saveSettings({ lockDate: '2026-02-31', business }), /תאריך נעילה/);
  assert.equal((await acc.saveSettings({ lockDate: '2026-02-28', business })).lockDate, '2026-02-28');
});

test('isDate קפדני בכל המודול הכלכלי: אין עוד בדיקת תאריך שנשענת רק על Date.parse', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'modules', 'econ'));
  const loose = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/const is(Date|Day)\s*=/.test(line) && /Date\.parse/.test(line)) loose.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(loose, []);
});

// ---------- חישובים ----------
test('calculateLoan: שנים חלקיות או NaN נדחים; הכול באגורות והתשלום האחרון סוגר את היתרה', () => {
  for (const bad of [{ years: 2.5 }, { years: NaN }, { principal: 'abc' }, { annualRate: NaN }, { years: 0 }, { annualRate: -0.01 }]) {
    assert.throws(() => C.calculateLoan({ principal: 100000, annualRate: 0.05, years: 10, ...bad }), /אינם תקינים/);
  }
  const r = C.calculateLoan({ principal: 500000, annualRate: 0.045, years: 25 });
  assert.equal(r.monthlyPayment, 2779.16);
  const principalAg = r.yearlyBreakdown.reduce((t, y) => t + Math.round(y.principalPaid * 100), 0);
  assert.equal(principalAg, 50000000, 'סכום הקרן שנפרעה = הקרן בדיוק');
  assert.equal(r.yearlyBreakdown.at(-1).remainingBalance, 0);
  for (const v of [r.totalPaid, r.totalInterest, r.lastPayment]) assert.ok(Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6);
  assert.equal(Math.round(r.totalPaid * 100) - Math.round(r.totalInterest * 100), 50000000);
  // ריבית 0: 1000 ל-36 חודשים — 27.78 ושארית בתשלום האחרון, סה"כ 1000 בדיוק
  const z = C.calculateLoan({ principal: 1000, annualRate: 0, years: 3 });
  assert.equal(z.monthlyPayment, 27.78);
  assert.equal(z.lastPayment, 27.7);
  assert.equal(z.totalPaid, 1000);
});

test('calculateIRR: בלי פתרון בטווח — שגיאה, לא גבול החיפוש; עם פתרון — התשובה', () => {
  assert.throws(() => C.calculateIRR(100, [-10, -10]), /לא נמצא שיעור תשואה פנימי/);
  assert.throws(() => C.calculateIRR(100, ['x']), /אינם תקינים/);
  assert.equal(C.calculateIRR(100, [110]).irr, '10%');
  // הערך הנוכחי שלילי בקצה התחתון (תזרים שלילי בסוף) — הצמצום לפי הסימן, לא התכנסות לגבול 1000%
  assert.equal(C.calculateIRR(1, [100, -50]).irr, '-49.75%');
});

test('חלוקת תקציב: האחוזים מסתכמים ל-100 בדיוק, וסכום לא תקין נדחה', () => {
  const r = C.calculateBudgetAllocation({ מזון: 1, דיור: 1, חינוך: 1 });
  const sum = Object.values(r.allocations).reduce((t, a) => t + Math.round(a.percentage * 100), 0);
  assert.equal(sum, 10000);
  assert.equal(r.total, 3);
  const r2 = C.calculateBudgetAllocation({ א: 0.1, ב: 0.2, ג: 0.4 });
  assert.equal(r2.total, 0.7);
  assert.equal(Object.values(r2.allocations).reduce((t, a) => t + Math.round(a.percentage * 100), 0), 10000);
  assert.throws(() => C.calculateBudgetAllocation({ א: 'abc' }), /סכום לא תקין/);
  assert.throws(() => C.calculateBudgetAllocation({ א: -5 }), /סכום לא תקין/);
});

test('calculateFinancialMetrics: חישוב באגורות — 0.1 + 0.2 הוא 0.3', () => {
  const m = calculateFinancialMetrics([
    { type: 'income', amount: 0.1 }, { type: 'donation', amount: 0.2, vat: 0.05 }, { type: 'expense', amount: 0.1 }, { type: 'expense', amount: 'x' }
  ]);
  assert.equal(m.grossIncome, 0.3);
  assert.equal(m.netIncome, 0.25);
  assert.equal(m.totalExpense, 0.1);
  assert.equal(m.profit, 0.15);
  assert.equal(m.profitMargin, '50.00%');
  assert.equal(calculateFinancialMetrics([]).profitMargin, 'N/A');
});

// ---------- משימות ----------
test('משימות: "באיחור" מחושב בכל קריאה לפי היום המקומי — לא ביום היעד עצמו, ולא נשמר', async () => {
  delete require.cache[require.resolve('../modules/econ/services/tasksService')];
  const { TasksService, isOverdue } = require('../modules/econ/services/tasksService');
  const today = localDay();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = localDay(y);
  const db = memoryDb({ tasks: [{ id: 'old', title: 'ישנה', status: 'todo', dueDate: yesterday, isOverdue: false }] });
  TasksService.initialize(db);
  await TasksService.createTask(7, { title: 'היום', dueDate: today });
  const list = (await TasksService.getTasks(7)).tasks;
  assert.equal(list.find(t => t.id === 'old').isOverdue, true, 'דגל ישן שנשמר לא קובע');
  assert.equal(list.find(t => t.title === 'היום').isOverdue, false, 'ביום היעד — עוד לא באיחור');
  assert.deepEqual((await TasksService.getOverdueTasks(7)).map(t => t.id), ['old']);
  const done = await TasksService.updateTask(7, 'old', { status: 'done', isOverdue: true });
  assert.equal(done.isOverdue, false);
  assert.ok(db.peek().tasks.every(t => !('isOverdue' in t)), 'הדגל אינו נשמר');
  assert.equal(isOverdue({ dueDate: yesterday, status: 'todo' }, today), true);
  assert.equal(isOverdue({ dueDate: today, status: 'todo' }, today), false);
  assert.equal(isOverdue({ dueDate: '', status: 'todo' }, today), false);
});

// ---------- גבייה: תשלום בשמירה אחת ----------
const tmpDirs = [];
const dbs = [];
test.after(() => {
  for (const d of dbs) { try { d.db.close(); } catch { /* כבר סגור */ } }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* קובץ נעול — התיקייה הזמנית של run-tests תימחק */ } }
});

async function collectSetup() {
  const { initializeDatabase } = require('../modules/econ/core/database');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-acct-'));
  tmpDirs.push(dir);
  const db = await initializeDatabase(dir);
  dbs.push(db);
  for (const n of ['collectService', 'accountingService', 'npoService', 'gemachService']) delete require.cache[require.resolve('../modules/econ/services/' + n)];
  const S = (n, k) => require('../modules/econ/services/' + n)[k];
  const acc = S('accountingService', 'AccountingService');
  const npo = S('npoService', 'NpoService');
  const gem = S('gemachService', 'GemachService');
  const col = S('collectService', 'CollectService');
  for (const s of [acc, npo, gem, col]) s.initialize(db);
  return { db, acc, npo, col };
}

test('גבייה: תשלום ממסומן נרשם עם הדרישה בשמירה אחת — כשל בסימון לא משאיר קבלה, וניסיון חוזר לא מפיק קבלה שנייה', async () => {
  const { db, npo, col } = await collectSetup();
  await npo.saveSettings({ orgName: 'עמותת חסדי אבות', regNumber: '580000003' });
  const req = await col.createRequest({ kind: 'donation', amount: 180, payerName: 'יעקב לוי', description: 'תרומה לחג' });

  // כשל אחרי רישום התרומה ולפני סימון הדרישה — כלום לא נשמר
  const realSetPaid = col._setPaid;
  col._setPaid = async () => { throw new Error('כשל מדומה בשמירה'); };
  await assert.rejects(col.markPaid(req.id, { date: '2026-10-15', txId: 'T1' }), /כשל מדומה/);
  col._setPaid = realSetPaid;
  assert.equal((await npo._load()).npo.donations.length, 0, 'אין תרומה וקבלה בלי סימון הדרישה');
  assert.equal((await col.getOverview()).requests[0].status, 'open');
  assert.equal(typeof db.load, 'function');
  assert.equal(Object.prototype.hasOwnProperty.call(db, 'load'), false, 'המסד חזר למצבו');

  // ניסיון חוזר — תרומה וקבלה אחת, בשמירה אחת למסד
  const realSave = db.save;
  let saves = 0;
  db.save = async function (v) { saves++; return realSave.call(this, v); };
  const paid = await col.markPaid(req.id, { date: '2026-10-15', txId: 'T1' });
  db.save = realSave;
  assert.equal(saves, 1, 'שמירה אחת: התרומה, הקבלה והדרישה יחד');
  assert.equal(paid.status, 'paid');
  const donations = (await npo._load()).npo.donations;
  assert.equal(donations.length, 1);
  assert.ok(donations[0].receipt.number);
  await assert.rejects(col.markPaid(req.id, {}), /אינה ממתינה/);
  assert.equal((await npo._load()).npo.donations.length, 1);
});

test('גבייה: בזמן השמירה האחת אובייקט המסד לא משתנה — גיבוי באמצע רואה רק נתונים שנשמרו', async () => {
  const { db, acc, npo, col } = await collectSetup();
  await npo.saveSettings({ orgName: 'עמותת חסדי אבות', regNumber: '580000003' });
  const req = await col.createRequest({ kind: 'donation', amount: 52, payerName: 'יעקב לוי', description: 'תרומה' });
  const realSetPaid = col._setPaid;
  let seen = null;
  col._setPaid = async function (...args) {
    const backup = await db.backup();
    seen = {
      patched: ['load', 'save'].some(k => Object.prototype.hasOwnProperty.call(db, k)),
      persisted: ((backup.npo && backup.npo.donations) || []).length,
      inTx: (await npo._load()).npo.donations.length,
      sharedDb: [col, acc, npo].every(s => s.db !== db)
    };
    return realSetPaid.apply(this, args);
  };
  try { await col.markPaid(req.id, { date: '2026-10-15', txId: 'T9' }); } finally { col._setPaid = realSetPaid; }
  assert.deepEqual(seen, { patched: false, persisted: 0, inTx: 1, sharedDb: true });
  assert.ok([col, acc, npo].every(s => s.db === db), 'השירותים חזרו למסד');
  assert.equal(((await db.backup()).npo.donations || []).length, 1, 'אחרי השמירה — בגיבוי');
});

test('גבייה: תאריך לא אמיתי בסימון ידני לא נרשם (2026-02-31 ← היום)', async () => {
  const { col } = await collectSetup();
  const req = await col.createRequest({ kind: 'other', amount: 20, payerName: 'לקוח' });
  const paid = await col.markPaid(req.id, { date: '2026-02-31' });
  assert.equal(paid.payment.date, localDay());
});

test('הממשק: רישום חשבונית ספק כפולה שולח confirmDuplicate רק אחרי אישור', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'modules', 'econ', 'ui', 'accounting.js'), 'utf8');
  const preview = ui.slice(ui.indexOf('function showCapturePreview'), ui.indexOf('async function handleCaptureInvoice'));
  assert.match(preview, /result\.duplicate/);
  assert.match(preview, /askConfirm\(question\)[\s\S]*confirmDuplicate: true/);
  const journal = ui.slice(ui.indexOf("'acct-journal': {"), ui.indexOf("'acct-invoices': {"));
  assert.match(journal, /כבר נרשמה ביומן[\s\S]*askConfirm[\s\S]*confirmDuplicate: true/);
});
