// Mortgage Lab Service — מעבדת תמהיל: מנוע התמהיל המלא (הועבר מ-tamhil) מעל תיקי ייעוץ המשכנתאות.
// נשמר באוסף mortgageLab במסד המרכזי — ולכן נכנס אוטומטית לגיבוי המוצפן הקיים.
// הטפסים שולחים ריביות באחוזים ותקופות בשנים; ההמרה לשברים ולחודשים נעשית כאן, במקום אחד.
const crypto = require('crypto');
const E = require('../core/mixEngine');
const R = require('../core/mortgageRules');
const MA = require('../core/mortgageAdvisor');

const MAX_SCENARIOS = 5000;
const RETENTION_DAYS = 180;

// היום המקומי (לא UTC — בין חצות ל-03:00 toISOString מחזיר את אתמול)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blank = (v) => v === undefined || v === null || v === '';
const pct = (v) => (blank(v) ? undefined : Number(v) / 100);
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};
// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).toISOString().slice(0, 10) === s;

// רשימת ערכים מופרדת בפסיקים ("4.25, 4.25, 4") → מערך מספרים
function list(v, label) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/[,\s;]+/).filter(Boolean);
  const out = raw.map(Number);
  if (!out.length || out.some(n => !Number.isFinite(n))) throw new Error(`${label}: יש להזין מספרים מופרדים בפסיקים`);
  if (out.length > E.MAX_TERM_MONTHS) throw new Error(`${label}: יותר מדי ערכים`);
  return out;
}

// מסלול מהטופס (אחוזים ושנים) → קלט המנוע (שברים וחודשים)
function uiTrack(t, i) {
  if (!t || typeof t !== 'object') throw new Error(`מסלול ${i + 1} לא תקין`);
  const years = Number(t.years);
  const termMonths = blank(t.termMonths) ? Math.round(years * 12) : Number(t.termMonths);
  const out = { id: str(t.id, 60, 'מזהה מסלול') || `t${i + 1}`, type: t.type, repayment: t.repayment || 'SPITZER', principal: blank(t.amount) ? t.principal : t.amount, termMonths };
  if (!blank(t.ratePct)) out.annualRate = pct(t.ratePct);
  if (!blank(t.spreadPct)) out.spread = pct(t.spreadPct);
  if (!blank(t.resetMonths)) out.resetEveryMonths = Number(t.resetMonths);
  if (!blank(t.anchorKey)) out.anchorKey = String(t.anchorKey);
  if (!blank(t.graceMonths) && Number(t.graceMonths) > 0) out.grace = { type: t.graceType === 'FULL' ? 'FULL' : 'PARTIAL', months: Number(t.graceMonths) };
  if (!blank(t.share)) out.share = pct(t.share);
  return out;
}

function uiTracks(v) {
  const tracks = Array.isArray(v) ? v : [];
  if (!tracks.length) throw new Error('יש להזין לפחות מסלול אחד');
  if (tracks.length > 12) throw new Error('עד 12 מסלולים');
  return tracks.map(uiTrack);
}

// תוצאת מנוע → מה שהתצוגה צריכה (בלי הלוח החודשי המלא, שנשמר לייצוא בלבד)
function slimMix(r) {
  return {
    summary: r.summary,
    yearly: r.yearly,
    assumptions: r.assumptions,
    tracks: r.tracks.map(t => ({
      id: t.track.id, type: t.track.type, label: t.track.label, repayment: t.track.repayment,
      principal: t.summary.principal, termMonths: t.track.termMonths, isCpiLinked: t.track.isCpiLinked,
      initialRate: t.track.initialAnnualRate, resetEveryMonths: t.track.resetEveryMonths, summary: t.summary
    }))
  };
}

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// אירועי שימור בחצי השנה הקרובה: נקודת שינוי ריבית במסלול משתנה, ויום שנה לנטילת ההלוואה.
// משימה ליועץ בלבד — המערכת לא פונה ללקוח.
function retentionEvents(scenarios, clients, asOf, horizonDays = RETENTION_DAYS) {
  const byId = new Map(clients.map(c => [c.id, c]));
  const events = [];
  for (const s of scenarios) {
    if (!s.startDate || !s.clientId || !byId.has(s.clientId)) continue;
    const client = byId.get(s.clientId);
    const months = Math.max(...(s.tracks || []).map(t => Number(t.termMonths) || Math.round(Number(t.years) * 12) || 0), 0);
    for (let y = 1; y * 12 <= months; y++) {
      const date = addMonths(s.startDate, y * 12);
      const days = daysBetween(asOf, date);
      if (days >= 0 && days <= horizonDays) events.push({ kind: 'ANNIVERSARY', label: `שנה ${y} להלוואה — בדיקה שנתית`, date, days, clientId: client.id, clientName: client.name, scenarioId: s.id, scenarioName: s.name });
    }
    (s.tracks || []).forEach((t, i) => {
      const reset = Number(t.resetMonths || t.resetEveryMonths);
      if (!reset) return;
      const term = Number(t.termMonths) || Math.round(Number(t.years) * 12);
      for (let m = reset; m < term; m += reset) {
        const date = addMonths(s.startDate, m);
        const days = daysBetween(asOf, date);
        if (days >= 0 && days <= horizonDays) events.push({ kind: 'RATE_RESET', label: `נקודת שינוי ריבית במסלול ${i + 1} — הזדמנות למחזור`, date, days, clientId: client.id, clientName: client.name, scenarioId: s.id, scenarioName: s.name });
      }
    });
  }
  return events.sort((a, b) => a.days - b.days);
}

