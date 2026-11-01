'use strict';
// בדיקת קוד, סבב 2 — שלמות הנתונים במחסן המוצפן, בשחזור ובשמירה לקובץ:
// 1. כתיבה של המחסן לדיסק שנכשלה (EPERM/EBUSY מאנטי-וירוס, כונן מלא) לא תוזמנה לניסיון חוזר — הניסיון הבא היה רק
//    בכתיבה הבאה מהעמוד או ביציאה מסודרת, וקריסה בינתיים איבדה נתונים שכבר אושרו כ"נשמרו". וגם: applyRestore התעלם
//    מתוצאת flush — "השחזור הושלם" כשהמחסן לא נכתב לדיסק (וגם בהחזרה למצב שלפני).
// 2. שחזור למודול שהמחסן שלו מוצפן אבל הנתונים הישנים עוד לא הועברו (ההעברה נכשלה — כונן הגיבוי לא מחובר): העמוד
//    המשיך לעבוד על ה-localStorage הישן, הציג את הנתונים הישנים אחרי "השחזור הושלם", וההעברה הבאה ("המחסן גובר")
//    מחקה בשקט עריכות שנעשו אחרי השחזור.
// 3. העברה שנכשלה בכתיבה לדיסק השאירה בזיכרון את העותק הישן שמוזג (ממתין לכתיבה) — הוא נכתב ביציאה בלי סימון
//    "הועבר", וההעברה הבאה העדיפה אותו על עריכות חדשות.
// 4. שמירה לקובץ (handleSave ב-ipc.js — ייצוא, גיבוי מנהל-העל) כתבה ישירות לקובץ היעד: כתיבה שנקטעה הרסה את הקודם.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SecureStore = require('../shell/secure-store');
const AutoBk = require('../shell/auto-backup');
const BK = require('../modules/econ/core/backupCrypto');
const { createMainHarness } = require('./helpers/secure-store-main');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-integrity-r2-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* קובץ פתוח */ } } });

const newKey = () => crypto.randomBytes(32).toString('base64');
const fsErr = (code) => Object.assign(new Error(code + ': simulated'), { code });
// fs שבו ההחלפה של הקובץ הזמני נכשלת לפי failFor(נתיב) ← שגיאה או false
const flaky = (failFor) => ({ ...fs, renameSync: (a, b) => { const e = failFor(String(a)); if (e) throw e; return fs.renameSync(a, b); } });
// טיימר ידני לניסיון החוזר: הבדיקה מפעילה אותו בעצמה
const manualTimers = () => { const q = []; const s = (fn, ms) => { const t = { fn, ms }; q.push(t); return t; }; s.q = q; return s; };
const now = (fn) => { fn(); return 0; };
const store = (dir, key, extra = {}) => SecureStore.createSecureStore({ fs, dir, mod: 'shamai', getBackupKey: () => key, schedule: now,
  retrySchedule: manualTimers(), pause: () => {}, ...extra });
const tmpLeft = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

/* ================= 1. ניסיון חוזר אחרי כשל בדיסק ================= */

test('1: כתיבה לדיסק שנכשלה — ניסיון חוזר מתוזמן מעצמו, והנתונים מגיעים לקובץ בלי כתיבה נוספת מהעמוד', () => {
  const dir = tmp();
  const key = newKey();
  let broken = true;
  const errors = [];
  const retry = manualTimers();
  const s = store(dir, key, { fs: flaky(() => broken && fsErr('ENOSPC')), retrySchedule: retry, onError: (_s, e) => errors.push(e.code) });
  assert.deepEqual(s.write('set', 'shamai_v2_props', '["טבעת זהב"]'), { ok: true }, 'הכתיבה התקבלה — הדיסק נכשל רק בשמירה עצמה');
  assert.deepEqual(errors, ['ENOSPC']);
  assert.equal(retry.q.length, 1, 'ניסיון חוזר תוזמן — לא מחכים לכתיבה הבאה או ליציאה');
  assert.equal(retry.q[0].ms, SecureStore.FLUSH_RETRY_MS);
  assert.ok(!fs.existsSync(path.join(dir, 'secure-shamai.bin')));
  assert.deepEqual(tmpLeft(dir), [], 'הקובץ הזמני נמחק');
  // עדיין נכשל: עוד ניסיון אחד בכל פעם
  retry.q.shift().fn();
  assert.equal(retry.q.length, 1);
  assert.equal(errors.length, 2);
  // הדיסק חזר — הניסיון החוזר כותב, בלי שום פעולה של העמוד
  broken = false;
  retry.q.shift().fn();
  assert.equal(retry.q.length, 0, 'אחרי הצלחה — אין עוד ניסיון');
  assert.deepEqual(store(dir, key).snapshot(), { shamai_v2_props: '["טבעת זהב"]' });
  assert.deepEqual(s.write('set', 'shamai_v2_cases', '[]'), { ok: true }, 'וכתיבות מתקבלות שוב');
});

