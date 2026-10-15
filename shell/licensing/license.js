// רישיונות חתומים בשרשרת: שורש (Owner) ← לקוח ← מערכת בת ← ... (docs/LICENSING-DESIGN.md).
// כל רישיון חתום ב-Ed25519 ע"י מפתח הצומת של ההורה; רישיון של לקוח — ע"י מפתח השורש.
// האימות בודק גם חתימות וגם שהילד אינו מקבל יותר מההורה. ללא תלות ב-Electron או ברשת.
// קריפטוגרפיה: node:crypto בשולחן העבודה; באנדרואיד (node-shims, בלי sign/verify) — crypto-lite.js.
// בלי Buffer: ה-shim של אנדרואיד אינו תומך ב-base64url.
const crypto = require('crypto');
const C = require('./crypto-lite');

const LICENSE_VERSION = 1;
const LIMIT_KEYS = ['maxChildren', 'maxUsers', 'maxStorageMb', 'maxDepth'];
const FEATURE_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const NATIVE = !!(crypto && typeof crypto.sign === 'function' && typeof crypto.createPrivateKey === 'function');
// לבדיקות: כפיית המימוש הטהור, כמו באנדרואיד
let forceLite = false;
const useNative = () => NATIVE && !forceLite;
function _forceLite(v) { forceLite = !!v; }

const backend = {
  sha256: (bytes) => (useNative() ? new Uint8Array(crypto.createHash('sha256').update(bytes).digest()) : C.sha256(bytes)),
  randomSeed: () => new Uint8Array(crypto.randomBytes(32)),
  publicFromSeed(seed) {
    if (!useNative()) return C.ed25519.getPublicKey(seed);
    const jwk = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: C.b64uEncode(seed), x: C.b64uEncode(C.ed25519.getPublicKey(seed)) }, format: 'jwk' })
      .export({ format: 'jwk' });
    return C.b64uDecode(jwk.x);
  },
  sign(msg, privateJwk) {
    if (!useNative()) return C.ed25519.sign(msg, C.b64uDecode(privateJwk.d));
    return new Uint8Array(crypto.sign(null, msg, crypto.createPrivateKey({ key: privateJwk, format: 'jwk' })));
  },
  verify(msg, sig, publicJwk) {
    if (!useNative()) return C.ed25519.verify(sig, msg, C.b64uDecode(publicJwk.x));
    return crypto.verify(null, msg, crypto.createPublicKey({ key: publicJwk, format: 'jwk' }), sig);
  },
};
const b64u = C.b64uEncode;
const b64uLen = (s) => { try { return C.b64uDecode(s).length; } catch { return -1; } };

// JSON קנוני: מפתחות ממוינים, בלי רווחים — כדי שאותו תוכן ייתן תמיד אותם בתים לחתימה
function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('ערך מספרי לא תקין ברישיון');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function keyId(publicJwk) {
  if (!publicJwk || publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || typeof publicJwk.x !== 'string'
    || b64uLen(publicJwk.x) !== 32) {
    throw new Error('מפתח ציבורי לא תקין');
  }
  return b64u(backend.sha256(C.b64uDecode(publicJwk.x)).subarray(0, 16));
}

const publicOf = (jwk) => ({ kty: 'OKP', crv: 'Ed25519', x: jwk.x });

function generateKeyPair() {
  const seed = backend.randomSeed();
  const x = b64u(backend.publicFromSeed(seed));
  const priv = { kty: 'OKP', crv: 'Ed25519', d: b64u(seed), x };
  return { privateJwk: priv, publicJwk: publicOf(priv), keyId: keyId(priv) };
}

function signObject(obj, privateJwk) {
  if (!privateJwk || typeof privateJwk.d !== 'string' || b64uLen(privateJwk.d) !== 32) throw new Error('מפתח פרטי לא תקין');
  return b64u(backend.sign(C.utf8(canonical(obj)), privateJwk));
}

function verifyObject(obj, sig, publicJwk) {
  if (typeof sig !== 'string') return false;
  try {
    const raw = C.b64uDecode(sig);
    if (raw.length !== 64) return false;
    return backend.verify(C.utf8(canonical(obj)), raw, publicOf(publicJwk));
  } catch { return false; }
}

// SHA-256 של טקסט, ב-hex — לרישום ביומן ולהשוואת תוכן
const sha256Hex = (text) => Array.from(backend.sha256(C.utf8(text)), b => b.toString(16).padStart(2, '0')).join('');

function normalizeFeatures(features) {
  if (!Array.isArray(features)) throw new Error('רשימת תכונות חסרה');
  for (const f of features) if (typeof f !== 'string' || !FEATURE_RE.test(f)) throw new Error(`שם תכונה לא תקין: ${f}`);
  return [...new Set(features)].sort();
}

