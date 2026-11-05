'use strict';
// סקירת קוד 2.11.2026, תכנית ב — המחסן המוצפן של השמאות: תמונות (img_*, casePhoto_*) בקבצים מוצפנים נפרדים
// (secure-shamai-blobs/), עם מכסה משלהן, רשימה בקובץ הראשי, העברה מקובץ ראשי ישן, החלפה בשחזור דרך תיקיית ביניים,
// וקבצים יתומים / חסרים / פגומים. פורמט הגיבוי לא משתנה: snapshot מחזיר את כל הפריטים, גם התמונות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SecureStore = require('../shell/secure-store');
const AR = require('../modules/econ/core/atRest');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r4-blobs-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });

const newKey = () => crypto.randomBytes(32).toString('base64');
const now = (fn) => { fn(); return 0; };
const never = () => 0;
const make = (dir, key, extra = {}) => SecureStore.createSecureStore({ fs, dir, mod: 'shamai', getBackupKey: () => key,
  schedule: now, retrySchedule: () => 0, pause: () => {}, ...extra });
const img = (n, len = 1000) => 'data:image/png;base64,' + String(n).padStart(4, '0') + 'A'.repeat(len);
const IMG = 'shamai_v2_img_opp_1';
const PHOTO = 'shamai_v2_casePhoto_p1';
// הקובץ הראשי, מפוענח
const mainFile = (dir, key) => JSON.parse(AR.createCipher(SecureStore.keyFor(key, 'shamai')).open(fs.readFileSync(path.join(dir, 'secure-shamai.bin'), 'utf8')));
const blobDir = (dir) => path.join(dir, 'secure-shamai-blobs');
const blobFiles = (dir) => (fs.existsSync(blobDir(dir)) ? fs.readdirSync(blobDir(dir)).filter(f => /\.bin$/.test(f)) : []);
// קובץ ראשי מגרסה קודמת (v1): הכול, גם התמונות, ב-items
function writeV1(dir, key, items, migrated = true) {
  const c = AR.createCipher(SecureStore.keyFor(key, 'shamai'));
  fs.writeFileSync(path.join(dir, 'secure-shamai.bin'), c.seal(JSON.stringify({ v: 1, migrated, items })));
}
const fsErr = (code) => Object.assign(new Error(code + ': simulated'), { code });

test('ניתוב: תמונה נכתבת לקובץ מוצפן משלה, לא לקובץ הראשי; הקובץ הראשי מחזיק רק את הרשימה', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key);
  assert.deepEqual(s.write('set', 'shamai_v2_cases', '[]'), { ok: true });
  assert.deepEqual(s.write('set', IMG, img(1)), { ok: true });
  assert.deepEqual(s.write('set', PHOTO, img(2)), { ok: true });
  assert.equal(s.flush(), true);
  const main = mainFile(dir, key);
  assert.equal(main.v, 2);
  assert.deepEqual(Object.keys(main.items), ['shamai_v2_cases'], 'התמונות אינן בקובץ הראשי');
  assert.deepEqual(Object.keys(main.blobs).sort(), [PHOTO, IMG].sort());
  assert.equal(blobFiles(dir).length, 2);
  for (const f of blobFiles(dir)) {
    const raw = fs.readFileSync(path.join(blobDir(dir), f), 'utf8');
    assert.ok(raw.startsWith('SSDB1:'), 'מוצפן');
    assert.ok(!raw.includes('casePhoto') && !raw.includes('img_opp'), 'גם שם המפתח לא גלוי');
  }
  assert.deepEqual(s.dataSnapshot(), { shamai_v2_cases: '[]' });
  assert.equal(s.get(IMG), img(1));
  const again = make(dir, key);
  assert.deepEqual(again.snapshot(), { shamai_v2_cases: '[]', [IMG]: img(1), [PHOTO]: img(2) }, 'snapshot (גיבוי) — כל הפריטים, באותו פורמט');
  assert.deepEqual(again.blobKeys().sort(), [PHOTO, IMG].sort());
  // החלפה ומחיקה
  assert.deepEqual(again.write('set', IMG, img(3)), { ok: true });
  assert.equal(make(dir, key).get(IMG), img(3), 'החלפה נכתבת לקובץ התמונה מיד');
  assert.deepEqual(again.write('remove', PHOTO), { ok: true });
  assert.equal(blobFiles(dir).length, 1, 'הקובץ נמחק אחרי שהקובץ הראשי נכתב');
  assert.deepEqual(make(dir, key).blobKeys(), [IMG]);
});

