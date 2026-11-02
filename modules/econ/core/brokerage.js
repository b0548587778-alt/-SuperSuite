// עמלות תיווך והזמנת שירותי תיווך — פונקציות טהורות, סכומים בשלמי אגורות.
// חשוב: התוכנה אינה קובעת אם מגיעים דמי תיווך. היא מציגה רק "חסר: ..." מול רשימת השדות שלהלן.
// הרשימה נכתבה לפי ההבנה של חוק המתווכים במקרקעין ותקנותיו, אבל המקורות הרשמיים חסומים מהמחשב
// שבו נבנתה — ולכן כל שדה מסומן "לא מאומת" עם שנת תוקף, ומופיע ב-docs/RULES-TO-VERIFY.md לבדיקת עורך דין.

const VALUE_YEAR = 2026;
const UNVERIFIED = `לא מאומת · ${VALUE_YEAR}`;

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isAg = (v) => Number.isSafeInteger(v) && v >= 0;
// תאריך אמיתי בלבד: 2026-02-30 נדחה (Date.parse מגלגל אותו ל-2.3)
const isDate = (s) => {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// ---------- עמלה לצד בעסקה ----------
const SIDES = { buyer: 'קונה / שוכר', seller: 'מוכר / משכיר' };
const FEE_TYPES = { percent: 'אחוז ממחיר העסקה', fixed: 'סכום קבוע' };
const METHODS = { transfer: 'העברה בנקאית', check: 'המחאה', cash: 'מזומן', card: 'כרטיס אשראי', other: 'אחר' };
const MAX_PAYMENTS = 50;

// קלט: { type, value } — אחוז (עד 2 ספרות אחרי הנקודה) או סכום בשקלים, לפני מע"מ. value ריק/0 ← אין עמלה מהצד הזה
function validateFee(input) {
  if (!input || typeof input !== 'object') return null;
  const type = FEE_TYPES[input.type] ? input.type : 'percent';
  if (input.value === undefined || input.value === null || input.value === '') return null;
  const v = Number(input.value);
  if (!Number.isFinite(v) || v < 0) throw new Error('גובה העמלה אינו תקין');
  if (type === 'percent') {
    if (v > 10) throw new Error('אחוז העמלה גבוה מ-10% — יש לבדוק את הערך');
    const bp = Math.round(v * 100);
    return bp ? { type, bp } : null;
  }
  if (v > 1e8) throw new Error('סכום העמלה אינו תקין');
  const fixedAg = toAg(v);
  return fixedAg ? { type, fixedAg } : null;
}

// עמלה לצד: נטו לפי מחיר העסקה, מע"מ לפי שיעור המע"מ בהגדרות, וסה"כ. exempt — עוסק פטור (בלי מע"מ)
function feeAmount(fee, priceAg, vatRate, exempt = false) {
  if (!fee) return { netAg: 0, vatAg: 0, totalAg: 0 };
  const netAg = fee.type === 'percent' ? Math.round((isAg(priceAg) ? priceAg : 0) * fee.bp / 10000) : (isAg(fee.fixedAg) ? fee.fixedAg : 0);
  const vatAg = exempt ? 0 : Math.round(netAg * (Number(vatRate) || 0));
  return { netAg, vatAg, totalAg: netAg + vatAg };
}

// balances — { [side]: יתרה באגורות } (מ-commissionStatus). תשלום מעל היתרה של הצד נדחה: יתרת הגבייה
// הייתה "0" בשקט, והחשבונית על התשלום הייתה מופקת על סכום שלא היה חוב
function validatePayment(input, sides, balances = null) {
  if (!input || typeof input !== 'object') throw new Error('תשלום לא תקין');
  const side = SIDES[input.side] ? input.side : '';
  if (!side) throw new Error('יש לבחור מאיזה צד התקבל התשלום');
  if (!sides.includes(side)) throw new Error('לא הוגדרה עמלה מהצד הזה בעסקה');
  if (!isDate(String(input.date || ''))) throw new Error('תאריך התשלום אינו תקין');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) throw new Error('סכום התשלום אינו תקין');
  const amountAg = toAg(amount);
  if (balances && amountAg > (balances[side] || 0)) {
    throw new Error(`הסכום (${fromAg(amountAg)} ₪) גבוה מהיתרה לגבייה מצד ה${SIDES[side]} (${fromAg(balances[side] || 0)} ₪)`);
  }
  return { side, date: input.date, amountAg, method: METHODS[input.method] ? input.method : 'transfer', note: clip(input.note, 200) };
}

