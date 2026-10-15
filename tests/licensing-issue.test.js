// רישוי — שלב 3: כלי מנהל-העל, התקנת רישיון, הנפקת מערכות בת והשבתתן, ותאימות לאנדרואיד (crypto-lite + localStorage)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const C = require('../shell/licensing/crypto-lite');
const L = require('../shell/licensing/license');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwner } = require('../tools/licensing/owner');

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
const PASS = 'ohr-hachaim-owner-2026';
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function setup(clock = () => T0) {
  const owner = createOwner({ dir: tmp('ss-owner-'), passphrase: PASS, clock });
  owner.init();
  const rootKeys = [owner.pubkey()];
  const install = () => createLicenseStore({ storage: mem(), secret: mem(), rootKeys, clock });
  const tenantLimits = { maxChildren: 2, maxUsers: 10, maxStorageMb: 1000, maxDepth: 2 };
  const childLimits = { maxChildren: 0, maxUsers: 3, maxStorageMb: 100, maxDepth: 2 };
  return { owner, rootKeys, install, tenantLimits, childLimits };
}

// מערכת בת: לקוח מבקש אישור ← מנהל-העל מאשר ← הלקוח מנפיק
function approveAndIssue(owner, tenant, childStore, name, terms) {
  const req = tenant.requestChildApproval({ request: childStore.request(name), ...terms });
  return tenant.issueChild({ approval: owner.approve({ request: req.package }).package });
}

