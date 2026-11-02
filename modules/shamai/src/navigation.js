// שמאי — ניווט, אירועים ואתחול. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

function switchView(view) {
  state.view = view;
  state.subView = null;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`.view[data-view="${view}"]`)?.classList.add('active');
  $$('.top-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  // Show hub, hide all sub-views
  $$('.sub-hub').forEach(h => h.removeAttribute('hidden'));
  $$('.sub-view').forEach(s => s.setAttribute('hidden', ''));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Re-render content
  if (view === 'dashboard') renderDashboard();
  if (view === 'ledger') renderLedger();
  if (view === 'tools') {
    // Refresh crypto on visit
    renderCryptoFull();
  }
}

function switchSubView(parent, sub) {
  state.subView = sub;
  // Hide hub, show specific sub-view
  const view = $(`.view[data-view="${parent}"]`);
  if (!view) return;
  view.querySelectorAll('.sub-hub').forEach(h => h.setAttribute('hidden', ''));
  view.querySelectorAll('.sub-view').forEach(s => s.setAttribute('hidden', ''));
  const target = view.querySelector(`.sub-view[data-sub="${sub}"], .sub-view[data-tool="${sub}"]`);
  if (target) {
    target.removeAttribute('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Initialize
    initSubView(parent, sub);
    // Re-wire voice for any new text inputs
    setTimeout(() => setupVoiceInput(), 100);
  }
}

function backToHub(parent) {
  state.subView = null;
  const view = $(`.view[data-view="${parent}"]`);
  if (!view) return;
  view.querySelectorAll('.sub-view').forEach(s => s.setAttribute('hidden', ''));
  view.querySelectorAll('.sub-hub').forEach(h => h.removeAttribute('hidden'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initSubView(parent, sub) {
  // Render the appropriate view based on sub-id
  const renderers = {
    'gold': renderGoldView,
    'cases': renderCasesView,
    'purchase': renderPurchaseView,
    'diamond': renderDiamondView,
    'watch': renderWatchView,
    'antique': renderAntiqueView,
    'book': renderBookView,
    'coin': renderCoinView,
    'phone': renderPhoneView,
    'art': renderArtView,
    'rug': renderRugView,
    'scrap': renderScrapView,
    'realestate': renderRealEstateView,
    'vehicle': renderVehicleAppraisalView,
    'nft': renderNFTView,
    'wine': renderWineView,
    'bag': renderBagView,
    'gbook': renderGBookView,
    'roi': recalcROI,
    'mortgage': recalcMortgage,
    'rental': recalcRental,
    're-tax': () => { recalcPurchaseTax(); recalcAppreciation(); },
    'vehicle-tool': recalcVehicle, // legacy tool name
    'currency': recalcCurrency,
    'crypto': () => { renderCryptoFull(); recalcCryptoConvert(); },
    'analytics': renderAnalytics,
    'contacts': renderContactsView,
    'auth': renderAuthHubView,
    'calc': renderCalcView,
    'compare': renderCompare,
    'settings': () => { renderSettingsStats(); renderAppraiserSettings(); renderAppraiserEnSettings(); },
  };
  // Vehicle appraisal (sub) vs Vehicle TCO tool (data-tool)
  if (parent === 'tools' && sub === 'vehicle') {
    recalcVehicle();
    return;
  }
  if (renderers[sub]) renderers[sub]();
}


// Dispatch recalc to current sub-view
function recalcCurrent() {
  const recalcs = {
    'gold': recalcGold,
    'purchase': recalcPurchase,
    'diamond': recalcDiamond,
    'watch': recalcWatch,
    'antique': recalcAntique,
    'book': recalcBook,
    'coin': recalcCoin,
    'phone': recalcPhone,
    'art': recalcArt,
    'rug': recalcRug,
    'scrap': recalcScrap,
    'realestate': recalcRealEstate,
    'vehicle': recalcVehicleAppraisal,
    'nft': recalcNFT,
    'wine': recalcWine,
    'bag': recalcBag,
    'gbook': recalcGBook,
    'roi': recalcROI,
    'mortgage': recalcMortgage,
    'rental': recalcRental,
    're-tax': () => { recalcPurchaseTax(); recalcAppreciation(); },
    'currency': recalcCurrency,
    'crypto': () => { renderCryptoFull(); recalcCryptoConvert(); },
    'analytics': renderAnalytics,
    'contacts': renderContactsView,
    'auth': renderAuthHubView,
    'calc': renderCalcView,
    'compare': renderCompare,
  };
  const fn = recalcs[state.subView];
  if (fn) fn();
}

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Top nav
  $$('.top-tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  // Quick actions on dashboard
  $$('.qa').forEach(q => q.addEventListener('click', () => {
    const target = q.dataset.quick;
    if (target === 'ledger-new') {
      switchView('ledger');
      setTimeout(() => $('#btn-new-opp')?.click(), 100);
    } else if (target.startsWith('appraisal-')) {
      const sub = target.replace('appraisal-', '');
      switchView('appraisal');
      setTimeout(() => switchSubView('appraisal', sub), 50);
    }
  }));

  // Hub cards
  $$('.hub-card').forEach(h => h.addEventListener('click', () => {
    const sub = h.dataset.sub || h.dataset.tool;
    const parent = h.closest('[data-view]')?.dataset.view;
    if (sub && parent) switchSubView(parent, sub);
  }));

  // Back buttons
  $$('.back-btn').forEach(b => b.addEventListener('click', () => {
    const parent = b.closest('[data-view]')?.dataset.view;
    if (parent) backToHub(parent);
  }));

  // Refresh

  // עדכון מחירים: הקלדה או קובץ, עם תאריך לכל מחיר (src/prices.js)
  attachPricePanel();
  attachPurchase();
  renderPricePanel();

  // Install
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('shamai_install_dismissed_v2')) {
      $('#install-banner').hidden = false;
    }
  });
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (isIOS && !isStandalone && !localStorage.getItem('shamai_install_dismissed_v2')) {
    setTimeout(() => {
      const banner = $('#install-banner');
      if (banner) {
        $('#install-text').textContent = 'שיתוף ↑ → הוסף למסך הבית';
        $('#btn-install').hidden = true;
        banner.hidden = false;
      }
    }, 2000);
  }
  $('#btn-install')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#install-banner').hidden = true;
    if (outcome === 'accepted') toast('האפליקציה הותקנה!', 'success');
  });
  $('#btn-install-dismiss')?.addEventListener('click', () => {
    $('#install-banner').hidden = true;
    localStorage.setItem('shamai_install_dismissed_v2', '1');
  });

  // Gold inputs
  ['g-weight', 'g-unit', 'g-asking', 'g-scrap-mode'].forEach(id => {
    document.addEventListener('input', e => {
      if (e.target.id === id) recalcGold();
    });
    document.addEventListener('change', e => {
      if (e.target.id === id) recalcGold();
    });
  });

  // Toggle gold/silver
  document.addEventListener('click', e => {
    const t = e.target.closest('.toggle');
    if (!t) return;
    const sub = t.closest('.sub-view')?.dataset.sub;
    if (sub === 'gold') {
      $$('.sub-view[data-sub="gold"] .toggle').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.gold.metal = t.dataset.metal;
      // Reset purity to default for new metal
      state.gold.purity = t.dataset.metal === 'gold' ? 0.750 : 0.925;
      renderGoldView();
    } else if (sub === 'diamond') {
      $$('.sub-view[data-sub="diamond"] .toggle').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      state.diamond.origin = t.dataset.origin;
      recalcDiamond();
    } else if (t.dataset.tax) {
      // Tax tabs
      $$('.sub-view[data-tool="re-tax"] .toggle').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('#tax-purchase').hidden = t.dataset.tax !== 'purchase';
      $('#tax-appreciation').hidden = t.dataset.tax !== 'appreciation';
    }
  });

  // Diamond inputs
  ['d-carat', 'd-shape', 'd-asking', 'd-currency'].forEach(id => {
    document.addEventListener('input', e => {
      if (e.target.id === id) recalcDiamond();
    });
    document.addEventListener('change', e => {
      if (e.target.id === id) recalcDiamond();
    });
  });

  // Watch
  ['w-model', 'w-year', 'w-condition', 'w-papers', 'w-service', 'w-retail', 'w-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcWatch(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcWatch(); });
  });

  // Antique
  ['a-name', 'a-market', 'a-asking', 'a-prov', 'a-signed', 'a-rare', 'a-silver-weight', 'a-silver-purity'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcAntique(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcAntique(); });
  });
  document.addEventListener('click', e => {
    if (e.target.id === 'a-calc-silver') {
      const grams = parseFloat($('#a-silver-weight').value);
      const purity = parseInt($('#a-silver-purity').value);
      if (grams && purity) {
        const ils = calcSilverFromGrams(grams, purity);
        $('#a-market').value = Math.round(ils * 1.5); // 50% premium for craftsmanship
        recalcAntique();
        toast(`חושב: ₪${fmt0(ils)} התכה + 50% אומנות`, 'success');
      }
    }
  });

  // Book
  ['b-name', 'b-edition', 'b-year', 'b-complete', 'b-rabbi', 'b-glosses', 'b-binding', 'b-first', 'b-market', 'b-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcBook(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcBook(); });
  });

  // Coin
  ['cn-name', 'cn-year', 'cn-metal', 'cn-weight', 'cn-purity', 'cn-premium', 'cn-market', 'cn-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcCoin(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcCoin(); });
  });

  // Phone
  ['ph-model', 'ph-storage', 'ph-warranty', 'ph-battery', 'ph-retail', 'ph-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcPhone(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcPhone(); });
  });

  // Art
  ['ar-artist', 'ar-length', 'ar-width', 'ar-year', 'ar-signed', 'ar-prov', 'ar-frame', 'ar-exhibited', 'ar-market', 'ar-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcArt(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcArt(); });
  });

  // Rug
  ['rg-length', 'rg-width', 'rg-material', 'rg-kpsi', 'rg-age', 'rg-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcRug(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcRug(); });
  });

  // Scrap
  ['sc-weight', 'sc-unit', 'sc-price-kg', 'sc-asking'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcScrap(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcScrap(); });
  });

  // Save buttons
  document.addEventListener('click', e => {
    if (e.target.id === 'g-save') saveCurrentAsOpp('gold');
    if (e.target.id === 'd-save') saveCurrentAsOpp('diamond');
    if (e.target.id === 'w-save') saveCurrentAsOpp('watch');
    if (e.target.id === 'a-save') saveCurrentAsOpp('antique');
    if (e.target.id === 'b-save') saveCurrentAsOpp('book');
    if (e.target.id === 'cn-save') saveCurrentAsOpp('coin');
    if (e.target.id === 'ph-save') saveCurrentAsOpp('phone');
    if (e.target.id === 'ar-save') saveCurrentAsOpp('art');
    if (e.target.id === 'rg-save') saveCurrentAsOpp('rug');
    if (e.target.id === 'sc-save') saveCurrentAsOpp('scrap');
  });

  // Tools inputs
  ['r-buy', 'r-sell', 'r-fees', 'r-fees-type', 'r-days'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcROI(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcROI(); });
  });
  ['mt-amount', 'mt-rate', 'mt-years', 'mt-type'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcMortgage(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcMortgage(); });
  });
  ['rn-price', 'rn-rent', 'rn-vaad', 'rn-arnona', 'rn-insurance', 'rn-maint', 'rn-vacancy'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcRental(); });
  });
  ['tx-value', 'tx-status'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcPurchaseTax(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcPurchaseTax(); });
  });
  ['ap-buy', 'ap-sell', 'ap-expenses', 'ap-years', 'ap-single'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcAppreciation(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcAppreciation(); });
  });
  ['v-buy', 'v-sell', 'v-years', 'v-insurance', 'v-test', 'v-fuel', 'v-service'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcVehicle(); });
  });
  ['cu-amount', 'cu-from', 'cu-to'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcCurrency(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcCurrency(); });
  });
  ['cr-amount', 'cr-coin'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcCryptoConvert(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcCryptoConvert(); });
  });

  // Ledger - new opp form
  $('#btn-new-opp')?.addEventListener('click', () => {
    $('#new-opp-form').hidden = false;
    $('#no-name').focus();
  });
  $('#no-cancel')?.addEventListener('click', () => {
    $('#new-opp-form').hidden = true;
    clearOppForm();
  });
  $('#no-add')?.addEventListener('click', saveOppFromForm);

  // Photo upload
  // התמונה מוקטנת (כמו בתיק השומה) ונשמרת בלחיצה על "הוסף" / "שמור שינויים"
  $('#no-photo')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await caseCompressImage(file);
      pendingPhoto = dataUrl;
      photoRemoved = false;
      $('#no-photo-preview').innerHTML = `
        <img src="${dataUrl}" alt="תצוגה" />
        <button class="remove-photo" aria-label="הסר">×</button>
      `;
      $('#no-photo-preview').hidden = false;
    } catch (err) {
      e.target.value = '';
      toast(err.message || 'התמונה לא נטענה', 'error');
    }
  });
  document.addEventListener('click', e => {
    if (e.target.classList?.contains('remove-photo')) {
      $('#no-photo-preview').hidden = true;
      $('#no-photo-preview').innerHTML = '';
      $('#no-photo').value = '';
      pendingPhoto = null;
      photoRemoved = true;
    }
  });

  // Ledger filters
  $$('.filter-btn').forEach(b => b.addEventListener('click', () => {
    $$('.filter-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.ledger.filter = b.dataset.filter;
    renderLedger();
  }));

  // Search and sort
  $('#opp-search')?.addEventListener('input', e => {
    state.ledger.search = e.target.value;
    state.ledger.sellerKey = null; // הקלדה מחליפה את הסינון לפי איש קשר
    renderLedger();
  });
  $('#opp-sort')?.addEventListener('change', e => {
    state.ledger.sort = e.target.value;
    renderLedger();
  });

  // Export
  $('#btn-export-json')?.addEventListener('click', exportJSON);
  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-import')?.addEventListener('click', () => $('#file-import').click());
  $('#file-import')?.addEventListener('change', importJSON);

  // Settings
  $('#btn-export-all')?.addEventListener('click', exportJSON);
  $('#btn-import-all')?.addEventListener('click', () => $('#file-import-all').click());
  $('#file-import-all')?.addEventListener('change', importJSON);
  $('#btn-clear-all')?.addEventListener('click', async () => {
    if (await ssDialog.confirm('למחוק את כל הנתונים? פעולה זו אינה הפיכה. המספור של השטרות, התיקים והדוחות יישמר.', { danger: true, okText: 'מחיקה' })) {
      if (clearAllShamaiData()) location.reload();
    }
  });

  // Device sync via QR
  $('#btn-show-qr')?.addEventListener('click', generateBackupQR);
  $('#btn-scan-qr')?.addEventListener('click', scanBackupQR);

  // Cloud sync
  $('#btn-cloud-upload')?.addEventListener('click', uploadToCloud);
  $('#btn-cloud-download')?.addEventListener('click', downloadFromCloud);

  // Real estate
  ['re-ppsqm', 're-size', 're-rooms', 're-floor', 're-year', 're-asking',
   're-elevator', 're-parking', 're-balcony', 're-storage', 're-renovated', 're-tama', 're-view', 're-noise'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcRealEstate(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcRealEstate(); });
  });

  // Vehicle appraisal
  ['veh-model', 'veh-year', 'veh-km', 'veh-hand', 'veh-engine', 'veh-list', 'veh-asking',
   'veh-test', 'veh-accident', 'veh-private', 'veh-service'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcVehicleAppraisal(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcVehicleAppraisal(); });
  });

  // NFT
  ['nft-name', 'nft-floor', 'nft-rarity', 'nft-asking', 'nft-currency',
   'nft-1of1', 'nft-celeb', 'nft-utility', 'nft-historic'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) recalcNFT(); });
    document.addEventListener('change', e => { if (e.target.id === id) recalcNFT(); });
  });

  // Save buttons for new modules
  document.addEventListener('click', e => {
    if (e.target.id === 're-save') saveCurrentAsOpp('realestate');
    if (e.target.id === 'veh-save') saveCurrentAsOpp('vehicle');
    if (e.target.id === 'nft-save') saveCurrentAsOpp('nft');
  });
}