// מצב הגבייה לכל צד ולעסקה כולה
function commissionStatus(deal, vatRate, exempt = false) {
  const fees = deal.commissions || {};
  const pays = Array.isArray(deal.commissionPayments) ? deal.commissionPayments : [];
  const sides = Object.keys(SIDES).filter(s => fees[s]).map(s => {
    const amt = feeAmount(fees[s], deal.priceAg, vatRate, exempt);
    const paidAg = pays.filter(p => p.side === s).reduce((t, p) => t + (isAg(p.amountAg) ? p.amountAg : 0), 0);
    const balanceAg = Math.max(0, amt.totalAg - paidAg);
    // שולם ביתר — למשל אחרי הורדת העמלה או המחיר. מוצג, לא נבלע ביתרה 0
    const overpaidAg = Math.max(0, paidAg - amt.totalAg);
    const state = paidAg === 0 ? 'open' : overpaidAg > 0 ? 'overpaid' : balanceAg === 0 ? 'paid' : 'partial';
    return { side: s, label: SIDES[s], ...amt, paidAg, balanceAg, overpaidAg, state,
      total: fromAg(amt.totalAg), paid: fromAg(paidAg), balance: fromAg(balanceAg), overpaid: fromAg(overpaidAg),
      feeText: fees[s].type === 'percent' ? `${fees[s].bp / 100}% + מע"מ` : `${fromAg(fees[s].fixedAg)} ₪ + מע"מ` };
  });
  const totalAg = sides.reduce((t, s) => t + s.totalAg, 0);
  const paidAg = sides.reduce((t, s) => t + s.paidAg, 0);
  return { sides, totalAg, paidAg, balanceAg: Math.max(0, totalAg - paidAg), total: fromAg(totalAg), paid: fromAg(paidAg), balance: fromAg(Math.max(0, totalAg - paidAg)) };
}

const PAY_STATES = { open: 'טרם שולם', partial: 'שולם חלקית', paid: 'שולם', overpaid: 'שולם ביתר' };

// ---------- הזמנת שירותי תיווך ----------
// כל שדה: מזהה, תווית, ומאיפה נבדק (get). unverified — עד שעורך דין יבדוק את הרשימה מול התקנות
const ORDER_FIELDS = [
  { id: 'brokerage.order.brokerName', label: 'שם המתווך', get: (x) => x.settings.brokerName },
  { id: 'brokerage.order.brokerLicense', label: 'מספר רישיון התיווך', get: (x) => x.settings.licenseNo },
  { id: 'brokerage.order.clientName', label: 'שם הלקוח', get: (x) => x.client && x.client.name },
  { id: 'brokerage.order.clientId', label: 'מספר זהות של הלקוח', get: (x) => x.client && x.client.idNumber },
  { id: 'brokerage.order.clientAddress', label: 'כתובת הלקוח', get: (x) => x.order.clientAddress },
  { id: 'brokerage.order.transaction', label: 'סוג העסקה (מכירה / השכרה וכו׳)', get: (x) => x.order.transaction },
  { id: 'brokerage.order.propertyAddress', label: 'כתובת הנכס או תיאור שמזהה אותו', get: (x) => x.property && (x.property.street || x.order.propertyDescription) && x.property.city },
  { id: 'brokerage.order.price', label: 'המחיר המבוקש / המוצע בעסקה', get: (x) => x.order.priceAg > 0 },
  { id: 'brokerage.order.fee', label: 'גובה דמי התיווך', get: (x) => !!x.order.fee },
  { id: 'brokerage.order.date', label: 'תאריך ההזמנה', get: (x) => x.order.date },
  { id: 'brokerage.order.signature', label: 'חתימת הלקוח על ההזמנה', get: (x) => x.order.signedDate }
].map(f => Object.freeze({ ...f, valueYear: VALUE_YEAR, needsVerification: true }));

// בלעדיות: תקופה מקסימלית ופעולות שיווק — גם הם לא מאומתים
const EXCLUSIVE_RULES = Object.freeze({
  id: 'brokerage.exclusive.maxMonths', maxMonths: 6, valueYear: VALUE_YEAR, needsVerification: true,
  description: 'תקופת בלעדיות מקסימלית בדירת מגורים (חודשים)'
});
const EXCLUSIVE_FIELDS = [
  { id: 'brokerage.exclusive.period', label: 'תקופת הבלעדיות (עד תאריך)', get: (x) => x.order.exclusiveUntil },
  { id: 'brokerage.exclusive.marketing', label: 'פעולות השיווק שהמתווך מתחייב להן', get: (x) => x.order.marketing }
].map(f => Object.freeze({ ...f, valueYear: VALUE_YEAR, needsVerification: true }));

const ALL_RULE_IDS = [...ORDER_FIELDS.map(f => f.id), EXCLUSIVE_RULES.id, ...EXCLUSIVE_FIELDS.map(f => f.id)];

