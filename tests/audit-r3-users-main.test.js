'use strict';
// סקירת קוד 2.11.2026 — משתמשים והרשאות מול main.js האמיתי (Electron מדומה, tests/helpers/secure-store-main.js):
// קוד השחזור רק עם סיסמה, פעילות במסך הכלכלי מאריכה את הכניסה, ומשתמשים + יומן בגיבוי המלא ובשחזור
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMainHarness } = require('./helpers/secure-store-main');
const BK = require('../modules/econ/core/backupCrypto');
const ZMANI_PASS = 'zmani-pass-long-1';

const H = createMainHarness();
const { handlers, boot, loginAs, econView, shellSender, econ, ADMIN, dialogPlan, userData, ROOT } = H;
const { AuthService } = require(path.join(ROOT, 'modules', 'econ', 'services', 'authService'));
const econApi = require(path.join(ROOT, 'modules', 'econ', 'ipc'));
const electron = require('electron'); // ה-stub של הרתמה
const PASS = 'סיסמת-גיבוי-ארוכה-1';

test.before(async () => { await boot(); });

test('קוד השחזור (🔑): רק עם הסיסמה של המנהל המחובר — גם אחרי כניסה בסיסמה', async () => {
  await loginAs(ADMIN[0]);
  await assert.rejects(handlers['shell:get-recovery-code'](shellSender()), /הסיסמה שגויה/);
  await assert.rejects(handlers['shell:get-recovery-code'](shellSender(), 'wrong-password-1234'), /הסיסמה שגויה/);
  assert.match(await handlers['shell:get-recovery-code'](shellSender(), ADMIN[1]), /^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/);
  // עורך — השומר נכשל לפני הסיסמה
  await loginAs('orech');
  await assert.rejects(handlers['shell:get-recovery-code'](shellSender(), 'orech-pass-long-1'), /אין הרשאה/);
  await loginAs(ADMIN[0]);
});

test('הקלדה ולחיצה במסך הכלכלי מאריכות את הכניסה (לא רק במודול נעול)', async () => {
  let clock = Date.now();
  const origNow = AuthService.now;
  AuthService.now = () => clock;
  try {
    await loginAs(ADMIN[0]);
    const v = econView();
    clock += 14 * 60 * 1000;
    v.emit('input-event', {}, { type: 'keyDown' });
    clock += 10 * 60 * 1000; // 24 דקות מהכניסה, 10 מההקלדה
    assert.equal(econApi.hasSession(v.id), true, 'עבודה בטופס בלי שמירה שומרת על הכניסה');
    clock += 6 * 60 * 1000;
    assert.equal(econApi.hasSession(v.id), false, 'בלי פעולה — הניתוק נשאר');
  } finally { AuthService.now = origNow; }
  await loginAs(ADMIN[0]);
});

async function fullBackup() {
  const file = path.join(userData, 'full-' + Date.now() + '.ssbk');
  dialogPlan.save = { canceled: false, filePath: file };
  try { assert.deepEqual(await handlers['shell:backup-all'](shellSender(), PASS, 'all'), { ok: true }); }
  finally { dialogPlan.save = { canceled: true }; }
  return { file, data: JSON.parse(BK.decryptBackup(fs.readFileSync(file, 'utf8'), PASS)) };
}
async function restoreFrom(file) {
  const orig = electron.dialog.showOpenDialog;
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  dialogPlan.log.length = 0;
  try { return await handlers['shell:restore-all'](shellSender(), PASS); }
  finally { electron.dialog.showOpenDialog = orig; }
}
const usernames = async () => (await handlers['users:list'](econ())).map(u => u.username).sort();

test('גיבוי מלא: כולל משתמשים, תפקידים ויומן — מוצפן; שחזור ממזג ומשאיר את המנהל המחובר', async () => {
  await loginAs(ADMIN[0]);
  await handlers['users:create'](econ(), { username: 'zmani', password: ZMANI_PASS, role: 'viewer' });
  const { file, data } = await fullBackup();
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('SSBK1:'), 'הגיבוי מוצפן');
  assert.equal(data.users.v, 1);
  assert.ok(data.users.users.some(u => u.username === 'zmani' && u.role === 'viewer' && /^scrypt2\$/.test(u.passwordHash)));
  assert.ok(data.users.audit.some(a => a.action === 'users.create'));
  // "מחשב אחר": המשתמש הזמני לא קיים כאן, והמנהל שינה בינתיים את התפקיד של העורך
  const db = econApi.getDb();
  const z = (await db.listUsers()).find(u => u.username === 'zmani');
  await db.run('DELETE FROM auth_users WHERE id = ?', [z.id]);
  const orech = (await db.listUsers()).find(u => u.username === 'orech');
  await handlers['users:update'](econ(), orech.id, { role: 'viewer' });
  await restoreFrom(file);
  assert.ok(dialogPlan.log.some(m => /השחזור הושלם/.test(m)), dialogPlan.log.join(' | '));
  assert.ok((await usernames()).includes('zmani'), 'המשתמש מהגיבוי נוסף');
  assert.equal((await db.listUsers()).find(u => u.username === 'orech').role, 'viewer', 'משתמש קיים לא השתנה');
  await assert.doesNotReject(handlers['auth:login']({ sender: { id: 999 } }, 'zmani', 'zmani-pass-long-1'));
  await assert.doesNotReject(loginAs(ADMIN[0]));
  await handlers['users:update'](econ(), orech.id, { role: 'editor' });
});

test('גיבוי ישן בלי users: השחזור לא נוגע במשתמשים; users פגום — נדחה לפני האישור', async () => {
  await loginAs(ADMIN[0]);
  if (!(await usernames()).includes('zmani')) await handlers['users:create'](econ(), { username: 'zmani', password: ZMANI_PASS, role: 'viewer' });
  const { data } = await fullBackup();
  const before = await usernames();
  const old = { ...data };
  delete old.users;
  const oldFile = path.join(userData, 'old.ssbk');
  fs.writeFileSync(oldFile, BK.encryptBackup(JSON.stringify(old), PASS));
  const db = econApi.getDb();
  const z = (await db.listUsers()).find(u => u.username === 'zmani');
  await db.run('DELETE FROM auth_users WHERE id = ?', [z.id]);
  await restoreFrom(oldFile);
  assert.ok(dialogPlan.log.some(m => /השחזור הושלם/.test(m)));
  assert.deepEqual(await usernames(), before.filter(n => n !== 'zmani'), 'גיבוי ישן — המשתמשים כמו שהיו');
  const bad = { ...data, users: { v: 1, users: [{ id: 'x' }] } };
  const badFile = path.join(userData, 'bad.ssbk');
  fs.writeFileSync(badFile, BK.encryptBackup(JSON.stringify(bad), PASS));
  const r = await restoreFrom(badFile);
  assert.deepEqual(r, { ok: false });
  assert.ok(dialogPlan.log.every(m => !/השחזור יחליף/.test(m)), 'לא הגיע לחלון האישור');
});
