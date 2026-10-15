// תחליפים למודולים של Node (fs, path, crypto, node:sqlite, url) ול-Buffer — עבור הקוד של המודול הכלכלי
// כשהוא רץ בתוך WebView באנדרואיד. העבודה הכבדה (SQLite, scrypt, AES-GCM, קבצים) נעשית ב-Java דרך הגשר.
// הקובץ נטען גם ב-Node בבדיקות (tests/android-shims.test.js) עם גשר מדומה.
(function (root) {
  'use strict';

  function createNodeShims(rawBridge) {
    // כל מתודה בגשר מחזירה JSON: {"r": תוצאה} או {"e": "הודעת שגיאה"}
    function call(method, ...args) {
      const out = JSON.parse(rawBridge[method](...args));
      if (out && Object.prototype.hasOwnProperty.call(out, 'e')) throw new Error(out.e);
      return out ? out.r : undefined;
    }

    /* ---------- Buffer ---------- */
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function b64encode(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
        s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
      }
      return s;
    }
    function b64decode(str) {
      const clean = String(str).replace(/[^A-Za-z0-9+/]/g, '');
      const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
      let o = 0, acc = 0, bits = 0;
      for (const ch of clean) {
        acc = (acc << 6) | B64.indexOf(ch); bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
      }
      return out.subarray(0, o);
    }
    const enc = new TextEncoder();
    const dec = new TextDecoder('utf-8');

    class Buffer extends Uint8Array {
      static from(value, encoding) {
        if (typeof value === 'string') {
          const e = String(encoding || 'utf8').toLowerCase();
          if (e === 'hex') {
            const b = new Buffer(value.length >> 1);
            for (let i = 0; i < b.length; i++) b[i] = parseInt(value.substr(i * 2, 2), 16);
            return b;
          }
          if (e === 'base64') return Buffer.wrap(b64decode(value));
          if (e === 'latin1' || e === 'binary') {
            const b = new Buffer(value.length);
            for (let i = 0; i < value.length; i++) b[i] = value.charCodeAt(i) & 255;
            return b;
          }
          return Buffer.wrap(enc.encode(value));
        }
        if (value instanceof ArrayBuffer) return Buffer.wrap(new Uint8Array(value));
        if (ArrayBuffer.isView(value) || Array.isArray(value)) { const b = new Buffer(value.length); b.set(value); return b; }
        throw new TypeError('Buffer.from: סוג לא נתמך');
      }
      static wrap(u8) { const b = new Buffer(u8.length); b.set(u8); return b; }
      static alloc(n) { return new Buffer(n); }
      static isBuffer(x) { return x instanceof Buffer; }
      static concat(list) {
        const total = list.reduce((s, x) => s + x.length, 0);
        const b = new Buffer(total);
        let o = 0;
        for (const x of list) { b.set(x, o); o += x.length; }
        return b;
      }
      toString(encoding) {
        const e = String(encoding || 'utf8').toLowerCase();
        if (e === 'hex') return Array.from(this, x => x.toString(16).padStart(2, '0')).join('');
        if (e === 'base64') return b64encode(this);
        if (e === 'latin1' || e === 'binary') return Array.from(this, x => String.fromCharCode(x)).join('');
        return dec.decode(this);
      }
      equals(other) { return this.length === other.length && this.every((x, i) => x === other[i]); }
    }
    const toBuf = (x, encoding) => (x instanceof Uint8Array ? Buffer.from(x) : Buffer.from(String(x), encoding || 'utf8'));

    /* ---------- crypto ---------- */
    function randomUUID() {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
      const b = randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    function randomBytes(n) { return Buffer.from(call('randomBytes', n), 'base64'); }
    // scrypt ב-Java (מהיר בהרבה מ-JS). salt כמחרוזת = הבייטים שלה ב-UTF-8, כמו ב-Node
    function scryptSync(password, salt, keylen, opts) {
      const o = opts || {};
      const N = o.N || o.cost || 16384, r = o.r || o.blockSize || 8, p = o.p || o.parallelization || 1;
      return Buffer.from(call('scrypt', toBuf(password).toString('base64'), toBuf(salt).toString('base64'), N, r, p, keylen), 'base64');
    }
    function timingSafeEqual(a, b) {
      if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
      let d = 0;
      for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
      return d === 0;
    }
    // AES-256-GCM בממשק הזרם של Node: הנתונים נאספים, וההצפנה עצמה נעשית ב-final()
    function gcm(mode, algorithm, key, iv) {
      if (algorithm !== 'aes-256-gcm') throw new Error('אלגוריתם לא נתמך: ' + algorithm);
      const parts = [];
      let tag = null;
      return {
        update(data, inputEncoding) { parts.push(toBuf(data, inputEncoding)); return Buffer.alloc(0); },
        setAuthTag(t) { tag = Buffer.from(t); },
        getAuthTag() { if (!tag) throw new Error('getAuthTag לפני final'); return tag; },
        final() {
          const input = Buffer.concat(parts);
          if (mode === 'enc') {
            const out = Buffer.from(call('aesGcm', true, Buffer.from(key).toString('base64'), Buffer.from(iv).toString('base64'), input.toString('base64')), 'base64');
            tag = out.subarray(out.length - 16);
            return Buffer.from(out.subarray(0, out.length - 16));
          }
          if (!tag) throw new Error('חסר תג אימות');
          return Buffer.from(call('aesGcm', false, Buffer.from(key).toString('base64'), Buffer.from(iv).toString('base64'), Buffer.concat([input, tag]).toString('base64')), 'base64');
        }
      };
    }
    const crypto = {
      randomUUID, randomBytes, scryptSync, timingSafeEqual,
      createCipheriv: (a, k, iv) => gcm('enc', a, k, iv),
      createDecipheriv: (a, k, iv) => gcm('dec', a, k, iv)
    };

    /* ---------- node:sqlite ---------- */
    // הפרמטרים עוברים כ-JSON עם סוג, כדי שמספר יישאר מספר (ולא טקסט) ב-SQLite של אנדרואיד
    function encodeParams(params) {
      return JSON.stringify(params.map(v => {
        if (v === null || v === undefined) return { t: 'n' };
        if (typeof v === 'bigint') return { t: 'i', v: v.toString() };
        if (typeof v === 'number') return Number.isInteger(v) ? { t: 'i', v: String(v) } : { t: 'f', v };
        if (typeof v === 'boolean') return { t: 'i', v: v ? '1' : '0' };
        if (v instanceof Uint8Array) return { t: 'b', v: Buffer.from(v).toString('base64') };
        return { t: 's', v: String(v) };
      }));
    }
    class DatabaseSync {
      constructor(file) { this.name = String(file); call('dbOpen', this.name); }
      exec(sql) { call('dbExec', String(sql)); }
      prepare(sql) {
        const s = String(sql);
        return {
          run: (...params) => call('dbRun', s, encodeParams(params)),
          all: (...params) => call('dbAll', s, encodeParams(params)),
          get: (...params) => call('dbAll', s, encodeParams(params))[0]
        };
      }
      close() {}
    }

    /* ---------- path ---------- */
    const path = {
      sep: '/',
      join: (...p) => path.normalize(p.filter(x => x !== '').join('/')),
      dirname: p => { const s = String(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? (i === 0 ? '/' : '.') : s.slice(0, i); },
      basename: p => String(p).replace(/\/+$/, '').split('/').pop(),
      normalize: p => {
        const abs = String(p).startsWith('/');
        const out = [];
        for (const seg of String(p).split('/')) {
          if (!seg || seg === '.') continue;
          if (seg === '..') out.pop(); else out.push(seg);
        }
        return (abs ? '/' : '') + out.join('/');
      }
    };

    /* ---------- fs ---------- */
    // אין מערכת קבצים אמיתית לקוד הכלכלי. כתיבה לקובץ שנבחר בדיאלוג השמירה עוברת לגשר (Storage Access Framework).
    const pendingWrites = new Map(); // שם להצגה ← יעד שנבחר ב-dialog.showSaveDialog
    function enoent(p) { const e = new Error(`ENOENT: no such file or directory, open '${p}'`); e.code = 'ENOENT'; return e; }
    const fs = {
      _register(displayPath, target) { pendingWrites.set(displayPath, target); },
      existsSync: () => false,
      mkdirSync: () => undefined,
      statSync: p => { throw enoent(p); },
      readdirSync: p => { throw enoent(p); },
      readFileSync: p => { throw enoent(p); },
      renameSync: () => undefined,
      rmSync: () => undefined,
      unlinkSync: () => undefined,
      writeFileSync(p, data) {
        const target = pendingWrites.get(p);
        if (!target) throw new Error('כתיבה לקובץ אינה נתמכת בגרסת אנדרואיד');
        pendingWrites.delete(p);
        if (data && data.__printHtml !== undefined) { call('printHtml', data.__printHtml, ''); return; }
        call('writeUri', target, toBuf(data).toString('base64'));
      }
    };

    const url = { pathToFileURL: p => ({ href: 'file://' + p, toString() { return 'file://' + p; } }) };

    return { Buffer, crypto, 'node:sqlite': { DatabaseSync }, path, fs, url, b64encode, b64decode, call };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createNodeShims };
  else root.createNodeShims = createNodeShims;
})(typeof window !== 'undefined' ? window : globalThis);
