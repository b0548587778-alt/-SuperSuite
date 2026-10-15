// רישוי והיררכיה — שלב 1: שרשרת רישיונות, מכסות, השבתה ב-Cascade (docs/LICENSING-DESIGN.md)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);

const root = L.generateKeyPair();
const rootKeys = [root.publicJwk];
const rootIssuer = { privateJwk: root.privateJwk };

function tenant(over = {}) {
  const keys = L.generateKeyPair();
  const license = L.issueLicense(rootIssuer, {
    name: 'תלמוד תורה אור החיים', publicKey: keys.publicJwk, slot: 1,
    features: ['econ', 'econ.npo', 'shamai', 'tools'],
    limits: { maxChildren: 3, maxUsers: 20, maxStorageMb: 5000, maxDepth: 2 },
    issuedAt: T0, expiresAt: T0 + 30 * DAY, graceDays: 7, ...over,
  });
  return { keys, license, issuer: { privateJwk: keys.privateJwk, license } };
}

function child(parent, over = {}) {
  const keys = L.generateKeyPair();
  const license = L.issueLicense(parent.issuer, {
    name: 'סניף בני ברק', publicKey: keys.publicJwk, slot: 1,
    features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 5, maxStorageMb: 1000, maxDepth: 2 },
    issuedAt: T0, expiresAt: T0 + 30 * DAY, graceDays: 7, ...over,
  });
  return { keys, license, issuer: { privateJwk: keys.privateJwk, license } };
}

const status = (chain, notices = [], now = T0 + DAY) => S.effectiveStatus({ chain, notices, rootKeys, now });

test('שרשרת תקינה מאומתת ומחזירה את הצומת האחרון', () => {
  const t = tenant(); const c = child(t);
  const node = L.verifyChain([t.license, c.license], rootKeys);
  assert.strictEqual(node.id, c.license.payload.id);
  assert.strictEqual(node.depth, 2);
});

test('JSON קנוני אינו תלוי בסדר המפתחות', () => {
  assert.strictEqual(L.canonical({ b: 1, a: [2, { d: 1, c: 0 }] }), L.canonical({ a: [2, { c: 0, d: 1 }], b: 1 }));
});

test('רישיון שנחתם במפתח שאינו מפתח השורש נדחה', () => {
  const fake = L.generateKeyPair();
  const keys = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: fake.privateJwk }, {
    name: 'מזויף', publicKey: keys.publicJwk, slot: 1, features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 1, maxStorageMb: 1, maxDepth: 1 }, issuedAt: T0, expiresAt: T0 + DAY,
  });
  assert.throws(() => L.verifyChain([lic], rootKeys), /חתימת הרישיון/);
});

test('שינוי של שדה אחרי החתימה נתפס', () => {
  const t = tenant();
  const tampered = JSON.parse(JSON.stringify(t.license));
  tampered.payload.limits.maxChildren = 999;
  assert.throws(() => L.verifyChain([tampered], rootKeys), /חתימת הרישיון/);
  const extra = JSON.parse(JSON.stringify(t.license));
  extra.payload.admin = true;
  assert.throws(() => L.verifyChain([extra], rootKeys), /פגום/);
});

test('אכיפה בהנפקה: ילד לא מקבל תכונה, מגבלה או תוקף מעבר להורה', () => {
  const t = tenant();
  assert.throws(() => child(t, { features: ['econ', 'trainer'] }), /trainer/);
  assert.throws(() => child(t, { limits: { maxChildren: 0, maxUsers: 50, maxStorageMb: 1, maxDepth: 2 } }), /maxUsers/);
  assert.throws(() => child(t, { expiresAt: T0 + 60 * DAY }), /תוקף/);
});

test('אכיפת מכסה: משבצת מעבר ל-maxChildren נחסמת', () => {
  const t = tenant();
  assert.doesNotThrow(() => child(t, { slot: 3 }));
  assert.throws(() => child(t, { slot: 4 }), /מכסת/);
});

test('מערכת בת ללא הרשאת הנפקה לא יכולה להנפיק', () => {
  const t = tenant(); const c = child(t);
  assert.throws(() => child(c), /אינו רשאי/);
});

