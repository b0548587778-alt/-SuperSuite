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
        <button class="calc-quick" data-quick="vat">${vatPct() ? `+מע"מ ${escapeHtml(fmt(vatPct(), 1).replace(/\.0$/, ''))}%` : '+מע"מ (להגדיר שיעור)'}</button>
        <button class="calc-quick" data-quick="margin30">÷0.7 (רווח 30%)</button>
      </div>
      ${vatPct() ? '<div class="calc-quick-row"><button class="calc-quick" data-quick="vat-set">שינוי שיעור המע"מ</button></div>' : ''}
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

// שיעור המע"מ באחוזים — מה שהמשתמש הגדיר (state.settings.vatPct), או null. אין שיעור קבוע בקוד:
// פעם שיעור קבוע בקוד, שהתיישן כשהשיעור השתנה (בדיקת קוד 23.10.2026)
function vatPct() {
  const v = Number(state.settings && state.settings.vatPct);
  return Number.isFinite(v) && v > 0 && v < 100 ? v : null;
}

async function askVatPct() {
  const raw = await ssDialog.prompt('שיעור המע"מ באחוזים (לפי רשות המסים, היום):', vatPct() ? String(vatPct()) : '');
  if (raw === null) return null;
  const s = normalizeNumText(String(raw).replace('%', ''));
  const v = s === null ? NaN : Number(s);
  if (!(v > 0 && v < 100)) { toast('שיעור לא תקין', 'error'); return null; }
  state.settings.vatPct = v;
  Storage.save('settings', state.settings);
  return v;
}

