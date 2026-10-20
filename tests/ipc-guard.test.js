const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// stub של Electron: לוכדים את ה-handlers שנרשמו כדי לקרוא להם ישירות
const handlers = {};
const Module = require('module');
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub__.js'] = { id: '/__electron_stub__.js', filename: '/__electron_stub__.js', loaded: true, exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };

const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('כל ערוץ מוגן דורש כניסה, ולאחר כניסה הוא עובד', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ipc-'));
  await ipc.initEcon(dir);

  await assert.rejects(handlers['financial:calculateMetrics'](ev(7), [], [], []), /נדרשת כניסה/);
  await assert.rejects(handlers['acct:getJournal'](ev(7), {}), /נדרשת כניסה/);
  await assert.rejects(handlers['data:backupEncrypted'](ev(7), 'pass-12345678'), /נדרשת כניסה/);
  assert.equal(ipc.isLoggedIn(), false);

  // ערוצי כניסה נשארים פתוחים
  const status = await handlers['auth:status'](ev(7));
  assert.equal(status.configured, false);
  await handlers['auth:setup'](ev(7), 'owner_1', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(7), 'owner_1', 'a-very-long-pass-2026');
  assert.equal(ipc.isLoggedIn(), true);

  const journal = await handlers['acct:getJournal'](ev(7), {});
  assert.ok(Array.isArray(journal));

  // שינוי סיסמה משתמש במשתמש המחובר (תיקון באג: קודם נשלח מזהה חלון במקום מזהה משתמש)
  const changed = await handlers['auth:change-password'](ev(7), 'a-very-long-pass-2026', 'another-long-pass-2026');
  assert.equal(changed, true);

  // מחיקת הכניסה סוגרת את הגישה
  await handlers['auth:logout'](ev(7));
  await assert.rejects(handlers['acct:getJournal'](ev(7), {}), /נדרשת כניסה/);
});

test('פעולות חשבונאות נרשמות ביומן ביקורת עם המשתמש המחובר', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(3), 'auditor_1', 'another-strong-pass-1');
  await handlers['auth:login'](ev(3), 'auditor_1', 'another-strong-pass-1');
  const inv = await handlers['acct:createInvoice'](ev(3), { customer: 'בדיקה', items: [{ unitPrice: 50 }] });
  assert.equal(inv.number, 1);
  await handlers['acct:saveSettings'](ev(3), { business: { name: 'עסק' }, vatRate: 0.18, lockDate: '' });
  const rows = await ipc.getDb().all('SELECT action, user_id FROM audit_events ORDER BY created_at');
  const actions = rows.map(r => r.action);
  assert.ok(actions.includes('acct.invoice.create'));
  assert.ok(actions.includes('acct.settings.save'));
  const user = rows.find(r => r.action === 'acct.invoice.create').user_id;
  assert.ok(user, 'audit row must record the logged-in user');
});

