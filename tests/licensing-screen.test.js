// מסך רישוי אחד וברור (PLAN.md 4.3): כרטיס מצב — ניסיון / פעיל / עומד לפוג / נעול, עד מתי,
// קנייה / קובץ / הדבקת קוד, ו"מה לעשות" לפי הסיבה. ההגדרות המתקדמות מקופלות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const EconUI = require('./helpers/econ-ui');
const L = require('../shell/licensing/license');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwner } = require('../tools/licensing/owner');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];
const DAY = L.DAY_MS;
const NOW = Date.now();
const limits = { maxChildren: 0, maxUsers: 10, maxStorageMb: 1000, maxDepth: 1 };
const REMOTE = { url: 'https://lic.example.org', pending: [] };

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

function makeContext(responses = {}) {
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
  return { context, elements, navButtons };
}

async function render(responses) {
  const { elements, navButtons } = makeContext(responses);
  await settle();
  navButtons[VIEWS.indexOf('licensing')]._listeners.click[0]();
  await settle();
  return elements.view.innerHTML;
}

const admin = (status, extra = {}) => ({ getLicenseStatus: status, getAdvancedSettings: { isAdmin: true },
  getOwnerState: { initialized: false, unlocked: false }, getLicenseRemote: REMOTE, licenseSignupStatus: null, ...extra });

test('ניסיון: "תקופת ניסיון", נותרו X ימים, וכפתורי קנייה / קובץ / הדבקה', async () => {
  const html = await render(admin({ mode: 'licensed', status: 'active', features: ['econ'], limits: {}, reasons: [],
    trial: { startedAt: NOW - 5 * DAY, endsAt: NOW + 25 * DAY, daysLeft: 25, warn: false } }));
  assert.match(html, /lic-status lic-trial/);
  assert.match(html, /תקופת ניסיון/);
  assert.match(html, /נותרו 25 ימים/);
  assert.match(html, /id="licBuyBtn"/);
  assert.match(html, /id="licInstallBtn"/);
  assert.match(html, /id="licPasteBtn"/);
  assert.doesNotMatch(html, /מה לעשות/);
  assert.equal((html.match(/id="licInstallBtn"/g) || []).length, 1, 'כפתור אחד בלבד');
});

test('ניסיון בשבוע האחרון — "עומד לפוג"; בלי שרת — אין כפתור קנייה', async () => {
  const html = await render(admin({ mode: 'licensed', status: 'active', features: ['econ'], limits: {}, reasons: [],
    trial: { startedAt: NOW - 27 * DAY, endsAt: NOW + 3 * DAY, daysLeft: 3, warn: true } }, { getLicenseRemote: { url: '', pending: [] } }));
  assert.match(html, /lic-status lic-expiring/);
  assert.match(html, /נותרו 3 ימים/);
  assert.doesNotMatch(html, /licBuyBtn/);
  assert.match(html, /licPasteBtn/);
});

test('הרשמה שכבר התחילה בניסיון — כרטיס ההרשמה במקום כפתור הקנייה (תיקון: לא הופיע בניסיון)', async () => {
  const html = await render(admin({ mode: 'licensed', status: 'active', features: ['econ'], limits: {}, reasons: [],
    trial: { startedAt: NOW, endsAt: NOW + 30 * DAY, daysLeft: 30, warn: false } },
  { licenseSignupStatus: { planName: 'בסיסית', priceAgorot: 120000, status: 'pending' } }));
  assert.match(html, /הרשמה למערכת/);
  assert.match(html, /signupPayBtn/);
  assert.doesNotMatch(html, /licBuyBtn/);
});

test('ניסיון שהסתיים — צפייה בלבד ומה לעשות: קנייה ואז התקנה; הנתונים לא נמחקו', async () => {
  const html = await render(admin({ mode: 'licensed', status: 'trial_ended', features: ['econ'], limits: {},
    reasons: [{ kind: 'trial_ended', reason: 'תקופת הניסיון (30 יום) הסתיימה' }],
    trial: { startedAt: NOW - 40 * DAY, endsAt: NOW - 10 * DAY, daysLeft: 0, warn: true } }));
  assert.match(html, /lic-status lic-limited/);
  assert.match(html, /תקופת הניסיון הסתיימה/);
  assert.match(html, /אפשר לצפות בנתונים, לייצא ולגבות/);
  assert.match(html, /מה לעשות/);
  assert.match(html, /לחצו &quot;קניית רישיון&quot;|לחצו "קניית רישיון"/);
  assert.match(html, /לא נמחקו/);
  assert.match(html, /licGoMessagesBtn/);
  assert.match(html, /licBuyBtn/);
});

test('פעיל — "בתוקף עד"; 20 יום לפני התפוגה — "עומד לפוג"; תקופת חסד — "עומד לפוג"', async () => {
  const base = { mode: 'licensed', status: 'active', features: ['econ'], limits, reasons: [] };
  let html = await render(admin({ ...base, expiresAt: NOW + 200 * DAY }));
  assert.match(html, /lic-status lic-active/);
  assert.match(html, /הרישיון פעיל/);
  assert.match(html, /בתוקף עד/);
  assert.doesNotMatch(html, /licBuyBtn/, 'יש רישיון — אין קנייה');
  html = await render(admin({ ...base, expiresAt: NOW + 20 * DAY }));
  assert.match(html, /lic-status lic-expiring/);
  assert.match(html, /עוד 20 ימים/);
  html = await render(admin({ ...base, expiresAt: NOW - DAY, graceUntil: NOW + 6 * DAY }));
  assert.match(html, /תקופת חסד עד/);
});

