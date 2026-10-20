// הוראות קבע לתרומה. לא נשמרים פרטי אשראי בשום מקרה. פרטי חשבון בנק — רק להוראה בנקאית שמחויבת בקובץ מס"ב
// (PLAN.md 9.17, core/masav.js): נשמרים ב-bankAccount (המסד והגיבוי מוצפנים), ולממשק יוצאת רק מסיכה.
// כל חודש נוצרת "תרומה צפויה"; המשתמש מסמן "התקבל" (ואז מופקת קבלה רגילה) או "נכשל".
// פונקציות טהורות — השמירה ב-npoService (אוסף npo.standingOrders, נכנס לגיבוי המוצפן).
const { assertIsraeliId } = require('./israeliId');

const SO_METHODS = { standing: 'הוראת קבע בנקאית', card: 'הוראת קבע באשראי' };
const MAX_ORDERS = 5000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const toAg = (n) => Math.round(Number(n || 0) * 100);
const fromAg = (a) => Math.round(a) / 100;
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};
const monthOf = (date) => String(date).slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
// תאריך החיוב בחודש: היום שנקבע, ובחודש קצר — היום האחרון בחודש
function dueDate(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function validateStandingOrder(input, { fundIds = ['general'], prev = {}, count = 0 } = {}) {
  if (!input || typeof input !== 'object') throw new Error('הוראת קבע לא תקינה');
  if (!prev.id && count >= MAX_ORDERS) throw new Error('הגעת למספר המקסימלי של הוראות קבע');
  const donorName = str(input.donorName, 200, 'שם התורם');
  if (!donorName) throw new Error('שם התורם חובה');
  const donorId = assertIsraeliId(str(input.donorId, 12, 'מספר הזהות'), 'מספר זהות / ח"פ של התורם', prev.donorId);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e7) throw new Error('הסכום החודשי אינו תקין');
  const dayOfMonth = Number(input.dayOfMonth || 1);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) throw new Error('יום החיוב חייב להיות בין 1 ל-31');
  const startMonth = str(input.startMonth, 7, 'חודש ההתחלה') || monthOf(new Date().toISOString());
  if (!MONTH_RE.test(startMonth)) throw new Error('חודש ההתחלה אינו תקין (YYYY-MM)');
  const endMonth = str(input.endMonth, 7, 'חודש הסיום');
  if (endMonth && !MONTH_RE.test(endMonth)) throw new Error('חודש הסיום אינו תקין (YYYY-MM)');
  if (endMonth && endMonth < startMonth) throw new Error('חודש הסיום לפני חודש ההתחלה');
  const fundId = input.fundId || 'general';
  if (!fundIds.includes(fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
  return {
    donorName, donorId, amount: fromAg(toAg(amount)), dayOfMonth, startMonth, endMonth, fundId,
    method: SO_METHODS[input.method] ? input.method : 'standing',
    donorPhone: str(input.donorPhone, 30, 'הטלפון'),
    donorAddress: str(input.donorAddress, 300, 'הכתובת'),
    purpose: str(input.purpose, 200, 'הייעוד'),
    notes: str(input.notes, 1000, 'ההערות')
  };
}

// החודשים שבהם ההוראה פעילה, עד חודש נתון (כולל)
function activeMonths(order, uptoMonth) {
  const out = [];
  const end = order.endMonth && order.endMonth < uptoMonth ? order.endMonth : uptoMonth;
  for (let ym = order.startMonth; ym <= end && out.length < 600; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

const lastRecord = (order, ym) => (Array.isArray(order.history) ? order.history : []).filter(h => h.month === ym).pop();

// מצב חודש: received | failed | missed (מועד החיוב עבר ולא סומן) | due (היום / טרם עבר בחודש הנוכחי) | upcoming
function monthStatus(order, ym, today) {
  const rec = lastRecord(order, ym);
  if (rec) return rec.status;
  const due = dueDate(ym, order.dayOfMonth);
  if (due < today) return 'missed';
  return monthOf(today) === ym ? 'due' : 'upcoming';
}

// כישלונות רצופים: מהחודש האחרון שמועדו עבר אחורה, עד להתקבלות
function consecutiveFailures(order, today) {
  let n = 0;
  const months = activeMonths(order, monthOf(today)).reverse();
  for (const ym of months) {
    const st = monthStatus(order, ym, today);
    if (st === 'due' || st === 'upcoming') continue;
    if (st === 'received') break;
    n += 1;
  }
  return n;
}

// תמונת מצב לכל ההוראות: מה צפוי החודש, מה לא סומן, מה נכשל ברצף
function summarize(orders, today) {
  const cur = monthOf(today);
  let expectedAg = 0, receivedAg = 0;
  const rows = (Array.isArray(orders) ? orders : []).map(o => {
    const ended = !!(o.endMonth && o.endMonth < cur);
    const started = o.startMonth <= cur;
    const status = ended || !started ? (ended ? 'ended' : 'future') : monthStatus(o, cur, today);
    if (!ended && started) {
      expectedAg += toAg(o.amount);
      if (status === 'received') receivedAg += toAg(o.amount);
    }
    const open = activeMonths(o, cur).filter(ym => monthStatus(o, ym, today) === 'missed');
    return {
      ...o, status, ended, dueDate: started && !ended ? dueDate(cur, o.dayOfMonth) : '',
      openMonths: open, failures: consecutiveFailures(o, today),
      receivedCount: (o.history || []).filter(h => h.status === 'received').length
    };
  });
  rows.sort((a, b) => Number(a.ended) - Number(b.ended) || b.failures - a.failures || a.donorName.localeCompare(b.donorName, 'he'));
  const live = rows.filter(r => !r.ended && r.status !== 'future');
  return {
    month: cur, rows,
    activeCount: live.length,
    expected: fromAg(expectedAg), received: fromAg(receivedAg),
    missedCount: rows.reduce((t, r) => t + r.openMonths.length, 0),
    atRisk: rows.filter(r => !r.ended && r.failures >= 2).length
  };
}

// בדיקת סימון חודש: החודש חייב להיות פעיל, ולא ניתן לסמן "התקבל" פעמיים
// ignorePeriod — חיוב שהבנק כבר ביצע (מס"ב): נרשם גם אם ההוראה הסתיימה אחרי שהקובץ נשלח
function assertCanRecord(order, ym, status, { ignorePeriod = false } = {}) {
  if (!MONTH_RE.test(String(ym))) throw new Error('חודש לא תקין');
  if (status !== 'received' && status !== 'failed') throw new Error('סטטוס לא תקין');
  if (!ignorePeriod && (ym < order.startMonth || (order.endMonth && ym > order.endMonth))) throw new Error('ההוראה אינה פעילה בחודש זה');
  const rec = lastRecord(order, ym);
  if (rec && rec.status === 'received') throw new Error('התשלום לחודש זה כבר נרשם כהתקבל');
}

module.exports = {
  SO_METHODS, MAX_ORDERS, validateStandingOrder, activeMonths, monthStatus, consecutiveFailures, summarize,
  assertCanRecord, dueDate, addMonths, monthOf
};
