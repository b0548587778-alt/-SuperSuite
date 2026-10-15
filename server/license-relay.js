#!/usr/bin/env node
// שרת ממסר לרישוי — מאפשר לעבוד מרחוק בלי להעביר קבצים ידנית (docs/LICENSING-DESIGN.md, "עבודה מרחוק").
// השרת הוא "תיבת דואר" בלבד: לכל מערכת תיבה לפי מזהה המפתח שלה. הוא אינו מנפיק, אינו מאשר ואינו יכול לזייף:
// כל רישיון, אישור והודעת סטטוס חתומים במפתחות שאינם על השרת, והתוכנה מאמתת אותם בעצמה.
// כל בקשה לשרת חתומה במפתח השולח (Ed25519): רק בעל המפתח קורא את התיבה שלו, והשולח מזוהה.
// ללא תלויות: node:http / node:https בלבד.
//
//   node server/license-relay.js --port 8443 --data ./relay-data [--cert cert.pem --key key.pem]
// בייצור: HTTPS חובה (ישירות עם --cert/--key, או מאחורי שרת שמספק TLS). התוכנה מסרבת לכתובת http שאינה localhost.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const L = require('../shell/licensing/license');

const MAX_BODY = 512 * 1024;          // בקשה
const MAX_MESSAGE = 256 * 1024;       // הודעה אחת
const MAX_MAILBOX = 500;              // הודעות שממתינות בתיבה
const CLOCK_SKEW_MS = 5 * 60 * 1000;  // חלון זמן לחתימה
const RATE = { perMinute: 60 };       // בקשות לדקה לכל כתובת
const ID_RE = /^[A-Za-z0-9_-]{22}$/;  // מזהה מפתח (keyId)
const KINDS = new Set(['license-request', 'approval-request', 'approval', 'rejection', 'license', 'notices', 'message', 'update']);

function createRelay({ dataDir, clock = Date.now }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const boxFile = (id) => path.join(dataDir, id + '.json');
  const readBox = (id) => { try { return JSON.parse(fs.readFileSync(boxFile(id), 'utf8')); } catch { return []; } };
  const writeBox = (id, msgs) => { const f = boxFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(msgs)); fs.renameSync(f + '.tmp', f); };
  const nonces = new Map(); // nonce ← תפוגה; מונע שידור חוזר של בקשה חתומה
  const hits = new Map();   // כתובת ← [זמנים]

  function authenticate(req) {
    const { pub, ts, nonce, op, payload, sig } = req || {};
    let id;
    try { id = L.keyId(pub); } catch { throw httpError(401, 'מפתח לא תקין'); }
    if (!Number.isSafeInteger(ts) || Math.abs(clock() - ts) > CLOCK_SKEW_MS) throw httpError(401, 'שעון המחשב אינו מדויק או שהבקשה ישנה');
    if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 64) throw httpError(401, 'בקשה לא תקינה');
    if (!L.verifyObject({ pub: L.publicOf(pub), ts, nonce, op, payload }, sig, pub)) throw httpError(401, 'חתימה לא תקינה');
    const now = clock();
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    if (nonces.has(nonce)) throw httpError(401, 'בקשה כפולה');
    nonces.set(nonce, now + 2 * CLOCK_SKEW_MS);
    return id;
  }

  function rateLimit(ip) {
    const now = clock();
    const list = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (list.length >= RATE.perMinute) throw httpError(429, 'יותר מדי בקשות — נסו שוב בעוד דקה');
    list.push(now);
    hits.set(ip, list);
  }

  // פעולות: send (לתיבה של אחר), fetch (התיבה שלי), ack (מחיקת הודעות שטופלו)
  function handle(body, ip = '') {
    rateLimit(ip);
    const from = authenticate(body);
    const p = body.payload || {};
    if (body.op === 'send') {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || items.length > 50) throw httpError(400, 'אין מה לשלוח');
      const byBox = new Map();
      for (const it of items) {
        if (!it || !ID_RE.test(String(it.to)) || !KINDS.has(it.kind) || typeof it.body !== 'string' || it.body.length > MAX_MESSAGE) {
          throw httpError(400, 'הודעה לא תקינה');
        }
        const msg = { id: crypto.randomUUID(), from, kind: it.kind, body: it.body, at: clock() };
        byBox.set(it.to, [...(byBox.get(it.to) || []), msg]);
      }
      for (const [to, msgs] of byBox) {
        const box = readBox(to);
        if (box.length + msgs.length > MAX_MAILBOX) throw httpError(507, 'תיבת היעד מלאה');
        writeBox(to, [...box, ...msgs]);
      }
      return { ok: true, sent: items.length };
    }
    if (body.op === 'fetch') return { ok: true, messages: readBox(from) };
    if (body.op === 'ack') {
      const ids = new Set(Array.isArray(p.ids) ? p.ids.map(String) : []);
      const box = readBox(from);
      writeBox(from, box.filter(m => !ids.has(m.id)));
      return { ok: true, removed: box.length - readBox(from).length };
    }
    throw httpError(400, 'פעולה לא מוכרת');
  }

  return { handle };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function createServer({ dataDir, cert, key, clock }) {
  const relay = createRelay({ dataDir, clock });
  const onRequest = (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'supersuite-license-relay' });
    if (req.method !== 'POST' || req.url !== '/v1') return send(404, { ok: false, error: 'לא נמצא' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(413, { ok: false, error: 'הבקשה גדולה מדי' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { ok: false, error: 'בקשה לא תקינה' }); }
      try { send(200, relay.handle(body, req.socket.remoteAddress || '')); }
      catch (e) { send(e.status || 500, { ok: false, error: e.status ? e.message : 'שגיאה בשרת' }); if (!e.status) console.error(e); }
    });
  };
  return cert && key
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' }, onRequest)
    : http.createServer(onRequest);
}

if (require.main === module) {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const port = Number(a.port || process.env.PORT || 8443);
  const server = createServer({ dataDir: path.resolve(a.data || 'relay-data'), cert: a.cert, key: a.key });
  server.listen(port, () => console.log(`שרת הרישוי פועל בפורט ${port}${a.cert ? ' (HTTPS)' : ' (HTTP — יש להפעיל מאחורי TLS)'}`));
}

module.exports = { createRelay, createServer, KINDS };
