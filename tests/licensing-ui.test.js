// רישוי — מסך "רישוי ומערכות" וערוצי מנהל-העל (owner:*): כל הזרימה בכפתורים, דרך ipc.js האמיתי
const test = require('node:test');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const L = require('../shell/licensing/license');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');

const ROOT = path.join(__dirname, '..');
const UI_SRC = EconUI.source();
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];

// stub של Electron, כמו ב-ipc-guard.test.js
const handlers = {};
const Module = require('module');
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub__.js'] = { id: '/__electron_stub__.js', filename: '/__electron_stub__.js', loaded: true, exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const PASS = 'menahel-al-pass-2026';
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const limits = { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 2 };

// ---------- רינדור (כמו tests/new-cards-view.test.js) ----------
function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({
    id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ev2, fn) { (listeners[ev2] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, remove() {}
  }, extra);
}
const settle = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

async function render(view, responses) {
  const elements = {};
  const systemAPI = new Proxy({}, {
    get(_t, name) {
      if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
      return () => Promise.resolve(name in responses ? responses[name] : {});
    }
  });
  const navButtons = VIEWS.map(v => fakeElement('', { dataset: { view: v } }));
  const document = {
    readyState: 'complete',
    getElementById(id) { return (elements[id] ||= fakeElement(id)); },
    querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; },
    addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement()
  };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  await settle();
  const i = VIEWS.indexOf(view);
  assert.ok(i >= 0, 'התצוגה קיימת בסרגל: ' + view);
  navButtons[i]._listeners.click[0]();
  await settle();
  return elements.view.innerHTML;
}

test('מסך רישוי: התקנה בלי רישוי — הודעה, כפתורי הרישיון וכפתור הגדרת מנהל-העל', async () => {
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'unlicensed', status: 'active' },
    getAdvancedSettings: { isAdmin: true },
    getOwnerState: { initialized: false, unlocked: false }
  });
  assert.match(html, /פועלת ללא רישוי/);
  assert.match(html, /licRequestBtn/);
  assert.match(html, /licInstallBtn/);
  assert.match(html, /ownerInitBtn/);
  assert.doesNotMatch(html, /licChildRequestBtn/, 'בלי רישיון אין הנפקת מערכות בת');
});

test('מסך רישוי: לקוח פעיל — מערכות בת עם כפתורי בקשת אישור, הנפקה, השבתה והחזרה', async () => {
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'licensed', status: 'active', features: ['econ', 'econ.npo'], limits, reasons: [] },
    getAdvancedSettings: { isAdmin: true },
    listLicenseChildren: [{ id: 'c1', slot: 1, name: 'סניף אלעד', status: 'suspended', expiresAt: T0 + 30 * DAY, features: ['econ'],
      holds: [{ holdId: 'h1', kind: 'suspended', reason: 'שיפוץ' }] }],
    getOwnerState: { initialized: true, unlocked: false }
  });
  assert.match(html, /licChildRequestBtn/);
  assert.match(html, /licChildIssueBtn/);
  assert.match(html, /סניף אלעד/);
  assert.match(html, /data-lic-child-release="c1" data-hold="h1"/);
  assert.match(html, /data-lic-child-hold="c1"/);
  assert.match(html, /ownerUnlockBtn/);
});

test('מסך רישוי: כרטיס הפעלה — מה חסר, וכפתור לכל תנאי', async () => {
  const activation = { required: true, ok: false, missing: ['server', 'google'], nextDue: null, steps: [
    { id: 'license', label: 'רישיון שנתי פעיל', ok: true, reason: '', until: T0 + 365 * DAY },
    { id: 'server', label: 'חיבור לשרת הרישוי', ok: false, reason: 'עדיין לא היה חיבור לשרת', until: null },
    { id: 'google', label: 'כניסה עם Google', ok: false, reason: 'עדיין לא הייתה כניסה עם Google', until: null }] };
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'licensed', status: 'locked', features: ['econ'], limits, reasons: [], activation },
    getAdvancedSettings: { isAdmin: true },
    getLicenseRemote: { url: 'https://lic.example.org', pending: [] },
    googleStatus: { enabled: true, link: null },
    getOwnerState: { initialized: false, unlocked: false }
  });
  assert.match(html, /הפעלת המערכת/);
  assert.match(html, /נדרשת השלמה/);
  assert.match(html, /עדיין לא היה חיבור לשרת/);
  assert.match(html, /licActSyncBtn/);
  assert.match(html, /licActGoogleBtn/);
  assert.match(html, /קישור חשבון Google/);
  assert.doesNotMatch(html, /licActInstallBtn/, 'הרישיון תקין — אין כפתור התקנה');

  // התקנה בלי רישוי — אין כרטיס הפעלה
  const free = await render('licensing', { getLicenseStatus: { mode: 'unlicensed', status: 'active' }, getAdvancedSettings: { isAdmin: true } });
  assert.doesNotMatch(free, /הפעלת המערכת/);
});

