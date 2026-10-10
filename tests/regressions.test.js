const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_r__.js'] = { id: '/__electron_stub_r__.js', filename: '/__electron_stub_r__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: {}, BrowserWindow: function () {} } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('הפעלות במקביל לא מאבדות עדכונים ולא יוצרות מספרי חשבונית כפולים', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-race-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(1), 'race_user', 'race-pass-long-1');
  await handlers['auth:login'](ev(1), 'race_user', 'race-pass-long-1');
  const created = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    handlers['acct:createInvoice'](ev(1), { customer: 'לקוח ' + i, items: [{ unitPrice: 10 }] })));
  const numbers = created.map(i => i.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => i + 1), 'מספרי חשבוניות חייבים להיות רציפים וללא כפילות');
  const stored = await handlers['acct:getInvoices'](ev(1));
  assert.equal(stored.length, 12, 'כל החשבוניות חייבות להישמר');
});
