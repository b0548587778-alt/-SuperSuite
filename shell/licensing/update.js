// עדכוני גרסה חתומים (docs/LICENSING-DESIGN.md, "עדכוני גרסה").
// מנהל-העל משחרר גרסה: קובץ התקנה (EXE / APK) + "תעודת גרסה" חתומה במפתח השורש — גרסה, פלטפורמה, SHA-256, גודל, קישור הורדה.
// המערכת מתקינה רק אם: החתימה תקינה מול מפתח שורש מוגדר, הגרסה חדשה מהמותקנת (אין שנמוך), והקובץ תואם ל-SHA-256 ולגודל.
// הקובץ עצמו מגיע מקישור (https) או מקובץ (USB) — המקור אינו מהימן, רק התעודה החתומה.
const crypto = require('crypto');
const L = require('./license');
const C = require('./crypto-lite');

const UPDATE_TYPE = 'supersuite-update';
const PLATFORMS = { win: ['exe'], android: ['apk'] };
const MAX_SIZE = 1024 * 1024 * 1024; // 1GB
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_NOTES = 2000;

function parseVersion(v) {
  if (!VERSION_RE.test(String(v))) throw new Error('מספר הגרסה אינו תקין (למשל 3.9.0)');
  return String(v).split('.').map(Number);
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function platformOf(fileName) {
  const ext = String(fileName).toLowerCase().split('.').pop();
  for (const [p, exts] of Object.entries(PLATFORMS)) if (exts.includes(ext)) return p;
  throw new Error('סוג הקובץ אינו נתמך (EXE או APK בלבד)');
}

// שם קובץ בטוח — בלי תיקיות ותווים אסורים
function safeFileName(name) {
  const s = String(name || '').replace(/^.*[\\/]/, '').replace(/[:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120);
  if (!s || s.startsWith('.')) throw new Error('שם הקובץ אינו תקין');
  return s;
}

function checkUrl(url) {
  if (!url) return '';
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('קישור ההורדה אינו תקין'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('קישור ההורדה חייב להיות https');
  return u.toString();
}

// SHA-256 של קובץ: node:crypto בשולחן העבודה, JS טהור באנדרואיד
function hashBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof crypto.createHash === 'function') return crypto.createHash('sha256').update(u8).digest('hex');
  return Buffer.from(C.sha256(u8)).toString('hex');
}

function cleanPayload(input, issuedAt) {
  const fileName = safeFileName(input.fileName);
  const platform = platformOf(fileName);
  if (input.platform && input.platform !== platform) throw new Error('הפלטפורמה אינה תואמת לסוג הקובץ');
  parseVersion(input.version);
  const sha256 = String(input.sha256 || '').toLowerCase();
  if (!HEX64.test(sha256)) throw new Error('תמצית הקובץ (SHA-256) אינה תקינה');
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) throw new Error('גודל הקובץ אינו תקין');
  return { v: 1, version: String(input.version), platform, fileName, sha256, size, url: checkUrl(input.url),
    notes: String(input.notes || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_NOTES),
    issuedAt: Number.isSafeInteger(issuedAt) ? issuedAt : Date.now() };
}

// מנהל-העל: תעודת גרסה חתומה. מחזיר טקסט JSON (נשלח בשרת / נשמר ליד הקובץ כ-.ssupdate)
function createRelease(rootPrivateJwk, input, { issuedAt } = {}) {
  const payload = { ...cleanPayload(input || {}, issuedAt), issuer: L.keyId(rootPrivateJwk) };
  return JSON.stringify({ type: UPDATE_TYPE, payload, sig: L.signObject(payload, rootPrivateJwk) });
}

// אימות תעודת גרסה מול מפתחות השורש המוגדרים בתוכנה. מחזיר את התוכן, או זורק שגיאה בעברית
function verifyRelease(text, rootKeys) {
  let rel;
  try { rel = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('קובץ העדכון פגום'); }
  if (!rel || rel.type !== UPDATE_TYPE || !rel.payload || typeof rel.sig !== 'string') throw new Error('הקובץ אינו קובץ עדכון');
  if (!Array.isArray(rootKeys) || !rootKeys.length) throw new Error('מפתח מנהל-העל אינו מוגדר בתוכנה — אי אפשר לאמת עדכונים');
  const key = rootKeys.find(k => L.keyId(k) === rel.payload.issuer);
  if (!key || !L.verifyObject(rel.payload, rel.sig, key)) throw new Error('חתימת העדכון אינה תקינה — העדכון נדחה');
  const p = rel.payload;
  const clean = cleanPayload(p, p.issuedAt);
  if (clean.fileName !== p.fileName || clean.platform !== p.platform || clean.url !== p.url) throw new Error('קובץ העדכון אינו תקין');
  return { ...clean, issuer: p.issuer };
}

// הקובץ שהורד / נבחר — חייב להתאים לתעודה בגודל ובתמצית
function checkFile(payload, bytes) {
  const n = bytes ? bytes.length != null ? bytes.length : bytes.byteLength : 0;
  if (n !== payload.size) throw new Error('גודל הקובץ אינו תואם לעדכון החתום — הקובץ נדחה');
  if (hashBytes(bytes) !== payload.sha256) throw new Error('תוכן הקובץ אינו תואם לעדכון החתום — הקובץ נדחה');
  return true;
}

