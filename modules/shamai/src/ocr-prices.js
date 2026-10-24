// שמאי — סדר ידני ומחירי ייחוס. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// OCR של תעודות הוסר: הוא טען מנוע Tesseract מתיקייה שאינה בחבילה, והכפתור תמיד נכשל (בדיקת קוד 23.10.2026).
// אין מנוע OCR מקומי בתוכנה, וטעינה מהרשת אסורה (CLAUDE.md, כלל 6)

// Patch sort to support manual order
(function patchSort() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(patchSort, 900));
    return;
  }
  setTimeout(() => {
    const sortSelect = $('#opp-sort');
    if (!sortSelect) return;
    sortSelect.addEventListener('change', () => {
      if (sortSelect.value === 'manual') {
        // Re-sort opportunities by manualOrder
        state.opportunities.sort((a, b) => (a.manualOrder ?? 999999) - (b.manualOrder ?? 999999));
        Storage.save('opportunities', state.opportunities);
        renderLedger();
      }
    });
  }, 900);
})();


// ─────────────────────────────────────────────────────────────────────────────
//  AUTO-REFRESH PRICES every 5 minutes
// ─────────────────────────────────────────────────────────────────────────────

// אין רענון מחירים אוטומטי: התוכנה אופליין (CLAUDE.md, כלל 6). המחירים מתעדכנים בהקלדה או מקובץ — src/prices.js

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE PRICE BANNER on every appraisal page
// ─────────────────────────────────────────────────────────────────────────────

function getLivePriceBanner(category) {
  // אין עדכון אוטומטי (אופליין) — התאריך של המחיר והתזכורת כשהוא ישן (src/prices.js)
  const st = priceStatusText(state.prices);
  const updateText = escapeHtml(st.text);

  let priceCells = '';
  switch (category) {
    case 'gold':
    case 'silver':
    case 'scrap':
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">זהב</span><span class="lpb-val">$${fmt0(state.prices.gold || 0)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">כסף</span><span class="lpb-val">$${fmt(state.prices.silver || 0, 2)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">פלטינה</span><span class="lpb-val">$${fmt0(state.prices.platinum || 0)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
      `;
      break;
    case 'diamond':
      // Rapaport-style estimated $/carat ranges
      const rapPerCt = 8500; // rough avg $/ct for D-VS1 1ct
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">D-VS1 1ct</span><span class="lpb-val">~$${fmt0(rapPerCt)}/ct</span></div>
        <div class="lpb-cell"><span class="lpb-label">G-VS2 1ct</span><span class="lpb-val">~$${fmt0(rapPerCt * 0.55)}/ct</span></div>
        <div class="lpb-cell"><span class="lpb-label">Lab vs Natural</span><span class="lpb-val">~30%</span></div>
      `;
      break;
    case 'nft':
    case 'crypto':
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">BTC</span><span class="lpb-val">$${fmt0(state.prices.bitcoin || 0)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">ETH</span><span class="lpb-val">$${fmt0(state.prices.ethereum || 0)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">SOL</span><span class="lpb-val">$${fmt(state.prices.solana || 0, 1)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
      `;
      break;
    case 'realestate': {
      // אין בתוכנה מחירי מ"ר לפי עיר (CLAUDE.md): רק המחיר למ"ר שהשמאי הקליד לפי עסקאות שבדק
      const ppsqm = state.realestate && state.realestate.pricePerSqm > 0 ? state.realestate.pricePerSqm : null;
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">מחיר למ"ר שהוזן</span><span class="lpb-val">${ppsqm ? '₪' + fmt0(ppsqm) : '—'}</span></div>
        <div class="lpb-cell"><span class="lpb-label">מקור</span><span class="lpb-val">עסקאות שבדקת</span></div>
      `;
      break;
    }
    case 'vehicle':
      // בלי שיעור מע"מ קבוע — הוא משתנה, ולא נדרש להערכת הרכב
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">EUR/ILS</span><span class="lpb-val">${fmt(state.prices.eurIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">פחת שנתי</span><span class="lpb-val">~12-15%</span></div>
      `;
      break;
    case 'wine':
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">EUR/ILS</span><span class="lpb-val">${fmt(state.prices.eurIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">בורדו 2015</span><span class="lpb-val">+30%</span></div>
        <div class="lpb-cell"><span class="lpb-label">תשואה שנתית</span><span class="lpb-val">~6-9%</span></div>
      `;
      break;
    default:
      // Generic - show key prices
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">זהב</span><span class="lpb-val">$${fmt0(state.prices.gold || 0)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">EUR/ILS</span><span class="lpb-val">${fmt(state.prices.eurIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">BTC</span><span class="lpb-val">$${fmt0(state.prices.bitcoin || 0)}</span></div>
      `;
  }

  return `
    <div class="live-price-banner">
      <div class="lpb-header">
        <span class="lpb-title">📊 מחירי ייחוס</span>
        <span class="lpb-update ${st.cls}">${updateText}</span>
        <button class="lpb-refresh" data-open-prices title="עדכון מחירים" aria-label="עדכון מחירים">↻</button>
      </div>
      <div class="lpb-grid">${priceCells}</div>
    </div>
  `;
}

// Inject banner into each appraisal sub-view automatically
function injectLivePriceBanners() {
  document.querySelectorAll('.sub-view[data-sub]').forEach(sv => {
    const cat = sv.dataset.sub;
    if (!cat) return;
    // Remove existing banner
    sv.querySelector('.live-price-banner')?.remove();
    // Add new banner after sub-header
    const header = sv.querySelector('.sub-header');
    if (header) {
      header.insertAdjacentHTML('afterend', getLivePriceBanner(cat));
    }
  });
}

// Hook into switchSubView to refresh banner each time
const originalSwitchSubView = switchSubView;
window.switchSubView = function(view, sub) {
  originalSwitchSubView.apply(this, arguments);
  // Inject banner only on appraisal views
  if (view === 'appraisal') {
    setTimeout(() => injectLivePriceBanners(), 50);
  }
};

// רענון הבאנר — היום יכול להתחלף בזמן שהמסך פתוח
setInterval(() => {
  if (document.querySelector('.sub-view[data-sub]:not([hidden])')) {
    injectLivePriceBanners();
  }
}, 30000);

// כפתור ↻ בבאנר (נבנה מחדש בכל פעם) — פותח את לוח עדכון המחירים
document.addEventListener('click', (ev) => {
  if (ev.target.closest && ev.target.closest('.live-price-banner [data-open-prices]')) openPricePanel();
});
