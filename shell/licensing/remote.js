// לקוח לשרת הממסר (server/license-relay.js): שליחה וקבלה של קבצי רישוי בלי העברה ידנית.
// מופעל רק כשהוגדרה כתובת שרת — בלי כתובת התוכנה אופליין לגמרי (כלל 6).
// כל בקשה חתומה במפתח המערכת; התוכן עצמו (רישיון / אישור / הודעות) חתום בנפרד ונבדק בקליטה.
const L = require('./license');
const C = require('./crypto-lite');

const TIMEOUT_MS = 15000;

// כתובת מותרת: https בלבד, או http ל-localhost (פיתוח ובדיקות)
function validateUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('כתובת השרת אינה תקינה'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('כתובת השרת חייבת להתחיל ב-https://');
  if (u.username || u.password) throw new Error('כתובת השרת לא יכולה לכלול שם משתמש או סיסמה');
  return u.origin;
}

function randomNonce() {
  const b = new Uint8Array(18);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b.set(require('crypto').randomBytes(18));
  return C.b64uEncode(b);
}

// signer = מפתח פרטי (JWK) של התיבה. fetchImpl מוזרק לבדיקות
function createRemote({ url, fetchImpl = globalThis.fetch, clock = Date.now }) {
  const origin = validateUrl(url);
  if (typeof fetchImpl !== 'function') throw new Error('אין גישה לרשת בגרסה זו');

  async function call(signer, op, payload) {
    const pub = L.publicOf(signer);
    const req = { pub, ts: clock(), nonce: randomNonce(), op, payload };
    req.sig = L.signObject({ pub, ts: req.ts, nonce: req.nonce, op, payload }, signer);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchImpl(origin + '/v1', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req), signal: ctrl ? ctrl.signal : undefined, redirect: 'error' });
    } catch {
      throw new Error('אין חיבור לשרת הרישוי. בדקו את החיבור לאינטרנט ואת כתובת השרת');
    } finally { if (timer) clearTimeout(timer); }
    let data;
    try { data = await res.json(); } catch { throw new Error('תשובה לא תקינה משרת הרישוי'); }
    if (!res.ok || !data || !data.ok) throw new Error((data && typeof data.error === 'string' && /[֐-׿]/.test(data.error)) ? data.error : 'שרת הרישוי דחה את הבקשה');
    return data;
  }

  return {
    origin,
    send: (signer, items) => call(signer, 'send', { items }),
    fetch: async (signer) => (await call(signer, 'fetch', {})).messages || [],
    ack: (signer, ids) => (ids.length ? call(signer, 'ack', { ids }) : Promise.resolve({ ok: true })),
    setOffer: (signer, offer) => call(signer, 'setOffer', { offer }),
    setPrekey: (signer, bundle) => call(signer, 'setPrekey', { bundle }),
    getPrekey: async (signer, id) => (await call(signer, 'getPrekey', { id })).bundle,
    getOffer: async (signer) => (await call(signer, 'getOffer', {})).offer,
    checkout: (signer, signup) => call(signer, 'checkout', { signup }),
    paymentStatus: (signer, paymentId) => call(signer, 'paymentStatus', { paymentId }),
  };
}

// מזהה התיבה של מפתח — זהה למזהה המערכת (keyId)
const mailboxOf = (publicJwk) => L.keyId(publicJwk);

module.exports = { createRemote, validateUrl, mailboxOf };
