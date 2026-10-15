// חלוקת סוד (Shamir Secret Sharing) מעל GF(256) — לגיבוי מפתח מנהל-העל.
// הסוד (32 בתים) מחולק ל-n חלקים; כל k מהם משחזרים אותו, ופחות מ-k אינם מגלים עליו דבר.
// כל חלק כולל מזהה סט (כדי לא לערבב חלקים מגיבויים שונים) ותמצית ביקורת לזיהוי שגיאת הקלדה.
const C = require('./crypto-lite');

// טבלאות לוגריתם מעל GF(2^8) עם הפולינום 0x11b (כמו AES)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // כפל ב-3 (יוצר החבורה)
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => { if (b === 0) throw new Error('חלוקה באפס'); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };

function randomBytes(n) {
  const b = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b.set(require('crypto').randomBytes(n));
  return b;
}

// חלוקה: מחזיר n חלקים [{ x, y: Uint8Array }]
function split(secret, n, k) {
  if (!(secret instanceof Uint8Array) || !secret.length) throw new Error('סוד לא תקין');
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > 255) throw new Error('מספר החלקים אינו תקין (לפחות 2 מתוך 2, עד 255)');
  const shares = Array.from({ length: n }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }));
  for (let b = 0; b < secret.length; b++) {
    const coef = randomBytes(k - 1);
    for (const s of shares) {
      // הערכת הפולינום בנקודה x (Horner)
      let acc = 0;
      for (let j = k - 2; j >= 0; j--) acc = mul(acc, s.x) ^ coef[j];
      s.y[b] = mul(acc, s.x) ^ secret[b];
    }
  }
  return shares;
}

// שחזור באינטרפולציית לגרנז' בנקודה 0
function combine(shares) {
  const xs = shares.map(s => s.x);
  if (new Set(xs).size !== xs.length) throw new Error('אותו חלק הוזן פעמיים');
  const len = shares[0].y.length;
  if (shares.some(s => s.y.length !== len)) throw new Error('החלקים אינם מאותו גיבוי');
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1, den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = mul(num, shares[j].x);
        den = mul(den, shares[i].x ^ shares[j].x);
      }
      acc ^= mul(shares[i].y[b], div(num, den));
    }
    out[b] = acc;
  }
  return out;
}

// ---------- ייצוג טקסטואלי של חלק ----------
// SSK1-<סט 8 תווים>-<k>-<x>-<נתונים base32>-<ביקורת 4 תווים>
const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 תווים קריאים — בלי 0/O/1/I/L
function toB32(bytes) {
  // ייצוג כמספר גדול בבסיס 31 — פשוט ובטוח לאורכים קצרים
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  const base = BigInt(B32.length);
  for (let i = 0; i < Math.ceil(bytes.length * 8 / Math.log2(B32.length)); i++) { s = B32[Number(n % base)] + s; n /= base; }
  return s;
}
function fromB32(s, len) {
  let n = 0n;
  const base = BigInt(B32.length);
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('תו לא תקין בקוד השחזור: ' + ch);
    n = n * base + BigInt(v);
  }
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  if (n !== 0n) throw new Error('קוד השחזור אינו תקין');
  return out;
}
const check = (str) => C.b64uEncode(C.sha256(C.utf8(str))).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();

function encodeShare(setId, k, share) {
  const body = `SSK1-${setId}-${k}-${share.x}-${toB32(share.y)}`;
  // קיבוץ לקבוצות של 5 לקריאה והקלדה
  return body + '-' + check(body);
}
function decodeShare(text) {
  const t = String(text || '').toUpperCase().replace(/\s+/g, '');
  const m = /^SSK1-([A-Z0-9]{8})-(\d{1,3})-(\d{1,3})-([A-Z0-9]+)-([A-Z0-9]{4})$/.exec(t);
  if (!m) throw new Error('קוד השחזור אינו בפורמט הנכון');
  const body = t.slice(0, t.lastIndexOf('-'));
  if (check(body) !== m[5]) throw new Error('קוד השחזור הוקלד עם שגיאה (ספרת ביקורת)');
  return { setId: m[1], k: Number(m[2]), x: Number(m[3]), y: fromB32(m[4], 32) };
}

// חלוקה של סוד בן 32 בתים לקודים טקסטואליים
function splitToCodes(secret32, n, k) {
  if (secret32.length !== 32) throw new Error('הסוד חייב להיות 32 בתים');
  const setId = toB32(randomBytes(5)).slice(-8).padStart(8, 'A');
  return { setId, codes: split(secret32, n, k).map(s => encodeShare(setId, k, s)) };
}
function combineCodes(codes) {
  const shares = codes.map(decodeShare);
  if (!shares.length) throw new Error('לא הוזנו קודים');
  const { setId, k } = shares[0];
  if (shares.some(s => s.setId !== setId || s.k !== k)) throw new Error('הקודים אינם מאותו גיבוי');
  if (shares.length < k) throw new Error(`נדרשים לפחות ${k} קודים`);
  return combine(shares.slice(0, k));
}

module.exports = { split, combine, splitToCodes, combineCodes, encodeShare, decodeShare };
