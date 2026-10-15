// לוגיקת הגיבוי האוטומטי היומי — ללא תלות ב-Electron, כדי שתיבדק בבדיקות.
// main.js מזריק את התלויות (safeStorage, איסוף הנתונים, כתיבה) ומקבל סטטוס שנשמר ומוצג במעטפת.
const fs = require('fs');
const path = require('path');

// קריאת מפתח הגיבוי האוטומטי. create=false (בשחזור): לא יוצרים מפתח חדש בשקט —
// מפתח חדש לעולם לא יפענח גיבוי ישן, והשגיאה הייתה מטעה ("הזן סיסמה").
function loadAutoBackupKey({ file, safeStorage, create }) {
  if (!safeStorage.isEncryptionAvailable()) {
    const err = new Error('הצפנת המערכת (DPAPI) אינה זמינה בחשבון זה');
    err.code = 'no-encryption';
    throw err;
  }
  if (fs.existsSync(file)) {
    try { return safeStorage.decryptString(fs.readFileSync(file)); }
    catch {
      const err = new Error('מפתח הגיבוי האוטומטי אינו קריא בחשבון זה (נוצר במחשב או משתמש אחר)');
      err.code = 'key-unreadable';
      throw err;
    }
  }
  if (!create) {
    const err = new Error('אין במחשב הזה מפתח גיבוי אוטומטי — גיבוי אוטומטי ניתן לשחזר רק במחשב ובחשבון שבו נוצר');
    err.code = 'no-key';
    throw err;
  }
  const k = require('crypto').randomBytes(32).toString('base64');
  fs.writeFileSync(file, safeStorage.encryptString(k));
  return k;
}

// תאריך ושעה מקומיים. toISOString הוא UTC: בישראל גיבוי בין חצות ל-03:00 קיבל את התאריך של אתמול,
// והשעה בסטטוס הוצגה מוקדמת בשעתיים-שלוש
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d) => `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayName = (now) => `auto-${localDay(now)}.ssbk`;

// מריץ סבב גיבוי אחד ומחזיר סטטוס { ok, reason?, file?, at, target }.
// customTarget: יעד שהמשתמש בחר (USB) — לעולם לא נוצר אם חסר (כונן לא מחובר).
// defaultTarget: תיקיית המסמכים — נוצרת אם אינה קיימת (בהתקנה חדשה היא לא קיימת).
async function runAutoBackup({ encryptionAvailable, customTarget, defaultTarget, collect, getKey, write, now = new Date() }) {
  const target = customTarget || defaultTarget;
  const at = now.toISOString();
  if (!encryptionAvailable) return { ok: false, reason: 'no-encryption', target, at };
  if (!customTarget) {
    try { fs.mkdirSync(defaultTarget, { recursive: true }); } catch {}
  }
  if (!target || !fs.existsSync(target)) return { ok: false, reason: 'target-missing', target, at };
  // אם הגיבוי של היום כבר קיים — לא אוספים נתונים בכלל (האיסוף טוען את כל המודולים)
  const name = todayName(now);
  if (fs.existsSync(path.join(target, name))) return { ok: true, skipped: true, file: path.join(target, name), target, at };
  const plainText = JSON.stringify(await collect());
  const r = write({ dir: target, plainText, key: getKey(), keep: 14, today: localDay(now) });
  return { ...r, target, at };
}

// טקסט למשתמש עבור סטטוס הגיבוי האחרון
function describeStatus(s) {
  if (!s || !s.at) return '';
  const at = new Date(s.at);
  const when = isNaN(at) ? String(s.at) : localStamp(at);
  if (s.ok) return `גיבוי אחרון הצליח (${when})`;
  const why = {
    'no-encryption': 'הצפנת המערכת אינה זמינה — גיבוי אוטומטי כבוי',
    'target-missing': 'יעד הגיבוי לא נמצא (כונן לא מחובר?)',
    'no-key': 'אין מפתח גיבוי',
    'key-unreadable': 'מפתח הגיבוי אינו קריא בחשבון זה',
    'write-failed': 'הכתיבה ליעד נכשלה (כונן מלא או מוגן מפני כתיבה?)',
    'shabbat': 'נדחה — שבת/יום טוב; יתבצע אחרי הצאת',
    'error': 'שגיאה בגיבוי'
  }[s.reason] || 'הגיבוי לא בוצע';
  return `⚠ ${why} (${when})`;
}

// ---------- קוד שחזור ----------
// מפתח הגיבוי האוטומטי מוגן ב-DPAPI ולכן קריא רק במחשב ובחשבון שבו נוצר. אם המחשב מתקלקל — כל הגיבויים
// האוטומטיים (גם אלה שב-USB) אבודים. קוד השחזור הוא אותו מפתח בכתיב שאפשר לרשום על נייר:
// 32 בתים + 2 בתי ביקורת (SHA-256) ב-Base32 של Crockford — 55 תווים בקבוצות של 5. בלי O/I/L/U, כדי שלא יתבלבלו.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LEN = 55;

function b32encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(text, byteLen) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  // צורה קנונית בלבד: סיביות המילוי בתו האחרון חייבות להיות 0 — אחרת טעות הקלדה בהן הייתה עוברת בשקט
  if (out.length !== byteLen || (value & ((1 << bits) - 1)) !== 0) return null;
  return Buffer.from(out);
}

const checksum = (raw) => require('crypto').createHash('sha256').update(raw).digest().subarray(0, 2);

// מפתח (base64 של 32 בתים) ← קוד להצגה: XXXXX-XXXXX-...
function recoveryCodeFromKey(key) {
  const raw = Buffer.from(String(key), 'base64');
  if (raw.length !== 32) throw new Error('מפתח הגיבוי האוטומטי אינו תקין');
  return b32encode(Buffer.concat([raw, checksum(raw)])).match(/.{1,5}/g).join('-');
}

// ניקוי קלט המשתמש: רווחים ומקפים, אותיות קטנות, ובלבול נפוץ (O→0, I/L→1)
const normalizeCode = (text) => String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

// האם הטקסט נראה כמו קוד שחזור (ולא כמו סיסמת גיבוי רגילה)
function looksLikeRecoveryCode(text) {
  const c = normalizeCode(text);
  return c.length === RECOVERY_LEN && [...c].every(ch => B32.includes(ch));
}

// קוד ← מפתח. שגיאה בעברית אם הקוד שגוי — ספרת הביקורת תופסת טעות הקלדה
function keyFromRecoveryCode(text) {
  const c = normalizeCode(text);
  if (!looksLikeRecoveryCode(c)) throw new Error(`קוד השחזור צריך להכיל ${RECOVERY_LEN} תווים (אותיות באנגלית וספרות)`);
  const all = b32decode(c, 34);
  if (!all || !all.subarray(32).equals(checksum(all.subarray(0, 32)))) throw new Error('קוד השחזור שגוי — בדקו שהוקלד בדיוק כפי שנרשם');
  return all.subarray(0, 32).toString('base64');
}

module.exports = { loadAutoBackupKey, runAutoBackup, describeStatus, localDay, recoveryCodeFromKey, keyFromRecoveryCode, looksLikeRecoveryCode, RECOVERY_LEN };
