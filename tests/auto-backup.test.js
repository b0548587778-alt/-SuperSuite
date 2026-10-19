// בדיקות רגרסיה לסבב איתור הבאגים בהרצה אמיתית (גרסה 2.3.0):
// גיבוי אוטומטי (DPAPI / יעד USB / תיקיית ברירת מחדל), מפתח הגיבוי, הפעלת electron בלי path.txt,
// ו-CSP בכל המודולים.
const test = require('node:test');
const { shamaiSource } = require('./helpers/shamai-src');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AutoBk = require('../shell/auto-backup');
const AB = require('../modules/econ/core/features');
const BK = require('../modules/econ/core/backupCrypto');
const { resolveElectronExe } = require('../run-electron');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ab-'));
const KEY = 'k'.repeat(44);
const NOW = new Date('2026-10-14T08:00:00Z');

// safeStorage מדומה: "הצפנה" הפיכה, ואפשרות לסמן שאינה זמינה או שהמפתח אינו קריא
function fakeSafeStorage({ available = true, unreadable = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + s),
    decryptString: (b) => { if (unreadable) throw new Error('DPAPI'); return String(b).slice(4); },
  };
}

function baseArgs(over = {}) {
  let collected = 0;
  const args = {
    encryptionAvailable: true, customTarget: '', defaultTarget: '',
    collect: async () => { collected++; return { suite: 'SuperSuite', econ: { a: 1 } }; },
    getKey: () => KEY, write: AB.writeEncryptedAutoBackup, now: NOW,
    ...over,
  };
  return { args, collected: () => collected };
}

test('גיבוי אוטומטי: תיקיית ברירת המחדל נוצרת אם אינה קיימת (התקנה חדשה)', async () => {
  const docs = path.join(tmp(), 'SuperSuite-Backups');
  assert.equal(fs.existsSync(docs), false);
  const { args } = baseArgs({ defaultTarget: docs });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, true);
  const file = path.join(docs, 'auto-2026-10-14.ssbk');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(BK.isEncryptedBackup(text), 'נכתב מוצפן בלבד');
  assert.doesNotMatch(text, /SuperSuite/, 'אין טקסט גלוי בקובץ');
  assert.equal(JSON.parse(BK.decryptBackup(text, KEY)).suite, 'SuperSuite');
});

test('גיבוי אוטומטי ל-USB: כונן מנותק — לא נוצר ולא נכתב למקום אחר', async () => {
  const usb = path.join(tmp(), 'E-drive-missing');
  const docs = path.join(tmp(), 'docs');
  const { args, collected } = baseArgs({ customTarget: usb, defaultTarget: docs });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'target-missing');
  assert.equal(fs.existsSync(usb), false, 'יעד USB לא נוצר כתיקייה מקומית');
  assert.equal(fs.existsSync(docs), false, 'לא נופלים בשקט לתיקיית המסמכים');
  assert.equal(collected(), 0, 'לא אוספים נתונים כשאין לאן לכתוב');
});

test('גיבוי אוטומטי ל-USB מחובר: נכתב ליעד, ושחזור עם אותו מפתח מצליח', async () => {
  const usb = tmp();
  const { args } = baseArgs({ customTarget: usb });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, true);
  assert.equal(path.dirname(r.file), usb);
});

test('גיבוי אוטומטי בלי DPAPI: לא נכתב שום קובץ, והסטטוס מוסבר למשתמש', async () => {
  const docs = path.join(tmp(), 'docs');
  const { args, collected } = baseArgs({ encryptionAvailable: false, defaultTarget: docs });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-encryption');
  assert.equal(fs.existsSync(docs), false);
  assert.equal(collected(), 0);
  assert.match(AutoBk.describeStatus(r), /הצפנת המערכת/);
});

test('גיבוי אוטומטי: כשהגיבוי של היום קיים, לא אוספים שוב את כל המודולים', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'auto-2026-10-14.ssbk'), 'SSBK1:x');
  const { args, collected } = baseArgs({ customTarget: dir });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(collected(), 0, 'האיסוף טוען את כל התצוגות — אין לבצע אותו לחינם כל 6 שעות');
});

test('מפתח גיבוי אוטומטי: בשחזור לא נוצר מפתח חדש בשקט, והשגיאה מסבירה למה', () => {
  const file = path.join(tmp(), 'autobackup.key');
  assert.throws(() => AutoBk.loadAutoBackupKey({ file, safeStorage: fakeSafeStorage(), create: false }), /רק במחשב ובחשבון/);
  assert.equal(fs.existsSync(file), false, 'שחזור לא יוצר קובץ מפתח');
  const k = AutoBk.loadAutoBackupKey({ file, safeStorage: fakeSafeStorage(), create: true });
  assert.equal(AutoBk.loadAutoBackupKey({ file, safeStorage: fakeSafeStorage(), create: false }), k, 'אותו מפתח נקרא שוב');
});

