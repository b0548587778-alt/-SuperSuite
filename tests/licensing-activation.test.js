// תנאי ההפעלה של מערכת ברישיון (shell/licensing/activation.js):
// רישיון שנתי פעיל וחיבור לשרת ב-30 הימים האחרונים. בלי שניהם — נעולה. כניסה עם Google אינה תנאי (PLAN.md 4.1).
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

test('שני התנאים: חסר אחד — נעול, עם הסיבה של אותו תנאי', () => {
  const now = T0 + 10 * DAY;
  const ok = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now - DAY, now });
  assert.equal(ok.ok, true);
  assert.equal(ok.nextDue, now - DAY + 30 * DAY, 'המועד הבא — 30 יום אחרי החיבור האחרון');
  assert.deepEqual(ok.steps.map(s => s.id), ['license', 'server'], 'אין שלב Google');

  const noSync = ACT.evaluate({ state: active, leaf: yearLeaf, now });
  assert.deepEqual(noSync.missing, ['server']);
  assert.match(ACT.message(noSync), /עדיין לא היה חיבור לשרת/);

  const none = ACT.evaluate({ state: active, leaf: null, now });
  assert.deepEqual(none.missing, ['license', 'server']);
});

test('חיבור לשרת: יום 29 — פתוח, יום 31 — נעול עם הסבר', () => {
  const last = T0 + DAY;
  const day29 = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: last, now: last + 29 * DAY });
  assert.equal(day29.ok, true);
  const day31 = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: last, now: last + 31 * DAY });
  assert.deepEqual(day31.missing, ['server']);
  assert.match(ACT.message(day31), /לא היה חיבור לשרת ב-30 הימים האחרונים/);
});

test('כניסה עם Google אינה תנאי: בלי כניסה כלל — פתוח', () => {
  const now = T0 + 5 * DAY;
  const r = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now, lastGoogle: 0, now });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('תזכורת: 7 ימים לפני הנעילה — dueSoon, לפני כן — לא', () => {
  const last = T0 + DAY;
  assert.equal(ACT.REMIND_DAYS, 7);
  assert.equal(ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: last, now: last + 22 * DAY }).dueSoon, false);
  assert.equal(ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: last, now: last + 23 * DAY }).dueSoon, true);
  // נעול — אין "תזכורת", יש נעילה
  assert.equal(ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: last, now: last + 31 * DAY }).dueSoon, false);
  assert.equal(ACT.evaluate({ state: { mode: 'unlicensed' }, now: last }).dueSoon, false);
});

test('רישיון קצר משנה — לא מפעיל; שנה עם סטייה קטנה בשעון — כן', () => {
  const now = T0 + DAY;
  const fresh = { lastSync: now, now };
  const month = ACT.evaluate({ state: active, leaf: { issuedAt: T0, expiresAt: T0 + 30 * DAY }, ...fresh });
  assert.deepEqual(month.missing, ['license']);
  assert.match(ACT.message(month), /רישיון שנתי/);
  assert.equal(ACT.evaluate({ state: active, leaf: { issuedAt: T0, expiresAt: T0 + 364 * DAY }, ...fresh }).ok, true);
  // רישיון לא פעיל (חוב/השבתה) — התנאי לא מתקיים, אבל הסטטוס שלו נשאר (קריאה בלבד) — ראו ipc
  assert.deepEqual(ACT.evaluate({ state: { mode: 'licensed', status: 'pending_payment' }, leaf: yearLeaf, ...fresh }).missing, ['license']);
});

test('זמן "מהעתיד" (שעון שהוחזר) לא נחשב חיבור טרי', () => {
  const now = T0 + 10 * DAY;
  const r = ACT.evaluate({ state: active, leaf: yearLeaf, lastSync: now + 30 * DAY, now });
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
  const secret = keySecret(node);
  await ipc.initEcon(dir, { rootKeys, clock: () => now, licenseSecret: secret });

  await handlers['auth:setup'](ev(21), 'menahel_act', 'a-very-long-pass-2026');
  // בלי חיבור לשרת — נעול, עם הסיבה; מסך הרישוי והסטטוס פתוחים
  await assert.rejects(handlers['tasks:get'](ev(21)), /לא הופעלה: עדיין לא היה חיבור לשרת/);
  const st = await handlers['license:getStatus'](ev(21));
  assert.equal(st.status, 'locked');
  assert.deepEqual(st.activation.missing, ['server']);

  // חיבור לשרת (כמו שהסנכרון כותב: בקובץ ובשומר המוצפן) — נפתח מיד, בלי Google. הקובץ לבדו כבר לא מספיק (ממצא 28)
  markActivated(dir, now);
  ipc.invalidateLicense();
  await assert.rejects(handlers['tasks:get'](ev(21)), /לא הופעלה: עדיין לא היה חיבור לשרת/);
  markActivated(dir, now, secret);
  ipc.invalidateLicense();
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(21))).tasks));
  const open = await handlers['license:getStatus'](ev(21));
  assert.equal(open.status, 'active');
  assert.equal(open.activation.dueSoon, false);

  // יום 25 — עדיין פתוח, עם תזכורת
  now += 24 * DAY;
  ipc.invalidateLicense();
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(21))).tasks));
  assert.equal((await handlers['license:getStatus'](ev(21))).activation.dueSoon, true);

  // יום 31 בלי חיבור — נעול. חיבור חדש פותח
  now += 7 * DAY;
  ipc.invalidateLicense();
  await assert.rejects(handlers['tasks:get'](ev(21)), /לא היה חיבור לשרת ב-30 הימים/);
  // עריכת הקובץ הגלוי כבר לא מחדשת (ממצא 28: הקובץ נקרא פעם אחת בלבד, במעבר מגרסה ישנה)
  markActivated(dir, now);
  ipc.invalidateLicense();
  await assert.rejects(handlers['tasks:get'](ev(21)), /לא היה חיבור לשרת ב-30 הימים/);
  // סנכרון אמיתי נרשם בשומר המוצפן (setRemoteSettings ← guard.lastSync) — כאן נכתב ישירות לשומר
  const o = JSON.parse(secret.read());
  secret.write(JSON.stringify({ ...o, guard: { ...o.guard, lastSync: now } }));
  ipc.invalidateLicense();
  assert.ok(Array.isArray((await handlers['tasks:get'](ev(21))).tasks));
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
