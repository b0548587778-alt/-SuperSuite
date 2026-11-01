// גיבויים ישנים לא מוצפנים בתיקיית הגיבוי (PLAN.md 3.6).
// הגיבוי האוטומטי תמיד היה מוצפן, אבל בתיקייה יכולים להיות קבצים גלויים: גיבוי ידני ישן של המודול הכלכלי
// (JSON גלוי לפני התיקון), גיבוי ישן של מודול האימונים (trainer-pro-backup-*.json — המודול עבר ל-SuperSuite לימוד,
// אבל הקובץ נשאר כאן ובו נתוני בריאות גלויים), או auto-*.json.
// סורקים רק את תיקיית הגיבוי (לא את כל המחשב), מציגים אזהרה, ו"הצפנה" כותבת .ssbk, מאמתת, ורק אז מוחקת.
// לעולם לא נמחק קובץ אוטומטית.
const fs = require('fs');
const path = require('path');
const BK = require('../modules/econ/core/backupCrypto');
const Legacy = require('./legacy-modules');

// שמות שהתוכנה נתנה לגיבויים, וכל קובץ .json אחר בתיקייה — אם תוכנו גיבוי (המשתמש בחר שם בחלון השמירה)
const NAME = /^[^\\/:*?"<>|]{1,200}\.json$/;
const MAX_BYTES = 200 * 1024 * 1024; // מעל זה לא קוראים (וגם לא מציעים הצפנה) — גיבוי לא סביר

// הטקסט כגיבוי גלוי: null — לא גיבוי; אחרת { trainer } — האם יש בו נתוני אימונים (נתוני בריאות)
function plainBackupInfo(text) {
  if (typeof text !== 'string' || BK.isEncryptedBackup(text)) return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!((data && data.suite === 'SuperSuite') || isLegacyEconBackup(data) || Legacy.isLegacyTrainerBackup(data))) return null;
  return { trainer: Legacy.hasTrainerData(data) };
}

// האם הטקסט הוא גיבוי גלוי של SuperSuite (או של מודול האימונים שעבר למוצר אחר)
function isPlainBackupText(text) {
  return !!plainBackupInfo(text);
}

// גיבוי ידני ישן של המודול הכלכלי (לפני ההצפנה): אובייקט המסד עצמו — version, organization, settings ואוספים
function isLegacyEconBackup(d) {
  return !!d && typeof d === 'object' && !Array.isArray(d) && !d.suite && 'version' in d && 'settings' in d
    && ('organization' in d || 'records' in d);
}

// זיהוי מהיר לפי תחילת הקובץ — בלי לטעון קבצים גדולים לזיכרון בסריקה
function looksPlain(file, fsx = fs) {
  let fd;
  try {
    fd = fsx.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fsx.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString('utf8').replace(/^﻿/, '').trimStart();
    if (!head.startsWith('{')) return false;
    // גיבוי של SuperSuite מתחיל ב-"suite"; גיבוי אימונים — במפתח של המודול; גיבוי כלכלי ישן — "version" ו-"organization"
    if (/^\{\s*"(suite|trainer:profile|clients:index|studio:|client:|program:|sessions:|measurements:|assessments:|memberships:)/.test(head)) return true;
    return /^\{\s*"version"\s*:/.test(head) && /"(organization|settings)"\s*:/.test(head);
  } catch { return false; }
  finally { if (fd !== undefined) try { fsx.closeSync(fd); } catch { /* נסגר */ } }
}

// בסריקה: זיהוי לפי ההתחלה, ואז אימות מלא (קובץ JSON אחר שנראה דומה — לא מוצג)
function plainFileInfo(file, fsx = fs) {
  if (!looksPlain(file, fsx)) return null;
  try { return plainBackupInfo(fsx.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
function isPlainBackupFile(file, fsx = fs) {
  return !!plainFileInfo(file, fsx);
}

// מחזיר [{ name, size, mtime, trainer }] — רק קבצים בתיקייה עצמה (לא תתי-תיקיות). trainer — יש בו נתוני אימונים
function scan(dir, fsx = fs) {
  if (!dir) return [];
  let names;
  try { names = fsx.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fsx.statSync(file); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const info = plainFileInfo(file, fsx);
    if (info) out.push({ name, size: st.size, mtime: st.mtimeMs, trainer: info.trainer });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// שם קובץ מהמשתמש (מהמעטפת) — רק שם שעובר את התבנית, בלי נתיב
function safeName(name) {
  const n = String(name || '');
  if (n !== path.basename(n) || !NAME.test(n)) throw new Error('שם קובץ לא תקין');
  return n;
}

// הצפנה: .ssbk באותה תיקייה במפתח הגיבוי האוטומטי ← פתיחה ובדיקה שהתוכן זהה ← מחיקת המקור.
// כל כישלון — המקור נשאר. קובץ .ssbk באותו שם שכבר קיים — לא נדרס (מוסיפים מספר).
function encryptFile({ dir, name, key, fsx = fs }) {
  const n = safeName(name);
  const src = path.join(dir, n);
  const text = fsx.readFileSync(src, 'utf8').replace(/^﻿/, '');
  if (!isPlainBackupText(text)) throw new Error('הקובץ אינו גיבוי גלוי של SuperSuite');
  const base = n.replace(/\.json$/, '');
  let dst = path.join(dir, base + '.ssbk');
  for (let i = 2; fsx.existsSync(dst); i++) dst = path.join(dir, `${base}-${i}.ssbk`);
  const tmp = dst + '.tmp';
  try {
    // fsync לפני ההחלפה ולפני מחיקת המקור: בלעדיו, ניתוק חשמל אחרי המחיקה יכול להשאיר .ssbk ריק — ואין מקור
    const fd = fsx.openSync(tmp, 'w');
    try { fsx.writeSync(fd, BK.encryptBackup(text, key), null, 'utf8'); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
    if (BK.decryptBackup(fsx.readFileSync(tmp, 'utf8'), key) !== text) throw new Error('verify');
    fsx.renameSync(tmp, dst);
  } catch (e) {
    try { fsx.rmSync(tmp, { force: true }); } catch { /* אין */ }
    throw new Error('ההצפנה נכשלה — הקובץ המקורי לא נמחק' + (e && e.code ? ` (${e.code})` : ''));
  }
  fsx.unlinkSync(src);
  return { file: path.basename(dst) };
}

function deleteFile({ dir, name, fsx = fs }) {
  const n = safeName(name);
  const src = path.join(dir, n);
  // רק קובץ שבאמת גיבוי גלוי — לא מוחקים קובץ אחר בשם דומה
  if (!isPlainBackupFile(src, fsx)) throw new Error('הקובץ אינו גיבוי גלוי של SuperSuite');
  fsx.unlinkSync(src);
  return { deleted: n };
}

function warningText(list) {
  if (!list || !list.length) return '';
  const base = list.length === 1 ? '⚠ בתיקיית הגיבוי יש קובץ גיבוי אחד לא מוצפן' : `⚠ בתיקיית הגיבוי יש ${list.length} קבצי גיבוי לא מוצפנים`;
  // נתוני האימונים — נתוני בריאות של מתאמנים: אומרים זאת במפורש
  return list.some(f => f && f.trainer) ? base + ', כולל נתוני בריאות של מתאמנים' : base;
}

module.exports = { scan, encryptFile, deleteFile, isPlainBackupText, plainBackupInfo, isPlainBackupFile, isLegacyEconBackup, looksPlain, warningText, safeName, NAME };