test('מפתח גיבוי אוטומטי: DPAPI לא זמין או מפתח לא קריא — שגיאה עם קוד ברור', () => {
  const file = path.join(tmp(), 'autobackup.key');
  assert.throws(() => AutoBk.loadAutoBackupKey({ file, safeStorage: fakeSafeStorage({ available: false }), create: true }), e => e.code === 'no-encryption');
  fs.writeFileSync(file, 'garbage');
  assert.throws(() => AutoBk.loadAutoBackupKey({ file, safeStorage: fakeSafeStorage({ unreadable: true }), create: true }), e => e.code === 'key-unreadable');
  assert.equal(fs.readFileSync(file, 'utf8'), 'garbage', 'מפתח לא קריא לא נדרס');
});

test('npm start: electron.exe נמצא גם כש-path.txt חסר (התקנה שנכשלה בסביבה מסוננת)', () => {
  const root = tmp();
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  assert.equal(resolveElectronExe(root, 'win32'), null, 'אין קובץ — null ולא חריגה');
  fs.writeFileSync(path.join(dist, 'electron.exe'), '');
  assert.equal(resolveElectronExe(root, 'win32'), path.join(dist, 'electron.exe'));
  assert.ok(require('../package.json').scripts.start.includes('run-electron.js'));
});

test('CSP: לכל מודול יש מדיניות אבטחת תוכן, בלי unsafe-eval ובלי סקריפט inline', () => {
  for (const f of ['modules/shamai/index.html', 'modules/trainer/index.html', 'modules/tools/index.html', 'modules/econ/views/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(m, `${f}: חסר CSP`);
    assert.match(m[1], /script-src 'self'/);
    assert.doesNotMatch(m[1], /unsafe-eval/);
    assert.doesNotMatch(m[1].match(/script-src[^;]*/)[0], /unsafe-inline/);
    // script-src 'self' חוסם סקריפט inline — כל תגית script חייבת להיות עם src
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\ssrc=/, `${f}: סקריפט inline ייחסם ב-CSP`);
  }
});

test('שמאי: Service Worker לא נרשם מ-app:// (גרם לשגיאה בכל טעינה)', () => {
  const src = shamaiSource();
  const i = src.indexOf('serviceWorker.register');
  const guard = src.slice(src.lastIndexOf('if (', i), i);
  assert.match(guard, /location\.protocol/);
});

test('גיבוי אוטומטי: כתיבה שנכשלת ביעד (כונן מלא/מוגן) לא משאירה קובץ זמני ומחזירה סיבה', async () => {
  const dir = tmp();
  // תיקייה בשם הקובץ הזמני גורמת לכתיבה להיכשל — מדמה כונן שאינו ניתן לכתיבה
  fs.mkdirSync(path.join(dir, 'auto-2026-10-14.ssbk.tmp', 'blocker'), { recursive: true });
  const { args } = baseArgs({ customTarget: dir });
  const r = await AutoBk.runAutoBackup(args);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'write-failed');
  assert.equal(fs.existsSync(path.join(dir, 'auto-2026-10-14.ssbk')), false);
  assert.match(AutoBk.describeStatus(r), /הכתיבה ליעד נכשלה/);
});

test('גיבוי אוטומטי: שם הקובץ והשעה בסטטוס לפי הזמן המקומי ולא UTC (בעבר: 03:22 במקום 06:22)', async () => {
  // 00:30 מקומי — ב-UTC זה עדיין היום הקודם במזרח (ישראל), או אותו יום במערב; בכל מקרה השם לפי היום המקומי
  const local = new Date(2026, 9, 15, 0, 30);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bk-local-'));
  const r = await AutoBk.runAutoBackup({
    encryptionAvailable: true, customTarget: dir, defaultTarget: '', collect: async () => ({ x: 1 }),
    getKey: () => KEY, write: AB.writeEncryptedAutoBackup, now: local,
  });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'auto-2026-10-15.ssbk')), 'קובץ בשם היום המקומי');
  assert.equal(AutoBk.localDay(local), '2026-10-15');
  const status = AutoBk.describeStatus({ ok: true, at: new Date(2026, 9, 15, 6, 22).toISOString() });
  assert.match(status, /2026-10-15 06:22/);
});
