// יומן תקלות מקומי (PLAN.md 2.2): קובץ טקסט בתיקיית הנתונים, בלי מידע אישי.
// כל שורה עוברת ניקוי (ת"ז, טלפון, דוא"ל, נתיב המשתמש) לפני הכתיבה — כך שאפשר לשלוח את היומן לתמיכה.
// הקובץ מוחלף כשהוא גדל (crash.log ← crash.1.log ...), כדי שלא יגדל ללא גבול.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = 'crash.log';
const MAX_BYTES = 512 * 1024;
const KEEP = 3;
const MAX_LINE = 4000;

// ניקוי מידע אישי. הסדר חשוב: דוא"ל לפני מספרים (שלא יישאר חצי כתובת)
function redact(text, { home = os.homedir() } = {}) {
  let s = String(text == null ? '' : text);
  if (home) s = s.split(home).join('~');
  // שם המשתמש בנתיב Windows גם כשהוא לא תואם ל-homedir (למשל נתיב ישן עם רווח)
  s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n]+/gi, '$1<user>');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  // טלפון ישראלי: 05x / 0x / +972, עם או בלי מקפים ורווחים
  s = s.replace(/(?:\+972[-\s]?|\b0)(?:[23489]|5\d|7\d)[-\s]?\d{3}[-\s]?\d{4}\b/g, '<phone>');
  // נתיב קובץ במרכאות (הודעות שגיאה של fs) — שם הקובץ יכול להכיל שם של אדם (סקירת קוד 2.11.2026).
  // קבצי הקוד (מחסנית הקריאות) נשארים
  s = s.replace(/(['"])((?:[A-Za-z]:|\\|\/|~)[^'"\r\n]*)\1/g, (m, q, p) => (/\.(?:js|cjs|mjs|html|node|asar)(?::\d+)*$/i.test(p) ? m : `${q}<path>${q}`));
  // IBAN (גם בקבוצות של 4)
  s = s.replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/g, '<iban>');
  // מספר כרטיס / חשבון ארוך: 11 ספרות ומעלה, גם עם רווחים או מקפים בין הקבוצות
  s = s.replace(/\b\d(?:[ -]?\d){10,}\b/g, '<number>');
  // ת"ז / ח"פ / מספר חשבון: רצף של 7–10 ספרות
  s = s.replace(/\b\d{7,10}\b/g, '<id>');
  return s;
}

function describe(err) {
  if (err instanceof Error) return (err.stack || `${err.name}: ${err.message}`);
  if (err && typeof err === 'object') { try { return JSON.stringify(err); } catch { return String(err); } }
  return String(err);
}

function createLogger({ dir, maxBytes = MAX_BYTES, keep = KEEP, now = () => new Date(), home } = {}) {
  const file = () => path.join(dir, FILE);

  function rotate() {
    try {
      if (!fs.existsSync(file()) || fs.statSync(file()).size < maxBytes) return;
      for (let i = keep - 1; i >= 1; i--) {
        const from = path.join(dir, `crash.${i}.log`);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, `crash.${i + 1}.log`));
      }
      fs.renameSync(file(), path.join(dir, 'crash.1.log'));
      const extra = path.join(dir, `crash.${keep + 1}.log`);
      if (fs.existsSync(extra)) fs.unlinkSync(extra);
    } catch { /* היומן לעולם לא מפיל את התוכנה */ }
  }

  // level: 'error' | 'warn' | 'info'. scope: מאיפה (main / econ / render:shamai ...)
  function log(level, scope, err, extra) {
    const body = describe(err) + (extra ? ' ' + describe(extra) : '');
    const line = `${now().toISOString()} [${level}] [${scope}] ${redact(body, { home }).slice(0, MAX_LINE)}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotate();
      fs.appendFileSync(file(), line.replace(/\r?\n/g, '\n    ') + '\n');
    } catch { /* דיסק מלא / אין הרשאה — ממשיכים בלי יומן */ }
    return line;
  }

  // השורות האחרונות, מהקובץ הנוכחי ומהקודם (לדוח תקלה)
  function tail(maxLines = 400) {
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
    const lines = (read('crash.1.log') + read(FILE)).split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  }

  // דוח תקלה לשליחה לתמיכה: גרסה, מערכת, והיומן. בלי מסד הנתונים ובלי קבצי הנתונים
  function report({ version = '', platform = process.platform, arch = process.arch, osRelease = os.release(), electron = process.versions.electron || '' } = {}) {
    return [
      'SuperSuite — דוח תקלה',
      `גרסה: ${version}`,
      `נוצר: ${now().toISOString()}`,
      `מערכת: ${platform} ${osRelease} (${arch})${electron ? ' · Electron ' + electron : ''}`,
      'הדוח כולל רק את יומן התקלות. אין בו נתונים מהתוכנה, ומידע אישי הוסר ממנו.',
      '',
      ...tail(),
    ].join('\n') + '\n';
  }

  return { log, tail, report, file, error: (scope, err, extra) => log('error', scope, err, extra), warn: (scope, err, extra) => log('warn', scope, err, extra) };
}

module.exports = { createLogger, redact, FILE, MAX_BYTES };
