// התאמת בנק (PLAN.md 9.4): קליטת דף בנק מקובץ (בלי חיבור לבנק), סכומים עם סימן באגורות, מניעת כפילויות
// בקליטה חוזרת, הצעות התאמה לחשבוניות פתוחות ולרשומות יומן, גבייה בהתאמה, ערוצים וממשק.
// כל הנתונים בדוגמאות בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const BR = require('../modules/econ/core/bankReconcile');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_bank__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_bank__.js'] = { id: '/__electron_stub_bank__.js', filename: '/__electron_stub_bank__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

// דף בנק לדוגמה: עמודות חובה/זכות, תאריך ישראלי, שתי תנועות שכירות זהות באותו יום
const HEB = [
  'תאריך,תיאור הפעולה,אסמכתא,חובה,זכות,יתרה',
  '05/07/2026,העברה מישיבת אור התורה חשבונית 1,12345,,"1,180.00","11,180.00"',
  '06/07/2026,עמלת ערוץ ישיר,,12.50,,"11,167.50"',
  '07/07/2026,שכירות משרד,555,"3,000.00",,"8,167.50"',
  '07/07/2026,שכירות משרד,555,"3,000.00",,"5,167.50"',
  'לא תאריך,שורה שגויה,,1,,'
].join('\n');
const HEB_MAP = { date: 'תאריך', description: 'תיאור הפעולה', reference: 'אסמכתא', debit: 'חובה', credit: 'זכות', balance: 'יתרה' };

test('סכום עם סימן באגורות: פסיקים, ₪, מינוס בסוף ובסוגריים; טקסט — NaN; ריק — null', () => {
  assert.equal(BR.parseSignedAg('1,234.50'), 123450);
  assert.equal(BR.parseSignedAg('-1,234.5'), -123450);
  assert.equal(BR.parseSignedAg('1,234.50-'), -123450);
  assert.equal(BR.parseSignedAg('(80)'), -8000);
  assert.equal(BR.parseSignedAg('₪ 0.07'), 7);
  assert.equal(BR.parseSignedAg('12 ש"ח'), 1200);
  assert.equal(BR.parseSignedAg(''), null);
  assert.ok(Number.isNaN(BR.parseSignedAg('abc')));
  assert.ok(Number.isNaN(BR.parseSignedAg('1.234')), 'יותר משתי ספרות אחרי הנקודה');
});

test('זיהוי עמודות: חובה/זכות בעברית, או עמודת סכום אחת — לא שתיהן; התאמה שמורה גוברת', () => {
  const pv = BR.preview(HEB, {});
  assert.deepEqual(pv.mapping, HEB_MAP);
  assert.equal(pv.total, 5);
  const en = BR.guessMapping(['Date', 'Description', 'Amount', 'Reference']);
  assert.deepEqual(en, { date: 'Date', description: 'Description', amount: 'Amount', reference: 'Reference' });
  assert.equal(BR.guessMapping(['תאריך', 'סכום', 'חובה', 'זכות']).amount, undefined);
  assert.equal(BR.preview(HEB, { bankMapping: { description: 'אסמכתא' } }).mapping.description, 'אסמכתא');
  assert.throws(() => BR.buildLines(HEB, { date: 'תאריך' }), /עמודת סכום/);
  assert.throws(() => BR.buildLines(HEB, { ...HEB_MAP, amount: 'יתרה' }), /לא את שתיהן/);
  assert.throws(() => BR.buildLines(HEB, { ...HEB_MAP, date: 'אין כזו' }), /לא נמצאה/);
  assert.throws(() => BR.buildLines('תאריך,סכום\n', { date: 'תאריך', amount: 'סכום' }), /ריק/);
});

