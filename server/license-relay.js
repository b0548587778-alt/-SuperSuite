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
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const { createProvider } = require('./payments');

const MAX_BODY = 512 * 1024;          // בקשה
const MAX_MESSAGE = 256 * 1024;       // הודעה אחת
const MAX_MAILBOX = 500;              // הודעות שממתינות בתיבה
const CLOCK_SKEW_MS = 5 * 60 * 1000;  // חלון זמן לחתימה
const RATE = { perMinute: 60 };       // בקשות לדקה לכל כתובת
const ID_RE = /^[A-Za-z0-9_-]{22}$/;  // מזהה מפתח (keyId)
const KINDS = new Set(['license-request', 'approval-request', 'approval', 'rejection', 'license', 'notices', 'message', 'update', 'signup']);
const MAX_FROM_SENDER_IN_BOX = 100;   // הודעות של שולח אחד שממתינות בתיבה של אחר — שולח אחד לא ממלא תיבה
const SEND_PER_HOUR = 500;            // הודעות שמפתח אחד שולח בשעה
const MAX_NONCES = 200000;            // זיכרון — מעבר לזה השרת עמוס
const MAX_PREKEYS = 100000;           // מפתחות זמניים שמורים
const MAX_PENDING_PAYMENTS = 5;            // תשלומים פתוחים למכשיר
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000; // תשלום שלא הושלם — פג

