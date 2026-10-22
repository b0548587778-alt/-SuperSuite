'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — מודול כלכלי: "היום" מקומי בגמ"ח ובעמותה, תאריך תשלום שגוי,
// תאריך הביטול בתקופה פתוחה, ונעילה בשינוי סיסמה
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../modules/econ/core/gemach');
const N = require('../modules/econ/core/npo');
const { initializeDatabase } = require('../modules/econ/core/database');
const { AccountingService } = require('../modules/econ/services/accountingService');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-review-econ-'));
const dbs = [];
test.after(() => { for (const db of dbs) { try { db.db.close(); } catch {} } fs.rmSync(tmp, { recursive: true, force: true }); });
const freshDb = async () => { const db = await initializeDatabase(fs.mkdtempSync(path.join(tmp, 'db-'))); dbs.push(db); return db; };
const pad = (n) => String(n).padStart(2, '0');
const localDay = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY = 24 * 60 * 60 * 1000;

test('גמ"ח ועמותה: ברירת המחדל של התאריך — היום לפי השעון המקומי, לא UTC', () => {
  for (const f of ['gemach.js', 'npo.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'core', f), 'utf8');
    assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, f);
  }
  const loan = G.validateLoanInput({ borrowerName: 'יעקב לוי', borrowerId: '000000018', amount: 1000, installments: 2, guarantorsText: 'משה כהן' });
  assert.equal(loan.issueDate, localDay());
  const donation = N.validateDonation({ donorName: 'אברהם כץ', amount: 180 }, N.normalizeSettings({}));
  assert.equal(donation.date, localDay());
});

test('גמ"ח: תאריך תשלום שהוקלד ואינו תקין — שגיאה, ולא "היום" בשקט', () => {
  const schedule = G.buildSchedule(1000, 2, '2026-01-10');
  const loan = { id: 'l1', status: 'active', schedule };
  assert.throws(() => G.recordPayment(loan, 1, { date: '31/12/2026' }), /תאריך התשלום אינו תקין/);
  assert.equal(G.recordPayment(loan, 1, { date: '2026-02-10' }).schedule[0].paidDate, '2026-02-10');
});

test('ביטול רשומה עם תאריך עתידי: הביטול לא נרשם לתוך תקופה נעולה', async () => {
  const svc = AccountingService;
  await svc.initialize(await freshDb());
  const lock = localDay(Date.now() + 30 * DAY);
  const future = localDay(Date.now() + 40 * DAY);
  const entry = await svc.createEntry({ date: future, lines: [{ account: '1000', debit: 1 }, { account: '4900', credit: 1 }] });
  await svc.saveSettings({ business: { name: 'עסק בדיקה' }, vatRate: 0.18, lockDate: lock });
  const rev = await svc.reverseEntry(entry.id);
  assert.ok(rev.date > lock, `הביטול (${rev.date}) אחרי הנעילה (${lock})`);
  assert.equal(rev.date, future);
});

test('שינוי סיסמה: 5 ניסיונות שגויים נועלים, כמו בכניסה', async () => {
  const db = await freshDb();
  const admin = await db.setupAdmin('menahel', 'correct-pass-1234');
  for (let i = 0; i < 5; i++) await assert.rejects(db.changePassword(admin.id, 'wrong-pass-0000', 'new-pass-123456'), /הסיסמה הנוכחית שגויה/);
  await assert.rejects(db.changePassword(admin.id, 'correct-pass-1234', 'new-pass-123456'), /ננעל זמנית/);
});
