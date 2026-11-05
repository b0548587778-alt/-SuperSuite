// מסך הבית של המעטפת: מדדים ומשימות להיום (חשבוניות פתוחות, הלוואות לפירעון, יארצייטים).
// טהור וקריאה בלבד, הכול באגורות. התחומים הסגורים ברישיון או בהרשאה לא נכנסים כלל — open קובע (ipc.js)
const A = require('./accounting');
const SD = require('./salesDocs');
const { isDay } = require('./dates');
const BZ = require('./bizReports');
const M = require('./memorials');

const LIST_MAX = 20;
const LOAN_DAYS = 7; // תשלום בגמ"ח שמועדו בשבוע הקרוב (או בפיגור)
const MEMORIAL_DAYS = 7;

const DAY = { test: isDay }; // תאריך שקיים בלוח בלבד (core/dates.js)
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// החודש עד היום, ואותה תקופה בחודש הקודם — השוואה הוגנת באמצע החודש (לא חודש חלקי מול חודש מלא)
function monthRanges(today) {
  const [y, m, d] = today.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const pd = Math.min(d, lastDay(py, pm));
  return {
    cur: { from: `${y}-${pad(m)}-01`, to: today },
    prev: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(pd)}` },
  };
}

const openAgOf = (data, inv) => (inv.status === 'open' ? Math.max(0, A.toAg(inv.total) - SD.creditedAg(data.salesDocs || [], inv.id)) : 0);

// חשבוניות פתוחות (יתרה אחרי זיכויים), ממוינות לפי מועד התשלום — גם לסדר היום (dashboard.agenda)
function openInvoices(data, today) {
  const terms = BZ.normalizeSettings(data.settings && data.settings.reports).paymentTermsDays;
  const invoices = [];
  for (const inv of data.invoices || []) {
    const amount = openAgOf(data, inv);
    if (amount <= 0 || !DAY.test(String(inv.date || ''))) continue;
    const dueDate = BZ.addDays(inv.date, terms);
    invoices.push({ customer: String(inv.customer || ''), number: inv.number || null, amount, dueDate, late: dueDate < today });
  }
  invoices.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.amount - a.amount));
  return invoices;
}

function acctPart(data, today) {
  const r = monthRanges(today);
  const invoices = openInvoices(data, today);
  return {
    kpis: {
      incomeMonth: BZ.turnoverAg(data, r.cur.from, r.cur.to),
      incomePrevMonth: BZ.turnoverAg(data, r.prev.from, r.prev.to),
      openInvoices: invoices.length,
      openInvoicesAmount: invoices.reduce((t, i) => t + i.amount, 0),
    },
    invoices: invoices.slice(0, LIST_MAX),
  };
}

function npoPart(data, today) {
  const npo = data.npo || {};
  const { from, to } = monthRanges(today).cur;
  let donationsMonth = 0;
  for (const d of npo.donations || []) {
    if (d.status !== 'cancelled' && d.date >= from && d.date <= to) donationsMonth += A.toAg(d.amount || 0);
  }
  // רק השדות שהמסך מציג — בלי טלפון ואיש קשר
  const mem = M.upcoming(npo.memorials || [], today, MEMORIAL_DAYS);
  const yahrzeits = mem.rows.slice(0, LIST_MAX).map(r => ({
    name: r.name, parentName: r.parentName || '', hebrew: r.hebrew || '', daysLeft: r.daysLeft, uncertain: !!r.uncertain,
  }));
  return { kpis: { donationsMonth }, yahrzeits };
}

function gemachPart(data, today) {
  const loans = ((data.gemach || {}).loans || []).filter(l => l.status === 'active');
  const horizon = BZ.addDays(today, LOAN_DAYS);
  const due = [];
  for (const l of loans) {
    // התשלום הפתוח הראשון — בפיגור או בשבוע הקרוב
    const s = (l.schedule || []).find(x => x.paidAg < x.amountAg);
    if (!s || !DAY.test(String(s.dueDate || '')) || s.dueDate > horizon) continue;
    due.push({ borrowerName: String(l.borrowerName || ''), amount: s.amountAg - s.paidAg, dueDate: s.dueDate, late: s.dueDate < today });
  }
  due.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { kpis: { activeLoans: loans.length }, loans: due.slice(0, LIST_MAX) };
}

// open: { acct, npo, gemach } — רק תחום פתוח מחושב; תחום סגור חסר במדדים (המסך מציג "—")
function homeSummary(data, today, open = {}) {
  if (!isDay(today)) throw new Error('תאריך לא תקין');
  const out = { date: today, kpis: {}, invoices: [], yahrzeits: [], loans: [] };
  const parts = [open.acct && acctPart(data, today), open.npo && npoPart(data, today), open.gemach && gemachPart(data, today)];
  for (const p of parts.filter(Boolean)) {
    Object.assign(out.kpis, p.kpis);
    for (const k of ['invoices', 'yahrzeits', 'loans']) if (p[k]) out[k] = p[k];
  }
  return out;
}

module.exports = { LIST_MAX, LOAN_DAYS, MEMORIAL_DAYS, monthRanges, openInvoices, homeSummary };