test('עומק נוסף נתמך כשההורה מתיר אותו (בלי שינוי מבנה)', () => {
  const t = tenant({ limits: { maxChildren: 3, maxUsers: 20, maxStorageMb: 5000, maxDepth: 3 } });
  const c = child(t, { limits: { maxChildren: 2, maxUsers: 5, maxStorageMb: 1000, maxDepth: 3 } });
  const g = child(c, { limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 3 } });
  assert.strictEqual(L.verifyChain([t.license, c.license, g.license], rootKeys).depth, 3);
  assert.throws(() => child(g), /אינו רשאי/);
});

test('שרשרת מזויפת: לקוח שחותם בעצמו על רישיון עם יותר הרשאות נדחה באימות', () => {
  const t = tenant(); const keys = L.generateKeyPair();
  const payload = { ...child(t).license.payload, id: L.keyId(keys.publicJwk), publicKey: keys.publicJwk,
    features: ['econ', 'trainer'] };
  const forged = { payload, sig: L.signObject(payload, t.keys.privateJwk) };
  assert.throws(() => L.verifyChain([t.license, forged], rootKeys), /trainer/);
});

test('בידוד: רישיון של לקוח אחר אינו יכול לשמש כהורה', () => {
  const a = tenant(); const b = tenant(); const ca = child(a);
  assert.throws(() => L.verifyChain([b.license, ca.license], rootKeys), /חתימת|אינו שייך/);
});

test('סטטוס פעיל כברירת מחדל, עם התכונות והמגבלות של הצומת', () => {
  const t = tenant(); const c = child(t);
  const s = status([t.license, c.license]);
  assert.strictEqual(s.status, 'active');
  assert.deepStrictEqual(s.features, ['econ']);
  assert.strictEqual(s.limits.maxUsers, 5);
});

test('השבתה חייבת סיבה', () => {
  const t = tenant();
  assert.throws(() => S.createNotice(rootIssuer, { type: 'hold', target: t.license.payload.id, kind: 'suspended',
    source: 'owner', reason: '   ', issuedAt: T0 }), /סיבה/);
});

test('Cascade: השבתת לקוח משביתה את מערכת הבת, והחזרתו מחזירה אותה', () => {
  const t = tenant(); const c = child(t);
  const hold = S.createNotice(rootIssuer, { type: 'hold', target: t.license.payload.id, kind: 'suspended',
    source: 'owner', reason: 'בקשת הלקוח', issuedAt: T0 + DAY });
  const s1 = status([t.license, c.license], [hold], T0 + 2 * DAY);
  assert.strictEqual(s1.status, 'suspended');
  assert.strictEqual(s1.reasons[0].node, t.license.payload.id);
  const release = S.createNotice(rootIssuer, { type: 'release', target: t.license.payload.id,
    holdId: hold.payload.id, reason: 'חזרה לפעילות', issuedAt: T0 + 3 * DAY });
  assert.strictEqual(status([t.license, c.license], [hold, release], T0 + 4 * DAY).status, 'active');
});

test('Cascade: מערכת בת שהלקוח השבית נשארת מושבתת אחרי החזרת הלקוח', () => {
  const t = tenant(); const c = child(t);
  const own = S.createNotice(t.issuer, { type: 'hold', target: c.license.payload.id, kind: 'suspended',
    source: 'parent', reason: 'סניף סגור', issuedAt: T0 + DAY });
  const top = S.createNotice(rootIssuer, { type: 'hold', target: t.license.payload.id, kind: 'pending_payment',
    source: 'billing', reason: 'תשלום לא התקבל', issuedAt: T0 + 2 * DAY });
  const rel = S.createNotice(rootIssuer, { type: 'release', target: t.license.payload.id, holdId: top.payload.id,
    reason: 'התשלום התקבל', issuedAt: T0 + 3 * DAY });
  const chain = [t.license, c.license];
  assert.strictEqual(status([t.license], [own, top, rel], T0 + 4 * DAY).status, 'active');
  const s = status(chain, [own, top, rel], T0 + 4 * DAY);
  assert.strictEqual(s.status, 'suspended');
  assert.strictEqual(s.reasons[0].reason, 'סניף סגור');
});

