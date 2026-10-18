// חשבונית חוזרת חודשית (PLAN.md 9.6). פונקציות טהורות.
// אין הפקה אוטומטית ואין כתיבה ברקע: הטיוטות **מחושבות** בכל קריאה — כל חודש מתחילת התבנית ועד היום
// שלא הופק ולא דולג. כך אין פעולה אוטומטית (גם לא בשבת), וחודש שבו התוכנה לא נפתחה מופיע בכל זאת.
// הפקה = חשבונית רגילה (createInvoice) שהמשתמש מאשר; החודש נרשם ב-issued כדי שלא יופיע שוב.
const A = require('./accounting');
const { assertIsraeliId } = require('./israeliId');

const MAX_BACKLOG = 24; // לא יותר משנתיים של טיוטות פתוחות לתבנית אחת

const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const nextMonth = (m) => { const [y, mm] = m.split('-').map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; };
const lastDay = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate(); };
// תאריך החשבונית בחודש: היום שנבחר, ובחודש קצר — היום האחרון
const dateIn = (m, day) => `${m}-${String(Math.min(day, lastDay(m))).padStart(2, '0')}`;

function validateTemplate(input, vatRate) {
  if (!input || typeof input !== 'object') throw new Error('תבנית לא תקינה');
  const customer = clip(input.customer, 200);
  if (!customer) throw new Error('שם לקוח חובה');
  const customerTaxId = clip(input.customerTaxId, 12);
  assertIsraeliId(customerTaxId, 'מספר העוסק של הלקוח');
  const day = Number(input.dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('יום בחודש חייב להיות בין 1 ל-31');
  if (!isMonth(input.startMonth)) throw new Error('חודש ההתחלה אינו תקין (YYYY-MM)');
  if (input.endMonth && (!isMonth(input.endMonth) || input.endMonth < input.startMonth)) throw new Error('חודש הסיום אינו תקין');
  if (!Array.isArray(input.items) || input.items.length > 50) throw new Error('מספר הפריטים חורג מהמותר (עד 50)');
  // חישוב לבדיקה בלבד — הסכומים נקבעים מחדש בהפקה, לפי שיעור המע"מ של אותו יום
  const computed = A.computeInvoice({ items: input.items, vatExempt: !!input.vatExempt }, vatRate);
  return {
    customer, ...(customerTaxId ? { customerTaxId } : {}), dayOfMonth: day, startMonth: input.startMonth,
    ...(input.endMonth ? { endMonth: input.endMonth } : {}), vatExempt: !!input.vatExempt,
    items: computed.items.map(it => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, account: it.account })),
    ...(clip(input.notes, 300) ? { notes: clip(input.notes, 300) } : {})
  };
}

// טיוטות פתוחות לתבנית: חודשים שהגיע זמנם (היום בחודש כבר עבר או היום), שלא הופקו ולא דולגו
function pendingMonths(t, today) {
  if (!t || t.paused || !isMonth(t.startMonth)) return [];
  const done = new Set([...Object.keys(t.issued || {}), ...(t.skipped || [])]);
  const out = [];
  for (let m = t.startMonth; m <= today.slice(0, 7); m = nextMonth(m)) {
    if (t.endMonth && m > t.endMonth) break;
    if (dateIn(m, t.dayOfMonth) > today) break;
    if (!done.has(m)) out.push(m);
  }
  return out.slice(-MAX_BACKLOG);
}

function drafts(templates, today, vatRate) {
  const out = [];
  for (const t of templates || []) {
    for (const month of pendingMonths(t, today)) {
      const c = A.computeInvoice({ items: t.items, vatExempt: !!t.vatExempt }, vatRate);
      out.push({ templateId: t.id, month, date: dateIn(month, t.dayOfMonth), customer: t.customer, customerTaxId: t.customerTaxId || '',
        items: c.items, net: c.net, vat: c.vat, total: c.total, vatExempt: c.vatExempt });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, 'he'));
}

// קלט לחשבונית מהתבנית לחודש מסוים
function invoiceInput(t, month) {
  return { customer: t.customer, customerTaxId: t.customerTaxId || '', vatExempt: !!t.vatExempt, date: dateIn(month, t.dayOfMonth),
    items: t.items.map(it => ({ ...it })), recurring: { templateId: t.id, month } };
}

function assertPending(t, month, today) {
  if (!t) throw new Error('התבנית לא נמצאה');
  if (!isMonth(month) || !pendingMonths(t, today).includes(month)) throw new Error(`אין טיוטה פתוחה לחודש ${month}`);
}

// לקוחות מוכרים להשלמה אוטומטית: שם + ע.מ האחרון שנרשם, מהחשבוניות, מסמכי המכירה והתבניות
function customerDirectory(data) {
  const map = new Map();
  const add = (name, taxId, date) => {
    const n = clip(name, 200);
    if (!n) return;
    const prev = map.get(n);
    if (!prev || String(date || '') >= prev.date) map.set(n, { name: n, taxId: taxId || (prev && prev.taxId) || '', date: String(date || ''), count: (prev ? prev.count : 0) + 1 });
    else prev.count += 1;
  };
  for (const i of data.invoices || []) add(i.customer, i.customerTaxId, i.date);
  for (const d of data.salesDocs || []) add(d.customer, d.customerTaxId, d.date);
  for (const t of data.recurringInvoices || []) add(t.customer, t.customerTaxId, '');
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he')).map(({ name, taxId }) => ({ name, taxId }));
}

// חיפוש בכל המסמכים: מספר, לקוח, ע.מ ותיאור פריט
function searchDocuments(data, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hit = (doc) => [doc.number, doc.customer, doc.customerTaxId, ...(doc.items || []).map(i => i.description)]
    .some(v => String(v ?? '').toLowerCase().includes(q));
  const rows = [];
  for (const i of data.invoices || []) if (hit(i)) rows.push({ kind: 'invoice', id: i.id, number: i.number, date: i.date, customer: i.customer, total: i.total, status: i.status });
  for (const d of data.salesDocs || []) if (hit(d)) rows.push({ kind: d.kind, id: d.id, number: d.number, date: d.date, customer: d.customer, total: d.total, status: d.status });
  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
}

module.exports = { MAX_BACKLOG, validateTemplate, pendingMonths, drafts, invoiceInput, assertPending, customerDirectory, searchDocuments, dateIn };
