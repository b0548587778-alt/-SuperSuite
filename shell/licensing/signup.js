// הרשמה: בקשת רישיון + בחירת תכנית + פרטי לקוח + חתימה על התקנון — חבילה אחת חתומה במפתח המכשיר.
// מנהל-העל מאמת: החתימה של המכשיר, שההצעה חתומה בידו, שנוסח התקנון שנחתם זהה לחתום (SHA-256), ושהתכנית קיימת.
// החתימה עצמה: גלילה עד סוף התקנון + סימון "קראתי ואני מסכים" + חתימה בכתב יד (Canvas, נשמרת כתמונה ותמציתה בחבילה).
const L = require('./license');
const O = require('./offer');
const P = require('./products');
const { isValidIsraeliId } = require('../../modules/econ/core/israeliId');
const { PKG_REQUEST } = require('./store');

const SIGNUP_TYPE = 'supersuite-signup';
// החלק שנשלח לשרת בגלוי (סקירה 2.11.2026, f89): החבילה המלאה — עם ת.ז, טלפון ותמונת החתימה — מוצפנת למנהל-העל
// (sealSignup), ולשרת עובר רק מה שהוא צריך: תכנית, מחיר, מזהה המכשיר, ולתכנית בתשלום — פרטי החשבונית לספק הסליקה
const PUBLIC_TYPE = 'supersuite-signup-public';
const SEALED_PURPOSE = 'signup';
const MAX_SEALED = 400 * 1024;
const MAX_SIGNATURE = 200 * 1024;

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

function cleanCustomer(c = {}) {
  const out = { org: clean(c.org, 80), contact: clean(c.contact, 60), phone: clean(c.phone, 20), email: clean(c.email, 120).toLowerCase(), taxId: clean(c.taxId, 9) };
  if (!out.org) throw new Error('שם הארגון / העסק חובה');
  if (!out.contact) throw new Error('שם איש הקשר חובה');
  if (!/^[0-9+\-\s]{9,20}$/.test(out.phone) || out.phone.replace(/\D/g, '').length < 9) throw new Error('מספר הטלפון אינו תקין');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) throw new Error('כתובת הדוא"ל אינה תקינה');
  if (out.taxId && !isValidIsraeliId(out.taxId)) throw new Error('מספר ת.ז / ח"פ אינו תקין');
  return out;
}

function checkSignatureImage(img) {
  if (typeof img !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img)) throw new Error('יש לחתום בתיבת החתימה');
  if (img.length > MAX_SIGNATURE) throw new Error('תמונת החתימה גדולה מדי');
  if (img.length < 300) throw new Error('יש לחתום בתיבת החתימה');
  return img;
}

// יצירת חבילת ההרשמה במכשיר. offerText — ההצעה החתומה כפי שהתקבלה (נכללת כראיה לנוסח שנחתם)
function createSignup({ deviceJwk, offerText, rootKeys, planId, customer, signatureImage, scrolledToEnd, accepted, at = Date.now(), id }) {
  const offer = O.verifyOffer(offerText, rootKeys);
  const plan = O.planOf(offer, planId);
  if (!scrolledToEnd) throw new Error('יש לקרוא את התקנון עד סופו');
  if (!accepted) throw new Error('יש לאשר את התקנון');
  const pub = L.publicOf(deviceJwk);
  const body = {
    v: 1, id: id || L.sha256Hex(L.keyId(pub) + ':' + at).slice(0, 24),
    keyId: L.keyId(pub), publicKey: pub,
    offerIssuedAt: offer.issuedAt, planId: plan.id, planName: plan.name, priceAgorot: plan.priceAgorot, months: plan.months,
    terms: { version: offer.terms.version, sha256: offer.terms.sha256 },
    customer: cleanCustomer(customer),
    signature: { method: 'canvas+checkbox+scroll', imageSha256: L.sha256Hex(checkSignatureImage(signatureImage)), scrolledToEnd: true, accepted: true },
    signedAt: at,
  };
  const pkg = { type: SIGNUP_TYPE, v: 1, body, sig: L.signObject(body, deviceJwk), signatureImage, offer: typeof offerText === 'string' ? offerText : JSON.stringify(offerText) };
  return { id: body.id, text: JSON.stringify(pkg), body };
}

