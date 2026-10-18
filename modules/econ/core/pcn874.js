// דוח מע"מ מפורט — קובץ PCN874 (PLAN.md 9.16). פונקציות טהורות, קריאה בלבד.
// המבנה לפי נספח א' של רשות המסים (מכתב ליצרני התוכנה, 2009/2010): רשומת פתיחה O (131 תווים),
// רשומות תנועה (60 תווים) ורשומת סגירה X (10 תווים), CRLF. הסכומים בשקלים שלמים (עיגול לשקל הקרוב),
// סכום תמיד חיובי והסימן בשדה נפרד. **לא אומת מול הסימולטור של שע"מ** — יש לבדוק שם לפני הגשה ראשונה.
// סוגי תנועה שנתמכים: S (מכירה ללקוח מזוהה), L (מכירות ללקוחות לא מזוהים — רשומה מצטברת), T (תשומות מספק בישראל).
// אין כאן ייבוא, יצוא, קופה קטנה וחשבונית עצמית (Y / R / K / M / C) — אין להם מקור בתוכנה.
const A = require('./accounting');

const LENGTHS = { O: 131, T: 60, X: 10 };
const SALE_TYPES = ['S', 'L'];

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const shekel = (ag) => Math.round(Math.abs(ag) / 100);

// שדה נומרי: אפסים משמאל; ערך ארוך מדי — שגיאה (לא חיתוך שקט של סכום)
function num(value, len, label) {
  const s = digits(value);
  if (s.length > len) throw new Error(`${label}: הערך ארוך מהמותר (${len} ספרות)`);
  return s.padStart(len, '0');
}
// 9 הספרות הימניות (מספר אסמכתה / מספר הקצאה)
const right9 = (v) => digits(v).slice(-9).padStart(9, '0');
const sign = (ag) => (ag < 0 ? '-' : '+');
const ymd = (d) => String(d).replace(/-/g, '');