class MortgageLabService {
  constructor(db) {
    this.db = db;
  }

  async initialize(db) {
    if (db) this.db = db;
  }

  async _load() {
    const data = await this.db.load();
    const ml = data.mortgageLab && typeof data.mortgageLab === 'object' ? data.mortgageLab : {};
    data.mortgageLab = {
      forecast: ml.forecast && typeof ml.forecast === 'object' ? ml.forecast : null,
      verifications: Array.isArray(ml.verifications) ? ml.verifications : [],
      scenarios: Array.isArray(ml.scenarios) ? ml.scenarios : [],
      rateConvention: ml.rateConvention === 'EFFECTIVE' ? 'EFFECTIVE' : 'NOMINAL'
    };
    return data;
  }

  _ctx(data, asOf) {
    const ml = data.mortgageLab;
    return {
      forecast: ml.forecast || E.DEMO_FORECAST,
      asOf: isDate(asOf) ? asOf : today(),
      rules: R.defaultRuleSet.withVerifications(ml.verifications),
      rateConvention: ml.rateConvention
    };
  }

  // רק תיקים שהמשתמש רשאי לראות (משרד עם כמה יועצים — MA.canSee). בלי actor — הכול
  _clients(data, actor) {
    const settings = data.mortgageAdvisor && data.mortgageAdvisor.settings;
    const ma = (data.mortgageAdvisor && Array.isArray(data.mortgageAdvisor.clients) ? data.mortgageAdvisor.clients : []).filter(c => MA.canSee(c, actor, settings));
    // התיקים נשמרים באגורות — clientView מחזיר את הסכומים בשקלים, כמו שהמעבדה מצפה
    return ma.map(MA.clientView).map(c => ({ id: c.id, name: c.name, requestedAmount: c.requestedAmount, propertyValue: c.propertyValue, status: c.status }));
  }

  // תרחיש של תיק שהמשתמש לא רואה — מוסתר (תרחיש בלי תיק, או של תיק שנמחק — גלוי לכולם, כמו קודם)
  _visibleScenario(s, allIds, visibleIds) { return !s.clientId || !allIds.has(s.clientId) || visibleIds.has(s.clientId); }
  // תרחיש לפי מזהה — רק אם המשתמש רשאי לראות את התיק שלו; אחרת "לא נמצא" (לא מגלים שהוא קיים)
  _scenarioFor(data, id, actor) {
    const allIds = new Set(((data.mortgageAdvisor && data.mortgageAdvisor.clients) || []).map(c => c.id));
    const visibleIds = new Set(this._clients(data, actor).map(c => c.id));
    const s = data.mortgageLab.scenarios.find(x => x.id === id);
    if (!s || !this._visibleScenario(s, allIds, visibleIds)) throw new Error('התרחיש לא נמצא');
    return s;
  }

