// גמ"ח: לוגיקה טהורה (לוח סילוקין ללא ריבית, ערבים, פיגורים) + ערוצי IPC מול מסד אמיתי
// (הרשאות, גיבוי מוצפן וייצוא).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const G = require('../modules/econ/core/gemach');
const BK = require('../modules/econ/core/backupCrypto');

// ---------- לוגיקה ----------

test('לוח סילוקין: חלוקה שווה בלי ריבית; שארית העיגול נספחת לתשלום האחרון', () => {
  const schedule = G.buildSchedule(1000, 3, '2026-01-15');
  assert.equal(schedule.length, 3);
  assert.deepEqual(schedule.map(s => s.amountAg), [33333, 33333, 33334]);
  assert.equal(schedule.reduce((t, s) => t + s.amountAg, 0), 100000, 'הסכום הכולל שווה בדיוק לסכום ההלוואה');
  assert.equal(schedule[0].dueDate, '2026-02-15');
  assert.equal(schedule[2].dueDate, '2026-04-15');
});

test('ולידציית הלוואה: שם לווה חובה, סכום ומספר תשלומים תקינים, עד 5 ערבים', () => {
  assert.throws(() => G.validateLoanInput({ borrowerName: '', amount: 100, installments: 1 }), /שם הלווה/);
  assert.throws(() => G.validateLoanInput({ borrowerName: 'א', amount: -5, installments: 1 }), /סכום/);
  assert.throws(() => G.validateLoanInput({ borrowerName: 'א', amount: 100, installments: 0 }), /תשלומים/);
  assert.throws(() => G.validateLoanInput({ borrowerName: 'א', amount: 100, installments: 1, borrowerId: '12ab' }), /זהות/);
  const tooMany = Array.from({ length: 6 }, (_, i) => ({ name: 'ערב' + i }));
  assert.throws(() => G.validateLoanInput({ borrowerName: 'א', amount: 100, installments: 1, guarantors: tooMany }), /ערבים/);
  const ok = G.validateLoanInput({ borrowerName: 'משה כהן', amount: 10.005, installments: 2, guarantors: [{ name: 'ראובן' }] });
  assert.equal(ok.amount, 10.01, 'סכום מעוגל לאגורה');
  assert.equal(ok.guarantors[0].name, 'ראובן');
});

test('רישום תשלום: חלקי ומלא, וסגירת ההלוואה כשכל התשלומים נפרעו', () => {
  const clean = G.validateLoanInput({ borrowerName: 'א', amount: 300, installments: 3, issueDate: '2026-01-01' });
  let loan = { id: 'L1', ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active' };
  loan = G.recordPayment(loan, 1, { amount: 50, date: '2026-02-01' });
  assert.equal(loan.schedule[0].status, 'partial');
  assert.equal(loan.status, 'active');
  loan = G.recordPayment(loan, 1, {}); // משלים את הנותר באותו תשלום
  assert.equal(loan.schedule[0].status, 'paid');
  assert.throws(() => G.recordPayment(loan, 1, {}), /כבר נפרע/, 'תשלום שכבר נפרע');
  assert.throws(() => G.recordPayment(loan, 2, { amount: 999999 }), /גבוה מהנותר/, 'סכום גבוה מהיתרה הפתוחה של התשלום');
  loan = G.recordPayment(loan, 2, {});
  loan = G.recordPayment(loan, 3, {});
  assert.equal(loan.status, 'closed', 'כל התשלומים נפרעו — ההלוואה נסגרת אוטומטית');
  assert.equal(G.outstandingAg(loan), 0);
});

test('פיגורים: תשלום שעבר מועדו ולא נפרע, בהלוואה פעילה בלבד', () => {
  const clean = G.validateLoanInput({ borrowerName: 'א', amount: 200, installments: 2, issueDate: '2026-01-01' });
  const loan = { id: 'L2', ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active' };
  const late = G.arrears(loan, '2026-06-01');
  assert.equal(late.length, 2, 'שני התשלומים כבר עברו ולא שולמו');
  const cancelled = { ...loan, status: 'cancelled' };
  assert.equal(G.arrears(cancelled, '2026-06-01').length, 0, 'הלוואה שבוטלה לא נספרת בפיגורים');
});

test('סקירה כוללת: יתרת קופה = הפקדות פחות יתרת חוב פתוחה, ורמת רישוי לפי סף', () => {
  const settings = G.normalizeSettings({});
  const loan1 = (() => {
    const clean = G.validateLoanInput({ borrowerName: 'א', amount: 1000, installments: 1, issueDate: '2026-01-01' });
    return { id: 'L1', ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active' };
  })();
  const deposits = [{ date: '2026-01-01', depositorName: 'תורם', amount: 5000 }];
  const o = G.overview([loan1], deposits, settings, '2026-06-01');
  assert.equal(o.depositsTotal, 5000);
  assert.equal(o.outstandingTotal, 1000);
  assert.equal(o.balance, 4000);
  assert.equal(o.licenseTier, 'exempt');
  const bigLoan = (() => {
    const clean = G.validateLoanInput({ borrowerName: 'ב', amount: 2000000, installments: 1, issueDate: '2026-01-01' });
    return { id: 'L3', ...clean, schedule: G.buildSchedule(clean.amount, clean.installments, clean.issueDate), status: 'active' };
  })();
  const o2 = G.overview([loan1, bigLoan], deposits, settings, '2026-06-01');
  assert.equal(o2.licenseTier, 'basic', 'יתרת חוב פתוחה מעל הסף הבסיסי');
});

// ---------- IPC מול מסד אמיתי ----------

const handlers = {};
const saved = [];
let saveTarget = null;
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_gemach__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_gemach__.js'] = {
  id: '/__electron_stub_gemach__.js', filename: '/__electron_stub_gemach__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async (opts) => { saved.push(opts); return saveTarget ? { canceled: false, filePath: saveTarget } : { canceled: true }; } }
  }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemach-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(id), 'gemach_admin', 'gemach-strong-pass-2026');
  await handlers['auth:login'](ev(id), 'gemach_admin', 'gemach-strong-pass-2026');
  return dir;
}

