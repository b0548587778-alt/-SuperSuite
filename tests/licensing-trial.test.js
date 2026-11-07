// תקופת ניסיון (PLAN.md 4.2): התקנה עם מפתחות שורש ובלי רישיון — הכול פתוח ל-30 יום, ואחר כך
// צפייה, ייצוא וגיבוי בלבד. ההתחלה נשמרת גם בשומר המוצפן; הזמן רק קדימה; רישיון פותח מיד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const G = require('../shell/licensing/gate');
const { createLicenseStore, TRIAL_DAYS } = require('../shell/licensing/store');
const { createOwner } = require('../tools/licensing/owner');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const PASS = 'ohr-hachaim-owner-2026';
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; }, peek: () => v, wipe: () => { v = null; } }; };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const tenantLimits = { maxChildren: 0, maxUsers: 10, maxStorageMb: 1000, maxDepth: 1 };

function setup() {
  let now = T0;
  const owner = createOwner({ dir: tmp('ss-trial-owner-'), passphrase: PASS, clock: () => now });
  owner.init();
  const rootKeys = [owner.pubkey()];
  const storage = mem(), secret = mem();
  const make = () => createLicenseStore({ storage, secret, rootKeys, clock: () => now });
  return { owner, rootKeys, storage, secret, make, at: (t) => { now = t; }, now: () => now };
}

test('ניסיון: 30 יום', () => assert.equal(TRIAL_DAYS, 30));

test('יום 1: הכול פתוח, נותרו 30 יום, בלי אזהרה; ההתחלה נשמרת בקובץ ובשומר', () => {
  const { make, storage, secret } = setup();
  const st = make().current();
  assert.equal(st.mode, 'licensed');
  assert.equal(st.status, 'active');
  assert.equal(st.trial.daysLeft, 30);
  assert.equal(st.trial.warn, false);
  assert.equal(st.trial.startedAt, T0);
  assert.equal(st.trial.endsAt, T0 + 30 * DAY);
  // במהדורה המלאה הניסיון כולל גם את מודולי הלימוד (החלטת הבעלים 7.11.2026)
  for (const m of ['econ', 'shamai', 'tools', 'trainer', 'english', 'math', 'school']) assert.equal(G.moduleAllowed(st, m), true, m);
  assert.equal(G.checkChannel(st, 'npo:addDonation', 'data.edit'), null);
  assert.equal(G.checkChannel(st, 'acct:createInvoice', 'data.edit'), null);
  assert.equal(JSON.parse(storage.peek()).trialStart, T0);
  assert.equal(JSON.parse(secret.peek()).guard.trialStart, T0);
  const sh = G.shellState(st);
  assert.equal(sh.level, 'ok');
  assert.deepEqual(sh.trial, { daysLeft: 30, endsAt: T0 + 30 * DAY, warn: false });
});

test('יום 29: עדיין פתוח, עם אזהרה (שבוע אחרון)', () => {
  const { make, at } = setup();
  make().current();
  at(T0 + 28 * DAY + 3600e3);
  const st = make().current();
  assert.equal(st.status, 'active');
  assert.equal(st.trial.daysLeft, 2);
  assert.equal(st.trial.warn, true);
});

test('יום 31: קריאה, ייצוא וגיבוי בלבד — שום נתון לא נמחק', () => {
  const { make, at } = setup();
  make().current();
  at(T0 + 30 * DAY + 1);
  const st = make().current();
  assert.equal(st.status, 'trial_ended');
  assert.equal(st.trial.daysLeft, 0);
  assert.equal(G.checkChannel(st, 'tasks:get', 'data.view'), null);
  assert.equal(G.checkChannel(st, 'npo:exportReport', 'data.export'), null);
  assert.equal(G.checkChannel(st, 'backup:create', 'data.backup'), null);
  assert.match(G.checkChannel(st, 'tasks:create', 'data.edit'), /תקופת הניסיון הסתיימה/);
  assert.match(G.checkChannel(st, 'tasks:delete', 'data.delete'), /תקופת הניסיון הסתיימה/);
  assert.equal(G.checkChannel(st, 'license:install', 'users.manage'), null); // התקנת רישיון — תמיד
  assert.equal(G.moduleAllowed(st, 'shamai'), true); // צפייה במודולים
  const sh = G.shellState(st);
  assert.equal(sh.level, 'limited');
  assert.match(sh.message, /תקופת הניסיון הסתיימה/);
});

test('החזרת שעון: לא מאריכה את הניסיון', () => {
  const { make, at } = setup();
  make().current();
  at(T0 + 31 * DAY);
  assert.equal(make().current().status, 'trial_ended');
  at(T0 + 2 * DAY); // השעון הוחזר
  const st = make().current();
  assert.equal(st.status, 'trial_ended');
  // גם החזרה בתוך התקופה לא מוסיפה ימים
  const b = setup();
  b.make().current();
  b.at(T0 + 20 * DAY); b.make().current();
  b.at(T0 + 1 * DAY);
  assert.equal(b.make().current().trial.daysLeft, 10);
});

