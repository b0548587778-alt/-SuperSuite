// מנוע תמהיל משכנתא (הועבר מ-tamhil/packages/engine והותאם לכללי SuperSuite).
// פונקציות טהורות, אופליין. כל סכום כספי נשמר ומחושב בשלמי אגורות: בכל חודש ההצמדה,
// הריבית והקרן מעוגלות לאגורה, והיתרה נסגרת לאפס בדיוק. ריביות ומדד הם שברים (0.045 = 4.5%).
//
// סדר החישוב בכל חודש: הצמדה למדד על יתרת הפתיחה → ריבית על היתרה המוצמדת לפי הריבית
// שבתוקף (פריים לפי מסלול ריבית בנק ישראל, משתנה לפי עוגן בנקודות השינוי) → קרן לפי
// שיטת ההחזר. שפיצר וקרן שווה מחושבים מחדש בכל חודש על היתרה והתקופה שנותרו.

const { defaultRuleSet, TRACK_TYPES } = require('./mortgageRules');

const ENGINE_VERSION = '1.0.0';
const MAX_TERM_MONTHS = 600;
const REPAYMENTS = { SPITZER: 'שפיצר', EQUAL_PRINCIPAL: 'קרן שווה', BULLET: 'בלון (קרן בסוף)' };

const ALWAYS_LINKED = new Set(['FIXED_LINKED', 'VARIABLE_LINKED']);
const NEVER_LINKED = new Set(['PRIME', 'FIXED_UNLINKED', 'VARIABLE_UNLINKED']);
const FIXED_RATE = new Set(['FIXED_UNLINKED', 'FIXED_LINKED', 'ELIGIBILITY', 'BRIDGE']);

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;

class EngineInputError extends Error {
  constructor(path, message) {
    super(message);
    this.name = 'EngineInputError';
    this.path = path;
  }
}

const isVariable = (type) => type === 'VARIABLE_LINKED' || type === 'VARIABLE_UNLINKED';
// פריים ומשתנה מעוגן — נספרים לנתח הריבית המשתנה
const isFloating = (type) => type === 'PRIME' || isVariable(type);

function num(value, path, label) {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new EngineInputError(path, `${label}: ערך לא תקין`);
  return n;
}

function int(value, path, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new EngineInputError(path, `${label} חייב להיות מספר שלם בין ${min} ל-${max}`);
  return n;
}

function rate(value, path, label) {
  const r = num(value, path, label);
  if (r <= -1 || r > 1) throw new EngineInputError(path, `${label}: ריבית מחוץ לטווח`);
  return r;
}

// ---------- תחזית: ריבית בנק ישראל, מדד חודשי ועוגנים, לפי חודש מתחילת ההלוואה ----------

function series(values, path, label) {
  if (!Array.isArray(values) || values.length === 0) throw new EngineInputError(path, `${label}: סדרה ריקה`);
  if (values.length > MAX_TERM_MONTHS + 1) throw new EngineInputError(path, `${label}: סדרה ארוכה מדי`);
  return values.map((v, i) => num(v, `${path}[${i}]`, label));
}

// הערך האחרון חוזר על עצמו מעבר לאופק התחזית
const at = (s, m) => s[Math.min(m, s.length - 1)];

function createForecast(input) {
  if (!input || typeof input !== 'object') throw new EngineInputError('forecast', 'חסרה תחזית');
  const boi = series(input.boiRateAnnual, 'forecast.boiRateAnnual', 'ריבית בנק ישראל');
  const inflation = series(input.inflationMonthly, 'forecast.inflationMonthly', 'מדד חודשי');
  inflation.forEach((v, i) => { if (v <= -1) throw new EngineInputError(`forecast.inflationMonthly[${i}]`, 'מדד חודשי מחוץ לטווח'); });
  const anchors = new Map();
  for (const [key, values] of Object.entries(input.anchors || {})) anchors.set(key, series(values, `forecast.anchors.${key}`, `עוגן ${key}`));
  return {
    id: String(input.id || ''),
    publishedAt: String(input.publishedAt || ''),
    source: String(input.source || ''),
    needsVerification: input.needsVerification !== false,
    boiRate: (m) => at(boi, m),
    inflation: (m) => at(inflation, m),
    anchor: (key, m) => {
      const s = anchors.get(key);
      if (!s) throw new EngineInputError('anchorKey', `עוגן לא מוכר "${key}"`);
      return at(s, m);
    },
    hasAnchor: (key) => anchors.has(key),
    anchorKeys: () => [...anchors.keys()]
  };
}

function compoundedInflation(forecast, months) {
  let f = 1;
  for (let m = 0; m < months; m++) f *= 1 + forecast.inflation(m);
  return f - 1;
}

const annualToMonthlyInflation = (annual) => Math.pow(1 + Number(annual), 1 / 12) - 1;

// ---------- מסלולים ----------

