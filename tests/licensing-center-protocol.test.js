// מרכז הרישוי + הפרוטוקול של SuperSuite לימוד (26.11.2026) — מקצה לקצה, מול קוד השרת האמיתי (server/license-relay.js):
// 1. לקוח של SuperSuite לימוד נרשם בהרשמה מוצפנת (v2) לתכנית בתשלום ← השרת בודק מול ההצעה של "לימוד" ← התשלום מאושר
//    בחתימת השרת ← מנהל-העל ב-SuperSuite קולט, מאמת ומנפיק רישיון עם תחומי "לימוד".
//    גם לקוח "לימוד" מלפני מרכז הרישוי — שלא שולח את המוצר בחלק הגלוי.
// 2. לקוח ישן של SuperSuite (חבילה גלויה, בלי signup-v2, בלי product ובלי אתגר לתשובה חתומה) — עדיין נרשם ומקבל רישיון.
// 3. אימות התשלום: האישור החתום של השרת הוא המקור הראשי; האימות מול Cardcom / האישור הידני — בנוסף לו.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const M = require('../shell/licensing/messages');
const OC = require('../shell/licensing/owner-core');
const { createLicenseStore } = require('../shell/licensing/store');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createRemote } = require('../shell/licensing/remote');
const R = require('../server/license-relay');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-center-protocol-'));
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* run-tests מנקה */ } });
let seq = 0;
const mk = (n) => { const d = path.join(tmp, n + '-' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };

const RELAY_URL = 'https://relay.test';
const TERMS = 'תקנון השימוש בתוכנות של הספק.\n1. השימוש כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'תלמוד תורה אור החיים', contact: 'אברהם לוי', phone: '052-7654321', email: 'office@example.org', taxId: '' };
const LIMITS = { maxUsers: 5, maxChildren: 0 };
const LEARN_FEATURES = ['econ', 'english', 'school'];
const MASTER = {
  seller: { name: 'בונים סלר' },
  plans: [
    { id: 'econ-basic', name: 'כלכלה — בסיס', priceAgorot: 0, months: 12, scope: 'supersuite', features: { supersuite: ['econ', 'tools'] }, limits: LIMITS },
    { id: 'econ-pro', name: 'כלכלה — מוסדות', priceAgorot: 49900, months: 12, scope: 'supersuite', features: { supersuite: ['econ', 'econ.npo'] }, limits: LIMITS },
    { id: 'learn-school', name: 'לימוד — מוסד', priceAgorot: 29900, months: 12, scope: 'learn', features: { learn: LEARN_FEATURES }, limits: LIMITS },
    { id: 'learn-family', name: 'חבילת לימוד', priceAgorot: 59900, months: 12, scope: 'family:learn',
      features: { learn: ['econ', 'english', 'math'], 'shir-studio': ['shir-studio'], vidlearn: ['vidlearn'] }, limits: LIMITS },
  ],
  terms: { version: '2.0', title: 'תקנון', text: TERMS },
};

const signedReq = (privateJwk, op, payload, ts = Date.now()) => {
  const pub = L.publicOf(privateJwk), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, privateJwk) };
};
const relayFetch = (relay) => async (url, init) => {
  try {
    const r = await relay.handle(JSON.parse(init.body), '127.0.0.1');
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  } catch (e) {
    return { ok: false, status: e.status || 400, headers: { get: () => null }, json: async () => ({ ok: false, error: e.message }) };
  }
};
// ספק סליקה מדומה: דף תשלום בכתובת של Cardcom, ו-webhook בפורמט פשוט
function fakeProvider() {
  let n = 0;
  return { name: 'fake',
    async createCheckout() { const id = 'lp' + (++n) + crypto.randomBytes(3).toString('hex'); return { checkoutId: id, url: 'https://secure.cardcom.solutions/EA/' + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody) };
}
// סביבה שלמה: מנהל-העל (מרכז הרישוי), שרת עם מפתח ותעודה לכתובת, וההצעה הראשית מפורסמת לכל מוצר
async function setup() {
  const owner = OC.createOwnerCore({ storage: mem() });
  const rootKeys = [owner.init('menahel-al-center-2026').publicKey];
  const dir = mk('relay');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  const g = R.generateRelayKey(keyFile);
  fs.writeFileSync(certFile, owner.relayCert(fs.readFileSync(g.pubFile, 'utf8'), { origin: RELAY_URL }).text);
  const provider = fakeProvider();
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider }, identity: R.loadRelayIdentity({ keyFile, certFile, rootKeys }) });
  const fetchImpl = relayFetch(relay);
  const install = (withOwner) => {
    const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
    store.syncKey(true);
    store.setRemoteSettings({ url: RELAY_URL });
    return { store, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl }) };
  };
  const O = install(true);
  owner.setOffer(MASTER);
  const pub = await O.sync.ownerPublishOffer();
  assert.deepEqual(pub.failed, []);
  const paymentsOf = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8')); } catch { return []; } };
  const pay = async (signupId, providerRef) => {
    const x = paymentsOf().find(y => y.signupId === signupId);
    await relay.webhook({ rawBody: JSON.stringify({ checkoutId: x.checkoutId, status: 'paid', amountAgorot: x.amountAgorot, providerRef }), headers: {} });
    return x;
  };
  return { owner, rootKeys, relay, dir, fetchImpl, install, O, pay, remote: () => createRemote({ url: RELAY_URL, fetchImpl }) };
}
// החלק הגלוי של הרשמה מוצפנת כפי ש-SuperSuite לימוד שולחת אותו היום (sealSignup שם) — בלי המוצר
function sealLikeLearn({ deviceJwk, signup, ownerPub }) {
  const sealed = M.sealData(deviceJwk, ownerPub, signup.text, SU.SEALED_PURPOSE);
  const b = signup.body;
  const body = { v: 1, id: b.id, keyId: b.keyId, publicKey: b.publicKey, offerIssuedAt: b.offerIssuedAt, planId: b.planId,
    priceAgorot: b.priceAgorot, months: b.months, signedAt: b.signedAt, sealedSha256: L.sha256Hex(sealed),
    ...(b.priceAgorot > 0 ? { invoice: { org: b.customer.org, taxId: b.customer.taxId, email: b.customer.email, phone: b.customer.phone } } : {}) };
  return { sealed, public: JSON.stringify({ type: SU.PUBLIC_TYPE, v: 1, body, sig: L.signObject(body, deviceJwk) }) };
}
const leafOf = (pkgText) => { const chain = JSON.parse(pkgText).chain; return chain[chain.length - 1].payload; };

