// העדפות עוזר ה-AI: קובץ קטן ב-userData, מוצפן AES-256-GCM (SSDB1:) במפתח הנגזר ממפתח הגיבוי האוטומטי.
// אין בו נתונים עסקיים — רק בחירות של המשתמש: מנוע, הסתרת מזהים והסכמה לשירות ענן.
// בלי מפתח גיבוי (התקנה חדשה לפני שנוצר מפתח, או מכשיר בלי DPAPI) — נשמר גלוי עם דגל, ולא נוצר מפתח חדש מכאן.
const path = require('path');
const AR = require('../../modules/econ/core/atRest');

const FILE = 'ai-prefs.json';
const KEY_INFO = 'SuperSuite ai prefs v1:user';
const MAX_FILE = 64 * 1024;
const DEFAULTS = Object.freeze({ v: 1, engine: 'local-only', conceal: true, consent: { cloud: false, at: null } });

// קלט לא מהימן (קובץ שנערך ביד) — מנורמל לשדות מוכרים בלבד
function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const consent = r.consent && typeof r.consent === 'object' ? r.consent : {};
  const at = Number(consent.at);
  return {
    v: 1,
    engine: r.engine === 'cloud-when-available' ? 'cloud-when-available' : 'local-only',
    conceal: r.conceal !== false,
    consent: { cloud: consent.cloud === true, at: consent.cloud === true && Number.isFinite(at) && at > 0 ? Math.round(at) : null },
  };
}

// getBackupKey(create=false) ← מפתח הגיבוי (base64) או null/שגיאה. קריאה בלבד — לא יוצרת מפתח
function createPrefs({ fs, dir, getBackupKey, onError = () => {}, now = () => Date.now() }) {
  const file = path.join(dir, FILE);

  const cipherFor = (key) => {
    if (!key) return null;
    try { return AR.createCipher(AR.deriveDbKey(key, KEY_INFO)); }
    catch (e) { onError('ai-prefs-key', e); return null; }
  };

  function readRaw() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return { state: e && e.code === 'ENOENT' ? 'missing' : 'error', prefs: { ...DEFAULTS } }; }
    if (text.length > MAX_FILE) return { state: 'error', prefs: { ...DEFAULTS } };
    let key = null;
    try { key = getBackupKey(false); } catch (e) { onError('ai-prefs-key', e); }
    const cipher = cipherFor(key);
    let body = text;
    if (AR.isSealed(text)) {
      if (!cipher) return { state: 'locked', prefs: { ...DEFAULTS } }; // מוצפן ואין מפתח — ריק, לא פגום
      try { body = cipher.open(text); }
      catch (e) { onError('ai-prefs-open', e); return { state: 'locked', prefs: { ...DEFAULTS } }; }
    }
    try { return { state: 'ok', prefs: normalize(JSON.parse(body)) }; }
    catch { return { state: 'corrupt', prefs: { ...DEFAULTS } }; }
  }

  function get() {
    const { state, prefs } = readRaw();
    return { ...prefs, state };
  }

  // patch: השדות שמשתנים מהמסך. עדכון חלקי; שדה לא תקין — נדחה ומוחזר המצב הקיים
  function save(patch) {
    const current = readRaw().prefs;
    const merged = normalize({ ...current, ...(patch || {}), consent: { ...current.consent, ...((patch && patch.consent) || {}) } });
    // תאריך ההסכמה — קיר הזמן, שעון המערכת של המשתמש; התאריך היחיד שנכתב כאן
    if (merged.consent.cloud && !merged.consent.at) merged.consent.at = now();
    if (!merged.consent.cloud) merged.consent.at = null;
    let key = null;
    try { key = getBackupKey(true); } catch (e) { onError('ai-prefs-key', e); key = null; }
    const cipher = cipherFor(key);
    const json = JSON.stringify(merged);
    const body = cipher ? cipher.seal(json) : json;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.part';
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) { onError('ai-prefs-write', e); throw new Error('לא ניתן לשמור את הגדרות העוזר במחשב הזה'); }
    return { ...merged, state: 'ok' };
  }

  return { get, save, file };
}

module.exports = { createPrefs, normalize, DEFAULTS, FILE, KEY_INFO };
