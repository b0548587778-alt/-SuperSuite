// שמאי — דוח שמאות מקצועי (PDF) ופרטי השמאי (PLAN.md 9.8). חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  PDF EXPORT - generate PDF valuation reports
// ─────────────────────────────────────────────────────────────────────────────

const APPRAISER_FIELDS = [
  { k: 'name', label: 'שם השמאי' },
  { k: 'business', label: 'שם העסק' },
  { k: 'license', label: 'מספר עוסק / רישיון' },
  { k: 'phone', label: 'טלפון' },
  { k: 'address', label: 'כתובת' },
];

const DEFAULT_DECLARATION = 'אני הח"מ בדקתי את הפריט המתואר בדוח זה. ההערכה נעשתה לפי מיטב ידיעתי ושיקול דעתי המקצועי, על סמך בדיקת הפריט ומחירי השוק במועד הדוח. ההערכה תקפה למועד הדוח בלבד, ואינה מהווה אישור מקוריות שלא נבדקה במעבדה.';

function loadAppraiser() {
  const a = Storage.load('appraiser', {}) || {};
  const out = {};
  for (const f of APPRAISER_FIELDS) out[f.k] = typeof a[f.k] === 'string' ? a[f.k].slice(0, 200) : '';
  out.declaration = typeof a.declaration === 'string' && a.declaration.trim() ? a.declaration.slice(0, 2000) : DEFAULT_DECLARATION;
  return out;
}

function renderAppraiserSettings() {
  const a = loadAppraiser();
  for (const f of APPRAISER_FIELDS) { const el = $('#ap-' + f.k); if (el) el.value = a[f.k]; }
  const d = $('#ap-declaration');
  if (d) d.value = a.declaration;
  const btn = $('#ap-save');
  if (btn) btn.onclick = saveAppraiserSettings;
}

function saveAppraiserSettings() {
  const a = {};
  for (const f of APPRAISER_FIELDS) a[f.k] = ($('#ap-' + f.k)?.value || '').trim().slice(0, 200);
  const d = ($('#ap-declaration')?.value || '').trim();
  a.declaration = d && d !== DEFAULT_DECLARATION ? d.slice(0, 2000) : '';
  Storage.save('appraiser', a);
  toast('פרטי השמאי נשמרו', 'success');
}

// מספר דוח קבוע לכל פריט — נקבע בהפקה הראשונה ולא חוזר אחורה. מספר מקובץ מיובא שאינו שלם חיובי — לא נלקח
function reportNumberFor(opp) {
  if (Number.isInteger(opp.reportNo) && opp.reportNo > 0) return opp.reportNo;
  const next = (Number(Storage.load('reportSeq', 0)) || 0) + 1;
  // 0 — המספר לא נשמר (ההודעה — מ-Storage.save), והדוח לא מודפס: אחרת אותו מספר היה מונפק שוב לדוח הבא
  if (!Storage.save('reportSeq', next)) return 0;
  const had = 'reportNo' in opp, prev = opp.reportNo;
  opp.reportNo = next;
  if (!Storage.save('opportunities', state.opportunities)) {
    if (had) opp.reportNo = prev; else delete opp.reportNo;
    return 0;
  }
  return next;
}

const fmtGrams = (g) => fmt(g, 2) + ' גרם';
const nameOf = (list, k) => list.find((x) => x.k === k)?.name || k;

