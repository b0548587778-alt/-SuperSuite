// מסמכי מכירה נוספים (PLAN.md 9.3): הצעת מחיר, הזמנה, תעודת משלוח, חשבונית זיכוי וקבלה. פונקציות טהורות.
// הסכומים מחושבים ב-computeInvoice של accounting.js — ולכן הצעה שהומרה לחשבונית יוצאת זהה עד האגורה.
// הצעה / הזמנה / תעודת משלוח אינן נרשמות ביומן. זיכוי וקבלה נרשמים ביומן (accountingService).
// הקודים — נספח 1 של הוראות המבנה האחיד (core/uniformFile.js). להצעת מחיר אין קוד, והיא לא נכנסת לקובץ.
const A = require('./accounting');
const { assertIsraeliId } = require('./israeliId');

const KINDS = {
  quote: { label: 'הצעת מחיר', code: null, next: ['order', 'delivery', 'invoice'] },
  order: { label: 'הזמנה', code: 100, next: ['delivery', 'invoice'] },
  delivery: { label: 'תעודת משלוח', code: 200, next: ['invoice'] },
  credit: { label: 'חשבונית מס זיכוי', code: 330, next: [] },
  receipt: { label: 'קבלה', code: 400, next: [] }
};
// מסמכים שנוצרים בטופס (זיכוי וקבלה נוצרים מתוך חשבונית)
const DRAFT_KINDS = ['quote', 'order', 'delivery'];
const STATUSES = { open: 'פתוח', converted: 'הומר', cancelled: 'בוטל' };

// אמצעי תשלום — עם הקוד של שדה 1306 ברשומת D120
const PAYMENT_METHODS = {
  cash: { label: 'מזומן', code: 1 },
  check: { label: 'המחאה', code: 2 },
  card: { label: 'כרטיס אשראי', code: 3 },
  transfer: { label: 'העברה בנקאית', code: 4 },
  other: { label: 'אחר', code: 9 }
};
const methodOf = (m) => (PAYMENT_METHODS[m] ? m : 'other');
const methodCode = (m) => PAYMENT_METHODS[methodOf(m)].code;

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// מספור נפרד לכל סוג מסמך, במונה שלא יורד (כמו בחשבוניות — קובץ קבוע)
function nextNumber(docs, kind, seqs = {}) {
  const max = docs.filter(d => d.kind === kind).reduce((m, d) => Math.max(m, Number(d.number) || 0), 0);
  const seq = Number.isSafeInteger(seqs[kind]) ? seqs[kind] : 0;
  return Math.max(max, seq) + 1;
}

// הצעה / הזמנה / תעודת משלוח: לקוח, פריטים ותאריך. validUntil — להצעת מחיר בלבד
function validateDraft(kind, input, vatRate) {
  if (!DRAFT_KINDS.includes(kind)) throw new Error('סוג מסמך לא מוכר');
  if (!input || typeof input !== 'object') throw new Error('מסמך לא תקין');
  const customer = clip(input.customer, 200);
  if (!customer) throw new Error('שם לקוח חובה');
  const date = String(input.date || '');
  if (!isDate(date)) throw new Error('תאריך לא תקין');
  const customerTaxId = clip(input.customerTaxId, 12);
  assertIsraeliId(customerTaxId, 'מספר העוסק של הלקוח');
  if (!Array.isArray(input.items) || input.items.length > 200) throw new Error('מספר הפריטים חורג מהמותר (עד 200)');
  const computed = A.computeInvoice({ items: input.items, vatExempt: !!input.vatExempt }, vatRate);
  const doc = { kind, date, customer, items: computed.items, net: computed.net, vat: computed.vat, total: computed.total, vatExempt: computed.vatExempt, vatRate };
  if (customerTaxId) doc.customerTaxId = customerTaxId;
  const notes = clip(input.notes, 1000);
  if (notes) doc.notes = notes;
  if (kind === 'quote' && input.validUntil) {
    if (!isDate(input.validUntil) || input.validUntil < date) throw new Error('תוקף ההצעה אינו תקין');
    doc.validUntil = input.validUntil;
  }
  return doc;
}

// המרה: הפריטים עוברים כמו שהם (תיאור, כמות, מחיר ליחידה, חשבון הכנסה)
function conversionInput(doc, date) {
  return {
    customer: doc.customer, customerTaxId: doc.customerTaxId || '', vatExempt: !!doc.vatExempt, date,
    items: doc.items.map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, account: it.account })),
    notes: doc.notes || ''
  };
}

function assertConvertible(doc, to) {
  if (!doc || !KINDS[doc.kind]) throw new Error('המסמך לא נמצא');
  if (doc.status === 'converted') throw new Error(`${KINDS[doc.kind].label} ${doc.number} כבר הומרה`);
  if (doc.status === 'cancelled') throw new Error(`${KINDS[doc.kind].label} ${doc.number} בוטלה`);
  if (!KINDS[doc.kind].next.includes(to)) throw new Error(`לא ניתן להמיר ${KINDS[doc.kind].label} ל${to === 'invoice' ? 'חשבונית' : KINDS[to] ? KINDS[to].label : 'מסמך'}`);
}

