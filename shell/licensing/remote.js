// לקוח לשרת הממסר (server/license-relay.js): שליחה וקבלה של קבצי רישוי בלי העברה ידנית.
// מופעל רק כשהוגדרה כתובת שרת — בלי כתובת התוכנה אופליין לגמרי (כלל 6).
// כל בקשה חתומה במפתח המערכת; התוכן עצמו (רישיון / אישור / הודעות) חתום בנפרד ונבדק בקליטה.
const L = require('./license');
const C = require('./crypto-lite');
const CK = require('./checkin');

const TIMEOUT_MS = 15000;
// השרת מחזיר את התיבה בחלקים (more). עד כאן בסבב אחד — השאר בסנכרון הבא
const FETCH_MAX_PAGES = 25;
// חלק אחד מהשרת: עד 2MB של הודעות + הודעה אחת גדולה. השרת אינו מהימן — גוף גדול יותר נדחה
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// אישור קבלה (ack): עד כאן הודעות בבקשה אחת — מזהה + תמצית לכל אחת, הרבה מתחת לתקרת הבקשה בשרת
const ACK_BATCH = 1000;

// קריאת גוף התשובה עם תקרה (בלי getReader — למשל fetch מדומה — json() כרגיל, בתוך אותו זמן קצוב)
const NETFREE_BLOCKED = 'הסינון באינטרנט (נטפרי או אחר) חוסם את שרת הרישוי. יש לבקש מחברת הסינון לאשר את הכתובת של שרת הרישוי';

