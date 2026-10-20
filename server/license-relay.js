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
const MAX_SYSTEM_IN_BOX = 5000;       // הודעות מהשרת עצמו (הרשמות ששולמו) — לא נספרות ב-MAX_MAILBOX
const SEND_PER_HOUR = 500;            // הודעות שמפתח אחד שולח בשעה
const MAX_NONCES = 200000;            // זיכרון — מעבר לזה השרת עמוס
const MAX_PREKEYS = 100000;           // מפתחות זמניים שמורים
const MAX_PENDING_PAYMENTS = 5;            // תשלומים פתוחים למכשיר
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000; // תשלום שלא הושלם — פג
// מפתח חדש לא עולה כלום, ולכן מכסה לפי מפתח לבדה לא עוצרת הצפה — יש גם מכסות לפי כתובת (בדיקת אבטחה 21.10.2026)
const SEND_PER_IP_HOUR = 1000;        // הודעות מכתובת אחת בשעה
const CHECKOUT_PER_IP_DAY = 20;       // דפי תשלום שנפתחים מכתובת אחת ביום (כל אחד נפתח גם אצל ספק הסליקה)
const FREE_SIGNUP_PER_IP_DAY = 3;     // הרשמות לתכנית חינם מכתובת אחת ביום
const MAX_FREE_IN_BOX = 1000;         // הרשמות חינם שממתינות אצל מנהל-העל — לא תופסות מקום של הרשמות ששולמו
const MAX_PENDING_TOTAL = 5000;       // תשלומים פתוחים בשרת כולו
const MAX_STORE_BYTES = 2 * 1024 ** 3;          // כל הקבצים יחד — מעבר לזה שליחה רגילה נדחית, והדיסק לא מתמלא
const SYSTEM_RESERVE_BYTES = 256 * 1024 ** 2;   // מקום שמור למסירות של השרת עצמו (הרשמות ששולמו)
const MESSAGE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // הודעה שלא נקראה 60 יום נמחקת (מסירות של השרת — לא)
const BOX_SWEEP_MS = 24 * 60 * 60 * 1000;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// billing (אופציונלי): { rootKeys, provider } — הרשמה ותשלום. בלי billing השרת הוא ממסר בלבד
function createRelay({ dataDir, clock = Date.now, billing = null, maxStoreBytes = MAX_STORE_BYTES }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const signupDir = path.join(dataDir, 'signups'); // נוצרת בתשלום הראשון

  // ---------- אחסון ----------
  // קובץ שלא קיים = ריק. קובץ שקיים ולא נקרא (פגום, גדול מדי לזיכרון, תקלת דיסק) — שגיאה ולא "ריק":
  // אחרת הכתיבה הבאה דורסת אותו, ותשלומים והודעות נמחקים (בדיקת אבטחה 21.10.2026)
  function readJson(f, def) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return def; throw storeError(f, e); }
    try { return JSON.parse(text); } catch (e) { throw storeError(f, e); }
  }
  function storeError(f, e) {
    console.error('relay: cannot read ' + path.basename(f) + ': ' + ((e && (e.code || e.message)) || e));
    return httpError(503, 'השרת אינו זמין כרגע — נסו שוב מאוחר יותר');
  }
  // הנפח שבשימוש — נסרק פעם אחת, ומתעדכן בכל כתיבה ומחיקה
  let used = null;
  function scanBytes(dir) {
    let t = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) t += scanBytes(p); else if (e.isFile()) t += fs.statSync(p).size;
    }
    return t;
  }
  const usedBytes = () => { if (used === null) used = scanBytes(dataDir); return used; };
  const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  function writeJson(f, v) {
    const text = JSON.stringify(v);
    const before = sizeOf(f);
    fs.writeFileSync(f + '.tmp', text);
    fs.renameSync(f + '.tmp', f);
    if (used !== null) used += Buffer.byteLength(text) - before;
  }
  function removeFile(f) {
    const s = sizeOf(f);
    try { fs.rmSync(f, { force: true }); if (used !== null) used -= s; } catch { /* ינוקה בסבב הבא */ }
  }
  // system: מסירה של השרת עצמו — מותר לה להשתמש במקום השמור
  function assertRoom(extra, system = false) {
    if (usedBytes() + extra > maxStoreBytes + (system ? SYSTEM_RESERVE_BYTES : 0)) throw httpError(507, 'השרת מלא — נסו שוב מאוחר יותר');
  }

  const boxFile = (id) => path.join(dataDir, id + '.json');
  const readBox = (id) => readJson(boxFile(id), []);
  const writeBox = (id, msgs) => { if (msgs.length) writeJson(boxFile(id), msgs); else removeFile(boxFile(id)); };
  const nonces = new Map(); // nonce ← תפוגה; מונע שידור חוזר של בקשה חתומה
  // מונים לפי חלון זמן: מפתח (כתובת / מפתח שולח) ← [זמנים]
  const windows = {
    hits: { ms: 60000, map: new Map() },
    sends: { ms: 3600000, map: new Map() },
    ipSends: { ms: 3600000, map: new Map() },
    checkouts: { ms: 24 * 3600000, map: new Map() },
    frees: { ms: 24 * 3600000, map: new Map() },
  };
  const hits = windows.hits.map;
  let lastSweep = 0;
  let lastBoxSweep = clock();
  // ניקוי תקופתי של המפות שבזיכרון (ולא בכל בקשה — O(n))
  function sweep(now) {
    if (now - lastBoxSweep >= BOX_SWEEP_MS) { lastBoxSweep = now; expireMessages(now); }
    if (now - lastSweep < 10000 && nonces.size < MAX_NONCES) return;
    lastSweep = now;
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    for (const { ms, map } of Object.values(windows)) {
      for (const [k, list] of map) { const live = list.filter(t => now - t < ms); if (live.length) map.set(k, live); else map.delete(k); }
    }
  }
  // הודעות שאיש לא קרא 60 יום (תיבה שאין לה בעלים, או מכשיר שנזנח) — נמחקות, כדי שהדיסק לא יתמלא לתמיד
  function expireMessages(now) {
    for (const name of fs.readdirSync(dataDir)) {
      const m = /^([A-Za-z0-9_-]{22})\.json$/.exec(name);
      if (!m) continue;
      let box;
      try { box = readBox(m[1]); } catch { continue; } // קובץ שלא נקרא — לא נוגעים בו
      const live = box.filter(x => x.from === 'relay' || now - x.at < MESSAGE_TTL_MS);
      if (live.length !== box.length) writeBox(m[1], live);
    }
  }
  // מכסה בחלון זמן. n — כמה פעמים לספור
  function quota(kind, key, limit, n, message) {
    const { ms, map } = windows[kind];
    const now = clock();
    const list = (map.get(key) || []).filter(t => now - t < ms);
    if (list.length + n > limit) throw httpError(429, message);
    for (let i = 0; i < n; i++) list.push(now);
    map.set(key, list);
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
    quota('hits', ip, RATE.perMinute, 1, 'יותר מדי בקשות — נסו שוב בעוד דקה');
  }

  const dataFile = (n) => path.join(dataDir, n);
  const readJsonFile = (n, def) => readJson(dataFile(n), def);
  const writeJsonFile = (n, v) => writeJson(dataFile(n), v);

  // ---------- הרשמה ותשלום ----------
  const ownerBox = () => L.keyId(billing.rootKeys[0]);
  const needBilling = () => { if (!billing || !billing.rootKeys || !billing.rootKeys.length) throw httpError(404, 'השרת אינו מוגדר להרשמה'); };
  // מסירה מהשרת עצמו (הרשמה ששולמה): לא כפופה לתקרת התיבה של השולחים — אחרת כל אחד יכול למלא את
  // תיבת מנהל-העל (המזהה ציבורי) ולחסום מסירה של הרשמות ששולמו (סקירת אבטחה 10.2026, ממצא 1).
  // הרשמות חינם (free) — בתקרה נפרדת, כדי שלא יתפסו את המקום של הרשמות ששולמו
  function deliver(to, kind, bodyText, { free = false } = {}) {
    const box = readBox(to);
    const sys = box.filter(m => m.from === 'relay');
    if (sys.length >= MAX_SYSTEM_IN_BOX) throw httpError(507, 'תיבת היעד מלאה');
    if (free && sys.filter(m => m.free).length >= MAX_FREE_IN_BOX) throw httpError(507, 'יש יותר מדי הרשמות שממתינות לאישור — נסו שוב מאוחר יותר');
    const msg = { id: crypto.randomUUID(), from: 'relay', kind, body: bodyText, at: clock(), ...(free ? { free: true } : {}) };
    assertRoom(Buffer.byteLength(JSON.stringify(msg)), !free);
    writeBox(to, [...box, msg]);
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

  // חבילת ההרשמה (עד ~200KB עם תמונת החתימה) נשמרת בקובץ משלה, ו-payments.json מחזיק רק את פרטי התשלום —
  // כך הקובץ המשותף נשאר קטן. רשומה ישנה עם signup בתוכה — עדיין נקראת
  const signupFile = (paymentId) => path.join(signupDir, paymentId + '.json');
  const signupOf = (x) => (x.signup !== undefined ? x.signup : readJson(signupFile(x.id), null));
  // תשלום פתוח שפג — נמחק יחד עם חבילת ההרשמה שלו
  function livePayments(list, now) {
    return list.filter(x => {
      if (x.status !== 'pending' || now - x.createdAt < PAYMENT_TTL_MS) return true;
      if (x.signup === undefined) removeFile(signupFile(x.id));
      return false;
    });
  }

  // הרשמה: נבדקת מול ההצעה החתומה; הסכום נקבע לפי ההצעה בלבד. תכנית חינם — נמסרת מיד
  async function checkout(from, p, ip = '') {
    needBilling();
    let v;
    try { v = SU.verifySignup(p.signup, billing.rootKeys); } catch (e) { throw httpError(400, e.message); }
    if (v.body.keyId !== from) throw httpError(403, 'ההרשמה אינה של המכשיר השולח');
    if (v.plan.priceAgorot === 0) {
      quota('frees', ip, FREE_SIGNUP_PER_IP_DAY, 1, 'יותר מדי הרשמות מהכתובת הזו היום — נסו שוב מחר');
      deliver(ownerBox(), 'signup', JSON.stringify({ type: 'supersuite-signup-delivery', signup: p.signup, payment: null }), { free: true });
      return { ok: true, free: true };
    }
    if (!billing.provider) throw httpError(503, 'התשלום אינו זמין כרגע');
    const now = clock();
    const all = livePayments(readJsonFile('payments.json', []), now);
    const paid = all.find(x => x.signupId === v.body.id && x.status === 'paid');
    if (paid) return { ok: true, paymentId: paid.id, status: 'paid' };
    const open = all.find(x => x.signupId === v.body.id && x.status === 'pending');
    if (open) return { ok: true, paymentId: open.id, url: open.url, status: 'pending' };
    if (all.filter(x => x.keyId === from && x.status === 'pending').length >= MAX_PENDING_PAYMENTS) throw httpError(429, 'יותר מדי תשלומים פתוחים — נסו מאוחר יותר');
    if (all.filter(x => x.status === 'pending').length >= MAX_PENDING_TOTAL) throw httpError(503, 'השרת עמוס — נסו שוב מאוחר יותר');
    // כל ניסיון פותח דף תשלום אצל ספק הסליקה — מכסה לכתובת, כי מפתח חדש לא עולה כלום
    quota('checkouts', ip, CHECKOUT_PER_IP_DAY, 1, 'יותר מדי ניסיונות תשלום מהכתובת הזו היום — נסו שוב מחר');
    assertRoom(Buffer.byteLength(p.signup) + 1024);
    const paymentId = crypto.randomUUID();
    const co = await billing.provider.createCheckout({ paymentId, amountAgorot: v.plan.priceAgorot,
      description: `${v.plan.name} — ${v.body.customer.org}`, customer: v.body.customer });
    // הקריאה לספק אסינכרונית — בינתיים בקשות אחרות אולי עדכנו את הקובץ. הקריאה-כתיבה עצמה
    // סינכרונית (בלי await באמצע), ולכן webhook או checkout אחר לא יכולים להיכנס בין הקריאה לכתיבה
    const fresh = livePayments(readJsonFile('payments.json', []), clock());
    // ייתכן ששתי בקשות לאותה הרשמה רצו במקביל, והראשונה כבר נרשמה — לא פותחים תשלום שני
    const raced = fresh.find(x => x.signupId === v.body.id && (x.status === 'paid' || x.status === 'pending'));
    if (raced) return { ok: true, paymentId: raced.id, url: raced.status === 'pending' ? raced.url : undefined, status: raced.status };
    // קודם חבילת ההרשמה, ורק אז הרשומה: רשומה בלי חבילה הייתה תשלום שאי אפשר למסור
    fs.mkdirSync(signupDir, { recursive: true });
    writeJson(signupFile(paymentId), p.signup);
    writeJsonFile('payments.json', [...fresh, { id: paymentId, keyId: from, signupId: v.body.id, amountAgorot: v.plan.priceAgorot,
      checkoutId: co.checkoutId, url: co.url, status: 'pending', createdAt: now }]);
    return { ok: true, paymentId, url: co.url, status: 'pending' };
  }
  function paymentStatus(from, p) {
    needBilling();
    const x = readJsonFile('payments.json', []).find(y => y.id === String(p.paymentId) && y.keyId === from);
    if (!x) throw httpError(404, 'התשלום לא נמצא');
    return { ok: true, status: x.status, url: x.status === 'pending' ? x.url : undefined };
  }

  // הודעת הספק (webhook): מאומתת אצל הספק; הסכום חייב להיות זהה. תשלום שהושלם — ההרשמה נמסרת למנהל-העל.
  // ספק שמאמת בפנייה חוזרת אליו (Cardcom) מחזיר Promise — ואז גם התוצאה כאן Promise
  function webhook({ rawBody, headers }) {
    needBilling();
    let ev;
    try { ev = billing.provider.parseWebhook({ rawBody, headers }); } catch (e) { throw httpError(400, e.message); }
    if (ev && typeof ev.then === 'function') return ev.then(applyPaymentEvent, (e) => { throw httpError(400, e.message); });
    return applyPaymentEvent(ev);
  }
  function applyPaymentEvent(ev) {
    // ניסיון שעוד לא הסתיים (למשל כרטיס שנדחה בדף התשלום, והלקוח יכול לנסות שוב) — לא משנים דבר
    if (ev.status === 'pending') return { ok: true, pending: true };
    const all = readJsonFile('payments.json', []);
    const x = all.find(y => y.checkoutId === ev.checkoutId);
    if (!x) throw httpError(404, 'התשלום לא נמצא');
    if (x.status !== 'pending') return { ok: true, duplicate: true }; // הודעה כפולה מהספק
    if (ev.status === 'paid' && ev.amountAgorot !== x.amountAgorot) throw httpError(400, 'הסכום ששולם אינו תואם');
    const at = clock();
    // קודם מוסרים, ורק אז מסמנים "שולם": אם המסירה נכשלה, התשלום נשאר pending והספק ינסה שוב.
    // בסדר ההפוך, ניסיון חוזר של הספק קיבל "כפול" — והלקוח שילם בלי לקבל רישיון
    if (ev.status === 'paid') {
      const signup = signupOf(x);
      if (signup == null) throw httpError(503, 'חבילת ההרשמה של התשלום חסרה בשרת');
      deliver(ownerBox(), 'signup', JSON.stringify({ type: 'supersuite-signup-delivery', signup,
        payment: { id: x.id, amountAgorot: x.amountAgorot, provider: billing.provider.name, providerRef: ev.providerRef, paidAt: at } }));
    }
    x.status = ev.status;
    x.providerRef = ev.providerRef;
    x.updatedAt = at;
    writeJsonFile('payments.json', all);
    // אחרי המסירה ההרשמה נמצאת בתיבה של מנהל-העל; תשלום שנכשל — אין בה צורך
    if (x.signup === undefined) removeFile(signupFile(x.id));
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
      const all = readJsonFile('prekeys.json', {}) || {};
      if (!all[from] && Object.keys(all).length >= MAX_PREKEYS) throw httpError(507, 'השרת מלא');
      if (!all[from]) assertRoom(2048 + 30);
      all[from] = b;
      writeJsonFile('prekeys.json', all);
      return { ok: true };
    }
    if (body.op === 'getPrekey') {
      if (!ID_RE.test(String(p.id))) throw httpError(400, 'מזהה לא תקין');
      return { ok: true, bundle: (readJsonFile('prekeys.json', {}) || {})[p.id] || null };
    }
    if (body.op === 'setOffer') return setOffer(from, p);
    if (body.op === 'getOffer') return getOffer();
    if (body.op === 'checkout') return checkout(from, p, ip);
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
        // התקרה סופרת רק הודעות של שולחים — הודעות מהשרת (הרשמות ששולמו) לא תופסות מקום של אחרים
        if (box.filter(m => m.from !== 'relay').length + msgs.length > MAX_MAILBOX) throw httpError(507, 'תיבת היעד מלאה');
        if (box.filter(m => m.from === from).length + msgs.length > MAX_FROM_SENDER_IN_BOX) throw httpError(429, 'יותר מדי הודעות שטרם נקראו אצל הנמען');
        boxes.set(to, [...box, ...msgs]);
      }
      assertRoom([...byBox.values()].flat().reduce((t, m) => t + Buffer.byteLength(JSON.stringify(m)) + 1, 0));
      quota('sends', from, SEND_PER_HOUR, items.length, 'יותר מדי הודעות בשעה האחרונה — נסו מאוחר יותר');
      quota('ipSends', ip, SEND_PER_IP_HOUR, items.length, 'יותר מדי הודעות מהכתובת הזו בשעה האחרונה — נסו מאוחר יותר');
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

  return { handle, webhook, billing, rateLimit, expireMessages: () => expireMessages(clock()) };
}

