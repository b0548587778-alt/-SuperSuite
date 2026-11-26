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
const PR = require('../shell/licensing/products');
const SU = require('../shell/licensing/signup');
const M = require('../shell/licensing/messages');
const CK = require('../shell/licensing/checkin');
const { createProvider } = require('./payments');

const MAX_BODY = 512 * 1024;          // בקשה
const MAX_MESSAGE = 256 * 1024;       // הודעה אחת
const MAX_MAILBOX = 500;              // הודעות שממתינות בתיבה
const CLOCK_SKEW_MS = 5 * 60 * 1000;  // חלון זמן לחתימה
// הגבלת קצב (סקירה 2.11.2026, f16): לקוחות NetFree יוצאים מכמה כתובות משותפות (הסינון מפענח TLS), ולכן המכסה
// העיקרית — לפי המפתח המאומת (keyId), אחרי האימות. לפני האימות — רק מכסה גבוהה לכתובת, ומכסה נמוכה לכשלי אימות.
// בקשה שאומתה לא נדחית בגלל כשלים או עומס של אחרים מאותה כתובת (סקירה 5.11.2026): authFailPerIpMinute חלה רק על
// בקשות שנכשלו באימות; מעל perIpMinute הכתובת "עמוסה" — עוברות רק בקשות של מכשירים מוכרים (מפתח זמני בשרת),
// ומעל perIpHardMinute (הצפה נפחית) — הכול נדחה לפני קריאת הגוף (docs/RELAY-DEPLOY.md, "הגבלת קצב")
const RATE = { perMinute: 60, perIpMinute: 1200, perIpHardMinute: 12000, authFailPerIpMinute: 120 };
const MAX_CONN_PER_IP = 64;           // בקשות /v1 פתוחות במקביל מכתובת אחת — לפני קריאת הגוף (f19)
const MAX_INFLIGHT_BYTES = 128 * 1024 ** 2; // גופי בקשות בזיכרון יחד
const MAX_CONNECTIONS = 1024;         // server.maxConnections
// אישור חיבור בקובץ (shell/licensing/sync.js → offlineRequest): בקשת משיכה שנחתמה במחשב בלי חיבור ומגיעה דרך מחשב
// אחר — תקפה עד 14 יום אחרי החתימה (לא לעתיד), לקריאה בלבד: בלי מחיקה, ובלי פעולה אחרת
const OFFLINE_OP = 'offlineFetch';
const OFFLINE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;  // מזהה מפתח (keyId)
const KINDS = new Set(['license-request', 'approval-request', 'approval', 'rejection', 'license', 'notices', 'message', 'update', 'signup']);
const MAX_FROM_SENDER_IN_BOX = 100;   // הודעות של שולח אחד שממתינות בתיבה של אחר — שולח אחד לא ממלא תיבה
const MAX_SYSTEM_IN_BOX = 5000;       // הודעות מהשרת עצמו (הרשמות ששולמו) — לא נספרות ב-MAX_MAILBOX
const SEND_PER_HOUR = 500;            // הודעות שמפתח אחד שולח בשעה
const MAX_NONCES = 200000;            // זיכרון — מעבר לזה השרת עמוס
// בקשות offlineFetch נשמרות 14 יום — במפה נפרדת ומוגבלת, שבה הישנה ביותר מפנה מקום (לא "השרת עמוס"): מילוי שלה
// (מפתחות חדשים בלי הרשמה) לא חוסם את שאר הבקשות ולא את האישורים בקובץ. המחיר — בקשה ישנה שפונתה אפשר לשדר שוב,
// והיא קריאה בלבד (סקירה 11.2026, f81)
const MAX_OFFLINE_NONCES = 50000;
const OFFLINE_PER_HOUR = 30;          // בקשות אישור בקובץ לשעה לכל כתובת
const MAX_PREKEYS = 100000;           // מפתחות זמניים שמורים
const PREKEY_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // מפתח זמני שלא חודש 30 יום — נמחק בסבב היומי (הלקוח דוחה אותו ממילא, f17)
// מכשיר מוכר (סקירה 5.11.2026): אחרי שהמפתח הזמני נמחק (30 יום) נשאר סימון קטן (known/<id>) עוד KNOWN_KEEP_MS מהחידוש
// האחרון — יותר מ-LOCK_DAYS (60) של התוכנה, עם מרווח. מכשיר שחוזר אחרי חודש-חודשיים בלי חיבור נחשב מוכר: עובר בכתובת
// עמוסה, ופרסום המפתח הזמני שלו מחדש לא נספר כמכשיר חדש
const KNOWN_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_KNOWN = 200000;             // סימונים (קובץ ריק כמעט לכל אחד) — מעבר לזה לא נוצרים חדשים
const NEW_PREKEYS_PER_IP_DAY = 200;   // מפתחות זמניים חדשים (מכשיר חדש) מכתובת אחת ביום
const NEW_PREKEYS_PER_DAY = 20000;    // בשרת כולו ביום (תיבה בלי מפתח זמני עדיין "חיה" כשנמשכה — סקירה 5.11.2026)
const MAX_PENDING_PAYMENTS = 5;            // תשלומים פתוחים למכשיר
const PAYMENT_TTL_MS = 24 * 60 * 60 * 1000; // תשלום שלא הושלם — פג (expired)
const PAYMENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // תשלום שפג — נשמר לתשלום מאוחר, ואז נמחק
const PREKEY_MAX_BYTES = 1024;        // חבילת מפתח זמני אחת (בפועל כ-300 בתים)
// מפתח חדש לא עולה כלום, ולכן מכסה לפי מפתח לבדה לא עוצרת הצפה — יש גם מכסות לפי כתובת (בדיקת אבטחה 21.10.2026)
const SEND_PER_IP_HOUR = 3000;        // הודעות מכתובת אחת בשעה (כתובת משותפת של NetFree — f16)
// דפי תשלום והרשמות חינם — לפי מפתח המכשיר (f16), ומכסת גיבוי גבוהה לכתובת (מפתח חדש לא עולה כלום)
const CHECKOUT_PER_KEY_DAY = 5;       // דפי תשלום ממכשיר אחד ביום (כל אחד נפתח גם אצל ספק הסליקה)
const CHECKOUT_PER_IP_DAY = 200;
const FREE_SIGNUP_PER_KEY_DAY = 2;    // הרשמות לתכנית חינם ממכשיר אחד ביום
const FREE_SIGNUP_PER_IP_DAY = 30;
// נפח שנשמר (f18): לא רק מספר הודעות — בתים ביממה לכל מפתח שולח ולכל כתובת
const STORE_BYTES_PER_KEY_DAY = 32 * 1024 ** 2;
const STORE_BYTES_PER_IP_DAY = 200 * 1024 ** 2;
const SEND_MAX_BOXES = 10;            // תיבות שונות בבקשת send אחת (חוץ ממנהל-העל) — f3
const MAX_FREE_IN_BOX = 1000;         // הרשמות חינם שממתינות אצל מנהל-העל — לא תופסות מקום של הרשמות ששולמו
const MAX_PENDING_TOTAL = 5000;       // תשלומים פתוחים בשרת כולו
const MAX_STORE_BYTES = 2 * 1024 ** 3;          // כל הקבצים יחד — מעבר לזה שליחה רגילה נדחית, והדיסק לא מתמלא
const SYSTEM_RESERVE_BYTES = 256 * 1024 ** 2;   // מקום שמור למסירות של השרת עצמו (הרשמות ששולמו)
const CHECKOUT_RESERVE_BYTES = 64 * 1024 ** 2;  // מקום שמור לרכישה ולהרשמה (f18): הצפה לא חוסמת מכירות
const MESSAGE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // הודעה שלא נקראה 60 יום נמחקת (מסירות של השרת — לא)
// תיבה שאיש לא משך ממנה ושאין לה מפתח זמני (כנראה אין לה בעלים) — ההודעות בה נמחקות אחרי 7 ימים (f18).
// תיבת מנהל-העל (בקשות רישיון) — תמיד "חיה"
const DEAD_BOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SEEN = 1000000;             // סימוני "נמשכה" (קובץ קטן לכל תיבה). נוצר רק לתיבה שיש בה הודעות או מפתח זמני;
                                      // מעבר לתקרה — בזיכרון בלבד (seenMemo), כך שמכשיר חדש לא נחשב "מת"