test('crypto-lite: תואם ל-node:crypto (SHA, מפתח ציבורי, חתימה ואימות)', () => {
  const msg = C.utf8('רישיון בדיקה '.repeat(40));
  assert.deepEqual(Buffer.from(C.sha256(msg)), crypto.createHash('sha256').update(msg).digest());
  assert.deepEqual(Buffer.from(C.sha512(msg)), crypto.createHash('sha512').update(msg).digest());
  const k = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  const seed = C.b64uDecode(k.d);
  assert.equal(C.b64uEncode(C.ed25519.getPublicKey(seed)), k.x);
  const native = crypto.sign(null, msg, crypto.createPrivateKey({ key: k, format: 'jwk' }));
  assert.deepEqual(Buffer.from(C.ed25519.sign(msg, seed)), native);
  assert.equal(C.ed25519.verify(new Uint8Array(native), msg, C.b64uDecode(k.x)), true);
  const bad = Uint8Array.from(native); bad[40] ^= 1;
  assert.equal(C.ed25519.verify(bad, msg, C.b64uDecode(k.x)), false);
  // וקטור בדיקה 1 מ-RFC 8032 §7.1
  const s1 = Uint8Array.from(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'));
  assert.equal(Buffer.from(C.ed25519.getPublicKey(s1)).toString('hex'), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  assert.equal(Buffer.from(C.ed25519.sign(new Uint8Array(0), s1)).toString('hex'),
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
});

test('אנדרואיד: רישיון שנחתם בשולחן העבודה מאומת במימוש הטהור, ולהפך', () => {
  const { owner, rootKeys, install, tenantLimits } = setup();
  const store = install();
  const pkg = owner.issue({ request: store.request('ישיבה'), features: ['econ'], limits: tenantLimits, months: 1 }).package;
  L._forceLite(true);
  try {
    assert.equal(L.verifyChain(JSON.parse(pkg).chain, rootKeys).name, 'ישיבה');
    const k = L.generateKeyPair();
    const lite = L.signObject({ a: 1 }, k.privateJwk);
    L._forceLite(false);
    assert.equal(L.verifyObject({ a: 1 }, lite, k.publicJwk), true);
  } finally { L._forceLite(false); }
});

test('Owner: מפתח השורש מוצפן בסיסמה, ולא נדרס', () => {
  const { owner } = setup();
  const dir = tmp('ss-owner2-');
  const o = createOwner({ dir, passphrase: PASS });
  o.init();
  assert.match(fs.readFileSync(path.join(dir, 'root.key'), 'utf8'), /^SSBK1:/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'root.key'), 'utf8'), /"d"/);
  assert.throws(() => o.init(), /לא נדרס/);
  assert.throws(() => createOwner({ dir, passphrase: 'wrong-pass-123456' }).pubkey(), /הסיסמה שגויה/);
  assert.throws(() => createOwner({ dir: tmp('x-'), passphrase: 'short' }).init(), /לפחות 12 תווים/);
  assert.ok(owner.pubkey().x);
});

test('זרימה מלאה: בקשה ← הנפקה ← התקנה ← מערכת פעילה', () => {
  const { owner, install, tenantLimits } = setup();
  const store = install();
  assert.equal(store.current().status, 'locked');
  const req = store.request('תלמוד תורה בית יוסף');
  const { package: pkg } = owner.issue({ request: req, features: ['econ', 'econ.npo', 'tools'], limits: tenantLimits, months: 12 });
  const r = store.install(pkg);
  assert.equal(r.name, 'תלמוד תורה בית יוסף');
  const st = store.current();
  assert.equal(st.status, 'active');
  assert.deepEqual(st.features, ['econ', 'econ.npo', 'tools']);
});

test('רישיון קשור למכשיר: התקנה במכשיר אחר נדחית', () => {
  const { owner, install, tenantLimits } = setup();
  const a = install(); const b = install();
  const { package: pkg } = owner.issue({ request: a.request('א'), features: ['econ'], limits: tenantLimits });
  b.request('ב');
  assert.throws(() => b.install(pkg), /הונפק למכשיר אחר/);
});

test('לקוח מנפיק מערכות בת במסגרת המכסה, וחידוש שומר משבצת', () => {
  const { owner, install, tenantLimits, childLimits } = setup();
  const tenant = install();
  tenant.install(owner.issue({ request: tenant.request('רשת'), features: ['econ', 'econ.npo'], limits: tenantLimits }).package);
  const c1 = install(); const c2 = install(); const c3 = install();
  const r1 = approveAndIssue(owner, tenant, c1, 'סניף א', { features: ['econ'], limits: childLimits, months: 6 });
  approveAndIssue(owner, tenant, c2, 'סניף ב', { features: ['econ'], limits: childLimits });
  assert.throws(() => approveAndIssue(owner, tenant, c3, 'סניף ג', { features: ['econ'], limits: childLimits }), /מלאה/);
  assert.match(owner.review({ request: tenant.requestChildApproval({ request: c3.request('סניף ג'), features: ['econ'], limits: childLimits }).package }).problem, /מלאה/);
  assert.throws(() => tenant.requestChildApproval({ request: c3.request('ג'), features: ['econ', 'trainer'], limits: childLimits }), /trainer/);
  const renewed = approveAndIssue(owner, tenant, c1, 'סניף א', { features: ['econ'], limits: childLimits, months: 12 });
  assert.equal(renewed.child.slot, r1.child.slot);
  c1.install(renewed.package);
  assert.equal(c1.current().status, 'active');
  assert.equal(c1.current().limits.maxUsers, 3);
  assert.equal(tenant.listChildren().length, 2);
});

test('לקוח לא מקבל להעניק יותר ממה שיש לו', () => {
  const { owner, install, tenantLimits } = setup();
  const tenant = install();
  tenant.install(owner.issue({ request: tenant.request('רשת'), features: ['econ'], limits: tenantLimits }).package);
  const c = install();
  assert.throws(() => tenant.requestChildApproval({ request: c.request('x'), features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 50, maxStorageMb: 1, maxDepth: 2 } }), /maxUsers/);
});

