// מרכז הרישוי: מנהל-העל ב-SuperSuite מנפיק רישיונות לכל התוכנות (SuperSuite, SuperSuite לימוד, שיר סטודיו, VidLearn) —
// לכל תוכנה בנפרד, לחבילת משפחה ולכל התוכנות יחד (shell/licensing/products.js, offer.js, owner-core.js, server/license-relay.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const P = require('../shell/licensing/products');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const { createLicenseStore, PKG_REQUEST } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createRemote } = require('../shell/licensing/remote');
const { createServer } = require('../server/license-relay');

const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const TERMS = 'תקנון השימוש בתוכנות של הספק.\n1. השימוש כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'תלמוד תורה אור החיים', contact: 'אברהם לוי', phone: '052-7654321', email: '', taxId: '' };
const LIMITS = { maxUsers: 5, maxChildren: 0 };
const MASTER = {
  seller: { name: 'בונים סלר' },
  plans: [
    { id: 'econ', name: 'כלכלה', priceAgorot: 49900, months: 12, scope: 'supersuite', features: { supersuite: ['econ', 'econ.npo'] }, limits: LIMITS },
    { id: 'learn-all', name: 'חבילת לימוד', priceAgorot: 0, months: 12, scope: 'family:learn',
      features: { learn: ['econ', 'english', 'math'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] }, limits: LIMITS },
    { id: 'shir', name: 'שיר סטודיו', priceAgorot: 19900, months: 12, scope: 'shir-studio', features: { 'shir-studio': ['shir-studio'] }, limits: LIMITS },
  ],
  terms: { version: '2.0', title: 'תקנון', text: TERMS },
};
const requestFor = (product, name = 'מערכת') => {
  const k = L.generateKeyPair();
  return JSON.stringify({ type: PKG_REQUEST, v: 1, name, publicKey: k.publicJwk, keyId: k.keyId, ...(product ? { product } : {}) });
};
const freshOwner = () => { const owner = createOwnerCore({ storage: mem() }); const rootKeys = [owner.init('menahel-al-products-2026').publicKey]; return { owner, rootKeys }; };

test('קטלוג: ארבע תוכנות בשתי משפחות, היקפים ותחומים לפי תוכנה', () => {
  assert.deepEqual(P.PRODUCTS.map(p => p.id), ['supersuite', 'learn', 'shir-studio', 'vidlearn']);
  assert.deepEqual(P.productsOfScope('family:learn'), ['learn', 'shir-studio', 'vidlearn']);
  assert.deepEqual(P.productsOfScope('all'), ['supersuite', 'learn', 'shir-studio', 'vidlearn']);
  assert.equal(P.productsOfScope('family:nope'), null);
  assert.deepEqual(P.scopes().map(s => s.id), ['supersuite', 'learn', 'shir-studio', 'vidlearn', 'family:learn', 'all']);
  // התחומים של SuperSuite — אותם תחומים של ההצעה (וגם של תקופת הניסיון)
  assert.deepEqual(OF.FEATURES, P.featuresOf('supersuite'));
  assert.equal(P.checkFeatures('shir-studio', ['shir-studio']), null);
  assert.match(P.checkFeatures('shir-studio', ['econ']), /אינם של שיר סטודיו/);
  assert.match(P.checkFeatures('learn', []), /לא נבחר/);
  assert.equal(P.checkFeatures('learn', ['econ', 'english']), null);
  // רישיון ישן בלי מוצר — לפי התחומים
  assert.equal(P.productOfFeatures(['econ', 'english']), 'learn');
  assert.equal(P.productOfFeatures(['shir-studio']), 'shir-studio');
  assert.equal(P.productOfFeatures(['econ', 'tools']), 'supersuite');
});

