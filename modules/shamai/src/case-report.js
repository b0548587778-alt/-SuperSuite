// שמאי — דוח שמאות מקצועי מתיק השמאות, בעברית או דו-לשוני (עברית ואנגלית). חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד).
'use strict';
// מבנה הדוח: פרטי הדוח ← מזמין ומטרה ← בסיס השווי והגדרתו ← היקף העבודה ← הפריטים (זיהוי, רכיבים, תמונות, שווי) ←
// סיכום ← המחירים והשערים ששימשו (תאריך ומקור) ← הנחות ומגבלות ← הצהרת השמאי וחתימה.
// טהור: מקבל את כל הנתונים ומחזיר HTML. כל ערך עובר escape; תמונה — רק data:image שעברה caseIsPhoto.

const CASE_L = {
  title: ['דוח שמאות', 'Appraisal Report'],
  draft: ['טיוטה — לא לשימוש', 'DRAFT — not for use'],
  reportNo: ['מספר דוח', 'Report no.'],
  reportDate: ['תאריך הדוח', 'Report date'],
  effectiveDate: ['המועד הקובע', 'Valuation date'],
  inspectionDate: ['תאריך הבדיקה', 'Inspection date'],
  revisionOf: ['גרסה מתוקנת של דוח', 'Revised version of report'],
  appraiser: ['השמאי', 'Appraiser'],
  client: ['המזמין', 'Client'],
  name: ['שם', 'Name'],
  idNumber: ['מספר זהות', 'ID no.'],
  phone: ['טלפון', 'Phone'],
  email: ['דוא"ל', 'Email'],
  address: ['כתובת', 'Address'],
  purpose: ['מטרת השמאות', 'Intended use'],
  basis: ['בסיס השווי', 'Basis of value'],
  scope: ['היקף העבודה', 'Scope of work'],
  items: ['הפריטים', 'Items'],
  item: ['פריט', 'Item'],
  category: ['סוג', 'Type'],
  description: ['תיאור', 'Description'],
  marks: ['חותמות וסימנים', 'Marks'],
  condition: ['מצב', 'Condition'],
  dimensions: ['מידות', 'Dimensions'],
  metals: ['מתכות', 'Metals'],
  metal: ['מתכת', 'Metal'],
  purity: ['טוהר', 'Fineness'],
  weight: ['משקל (גרם)', 'Weight (g)'],
  fine: ['משקל טהור', 'Fine weight'],
  value: ['שווי', 'Value'],
  stones: ['אבנים', 'Stones'],
  stone: ['אבן', 'Stone'],
  count: ['כמות', 'Qty'],
  carat: ['קראט', 'Carat'],
  origin: ['מקור', 'Origin'],
  idMethod: ['זיהוי', 'Identification'],
  grading: ['דירוג', 'Grading'],
  treatment: ['טיפול', 'Treatment'],
  price: ['מחיר', 'Price'],
  perCarat: ['לקראט', 'per ct'],
  perPiece: ['ליחידה', 'per piece'],
  labour: ['עבודה וייצור', 'Workmanship'],
  other: ['רכיב אחר', 'Other component'],
  computed: ['שווי מחושב', 'Computed value'],
  concluded: ['השווי שנקבע', 'Concluded value'],
  reason: ['נימוק', 'Reason'],
  summary: ['סיכום', 'Summary'],
  total: ['סך השווי', 'Total value'],
  inCurrency: ['במטבע הדוח', 'In report currency'],
  prices: ['מחירים ושערים ששימשו', 'Prices and rates used'],
  source: ['מקור', 'Source'],
  date: ['תאריך', 'Date'],
  assumptions: ['הנחות ומגבלות', 'Assumptions and limiting conditions'],
  declaration: ['הצהרת השמאי', 'Appraiser\'s statement'],
  signature: ['חתימת השמאי', 'Appraiser\'s signature'],
  noAppraiser: ['לא הוזנו פרטי שמאי (כלים ← הגדרות ← פרטי השמאי)', 'Appraiser details were not entered'],
  photos: ['תמונות', 'Photographs'],
  page: ['עמוד', 'Page'],
};