test('1: קובץ תפוס לרגע (EBUSY / EPERM / EACCES) — עוד ניסיונות מיד; כשל אחר — ניסיון אחד, בלי השהיה', () => {
  // תפוס פעמיים ואז פנוי: נשמר באותה קריאה, בלי שגיאה ביומן ובלי ניסיון חוזר
  {
    const dir = tmp();
    const key = newKey();
    let fails = 2;
    const pauses = [], errors = [];
    const retry = manualTimers();
    const s = store(dir, key, { fs: flaky(() => (fails-- > 0 ? fsErr('EBUSY') : null)), pause: (ms) => pauses.push(ms), retrySchedule: retry, onError: (_s, e) => errors.push(e) });
    assert.deepEqual(s.write('set', 'a', '1'), { ok: true });
    assert.equal(s.flush(), true);
    assert.equal(pauses.length, 2, 'שתי השהיות קצרות');
    assert.ok(pauses.every((ms) => ms > 0 && ms <= 100), JSON.stringify(pauses));
    assert.deepEqual(errors, []);
    assert.equal(retry.q.length, 0);
    assert.deepEqual(store(dir, key).snapshot(), { a: '1' });
  }
  // תפוס כל הזמן: FLUSH_ATTEMPTS ניסיונות, שגיאה אחת ביומן, וניסיון חוזר
  for (const code of ['EPERM', 'EACCES']) {
    const dir = tmp();
    let renames = 0;
    const errors = [];
    const retry = manualTimers();
    const s = store(dir, newKey(), { fs: flaky(() => { renames++; return fsErr(code); }), retrySchedule: retry, onError: (_s, e) => errors.push(e.code) });
    s.write('set', 'a', '1');
    assert.equal(renames, SecureStore.FLUSH_ATTEMPTS, code);
    assert.deepEqual(errors, [code]);
    assert.equal(retry.q.length, 1);
    assert.deepEqual(tmpLeft(dir), []);
    assert.equal(s.write('set', 'b', '2').reason, 'disk', 'הדיסק עדיין נכשל — הכתיבה הבאה נדחית');
  }
  // כונן מלא: אין טעם לנסות מיד
  {
    let renames = 0;
    const pauses = [];
    const s = store(tmp(), newKey(), { fs: flaky(() => { renames++; return fsErr('ENOSPC'); }), pause: (ms) => pauses.push(ms) });
    s.write('set', 'a', '1');
    assert.equal(renames, 1);
    assert.deepEqual(pauses, []);
  }
});

/* ================= 3. העברה שנכשלה בכתיבה ================= */

test('3: העברה שנכשלה בכתיבה לדיסק — המחסן חוזר בדיוק למצב שלפני, והעברה מאוחרת יותר לוקחת את הערכים החדשים', () => {
  const dir = tmp();
  const key = newKey();
  let broken = true;
  const retry = manualTimers();
  const s = store(dir, key, { fs: flaky(() => broken && fsErr('ENOSPC')), retrySchedule: retry });
  const backups = [];
  assert.deepEqual(s.migrate({ shamai_v2_props: '["ישן"]', shamai_v2_notes: 'הערה' }, (items) => backups.push(items)), { ok: false, reason: 'write-failed' });
  assert.equal(backups.length, 1);
  assert.equal(s.migrated, false);
  assert.deepEqual(s.snapshot(), {}, 'העותק הישן לא נשאר בזיכרון');
  // הדיסק חזר (ניסיון חוזר / יציאה מסודרת): לא נכתב שום עותק ישן לקובץ
  broken = false;
  for (const t of retry.q.splice(0)) t.fn();
  assert.equal(s.flush(), true);
  assert.deepEqual(store(dir, key).snapshot(), {}, 'בקובץ אין עותק ישן שיגבר בהעברה הבאה');
  // בינתיים העמוד (על ה-localStorage הישן) ערך את הנתונים — ההעברה הבאה לוקחת את הערכים החדשים
  assert.deepEqual(s.migrate({ shamai_v2_props: '["ערוך אחרי הכשל"]', shamai_v2_notes: 'הערה' }, () => {}), { ok: true, count: 2 });
  assert.deepEqual(store(dir, key).snapshot(), { shamai_v2_props: '["ערוך אחרי הכשל"]', shamai_v2_notes: 'הערה' });
});

