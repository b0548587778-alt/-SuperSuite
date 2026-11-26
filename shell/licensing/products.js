// קטלוג המוצרים של מרכז הרישוי — מקור אחד לכל התוכנות שמנהל-העל מנפיק להן רישיון מהמסך הזה.
// כל התוכנות בודקות אותו רישיון חתום (license.js — אותו מפתח שורש, אותו שרת רישוי), וכל אחת בודקת רק את התחומים
// שלה. שמות תחומים חוזרים בין מוצרים ('econ', 'tools', 'ai' הם גם ב-SuperSuite וגם ב-SuperSuite לימוד, במשמעות אחרת),
// ולכן ההנפקה וההצעה תמיד לפי מוצר: הבקשה מציינת את המוצר (product), וכל תכנית — את המוצרים שהיא מכסה.
// הרישיון עצמו לא משתנה (שדה חדש ב-payload היה נפסל בגרסאות קודמות — canonical ב-license.js), ולכן גם המוצר
// לא נשמר בו; הוא נשמר אצל מנהל-העל (registry) ובהצעה החתומה.
// בלי require — נארז גם לאנדרואיד
'use strict';

const FAMILIES = [
  { id: 'econ', name: 'כלכלה' },
  { id: 'learn', name: 'לימוד' },
];

const AI_FEATURES = [['ai', 'עוזר חכם — כללים'], ['ai.local', 'עוזר חכם — מודל במחשב'], ['ai.cloud', 'עוזר חכם — שדרוג ענן']];

// features — [מזהה, שם בעברית] בסדר התצוגה. מוצר חדש — כאן בלבד (וגם בתוכנה עצמה: בדיקת התחום שלה)
const PRODUCTS = [
  { id: 'supersuite', name: 'SuperSuite', family: 'econ', features: [
    ['econ', 'מערכת כלכלית (בסיס)'], ['econ.accounting', 'הנהלת חשבונות'], ['econ.npo', 'עמותה ותרומות'], ['econ.gemach', 'גמ"ח'],
    ['econ.chesed', 'חסד וחלוקות'], ['econ.mortgage', 'משכנתאות'], ['econ.mortgage-advisor', 'ייעוץ משכנתאות'], ['econ.mortgage-lab', 'מעבדת תמהיל'],
    ['econ.realestate', 'נדל"ן (שמאות מקרקעין, תיווך ויזמים)'], ['shamai', 'שמאות'], ['tools', 'ארגז כלים'], ...AI_FEATURES,
    // מודולי הלימוד — במהדורה המלאה של SuperSuite (shell/edition.js; החלטת הבעלים 7.11.2026). אותם שמות הם גם תחומים של
    // SuperSuite לימוד (המוצר הנפרד) — כמו 'econ' ו-'tools', השם חוזר בשתי תוכנות, והרישיון תמיד לפי המוצר.
    // במהדורה חלקית (עמותות / נדל"ן / חשבונאות) הם סגורים לפני הרישיון (gate.js), ותכנית של מהדורה כזו לא כוללת אותם (offer.js)
    ['trainer', 'ניהול אימונים'], ['english', 'אנגלית'], ['math', 'חשבון'], ['school', 'ניהול מוסד'],
  ] },
  // SuperSuite לימוד (המאגר SuperSuite-Edu): 'econ' שם = הפלטפורמה (כניסה, משתמשים, רישוי, הגדרות, משימות)
  { id: 'learn', name: 'SuperSuite לימוד', family: 'learn', features: [
    ['econ', 'פלטפורמה (כניסה, משתמשים, משימות)'], ['english', 'אנגלית'], ['math', 'חשבון'], ['school', 'ניהול מוסד'],
    ['trainer', 'ניהול אימונים'], ['tools', 'ארגז כלים'], ...AI_FEATURES,
  ] },
  { id: 'shir-studio', name: 'שיר סטודיו', family: 'learn', features: [['shir-studio', 'שיר סטודיו']] },
  { id: 'vidlearn', name: 'VidLearn', family: 'learn', features: [['vidlearn', 'VidLearn']] },
];

// המוצר שהקוד הזה הוא חלק ממנו. בקשה או הצעה בלי מוצר (מגרסה קודמת) — של SuperSuite
const THIS_PRODUCT = 'supersuite';
const DEFAULT_PRODUCT = 'supersuite';
const ALL_SCOPE = 'all';
const FAMILY_PREFIX = 'family:';