// המוצר של חבילת הרשמה מלאה — לפי ההצעה החתומה שבתוכה (מרכז הרישוי, products.js). הצעה בלי מוצר (גרסה קודמת) ←
// ברירת המחדל; חבילה שלא נקראת ← null. זו קריאה בלבד: החתימה של ההצעה נבדקת ב-verifySignup
function offerProductOf(signupText) {
  try {
    const offer = JSON.parse(signupText).offer;
    return O.productOfOffer((typeof offer === 'string' ? JSON.parse(offer) : offer).payload);
  } catch { return null; }
}

// המוצר בחלק הגלוי (מרכז הרישוי): השרת בוחר לפיו את ההצעה שמולה נבדקת ההרשמה (offer-<מוצר>.json). לקוח מגרסה קודמת
// לא שולח אותו — השרת מאתר אז את ההצעה לפי זמן ההנפקה והתכנית (server/license-relay.js, offerForPublic). אצל מנהל-העל
// המוצר נקבע תמיד מההצעה החתומה שבתוך המעטפה, והחלק הגלוי רק נבדק מולה (openSealedSignup)
// הצפנת החבילה המלאה למנהל-העל ויצירת החלק הגלוי לשרת. ownerPub — המפתח הציבורי של מנהל-העל (rootKeys[0])
function sealSignup({ deviceJwk, signup, ownerPub }) {
  const M = require('./messages');
  const sealed = M.sealData(deviceJwk, ownerPub, signup.text, SEALED_PURPOSE);
  const b = signup.body;
  const product = offerProductOf(signup.text);
  const body = { v: 1, id: b.id, keyId: b.keyId, publicKey: b.publicKey, offerIssuedAt: b.offerIssuedAt, planId: b.planId,
    priceAgorot: b.priceAgorot, months: b.months, signedAt: b.signedAt, sealedSha256: L.sha256Hex(sealed),
    ...(product ? { product } : {}),
    // חשבונית מספק הסליקה — רק לתכנית בתשלום, ורק השדות שהחשבונית צריכה (בלי איש קשר ובלי החתימה). השרת צריך אותם:
    // הוא פותח את דף התשלום אצל Cardcom עם מסמך החשבונית (Name / TaxId / Email / Mobile — server/payments/cardcom-provider.js).
    // הם חלק מהחלק הגלוי החתום, ולכן נשמרים בשרת **בגלוי** (signups/<תשלום>.json ובמסירה לתיבת מנהל-העל) עד שמנהל-העל
    // מושך את ההרשמה, ותשלום שלא הושלם — עד 30 יום (docs/RELAY-DEPLOY.md, "מה יש בשרת"). החבילה המלאה — רק במעטפה
    ...(b.priceAgorot > 0 ? { invoice: { org: b.customer.org, taxId: b.customer.taxId, email: b.customer.email, phone: b.customer.phone } } : {}) };
  return { sealed, publicText: JSON.stringify({ type: PUBLIC_TYPE, v: 1, body, sig: L.signObject(body, deviceJwk) }) };
}

// החלק הגלוי כפי שנשלח — בלי אימות (השרת קורא ממנו את המוצר, התכנית וזמן ההצעה כדי לבחור הצעה; האימות ב-verifySignupPublic)
function publicBodyOf(text) {
  try {
    const pkg = typeof text === 'string' ? JSON.parse(text) : text;
    return pkg && pkg.type === PUBLIC_TYPE && pkg.body && typeof pkg.body === 'object' ? pkg.body : null;
  } catch { return null; }
}

// אימות החלק הגלוי בשרת: חתימת המכשיר, התמצית של המעטפה, וההצעה שבתוקף (current — מאומתת). מחזיר { body, plan }
function verifySignupPublic(text, sealed, current) {
  let pkg;
  try { pkg = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('חבילת ההרשמה פגומה'); }
  if (!pkg || pkg.type !== PUBLIC_TYPE || !pkg.body || typeof pkg.sig !== 'string') throw new Error('הקובץ אינו הרשמה');
  const b = pkg.body;
  if (L.keyId(b.publicKey) !== b.keyId) throw new Error('מזהה המכשיר אינו תואם');
  if (!L.verifyObject(b, pkg.sig, b.publicKey)) throw new Error('חתימת ההרשמה אינה תקינה');
  if (typeof sealed !== 'string' || sealed.length > MAX_SEALED || L.sha256Hex(sealed) !== b.sealedSha256) throw new Error('חבילת ההרשמה המוצפנת חסרה או שונתה');
  if (typeof b.id !== 'string' || !/^[0-9a-f]{24}$/.test(b.id)) throw new Error('חבילת ההרשמה פגומה');
  if (!current || current.issuedAt !== b.offerIssuedAt || !Number.isSafeInteger(b.signedAt)) throw new Error('התכניות והמחירים עודכנו — יש לפתוח מחדש את מסך הרכישה ולהירשם שוב');
  const plan = O.planOf(current, b.planId);
  if (plan.priceAgorot !== b.priceAgorot || plan.months !== b.months) throw new Error('המחיר או התקופה אינם תואמים להצעה');
  let invoice = null;
  if (plan.priceAgorot > 0) {
    const i = b.invoice || {};
    invoice = { org: clean(i.org, 80), taxId: clean(i.taxId, 9), email: clean(i.email, 120), phone: clean(i.phone, 20) };
    if (!invoice.org) throw new Error('שם הארגון / העסק חובה');
  }
  return { body: b, plan, invoice, product: P.isProduct(b.product) ? b.product : null };
}

