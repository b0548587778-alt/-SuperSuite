// מעבדת תמהיל: מנוע התמהיל (הועבר מ-tamhil), הכללים, השירות וערוצי ה-IPC מול מסד אמיתי.
// ערכי הייחוס בבדיקת ההתאמה חושבו במנוע המקורי של tamhil (decimal.js, 34 ספרות) על אותם נתוני הדגמה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const E = require('../modules/econ/core/mixEngine');
const R = require('../modules/econ/core/mortgageRules');
const { calculateLoan } = require('../modules/econ/utils/calculations');
const BK = require('../modules/econ/core/backupCrypto');

const ctx = { forecast: E.DEMO_FORECAST, asOf: '2026-10-14' };
const DEMO_MIX = [
  { id: 'kalatz', type: 'FIXED_UNLINKED', principal: 400000, termMonths: 300, annualRate: 0.049 },
  { id: 'katz', type: 'FIXED_LINKED', principal: 300000, termMonths: 240, annualRate: 0.032 },
  { id: 'prime', type: 'PRIME', principal: 400000, termMonths: 300, spread: -0.005 },
  { id: 'var5', type: 'VARIABLE_LINKED', repayment: 'EQUAL_PRINCIPAL', principal: 100000, termMonths: 180, spread: 0.002, resetEveryMonths: 60, anchorKey: 'GOV_BOND_5Y' }
];
const BASKET_PARAMS = { principal: 1200000, termMonths: 300, pricing: { FIXED_UNLINKED: { annualRate: 0.049 }, PRIME: { spread: -0.005 }, VARIABLE_LINKED: { spread: 0.002, anchorKey: 'GOV_BOND_5Y' } } };
const closeTo = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} מול ${b}`);

// ---------- מנוע ----------

test('מנוע: שפיצר בריבית קבועה תואם לנוסחה הסגורה, באגורות שלמות, והיתרה נסגרת לאפס', () => {
  const r = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 500000, termMonths: 300, annualRate: 0.045 }], ctx);
  const t = r.tracks[0].schedule;
  assert.equal(t.length, 300);
  assert.equal(r.summary.firstPayment, Math.round(calculateLoan({ principal: 500000, annualRate: 0.045, years: 25 }).monthlyPayment * 100) / 100);
  assert.ok(t.every(x => Number.isInteger(x.paymentAg) && Number.isInteger(x.interestAg) && Number.isInteger(x.closingAg)));
  assert.equal(t.at(-1).closingAg, 0);
  assert.equal(t.reduce((s, x) => s + x.principalAg, 0), 50000000, 'הקרן שנפרעה = הקרן בדיוק');
  closeTo(r.summary.irrAnnual, Math.pow(1 + 0.045 / 12, 12) - 1, 1e-6, 'תשואה פנימית = הריבית האפקטיבית');
});

test('מנוע: התאמה למנוע המקורי של tamhil (בטווח של עיגול לאגורה) — תמהיל ההדגמה ושלושת הסלים', () => {
  const s = E.calculateMix(DEMO_MIX, ctx).summary;
  closeTo(s.firstPayment, 7233.50, 0.01, 'החזר ראשון');
  closeTo(s.maxPayment, 7858.52, 0.02, 'החזר מקסימלי');
  assert.equal(s.maxPaymentMonth, 180);
  closeTo(s.totalPayments, 2056396.43, 2, 'סה"כ תשלומים');
  closeTo(s.totalIndexation, 119655.71, 1, 'סה"כ הצמדה');
  const ref = { UNIFORM_BASKET_1: [6945.34, 2083603.00], UNIFORM_BASKET_2: [6654.81, 2201230.66], UNIFORM_BASKET_3: [7068.16, 2070719.61] };
  for (const b of E.calculateUniformBaskets(BASKET_PARAMS, ctx)) {
    closeTo(b.result.summary.firstPayment, ref[b.kind][0], 0.01, `${b.kind} החזר ראשון`);
    closeTo(b.result.summary.totalPayments, ref[b.kind][1], 2, `${b.kind} סה"כ`);
  }
});

