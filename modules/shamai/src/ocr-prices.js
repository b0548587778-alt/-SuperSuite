// שמאי — OCR ומחירים. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  OCR via Tesseract.js — נטען מהעותק המקומי שבחבילה (lib/tesseract/).
//  אין תלות ברשת: בסביבה מסוננת טעינה מ-CDN נכשלת תמיד.
// ─────────────────────────────────────────────────────────────────────────────

let tesseractLoaded = false;
let tesseractLoading = null;

async function loadTesseract() {
  if (tesseractLoaded) return window.Tesseract;
  if (tesseractLoading) return tesseractLoading;

  tesseractLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'lib/tesseract/tesseract.min.js';
    script.onload = () => {
      tesseractLoaded = true;
      resolve(window.Tesseract);
    };
    script.onerror = () => reject(new Error('מנוע ה-OCR אינו מותקן בחבילה זו'));
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

async function ocrFromImage(imageDataOrFile) {
  toast('טוען OCR... (פעם ראשונה ~2 שניות)', 'info');
  try {
    const Tesseract = await loadTesseract();
    if (!Tesseract) throw new Error('Tesseract not available');
    
    toast('מזהה טקסט...', 'info');
    // Use English + Hebrew for max coverage
    const result = await Tesseract.recognize(imageDataOrFile, 'eng+heb', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress > 0) {
          const pct = Math.round(m.progress * 100);
          if (pct % 20 === 0) toast(`מזהה... ${pct}%`, 'info');
        }
      },
    });
    return result.data.text || '';
  } catch (e) {
    toast('שגיאת OCR: ' + e.message, 'error');
    return null;
  }
}