const TRANSACTIONS = { sale: 'מכירה', purchase: 'קנייה', rentOut: 'השכרה', rentIn: 'שכירות' };
const MAX_ORDERS = 10000;

// הוספת חודשים ליום, עם עיגול לסוף החודש: 31.8 + 6 = 28.2 (לא 3.3 — setUTCMonth גולש לחודש הבא)
function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

// מחיר בהזמנה: אותה תקרה כמו מחיר נכס ועסקה (money ב-realty.js) — מספר עצום היה נשמר ומוצג כ-Infinity
function orderPriceAg(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new Error('המחיר בהזמנה אינו תקין');
  return toAg(n);
}

function validateOrder(input, prev = {}, { clients = [], properties = [] } = {}) {
  if (!input || typeof input !== 'object') throw new Error('הזמנה לא תקינה');
  const x = { ...prev, ...input };
  const clientId = String(x.clientId || '');
  if (!clients.some(c => c.id === clientId)) throw new Error('יש לבחור לקוח');
  const propertyId = String(x.propertyId || '');
  if (propertyId && !properties.some(p => p.id === propertyId)) throw new Error('הנכס שנבחר לא נמצא');
  const date = String(x.date || '');
  if (!isDate(date)) throw new Error('תאריך ההזמנה אינו תקין');
  const out = {
    clientId, propertyId, date,
    transaction: TRANSACTIONS[x.transaction] ? x.transaction : '',
    clientAddress: clip(x.clientAddress, 200),
    propertyDescription: clip(x.propertyDescription, 300),
    // '' מטופס עריכה = ניקוי; מפתח חסר = שמירת הקודם (סקירת קוד 2.11.2026)
    priceAg: input.price === '' ? 0 : input.price !== undefined ? orderPriceAg(input.price) : (isAg(prev.priceAg) ? prev.priceAg : 0),
    fee: input.feeValue !== undefined ? validateFee({ type: input.feeType, value: input.feeValue }) : (prev.fee || null),
    exclusive: x.exclusive === true || x.exclusive === 'yes',
    exclusiveUntil: '',
    marketing: '',
    signedDate: x.signedDate ? String(x.signedDate) : '',
    notes: clip(x.notes, 1000)
  };
  if (out.signedDate && !isDate(out.signedDate)) throw new Error('תאריך החתימה אינו תקין');
  if (out.signedDate && out.signedDate < date) throw new Error('תאריך החתימה לפני תאריך ההזמנה');
  if (out.exclusive) {
    out.exclusiveUntil = x.exclusiveUntil ? String(x.exclusiveUntil) : '';
    if (out.exclusiveUntil && !isDate(out.exclusiveUntil)) throw new Error('תאריך סיום הבלעדיות אינו תקין');
    if (out.exclusiveUntil && out.exclusiveUntil <= date) throw new Error('סיום הבלעדיות חייב להיות אחרי תאריך ההזמנה');
    out.marketing = clip(x.marketing, 500);
  }
  return out;
}

// "מה חסר" — רשימה בלבד. warnings: דברים לבדיקה (למשל בלעדיות ארוכה מהמקובל), לא פסילה
function orderCheck(order, { client, property, settings = {} }) {
  const ctx = { order, client, property, settings };
  const fields = [...ORDER_FIELDS, ...(order.exclusive ? EXCLUSIVE_FIELDS : [])];
  const missing = fields.filter(f => !f.get(ctx)).map(f => f.label);
  const warnings = [];
  if (order.exclusive && order.exclusiveUntil && order.exclusiveUntil > addMonths(order.date, EXCLUSIVE_RULES.maxMonths)) {
    warnings.push(`תקופת הבלעדיות ארוכה מ-${EXCLUSIVE_RULES.maxMonths} חודשים (${UNVERIFIED}) — לבדוק מול החוק`);
  }
  return { missing, warnings, complete: missing.length === 0, verificationNote: `רשימת השדות ${UNVERIFIED} — יש לבדוק מול חוק המתווכים במקרקעין ותקנותיו או עם עורך דין.` };
}

function orderView(order, ctx) {
  const { priceAg, fee, ...rest } = order;
  const client = ctx.clients.find(c => c.id === order.clientId);
  const property = ctx.properties.find(p => p.id === order.propertyId);
  return {
    ...rest, price: fromAg(priceAg || 0),
    feeType: fee ? fee.type : 'percent', feeValue: fee ? (fee.type === 'percent' ? fee.bp / 100 : fromAg(fee.fixedAg)) : '',
    feeText: fee ? (fee.type === 'percent' ? `${fee.bp / 100}% + מע"מ` : `${fromAg(fee.fixedAg)} ₪ + מע"מ`) : '',
    clientName: client ? client.name : 'לקוח שנמחק', transactionLabel: TRANSACTIONS[order.transaction] || '',
    check: orderCheck(order, { client, property, settings: ctx.settings || {} })
  };
}

