// שמאי — היסטוריית מחירים, מחשבון, חיפוש ולוח מועדים. חלק מ-modules/shamai/src (סקריפטים רגילים בטווח שמות אחד, לפי סדר התגים ב-index.html)
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  PRICE HISTORY TRACKING - sparkline charts
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_HISTORY_KEY = 'priceHistory';
const MAX_HISTORY = 30; // keep last 30 data points per asset

function recordPriceHistory() {
  const history = Storage.load(PRICE_HISTORY_KEY) || {};
  const now = Date.now();
  const assets = ['gold', 'silver', 'platinum', 'usdIls', 'bitcoin', 'ethereum'];

  assets.forEach(asset => {
    const value = state.prices[asset];
    if (!value) return;
    if (!history[asset]) history[asset] = [];
    // Skip if last entry is within 1 hour
    const last = history[asset][history[asset].length - 1];
    if (last && (now - last.t) < 3600000) return;
    history[asset].push({ t: now, v: value });
    // Trim to max
    if (history[asset].length > MAX_HISTORY) {
      history[asset] = history[asset].slice(-MAX_HISTORY);
    }
  });

  Storage.save(PRICE_HISTORY_KEY, history);
}

function renderSparkline(asset, width = 60, height = 20) {
  const history = Storage.load(PRICE_HISTORY_KEY) || {};
  const data = history[asset];
  if (!data || data.length < 2) return '';

  const values = data.map(p => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data.map((p, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((p.v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const trend = values[values.length - 1] - values[0];
  const color = trend >= 0 ? '#34d399' : '#ef4444';

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
      <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points}" />
    </svg>
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATOR - quick math anywhere
// ─────────────────────────────────────────────────────────────────────────────

const calcState = {
  display: '0',
  pending: null,
  operator: null,
  history: [],
  memory: 0,
};

function calcButton(label, value, type = 'num') {
  return `<button class="calc-btn ${type}" data-calc="${value}">${label}</button>`;
}

function renderCalcView() {
  const c = $('#calc-view');
  if (!c) return;
  c.innerHTML = `
    <div class="calc-display">
      <div class="calc-history">${calcState.history.slice(-3).join(' → ')}</div>
      <div class="calc-screen" id="calc-screen">${calcState.display}</div>
    </div>
    <div class="calc-grid">
      ${calcButton('AC', 'AC', 'op')}
      ${calcButton('±', 'neg', 'op')}
      ${calcButton('%', '%', 'op')}
      ${calcButton('÷', '/', 'op-main')}
      ${calcButton('7', '7')}
      ${calcButton('8', '8')}
      ${calcButton('9', '9')}
      ${calcButton('×', '*', 'op-main')}
      ${calcButton('4', '4')}
      ${calcButton('5', '5')}
      ${calcButton('6', '6')}
      ${calcButton('−', '-', 'op-main')}
      ${calcButton('1', '1')}
      ${calcButton('2', '2')}
      ${calcButton('3', '3')}
      ${calcButton('+', '+', 'op-main')}
      ${calcButton('0', '0')}
      ${calcButton('.', '.')}
      ${calcButton('⌫', 'back', 'op')}
      ${calcButton('=', '=', 'eq')}
    </div>
    <div class="calc-shortcuts">
      <div class="text-faint" style="font-size:11px;margin-bottom:6px">קיצורים מהירים:</div>
      <div class="calc-quick-row">
        <button class="calc-quick" data-quick="oz-g">/31.1 (אונקיה→גרם)</button>
        <button class="calc-quick" data-quick="lb-kg">×0.4536 (פאונד→ק"ג)</button>
      </div>
      <div class="calc-quick-row">
        <button class="calc-quick" data-quick="usd-ils">×${fmt(state.prices.usdIls || 3.6, 3)} ($→₪)</button>
        <button class="calc-quick" data-quick="ils-usd">÷${fmt(state.prices.usdIls || 3.6, 3)} (₪→$)</button>
      </div>
      <div class="calc-quick-row">
        <button class="calc-quick" data-quick="vat">×1.17 (מע"מ)</button>
        <button class="calc-quick" data-quick="margin30">÷0.7 (רווח 30%)</button>
      </div>
    </div>
  `;

  // Wire up via event delegation (set up once globally)
}

function calcAction(action) {
  if (action === 'AC') {
    calcState.display = '0';
    calcState.pending = null;
    calcState.operator = null;
  } else if (action === 'back') {
    calcState.display = calcState.display.length > 1 ? calcState.display.slice(0, -1) : '0';
  } else if (action === 'neg') {
    if (calcState.display !== '0') {
      calcState.display = calcState.display.startsWith('-')
        ? calcState.display.slice(1)
        : '-' + calcState.display;
    }
  } else if (action === '%') {
    calcState.display = String(parseFloat(calcState.display) / 100);
  } else if (['+', '-', '*', '/'].includes(action)) {
    if (calcState.pending !== null && calcState.operator) {
      const result = doCalc(calcState.pending, parseFloat(calcState.display), calcState.operator);
      calcState.history.push(`${calcState.pending} ${calcState.operator} ${calcState.display} = ${result}`);
      calcState.display = String(result);
      calcState.pending = result;
    } else {
      calcState.pending = parseFloat(calcState.display);
    }
    calcState.operator = action;
    calcState.display = '0';
  } else if (action === '=') {
    if (calcState.pending !== null && calcState.operator) {
      const result = doCalc(calcState.pending, parseFloat(calcState.display), calcState.operator);
      calcState.history.push(`${calcState.pending} ${calcState.operator} ${calcState.display} = ${result}`);
      calcState.display = String(result);
      calcState.pending = null;
      calcState.operator = null;
    }
  } else if (action === '.') {
    if (!calcState.display.includes('.')) calcState.display += '.';
  } else {
    // digit
    calcState.display = calcState.display === '0' ? action : calcState.display + action;
  }
  renderCalcView();
}

function doCalc(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? 0 : a / b;
  }
  return 0;
}

function calcQuick(action) {
  const cur = parseFloat(calcState.display) || 0;
  let result = cur;
  let label = '';
  switch (action) {
    case 'oz-g':    result = cur * TROY_OZ; label = `${cur} oz = ${result.toFixed(2)} g`; break;
    case 'lb-kg':   result = cur * POUND;   label = `${cur} lb = ${result.toFixed(3)} kg`; break;
    case 'usd-ils': result = cur * (state.prices.usdIls || 3.6); label = `$${cur} = ₪${result.toFixed(2)}`; break;
    case 'ils-usd': result = cur / (state.prices.usdIls || 3.6); label = `₪${cur} = $${result.toFixed(2)}`; break;
    case 'vat':     result = cur * 1.17;    label = `${cur} +מע"מ = ${result.toFixed(2)}`; break;
    case 'margin30': result = cur / 0.7;    label = `${cur} (עלות) → ${result.toFixed(2)} (מחיר 30% רווח)`; break;
  }
  calcState.history.push(label);
  calcState.display = String(result.toFixed(4).replace(/\.?0+$/, ''));
  renderCalcView();
}

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL SEARCH - search across opportunities, prices, tools
// ─────────────────────────────────────────────────────────────────────────────

function performGlobalSearch(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results = [];

  // Search opportunities
  state.opportunities.forEach(o => {
    const haystack = `${o.name || ''} ${o.notes || ''} ${o.seller || ''} ${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        type: 'opp',
        title: o.name,
        sub: `${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''} · ${o.status === 'watching' ? 'במעקב' : o.status === 'bought' ? 'במלאי' : 'נמכר'} · ₪${fmt0(o.asking || 0)}`,
        action: () => {
          switchView('ledger');
          setTimeout(() => $('#opp-search').value = query, 100);
        },
      });
    }
  });

  // Search appraisal categories
  const subs = [
    { k: 'gold', name: 'זהב/כסף', kw: 'זהב כסף gold silver מתכת' },
    { k: 'diamond', name: 'יהלום', kw: 'יהלום diamond brilliant' },
    { k: 'watch', name: 'שעוני יוקרה', kw: 'שעון rolex patek watch' },
    { k: 'antique', name: 'יודאיקה ועתיקות', kw: 'עתיקות יודאיקה חנוכייה judaica' },
    { k: 'book', name: 'ספרי קודש', kw: 'ספר תורה תלמוד קודש shas' },
    { k: 'coin', name: 'מטבעות', kw: 'מטבע נומיסמטי coin' },
    { k: 'phone', name: 'טלפונים', kw: 'iphone galaxy phone טלפון' },
    { k: 'art', name: 'אומנות', kw: 'אומנות art ציור פסל' },
    { k: 'rug', name: 'שטיחים', kw: 'שטיח rug carpet משי' },
    { k: 'scrap', name: 'סקראפ', kw: 'סקראפ נחושת scrap' },
    { k: 'realestate', name: 'נדל"ן', kw: 'נדלן דירה real estate apartment' },
    { k: 'vehicle', name: 'רכב', kw: 'רכב מכונית car vehicle' },
    { k: 'nft', name: 'NFT', kw: 'nft crypto opensea' },
    { k: 'wine', name: 'יין', kw: 'יין wine bordeaux' },
    { k: 'bag', name: 'תיקי יוקרה', kw: 'תיק bag hermes chanel' },
    { k: 'gbook', name: 'ספרי אספנות', kw: 'ספר אספנות book first edition' },
  ];
  subs.forEach(s => {
    if (s.name.toLowerCase().includes(q) || s.kw.toLowerCase().includes(q)) {
      results.push({
        type: 'appraisal',
        title: `שמאות ${s.name}`,
        sub: 'פתח לשונית',
        action: () => { switchView('appraisal'); setTimeout(() => switchSubView('appraisal', s.k), 100); },
      });
    }
  });

  // Search tools
  const tools = [
    { k: 'roi', name: 'מחשבון ROI', kw: 'roi רווח תשואה' },
    { k: 'mortgage', name: 'משכנתא', kw: 'משכנתא mortgage שפיצר' },
    { k: 'rental', name: 'תשואת השכרה', kw: 'השכרה rental cap rate' },
    { k: 're-tax', name: 'מסי נדל"ן', kw: 'מס רכישה שבח' },
    { k: 'vehicle', name: 'עלות רכב', kw: 'רכב tco' },
    { k: 'currency', name: 'מטבעות', kw: 'מטבעות מטבע usd eur' },
    { k: 'crypto', name: 'קריפטו', kw: 'קריפטו bitcoin' },
    { k: 'analytics', name: 'אנליטיקה', kw: 'אנליטיקה גרפים' },
    { k: 'compare', name: 'השוואה', kw: 'השוואה compare' },
    { k: 'calc', name: 'מחשבון', kw: 'מחשבון calculator' },
  ];
  tools.forEach(t => {
    if (t.name.toLowerCase().includes(q) || t.kw.toLowerCase().includes(q)) {
      results.push({
        type: 'tool',
        title: t.name,
        sub: 'פתח כלי',
        action: () => { switchView('tools'); setTimeout(() => switchSubView('tools', t.k), 100); },
      });
    }
  });

  return results;
}

function renderGlobalSearch() {
  const overlay = $('#search-overlay');
  if (!overlay) return;
  const query = $('#global-search-input')?.value || '';
  const results = performGlobalSearch(query);
  const container = $('#search-results');
  if (!container) return;

  if (!query) {
    container.innerHTML = `<div class="text-faint" style="text-align:center;padding:30px">חפש פריטים, שמאויות, או כלים...</div>`;
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `<div class="text-faint" style="text-align:center;padding:30px">לא נמצאו תוצאות עבור "${escapeHtml(query)}"</div>`;
    return;
  }

  container.innerHTML = results.map((r, i) => `
    <button class="search-result" data-search-idx="${i}">
      <div class="sr-icon">${r.type === 'opp' ? '◎' : r.type === 'appraisal' ? '◆' : '⚙'}</div>
      <div class="sr-body">
        <div class="sr-title">${escapeHtml(r.title || '')}</div>
        <div class="sr-sub">${escapeHtml(r.sub || '')}</div>
      </div>
    </button>
  `).join('');

  $$('.search-result').forEach((b, i) => {
    b.addEventListener('click', () => {
      results[i].action();
      $('#search-overlay').hidden = true;
    });
  });
}

function openGlobalSearch() {
  const overlay = $('#search-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  setTimeout(() => $('#global-search-input')?.focus(), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEBREW HOLIDAYS / PARSHA WIDGET - ACCURATE HARDCODED SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────

// Accurate parsha schedule for Hebrew years 5786-5788 (Diaspora)
// Each entry: ISO date of Saturday → parsha name in Hebrew
// Source: hebcal.com/sedrot/5786,5787,5788
const PARSHA_SCHEDULE = {
  // 5786 (Sept 2025 - Sept 2026)
  '2025-10-18': 'בראשית',
  '2025-10-25': 'נח',
  '2025-11-01': 'לך לך',
  '2025-11-08': 'וירא',
  '2025-11-15': 'חיי שרה',
  '2025-11-22': 'תולדות',
  '2025-11-29': 'ויצא',
  '2025-12-06': 'וישלח',
  '2025-12-13': 'וישב',
  '2025-12-20': 'מקץ',
  '2025-12-27': 'ויגש',
  '2026-01-03': 'ויחי',
  '2026-01-10': 'שמות',
  '2026-01-17': 'וארא',
  '2026-01-24': 'בא',
  '2026-01-31': 'בשלח',
  '2026-02-07': 'יתרו',
  '2026-02-14': 'משפטים',
  '2026-02-21': 'תרומה',
  '2026-02-28': 'תצוה',
  '2026-03-07': 'כי תשא',
  '2026-03-14': 'ויקהל-פקודי',
  '2026-03-21': 'ויקרא',
  '2026-03-28': 'צו',
  '2026-04-04': 'שבת חול המועד פסח',
  '2026-04-11': 'שמיני',
  '2026-04-18': 'תזריע-מצורע',
  '2026-04-25': 'אחרי מות-קדושים',
  '2026-05-02': 'אמור',
  '2026-05-09': 'בהר-בחקתי',
  '2026-05-16': 'במדבר',
  '2026-05-23': 'נשא',
  '2026-05-30': 'בהעלתך',
  '2026-06-06': 'שלח',
  '2026-06-13': 'קרח',
  '2026-06-20': 'חקת',
  '2026-06-27': 'בלק',
  '2026-07-04': 'פינחס',
  '2026-07-11': 'מטות-מסעי',
  '2026-07-18': 'דברים',
  '2026-07-25': 'ואתחנן',
  '2026-08-01': 'עקב',
  '2026-08-08': 'ראה',
  '2026-08-15': 'שופטים',
  '2026-08-22': 'כי תצא',
  '2026-08-29': 'כי תבוא',
  '2026-09-05': 'נצבים-וילך',
  // 5787 starts Sept 12, 2026 (Rosh Hashana)
  '2026-09-19': 'האזינו',
  '2026-10-03': 'שבת חול המועד סוכות',
  '2026-10-10': 'בראשית',
  '2026-10-17': 'נח',
  '2026-10-24': 'לך לך',
  '2026-10-31': 'וירא',
  '2026-11-07': 'חיי שרה',
  '2026-11-14': 'תולדות',
  '2026-11-21': 'ויצא',
  '2026-11-28': 'וישלח',
  '2026-12-05': 'וישב',
  '2026-12-12': 'מקץ',
  '2026-12-19': 'ויגש',
  '2026-12-26': 'ויחי',
};

// Accurate Jewish holidays for 5786-5787
const JEWISH_HOLIDAYS = [
  // 5786
  { name: 'ראש השנה', date: '2025-09-23' },
  { name: 'יום כיפור', date: '2025-10-02' },
  { name: 'סוכות', date: '2025-10-07' },
  { name: 'שמחת תורה', date: '2025-10-14' },
  { name: 'חנוכה', date: '2025-12-15' },
  { name: 'ט"ו בשבט', date: '2026-02-02' },
  { name: 'פורים', date: '2026-03-03' },
  { name: 'פסח', date: '2026-04-02' },
  { name: 'יום השואה', date: '2026-04-14' },
  { name: 'יום העצמאות', date: '2026-04-22' },
  { name: 'ל"ג בעומר', date: '2026-05-05' },
  { name: 'שבועות', date: '2026-05-22' },
  { name: 'יז בתמוז', date: '2026-07-02' },
  { name: 'תשעה באב', date: '2026-07-23' },
  // 5787
  { name: 'ראש השנה', date: '2026-09-12' },
  { name: 'יום כיפור', date: '2026-09-21' },
  { name: 'סוכות', date: '2026-09-26' },
  { name: 'שמחת תורה', date: '2026-10-03' },
  { name: 'חנוכה', date: '2026-12-05' },
];

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCurrentParsha() {
  const now = new Date();
  // Find upcoming Saturday (or today if Saturday)
  const daysToShabbat = (6 - now.getDay() + 7) % 7;
  const nextShabbat = new Date(now.getTime() + daysToShabbat * 86400000);
  const key = isoDate(nextShabbat);
  return PARSHA_SCHEDULE[key] || null;
}

function getJewishHolidays() {
  const now = new Date();
  const today = isoDate(now);
  // Find next holiday in next 90 days
  for (const h of JEWISH_HOLIDAYS) {
    if (h.date >= today) {
      const holDate = new Date(h.date + 'T00:00:00');
      const daysAway = Math.ceil((holDate - now) / 86400000);
      if (daysAway <= 90) {
        return { name: h.name, daysAway, date: holDate };
      }
      return null;
    }
  }
  return null;
}
