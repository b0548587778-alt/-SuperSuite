// תיקונים מבדיקת ייעוץ המשכנתאות והנדל"ן 21.10.2026 (docs/audit-parts/audit-mortgage-realty.md).
// הבדיקות כאן — ממצאים 6–9 (הנמוכים) ומה שאין לו קובץ משלו; 1 ב-mortgage-optimizer-grid, 4 ב-mortgage-lab-actor
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../modules/econ/core/mortgageAdvisor');
const { MortgageAdvisorService } = require('../modules/econ/services/mortgageAdvisorService');

test('ממצא 8: מחשבון המסלולים בודק את הנחת המדד באותו טווח כמו הצעה (−5% עד 20%)', async () => {
  const tracks = [{ type: 'fixed-indexed', amount: 500000, years: 25, rate: 3.5 }];
  for (const cpi of ['500', '-100', 'abc', 21]) {
    await assert.rejects(MortgageAdvisorService.calcTracks({ cpi, tracks }), /הנחת המדד השנתית אינה תקינה/, String(cpi));
  }
  const ok = await MortgageAdvisorService.calcTracks({ cpi: '3', tracks });
  const none = await MortgageAdvisorService.calcTracks({ cpi: '', tracks });
  assert.ok(ok.summary.totalPaid > none.summary.totalPaid, 'מדד 3% מייקר את הצמוד');
  assert.equal(M.validateCpi('2.345'), 2.35);
  assert.equal(M.validateCpi(undefined), 0);
});

// ---------- שמאות מקרקעין (ממצאים 2, 3, 5) ----------
const R = require('../modules/econ/core/realEstateAppraisal');
const { RealEstateServiceClass } = require('../modules/econ/services/realEstateService');

function reService() {
  let data = {};
  const db = { load: async () => JSON.parse(JSON.stringify(data)), save: async (d) => { data = JSON.parse(JSON.stringify(d)); }, peek: () => data };
  const s = new RealEstateServiceClass(db);
  s.today = () => '2026-10-20';
  return { s, db };
}
const RE_COMPS = [
  { date: '2026-05-10', price: '2,100,000', area: '100', address: 'רחוב הרב קוק 5', source: 'מאגר העסקאות', adjustments: [{ factor: 'time', pct: '2' }] },
  { date: '2026-06-01', price: '2,000,000', area: '95', address: 'רחוב חזון איש 12', source: 'מאגר העסקאות' },
  { date: '2026-07-15', price: '2,250,000', area: '105', address: 'רחוב רבי עקיבא 40', source: 'מאגר העסקאות' },
];
const RE_FULL = {
  client: { name: 'אברהם כהן', idNumber: '000000018' }, purpose: 'mortgage', visitDate: '2026-10-15', effectiveDate: '2026-10-15',
  property: { address: 'רחוב הרב קוק 7', city: 'בני ברק', block: '6123', parcel: '45', area: '100' }, comparables: RE_COMPS,
};
const ZEROING = [{ factor: 'location', pct: '-50' }, { factor: 'condition', pct: '-50' }];

test('ממצא 2: התאמות שמאפסות את מחיר העסקה נדחות בשמירה, והתיק לא נשאר תקוע', async () => {
  const { s, db } = reService();
  const c = await s.createCase(RE_FULL);
  const bad = { ...RE_FULL, comparables: [RE_COMPS[0], { ...RE_COMPS[1], adjustments: ZEROING }, RE_COMPS[2]] };
  await assert.rejects(s.updateCase(c.id, bad), /עסקה 2: סך ההתאמות \(-100%\) מאפס את מחיר העסקה/);
  assert.equal(db.peek().realEstate.cases[0].comparables[1].adjustments.length, 0, 'הקלט השגוי לא נשמר');
  assert.ok((await s.getCase(c.id)).result.final.ok, 'התיק נטען');
  // תיק ישן שנשמר כך לפני התיקון — נטען, העסקה מחוץ לחישוב עם אזהרה, ואי אפשר לנעול עד שמתקנים
  db.peek().realEstate.cases[0].comparables[1].adjustments = [{ factor: 'location', bp: -5000, note: '' }, { factor: 'condition', bp: -5000, note: '' }];
  const old = await s.getCase(c.id);
  assert.equal(old.result.sales.stats.count, 2);
  assert.ok(old.result.sales.warnings.some(w => /עסקה 2: סך ההתאמות מאפס.*לא נכללה/.test(w)));
  assert.ok(old.problems.some(p => /עסקה 2: סך ההתאמות מאפס/.test(p)));
  await assert.rejects(s.finalizeCase(c.id), /עסקה 2/);
  assert.match((await s.getReportHtml(c.id)).html, /שומה|דוח/, 'גם הדוח נבנה');
});

