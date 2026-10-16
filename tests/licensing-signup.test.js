// הרשמה: הצעה חתומה (תכניות + תקנון), חתימה על התקנון, תשלום דרך שכבה מופשטת (ספק בדיקות), והנפקה אוטומטית של רישיון
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const { createProvider } = require('../server/payments');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createServer } = require('../server/license-relay');

const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'basic', name: 'בסיסי', priceAgorot: 0, months: 12, features: ['econ'], limits: { maxUsers: 1, maxChildren: 0 } },
    { id: 'pro', name: 'מוסדות', desc: 'עמותה וגמ"ח', priceAgorot: 49900, months: 12, features: ['econ', 'econ.npo', 'econ.gemach'], limits: { maxUsers: 10, maxChildren: 3 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
};
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };

test('הצעה חתומה: מחיר באגורות, תקנון עם תמצית; שינוי נדחה', () => {
  const root = L.generateKeyPair();
  const text = OF.createOffer(root.privateJwk, OFFER, { issuedAt: 1 });
  const o = OF.verifyOffer(text, [root.publicJwk]);
  assert.equal(o.plans[1].priceAgorot, 49900);
  assert.equal(o.terms.sha256, L.sha256Hex(o.terms.text));
  const t = JSON.parse(text); t.payload.plans[1].priceAgorot = 100;
  assert.throws(() => OF.verifyOffer(JSON.stringify(t), [root.publicJwk]), /חתימת/);
  assert.throws(() => OF.verifyOffer(text, [L.generateKeyPair().publicJwk]), /אינה מהספק/);
  assert.throws(() => OF.createOffer(root.privateJwk, { ...OFFER, plans: [{ ...OFFER.plans[0], priceAgorot: 9.5 }] }), /המחיר/);
  assert.throws(() => OF.createOffer(root.privateJwk, { ...OFFER, terms: { version: '1.0', text: 'קצר' } }), /קצר/);
});

test('הרשמה: חובה גלילה, הסכמה וחתימה; שינוי מחיר / תקנון / חתימה נתפס', () => {
  const root = L.generateKeyPair();
  const dev = L.generateKeyPair();
  const offerText = OF.createOffer(root.privateJwk, OFFER, { issuedAt: 1 });
  const base = { deviceJwk: dev.privateJwk, offerText, rootKeys: [root.publicJwk], planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at: 5 };
  assert.throws(() => SU.createSignup({ ...base, scrolledToEnd: false }), /עד סופו/);
  assert.throws(() => SU.createSignup({ ...base, accepted: false }), /לאשר/);
  assert.throws(() => SU.createSignup({ ...base, signatureImage: '' }), /לחתום/);
  assert.throws(() => SU.createSignup({ ...base, customer: { ...CUSTOMER, phone: '12' } }), /טלפון/);
  assert.throws(() => SU.createSignup({ ...base, customer: { ...CUSTOMER, taxId: '123456789' } }), /ת.ז/);
  const su = SU.createSignup(base);
  const v = SU.verifySignup(su.text, [root.publicJwk]);
  assert.equal(v.plan.id, 'pro');
  assert.equal(JSON.parse(v.request).name, 'ישיבת תורת חיים');
  const p1 = JSON.parse(su.text); p1.body.priceAgorot = 100;
  assert.throws(() => SU.verifySignup(JSON.stringify(p1), [root.publicJwk]), /חתימת ההרשמה/);
  const p2 = JSON.parse(su.text); p2.signatureImage = SIG + 'AA';
  assert.throws(() => SU.verifySignup(JSON.stringify(p2), [root.publicJwk]), /החתימה שונתה/);
  const html = SU.signedDocumentHtml(v);
  assert.match(html, /ישיבת תורת חיים/);
  assert.match(html, new RegExp(v.body.terms.sha256));
  assert.match(html, /Content-Security-Policy/);
});

test('ספק בדיקות: webhook חתום נקלט, חתימה שגויה נדחית', () => {
  const p = createProvider('test', { publicUrl: 'http://127.0.0.1:1', secret: 's' });
  const co = p.createCheckout({ amountAgorot: 500, description: 'x' });
  const rawBody = JSON.stringify({ checkoutId: co.checkoutId, status: 'paid', amountAgorot: 500 });
  assert.equal(p.parseWebhook({ rawBody, headers: { 'x-test-signature': p._sign(rawBody) } }).status, 'paid');
  assert.throws(() => p.parseWebhook({ rawBody, headers: { 'x-test-signature': 'a'.repeat(64) } }), /חתימת/);
  assert.throws(() => createProvider('nope'), /לא מוכר/);
});

