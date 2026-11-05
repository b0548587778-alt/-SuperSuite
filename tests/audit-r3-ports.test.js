// סקירת קוד 2.11.2026 — ייבוא וייצוא (docs/CODE-AUDIT-2026-11-02.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../modules/econ/core/dataPorts');
const M = require('../modules/econ/core/mortgageAdvisor');

// ממצא 2: ייבוא לקוחות משכנתא מחק את האישורים, תשלומי העמלה והפיקדון של הלקוחות הקיימים
test('ממצא 2: ייבוא לקוחות משכנתא לא נוגע בתיקים הקיימים (אישורים, תשלומים, פיקדון)', () => {
  const existing = M.clientStored({
    id: 'c1', name: 'משה כהן', phone: '050-1111111', requestedAmount: 900000, propertyValue: 1500000,
    feeType: 'fixed', feeValue: 5000, status: M.DEFAULT_STAGE, createdAt: '2026-01-01T00:00:00.000Z',
  });
  existing.approvals = [{ id: 'a1', bank: 'לאומי', tracks: [{ type: 'fixed', share: 100, rate: 4.5, years: 25 }] }];
  existing.feePayments = [{ id: 'p1', date: '2026-03-01', amountAg: 200000, invoiceId: 'inv-1' }];
  existing.feeDepositAg = 100000;
  const before = structuredClone(existing);
  const data = { mortgageAdvisor: { clients: [existing], offers: [] } };
  const parsed = P.parseImport('mortgageClients', 'שם,טלפון,סכום מבוקש\nשרה לוי,050-2222222,500000\n', data);
  assert.deepEqual(parsed.errors, []);
  P.applyImport('mortgageClients', data, parsed.records);
  assert.equal(data.mortgageAdvisor.clients.length, 2);
  assert.deepEqual(data.mortgageAdvisor.clients[0], before, 'התיק הקיים נשאר בדיוק כפי שהיה');
  assert.ok(Number.isInteger(data.mortgageAdvisor.clients[1].requestedAmountAg));
});