test('ממצא 3: דוח נעול שומר את פרטי השמאי מיום הנעילה; פרטי השמאי — מנהל בלבד', async () => {
  const { s } = reService();
  await s.saveSettings({ name: 'ישראל לוי', license: '1234', office: 'משרד לוי שמאות', declaration: 'הצהרה מקורית' });
  const c = await s.createCase(RE_FULL);
  await s.finalizeCase(c.id);
  await s.saveSettings({ name: 'שמאי אחר', license: '9999', office: 'משרד אחר', declaration: 'הצהרה חדשה' });
  const { html } = await s.getReportHtml(c.id);
  assert.match(html, /ישראל לוי/);
  assert.match(html, /1234/);
  assert.match(html, /הצהרה מקורית/);
  assert.doesNotMatch(html, /שמאי אחר|9999|הצהרה חדשה/, 'הדוח שנמסר לא משתנה');
  // גרסה מתוקנת — טיוטה עם הפרטים הנוכחיים; נעילה שלה מקפיאה אותם
  await s.reopenCase(c.id);
  assert.match((await s.getReportHtml(c.id)).html, /שמאי אחר/);
  assert.equal(econIpc().permissionFor('realestate:saveSettings'), 'users.manage');
});

// ipc.js דורש electron — Electron מדומה מינימלי (רק לבדיקת permissionFor ו-handlers)
const ipcHandlers = {};
function econIpc() {
  const Module = require('module');
  const id = '/__electron_stub_mr_audit__.js';
  if (!require.cache[id]) {
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? id : orig.call(this, req, ...rest); };
    require.cache[id] = { id, filename: id, loaded: true, exports: { ipcMain: { handle: (ch, fn) => { ipcHandlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } } };
  }
  return require('../modules/econ/ipc');
}

test('ממצא 5: גרסה מתוקנת שומרת את הגרסה שנמסרה במלואה, ואפשר להפיק את הדוח שלה', async () => {
  const { s, db } = reService();
  await s.saveSettings({ name: 'ישראל לוי', license: '1234' });
  const c = await s.createCase(RE_FULL);
  await s.finalizeCase(c.id);
  const delivered = (await s.getReportHtml(c.id)).html;
  await s.reopenCase(c.id);
  await s.updateCase(c.id, { ...RE_FULL, property: { ...RE_FULL.property, address: 'רחוב אחר 1', area: '120' } });
  const h = db.peek().realEstate.cases[0].history[0];
  assert.equal(h.snapshot.property.address, 'רחוב הרב קוק 7', 'כל הערכים של הגרסה שנמסרה');
  assert.equal(h.snapshot.frozen.final.valueAg, h.valueAg);
  const view = await s.getCase(c.id);
  assert.equal(view.case.history[0].hasReport, true);
  assert.equal(view.case.history[0].snapshot, undefined, 'לממשק — בלי העותק המלא');
  const rev = await s.getRevisionReportHtml(c.id, 0);
  assert.equal(rev.name, `שומה-${c.no}`);
  assert.equal(rev.html, delivered, 'אותו דוח בדיוק (בלי צילומים בשניהם)');
  assert.doesNotMatch(rev.html, /רחוב אחר 1/);
  // גרסה ישנה בלי עותק — הודעה ברורה
  delete db.peek().realEstate.cases[0].history[0].snapshot;
  await assert.rejects(s.getRevisionReportHtml(c.id, 0), /לפני שנשמרו גרסאות מלאות/);
  // תקרה: רק MAX_FULL_REVISIONS האחרונות במלואן
  let cs = R.finalizeCase(R.validateCase(RE_FULL, '2026-10-20'), '2026-10-20', {});
  cs = { ...cs, no: 1, rev: 0, history: [] };
  for (let i = 0; i < R.MAX_FULL_REVISIONS + 3; i++) cs = R.finalizeCase(R.reopenCase(cs), '2026-10-20', {});
  assert.equal(cs.history.length, R.MAX_FULL_REVISIONS + 3);
  assert.equal(cs.history.filter(x => x.snapshot).length, R.MAX_FULL_REVISIONS);
  assert.ok(cs.history.slice(-R.MAX_FULL_REVISIONS).every(x => x.snapshot), 'האחרונות נשמרות');
});