test('3: העברה שנכשלה כשבמחסן כבר היה שינוי שממתין לכתיבה — השינוי נשאר (ונכתב), בלי סימון "הועבר"', () => {
  const dir = tmp();
  const key = newKey();
  let broken = false;
  const retry = manualTimers();
  const s = store(dir, key, { fs: flaky(() => broken && fsErr('ENOSPC')), schedule: () => 0, retrySchedule: retry });
  assert.equal(s.set('shamai_v2_prices', 'ממתין'), true); // לא נכתב עדיין (הכתיבה המתוזמנת לא רצה)
  broken = true;
  assert.equal(s.migrate({ shamai_v2_props: '["ישן"]' }, () => {}).ok, false);
  assert.deepEqual(s.snapshot(), { shamai_v2_prices: 'ממתין' });
  broken = false;
  retry.q.shift().fn();
  const again = store(dir, key);
  assert.deepEqual(again.snapshot(), { shamai_v2_prices: 'ממתין' }, 'מה שהמתין — בקובץ; הישן — לא');
  assert.equal(again.migrated, false, 'ההעברה תרוץ שוב בפתיחה הבאה');
});

/* ================= markMigrated ו-replaceAll (בשביל השחזור) ================= */

test('2: markMigrated — נכתב לקובץ מיד; כשל ← חוזר ל"לא הועבר", והניסיון החוזר כותב בלי הסימון', () => {
  const dir = tmp();
  const key = newKey();
  let broken = false;
  const retry = manualTimers();
  const s = store(dir, key, { fs: flaky(() => broken && fsErr('ENOSPC')), schedule: () => 0, retrySchedule: retry });
  assert.deepEqual(s.replaceAll({ shamai_v2_props: '["משוחזר"]' }), { ok: true });
  broken = true;
  assert.equal(s.markMigrated(), false);
  assert.equal(s.migrated, false);
  broken = false;
  retry.q.shift().fn();
  assert.equal(store(dir, key).migrated, false, 'כשל ← לא נכתב "הועבר"');
  assert.deepEqual(store(dir, key).snapshot(), { shamai_v2_props: '["משוחזר"]' });
  assert.equal(s.markMigrated(), true);
  assert.equal(store(dir, key).migrated, true);
  assert.deepEqual(s.migrate({ shamai_v2_props: '["ישן"]' }, () => { throw new Error('לא אמור לרוץ'); }), { ok: true, already: true });
  const locked = store(tmp(), null, { getBackupKey: () => { throw new Error('אין DPAPI'); } });
  assert.equal(locked.markMigrated(), false);
});

test('2: replaceAll — החלפה בזיכרון בבת אחת; דחייה לא משנה דבר, ואין כתיבה של מחסן חלקי לקובץ', () => {
  const dir = tmp();
  const key = newKey();
  let renames = 0;
  const s = store(dir, key, { schedule: () => 0, fs: { ...flaky(() => null), renameSync: (a, b) => { renames++; return fs.renameSync(a, b); } } });
  s.replaceAll({ a: '1', b: '2' });
  assert.equal(renames, 0, 'בלי כתיבה באמצע — רק ב-flush');
  assert.equal(s.flush(), true);
  assert.equal(s.replaceAll({ a: 'x'.repeat(SecureStore.MAX_VALUE + 1) }).name, 'QuotaExceededError');
  assert.equal(s.replaceAll({ a: 5 }).reason, 'invalid');
  assert.deepEqual(s.snapshot(), { a: '1', b: '2' }, 'דחייה — הנתונים לא השתנו');
  assert.deepEqual(s.replaceAll({ c: '3' }), { ok: true });
  assert.deepEqual(s.snapshot(), { c: '3' });
});