test('הצעה ראשית ← הצעה חתומה לכל תוכנה; החבילה חתומה בתכנית, והצעה של תוכנה אחרת נדחית', () => {
  const root = L.generateKeyPair();
  const master = OF.cleanMaster(MASTER);
  const parts = OF.splitMaster(master);
  assert.deepEqual(Object.keys(parts).sort(), ['learn', 'shir-studio', 'supersuite', 'vidlearn']);
  assert.deepEqual(parts.supersuite.plans.map(p => p.id), ['econ']);
  assert.deepEqual(parts['shir-studio'].plans.map(p => p.id), ['learn-all', 'shir']);
  const texts = Object.fromEntries(Object.entries(parts).map(([pid, x]) => [pid, OF.createOffer(root.privateJwk, x, { issuedAt: 7, product: pid })]));
  const learn = OF.verifyOffer(texts.learn, [root.publicJwk], { expectProduct: 'learn' });
  assert.equal(learn.product, 'learn');
  assert.deepEqual(learn.plans[0].features, ['econ', 'english', 'math']);
  assert.deepEqual(learn.plans[0].bundle.products, ['learn', 'shir-studio', 'vidlearn']);
  assert.deepEqual(learn.plans[0].bundle.features.vidlearn, ['vidlearn']);
  // SuperSuite לא מקבלת הצעה של תוכנה אחרת (גם כשהחתימה תקינה)
  assert.throws(() => OF.verifyOffer(texts.learn, [root.publicJwk], { expectProduct: 'supersuite' }), /תוכנה אחרת/);
  // הצעה בלי product (גרסה קודמת) — של SuperSuite
  const old = OF.createOffer(root.privateJwk, { seller: MASTER.seller, terms: MASTER.terms, plans: [{ id: 'a', name: 'א', priceAgorot: 0, months: 12, features: ['econ'], limits: LIMITS }] });
  const t = JSON.parse(old); delete t.payload.product; t.sig = L.signObject(t.payload, root.privateJwk);
  assert.equal(OF.productOfOffer(OF.verifyOffer(JSON.stringify(t), [root.publicJwk], { expectProduct: 'supersuite' })), 'supersuite');
  // חבילה ששונתה (תחום נוסף שלא שולם) — החתימה נפסלת
  const bad = JSON.parse(texts.learn); bad.payload.plans[0].bundle.features.vidlearn.push('x');
  assert.throws(() => OF.verifyOffer(JSON.stringify(bad), [root.publicJwk]), /חתימת/);
  // תכנית בחבילה בלי תחום באחת התוכנות — נדחית בשמירה
  const noVid = JSON.parse(JSON.stringify(MASTER)); noVid.plans[1].features.vidlearn = [];
  assert.throws(() => OF.cleanMaster(noVid), /לא נבחר אף תחום בVidLearn/);
  // תחום של תוכנה אחרת לא נכנס — בשני הכיוונים. (עד המיזוג עם קו המהדורות הדוגמה כאן הייתה 'english'; מאז שמודולי
  // הלימוד הם חלק מהמהדורה המלאה — החלטת הבעלים 7.11.2026 — השם הזה חוזר בשתי התוכנות, כמו 'econ' ו-'tools';
  // tests/licensing-editions-merge.test.js בודק שמהדורה חלקית לא מקבלת אותו)
  const mixed = JSON.parse(JSON.stringify(MASTER)); mixed.plans[0].features.supersuite = ['shir-studio'];
  assert.throws(() => OF.cleanMaster(mixed), /לא נבחר אף תחום/);
  const mixed2 = JSON.parse(JSON.stringify(MASTER)); mixed2.plans[0].features.supersuite = ['vidlearn', 'x'];
  assert.throws(() => OF.cleanMaster(mixed2), /לא נבחר אף תחום/);
  const mixed3 = JSON.parse(JSON.stringify(MASTER)); mixed3.plans[1].features.learn = ['econ.npo', 'shamai'];
  assert.throws(() => OF.cleanMaster(mixed3), /לא נבחר אף תחום בSuperSuite לימוד/);
  // תחום זר לצד תחום אמיתי — מסונן, ולא נכנס להצעה
  const mixed4 = JSON.parse(JSON.stringify(MASTER)); mixed4.plans[0].features.supersuite = ['econ', 'shir-studio'];
  assert.deepEqual(OF.cleanMaster(mixed4).plans[0].features.supersuite, ['econ']);
  // תכנית מגרסה קודמת (features מערך) — של SuperSuite
  assert.equal(OF.cleanMaster({ ...MASTER, plans: [{ id: 'x', name: 'ישן', priceAgorot: 0, months: 12, features: ['econ'], limits: LIMITS }] }).plans[0].scope, 'supersuite');
});

