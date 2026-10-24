// Exports - בניית מסמכים לייצוא (HTML לחשבונית/PDF, CSV לאקסל). פונקציות טהורות, בלי גישה ל-Electron.

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const AL = require('./allocation');
const { foreignLabel } = require('./currency');
const { localDay } = require('./dates'); // "הופק:" — היום המקומי, לא UTC (בין חצות ל-03:00 toISOString נתן את אתמול)
const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// מיתוג המסמך: צבע (#rrggbb בלבד), לוגו (data:image בלבד — בלי טעינה מבחוץ) וחתימה
const brandColor = (b) => (/^#[0-9a-f]{6}$/i.test(String(b.brandColor || '')) ? b.brandColor : '#1d4ed8');
const logoOk = (v) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(v || ''));

// כותרת המסמך לפי הסוג (מסמכי מכירה מ-core/salesDocs.js וחשבוניות)
function docTitle(doc) {
  if (doc.kindLabel) return doc.kindLabel;
  return doc.vatExempt ? 'חשבונית עסקה' : doc.kind === 'tax-invoice-receipt' ? 'חשבונית מס/קבלה' : 'חשבונית מס';
}

// חשבונית מס, הצעת מחיר, הזמנה, תעודת משלוח וחשבונית זיכוי כ-HTML מוכן להדפסה / המרה ל-PDF.
// מסמך שאינו חשבונית (kindLabel) — בלי מספר הקצאה ובלי הערת הסף
function renderInvoiceHtml(invoice, business = {}) {
  const b = { name: '', taxId: '', address: '', phone: '', email: '', ...business };
  const color = brandColor(b);
  const isInvoice = !invoice.kindLabel;
  const rows = invoice.items.map((it, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc(it.description)}</td>
          <td class="n">${esc(it.quantity)}</td>
          <td class="n">${money(it.unitPrice)}</td>
          <td class="n">${money(it.lineNet)}</td>
        </tr>`).join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(docTitle(invoice))} ${esc(invoice.number)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid ${color}; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: ${color}; }
  .logo { max-height: 70px; max-width: 180px; display: block; margin-bottom: 6px; }
  .sign { margin-top: 40px; display: flex; justify-content: flex-end; }
  .sign div { border-top: 1px solid #94a3b8; padding-top: 4px; min-width: 200px; text-align: center; }
  .biz h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { text-align: left; }
  .meta div { margin-bottom: 4px; }
  .customer { margin: 18px 0; padding: 10px 14px; background: #f8fafc; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: ${color}; color: #fff; padding: 8px; text-align: right; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
  td.n, th.n { text-align: left; }
  .totals { margin-top: 16px; margin-inline-start: auto; width: 60%; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
  .totals .grand { font-size: 16px; font-weight: 800; border-bottom: 2px solid ${color}; }
  .alloc { margin-top: 12px; font-size: 14px; }
  .alloc b { font-size: 16px; letter-spacing: 1px; }
  .no-deduct { margin-top: 12px; padding: 8px 12px; border: 2px solid #b91c1c; color: #b91c1c; font-weight: 800; font-size: 15px; text-align: center; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <div class="biz">
    ${logoOk(b.logo) ? `<img class="logo" src="${b.logo}" alt="">` : ''}
    <h2>${esc(b.name)}</h2>
    ${b.taxId ? `<div>ע.מ / ח.פ: ${esc(b.taxId)}</div>` : ''}
    ${b.address ? `<div>${esc(b.address)}</div>` : ''}
    ${b.phone ? `<div>טלפון: ${esc(b.phone)}</div>` : ''}
    ${b.email ? `<div>${esc(b.email)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>${esc(docTitle(invoice))}</h1>
    <div><strong>מספר:</strong> ${esc(invoice.number)}</div>
    <div><strong>תאריך:</strong> ${esc(invoice.date)}</div>
    ${invoice.validUntil ? `<div><strong>בתוקף עד:</strong> ${esc(invoice.validUntil)}</div>` : ''}
    ${invoice.invoiceNumber ? `<div><strong>לחשבונית מס:</strong> ${esc(invoice.invoiceNumber)}</div>` : ''}
    ${invoice.sourceDoc ? `<div><strong>על פי:</strong> ${esc(SOURCE_LABELS[invoice.sourceDoc.kind] || '')} ${esc(invoice.sourceDoc.number)}</div>` : ''}
  </div>
</header>
${isInvoice ? allocationBlock(invoice) : ''}
${invoice.reason ? `<div class="customer"><strong>סיבת הזיכוי:</strong> ${esc(invoice.reason)}</div>` : ''}
<div class="customer"><strong>לכבוד:</strong> ${esc(invoice.customer)}${invoice.customerTaxId ? ` · ע.מ / ח.פ: ${esc(invoice.customerTaxId)}` : ''}</div>
<table>
  <thead><tr><th>#</th><th>תיאור</th><th class="n">כמות</th><th class="n">מחיר ליחידה</th><th class="n">סה"כ לפני מע"מ</th></tr></thead>
  <tbody>${rows}
  </tbody>
</table>
<div class="totals">
  <div><span>סה"כ לפני מע"מ</span><span>${money(invoice.net)}</span></div>
  <div><span>מע"מ ${invoice.vatExempt ? '(פטור)' : ''}</span><span>${money(invoice.vat)}</span></div>
  <div class="grand"><span>${invoice.kind === 'credit' ? 'סה"כ זיכוי' : invoice.status === 'paid' ? 'סה"כ שולם' : 'סה"כ'}</span><span>${money(invoice.total)}</span></div>
  ${isInvoice && invoice.credited > 0 ? `<div><span>זוכה</span><span>${money(invoice.credited)}</span></div><div><span>יתרה</span><span>${money(invoice.balance)}</span></div>` : ''}
</div>
${invoice.notes ? `<div class="customer">${esc(invoice.notes)}</div>` : ''}
${isInvoice && invoice.status === 'paid' ? `<div class="customer"><strong>התקבל תשלום</strong> בתאריך ${esc(invoice.paidAt || invoice.date)}${invoice.paymentMethod ? ` · ${esc(PAY_LABELS[invoice.paymentMethod] || '')}` : ''}${invoice.paymentRef ? ` · אסמכתא: <span dir="ltr">${esc(invoice.paymentRef)}</span>` : ''}</div>` : ''}
${b.signature ? `<div class="sign"><div>${esc(b.signature)}</div></div>` : ''}
<div class="notice">מסמך זה הופק במערכת SuperSuite.${isInvoice ? ' חשבונית מס שסכומה לפני מע"מ גבוה מהסף שקבעה רשות המסים, ללקוח שהוא עוסק מורשה, דורשת הקצאת מספר מרשות המסים.' : invoice.kind === 'credit' ? '' : ' מסמך זה אינו חשבונית מס.'}</div>
</body>
</html>`;
}

const SOURCE_LABELS = { quote: 'הצעת מחיר', order: 'הזמנה', delivery: 'תעודת משלוח' };
const PAY_LABELS = { cash: 'מזומן', check: 'המחאה', card: 'כרטיס אשראי', transfer: 'העברה בנקאית', other: 'אחר' };

// קבלה לעסק (סוג 400): על תשלום של חשבונית מס, בלי פריטים ובלי מע"מ
function renderReceiptHtml(r, business = {}) {
  const b = { name: '', taxId: '', address: '', phone: '', email: '', ...business };
  const color = brandColor(b);
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>קבלה ${esc(r.number)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid ${color}; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: ${color}; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  .logo { max-height: 70px; max-width: 180px; display: block; margin-bottom: 6px; }
  .meta { text-align: left; }
  .box { margin: 18px 0; padding: 10px 14px; background: #f8fafc; border-radius: 6px; }
  .grand { font-size: 18px; font-weight: 800; margin-top: 12px; }
  .sign { margin-top: 40px; display: flex; justify-content: flex-end; }
  .sign div { border-top: 1px solid #94a3b8; padding-top: 4px; min-width: 200px; text-align: center; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <div>
    ${logoOk(b.logo) ? `<img class="logo" src="${b.logo}" alt="">` : ''}
    <h2>${esc(b.name)}</h2>
    ${b.taxId ? `<div>ע.מ / ח.פ: ${esc(b.taxId)}</div>` : ''}
    ${b.address ? `<div>${esc(b.address)}</div>` : ''}
    ${b.phone ? `<div>טלפון: ${esc(b.phone)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>קבלה</h1>
    <div><strong>מספר:</strong> ${esc(r.number)}</div>
    <div><strong>תאריך:</strong> ${esc(r.date)}</div>
  </div>
</header>
<div class="box"><strong>התקבל מאת:</strong> ${esc(r.customer)}${r.customerTaxId ? ` · ע.מ / ח.פ: ${esc(r.customerTaxId)}` : ''}</div>
<div class="box">
  <div><strong>עבור:</strong> חשבונית מס ${esc(r.invoiceNumber)}</div>
  <div><strong>אמצעי תשלום:</strong> ${esc(PAY_LABELS[r.method] || 'אחר')}${r.reference ? ` · אסמכתא: <span dir="ltr">${esc(r.reference)}</span>` : ''}</div>
  <div class="grand">סה"כ התקבל: ${money(r.total)}</div>
</div>
${r.status === 'cancelled' ? '<div class="box"><strong>הקבלה בוטלה</strong></div>' : ''}
${b.signature ? `<div class="sign"><div>${esc(b.signature)}</div></div>` : ''}
<div class="notice">מסמך זה הופק במערכת SuperSuite.</div>
</body>
</html>`;
}

// מספר הקצאה: 9 הספרות הימניות מודגשות. חשבונית שדורשת מספר ואין לה — המשפט הבולט של רשות המסים
function allocationBlock(invoice) {
  const state = AL.allocationState(invoice);
  if (state === 'assigned') return `<div class="alloc">הקצאה מספר: <b dir="ltr">${esc(AL.printedDigits(invoice.allocationNumber))}</b></div>`;
  if (state === 'pending') return '<div class="no-deduct">אין לנכות מס תשומות בגין חשבונית זו</div>';
  return '';
}

// "תרומות ישראל" (מודל תרומות 4.0, סעיף 2.2): אחרי הדיווח — המשפט הבולט ומספר האישור על הקבלה.
// לפני הדיווח לא מודפס כלום: המשפט אומר שהתרומה כבר דווחה
function donationReportBlock(d) {
  const t = d.taxReport || {};
  if (!(d.receipt && d.receipt.sec46) || !t.registrationNumber) return '';
  return `<div class="reported">פרטי התרומה דווחו לרשות המסים · מספר אישור דיווח התרומה לרשות המסים: <span dir="ltr">${esc(t.registrationNumber)}</span></div>`;
}

const METHOD_LABELS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', standing: 'הוראת קבע' };

// קבלה על תרומה (עמותה) כ-HTML להדפסה / PDF. הפרטים נלקחים מהקבלה עצמה (מוקפאים ביום ההפקה).
const RECEIPT_CSS = `
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #0f766e; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: #0f766e; }
  .org h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { text-align: left; }
  .box { margin: 18px 0; padding: 12px 14px; background: #f8fafc; border-radius: 6px; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
  .amount { font-size: 18px; font-weight: 800; }
  .s46 { margin-top: 16px; padding: 10px 14px; border: 2px solid #0f766e; border-radius: 6px; font-weight: 600; }
  .reported { margin-top: 12px; padding: 10px 14px; border: 2px solid #1e293b; border-radius: 6px; font-weight: 800; font-size: 14px; }
  .void { color: #b91c1c; font-size: 20px; font-weight: 800; text-align: center; border: 3px solid #b91c1c; padding: 8px; margin-top: 12px; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
  .cheques { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .cheques th { text-align: right; font-weight: 600; padding: 5px 6px; border-bottom: 2px solid #0f766e; }
  .cheques td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
  .cheques .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bounced { margin-top: 8px; font-weight: 600; color: #b91c1c; }
`;

// המחאות דחויות: שנת המס, יום קבלת ההמחאות וטבלת ההמחאות של השנה הזו בלבד (סעיף 2.3.2)
function chequesBlock(d) {
  if (!Array.isArray(d.cheques) || !d.cheques.length) return '';
  const rows = d.cheques.map(c => `<tr><td dir="ltr">${esc(c.number)}</td><td>${esc(c.bank || '')}</td><td>${esc(c.branch || '')}</td><td>${esc(c.dueDate)}</td><td class="n">${money(c.amountAg / 100)}</td></tr>`).join('');
  return `<div class="box">
  <div class="row"><span>שנת מס</span><span>${esc(String(d.date).slice(0, 4))}</span></div>
  ${d.receivedDate ? `<div class="row"><span>ההמחאות התקבלו</span><span>${esc(d.receivedDate)}</span></div>` : ''}
  ${d.replacesReceipt ? `<div class="row"><span>מחליפה את קבלה</span><span>${esc(d.replacesReceipt)} (המחאה שחזרה)</span></div>` : ''}
  <table class="cheques"><thead><tr><th>מס' המחאה</th><th>בנק</th><th>סניף</th><th>פירעון</th><th class="n">סכום</th></tr></thead><tbody>${rows}</tbody></table>
  ${d.bouncedCheque ? `<div class="bounced">המחאה מספר ${esc(d.bouncedCheque.number)} (פירעון ${esc(d.bouncedCheque.dueDate)}) חזרה — הקבלה בוטלה</div>` : ''}
</div>`;
}

function donationReceiptBody(d) {
  const r = d.receipt || {};
  const o = r.org || {};
  const cancelled = d.status === 'cancelled';
  return `<header>
  <div class="org">
    <h2>${esc(o.name)}</h2>
    ${o.regNumber ? `<div>ע"ר ${esc(o.regNumber)}</div>` : ''}
    ${o.address ? `<div>${esc(o.address)}</div>` : ''}
    ${o.phone ? `<div>טלפון: ${esc(o.phone)}</div>` : ''}
    ${o.vatStatus === 'osek' && o.vatNumber ? `<div>עוסק מורשה ${esc(o.vatNumber)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>קבלה על תרומה</h1>
    <div><strong>מספר:</strong> ${esc(r.number)}</div>
    <div><strong>תאריך:</strong> ${esc(d.date)}</div>
  </div>
</header>
${cancelled ? '<div class="void">מבוטלת</div>' : ''}
<div class="box">
  <div class="row"><span>התקבל מאת</span><span>${esc(d.donorName)}${d.donorId ? ` · ת.ז/ח.פ ${esc(d.donorId)}` : d.donorType === 'foreign' ? ' · תושב חוץ' : ''}</span></div>
  ${d.donorAddress ? `<div class="row"><span>כתובת</span><span>${esc(d.donorAddress)}</span></div>` : ''}
  <div class="row"><span>אמצעי תשלום</span><span>${esc(METHOD_LABELS[d.method] || d.method)}${d.reference ? ` · אסמכתא ${esc(d.reference)}` : ''}</span></div>
  <div class="row"><span>ייעוד</span><span>${esc(r.fundName || 'כללי')}${d.purpose ? ` — ${esc(d.purpose)}` : ''}</span></div>
  <div class="row amount"><span>סכום התרומה</span><span>${money(d.amount)}</span></div>
  ${d.foreign ? `<div class="row"><span>התקבל במטבע זר</span><span dir="ltr">${esc(foreignLabel(d.foreign))}</span></div>` : ''}
</div>
${chequesBlock(d)}
${r.sec46 ? `<div class="s46">התרומה מוכרת לזיכוי ממס לפי סעיף 46 לפקודת מס הכנסה · אישור מס' ${esc(r.sec46Number)}${r.sec46ValidUntil ? ` · בתוקף עד ${esc(r.sec46ValidUntil)}` : ''}</div>` : ''}
${donationReportBlock(d)}
<div class="notice">מסמך זה הופק במערכת SuperSuite. האחריות לתוקף אישור סעיף 46 ולדיווח לרשויות חלה על העמותה.</div>
`;
}

function renderDonationReceiptHtml(d) {
  return htmlDoc(`קבלה על תרומה ${esc((d.receipt || {}).number)}`, RECEIPT_CSS, donationReceiptBody(d));
}

// סיכום שנתי לתורם: טבלת כל הקבלות בשנה, סה"כ והחלק המזכה לפי סעיף 46 (קלט: npo.donorAnnualStatement)
const STATEMENT_CSS = `
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #14213d; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #13264a; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 21px; color: #13264a; font-family: "David", serif; }
  .org h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { text-align: left; }
  .to { margin: 18px 0 10px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #13264a; color: #f6eccb; font-weight: 600; padding: 7px 6px; text-align: right; }
  td { padding: 6px; border-bottom: 1px solid #e3e7f0; }
  tr:nth-child(even) td { background: #f7f9fd; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 800; border-top: 2px solid #b8860b; background: #fff !important; }
  .s46 { margin-top: 16px; padding: 10px 14px; border: 2px solid #b8860b; border-radius: 6px; background: #fffaf0; }
  .notice { margin-top: 26px; font-size: 11px; color: #5d6b85; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
`;

function donorStatementBody(st) {
  const o = st.org || {};
  const dn = st.donor || {};
  const rows = (st.receipts || []).map(r => `<tr><td>${esc(r.number)}</td><td>${esc(r.date)}</td><td>${esc(METHOD_LABELS[r.method] || r.method)}</td><td>${esc(r.fundName)}</td><td>${r.sec46 ? '✓' : '—'}</td><td class="n">${money(r.amount)}</td></tr>`).join('');
  return `<header>
  <div class="org">
    <h2>${esc(o.name)}</h2>
    ${o.regNumber ? `<div>ע"ר ${esc(o.regNumber)}</div>` : ''}
    ${o.address ? `<div>${esc(o.address)}</div>` : ''}
    ${o.phone ? `<div>טלפון: ${esc(o.phone)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>סיכום תרומות לשנת ${esc(st.year)}</h1>
    <div>הופק: ${esc(localDay())}</div>
  </div>
</header>
<div class="to">לכבוד: <strong>${esc(dn.name)}</strong>${dn.id ? ` · ת.ז/ח.פ ${esc(dn.id)}` : ''}${dn.address ? `<br>${esc(dn.address)}` : ''}</div>
<div>להלן פירוט התרומות שהתקבלו ממך בשנת ${esc(st.year)}. תודה על תמיכתך.</div>
<table>
  <thead><tr><th>קבלה</th><th>תאריך</th><th>אמצעי</th><th>ייעוד</th><th>סעיף 46</th><th class="n">סכום</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="5">סה"כ תרומות בשנה</td><td class="n">${money(st.total)}</td></tr></tfoot>
</table>
${st.sec46Total > 0 ? `<div class="s46">מתוכן <strong>${money(st.sec46Total)}</strong> מוכרים לזיכוי ממס לפי סעיף 46 לפקודת מס הכנסה${o.sec46Number ? ` · אישור מס' ${esc(o.sec46Number)}` : ''}${o.sec46ValidUntil ? ` · בתוקף עד ${esc(o.sec46ValidUntil)}` : ''}.</div>` : ''}
<div class="notice">סיכום זה מרכז קבלות שכבר הופקו ואינו מחליף אותן. האחריות לתוקף אישור סעיף 46 ולדיווח לרשויות חלה על העמותה. הופק במערכת SuperSuite.</div>
`;
}

function renderDonorStatementHtml(st) {
  return htmlDoc(`סיכום תרומות לשנת ${esc(st.year)}`, STATEMENT_CSS, donorStatementBody(st));
}

// שלד מסמך HTML מוכן להדפסה / PDF
function htmlDoc(title, css, body) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${body}</body>
</html>`;
}

// עיגון CSS של מסמך בודד תחת מחלקה, כדי לחבר כמה מסמכים לקובץ אחד בלי שהעיצובים יתנגשו.
// @page מושמט (הקובץ המשולב מגדיר אותו פעם אחת), body הופך למחלקה עצמה
function scopeCss(css, scope) {
  return css.split('\n').filter(line => !/^\s*@page\b/.test(line)).map(line => {
    const m = line.match(/^(\s*)([^@{\s][^{]*)\{(.*)$/);
    if (!m) return line;
    const sels = m[2].split(',').map(x => x.trim()).filter(Boolean)
      .map(x => (x === 'body' ? scope : x.startsWith('body ') ? scope + x.slice(4) : `${scope} ${x}`));
    return `${m[1]}${sels.join(', ')} {${m[3]}`;
  }).join('\n');
}

// תיק תורם לשנה: הסיכום השנתי ואחריו כל קבלה שהופקה במערכת, כל אחת בעמוד משלה.
// קבלה שהופקה בערוץ התרומה עצמו (חיצונית) מופיעה בטבלת הסיכום בלבד
function renderDonorFileHtml(st, donations) {
  const own = (donations || []).filter(d => d.receipt && !d.receipt.external && Number.isInteger(d.receipt.number));
  const external = (donations || []).length - own.length;
  const css = `
  @page { size: A4; margin: 16mm; }
  body { margin: 0; }
  .page { break-before: page; }
${scopeCss(STATEMENT_CSS, '.st')}
${scopeCss(RECEIPT_CSS, '.rc')}
  .st .attached { margin-top: 12px; }
`;
  const attached = own.length
    ? `<div class="attached">מצורפות ${own.length} קבלות, כל אחת בעמוד נפרד.${external ? ` ${external} קבלות שהופקו בערוץ התרומה עצמו אינן מצורפות.` : ''}</div>`
    : external ? '<div class="attached">הקבלות לשנה זו הופקו בערוץ התרומה עצמו ואינן מצורפות.</div>' : '';
  const body = `<section class="st">
${donorStatementBody(st).replace('<div class="notice">', attached + '<div class="notice">')}
</section>
${own.map(d => `<section class="rc page">
${donationReceiptBody(d)}</section>
`).join('')}`;
  return htmlDoc(`תיק תורם לשנת ${esc(st.year)} · ${esc((st.donor || {}).name)}`, css, body);
}

const SCHEDULE_STATE = { paid: 'נפרע', partial: 'חלקי', late: 'בפיגור', pending: 'ממתין' };

// דף חשבון ללווה בגמ"ח: פרטי ההלוואה, לוח הסילוקין עם מה ששולם ומה שנותר, ויתרה לפירעון.
// קלט: הלוואה כפי שמחזיר gemachService.getLoan (חשבון הבנק ממוסך בלבד) ושם הגמ"ח. סכומים באגורות
function renderLoanStatementHtml(loan, { fundName = '', asOf = '' } = {}) {
  const schedule = loan.schedule || [];
  const live = loan.status === 'active';
  const stateOf = (s) => (s.paidAg >= s.amountAg ? 'paid' : live && asOf && s.dueDate < asOf ? 'late' : s.paidAg > 0 ? 'partial' : 'pending');
  const dueAg = schedule.reduce((t, s) => t + s.amountAg, 0);
  const paidAg = schedule.reduce((t, s) => t + s.paidAg, 0);
  const lateAg = schedule.filter(s => stateOf(s) === 'late').reduce((t, s) => t + s.amountAg - s.paidAg, 0);
  const ag = (a) => money(a / 100);
  const rows = schedule.map(s => {
    const st = stateOf(s);
    return `<tr class="${st}"><td>${esc(s.seq)}</td><td>${esc(s.dueDate)}</td><td class="n">${ag(s.amountAg)}</td><td class="n">${s.paidAg ? ag(s.paidAg) : '—'}</td><td>${esc(s.paidDate || '')}</td><td class="n">${ag(s.amountAg - s.paidAg)}</td><td>${SCHEDULE_STATE[st]}</td></tr>`;
  }).join('');
  const guarantors = (loan.guarantors || []).map(g => esc(g.name)).filter(Boolean).join(', ');
  const css = `
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #7c2d12; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: #7c2d12; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { text-align: left; }
  .box { margin: 16px 0; padding: 10px 14px; background: #f8fafc; border-radius: 6px; line-height: 1.8; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #7c2d12; color: #fff; padding: 7px 6px; text-align: right; font-weight: 600; }
  td { padding: 6px; border-bottom: 1px solid #e2e8f0; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.paid td { color: #64748b; }
  tr.late td { color: #b91c1c; font-weight: 600; }
  .totals { margin-top: 16px; margin-inline-start: auto; width: 60%; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
  .totals .grand { font-size: 16px; font-weight: 800; border-bottom: 2px solid #7c2d12; }
  .void { color: #b91c1c; font-size: 18px; font-weight: 800; text-align: center; border: 3px solid #b91c1c; padding: 8px; margin-top: 12px; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
`;
  const body = `<header>
  <div>
    <h2>${esc(fundName || 'גמ"ח')}</h2>
  </div>
  <div class="meta">
    <h1>דף חשבון הלוואה</h1>
    ${asOf ? `<div><strong>נכון לתאריך:</strong> ${esc(asOf)}</div>` : ''}
  </div>
</header>
${loan.status === 'cancelled' ? '<div class="void">ההלוואה בוטלה</div>' : ''}
<div class="box">
  <div><strong>לכבוד:</strong> ${esc(loan.borrowerName)}${loan.borrowerId ? ` · ת.ז ${esc(loan.borrowerId)}` : ''}</div>
  ${loan.borrowerAddress ? `<div>${esc(loan.borrowerAddress)}</div>` : ''}
  <div><strong>סכום ההלוואה:</strong> ${money(loan.amount)} · <strong>ניתנה ב:</strong> ${esc(loan.issueDate)} · <strong>תשלומים:</strong> ${esc(loan.installments)}</div>
  ${loan.purpose ? `<div><strong>מטרה:</strong> ${esc(loan.purpose)}</div>` : ''}
  ${guarantors ? `<div><strong>ערבים:</strong> ${guarantors}</div>` : ''}
  ${loan.bankMasked ? `<div><strong>חשבון לחיוב:</strong> <bdi dir="ltr">${esc(loan.bankMasked)}</bdi></div>` : ''}
</div>
<table>
  <thead><tr><th>#</th><th>מועד</th><th class="n">סכום</th><th class="n">שולם</th><th>תאריך תשלום</th><th class="n">נותר</th><th>מצב</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div><span>סה"כ ההלוואה</span><span>${ag(dueAg)}</span></div>
  <div><span>שולם עד כה</span><span>${ag(paidAg)}</span></div>
  ${lateAg ? `<div><span>מתוכו בפיגור</span><span>${ag(lateAg)}</span></div>` : ''}
  <div class="grand"><span>יתרה לפירעון</span><span>${ag(dueAg - paidAg)}</span></div>
</div>
<div class="notice">הלוואה ללא ריבית. דף זה מסכם את מצב ההלוואה ביום ההפקה לפי רישומי הגמ"ח. הופק במערכת SuperSuite.</div>
`;
  return htmlDoc(`דף חשבון הלוואה · ${esc(loan.borrowerName)}`, css, body);
}

// כרטסת לקוח להדפסה (קלט: bizReports.customerLedger, סכומים באגורות)
function renderCustomerLedgerHtml(l, business = {}) {
  const b = { name: '', taxId: '', address: '', phone: '', ...business };
  const color = brandColor(b);
  const ag = (a) => money(a / 100);
  const range = l.from || l.to ? `${l.from ? `מ-${esc(l.from)}` : ''}${l.from && l.to ? ' ' : ''}${l.to ? `עד ${esc(l.to)}` : ''}` : 'כל התקופה';
  const rows = (l.rows || []).map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.ref)}</td><td>${esc(r.label)}</td><td class="n">${r.debitAg ? ag(r.debitAg) : ''}</td><td class="n">${r.creditAg ? ag(r.creditAg) : ''}</td><td class="n">${ag(r.balanceAg)}</td></tr>`).join('');
  const css = `
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid ${color}; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: ${color}; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  .logo { max-height: 70px; max-width: 180px; display: block; margin-bottom: 6px; }
  .meta { text-align: left; }
  .box { margin: 16px 0; padding: 10px 14px; background: #f8fafc; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: ${color}; color: #fff; padding: 7px 6px; text-align: right; font-weight: 600; }
  td { padding: 6px; border-bottom: 1px solid #e2e8f0; }
  tr.open td { font-style: italic; color: #475569; }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 800; border-top: 2px solid ${color}; }
  .grand { margin-top: 14px; font-size: 16px; font-weight: 800; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
`;
  const closing = l.closingAg > 0 ? `יתרה לתשלום: ${ag(l.closingAg)}` : l.closingAg < 0 ? `יתרת זכות ללקוח: ${ag(-l.closingAg)}` : 'החשבון מאוזן';
  const body = `<header>
  <div>
    ${logoOk(b.logo) ? `<img class="logo" src="${b.logo}" alt="">` : ''}
    <h2>${esc(b.name)}</h2>
    ${b.taxId ? `<div>ע.מ / ח.פ: ${esc(b.taxId)}</div>` : ''}
    ${b.address ? `<div>${esc(b.address)}</div>` : ''}
    ${b.phone ? `<div>טלפון: ${esc(b.phone)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>כרטסת לקוח</h1>
    <div><strong>תקופה:</strong> ${range}</div>
  </div>
</header>
<div class="box"><strong>לכבוד:</strong> ${esc(l.customer)}</div>
<table>
  <thead><tr><th>תאריך</th><th>מסמך</th><th>פרטים</th><th class="n">חובה</th><th class="n">זכות</th><th class="n">יתרה</th></tr></thead>
  <tbody>${l.from ? `<tr class="open"><td>${esc(l.from)}</td><td></td><td>יתרת פתיחה</td><td></td><td></td><td class="n">${ag(l.openingAg)}</td></tr>` : ''}${rows}</tbody>
  <tfoot><tr><td colspan="3">סה"כ בתקופה</td><td class="n">${ag(l.debitAg)}</td><td class="n">${ag(l.creditAg)}</td><td class="n">${ag(l.closingAg)}</td></tr></tfoot>
</table>
<div class="grand">${closing}</div>
<div class="notice">הכרטסת מרכזת חשבוניות, זיכויים וגבייה לפי רישומי העסק ואינה מחליפה את המסמכים עצמם. הופק במערכת SuperSuite.</div>
`;
  return htmlDoc(`כרטסת לקוח · ${esc(l.customer)}`, css, body);
}

// CSV עם BOM כדי ש-Excel יציג עברית נכון
// הזרקת נוסחאות: תא שמתחיל ב-= + @ או טאב/חזרה, או במינוס שאינו מספר שלם בפני עצמו, יפורש כנוסחה ב-Excel.
// מינוס ואחריו ספרה אינו מספיק: "-1+1" או "-2+cmd|..." הם נוסחאות. משותף לייבוא (dataPorts מסיר את הגרש)
function csvFormulaRisk(s) {
  return /^[=+@\t\r]/.test(s) || (s[0] === '-' && !/^-\d+(?:[.,]\d+)*$/.test(s));
}

function toCsv(headers, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (csvFormulaRisk(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// דוח הפקת קבצים במבנה אחיד: נספח 4 (פרטי ההפקה וכמות הרשומות) וסעיף 2.6(ב) (כמות וסך לכל סוג מסמך)
function renderUniformReportHtml(r) {
  const recs = (r.records || []).map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.label)}</td><td class="n">${esc(x.count)}</td></tr>`).join('');
  const docs = (r.documents || []).map(d => `<tr><td>${esc(d.code)}</td><td>${esc(d.label)}</td><td class="n">${esc(d.count)}</td><td class="n">${money(d.total)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>הפקת קבצים במבנה אחיד</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 15px; margin: 20px 0 6px; }
  .meta div { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #e2e8f0; padding: 6px; text-align: right; }
  td { padding: 6px; border-bottom: 1px solid #e2e8f0; }
  td.n, th.n { text-align: left; }
</style>
</head>
<body>
<h1>הפקת קבצים במבנה אחיד</h1>
<div class="meta">
  <div>מספר עוסק מורשה: <b dir="ltr">${esc(r.vatId)}</b></div>
  <div>שם בית העסק: ${esc(r.businessName)}</div>
  <div>מספר תעודת רישום התוכנה: ${r.software && r.software.regNumber ? esc(r.software.regNumber) : 'טרם נרשמה'}</div>
  <div>שם התוכנה: ${esc(r.software && r.software.name)}</div>
  <div>הנתונים נשמרו בנתיב: <span dir="ltr">${esc(r.relPath)}</span></div>
  <div>טווח התאריכים: ${esc(r.from)} עד ${esc(r.to)}</div>
  <div>תאריך ההפקה: <span dir="ltr">${esc(r.createdDate)}</span> · שעת ההפקה: <span dir="ltr">${esc(r.createdTime)}</span></div>
</div>
<h2>פירוט סך סוגי הרשומות בקובץ BKMVDATA.TXT</h2>
<table><thead><tr><th>קוד רשומה</th><th>תיאור רשומה</th><th class="n">סך רשומות</th></tr></thead><tbody>${recs}
<tr><td></td><td><b>סה"כ</b></td><td class="n"><b>${esc(r.total)}</b></td></tr></tbody></table>
<h2>סיכום מסמכים לפי סוג</h2>
<table><thead><tr><th>מספר מסמך</th><th>סוג מסמך</th><th class="n">סך כמותי</th><th class="n">סך כספי (בש"ח)</th></tr></thead><tbody>${docs}</tbody></table>
<p>הנתונים הופקו באמצעות התוכנה: ${esc(r.software && r.software.name)} · ${esc(r.createdDate)} ${esc(r.createdTime)}</p>
</body>
</html>`;
}

module.exports = { renderInvoiceHtml, renderReceiptHtml, renderDonationReceiptHtml, renderDonorStatementHtml, renderDonorFileHtml, renderLoanStatementHtml, renderCustomerLedgerHtml, scopeCss, renderUniformReportHtml, toCsv, csvFormulaRisk, esc, money };
