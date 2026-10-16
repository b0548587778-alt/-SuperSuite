// הצעת מנהל-העל: תכניות (מחיר באגורות, תקופה, תחומים, מכסות) + תקנון בגרסה — חתומים במפתח השורש.
// הלקוח רואה רק הצעה שחתימתה תקינה; השרת גובה רק לפי המחיר שבהצעה החתומה (לא לפי מה שהלקוח שלח).
const L = require('./license');

const OFFER_TYPE = 'supersuite-offer';
const MAX_PLANS = 20;
const MAX_TERMS = 100000;
const FEATURES = ['econ', 'econ.accounting', 'econ.npo', 'econ.gemach', 'econ.chesed', 'econ.mortgage', 'econ.mortgage-advisor', 'econ.mortgage-lab',
  'shamai', 'trainer', 'tools'];

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function cleanPlan(p, i) {
  const id = clean(p && p.id, 40) || 'plan-' + (i + 1);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('מזהה תכנית אינו תקין');
  const name = clean(p.name, 60);
  if (!name) throw new Error('לכל תכנית חייב להיות שם');
  const priceAgorot = Number(p.priceAgorot);
  if (!Number.isSafeInteger(priceAgorot) || priceAgorot < 0 || priceAgorot > 100000000) throw new Error(`המחיר בתכנית "${name}" אינו תקין`);
  const months = Number(p.months);
  if (!Number.isSafeInteger(months) || months < 12 || months > 60) throw new Error(`התקופה בתכנית "${name}" אינה תקינה — הרישיון שנתי (12–60 חודשים)`);
  const features = [...new Set((Array.isArray(p.features) ? p.features : []).map(String))].filter(f => FEATURES.includes(f));
  if (!features.length) throw new Error(`בתכנית "${name}" לא נבחר אף תחום`);
  const lim = p.limits || {};
  const int = (v, def, max) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : def; };
  const limits = { maxUsers: int(lim.maxUsers, 3, 10000), maxChildren: int(lim.maxChildren, 0, 10000),
    maxStorageMb: int(lim.maxStorageMb, 1024, 1000000), maxDepth: int(lim.maxDepth, lim.maxChildren > 0 ? 2 : 1, 8) };
  if (limits.maxDepth < 1) limits.maxDepth = 1;
  return { id, name, desc: clean(p.desc, 300), priceAgorot, currency: 'ILS', months, features, limits };
}

function cleanOffer(input) {
  const plans = (Array.isArray(input.plans) ? input.plans : []).slice(0, MAX_PLANS).map(cleanPlan);
  if (!plans.length) throw new Error('יש להגדיר לפחות תכנית אחת');
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error('מזהי התכניות חייבים להיות שונים');
  const t = input.terms || {};
  const terms = { version: clean(t.version, 20), title: clean(t.title, 120) || 'תקנון ותנאי שימוש', text: String(t.text || '').replace(/\r\n/g, '\n').slice(0, MAX_TERMS).trim() };
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(terms.version)) throw new Error('גרסת התקנון אינה תקינה (למשל 1.0)');
  if (terms.text.length < 50) throw new Error('נוסח התקנון קצר מדי');
  terms.sha256 = L.sha256Hex(terms.text);
  return { v: 1, seller: { name: clean(input.seller && input.seller.name, 80), taxId: clean(input.seller && input.seller.taxId, 12) }, plans, terms };
}

function createOffer(rootPrivateJwk, input, { issuedAt = Date.now() } = {}) {
  const payload = { ...cleanOffer(input || {}), issuer: L.keyId(rootPrivateJwk), issuedAt };
  return JSON.stringify({ type: OFFER_TYPE, payload, sig: L.signObject(payload, rootPrivateJwk) });
}

function verifyOffer(text, rootKeys) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('קובץ ההצעה פגום'); }
  if (!o || o.type !== OFFER_TYPE || !o.payload || typeof o.sig !== 'string') throw new Error('הקובץ אינו הצעת הרשמה');
  const key = (rootKeys || []).find(k => L.keyId(k) === o.payload.issuer);
  if (!key) throw new Error('ההצעה אינה מהספק של התוכנה הזו');
  if (!L.verifyObject(o.payload, o.sig, key)) throw new Error('חתימת ההצעה אינה תקינה');
  const c = cleanOffer(o.payload);
  if (c.terms.sha256 !== o.payload.terms.sha256) throw new Error('נוסח התקנון שונה מהחתום');
  return o.payload;
}

const planOf = (offer, planId) => {
  const p = offer.plans.find(x => x.id === planId);
  if (!p) throw new Error('התכנית שנבחרה אינה קיימת');
  return p;
};

const formatAgorot = (a) => '₪' + (Math.round(a) / 100).toLocaleString('he-IL', { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });

module.exports = { OFFER_TYPE, FEATURES, createOffer, verifyOffer, planOf, formatAgorot };