test('מסלול מלא דרך שרת אמיתי: פרסום הצעה ← הרשמה וחתימה ← תשלום (בדיקה) ← הנפקה ← רישיון פעיל', async () => {
  const owner = createOwnerCore({ storage: mem() });
  const rootKeys = [owner.init('menahel-al-signup-2026').publicKey];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-signup-relay-'));
  let provider;
  const billing = { rootKeys };
  const server = createServer({ dataDir, billing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  provider = createProvider('test', { publicUrl: url });
  billing.provider = provider;
  try {
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      return { store, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch }) };
    };
    const O = mk(true); const T = mk(false); const F = mk(false);

    owner.setOffer(OFFER);
    await O.sync.ownerPublishOffer();
    // מערכת שאינה מנהל-העל לא יכולה לפרסם הצעה
    const { createRemote } = require('../shell/licensing/remote');
    await assert.rejects(createRemote({ url, fetchImpl: fetch }).setOffer(T.store.syncKey(true), owner.offer().text), /רק מנהל-העל/);

    const offer = await T.sync.getOffer();
    assert.equal(offer.offer.plans.length, 2);
    const r = await T.sync.signup({ offerText: offer.text, planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
    assert.equal(r.status, 'pending');
    assert.match(r.url, /\/pay\/test\/tst_/);

    // לפני תשלום — מנהל-העל לא מקבל דבר
    assert.equal((await O.sync.ownerReceive()).signups, 0);
    // הלקוח "משלם" בדף הבדיקה
    const page = await fetch(r.url);
    assert.match(await page.text(), /מצב בדיקה/);
    const paid = await fetch(r.url, { method: 'POST', body: 'result=paid', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.match(await paid.text(), /התקבל/);
    assert.equal((await T.sync.signupStatus()).status, 'submitted');

    // מנהל-העל מקבל את ההרשמה, מנפיק — והרישיון מגיע ללקוח בסנכרון עם התכנית ששולמה
    assert.equal((await O.sync.ownerReceive()).signups, 1);
    const [x] = owner.signups();
    assert.equal(x.payment.amountAgorot, 49900);
    assert.equal(x.terms.version, '1.0');
    const issued = owner.issueSignup(x.id);
    await O.sync.ownerReply(issued.keyId, 'license', issued.package);
    await T.sync.receive();
    const st = T.store.current();
    assert.equal(st.status, 'active');
    assert.deepEqual([...st.features].sort(), ['econ', 'econ.gemach', 'econ.npo']);
    assert.equal(st.limits.maxUsers, 10);
    assert.match(owner.signedDocument(x.id).html, /משה כהן/);

    // תכנית חינם — ישר למנהל-העל, בלי תשלום
    const fr = await F.sync.signup({ offerText: offer.text, planId: 'basic', customer: { ...CUSTOMER, org: 'כולל אהבת תורה' }, signatureImage: SIG, scrolledToEnd: true, accepted: true });
    assert.equal(fr.free, true);
    assert.equal((await O.sync.ownerReceive()).signups, 1);

    // אי אפשר "להתחזות" להרשמה ששולמה: שליחה ישירה של signup נחסמת בשרת
    await assert.rejects(createRemote({ url, fetchImpl: fetch }).send(F.store.syncKey(false), [{ to: L.keyId(rootKeys[0]), kind: 'signup', body: '{}' }]), /דרך התשלום/);
    // webhook מזויף נדחה
    const bad = await fetch(url + '/pay/webhook', { method: 'POST', body: JSON.stringify({ checkoutId: 'x', status: 'paid', amountAgorot: 1 }), headers: { 'x-test-signature': 'a'.repeat(64) } });
    assert.equal(bad.status, 400);
  } finally { await new Promise(r => server.close(r)); }
});

test('הרשאות: ערוצי ההרשמה דרך handle() — למנהל', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  for (const ch of ['license:getOffer', 'license:signup', 'license:signupStatus', 'license:openPayment', 'owner:setOffer', 'owner:publishOffer', 'owner:signups', 'owner:signupIssue', 'owner:signupDocument']) {
    assert.match(src, new RegExp(`handle\\('${ch}'`), ch);
  }
});
