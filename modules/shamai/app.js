// ============================================================================
//  שמאי v2.0 — Multi-domain trader platform
// ============================================================================

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS & DATA
// ─────────────────────────────────────────────────────────────────────────────

const TROY_OZ = 31.1035;     // grams in a troy ounce
const POUND   = 0.4535924;   // grams in a pound (avoirdupois) - for industrial metals

// Default fallback prices (used when API fails)
const DEFAULT_PRICES = {
  gold: 4665,
  silver: 75,
  platinum: 1850,
  palladium: 1100,
  copper: 4.20,        // USD per lb
  aluminum: 1.10,      // USD per lb
  usdIls: 3.65,
  eurIls: 4.00,
  gbpIls: 4.65,
  bitcoin: 95000,
  ethereum: 3500,
  solana: 200,
  binancecoin: 700,
  ripple: 2.30,
};

// Gold purities
const GOLD_PURITIES = [
  { k: '24K', value: 0.999, sub: '999/1000' },
  { k: '22K', value: 0.916, sub: '916/1000' },
  { k: '21K', value: 0.875, sub: '875/1000' },
  { k: '18K', value: 0.750, sub: '750/1000' },
  { k: '14K', value: 0.583, sub: '583/1000' },
  { k: '10K', value: 0.417, sub: '417/1000' },
  { k: '9K',  value: 0.375, sub: '375/1000' },
];

const SILVER_PURITIES = [
  { k: '999', value: 0.999, sub: 'טהור' },
  { k: '925', value: 0.925, sub: 'Sterling' },
  { k: '900', value: 0.900, sub: 'Coin' },
  { k: '835', value: 0.835, sub: 'גרמני' },
  { k: '800', value: 0.800, sub: 'אירופאי' },
];

// Common gold/silver coin presets
const COIN_PRESETS = [
  { name: 'נפוליאון', metal: 'gold', weight: 6.45, purity: 0.900, premium: 1.10 },
  { name: 'סוברן בריטי', metal: 'gold', weight: 7.98, purity: 0.917, premium: 1.10 },
  { name: 'Krugerrand 1oz', metal: 'gold', weight: 33.93, purity: 0.917, premium: 1.05 },
  { name: 'Maple Leaf 1oz', metal: 'gold', weight: 31.10, purity: 0.999, premium: 1.06 },
  { name: 'Eagle 1oz', metal: 'gold', weight: 33.93, purity: 0.917, premium: 1.07 },
  { name: 'Vienna Philharmonic', metal: 'gold', weight: 31.10, purity: 0.999, premium: 1.05 },
  { name: 'מטבע ישראלי 22K', metal: 'gold', weight: 13.34, purity: 0.917, premium: 1.20 },
  { name: 'דוקאט אוסטרי', metal: 'gold', weight: 3.49, purity: 0.986, premium: 1.10 },
  { name: 'דולר כסף', metal: 'silver', weight: 26.73, purity: 0.900, premium: 1.10 },
  { name: 'Maple Leaf כסף 1oz', metal: 'silver', weight: 31.10, purity: 0.999, premium: 1.30 },
];

// Diamond Rapaport-style base prices ($/carat) for round white natural
const DIAMOND_BASE_PRICES = [
  { min: 0.30, max: 0.39, price: 1800 },
  { min: 0.40, max: 0.49, price: 2400 },
  { min: 0.50, max: 0.69, price: 3200 },
  { min: 0.70, max: 0.89, price: 4800 },
  { min: 0.90, max: 0.99, price: 6800 },
  { min: 1.00, max: 1.49, price: 9500 },
  { min: 1.50, max: 1.99, price: 13500 },
  { min: 2.00, max: 2.99, price: 19000 },
  { min: 3.00, max: 3.99, price: 26000 },
  { min: 4.00, max: 4.99, price: 33000 },
  { min: 5.00, max: 99,   price: 42000 },
];

const DIAMOND_COLORS = [
  { k: 'D', mult: 1.00 }, { k: 'E', mult: 0.95 }, { k: 'F', mult: 0.90 },
  { k: 'G', mult: 0.78 }, { k: 'H', mult: 0.68 }, { k: 'I', mult: 0.55 },
  { k: 'J', mult: 0.45 }, { k: 'K', mult: 0.36 }, { k: 'L', mult: 0.30 },
  { k: 'M', mult: 0.25 },
];
const DIAMOND_CLARITY = [
  { k: 'FL',   mult: 1.20 }, { k: 'IF',   mult: 1.10 },
  { k: 'VVS1', mult: 0.95 }, { k: 'VVS2', mult: 0.85 },
  { k: 'VS1',  mult: 0.75 }, { k: 'VS2',  mult: 0.68 },
  { k: 'SI1',  mult: 0.55 }, { k: 'SI2',  mult: 0.45 },
  { k: 'I1',   mult: 0.30 }, { k: 'I2',   mult: 0.18 }, { k: 'I3', mult: 0.10 },
];
const DIAMOND_CUTS = [
  { k: 'Excellent', mult: 1.00 },
  { k: 'Very Good', mult: 0.90 },
  { k: 'Good',      mult: 0.78 },
  { k: 'Fair',      mult: 0.65 },
  { k: 'Poor',      mult: 0.50 },
];
const DIAMOND_SHAPES = [
  { k: 'round',    name: 'עגול', mult: 1.00 },
  { k: 'princess', name: 'נסיכה', mult: 0.78 },
  { k: 'cushion',  name: 'כרית', mult: 0.72 },
  { k: 'oval',     name: 'אובל', mult: 0.80 },
  { k: 'emerald',  name: 'אזמרגד', mult: 0.70 },
  { k: 'pear',     name: 'אגס', mult: 0.75 },
  { k: 'marquise', name: 'מרקיז', mult: 0.68 },
  { k: 'asscher',  name: 'אשר', mult: 0.72 },
  { k: 'radiant',  name: 'קורן', mult: 0.74 },
  { k: 'heart',    name: 'לב', mult: 0.72 },
];
const DIAMOND_FLUOR = [
  { k: 'None',   mult: 1.00 },
  { k: 'Faint',  mult: 0.98 },
  { k: 'Medium', mult: 0.92 },
  { k: 'Strong', mult: 0.82 },
];
const DIAMOND_CERTS = [
  { k: 'GIA', mult: 1.00, name: 'GIA' },
  { k: 'IGI', mult: 0.85, name: 'IGI' },
  { k: 'HRD', mult: 0.85, name: 'HRD' },
  { k: 'EGL', mult: 0.65, name: 'EGL' },
  { k: 'NONE', mult: 0.55, name: 'ללא תעודה' },
];

// Watch brands
const WATCH_BRANDS = [
  { k: 'rolex',       name: 'Rolex',       liquidity: 1.00 },
  { k: 'patek',       name: 'Patek Philippe', liquidity: 0.95 },
  { k: 'audemars',    name: 'AP',          liquidity: 0.95 },
  { k: 'omega',       name: 'Omega',       liquidity: 0.85 },
  { k: 'cartier',     name: 'Cartier',     liquidity: 0.85 },
  { k: 'iwc',         name: 'IWC',         liquidity: 0.80 },
  { k: 'jaeger',      name: 'JLC',         liquidity: 0.78 },
  { k: 'breitling',   name: 'Breitling',   liquidity: 0.75 },
  { k: 'panerai',     name: 'Panerai',     liquidity: 0.72 },
  { k: 'tudor',       name: 'Tudor',       liquidity: 0.78 },
  { k: 'vacheron',    name: 'VC',          liquidity: 0.82 },
  { k: 'other',       name: 'אחר',         liquidity: 0.60 },
];
const WATCH_CONDITIONS = {
  new:       { mult: 1.00, name: 'חדש בקופסה' },
  unworn:    { mult: 0.95, name: 'חדש לא לבוש' },
  excellent: { mult: 0.85, name: 'מצוין' },
  good:      { mult: 0.72, name: 'טוב' },
  fair:      { mult: 0.55, name: 'סביר' },
  poor:      { mult: 0.40, name: 'דורש שיפוץ' },
};
const WATCH_PAPERS = {
  full:    { mult: 1.00, name: 'מלא (קופסה+ניירות)' },
  partial: { mult: 0.85, name: 'חלקי' },
  none:    { mult: 0.70, name: 'ללא' },
};
const WATCH_SERVICE = {
  recent: { mult: 1.05, name: 'שירות אחרון <2 שנים' },
  medium: { mult: 1.00, name: '3-5 שנים' },
  old:    { mult: 0.85, name: '5+ שנים' },
};

// Antique categories
const ANTIQUE_CATS = [
  { k: 'judaica',  name: 'יודאיקה' },
  { k: 'coins',    name: 'מטבעות' },
  { k: 'watches',  name: 'שעונים' },
  { k: 'silver',   name: 'כלי כסף' },
  { k: 'books',    name: 'ספרים' },
  { k: 'art',      name: 'אומנות' },
  { k: 'furniture',name: 'רהיטים' },
  { k: 'jewelry',  name: 'תכשיטים' },
];
const CONDITIONS = [
  { k: 'mint',      name: 'מצב מנטה',   mult: 1.00, color: 'var(--green)'   },
  { k: 'excellent', name: 'מעולה',       mult: 0.85, color: 'var(--green)'   },
  { k: 'verygood',  name: 'טוב מאוד',    mult: 0.70, color: 'var(--yellow)'  },
  { k: 'good',      name: 'טוב',         mult: 0.55, color: 'var(--yellow)'  },
  { k: 'fair',      name: 'בינוני',      mult: 0.35, color: 'var(--red)'     },
  { k: 'poor',      name: 'גרוע',        mult: 0.20, color: 'var(--red)'     },
];
const HALLMARKS = [
  { k: 'general',  name: 'כללי',     mult: 1.00 },
  { k: 'german',   name: 'גרמני',    mult: 1.20 },
  { k: 'austrian', name: 'אוסטרי',   mult: 1.20 },
  { k: 'polish',   name: 'פולני',    mult: 1.30 },
  { k: 'russian',  name: 'רוסי',     mult: 1.40 },
  { k: 'english',  name: 'אנגלי',    mult: 1.15 },
];

// Book types & conditions
const BOOK_TYPES = [
  { k: 'shas',      name: 'ש"ס' },
  { k: 'chumash',   name: 'חומש' },
  { k: 'siddur',    name: 'סידור' },
  { k: 'machzor',   name: 'מחזור' },
  { k: 'mishnayos', name: 'משנה' },
  { k: 'rambam',    name: 'רמב"ם' },
  { k: 'chassidus', name: 'חסידות' },
  { k: 'other',     name: 'אחר' },
];
const BOOK_COMPLETE = {
  full:          { mult: 1.00, name: 'שלם' },
  'missing-few': { mult: 0.70, name: 'חסרים 1-3 דפים' },
  'missing-many':{ mult: 0.40, name: 'חסרים 4+ דפים' },
  incomplete:    { mult: 0.20, name: 'לא שלם' },
};

// Coin eras
const COIN_ERAS = [
  { k: 'ancient',  name: 'עתיק' },
  { k: 'mandate',  name: 'מנדט' },
  { k: 'israel',   name: 'ישראל' },
  { k: 'european', name: 'אירופאי' },
  { k: 'us',       name: 'אמריקאי' },
  { k: 'judaica',  name: 'יודאיקה' },
  { k: 'modern',   name: 'מודרני' },
  { k: 'other',    name: 'אחר' },
];
const COIN_GRADES = [
  { k: 'P',  name: 'P (Poor)',     mult: 0.30 },
  { k: 'F',  name: 'F (Fine)',     mult: 0.50 },
  { k: 'VF', name: 'VF (V.Fine)',  mult: 0.65 },
  { k: 'XF', name: 'XF (Ex.Fine)', mult: 0.78 },
  { k: 'AU', name: 'AU (About Unc.)', mult: 0.90 },
  { k: 'MS', name: 'MS (Mint State)', mult: 1.00 },
];

// Phone brands & data
const PHONE_BRANDS = [
  { k: 'iphone',  name: 'iPhone',  liquidity: 1.00 },
  { k: 'samsung', name: 'Samsung', liquidity: 0.85 },
  { k: 'pixel',   name: 'Pixel',   liquidity: 0.65 },
  { k: 'xiaomi',  name: 'Xiaomi',  liquidity: 0.55 },
  { k: 'oneplus', name: 'OnePlus', liquidity: 0.55 },
  { k: 'other',   name: 'אחר',     liquidity: 0.40 },
];
const PHONE_CONDITIONS = [
  { k: 'new',       name: 'חדש בקופסה',                mult: 1.00 },
  { k: 'excellent', name: 'מצוין · ללא שריטות',        mult: 0.90 },
  { k: 'good',      name: 'טוב · שריטות קטנות',        mult: 0.75 },
  { k: 'fair',      name: 'סביר · שריטות גלויות',     mult: 0.55 },
  { k: 'broken',    name: 'שבור / מסך פגוע',         mult: 0.25 },
];

// Art & rugs
const ART_TECHNIQUES = [
  { k: 'oil',         name: 'שמן',       mult: 1.00 },
  { k: 'acrylic',     name: 'אקריליק',   mult: 0.85 },
  { k: 'watercolor',  name: 'מים',       mult: 0.70 },
  { k: 'print',       name: 'הדפס',      mult: 0.30 },
  { k: 'sculpture',   name: 'פסל',       mult: 1.10 },
  { k: 'other',       name: 'אחר',       mult: 0.60 },
];
const RUG_REGIONS = [
  { k: 'isfahan', name: 'אספהאן',  mult: 1.30 },
  { k: 'tabriz',  name: 'תבריז',   mult: 1.20 },
  { k: 'qom',     name: 'קום',     mult: 1.40 },
  { k: 'kashan',  name: 'קשאן',    mult: 1.10 },
  { k: 'kerman',  name: 'כרמן',    mult: 1.00 },
  { k: 'turkish', name: 'טורקי',   mult: 0.85 },
  { k: 'caucasian', name: 'קווקזי', mult: 0.95 },
  { k: 'chinese', name: 'סיני',    mult: 0.70 },
  { k: 'other',   name: 'אחר',     mult: 0.60 },
];

// Scrap / industrial metals (approximate $/lb prices)
const SCRAP_TYPES = [
  { k: 'copper-bare',   name: 'נחושת חשופה',    pricePerLb: 4.20, dealerMargin: 0.75 },
  { k: 'copper-1',      name: 'נחושת #1',       pricePerLb: 4.00, dealerMargin: 0.72 },
  { k: 'copper-2',      name: 'נחושת #2',       pricePerLb: 3.70, dealerMargin: 0.70 },
  { k: 'brass',         name: 'פליז',           pricePerLb: 2.80, dealerMargin: 0.70 },
  { k: 'aluminum-clean',name: 'אלומיניום נקי',  pricePerLb: 1.10, dealerMargin: 0.65 },
  { k: 'aluminum-cans', name: 'פחיות אלומ.',    pricePerLb: 0.55, dealerMargin: 0.60 },
  { k: 'lead',          name: 'עופרת',          pricePerLb: 0.90, dealerMargin: 0.65 },
  { k: 'stainless',     name: 'נירוסטה',        pricePerLb: 0.80, dealerMargin: 0.60 },
  { k: 'iron',          name: 'ברזל',           pricePerLb: 0.20, dealerMargin: 0.55 },
];

// Crypto coins for dashboard
const CRYPTO_COINS = [
  { id: 'bitcoin',     symbol: 'BTC', name: 'Bitcoin'  },
  { id: 'ethereum',    symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana',      symbol: 'SOL', name: 'Solana'   },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB'      },
  { id: 'ripple',      symbol: 'XRP', name: 'XRP'      },
];