test('מנהל-העל: הנפקה לפי תוכנה — מהבקשה, בבחירה, או לפי התחומים; תחומים של תוכנה אחרת נדחים', () => {
  const { owner, rootKeys } = freshOwner();
  // שיר סטודיו שולח product בבקשה
  const shirReq = requestFor('shir-studio', 'אולפן זמר');
  const open = owner.openRequest(shirReq);
  assert.equal(open.product, 'shir-studio');
  assert.throws(() => owner.issue({ request: shirReq, features: ['econ'], limits: { maxUsers: 1, maxChildren: 0, maxDepth: 1, maxStorageMb: 100 } }), /אינם של שיר סטודיו/);
  assert.throws(() => owner.issue({ request: shirReq, product: 'learn', features: ['econ'], limits: { maxUsers: 1, maxChildren: 0, maxDepth: 1, maxStorageMb: 100 } }), /נשלחה משיר סטודיו/);
  const r = owner.issue({ request: shirReq, features: ['shir-studio'], limits: { maxUsers: 1, maxChildren: 0, maxDepth: 1, maxStorageMb: 100 } });
  assert.equal(r.product, 'shir-studio');
  const lic = JSON.parse(r.package).chain;
  assert.deepEqual(L.verifyChain(lic, rootKeys).features, ['shir-studio']);
  // בקשה בלי product (SuperSuite לימוד בגרסה הנוכחית) — מנהל-העל בוחר
  const eduReq = requestFor(null, 'סמינר');
  assert.equal(owner.openRequest(eduReq).product, null);
  assert.equal(owner.issue({ request: eduReq, product: 'learn', features: ['econ', 'school'], limits: { maxUsers: 3, maxChildren: 0, maxDepth: 1, maxStorageMb: 100 } }).product, 'learn');
  // כלי שורת הפקודה (בלי product): לפי התחומים
  const cliReq = requestFor(null, 'עסק');
  assert.equal(owner.issue({ request: cliReq, features: ['econ', 'econ.accounting'], limits: { maxUsers: 3, maxChildren: 0, maxDepth: 1, maxStorageMb: 100 } }).product, 'supersuite');
  const list = owner.list();
  assert.deepEqual(list.tenants.map(t => t.product), ['shir-studio', 'learn', 'supersuite']);
  assert.equal(list.products.thisProduct, 'supersuite');
  // חידוש של לקוח קיים — המוצר נשמר גם כשהבקשה החדשה לא מציינת אותו
  assert.equal(owner.openRequest(eduReq).productGuess, 'learn');
});

test('בקשה של SuperSuite מציינת את התוכנה, וההנפקה מההרשמה — לפי המוצר של ההצעה', () => {
  const { rootKeys } = freshOwner();
  const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
  assert.equal(store.request('בדיקה').product, 'supersuite');
  const root = L.generateKeyPair();
  const dev = L.generateKeyPair();
  const parts = OF.splitMaster(OF.cleanMaster(MASTER));
  const offerText = OF.createOffer(root.privateJwk, parts.learn, { issuedAt: 3, product: 'learn' });
  const su = SU.createSignup({ deviceJwk: dev.privateJwk, offerText, rootKeys: [root.publicJwk], planId: 'learn-all', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at: 9 });
  const v = SU.verifySignup(su.text, [root.publicJwk]);
  assert.equal(v.product, 'learn');
  assert.equal(JSON.parse(v.request).product, 'learn');
});