// נפח שממתין בשרת (טרם נקרא ונמחק) לפי מקור — לאורך כל תקופת השמירה, לא רק ביממה (סקירה 5.11.2026, f18): מי שמשך
// פעם את התיבה של עצמו כדי שההודעות לא יפוגו אחרי 7 ימים — עדיין לא תופס יותר מזה. הודעה שנקראה ונמחקה (ack) מפנה
// את המקום. הספירה נבנית מחדש מהתיבות בכל סבב יומי
const STORED_BYTES_PER_KEY = 32 * 1024 ** 2;
const STORED_BYTES_PER_IP = 256 * 1024 ** 2;
const SWEEP_CHUNK = 200;              // קבצים בכל צעד של הסבב היומי (מחוץ למסלול הבקשה)
const BOX_SWEEP_MS = 24 * 60 * 60 * 1000;
// ניקוי תשלומים שלא הושלמו (ופרטי ההרשמה שלהם) — כל שעה, גם בלי הרשמות חדשות: מדיניות הפרטיות מבטיחה
// מחיקה בתוך 31 יום (PAYMENT_KEEP_MS + עד שעה)
const PAYMENT_SWEEP_MS = 60 * 60 * 1000;
// התאמה מול ספק הסליקה (f15): תשלום פתוח נבדק החל מ-10 דקות (ה-webhook מגיע בדרך כלל תוך שניות), שפג — פעם ביממה,
// ובדיקה אחרונה ביממה שלפני המחיקה. עד RECONCILE_PER_SWEEP בדיקות בסבב; מבדיקת מצב של לקוח — פעם בחצי דקה לתשלום
const RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;
const RECONCILE_EXPIRED_EVERY_MS = 24 * 60 * 60 * 1000;
const RECONCILE_FINAL_MS = 24 * 60 * 60 * 1000;
const RECONCILE_DELETE_GRACE_MS = 22 * 60 * 60 * 1000; // ספק שלא ענה — מחיקה בכל זאת (30 יום + 22 שעות + עד שעה)
const RECONCILE_PER_SWEEP = 50;
const RECONCILE_STATUS_GAP_MS = 30 * 1000;
// התיבה של מנהל-העל ציבורית (המזהה נגזר ממפתח השורש), ומפתח חדש לא עולה כלום (בדיקת קוד 22.10.2026, ממצאים 1–2)
const MAX_BOX_BYTES = 20 * 1024 ** 2;          // נפח ההודעות של שולחים בתיבה אחת — לא רק מספר הודעות
const SEND_PER_IP_TO_BOX_HOUR = 60;            // מכתובת אחת לתיבה אחת בשעה — לשולח שבעל התיבה לא כתב לו
const MAX_UNKNOWN_IN_OWNER_BOX = 250;          // אצל מנהל-העל: שולחים שהוא לא כתב להם — לא תופסים את המקום של לקוחות
const MAX_UNKNOWN_BYTES_IN_OWNER_BOX = 10 * 1024 ** 2;
const FETCH_MAX_MESSAGES = 100;                // משיכה בחלקים — תיבה גדולה לא נתקעת בזמן הקצוב של הלקוח
const FETCH_MAX_BYTES = 2 * 1024 ** 2;
const MAX_INDEX_CACHE = 20000;                 // אינדקסים של תיבות בזיכרון
const MAX_CONTACT_PAIRS = 200000;              // "בעל התיבה כתב לשולח" — בזיכרון
const MAX_OWNER_CONTACTS = 100000;             // של מנהל-העל — גם בקובץ
// הרשמה נחתמת במכשיר רגע לפני התשלום — הרשמה ישנה יותר היא שידור חוזר (בדיקת קוד 23.10.2026, ממצא 31)
const SIGNUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// יכולת שלקוח מודיע עליה במשיכה (payload.caps): קורא מסירת הרשמה מוצפנת (v2). מנהל-העל בגרסה קודמת לא מודיע — ואצלו
// המסירות האלה ממתינות בשרת (לא נמסרות ולא נמחקות) עד שיעדכן. התחילית — כפי ש-deliveryOf כותב (JSON.stringify)
const CAP_SIGNUP_V2 = 'signup-v2';
const SIGNUP_V2_PREFIX = '{"type":"supersuite-signup-delivery","v":2,';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// billing (אופציונלי): { rootKeys, provider } — הרשמה ותשלום. בלי billing השרת הוא ממסר בלבד.
// identity (אופציונלי): { privateJwk, certText } — מפתח השרת ותעודה ממנהל-העל (loadRelayIdentity): כל משיכה עם
// אתגר מקבלת תשובה חתומה (shell/licensing/checkin.js). בלעדיו התוכנה לא מאריכה את תנאי ההפעלה מול השרת הזה
// background: הסבב היומי בחלקים, מחוץ לבקשה (השרת האמיתי — createServer); בלעדיו — מיד, בתוך הבקשה (בדיקות)
// storeBytesPerKeyDay / storeBytesPerIpDay — מכסות הנפח (f18); לשינוי בבדיקות בלבד
// maxNonces / maxOfflineNonces — לבדיקות (מילוי המפות בלי מאות אלפי חתימות)
function createRelay({ dataDir, clock = Date.now, billing = null, maxStoreBytes = MAX_STORE_BYTES, identity = null, background = false,
  storeBytesPerKeyDay = STORE_BYTES_PER_KEY_DAY, storeBytesPerIpDay = STORE_BYTES_PER_IP_DAY,
  storedBytesPerKey = STORED_BYTES_PER_KEY, storedBytesPerIp = STORED_BYTES_PER_IP, maxSeen = MAX_SEEN,
  maxNonces = MAX_NONCES, maxOfflineNonces = MAX_OFFLINE_NONCES }) {
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
  // כתיבה עמידה (סקירה 2.11.2026, f88): קובץ זמני ← fsync ← החלפה ← fsync לתיקייה. בלי ה-fsync הפסקת חשמל אחרי
  // ההחלפה יכלה להשאיר תיבה / payments.json ריקים — אחרי שחבילת ההרשמה כבר נמחקה. כך כל כתיבה (התיבה של מנהל-העל,
  // payments.json, חבילות ההרשמה) בדיסק לפני הצעד הבא, וחבילת ההרשמה נמחקת רק אחרי שהמסירה ו-payments.json נשמרו
  function writeJson(f, v) {
    const text = JSON.stringify(v);
    const before = sizeOf(f);
    const tmpFile = f + '.tmp';
    const fd = fs.openSync(tmpFile, 'w');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmpFile, f);
    syncDir(path.dirname(f));
    if (used !== null) used += Buffer.byteLength(text) - before;
  }
  // fsync לתיקייה — שההחלפה (rename) עצמה בדיסק. ב-Windows פתיחת תיקייה נכשלת — מדלגים (השרת רץ ב-Linux)
  function syncDir(dir) {
    let fd = null;
    try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* לא נתמך */ } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* */ } } }
  }
  function removeFile(f) {
    const s = sizeOf(f);
    try { fs.rmSync(f, { force: true }); if (used !== null) used -= s; } catch { /* ינוקה בסבב הבא */ }
  }
  // tier: true — מסירה של השרת עצמו (הרשמה ששולמה): גם המקום השמור שלה; 'checkout' — רכישה והרשמה חינם (f18):
  // מקום שמור משלהן, כך שהצפה של הודעות לא חוסמת מכירות
  function assertRoom(extra, tier = false) {
    const limit = maxStoreBytes + (tier ? CHECKOUT_RESERVE_BYTES : 0) + (tier === true ? SYSTEM_RESERVE_BYTES : 0);
    if (usedBytes() + extra > limit) throw httpError(507, 'השרת מלא — נסו שוב מאוחר יותר');
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
  // הקובץ: { at: זמן השרת, bundle } — הזמן של השרת (לא createdAt של הלקוח, שאפשר לקבוע לעתיד) קובע מתי נמחק.
  // קובץ ישן (החבילה עצמה) — לפי createdAt שבה
  const prekeyBundle = (x) => (x && typeof x === 'object' && x.bundle && Number.isSafeInteger(x.at) ? x.bundle : x);
  const prekeyAt = (x) => (x && typeof x === 'object' && Number.isSafeInteger(x.at) && x.bundle ? x.at : Number(x && x.createdAt) || 0);
  // מכשירים מוכרים שהמפתח הזמני שלהם פג (KNOWN_KEEP_MS): known/<id> ← זמן החידוש האחרון של המפתח הזמני (זמן השרת)
  const knownDir = path.join(dataDir, 'known');
  const knownFile = (id) => path.join(knownDir, id);
  let knownCount = null;
  function knownReady() {
    if (knownCount !== null) return;
    fs.mkdirSync(knownDir, { recursive: true });
    knownCount = fs.readdirSync(knownDir).filter(n => ID_RE.test(n)).length;
  }
  function knownAt(id) {
    try { return Number(fs.readFileSync(knownFile(id), 'utf8')) || 0; } catch { return 0; }
  }
  const isKnown = (id) => { const at = knownAt(id); return at > 0 && clock() - at < KNOWN_KEEP_MS; };
  function rememberKnown(id, at) {
    knownReady();
    const f = knownFile(id);
    const isNew = !fs.existsSync(f);
    if (isNew && knownCount >= MAX_KNOWN) return;
    try { fs.writeFileSync(f, String(at)); if (isNew) knownCount++; } catch { /* לא קריטי */ }
  }
  function forgetKnown(id) {
    const f = knownFile(id);
    if (!fs.existsSync(f)) return;
    try { fs.rmSync(f, { force: true }); if (knownCount !== null) knownCount = Math.max(0, knownCount - 1); } catch { /* בסבב הבא */ }
  }

  // תיבות "חיות": נמשכו (סימון ב-seen/<id>, עם זמן השרת), יש להן מפתח זמני, או התיבה של מנהל-העל.
  // הודעות לתיבה שאינה חיה נמחקות אחרי DEAD_BOX_TTL_MS (f18)
  const seenDir = path.join(dataDir, 'seen');
  const seenFile = (id) => path.join(seenDir, id);
  const seenMemo = new Map(); // מזהה ← הזמן שנרשם (בהפעלה הזו)
  let seenCount = null;
  // מתי התחיל המעקב (seen-since): בשדרוג משרת שלא עקב — עכשיו. עד MESSAGE_TTL_MS אחרי זה תיבה בלי סימון היא "לא
  // ידוע" ולא "מתה": מערכת שלא התחברה 30–60 יום לפני השדרוג לא מאבדת בסבב הראשון את ההודעות שממתינות לה
  // (סקירה 5.11.2026). תיקייה שקיימת בלי הקובץ — מעקב ותיק (0)
  let seenSince = null;
  function seenReady() {
    if (seenCount !== null) return;
    const since = path.join(dataDir, 'seen-since');
    if (!fs.existsSync(seenDir)) {
      fs.mkdirSync(seenDir, { recursive: true });
      try { fs.writeFileSync(since, String(clock())); } catch { /* ייחשב כמעקב ותיק */ }
    }
    try { seenSince = Number(fs.readFileSync(since, 'utf8')) || 0; } catch { seenSince = 0; }
    seenCount = fs.readdirSync(seenDir).filter(n => ID_RE.test(n)).length;
  }
  seenReady();
  // durable — לכתוב סימון בדיסק. מעבר לתקרה (או בלי durable) — בזיכרון בלבד: מכשיר חדש לא נחשב "מת" בגלל הצפה
  function markSeen(id, now, durable = true) {
    const last = seenMemo.get(id);
    if (last && now - last.at < BOX_SWEEP_MS && (!durable || last.durable)) return; // פעם ביום לכל היותר
    seenReady();
    const f = seenFile(id);
    const isNew = !fs.existsSync(f);
    let wrote = false;
    if (durable && (!isNew || seenCount < maxSeen)) {
      try { fs.writeFileSync(f, String(now)); wrote = true; if (isNew) seenCount++; } catch { /* בזיכרון בלבד */ }
    }
    seenMemo.delete(id);
    if (seenMemo.size >= MAX_INDEX_CACHE) seenMemo.delete(seenMemo.keys().next().value);
    seenMemo.set(id, { at: now, durable: wrote || !isNew });
  }
  const hasPrekey = (id) => { prekeysReady(); return fs.existsSync(prekeyFile(id)); };
  function boxAlive(id) {
    if (id === ownerId || id === rootId()) return true;
    const mm = seenMemo.get(id);
    if ((mm && clock() - mm.at < MESSAGE_TTL_MS) || fs.existsSync(seenFile(id))) return true;
    // בעל התיבה שלח הודעה בהפעלה הזו (אומת) — חיה
    if (contacts.has(id)) return true;
    if (fs.existsSync(prekeyFile(id))) return true;
    seenReady();
    return clock() - seenSince < MESSAGE_TTL_MS; // עדיין בתוך התקופה שאחרי תחילת המעקב — לא ידוע, לא מת
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
    if (delta) { account(id, delta.added, 1); account(id, delta.removed, -1); }
    const ix = indexes.get(id);
    if (!ix) return;
    if (!delta) { indexes.delete(id); return; }
    for (const m of delta.added || []) indexAdd(ix, m);
    for (const m of delta.removed || []) indexAdd(ix, m, -1);
    ix.stamp = stampOf(id);
  }
  // נפח שממתין לפי מקור (STORED_BYTES_PER_KEY / _IP, סקירה 5.11.2026): לפי מפתח השולח, ולפי תג הכתובת (s — HMAC של
  // הכתובת במפתח של השרת, src-key; נשמר בהודעה ולא יוצא ללקוחות). מתעדכן בכל כתיבה ומחיקה (writeBox עם delta),
  // ונבנה מחדש מהתיבות בכל סבב — כך שסטייה (קובץ שנמחק ידנית, הפעלה מחדש) מתוקנת. בעלייה — סריקה בלי מחיקה
  const ledger = { key: new Map(), src: new Map() };
  let rebuild = null; // בזמן סבב: { key, src, listed, scanned }
  const regularMsg = (m) => !!m && typeof m.from === 'string' && m.from !== 'relay' && !isRootNotice(m);
  function bump(maps, m, sign) {
    const b = sign * msgBytes(m);
    const add = (map, k) => { const v = (map.get(k) || 0) + b; if (v > 0) map.set(k, v); else map.delete(k); };
    add(maps.key, m.from);
    if (typeof m.s === 'string') add(maps.src, m.s);
  }
  function account(boxId, msgs, sign) {
    for (const m of msgs || []) {
      if (!regularMsg(m)) continue;
      bump(ledger, m, sign);
      // תיבה שהסבב כבר ספר (או שנוצרה אחרי שהתחיל) — גם לספירה החדשה
      if (rebuild && (rebuild.scanned.has(boxId) || !rebuild.listed.has(boxId))) bump(rebuild, m, sign);
    }
  }
  let srcKey = null;
  function srcTag(ip) {
    if (!srcKey) {
      const f = path.join(dataDir, 'src-key');
      try { srcKey = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); } catch { srcKey = null; }
      if (!srcKey || srcKey.length !== 32) {
        srcKey = crypto.randomBytes(32);
        try { fs.writeFileSync(f, srcKey.toString('hex'), { mode: 0o600 }); } catch { /* בזיכרון — אחרי הפעלה מחדש תג אחר */ }
      }
    }
    return crypto.createHmac('sha256', srcKey).update(String(ip)).digest('base64url').slice(0, 16);
  }
  const forClient = (m) => { if (!m || m.s === undefined) return m; const { s: _src, ...rest } = m; return rest; };

  // מי שבעל התיבה כתב לו — "מוכר" לה: לא כפוף למכסה לכתובת לתיבה, ואצל מנהל-העל לא נספר במכסה של שולחים
  // לא מוכרים. בזיכרון; של מנהל-העל — גם בקובץ, כדי שהלקוחות יוכרו אחרי הפעלה מחדש של השרת
  const ownerId = billing && billing.rootKeys && billing.rootKeys.length ? L.keyId(billing.rootKeys[0]) : null;
  // התיבה של מנהל-העל = rootId(): מ---root-pub, ובלעדיו — המנפיק שבתעודת השרת (סקירה 2.11.2026, f14). פעם רק
  // מ---root-pub, ובפריסה בלי הרשמה (רק identity) ההגנות על התיבה של מנהל-העל (מכסת לא מוכרים, אנשי קשר שנשמרים) לא חלו
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
  const sealedSignup = (m) => !!m && m.from === 'relay' && m.kind === 'signup' && typeof m.body === 'string' && m.body.startsWith(SIGNUP_V2_PREFIX);
  const isRootNotice = (m) => !!m && m.kind === 'notices' && typeof m.from === 'string' && m.from === rootId();
  // מסירות של השרת לא פגות — חוץ מהרשמה חינם שממתינה MESSAGE_TTL_MS אצל מנהל-העל, כשמנהל-על מעודכן (caps: signup-v2)
  // משך את התיבה אחרי שנמסרה (סקירה 5.11.2026): הוא קולט כל הרשמה תקינה ומוחק מהשרת כל מסירה שאינה תקינה, ולכן מה
  // שנשאר שם חודשיים "תקוע" — והוא תופס את המקום של הרשמות חינם (MAX_FREE_IN_BOX). מנהל-על ישן (לא מודיע caps) — לא
  // נמחק דבר: אחרת הרשמות שהוא עוד לא יכול לקרוא היו אובדות. הרשמות ששולמו — לעולם לא פגות
  const ownerV2File = path.join(dataDir, 'owner-v2-fetch');
  let ownerV2At = null;
  function ownerV2FetchAt() {
    if (ownerV2At === null) { try { ownerV2At = Number(fs.readFileSync(ownerV2File, 'utf8')) || 0; } catch { ownerV2At = 0; } }
    return ownerV2At;
  }
  function markOwnerV2Fetch(now) {
    if (now - ownerV2FetchAt() < 60 * 60 * 1000) return; // פעם בשעה לכל היותר
    ownerV2At = now;
    try { fs.writeFileSync(ownerV2File, String(now)); } catch { /* בזיכרון — עד הפעלה מחדש */ }
  }
  const staleFreeSignup = (boxId, m, now) => boxId === rootId() && m.kind === 'signup' && m.free === true
    && Number.isSafeInteger(m.at) && now - m.at >= MESSAGE_TTL_MS && ownerV2FetchAt() > m.at;
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
  const knows = (box, sender) => (box === rootId() ? ownerKnown().has(sender) : !!(contacts.get(box) && contacts.get(box).has(sender)));
  function remember(box, targets) {
    if (box === rootId()) {
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
  const offlineNonces = new Map(); // אותו דבר ל-offlineFetch (14 יום), לפי סדר ההכנסה
  // מונים לפי חלון זמן: מפתח (כתובת / מפתח שולח) ← [זמנים]
  const windows = {
    hits: { ms: 60000, map: new Map() },      // לפי מפתח מאומת
    ipHits: { ms: 60000, map: new Map() },    // לפי כתובת, לפני האימות (גבוהה)
    authFails: { ms: 60000, map: new Map() },
    newPrekeys: { ms: 24 * 3600000, map: new Map() },
    keyCheckouts: { ms: 24 * 3600000, map: new Map() },
    keyFrees: { ms: 24 * 3600000, map: new Map() },
    sends: { ms: 3600000, map: new Map() },
    ipSends: { ms: 3600000, map: new Map() },
    ipBox: { ms: 3600000, map: new Map() },
    offline: { ms: 3600000, map: new Map() },
    checkouts: { ms: 24 * 3600000, map: new Map() },
    frees: { ms: 24 * 3600000, map: new Map() },
  };
  // נפח שנשמר ביממה (f18): מפתח ← [[זמן, בתים]]
  const byteWindows = { key: new Map(), ip: new Map() };
  const BYTE_WINDOW_MS = 24 * 3600000;
  let lastSweep = 0;
  let lastBoxSweep = clock();
  let lastPaySweep = clock();
  // ניקוי תקופתי של המפות שבזיכרון (ולא בכל בקשה — O(n))
  function sweep(now) {
    if (now - lastBoxSweep >= BOX_SWEEP_MS) { lastBoxSweep = now; startDailySweep(now); }
    if (now - lastPaySweep >= PAYMENT_SWEEP_MS) { lastPaySweep = now; try { expirePayments(now); } catch { /* בסבב הבא */ } }
    if (now - lastSweep < 10000 && nonces.size < maxNonces) return;
    lastSweep = now;
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    for (const [n, exp] of offlineNonces) if (exp < now) offlineNonces.delete(n);
    for (const { ms, map } of Object.values(windows)) {
      for (const [k, list] of map) { const live = list.filter(t => now - t < ms); if (live.length) map.set(k, live); else map.delete(k); }
    }
    for (const map of Object.values(byteWindows)) {
      for (const [k, list] of map) { const live = list.filter(([t]) => now - t < BYTE_WINDOW_MS); if (live.length) map.set(k, live); else map.delete(k); }
    }
  }
  // הסבב היומי (f18): הודעות שפגו, מפתחות זמניים ישנים (f17) וסימוני "נמשכה" ישנים. כל קובץ בנפרד — אף פעם לא כל
  // הנתונים בזיכרון יחד. בשרת — בחלקים של SWEEP_CHUNK, מחוץ למסלול הבקשה (setImmediate); בבדיקות — הכול מיד
  function sweepTasks() {
    const tasks = [];
    for (const name of fs.readdirSync(dataDir)) {
      const m = /^([A-Za-z0-9_-]{22})\.json$/.exec(name);
      if (m) tasks.push(['box', m[1]]);
    }
    if (fs.existsSync(prekeyDir)) for (const name of fs.readdirSync(prekeyDir)) { const m = /^([A-Za-z0-9_-]{22})\.json$/.exec(name); if (m) tasks.push(['prekey', m[1]]); }
    if (fs.existsSync(seenDir)) for (const name of fs.readdirSync(seenDir)) if (ID_RE.test(name)) tasks.push(['seen', name]);
    if (fs.existsSync(knownDir)) for (const name of fs.readdirSync(knownDir)) if (ID_RE.test(name)) tasks.push(['known', name]);
    return tasks;
  }
  // expire: false — סריקה בלבד (בעלייה): בניית ספירת הנפח בלי למחוק דבר
  function sweepOne([kind, id], now, expire = true) {
    if (kind === 'box') {
      let box;
      try { box = readBox(id); } catch { if (rebuild) rebuild.scanned.add(id); return; } // קובץ שלא נקרא — לא נוגעים בו
      let live = box;
      if (expire) {
        const alive = boxAlive(id);
        // הודעת הסטטוס של השורש לא פגה (ממצא 3): מערכת שלא התחברה יותר מ-60 יום עדיין מקבלת את ההשבתה.
        // הודעה משולח שבעל התיבה כתב לו (קשר קיים) — 60 יום גם בתיבה שנראית מתה
        live = box.filter(x => (x.from === 'relay' && !staleFreeSignup(id, x, now)) || isRootNotice(x)
          || now - x.at < (alive || knows(id, x.from) ? MESSAGE_TTL_MS : DEAD_BOX_TTL_MS));
        if (live.length !== box.length) writeBox(id, live, { removed: box.filter(x => !live.includes(x)) });
      }
      if (rebuild) { for (const m of live) if (regularMsg(m)) bump(rebuild, m, 1); rebuild.scanned.add(id); }
    } else if (!expire) {
      return;
    } else if (kind === 'prekey') {
      let x;
      try { x = readJson(prekeyFile(id), null); } catch { return; }
      if (x && now - prekeyAt(x) < PREKEY_KEEP_MS) return;
      const f = prekeyFile(id);
      if (!fs.existsSync(f)) return;
      // המכשיר נשאר "מוכר" עוד KNOWN_KEEP_MS מהחידוש האחרון (סימון קטן במקום החבילה)
      const at = x ? prekeyAt(x) : 0;
      if (at && now - at < KNOWN_KEEP_MS) rememberKnown(id, at);
      removeFile(f);
      if (prekeyCount !== null) prekeyCount = Math.max(0, prekeyCount - 1);
    } else if (kind === 'known') {
      if (now - knownAt(id) < KNOWN_KEEP_MS) return;
      forgetKnown(id);
    } else if (kind === 'seen') {
      let at = 0;
      try { at = Number(fs.readFileSync(seenFile(id), 'utf8')) || 0; } catch { return; }
      if (now - at < MESSAGE_TTL_MS) return;
      try { fs.rmSync(seenFile(id), { force: true }); seenMemo.delete(id); if (seenCount !== null) seenCount = Math.max(0, seenCount - 1); } catch { /* בסבב הבא */ }
    }
  }
  let sweepJob = null;
  function beginRebuild(tasks) {
    rebuild = { key: new Map(), src: new Map(), listed: new Set(tasks.filter(t => t[0] === 'box').map(t => t[1])), scanned: new Set() };
  }
  function finishRebuild() {
    if (!rebuild) return;
    ledger.key = rebuild.key; ledger.src = rebuild.src;
    rebuild = null;
  }
  let queuedSweep = false; // סבב יומי שהתבקש בזמן הסריקה של העלייה — ירוץ מיד אחריה
  function startDailySweep(now, { expire = true } = {}) {
    if (sweepJob) { if (expire) queuedSweep = true; return; }
    let tasks;
    try { tasks = sweepTasks(); } catch (e) { console.error('relay: sweep failed: ' + (e.code || e.message)); return; }
    if (!background) { runSweep(tasks, now, expire); return; }
    beginRebuild(tasks);
    sweepJob = { tasks, i: 0 };
    const step = () => {
      const job = sweepJob;
      const end = Math.min(job.tasks.length, job.i + SWEEP_CHUNK);
      for (; job.i < end; job.i++) { try { sweepOne(job.tasks[job.i], clock(), expire); } catch (e) { console.error('relay: sweep item failed: ' + (e.code || e.message)); } }
      if (job.i < job.tasks.length) setImmediate(step);
      else {
        finishRebuild(); sweepJob = null;
        if (queuedSweep) { queuedSweep = false; startDailySweep(clock()); }
      }
    };
    setImmediate(step);
  }
  function runSweep(tasks, now, expire = true) {
    beginRebuild(tasks);
    try { for (const t of tasks) sweepOne(t, now, expire); finishRebuild(); } finally { rebuild = null; }
  }
  // סבב מלא מיד (בדיקות, ו-expireMessages המיוצא)
  function expireMessages(now) { if (sweepJob) return; runSweep(sweepTasks(), now); }
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
    const past = op === OFFLINE_OP ? OFFLINE_WINDOW_MS : CLOCK_SKEW_MS;
    if (!Number.isSafeInteger(ts) || ts - clock() > CLOCK_SKEW_MS || clock() - ts > past) throw httpError(401, 'שעון המחשב אינו מדויק או שהבקשה ישנה');
    if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 64) throw httpError(401, 'בקשה לא תקינה');
    if (!L.verifyObject({ pub: L.publicOf(pub), ts, nonce, op, payload }, sig, pub)) throw httpError(401, 'חתימה לא תקינה');
    const now = clock();
    sweep(now);
    if (op === OFFLINE_OP) {
      const seenOff = offlineNonces.get(nonce);
      if (seenOff && seenOff >= now) throw httpError(401, 'בקשה כפולה');
      while (offlineNonces.size >= maxOfflineNonces) offlineNonces.delete(offlineNonces.keys().next().value);
      offlineNonces.set(nonce, ts + OFFLINE_WINDOW_MS + CLOCK_SKEW_MS);
      return id;
    }
    const seen = nonces.get(nonce);
    if (seen && seen >= now) throw httpError(401, 'בקשה כפולה');
    if (nonces.size >= maxNonces) throw httpError(503, 'השרת עמוס — נסו שוב בעוד כמה דקות');
    nonces.set(nonce, now + 2 * CLOCK_SKEW_MS);
    return id;
  }

  // לפני האימות — לפי כתובת, מכסה גבוהה (כתובת משותפת של NetFree); אחרי האימות — לפי המפתח (f16)
  // מחזיר true כשהכתובת "עמוסה" (מעל perIpMinute): הבקשה ממשיכה רק אם היא של מכשיר מוכר (handle). מעל perIpHardMinute —
  // נדחית מיד. בקשה שנדחתה כאן לא נספרת (ניסיונות חוזרים לא מאריכים את החסימה)
  function rateLimit(ip) {
    const now = clock();
    const { ms, map } = windows.ipHits;
    const times = (map.get(ip) || []).filter(t => now - t < ms);
    if (times.length >= RATE.perIpHardMinute) throw httpError(429, 'יותר מדי בקשות מהכתובת הזו — נסו שוב בעוד דקה');
    times.push(now);
    map.set(ip, times);
    return times.length > RATE.perIpMinute;
  }
  // מכשיר מוכר — יש לו מפתח זמני בשרת (כל מערכת מפרסמת אחד בכל סנכרון), או מנהל-העל. בדיקה זולה, לפני אימות החתימה
  function established(pub) {
    let id;
    try { id = L.keyId(pub); } catch { return false; }
    return id === ownerId || id === rootId() || hasPrekey(id) || isKnown(id);
  }
  function keyRateLimit(id) {
    quota('hits', id, RATE.perMinute, 1, 'יותר מדי בקשות — נסו שוב בעוד דקה');
  }
  // נפח ביממה (f18): נבדק לפני כתיבה, ונספר רק אחרי שכל הבדיקות עברו (take)
  function byteQuota(id, ip, bytes) {
    const now = clock();
    const sum = (map, k) => (map.get(k) || []).reduce((t, [at, b]) => t + (now - at < BYTE_WINDOW_MS ? b : 0), 0);
    if (sum(byteWindows.key, id) + bytes > storeBytesPerKeyDay) throw httpError(429, 'נשלח היום נפח גדול מדי מהמכשיר הזה — נסו שוב מחר');
    if (sum(byteWindows.ip, ip) + bytes > storeBytesPerIpDay) throw httpError(429, 'נשלח היום נפח גדול מדי מהכתובת הזו — נסו שוב מחר');
    return () => {
      for (const [map, k] of [[byteWindows.key, id], [byteWindows.ip, ip]]) { const l = map.get(k) || []; l.push([now, bytes]); map.set(k, l); }
    };
  }
  const offlineLimit = (ip) => quota('offline', ip, OFFLINE_PER_HOUR, 1, 'יותר מדי בקשות אישור בקובץ — נסו שוב בעוד שעה');

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
    assertRoom(msgBytes(msg), free ? 'checkout' : true);
    writeBox(to, [...readBox(to), msg], { added: [msg] });
  }

  // הצעה לכל מוצר (מרכז הרישוי — shell/licensing/products.js): SuperSuite ב-offer.json (כמו בגרסה הקודמת — לקוח
  // ישן שלא שולח product מקבל אותה), שאר המוצרים ב-offer-<מוצר>.json
  const offerFile = (product) => (product === PR.DEFAULT_PRODUCT ? 'offer.json' : 'offer-' + product + '.json');
  function offerProduct(v) {
    if (v == null || v === '') return PR.DEFAULT_PRODUCT;
    if (!PR.isProduct(v)) throw httpError(400, 'המוצר אינו מוכר');
    return v;
  }
  // מנהל-העל מפרסם הצעה (חתומה במפתח השורש — רק הוא יכול). המוצר — מתוך ההצעה החתומה
  function setOffer(from, p) {
    needBilling();
    if (from !== ownerBox()) throw httpError(403, 'רק מנהל-העל מפרסם הצעה');
    const offer = OF.verifyOffer(p.offer, billing.rootKeys);
    writeJsonFile(offerFile(OF.productOfOffer(offer)), { text: p.offer, issuedAt: offer.issuedAt });
    return { ok: true };
  }
  function getOffer(p = {}) {
    needBilling();
    const o = readJsonFile(offerFile(offerProduct(p && p.product)), null);
    if (!o) throw httpError(404, 'הספק עדיין לא פרסם תכניות');
    return { ok: true, offer: o.text };
  }
  // המוצר של ההרשמה — לפי ההצעה שבתוכה (נבדקת בחתימה ב-verifySignup מול ההצעה הנוכחית של אותו מוצר)
  function signupProduct(text) {
    try { const pkg = JSON.parse(text); return offerProduct(OF.productOfOffer(JSON.parse(pkg.offer).payload)); } catch (e) {
      if (e && e.status) throw e;
      throw httpError(400, 'חבילת ההרשמה פגומה');
    }
  }

  // ההצעה המפורסמת שמולה נבדקת ההרשמה (מרכז הרישוי + הרשמה מוצפנת):
  // חבילה גלויה (לקוח מגרסה קודמת) — המוצר מההצעה שבתוכה. הרשמה מוצפנת — המוצר מהחלק הגלוי החתום (signup.js,
  // sealSignup). לקוח של SuperSuite לימוד מלפני מרכז הרישוי לא שולח מוצר — ואז מחפשים בין ההצעות המפורסמות את זו
  // שהתכנית, המחיר והתקופה שבהרשמה תואמים לה (SuperSuite קודם). כל ההצעות נחתמות באותו issuedAt (owner.setOffer),
  // ותכנית בעלת אותו מזהה זהה במחיר ובתקופה בכל מוצר שהיא מכסה — הסכום לחיוב אינו תלוי בבחירה. המוצר של הרישיון
  // נקבע אצל מנהל-העל, מההצעה החתומה שבתוך המעטפה — לא כאן
  function publishedOffer(product) {
    const o = readJsonFile(offerFile(product), null);
    if (!o || typeof o.text !== 'string') return null;
    try { return OF.verifyOffer(o.text, billing.rootKeys); } catch { return null; }
  }
  function offerForSignup(p) {
    if (typeof p.public !== 'string' && typeof p.sealed !== 'string') {
      if (typeof p.signup !== 'string') throw httpError(400, 'חבילת ההרשמה פגומה');
      return publishedOffer(signupProduct(p.signup));
    }
    const b = SU.publicBodyOf(p.public);
    if (!b) throw httpError(400, 'חבילת ההרשמה פגומה');
    if (b.product != null) return publishedOffer(offerProduct(b.product));
    const order = [PR.DEFAULT_PRODUCT, ...PR.PRODUCTS.map(x => x.id).filter(id => id !== PR.DEFAULT_PRODUCT)];
    let first = null;
    for (const product of order) {
      const offer = publishedOffer(product);
      if (!offer) continue;
      first = first || offer;
      if (offer.issuedAt !== b.offerIssuedAt) continue;
      const plan = (offer.plans || []).find(x => x && x.id === b.planId);
      if (plan && plan.priceAgorot === b.priceAgorot && plan.months === b.months) return offer;
    }
    return first;
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
      // לפני המחיקה — בדיקה אחרונה מול הספק (f15), אלא אם עבר גם זמן החסד (הבטחת הפרטיות: נמחק בתוך 31 יום)
      if (canReconcile(x) && !x.finalCheckAt && now - x.createdAt < PAYMENT_KEEP_MS + RECONCILE_DELETE_GRACE_MS) return true;
      if (canReconcile(x) && !x.finalCheckAt) console.error('relay: payment ' + x.id + ' (' + x.checkoutId + ') deleted without a final check at the payment provider — check it there manually');
      if (x.signup === undefined) removeFile(signupFile(x.id));
      return false;
    });
  }

  // חבילת ההרשמה לא נשמרת בשרת בגלוי (סקירה 2.11.2026, f89): הלקוח מצפין את החבילה המלאה (ת.ז, טלפון, תמונת החתימה)
  // למפתח של מנהל-העל (SU.sealSignup), ושולח בגלוי רק את מה שהשרת צריך — public: תכנית, מחיר, מזהה המכשיר, ולתכנית
  // בתשלום פרטי החשבונית לספק הסליקה. השרת שומר ומוסר רק את המעטפה + החלק הגלוי.
  // לקוח מגרסה קודמת (signup גלוי) — נבדק כמו קודם, והשרת מצפין אותו בעצמו למנהל-העל לפני כל שמירה
  function sealForOwner(text) { return M.sealData(null, billing.rootKeys[0], text, SU.SEALED_PURPOSE); }
  function readSignupRequest(p, current) {
    if (typeof p.public === 'string' || typeof p.sealed === 'string') {
      const v = SU.verifySignupPublic(p.public, p.sealed, current);
      // המעטפה עצמה לא נפתחת כאן, אבל המבנה שלה נבדק (סקירה 5.11.2026): מעטפה בפורמט המוכר, להרשמה, למנהל-העל ומהמכשיר
      // השולח. כך אצל מנהל-העל "פורמט לא מוכר" (שנשאר בשרת) יכול להגיע רק משרת חדש יותר — לא מזבל של לקוח
      let env = null;
      try { env = JSON.parse(p.sealed); } catch { env = null; }
      const b64 = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x);
      if (!env || env.type !== M.SEALED_TYPE || env.v !== 1 || env.purpose !== SU.SEALED_PURPOSE || env.to !== ownerId
        || env.from !== v.body.keyId || !['eph', 'salt', 'iv', 'ct', 'tag'].every(k => b64(env[k]))) throw new Error('חבילת ההרשמה המוצפנת פגומה');
      return { id: v.body.id, keyId: v.body.keyId, signedAt: v.body.signedAt, plan: v.plan, customer: v.invoice || {},
        stored: { sealed: p.sealed, public: p.public } };
    }
    const v = SU.verifySignup(p.signup, billing.rootKeys, { current });
    return { id: v.body.id, keyId: v.body.keyId, signedAt: v.body.signedAt, plan: v.plan, customer: v.body.customer,
      stored: { sealed: sealForOwner(p.signup) } };
  }
  // מסירה למנהל-העל: רק מעטפה. רשומה ישנה (חבילה גלויה בקובץ או ב-payments.json) — מוצפנת כאן, לפני המסירה
  const deliveryOf = (stored, payment) => {
    const st = typeof stored === 'string' ? { sealed: sealForOwner(stored) } : stored;
    return JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: st.sealed, ...(st.public ? { public: st.public } : {}), payment });
  };
  // ניקוי תקופתי (sweep ו-createServer): לא רק ב-checkout — אחרת הרשמה שלא שולמה נשארה בשרת לתמיד כשאין
  // הרשמות חדשות (סקירה 11.2026, f75). גם חבילת הרשמה יתומה (בלי רשומה ב-payments.json, למשל אחרי נפילה בין
  // שתי הכתיבות ב-checkout) נמחקת אחרי PAYMENT_KEEP_MS
  function expirePayments(now = clock()) {
    const list = readJsonFile('payments.json', null);
    let ids = new Set();
    if (Array.isArray(list)) {
      const before = JSON.stringify(list);
      const live = livePayments(list, now); // מסמן expired במקום ומסנן
      ids = new Set(live.map(x => x.id));
      if (JSON.stringify(live) !== before) writeJsonFile('payments.json', live);
    }
    let names = [];
    try { names = fs.readdirSync(signupDir); } catch { return; }
    for (const name of names) {
      const m = /^(.+)\.json$/.exec(name);
      if (!m || ids.has(m[1])) continue;
      let st;
      try { st = fs.statSync(path.join(signupDir, name)); } catch { continue; }
      if (now - st.mtimeMs >= PAYMENT_KEEP_MS) removeFile(path.join(signupDir, name));
    }
  }

  // הרשמה: נבדקת מול ההצעה החתומה; הסכום נקבע לפי ההצעה בלבד. תכנית חינם — נמסרת מיד.
  // ההצעה שבהרשמה חייבת להיות זו שמפורסמת עכשיו (offer.json): הצעה חתומה ישנה עם תכנית זולה או חינמית
  // לא מתקבלת (ממצא 31). ההרשמה עצמה — מהיממה האחרונה
  // תשובה חתומה במפתח השרת (סקירה 2.11.2026, f86) — על האתגר שהלקוח שלח בבקשה הזו (proof). הלקוח שומר ופותח רק את
  // מה שבחתימה: מי ששולט בשם השרת לא מחליף את קישור התשלום. בלי מפתח שרת (פיתוח) — בלי חתימה
  function withPayProof(res, op, from, p) {
    if (!identity || !identity.certText || !CK.validChallenge(p.proof)) return res;
    const payProof = CK.signPaymentProof(identity.privateJwk, { op, origin: identity.origin, box: from, challenge: p.proof, at: clock(),
      paymentId: res.paymentId || null, status: res.free ? 'submitted' : res.status, url: res.url || null,
      amountAgorot: Number.isSafeInteger(res.amountAgorot) ? res.amountAgorot : null, free: !!res.free });
    return { ...res, payProof, relayCert: identity.certText };
  }
  async function checkout(from, p, ip = '') { return withPayProof(await checkoutRun(from, p, ip), 'checkout', from, p); }
  async function checkoutRun(from, p, ip) {
    needBilling();
    const current = offerForSignup(p);
    if (!current) throw httpError(404, 'הספק עדיין לא פרסם תכניות');
    let v;
    try { v = readSignupRequest(p, current); } catch (e) { throw httpError(400, e.message); }
    if (v.keyId !== from) throw httpError(403, 'ההרשמה אינה של המכשיר השולח');
    if (!Number.isSafeInteger(v.signedAt) || Math.abs(clock() - v.signedAt) > SIGNUP_MAX_AGE_MS) throw httpError(400, 'ההרשמה ישנה — יש לפתוח מחדש את מסך הרכישה ולהירשם שוב');
    if (v.plan.priceAgorot === 0) {
      // מכסה לפי מכשיר, ומכסת גיבוי גבוהה לכתובת (f16)
      quotas([['keyFrees', from, FREE_SIGNUP_PER_KEY_DAY, 1, 'יותר מדי הרשמות מהמכשיר הזה היום — נסו שוב מחר'],
        ['frees', ip, FREE_SIGNUP_PER_IP_DAY, 1, 'יותר מדי הרשמות מהכתובת הזו היום — נסו שוב מחר']]);
      deliver(ownerBox(), 'signup', deliveryOf(v.stored, null), { free: true });
      return { ok: true, free: true, amountAgorot: 0 };
    }
    if (!billing.provider) throw httpError(503, 'התשלום אינו זמין כרגע');
    const now = clock();
    const all = livePayments(readJsonFile('payments.json', []), now);
    const paid = all.find(x => x.signupId === v.id && x.status === 'paid');
    if (paid) return { ok: true, paymentId: paid.id, status: 'paid', amountAgorot: paid.amountAgorot };
    const open = all.find(x => x.signupId === v.id && x.status === 'pending');
    if (open) return { ok: true, paymentId: open.id, url: open.url, status: 'pending', amountAgorot: open.amountAgorot };
    if (all.filter(x => x.keyId === from && x.status === 'pending').length >= MAX_PENDING_PAYMENTS) throw httpError(429, 'יותר מדי תשלומים פתוחים — נסו מאוחר יותר');
    if (all.filter(x => x.status === 'pending').length >= MAX_PENDING_TOTAL) throw httpError(503, 'השרת עמוס — נסו שוב מאוחר יותר');
    // כל ניסיון פותח דף תשלום אצל ספק הסליקה — מכסה למכשיר, ומכסת גיבוי לכתובת (מפתח חדש לא עולה כלום)
    quotas([['keyCheckouts', from, CHECKOUT_PER_KEY_DAY, 1, 'יותר מדי ניסיונות תשלום מהמכשיר הזה היום — נסו שוב מחר'],
      ['checkouts', ip, CHECKOUT_PER_IP_DAY, 1, 'יותר מדי ניסיונות תשלום מהכתובת הזו היום — נסו שוב מחר']]);
    const storedText = JSON.stringify(v.stored);
    assertRoom(Buffer.byteLength(storedText) + 1024, 'checkout');
    const paymentId = crypto.randomUUID();
    const co = await billing.provider.createCheckout({ paymentId, amountAgorot: v.plan.priceAgorot,
      description: `${v.plan.name} — ${v.customer.org || ''}`, customer: v.customer });
    // הקריאה לספק אסינכרונית — בינתיים בקשות אחרות אולי עדכנו את הקובץ. הקריאה-כתיבה עצמה
    // סינכרונית (בלי await באמצע), ולכן webhook או checkout אחר לא יכולים להיכנס בין הקריאה לכתיבה
    const fresh = livePayments(readJsonFile('payments.json', []), clock());
    // ייתכן ששתי בקשות לאותה הרשמה רצו במקביל, והראשונה כבר נרשמה — לא פותחים תשלום שני
    const raced = fresh.find(x => x.signupId === v.id && (x.status === 'paid' || x.status === 'pending'));
    if (raced) return { ok: true, paymentId: raced.id, url: raced.status === 'pending' ? raced.url : undefined, status: raced.status, amountAgorot: raced.amountAgorot };
    // קודם חבילת ההרשמה (מוצפנת), ורק אז הרשומה: רשומה בלי חבילה הייתה תשלום שאי אפשר למסור
    fs.mkdirSync(signupDir, { recursive: true });
    writeJson(signupFile(paymentId), v.stored);
    writeJsonFile('payments.json', [...fresh, { id: paymentId, keyId: from, signupId: v.id, amountAgorot: v.plan.priceAgorot,
      checkoutId: co.checkoutId, url: co.url, status: 'pending', createdAt: now }]);
    return { ok: true, paymentId, url: co.url, status: 'pending', amountAgorot: v.plan.priceAgorot };
  }
  // מצב התשלום. תשלום שעוד לא אושר — נבדק קודם מול הספק (f15): ה-webhook אולי אבד (השרת היה למטה, 507), והלקוח
  // שילם. לכל היותר פעם ב-RECONCILE_STATUS_GAP_MS לתשלום, כך שלקוח שלוחץ שוב ושוב לא מציף את הספק
  async function paymentStatus(from, p) {
    needBilling();
    const find = () => readJsonFile('payments.json', []).find(y => y.id === String(p.paymentId) && y.keyId === from);
    let x = find();
    if (!x) throw httpError(404, 'התשלום לא נמצא');
    if (canReconcile(x) && clock() - (statusChecks.get(x.id) || 0) >= RECONCILE_STATUS_GAP_MS) {
      statusChecks.set(x.id, clock());
      if (statusChecks.size > 10000) statusChecks.delete(statusChecks.keys().next().value);
      try { await reconcileOne(x.id); } catch (e) { console.error('relay: payment reconcile failed: ' + ((e && e.message) || e)); }
      x = find() || x;
    }
    return withPayProof({ ok: true, paymentId: x.id, status: x.status, url: x.status === 'pending' ? x.url : undefined, amountAgorot: x.amountAgorot },
      'paymentStatus', from, p);
  }

  // ---------- התאמה מול ספק הסליקה (סקירה 2.11.2026, f15) ----------
  // ה-webhook הוא הדרך הרגילה; אבל הוא יכול לאבוד (השרת היה למטה, התיבה של מנהל-העל הייתה מלאה — 507, הספק ויתר).
  // לכן תשלום פתוח או שפג, שיש לו מזהה אצל הספק, נבדק גם ביוזמת השרת — באותה דרך מאומתת של ה-webhook
  // (provider.lookup: ב-Cardcom — GetLpResult לפי LowProfileId) — ותשלום שהושלם נמסר (applyPaymentEvent).
  // מתי: בבדיקת מצב התשלום (paymentStatus), ובסבב השעתי (reconcilePayments, createServer): פתוח — כל סבב, החל
  // מ-RECONCILE_MIN_AGE_MS אחרי הפתיחה; שפג — פעם ביממה, ובדיקה אחרונה ביממה שלפני המחיקה. הרשומה (וחבילת ההרשמה)
  // נמחקת רק אחרי הבדיקה האחרונה, או לכל המאוחר RECONCILE_DELETE_GRACE_MS אחרי PAYMENT_KEEP_MS — עדיין בתוך 31 יום
  const statusChecks = new Map();
  const hasLookup = () => !!(billing && billing.provider && typeof billing.provider.lookup === 'function');
  const canReconcile = (x) => hasLookup() && !!x && typeof x.checkoutId === 'string' && !!x.checkoutId && (x.status === 'pending' || x.status === 'expired');
  // שינוי שדות של תשלום אחד — קריאה וכתיבה סינכרוניות (בלי await באמצע)
  function patchPayment(id, fields) {
    const all = readJsonFile('payments.json', []);
    const y = all.find(z => z.id === id);
    if (!y) return;
    Object.assign(y, fields);
    writeJsonFile('payments.json', all);
  }
  async function reconcileOne(id, now = clock()) {
    const x = readJsonFile('payments.json', []).find(y => y.id === id);
    if (!canReconcile(x)) return { ok: true, skipped: true };
    const ev = await billing.provider.lookup({ checkoutId: x.checkoutId });
    if (!ev || ev.checkoutId !== x.checkoutId) throw new Error('תשובת ספק הסליקה אינה של התשלום הזה');
    const final = now - x.createdAt >= PAYMENT_KEEP_MS - RECONCILE_FINAL_MS;
    let r = { ok: true, pending: true };
    if (ev.status !== 'pending') r = applyPaymentEvent(ev);
    patchPayment(id, { checkedAt: now, ...(final ? { finalCheckAt: now } : {}) });
    return r;
  }
  // הסבב: התשלומים שצריך לבדוק עכשיו — קודם הבדיקות האחרונות (לפני מחיקה), עד RECONCILE_PER_SWEEP. ספק שלא עונה —
  // נכשל רק התשלום הזה, וממשיכים
  async function reconcilePayments(now = clock()) {
    if (!hasLookup()) return { checked: 0, failed: 0 };
    const list = readJsonFile('payments.json', null);
    if (!Array.isArray(list)) return { checked: 0, failed: 0 };
    const due = [];
    for (const x of list) {
      if (!canReconcile(x)) continue;
      const age = now - x.createdAt;
      const since = now - (Number(x.checkedAt) || 0);
      if (x.status === 'pending' || age < PAYMENT_TTL_MS) {
        if (age >= RECONCILE_MIN_AGE_MS && since >= PAYMENT_SWEEP_MS - 60000) due.push([1, x.id]);
      } else if (age >= PAYMENT_KEEP_MS - RECONCILE_FINAL_MS && !x.finalCheckAt) due.push([0, x.id]);
      else if (since >= RECONCILE_EXPIRED_EVERY_MS) due.push([2, x.id]);
    }
    due.sort((a, b) => a[0] - b[0]);
    let checked = 0, failed = 0;
    for (const [, id] of due.slice(0, RECONCILE_PER_SWEEP)) {
      try { await reconcileOne(id, now); checked++; } catch (e) { failed++; console.error('relay: payment reconcile failed: ' + ((e && e.message) || e)); }
    }
    return { checked, failed };
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
    // הספק מחזיר את המזהה שלנו (Cardcom: ReturnValue) — חייב להיות של אותו תשלום
    if (ev.paymentId && ev.paymentId !== x.id) throw httpError(400, 'תשובת ספק הסליקה אינה של התשלום הזה');
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
      const st = typeof signup === 'string' ? { sealed: sealForOwner(signup) } : signup;
      const payment = { id: x.id, amountAgorot: x.amountAgorot, provider: billing.provider.name, providerRef: ev.providerRef, paidAt: at,
        // מזהה דף התשלום אצל הספק — מנהל-העל מאמת לפיו מול Cardcom במחשב שלו (owner-cardcom.js)
        checkoutId: x.checkoutId };
      // אישור תשלום חתום במפתח השרת (f83): מנהל-העל מסמן "שולם" רק עם החתימה — על התשלום, ההרשמה והמעטפה שנמסרה
      if (identity && identity.certText) {
        payment.proof = { confirmation: CK.signPaymentConfirmation(identity.privateJwk, { origin: identity.origin, paymentId: x.id,
          amountAgorot: x.amountAgorot, provider: payment.provider, providerRef: payment.providerRef, signupId: x.signupId, keyId: x.keyId,
          sealed: st.sealed, paidAt: at }), cert: identity.certText };
      }
      deliver(ownerBox(), 'signup', deliveryOf(st, payment));
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
  // preCounted — הכתובת כבר נספרה ב-createServer לפני קריאת הגוף
  // overloaded — הכתובת מעל perIpMinute (נקבע לפני קריאת הגוף, createServer)
  function handle(body, ip = '', { preCounted = false, overloaded = false } = {}) {
    if (!preCounted) overloaded = rateLimit(ip);
    // אישור חיבור בקובץ (offlineFetch) — מכסה נפרדת לשעה לכתובת, לפני אימות החתימה
    if (body && body.op === OFFLINE_OP) offlineLimit(ip);
    // כתובת עמוסה (משותפת — NetFree): מכשירים מוכרים ממשיכים, כל השאר נדחים לפני אימות החתימה
    if (overloaded && !established(body && body.pub)) throw httpError(429, 'יותר מדי בקשות מהכתובת הזו — נסו שוב בעוד דקה');
    // כשלי אימות — נספרים לכתובת, והמכסה חלה רק על בקשות שנכשלו: בקשה חתומה כראוי לא נדחית בגלל זבל שנשלח
    // מאותה כתובת משותפת (סקירה 5.11.2026). מעל המכסה — 429 במקום 401 (בלי עבודה נוספת)
    let from;
    try { from = authenticate(body); } catch (e) {
      if (e.status === 401) {
        const now = clock();
        const fails = (windows.authFails.map.get(ip) || []).filter(t => now - t < windows.authFails.ms);
        fails.push(now);
        windows.authFails.map.set(ip, fails);
        if (fails.length > RATE.authFailPerIpMinute) throw httpError(429, 'יותר מדי בקשות לא תקינות מהכתובת הזו — נסו שוב בעוד דקה');
      }
      throw e;
    }
    // מנהל-העל שולח השבתות ועדכונים לכל המערכות ברצף — לא כפוף למכסה לדקה של מפתח (המפתח שלו לא חינמי)
    if (from !== rootId()) keyRateLimit(from);
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
      // מכשיר מוכר שהמפתח הזמני שלו פג (חזר אחרי חודש-חודשיים) — לא "מכשיר חדש" במכסות (סקירה 5.11.2026)
      const returning = isNew && isKnown(from);
      if (isNew) assertRoom(PREKEY_MAX_BYTES + 60);
      if (isNew && !returning) {
        // מכשיר חדש — מכסה לכתובת ולשרת כולו ביום (f17); החלפה שבועית של מפתח קיים — לא נספרת
        quotas([['newPrekeys', ip, NEW_PREKEYS_PER_IP_DAY, 1, 'יותר מדי מכשירים חדשים מהכתובת הזו היום — נסו שוב מחר'],
          ['newPrekeys', '*', NEW_PREKEYS_PER_DAY, 1, 'השרת עמוס — נסו שוב מחר']]);
      }
      writeJson(f, { at: clock(), bundle: b });
      if (isNew) prekeyCount += 1;
      if (returning) forgetKnown(from); // יש שוב מפתח זמני — הסימון ייווצר מחדש כשיפוג
      return { ok: true };
    }
    if (body.op === 'getPrekey') {
      if (!ID_RE.test(String(p.id))) throw httpError(400, 'מזהה לא תקין');
      prekeysReady();
      const x = readJson(prekeyFile(p.id), null);
      // מפתח שלא חודש 30 יום — כאילו אין (הלקוח דוחה אותו ממילא); נמחק בסבב היומי
      return { ok: true, bundle: x && clock() - prekeyAt(x) < PREKEY_KEEP_MS ? prekeyBundle(x) : null };
    }
    if (body.op === 'setOffer') return setOffer(from, p);
    if (body.op === 'getOffer') return getOffer(p);
    if (body.op === 'checkout') return checkout(from, p, ip);
    if (body.op === 'paymentStatus') return paymentStatus(from, p);
    if (body.op === 'send') {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length || items.length > 50) throw httpError(400, 'אין מה לשלוח');
      const at = clock(); // זמן אחד לכל ההודעות בבקשה — הוא נחתם באישור המסירה (receipt)
      const root = rootId();
      const byBox = new Map();
      const rootItems = new Map(); // הודעות הסטטוס של השורש: לתיבה ← ההודעה (האחרונה בבקשה)
      let tag = null;
      for (const it of items) {
        // 'signup' נמסר רק על ידי השרת אחרי תשלום — לא בשליחה ישירה
        if (it && it.kind === 'signup') throw httpError(400, 'הרשמה נשלחת דרך התשלום');
        if (!it || !ID_RE.test(String(it.to)) || !KINDS.has(it.kind) || typeof it.body !== 'string' || it.body.length > MAX_MESSAGE) {
          throw httpError(400, 'הודעה לא תקינה');
        }
        if (it.to === from) throw httpError(400, 'הודעה לא תקינה');
        const msg = { id: crypto.randomUUID(), from, kind: it.kind, body: it.body, at };
        if (root && from === root && it.kind === 'notices') { rootItems.set(it.to, msg); continue; }
        if (!(root && from === root)) msg.s = tag || (tag = srcTag(ip)); // מקור — לספירת הנפח שממתין (לא יוצא ללקוח)
        const list = byBox.get(it.to) || [];
        // הודעת סטטוס מחליפה את הקודמת של אותו שולח לאותה תיבה שטרם נקראה (סקירת אבטחה 24.10.2026, ממצא 2) —
        // חבילת הסטטוס תמיד מלאה, והישנה מיותרת. כך עדכונים חוזרים לא ממלאים את התיבה עד 429
        byBox.set(it.to, it.kind === 'notices' ? [...list.filter(m => m.kind !== 'notices'), msg] : [...list, msg]);
      }
      // סדר הבדיקות (f3): קודם מה שלא קורא מהדיסק — מספר התיבות, המכסות והנפח; רק אז האינדקס של כל תיבה (קריאה של
      // תיבה אחת בכל פעם), ובסוף כתיבה תיבה-תיבה: קריאה, כתיבה ושחרור לפני המעבר לבאה. אף פעם לא כמה תיבות בזיכרון יחד.
      // התקרה סופרת רק הודעות של שולחים — הודעות מהשרת (הרשמות ששולמו) והודעות הסטטוס של השורש (מקום שמור) לא
      // תופסות מקום של אחרים
      const regular = [...byBox.values()].reduce((n, l) => n + l.length, 0);
      if (byBox.size > SEND_MAX_BOXES && !(root && from === root)) throw httpError(400, 'יותר מדי נמענים בבקשה אחת');
      let total = 0;
      for (const msgs of byBox.values()) total += msgs.reduce((t, m) => t + msgBytes(m) + 1, 0);
      const limits = regular ? [
        ['sends', from, SEND_PER_HOUR, regular, 'יותר מדי הודעות בשעה האחרונה — נסו מאוחר יותר'],
        ['ipSends', ip, SEND_PER_IP_HOUR, regular, 'יותר מדי הודעות מהכתובת הזו בשעה האחרונה — נסו מאוחר יותר'],
      ] : [];
      // שולח שבעל התיבה לא כתב לו: מכסה לכתובת לתיבה (ממצא 1א)
      for (const [to, msgs] of byBox) if (!knows(to, from)) limits.push(['ipBox', ip + '>' + to, SEND_PER_IP_TO_BOX_HOUR, msgs.length, 'יותר מדי הודעות לנמען הזה מהכתובת הזו בשעה האחרונה — נסו מאוחר יותר']);
      const takeBytes = regular && !(root && from === root) ? byteQuota(from, ip, total) : null;
      // נפח שממתין בשרת ממקור אחד לאורך כל תקופת השמירה (f18): פג רק כשההודעות נקראו ונמחקו או פגו
      if (takeBytes) {
        if ((ledger.key.get(from) || 0) + total > storedBytesPerKey) throw httpError(429, 'יש בשרת יותר מדי הודעות מהמכשיר הזה שטרם נקראו — נסו שוב מאוחר יותר');
        if ((ledger.src.get(tag) || 0) + total > storedBytesPerIp) throw httpError(429, 'יש בשרת יותר מדי הודעות מהכתובת הזו שטרם נקראו — נסו שוב מאוחר יותר');
      }
      if (regular) assertRoom(total);
      quotas(limits); // נספרות כאן — גם אם התיבה מלאה: ניסיונות חוזרים לתיבה מלאה לא חינם
      // התקרות של כל תיבה מול האינדקס (קריאה רק כשאין אינדקס בזיכרון — תיבה אחת בכל פעם). שליחה רגילה נכשלת כולה
      // או מצליחה כולה ברמת הבדיקות
      for (const [to, msgs] of byBox) {
        const ix = indexOf(to);
        const add = msgs.reduce((t, m) => t + msgBytes(m), 0);
        const mine = ix.senders.get(from) || { n: 0, bytes: 0, nn: 0, nb: 0 };
        // הודעות הסטטוס הקודמות של השולח בתיבה הזו יוחלפו — לא נספרות
        const rep = msgs.some(m => m.kind === 'notices') ? { n: mine.nn || 0, bytes: mine.nb || 0 } : { n: 0, bytes: 0 };
        if (ix.n - rep.n + msgs.length > MAX_MAILBOX || ix.bytes - rep.bytes + add > MAX_BOX_BYTES) throw httpError(507, 'תיבת היעד מלאה');
        if (mine.n - rep.n + msgs.length > MAX_FROM_SENDER_IN_BOX) throw httpError(429, 'יותר מדי הודעות שטרם נקראו אצל הנמען');
        // אצל מנהל-העל — שולחים שהוא לא כתב להם: חלק מוגבל מהתיבה (1ב)
        if (to === rootId() && !knows(to, from)) {
          let n = 0, bytes = 0;
          for (const [snd, v] of ix.senders) if (!knows(to, snd)) { n += v.n; bytes += v.bytes; }
          if (n - rep.n + msgs.length > MAX_UNKNOWN_IN_OWNER_BOX || bytes - rep.bytes + add > MAX_UNKNOWN_BYTES_IN_OWNER_BOX) throw httpError(507, 'תיבת היעד מלאה — נסו שוב מאוחר יותר');
        }
      }
      // מכסת הנפח היומית — רק אחרי שהתקרות של התיבות עברו (סקירה 5.11.2026): ניסיונות חוזרים לתיבה מלאה (507) לא
      // שורפים את מכסת הנפח המשותפת של הכתובת (NetFree) — הם נספרים רק במכסות מספר ההודעות שלמעלה
      if (takeBytes) takeBytes();
      const stored = [];
      const failed = [];
      for (const [to, msgs] of byBox) {
        try {
          const box = readBox(to); // תיבה אחת בזיכרון — משתחררת לפני הבאה
          const replaced = msgs.some(m => m.kind === 'notices') ? box.filter(m => m.from === from && m.kind === 'notices' && !isRootNotice(m)) : [];
          const keep = replaced.length ? box.filter(m => !replaced.includes(m)) : box;
          writeBox(to, [...keep, ...msgs], { added: msgs, removed: replaced });
          for (const m of msgs) stored.push([to, m]);
        } catch (e) { failed.push({ to, error: e && e.status ? e.message : 'שגיאה בשרת' }); }
      }
      // הכול נכשל בכתיבה (נדיר — תיבה שהשתנתה בין הבדיקה לכתיבה) — שגיאה
      if (regular && !stored.length && !rootItems.size) throw httpError(failed.length ? 503 : 507, failed.length ? failed[0].error : 'השרת מלא');
      // הודעות הסטטוס של השורש (ממצא 3) — כל תיבה בנפרד, בלי התקרות של השולחים ובלי מכסות השליחה (המקום השמור:
      // אחת לתיבה, במקום הקודמת, בראש התיבה — כך היא בחלק הראשון של כל משיכה). כישלון אצל נמען אחד לא עוצר את האחרים
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
    if (body.op === 'fetch' || body.op === OFFLINE_OP) {
      // מסירה מוצפנת של הרשמה (v2) — רק ללקוח שמודיע שהוא קורא אותה (caps). מנהל-העל בגרסה קודמת לא היה פותח אותה,
      // היה מאשר "קבלה" — וההרשמה (גם בתשלום) נמחקת. אצלו היא ממתינה בשרת עד שיעדכן (סקירה 5.11.2026)
      const caps = Array.isArray(p.caps) ? p.caps : [];
      if (from === rootId() && caps.includes(CAP_SIGNUP_V2)) markOwnerV2Fetch(clock());
      const all = readBox(from);
      const box = caps.includes(CAP_SIGNUP_V2) ? all : all.filter(m => !sealedSignup(m));
      // התיבה חיה — ההודעות בה לא פגות אחרי 7 ימים (f18). סימון בדיסק רק לתיבה שיש בה הודעות או מפתח זמני: מפתח חדש
      // שמושך תיבה ריקה לא תופס סימון (MAX_SEEN); בזיכרון — תמיד
      markSeen(from, clock(), all.length > 0 || hasPrekey(from) || fs.existsSync(seenFile(from)));
      const start = body.op === 'fetch' && typeof p.after === 'string' ? box.findIndex(m => m.id === p.after) + 1 : 0;
      const out = [];
      let bytes = 0;
      for (let i = start; i < box.length && out.length < FETCH_MAX_MESSAGES; i++) {
        const b = msgBytes(box[i]);
        if (out.length && bytes + b > FETCH_MAX_BYTES) break;
        out.push(forClient(box[i]));
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
      return { ok: true, checkin: CK.signCheckin(identity.privateJwk, { purpose: 'hello', origin: identity.origin, box: from, challenge: p.checkin, at: clock(),
        caps: CK.RELAY_CAPS }),
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

  // בעלייה: ספירת הנפח שממתין, מהתיבות (בלי למחוק דבר); בשרת — ברקע, בחלקים
  startDailySweep(clock(), { expire: false });
  return { handle, webhook, billing, rateLimit, expireMessages: () => expireMessages(clock()), expirePayments: () => expirePayments(clock()),
    reconcilePayments: () => reconcilePayments(clock()), reconcilePayment: (id) => reconcileOne(String(id)), storedBytes: () => ({ key: new Map(ledger.key), src: new Map(ledger.src) }) };
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

function createServer({ dataDir, cert, key, clock, billing, trustProxy = false, identity = null, maxConnPerIp = MAX_CONN_PER_IP, maxInflightBytes = MAX_INFLIGHT_BYTES }) {
  const relay = createRelay({ dataDir, clock, billing, identity, background: true });
  // ניקוי התשלומים שלא הושלמו — בעלייה ואחר כך כל שעה, גם כשאין בקשות (f75)
  // מחיקה של מה שפג, התאמה מול ספק הסליקה (f15), ושוב מחיקה. תשלום שאפשר לבדוק אצל הספק לא נמחק לפני הבדיקה האחרונה
  // שלו (livePayments) — ולכן המחיקה הראשונה (סינכרונית, גם בעלייה) בטוחה, וה-webhook שאבד נמסר לפני שהרשומה נמחקת
  let paySweeping = false;
  const expireNow = () => { try { relay.expirePayments(); } catch (e) { console.error('relay: payment sweep failed: ' + ((e && e.message) || e)); } };
  const paySweep = () => {
    if (paySweeping) return;
    paySweeping = true;
    expireNow();
    Promise.resolve().then(() => relay.reconcilePayments()).catch((e) => console.error('relay: payment reconcile failed: ' + ((e && e.message) || e)))
      .then(expireNow)
      .finally(() => { paySweeping = false; });
  };
  paySweep();
  const payTimer = setInterval(paySweep, PAYMENT_SWEEP_MS);
  if (payTimer.unref) payTimer.unref();
  // בקשות /v1 פתוחות לכל כתובת, ונפח הגופים שבזיכרון (f19) — נבדקים לפני קריאת הגוף
  const open = new Map();
  let inflight = 0;
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
      // דפי התשלום וה-webhook — בלי מפתח מכשיר; מעל המכסה הרגילה לכתובת — נדחים
      try { if (relay.rateLimit(clientAddress(req, trustProxy))) return send(429, { ok: false, error: 'יותר מדי בקשות מהכתובת הזו — נסו שוב בעוד דקה' }); }
      catch (e) { return send(e.status, { ok: false, error: e.message }); }
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
    // לפני קריאת הגוף (f19): הגבלת קצב לכתובת, בקשות במקביל מאותה כתובת, וגודל מוצהר
    const ip = clientAddress(req, trustProxy);
    // דחייה בלי לקרוא את הגוף: החיבור נסגר אחרי שהתשובה נשלחה (בלי keep-alive)
    const reject = (status, error) => { res.shouldKeepAlive = false; send(status, { ok: false, error }); };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) return reject(413, 'הבקשה גדולה מדי');
    if ((open.get(ip) || 0) >= maxConnPerIp) return reject(429, 'יותר מדי בקשות במקביל מהכתובת הזו — נסו שוב בעוד דקה');
    let overloaded = false;
    try { overloaded = relay.rateLimit(ip); } catch (e) { return reject(e.status || 429, e.message); }
    open.set(ip, (open.get(ip) || 0) + 1);
    let size = 0, held = 0, released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflight -= held; held = 0;
      const n = (open.get(ip) || 1) - 1;
      if (n > 0) open.set(ip, n); else open.delete(ip);
    };
    res.on('close', release);
    res.on('finish', release);
    const chunks = [];
    req.on('data', (c) => {
      if (res.writableEnded) return;
      size += c.length;
      if (size > MAX_BODY) { send(413, { ok: false, error: 'הבקשה גדולה מדי' }); req.destroy(); release(); return; }
      if (inflight + c.length > maxInflightBytes) { send(503, { ok: false, error: 'השרת עמוס — נסו שוב בעוד כמה דקות' }); req.destroy(); release(); return; }
      inflight += c.length; held += c.length;
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { ok: false, error: 'בקשה לא תקינה' }); }
      const fail = (e) => { send(e.status || 500, { ok: false, error: e.status ? e.message : 'שגיאה בשרת' }); if (!e.status) console.error(e); };
      // הכתובת כבר נספרה לפני קריאת הגוף — handle לא סופר אותה שוב (rateLimit: false)
      try { Promise.resolve(relay.handle(body, ip, { preCounted: true, overloaded })).then(r => send(200, r), fail); }
      catch (e) { fail(e); }
    });
  };
  const server = cert && key
    ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' }, onRequest)
    // nosemgrep: problem-based-packs.insecure-transport.js-node.using-http-server.using-http-server -- בלי תעודה השרת רץ מאחורי פרוקסי HTTPS (deploy/relay); הלקוח מאמת תשובה חתומה (checkin.js)
    : http.createServer(onRequest);
  // חיבורים איטיים (slowloris) לא מחזיקים את השרת
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.maxHeadersCount = 50;
  server.maxConnections = MAX_CONNECTIONS;
  server.on('close', () => clearInterval(payTimer));
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
  MAX_BOX_BYTES, SEND_PER_IP_TO_BOX_HOUR, MAX_UNKNOWN_IN_OWNER_BOX, FETCH_MAX_MESSAGES, FETCH_MAX_BYTES,
  SEND_MAX_BOXES, SEND_PER_IP_HOUR, CHECKOUT_PER_KEY_DAY, CHECKOUT_PER_IP_DAY, FREE_SIGNUP_PER_KEY_DAY, FREE_SIGNUP_PER_IP_DAY, RATE,
  STORE_BYTES_PER_KEY_DAY, STORE_BYTES_PER_IP_DAY, STORED_BYTES_PER_KEY, STORED_BYTES_PER_IP, CAP_SIGNUP_V2, MAX_SEEN, NEW_PREKEYS_PER_DAY, DEAD_BOX_TTL_MS, PREKEY_KEEP_MS, NEW_PREKEYS_PER_IP_DAY, MAX_CONN_PER_IP, CHECKOUT_RESERVE_BYTES,
  KNOWN_KEEP_MS, MAX_FREE_IN_BOX, MAX_NONCES, MAX_OFFLINE_NONCES, OFFLINE_PER_HOUR };