test('לקוח SuperSuite לימוד: הרשמה מוצפנת בתשלום ← שרת ← מנהל-העל ב-SuperSuite ← רישיון עם תחומי "לימוד"', async () => {
  const env = await setup();
  const { owner, rootKeys, O } = env;
  const rm = env.remote();
  const device = L.generateKeyPair();
  // התוכנה מבקשת את ההצעה של המוצר שלה, ורק אותה היא מקבלת
  const learnText = await rm.getOffer(device.privateJwk, 'learn');
  const learnOffer = OF.verifyOffer(learnText, rootKeys, { expectProduct: 'learn' });
  assert.deepEqual(learnOffer.plans.map(p => p.id), ['learn-school', 'learn-family']);

  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText: learnText, rootKeys, planId: 'learn-school', customer: CUSTOMER,
    signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: device.privateJwk, signup: su, ownerPub: rootKeys[0] });
  assert.equal(JSON.parse(sealed.publicText).body.product, 'learn', 'המוצר בחלק הגלוי החתום — לבחירת ההצעה בשרת');
  const co = await rm.checkout(device.privateJwk, { public: sealed.publicText, sealed: sealed.sealed }, { proof: crypto.randomBytes(18).toString('base64url') });
  assert.equal(co.status, 'pending');
  assert.equal(co.amountAgorot, 29900, 'הסכום — מההצעה של "לימוד"');
  assert.ok(co.payProof && co.relayCert, 'התשובה חתומה במפתח השרת');
  // בשרת — רק המעטפה והחלק הגלוי; פרטי הלקוח המלאים לא נשמרים בגלוי
  const stored = fs.readFileSync(path.join(env.dir, 'signups', co.paymentId + '.json'), 'utf8');
  assert.ok(!stored.includes(CUSTOMER.contact), 'איש הקשר לא בגלוי בשרת');

  const p = await env.pay(su.id, 'TR-1001');
  assert.equal((await O.sync.ownerReceive()).signups, 1);
  const x = owner.signups().find(y => y.id === su.id);
  assert.equal(x.product, 'learn');
  assert.equal(x.status, 'new');
  assert.equal(x.payment.verified, true, 'האישור החתום של השרת אומת');
  assert.equal(x.payment.checkoutId, p.checkoutId, 'מזהה דף התשלום נשמר — לאימות הישיר מול Cardcom');
  assert.equal(x.customer.contact, CUSTOMER.contact, 'מנהל-העל פתח את המעטפה');

  const r = owner.issueSignup(x.id);
  assert.equal(r.product, 'learn');
  assert.deepEqual([...leafOf(r.package).features].sort(), [...LEARN_FEATURES].sort());
  assert.equal(owner.list().tenants.find(t => t.id === r.id).product, 'learn');
  // הרישיון חוזר ללקוח דרך השרת
  await O.sync.ownerReply(r.keyId, 'license', r.package);
  const got = (await rm.fetch(device.privateJwk)).find(m => m.kind === 'license');
  assert.ok(got, 'הלקוח קיבל את הרישיון');
  assert.deepEqual(leafOf(got.body).features, leafOf(r.package).features);
  assert.equal(leafOf(got.body).publicKey.x, device.publicJwk.x, 'הרישיון למכשיר שנרשם');
});