// ---------- תיווך ונדל"ן (ממצאים 6–9) ----------
const B = require('../modules/econ/core/brokerage');
const RL = require('../modules/econ/core/realty');

test('ממצא 6: תשלום עמלה מעל היתרה של הצד נדחה; תשלום ביתר שנוצר אחר כך מוצג', () => {
  const deal = { priceAg: 200000000, commissions: { buyer: { type: 'percent', bp: 200 } }, commissionPayments: [] };
  const balances = () => Object.fromEntries(B.commissionStatus(deal, 0.18).sides.map(s => [s.side, s.balanceAg]));
  assert.throws(() => B.validatePayment({ side: 'buyer', date: '2026-10-20', amount: 47200.01 }, ['buyer'], balances()), /גבוה מהיתרה לגבייה מצד הקונה \/ שוכר \(47200 ₪\)/);
  deal.commissionPayments.push(B.validatePayment({ side: 'buyer', date: '2026-10-20', amount: 40000 }, ['buyer'], balances()));
  assert.throws(() => B.validatePayment({ side: 'buyer', date: '2026-10-21', amount: 7300 }, ['buyer'], balances()), /7200 ₪/);
  deal.commissionPayments.push(B.validatePayment({ side: 'buyer', date: '2026-10-21', amount: 7200 }, ['buyer'], balances()));
  assert.equal(B.commissionStatus(deal, 0.18).sides[0].state, 'paid');
  // המחיר ירד אחרי התשלום — שולם ביתר, לא "יתרה 0" בשקט
  deal.priceAg = 150000000;
  const s = B.commissionStatus(deal, 0.18).sides[0];
  assert.equal(s.state, 'overpaid');
  assert.equal(s.overpaid, 47200 - 35400);
  assert.equal(B.PAY_STATES.overpaid, 'שולם ביתר');
});