const byId = new Map(PRODUCTS.map(p => [p.id, p]));
const isProduct = (id) => typeof id === 'string' && byId.has(id);
const productOf = (id) => byId.get(id) || null;
const featuresOf = (id) => (byId.has(id) ? byId.get(id).features.map(f => f[0]) : []);
const productName = (id) => (byId.has(id) ? byId.get(id).name : String(id || ''));
const familyName = (id) => (FAMILIES.find(f => f.id === id) || { name: String(id || '') }).name;

// היקף של תכנית: מוצר אחד ('learn'), משפחה ('family:learn') או הכול ('all'). מחזיר את המוצרים, או null כשאינו תקין
function productsOfScope(scope) {
  if (isProduct(scope)) return [scope];
  if (scope === ALL_SCOPE) return PRODUCTS.map(p => p.id);
  if (typeof scope === 'string' && scope.startsWith(FAMILY_PREFIX)) {
    const fam = scope.slice(FAMILY_PREFIX.length);
    const list = PRODUCTS.filter(p => p.family === fam).map(p => p.id);
    return list.length ? list : null;
  }
  return null;
}

function scopeName(scope) {
  if (isProduct(scope)) return productName(scope);
  if (scope === ALL_SCOPE) return 'חבילה — כל התוכנות';
  if (typeof scope === 'string' && scope.startsWith(FAMILY_PREFIX)) return 'חבילת ' + familyName(scope.slice(FAMILY_PREFIX.length));
  return String(scope || '');
}

// כל ההיקפים שאפשר לבחור בתכנית — מוצר בודד, משפחה עם יותר ממוצר אחד, והכול
function scopes() {
  const out = PRODUCTS.map(p => ({ id: p.id, name: p.name, products: [p.id] }));
  for (const f of FAMILIES) {
    const s = FAMILY_PREFIX + f.id;
    const list = productsOfScope(s);
    if (list && list.length > 1) out.push({ id: s, name: scopeName(s), products: list });
  }
  out.push({ id: ALL_SCOPE, name: scopeName(ALL_SCOPE), products: PRODUCTS.map(p => p.id) });
  return out;
}

// בדיקת תחומים מול מוצר: מחזיר הודעה בעברית, או null כשהכול תקין
function checkFeatures(productId, features) {
  if (!isProduct(productId)) return 'המוצר אינו מוכר';
  const known = new Set(featuresOf(productId));
  const list = Array.isArray(features) ? features : [];
  if (!list.length) return `לא נבחר אף תחום ב${productName(productId)}`;
  const extra = list.filter(f => !known.has(f));
  if (extra.length) return `תחומים שאינם של ${productName(productId)}: ${extra.join(', ')}`;
  return null;
}

// מוצר של רישיון ישן (שלא נרשם לו מוצר) — לפי התחומים שלו. שמות שחוזרים בין מוצרים ('econ', 'tools') — SuperSuite
function productOfFeatures(features) {
  const set = new Set(Array.isArray(features) ? features : []);
  // תחום שיש רק ב-SuperSuite (הנהלת חשבונות, עמותה, שמאות...) — SuperSuite, גם כשלצדו מודול לימוד (המהדורה המלאה,
  // או רישיון ישן מהתקופה שהאימונים היו כאן). מודול לימוד בלי תחום כזה — SuperSuite לימוד, כמו קודם
  const learn = new Set(featuresOf('learn'));
  if (featuresOf(DEFAULT_PRODUCT).some(f => set.has(f) && !learn.has(f))) return DEFAULT_PRODUCT;
  if (['english', 'math', 'school', 'trainer'].some(f => set.has(f))) return 'learn';
  const only = (id) => set.size > 0 && [...set].every(f => featuresOf(id).includes(f));
  if (only('shir-studio')) return 'shir-studio';
  if (only('vidlearn')) return 'vidlearn';
  return DEFAULT_PRODUCT;
}

// הקטלוג למסך (JSON פשוט)
function catalog() {
  return {
    thisProduct: THIS_PRODUCT,
    families: FAMILIES.map(f => ({ ...f })),
    products: PRODUCTS.map(p => ({ id: p.id, name: p.name, family: p.family, features: p.features.map(f => [...f]) })),
    scopes: scopes(),
  };
}

module.exports = {
  FAMILIES, PRODUCTS, THIS_PRODUCT, DEFAULT_PRODUCT, ALL_SCOPE, FAMILY_PREFIX,
  isProduct, productOf, featuresOf, productName, familyName, productsOfScope, scopeName, scopes, checkFeatures, productOfFeatures, catalog,
};
