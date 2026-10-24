// מחסן מוצפן לנתוני המודולים (PLAN.md 3.2): שמאות ואימונים שמרו הכול ב-localStorage גלוי.
// עכשיו ה-preload (shell/secure-ls-preload.js) מחליף את localStorage בעמוד בעותק בזיכרון,
// וכל שינוי נשלח לכאן ונכתב לקובץ secure-<mod>.bin, מוצפן AES-256-GCM.
// המפתח נגזר ממפתח הגיבוי האוטומטי (DPAPI) — קוד השחזור (🔑) פותח גם אותו. בלי תלות ב-Electron, כדי שייבדק.
const path = require('path');
const AR = require('../modules/econ/core/atRest');

const MODULES = ['shamai', 'trainer'];
const MAX_KEY = 256;
const MAX_VALUE = 5 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
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
  disk: 'השינוי לא נשמר: הכתיבה לדיסק נכשלה — בדקו שיש מקום פנוי בכונן'
};
// שם השגיאה בעמוד: מקום — QuotaExceededError (כמו בדפדפן); כל סיבה אחרת — SecurityError
const QUOTA_REASONS = new Set(['too-large', 'quota']);
const rejectWrite = (reason, message) => ({ ok: false, reason, name: QUOTA_REASONS.has(reason) ? 'QuotaExceededError' : 'SecurityError',
  message: message || WRITE_MESSAGES[reason] || 'השינוי לא נשמר' });
const fail = (reason) => rejectWrite(reason);

// fs מוזרק; getBackupKey(create) ← מפתח הגיבוי (base64) או שגיאה; onError(scope, e) — יומן תקלות.
// retrySchedule — הטיימר של הניסיון החוזר אחרי כשל בדיסק, pause — ההשהיה בין ניסיונות מיידיים (בבדיקות — מוזרקים)
function createSecureStore({ fs, dir, mod, getBackupKey, onError = () => {}, schedule = (fn, ms) => setTimeout(fn, ms),
  retrySchedule = unrefTimer, pause = sleepSync }) {
  if (!MODULES.includes(mod)) throw new Error('מודול לא מוכר: ' + mod);
  const file = path.join(dir, `secure-${mod}.bin`);
  let cipher = null;
  let data = new Map();
  let state = 'plain'; // encrypted | plain (אין DPAPI) | locked (יש קובץ מוצפן ואין מפתח מתאים)
  let migrated = false;
  let timer = null;
  let retryTimer = null;
  let dirty = false;
  let diskFailed = false; // הכתיבה האחרונה לקובץ נכשלה — כתיבות חדשות נדחות עד שהקובץ נכתב שוב

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
    cipher = AR.createCipher(keyFor(backupKey, mod));
    if (!exists) { state = 'encrypted'; return; }
    try {
      const parsed = JSON.parse(cipher.open(fs.readFileSync(file, 'utf8')));
      data = new Map(Object.entries(parsed.items || {}).filter(([k, v]) => typeof v === 'string'));
      migrated = !!parsed.migrated;
      state = 'encrypted';
    } catch (e) {
      // מפתח שגוי או קובץ פגום: לא דורסים — הקובץ נשאר כמו שהוא, והמודול נפתח ריק לקריאה בלבד
      state = 'locked';
      cipher = null;
      onError('secure-store', e);
    }
  }

  function total() { let n = 0; for (const [k, v] of data) n += k.length + v.length; return n; }

  // true — הכול כתוב בקובץ
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!dirty || state !== 'encrypted') return !dirty;
    dirty = false;
    const body = cipher.seal(JSON.stringify({ v: 1, migrated, items: Object.fromEntries(data) }));
    const tmp = file + '.tmp';
    for (let attempt = 0; ; attempt++) {
      try {
        // fsync לפני ההחלפה: בלעדיו, אחרי הפסקת חשמל NTFS יכול להשאיר את הקובץ ריק או חלקי — והמודול ננעל
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeSync(fd, body, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
        diskFailed = false;
        return true;
      } catch (e) {
        // קובץ תפוס לרגע — עוד ניסיון מיד, אחרי השהיה קצרה
        if (BUSY_CODES.has(e && e.code) && attempt < BUSY_PAUSES_MS.length) { pause(BUSY_PAUSES_MS[attempt]); continue; }
        dirty = true; // ננסה שוב בכתיבה הבאה — או בניסיון החוזר, מה שקודם
        diskFailed = true;
        try { fs.rmSync(tmp, { force: true }); } catch {}
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
  }

  function changed() {
    dirty = true;
    if (!timer) timer = schedule(() => { timer = null; flush(); }, FLUSH_MS);
  }

  const writable = () => state === 'encrypted';

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
      const before = data.get(k);
      data.set(k, v);
      if (total() > MAX_TOTAL) { if (before === undefined) data.delete(k); else data.set(k, before); return fail('quota'); }
      changed();
      return { ok: true };
    }
    if (op === 'remove') {
      if (typeof k !== 'string') return fail('invalid');
      if (data.delete(k)) changed();
      return { ok: true };
    }
    if (op === 'clear') { data.clear(); changed(); return { ok: true }; }
    return fail('invalid');
  }

  const set = (k, v) => write('set', k, v).ok;
  function remove(k) {
    if (!writable() || !data.has(k)) return false;
    data.delete(k);
    changed();
    return true;
  }
  function clear() {
    if (!writable()) return false;
    data.clear();
    changed();
    return true;
  }
  // שחזור: כל הנתונים מתחלפים בזיכרון בבת אחת — בלי כתיבה לקובץ באמצע (set אחרי כשל בדיסק היה כותב מחסן ריק או
  // חלקי). הכתיבה — אחר כך, ב-flush או ב-markMigrated (main.js → applyRestore). דחייה ← שום דבר לא השתנה
  function replaceAll(items) {
    if (!writable()) return fail('unavailable');
    const next = new Map();
    let size = 0;
    for (const [k, v] of Object.entries(items && typeof items === 'object' ? items : {})) {
      if (typeof k !== 'string' || typeof v !== 'string') return fail('invalid');
      if (k.length > MAX_KEY || v.length > MAX_VALUE) return fail('too-large');
      size += k.length + v.length;
      if (size > MAX_TOTAL) return fail('quota');
      next.set(k, v);
    }
    data = next;
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
    for (const [k, v] of entries) if (!data.has(k)) data.set(k, v);
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
    get state() { return state; },
    get migrated() { return migrated; },
    snapshot: () => Object.fromEntries(data),
    write, set, remove, clear, replaceAll, migrate, markMigrated, flush
  };
}

module.exports = { createSecureStore, MODULES, keyFor, MAX_VALUE, WRITE_MESSAGES, rejectWrite, FLUSH_RETRY_MS, FLUSH_ATTEMPTS };