test('ממצא 7: תאריך שאינו קיים נדחה; הוספת חודשים נעצרת בסוף החודש', () => {
  assert.throws(() => B.validatePayment({ side: 'buyer', date: '2026-02-30', amount: 1 }, ['buyer']), /תאריך/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-04-31' }, {}, { clients: [{ id: 'c1' }] }), /תאריך ההזמנה/);
  const dealCtx = { properties: [{ id: 'p', askingAg: 100 }], clients: [{ id: 'k' }] };
  assert.throws(() => RL.validateDeal({ propertyId: 'p', buyerClientId: 'k', signDate: '2026-02-29' }, {}, dealCtx), /תאריך החתימה אינו תקין/);
  assert.equal(RL.validateDeal({ propertyId: 'p', buyerClientId: 'k', signDate: '2028-02-29' }, {}, dealCtx).signDate, '2028-02-29', 'שנה מעוברת');
  assert.equal(B.addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(B.addMonths('2027-08-31', 6), '2028-02-29', 'שנה מעוברת');
  assert.equal(B.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(B.addMonths('2026-10-15', 6), '2027-04-15');
  assert.equal(B.addMonths('2026-12-31', -1), '2026-11-30');
  // בלעדיות של בדיוק 6 חודשים מ-31.8 (עד 28.2) — בלי אזהרה; עד 1.3 — אזהרה
  const base = { clientId: 'c1', date: '2026-08-31', exclusive: true, marketing: 'שלטים' };
  const ok = B.orderCheck({ ...base, exclusiveUntil: '2027-02-28' }, { client: { name: 'א' }, settings: {} });
  assert.deepEqual(ok.warnings, []);
  const long = B.orderCheck({ ...base, exclusiveUntil: '2027-03-01' }, { client: { name: 'א' }, settings: {} });
  assert.equal(long.warnings.length, 1);
});

test('ממצא 8: מחיר בהזמנת התיווך — תקרה כמו בנכס ובעסקה', () => {
  const ctx = { clients: [{ id: 'c1' }] };
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', price: '1e300' }, {}, ctx), /המחיר בהזמנה אינו תקין/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', price: '-5' }, {}, ctx), /המחיר בהזמנה/);
  assert.throws(() => B.validateOrder({ clientId: 'c1', date: '2026-10-20', price: 'abc' }, {}, ctx), /המחיר בהזמנה/);
  assert.equal(B.validateOrder({ clientId: 'c1', date: '2026-10-20', price: '2500000' }, {}, ctx).priceAg, 250000000);
});

test('ממצא 9: מזהה תיק המשכנתא לא יוצא בעסקה; ניתוק תיק של יועץ אחר נדחה', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ipc = econIpc();
  const h = ipcHandlers;
  const ev = (id) => ({ sender: { id } });
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mr-audit-')), { relayUrl: '' });
  await h['auth:setup'](ev(91), 'menahel', 'menahel-strong-pass-1');
  await h['auth:login'](ev(91), 'menahel', 'menahel-strong-pass-1');
  await h['users:create'](ev(91), { username: 'yoetz_a', password: 'yoetz-a-strong-pass', role: 'editor' });
  await h['users:create'](ev(91), { username: 'yoetz_b', password: 'yoetz-b-strong-pass', role: 'editor' });
  await h['auth:login'](ev(92), 'yoetz_a', 'yoetz-a-strong-pass');
  await h['auth:login'](ev(93), 'yoetz_b', 'yoetz-b-strong-pass');

  const seller = await h['rlty:createClient'](ev(92), { name: 'משפחת לוי', role: 'seller' });
  const buyer = await h['rlty:createClient'](ev(92), { name: 'משפחת כהן', role: 'buyer' });
  const p = await h['rlty:createProperty'](ev(92), { city: 'בני ברק', rooms: 4, asking: 2400000, ownerClientId: seller.id });
  const d = await h['rlty:createDeal'](ev(92), { propertyId: p.id, buyerClientId: buyer.id, stage: 'negotiation' });
  const c = await h['rlty:openMortgageCase'](ev(93), d.id, { requestedAmount: 1200000 }); // התיק של יועץ ב

  const ovA = await h['rlty:getOverview'](ev(92));
  assert.equal(ovA.deals[0].mortgageCaseId, undefined, 'בלי מזהה התיק בעסקה');
  assert.equal(ovA.deals[0].mortgage.label, 'תיק של יועץ אחר');
  assert.equal(JSON.stringify(ovA).includes(c.id), false, 'המזהה לא מופיע בשום מקום בתשובה');
  await assert.rejects(h['rlty:unlinkMortgageCase'](ev(92), d.id), /שייך ליועץ אחר/);
  assert.equal((await h['madv:getOverview'](ev(93))).clients[0].realtyDeal.dealId, d.id, 'הקישור נשאר');
  const ovB = await h['rlty:getOverview'](ev(93));
  assert.equal(ovB.deals[0].mortgage.caseId, c.id, 'היועץ של התיק — רואה אותו');
  await h['rlty:unlinkMortgageCase'](ev(91), d.id);
  assert.equal((await h['madv:getOverview'](ev(93))).clients[0].realtyDeal, null, 'מנהל מנתק');
});