test('מחיקה: קובץ התמונה נמחק רק אחרי שהקובץ הראשי נכתב בלעדיה (קריסה באמצע לא משאירה רשימה שמפנה לקובץ חסר)', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { schedule: never });
  s.write('set', IMG, img(1));
  assert.equal(s.flush(), true);
  s.write('remove', IMG);
  assert.equal(blobFiles(dir).length, 1, 'לפני כתיבת הקובץ הראשי — הקובץ עדיין קיים');
  assert.equal(make(dir, key).get(IMG), img(1), 'קריסה כאן: המצב הקודם שלם');
  assert.equal(s.flush(), true);
  assert.equal(blobFiles(dir).length, 0);
  // כתיבה מחדש לפני ה-flush מבטלת את המחיקה הממתינה
  s.write('set', IMG, img(2));
  s.flush();
  s.write('remove', IMG);
  s.write('set', IMG, img(4));
  assert.equal(s.flush(), true);
  assert.equal(make(dir, key).get(IMG), img(4));
});

test('מכסות: התמונות לא נספרות בתקרת הקובץ הראשי, ויש להן מכסה משלהן (QuotaExceededError)', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { schedule: never, maxBlobTotal: 5000 });
  assert.deepEqual(s.write('set', IMG, img(1, 2000)), { ok: true });
  assert.deepEqual(s.write('set', PHOTO, img(2, 2000)), { ok: true });
  const r = s.write('set', 'shamai_v2_img_opp_3', img(3, 2000));
  assert.equal(r.reason, 'blob-quota');
  assert.equal(r.name, 'QuotaExceededError');
  assert.match(r.message, /התמונה לא נשמרה/);
  assert.equal(s.get('shamai_v2_img_opp_3'), null);
  assert.deepEqual(s.write('set', IMG, img(1, 2500)), { ok: true }, 'החלפה נספרת בלי הערך הקודם');
  assert.deepEqual(s.write('set', 'shamai_v2_notes', 'x'.repeat(10000)), { ok: true }, 'נתונים רגילים — לא במכסת התמונות');
  assert.equal(s.usage().blobs > 0 && s.usage().data > 0, true);
  // בתקרה האמיתית: נתונים רגילים עד 64MB גם כשיש תמונות מעליהם
  const big = make(tmp(), key, { schedule: never });
  const chunk = 'A'.repeat(SecureStore.MAX_VALUE - 100);
  for (let i = 0; i < 4; i++) assert.equal(big.write('set', 'shamai_v2_img_big' + i, 'data:image/png;base64,' + chunk).ok, true);
  const used = big.usage();
  assert.ok(used.blobs > 16 * 1024 * 1024 && used.data === 0);
  assert.equal(big.write('set', 'shamai_v2_props', 'x'.repeat(SecureStore.MAX_VALUE - 10)).ok, true);
});

test('העברה מקובץ ראשי ישן (v1): התמונות עוברות לקבצים, מאומתות, והקובץ הראשי נכתב בלעדיהן — ופתיחה נוספת לא משנה דבר', () => {
  const dir = tmp(), key = newKey();
  const items = { shamai_v2_cases: '[1]', [IMG]: img(1), [PHOTO]: img(2) };
  writeV1(dir, key, items);
  const s = make(dir, key);
  assert.deepEqual(s.snapshot(), items);
  assert.deepEqual(Object.keys(mainFile(dir, key).items), ['shamai_v2_cases']);
  assert.equal(blobFiles(dir).length, 2);
  const before = fs.readFileSync(path.join(dir, 'secure-shamai.bin'), 'utf8');
  const again = make(dir, key);
  assert.deepEqual(again.snapshot(), items);
  assert.equal(fs.readFileSync(path.join(dir, 'secure-shamai.bin'), 'utf8'), before, 'אידמפוטנטי — לא נכתב שוב');
});

test('העברה שנכשלה בכתיבת קובץ התמונה: התמונה נשארת בקובץ הראשי וזמינה, וההעברה ממשיכה בפתיחה הבאה', () => {
  const dir = tmp(), key = newKey();
  const items = { shamai_v2_cases: '[1]', [IMG]: img(1), [PHOTO]: img(2) };
  writeV1(dir, key, items);
  const errors = [];
  const broken = { ...fs, openSync: (p, f) => { if (String(p).includes('secure-shamai-blobs')) throw fsErr('ENOSPC'); return fs.openSync(p, f); } };
  const s = make(dir, key, { fs: broken, onError: (_s, e) => errors.push(e.code) });
  assert.ok(errors.includes('ENOSPC'));
  assert.equal(s.get(IMG), img(1), 'זמינה מהקובץ הראשי');
  assert.deepEqual(s.snapshot(), items, 'הגיבוי שלם');
  assert.deepEqual(Object.keys(mainFile(dir, key).items).sort(), Object.keys(items).sort(), 'הקובץ הראשי לא השתנה');
  const ok = make(dir, key);
  assert.deepEqual(ok.snapshot(), items);
  assert.deepEqual(Object.keys(mainFile(dir, key).items), ['shamai_v2_cases'], 'בפתיחה הבאה — הועברו');
});

