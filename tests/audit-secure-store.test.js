// בדיקת קוד 23.10.2026 — המחסן המוצפן של שמאי ואימונים:
// ממצא 3: כתיבה שנדחתה (אין כניסה, אין מקום, הדיסק נכשל) נבלעה בשקט, המסך הציג "נשמר", ותמונה ישנה נמחקה מ-IndexedDB
//         לפני שהשמירה אושרה. עכשיו כל כתיבה מקבלת תשובה, ודחייה נזרקת בעמוד כמו localStorage אמיתי.
// ממצא 24: צופה ורואה חשבון יכלו לשנות נתוני שמאות ואימונים — עכשיו כתיבה דורשת data.edit (ורישיון שמאפשר עבודה).
// ממצא 37: רק מקלדת נחשבה פעילות — עבודה בעכבר בלבד נותקה אחרי 15 דקות.
// נמוך: הערוצים וה-preload לא הורצו באף בדיקה — כאן main.js האמיתי (Electron מדומה) וה-preload עצמו רצים יחד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SecureStore = require('../shell/secure-store');
const { loadShamai } = require('./helpers/shamai-src');
// הרתמה מחליפה את setTimeout הגלובלי בטיימר unref — כשכל ההמתנות unref, ב-Node 22 לולאת האירועים מסתיימת
// והבדיקות הממתינות מבוטלות (CI #64). ההמתנות של הבדיקות עצמן — בטיימר האמיתי
const realSetTimeout = setTimeout;
const { createMainHarness } = require('./helpers/secure-store-main');

const ROOT = path.join(__dirname, '..');
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-store-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* המסד פתוח */ } } });

// ---------- המחסן עצמו: תשובה לכל כתיבה ----------
const newKey = () => crypto.randomBytes(32).toString('base64');
const make = (dir, extra = {}) => SecureStore.createSecureStore({ fs, dir, mod: 'shamai', getBackupKey: () => extra.key || newKey(), schedule: (fn) => { fn(); return 0; }, ...extra });

test('ממצא 3: write מחזיר סיבה והודעה בעברית לכל דחייה, ושם שגיאה כמו בדפדפן', () => {
  const s = make(tmp());
  assert.deepEqual(s.write('set', 'a', '1'), { ok: true });
  const big = s.write('set', 'b', 'x'.repeat(SecureStore.MAX_VALUE + 1));
  assert.equal(big.ok, false);
  assert.equal(big.reason, 'too-large');
  assert.equal(big.name, 'QuotaExceededError');
  assert.match(big.message, /^השינוי לא נשמר/);
  assert.equal(s.write('set', 'c', 5).reason, 'invalid');
  assert.equal(s.write('set', 'c', 5).name, 'SecurityError');
  assert.equal(s.write('evil', 'a').reason, 'invalid');
  assert.deepEqual(s.write('remove', 'not-there'), { ok: true }, 'מחיקה של מפתח חסר — מאושרת (מותר לכתוב)');
  assert.deepEqual(s.snapshot(), { a: '1' }, 'כתיבה שנדחתה לא נשארת בזיכרון');
  const locked = make(tmp(), { getBackupKey: () => { throw new Error('אין DPAPI'); } });
  assert.equal(locked.write('set', 'a', '1').reason, 'unavailable');
});

test('ממצא 3: מחסן מלא — הכתיבה נדחית כ-QuotaExceededError והערך הקודם נשאר', () => {
  const s = make(tmp(), { schedule: () => 0 }); // בלי כתיבה לקובץ — רק החשבון בזיכרון
  const chunk = 'x'.repeat(SecureStore.MAX_VALUE - 10);
  let i = 0;
  let r;
  while ((r = s.write('set', 'k' + i, chunk)).ok) i++;
  assert.ok(i >= 12 && i <= 13, 'עד 64M תווים');
  assert.equal(r.reason, 'quota');
  assert.equal(r.name, 'QuotaExceededError');
  assert.ok(!('k' + i in s.snapshot()));
  assert.deepEqual(s.write('set', 'small', 'a'), { ok: true });
  const used = Object.entries(s.snapshot()).reduce((n, [k, v]) => n + k.length + v.length, 0);
  assert.equal(s.write('set', 'small', 'a'.repeat(64 * 1024 * 1024 - used + 2)).reason, 'quota', 'החלפה שחורגת — נדחית');
  assert.equal(s.snapshot().small, 'a', 'הערך הקודם נשמר');
});