  async getOverview(actor) {
    const data = await this._load();
    const ml = data.mortgageLab;
    const ctx = this._ctx(data);
    const forecast = ctx.forecast;
    const clients = this._clients(data, actor);
    // תרחיש של תיק שהמשתמש לא רואה — מוסתר גם הוא
    const allIds = new Set(((data.mortgageAdvisor && data.mortgageAdvisor.clients) || []).map(c => c.id));
    const visibleIds = new Set(clients.map(c => c.id));
    const scenarios = ml.scenarios.filter(s => this._visibleScenario(s, allIds, visibleIds));
    const verifiedAt = new Map(ml.verifications.filter(v => v.rulesVersion === R.RULES_VERSION).map(v => [v.ruleId, v]));
    return {
      forecast: {
        isDemo: !ml.forecast,
        id: forecast.id, source: forecast.source, publishedAt: forecast.publishedAt, needsVerification: forecast.needsVerification !== false,
        boiPct: forecast.boiRateAnnual.map(v => Math.round(v * 1e6) / 1e4),
        inflationAnnualPct: Math.round((Math.pow(1 + forecast.inflationMonthly[0], 12) - 1) * 1e6) / 1e4,
        inflationMonths: forecast.inflationMonthly.length,
        anchors: Object.fromEntries(Object.entries(forecast.anchors).map(([k, v]) => [k, { first: Math.round(v[0] * 1e6) / 1e4, last: Math.round(v[v.length - 1] * 1e6) / 1e4, months: v.length }]))
      },
      anchorKeys: Object.keys(forecast.anchors),
      rateConvention: ml.rateConvention,
      rulesVersion: R.RULES_VERSION,
      engineVersion: E.ENGINE_VERSION,
      rules: ctx.rules.inForce(ctx.asOf).map(r => ({
        id: r.id, description: r.description, source: r.source, effectiveFrom: r.effectiveFrom,
        value: r.value, needsVerification: r.needsVerification, valueYear: r.valueYear, statusLabel: R.statusLabel(r),
        verifiedAt: verifiedAt.has(r.id) ? verifiedAt.get(r.id).verifiedAt : null,
        verifiedNote: verifiedAt.has(r.id) ? verifiedAt.get(r.id).note : ''
      })),
      trackTypes: R.TRACK_TYPES,
      buyerTypes: R.BUYER_TYPES,
      repayments: E.REPAYMENTS,
      clients,
      scenarios: scenarios.map(s => ({ ...s, clientName: (clients.find(c => c.id === s.clientId) || {}).name || '' }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      retention: retentionEvents(scenarios, clients, ctx.asOf)
    };
  }

  // ---------- חישובים (בלי שמירה) ----------

  async calcMix(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const result = E.calculateMix(uiTracks(input.tracks), ctx);
    const checks = {
      monthlyNetIncome: blank(input.monthlyNetIncome) ? undefined : Number(input.monthlyNetIncome),
      propertyValue: blank(input.propertyValue) ? undefined : Number(input.propertyValue),
      buyerType: R.BUYER_TYPES[input.buyerType] ? input.buyerType : undefined
    };
    return { ...slimMix(result), warnings: E.checkMix(result, { ...checks, asOf: ctx.asOf, rules: ctx.rules }) };
  }

  async calcBaskets(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const p = input.pricing || {};
    const pricing = {
      FIXED_UNLINKED: { annualRate: pct(p.fixedRatePct) },
      PRIME: { spread: pct(p.primeSpreadPct) },
      VARIABLE_LINKED: { spread: pct(p.variableSpreadPct), anchorKey: p.anchorKey || ctx.forecast && Object.keys(ctx.forecast.anchors)[0] }
    };
    if (blank(p.fixedRatePct) || blank(p.primeSpreadPct) || blank(p.variableSpreadPct)) throw new Error('יש להזין ריבית קל"צ, מרווח פריים ומרווח משתנה');
    const termMonths = Math.round(Number(input.years) * 12);
    return E.calculateUniformBaskets({ principal: input.amount, termMonths, pricing }, ctx)
      .map(b => ({ kind: b.kind, label: b.label, ...slimMix(b.result) }));
  }

  async calcAffordability(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const mix = uiTracks(input.tracks).map(t => ({ ...t, share: t.share }));
    return E.maxLoanForPayment({ mix, targetPayment: input.targetPayment, equity: input.equity, buyerType: input.buyerType, basis: input.basis }, ctx);
  }

  async calcRefinance(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const r = E.compareRefinance({
      existing: uiTracks(input.existing), proposed: uiTracks(input.proposed),
      prepaymentFee: input.prepaymentFee, switchingCosts: input.switchingCosts
    }, ctx);
    return { ...r, existing: slimMix(r.existing), proposed: slimMix(r.proposed) };
  }

  async calcApprovals(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const offers = (Array.isArray(input.offers) ? input.offers : []).slice(0, 20).map((o, i) => ({
      id: str(o.id, 60, 'מזהה') || `o${i + 1}`,
      lender: str(o.lender, 100, 'שם הבנק') || `הצעה ${i + 1}`,
      validUntil: isDate(o.validUntil) ? o.validUntil : '',
      maxAmount: blank(o.maxAmount) ? undefined : o.maxAmount,
      fees: blank(o.fees) ? undefined : o.fees,
      tracks: uiTracks(o.tracks)
    }));
    if (!offers.length) throw new Error('יש להזין לפחות הצעה אחת');
    const r = E.compareApprovals(offers, input.amount, ctx);
    return { ...r, offers: r.offers.map(x => ({ ...x, result: x.result && slimMix(x.result) })) };
  }

  async calcPrepayment(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const tracks = (Array.isArray(input.tracks) ? input.tracks : []).slice(0, 12).map((t, i) => ({
      id: t.id || `t${i + 1}`,
      balance: t.balance, monthlyPayment: t.monthlyPayment, remainingPayments: Number(t.remainingPayments),
      contractRate: pct(t.contractRatePct), averageMarketRate: pct(t.averageRatePct),
      isCpiLinked: Boolean(t.isCpiLinked), isFixedRate: Boolean(t.isFixedRate),
      monthsElapsed: Number(t.monthsElapsed) || 0, noticeGiven: Boolean(t.noticeGiven)
    }));
    if (!tracks.length) throw new Error('יש להזין לפחות מסלול אחד');
    return E.estimatePrepaymentFee(tracks, E.prepaymentRulesFrom(ctx.rules, ctx.asOf));
  }

  async calcOptimize(input = {}) {
    const data = await this._load();
    const ctx = this._ctx(data, input.asOf);
    const blocks = uiTracks(input.blocks).map((t, i) => {
      const src = input.blocks[i] || {};
      const { principal: _p, id: _id, share: _s, ...track } = t;
      return { track, minShare: pct(src.minSharePct), maxShare: pct(src.maxSharePct) };
    });
    return E.optimizeMix({
      principal: input.amount, blocks, objective: input.objective,
      maxMonthlyPayment: input.maxMonthlyPayment, step: blank(input.stepPct) ? 0.1 : Number(input.stepPct) / 100,
      checks: {
        monthlyNetIncome: blank(input.monthlyNetIncome) ? undefined : Number(input.monthlyNetIncome),
        propertyValue: blank(input.propertyValue) ? undefined : Number(input.propertyValue),
        buyerType: R.BUYER_TYPES[input.buyerType] ? input.buyerType : undefined
      }
    }, ctx);
  }

  // ---------- תחזית ----------

  async saveForecast(input = {}) {
    const data = await this._load();
    const source = str(input.source, 300, 'מקור התחזית');
    if (!source) throw new Error('יש לציין את מקור התחזית');
    const publishedAt = isDate(input.publishedAt) ? input.publishedAt : today();
    const inflAnnual = list(input.inflationAnnualPct, 'מדד שנתי צפוי (%)').map(v => v / 100);
    const forecast = {
      id: `custom-${publishedAt}`,
      publishedAt,
      source,
      needsVerification: !input.verified,
      boiRateAnnual: list(input.boiPct, 'מסלול ריבית בנק ישראל (%)').map(v => v / 100),
      // כל ערך שנתי חל על 12 חודשים; הערך האחרון ממשיך הלאה
      inflationMonthly: inflAnnual.flatMap(a => Array(12).fill(E.annualToMonthlyInflation(a))),
      anchors: {}
    };
    const anchorKey = str(input.anchorKey, 40, 'שם העוגן') || 'GOV_BOND_5Y';
    if (!/^[A-Z0-9_]+$/.test(anchorKey)) throw new Error('שם העוגן: אותיות לועזיות גדולות, ספרות וקו תחתון בלבד');
    // כל ערך שנתי של העוגן חל על 12 חודשים
    forecast.anchors[anchorKey] = list(input.anchorPct, 'תשואת העוגן (%)').flatMap(v => Array(12).fill(v / 100));
    E.createForecast(forecast); // ולידציה מלאה לפני שמירה
    data.mortgageLab.forecast = forecast;
    if (input.rateConvention) data.mortgageLab.rateConvention = input.rateConvention === 'EFFECTIVE' ? 'EFFECTIVE' : 'NOMINAL';
    await this.db.save(data);
    return { ok: true, id: forecast.id };
  }

  async resetForecast() {
    const data = await this._load();
    data.mortgageLab.forecast = null;
    await this.db.save(data);
    return { ok: true };
  }

  // ---------- אימות כללים (מנהל בלבד; נאכף ב-ipc) ----------

  async verifyRule(ruleId, note, userId) {
    if (!R.ALL_RULE_IDS.includes(ruleId)) throw new Error('כלל לא מוכר');
    const n = str(note, 500, 'תיעוד המקור');
    if (!n) throw new Error('יש לתעד את המקור שמולו אומת הכלל (שם ההוראה, סעיף ותאריך)');
    const data = await this._load();
    data.mortgageLab.verifications = data.mortgageLab.verifications.filter(v => !(v.ruleId === ruleId && v.rulesVersion === R.RULES_VERSION));
    data.mortgageLab.verifications.push({ ruleId, rulesVersion: R.RULES_VERSION, verifiedAt: new Date().toISOString(), note: n, by: userId || null });
    await this.db.save(data);
    return true;
  }

  async unverifyRule(ruleId) {
    const data = await this._load();
    data.mortgageLab.verifications = data.mortgageLab.verifications.filter(v => !(v.ruleId === ruleId && v.rulesVersion === R.RULES_VERSION));
    await this.db.save(data);
    return true;
  }

  // ---------- תרחישים שמורים ----------

  async saveScenario(input = {}, actor) {
    const data = await this._load();
    if (data.mortgageLab.scenarios.length >= MAX_SCENARIOS) throw new Error('הגעת למספר המקסימלי של תרחישים');
    const name = str(input.name, 200, 'שם התרחיש');
    if (!name) throw new Error('יש לתת שם לתרחיש');
    const clients = this._clients(data, actor);
    if (!blank(input.clientId) && !clients.some(c => c.id === input.clientId)) throw new Error('תיק הלקוח לא נמצא');
    const tracks = Array.isArray(input.tracks) ? input.tracks : [];
    const ctx = this._ctx(data);
    const result = E.calculateMix(uiTracks(tracks), ctx); // לא שומרים תרחיש שאינו מחושב
    const scenario = {
      id: crypto.randomUUID(),
      name,
      clientId: blank(input.clientId) ? null : input.clientId,
      startDate: isDate(input.startDate) ? input.startDate : null,
      tracks: tracks.map(t => ({
        type: t.type, repayment: t.repayment || 'SPITZER', amount: Number(t.amount), years: blank(t.years) ? null : Number(t.years),
        termMonths: blank(t.termMonths) ? Math.round(Number(t.years) * 12) : Number(t.termMonths),
        ratePct: blank(t.ratePct) ? null : Number(t.ratePct), spreadPct: blank(t.spreadPct) ? null : Number(t.spreadPct),
        resetMonths: blank(t.resetMonths) ? null : Number(t.resetMonths), anchorKey: blank(t.anchorKey) ? null : String(t.anchorKey),
        graceType: t.graceType === 'FULL' ? 'FULL' : 'PARTIAL', graceMonths: blank(t.graceMonths) ? 0 : Number(t.graceMonths)
      })),
      summary: result.summary,
      // מה שנדרש כדי לשחזר את החישוב בדיוק
      rulesVersion: R.RULES_VERSION, engineVersion: E.ENGINE_VERSION, forecastId: ctx.forecast.id, rateConvention: ctx.rateConvention,
      notes: str(input.notes, 2000, 'ההערות'),
      createdAt: new Date().toISOString()
    };
    data.mortgageLab.scenarios.push(scenario);
    await this.db.save(data);
    return scenario;
  }

  async deleteScenario(id, actor) {
    const data = await this._load();
    const target = this._scenarioFor(data, id, actor);
    data.mortgageLab.scenarios = data.mortgageLab.scenarios.filter(s => s !== target);
    await this.db.save(data);
    return true;
  }

  // לוח סילוקין חודשי מלא לתרחיש — לייצוא CSV
  async getScenarioExport(id, actor) {
    const data = await this._load();
    const s = this._scenarioFor(data, id, actor);
    const r = E.calculateMix(uiTracks(s.tracks), this._ctx(data));
    const ag = (a) => Math.round(a) / 100;
    const headers = ['חודש', 'יתרת פתיחה', 'הצמדה', 'ריבית', 'קרן', 'תשלום', 'יתרת סגירה'];
    const rows = r.schedule.map(x => [x.month, ag(x.openingAg), ag(x.indexationAg), ag(x.interestAg), ag(x.principalAg), ag(x.paymentAg), ag(x.closingAg)]);
    return { name: `תמהיל-${s.name}`.replace(/[\\/:*?"<>|]/g, '_'), headers, rows };
  }
}

module.exports = { MortgageLabService: new MortgageLabService(), retentionEvents, uiTrack, addMonths };