// billing (אופציונלי): { rootKeys, provider } — הרשמה ותשלום. בלי billing השרת הוא ממסר בלבד
function createRelay({ dataDir, clock = Date.now, billing = null }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const boxFile = (id) => path.join(dataDir, id + '.json');
  const readBox = (id) => { try { return JSON.parse(fs.readFileSync(boxFile(id), 'utf8')); } catch { return []; } };
  const writeBox = (id, msgs) => { const f = boxFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(msgs)); fs.renameSync(f + '.tmp', f); };
  const nonces = new Map(); // nonce ← תפוגה; מונע שידור חוזר של בקשה חתומה
  const hits = new Map();   // כתובת ← [זמנים]
  const sends = new Map();  // מפתח שולח ← [זמנים]
  let lastSweep = 0;
  // ניקוי תקופתי של המפות שבזיכרון (ולא בכל בקשה — O(n))
  function sweep(now) {
    if (now - lastSweep < 10000 && nonces.size < MAX_NONCES) return;
    lastSweep = now;
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    for (const m of [hits, sends]) {
      const win = m === hits ? 60000 : 3600000;
      for (const [k, list] of m) { const live = list.filter(t => now - t < win); if (live.length) m.set(k, live); else m.delete(k); }
    }
  }

  function authenticate(req) {
    const { pub, ts, nonce, op, payload, sig } = req || {};
    let id;
    try { id = L.keyId(pub); } catch { throw httpError(401, 'מפתח לא תקין'); }
    if (!Number.isSafeInteger(ts) || Math.abs(clock() - ts) > CLOCK_SKEW_MS) throw httpError(401, 'שעון המחשב אינו מדויק או שהבקשה ישנה');
    if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 64) throw httpError(401, 'בקשה לא תקינה');
    if (!L.verifyObject({ pub: L.publicOf(pub), ts, nonce, op, payload }, sig, pub)) throw httpError(401, 'חתימה לא תקינה');
    const now = clock();
    sweep(now);
    const seen = nonces.get(nonce);
    if (seen && seen >= now) throw httpError(401, 'בקשה כפולה');
    if (nonces.size >= MAX_NONCES) throw httpError(503, 'השרת עמוס — נסו שוב בעוד כמה דקות');
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

  function sendQuota(from, n) {
    const now = clock();
    const list = (sends.get(from) || []).filter(t => now - t < 3600000);
    if (list.length + n > SEND_PER_HOUR) throw httpError(429, 'יותר מדי הודעות בשעה האחרונה — נסו מאוחר יותר');
    for (let i = 0; i < n; i++) list.push(now);
    sends.set(from, list);
  }

  const readJsonFileSafe = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, n), 'utf8')) || {}; } catch { return {}; } };
  const writeJsonFileSafe = (n, v) => { const f = path.join(dataDir, n); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };

  // ---------- הרשמה ותשלום ----------
  const readJsonFile = (n, def) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, n), 'utf8')); } catch { return def; } };
  const writeJsonFile = (n, v) => { const f = path.join(dataDir, n); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  const ownerBox = () => L.keyId(billing.rootKeys[0]);
  const needBilling = () => { if (!billing || !billing.rootKeys || !billing.rootKeys.length) throw httpError(404, 'השרת אינו מוגדר להרשמה'); };
  function deliver(to, kind, bodyText) {
    const box = readBox(to);
    if (box.length >= MAX_MAILBOX) throw httpError(507, 'תיבת היעד מלאה');
    writeBox(to, [...box, { id: crypto.randomUUID(), from: 'relay', kind, body: bodyText, at: clock() }]);
  }

  // מנהל-העל מפרסם הצעה (חתומה במפתח השורש — רק הוא יכול)
  function setOffer(from, p) {
    needBilling();
    if (from !== ownerBox()) throw httpError(403, 'רק מנהל-העל מפרסם הצעה');
    const offer = OF.verifyOffer(p.offer, billing.rootKeys);
    writeJsonFile('offer.json', { text: p.offer, issuedAt: offer.issuedAt });
    return { ok: true };
  }
  function getOffer() {
    needBilling();
    const o = readJsonFile('offer.json', null);
    if (!o) throw httpError(404, 'הספק עדיין לא פרסם תכניות');
    return { ok: true, offer: o.text };
  }

  // הרשמה: נבדקת מול ההצעה החתומה; הסכום נקבע לפי ההצעה בלבד. תכנית חינם — נמסרת מיד
  async function checkout(from, p) {
    needBilling();
    let v;
    try { v = SU.verifySignup(p.signup, billing.rootKeys); } catch (e) { throw httpError(400, e.message); }
    if (v.body.keyId !== from) throw httpError(403, 'ההרשמה אינה של המכשיר השולח');
    if (v.plan.priceAgorot === 0) {
      deliver(ownerBox(), 'signup', JSON.stringify({ type: 'supersuite-signup-delivery', signup: p.signup, payment: null }));
      return { ok: true, free: true };
    }
    if (!billing.provider) throw httpError(503, 'התשלום אינו זמין כרגע');
    const now = clock();
    const all = readJsonFile('payments.json', []).filter(x => x.status !== 'pending' || now - x.createdAt < PAYMENT_TTL_MS);
    if (all.filter(x => x.keyId === from && x.status === 'pending').length >= MAX_PENDING_PAYMENTS) throw httpError(429, 'יותר מדי תשלומים פתוחים — נסו מאוחר יותר');
    const paid = all.find(x => x.signupId === v.body.id && x.status === 'paid');
    if (paid) return { ok: true, paymentId: paid.id, status: 'paid' };
    const paymentId = crypto.randomUUID();
    const co = await billing.provider.createCheckout({ paymentId, amountAgorot: v.plan.priceAgorot,
      description: `${v.plan.name} — ${v.body.customer.org}`, customer: v.body.customer });
    // הקריאה לספק אסינכרונית — בינתיים בקשות אחרות אולי עדכנו את הקובץ
    const fresh = readJsonFile('payments.json', []).filter(x => x.status !== 'pending' || clock() - x.createdAt < PAYMENT_TTL_MS);
    writeJsonFile('payments.json', [...fresh, { id: paymentId, keyId: from, signupId: v.body.id, amountAgorot: v.plan.priceAgorot,
      checkoutId: co.checkoutId, url: co.url, status: 'pending', createdAt: now, signup: p.signup }]);
    return { ok: true, paymentId, url: co.url, status: 'pending' };
  }
  function paymentStatus(from, p) {
    needBilling();
    const x = readJsonFile('payments.json', []).find(y => y.id === String(p.paymentId) && y.keyId === from);
    if (!x) throw httpError(404, 'התשלום לא נמצא');
    return { ok: true, status: x.status, url: x.status === 'pending' ? x.url : undefined };
  }

  // הודעת הספק (webhook): מאומתת אצל הספק; הסכום חייב להיות זהה. תשלום שהושלם — ההרשמה נמסרת למנהל-העל
  function webhook({ rawBody, headers }) {
    needBilling();
    let ev;
    try { ev = billing.provider.parseWebhook({ rawBody, headers }); } catch (e) { throw httpError(400, e.message); }
    const all = readJsonFile('payments.json', []);
    const x = all.find(y => y.checkoutId === ev.checkoutId);
    if (!x) throw httpError(404, 'התשלום לא נמצא');
    if (x.status !== 'pending') return { ok: true, duplicate: true }; // הודעה כפולה מהספק
    if (ev.status === 'paid' && ev.amountAgorot !== x.amountAgorot) throw httpError(400, 'הסכום ששולם אינו תואם');
    x.status = ev.status;
    x.providerRef = ev.providerRef;
    x.updatedAt = clock();
    writeJsonFile('payments.json', all);
    if (ev.status === 'paid') {
      deliver(ownerBox(), 'signup', JSON.stringify({ type: 'supersuite-signup-delivery', signup: x.signup,
        payment: { id: x.id, amountAgorot: x.amountAgorot, provider: billing.provider.name, providerRef: x.providerRef, paidAt: x.updatedAt } }));
    }
    return { ok: true };
  }

  // פעולות: send (לתיבה של אחר), fetch (התיבה שלי), ack (מחיקת הודעות שטופלו)
  // הרשמה: setOffer, getOffer, checkout (אסינכרוני — מחזיר Promise), paymentStatus
  function handle(body, ip = '') {
    rateLimit(ip);
    const from = authenticate(body);
    const p = body.payload || {};
    // מפתח זמני להודעות: כל מערכת מפרסמת את שלה (חתום במפתח הקבוע — מאומת כאן ושוב אצל השולח)
    if (body.op === 'setPrekey') {
      const b = p.bundle;
      const { sig, ...payload } = b || {};
      if (!b || payload.owner !== from || typeof sig !== 'string' || !L.verifyObject(payload, sig, body.pub)) throw httpError(400, 'מפתח זמני לא תקין');
      if (JSON.stringify(b).length > 2048 || typeof payload.id !== 'string' || !Number.isSafeInteger(payload.createdAt)
        || !/^[A-Za-z0-9_-]{43}$/.test(String(payload.pub))) throw httpError(400, 'מפתח זמני לא תקין');
      const all = readJsonFileSafe('prekeys.json');
      if (!all[from] && Object.keys(all).length >= MAX_PREKEYS) throw httpError(507, 'השרת מלא');
      all[from] = b;
      writeJsonFileSafe('prekeys.json', all);
      return { ok: true };
    }
    if (body.op === 'getPrekey') {
      if (!ID_RE.test(String(p.id))) throw httpError(400, 'מזהה לא תקין');
      return { ok: true, bundle: readJsonFileSafe('prekeys.json')[p.id] || null };
    }
    if (body.op === 'setOffer') return setOffer(from, p);
    if (body.op === 'getOffer') return getOffer();
    if (body.op === 'checkout') return checkout(from, p);
    if (body.op === 'paymentStatus') return paymentStatus(from, p);
    if (body.op === 'send') {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || items.length > 50) throw httpError(400, 'אין מה לשלוח');
      const byBox = new Map();
      for (const it of items) {
        // 'signup' נמסר רק על ידי השרת אחרי תשלום — לא בשליחה ישירה
        if (it && it.kind === 'signup') throw httpError(400, 'הרשמה נשלחת דרך התשלום');
        if (!it || !ID_RE.test(String(it.to)) || !KINDS.has(it.kind) || typeof it.body !== 'string' || it.body.length > MAX_MESSAGE) {
          throw httpError(400, 'הודעה לא תקינה');
        }
        if (it.to === from) throw httpError(400, 'הודעה לא תקינה');
        const msg = { id: crypto.randomUUID(), from, kind: it.kind, body: it.body, at: clock() };
        byBox.set(it.to, [...(byBox.get(it.to) || []), msg]);
      }
      // כל הבדיקות לפני כתיבה כלשהי — שליחה נכשלת כולה או מצליחה כולה
      const boxes = new Map();
      for (const [to, msgs] of byBox) {
        const box = readBox(to);
        if (box.length + msgs.length > MAX_MAILBOX) throw httpError(507, 'תיבת היעד מלאה');
        if (box.filter(m => m.from === from).length + msgs.length > MAX_FROM_SENDER_IN_BOX) throw httpError(429, 'יותר מדי הודעות שטרם נקראו אצל הנמען');
        boxes.set(to, [...box, ...msgs]);
      }
      sendQuota(from, items.length);
      for (const [to, all] of boxes) writeBox(to, all);
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

  return { handle, webhook, billing, rateLimit };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function createServer({ dataDir, cert, key, clock, billing }) {
  const relay = createRelay({ dataDir, clock, billing });
  const readBody = (req, res, max, cb) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!res.writableEnded) cb(Buffer.concat(chunks).toString('utf8')); });
  };
  const sendHtml = (res, status, html) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", 'x-frame-options': 'DENY' });
    res.end(html);
  };
  const onRequest = (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'supersuite-license-relay' });
    if (req.url.startsWith('/pay/')) {
      try { relay.rateLimit(req.socket.remoteAddress || ''); } catch (e) { return send(e.status, { ok: false, error: e.message }); }
    }
    // webhook מספק התשלום
    if (req.method === 'POST' && req.url === '/pay/webhook') {
      return readBody(req, res, 64 * 1024, (rawBody) => {
        try { send(200, relay.webhook({ rawBody, headers: req.headers })); }
        catch (e) { send(e.status || 500, { ok: false, error: e.status ? e.message : 'שגיאה בשרת' }); }
      });
    }
    // דף התשלום של ספק הבדיקות
    const tm = /^\/pay\/test\/([A-Za-z0-9_]{1,64})$/.exec(req.url);
    const tp = billing && billing.provider && billing.provider.routes;
    if (tm && tp) {
      if (req.method === 'GET') return tp.get(tm[1]).then(r => sendHtml(res, r.status, r.html));
      if (req.method === 'POST') {
        return readBody(req, res, 4096, (raw) => {
          const form = Object.fromEntries(new URLSearchParams(raw));
          tp.post(tm[1], form, async (wh) => relay.webhook(wh)).then(r => sendHtml(res, r.status, r.html))
            .catch(e => sendHtml(res, e.status || 500, '<p>שגיאה</p>'));
        });
      }
    }
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
      const fail = (e) => { send(e.status || 500, { ok: false, error: e.status ? e.message : 'שגיאה בשרת' }); if (!e.status) console.error(e); };
      try { Promise.resolve(relay.handle(body, req.socket.remoteAddress || '')).then(r => send(200, r), fail); }
      catch (e) { fail(e); }
    });
  };
  const server = cert && key
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' }, onRequest)
    : http.createServer(onRequest);
  // חיבורים איטיים (slowloris) לא מחזיקים את השרת
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.maxHeadersCount = 50;
  return server;
}

if (require.main === module) {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const port = Number(a.port || process.env.PORT || 8443);
  // הרשמה ותשלום: --root-pub <קובץ המפתח הציבורי של מנהל-העל> --pay test|<ספק> --public-url https://...
  let billing = null;
  if (a['root-pub']) {
    const rootKeys = [JSON.parse(fs.readFileSync(a['root-pub'], 'utf8'))];
    const provider = a.pay ? createProvider(a.pay, { publicUrl: a['public-url'], secret: process.env.SS_PAY_SECRET }) : null;
    if (provider && provider.name === 'test') console.warn('⚠ ספק תשלום לבדיקות — אין חיוב אמיתי');
    billing = { rootKeys, provider };
  }
  const server = createServer({ dataDir: path.resolve(a.data || 'relay-data'), cert: a.cert, key: a.key, billing });
  server.listen(port, () => console.log(`שרת הרישוי פועל בפורט ${port}${a.cert ? ' (HTTPS)' : ' (HTTP — יש להפעיל מאחורי TLS)'}`));
}

module.exports = { createRelay, createServer, KINDS };