test('חבילה ששולמה: רישיון לכל תוכנה בחבילה, פעם אחת לכל תוכנה, בלי תשלום נוסף — דרך שרת אמיתי', async () => {
  const { owner, rootKeys } = freshOwner();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-products-relay-'));
  const relayKp = L.generateKeyPair();
  const identity = { privateJwk: relayKp.privateJwk, certText: null, origin: null };
  const server = createServer({ dataDir, billing: { rootKeys }, identity });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  identity.origin = url;
  identity.certText = owner.relayCert(relayKp.publicJwk, { origin: url, allowLocal: true }).text;
  try {
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      return { store, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch, allowLocalRelay: true }) };
    };
    const O = mk(true); const T = mk(false);
    owner.setOffer(MASTER);
    const pub = await O.sync.ownerPublishOffer();
    assert.deepEqual(pub.published, ['supersuite', 'learn', 'shir-studio', 'vidlearn']);
    assert.deepEqual(pub.failed, []);

    // SuperSuite מקבלת רק את ההצעה שלה (גם לקוח ישן שלא שולח product)
    const own = await T.sync.getOffer();
    assert.deepEqual(own.offer.plans.map(p => p.id), ['econ']);
    const rm = createRemote({ url, fetchImpl: fetch });
    const signer = T.store.syncKey(true);
    assert.equal(OF.productOfOffer(JSON.parse(await rm.getOffer(signer)).payload), 'supersuite');
    const learnText = await rm.getOffer(signer, 'learn');
    assert.deepEqual(OF.verifyOffer(learnText, rootKeys, { expectProduct: 'learn' }).plans.map(p => p.id), ['learn-all']);
    await assert.rejects(rm.getOffer(signer, 'nope'), /המוצר אינו מוכר/);

    // הרשמה מ"SuperSuite לימוד" לחבילת הלימוד (חינם — נמסרת מיד); השרת בודק אותה מול ההצעה הנוכחית של לימוד
    const r = await T.sync.signup({ offerText: learnText, planId: 'learn-all', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
    assert.equal(r.free, true);
    assert.equal((await O.sync.ownerReceive()).signups, 1);
    const [x] = owner.signups();
    assert.equal(x.product, 'learn');
    assert.deepEqual(x.bundle.products, ['learn', 'shir-studio', 'vidlearn']);
    const first = owner.issueSignup(x.id);
    assert.equal(first.product, 'learn');
    assert.deepEqual(L.verifyChain(JSON.parse(first.package).chain, rootKeys).features, ['econ', 'english', 'math']);
    let [b] = owner.list().bundles;
    assert.deepEqual(b.pending, ['shir-studio', 'vidlearn']);

    // בקשה משיר סטודיו — "לפי חבילה": התחומים, המכסות והתקופה מהחבילה (לא מהקלט)
    const shirReq = requestFor('shir-studio', 'תלמוד תורה — שיר סטודיו');
    const opened = owner.openRequest(shirReq);
    assert.deepEqual(opened.bundles.map(y => [y.id, y.forProduct]), [[x.id, 'shir-studio']]);
    const shir = owner.issue({ request: shirReq, bundleId: x.id, features: ['shir-studio'], limits: { maxUsers: 999, maxChildren: 9, maxDepth: 3, maxStorageMb: 1 } });
    const shirLic = L.verifyChain(JSON.parse(shir.package).chain, rootKeys);
    assert.deepEqual(shirLic.features, ['shir-studio']);
    assert.equal(shirLic.limits.maxUsers, 5);
    assert.equal(shir.bundleId, x.id);
    // אותה חבילה לא מנפיקה פעמיים לאותה תוכנה (מחשב אחר) — וגם לא לתוכנה שאינה בחבילה
    assert.throws(() => owner.issue({ request: requestFor('shir-studio', 'מחשב נוסף'), bundleId: x.id }), /כבר הונפק/);
    assert.throws(() => owner.issue({ request: requestFor('supersuite', 'כלכלה'), bundleId: x.id }), /אינו חלק מהחבילה/);
    // חידוש לאותה מערכת לפי החבילה — מותר
    assert.equal(owner.issue({ request: shirReq, bundleId: x.id }).renewal, true);
    [b] = owner.list().bundles;
    assert.deepEqual(b.pending, ['vidlearn']);
    assert.equal(owner.list().tenants.find(t => t.id === shir.id).bundleId, x.id);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('מנהל-העל: offer.json מגרסה קודמת (הצעה אחת) נקרא כהצעה ראשית של SuperSuite', () => {
  const storage = mem();
  const owner = createOwnerCore({ storage });
  owner.init('menahel-al-products-2026');
  const legacy = OF.createOffer(owner.rootSigner(), { seller: MASTER.seller, terms: MASTER.terms,
    plans: [{ id: 'basic', name: 'בסיסי', priceAgorot: 0, months: 12, features: ['econ'], limits: LIMITS }] }, { issuedAt: 5 });
  // כמו בגרסה הקודמת: { text, published } (הקובץ אינו מוצפן — offer.json ציבורי)
  storage.write('offer.json', JSON.stringify({ text: legacy, published: [{ issuedAt: 5, at: 6 }] }));
  const o = owner.offer();
  assert.equal(o.issuedAt, 5);
  assert.deepEqual(Object.keys(o.texts), ['supersuite']);
  assert.equal(o.master.plans[0].scope, 'supersuite');
  assert.deepEqual(o.master.plans[0].features, { supersuite: ['econ'] });
  // שמירה מחדש — הצעה לכל תוכנה, ורשימת הפרסומים נשמרת
  const next = owner.setOffer(MASTER);
  assert.deepEqual(Object.keys(next.texts).sort(), ['learn', 'shir-studio', 'supersuite', 'vidlearn']);
  assert.equal(JSON.parse(storage.read('offer.json')).published.length, 1);
});
