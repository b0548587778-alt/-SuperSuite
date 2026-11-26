// סקירה סטטית 2.11.2026 — אמון בשרת הרישוי ובתשלום (ממצאים f14, f15, f83, f86, f88).
// f14 — התיבה של מנהל-העל מוגנת גם בלי --root-pub (מזהה השורש מתעודת השרת)
// f15 — webhook שאבד: השרת בודק את התשלום אצל הספק (בבדיקת מצב ובסבב), לפני שהרשומה נמחקת
// f83 — "שולם" במסירה למנהל-העל רק עם אישור חתום במפתח השרת
// f86 — תשובת checkout / paymentStatus חתומה, ודף תשלום רק אצל ספק הסליקה
// f88 — כתיבה עמידה בשרת (fsync לפני ההחלפה), וחבילת ההרשמה נמחקת רק אחריה
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const SU = require('../shell/licensing/signup');
const CK = require('../shell/licensing/checkin');
const OC = require('../shell/licensing/owner-core');
const { createLicenseStore } = require('../shell/licensing/store');
const { createLicenseSync } = require('../shell/licensing/sync');
const R = require('../server/license-relay');

const DAY = 24 * 60 * 60 * 1000;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-trust-'));
test.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* run-tests מנקה */ } });
let seq = 0;
const mk = (n) => { const d = path.join(root, n + '-' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };

const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n'.repeat(3);
const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'free', name: 'אנגלית לבית', priceAgorot: 0, months: 12, features: ['tools'], limits: { maxUsers: 2 } },
    { id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['tools', 'shamai'], limits: { maxUsers: 10, maxChildren: 3 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
};
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };
const RELAY_URL = 'https://relay.test';

const owner = OC.createOwnerCore({ storage: mem() });
const rootKeys = [owner.init('menahel-al-trust-2026').publicKey];
const ownerId = L.keyId(rootKeys[0]);
const rootKp = { publicJwk: rootKeys[0], privateJwk: owner.rootSigner() };
const offerText = owner.setOffer(OFFER).text;
owner.offerPublished(JSON.parse(offerText).payload.issuedAt);

const signedReq = (kp, op, payload, ts = Date.now()) => {
  const pub = L.publicOf(kp.privateJwk), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
const relayFetch = (relay, tamper = (r) => r) => async (url, init) => {
  const body = JSON.parse(init.body);
  try {
    const r = await tamper(await relay.handle(body, '127.0.0.1'), body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  } catch (e) {
    return { ok: false, status: e.status || 400, headers: { get: () => null }, json: async () => ({ ok: false, error: e.message }) };
  }
};
function relayIdentity(origin = RELAY_URL) {
  const dir = mk('relay');
  const keyFile = path.join(dir, 'relay-key.json');
  const certFile = path.join(dir, 'relay-cert.json');
  const g = R.generateRelayKey(keyFile);
  fs.writeFileSync(certFile, owner.relayCert(fs.readFileSync(g.pubFile, 'utf8'), { origin }).text);
  return { dir, identity: R.loadRelayIdentity({ keyFile, certFile, rootKeys }) };
}
const writeOffer = (dir) => fs.writeFileSync(path.join(dir, 'offer.json'), JSON.stringify({ text: offerText, issuedAt: JSON.parse(offerText).payload.issuedAt }));
// ספק מדומה עם lookup (כמו GetLpResult של Cardcom): paid — העסקאות ששולמו אצל הספק
function fakeProvider({ host = 'https://secure.cardcom.solutions/EA/', lookup = true } = {}) {
  let n = 0;
  const p = { name: 'fake', paid: new Set(), lookups: 0,
    async createCheckout() { const id = 'c' + (++n) + crypto.randomBytes(3).toString('hex'); return { checkoutId: id, url: host + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody) };
  if (lookup) {
    p.lookup = async ({ checkoutId }) => {
      p.lookups++;
      if (p.failing) throw new Error('אין חיבור לספק');
      return p.paid.has(checkoutId) ? { checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'T-' + checkoutId } : { checkoutId, status: 'pending', amountAgorot: 0, providerRef: '' };
    };
  }
  return p;
}
const boxOf = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return []; } };
const paymentsOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8')); } catch { return []; } };
function sealedSignup(device, planId = 'pro', at = Date.now()) {
  const su = SU.createSignup({ deviceJwk: device.privateJwk, offerText, rootKeys, planId, customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at });
  const s = SU.sealSignup({ deviceJwk: device.privateJwk, signup: su, ownerPub: rootKeys[0] });
  return { su, payload: { public: s.publicText, sealed: s.sealed } };
}
function install(fetchImpl, { withOwner = false } = {}) {
  const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
  store.syncKey(true);
  store.setRemoteSettings({ url: RELAY_URL });
  return { store, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl }) };
}
const signupInput = (planId = 'pro') => ({ offerText, planId, customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });

