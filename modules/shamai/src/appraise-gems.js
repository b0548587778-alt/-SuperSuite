// שמאי — שמאות יהלומים ושעונים. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  DIAMOND APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderDiamondView() {
  // Build all option grids
  $('#d-shape').innerHTML = DIAMOND_SHAPES.map(s => `<option value="${s.k}" ${state.diamond.shape === s.k ? 'selected' : ''}>${s.name}</option>`).join('');
  $('#d-color').innerHTML = DIAMOND_COLORS.map(c => `<button class="scale-btn ${state.diamond.color === c.k ? 'active' : ''}" data-color="${c.k}">${c.k}</button>`).join('');
  $('#d-clarity').innerHTML = DIAMOND_CLARITY.map(c => `<button class="scale-btn ${state.diamond.clarity === c.k ? 'active' : ''}" data-clarity="${c.k}">${c.k}</button>`).join('');
  $('#d-cut').innerHTML = DIAMOND_CUTS.map(c => `<button class="scale-btn ${state.diamond.cut === c.k ? 'active' : ''}" data-cut="${c.k}">${c.k}</button>`).join('');
  $('#d-fluor').innerHTML = DIAMOND_FLUOR.map(c => `<button class="scale-btn ${state.diamond.fluor === c.k ? 'active' : ''}" data-fluor="${c.k}">${c.k}</button>`).join('');
  $('#d-cert').innerHTML = DIAMOND_CERTS.map(c => `<button class="scale-btn ${state.diamond.cert === c.k ? 'active' : ''}" data-cert="${c.k}">${c.name}</button>`).join('');

  $$('#d-color .scale-btn').forEach(b => b.addEventListener('click', () => { state.diamond.color = b.dataset.color; renderDiamondView(); }));
  $$('#d-clarity .scale-btn').forEach(b => b.addEventListener('click', () => { state.diamond.clarity = b.dataset.clarity; renderDiamondView(); }));
  $$('#d-cut .scale-btn').forEach(b => b.addEventListener('click', () => { state.diamond.cut = b.dataset.cut; renderDiamondView(); }));
  $$('#d-fluor .scale-btn').forEach(b => b.addEventListener('click', () => { state.diamond.fluor = b.dataset.fluor; renderDiamondView(); }));
  $$('#d-cert .scale-btn').forEach(b => b.addEventListener('click', () => { state.diamond.cert = b.dataset.cert; renderDiamondView(); }));
  $('#d-shape').onchange = () => { state.diamond.shape = $('#d-shape').value; recalcDiamond(); };

  // Origin toggle
  $$('.sub-view[data-sub="diamond"] .toggle').forEach(t => {
    t.classList.toggle('active', t.dataset.origin === state.diamond.origin);
    t.onclick = () => { state.diamond.origin = t.dataset.origin; renderDiamondView(); };
  });

  recalcDiamond();
}

