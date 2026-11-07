// מודול האימונים (trainer) — במוצר החינוכי הנפרד, וגם במהדורה המלאה (החלטת הבעלים 7.11.2026: "המלאה כוללת גם לימוד").
// רישיון חתום והצעה חתומה מגרסה קודמת שכוללים את התכונה 'trainer' — מאומתים, ובמהדורה המלאה התכונה פותחת את המודול;
// במהדורה חלקית — סגור (השער של המהדורה). (שחזור גיבוי עם localStorage.trainer — ב-tests/audit-backup-startup.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const G = require('../shell/licensing/gate');
const Edition = require('../shell/edition');

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n'.repeat(3).trim();

// הצעה שנחתמה בגרסה שבה 'trainer' היה תחום מוצע — חתימה ישירה על ה-payload, כמו createOffer הישן
function legacyOffer(root, plans) {
  const payload = {
    v: 1, seller: { name: 'בונים סלר', taxId: '' },
    plans: plans.map(p => ({ desc: '', currency: 'ILS', limits: { maxUsers: 3, maxChildren: 0, maxStorageMb: 1024, maxDepth: 1 }, ...p })),
    terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS, sha256: L.sha256Hex(TERMS) },
    issuer: L.keyId(root.privateJwk), issuedAt: 1,
  };
  return JSON.stringify({ type: OF.OFFER_TYPE, payload, sig: L.signObject(payload, root.privateJwk) });
}

test('הצעה חתומה ישנה עם התחום trainer — מאומתת, גם בתכנית שזה התחום היחיד שלה', () => {
  const root = L.generateKeyPair();
  const text = legacyOffer(root, [
    { id: 'trainer-only', name: 'מאמנים', priceAgorot: 19900, months: 12, features: ['trainer'] },
    { id: 'pro', name: 'מקצועי', priceAgorot: 49900, months: 12, features: ['econ', 'shamai', 'trainer', 'tools'] },
  ]);
  const o = OF.verifyOffer(text, [root.publicJwk]);
  assert.deepEqual(o.plans.map(p => p.id), ['trainer-only', 'pro']);
  assert.deepEqual(OF.planOf(o, 'pro').features, ['econ', 'shamai', 'trainer', 'tools'], 'ההצעה נשמרת כפי שנחתמה');
  // שינוי בהצעה הישנה עדיין נתפס
  const t = JSON.parse(text); t.payload.plans[1].priceAgorot = 1;
  assert.throws(() => OF.verifyOffer(JSON.stringify(t), [root.publicJwk]), /חתימת/);
});

test('הצעה חדשה: trainer ומודולי הלימוד הם תחומים מוצעים (מהדורה מלאה)', () => {
  const root = L.generateKeyPair();
  for (const f of ['trainer', 'english', 'math', 'school']) assert.ok(OF.FEATURES.includes(f), f);
  assert.deepEqual(OF.LEGACY_FEATURES, []);
  const base = { seller: { name: 'בונים סלר' }, terms: { version: '1.0', text: TERMS } };
  const text = OF.createOffer(root.privateJwk, { ...base, plans: [{ id: 'pro', name: 'מקצועי', priceAgorot: 100, months: 12, features: ['econ', 'trainer'] }] });
  assert.deepEqual(OF.verifyOffer(text, [root.publicJwk]).plans[0].features, ['econ', 'trainer']);
});

test('רישיון חתום ישן עם trainer — השרשרת מאומתת; במלאה פותח את המודול, במהדורה חלקית סגור', (t) => {
  t.after(() => Edition._setForTests('full'));
  const root = L.generateKeyPair();
  const keys = L.generateKeyPair();
  const license = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'סטודיו ותלמוד תורה', publicKey: keys.publicJwk, slot: 1,
    features: ['econ', 'econ.npo', 'trainer', 'tools'],
    limits: { maxChildren: 0, maxUsers: 5, maxStorageMb: 1000, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7,
  });
  assert.ok(L.verifyChain([license], [root.publicJwk]), 'השרשרת מאומתת');
  const state = { mode: 'licensed', status: 'active', features: license.payload.features, limits: license.payload.limits, reasons: [] };
  Edition._setForTests('full');
  assert.equal(G.moduleAllowed(state, 'trainer'), true);
  assert.equal(G.moduleAllowed(state, 'shamai'), false);
  assert.equal(G.moduleAllowed(state, 'school'), false, 'לא ברישיון');
  assert.equal(G.checkChannel(state, 'npo:getOverview', 'data.view'), null);
  Edition._setForTests('npo');
  assert.equal(G.moduleAllowed(state, 'trainer'), false, 'לימוד רק במלאה');
  assert.equal(G.moduleAllowed(state, 'econ'), true);
});
