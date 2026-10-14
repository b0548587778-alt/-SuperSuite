// ייעוץ משכנתאות: לוח סילוקין באגורות, השוואת הצעות, עמלה ומסמכים + ערוצי IPC מול מסד אמיתי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const M = require('../modules/econ/core/mortgageAdvisor');
const { calculateLoan } = require('../modules/econ/utils/calculations');
const BK = require('../modules/econ/core/backupCrypto');

// ---------- לוגיקה ----------

test('לוח סילוקין: תשלום שפיצר תואם לנוסחה, הכל בשלמי אגורות, והיתרה נסגרת לאפס', () => {
  const t = { type: 'fixed-unindexed', amount: 500000, rate: 4.5, years: 25 };
  const rows = M.trackSchedule(t);
  assert.equal(rows.length, 300);
  assert.equal(rows[0].paymentAg / 100, Math.round(calculateLoan({ principal: 500000, annualRate: 0.045, years: 25 }).monthlyPayment * 100) / 100);
  assert.ok(rows.every(r => Number.isInteger(r.paymentAg) && Number.isInteger(r.interestAg) && Number.isInteger(r.balanceAg)));
  assert.equal(rows.at(-1).balanceAg, 0);
  assert.equal(rows.reduce((s, r) => s + r.principalAg, 0), 50000000, 'סכום הקרן שנפרעה = הקרן בדיוק');
});

test('מסלול צמוד: המדד מגדיל את ההחזר ואת סך התשלומים; מדד 0 זהה ללא צמוד', () => {
  const base = { amount: 300000, rate: 3, years: 20 };
  const indexed = M.offerSummary({ tracks: [{ ...base, type: 'fixed-indexed' }], cpi: 2.5 });
  const flat = M.offerSummary({ tracks: [{ ...base, type: 'fixed-unindexed' }], cpi: 2.5 });
  assert.ok(indexed.totalIndexation > 0);
  assert.ok(indexed.maxPayment > indexed.firstPayment, 'ההחזר עולה עם המדד');
  assert.ok(indexed.totalPaid > flat.totalPaid);
  assert.equal(flat.totalIndexation, 0, 'מסלול לא צמוד אינו מושפע מהמדד');
  const zero = M.offerSummary({ tracks: [{ ...base, type: 'fixed-indexed' }], cpi: 0 });
  assert.equal(zero.totalPaid, flat.totalPaid);
  assert.equal(M.offerSchedule({ tracks: [{ ...base, type: 'fixed-indexed' }], cpi: 2.5 }).at(-1).balanceAg, 0);
});

test('ריבית 0 ותמהיל מסלולים בתקופות שונות', () => {
  const s = M.offerSummary({ tracks: [
    { type: 'prime', amount: 120000, rate: 0, years: 10 },
    { type: 'variable-5', amount: 100000, rate: 4, years: 30 }
  ], cpi: 0 });
  assert.equal(s.months, 360, 'הלוח באורך המסלול הארוך');
  assert.equal(s.principal, 220000);
  assert.equal(M.trackSchedule({ type: 'prime', amount: 120000, rate: 0, years: 10 })[0].paymentAg, 100000);
});

test('השוואת הצעות: ממוין לפי עלות כוללת, מסמן את הזולה ואת הפער ממנה', () => {
  const mk = (id, bank, rate) => ({ id, bank, cpi: 0, tracks: [{ type: 'fixed-unindexed', amount: 400000, rate, years: 20 }] });
  const rows = M.compareOffers([mk('a', 'בנק א', 4.9), mk('b', 'בנק ב', 4.2), mk('c', 'בנק ג', 4.5)]);
  assert.deepEqual(rows.map(r => r.bank), ['בנק ב', 'בנק ג', 'בנק א']);
  assert.equal(rows[0].cheapest, true);
  assert.equal(rows[0].diffFromBest, 0);
  assert.ok(rows[2].diffFromBest > rows[1].diffFromBest);
});

test('עמלת ייעוץ: אחוז או סכום קבוע, ומע"מ לפי שיעור העסק — באגורות', () => {
  const pct = M.advisoryFee({ feeType: 'percent', feeValue: 0.5, requestedAmount: 1234567 }, 0.18);
  assert.deepEqual(pct, { net: 6172.84, vat: 1111.11, total: 7283.95, vatRate: 0.18 });
  const fixed = M.advisoryFee({ feeType: 'fixed', feeValue: 4500, requestedAmount: 1 }, 0.17);
  assert.equal(fixed.total, 5265);
  assert.equal(M.ltv({ requestedAmount: 750000, propertyValue: 1000000 }), 75);
});