/* ================= main.js האמיתי: שחזור למחסן ================= */

const H = createMainHarness({ encryption: true });
const STUB = '/__electron_stub_secure_store_main__.js';
const electron = () => require.cache[STUB].exports;
const PASS = 'sismat-gibui-aruka-2026';
let seq = 0;
// שחזור מהמעטפת מקובץ גיבוי מוצפן (חלון האישור — "שחזר")
async function restoreFrom(payload) {
  const file = path.join(H.userData, `restore-${++seq}.ssbk`);
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, createdAt: new Date().toISOString(), econ: null, ...payload }), PASS));
  const d = electron().dialog;
  const orig = d.showOpenDialog;
  d.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  H.dialogPlan.log.length = 0;
  try { return await H.handlers['shell:restore-all'](H.shellSender(), PASS); } finally { d.showOpenDialog = orig; }
}
// המחסן כפי שהוא בקובץ (ולא בזיכרון של התהליך הראשי)
const onDisk = (mod) => SecureStore.createSecureStore({ fs, dir: H.userData, mod, schedule: () => null,
  getBackupKey: () => AutoBk.loadAutoBackupKey({ file: path.join(H.userData, 'autobackup.key'), safeStorage: electron().safeStorage, create: false }) });
const loadStore = (mod) => H.ipcSync(H.modView(mod), 'secure-store:load', mod);
// כונן הגיבוי לא מחובר: הגיבוי שלפני ההעברה נכשל, ולכן ההעברה נכשלת והעמוד נשאר על ה-localStorage הישן
function unplugBackupDrive() {
  const settings = path.join(H.userData, 'backup-settings.json');
  const orig = fs.readFileSync(settings, 'utf8');
  const blocker = path.join(H.userData, 'usb-missing.txt');
  fs.writeFileSync(blocker, 'x');
  fs.writeFileSync(settings, JSON.stringify({ targetDir: path.join(blocker, 'SuperSuite-Backups') }));
  return () => fs.writeFileSync(settings, orig);
}
// ההחלפה של הקובץ הזמני של המחסן נכשלת count פעמים (כונן מלא — בלי ניסיונות מיידיים)
function failStoreWrites(mod, count = Infinity) {
  const real = fs.renameSync;
  const re = new RegExp(`secure-${mod}\\.bin\\.tmp$`);
  fs.renameSync = (a, b) => { if (re.test(String(a)) && count-- > 0) throw fsErr('ENOSPC'); return real(a, b); };
  return () => { fs.renameSync = real; };
}

