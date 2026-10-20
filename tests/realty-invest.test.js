// נדל"ן ותיווך (שלב 6): כדאיות השקעה ומס רכישה לפי טבלה שהמשתמש מזין. אין מדרגות בקוד.
// המדרגות בבדיקות הן מספרים לדוגמה בלבד — לא ערכי אמת של שנה כלשהי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const I = require('../modules/econ/core/realtyInvest');

const SAMPLE = 'עד, שיעור\n1,000,000, 0\n2,000,000, 3.5\nמעל, 8';

test('קריאת מדרגות: אלפים עם פסיקים, כותרת מדולגת, שורה אחרונה פתוחה, אגורות ונקודות בסיס', () => {
  const b = I.parseBrackets(SAMPLE);
  assert.deepEqual(b, [{ upToAg: 100000000, bp: 0 }, { upToAg: 200000000, bp: 350 }, { upToAg: null, bp: 800 }]);
  assert.deepEqual(I.parseBrackets('1000000;0\n;8'), [{ upToAg: 100000000, bp: 0 }, { upToAg: null, bp: 800 }]);
  assert.throws(() => I.parseBrackets(''), /ריקה/);
  assert.throws(() => I.parseBrackets('2000000, 1\n1000000, 2\nמעל, 3'), /לעלות/);
  assert.throws(() => I.parseBrackets('1000000, 1\n2000000, 2'), /האחרונה/);
  assert.throws(() => I.parseBrackets('1000000, 120\nמעל, 3'), /השיעור/);
  assert.equal(I.bracketsText(b), '1000000, 0\n2000000, 3.5\nמעל, 8');
});

test('טבלה: שנה וסוג רוכש חובה; תצוגה "לא מאומת · שנה" עד אימות', () => {
  assert.throws(() => I.validateTaxTable({ kind: 'single', bracketsText: SAMPLE }), /שנת/);
  assert.throws(() => I.validateTaxTable({ year: 2026, bracketsText: SAMPLE }), /סוג רוכש/);
  const t = { id: 'x', ...I.validateTaxTable({ year: 2026, kind: 'single', bracketsText: SAMPLE, source: 'הוקלד לבדיקה' }) };
  const v = I.taxTableView(t);
  assert.equal(v.statusLabel, 'לא מאומת · 2026');
  assert.equal(v.brackets[1].from, 1000000);
  assert.equal(v.brackets[2].upTo, null);
  assert.equal(I.taxTableView({ ...t, verifiedAt: '2026-10-20' }).statusLabel, 'אומת');
});

test('מס מדורג: כל מדרגה מעוגלת לאגורה והסה"כ הוא סכום השורות', () => {
  const t = { brackets: I.parseBrackets(SAMPLE) };
  assert.equal(I.purchaseTax(80000000, t).taxAg, 0);
  const mid = I.purchaseTax(150000000, t);
  assert.equal(mid.taxAg, 1750000, '500,000 × 3.5%');
  assert.equal(mid.lines.length, 2);
  const top = I.purchaseTax(300000000, t);
  assert.equal(top.taxAg, 3500000 + 8000000);
  assert.equal(top.effectivePct, 3.83);
  const odd = I.purchaseTax(100000001, t);
  assert.equal(odd.taxAg, 0, 'אגורה אחת × 3.5% ← מעוגל ל-0');
  assert.equal(top.lines.reduce((s, l) => s + l.taxAg, 0), top.taxAg);
});