// ספק הבדיקות נותן לכל אחד ללחוץ "שולם" ולקבל רישיון בחינם. טעות בפקודת ההפעלה בשרת אמיתי
// לא תפעיל אותו בשקט (ממצא 8): דורשים הסכמה מפורשת, ואף פעם לא עם תעודה או כתובת https ציבורית
function assertPaymentConfig({ pay, cert, publicUrl, env = {} }) {
  if (pay !== 'test') return;
  if (env.SS_ALLOW_TEST_PAYMENTS !== '1') throw new Error('ספק הבדיקות (--pay test) מאשר תשלומים בלי חיוב. להפעלה בבדיקות בלבד: SS_ALLOW_TEST_PAYMENTS=1');
  if (cert) throw new Error('ספק הבדיקות אינו מופעל עם תעודת HTTPS — זה נראה כמו שרת אמיתי');
  let host = '';
  try { host = new URL(String(publicUrl || '')).hostname; } catch { /* ייבדק אצל הספק */ }
  if (host && !['localhost', '127.0.0.1', '[::1]'].includes(host) && !host.endsWith('.test') && !host.endsWith('.localhost')) {
    throw new Error('ספק הבדיקות מופעל רק עם כתובת מקומית (localhost / ‎.test) — לא ' + host);
  }
}

