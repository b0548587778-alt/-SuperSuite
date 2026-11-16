// מחסן מוצפן לנתוני המודולים (PLAN.md 3.2): השמאות שמרה הכול ב-localStorage גלוי.
// עכשיו ה-preload (shell/secure-ls-preload.js) מחליף את localStorage בעמוד בעותק בזיכרון,
// וכל שינוי נשלח לכאן ונכתב לקובץ secure-<mod>.bin, מוצפן AES-256-GCM.
// המפתח נגזר ממפתח הגיבוי האוטומטי (DPAPI) — קוד השחזור (🔑) פותח גם אותו. בלי תלות ב-Electron, כדי שייבדק.
const path = require('path');
const crypto = require('crypto');
const AR = require('../modules/econ/core/atRest');

// מודול האימונים עבר למוצר החינוכי הנפרד: secure-trainer.bin של משתמשים קיימים לא נפתח כאן — ולא נמחק
// שמאי, ומודולי הלימוד של המהדורה המלאה (אימונים, אנגלית, חשבון, ניהול מוסד)
const MODULES = ['shamai', 'trainer', 'english', 'math', 'school'];
const MAX_KEY = 256;
const MAX_VALUE = 5 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
// תמונות — מחוץ לקובץ הראשי (סקירת קוד 2.11.2026, תכנית ב): קובץ מוצפן לכל תמונה בתיקייה secure-<mod>-blobs,
// עם מכסה משלהן. הקובץ הראשי מחזיק רק את רשימת המפתחות (blobs) — כתיבה רגילה לא מצפינה מחדש את כל התמונות.
// התקרה נקבעה כך שהגיבוי המלא (מחרוזת JSON אחת, פורמט שלא משתנה) עדיין נכנס בגבול המחרוזת של V8
const MAX_BLOB_TOTAL = 256 * 1024 * 1024;
const BLOB_PREFIXES = { shamai: ['shamai_v2_img_', 'shamai_v2_casePhoto_'] };
const blobPrefixes = (mod) => (BLOB_PREFIXES[mod] || []).slice();
// שם הקובץ — גיבוב של המפתח (המפתח עצמו נשמר רק מוצפן, בתוך הקובץ)
const blobName = (k) => crypto.createHash('sha256').update(String(k), 'utf8').digest('hex') + '.bin';
const FLUSH_MS = 300;
// כתיבה לקובץ שנכשלה — ניסיון חוזר מעצמו, בלי לחכות לכתיבה הבאה מהעמוד או ליציאה מסודרת (כמו תיבת ההודעות)
const FLUSH_RETRY_MS = 30 * 1000;
// קובץ תפוס לרגע (אנטי-וירוס שסורק את הקובץ הזמני, אינדוקס של Windows): עוד ניסיונות מיד, אחרי השהיה קצרה
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const BUSY_PAUSES_MS = [25, 75];
const FLUSH_ATTEMPTS = BUSY_PAUSES_MS.length + 1;
// השהיה סינכרונית (התהליך הראשי; flush עצמו סינכרוני)
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* אין Atomics.wait */ } };
// הטיימר של הניסיון החוזר לא מחזיק את התהליך בחיים
const unrefTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; };

const keyFor = (backupKey, mod) => AR.deriveDbKey(backupKey, 'SuperSuite module store v1:' + mod);

// כתיבה שנדחתה: הסיבה וההודעה לעמוד (שם נזרקת כמו מ-localStorage אמיתי — shell/secure-ls-preload.js)
const WRITE_MESSAGES = {
  unavailable: 'השינוי לא נשמר: האחסון המוצפן של המודול אינו זמין',
  invalid: 'השינוי לא נשמר: הנתון אינו תקין',
  'too-large': 'השינוי לא נשמר: הנתון גדול מדי (עד 5MB לפריט אחד)',
  quota: 'השינוי לא נשמר: נגמר המקום באחסון של המודול — יש למחוק פריטים או תמונות ישנים',
  'blob-quota': 'התמונה לא נשמרה: נגמר המקום לתמונות של המודול — יש למחוק תמונות ישנות',
  disk: 'השינוי לא נשמר: הכתיבה לדיסק נכשלה — בדקו שיש מקום פנוי בכונן'
};
// שם השגיאה בעמוד: מקום — QuotaExceededError (כמו בדפדפן); כל סיבה אחרת — SecurityError
const QUOTA_REASONS = new Set(['too-large', 'quota', 'blob-quota']);
const rejectWrite = (reason, message) => ({ ok: false, reason, name: QUOTA_REASONS.has(reason) ? 'QuotaExceededError' : 'SecurityError',
  message: message || WRITE_MESSAGES[reason] || 'השינוי לא נשמר' });