// אצל מנהל-העל: פתיחת המעטפה במפתח השורש. מעטפה עם from (מהמכשיר) — המפתח הציבורי של השולח מגיע מהחלק הגלוי
// החתום (body.publicKey), אחרי אימות החתימה והתמצית של המעטפה; מעטפה אנונימית (from: null) — הרשמה מגרסה קודמת
// שהשרת הצפין בעצמו. החבילה שבפנים נבדקת אחר כך ב-verifySignup (חתומה במפתח המכשיר), וכאן — שהיא תואמת לחלק הגלוי
function openSealedSignup(rootJwk, sealed, publicText = null) {
  const M = require('./messages');
  let env;
  try { env = typeof sealed === 'string' ? JSON.parse(sealed) : null; } catch { env = null; }
  if (!env || typeof env !== 'object') throw new Error('חבילת ההרשמה המוצפנת פגומה');
  let pub = null;
  if (publicText != null) {
    let pkg;
    try { pkg = typeof publicText === 'string' ? JSON.parse(publicText) : publicText; } catch { throw new Error('חבילת ההרשמה פגומה'); }
    if (!pkg || pkg.type !== PUBLIC_TYPE || !pkg.body || typeof pkg.sig !== 'string') throw new Error('הקובץ אינו הרשמה');
    pub = pkg.body;
    if (L.keyId(pub.publicKey) !== pub.keyId || !L.verifyObject(pub, pkg.sig, pub.publicKey)) throw new Error('חתימת ההרשמה אינה תקינה');
    if (L.sha256Hex(sealed) !== pub.sealedSha256) throw new Error('חבילת ההרשמה המוצפנת שונתה');
  }
  if (env.from != null && (!pub || env.from !== pub.keyId)) throw new Error('השולח של חבילת ההרשמה אינו תואם');
  const text = M.openData(rootJwk, env, SEALED_PURPOSE, { senderPub: env.from != null ? pub.publicKey : null });
  if (pub) {
    let inner;
    try { inner = JSON.parse(text).body || {}; } catch { throw new Error('חבילת ההרשמה פגומה'); }
    const same = ['id', 'keyId', 'planId', 'priceAgorot', 'months', 'offerIssuedAt', 'signedAt'].every(k => inner[k] === pub[k]);
    const c = inner.customer || {};
    const invoiceOk = !pub.invoice || ['org', 'taxId', 'email', 'phone'].every(k => String(pub.invoice[k] || '') === String(c[k] || ''));
    const productOk = pub.product == null || pub.product === (offerProductOf(text) || P.DEFAULT_PRODUCT);
    if (!same || !invoiceOk || !productOk) throw new Error('החלק הגלוי של ההרשמה אינו תואם לחבילה המוצפנת');
  }
  return text;
}

