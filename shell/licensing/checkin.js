// בדיקה חתומה מול שרת הרישוי (בדיקת קוד 23.10.2026, ממצא 27).
// השרת חותם על תשובת הסנכרון במפתח משלו ("מפתח השרת"), ומפתח השרת מאושר בתעודה שמנהל-העל חותם במפתח השורש —
// לכתובת אחת של השרת (origin). הלקוח מעדכן את "החיבור האחרון לשרת" (lastSync — תנאי ההפעלה) רק אחרי אימות של:
// תעודה תקפה מול מפתח השורש שבתוכנה ולכתובת שהלקוח פנה אליה, חתימת השרת, האתגר האקראי שהלקוח שלח באותה בקשה
// (לא שידור חוזר), התיבה של הלקוח, הזמן — ורשימת ההודעות שבתיבה (מזהה + תמצית התוכן): שרת ביניים שמוחק הודעה
// מהתשובה או מחליף את תוכנה (השבתה / סיום) נתפס. גם המחיקה בשרת (ack) נעשית רק כשהתמצית שהלקוח קיבל זהה לשמורה.
// שרת אחר — מקומי, או כתובת שעברה לבעלים אחרים (sslip.io) — אינו מחזיק את מפתח השרת. שרת שמעביר את הבקשות לשרת
// האמיתי מקבל חתימה על הכתובת של השרת האמיתי, ולא על הכתובת שהלקוח פנה אליה — ולכן גם הוא נדחה.
// המפתח הפרטי של השרת נשאר על השרת; מפתח השורש — רק אצל מנהל-העל.
const L = require('./license');
const C = require('./crypto-lite');

const CERT_TYPE = 'supersuite-relay-cert';
const CHECKIN_TYPE = 'supersuite-checkin';
const CERT_V = 2;     // v2: עם כתובת השרת (origin)
const CHECKIN_V = 2;  // v2: עם מטרה (purpose), כתובת ורשימת ההודעות
const CHECKIN_SKEW_MS = 10 * 60 * 1000; // השרת עצמו דוחה בקשה עם הפרש של יותר מ-5 דקות
const CHALLENGE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DIGEST_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_CERT_TEXT = 4096;
const MAX_ITEMS = 20000; // התיבה הגדולה ביותר בשרת (מנהל-העל): 500 הודעות + 5,000 מסירות של השרת
// fetch — תשובת סנכרון (עם רשימת ההודעות); hello — הוכחה בלבד, לפני שליחת פרטי הרשמה או פתיחת דף תשלום
const PURPOSES = new Set(['fetch', 'hello']);

const isTime = (n) => Number.isSafeInteger(n) && n > 0;

// כתובת מקומית (המחשב עצמו). כל אחד יכול להריץ שרת בכתובת כזו במחשב שלו
function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '0.0.0.0' || /^127(\.\d{1,3}){3}$/.test(h);
}

// כתובת שרת מותרת: https בלבד, או http ל-localhost (פיתוח ובדיקות). מחזיר את ה-origin. משותף ללקוח (remote.js)
function originOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('כתובת השרת אינה תקינה'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('כתובת השרת חייבת להתחיל ב-https://');
  if (u.username || u.password) throw new Error('כתובת השרת לא יכולה לכלול שם משתמש או סיסמה');
  return u.origin;
}

// הכתובת שבתעודת השרת: https לשרת שאינו מקומי בלבד (סקירת אבטחה 24.10.2026). תעודה ל-localhost שנחתמה במפתח
// השורש האמיתי הייתה תקפה בכל מחשב — כל אחד יכול להריץ שם שרת עם מפתח השרת של הבדיקה ולהאריך את ההפעלה.
// allowLocal — מצב בדיקה מפורש בלבד (בדיקות שמריצות שרת אמיתי על 127.0.0.1); התוכנה עצמה לא מעבירה אותו
function assertCertOrigin(origin, allowLocal = false) {
  let u;
  try { u = new URL(String(origin || '')); } catch { throw new Error('כתובת השרת אינה תקינה'); }
  if (allowLocal === true) return;
  if (u.protocol !== 'https:') throw new Error('תעודת שרת רישוי ניתנת רק לכתובת https://');
  if (isLocalHost(u.hostname)) throw new Error('תעודת שרת רישוי לא ניתנת לכתובת מקומית (localhost) — היא הייתה תקפה בכל מחשב');
}

