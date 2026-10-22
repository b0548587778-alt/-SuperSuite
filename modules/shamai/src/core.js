'use strict';
// ============================================================================
//  שמאי v2.0 — Multi-domain trader platform
// ============================================================================


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
  explainOpen: false,    // פאנל "מאין הסכום?" — נשאר פתוח בין חישובים (src/explain.js)

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

// תמונות פריטים — במחסן המוצפן (localStorage שהמעטפת מחליפה, PLAN.md 3.2), ולכן גם בגיבוי.
// בעבר נשמרו ב-IndexedDB גלוי ומחוץ לגיבוי: תמונה ישנה מועברת בפעם הראשונה שהיא נטענת,
// ונמחקת משם רק אחרי שנשמרה במחסן.
const IMAGE_MAX_CHARS = 400 * 1024;          // תמונה חדשה — אחרי הקטנה (caseCompressImage)
const IMAGE_LEGACY_MAX_CHARS = 4 * 1024 * 1024; // תמונה ישנה מ-IndexedDB, שנשמרה בלי הקטנה
const isImageData = (s, max = IMAGE_MAX_CHARS) =>
  typeof s === 'string' && s.length <= max && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);

const ImageDB = {
  key: (id) => 'img_' + id,
  // ---------- IndexedDB הישן: קריאה ומחיקה בלבד ----------
  legacyDb: null,
  legacyOpen() {
    if (this.legacyDb) return Promise.resolve(this.legacyDb);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = indexedDB.open('shamai_images', 1);
      req.onerror = () => resolve(null);
      req.onsuccess = () => { this.legacyDb = req.result; resolve(this.legacyDb); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
    });
  },
  async legacyGet(id) {
    const db = await this.legacyOpen();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction('images', 'readonly').objectStore('images').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  },
  async legacyDelete(id) {
    const db = await this.legacyOpen();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  },
  // ---------- המחסן ----------
  store(id, dataUrl, max) {
    if (!isImageData(dataUrl, max)) throw new Error('התמונה אינה תקינה או גדולה מדי');
    Storage.save(this.key(id), dataUrl);
    if (Storage.load(this.key(id), null) !== dataUrl) throw new Error('אין מקום לשמור את התמונה');
  },
  async save(id, dataUrl) { this.store(id, dataUrl, IMAGE_MAX_CHARS); },
  async load(id) {
    const s = Storage.load(this.key(id), null);
    if (isImageData(s, IMAGE_LEGACY_MAX_CHARS)) return s;
    const old = await this.legacyGet(id);
    if (!isImageData(old, IMAGE_LEGACY_MAX_CHARS)) return null;
    try { this.store(id, old, IMAGE_LEGACY_MAX_CHARS); await this.legacyDelete(id); } catch (e) { /* נשאר בישן, ננסה בפעם הבאה */ }
    return old;
  },
  async delete(id) {
    Storage.remove(this.key(id));
    await this.legacyDelete(id);
  },
  // בעלייה: מעבירים את כל התמונות הישנות, גם כאלה שלא יוצגו. אחת-אחת, ושגיאה לא עוצרת את השאר
  async migrateAll(ids) {
    let moved = 0;
    for (const id of ids || []) {
      if (isImageData(Storage.load(this.key(id), null), IMAGE_LEGACY_MAX_CHARS)) continue;
      try { if (await this.load(id)) moved++; } catch (e) { /* ננסה בפעם הבאה */ }
    }
    return moved;
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

// אין שליפת מחירים מהרשת: האפליקציה פועלת אופליין (CLAUDE.md, כלל 6). המחירים מוזנים ידנית או מקובץ (src/prices.js).
// פותח את לוח עדכון המחירים במסך הבית
function openPricePanel() {
  if (typeof switchView === 'function' && state.view !== 'dashboard') switchView('dashboard');
  const panel = document.getElementById('price-panel');
  if (!panel) return;
  panel.open = true;
  if (typeof renderPricePanel === 'function') renderPricePanel();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('pp-gold')?.focus(), 300);
}
