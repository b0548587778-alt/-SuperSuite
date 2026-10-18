// מס"ב (PLAN.md 9.17): קובץ חיובים לפי המפרט הרשמי (128 תווים, K / 1 / 5 / תשיעיות), קליטת קובץ החזרות (220 תווים),
// אצוות בלי חיוב כפול, קליטה כפולה בלי רישום כפול, סגירה עם קבלות (עמותה) ותשלומים (גמ"ח), ומסיכת פרטי החשבון.
// כל הנתונים בדויים: מספרי חשבון, קודי מוסד ות"ז לדוגמה בלבד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const M = require('../modules/econ/core/masav');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_msv__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_msv__.js'] = { id: '/__electron_stub_msv__.js', filename: '/__electron_stub_msv__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };

const SETTINGS = { institution: '12345678', sender: '54321', name: 'גמח אור', hebrew: 'oldcode' };
const at = (line, pos, len) => line.slice(pos - 1, pos - 1 + len);

test('קובץ חיובים: אורך 128 + CRLF, כותרת, תנועה וסה"כ במיקומים של המפרט, ושורת תשיעיות', () => {
  const r = M.buildDebitFile({
    settings: SETTINGS, chargeDate: '2026-11-10', createdDate: '2026-10-18',
    items: [
      { bank: '12', branch: '345', account: '678901', idNumber: '000000018', name: 'משה כהן', amountAg: 15050, reference: '7', period: '2026-11' },
      { bank: '10', branch: '1', account: '5', idNumber: '', name: 'Levi 2', amountAg: 100, reference: '12', period: '' }
    ]
  });
  assert.ok(r.text.endsWith('\r\n'));
  const lines = r.text.slice(0, -2).split('\r\n');
  assert.equal(lines.length, 5);
  for (const l of lines) assert.equal(l.length, 128);
  const [k, t1, t2, total, nines] = lines;
  // כותרת
  assert.equal(at(k, 1, 1), 'K');
  assert.equal(at(k, 2, 8), '12345678');
  assert.equal(at(k, 10, 2), '00');
  assert.equal(at(k, 12, 6), '261110');
  assert.equal(at(k, 18, 5), '00010', 'FILLER 0, סידורי 001, FILLER 0');
  assert.equal(at(k, 23, 6), '261018');
  assert.equal(at(k, 29, 5), '54321');
  assert.equal(at(k, 34, 6), '000000');
  assert.equal(at(k, 70, 56), ' '.repeat(56));
  assert.equal(at(k, 126, 3), 'KOT');
  // תנועות ממוינות לפי בנק: 10 לפני 12
  assert.equal(at(t1, 18, 2), '10');
  assert.equal(at(t2, 1, 1), '1');
  assert.equal(at(t2, 2, 8), '12345678');
  assert.equal(at(t2, 12, 6), '000000');
  assert.equal(at(t2, 18, 2), '12');
  assert.equal(at(t2, 20, 3), '345');
  assert.equal(at(t2, 23, 4), '0000');
  assert.equal(at(t2, 27, 9), '000678901');
  assert.equal(at(t2, 36, 1), '0');
  assert.equal(at(t2, 37, 9), '000000018');
  assert.equal(at(t2, 62, 13), '0000000015050');
  assert.equal(at(t2, 75, 20), '00000000000000000007');
  assert.equal(at(t2, 95, 8), '26112611');
  assert.equal(at(t2, 103, 3), '000');
  assert.equal(at(t2, 106, 3), '504');
  assert.equal(at(t2, 109, 18), '0'.repeat(18));
  assert.equal(at(t2, 127, 2), '  ');
  assert.equal(at(t1, 95, 8), '00000000', 'בלי תקופה — אפסים');
  // סה"כ: סכום במיקום 37, מספר תנועות במיקום 59
  assert.equal(at(total, 1, 1), '5');
  assert.equal(at(total, 12, 6), '261110');
  assert.equal(at(total, 22, 15), '0'.repeat(15));
  assert.equal(at(total, 37, 15), '000000000015150');
  assert.equal(at(total, 52, 7), '0000000');
  assert.equal(at(total, 59, 7), '0000002');
  assert.equal(nines, '9'.repeat(128));
  assert.deepEqual([r.totalAg, r.count], [15150, 2]);
  // כל תו הוא בית אחד
  assert.ok([...r.text].every(c => c.charCodeAt(0) < 256));
});