test('קליטה: סימן לפי חובה/זכות, תנועות זהות נשמרות שתיהן, שורה שגויה נדחית; קליטה חוזרת — אפס כפילויות', () => {
  const r = BR.buildLines(HEB, HEB_MAP, []);
  assert.deepEqual(r.lines.map(l => l.amountAg), [118000, -1250, -300000, -300000]);
  assert.deepEqual(r.lines.map(l => l.date), ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-07']);
  assert.equal(r.lines[0].balanceAg, 1118000);
  assert.equal(r.lines[0].reference, '12345');
  assert.notEqual(r.lines[2].key, r.lines[3].key, 'שתי השכירויות נשמרות');
  assert.deepEqual(r.errors.map(e => e.line), [6]);
  const again = BR.buildLines(HEB, HEB_MAP, r.lines);
  assert.equal(again.lines.length, 0);
  assert.equal(again.skipped, 4);
  // קובץ חופף: שכירות אחת שכבר נקלטה ועוד אחת חדשה
  const overlap = ['תאריך,תיאור הפעולה,אסמכתא,חובה,זכות', '07/07/2026,שכירות משרד,555,3000,', '08/07/2026,הפקדה,9,,250'].join('\n');
  const o = BR.buildLines(overlap, { date: 'תאריך', description: 'תיאור הפעולה', reference: 'אסמכתא', debit: 'חובה', credit: 'זכות' }, r.lines);
  assert.equal(o.skipped, 1);
  assert.deepEqual(o.lines.map(l => l.amountAg), [25000]);
  // עמודת סכום אחת עם סימן (מינוס בסוף)
  const signed = BR.buildLines('date,description,amount\n2026-07-10,Bank fee,15.00-\n2026-07-11,Zero,0', { date: 'date', description: 'description', amount: 'amount' });
  assert.deepEqual(signed.lines.map(l => l.amountAg), [-1500]);
  assert.match(signed.errors[0].message, /בלי סכום/);
});

test('הצעות: חשבונית פתוחה באותה יתרה — עם תוספת לשם הלקוח ולמספר; רשומה בבנק — באותו סכום ובסמוך', () => {
  const line = { date: '2026-07-05', amountAg: 118000, description: 'העברה מישיבת אור התורה חשבונית 7', reference: '' };
  const invoices = [
    { id: 'a', number: 7, customer: 'ישיבת אור התורה', date: '2026-07-01', status: 'open', balance: 1180 },
    { id: 'b', number: 8, customer: 'כולל חזון איש', date: '2026-07-01', status: 'open', balance: 1180 },
    { id: 'c', number: 9, customer: 'ישיבת אור התורה', date: '2026-07-01', status: 'open', balance: 1000 },
    { id: 'd', number: 10, customer: 'ישיבת אור התורה', date: '2026-07-01', status: 'paid', balance: 1180 },
    { id: 'e', number: 11, customer: 'ישיבת אור התורה', date: '2025-01-01', status: 'open', balance: 1180 }
  ];
  const s = BR.suggest(line, { invoices });
  assert.deepEqual(s.map(x => x.id), ['a', 'b']);
  assert.ok(s[0].score > s[1].score);
  const journal = [
    { id: 'j1', date: '2026-07-07', description: 'שכירות', lines: [{ account: '6100', debit: 3000 }, { account: '1000', credit: 3000 }] },
    { id: 'j2', date: '2026-08-30', description: 'שכירות', lines: [{ account: '6100', debit: 3000 }, { account: '1000', credit: 3000 }] },
    { id: 'j3', date: '2026-07-07', description: 'שכירות', reversedBy: 'x', lines: [{ account: '6100', debit: 3000 }, { account: '1000', credit: 3000 }] }
  ];
  const rent = { date: '2026-07-07', amountAg: -300000, description: 'שכירות משרד', reference: '555' };
  assert.deepEqual(BR.suggest(rent, { invoices, journal }).map(x => x.id), ['j1']);
  assert.deepEqual(BR.suggest(rent, { invoices, journal, usedEntries: new Set(['j1']) }), []);
  assert.equal(BR.bankNetAg(journal[0]), -300000);
});

async function freshService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bank-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  await AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: { name: 'משרד לדוגמה', taxId: '123456782' }, vatRate: 0.18 });
  return { svc: AccountingService, db };
}