test('מנוע: כל מסלול בתמהיל נסגר לאפס, והלוח המאוחד = סכום המסלולים', () => {
  const r = E.calculateMix(DEMO_MIX, ctx);
  assert.deepEqual(r.tracks.map(t => t.schedule.at(-1).closingAg), [0, 0, 0, 0]);
  const sumFirst = r.tracks.reduce((s, t) => s + t.schedule[0].paymentAg, 0);
  assert.equal(r.schedule[0].paymentAg, sumFirst);
  assert.equal(r.schedule.length, 300, 'הלוח המאוחד באורך המסלול הארוך');
  assert.equal(r.yearly.length, 25);
});

test('מנוע: פריים עוקב אחרי מסלול ריבית בנק ישראל; משתנה מתעדכן רק בנקודת השינוי', () => {
  const forecast = { ...E.DEMO_FORECAST, boiRateAnnual: [0.04, 0.04, 0.03], anchors: { A: [...Array(12).fill(0.03), 0.05] } };
  const c = { forecast, asOf: '2026-10-14' };
  const prime = E.calculateMix([{ type: 'PRIME', principal: 100000, termMonths: 60, spread: 0 }], c).tracks[0].schedule;
  closeTo(prime[0].annualRate, 0.055, 1e-12, 'חודש 1: 4% + מרווח פריים 1.5%');
  closeTo(prime[2].annualRate, 0.045, 1e-12, 'חודש 3: 3% + 1.5%');
  const v = E.calculateMix([{ type: 'VARIABLE_UNLINKED', principal: 100000, termMonths: 36, spread: 0.01, resetEveryMonths: 12, anchorKey: 'A' }], c).tracks[0].schedule;
  closeTo(v[11].annualRate, 0.04, 1e-12, 'עד נקודת השינוי — עוגן התחלתי + מרווח');
  closeTo(v[12].annualRate, 0.06, 1e-12, 'אחרי 12 חודשים — העוגן החדש + מרווח');
  assert.ok(v[12].paymentAg > v[11].paymentAg, 'ההחזר עולה עם הריבית');
});

test('מנוע: גרייס חלקי משלם ריבית בלבד; גרייס מלא מגדיל את היתרה', () => {
  const partial = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 100000, termMonths: 120, annualRate: 0.05, grace: { type: 'PARTIAL', months: 6 } }], ctx).tracks[0].schedule;
  assert.equal(partial[0].principalAg, 0);
  assert.equal(partial[5].closingAg, 10000000);
  const full = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 100000, termMonths: 120, annualRate: 0.05, grace: { type: 'FULL', months: 6 } }], ctx).tracks[0].schedule;
  assert.equal(full[0].paymentAg, 0);
  assert.ok(full[5].closingAg > 10000000);
  assert.equal(full.at(-1).closingAg, 0);
});

test('מנוע: קלט שגוי נדחה בהודעה בעברית עם נתיב השדה', () => {
  const bad = [
    [{ type: 'NOPE', principal: 1, termMonths: 1 }, /סוג מסלול/],
    [{ type: 'FIXED_UNLINKED', principal: -5, termMonths: 12, annualRate: 0.04 }, /חיובי/],
    [{ type: 'FIXED_UNLINKED', principal: 100, termMonths: 12 }, /חסרה ריבית/],
    [{ type: 'PRIME', principal: 100, termMonths: 12, spread: 0, annualRate: 0.05 }, /מרווח בלבד/],
    [{ type: 'VARIABLE_LINKED', principal: 100, termMonths: 12, spread: 0, resetEveryMonths: 6, anchorKey: 'X' }, /עוגן לא מוכר/],
    [{ type: 'FIXED_LINKED', principal: 100, termMonths: 12, annualRate: 0.03, isCpiLinked: false }, /צמוד למדד/],
    [{ type: 'FIXED_UNLINKED', principal: 100, termMonths: 700, annualRate: 0.03 }, /600/]
  ];
  for (const [track, re] of bad) {
    assert.throws(() => E.calculateMix([track], ctx), (e) => e instanceof E.EngineInputError && re.test(e.message) && /^tracks\[0\]/.test(e.path));
  }
  assert.throws(() => E.calculateMix([], ctx), /לפחות מסלול/);
});

