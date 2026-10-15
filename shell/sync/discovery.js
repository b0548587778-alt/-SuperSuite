// גילוי עמיתים ברשת המקומית (docs/SYNC-DESIGN.md, שלב 2).
// כל מכשיר משדר כל חצי דקה "משואה" ב-UDP multicast (TTL=1 — לא יוצא מהרשת המקומית).
// פרטיות: במשואה אין מזהה, שם או מפתח. יש בה רק תגיות HMAC — תגית לכל עמית מצומד, במפתח
// שנגזר לזוג (X25519 → HKDF, שימוש נפרד מהמעטפה). רק עמית מצומד מזהה את השולח; לכל השאר
// המשואה היא רעש אקראי שמשתנה בכל שידור, ואי אפשר לעקוב אחרי המכשיר ברשת.
// המשואה היא רק רמז לכתובת: החיבור עצמו מאומת בהצמדת מפתח (transport.js), כך שמשואה מזויפת
// יכולה לכל היותר לגרום לניסיון חיבור שייכשל.
const crypto = require('crypto');
const dgram = require('dgram');
const { deriveKey, MAX_SKEW_MS } = require('./envelope');

const GROUP = '239.255.77.77'; // טווח multicast לשימוש ארגוני מקומי (RFC 2365)
const PORT = 47777;
const INFO = Buffer.from('SuperSuite-sync v1 discovery');
const TAG_BYTES = 12;
const MAX_TAGS = 64;
const MAX_BEACON = 2048;

// התגית תלויה בכיוון (שולח → מקבל). מפתח הזוג סימטרי, ובלי הכיוון מכשיר היה מזהה את המשואה של עצמו
// (שחוזרת אליו ב-multicast loopback) כאילו נשלחה מהעמית — ושומר את הכתובת של עצמו ככתובת העמית
const tagFor = (key, from, to, ts, nonce, port) => crypto.createHmac('sha256', key)
  .update(`beacon|${from}>${to}|${ts}|${nonce}|${port}`).digest().subarray(0, TAG_BYTES).toString('base64url');

// מפתחות הגילוי לכל עמית מצומד (מחושבים פעם אחת לכל רשימת עמיתים)
function discoveryKeys(identity, peers) {
  return peers.filter(p => !p.revoked).map(p => ({ self: identity.id, id: p.id, key: deriveKey(identity, p, INFO) }));
}

function buildBeacon(keys, port, now = Date.now()) {
  const nonce = crypto.randomBytes(12).toString('base64url');
  // סדר התגיות מעורבב, ותגיות דמה משלימות למספר קבוע — אי אפשר להסיק כמה עמיתים יש למכשיר
  const tags = keys.slice(0, MAX_TAGS).map(k => tagFor(k.key, k.self, k.id, now, nonce, port));
  while (tags.length < Math.min(8, MAX_TAGS)) tags.push(crypto.randomBytes(TAG_BYTES).toString('base64url'));
  for (let i = tags.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [tags[i], tags[j]] = [tags[j], tags[i]]; }
  return Buffer.from(JSON.stringify({ v: 1, p: port, ts: now, n: nonce, t: tags }));
}

// seen: Set של nonce שכבר התקבלו (מונע עיבוד חוזר). מחזיר { peerId, host, port } או null
function parseBeacon(keys, buf, rinfo, seen, now = Date.now()) {
  if (!Buffer.isBuffer(buf) || buf.length > MAX_BEACON) return null;
  let b;
  try { b = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!b || b.v !== 1 || !Number.isInteger(b.p) || b.p < 1 || b.p > 65535 || !Number.isSafeInteger(b.ts)
    || typeof b.n !== 'string' || b.n.length > 32 || !Array.isArray(b.t) || b.t.length > MAX_TAGS) return null;
  if (Math.abs(now - b.ts) > MAX_SKEW_MS) return null;
  if (seen.has(b.n)) return null;
  const tags = new Set(b.t.filter(t => typeof t === 'string'));
  for (const k of keys) {
    const expected = tagFor(k.key, k.id, k.self, b.ts, b.n, b.p);
    if (tags.has(expected)) {
      seen.add(b.n);
      if (seen.size > 4096) seen.delete(seen.values().next().value);
      return { peerId: k.id, host: rinfo.address, port: b.p };
    }
  }
  return null;
}

// הפעלת הגילוי. onFound({ peerId, host, port }) — לכל עמית מצומד שנשמע.
// listenPort: הפורט שבו ה-transport מאזין (מפורסם במשואה)
function startDiscovery({ identity, getPeers, listenPort, onFound, intervalMs = 30000, group = GROUP, port = PORT, now = Date.now }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Set();
  let peersRef = null;
  let keys = [];
  const currentKeys = () => {
    const peers = getPeers();
    if (peers !== peersRef) { peersRef = peers; keys = discoveryKeys(identity, peers); }
    return keys;
  };
  const announce = () => {
    const k = currentKeys();
    if (!k.length) return; // אין עמיתים — אין מה לשדר
    socket.send(buildBeacon(k, listenPort, now()), port, group, () => {});
  };
  socket.on('message', (buf, rinfo) => {
    const found = parseBeacon(currentKeys(), buf, rinfo, seen, now());
    if (found) onFound(found);
  });
  socket.on('error', () => {}); // רשת לא זמינה — הגילוי פשוט לא פעיל; החיבור הידני עדיין עובד
  let timer = null;
  const ready = new Promise((resolve) => {
    socket.bind(port, () => {
      try {
        socket.addMembership(group);
        socket.setMulticastTTL(1);
        socket.setMulticastLoopback(true);
      } catch { /* אין ממשק multicast */ }
      announce();
      timer = setInterval(announce, intervalMs);
      resolve();
    });
  });
  return {
    ready,
    announce,
    stop: () => new Promise((resolve) => { clearInterval(timer); try { socket.close(resolve); } catch { resolve(); } }),
  };
}

module.exports = { buildBeacon, parseBeacon, discoveryKeys, startDiscovery, GROUP, PORT };