// ---------- f14 ----------
test('f14: בלי --root-pub (רק תעודת שרת) — שולחים לא מוכרים תופסים רק חלק מהתיבה של מנהל-העל, ולקוח שהוא כתב לו מוכר גם אחרי הפעלה מחדש', () => {
  const { dir, identity } = relayIdentity();
  const relayAt = () => R.createRelay({ dataDir: dir, identity });
  const relay = relayAt();
  const customer = L.generateKeyPair();
  relay.handle(signedReq(rootKp, 'send', { items: [{ to: customer.keyId, kind: 'license', body: '{}' }] }), '192.0.2.1');
  assert.ok(fs.existsSync(path.join(dir, 'owner-contacts.json')), 'אנשי הקשר של מנהל-העל נשמרים בקובץ');
  let sent = 0, err = null;
  for (let i = 0; i < 40 && !err; i++) {
    const n = Math.min(R.SEND_PER_IP_TO_BOX_HOUR, 50, R.MAX_UNKNOWN_IN_OWNER_BOX - sent) || 1;
    try { sent += relay.handle(signedReq(L.generateKeyPair(), 'send', { items: Array.from({ length: n }, () => ({ to: ownerId, kind: 'license-request', body: 'x' })) }), '10.30.' + i + '.1').sent; }
    catch (e) { err = e; }
  }
  assert.equal(sent, R.MAX_UNKNOWN_IN_OWNER_BOX, 'ההצפה נעצרת במכסת הלא מוכרים');
  assert.equal(err && err.status, 507);
  const again = relayAt();
  assert.equal(again.handle(signedReq(customer, 'send', { items: [{ to: ownerId, kind: 'license-request', body: 'y' }] }), '10.99.0.1').sent, 1, 'הלקוח המוכר עובר');
});

// ---------- f15 ----------
test('f15: webhook שאבד — בדיקת מצב התשלום שואלת את הספק, והרשמה ששולמה נמסרת למנהל-העל', async () => {
  const dir = mk('f15-status');
  writeOffer(dir);
  const provider = fakeProvider();
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider } });
  const device = L.generateKeyPair();
  const co = await relay.handle(signedReq(device, 'checkout', sealedSignup(device).payload), '198.51.100.1');
  assert.equal(co.status, 'pending');
  provider.paid.add(paymentsOf(dir)[0].checkoutId); // הלקוח שילם; ה-webhook לא הגיע
  const st = await relay.handle(signedReq(device, 'paymentStatus', { paymentId: co.paymentId }), '198.51.100.1');
  assert.equal(st.status, 'paid');
  const m = boxOf(dir, ownerId).find(x => x.kind === 'signup');
  assert.ok(m, 'ההרשמה נמסרה');
  assert.equal(JSON.parse(m.body).payment.amountAgorot, 49900);
  // בדיקה חוזרת מיד — לא פונה שוב לספק (התשלום כבר "שולם")
  const n = provider.lookups;
  await relay.handle(signedReq(device, 'paymentStatus', { paymentId: co.paymentId }), '198.51.100.1');
  assert.equal(provider.lookups, n);
});