test('כדאיות: עלות כוללת, הון עצמי, החזר בשפיצר, תשואות ותזרים; אזהרות כשאין טבלה או לא מאומתת', () => {
  const tables = [{ id: 't', year: 2026, kind: 'additional', brackets: I.parseBrackets(SAMPLE) }];
  const r = I.investment({ price: 1500000, taxYear: 2026, taxKind: 'additional', lawyer: 7500, brokerage: 30000, loan: 750000, loanRate: 5, loanYears: 25, monthlyRent: 5000, occupiedMonths: 11, monthlyExpenses: 500 }, tables);
  assert.equal(r.tax.tax, 17500);
  assert.equal(r.taxSource, 'unverified');
  assert.ok(r.warnings.some(w => /לא מאומת · 2026/.test(w)));
  assert.equal(r.totalCostAg, (1500000 + 17500 + 7500 + 30000) * 100);
  assert.equal(r.equity, 1555000 - 750000);
  assert.equal(r.paymentAg, I.monthlyPayment(75000000, 5, 25));
  assert.ok(r.payment > 4300 && r.payment < 4500, 'החזר סביר לשפיצר 25 שנה ב-5%');
  assert.equal(r.annualRent, 55000);
  assert.equal(r.noi, 55000 - 6000);
  assert.equal(r.grossYieldPct, 3.67);
  assert.equal(r.cashFlowAg, r.noiAg - r.paymentAg * 12);
  assert.ok(r.cashFlowAg < 0 && r.warnings.some(w => /שלילי/.test(w)));
  assert.equal(r.ltvPct, 50);

  const none = I.investment({ price: 1000000, taxYear: 2030, taxKind: 'single' }, tables);
  assert.equal(none.tax.tax, 0);
  assert.ok(none.warnings.some(w => /אין טבלת מס רכישה/.test(w)), 'לא לוקחים שנה אחרת בשקט');
  assert.equal(none.grossYieldPct, null);
  const manual = I.investment({ price: 1000000, manualTax: 12345 }, tables);
  assert.equal(manual.taxSource, 'manual');
  assert.equal(manual.tax.tax, 12345);
  const verified = I.investment({ price: 1500000, taxYear: 2026, taxKind: 'additional' }, [{ ...tables[0], verifiedAt: 'x' }]);
  assert.equal(verified.taxSource, 'verified');
  assert.ok(!verified.warnings.some(w => /לא מאומת/.test(w)));
  assert.throws(() => I.investment({ price: 100, loan: 1000, loanYears: 10 }), /גדול מהעלות/);
  assert.throws(() => I.investment({ price: 100, loan: 50 }), /תקופה/);
  assert.throws(() => I.investment({}), /מחיר הנכס/);
  assert.equal(I.monthlyPayment(1200000, 0, 10), 10000, 'ריבית 0');
});

test('רשימת האימות לבעלים מסבירה שאין מדרגות מובנות; ואין מדרגות בקוד', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RULES-TO-VERIFY.md'), 'utf8');
  assert.match(doc, /אין בתוכנה מדרגות מס רכישה/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'core', 'realtyInvest.js'), 'utf8');
  assert.doesNotMatch(src, /\d{1,3},\d{3},\d{3}/, 'אין סכומי מדרגות בקוד');
});

// ---------- IPC ----------