test('שירות: קליטה, גבייה בהתאמה בשמירה אחת, רשומה מתנועה, התאמה לרשומה קיימת וקליטה חוזרת בלי כפילויות', async () => {
  const { svc, db } = await freshService();
  const inv = await svc.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: [{ description: 'שירות', quantity: 1, unitPrice: 1000 }] });
  const rentEntry = await svc.createEntry({ date: '2026-07-07', description: 'שכירות יולי', lines: [{ account: '6100', debit: 3000 }, { account: '1000', credit: 3000 }] });

  const first = await svc.importBankFile(HEB, HEB_MAP);
  assert.deepEqual([first.added, first.skipped, first.errors.length], [4, 0, 1]);
  assert.deepEqual((await svc.previewBankFile(HEB)).mapping, HEB_MAP, 'ההתאמה נשמרה');
  const again = await svc.importBankFile(HEB, HEB_MAP);
  assert.deepEqual([again.added, again.skipped], [0, 4]);
  assert.equal((await db.load()).bankLines.length, 4);

  let v = await svc.getBankLines();
  assert.deepEqual([v.summary.total, v.summary.open, v.summary.inAg, v.summary.outAg], [4, 4, 118000, 601250]);
  const income = v.lines.find(l => l.amountAg === 118000);
  assert.equal(income.suggestions[0].type, 'invoice');
  assert.equal(income.suggestions[0].id, inv.id);

  // גבייה: תאריך התנועה, העברה בנקאית, אסמכתא, קבלה — הכול בשמירה אחת
  let saves = 0;
  const save = db.save.bind(db);
  db.save = async (d) => { saves++; return save(d); };
  await svc.matchBankLine(income.id, { type: 'invoice', id: inv.id });
  db.save = save;
  assert.equal(saves, 1);
  const paid = (await svc.getInvoices()).find(i => i.id === inv.id);
  assert.deepEqual([paid.status, paid.paidAt, paid.paymentMethod, paid.paymentRef], ['paid', '2026-07-05', 'transfer', '12345']);
  assert.ok(paid.receiptNumber, 'הופקה קבלה');
  await assert.rejects(svc.matchBankLine(income.id, { type: 'invoice', id: inv.id }), /כבר הותאמה/);

  // שתי שכירויות: הראשונה מותאמת לרשומה הקיימת; השנייה כבר לא מקבלת אותה כהצעה ולא ניתן להתאים אליה
  v = await svc.getBankLines();
  const rents = v.lines.filter(l => l.amountAg === -300000);
  assert.equal(rents[0].suggestions[0].id, rentEntry.id);
  await svc.matchBankLine(rents[0].id, { type: 'entry', id: rentEntry.id });
  v = await svc.getBankLines();
  const rest = v.lines.find(l => l.id === rents[1].id);
  assert.deepEqual(rest.suggestions, []);
  await assert.rejects(svc.matchBankLine(rents[1].id, { type: 'entry', id: rentEntry.id }), /כבר הותאמה לתנועה אחרת/);

  // עמלה: רשומה חדשה מול עמלות בנק, בתאריך ובסכום התנועה
  const fee = v.lines.find(l => l.amountAg === -1250);
  await assert.rejects(svc.createEntryFromBankLine(fee.id, { account: '1000' }), /שאינו חשבון הבנק/);
  const e = await svc.createEntryFromBankLine(fee.id, { account: '6600' });
  assert.equal(e.date, '2026-07-06');
  assert.deepEqual(e.lines.map(l => [l.account, l.debit, l.credit]), [['6600', 12.5, 0], ['1000', 0, 12.5]]);

  // לא לרישום, מחיקה רק של תנועה פתוחה
  await svc.matchBankLine(rents[1].id, { type: 'ignored', note: 'הועבר לחשבון אחר' });
  await assert.rejects(svc.deleteBankLine(rents[1].id), /מותאמת/);
  v = await svc.getBankLines();
  assert.deepEqual([v.summary.open, v.summary.matched, v.summary.ignored], [0, 3, 1]);

  // ביטול הגבייה בחשבונית מחזיר את התנועה לפתוחה — עם הצעה חוזרת לאותה חשבונית
  await svc.unrecordPayment(inv.id);
  v = await svc.getBankLines();
  const back = v.lines.find(l => l.id === income.id);
  assert.equal(back.status, 'open');
  assert.equal(back.suggestions[0].id, inv.id);
  await svc.unmatchBankLine(rents[1].id);
  await svc.deleteBankLine(rents[1].id);
  assert.equal((await db.load()).bankLines.length, 3);
});

