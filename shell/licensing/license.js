// רישיונות חתומים בשרשרת: שורש (Owner) ← לקוח ← מערכת בת ← ... (docs/LICENSING-DESIGN.md).
// כל רישיון חתום ב-Ed25519 ע"י מפתח הצומת של ההורה; רישיון של לקוח — ע"י מפתח השורש.
// האימות בודק גם חתימות וגם שהילד אינו מקבל יותר מההורה. ללא תלות ב-Electron או ברשת.
const crypto = require('crypto');

const LICENSE_VERSION = 1;
const LIMIT_KEYS = ['maxChildren', 'maxUsers', 'maxStorageMb', 'maxDepth'];
const FEATURE_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

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
    || Buffer.from(publicJwk.x, 'base64url').length !== 32) {
    throw new Error('מפתח ציבורי לא תקין');
  }
  return b64u(crypto.createHash('sha256').update(Buffer.from(publicJwk.x, 'base64url')).digest().subarray(0, 16));
}

const publicOf = (jwk) => ({ kty: 'OKP', crv: 'Ed25519', x: jwk.x });

function generateKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'jwk' });
  return { privateJwk: priv, publicJwk: publicOf(priv), keyId: keyId(priv) };
}

function signObject(obj, privateJwk) {
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  return b64u(crypto.sign(null, Buffer.from(canonical(obj)), key));
}

function verifyObject(obj, sig, publicJwk) {
  if (typeof sig !== 'string') return false;
  try {
    const key = crypto.createPublicKey({ key: publicOf(publicJwk), format: 'jwk' });
    return crypto.verify(null, Buffer.from(canonical(obj)), key, Buffer.from(sig, 'base64url'));
  } catch { return false; }
}

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

// הנפקה. issuer = { privateJwk, license? } — בלי license זו חתימת שורש (לקוח ברמה 1)
function issueLicense(issuer, input) {
  const parent = issuer.license ? issuer.license.payload : null;
  if (parent && keyId(issuer.privateJwk) !== parent.id) throw new Error('המפתח אינו תואם לרישיון המנפיק');
  const payload = buildPayload({
    ...input,
    parentId: parent ? parent.id : null,
    depth: parent ? parent.depth + 1 : 1,
  });
  const problem = checkAgainstParent(payload, parent);
  if (problem) throw new Error(problem);
  return { payload, sig: signObject(payload, issuer.privateJwk) };
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
    const problem = checkAgainstParent(lic.payload, parent);
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
  canonical, keyId, publicOf, generateKeyPair, signObject, verifyObject,
  issueLicense, verifyChain, checkAgainstParent, validity,
};
