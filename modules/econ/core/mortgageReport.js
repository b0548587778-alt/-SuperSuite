// דוח ממותג ללקוח של משרד ייעוץ משכנתאות — פונקציות טהורות, בלי Electron.
// הצבעים מגיעים משפת העיצוב (tokensCss = תוכן shell/design-tokens.css, מוטמע במסמך כי חלון ה-PDF
// אינו טוען קבצים). צבע המותג הוא נתון שהמשרד מקליד (#rrggbb בלבד), כמו brandColor בחשבוניות.
// הדוח מזעור מידע: שם הלקוח בלבד — בלי טלפון, ת"ז או הערות פנימיות.

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }) : '—');
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

const COLOR = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO_CHARS = 400000;
const DEFAULT_DISCLAIMER = 'הדוח מבוסס על הנתונים שנמסרו ועל תחזית ריבית ומדד שאינה ודאית. הוא אינו הצעה מחייבת — התנאים הסופיים נקבעים על ידי הבנק.';

function normalizeBrand(input, prev = {}) {
  const x = input && typeof input === 'object' ? input : {};
  const pick = (k, max) => (x[k] === undefined ? clip(prev[k], max) : clip(x[k], max));
  const color = x.brandColor === undefined ? prev.brandColor : String(x.brandColor || '');
  if (color && !COLOR.test(color)) throw new Error('צבע המותג חייב להיות בצורה #RRGGBB');
  return {
    officeName: pick('officeName', 120),
    licenseNo: pick('licenseNo', 60),
    phone: pick('phone', 40),
    email: pick('email', 120),
    address: pick('address', 200),
    disclaimer: pick('disclaimer', 600),
    brandColor: color || '',
    logo: prev.logo && LOGO.test(prev.logo) ? prev.logo : ''
  };
}

function validateLogo(dataUrl) {
  const s = String(dataUrl || '');
  if (!s) return '';
  if (s.length > MAX_LOGO_CHARS) throw new Error('קובץ הלוגו גדול מדי (עד כ-300KB)');
  if (!LOGO.test(s)) throw new Error('הלוגו חייב להיות תמונת PNG או JPEG');
  return s;
}

// CSS המסמך: רק משתני --ss-*; צבע המותג (אם הוזן) מחליף את --rep-brand
function reportCss(tokensCss, brandColor) {
  return `${tokensCss || ''}
  :root { --rep-brand: ${brandColor && COLOR.test(brandColor) ? brandColor : 'var(--ss-navy-2)'}; }
  @page { size: A4; margin: 16mm; }
  body { font-family: var(--ss-font); color: var(--ss-text); margin: 0; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 3px solid var(--rep-brand); padding-bottom: 12px; }
  header img { max-height: 64px; max-width: 180px; }
  h1 { margin: 0; font-size: 22px; color: var(--rep-brand); }
  h2 { margin: 22px 0 6px; font-size: 16px; color: var(--rep-brand); }
  .office { line-height: 1.6; font-size: 12px; color: var(--ss-text-2); }
  .box { margin: 12px 0; padding: 10px 14px; background: var(--ss-surface-2); border-radius: 6px; line-height: 1.8; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: var(--rep-brand); color: var(--ss-surface); padding: 6px; text-align: right; font-weight: 600; }
  td { padding: 6px; border-bottom: 1px solid var(--ss-border); }
  .n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.best td { font-weight: 700; }
  .tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--ss-warning-soft); color: var(--ss-warning-ink); }
  .notice { margin-top: 26px; font-size: 11px; color: var(--ss-muted); border-top: 1px dashed var(--ss-border-strong); padding-top: 8px; }
`;
}

