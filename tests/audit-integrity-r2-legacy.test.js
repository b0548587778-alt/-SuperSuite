'use strict';
// (חלק מ-tests/audit-integrity-r2.test.js, בתהליך נפרד — מחסן השמאות שעוד לא הועבר; שם הוא כבר מועבר בבדיקה קודמת)
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
const path = require('path');
const SecureStore = require('../shell/secure-store');
const AutoBk = require('../shell/auto-backup');
const BK = require('../modules/econ/core/backupCrypto');
const { createMainHarness } = require('./helpers/secure-store-main');

const fsErr = (code) => Object.assign(new Error(code + ': simulated'), { code });

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

test('1+2 (main.js): המחסן לא נכתב לדיסק בשחזור (לפני העברה) — הודעת שגיאה, החזרה למצב שלפני, והישן לא נמחק לפני שהמחסן נכתב', async () => {
  await H.boot();
  await H.loginAs(H.ADMIN[0]);
  const LEGACY = { shamai_v2_profile: '{"name":"ישן"}', shamai_v2_index: '["c_1"]' };
  const replug = unplugBackupDrive();
  let restoreDisk = () => {};
  try {
    const p = H.runPreload('shamai', LEGACY);
    assert.equal(loadStore('shamai').migrated, false);
    // הכתיבה הראשונה (של השחזור) נכשלת; ההחזרה למצב שלפני — מצליחה
    let legacyAtFailure = null;
    const real = fs.renameSync;
    let failed = false;
    fs.renameSync = (a, b) => {
      if (!failed && /secure-shamai\.bin\.tmp$/.test(String(a))) { failed = true; legacyAtFailure = p.legacyMem.size; throw fsErr('ENOSPC'); }
      return real(a, b);
    };
    restoreDisk = () => { fs.renameSync = real; };
    assert.deepEqual(await restoreFrom({ scope: 'shamai', localStorage: { shamai: { shamai_v2_profile: '{"name":"חדש"}' } } }), { ok: false });
    restoreDisk();
    assert.equal(legacyAtFailure, 2, 'כשהכתיבה נכשלה — הישן עוד לא נמחק');
    assert.ok(!H.dialogPlan.log.includes('השחזור הושלם'), H.dialogPlan.log.join(' | '));
    const msg = H.dialogPlan.log.find((m) => /לא ניתן היה לשמור בדיסק את נתוני השמאות/.test(m));
    assert.ok(msg, H.dialogPlan.log.join(' | '));
    assert.match(msg, /הנתונים הוחזרו למצב שלפני השחזור/);
    // ההחזרה: מה שהיה (הישן) — עכשיו במחסן, בקובץ, והעמוד ייטען ממנו
    const st = loadStore('shamai');
    assert.equal(st.migrated, true);
    assert.deepEqual(st.data, LEGACY);
    assert.deepEqual(onDisk('shamai').snapshot(), LEGACY);
    assert.equal(p.legacyMem.size, 0, 'אחרי שהמחסן נכתב — הישן נמחק');
    assert.equal(H.runPreload('shamai').run(`localStorage.getItem('shamai_v2_profile')`), '{"name":"ישן"}');
  } finally { restoreDisk(); replug(); }
});

