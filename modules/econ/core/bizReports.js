// דוחות לעסק (PLAN.md 9.5): כרטסת לקוח, תזרים צפוי ודוח מקדמות. פונקציות טהורות, קריאה בלבד, הכול באגורות.
// התזרים הוא תחזית לפי הנתונים שבספרים — לא ידוע לנו מה כבר שולם לרשויות, ולכן כל שורה מסומנת במקורה.
const A = require('./accounting');
const RC = require('./recurring');
const SD = require('./salesDocs');

const PERIODS = { monthly: { label: 'חודשי', months: 1 }, bimonthly: { label: 'דו-חודשי', months: 2 } };
const DEFAULTS = { paymentTermsDays: 30, period: 'bimonthly', advanceRateBp: 0 };
const MAX_HORIZON = 12;

// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10))).toISOString().slice(0, 10) === v;
const monthOf = (d) => String(d).slice(0, 7);
const pad = (n) => String(n).padStart(2, '0');
function addMonths(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const t = y * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const lastDayOf = (m) => { const [y, mm] = m.split('-').map(Number); return `${m}-${pad(new Date(Date.UTC(y, mm, 0)).getUTCDate())}`; };

// הגדרות הדוחות (settings.reports), מנורמלות. שיעור המקדמה בנקודות בסיס (1.5% = 150) — שלם, בלי נקודה צפה
function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  const terms = Number(o.paymentTermsDays);
  const rate = Number(o.advanceRateBp);
  return {
    paymentTermsDays: Number.isInteger(terms) && terms >= 0 && terms <= 365 ? terms : DEFAULTS.paymentTermsDays,
    period: PERIODS[o.period] ? o.period : DEFAULTS.period,
    advanceRateBp: Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : DEFAULTS.advanceRateBp
  };
}

function validateSettings(input) {
  const o = input && typeof input === 'object' ? input : {};
  // שדה ריק (null / '') אינו 0 ימים
  const rawTerms = o.paymentTermsDays;
  const terms = typeof rawTerms === 'number' || (typeof rawTerms === 'string' && rawTerms.trim()) ? Number(rawTerms) : NaN;
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) throw new Error('תנאי התשלום חייבים להיות בין 0 ל-365 יום');
  if (!PERIODS[o.period]) throw new Error('תקופת הדיווח חייבת להיות חודשית או דו-חודשית');
  // אחוז כפי שמופיע בהודעת פקיד השומה, עד שתי ספרות אחרי הנקודה
  const pct = String(o.advanceRatePct ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(pct)) throw new Error('שיעור המקדמה אינו תקין (למשל 2.5)');
  const [whole, frac = ''] = pct.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (bp > 10000) throw new Error('שיעור המקדמה גבוה מ-100%');
  return { paymentTermsDays: terms, period: o.period, advanceRateBp: bp };
}

// התקופה (חודשית / דו-חודשית) שהחודש שייך אליה. דו-חודשי: ינואר–פברואר, מרץ–אפריל...
function periodOf(month, period) {
  const len = PERIODS[period].months;
  const [y, m] = month.split('-').map(Number);
  const first = m - ((m - 1) % len);
  const start = `${y}-${pad(first)}`;
  const end = addMonths(start, len - 1);
  return { start, end, from: `${start}-01`, to: lastDayOf(end), due: `${addMonths(end, 1)}-15` };
}

// שם תקופה בעברית: "ספטמבר–אוקטובר 2026" / "מרץ 2026"
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthName = (m) => MONTH_NAMES[Number(m.slice(5)) - 1];
const periodName = (start, end) => (start === end ? `${monthName(start)} ${start.slice(0, 4)}` : `${monthName(start)}–${monthName(end)} ${end.slice(0, 4)}`);

const creditedOf = (data, inv) => SD.creditedAg(data.salesDocs || [], inv.id);
const openAg = (data, inv) => (inv.status === 'open' ? Math.max(0, A.toAg(inv.total) - creditedOf(data, inv)) : 0);