function normalizeTrack(input, index, forecast, primeSpread) {
  const p = `tracks[${index}]`;
  const n = index + 1;
  if (!input || typeof input !== 'object') throw new EngineInputError(p, `מסלול ${n} לא תקין`);
  if (!TRACK_TYPES[input.type]) throw new EngineInputError(`${p}.type`, `מסלול ${n}: סוג מסלול לא מוכר`);
  const label = `מסלול ${n} (${TRACK_TYPES[input.type]})`;
  const repayment = input.repayment || 'SPITZER';
  if (!REPAYMENTS[repayment]) throw new EngineInputError(`${p}.repayment`, `${label}: שיטת החזר לא מוכרת`);
  const principalAg = toAg(num(input.principal, `${p}.principal`, `${label} — סכום`));
  if (principalAg <= 0 || principalAg > 1e11) throw new EngineInputError(`${p}.principal`, `${label}: הסכום חייב להיות חיובי`);
  const termMonths = int(input.termMonths, `${p}.termMonths`, `${label} — תקופה בחודשים`, 1, MAX_TERM_MONTHS);

  let grace = null;
  if (input.grace && Number(input.grace.months) > 0) {
    if (input.grace.type !== 'PARTIAL' && input.grace.type !== 'FULL') throw new EngineInputError(`${p}.grace.type`, `${label}: סוג גרייס לא מוכר`);
    grace = { type: input.grace.type, months: int(input.grace.months, `${p}.grace.months`, `${label} — חודשי גרייס`, 1, termMonths - 1) };
  }

  const isCpiLinked = input.isCpiLinked === undefined || input.isCpiLinked === null ? ALWAYS_LINKED.has(input.type) : Boolean(input.isCpiLinked);
  if (isCpiLinked && NEVER_LINKED.has(input.type)) throw new EngineInputError(`${p}.isCpiLinked`, `${label}: מסלול זה אינו צמוד למדד`);
  if (!isCpiLinked && ALWAYS_LINKED.has(input.type)) throw new EngineInputError(`${p}.isCpiLinked`, `${label}: מסלול זה צמוד למדד`);

  const has = (v) => v !== undefined && v !== null && v !== '';
  const base = { id: String(input.id || `t${n}`), type: input.type, label: TRACK_TYPES[input.type], repayment, principalAg, termMonths, isCpiLinked, grace };

  if (FIXED_RATE.has(input.type)) {
    if (!has(input.annualRate)) throw new EngineInputError(`${p}.annualRate`, `${label}: חסרה ריבית`);
    return { ...base, initialAnnualRate: rate(input.annualRate, `${p}.annualRate`, label), spread: 0, resetEveryMonths: null, anchorKey: null };
  }

  if (!has(input.spread)) throw new EngineInputError(`${p}.spread`, `${label}: חסר מרווח`);
  const spread = rate(input.spread, `${p}.spread`, `${label} — מרווח`);

  if (input.type === 'PRIME') {
    if (has(input.annualRate)) throw new EngineInputError(`${p}.annualRate`, `${label}: ריבית הפריים נגזרת מריבית בנק ישראל — יש להזין מרווח בלבד`);
    return { ...base, initialAnnualRate: forecast.boiRate(0) + primeSpread + spread, spread, resetEveryMonths: null, anchorKey: null };
  }

  const resetEveryMonths = int(input.resetEveryMonths, `${p}.resetEveryMonths`, `${label} — תדירות שינוי בחודשים`, 1, MAX_TERM_MONTHS);
  if (!input.anchorKey || !forecast.hasAnchor(input.anchorKey)) throw new EngineInputError(`${p}.anchorKey`, `${label}: עוגן לא מוכר "${input.anchorKey || ''}"`);
  const initial = has(input.annualRate) ? rate(input.annualRate, `${p}.annualRate`, label) : forecast.anchor(input.anchorKey, 0) + spread;
  return { ...base, initialAnnualRate: initial, spread, resetEveryMonths, anchorKey: input.anchorKey };
}

// הריבית השנתית שבתוקף בחודש תשלום (מ-1)
function annualRateForMonth(track, month, forecast, primeSpread) {
  if (track.type === 'PRIME') return forecast.boiRate(month - 1) + primeSpread + track.spread;
  if (track.resetEveryMonths !== null && track.anchorKey !== null) {
    const period = Math.floor((month - 1) / track.resetEveryMonths);
    if (period === 0) return track.initialAnnualRate;
    return forecast.anchor(track.anchorKey, period * track.resetEveryMonths) + track.spread;
  }
  return track.initialAnnualRate;
}

// NOMINAL: שנתית/12 (הנוהג המקובל בבנקים — לאמת). EFFECTIVE: (1+שנתית)^(1/12)−1.
const monthlyRate = (annual, convention) => (convention === 'EFFECTIVE' ? Math.pow(1 + annual, 1 / 12) - 1 : annual / 12);

