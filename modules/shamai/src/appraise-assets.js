// שמאי — שמאות נדל"ן, רכב ו-NFT. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  REAL ESTATE APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

const RE_TYPES = [
  { k: 'apartment', name: 'דירה',    base: 1.00 },
  { k: 'penthouse', name: 'פנטהאוז', base: 1.30 },
  { k: 'garden',    name: 'דירת גן', base: 1.15 },
  { k: 'house',     name: 'בית פרטי', base: 1.40 },
  { k: 'duplex',    name: 'דופלקס',  base: 1.20 },
  { k: 'studio',    name: 'יחידת דיור', base: 0.85 },
  { k: 'commercial', name: 'חנות',    base: 1.25 },
  { k: 'office',    name: 'משרד',     base: 1.10 },
  { k: 'storage',   name: 'מחסן',     base: 0.40 },
];

// הערכה מהירה בלבד: המחיר למ"ר מוקלד על ידי המשתמש (לפי עסקאות שבדק). אין בתוכנה מחירי אזורים —
// טבלה קבועה של מחירים הייתה מתיישנת ולא אומתה. שומה מקצועית — במסך "שמאות מקרקעין" במערכת הכלכלית.
state.realestate = state.realestate || {
  type: 'apartment', pricePerSqm: null, condition: 'good', size: null, rooms: 3,
  floor: 2, year: null, asking: null,
  elevator: false, parking: false, balcony: false, storage: false, renovated: false, tama: false, view: false, noise: false,
};