async function calcQuick(action) {
  const cur = parseFloat(calcState.display) || 0;
  let result = cur;
  let label = '';
  if (action === 'vat-set') { await askVatPct(); renderCalcView(); return; }
  switch (action) {
    case 'oz-g':    result = cur * TROY_OZ; label = `${cur} oz = ${result.toFixed(2)} g`; break;
    case 'lb-kg':   result = cur * POUND;   label = `${cur} lb = ${result.toFixed(3)} kg`; break;
    case 'usd-ils': result = cur * (state.prices.usdIls || 3.6); label = `$${cur} = ₪${result.toFixed(2)}`; break;
    case 'ils-usd': result = cur / (state.prices.usdIls || 3.6); label = `₪${cur} = $${result.toFixed(2)}`; break;
    case 'vat': {
      const pct = vatPct() || await askVatPct();
      if (!pct) { renderCalcView(); return; }
      result = cur * (1 + pct / 100); label = `${cur} +מע"מ ${pct}% = ${result.toFixed(2)}`; break;
    }
    case 'margin30': result = cur / 0.7;    label = `${cur} (עלות) → ${result.toFixed(2)} (מחיר 30% רווח)`; break;
    default: return;
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
        // לפי שם הפריט: החיפוש בפנקס לא כולל את שם הקטגוריה, ושאילתה שנמצאה רק בה הייתה מציגה פנקס ריק
        action: () => showLedgerSearch(o.name || query),
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
//  לוח עברי: פרשת השבוע וחג קרוב — מחושבים מלוח השנה העברי המובנה במנוע (Intl, ICU), כמו shell/hebcal.js.
//  לוח ארץ ישראל. פעם: טבלה קבועה שנגמרה ב-26.12.2026, עם תווית שגויה ל-3.10.2026 (בדיקת קוד 23.10.2026)
// ─────────────────────────────────────────────────────────────────────────────

const HEB_DAY_MS = 86400000;
let hebCalFmt = null;
try { hebCalFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { hebCalFmt = null; }

// יום אזרחי ← 12:00 UTC של אותו יום, בלי תלות באזור הזמן (כמו civil ב-shell/hebcal.js)
const hebCivilDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);

function hebParts(t) {
  const p = hebCalFmt.formatToParts(new Date(t));
  const g = (k) => (p.find((x) => x.type === k) || {}).value;
  return { day: +g('day'), month: g('month'), year: +g('year') };
}

// הלוח העברי זמין ומחזיר שמות חודשים באנגלית (Tishri, Nisan...) — אחרת אין חישוב, והמסך מציג "—"
function hebCalendarAvailable() {
  if (!hebCalFmt) return false;
  try { const p = hebParts(Date.UTC(2026, 8, 12, 12)); return p.month === 'Tishri' && p.day === 1 && p.year === 5787; } catch (e) { return false; }
}

const PARSHIYOT = ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
  'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי',
  'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחקתי',
  'במדבר', 'נשא', 'בהעלתך', 'שלח', 'קרח', 'חקת', 'בלק', 'פינחס', 'מטות', 'מסעי',
  'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו'];
// פרשות שמתחברות (המספר = הראשונה בזוג), לפי סדר העדיפות לחיבור כשחסרות שבתות
const JOIN_BEFORE_PESACH = [21];               // ויקהל-פקודי
const JOIN_AFTER_PESACH = [41, 26, 28, 31];    // מטות-מסעי, תזריע-מצורע, אחרי מות-קדושים, בהר-בחקתי
const JOIN_LEAP_YEAR = [41, 26, 28, 31, 21];

// שבת שאין בה פרשה רגילה (ארץ ישראל): מועד או חול המועד
function hebSpecialShabbat(p) {
  const { month: m, day: d } = p;
  if (m === 'Tishri') {
    if (d <= 2) return 'ראש השנה';
    if (d === 10) return 'יום הכיפורים';
    if (d === 15) return 'סוכות';
    if (d >= 16 && d <= 21) return 'שבת חול המועד סוכות';
    if (d === 22) return 'שמיני עצרת ושמחת תורה';
  }
  if (m === 'Nisan') {
    if (d === 15) return 'פסח';
    if (d >= 16 && d <= 20) return 'שבת חול המועד פסח';
    if (d === 21) return 'שביעי של פסח';
  }
  if (m === 'Sivan' && d === 6) return 'שבועות';
  return null;
}

// א' בתשרי של השנה העברית של יום t
function hebNewYear(t) {
  let x = t - (hebParts(t).day - 1) * HEB_DAY_MS;
  for (let i = 0; i < 14 && hebParts(x).month !== 'Tishri'; i++) {
    x -= HEB_DAY_MS;
    x -= (hebParts(x).day - 1) * HEB_DAY_MS;
  }
  return x;
}

// הפרשות לשבתות של קטע בשנה: d שבתות חסרות = d חיבורים לפי סדר העדיפות. false — לא מסתדר (לא מנחשים)
function hebAssign(out, sats, from, to, joins) {
  const d = (to - from + 1) - sats.length;
  if (d < 0 || d > joins.length) return false;
  const joined = new Set(joins.slice(0, d));
  let k = from;
  for (const t of sats) {
    if (joined.has(k)) { out.set(t, PARSHIYOT[k] + '-' + PARSHIYOT[k + 1]); k += 2; } else { out.set(t, PARSHIYOT[k]); k += 1; }
  }
  return k === to + 1;
}

// כל שבתות השנה העברית שמתחילה ב-rh ← שם הפרשה. עוגנים: צו לפני פסח (שנה פשוטה), דברים בשבת שלפני ט' באב,
// ואתחנן אחריו ועד נצבים לפני ראש השנה; נצבים-וילך מתחברות כשראש השנה הבא בחמישי או בשבת
const hebParshaCache = new Map();
function hebParshaYear(rh) {
  if (hebParshaCache.has(rh)) return hebParshaCache.get(rh);
  const next = hebNewYear(rh + 390 * HEB_DAY_MS);
  const leap = next - rh > 380 * HEB_DAY_MS;
  const out = new Map();
  const sats = [];
  for (let t = rh + ((6 - new Date(rh).getUTCDay() + 7) % 7) * HEB_DAY_MS; t < next; t += 7 * HEB_DAY_MS) sats.push(t);
  let i = 0;
  // תשרי עד שמיני עצרת: וילך והאזינו, או רק האזינו כשנצבים-וילך חוברו בסוף השנה הקודמת
  const tishrei = [];
  for (; i < sats.length; i++) {
    const p = hebParts(sats[i]);
    if (!(p.month === 'Tishri' && p.day <= 22)) break;
    const sp = hebSpecialShabbat(p);
    if (sp) out.set(sats[i], sp); else tishrei.push(sats[i]);
  }
  if (tishrei.length === 2) { out.set(tishrei[0], PARSHIYOT[51]); out.set(tishrei[1], PARSHIYOT[52]); }
  else if (tishrei.length === 1) out.set(tishrei[0], PARSHIYOT[52]);
  // מבראשית עד ראש השנה הבא
  const free = [];
  for (; i < sats.length; i++) {
    const p = hebParts(sats[i]);
    const sp = hebSpecialShabbat(p);
    if (sp) out.set(sats[i], sp); else free.push({ t: sats[i], p });
  }
  const afterAv9 = free.findIndex(({ p }) => (p.month === 'Av' && p.day > 9) || p.month === 'Elul');
  const joinNV = [4, 6].includes(new Date(next).getUTCDay());
  let ok = afterAv9 > 0 && free.length - afterAv9 === 7;
  if (ok && leap) ok = hebAssign(out, free.slice(0, afterAv9).map((x) => x.t), 0, 43, JOIN_LEAP_YEAR);
  else if (ok) {
    const afterPesach = free.findIndex(({ p }) => (p.month === 'Nisan' && p.day > 21) || ['Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'].includes(p.month));
    ok = afterPesach > 0 && afterPesach < afterAv9
      && hebAssign(out, free.slice(0, afterPesach).map((x) => x.t), 0, 24, JOIN_BEFORE_PESACH)
      && hebAssign(out, free.slice(afterPesach, afterAv9).map((x) => x.t), 25, 43, JOIN_AFTER_PESACH);
  }
  if (ok) {
    free.slice(afterAv9).forEach(({ t }, j) => out.set(t, j === 6 && joinNV ? PARSHIYOT[50] + '-' + PARSHIYOT[51] : PARSHIYOT[44 + j]));
  } else {
    // לא הסתדר — רק המועדים, בלי ניחוש של פרשה
    for (const { t } of free) out.delete(t);
  }
  hebParshaCache.set(rh, out);
  return out;
}

// הפרשה של השבת הקרובה (היום, אם היום שבת)
function getCurrentParsha(now = new Date()) {
  if (!hebCalendarAvailable()) return null;
  const today = hebCivilDay(now);
  const shabbat = today + ((6 - new Date(today).getUTCDay() + 7) % 7) * HEB_DAY_MS;
  return hebParshaYear(hebNewYear(shabbat)).get(shabbat) || null;
}

// חג או צום ליום עברי (wd — יום בשבוע, 6 = שבת); צומות שחלים בשבת נדחים
function hebHolidayName(p, wd) {
  const { month: m, day: d } = p;
  if (m === 'Tishri') {
    if (d === 1) return 'ראש השנה';
    if (d === 10) return 'יום הכיפורים';
    if (d === 15) return 'סוכות';
    if (d === 22) return 'שמיני עצרת ושמחת תורה';
  }
  if (m === 'Kislev' && d === 25) return 'חנוכה';
  if (m === 'Tevet' && d === 10) return 'עשרה בטבת';
  if (m === 'Shevat' && d === 15) return 'ט״ו בשבט';
  if ((m === 'Adar' || m === 'Adar II') && d === 14) return 'פורים';
  if (m === 'Nisan' && d === 15) return 'פסח';
  if (m === 'Iyar' && d === 18) return 'ל״ג בעומר';
  if (m === 'Sivan' && d === 6) return 'שבועות';
  if (m === 'Tamuz' && ((d === 17 && wd !== 6) || (d === 18 && wd === 0))) return 'שבעה עשר בתמוז';
  if (m === 'Av' && ((d === 9 && wd !== 6) || (d === 10 && wd === 0))) return 'תשעה באב';
  return null;
}

// החג הקרוב ב-90 הימים הבאים (כולל היום): { name, daysAway, date } או null
function getJewishHolidays(now = new Date()) {
  if (!hebCalendarAvailable()) return null;
  const today = hebCivilDay(now);
  for (let i = 0; i <= 90; i++) {
    const t = today + i * HEB_DAY_MS;
    const name = hebHolidayName(hebParts(t), new Date(t).getUTCDay());
    if (name) return { name, daysAway: i, date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + i) };
  }
  return null;
}