test('מערכת בת לא יכולה לשחרר השבתה שההורה הטיל עליה', () => {
  const t = tenant(); const c = child(t);
  const hold = S.createNotice(t.issuer, { type: 'hold', target: c.license.payload.id, kind: 'locked',
    source: 'parent', reason: 'הפרת תנאים', issuedAt: T0 + DAY });
  const sneaky = S.createNotice(c.issuer, { type: 'release', target: c.license.payload.id, holdId: hold.payload.id,
    reason: 'שחרור עצמי', issuedAt: T0 + 2 * DAY });
  assert.strictEqual(status([t.license, c.license], [hold, sneaky], T0 + 3 * DAY).status, 'locked');
});

test('מערכת בת לא יכולה להשבית את ההורה, ולקוח לא יכול להשבית לקוח אחר', () => {
  const t = tenant(); const c = child(t); const other = tenant();
  const up = S.createNotice(c.issuer, { type: 'hold', target: t.license.payload.id, kind: 'locked',
    source: 'self', reason: 'ניסיון', issuedAt: T0 + DAY });
  const side = S.createNotice(other.issuer, { type: 'hold', target: t.license.payload.id, kind: 'locked',
    source: 'parent', reason: 'ניסיון', issuedAt: T0 + DAY });
  assert.strictEqual(status([t.license], [up, side], T0 + 2 * DAY).status, 'active');
});

test('Kill Switch: נעילה גלובלית רק במפתח השורש, וחלה על כל העץ', () => {
  const t = tenant(); const c = child(t);
  assert.throws(() => S.createNotice(t.issuer, { type: 'hold', target: S.ALL, kind: 'locked', source: 'owner',
    reason: 'x', issuedAt: T0 }), /מנהל-העל/);
  const kill = S.createNotice(rootIssuer, { type: 'hold', target: S.ALL, kind: 'locked', source: 'owner',
    reason: 'תחזוקת חירום', issuedAt: T0 + DAY });
  assert.strictEqual(status([t.license, c.license], [kill], T0 + 2 * DAY).status, 'locked');
});

test('סיום (terminate) גובר על הכול ואינו משתחרר', () => {
  const t = tenant();
  const term = S.createNotice(rootIssuer, { type: 'terminate', target: t.license.payload.id,
    reason: 'סיום התקשרות', issuedAt: T0 + DAY });
  const rel = S.createNotice(rootIssuer, { type: 'release', target: t.license.payload.id, holdId: term.payload.id,
    reason: 'x', issuedAt: T0 + 2 * DAY });
  assert.strictEqual(status([t.license], [term, rel], T0 + 3 * DAY).status, 'terminated');
});

test('תפוגה: חסד ואז pending_payment', () => {
  const t = tenant();
  const inGrace = status([t.license], [], T0 + 33 * DAY);
  assert.strictEqual(inGrace.status, 'active');
  assert.strictEqual(inGrace.graceUntil, T0 + 37 * DAY);
  assert.strictEqual(status([t.license], [], T0 + 38 * DAY).status, 'pending_payment');
});

test('הגנה מהחזרת שעון: lastSeen גובר על שעון מוקדם יותר', () => {
  const t = tenant();
  const s = S.effectiveStatus({ chain: [t.license], notices: [], rootKeys, now: T0 + DAY, lastSeen: T0 + 40 * DAY });
  assert.strictEqual(s.status, 'pending_payment');
});

test('הודעה עם חתימה פגומה מתעלמים ממנה', () => {
  const t = tenant();
  const hold = S.createNotice(rootIssuer, { type: 'hold', target: t.license.payload.id, kind: 'locked',
    source: 'owner', reason: 'x', issuedAt: T0 + DAY });
  hold.payload.kind = 'suspended';
  assert.strictEqual(status([t.license], [hold], T0 + 2 * DAY).status, 'active');
});

test('שרשרת לא תקינה = נעול, עם סיבה', () => {
  const t = tenant(); const c = child(t);
  const s = status([c.license]);
  assert.strictEqual(s.status, 'locked');
  assert.ok(s.invalid);
});
