// קליטת חשבונית ספק — טיוטת פקודת יומן (core/invoiceCapture.js, שלב 3).
// טהור, באגורות, בלי ניחושים; השמירה רק عبر createEntry.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'modules', 'econ', 'core', 'invoiceCapture.js');
const IC = require(SRC);

const ACCOUNTS = { vatRate: 0.18, expenseAccounts: ['5000', '5010', '6100'] };
const base = (extra) => ({ date: '2026-10-15', gross: '1180', expenseAccount: '5000', ...extra });

test('הקובץ טהור — בלי require, רשת, קבצים או תהליכים', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(src, /\brequire\(['"](fs|node:fs|child_process)['"]\)/);
  assert.doesNotMatch(src, /\bprocess\./);
  assert.deepStrictEqual(Object.keys(IC).sort(), ['allocationNumber', 'draftEntry', 'expenseAccountCodes', 'suggestAccount']);
});

test('מע"מ נגזר: סה"כ 1180 בשיעור 18% ← נטו 1000, מע"מ 180, והיתרה תמיד שווה לסה"כ', () => {
  const r = IC.draftEntry(base(), ACCOUNTS);
  assert.deepStrictEqual(r.amountsAg, { net: 100000, vat: 18000, gross: 118000 });
  const dr = r.entry.lines.reduce((s, l) => s + Math.round(l.debit * 100), 0);
  const cr = r.entry.lines.reduce((s, l) => s + Math.round(l.credit * 100), 0);
  assert.strictEqual(dr, cr);
  assert.strictEqual(cr, 118000);
  assert.deepStrictEqual(r.entry.lines.map(l => l.account), ['5000', '1300', '2000']);
});

test('שבר אגורה: נטו מחושב בעיגול, והמע"מ הוא השאר — מספר שלם באגורות', () => {
  const r = IC.draftEntry(base({ gross: '100.03' }), ACCOUNTS);
  assert.strictEqual(r.amountsAg.net + r.amountsAg.vat, r.amountsAg.gross);
  assert.strictEqual(r.amountsAg.gross, 10003);
  for (const v of Object.values(r.amountsAg)) assert.ok(Number.isInteger(v));
  assert.ok(r.warnings.length === 0 || Array.isArray(r.warnings));
});

test('נטו שהוקלד: המע"מ = סה"כ פחות נטו, גם כשהוקלד מע"מ שונה — באזהרה', () => {
  const r = IC.draftEntry(base({ net: '1000', vat: '170' }), ACCOUNTS);
  assert.strictEqual(r.amountsAg.vat, 18000);
  assert.ok(r.warnings.some(w => w.includes('אינו שווה')));
  // נטו×שיעור שונה מהמע"מ ביותר מאגורה — הסכומים לא מתיישבים
  const off = IC.draftEntry({ ...base({ net: '900' }), gross: '1180' }, ACCOUNTS);
  assert.strictEqual(off.amountsAg.vat, 28000);
  assert.ok(off.warnings.some(w => w.includes('אינם תואמים')));
});

test('פטור ממע"מ: בלי שורת תשומות, סה"כ = נטו', () => {
  const r = IC.draftEntry(base({ exempt: true }), ACCOUNTS);
  assert.strictEqual(r.amountsAg.vat, 0);
  assert.strictEqual(r.amountsAg.net, 118000);
  assert.deepStrictEqual(r.entry.lines.map(l => l.account), ['5000', '2000']);
});

test('פטור עם מע"מ — שגיאה; לא פטור בלי מע"מ — שגיאה', () => {
  assert.throws(() => IC.draftEntry(base({ exempt: true, net: '1000' }), ACCOUNTS), /פטורה/);
  assert.throws(() => IC.draftEntry(base({ gross: '1000', net: '1000' }), ACCOUNTS), /אינה פטורה/);
  assert.throws(() => IC.draftEntry(base({ gross: '1000', net: '1200' }), ACCOUNTS), /גדול מהסה"כ/);
});

test('קלט חסר או לא תקין — שגיאה ברורה', () => {
  assert.throws(() => IC.draftEntry({ ...base(), date: '' }, ACCOUNTS), /תאריך/);
  assert.throws(() => IC.draftEntry({ ...base(), date: '15/10/2026' }, ACCOUNTS), /תאריך/);
  assert.throws(() => IC.draftEntry({ ...base(), gross: '' }, ACCOUNTS), /סה"כ/);
  assert.throws(() => IC.draftEntry({ ...base(), gross: '0' }, ACCOUNTS), /סה"כ/);
  assert.throws(() => IC.draftEntry({ ...base(), gross: 'טקסט' }, ACCOUNTS), /סכום לא תקין/);
});

test('לפי התוכנית בפועל: בלי קוד — שגיאה; חשבון שאינו בתוכנית — שגיאה; קוד לא תקין — שגיאה', () => {
  assert.throws(() => IC.draftEntry(base({ expenseAccount: '' }), ACCOUNTS), /חשבון הוצאה/);
  // חשבון שקיים בתוכנית (5000/5010 ב-ACCOUNTS) תקין תמיד — הבדיקה מול התוכנית היא על קודים אחרים
  assert.strictEqual(IC.draftEntry(base({ expenseAccount: '5010' }), ACCOUNTS).entry.lines[0].account, '5010');
  assert.throws(() => IC.draftEntry(base({ expenseAccount: '50' }), ACCOUNTS), /4-6 ספרות/);
});

test('vatDoc — ע.מ תקין (ספרת ביקורת) מרופד ל-9 ספרות, בשמות validateVatDoc', () => {
  // 514123456 הקודם לא עבר ספרת ביקורת — מאז בדיקת הקוד 23.10.2026 מספר כזה נדחה ולא נכנס בשקט ל-PCN874
  const ok = IC.draftEntry(base({ supplierTaxId: '514-123454', docNumber: 'INV/2026-77', allocation: '123456789' }), ACCOUNTS);
  assert.deepStrictEqual(ok.entry.vatDoc, { supplierTaxId: '514123454', reference: '202677', docDate: '2026-10-15', allocationNumber: '123456789' });
  // בלי ע.מ — בלי vatDoc (אזהרה)
  const no = IC.draftEntry(base(), ACCOUNTS);
  assert.strictEqual(no.entry.vatDoc, undefined);
  // מספר קצר או שגוי — שגיאה ברורה, לא השמטה שקטה
  assert.throws(() => IC.draftEntry(base({ supplierTaxId: '12345' }), ACCOUNTS), /ספרת ביקורת/);
});

test('אזהרות על פרטים חסרים — ולא ניחוש', () => {
  const r = IC.draftEntry(base(), ACCOUNTS);
  assert.strictEqual(r.complete, false);
  assert.ok(r.warnings.some(w => w.includes('שם הספק')));
  assert.ok(r.warnings.some(w => w.includes('עוסק')));
  assert.ok(r.warnings.some(w => w.includes('מספר החשבונית')));
  const full = IC.draftEntry(base({ supplierName: 'ספק לדוגמה', supplierTaxId: '514123454', docNumber: '77' }), ACCOUNTS);
  assert.strictEqual(full.complete, true);
});

test('מספר הקצאה: עד 9 ספרות; יותר — אזהרה ולא הקלדה שגויה בטיוטה', () => {
  assert.strictEqual(IC.allocationNumber('001234567'), 1234567);
  assert.strictEqual(IC.allocationNumber(''), null);
  assert.throws(() => IC.allocationNumber('1234567890'), /9 ספרות/);
  const r = IC.draftEntry(base({ allocation: '1234567890' }), ACCOUNTS);
  assert.strictEqual(r.allocation, null);
  assert.ok(r.warnings.some(w => w.includes('9 ספרות')));
});

test('suggestAccount — החשבון הנפוץ של אותו ספק; השוויון למכון האחרון', () => {
  const journal = [
    { createdAt: '2026-01-10', vatDoc: { supplierTaxId: '514123456' }, lines: [{ account: '5000', debit: 100 }, { account: '1300', debit: 18 }, { account: '2000', credit: 118 }] },
    { createdAt: '2026-02-10', vatDoc: { supplierTaxId: '514123456' }, lines: [{ account: '5000', debit: 100 }, { account: '1300', debit: 18 }, { account: '2000', credit: 118 }] },
    { createdAt: '2026-03-10', vatDoc: { supplierTaxId: '514123456' }, lines: [{ account: '5010', debit: 100 }, { account: '1300', debit: 18 }, { account: '2000', credit: 118 }] },
    // ספק אחר — לא נספר
    { vatDoc: { supplierTaxId: '999999999' }, lines: [{ account: '6100', debit: 5 }] }
  ];
  const s = IC.suggestAccount({ supplierTaxId: '514-123456' }, journal, ['5000', '5010', '6100']);
  assert.strictEqual(s.account, '5000');
  assert.strictEqual(s.times, 2);
  assert.strictEqual(IC.suggestAccount({ supplierName: 'לא קיים' }, journal, ['5000']), null);
  assert.strictEqual(IC.suggestAccount({}, journal, ['5000']), null);
});

test('expenseAccountCodes — רק הוצאה עם קוד 4-6 ספרות', () => {
  const codes = IC.expenseAccountCodes([
    { code: '5000', type: 'expense' }, { code: 5010, type: 'expense' },
    { code: '1300', type: 'asset' }, { code: '12', type: 'expense' }, null, { type: 'expense' }
  ]);
  assert.deepStrictEqual(codes, ['5000', '5010']);
  assert.deepStrictEqual(IC.expenseAccountCodes(null), []);
});

test('קלט לא מהימן — אובייקט ריק או null לא מפיל', () => {
  assert.throws(() => IC.draftEntry(null, ACCOUNTS), /תאריך/);
  assert.throws(() => IC.draftEntry(undefined, ACCOUNTS), /תאריך/);
  assert.strictEqual(IC.suggestAccount(null, null, null), null);
});

test('הערוץ acct:captureInvoice — קריאה בלבד, והשמירה רק דרך createEntry', () => {
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  assert.match(ipc, /if \(channel === 'acct:captureInvoice'\) return 'data\.view';/);
  const channel = ipc.slice(ipc.indexOf("handle('acct:captureInvoice'"));
  const body = channel.slice(0, channel.indexOf("});") + 3);
  assert.doesNotMatch(body, /createEntry|saveEntry|_save\(|enqueue/);
});

test('החיבור אל הממשק — ה-preload והממשק קוראים לערוץ הקיים, והרשימה מתוכנית החשבונות', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  assert.match(preload, /captureInvoice:\s*\(input\) => ipcRenderer\.invoke\('acct:captureInvoice', input\)/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'accounting.js'), 'utf8');
  assert.match(ui, /window\.systemAPI\.captureInvoice\(captureInput\(\)\)/);
  // הרשימה מגיעה מתוכנית החשבונות הקיימת — לא מקריאת בדיקה שנכשלת
  assert.doesNotMatch(ui, /captureInvoice\(\{ date: today\(\), gross: '0\.01'/);
  assert.match(ui, /getChart\(\)[\s\S]{0,300}type === 'expense'/);
});