test('לקוח "לימוד" מלפני מרכז הרישוי (בלי המוצר בחלק הגלוי): השרת מוצא את ההצעה לפי התכנית, והמוצר נקבע מההצעה שבמעטפה', async () => {
  const env = await setup();
  const { owner, rootKeys, O } = env;
  const rm = env.remote();
  const device = L.generateKeyPair();
  const learnText = await rm.getOffer(device.privateJwk, 'learn');
  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText: learnText, rootKeys, planId: 'learn-family', customer: CUSTOMER,
    signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const s = sealLikeLearn({ deviceJwk: device.privateJwk, signup: su, ownerPub: rootKeys[0] });
  assert.equal(JSON.parse(s.public).body.product, undefined);
  const co = await rm.checkout(device.privateJwk, { public: s.public, sealed: s.sealed }, { proof: crypto.randomBytes(18).toString('base64url') });
  assert.equal(co.status, 'pending');
  assert.equal(co.amountAgorot, 59900);
  await env.pay(su.id, 'TR-1002');
  assert.equal((await O.sync.ownerReceive()).signups, 1);
  const x = owner.signups().find(y => y.id === su.id);
  assert.equal(x.product, 'learn', 'המוצר — מההצעה החתומה שבתוך המעטפה');
  assert.deepEqual(x.bundle.products, ['learn', 'shir-studio', 'vidlearn']);
  assert.equal(x.payment.verified, true);
  const r = owner.issueSignup(x.id);
  assert.equal(r.product, 'learn');
  assert.deepEqual([...leafOf(r.package).features].sort(), ['econ', 'english', 'math']);
  assert.equal(r.bundleId, x.id, 'החבילה נרשמה — שיר סטודיו ו-VidLearn יקבלו ממנה רישיון בלי תשלום נוסף');
  // תכנית שאינה באף הצעה מפורסמת — נדחית
  const bad = { ...su.body, planId: 'nope' };
  const forged = sealLikeLearn({ deviceJwk: device.privateJwk, signup: { text: su.text, body: bad }, ownerPub: rootKeys[0] });
  await assert.rejects(rm.checkout(device.privateJwk, { public: forged.public, sealed: forged.sealed }), /התכנית|תכנית/);
  // מוצר לא מוכר בחלק הגלוי — נדחה
  const b2 = { ...JSON.parse(s.public).body, product: 'nope' };
  const pub2 = JSON.stringify({ type: SU.PUBLIC_TYPE, v: 1, body: b2, sig: L.signObject(b2, device.privateJwk) });
  await assert.rejects(rm.checkout(device.privateJwk, { public: pub2, sealed: s.sealed }), /המוצר אינו מוכר/);
});

