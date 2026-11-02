'use strict';
// ============================================================================
//  שמאי v2.0 — Multi-domain trader platform
// ============================================================================


// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS & DATA
// ─────────────────────────────────────────────────────────────────────────────

const TROY_OZ = 31.1035;     // grams in a troy ounce
const POUND   = 0.4535924;   // grams in a pound (avoirdupois) - for industrial metals

// מספר מהקלדה ← מחרוזת עם נקודה עשרונית, או null. משותף למשקלים, למחירים ולסכומים, כדי שפסיק ייקרא
// אותו דבר בכל שדה: פסיק לפני קבוצות של 3 ספרות = מפריד אלפים ("1,000" ← 1000), פסיק יחיד אחר = נקודה
// עשרונית ("4665,5" ← 4665.5). פעם "1,000" גרם נקרא כגרם אחד, ו-"4665,5" במחיר — כ-46655
function normalizeNumText(raw, strip = /[\s₪$]/g) {
  const s = String(raw ?? '').trim().replace(strip, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return s.replace(/,/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return s;
  if (/^\d+,\d+$/.test(s)) return s.replace(',', '.');
  return null;
}

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

// Scrap / industrial metals (approximate $/lb prices).
// base — המחיר בלוח המחירים שממנו נגזר הסוג (המחיר כאן ביחס לברירת המחדל של הלוח, DEFAULT_PRICES); בלי base — ערך ייחוס קבוע
const SCRAP_TYPES = [
  { k: 'copper-bare',   name: 'נחושת חשופה',    pricePerLb: 4.20, dealerMargin: 0.75, base: 'copper' },
  { k: 'copper-1',      name: 'נחושת #1',       pricePerLb: 4.00, dealerMargin: 0.72, base: 'copper' },
  { k: 'copper-2',      name: 'נחושת #2',       pricePerLb: 3.70, dealerMargin: 0.70, base: 'copper' },
  { k: 'brass',         name: 'פליז',           pricePerLb: 2.80, dealerMargin: 0.70, base: 'copper' },
  { k: 'aluminum-clean',name: 'אלומיניום נקי',  pricePerLb: 1.10, dealerMargin: 0.65, base: 'aluminum' },
  { k: 'aluminum-cans', name: 'פחיות אלומ.',    pricePerLb: 0.55, dealerMargin: 0.60, base: 'aluminum' },
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

// מדרגות מס רכישה (בשקלים) — טבלה מובנית לשנת 2025, לא מאומתת: הערכה בלבד, כמו טבלת השכר בארגז הכלים.
// החישוב — calcPurchaseTax ב-tools.js. במודול הכלכלי אין מדרגות מובנות (מוקלדות לכל שנה)
const PURCHASE_TAX_TABLE = { year: 2025, verified: false };
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
  coin:    { era: 'israel', name: '', year: null, metal: 'silver', weight: null, purity: 900, grade: 'XF', premium: 1.5, market: null, asking: null },
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
    sellerKey: null, // "עסקאות" של איש קשר (showLedgerSearch)
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

  // כתיבה שנדחתה: ה-localStorage של SuperSuite זורק כשהמחסן לא קיבל אותה (אין מקום, אין כניסה, צפייה בלבד).
  // פעם השגיאה נבלעה והמסך הציג "נשמר" (בדיקת קוד 23.10.2026, ממצא 3) — עכשיו הודעה, ו"נשמר" שמיד אחריה לא מסתיר אותה
  lastError: '',
  failedAt: 0,
  failed(e, quiet) {
    const msg = e && typeof e.message === 'string' && /[֐-׿]/.test(e.message) ? e.message
      : e && e.name === 'QuotaExceededError' ? 'השינוי לא נשמר: אין מקום באחסון' : 'השינוי לא נשמר';
    Storage.lastError = msg;
    if (quiet) return;
    Storage.failedAt = Date.now();
    try { toast(msg, 'error'); } catch (_) { /* בלי מסך */ }
  },
  // true — המחסן קיבל את הכתיבה. quiet — בלי הודעה (העברה ברקע)
  save(key, val, { quiet = false } = {}) {
    try { localStorage.setItem(Storage.k(key), JSON.stringify(val)); return true; }
    catch (e) { console.error('Save failed', key, e); Storage.failed(e, quiet); return false; }
  },
  load(key, fallback = null) {
    try {
      const raw = localStorage.getItem(Storage.k(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  remove(key) {
    try { localStorage.removeItem(Storage.k(key)); return true; }
    catch (e) { console.error('Remove failed', key, e); Storage.failed(e); return false; }
  },
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
  async legacyOpen() {
    if (this.legacyDb) return this.legacyDb;
    if (typeof indexedDB === 'undefined') return null;
    // התקנה שלא היה בה מאגר ישן — לא יוצרים מאגר ריק רק כדי לבדוק או למחוק
    try {
      if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some(d => d && d.name === 'shamai_images')) return null;
    } catch (e) { /* פותחים כרגיל */ }
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
  // מזהה אחד או רשימה — בעסקה אחת
  async legacyDelete(ids) {
    const db = await this.legacyOpen();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('images', 'readwrite');
        const st = tx.objectStore('images');
        for (const id of [].concat(ids)) st.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  },
  // ---------- המחסן ----------
  // נשמר רק אם המחסן אישר את הכתיבה (אחרת localStorage זורק) והערך שבו הוא באמת התמונה
  store(id, dataUrl, max, quiet = false) {
    if (!isImageData(dataUrl, max)) throw new Error('התמונה אינה תקינה או גדולה מדי');
    if (!Storage.save(this.key(id), dataUrl, { quiet })) throw new Error(Storage.lastError);
    if (Storage.load(this.key(id), null) !== dataUrl) throw new Error('אין מקום לשמור את התמונה');
  },
  async save(id, dataUrl) { this.store(id, dataUrl, IMAGE_MAX_CHARS); },
  // תמונה ישנה למחסן, ברקע (בלי הודעה). true — המחסן קיבל אותה; הישן עוד לא נמחק
  moveLegacy(id, old) {
    try { this.store(id, old, IMAGE_LEGACY_MAX_CHARS, true); return true; } catch (e) { return false; }
  },
  // אישור שהמחסן כתוב בקובץ (ולא רק בזיכרון של התהליך הראשי, שכותב לדיסק באיחור קצר). המפתח השמור הזה
  // מתורגם ב-localStorage של SuperSuite לכתיבה מיידית, שזורקת אם נכשלה (shell/secure-ls-preload.js);
  // בדפדפן רגיל — מחיקה של מפתח שלא קיים
  flushStore() {
    try { localStorage.removeItem('\u0000ss-flush'); return true; } catch (e) { return false; }
  },
  async load(id) {
    const s = Storage.load(this.key(id), null);
    if (isImageData(s, IMAGE_LEGACY_MAX_CHARS)) return s;
    const old = await this.legacyGet(id);
    if (!isImageData(old, IMAGE_LEGACY_MAX_CHARS)) return null;
    // הישן נמחק רק אחרי שהמחסן אישר וכתב לדיסק — כתיבה שנדחתה או קובץ שלא נכתב משאירים אותו לפעם הבאה
    if (this.moveLegacy(id, old) && this.flushStore()) await this.legacyDelete(id);
    return old;
  },
  // false — המחסן דחה את המחיקה (למשל צפייה בלבד): גם העותק הישן לא נמחק
  async delete(id) {
    if (!Storage.remove(this.key(id))) return false;
    await this.legacyDelete(id);
    return true;
  },
  // בעלייה: מעבירים את כל התמונות הישנות, גם כאלה שלא יוצגו. אחת-אחת, ושגיאה לא עוצרת את השאר.
  // כתיבה אחת לדיסק לכל הסבב, ורק אחריה מוחקים את הישנים — גם של תמונות שכבר במחסן (עותק שנשאר מסבב קודם
  // שבו הכתיבה לקובץ נכשלה). בלי אישור הכתיבה — הישנים נשארים
  async migrateAll(ids) {
    const moved = [];
    const inStore = [];
    for (const id of ids || []) {
      try {
        if (isImageData(Storage.load(this.key(id), null), IMAGE_LEGACY_MAX_CHARS)) { inStore.push(id); continue; }
        const old = await this.legacyGet(id);
        if (isImageData(old, IMAGE_LEGACY_MAX_CHARS) && this.moveLegacy(id, old)) moved.push(id);
      } catch (e) { /* ננסה בפעם הבאה */ }
    }
    if ((moved.length || inStore.length) && this.flushStore()) await this.legacyDelete([...inStore, ...moved]);
    return moved.length;
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
  // שמירה שנדחתה זה עתה: "נשמר" שמגיע אחריה באותה פעולה לא מסתיר את הודעת השגיאה
  if (type !== 'error' && Date.now() - Storage.failedAt < 2600) return;
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
