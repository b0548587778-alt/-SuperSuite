// תחליפים למודולים של Node (fs, path, crypto, node:sqlite, url) ול-Buffer — עבור הקוד של המודול הכלכלי
// כשהוא רץ בתוך WebView באנדרואיד. העבודה הכבדה (SQLite, scrypt, AES-GCM, קבצים) נעשית ב-Java דרך הגשר.
// גם התחליף ל-dialog / BrowserWindow של Electron (createElectronShims) — בוחר הקבצים והתיקיות של אנדרואיד.
// הקובץ נטען גם ב-Node בבדיקות (tests/android-port.test.js, tests/audit-android.test.js) עם גשר מדומה.
(function (root) {
  'use strict';
  // תיקיית הנתונים (הווירטואלית) של הקוד הכלכלי — initEcon ב-host.js. אין לתת אותה לתיקייה שנבחרה
  const DATA_ROOT = '/data';

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
          // כמו Node: ascii בכתיבה = הבית הנמוך של כל תו (זהה ל-latin1)
          if (e === 'latin1' || e === 'binary' || e === 'ascii') {
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
        if (e === 'ascii') return Array.from(this, x => String.fromCharCode(x & 0x7f)).join('');
        return dec.decode(this);
      }
      equals(other) { return this.length === other.length && this.every((x, i) => x === other[i]); }
      // מספרים שלמים בבתים (ZIP של הקבצים במבנה אחיד — uniformFile.zipSingle). חריגה — RangeError, כמו ב-Node
      _int(value, offset, bytes, le, write) {
        const o = offset === undefined ? 0 : offset;
        if (!Number.isInteger(o) || o < 0 || o + bytes > this.length) throw new RangeError(`The value of "offset" is out of range. It must be >= 0 and <= ${this.length - bytes}. Received ${o}`);
        if (!write) {
          let v = 0;
          for (let i = 0; i < bytes; i++) v += this[o + (le ? i : bytes - 1 - i)] * 2 ** (8 * i);
          return v;
        }
        const max = 2 ** (8 * bytes) - 1;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`The value of "value" is out of range. It must be >= 0 and <= ${max}. Received ${value}`);
        for (let i = 0; i < bytes; i++) this[o + (le ? i : bytes - 1 - i)] = Math.floor(value / 2 ** (8 * i)) & 255;
        return o + bytes;
      }
      writeUInt8(v, o) { return this._int(v, o, 1, true, true); }
      writeUInt16LE(v, o) { return this._int(v, o, 2, true, true); }
      writeUInt16BE(v, o) { return this._int(v, o, 2, false, true); }
      writeUInt32LE(v, o) { return this._int(v, o, 4, true, true); }
      writeUInt32BE(v, o) { return this._int(v, o, 4, false, true); }
      readUInt8(o) { return this._int(0, o, 1, true, false); }
      readUInt16LE(o) { return this._int(0, o, 2, true, false); }
      readUInt16BE(o) { return this._int(0, o, 2, false, false); }
      readUInt32LE(o) { return this._int(0, o, 4, true, false); }
      readUInt32BE(o) { return this._int(0, o, 4, false, false); }
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
    // תיקייה שנבחרה ב-dialog.showOpenDialog({ properties: ['openDirectory'] }) — נתיב להצגה ← URI של התיקייה.
    // כתיבה, יצירת תיקיות ובדיקת קיום בתוכה עוברות לגשר (treeWrite / treeMkdirs / treeExists).
    // DATA_ROOT (תיקיית הנתונים של הקוד הכלכלי, initEcon ב-host.js) שמורה: תיקייה שנבחרה בשם "data" לא תקבל אותה,
    // אחרת כל כתיבה לתיקיית הנתונים (הגדרות העוזר, עדכונים) הייתה יוצאת גלויה לתיקייה המשותפת שבחר המשתמש
    const trees = new Map();
    function treeOf(p) {
      const s = path.normalize(String(p));
      for (const [root, uri] of trees) {
        if (s === root) return { uri, rel: '' };
        if (s.startsWith(root + '/')) return { uri, rel: s.slice(root.length + 1) };
      }
      return null;
    }
    function enoent(p) { const e = new Error(`ENOENT: no such file or directory, open '${p}'`); e.code = 'ENOENT'; return e; }
    // הקידוד מגיע כמחרוזת ('latin1') או כאפשרות ({ encoding }) — כמו ב-Node
    const encodingOf = o => (typeof o === 'string' ? o : (o && typeof o.encoding === 'string' ? o.encoding : 'utf8'));
    const fs = {
      _register(displayPath, target) { pendingWrites.set(displayPath, target); },
      _registerDir(name, uri) {
        const base = '/' + (String(name || '').replace(/[\\/\0]/g, '').trim() || 'תיקייה');
        let root = base;
        const taken = r => r === DATA_ROOT || (trees.has(r) && trees.get(r) !== uri);
        for (let n = 2; taken(root); n++) root = `${base} (${n})`;
        trees.set(root, uri);
        return root;
      },
      existsSync: p => { const t = treeOf(p); return !!(t && call('treeExists', t.uri, t.rel)); },
      mkdirSync: p => { const t = treeOf(p); if (t && t.rel) call('treeMkdirs', t.uri, t.rel); },
      statSync: p => { throw enoent(p); },
      readdirSync: p => { throw enoent(p); },
      readFileSync: p => { throw enoent(p); },
      renameSync: () => undefined,
      rmSync: () => undefined,
      unlinkSync: () => undefined,
      writeFileSync(p, data, options) {
        // PDF: מסך ההדפסה של המכשיר (שם "שמירה כ-PDF"). לפני בדיקת היעד: החלון והכתיבה כבר לא ברצף אחד בתור
        // (handleSave), ושני ייצואי PDF במקביל חולקים את אותו שם להצגה — השני לא היה מוצא יעד
        if (data && data.__printHtml !== undefined) { pendingWrites.delete(p); call('printHtml', data.__printHtml, ''); return; }
        const tree = treeOf(p);
        const target = pendingWrites.get(p);
        if (!target && !(tree && tree.rel)) throw new Error('כתיבה לקובץ אינה נתמכת בגרסת אנדרואיד');
        pendingWrites.delete(p);
        const b64 = toBuf(data, encodingOf(options)).toString('base64');
        if (target) call('writeUri', target, b64);
        else call('treeWrite', tree.uri, tree.rel, b64);
      }
    };

    const url = { pathToFileURL: p => ({ href: 'file://' + p, toString() { return 'file://' + p; } }) };

    return { Buffer, crypto, 'node:sqlite': { DatabaseSync }, path, fs, url, b64encode, b64decode, call, DATA_ROOT };
  }

  /* ---------- dialog ו-BrowserWindow של Electron (לקוד הכלכלי) ---------- */
  // shims = תוצאת createNodeShims. bridgeAsync(method, ...args) — פעולה אסינכרונית ב-Java (בוחר קבצים / תיקיות)
  const PRINT_LABEL = 'מסך ההדפסה של המכשיר (שמירה כ-PDF)';
  const MIME = { csv: 'text/csv', pdf: 'application/pdf', vcf: 'text/vcard', json: 'application/json', ssbk: 'application/octet-stream', txt: 'text/plain', msv: 'application/octet-stream', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  function createElectronShims(shims, { bridgeAsync, alert }) {
    const show = typeof alert === 'function' ? alert : () => {};
    const dialog = {
      async showSaveDialog(a, b) {
        const opts = (b || a) || {};
        const name = String(opts.defaultPath || 'file').split(/[\\/]/).pop();
        const ext = ((opts.filters && opts.filters[0] && opts.filters[0].extensions && opts.filters[0].extensions[0]) || name.split('.').pop() || '').toLowerCase();
        if (ext === 'pdf') { shims.fs._register(PRINT_LABEL, 'print'); return { canceled: false, filePath: PRINT_LABEL }; }
        const r = await bridgeAsync('createDocument', name, MIME[ext] || 'application/octet-stream');
        if (!r || !r.uri) return { canceled: true };
        shims.fs._register(r.name, r.uri);
        return { canceled: false, filePath: r.name };
      },
      // בחירת תיקייה (למשל קבצים במבנה אחיד) — בוחר התיקיות של אנדרואיד; בחירת קובץ לקריאה אינה בשימוש בקוד הכלכלי
      async showOpenDialog(a, b) {
        const opts = (b || a) || {};
        const props = Array.isArray(opts.properties) ? opts.properties : [];
        if (!props.includes('openDirectory')) return { canceled: true, filePaths: [] };
        const r = await bridgeAsync('pickFolder');
        if (!r || !r.uri) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: [shims.fs._registerDir(r.name, r.uri)] };
      },
      async showMessageBox(a, b) { show(((b || a) || {}).message || ''); return { response: 0 }; },
      showErrorBox(title, msg) { show(title + '\n' + msg); }
    };
    // חלון PDF: ה-HTML נשמר, ו-printToPDF מחזיר אותו לכתיבה — fs.writeFileSync פותח את מסך ההדפסה
    class PdfWindow {
      constructor() { this.html = ''; const self = this; this.webContents = { printToPDF: async () => ({ __printHtml: self.html }) }; }
      async loadURL(u) {
        const m = /^data:text\/html;charset=utf-8;base64,(.*)$/.exec(u);
        this.html = m ? shims.Buffer.from(m[1], 'base64').toString('utf8') : '';
      }
      destroy() {}
    }
    return { dialog, BrowserWindow: PdfWindow };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createNodeShims, createElectronShims };
  else { root.createNodeShims = createNodeShims; root.createElectronShims = createElectronShims; }
})(typeof window !== 'undefined' ? window : globalThis);
