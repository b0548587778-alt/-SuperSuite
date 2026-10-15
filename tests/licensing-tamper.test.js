// רגרסיה (סקירת אבטחה 10.2026, ממצא 7): קובץ הרישוי גלוי, ולכן עריכה ידנית שלו לא אמורה לבטל השבתה
// או להחזיר רישיון שפג. השומר נשמר בקובץ המוצפן של מפתח הצומת (DPAPI בשולחן העבודה).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const { createLicenseStore, fileStorage, PKG_NOTICES } = require('../shell/licensing/store');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };

function setup({ legacySecret = true } = {}) {
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'ישיבת תפארת ציון', publicKey: node.publicJwk, slot: 1, features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 30 * DAY, graceDays: 7,
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tamper-')), 'license.json');
  const secret = mem();
  secret.write(legacySecret ? JSON.stringify(node.privateJwk) : JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  const write = (d) => fs.writeFileSync(file, JSON.stringify(d));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = (clock = () => T0 + DAY) => createLicenseStore({ storage: fileStorage(fs, file), secret, rootKeys, clock });
  const hold = (target = lic.payload.id) => S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target, kind: 'locked', source: 'owner', reason: 'חוב פתוח', issuedAt: T0 + DAY });
  return { node, lic, file, secret, write, read, store, hold };
}

test('מחיקת השבתה מהקובץ — נעול, עם הסבר; ייבוא ההודעות מחדש מחזיר את המצב האמיתי', () => {
  const t = setup();
  const h = t.hold();
  t.write({ chain: [t.lic], notices: [h] });
  const s = t.store();
  assert.equal(s.current().reasons[0].reason, 'חוב פתוח');
  t.write({ ...t.read(), notices: [] }); // "עריכה" ידנית
  s.invalidate();
  const st = s.current();
  assert.equal(st.status, 'locked');
  assert.match(st.reasons[0].reason, /שונה מחוץ לתוכנה.*חסרות 1 הודעות/);
  s.importNotices(JSON.stringify({ type: PKG_NOTICES, v: 1, notices: [h] }));
  assert.equal(s.current().reasons[0].reason, 'חוב פתוח', 'אחרי הייבוא — ההשבתה עצמה, לא הודעת העריכה');
});

test('איפוס lastSeen בקובץ והחזרת השעון — הרישיון שפג לא חוזר', () => {
  const t = setup();
  t.write({ chain: [t.lic], notices: [] });
  assert.equal(t.store(() => T0 + 40 * DAY).current().status, 'pending_payment');
  t.write({ ...t.read(), lastSeen: 0 });
  assert.equal(t.store(() => T0 + DAY).current().status, 'pending_payment');
});

test('רישיון בלי מפתח הצומת (הקובץ המוצפן נמחק או הועתק רישיון ממחשב אחר) — נעול', () => {
  const t = setup();
  t.write({ chain: [t.lic], notices: [] });
  const empty = createLicenseStore({ storage: fileStorage(fs, t.file), secret: mem(), rootKeys, clock: () => T0 + DAY }).current();
  assert.equal(empty.status, 'locked');
  assert.match(empty.reasons[0].reason, /מפתח המערכת חסר או אינו תואם/);
  const other = mem(); other.write(JSON.stringify(L.generateKeyPair().privateJwk));
  assert.equal(createLicenseStore({ storage: fileStorage(fs, t.file), secret: other, rootKeys, clock: () => T0 + DAY }).current().status, 'locked');
  const broken = { read() { throw new Error('DPAPI'); }, write() {} };
  assert.match(createLicenseStore({ storage: fileStorage(fs, t.file), secret: broken, rootKeys, clock: () => T0 + DAY }).current().reasons[0].reason, /לא ניתן לקרוא את מפתח המערכת/);
});

test('קובץ מפתח מגרסה קודמת: מומר לשומר בלי לאבד את המפתח', () => {
  const t = setup();
  const h = t.hold();
  t.write({ chain: [t.lic], notices: [h] });
  const s = t.store();
  s.current();
  const sec = JSON.parse(t.secret.read());
  assert.equal(sec.v, 2);
  assert.deepEqual(sec.key, t.node.privateJwk);
  assert.deepEqual(sec.guard.notices, [h.payload.id]);
  assert.deepEqual(s.syncKey(false), t.node.privateJwk, 'מפתח הסנכרון — אותו מפתח');
});

test('הודעה שהמערכת הוציאה למערכת בת אינה בשומר — קובץ פגום והתקנה מחדש לא נועלים אותה לתמיד', () => {
  const t = setup({ legacySecret: false });
  t.write({ chain: [t.lic], notices: [] });
  const s = t.store();
  s.importNotices(JSON.stringify({ type: PKG_NOTICES, v: 1, notices: [t.hold('child-node-id-0000000')] }));
  assert.deepEqual(JSON.parse(t.secret.read()).guard.notices, []);
  t.write({ ...t.read(), notices: [] });
  s.invalidate();
  assert.equal(s.current().status, 'active');
});

test('שמירה רגילה (הגדרות שרת) מעדכנת את השומר ולא מוחקת ממנו', () => {
  const t = setup();
  const h = t.hold();
  t.write({ chain: [t.lic], notices: [h] });
  const s = t.store();
  s.current();
  s.setRemoteSettings({ url: 'https://relay.example.org' });
  assert.deepEqual(JSON.parse(t.secret.read()).guard.notices, [h.payload.id]);
});