const handlers = {};
let openFile = null;
Module._resolveFilename_orig_inv = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_inv__.js' : Module._resolveFilename_orig_inv.call(this, req, ...rest); };
require.cache['/__electron_stub_inv__.js'] = {
  id: '/__electron_stub_inv__.js', filename: '/__electron_stub_inv__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => (openFile ? { canceled: false, filePaths: [openFile] } : { canceled: true }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: טבלה מקובץ ← שמירה ← אימות למנהל בלבד ← חישוב; שמירה מחדש מבטלת אימות; ניתוח שמור', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-inv-'));
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev(97), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(97), 'menahel', 'menahel-strong-pass-1');
  await handlers['users:create'](ev(97), { username: 'orech', password: 'orech-strong-pass-1', role: 'editor' });
  await handlers['auth:login'](ev(98), 'orech', 'orech-strong-pass-1');

  assert.deepEqual(await handlers['rlty:readTaxTableFile'](ev(98)), { canceled: true });
  openFile = path.join(dir, 'brackets.csv');
  fs.writeFileSync(openFile, '﻿' + SAMPLE, 'utf8');
  const file = await handlers['rlty:readTaxTableFile'](ev(98));
  assert.equal(file.text, '1000000, 0\n2000000, 3.5\nמעל, 8');

  const t = await handlers['rlty:saveTaxTable'](ev(98), { year: 2026, kind: 'single', bracketsText: file.text });
  assert.equal(t.verified, false);
  await assert.rejects(handlers['rlty:verifyTaxTable'](ev(98), t.id, 'בדקתי'), /הרשאה/);
  await assert.rejects(handlers['rlty:verifyTaxTable'](ev(97), t.id, ''), /מאיפה/);
  const v = await handlers['rlty:verifyTaxTable'](ev(97), t.id, 'אתר רשות המסים');
  assert.equal(v.statusLabel, 'אומת');
  let r = await handlers['rlty:calcInvestment'](ev(98), { price: 1500000, taxYear: 2026, taxKind: 'single' });
  assert.equal(r.taxSource, 'verified');
  const again = await handlers['rlty:saveTaxTable'](ev(98), { year: 2026, kind: 'single', bracketsText: '1000000, 0\nמעל, 5' });
  assert.equal(again.id, t.id, 'אותה שנה וסוג — אותה טבלה');
  assert.equal(again.verified, false, 'ערך שהשתנה — האימות בוטל');
  r = await handlers['rlty:calcInvestment'](ev(98), { price: 1500000, taxYear: 2026, taxKind: 'single' });
  assert.equal(r.tax.tax, 25000);

  const p = await handlers['rlty:createProperty'](ev(97), { city: 'אלעד', asking: 1800000 });
  const a = await handlers['rlty:saveAnalysis'](ev(98), '', { name: 'דירה באלעד', propertyId: p.id, input: { price: '1800000', loan: '900000', loanRate: '4.5', loanYears: '30', junk: 'x' } });
  assert.equal(a.input.junk, undefined);
  await assert.rejects(handlers['rlty:saveAnalysis'](ev(98), '', { name: '', input: { price: 1 } }), /שם/);
  let ov = await handlers['rlty:getOverview'](ev(98));
  assert.equal(ov.taxTables.length, 1);
  assert.equal(ov.analyses.length, 1);
  await handlers['rlty:deleteProperty'](ev(97), p.id);
  ov = await handlers['rlty:getOverview'](ev(98));
  assert.equal(ov.analyses[0].propertyId, '', 'מחיקת נכס מנתקת את הניתוח');
  await assert.rejects(handlers['rlty:deleteTaxTable'](ev(98), t.id), /הרשאה/, 'לעורך אין מחיקה');
  await handlers['rlty:deleteTaxTable'](ev(97), t.id);
  await handlers['rlty:deleteAnalysis'](ev(97), a.id);
  ov = await handlers['rlty:getOverview'](ev(97));
  assert.equal(ov.taxTables.length + ov.analyses.length, 0);
});

test('המסך: לשונית הכדאיות, טבלאות, אימות למנהל, ערוצים ב-preload', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'realty.js'), 'utf8');
  for (const s of ["['invest', 'כדאיות ומס רכישה']", 'rltyInvCalc', 'rltyTaxTableSchema', 'data-rlty-tax-verify', 'rltyTaxFile', 'data-rlty-analysis']) assert.ok(ui.includes(s), s);
  assert.doesNotMatch(ui, /\b(alert|confirm|prompt)\(/);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,6}\b/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['calcInvestment', 'saveTaxTable', 'readTaxTableFile', 'deleteTaxTable', 'verifyTaxTable', 'unverifyTaxTable', 'saveAnalysis', 'deleteAnalysis']) assert.ok(preload.includes(`'rlty:${ch}'`), ch);
  assert.equal(ipc.permissionFor('rlty:verifyTaxTable'), 'users.manage');
  assert.equal(ipc.permissionFor('rlty:calcInvestment'), 'data.view');
  assert.equal(ipc.permissionFor('rlty:readTaxTableFile'), 'data.edit');
});