function normalizeLimits(limits) {
  const out = {};
  for (const k of LIMIT_KEYS) {
    const v = limits && limits[k];
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`מגבלה לא תקינה: ${k}`);
    out[k] = v;
  }
  return out;
}

function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  if (!s) throw new Error('שם המערכת חסר');
  return s;
}

// בניית תוכן רישיון ובדיקת תקינות בסיסית (בלי קשר להורה)
function buildPayload(input) {
  const issuedAt = input.issuedAt;
  const expiresAt = input.expiresAt;
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    throw new Error('תאריכי תוקף לא תקינים');
  }
  const graceDays = input.graceDays == null ? 7 : input.graceDays;
  if (!Number.isSafeInteger(graceDays) || graceDays < 0 || graceDays > 90) throw new Error('תקופת חסד לא תקינה');
  return {
    v: LICENSE_VERSION,
    id: keyId(input.publicKey),
    parentId: input.parentId || null,
    depth: input.depth,
    slot: input.slot,
    name: cleanName(input.name),
    publicKey: publicOf(input.publicKey),
    features: normalizeFeatures(input.features),
    limits: normalizeLimits(input.limits),
    issuedAt,
    expiresAt,
    graceDays,
  };
}

// בדיקת "הילד לעולם לא מקבל יותר מההורה". parent = null עבור רישיון שהשורש חתם עליו
function checkAgainstParent(child, parent) {
  if (!parent) {
    if (child.parentId !== null || child.depth !== 1) return 'רישיון לקוח חייב להיות בעומק 1 וללא הורה';
    if (!Number.isSafeInteger(child.slot) || child.slot < 1) return 'מספר משבצת לא תקין';
    return null;
  }
  if (child.parentId !== parent.id) return 'הרישיון אינו שייך להורה הזה';
  if (child.depth !== parent.depth + 1) return 'עומק הרישיון אינו תואם להורה';
  if (child.depth > parent.limits.maxDepth) return 'ההורה אינו רשאי להנפיק מערכות בעומק הזה';
  if (parent.limits.maxChildren < 1) return 'ההורה אינו רשאי להנפיק מערכות בת';
  if (!Number.isSafeInteger(child.slot) || child.slot < 1 || child.slot > parent.limits.maxChildren) {
    return 'חריגה ממכסת מערכות הבת של ההורה';
  }
  const parentFeatures = new Set(parent.features);
  const extra = child.features.filter(f => !parentFeatures.has(f));
  if (extra.length) return `תכונות שאינן פתוחות להורה: ${extra.join(', ')}`;
  for (const k of LIMIT_KEYS) if (child.limits[k] > parent.limits[k]) return `המגבלה ${k} גבוהה מזו של ההורה`;
  if (child.expiresAt > parent.expiresAt) return 'תוקף הרישיון ארוך מתוקף ההורה';
  return null;
}

// בדיקת תנאים מבוקשים מול ההורה, לפני הנפקה (משבצת ברירת מחדל 1 — נקבעת אצל מנהל-העל)
function checkTerms(parent, terms) {
  let features, limits;
  try { features = normalizeFeatures(terms.features); limits = normalizeLimits(terms.limits); } catch (e) { return e.message; }
  if (!Number.isSafeInteger(terms.expiresAt)) return 'תאריכי תוקף לא תקינים';
  return checkAgainstParent({ parentId: parent.id, depth: parent.depth + 1, slot: terms.slot == null ? 1 : terms.slot,
    features, limits, expiresAt: terms.expiresAt }, parent);
}

// אישור מנהל-העל למערכת בת: כל רישיון בעומק 2 ומעלה חייב לשאת אישור חתום במפתח השורש.
// כך לקוח אינו יכול להנפיק מערכת בת בלי אישור — גם אם הוא מחזיק את המפתח הפרטי שלו
function createApproval(rootPrivateJwk, input) {
  if (typeof input.id !== 'string' || !input.id) throw new Error('מזהה אישור חסר');
  for (const k of ['depth', 'slot', 'expiresAt', 'approvedAt']) {
    if (!Number.isSafeInteger(input[k]) || input[k] < 1) throw new Error('שדה לא תקין באישור: ' + k);
  }
  const graceDays = input.graceDays == null ? 7 : input.graceDays;
  if (!Number.isSafeInteger(graceDays) || graceDays < 0 || graceDays > 90) throw new Error('תקופת חסד לא תקינה');
  const payload = {
    v: 1, type: 'approval', id: input.id,
    parentId: input.parentId, childId: keyId(input.childPublicKey), childPublicKey: publicOf(input.childPublicKey),
    depth: input.depth, slot: input.slot, name: cleanName(input.name),
    features: normalizeFeatures(input.features), limits: normalizeLimits(input.limits),
    expiresAt: input.expiresAt, graceDays, approvedAt: input.approvedAt,
  };
  return { payload, sig: signObject(payload, rootPrivateJwk) };
}