test('מסך רישוי: בקשה ממערכת בת — "שליחה לאישור" רק אחרי תשלום', async () => {
  const base = { getLicenseStatus: { mode: 'licensed', status: 'active', features: ['econ'], limits, reasons: [] },
    getAdvancedSettings: { isAdmin: true }, getOwnerState: { initialized: false, unlocked: false } };
  const pend = (payment) => ({ url: 'https://lic.example.org', pending: [{ keyId: 'K'.repeat(22), name: 'סניף אלעד', at: T0, payment }] });
  let html = await render('licensing', { ...base, getLicenseRemote: pend(null) });
  assert.match(html, /data-lic-remote-pay=/);
  assert.doesNotMatch(html, /data-lic-remote-forward=/);
  html = await render('licensing', { ...base, getLicenseRemote: pend({ id: 'p1', ref: 'P00003', status: 'open', amount: 600, months: 12, ready: false }) });
  assert.match(html, /ממתין לתשלום \(P00003/);
  assert.match(html, /data-lic-pay-msg="p1"/);
  assert.doesNotMatch(html, /data-lic-remote-forward=/);
  html = await render('licensing', { ...base, getLicenseRemote: pend({ id: 'p1', ref: 'P00003', status: 'paid', amount: 600, months: 12, ready: true }) });
  assert.match(html, /✔ שולם/);
  assert.match(html, /data-lic-remote-forward=/);
  assert.match(html, /licChildPayBtn/);
});

test('מסך רישוי: מערכת ממתינה לתשלום — הסיבה מוצגת, ואין הנפקת מערכות בת', async () => {
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'licensed', status: 'pending_payment', features: ['econ'], limits,
      reasons: [{ kind: 'pending_payment', reason: 'החיוב החודשי נכשל' }] },
    getAdvancedSettings: { isAdmin: true }, listLicenseChildren: [], getOwnerState: { initialized: false }
  });
  assert.match(html, /ממתינה לתשלום/);
  assert.match(html, /החיוב החודשי נכשל/);
  assert.doesNotMatch(html, /licChildRequestBtn/);
});

test('מסך רישוי: משתמש שאינו מנהל רואה מצב בלבד', async () => {
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'licensed', status: 'active', features: ['econ'], limits, reasons: [] },
    getAdvancedSettings: { isAdmin: false }
  });
  assert.match(html, /למנהל בלבד/);
  assert.doesNotMatch(html, /licInstallBtn|ownerUnlockBtn|ownerInitBtn/);
});

test('מסך רישוי: פאנל מנהל-העל — לקוחות, מערכות בת שאושרו, ופעולות בכפתור', async () => {
  const html = await render('licensing', {
    getLicenseStatus: { mode: 'unlicensed', status: 'active' },
    getAdvancedSettings: { isAdmin: true },
    getOwnerState: { initialized: true, unlocked: true, configured: false, publicKey: { x: 'k' }, globalHolds: [],
      tenants: [{ id: 't1', slot: 1, name: 'רשת תלמודי תורה', status: 'active', expiresAt: T0 + 300 * DAY, features: ['econ'], limits, holds: [],
        children: [{ id: 'c1', slot: 1, name: 'סניף ביתר', approvedAt: T0, revoked: false, terminated: false, holds: [] }] }] }
  });
  assert.match(html, /ownerOpenBtn/);
  assert.match(html, /ownerKillBtn/);
  assert.match(html, /רשת תלמודי תורה/);
  assert.match(html, /סניף ביתר/);
  assert.match(html, /data-owner-hold="t1"/);
  assert.match(html, /data-owner-notices="t1"/);
  assert.match(html, /data-owner-revoke="c1"/);
  assert.match(html, /עדיין לא מוגדר בתוכנה/, 'אזהרה כשהמפתח הציבורי לא ב-root-keys');
});

