// מודול האימונים (trainer) עבר למוצר החינוכי הנפרד. תאימות לאחור במוצר הכלכלי:
// רישיון חתום והצעה חתומה מגרסה קודמת שכוללים את התכונה 'trainer' — עדיין מאומתים ונטענים; התכונה פשוט לא פותחת דבר.
// הצעה חדשה לא מציעה אותה. (שחזור גיבוי ישן עם localStorage.trainer — ב-tests/audit-backup-startup.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const G = require('../shell/licensing/gate');

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

test('הצעה חדשה: trainer אינו תחום מוצע — מסונן, ותכנית שזה כל מה שבה נדחית', () => {
  const root = L.generateKeyPair();
  assert.ok(!OF.FEATURES.includes('trainer'));
  assert.deepEqual(OF.LEGACY_FEATURES, ['trainer']);
  const base = { seller: { name: 'בונים סלר' }, terms: { version: '1.0', text: TERMS } };
  const text = OF.createOffer(root.privateJwk, { ...base, plans: [{ id: 'pro', name: 'מקצועי', priceAgorot: 100, months: 12, features: ['econ', 'trainer'] }] });
  assert.deepEqual(OF.verifyOffer(text, [root.publicJwk]).plans[0].features, ['econ']);
  assert.throws(() => OF.createOffer(root.privateJwk, { ...base, plans: [{ id: 'x', name: 'מאמנים', priceAgorot: 100, months: 12, features: ['trainer'] }] }), /לא נבחר אף תחום/);
});

test('רישיון חתום ישן עם trainer — השרשרת מאומתת, והשער מתעלם מהתכונה', () => {
  const root = L.generateKeyPair();
  const keys = L.generateKeyPair();
  const license = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'סטודיו ותלמוד תורה', publicKey: keys.publicJwk, slot: 1,
    features: ['econ', 'econ.npo', 'trainer', 'tools'],
    limits: { maxChildren: 0, maxUsers: 5, maxStorageMb: 1000, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7,
  });
  const chain = L.verifyChain([license], [root.publicJwk]);
  assert.ok(chain, 'השרשרת מאומתת');
  const payload = license.payload;
  assert.ok(payload.features.includes('trainer'));
  const state = { mode: 'licensed', status: 'active', features: payload.features, limits: payload.limits, reasons: [] };
  assert.equal(G.moduleAllowed(state, 'econ'), true);
  assert.equal(G.moduleAllowed(state, 'tools'), true);
  assert.equal(G.moduleAllowed(state, 'shamai'), false);
  assert.equal(G.moduleAllowed(state, 'trainer'), false, 'אין מודול כזה במוצר');
  assert.deepEqual(G.shellState(state).modules, { econ: true, shamai: false, tools: true });
  assert.deepEqual(G.peopleSources(state), ['npo'], 'מאגר האנשים בלי מתאמנים');
  assert.equal(G.checkChannel(state, 'npo:getOverview', 'data.view'), null);
  // רישיון של אימונים בלבד: שום מודול לא נפתח — וגם לא קריסה
  const only = { ...state, features: ['trainer'] };
  assert.deepEqual(G.shellState(only).modules, { econ: false, shamai: false, tools: false });
  assert.match(G.checkChannel(only, 'people:search', 'data.view'), /אינו כלול ברישיון/);
});
