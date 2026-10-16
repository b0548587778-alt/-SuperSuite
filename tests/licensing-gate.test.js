// רישוי — שלב 2: שער הרישוי מעל ההרשאות (gate.js, store.js, ושילוב ב-ipc.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const G = require('../shell/licensing/gate');
const { createLicenseStore, fileStorage } = require('../shell/licensing/store');
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };

// stub של Electron, כמו ב-ipc-guard.test.js
const handlers = {};
const Module = require('module');
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub__.js'] = { id: '/__electron_stub__.js', filename: '/__electron_stub__.js', loaded: true, exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

const DAY = L.DAY_MS;
const { markActivated } = require('./helpers/activation');
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];

function tenantLicense(over = {}) {
  const keys = L.generateKeyPair();
  return L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'ישיבת תפארת ציון', publicKey: keys.publicJwk, slot: 1, features: ['econ', 'econ.npo', 'tools'],
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7, ...over,
  });
}
const active = (over = {}) => ({ mode: 'licensed', status: 'active', features: ['econ', 'econ.npo'], limits: { maxUsers: 3 }, reasons: [], ...over });

test('התקנה בלי רישוי: הכול פתוח כמו קודם', () => {
  const u = { mode: 'unlicensed' };
  assert.equal(G.checkChannel(u, 'acct:getJournal', 'data.view'), null);
  assert.equal(G.moduleAllowed(u, 'trainer'), true);
  assert.equal(G.checkUserLimit(u, 1000), null);
});

test('תחום שלא נפתח ברישיון נחסם, תחום פתוח עובר', () => {
  assert.equal(G.checkChannel(active(), 'npo:getOverview', 'data.view'), null);
  assert.equal(G.checkChannel(active(), 'tasks:get', 'data.view'), null);
  assert.match(G.checkChannel(active(), 'acct:getJournal', 'data.view'), /אינו כלול ברישיון/);
  assert.match(G.checkChannel(active({ features: ['tools'] }), 'tasks:get', 'data.view'), /אינו כלול/);
});

test('מערכת ממתינה לתשלום / מושבתת: קריאה, ייצוא וגיבוי בלבד, עם הסיבה', () => {
  const s = active({ status: 'pending_payment', reasons: [{ kind: 'pending_payment', reason: 'תשלום לא התקבל' }] });
  assert.equal(G.checkChannel(s, 'tasks:get', 'data.view'), null);
  assert.equal(G.checkChannel(s, 'data:backupEncrypted', 'data.backup'), null);
  assert.match(G.checkChannel(s, 'tasks:create', 'data.edit'), /ממתינה לתשלום: תשלום לא התקבל/);
  assert.match(G.checkChannel(s, 'users:list', 'users.manage'), /ממתינה לתשלום/);
});

test('מערכת נעולה: הכול חסום מלבד כניסה ומצב רישיון', () => {
  const s = active({ status: 'locked', reasons: [{ kind: 'locked', reason: 'הפרת תנאים' }] });
  assert.match(G.checkChannel(s, 'tasks:get', 'data.view'), /נעולה/);
  assert.equal(G.checkChannel(s, 'auth:login', null), null);
  assert.equal(G.checkChannel(s, 'license:getStatus', 'data.view'), null);
  assert.equal(G.moduleAllowed(s, 'econ'), false);
});

test('מודולים לפי רישיון', () => {
  assert.equal(G.moduleAllowed(active(), 'econ'), true);
  assert.equal(G.moduleAllowed(active(), 'trainer'), false);
  assert.equal(G.moduleAllowed(active(), 'unknown'), false);
});

test('מגבלת משתמשים', () => {
  assert.equal(G.checkUserLimit(active(), 3), null);
  assert.match(G.checkUserLimit(active(), 4), /עד 3 משתמשים/);
});

test('store: עם מפתח שורש ובלי קובץ — נעול; מחיקת הקובץ לא פותחת', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-'));
  const st = createLicenseStore({ storage: fileStorage(fs, path.join(dir, 'license.json')), secret: mem(), rootKeys, clock: () => T0 + DAY }).current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /לא הותקן/);
});

