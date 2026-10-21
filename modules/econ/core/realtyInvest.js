// כדאיות השקעה בנדל"ן ומס רכישה — פונקציות טהורות, סכומים בשלמי אגורות.
// מס רכישה: אין בקוד שום מדרגה. הטבלה לכל שנה וסוג רוכש מוקלדת או נטענת מקובץ על ידי המשתמש,
// ונשארת "לא מאומתת" עד שמנהל מסמן שבדק אותה מול רשות המסים. חישוב עם טבלה לא מאומתת — "הערכה".

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const pct2 = (x) => Math.round(x * 100) / 100;

// ---------- טבלאות מס רכישה ----------
const TAX_KINDS = { single: 'דירה יחידה', additional: 'דירה נוספת', other: 'אחר' };
const MAX_BRACKETS = 20;
const MAX_TABLES = 200;

// טקסט ← מדרגות. שורה: "עד סכום, שיעור%". המפריד — האחרון בשורה (פסיק / נקודה-פסיק / טאב),
// כך שסכום עם פסיקי אלפים ואחריו ", 3.5" נקרא נכון. בשורה האחרונה הסכום ריק או "מעל" — ללא תקרה.
function parseBrackets(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const [i, line] of lines.entries()) {
    const m = line.match(/^(.*)[,;\t]\s*([^,;\t]*)$/);
    if (!m) {
      if (!/\d/.test(line)) continue; // כותרת
      throw new Error(`שורה ${i + 1}: צריך סכום ושיעור, מופרדים בפסיק`);
    }
    const rateRaw = m[2].replace(/[%\s]/g, '');
    const capRaw = m[1].replace(/[₪\s]/g, '');
    if (!/\d/.test(rateRaw) && !/\d/.test(capRaw)) continue; // כותרת
    const rate = Number(rateRaw);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`שורה ${i + 1}: השיעור אינו תקין`);
    const open = capRaw === '' || /מעל|ומעלה|יתרה/.test(capRaw);
    const cap = open ? null : Number(capRaw.replace(/,/g, ''));
    if (!open && (!Number.isFinite(cap) || cap <= 0)) throw new Error(`שורה ${i + 1}: הסכום אינו תקין`);
    out.push({ upToAg: open ? null : toAg(cap), bp: Math.round(rate * 100) });
  }
  return validateBrackets(out);
}

function validateBrackets(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('הטבלה ריקה — יש להזין לפחות מדרגה אחת');
  if (list.length > MAX_BRACKETS) throw new Error(`עד ${MAX_BRACKETS} מדרגות`);
  let prev = 0;
  list.forEach((b, i) => {
    const last = i === list.length - 1;
    if (!Number.isSafeInteger(b.bp) || b.bp < 0 || b.bp > 10000) throw new Error(`מדרגה ${i + 1}: השיעור אינו תקין`);
    if (last) {
      if (b.upToAg !== null) throw new Error('במדרגה האחרונה הסכום ריק (ללא תקרה)');
    } else {
      if (!Number.isSafeInteger(b.upToAg) || b.upToAg <= prev) throw new Error(`מדרגה ${i + 1}: הסכומים חייבים לעלות מדרגה למדרגה`);
      prev = b.upToAg;
    }
  });
  return list.map(b => ({ upToAg: b.upToAg, bp: b.bp }));
}

