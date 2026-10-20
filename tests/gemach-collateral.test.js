// הלוואה כנגד פיקדון בגמ"ח (PLAN.md עדיפות 4): הפקדה קיימת בקופה משמשת בטוחה במקום ערבים.
// פיקדון אחד להלוואה פעילה אחת, ההלוואה לא גבוהה מהפיקדון, והפיקדון לא נמחק עד שההלוואה נפרעת / מבוטלת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../modules/econ/core/gemach');
const { source } = require('./helpers/econ-ui');

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-collateral-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const db = await initializeDatabase(dir);
  const { GemachService } = require('../modules/econ/services/gemachService');
  await GemachService.initialize(db);
  return GemachService;
}

const LOAN = { borrowerName: 'שמעון לוי', amount: 5000, installments: 5, issueDate: '2026-01-01' };

test('לוגיקה: בטוחה תקינה, פיקדון חסר, קטן מדי או משועבד — נדחים בעברית', () => {
  const deposits = [{ id: 'd1', depositorName: 'אהרן כהן', amount: 6000, date: '2026-01-01' }];
  assert.doesNotThrow(() => G.assertCollateral('d1', 6000, deposits, []));
  assert.doesNotThrow(() => G.assertCollateral('', 99999, deposits, []), 'בלי פיקדון — אין בדיקה');
  assert.throws(() => G.assertCollateral('nope', 100, deposits, []), /לא נמצא/);
  assert.throws(() => G.assertCollateral('d1', 6000.01, deposits, []), /גבוה מהפיקדון/);
  const active = [{ status: 'active', collateralDepositId: 'd1', borrowerName: 'שמעון לוי' }];
  assert.throws(() => G.assertCollateral('d1', 100, deposits, active), /כבר משמש בטוחה להלוואה של שמעון לוי/);
  assert.doesNotThrow(() => G.assertCollateral('d1', 100, deposits, [{ ...active[0], status: 'closed' }]), 'הלוואה שנפרעה משחררת');
  assert.doesNotThrow(() => G.assertCollateral('d1', 100, deposits, [{ ...active[0], status: 'cancelled' }]), 'הלוואה שבוטלה משחררת');
});

test('שירות: הלוואה כנגד פיקדון בלי ערבים, והפיקדון מסומן ונעול למחיקה', async () => {
  const gm = await fresh();
  const dep = await gm.addDeposit({ date: '2026-01-01', depositorName: 'אהרן כהן', amount: 6000 });
  const loan = await gm.addLoan({ ...LOAN, collateralDepositId: dep.id });
  assert.equal(loan.collateralDepositId, dep.id);
  assert.deepEqual(loan.guarantors, []);
  const ov = await gm.getOverview('2026-01-02');
  assert.equal(ov.deposits[0].pledgedTo, 'שמעון לוי');
  assert.equal(ov.loans[0].collateralDepositId, dep.id);
  await assert.rejects(gm.deleteDeposit(dep.id), /משמשת בטוחה להלוואה הפעילה של שמעון לוי/);
  await assert.rejects(gm.addLoan({ ...LOAN, borrowerName: 'לוי יצחק', collateralDepositId: dep.id }), /כבר משמש בטוחה/);
  // אחרי ביטול ההלוואה — הפיקדון פנוי שוב
  await gm.cancelLoan(loan.id);
  const after = await gm.getOverview('2026-01-02');
  assert.equal(after.deposits[0].pledgedTo, undefined);
  await gm.deleteDeposit(dep.id);
});

test('שירות: אישור בקשה עם פיקדון נבדק באותו אופן', async () => {
  const gm = await fresh();
  const dep = await gm.addDeposit({ date: '2026-01-01', depositorName: 'אהרן כהן', amount: 1000 });
  const app = await gm.saveApplication(null, { ...LOAN, requestDate: '2026-01-01', collateralDepositId: dep.id });
  for (const to of ['interview', 'verified']) await gm.moveApplication(app.id, to);
  await assert.rejects(gm.moveApplication(app.id, 'approved', { issueDate: '2026-01-05' }), /גבוה מהפיקדון/);
  // הסרת הפיקדון אחרי אימות — חזרה לראיון, ובלי ערבים ובלי פיקדון אי אפשר לאמת
  const back = await gm.saveApplication(app.id, { collateralDepositId: '' });
  assert.equal(back.status, 'interview');
  assert.equal('collateralDepositId' in back, false);
  await assert.rejects(gm.moveApplication(app.id, 'verified'), /אין ערבים ואין פיקדון/);
  // פיקדון מספיק — מאושר, וההלוואה נוצרת כנגדו
  const big = await gm.addDeposit({ date: '2026-01-01', depositorName: 'משפחת פרידמן', amount: 5000 });
  await gm.saveApplication(app.id, { collateralDepositId: big.id });
  await gm.moveApplication(app.id, 'verified');
  const { loan } = await gm.moveApplication(app.id, 'approved', { issueDate: '2026-01-05' });
  assert.equal(loan.collateralDepositId, big.id);
});

test('ייצוא: עמודת פיקדון בהלוואות ועמודת בטוחה בהפקדות', () => {
  const deposits = [{ id: 'd1', depositorName: 'אהרן כהן', amount: 6000, date: '2026-01-01', notes: '' }];
  const clean = G.validateLoanInput({ ...LOAN, collateralDepositId: 'd1' });
  const loans = [{ id: 'l1', ...clean, schedule: G.buildSchedule(clean.amount, 5, clean.issueDate), status: 'active' }];
  const l = G.exportTable('loans', loans, deposits, {}, '2026-01-02');
  assert.equal(l.headers.at(-1), 'פיקדון כבטוחה');
  assert.equal(l.rows[0].at(-1), 'אהרן כהן (2026-01-01)');
  const d = G.exportTable('deposits', loans, deposits, {}, '2026-01-02');
  assert.equal(d.rows[0][4], 'שמעון לוי');
});

test('ממשק: בחירת פיקדון בטופס ההלוואה, וסימון 🔒 ברשימות', () => {
  const ui = source();
  assert.match(ui, /name: 'collateralDepositId'/);
  assert.match(ui, /filter\(d => !d\.pledgedTo\)/);
  assert.match(ui, /בטוחה להלוואה של/);
  assert.match(ui, /כנגד פיקדון/);
});
