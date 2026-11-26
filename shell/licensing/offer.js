// הצעת מנהל-העל: תכניות (מחיר באגורות, תקופה, תחומים, מכסות) + תקנון בגרסה — חתומים במפתח השורש.
// הלקוח רואה רק הצעה שחתימתה תקינה; השרת גובה רק לפי המחיר שבהצעה החתומה (לא לפי מה שהלקוח שלח).
// מרכז הרישוי (products.js): מנהל-העל עורך "הצעה ראשית" אחת — לכל תכנית היקף (מוצר, משפחה או הכול) ותחומים לכל מוצר.
// ממנה נחתמת הצעה נפרדת לכל מוצר (splitMaster ← createOffer עם product): בהצעה של מוצר רק התכניות שמכסות אותו,
// ו-features של כל תכנית הם התחומים של אותו מוצר — בדיוק המבנה שגרסאות קודמות מכירות. תכנית שמכסה כמה מוצרים
// נושאת גם bundle ({ scope, products, features }) — חתום, כך שההנפקה למוצר הנוסף לפי החבילה נבדקת מול מה ששולם.
const L = require('./license');
const P = require('./products');
// מהדורה (shell/edition.js) היא מאפיין של תכנית של SuperSuite בלבד — בתוך ההצעה הראשית של מרכז הרישוי:
// התכנית מוצעת רק במהדורה שלה (planInEdition), והתחומים שלה ב-SuperSuite רק מאותה מהדורה (cleanEdition).
// בהצעה של תוכנה אחרת (splitMaster) המהדורה לא נכתבת — לתוכנות האחרות אין מהדורות
const Edition = require('../edition');

const OFFER_TYPE = 'supersuite-offer';
const MAX_PLANS = 20;
const MAX_TERMS = 100000;
// התחומים של SuperSuite עצמה (התוכנה הזו) — לתקופת הניסיון (store.js) ולהצעה בלי מוצר (מגרסה קודמת).
// המקור — קטלוג המוצרים (products.js), כולל מודולי הלימוד של המהדורה המלאה (החלטת הבעלים 7.11.2026)
const FEATURES = P.featuresOf(P.THIS_PRODUCT);
// תחומים שהיו במוצר ועברו למוצר אחר: לא מוצעים בהצעה חדשה, אבל הצעה חתומה ישנה שכוללת אותם עדיין מאומתת
// (בלעדי זה תכנית שכל תחומיה ישנים הייתה "בלי אף תחום", וכל ההצעה נפסלת). 'trainer' — המוצר החינוכי הנפרד
// (ריק מאז שהאימונים חזרו למהדורה המלאה — 'trainer' שוב תכונה רגילה, ורישיון ישן שכולל אותו פותח אותה שם)
const LEGACY_FEATURES = [];

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const sameSet = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');

function cleanCommon(p, i) {
  const id = clean(p && p.id, 40) || 'plan-' + (i + 1);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('מזהה תכנית אינו תקין');
  const name = clean(p.name, 60);
  if (!name) throw new Error('לכל תכנית חייב להיות שם');
  // מחיר חסר (null / '' — גם NaN שעבר JSON) אינו 0: אחרת נוצרת תכנית חינם
  const rawPrice = p.priceAgorot;
  const priceAgorot = typeof rawPrice === 'number' || (typeof rawPrice === 'string' && rawPrice.trim()) ? Number(rawPrice) : NaN;
  if (!Number.isSafeInteger(priceAgorot) || priceAgorot < 0 || priceAgorot > 100000000) throw new Error(`המחיר בתכנית "${name}" אינו תקין`);
  const months = Number(p.months);
  if (!Number.isSafeInteger(months) || months < 12 || months > 60) throw new Error(`התקופה בתכנית "${name}" אינה תקינה — הרישיון שנתי (12–60 חודשים)`);
  const lim = p.limits || {};
  const int = (v, def, max) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : def; };
  const limits = { maxUsers: int(lim.maxUsers, 3, 10000), maxChildren: int(lim.maxChildren, 0, 10000),
    maxStorageMb: int(lim.maxStorageMb, 1024, 1000000), maxDepth: int(lim.maxDepth, lim.maxChildren > 0 ? 2 : 1, 8) };
  if (limits.maxDepth < 1) limits.maxDepth = 1;
  return { id, name, desc: clean(p.desc, 300), priceAgorot, currency: 'ILS', months, limits };
}