async function readJsonCapped(res) {
  const len = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : NaN);
  if (Number.isFinite(len) && len > MAX_RESPONSE_BYTES) throw new Error('too-big');
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) return res.json();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) { try { await reader.cancel(); } catch { /* */ } throw new Error('too-big'); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

// כתובת מותרת: https בלבד, או http ל-localhost (פיתוח ובדיקות). אותה בדיקה כמו הכתובת שבתעודת השרת (checkin.js)
const validateUrl = CK.originOf;

function randomNonce() {
  const b = new Uint8Array(18);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b.set(require('crypto').randomBytes(18));
  return C.b64uEncode(b);
}

// signer = מפתח פרטי (JWK) של התיבה. fetchImpl מוזרק לבדיקות
const FETCH_CAPS = ['signup-v2'];
function createRemote({ url, fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = TIMEOUT_MS }) {
  const origin = validateUrl(url);
  if (typeof fetchImpl !== 'function') throw new Error('אין גישה לרשת בגרסה זו');

  async function call(signer, op, payload) {
    const pub = L.publicOf(signer);
    const req = { pub, ts: clock(), nonce: randomNonce(), op, payload };
    req.sig = L.signObject({ pub, ts: req.ts, nonce: req.nonce, op, payload }, signer);
    return post(req);
  }

  // בקשה חתומה מראש (אישור בקובץ: חתומה במחשב שאין בו חיבור, ונשלחת ממחשב מחובר)
  async function post(req) {
    // זמן קצוב אחד לכל הבקשה — גם לקריאת גוף התשובה: שרת שעונה בכותרות ואז "מטפטף" לא תוקע את הסנכרון
    // (בדיקת קוד 23.10.2026, ממצא 39)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    try {
      let res;
      try {
        res = await Promise.race([fetchImpl(origin + '/v1', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req), signal: ctrl ? ctrl.signal : undefined, redirect: 'error' }), deadline]);
      } catch {
        throw new Error('אין חיבור לשרת הרישוי. בדקו את החיבור לאינטרנט ואת כתובת השרת');
      }
      // מסנן תוכן (נטפרי) עונה 418 משלו — לא "השרת דחה": המשתמש צריך לפנות לסינון, לא לספק (25.10.2026)
      if (res.status === 418) throw new Error(NETFREE_BLOCKED);
      let data;
      try { data = await Promise.race([readJsonCapped(res), deadline]); } catch (e) {
        throw new Error(e && e.message === 'timeout' ? 'שרת הרישוי לא השלים את התשובה בזמן — נסו שוב מאוחר יותר' : 'תשובה לא תקינה משרת הרישוי');
      }
      if (!res.ok || !data || !data.ok) throw new Error((data && typeof data.error === 'string' && /[֐-׿]/.test(data.error)) ? data.error : 'שרת הרישוי דחה את הבקשה');
      return data;
    } finally { clearTimeout(timer); }
  }

  // משיכה בחלקים. challenge — אתגר אקראי לבדיקה החתומה (checkin.js): נשלח בחלק הראשון, והשרת מחזיר עליו
  // תשובה חתומה במפתח השרת יחד עם התעודה שלו. בלי challenge, או שרת ישן — attestation = null
  async function fetchMail(signer, { challenge } = {}) {
    const all = [];
    const seen = new Set();
    let after = null;
    let attestation = null;
    for (let page = 0; page < FETCH_MAX_PAGES; page++) {
      let r;
      // caps — מה הלקוח הזה יודע לקרוא (מסירת הרשמה מוצפנת). שרת ישן מתעלם; שרת חדש לא מוסר אותה ללקוח שלא הודיע
      const payload = { ...(after ? { after } : (challenge ? { checkin: challenge } : {})), caps: FETCH_CAPS };
      try { r = await call(signer, 'fetch', payload); } catch (e) { if (!page) throw e; break; }
      if (!page && challenge && r.checkin && typeof r.relayCert === 'string') attestation = { checkin: r.checkin, cert: r.relayCert };
      const msgs = Array.isArray(r.messages) ? r.messages : [];
      for (const m of msgs) if (m && !seen.has(m.id)) { seen.add(m.id); all.push(m); }
      if (r.more !== true || !msgs.length) break;
      after = msgs[msgs.length - 1].id;
    }
    return { messages: all, attestation };
  }

  return {
    origin,
    // receipt — אתגר לאישור מסירה חתום (checkin.js, verifySendReceipt): השרת חותם על כל הודעה שנשמרה. שרת ישן מתעלם
    send: (signer, items, { receipt } = {}) => call(signer, 'send', receipt ? { items, receipt } : { items }),
    // כל חלק בזמן קצוב משלו, כך שתיבה גדולה לא נתקעת (בדיקת קוד 22.10.2026, ממצא 1ד). חלק שנכשל אחרי
    // הראשון — מטפלים במה שכבר הגיע. שרת ישן מחזיר הכול בלי more
    fetch: async (signer) => (await fetchMail(signer)).messages,
    fetchMail,
    post,
    // מחיקת הודעות שטופלו. list — ההודעות עצמן (כפי שהתקבלו) או מזהים. עם הודעות נשלחת גם התמצית של כל אחת
    // (items): השרת מוחק רק הודעה שהתוכן השמור שלה זהה למה שהלקוח קיבל — שרת ביניים שהחליף תוכן של הודעה
    // (למשל השבתה) בתוכן ישן לא גורם למחיקת ההודעה האמיתית (ממצא 27). ids — לשרת ישן
    // בחלקים של עד ACK_BATCH — הבקשה נשארת קטנה מהתקרה של השרת (512KB)
    ack: async (signer, list) => {
      const objects = list.every(m => m && typeof m === 'object');
      let removed = 0;
      for (let i = 0; i < list.length; i += ACK_BATCH) {
        const part = list.slice(i, i + ACK_BATCH);
        const ids = part.map(m => String(objects ? m.id : m));
        const r = await call(signer, 'ack', objects ? { ids, items: part.map(m => [String(m.id), CK.messageDigest(m)]) } : { ids });
        removed += Number(r.removed) || 0;
      }
      return { ok: true, removed };
    },
    // הוכחה חתומה בלבד (בלי הודעות) — לפני שליחת פרטי הרשמה או פתיחת דף תשלום. null — שרת שלא החזיר הוכחה
    hello: async (signer, challenge) => {
      const r = await call(signer, 'checkin', { checkin: challenge });
      return r.checkin && typeof r.relayCert === 'string' ? { checkin: r.checkin, cert: r.relayCert } : null;
    },
    setOffer: (signer, offer) => call(signer, 'setOffer', { offer }),
    setPrekey: (signer, bundle) => call(signer, 'setPrekey', { bundle }),
    getPrekey: async (signer, id) => (await call(signer, 'getPrekey', { id })).bundle,
    // product — ההצעה של איזו תוכנה (מרכז הרישוי); שרת מגרסה קודמת מתעלם ומחזיר את ההצעה היחידה שלו
    getOffer: async (signer, product) => (await call(signer, 'getOffer', product ? { product } : {})).offer,
    // signup: { public, sealed } (מוצפן למנהל-העל), או טקסט גלוי — רק בבדיקות של תאימות לאחור
    // proof — אתגר לתשובה חתומה (checkin.js, verifyPaymentProof; f86). שרת ישן מתעלם
    checkout: (signer, signup, { proof } = {}) => call(signer, 'checkout', { ...(typeof signup === 'string' ? { signup } : { public: signup.public, sealed: signup.sealed }),
      ...(proof ? { proof } : {}) }),
    paymentStatus: (signer, paymentId, { proof } = {}) => call(signer, 'paymentStatus', { paymentId, ...(proof ? { proof } : {}) }),
  };
}

// מזהה התיבה של מפתח — זהה למזהה המערכת (keyId)
const mailboxOf = (publicJwk) => L.keyId(publicJwk);

module.exports = { createRemote, validateUrl, mailboxOf, randomNonce, MAX_RESPONSE_BYTES, TIMEOUT_MS };
