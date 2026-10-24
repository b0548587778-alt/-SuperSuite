// שמאי — תגיות, יצירת קשר, הגדלת תמונה וחיבורי ממשק. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  TAGS for opportunities
// ─────────────────────────────────────────────────────────────────────────────

function getAllTags() {
  const tags = new Set();
  state.opportunities.forEach(o => {
    if (o.tags && Array.isArray(o.tags)) {
      o.tags.forEach(t => tags.add(t));
    }
  });
  return Array.from(tags);
}

function addTagToOpp(oppId, tag) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp) return;
  opp.tags = opp.tags || [];
  if (!opp.tags.includes(tag)) opp.tags.push(tag);
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

function removeTagFromOpp(oppId, tag) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp || !opp.tags) return;
  opp.tags = opp.tags.filter(t => t !== tag);
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

// ─────────────────────────────────────────────────────────────────────────────
//  QUICK CONTACT - call, WhatsApp from opp
// ─────────────────────────────────────────────────────────────────────────────

function detectPhone(text) {
  if (!text) return null;
  // Israeli phone patterns: 05X-XXXXXXX, 0X-XXXXXXX, +972...
  const patterns = [
    /(\+972[\d-\s]{8,12})/,
    /(05\d[\d\s-]{7,9})/,
    /(0[2-9][\d\s-]{6,9})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/[\s-]/g, '');
  }
  return null;
}

function callPhone(phone) {
  window.location.href = `tel:${phone}`;
}

function whatsappPhone(phone, oppName) {
  const cleaned = phone.replace(/[^\d+]/g, '');
  const intl = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('0') ? '+972' + cleaned.substring(1) : '+972' + cleaned;
  const msg = `שלום, אני מתעניין ב${oppName}`;
  window.open(`https://wa.me/${intl.replace('+', '')}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHOTO ZOOM MODAL
// ─────────────────────────────────────────────────────────────────────────────

function showPhotoZoom(src) {
  const modal = document.createElement('div');
  modal.className = 'photo-zoom';
  modal.innerHTML = `
    <button class="photo-zoom-close" aria-label="סגור">×</button>
    <img src="${src}" alt="תמונת הפריט" />
  `;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}


// ─────────────────────────────────────────────────────────────────────────────
//  JEWISH WIDGET on dashboard
// ─────────────────────────────────────────────────────────────────────────────

function renderJewishWidget() {
  const el = $('#jewish-widget');
  if (!el) return;
  const parsha = getCurrentParsha();
  const holiday = getJewishHolidays();
  const dayName = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][new Date().getDay()];

  el.innerHTML = `
    <div class="jw-row">
      <div class="jw-item">
        <div class="jw-label">פרשת השבוע</div>
        <div class="jw-value">${escapeHtml(parsha || '—')}</div>
      </div>
      ${holiday ? `
        <div class="jw-item">
          <div class="jw-label">חג קרוב</div>
          <div class="jw-value">${escapeHtml(holiday.name)}</div>
          <div class="jw-sub">${holiday.daysAway === 0 ? 'היום' : holiday.daysAway === 1 ? 'מחר' : `בעוד ${holiday.daysAway} ימים`}</div>
        </div>
      ` : ''}
      <div class="jw-item">
        <div class="jw-label">היום</div>
        <div class="jw-value">יום ${dayName}</div>
      </div>
    </div>
  `;
}

// Hook into renderDashboard - add after renderReminders
const originalRenderDashboard = renderDashboard;
window.renderDashboard = function() {
  originalRenderDashboard.apply(this, arguments);
  renderJewishWidget();
};

// ─────────────────────────────────────────────────────────────────────────────
//  WIRE NEW UI EVENTS
// ─────────────────────────────────────────────────────────────────────────────

(function wireUI() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireUI, 200));
    return;
  }
  setTimeout(() => {
    // Global search
    $('#btn-global-search')?.addEventListener('click', openGlobalSearch);
    $('#search-close')?.addEventListener('click', () => $('#search-overlay').hidden = true);
    $('#global-search-input')?.addEventListener('input', renderGlobalSearch);
    $('#search-overlay')?.addEventListener('click', e => {
      if (e.target.id === 'search-overlay') $('#search-overlay').hidden = true;
    });

    // Calc tool actions
    // רק כפתורי המחשבון: גם לפעולות המהירות במסך הבית יש data-quick
    document.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('.calc-btn, .calc-quick') : null;
      if (!btn) return;
      if (btn.dataset.calc) calcAction(btn.dataset.calc);
      if (btn.dataset.quick) calcQuick(btn.dataset.quick);
    });

    // Photo zoom on opp cards
    document.addEventListener('click', e => {
      if (e.target.tagName === 'IMG' && e.target.classList.contains('opp-photo-img')) {
        showPhotoZoom(e.target.src);
      }
    });

    // Render jewish widget on initial load
    renderJewishWidget();
  }, 300);
})();

// ─────────────────────────────────────────────────────────────────────────────
//  EXTEND OPP ACTIONS - add PDF, call, whatsapp buttons
// ─────────────────────────────────────────────────────────────────────────────

const originalOppAction = oppAction;
window.oppAction = async function(id, action) {
  if (action === 'pdf') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) exportPDFReport(opp);
    return;
  }
  if (action === 'call' || action === 'wa') {
    const opp = state.opportunities.find(o => o.id === id);
    if (!opp || !opp.seller) {
      toast('אין מספר טלפון לפריט זה', 'error');
      return;
    }
    const phone = detectPhone(opp.seller);
    if (!phone) {
      toast('לא נמצא מספר תקין בשדה המוכר', 'error');
      return;
    }
    if (action === 'call') callPhone(phone);
    else whatsappPhone(phone, opp.name);
    return;
  }
  return originalOppAction.apply(this, arguments);
};