// ---------- כרטסת לקוח
// תנועות לפי לקוח (לפי השם, כמו בהשלמת הלקוחות): חשבונית = חובה, זיכוי וגבייה = זכות, יתרה מצטברת
function customerLedger(data, customer, { from, to } = {}) {
  const name = String(customer || '').trim();
  if (!name) throw new Error('יש לבחור לקוח');
  const rows = [];
  for (const inv of data.invoices || []) {
    if (inv.customer !== name) continue;
    rows.push({ date: inv.date, kind: 'invoice', ref: inv.number, label: inv.vatExempt ? 'חשבונית עסקה' : inv.kind === 'tax-invoice-receipt' ? 'חשבונית מס/קבלה' : 'חשבונית מס', debitAg: A.toAg(inv.total), creditAg: 0 });
    if (inv.status === 'cancelled') rows.push({ date: inv.cancelledAt || inv.date, kind: 'cancel', ref: inv.number, label: 'ביטול חשבונית', debitAg: 0, creditAg: A.toAg(inv.total) });
    if (inv.status === 'paid' && inv.paidAt) {
      const paid = A.toAg(inv.total) - creditedOf(data, inv);
      if (paid > 0) rows.push({ date: inv.paidAt, kind: 'payment', ref: inv.number, label: `גבייה${inv.paymentRef ? ' · ' + inv.paymentRef : ''}`, debitAg: 0, creditAg: paid });
    }
  }
  for (const d of data.salesDocs || []) {
    if (d.kind !== 'credit' || d.customer !== name || d.status === 'cancelled') continue;
    rows.push({ date: d.date, kind: 'credit', ref: d.number, label: `חשבונית זיכוי לחשבונית ${d.invoiceNumber}`, debitAg: 0, creditAg: A.toAg(d.total) });
  }
  const order = { invoice: 0, credit: 1, payment: 2, cancel: 3 };
  rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }) || order[a.kind] - order[b.kind]);
  let opening = 0, balance = 0;
  const out = [];
  for (const r of rows) {
    if (from && r.date < from) { opening += r.debitAg - r.creditAg; balance = opening; continue; }
    if (to && r.date > to) break;
    balance += r.debitAg - r.creditAg;
    out.push({ ...r, balanceAg: balance });
  }
  const sum = (k) => out.reduce((t, r) => t + r[k], 0);
  return { customer: name, from: from || null, to: to || null, openingAg: opening, rows: out, debitAg: sum('debitAg'), creditAg: sum('creditAg'), closingAg: balance };
}

// יתרות כל הלקוחות: מחזור, נגבה, פתוח והחשבונית הפתוחה הוותיקה
function customerBalances(data, today) {
  const map = new Map();
  const get = (n) => { if (!map.has(n)) map.set(n, { customer: n, invoicedAg: 0, openAg: 0, openCount: 0, oldestOpen: null, lastDate: '' }); return map.get(n); };
  for (const inv of data.invoices || []) {
    if (!inv.customer) continue;
    const c = get(inv.customer);
    if (inv.date > c.lastDate) c.lastDate = inv.date;
    if (inv.status === 'cancelled') continue;
    c.invoicedAg += A.toAg(inv.total) - creditedOf(data, inv);
    const o = openAg(data, inv);
    if (o > 0) { c.openAg += o; c.openCount += 1; if (!c.oldestOpen || inv.date < c.oldestOpen) c.oldestOpen = inv.date; }
  }
  return [...map.values()]
    .map(c => ({ ...c, oldestDays: c.oldestOpen && today ? Math.max(0, daysBetween(c.oldestOpen, today)) : 0 }))
    .sort((a, b) => b.openAg - a.openAg || b.invoicedAg - a.invoicedAg || a.customer.localeCompare(b.customer, 'he'));
}

// ---------- מחזור, מע"מ ומקדמות לתקופה
// מחזור עסקאות (בלי מע"מ) לפי תאריך המסמך: חשבוניות פחות זיכויים; חשבונית שבוטלה — מינוס בתאריך הביטול
function turnoverAg(data, from, to) {
  const inR = (d) => d >= from && d <= to;
  let t = 0;
  for (const inv of data.invoices || []) {
    if (inR(inv.date)) t += A.toAg(inv.net);
    if (inv.status === 'cancelled' && inR(inv.cancelledAt || inv.date)) t -= A.toAg(inv.net);
  }
  for (const d of data.salesDocs || []) if (d.kind === 'credit' && d.status !== 'cancelled' && inR(d.date)) t -= A.toAg(d.net);
  return t;
}

// מקדמה = מחזור × שיעור, מעוגלת לאגורה (נקודות בסיס: חלוקה ב-10,000)
const advanceAg = (turnover, bp) => (turnover > 0 ? Math.round((turnover * bp) / 10000) : 0);