test('IPC גמ"ח: דורש כניסה; צפייה בלבד לא יכולה להוסיף הלוואה או לרשום תשלום', async () => {
  await freshLogin(61);
  await assert.rejects(handlers['gemach:getOverview'](ev(199)), /נדרשת כניסה/);
  const l = await handlers['gemach:addLoan'](ev(61), { borrowerName: 'א', amount: 300, installments: 3, issueDate: '2026-01-01' });
  AuthService.getSession(61).permissions = ['data.view'];
  const o = await handlers['gemach:getOverview'](ev(61));
  assert.equal(o.loans.length, 1, 'צפייה מותרת');
  await assert.rejects(handlers['gemach:addLoan'](ev(61), { borrowerName: 'ב', amount: 1, installments: 1 }), /אין הרשאה/);
  await assert.rejects(handlers['gemach:recordPayment'](ev(61), l.id, 1, {}), /אין הרשאה/);
  await assert.rejects(handlers['gemach:exportCsv'](ev(61), 'loans'), /אין הרשאה/);
});

test('IPC גמ"ח: הלוואה -> תשלומים -> סגירה; לא ניתן לבטל הלוואה עם תשלומים', async () => {
  await freshLogin(62);
  const l = await handlers['gemach:addLoan'](ev(62), { borrowerName: 'יוסף', amount: 300, installments: 3, issueDate: '2026-01-01', guarantors: [{ name: 'שמעון' }] });
  assert.equal(l.schedule.length, 3);
  await handlers['gemach:recordPayment'](ev(62), l.id, 1, {});
  await assert.rejects(handlers['gemach:cancelLoan'](ev(62), l.id), /כבר נרשמו עליה תשלומים/);
  await handlers['gemach:recordPayment'](ev(62), l.id, 2, {});
  await handlers['gemach:recordPayment'](ev(62), l.id, 3, {});
  const o = await handlers['gemach:getOverview'](ev(62));
  assert.equal(o.loans[0].status, 'closed');
  assert.equal(o.overview.outstandingTotal, 0);
});

test('IPC גמ"ח: הפקדות נכנסות ליתרת הקופה, ונמחקות', async () => {
  await freshLogin(63);
  await handlers['gemach:addDeposit'](ev(63), { depositorName: 'תורם', amount: 1000, date: '2026-01-01' });
  const d2 = await handlers['gemach:addDeposit'](ev(63), { depositorName: 'תורם ב', amount: 500, date: '2026-01-02' });
  let o = await handlers['gemach:getOverview'](ev(63));
  assert.equal(o.overview.depositsTotal, 1500);
  await handlers['gemach:deleteDeposit'](ev(63), d2.id);
  o = await handlers['gemach:getOverview'](ev(63));
  assert.equal(o.overview.depositsTotal, 1000);
  await assert.rejects(handlers['gemach:deleteDeposit'](ev(63), 'nope'), /לא נמצאה/);
});

test('IPC גמ"ח: הנתונים נכנסים לגיבוי המוצפן הקיים ומשוחזרים ממנו', async () => {
  await freshLogin(64);
  await handlers['gemach:addLoan'](ev(64), { borrowerName: 'אהרן', amount: 360, installments: 1, issueDate: '2026-01-01' });
  const enc = await handlers['data:backupEncrypted'](ev(64), 'backup-pass-123');
  assert.ok(BK.isEncryptedBackup(enc));
  assert.doesNotMatch(enc, /אהרן/, 'אין טקסט גלוי בגיבוי');
  const plain = JSON.parse(BK.decryptBackup(enc, 'backup-pass-123'));
  assert.equal(plain.gemach.loans[0].borrowerName, 'אהרן');

  await freshLogin(65);
  assert.equal((await handlers['gemach:getOverview'](ev(65))).loans.length, 0);
  await handlers['data:restoreEncrypted'](ev(65), enc, 'backup-pass-123');
  const o = await handlers['gemach:getOverview'](ev(65));
  assert.equal(o.loans.length, 1);
});

test('IPC גמ"ח: ייצוא CSV בעברית עם BOM, ונטרול נוסחאות בשם הלווה', async () => {
  await freshLogin(66);
  await handlers['gemach:addLoan'](ev(66), { borrowerName: '=HYPERLINK("x")', amount: 1, installments: 1, issueDate: '2026-01-01' });
  saveTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-gemach-csv-')), 'd.csv');
  const r = await handlers['gemach:exportCsv'](ev(66), 'loans');
  saveTarget = null;
  assert.equal(r.ok, true);
  const csv = fs.readFileSync(r.path, 'utf8');
  assert.ok(csv.startsWith('﻿'), 'BOM לאקסל');
  assert.match(csv, /'=HYPERLINK/, 'נוסחה מנוטרלת');
  await assert.rejects(handlers['gemach:exportCsv'](ev(66), 'unknown'), /לא נתמך/);
});
