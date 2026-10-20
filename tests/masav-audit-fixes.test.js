// ממצאי מס"ב בבדיקת הקבצים הרשמיים (docs/audit-parts/audit-official-files.md, סעיפים 2, 3, 4, 8, 10):
// קובץ החזרות שנכשל כולו בגלל חודש שסומן ידנית, קבלה בסכום הנוכחי של ההוראה במקום הסכום שחויב, אצווה תקועה
// אחרי סיום/מחיקה/ביטול, החזרה סופית אחרי סגירה שלא עוצרת, ואותיות לטיניות קטנות שהבנק קורא כעברית.
// כל הנתונים בדויים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../modules/econ/core/masav');

const SETTINGS = { institution: '12345678', sender: '54321', name: 'עמותת חסד', hebrew: 'oldcode' };

function returnsFile(rows, { institution = '12345678' } = {}) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  const R = pad('R' + institution + '00' + '261112' + pad('עמותה', 10), 220);
  const lines = rows.map(r => pad('1' + institution + '00' + '      ' + String(r.reason).padStart(3, '0') + pad('סיבה', 10) + pad(String(r.ref), 20) +
    '12' + '345' + '0000' + '000678901' + pad('', 16) + String(r.amountAg).padStart(15, '0') + '261112' + '261112' +
    '10' + '800' + '0000' + '000123456' + '0000500' + (r.chargeDate || '261110') + '261112' + '01' + '657' + '00000000', 220));
  const sum = rows.reduce((t, r) => t + r.amountAg, 0);
  const six = pad('6' + institution + '00' + '261112' + String(sum).padStart(15, '0') + String(rows.length).padStart(8, '0'), 220);
  return [R, ...lines, six].join('\r\n') + '\r\n';
}

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-msv-fix-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const db = await initializeDatabase(dir);
  const { NpoService } = require('../modules/econ/services/npoService');
  const { GemachService } = require('../modules/econ/services/gemachService');
  await NpoService.initialize(db);
  await GemachService.initialize(db);
  return { npo: NpoService, gm: GemachService, db };
}

// עמותה עם שתי הוראות בנקאיות (אברהם 100 ₪ — אסמכתה 1, יצחק 50 ₪ — אסמכתה 2) ואצוות נובמבר שנשלחה
async function npoWithBatch() {
  const env = await fresh();
  const { npo, db } = env;
  await npo.saveSettings({ orgName: 'עמותת חסד לדוגמה', vatStatus: 'exempt' });
  await npo.saveMasavSettings(SETTINGS);
  const a = await npo.saveStandingOrder(null, { donorName: 'אברהם לוי', amount: 100, dayOfMonth: 10, startMonth: '2026-10', method: 'standing' });
  const b = await npo.saveStandingOrder(null, { donorName: 'יצחק כהן', amount: 50, dayOfMonth: 10, startMonth: '2026-10', method: 'standing' });
  await npo.setStandingBank(a.id, { bank: '12', branch: '345', account: '678901' });
  await npo.setStandingBank(b.id, { bank: '10', branch: '800', account: '55555' });
  await npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-10' }, { today: '2026-10-18' });
  const batchId = (await db.load()).npo.masav.batches[0].id;
  return { ...env, a, b, batchId };
}

test('ממצא 2: חודש שסומן ידנית "התקבל" לא מפיל את קובץ ההחזרות — שאר ההחזרות נקלטות, ואין קבלה על חיוב שהוחזר', async () => {
  const { npo, db, a, b, batchId } = await npoWithBatch();
  await npo.recordStandingPayment(a.id, '2026-11', 'received', '2026-11-10');
  const r = await npo.importMasavReturns(returnsFile([{ reason: 1, ref: '1', amountAg: 10000 }, { reason: 2, ref: '2', amountAg: 5000 }]));
  assert.equal(r.returned, 2);
  assert.equal(r.manual.length, 1);
  assert.match(r.manual[0].why, /לבטל את הקבלה ידנית/);
  let data = await db.load();
  const ob = data.npo.standingOrders.find(o => o.id === b.id);
  assert.deepEqual(ob.history.map(h => h.status), ['failed'], 'ההחזרה של יצחק נקלטה');
  assert.equal(ob.masavStopped, 'ביטול הרשאה', 'ביטול הרשאה עוצר את החיובים הבאים');
  const oa = data.npo.standingOrders.find(o => o.id === a.id);
  assert.deepEqual(oa.history.map(h => h.status), ['received'], 'לא נרשם "נכשל" מעל הסימון הידני');

  const closed = await npo.closeMasavBatch(batchId);
  assert.equal(closed.paid, 0);
  data = await db.load();
  assert.deepEqual(data.npo.donations.map(d => d.donorName), ['אברהם לוי'], 'אין קבלה ליצחק על חיוב שהוחזר');
  assert.equal(closed.batch.manual.length, 1, 'החיוב שדורש ביטול ידני מוצג באצווה');
});