test('מחיקת license.json: ההתחלה נשמרת בשומר — הניסיון לא מתחיל מחדש', () => {
  const { make, at, storage } = setup();
  make().current();
  at(T0 + 31 * DAY);
  make().current();
  storage.wipe();
  at(T0 + 32 * DAY);
  const st = make().current();
  assert.equal(st.status, 'trial_ended');
  assert.equal(st.trial.startedAt, T0);
  assert.equal(JSON.parse(storage.peek()).trialStart, T0); // נכתב בחזרה לקובץ
});

test('שינוי trialStart בקובץ לתאריך מאוחר — המוקדם (מהשומר) גובר', () => {
  const { make, at, storage } = setup();
  make().current();
  at(T0 + 31 * DAY);
  storage.write(JSON.stringify({ ...JSON.parse(storage.peek()), trialStart: T0 + 30 * DAY, lastSeen: 0 }));
  assert.equal(make().current().status, 'trial_ended');
});

test('התקנת רישיון באמצע הניסיון ואחרי שהסתיים — נפתח מיד, בלי סימון ניסיון', () => {
  for (const day of [10, 45]) {
    const { owner, make, at } = setup();
    make().current();
    at(T0 + day * DAY);
    const store = make();
    const req = store.request('תלמוד תורה בית יוסף');
    store.install(owner.issue({ request: req, features: ['econ', 'tools'], limits: tenantLimits, months: 12 }).package);
    const st = store.current();
    assert.equal(st.status, 'active', `יום ${day}`);
    assert.equal(st.trial, undefined);
    assert.deepEqual(st.features, ['econ', 'tools']);
  }
});

test('אחרי רישיון — מחיקת license.json לא מחזירה לתקופת ניסיון', () => {
  const { owner, make, storage } = setup();
  const store = make();
  const req = store.request('קהילת אור');
  store.install(owner.issue({ request: req, features: ['econ'], limits: tenantLimits, months: 12 }).package);
  assert.equal(store.current().status, 'active');
  storage.wipe();
  const st = make().current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /קובץ הרישוי חסר/);
});

test('בלי מפתחות שורש — ללא רישוי, בלי ניסיון ובלי כתיבה', () => {
  const storage = mem(), secret = mem();
  const st = createLicenseStore({ storage, secret, rootKeys: [], clock: () => T0 }).current();
  assert.deepEqual(st, { mode: 'unlicensed' });
  assert.equal(storage.peek(), null);
  assert.equal(secret.peek(), null);
  assert.equal(G.shellState(st).trial, undefined);
});

test('בלי הצפנת מערכת (אין שומר): הניסיון עובד לפי הקובץ בלבד', () => {
  let now = T0;
  const owner = createOwner({ dir: tmp('ss-trial-owner-'), passphrase: PASS, clock: () => now });
  owner.init();
  const storage = mem();
  const noDpapi = { read: () => null, write: () => { throw new Error('אין DPAPI'); } };
  const make = () => createLicenseStore({ storage, secret: noDpapi, rootKeys: [owner.pubkey()], clock: () => now });
  const st = make().current();
  assert.equal(st.status, 'active');
  assert.equal(st.trial.guarded, false);
  now = T0 + 31 * DAY;
  assert.equal(make().current().status, 'trial_ended');
});

test('בתקופת ניסיון אין הנפקת מערכות בת', () => {
  const { make } = setup();
  assert.throws(() => make().requestChildApproval({ request: '{}' }), /תקופת ניסיון/);
});

test('ipc: בניסיון אין תנאי הפעלה; license:getStatus מחזיר את הניסיון', async () => {
  const handlers = {};
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_trial__.js' : orig.call(this, req, ...rest); };
  require.cache['/__electron_stub_trial__.js'] = { id: '/__electron_stub_trial__.js', filename: '/__electron_stub_trial__.js', loaded: true,
    exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
  delete require.cache[require.resolve('../modules/econ/ipc')];
  const ipc = require('../modules/econ/ipc');
  Module._resolveFilename = orig;
  const ev = { sender: { id: 41 } };
  const owner = createOwner({ dir: tmp('ss-trial-owner-'), passphrase: PASS, clock: () => T0 });
  owner.init();
  await ipc.initEcon(tmp('ss-trial-ipc-'), { rootKeys: [owner.pubkey()], relayUrl: '', clock: () => T0 + DAY, licenseStorage: mem(), licenseSecret: mem() });
  await handlers['auth:setup'](ev, 'menahel_41', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev, 'menahel_41', 'a-very-long-pass-2026');
  await handlers['tasks:create'](ev, { title: 'שיעור בגמרא' });
  const s = await handlers['license:getStatus'](ev);
  assert.equal(s.status, 'active');
  assert.equal(s.trial.daysLeft, 30);
  assert.equal(s.activation.required, false);
});

test('ממשק: באנר הניסיון במעטפת ושורת ניסיון במסך הרישוי', () => {
  const root = path.join(__dirname, '..');
  const shell = fs.readFileSync(path.join(root, 'shell', 'shell.js'), 'utf8');
  assert.match(shell, /תקופת ניסיון — /);
  assert.match(fs.readFileSync(path.join(root, 'shell', 'shell.html'), 'utf8'), /#licBar\.trial/);
  const ui = fs.readFileSync(path.join(root, 'modules', 'econ', 'ui', 'licensing.js'), 'utf8');
  assert.match(ui, /trial_ended: 'תקופת הניסיון הסתיימה'/);
  assert.match(ui, /function licTrialRows/);
});