test('Cascade דרך קבצי הודעות: השבתת לקוח מגיעה למערכת הבת, והחזרתו לא משחררת השבתה של הלקוח', () => {
  let now = T0;
  const { owner, install, tenantLimits, childLimits } = setup(() => now);
  const tenant = install(); const child = install();
  tenant.install(owner.issue({ request: tenant.request('רשת'), features: ['econ'], limits: tenantLimits }).package);
  const { package: cpkg, child: info } = approveAndIssue(owner, tenant, child, 'סניף', { features: ['econ'], limits: childLimits });
  child.install(cpkg);

  now += DAY;
  const own = tenant.noticeForChild({ type: 'hold', childId: info.id, kind: 'suspended', reason: 'הסניף בשיפוץ' });
  child.importNotices(own.package);
  assert.equal(child.current().status, 'suspended');
  assert.equal(tenant.listChildren()[0].holds[0].reason, 'הסניף בשיפוץ');

  now += DAY;
  const tenantId = JSON.parse(cpkg).chain[0].payload.id;
  const top = owner.notice({ type: 'hold', target: tenantId, kind: 'pending_payment', source: 'billing', reason: 'החיוב נכשל' });
  tenant.importNotices(owner.noticesPackage(tenantId));
  assert.equal(tenant.current().status, 'pending_payment');
  assert.throws(() => tenant.requestChildApproval({ request: install().request('x'), features: ['econ'], limits: childLimits }), /אינה פעילה/);

  now += DAY;
  owner.notice({ type: 'release', target: tenantId, holdId: top.id, reason: 'התשלום התקבל' });
  tenant.importNotices(owner.noticesPackage(tenantId));
  child.importNotices(owner.noticesPackage(tenantId));
  assert.equal(tenant.current().status, 'active');
  assert.equal(child.current().status, 'suspended', 'ההשבתה של הלקוח עצמו נשארת');

  now += DAY;
  const rel = tenant.noticeForChild({ type: 'release', childId: info.id, holdId: own.notice.id, reason: 'השיפוץ הסתיים' });
  child.importNotices(rel.package);
  assert.equal(child.current().status, 'active');
});

test('הודעות לא נמחקות: ייבוא קובץ ישן לא מבטל השבתה', () => {
  let now = T0;
  const { owner, install, tenantLimits } = setup(() => now);
  const s = install();
  const { id } = owner.issue({ request: s.request('א'), features: ['econ'], limits: tenantLimits });
  const oldPkg = owner.noticesPackage(id);
  s.install(owner.issue({ request: s.request('א'), features: ['econ'], limits: tenantLimits }).package);
  now += DAY;
  owner.notice({ type: 'hold', target: id, kind: 'locked', source: 'owner', reason: 'הפרת תנאים' });
  s.importNotices(owner.noticesPackage(id));
  s.importNotices(oldPkg);
  s.install(owner.issue({ request: s.request('א'), features: ['econ'], limits: tenantLimits }).package);
  assert.equal(s.current().status, 'locked');
});

test('Kill Switch מכלי מנהל-העל נועל כל לקוח שמקבל אותו', () => {
  let now = T0;
  const { owner, install, tenantLimits } = setup(() => now);
  const s = install();
  const { id } = owner.issue({ request: s.request('א'), features: ['econ'], limits: tenantLimits });
  s.install(owner.issue({ request: s.request('א'), features: ['econ'], limits: tenantLimits }).package);
  now += DAY;
  owner.notice({ type: 'hold', target: '*', kind: 'locked', source: 'owner', reason: 'תחזוקת חירום' });
  s.importNotices(owner.noticesPackage(id));
  assert.equal(s.current().status, 'locked');
  assert.equal(owner.list()[0].status, 'locked');
});

test('ipc: ניהול רישוי למנהל בלבד; מצב הרישיון לכל משתמש; מפתח מוצפן ב-DPAPI', async () => {
  const dir = tmp('ss-lic3-');
  const { owner, rootKeys, tenantLimits } = setup(() => T0 + DAY);
  // safeStorage מדומה — ההצפנה האמיתית (DPAPI) לא זמינה בבדיקות
  const fakeSafe = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64')),
    decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString() };
  const { encryptedFileSecret } = require('../shell/licensing/store');
  await ipc.initEcon(dir, { rootKeys, clock: () => T0 + DAY, licenseSecret: encryptedFileSecret(fs, path.join(dir, 'license-key.bin'), fakeSafe) });

  await handlers['auth:setup'](ev(9), 'menahel_9', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(9), 'menahel_9', 'a-very-long-pass-2026');
  // מערכת נעולה (אין רישיון) — אבל התקנת רישיון עובדת
  await assert.rejects(handlers['tasks:get'](ev(9)), /לא הותקן רישיון/);
  const req = await handlers['license:getRequest'](ev(9), 'קהילת אור');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'license-key.bin'), 'utf8'), /"d"/);
  await handlers['license:install'](ev(9), owner.issue({ request: req, features: ['econ'], limits: tenantLimits }).package);
  assert.equal((await handlers['license:getStatus'](ev(9))).status, 'active');
  assert.ok(await handlers['tasks:get'](ev(9)));

  await handlers['users:create'](ev(9), { username: 'ozer_1', password: 'another-long-pass-2026', role: 'editor' });
  await handlers['auth:login'](ev(10), 'ozer_1', 'another-long-pass-2026');
  assert.equal((await handlers['license:getStatus'](ev(10))).status, 'active');
  await assert.rejects(handlers['license:getRequest'](ev(10), 'x'), /אין הרשאה/);
  await assert.rejects(handlers['license:listChildren'](ev(10)), /אין הרשאה/);

  const actions = (await ipc.getDb().all('SELECT action FROM audit_events')).map(r => r.action);
  assert.ok(actions.includes('license.request') && actions.includes('license.install'));
});