function renderRealEstateView() {
  $('#re-types').innerHTML = RE_TYPES.map(t => `
    <button class="brand-btn ${state.realestate.type === t.k ? 'active' : ''}" data-re-type="${t.k}">
      <div>${t.name}</div>
      <div class="brand-sub">×${t.base}</div>
    </button>
  `).join('');
  $('#re-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.realestate.condition === c.k ? 'active' : ''}" data-re-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#re-types .brand-btn').forEach(b => b.addEventListener('click', () => { state.realestate.type = b.dataset.reType; renderRealEstateView(); }));
  $$('#re-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.realestate.condition = b.dataset.reCond; renderRealEstateView(); }));
  recalcRealEstate();
}

// המקדמים כאן (סוג, מצב, מאפיינים, קומה) הם כללי אצבע להערכה גסה — לא נתוני שוק ולא שומה
function reQuickEstimate(re) {
  if (!(re.size > 0) || !(re.pricePerSqm > 0)) return null;
  const typeMult = RE_TYPES.find(t => t.k === re.type)?.base ?? 1;
  const condMult = CONDITIONS.find(c => c.k === re.condition)?.mult ?? 1;
  let featuresMult = 1;
  if (re.elevator) featuresMult *= 1.05;
  if (re.parking) featuresMult *= 1.06;
  if (re.balcony) featuresMult *= 1.04;
  if (re.storage) featuresMult *= 1.02;
  if (re.renovated) featuresMult *= 1.08;
  if (re.tama) featuresMult *= 1.10;
  if (re.view) featuresMult *= 1.03;
  if (re.noise) featuresMult *= 0.95;
  const floorMult = re.floor === 0 ? 0.95 : re.floor >= 4 ? 1.03 : 1.00;
  const baseValue = re.size * re.pricePerSqm;
  return { baseValue, typeMult, condMult, featuresMult, floorMult, value: baseValue * typeMult * condMult * featuresMult * floorMult };
}

const RE_PRO_NOTE = '<div class="tip-box"><div class="tip-title">⌂ הערכה גסה — לא שומה</div><div class="tip-body">לדוח שומה מקצועי עם עסקאות השוואה, התאמות ונעילה — "שמאות מקרקעין" בסרגל, בתחום "משכנתאות ונדל״ן".</div></div>';

function recalcRealEstate() {
  const r = $('#re-result');
  if (!r) return;
  const re = state.realestate;
  re.pricePerSqm = parseFloat(String($('#re-ppsqm')?.value || '').replace(/,/g, ''));
  re.size = parseFloat($('#re-size')?.value);
  re.rooms = parseFloat($('#re-rooms')?.value) || 3;
  re.floor = parseInt($('#re-floor')?.value) || 0;
  re.year = parseInt($('#re-year')?.value);
  re.asking = parseFloat($('#re-asking')?.value);
  re.elevator = $('#re-elevator')?.checked || false;
  re.parking = $('#re-parking')?.checked || false;
  re.balcony = $('#re-balcony')?.checked || false;
  re.storage = $('#re-storage')?.checked || false;
  re.renovated = $('#re-renovated')?.checked || false;
  re.tama = $('#re-tama')?.checked || false;
  re.view = $('#re-view')?.checked || false;
  re.noise = $('#re-noise')?.checked || false;

  const q = reQuickEstimate(re);
  if (!q) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">⌂ נדרשים שטח ומחיר למ"ר</div><div class="tip-body">הזן את שטח הנכס ואת המחיר הממוצע למ"ר באזור, לפי עסקאות שבדקת. התוכנה אינה מכירה מחירי שוק.</div></div>${RE_PRO_NOTE}`;
    $('#re-save').hidden = true;
    return;
  }
  const { baseValue, typeMult, condMult, featuresMult, floorMult, value: estValue } = q;

  let html = `
    <div class="r-row big">
      <span class="r-label">הערכה גסה</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">בסיס (${fmt0(re.pricePerSqm)} ₪/מ"ר שהוזן)</span><span class="r-value">₪${fmt0(baseValue)}</span></div>
    <div class="r-row"><span class="r-label">סוג נכס</span><span class="r-value">×${typeMult}</span></div>
    <div class="r-row"><span class="r-label">מצב</span><span class="r-value">×${condMult}</span></div>
    <div class="r-row"><span class="r-label">מאפיינים</span><span class="r-value">×${featuresMult.toFixed(2)}</span></div>
    ${re.floor !== undefined ? `<div class="r-row"><span class="r-label">קומה</span><span class="r-value">×${floorMult}</span></div>` : ''}
  `;

  if (re.asking) {
    const profit = estValue - re.asking;
    const margin = (profit / re.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(re.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פער</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    // Different verdict for real estate (lower margins than other appraisals)
    let cls = 'warning', txt = 'מחיר סביר - לא הזדמנות';
    if (margin >= 15) { cls = 'profit'; txt = '✓ מתחת לשוק - שווה לבדוק'; }
    else if (margin >= 7) { cls = 'profit'; txt = '~ קצת מתחת לשוק'; }
    else if (margin >= -5) { cls = 'warning'; txt = '~ מחיר שוק'; }
    else if (margin >= -15) { cls = 'loss'; txt = '✗ מעל מחיר שוק'; }
    else { cls = 'loss'; txt = '✗ מאוד מעל מחיר שוק'; }
    html += `<div class="verdict ${cls}">${txt}</div>`;
  }

  // Tax estimate for additional apartment
  const purchaseTax = computePurchaseTax(estValue, 'additional');
  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⌂ מסי רכישה צפויים</div>
      <div class="tip-body">
        כדירה נוספת: ₪${fmt0(purchaseTax)} (~${fmt(purchaseTax/estValue*100, 1)}%)<br>
        כדירה יחידה: ${fmt0(computePurchaseTax(estValue, 'single'))} ₪<br>
        ללוח מסים מלא תכנס לכלים → מסי נדל"ן
      </div>
    </div>
    <div class="tip-box">
      <div class="tip-title">⌂ נקודות חשובות</div>
      <div class="tip-body">
        <ul>
          <li>בדוק נסח טאבו, רמ"י, היתרים, חובות</li>
          <li>בדירה ישנה - חשוב לבדוק מצב צנרת וחשמל</li>
          <li>בנכסים בירושלים - בדוק רישוי שימוש (לפעמים כתוב מחסן ובפועל דירה)</li>
          <li>תמ"א 38 בעתיד = פוטנציאל אבל הסיכון הוא הזמן (10+ שנים)</li>
        </ul>
      </div>
    </div>
  `;

  r.innerHTML = html + RE_PRO_NOTE;
  $('#re-save').hidden = !re.asking;
}

// Helper for purchase tax (used by both real estate appraisal and tax tool)
function computePurchaseTax(value, status) {
  if (!value) return 0;
  const brackets = status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL;
  let tax = 0;
  for (const b of brackets) {
    const from = b.from || 0;
    if (value <= from) break;
    const to = b.limit || Infinity;
    const taxable = Math.min(value, to) - from;
    if (taxable > 0) tax += taxable * b.rate;
  }
  return tax;
}

// ─────────────────────────────────────────────────────────────────────────────
//  VEHICLE APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

const VEHICLE_BRANDS = [
  { k: 'toyota',     name: 'Toyota',     liquidity: 1.00 },
  { k: 'hyundai',    name: 'Hyundai',    liquidity: 0.95 },
  { k: 'kia',        name: 'Kia',        liquidity: 0.90 },
  { k: 'mazda',      name: 'Mazda',      liquidity: 0.95 },
  { k: 'honda',      name: 'Honda',      liquidity: 0.90 },
  { k: 'mitsubishi', name: 'Mitsubishi', liquidity: 0.85 },
  { k: 'nissan',     name: 'Nissan',     liquidity: 0.85 },
  { k: 'mercedes',   name: 'Mercedes',   liquidity: 0.85 },
  { k: 'bmw',        name: 'BMW',        liquidity: 0.80 },
  { k: 'audi',       name: 'Audi',       liquidity: 0.75 },
  { k: 'ford',       name: 'Ford',       liquidity: 0.70 },
  { k: 'other',      name: 'אחר',        liquidity: 0.70 },
];

const VEHICLE_CONDITIONS = [
  { k: 'excellent', name: 'מצוין', mult: 1.00, color: '#34d399' },
  { k: 'good',      name: 'טוב',    mult: 0.92, color: '#fbbf24' },
  { k: 'fair',      name: 'סביר',   mult: 0.80, color: '#fb923c' },
  { k: 'needs-work', name: 'דורש טיפול', mult: 0.60, color: '#ef4444' },
];

state.vehicleAppraisal = state.vehicleAppraisal || {
  brand: 'toyota', model: '', year: null, km: null, hand: '2',
  engine: 'gas', condition: 'good',
  test: false, accident: false, private: true, service: false,
  list: null, asking: null,
};

function renderVehicleAppraisalView() {
  $('#veh-brands').innerHTML = VEHICLE_BRANDS.map(b => `
    <button class="brand-btn ${state.vehicleAppraisal.brand === b.k ? 'active' : ''}" data-veh-brand="${b.k}">
      <div>${b.name}</div>
      <div class="brand-sub">${(b.liquidity*100).toFixed(0)}%</div>
    </button>
  `).join('');
  $('#veh-cond').innerHTML = VEHICLE_CONDITIONS.map(c => `
    <button class="cond-btn ${state.vehicleAppraisal.condition === c.k ? 'active' : ''}" data-veh-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#veh-brands .brand-btn').forEach(b => b.addEventListener('click', () => { state.vehicleAppraisal.brand = b.dataset.vehBrand; renderVehicleAppraisalView(); }));
  $$('#veh-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.vehicleAppraisal.condition = b.dataset.vehCond; renderVehicleAppraisalView(); }));
  recalcVehicleAppraisal();
}

function recalcVehicleAppraisal() {
  const r = $('#veh-result');
  if (!r) return;
  const v = state.vehicleAppraisal;
  v.model = $('#veh-model')?.value || '';
  v.year = parseInt($('#veh-year')?.value);
  v.km = parseInt($('#veh-km')?.value);
  v.hand = $('#veh-hand')?.value || '2';
  v.engine = $('#veh-engine')?.value || 'gas';
  v.test = $('#veh-test')?.checked || false;
  v.accident = $('#veh-accident')?.checked || false;
  v.private = $('#veh-private')?.checked || false;
  v.service = $('#veh-service')?.checked || false;
  v.list = parseFloat($('#veh-list')?.value);
  v.asking = parseFloat($('#veh-asking')?.value);

  if (!v.list || v.list <= 0) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">⊞ דרוש מחיר מחירון</div><div class="tip-body">חפש את הדגם בלוי יצחק או יד2 והזן את המחיר. בלי זה אי אפשר לחשב.</div></div>`;
    $('#veh-save').hidden = true;
    return;
  }

  const brand = VEHICLE_BRANDS.find(b => b.k === v.brand);
  const cond = VEHICLE_CONDITIONS.find(c => c.k === v.condition);
  const liquidity = brand?.liquidity ?? 0.7;
  const condMult = cond?.mult ?? 1;
  // Hand penalty
  const handMult = { '1': 1.05, '2': 1.00, '3': 0.92, '4+': 0.80 }[v.hand] ?? 1;
  // KM adjustment - average ~15,000 km/year. Above that = penalty
  let kmMult = 1;
  if (v.km && v.year) {
    const age = new Date().getFullYear() - v.year;
    const avgKm = 15000 * age;
    if (v.km > avgKm * 1.5) kmMult = 0.85;
    else if (v.km > avgKm * 1.2) kmMult = 0.92;
    else if (v.km < avgKm * 0.7) kmMult = 1.05;
  }
  const featMult = (v.test ? 1.03 : 1) * (v.accident ? 0.75 : 1) * (v.private ? 1.05 : 1) * (v.service ? 1.04 : 1);

  const estValue = v.list * liquidity * condMult * handMult * kmMult * featMult;
  const maxBuy = estValue * 0.85; // dealers buy at ~85% of resell value

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי שוק משוער</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה לסוחר (~85%)</span>
      <span class="r-value gold">₪${fmt0(maxBuy)}</span>
    </div>
    <div class="r-row sep"><span class="r-label">מחירון בסיס</span><span class="r-value">₪${fmt0(v.list)}</span></div>
    <div class="r-row"><span class="r-label">נזילות מותג</span><span class="r-value">×${liquidity}</span></div>
    <div class="r-row"><span class="r-label">מצב</span><span class="r-value">×${condMult}</span></div>
    <div class="r-row"><span class="r-label">יד</span><span class="r-value">×${handMult}</span></div>
    ${v.km ? `<div class="r-row"><span class="r-label">קילומטראז'</span><span class="r-value">×${kmMult.toFixed(2)}</span></div>` : ''}
    <div class="r-row"><span class="r-label">מאפיינים</span><span class="r-value">×${featMult.toFixed(2)}</span></div>
  `;

  if (v.asking) {
    const profit = estValue - v.asking;
    const margin = (profit / v.asking) * 100;
    html += `
      <div class="r-row sep"><span class="r-label">מחיר מבוקש</span><span class="r-value">₪${fmt0(v.asking)}</span></div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}"><span class="r-label">פער</span><strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong></div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⊞ רכב - בדיקות חובה</div>
      <div class="tip-body">
        <ul>
          <li>תיעוד תאונות: בעיה גדולה - חפש ב-Carfax/Levi Yitzhak Premium</li>
          <li>בדיקה במכון מורשה (~₪400) חובה לפני קנייה</li>
          <li>בדוק חובות ושעבודים ב-משרד הרישוי</li>
          <li>שנת ייצור 2017+ עם <100K ק"מ = הכי נזיל</li>
          <li>מותגים יקרים (BMW/Audi) פיחות גדול מהר → הזדמנויות לסוחרים</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#veh-save').hidden = !v.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NFT APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

const NFT_TYPES = [
  { k: 'pfp',       name: 'PFP אספנות',  base: 1.00 },
  { k: 'art-1of1',  name: 'אומנות 1/1',  base: 1.50 },
  { k: 'gen-art',   name: 'Generative',  base: 0.80 },
  { k: 'utility',   name: 'Utility/Membership', base: 1.20 },
  { k: 'gaming',    name: 'משחקים',       base: 0.60 },
  { k: 'music',     name: 'מוזיקה',       base: 0.70 },
];

state.nft = state.nft || {
  type: 'pfp', name: '', floor: null, rarity: null,
  oneOfOne: false, celeb: false, utility: false, historic: false,
  asking: null, currency: 'ETH',
};

function renderNFTView() {
  $('#nft-types').innerHTML = NFT_TYPES.map(t => `
    <button class="brand-btn ${state.nft.type === t.k ? 'active' : ''}" data-nft-type="${t.k}">
      <div>${t.name}</div>
      <div class="brand-sub">×${t.base}</div>
    </button>
  `).join('');
  $$('#nft-types .brand-btn').forEach(b => b.addEventListener('click', () => { state.nft.type = b.dataset.nftType; renderNFTView(); }));
  recalcNFT();
}

function recalcNFT() {
  const r = $('#nft-result');
  if (!r) return;
  const n = state.nft;
  n.name = $('#nft-name')?.value || '';
  n.floor = parseFloat($('#nft-floor')?.value);
  n.rarity = parseInt($('#nft-rarity')?.value);
  n.oneOfOne = $('#nft-1of1')?.checked || false;
  n.celeb = $('#nft-celeb')?.checked || false;
  n.utility = $('#nft-utility')?.checked || false;
  n.historic = $('#nft-historic')?.checked || false;
  n.asking = parseFloat($('#nft-asking')?.value);
  n.currency = $('#nft-currency')?.value || 'ETH';

  if (!n.floor || n.floor <= 0) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">⬢ דרוש Floor Price</div><div class="tip-body">חפש את הקולקציה ב-OpenSea והזן את המחיר הבסיסי הנוכחי ב-ETH.</div></div>`;
    $('#nft-save').hidden = true;
    return;
  }

  const typeMult = NFT_TYPES.find(t => t.k === n.type)?.base ?? 1;
  // Rarity contribution: top 1% gets 5x, top 5% gets 2.5x, top 10% gets 1.5x
  let rarityMult = 1;
  if (n.rarity) {
    if (n.rarity <= 100) rarityMult = 5;
    else if (n.rarity <= 500) rarityMult = 2.5;
    else if (n.rarity <= 1000) rarityMult = 1.5;
    else rarityMult = 1.0;
  }
  const oneMult = n.oneOfOne ? 6 : 1;
  const celebMult = n.celeb ? 3 : 1;
  const utilityMult = n.utility ? 1.5 : 1;
  const histMult = n.historic ? 2 : 1;

  const estETH = n.floor * typeMult * rarityMult * oneMult * celebMult * utilityMult * histMult;
  const ethToUsd = state.prices.ethereum || 3500;
  const usdIls = state.prices.usdIls || 3.6;
  const estUSD = estETH * ethToUsd;
  const estILS = estUSD * usdIls;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>${fmt(estETH, 4)} ETH</strong>
    </div>
    <div class="r-row"><span class="r-label">בדולרים</span><span class="r-value gold">$${fmt0(estUSD)}</span></div>
    <div class="r-row"><span class="r-label">בשקלים</span><span class="r-value">₪${fmt0(estILS)}</span></div>
    <div class="r-row sep"><span class="r-label">Floor Price</span><span class="r-value">${n.floor} ETH</span></div>
    <div class="r-row"><span class="r-label">סוג</span><span class="r-value">×${typeMult}</span></div>
    ${n.rarity ? `<div class="r-row"><span class="r-label">Rarity #${n.rarity}</span><span class="r-value">×${rarityMult}</span></div>` : ''}
    ${n.oneOfOne ? `<div class="r-row"><span class="r-label">1/1</span><span class="r-value">×${oneMult}</span></div>` : ''}
  `;

  if (n.asking) {
    let askingETH;
    if (n.currency === 'ETH') askingETH = n.asking;
    else if (n.currency === 'USD') askingETH = n.asking / ethToUsd;
    else askingETH = (n.asking / usdIls) / ethToUsd;

    const profit = estETH - askingETH;
    const margin = (profit / askingETH) * 100;
    html += `
      <div class="r-row sep"><span class="r-label">מחיר מבוקש</span><span class="r-value">${n.asking} ${n.currency}</span></div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}"><span class="r-label">פער</span><strong>${profit >= 0 ? '+' : ''}${fmt(profit, 4)} ETH (${fmt0(margin)}%)</strong></div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⬢ NFT - אזהרות</div>
      <div class="tip-body">
        <ul>
          <li>שוק NFT תנודתי במיוחד - 80% מהקולקציות נופלות 90%+ תוך שנה</li>
          <li>בדוק נפחי מסחר אמיתיים (לא wash-trades) ב-OpenSea Stats</li>
          <li>Rarity Sniper / Rarity Tools - לבדיקת נדירות אמיתית</li>
          <li>Royalties: יוצרים גוזרים 5-10% ממכירות שניוניות</li>
          <li>Gas fees ב-ETH יכולים להגיע ל-$50-200 בתקופות עומס</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#nft-save').hidden = !n.asking;
}