// כתובת הלקוח להגבלת קצב. מאחורי שרת TLS (nginx וכו') remoteAddress הוא תמיד הפרוקסי, וכל הלקוחות
// חולקים מכסה אחת (ממצא 5). trustProxy — רק כשהשרת באמת מאחורי פרוקסי: אחרת כל לקוח יכול לזייף את הכותרת.
// לוקחים את הכתובת האחרונה ברשימה — זו שהפרוקסי שלנו הוסיף, ולא מה שהלקוח שלח
function clientAddress(req, trustProxy) {
  const direct = (req.socket && req.socket.remoteAddress) || '';
  if (!trustProxy) return direct;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return fwd.length ? fwd[fwd.length - 1] : direct;
}

function createServer({ dataDir, cert, key, clock, billing, trustProxy = false }) {
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
      try { relay.rateLimit(clientAddress(req, trustProxy)); } catch (e) { return send(e.status, { ok: false, error: e.message }); }
    }
    // webhook מספק התשלום
    if (req.method === 'POST' && req.url === '/pay/webhook') {
      return readBody(req, res, 64 * 1024, (rawBody) => {
        const fail = (e) => send(e.status || 500, { ok: false, error: e.status ? e.message : 'שגיאה בשרת' });
        try { Promise.resolve(relay.webhook({ rawBody, headers: req.headers })).then(r => send(200, r), fail); }
        catch (e) { fail(e); }
      });
    }
    // חזרה מדף התשלום של הספק (Cardcom וכו') — הודעה ללקוח בלבד; התשלום נקבע לפי ה-webhook המאומת, לא לפי הכתובת הזו
    if (req.method === 'GET' && /^\/pay\/(done|failed)(\?|$)/.test(req.url)) {
      const ok = req.url.startsWith('/pay/done');
      return sendHtml(res, 200, `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>SuperSuite</title></head>
<body style="font-family:Arial,sans-serif;max-width:460px;margin:60px auto;text-align:center">
<h2>${ok ? '✔ התשלום התקבל' : '✖ התשלום לא הושלם'}</h2>
<p>${ok ? 'אפשר לסגור את הדף ולחזור לתוכנה — הרישיון יגיע בסנכרון הקרוב.' : 'אפשר לחזור לתוכנה ולנסות שוב.'}</p></body></html>`);
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
      try { Promise.resolve(relay.handle(body, clientAddress(req, trustProxy))).then(r => send(200, r), fail); }
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
  // מאחורי פרוקסי TLS: --trust-proxy 1 (הגבלת הקצב לפי X-Forwarded-For)
  let billing = null;
  try {
    if (a['root-pub']) {
      const rootKeys = [JSON.parse(fs.readFileSync(a['root-pub'], 'utf8'))];
      assertPaymentConfig({ pay: a.pay, cert: a.cert, publicUrl: a['public-url'], env: process.env });
      const provider = a.pay ? createProvider(a.pay, { publicUrl: a['public-url'], secret: process.env.SS_PAY_SECRET, env: process.env }) : null;
      if (provider && provider.name === 'test') console.warn('⚠ ספק תשלום לבדיקות — אין חיוב אמיתי');
      billing = { rootKeys, provider };
    }
  } catch (e) {
    console.error('שגיאה בהגדרות השרת: ' + e.message);
    process.exit(1);
  }
  // מאחורי שרת TLS (Caddy / nginx): --trust-proxy 1 (או yes). --host 127.0.0.1 — כשהשרת הקדמי באותו מחשב
  const trustProxy = a['trust-proxy'] === '1' || a['trust-proxy'] === 'yes';
  const host = a.host || '0.0.0.0';
  const server = createServer({ dataDir: path.resolve(a.data || 'relay-data'), cert: a.cert, key: a.key, billing, trustProxy });
  server.listen(port, host, () => console.log(`שרת הרישוי פועל ב-${host}:${port}${a.cert ? ' (HTTPS)' : ' (HTTP — יש להפעיל מאחורי TLS)'}${trustProxy ? ', מאחורי שרת קדמי' : ''}`));
}

module.exports = { createRelay, createServer, KINDS, clientAddress, assertPaymentConfig, MAX_MAILBOX };