// ---------- חשבונית זיכוי
// סך הזיכויים הפעילים לחשבונית (אגורות)
function creditedAg(docs, invoiceId) {
  return docs.filter(d => d.kind === 'credit' && d.invoiceId === invoiceId && d.status !== 'cancelled')
    .reduce((t, d) => t + A.toAg(d.total), 0);
}

// זיכוי מלא (בלי פריטים) או חלקי (פריטים). המע"מ באותו שיעור של החשבונית המקורית
function validateCredit(invoice, input, docs) {
  if (!invoice) throw new Error('חשבונית לא נמצאה');
  if (invoice.status === 'cancelled') throw new Error('החשבונית בוטלה — אין מה לזכות');
  const date = String((input && input.date) || '');
  if (!isDate(date)) throw new Error('תאריך לא תקין');
  if (date < invoice.date) throw new Error('תאריך הזיכוי לפני תאריך החשבונית');
  const reason = clip(input && input.reason, 300);
  if (!reason) throw new Error('יש לרשום את סיבת הזיכוי');
  const already = creditedAg(docs, invoice.id);
  const remaining = A.toAg(invoice.total) - already;
  if (remaining <= 0) throw new Error(`חשבונית ${invoice.number} כבר זוכתה במלואה`);
  const rate = invoice.net ? A.toAg(invoice.vat) / A.toAg(invoice.net) : 0;
  let items;
  if (Array.isArray(input.items) && input.items.length) {
    const fallback = (invoice.items[0] && invoice.items[0].account) || A.SYS.SALES;
    items = input.items.map(it => ({ ...it, account: it.account || fallback }));
  } else if (already) {
    throw new Error('החשבונית כבר זוכתה בחלקה — יש לפרט את השורות לזיכוי');
  } else {
    items = invoice.items.map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, account: it.account }));
  }
  if (items.length > 200) throw new Error('מספר הפריטים חורג מהמותר (עד 200)');
  // זיכוי מלא — אותם סכומים בדיוק (המע"מ של המקור, לא חישוב מחדש)
  const full = !(Array.isArray(input.items) && input.items.length);
  const computed = full
    ? { items: invoice.items.map(it => ({ ...it })), net: invoice.net, vat: invoice.vat, total: invoice.total, vatExempt: !!invoice.vatExempt }
    : A.computeInvoice({ items, vatExempt: !!invoice.vatExempt }, rate);
  if (A.toAg(computed.total) > remaining) throw new Error(`סכום הזיכוי גבוה מהיתרה לזיכוי (${A.fromAg(remaining)} ₪)`);
  return {
    kind: 'credit', date, invoiceId: invoice.id, invoiceNumber: invoice.number, customer: invoice.customer,
    ...(invoice.customerTaxId ? { customerTaxId: invoice.customerTaxId } : {}), reason,
    items: computed.items, net: computed.net, vat: computed.vat, total: computed.total, vatExempt: computed.vatExempt,
    full: A.toAg(computed.total) === remaining && !already
  };
}

// רשומת יומן לזיכוי: חובה הכנסות (לפי חשבון הפריט) ומע"מ עסקאות, זכות לקוחות
function creditToEntry(credit, number) {
  const byAccount = new Map();
  for (const it of credit.items) byAccount.set(it.account, (byAccount.get(it.account) || 0) + A.toAg(it.lineNet));
  const lines = [...byAccount].map(([account, ag]) => ({ account, debit: A.fromAg(ag), credit: 0, memo: '' }));
  if (credit.vat > 0) lines.push({ account: A.SYS.OUTPUT_VAT, debit: credit.vat, credit: 0, memo: 'מע"מ עסקאות' });
  lines.push({ account: A.SYS.AR, debit: 0, credit: credit.total, memo: `זיכוי ${number}` });
  return { date: credit.date, description: `חשבונית זיכוי ${number} לחשבונית ${credit.invoiceNumber} — ${credit.customer}`, lines };
}

// ---------- קבלה
function validatePayment(input = {}) {
  const method = methodOf(input.method);
  const reference = clip(input.reference, 80);
  return { method, ...(reference ? { reference } : {}) };
}

// תצוגה: תווית, תווית מצב ותווית אמצעי תשלום
function docView(d) {
  return { ...d, kindLabel: KINDS[d.kind] ? KINDS[d.kind].label : d.kind, statusLabel: STATUSES[d.status] || d.status,
    ...(d.method ? { methodLabel: PAYMENT_METHODS[methodOf(d.method)].label } : {}) };
}

module.exports = {
  KINDS, DRAFT_KINDS, STATUSES, PAYMENT_METHODS, methodOf, methodCode, nextNumber, validateDraft, conversionInput,
  assertConvertible, creditedAg, validateCredit, creditToEntry, validatePayment, docView
};
