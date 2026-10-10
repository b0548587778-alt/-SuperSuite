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

module.exports = { renderInvoiceHtml, toCsv, esc, money };