function monthRange(month, months = 1) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new Error('חודש הדיווח אינו תקין (YYYY-MM)');
  if (months !== 1 && months !== 2) throw new Error('תקופת הדיווח היא חודש או חודשיים');
  const [y, m] = month.split('-').map(Number);
  const endM = m + months - 1;
  const ey = y + Math.floor((endM - 1) / 12), em = ((endM - 1) % 12) + 1;
  const last = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${ey}-${String(em).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

// לקוח / ספק מזוהה = 9 ספרות (ע.מ / ח.פ)
const taxIdOf = (v) => { const d = digits(v); return d.length === 9 && !/^0+$/.test(d) ? d : ''; };

// חשבון ציוד (רכוש קבוע): קוד שמתחיל ב-15, אלא אם הרשומה מסמנת אחרת
const isEquipment = (entry) => (entry.vatDoc && typeof entry.vatDoc.equipment === 'boolean')
  ? entry.vatDoc.equipment
  : entry.lines.some(l => /^15/.test(String(l.account)) && Number(l.debit) > 0);

// מכירות: חשבוניות (וביטולן בתאריך הביטול) וחשבוניות זיכוי. הסכומים באגורות, עם סימן
function salesItems(data, inRange) {
  const items = [];
  for (const inv of data.invoices || []) {
    const base = { customerId: taxIdOf(inv.customerTaxId), ref: inv.number, allocation: inv.allocationNumber || '',
      exempt: !!inv.vatExempt || !(Number(inv.vat) > 0), source: `חשבונית ${inv.number}` };
    if (inRange(inv.date)) items.push({ ...base, date: inv.date, netAg: A.toAg(inv.net), vatAg: A.toAg(inv.vat) });
    // חשבונית שבוטלה — דיווח הפוך בתאריך הביטול (כמו רשומת ההיפוך ביומן)
    if (inv.status === 'cancelled' && inv.cancelledAt && inRange(inv.cancelledAt)) {
      items.push({ ...base, date: inv.cancelledAt, netAg: -A.toAg(inv.net), vatAg: -A.toAg(inv.vat), source: `ביטול חשבונית ${inv.number}` });
    }
  }
  for (const d of data.salesDocs || []) {
    if (d.kind !== 'credit' || d.status === 'cancelled' || !inRange(d.date)) continue;
    const inv = (data.invoices || []).find(i => i.id === d.invoiceId) || {};
    items.push({ customerId: taxIdOf(d.customerTaxId || inv.customerTaxId), ref: d.number, allocation: '',
      exempt: !!d.vatExempt || !(Number(d.vat) > 0), date: d.date, netAg: -A.toAg(d.net), vatAg: -A.toAg(d.vat), source: `זיכוי ${d.number}` });
  }
  return items;
}

// תשומות: כל רשומת יומן שנוגעת במע"מ תשומות. ההיפוך לוקח את פרטי הספק מהרשומה המקורית
function inputItems(data, inRange, issues) {
  const byId = new Map((data.journal || []).map(e => [e.id, e]));
  const items = [];
  for (const e of data.journal || []) {
    if (!inRange(e.date)) continue;
    const vatAg = e.lines.reduce((t, l) => t + (String(l.account) === A.SYS.INPUT_VAT ? A.toAg(l.debit || 0) - A.toAg(l.credit || 0) : 0), 0);
    if (!vatAg) continue;
    const src = e.reversalOf ? byId.get(e.reversalOf) || e : e;
    const doc = src.vatDoc || {};
    // הסכום לפני מע"מ: השורות שבאותו צד של המע"מ, בלי שורת המע"מ עצמה
    const side = vatAg > 0 ? 'debit' : 'credit';
    const netAg = Number.isFinite(Number(doc.net)) && doc.net !== '' && doc.net != null
      ? A.toAg(doc.net) * Math.sign(vatAg)
      : e.lines.filter(l => String(l.account) !== A.SYS.INPUT_VAT).reduce((t, l) => t + A.toAg(l[side] || 0), 0) * Math.sign(vatAg);
    const supplierId = taxIdOf(doc.supplierTaxId);
    const item = { supplierId, ref: doc.reference || '', allocation: doc.allocationNumber || '', date: doc.docDate || src.date,
      vatAg, netAg, equipment: isEquipment(src), source: e.description || 'רשומת יומן', entryId: e.id };
    if (!supplierId) {
      issues.push({ kind: 'input-no-supplier', entryId: e.id, date: e.date, text: `תשומה בלי מספר עוסק של הספק — לא נכללה בקובץ: ${item.source}`, vat: A.fromAg(vatAg) });
      continue;
    }
    items.push(item);
  }
  return items;
}

// מע"מ עסקאות ביומן שלא מגיע מחשבונית או מזיכוי (רשומה ידנית) — לא בקובץ, מוצג לבדיקה
function manualOutputVat(data, inRange, issues) {
  const known = new Set();
  for (const i of data.invoices || []) { if (i.entryId) known.add(i.entryId); if (i.reversalEntryId) known.add(i.reversalEntryId); }
  for (const d of data.salesDocs || []) if (d.entryId) known.add(d.entryId);
  for (const e of data.journal || []) {
    if (!inRange(e.date) || known.has(e.id)) continue;
    const ag = e.lines.reduce((t, l) => t + (String(l.account) === A.SYS.OUTPUT_VAT ? A.toAg(l.credit || 0) - A.toAg(l.debit || 0) : 0), 0);
    if (ag) issues.push({ kind: 'manual-output-vat', entryId: e.id, date: e.date, text: `מע"מ עסקאות ברשומה ידנית — לא נכלל בקובץ: ${e.description || ''}`, vat: A.fromAg(ag) });
  }
}

function txRecord(type, { partyId, date, ref, vatAg, netAg, allocation }) {
  // סימן: מכירה / רכישה "+", ביטול או זיכוי "-". כשהסכום אפס — "+"
  const s = netAg < 0 || vatAg < 0 ? '-' : '+';
  const rec = type + num(partyId, 9, 'מספר עוסק') + num(ymd(date), 8, 'תאריך') + '0000' + right9(ref)
    + num(shekel(vatAg), 9, 'מע"מ') + s + num(shekel(netAg), 10, 'סכום לפני מע"מ') + (allocation ? right9(allocation) : '000000000');
  if (rec.length !== LENGTHS.T) throw new Error('אורך רשומת תנועה שגוי');
  return rec;
}

// בניית הקובץ. month = YYYY-MM (החודש הראשון בתקופה), months = 1 או 2
function buildPcn874({ data, business, month, months = 1, now = Date.now() }) {
  const taxId = taxIdOf(business && business.taxId);
  if (!taxId) throw new Error('יש להזין בהגדרות העסק מספר עוסק מורשה תקין (9 ספרות)');
  const range = monthRange(month, months);
  const inRange = (d) => !!d && d >= range.from && d <= range.to;
  const issues = [];

  const sales = salesItems(data, inRange);
  const records = [];
  // S — לקוח מזוהה, רשומה לכל מסמך
  for (const it of sales.filter(x => x.customerId).sort((a, b) => a.date.localeCompare(b.date) || a.ref - b.ref)) {
    records.push({ type: 'S', exempt: it.exempt, netAg: it.netAg, vatAg: it.exempt ? 0 : it.vatAg,
      line: txRecord('S', { partyId: it.customerId, date: it.date, ref: it.ref, vatAg: it.exempt ? 0 : it.vatAg, netAg: it.netAg, allocation: it.allocation }) });
  }
  // L — לקוחות לא מזוהים: רשומה מצטברת אחת לחייבות ואחת לפטורות, בתאריך סוף התקופה; האסמכתה = מספר המסמכים
  const anon = sales.filter(x => !x.customerId);
  for (const exempt of [false, true]) {
    const group = anon.filter(x => x.exempt === exempt);
    if (!group.length) continue;
    const netAg = group.reduce((t, x) => t + x.netAg, 0);
    const vatAg = exempt ? 0 : group.reduce((t, x) => t + x.vatAg, 0);
    if (!netAg && !vatAg) continue;
    records.push({ type: 'L', exempt, netAg, vatAg, line: txRecord('L', { partyId: '', date: range.to, ref: group.length, vatAg, netAg, allocation: '' }) });
    for (const x of group) {
      if (x.allocation) issues.push({ kind: 'anon-with-allocation', date: x.date, text: `${x.source} עם מספר הקצאה בלי מספר עוסק של הלקוח — דווחה במצטבר (L)` });
    }
  }

  const inputs = inputItems(data, inRange, issues).sort((a, b) => a.date.localeCompare(b.date));
  for (const it of inputs) {
    records.push({ type: 'T', equipment: it.equipment, netAg: it.netAg, vatAg: it.vatAg,
      line: txRecord('T', { partyId: it.supplierId, date: it.date, ref: it.ref, vatAg: it.vatAg, netAg: it.netAg, allocation: it.allocation }) });
  }
  manualOutputVat(data, inRange, issues);

  // הסיכומים בכותרת = סכום הרשומות שבקובץ (בשקלים, עם סימן)
  const signed = (r, field) => shekel(r[field]) * (r.netAg < 0 || r.vatAg < 0 ? -1 : 1);
  const saleRecs = records.filter(r => SALE_TYPES.includes(r.type));
  const taxable = saleRecs.filter(r => !r.exempt);
  const totals = {
    taxableNet: taxable.reduce((t, r) => t + signed(r, 'netAg'), 0),
    taxableVat: taxable.reduce((t, r) => t + signed(r, 'vatAg'), 0),
    exemptNet: saleRecs.filter(r => r.exempt).reduce((t, r) => t + signed(r, 'netAg'), 0),
    otherInputVat: records.filter(r => r.type === 'T' && !r.equipment).reduce((t, r) => t + signed(r, 'vatAg'), 0),
    equipmentInputVat: records.filter(r => r.type === 'T' && r.equipment).reduce((t, r) => t + signed(r, 'vatAg'), 0),
    salesCount: saleRecs.length,
    inputsCount: records.filter(r => r.type === 'T').length
  };
  totals.payable = totals.taxableVat - totals.otherInputVat - totals.equipmentInputVat;

  const d = new Date(now);
  const genDate = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const sgn = (n) => (n < 0 ? '-' : '+');
  const header = 'O' + taxId + month.replace('-', '') + '1' + genDate
    + sgn(totals.taxableNet) + num(Math.abs(totals.taxableNet), 11, 'סך העסקאות החייבות')
    + sgn(totals.taxableVat) + num(Math.abs(totals.taxableVat), 9, 'מע"מ העסקאות')
    + '+' + '0'.repeat(11) + '+' + '0'.repeat(9)
    + num(totals.salesCount, 9, 'מספר רשומות המכירה')
    + sgn(totals.exemptNet) + num(Math.abs(totals.exemptNet), 11, 'עסקאות פטורות')
    + sgn(totals.otherInputVat) + num(Math.abs(totals.otherInputVat), 9, 'מע"מ תשומות אחרות')
    + sgn(totals.equipmentInputVat) + num(Math.abs(totals.equipmentInputVat), 9, 'מע"מ תשומות ציוד')
    + num(totals.inputsCount, 9, 'מספר רשומות התשומות')
    + sgn(totals.payable) + num(Math.abs(totals.payable), 11, 'מע"מ לתשלום');
  if (header.length !== LENGTHS.O) throw new Error('אורך רשומת הפתיחה שגוי');
  const closing = 'X' + taxId;

  const text = [header, ...records.map(r => r.line), closing].join('\r\n') + '\r\n';
  // השוואה לדוח המע"מ מהיומן — ההפרש הוא עיגול לשקל, או רשומות שלא נכללו (issues)
  const journalVat = A.vatReport(data.journal || [], range);
  return {
    text, range, month, months,
    fileName: `PCN874_${taxId}_${month.replace('-', '')}.txt`,
    totals, issues,
    journalVat,
    difference: Math.round(journalVat.netPayable - totals.payable),
    counts: { S: records.filter(r => r.type === 'S').length, L: records.filter(r => r.type === 'L').length, T: totals.inputsCount }
  };
}

// פרטי מסמך התשומה ברשומת יומן (ספק, מספר חשבונית, תאריך, ציוד). שדות ריקים — לא נשמרים
function validateVatDoc(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  const supplier = digits(input.supplierTaxId);
  if (supplier) {
    if (supplier.length !== 9) throw new Error('מספר העוסק של הספק חייב להיות 9 ספרות');
    out.supplierTaxId = supplier;
  }
  const ref = digits(input.reference);
  if (ref) out.reference = ref.slice(-20);
  if (input.docDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.docDate))) throw new Error('תאריך חשבונית הספק אינו תקין');
    out.docDate = String(input.docDate);
  }
  if (typeof input.equipment === 'boolean') out.equipment = input.equipment;
  const alloc = digits(input.allocationNumber);
  if (alloc) out.allocationNumber = alloc;
  return Object.keys(out).length ? out : null;
}

module.exports = { LENGTHS, monthRange, buildPcn874, validateVatDoc };