function addNewOpp() {
  const name = $('#no-name').value.trim();
  const asking = parseFloat($('#no-asking').value);
  const est = parseFloat($('#no-est').value);
  if (!name || !asking) {
    toast('נדרש שם ומחיר', 'error');
    return;
  }
  const photoData = $('#no-photo-preview').dataset.data;
  const opp = {
    id: uid(),
    name,
    asking,
    estimate: est || null,
    category: $('#no-cat').value || 'general',
    seller: $('#no-seller').value.trim(),
    notes: $('#no-notes').value.trim(),
    status: 'watching',
    created: new Date().toISOString(),
    photo: photoData || null,
  };
  state.opportunities.unshift(opp);
  Storage.save('opportunities', state.opportunities);
  $('#new-opp-form').hidden = true;
  clearOppForm();
  renderLedger();
  renderHeader();
  toast('נשמר', 'success');
}

// Add general categories to the ledger select
function populateLedgerCats() {
  const sel = $('#no-cat');
  if (!sel) return;
  const cats = [
    { k: 'general', name: 'כללי' },
    { k: 'gold', name: 'זהב/כסף' },
    { k: 'diamond', name: 'יהלום' },
    { k: 'watch', name: 'שעון' },
    { k: 'antique', name: 'יודאיקה/עתיקות' },
    { k: 'book', name: 'ספרי קודש' },
    { k: 'coin', name: 'מטבעות' },
    { k: 'phone', name: 'טלפון' },
    { k: 'art', name: 'אומנות' },
    { k: 'rug', name: 'שטיח' },
    { k: 'scrap', name: 'סקראפ' },
  ];
  sel.innerHTML = cats.map(c => `<option value="${c.k}">${c.name}</option>`).join('');
}

