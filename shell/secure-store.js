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

const keyFor = (backupKey, mod) => AR.deriveDbKey(backupKey, 'SuperSuite module store v1:' + mod);

// fs מוזרק; getBackupKey(create) ← מפתח הגיבוי (base64) או שגיאה; onError(scope, e) — יומן תקלות
function createSecureStore({ fs, dir, mod, getBackupKey, onError = () => {}, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  if (!MODULES.includes(mod)) throw new Error('מודול לא מוכר: ' + mod);
  const file = path.join(dir, `secure-${mod}.bin`);
  let cipher = null;
  let data = new Map();
  let state = 'plain'; // encrypted | plain (אין DPAPI) | locked (יש קובץ מוצפן ואין מפתח מתאים)
  let migrated = false;
  let timer = null;
  let dirty = false;

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

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty || state !== 'encrypted') return;
    dirty = false;
    const body = cipher.seal(JSON.stringify({ v: 1, migrated, items: Object.fromEntries(data) }));
    const tmp = file + '.tmp';
    try {
      // fsync לפני ההחלפה: בלעדיו, אחרי הפסקת חשמל NTFS יכול להשאיר את הקובץ ריק או חלקי — והמודול ננעל
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, body, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (e) {
      dirty = true; // ננסה שוב בכתיבה הבאה
      try { fs.rmSync(tmp, { force: true }); } catch {}
      onError('secure-store', e);
    }
  }

  function changed() {
    dirty = true;
    if (!timer) timer = schedule(() => { timer = null; flush(); }, FLUSH_MS);
  }

  const writable = () => state === 'encrypted';

  function set(k, v) {
    if (!writable() || typeof k !== 'string' || typeof v !== 'string') return false;
    if (k.length > MAX_KEY || v.length > MAX_VALUE) return false;
    const before = data.get(k);
    data.set(k, v);
    if (total() > MAX_TOTAL) { if (before === undefined) data.delete(k); else data.set(k, before); return false; }
    changed();
    return true;
  }
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
    for (const [k, v] of entries) if (!data.has(k)) data.set(k, v);
    migrated = true;
    dirty = true;
    flush();
    if (dirty) { migrated = false; return { ok: false, reason: 'write-failed' }; }
    return { ok: true, count: entries.length };
  }

  open();
  return {
    file,
    get state() { return state; },
    get migrated() { return migrated; },
    snapshot: () => Object.fromEntries(data),
    set, remove, clear, migrate, flush
  };
}

module.exports = { createSecureStore, MODULES, keyFor, MAX_VALUE };