test('בדיקות 329: נתח משתנה, יחס החזר להכנסה ושיעור מימון — אזהרות בלבד', () => {
  const allPrime = E.calculateMix([{ type: 'PRIME', principal: 900000, termMonths: 300, spread: 0 }], ctx);
  const codes = E.checkMix(allPrime, { monthlyNetIncome: 8000, propertyValue: 1000000, buyerType: 'SINGLE_HOME' }).map(w => w.code).sort();
  assert.deepEqual(codes, ['LTV', 'PTI_MAX', 'SHORT_RESET_SHARE', 'VARIABLE_SHARE']);
  const ok = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 600000, termMonths: 300, annualRate: 0.045 }], ctx);
  assert.deepEqual(E.checkMix(ok, { monthlyNetIncome: 20000, propertyValue: 1000000, buyerType: 'SINGLE_HOME' }), []);
  // שני שלישים בדיוק — לא חריגה (בעיגול אגורות)
  const twoThirds = E.calculateMix(E.buildUniformBasket('UNIFORM_BASKET_2', BASKET_PARAMS, ctx), ctx);
  assert.equal(E.checkMix(twoThirds, {}).length, 0, 'סל אחיד 2 עומד בכללים');
});

test('סלים אחידים: החלוקה באגורות שלמות ומסתכמת בדיוק לסכום', () => {
  const t = E.buildUniformBasket('UNIFORM_BASKET_2', { ...BASKET_PARAMS, principal: 1000000.01 }, ctx);
  const ag = t.map(x => Math.round(x.principal * 100));
  assert.equal(ag.reduce((a, b) => a + b, 0), 100000001);
  assert.equal(t[2].resetEveryMonths, 60);
  assert.throws(() => E.buildUniformBasket('UNIFORM_BASKET_2', { ...BASKET_PARAMS, pricing: {} }, ctx), /חסר תמחור/);
});

test('כושר החזר: ההלוואה לפי ההחזר מחזירה בדיוק את ההחזר הרצוי; מגבלת מימון קובעת כשההון נמוך', () => {
  const mix = [{ type: 'FIXED_UNLINKED', share: 1, termMonths: 300, annualRate: 0.045 }];
  const r = E.maxLoanForPayment({ mix, targetPayment: 5000, equity: 2000000, buyerType: 'SINGLE_HOME' }, ctx);
  assert.equal(r.binding, 'PAYMENT');
  const back = E.calculateMix([{ ...mix[0], principal: r.loanByPayment }], ctx).summary.firstPayment;
  closeTo(back, 5000, 0.02, 'החזר ההלוואה המקסימלית');
  const low = E.maxLoanForPayment({ mix, targetPayment: 20000, equity: 250000, buyerType: 'SINGLE_HOME' }, ctx);
  assert.equal(low.binding, 'LTV');
  assert.equal(low.maxPropertyPrice, 1000000, 'הון 250 אלף = 25% ממחיר של מיליון');
  assert.throws(() => E.maxLoanForPayment({ mix: [{ ...mix[0], share: 0.6 }], targetPayment: 1, equity: 0, buyerType: 'SINGLE_HOME' }, ctx), /100%/);
});

test('מחזור: חיסכון נטו ונקודת איזון; עמלה לא ידועה מסומנת', () => {
  const existing = [{ type: 'FIXED_UNLINKED', principal: 700000, termMonths: 240, annualRate: 0.056 }];
  const proposed = [{ type: 'FIXED_UNLINKED', principal: 700000, termMonths: 240, annualRate: 0.046 }];
  const r = E.compareRefinance({ existing, proposed, prepaymentFee: 15000, switchingCosts: 5000 }, ctx);
  assert.ok(r.netSavings > 0);
  assert.ok(r.firstPaymentChange < 0);
  const monthly = r.existing.summary.firstPayment - r.proposed.summary.firstPayment;
  assert.equal(r.breakEvenMonth, Math.ceil(20000 / monthly));
  assert.equal(r.prepaymentFeeKnown, true);
  assert.equal(E.compareRefinance({ existing, proposed }, ctx).prepaymentFeeKnown, false);
  assert.equal(r.estimateOnly, true);
});