test('ממצא 3: סגירת אצווה מפיקה קבלה בסכום שחויב בקובץ, גם אם סכום ההוראה שונה אחר כך', async () => {
  const { npo, db, a, batchId } = await npoWithBatch();
  await npo.saveStandingOrder(a.id, { amount: 150 });
  await npo.closeMasavBatch(batchId);
  const data = await db.load();
  const d = data.npo.donations.find(x => x.donorName === 'אברהם לוי');
  assert.equal(d.amount, 100, 'הקבלה על 100 ₪ שנגבו — לא על 150');
  assert.equal(d.date, '2026-11-10');
  assert.equal(data.npo.standingOrders.find(o => o.id === a.id).amount, 150, 'ההוראה עצמה עודכנה לחודש הבא');
});

test('ממצא 4: הוראה שהסתיימה אחרי שליחת הקובץ לא חוסמת את סגירת האצווה; מחיקה של הוראה באצווה פתוחה נחסמת', async () => {
  const { npo, db, a, b, batchId } = await npoWithBatch();
  await npo.saveStandingOrder(b.id, { endMonth: '2026-10' });
  await assert.rejects(npo.deleteStandingOrder(a.id), /אצוות מס"ב פתוחה/);
  const closed = await npo.closeMasavBatch(batchId);
  assert.equal(closed.paid, 2, 'שני התורמים מקבלים קבלה — הכסף נגבה');
  const data = await db.load();
  assert.deepEqual(data.npo.donations.map(d => [d.donorName, d.amount]).sort(), [['אברהם לוי', 100], ['יצחק כהן', 50]]);
  // אחרי הסגירה — המחיקה עדיין חסומה (יש קבלות), כמו קודם
  await assert.rejects(npo.deleteStandingOrder(a.id), /כבר הופקו קבלות/);
});

test('ממצא 4: הוראה שנמחקה (נתונים ישנים) — הסגירה ממשיכה לשאר התורמים ומסמנת לטיפול ידני', async () => {
  const { npo, db, a, b, batchId } = await npoWithBatch();
  const data = await db.load();
  data.npo.standingOrders = data.npo.standingOrders.filter(o => o.id !== b.id);
  await db.save(data);
  const closed = await npo.closeMasavBatch(batchId);
  assert.equal(closed.paid, 1);
  assert.equal(closed.manual.length, 1);
  assert.match(closed.manual[0].why, /נמחקה/);
  assert.equal(closed.batch.status, 'closed');
  assert.deepEqual((await db.load()).npo.donations.map(d => d.donorName), ['אברהם לוי']);
  assert.ok(a.id);
});

test('ממצא 4 (גמ"ח): ביטול הלוואה שנמצאת באצווה פתוחה נחסם; הלוואה שבוטלה בנתונים ישנים לא תוקעת את האצווה', async () => {
  const { gm, db } = await fresh();
  const l1 = await gm.addLoan({ borrowerName: 'דוד ברגר', amount: 600, installments: 6, issueDate: '2026-10-05' });
  const l2 = await gm.addLoan({ borrowerName: 'שמואל פרידמן', amount: 1200, installments: 12, issueDate: '2026-10-05' });
  await gm.saveMasavSettings(SETTINGS);
  await gm.setLoanBank(l1.id, { bank: '11', branch: '100', account: '424242' });
  await gm.setLoanBank(l2.id, { bank: '12', branch: '345', account: '678901' });
  const month = l1.schedule[0].dueDate.slice(0, 7);
  await gm.createMasavBatch({ month, chargeDate: `${month}-20` }, { today: '2026-10-18' });
  await assert.rejects(gm.cancelLoan(l1.id), /אצוות מס"ב פתוחה/);

  const data = await db.load();
  data.gemach.loans.find(l => l.id === l1.id).status = 'cancelled';
  await db.save(data);
  const batchId = data.gemach.masav.batches[0].id;
  const closed = await gm.closeMasavBatch(batchId);
  assert.equal(closed.manual.length, 1);
  assert.match(closed.manual[0].label, /דוד ברגר/);
  const after = await db.load();
  assert.equal(after.gemach.loans.find(l => l.id === l2.id).schedule[0].paidAg, 10000, 'הלווה השני נרשם כרגיל');
});

test('ממצא 8: החזרה סופית שמגיעה אחרי סגירת האצווה עוצרת חיובים נוספים, ולא מדווחת שוב בקליטה חוזרת', async () => {
  const { npo, db, b, batchId } = await npoWithBatch();
  await npo.closeMasavBatch(batchId);
  const file = returnsFile([{ reason: 2, ref: '2', amountAg: 5000 }]);
  const r1 = await npo.importMasavReturns(file);
  assert.equal(r1.unmatched.length, 1);
  assert.match(r1.unmatched[0].why, /לבטל את התשלום ידנית/);
  assert.equal((await db.load()).npo.standingOrders.find(o => o.id === b.id).masavStopped, 'ביטול הרשאה');
  const dec = await npo.createMasavBatch({ month: '2026-12', chargeDate: '2026-12-10' }, { today: '2026-10-18', preview: true });
  assert.equal(dec.count, 1, 'בדצמבר רק אברהם — יצחק נעצר');
  const r2 = await npo.importMasavReturns(file);
  assert.deepEqual([r2.unmatched.length, r2.skipped], [0, 1], 'אותו קובץ שוב — כבר נקלט');
  const view = (await npo.getStandingOrders('2026-10-18')).masav.batches.find(x => x.id === batchId);
  assert.equal(view.manual.length, 1, 'באצווה הסגורה מסומן חיוב שהוחזר אחרי האישור');
});

test('ממצא 8 (גמ"ח): החזרה סופית אחרי סגירה עוצרת את ההלוואה', async () => {
  const { gm, db } = await fresh();
  const l = await gm.addLoan({ borrowerName: 'אהרן וייס', amount: 600, installments: 6, issueDate: '2026-10-05' });
  await gm.saveMasavSettings(SETTINGS);
  await gm.setLoanBank(l.id, { bank: '11', branch: '100', account: '424242' });
  const month = l.schedule[0].dueDate.slice(0, 7);
  await gm.createMasavBatch({ month, chargeDate: `${month}-20` }, { today: '2026-10-18' });
  await gm.closeMasavBatch((await db.load()).gemach.masav.batches[0].id);
  const cd = `${month.slice(2, 4)}${month.slice(5, 7)}20`;
  await gm.importMasavReturns(returnsFile([{ reason: 2, ref: '1', amountAg: 10000, chargeDate: cd }]));
  assert.equal((await db.load()).gemach.loans.find(x => x.id === l.id).masavStopped, 'ביטול הרשאה');
});

test('ממצא 10: בקוד הישן אותיות לטיניות נכתבות גדולות — אין בית בטווח העברי (0x60–0x7A) שלא בא מאות עברית', () => {
  const s = M.textField('Levi Moshe', 16, 'oldcode');
  assert.equal(s, 'LEVI MOSHE      ');
  assert.ok([...s].every(c => c.charCodeAt(0) < 0x60), 'אף תו לא ייקרא בבנק כאות עברית');
  // עברית + לטינית: העברית בקוד ישן, הלטינית גדולה ובסדרה
  // כ=0x6B ה=0x64 ן=0x6F (ך לפני כ); סדר חזותי: הרצף הלטיני בסדרו משמאל, אחריו העברית הפוכה
  const mixed = M.textField('כהן abc', 10, 'oldcode');
  assert.equal(mixed, '   ABC ' + String.fromCharCode(0x6F, 0x64, 0x6B));
  // CP862 — ללא שינוי
  assert.equal(M.textField('Levi', 6, 'cp862'), 'Levi  ');
  // קובץ חיובים שלם: השם הלטיני לא מכיל אותיות קטנות
  const f = M.buildDebitFile({ settings: SETTINGS, chargeDate: '2026-11-10', createdDate: '2026-10-18',
    items: [{ bank: '12', branch: '345', account: '678901', idNumber: '', name: 'Levi', amountAg: 100, reference: '7', period: '' }] });
  const row = f.text.split('\r\n')[1];
  assert.equal(row.slice(45, 61), 'LEVI            ');
});