// "מחק את כל הנתונים": רק מפתחות השמאי (באנדרואיד ה-localStorage משותף למודולים), והמספור נשמר —
// פעם localStorage.clear() איפס את purchaseSeq / caseSeq / reportSeq, ומספרי שטרות ודוחות שכבר הונפקו חזרו
// (בדיקת קוד 23.10.2026, ממצא 17). false — המחסן דחה את המחיקה (למשל בלי כניסה); ההודעה כבר הוצגה
const KEEP_ON_CLEAR = ['purchaseSeq', 'caseSeq', 'reportSeq'];
function clearAllShamaiData() {
  const keep = new Set(KEEP_ON_CLEAR.map(Storage.k));
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  try {
    for (const k of keys) {
      if (typeof k === 'string' && k.startsWith('shamai_') && !keep.has(k)) localStorage.removeItem(k);
    }
    return true;
  } catch (e) {
    Storage.failed(e);
    return false;
  }
}

// ייצוא פריטי הפנקס, המחירים וההגדרות — לא גיבוי מלא: תיקים, שטרות, מספור ותמונות נשמרים רק בגיבוי המוצפן
// של התוכנה (CLAUDE.md, כלל 5). שם הקובץ לפי התאריך המקומי (localToday), לא UTC
function exportJSON() {
  const data = {
    version: '2.0',
    kind: 'shamai-items',
    exported: new Date().toISOString(),
    opportunities: state.opportunities,
    prices: state.prices,
    settings: state.settings,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-items-${localToday()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('פריטי הפנקס יוצאו', 'success');
}

// תא CSV: הגנת נוסחאות כמו בכלכלה (csvFormulaRisk ב-modules/econ/core/exports.js — אותו כלל, סקריפט רגיל כאן):
// ערך שמתחיל ב-= + @ טאב או CR, או מינוס שאינו מספר שלילי פשוט — מקבל גרש בהתחלה (סקירת קוד 2.11.2026)
function shamaiCsvFormulaRisk(s) {
  return /^[=+@\t\r]/.test(s) || (s[0] === '-' && !/^-\d+(?:[.,]\d+)*$/.test(s));
}
function shamaiCsvCell(v) {
  let s = String(v ?? '');
  if (shamaiCsvFormulaRisk(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
const csvMoney = (v) => { const n = roundMoney(v); return n ? n : ''; };

function exportCSV() {
  const rows = [['ID', 'שם', 'קטגוריה', 'סטטוס', 'מחיר מבוקש', 'שווי משוער', 'רווח', '%', 'מוכר', 'תאריך', 'הערות']];
  state.opportunities.forEach(o => {
    const profit = oppProfit(o);
    const margin = oppMargin(o);
    rows.push([
      o.id,
      o.name,
      o.category || '',
      o.status,
      csvMoney(o.asking),
      csvMoney(o.estimate),
      profit !== null ? profit : '',
      margin !== null ? margin.toFixed(1) : '',
      o.seller || '',
      o.created ? shortDate(o.created) : '',
      (o.notes || '').replace(/\n/g, ' '),
    ]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(shamaiCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${localToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV יוצא', 'success');
}

// ייבוא פריטים מקובץ JSON: המשתמש בוחר בין הוספה לקיים לבין החלפה (עם אישור נוסף) — לעולם לא דריסה בלי שאלה.
// הגרסה היחידה בשמאי: גרסה כפולה ב-tools.js נדרסה בעבר על ידי גרסה שהחליפה הכול בלי אישור.
// כל פריט עובר sanitizeOpp (ledger.js) לפני שנשמר, ובהוספה — פריט שמזהה שלו כבר בפנקס מדולג (פעם נוצרו כפילויות)
function importJSON(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || !Array.isArray(data.opportunities)) throw new Error('פורמט לא תקין');
      const { items, skipped } = sanitizeOpportunities(data.opportunities);
      if (!items.length) throw new Error('אין בקובץ פריטים תקינים');
      const mode = await ssDialog.choose(`לייבא ${items.length} פריטים?${skipped ? ` (${skipped} פגומים או כפולים ידולגו)` : ''}`, [
        { label: 'להוסיף לקיים', value: 'merge' }, { label: 'להחליף את הקיים', value: 'replace', kind: 'danger' }]);
      if (!mode) return;
      let added = items.length, dup = 0;
      const before = state.opportunities;
      if (mode === 'merge') {
        const existing = new Set(state.opportunities.map(o => o.id));
        const fresh = items.filter(o => !existing.has(o.id));
        dup = items.length - fresh.length;
        added = fresh.length;
        state.opportunities = [...fresh, ...state.opportunities];
      } else {
        if (!(await ssDialog.confirm('להחליף את כל הנתונים הקיימים?', { danger: true }))) return;
        state.opportunities = items;
      }
      // שמירה שנדחתה — הפנקס חוזר למה שהיה (ההודעה — מ-Storage.save)
      if (!Storage.save('opportunities', state.opportunities)) { state.opportunities = before; return; }
      bumpReportSeqFrom(state.opportunities);
      if (mode === 'replace') dropReplacedPhotos(before, state.opportunities);
      renderLedger();
      renderHeader();
      toast(`יובאו ${added} פריטים${dup ? ` · ${dup} כבר היו בפנקס ודולגו` : ''}`, 'success');
    } catch (err) {
      // שגיאת פענוח של JSON — באנגלית; למשתמש רק הודעה בעברית
      toast('שגיאה בייבוא: ' + (err && typeof err.message === 'string' && /[֐-׿]/.test(err.message) ? err.message : 'הקובץ אינו תקין'), 'error');
    }
  };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────

// הנתונים השמורים ← state. גם האחסון הוא קלט לא מהימן: פריט פגום שנשמר פעם (למשל משחזור QR ישן) הפיל את
// renderDashboard לפני bindEvents, ושום כפתור לא עבד גם אחרי "טען מחדש" (בדיקת קוד 23.10.2026, ממצא 18)
function loadSavedState() {
  const plainObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const savedOps = Storage.load('opportunities');
  if (Array.isArray(savedOps)) state.opportunities = sanitizeOpportunities(savedOps).items;
  const savedPrices = Storage.load('prices');
  if (plainObj(savedPrices)) state.prices = { ...DEFAULT_PRICES, ...savedPrices };
  const savedSettings = Storage.load('settings');
  if (plainObj(savedSettings)) state.settings = { ...state.settings, ...savedSettings };
}

async function init() {
  loadSavedState();

  // Render
  renderHeader();
  renderDashboard();
  populateLedgerCats();

  // Activate dashboard view by default
  $('.view[data-view="dashboard"]')?.classList.add('active');

  // Render Hebrew date
  const hebDateEl = $('#heb-date');
  if (hebDateEl) hebDateEl.textContent = getHebrewDate();

  // Wire up events
  bindEvents();

  // תמונות ישנות מ-IndexedDB הגלוי ← המחסן המוצפן
  setTimeout(() => ImageDB.migrateAll(state.opportunities.filter(o => o.hasPhoto).map(o => 'opp_' + o.id)), 1500);

  // Service worker
  // בתוך SuperSuite המודול נטען מ-app:// — שם Service Worker אינו נתמך ואינו נחוץ (הקבצים מקומיים)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }

  // Try fetching live prices (silent on initial load)

  // Pull-to-refresh on dashboard
  setupPullToRefresh();

  // Voice input on text fields (after small delay to let DOM settle)
  setTimeout(() => setupVoiceInput(), 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
