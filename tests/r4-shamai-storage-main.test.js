'use strict';
// סקירת קוד 2.11.2026, תכניות א+ב — main.js האמיתי (Electron מדומה) וה-preload של המחסן יחד:
// תמונות בקבצים נפרדים נטענות לעמוד לפי דרישה (secure-store:get), הגיבוי הידני כולל אותן באותו פורמט,
// שחזור של גיבוי ישן (cases + תמונות) מפצל אותן לקבצים, ושחזור שנכשל מחזיר גם את קבצי התמונות למצב שלפני.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SecureStore = require('../shell/secure-store');
const AutoBk = require('../shell/auto-backup');
const BK = require('../modules/econ/core/backupCrypto');
const { createMainHarness } = require('./helpers/secure-store-main');

const H = createMainHarness({ encryption: true });
const STUB = '/__electron_stub_secure_store_main__.js';
const electron = () => require.cache[STUB].exports;
const PASS = 'sismat-gibui-aruka-2026';
const fsErr = (code) => Object.assign(new Error(code + ': simulated'), { code });
const PNG = (n) => 'data:image/png;base64,' + 'A'.repeat(200) + n;
let seq = 0;

async function restoreFrom(payload) {
  const file = path.join(H.userData, `r4-restore-${++seq}.ssbk`);
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, createdAt: new Date().toISOString(), econ: null, ...payload }), PASS));
  const d = electron().dialog;
  const orig = d.showOpenDialog;
  d.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  H.dialogPlan.log.length = 0;
  try { return await H.handlers['shell:restore-all'](H.shellSender(), PASS); } finally { d.showOpenDialog = orig; }
}
const onDisk = () => SecureStore.createSecureStore({ fs, dir: H.userData, mod: 'shamai', schedule: () => null,
  getBackupKey: () => AutoBk.loadAutoBackupKey({ file: path.join(H.userData, 'autobackup.key'), safeStorage: electron().safeStorage, create: false }) });
const blobDir = () => path.join(H.userData, 'secure-shamai-blobs');
const blobCount = () => (fs.existsSync(blobDir()) ? fs.readdirSync(blobDir()).filter(f => /^[0-9a-f]{64}\.bin$/.test(f)).length : 0);

test('העמוד: תמונה נשמרת לקובץ נפרד, לא נשלחת בטעינה, ונקראת לפי דרישה — key / length / Object.keys רואים אותה', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const p = H.runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_props', '["א"]'); localStorage.setItem('shamai_v2_img_opp_a', ${JSON.stringify(PNG(1))});`);
  assert.equal(p.run(`localStorage.getItem('shamai_v2_img_opp_a')`), PNG(1));
  const load = H.ipcSync(H.modView('shamai'), 'secure-store:load', 'shamai');
  assert.ok(!('shamai_v2_img_opp_a' in load.data), 'התמונה לא בטעינה');
  assert.ok(load.blobKeys.includes('shamai_v2_img_opp_a'));
  // טעינה חדשה של העמוד
  const p2 = H.runPreload('shamai');
  assert.equal(p2.run(`localStorage.getItem('shamai_v2_img_opp_a')`), PNG(1));
  assert.equal(p2.run(`localStorage.shamai_v2_img_opp_a`), PNG(1));
  assert.ok(JSON.parse(p2.run(`JSON.stringify(Object.keys(localStorage))`)).includes('shamai_v2_img_opp_a'));
  assert.ok(p2.run(`(() => { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i) === 'shamai_v2_img_opp_a') return true; return false; })()`));
  p2.run(`localStorage.removeItem('shamai_v2_img_opp_a')`);
  assert.equal(p2.run(`localStorage.getItem('shamai_v2_img_opp_a')`), null);
  assert.equal(p2.run(`'shamai_v2_img_opp_a' in localStorage`), false);
  // הערוץ: רק מתצוגת המודול, ורק בכניסה פעילה
  p2.run(`localStorage.setItem('shamai_v2_casePhoto_x', ${JSON.stringify(PNG(2))})`);
  assert.equal(H.ipcSync(H.modView('tools'), 'secure-store:get', 'shamai', 'shamai_v2_casePhoto_x'), null, 'מודול אחר');
  assert.equal(H.ipcSync(H.modView('shamai'), 'secure-store:get', 'shamai', 'shamai_v2_casePhoto_x'), PNG(2));
});

test('גיבוי ידני: התמונות מהקבצים נכללות באותו פורמט (localStorage.shamai — מפתח ← ערך)', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const p = H.runPreload('shamai');
  p.run(`localStorage.setItem('shamai_v2_img_opp_bk', ${JSON.stringify(PNG(3))})`);
  const out = path.join(H.userData, 'r4-manual.ssbk');
  H.dialogPlan.save = { canceled: false, filePath: out };
  try { assert.deepEqual(await H.handlers['shell:backup-all'](H.shellSender(), PASS, 'shamai'), { ok: true }); }
  finally { H.dialogPlan.save = { canceled: true }; }
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(out, 'utf8'), PASS));
  assert.equal(data.localStorage.shamai.shamai_v2_img_opp_bk, PNG(3));
  assert.equal(typeof data.localStorage.shamai.shamai_v2_props, 'string');
});

test('שחזור גיבוי ישן (cases בכמה תיקים + תמונות בקובץ הראשי) ← התמונות לקבצים; שחזור שנכשל ← גם התמונות חוזרות למצב שלפני', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const cases = [{ id: 'k2', no: 2, client: { name: 'לקוח' }, items: [{ photos: ['ph1'] }] }, { id: 'k1', no: 1, client: { name: 'לקוח' }, items: [] }];
  const old = { shamai_v2_cases: JSON.stringify(cases), shamai_v2_casePhoto_ph1: PNG(4), shamai_v2_img_opp_9: PNG(5) };
  assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: old } }), { ok: true }, H.dialogPlan.log.join(' | '));
  const disk = onDisk();
  assert.deepEqual(disk.snapshot(), old);
  assert.deepEqual(Object.keys(disk.dataSnapshot()), ['shamai_v2_cases'], 'התמונות בקבצים');
  assert.equal(blobCount(), 2);
  assert.ok(!fs.existsSync(blobDir() + '.new'));

  // שחזור שנכשל בכתיבת הקובץ הראשי: ההחזרה מחזירה גם את התמונות (תיקיית ביניים — לא נגעה בתמונות שבדיסק)
  const before = onDisk().snapshot();
  const real = fs.renameSync;
  let count = 1;
  fs.renameSync = (a, b) => { if (/secure-shamai\.bin\.tmp$/.test(String(a)) && count-- > 0) throw fsErr('ENOSPC'); return real(a, b); };
  try {
    assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: { shamai_v2_img_opp_new: PNG(6), shamai_v2_props: '[]' } } }), { ok: false });
  } finally { fs.renameSync = real; }
  assert.ok(H.dialogPlan.log.some((m) => /הוחזרו למצב שלפני השחזור/.test(m)), H.dialogPlan.log.join(' | '));
  assert.deepEqual(onDisk().snapshot(), before);
  assert.deepEqual(H.ipcSync(H.modView('shamai'), 'secure-store:load', 'shamai').blobKeys.sort(), ['shamai_v2_casePhoto_ph1', 'shamai_v2_img_opp_9']);
  assert.equal(H.ipcSync(H.modView('shamai'), 'secure-store:get', 'shamai', 'shamai_v2_casePhoto_ph1'), PNG(4));
  assert.equal(blobCount(), 2);
  assert.ok(!fs.readdirSync(H.userData).some(f => f.startsWith('secure-shamai-blobs.')), 'בלי תיקיות ביניים');
});