test('תיק לקוח: ולידציה בעברית; מסמכים מסומנים ומבוטלים', () => {
  assert.throws(() => M.validateClient({ name: '', requestedAmount: 1 }), /שם הלקוח/);
  assert.throws(() => M.validateClient({ name: 'א', requestedAmount: 0 }), /הסכום המבוקש/);
  assert.throws(() => M.validateClient({ name: 'א', requestedAmount: 1, feeType: 'percent', feeValue: 50 }), /עמלת/);
  const c = { docs: [] };
  c.docs = M.toggleDoc(c, 'payslips');
  c.docs = M.toggleDoc(c, 'id');
  assert.deepEqual(c.docs, ['id', 'payslips'], 'סדר קבוע לפי הרשימה');
  c.docs = M.toggleDoc(c, 'id');
  assert.equal(M.docsProgress(c).done, 1);
  assert.throws(() => M.toggleDoc(c, 'unknown'), /לא מוכר/);
  assert.throws(() => M.validateTrack({ type: 'prime', amount: 1, rate: 1, years: 50 }), /1–35/);
});

// ---------- IPC מול מסד אמיתי ----------

const handlers = {};
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_madv__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_madv__.js'] = {
  id: '/__electron_stub_madv__.js', filename: '/__electron_stub_madv__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-madv-')));
  await handlers['auth:setup'](ev(id), 'advisor_1', 'advisor-strong-pass-1');
  await handlers['auth:login'](ev(id), 'advisor_1', 'advisor-strong-pass-1');
}

test('IPC ייעוץ: תיק, הצעות מכמה בנקים, השוואה, ומחיקת תיק מוחקת את הצעותיו', async () => {
  await freshLogin(51);
  await assert.rejects(handlers['madv:getOverview'](ev(98)), /נדרשת כניסה/);
  const c = await handlers['madv:createClient'](ev(51), { name: 'יוסף פרידמן', requestedAmount: 900000, propertyValue: 1500000, feeType: 'percent', feeValue: 0.5 });
  await assert.rejects(handlers['madv:addOffer'](ev(51), { clientId: 'nope', bank: 'א', 'prime_amount': 1, 'prime_rate': 1, 'prime_years': 1 }), /תיק לקוח/);
  await assert.rejects(handlers['madv:addOffer'](ev(51), { clientId: c.id, bank: 'בנק א' }), /לפחות מסלול/);
  await handlers['madv:addOffer'](ev(51), { clientId: c.id, bank: 'בנק א', cpi: 2,
    'fixed-indexed_amount': 300000, 'fixed-indexed_rate': 3.2, 'fixed-indexed_years': 20,
    'prime_amount': 600000, 'prime_rate': 5.5, 'prime_years': 25 });
  await handlers['madv:addOffer'](ev(51), { clientId: c.id, bank: 'בנק ב', cpi: 2,
    'fixed-unindexed_amount': 900000, 'fixed-unindexed_rate': 4.6, 'fixed-unindexed_years': 25 });
  await handlers['madv:updateClient'](ev(51), c.id, { status: 'approved-principle' });
  await handlers['madv:toggleDoc'](ev(51), c.id, 'tabu');

  const o = await handlers['madv:getOverview'](ev(51));
  const client = o.clients[0];
  assert.equal(client.status, 'approved-principle');
  assert.equal(client.ltv, 60);
  assert.equal(client.fee.net, 4500);
  assert.equal(client.docs.done, 1);
  assert.equal(client.comparison.length, 2);
  assert.equal(client.comparison.filter(r => r.cheapest).length, 1);
  assert.ok(client.offers[0].yearly.length > 0, 'לוח שנתי לתצוגה');

  AuthService.getSession(51).permissions = ['data.view'];
  await assert.rejects(handlers['madv:deleteClient'](ev(51), c.id), /אין הרשאה/);
  const calc = await handlers['madv:calcTracks'](ev(51), { 'prime_amount': 100000, 'prime_rate': 6, 'prime_years': 10 });
  assert.ok(calc.summary.firstPayment > 0, 'מחשבון זמין לצפייה בלבד');
  AuthService.getSession(51).permissions = ['data.view', 'data.edit', 'data.delete', 'data.backup'];

  const enc = await handlers['data:backupEncrypted'](ev(51), 'backup-pass-456');
  assert.equal(JSON.parse(BK.decryptBackup(enc, 'backup-pass-456')).mortgageAdvisor.offers.length, 2, 'ההצעות בגיבוי המוצפן');

  await handlers['madv:deleteClient'](ev(51), c.id);
  const after = await handlers['madv:getOverview'](ev(51));
  assert.equal(after.clients.length, 0);
  const raw = await ipc.getDb().load();
  assert.equal(raw.mortgageAdvisor.offers.length, 0, 'לא נשארות הצעות יתומות');
});