// מהדורה של תכנית (shell/edition.js, תכנית אחת לכל מוצר — החלטת הבעלים 5.11.2026): מזהה המהדורה, או null כשלא נבחרה
// (תכנית לכל המהדורות — הצעה ישנה / תכנית כללית). features — התחומים של התכנית ב-SuperSuite: חייבים להיות של אותה
// מהדורה — תכנית "עמותות" לא פותחת נדל"ן גם אם תותקן במהדורה המלאה.
// מהדורה קיימת רק ב-SuperSuite: בתכנית של תוכנה אחרת (או תכנית שלא מכסה את SuperSuite) היא נדחית, ולא מושמטת בשקט
function cleanEdition(p, name, features, { legacy = false, product = P.THIS_PRODUCT } = {}) {
  if (p.edition == null || p.edition === '') return null;
  if (product !== P.THIS_PRODUCT) throw new Error(`בתכנית "${name}" נבחרה מהדורה — מהדורה נקבעת רק לתכנית שכוללת את ${P.productName(P.THIS_PRODUCT)}`);
  // רק מזהה מהרשימה (לא מפתח של אב-טיפוס כמו 'constructor')
  const ed = typeof p.edition === 'string' && Edition.IDS.includes(p.edition) ? Edition.get(p.edition) : null;
  if (!ed) throw new Error(`המהדורה בתכנית "${name}" אינה מוכרת`);
  const extra = features.filter(f => !Edition.featureAllowed(f, ed) && !(legacy && LEGACY_FEATURES.includes(f)));
  if (extra.length) throw new Error(`בתכנית "${name}" יש תחומים שאינם חלק מ-${ed.name}`);
  return ed.id;
}

// תחומים של מוצר אחד בתכנית: רק המוכרים (legacy — גם ישנים, בהצעה חתומה ישנה של SuperSuite)
function cleanFeatures(list, product, legacy) {
  const known = new Set([...P.featuresOf(product), ...(legacy && product === P.THIS_PRODUCT ? LEGACY_FEATURES : [])]);
  return [...new Set((Array.isArray(list) ? list : []).map(String))].filter(f => known.has(f));
}

// חבילה שחתומה בתכנית: היקף, המוצרים שהוא מכסה והתחומים לכל אחד מהם
function cleanBundle(b, name) {
  const products = b && P.productsOfScope(b.scope);
  if (!products || products.length < 2) throw new Error(`החבילה בתכנית "${name}" אינה תקינה`);
  const features = {};
  for (const pid of products) {
    features[pid] = cleanFeatures(b.features && b.features[pid], pid, false);
    if (!features[pid].length) throw new Error(`בתכנית "${name}" לא נבחר אף תחום ב${P.productName(pid)}`);
  }
  return { scope: b.scope, products, features };
}

// תכנית בהצעה של מוצר אחד (המבנה הישן: features = מערך). bundle — רק כשהתכנית מכסה כמה מוצרים
function cleanPlan(p, i, { legacy = false, product = P.THIS_PRODUCT } = {}) {
  const base = cleanCommon(p, i);
  const features = cleanFeatures(p.features, product, legacy);
  if (!features.length) throw new Error(`בתכנית "${base.name}" לא נבחר אף תחום`);
  const edition = cleanEdition(p, base.name, features, { legacy, product });
  const out = { ...base, features, ...(edition ? { edition } : {}) };
  if (p.bundle == null) return out;
  const bundle = cleanBundle(p.bundle, base.name);
  // התחומים של המוצר הזה בחבילה הם התחומים של התכנית — אחרת ההנפקה לפי החבילה הייתה נותנת אחרים
  if (!bundle.products.includes(product) || !sameSet(bundle.features[product], features)) throw new Error(`החבילה בתכנית "${base.name}" אינה תואמת לתכנית`);
  // תכנית חבילה עם מהדורה: התחומים של SuperSuite בחבילה זהים לתחומי התכנית (נבדק כאן), ולכן גם הם של אותה מהדורה
  return { ...out, bundle };
}