function checkApproval(approval, child, rootKeys) {
  const a = approval && approval.payload;
  if (!a) return 'מערכת בת דורשת אישור של מנהל-העל';
  if (a.v !== 1 || a.type !== 'approval') return 'אישור בפורמט לא מוכר';
  if (!(rootKeys || []).some(k => verifyObject(a, approval.sig, k))) return 'האישור אינו חתום על ידי מנהל-העל';
  if (a.childId !== child.id || a.parentId !== child.parentId || a.depth !== child.depth || a.slot !== child.slot) {
    return 'האישור אינו תואם למערכת הזו';
  }
  const approved = new Set(a.features || []);
  if (child.features.some(f => !approved.has(f))) return 'הרישיון חורג מהתכונות שאושרו';
  for (const k of LIMIT_KEYS) if (!(child.limits[k] <= (a.limits || {})[k])) return 'הרישיון חורג מהמגבלות שאושרו';
  if (child.expiresAt > a.expiresAt || child.graceDays > a.graceDays) return 'הרישיון חורג מהתוקף שאושר';
  return null;
}

// הנפקה. issuer = { privateJwk, license? } — בלי license זו חתימת שורש (לקוח ברמה 1).
// מערכת בת (יש license להורה): חובה input.approval ו-opts.rootKeys לאימות האישור
function issueLicense(issuer, input, opts = {}) {
  const parent = issuer.license ? issuer.license.payload : null;
  if (parent && keyId(issuer.privateJwk) !== parent.id) throw new Error('המפתח אינו תואם לרישיון המנפיק');
  const payload = buildPayload({
    ...input,
    parentId: parent ? parent.id : null,
    depth: parent ? parent.depth + 1 : 1,
  });
  const problem = checkAgainstParent(payload, parent) || (parent ? checkApproval(input.approval, payload, opts.rootKeys) : null);
  if (problem) throw new Error(problem);
  const lic = { payload, sig: signObject(payload, issuer.privateJwk) };
  if (parent) lic.approval = input.approval;
  return lic;
}

// אימות שרשרת מלאה [רישיון לקוח, ..., רישיון הצומת] מול מפתחות השורש המהימנים.
// מחזיר את רישיון הצומת המאומת, או זורק עם סיבה בעברית
function verifyChain(chain, rootKeys) {
  if (!Array.isArray(chain) || chain.length === 0) throw new Error('שרשרת הרישיונות ריקה');
  if (!Array.isArray(rootKeys) || rootKeys.length === 0) throw new Error('לא הוגדר מפתח שורש מהימן');
  let parent = null;
  for (let i = 0; i < chain.length; i++) {
    const lic = chain[i];
    if (!lic || typeof lic !== 'object' || !lic.payload || lic.payload.v !== LICENSE_VERSION) {
      throw new Error('רישיון בפורמט לא מוכר');
    }
    // בנייה מחדש מנרמלת ותופסת שדות חסרים/פגומים; השוואה קנונית תופסת שדות עודפים
    let payload;
    try { payload = buildPayload(lic.payload); } catch (e) { throw new Error(`רישיון פגום: ${e.message}`); }
    payload.parentId = lic.payload.parentId;
    payload.depth = lic.payload.depth;
    payload.slot = lic.payload.slot;
    if (canonical(payload) !== canonical(lic.payload) || payload.id !== lic.payload.id) throw new Error('רישיון פגום');

    const signers = parent ? [parent.publicKey] : rootKeys;
    if (!signers.some(k => verifyObject(lic.payload, lic.sig, k))) throw new Error('חתימת הרישיון אינה תקינה');
    const problem = checkAgainstParent(lic.payload, parent) || (parent ? checkApproval(lic.approval, lic.payload, rootKeys) : null);
    if (problem) throw new Error(problem);
    parent = lic.payload;
  }
  return parent;
}

// מצב התוקף לפי זמן: active / grace / expired
function validity(payload, now) {
  if (now < payload.issuedAt) return { state: 'not-yet-valid' };
  if (now <= payload.expiresAt) return { state: 'active' };
  const graceUntil = payload.expiresAt + payload.graceDays * DAY_MS;
  if (now <= graceUntil) return { state: 'grace', graceUntil };
  return { state: 'expired', graceUntil };
}

module.exports = {
  LICENSE_VERSION, LIMIT_KEYS, DAY_MS,
  canonical, keyId, publicOf, generateKeyPair, signObject, verifyObject, sha256Hex, _forceLite,
  issueLicense, verifyChain, checkAgainstParent, checkTerms, createApproval, checkApproval, validity,
};
