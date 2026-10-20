// גמ"ח (קופת גמילות חסדים): בקשות הלוואה, ערבים, לוח סילוקין ללא ריבית וללא הצמדה,
// הפקדות (הון הקופה), תשלומים ופיגורים. פונקציות טהורות, בלי גישה למסד הנתונים.
// כל הסכומים מחושבים בשלמי אגורות; נשמרים בשקלים מעוגלים לשתי ספרות.
// נפרד לחלוטין מהיומן העסקי ומהתרומות של העמותה (מודול npo) — גמ"ח הוא קופת הלוואות, לא תרומות.

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const { assertIsraeliId } = require('./israeliId');
const { parseForeign, stored: storedForeign, foreignLabel } = require('./currency');
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};

const LOAN_STATUSES = { active: 'פעילה', closed: 'נפרעה', cancelled: 'בוטלה' };
const MAX_LOANS = 20000;
const MAX_DEPOSITS = 20000;
const MAX_INSTALLMENTS = 120;
const MAX_GUARANTORS = 5;

const DEFAULT_SETTINGS = {
  fundName: '', notes: '',
  // סף הדיווח/רישוי לפי חוק הגמ"חים — לתצוגה בלבד; יש לאמת מול הרשות לשוק ההון בכל מקרה
  thresholds: { basicLicense: 1000000, extendedLicense: 8000000 }
};

function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.fundName = String(s.fundName || '').slice(0, 200);
  s.notes = String(s.notes || '').slice(0, 1000);
  return s;
}

function validateGuarantor(g) {
  if (!g || typeof g !== 'object') throw new Error('פרטי ערב לא תקינים');
  const name = str(g.name, 200, 'שם הערב');
  if (!name) throw new Error('שם הערב חובה');
  const id = str(g.id, 12, 'מספר הזהות של הערב');
  if (id && !/^\d{5,9}$/.test(id)) throw new Error('מספר זהות הערב חייב להכיל 5–9 ספרות');
  return { name, id, phone: str(g.phone, 30, 'טלפון הערב') };
}

function validateGuarantors(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > MAX_GUARANTORS) throw new Error(`ניתן להוסיף עד ${MAX_GUARANTORS} ערבים`);
  return arr.map(validateGuarantor);
}

// קלט מהממשק: שורה לכל ערב, "שם, ת.ז, טלפון" (ת.ז וטלפון אופציונליים)
function parseGuarantorsText(text) {
  return String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const [name, id, phone] = line.split(',').map(s => (s || '').trim());
    return { name, id, phone };
  });
}

// לוח סילוקין ללא ריבית: חלוקה שווה לפי מספר התשלומים, שארית העיגול נספחת לתשלום האחרון,
// כדי שסכום כל התשלומים יהיה זהה בדיוק לסכום ההלוואה (אגורה לא "נעלמת").
function buildSchedule(amount, installments, issueDate) {
  const totalAg = toAg(amount);
  const n = installments;
  const base = Math.floor(totalAg / n);
  const remainder = totalAg - base * n;
  const [y, m, d] = issueDate.split('-').map(Number);
  const schedule = [];
  for (let i = 1; i <= n; i++) {
    // חישוב ב-UTC כדי שתאריך הפירעון לא יזוז יום בגלל אזור הזמן של המחשב המריץ
    const due = new Date(Date.UTC(y, m - 1 + i, d));
    const dueDate = due.toISOString().slice(0, 10);
    const amountAg = base + (i === n ? remainder : 0);
    schedule.push({ seq: i, dueDate, amountAg, paidAg: 0, paidDate: '', status: 'pending' });
  }
  return schedule;
}

