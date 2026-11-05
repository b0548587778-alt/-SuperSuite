// שמאי — קניית זהב וכסף מלקוח (PLAN.md 9.18). חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד).
'use strict';
// זרימה: פריטים (מתכת, טוהר, משקל) × מחיר היום ← שווי התכה, פחות עמלה ← סכום לתשלום. הכול באגורות שלמות.
// שטר קנייה ממוספר (לא חוזר אחורה) עם פרטי המוכר והצהרתו, ורישום לכל קנייה ביומן ההזדמנויות כ"נקנה".

const PURCHASE_PURITIES = {
  gold: [999, 916, 875, 750, 583, 417, 375],
  silver: [999, 925, 900, 835, 800],
};
const PURCHASE_METAL_NAMES = { gold: 'זהב', silver: 'כסף' };
const PURCHASE_PAY_METHODS = { cash: 'מזומן', transfer: 'העברה בנקאית', cheque: 'המחאה' };
const PURCHASE_MAX_LINES = 30;
const PURCHASE_MAX_COMMISSION_BP = 5000; // 50%
// תקרת מזומן לעסק (חוק לצמצום השימוש במזומן) — אזהרה בלבד; התקרה מתעדכנת, לבדוק לפני שימוש
const PURCHASE_CASH_WARN_AG = 600000;
const DEFAULT_SELLER_DECLARATION = 'אני המוכר מצהיר כי הפריטים המפורטים בשטר זה הם בבעלותי המלאה, אינם משועבדים ואינם גנובים, וכי קיבלתי את התמורה הנקובה במלואה.';

// ספרת ביקורת של מספר זהות (עד 9 ספרות, משלימים באפסים משמאל)
function isValidIsraeliIdNumber(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{5,9}$/.test(s) || /^0+$/.test(s)) return false;
  const id = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

// שקלים מהקלדה ← אגורות שלמות, או null
function parseAgorot(raw) {
  const s = normalizeNumText(raw);
  if (s === null || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ''] = s.split('.');
  return Number(a) * 100 + Number((b + '00').slice(0, 2));
}

// שורה אחת: שווי התכה באגורות (עיגול לכל שורה). זורק שגיאה בעברית על קלט לא תקין
function purchaseLineAg(line, prices, n = 1) {
  const metal = line && line.metal;
  if (!PURCHASE_PURITIES[metal]) throw new Error(`שורה ${n}: מתכת לא מוכרת`);
  const purity = Number(line.purityPpt);
  if (!PURCHASE_PURITIES[metal].includes(purity)) throw new Error(`שורה ${n}: טוהר לא מוכר`);
  const gramsText = normalizeNumText(line.grams);
  const grams = gramsText === null ? NaN : Number(gramsText);
  if (!(grams > 0 && grams <= 100000)) throw new Error(`שורה ${n}: יש להזין משקל בגרמים`);
  const spot = Number(prices && prices[metal]);
  const usdIls = Number(prices && prices.usdIls);
  if (!(spot > 0) || !(usdIls > 0)) throw new Error('חסר מחיר מתכת או שער דולר');
  const pureGrams = grams * purity / 1000;
  const perGramAg = spot / TROY_OZ * usdIls * 100;
  return { metal, purityPpt: purity, grams, pureGrams, valueAg: Math.round(pureGrams * perGramAg), desc: String(line.desc || '').trim().slice(0, 80) };
}

// חישוב הקנייה: שווי, עמלה (נקודות בסיס) וסכום לתשלום — באגורות
function computePurchase({ lines, prices, commissionBp = 0 }) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) throw new Error('יש להוסיף פריט אחד לפחות');
  if (list.length > PURCHASE_MAX_LINES) throw new Error(`עד ${PURCHASE_MAX_LINES} פריטים בשטר אחד`);
  const bp = Number(commissionBp);
  if (!Number.isInteger(bp) || bp < 0 || bp > PURCHASE_MAX_COMMISSION_BP) throw new Error('העמלה צריכה להיות בין 0% ל-50%');
  const out = list.map((l, i) => purchaseLineAg(l, prices, i + 1));
  const grossAg = out.reduce((s, l) => s + l.valueAg, 0);
  const commissionAg = Math.round(grossAg * bp / 10000);
  return { lines: out, grossAg, commissionBp: bp, commissionAg, netAg: grossAg - commissionAg };
}