test('f15: הסבב בודק תשלום שפג אצל הספק ומוסר אותו; הרשומה נמחקת רק אחרי בדיקה אחרונה — ובכל מקרה בתוך 31 יום', async () => {
  const t0 = Date.now();
  let now = t0;
  const dir = mk('f15-sweep');
  writeOffer(dir);
  const provider = fakeProvider();
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider }, clock: () => now });
  const a = L.generateKeyPair(), b = L.generateKeyPair(), c = L.generateKeyPair();
  for (const [k, ip] of [[a, '198.51.100.2'], [b, '198.51.100.3'], [c, '198.51.100.4']]) await relay.handle(signedReq(k, 'checkout', sealedSignup(k).payload), ip);
  const [pa, pb, pc] = paymentsOf(dir);
  // a שילם אחרי יומיים, ה-webhook אבד; b ו-c לא שילמו
  now = t0 + 2 * DAY;
  relay.expirePayments();
  assert.equal(paymentsOf(dir).find(x => x.id === pa.id).status, 'expired');
  provider.paid.add(pa.checkoutId);
  await relay.reconcilePayments();
  assert.equal(paymentsOf(dir).find(x => x.id === pa.id).status, 'paid');
  assert.equal(boxOf(dir, ownerId).filter(x => x.kind === 'signup').length, 1);
  // 30 יום ושעה: b ו-c עוד לא נבדקו בדיקה אחרונה — לא נמחקים
  now = t0 + 30 * DAY + 60 * 60 * 1000;
  relay.expirePayments();
  assert.ok(paymentsOf(dir).some(x => x.id === pb.id) && paymentsOf(dir).some(x => x.id === pc.id), 'לא נמחקו לפני הבדיקה האחרונה');
  assert.ok(fs.existsSync(path.join(dir, 'signups', pb.id + '.json')));
  // הבדיקה האחרונה: b — שולם ברגע האחרון ונמסר; c — לא שולם, ונמחק בסבב שאחריה
  provider.paid.add(pb.checkoutId);
  await relay.reconcilePayments();
  relay.expirePayments();
  assert.equal(paymentsOf(dir).find(x => x.id === pb.id).status, 'paid');
  assert.equal(boxOf(dir, ownerId).filter(x => x.kind === 'signup').length, 2);
  assert.ok(!paymentsOf(dir).some(x => x.id === pc.id), 'אחרי הבדיקה האחרונה — נמחק');
  assert.ok(!fs.existsSync(path.join(dir, 'signups', pc.id + '.json')), 'גם חבילת ההרשמה');
});

test('f15: ספק שלא עונה — הרשומה נמחקת בכל זאת לפני 31 יום (הבטחת הפרטיות)', async () => {
  const t0 = Date.now();
  let now = t0;
  const dir = mk('f15-grace');
  writeOffer(dir);
  const provider = fakeProvider();
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider }, clock: () => now });
  const k = L.generateKeyPair();
  await relay.handle(signedReq(k, 'checkout', sealedSignup(k).payload), '198.51.100.5');
  const [p] = paymentsOf(dir);
  provider.failing = true;
  now = t0 + 30 * DAY + 2 * 60 * 60 * 1000;
  await relay.reconcilePayments();
  relay.expirePayments();
  assert.ok(paymentsOf(dir).some(x => x.id === p.id), 'עוד בזמן החסד');
  now = t0 + 31 * DAY - 60 * 60 * 1000;
  const orig = console.error;
  console.error = () => {};
  try { relay.expirePayments(); } finally { console.error = orig; }
  assert.ok(!paymentsOf(dir).some(x => x.id === p.id));
  assert.ok(!fs.existsSync(path.join(dir, 'signups', p.id + '.json')));
});

test('f15: Cardcom — lookup שואל את GetLpResult לפי LowProfileId, כמו ה-webhook', async () => {
  const { createCardcomProvider } = require('../server/payments/cardcom-provider');
  const LP = '12345678-1234-1234-1234-123456789abc';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: LP, ReturnValue: 'pay-1',
      TranzactionInfo: { ResponseCode: 0, Amount: 499, CoinId: 1, TranzactionId: 77 } }) };
  };
  const p = createCardcomProvider({ publicUrl: 'https://lic.example.org', env: { SS_CARDCOM_TERMINAL: '1000', SS_CARDCOM_API_NAME: 'api' }, fetchImpl });
  const ev = await p.lookup({ checkoutId: LP });
  assert.deepEqual([ev.status, ev.amountAgorot, ev.paymentId], ['paid', 49900, 'pay-1']);
  assert.match(calls[0][0], /\/api\/v11\/LowProfile\/GetLpResult$/);
  assert.equal(calls[0][1].LowProfileId, LP);
  await assert.rejects(p.lookup({ checkoutId: 'not-an-id' }));
});