test('שם בעברית: קוד ישן (א=0x60) או CP862 (א=0x80), בסדר חזותי וצמוד לימין; ספרות נשמרות בסדרן', () => {
  const s = M.textField('אבג 12', 10, 'oldcode');
  assert.equal(s.length, 10);
  assert.equal(s, '    12 ' + String.fromCharCode(0x62, 0x61, 0x60));
  const d = M.textField('ת', 3, 'cp862');
  assert.equal(d, '  ' + String.fromCharCode(0x80 + 26));
  assert.equal(M.textField('Levi', 6), 'Levi  ', 'לטינית — משמאל');
  assert.equal(M.textField('בית־"הלל"', 8).trim().length, 7, 'גרשיים נמחקים, מקף ← רווח');
  // ם (0x6D) ו (0x65) ל (0x6C) ש (0x79) — סדר חזותי, ניקוד מוסר
  assert.equal(M.textField('שָׁלוֹם', 4), String.fromCharCode(0x6D, 0x65, 0x6C, 0x79));
});

test('בדיקות קלט: חשבון, הגדרות, אסמכתה, סכום וקובץ ריק', () => {
  assert.deepEqual(M.validateBankAccount({ bank: '4', branch: '12', account: '123' }), { bank: '04', branch: '012', account: '000000123' });
  assert.throws(() => M.validateBankAccount({ bank: '123', branch: '1', account: '1' }), /קוד הבנק/);
  assert.throws(() => M.validateBankAccount({ bank: '12', branch: '1', account: '1234567890' }), /עד 9/);
  assert.equal(M.maskAccount({ bank: '12', branch: '345', account: '000678901' }), '12-345-•••901');
  assert.throws(() => M.validateSettings({ ...SETTINGS, institution: '' }), /קוד המוסד/);
  assert.throws(() => M.validateSettings({ ...SETTINGS, sender: '123456' }), /שולח/);
  assert.throws(() => M.referenceField('000000'), /אסמכתה/);
  const base = { settings: SETTINGS, chargeDate: '2026-11-10', createdDate: '2026-10-18' };
  assert.throws(() => M.buildDebitFile({ ...base, items: [] }), /אין חיובים/);
  assert.throws(() => M.buildDebitFile({ ...base, items: [{ bank: '12', branch: '1', account: '1', amountAg: 0, reference: '1' }] }), /סכום/);
  assert.throws(() => M.buildDebitFile({ ...base, chargeDate: '2026-02-30', items: [] }), /תאריך החיוב/);
});

// קובץ החזרות לדוגמה לפי המפרט: R, תנועות (220), 6
function returnsFile(rows, { institution = '12345678', total, count } = {}) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  const R = pad('R' + institution + '00' + '261112' + pad('גמח', 10), 220);
  const lines = rows.map(r => {
    let l = '1' + institution + '00' + '      ' + String(r.reason).padStart(3, '0') + pad('סיבה', 10) + pad(String(r.ref), 20) +
      '12' + '345' + '0000' + '000678901' + pad('', 16) + String(r.amountAg).padStart(15, '0') + '261112' + '261112' +
      '10' + '800' + '0000' + '000123456' + '0000500' + (r.chargeDate || '261110') + '261112' + '01' + '657' + '00000000';
    return pad(l, 220);
  });
  const sum = rows.reduce((t, r) => t + r.amountAg, 0);
  const six = pad('6' + institution + '00' + '261112' + String(total ?? sum).padStart(15, '0') + String(count ?? rows.length).padStart(8, '0'), 220);
  return [R, ...lines, six].join('\r\n') + '\r\n';
}

test('קליטת החזרות: שדות במיקום, סיבה מהטבלה, סכומי ביקורת, ושורה עם רווחים שנחתכו', () => {
  const p = M.parseReturnsFile(returnsFile([{ reason: 1, ref: '7', amountAg: 15050 }, { reason: 2, ref: '12', amountAg: 100 }]).replace(/ +\r\n/g, '\r\n'));
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.items.map(i => [i.reference, i.amountAg, i.reasonCode, i.reason, i.fatal]),
    [['7', 15050, 1, 'אין כיסוי מספיק', false], ['12', 100, 2, 'ביטול הרשאה', true]]);
  assert.equal(p.items[0].chargeDate, '2026-11-10');
  assert.equal(p.items[0].returnDate, '2026-11-12');
  const bad = M.parseReturnsFile(returnsFile([{ reason: 1, ref: '7', amountAg: 15050 }], { total: 1 }));
  assert.match(bad.errors[0].message, /סכומי הביקורת/);
  assert.throws(() => M.parseReturnsFile('K123'), /אין רשומת כותרת/);
  assert.throws(() => M.parseReturnsFile(''), /ריק/);
});

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-msv-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const db = await initializeDatabase(dir);
  const { NpoService } = require('../modules/econ/services/npoService');
  const { GemachService } = require('../modules/econ/services/gemachService');
  await NpoService.initialize(db);
  await GemachService.initialize(db);
  return { npo: NpoService, gm: GemachService, db };
}