function cleanTerms(t) {
  const src = t || {};
  const terms = { version: clean(src.version, 20), title: clean(src.title, 120) || 'תקנון ותנאי שימוש', text: String(src.text || '').replace(/\r\n/g, '\n').slice(0, MAX_TERMS).trim() };
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(terms.version)) throw new Error('גרסת התקנון אינה תקינה (למשל 1.0)');
  if (terms.text.length < 50) throw new Error('נוסח התקנון קצר מדי');
  terms.sha256 = L.sha256Hex(terms.text);
  return terms;
}
const cleanSeller = (s) => ({ name: clean(s && s.name, 80), taxId: clean(s && s.taxId, 12) });

function cleanOffer(input, opts) {
  const plans = (Array.isArray(input.plans) ? input.plans : []).slice(0, MAX_PLANS).map((p, i) => cleanPlan(p, i, opts));
  if (!plans.length) throw new Error('יש להגדיר לפחות תכנית אחת');
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error('מזהי התכניות חייבים להיות שונים');
  return { v: 1, seller: cleanSeller(input.seller), plans, terms: cleanTerms(input.terms) };
}

// המוצר של הצעה חתומה. בלי שדה — הצעה מגרסה קודמת, של SuperSuite
const productOfOffer = (payload) => (payload && payload.product != null ? payload.product : P.DEFAULT_PRODUCT);

function createOffer(rootPrivateJwk, input, { issuedAt = Date.now(), product = P.THIS_PRODUCT } = {}) {
  if (!P.isProduct(product)) throw new Error('המוצר אינו מוכר');
  const payload = { ...cleanOffer(input || {}, { product }), product, issuer: L.keyId(rootPrivateJwk), issuedAt };
  return JSON.stringify({ type: OFFER_TYPE, payload, sig: L.signObject(payload, rootPrivateJwk) });
}

// expectProduct — המוצר שהקורא מצפה לו (התוכנה שמציגה את ההצעה, או השרת לפי הבקשה). הצעה של מוצר אחר נדחית
function verifyOffer(text, rootKeys, { expectProduct = null } = {}) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('קובץ ההצעה פגום'); }
  if (!o || o.type !== OFFER_TYPE || !o.payload || typeof o.sig !== 'string') throw new Error('הקובץ אינו הצעת הרשמה');
  const key = (rootKeys || []).find(k => L.keyId(k) === o.payload.issuer);
  if (!key) throw new Error('ההצעה אינה מהספק של התוכנה הזו');
  if (!L.verifyObject(o.payload, o.sig, key)) throw new Error('חתימת ההצעה אינה תקינה');
  const product = productOfOffer(o.payload);
  if (!P.isProduct(product)) throw new Error('ההצעה היא של מוצר שאינו מוכר');
  if (expectProduct && product !== expectProduct) throw new Error('ההצעה שהתקבלה היא של תוכנה אחרת');
  const c = cleanOffer(o.payload, { legacy: true, product });
  if (c.terms.sha256 !== o.payload.terms.sha256) throw new Error('נוסח התקנון שונה מהחתום');
  return o.payload;
}

// ---------- ההצעה הראשית (מסך מנהל-העל) ----------
// plan: { id, name, desc, priceAgorot, months, limits, scope, features: { <מוצר>: [...] }, edition? }.
// תכנית מגרסה קודמת (features מערך, בלי scope) — של SuperSuite.
// edition — מהדורה של SuperSuite (cleanEdition): רק בתכנית שמכסה את SuperSuite (לבד, בחבילת משפחה או ב"כל התוכנות"),
// ונבדקת מול התחומים של SuperSuite בתכנית. התחומים של שאר התוכנות בחבילה לא קשורים למהדורה
function cleanMasterPlan(p, i) {
  const src = p || {};
  const base = cleanCommon(src, i);
  const legacyArray = Array.isArray(src.features);
  const scope = src.scope == null && legacyArray ? P.THIS_PRODUCT : src.scope;
  const products = P.productsOfScope(scope);
  if (!products) throw new Error(`בתכנית "${base.name}" לא נבחר מוצר או חבילה`);
  const map = legacyArray ? { [P.THIS_PRODUCT]: src.features } : (src.features || {});
  const features = {};
  for (const pid of products) {
    features[pid] = cleanFeatures(map[pid], pid, false);
    if (!features[pid].length) throw new Error(products.length > 1 ? `בתכנית "${base.name}" לא נבחר אף תחום ב${P.productName(pid)}` : `בתכנית "${base.name}" לא נבחר אף תחום`);
  }
  const own = products.includes(P.THIS_PRODUCT);
  const edition = cleanEdition(src, base.name, own ? features[P.THIS_PRODUCT] : [], { product: own ? P.THIS_PRODUCT : products[0] });
  return { ...base, scope, products, features, ...(edition ? { edition } : {}) };
}