test('ממצא 3: הכתיבה לדיסק נכשלה — הכתיבה הבאה נדחית עד שהקובץ נכתב שוב, ואז חוזרת לעבוד', () => {
  const dir = tmp();
  const key = newKey();
  let broken = true;
  const flaky = { ...fs, renameSync: (a, b) => { if (broken) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.renameSync(a, b); } };
  const errors = [];
  const s = make(dir, { key, fs: flaky, onError: (_s, e) => errors.push(e) });
  assert.deepEqual(s.write('set', 'a', '1'), { ok: true }, 'הכתיבה הראשונה התקבלה (הדיסק נכשל רק בשמירה עצמה)');
  assert.equal(errors.length, 1);
  const r = s.write('set', 'b', '2');
  assert.equal(r.reason, 'disk');
  assert.match(r.message, /דיסק/);
  assert.equal(s.flush(), false, 'flush מדווח שהנתונים לא בקובץ');
  broken = false;
  assert.deepEqual(s.write('set', 'b', '2'), { ok: true });
  assert.equal(s.flush(), true);
  assert.deepEqual(make(dir, { key }).snapshot(), { a: '1', b: '2' }, 'הכול הגיע לקובץ');
});

// ---------- main.js האמיתי עם Electron מדומה, וה-preload עצמו (tests/helpers/secure-store-main.js) ----------
const H = createMainHarness({ encryption: true });
const { handlers, onHandlers, boot, loginAs, ipcSync, runPreload, econView, modView, econ, ADMIN } = H;

test('preload + main.js: העברה מהאחסון הישן, וכתיבה של מנהל מגיעה למחסן', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai', { shamai_v2_props: '["ישן"]' });
  assert.equal(p.legacyMem.size, 0, 'הישן נמחק רק אחרי העברה מוצלחת');
  assert.equal(p.run(`localStorage.getItem('shamai_v2_props')`), '["ישן"]');
  p.run(`localStorage.setItem('shamai_v2_cases', '[1]')`);
  p.run(`localStorage.removeItem('shamai_v2_props')`);
  const snap = ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data;
  assert.equal(snap.shamai_v2_cases, '[1]');
  assert.ok(!('shamai_v2_props' in snap));
  assert.ok(fs.readdirSync(path.join(H.userData, 'bk')).some(f => /^before-encryption-shamai-/.test(f)), 'גיבוי מוצפן לפני ההעברה');
});