test('קריסה: קובץ תמונה שנכתב לפני שהרשימה נשמרה — מאומץ בפתיחה; כתיבת הקובץ הראשי שנכשלה אחרי ההעברה — חוזרת', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { schedule: never });
  s.write('set', 'shamai_v2_props', '["a"]');
  s.flush();
  assert.deepEqual(s.write('set', IMG, img(7)), { ok: true });
  // "קריסה": הקובץ הראשי לא נכתב אחרי התמונה
  const errors = [];
  const reopened = make(dir, key, { onError: (_s, e) => errors.push(e) });
  assert.equal(reopened.get(IMG), img(7), 'היתום אומץ');
  assert.ok(Object.keys(mainFile(dir, key).blobs).includes(IMG), 'והרשימה נכתבה');
  // העברה מ-v1 שבה כתיבת הקובץ הראשי נכשלה: הקבצים כתובים, הקובץ הראשי הישן עדיין מכיל את התמונות
  const dir2 = tmp();
  writeV1(dir2, key, { [IMG]: img(1), a: '1' });
  const failMain = { ...fs, renameSync: (a, b) => { if (/secure-shamai\.bin\.tmp$/.test(String(a))) throw fsErr('ENOSPC'); return fs.renameSync(a, b); } };
  const half = make(dir2, key, { fs: failMain });
  assert.equal(half.get(IMG), img(1));
  assert.ok(Object.keys(mainFile(dir2, key).items).includes(IMG), 'בדיסק — עדיין בקובץ הראשי');
  const healed = make(dir2, key);
  assert.deepEqual(healed.snapshot(), { [IMG]: img(1), a: '1' });
  assert.deepEqual(Object.keys(mainFile(dir2, key).items), ['a']);
});

test('קובץ תמונה חסר — נמחק מהרשימה בפתיחה; פגום — מועבר הצידה (לא נמחק) והגיבוי ממשיך בלעדיו; קובץ תפוס — הגיבוי נכשל', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key);
  s.write('set', IMG, img(1));
  s.write('set', PHOTO, img(2));
  s.flush();
  fs.rmSync(path.join(blobDir(dir), SecureStore.blobName(IMG)));
  const errors = [];
  const a = make(dir, key, { onError: (_s, e) => errors.push(e.code) });
  assert.ok(errors.includes('blob-missing'));
  assert.deepEqual(a.blobKeys(), [PHOTO]);
  assert.deepEqual(Object.keys(mainFile(dir, key).blobs), [PHOTO]);
  // פגום: קובץ של מפתח אחר במקומו
  fs.writeFileSync(path.join(blobDir(dir), SecureStore.blobName(PHOTO)), 'SSDB1:garbage');
  assert.deepEqual(a.snapshot(), {});
  assert.ok(fs.readdirSync(blobDir(dir)).some(f => f.includes('.unreadable-')), 'הועבר הצידה');
  // תקלה זמנית בקריאה — נזרקת (לא גיבוי חלקי)
  const b = make(tmp(), key, { schedule: now });
  b.write('set', IMG, img(1));
  const busy = { ...fs, readFileSync: (p, o) => { if (String(p).includes('secure-shamai-blobs')) throw fsErr('EBUSY'); return fs.readFileSync(p, o); } };
  const bDir = path.dirname(b.file);
  const c = make(bDir, key, { fs: busy });
  assert.throws(() => c.snapshot(), (e) => e.code === 'EBUSY');
});