function recalcDiamond() {
  const r = $('#d-result');
  if (!r) return;
  const d = state.diamond;
  const carat = parseFloat($('#d-carat')?.value);
  if (!carat || carat < 0.30) { r.innerHTML = ''; $('#d-save').hidden = true; return; }

  const usdIls = state.prices.usdIls;
  const v = diamondValue(d, carat, usdIls);
  if (!v) {
    r.innerHTML = '<div class="tip-box"><div class="tip-title">⚠ אין מחיר בסיס</div><div class="tip-body">לא נמצא מחיר בסיס למשקל הזה — הפריט לא יישמר בלי הערכה.</div></div>';
    $('#d-save').hidden = true;
    return;
  }
  const { pricePerCarat, wholesaleUsd, retailIls, wholesaleIls } = v;

  const asking = parseFloat($('#d-asking')?.value);
  const currency = $('#d-currency')?.value || 'ILS';
  state.diamond.asking = asking;
  state.diamond.currency = currency;
  const askingIls = asking ? (currency === 'USD' ? asking * usdIls : asking) : null;

  let html = `
    <div class="r-row big">
      <span class="r-label">מחיר קמעונאי</span>
      <strong>₪${fmt0(retailIls)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר סיטונאי (~65%)</span>
      <span class="r-value gold">₪${fmt0(wholesaleIls)} · $${fmt0(wholesaleUsd)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מחיר לקראט</span>
      <span class="r-value">$${fmt0(pricePerCarat)}</span>
    </div>
  `;

  if (askingIls) {
    const profit = wholesaleIls - askingIls;
    const margin = (profit / askingIls) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(askingIls)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">רווח (לעומת סיטוני)</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  // "מאין הסכום?" — מחיר הבסיס לקראט והמקדמים, מתוך אותו v
  html += explainDiamond(d, carat, v, askingIls);

  html += `
    <div class="tip-box">
      <div class="tip-title">✦ אזהרות יהלומים 2026</div>
      <div class="tip-body">
        <ul>
          <li>יהלום מעבדה זהה ב-4Cs שווה ~25% מטבעי - ההפרש גדל ב-2025-2026</li>
          <li>תעודה לא GIA = עד 35% פחות. EGL זול במיוחד</li>
          <li>ללא תעודה = ${d.cert === 'NONE' ? '' : 'הכפל סיכון פי 3 - '}שלח לבדיקה לפני קנייה</li>
          <li>פלואורסנציה Strong = -15-20% במחיר</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  explainAttach('#d-result');
  $('#d-save').hidden = !askingIls;
}


// ─────────────────────────────────────────────────────────────────────────────
//  WATCH APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderWatchView() {
  $('#watch-brands').innerHTML = WATCH_BRANDS.map(b => `
    <button class="brand-btn ${state.watch.brand === b.k ? 'active' : ''}" data-brand="${b.k}">
      <div>${b.name}</div>
      <div class="brand-sub">${(b.liquidity*100).toFixed(0)}% נזילות</div>
    </button>
  `).join('');
  $$('#watch-brands .brand-btn').forEach(b => b.addEventListener('click', () => {
    state.watch.brand = b.dataset.brand;
    renderWatchView();
  }));
  recalcWatch();
}

function recalcWatch() {
  const r = $('#w-result');
  if (!r) return;
  const w = state.watch;
  w.model = $('#w-model')?.value || '';
  w.year = parseInt($('#w-year')?.value);
  w.condition = $('#w-condition')?.value || 'excellent';
  w.papers = $('#w-papers')?.value || 'full';
  w.service = $('#w-service')?.value || 'medium';
  w.retail = parseFloat($('#w-retail')?.value);
  w.asking = parseFloat($('#w-asking')?.value);

  if (!w.retail) {
    r.innerHTML = `
      <div class="tip-box">
        <div class="tip-title">◔ לפני שמתחילים</div>
        <div class="tip-body">
          להערכת שעון יוקרה - חפש <strong>אותו דגם בדיוק</strong> ב-Chrono24 (שעון יד שנייה במצב דומה). זה מחיר ה"רטרייל" הנוכחי. הזן אותו למעלה.
        </div>
      </div>
    `;
    $('#w-save').hidden = true;
    return;
  }

  const { brand, cond, papers, service, estValue, wholesale } = watchValue(w);

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי שוק נוכחי</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה לסוחר</span>
      <span class="r-value gold">₪${fmt0(wholesale)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מותג</span>
      <span class="r-value">${brand.name} (×${brand.liquidity.toFixed(2)})</span>
    </div>
    <div class="r-row">
      <span class="r-label">מצב</span>
      <span class="r-value">${cond.name} (×${cond.mult})</span>
    </div>
    <div class="r-row">
      <span class="r-label">אבזור</span>
      <span class="r-value">${papers.name} (×${papers.mult})</span>
    </div>
    <div class="r-row">
      <span class="r-label">שירות</span>
      <span class="r-value">${service.name} (×${service.mult})</span>
    </div>
  `;

  if (w.asking) {
    const profit = wholesale - w.asking;
    const margin = (profit / w.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(w.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">רווח (סיטוני)</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  // "מאין הסכום?" — המחיר שהוקלד והמקדמים, מתוך אותו watchValue
  html += explainWatch(w, { brand, cond, papers, service, estValue, wholesale });

  html += `
    <div class="tip-box">
      <div class="tip-title">◔ טיפים שעוני יוקרה</div>
      <div class="tip-body">
        <ul>
          <li>Rolex Submariner/GMT/Daytona = הכי נזילים, מחיר יציב</li>
          <li>"מצוין" עם ניירות = שווה 15-20% יותר מ"מצוין" ללא ניירות</li>
          <li>שירות ב-2 שנים אחרונות = +10-15%</li>
          <li>סופחי שריטות / תיקון מסך-זכוכית מורידים 20-30%</li>
          <li>בדיקת מספר סידורי באתר היצרן לאמת מקוריות</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  explainAttach('#w-result');
  $('#w-save').hidden = !w.asking;
}