// Israeli purchase tax brackets (2025)
const PURCHASE_TAX_SINGLE = [
  { upTo: 1978745, rate: 0 },
  { upTo: 2347040, rate: 0.035 },
  { upTo: 6055070, rate: 0.05 },
  { upTo: 20183565, rate: 0.08 },
  { upTo: Infinity, rate: 0.10 },
];
const PURCHASE_TAX_ADDITIONAL = [
  { upTo: 6055070, rate: 0.08 },
  { upTo: Infinity, rate: 0.10 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  view: 'dashboard',     // dashboard / appraisal / ledger / tools
  subView: null,         // current sub-view inside appraisal/tools
  prices: { ...DEFAULT_PRICES, lastUpdate: null, source: 'default' },
  loading: false,

  // Per-domain working state
  gold:    { metal: 'gold', purity: 0.750, weight: 10, unit: 'g', asking: null, scrap: false },
  diamond: { origin: 'natural', carat: 1.00, shape: 'round', color: 'G', clarity: 'VS2', cut: 'Excellent', fluor: 'None', cert: 'GIA', asking: null, currency: 'ILS' },
  watch:   { brand: 'rolex', model: '', year: null, condition: 'excellent', papers: 'full', service: 'medium', retail: null, asking: null },
  antique: { cat: 'judaica', name: '', market: null, condition: 'excellent', hallmark: 'general', prov: false, signed: false, rare: false, asking: null },
  book:    { type: 'shas', name: '', edition: '', year: null, condition: 'excellent', complete: 'full', rabbi: false, glosses: false, binding: false, first: false, market: null, asking: null },
  coin:    { era: 'israel', name: '', year: null, metal: 'silver', weight: null, purity: 900, grade: 'XF', premium: 1.5, asking: null },
  phone:   { brand: 'iphone', model: '', storage: 128, warranty: 'none', condition: 'excellent', battery: null, retail: null, asking: null },
  art:     { artist: '', technique: 'oil', length: null, width: null, year: null, condition: 'excellent', signed: false, prov: false, frame: false, exhibited: false, market: null, asking: null },
  rug:     { region: 'isfahan', length: null, width: null, material: 'wool', kpsi: null, age: 'semi', condition: 'excellent', asking: null },
  scrap:   { type: 'copper-bare', weight: 100, unit: 'kg', priceKg: null, asking: null },

  // Ledger / opportunities
  opportunities: [],
  ledger: {
    filter: 'all',
    catFilter: null,
    sort: 'newest',
    search: '',
  },

  // Tools
  tools: {
    rePurchase: 'purchase',
  },

  // Settings
  settings: {
    theme: 'dark',
    currency: 'ILS',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  STORAGE (with IndexedDB for images)
// ─────────────────────────────────────────────────────────────────────────────

const Storage = {
  prefix: 'shamai_v2_',
  k: (name) => Storage.prefix + name,

  save(key, val) {
    try { localStorage.setItem(Storage.k(key), JSON.stringify(val)); }
    catch (e) { console.error('Save failed', key, e); }
  },
  load(key, fallback = null) {
    try {
      const raw = localStorage.getItem(Storage.k(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  remove(key) { localStorage.removeItem(Storage.k(key)); },
  clear() {
    Object.keys(localStorage).filter(k => k.startsWith(Storage.prefix)).forEach(k => localStorage.removeItem(k));
  },
};

// IndexedDB for storing images (more space than localStorage)
const ImageDB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('shamai_images', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images');
        }
      };
    });
  },
  async save(id, dataUrl) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async load(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readonly');
      const req = tx.objectStore('images').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async delete(id) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(id);
      tx.oncomplete = () => resolve();
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmt0 = (n) => fmt(n, 0);
const fmt1 = (n) => fmt(n, 1);

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function daysSince(iso) {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, type = '') {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function debounce(fn, ms = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Verdict helper (margin = profit %, profit = absolute)
function verdictHTML(profit, marginPct) {
  if (profit === null || marginPct === null || isNaN(marginPct)) return '';
  let cls = 'neutral', txt = '';
  if (marginPct >= 80)      { cls = 'green';  txt = '🔥 הזדמנות נדירה'; }
  else if (marginPct >= 40) { cls = 'green';  txt = '✓ עסקה טובה מאוד'; }
  else if (marginPct >= 15) { cls = 'yellow'; txt = '~ עסקה הוגנת'; }
  else if (marginPct >= 0)  { cls = 'yellow'; txt = '⚠ מחיר שוק'; }
  else                       { cls = 'red';    txt = '✗ מעל המחיר'; }
  const sign = profit >= 0 ? '+' : '';
  return `<div class="verdict ${cls}">${txt}<br><small>${sign}₪${fmt0(profit)} (${sign}${fmt0(marginPct)}%)</small></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRICE FETCHING
// ─────────────────────────────────────────────────────────────────────────────

// אין שליפת מחירים מהרשת: האפליקציה פועלת אופליין (CLAUDE.md, כלל 6). המחירים מוזנים ידנית.
async function fetchAllPrices(silent = false) {
  if (!silent) toast('מחירי שוק חיים לא זמינים במצב אופליין — ניתן להזין מחירים ידנית', 'info');
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERING - HEADER & DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function renderHeader() {
  const html = `
    <button class="mini-stat" id="btn-refresh" title="רענן" aria-label="רענן מחירים">
      <div class="mini-label">↻</div>
    </button>
    <div class="mini-stat">
      <div class="mini-label">Au</div>
      <div class="mini-value">$${fmt0(state.prices.gold)}</div>
    </div>
    <div class="mini-stat">
      <div class="mini-label">Ag</div>
      <div class="mini-value">$${fmt1(state.prices.silver)}</div>
    </div>
  `;
  $('#hdr-stats').innerHTML = html;
  $('#btn-refresh').addEventListener('click', () => fetchAllPrices(false));

  // Footer status
  const ftr = $('#footer-status');
  if (state.prices.lastUpdate) {
    const ago = daysSince(state.prices.lastUpdate);
    const updatedStr = new Date(state.prices.lastUpdate).toLocaleString('he-IL', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric',
    });
    let src = state.prices.source === 'live' ? 'חי' :
              (state.prices.source && state.prices.source.startsWith('live-partial')) ? 'חלקי' :
              state.prices.source === 'manual' ? 'ידני' : 'ברירת מחדל';
    ftr.innerHTML = `מקור: ${src} · עדכון: ${updatedStr}`;
  } else {
    ftr.innerHTML = 'הערכות מבוססות על נסחאות תעשייה. אינן תחליף לאבחון מקצועי.';
  }
}

function renderDashboard() {
  // Greeting
  const hr = new Date().getHours();
  let greet = 'בוקר טוב';
  if (hr >= 12 && hr < 17) greet = 'צהריים טובים';
  else if (hr >= 17 && hr < 21) greet = 'ערב טוב';
  else if (hr >= 21 || hr < 6) greet = 'לילה טוב';
  $('#hero-greet').textContent = greet;

  // Stats
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const sold = opps.filter(o => o.status === 'sold');
  const thisMonth = sold.filter(o => {
    const d = new Date(o.soldDate || o.created);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const potential = watching.reduce((sum, o) => sum + Math.max(0, (o.estimate || 0) - (o.asking || 0)), 0);
  const monthlyProfit = thisMonth.reduce((sum, o) => sum + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);

  $('#hero-active').textContent = watching.length;
  $('#hero-potential').textContent = '₪' + fmt0(potential);
  $('#hero-monthly').textContent = '₪' + fmt0(monthlyProfit);

  // Market cards
  const usdIls = state.prices.usdIls;
  $('#market-cards').innerHTML = `
    <div class="card gold-accent">
      <div class="c-sym">Au</div>
      <div class="c-name">זהב</div>
      <div class="c-price">$${fmt(state.prices.gold)}</div>
      <div class="c-sub">/oz · ₪${fmt0(state.prices.gold * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('gold')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Ag</div>
      <div class="c-name">כסף</div>
      <div class="c-price">$${fmt(state.prices.silver)}</div>
      <div class="c-sub">/oz · ₪${fmt(state.prices.silver * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('silver')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Pt</div>
      <div class="c-name">פלטינה</div>
      <div class="c-price">$${fmt(state.prices.platinum)}</div>
      <div class="c-sub">/oz · ₪${fmt0(state.prices.platinum * usdIls / TROY_OZ)} לגרם</div>
      <div class="c-spark">${renderSparkline('platinum')}</div>
    </div>
    <div class="card">
      <div class="c-sym">Ratio</div>
      <div class="c-name">זהב/כסף</div>
      <div class="c-price">${fmt1(state.prices.gold / state.prices.silver)}</div>
      <div class="c-sub">${state.prices.gold/state.prices.silver > 80 ? 'כסף זול' : state.prices.gold/state.prices.silver < 50 ? 'זהב זול' : 'נורמלי'}</div>
    </div>
  `;

  // Crypto cards
  const cryptoHtml = CRYPTO_COINS.slice(0, 4).map(c => {
    const price = state.prices[c.id];
    const change = state.prices[c.id + 'Change'];
    return `
      <div class="card">
        <div class="c-sym">${c.symbol}</div>
        <div class="c-name">${c.name}</div>
        <div class="c-price">$${fmt0(price)}</div>
        <div class="c-sub">
          ₪${fmt0(price * usdIls)}
          ${typeof change === 'number' ? `<span class="c-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${fmt1(change)}%</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  $('#crypto-cards').innerHTML = cryptoHtml;

  // FX row - prefer direct stored values, fallback to fxRates calculation
  const fx = state.prices.fxRates || {};
  const eurIls = state.prices.eurIls || (fx.EUR ? state.prices.usdIls / fx.EUR : 0);
  const gbpIls = state.prices.gbpIls || (fx.GBP ? state.prices.usdIls / fx.GBP : 0);
  $('#fx-row').innerHTML = `
    <div class="metric">
      <div class="metric-label">USD/ILS</div>
      <div class="metric-value">₪${fmt(state.prices.usdIls, 3)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">EUR/ILS</div>
      <div class="metric-value">₪${fmt(eurIls, 3)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">GBP/ILS</div>
      <div class="metric-value">₪${fmt(gbpIls, 3)}</div>
    </div>
  `;

  renderReminders();
}

function renderReminders() {
  const reminders = [];
  const now = Date.now();

  // Items watched > 30 days
  state.opportunities.filter(o => o.status === 'watching').forEach(o => {
    const days = daysSince(o.created);
    if (days >= 30) {
      reminders.push({
        title: `${escapeHtml(o.name)}`,
        sub: `במעקב ${days} יום - הזמן להחליט`,
      });
    }
  });

  // Bought items not yet sold > 90 days
  state.opportunities.filter(o => o.status === 'bought').forEach(o => {
    const days = daysSince(o.purchaseDate || o.created);
    if (days >= 90) {
      reminders.push({
        title: `${escapeHtml(o.name)}`,
        sub: `במלאי ${days} יום - שקול תמחור מחדש`,
      });
    }
  });

  const list = $('#reminders-list');
  if (reminders.length === 0) {
    list.innerHTML = '<div class="reminders-empty">אין תזכורות פעילות</div>';
  } else {
    list.innerHTML = reminders.slice(0, 5).map(r => `
      <div class="reminder">
        <div class="reminder-title">${r.title}</div>
        <div class="reminder-sub">${r.sub}</div>
      </div>
    `).join('');
  }
}

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
  const grams = unit === 'oz' ? w * TROY_OZ : unit === 'kg' ? w * 1000 : w;

  const spotUsd = g.metal === 'gold' ? state.prices.gold : state.prices.silver;
  const usdIls = state.prices.usdIls;
  const pricePerGramUsd = spotUsd / TROY_OZ;
  const pureGrams = grams * g.purity;
  const meltUsd = pureGrams * pricePerGramUsd;
  const meltIls = meltUsd * usdIls;

  // Scrap mode
  const scrap = $('#g-scrap-mode')?.checked;
  state.gold.scrap = scrap;
  const buyerPayUsd = scrap ? meltUsd * 0.70 : meltUsd;
  const buyerPayIls = scrap ? meltIls * 0.70 : meltIls;

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
      <span class="r-value">₪${fmt(pricePerGramUsd * usdIls)}</span>
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

  html += `
    <div class="tip-box">
      <div class="tip-title">◆ טיפ סוחרים</div>
      <div class="tip-body">
        סוחרי "סקראפ" משלמים בדרך כלל 60-75% משווי התכה. אם הגעת ל-+80% - הזדמנות מצוינת. תכשיטים עתיקים שווים בדרך כלל הרבה יותר משווי המתכת בלבד.
      </div>
    </div>
  `;

  r.innerHTML = html;
  $('#g-save').hidden = !asking;
}

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

  // Find base price for this carat range
  const bracket = DIAMOND_BASE_PRICES.find(b => carat >= b.min && carat <= b.max);
  if (!bracket) { r.innerHTML = ''; return; }
  const basePerCarat = bracket.price;

  // Find multipliers
  const colorMult = DIAMOND_COLORS.find(c => c.k === d.color)?.mult ?? 1;
  const clarMult  = DIAMOND_CLARITY.find(c => c.k === d.clarity)?.mult ?? 1;
  const cutMult   = DIAMOND_CUTS.find(c => c.k === d.cut)?.mult ?? 1;
  const shapeMult = DIAMOND_SHAPES.find(s => s.k === d.shape)?.mult ?? 1;
  const fluorMult = DIAMOND_FLUOR.find(f => f.k === d.fluor)?.mult ?? 1;
  const certMult  = DIAMOND_CERTS.find(c => c.k === d.cert)?.mult ?? 1;

  // Lab grown is 25% of natural in 2026
  const labMult = d.origin === 'lab' ? 0.25 : 1.00;

  const pricePerCarat = basePerCarat * colorMult * clarMult * cutMult * shapeMult * fluorMult * certMult * labMult;
  const retailUsd = pricePerCarat * carat;
  const wholesaleUsd = retailUsd * 0.65;

  const usdIls = state.prices.usdIls;
  const retailIls = retailUsd * usdIls;
  const wholesaleIls = wholesaleUsd * usdIls;

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

  const brand = WATCH_BRANDS.find(b => b.k === w.brand);
  const cond = WATCH_CONDITIONS[w.condition];
  const papers = WATCH_PAPERS[w.papers];
  const service = WATCH_SERVICE[w.service];

  // Estimated current value = retail × condition × papers × service
  const estValue = w.retail * cond.mult * papers.mult * service.mult;
  // Wholesale (what dealer would pay) = est × 0.78 × liquidity factor
  const wholesale = estValue * 0.78 * (0.85 + brand.liquidity * 0.15);

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
  $('#w-save').hidden = !w.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANTIQUE / JUDAICA APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderAntiqueView() {
  $('#cat-grid').innerHTML = ANTIQUE_CATS.map(c => `
    <button class="cat-btn ${state.antique.cat === c.k ? 'active' : ''}" data-cat="${c.k}">${c.name}</button>
  `).join('');
  $('#cond-grid').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.antique.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');
  $('#hallmark-grid').innerHTML = HALLMARKS.map(h => `
    <button class="hallmark-btn ${state.antique.hallmark === h.k ? 'active' : ''}" data-hallmark="${h.k}">
      <div>${h.name}</div>
      <div class="purity-sub">×${h.mult}</div>
    </button>
  `).join('');

  $$('#cat-grid .cat-btn').forEach(b => b.addEventListener('click', () => { state.antique.cat = b.dataset.cat; renderAntiqueView(); }));
  $$('#cond-grid .cond-btn').forEach(b => b.addEventListener('click', () => { state.antique.condition = b.dataset.cond; renderAntiqueView(); }));
  $$('#hallmark-grid .hallmark-btn').forEach(b => b.addEventListener('click', () => { state.antique.hallmark = b.dataset.hallmark; renderAntiqueView(); }));

  recalcAntique();
}

function calcSilverFromGrams(grams, purityPpt) {
  const pure = grams * (purityPpt / 1000);
  const meltUsd = pure * (state.prices.silver / TROY_OZ);
  return meltUsd * state.prices.usdIls;
}

function recalcAntique() {
  const r = $('#a-result');
  if (!r) return;
  const a = state.antique;
  a.name = $('#a-name')?.value || '';
  a.market = parseFloat($('#a-market')?.value);
  a.prov = $('#a-prov')?.checked || false;
  a.signed = $('#a-signed')?.checked || false;
  a.rare = $('#a-rare')?.checked || false;
  a.asking = parseFloat($('#a-asking')?.value);

  if (!a.market || a.market <= 0) { r.innerHTML = ''; $('#a-save').hidden = true; return; }

  const condMult = CONDITIONS.find(c => c.k === a.condition)?.mult ?? 1;
  const hallmarkMult = HALLMARKS.find(h => h.k === a.hallmark)?.mult ?? 1;
  const provMult = a.prov ? 1.25 : 1;
  const signedMult = a.signed ? 1.15 : 1;
  const rareMult = a.rare ? 1.50 : 1;

  const adjustedValue = a.market * condMult * hallmarkMult * provMult * signedMult * rareMult;
  const maxPurchase = adjustedValue * 0.55;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער (במצב הנוכחי)</span>
      <strong>₪${fmt0(adjustedValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי לסוחר (55%)</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מצב</span>
      <span class="r-value">×${condMult}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הולמרק/מקור</span>
      <span class="r-value">×${hallmarkMult}</span>
    </div>
  `;
  if (a.prov) html += `<div class="r-row"><span class="r-label">+ Provenance</span><span class="r-value green">+25%</span></div>`;
  if (a.signed) html += `<div class="r-row"><span class="r-label">+ חתימה</span><span class="r-value green">+15%</span></div>`;
  if (a.rare) html += `<div class="r-row"><span class="r-label">+ נדירות</span><span class="r-value green">+50%</span></div>`;

  if (a.asking) {
    const profit = adjustedValue - a.asking;
    const margin = (profit / a.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(a.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">❦ מקורות לבדיקת מחירים</div>
      <div class="tip-body">
        <ul>
          <li>יודאיקה: <strong>Kedem (קדם)</strong>, Sothebys, Tiroche, Winners, Genazym</li>
          <li>שעונים: Chrono24, WatchCharts</li>
          <li>אומנות: Artprice</li>
          <li>מטבעות: NGC Coin Explorer, PCGS Price Guide</li>
        </ul>
        חפש <strong>מכירה שהתבצעה בפועל</strong> (Hammer Price), לא הצעות מחיר נוכחיות.
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#a-save').hidden = !a.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOK APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderBookView() {
  $('#book-types').innerHTML = BOOK_TYPES.map(t => `
    <button class="cat-btn ${state.book.type === t.k ? 'active' : ''}" data-type="${t.k}">${t.name}</button>
  `).join('');
  $('#book-cond').innerHTML = CONDITIONS.map(c => `
    <button class="cond-btn ${state.book.condition === c.k ? 'active' : ''}" data-cond="${c.k}">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="cond-dot" style="background:${c.color}"></span>
        <span class="cond-name">${c.name}</span>
      </span>
      <span class="cond-mult">×${c.mult}</span>
    </button>
  `).join('');

  $$('#book-types .cat-btn').forEach(b => b.addEventListener('click', () => { state.book.type = b.dataset.type; renderBookView(); }));
  $$('#book-cond .cond-btn').forEach(b => b.addEventListener('click', () => { state.book.condition = b.dataset.cond; renderBookView(); }));

  recalcBook();
}

function recalcBook() {
  const r = $('#b-result');
  if (!r) return;
  const b = state.book;
  b.name = $('#b-name')?.value || '';
  b.edition = $('#b-edition')?.value || '';
  b.year = parseInt($('#b-year')?.value);
  b.complete = $('#b-complete')?.value || 'full';
  b.rabbi = $('#b-rabbi')?.checked || false;
  b.glosses = $('#b-glosses')?.checked || false;
  b.binding = $('#b-binding')?.checked || false;
  b.first = $('#b-first')?.checked || false;
  b.market = parseFloat($('#b-market')?.value);
  b.asking = parseFloat($('#b-asking')?.value);

  if (!b.market || b.market <= 0) { r.innerHTML = ''; $('#b-save').hidden = true; return; }

  const condMult = CONDITIONS.find(c => c.k === b.condition)?.mult ?? 1;
  const completeMult = BOOK_COMPLETE[b.complete]?.mult ?? 1;
  const rabbiMult = b.rabbi ? 1.40 : 1;
  const glossesMult = b.glosses ? 1.15 : 1;
  const bindingMult = b.binding ? 1.20 : 1;
  const firstMult = b.first ? 1.50 : 1;

  const adjustedValue = b.market * condMult * completeMult * rabbiMult * glossesMult * bindingMult * firstMult;
  const maxPurchase = adjustedValue * 0.55;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(adjustedValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">מצב</span>
      <span class="r-value">×${condMult}</span>
    </div>
    <div class="r-row">
      <span class="r-label">שלמות</span>
      <span class="r-value">×${completeMult}</span>
    </div>
  `;
  if (b.first) html += `<div class="r-row"><span class="r-label">+ מהדורה ראשונה</span><span class="r-value green">+50%</span></div>`;
  if (b.rabbi) html += `<div class="r-row"><span class="r-label">+ חתימת רב</span><span class="r-value green">+40%</span></div>`;
  if (b.binding) html += `<div class="r-row"><span class="r-label">+ כריכה מקורית</span><span class="r-value green">+20%</span></div>`;
  if (b.glosses) html += `<div class="r-row"><span class="r-label">+ הגהות</span><span class="r-value green">+15%</span></div>`;

  if (b.asking) {
    const profit = adjustedValue - b.asking;
    const margin = (profit / b.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(b.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">✡ ספרי קודש - מקורות</div>
      <div class="tip-body">
        <ul>
          <li>Kedem (קדם), Asufa, Genazym, Winner's - מכירות פומביות</li>
          <li>חתימת רב מפורסם או הקדשה לאדם ידוע = הכפלה במחיר</li>
          <li>הגהות בעט של דמות תורנית = פריט נדיר במיוחד</li>
          <li>וילנא ראשונה / ונציה = פי 5-10 ממהדורה רגילה</li>
          <li>תמיד בדוק שלמות - דפים חסרים מורידים 30-60%</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#b-save').hidden = !b.asking;
}

// ─────────────────────────────────────────────────────────────────────────────
//  COIN APPRAISAL
// ─────────────────────────────────────────────────────────────────────────────

function renderCoinView() {
  $('#coin-eras').innerHTML = COIN_ERAS.map(e => `
    <button class="cat-btn ${state.coin.era === e.k ? 'active' : ''}" data-era="${e.k}">${e.name}</button>
  `).join('');
  $('#cn-grade').innerHTML = COIN_GRADES.map(g => `
    <button class="scale-btn ${state.coin.grade === g.k ? 'active' : ''}" data-grade="${g.k}">${g.k}</button>
  `).join('');

  $$('#coin-eras .cat-btn').forEach(b => b.addEventListener('click', () => { state.coin.era = b.dataset.era; renderCoinView(); }));
  $$('#cn-grade .scale-btn').forEach(b => b.addEventListener('click', () => { state.coin.grade = b.dataset.grade; renderCoinView(); }));

  recalcCoin();
}

function recalcCoin() {
  const r = $('#cn-result');
  if (!r) return;
  const c = state.coin;
  c.name = $('#cn-name')?.value || '';
  c.year = parseInt($('#cn-year')?.value);
  c.metal = $('#cn-metal')?.value || 'silver';
  c.weight = parseFloat($('#cn-weight')?.value);
  c.purity = parseFloat($('#cn-purity')?.value) || 900;
  c.premium = parseFloat($('#cn-premium')?.value) || 1.5;
  c.asking = parseFloat($('#cn-asking')?.value);

  // Calculate melt value
  let meltIls = 0;
  if (c.weight && c.weight > 0 && (c.metal === 'gold' || c.metal === 'silver')) {
    const spotUsd = c.metal === 'gold' ? state.prices.gold : state.prices.silver;
    const pureGrams = c.weight * (c.purity / 1000);
    meltIls = pureGrams * (spotUsd / TROY_OZ) * state.prices.usdIls;
  }

  const gradeMult = COIN_GRADES.find(g => g.k === c.grade)?.mult ?? 1;
  // Numismatic value = melt × premium × grade
  const numismaticValue = meltIls * c.premium * gradeMult;
  const finalValue = Math.max(meltIls, numismaticValue);
  const maxPurchase = finalValue * 0.65;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי משוער</span>
      <strong>₪${fmt0(finalValue)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">מחיר רכישה מקסימלי</span>
      <span class="r-value gold">₪${fmt0(maxPurchase)}</span>
    </div>
  `;

  if (meltIls > 0) {
    html += `
      <div class="r-row sep">
        <span class="r-label">ערך התכה</span>
        <span class="r-value">₪${fmt0(meltIls)}</span>
      </div>
      <div class="r-row">
        <span class="r-label">פרמיה נומיסמטית</span>
        <span class="r-value">×${c.premium}</span>
      </div>
      <div class="r-row">
        <span class="r-label">מקדם דירוג</span>
        <span class="r-value">×${gradeMult}</span>
      </div>
    `;
  }

  if (c.asking) {
    const profit = finalValue - c.asking;
    const margin = (profit / c.asking) * 100;
    html += `
      <div class="r-row sep">
        <span class="r-label">מחיר מבוקש</span>
        <span class="r-value">₪${fmt0(c.asking)}</span>
      </div>
      <div class="r-row ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">
        <span class="r-label">פוטנציאל רווח</span>
        <strong>${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt0(margin)}%)</strong>
      </div>
    `;
    html += verdictHTML(profit, margin);
  }

  html += `
    <div class="tip-box">
      <div class="tip-title">◉ מטבעות - טיפים</div>
      <div class="tip-body">
        <ul>
          <li>בדוק NGC Coin Explorer / PCGS Price Guide למטבעות אמריקאים</li>
          <li>מטבעות ישראלים: Negev, רחם פרטי במכירות פומביות</li>
          <li>מטבעות זהב = כמעט תמיד מעל ערך התכה (מספר נדירות)</li>
          <li>סטטוס "Proof" / "Brilliant Uncirculated" = ×2-3 מ-MS רגיל</li>
          <li>חשד לזיוף? תמיד תשקול ובדוק מידות + צליל</li>
        </ul>
      </div>
    </div>
  `;
  r.innerHTML = html;
  $('#cn-save').hidden = !c.asking;
}


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


// ─────────────────────────────────────────────────────────────────────────────
//  LEDGER / OPPORTUNITIES
// ─────────────────────────────────────────────────────────────────────────────

const OPP_CATEGORIES = [
  { k: 'general', name: 'כללי' },
  { k: 'gold',    name: 'זהב/כסף' },
  { k: 'diamond', name: 'יהלום' },
  { k: 'watch',   name: 'שעון' },
  { k: 'antique', name: 'עתיקה' },
  { k: 'book',    name: 'ספר' },
  { k: 'coin',    name: 'מטבע' },
  { k: 'phone',   name: 'טלפון' },
  { k: 'art',     name: 'אומנות' },
  { k: 'rug',     name: 'שטיח' },
  { k: 'scrap',   name: 'סקראפ' },
  { k: 'realestate', name: 'נדל"ן' },
  { k: 'vehicle', name: 'רכב' },
  { k: 'nft',     name: 'NFT' },
  { k: 'wine',    name: 'יין' },
  { k: 'bag',     name: 'תיק' },
  { k: 'gbook',   name: 'ספר אספנות' },
];

function renderLedger() {
  // Stats
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const bought = opps.filter(o => o.status === 'bought');
  const sold = opps.filter(o => o.status === 'sold');
  const totalProfit = sold.reduce((s, o) => s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);

  $('#opp-stats').innerHTML = `
    <div class="stat-cell">
      <div class="sc-value">${opps.length}</div>
      <div class="sc-label">סה"כ</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:var(--yellow)">${watching.length}</div>
      <div class="sc-label">במעקב</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:var(--blue)">${bought.length}</div>
      <div class="sc-label">במלאי</div>
    </div>
    <div class="stat-cell">
      <div class="sc-value" style="color:${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${totalProfit >= 0 ? '+' : ''}₪${fmt0(totalProfit)}</div>
      <div class="sc-label">רווח</div>
    </div>
  `;

  // Category select for new opp
  $('#no-cat').innerHTML = OPP_CATEGORIES.map(c => `<option value="${c.k}">${c.name}</option>`).join('');

  // Cat filter row
  $('#cat-filter-row').innerHTML = `
    <button class="cat-filter-btn ${!state.ledger.catFilter ? 'active' : ''}" data-cat-filter="">כולם</button>
    ${OPP_CATEGORIES.map(c => `
      <button class="cat-filter-btn ${state.ledger.catFilter === c.k ? 'active' : ''}" data-cat-filter="${c.k}">${c.name}</button>
    `).join('')}
  `;
  $$('#cat-filter-row .cat-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.ledger.catFilter = b.dataset.catFilter || null;
      renderLedger();
    });
  });

  // Filter & sort & search
  let filtered = opps.slice();
  if (state.ledger.filter !== 'all') {
    filtered = filtered.filter(o => o.status === state.ledger.filter);
  }
  if (state.ledger.catFilter) {
    filtered = filtered.filter(o => o.category === state.ledger.catFilter);
  }
  if (state.ledger.search) {
    const q = state.ledger.search.toLowerCase();
    filtered = filtered.filter(o =>
      (o.name || '').toLowerCase().includes(q) ||
      (o.notes || '').toLowerCase().includes(q) ||
      (o.seller || '').toLowerCase().includes(q)
    );
  }
  // Sort
  switch (state.ledger.sort) {
    case 'oldest':      filtered.sort((a, b) => new Date(a.created) - new Date(b.created)); break;
    case 'profit-desc': filtered.sort((a, b) => oppProfit(b) - oppProfit(a)); break;
    case 'profit-pct':  filtered.sort((a, b) => oppMargin(b) - oppMargin(a)); break;
    case 'name':        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')); break;
    default:            filtered.sort((a, b) => new Date(b.created) - new Date(a.created)); break;
  }

  // Render
  const list = $('#opp-list');
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">◎</div>
        <div>${state.ledger.search || state.ledger.catFilter ? 'אין התאמות' : 'אין הזדמנויות עדיין'}</div>
        <div class="text-faint" style="margin-top:8px;font-size:13px">השתמש בכלי השמאות ושמור פריטים שאתה שוקל לקנות</div>
      </div>
    `;
  } else {
    list.innerHTML = filtered.map(renderOppCard).join('');
    // Wire up actions
    $$('.opp-card').forEach(card => {
      const id = card.dataset.id;
      $$('button[data-act]', card).forEach(b => {
        b.addEventListener('click', () => oppAction(id, b.dataset.act));
      });
      // Load image if exists
      if (card.dataset.hasPhoto === 'true') {
        ImageDB.load(`opp_${id}`).then(dataUrl => {
          if (dataUrl) {
            const ph = card.querySelector('.opp-photo');
            if (ph) ph.innerHTML = `<img src="${dataUrl}" alt="" />`;
          }
        });
      }
    });
  }

  // Update tab badge
  const badge = $('#ledger-badge');
  if (watching.length > 0) {
    badge.textContent = watching.length;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function oppProfit(o) {
  if (o.status === 'sold' && o.salePrice) {
    return o.salePrice - (o.purchasePrice || o.asking || 0);
  }
  return (o.estimate || 0) - (o.asking || 0);
}
function oppMargin(o) {
  const ref = o.status === 'sold' ? (o.purchasePrice || o.asking || 1) : (o.asking || 1);
  return (oppProfit(o) / ref) * 100;
}

function renderOppCard(o) {
  const cat = OPP_CATEGORIES.find(c => c.k === o.category) || OPP_CATEGORIES[0];
  const days = daysSince(o.created);
  const aging = days > 60 ? 'warn' : '';

  let pricesHtml = '';
  if (o.status === 'sold' && o.salePrice) {
    const profit = o.salePrice - (o.purchasePrice || o.asking || 0);
    pricesHtml = `
      <div class="opp-price-item">קנייה: ₪${fmt0(o.purchasePrice || o.asking)}</div>
      <div class="opp-price-item">מכירה: ₪${fmt0(o.salePrice)}</div>
      <div class="opp-price-item ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</div>
    `;
  } else if (o.status === 'bought') {
    pricesHtml = `
      <div class="opp-price-item">שולם: ₪${fmt0(o.purchasePrice || o.asking)}</div>
      ${o.estimate ? `<div class="opp-price-item">צפי: ₪${fmt0(o.estimate)}</div>` : ''}
    `;
  } else {
    const profit = (o.estimate || 0) - (o.asking || 0);
    pricesHtml = `
      <div class="opp-price-item">מבוקש: ₪${fmt0(o.asking)}</div>
      ${o.estimate ? `<div class="opp-price-item">משוער: ₪${fmt0(o.estimate)}</div>` : ''}
      ${o.estimate && o.asking ? `<div class="opp-price-item ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</div>` : ''}
    `;
  }

  let actions = '';
  const hasPhone = detectPhone(o.seller);
  const phoneActions = hasPhone ? `
      <button data-act="call" class="phone">📞 חייג</button>
      <button data-act="wa" class="whatsapp">💬 WhatsApp</button>
  ` : '';
  if (o.status === 'watching') {
    actions = `
      <button data-act="bought" class="primary">סומן כנקנה</button>
      ${phoneActions}
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  } else if (o.status === 'bought') {
    actions = `
      <button data-act="sold" class="primary">סומן כנמכר</button>
      ${phoneActions}
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  } else {
    actions = `
      <button data-act="share" class="share">שתף</button>
      <button data-act="pdf" class="pdf">PDF</button>
      <button data-act="edit">ערוך</button>
      <button data-act="delete" class="danger">מחק</button>
    `;
  }

  return `
    <div class="opp-card ${o.status}" data-id="${o.id}" data-has-photo="${!!o.hasPhoto}">
      <div class="opp-photo ${!o.hasPhoto ? 'empty' : ''}">${!o.hasPhoto ? '📷' : ''}</div>
      <div class="opp-body">
        <div class="opp-row1">
          <div class="opp-name">${escapeHtml(o.name)}</div>
          <span class="status-pill ${o.status}">${{watching:'במעקב',bought:'נקנה',sold:'נמכר'}[o.status]}</span>
        </div>
        <div class="opp-meta">${cat.name} · ${shortDate(o.created)} ${o.seller ? '· ' + escapeHtml(o.seller) : ''}</div>
        <div class="opp-prices">${pricesHtml}</div>
        ${o.notes ? `<div class="opp-meta" style="margin-top:4px;color:var(--text)">${escapeHtml(o.notes)}</div>` : ''}
        <div class="opp-aging ${aging}">${days === 0 ? 'היום' : `לפני ${days} יום`}</div>
        <div class="opp-actions">${actions}</div>
      </div>
    </div>
  `;
}

async function oppAction(id, action) {
  const opp = state.opportunities.find(o => o.id === id);
  if (!opp) return;

  if (action === 'delete') {
    if (!confirm(`למחוק "${opp.name}"?`)) return;
    state.opportunities = state.opportunities.filter(o => o.id !== id);
    await ImageDB.delete(`opp_${id}`);
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    toast('נמחק', 'success');
    return;
  }

  if (action === 'bought') {
    const actualPrice = prompt(`כמה שילמת בפועל? (מבוקש: ₪${fmt0(opp.asking)})`, String(opp.asking || ''));
    if (actualPrice === null) return;
    const price = parseFloat(actualPrice);
    if (!price || price <= 0) { toast('מחיר לא תקין', 'error'); return; }
    opp.status = 'bought';
    opp.purchasePrice = price;
    opp.purchaseDate = new Date().toISOString();
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    toast(`סומן כנקנה ב-₪${fmt0(price)}`, 'success');
    return;
  }

  if (action === 'sold') {
    const salePrice = prompt(`באיזה מחיר מכרת? (קנית ב-₪${fmt0(opp.purchasePrice)})`, '');
    if (salePrice === null) return;
    const price = parseFloat(salePrice);
    if (!price || price <= 0) { toast('מחיר לא תקין', 'error'); return; }
    opp.status = 'sold';
    opp.salePrice = price;
    opp.soldDate = new Date().toISOString();
    Storage.save('opportunities', state.opportunities);
    renderLedger();
    const profit = price - (opp.purchasePrice || opp.asking || 0);
    toast(`רווח: ${profit >= 0 ? '+' : ''}₪${fmt0(profit)}`, profit >= 0 ? 'success' : 'error');
    return;
  }

  if (action === 'edit') {
    openEditOpp(opp);
    return;
  }

  if (action === 'share') {
    const cat = OPP_CATEGORIES.find(c => c.k === opp.category)?.name || '';
    const profit = (opp.estimate || 0) - (opp.asking || 0);
    let text = `📋 ${opp.name}\n`;
    text += `קטגוריה: ${cat}\n`;
    if (opp.asking) text += `💰 מחיר מבוקש: ₪${fmt0(opp.asking)}\n`;
    if (opp.estimate) text += `📊 שווי משוער: ₪${fmt0(opp.estimate)}\n`;
    if (opp.asking && opp.estimate) {
      text += `${profit >= 0 ? '✅' : '⚠️'} פוטנציאל: ${profit >= 0 ? '+' : ''}₪${fmt0(profit)}\n`;
    }
    if (opp.seller) text += `📞 ${opp.seller}\n`;
    if (opp.notes) text += `📝 ${opp.notes}\n`;
    text += `\n— נשלח משמאי`;

    // Try Web Share API first (works on mobile)
    if (navigator.share) {
      navigator.share({ title: opp.name, text }).catch(() => {
        // Fallback to WhatsApp on cancel/error
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      });
    } else {
      // Open WhatsApp directly
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
    return;
  }
}

function openEditOpp(opp) {
  // Pre-fill the new opp form with values
  const f = $('#new-opp-form');
  f.hidden = false;
  $('.new-box-title', f).textContent = 'עריכת פריט';
  $('#no-name').value = opp.name;
  $('#no-asking').value = opp.asking || '';
  $('#no-est').value = opp.estimate || '';
  $('#no-cat').value = opp.category || 'general';
  $('#no-seller').value = opp.seller || '';
  $('#no-notes').value = opp.notes || '';
  $('#no-add').dataset.editId = opp.id;
  $('#no-add').textContent = 'שמור שינויים';
  // Load current photo
  if (opp.hasPhoto) {
    ImageDB.load(`opp_${opp.id}`).then(dataUrl => {
      if (dataUrl) {
        const preview = $('#no-photo-preview');
        preview.innerHTML = `<img src="${dataUrl}" alt="" />`;
        preview.hidden = false;
      }
    });
  }
}

function clearOppForm() {
  $('#new-opp-form').hidden = true;
  $('.new-box-title').textContent = 'פריט חדש';
  $('#no-name').value = '';
  $('#no-asking').value = '';
  $('#no-est').value = '';
  $('#no-cat').value = 'general';
  $('#no-seller').value = '';
  $('#no-notes').value = '';
  $('#no-photo').value = '';
  $('#no-photo-preview').innerHTML = '';
  $('#no-photo-preview').hidden = true;
  delete $('#no-add').dataset.editId;
  $('#no-add').textContent = 'הוסף';
  pendingPhoto = null;
}

let pendingPhoto = null; // base64 string awaiting save

async function saveOppFromForm() {
  const name = $('#no-name').value.trim();
  const asking = parseFloat($('#no-asking').value);
  const estimate = parseFloat($('#no-est').value);
  if (!name || !asking) { toast('נדרש שם ומחיר', 'error'); return; }

  const editId = $('#no-add').dataset.editId;
  if (editId) {
    // Update existing
    const opp = state.opportunities.find(o => o.id === editId);
    if (!opp) return;
    opp.name = name;
    opp.asking = asking;
    opp.estimate = estimate || null;
    opp.category = $('#no-cat').value;
    opp.seller = $('#no-seller').value.trim();
    opp.notes = $('#no-notes').value.trim();
    if (pendingPhoto) {
      await ImageDB.save(`opp_${editId}`, pendingPhoto);
      opp.hasPhoto = true;
    }
    Storage.save('opportunities', state.opportunities);
    toast('נשמר', 'success');
  } else {
    // Create new
    const id = uid();
    const opp = {
      id,
      name,
      asking,
      estimate: estimate || null,
      category: $('#no-cat').value,
      seller: $('#no-seller').value.trim(),
      notes: $('#no-notes').value.trim(),
      status: 'watching',
      created: new Date().toISOString(),
      hasPhoto: !!pendingPhoto,
    };
    state.opportunities.unshift(opp);
    if (pendingPhoto) await ImageDB.save(`opp_${id}`, pendingPhoto);
    Storage.save('opportunities', state.opportunities);
    toast('נוסף', 'success');
  }

  clearOppForm();
  renderLedger();
}

// Save current appraisal as opp
function saveCurrentAsOpp(category) {
  const id = uid();
  let opp = {
    id, category, status: 'watching',
    created: new Date().toISOString(),
    hasPhoto: false,
  };

  switch (category) {
    case 'gold': {
      const g = state.gold;
      const w = parseFloat($('#g-weight').value);
      const unit = $('#g-unit').value;
      const grams = unit === 'oz' ? w * TROY_OZ : unit === 'kg' ? w * 1000 : w;
      const spotUsd = g.metal === 'gold' ? state.prices.gold : state.prices.silver;
      const meltIls = grams * g.purity * (spotUsd / TROY_OZ) * state.prices.usdIls;
      opp.name = `${g.metal === 'gold' ? 'זהב' : 'כסף'} ${(g.purity*1000).toFixed(0)}/1000 - ${w}${unit}`;
      opp.asking = g.asking;
      opp.estimate = meltIls;
      break;
    }
    case 'diamond': {
      const d = state.diamond;
      const carat = parseFloat($('#d-carat').value);
      opp.name = `יהלום ${d.origin === 'lab' ? 'מעבדה ' : ''}${carat}ct ${d.color}/${d.clarity}/${d.cut}`;
      opp.asking = d.currency === 'USD' ? d.asking * state.prices.usdIls : d.asking;
      // Compute estimate same as recalcDiamond
      const bracket = DIAMOND_BASE_PRICES.find(b => carat >= b.min && carat <= b.max);
      if (bracket) {
        const colorMult = DIAMOND_COLORS.find(c => c.k === d.color)?.mult ?? 1;
        const clarMult  = DIAMOND_CLARITY.find(c => c.k === d.clarity)?.mult ?? 1;
        const cutMult   = DIAMOND_CUTS.find(c => c.k === d.cut)?.mult ?? 1;
        const shapeMult = DIAMOND_SHAPES.find(s => s.k === d.shape)?.mult ?? 1;
        const fluorMult = DIAMOND_FLUOR.find(f => f.k === d.fluor)?.mult ?? 1;
        const certMult  = DIAMOND_CERTS.find(c => c.k === d.cert)?.mult ?? 1;
        const labMult   = d.origin === 'lab' ? 0.25 : 1.00;
        opp.estimate = bracket.price * colorMult * clarMult * cutMult * shapeMult * fluorMult * certMult * labMult * carat * 0.65 * state.prices.usdIls;
      }
      break;
    }
    case 'watch': {
      const w = state.watch;
      opp.name = `${WATCH_BRANDS.find(b => b.k === w.brand)?.name || ''} ${w.model || ''}`.trim();
      opp.asking = w.asking;
      opp.estimate = w.retail * (WATCH_CONDITIONS[w.condition]?.mult ?? 1) * (WATCH_PAPERS[w.papers]?.mult ?? 1);
      break;
    }
    case 'antique': {
      const a = state.antique;
      opp.name = a.name || ANTIQUE_CATS.find(c => c.k === a.cat)?.name;
      opp.asking = a.asking;
      const condMult = CONDITIONS.find(c => c.k === a.condition)?.mult ?? 1;
      const hMult = HALLMARKS.find(h => h.k === a.hallmark)?.mult ?? 1;
      const provMult = a.prov ? 1.25 : 1;
      const signedMult = a.signed ? 1.15 : 1;
      const rareMult = a.rare ? 1.50 : 1;
      opp.estimate = a.market * condMult * hMult * provMult * signedMult * rareMult;
      break;
    }
    case 'book': {
      const b = state.book;
      opp.name = b.name || BOOK_TYPES.find(t => t.k === b.type)?.name;
      opp.asking = b.asking;
      const condMult = CONDITIONS.find(c => c.k === b.condition)?.mult ?? 1;
      const compMult = BOOK_COMPLETE[b.complete]?.mult ?? 1;
      const rabbiMult = b.rabbi ? 1.40 : 1;
      const glossesMult = b.glosses ? 1.15 : 1;
      const bindingMult = b.binding ? 1.20 : 1;
      const firstMult = b.first ? 1.50 : 1;
      opp.estimate = b.market * condMult * compMult * rabbiMult * glossesMult * bindingMult * firstMult;
      break;
    }
    case 'coin': {
      const c = state.coin;
      opp.name = c.name || `מטבע ${c.year || ''}`.trim();
      opp.asking = c.asking;
      // Approximate estimate
      const spotUsd = c.metal === 'gold' ? state.prices.gold : c.metal === 'silver' ? state.prices.silver : 0;
      const meltIls = c.weight ? c.weight * (c.purity / 1000) * (spotUsd / TROY_OZ) * state.prices.usdIls : 0;
      const gradeMult = COIN_GRADES.find(g => g.k === c.grade)?.mult ?? 1;
      opp.estimate = Math.max(meltIls, meltIls * c.premium * gradeMult);
      break;
    }
    case 'phone': {
      const p = state.phone;
      opp.name = `${PHONE_BRANDS.find(b => b.k === p.brand)?.name} ${p.model}`.trim();
      opp.asking = p.asking;
      const cond = PHONE_CONDITIONS.find(c => c.k === p.condition);
      opp.estimate = p.retail * (cond?.mult ?? 1) * (PHONE_BRANDS.find(b => b.k === p.brand)?.liquidity ?? 0.5);
      break;
    }
    case 'art': {
      const a = state.art;
      opp.name = a.artist || 'יצירת אומנות';
      opp.asking = a.asking;
      opp.estimate = a.market;
      break;
    }
    case 'rug': {
      const rg = state.rug;
      opp.name = `שטיח ${RUG_REGIONS.find(r => r.k === rg.region)?.name} ${rg.length}×${rg.width}`;
      opp.asking = rg.asking;
      opp.estimate = rg.asking ? rg.asking * 1.5 : null; // rough
      break;
    }
    case 'scrap': {
      const s = state.scrap;
      opp.name = SCRAP_TYPES.find(t => t.k === s.type)?.name + ` ${s.weight}${s.unit}`;
      opp.asking = s.asking;
      const scrapType = SCRAP_TYPES.find(t => t.k === s.type);
      const weightKg = s.unit === 'ton' ? s.weight * 1000 : s.weight;
      opp.estimate = weightKg * scrapType.pricePerLb * state.prices.usdIls / POUND * scrapType.dealerMargin;
      break;
    }
    case 'realestate': {
      const re = state.realestate;
      const typeName = RE_TYPES.find(t => t.k === re.type)?.name || 'נכס';
      opp.name = `${typeName} ${re.size || ''}מ"ר ${re.rooms || ''} חד'`.trim();
      opp.asking = re.asking;
      const pricePerSqm = RE_AREAS[re.area];
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
      opp.estimate = (re.size || 0) * pricePerSqm * typeMult * condMult * featuresMult * floorMult;
      break;
    }
    case 'vehicle': {
      const v = state.vehicleAppraisal;
      const brandName = VEHICLE_BRANDS.find(b => b.k === v.brand)?.name || '';
      opp.name = `${brandName} ${v.model || ''} ${v.year || ''}`.trim();
      opp.asking = v.asking;
      const liquidity = VEHICLE_BRANDS.find(b => b.k === v.brand)?.liquidity ?? 0.7;
      const condMult = VEHICLE_CONDITIONS.find(c => c.k === v.condition)?.mult ?? 1;
      const handMult = { '1': 1.05, '2': 1.00, '3': 0.92, '4+': 0.80 }[v.hand] ?? 1;
      let kmMult = 1;
      if (v.km && v.year) {
        const age = new Date().getFullYear() - v.year;
        const avgKm = 15000 * age;
        if (v.km > avgKm * 1.5) kmMult = 0.85;
        else if (v.km > avgKm * 1.2) kmMult = 0.92;
        else if (v.km < avgKm * 0.7) kmMult = 1.05;
      }
      const featMult = (v.test ? 1.03 : 1) * (v.accident ? 0.75 : 1) * (v.private ? 1.05 : 1) * (v.service ? 1.04 : 1);
      opp.estimate = (v.list || 0) * liquidity * condMult * handMult * kmMult * featMult;
      break;
    }
    case 'nft': {
      const n = state.nft;
      const typeName = NFT_TYPES.find(t => t.k === n.type)?.name || 'NFT';
      opp.name = `${typeName} ${n.name || ''}`.trim();
      // Convert asking to ILS
      const ethToUsd = state.prices.ethereum || 3500;
      const usdIls = state.prices.usdIls || 3.6;
      if (n.currency === 'ETH') opp.asking = n.asking * ethToUsd * usdIls;
      else if (n.currency === 'USD') opp.asking = n.asking * usdIls;
      else opp.asking = n.asking;
      // Estimate
      const typeMult = NFT_TYPES.find(t => t.k === n.type)?.base ?? 1;
      let rarityMult = 1;
      if (n.rarity) {
        if (n.rarity <= 100) rarityMult = 5;
        else if (n.rarity <= 500) rarityMult = 2.5;
        else if (n.rarity <= 1000) rarityMult = 1.5;
      }
      const oneMult = n.oneOfOne ? 6 : 1;
      const celebMult = n.celeb ? 3 : 1;
      const utilityMult = n.utility ? 1.5 : 1;
      const histMult = n.historic ? 2 : 1;
      opp.estimate = (n.floor || 0) * typeMult * rarityMult * oneMult * celebMult * utilityMult * histMult * ethToUsd * usdIls;
      break;
    }
    case 'wine': {
      const w = state.wine;
      const region = WINE_REGIONS.find(r => r.k === w.region);
      opp.name = `${w.name || 'יין'} ${w.vintage || ''}`.trim();
      opp.asking = w.asking;
      const baseRetail = parseFloat(document.querySelector('#wn-retail')?.value) || 0;
      const age = w.vintage ? new Date().getFullYear() - w.vintage : 0;
      let ageMult = 1;
      if (age >= 30) ageMult = 2.5;
      else if (age >= 20) ageMult = 1.8;
      else if (age >= 10) ageMult = 1.3;
      else if (age >= 5) ageMult = 1.05;
      let scoreMult = 1;
      if (w.score >= 98) scoreMult = 3;
      else if (w.score >= 95) scoreMult = 2;
      else if (w.score >= 92) scoreMult = 1.4;
      else if (w.score >= 88) scoreMult = 1.1;
      opp.estimate = baseRetail * (region?.base ?? 1) * ageMult * scoreMult * (w.kosher ? 1.15 : 1);
      break;
    }
    case 'bag': {
      const b = state.bag;
      const brand = BAG_BRANDS.find(x => x.k === b.brand);
      opp.name = `${brand?.name || ''} ${b.model || ''}`.trim();
      opp.asking = b.asking;
      const cond = CONDITIONS.find(x => x.k === b.condition);
      const authMult = b.authenticated ? 1.20 : 0.85;
      let categoryMult = 1;
      if (b.brand === 'hermes' && b.model.match(/birkin|kelly/i)) categoryMult = 1.5;
      else if (b.brand === 'chanel' && b.model.match(/classic|2\.55/i)) categoryMult = 1.2;
      opp.estimate = (b.retail || 0) * (brand?.liquidity ?? 0.5) * (cond?.mult ?? 1) * authMult * categoryMult;
      break;
    }
    case 'gbook': {
      const g = state.gbook;
      const type = BOOK_GEN_TYPES.find(t => t.k === g.type);
      opp.name = `${g.name || 'ספר'} - ${g.author || ''}`.trim();
      opp.asking = g.asking;
      const cond = CONDITIONS.find(c => c.k === g.condition);
      const age = g.year ? new Date().getFullYear() - g.year : 0;
      let ageMult = 1;
      if (age >= 100) ageMult = 3;
      else if (age >= 50) ageMult = 1.8;
      else if (age >= 25) ageMult = 1.2;
      opp.estimate = (g.retail || 0) * (type?.base ?? 1) * (cond?.mult ?? 1) * ageMult;
      break;
    }
  }

  if (!opp.name || !opp.asking) {
    toast('חסרים פרטים - הזן שם ומחיר', 'error');
    return;
  }

  state.opportunities.unshift(opp);
  Storage.save('opportunities', state.opportunities);
  toast('נשמר בפנקס', 'success');
  // Don't navigate - just update badge
  renderHeader();
  if (state.view === 'dashboard') renderDashboard();
}


// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS
// ─────────────────────────────────────────────────────────────────────────────

function recalcROI() {
  const buy = parseFloat($('#r-buy')?.value);
  const sell = parseFloat($('#r-sell')?.value);
  const fees = parseFloat($('#r-fees')?.value) || 0;
  const feesType = $('#r-fees-type')?.value || 'pct';
  const days = parseFloat($('#r-days')?.value) || 0;
  const r = $('#r-result');
  if (!r) return;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const feesAmount = feesType === 'pct' ? sell * (fees / 100) : fees;
  const netSell = sell - feesAmount;
  const profit = netSell - buy;
  const roi = (profit / buy) * 100;
  const annualized = days > 0 ? (Math.pow(1 + (profit / buy), 365 / days) - 1) * 100 : null;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">רווח נטו</span>
      <strong style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">ROI</span>
      <span class="r-value ${profit >= 0 ? 'green' : 'red'}">${profit >= 0 ? '+' : ''}${fmt(roi)}%</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">עמלות / מסים</span>
      <span class="r-value">₪${fmt0(feesAmount)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">קבלה נטו</span>
      <span class="r-value">₪${fmt0(netSell)}</span>
    </div>
    ${annualized !== null ? `
    <div class="r-row sep">
      <span class="r-label">תשואה שנתית מקבילה</span>
      <span class="r-value gold">${fmt(annualized)}%</span>
    </div>` : ''}
    <div class="tip-box">
      <div class="tip-title">∞ ROI - מקדמי השוואה</div>
      <div class="tip-body">
        תשואה שנתית: שוק 10-12% · נדל"ן 4-7% · אג"ח 4-5% · פק"מ 3-4%
      </div>
    </div>
  `;
}

function recalcMortgage() {
  const amount = parseFloat($('#mt-amount')?.value);
  const rate = parseFloat($('#mt-rate')?.value);
  const years = parseInt($('#mt-years')?.value);
  const type = $('#mt-type')?.value || 'spitzer';
  const r = $('#mt-result');
  if (!r) return;
  if (!amount || !rate || !years) { r.innerHTML = ''; return; }

  const months = years * 12;
  const monthlyRate = rate / 100 / 12;

  let monthly, totalPaid, totalInterest, firstMonthly, lastMonthly;
  if (type === 'spitzer') {
    monthly = amount * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
    totalPaid = monthly * months;
    totalInterest = totalPaid - amount;
    firstMonthly = monthly;
    lastMonthly = monthly;
  } else {
    // Equal Principal
    const principalMonthly = amount / months;
    firstMonthly = principalMonthly + (amount * monthlyRate);
    lastMonthly = principalMonthly + (principalMonthly * monthlyRate);
    monthly = (firstMonthly + lastMonthly) / 2;
    // Total interest in equal principal: sum of (remaining * rate)
    totalInterest = 0;
    for (let i = 0; i < months; i++) {
      const remaining = amount - (principalMonthly * i);
      totalInterest += remaining * monthlyRate;
    }
    totalPaid = amount + totalInterest;
  }

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">החזר חודשי ${type === 'equal-principal' ? 'ראשון' : ''}</span>
      <strong>₪${fmt0(firstMonthly)}</strong>
    </div>
    ${type === 'equal-principal' ? `
    <div class="r-row">
      <span class="r-label">החזר חודשי אחרון</span>
      <span class="r-value">₪${fmt0(lastMonthly)}</span>
    </div>` : ''}
    <div class="r-row sep">
      <span class="r-label">סה"כ ישולם</span>
      <span class="r-value">₪${fmt0(totalPaid)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">סה"כ ריבית</span>
      <span class="r-value yellow">₪${fmt0(totalInterest)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">% ריבית מסך ההלוואה</span>
      <span class="r-value">${fmt((totalInterest/amount)*100)}%</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">⌂ משכנתא בישראל</div>
      <div class="tip-body">
        <ul>
          <li><strong>שפיצר:</strong> החזר קבוע, רוב הריבית בהתחלה</li>
          <li><strong>קרן שווה:</strong> החזר יורד עם הזמן, פחות ריבית כללית</li>
          <li>הקטנת תקופה ב-5 שנים → חיסכון של 20-30% בריבית כוללת</li>
          <li>פירעון מוקדם בלי קנס: לרוב 10% בשנה מהקרן</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcRental() {
  const price = parseFloat($('#rn-price')?.value);
  const rent = parseFloat($('#rn-rent')?.value);
  const vaad = parseFloat($('#rn-vaad')?.value) || 0;
  const arnona = parseFloat($('#rn-arnona')?.value) || 0;
  const insurance = parseFloat($('#rn-insurance')?.value) || 0;
  const maint = parseFloat($('#rn-maint')?.value) || 0;
  const vacancy = parseFloat($('#rn-vacancy')?.value) || 0;
  const r = $('#rn-result');
  if (!r) return;
  if (!price || !rent) { r.innerHTML = ''; return; }

  const annualRent = rent * (12 - vacancy);
  const annualExpenses = (vaad * 12) + (arnona * 12) + insurance + maint;
  const netAnnual = annualRent - annualExpenses;
  const grossYield = (rent * 12 / price) * 100;
  const netYield = (netAnnual / price) * 100;
  const capRate = netYield;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">תשואה נטו שנתית</span>
      <strong style="color:${netYield >= 4 ? 'var(--green)' : 'var(--yellow)'}">${fmt(netYield)}%</strong>
    </div>
    <div class="r-row">
      <span class="r-label">תשואה ברוטו</span>
      <span class="r-value">${fmt(grossYield)}%</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">הכנסה שנתית (אחרי ריקנות)</span>
      <span class="r-value green">₪${fmt0(annualRent)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הוצאות שנתיות</span>
      <span class="r-value red">₪${fmt0(annualExpenses)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הכנסה נטו שנתית</span>
      <span class="r-value">₪${fmt0(netAnnual)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">הכנסה נטו חודשית</span>
      <span class="r-value gold">₪${fmt0(netAnnual / 12)}</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">▦ תשואה - מה נחשב טוב?</div>
      <div class="tip-body">
        <ul>
          <li>פחות מ-3% נטו: עסקה חלשה (אלא אם פוטנציאל השבחה)</li>
          <li>3-4% נטו: ממוצע שוק ישראלי</li>
          <li>4-6% נטו: עסקה טובה</li>
          <li>6%+ נטו: יוצאת דופן (בדוק שלא חסר משהו)</li>
        </ul>
      </div>
    </div>
  `;
}

function calcPurchaseTax(value, status) {
  let brackets;
  if (status === 'single') brackets = PURCHASE_TAX_SINGLE;
  else brackets = PURCHASE_TAX_ADDITIONAL;

  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (value <= b.upTo) {
      tax += (value - prev) * b.rate;
      break;
    }
    tax += (b.upTo - prev) * b.rate;
    prev = b.upTo;
  }

  // New immigrant gets reduced rates (simplified)
  if (status === 'new-immigrant') {
    tax = tax * 0.5;
  }
  return tax;
}

function recalcReTax() {
  const mode = state.tools.rePurchase;
  if (mode === 'purchase') {
    const value = parseFloat($('#tx-value')?.value);
    const status = $('#tx-status')?.value || 'additional';
    const r = $('#tx-result');
    if (!r) return;
    if (!value) { r.innerHTML = ''; return; }

    const tax = calcPurchaseTax(value, status);
    const effective = (tax / value) * 100;

    // Show breakdown
    let bracketsHtml = '';
    const brackets = status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL;
    let prev = 0;
    for (const b of brackets) {
      if (value <= prev) break;
      const portion = Math.min(value, b.upTo) - prev;
      const portionTax = portion * b.rate;
      bracketsHtml += `<div class="r-row"><span class="r-label">₪${fmt0(prev)} - ₪${b.upTo === Infinity ? '∞' : fmt0(b.upTo)} (${(b.rate*100).toFixed(2)}%)</span><span class="r-value">₪${fmt0(portionTax)}</span></div>`;
      prev = b.upTo;
      if (value <= b.upTo) break;
    }

    r.innerHTML = `
      <div class="r-row big">
        <span class="r-label">מס רכישה</span>
        <strong>₪${fmt0(tax)}</strong>
      </div>
      <div class="r-row">
        <span class="r-label">שיעור אפקטיבי</span>
        <span class="r-value">${fmt(effective)}%</span>
      </div>
      <div class="r-row sep">
        <span class="r-label">סה"כ עלות הנכס</span>
        <span class="r-value gold">₪${fmt0(value + tax)}</span>
      </div>
      <div class="r-row sep" style="font-weight:700">פירוק לפי מדרגות:</div>
      ${bracketsHtml}
      <div class="tip-box">
        <div class="tip-title">₪ מס רכישה 2026</div>
        <div class="tip-body">
          ${status === 'single' ? 'דירה יחידה: פטור עד 1.97M, אחר כך 3.5%-10% במדרגות' : status === 'additional' ? 'דירה נוספת: 8% עד 6M, 10% מעבר לכך' : 'עולה חדש: הקלה ~50% במדרגות'}
        </div>
      </div>
    `;
  } else {
    // Appreciation tax (מס שבח)
    const buy = parseFloat($('#ap-buy')?.value);
    const sell = parseFloat($('#ap-sell')?.value);
    const expenses = parseFloat($('#ap-expenses')?.value) || 0;
    const years = parseFloat($('#ap-years')?.value) || 1;
    const single = $('#ap-single')?.checked;
    const r = $('#ap-result');
    if (!r) return;
    if (!buy || !sell) { r.innerHTML = ''; return; }

    const grossGain = sell - buy - expenses;
    let tax = 0;
    let rate = 0;
    if (single) {
      rate = 0;
    } else {
      // Simplified: 25% on real gain (after inflation adjustment ~2-3%/yr)
      const realGain = grossGain * Math.pow(0.97, years); // rough inflation adjustment
      rate = 25;
      tax = Math.max(0, realGain * 0.25);
    }
    const netProfit = grossGain - tax;

    r.innerHTML = `
      <div class="r-row big">
        <span class="r-label">מס שבח</span>
        <strong>₪${fmt0(tax)}</strong>
      </div>
      <div class="r-row">
        <span class="r-label">שבח ברוטו</span>
        <span class="r-value">₪${fmt0(grossGain)}</span>
      </div>
      <div class="r-row">
        <span class="r-label">שיעור מס</span>
        <span class="r-value">${rate}%</span>
      </div>
      <div class="r-row sep">
        <span class="r-label">רווח נטו</span>
        <span class="r-value gold">₪${fmt0(netProfit)}</span>
      </div>
      <div class="tip-box">
        <div class="tip-title">₪ מס שבח</div>
        <div class="tip-body">
          ${single ? 'דירה יחידה - פטור מלא (אם עומדים בתנאים)' : '25% מהשבח הריאלי (אחרי הצמדה למדד). ייתכן זכאות להקלות.'}
          <br><strong>חשוב:</strong> קח ייעוץ ספציפי - יש המון פטורים והקלות.
        </div>
      </div>
    `;
  }
}

function recalcVehicle() {
  const buy = parseFloat($('#v-buy')?.value);
  const sell = parseFloat($('#v-sell')?.value);
  const years = parseFloat($('#v-years')?.value) || 1;
  const insurance = parseFloat($('#v-insurance')?.value) || 0;
  const test = parseFloat($('#v-test')?.value) || 0;
  const fuel = parseFloat($('#v-fuel')?.value) || 0;
  const service = parseFloat($('#v-service')?.value) || 0;
  const r = $('#v-result');
  if (!r) return;
  if (!buy) { r.innerHTML = ''; return; }

  const depreciation = buy - sell;
  const annualDep = depreciation / years;
  const annualOps = (insurance + test) + (fuel * 12) + service;
  const totalAnnual = annualDep + annualOps;
  const monthlyTotal = totalAnnual / 12;
  const perKm = totalAnnual / 15000; // assume 15K km/year

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">עלות חודשית כוללת</span>
      <strong>₪${fmt0(monthlyTotal)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">עלות שנתית</span>
      <span class="r-value">₪${fmt0(totalAnnual)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">פיחות שנתי</span>
      <span class="r-value red">₪${fmt0(annualDep)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">תפעול שנתי</span>
      <span class="r-value">₪${fmt0(annualOps)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">דלק שנתי</span>
      <span class="r-value">₪${fmt0(fuel * 12)}</span>
    </div>
    <div class="r-row sep">
      <span class="r-label">עלות לקילומטר (15K/שנה)</span>
      <span class="r-value gold">₪${fmt(perKm)}</span>
    </div>
    <div class="tip-box">
      <div class="tip-title">⚙ עלות רכב אמיתית</div>
      <div class="tip-body">
        רוב האנשים מתעלמים מהפיחות - אבל זו ההוצאה הגדולה ביותר ברכב.
        <br>רכב חדש מאבד 20-30% בשנה הראשונה!
      </div>
    </div>
  `;
}

function recalcCurrency() {
  const amount = parseFloat($('#cu-amount')?.value);
  const from = $('#cu-from')?.value || 'USD';
  const to = $('#cu-to')?.value || 'ILS';
  const r = $('#cu-result');
  if (!r) return;
  if (!amount) { r.innerHTML = ''; return; }

  // Convert via USD as base
  const usdIls = state.prices.usdIls;
  const fx = state.prices.fxRates || {};
  // fx.X = how many X per 1 USD
  const fromToUsd = from === 'USD' ? 1 : from === 'ILS' ? 1 / usdIls : (1 / fx[from]);
  const usdToTarget = to === 'USD' ? 1 : to === 'ILS' ? usdIls : fx[to];

  const usdAmount = amount * fromToUsd;
  const result = usdAmount * usdToTarget;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${from}</span>
      <strong>${fmt(result, to === 'JPY' ? 0 : 2)} ${to}</strong>
    </div>
    <div class="r-row sep">
      <span class="r-label">שער</span>
      <span class="r-value">1 ${from} = ${fmt(result/amount, 4)} ${to}</span>
    </div>
    <div class="r-row">
      <span class="r-label">בדולרים</span>
      <span class="r-value">$${fmt(usdAmount)}</span>
    </div>
    <div class="r-row">
      <span class="r-label">בשקלים</span>
      <span class="r-value">₪${fmt0(usdAmount * usdIls)}</span>
    </div>
  `;
}

function renderCryptoFull() {
  const usdIls = state.prices.usdIls;
  $('#crypto-full').innerHTML = CRYPTO_COINS.map(c => {
    const price = state.prices[c.id];
    const change = state.prices[c.id + 'Change'];
    return `
      <div class="card">
        <div class="c-sym">${c.symbol}</div>
        <div class="c-name">${c.name}</div>
        <div class="c-price">$${fmt0(price)}</div>
        <div class="c-sub">
          ₪${fmt0(price * usdIls)}
          ${typeof change === 'number' ? `<span class="c-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${fmt1(change)}%</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  recalcCryptoConvert();
}

function recalcCryptoConvert() {
  const amount = parseFloat($('#cr-amount')?.value);
  const coinId = $('#cr-coin')?.value;
  const r = $('#cr-convert');
  if (!r) return;
  if (!amount || !coinId) { r.innerHTML = ''; return; }

  const price = state.prices[coinId];
  const symbol = CRYPTO_COINS.find(c => c.id === coinId)?.symbol;
  const usdIls = state.prices.usdIls;
  const usd = amount * price;
  const ils = usd * usdIls;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${symbol}</span>
      <strong>$${fmt0(usd)}</strong>
    </div>
    <div class="r-row">
      <span class="r-label">בשקלים</span>
      <span class="r-value gold">₪${fmt0(ils)}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────────────────────

function exportJSON() {
  const data = {
    version: '2.0',
    exported: new Date().toISOString(),
    opportunities: state.opportunities,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('יוצא JSON', 'success');
}

function exportCSV() {
  if (state.opportunities.length === 0) { toast('אין מה לייצא', 'error'); return; }
  const headers = ['שם', 'קטגוריה', 'סטטוס', 'מבוקש', 'משוער', 'נקנה', 'נמכר', 'רווח', 'מוכר', 'תאריך', 'הערות'];
  const rows = state.opportunities.map(o => [
    o.name || '',
    OPP_CATEGORIES.find(c => c.k === o.category)?.name || '',
    {watching:'במעקב',bought:'נקנה',sold:'נמכר'}[o.status] || '',
    o.asking || '',
    o.estimate || '',
    o.purchasePrice || '',
    o.salePrice || '',
    o.salePrice ? (o.salePrice - (o.purchasePrice || o.asking || 0)) : '',
    o.seller || '',
    shortDate(o.created),
    (o.notes || '').replace(/[\n,"]/g, ' '),
  ]);
  const csv = '\ufeff' + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('יוצא CSV', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.opportunities || !Array.isArray(data.opportunities)) throw new Error('פורמט לא תקין');
      const merge = confirm(`לייבא ${data.opportunities.length} פריטים?\nאישור = להוסיף לקיים\nביטול = להחליף את הקיים`);
      if (merge) {
        state.opportunities = [...data.opportunities, ...state.opportunities];
      } else {
        if (!confirm('להחליף את כל הנתונים הקיימים?')) return;
        state.opportunities = data.opportunities;
      }
      Storage.save('opportunities', state.opportunities);
      renderLedger();
      toast(`יובא ${data.opportunities.length} פריטים`, 'success');
    } catch (err) {
      toast('שגיאה: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}


// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS - ROI, Mortgage, Rental, Tax, Vehicle, Currency, Crypto, Settings
// ─────────────────────────────────────────────────────────────────────────────

function recalcROI() {
  const r = $('#r-result');
  if (!r) return;
  const buy = parseFloat($('#r-buy').value) || 0;
  const sell = parseFloat($('#r-sell').value) || 0;
  const fees = parseFloat($('#r-fees').value) || 0;
  const feesType = $('#r-fees-type').value;
  const days = parseInt($('#r-days').value) || 0;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const feesAbs = feesType === 'pct' ? sell * (fees / 100) : fees;
  const netSell = sell - feesAbs;
  const profit = netSell - buy;
  const roi = (profit / buy) * 100;
  const annualROI = days > 0 ? roi * (365 / days) : 0;

  r.innerHTML = `
    <div class="r-row"><span class="r-label">השקעה</span><span class="r-value">₪${fmt0(buy)}</span></div>
    <div class="r-row"><span class="r-label">תקבול ברוטו</span><span class="r-value">₪${fmt0(sell)}</span></div>
    <div class="r-row"><span class="r-label">(-) עמלות</span><span class="r-value">₪${fmt0(feesAbs)}</span></div>
    <div class="r-row sep"><span class="r-label">תקבול נטו</span><span class="r-value">₪${fmt0(netSell)}</span></div>
    <div class="r-row big">
      <span class="r-label">רווח נקי</span>
      <strong style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row"><span class="r-label">תשואה (ROI)</span><span class="r-value" style="color:${roi >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(roi, 1)}%</span></div>
    ${days > 0 ? `<div class="r-row"><span class="r-label">תשואה שנתית מתוקננת</span><span class="r-value">${fmt(annualROI, 1)}%</span></div>` : ''}
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">∞ סוגי עמלות לזכור</div>
      <div class="tip-body">
        <ul>
          <li>Sotheby's/Christies: 25% קונה +15% מוכר</li>
          <li>Kedem: 22% קונה, 12-18% מוכר</li>
          <li>eBay: 13% מהמוכר</li>
          <li>Chrono24: 6.5%</li>
          <li>מס רווח הון בישראל: 25%</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcMortgage() {
  const r = $('#mt-result');
  if (!r) return;
  const P = parseFloat($('#mt-amount').value) || 0;
  const annualRate = parseFloat($('#mt-rate').value) || 0;
  const years = parseInt($('#mt-years').value) || 0;
  const type = $('#mt-type').value;

  if (!P || !years || annualRate < 0) { r.innerHTML = ''; return; }

  const months = years * 12;
  const monthlyRate = (annualRate / 100) / 12;
  let monthly, totalInterest, totalPaid;

  if (type === 'spitzer') {
    if (monthlyRate === 0) {
      monthly = P / months;
    } else {
      monthly = P * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1);
    }
    totalPaid = monthly * months;
    totalInterest = totalPaid - P;
  } else {
    // Equal principal
    const principalPerMonth = P / months;
    let totalInt = 0;
    let firstPayment = 0;
    let remaining = P;
    for (let i = 0; i < months; i++) {
      const intPart = remaining * monthlyRate;
      totalInt += intPart;
      if (i === 0) firstPayment = principalPerMonth + intPart;
      remaining -= principalPerMonth;
    }
    totalInterest = totalInt;
    totalPaid = P + totalInt;
    monthly = firstPayment; // first month
  }

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">החזר חודשי${type === 'equal-principal' ? ' (ראשון)' : ''}</span>
      <strong>₪${fmt0(monthly)}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">סה"כ ריבית לאורך התקופה</span><span class="r-value">₪${fmt0(totalInterest)}</span></div>
    <div class="r-row"><span class="r-label">סה"כ תשלום</span><span class="r-value gold">₪${fmt0(totalPaid)}</span></div>
    <div class="r-row"><span class="r-label">יחס ריבית/קרן</span><span class="r-value">${fmt(totalInterest / P * 100, 1)}%</span></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⌂ טיפים</div>
      <div class="tip-body">
        <ul>
          <li>שפיצר: החזר חודשי קבוע, מתחילים בעיקר ריבית</li>
          <li>קרן שווה: החזר חודשי יורד, חיסכון בריבית כוללת</li>
          <li>ריבית פריים בישראל ~5-6.5% (2026)</li>
          <li>פירעון מוקדם חוסך ריבית - אבל יש קנס מסלול</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcRental() {
  const r = $('#rn-result');
  if (!r) return;
  const price = parseFloat($('#rn-price').value) || 0;
  const rent = parseFloat($('#rn-rent').value) || 0;
  const vaad = parseFloat($('#rn-vaad').value) || 0;
  const arnona = parseFloat($('#rn-arnona').value) || 0;
  const insurance = parseFloat($('#rn-insurance').value) || 0;
  const maint = parseFloat($('#rn-maint').value) || 0;
  const vacancy = parseFloat($('#rn-vacancy').value) || 0;

  if (!price || !rent) { r.innerHTML = ''; return; }

  const grossYearly = rent * 12;
  const expensesYearly = (vaad * 12) + (arnona * 12) + insurance + maint;
  const vacancyLoss = rent * vacancy;
  const netYearly = grossYearly - expensesYearly - vacancyLoss;

  const grossYield = (grossYearly / price) * 100;
  const netYield = (netYearly / price) * 100;
  const monthlyNet = netYearly / 12;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">תשואה שנתית נטו</span>
      <strong style="color:var(--gold)">${fmt(netYield, 2)}%</strong>
    </div>
    <div class="r-row"><span class="r-label">תשואה גולמית (Cap Rate)</span><span class="r-value">${fmt(grossYield, 2)}%</span></div>
    <div class="r-row sep"><span class="r-label">הכנסה שנתית גולמית</span><span class="r-value">₪${fmt0(grossYearly)}</span></div>
    <div class="r-row"><span class="r-label">(-) הוצאות שנתיות</span><span class="r-value">₪${fmt0(expensesYearly)}</span></div>
    <div class="r-row"><span class="r-label">(-) ריקנות צפויה</span><span class="r-value">₪${fmt0(vacancyLoss)}</span></div>
    <div class="r-row big sep"><span class="r-label">הכנסה שנתית נטו</span><strong>₪${fmt0(netYearly)}</strong></div>
    <div class="r-row"><span class="r-label">לחודש (נטו)</span><span class="r-value">₪${fmt0(monthlyNet)}</span></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">▦ Cap Rate בישראל</div>
      <div class="tip-body">
        <ul>
          <li>מרכז ת"א: 2-3% (יקר, פוטנציאל עליית ערך)</li>
          <li>פריפריה: 5-7% (זול, פוטנציאל עליית ערך נמוך)</li>
          <li>ירושלים: 3-4.5%</li>
          <li>5%+ נחשב סביר להשקעה</li>
          <li>חישוב לא כולל עליית ערך עתידית או מינוף</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcPurchaseTax() {
  const r = $('#tx-result');
  if (!r) return;
  const value = parseFloat($('#tx-value').value) || 0;
  const status = $('#tx-status').value;

  if (!value) { r.innerHTML = ''; return; }

  const brackets = status === 'single' ? PURCHASE_TAX_SINGLE : PURCHASE_TAX_ADDITIONAL;
  let totalTax = 0;
  let bracketDetails = [];
  let remaining = value;

  for (const b of brackets) {
    if (remaining <= 0) break;
    const inThisBracket = Math.min(remaining, b.limit ? b.limit - (b.from || 0) : Infinity);
    if (inThisBracket > 0) {
      const taxFromBracket = inThisBracket * b.rate;
      totalTax += taxFromBracket;
      if (b.rate > 0) {
        bracketDetails.push(`${(b.rate * 100).toFixed(1)}% על ₪${fmt0(inThisBracket)} = ₪${fmt0(taxFromBracket)}`);
      }
      remaining -= inThisBracket;
    }
  }

  const effectiveRate = (totalTax / value) * 100;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">סה"כ מס רכישה</span>
      <strong>₪${fmt0(totalTax)}</strong>
    </div>
    <div class="r-row"><span class="r-label">שיעור אפקטיבי</span><span class="r-value">${fmt(effectiveRate, 2)}%</span></div>
    <div class="r-row sep"><span class="r-label">שווי הנכס</span><span class="r-value">₪${fmt0(value)}</span></div>
    <div class="r-row"><span class="r-label">סה"כ עלות (כולל מס)</span><span class="r-value gold">₪${fmt0(value + totalTax)}</span></div>
    ${bracketDetails.length ? `
      <div class="tip-box" style="margin-top:14px">
        <div class="tip-title">פירוט מדרגות</div>
        <div class="tip-body">
          ${bracketDetails.map(d => `<div>• ${d}</div>`).join('')}
        </div>
      </div>` : ''}
  `;
}

function recalcAppreciation() {
  const r = $('#ap-result');
  if (!r) return;
  const buy = parseFloat($('#ap-buy').value) || 0;
  const sell = parseFloat($('#ap-sell').value) || 0;
  const expenses = parseFloat($('#ap-expenses').value) || 0;
  const years = parseInt($('#ap-years').value) || 0;
  const single = $('#ap-single').checked;

  if (!buy || !sell) { r.innerHTML = ''; return; }

  const profit = sell - buy - expenses;

  let tax = 0;
  let exemptionNote = '';

  if (single) {
    tax = 0;
    exemptionNote = 'פטור מלא (דירה יחידה - פעם ב-18 חודש)';
  } else {
    // 25% on real gain (after CPI - simplified here)
    tax = profit > 0 ? profit * 0.25 : 0;
    exemptionNote = '25% מס שבח על רווח ריאלי';
  }

  const netProfit = profit - tax;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">רווח לפני מס</span>
      <strong>₪${fmt0(profit)}</strong>
    </div>
    <div class="r-row"><span class="r-label">מס שבח</span><span class="r-value">₪${fmt0(tax)}</span></div>
    <div class="r-row big sep"><span class="r-label">רווח נקי</span><strong style="color:var(--gold)">₪${fmt0(netProfit)}</strong></div>
    <div class="r-row"><span class="r-label">תשואה כוללת</span><span class="r-value">${fmt((netProfit / buy) * 100, 1)}%</span></div>
    ${years > 0 ? `<div class="r-row"><span class="r-label">תשואה שנתית מצטברת</span><span class="r-value">${fmt(Math.pow((sell / buy), 1 / years) * 100 - 100, 2)}%</span></div>` : ''}
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">${exemptionNote}</div>
      <div class="tip-body">
        <ul>
          <li>מס שבח חל על רווח ריאלי - הצמדה למדד מקטינה את המס</li>
          <li>פטור דירה יחידה: לפי תקופת החזקה ושימוש</li>
          <li>הוצאות מוכרות: שיפוצים, שמאי, עו"ד, תיווך, מס רכישה</li>
          <li>חובה: דווח תוך 30 יום ממכירה</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcVehicle() {
  const r = $('#v-result');
  if (!r) return;
  const buy = parseFloat($('#v-buy').value) || 0;
  const sell = parseFloat($('#v-sell').value) || 0;
  const years = parseInt($('#v-years').value) || 1;
  const insurance = parseFloat($('#v-insurance').value) || 0;
  const test = parseFloat($('#v-test').value) || 0;
  const fuel = parseFloat($('#v-fuel').value) || 0;
  const service = parseFloat($('#v-service').value) || 0;

  if (!buy) { r.innerHTML = ''; return; }

  const depreciation = buy - sell;
  const annualDep = depreciation / years;
  const annualInsurance = insurance;
  const annualTest = test;
  const annualFuel = fuel * 12;
  const annualService = service;
  const annualTotal = annualDep + annualInsurance + annualTest + annualFuel + annualService;
  const monthlyTotal = annualTotal / 12;
  const total = annualTotal * years;

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">עלות חודשית אמיתית</span>
      <strong>₪${fmt0(monthlyTotal)}</strong>
    </div>
    <div class="r-row"><span class="r-label">עלות שנתית</span><span class="r-value">₪${fmt0(annualTotal)}</span></div>
    <div class="r-row sep"><span class="r-label">פיחות שנתי</span><span class="r-value">₪${fmt0(annualDep)}</span></div>
    <div class="r-row"><span class="r-label">דלק שנתי</span><span class="r-value">₪${fmt0(annualFuel)}</span></div>
    <div class="r-row"><span class="r-label">ביטוח שנתי</span><span class="r-value">₪${fmt0(annualInsurance)}</span></div>
    <div class="r-row"><span class="r-label">טיפולים + טסט שנתי</span><span class="r-value">₪${fmt0(annualService + annualTest)}</span></div>
    <div class="r-row big sep"><span class="r-label">סה"כ ל-${years} שנים</span><strong style="color:var(--gold)">₪${fmt0(total)}</strong></div>
    <div class="tip-box" style="margin-top:14px">
      <div class="tip-title">⚙ תקציב רכב בישראל</div>
      <div class="tip-body">
        <ul>
          <li>פיחות בשנה ראשונה: 20-30% (גבוה ביותר!)</li>
          <li>שנים 2-5: 8-12% לשנה</li>
          <li>אחרי 7 שנים: 5% לשנה</li>
          <li>יבוא אישי: פיחות נמוך יותר אבל אחזקה יקרה</li>
        </ul>
      </div>
    </div>
  `;
}

function recalcCurrency() {
  const r = $('#cu-result');
  if (!r) return;
  const amount = parseFloat($('#cu-amount').value) || 0;
  const from = $('#cu-from').value;
  const to = $('#cu-to').value;

  if (!amount || from === to) {
    r.innerHTML = `<div class="r-row big"><span class="r-label">תוצאה</span><strong>${amount} ${to}</strong></div>`;
    return;
  }

  // Convert through USD as base
  // ILS rate is direct from API
  // Approximate cross rates:
  const rates = {
    USD: 1,
    ILS: state.prices.usdIls || 3.6,
    EUR: 0.92,
    GBP: 0.79,
    CHF: 0.88,
    JPY: 150,
  };

  const inUSD = amount / rates[from];
  const result = inUSD * rates[to];

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${from}</span>
      <strong>${fmt(result, 2)} ${to}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">שער</span><span class="r-value">1 ${from} = ${fmt(rates[to] / rates[from], 4)} ${to}</span></div>
    <div class="text-faint" style="margin-top:10px">שערים מקורבים. רק USD/ILS מעודכן בזמן אמת מ-API.</div>
  `;
}

function recalcCryptoConvert() {
  const r = $('#cr-convert');
  if (!r) return;
  const amount = parseFloat($('#cr-amount').value) || 0;
  const coin = $('#cr-coin').value;
  const usdPrice = state.prices[coin];
  const change = state.prices[coin + 'Change'];

  if (!amount || !usdPrice) {
    r.innerHTML = `<div class="text-faint">המתן לטעינת מחירי קריפטו...</div>`;
    return;
  }

  const usd = amount * usdPrice;
  const ils = usd * (state.prices.usdIls || 3.6);
  const coinSym = (CRYPTO_COINS.find(c => c.id === coin)?.symbol) || coin.toUpperCase().substring(0, 3);

  r.innerHTML = `
    <div class="r-row big">
      <span class="r-label">${amount} ${coinSym}</span>
      <strong>$${fmt0(usd)}</strong>
    </div>
    <div class="r-row"><span class="r-label">בשקלים</span><span class="r-value gold">₪${fmt0(ils)}</span></div>
    <div class="r-row sep"><span class="r-label">מחיר נוכחי</span><span class="r-value">$${fmt0(usdPrice)}</span></div>
    ${change ? `<div class="r-row"><span class="r-label">שינוי 24 שעות</span><span class="r-value" style="color:${change >= 0 ? 'var(--green)' : 'var(--red)'}">${change >= 0 ? '+' : ''}${fmt(change, 2)}%</span></div>` : ''}
  `;
}

function renderCryptoFull() {
  const c = $('#crypto-full');
  if (!c) return;
  // Map from CRYPTO_COINS to state.prices fields
  const items = CRYPTO_COINS.map(coin => {
    const usd = state.prices[coin.id];
    const change = state.prices[coin.id + 'Change'] || 0;
    if (!usd) return null;
    return {
      sym: coin.symbol,
      name: coin.name,
      usd,
      ils: usd * (state.prices.usdIls || 3.6),
      change,
    };
  }).filter(Boolean);
  if (items.length === 0) {
    c.innerHTML = '<div class="text-faint" style="grid-column:1/-1;text-align:center;padding:20px">טוען מחירי קריפטו...</div>';
    return;
  }
  c.innerHTML = items.map(d => `
    <div class="card">
      <div class="c-sym">${d.sym}</div>
      <div class="c-name">${d.name}</div>
      <div class="c-price">$${fmt(d.usd, d.usd >= 100 ? 0 : 2)}</div>
      <div class="c-sub">₪${fmt0(d.ils)}</div>
      <div class="c-change ${d.change >= 0 ? 'up' : 'down'}">${d.change >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d.change), 2)}%</div>
    </div>
  `).join('');
}

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
    'settings': renderSettingsStats,
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
  $('#btn-refresh')?.addEventListener('click', () => fetchAllPrices(false));

  // Manual prices
  $('#btn-save-manual')?.addEventListener('click', () => {
    const fields = ['gold', 'silver', 'platinum', 'usdils', 'copper', 'aluminum'];
    let updated = false;
    fields.forEach(f => {
      const id = f === 'usdils' ? 'manual-usdils' : `manual-${f}`;
      const v = parseFloat($('#' + id)?.value);
      if (v && v > 0) {
        if (f === 'usdils') state.prices.usdIls = v;
        else state.prices[f] = v;
        updated = true;
      }
    });
    if (updated) {
      state.prices.lastUpdate = new Date().toISOString();
      state.prices.source = 'manual';
      Storage.save('prices', state.prices);
      renderHeader();
      renderDashboard();
      // Clear all manual inputs and close the details panel
      fields.forEach(f => {
        const id = f === 'usdils' ? 'manual-usdils' : `manual-${f}`;
        const el = $('#' + id);
        if (el) el.value = '';
      });
      const det = document.querySelector('.manual-prices');
      if (det) det.open = false;
      toast('מחירים נשמרו ✓', 'success');
    } else {
      toast('הזן ערך אחד לפחות', 'error');
    }
  });

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
  ['cn-name', 'cn-year', 'cn-metal', 'cn-weight', 'cn-purity', 'cn-premium', 'cn-asking'].forEach(id => {
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
  $('#no-photo')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('#no-photo-preview').innerHTML = `
        <img src="${ev.target.result}" alt="תצוגה" />
        <button class="remove-photo" aria-label="הסר">×</button>
      `;
      $('#no-photo-preview').hidden = false;
      $('#no-photo-preview').dataset.data = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.addEventListener('click', e => {
    if (e.target.classList?.contains('remove-photo')) {
      $('#no-photo-preview').hidden = true;
      $('#no-photo-preview').innerHTML = '';
      delete $('#no-photo-preview').dataset.data;
      $('#no-photo').value = '';
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
  $('#btn-clear-all')?.addEventListener('click', () => {
    if (confirm('למחוק את כל הנתונים? פעולה זו אינה הפיכה.')) {
      localStorage.clear();
      location.reload();
    }
  });

  // Device sync via QR
  $('#btn-show-qr')?.addEventListener('click', generateBackupQR);
  $('#btn-scan-qr')?.addEventListener('click', scanBackupQR);

  // Cloud sync
  $('#btn-cloud-upload')?.addEventListener('click', uploadToCloud);
  $('#btn-cloud-download')?.addEventListener('click', downloadFromCloud);

  // Real estate
  ['re-area', 're-size', 're-rooms', 're-floor', 're-year', 're-asking',
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

function exportJSON() {
  const data = {
    version: '2.0',
    exported: new Date().toISOString(),
    opportunities: state.opportunities,
    prices: state.prices,
    settings: state.settings,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('יוצא בהצלחה', 'success');
}

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
      o.asking || '',
      o.estimate || '',
      profit !== null ? profit : '',
      margin !== null ? margin.toFixed(1) : '',
      o.seller || '',
      o.created ? shortDate(o.created) : '',
      (o.notes || '').replace(/\n/g, ' '),
    ]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shamai-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV יוצא', 'success');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.opportunities && Array.isArray(data.opportunities)) {
        state.opportunities = data.opportunities;
        Storage.save('opportunities', state.opportunities);
        renderLedger();
        renderHeader();
        toast(`יובאו ${data.opportunities.length} פריטים`, 'success');
      } else {
        toast('פורמט לא תקין', 'error');
      }
    } catch {
      toast('שגיאה בייבוא', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  // Load saved state
  const savedOps = Storage.load('opportunities');
  if (savedOps) state.opportunities = savedOps;
  const savedPrices = Storage.load('prices');
  if (savedPrices) state.prices = { ...DEFAULT_PRICES, ...savedPrices };
  const savedSettings = Storage.load('settings');
  if (savedSettings) state.settings = { ...state.settings, ...savedSettings };

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
  fetchAllPrices(true);

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

// Approximate ₪/m² by area (Q1 2026 estimates)
const RE_AREAS = {
  'tel-aviv-luxury':   55000,
  'tel-aviv':          40000,
  'jerusalem-haredi':  28000,
  'jerusalem':         32000,
  'bnei-brak':         30000,
  'ramat-gan':         38000,
  'herzliya':          42000,
  'haifa':             18000,
  'periphery':         12000,
};

// Reuse CONDITIONS for state
state.realestate = state.realestate || {
  type: 'apartment', area: 'jerusalem-haredi', condition: 'good', size: null, rooms: 3,
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

function recalcRealEstate() {
  const r = $('#re-result');
  if (!r) return;
  const re = state.realestate;
  re.area = $('#re-area')?.value || 'jerusalem-haredi';
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

  if (!re.size || re.size <= 0) {
    r.innerHTML = `<div class="tip-box"><div class="tip-title">⌂ נדרש שטח</div><div class="tip-body">הזן את שטח הנכס במ"ר כדי לחשב.</div></div>`;
    $('#re-save').hidden = true;
    return;
  }

  const pricePerSqm = RE_AREAS[re.area];
  const typeMult = RE_TYPES.find(t => t.k === re.type)?.base ?? 1;
  const condMult = CONDITIONS.find(c => c.k === re.condition)?.mult ?? 1;
  // Apply features
  let featuresMult = 1;
  if (re.elevator) featuresMult *= 1.05;
  if (re.parking) featuresMult *= 1.06;
  if (re.balcony) featuresMult *= 1.04;
  if (re.storage) featuresMult *= 1.02;
  if (re.renovated) featuresMult *= 1.08;
  if (re.tama) featuresMult *= 1.10;
  if (re.view) featuresMult *= 1.03;
  if (re.noise) featuresMult *= 0.95;
  // Floor adjustment: ground floor with garden=neutral, low floors slightly less, high floors slightly more
  const floorMult = re.floor === 0 ? 0.95 : re.floor >= 4 ? 1.03 : 1.00;

  const baseValue = re.size * pricePerSqm;
  const estValue = baseValue * typeMult * condMult * featuresMult * floorMult;

  let html = `
    <div class="r-row big">
      <span class="r-label">שווי שוק משוער</span>
      <strong>₪${fmt0(estValue)}</strong>
    </div>
    <div class="r-row sep"><span class="r-label">בסיס לפי אזור (${fmt0(pricePerSqm)} ₪/מ"ר)</span><span class="r-value">₪${fmt0(baseValue)}</span></div>
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

  r.innerHTML = html;
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

// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS - Portfolio Analytics
// ─────────────────────────────────────────────────────────────────────────────

function renderAnalytics() {
  const ops = state.opportunities;
  if (ops.length === 0) {
    $('#analytics-summary').innerHTML = `<div class="empty"><div class="empty-icon">▤</div><div class="empty-msg">אין נתונים להצגה</div><div class="empty-sub">הוסף פריטים לפנקס כדי לראות אנליטיקה</div></div>`;
    $('#analytics-bycat').innerHTML = '';
    $('#analytics-bystatus').innerHTML = '';
    $('#analytics-history').innerHTML = '';
    return;
  }

  const watching = ops.filter(o => o.status === 'watching');
  const bought = ops.filter(o => o.status === 'bought');
  const sold = ops.filter(o => o.status === 'sold');
  const totalRevenue = sold.reduce((s, o) => s + (o.salePrice || 0), 0);
  const totalCost = sold.reduce((s, o) => s + (o.purchasePrice || o.asking || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = sold.length ? sold.reduce((s, o) => {
    const cost = o.purchasePrice || o.asking || 1;
    const profit = (o.salePrice || 0) - cost;
    return s + (profit / cost * 100);
  }, 0) / sold.length : 0;
  const potentialProfit = watching.reduce((s, o) => s + Math.max(0, (o.estimate || 0) - (o.asking || 0)), 0);
  const inventoryValue = bought.reduce((s, o) => s + (o.estimate || o.asking || 0), 0);

  $('#analytics-summary').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr); gap:10px">
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--gold)">₪${fmt0(totalRevenue)}</div>
        <div class="sc-label">הכנסות מכירות</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${totalProfit >= 0 ? '+' : ''}₪${fmt0(totalProfit)}</div>
        <div class="sc-label">רווח כולל</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:${avgMargin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(avgMargin, 1)}%</div>
        <div class="sc-label">מרווח ממוצע</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value">${sold.length}</div>
        <div class="sc-label">עסקאות סגורות</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--purple)">₪${fmt0(potentialProfit)}</div>
        <div class="sc-label">רווח פוטנציאלי (מעקב)</div>
      </div>
      <div class="stat-cell">
        <div class="sc-value" style="color:var(--yellow)">₪${fmt0(inventoryValue)}</div>
        <div class="sc-label">שווי מלאי</div>
      </div>
    </div>
  `;

  // By category - bar chart-style
  const byCat = {};
  ops.forEach(o => {
    const cat = o.category || 'general';
    if (!byCat[cat]) byCat[cat] = { count: 0, profit: 0, value: 0 };
    byCat[cat].count++;
    byCat[cat].value += (o.estimate || o.asking || 0);
    if (o.status === 'sold') byCat[cat].profit += (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
  });

  const catEntries = Object.entries(byCat).sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(...catEntries.map(e => e[1].count));

  $('#analytics-bycat').innerHTML = catEntries.map(([k, d]) => {
    const cat = OPP_CATEGORIES.find(c => c.k === k);
    const name = cat?.name || k;
    const pct = (d.count / maxCount) * 100;
    return `
      <div class="bar-row">
        <div class="bar-name">${name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%"></div>
          <div class="bar-text">${d.count} פריטים · ₪${fmt0(d.value)}${d.profit !== 0 ? ` · רווח: ${d.profit >= 0 ? '+' : ''}₪${fmt0(d.profit)}` : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // By status
  const total = ops.length;
  $('#analytics-bystatus').innerHTML = `
    <div class="bar-row">
      <div class="bar-name">במעקב</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(watching.length / total) * 100}%; background:var(--purple)"></div>
        <div class="bar-text">${watching.length} (${fmt(watching.length / total * 100, 0)}%)</div>
      </div>
    </div>
    <div class="bar-row">
      <div class="bar-name">במלאי</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(bought.length / total) * 100}%; background:var(--yellow)"></div>
        <div class="bar-text">${bought.length} (${fmt(bought.length / total * 100, 0)}%)</div>
      </div>
    </div>
    <div class="bar-row">
      <div class="bar-name">נמכר</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(sold.length / total) * 100}%; background:var(--green)"></div>
        <div class="bar-text">${sold.length} (${fmt(sold.length / total * 100, 0)}%)</div>
      </div>
    </div>
  `;

  // History - last 10 sales
  const history = sold
    .filter(o => o.soldDate || o.created)
    .sort((a, b) => new Date(b.soldDate || b.created) - new Date(a.soldDate || a.created))
    .slice(0, 10);

  if (history.length) {
    $('#analytics-history').innerHTML = history.map(o => {
      const profit = (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
      const margin = profit / (o.purchasePrice || o.asking || 1) * 100;
      return `
        <div class="history-row">
          <div class="hist-name">${escapeHtml(o.name || '')}</div>
          <div class="hist-meta">${shortDate(o.soldDate || o.created)} · ${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</div>
          <div class="hist-profit ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt(margin, 0)}%)</div>
        </div>
      `;
    }).join('');
  } else {
    $('#analytics-history').innerHTML = '<div class="empty"><div class="empty-msg">אין עדיין עסקאות סגורות</div></div>';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPARE - Compare 2-3 items side by side
// ─────────────────────────────────────────────────────────────────────────────

state.compareSelection = state.compareSelection || [];

function renderCompare() {
  const ops = state.opportunities;
  if (ops.length === 0) {
    $('#compare-picker').innerHTML = `<div class="empty"><div class="empty-icon">⇄</div><div class="empty-msg">אין פריטים</div><div class="empty-sub">הוסף לפחות 2 פריטים לפנקס כדי להשוות</div></div>`;
    $('#compare-result').innerHTML = '';
    return;
  }

  // Picker - all opportunities with checkboxes
  $('#compare-picker').innerHTML = `
    <div class="compare-list">
      ${ops.map(o => {
        const checked = state.compareSelection.includes(o.id);
        const disabled = !checked && state.compareSelection.length >= 3;
        return `
          <label class="compare-pick ${checked ? 'active' : ''} ${disabled ? 'disabled' : ''}">
            <input type="checkbox" data-cmp="${o.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="cmp-name">${escapeHtml(o.name || '')}</span>
            <span class="cmp-cat">${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;

  $$('#compare-picker input[data-cmp]').forEach(c => {
    c.addEventListener('change', e => {
      const id = e.target.dataset.cmp;
      if (e.target.checked) {
        if (!state.compareSelection.includes(id)) state.compareSelection.push(id);
      } else {
        state.compareSelection = state.compareSelection.filter(x => x !== id);
      }
      renderCompare();
    });
  });

  // Result
  if (state.compareSelection.length < 2) {
    $('#compare-result').innerHTML = `<div class="text-faint" style="text-align:center;padding:20px">בחר ${2 - state.compareSelection.length} פריטים נוספים להשוואה</div>`;
    return;
  }

  const items = state.compareSelection.map(id => ops.find(o => o.id === id)).filter(Boolean);
  const cols = items.length;
  const profit = (o) => (o.estimate || 0) - (o.asking || 0);
  const margin = (o) => o.asking ? (profit(o) / o.asking * 100) : 0;

  $('#compare-result').innerHTML = `
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `
        <div class="cmp-col">
          <div class="cmp-title">${escapeHtml(o.name || '')}</div>
          <div class="cmp-cat-label">${OPP_CATEGORIES.find(c => c.k === o.category)?.name || ''}</div>
        </div>
      `).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">מבוקש</div><div class="cmp-value">₪${fmt0(o.asking)}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">משוער</div><div class="cmp-value">₪${fmt0(o.estimate || 0)}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => {
        const p = profit(o);
        return `<div class="cmp-cell"><div class="cmp-label">פוטנציאל</div><div class="cmp-value ${p >= 0 ? 'profit' : 'loss'}">${p >= 0 ? '+' : ''}₪${fmt0(p)}</div></div>`;
      }).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => {
        const m = margin(o);
        return `<div class="cmp-cell"><div class="cmp-label">% רווח</div><div class="cmp-value ${m >= 0 ? 'profit' : 'loss'}">${fmt(m, 1)}%</div></div>`;
      }).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">סטטוס</div><div class="cmp-value">${{watching:'במעקב',bought:'במלאי',sold:'נמכר'}[o.status]}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">מוכר</div><div class="cmp-value cmp-text">${escapeHtml(o.seller || '—')}</div></div>`).join('')}
    </div>
    <div class="compare-grid" style="grid-template-columns:repeat(${cols}, 1fr)">
      ${items.map(o => `<div class="cmp-cell"><div class="cmp-label">תאריך</div><div class="cmp-value cmp-text">${shortDate(o.created)}</div></div>`).join('')}
    </div>
    <div style="margin-top:16px;padding:12px;background:var(--surface);border-radius:8px;text-align:center;font-size:13px">
      ${(() => {
        const winner = items.reduce((best, o) => margin(o) > margin(best) ? o : best, items[0]);
        return `<strong style="color:var(--gold)">המומלץ:</strong> ${escapeHtml(winner.name)} (${fmt(margin(winner), 1)}%)`;
      })()}
    </div>
    <button class="btn-ghost" id="cmp-clear" style="margin-top:12px">נקה בחירה</button>
  `;

  $('#cmp-clear')?.addEventListener('click', () => {
    state.compareSelection = [];
    renderCompare();
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  HEBREW DATE - using simple algorithm (Noda Time-style for Heb cal)
// ─────────────────────────────────────────────────────────────────────────────

const HEB_MONTHS = ['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר ב\''];
const HEB_DAYS = ['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','שבת'];

function getHebrewDate() {
  // Use Intl.DateTimeFormat with hebrew calendar - more accurate than manual calc
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const heb = fmt.format(now);
    const dayName = HEB_DAYS[now.getDay()];
    return `${dayName} · ${heb}`;
  } catch (e) {
    return new Date().toLocaleDateString('he-IL');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PULL-TO-REFRESH
// ─────────────────────────────────────────────────────────────────────────────

function setupPullToRefresh() {
  let startY = 0, currentY = 0, pulling = false;
  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.textContent = '↓ משוך לרענון';
  document.body.appendChild(indicator);

  const main = document.querySelector('.main');
  if (!main) return;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0) return;
    if (state.view !== 'dashboard') return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    currentY = e.touches[0].clientY;
    const distance = currentY - startY;
    if (distance > 0 && distance < 200) {
      indicator.classList.add('visible');
      indicator.textContent = distance > 80 ? '↻ שחרר לרענון' : '↓ משוך לרענון';
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    const distance = currentY - startY;
    indicator.classList.remove('visible');
    if (distance > 80) {
      indicator.textContent = '↻ מרענן...';
      indicator.classList.add('visible');
      fetchAllPrices(false).then(() => {
        setTimeout(() => indicator.classList.remove('visible'), 800);
      });
    }
    pulling = false;
    startY = 0;
    currentY = 0;
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE INPUT
// ─────────────────────────────────────────────────────────────────────────────

function setupVoiceInput() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return;

  // Add voice button next to text inputs we care about
  const targets = [
    '#opp-search',
    '#no-name',
    '#no-notes',
    '#no-seller',
    '#a-name',
    '#b-name',
    '#cn-name',
    '#ph-model',
    '#ar-artist',
    '#nft-name',
    '#veh-model',
    '#w-model',
  ];

  targets.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el || el.dataset.voiceWired) return;
    el.dataset.voiceWired = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voice-btn';
    btn.innerHTML = '🎤';
    btn.title = 'הקלטה קולית';
    btn.setAttribute('aria-label', 'הקלטה קולית');

    // Wrap input + button in a flex container
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:6px;align-items:stretch';
    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      const recognition = new Speech();
      recognition.lang = 'he-IL';
      recognition.continuous = false;
      recognition.interimResults = false;

      btn.classList.add('recording');
      btn.innerHTML = '⏺';

      recognition.onresult = (e) => {
        const text = e.results[0][0].transcript;
        // Append rather than replace
        if (el.value && el.tagName === 'TEXTAREA') {
          el.value += '\n' + text;
        } else {
          el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        toast(`✓ "${text.substring(0, 40)}..."`, 'success');
      };
      recognition.onerror = (e) => {
        toast('הקלטה נכשלה: ' + e.error, 'error');
      };
      recognition.onend = () => {
        btn.classList.remove('recording');
        btn.innerHTML = '🎤';
      };

      recognition.start();
    });
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  DEVICE SYNC - QR Code Backup/Restore
// ─────────────────────────────────────────────────────────────────────────────

async function generateBackupQR() {
  const container = $('#qr-container');
  if (!container) return;

  // Compress all data
  const data = {
    v: '3.0',
    t: Date.now(),
    opps: state.opportunities,
    prices: state.prices,
  };
  const jsonStr = JSON.stringify(data);
  const compressed = LZString.compressToEncodedURIComponent(jsonStr);

  // Calculate size
  const sizeKB = (compressed.length / 1024).toFixed(1);

  // QR code can hold ~2900 chars at version 40 with low correction
  if (compressed.length > 2800) {
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-warning">
        ⚠️ הנתונים גדולים מדי ל-QR יחיד (${sizeKB}KB).
        <br>השתמש בייצוא JSON או "העלה לענן" במקום.
      </div>
    `;
    return;
  }

  try {
    const qr = qrcode(0, 'L'); // auto version, low error correction = max capacity
    qr.addData(compressed);
    qr.make();

    const cellSize = 6;
    const margin = 12;
    const moduleCount = qr.getModuleCount();
    const size = moduleCount * cellSize + margin * 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${size}" height="${size}" fill="white"/>`;
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          svg += `<rect x="${c * cellSize + margin}" y="${r * cellSize + margin}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
        }
      }
    }
    svg += '</svg>';

    container.hidden = false;
    container.innerHTML = `
      <div class="qr-display">
        <div class="qr-title">סרוק את הקוד עם המכשיר השני</div>
        <div class="qr-code">${svg}</div>
        <div class="qr-info">
          📦 ${state.opportunities.length} פריטים · ${sizeKB}KB דחוס
        </div>
        <button class="btn-ghost" id="qr-close">סגור</button>
      </div>
    `;
    $('#qr-close')?.addEventListener('click', () => {
      container.hidden = true;
      container.innerHTML = '';
    });
  } catch (e) {
    container.hidden = false;
    container.innerHTML = `<div class="qr-warning">שגיאה ביצירת QR: ${e.message}</div>`;
  }
}

async function scanBackupQR() {
  const container = $('#qr-container');
  if (!container) return;

  // Check if BarcodeDetector is supported
  if (!('BarcodeDetector' in window)) {
    // Fallback: paste manually
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-scanner">
        <div class="qr-title">⚠️ סריקה אוטומטית לא נתמכת בדפדפן זה</div>
        <p class="text-faint">הדבק את הטקסט מה-QR כאן:</p>
        <textarea id="qr-paste" rows="4" placeholder="הדבק את הקוד..."></textarea>
        <button class="btn-primary" id="qr-paste-go">שחזר</button>
        <button class="btn-ghost" id="qr-paste-close">בטל</button>
      </div>
    `;
    $('#qr-paste-go')?.addEventListener('click', () => {
      const code = $('#qr-paste').value.trim();
      if (code) restoreFromCode(code);
    });
    $('#qr-paste-close')?.addEventListener('click', () => {
      container.hidden = true;
      container.innerHTML = '';
    });
    return;
  }

  // Use camera + BarcodeDetector
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    container.hidden = false;
    container.innerHTML = `
      <div class="qr-scanner">
        <div class="qr-title">כוון את המצלמה אל קוד ה-QR</div>
        <video id="qr-video" autoplay playsinline></video>
        <button class="btn-ghost" id="qr-stop">בטל</button>
      </div>
    `;

    const video = $('#qr-video');
    video.srcObject = stream;
    await video.play();

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    let scanning = true;

    const stopScan = () => {
      scanning = false;
      stream.getTracks().forEach(t => t.stop());
      container.hidden = true;
      container.innerHTML = '';
    };

    $('#qr-stop')?.addEventListener('click', stopScan);

    const tick = async () => {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          stopScan();
          restoreFromCode(codes[0].rawValue);
          return;
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    container.hidden = false;
    container.innerHTML = `
      <div class="qr-warning">
        לא ניתן לגשת למצלמה: ${e.message}
        <br><br>
        אפשרויות חלופיות:
        <br>• השתמש ב"גיבוי בענן"
        <br>• השתמש ב"שחזור מגיבוי" (קובץ JSON)
      </div>
    `;
  }
}

function restoreFromCode(code) {
  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(code);
    if (!decompressed) throw new Error('פענוח נכשל');
    const data = JSON.parse(decompressed);
    if (!data.opps || !Array.isArray(data.opps)) throw new Error('פורמט לא תקין');
    if (!confirm(`לטעון ${data.opps.length} פריטים? פעולה זו תחליף את הנתונים הנוכחיים.`)) return;
    state.opportunities = data.opps;
    if (data.prices) state.prices = { ...state.prices, ...data.prices };
    Storage.save('opportunities', state.opportunities);
    Storage.save('prices', state.prices);
    renderHeader();
    renderDashboard();
    toast(`✓ שוחזרו ${data.opps.length} פריטים`, 'success');
    $('#qr-container').hidden = true;
    $('#qr-container').innerHTML = '';
  } catch (e) {
    toast('שחזור נכשל: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLOUD SYNC - הוסר (אופליין)
// ─────────────────────────────────────────────────────────────────────────────

// סנכרון ענן הוסר: האפליקציה פועלת אופליין. לגיבוי השתמש בקובץ JSON מוצפן.
async function uploadToCloud() {
  const status = $('#cloud-status');
  if (status) status.textContent = 'סנכרון ענן כבוי — השתמש בגיבוי ידני';
}

async function downloadFromCloud() {
  const status = $('#cloud-status');
  if (status) status.textContent = 'סנכרון ענן כבוי — השתמש בשחזור מגיבוי ידני';
}

// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS STATS - show usage info
// ─────────────────────────────────────────────────────────────────────────────

function renderSettingsStats() {
  const el = $('#settings-stats');
  if (!el) return;
  const opps = state.opportunities;
  const totalSize = JSON.stringify({ opps, prices: state.prices }).length;
  const photos = opps.filter(o => o.photo || o.hasPhoto).length;
  const lastUpdate = state.prices.lastUpdate
    ? new Date(state.prices.lastUpdate).toLocaleString('he-IL')
    : 'לא עודכן';

  el.innerHTML = `
    <div class="r-row"><span class="r-label">סה"כ פריטים</span><span class="r-value">${opps.length}</span></div>
    <div class="r-row"><span class="r-label">פריטים עם תמונה</span><span class="r-value">${photos}</span></div>
    <div class="r-row"><span class="r-label">גודל נתונים</span><span class="r-value">${(totalSize/1024).toFixed(1)} KB</span></div>
    <div class="r-row"><span class="r-label">עדכון מחירים אחרון</span><span class="r-value text-faint" style="font-size:11px">${lastUpdate}</span></div>
    <div class="r-row"><span class="r-label">מקור מחירים</span><span class="r-value">${state.prices.source === 'live' ? '🟢 חי' : state.prices.source === 'manual' ? '🟡 ידני' : '⚪ ברירת מחדל'}</span></div>
  `;
}


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



// ─────────────────────────────────────────────────────────────────────────────
//  PDF EXPORT - generate PDF valuation reports
// ─────────────────────────────────────────────────────────────────────────────

function exportPDFReport(opp) {
  // Open print dialog with formatted page (browser will offer "Save as PDF")
  const cat = OPP_CATEGORIES.find(c => c.k === opp.category)?.name || '';
  const profit = (opp.estimate || 0) - (opp.asking || 0);
  const margin = opp.asking ? (profit / opp.asking * 100) : 0;
  const today = new Date().toLocaleDateString('he-IL');

  const reportHTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>דוח שמאות - ${escapeHtml(opp.name || '')}</title>
  <style>
    @page { margin: 2cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.6; color: #000; max-width: 700px; margin: 0 auto; padding: 20px; }
    h1 { color: #c19c0a; border-bottom: 3px solid #c19c0a; padding-bottom: 8px; }
    h2 { color: #333; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .meta { background: #f5f5f5; padding: 12px; border-radius: 4px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted #ccc; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: bold; }
    .profit { color: #2d8659; }
    .loss { color: #b91c1c; }
    .verdict { background: #fff3cd; padding: 10px; border-radius: 4px; margin: 12px 0; text-align: center; font-weight: bold; }
    .verdict.profit { background: #d4f4dd; color: #2d8659; }
    .verdict.loss { background: #fde8e8; color: #b91c1c; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #c19c0a; font-size: 12px; color: #666; text-align: center; }
    .signature-area { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-line { border-top: 1px solid #000; padding-top: 4px; width: 40%; text-align: center; font-size: 12px; }
    img.opp-photo { max-width: 300px; max-height: 300px; display: block; margin: 16px auto; border: 1px solid #ccc; padding: 4px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" style="float:left;padding:10px 20px;background:#c19c0a;color:white;border:none;border-radius:4px;cursor:pointer" onclick="window.print()">🖨 הדפס / שמור כ-PDF</button>
  <h1>דוח שמאות מקצועי</h1>
  <div class="meta">
    <div class="row"><span class="label">תאריך הדוח:</span> <span class="value">${today}</span></div>
    <div class="row"><span class="label">קטגוריה:</span> <span class="value">${escapeHtml(cat)}</span></div>
    <div class="row"><span class="label">מספר זיהוי:</span> <span class="value">${opp.id}</span></div>
    <div class="row"><span class="label">סטטוס:</span> <span class="value">${{watching:'במעקב',bought:'במלאי',sold:'נמכר'}[opp.status] || ''}</span></div>
  </div>

  <h2>פרטי הפריט</h2>
  <div class="row"><span class="label">שם הפריט:</span> <span class="value">${escapeHtml(opp.name || '—')}</span></div>
  ${opp.seller ? `<div class="row"><span class="label">מוכר / מקור:</span> <span class="value">${escapeHtml(opp.seller)}</span></div>` : ''}
  ${opp.notes ? `<div class="row"><span class="label">הערות:</span> <span class="value">${escapeHtml(opp.notes)}</span></div>` : ''}

  ${opp.photo ? `<img class="opp-photo" src="${opp.photo}" alt="תמונת הפריט" />` : ''}

  <h2>הערכת שווי</h2>
  <div class="row"><span class="label">מחיר מבוקש:</span> <span class="value">₪${fmt0(opp.asking || 0)}</span></div>
  <div class="row"><span class="label">שווי שוק משוער:</span> <span class="value">₪${fmt0(opp.estimate || 0)}</span></div>
  <div class="row"><span class="label">פער:</span> <span class="value ${profit >= 0 ? 'profit' : 'loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)} (${fmt(margin, 1)}%)</span></div>

  ${opp.purchasePrice ? `
  <h2>היסטוריית עסקה</h2>
  <div class="row"><span class="label">מחיר רכישה בפועל:</span> <span class="value">₪${fmt0(opp.purchasePrice)}</span></div>
  ${opp.salePrice ? `<div class="row"><span class="label">מחיר מכירה:</span> <span class="value">₪${fmt0(opp.salePrice)}</span></div>` : ''}
  ${opp.salePrice ? `<div class="row"><span class="label">רווח/הפסד:</span> <span class="value ${(opp.salePrice - opp.purchasePrice) >= 0 ? 'profit' : 'loss'}">${(opp.salePrice - opp.purchasePrice) >= 0 ? '+' : ''}₪${fmt0(opp.salePrice - opp.purchasePrice)}</span></div>` : ''}
  ` : ''}

  <div class="verdict ${profit >= 0 ? 'profit' : 'loss'}">
    ${profit >= 0 ? `✓ הזדמנות עסקית - רווח חזוי ${fmt(margin, 1)}%` : `⚠ מחיר גבוה מהשוק`}
  </div>

  <h2>הערות</h2>
  <p style="font-size: 12px; color: #666;">
    הערכה זו מבוססת על מחירי שוק נוכחיים, מצב הפריט, נדירות, ומאפיינים מיוחדים.
    הדוח מסופק כסיוע למקבל ההחלטות ואינו מהווה חוות דעת מקצועית של שמאי מוסמך.
    מומלץ לאמת את הפריט אצל שמאי מוסמך לפני עסקה משמעותית.
  </p>

  <div class="signature-area">
    <div class="signature-line">חתימת השמאי</div>
    <div class="signature-line">תאריך</div>
  </div>

  <div class="footer">
    הופק על-ידי שמאי - פלטפורמת סוחרים | ${today}
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    toast('חסום על-ידי הדפדפן - אפשר חלונות קופצים', 'error');
    return;
  }
  win.document.open();
  win.document.write(reportHTML);
  win.document.close();
}

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
        <div class="jw-value">${parsha || '—'}</div>
      </div>
      ${holiday ? `
        <div class="jw-item">
          <div class="jw-label">חג קרוב</div>
          <div class="jw-value">${holiday.name}</div>
          <div class="jw-sub">בעוד ${holiday.daysAway} ימים</div>
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
    document.addEventListener('click', e => {
      if (e.target.dataset.calc) calcAction(e.target.dataset.calc);
      if (e.target.dataset.quick) calcQuick(e.target.dataset.quick);
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


// ─────────────────────────────────────────────────────────────────────────────
//  CONTACTS CRM - track sellers/buyers across deals
// ─────────────────────────────────────────────────────────────────────────────

state.contacts = state.contacts || [];

function getContactsFromOpps() {
  // Auto-build contacts from opportunities
  const map = new Map();
  state.opportunities.forEach(o => {
    if (!o.seller) return;
    const phone = detectPhone(o.seller);
    const key = phone || o.seller.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: o.seller.replace(/\d[\d\s-]+/g, '').trim() || 'ללא שם',
        phone: phone || '',
        rawSellerText: o.seller,
        deals: [],
        totalSpent: 0,
        totalEarned: 0,
        firstSeen: o.created,
        lastSeen: o.created,
      });
    }
    const c = map.get(key);
    c.deals.push({ id: o.id, name: o.name, status: o.status, asking: o.asking, created: o.created });
    if (o.status === 'bought' || o.status === 'sold') {
      c.totalSpent += (o.purchasePrice || o.asking || 0);
    }
    if (o.status === 'sold') {
      c.totalEarned += (o.salePrice || 0);
    }
    if (o.created < c.firstSeen) c.firstSeen = o.created;
    if (o.created > c.lastSeen) c.lastSeen = o.created;
  });
  return Array.from(map.values()).sort((a, b) => b.deals.length - a.deals.length);
}

function renderContactsView() {
  const c = $('#contacts-view');
  if (!c) return;
  const contacts = getContactsFromOpps();

  if (contacts.length === 0) {
    c.innerHTML = `
      <div class="empty">
        <div class="empty-icon">👥</div>
        <div class="empty-msg">אין אנשי קשר עדיין</div>
        <div class="empty-sub">הוסף פריטים לפנקס עם שם המוכר ואנשי הקשר יבנו אוטומטית</div>
      </div>
    `;
    return;
  }

  c.innerHTML = `
    <div class="text-faint" style="margin-bottom:12px;font-size:12px">
      ${contacts.length} אנשי קשר · ${state.opportunities.length} עסקאות
    </div>
    ${contacts.map(c => `
      <div class="contact-card" data-contact="${c.id}">
        <div class="contact-head">
          <div class="contact-name">${escapeHtml(c.name)}</div>
          ${c.phone ? `<div class="contact-phone">${escapeHtml(c.phone)}</div>` : ''}
        </div>
        <div class="contact-stats">
          <span class="cs-pill">${c.deals.length} עסקאות</span>
          ${c.totalSpent > 0 ? `<span class="cs-pill warning">קניות: ₪${fmt0(c.totalSpent)}</span>` : ''}
          ${c.totalEarned > 0 ? `<span class="cs-pill profit">מכירות: ₪${fmt0(c.totalEarned)}</span>` : ''}
        </div>
        <div class="contact-actions">
          ${c.phone ? `
            <button data-act="contact-call" data-phone="${c.phone}">📞 חייג</button>
            <button data-act="contact-wa" data-phone="${c.phone}" data-name="${escapeHtml(c.name)}">💬 WhatsApp</button>
          ` : ''}
          <button data-act="contact-deals" data-contact="${c.id}">📋 ${c.deals.length} עסקאות</button>
        </div>
      </div>
    `).join('')}
  `;

  // Wire up
  $$('.contact-actions button').forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.act;
      if (action === 'contact-call') callPhone(b.dataset.phone);
      else if (action === 'contact-wa') {
        const cleaned = b.dataset.phone.replace(/[^\d+]/g, '');
        const intl = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('0') ? '+972' + cleaned.substring(1) : '+972' + cleaned;
        const msg = `שלום ${b.dataset.name}, מתעדכן בנוגע לעסקה...`;
        window.open(`https://wa.me/${intl.replace('+', '')}?text=${encodeURIComponent(msg)}`, '_blank');
      } else if (action === 'contact-deals') {
        // Switch to ledger and filter by this seller
        switchView('ledger');
        setTimeout(() => {
          const contact = contacts.find(c => c.id === b.dataset.contact);
          if (contact) {
            $('#opp-search').value = contact.name.split(' ')[0];
            renderLedger();
          }
        }, 200);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  TEMPLATES - save common items for fast re-entry
// ─────────────────────────────────────────────────────────────────────────────

state.templates = Storage.load('templates') || [];

function saveAsTemplate(opp) {
  const name = prompt('שם התבנית (לדוגמה: "ש"ס וילנא 1890"):');
  if (!name) return;
  const template = {
    id: uid(),
    name,
    category: opp.category,
    asking: opp.asking,
    estimate: opp.estimate,
    notes: opp.notes,
    seller: opp.seller,
    photo: opp.photo,
    createdAt: Date.now(),
  };
  state.templates.unshift(template);
  Storage.save('templates', state.templates);
  toast('✓ תבנית נשמרה', 'success');
}

function applyTemplate(templateId) {
  const t = state.templates.find(x => x.id === templateId);
  if (!t) return;
  $('#no-name').value = t.name;
  $('#no-asking').value = t.asking || '';
  $('#no-est').value = t.estimate || '';
  $('#no-cat').value = t.category;
  $('#no-seller').value = t.seller || '';
  $('#no-notes').value = t.notes || '';
  if (t.photo) {
    $('#no-photo-preview').innerHTML = `<img src="${t.photo}" alt="תצוגה" /><button class="remove-photo" aria-label="הסר">×</button>`;
    $('#no-photo-preview').hidden = false;
    $('#no-photo-preview').dataset.data = t.photo;
  }
  toast('✓ תבנית הוטענה', 'success');
}

function deleteTemplate(templateId) {
  if (!confirm('למחוק את התבנית?')) return;
  state.templates = state.templates.filter(x => x.id !== templateId);
  Storage.save('templates', state.templates);
  renderTemplatesList();
}

function renderTemplatesList() {
  const el = $('#templates-list');
  if (!el) return;
  if (state.templates.length === 0) {
    el.innerHTML = `<div class="text-faint" style="text-align:center;padding:16px;font-size:12px">אין תבניות עדיין. שמור פריט כתבנית מתוך הפנקס</div>`;
    return;
  }
  el.innerHTML = state.templates.map(t => `
    <div class="template-row">
      <button class="template-apply" data-tpl="${t.id}">
        <span class="tpl-name">${escapeHtml(t.name)}</span>
        <span class="tpl-meta">${OPP_CATEGORIES.find(c => c.k === t.category)?.name || ''} · ₪${fmt0(t.asking || 0)}</span>
      </button>
      <button class="template-del" data-tpl-del="${t.id}" aria-label="מחק">×</button>
    </div>
  `).join('');
  $$('.template-apply').forEach(b => b.addEventListener('click', () => applyTemplate(b.dataset.tpl)));
  $$('.template-del').forEach(b => b.addEventListener('click', () => deleteTemplate(b.dataset.tplDel)));
}

// ─────────────────────────────────────────────────────────────────────────────
//  THEME TOGGLE - dark/light
// ─────────────────────────────────────────────────────────────────────────────

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('shamai_theme', theme);
  state.settings = state.settings || {};
  state.settings.theme = theme;
  Storage.save('settings', state.settings);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ─────────────────────────────────────────────────────────────────────────────
//  TODAY'S INSIGHTS - smart suggestions
// ─────────────────────────────────────────────────────────────────────────────

function generateInsights() {
  const insights = [];
  const opps = state.opportunities;
  const watching = opps.filter(o => o.status === 'watching');
  const bought = opps.filter(o => o.status === 'bought');
  const sold = opps.filter(o => o.status === 'sold');

  // 1. Stale items
  const staleItems = watching.filter(o => daysSince(o.created) > 30);
  if (staleItems.length > 0) {
    insights.push({
      icon: '⏰',
      title: `${staleItems.length} פריטים במעקב מעל 30 יום`,
      sub: 'שווה לבדוק אם הם עוד רלוונטיים',
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.sort = 'oldest';
          $('#opp-sort').value = 'oldest';
          renderLedger();
        }, 200);
      },
    });
  }

  // 2. High potential profit watching
  const bigOps = watching.filter(o => o.estimate && o.asking && (o.estimate - o.asking) > 5000);
  if (bigOps.length > 0) {
    const totalPotential = bigOps.reduce((s, o) => s + (o.estimate - o.asking), 0);
    insights.push({
      icon: '💰',
      title: `${bigOps.length} הזדמנויות ברוח 5K+ ₪`,
      sub: `פוטנציאל כולל: ₪${fmt0(totalPotential)}`,
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.sort = 'profit-desc';
          $('#opp-sort').value = 'profit-desc';
          renderLedger();
        }, 200);
      },
    });
  }

  // 3. Inventory sitting too long (bought but not sold)
  const oldInventory = bought.filter(o => daysSince(o.purchaseDate || o.created) > 60);
  if (oldInventory.length > 0) {
    insights.push({
      icon: '📦',
      title: `${oldInventory.length} פריטים במלאי מעל 60 יום`,
      sub: 'שווה לחשוב על אסטרטגיית מכירה',
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.filter = 'bought';
          $$('.filter-btn').forEach(x => x.classList.remove('active'));
          document.querySelector('.filter-btn[data-filter="bought"]')?.classList.add('active');
          renderLedger();
        }, 200);
      },
    });
  }

  // 4. Recent profit milestone
  const recentSold = sold.filter(o => daysSince(o.soldDate || o.created) <= 30);
  if (recentSold.length > 0) {
    const profit = recentSold.reduce((s, o) => s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0)), 0);
    if (profit > 0) {
      insights.push({
        icon: '🎉',
        title: `רווח של ₪${fmt0(profit)} בחודש האחרון`,
        sub: `${recentSold.length} עסקאות סגורות`,
        action: () => switchView('tools'),
      });
    }
  }

  // 5. Price changes alert (gold)
  const goldHist = (Storage.load(PRICE_HISTORY_KEY) || {}).gold;
  if (goldHist && goldHist.length >= 2) {
    const latest = goldHist[goldHist.length - 1].v;
    const earliest = goldHist[0].v;
    const change = ((latest - earliest) / earliest) * 100;
    if (Math.abs(change) > 5) {
      insights.push({
        icon: change > 0 ? '📈' : '📉',
        title: `זהב ${change > 0 ? 'עלה' : 'ירד'} ב-${fmt(Math.abs(change), 1)}%`,
        sub: `מ-$${fmt0(earliest)} ל-$${fmt0(latest)} (לפי המעקב שלך)`,
        action: () => switchView('dashboard'),
      });
    }
  }

  // 6. Best category (most profit)
  if (sold.length >= 3) {
    const byCat = {};
    sold.forEach(o => {
      const cat = o.category || 'general';
      if (!byCat[cat]) byCat[cat] = { count: 0, profit: 0 };
      byCat[cat].count++;
      byCat[cat].profit += (o.salePrice || 0) - (o.purchasePrice || o.asking || 0);
    });
    const best = Object.entries(byCat).sort((a, b) => b[1].profit - a[1].profit)[0];
    if (best && best[1].profit > 0) {
      const catName = OPP_CATEGORIES.find(c => c.k === best[0])?.name || best[0];
      insights.push({
        icon: '🏆',
        title: `${catName} - הקטגוריה הרווחית ביותר`,
        sub: `₪${fmt0(best[1].profit)} ב-${best[1].count} עסקאות`,
        action: () => {
          switchView('tools');
          setTimeout(() => switchSubView('tools', 'analytics'), 200);
        },
      });
    }
  }

  // 7. Default - if no insights, suggest action
  if (insights.length === 0) {
    if (opps.length === 0) {
      insights.push({
        icon: '👋',
        title: 'ברוך הבא לשמאי',
        sub: 'התחל בהוספת פריט ראשון לפנקס',
        action: () => { switchView('appraisal'); },
      });
    } else {
      insights.push({
        icon: '✨',
        title: 'הכל מסודר',
        sub: `${opps.length} פריטים בפנקס. כל הכבוד!`,
        action: () => switchView('ledger'),
      });
    }
  }

  return insights;
}

function renderInsights() {
  const el = $('#insights-list');
  if (!el) return;
  const insights = generateInsights();
  el.innerHTML = insights.map((ins, i) => `
    <button class="insight-card" data-insight="${i}">
      <div class="ins-icon">${ins.icon}</div>
      <div class="ins-body">
        <div class="ins-title">${escapeHtml(ins.title)}</div>
        <div class="ins-sub">${escapeHtml(ins.sub)}</div>
      </div>
    </button>
  `).join('');
  $$('.insight-card').forEach((b, i) => {
    b.addEventListener('click', insights[i].action);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  WIRE NEW v5 EVENTS
// ─────────────────────────────────────────────────────────────────────────────

(function wireV5() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireV5, 250));
    return;
  }
  setTimeout(() => {
    // Theme
    const savedTheme = localStorage.getItem('shamai_theme') || 'dark';
    setTheme(savedTheme);
    $('#btn-theme')?.addEventListener('click', () => {
      toggleTheme();
      const btn = $('#btn-theme');
      if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙';
    });
    // Set initial theme button icon
    const themeBtn = $('#btn-theme');
    if (themeBtn) themeBtn.textContent = savedTheme === 'light' ? '☀️' : '🌙';

    // Render templates when new opp form opens
    const newOppBtn = $('#btn-new-opp');
    if (newOppBtn) {
      const original = newOppBtn.onclick;
      newOppBtn.addEventListener('click', () => {
        setTimeout(() => renderTemplatesList(), 100);
      });
    }

    // Render insights on dashboard
    const renderDash = window.renderDashboard;
    if (renderDash) {
      window.renderDashboard = function() {
        renderDash.apply(this, arguments);
        renderInsights();
      };
    }
    renderInsights();
  }, 400);
})();

// ─────────────────────────────────────────────────────────────────────────────
//  Add "save as template" action to opp cards
// ─────────────────────────────────────────────────────────────────────────────

const oldOppActionV5 = oppAction;
window.oppAction = async function(id, action) {
  if (action === 'template') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) saveAsTemplate(opp);
    return;
  }
  return oldOppActionV5.apply(this, arguments);
};


// ─────────────────────────────────────────────────────────────────────────────
//  BARCODE SCANNER - using BarcodeDetector API
// ─────────────────────────────────────────────────────────────────────────────

async function scanBarcode() {
  if (!('BarcodeDetector' in window)) {
    toast('סורק ברקוד לא נתמך בדפדפן זה - השתמש בChrome או Edge', 'error');
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'barcode-overlay';
      overlay.innerHTML = `
        <div class="barcode-scanner">
          <div class="scanner-title">סרוק ברקוד</div>
          <video autoplay playsinline></video>
          <div class="scanner-frame"></div>
          <button class="scanner-close" aria-label="סגור">×</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video = overlay.querySelector('video');
      video.srcObject = stream;
      video.play();

      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'itf']
      });

      let scanning = true;
      const cleanup = () => {
        scanning = false;
        stream.getTracks().forEach(t => t.stop());
        overlay.remove();
      };

      overlay.querySelector('.scanner-close').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      const tick = async () => {
        if (!scanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            cleanup();
            resolve({ value: codes[0].rawValue, format: codes[0].format });
            return;
          }
        } catch (e) {}
        requestAnimationFrame(tick);
      };
      tick();
    });
  } catch (e) {
    toast('לא ניתן לפתוח מצלמה: ' + e.message, 'error');
    return null;
  }
}

async function scanBarcodeForOpp() {
  const result = await scanBarcode();
  if (!result) return;
  // Auto-fill product name with barcode
  $('#no-name').value = `מוצר ${result.value}`;
  $('#no-notes').value = `ברקוד (${result.format}): ${result.value}`;
  toast(`✓ נסרק: ${result.value}`, 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRODUCT LOOKUP - search Google for similar items
// ─────────────────────────────────────────────────────────────────────────────

function lookupOnGoogle(opp) {
  const query = encodeURIComponent(`${opp.name} מחיר`);
  window.open(`https://www.google.com/search?q=${query}&tbm=shop`, '_blank');
}

function lookupOnEbay(opp) {
  const query = encodeURIComponent(opp.name);
  window.open(`https://www.ebay.com/sch/i.html?_nkw=${query}&_sop=15`, '_blank');
}

function lookupOnAuctions(opp) {
  // Israeli auction sites
  const query = encodeURIComponent(opp.name);
  window.open(`https://www.bidspirit.com/ui/search?q=${query}`, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIO NOTES - record voice memos for opportunities
// ─────────────────────────────────────────────────────────────────────────────

let activeRecorder = null;

async function recordAudioNote(oppId) {
  if (activeRecorder) {
    toast('כבר מוקלט - לחץ עצור', 'info');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    activeRecorder = recorder;

    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const opp = state.opportunities.find(o => o.id === oppId);
        if (!opp) return;
        opp.audioNotes = opp.audioNotes || [];
        opp.audioNotes.push({
          id: uid(),
          data: reader.result,
          duration: Math.round((Date.now() - recordStart) / 1000),
          createdAt: Date.now(),
        });
        Storage.save('opportunities', state.opportunities);
        renderLedger();
        toast('✓ נשמרה הקלטה', 'success');
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
      activeRecorder = null;
      document.querySelector('.recording-overlay')?.remove();
    };

    const recordStart = Date.now();
    recorder.start();

    // Show recording UI
    const overlay = document.createElement('div');
    overlay.className = 'recording-overlay';
    overlay.innerHTML = `
      <div class="recording-pulse">🔴</div>
      <div class="recording-time" id="rec-time">0:00</div>
      <button class="recording-stop">⏹ עצור והקלט</button>
    `;
    document.body.appendChild(overlay);

    const updateTime = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStart) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const el = document.getElementById('rec-time');
      if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (!activeRecorder) clearInterval(updateTime);
    }, 250);

    overlay.querySelector('.recording-stop').addEventListener('click', () => {
      recorder.stop();
    });
  } catch (e) {
    toast('שגיאה במיקרופון: ' + e.message, 'error');
    activeRecorder = null;
  }
}

function playAudioNote(audioData) {
  const audio = new Audio(audioData);
  audio.play().catch(e => toast('שגיאה בהשמעה: ' + e.message, 'error'));
}

function deleteAudioNote(oppId, noteId) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp || !opp.audioNotes) return;
  if (!confirm('למחוק את ההקלטה?')) return;
  opp.audioNotes = opp.audioNotes.filter(n => n.id !== noteId);
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO REMINDERS - schedule check-back on stale items
// ─────────────────────────────────────────────────────────────────────────────

function setReminderForOpp(oppId, days) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp) return;
  opp.reminderAt = Date.now() + days * 86400000;
  Storage.save('opportunities', state.opportunities);
  toast(`✓ תזכורת בעוד ${days} ימים`, 'success');
  renderLedger();
}

function clearReminder(oppId) {
  const opp = state.opportunities.find(o => o.id === oppId);
  if (!opp) return;
  delete opp.reminderAt;
  Storage.save('opportunities', state.opportunities);
  renderLedger();
}

function checkReminders() {
  const now = Date.now();
  const due = state.opportunities.filter(o => o.reminderAt && o.reminderAt <= now);
  return due;
}

// Override insights to also include reminders
const originalGenerateInsights = generateInsights;
window.generateInsights = function() {
  const insights = originalGenerateInsights.apply(this, arguments);
  const due = checkReminders();
  if (due.length > 0) {
    insights.unshift({
      icon: '⏰',
      title: `${due.length} תזכורות הגיע מועדן`,
      sub: due.slice(0, 2).map(o => o.name).join(', ') + (due.length > 2 ? ` +${due.length - 2}` : ''),
      action: () => {
        switchView('ledger');
        setTimeout(() => {
          state.ledger.filter = 'watching';
          renderLedger();
        }, 200);
      },
    });
  }
  return insights;
};

// ─────────────────────────────────────────────────────────────────────────────
//  CATALOG PRINT - print full inventory as a catalog
// ─────────────────────────────────────────────────────────────────────────────

function printCatalog(filter = 'all') {
  let items = state.opportunities;
  if (filter === 'watching') items = items.filter(o => o.status === 'watching');
  else if (filter === 'bought') items = items.filter(o => o.status === 'bought');
  else if (filter === 'sold') items = items.filter(o => o.status === 'sold');

  if (items.length === 0) {
    toast('אין פריטים להדפסה', 'error');
    return;
  }

  const today = new Date().toLocaleDateString('he-IL');
  const totalValue = items.reduce((s, o) => s + (o.estimate || o.asking || 0), 0);
  const totalProfit = items.reduce((s, o) => {
    if (o.status === 'sold') return s + ((o.salePrice || 0) - (o.purchasePrice || o.asking || 0));
    return s + Math.max(0, (o.estimate || 0) - (o.asking || 0));
  }, 0);

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>קטלוג שמאי - ${today}</title>
  <style>
    @page { margin: 1.5cm; }
    body { font-family: 'David', 'Times New Roman', serif; line-height: 1.4; color: #000; }
    h1 { color: #b8860b; border-bottom: 3px solid #b8860b; padding-bottom: 8px; margin-bottom: 4px; }
    .summary { background: #f5f5f5; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; display: flex; justify-content: space-between; flex-wrap: wrap; }
    .sum-cell { font-size: 13px; }
    .sum-cell strong { font-size: 18px; color: #b8860b; display: block; }
    .item { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; display: flex; gap: 12px; }
    .item-photo { width: 80px; height: 80px; flex-shrink: 0; border: 1px solid #ddd; background: #f9f9f9; display: flex; align-items: center; justify-content: center; color: #999; font-size: 24px; }
    .item-photo img { width: 100%; height: 100%; object-fit: cover; }
    .item-body { flex: 1; }
    .item-name { font-weight: bold; font-size: 15px; margin-bottom: 4px; }
    .item-meta { font-size: 11px; color: #666; margin-bottom: 6px; }
    .item-prices { display: flex; gap: 16px; font-size: 13px; }
    .item-price { background: #f0f0f0; padding: 4px 8px; border-radius: 4px; }
    .price-profit { color: #2d8659; font-weight: bold; }
    .price-loss { color: #b91c1c; font-weight: bold; }
    .item-notes { font-size: 11px; color: #555; margin-top: 6px; padding-top: 6px; border-top: 1px dotted #ccc; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 2px solid #b8860b; font-size: 11px; color: #666; text-align: center; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" style="float:left;padding:10px 20px;background:#b8860b;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold" onclick="window.print()">🖨 הדפס / שמור כ-PDF</button>
  <h1>קטלוג מלאי - שמאי</h1>
  <div style="font-size:13px;color:#666;margin-bottom:16px">${today} · ${{all:'כל הפריטים',watching:'במעקב',bought:'במלאי',sold:'נמכרים'}[filter] || ''}</div>

  <div class="summary">
    <div class="sum-cell"><strong>${items.length}</strong>פריטים</div>
    <div class="sum-cell"><strong>₪${fmt0(totalValue)}</strong>שווי כולל</div>
    <div class="sum-cell"><strong>₪${fmt0(totalProfit)}</strong>${filter === 'sold' ? 'רווח' : 'פוטנציאל'}</div>
  </div>

  ${items.map(o => {
    const profit = o.status === 'sold' ?
      (o.salePrice || 0) - (o.purchasePrice || o.asking || 0) :
      (o.estimate || 0) - (o.asking || 0);
    const cat = OPP_CATEGORIES.find(c => c.k === o.category)?.name || '';
    return `
    <div class="item">
      <div class="item-photo">${o.photo ? `<img src="${o.photo}" />` : '📷'}</div>
      <div class="item-body">
        <div class="item-name">${escapeHtml(o.name || '—')}</div>
        <div class="item-meta">
          ${cat} · ${{watching:'במעקב',bought:'במלאי',sold:'נמכר'}[o.status]} · ${shortDate(o.created)}
          ${o.seller ? ` · ${escapeHtml(o.seller)}` : ''}
        </div>
        <div class="item-prices">
          ${o.asking ? `<span class="item-price">מבוקש: ₪${fmt0(o.asking)}</span>` : ''}
          ${o.estimate ? `<span class="item-price">משוער: ₪${fmt0(o.estimate)}</span>` : ''}
          ${o.purchasePrice ? `<span class="item-price">קנייה: ₪${fmt0(o.purchasePrice)}</span>` : ''}
          ${o.salePrice ? `<span class="item-price">מכירה: ₪${fmt0(o.salePrice)}</span>` : ''}
          ${profit !== 0 ? `<span class="${profit >= 0 ? 'price-profit' : 'price-loss'}">${profit >= 0 ? '+' : ''}₪${fmt0(profit)}</span>` : ''}
        </div>
        ${o.notes ? `<div class="item-notes">${escapeHtml(o.notes)}</div>` : ''}
      </div>
    </div>
  `;
  }).join('')}

  <div class="footer">
    הופק מ-שמאי | ${today} | ${items.length} פריטים
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    toast('חסום על-ידי הדפדפן', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}


// ─────────────────────────────────────────────────────────────────────────────
//  WIRE v6 EVENTS
// ─────────────────────────────────────────────────────────────────────────────

(function wireV6() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireV6, 300));
    return;
  }
  setTimeout(() => {
    // Barcode scanner button
    $('#btn-scan-barcode')?.addEventListener('click', scanBarcodeForOpp);
    // Catalog print
    $('#btn-print-catalog')?.addEventListener('click', () => {
      const filter = state.ledger?.filter || 'all';
      printCatalog(filter);
    });
  }, 500);
})();

// Override oppAction to handle new actions
const oldOppActionV6 = oppAction;
window.oppAction = async function(id, action, ...args) {
  if (action === 'audio') {
    recordAudioNote(id);
    return;
  }
  if (action === 'play-audio') {
    const opp = state.opportunities.find(o => o.id === id);
    if (!opp || !opp.audioNotes) return;
    const note = opp.audioNotes.find(n => n.id === args[0]);
    if (note) playAudioNote(note.data);
    return;
  }
  if (action === 'delete-audio') {
    deleteAudioNote(id, args[0]);
    return;
  }
  if (action === 'remind') {
    const days = parseInt(prompt('בכמה ימים להזכיר?', '7'));
    if (!isNaN(days) && days > 0) setReminderForOpp(id, days);
    return;
  }
  if (action === 'clear-remind') {
    clearReminder(id);
    return;
  }
  if (action === 'lookup-google') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) lookupOnGoogle(opp);
    return;
  }
  if (action === 'lookup-ebay') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) lookupOnEbay(opp);
    return;
  }
  if (action === 'save-template') {
    const opp = state.opportunities.find(o => o.id === id);
    if (opp) saveAsTemplate(opp);
    return;
  }
  return oldOppActionV6.apply(this, arguments);
};


// ─────────────────────────────────────────────────────────────────────────────
//  DRAG & DROP - reorder opportunities in ledger
// ─────────────────────────────────────────────────────────────────────────────

let dragSrcId = null;

function enableDragDrop() {
  // Set draggable + handlers on each opp card
  document.querySelectorAll('.opp-card').forEach(card => {
    if (card.dataset.dragWired) return;
    card.dataset.dragWired = '1';
    card.draggable = true;

    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrcId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.opp-card').forEach(c => c.classList.remove('drag-over'));
      dragSrcId = null;
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (card.dataset.id !== dragSrcId) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetId = card.dataset.id;
      if (!dragSrcId || !targetId || dragSrcId === targetId) return;
      // Reorder in state.opportunities
      const srcIdx = state.opportunities.findIndex(o => o.id === dragSrcId);
      const tgtIdx = state.opportunities.findIndex(o => o.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      const [moved] = state.opportunities.splice(srcIdx, 1);
      state.opportunities.splice(tgtIdx, 0, moved);
      // Add manualOrder timestamp so sort=manual works
      state.opportunities.forEach((o, i) => { o.manualOrder = i; });
      Storage.save('opportunities', state.opportunities);
      // Switch to manual sort if not already
      if (state.ledger?.sort !== 'manual') {
        state.ledger.sort = 'manual';
        const sortSelect = $('#opp-sort');
        if (sortSelect) sortSelect.value = 'manual';
      }
      renderLedger();
      toast('✓ הסדר עודכן', 'success');
    });
  });
}

// Hook into renderLedger to enable drag-drop after each render
const originalRenderLedger = renderLedger;
window.renderLedger = function() {
  originalRenderLedger.apply(this, arguments);
  setTimeout(enableDragDrop, 50);
};

// Add manual sort option dynamically
(function addManualSort() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(addManualSort, 600));
    return;
  }
  setTimeout(() => {
    const sortSelect = $('#opp-sort');
    if (sortSelect && !sortSelect.querySelector('option[value="manual"]')) {
      const opt = document.createElement('option');
      opt.value = 'manual';
      opt.textContent = 'סדר ידני (גרור)';
      sortSelect.appendChild(opt);
    }
  }, 700);
})();

// Extend the sort logic to handle manual
const _originalSortLogic = window.sortOpps || null;
// We'll patch it by wrapping renderLedger - the manual sort needs to read manualOrder

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

let priceRefreshInterval = null;

function startAutoRefresh() {
  if (priceRefreshInterval) return;
  priceRefreshInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchAllPrices(true); // silent refresh
    }
  }, 5 * 60 * 1000); // 5 minutes
}

// Refresh when user comes back to tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const lastUpdate = state.prices.lastUpdate ? new Date(state.prices.lastUpdate) : null;
    const ageMin = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : 999;
    if (ageMin > 5) {
      fetchAllPrices(true);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE PRICE BANNER on every appraisal page
// ─────────────────────────────────────────────────────────────────────────────

function getLivePriceBanner(category) {
  const lastUpdate = state.prices.lastUpdate ? new Date(state.prices.lastUpdate) : null;
  const ageMin = lastUpdate ? Math.round((Date.now() - lastUpdate.getTime()) / 60000) : null;
  const updateText = ageMin === null ? 'אין נתונים' :
                     ageMin === 0 ? 'עודכן עכשיו' :
                     ageMin === 1 ? 'עודכן לפני דקה' :
                     ageMin < 60 ? `עודכן לפני ${ageMin} דקות` :
                     `עודכן לפני ${Math.round(ageMin/60)} שעות`;

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
        <span class="lpb-title">📊 מחירי שוק חיים</span>
        <span class="lpb-update">${updateText}</span>
        <button class="lpb-refresh" onclick="fetchAllPrices()">↻</button>
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

// Auto-refresh banners every 30 sec to update "ago" timer
setInterval(() => {
  if (document.querySelector('.sub-view[data-sub]:not([hidden])')) {
    injectLivePriceBanners();
  }
}, 30000);

// Start the auto-refresh loop
(function initAutoRefresh() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initAutoRefresh, 1500));
    return;
  }
  setTimeout(() => {
    startAutoRefresh();
    // Initial refresh if data is stale
    const lastUpdate = state.prices.lastUpdate ? new Date(state.prices.lastUpdate) : null;
    const ageMin = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : 999;
    if (ageMin > 5) {
      fetchAllPrices(true);
    }
  }, 1500);
})();


// ─────────────────────────────────────────────────────────────────────────────
//  AUTHENTICITY CHECK - identify fakes/counterfeits
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_CHECKLISTS = {
  watch: {
    name: 'שעוני יוקרה',
    icon: '⌚',
    intro: 'כל סימן אדום = ⚠. שלושה סימנים אדומים = סבירות גבוהה לזיוף',
    items: [
      { id: 'weight', q: 'משקל ומשקל ספציפי', tip: 'רולקס אמיתי כבד מהותית מזיוף. דאטג׳סט 36mm ≈ 125g', critical: true },
      { id: 'serial', q: 'מספר סריאלי - חרוט עמוק וברור?', tip: 'חרוט בלייזר/יד עם שוליים חדים. זיוף = רך, מזולזל', critical: true },
      { id: 'second-sweep', q: 'מחוג שניות - תנועה רציפה (מכני)?', tip: 'אוטומטי = תנועה חלקה (8 פעימות לשניה). זיוף קווארץ = קפיצות שניה אחת', critical: true },
      { id: 'cyclops', q: 'זכוכית הציקלופ מגדילה x2.5?', tip: 'זכוכית מקור מגדילה משמעותית את התאריך. זיופים מגדילים פחות' },
      { id: 'crown', q: 'כתר - לוגו רולקס מדויק 5 נקודות?', tip: 'הכתר הקדימה צריך 5 נקודות סימטריות מושלמות' },
      { id: 'rehaut', q: 'רהאוט (טבעת פנימית) - חרוט ROLEX סביב?', tip: 'משנת 2005+ כל רולקס עם חריטה רהאוט. בדוק אחידות' },
      { id: 'movement', q: 'מנגנון - חתימת רולקס + מספרי גלגל?', tip: 'דורש פתיחת הגב. אם המוכר מסרב - חשד גבוה', critical: true },
      { id: 'box-papers', q: 'קופסה + ניירות מקוריים?', tip: 'תעודת אחריות, תג עם סריאל תואם, קופסה ירוקה אופיינית' },
      { id: 'price', q: 'המחיר הגיוני (לא נמוך מ-70% מערך שוק)?', tip: 'הצעה זולה משמעותית = דגל אדום ענק', critical: true },
      { id: 'seller', q: 'מוכר עם היסטוריה ומוניטין?', tip: 'בדוק ביקורות, פרופיל, האם דורש פגישה אישית' },
    ],
  },
  bag: {
    name: 'תיקי יוקרה',
    icon: '👜',
    intro: 'תיק אמיתי - תפר אחיד, חומרה כבדה, ריח עור עשיר',
    items: [
      { id: 'stitching', q: 'תפרים - אחידים, ישרים, צפופים?', tip: 'הרמס: 7-9 תפרים לס"מ, צבע צהוב-חום מובהק. זיוף = לא אחיד', critical: true },
      { id: 'leather', q: 'עור - ריח עשיר, מרקם אורגני?', tip: 'הרמס/לואי ויטון עור Togo/Epi - מבריק, קר. זיוף = פלסטיק זול', critical: true },
      { id: 'hardware', q: 'חומרה - כבדה, מצופה זהב 24K?', tip: 'מנעולים, תפסים - חייבים להיות כבדים. זיוף = קל ומשוף', critical: true },
      { id: 'logo', q: 'לוגו - חרוט עמוק וחד?', tip: 'הרמס: HERMES PARIS עם נקודות מתחת לאותיות. LV: מונוגרם סימטרי', critical: true },
      { id: 'lining', q: 'בטנה - בד ייעודי עם לוגו פנימי?', tip: 'לואי ויטון בטנת Alcantara חומה. הרמס: עז Chèvre בצבע תואם' },
      { id: 'serial', q: 'מספר סריאלי / Date Code?', tip: 'LV: 4 ספרות באות + עור פנימי. הרמס: חרוט בעור בצורת ◯' },
      { id: 'symmetry', q: 'סימטריה מושלמת בין שני הצדדים?', tip: 'תיק אותנטי = מראה מושלמת. זיוף תמיד אסימטרי במשהו' },
      { id: 'dustbag', q: 'שקית אבק עם לוגו תואם?', tip: 'הרמס: כתום עם פס שחור. שאנל: לבן-שחור, LV: חום' },
      { id: 'price', q: 'מחיר ב-70-90% משוק חוקי?', tip: 'תיק חדש בחצי מחיר = זיוף. מסומש 65-85% מהמחיר הקטלוגי', critical: true },
      { id: 'receipt', q: 'קבלת קנייה מבוטיק רשמי?', tip: 'דורש מספר עסקה, חותמת חנות, תאריך, פרטי המוצר' },
    ],
  },
  gold: {
    name: 'זהב וכסף',
    icon: '✦',
    intro: 'בדיקות פיזיקליות פשוטות - אסור לוותר עליהן',
    items: [
      { id: 'hallmark', q: 'תג מעצב/קראט (750/925/916) חרוט?', tip: '750=18K, 585=14K, 999=24K, 925=Sterling Silver. ללא תג = חשד', critical: true },
      { id: 'magnet', q: 'בוחן מגנט - לא נמשך?', tip: 'זהב וכסף לא מגנטיים. אם נמשך = מתכת עטופה זהב', critical: true },
      { id: 'weight', q: 'משקל סביר ביחס לגודל?', tip: 'זהב צפיפות 19.3 - כבד מאוד. כסף 10.5. השוו לטבלה' },
      { id: 'acid-test', q: 'בדיקת חומצה (ערכת זהבן)?', tip: 'מטפטפים על המתכת - תגובה מאמתת קראט. דורש ערכה (~₪80)' },
      { id: 'sound', q: 'צליל - בקשה/מטבע מצלצל ממושכות?', tip: 'כסף אמיתי "מצלצל" יפה כמו פעמון. זיוף = צליל עמום' },
      { id: 'patina', q: 'פטינה / כסף משחיר עם הזמן?', tip: 'כסף אמיתי משחיר אם לא מנקים. זיוף נשאר בוהק תמיד' },
      { id: 'density', q: 'בדיקת צפיפות במים (ארכימדס)?', tip: 'משקילים יבש + טבול במים. נוסחה נותנת צפיפות. השוו לטבלה' },
      { id: 'maker', q: 'תג יצרן/מותג מוכר?', tip: 'תכשיטי יוקרה: Cartier, Tiffany. ישראלי: H. Stern, Yvel' },
      { id: 'price', q: 'מחיר ב-90%+ ממחיר השוק?', tip: 'זהב גרם בערך לפי ספוט. הצעה ב-50% = זיוף', critical: true },
    ],
  },
  diamond: {
    name: 'יהלומים',
    icon: '◆',
    intro: 'בעיקר: טבעי vs מעבדה (CVD/HPHT). מעבדה זול ב-70-80% מטבעי',
    items: [
      { id: 'gia-cert', q: 'תעודת GIA / IGI מקורית?', tip: 'כל יהלום מעל 0.5ct - דרשו תעודה. ללא תעודה = ערך חצי', critical: true },
      { id: 'gia-engraved', q: 'מספר תעודה חרוט בלייזר על המכלולים?', tip: 'GIA חורט מספר על girdle. דרוש מיקרוסקופ x10 לראיה' },
      { id: 'fog-test', q: 'מבחן ערפל - מתפוגג מיידית?', tip: 'נושפים על האבן - יהלום אמיתי מתבהר תוך שניה. זיוף = נשאר ערפל' },
      { id: 'fluorescence', q: 'פלואורסנציה תחת UV?', tip: 'כ-30% מהיהלומים זוהרים כחול תחת UV. סימן טוב לאמיתי' },
      { id: 'lab-grown', q: 'מעבדה - תווית "LG" בתעודה?', tip: 'IGI/GIA מסמנים LAB GROWN במפורש. אם חסר - בדוק שוב', critical: true },
      { id: 'inclusions', q: 'כתמים פנימיים נראים תחת לופה x10?', tip: 'יהלום טבעי כמעט תמיד עם כתם קטן. מושלם לחלוטין = חשוד' },
      { id: 'color-bg', q: 'צבע ל-G+ ללא BGM?', tip: 'BGM = Brown/Green/Milky tints. פוגעים בערך ב-20-40%' },
      { id: 'symmetry', q: 'סימטריה - חיתוך Excellent?', tip: 'GIA מעריך Cut: Excellent / VG / Good. EX משלם פרמיה 10-15%' },
      { id: 'price-rap', q: 'מחיר תואם מחיר רפפורט?', tip: 'Rapaport = רשימת מחירי שוק שבועית. הצעה ב-60% מטה = חשד' },
    ],
  },
  sefarim: {
    name: 'ספרי קודש עתיקים',
    icon: '📜',
    intro: 'דפוסים, חתימות, נייר - כל פרט חשוב',
    items: [
      { id: 'imprint', q: 'דף שער - מקום + שנת הדפסה?', tip: 'ויניציאה (וונציה), אמשטרדם, וילנא, וורשא - דפוסים יקרים', critical: true },
      { id: 'paper', q: 'נייר תקופתי - מרקם, צהיבות?', tip: 'נייר ‏400+ שנה - גס, מעט שקוף, "watermark" של בית הדפוס' },
      { id: 'binding', q: 'כריכת עור/קלף תקופתית?', tip: 'כריכת עור גס מקורית = ערך מוסף. כריכה חדשה = ערך נמוך' },
      { id: 'signatures', q: 'חתימות בעלים / הגהות יד?', tip: 'חתימת רב מפורסם = ערך פי 10. בדוק אצל מומחה כתב יד', critical: true },
      { id: 'completeness', q: 'שלמות הספר - דפים חסרים?', tip: 'גם דף שער חסר = ירידה משמעותית בערך. ספרו דפים' },
      { id: 'censorship', q: 'סימני צנזורה (קווים שחורים)?', tip: 'דווקא סימני צנזורה = הוכחה לתקופה - מוסיפים אותנטיות' },
      { id: 'haskama', q: 'הסכמות רבנים בתחילת הספר?', tip: 'הסכמות מקוריות מרבנים מפורסמים מוסיפות לערך' },
      { id: 'price', q: 'בדיקה ב-Bidspirit / Kedem בעבר?', tip: 'מאגר מכירות פומביות יהודיות - ‏מציג מחירי עבר על אותו ספר' },
    ],
  },
  judaica: {
    name: 'יודאיקה ועתיקות',
    icon: '🕎',
    intro: 'תקופה, חומר, סגנון אזורי - מפתחות לאותנטיות',
    items: [
      { id: 'silver-mark', q: 'סימן כסף (800/925) + סימן בודק?', tip: 'יודאיקה גרמנית/אוסטרית - סימוני state. רוסי: kokoshniki', critical: true },
      { id: 'patina', q: 'פטינה טבעית - אחידה ועמוקה?', tip: 'פטינה אמיתית 50+ שנה - לא מתפזרת בניקוי. זיוף "מזדקן" יורד' },
      { id: 'maker', q: 'חתימת אומן / סדנה?', tip: 'בצלאל ירושלים, Rosenthal, Posen, Bachrich = שמות יוקרתיים', critical: true },
      { id: 'period', q: 'סגנון תקופתי תואם (ארט נובו, ביידרמייר)?', tip: 'חנוכייה Art Nouveau ≠ סגנון בארוקי. אנכרוניזם = זיוף' },
      { id: 'wear', q: 'שחיקה במקומות לוגיים?', tip: 'ידיות, נקודות אחיזה - שחוקים יותר. שחיקה אחידה = חשד' },
      { id: 'soldering', q: 'חיבורים - הלחמה תקופתית?', tip: 'הלחמה ישנה = כסף עבה, אטית. מודרנית = כסף דק, מבריק' },
      { id: 'origin', q: 'מקור / היסטוריה תיעודית?', tip: 'תמונות ישנות, רישומים, ירושה משפחתית = מוסיף ערך' },
      { id: 'price', q: 'בדיקה ב-Sotheby\'s / Christie\'s עבר?', tip: 'מכירות עבר של בית מכירות גדול = הוכחה לערך' },
    ],
  },
  coin: {
    name: 'מטבעות נומיסמטיים',
    icon: '🪙',
    intro: 'משקל, חומר, חריטה - כל פרט קובע',
    items: [
      { id: 'weight-spec', q: 'משקל מדויק תואם מפרט?', tip: 'כל מטבע = משקל ידוע. חרגה ‏‎>‎0.1g = חשד', critical: true },
      { id: 'edge', q: 'קצה (Edge) - תווים/חירוץ תואמים?', tip: 'מטבעות זהב/כסף - קצה מחורץ או עם כתובת. חלק = חשד' },
      { id: 'magnet', q: 'בוחן מגנט - לא נמשך לזהב/כסף?', tip: 'אסור שמטבע זהב/כסף יימשך למגנט', critical: true },
      { id: 'mint-mark', q: 'סימן מטבעה (Mint mark)?', tip: 'אות קטנה ליד התאריך - מציינת איפה הוטבע. חיוני לערך' },
      { id: 'date-detail', q: 'פרטי תאריך חדים וברורים?', tip: 'מתחת זכוכית מגדלת - ספרות חדות, ‏לא מטושטשות' },
      { id: 'patina-coin', q: 'פטינה אחידה / טבעית?', tip: 'מטבע נחושת/ארד - פטינה ירוקה-חומה אחידה. זיוף = כתמים' },
      { id: 'sound', q: 'צליל זהב/כסף בנקישה?', tip: 'מטבע אמיתי - "פעמון" צלול. מתכת חיקוי = צליל מעוך' },
      { id: 'pcgs-ngc', q: 'בעטיפה PCGS / NGC / ICCS?', tip: 'בתי דירוג בינלאומיים - המטבע סגור עם דירוג. מאמת אותנטיות', critical: true },
      { id: 'rarity', q: 'נדירות אמיתית (Krause catalog)?', tip: 'מטבע "נדיר" שמוצע הרבה = לא נדיר. בדוק במאגר' },
    ],
  },
  art: {
    name: 'יצירות אומנות',
    icon: '🎨',
    intro: 'אותנטיות יצירת אומנות = מקצועי ויקר. רק לוודא לפני קנייה גדולה',
    items: [
      { id: 'signature', q: 'חתימת האמן - מיקום + סגנון תואם?', tip: 'כל אמן עם סגנון חתימה ייחודי. השוו ל-catalogue raisonné', critical: true },
      { id: 'provenance', q: 'תיעוד היסטוריית בעלות (Provenance)?', tip: 'מסמכים, תצלומים, קבלות. שרשרת בעלות עוקבת = מאמת', critical: true },
      { id: 'canvas', q: 'בד / נייר תקופתי?', tip: 'בד פשתן ישן ≠ בד מודרני. ניתן לבדוק במעבדה (yarn count)' },
      { id: 'paint-age', q: 'גיל הצבע - סדקים (craquelure) טבעיים?', tip: 'שמן 100+ שנה - סדקים עדינים אופייניים. זיוף = ללא סדקים' },
      { id: 'frame', q: 'מסגרת תקופתית מקורית?', tip: 'מוסיפה ל-15-30% מהערך. מסגרת חדשה = איבדה את המקור' },
      { id: 'expert', q: 'בדיקת מומחה (UV/IR/Carbon)?', tip: 'בדיקות מעבדה לאמת תקופה. בלי זה - אין ערוב מלא', critical: true },
      { id: 'auction', q: 'מופיע בסוטבי\'ס/כריסטיס/ת"א?', tip: 'מאגרי מכירות פומביות - עוקבים אחר ערך אמיתי' },
    ],
  },
  sneakers: {
    name: 'נעלי ספורט (Air Jordan, Yeezy)',
    icon: '👟',
    intro: 'תפרים, גלגלים, תוויות פנימיות - כל פרט',
    items: [
      { id: 'box-label', q: 'תווית קופסה - גודל, צבע, פונט תואם?', tip: 'נייקי: SKU 9 ספרות במבנה XXX-XXX. תווית בצד הקופסה', critical: true },
      { id: 'sku-shoe', q: 'תווית פנימית בנעל תואמת לקופסה?', tip: 'SKU + גודל בתווית פנימית = חייבים תואם לקופסה' },
      { id: 'stitching-snk', q: 'תפרים - אחידים וצפופים?', tip: 'נייקי אמיתי: תפרים ישרים, ללא חוטים תלויים. זיוף = רשלני', critical: true },
      { id: 'glue', q: 'דבק - נקי, ללא שאריות?', tip: 'נעלי יוקרה - דבק מקצועי. זיוף = שאריות דבק לבן/חום' },
      { id: 'sole-pattern', q: 'דוגמת סוליה תואמת מודל מקור?', tip: 'כל מודל - דוגמת סוליה ייחודית. בדוק תמונות רשמיות' },
      { id: 'logo-snk', q: 'לוגו Swoosh/Adidas - חד וסימטרי?', tip: 'נייקי: Swoosh עם זווית ספציפית. אדידס: 3 פסים שווים' },
      { id: 'weight-snk', q: 'משקל סביר (לא קל מדי)?', tip: 'נעל אמיתית בעלת חומר איכותי = כבדה יחסית' },
      { id: 'smell', q: 'ריח עור/גומי איכותי, לא כימי חזק?', tip: 'זיוף סיני = ריח כימי חזק (פלסטיק/דבק זול). מקור = ריח עור נעים' },
      { id: 'price-snk', q: 'מחיר 70%+ ממחיר StockX?', tip: 'StockX = שוק שני אמין. הצעה ב-50% מ-StockX = חשד גבוה', critical: true },
      { id: 'receipt-snk', q: 'קבלה מחנות רשמית/StockX?', tip: 'StockX מנפיק תעודת אותנטיות. גם Goat ו-Stadium Goods' },
    ],
  },
  electronics: {
    name: 'טלפונים ואלקטרוניקה',
    icon: '📱',
    intro: 'IMEI, מסך, חיבורים - כל סימן חשוב',
    items: [
      { id: 'imei', q: 'IMEI מודבק תואם הגדרות?', tip: 'הגדרות → כללי → IMEI. השווה למדבקה מאחור ולקופסה. 3 חייבים תואמים', critical: true },
      { id: 'imei-check', q: 'בדיקת IMEI ב-imei.info / Apple GSX?', tip: 'מאגר רשמי - מאמת אם המכשיר מקורי, מסטוס אחריות, מודל מדויק', critical: true },
      { id: 'screen-quality', q: 'מסך - חדות, צבעים, ללא ‏artifacts?', tip: 'אייפון אמיתי: צבעים מדויקים, ללא הילה. זיוף = פיקסליות, צבעים שטוחים', critical: true },
      { id: 'apple-id', q: 'אייפון - לא נעול ל-iCloud של מישהו?', tip: 'הפעלה מחדש - אם דורש Apple ID זר = פטור גנוב', critical: true },
      { id: 'connectors', q: 'מחבר Lightning/USB-C מקורי?', tip: 'אפל: מחבר מתכת איכותי. זיוף = פלסטיק רע, חיבור רעוע' },
      { id: 'sound', q: 'רמקולים - צליל נקי בלי חיתוך?', tip: 'בדוק שיר באמצע. זיוף = רמקול פצפץ, חיתוכים' },
      { id: 'haptic', q: 'הרגשת ויברציה - חדה לא מורגעת?', tip: 'אייפון 11+: Taptic Engine - חזק וחד. זיוף = ויברציה רגילה' },
      { id: 'battery-health', q: 'בריאות סוללה > 80%?', tip: 'הגדרות → סוללה → בריאות. מתחת ל-80% = החלפת סוללה בקרוב' },
      { id: 'price-elec', q: 'מחיר 70%+ ממחיר אמזון/יד2?', tip: 'אייפון 15 חדש = ₪4500. מחיר 1500 = זיוף 100%', critical: true },
    ],
  },
  vehicle: {
    name: 'רכב משומש',
    icon: '🚗',
    intro: 'בדיקה לפני קנייה - חוסך עשרות אלפי שקלים',
    items: [
      { id: 'vin-check', q: 'מספר שלדה (VIN) תואם רישיון?', tip: '17 ספרות מתחת לשמשה הקדמית. חייב להיות זהה ברישיון רכב', critical: true },
      { id: 'history', q: 'היסטוריית טיפולים מלאה?', tip: 'מוסכים מורשים - חותמות בכל טיפול. חוסר = ‏סימן רע' },
      { id: 'accidents', q: 'בדיקה לתאונות באתר משרד התחבורה?', tip: 'אתר תחבורה.gov.il → בדיקת רכב. כל פגיעה רשומה', critical: true },
      { id: 'mileage', q: 'קילומטראז\' תואם גיל הרכב?', tip: 'ממוצע 20K ק"מ לשנה. אם רכב 10 שנה = ~200K ק"מ. חצי = חשד' },
      { id: 'paint', q: 'צבע אחיד בכל הפנלים?', tip: 'הבדל גוון = צבע מחדש = תאונה. השתמש ב-app מד עובי צבע (חינם)' },
      { id: 'underbody', q: 'תחתית - חלודה / נזילות?', tip: 'דורש מכון בדיקה. חלודה = ירידה ב-30% מהערך. נזילות = תיקון יקר' },
      { id: 'engine-sound', q: 'מנוע - ריצה חלקה ושקטה?', tip: 'הקפד: ריצה חמה (15 דק\'), בלי רעידות, בלי עשן כחול/לבן' },
      { id: 'gearbox', q: 'תיבת הילוכים - מעבר חלק?', tip: 'אוטומט: מעברים בלי קפיצות. ידני: סנכרון תקין, ללא רעש מצמד' },
      { id: 'wear-tires', q: 'צמיגים - שחיקה אחידה?', tip: 'שחיקה לא אחידה = ‏בעיות בכוונון/בלמים/מתלים' },
      { id: 'price-vehicle', q: 'מחיר במסגרת מחיר ‏לוי יצחק?', tip: 'levyitzhak.co.il - מחירון רכבים רשמי בישראל. הצעה ב-30% מתחת = חשד', critical: true },
    ],
  },
  perfume: {
    name: 'בשמי יוקרה',
    icon: '🌹',
    intro: 'אריזה, קוד אצווה, ריח - מפתחות לאותנטיות',
    items: [
      { id: 'box-shrink', q: 'אריזה עטופה בניילון מקורי הדוק?', tip: 'בשם חדש = ניילון הדוק לקופסה. רפוי = פתחו או זיוף', critical: true },
      { id: 'batch-code', q: 'קוד אצווה - חרוט בתחתית הבקבוק?', tip: 'בדוק ב-checkfresh.com / checkcosmetic.net. מאמת תאריך ייצור' },
      { id: 'spray-quality', q: 'ריסוס דק ואחיד?', tip: 'בשם אמיתי = ריסוס מיקרו, ענן עדין. זיוף = טיפות גדולות' },
      { id: 'liquid-color', q: 'צבע נוזל תואם בדיוק לתמונות?', tip: 'אצל יצרן - בקרת איכות חמורה. גוון שונה = זיוף', critical: true },
      { id: 'smell-stage', q: 'פירמידה אמיתית (Top → Heart → Base)?', tip: 'בשם איכותי - מתפתח לאורך 2-4 שעות. זיוף = ריח שטוח קבוע' },
      { id: 'longevity', q: 'אורך חיים 6+ שעות על העור?', tip: 'EDP אמיתי: 6-10 שעות. זיוף: 1-2 שעות בלבד', critical: true },
      { id: 'cap-fit', q: 'פקק - מתאים בדיוק לבקבוק?', tip: 'מקור: פקק כבד, קליק חזק. זיוף: רופף, פלסטיק זול' },
      { id: 'serial-perfume', q: 'מספר סדרתי תואם בקופסה ובבקבוק?', tip: 'יצרנים גדולים מסמנים בשני המקומות. אי-התאמה = זיוף' },
      { id: 'price-perfume', q: 'מחיר 70-90% ממחיר Sephora?', tip: 'בשם 100ml ב-30% מתחת לסניף = זיוף. גם דיוטי פרי לא זול ב-50%', critical: true },
    ],
  },
};

let currentAuthCategory = null;
let authResults = {};

function openAuthChecker(category) {
  currentAuthCategory = category;
  authResults = {};
  renderAuthChecker();
}

function renderAuthChecker() {
  const cat = AUTH_CHECKLISTS[currentAuthCategory];
  if (!cat) return;

  const passedCount = Object.values(authResults).filter(v => v === 'pass').length;
  const failedCount = Object.values(authResults).filter(v => v === 'fail').length;
  const criticalFailed = cat.items
    .filter(item => item.critical && authResults[item.id] === 'fail')
    .length;

  // Calculate authenticity score
  const totalItems = cat.items.length;
  const answeredCount = Object.keys(authResults).length;
  const score = answeredCount === 0 ? null :
                criticalFailed >= 2 ? 0 :
                criticalFailed >= 1 ? 25 :
                Math.round((passedCount / totalItems) * 100);

  let verdict = '';
  let verdictClass = '';
  if (score === null) {
    verdict = 'התחל לסמן כל בדיקה';
    verdictClass = 'pending';
  } else if (criticalFailed >= 2) {
    verdict = '🚨 סבירות גבוהה לזיוף - אל תקנה';
    verdictClass = 'fake';
  } else if (criticalFailed >= 1) {
    verdict = '⚠ דגל אדום קריטי - דרוש בדיקה מקצועית';
    verdictClass = 'warning';
  } else if (score >= 85) {
    verdict = '✓ סבירות גבוהה לאמיתי';
    verdictClass = 'genuine';
  } else if (score >= 60) {
    verdict = '~ אמיתות בינונית - שווה לבדוק עוד';
    verdictClass = 'medium';
  } else {
    verdict = '⚠ דגלים אדומים - חשד לזיוף';
    verdictClass = 'warning';
  }

  $('#auth-view').innerHTML = `
    <div class="auth-header">
      <div class="auth-icon">${cat.icon}</div>
      <h3>בדיקת אמיתות: ${cat.name}</h3>
    </div>
    <div class="auth-intro">${cat.intro}</div>

    ${score !== null ? `
      <div class="auth-verdict auth-verdict-${verdictClass}">
        <div class="auth-score">${score}<span>%</span></div>
        <div class="auth-verdict-text">${verdict}</div>
        <div class="auth-stats">
          <span>✓ ${passedCount}</span>
          <span>✗ ${failedCount}</span>
          <span>○ ${totalItems - answeredCount}</span>
        </div>
      </div>
    ` : ''}

    <div class="auth-items">
      ${cat.items.map(item => {
        const status = authResults[item.id];
        return `
          <div class="auth-item ${status ? `auth-item-${status}` : ''}">
            <div class="auth-q">
              ${item.critical ? '<span class="auth-critical">קריטי</span>' : ''}
              ${escapeHtml(item.q)}
            </div>
            <div class="auth-tip">💡 ${escapeHtml(item.tip)}</div>
            <div class="auth-buttons">
              <button class="auth-btn auth-pass ${status === 'pass' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="pass">✓ עובר</button>
              <button class="auth-btn auth-fail ${status === 'fail' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="fail">✗ נכשל</button>
              <button class="auth-btn auth-skip ${status === 'skip' ? 'active' : ''}" data-auth-id="${item.id}" data-auth-val="skip">⊘ דלג</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    ${score !== null && score > 0 ? `
      <div class="auth-actions">
        <button class="btn-primary" id="btn-auth-save">💾 שמור דוח אותנטיות</button>
        <button class="btn-secondary" id="btn-auth-reset">↻ איפוס</button>
      </div>
    ` : ''}
  `;

  $$('.auth-btn').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.authId;
      const val = b.dataset.authVal;
      // Toggle: clicking same value clears it
      if (authResults[id] === val) {
        delete authResults[id];
      } else {
        authResults[id] = val;
      }
      renderAuthChecker();
    });
  });

  $('#btn-auth-reset')?.addEventListener('click', () => {
    if (confirm('לאפס את כל הבדיקות?')) {
      authResults = {};
      renderAuthChecker();
    }
  });

  $('#btn-auth-save')?.addEventListener('click', () => {
    const name = prompt('שם הפריט שנבדק:');
    if (!name) return;
    const opp = {
      id: uid(),
      name,
      category: 'general',
      status: 'watching',
      created: Date.now(),
      notes: `דוח אמיתות ${cat.name}\nציון: ${score}%\nמסקנה: ${verdict}\n\n${cat.items.map(item => {
        const s = authResults[item.id];
        if (!s) return '';
        const symbol = s === 'pass' ? '✓' : s === 'fail' ? '✗' : '○';
        return `${symbol} ${item.q}`;
      }).filter(Boolean).join('\n')}`,
      authReport: { category: currentAuthCategory, score, verdict, results: { ...authResults } },
    };
    state.opportunities.unshift(opp);
    Storage.save('opportunities', state.opportunities);
    toast('✓ דוח נשמר בפנקס', 'success');
    authResults = {};
    renderAuthChecker();
  });
}

function renderAuthHubView() {
  const c = $('#auth-hub-view');
  if (!c) return;
  c.innerHTML = `
    <div class="auth-intro-main">
      <div style="font-size:48px;text-align:center;margin-bottom:8px">🔍</div>
      <h3 style="text-align:center;margin-bottom:8px">בדיקת אמיתות vs זיוף</h3>
      <div class="text-faint" style="text-align:center;font-size:13px;margin-bottom:20px">
        בחר סוג מוצר לבדיקה. תקבל צ'קליסט מקצועי + ציון אמיתות + דוח לשמירה
      </div>
    </div>
    <div class="hub-grid">
      ${Object.entries(AUTH_CHECKLISTS).map(([k, v]) => `
        <button class="hub-card" data-auth-cat="${k}">
          <div class="hc-icon">${v.icon}</div>
          <div class="hc-name">${v.name}</div>
          <div class="hc-desc">${v.items.length} נקודות בדיקה</div>
        </button>
      `).join('')}
    </div>
  `;
  $$('.hub-card[data-auth-cat]').forEach(b => {
    b.addEventListener('click', () => {
      $('#auth-hub-view').hidden = true;
      $('#auth-checker-view').hidden = false;
      openAuthChecker(b.dataset.authCat);
    });
  });
}


// Wire auth checker back button
(function wireAuth() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(wireAuth, 600));
    return;
  }
  setTimeout(() => {
    document.addEventListener('click', e => {
      if (e.target.id === 'btn-back-to-auth-hub') {
        $('#auth-checker-view').hidden = true;
        $('#auth-hub-view').hidden = false;
      }
    });
  }, 600);
})();