function validateLoanInput(input, count = 0) {
  if (!input || typeof input !== 'object') throw new Error('בקשת הלוואה לא תקינה');
  if (count >= MAX_LOANS) throw new Error('הגעת למספר המקסימלי של הלוואות');
  const borrowerName = str(input.borrowerName, 200, 'שם הלווה');
  if (!borrowerName) throw new Error('שם הלווה חובה');
  const borrowerId = str(input.borrowerId, 12, 'מספר הזהות של הלווה');
  assertIsraeliId(borrowerId, 'מספר הזהות של הלווה');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) throw new Error('סכום ההלוואה אינו תקין');
  const installments = Number(input.installments);
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) {
    throw new Error(`מספר התשלומים חייב להיות שלם בין 1 ל-${MAX_INSTALLMENTS}`);
  }
  const issueDate = input.issueDate || new Date().toISOString().slice(0, 10);
  if (!isDate(issueDate)) throw new Error('תאריך מתן ההלוואה אינו תקין (YYYY-MM-DD)');
  const guarantorsRaw = Array.isArray(input.guarantors) ? input.guarantors : parseGuarantorsText(input.guarantorsText);
  const guarantors = validateGuarantors(guarantorsRaw);
  return {
    borrowerName, borrowerId,
    borrowerPhone: str(input.borrowerPhone, 30, 'טלפון הלווה'),
    borrowerAddress: str(input.borrowerAddress, 300, 'כתובת הלווה'),
    amount: fromAg(toAg(amount)), installments, issueDate, guarantors,
    purpose: str(input.purpose, 300, 'מטרת ההלוואה'),
    notes: str(input.notes, 1000, 'הערות')
  };
}

function validateDepositInput(input, count = 0) {
  if (!input || typeof input !== 'object') throw new Error('הפקדה לא תקינה');
  if (count >= MAX_DEPOSITS) throw new Error('הגעת למספר המקסימלי של הפקדות');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
  const depositorName = str(input.depositorName, 200, 'שם המפקיד');
  if (!depositorName) throw new Error('שם המפקיד חובה');
  // הפקדה במטבע זר — נרשמת בשקלים לפי השער שהוקלד (core/currency.js); יתרת הקופה נשארת בשקלים
  const foreign = parseForeign(input);
  const amount = foreign ? fromAg(foreign.ilsAg) : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error('סכום ההפקדה אינו תקין');
  return {
    date, depositorName, amount: fromAg(toAg(amount)),
    ...(foreign ? { foreign: storedForeign(foreign) } : {}),
    notes: str(input.notes, 300, 'הערות')
  };
}

// רישום תשלום על תשלום מסוים בלוח הסילוקין. מאפשר תשלום חלקי (paidAg מצטבר).
// סכום שלא צוין = מלוא התשלום שנותר לאותו מועד.
function recordPayment(loan, seq, input = {}) {
  const item = (loan.schedule || []).find(s => s.seq === Number(seq));
  if (!item) throw new Error('תשלום בלוח הסילוקין לא נמצא');
  const remaining = item.amountAg - item.paidAg;
  if (remaining <= 0) throw new Error('התשלום הזה כבר נפרע במלואו');
  const amount = input.amount === undefined || input.amount === '' ? fromAg(remaining) : Number(input.amount);
  const amountAg = toAg(amount);
  if (!Number.isFinite(amountAg) || amountAg <= 0) throw new Error('סכום התשלום אינו תקין');
  if (amountAg > remaining) throw new Error(`הסכום גבוה מהנותר לתשלום זה (${fromAg(remaining)} ₪)`);
  const date = input.date && isDate(input.date) ? input.date : new Date().toISOString().slice(0, 10);
  const updatedSchedule = loan.schedule.map(s => s.seq === item.seq
    ? { ...s, paidAg: s.paidAg + amountAg, paidDate: date, status: s.paidAg + amountAg >= s.amountAg ? 'paid' : 'partial' }
    : s);
  const allPaid = updatedSchedule.every(s => s.paidAg >= s.amountAg);
  return { ...loan, schedule: updatedSchedule, status: allPaid ? 'closed' : loan.status };
}

const totalDueAg = (loan) => (loan.schedule || []).reduce((t, s) => t + s.amountAg, 0);
const totalPaidAg = (loan) => (loan.schedule || []).reduce((t, s) => t + s.paidAg, 0);
const outstandingAg = (loan) => totalDueAg(loan) - totalPaidAg(loan);

// פיגורים: תשלומים שתאריך הפירעון שלהם עבר ועדיין לא נפרעו (או נפרעו חלקית) בהלוואה פעילה
function arrears(loan, asOf) {
  if (loan.status !== 'active') return [];
  return (loan.schedule || []).filter(s => s.dueDate < asOf && s.paidAg < s.amountAg);
}