test('נעול בגלל תנאי ההפעלה — מה לעשות לפי השלב (שרת / רישיון)', async () => {
  const st = (step) => ({ mode: 'licensed', status: 'locked', features: ['econ'], limits,
    reasons: [{ kind: 'locked', reason: 'חסר חיבור', source: 'activation', step }] });
  let html = await render(admin(st('server')));
  assert.match(html, /lic-status lic-locked/);
  assert.match(html, /המערכת נעולה/);
  assert.match(html, /התחברות לשרת עכשיו/);
  html = await render(admin(st('license')));
  assert.match(html, /הרישיון השנתי חסר או שפג/);
});

test('ממתין לתשלום / הושבת / תוקף הסתיים / קובץ חסר — צעדים מתאימים', async () => {
  const st = (status, reason, source) => ({ mode: 'licensed', status, features: ['econ'], limits, reasons: [{ kind: status, reason, ...(source ? { source } : {}) }] });
  let html = await render(admin(st('pending_payment', 'החיוב נכשל')));
  assert.match(html, /יש להסדיר את התשלום/);
  assert.match(html, /צפייה בלבד/);
  html = await render(admin(st('pending_payment', 'תוקף הרישיון הסתיים', 'billing')));
  assert.match(html, /פנו לספק לחידוש/);
  html = await render(admin(st('suspended', 'שיפוץ')));
  assert.match(html, /הושבתה זמנית/);
  html = await render(admin(st('locked', 'קובץ הרישוי חסר — יש להתקין שוב את קובץ הרישיון מהספק')));
  assert.match(html, /יש להתקין שוב את קובץ הרישיון/);
});

test('משתמש שאינו מנהל — מצב בלבד, בלי כפתורים', async () => {
  const html = await render({ getLicenseStatus: { mode: 'licensed', status: 'trial_ended', features: ['econ'], limits: {}, reasons: [],
    trial: { startedAt: NOW - 40 * DAY, endsAt: NOW - 10 * DAY, daysLeft: 0, warn: true } }, getAdvancedSettings: { isAdmin: false } });
  assert.match(html, /תקופת הניסיון הסתיימה/);
  assert.match(html, /למנהל בלבד/);
  assert.doesNotMatch(html, /licBuyBtn|licInstallBtn|licPasteBtn|licRequestBtn/);
});

test('ההגדרות המתקדמות מקופלות (פתוחות רק בלי רישוי או למנהל-העל)', async () => {
  let html = await render(admin({ mode: 'licensed', status: 'active', features: ['econ'], limits, reasons: [], expiresAt: NOW + 200 * DAY }));
  assert.match(html, /<details class="lic-advanced">/);
  assert.match(html, /licRequestBtn/);
  html = await render(admin({ mode: 'unlicensed', status: 'active' }));
  assert.match(html, /<details class="lic-advanced" open>/);
  assert.match(html, /פועלת ללא רישוי/);
});

test('licSummary: ארבעת המצבים', () => {
  const { context } = makeContext();
  const s = (st) => context.licSummary(st, NOW).kind;
  assert.equal(s({ mode: 'licensed', status: 'active', trial: { daysLeft: 10, endsAt: NOW + 10 * DAY, warn: false } }), 'trial');
  assert.equal(s({ mode: 'licensed', status: 'active', expiresAt: NOW + 100 * DAY }), 'active');
  assert.equal(s({ mode: 'licensed', status: 'active', expiresAt: NOW + 30 * DAY }), 'expiring');
  assert.equal(s({ mode: 'licensed', status: 'active', activation: { dueSoon: true, nextDue: NOW + 3 * DAY } }), 'expiring');
  assert.equal(s({ mode: 'licensed', status: 'locked', reasons: [] }), 'locked');
  assert.equal(s({ mode: 'licensed', status: 'terminated', reasons: [] }), 'locked');
  assert.equal(s({ mode: 'licensed', status: 'suspended', reasons: [] }), 'limited');
  assert.equal(s({ mode: 'unlicensed' }), 'unlicensed');
});

test('הדבקת קוד: אותה התקנה כמו קובץ — קוד תקין מתקין, קוד פגום נדחה בעברית', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/licensing-actions.js'), 'utf8');
  const i = src.indexOf("on('licPasteBtn'");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 500), /type: 'textarea'/);
  assert.match(src.slice(i, i + 500), /window\.systemAPI\.installLicense\(v\.code\)/);
  assert.match(src, /f\.type === 'textarea'/);

  let now = Date.now();
  const owner = createOwner({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-screen-')), passphrase: 'ohr-hachaim-owner-2026', clock: () => now });
  owner.init();
  const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
  const store = createLicenseStore({ storage: mem(), secret: mem(), rootKeys: [owner.pubkey()], clock: () => now });
  assert.throws(() => store.install('זה לא קוד'), /אינו קובץ רישוי תקין/);
  assert.throws(() => store.install('{"type":"other"}'), /אינו מהסוג המצופה/);
  const code = owner.issue({ request: store.request('קהילת אור'), features: ['econ'], limits, months: 12 }).package;
  // הדבקה מוסיפה לפעמים רווחים ושורות — JSON תקין עדיין
  store.install('\n  ' + code + '  \n');
  assert.equal(store.current().status, 'active');
  assert.equal(store.current().trial, undefined);
});

test('ipc: license:getStatus מחזיר תוקף ומקור הסיבה (לכרטיס המצב)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const i = src.indexOf("handle('license:getStatus'");
  const body = src.slice(i, i + 1400);
  assert.match(body, /expiresAt: leaf && Number\.isSafeInteger\(leaf\.expiresAt\)/);
  assert.match(body, /source: String\(r\.source\)/);
  assert.match(body, /step: String\(r\.step\)/);
});
