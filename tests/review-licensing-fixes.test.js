'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — רישוי וכתיבה בטוחה: הודעה ששונתה, השחתת קובץ המפתח, זמן הסנכרון
// מהשומר, רישיון ישן, וכתיבה עם fsync בקובצי הרישוי ובמחסן המוצפן
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const { createLicenseStore, fileStorage, encryptedFileSecret, PKG_LICENSE } = require('../shell/licensing/store');
const { createSecureStore } = require('../shell/secure-store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-review-lic-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const newDir = () => fs.mkdtempSync(path.join(tmp, 'd-'));

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };

function setup() {
  const node = L.generateKeyPair();
  const issue = (issuedAt, features = ['econ']) => L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'ישיבת תפארת ציון', publicKey: node.publicJwk, slot: 1, features,
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 },
    issuedAt, expiresAt: issuedAt + 365 * DAY, graceDays: 7,
  });
  const lic = issue(T0);
  const file = path.join(newDir(), 'license.json');
  const secret = mem();
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  const write = (d) => fs.writeFileSync(file, JSON.stringify(d));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = (clock = () => T0 + DAY) => createLicenseStore({ storage: fileStorage(fs, file), secret, rootKeys, clock });
  return { node, issue, lic, file, secret, write, read, store };
}

test('השעיה: שינוי תו אחד בהודעה (שמבטל את החתימה) — נעול, ולא חזרה לפעילות', () => {
  const t = setup();
  const h = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: t.lic.payload.id, kind: 'locked', source: 'owner', reason: 'חוב פתוח', issuedAt: T0 + DAY });
  t.write({ chain: [t.lic], notices: [] });
  const s = t.store();
  s.importNotices(JSON.stringify({ type: 'supersuite-license-notices', v: 1, notices: [h] }));
  assert.equal(s.current().reasons[0].reason, 'חוב פתוח');
  const d = t.read();
  d.notices[0].payload.reason = 'חוב פתוך';
  t.write(d);
  s.invalidate();
  const st = s.current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /הודעות סטטוס שונו/);
});

test('קובץ מפתח שלא נקרא + קובץ רישיון שנמחק — נעול, לא תקופת ניסיון חדשה', () => {
  const file = path.join(newDir(), 'license.json');
  const secret = { read: () => { throw new Error('פגום'); }, write: () => {} };
  const st = createLicenseStore({ storage: fileStorage(fs, file), secret, rootKeys, clock: () => T0 }).current();
  assert.equal(st.status, 'locked');
  assert.ok(!st.trial);
});

test('זמן הסנכרון האחרון — מהשומר: עריכת הקובץ ל"היום" לא מחדשת את החיבור לשרת', () => {
  const t = setup();
  t.write({ chain: [t.lic], notices: [] });
  const s = t.store();
  // לפני סנכרון בגרסה הזו — מהקובץ (מעבר משדרוג)
  t.write({ ...t.read(), remote: { lastSync: T0 } });
  assert.equal(s.lastSyncTime(), T0);
  s.setRemoteSettings({ lastSync: T0 + DAY });
  t.write({ ...t.read(), remote: { lastSync: T0 + 300 * DAY } });
  assert.equal(s.lastSyncTime(), T0 + DAY);
});

test('רישיון ישן מהמותקן — נדחה; אותו רישיון או חדש יותר — מותקן', () => {
  const t = setup();
  const pkg = (lic) => JSON.stringify({ type: PKG_LICENSE, v: 1, chain: [lic], notices: [] });
  const s = t.store();
  const newer = t.issue(T0 + 10 * DAY, ['econ', 'shamai']);
  s.install(pkg(newer));
  assert.throws(() => s.install(pkg(t.lic)), /ישן מהרישיון המותקן/);
  assert.equal(t.read().chain[0].payload.issuedAt, T0 + 10 * DAY);
  s.install(pkg(newer));
  s.install(pkg(t.issue(T0 + 20 * DAY)));
  assert.equal(t.read().chain[0].payload.issuedAt, T0 + 20 * DAY);
});

// fs שרושם fsync — הכתיבה עוברת דרך קובץ זמני שנכתב לדיסק לפני ההחלפה
function spyFs() {
  const calls = [];
  return { calls, fs: { ...fs, fsyncSync: (fd) => { calls.push('fsync'); return fs.fsyncSync(fd); }, renameSync: (a, b) => { calls.push('rename'); return fs.renameSync(a, b); } } };
}

test('קובצי הרישוי ומפתח המערכת: קובץ זמני, fsync ואז החלפה', () => {
  const dir = newDir();
  const spy = spyFs();
  fileStorage(spy.fs, path.join(dir, 'license.json')).write('{"a":1}');
  assert.deepEqual(spy.calls, ['fsync', 'rename']);
  assert.equal(fs.readFileSync(path.join(dir, 'license.json'), 'utf8'), '{"a":1}');
  const safe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('X' + s), decryptString: (b) => b.toString().slice(1) };
  const spy2 = spyFs();
  const sec = encryptedFileSecret(spy2.fs, path.join(dir, 'license-key.bin'), safe);
  sec.write('secret');
  assert.deepEqual(spy2.calls, ['fsync', 'rename']);
  assert.equal(sec.read(), 'secret');
  assert.ok(!fs.existsSync(path.join(dir, 'license-key.bin.tmp')));
  // בלי fsync (התחליף של אנדרואיד) — עדיין קובץ זמני והחלפה
  const noSync = { readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync };
  fileStorage(noSync, path.join(dir, 'b.json')).write('x');
  assert.equal(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'), 'x');
});

test('המחסן המוצפן של השמאי והאימונים: fsync לפני ההחלפה', () => {
  const spy = spyFs();
  const key = crypto.randomBytes(32).toString('base64');
  const s = createSecureStore({ fs: spy.fs, dir: newDir(), mod: 'trainer', getBackupKey: () => key, schedule: (fn) => { fn(); return 0; } });
  spy.calls.length = 0;
  assert.ok(s.set('x', '1'));
  assert.deepEqual(spy.calls, ['fsync', 'rename']);
});