// פרטי השמאות לפי תחום, בזמן השמירה ליומן: [תווית, ערך] — כדי שהדוח יציג על מה נשענה ההערכה
function appraisalDetails(category) {
  const p = state.prices;
  const rate = ['שער הדולר', fmt(p.usdIls, 2) + ' ₪'];
  switch (category) {
    case 'gold': {
      const g = state.gold;
      const w = parseFloat($('#g-weight')?.value);
      const unit = $('#g-unit')?.value || 'g';
      const scrap = !!$('#g-scrap-mode')?.checked;
      const v = goldValue({ weight: w, unit, purity: g.purity, spotUsd: g.metal === 'gold' ? p.gold : p.silver, usdIls: p.usdIls, scrap });
      return [
        ['מתכת', g.metal === 'gold' ? 'זהב' : 'כסף'],
        ['טוהר', fmt(g.purity * 1000, 0) + '/1000'],
        ['משקל', `${fmt(w, 2)} ${{ g: 'גרם', oz: 'אונקיה', kg: 'ק"ג' }[unit] || unit}`],
        ['מתכת טהורה', fmtGrams(v.pureGrams)],
        ['מחיר לאונקיה', '$' + fmt(g.metal === 'gold' ? p.gold : p.silver, 2)],
        rate,
        ['שווי התכה', '₪' + fmt0(v.meltIls)],
        ...(scrap ? [['מחיר רכישה כסקראפ (70%)', '₪' + fmt0(v.payIls)]] : []),
      ];
    }
    case 'diamond': {
      const d = state.diamond;
      return [
        ['מקור', d.origin === 'lab' ? 'מעבדה' : 'טבעי'],
        ['משקל', fmt(parseFloat($('#d-carat')?.value), 2) + ' קראט'],
        ['צורה', nameOf(DIAMOND_SHAPES, d.shape)],
        ['צבע', d.color], ['ניקיון', d.clarity], ['ליטוש', d.cut], ['פלואורסנציה', d.fluor],
        ['תעודה', nameOf(DIAMOND_CERTS, d.cert)],
        rate,
      ];
    }
    case 'watch': {
      const w = state.watch;
      return [
        ['מותג', nameOf(WATCH_BRANDS, w.brand)],
        ['דגם', w.model || '—'],
        ['שנת ייצור', w.year || '—'],
        ['מצב', WATCH_CONDITIONS[w.condition]?.name || '—'],
        ['אבזור', WATCH_PAPERS[w.papers]?.name || '—'],
        ['שירות', WATCH_SERVICE[w.service]?.name || '—'],
        ['מחיר שוק יד שנייה', '₪' + fmt0(w.retail)],
      ];
    }
    case 'antique': {
      const a = state.antique;
      const extras = [a.prov && 'מקור מתועד', a.signed && 'חתום', a.rare && 'נדיר'].filter(Boolean);
      return [
        ['קטגוריה', nameOf(ANTIQUE_CATS, a.cat)],
        ['מצב', nameOf(CONDITIONS, a.condition)],
        ['הולמרק / מקור', nameOf(HALLMARKS, a.hallmark)],
        ['מאפיינים', extras.join(', ') || '—'],
        ['מחיר שוק להשוואה', '₪' + fmt0(a.market)],
      ];
    }
    case 'coin': {
      const c = state.coin;
      return [
        ['תקופה', nameOf(COIN_ERAS, c.era)],
        ['שנה', c.year || '—'],
        ['מתכת', { gold: 'זהב', silver: 'כסף' }[c.metal] || c.metal],
        ['משקל', c.weight ? fmtGrams(c.weight) : '—'],
        ['טוהר', c.purity + '/1000'],
        ['דירוג', nameOf(COIN_GRADES, c.grade)],
        rate,
      ];
    }
    case 'book': {
      const b = state.book;
      const extras = [b.rabbi && 'הגהות / חתימת רב', b.glosses && 'הערות בכתב יד', b.binding && 'כריכה מקורית', b.first && 'מהדורה ראשונה'].filter(Boolean);
      return [
        ['סוג', nameOf(BOOK_TYPES, b.type)],
        ['מהדורה', b.edition || '—'],
        ['שנה', b.year || '—'],
        ['מצב', nameOf(CONDITIONS, b.condition)],
        ['שלמות', BOOK_COMPLETE[b.complete]?.name || '—'],
        ['מאפיינים', extras.join(', ') || '—'],
      ];
    }
    default: return [];
  }
}

const row = (label, value, cls = '') => `<div class="row"><span class="label">${escapeHtml(label)}:</span> <span class="value ${cls}">${escapeHtml(String(value))}</span></div>`;