const fail = (reason) => rejectWrite(reason);

// fs מוזרק; getBackupKey(create) ← מפתח הגיבוי (base64) או שגיאה; onError(scope, e) — יומן תקלות.
// retrySchedule — הטיימר של הניסיון החוזר אחרי כשל בדיסק, pause — ההשהיה בין ניסיונות מיידיים (בבדיקות — מוזרקים).
// maxBlobTotal — מכסת התמונות (בבדיקות — קטנה)
function createSecureStore({ fs, dir, mod, getBackupKey, onError = () => {}, schedule = (fn, ms) => setTimeout(fn, ms),
  retrySchedule = unrefTimer, pause = sleepSync, maxBlobTotal = MAX_BLOB_TOTAL, now = () => Date.now() }) {
  if (!MODULES.includes(mod)) throw new Error('מודול לא מוכר: ' + mod);
  const file = path.join(dir, `secure-${mod}.bin`);
  // תיקיית התמונות; בשחזור — תיקיית ביניים (.new) שמחליפה אותה רק אחרי שהקובץ הראשי נכתב
  const blobDir = path.join(dir, `secure-${mod}-blobs`);
  const stagingDir = blobDir + '.new';
  const GEN_FILE = '.gen';
  const prefixes = blobPrefixes(mod);
  const isBlobKey = (k) => typeof k === 'string' && prefixes.some(p => k.startsWith(p));
  let cipher = null;
  let data = new Map();
  let blobs = new Map(); // מפתח ← אורך הערך (רשימת התמונות, נשמרת בקובץ הראשי)
  let blobGen = null; // מזהה סט התמונות של שחזור שהקובץ הראשי מפנה אליו (תיקיית הביניים)
  let activeDir = blobDir;
  let staging = null; // { dir, gen } — שחזור שעוד לא נכתב בקובץ הראשי
  const pendingUnlink = new Set(); // קבצי תמונות שנמחקו — נמחקים מהדיסק רק אחרי שהקובץ הראשי נכתב בלעדיהם
  let state = 'plain'; // encrypted | plain (אין DPAPI) | locked (יש קובץ מוצפן ואין מפתח מתאים)
  let migrated = false;
  let timer = null;
  let retryTimer = null;
  let dirty = false;
  let diskFailed = false; // הכתיבה האחרונה לקובץ נכשלה — כתיבות חדשות נדחות עד שהקובץ נכתב שוב

  // כתיבה עמידה: קובץ זמני, fsync והחלפה; קובץ תפוס לרגע — עוד ניסיונות. כשל אחרון נזרק (והקובץ הזמני נמחק)
  function writeDurable(target, body) {
    const tmp = target + '.tmp';
    for (let attempt = 0; ; attempt++) {
      try {
        // fsync לפני ההחלפה: בלעדיו, אחרי הפסקת חשמל NTFS יכול להשאיר את הקובץ ריק או חלקי — והמודול ננעל
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeSync(fd, body, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
        return;
      } catch (e) {
        // קובץ תפוס לרגע — עוד ניסיון מיד, אחרי השהיה קצרה
        if (BUSY_CODES.has(e && e.code) && attempt < BUSY_PAUSES_MS.length) { pause(BUSY_PAUSES_MS[attempt]); continue; }
        try { fs.rmSync(tmp, { force: true }); } catch {}
        throw e;
      }
    }
  }

  // ---------- תמונות: קובץ מוצפן לכל מפתח (סקירת קוד 2.11.2026, תכנית ב) ----------
  const corrupt = (msg) => Object.assign(new Error(msg), { code: 'blob-corrupt' });
  function writeBlob(where, k, v) {
    fs.mkdirSync(where, { recursive: true });
    writeDurable(path.join(where, blobName(k)), cipher.seal(JSON.stringify({ k, v })));
  }
  // פענוח שנכשל (מפתח אחר, קובץ קטוע) — blob-corrupt; תקלת קריאה (קובץ תפוס) — השגיאה המקורית
  function readBlobFile(full) {
    const text = fs.readFileSync(full, 'utf8');
    let obj;
    try { obj = JSON.parse(cipher.open(text)); } catch (e) { throw corrupt('קובץ תמונה פגום'); }
    if (!obj || typeof obj.k !== 'string' || typeof obj.v !== 'string') throw corrupt('קובץ תמונה פגום');
    return obj;
  }
  function readBlob(k, where = activeDir) {
    const obj = readBlobFile(path.join(where, blobName(k)));
    if (obj.k !== k) throw corrupt('קובץ תמונה של מפתח אחר');
    return obj.v;
  }
  const rmQuiet = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { onError('secure-store', e); } };
  // קובץ פגום לא נמחק — מועבר הצידה (כמו תיבת ההודעות), ונמחק מהרשימה
  function setAsideBlob(k) {
    const full = path.join(activeDir, blobName(k));
    try { if (fs.existsSync(full)) fs.renameSync(full, full + '.unreadable-' + now()); } catch (e) { onError('secure-store', e); }
    blobs.delete(k);
    changed();
  }
  function blobTotal() {
    let n = 0;
    for (const [k, len] of blobs) n += k.length + len;
    for (const [k, v] of data) if (isBlobKey(k)) n += k.length + v.length;
    return n;
  }
  // מחיקה של קובץ תמונה: בתיקייה הפעילה — רק אחרי שהקובץ הראשי נכתב (קריסה באמצע לא משאירה רשימה שמפנה לקובץ חסר);
  // בתיקיית ביניים של שחזור — מיד (הקובץ הראשי שבדיסק עוד לא מפנה אליה)
  function dropBlobFile(k) {
    if (staging) { try { fs.rmSync(path.join(staging.dir, blobName(k)), { force: true }); } catch (e) { onError('secure-store', e); } }
    else pendingUnlink.add(blobName(k));
  }

  // בפתיחה: השלמת החלפה של שחזור שנקטע, ניקוי שאריות, קבצים חסרים ויתומים
  function recoverBlobs() {
    let touched = false;
    if (fs.existsSync(stagingDir)) {
      let gen = null;
      try { gen = fs.readFileSync(path.join(stagingDir, GEN_FILE), 'utf8').trim(); } catch { gen = null; }
      if (gen && gen === blobGen) {
        // הקובץ הראשי כבר מפנה לתיקיית הביניים (קריסה בין כתיבת הקובץ להחלפה) — משלימים את ההחלפה
        try {
          if (fs.existsSync(blobDir)) fs.renameSync(blobDir, blobDir + '.old-' + now());
          fs.renameSync(stagingDir, blobDir);
        } catch (e) { onError('secure-store', e); activeDir = stagingDir; }
      } else rmQuiet(stagingDir); // שחזור שלא הגיע לקובץ הראשי
    }
    try {
      const base = path.basename(blobDir) + '.old-';
      for (const f of fs.readdirSync(dir)) if (f.startsWith(base)) rmQuiet(path.join(dir, f));
    } catch (e) { onError('secure-store', e); }
    let files = [];
    try { files = fs.existsSync(activeDir) ? fs.readdirSync(activeDir) : []; } catch (e) { onError('secure-store', e); }
    const byName = new Map([...blobs.keys()].map(k => [blobName(k), k]));
    const present = new Set();
    for (const f of files) {
      const full = path.join(activeDir, f);
      if (f.endsWith('.tmp')) { rmQuiet(full); continue; }
      if (!/^[0-9a-f]{64}\.bin$/.test(f)) continue;
      if (byName.has(f)) { present.add(f); continue; }
      // קובץ יתום: נכתב ואז קריסה לפני שהרשימה נשמרה, או קובץ ראשי מגרסה קודמת (בלי רשימה) — מאמצים, לא מוחקים
      try {
        const obj = readBlobFile(full);
        if (blobName(obj.k) !== f || !isBlobKey(obj.k)) throw corrupt('קובץ תמונה פגום');
        if (data.has(obj.k)) continue; // עוד בקובץ הראשי — ההעברה (migrateBlobs) כותבת אותו מחדש
        blobs.set(obj.k, obj.v.length);
        present.add(f);
        touched = true;
      } catch (e) {
        onError('secure-store', e);
        if (e && e.code === 'blob-corrupt') { try { fs.renameSync(full, full + '.unreadable-' + now()); } catch (err) { onError('secure-store', err); } }
      }
    }
    // ברשימה ואין קובץ — התמונה אבדה (אין ממה לשחזר); הרשימה מתעדכנת כדי שהגיבוי לא ייכשל עליה בכל סבב
    for (const [name, k] of byName) {
      if (present.has(name)) continue;
      onError('secure-store', Object.assign(new Error('קובץ תמונה חסר במחסן'), { code: 'blob-missing' }));
      blobs.delete(k);
      touched = true;
    }
    if (touched) dirty = true;
  }

  // העברת תמונות מהקובץ הראשי (גרסה קודמת, העברה מ-localStorage) לקבצים נפרדים. כל תמונה: כתיבה, קריאה חוזרת
  // והשוואה — ורק אז היא יוצאת מהקובץ הראשי. כשל ← התמונה נשארת בקובץ הראשי, וההעברה ממשיכה בפתיחה הבאה
  function migrateBlobs() {
    if (state !== 'encrypted' || staging) return 0;
    let moved = 0;
    for (const [k, v] of [...data]) {
      if (!isBlobKey(k)) continue;
      try {
        writeBlob(activeDir, k, v);
        if (readBlob(k) !== v) throw corrupt('אימות התמונה נכשל');
      } catch (e) { onError('secure-store', e); break; }
      data.delete(k);
      blobs.set(k, v.length);
      pendingUnlink.delete(blobName(k));
      moved++;
    }
    if (moved) { dirty = true; flush(); }
    return moved;
  }

  function open() {
    const exists = fs.existsSync(file);
    let backupKey;
    // קובץ קיים: לא יוצרים מפתח חדש — מפתח חדש לא יפתח אותו
    try { backupKey = getBackupKey(!exists); }
    catch (e) {
      if (exists) { state = 'locked'; onError('secure-store', e); }
      else state = 'plain';
      return;
    }
    // nosemgrep: javascript.node-crypto.security.create-de-cipher-no-iv.create-de-cipher-no-iv -- AR.createCipher של הפרויקט (AES-256-GCM עם IV אקראי לכל הצפנה), לא crypto.createCipher הישן
    cipher = AR.createCipher(keyFor(backupKey, mod));
    if (exists) {
      try {
        const parsed = JSON.parse(cipher.open(fs.readFileSync(file, 'utf8')));
        data = new Map(Object.entries(parsed.items || {}).filter(([k, v]) => typeof v === 'string'));
        const list = parsed.blobs && typeof parsed.blobs === 'object' && !Array.isArray(parsed.blobs) ? parsed.blobs : {};
        blobs = new Map(Object.entries(list).filter(([k, n]) => isBlobKey(k) && Number.isSafeInteger(n) && n >= 0));
        blobGen = typeof parsed.blobGen === 'string' ? parsed.blobGen : null;
        migrated = !!parsed.migrated;
      } catch (e) {
        // מפתח שגוי או קובץ פגום: לא דורסים — הקובץ נשאר כמו שהוא, והמודול נפתח ריק לקריאה בלבד
        state = 'locked';
        cipher = null;
        onError('secure-store', e);
        return;
      }
    }
    state = 'encrypted';
    // גם בלי קובץ ראשי: קבצי תמונות שנכתבו לפני שהקובץ הראשי נכתב לראשונה — מאומצים
    try { recoverBlobs(); } catch (e) { onError('secure-store', e); }
    migrateBlobs();
    // תיקון ברשימה (יתום שאומץ, קובץ חסר) — נכתב כאן; בלי קובץ ראשי ובלי שינוי — לא יוצרים קובץ ריק
    if (dirty) flush();
  }

  function total() { let n = 0; for (const [k, v] of data) if (!isBlobKey(k)) n += k.length + v.length; return n; }

  // אחרי שהקובץ הראשי נכתב: החלפת תיקיית התמונות בשחזור, ומחיקת קבצים של תמונות שנמחקו
  function afterMainWritten() {
    if (staging) {
      const old = blobDir + '.old-' + now();
      try {
        if (fs.existsSync(blobDir)) fs.renameSync(blobDir, old);
        fs.renameSync(staging.dir, blobDir);
        activeDir = blobDir;
        staging = null;
      } catch (e) {
        // הקובץ הראשי כבר מפנה לתיקיית הביניים (blobGen): הקריאה ממשיכה ממנה, וההחלפה תושלם בפתיחה הבאה
        onError('secure-store', e);
        if (!fs.existsSync(staging.dir) && fs.existsSync(old)) { try { fs.renameSync(old, blobDir); } catch {} }
        return;
      }
      rmQuiet(old);
      return;
    }
    for (const name of [...pendingUnlink]) {
      try { fs.rmSync(path.join(blobDir, name), { force: true }); pendingUnlink.delete(name); }
      catch (e) { onError('secure-store', e); }
    }
  }

  // true — הכול כתוב בקובץ
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!dirty || state !== 'encrypted') return !dirty;
    dirty = false;
    const body = cipher.seal(JSON.stringify({ v: 2, migrated, items: Object.fromEntries(data), blobs: Object.fromEntries(blobs), blobGen }));
    try {
      writeDurable(file, body);
      diskFailed = false;
      afterMainWritten();
      return true;
    } catch (e) {
      dirty = true; // ננסה שוב בכתיבה הבאה — או בניסיון החוזר, מה שקודם
      diskFailed = true;
      onError('secure-store', e);
      // ניסיון חוזר מעצמו (בדיקת קוד, סבב 2): עד עכשיו הניסיון הבא היה רק בכתיבה הבאה מהעמוד או ביציאה מסודרת,
      // וקריסה בינתיים איבדה נתונים שהעמוד כבר קיבל עליהם "נשמר"
      if (!retryTimer) {
        retryTimer = retrySchedule(() => {
          retryTimer = null;
          try { flush(); } catch (err) { onError('secure-store', err); }
        }, FLUSH_RETRY_MS);
      }
      return false;
    }
  }

  function changed() {
    dirty = true;
    if (!timer) timer = schedule(() => { timer = null; flush(); }, FLUSH_MS);
  }

  const writable = () => state === 'encrypted';

  // תמונה: נכתבת לקובץ משלה מיד (כתיבה עמידה), והרשימה בקובץ הראשי — בכתיבה הרגילה
  function setBlob(k, v) {
    const before = blobs.has(k) ? k.length + blobs.get(k) : (data.has(k) ? k.length + data.get(k).length : 0);
    if (blobTotal() - before + k.length + v.length > maxBlobTotal) return fail('blob-quota');
    try { writeBlob(activeDir, k, v); }
    catch (e) { onError('secure-store', e); return fail('disk'); }
    data.delete(k);
    blobs.set(k, v.length);
    if (!staging) pendingUnlink.delete(blobName(k));
    changed();
    return { ok: true };
  }
  function removeKey(k) {
    let hit = data.delete(k);
    if (blobs.delete(k)) { dropBlobFile(k); hit = true; }
    if (hit) changed();
    return hit;
  }
  function clearAll() {
    for (const k of blobs.keys()) dropBlobFile(k);
    blobs.clear();
    data.clear();
    changed();
  }

  // כתיבה מהעמוד: { ok: true } או { ok: false, reason, message } — לא נבלעת בשקט (בדיקת קוד 23.10.2026, ממצא 3).
  // op: set / remove / clear / flush
  function write(op, k, v) {
    if (!writable()) return fail('unavailable');
    // כתיבה לקובץ עכשיו (ולא אחרי FLUSH_MS): אישור שהנתונים בדיסק — למשל לפני מחיקת העותק הישן של תמונה
    if (op === 'flush') return flush() ? { ok: true } : fail('disk');
    // הקובץ לא נכתב בפעם הקודמת: ניסיון נוסף עכשיו, ואם נכשל שוב — דוחים במקום להציג "נשמר"
    if (diskFailed && !flush()) return fail('disk');
    if (op === 'set') {
      if (typeof k !== 'string' || typeof v !== 'string') return fail('invalid');
      if (k.length > MAX_KEY || v.length > MAX_VALUE) return fail('too-large');
      if (isBlobKey(k)) return setBlob(k, v);
      const before = data.get(k);
      data.set(k, v);
      if (total() > MAX_TOTAL) { if (before === undefined) data.delete(k); else data.set(k, before); return fail('quota'); }
      changed();
      return { ok: true };
    }
    if (op === 'remove') {
      if (typeof k !== 'string') return fail('invalid');
      removeKey(k);
      return { ok: true };
    }
    if (op === 'clear') { clearAll(); return { ok: true }; }
    return fail('invalid');
  }

  const set = (k, v) => write('set', k, v).ok;
  function remove(k) {
    if (!writable() || !(data.has(k) || blobs.has(k))) return false;
    return removeKey(k);
  }
  function clear() {
    if (!writable()) return false;
    clearAll();
    return true;
  }

  // קריאה של ערך אחד (גם תמונה מקובץ). null — אין, או שהקובץ לא נקרא
  function get(k) {
    if (typeof k !== 'string') return null;
    if (data.has(k)) return data.get(k);
    if (!blobs.has(k) || state !== 'encrypted') return null;
    try { return readBlob(k); } catch (e) { onError('secure-store', e); return null; }
  }

  // כל הנתונים, גם התמונות מהקבצים — לגיבוי, למצב שלפני שחזור ולבדיקות. קובץ תמונה פגום או חסר מועבר הצידה ונשמט
  // (אין ממה לשחזר אותו — אחרת כל גיבוי ייכשל עליו); תקלה זמנית בקריאה (קובץ תפוס) נזרקת — לא גיבוי חלקי
  function snapshot() {
    const out = Object.fromEntries(data);
    if (state !== 'encrypted') return out;
    for (const k of [...blobs.keys()]) {
      try { out[k] = readBlob(k); }
      catch (e) {
        if (!e || (e.code !== 'blob-corrupt' && e.code !== 'ENOENT')) throw e;
        onError('secure-store', e);
        setAsideBlob(k);
      }
    }
    return out;
  }

  // שחזור: כל הנתונים מתחלפים בזיכרון בבת אחת — בלי כתיבה לקובץ באמצע (set אחרי כשל בדיסק היה כותב מחסן ריק או
  // חלקי). הכתיבה — אחר כך, ב-flush או ב-markMigrated (main.js → applyRestore). דחייה ← שום דבר לא השתנה.
  // התמונות נכתבות לתיקיית ביניים, שמחליפה את תיקיית התמונות רק אחרי שהקובץ הראשי נכתב (afterMainWritten) —
  // כך גם ההחזרה למצב שלפני (שחזור שנכשל) מחליפה את התמונות בבת אחת
  function replaceAll(items) {
    if (!writable()) return fail('unavailable');
    const next = new Map();
    const nextBlobs = [];
    let size = 0, blobSize = 0;
    for (const [k, v] of Object.entries(items && typeof items === 'object' ? items : {})) {
      if (typeof k !== 'string' || typeof v !== 'string') return fail('invalid');
      if (k.length > MAX_KEY || v.length > MAX_VALUE) return fail('too-large');
      if (isBlobKey(k)) {
        blobSize += k.length + v.length;
        if (blobSize > maxBlobTotal) return fail('blob-quota');
        nextBlobs.push([k, v]);
        continue;
      }
      size += k.length + v.length;
      if (size > MAX_TOTAL) return fail('quota');
      next.set(k, v);
    }
    let nextStaging = null;
    if (nextBlobs.length || blobs.size || staging) {
      const gen = crypto.randomBytes(12).toString('hex');
      try {
        if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
        fs.mkdirSync(stagingDir, { recursive: true });
        for (const [k, v] of nextBlobs) writeBlob(stagingDir, k, v);
        writeDurable(path.join(stagingDir, GEN_FILE), gen);
      } catch (e) {
        onError('secure-store', e);
        // תיקיית ביניים שנכתבה בחלקה לא נשארת. שחזור קודם שעוד המתין לה — כבר לא שלם: אם הקובץ הראשי שבדיסק
        // מפנה אליה (blobGen), הוא יפתח בפעם הבאה בלי התמונות; כאן — לא משנים דבר בזיכרון
        rmQuiet(stagingDir);
        if (staging) { staging = null; activeDir = blobDir; }
        return fail('disk');
      }
      nextStaging = { dir: stagingDir, gen };
    }
    data = next;
    blobs = new Map(nextBlobs.map(([k, v]) => [k, v.length]));
    if (nextStaging) { staging = nextStaging; activeDir = stagingDir; blobGen = nextStaging.gen; }
    pendingUnlink.clear();
    changed();
    return { ok: true };
  }

  // העברה חד-פעמית מה-localStorage הגלוי. backup(items) — גיבוי מוצפן לפני; אם נכשל, לא מעבירים
  function migrate(items, backup) {
    if (state !== 'encrypted') return { ok: false, reason: state };
    if (migrated) return { ok: true, already: true };
    const entries = Object.entries(items && typeof items === 'object' ? items : {})
      .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.length <= MAX_KEY && v.length <= MAX_VALUE);
    if (entries.length) {
      try { backup(Object.fromEntries(entries)); }
      catch (e) { onError('secure-store', e); return { ok: false, reason: 'backup-failed' }; }
    }
    // נתונים שכבר במחסן גוברים (למשל אחרי שחזור) — מוסיפים רק מה שחסר
    const prev = new Map(data), prevDirty = dirty;
    for (const [k, v] of entries) if (!data.has(k) && !blobs.has(k)) data.set(k, v);
    migrated = true;
    dirty = true;
    if (!flush()) {
      // הקובץ לא נכתב: חוזרים בדיוק למצב שלפני. העותק הישן שמוזג היה נשאר בזיכרון, נכתב מאוחר יותר (ביציאה) בלי
      // סימון "הועבר" — וההעברה הבאה (שמוסיפה רק מה שחסר) הייתה מעדיפה אותו על עריכות חדשות ב-localStorage הישן
      data = prev;
      dirty = prevDirty;
      migrated = false;
      return { ok: false, reason: 'write-failed' };
    }
    // התמונות שהגיעו מה-localStorage הישן — לקבצים נפרדים (כשל ← נשארות בקובץ הראשי, וננסה בפתיחה הבאה)
    migrateBlobs();
    return { ok: true, count: entries.length };
  }

  // שחזור כתב למחסן את כל הנתונים, גם מה שהיה רק ב-localStorage הישן (main.js → applyRestore): אין עוד העברה,
  // והעמוד ייטען מהמחסן. נכתב לקובץ מיד; כשל ← חוזר ל"לא הועבר" ומחזיר false (הנתונים נשארים בזיכרון לניסיון הבא)
  function markMigrated() {
    if (state !== 'encrypted') return false;
    if (migrated) return flush();
    migrated = true;
    dirty = true;
    if (flush()) return true;
    migrated = false;
    return false;
  }

  open();
  return {
    file,
    blobDir,
    get state() { return state; },
    get migrated() { return migrated; },
    snapshot,
    // הקובץ הראשי בלבד (בלי התמונות שבקבצים) — לעמוד, שמקבל את התמונות לפי דרישה (get), ולעוזר ה-AI
    dataSnapshot: () => Object.fromEntries(data),
    blobKeys: () => [...blobs.keys()],
    usage: () => ({ data: total(), blobs: blobTotal(), maxData: MAX_TOTAL, maxBlobs: maxBlobTotal }),
    isBlobKey,
    get, write, set, remove, clear, replaceAll, migrate, markMigrated, flush
  };
}

module.exports = { createSecureStore, MODULES, keyFor, MAX_VALUE, MAX_TOTAL, MAX_BLOB_TOTAL, blobPrefixes, blobName,
  WRITE_MESSAGES, rejectWrite, FLUSH_RETRY_MS, FLUSH_ATTEMPTS };