// קריאת גוף התשובה עם תקרה: השרת אינו מהימן, ובלי content-length הוא יכול לשלוח בלי סוף.
// עוצרים ברגע שעברנו את הגודל שבתעודה — לפני שהזיכרון מתמלא
async function readCapped(res, max) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length > max) throw new Error('הקובץ שהתקבל גדול מהצפוי — נדחה');
    return all;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      try { await reader.cancel(); } catch { /* */ }
      throw new Error('הקובץ שהתקבל גדול מהצפוי — נדחה');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// מנהל העדכונים במערכת: זוכר את העדכון החדש ביותר שהתקבל, מוריד, מאמת ושומר לקובץ.
// io: { saveFile(name, bytes) → path, fetchImpl } — כדי שאותו קוד ירוץ בשולחן העבודה ובאנדרואיד
function createUpdateManager({ storage, rootKeys, currentVersion, platform, fetchImpl, saveFile, clock = Date.now }) {
  const load = () => { try { return JSON.parse(storage.read() || '{}') || {}; } catch { return {}; } };
  const save = (d) => storage.write(JSON.stringify(d));

  function isNewer(p) { return compareVersions(p.version, currentVersion) > 0; }

  // תעודה שהגיעה (מהשרת או מקובץ). נשמרת אם היא לפלטפורמה הזו וחדשה מהקיים
  function offer(text) {
    const p = verifyRelease(text, rootKeys);
    if (p.platform !== platform) return { added: false, reason: 'platform' };
    if (!isNewer(p)) return { added: false, reason: 'old' };
    const d = load();
    if (d.available && compareVersions(d.available.payload.version, p.version) >= 0) return { added: false, reason: 'known' };
    save({ ...d, available: { payload: p, text: typeof text === 'string' ? text : JSON.stringify(text), at: clock() }, downloaded: null });
    return { added: true, version: p.version };
  }

  function status() {
    const d = load();
    const av = d.available && isNewer(d.available.payload) ? d.available.payload : null;
    const dl = av && d.downloaded && d.downloaded.version === av.version ? d.downloaded : null;
    return { currentVersion, platform, available: av, downloaded: dl ? { version: dl.version, path: dl.path } : null, checkedAt: d.lastCheck || null };
  }

  // הורדה מהקישור שבתעודה, אימות, ושמירה. הקובץ לא נשמר אם אינו תואם
  async function download() {
    const d = load();
    const p = d.available && d.available.payload;
    if (!p || !isNewer(p)) throw new Error('אין עדכון זמין');
    if (!p.url) throw new Error('לעדכון הזה אין קישור הורדה — יש להתקין מקובץ');
    if (typeof fetchImpl !== 'function') throw new Error('אין חיבור רשת במכשיר הזה — יש להתקין מקובץ');
    let res;
    try { res = await fetchImpl(p.url, { redirect: 'follow' }); } catch { throw new Error('ההורדה נכשלה — בדקו את החיבור, או התקינו מקובץ'); }
    if (!res.ok) throw new Error('ההורדה נכשלה (' + res.status + ')');
    const len = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
    if (Number.isFinite(len) && len > p.size) throw new Error('הקובץ שהתקבל גדול מהצפוי — נדחה');
    const bytes = await readCapped(res, p.size);
    checkFile(p, bytes);
    const path = await saveFile(p.fileName, bytes);
    save({ ...load(), downloaded: { version: p.version, path, at: clock() } });
    return { version: p.version, path };
  }

  // התקנה מקובץ (USB): תעודת הגרסה + קובץ ההתקנה. מחזיר את הנתיב השמור לאחר אימות
  async function fromFile(releaseText, bytes) {
    const p = verifyRelease(releaseText, rootKeys);
    if (p.platform !== platform) throw new Error(platform === 'win' ? 'העדכון מיועד לאנדרואיד ולא למחשב' : 'העדכון מיועד למחשב ולא לאנדרואיד');
    if (!isNewer(p)) throw new Error('הגרסה בקובץ (' + p.version + ') אינה חדשה מהמותקנת (' + currentVersion + ')');
    checkFile(p, bytes);
    const path = await saveFile(p.fileName, bytes);
    save({ ...load(), available: { payload: p, text: releaseText, at: clock() }, downloaded: { version: p.version, path, at: clock() } });
    return { version: p.version, path };
  }

  // הקובץ המאומת שמוכן להתקנה (נבדק שוב לפני הרצה — אולי שונה בדיסק)
  function readyToInstall() {
    const st = status();
    if (!st.downloaded) throw new Error('אין עדכון מוכן להתקנה');
    return { version: st.downloaded.version, path: st.downloaded.path, payload: st.available };
  }

  return { offer, status, download, fromFile, readyToInstall, markChecked: () => save({ ...load(), lastCheck: clock() }) };
}

module.exports = { UPDATE_TYPE, PLATFORMS, MAX_SIZE, compareVersions, platformOf, hashBytes, createRelease, verifyRelease, checkFile, readCapped, createUpdateManager };