function vatAg(data, from, to) {
  const v = A.vatReport(data.journal || [], { from, to });
  return { outputAg: A.toAg(v.outputVat), inputAg: A.toAg(v.inputVat), netAg: A.toAg(v.netPayable) };
}

// דוח מקדמות ומע"מ לשנה: שורה לכל תקופת דיווח, עם מועד התשלום (15 בחודש שאחרי התקופה)
function advancesReport(data, { year, today, settings } = {}) {
  const s = normalizeSettings(settings);
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('שנה לא תקינה');
  const rows = [];
  for (let m = `${y}-01`; m <= `${y}-12`; m = addMonths(m, PERIODS[s.period].months)) {
    const p = periodOf(m, s.period);
    const turnover = turnoverAg(data, p.from, p.to);
    const vat = vatAg(data, p.from, p.to);
    const state = today && p.from > today ? 'future' : today && p.to >= today ? 'current' : 'closed';
    rows.push({ start: p.start, end: p.end, from: p.from, to: p.to, due: p.due, state, turnoverAg: turnover,
      advanceAg: advanceAg(turnover, s.advanceRateBp), vatNetAg: vat.netAg, outputVatAg: vat.outputAg, inputVatAg: vat.inputAg });
  }
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  return { year: y, settings: s, rows, totals: { turnoverAg: sum('turnoverAg'), advanceAg: sum('advanceAg'), vatNetAg: sum('vatNetAg') } };
}

// ---------- תזרים צפוי
// יתרת הבנק (חשבון 1000) עד היום
function bankBalanceAg(data, today) {
  const tb = A.trialBalance(data.journal || [], data.accounts || [], { to: today });
  const row = tb.rows.find(r => r.code === A.SYS.BANK);
  return row ? A.toAg(row.balance) : 0;
}

// ממוצע ההוצאות החודשי בשלושת החודשים המלאים האחרונים — הערכה בלבד
function avgExpensesAg(data, today) {
  const cur = monthOf(today);
  let total = 0;
  for (let i = 1; i <= 3; i++) {
    const m = addMonths(cur, -i);
    const is = A.incomeStatement(data.journal || [], data.accounts || [], { from: `${m}-01`, to: lastDayOf(m) });
    total += A.toAg(is.totalExpenses);
  }
  return Math.round(total / 3);
}

// חודשים עתידיים של תבנית חוזרת בטווח, שלא הופקו ולא דולגו (כולל טיוטות שכבר הגיע מועדן)
function recurringMonths(t, today, lastMonth) {
  if (!t || t.paused || !/^\d{4}-\d{2}$/.test(t.startMonth || '')) return [];
  const done = new Set([...Object.keys(t.issued || {}), ...(t.skipped || [])]);
  const out = [];
  const first = t.startMonth > addMonths(monthOf(today), -RC.MAX_BACKLOG) ? t.startMonth : addMonths(monthOf(today), -RC.MAX_BACKLOG);
  for (let m = first; m <= lastMonth; m = addMonths(m, 1)) {
    if (t.endMonth && m > t.endMonth) break;
    if (!done.has(m)) out.push(m);
  }
  return out;
}