test('המוצר שבחלק הגלוי חייב להתאים להצעה שבמעטפה — הרשמה שהמוצר שלה הוחלף לא נקלטת', async () => {
  const env = await setup();
  const { owner, rootKeys } = env;
  const device = L.generateKeyPair();
  const learnText = owner.offer().texts.learn;
  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText: learnText, rootKeys, planId: 'learn-school', customer: CUSTOMER,
    signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const s = sealLikeLearn({ deviceJwk: device.privateJwk, signup: su, ownerPub: rootKeys[0] });
  const body = { ...JSON.parse(s.public).body, product: 'supersuite' };
  const lie = JSON.stringify({ type: SU.PUBLIC_TYPE, v: 1, body, sig: L.signObject(body, device.privateJwk) });
  assert.throws(() => SU.openSealedSignup(owner.rootSigner(), s.sealed, lie));
  assert.equal(SU.verifySignup(SU.openSealedSignup(owner.rootSigner(), s.sealed, s.public), rootKeys).product, 'learn');
});

test('לקוח ישן של SuperSuite (חבילה גלויה, בלי signup-v2 ובלי product): נרשם, מקבל רישיון ומתקין אותו', async () => {
  const env = await setup();
  const { owner, rootKeys, relay, O } = env;
  const T = env.install(false);
  const key = T.store.syncKey(true);
  const call = (op, payload) => relay.handle(signedReq(key, op, payload), '198.51.100.7');
  // הצעה בלי לציין מוצר — ההצעה של SuperSuite, כמו בגרסה הקודמת של השרת
  const ownText = (await call('getOffer', {})).offer;
  assert.deepEqual(OF.verifyOffer(ownText, rootKeys).plans.map(p => p.id), ['econ-basic', 'econ-pro']);

  // תכנית חינם: החבילה הגלויה נשלחת כמו פעם
  const free = SU.createSignup({ deviceJwk: key, offerText: ownText, rootKeys, planId: 'econ-basic', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const r1 = await call('checkout', { signup: free.text });
  assert.equal(r1.free, true);
  assert.equal(r1.payProof, undefined, 'בלי אתגר — בלי חתימה, כמו שהלקוח הישן מצפה');
  // השרת לא שומר את החבילה בגלוי גם כשהלקוח שלח אותה כך: למנהל-העל נמסרת מעטפה מוצפנת
  const ownerBox = JSON.parse(fs.readFileSync(path.join(env.dir, L.keyId(rootKeys[0]) + '.json'), 'utf8'));
  assert.ok(!JSON.stringify(ownerBox).includes(CUSTOMER.contact));
  assert.equal((await O.sync.ownerReceive()).signups, 1);
  const x = owner.signups().find(y => y.id === free.id);
  assert.equal(x.product, 'supersuite');
  assert.equal(x.status, 'new');
  const issued = owner.issueSignup(x.id);
  assert.equal(issued.product, 'supersuite');
  await O.sync.ownerReply(issued.keyId, 'license', issued.package);
  // משיכה בלי caps (לקוח ישן) — הרישיון מגיע כרגיל
  const mail = (await call('fetch', {})).messages;
  const lic = mail.find(m => m.kind === 'license');
  assert.ok(lic, 'הרישיון הגיע ללקוח הישן');
  T.store.install(lic.body);
  const st = T.store.current();
  assert.equal(st.status, 'active');
  assert.deepEqual([...st.features].sort(), ['econ', 'tools']);

  // תכנית בתשלום מלקוח ישן: דף תשלום, ואחרי התשלום — מסירה עם אישור חתום, שמנהל-העל מאמת
  const T2 = env.install(false);
  const key2 = T2.store.syncKey(true);
  const paid = SU.createSignup({ deviceJwk: key2, offerText: ownText, rootKeys, planId: 'econ-pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const r2 = await relay.handle(signedReq(key2, 'checkout', { signup: paid.text }), '198.51.100.8');
  assert.equal(r2.status, 'pending');
  assert.match(r2.url, /^https:\/\/secure\.cardcom\.solutions\//);
  await env.pay(paid.id, 'TR-2001');
  assert.equal((await relay.handle(signedReq(key2, 'paymentStatus', { paymentId: r2.paymentId }), '198.51.100.8')).status, 'paid');
  assert.equal((await O.sync.ownerReceive()).signups, 1);
  const y = owner.signups().find(z => z.id === paid.id);
  assert.equal(y.product, 'supersuite');
  assert.equal(y.payment.verified, true);
  assert.deepEqual([...leafOf(owner.issueSignup(y.id).package).features].sort(), ['econ', 'econ.npo']);
});

test('סדר הפריסה: מנהל-על מגרסה קודמת (בלי signup-v2) לא מקבל מסירה מוצפנת — היא ממתינה בשרת עד שיתעדכן', async () => {
  const env = await setup();
  const { owner, rootKeys, relay } = env;
  const device = L.generateKeyPair();
  const ownText = owner.offer().texts.supersuite;
  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText: ownText, rootKeys, planId: 'econ-basic', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  await relay.handle(signedReq(device.privateJwk, 'checkout', { signup: su.text }), '198.51.100.9');
  const root = owner.rootSigner();
  const old = await relay.handle(signedReq(root, 'fetch', {}), '198.51.100.10');
  assert.equal(old.messages.filter(m => m.kind === 'signup').length, 0, 'מנהל-על ישן לא מקבל את המעטפה (ולא מוחק אותה כ"פגומה")');
  const cur = await relay.handle(signedReq(root, 'fetch', { caps: [R.CAP_SIGNUP_V2] }), '198.51.100.10');
  assert.equal(cur.messages.filter(m => m.kind === 'signup').length, 1);
});

test('אימות התשלום: האישור החתום של השרת — המקור הראשי; Cardcom / אישור ידני — בנוסף לו', async () => {
  const env = await setup();
  const { owner, rootKeys, O } = env;
  const C = env.install(false);
  const s = await C.sync.signup({ offerText: (await C.sync.getOffer()).text, planId: 'econ-pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  assert.equal(s.status, 'pending');
  await env.pay(s.id, 'TR-3001');
  await O.sync.ownerReceive();
  const x = owner.signups().find(y => y.id === s.id);
  assert.equal(x.payment.verified, true);
  assert.equal(x.status, 'new');
  // בלי פרטי Cardcom: האישור החתום לא מחליף את האישור של מנהל-העל (שרת שנפרץ חותם בעצמו) — אבל מוזכר בהודעה
  const manual = OC.signupPaymentCode(x, {});
  assert.equal(manual.code, OC.PAYMENT_UNCONFIRMED);
  assert.match(manual.message, /שרת הרישוי אישר את התשלום בחתימה/);
  assert.equal(OC.signupPaymentCode(x, { paymentConfirmed: true }), null);
  // עם פרטי Cardcom: נדרש האימות הישיר, גם כשהשרת חתם
  assert.equal(OC.signupPaymentCode(x, { verifyConfigured: true }).code, OC.PAYMENT_UNVERIFIED);
  // Cardcom אומר "לא שולם" — חסום, גם עם אישור חתום וגם עם אישור ידני
  owner.setSignupPaymentCheck(x.id, { status: 'unpaid', message: 'העסקה לא הושלמה', lowProfileId: x.payment.checkoutId });
  const blocked = OC.signupPaymentCode(owner.signups().find(y => y.id === s.id), { verifyConfigured: true, paymentConfirmed: true });
  assert.equal(blocked.code, OC.PAYMENT_REJECTED);
  // Cardcom אימת — אין צורך באישור נוסף
  owner.setSignupPaymentCheck(x.id, { status: 'verified', message: 'אומת', lowProfileId: x.payment.checkoutId, tranzactionId: '77', amountAgorot: 49900 });
  assert.equal(OC.signupPaymentCode(owner.signups().find(y => y.id === s.id), { verifyConfigured: true }), null);

  // מסירה "שולם" בלי אישור חתום (מי שעונה במקום השרת): נשמרת לבדיקה, ולא מונפקת בלחיצה
  const device = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText: owner.offer().texts.supersuite, rootKeys, planId: 'econ-pro', customer: CUSTOMER,
    signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: device.privateJwk, signup: su, ownerPub: rootKeys[0] });
  const forged = JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: sealed.sealed, public: sealed.publicText,
    payment: { id: crypto.randomUUID(), amountAgorot: 49900, provider: 'fake', providerRef: 'X', paidAt: Date.now() } });
  const r = owner.addSignup(forged, { requirePaymentProof: true, origin: RELAY_URL });
  assert.equal(r.unverified, true);
  const f = owner.signups().find(y => y.id === su.id);
  assert.equal(f.status, 'review');
  assert.equal(f.payment.verified, false);
  assert.equal(f.problem, OC.PAYMENT_PROOF_MISSING);
  assert.throws(() => owner.issueSignup(su.id), /בלי אישור חתום/);
});
