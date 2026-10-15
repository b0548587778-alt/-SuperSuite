// מפתחות זמניים (prekeys) להודעות — סודיות קדימה (forward secrecy).
// כל מערכת מחזיקה מפתח X25519 זמני שמתחלף כל שבוע, חתום במפתח הקבוע שלה ומפורסם בשרת.
// השולח מצפין לו + למפתח חד-פעמי משלו. המפתח הפרטי הזמני נמחק אחרי 30 יום — ואז הודעות ישנות
// אינן ניתנות לפענוח גם אם המפתח הקבוע של המערכת ייגנב בעתיד.
const L = require('./license');
const X = require('./crypto');

const ROTATE_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const BUNDLE_TYPE = 'supersuite-prekey';

function randomBytes(n) {
  const b = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b.set(require('crypto').randomBytes(n));
  return b;
}

// storage: { read(), write(text) } — מוצפן (DPAPI בשולחן העבודה)
function createPrekeyStore({ storage, clock = Date.now }) {
  const load = () => { try { return JSON.parse(storage.read() || '{"keys":[]}'); } catch { return { keys: [] }; } };
  const save = (d) => storage.write(JSON.stringify(d));

  // המפתח הנוכחי; יוצר חדש אם אין או שעבר שבוע, ומוחק פרטיים ישנים מ-30 יום
  function current() {
    const now = clock();
    const d = load();
    let keys = (d.keys || []).filter(k => now - k.createdAt < KEEP_MS);
    let cur = keys.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    let rotated = false;
    if (!cur || now - cur.createdAt >= ROTATE_MS) {
      const priv = randomBytes(32);
      cur = { id: X.b64uEncode(randomBytes(9)), priv: X.b64uEncode(priv), pub: X.b64uEncode(X.x25519.scalarMult(priv, X.x25519.BASE)), createdAt: now };
      keys = [...keys, cur];
      rotated = true;
    }
    if (rotated || keys.length !== (d.keys || []).length) save({ ...d, keys, published: rotated ? null : d.published });
    return { id: cur.id, pub: cur.pub, createdAt: cur.createdAt, rotated };
  }
  function privOf(id) {
    const k = (load().keys || []).find(x => x.id === id);
    return k ? X.b64uDecode(k.priv) : null;
  }
  // חבילה חתומה במפתח הקבוע — לפרסום בשרת
  function bundle(myJwk) {
    const c = current();
    const payload = { type: BUNDLE_TYPE, v: 1, owner: L.keyId(myJwk), id: c.id, pub: c.pub, createdAt: c.createdAt };
    return { ...payload, sig: L.signObject(payload, myJwk) };
  }
  const needsPublish = () => { const c = current(); return load().published !== c.id; };
  const markPublished = (id) => save({ ...load(), published: id });
  return { current, privOf, bundle, needsPublish, markPublished };
}

// אימות חבילה של איש קשר: חתומה במפתח הקבוע שלו, ולא ישנה מדי
function verifyBundle(b, peerPublicJwk, now = Date.now()) {
  if (!b || b.type !== BUNDLE_TYPE || typeof b.sig !== 'string') return null;
  const { sig, ...payload } = b;
  if (payload.owner !== L.keyId(peerPublicJwk)) return null;
  if (!L.verifyObject(payload, sig, peerPublicJwk)) return null;
  if (!(now - payload.createdAt < KEEP_MS - ROTATE_MS)) return null; // מפתח שעומד להימחק אצל הנמען — לא משתמשים
  try { if (X.b64uDecode(payload.pub).length !== 32) return null; } catch { return null; }
  return { id: payload.id, pub: payload.pub };
}

module.exports = { createPrekeyStore, verifyBundle, ROTATE_MS, KEEP_MS, BUNDLE_TYPE };
