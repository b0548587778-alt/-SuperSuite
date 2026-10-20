// ייעוץ משכנתאות נשמר בשלמי אגורות: המרה של רשומות ישנות בשקלים, תצוגה בשקלים, ייבוא/ייצוא ומעבדת התמהיל.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../modules/econ/core/mortgageAdvisor');
const P = require('../modules/econ/core/dataPorts');
const { MortgageAdvisorService } = require('../modules/econ/services/mortgageAdvisorService');

const memDb = (data) => ({ data, load: async () => JSON.parse(JSON.stringify(data)), save: async (d) => { data.mortgageAdvisor = JSON.parse(JSON.stringify(d.mortgageAdvisor)); } });

// רשומה כמו שנשמרה לפני ההמרה — בשקלים עם נקודה
const OLD_CLIENT = { id: 'c1', name: 'משה כהן', requestedAmount: 1234567.89, propertyValue: 2000000, feeType: 'percent', feeValue: 0.5, status: 'submitted', docs: ['id'], createdAt: '2026-01-01T00:00:00.000Z' };
const OLD_OFFER = { id: 'o1', clientId: 'c1', bank: 'בנק א', cpi: 0, date: '2026-01-02', tracks: [{ type: 'fixed-unindexed', amount: 400000.5, rate: 4.5, years: 20 }] };

test('ולידציה מחזירה צורה שמורה באגורות, בלי שדות בשקלים', () => {
  const c = M.validateClient({ name: 'אברהם לוי', requestedAmount: '900000.10', propertyValue: 1500000, feeType: 'fixed', feeValue: 4500.5 });
  assert.equal(c.requestedAmountAg, 90000010);
  assert.equal(c.propertyValueAg, 150000000);
  assert.equal(c.feeFixedAg, 450050);
  for (const k of ['requestedAmount', 'propertyValue', 'feeValue', 'feePercent']) assert.equal(k in c, false, k);
  const t = M.validateTrack({ type: 'prime', amount: 100000.01, rate: 5, years: 10 });
  assert.equal(t.amountAg, 10000001);
  assert.equal('amount' in t, false);
});

test('רשומה ישנה בשקלים מומרת לאגורות, והתצוגה מחזירה את אותם ערכים', () => {
  const s = M.clientStored(OLD_CLIENT);
  assert.equal(s.requestedAmountAg, 123456789);
  assert.equal(s.feePercent, 0.5);
  assert.equal('requestedAmount' in s, false);
  assert.deepEqual(M.clientStored(s), s, 'המרה חוזרת לא משנה');
  const v = M.clientView(s);
  assert.equal(v.requestedAmount, 1234567.89);
  assert.equal(v.feeValue, 0.5);
  assert.equal('requestedAmountAg' in v, false);
  assert.deepEqual(M.advisoryFee(OLD_CLIENT, 0.18), M.advisoryFee(s, 0.18), 'אותה עמלה לפני ואחרי');
  assert.equal(M.ltv(OLD_CLIENT), M.ltv(s));
  const o = M.offerStored(OLD_OFFER);
  assert.equal(o.tracks[0].amountAg, 40000050);
  assert.deepEqual(M.offerSummary(o), M.offerSummary(OLD_OFFER), 'אותו לוח לפני ואחרי');
  assert.equal(M.offerSummary(o).tracks[0].amount, 400000.5, 'התצוגה בשקלים');
});

test('ערך פגום ברשומה ישנה לא מפיל את הטעינה', () => {
  const s = M.clientStored({ id: 'x', name: 'א', requestedAmount: 'abc', feeType: 'fixed', feeValue: null });
  assert.equal(s.requestedAmountAg, 0);
  assert.equal(s.feeFixedAg, 0);
});

test('שירות: נתונים ישנים נטענים, נשמרים באגורות בשמירה הבאה, ומעבר בין סוגי עמלה לא משאיר שדה ישן', async () => {
  const store = { mortgageAdvisor: { clients: [OLD_CLIENT], offers: [OLD_OFFER] }, settings: { vatRate: 0.18 } };
  MortgageAdvisorService.initialize(memDb(store));
  const ov = await MortgageAdvisorService.getOverview();
  assert.equal(ov.clients[0].requestedAmount, 1234567.89);
  assert.equal(ov.clients[0].fee.netAg, 617284);
  assert.equal(ov.clients[0].comparison.length, 1);

  const upd = await MortgageAdvisorService.updateClient('c1', { feeType: 'fixed', feeValue: 5000 });
  assert.equal(upd.feeValue, 5000);
  assert.equal(upd.requestedAmount, 1234567.89, 'סכום שלא נשלח נשמר כמו שהוא');
  const saved = store.mortgageAdvisor.clients[0];
  assert.equal(saved.feeFixedAg, 500000);
  assert.equal('feePercent' in saved, false);
  assert.equal('requestedAmount' in saved, false);
  assert.ok(Number.isInteger(saved.requestedAmountAg));
  assert.equal(store.mortgageAdvisor.offers[0].tracks[0].amountAg, 40000050, 'גם ההצעות הומרו');
});

test('ייבוא וייצוא: העמודות בשקלים, השמירה באגורות', () => {
  const data = { mortgageAdvisor: { clients: [M.clientStored(OLD_CLIENT)], offers: [] } };
  const out = P.exportTable('mortgageClients', data);
  const col = out.headers.indexOf('סכום מבוקש');
  assert.equal(out.rows[0][col], 1234567.89);
  const csv = 'שם,טלפון,סכום מבוקש,שווי נכס,עמלה\nשרה גרינברג,050-0000000,"₪750,000.25",1000000,1\n';
  const parsed = P.parseImport('mortgageClients', csv, data);
  assert.deepEqual(parsed.errors, []);
  P.applyImport('mortgageClients', data, parsed.records);
  const all = data.mortgageAdvisor.clients;
  assert.equal(all.length, 2);
  assert.ok(all.every(c => Number.isInteger(c.requestedAmountAg) && !('requestedAmount' in c)));
  assert.equal(all[1].requestedAmountAg, 75000025);
  assert.equal(all[0].requestedAmountAg, 123456789, 'הרשומה הקיימת לא השתנתה');
});

test('מעבדת התמהיל רואה את סכומי התיקים בשקלים', () => {
  const { MortgageLabService } = require('../modules/econ/services/mortgageLabService');
  const rows = MortgageLabService._clients({ mortgageAdvisor: { clients: [M.clientStored(OLD_CLIENT)] } });
  assert.equal(rows[0].requestedAmount, 1234567.89);
  assert.equal(rows[0].propertyValue, 2000000);
});