const CASE_PRICE_LABELS = {
  gold: ['זהב', 'Gold', '$ לאונקיה', 'USD/oz'], silver: ['כסף', 'Silver', '$ לאונקיה', 'USD/oz'],
  platinum: ['פלטינה', 'Platinum', '$ לאונקיה', 'USD/oz'], palladium: ['פלדיום', 'Palladium', '$ לאונקיה', 'USD/oz'],
  usdIls: ['דולר', 'USD', '₪', 'ILS'], eurIls: ['אירו', 'EUR', '₪', 'ILS'], gbpIls: ['לירה שטרלינג', 'GBP', '₪', 'ILS'],
};

// תוויות באנגלית לשדות של פרטי השמאי (report.js)
const CASE_APPRAISER_EN = { name: "Appraiser", business: "Business", license: "Licence / business no.", phone: "Phone", address: "Address" };

const caseEsc = (v) => escapeHtml(String(v ?? ''));
const caseDay = (d) => (caseIsDay(d) ? shortDay(d) : '—');

// תווית לפי שפת הדוח: "עברית" או "עברית / English"
function caseLabel(key, bi) {
  const [he, en] = CASE_L[key];
  return bi ? `${caseEsc(he)} <span class="en">/ ${caseEsc(en)}</span>` : caseEsc(he);
}
// שם מתוך טבלה עם he/en
function caseName(obj, bi) {
  if (!obj) return '—';
  return bi ? `${caseEsc(obj.he)} <span class="en">/ ${caseEsc(obj.en)}</span>` : caseEsc(obj.he);
}
const caseRow = (labelHtml, valueHtml) => `<div class="row"><span class="label">${labelHtml}:</span> <span class="value">${valueHtml}</span></div>`;
// טקסט חופשי מרובה שורות
const caseMultiline = (s) => caseEsc(s).replace(/\n/g, '<br>');

function caseStoneGrading(s) {
  return [s.shape, s.color, s.clarity].filter(Boolean).join(' · ') || '—';
}