// התחזית לפי חודשים: פתיחה ← נכנס (חשבוניות פתוחות, חשבוניות חוזרות) ← יוצא (מע"מ, מקדמות, הוצאות משוערות) ← סגירה.
// includeExpenses = שורת הוצאות לפי ממוצע (הערכה). כל פריט נשמר עם מקורו, כדי שהמשתמש יראה ממה נבנה המספר
function cashForecast(data, { today, months = 3, settings, vatRate, includeExpenses = true } = {}) {
  if (!isDate(today)) throw new Error('תאריך לא תקין');
  const s = normalizeSettings(settings);
  const n = Math.min(MAX_HORIZON, Math.max(1, Number(months) || 3));
  const first = monthOf(today);
  const last = addMonths(first, n - 1);
  const buckets = [];
  for (let i = 0; i < n; i++) buckets.push({ month: addMonths(first, i), items: [], inAg: 0, outAg: 0 });
  const put = (date, item) => {
    const b = buckets.find(x => x.month === monthOf(date));
    if (!b) return;
    b.items.push({ date, ...item });
    if (item.amountAg >= 0) b.inAg += item.amountAg; else b.outAg -= item.amountAg;
  };
  // חשבוניות פתוחות: מועד צפוי = תאריך + תנאי תשלום; עבר המועד — היום, ומסומן "באיחור"
  let overdueAg = 0;
  for (const inv of data.invoices || []) {
    const amount = openAg(data, inv);
    if (!amount) continue;
    const dueDate = addDays(inv.date, s.paymentTermsDays);
    const late = dueDate < today;
    if (late) overdueAg += amount;
    put(late ? today : dueDate, { source: 'invoice', label: `חשבונית ${inv.number} — ${inv.customer}${late ? ' (באיחור)' : ''}`, amountAg: amount, late });
  }
  // חשבוניות חוזרות שטרם הופקו (לפי שיעור המע"מ של היום)
  const rate = Number.isFinite(vatRate) ? vatRate : A.DEFAULT_VAT_RATE;
  for (const t of data.recurringInvoices || []) {
    for (const m of recurringMonths(t, today, last)) {
      const c = A.computeInvoice({ items: t.items, vatExempt: !!t.vatExempt }, rate);
      const due = addDays(RC.dateIn(m, t.dayOfMonth), s.paymentTermsDays);
      put(due < today ? today : due, { source: 'recurring', label: `חשבונית חוזרת ${m} — ${t.customer}`, amountAg: A.toAg(c.total) });
    }
  }
  // מע"מ ומקדמות: לכל תקופה שמועד התשלום שלה בטווח ולא עבר. סכום לפי הרישומים עד היום — לתקופה שלא נסגרה זה חלקי
  const seen = new Set();
  for (let m = addMonths(first, -2); m <= last; m = addMonths(m, 1)) {
    const p = periodOf(m, s.period);
    if (seen.has(p.start) || p.due < today || monthOf(p.due) > last) continue;
    seen.add(p.start);
    const partial = p.to >= today;
    const label = (what) => `${what} ${periodName(p.start, p.end)}${partial ? ' (התקופה טרם הסתיימה)' : ''}`;
    const vat = vatAg(data, p.from, p.to).netAg;
    if (vat > 0) put(p.due, { source: 'vat', label: label('מע"מ'), amountAg: -vat, partial });
    const adv = advanceAg(turnoverAg(data, p.from, p.to), s.advanceRateBp);
    if (adv > 0) put(p.due, { source: 'advance', label: label('מקדמת מס הכנסה'), amountAg: -adv, partial });
  }
  const avgExp = includeExpenses ? avgExpensesAg(data, today) : 0;
  if (avgExp > 0) for (const b of buckets) put(b.month === first ? today : `${b.month}-01`, { source: 'expenses', label: 'הוצאות שוטפות (הערכה: ממוצע 3 החודשים האחרונים)', amountAg: -avgExp, estimate: true });
  let running = bankBalanceAg(data, today);
  const openingAg = running;
  for (const b of buckets) {
    b.items.sort((x, y) => x.date.localeCompare(y.date) || y.amountAg - x.amountAg);
    b.openingAg = running;
    running += b.inAg - b.outAg;
    b.closingAg = running;
  }
  const lowest = buckets.reduce((m, b) => (b.closingAg < m.closingAg ? b : m), buckets[0]);
  return { today, months: n, settings: s, openingAg, overdueAg, avgExpensesAg: avgExp, buckets,
    closingAg: running, lowest: { month: lowest.month, closingAg: lowest.closingAg }, negative: buckets.some(b => b.closingAg < 0) };
}

// נתונים ללוח הבקרה: תמונה קצרה מאותם חישובים
function dashboardSummary(data, { today, settings, vatRate } = {}) {
  const s = normalizeSettings(settings);
  const balances = customerBalances(data, today);
  const fc = cashForecast(data, { today, months: 3, settings: s, vatRate });
  const next = [];
  for (const b of fc.buckets) for (const it of b.items) if (it.source === 'vat' || it.source === 'advance') next.push(it);
  return {
    bankAg: fc.openingAg, overdueAg: fc.overdueAg, forecastClosingAg: fc.closingAg, negative: fc.negative, lowest: fc.lowest,
    months: fc.buckets.map(b => ({ month: b.month, inAg: b.inAg, outAg: b.outAg, closingAg: b.closingAg })),
    topDebtors: balances.filter(c => c.openAg > 0).slice(0, 5), payments: next.slice(0, 4), advanceRateBp: s.advanceRateBp
  };
}

module.exports = { PERIODS, DEFAULTS, MAX_HORIZON, normalizeSettings, validateSettings, periodOf, periodName, customerLedger, customerBalances,
  turnoverAg, advancesReport, cashForecast, dashboardSummary, addMonths, addDays };
