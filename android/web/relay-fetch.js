// הפנייה היחידה לרשת בגרסת אנדרואיד: בקשה לשרת הרישוי (shell/licensing/remote.js — POST ל-<origin>/v1).
// ה-WebView עצמו חסום לרשת (setBlockNetworkLoads ו-AssetServer), ולכן הבקשה עוברת לגשר ב-Java (relayPost),
// שמאמת שוב: https בלבד, POST בלבד, הנתיב /v1 בלבד, בלי הפניות (redirect) ועם תקרה לגודל התשובה.
// כל כתובת אחרת (הורדת עדכון, כניסה עם Google וכו') נדחית כאן — באנדרואיד אין להן מסלול לרשת.
'use strict';

const MAX_REQUEST_CHARS = 8 * 1024 * 1024;
const DENIED = 'באנדרואיד מותרת פנייה לרשת רק לשרת הרישוי';
const NO_CONNECTION = 'אין חיבור לשרת הרישוי. בדקו את החיבור לאינטרנט ואת כתובת השרת';

// כתובת מותרת: https://<מארח>[:פורט]/v1 בלבד (בלי משתמש/סיסמה, שאילתה או עוגן)
function relayOrigin(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.pathname !== '/v1' || u.search || u.hash) return null;
  return u.origin;
}

function abortError() {
  const e = new Error('הבקשה בוטלה');
  e.name = 'AbortError';
  return e;
}

// bridgeAsync(method, ...args) — הגשר האסינכרוני של host.js (התשובה חוזרת ב-__ssAndroidCb)
function createRelayFetch(bridgeAsync) {
  return async function relayFetch(url, opts = {}) {
    const origin = relayOrigin(url);
    if (!origin || String(opts.method || 'GET').toUpperCase() !== 'POST') throw new Error(DENIED);
    const body = typeof opts.body === 'string' ? opts.body : '';
    if (body.length > MAX_REQUEST_CHARS) throw new Error('הבקשה לשרת הרישוי גדולה מדי');
    const signal = opts.signal;
    if (signal && signal.aborted) throw abortError();
    const call = bridgeAsync('relayPost', origin, body);
    const r = await (signal ? Promise.race([call, new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))]) : call);
    if (!r || !Number.isInteger(r.status)) throw new Error((r && typeof r.error === 'string' && r.error) || NO_CONNECTION);
    const text = typeof r.body === 'string' ? r.body : '';
    // מספיק ל-readJsonCapped ב-remote.js: בלי body.getReader — json() (הגודל כבר הוגבל ב-Java)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
}

module.exports = { createRelayFetch, relayOrigin, DENIED };
