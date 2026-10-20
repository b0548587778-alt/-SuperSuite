// תזרים פרויקט ליזם — פונקציות טהורות, סכומים בשלמי אגורות, אחוזים בנקודות בסיס.
// עלויות (קרקע, בנייה, היתרים, מימון ועוד) נפרסות שווה בשווה על טווח חודשים; מכירות נגבות לפי לוח תשלומים
// (אחוז ← חודשים מהמכירה). ריבית על יתרה שלילית (אשראי ליווי) — רשות, מחושבת חודש בחודש על היתרה.
// התוצאה: טבלה חודשית, יתרה מצטברת, שיא הגירעון, רווח ואחוז רווח. הכול הערכה לפי מה שהוזן.

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const pct2 = (x) => Math.round(x * 100) / 100;

const COST_CATEGORIES = { land: 'קרקע', build: 'בנייה', permits: 'היתרים ואגרות', finance: 'מימון', marketing: 'שיווק ומכירה', other: 'אחר' };
const MAX_MONTHS = 120;
const MAX_ITEMS = 100;
const MAX_INSTALLMENTS = 24;
const MAX_PROJECTS = 200;

function amount(v, label) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0 || n > 1e11) throw new Error(`${label} אינו תקין`);
  return toAg(n);
}

function monthNo(v, label, min = 1, max = MAX_MONTHS) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} חייב להיות מספר שלם בין ${min} ל-${max}`);
  return n;
}

// לוח תשלומים: שורה "אחוז, חודשים מהמכירה". 0 — בחודש המכירה. הסכום חייב להיות 100%.
function parsePlan(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const [i, line] of lines.entries()) {
    const m = line.match(/^([\d.]+)\s*%?\s*[,;\t]\s*(\d+)$/);
    if (!m) {
      if (!/\d/.test(line)) continue; // כותרת
      throw new Error(`לוח התשלומים, שורה ${i + 1}: צריך אחוז וחודשים מהמכירה, מופרדים בפסיק`);
    }
    const pct = Number(m[1]);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error(`לוח התשלומים, שורה ${i + 1}: האחוז אינו תקין`);
    out.push({ bp: Math.round(pct * 100), after: Number(m[2]) });
  }
  return validatePlan(out);
}

function validatePlan(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('לוח התשלומים ריק');
  if (list.length > MAX_INSTALLMENTS) throw new Error(`עד ${MAX_INSTALLMENTS} תשלומים בלוח`);
  for (const p of list) {
    if (!Number.isSafeInteger(p.bp) || p.bp <= 0 || p.bp > 10000) throw new Error('אחוז בלוח התשלומים אינו תקין');
    if (!Number.isInteger(p.after) || p.after < 0 || p.after > MAX_MONTHS) throw new Error('מספר החודשים בלוח התשלומים אינו תקין');
  }
  const sum = list.reduce((s, p) => s + p.bp, 0);
  if (sum !== 10000) throw new Error(`לוח התשלומים מסתכם ב-${sum / 100}% — צריך 100%`);
  return list.map(p => ({ bp: p.bp, after: p.after })).sort((a, b) => a.after - b.after);
}

function planText(plan) {
  return plan.map(p => `${p.bp / 100}, ${p.after}`).join('\n');
}

function validateProject(input) {
  const x = input && typeof input === 'object' ? input : {};
  const name = clip(x.name, 120);
  if (!name) throw new Error('יש לתת שם לפרויקט');
  const startMonth = String(x.startMonth || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new Error('חודש ההתחלה אינו תקין');
  const months = monthNo(x.months, 'משך הפרויקט בחודשים');
  const rate = x.deficitRate === undefined || x.deficitRate === '' ? 0 : Number(x.deficitRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error('הריבית על היתרה השלילית אינה תקינה');
  const equityAg = x.equity === undefined || x.equity === '' ? 0 : amount(x.equity, 'ההון העצמי');
  const plan = x.planText !== undefined ? parsePlan(x.planText) : validatePlan(x.plan);

  const costs = (Array.isArray(x.costs) ? x.costs : []).filter(c => c && (clip(c.label, 1) || (c.amount !== undefined && c.amount !== '')));
  const sales = (Array.isArray(x.sales) ? x.sales : []).filter(s => s && (clip(s.label, 1) || (s.price !== undefined && s.price !== '')));
  if (costs.length > MAX_ITEMS || sales.length > MAX_ITEMS) throw new Error(`עד ${MAX_ITEMS} שורות עלות ו-${MAX_ITEMS} מכירות`);
  const outCosts = costs.map((c, i) => {
    const n = `עלות ${i + 1}`;
    const category = COST_CATEGORIES[c.category] ? c.category : '';
    if (!category) throw new Error(`${n}: יש לבחור סוג`);
    const from = monthNo(c.from, `${n}: חודש ההתחלה`, 1, months);
    const spread = monthNo(c.spread === undefined || c.spread === '' ? 1 : c.spread, `${n}: מספר החודשים`, 1, MAX_MONTHS);
    if (from + spread - 1 > months) throw new Error(`${n}: נמשכת אחרי סוף הפרויקט (חודש ${months})`);
    return { label: clip(c.label, 80) || COST_CATEGORIES[category], category, amountAg: amount(c.amount, `${n}: הסכום`), from, spread };
  });
  const outSales = sales.map((s, i) => {
    const n = `מכירה ${i + 1}`;
    const units = s.units === undefined || s.units === '' ? 1 : monthNo(s.units, `${n}: מספר היחידות`, 1, 1000);
    return { label: clip(s.label, 80) || n, units, priceAg: amount(s.price, `${n}: המחיר`), month: monthNo(s.month, `${n}: חודש המכירה`, 1, months) };
  });
  return { name, startMonth, months, deficitBp: Math.round(rate * 100), equityAg, plan, costs: outCosts, sales: outSales, notes: clip(x.notes, 1000) };
}

function monthLabel(startMonth, i) {
  const [y, m] = startMonth.split('-').map(Number);
  const t = y * 12 + (m - 1) + i;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}

// חלוקה שווה בשלמי אגורות: השארית בחודש האחרון, כך שהסכום נשמר בדיוק
function spreadEven(totalAg, n) {
  const base = Math.floor(totalAg / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalAg - base * (n - 1) : base));
}

// גבייה לפי לוח: כל תשלום מעוגל לאגורה, והאחרון משלים את המחיר
function installments(priceAg, plan) {
  let left = priceAg;
  return plan.map((p, i) => {
    const ag = i === plan.length - 1 ? left : Math.round(priceAg * p.bp / 10000);
    left -= ag;
    return { after: p.after, ag };
  });
}

function cashflow(input) {
  const x = validateProject(input);
  const warnings = [];
  // אופק: עד סוף הפרויקט, או עד התשלום האחרון מהמכירות אם הוא מאוחר יותר
  const lastPay = x.sales.reduce((m, s) => Math.max(m, s.month + x.plan[x.plan.length - 1].after), 0);
  const horizon = Math.max(x.months, lastPay);
  if (horizon > MAX_MONTHS + x.months) throw new Error('האופק ארוך מדי');
  if (lastPay > x.months) warnings.push(`חלק מהגבייה מהמכירות נכנס אחרי סוף הפרויקט (עד חודש ${lastPay}) — הטבלה הוארכה`);

  const rows = Array.from({ length: horizon }, (_, i) => ({
    index: i + 1, month: monthLabel(x.startMonth, i),
    byCategory: Object.fromEntries(Object.keys(COST_CATEGORIES).map(k => [k, 0])), costAg: 0, incomeAg: 0, interestAg: 0
  }));
  for (const c of x.costs) {
    spreadEven(c.amountAg, c.spread).forEach((ag, k) => {
      const r = rows[c.from - 1 + k];
      r.byCategory[c.category] += ag;
      r.costAg += ag;
    });
  }
  for (const s of x.sales) {
    for (const p of installments(s.priceAg * s.units, x.plan)) rows[s.month - 1 + p.after].incomeAg += p.ag;
  }
  // יתרה מצטברת (בלי ההון העצמי — כדי שהגירעון יראה כמה כסף הפרויקט צריך). ריבית על יתרה שלילית בסוף כל חודש.
  let bal = 0;
  let peak = { ag: 0, index: 0, month: '' };
  for (const r of rows) {
    bal += r.incomeAg - r.costAg;
    if (bal < 0 && x.deficitBp) {
      r.interestAg = Math.round(-bal * x.deficitBp / 10000 / 12);
      bal -= r.interestAg;
    }
    r.netAg = r.incomeAg - r.costAg - r.interestAg;
    r.balanceAg = bal;
    if (bal < peak.ag) peak = { ag: bal, index: r.index, month: r.month };
  }
  // נקודת איזון: החודש שאחריו היתרה לא חוזרת מתחת לאפס
  let breakEven = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].balanceAg < 0) break;
    breakEven = rows[i];
  }
  if (breakEven && breakEven.index === 1 && peak.ag === 0) breakEven = null;

  const costByCategory = Object.fromEntries(Object.keys(COST_CATEGORIES).map(k => [k, rows.reduce((s, r) => s + r.byCategory[k], 0)]));
  const interestAg = rows.reduce((s, r) => s + r.interestAg, 0);
  const directCostAg = rows.reduce((s, r) => s + r.costAg, 0);
  const totalCostAg = directCostAg + interestAg;
  const revenueAg = rows.reduce((s, r) => s + r.incomeAg, 0);
  const profitAg = revenueAg - totalCostAg;
  const peakDeficitAg = -peak.ag;
  const fundingGapAg = Math.max(0, peakDeficitAg - x.equityAg);
  if (!x.costs.length) warnings.push('לא הוזנו עלויות');
  if (!x.sales.length) warnings.push('לא הוזנו מכירות — אין הכנסות בתזרים');
  if (profitAg < 0) warnings.push('הפרויקט בהפסד לפי הנתונים שהוזנו');
  if (fundingGapAg > 0) warnings.push(`שיא הגירעון גבוה מההון העצמי ב-${fromAg(fundingGapAg).toLocaleString('he-IL')} ₪ — צריך מימון נוסף`);
  if (rows[rows.length - 1].balanceAg < 0) warnings.push('בסוף התקופה היתרה המצטברת עדיין שלילית');

  const sh = (ag) => fromAg(ag);
  return {
    input: x, horizon,
    rows: rows.map(r => ({
      index: r.index, month: r.month, cost: sh(r.costAg), income: sh(r.incomeAg), interest: sh(r.interestAg), net: sh(r.netAg), balance: sh(r.balanceAg),
      costAg: r.costAg, incomeAg: r.incomeAg, interestAg: r.interestAg, netAg: r.netAg, balanceAg: r.balanceAg,
      byCategory: Object.fromEntries(Object.entries(r.byCategory).map(([k, v]) => [k, sh(v)]))
    })),
    costByCategory: Object.entries(costByCategory).filter(([, v]) => v).map(([k, v]) => ({ category: k, label: COST_CATEGORIES[k], amount: sh(v), amountAg: v })),
    revenueAg, directCostAg, interestAg, totalCostAg, profitAg, peakDeficitAg, fundingGapAg, equityAg: x.equityAg,
    revenue: sh(revenueAg), directCost: sh(directCostAg), interest: sh(interestAg), totalCost: sh(totalCostAg), profit: sh(profitAg),
    peakDeficit: sh(peakDeficitAg), fundingGap: sh(fundingGapAg), equity: sh(x.equityAg),
    peakMonth: peakDeficitAg ? peak.month : '',
    breakEvenMonth: breakEven ? breakEven.month : '',
    // רווח על העלות (המקובל בליווי בנקאי) ועל ההכנסות
    profitOnCostPct: totalCostAg ? pct2(profitAg / totalCostAg * 100) : null,
    profitOnRevenuePct: revenueAg ? pct2(profitAg / revenueAg * 100) : null,
    warnings,
    assumptions: 'הסכומים כפי שהוזנו (עם או בלי מע"מ — לפי ההזנה). עלות נפרסת שווה בשווה על החודשים שלה. הריבית מחושבת על היתרה השלילית בסוף כל חודש, בלי עמלות ליווי וערבויות. לא נכללו: מס שבח, מס הכנסה, הצמדה למדד תשומות הבנייה ועיכובים.'
  };
}

// פרויקט שמור: הקלט כפי שהוזן (שקלים), אחרי בדיקה מלאה
function projectRecord(input) {
  const x = validateProject(input);
  return {
    name: x.name, startMonth: x.startMonth, months: x.months, deficitRate: x.deficitBp / 100, equity: fromAg(x.equityAg),
    planText: planText(x.plan), notes: x.notes,
    costs: x.costs.map(c => ({ label: c.label, category: c.category, amount: fromAg(c.amountAg), from: c.from, spread: c.spread })),
    sales: x.sales.map(s => ({ label: s.label, units: s.units, price: fromAg(s.priceAg), month: s.month }))
  };
}

module.exports = {
  COST_CATEGORIES, MAX_MONTHS, MAX_ITEMS, MAX_PROJECTS,
  parsePlan, validatePlan, planText, validateProject, monthLabel, spreadEven, installments, cashflow, projectRecord
};