// אימות אצל מנהל-העל. מחזיר את התוכן, ובקשת רישיון רגילה להנפקה.
// current — ההצעה שבתוקף עכשיו (בשרת: offer.json). הצעה חתומה ישנה אינה מספיקה: אחרת אפשר להירשם בתכנית
// זולה או חינמית שהספק כבר הסיר (בדיקת קוד 23.10.2026, ממצא 31)
function verifySignup(text, rootKeys, { current = null } = {}) {
  let pkg;
  try { pkg = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('חבילת ההרשמה פגומה'); }
  if (!pkg || pkg.type !== SIGNUP_TYPE || !pkg.body || typeof pkg.sig !== 'string') throw new Error('הקובץ אינו הרשמה');
  const b = pkg.body;
  if (L.keyId(b.publicKey) !== b.keyId) throw new Error('מזהה המכשיר אינו תואם');
  if (!L.verifyObject(b, pkg.sig, b.publicKey)) throw new Error('חתימת ההרשמה אינה תקינה');
  const offer = O.verifyOffer(pkg.offer, rootKeys);
  if (offer.issuedAt !== b.offerIssuedAt) throw new Error('ההרשמה אינה תואמת להצעה');
  if (current && (current.issuedAt !== offer.issuedAt || current.issuer !== offer.issuer)) throw new Error('התכניות והמחירים עודכנו — יש לפתוח מחדש את מסך הרכישה ולהירשם שוב');
  const plan = O.planOf(offer, b.planId);
  if (plan.priceAgorot !== b.priceAgorot || plan.months !== b.months) throw new Error('המחיר או התקופה אינם תואמים להצעה');
  if (b.terms.sha256 !== offer.terms.sha256 || b.terms.version !== offer.terms.version) throw new Error('נוסח התקנון שנחתם אינו תואם');
  if (L.sha256Hex(checkSignatureImage(pkg.signatureImage)) !== b.signature.imageSha256) throw new Error('תמונת החתימה שונתה');
  cleanCustomer(b.customer);
  // המוצר — של ההצעה שלפיה נרשמו (מרכז הרישוי, products.js); נכנס לבקשה כדי שההנפקה תהיה של אותו מוצר
  const product = O.productOfOffer(offer);
  const request = JSON.stringify({ type: PKG_REQUEST, v: 1, name: b.customer.org, publicKey: b.publicKey, keyId: b.keyId, product });
  return { body: b, plan, offer, product, request, signatureImage: pkg.signatureImage };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// מסמך חתום להדפסה / PDF: נוסח התקנון המלא, פרטי החותם, התכנית, תמונת החתימה ותמציות
function signedDocumentHtml({ body, offer, signatureImage }) {
  const c = body.customer;
  const date = new Date(body.signedAt).toLocaleString('he-IL');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escHtml(offer.terms.title)}</title>
<style>body{font-family:Arial,"David",sans-serif;margin:32px;color:#111;line-height:1.6}h1{font-size:22px}pre{white-space:pre-wrap;font-family:inherit;border:1px solid #ccc;padding:12px;border-radius:6px}
table{border-collapse:collapse;margin:12px 0}td{border:1px solid #ccc;padding:4px 10px}.sig{border:1px solid #999;max-width:320px}small{color:#555}</style></head><body>
<h1>${escHtml(offer.terms.title)} — גרסה ${escHtml(offer.terms.version)}</h1>
<p>${escHtml(offer.seller.name || '')}</p>
<pre>${escHtml(offer.terms.text)}</pre>
<h2>פרטי ההסכמה</h2>
<table>
<tr><td>ארגון</td><td>${escHtml(c.org)}</td></tr><tr><td>איש קשר</td><td>${escHtml(c.contact)}</td></tr>
<tr><td>טלפון</td><td>${escHtml(c.phone)}</td></tr>${c.email ? `<tr><td>דוא"ל</td><td>${escHtml(c.email)}</td></tr>` : ''}
${c.taxId ? `<tr><td>ת.ז / ח"פ</td><td>${escHtml(c.taxId)}</td></tr>` : ''}
<tr><td>תכנית</td><td>${escHtml(body.planName)} — ${escHtml(O.formatAgorot(body.priceAgorot))} ל-${Number(body.months)} חודשים</td></tr>
<tr><td>נחתם</td><td>${escHtml(date)}</td></tr>
<tr><td>אופן החתימה</td><td>קריאה עד הסוף, סימון הסכמה וחתימה בכתב יד</td></tr>
</table>
<p>חתימה:</p><img class="sig" src="${signatureImage}" alt="חתימה">
<p><small>תמצית התקנון (SHA-256): <span dir="ltr">${escHtml(body.terms.sha256)}</span><br>
מזהה ההרשמה: <span dir="ltr">${escHtml(body.id)}</span> · מזהה המכשיר: <span dir="ltr">${escHtml(body.keyId)}</span><br>
ההרשמה חתומה דיגיטלית (Ed25519) במפתח המכשיר.</small></p>
</body></html>`;
}

module.exports = { SIGNUP_TYPE, PUBLIC_TYPE, SEALED_PURPOSE, MAX_SEALED, createSignup, sealSignup, offerProductOf, publicBodyOf, verifySignupPublic, openSealedSignup, verifySignup, signedDocumentHtml, cleanCustomer };
