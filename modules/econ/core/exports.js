// Exports - בניית מסמכים לייצוא (HTML לחשבונית/PDF, CSV לאקסל). פונקציות טהורות, בלי גישה ל-Electron.

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => '₪' + Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// חשבונית מס כ-HTML מוכן להדפסה / המרה ל-PDF
function renderInvoiceHtml(invoice, business = {}) {
  const b = { name: '', taxId: '', address: '', phone: '', email: '', ...business };
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
<title>חשבונית מס ${esc(invoice.number)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; color: #1d4ed8; }
  .biz h2 { margin: 0 0 4px; font-size: 16px; }
  .meta { text-align: left; }
  .meta div { margin-bottom: 4px; }
  .customer { margin: 18px 0; padding: 10px 14px; background: #f8fafc; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1d4ed8; color: #fff; padding: 8px; text-align: right; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
  td.n, th.n { text-align: left; }
  .totals { margin-top: 16px; margin-inline-start: auto; width: 60%; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #e2e8f0; }
  .totals .grand { font-size: 16px; font-weight: 800; border-bottom: 2px solid #1d4ed8; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <div class="biz">
    <h2>${esc(b.name)}</h2>
    ${b.taxId ? `<div>ע.מ / ח.פ: ${esc(b.taxId)}</div>` : ''}
    ${b.address ? `<div>${esc(b.address)}</div>` : ''}
    ${b.phone ? `<div>טלפון: ${esc(b.phone)}</div>` : ''}
    ${b.email ? `<div>${esc(b.email)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>${invoice.vatExempt ? 'חשבונית עסקה' : 'חשבונית מס'}</h1>
    <div><strong>מספר:</strong> ${esc(invoice.number)}</div>
    <div><strong>תאריך:</strong> ${esc(invoice.date)}</div>
  </div>
</header>
<div class="customer"><strong>לכבוד:</strong> ${esc(invoice.customer)}</div>
<table>
  <thead><tr><th>#</th><th>תיאור</th><th class="n">כמות</th><th class="n">מחיר ליחידה</th><th class="n">סה"כ לפני מע"מ</th></tr></thead>
  <tbody>${rows}
  </tbody>
</table>
<div class="totals">
  <div><span>סה"כ לפני מע"מ</span><span>${money(invoice.net)}</span></div>
  <div><span>מע"מ ${invoice.vatExempt ? '(פטור)' : ''}</span><span>${money(invoice.vat)}</span></div>
  <div class="grand"><span>סה"כ לתשלום</span><span>${money(invoice.total)}</span></div>
</div>
<div class="notice">מסמך זה הופק במערכת SuperSuite. חשבונית מס תקפה לפי חוק דורשת הקצאת מספר מרשות המסים; ללא הקצאה אין לראות במסמך זה חשבונית מס מאושרת.</div>
</body>
</html>`;
}

const METHOD_LABELS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', standing: 'הוראת קבע' };

// קבלה על תרומה (עמותה) כ-HTML להדפסה / PDF. הפרטים נלקחים מהקבלה עצמה (מוקפאים ביום ההפקה).
function renderDonationReceiptHtml(d) {
  const r = d.receipt || {};
  const o = r.org || {};
  const cancelled = d.status === 'cancelled';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>קבלה על תרומה ${esc(r.number)}</title>
<style>
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
  .void { color: #b91c1c; font-size: 20px; font-weight: 800; text-align: center; border: 3px solid #b91c1c; padding: 8px; margin-top: 12px; }
  .notice { margin-top: 26px; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
</style>
</head>
<body>
<header>
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
  <div class="row"><span>התקבל מאת</span><span>${esc(d.donorName)}${d.donorId ? ` · ת.ז/ח.פ ${esc(d.donorId)}` : ''}</span></div>
  ${d.donorAddress ? `<div class="row"><span>כתובת</span><span>${esc(d.donorAddress)}</span></div>` : ''}
  <div class="row"><span>אמצעי תשלום</span><span>${esc(METHOD_LABELS[d.method] || d.method)}${d.reference ? ` · אסמכתא ${esc(d.reference)}` : ''}</span></div>
  <div class="row"><span>ייעוד</span><span>${esc(r.fundName || 'כללי')}${d.purpose ? ` — ${esc(d.purpose)}` : ''}</span></div>
  <div class="row amount"><span>סכום התרומה</span><span>${money(d.amount)}</span></div>
</div>
${r.sec46 ? `<div class="s46">התרומה מוכרת לזיכוי ממס לפי סעיף 46 לפקודת מס הכנסה · אישור מס' ${esc(r.sec46Number)}${r.sec46ValidUntil ? ` · בתוקף עד ${esc(r.sec46ValidUntil)}` : ''}</div>` : ''}
<div class="notice">מסמך זה הופק במערכת SuperSuite. האחריות לתוקף אישור סעיף 46 ולדיווח לרשויות חלה על העמותה.</div>
</body>
</html>`;
}

// CSV עם BOM כדי ש-Excel יציג עברית נכון
function toCsv(headers, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    // הזרקת נוסחאות: תא שמתחיל ב-= + @ או טאב/חזרה, או במינוס שאינו מספר, יפורש כנוסחה ב-Excel — מנטרלים עם גרש
    if (/^[=+@\t\r]|^-(?!\d)/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { renderInvoiceHtml, renderDonationReceiptHtml, toCsv, esc, money };
