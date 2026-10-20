const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_s__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_s__.js'] = { id: '/__electron_stub_s__.js', filename: '/__electron_stub_s__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: {}, BrowserWindow: function () {} } };
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('הרשאות לפי תפקיד: צופה לא יכול לכתוב או לגבות', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-perm-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(5), 'perm_user', 'perm-pass-long-1');
  await handlers['auth:login'](ev(5), 'perm_user', 'perm-pass-long-1');
  await handlers['acct:createInvoice'](ev(5), { customer: 'בסיס', items: [{ unitPrice: 5 }] });

  // מדמים משתמש עם הרשאת צפייה בלבד
  AuthService.getSession(5).permissions = ['data.view'];
  assert.ok((await handlers['acct:getInvoices'](ev(5))).length === 1, 'צפייה מותרת');
  await assert.rejects(handlers['acct:createInvoice'](ev(5), { customer: 'אסור', items: [{ unitPrice: 5 }] }), /אין הרשאה/);
  await assert.rejects(handlers['data:backupEncrypted'](ev(5), 'pass-12345678'), /אין הרשאה/); // הערוץ הגלוי הוסר; הבדיקה עברה לערוץ המוצפן
  await assert.rejects(handlers['acct:deleteProduct'](ev(5), 'x'), /אין הרשאה/);
  assert.equal((await handlers['acct:getInvoices'](ev(5))).length, 1, 'לא נוצרה חשבונית אסורה');
  await handlers['auth:logout'](ev(5));
});

test('ניתוק אוטומטי אחרי חוסר פעילות ובדיקה בכל פעולה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-idle-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(6), 'idle_user', 'idle-pass-long-1');
  await handlers['auth:login'](ev(6), 'idle_user', 'idle-pass-long-1');
  assert.ok(await handlers['acct:getSettings'](ev(6)));

  const realNow = AuthService.now;
  AuthService.now = () => Date.now() + 16 * 60 * 1000; // עברו 16 דקות בלי פעילות
  await assert.rejects(handlers['acct:getSettings'](ev(6)), /נדרשת כניסה/);
  AuthService.now = realNow;
  await assert.rejects(handlers['acct:getSettings'](ev(6)), /נדרשת כניסה/, 'הפגישה נמחקה ולא חוזרת לבד');

  await handlers['auth:login'](ev(6), 'idle_user', 'idle-pass-long-1');
  assert.ok(await handlers['acct:getSettings'](ev(6)), 'כניסה מחדש עובדת');
});

test('פעילות שמתחדשת לא מנתקת את המשתמש', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-active-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(8), 'active_user', 'active-pass-long-1');
  await handlers['auth:login'](ev(8), 'active_user', 'active-pass-long-1');
  const realNow = AuthService.now;
  let t = Date.now();
  AuthService.now = () => t;
  for (let i = 0; i < 4; i++) { t += 10 * 60 * 1000; assert.ok(await handlers['acct:getSettings'](ev(8))); }
  AuthService.now = realNow;
});