// אחוז מהקלדה ("3.5") ← נקודות בסיס (350), בלי נקודה צפה
function percentToBp(raw) {
  const s = String(raw ?? '').trim() || '0';
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return NaN;
  const [a, b = ''] = s.split('.');
  return Number(a) * 100 + Number((b + '00').slice(0, 2));
}

function validateSeller(s) {
  const seller = {
    name: String((s && s.name) || '').trim().slice(0, 80),
    idNumber: String((s && s.idNumber) || '').trim(),
    phone: String((s && s.phone) || '').trim().slice(0, 30),
    address: String((s && s.address) || '').trim().slice(0, 120),
  };
  if (!seller.name) throw new Error('יש להזין את שם המוכר');
  if (!isValidIsraeliIdNumber(seller.idNumber)) throw new Error('מספר הזהות של המוכר אינו תקין');
  seller.idNumber = seller.idNumber.padStart(9, '0');
  return seller;
}

// אזהרות לפני הפקה: מחיר ישן / לא עודכן לכל מתכת שבשימוש ולדולר, ומזומן מעל התקרה
function purchaseWarnings(result, payMethod, prices, today = localToday()) {
  const keys = [...new Set(result.lines.map(l => l.metal)), 'usdIls'];
  const warn = [];
  for (const k of keys) {
    const f = priceFreshness(prices, k, today);
    if (f.state === 'fresh') continue;
    const name = PRICE_FIELDS.find(x => x.k === k).name;
    warn.push(`${name}: ${priceAgeLabel(f)}`);
  }
  if (payMethod === 'cash' && result.netAg > PURCHASE_CASH_WARN_AG) warn.push(`תשלום במזומן מעל ₪${fmt0(PURCHASE_CASH_WARN_AG / 100)} — יש לבדוק את התקרה לפי החוק לצמצום השימוש במזומן`);
  return warn;
}

// רשומת שטר: עותק של המחירים ותאריכיהם ביום הקנייה, כדי שהדפסה חוזרת תציג את אותם סכומים
function createPurchase(input, { no, today = localToday(), prices }) {
  const seller = validateSeller(input.seller);
  const result = computePurchase({ lines: input.lines, prices, commissionBp: input.commissionBp });
  const payMethod = PURCHASE_PAY_METHODS[input.payMethod] ? input.payMethod : 'cash';
  const snap = {};
  for (const k of ['gold', 'silver', 'usdIls']) snap[k] = { value: prices[k], date: priceFreshness(prices, k, today).date };
  return {
    id: uid(), no, date: today, seller, payMethod,
    notes: String(input.notes || '').trim().slice(0, 300),
    prices: snap, ...result,
  };
}

const agToIls = (ag) => '₪' + fmt(ag / 100, 2);

// פרטי השמאי לשטר: מזמן ההפקה; שטר ישן בלי עותק — הפרטים הנוכחיים
function purchaseAppraiser(p) {
  return p && p.appraiser && typeof p.appraiser === 'object' ? p.appraiser : loadAppraiser();
}