test('שירות: גבייה חלקית נדחית; תנועת חובה לא גובה חשבונית; רשומה שבוטלה לא מותאמת', async () => {
  const { svc } = await freshService();
  const inv = await svc.createInvoice({ customer: 'כולל חזון איש', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 500 }] });
  await svc.importBankFile(['תאריך,תיאור,סכום', '02/07/2026,העברה,500', '03/07/2026,משיכה,-590'].join('\n'), { date: 'תאריך', description: 'תיאור', amount: 'סכום' });
  const v = await svc.getBankLines();
  const part = v.lines.find(l => l.amountAg === 50000);
  const out = v.lines.find(l => l.amountAg === -59000);
  assert.deepEqual(part.suggestions, []);
  await assert.rejects(svc.matchBankLine(part.id, { type: 'invoice', id: inv.id }), /גבייה חלקית/);
  await assert.rejects(svc.matchBankLine(out.id, { type: 'invoice', id: inv.id }), /תנועת זכות/);
  const e = await svc.createEntry({ date: '2026-07-03', description: 'משיכה', lines: [{ account: '6900', debit: 590 }, { account: '1000', credit: 590 }] });
  await svc.reverseEntry(e.id);
  await assert.rejects(svc.matchBankLine(out.id, { type: 'entry', id: e.id }), /שבוטלה/);
  await assert.rejects(svc.matchBankLine(out.id, { type: 'bogus' }), /לא מוכר/);
});

test('ערוצים, הרשאות, preload, קטלוג ומסך', () => {
  const { permissionFor } = require('../modules/econ/ipc');
  assert.equal(permissionFor('acct:getBankLines'), 'data.view');
  assert.equal(permissionFor('acct:importBankFile'), 'data.edit');
  assert.equal(permissionFor('acct:matchBankLine'), 'data.edit');
  assert.equal(permissionFor('acct:createEntryFromBankLine'), 'data.edit');
  assert.equal(permissionFor('acct:deleteBankLine'), 'data.delete');
  const ROOT = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const ipc = read('modules/econ/ipc.js');
  const preload = read('modules/econ/preload.js');
  for (const ch of ['getBankLines', 'previewBankFile', 'importBankFile', 'matchBankLine', 'createEntryFromBankLine', 'unmatchBankLine', 'deleteBankLine']) {
    assert.match(ipc, new RegExp(`handle\\('acct:${ch}'`), ch);
    assert.match(preload, new RegExp(`'acct:${ch}'`), ch);
  }
  // בלי רשת: מקור הנתונים הוא קובץ בלבד
  assert.doesNotMatch(read('modules/econ/core/bankReconcile.js'), /require\('(https?|net|electron)'\)|fetch\(/);
  assert.ok(require('../shell/catalog').ECON_VIEWS.includes('acct-bank'));
  assert.match(read('modules/econ/views/index.html'), /data-view="acct-bank"/);

  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const html = vm.runInContext(`renderAcctBank({ summary: { total: 2, open: 1, matched: 1, ignored: 0, inAg: 118000, outAg: 0 }, lines: [
    { id: 'l1', date: '2026-07-05', amountAg: 118000, description: '<b>העברה</b>', reference: '12345', status: 'open',
      suggestions: [{ type: 'invoice', id: 'i1', label: 'חשבונית 1 — ישיבת אור התורה', date: '2026-07-01', score: 90 }] },
    { id: 'l2', date: '2026-07-04', amountAg: 5000, description: 'הפקדה', reference: '', status: 'matched', match: { type: 'entry', entryId: 'x' } }
  ] })`, context);
  assert.match(html, /id="acctBankImport"/);
  assert.match(html, /data-bank-match="l1" data-type="invoice" data-target="i1"/);
  assert.match(html, /גבייה והתאמה/);
  assert.doesNotMatch(html, /<b>העברה<\/b>/, 'התיאור מהקובץ מנוטרל');
  assert.doesNotMatch(html, /data-bank-unmatch="l1"/);
  assert.doesNotMatch(html, /data-bank-unmatch="l2"/, 'ברירת המחדל מציגה רק תנועות שלא הותאמו');
  assert.equal(vm.runInContext(`viewTitles['acct-bank']`, context), 'התאמת בנק');
});