async function scanGIACertificate() {
  // Trigger camera/file picker
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';

  input.onchange = async () => {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    
    // Show preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = await ocrFromImage(file);
      if (!text) return;

      // Try to parse GIA certificate fields
      const parsed = parseGIAText(text);
      
      // Show result modal
      showOCRResult(text, parsed, e.target.result);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function parseGIAText(text) {
  const result = {};
  // Carat
  const caratMatch = text.match(/(\d+\.?\d*)\s*(?:carat|ct|קראט)/i);
  if (caratMatch) result.carat = parseFloat(caratMatch[1]);
  
  // Color (D-Z)
  const colorMatch = text.match(/(?:color|צבע)[:\s]+([D-Z])\b/i);
  if (colorMatch) result.color = colorMatch[1];
  
  // Clarity
  const clarityMatch = text.match(/\b(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)\b/);
  if (clarityMatch) result.clarity = clarityMatch[1];
  
  // Cut
  const cutMatch = text.match(/(?:cut grade|cut)[:\s]+(Excellent|Very Good|Good|Fair|Poor)/i);
  if (cutMatch) result.cut = cutMatch[1];
  
  // Shape
  const shapeMatch = text.match(/\b(Round|Princess|Cushion|Emerald|Oval|Pear|Marquise|Radiant|Asscher|Heart)\b/i);
  if (shapeMatch) result.shape = shapeMatch[1];
  
  // Report number
  const reportMatch = text.match(/(?:report|certificate|gia)[:\s#]*(\d{8,12})/i);
  if (reportMatch) result.reportNumber = reportMatch[1];
  
  // Measurements
  const measureMatch = text.match(/(\d+\.\d+)\s*[×x*]\s*(\d+\.\d+)\s*[×x*]\s*(\d+\.\d+)\s*mm/i);
  if (measureMatch) {
    result.measurements = `${measureMatch[1]} × ${measureMatch[2]} × ${measureMatch[3]} mm`;
  }
  
  return result;
}

function showOCRResult(rawText, parsed, imageData) {
  const modal = document.createElement('div');
  modal.className = 'ocr-modal';
  modal.innerHTML = `
    <div class="ocr-content">
      <div class="ocr-header">
        <h3>תוצאת OCR</h3>
        <button class="ocr-close">×</button>
      </div>
      ${imageData ? `<img class="ocr-image" src="${imageData}" alt="" />` : ''}
      ${Object.keys(parsed).length > 0 ? `
        <div class="ocr-parsed">
          <div class="ocr-section-title">✨ פרטים שזוהו אוטומטית</div>
          ${Object.entries(parsed).map(([k, v]) => {
            const labels = {
              carat: 'משקל (ct)',
              color: 'צבע',
              clarity: 'ניקיון',
              cut: 'חיתוך',
              shape: 'צורה',
              reportNumber: 'מספר תעודה',
              measurements: 'מידות',
            };
            return `<div class="ocr-field"><span>${labels[k] || k}:</span> <strong>${escapeHtml(String(v))}</strong></div>`;
          }).join('')}
          <button class="btn-primary ocr-apply">החל על טופס יהלום</button>
        </div>
      ` : ''}
      <details class="ocr-raw">
        <summary>📄 הטקסט המלא שנקרא</summary>
        <pre>${escapeHtml(rawText)}</pre>
      </details>
      <button class="btn-secondary ocr-copy">העתק טקסט</button>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.ocr-close').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  
  modal.querySelector('.ocr-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(rawText).then(() => toast('✓ הועתק', 'success'));
  });

  modal.querySelector('.ocr-apply')?.addEventListener('click', () => {
    // Open diamond appraisal and pre-fill
    switchView('appraisal');
    setTimeout(() => {
      switchSubView('appraisal', 'diamond');
      setTimeout(() => {
        if (parsed.carat) {
          const el = $('#d-carat');
          if (el) el.value = parsed.carat;
        }
        if (parsed.color) {
          const el = $(`[data-color="${parsed.color}"]`);
          if (el) el.click();
        }
        if (parsed.clarity) {
          const el = $(`[data-clarity="${parsed.clarity}"]`);
          if (el) el.click();
        }
        if (parsed.cut) {
          // Map "Excellent" -> "EX" etc.
          const cutMap = { 'Excellent': 'EX', 'Very Good': 'VG', 'Good': 'G', 'Fair': 'F', 'Poor': 'P' };
          const cutCode = cutMap[parsed.cut];
          if (cutCode) {
            const el = $(`[data-cut="${cutCode}"]`);
            if (el) el.click();
          }
        }
        if (parsed.shape) {
          const shapeSelect = $('#d-shape');
          if (shapeSelect) {
            const opt = Array.from(shapeSelect.options).find(o => o.text.toLowerCase().includes(parsed.shape.toLowerCase()));
            if (opt) shapeSelect.value = opt.value;
          }
        }
        toast('✓ פרטים מולאו אוטומטית', 'success');
      }, 200);
    }, 100);
    modal.remove();
  });
}


// Wire OCR button
(function wireOCR() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireOCR, 800));
    return;
  }
  setTimeout(() => {
    $('#btn-ocr-cert')?.addEventListener('click', scanGIACertificate);
  }, 800);
})();

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
    case 'realestate':
      // Israeli RE avg per sqm by area (estimated 2026 prices)
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">תל אביב מ"ר</span><span class="lpb-val">~₪65K</span></div>
        <div class="lpb-cell"><span class="lpb-label">ירושלים מ"ר</span><span class="lpb-val">~₪40K</span></div>
        <div class="lpb-cell"><span class="lpb-label">חיפה מ"ר</span><span class="lpb-val">~₪22K</span></div>
        <div class="lpb-cell"><span class="lpb-label">פריפריה מ"ר</span><span class="lpb-val">~₪14K</span></div>
      `;
      break;
    case 'vehicle':
      priceCells = `
        <div class="lpb-cell"><span class="lpb-label">USD/ILS</span><span class="lpb-val">${fmt(state.prices.usdIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">EUR/ILS</span><span class="lpb-val">${fmt(state.prices.eurIls || 0, 3)}</span></div>
        <div class="lpb-cell"><span class="lpb-label">פחת שנתי</span><span class="lpb-val">~12-15%</span></div>
        <div class="lpb-cell"><span class="lpb-label">מע"מ</span><span class="lpb-val">17%</span></div>
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
