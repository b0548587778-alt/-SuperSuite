#!/usr/bin/env node
// הרצת הבדיקות עם תיקייה זמנית משלה, שנמחקת בסוף.
// הבדיקות יוצרות תיקיות ב-os.tmpdir() ורובן לא מוחקות אותן — בכל הרצה נשארו מאות תיקיות, ועד בדיקת
// האבטחה של 21.10.2026 הצטברו כ-50,000 ומילאו את הכונן. כאן TEMP / TMP / TMPDIR מופנים לתיקייה אחת
// (גם לתהליכי הבן של הבדיקות), והיא נמחקת כשההרצה מסתיימת — גם אם בדיקה נכשלה.
//   node tools/run-tests.js [--serial]     (npm test / npm run test:serial)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
// זמן קצוב (סקירת קוד 2.11.2026): בדיקה תקועה נכשלת אחרי TEST_TIMEOUT_MS, וההרצה כולה נעצרת אחרי RUN_TIMEOUT_MS —
// במקום לחסום את npm test ואת ה-CI עד הזמן הקצוב של GitHub (6 שעות)
const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

function testArgs({ serial = false, files = testFiles() } = {}) {
  return ['--test', '--test-concurrency=' + (serial ? 1 : 6), '--test-timeout=' + TEST_TIMEOUT_MS, ...files];
}

function testFiles() {
  return fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js')).sort().map(f => path.join('tests', f));
}

// מחיקה עם ניסיונות חוזרים: ב-Windows קובץ שתהליך הבן עוד סוגר נשאר נעול לרגע
function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return true; }
  catch { return false; }
}

function run({ serial = false, files = testFiles(), baseTmp = os.tmpdir(), spawn = spawnSync } = {}) {
  const dir = fs.mkdtempSync(path.join(baseTmp, 'ss-tests-'));
  const env = { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir };
  let status = 1;
  try {
    const r = spawn(process.execPath, testArgs({ serial, files }), { cwd: root, env, stdio: 'inherit', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });
    if (r.error && r.error.code === 'ETIMEDOUT') console.error(`⚠ הבדיקות נעצרו אחרי ${RUN_TIMEOUT_MS / 60000} דקות`);
    status = r.status == null ? 1 : r.status;
  } finally {
    if (!removeDir(dir)) console.warn('⚠ התיקייה הזמנית של הבדיקות לא נמחקה: ' + dir);
  }
  return status;
}

if (require.main === module) process.exit(run({ serial: process.argv.includes('--serial') }));

module.exports = { run, testFiles, testArgs, TEST_TIMEOUT_MS, RUN_TIMEOUT_MS };