// תמצית של הודעה בתיבה (SHA-256, base64url) — מה שהשרת חותם עליו ומה שהלקוח שולח במחיקה (ack).
// Node — createHash; באנדרואיד (בלי createHash) — המימוש ב-crypto-lite. אותה תוצאה בשניהם
let nodeCrypto = null;
try { nodeCrypto = require('crypto'); if (!nodeCrypto || typeof nodeCrypto.createHash !== 'function') nodeCrypto = null; } catch { nodeCrypto = null; }
function messageDigest(m) {
  const x = m || {};
  const text = JSON.stringify([x.id, x.from, x.kind, x.body, x.at]);
  if (nodeCrypto) return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('base64url');
  return C.b64uEncode(C.sha256(C.utf8(text)));
}
const boxItems = (box) => box.map(m => [m.id, messageDigest(m)]);
const validItem = (it) => Array.isArray(it) && it.length === 2 && typeof it[0] === 'string' && it[0].length <= 100 && typeof it[1] === 'string' && DIGEST_RE.test(it[1]);

// מנהל-העל: תעודה למפתח הציבורי של השרת, לכתובת אחת (origin). months — תוקף (1–60, ברירת מחדל 24)
function createRelayCert(rootPrivateJwk, relayPublicJwk, { origin, issuedAt = Date.now(), months = 24, allowLocal = false } = {}) {
  if (!relayPublicJwk || typeof relayPublicJwk !== 'object') throw new Error('המפתח הציבורי של השרת אינו תקין');
  if ('d' in relayPublicJwk) throw new Error('זה מפתח פרטי! לתעודה נכנס רק המפתח הציבורי של השרת (relay-key.pub.json)');
  if (!origin) throw new Error('חסרה כתובת השרת לתעודה (--url)');
  const at = originOf(origin);
  assertCertOrigin(at, allowLocal);
  const m = Number(months);
  if (!Number.isSafeInteger(m) || m < 1 || m > 60) throw new Error('תוקף התעודה חייב להיות בין חודש ל-60 חודשים');
  const relayKey = L.publicOf(relayPublicJwk);
  const relayId = L.keyId(relayKey);
  const issuer = L.keyId(rootPrivateJwk);
  if (relayId === issuer) throw new Error('מפתח השרת חייב להיות שונה ממפתח השורש');
  const end = new Date(issuedAt);
  end.setMonth(end.getMonth() + m);
  const payload = { type: CERT_TYPE, v: CERT_V, relayKey, relayId, issuer, origin: at, issuedAt, expiresAt: end.getTime() };
  return JSON.stringify({ payload, sig: L.signObject(payload, rootPrivateJwk) });
}

// אימות תעודת השרת מול מפתחות השורש שבתוכנה. allowExpired — לשרת עצמו (אזהרה בעלייה) ולבדיקה החתומה השמורה.
// תעודה לכתובת http או מקומית — נדחית גם כשהחתימה תקינה (assertCertOrigin), חוץ ממצב בדיקה מפורש
function verifyRelayCert(text, rootKeys, now = Date.now(), { allowExpired = false, allowLocal = false } = {}) {
  let c;
  try { c = typeof text === 'string' ? (text.length > MAX_CERT_TEXT ? null : JSON.parse(text)) : text; } catch { c = null; }
  const p = c && c.payload;
  if (!p || p.type !== CERT_TYPE || p.v !== CERT_V || typeof c.sig !== 'string' || typeof p.origin !== 'string') throw new Error('תעודת שרת הרישוי אינה תקינה');
  const key = (rootKeys || []).find(k => { try { return L.keyId(k) === p.issuer; } catch { return false; } });
  if (!key) throw new Error('תעודת שרת הרישוי אינה של הספק של התוכנה הזו');
  if (!L.verifyObject(p, c.sig, key)) throw new Error('חתימת תעודת שרת הרישוי אינה תקינה');
  let id;
  try { id = L.keyId(p.relayKey); } catch { id = null; }
  if (!id || id !== p.relayId || !isTime(p.issuedAt) || !isTime(p.expiresAt)) throw new Error('תעודת שרת הרישוי אינה תקינה');
  assertCertOrigin(p.origin, allowLocal);
  if (!allowExpired && now > p.expiresAt) throw new Error('תוקף התעודה של שרת הרישוי פג — יש לפנות לספק התוכנה');
  return p;
}