test('מסך רישוי: פריט בקטלוג ובסרגל, וכותרת בעברית', () => {
  const CAT = require('../shell/catalog');
  assert.ok([...CAT.ECON_VIEWS].includes('licensing'));
  assert.match(UI_SRC, /'licensing': 'רישוי ומערכות/);
});

// ---------- ערוצי מנהל-העל: הזרימה המלאה כמו בלחיצות במסך ----------
test('ipc: מנהל-העל מנפיק, לקוח מבקש אישור, מנהל-העל מאשר בלחיצה, והלקוח מנפיק', async () => {
  const ownerStorage = mem();
  // רישום מפתח השורש מראש כדי שההתקנות יכירו אותו
  const pre = createOwnerCore({ storage: ownerStorage, clock: () => T0 });
  const { publicKey } = pre.init(PASS);
  const rootKeys = [publicKey];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-owner-ui-'));
  await ipc.initEcon(dir, { rootKeys, clock: () => T0 + DAY, ownerStorage, licenseStorage: one(), licenseSecret: one() });
  await handlers['auth:setup'](ev(21), 'menahel_21', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(21), 'menahel_21', 'a-very-long-pass-2026');

  // מנהל-העל נעול עד הכנסת סיסמה
  assert.deepEqual(await handlers['owner:getState'](ev(21)), { initialized: true, unlocked: false });
  await assert.rejects(handlers['owner:unlock'](ev(21), 'wrong-password-123'), /הסיסמה שגויה/);
  await handlers['owner:unlock'](ev(21), PASS);
  assert.equal((await handlers['owner:getState'](ev(21))).configured, true);

  // לקוח (התקנה נפרדת) מבקש רישיון; מנהל-העל פותח את הקובץ ומנפיק
  const tenant = createLicenseStore({ storage: one(), secret: one(), rootKeys, clock: () => T0 + DAY });
  const req = JSON.stringify(tenant.request('רשת בית יעקב'));
  const opened = await handlers['owner:openRequest'](ev(21), req);
  assert.equal(opened.kind, 'license');
  const issued = await handlers['owner:issue'](ev(21), { request: req, name: 'רשת בית יעקב', features: ['econ'], limits, months: 12 });
  tenant.install(issued.package);
  assert.equal(tenant.current().status, 'active');

  // הלקוח מבקש מערכת בת — מנהל-העל רואה את הבקשה ומאשר
  const child = createLicenseStore({ storage: one(), secret: one(), rootKeys, clock: () => T0 + DAY });
  const ask = tenant.requestChildApproval({ request: child.request('סניף מודיעין עילית'), features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 2 } });
  const review = await handlers['owner:openRequest'](ev(21), ask.package);
  assert.equal(review.kind, 'approval');
  assert.equal(review.parentName, 'רשת בית יעקב');
  assert.deepEqual(review.quota, { used: 0, max: 2 });
  await assert.rejects(handlers['owner:reject'](ev(21), { request: ask.package, reason: ' ' }), /סיבה/);
  const approved = await handlers['owner:approve'](ev(21), { request: ask.package });
  const made = tenant.issueChild({ approval: approved.package });
  child.install(made.package);
  assert.equal(child.current().status, 'active');

  const st = await handlers['owner:getState'](ev(21));
  assert.equal(st.tenants[0].children[0].name, 'סניף מודיעין עילית');

  // השבתה בלחיצה ← קובץ עדכון ← מגיע ללקוח ולמערכת הבת
  const hold = await handlers['owner:notice'](ev(21), { type: 'hold', target: issued.id, kind: 'suspended', reason: 'בקשת הלקוח' });
  const pkg = await handlers['owner:noticesPackage'](ev(21), issued.id);
  tenant.importNotices(pkg); child.importNotices(pkg);
  assert.equal(tenant.current().status, 'suspended');
  assert.equal(child.current().status, 'suspended');
  await handlers['owner:notice'](ev(21), { type: 'release', target: issued.id, holdId: hold.id, reason: 'חזרה' });
  child.importNotices(await handlers['owner:noticesPackage'](ev(21), issued.id));
  assert.equal(child.current().status, 'active');

  // יציאה ממצב מנהל-העל — אין פעולות עד כניסה מחדש
  await handlers['owner:lock'](ev(21));
  await assert.rejects(handlers['owner:notice'](ev(21), { type: 'hold', target: issued.id, kind: 'locked', reason: 'x' }), /לפתוח את מצב מנהל-העל/);

  const actions = (await ipc.getDb().all('SELECT action FROM audit_events')).map(r => r.action);
  for (const a of ['owner.unlock.failed', 'owner.unlock', 'owner.tenant.issue', 'owner.child.approve', 'owner.notice.hold', 'owner.notice.release']) {
    assert.ok(actions.includes(a), 'ביומן: ' + a);
  }
});

test('ipc: ערוצי מנהל-העל פתוחים גם במערכת נעולה (כדי להגדיר רישוי ממחשב בלי רישיון)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-owner-ui2-'));
  const root = L.generateKeyPair();
  await ipc.initEcon(dir, { rootKeys: [root.publicJwk], clock: () => T0, ownerStorage: mem(), licenseStorage: one(), licenseSecret: one() });
  await handlers['auth:setup'](ev(31), 'menahel_31', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(31), 'menahel_31', 'a-very-long-pass-2026');
  await assert.rejects(handlers['tasks:get'](ev(31)), /לא הותקן רישיון/);
  assert.equal((await handlers['owner:getState'](ev(31))).initialized, false);
  await assert.rejects(handlers['owner:init'](ev(31), 'short'), /לפחות 12/);
  await handlers['owner:init'](ev(31), PASS);
  assert.equal((await handlers['owner:getState'](ev(31))).unlocked, true);
});