test('אנדרואיד: ipc בוחר localStorage כשרץ ב-WebView, עם המימוש הטהור', async () => {
  const items = new Map();
  global.window = { localStorage: { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, String(v)) } };
  L._forceLite(true);
  try {
    const { owner, rootKeys, tenantLimits } = setup(() => T0 + DAY);
    const dir = tmp('ss-lic-and-');
    await ipc.initEcon(dir, { rootKeys, clock: () => T0 + DAY });
    await handlers['auth:setup'](ev(11), 'menahel_11', 'a-very-long-pass-2026');
    await handlers['auth:login'](ev(11), 'menahel_11', 'a-very-long-pass-2026');
    const req = await handlers['license:getRequest'](ev(11), 'טלפון');
    assert.ok(items.has('supersuite.license.key'));
    await handlers['license:install'](ev(11), owner.issue({ request: req, features: ['econ'], limits: tenantLimits }).package);
    assert.ok(items.has('supersuite.license'));
    assert.equal(fs.existsSync(path.join(dir, 'license.json')), false);
    assert.equal((await handlers['license:getStatus'](ev(11))).status, 'active');
  } finally {
    L._forceLite(false);
    delete global.window;
  }
});

test('אישור: לקוח לא יכול להנפיק בלי אישור, ואישור של לקוח אחר נדחה', () => {
  const { owner, install, tenantLimits, childLimits } = setup();
  const a = install(); const b = install(); const c = install();
  a.install(owner.issue({ request: a.request('רשת א'), features: ['econ'], limits: tenantLimits }).package);
  b.install(owner.issue({ request: b.request('רשת ב'), features: ['econ'], limits: tenantLimits }).package);
  const req = b.requestChildApproval({ request: c.request('סניף'), features: ['econ'], limits: childLimits });
  const approvalForB = owner.approve({ request: req.package }).package;
  assert.throws(() => a.issueChild({ approval: approvalForB }), /אינו מיועד/);
  assert.throws(() => a.issueChild({ approval: '{"type":"supersuite-approval","approval":null}' }), /אינו מיועד/);
  assert.equal(b.issueChild({ approval: approvalForB }).child.name, 'סניף');
});

test('אישור: ביטול מסיים את מערכת הבת ומפנה משבצת', () => {
  let now = T0;
  const { owner, install, tenantLimits, childLimits } = setup(() => now);
  const t = install();
  t.install(owner.issue({ request: t.request('רשת'), features: ['econ'], limits: { ...tenantLimits, maxChildren: 1 } }).package);
  const c1 = install(); const c2 = install();
  const { child: info, package: pkg } = approveAndIssue(owner, t, c1, 'סניף א', { features: ['econ'], limits: childLimits });
  c1.install(pkg);
  assert.throws(() => approveAndIssue(owner, t, c2, 'סניף ב', { features: ['econ'], limits: childLimits }), /מלאה/);
  now += DAY;
  owner.revoke({ childId: info.id, reason: 'הסניף נסגר' });
  c1.importNotices(owner.noticesPackage(info.id));
  assert.equal(c1.current().status, 'terminated');
  assert.equal(approveAndIssue(owner, t, c2, 'סניף ב', { features: ['econ'], limits: childLimits }).child.slot, 1);
  assert.equal(owner.approvals().filter(x => x.revoked).length, 1);
});
