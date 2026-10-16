// תנאי ההפעלה של מערכת ברישיון (shell/licensing/activation.js):
// רישיון שנתי פעיל, חיבור לשרת ב-7 הימים האחרונים, וכניסה עם Google ב-7 הימים האחרונים. בלי שלושתם — נעולה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ACT = require('../shell/licensing/activation');
const L = require('../shell/licensing/license');
const { markActivated } = require('./helpers/activation');

const DAY = ACT.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const active = { mode: 'licensed', status: 'active' };
const yearLeaf = { issuedAt: T0, expiresAt: T0 + 365 * DAY };

test('התקנה בלי רישוי — אין דרישות הפעלה', () => {
  const r = ACT.evaluate({ state: { mode: 'unlicensed' }, now: T0 });
  assert.equal(r.required, false);
  assert.equal(r.ok, true);
});

test('שלושת התנאים: חסר אחד — נעול, עם הסיבה של אותו תנאי', () => {
  const now = T0 + 10 * DAY;
  const ok = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now - DAY, lastGoogle: now - 2 * DAY, now });
  assert.equal(ok.ok, true);
  assert.equal(ok.nextDue, now - 2 * DAY + 7 * DAY, 'התזכורת — לתנאי הקרוב לפקוע');

  const noSync = ACT.evaluate({ state: active, leaf: yearLeaf, lastGoogle: now, now });
  assert.deepEqual(noSync.missing, ['server']);
  assert.match(ACT.message(noSync), /עדיין לא היה חיבור לשרת/);

  const oldGoogle = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now, lastGoogle: now - 8 * DAY, now });
  assert.deepEqual(oldGoogle.missing, ['google']);
  assert.match(ACT.message(oldGoogle), /לא הייתה כניסה עם Google ב-7 הימים/);

  const none = ACT.evaluate({ state: active, leaf: null, now });
  assert.deepEqual(none.missing, ['license', 'server', 'google']);
});

test('רישיון קצר משנה — לא מפעיל; שנה עם סטייה קטנה בשעון — כן', () => {
  const now = T0 + DAY;
  const fresh = { lastSync: now, lastGoogle: now, now };
  const month = ACT.evaluate({ state: active, leaf: { issuedAt: T0, expiresAt: T0 + 30 * DAY }, ...fresh });
  assert.deepEqual(month.missing, ['license']);
  assert.match(ACT.message(month), /רישיון שנתי/);
  assert.equal(ACT.evaluate({ state: active, leaf: { issuedAt: T0, expiresAt: T0 + 364 * DAY }, ...fresh }).ok, true);
  // רישיון לא פעיל (חוב/השבתה) — התנאי לא מתקיים, אבל הסטטוס שלו נשאר (קריאה בלבד) — ראו ipc
  assert.deepEqual(ACT.evaluate({ state: { mode: 'licensed', status: 'pending_payment' }, leaf: yearLeaf, ...fresh }).missing, ['license']);
});

test('זמן "מהעתיד" (שעון שהוחזר) לא נחשב חיבור טרי', () => {
  const now = T0 + 10 * DAY;
  const r = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now + 30 * DAY, lastGoogle: now, now });
  assert.deepEqual(r.missing, ['server']);
});

test('משך רישיון: שנה = 365 יום, פחות מ-12 חודשים נדחה', () => {
  assert.equal(ACT.termMs(12), 365 * DAY);
  assert.equal(ACT.termMs(24), 730 * DAY);
  assert.equal(ACT.termMs(18), (365 + 180) * DAY);
  assert.throws(() => ACT.termMs(11), /לשנה לפחות/);
  assert.throws(() => ACT.termMs(0), /לשנה לפחות/);
  assert.throws(() => ACT.termMs(61), /ארוכה מדי/);
});

test('מנהל-העל ותכניות: אי אפשר להנפיק או לפרסם פחות משנה', () => {
  const OF = require('../shell/licensing/offer');
  const OC = require('../shell/licensing/owner-core');
  const plan = { id: 'p', name: 'חודשי', priceAgorot: 100, months: 1, features: ['econ'], limits: { maxUsers: 1, maxChildren: 0 } };
  const keys = L.generateKeyPair();
  assert.throws(() => OF.createOffer({ privateJwk: keys.privateJwk }, { plans: [plan], terms: { version: '1', text: 'תקנון' } }), /12–60 חודשים/);
  const mem = () => { const m = new Map(); return { read: (k) => (m.has(k) ? m.get(k) : null), write: (k, v) => m.set(k, v), list: () => [...m.keys()] }; };
  const owner = OC.createOwnerCore({ storage: mem(), clock: () => T0 });
  owner.init('owner-pass-very-long-2026');
  const req = { type: 'supersuite-license-request', v: 1, name: 'בדיקה', publicKey: L.generateKeyPair().publicJwk };
  req.keyId = L.keyId(req.publicKey);
  assert.throws(() => owner.issue({ request: JSON.stringify(req), features: ['econ'], limits: { maxUsers: 1, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 }, months: 6 }), /לשנה לפחות/);
  const lic = owner.issue({ request: JSON.stringify(req), features: ['econ'], limits: { maxUsers: 1, maxChildren: 0, maxStorageMb: 10, maxDepth: 1 } });
  const leaf = JSON.parse(lic.package).chain.at(-1).payload;
  assert.equal(leaf.expiresAt - leaf.issuedAt, 365 * DAY, 'ברירת המחדל — שנה מלאה');
});