test('ממצא 24: צופה ורואה חשבון — הכתיבה נדחית בעמוד (SecurityError בעברית) והנתונים לא משתנים', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_prices', 'מקורי')`);
  for (const who of ['tzofe', 'roeh_cheshbon']) {
    await loginAs(who);
    const err = p.run(`(() => { try { localStorage.setItem('shamai_v2_prices', 'זדוני'); return null; } catch (e) { return { name: e.name, message: e.message }; } })()`);
    assert.equal(err && err.name, 'SecurityError', who);
    assert.match(err.message, /צפייה בלבד/);
    assert.equal(p.run(`localStorage.getItem('shamai_v2_prices')`), 'מקורי', 'העותק בעמוד לא השתנה — "נשמר?" לא מקבל תשובה שגויה');
    assert.throws(() => p.run(`localStorage.removeItem('shamai_v2_prices')`), /צפייה בלבד/);
    assert.throws(() => p.run(`localStorage.removeItem('no-such-key')`), /צפייה בלבד/, 'גם מחיקה של מפתח חסר — כדי שהעמוד לא ימחק עותק אחר בעקבותיה');
    assert.throws(() => p.run(`localStorage.clear()`), /צפייה בלבד/);
    assert.equal(ipcSync(modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_props', '[]').reason, 'forbidden', who + ' — גם בערוץ עצמו');
    assert.equal(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data.shamai_v2_prices, 'מקורי', who + ' — קריאה מותרת');
  }
  await loginAs('orech');
  p.run(`localStorage.setItem('shamai_v2_prices', 'עורך')`);
  assert.equal(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data.shamai_v2_prices, 'עורך', 'עורך רשאי לשנות');
  await loginAs(ADMIN[0]);
});

test('ממצא 24: רישיון במצב קריאה בלבד (סוף תקופת ניסיון) — גם השמאי לקריאה בלבד', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const ipc = require(path.join(ROOT, 'modules', 'econ', 'ipc'));
  const orig = ipc.licenseState;
  ipc.licenseState = () => ({ mode: 'licensed', status: 'trial_ended', features: ['econ', 'shamai'], reasons: [] });
  try {
    const r = ipcSync(modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_lic', '{}');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'license');
    assert.match(r.message, /תקופת הניסיון הסתיימה/);
    ipc.licenseState = () => ({ mode: 'licensed', status: 'active', features: ['econ'], reasons: [] });
    assert.match(ipcSync(modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_lic', '{}').message, /אינו כלול ברישיון/);
    // רישיון ישן שכולל את מודול האימונים (עבר למוצר נפרד) — התכונה לא פותחת את השמאי
    ipc.licenseState = () => ({ mode: 'licensed', status: 'active', features: ['econ', 'trainer'], reasons: [] });
    assert.match(ipcSync(modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_lic', '{}').message, /אינו כלול ברישיון/);
  } finally { ipc.licenseState = orig; }
  assert.equal(ipcSync(modView('shamai'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_lic', '{}').ok, true);
});

test('ממצא 3: ערך גדול מדי — QuotaExceededError בעמוד, והערך הקודם נשאר', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_img_opp_1', 'קטן')`);
  p.page.big = 'x'.repeat(SecureStore.MAX_VALUE + 1);
  const err = p.run(`(() => { try { localStorage.setItem('shamai_v2_img_opp_1', big); } catch (e) { return { name: e.name, message: e.message }; } })()`);
  assert.equal(err.name, 'QuotaExceededError');
  assert.match(err.message, /גדול מדי/);
  assert.equal(p.run(`localStorage.getItem('shamai_v2_img_opp_1')`), 'קטן');
  assert.throws(() => p.run(`localStorage.shamai_v2_img_opp_1 = big`), /גדול מדי/, 'גם השמה ישירה');
});

test('ממצא 3: בלי כניסה — כתיבה נזרקת (לא נבלעת), ועמוד שנטען בלי כניסה לא מקבל נתונים', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_logout', '["a"]')`);
  await handlers['auth:logout'](econ());
  assert.throws(() => p.run(`localStorage.setItem('shamai_v2_logout', '[]')`), (e) => e.name === 'SecurityError' && /הכניסה למערכת פגה/.test(e.message));
  assert.equal(p.run(`localStorage.getItem('shamai_v2_logout')`), '["a"]');
  const fresh = runPreload('shamai');
  assert.equal(fresh.run(`localStorage.getItem('shamai_v2_logout')`), null, 'בלי כניסה — אחסון ריק');
  assert.throws(() => fresh.run(`localStorage.setItem('x', '1')`), /יש להיכנס למערכת/);
  await loginAs(ADMIN[0]);
  assert.equal(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data['shamai_v2_logout'], '["a"]', 'הנתון לא נדרס');
});

test('ערוצי המחסן: מודול אחר או שולח זר — אין נתונים ואין כתיבה, תמיד עם תשובה', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  assert.equal(ipcSync(modView('tools'), 'secure-store:load', 'shamai'), null);
  assert.equal(ipcSync(econView(), 'secure-store:load', 'shamai'), null);
  // מודול האימונים עבר למוצר נפרד — גם מהתצוגה של השמאי, אין מחסן בשם הזה
  assert.equal(ipcSync(modView('shamai'), 'secure-store:load', 'trainer'), null);
  const r = ipcSync(modView('tools'), 'secure-store:write', 'shamai', 'set', 'shamai_v2_x', '1');
  assert.equal(r.ok, false, 'יש תשובה — ה-sendSync בעמוד לא נתקע');
  assert.deepEqual(ipcSync(modView('tools'), 'secure-store:migrate', 'shamai', { a: '1' }), { ok: false });
  assert.equal(ipcSync(modView('shamai'), 'secure-store:write', 'econ', 'set', 'a', '1').ok, false);
  assert.ok(!('shamai_v2_x' in ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data));
});

test('ממצא 37: לחיצת עכבר מאריכה את הפגישה; תזוזה בלבד וכתיבה — לא', async () => {
  await boot();
  const { AuthService } = require(path.join(ROOT, 'modules', 'econ', 'services', 'authService'));
  let clock = Date.now();
  const origNow = AuthService.now;
  AuthService.now = () => clock;
  try {
    await loginAs(ADMIN[0]);
    const shamai = modView('shamai');
    assert.ok((shamai.listeners['input-event'] || []).length, 'יש מאזין לאירועי עכבר');
    clock += 14 * 60 * 1000;
    shamai.emit('input-event', {}, { type: 'mouseMove' });
    clock += 2 * 60 * 1000; // 16 דקות בלי פעולה
    assert.equal(ipcSync(shamai, 'secure-store:write', 'shamai', 'set', 'shamai_v2_plans', '[]').reason, 'no-session', 'תזוזת עכבר אינה פעילות');
    await loginAs(ADMIN[0]);
    clock += 14 * 60 * 1000;
    shamai.emit('input-event', {}, { type: 'mouseDown', button: 'left', x: 5, y: 5 });
    clock += 10 * 60 * 1000; // 24 דקות מהכניסה, 10 מהלחיצה
    assert.equal(ipcSync(shamai, 'secure-store:write', 'shamai', 'set', 'shamai_v2_plans', '[]').ok, true, 'עבודה בעכבר שומרת על הכניסה');
    clock += 6 * 60 * 1000;
    assert.equal(ipcSync(shamai, 'secure-store:write', 'shamai', 'set', 'shamai_v2_plans', '[]').reason, 'no-session', 'כתיבה עצמה אינה פעילות');
  } finally { AuthService.now = origNow; }
  await loginAs(ADMIN[0]);
});

// ---------- שמאי: הודעה במקום "נשמר", והעותק הישן נמחק רק אחרי אישור ----------
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function fakeIndexedDB(initial = {}) {
  const st = new Map(Object.entries(initial));
  const req = (fn) => { const r = {}; realSetTimeout(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }, 0); return r; };
  const db = { objectStoreNames: { contains: () => true }, transaction: () => {
    const tx = { objectStore: () => ({ get: (k) => req(() => st.get(k)), delete: (k) => { st.delete(k); realSetTimeout(() => tx.oncomplete && tx.oncomplete(), 0); } }) };
    return tx;
  } };
  return { store: st, api: { open: () => req(() => db) } };
}
// localStorage של SuperSuite שדוחה כתיבה: זורק כמו ה-preload
function rejecting(s, message = 'השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד', name = 'SecurityError') {
  s.ctx.__reject = { message, name };
  s.run(`localStorage.setItem = () => { throw new DOMException(__reject.message, __reject.name); };
         localStorage.removeItem = () => { throw new DOMException(__reject.message, __reject.name); };`);
}
const loadAll = () => { const s = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']); s.ctx.DOMException = DOMException; s.ctx.setTimeout = realSetTimeout; s.ctx.console = { ...console, error() {} }; return s; };

test('ממצא 3 (שמאי): שמירה שנדחתה — false, הודעת שגיאה, ו"נשמר" שמיד אחריה לא מסתיר אותה', () => {
  const s = loadAll();
  assert.equal(s.run(`Storage.save('opportunities', [1])`), true);
  rejecting(s, 'השינוי לא נשמר: נגמר המקום באחסון של המודול', 'QuotaExceededError');
  assert.equal(s.run(`Storage.save('opportunities', [1, 2])`), false);
  assert.equal(s.el('#toast').textContent, 'השינוי לא נשמר: נגמר המקום באחסון של המודול');
  assert.match(s.el('#toast').className, /error/);
  s.run(`toast('נשמר', 'success')`);
  assert.equal(s.el('#toast').textContent, 'השינוי לא נשמר: נגמר המקום באחסון של המודול', '"נשמר" לא דורס את השגיאה');
  assert.equal(s.run(`Storage.remove('opportunities')`), false);
  s.run(`localStorage.setItem = () => { throw new Error('quota exceeded'); }`);
  s.run(`Storage.save('x', 1)`);
  assert.equal(s.el('#toast').textContent, 'השינוי לא נשמר', 'שגיאה באנגלית לא מוצגת למשתמש');
});

test('ממצא 3 (שמאי): תמונה ישנה לא נמחקת מ-IndexedDB כשהמחסן דחה את הכתיבה — ולא על ידי מי שאינו רשאי למחוק', async () => {
  const idb = fakeIndexedDB({ opp_old: PNG, opp_2: PNG });
  const s = loadAll();
  s.ctx.indexedDB = idb.api;
  rejecting(s);
  assert.equal(await s.run(`ImageDB.load('opp_old')`), PNG, 'התמונה מוצגת מהישן');
  assert.equal(await s.run(`ImageDB.migrateAll(['opp_old'])`), 0, 'לא הועברה — המחסן דחה');
  await new Promise((r) => realSetTimeout(r, 5));
  assert.equal(idb.store.get('opp_old'), PNG, 'הישן נשאר — ננסה שוב בפעם הבאה');
  assert.ok(!s.el('#toast').textContent, 'העברה ברקע — בלי הודעה');
  await assert.rejects(s.run(`ImageDB.save('opp_new', ${JSON.stringify(PNG)})`), /צפייה בלבד/);
  assert.equal(await s.run(`ImageDB.delete('opp_2')`), false);
  await new Promise((r) => realSetTimeout(r, 5));
  assert.equal(idb.store.get('opp_2'), PNG, 'מחיקה שנדחתה לא מוחקת את העותק הישן');
  assert.throws(() => s.run(`saveCasePhoto(${JSON.stringify(PNG)})`), (e) => e.message === 'לתפקיד שלך יש הרשאת צפייה בלבד', 'תמונה בתיק — הסיבה עולה למסך');
  assert.equal(s.run(`saveCases([])`), false);
});

// ---------- סבב סקירה: אישור שהמחסן נכתב לדיסק, ומסמכים ממוספרים שלא נשמרו ----------
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

test('המחסן: write("flush") כותב לקובץ עכשיו — ok, או "disk" כשהכתיבה נכשלה; מחסן לא זמין — unavailable', () => {
  const dir = tmp();
  const key = newKey();
  let broken = false;
  const flaky = { ...fs, renameSync: (a, b) => { if (broken) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.renameSync(a, b); } };
  const s = make(dir, { key, fs: flaky, schedule: () => 0 }); // בלי כתיבה מתוזמנת — רק flush
  assert.deepEqual(s.write('set', 'a', '1'), { ok: true });
  broken = true;
  const r = s.write('flush');
  assert.equal(r.reason, 'disk');
  assert.equal(r.name, 'SecurityError');
  assert.ok(!fs.existsSync(path.join(dir, 'secure-shamai.bin')), 'הקובץ לא נכתב');
  broken = false;
  assert.deepEqual(s.write('flush'), { ok: true });
  assert.deepEqual(make(dir, { key }).snapshot(), { a: '1' });
  assert.deepEqual(s.write('flush'), { ok: true }, 'אין מה לכתוב — מאושר');
  const locked = make(tmp(), { getBackupKey: () => { throw new Error('אין DPAPI'); } });
  assert.equal(locked.write('flush').reason, 'unavailable');
});

test('ממצא 3 (שמאי): תמונה ישנה נמחקת מ-IndexedDB רק אחרי שהמחסן נכתב לקובץ — לא כשהכתיבה לדיסק נכשלה', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  // המפתח השמור מתורגם לכתיבה לדיסק — ולא נשמר כנתון
  p.run(`localStorage.removeItem('\\u0000ss-flush')`);
  assert.ok(!Object.keys(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data).some((k) => k.includes('ss-flush')));
  const idb = fakeIndexedDB({ opp_disk: PNG });
  const s = loadAll();
  s.ctx.indexedDB = idb.api;
  s.ctx.localStorage = p.page.localStorage; // ה-localStorage של SuperSuite בעמוד
  const realRename = fs.renameSync;
  fs.renameSync = (a, b) => { if (/secure-shamai\.bin\.tmp$/.test(String(a))) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return realRename(a, b); };
  try {
    assert.equal(await s.run(`ImageDB.migrateAll(['opp_disk'])`), 1, 'התמונה במחסן (בזיכרון של התהליך הראשי)');
    await sleep(5);
    assert.equal(idb.store.get('opp_disk'), PNG, 'הקובץ לא נכתב — העותק הישן נשאר (אחרת יציאה עכשיו = התמונה אבדה)');
    assert.throws(() => p.run(`localStorage.removeItem('\\u0000ss-flush')`), (e) => e.name === 'SecurityError' && /דיסק/.test(e.message));
    idb.store.set('opp_view', PNG);
    assert.equal(await s.run(`ImageDB.load('opp_view')`), PNG, 'תצוגה מהישן');
    await sleep(5);
    assert.equal(idb.store.get('opp_view'), PNG, 'גם בהעברה בזמן הצגה');
    assert.equal(p.run(`localStorage.getItem('shamai_v2_img_opp_view')`), null, 'אחרי כשל בדיסק המחסן דוחה כתיבות חדשות');
  } finally { fs.renameSync = realRename; }
  assert.equal(await s.run(`ImageDB.migrateAll(['opp_disk', 'opp_view'])`), 1, 'opp_disk כבר במחסן; opp_view מועברת עכשיו');
  await sleep(5);
  assert.equal(idb.store.size, 0, 'אחרי שהקובץ נכתב — העותקים הישנים נמחקו');
  assert.equal(JSON.parse(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').data.shamai_v2_img_opp_disk), PNG);
});

// localStorage שדוחה כתיבה רק למפתח אחד (למשל רשימה שגדלה מעבר למקום)
function rejectingKey(s, key, message = 'השינוי לא נשמר: נגמר המקום באחסון של המודול', name = 'QuotaExceededError') {
  s.ctx.__rejectKey = { key: 'shamai_v2_' + key, message, name };
  s.run(`{ const orig = localStorage.setItem;
    localStorage.setItem = (k, v) => { if (k === __rejectKey.key) throw new DOMException(__rejectKey.message, __rejectKey.name); return orig(k, v); }; }`);
}
const PRICES = { gold: 3110.35, silver: 31.1035, usdIls: 4, source: 'manual', lastUpdate: null,
  meta: { gold: { date: '2026-10-19', source: 'manual' }, silver: { date: '2026-10-19', source: 'manual' }, usdIls: { date: '2026-10-19', source: 'manual' } } };
function purchaseForm(s) {
  s.run(`state.prices = ${JSON.stringify(PRICES)}; state.purchase = null;
    ssDialog = { confirm: async () => true, alert: async () => {} };
    var printed = []; openPrintPreview = (h) => printed.push(h);
    renderPurchaseView(); state.purchase.lines[0].grams = '5'; state.purchase.lines[0].purityPpt = '750';`);
  s.el('#pu-name').value = 'יוסף אברהמי';
  s.el('#pu-id').value = '123456782';
  s.el('#pu-commission').value = '1';
  s.el('#pu-pay').value = 'transfer';
}

test('ממצא 3 (שמאי): שטר קנייה שלא נשמר — לא מודפס, והמספור לא מתקדם', async () => {
  const s = loadAll();
  s.run('state.opportunities = []');
  purchaseForm(s);
  await s.run('savePurchase()');
  assert.equal(s.run('printed.length'), 1, 'שמירה תקינה — מודפס');
  assert.equal(s.run(`Storage.load('purchaseSeq', 0)`), 1);
  // צופה: אף שמירה לא מתקבלת
  purchaseForm(s);
  rejecting(s);
  await s.run('savePurchase()');
  assert.equal(s.run('printed.length'), 0, 'שטר שלא נשמר לא מודפס');
  assert.equal(s.run(`Storage.load('purchaseSeq', 0)`), 1, 'המספר לא נצרך');
  assert.equal(s.run(`Storage.load('purchases', []).length`), 1);
  assert.equal(s.run('state.opportunities.length'), 1, 'לא נרשם ביומן');
  assert.match(s.el('#toast').textContent, /צפייה בלבד/);
  // המספור נשמר ורשימת השטרות לא — לא מודפס (המספר הבא מדלג, אבל לא חוזר)
  const s2 = loadAll();
  s2.run('state.opportunities = []');
  purchaseForm(s2);
  rejectingKey(s2, 'purchases');
  await s2.run('savePurchase()');
  assert.equal(s2.run('printed.length'), 0);
  assert.equal(s2.run(`Storage.load('purchases', []).length`), 0);
  assert.equal(s2.run('state.opportunities.length'), 0);
});

test('ממצא 3 (שמאי): דוח שהמספר שלו לא נשמר — לא מודפס, והפריט נשאר בלי מספר', async () => {
  const opp = `state.opportunities = [{ id: 'o1', name: 'טבעת', category: 'gold', estimate: 3000, asking: 2500, details: [] }];
    var printed = []; openPrintPreview = (h) => printed.push(h);`;
  const s = loadAll();
  s.run(opp);
  rejecting(s);
  assert.equal(s.run('reportNumberFor(state.opportunities[0])'), 0);
  await s.run('exportPDFReport(state.opportunities[0])');
  assert.equal(s.run('printed.length'), 0);
  assert.equal(s.run(`Storage.load('reportSeq', 0)`), 0);
  // המספור נשמר והפנקס לא — המספר לא נשאר על הפריט
  const s2 = loadAll();
  s2.run(opp);
  rejectingKey(s2, 'opportunities');
  await s2.run('exportPDFReport(state.opportunities[0])');
  assert.equal(s2.run('printed.length'), 0);
  assert.equal(s2.run(`'reportNo' in state.opportunities[0]`), false);
});

test('ממצא 3 (שמאי): תיק — נעילה שלא נשמרה לא מציגה דוח סופי, ותיק חדש שלא נשמר לא נפתח', async () => {
  const s = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report', 'case-ui']);
  s.ctx.DOMException = DOMException;
  s.ctx.console = { ...console, error() {} };
  s.run(`var shown = []; showCaseReport = (c) => shown.push(c); renderCaseEditor = () => {}; renderCasesView = () => {};
    caseFinalizeProblems = () => []; priceWarningsFor = () => [];
    ssDialog = { confirm: async () => true, alert: async () => {} };
    var draft = newCase(1, '2026-10-23', { name: 'שמעון לוי' });
    Storage.save('cases', [draft]); CASE_UI.editId = draft.id;`);
  rejecting(s);
  await s.run('finalizeCurrentCase()');
  assert.equal(s.run('shown.length'), 0, 'אין דוח סופי לתיק שנשאר טיוטה');
  assert.equal(s.run(`loadCases()[0].status`), 'draft');
  s.run('CASE_UI.editId = null');
  s.run('openNewCase(null)');
  assert.equal(s.run('CASE_UI.editId'), null, 'לא נפתח עורך לתיק שלא קיים');
  assert.equal(s.run('loadCases().length'), 1);
  assert.equal(s.run(`Storage.load('caseSeq', 0)`), 0);
});