test('השוואת אישורים: אותו סכום לכל ההצעות, דירוג לפי עלות כולל עמלות, ופסילת פג תוקף/מעל המקסימום', () => {
  const tr = (rate) => [{ type: 'FIXED_UNLINKED', share: 1, termMonths: 300, annualRate: rate }];
  const r = E.compareApprovals([
    { id: 'a', lender: 'א', validUntil: '2026-12-31', fees: 0, tracks: tr(0.05) },
    { id: 'b', lender: 'ב', validUntil: '2026-12-31', fees: 500, tracks: tr(0.045) },
    { id: 'c', lender: 'ג', validUntil: '2026-01-01', tracks: tr(0.03) },
    { id: 'd', lender: 'ד', validUntil: '2026-12-31', maxAmount: 500000, tracks: tr(0.03) },
    { id: 'e', lender: 'ה', validUntil: '2026-12-31', tracks: [{ type: 'FIXED_UNLINKED', share: 0.5, termMonths: 300, annualRate: 0.04 }] }
  ], 1000000, ctx);
  assert.deepEqual(r.byTotalCost, ['b', 'a']);
  assert.equal(r.offers.find(x => x.offer.id === 'c').expired, true);
  assert.equal(r.offers.find(x => x.offer.id === 'd').overMax, true);
  assert.match(r.offers.find(x => x.offer.id === 'e').error, /100%/);
});

test('עמלת פירעון: היוון רק כשהריבית הממוצעת נמוכה, פערים מדווחים ולא מנוחשים', () => {
  const rules = E.prepaymentRulesFrom(R.defaultRuleSet, '2026-10-14');
  const base = { balance: 500000, monthlyPayment: 3100, remainingPayments: 216, contractRate: 0.052, isFixedRate: true, isCpiLinked: false, monthsElapsed: 60, noticeGiven: true };
  const lower = E.estimatePrepaymentFee([{ ...base, averageMarketRate: 0.043 }], rules);
  assert.ok(lower.tracks[0].capitalizationFee > 0);
  assert.equal(lower.operationalFee, 60);
  assert.ok(lower.gaps.includes('RULES_UNVERIFIED'));
  assert.equal(E.estimatePrepaymentFee([{ ...base, averageMarketRate: 0.06 }], rules).tracks[0].capitalizationFee, 0);
  const unknown = E.estimatePrepaymentFee([{ ...base, isCpiLinked: true, noticeGiven: false }], rules);
  assert.ok(unknown.gaps.includes('AVERAGE_RATE_UNKNOWN'));
  assert.ok(unknown.gaps.includes('CPI_AVERAGE_FEE_NOT_MODELLED'));
  assert.equal(unknown.tracks[0].noticeFee, 500, 'אי-הודעה: 0.1% מהיתרה');
  assert.equal(E.discountFor(70, [{ fromMonthsElapsed: 36, discount: 0.2 }, { fromMonthsElapsed: 60, discount: 0.3 }]), 0.3);
});