// טהור: HTML של הדוח. photo — data:image בלבד
function buildReportHtml(opp, appraiser, photo, today, reportNo) {
  const cat = OPP_CATEGORIES.find(c => c.k === opp.category)?.name || '';
  const profit = (opp.estimate || 0) - (opp.asking || 0);
  const margin = opp.asking ? (profit / opp.asking * 100) : 0;
  const details = Array.isArray(opp.details) ? opp.details.filter(d => Array.isArray(d) && d.length === 2) : [];
  const safePhoto = typeof photo === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo) ? photo : '';
  const ap = appraiser;
  const apRows = APPRAISER_FIELDS.filter(f => ap[f.k]).map(f => row(f.label, ap[f.k])).join('');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>דוח שמאות ${escapeHtml(reportNo)} - ${escapeHtml(opp.name || '')}</title>
  <style>
    @page { margin: 2cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.6; color: #000; max-width: 700px; margin: 0 auto; padding: 20px; background: #fff; }
    h1 { color: #c19c0a; border-bottom: 3px solid #c19c0a; padding-bottom: 8px; }
    h2 { color: #333; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .meta { background: #f5f5f5; padding: 12px; border-radius: 4px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted #ccc; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: bold; }
    .profit { color: #2d8659; }
    .loss { color: #b91c1c; }
    .declaration { background: #fafafa; border: 1px solid #ddd; padding: 12px; border-radius: 4px; white-space: pre-wrap; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #c19c0a; font-size: 12px; color: #666; text-align: center; }
    .signature-area { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-line { border-top: 1px solid #000; padding-top: 4px; width: 40%; text-align: center; font-size: 12px; }
    img.opp-photo { max-width: 300px; max-height: 300px; display: block; margin: 16px auto; border: 1px solid #ccc; padding: 4px; }
  </style>
</head>
<body>
  <h1>דוח שמאות</h1>
  <div class="meta">
    ${row('מספר דוח', reportNo)}
    ${row('תאריך הדוח', today)}
    ${row('תחום', cat)}
  </div>

  <h2>פרטי השמאי</h2>
  ${apRows || '<p style="color:#b91c1c">לא הוזנו פרטי שמאי (כלים ← הגדרות ← פרטי השמאי)</p>'}

  <h2>פרטי הפריט</h2>
  ${row('שם הפריט', opp.name || '—')}
  ${opp.notes ? row('תיאור והערות', opp.notes) : ''}
  ${details.map(([l, v]) => row(l, v)).join('')}

  ${safePhoto ? `<img class="opp-photo" src="${safePhoto}" alt="תמונת הפריט" />` : ''}

  <h2>הערכת שווי</h2>
  ${row('שווי משוער', '₪' + fmt0(opp.estimate || 0))}
  ${opp.asking ? row('מחיר מבוקש', '₪' + fmt0(opp.asking)) : ''}
  ${opp.asking ? row('פער', `${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt(margin, 1)}%)`, profit >= 0 ? 'profit' : 'loss') : ''}

  <h2>הצהרת השמאי</h2>
  <div class="declaration">${escapeHtml(ap.declaration)}</div>

  <div class="signature-area">
    <div class="signature-line">חתימת השמאי${ap.name ? ' — ' + escapeHtml(ap.name) : ''}</div>
    <div class="signature-line">תאריך</div>
  </div>

  <div class="footer">
    ${escapeHtml(ap.business || ap.name || 'שמאי')} | דוח מספר ${escapeHtml(reportNo)} | ${escapeHtml(today)}
  </div>
</body>
</html>`;
}

// תצוגת הדפסה בתוך העמוד: חלון חדש נחסם במעטפת (setWindowOpenHandler), ולכן מסגרת עם כפתורי הדפסה וסגירה
function openPrintPreview(html) {
  $('#print-preview')?.remove();
  const box = document.createElement('div');
  box.id = 'print-preview';
  box.className = 'print-preview';
  box.innerHTML = `<div class="pp-bar"><button class="btn-primary" id="pp-print">🖨 הדפס / שמור כ-PDF</button><button class="btn-ghost" id="pp-close">✕ סגור</button></div>`;
  const frame = document.createElement('iframe');
  frame.className = 'pp-frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.srcdoc = html;
  box.appendChild(frame);
  document.body.appendChild(box);
  $('#pp-print').addEventListener('click', () => frame.contentWindow.print());
  $('#pp-close').addEventListener('click', () => box.remove());
}

async function exportPDFReport(opp) {
  const today = new Date().toLocaleDateString('he-IL');
  let photo = '';
  if (opp.hasPhoto) {
    try { photo = await ImageDB.load(`opp_${opp.id}`) || ''; } catch (e) { photo = ''; }
  }
  const no = reportNumberFor(opp);
  if (!no) return;
  openPrintPreview(buildReportHtml(opp, loadAppraiser(), photo, today, no));
}
