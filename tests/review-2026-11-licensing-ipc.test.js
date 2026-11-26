'use strict';
// רגרסיה לסקירת הקוד מ-11.2026 (u01, ממצא f85) דרך ipc.js האמיתי: רישיון ממערכת מנפיקה אחרת — license:install
// מחזיר בקשת אישור, ורק קריאה שנייה עם allowParentChange מתקינה. רישיון כזה שהגיע בסנכרון ממתין (pendingLicense)
// ומותקן מהמסך ב-{ pending: true }
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../shell/licensing/license');
const LS = require('../shell/licensing/store');

const handlers = {};
const Module = require('module');
Module._resolveFilename_orig = Module._resolveFilename_orig || Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub__.js'] = { id: '/__electron_stub__.js', filename: '/__electron_stub__.js', loaded: true, exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const { closeEconDb, removeDirs } = require('./helpers/portable');
const ev = { sender: { id: 41 } };

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; }, aside() { v = null; } }; };
const parentLimits = { maxChildren: 3, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const childLimits = { maxChildren: 0, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 };
const FEATURES = ['econ', 'tools', 'shamai'];
const rootLic = (publicKey, issuedAt) => L.issueLicense({ privateJwk: root.privateJwk },
  { name: 'תלמוד תורה', publicKey, slot: 1, features: FEATURES, limits: parentLimits, issuedAt, expiresAt: issuedAt + 365 * DAY, graceDays: 7 });
const pkg = (chain) => JSON.stringify({ type: LS.PKG_LICENSE, v: 1, chain, notices: [] });

const dirs = [];
// ב-Windows המסד הפתוח נעול — סוגרים לפני המחיקה
test.after(() => { closeEconDb(ipc); removeDirs(dirs); });

let now = T0 + DAY;
let licenseStorage;
let fromOtherParent;
let directChain;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rv11-ipc-'));
  dirs.push(dir);
  licenseStorage = one();
  await ipc.initEcon(dir, { rootKeys, relayUrl: '', clock: () => now, licenseStorage, licenseSecret: one() });
  await handlers['auth:setup'](ev, 'menahel_41', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev, 'menahel_41', 'a-very-long-pass-2026');
  const req = JSON.parse(await handlers['license:getRequest'](ev, 'תלמוד תורה'));
  directChain = [rootLic(req.publicKey, T0)];
  await handlers['license:install'](ev, pkg(directChain));
  // הורה אחר מנפיק רישיון חדש יותר לאותה מערכת
  const p2 = L.generateKeyPair();
  const p2Lic = rootLic(p2.publicJwk, T0);
  const approval = L.createApproval(root.privateJwk, { id: crypto.randomUUID(), parentId: p2Lic.payload.id, childPublicKey: req.publicKey,
    depth: 2, slot: 1, name: 'סניף', features: FEATURES, limits: childLimits, expiresAt: T0 + 300 * DAY, graceDays: 7, approvedAt: T0 + DAY });
  now = T0 + 3 * DAY;
  fromOtherParent = pkg([p2Lic, L.issueLicense({ privateJwk: p2.privateJwk, license: p2Lic }, { name: 'סניף', publicKey: req.publicKey, slot: 1,
    features: FEATURES, limits: childLimits, issuedAt: T0 + 3 * DAY, expiresAt: T0 + 300 * DAY, graceDays: 7, approval }, { rootKeys })]);
});

const leafParent = () => { const d = JSON.parse(licenseStorage.read()); return d.chain[d.chain.length - 1].payload.parentId || null; };

test('f85 (ipc): license:install מחזיר confirm, וקריאה שנייה עם allowParentChange מתקינה', async () => {
  const first = await handlers['license:install'](ev, fromOtherParent);
  assert.match(first.confirm, /מערכת מנפיקה אחרת/);
  assert.equal(leafParent(), null, 'בלי אישור — לא הותקן');
  // ערך שאינו true בדיוק אינו אישור
  assert.ok((await handlers['license:install'](ev, fromOtherParent, { allowParentChange: 'yes' })).confirm);
  const second = await handlers['license:install'](ev, fromOtherParent, { allowParentChange: true });
  assert.equal(second.name, 'סניף');
  assert.ok(leafParent(), 'הותקן אחרי האישור');
});

test('f85 (ipc): רישיון שממתין מהסנכרון — מוצג ב-license:getRemote ומותקן ב-{ pending: true } אחרי אישור', async () => {
  await assert.rejects(handlers['license:install'](ev, '', { pending: true }), /אין רישיון שממתין/);
  const d = JSON.parse(licenseStorage.read());
  const held = { body: fromOtherParent, at: now, name: 'סניף', expiresAt: T0 + 300 * DAY };
  // המצב אחרי sync.receive: מותקן הרישיון הישיר, והרישיון מההורה האחר ממתין
  licenseStorage.write(JSON.stringify({ ...d, chain: directChain, remote: { ...(d.remote || {}), pendingLicense: held } }));
  const remote = await handlers['license:getRemote'](ev);
  assert.deepEqual(remote.pendingLicense, { name: 'סניף', at: now, expiresAt: T0 + 300 * DAY });
  assert.equal(remote.pendingLicense.body, undefined, 'גוף הרישיון לא יוצא למסך');
  const ask = await handlers['license:install'](ev, '', { pending: true });
  assert.match(ask.confirm, /מערכת מנפיקה אחרת/, 'גם הרישיון הממתין — רק אחרי אישור');
  assert.equal(leafParent(), null);
  assert.ok((await handlers['license:getRemote'](ev)).pendingLicense, 'עדיין ממתין');
  const r = await handlers['license:install'](ev, '', { pending: true, allowParentChange: true });
  assert.equal(r.name, 'סניף');
  assert.ok(leafParent());
  assert.equal((await handlers['license:getRemote'](ev)).pendingLicense, null, 'אחרי ההתקנה — כבר לא ממתין');
});