// data: { client (תצוגה), brand, asOf, comparison (תוצאת compareApprovals או null), chosen (אישור נבחר או null),
//         chosenResult (תוצאת המנוע לאישור הנבחר: summary + yearly), missingDocs: [תווית] }
function renderClientReportHtml(data, tokensCss) {
  const { client = {}, asOf = '', comparison = null, chosen = null, chosenResult = null, missingDocs = [] } = data || {};
  const brand = normalizeBrand(data && data.brand, data && data.brand);
  const ltv = client.propertyValue ? Math.round(client.requestedAmount / client.propertyValue * 1000) / 10 : null;
  const contact = [brand.phone, brand.email, brand.address].filter(Boolean).map(esc).join(' · ');
  const rank = comparison ? Object.fromEntries((comparison.byTotalCost || []).map((id, i) => [id, i + 1])) : {};
  const body = `<header>
  <div>
    <h1>${esc(brand.officeName || 'ייעוץ משכנתאות')}</h1>
    <div class="office">${brand.licenseNo ? `רישיון: ${esc(brand.licenseNo)}<br>` : ''}${contact}</div>
  </div>
  ${brand.logo ? `<img src="${brand.logo}" alt="">` : ''}
</header>
<h2>סיכום ייעוץ משכנתא</h2>
<div class="box">
  <strong>עבור:</strong> ${esc(client.name)}<br>
  ${asOf ? `<strong>תאריך:</strong> ${esc(asOf)}<br>` : ''}
  <strong>סכום ההלוואה המבוקש:</strong> ${money(client.requestedAmount)}
  ${client.propertyValue ? `<br><strong>שווי הנכס:</strong> ${money(client.propertyValue)} · <strong>שיעור מימון:</strong> ${ltv}%` : ''}
</div>
${comparison && Array.isArray(comparison.offers) && comparison.offers.length ? `<h2>השוואת אישורים עקרוניים</h2>
<table><thead><tr><th>דירוג</th><th>בנק</th><th class="n">החזר ראשון</th><th class="n">החזר מקסימלי</th><th class="n">עלות כוללת עם עמלות</th><th>הערות</th></tr></thead>
<tbody>${comparison.offers.map(x => `<tr${rank[x.offer.id] === 1 ? ' class="best"' : ''}><td>${rank[x.offer.id] || '—'}</td><td>${esc(x.offer.lender)}</td>
  <td class="n">${x.result ? money(x.result.summary.firstPayment) : '—'}</td><td class="n">${x.result ? money(x.result.summary.maxPayment) : '—'}</td>
  <td class="n">${x.totalCostWithFees == null ? '—' : money(x.totalCostWithFees)}</td>
  <td>${[x.expired ? '<span class="tag">פג תוקף</span>' : '', x.overMax ? '<span class="tag">מעל הסכום המאושר</span>' : ''].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table>` : ''}
${chosen ? `<h2>ההמלצה: ${esc(chosen.lender)}</h2>
<table><thead><tr><th>מסלול</th><th class="n">חלק מהסכום</th><th class="n">שנים</th><th class="n">ריבית / מרווח</th></tr></thead>
<tbody>${(chosen.tracks || []).map(t => `<tr><td>${esc(TRACK_LABELS[t.type] || t.type)}</td><td class="n">${esc(t.share)}%</td><td class="n">${esc(t.years)}</td>
  <td class="n">${t.ratePct !== undefined ? esc(t.ratePct) + '%' : t.spreadPct !== undefined ? 'מרווח ' + esc(t.spreadPct) + '%' : '—'}</td></tr>`).join('')}</tbody></table>
${chosenResult && chosenResult.summary ? `<div class="box">
  <strong>החזר חודשי ראשון:</strong> ${money(chosenResult.summary.firstPayment)} · <strong>החזר מקסימלי:</strong> ${money(chosenResult.summary.maxPayment)}<br>
  <strong>סך כל התשלומים (לפי התחזית):</strong> ${money(chosenResult.summary.totalPaid)}
</div>` : ''}
${chosenResult && Array.isArray(chosenResult.yearly) && chosenResult.yearly.length ? `<table><thead><tr><th>שנה</th><th class="n">תשלומים בשנה</th><th class="n">יתרה בסוף השנה</th></tr></thead>
<tbody>${chosenResult.yearly.map(y => `<tr><td>${esc(y.year)}</td><td class="n">${money(y.payment)}</td><td class="n">${money(y.balance)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
${Array.isArray(missingDocs) && missingDocs.length ? `<h2>מסמכים שעדיין חסרים</h2><ul>${missingDocs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
<div class="notice">${esc(brand.disclaimer || DEFAULT_DISCLAIMER)}</div>
`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>סיכום ייעוץ משכנתא — ${esc(client.name)}</title>
<style>${reportCss(tokensCss, brand.brandColor)}</style>
</head>
<body>
${body}</body>
</html>`;
}

const TRACK_LABELS = {
  PRIME: 'פריים', FIXED_UNLINKED: 'קבועה לא צמודה', FIXED_LINKED: 'קבועה צמודה', VARIABLE_UNLINKED: 'משתנה לא צמודה',
  VARIABLE_LINKED: 'משתנה צמודה', ELIGIBILITY: 'משכנתא זכאות', BRIDGE: 'הלוואת גישור'
};

module.exports = { DEFAULT_DISCLAIMER, normalizeBrand, validateLogo, renderClientReportHtml };
