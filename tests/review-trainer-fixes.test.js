'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — מודול האימונים: שמירה שנכשלה לא נבלעת, ותאריך אימון פגום לא נעשה "האחרון"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
let St, db;
test.before(async () => {
  St = await import(pathToFileURL(path.join(SRC, 'lib', 'studio.js')).href);
  db = await import(pathToFileURL(path.join(SRC, 'lib', 'db.js')).href);
});
test.afterEach(() => { delete global.window; });

test('S.set: true כשנשמר, false כשהאחסון החזיר null (מלא) או זרק — ולא "הצלחה" שקטה', async () => {
  const saved = {};
  global.window = { storage: { set: async (k, v) => { saved[k] = v; return { key: k, value: v }; } } };
  assert.equal(await db.S.set('studio:plans', [1]), true);
  assert.equal(saved['studio:plans'], '[1]');
  global.window = { storage: { set: async () => null } };
  assert.equal(await db.S.set('studio:plans', [1]), false);
  global.window = { storage: { set: async () => { throw new Error('QuotaExceededError'); } } };
  assert.equal(await db.S.set('studio:plans', [1]), false);
  global.window = {};
  assert.equal(await db.S.set('studio:plans', [1]), false);
});

test('מסכי הסטודיו: שמירה שנכשלה — הודעה, המסך לא מתעדכן, והיומן חוזר אם המנוי לא נשמר', () => {
  const src = fs.readFileSync(path.join(SRC, 'studio.jsx'), 'utf8');
  for (const fn of ['savePlans', 'saveSchedule']) {
    assert.match(src, new RegExp(`const ${fn} = async \\(list\\) => \\{ if \\(!\\(await S\\.set\\(`), fn);
  }
  assert.match(src, /if \(!\(await S\.set\(K\.memberships\(clientId\), list\)\)\) return saveFailed\(\);/);
  assert.match(src, /if \(!\(await saveMemberships\(clientId, r\.list\)\)\) return rollback\(\);/);
  assert.match(src, /import \{ askConfirm, showMessage \} from '\.\/lib\/dialog\.js';/);
});

test('תאריך "האימון האחרון": completedAt פגום מדולג ולא הופך ל-NaN', () => {
  const sessions = [{ completedAt: 'לא תאריך' }, { completedAt: '2026-10-20T10:00:00' }];
  assert.equal(St.lastTrainingDate([], sessions, 'c1'), '2026-10-20');
  assert.equal(St.lastTrainingDate([], [{ completedAt: 'xyz' }], 'c1'), null);
});
