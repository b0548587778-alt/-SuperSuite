// שמאי — שמאות יין, תיקים וספרים כלליים. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  WINE APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

const WINE_REGIONS = [
  { k: 'bordeaux',  name: 'בורדו',     base: 1.50 },
  { k: 'burgundy',  name: 'בורגונדי',  base: 1.80 },
  { k: 'champagne', name: 'שמפניה',    base: 1.30 },
  { k: 'tuscany',   name: 'טוסקנה',    base: 1.20 },
  { k: 'rioja',     name: 'ריוחה',     base: 0.90 },
  { k: 'napa',      name: 'נאפה',      base: 1.10 },
  { k: 'israeli-kosher', name: 'ישראל כשר', base: 0.70 },
  { k: 'other',     name: 'אחר',       base: 0.60 },
];

state.wine = state.wine || { region: 'bordeaux', name: '', vintage: null, score: null, asking: null, kosher: false };

function renderWineView() {
  const el = $('.sub-view[data-sub="wine"]');
  if (!el) return;
  $('#wn-regions').innerHTML = WINE_REGIONS.map(r => `
    <button class="brand-btn ${state.wine.region === r.k ? 'active' : ''}" data-wn-region="${r.k}">
      <div>${r.name}</div>
      <div class="brand-sub">×${r.base}</div>
    </button>
  `).join('');
  $$('#wn-regions .brand-btn').forEach(b => b.addEventListener('click', () => {
    state.wine.region = b.dataset.wnRegion;
    renderWineView();
  }));
  recalcWine();
}