test('store: קובץ פגום — נעול; בלי מפתחות שורש — ללא רישוי', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-'));
  const file = path.join(dir, 'license.json');
  fs.writeFileSync(file, '{not json');
  assert.match(createLicenseStore({ storage: fileStorage(fs, file), secret: mem(), rootKeys, clock: () => T0 }).current().reasons[0].reason, /פגום/);
  assert.equal(createLicenseStore({ storage: fileStorage(fs, file), secret: mem(), rootKeys: [], clock: () => T0 }).current().mode, 'unlicensed');
});

test('store: שומר lastSeen, והחזרת השעון אחורה לא מחזירה רישיון שפג', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-'));
  const file = path.join(dir, 'license.json');
  fs.writeFileSync(file, JSON.stringify({ chain: [tenantLicense()], notices: [] }));
  assert.equal(createLicenseStore({ storage: fileStorage(fs, file), secret: mem(), rootKeys, clock: () => T0 + 380 * DAY }).current().status, 'pending_payment');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastSeen, T0 + 380 * DAY);
  assert.equal(createLicenseStore({ storage: fileStorage(fs, file), secret: mem(), rootKeys, clock: () => T0 + DAY }).current().status, 'pending_payment');
});

test('store: מטמון מתרענן ב-invalidate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-'));
  const file = path.join(dir, 'license.json');
  const lic = tenantLicense();
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [] }));
  const store = createLicenseStore({ storage: fileStorage(fs, file), secret: mem(), rootKeys, clock: () => T0 + DAY });
  assert.equal(store.current().status, 'active');
  const hold = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: lic.payload.id, kind: 'locked',
    source: 'owner', reason: 'בדיקה', issuedAt: T0 + DAY });
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [hold] }));
  assert.equal(store.current().status, 'active');
  store.invalidate();
  assert.equal(store.current().status, 'locked');
});

test('ipc: הרישיון נאכף מעל התפקיד — תחום סגור, מגבלת משתמשים, והשבתה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-ipc-'));
  const file = path.join(dir, 'license.json');
  const lic = tenantLicense();
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [] }));
  markActivated(dir, T0 + DAY);
  await ipc.initEcon(dir, { rootKeys, clock: () => T0 + DAY });

  await handlers['auth:setup'](ev(5), 'menahel_1', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(5), 'menahel_1', 'a-very-long-pass-2026');

  // מנהל עם כל ההרשאות — ובכל זאת הנה"ח אינה ברישיון
  await assert.rejects(handlers['acct:getJournal'](ev(5), {}), /אינו כלול ברישיון/);
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(5))).tasks));

  // maxUsers = 2: המנהל + עוד אחד
  await handlers['users:create'](ev(5), { username: 'mazkir_1', password: 'another-long-pass-2026', role: 'editor' });
  await assert.rejects(handlers['users:create'](ev(5), { username: 'mazkir_2', password: 'another-long-pass-2026', role: 'viewer' }), /עד 2 משתמשים/);
  // חסימה ואז הפעלה מחדש של אותו משתמש — מותר, כי המכסה לא נחצית
  const second = (await handlers['users:list'](ev(5))).find(u => u.username === 'mazkir_1');
  await handlers['users:update'](ev(5), second.id, { active: false });
  await handlers['users:create'](ev(5), { username: 'mazkir_3', password: 'another-long-pass-2026', role: 'viewer' });
  await assert.rejects(handlers['users:update'](ev(5), second.id, { active: true }), /עד 2 משתמשים/);

  // השבתה לאי-תשלום: קריאה עובדת, כתיבה חסומה, ומצב הרישיון מוצג
  const hold = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: lic.payload.id, kind: 'pending_payment',
    source: 'billing', reason: 'החיוב החודשי נכשל', issuedAt: T0 + DAY });
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [hold] }));
  markActivated(dir, T0 + DAY);
  ipc.invalidateLicense();
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(5))).tasks));
  await assert.rejects(handlers['tasks:create'](ev(5), { title: 'הכנת דוח שנתי' }), /ממתינה לתשלום: החיוב החודשי נכשל/);
  const st = await handlers['license:getStatus'](ev(5));
  assert.equal(st.status, 'pending_payment');
  assert.equal(st.reasons[0].reason, 'החיוב החודשי נכשל');
});
