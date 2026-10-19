// שמאי — שמאות טלפונים, אמנות, שטיחים וגרוטאות. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  PHONE APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderPhoneView() {
  $('#phone-brands').innerHTML = PHONE_BRANDS.map(b => `
    <button class="brand-btn ${state.phone.brand === b.k ? 'active' : ''}" data-brand="${b.k}">
      <div>${b.name}</div>
      <div class="brand-sub">${(b.liquidity*100).toFixed(0)}% נזילות</div>
    </button>
  `).join('');
  $('#phone-cond').innerHTML = PHONE_CONDITIONS.map(c => `
    <button class="cond-btn ${state.phone.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span class="cond-name">${c.name}</span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#phone-brands .brand-btn').forEach(b => b.addEventListener('click', () => { state.phone.brand = b.dataset.brand; renderPhoneView(); }));
  $$('#phone-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.phone.condition = b.dataset.cond; renderPhoneView(); }));
  recalcPhone();
}

function recalcPhone() {
  const r = $('#ph-result');
  if (!r) return;
  const p = state.phone;
  p.model = $('#ph-model')?.value || '';
  p.storage = parseInt($('#ph-storage')?.value) || 128;
  p.warranty = $('#ph-warranty')?.value || 'none';
  p.battery = parseInt($('#ph-battery')?.value);
  p.retail = parseFloat($('#ph-retail')?.value);
  p.asking = parseFloat($('#ph-asking')?.value);

  if (!p.retail || p.retail <= 0) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">▢ דרוש מחיר חדש</div><div class="tip-body">הזן את מחיר המכשיר החדש בחנות (אפילו בערך) - בלי זה אי אפשר לחשב פיחות.</div></div>`;
    $('#ph-save').hidden = true;
    return;
  }

  const brand = PHONE_BRANDS.find(b => b.k === p.brand);
  const cond = PHONE_CONDITIONS.find(c => c.k === p.condition);
  const warrantyMult = p.warranty === 'active' ? 1.10 : 1.00;
  const batteryMult = p.battery && p.battery >= 90 ? 1.05 : p.battery && p.battery < 80 ? 0.90 : 1.00;
  // iPhones depreciate slower (50% in 2 years vs 70% for Samsung)
  // Without year data, assume the phone is 1-2 years old
  const liquidity = brand.liquidity;

  const estValue = p.retail * cond.mult * warrantyMult * batteryMult * liquidity;
  const maxPurchase = estValue * 0.70;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי שוק יד שנייה</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי לסוחר</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מצב</span>
      <span class="r-value">×${cond.mult}</span>
    </div>
    <div class="r-row">
      <span class="r-label">מותג (נזילות)</span>
      <span class="r-value">×${liquidity.toFixed(2)}</span>
    </div>
    ${p.battery ? `<div class="r-row"><span class="r-label">סוללה ${p.battery}%</span><span class="r-value">×${batteryMult}</span></div>` : ''}
  `;

  if (p.asking) {
    const profit = estValue - p.asking;
    const margin = (profit / p.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(p.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">▢ טלפונים יד שנייה</div>
      <div class="tip-body">
        <ul>
          <li>iPhone שומר ערך הכי טוב - ירידה של 30-40% בשנה ראשונה</li>
          <li>Samsung יורד 50% בשנה ראשונה</li>
          <li>אחריות פעילה = +10-15%</li>
          <li>סוללה מתחת ל-80% = החלפה דרושה ↓ 20%</li>
          <li>בדוק IMEI נקי (לא חסום ע"י חברה) ב-imei.info</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#ph-save').hidden = !p.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ART APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderArtView() {
  $('#art-techniques').innerHTML = ART_TECHNIQUES.map(t => `
    <button class="brand-btn ${state.art.technique === t.k ? 'active' : ''}" data-tech="${t.k}">
      <div>${t.name}</div>
      <div class="brand-sub">×${t.mult}</div>
    </button>
  `).join('');
  $('#art-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.art.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#art-techniques .brand-btn').forEach(b => b.addEventListener('click', () => { state.art.technique = b.dataset.tech; renderArtView(); }));
  $$('#art-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.art.condition = b.dataset.cond; renderArtView(); }));
  recalcArt();
}

function recalcArt() {
  const r = $('#ar-result');
  if (!r) return;
  const a = state.art;
  a.artist = $('#ar-artist')?.value || '';
  a.length = parseFloat($('#ar-length')?.value);
  a.width = parseFloat($('#ar-width')?.value);
  a.year = parseInt($('#ar-year')?.value);
  a.signed = $('#ar-signed')?.checked || false;
  a.prov = $('#ar-prov')?.checked || false;
  a.frame = $('#ar-frame')?.checked || false;
  a.exhibited = $('#ar-exhibited')?.checked || false;
  a.market = parseFloat($('#ar-market')?.value);
  a.asking = parseFloat($('#ar-asking')?.value);

  if (!a.market || a.market <= 0) { r.innerHTML = ''; $('#ar-save').hidden = true; return; }

  const techMult = ART_TECHNIQUES.find(t => t.k === a.technique)?.mult ?? 1;
  const condMult = CONDITIONS.find(c => c.k === a.condition)?.mult ?? 1;
  const signedMult = a.signed ? 1.30 : 1;
  const provMult = a.prov ? 1.25 : 1;
  const frameMult = a.frame ? 1.10 : 1;
  const exhibMult = a.exhibited ? 1.20 : 1;

  const estValue = a.market * techMult * condMult * signedMult * provMult * frameMult * exhibMult;
  const maxPurchase = estValue * 0.50;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
  `;

  if (a.asking) {
    const profit = estValue - a.asking;
    const margin = (profit / a.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(a.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">✺ אומנות - אזהרות חשובות</div>
      <div class="tip-body">
        <ul>
          <li>תמיד דרוש תיעוד מקור (Provenance) - בלי זה הסיכון עצום</li>
          <li>בדוק חתימה במאגרי האמן (Artprice, Mutual Art)</li>
          <li>שוק האומנות תנודתי - מחיר מכירה אחרון לא בהכרח עכשווי</li>
          <li>זיופים נפוצים מאוד - קח חוות דעת מומחה לפני קנייה משמעותית</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#ar-save').hidden = !a.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RUG APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderRugView() {
  $('#rug-regions').innerHTML = RUG_REGIONS.map(r => `
    <button class="brand-btn ${state.rug.region === r.k ? 'active' : ''}" data-region="${r.k}">
      <div>${r.name}</div>
      <div class="brand-sub">×${r.mult}</div>
    </button>
  `).join('');
  $('#rug-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.rug.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#rug-regions .brand-btn').forEach(b => b.addEventListener('click', () => { state.rug.region = b.dataset.region; renderRugView(); }));
  $$('#rug-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.rug.condition = b.dataset.cond; renderRugView(); }));
  recalcRug();
}

function recalcRug() {
  const r = $('#rg-result');
  if (!r) return;
  const rg = state.rug;
  rg.length = parseFloat($('#rg-length')?.value);
  rg.width = parseFloat($('#rg-width')?.value);
  rg.material = $('#rg-material')?.value || 'wool';
  rg.kpsi = parseInt($('#rg-kpsi')?.value);
  rg.age = $('#rg-age')?.value || 'semi';
  rg.asking = parseFloat($('#rg-asking')?.value);

  if (!rg.length || !rg.width) { r.innerHTML = ''; $('#rg-save').hidden = true; return; }

  const sqm = (rg.length * rg.width) / 10000;
  // Base prices per sqm (ILS)
  const basePerSqm = {
    silk: 12000,
    'silk-wool': 6000,
    wool: 2500,
    'wool-cotton': 1500,
    cotton: 600,
  }[rg.material] || 1500;

  const regionMult = RUG_REGIONS.find(rr => rr.k === rg.region)?.mult ?? 1;
  const condMult = CONDITIONS.find(c => c.k === rg.condition)?.mult ?? 1;
  const ageMult = rg.age === 'antique' ? 1.50 : rg.age === 'semi' ? 1.10 : 1.00;
  const kpsiMult = rg.kpsi ? Math.min(2.0, Math.max(0.5, rg.kpsi / 200)) : 1;

  const baseValue = sqm * basePerSqm;
  const estValue = baseValue * regionMult * condMult * ageMult * kpsiMult;
  const maxPurchase = estValue * 0.50;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">שטח</span>
      <span class="r-value">${fmt(sqm, 2)} מ"ר</span>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר למ"ר (בסיס)</span>
      <span class="r-value">₪${fmt0(basePerSqm)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">אזור</span>
      <span class="r-value">×${regionMult}</span>
    </div>
    ${rg.kpsi ? `<div class="r-row"><span class="r-label">KPSI ${rg.kpsi}</span><span class="r-value">×${kpsiMult.toFixed(2)}</span></div>` : ''}
    <div class="r-row">
      <span class="r-label">גיל</span>
      <span class="r-value">×${ageMult}</span>
    </div>
  `;

  if (rg.asking) {
    const profit = estValue - rg.asking;
    const margin = (profit / rg.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(rg.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">▦ שטיחים פרסיים</div>
      <div class="tip-body">
        <ul>
          <li>קום עם משי = יקר ביותר. לבדוק עם זכוכית מגדלת אם זה משי אמיתי</li>
          <li>ספור קשרים על-פי 10 ס"מ → מחלק ל-2.54 ↑ KPSI</li>
          <li>שטיח אנטיק 100+ שנה משלש את הערך</li>
          <li>קרעים, כתמים גדולים, או דהייה מורידים 40-70%</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#rg-save').hidden = !rg.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCRAP APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderScrapView() {
  $('#scrap-types').innerHTML = SCRAP_TYPES.map(s => `
    <button class="brand-btn ${state.scrap.type === s.k ? 'active' : ''}" data-type="${s.k}">
      <div>${s.name}</div>
      <div class="brand-sub">$${s.pricePerLb}/lb</div>
    </button>
  `).join('');
  $$('#scrap-types .brand-btn').forEach(b => b.addEventListener('click', () => { state.scrap.type = b.dataset.type; renderScrapView(); }));
  recalcScrap();
}

function recalcScrap() {
  const r = $('#sc-result');
  if (!r) return;
  const s = state.scrap;
  s.weight = parseFloat($('#sc-weight')?.value);
  s.unit = $('#sc-unit')?.value || 'kg';
  s.priceKg = parseFloat($('#sc-price-kg')?.value);
  s.asking = parseFloat($('#sc-asking')?.value);

  if (!s.weight || s.weight <= 0) { r.innerHTML = ''; $('#sc-save').hidden = true; return; }

  const scrapType = SCRAP_TYPES.find(t => t.k === s.type);
  if (!scrapType) return;

  const weightKg = s.unit === 'ton' ? s.weight * 1000 : s.weight;
  // Use manual price if provided, else use default per-lb price
  let pricePerKg;
  if (s.priceKg && s.priceKg > 0) {
    pricePerKg = s.priceKg;
  } else {
    pricePerKg = (scrapType.pricePerLb / POUND * 1000) * state.prices.usdIls;
    pricePerKg = pricePerKg / 1000; // back to per gram, then * 1000 for per kg
    pricePerKg = scrapType.pricePerLb * state.prices.usdIls / POUND;
  }

  const marketValue = weightKg * pricePerKg;
  const dealerPay = marketValue * scrapType.dealerMargin;

  let html = `
    <div class="r-row big">
      <span class="r-label">ערך שוק</span>
      <strong>₪${fmt0(marketValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר מסוחר סקראפ (~${(scrapType.dealerMargin*100).toFixed(0)}%)</span>
      <span class="r-value gold">₪${fmt0(dealerPay)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">משקל</span>
      <span class="r-value">${fmt(weightKg, 2)} ק"ג</span>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר לק"ג</span>
      <span class="r-value">₪${fmt(pricePerKg)}</span>
    </div>
  `;

  if (s.asking) {
    const profit = dealerPay - s.asking;
    const margin = (profit / s.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר רכישה מבוקש</span>
        <span class="r-value">₪${fmt0(s.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">רווח לסוחר</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">⚒ סקראפ - חשוב לדעת</div>
      <div class="tip-body">
        <ul>
          <li>מחירי המתכת בבורסה (LME) משתנים יומית - חפש "copper LME" באמת זמן</li>
          <li>נחושת חשופה מקבל 5-10% יותר מנחושת מצולקת</li>
          <li>פליז = ערבוב נחושת+אבץ ~70/30, לכן 60-70% ממחיר נחושת</li>
          <li>אלומיניום מכוניות שווה הרבה פחות מאלומיניום נקי</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#sc-save').hidden = !s.asking;
}
