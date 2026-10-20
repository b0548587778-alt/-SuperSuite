// משכנתא כחלק מהעסקה: קישור בין עסקת תיווך (realty.deals) לתיק ייעוץ משכנתאות (mortgageAdvisor.clients).
// פונקציות טהורות. הקישור נשמר בשני הצדדים: deal.mortgageCaseId ו-client.realtyDealId.
// אין שום פעולה אוטומטית — רק תצוגה והתראה כשהחתימה קרובה והמשכנתא עוד לא אושרה.
const M = require('./mortgageAdvisor');
const R = require('./realty');

const ALERT_DAYS = 14;
// מאישור סופי ואילך — המשכנתא כבר לא חוסמת את החתימה
const APPROVED_STAGES = new Set(['final', 'signing', 'closed']);
const DEAL_CLOSED = new Set(['closed', 'lost']);

const dayDiff = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

// קלט לתיק חדש מתוך העסקה: הקונה, שווי הנכס = מחיר העסקה. הסכום המבוקש מוקלד — לא מנחשים הון עצמי
function caseInput(deal, property, buyer, input) {
  if (!buyer) throw new Error('לעסקה אין קונה ברשימת הלקוחות');
  if (property && property.listing === 'rent') throw new Error('עסקת שכירות — אין משכנתא');
  const x = input && typeof input === 'object' ? input : {};
  const requested = Number(x.requestedAmount);
  const priceAg = deal.priceAg || 0;
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('יש להזין את סכום המשכנתא המבוקש');
  if (priceAg && Math.round(requested * 100) > priceAg) throw new Error('סכום המשכנתא גדול ממחיר העסקה');
  const title = property ? R.propertyTitle(property) : 'נכס';
  return {
    name: buyer.name, phone: buyer.phone || '', requestedAmount: requested, propertyValue: priceAg / 100,
    deal: x.deal && M.DEALS[x.deal] ? x.deal : 'secondHand', employment: x.employment && M.EMPLOYMENT[x.employment] ? x.employment : undefined,
    notes: `נפתח מעסקת תיווך: ${title}`.slice(0, 2000)
  };
}

// מצב המשכנתא כפי שרואים אותו בעסקה. client — התיק המקושר (או null אם נמחק / אינו גלוי)
function statusForDeal(deal, client, today, { visible = true } = {}) {
  if (!deal.mortgageCaseId) return null;
  if (!client) return { linked: true, missing: true, label: visible ? 'התיק המקושר נמחק' : 'תיק של יועץ אחר' };
  const approvals = M.approvalsSummary(client, today);
  const chosen = approvals.find(a => a.chosen) || null;
  const approved = APPROVED_STAGES.has(client.status);
  const out = {
    linked: true, caseId: client.id, stage: client.status, stageLabel: M.CLIENT_STATUSES[client.status] || client.status,
    approved, lost: client.status === 'lost', approvalsCount: approvals.length,
    chosen: chosen ? { lender: chosen.lender, validUntil: chosen.validUntil || '', expired: chosen.expired } : null
  };
  out.alert = alertFor(deal, out, today);
  return out;
}

// התראה: עסקה שתלויה במשכנתא, חתימה בתוך ALERT_DAYS ימים (או שעברה), והמשכנתא לא אושרה
function alertFor(deal, st, today) {
  if (!deal.dependsOnMortgage || DEAL_CLOSED.has(deal.stage)) return '';
  if (st && st.lost) return 'תיק המשכנתא סומן "לא התקדם" — העסקה תלויה במשכנתא';
  if (!deal.signDate || (st && st.approved)) return '';
  const days = dayDiff(today, deal.signDate);
  if (days > ALERT_DAYS) return '';
  const when = days < 0 ? `החתימה הייתה אמורה להיות ב-${deal.signDate}` : days === 0 ? 'החתימה היום' : `החתימה בעוד ${days} ימים (${deal.signDate})`;
  if (!st) return `${when} — העסקה תלויה במשכנתא ואין תיק משכנתא מקושר`;
  return `${when} — המשכנתא עדיין בשלב "${st.stageLabel}"`;
}

// העסקה כפי שרואים אותה בתיק המשכנתא
function dealForCase(client, deals, properties, today) {
  if (!client.realtyDealId) return null;
  const d = (deals || []).find(x => x.id === client.realtyDealId);
  if (!d) return { linked: true, missing: true, label: 'העסקה המקושרת נמחקה' };
  const p = (properties || []).find(x => x.id === d.propertyId);
  const st = { approved: APPROVED_STAGES.has(client.status), lost: client.status === 'lost', stageLabel: M.CLIENT_STATUSES[client.status] || client.status };
  return {
    linked: true, dealId: d.id, propertyTitle: p ? R.propertyTitle(p) : 'נכס שנמחק', price: (d.priceAg || 0) / 100,
    stage: d.stage, stageLabel: R.DEAL_STAGES[d.stage] || d.stage, signDate: d.signDate || '', dependsOnMortgage: !!d.dependsOnMortgage,
    alert: alertFor(d, st, today)
  };
}

module.exports = { ALERT_DAYS, APPROVED_STAGES, caseInput, statusForDeal, alertFor, dealForCase };
