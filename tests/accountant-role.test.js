// תפקיד "רואה חשבון": צפייה וייצוא בלבד — כדי לתת גישה לרו"ח בלי לאפשר לו לשנות דבר
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};
const Module = require('module');
Module._resolveFilename_acc = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_acc__.js' : Module._resolveFilename_acc.call(this, req, ...rest); };
require.cache['/__electron_stub_acc__.js'] = { id: '/__electron_stub_acc__.js', filename: '/__electron_stub_acc__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } } };

const ipc = require('../modules/econ/ipc');
const { ROLES } = require('../modules/econ/core/database');
const ev = (id) => ({ sender: { id } });

test('התפקיד מוכר ונוצר במסד', () => {
  assert.ok(ROLES.includes('accountant'));
});

test('רואה חשבון: קורא ומייצא; לא עורך, לא מוחק, לא מגבה ולא מנהל משתמשים', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-acc-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['users:create'](ev(1), { username: 'roeh_cheshbon', password: 'roeh-cheshbon-pass-1', role: 'accountant' });

  await handlers['auth:login'](ev(2), 'roeh_cheshbon', 'roeh-cheshbon-pass-1');
  // קריאה
  assert.ok(Array.isArray(await handlers['acct:getJournal'](ev(2), {})));
  assert.ok(await handlers['npo:getOverview'](ev(2), 2026));
  // ייצוא — עובר את ההרשאה (הדיאלוג המדומה מבוטל)
  const r = await handlers['npo:exportCsv'](ev(2), 'donations', 2026);
  assert.equal(r.ok, false);
  // כל השאר חסום
  const denied = /אין הרשאה/;
  await assert.rejects(handlers['npo:saveSettings'](ev(2), {}), denied);
  await assert.rejects(handlers['npo:deleteGrant'](ev(2), 'x'), denied);
  await assert.rejects(handlers['data:backupEncrypted'](ev(2), 'pass-12345678'), denied);
  await assert.rejects(handlers['users:list'](ev(2)), denied);
  await assert.rejects(handlers['users:create'](ev(2), { username: 'x', password: 'y', role: 'admin' }), denied);
});