// השרת: חתימה על תשובה. box — התיבה (מזהה המערכת ששלחה), challenge — האתגר שהיא שלחה, origin — הכתובת שבתעודה
// של השרת, items — בתשובת סנכרון (fetch): כל ההודעות שבתיבה ברגע החתימה, [מזהה, תמצית] (boxItems)
// caps (hello בלבד) — מה השרת הזה יודע לעשות, בתוך החתימה: לקוח חדש מזהה שרת ישן לפני שליחת פרטים (RELAY_CAPS)
function signCheckin(relayPrivateJwk, { purpose = 'fetch', origin, box, challenge, at, items, caps }) {
  if (!PURPOSES.has(purpose)) throw new Error('purpose');
  const payload = { type: CHECKIN_TYPE, v: CHECKIN_V, purpose, relayId: L.keyId(relayPrivateJwk), origin, box, challenge, at,
    ...(purpose === 'fetch' ? { items: items || [] } : {}), ...(purpose === 'hello' && Array.isArray(caps) ? { caps } : {}) };
  return { payload, sig: L.signObject(payload, relayPrivateJwk) };
}

// הלקוח: att = { checkin, cert } כפי שהגיעו בתשובה; origin — הכתובת שהלקוח פנה אליה.
// מחזיר { at, relayId, certExpiresAt, origin, items } (items — רק ב-fetch) או זורק שגיאה בעברית
function verifyCheckin(att, { rootKeys, box, challenge, origin, purpose = 'fetch', now = Date.now(), skewMs = CHECKIN_SKEW_MS, allowLocal = false }) {
  if (!att || !att.checkin || !att.cert) throw new Error('שרת הרישוי לא אישר את החיבור — ייתכן שזה שרת ישן או שרת שאינו של הספק');
  const cert = verifyRelayCert(att.cert, rootKeys, now, { allowLocal });
  const p = att.checkin.payload;
  if (!p || p.type !== CHECKIN_TYPE || p.v !== CHECKIN_V || p.relayId !== cert.relayId || !L.verifyObject(p, att.checkin.sig, cert.relayKey)) {
    throw new Error('חתימת שרת הרישוי אינה תקינה');
  }
  const want = originOf(origin);
  if (cert.origin !== want || p.origin !== want) throw new Error('שרת הרישוי בכתובת הזו אינו מאושר על ידי הספק (התעודה שלו ניתנה לכתובת אחרת)');
  if (p.purpose !== purpose || p.box !== box || p.challenge !== challenge) throw new Error('תשובת שרת הרישוי אינה שייכת לבקשה הזו');
  if (!isTime(p.at) || Math.abs(p.at - now) > skewMs) throw new Error('שעון המחשב אינו תואם לשעון שרת הרישוי — בדקו את התאריך והשעה במחשב');
  let items = null;
  if (purpose === 'fetch') {
    if (!Array.isArray(p.items) || p.items.length > MAX_ITEMS || !p.items.every(validItem)) throw new Error('חתימת שרת הרישוי אינה תקינה');
    items = p.items;
  }
  const caps = Array.isArray(p.caps) ? p.caps.filter(c => typeof c === 'string').slice(0, 20) : [];
  return { at: p.at, relayId: cert.relayId, certExpiresAt: cert.expiresAt, origin: want, items, caps };
}

// ---------- הבדיקה החתומה השמורה (סקירת אבטחה 24.10.2026, ממצא 1) ----------
// "החיבור האחרון לשרת" (תנאי ההפעלה) מחושב מהתשובה החתומה האחרונה שנשמרה בקובץ הרישוי — ולא ממספר מקומי, שאפשר
// היה "לקדם" (למשל בשחזור עותק ישן של קובץ המפתח, שהעביר אליו את הזמן מהקובץ הגלוי). נבדקת מחדש בכל קריאה:
// תעודה תקפה מול מפתח השורש (גם אם פגה מאז — אבל החתימה ניתנה בתוקף שלה), חתימת השרת, תשובת סנכרון (fetch) לתיבה
// של המערכת הזו, ושעת החתימה לא אחרי "עכשיו". האתגר לא נבדק שוב (הוא חד-פעמי): עותק ישן מחזיר רק את הזמן הישן שלו.
// מחזיר { at, certExpiresAt, relayId } או null
const MAX_STORED_CHECKIN = 256 * 1024;
function storedCheckinTime(att, { rootKeys, box, now = Date.now(), skewMs = CHECKIN_SKEW_MS, allowLocal = false }) {
  try {
    if (!att || typeof att !== 'object' || !att.checkin || typeof att.cert !== 'string') return null;
    if (JSON.stringify(att).length > MAX_STORED_CHECKIN) return null;
    const cert = verifyRelayCert(att.cert, rootKeys, now, { allowExpired: true, allowLocal });
    const p = att.checkin.payload;
    if (!p || p.type !== CHECKIN_TYPE || p.v !== CHECKIN_V || p.purpose !== 'fetch' || p.relayId !== cert.relayId) return null;
    if (p.box !== box || p.origin !== cert.origin || !isTime(p.at)) return null;
    // בתוקף התעודה (תחילתה — עם סטיית שעון: התעודה נחתמת במחשב של מנהל-העל, והתשובה בשעון השרת)
    if (p.at > cert.expiresAt || p.at < cert.issuedAt - skewMs || p.at > now + skewMs) return null;
    if (!L.verifyObject(p, att.checkin.sig, cert.relayKey)) return null;
    return { at: p.at, certExpiresAt: cert.expiresAt, relayId: cert.relayId };
  } catch { return null; }
}