// ---------- מסלול מלא דרך ipc: נעול עד שכל התנאים מתקיימים ----------
const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_act__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_act__.js'] = { id: '/__electron_stub_act__.js', filename: '/__electron_stub_act__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });
// מפתח המכשיר שהרישיון הונפק אליו (הרישיון קשור למפתח — store.js)
const keySecret = (k) => { let v = JSON.stringify(k.privateJwk); return { read: () => v, write: (t) => { v = t; } }; };

test('ipc: מערכת ברישיון שנתי נעולה עד חיבור לשרת וכניסה עם Google, ונפתחת מיד אחריהם', async () => {
  const root = L.generateKeyPair();
  const rootKeys = [root.publicJwk];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-act-'));
  let now = T0 + DAY;
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, { name: 'קהילת אור', publicKey: node.publicJwk, slot: 1,
    features: ['econ', 'tools'], limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7 });
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ chain: [lic], notices: [] }));
  const CLIENT_ID = '1234567890-abcdefghijk.apps.googleusercontent.com';
  await ipc.initEcon(dir, { rootKeys, clock: () => now, licenseSecret: keySecret(node),
    googleSignIn: async () => ({ sub: 'g-act-1', email: 'moshe@example.org' }) });

  await handlers['auth:setup'](ev(21), 'menahel_act', 'a-very-long-pass-2026');
  // בלי חיבור לשרת ובלי Google — נעול, עם הסיבה; מסך הרישוי והסטטוס פתוחים
  await assert.rejects(handlers['tasks:get'](ev(21)), /לא הופעלה: עדיין לא היה חיבור לשרת/);
  const st = await handlers['license:getStatus'](ev(21));
  assert.equal(st.status, 'locked');
  assert.deepEqual(st.activation.missing, ['server', 'google']);

  // חיבור לשרת (כמו שהסנכרון כותב) — עדיין חסר Google
  const file = path.join(dir, 'license.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.remote = { lastSync: now };
  fs.writeFileSync(file, JSON.stringify(d));
  ipc.invalidateLicense();
  await assert.rejects(handlers['tasks:get'](ev(21)), /כניסה עם Google/);

  // הגדרת Google והפעלה מסך הרישוי: ההגדרות פתוחות למנהל גם במערכת נעולה (אחרת אי אפשר להפעיל)
  await handlers['settings:saveGoogle'](ev(21), { enabled: true, clientId: CLIENT_ID });
  await handlers['auth:google-link'](ev(21));
  // הקישור עצמו הוא כניסה מאומתת מול Google — המערכת נפתחת מיד
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(21))).tasks));
  assert.equal((await handlers['license:getStatus'](ev(21))).status, 'active');

  // אחרי 8 ימים בלי כניסה עם Google — שוב נעול. כניסה עם Google פותחת
  now += 8 * DAY;
  markActivated(dir, now - 8 * DAY);
  const dd = JSON.parse(fs.readFileSync(file, 'utf8'));
  dd.remote.lastSync = now; // השרת מחובר
  fs.writeFileSync(file, JSON.stringify(dd));
  ipc.invalidateLicense();
  await assert.rejects(handlers['tasks:get'](ev(21)), /כניסה עם Google ב-7 הימים/);
  await handlers['auth:google-login'](ev(22));
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(22))).tasks));
});

test('ipc: חוב (pending_payment) נשאר קריאה בלבד — תנאי ההפעלה לא הופכים אותו לנעילה מלאה', async () => {
  const root = L.generateKeyPair();
  const S = require('../shell/licensing/status');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-act2-'));
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, { name: 'גמ"ח', publicKey: node.publicJwk, slot: 1,
    features: ['econ'], limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7 });
  const hold = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: lic.payload.id, kind: 'pending_payment',
    source: 'billing', reason: 'החיוב השנתי נכשל', issuedAt: T0 + DAY });
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ chain: [lic], notices: [hold] }));
  await ipc.initEcon(dir, { rootKeys: [root.publicJwk], clock: () => T0 + 2 * DAY, licenseSecret: keySecret(node) });
  await handlers['auth:setup'](ev(31), 'menahel_hov', 'a-very-long-pass-2026');
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(31))).tasks), 'הנתונים של הלקוח לא נלקחים כבני ערובה');
  await assert.rejects(handlers['tasks:create'](ev(31), { title: 'משימה' }), /ממתינה לתשלום: החיוב השנתי נכשל/);
});