test('עמותה: קובץ לחודש, אין חיוב כפול, החזרה ← נכשל ועצירה, קליטה כפולה, סגירה ← קבלות בתאריך החיוב', async () => {
  const { npo, db } = await fresh();
  await npo.saveSettings({ orgName: 'עמותת חסד לדוגמה', vatStatus: 'exempt' });
  const a = await npo.saveStandingOrder(null, { donorName: 'אברהם לוי', donorId: '000000018', amount: 100, dayOfMonth: 10, startMonth: '2026-10', method: 'standing' });
  const b = await npo.saveStandingOrder(null, { donorName: 'יצחק כהן', amount: 50.5, dayOfMonth: 10, startMonth: '2026-10', method: 'standing' });
  const c = await npo.saveStandingOrder(null, { donorName: 'יעקב שטרן', amount: 20, dayOfMonth: 10, startMonth: '2026-10', method: 'card' });
  await assert.rejects(npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-10' }, { today: '2026-10-18' }), /פרטי המוסד/);
  await npo.saveMasavSettings(SETTINGS);
  await assert.rejects(npo.setStandingBank(c.id, { bank: '12', branch: '1', account: '1' }), /בנקאית/);
  const ra = await npo.setStandingBank(a.id, { bank: '12', branch: '345', account: '678901' });
  const rb = await npo.setStandingBank(b.id, { bank: '10', branch: '800', account: '55555' });
  assert.deepEqual([ra.masavRef, rb.masavRef, ra.bankMasked], ['1', '2', '12-345-•••901']);

  // תצוגה: מסיכה בלבד, בלי פרטי החשבון
  const st = await npo.getStandingOrders('2026-10-18');
  assert.ok(st.rows.every(r => !('bankAccount' in r)));
  assert.equal(st.rows.find(r => r.id === a.id).bankMasked, '12-345-•••901');
  assert.equal(st.masav.configured, true);

  await assert.rejects(npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-10-01' }, { today: '2026-10-18' }), /עבר/);
  const pv = await npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-10' }, { today: '2026-10-18', preview: true });
  assert.deepEqual([pv.count, pv.totalAg], [2, 15050]);
  assert.equal((await db.load()).npo.masav.batches.length, 0, 'תצוגה מקדימה לא שומרת');
  const file = await npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-10' }, { today: '2026-10-18' });
  assert.equal(file.count, 2);
  assert.match(file.text, /^K12345678/);
  await assert.rejects(npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-12' }, { today: '2026-10-18' }), /אין חיובים/);

  // החזרה של יצחק (ביטול הרשאה — סופית); קליטה שנייה של אותו קובץ לא משנה דבר
  const ret = returnsFile([{ reason: 2, ref: '2', amountAg: 5050 }, { reason: 1, ref: '99', amountAg: 1 }]);
  const r1 = await npo.importMasavReturns(ret);
  assert.deepEqual([r1.returned, r1.skipped, r1.unmatched.length], [1, 0, 1]);
  const r2 = await npo.importMasavReturns(ret);
  assert.deepEqual([r2.returned, r2.skipped], [0, 1]);
  let data = await db.load();
  const ob = data.npo.standingOrders.find(o => o.id === b.id);
  assert.equal(ob.history.length, 1);
  assert.deepEqual([ob.history[0].status, ob.history[0].reason], ['failed', 'ביטול הרשאה']);
  assert.equal(ob.masavStopped, 'ביטול הרשאה');

  // אצווה שקיבלה החזרות לא מבוטלת; סגירה ← קבלה לאברהם בלבד, בתאריך החיוב
  const batchId = data.npo.masav.batches[0].id;
  await assert.rejects(npo.cancelMasavBatch(batchId), /רק אצווה פתוחה/);
  const closed = await npo.closeMasavBatch(batchId);
  assert.equal(closed.paid, 1);
  assert.equal(closed.batch.status, 'closed');
  await assert.rejects(npo.closeMasavBatch(batchId), /כבר סגורה/);
  data = await db.load();
  const donations = data.npo.donations.filter(d => d.standingOrderId);
  assert.deepEqual(donations.map(d => [d.donorName, d.date, d.amount]), [['אברהם לוי', '2026-11-10', 100]]);
  assert.ok(donations[0].receipt.number);
  // ההוראה של יצחק נעצרה — לא נכללת בחודש הבא עד עדכון החשבון
  const dec = await npo.createMasavBatch({ month: '2026-12', chargeDate: '2026-12-10' }, { today: '2026-10-18', preview: true });
  assert.equal(dec.count, 1);
  await npo.setStandingBank(b.id, { bank: '10', branch: '800', account: '66666' });
  assert.equal((await npo.createMasavBatch({ month: '2026-12', chargeDate: '2026-12-10' }, { today: '2026-10-18', preview: true })).count, 2);
  assert.equal((await db.load()).npo.standingOrders.find(o => o.id === b.id).masavRef, '2', 'האסמכתה קבועה להרשאה');
});

test('עמותה: ביטול אצווה מחזיר את החיובים; חודש שסומן ידנית לא מקבל קבלה שנייה בסגירה', async () => {
  const { npo, db } = await fresh();
  await npo.saveSettings({ orgName: 'עמותת חסד לדוגמה', vatStatus: 'exempt' });
  await npo.saveMasavSettings(SETTINGS);
  const a = await npo.saveStandingOrder(null, { donorName: 'אברהם לוי', amount: 100, dayOfMonth: 10, startMonth: '2026-10', method: 'standing' });
  await npo.setStandingBank(a.id, { bank: '12', branch: '345', account: '678901' });
  await npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-10' }, { today: '2026-10-18' });
  const first = (await db.load()).npo.masav.batches[0].id;
  await npo.cancelMasavBatch(first);
  await npo.createMasavBatch({ month: '2026-11', chargeDate: '2026-11-11' }, { today: '2026-10-18' });
  const second = (await db.load()).npo.masav.batches[1].id;
  await npo.recordStandingPayment(a.id, '2026-11', 'received', '2026-11-11');
  const r = await npo.closeMasavBatch(second);
  assert.equal(r.paid, 0);
  assert.equal((await db.load()).npo.donations.length, 1);
});

test('גמ"ח: חיוב התשלומים של החודש, החזרה משאירה פתוח, סגירה רושמת תשלום; מסיכה בסקירה', async () => {
  const { gm, db } = await fresh();
  const loan = await gm.addLoan({ borrowerName: 'שמואל פרידמן', borrowerId: '000000018', amount: 1200, installments: 12, issueDate: '2026-10-05' });
  const loan2 = await gm.addLoan({ borrowerName: 'דוד ברגר', amount: 600, installments: 6, issueDate: '2026-10-05' });
  await gm.saveMasavSettings(SETTINGS);
  await gm.setLoanBank(loan.id, { bank: '12', branch: '345', account: '678901' });
  await gm.setLoanBank(loan2.id, { bank: '11', branch: '100', account: '424242' });
  const ov = await gm.getOverview('2026-10-18');
  assert.equal(ov.loans.find(l => l.id === loan.id).bankMasked, '12-345-•••901');
  assert.ok(!('bankAccount' in (await gm.getLoan(loan.id))));
  const month = loan.schedule[0].dueDate.slice(0, 7);
  const f = await gm.createMasavBatch({ month, chargeDate: `${month}-20` }, { today: '2026-10-18' });
  assert.deepEqual([f.count, f.totalAg], [2, 20000]);
  const r = await gm.importMasavReturns(returnsFile([{ reason: 1, ref: '2', amountAg: 10000, chargeDate: `${month.slice(2, 4)}${month.slice(5, 7)}20` }]));
  assert.equal(r.returned, 1);
  const batchId = (await db.load()).gemach.masav.batches[0].id;
  const c = await gm.closeMasavBatch(batchId);
  assert.equal(c.paid, 1);
  const data = await db.load();
  const l1 = data.gemach.loans.find(l => l.id === loan.id);
  const l2 = data.gemach.loans.find(l => l.id === loan2.id);
  assert.deepEqual([l1.schedule[0].paidAg, l1.schedule[0].paidDate], [10000, `${month}-20`]);
  assert.equal(l2.schedule[0].paidAg, 0, 'החיוב שהוחזר נשאר פתוח');
  assert.equal(l2.masavReturns[0].reason, 'אין כיסוי מספיק');
  assert.equal(l2.masavStopped, undefined, 'אין כיסוי — לא עוצר');
  // ביטול הלוואה מוחק את פרטי החשבון
  const l3 = await gm.addLoan({ borrowerName: 'אהרן וייס', amount: 300, installments: 3, issueDate: '2026-10-05' });
  await gm.setLoanBank(l3.id, { bank: '12', branch: '1', account: '1' });
  await gm.cancelLoan(l3.id);
  assert.equal((await db.load()).gemach.loans.find(l => l.id === l3.id).bankAccount, undefined);
});

test('מזעור (תיקון 13) מוחק את פרטי החשבון', () => {
  const P = require('../modules/econ/core/privacy');
  const data = { gemach: { loans: [{ id: 'l1', borrowerName: 'א', status: 'closed', issueDate: '2010-01-01', borrowerPhone: '050', bankAccount: { bank: '12' }, schedule: [] }] } };
  P.applyRetention(data, 'borrowers', ['l1'], '2026-10-18', 7, 'now');
  assert.equal(data.gemach.loans[0].bankAccount, undefined);
});

test('ערוצים, הרשאות, preload ומסכים', () => {
  const { permissionFor } = require('../modules/econ/ipc');
  for (const p of ['npo', 'gemach']) {
    assert.equal(permissionFor(`${p}:createMasavFile`), 'data.edit');
    assert.equal(permissionFor(`${p}:importMasavReturns`), 'data.edit');
    assert.equal(permissionFor(`${p}:closeMasavBatch`), 'data.edit');
    assert.equal(permissionFor(`${p}:cancelMasavBatch`), 'data.delete');
  }
  const ROOT = path.join(__dirname, '..');
  const ipc = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  for (const op of ['saveMasavSettings', 'createMasavFile', 'importMasavReturns', 'closeMasavBatch', 'cancelMasavBatch']) assert.ok(ipc.includes('`${prefix}:' + op + '`'), op);
  assert.match(ipc, /handle\('npo:setStandingBank'/);
  assert.match(ipc, /handle\('gemach:setLoanBank'/);
  assert.match(ipc, /writeFileSync\(r\.filePath, out\.text, 'latin1'\)/);
  // preload: תחום לא מוכר נדחה
  const exposed = {};
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (n, api) => { exposed[n] = api; } }, ipcRenderer: { invoke: (...a) => { calls.push(a); return Promise.resolve(); }, on() {} } }),
    module: { exports: {} }, console
  });
  exposed.systemAPI.createMasavFile('gemach', { month: '2026-11' });
  assert.deepEqual(calls[0], ['gemach:createMasavFile', { month: '2026-11' }]);
  assert.throws(() => exposed.systemAPI.closeMasavBatch('auth', 'x'), /תחום לא מוכר/);
  // בלי רשת
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'modules/econ/core/masav.js'), 'utf8'), /require\('(https?|net|electron)'\)|fetch\(/);

  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const html = vm.runInContext(`renderMasavPanel('gemach', { configured: true, settings: { institution: '12345678', name: '<b>x</b>' },
    batches: [{ id: 'b1', chargeDate: '2026-11-10', month: '2026-11', status: 'open', count: 2, totalAg: 15050, pending: 1, paid: 0,
      returned: [{ label: 'יצחק', amountAg: 5050, reason: 'ביטול הרשאה' }] }] })`, context);
  assert.match(html, /data-masav-file="gemach"/);
  assert.match(html, /data-masav-close="b1" data-domain="gemach"/);
  assert.doesNotMatch(html, /data-masav-cancel="b1"/, 'אצווה עם החזרות לא מבוטלת');
  assert.doesNotMatch(html, /<b>x<\/b>/);
  const empty = vm.runInContext(`renderMasavPanel('npo', { configured: false, batches: [] })`, context);
  assert.doesNotMatch(empty, /data-masav-file/);
  assert.match(empty, /data-masav-settings="npo"/);
});
