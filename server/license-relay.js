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
const CK = require('../shell/licensing/checkin');
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
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000; // תשלום שלא הושלם — פג (expired)
const PAYMENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // תשלום שפג — נשמר לתשלום מאוחר, ואז נמחק
const PREKEY_MAX_BYTES = 1024;        // חבילת מפתח זמני אחת (בפועל כ-300 בתים)
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
// התיבה של מנהל-העל ציבורית (המזהה נגזר ממפתח השורש), ומפתח חדש לא עולה כלום (בדיקת קוד 22.10.2026, ממצאים 1–2)
const MAX_BOX_BYTES = 20 * 1024 ** 2;          // נפח ההודעות של שולחים בתיבה אחת — לא רק מספר הודעות
const SEND_PER_IP_TO_BOX_HOUR = 20;            // מכתובת אחת לתיבה אחת בשעה — לשולח שבעל התיבה לא כתב לו
const MAX_UNKNOWN_IN_OWNER_BOX = 250;          // אצל מנהל-העל: שולחים שהוא לא כתב להם — לא תופסים את המקום של לקוחות
const MAX_UNKNOWN_BYTES_IN_OWNER_BOX = 10 * 1024 ** 2;
const FETCH_MAX_MESSAGES = 100;                // משיכה בחלקים — תיבה גדולה לא נתקעת בזמן הקצוב של הלקוח
const FETCH_MAX_BYTES = 2 * 1024 ** 2;
const MAX_INDEX_CACHE = 20000;                 // אינדקסים של תיבות בזיכרון
const MAX_CONTACT_PAIRS = 200000;              // "בעל התיבה כתב לשולח" — בזיכרון
const MAX_OWNER_CONTACTS = 100000;             // של מנהל-העל — גם בקובץ
// הרשמה נחתמת במכשיר רגע לפני התשלום — הרשמה ישנה יותר היא שידור חוזר (בדיקת קוד 23.10.2026, ממצא 31)
const SIGNUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// billing (אופציונלי): { rootKeys, provider } — הרשמה ותשלום. בלי billing השרת הוא ממסר בלבד.
// identity (אופציונלי): { privateJwk, certText } — מפתח השרת ותעודה ממנהל-העל (loadRelayIdentity): כל משיכה עם
// אתגר מקבלת תשובה חתומה (shell/licensing/checkin.js). בלעדיו התוכנה לא מאריכה את תנאי ההפעלה מול השרת הזה
function createRelay({ dataDir, clock = Date.now, billing = null, maxStoreBytes = MAX_STORE_BYTES, identity = null }) {
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

  // מפתחות זמניים — קובץ קטן לכל מערכת. פעם הכול היה ב-prekeys.json אחד, שנקרא ונכתב במלואו בכל בקשה,
  // ויכול היה לגדול לכ-200MB ולחסום את השרת (בדיקת קוד 23.10.2026). קובץ ישן מפוצל פעם אחת
  const prekeyDir = path.join(dataDir, 'prekeys');
  const prekeyFile = (id) => path.join(prekeyDir, id + '.json');
  let prekeyCount = null;
  function prekeysReady() {
    if (prekeyCount !== null) return;
    fs.mkdirSync(prekeyDir, { recursive: true });
    const legacy = path.join(dataDir, 'prekeys.json');
    const old = readJson(legacy, null);
    if (old && typeof old === 'object') {
      for (const [id, b] of Object.entries(old)) if (ID_RE.test(id) && !fs.existsSync(prekeyFile(id))) writeJson(prekeyFile(id), b);
      removeFile(legacy);
    }
    prekeyCount = fs.readdirSync(prekeyDir).filter(n => n.endsWith('.json')).length;
  }

  const boxFile = (id) => path.join(dataDir, id + '.json');
  const readBox = (id) => readJson(boxFile(id), []);
  // אינדקס לכל תיבה, בזיכרון: מספר ונפח ההודעות לכל שולח. שליחה שתידחה נבדקת מולו ולא קוראת את כל התיבה
  // (ממצא 2). נבנה מהקובץ בפעם הראשונה ומתעדכן בכל כתיבה; קובץ שהשתנה מבחוץ (גודל / זמן שינוי) — נבנה מחדש
  const indexes = new Map();
  const stampOf = (id) => { try { const s = fs.statSync(boxFile(id)); return s.size + ':' + s.mtimeMs; } catch { return 'none'; } };
  const msgBytes = (m) => Buffer.byteLength(JSON.stringify(m));
  function indexAdd(ix, m, sign = 1) {
    if (m.from === 'relay') { ix.relay += sign; if (m.free) ix.free += sign; return; }
    // הודעת סטטוס של השורש — במקום השמור שלה (rootNotice), לא בתקרות של השולחים
    if (isRootNotice(m)) return;
    const b = msgBytes(m);
    const s = ix.senders.get(m.from) || { n: 0, bytes: 0, nn: 0, nb: 0 };
    s.n += sign; s.bytes += sign * b;
    // הודעות סטטוס של השולח (nn / nb) — מוחלפות בשליחה הבאה שלו לאותה תיבה, ולכן לא נספרות פעמיים
    if (m.kind === 'notices') { s.nn += sign; s.nb += sign * b; }
    if (s.n > 0) ix.senders.set(m.from, s); else ix.senders.delete(m.from);
    ix.n += sign; ix.bytes += sign * b;
  }
  function indexOf(id) {
    const stamp = stampOf(id);
    let ix = indexes.get(id);
    if (ix && ix.stamp === stamp) return ix;
    ix = { stamp, relay: 0, free: 0, n: 0, bytes: 0, senders: new Map() };
    for (const m of readBox(id)) indexAdd(ix, m);
    indexes.delete(id);
    if (indexes.size >= MAX_INDEX_CACHE) indexes.delete(indexes.keys().next().value);
    indexes.set(id, ix);
    return ix;
  }
  // delta: { added, removed } — עדכון האינדקס בלי לחשב מחדש את כל התיבה. בלי delta — ייבנה מחדש בגישה הבאה
  function writeBox(id, msgs, delta = null) {
    if (msgs.length) writeJson(boxFile(id), msgs); else removeFile(boxFile(id));
    const ix = indexes.get(id);
    if (!ix) return;
    if (!delta) { indexes.delete(id); return; }
    for (const m of delta.added || []) indexAdd(ix, m);
    for (const m of delta.removed || []) indexAdd(ix, m, -1);
    ix.stamp = stampOf(id);
  }
  // מי שבעל התיבה כתב לו — "מוכר" לה: לא כפוף למכסה לכתובת לתיבה, ואצל מנהל-העל לא נספר במכסה של שולחים
  // לא מוכרים. בזיכרון; של מנהל-העל — גם בקובץ, כדי שהלקוחות יוכרו אחרי הפעלה מחדש של השרת
  const ownerId = billing && billing.rootKeys && billing.rootKeys.length ? L.keyId(billing.rootKeys[0]) : null;
  // מפתח השורש — לזיהוי הודעות הסטטוס של מנהל-העל (סקירת אבטחה 24.10.2026, ממצא 3): מ---root-pub, ובלעדיו — המנפיק
  // שבתעודת השרת (identity). השולח מזוהה בחתימה על הבקשה, ולכן from === rootId מוכיח שזה בעל מפתח השורש
  let rootIdMemo;
  function rootId() {
    if (ownerId) return ownerId;
    if (rootIdMemo !== undefined) return rootIdMemo;
    if (!identity) return (rootIdMemo = null);
    let issuer = typeof identity.issuer === 'string' ? identity.issuer : null;
    if (!issuer && typeof identity.certText === 'string') { try { issuer = JSON.parse(identity.certText).payload.issuer; } catch { issuer = null; } }
    if (!issuer && !identity.certText) return null; // התעודה עוד לא נטענה — ננסה שוב בבקשה הבאה
    return (rootIdMemo = typeof issuer === 'string' && ID_RE.test(issuer) ? issuer : null);
  }
  // הודעת סטטוס של מנהל-העל: מקום שמור אחד בכל תיבה — לא נספרת בתקרות (MAX_MAILBOX, MAX_FROM_SENDER), לא פגה
  // אחרי 60 יום, ולא נמחקת באישור קבלה (ack). רק הודעת סטטוס חדשה יותר של השורש מחליפה אותה. כך מערכת שמילאה את
  // התיבה של עצמה, מערכת שלא התחברה חודשיים, או מי שמחזיק את מפתח המערכת ומאשר "קבלה" לפני שהתוכנה סנכרנה —
  // לא מונעים ממנהל-העל למסור השבתה, והיא נכללת בכל תשובה חתומה (checkin.js)
  const isRootNotice = (m) => !!m && m.kind === 'notices' && typeof m.from === 'string' && m.from === rootId();
  const contacts = new Map();
  let contactPairs = 0;
  let ownerContacts = null;
  let ownerContactsBroken = false;
  function ownerKnown() {
    if (ownerContacts) return ownerContacts;
    try { ownerContacts = new Set(readJson(path.join(dataDir, 'owner-contacts.json'), [])); }
    catch { ownerContacts = new Set(); ownerContactsBroken = true; } // קובץ שלא נקרא — לא נדרס; הלקוחות נספרים כלא מוכרים
    return ownerContacts;
  }
  const knows = (box, sender) => (box === ownerId ? ownerKnown().has(sender) : !!(contacts.get(box) && contacts.get(box).has(sender)));
  function remember(box, targets) {
    if (box === ownerId) {
      const known = ownerKnown();
      const fresh = targets.filter(t => !known.has(t)).slice(0, Math.max(0, MAX_OWNER_CONTACTS - known.size));
      if (!fresh.length) return;
      for (const t of fresh) known.add(t);
      if (!ownerContactsBroken) writeJson(path.join(dataDir, 'owner-contacts.json'), [...known]);
      return;
    }
    for (const t of targets) {
      const s = contacts.get(box);
      if (s && s.has(t)) continue;
      if (contactPairs >= MAX_CONTACT_PAIRS) return; // מלא — השולח פשוט נשאר כפוף למכסה לכתובת
      if (s) s.add(t); else contacts.set(box, new Set([t]));
      contactPairs++;
    }
  }
  const nonces = new Map(); // nonce ← תפוגה; מונע שידור חוזר של בקשה חתומה
  // מונים לפי חלון זמן: מפתח (כתובת / מפתח שולח) ← [זמנים]
  const windows = {
    hits: { ms: 60000, map: new Map() },
    sends: { ms: 3600000, map: new Map() },
    ipSends: { ms: 3600000, map: new Map() },
    ipBox: { ms: 3600000, map: new Map() },
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
      // הודעת הסטטוס של השורש לא פגה (ממצא 3): מערכת שלא התחברה יותר מ-60 יום עדיין מקבלת את ההשבתה
      const live = box.filter(x => x.from === 'relay' || isRootNotice(x) || now - x.at < MESSAGE_TTL_MS);
      if (live.length !== box.length) writeBox(m[1], live);
    }
  }
  // מכסה בחלון זמן. n — כמה פעמים לספור. quotas — כמה מכסות יחד: נבדקות כולן, ורק אז נספרות
  // (שליחה שנדחתה במכסה השנייה לא נספרת בראשונה)
  function quotas(list) {
    const now = clock();
    const live = list.map(([kind, key, limit, n, message]) => {
      const { ms, map } = windows[kind];
      const times = (map.get(key) || []).filter(t => now - t < ms);
      if (times.length + n > limit) throw httpError(429, message);
      return () => { for (let i = 0; i < n; i++) times.push(now); map.set(key, times); };
    });
    for (const take of live) take();
  }
  const quota = (kind, key, limit, n, message) => quotas([[kind, key, limit, n, message]]);

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
  const ownerBox = () => ownerId;
  const needBilling = () => { if (!billing || !billing.rootKeys || !billing.rootKeys.length) throw httpError(404, 'השרת אינו מוגדר להרשמה'); };
  // מסירה מהשרת עצמו (הרשמה ששולמה): לא כפופה לתקרת התיבה של השולחים — אחרת כל אחד יכול למלא את
  // תיבת מנהל-העל (המזהה ציבורי) ולחסום מסירה של הרשמות ששולמו (סקירת אבטחה 10.2026, ממצא 1).
  // הרשמות חינם (free) — בתקרה נפרדת, כדי שלא יתפסו את המקום של הרשמות ששולמו
  function deliver(to, kind, bodyText, { free = false } = {}) {
    const ix = indexOf(to);
    if (ix.relay >= MAX_SYSTEM_IN_BOX) throw httpError(507, 'תיבת היעד מלאה');
    if (free && ix.free >= MAX_FREE_IN_BOX) throw httpError(507, 'יש יותר מדי הרשמות שממתינות לאישור — נסו שוב מאוחר יותר');
    const msg = { id: crypto.randomUUID(), from: 'relay', kind, body: bodyText, at: clock(), ...(free ? { free: true } : {}) };
    assertRoom(msgBytes(msg), !free);
    writeBox(to, [...readBox(to), msg], { added: [msg] });
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
  // תשלום פתוח שפג — מסומן "expired" (לא נספר במכסות, הלקוח יכול לפתוח תשלום חדש), אבל נשמר יחד עם חבילת
  // ההרשמה עוד PAYMENT_KEEP_MS: לקוח ששילם למחרת, או ניסיון חוזר של הספק אחרי שהשרת היה למטה, עדיין מקבל רישיון.
  // פעם הרשומה נמחקה אחרי 24 שעות — והכרטיס חויב בלי שהרישיון נמסר (בדיקת קוד 23.10.2026)
  function livePayments(list, now) {
    return list.filter(x => {
      if (x.status === 'pending' && now - x.createdAt >= PAYMENT_TTL_MS) { x.status = 'expired'; x.expiredAt = now; }
      if (x.status !== 'expired' || now - x.createdAt < PAYMENT_KEEP_MS) return true;
      if (x.signup === undefined) removeFile(signupFile(x.id));
      return false;
    });
  }

  // הרשמה: נבדקת מול ההצעה החתומה; הסכום נקבע לפי ההצעה בלבד. תכנית חינם — נמסרת מיד.
  // ההצעה שבהרשמה חייבת להיות זו שמפורסמת עכשיו (offer.json): הצעה חתומה ישנה עם תכנית זולה או חינמית
  // לא מתקבלת (ממצא 31). ההרשמה עצמה — מהיממה האחרונה
  async function checkout(from, p, ip = '') {
    needBilling();
    const cur = readJsonFile('offer.json', null);
    if (!cur || typeof cur.text !== 'string') throw httpError(404, 'הספק עדיין לא פרסם תכניות');
    let v;
    try { v = SU.verifySignup(p.signup, billing.rootKeys, { current: OF.verifyOffer(cur.text, billing.rootKeys) }); } catch (e) { throw httpError(400, e.message); }
    if (v.body.keyId !== from) throw httpError(403, 'ההרשמה אינה של המכשיר השולח');
    if (!Number.isSafeInteger(v.body.signedAt) || Math.abs(clock() - v.body.signedAt) > SIGNUP_MAX_AGE_MS) throw httpError(400, 'ההרשמה ישנה — יש לפתוח מחדש את מסך הרכישה ולהירשם שוב');
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
    // תשלום שפג ("expired") עדיין מתקבל — הלקוח שילם, והרישיון חייב להימסר
    if (x.status !== 'pending' && x.status !== 'expired') return { ok: true, duplicate: true }; // הודעה כפולה מהספק
    // תשלום שפג ואז נכשל — אין שינוי (הוא כבר לא פתוח)
    if (x.status === 'expired' && ev.status !== 'paid') return { ok: true };
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

  // פעולות: send (לתיבה של אחר), fetch (התיבה שלי), ack (מחיקת הודעות שטופלו), checkin (הוכחה חתומה בלבד)
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
      // מזהה קצר בלבד: מזהה ארוך שימש לריפוד חבילות עד התקרה (בדיקת קוד 23.10.2026)
      if (JSON.stringify(b).length > PREKEY_MAX_BYTES || typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(payload.id)
        || !Number.isSafeInteger(payload.createdAt) || !/^[A-Za-z0-9_-]{43}$/.test(String(payload.pub))) throw httpError(400, 'מפתח זמני לא תקין');
      prekeysReady();
      const f = prekeyFile(from);
      const isNew = !fs.existsSync(f);
      if (isNew && prekeyCount >= MAX_PREKEYS) throw httpError(507, 'השרת מלא');
      if (isNew) assertRoom(PREKEY_MAX_BYTES + 30);
      writeJson(f, b);
      if (isNew) prekeyCount += 1;
      return { ok: true };
    }
    if (body.op === 'getPrekey') {
      if (!ID_RE.test(String(p.id))) throw httpError(400, 'מזהה לא תקין');
      prekeysReady();
      return { ok: true, bundle: readJson(prekeyFile(p.id), null) };
    }
    if (body.op === 'setOffer') return setOffer(from, p);
    if (body.op === 'getOffer') return getOffer();
    if (body.op === 'checkout') return checkout(from, p, ip);
    if (body.op === 'paymentStatus') return paymentStatus(from, p);
    if (body.op === 'send') {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || items.length > 50) throw httpError(400, 'אין מה לשלוח');
      const at = clock(); // זמן אחד לכל ההודעות בבקשה — הוא נחתם באישור המסירה (receipt)
      const root = rootId();
      const byBox = new Map();
      const rootItems = new Map(); // הודעות הסטטוס של השורש: לתיבה ← ההודעה (האחרונה בבקשה)
      for (const it of items) {
        // 'signup' נמסר רק על ידי השרת אחרי תשלום — לא בשליחה ישירה
        if (it && it.kind === 'signup') throw httpError(400, 'הרשמה נשלחת דרך התשלום');
        if (!it || !ID_RE.test(String(it.to)) || !KINDS.has(it.kind) || typeof it.body !== 'string' || it.body.length > MAX_MESSAGE) {
          throw httpError(400, 'הודעה לא תקינה');
        }
        if (it.to === from) throw httpError(400, 'הודעה לא תקינה');
        const msg = { id: crypto.randomUUID(), from, kind: it.kind, body: it.body, at };
        if (root && from === root && it.kind === 'notices') { rootItems.set(it.to, msg); continue; }
        const list = byBox.get(it.to) || [];
        // הודעת סטטוס מחליפה את הקודמת של אותו שולח לאותה תיבה שטרם נקראה (סקירת אבטחה 24.10.2026, ממצא 2) —
        // חבילת הסטטוס תמיד מלאה, והישנה מיותרת. כך עדכונים חוזרים לא ממלאים את התיבה עד 429
        byBox.set(it.to, it.kind === 'notices' ? [...list.filter(m => m.kind !== 'notices'), msg] : [...list, msg]);
      }
      // כל הבדיקות לפני כתיבה כלשהי — שליחה רגילה נכשלת כולה או מצליחה כולה. התקרות נבדקות מול האינדקס,
      // ושליחה שנדחית לא קוראת את התיבה (ממצא 2). התקרה סופרת רק הודעות של שולחים — הודעות מהשרת
      // (הרשמות ששולמו) והודעות הסטטוס של השורש (מקום שמור) לא תופסות מקום של אחרים
      const regular = [...byBox.values()].reduce((n, l) => n + l.length, 0);
      const limits = regular ? [
        ['sends', from, SEND_PER_HOUR, regular, 'יותר מדי הודעות בשעה האחרונה — נסו מאוחר יותר'],
        ['ipSends', ip, SEND_PER_IP_HOUR, regular, 'יותר מדי הודעות מהכתובת הזו בשעה האחרונה — נסו מאוחר יותר'],
      ] : [];
      let total = 0;
      for (const [to, msgs] of byBox) {
        const ix = indexOf(to);
        const add = msgs.reduce((t, m) => t + msgBytes(m), 0);
        total += add + msgs.length;
        const mine = ix.senders.get(from) || { n: 0, bytes: 0, nn: 0, nb: 0 };
        // הודעות הסטטוס הקודמות של השולח בתיבה הזו יוחלפו — לא נספרות
        const rep = msgs.some(m => m.kind === 'notices') ? { n: mine.nn || 0, bytes: mine.nb || 0 } : { n: 0, bytes: 0 };
        if (ix.n - rep.n + msgs.length > MAX_MAILBOX || ix.bytes - rep.bytes + add > MAX_BOX_BYTES) throw httpError(507, 'תיבת היעד מלאה');
        if (mine.n - rep.n + msgs.length > MAX_FROM_SENDER_IN_BOX) throw httpError(429, 'יותר מדי הודעות שטרם נקראו אצל הנמען');
        if (knows(to, from)) continue;
        // שולח שבעל התיבה לא כתב לו: מכסה לכתובת לתיבה (ממצא 1א), ואצל מנהל-העל — חלק מוגבל מהתיבה (1ב)
        if (to === ownerId) {
          let n = 0, bytes = 0;
          for (const [s, v] of ix.senders) if (!knows(to, s)) { n += v.n; bytes += v.bytes; }
          if (n - rep.n + msgs.length > MAX_UNKNOWN_IN_OWNER_BOX || bytes - rep.bytes + add > MAX_UNKNOWN_BYTES_IN_OWNER_BOX) throw httpError(507, 'תיבת היעד מלאה — נסו שוב מאוחר יותר');
        }
        limits.push(['ipBox', ip + '>' + to, SEND_PER_IP_TO_BOX_HOUR, msgs.length, 'יותר מדי הודעות לנמען הזה מהכתובת הזו בשעה האחרונה — נסו מאוחר יותר']);
      }
      if (regular) assertRoom(total);
      const boxes = [...byBox].map(([to, msgs]) => [to, readBox(to), msgs]); // קובץ שלא נקרא — נכשל לפני שנספר במכסות
      quotas(limits);
      const stored = [];
      for (const [to, box, msgs] of boxes) {
        const replaced = msgs.some(m => m.kind === 'notices') ? box.filter(m => m.from === from && m.kind === 'notices' && !isRootNotice(m)) : [];
        const keep = replaced.length ? box.filter(m => !replaced.includes(m)) : box;
        writeBox(to, [...keep, ...msgs], { added: msgs, removed: replaced });
        for (const m of msgs) stored.push([to, m]);
      }
      // הודעות הסטטוס של השורש (ממצא 3) — כל תיבה בנפרד, בלי התקרות של השולחים ובלי מכסות השליחה (המקום השמור:
      // אחת לתיבה, במקום הקודמת, בראש התיבה — כך היא בחלק הראשון של כל משיכה). כישלון אצל נמען אחד לא עוצר את האחרים
      const failed = [];
      for (const [to, msg] of rootItems) {
        try {
          const box = readBox(to);
          const removed = box.filter(isRootNotice);
          assertRoom(msgBytes(msg) - removed.reduce((t, m) => t + msgBytes(m), 0), true);
          writeBox(to, [msg, ...box.filter(m => !isRootNotice(m))], { added: [msg], removed });
          stored.push([to, msg]);
        } catch (e) { failed.push({ to, error: e && e.status ? e.message : 'שגיאה בשרת' }); }
      }
      // הכול נכשל (רק הודעות של השורש) — שגיאה, כדי שגם תוכנה ישנה שלא קוראת את failed תדע
      if (!stored.length && failed.length) throw httpError(507, failed[0].error);
      remember(from, [...new Set(stored.map(([to]) => to))]);
      const res = { ok: true, sent: stored.length, ...(failed.length ? { failed } : {}) };
      // אישור מסירה חתום (ממצא 5): [נמען, מזהה, תמצית] לכל הודעה שנשמרה, על האתגר של השולח
      if (identity && identity.certText && CK.validChallenge(p.receipt)) {
        res.receipt = CK.signSendReceipt(identity.privateJwk, { origin: identity.origin, box: from, challenge: p.receipt, at,
          items: stored.map(([to, m]) => [to, m.id, CK.messageDigest(m)]) });
        res.relayCert = identity.certText;
      }
      return res;
    }
    // משיכה בחלקים (ממצא 1ד): עד FETCH_MAX_MESSAGES / FETCH_MAX_BYTES (לפחות הודעה אחת), אחרי ההודעה after.
    // more — יש עוד; הלקוח ממשיך עם after = ההודעה האחרונה שקיבל. after שכבר נמחק — מההתחלה
    if (body.op === 'fetch') {
      const box = readBox(from);
      const start = typeof p.after === 'string' ? box.findIndex(m => m.id === p.after) + 1 : 0;
      const out = [];
      let bytes = 0;
      for (let i = start; i < box.length && out.length < FETCH_MAX_MESSAGES; i++) {
        const b = msgBytes(box[i]);
        if (out.length && bytes + b > FETCH_MAX_BYTES) break;
        out.push(box[i]);
        bytes += b;
      }
      const res = { ok: true, messages: out, more: start + out.length < box.length };
      // בדיקה חתומה (ממצא 27): חתימה על האתגר של הלקוח, התיבה שלו, הזמן, הכתובת שבתעודה — וכל ההודעות שבתיבה
      // ברגע זה (מזהה + תמצית), כך שהלקוח מזהה תשובה שהודעה נמחקה ממנה או שתוכנה הוחלף בדרך
      if (identity && CK.validChallenge(p.checkin)) {
        res.checkin = CK.signCheckin(identity.privateJwk, { purpose: 'fetch', origin: identity.origin, box: from, challenge: p.checkin,
          at: clock(), items: CK.boxItems(box) });
        res.relayCert = identity.certText;
      }
      return res;
    }
    // הוכחה בלבד (בלי הודעות): התוכנה מוודאת שזה השרת של הספק לפני שליחת פרטי הרשמה או פתיחת דף תשלום
    if (body.op === 'checkin') {
      if (!identity) throw httpError(404, 'השרת אינו מוגדר לבדיקה חתומה');
      if (!CK.validChallenge(p.checkin)) throw httpError(400, 'בקשה לא תקינה');
      return { ok: true, checkin: CK.signCheckin(identity.privateJwk, { purpose: 'hello', origin: identity.origin, box: from, challenge: p.checkin, at: clock() }),
        relayCert: identity.certText };
    }
    // items: [[מזהה, תמצית]] — נמחקת רק הודעה שהתוכן השמור שלה זהה למה שהלקוח קיבל: שרת ביניים שהחליף את התוכן
    // של הודעת השבתה לא יכול לגרום למחיקתה (ממצא 27). ids בלבד — תוכנה ישנה
    if (body.op === 'ack') {
      let match;
      if (Array.isArray(p.items)) {
        const want = new Map(p.items.slice(0, CK.MAX_ITEMS).filter(CK.validAckItem));
        if (!want.size) return { ok: true, removed: 0 };
        match = (m) => want.has(m.id) && want.get(m.id) === CK.messageDigest(m);
      } else {
        const ids = new Set(Array.isArray(p.ids) ? p.ids.map(String) : []);
        if (!ids.size) return { ok: true, removed: 0 };
        match = (m) => ids.has(m.id);
      }
      // הודעת הסטטוס של השורש לא נמחקת באישור קבלה (ממצא 3) — רק הודעה חדשה יותר של השורש מחליפה אותה
      const drop = (m) => match(m) && !isRootNotice(m);
      const box = readBox(from);
      const removed = box.filter(drop);
      if (removed.length) writeBox(from, box.filter(m => !drop(m)), { removed });
      return { ok: true, removed: removed.length };
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

// מפתח השרת לבדיקה החתומה (shell/licensing/checkin.js). נוצר על השרת עצמו — המפתח הפרטי לא יוצא ממנו:
//   node server/license-relay.js --gen-relay-key /var/lib/supersuite-relay/relay-key.json
// נכתבים relay-key.json (פרטי, הרשאה 600, לא נדרס) ו-relay-key.pub.json (ציבורי — עובר למנהל-העל לתעודה)
function generateRelayKey(file) {
  if (fs.existsSync(file)) throw new Error('כבר קיים מפתח שרת ב-' + file + ' — לא נדרס. מפתח חדש מחייב תעודה חדשה');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const k = L.generateKeyPair();
  fs.writeFileSync(file, JSON.stringify(k.privateJwk), { mode: 0o600, flag: 'wx' });
  const pubFile = file.replace(/\.json$/i, '') + '.pub.json';
  fs.writeFileSync(pubFile, JSON.stringify(k.publicJwk));
  return { keyId: k.keyId, publicJwk: k.publicJwk, pubFile };
}

// טעינת מפתח השרת והתעודה. אין אף אחד מהם — null (ממסר בלי בדיקה חתומה; התוכנה לא תאריך מולו את ההפעלה).
// רק אחד מהם, תעודה של מפתח אחר, או תעודה שאינה של מפתח השורש (כשהוא ידוע) — שגיאה, והשרת לא עולה
function loadRelayIdentity({ keyFile, certFile, rootKeys = null, now = Date.now() }) {
  const hasKey = fs.existsSync(keyFile), hasCert = fs.existsSync(certFile);
  if (!hasKey && !hasCert) return null;
  if (!hasKey) throw new Error('נמצאה תעודת שרת (' + certFile + ') בלי מפתח השרת (' + keyFile + ')');
  if (!hasCert) throw new Error('נמצא מפתח שרת (' + keyFile + ') בלי תעודה ממנהל-העל (' + certFile + ')');
  let privateJwk, certText, cert;
  // המפתח הפרטי חייב להתאים לחלק הציבורי שבקובץ (x) — אחרת כל חתימה תיפסל אצל הלקוחות
  let pairOk = false;
  try { privateJwk = JSON.parse(fs.readFileSync(keyFile, 'utf8')); pairOk = L.verifyObject({ t: 1 }, L.signObject({ t: 1 }, privateJwk), privateJwk); } catch { pairOk = false; }
  if (!pairOk) throw new Error('קובץ מפתח השרת פגום: ' + keyFile);
  certText = fs.readFileSync(certFile, 'utf8').trim();
  try { cert = JSON.parse(certText).payload; } catch { cert = null; }
  if (!cert || cert.type !== CK.CERT_TYPE) throw new Error('קובץ התעודה פגום: ' + certFile);
  // תעודה מגרסה קודמת (בלי כתובת השרת) — התוכנה דוחה אותה, ולכן גם השרת לא עולה איתה
  if (typeof cert.origin !== 'string') throw new Error('התעודה בלי כתובת השרת (גרסה קודמת) — יש להנפיק תעודה חדשה עם --url: ' + certFile);
  if (rootKeys && rootKeys.length) cert = CK.verifyRelayCert(certText, rootKeys, now, { allowExpired: true });
  if (!cert.relayKey || cert.relayKey.x !== privateJwk.x) throw new Error('התעודה שייכת למפתח שרת אחר — יש להנפיק תעודה למפתח הנוכחי');
  return { privateJwk, certText, relayId: cert.relayId, origin: cert.origin, issuer: cert.issuer, expiresAt: cert.expiresAt, expired: now > cert.expiresAt };
}

// תפוגת התעודה של מפתח השרת (סקירת אבטחה 24.10.2026, ממצא 4): אחרי התפוגה התוכנות לא מאריכות את ההפעלה, וכל
// המערכות ננעלות 30 יום אחר כך. השרת בודק פעם ביום (לא רק בעלייה) וכותב אזהרה ביומן — מ-30 יום לפני התפוגה.
// מחזיר את שורת היומן, או null כשאין מה להזהיר
const CERT_WARN_DAYS = 30;
function certWarning(identity, now = Date.now()) {
  if (!identity || !Number.isSafeInteger(identity.expiresAt)) return null;
  const days = Math.ceil((identity.expiresAt - now) / (24 * 60 * 60 * 1000));
  const date = new Date(identity.expiresAt).toLocaleDateString('he-IL');
  if (days <= 0) return `⚠ תוקף התעודה של מפתח השרת פג (${date}) — התוכנות לא מאריכות את ההפעלה מול השרת, וכל המערכות ננעלות 30 יום אחרי התפוגה. יש להנפיק תעודה חדשה (docs/LICENSING-ACTIVATION.md, שלב 7)`;
  if (days <= CERT_WARN_DAYS) return `⚠ התעודה של מפתח השרת תפוג בעוד ${days} ימים (${date}) — יש להנפיק תעודה חדשה ולהתקין אותה בשרת (docs/LICENSING-ACTIVATION.md, שלב 7, "חידוש")`;
  return null;
}

function createServer({ dataDir, cert, key, clock, billing, trustProxy = false, identity = null }) {
  const relay = createRelay({ dataDir, clock, billing, identity });
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
  // יצירת מפתח השרת לבדיקה החתומה (פעם אחת, על השרת): --gen-relay-key <קובץ>
  if (a['gen-relay-key']) {
    try {
      const r = generateRelayKey(path.resolve(String(a['gen-relay-key'])));
      console.log('נוצר מפתח שרת ' + r.keyId + '. המפתח הציבורי (למנהל-העל, ליצירת התעודה): ' + r.pubFile);
      console.log(JSON.stringify(r.publicJwk));
      process.exit(0);
    } catch (e) { console.error('שגיאה: ' + e.message); process.exit(1); }
  }
  // הרשמה ותשלום: --root-pub <קובץ המפתח הציבורי של מנהל-העל> --pay test|<ספק> --public-url https://...
  // מאחורי פרוקסי TLS: --trust-proxy 1 (הגבלת הקצב לפי X-Forwarded-For)
  // בדיקה חתומה: relay-key.json + relay-cert.json בתיקיית הנתונים (או --relay-key / --relay-cert)
  let billing = null;
  let identity = null;
  const dataDir = path.resolve(a.data || 'relay-data');
  try {
    let rootKeys = null;
    if (a['root-pub']) {
      rootKeys = [JSON.parse(fs.readFileSync(a['root-pub'], 'utf8'))];
      assertPaymentConfig({ pay: a.pay, cert: a.cert, publicUrl: a['public-url'], env: process.env });
      const provider = a.pay ? createProvider(a.pay, { publicUrl: a['public-url'], secret: process.env.SS_PAY_SECRET, env: process.env }) : null;
      if (provider && provider.name === 'test') console.warn('⚠ ספק תשלום לבדיקות — אין חיוב אמיתי');
      billing = { rootKeys, provider };
    }
    identity = loadRelayIdentity({ keyFile: path.resolve(a['relay-key'] || path.join(dataDir, 'relay-key.json')),
      certFile: path.resolve(a['relay-cert'] || path.join(dataDir, 'relay-cert.json')), rootKeys });
    if (!identity) console.warn('⚠ אין מפתח שרת ותעודה — התוכנות לא יאריכו את תנאי ההפעלה מול השרת הזה (docs/LICENSING-ACTIVATION.md, שלב 7)');
    else {
      // בעלייה ואחר כך פעם ביום — שרת שרץ חודשים בלי הפעלה מחדש עדיין מזהיר לפני התפוגה (ממצא 4)
      const warnCert = () => { const w = certWarning(identity); if (w) console.warn(w); };
      warnCert();
      setInterval(warnCert, 24 * 60 * 60 * 1000).unref();
    }
  } catch (e) {
    console.error('שגיאה בהגדרות השרת: ' + e.message);
    process.exit(1);
  }
  // מאחורי שרת TLS (Caddy / nginx): --trust-proxy 1 (או yes). --host 127.0.0.1 — כשהשרת הקדמי באותו מחשב
  const trustProxy = a['trust-proxy'] === '1' || a['trust-proxy'] === 'yes';
  const host = a.host || '0.0.0.0';
  const server = createServer({ dataDir, cert: a.cert, key: a.key, billing, trustProxy, identity });
  server.listen(port, host, () => console.log(`שרת הרישוי פועל ב-${host}:${port}${a.cert ? ' (HTTPS)' : ' (HTTP — יש להפעיל מאחורי TLS)'}${trustProxy ? ', מאחורי שרת קדמי' : ''}${identity ? ', בדיקה חתומה: ' + identity.relayId + ' (' + identity.origin + ')' : ''}`));
}

module.exports = { createRelay, createServer, generateRelayKey, loadRelayIdentity, certWarning, CERT_WARN_DAYS, MESSAGE_TTL_MS, MAX_FROM_SENDER_IN_BOX, KINDS, clientAddress, assertPaymentConfig, MAX_MAILBOX, SIGNUP_MAX_AGE_MS,
  MAX_BOX_BYTES, SEND_PER_IP_TO_BOX_HOUR, MAX_UNKNOWN_IN_OWNER_BOX, FETCH_MAX_MESSAGES, FETCH_MAX_BYTES };