function loanSummary(loan, asOf) {
  const late = arrears(loan, asOf);
  return {
    id: loan.id, borrowerName: loan.borrowerName, borrowerId: loan.borrowerId,
    amount: loan.amount, installments: loan.installments, issueDate: loan.issueDate,
    status: loan.status, statusLabel: LOAN_STATUSES[loan.status] || loan.status,
    outstanding: fromAg(outstandingAg(loan)),
    totalPaid: fromAg(totalPaidAg(loan)),
    lateCount: late.length,
    lateAmount: fromAg(late.reduce((t, s) => t + (s.amountAg - s.paidAg), 0)),
    guarantorsCount: (loan.guarantors || []).length
  };
}

// סקירה כוללת: יתרת קופה, הלוואות פעילות, סכום בפיגור, ורמת רישוי לפי חוק הגמ"חים (להערכה בלבד)
function overview(loans, deposits, settings, asOf) {
  const s = normalizeSettings(settings);
  const today = asOf || new Date().toISOString().slice(0, 10);
  const live = loans.filter(l => l.status !== 'cancelled');
  const depositsTotalAg = deposits.reduce((t, d) => t + toAg(d.amount), 0);
  const outstandingTotalAg = live.reduce((t, l) => t + outstandingAg(l), 0);
  const issuedTotalAg = live.reduce((t, l) => t + toAg(l.amount), 0);
  const lateLoans = live.filter(l => arrears(l, today).length > 0);
  const lateTotalAg = lateLoans.reduce((t, l) => t + arrears(l, today).reduce((x, s) => x + (s.amountAg - s.paidAg), 0), 0);
  let tier = 'exempt';
  if (outstandingTotalAg > toAg(s.thresholds.extendedLicense)) tier = 'extended';
  else if (outstandingTotalAg > toAg(s.thresholds.basicLicense)) tier = 'basic';
  return {
    fundName: s.fundName,
    // יתרת קופה = סך ההפקדות פחות מה שעדיין יצא ולא חזר (הקרן שלא נפרעה עדיין)
    balance: fromAg(depositsTotalAg - outstandingTotalAg),
    depositsTotal: fromAg(depositsTotalAg),
    outstandingTotal: fromAg(outstandingTotalAg),
    issuedTotal: fromAg(issuedTotalAg),
    activeLoansCount: live.filter(l => l.status === 'active').length,
    closedLoansCount: live.filter(l => l.status === 'closed').length,
    lateLoansCount: lateLoans.length,
    lateTotal: fromAg(lateTotalAg),
    licenseTier: tier,
    thresholds: s.thresholds
  };
}

// טבלאות לייצוא CSV (הכותרות בעברית)
function exportTable(kind, loans, deposits, settings, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  if (kind === 'loans') {
    const rows = loans.map(l => [
      l.borrowerName, l.borrowerId, l.amount, l.installments, l.issueDate,
      LOAN_STATUSES[l.status] || l.status, fromAg(outstandingAg(l)), fromAg(totalPaidAg(l)),
      arrears(l, today).length, (l.guarantors || []).map(g => g.name).join('; ')
    ]);
    return { name: 'הלוואות-גמח', headers: ['לווה', 'ת.ז', 'סכום', 'תשלומים', 'תאריך הלוואה', 'סטטוס', 'נותר לפירעון', 'שולם', 'תשלומים בפיגור', 'ערבים'], rows };
  }
  if (kind === 'deposits') {
    const rows = deposits.map(d => [d.date, d.depositorName, d.amount, foreignLabel(d.foreign), d.notes]);
    return { name: 'הפקדות-גמח', headers: ['תאריך', 'מפקיד', 'סכום (₪)', 'מטבע זר', 'הערות'], rows };
  }
  if (kind === 'arrears') {
    const rows = loans.filter(l => l.status === 'active').flatMap(l =>
      arrears(l, today).map(s => [l.borrowerName, l.borrowerId, s.seq, s.dueDate, fromAg(s.amountAg - s.paidAg)]));
    return { name: 'פיגורים-גמח', headers: ['לווה', 'ת.ז', 'תשלום מספר', 'מועד פירעון', 'סכום בפיגור'], rows };
  }
  throw new Error('סוג ייצוא לא נתמך');
}

module.exports = {
  LOAN_STATUSES, DEFAULT_SETTINGS, MAX_LOANS, MAX_DEPOSITS, MAX_INSTALLMENTS, MAX_GUARANTORS,
  normalizeSettings, validateGuarantor, validateGuarantors, parseGuarantorsText, buildSchedule, validateLoanInput,
  validateDepositInput, recordPayment, totalDueAg, totalPaidAg, outstandingAg, arrears,
  loanSummary, overview, exportTable
};