test('אופטימייזר: מועמדים מדורגים, חריגות נפסלות, ותקרת החזר נאכפת', () => {
  const blocks = [
    { track: { type: 'FIXED_UNLINKED', termMonths: 300, annualRate: 0.049 } },
    { track: { type: 'PRIME', termMonths: 300, spread: -0.005 } }
  ];
  const r = E.optimizeMix({ principal: 1000000, blocks, objective: 'TOTAL_COST', step: 0.1 }, ctx);
  assert.equal(r.evaluated, 11);
  assert.ok(r.rejected >= 3, 'פריים מעל שני שלישים נפסל');
  assert.ok(r.candidates.every(c => c.shares[1] <= 2 / 3 + 1e-9));
  for (let i = 1; i < r.candidates.length; i++) assert.ok(r.candidates[i - 1].score <= r.candidates[i].score);
  const capped = E.optimizeMix({ principal: 1000000, blocks, objective: 'TOTAL_COST_WITH_PAYMENT_CAP', maxMonthlyPayment: 5500, step: 0.1 }, ctx);
  assert.ok(capped.candidates.every(c => c.summary.maxPayment <= 5500));
  assert.throws(() => E.optimizeMix({ principal: 1, blocks, objective: 'TOTAL_COST_WITH_PAYMENT_CAP' }, ctx), /תקרת החזר/);
  assert.throws(() => E.optimizeMix({ principal: 1, blocks, step: 0.03 }, ctx), /הצעד/);
  assert.equal(r.recommendationOnly, true);
});

test('כללים: אימות חל רק על גרסת הכללים שבה נרשם; כל הכללים מתחילים "יש לאמת"', () => {
  assert.equal(R.defaultRuleSet.unverified('2026-10-14').length, R.ALL_RULE_IDS.length);
  const v = R.defaultRuleSet.withVerifications([
    { ruleId: 'boi.prime.spread', rulesVersion: R.RULES_VERSION },
    { ruleId: 'boi.329.ptiMax', rulesVersion: '1999.1.1' }
  ]);
  assert.equal(v.get('boi.prime.spread', '2026-10-14').needsVerification, false);
  assert.equal(v.get('boi.329.ptiMax', '2026-10-14').needsVerification, true, 'אימות מגרסה אחרת לא חל');
  assert.throws(() => R.defaultRuleSet.get('boi.prime.spread', '1990-01-01'), /לא נמצא/);
});

// ---------- שירות ו-IPC מול מסד אמיתי ----------

const handlers = {};
Module._resolveFilename_origLab = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_mlab__.js' : Module._resolveFilename_origLab.call(this, req, ...rest); };
require.cache['/__electron_stub_mlab__.js'] = {
  id: '/__electron_stub_mlab__.js', filename: '/__electron_stub_mlab__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const { retentionEvents, addMonths } = require('../modules/econ/services/mortgageLabService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mlab-')));
  await handlers['auth:setup'](ev(id), 'lab_admin', 'lab-admin-strong-1');
  await handlers['auth:login'](ev(id), 'lab_admin', 'lab-admin-strong-1');
}

const UI_MIX = [
  { type: 'FIXED_UNLINKED', repayment: 'SPITZER', amount: 400000, years: 25, ratePct: 4.9 },
  { type: 'PRIME', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: -0.5 },
  { type: 'VARIABLE_LINKED', repayment: 'SPITZER', amount: 400000, years: 25, spreadPct: 0.2, resetMonths: 60, anchorKey: 'GOV_BOND_5Y' }
];