function normalizeSettings(s) {
  const x = s && typeof s === 'object' ? s : {};
  return { brokerName: clip(x.brokerName, 120), licenseNo: clip(x.licenseNo, 40), phone: clip(x.phone, 40), address: clip(x.address, 200), vatExempt: x.vatExempt === true };
}

// ---------- טופס להדפסה ----------
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// טופס ריק-למחצה: מה שידוע ממולא, מה שחסר — קו למילוי ביד. הלקוח חותם על הנייר; התוכנה רק מסמנת תאריך חתימה
function renderOrderHtml(order, { client, property, settings }, tokensCss) {
  const s = normalizeSettings(settings);
  const line = (v) => (v ? esc(v) : '<span class="blank"></span>');
  const v = orderView(order, { clients: client ? [client] : [], properties: property ? [property] : [], settings: s });
  const addr = property ? [property.street, property.neighborhood, property.city].filter(Boolean).join(', ') : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הזמנת שירותי תיווך</title>
<style>${tokensCss || ''}
@page { size: A4; margin: 18mm; }
body { font-family: var(--ss-font); color: var(--ss-text); font-size: 13px; line-height: 1.9; }
h1 { font-size: 20px; text-align: center; margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 6px; border-bottom: 1px solid var(--ss-border); vertical-align: top; }
td:first-child { width: 34%; color: var(--ss-text-2); }
.blank { display: inline-block; min-width: 60%; border-bottom: 1px solid var(--ss-border-strong); height: 1.2em; }
.sign { display: flex; justify-content: space-between; margin-top: 40px; }
.sign div { width: 45%; border-top: 1px solid var(--ss-border-strong); padding-top: 4px; text-align: center; }
.note { margin-top: 24px; font-size: 11px; color: var(--ss-muted); }
</style></head><body>
<h1>הזמנת שירותי תיווך</h1>
<table><tbody>
<tr><td>המתווך</td><td>${line(s.brokerName)}${s.licenseNo ? ` · רישיון מס׳ ${esc(s.licenseNo)}` : ' · רישיון מס׳ <span class="blank"></span>'}</td></tr>
${s.address || s.phone ? `<tr><td>פרטי המתווך</td><td>${esc([s.address, s.phone].filter(Boolean).join(' · '))}</td></tr>` : ''}
<tr><td>הלקוח</td><td>${line(client && client.name)}</td></tr>
<tr><td>מספר זהות</td><td>${line(client && client.idNumber)}</td></tr>
<tr><td>כתובת הלקוח</td><td>${line(order.clientAddress)}</td></tr>
<tr><td>סוג העסקה</td><td>${line(v.transactionLabel)}</td></tr>
<tr><td>הנכס</td><td>${line(addr || order.propertyDescription)}${addr && order.propertyDescription ? `<br>${esc(order.propertyDescription)}` : ''}</td></tr>
<tr><td>מחיר</td><td>${order.priceAg ? esc(fromAg(order.priceAg).toLocaleString('he-IL')) + ' ₪' : line('')}</td></tr>
<tr><td>דמי התיווך</td><td>${line(v.feeText)}</td></tr>
${order.exclusive ? `<tr><td>בלעדיות עד</td><td>${line(order.exclusiveUntil)}</td></tr><tr><td>פעולות שיווק</td><td>${line(order.marketing)}</td></tr>` : ''}
<tr><td>תאריך</td><td>${line(order.date)}</td></tr>
</tbody></table>
<div class="sign"><div>חתימת הלקוח</div><div>חתימת המתווך</div></div>
<div class="note">הטופס הופק מתוכנה כעזר. נוסח ההזמנה והשדות הנדרשים — לבדיקת עורך דין מול חוק המתווכים במקרקעין ותקנותיו (${UNVERIFIED}).</div>
</body></html>`;
}

module.exports = {
  VALUE_YEAR, UNVERIFIED, SIDES, FEE_TYPES, METHODS, PAY_STATES, TRANSACTIONS, MAX_PAYMENTS, MAX_ORDERS,
  ORDER_FIELDS, EXCLUSIVE_RULES, EXCLUSIVE_FIELDS, ALL_RULE_IDS,
  validateFee, feeAmount, validatePayment, commissionStatus,
  validateOrder, orderCheck, orderView, normalizeSettings, renderOrderHtml, addMonths
};