test('2 (main.js): שחזור למודול שהנתונים הישנים שלו עוד לא הועברו — העמוד מציג את המשוחזר, והישן נמחק רק אחרי שהמחסן נכתב', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const replug = unplugBackupDrive();
  try {
    const p = H.runPreload('shamai', { shamai_v2_props: '["ישן"]', shamai_v2_notes: 'רק בישן' });
    assert.equal(loadStore('shamai').migrated, false, 'ההעברה נכשלה (אין גיבוי לפניה)');
    assert.equal(p.legacyMem.size, 2, 'הישן לא נמחק');
    p.run(`localStorage.setItem('shamai_v2_props', '["ישן ערוך"]')`);
    assert.equal(p.legacyMem.get('shamai_v2_props'), '["ישן ערוך"]', 'העמוד עובד על ה-localStorage הישן');

    assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: { shamai_v2_props: '["משוחזר"]' } } }), { ok: true }, H.dialogPlan.log.join(' | '));
    assert.ok(H.dialogPlan.log.includes('השחזור הושלם'));
    const st = loadStore('shamai');
    assert.equal(st.migrated, true, 'המחסן מסומן "הועבר"');
    assert.deepEqual(st.data, { shamai_v2_props: '["משוחזר"]' });
    assert.equal(onDisk('shamai').migrated, true, 'הסימון בקובץ');
    assert.deepEqual(onDisk('shamai').snapshot(), { shamai_v2_props: '["משוחזר"]' });
    assert.equal(p.legacyMem.size, 0, 'ה-localStorage הישן נמחק');
    // העמוד הישן (לפני הטעינה מחדש) לא כותב יותר ל-localStorage הישן
    assert.throws(() => p.run(`localStorage.setItem('shamai_v2_props', '["מהעמוד הישן"]')`), (e) => e.name === 'SecurityError');
    assert.equal(p.legacyMem.size, 0);

    // הטעינה מחדש: הנתונים המשוחזרים — גם כשכונן הגיבוי עדיין לא מחובר (אין עוד העברה)
    const bkBefore = fs.existsSync(path.join(H.userData, 'bk')) ? fs.readdirSync(path.join(H.userData, 'bk')).length : 0;
    const p2 = H.runPreload('shamai');
    assert.equal(p2.run(`localStorage.getItem('shamai_v2_props')`), '["משוחזר"]', 'לא הנתונים הישנים אחרי "השחזור הושלם"');
    assert.equal(p2.run(`localStorage.getItem('shamai_v2_notes')`), null, 'מפתח שהיה רק בישן לא חוזר');
    // עריכה אחרי השחזור נשמרת — ושום העברה מאוחרת לא דורסת אותה
    p2.run(`localStorage.setItem('shamai_v2_props', '["ערוך אחרי השחזור"]')`);
    replug();
    H.runPreload('shamai');
    assert.equal(loadStore('shamai').data.shamai_v2_props, '["ערוך אחרי השחזור"]');
    const bkAfter = fs.existsSync(path.join(H.userData, 'bk')) ? fs.readdirSync(path.join(H.userData, 'bk')).length : 0;
    assert.equal(bkAfter, bkBefore, 'לא רצה העברה נוספת');
  } finally { replug(); }
});

// 1+2 (המחסן לא נכתב בשחזור לפני העברה) — ב-tests/audit-integrity-r2-legacy.test.js: צריך מחסן שעוד לא הועבר, בתהליך משלו

test('1 (main.js): המחסן לא נכתב לדיסק בשחזור — לא "השחזור הושלם", והמחסן (בזיכרון ובקובץ) חוזר למצב שלפני', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const p = H.runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_props', '["לפני השחזור"]')`);
  assert.equal(p.run(`(localStorage.removeItem('\\u0000ss-flush'), 'ok')`), 'ok', 'בקובץ');
  const before = loadStore('shamai').data;
  assert.equal(loadStore('shamai').migrated, true);

  // הכתיבה של השחזור נכשלת, ההחזרה מצליחה
  let restore = failStoreWrites('shamai', 1);
  try { assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: { shamai_v2_props: '["מהגיבוי"]' } } }), { ok: false }); }
  finally { restore(); }
  assert.ok(!H.dialogPlan.log.includes('השחזור הושלם'), 'בעבר: "השחזור הושלם" כשהמחסן לא נכתב לדיסק');
  assert.ok(H.dialogPlan.log.some((m) => /לא ניתן היה לשמור בדיסק את נתוני השמאות/.test(m) && /הוחזרו למצב שלפני השחזור/.test(m)), H.dialogPlan.log.join(' | '));
  assert.deepEqual(loadStore('shamai').data, before);
  assert.deepEqual(onDisk('shamai').snapshot(), before);

  // גם ההחזרה נכשלת: הודעה על כך — והקובץ לא נגע (המצב שלפני), והזיכרון כמו הקובץ
  restore = failStoreWrites('shamai');
  try {
    assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: { shamai_v2_props: '["מהגיבוי"]' } } }), { ok: false });
    assert.ok(H.dialogPlan.log.some((m) => /גם ההחזרה למצב הקודם נכשלה/.test(m)), H.dialogPlan.log.join(' | '));
    assert.deepEqual(onDisk('shamai').snapshot(), before);
    assert.deepEqual(loadStore('shamai').data, before);
  } finally { restore(); }
  // הדיסק חזר: הכתיבה הבאה כותבת קודם את מה שממתין
  assert.equal(H.ipcSync(H.modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_cases', '[]').ok, true);
  assert.equal(H.ipcSync(H.modView('shamai'), 'secure-store:write', 'shamai', 'flush').ok, true);
  assert.deepEqual(onDisk('shamai').snapshot(), { ...before, shamai_v2_cases: '[]' });
});

