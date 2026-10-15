// רגרסיה (סקירת אבטחה 10.2026, ממצא 2): שכבת הסנכרון קיבלה store = null כי נוצרה לפני מחסן הרישוי,
// וכל פעולה מרחוק נכשלה ב"שגיאה פנימית". כאן — דרך initEcon האמיתי, ולא דרך createLicenseSync ישירות
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const handlers = {};
Module._resolveFilename_sw = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_sw__.js' : Module._resolveFilename_sw.call(this, req, ...rest); };
require.cache['/__electron_stub_sw__.js'] = { id: '/__electron_stub_sw__.js', filename: '/__electron_stub_sw__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };

const ipc = require('../modules/econ/ipc');
const L = require('../shell/licensing/license');
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const ev = { sender: { id: 31 } };

test('פעולות מרחוק עובדות אחרי initEcon — הסנכרון מקבל את מחסן הרישוי האמיתי', async () => {
  const root = L.generateKeyPair();
  const sent = [];
  // שרת מדומה: עונה על כל בקשה, ושומר מה נשלח
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body.op);
    return { ok: true, json: async () => ({ ok: true, messages: [], sent: 1 }) };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sw-'));
  await ipc.initEcon(dir, { rootKeys: [root.publicJwk], fetchImpl, licenseStorage: mem(), licenseSecret: mem() });
  await handlers['auth:setup'](ev, 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev, 'menahel', 'menahel-pass-long-1');

  await handlers['license:setRemote'](ev, 'https://relay.example.org');
  const r = await handlers['license:remoteRequest'](ev, 'ישיבת תפארת ציון');
  assert.equal(r.sent, true);
  assert.match(r.keyId, /^[A-Za-z0-9_-]{22}$/);
  const sync = await handlers['license:remoteSync'](ev);
  assert.equal(sync.errors.length, 0);
  assert.ok(sent.includes('send') && sent.includes('fetch'));
});