test('IPC מעבדה: חישוב מאחוזים ושנים, תוצאה זהה למנוע, ונתוני הדגמה מסומנים', async () => {
  await freshLogin(61);
  await assert.rejects(handlers['mlab:getOverview'](ev(99)), /נדרשת כניסה/);
  const o = await handlers['mlab:getOverview'](ev(61));
  assert.equal(o.forecast.isDemo, true);
  assert.ok(o.rules.every(r => r.needsVerification));
  assert.deepEqual(o.anchorKeys, ['GOV_BOND_5Y']);

  const r = await handlers['mlab:calcMix'](ev(61), { tracks: UI_MIX, monthlyNetIncome: 15000, propertyValue: 1600000, buyerType: 'SINGLE_HOME' });
  const direct = E.calculateMix(E.buildUniformBasket('UNIFORM_BASKET_2', BASKET_PARAMS, ctx), { ...ctx, asOf: r.assumptions.asOf });
  assert.equal(r.summary.firstPayment, direct.summary.firstPayment);
  assert.equal(r.summary.totalPayments, direct.summary.totalPayments);
  assert.equal(r.schedule, undefined, 'הלוח החודשי המלא לא נשלח לתצוגה');
  assert.ok(r.warnings.some(w => w.code === 'PTI_WARNING' || w.code === 'PTI_MAX'));

  const baskets = await handlers['mlab:calcBaskets'](ev(61), { amount: 1200000, years: 25, pricing: { fixedRatePct: 4.9, primeSpreadPct: -0.5, variableSpreadPct: 0.2 } });
  assert.equal(baskets.length, 3);
  await assert.rejects(handlers['mlab:calcBaskets'](ev(61), { amount: 1, years: 1, pricing: {} }), /ריבית קל"צ/);

  const aff = await handlers['mlab:calcAffordability'](ev(61), { tracks: [{ type: 'FIXED_UNLINKED', share: 100, years: 25, ratePct: 4.5 }], targetPayment: 5000, equity: 2000000, buyerType: 'SINGLE_HOME' });
  assert.equal(aff.binding, 'PAYMENT');

  const prepay = await handlers['mlab:calcPrepayment'](ev(61), { tracks: [{ balance: 500000, monthlyPayment: 3100, remainingPayments: 216, contractRatePct: 5.2, averageRatePct: 4.3, isFixedRate: true }] });
  assert.ok(prepay.total > 60);

  const opt = await handlers['mlab:calcOptimize'](ev(61), { amount: 1000000, objective: 'MAX_PAYMENT', stepPct: 25, blocks: UI_MIX.map(({ amount: _a, ...t }) => t) });
  assert.equal(opt.evaluated, 15);
});

test('IPC מעבדה: תחזית מותאמת נשמרת, נכנסת לחישוב, ונדחית בלי מקור', async () => {
  await freshLogin(62);
  await assert.rejects(handlers['mlab:saveForecast'](ev(62), { boiPct: '4', inflationAnnualPct: '2', anchorPct: '3' }), /מקור/);
  await assert.rejects(handlers['mlab:saveForecast'](ev(62), { source: 'בדיקה', boiPct: '4, x', inflationAnnualPct: '2', anchorPct: '3' }), /מספרים/);
  await handlers['mlab:saveForecast'](ev(62), { source: 'תחזית לבדיקה', publishedAt: '2026-10-01', boiPct: '3', inflationAnnualPct: '0', anchorKey: 'GOV_BOND_5Y', anchorPct: '3' });
  const o = await handlers['mlab:getOverview'](ev(62));
  assert.equal(o.forecast.isDemo, false);
  assert.equal(o.forecast.source, 'תחזית לבדיקה');
  const r = await handlers['mlab:calcMix'](ev(62), { tracks: [{ type: 'PRIME', amount: 100000, years: 10, spreadPct: 0 }] });
  closeTo(r.tracks[0].initialRate, 0.045, 1e-12, 'פריים = 3% + 1.5%');
  assert.equal(r.summary.totalIndexation, 0);
  await handlers['mlab:resetForecast'](ev(62));
  assert.equal((await handlers['mlab:getOverview'](ev(62))).forecast.isDemo, true);
});

test('IPC מעבדה: אימות כלל דורש תיעוד מקור ומנהל, ונרשם ביומן הביקורת', async () => {
  await freshLogin(63);
  await assert.rejects(handlers['mlab:verifyRule'](ev(63), 'boi.prime.spread', ''), /לתעד/);
  await assert.rejects(handlers['mlab:verifyRule'](ev(63), 'no.such.rule', 'x'), /לא מוכר/);
  await handlers['mlab:verifyRule'](ev(63), 'boi.prime.spread', 'נבדק מול פרסום בנק ישראל, 10.2026');
  const o = await handlers['mlab:getOverview'](ev(63));
  const rule = o.rules.find(r => r.id === 'boi.prime.spread');
  assert.equal(rule.needsVerification, false);
  assert.match(rule.verifiedNote, /בנק ישראל/);
  const rows = await ipc.getDb().all("SELECT action FROM audit_events WHERE action = 'mlab.rule.verify'");
  assert.equal(rows.length, 1);

  // עורך (בלי users.manage) לא יכול לאמת, אבל יכול לחשב
  AuthService.getSession(63).permissions = ['data.view', 'data.edit'];
  await assert.rejects(handlers['mlab:verifyRule'](ev(63), 'boi.329.ptiMax', 'x'), /אין הרשאה/);
  await assert.rejects(handlers['mlab:unverifyRule'](ev(63), 'boi.prime.spread'), /אין הרשאה/);
  const calc = await handlers['mlab:calcMix'](ev(63), { tracks: UI_MIX });
  assert.ok(calc.summary.firstPayment > 0);
});

test('IPC מעבדה: תרחיש משויך לתיק נשמר עם גרסאות, נכנס לגיבוי המוצפן ומפיק אירועי שימור', async () => {
  await freshLogin(64);
  const c = await handlers['madv:createClient'](ev(64), { name: 'משפחת גולדברג', requestedAmount: 1200000 });
  await assert.rejects(handlers['mlab:saveScenario'](ev(64), { name: '', tracks: UI_MIX }), /שם/);
  await assert.rejects(handlers['mlab:saveScenario'](ev(64), { name: 'x', clientId: 'nope', tracks: UI_MIX }), /תיק הלקוח/);
  // תחילה לפני 59 חודשים → נקודת השינוי של מסלול ה-60 בעוד כחודש, ויום השנה החמישי בעוד כחודש
  const start = addMonths(new Date().toISOString().slice(0, 10), -59);
  const sc = await handlers['mlab:saveScenario'](ev(64), { name: 'תמהיל שנחתם', clientId: c.id, startDate: start, tracks: UI_MIX });
  assert.equal(sc.rulesVersion, R.RULES_VERSION);
  assert.equal(sc.forecastId, E.DEMO_FORECAST.id);
  assert.ok(sc.summary.totalPayments > 0);

  const o = await handlers['mlab:getOverview'](ev(64));
  assert.equal(o.scenarios[0].clientName, 'משפחת גולדברג');
  const kinds = o.retention.map(e => e.kind).sort();
  assert.deepEqual(kinds, ['ANNIVERSARY', 'RATE_RESET']);
  assert.ok(o.retention.every(e => e.days >= 0 && e.days <= 180));

  AuthService.getSession(64).permissions = ['data.view', 'data.edit', 'data.delete', 'data.backup'];
  const enc = await handlers['data:backupEncrypted'](ev(64), 'backup-pass-789');
  assert.equal(JSON.parse(BK.decryptBackup(enc, 'backup-pass-789')).mortgageLab.scenarios.length, 1, 'התרחישים בגיבוי המוצפן');

  await handlers['mlab:deleteScenario'](ev(64), sc.id);
  assert.equal((await handlers['mlab:getOverview'](ev(64))).scenarios.length, 0);
  await assert.rejects(handlers['mlab:deleteScenario'](ev(64), sc.id), /לא נמצא/);
});

test('שימור: רק אירועים בחלון, ממוינים לפי קרבה; תרחיש בלי תיק או בלי תאריך מדולג', () => {
  const clients = [{ id: 'c1', name: 'משפחת שפירא' }];
  const s = (extra) => ({ id: 's', name: 'ת', clientId: 'c1', startDate: '2022-01-15', tracks: [{ termMonths: 300, resetMonths: 60 }], ...extra });
  const ev1 = retentionEvents([s()], clients, '2026-10-14');
  assert.deepEqual(ev1.map(e => [e.kind, e.date]), [['ANNIVERSARY', '2027-01-15'], ['RATE_RESET', '2027-01-15']]);
  assert.equal(retentionEvents([s({ clientId: null })], clients, '2026-10-14').length, 0);
  assert.equal(retentionEvents([s({ startDate: null })], clients, '2026-10-14').length, 0);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'סוף חודש נשמר');
});