// החזר קבוע (שפיצר): B·r / (1 − (1 + r)^−n)
function annuityPayment(balance, r, months) {
  if (r === 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}

function amortizeTrack(track, forecast, primeSpread, convention) {
  const rows = [];
  let balance = track.principalAg;
  for (let month = 1; month <= track.termMonths; month++) {
    const opening = balance;
    const indexation = track.isCpiLinked ? Math.round(opening * forecast.inflation(month - 1)) : 0;
    const linked = opening + indexation;
    const annual = annualRateForMonth(track, month, forecast, primeSpread);
    const r = monthlyRate(annual, convention);
    if (r <= -1) throw new EngineInputError(`tracks.${track.id}`, `הריבית בחודש ${month} מחוץ לטווח`);
    const interest = Math.round(linked * r);
    const remaining = track.termMonths - month + 1;
    let principal;
    if (track.grace && month <= track.grace.months) principal = track.grace.type === 'FULL' ? -interest : 0;
    else if (remaining === 1) principal = linked;
    else if (track.repayment === 'SPITZER') principal = Math.round(annuityPayment(linked, r, remaining)) - interest;
    else if (track.repayment === 'EQUAL_PRINCIPAL') principal = Math.round(linked / remaining);
    else principal = 0; // בלון: הקרן בסוף התקופה
    balance = linked - principal;
    rows.push({ month, annualRate: annual, openingAg: opening, indexationAg: indexation, interestAg: interest, principalAg: principal, paymentAg: interest + principal, closingAg: balance });
  }
  return rows;
}

// ---------- סיכומים ----------

// תשואה פנימית שנתית אפקטיבית של תזרימי הלווה. NPV מונוטוני בריבית, ולכן חציה מתכנסת.
function irrAnnual(principalAg, paymentsAg) {
  const npv = (m) => {
    const d = 1 / (1 + m);
    let f = 1, pv = 0;
    for (const p of paymentsAg) { f *= d; pv += p * f; }
    return principalAg - pv;
  };
  let lo = -0.5, hi = 0.5;
  if (npv(lo) > 0 || npv(hi) < 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) < 0) lo = mid; else hi = mid;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

function summarizeAg(principalAg, rows) {
  if (!rows.length) throw new EngineInputError('schedule', 'לוח הסילוקין ריק');
  let max = rows[0].paymentAg, total = 0, interest = 0, indexation = 0;
  for (const r of rows) {
    if (r.paymentAg > max) max = r.paymentAg;
    total += r.paymentAg; interest += r.interestAg; indexation += r.indexationAg;
  }
  // החזר שמחושב מחדש בכל חודש זז באגורה בגלל עיגול — החודש הראשון שמגיע למקסימום בטווח הזה
  const maxMonth = (rows.find(r => r.paymentAg >= max - 1) || rows[0]).month;
  return {
    principal: fromAg(principalAg),
    termMonths: rows.length,
    firstPayment: fromAg(rows[0].paymentAg),
    maxPayment: fromAg(max),
    maxPaymentMonth: maxMonth,
    totalPayments: fromAg(total),
    totalInterest: fromAg(interest),
    totalIndexation: fromAg(indexation),
    totalCost: fromAg(total - principalAg),
    irrAnnual: irrAnnual(principalAg, rows.map(r => r.paymentAg))
  };
}

function yearlyOf(rows) {
  const out = [];
  for (const r of rows) {
    const y = Math.ceil(r.month / 12);
    const b = out[y - 1] || (out[y - 1] = { year: y, paymentsAg: 0, principalAg: 0, interestAg: 0, indexationAg: 0, closingAg: 0 });
    b.paymentsAg += r.paymentAg; b.principalAg += r.principalAg; b.interestAg += r.interestAg; b.indexationAg += r.indexationAg; b.closingAg = r.closingAg;
  }
  return out.map(b => ({ year: b.year, payments: fromAg(b.paymentsAg), principal: fromAg(b.principalAg), interest: fromAg(b.interestAg), indexation: fromAg(b.indexationAg), closingBalance: fromAg(b.closingAg) }));
}

function aggregate(schedules) {
  const months = Math.max(...schedules.map(s => s.length));
  const rows = [];
  for (let i = 0; i < months; i++) {
    const row = { month: i + 1, openingAg: 0, indexationAg: 0, interestAg: 0, principalAg: 0, paymentAg: 0, closingAg: 0 };
    for (const s of schedules) {
      const x = s[i];
      if (!x) continue;
      row.openingAg += x.openingAg; row.indexationAg += x.indexationAg; row.interestAg += x.interestAg;
      row.principalAg += x.principalAg; row.paymentAg += x.paymentAg; row.closingAg += x.closingAg;
    }
    rows.push(row);
  }
  return rows;
}

function context(ctx) {
  if (!ctx || typeof ctx !== 'object') throw new EngineInputError('ctx', 'חסרים נתוני חישוב');
  const rules = ctx.rules || defaultRuleSet;
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const convention = ctx.rateConvention === 'EFFECTIVE' ? 'EFFECTIVE' : 'NOMINAL';
  return { rules, asOf, convention, forecast: createForecast(ctx.forecast) };
}

// חישוב תמהיל מלא: לוח לכל מסלול, לוח מאוחד, סיכומים והנחות החישוב
function calculateMix(tracks, ctx) {
  if (!Array.isArray(tracks) || tracks.length === 0) throw new EngineInputError('tracks', 'יש להזין לפחות מסלול אחד');
  if (tracks.length > 12) throw new EngineInputError('tracks', 'עד 12 מסלולים בתמהיל');
  const { rules, asOf, convention, forecast } = context(ctx);
  const primeRule = rules.get('boi.prime.spread', asOf);
  const primeSpread = primeRule.value;

  const results = tracks.map((input, i) => {
    const track = normalizeTrack(input, i, forecast, primeSpread);
    const schedule = amortizeTrack(track, forecast, primeSpread, convention);
    return { track, schedule, summary: summarizeAg(track.principalAg, schedule), yearly: yearlyOf(schedule) };
  });
  const principalAg = results.reduce((t, r) => t + r.track.principalAg, 0);
  const schedule = aggregate(results.map(r => r.schedule));

  return {
    tracks: results,
    schedule,
    summary: summarizeAg(principalAg, schedule),
    yearly: yearlyOf(schedule),
    assumptions: {
      forecastId: forecast.id,
      forecastPublishedAt: forecast.publishedAt,
      forecastSource: forecast.source,
      forecastNeedsVerification: forecast.needsVerification,
      rulesVersion: rules.version,
      engineVersion: ENGINE_VERSION,
      asOf,
      rateConvention: convention,
      boiRateAtStart: forecast.boiRate(0),
      primeSpread,
      primeSpreadNeedsVerification: primeRule.needsVerification,
      firstYearInflation: compoundedInflation(forecast, 12)
    }
  };
}

// ---------- בדיקות רגולטוריות (329) — אזהרות בלבד, לעולם לא חוסמות חישוב ----------

const WARNING_LABELS = {
  VARIABLE_SHARE: 'נתח הריבית המשתנה (כולל פריים) גבוה מהמותר',
  SHORT_RESET_SHARE: 'נתח הריבית שמשתנה בתדירות של פחות מ-5 שנים גבוה מהמותר',
  TERM: 'תקופת ההלוואה ארוכה מהמותר',
  PTI_WARNING: 'יחס ההחזר להכנסה גבוה',
  PTI_MAX: 'יחס ההחזר להכנסה חורג מהמקסימום',
  LTV: 'שיעור המימון גבוה מהמותר לסוג הרוכש'
};

function checkMix(result, checkCtx = {}) {
  const rules = checkCtx.rules || defaultRuleSet;
  const asOf = checkCtx.asOf || result.assumptions.asOf;
  const tracks = result.tracks.map(t => t.track);
  const totalAg = tracks.reduce((t, x) => t + x.principalAg, 0);
  const share = (list) => list.reduce((t, x) => t + x.principalAg, 0) / totalAg;
  const warnings = [];
  const push = (code, ruleId, limit, actual, trackIds) => warnings.push({ code, label: WARNING_LABELS[code], ruleId, limit, actual, trackIds, needsVerification: rules.get(ruleId, asOf).needsVerification });
  const EPS = 1e-9;

  const floating = tracks.filter(t => isFloating(t.type));
  const maxVariable = rules.value('boi.329.maxVariableShare', asOf);
  const variableShare = share(floating);
  if (variableShare > maxVariable + EPS) push('VARIABLE_SHARE', 'boi.329.maxVariableShare', maxVariable, variableShare, floating.map(t => t.id));

  // פריים זז עם כל החלטת ריבית — תמיד נחשב שינוי בתדירות גבוהה
  const threshold = rules.value('boi.329.shortResetThresholdMonths', asOf);
  const shortReset = floating.filter(t => t.resetEveryMonths === null || t.resetEveryMonths < threshold);
  const maxShort = rules.value('boi.329.maxShortResetVariableShare', asOf);
  const shortShare = share(shortReset);
  if (shortShare > maxShort + EPS) push('SHORT_RESET_SHARE', 'boi.329.maxShortResetVariableShare', maxShort, shortShare, shortReset.map(t => t.id));

  const maxTerm = rules.value('boi.329.maxTermMonths', asOf);
  const tooLong = tracks.filter(t => t.termMonths > maxTerm);
  if (tooLong.length) push('TERM', 'boi.329.maxTermMonths', maxTerm, Math.max(...tooLong.map(t => t.termMonths)), tooLong.map(t => t.id));

  const income = Number(checkCtx.monthlyNetIncome);
  if (Number.isFinite(income) && income > 0) {
    // מול ההחזר הצפוי הגבוה ביותר, לא רק הראשון
    const pti = result.summary.maxPayment / income;
    const ptiMax = rules.value('boi.329.ptiMax', asOf);
    const ptiWarning = rules.value('boi.329.ptiWarning', asOf);
    if (pti > ptiMax) push('PTI_MAX', 'boi.329.ptiMax', ptiMax, pti, []);
    else if (pti > ptiWarning) push('PTI_WARNING', 'boi.329.ptiWarning', ptiWarning, pti, []);
  }

  const value = Number(checkCtx.propertyValue);
  if (Number.isFinite(value) && value > 0 && checkCtx.buyerType) {
    const limits = rules.value('boi.329.maxLtv', asOf);
    const maxLtv = limits[checkCtx.buyerType];
    if (maxLtv === undefined) throw new EngineInputError('buyerType', 'סוג רוכש לא מוכר');
    const ltv = fromAg(totalAg) / value;
    if (ltv > maxLtv + EPS) push('LTV', 'boi.329.maxLtv', maxLtv, ltv, []);
  }
  return warnings;
}

// ---------- חלוקת סכום לפי חלקים: אגורות שלמות, המסלול האחרון סופג את השארית ----------

function splitAg(totalAg, weights) {
  const sumW = weights.reduce((t, w) => t + w, 0);
  let allocated = 0;
  return weights.map((w, i) => {
    const amount = i === weights.length - 1 ? totalAg - allocated : Math.floor((totalAg * w) / sumW);
    allocated += amount;
    return amount;
  });
}

// ---------- סלים אחידים (451) ----------

const UNIFORM_BASKET_KINDS = ['UNIFORM_BASKET_1', 'UNIFORM_BASKET_2', 'UNIFORM_BASKET_3'];

function buildUniformBasket(kind, params, ctx = {}) {
  const rules = ctx.rules || defaultRuleSet;
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const basket = rules.value('boi.451.uniformBaskets', asOf).find(b => b.kind === kind);
  if (!basket) throw new EngineInputError('kind', 'סל אחיד לא מוכר');
  const totalAg = toAg(num(params.principal, 'principal', 'סכום ההלוואה'));
  if (totalAg <= 0) throw new EngineInputError('principal', 'סכום ההלוואה חייב להיות חיובי');
  const amounts = splitAg(totalAg, basket.shares.map(s => s.units));
  return basket.shares.map((s, i) => {
    const pricing = (params.pricing || {})[s.trackType];
    if (!pricing) throw new EngineInputError(`pricing.${s.trackType}`, `חסר תמחור למסלול ${TRACK_TYPES[s.trackType]}`);
    const t = { id: `${kind}:${s.trackType}`, type: s.trackType, repayment: params.repayment || 'SPITZER', principal: fromAg(amounts[i]), termMonths: params.termMonths };
    for (const k of ['annualRate', 'spread', 'anchorKey']) if (pricing[k] !== undefined && pricing[k] !== '') t[k] = pricing[k];
    if (s.resetEveryMonths !== undefined) t.resetEveryMonths = s.resetEveryMonths;
    return t;
  });
}

function calculateUniformBaskets(params, ctx) {
  const rules = ctx.rules || defaultRuleSet;
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const defs = rules.value('boi.451.uniformBaskets', asOf);
  return UNIFORM_BASKET_KINDS.map(kind => {
    const def = defs.find(b => b.kind === kind);
    return { kind, label: def ? def.label : kind, result: calculateMix(buildUniformBasket(kind, params, ctx), ctx) };
  });
}

// ---------- כושר החזר: מהחזר יעד והון עצמי להלוואה ולמחיר נכס מקסימליים ----------

const REFERENCE_PRINCIPAL = 1000000;

function maxLoanForPayment(input, ctx) {
  const mix = Array.isArray(input && input.mix) ? input.mix : [];
  if (!mix.length) throw new EngineInputError('mix', 'יש להזין לפחות מסלול אחד');
  const target = num(input.targetPayment, 'targetPayment', 'החזר חודשי רצוי');
  const equity = num(input.equity, 'equity', 'הון עצמי');
  if (target <= 0) throw new EngineInputError('targetPayment', 'ההחזר החודשי הרצוי חייב להיות חיובי');
  if (equity < 0) throw new EngineInputError('equity', 'ההון העצמי אינו יכול להיות שלילי');
  const shares = mix.map((t, i) => num(t.share, `mix[${i}].share`, 'חלק המסלול'));
  const totalShare = shares.reduce((a, s) => a + s, 0);
  if (shares.some(s => s <= 0) || Math.abs(totalShare - 1) > 1e-6) throw new EngineInputError('mix', 'חלקי המסלולים חייבים להיות חיוביים ולהסתכם ב-100%');

  const amounts = splitAg(toAg(REFERENCE_PRINCIPAL), shares);
  const tracks = mix.map(({ share: _s, ...rest }, i) => ({ ...rest, principal: fromAg(amounts[i]) }));
  const reference = calculateMix(tracks, ctx);
  const basis = input.basis === 'FIRST' ? 'FIRST' : 'MAX';
  const refPayment = basis === 'MAX' ? reference.summary.maxPayment : reference.summary.firstPayment;
  const paymentPerShekel = refPayment / REFERENCE_PRINCIPAL;
  if (paymentPerShekel <= 0) throw new EngineInputError('mix', 'לתמהיל אין החזר בחודש הנבחר (למשל גרייס מלא)');

  const rules = ctx.rules || defaultRuleSet;
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const ltvRule = rules.get('boi.329.maxLtv', asOf);
  const ltvLimit = ltvRule.value[input.buyerType];
  if (ltvLimit === undefined) throw new EngineInputError('buyerType', 'סוג רוכש לא מוכר');

  const loanByPayment = target / paymentPerShekel;
  // ההון העצמי חייב לכסות (1 − LTV) מהמחיר
  const priceByLtv = ltvLimit >= 1 ? Infinity : equity / (1 - ltvLimit);
  const priceByPayment = equity + loanByPayment;
  const binding = priceByPayment <= priceByLtv ? 'PAYMENT' : 'LTV';
  const maxPropertyPrice = binding === 'PAYMENT' ? priceByPayment : priceByLtv;
  return {
    maxLoan: fromAg(toAg(maxPropertyPrice - equity)),
    maxPropertyPrice: fromAg(toAg(maxPropertyPrice)),
    binding,
    loanByPayment: fromAg(toAg(loanByPayment)),
    priceByLtv: Number.isFinite(priceByLtv) ? fromAg(toAg(priceByLtv)) : null,
    ltvLimit,
    ltvNeedsVerification: ltvRule.needsVerification,
    paymentPerShekel,
    basis
  };
}

// ---------- מחזור משכנתא ----------

function nonNegative(v, path, label) {
  if (v === undefined || v === null || v === '') return 0;
  const n = num(v, path, label);
  if (n < 0) throw new EngineInputError(path, `${label} אינו יכול להיות שלילי`);
  return toAg(n);
}

function compareRefinance(input, ctx) {
  const existing = calculateMix(input.existing, ctx);
  const proposed = calculateMix(input.proposed, ctx);
  const feeKnown = !(input.prepaymentFee === undefined || input.prepaymentFee === null || input.prepaymentFee === '');
  const upfrontAg = nonNegative(input.prepaymentFee, 'prepaymentFee', 'עמלת פירעון מוקדם') + nonNegative(input.switchingCosts, 'switchingCosts', 'עלויות מעבר');
  const months = Math.max(existing.schedule.length, proposed.schedule.length);
  let cumulative = 0, breakEvenMonth = null;
  for (let i = 0; i < months; i++) {
    cumulative += (existing.schedule[i] ? existing.schedule[i].paymentAg : 0) - (proposed.schedule[i] ? proposed.schedule[i].paymentAg : 0);
    if (breakEvenMonth === null && cumulative > 0 && cumulative >= upfrontAg) breakEvenMonth = i + 1;
  }
  const e = existing.summary, p = proposed.summary;
  return {
    existing, proposed,
    upfrontCost: fromAg(upfrontAg),
    prepaymentFeeKnown: feeKnown,
    netSavings: fromAg(toAg(e.totalPayments) - toAg(p.totalPayments) - upfrontAg),
    firstPaymentChange: fromAg(toAg(p.firstPayment) - toAg(e.firstPayment)),
    principalDifference: fromAg(toAg(p.principal) - toAg(e.principal)),
    breakEvenMonth,
    estimateOnly: true
  };
}

// ---------- השוואת אישורים עקרוניים על אותו סכום ואותה תחזית ----------

function approvalToTracks(offer, principalAg) {
  const list = Array.isArray(offer.tracks) ? offer.tracks : [];
  const shares = list.map((t, i) => num(t.share, `offers.${offer.id}.tracks[${i}].share`, 'חלק המסלול'));
  if (!list.length || shares.some(s => s <= 0) || Math.abs(shares.reduce((a, s) => a + s, 0) - 1) > 1e-6) {
    throw new EngineInputError(`offers.${offer.id}.tracks`, 'חלקי המסלולים חייבים להסתכם ב-100%');
  }
  const amounts = splitAg(principalAg, shares);
  return list.map((t, i) => {
    const track = { id: `${offer.id}:${i}`, type: t.type, repayment: t.repayment || 'SPITZER', principal: fromAg(amounts[i]), termMonths: t.termMonths };
    for (const k of ['annualRate', 'spread', 'resetEveryMonths', 'anchorKey', 'isCpiLinked']) if (t[k] !== undefined && t[k] !== '') track[k] = t[k];
    return track;
  });
}

function compareApprovals(offers, principal, ctx) {
  const amountAg = toAg(num(principal, 'principal', 'סכום ההלוואה'));
  if (amountAg <= 0) throw new EngineInputError('principal', 'סכום ההלוואה חייב להיות חיובי');
  const asOf = ctx.asOf || new Date().toISOString().slice(0, 10);
  const rows = (Array.isArray(offers) ? offers : []).map(offer => {
    const expired = Boolean(offer.validUntil) && offer.validUntil < asOf;
    const overMax = offer.maxAmount !== undefined && offer.maxAmount !== '' && offer.maxAmount !== null && amountAg > toAg(offer.maxAmount);
    try {
      const result = calculateMix(approvalToTracks(offer, amountAg), ctx);
      const feesAg = nonNegative(offer.fees, 'fees', 'עמלות');
      return { offer, result, error: null, expired, overMax, totalCostWithFees: fromAg(toAg(result.summary.totalCost) + feesAg) };
    } catch (e) {
      return { offer, result: null, error: e.message, expired, overMax, totalCostWithFees: null };
    }
  });
  const valid = rows.filter(r => r.result && !r.expired && !r.overMax);
  const rank = (key) => [...valid].sort((a, b) => key(a) - key(b)).map(r => r.offer.id);
  return { offers: rows, byTotalCost: rank(r => r.totalCostWithFees), byMaxPayment: rank(r => r.result.summary.maxPayment) };
}

// ---------- הערכת עמלת פירעון מוקדם — הערכה בלבד; רק דוח היתרה לסילוק של הבנק מחייב ----------
// עמלת היוון (מסלול בריבית קבועה, רק כשהריבית הממוצעת נמוכה מריבית החוזה), עמלת אי-הודעה
// (צמוד, בלי הודעה מוקדמת) ועמלה תפעולית. עמלת הפרשי מדד אינה ממודלת — היא מסומנת כחסרה.

const PREPAYMENT_GAPS = {
  AVERAGE_RATE_UNKNOWN: 'לא הוזנה ריבית ממוצעת — עמלת ההיוון לא חושבה',
  CPI_AVERAGE_FEE_NOT_MODELLED: 'עמלת הפרשי מדד אינה מחושבת',
  RULES_UNVERIFIED: 'כללי העמלה טרם אומתו'
};

function pvAnnuityAg(paymentAg, r, n) {
  if (n <= 0) return 0;
  if (r === 0) return paymentAg * n;
  return (paymentAg * (1 - Math.pow(1 + r, -n))) / r;
}

function discountFor(monthsElapsed, tiers) {
  let best = 0, bestFrom = -1;
  for (const t of Array.isArray(tiers) ? tiers : []) {
    if (monthsElapsed >= t.fromMonthsElapsed && t.fromMonthsElapsed > bestFrom) { best = Number(t.discount); bestFrom = t.fromMonthsElapsed; }
  }
  if (!(best >= 0 && best <= 1)) throw new EngineInputError('rules.capitalizationDiscounts', 'הנחה חייבת להיות בין 0 ל-1');
  return best;
}

function prepaymentRulesFrom(rules, asOf) {
  const ids = ['prepayment.operationalFee', 'prepayment.noticeFeeRate', 'prepayment.capitalizationDiscounts'];
  return {
    operationalFee: rules.value(ids[0], asOf),
    noticeFeeRate: rules.value(ids[1], asOf),
    capitalizationDiscounts: rules.value(ids[2], asOf),
    needsVerification: ids.some(id => rules.get(id, asOf).needsVerification)
  };
}

function estimatePrepaymentFee(tracks, prules) {
  const gaps = new Set();
  if (prules.needsVerification) gaps.add('RULES_UNVERIFIED');
  const out = (Array.isArray(tracks) ? tracks : []).map((t, i) => {
    const path = `tracks.${i}`;
    const label = `מסלול ${i + 1}`;
    const balanceAg = nonNegative(t.balance, `${path}.balance`, `${label} — יתרה`);
    const paymentAg = nonNegative(t.monthlyPayment, `${path}.monthlyPayment`, `${label} — החזר חודשי`);
    const contract = rate(t.contractRate, `${path}.contractRate`, `${label} — ריבית החוזה`);
    const remaining = int(t.remainingPayments, `${path}.remainingPayments`, `${label} — תשלומים שנותרו`, 0, MAX_TERM_MONTHS);
    const trackGaps = [];
    let capAg = 0, discount = 0;
    if (t.isFixedRate && remaining > 0) {
      if (t.averageMarketRate === undefined || t.averageMarketRate === null || t.averageMarketRate === '') trackGaps.push('AVERAGE_RATE_UNKNOWN');
      else {
        const market = rate(t.averageMarketRate, `${path}.averageMarketRate`, `${label} — ריבית ממוצעת`);
        if (market < contract) {
          // ריבית השוק נמוכה מריבית החוזה → המלווה מפסיד את הפרש הערך הנוכחי
          const diff = pvAnnuityAg(paymentAg, market / 12, remaining) - pvAnnuityAg(paymentAg, contract / 12, remaining);
          discount = discountFor(Number(t.monthsElapsed) || 0, prules.capitalizationDiscounts);
          capAg = Math.round(Math.max(0, diff) * (1 - discount));
        }
      }
    }
    if (t.isCpiLinked) trackGaps.push('CPI_AVERAGE_FEE_NOT_MODELLED');
    const noticeAg = t.isCpiLinked && !t.noticeGiven ? Math.round(balanceAg * Number(prules.noticeFeeRate)) : 0;
    trackGaps.forEach(g => gaps.add(g));
    return { id: String(t.id || `t${i + 1}`), capitalizationFee: fromAg(capAg), discountApplied: discount, noticeFee: fromAg(noticeAg), total: fromAg(capAg + noticeAg), gaps: trackGaps };
  });
  const opAg = out.length ? toAg(prules.operationalFee) : 0;
  const totalAg = out.reduce((s, t) => s + toAg(t.total), opAg);
  return { tracks: out, operationalFee: fromAg(opAg), total: fromAg(totalAg), gaps: [...gaps], gapLabels: [...gaps].map(g => PREPAYMENT_GAPS[g]), estimateOnly: true };
}

// ---------- אופטימייזר תמהיל — המלצה בלבד, לא החלטה ----------
// סורק רשת חלוקות של אבני הבניין שהיועץ תמחר, מריץ כל מועמד במנוע, פוסל מועמדים שחורגים
// ממגבלה או מתקרת ההחזר, ומחזיר את המובילים.

const BLOCKING = new Set(['VARIABLE_SHARE', 'SHORT_RESET_SHARE', 'TERM', 'PTI_MAX', 'LTV']);
const MAX_CANDIDATES = 5000;

// ranges: [[lo, hi], ...] ביחידות של צעד, לכל אבן בניין. הגבולות נאכפים בתוך הרקורסיה —
// בלי זה נוצרו כל החלוקות (6 אבנים בצעד 1% = 96 מיליון) לפני הסינון, והתהליך נגמר מזיכרון
function shareGrid(n, units, ranges = null) {
  const lo = (i) => (ranges ? ranges[i][0] : 0);
  const hi = (i) => (ranges ? ranges[i][1] : units);
  const out = [];
  const walk = (i, left, acc) => {
    if (i === n - 1) { if (left >= lo(i) && left <= hi(i)) out.push([...acc, left]); return; }
    for (let x = Math.min(left, hi(i)); x >= lo(i); x--) walk(i + 1, left - x, [...acc, x]);
  };
  walk(0, units, []);
  return out;
}

// מספר החלוקות בגבולות — בלי ליצור אותן (תכנון דינמי, לכל היותר 6 × 101 × 101)
function countShareGrid(n, units, ranges) {
  let ways = Array.from({ length: units + 1 }, (_, s) => (s === 0 ? 1 : 0));
  for (let i = 0; i < n; i++) {
    const next = new Array(units + 1).fill(0);
    for (let s = 0; s <= units; s++) {
      if (!ways[s]) continue;
      for (let x = ranges[i][0]; x <= ranges[i][1] && s + x <= units; x++) next[s + x] += ways[s];
    }
    ways = next;
  }
  return ways[units];
}

function optimizeMix(input, ctx) {
  const blocks = Array.isArray(input && input.blocks) ? input.blocks : [];
  const n = blocks.length;
  if (n < 1 || n > 6) throw new EngineInputError('blocks', 'יש להזין בין 1 ל-6 אבני בניין');
  const principalAg = toAg(num(input.principal, 'principal', 'סכום ההלוואה'));
  if (principalAg <= 0) throw new EngineInputError('principal', 'סכום ההלוואה חייב להיות חיובי');
  const step = input.step === undefined || input.step === '' ? 0.1 : num(input.step, 'step', 'צעד');
  const u = Math.round(1 / step);
  if (!(step > 0) || Math.abs(u * step - 1) > 1e-9 || u < 1 || u > 100) throw new EngineInputError('step', 'הצעד חייב לחלק את 100% לכל היותר ל-100 חלקים שווים');
  const objective = ['TOTAL_COST', 'MAX_PAYMENT', 'TOTAL_COST_WITH_PAYMENT_CAP'].includes(input.objective) ? input.objective : 'TOTAL_COST';
  const hasCap = !(input.maxMonthlyPayment === undefined || input.maxMonthlyPayment === null || input.maxMonthlyPayment === '');
  if (objective === 'TOTAL_COST_WITH_PAYMENT_CAP' && !hasCap) throw new EngineInputError('maxMonthlyPayment', 'יש להזין תקרת החזר חודשי');
  const capAg = hasCap ? toAg(num(input.maxMonthlyPayment, 'maxMonthlyPayment', 'תקרת החזר')) : null;
  const bounds = blocks.map(b => ({ min: b.minShare === undefined || b.minShare === '' ? 0 : Number(b.minShare), max: b.maxShare === undefined || b.maxShare === '' ? 1 : Number(b.maxShare) }));
  // הגבולות ביחידות של צעד (x / u בין min ל-max, באותה סבילות כמו קודם). גבול לא מספרי — אין מועמדים
  const ranges = bounds.map(b => (Number.isFinite(b.min) && Number.isFinite(b.max)
    ? [Math.max(0, Math.ceil(b.min * u - 1e-9 * u)), Math.min(u, Math.floor(b.max * u + 1e-9 * u))]
    : [1, 0]));
  const count = countShareGrid(n, u, ranges);
  if (count > MAX_CANDIDATES) throw new EngineInputError('step', `יותר מדי מועמדים (${count}) — הגדל את הצעד או הפחת אבני בניין`);
  const grid = shareGrid(n, u, ranges);

  const checkCtx = { ...(input.checks || {}), asOf: ctx.asOf, rules: ctx.rules };
  const accepted = [];
  let rejected = 0;
  for (const g of grid) {
    const active = g.map((x, i) => ({ x, i })).filter(a => a.x > 0);
    const amounts = splitAg(principalAg, active.map(a => a.x));
    const tracks = active.map((a, k) => ({ ...blocks[a.i].track, id: `block-${a.i}`, principal: fromAg(amounts[k]) }));
    const result = calculateMix(tracks, ctx);
    const warnings = checkMix(result, checkCtx);
    if (warnings.some(w => BLOCKING.has(w.code)) || (capAg !== null && toAg(result.summary.maxPayment) > capAg)) { rejected++; continue; }
    const score = objective === 'MAX_PAYMENT' ? result.summary.maxPayment : result.summary.totalPayments;
    accepted.push({ shares: g.map(x => x / u), summary: result.summary, warnings, score });
  }
  accepted.sort((a, b) => a.score - b.score || a.summary.maxPayment - b.summary.maxPayment);
  const top = Number.isInteger(Number(input.top)) && Number(input.top) > 0 ? Math.min(Number(input.top), 20) : 5;
  return { candidates: accepted.slice(0, top), evaluated: grid.length, rejected, recommendationOnly: true };
}

// ---------- תחזית ברירת מחדל: נתוני הדגמה בלבד, לא תחזית ולא נתוני בנק ישראל ----------

const DEMO_FORECAST = Object.freeze({
  id: 'demo-2026-10',
  publishedAt: '2026-10-01',
  source: 'נתוני הדגמה בלבד — אינם תחזית. יש להחליף בתחזית ממקור מאומת.',
  needsVerification: true,
  boiRateAnnual: [0.0425, 0.0425, 0.0425, 0.0425, 0.0425, 0.0425, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.0375],
  inflationMonthly: [annualToMonthlyInflation(0.025)],
  anchors: { GOV_BOND_5Y: [...Array(60).fill(0.03), 0.0325] }
});

module.exports = {
  ENGINE_VERSION, MAX_TERM_MONTHS, REPAYMENTS, TRACK_TYPES, WARNING_LABELS, PREPAYMENT_GAPS, UNIFORM_BASKET_KINDS, DEMO_FORECAST,
  EngineInputError, isVariable, isFloating,
  createForecast, compoundedInflation, annualToMonthlyInflation, normalizeTrack, annualRateForMonth, monthlyRate, annuityPayment,
  amortizeTrack, irrAnnual, calculateMix, checkMix, splitAg, buildUniformBasket, calculateUniformBaskets,
  maxLoanForPayment, compareRefinance, approvalToTracks, compareApprovals, discountFor, prepaymentRulesFrom, estimatePrepaymentFee,
  shareGrid, countShareGrid, optimizeMix
};