// טהור: HTML של שטר הקנייה (כל ערך עובר escape)
function buildPurchaseHtml(p, appraiser) {
  const ap = appraiser || {};
  const apRows = APPRAISER_FIELDS.filter(f => ap[f.k]).map(f => row(f.label, ap[f.k])).join('');
  const dateHe = shortDay(p.date);
  const lines = p.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(l.desc || PURCHASE_METAL_NAMES[l.metal])}</td><td>${escapeHtml(PURCHASE_METAL_NAMES[l.metal])} ${l.purityPpt}</td><td>${fmt(l.grams, 2)}</td><td>${fmt(l.pureGrams, 3)}</td><td>${agToIls(l.valueAg)}</td></tr>`).join('');
  const priceRow = (k, label, unit) => p.prices[k] ? row(label, `${fmt(p.prices[k].value, k === 'usdIls' ? 3 : 2)} ${unit}${p.prices[k].date ? ' (' + shortDay(p.prices[k].date) + ')' : ' (ערך ייחוס)'}`) : '';
  const usedMetals = new Set(p.lines.map(l => l.metal));
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>שטר קנייה ${p.no}</title>
  <style>
    @page { margin: 1.5cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.5; color: #000; max-width: 720px; margin: 0 auto; padding: 16px; background: #fff; }
    h1 { color: #c19c0a; border-bottom: 3px solid #c19c0a; padding-bottom: 6px; }
    h2 { color: #333; margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 4px; font-size: 18px; }
    .meta { background: #f5f5f5; padding: 10px; border-radius: 4px; margin: 12px 0; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #ccc; }
    .label { color: #666; }
    .value { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ccc; padding: 6px; text-align: right; }
    th { background: #f5f5f5; }
    .total { font-size: 18px; }
    .declaration { background: #fafafa; border: 1px solid #ddd; padding: 10px; border-radius: 4px; white-space: pre-wrap; }
    .signature-area { margin-top: 50px; display: flex; justify-content: space-between; }
    .signature-line { border-top: 1px solid #000; padding-top: 4px; width: 40%; text-align: center; font-size: 12px; }
  </style>
</head>
<body>
  <h1>שטר קנייה</h1>
  <div class="meta">
    ${row('מספר שטר', p.no)}
    ${row('תאריך', dateHe)}
    ${row('אמצעי תשלום', PURCHASE_PAY_METHODS[p.payMethod] || '')}
  </div>

  <h2>הקונה</h2>
  ${apRows || '<p style="color:#b91c1c">לא הוזנו פרטי העסק (כלים ← הגדרות ← פרטי השמאי)</p>'}

  <h2>המוכר</h2>
  ${row('שם', p.seller.name)}
  ${row('מספר זהות', p.seller.idNumber)}
  ${p.seller.phone ? row('טלפון', p.seller.phone) : ''}
  ${p.seller.address ? row('כתובת', p.seller.address) : ''}

  <h2>הפריטים</h2>
  <table>
    <thead><tr><th>#</th><th>תיאור</th><th>מתכת וטוהר</th><th>משקל (גרם)</th><th>משקל טהור</th><th>שווי</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>

  <h2>חישוב</h2>
  ${usedMetals.has('gold') ? priceRow('gold', 'מחיר זהב', '$ לאונקיה') : ''}
  ${usedMetals.has('silver') ? priceRow('silver', 'מחיר כסף', '$ לאונקיה') : ''}
  ${priceRow('usdIls', 'שער דולר', '₪')}
  ${row('שווי התכה', agToIls(p.grossAg))}
  ${p.commissionAg ? row(`עמלה (${fmt(p.commissionBp / 100, 2)}%)`, '−' + agToIls(p.commissionAg)) : ''}
  <div class="total">${row('סכום ששולם למוכר', agToIls(p.netAg))}</div>
  ${p.notes ? row('הערות', p.notes) : ''}

  <h2>הצהרת המוכר</h2>
  <div class="declaration">${escapeHtml(DEFAULT_SELLER_DECLARATION)}</div>

  <div class="signature-area">
    <div class="signature-line">חתימת המוכר — ${escapeHtml(p.seller.name)}</div>
    <div class="signature-line">חתימת הקונה${ap.name ? ' — ' + escapeHtml(ap.name) : ''}</div>
  </div>
</body>
</html>`;
}