function caseItemHtml(it, v, n, bi, photos) {
  const metals = v.metals.length ? `
    <h4>${caseLabel('metals', bi)}</h4>
    <table><thead><tr><th>${caseLabel('metal', bi)}</th><th>${caseLabel('purity', bi)}</th><th>${caseLabel('weight', bi)}</th><th>${caseLabel('fine', bi)}</th><th>${caseLabel('value', bi)}</th></tr></thead>
    <tbody>${v.metals.map(m => `<tr><td>${caseName(CASE_METALS[m.metal], bi)}</td><td>${m.purityPpt}/1000</td><td>${fmt(m.grams, 2)}</td><td>${fmt(m.fineGrams, 3)}</td><td>${caseMoney(m.valueAg)}</td></tr>`).join('')}</tbody></table>` : '';
  const stones = v.stones.length ? `
    <h4>${caseLabel('stones', bi)}</h4>
    <table><thead><tr><th>${caseLabel('stone', bi)}</th><th>${caseLabel('count', bi)}</th><th>${caseLabel('carat', bi)}</th><th>${caseLabel('grading', bi)}</th><th>${caseLabel('origin', bi)}</th><th>${caseLabel('idMethod', bi)}</th><th>${caseLabel('price', bi)}</th><th>${caseLabel('value', bi)}</th></tr></thead>
    <tbody>${v.stones.map(s => `<tr>
      <td>${caseName(CASE_STONES[s.type], bi)}${s.name ? ' — ' + caseEsc(s.name) : ''}${s.treatment ? `<div class="sub">${caseLabel('treatment', bi)}: ${caseEsc(s.treatment)}</div>` : ''}</td>
      <td>${s.count}</td><td>${s.carat !== null ? fmt(s.carat, 3) : '—'}</td><td>${caseEsc(caseStoneGrading(s))}</td>
      <td>${caseName(CASE_STONE_ORIGINS[s.origin], bi)}</td>
      <td>${caseName(CASE_ID_METHODS[s.idMethod], bi)}${s.idMethod === 'lab' && (s.lab || s.certNo) ? `<div class="sub">${caseEsc([s.lab, s.certNo].filter(Boolean).join(' '))}</div>` : ''}</td>
      <td>${caseMoney(s.price, s.currency)} ${caseLabel(s.pricing === 'perPiece' ? 'perPiece' : 'perCarat', bi)}</td>
      <td>${caseMoney(s.valueAg)}</td></tr>`).join('')}</tbody></table>` : '';
  // רק data:image תקינה, גם כשהקורא שכח לסנן (ערך עם מירכאות מגיבוי ששוחזר היה פורץ מהמאפיין)
  const ok = (photos || []).filter(caseIsPhoto);
  const pics = ok.length ? `<div class="photos">${ok.map((p, i) => `<img src="${caseEsc(p)}" alt="${caseEsc(CASE_L.item[0] + ' ' + n + ' — ' + (i + 1))}" />`).join('')}</div>` : '';
  return `<section class="item">
    <h3>${caseLabel('item', bi)} ${n}: ${caseEsc(it.desc)}${bi && it.descEn ? ` <span class="en">/ ${caseEsc(it.descEn)}</span>` : ''}</h3>
    ${caseRow(caseLabel('category', bi), caseName(CASE_CATEGORIES[it.category], bi))}
    ${it.marks ? caseRow(caseLabel('marks', bi), caseEsc(it.marks)) : ''}
    ${it.dimensions ? caseRow(caseLabel('dimensions', bi), caseEsc(it.dimensions)) : ''}
    ${it.condition ? caseRow(caseLabel('condition', bi), caseEsc(it.condition)) : ''}
    ${metals}${stones}
    ${v.labourAg ? caseRow(caseLabel('labour', bi), caseMoney(v.labourAg)) : ''}
    ${v.otherAg ? caseRow(caseLabel('other', bi) + (it.otherLabel ? ' — ' + caseEsc(it.otherLabel) : ''), caseMoney(v.otherAg)) : ''}
    ${v.overrideAg !== null ? caseRow(caseLabel('computed', bi), caseMoney(v.computedAg)) + caseRow(caseLabel('reason', bi), caseEsc(v.overrideReason)) : ''}
    <div class="item-total">${caseRow(caseLabel('concluded', bi), '<strong>' + caseMoney(v.valueAg) + '</strong>')}</div>
    ${pics}
  </section>`;
}