// ---------- אישור מסירה חתום (סקירת אבטחה 24.10.2026, ממצא 5) ----------
// בשליחה השולח מצרף אתגר (receipt), והשרת חותם במפתח השרת על כל הודעה שנשמרה: [נמען, מזהה, תמצית]. שרת ביניים
// שמפיל הודעת השבתה ועונה "נשלח" — אין לו מפתח השרת, ולכן השולח רואה שהמסירה לא אושרה
const RECEIPT_TYPE = 'supersuite-send-receipt';
const RECEIPT_V = 1;
function signSendReceipt(relayPrivateJwk, { origin, box, challenge, at, items }) {
  const payload = { type: RECEIPT_TYPE, v: RECEIPT_V, relayId: L.keyId(relayPrivateJwk), origin, box, challenge, at, items: items || [] };
  return { payload, sig: L.signObject(payload, relayPrivateJwk) };
}
// resp — תשובת השרת לשליחה ({ receipt, relayCert }); sent — ההודעות שנשלחו ({ to, kind, body }).
// מחזיר מערך: לכל הודעה — true אם השרת אישר בחתימה שנשמרה בדיוק כך. תשובה בלי אישור או אישור פגום — זורק
function verifySendReceipt(resp, { rootKeys, box, challenge, origin, sent, now = Date.now(), skewMs = CHECKIN_SKEW_MS, allowLocal = false }) {
  if (!resp || !resp.receipt || typeof resp.relayCert !== 'string') throw new Error('שרת הרישוי לא אישר בחתימה שההודעות נשמרו — ייתכן שזה שרת ישן, או שרת ביניים שחסם אותן');
  const cert = verifyRelayCert(resp.relayCert, rootKeys, now, { allowLocal });
  const p = resp.receipt.payload;
  if (!p || p.type !== RECEIPT_TYPE || p.v !== RECEIPT_V || p.relayId !== cert.relayId || !L.verifyObject(p, resp.receipt.sig, cert.relayKey)) {
    throw new Error('חתימת שרת הרישוי על המסירה אינה תקינה');
  }
  const want = originOf(origin);
  if (cert.origin !== want || p.origin !== want) throw new Error('שרת הרישוי בכתובת הזו אינו מאושר על ידי הספק (התעודה שלו ניתנה לכתובת אחרת)');
  if (p.box !== box || p.challenge !== challenge) throw new Error('אישור המסירה אינו שייך לבקשה הזו');
  if (!isTime(p.at) || Math.abs(p.at - now) > skewMs) throw new Error('שעון המחשב אינו תואם לשעון שרת הרישוי — בדקו את התאריך והשעה במחשב');
  if (!Array.isArray(p.items) || p.items.length > 1000) throw new Error('חתימת שרת הרישוי על המסירה אינה תקינה');
  const used = new Set();
  return (sent || []).map((it) => {
    const i = p.items.findIndex((r, k) => !used.has(k) && Array.isArray(r) && r.length === 3 && r[0] === it.to && typeof r[1] === 'string'
      && r[2] === messageDigest({ id: r[1], from: box, kind: it.kind, body: it.body, at: p.at }));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

// ---------- דף התשלום ומצב התשלום — חתומים (סקירה 2.11.2026, f86) ----------
// ההוכחה (hello) היא בקשה נפרדת מ-checkout: מי ששולט בשם השרת (DNS) יכול לענות ל-hello בהעברה לשרת האמיתי, ול-checkout
// בקישור תשלום משלו. לכן השרת חותם במפתח השרת גם על תשובת checkout / paymentStatus — על האתגר של הבקשה הזו, התיבה,
// מזהה התשלום, הקישור, הסכום והמצב — והלקוח שומר ופותח רק מה שבחתימה. יכולת השרת מוכרזת בחתימת ה-hello (caps)
const PAY_PROOF_TYPE = 'supersuite-payment-proof';
const PAY_PROOF_V = 1;
const PAY_OPS = new Set(['checkout', 'paymentStatus']);
const CAP_PAY_PROOF = 'pay-proof';
const RELAY_CAPS = [CAP_PAY_PROOF];
function signPaymentProof(relayPrivateJwk, { op, origin, box, challenge, at, paymentId = null, status, url = null, amountAgorot = null, free = false }) {
  if (!PAY_OPS.has(op)) throw new Error('op');
  const payload = { type: PAY_PROOF_TYPE, v: PAY_PROOF_V, op, relayId: L.keyId(relayPrivateJwk), origin, box, challenge, at,
    paymentId, status, url, amountAgorot, free: !!free };
  return { payload, sig: L.signObject(payload, relayPrivateJwk) };
}
// resp — תשובת השרת ({ payProof, relayCert }). מחזיר את התוכן החתום ({ paymentId, status, url, amountAgorot, free }) או זורק
function verifyPaymentProof(resp, { rootKeys, op, box, challenge, origin, now = Date.now(), skewMs = CHECKIN_SKEW_MS, allowLocal = false }) {
  if (!resp || !resp.payProof || typeof resp.relayCert !== 'string') {
    throw new Error('שרת הרישוי לא אישר בחתימה את פרטי התשלום — ייתכן שזה שרת ישן (יש לעדכן אותו) או שרת שאינו של הספק');
  }
  const cert = verifyRelayCert(resp.relayCert, rootKeys, now, { allowLocal });
  const p = resp.payProof.payload;
  if (!p || p.type !== PAY_PROOF_TYPE || p.v !== PAY_PROOF_V || p.relayId !== cert.relayId || !L.verifyObject(p, resp.payProof.sig, cert.relayKey)) {
    throw new Error('חתימת שרת הרישוי על פרטי התשלום אינה תקינה');
  }
  const want = originOf(origin);
  if (cert.origin !== want || p.origin !== want) throw new Error('שרת הרישוי בכתובת הזו אינו מאושר על ידי הספק (התעודה שלו ניתנה לכתובת אחרת)');
  if (p.op !== op || p.box !== box || p.challenge !== challenge) throw new Error('פרטי התשלום מהשרת אינם שייכים לבקשה הזו');
  if (!isTime(p.at) || Math.abs(p.at - now) > skewMs) throw new Error('שעון המחשב אינו תואם לשעון שרת הרישוי — בדקו את התאריך והשעה במחשב');
  if (typeof p.status !== 'string' || (p.paymentId !== null && typeof p.paymentId !== 'string') || (p.url !== null && typeof p.url !== 'string')
    || (p.amountAgorot !== null && !Number.isSafeInteger(p.amountAgorot))) throw new Error('חתימת שרת הרישוי על פרטי התשלום אינה תקינה');
  return { paymentId: p.paymentId, status: p.status, url: p.url, amountAgorot: p.amountAgorot, free: p.free === true };
}

// כתובות דף התשלום — רק אצל ספק הסליקה (f86): גם שרת עם חתימה תקינה (או מפתח שרת שדלף) לא שולח את הלקוח לדף אחר.
// ספק הבדיקות מגיש את הדף בשרת עצמו — רק כשהשרת מקומי (localhost; assertPaymentConfig בשרת)
const PAYMENT_HOSTS = ['secure.cardcom.solutions'];
function assertPaymentUrl(url, { relayOrigin } = {}) {
  let u;
  try { u = new URL(String(url || '')); } catch { throw new Error('כתובת דף התשלום אינה תקינה'); }
  if (u.username || u.password) throw new Error('כתובת דף התשלום אינה תקינה');
  if (u.protocol === 'https:' && PAYMENT_HOSTS.includes(u.hostname.toLowerCase()) && !u.port) return u.toString();
  let relay = null;
  try { relay = relayOrigin ? new URL(relayOrigin) : null; } catch { relay = null; }
  if (relay && isLocalHost(relay.hostname) && u.origin === relay.origin) return u.toString();
  throw new Error('דף התשלום אינו של ספק הסליקה המוכר (' + PAYMENT_HOSTS.join(', ') + ') — הוא לא נפתח');
}

// ---------- אישור תשלום חתום למנהל-העל (סקירה 2.11.2026, f83) ----------
// מסירת הרשמה ששולמה נושאת אישור חתום במפתח השרת: מזהה התשלום, הסכום, הספק ומספר העסקה אצלו, ההרשמה (מזהה, המכשיר,
// ותמצית המעטפה המוצפנת שנמסרה) וזמן התשלום. מי שעונה למשיכה של מנהל-העל (DNS) בלי מפתח השרת לא יכול להמציא "שולם"
const PAID_TYPE = 'supersuite-payment-confirmation';
const PAID_V = 1;
function sealedDigest(text) {
  const t = String(text || '');
  if (nodeCrypto) return nodeCrypto.createHash('sha256').update(t, 'utf8').digest('base64url');
  return C.b64uEncode(C.sha256(C.utf8(t)));
}
function signPaymentConfirmation(relayPrivateJwk, { origin, paymentId, amountAgorot, provider, providerRef, signupId, keyId, sealed, paidAt }) {
  const payload = { type: PAID_TYPE, v: PAID_V, relayId: L.keyId(relayPrivateJwk), origin, paymentId, amountAgorot, provider: String(provider || ''),
    providerRef: String(providerRef || ''), signupId, keyId, sealedDigest: sealedDigest(sealed), paidAt };
  return { payload, sig: L.signObject(payload, relayPrivateJwk) };
}
// att = { confirmation, cert } מתוך payment.proof שבמסירה. expect — מה שמנהל-העל יודע בעצמו (מההרשמה החתומה במכשיר):
// { paymentId, amountAgorot, signupId, keyId, sealed, origin }. מחזיר את התוכן החתום או זורק
function verifyPaymentConfirmation(att, { rootKeys, expect = {}, now = Date.now(), skewMs = CHECKIN_SKEW_MS, allowLocal = false }) {
  if (!att || !att.confirmation || typeof att.cert !== 'string') throw new Error('אין אישור תשלום חתום מהשרת');
  const cert = verifyRelayCert(att.cert, rootKeys, now, { allowExpired: true, allowLocal });
  const p = att.confirmation.payload;
  if (!p || p.type !== PAID_TYPE || p.v !== PAID_V || p.relayId !== cert.relayId || !L.verifyObject(p, att.confirmation.sig, cert.relayKey)) {
    throw new Error('חתימת השרת על אישור התשלום אינה תקינה');
  }
  if (p.origin !== cert.origin || (expect.origin && p.origin !== originOf(expect.origin))) throw new Error('אישור התשלום ניתן בשרת אחר');
  if (!isTime(p.paidAt) || p.paidAt > cert.expiresAt || p.paidAt < cert.issuedAt - skewMs || p.paidAt > now + skewMs) throw new Error('זמן אישור התשלום אינו תקין');
  if (!Number.isSafeInteger(p.amountAgorot) || p.amountAgorot !== expect.amountAgorot || p.paymentId !== expect.paymentId
    || p.signupId !== expect.signupId || p.keyId !== expect.keyId || p.sealedDigest !== sealedDigest(expect.sealed)) {
    throw new Error('אישור התשלום החתום אינו של ההרשמה הזו');
  }
  return p;
}

const validChallenge = (s) => typeof s === 'string' && CHALLENGE_RE.test(s);
// מחיקה בשרת לפי [מזהה, תמצית] (ack) — רשומה תקינה
const validAckItem = validItem;

module.exports = { CERT_TYPE, CHECKIN_TYPE, RECEIPT_TYPE, CHECKIN_SKEW_MS, MAX_ITEMS, MAX_STORED_CHECKIN, createRelayCert, verifyRelayCert, signCheckin, verifyCheckin,
  storedCheckinTime, signSendReceipt, verifySendReceipt, validChallenge,
  signPaymentProof, verifyPaymentProof, assertPaymentUrl, PAYMENT_HOSTS, CAP_PAY_PROOF, RELAY_CAPS, signPaymentConfirmation, verifyPaymentConfirmation, sealedDigest, originOf, assertCertOrigin, isLocalHost, messageDigest, boxItems, validAckItem };