// רישום ביומן ההזדמנויות כפריט שנקנה (שקלים, כמו שאר היומן)
function purchaseToOpp(p) {
  const metals = [...new Set(p.lines.map(l => PURCHASE_METAL_NAMES[l.metal]))].join(' ו');
  const grams = p.lines.reduce((s, l) => s + l.grams, 0);
  return {
    id: uid(), category: 'gold', status: 'bought',
    name: `${metals} ${fmt(grams, 1)} גרם — שטר קנייה ${p.no}`,
    asking: p.netAg / 100, estimate: p.grossAg / 100,
    purchasePrice: p.netAg / 100, purchaseDate: new Date().toISOString(),
    seller: p.seller.name, notes: p.notes, purchaseId: p.id,
    details: p.lines.map(l => [l.desc || PURCHASE_METAL_NAMES[l.metal], `${PURCHASE_METAL_NAMES[l.metal]} ${l.purityPpt}, ${fmt(l.grams, 2)} גרם — ${agToIls(l.valueAg)}`]),
    created: new Date().toISOString(), hasPhoto: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ממשק: מסך הקנייה
// ─────────────────────────────────────────────────────────────────────────────

function purchaseState() {
  if (!state.purchase) state.purchase = { lines: [{ metal: 'gold', purityPpt: 583, grams: '', desc: '' }] };
  return state.purchase;
}

function renderPurchaseView() {
  const ps = purchaseState();
  const box = $('#pu-lines');
  if (!box) return;
  box.innerHTML = ps.lines.map((l, i) => `<div class="pu-line" data-i="${i}">
    <select data-f="metal" aria-label="מתכת">${Object.entries(PURCHASE_METAL_NAMES).map(([k, n]) => `<option value="${k}"${l.metal === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
    <select data-f="purityPpt" aria-label="טוהר">${PURCHASE_PURITIES[l.metal].map(p => `<option value="${p}"${Number(l.purityPpt) === p ? ' selected' : ''}>${p}</option>`).join('')}</select>
    <input data-f="grams" type="text" inputmode="decimal" placeholder="גרם" aria-label="משקל בגרמים" value="${escapeHtml(String(l.grams))}" />
    <input data-f="desc" type="text" placeholder="תיאור (טבעת, שרשרת...)" aria-label="תיאור" value="${escapeHtml(l.desc)}" />
    <button class="btn-ghost pu-del" data-del="${i}" aria-label="הסרת שורה ${i + 1}">✕</button>
  </div>`).join('');
  $$('#pu-lines [data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const i = Number(el.closest('.pu-line').dataset.i);
    ps.lines[i][el.dataset.f] = el.value;
    if (el.dataset.f === 'metal') { ps.lines[i].purityPpt = PURCHASE_PURITIES[el.value][el.value === 'gold' ? 4 : 1]; renderPurchaseView(); return; }
    recalcPurchase();
  }));
  $$('#pu-lines [data-del]').forEach(b => b.addEventListener('click', () => {
    ps.lines.splice(Number(b.dataset.del), 1);
    if (!ps.lines.length) ps.lines.push({ metal: 'gold', purityPpt: 583, grams: '', desc: '' });
    renderPurchaseView();
  }));
  renderPurchaseList();
  recalcPurchase();
}

function readPurchaseForm() {
  return {
    seller: { name: $('#pu-name')?.value, idNumber: $('#pu-id')?.value, phone: $('#pu-phone')?.value, address: $('#pu-address')?.value },
    lines: purchaseState().lines,
    commissionBp: percentToBp($('#pu-commission')?.value),
    payMethod: $('#pu-pay')?.value || 'cash',
    notes: $('#pu-notes')?.value || '',
  };
}

function recalcPurchase() {
  const out = $('#pu-result');
  if (!out) return;
  const f = readPurchaseForm();
  const filled = f.lines.filter(l => String(l.grams).trim());
  if (!filled.length) { out.innerHTML = '<div class="field-hint">הזינו משקל לפחות לפריט אחד</div>'; return; }
  try {
    if (Number.isNaN(f.commissionBp)) throw new Error('העמלה צריכה להיות בין 0% ל-50%');
    const r = computePurchase({ lines: filled, prices: state.prices, commissionBp: f.commissionBp });
    const warn = purchaseWarnings(r, f.payMethod, state.prices);
    out.innerHTML = `
      <div class="r-row"><span class="r-label">משקל טהור</span><strong>${fmt(r.lines.reduce((s, l) => s + l.pureGrams, 0), 3)} גרם</strong></div>
      <div class="r-row"><span class="r-label">שווי התכה</span><strong>${agToIls(r.grossAg)}</strong></div>
      <div class="r-row"><span class="r-label">עמלה</span><strong>−${agToIls(r.commissionAg)}</strong></div>
      <div class="r-row big"><span class="r-label">לתשלום למוכר</span><strong>${agToIls(r.netAg)}</strong></div>
      ${warn.map(w => `<div class="pu-warn">⚠ ${escapeHtml(w)}</div>`).join('')}`;
  } catch (e) {
    out.innerHTML = `<div class="pu-warn">${escapeHtml(e.message)}</div>`;
  }
}

async function savePurchase() {
  const f = readPurchaseForm();
  try {
    if (Number.isNaN(f.commissionBp)) throw new Error('העמלה צריכה להיות בין 0% ל-50%');
    f.lines = f.lines.filter(l => String(l.grams).trim());
    const preview = createPurchase(f, { no: 0, prices: state.prices });
    const warn = purchaseWarnings(preview, preview.payMethod, state.prices);
    const msg = `להפיק שטר קנייה ל${preview.seller.name} על סך ${agToIls(preview.netAg)}?` + (warn.length ? `\n\nלתשומת לב:\n${warn.join('\n')}` : '');
    if (!(await ssDialog.confirm(msg, { okText: 'הפקה' }))) return;
    // המספור נקבע רק אחרי האישור, ולא חוזר אחורה
    const no = (Number(Storage.load('purchaseSeq', 0)) || 0) + 1;
    // פרטי השמאי בזמן ההפקה — הדפסה חוזרת לא מציגה פרטים שהשתנו מאז (סקירת קוד 2.11.2026)
    const ap = loadAppraiser();
    const p = { ...preview, no, appraiser: Object.fromEntries(APPRAISER_FIELDS.map(f => [f.k, ap[f.k] || ''])) };
    const list = Storage.load('purchases', []) || [];
    list.unshift(p);
    // שטר שלא נשמר לא מודפס: המספר שלו היה מונפק שוב לשטר הבא (ההודעה — מ-Storage.save)
    if (!Storage.save('purchaseSeq', no) || !Storage.save('purchases', list)) return;
    state.opportunities.unshift(purchaseToOpp(p));
    // השטר כבר שמור; רישום ביומן שנדחה נשאר בזיכרון ויישמר בשמירה הבאה של היומן
    Storage.save('opportunities', state.opportunities);
    toast(`שטר קנייה ${no} נשמר ונרשם ביומן ✓`, 'success');
    state.purchase = null;
    ['#pu-name', '#pu-id', '#pu-phone', '#pu-address', '#pu-notes'].forEach(s => { const el = $(s); if (el) el.value = ''; });
    renderPurchaseView();
    openPrintPreview(buildPurchaseHtml(p, p.appraiser));
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderPurchaseList() {
  const box = $('#pu-list');
  if (!box) return;
  const list = (Storage.load('purchases', []) || []).slice(0, 20);
  box.innerHTML = list.length ? list.map(p => `<div class="pu-item">
    <span>שטר ${p.no} · ${shortDay(p.date)} · ${escapeHtml(p.seller.name)}</span>
    <strong>${agToIls(p.netAg)}</strong>
    <button class="btn-ghost" data-print="${escapeHtml(p.id)}">🖨 הדפסה</button>
  </div>`).join('') : '<div class="field-hint">עדיין לא הופקו שטרי קנייה</div>';
  $$('#pu-list [data-print]').forEach(b => b.addEventListener('click', () => {
    const p = (Storage.load('purchases', []) || []).find(x => x.id === b.dataset.print);
    if (p) openPrintPreview(buildPurchaseHtml(p, purchaseAppraiser(p)));
  }));
}

function attachPurchase() {
  $('#pu-add')?.addEventListener('click', () => {
    const ps = purchaseState();
    if (ps.lines.length >= PURCHASE_MAX_LINES) { toast(`עד ${PURCHASE_MAX_LINES} פריטים בשטר אחד`, 'error'); return; }
    ps.lines.push({ metal: 'gold', purityPpt: 583, grams: '', desc: '' });
    renderPurchaseView();
  });
  ['#pu-commission', '#pu-pay'].forEach(s => $(s)?.addEventListener(s === '#pu-pay' ? 'change' : 'input', recalcPurchase));
  $('#pu-save')?.addEventListener('click', savePurchase);
}