/* ================= 4. שמירה לקובץ ב-ipc.js (handleSave) ================= */

test('4: שמירה לקובץ — קובץ זמני, fsync והחלפה; כתיבה שנקטעה לא הורסת את הקובץ הקודם באותו שם', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const dir = tmp();
  const target = path.join(dir, 'גיבוי-מנהל-העל.csv');
  fs.writeFileSync(target, 'הקובץ הקודם');
  H.dialogPlan.save = { canceled: false, filePath: target };
  const orig = { openSync: fs.openSync, writeFileSync: fs.writeFileSync, fsyncSync: fs.fsyncSync, renameSync: fs.renameSync };
  const fdPath = new Map();
  const ofTarget = (f) => String(typeof f === 'number' ? fdPath.get(f) : f).startsWith(target);
  const order = [];
  let cut = false; // כתיבה שנקטעת באמצע (דיסק-און-קי נותק)
  fs.openSync = function (p, ...rest) { const fd = orig.openSync.call(fs, p, ...rest); fdPath.set(fd, String(p)); if (ofTarget(p)) order.push(['open', path.basename(String(p))]); return fd; };
  fs.writeFileSync = function (f, data, ...rest) {
    if (ofTarget(f)) {
      order.push(['write', typeof f === 'number' ? 'fd' : path.basename(String(f))]);
      if (cut) { orig.writeFileSync.call(fs, f, Buffer.from(String(data)).subarray(0, 5), ...rest); throw fsErr('EIO'); }
    }
    return orig.writeFileSync.call(fs, f, data, ...rest);
  };
  fs.fsyncSync = function (fd) { if (ofTarget(fd)) order.push(['fsync']); return orig.fsyncSync.call(fs, fd); };
  fs.renameSync = function (a, b) { if (ofTarget(a)) order.push(['rename', path.basename(String(a)), path.basename(String(b))]); return orig.renameSync.call(fs, a, b); };
  try {
    const r = await H.handlers['ports:exportTemplate'](H.econ(), 'contacts');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.path, target);
    const name = path.basename(target);
    assert.deepEqual(order, [['open', name + '.tmp'], ['write', 'fd'], ['fsync'], ['rename', name + '.tmp', name]], 'בלי כתיבה ישירה לקובץ היעד');
    const first = fs.readFileSync(target, 'utf8');
    assert.match(first, /שם/);
    // שמירה חוזרת באותו שם שנקטעת באמצע: הקובץ הקודם שלם, בלי קובץ זמני, והודעה בעברית
    cut = true;
    await assert.rejects(H.handlers['ports:exportTemplate'](H.econ(), 'contacts'), (e) => /שמירת הקובץ נכשלה/.test(e.message) && /לא נפגע/.test(e.message) && /EIO/.test(e.message));
    assert.equal(fs.readFileSync(target, 'utf8'), first, 'הקובץ הקודם לא נהרס');
    assert.deepEqual(tmpLeft(dir), []);
  } finally {
    Object.assign(fs, orig);
    H.dialogPlan.save = { canceled: true };
  }
});

test('4: שמירה לקובץ באנדרואיד (בלי openSync / fsyncSync) — כתיבה דרך הגשר כמו קודם', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  const fn = /function writeFileDurable\(file, body, encoding\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'writeFileDurable קיים');
  assert.match(/function handleSave[\s\S]*?\n\}/.exec(src)[0], /writeFileDurable\(file, body, spec\.encoding\)/);
  // מריצים את הפונקציה עצמה מול fs של אנדרואיד (רק writeFileSync)
  const writes = [];
  const androidFs = { writeFileSync: (f, d, e) => writes.push([f, d, e]), renameSync: () => undefined, rmSync: () => undefined };
  const run = new Function('fs', 'errorLogger', fn[0] + '\nreturn writeFileDurable;')(androidFs, () => {});
  run('קובץ.csv', 'תוכן', 'utf8');
  assert.deepEqual(writes, [['קובץ.csv', 'תוכן', 'utf8']]);
});
