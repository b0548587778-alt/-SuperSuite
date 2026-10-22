// שמאי — שמאות זהב וכסף. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  GOLD/SILVER APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderGoldView() {
  const purities = state.gold.metal === 'gold' ? GOLD_PURITIES : SILVER_PURITIES;
  $('#purity-grid').innerHTML = purities.map(p => `
    <button class="purity-btn ${state.gold.purity === p.value ? 'active' : ''}" data-purity="${p.value}">
      <div>${p.k}</div>
      <div class="purity-sub">${p.sub}</div>
    </button>
  `).join('');

  // Wire up
  $$('#purity-grid .purity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.gold.purity = parseFloat(btn.dataset.purity);
      renderGoldView();
      recalcGold();
    });
  });

  // Coin presets - filter by current metal
  const coins = COIN_PRESETS.filter(c => c.metal === state.gold.metal);
  $('#coin-presets').innerHTML = coins.map(c => `
    <button class="preset-btn" data-coin="${c.name}">
      <div class="preset-name">${c.name}</div>
      <div class="preset-detail">${c.weight}g · ${(c.purity*1000).toFixed(0)}/1000</div>
    </button>
  `).join('');

  $$('#coin-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const coin = COIN_PRESETS.find(c => c.name === btn.dataset.coin);
      if (!coin) return;
      state.gold.purity = coin.purity;
      state.gold.weight = coin.weight;
      state.gold.unit = 'g';
      $('#g-weight').value = coin.weight;
      $('#g-unit').value = 'g';
      renderGoldView();
      recalcGold();
      toast(`נטען: ${coin.name}`, 'success');
    });
  });

  recalcGold();
}

function recalcGold() {
  const r = $('#g-result');
  if (!r) return;
  const g = state.gold;
  const w = parseFloat($('#g-weight')?.value);
  if (!w || w <= 0) { r.innerHTML = ''; $('#g-save').hidden = true; return; }

  const unit = $('#g-unit')?.value || 'g';
  const scrap = $('#g-scrap-mode')?.checked;
  state.gold.scrap = scrap;
  const v = goldValue({
    weight: w, unit, purity: g.purity, scrap,
    spotUsd: g.metal === 'gold' ? state.prices.gold : state.prices.silver,
    usdIls: state.prices.usdIls,
  });
  const { pureGrams, perGramIls } = v;
  const buyerPayUsd = v.payUsd;
  const buyerPayIls = v.payIls;

  const asking = parseFloat($('#g-asking')?.value);
  state.gold.asking = asking;

  let html = `
    <div class="r-row big">
      <span class="r-label">${scrap ? 'מחיר רכישה כסקראפ' : 'שווי התכה'} (USD)</span>
      <strong>$${fmt(buyerPayUsd)}</strong>
    </div>
    <div class="r-row big">
      <span class="r-label">${scrap ? 'מחיר רכישה כסקראפ' : 'שווי התכה'} (₪)</span>
      <strong>₪${fmt0(buyerPayIls)}</strong>
    </div>
    <div class="r-row sep">
      <span class="r-label">מתכת טהורה במשקל</span>
      <span class="r-value">${fmt(pureGrams, 2)} גרם</span>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר לגרם טהור</span>
      <span class="r-value">₪${fmt(perGramIls)}</span>
    </div>
  `;

  if (asking && asking > 0) {
    const profit = buyerPayIls - asking;
    const margin = (profit / asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">רווח/הפסד</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${profit >= 0 ? '+' : ''}${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  // "מאין הסכום?" — מספרים מתוך אותו v שממנו נבנתה התוצאה
  html += explainGold(g, v, asking && asking > 0 ? asking : null);

  html += `
    <div class="tip-box">
      <div class="tip-title">◆ טיפ סוחרים</div>
      <div class="tip-body">
        סוחרי "סקראפ" משלמים בדרך כלל 60-75% משווי התכה. אם הגעת ל-+80% - הזדמנות מצוינת. תכשיטים עתיקים שווים בדרך כלל הרבה יותר משווי המתכת בלבד.
      </div>
    </div>
  `;

  r.innerHTML = html;
  explainAttach('#g-result');
  $('#g-save').hidden = !asking;
}
