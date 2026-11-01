// בדיקת קוד 23.10.2026, ממצא 24 — מצב plain (אין הצפנת Windows): המחסן לא מוצפן, ופעם ה-preload לא נגע ב-localStorage,
// כך שצופה ורואה חשבון (וגם מי שלא נכנס) כתבו לנתוני השמאי והאימונים בלי בדיקה. עכשיו גם כאן העמוד מקבל עותק,
// וכל כתיבה נבדקת בתהליך הראשי (secure-store:can-write) לפני שהיא נכתבת ל-localStorage של הדפדפן.
// main.js האמיתי (Electron מדומה, safeStorage לא זמין) וה-preload עצמו — tests/helpers/secure-store-main.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BK = require('../modules/econ/core/backupCrypto');
const { createMainHarness } = require('./helpers/secure-store-main');

const H = createMainHarness({ encryption: false });
const { boot, loginAs, ipcSync, runPreload, modView, econ, handlers, shellSender, dialogPlan, ADMIN } = H;
const errOf = (p, code) => p.run(`(() => { try { ${code}; return null; } catch (e) { return { name: e.name, message: e.message }; } })()`);

test('plain: המחסן לא מוצפן, העמוד מקבל עותק של localStorage, וכתיבה של מנהל מגיעה ל-localStorage של הדפדפן', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  assert.equal(ipcSync(modView('shamai'), 'secure-store:load', 'shamai').state, 'plain');
  const p = runPreload('shamai', { shamai_v2_props: '["ישן"]' });
  assert.equal(p.run(`localStorage.getItem('shamai_v2_props')`), '["ישן"]', 'הנתונים הקיימים — בלי העברה');
  p.run(`localStorage.setItem('shamai_v2_cases', '[1]')`);
  assert.equal(p.legacyMem.get('shamai_v2_cases'), '[1]');
  p.run(`localStorage.removeItem('shamai_v2_props')`);
  assert.ok(!p.legacyMem.has('shamai_v2_props'));
  p.run(`localStorage.removeItem('\\u0000ss-flush')`); // כתיבה לדיסק — הדפדפן כותב בעצמו
  assert.ok(![...p.legacyMem.keys()].some((k) => k.includes('ss-flush')));
});

test('plain: צופה ורואה חשבון — הכתיבה נדחית בעמוד (SecurityError בעברית), ולא מגיעה לדפדפן', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_prices', 'מקורי')`);
  for (const who of ['tzofe', 'roeh_cheshbon']) {
    await loginAs(who);
    const err = errOf(p, `localStorage.setItem('shamai_v2_prices', 'זדוני')`);
    assert.equal(err && err.name, 'SecurityError', who);
    assert.match(err.message, /צפייה בלבד/);
    assert.equal(p.legacyMem.get('shamai_v2_prices'), 'מקורי', who + ' — הדפדפן לא השתנה');
    assert.equal(p.run(`localStorage.getItem('shamai_v2_prices')`), 'מקורי', 'גם העותק בעמוד');
    assert.throws(() => p.run(`localStorage.removeItem('shamai_v2_prices')`), /צפייה בלבד/);
    assert.throws(() => p.run(`localStorage.clear()`), /צפייה בלבד/);
    assert.equal(p.legacyMem.get('shamai_v2_prices'), 'מקורי');
    assert.equal(ipcSync(modView('shamai'), 'secure-store:can-write', 'shamai').reason, 'forbidden', who + ' — גם בערוץ האישור');
  }
  await loginAs('orech');
  p.run(`localStorage.setItem('shamai_v2_prices', 'עורך')`);
  assert.equal(p.legacyMem.get('shamai_v2_prices'), 'עורך', 'עורך רשאי לשנות');
});

test('plain: רישיון לקריאה בלבד ומקום שנגמר — דחייה בעמוד עם סיבה בעברית', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  const ipc = require(path.join(H.ROOT, 'modules', 'econ', 'ipc'));
  const orig = ipc.licenseState;
  ipc.licenseState = () => ({ mode: 'licensed', status: 'trial_ended', features: ['econ', 'shamai'], reasons: [] });
  try {
    const err = errOf(p, `localStorage.setItem('shamai_v2_profile', '{}')`);
    assert.equal(err.name, 'SecurityError');
    assert.match(err.message, /תקופת הניסיון הסתיימה/);
  } finally { ipc.licenseState = orig; }
  p.browser.limits.quota = 64;
  const quota = errOf(p, `localStorage.setItem('shamai_v2_profile', '${'x'.repeat(100)}')`);
  assert.equal(quota.name, 'QuotaExceededError');
  assert.match(quota.message, /נגמר המקום/);
  assert.equal(p.run(`localStorage.getItem('shamai_v2_profile')`), null, 'העותק בעמוד לא השתנה');
  p.browser.limits.quota = Infinity;
});

test('plain: בלי כניסה — העמוד ריק לקריאה בלבד, והנתונים בדפדפן לא נדרסים', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  const p = runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_index', '["a"]')`);
  await handlers['auth:logout'](econ());
  assert.throws(() => p.run(`localStorage.setItem('shamai_v2_index', '[]')`), (e) => e.name === 'SecurityError' && /הכניסה למערכת פגה/.test(e.message));
  const fresh = runPreload('shamai');
  assert.equal(fresh.run(`localStorage.getItem('shamai_v2_index')`), null, 'בלי כניסה — אין נתונים בעמוד');
  assert.throws(() => fresh.run(`localStorage.setItem('x', '1')`), /יש להיכנס למערכת/);
  assert.equal(fresh.legacyMem.get('shamai_v2_index'), '["a"]', 'הנתון בדפדפן לא נדרס');
  assert.equal(ipcSync(modView('shamai'), 'secure-store:can-write', 'shamai').reason, 'no-session');
  await loginAs(ADMIN[0]);
});

test('plain: גיבוי ידני קורא את localStorage של הדפדפן — גם כשהעמוד נטען בלי כניסה (ולא גיבוי חלקי)', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  runPreload('shamai').run(`localStorage.setItem('shamai_v2_backup_me', 'כן')`);
  await handlers['auth:logout'](econ());
  const empty = runPreload('shamai'); // העמוד נטען בלי כניסה — העותק בעמוד ריק
  assert.equal(empty.run(`localStorage.getItem('shamai_v2_backup_me')`), null);
  await loginAs(ADMIN[0]);
  const file = path.join(H.userData, 'manual-plain.ssbk');
  dialogPlan.save = { canceled: false, filePath: file };
  const pass = 'gibuy-sisma-aruka-1';
  try {
    assert.deepEqual(await handlers['shell:backup-all'](shellSender(), pass, 'shamai'), { ok: true });
  } finally { dialogPlan.save = { canceled: true }; }
  const out = JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), pass));
  assert.equal(out.localStorage.shamai.shamai_v2_backup_me, 'כן');
});

test('plain: ערוץ האישור — רק מהתצוגה של אותו מודול', async () => {
  await boot();
  await loginAs(ADMIN[0]);
  assert.equal(ipcSync(modView('tools'), 'secure-store:can-write', 'shamai').reason, 'sender');
  assert.equal(ipcSync(modView('shamai'), 'secure-store:can-write', 'econ').ok, false);
  assert.deepEqual(ipcSync(modView('shamai'), 'secure-store:can-write', 'shamai'), { ok: true });
});