function validateTaxTable(input) {
  if (!input || typeof input !== 'object') throw new Error('טבלה לא תקינה');
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('שנת התוקף אינה תקינה');
  const kind = TAX_KINDS[input.kind] ? input.kind : '';
  if (!kind) throw new Error('יש לבחור סוג רוכש');
  const brackets = input.bracketsText !== undefined ? parseBrackets(input.bracketsText) : validateBrackets(input.brackets);
  const validFrom = input.validFrom ? String(input.validFrom) : '';
  if (validFrom && !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error('תאריך התחולה אינו תקין');
  return { year, kind, brackets, validFrom, source: clip(input.source, 300) };
}

function bracketsText(brackets) {
  return brackets.map(b => `${b.upToAg === null ? 'מעל' : fromAg(b.upToAg)}, ${b.bp / 100}`).join('\n');
}

function taxTableView(t) {
  const verified = !!t.verifiedAt;
  return {
    id: t.id, year: t.year, kind: t.kind, kindLabel: TAX_KINDS[t.kind], validFrom: t.validFrom || '', source: t.source || '',
    brackets: t.brackets.map((b, i) => ({ from: i ? fromAg(t.brackets[i - 1].upToAg) : 0, upTo: b.upToAg === null ? null : fromAg(b.upToAg), ratePct: b.bp / 100 })),
    bracketsText: bracketsText(t.brackets), verified, verifiedAt: t.verifiedAt || '', verifyNote: t.verifyNote || '',
    statusLabel: verified ? 'אומת' : `לא מאומת · ${t.year}`
  };
}

// מס מדורג: כל מדרגה מעוגלת לאגורה, והסה"כ הוא סכום השורות (כך שהתצוגה מסתכמת בדיוק)
function purchaseTax(priceAg, table) {
  if (!Number.isSafeInteger(priceAg) || priceAg < 0) throw new Error('מחיר הנכס אינו תקין');
  let prev = 0;
  const lines = [];
  for (const b of table.brackets) {
    const top = b.upToAg === null ? priceAg : Math.min(priceAg, b.upToAg);
    if (top > prev) {
      const taxAg = Math.round((top - prev) * b.bp / 10000);
      lines.push({ fromAg: prev, toAg: top, bp: b.bp, taxAg });
    }
    if (b.upToAg === null || priceAg <= b.upToAg) break;
    prev = b.upToAg;
  }
  const taxAg = lines.reduce((t, l) => t + l.taxAg, 0);
  return { taxAg, lines, effectivePct: priceAg ? pct2(taxAg / priceAg * 100) : 0 };
}

// הטבלה לשנה ולסוג. בלי התאמה — null (לא נלקחת שנה אחרת בשקט)
function findTable(tables, year, kind) {
  return (tables || []).find(t => t.year === Number(year) && t.kind === kind) || null;
}

// ---------- כדאיות השקעה ----------
function amount(v, label, max = 1e10) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} אינו תקין`);
  return toAg(n);
}

function validateInvestment(input) {
  const x = input && typeof input === 'object' ? input : {};
  const priceAg = amount(x.price, 'מחיר הנכס');
  if (!priceAg) throw new Error('מחיר הנכס חובה');
  const rate = x.loanRate === undefined || x.loanRate === '' ? 0 : Number(x.loanRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error('הריבית אינה תקינה');
  const years = x.loanYears === undefined || x.loanYears === '' ? 0 : Number(x.loanYears);
  if (!Number.isInteger(years) || years < 0 || years > 40) throw new Error('תקופת ההלוואה אינה תקינה');
  const occupied = x.occupiedMonths === undefined || x.occupiedMonths === '' ? 12 : Number(x.occupiedMonths);
  if (!Number.isFinite(occupied) || occupied < 0 || occupied > 12) throw new Error('מספר חודשי ההשכרה בשנה חייב להיות בין 0 ל-12');
  const out = {
    priceAg, taxYear: x.taxYear ? Number(x.taxYear) : null, taxKind: TAX_KINDS[x.taxKind] ? x.taxKind : '',
    manualTaxAg: x.manualTax === undefined || x.manualTax === '' ? null : amount(x.manualTax, 'מס הרכישה'),
    lawyerAg: amount(x.lawyer, 'שכר עורך הדין'), brokerageAg: amount(x.brokerage, 'דמי התיווך'),
    renovationAg: amount(x.renovation, 'עלות השיפוץ'), otherCostsAg: amount(x.otherCosts, 'עלויות אחרות'),
    loanAg: amount(x.loan, 'סכום ההלוואה'), loanRate: rate, loanYears: years,
    monthlyRentAg: amount(x.monthlyRent, 'שכר הדירה', 1e7), occupiedMonths: Math.round(occupied * 2) / 2,
    monthlyExpensesAg: amount(x.monthlyExpenses, 'ההוצאות החודשיות', 1e7)
  };
  if (out.loanAg && !out.loanYears) throw new Error('יש להזין תקופה להלוואה');
  if (out.taxYear !== null && (!Number.isInteger(out.taxYear) || out.taxYear < 2000 || out.taxYear > 2100)) throw new Error('שנת המס אינה תקינה');
  return out;
}

// החזר חודשי בשפיצר, מעוגל לאגורה. ריבית 0 — חלוקה שווה
function monthlyPayment(loanAg, ratePct, years) {
  const n = years * 12;
  if (!loanAg || !n) return 0;
  const r = ratePct / 100 / 12;
  return Math.round(r === 0 ? loanAg / n : loanAg * r / (1 - Math.pow(1 + r, -n)));
}

function investment(input, tables = []) {
  const x = validateInvestment(input);
  const warnings = [];
  let tax = { taxAg: 0, lines: [], effectivePct: 0 };
  let taxSource = 'none';
  if (x.manualTaxAg !== null) {
    tax = { taxAg: x.manualTaxAg, lines: [], effectivePct: pct2(x.manualTaxAg / x.priceAg * 100) };
    taxSource = 'manual';
  } else if (x.taxYear && x.taxKind) {
    const t = findTable(tables, x.taxYear, x.taxKind);
    if (!t) warnings.push(`אין טבלת מס רכישה ל${TAX_KINDS[x.taxKind]} בשנת ${x.taxYear} — מס הרכישה לא נכלל. אפשר להזין טבלה או סכום ידני`);
    else {
      tax = purchaseTax(x.priceAg, t);
      taxSource = t.verifiedAt ? 'verified' : 'unverified';
      if (!t.verifiedAt) warnings.push(`מס הרכישה לפי טבלה שלא אומתה (לא מאומת · ${t.year}) — הערכה בלבד`);
      // הטבלה נבחרת לפי השנה בלבד. מדרגות שהתעדכנו באמצע השנה — עסקה שלפני תאריך התחולה שייכת לטבלה הקודמת (בדיקת קוד 21.10.2026)
      if (t.validFrom && t.validFrom > `${t.year}-01-01`) warnings.push(`טבלת מס הרכישה לשנת ${t.year} חלה מ-${t.validFrom} — לעסקה שנחתמה לפני תאריך זה חלות מדרגות אחרות. יש לבדוק את הטבלה או להזין סכום ידני`);
    }
  } else warnings.push('לא נבחרה טבלת מס רכישה — מס הרכישה לא נכלל');

  const totalCostAg = x.priceAg + tax.taxAg + x.lawyerAg + x.brokerageAg + x.renovationAg + x.otherCostsAg;
  if (x.loanAg > totalCostAg) throw new Error('סכום ההלוואה גדול מהעלות הכוללת');
  const equityAg = totalCostAg - x.loanAg;
  const paymentAg = monthlyPayment(x.loanAg, x.loanRate, x.loanYears);
  const annualRentAg = Math.round(x.monthlyRentAg * x.occupiedMonths);
  const annualExpensesAg = x.monthlyExpensesAg * 12;
  const noiAg = annualRentAg - annualExpensesAg;
  const annualDebtAg = paymentAg * 12;
  const cashFlowAg = noiAg - annualDebtAg;
  const hasRent = annualRentAg > 0;
  if (hasRent && cashFlowAg < 0) warnings.push('התזרים השנתי שלילי — שכר הדירה לא מכסה את ההוצאות וההחזר');
  return {
    input: x, taxSource, tax: { ...tax, tax: fromAg(tax.taxAg), lines: tax.lines.map(l => ({ from: fromAg(l.fromAg), to: fromAg(l.toAg), ratePct: l.bp / 100, tax: fromAg(l.taxAg) })) },
    totalCostAg, equityAg, paymentAg, annualRentAg, annualExpensesAg, noiAg, annualDebtAg, cashFlowAg,
    totalCost: fromAg(totalCostAg), equity: fromAg(equityAg), payment: fromAg(paymentAg), annualRent: fromAg(annualRentAg),
    annualExpenses: fromAg(annualExpensesAg), noi: fromAg(noiAg), annualDebt: fromAg(annualDebtAg), cashFlow: fromAg(cashFlowAg),
    ltvPct: pct2(x.loanAg / x.priceAg * 100),
    grossYieldPct: hasRent ? pct2(annualRentAg / x.priceAg * 100) : null,
    netYieldPct: hasRent ? pct2(noiAg / totalCostAg * 100) : null,
    cashOnCashPct: hasRent && equityAg > 0 ? pct2(cashFlowAg / equityAg * 100) : null,
    warnings,
    assumptions: 'ההחזר בשפיצר בריבית קבועה לכל התקופה. לא נכללו: מס על הכנסה משכירות, מס שבח במכירה, הצמדה למדד ושינויי ריבית.'
  };
}

// ניתוח שמור: שם, נכס (רשות) והקלט כפי שהוזן (שקלים)
const MAX_ANALYSES = 500;
function validateAnalysis(input, properties = []) {
  const name = clip(input && input.name, 120);
  if (!name) throw new Error('יש לתת שם לניתוח');
  const propertyId = String((input && input.propertyId) || '');
  if (propertyId && !properties.some(p => p.id === propertyId)) throw new Error('הנכס שנבחר לא נמצא');
  validateInvestment(input.input);
  const keep = ['price', 'taxYear', 'taxKind', 'manualTax', 'lawyer', 'brokerage', 'renovation', 'otherCosts', 'loan', 'loanRate', 'loanYears', 'monthlyRent', 'occupiedMonths', 'monthlyExpenses'];
  return { name, propertyId, input: Object.fromEntries(keep.filter(k => input.input[k] !== undefined && input.input[k] !== '').map(k => [k, String(input.input[k]).slice(0, 40)])) };
}

module.exports = {
  TAX_KINDS, MAX_TABLES, MAX_BRACKETS, MAX_ANALYSES,
  parseBrackets, validateBrackets, validateTaxTable, bracketsText, taxTableView, purchaseTax, findTable,
  validateInvestment, monthlyPayment, investment, validateAnalysis
};