// ---------- f83 ----------
// מסירה מזויפת: מי שעונה למשיכה של מנהל-העל (DNS) — הרשמה חתומה במכשיר שלו, ו"שולם" בלי חתימת השרת
function forgedDelivery(proof) {
  const device = L.generateKeyPair();
  const { payload } = sealedSignup(device);
  return JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: payload.sealed, public: payload.public,
    payment: { id: 'p-' + crypto.randomUUID(), amountAgorot: 49900, provider: 'cardcom', providerRef: '1', paidAt: Date.now(), ...(proof ? { proof } : {}) } });
}
test('f83: מנהל-העל — "שולם" בלי אישור חתום של השרת נשמר לבדיקה, ולא מונפק בלי אישור מפורש', async () => {
  const forged = forgedDelivery();
  const attacker = async (url, init) => {
    const body = JSON.parse(init.body);
    const r = body.op === 'fetch' ? { ok: true, messages: [{ id: 'm1', from: 'relay', kind: 'signup', body: forged, at: Date.now() }], more: false } : { ok: true, removed: 1 };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  };
  const T = install(attacker, { withOwner: true });
  const r = await T.sync.ownerReceive();
  assert.equal(r.signups, 1);
  const id = JSON.parse(JSON.parse(forged).public).body.id;
  const x = owner.signups().find(y => y.id === id);
  assert.equal(x.status, 'review');
  assert.equal(x.payment.verified, false);
  assert.match(x.problem, /בלי אישור חתום של שרת הרישוי/);
  assert.throws(() => owner.issueSignup(id), /בלי אישור חתום/);
});

test('f83: הרשמה ששולמה דרך השרת של הספק — האישור החתום מאומת ("חדשה"); אישור אמיתי שהועתק להרשמה אחרת — לא', async () => {
  const { dir, identity } = relayIdentity();
  writeOffer(dir);
  const provider = fakeProvider();
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider }, identity });
  const C = install(relayFetch(relay));
  const s = await C.sync.signup(signupInput());
  const checkoutId = paymentsOf(dir)[0].checkoutId;
  await relay.webhook({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'R1' }), headers: {} });
  const delivery = JSON.parse(boxOf(dir, ownerId).find(m => m.kind === 'signup').body);
  assert.ok(delivery.payment.proof, 'המסירה נושאת אישור חתום');
  const O = install(relayFetch(relay), { withOwner: true });
  await O.sync.ownerReceive();
  const x = owner.signups().find(y => y.id === s.id);
  assert.equal(x.status, 'new');
  assert.equal(x.payment.verified, true);
  // האישור האמיתי, על הרשמה של מישהו אחר — לא מאמת
  const r = owner.addSignup(forgedDelivery(delivery.payment.proof), { requirePaymentProof: true, origin: RELAY_URL });
  assert.equal(r.unverified, true);
  // שרת אחר עם תעודה (origin אחר) — האישור לא מתקבל ממנו
  assert.equal(owner.signups().find(y => y.id === r.id).status, 'review');
});

// ---------- f86 ----------
test('f86: מי ששולט בשם השרת — מעביר את ה-hello לשרת האמיתי ועונה ל-checkout בקישור משלו: הקישור לא נשמר', async () => {
  const { dir, identity } = relayIdentity();
  writeOffer(dir);
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider: fakeProvider() }, identity });
  const mitm = (r, body) => (body.op === 'checkout' ? { ok: true, paymentId: 'p1', url: 'https://evil.example/pay', status: 'pending' } : r);
  const T = install(relayFetch(relay, mitm));
  await assert.rejects(T.sync.signup(signupInput()), /לא אישר בחתימה את פרטי התשלום/);
  assert.equal(T.store.getRemoteSettings().signup, undefined);
  // אותה תשובה חתומה, עם קישור אחר — החתימה נפסלת
  const swap = (r, body) => (body.op === 'checkout' ? { ...r, url: 'https://evil.example/pay', payProof: { ...r.payProof, payload: { ...r.payProof.payload, url: 'https://evil.example/pay' } } } : r);
  const T2 = install(relayFetch(relay, swap));
  await assert.rejects(T2.sync.signup(signupInput()), /חתימת שרת הרישוי על פרטי התשלום אינה תקינה/);
  assert.equal(T2.store.getRemoteSettings().signup, undefined);
});

test('f86: שרת ישן (hello בלי pay-proof) — הודעה ברורה, ופרטי ההרשמה לא נשלחים', async () => {
  const { dir, identity } = relayIdentity();
  writeOffer(dir);
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider: fakeProvider() }, identity });
  const ops = [];
  // תשובת hello כמו של שרת מלפני התיקון — חתומה, בלי caps
  const old = (r, body) => {
    ops.push(body.op);
    if (body.op !== 'checkin') return r;
    return { ...r, checkin: CK.signCheckin(identity.privateJwk, { purpose: 'hello', origin: identity.origin, box: r.checkin.payload.box, challenge: body.payload.checkin, at: Date.now() }) };
  };
  const T = install(relayFetch(relay, old));
  await assert.rejects(T.sync.signup(signupInput()), /גרסה ישנה/);
  assert.ok(!ops.includes('checkout'));
});

