// כניסה עם חשבון Google — לפי ההנחיות של Google לאפליקציות שולחן עבודה (RFC 8252):
// הכניסה נעשית בדפדפן של המחשב (לא בחלון פנימי של התוכנה, שגוגל חוסמת), והתשובה חוזרת לכתובת מקומית
// (127.0.0.1 ופורט אקראי) שהתוכנה מאזינה לה לזמן קצר. PKCE (S256) ו-state מונעים גניבת קוד והתחזות.
// אסימון הזהות (id_token) נבדק כאן במלואו: חתימה (RS256) מול המפתחות הציבוריים של Google, מנפיק, קהל, תוקף ו-nonce.
// לא נשמר שום אסימון — רק הזהות (sub) לקישור למשתמש מקומי.
'use strict';
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const WAIT_MS = 3 * 60 * 1000;      // זמן לכניסה בדפדפן
const CLOCK_SKEW_S = 300;
const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const random = (n = 32) => b64u(crypto.randomBytes(n));

function validateConfig(cfg) {
  const c = cfg || {};
  const clientId = String(c.clientId || '').trim();
  if (!CLIENT_ID_RE.test(clientId)) throw new Error('מזהה הלקוח של Google אינו תקין (נראה כמו 1234-abc.apps.googleusercontent.com)');
  const clientSecret = String(c.clientSecret || '').trim();
  // באפליקציית שולחן עבודה ה"סוד" אינו סודי (גוגל מציינת זאת), אבל נדרש בהחלפת הקוד
  if (clientSecret && !/^[A-Za-z0-9_-]{10,80}$/.test(clientSecret)) throw new Error('סוד הלקוח של Google אינו תקין');
  return { clientId, clientSecret };
}

// ---------- אימות אסימון הזהות ----------
let certCache = { at: 0, keys: [] };
async function googleKeys(fetchImpl, now, force = false) {
  if (!force && certCache.keys.length && now - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const r = await fetchImpl(CERTS_URL);
  if (!r.ok) throw new Error('לא ניתן לקבל את מפתחות האימות של Google');
  const j = await r.json();
  certCache = { at: now, keys: Array.isArray(j.keys) ? j.keys : [] };
  return certCache.keys;
}

// מחזיר את התוכן המאומת, או זורק שגיאה בעברית
async function verifyIdToken(idToken, { clientId, nonce, fetchImpl = globalThis.fetch, now = Date.now(), keys } = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('תשובת Google אינה תקינה');
  let header, payload;
  try { header = JSON.parse(unb64u(parts[0]).toString('utf8')); payload = JSON.parse(unb64u(parts[1]).toString('utf8')); }
  catch { throw new Error('תשובת Google אינה תקינה'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('תשובת Google אינה חתומה כנדרש');
  let list = keys || await googleKeys(fetchImpl, now);
  let jwk = list.find(k => k.kid === header.kid);
  if (!jwk && !keys) { list = await googleKeys(fetchImpl, now, true); jwk = list.find(k => k.kid === header.kid); } // מפתח שהתחלף
  if (!jwk || jwk.kty !== 'RSA') throw new Error('מפתח החתימה של Google לא נמצא');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }), unb64u(parts[2]));
  if (!ok) throw new Error('חתימת Google אינה תקינה');
  const t = Math.floor(now / 1000);
  if (!ISSUERS.has(payload.iss)) throw new Error('המנפיק אינו Google');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('האסימון לא הונפק לתוכנה הזו');
  if (!(Number(payload.exp) > t - CLOCK_SKEW_S)) throw new Error('תוקף הכניסה פג — נסו שוב');
  if (Number(payload.iat) > t + CLOCK_SKEW_S) throw new Error('שעון המחשב אינו מדויק');
  if (nonce !== undefined && payload.nonce !== nonce) throw new Error('תשובת Google אינה שייכת לבקשה הזו');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('תשובת Google אינה תקינה');
  if (payload.email && payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('כתובת הדוא"ל בחשבון Google לא אומתה');
  return { sub: payload.sub, email: String(payload.email || '').toLowerCase(), name: String(payload.name || '').slice(0, 120) };
}

// ---------- זרימת הכניסה ----------
const PAGE = (title, body) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,Arial;background:#f8fafc;display:grid;place-items:center;height:100vh;margin:0}
div{background:#fff;padding:2rem 2.5rem;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}</style></head>
<body><div><h2>${title}</h2><p>${body}</p></div></body></html>`;

/* פותח את הדפדפן לכניסה וממתין לחזרה. openBrowser(url) — מוזרק (shell.openExternal בשולחן העבודה).
   מחזיר { sub, email, name }. login_hint — הדוא"ל המקושר, כדי שהדפדפן יציע את החשבון הנכון */
async function signIn(cfg, { openBrowser, fetchImpl = globalThis.fetch, loginHint, now = Date.now, waitMs = WAIT_MS } = {}) {
  const { clientId, clientSecret } = validateConfig(cfg);
  const verifier = random(48);
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = random(24);
  const nonce = random(24);
  let finish;
  const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  done.catch(() => {}); // תשובה (ביטול/פג זמן) יכולה להגיע עוד לפני שפתיחת הדפדפן הסתיימה — נקלטת ב-await למטה
  // נטען רק כאן: באנדרואיד אין מודול http (ושם הכניסה עם Google אינה זמינה)
  const server = require('http').createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
    const send = (ok, msg) => {
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end(PAGE(ok ? '✔ הכניסה הצליחה' : 'הכניסה לא הושלמה', ok ? 'אפשר לסגור את החלון ולחזור ל-SuperSuite.' : msg));
    };
    if (u.searchParams.get('state') !== state) { send(false, 'הבקשה אינה תואמת. נסו שוב מתוך התוכנה.'); return; }
    if (u.searchParams.get('error')) { send(false, 'הכניסה בוטלה.'); finish.reject(new Error('הכניסה עם Google בוטלה')); return; }
    const code = u.searchParams.get('code');
    if (!code) { send(false, 'חסר קוד כניסה.'); finish.reject(new Error('תשובת Google אינה תקינה')); return; }
    send(true);
    finish.resolve(code);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const timer = setTimeout(() => finish.reject(new Error('הזמן לכניסה עם Google עבר — נסו שוב')), waitMs);
  try {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      code_challenge: challenge, code_challenge_method: 'S256', state, nonce, prompt: 'select_account' });
    if (loginHint) q.set('login_hint', String(loginHint));
    await openBrowser(AUTH_URL + '?' + q.toString());
    const code = await done;
    const body = new URLSearchParams({ code, client_id: clientId, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
    if (clientSecret) body.set('client_secret', clientSecret);
    let r;
    try { r = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }); }
    catch { throw new Error('אין חיבור ל-Google. בלי אינטרנט — כניסה בסיסמה'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) throw new Error('Google דחתה את הכניסה' + (j.error_description ? ': ' + String(j.error_description).slice(0, 120) : ''));
    return await verifyIdToken(j.id_token, { clientId, nonce, fetchImpl, now: now() });
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

module.exports = { signIn, verifyIdToken, validateConfig, AUTH_URL, TOKEN_URL, CERTS_URL, _resetCache: () => { certCache = { at: 0, keys: [] }; } };