// c — התיק; prices — המחירים הנוכחיים (לטיוטה); ap / apEn — פרטי השמאי; photosById — { id: dataUrl }
function buildCaseReportHtml(c, prices, ap, apEn, photosById, today = localToday()) {
  const bi = c.lang === 'he-en';
  const final = c.status === 'final' && c.frozen;
  const usePrices = casePricesFor(c, prices);
  const totals = final ? { items: c.frozen.items, totalAg: c.frozen.totalAg } : caseTotals(c, prices);
  const reportTotal = final ? c.frozen.reportTotal : caseFromIlsAg(totals.totalAg, c.currency, prices);
  const reportDate = final ? c.reportDate : today;
  const priceSnap = final ? c.frozen.prices : Object.fromEntries(casePriceKeys(c).map(k => {
    const f = priceFreshness(prices, k, today);
    return [k, { value: Number(prices[k]), date: f.date, source: f.source, note: f.note }];
  }));
  const a = ap || {}, ae = apEn || {};
  const apRows = APPRAISER_FIELDS.filter(f => a[f.k]).map(f => caseRow(caseEsc(f.label) + (bi && CASE_APPRAISER_EN[f.k] ? ` <span class="en">/ ${caseEsc(CASE_APPRAISER_EN[f.k])}</span>` : ""), caseEsc(a[f.k]) + (bi && ae[f.k] ? ` <span class="en">/ ${caseEsc(ae[f.k])}</span>` : ''))).join('');
  const purpose = CASE_PURPOSES[c.purpose];
  const basis = CASE_BASES[c.basis];
  const cl = c.client || {};
  const photosOf = (it) => (it.photos || []).map(id => photosById && photosById[id]).filter(caseIsPhoto);
  // errors — רק של הפריטים שנכשלו, לפי הסדר: לכל פריט כזה השגיאה שלו (פעם הראשונה הוצגה ליד כולם)
  let errAt = 0;
  const itemsHtml = (c.items || []).map((it, i) => {
    const v = totals.items[i];
    return v ? caseItemHtml(it, v, i + 1, bi, photosOf(it)) : `<section class="item"><h3>${caseLabel('item', bi)} ${i + 1}: ${caseEsc(it.desc)}</h3><p class="warn">${caseEsc((totals.errors || [])[errAt++] || '')}</p></section>`;
  }).join('');
  const priceRows = Object.entries(priceSnap).map(([k, p]) => {
    const L = CASE_PRICE_LABELS[k];
    if (!L) return '';
    const src = PRICE_SOURCES[p.source] || '';
    return `<tr><td>${bi ? `${caseEsc(L[0])} <span class="en">/ ${caseEsc(L[1])}</span>` : caseEsc(L[0])}</td><td>${fmt(p.value, /Ils$/.test(k) ? 3 : 2)} ${caseEsc(bi ? L[3] : L[2])}</td><td>${p.date ? caseDay(p.date) : '—'}</td><td>${caseEsc(src)}${p.note ? ' — ' + caseEsc(p.note) : ''}</td></tr>`;
  }).join('');
  const tests = (c.tests || []).filter(t => CASE_TESTS[t]).map(t => `<li>${caseName(CASE_TESTS[t], bi)}</li>`).join('');
  const repNo = caseReportNo(c);
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${caseEsc(CASE_L.title[0])} ${caseEsc(repNo)} — ${caseEsc(cl.name)}</title>
  <style>
    @page { margin: 1.8cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.55; color: black; max-width: 760px; margin: 0 auto; padding: 16px; background: white; }
    h1 { border-bottom: 3px solid darkgoldenrod; padding-bottom: 6px; margin-bottom: 4px; }
    h2 { margin-top: 22px; border-bottom: 1px solid silver; padding-bottom: 3px; font-size: 19px; }
    h3 { font-size: 16px; margin: 16px 0 6px; }
    h4 { font-size: 14px; margin: 10px 0 4px; }
    .en { color: dimgray; font-size: 0.9em; }
    .draft { border: 2px dashed firebrick; color: firebrick; text-align: center; padding: 6px; font-weight: bold; margin: 8px 0; }
    .meta { background: whitesmoke; padding: 10px; border-radius: 4px; margin: 10px 0; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dotted silver; }
    .label { color: dimgray; }
    .value { font-weight: bold; text-align: left; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 13px; }
    th, td { border: 1px solid silver; padding: 4px 6px; text-align: right; vertical-align: top; }
    th { background: whitesmoke; }
    .sub { color: dimgray; font-size: 12px; }
    .item { border: 1px solid silver; border-radius: 4px; padding: 6px 12px 10px; margin: 12px 0; page-break-inside: avoid; }
    .item-total { margin-top: 6px; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .photos img { width: 160px; height: 160px; object-fit: contain; border: 1px solid silver; padding: 2px; }
    .total { font-size: 18px; }
    .text { background: whitesmoke; border: 1px solid gainsboro; padding: 10px; border-radius: 4px; }
    .warn { color: firebrick; }
    .signature-area { margin-top: 50px; display: flex; justify-content: space-between; }
    .signature-line { border-top: 1px solid black; padding-top: 4px; width: 40%; text-align: center; font-size: 12px; }
    .footer { margin-top: 30px; border-top: 2px solid darkgoldenrod; padding-top: 8px; font-size: 11px; color: dimgray; text-align: center; }
  </style>
</head>
<body>
  <h1>${caseLabel('title', bi)}</h1>
  ${final ? '' : `<div class="draft">${caseLabel('draft', bi)}</div>`}
  <div class="meta">
    ${caseRow(caseLabel('reportNo', bi), caseEsc(repNo))}
    ${caseRow(caseLabel('reportDate', bi), caseDay(reportDate))}
    ${caseRow(caseLabel('effectiveDate', bi), caseDay(c.effectiveDate))}
    ${caseRow(caseLabel('inspectionDate', bi), caseDay(c.inspectionDate))}
    ${c.rev ? caseRow(caseLabel('revisionOf', bi), caseEsc(String(c.no) + (c.rev > 1 ? '-' + (c.rev - 1) : ''))) : ''}
  </div>

  <h2>${caseLabel('appraiser', bi)}</h2>
  ${apRows || `<p class="warn">${caseLabel('noAppraiser', bi)}</p>`}

  <h2>${caseLabel('client', bi)}</h2>
  ${caseRow(caseLabel('name', bi), caseEsc(cl.name))}
  ${cl.idNumber ? caseRow(caseLabel('idNumber', bi), caseEsc(cl.idNumber)) : ''}
  ${cl.phone ? caseRow(caseLabel('phone', bi), caseEsc(cl.phone)) : ''}
  ${cl.email ? caseRow(caseLabel('email', bi), caseEsc(cl.email)) : ''}
  ${cl.address ? caseRow(caseLabel('address', bi), caseEsc(cl.address)) : ''}
  ${caseRow(caseLabel('purpose', bi), caseName(purpose, bi) + (c.purpose === 'other' && c.purposeOther ? ' — ' + caseEsc(c.purposeOther) : ''))}

  <h2>${caseLabel('basis', bi)}: ${caseName(basis, bi)}</h2>
  <div class="text">${basis ? caseEsc(basis.defHe) + (bi ? `<br><span class="en">${caseEsc(basis.defEn)}</span>` : '') : ''}</div>

  <h2>${caseLabel('scope', bi)}</h2>
  ${tests ? `<ul>${tests}</ul>` : ''}
  ${c.scopeNote ? `<div class="text">${caseMultiline(c.scopeNote)}</div>` : ''}

  <h2>${caseLabel('items', bi)}</h2>
  ${itemsHtml}

  <h2>${caseLabel('summary', bi)}</h2>
  <div class="total">${caseRow(caseLabel('total', bi), '<strong>' + caseMoney(totals.totalAg) + '</strong>')}</div>
  ${c.currency !== 'ILS' && reportTotal !== null ? caseRow(caseLabel('inCurrency', bi), caseMoney(reportTotal, c.currency)) : ''}

  <h2>${caseLabel('prices', bi)}</h2>
  ${priceRows ? `<table><thead><tr><th>${caseLabel('price', bi)}</th><th>${caseLabel('value', bi)}</th><th>${caseLabel('date', bi)}</th><th>${caseLabel('source', bi)}</th></tr></thead><tbody>${priceRows}</tbody></table>` : '<p>—</p>'}

  <h2>${caseLabel('assumptions', bi)}</h2>
  <div class="text">${caseMultiline(c.assumptionsHe)}${bi && c.assumptionsEn ? `<br><br><span class="en">${caseMultiline(c.assumptionsEn)}</span>` : ''}</div>

  <h2>${caseLabel('declaration', bi)}</h2>
  <div class="text">${caseMultiline(a.declaration || DEFAULT_DECLARATION)}${bi && ae.declaration ? `<br><br><span class="en">${caseMultiline(ae.declaration)}</span>` : ''}</div>

  <div class="signature-area">
    <div class="signature-line">${caseLabel('signature', bi)}${a.name ? ' — ' + caseEsc(a.name) : ''}</div>
    <div class="signature-line">${caseLabel('date', bi)}</div>
  </div>

  <div class="footer">${caseEsc(a.business || a.name || '')} | ${caseLabel('reportNo', bi)} ${caseEsc(repNo)} | ${caseDay(reportDate)}</div>
</body>
</html>`;
}