test('f86: דף תשלום שאינו של ספק הסליקה — לא נשמר ולא נפתח, גם בחתימה תקינה; מצב תשלום משודר חוזר — נדחה', async () => {
  const { dir, identity } = relayIdentity();
  writeOffer(dir);
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider: fakeProvider({ host: 'https://pay.evil.example/' }) }, identity });
  const T = install(relayFetch(relay));
  await assert.rejects(T.sync.signup(signupInput()), /אינו של ספק הסליקה/);
  assert.equal(T.store.getRemoteSettings().signup, undefined);
  // קישור ישן שנשמר בגרסה קודמת — לא נפתח
  T.store.setRemoteSettings({ signup: { url: 'https://pay.evil.example/x', status: 'pending', origin: RELAY_URL } });
  await assert.rejects(T.sync.paymentUrl(), /אינו של ספק הסליקה/);
  // שרת של הספק תקין; תשובת מצב קודמת משודרת שוב (אתגר אחר) — נדחית
  const good = R.createRelay({ dataDir: dir, billing: { rootKeys, provider: fakeProvider() }, identity });
  let saved = null;
  const replay = (r, body) => { if (body.op !== 'paymentStatus') return r; if (!saved) { saved = r; return r; } return saved; };
  const G = install(relayFetch(good, replay));
  const s = await G.sync.signup(signupInput());
  assert.equal(s.status, 'pending');
  assert.equal(await G.sync.paymentUrl(), s.url);
  await G.sync.signupStatus();
  await assert.rejects(G.sync.signupStatus(), /אינם שייכים לבקשה הזו/);
});

// ---------- f88 ----------
test('f88: payments.json והתיבה נכתבים עם fsync לפני ההחלפה ו-fsync לתיקייה; חבילת ההרשמה נמחקת רק אחריהם', async () => {
  const dir = mk('f88');
  writeOffer(dir);
  const relay = R.createRelay({ dataDir: dir, billing: { rootKeys, provider: fakeProvider({ lookup: false }) } });
  const k = L.generateKeyPair();
  await relay.handle(signedReq(k, 'checkout', sealedSignup(k).payload), '198.51.100.9');
  const [p] = paymentsOf(dir);
  const ev = [];
  const fds = new Map();
  const orig = { openSync: fs.openSync, fsyncSync: fs.fsyncSync, renameSync: fs.renameSync, rmSync: fs.rmSync };
  fs.openSync = function (f, ...rest) { const fd = orig.openSync.call(this, f, ...rest); fds.set(fd, path.resolve(String(f))); return fd; };
  fs.fsyncSync = function (fd) { ev.push(['fsync', fds.get(fd)]); return orig.fsyncSync.call(this, fd); };
  fs.renameSync = function (a, b) { ev.push(['rename', path.resolve(String(b))]); return orig.renameSync.call(this, a, b); };
  fs.rmSync = function (f, ...rest) { ev.push(['rm', path.resolve(String(f))]); return orig.rmSync.call(this, f, ...rest); };
  try {
    await relay.webhook({ rawBody: JSON.stringify({ checkoutId: p.checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'R' }), headers: {} });
  } finally { Object.assign(fs, orig); }
  const D = path.resolve(dir);
  const at = (kind, f) => ev.findIndex(e => e[0] === kind && e[1] === f);
  for (const f of [path.join(D, ownerId + '.json'), path.join(D, 'payments.json')]) {
    const r = at('rename', f);
    assert.ok(r >= 0, 'נכתב: ' + path.basename(f));
    assert.ok(at('fsync', f + '.tmp') >= 0 && at('fsync', f + '.tmp') < r, 'fsync לקובץ הזמני לפני ההחלפה: ' + path.basename(f));
    assert.ok(ev.slice(r + 1).some(e => e[0] === 'fsync' && e[1] === D), 'fsync לתיקייה אחרי ההחלפה: ' + path.basename(f));
  }
  const rm = at('rm', path.join(D, 'signups', p.id + '.json'));
  assert.ok(rm > at('rename', path.join(D, 'payments.json')) && rm > at('rename', path.join(D, ownerId + '.json')), 'חבילת ההרשמה נמחקת אחרון');
});