test('שחזור (replaceAll): התמונות בתיקיית ביניים, שמחליפה את התיקייה רק אחרי שהקובץ הראשי נכתב; כשל ← המצב הקודם, גם בקבצים', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { schedule: never });
  const before = { a: '1', [IMG]: img(1), [PHOTO]: img(2) };
  for (const [k, v] of Object.entries(before)) s.write('set', k, v);
  assert.equal(s.flush(), true);
  // הכתיבה של הקובץ הראשי נכשלת: בדיסק — המצב שלפני, כולל התמונות
  let failMain = true;
  const ff = { ...fs, renameSync: (a, b) => { if (failMain && /secure-shamai\.bin\.tmp$/.test(String(a))) throw fsErr('ENOSPC'); return fs.renameSync(a, b); } };
  const r = make(dir, key, { fs: ff, schedule: never });
  const restored = { b: '2', [IMG]: img(9), 'shamai_v2_img_new': img(10) };
  assert.deepEqual(r.replaceAll(restored), { ok: true });
  assert.deepEqual(r.snapshot(), restored, 'בזיכרון — המשוחזר (קריאה מתיקיית הביניים)');
  assert.equal(r.flush(), false);
  assert.deepEqual(make(dir, key).snapshot(), before, 'בדיסק — המצב שלפני, והתמונות שלו לא נדרסו');
  assert.ok(!fs.existsSync(blobDir(dir) + '.new'), 'תיקיית ביניים שלא הגיעה לקובץ הראשי — נמחקה בפתיחה');
  // ההחזרה למצב שלפני (כמו applyRestore בכשל) — ואז הדיסק חוזר
  const r2 = make(dir, key, { fs: ff, schedule: never });
  assert.deepEqual(r2.replaceAll(restored), { ok: true });
  assert.equal(r2.flush(), false);
  assert.deepEqual(r2.replaceAll(before), { ok: true }, 'החזרה');
  failMain = false;
  assert.equal(r2.flush(), true);
  assert.deepEqual(make(dir, key).snapshot(), before);
  // הצלחה
  const r3 = make(dir, key, { schedule: never });
  assert.deepEqual(r3.replaceAll(restored), { ok: true });
  assert.equal(r3.flush(), true);
  assert.deepEqual(make(dir, key).snapshot(), restored);
  assert.equal(blobFiles(dir).length, 2, 'רק התמונות של המשוחזר');
  assert.ok(!fs.readdirSync(dir).some(f => f.includes('.old-') || f.endsWith('.new')), 'בלי שאריות');
});

test('שחזור: קריסה אחרי שהקובץ הראשי נכתב ולפני החלפת התיקייה — ההחלפה מושלמת בפתיחה הבאה', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { schedule: never });
  s.write('set', IMG, img(1));
  s.flush();
  // ההחלפה (תיקיית הביניים ← התיקייה) נכשלת
  const ff = { ...fs, renameSync: (a, b) => { if (String(a).endsWith('secure-shamai-blobs.new')) throw fsErr('EPERM'); return fs.renameSync(a, b); } };
  const r = make(dir, key, { fs: ff, schedule: never, onError: () => {} });
  const restored = { [IMG]: img(5), [PHOTO]: img(6) };
  assert.deepEqual(r.replaceAll(restored), { ok: true });
  assert.equal(r.flush(), true, 'הקובץ הראשי נכתב');
  assert.equal(r.get(PHOTO), img(6), 'עד ההחלפה — קוראים מתיקיית הביניים');
  const next = make(dir, key);
  assert.deepEqual(next.snapshot(), restored);
  assert.ok(!fs.existsSync(blobDir(dir) + '.new'));
  assert.ok(!fs.readdirSync(dir).some(f => f.includes('.old-')));
});

test('שחזור שגדול ממכסת התמונות — נדחה בלי שינוי; clear מוחק גם את קבצי התמונות', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key, { maxBlobTotal: 3000 });
  s.write('set', IMG, img(1));
  const r = s.replaceAll({ [IMG]: img(2, 2000), [PHOTO]: img(3, 2000) });
  assert.equal(r.reason, 'blob-quota');
  assert.equal(s.get(IMG), img(1));
  assert.deepEqual(s.write('clear'), { ok: true });
  assert.equal(blobFiles(dir).length, 0);
  assert.deepEqual(make(dir, key).snapshot(), {});
});

test('העברה מ-localStorage הישן: התמונות שבו עוברות לקבצים אחרי שהקובץ הראשי נכתב', () => {
  const dir = tmp(), key = newKey();
  const s = make(dir, key);
  const items = { shamai_v2_props: '[]', [IMG]: img(1) };
  assert.equal(s.migrate(items, () => {}).ok, true);
  assert.deepEqual(make(dir, key).snapshot(), items);
  assert.deepEqual(Object.keys(mainFile(dir, key).items), ['shamai_v2_props']);
  assert.equal(mainFile(dir, key).migrated, true);
});