function recalcWine() {
  const r = $('#wn-result');
  if (!r) return;
  const w = state.wine;
  w.name = $('#wn-name')?.value || '';
  w.vintage = parseInt($('#wn-vintage')?.value);
  w.score = parseFloat($('#wn-score')?.value);
  w.asking = parseFloat($('#wn-asking')?.value);
  w.kosher = $('#wn-kosher')?.checked || false;
  const baseRetail = parseFloat($('#wn-retail')?.value);

  if (!baseRetail) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">🍷 דרוש מחיר רטרייל</div><div class="tip-body">חפש את היין ב-Vivino/Wine-Searcher והזן את המחיר הממוצע.</div></div>`;
    $('#wn-save').hidden = true;
    return;
  }

  const region = WINE_REGIONS.find(x => x.k === w.region);
  const regionMult = region?.base ?? 1;
  // Age multiplier - wines from prestigious regions appreciate
  const age = w.vintage ? new Date().getFullYear() - w.vintage : 0;
  let ageMult = 1;
  if (age >= 30) ageMult = 2.5;
  else if (age >= 20) ageMult = 1.8;
  else if (age >= 10) ageMult = 1.3;
  else if (age >= 5) ageMult = 1.05;
  else if (age < 0) ageMult = 0.8; // future vintage = bottling year unclear
  // Score multiplier (Robert Parker scale)
  let scoreMult = 1;
  if (w.score >= 98) scoreMult = 3;
  else if (w.score >= 95) scoreMult = 2;
  else if (w.score >= 92) scoreMult = 1.4;
  else if (w.score >= 88) scoreMult = 1.1;
  else if (w.score < 85 && w.score > 0) scoreMult = 0.7;
  const kosherMult = w.kosher ? 1.15 : 1;

  const estValue = baseRetail * regionMult * ageMult * scoreMult * kosherMult;

  let html = `
    <div class="r-row big"><span class="r-label">שווי שוק משוער</span><strong>₪${fmt0(estValue)}</strong></div>
    <div class="r-row sep"><span class="r-label">רטרייל בסיס</span><span class="r-value">₪${fmt0(baseRetail)}</span></div>
    <div class="r-row"><span class="r-label">אזור</span><span class="r-value">×${regionMult}</span></div>
    ${age > 0 ? `<div class="r-row"><span class="r-label">גיל ${age} שנים</span><span class="r-value">×${ageMult}</span></div>` : ''}
    ${w.score ? `<div class="r-row"><span class="r-label">ציון ${w.score}</span><span class="r-value">×${scoreMult}</span></div>` : ''}
    ${w.kosher ? `<div class="r-row"><span class="r-label">כשר</span><span class="r-value">×${kosherMult}</span></div>` : ''}
  `;

  if (w.asking) {
    const profit = estValue - w.asking;
    const margin = (profit / w.asking) * 100;
    html += `
      <div class="r-row sep"><span class="r-label">מחיר מבוקש</span><span class="r-value">₪${fmt0(w.asking)}</span></div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}"><span class="r-label">פער</span><strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong></div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">🍷 יין - טיפים</div>
      <div class="tip-body">
        <ul>
          <li>אחסון נכון: 12-15°C, חשיכה, לחות 70%</li>
          <li>בקבוקים שלא נשמרו נכון = 50%+ ירידת ערך</li>
          <li>בדוק רמת מילוי (ullage) - ירידה משמעותית = פגום</li>
          <li>בדיקת מקור - חתימת יבואן רשמי חשובה</li>
          <li>יין כשר למהדרין = ביקוש גבוה בקהילות חרדיות</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#wn-save').hidden = !w.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HANDBAG/LUXURY BAG APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

const BAG_BRANDS = [
  { k: 'hermes',     name: 'Hermès',    liquidity: 1.10 },
  { k: 'chanel',     name: 'Chanel',    liquidity: 1.05 },
  { k: 'lv',         name: 'Louis V.',  liquidity: 1.00 },
  { k: 'gucci',      name: 'Gucci',     liquidity: 0.85 },
  { k: 'prada',      name: 'Prada',     liquidity: 0.80 },
  { k: 'dior',       name: 'Dior',      liquidity: 0.85 },
  { k: 'fendi',      name: 'Fendi',     liquidity: 0.75 },
  { k: 'celine',     name: 'Celine',    liquidity: 0.80 },
  { k: 'other',      name: 'אחר',       liquidity: 0.50 },
];

state.bag = state.bag || { brand: 'lv', model: '', year: null, condition: 'excellent', authenticated: false, asking: null, retail: null };

function renderBagView() {
  $('#bg-brands').innerHTML = BAG_BRANDS.map(b => `
    <button class="brand-btn ${state.bag.brand === b.k ? 'active' : ''}" data-bg-brand="${b.k}">
      <div>${b.name}</div>
      <div class="brand-sub">${(b.liquidity*100).toFixed(0)}%</div>
    </button>
  `).join('');
  $('#bg-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.bag.condition === c.k ? 'active' : ''}" data-bg-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#bg-brands .brand-btn').forEach(b => b.addEventListener('click', () => { state.bag.brand = b.dataset.bgBrand; renderBagView(); }));
  $$('#bg-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.bag.condition = b.dataset.bgCond; renderBagView(); }));
  recalcBag();
}

function recalcBag() {
  const r = $('#bg-result');
  if (!r) return;
  const b = state.bag;
  b.model = $('#bg-model')?.value || '';
  b.year = parseInt($('#bg-year')?.value);
  b.authenticated = $('#bg-auth')?.checked || false;
  b.asking = parseFloat($('#bg-asking')?.value);
  b.retail = parseFloat($('#bg-retail')?.value);

  if (!b.retail) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">👜 דרוש מחיר רטרייל</div><div class="tip-body">חפש את הדגם באתר היצרן הרשמי או ב-Fashionphile/Vestiaire Collective.</div></div>`;
    $('#bg-save').hidden = true;
    return;
  }

  const brand = BAG_BRANDS.find(x => x.k === b.brand);
  const liq = brand?.liquidity ?? 0.5;
  const cond = CONDITIONS.find(x => x.k === b.condition);
  const condMult = cond?.mult ?? 1;
  const authMult = b.authenticated ? 1.20 : 0.85;

  // Hermès Birkin/Kelly appreciate, others depreciate
  let categoryMult = 1;
  if (b.brand === 'hermes' && b.model.match(/birkin|kelly/i)) categoryMult = 1.5;
  else if (b.brand === 'chanel' && b.model.match(/classic|2\.55/i)) categoryMult = 1.2;

  const estValue = b.retail * liq * condMult * authMult * categoryMult;

  let html = `
    <div class="r-row big"><span class="r-label">שווי שוק משוער</span><strong>₪${fmt0(estValue)}</strong></div>
    <div class="r-row sep"><span class="r-label">רטרייל</span><span class="r-value">₪${fmt0(b.retail)}</span></div>
    <div class="r-row"><span class="r-label">נזילות מותג</span><span class="r-value">×${liq}</span></div>
    <div class="r-row"><span class="r-label">מצב</span><span class="r-value">×${condMult}</span></div>
    <div class="r-row"><span class="r-label">תיעוד אותנטי</span><span class="r-value">×${authMult}</span></div>
    ${categoryMult > 1 ? `<div class="r-row"><span class="r-label">דגם נחשק</span><span class="r-value">×${categoryMult}</span></div>` : ''}
  `;

  if (b.asking) {
    const profit = estValue - b.asking;
    const margin = (profit / b.asking) * 100;
    html += `
      <div class="r-row sep"><span class="r-label">מחיר מבוקש</span><span class="r-value">₪${fmt0(b.asking)}</span></div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}"><span class="r-label">פער</span><strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong></div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">👜 תיקי יוקרה - טיפים</div>
      <div class="tip-body">
        <ul>
          <li><strong>זיופים:</strong> 70%+ מהתיקים בשוק היד-2 - בדוק קוד תאריך, חתימות, סטיצ'</li>
          <li>תיעוד מקורי: קופסה + dust bag + קבלת רכישה = +20-30%</li>
          <li>Hermès Birkin: רשימת המתנה 2-6 שנים - לכן ערך גבוה ביד-2</li>
          <li>Chanel Classic Flap: עליית מחיר 8% בשנה ב-10 שנים אחרונות</li>
          <li>אומת ב-Entrupy/Authenticate First = ביטחון גבוה</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#bg-save').hidden = !b.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERAL BOOKS APPRAISAL (vs sefarim - this is for novels, textbooks, etc.)
// ─────────────────────────────────────────────────────────────────────────────

const BOOK_GEN_TYPES = [
  { k: 'first-edition', name: 'מהדורה ראשונה', base: 5.0 },
  { k: 'signed',       name: 'חתום',          base: 3.0 },
  { k: 'rare-print',   name: 'הדפסה נדירה',   base: 2.5 },
  { k: 'modern',       name: 'מודרני',        base: 0.4 },
  { k: 'textbook',     name: 'ספר לימוד',     base: 0.6 },
  { k: 'collector',    name: 'אספנות',        base: 1.5 },
];

state.gbook = state.gbook || { type: 'modern', name: '', author: '', year: null, condition: 'good', asking: null, retail: null };

function renderGBookView() {
  $('#gb-types').innerHTML = BOOK_GEN_TYPES.map(t => `
    <button class="brand-btn ${state.gbook.type === t.k ? 'active' : ''}" data-gb-type="${t.k}">
      <div>${t.name}</div>
      <div class="brand-sub">×${t.base}</div>
    </button>
  `).join('');
  $('#gb-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.gbook.condition === c.k ? 'active' : ''}" data-gb-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $$('#gb-types .brand-btn').forEach(b => b.addEventListener('click', () => { state.gbook.type = b.dataset.gbType; renderGBookView(); }));
  $$('#gb-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.gbook.condition = b.dataset.gbCond; renderGBookView(); }));
  recalcGBook();
}

function recalcGBook() {
  const r = $('#gb-result');
  if (!r) return;
  const g = state.gbook;
  g.name = $('#gb-name')?.value || '';
  g.author = $('#gb-author')?.value || '';
  g.year = parseInt($('#gb-year')?.value);
  g.asking = parseFloat($('#gb-asking')?.value);
  g.retail = parseFloat($('#gb-retail')?.value);

  if (!g.retail) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">📚 דרוש מחיר השוואה</div><div class="tip-body">חפש בעברית: סטימצקי, אאתר, יד-2 ספרים. באנגלית: Abebooks, Biblio.</div></div>`;
    $('#gb-save').hidden = true;
    return;
  }

  const type = BOOK_GEN_TYPES.find(t => t.k === g.type);
  const typeMult = type?.base ?? 1;
  const cond = CONDITIONS.find(c => c.k === g.condition);
  const condMult = cond?.mult ?? 1;
  const age = g.year ? new Date().getFullYear() - g.year : 0;
  let ageMult = 1;
  if (age >= 100) ageMult = 3;
  else if (age >= 50) ageMult = 1.8;
  else if (age >= 25) ageMult = 1.2;

  const estValue = g.retail * typeMult * condMult * ageMult;

  let html = `
    <div class="r-row big"><span class="r-label">שווי שוק משוער</span><strong>₪${fmt0(estValue)}</strong></div>
    <div class="r-row sep"><span class="r-label">מחיר השוואה</span><span class="r-value">₪${fmt0(g.retail)}</span></div>
    <div class="r-row"><span class="r-label">סוג</span><span class="r-value">×${typeMult}</span></div>
    <div class="r-row"><span class="r-label">מצב</span><span class="r-value">×${condMult}</span></div>
    ${age > 25 ? `<div class="r-row"><span class="r-label">גיל ${age} שנים</span><span class="r-value">×${ageMult}</span></div>` : ''}
  `;

  if (g.asking) {
    const profit = estValue - g.asking;
    const margin = (profit / g.asking) * 100;
    html += `
      <div class="r-row sep"><span class="r-label">מחיר מבוקש</span><span class="r-value">₪${fmt0(g.asking)}</span></div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}"><span class="r-label">פער</span><strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong></div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">📚 ספרים כלליים - טיפים</div>
      <div class="tip-body">
        <ul>
          <li>מהדורה ראשונה (1st edition, 1st printing) = ערך גבוה משמעותית</li>
          <li>חתימת מחבר ידוע = +200-500% מהמחיר הרגיל</li>
          <li>שלמות הDust Jacket חשובה מאוד - 50% מהערך</li>
          <li>בדוק כתמי לחות, קיפולים, חוסר דפים</li>
          <li>ABE/Biblio הם מקורות עיקריים להשוואת מחירים גלובלית</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#gb-save').hidden = !g.asking;
}


// ─────────────────────────────────────────────────────────────────────────────
//  EXTRA EVENT BINDINGS for new appraisal modules
// ─────────────────────────────────────────────────────────────────────────────

(function bindNewModuleEvents() {
  // Wait for DOM and bindEvents to have run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(bindNewModuleEvents, 100));
    return;
  }
  setTimeout(() => {
    // Wine
    ['wn-name', 'wn-vintage', 'wn-score', 'wn-asking', 'wn-retail', 'wn-kosher'].forEach(id => {
      document.addEventListener('input', e => { if (e.target.id === id) recalcWine(); });
      document.addEventListener('change', e => { if (e.target.id === id) recalcWine(); });
    });
    // Bag
    ['bg-model', 'bg-year', 'bg-asking', 'bg-retail', 'bg-auth'].forEach(id => {
      document.addEventListener('input', e => { if (e.target.id === id) recalcBag(); });
      document.addEventListener('change', e => { if (e.target.id === id) recalcBag(); });
    });
    // Books
    ['gb-name', 'gb-author', 'gb-year', 'gb-asking', 'gb-retail'].forEach(id => {
      document.addEventListener('input', e => { if (e.target.id === id) recalcGBook(); });
      document.addEventListener('change', e => { if (e.target.id === id) recalcGBook(); });
    });
    // Save buttons
    document.addEventListener('click', e => {
      if (e.target.id === 'wn-save') saveCurrentAsOpp('wine');
      if (e.target.id === 'bg-save') saveCurrentAsOpp('bag');
      if (e.target.id === 'gb-save') saveCurrentAsOpp('gbook');
    });
  }, 200);
})();
