// טעינת קובץ הרישיון של ההתקנה וחישוב המצב הנוכחי, עם מטמון קצר (docs/LICENSING-DESIGN.md, שלב 2).
// הקובץ (license.json בתיקיית הנתונים) מכיל { chain, notices, lastSeen }. הרישיונות וההודעות חתומים,
// ולכן עריכה ידנית של הקובץ רק פוסלת אותם. אין קריאה לרשת (כלל 6).
const fs = require('fs');
const S = require('./status');

const CACHE_MS = 60 * 1000;

// rootKeys ריק = התקנה בלי רישוי (פיתוח / גרסאות קודמות): הכול פתוח, כמו לפני שלב זה.
// rootKeys מוגדר ואין קובץ = נעול: מחיקת הקובץ לא פותחת את המערכת
function createLicenseStore({ file, rootKeys = [], clock = Date.now }) {
  let cached = null;
  let cachedAt = -Infinity;

  function readFile() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return e.code === 'ENOENT' ? null : { corrupt: true }; }
  }

  function compute() {
    if (!rootKeys.length) return { mode: 'unlicensed' };
    const data = readFile();
    if (!data) return { mode: 'licensed', status: 'locked', features: [], limits: {}, reasons: [{ kind: 'locked', reason: 'לא הותקן רישיון למערכת' }] };
    if (data.corrupt || !Array.isArray(data.chain)) {
      return { mode: 'licensed', status: 'locked', features: [], limits: {}, reasons: [{ kind: 'locked', reason: 'קובץ הרישיון פגום' }] };
    }
    const lastSeen = Number.isSafeInteger(data.lastSeen) ? data.lastSeen : 0;
    const r = S.effectiveStatus({ chain: data.chain, notices: data.notices || [], rootKeys, now: clock(), lastSeen });
    // שמירת הזמן המאוחר ביותר שנצפה — הגנה מהחזרת שעון גם בין הפעלות
    if (r.seenAt && r.seenAt > lastSeen) {
      try { fs.writeFileSync(file, JSON.stringify({ ...data, lastSeen: r.seenAt })); } catch { /* קריאה בלבד — לא קריטי */ }
    }
    return { mode: 'licensed', ...r, features: r.features || [], limits: r.limits || {} };
  }

  return {
    current() {
      const t = clock();
      if (!cached || t - cachedAt > CACHE_MS || t < cachedAt) { cached = compute(); cachedAt = t; }
      return cached;
    },
    invalidate() { cached = null; },
  };
}

module.exports = { createLicenseStore, CACHE_MS };