function cleanMaster(input) {
  const src = input || {};
  const plans = (Array.isArray(src.plans) ? src.plans : []).slice(0, MAX_PLANS).map(cleanMasterPlan);
  if (!plans.length) throw new Error('יש להגדיר לפחות תכנית אחת');
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error('מזהי התכניות חייבים להיות שונים');
  return { v: 2, seller: cleanSeller(src.seller), plans, terms: cleanTerms(src.terms) };
}

// הצעה לכל מוצר שיש לו לפחות תכנית אחת: { <מוצר>: קלט ל-createOffer }.
// המהדורה נכתבת רק בהצעה של SuperSuite — בהצעה של תוכנה אחרת אותה תכנית (חבילה) מופיעה בלי מהדורה
function splitMaster(master) {
  const out = {};
  for (const pid of P.PRODUCTS.map(x => x.id)) {
    const plans = master.plans.filter(p => p.products.includes(pid)).map(p => ({
      id: p.id, name: p.name, desc: p.desc, priceAgorot: p.priceAgorot, months: p.months, limits: { ...p.limits },
      features: [...p.features[pid]],
      ...(pid === P.THIS_PRODUCT && p.edition ? { edition: p.edition } : {}),
      ...(p.products.length > 1 ? { bundle: { scope: p.scope, products: [...p.products], features: JSON.parse(JSON.stringify(p.features)) } } : {}),
    }));
    if (plans.length) out[pid] = { seller: { ...master.seller }, plans, terms: { version: master.terms.version, title: master.terms.title, text: master.terms.text } };
  }
  return out;
}

// הצעה ראשית מהצעה חתומה של מוצר אחד (offer.json מגרסה קודמת)
function masterFromOffer(offer) {
  return cleanMaster({ seller: offer.seller, terms: offer.terms,
    plans: offer.plans.map(p => ({ ...p, scope: P.THIS_PRODUCT, features: { [P.THIS_PRODUCT]: p.features } })) });
}

// ---------- מהדורות (shell/edition.js) ----------
// התכניות שמוצעות במהדורה הזו: של המהדורה, או בלי מהדורה (הצעה ישנה / תכנית כללית)
const planInEdition = (plan, editionId = Edition.current().id) => !plan.edition || plan.edition === editionId;
const plansForEdition = (offer, editionId) => (offer && Array.isArray(offer.plans) ? offer.plans.filter(p => planInEdition(p, editionId)) : []);
// תבנית לעורך התכניות: תכנית אחת לכל מוצר עם התחומים של המהדורה. המחיר ריק — הבעלים קובע (העורך לא שומר בלי מחיר)
function editionPlanTemplates() {
  return Edition.PARTIAL_IDS.map(id => {
    const ed = Edition.get(id);
    return { id: id, name: ed.name, desc: '', edition: id, priceAgorot: null, months: 12,
      features: [...ed.features, 'ai'], limits: { maxUsers: 3, maxChildren: 0 } };
  });
}
const editionChoices = () => Edition.IDS.map(id => ({ id, name: Edition.get(id).name }));

const planOf = (offer, planId) => {
  const p = offer.plans.find(x => x.id === planId);
  if (!p) throw new Error('התכנית שנבחרה אינה קיימת');
  return p;
};

const formatAgorot = (a) => '₪' + (Math.round(a) / 100).toLocaleString('he-IL', { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });

module.exports = { OFFER_TYPE, FEATURES, LEGACY_FEATURES, createOffer, verifyOffer, productOfOffer, cleanMaster, splitMaster, masterFromOffer, planOf, formatAgorot,
  planInEdition, plansForEdition, editionPlanTemplates, editionChoices };
