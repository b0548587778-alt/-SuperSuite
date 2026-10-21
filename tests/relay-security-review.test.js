// רגרסיה לסקירת האבטחה 10.2026 — שרת הרישוי: ממצאים 1, 4, 5, 8
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const R = require('../server/license-relay');

// כמו ב-licensing-signup.test.js
const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [{ id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['econ', 'econ.npo'], limits: { maxUsers: 10, maxChildren: 3 } }],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
};
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };

const root = L.generateKeyPair();
const ownerId = L.keyId(root.publicJwk);
const req = (kp, op, payload) => {
  const pub = kp.publicJwk, ts = Date.now(), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
// ספק מדומה: webhook "שולם" מאומת תמיד; createCheckout אפשר לעכב כדי לייצר מקביליות
function fakeProvider() {
  let n = 0, gate = null;
  return {
    name: 'fake',
    hold() { let release; gate = new Promise(r => { release = r; }); return () => release(); },
    async createCheckout() { const id = 'c' + (++n); if (gate) await gate; return { checkoutId: id, url: 'https://pay.example/' + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody),
  };
}
const relayWith = (provider) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-sr-'));
  return { dir, relay: R.createRelay({ dataDir: dir, billing: { rootKeys: [root.publicJwk], provider } }) };
};
const payments = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'));
const box = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return []; } };
const pending = (dir, over = {}) => fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify([
  { id: 'p1', keyId: 'k', signupId: 's1', amountAgorot: 18000, checkoutId: 'c1', status: 'pending', createdAt: Date.now(), signup: '{}', ...over }]));
const paid = (checkoutId = 'c1') => ({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 18000, providerRef: 'r1' }), headers: {} });

// הצפה: מפתחות חדשים מכתובות שונות ממלאים את תיבת מנהל-העל עד התקרה. מאז בדיקת הקוד של 22.10.2026 —
// עד המכסה של שולחים שמנהל-העל לא כתב להם (MAX_UNKNOWN_IN_OWNER_BOX), ו-20 בשעה מכל כתובת
function flood(relay) {
  let sent = 0;
  for (let i = 0; sent < R.MAX_UNKNOWN_IN_OWNER_BOX; i++) {
    const n = Math.min(R.SEND_PER_IP_TO_BOX_HOUR, R.MAX_UNKNOWN_IN_OWNER_BOX - sent);
    sent += relay.handle(req(L.generateKeyPair(), 'send', { items: Array.from({ length: n }, () => ({ to: ownerId, kind: 'message', body: 'x' })) }), '10.0.' + i + '.1').sent;
  }
}

test('ממצא 1: תיבת מנהל-העל מוצפת — הרשמה ששולמה עדיין נמסרת', () => {
  const { dir, relay } = relayWith(fakeProvider());
  flood(relay);
  assert.throws(() => relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: ownerId, kind: 'message', body: 'x' }] }), '10.9.9.9'), /מלאה/);
  pending(dir);
  assert.deepEqual(relay.webhook(paid()), { ok: true });
  assert.equal(payments(dir)[0].status, 'paid');
  assert.ok(box(dir, ownerId).some(m => m.from === 'relay' && m.kind === 'signup'), 'ההרשמה הגיעה למנהל-העל');
});

test('ממצא 1: מסירה שנכשלה משאירה את התשלום pending — הניסיון החוזר של הספק מוסר', () => {
  const { dir, relay } = relayWith(fakeProvider());
  pending(dir);
  // תיבה בלתי כתיבה: תיקייה במקום הקובץ
  fs.mkdirSync(path.join(dir, ownerId + '.json'));
  assert.throws(() => relay.webhook(paid()));
  assert.equal(payments(dir)[0].status, 'pending', 'לא סומן "שולם" לפני שנמסר');
  fs.rmdirSync(path.join(dir, ownerId + '.json'));
  assert.deepEqual(relay.webhook(paid()), { ok: true });
  assert.equal(payments(dir)[0].status, 'paid');
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 1);
  assert.deepEqual(relay.webhook(paid()), { ok: true, duplicate: true }, 'ניסיון שלישי — כפול, בלי מסירה נוספת');
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 1);
});

test('ממצא 1: הודעות מהשרת לא תופסות מקום של שולחים רגילים', () => {
  const { dir, relay } = relayWith(fakeProvider());
  for (let i = 0; i < 3; i++) { pending(dir, { id: 'p' + i, checkoutId: 'c' + i }); relay.webhook(paid('c' + i)); }
  flood(relay); // עדיין אפשר למלא עד התקרה המלאה
  assert.equal(box(dir, ownerId).length, R.MAX_UNKNOWN_IN_OWNER_BOX + 3);
});

test('ממצא 4: webhook בזמן ש-checkout ממתין לספק — לא נדרס', async () => {
  const provider = fakeProvider();
  const { dir, relay } = relayWith(provider);
  pending(dir);
  const release = provider.hold();
  const device = L.generateKeyPair();
  const signup = SU.createSignup({ deviceJwk: device.privateJwk, offerText: OF.createOffer(root.privateJwk, OFFER), rootKeys: [root.publicJwk],
    planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true }).text;
  const co = relay.handle(req(device, 'checkout', { signup }), '10.1.1.1');
  relay.webhook(paid());           // בינתיים, בזמן שהספק עוד לא ענה: webhook על תשלום קיים
  release();
  await co;
  const all = payments(dir);
  assert.equal(all.find(x => x.id === 'p1').status, 'paid', 'ה-webhook לא נדרס על ידי ה-checkout');
  assert.equal(all.length, 2);
});

test('ממצא 4: שני checkout במקביל לאותה הרשמה — תשלום אחד בלבד', async () => {
  const provider = fakeProvider();
  const { dir, relay } = relayWith(provider);
  const release = provider.hold();
  const device = L.generateKeyPair();
  const signup = SU.createSignup({ deviceJwk: device.privateJwk, offerText: OF.createOffer(root.privateJwk, OFFER), rootKeys: [root.publicJwk],
    planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true }).text;
  const a = relay.handle(req(device, 'checkout', { signup }), '10.1.1.1');
  const b = relay.handle(req(device, 'checkout', { signup }), '10.1.1.1');
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(payments(dir).length, 1);
  assert.equal(ra.paymentId, rb.paymentId, 'שתי הבקשות מפנות לאותו דף תשלום');
});

test('ממצא 5: מאחורי פרוקסי — הגבלת הקצב לפי הלקוח, ורק כשמוגדר', () => {
  const r = (fwd, ip = '127.0.0.1') => ({ socket: { remoteAddress: ip }, headers: fwd ? { 'x-forwarded-for': fwd } : {} });
  assert.equal(R.clientAddress(r('1.2.3.4'), false), '127.0.0.1', 'בלי trustProxy — הכותרת לא נקראת (אפשר לזייף אותה)');
  assert.equal(R.clientAddress(r('1.2.3.4'), true), '1.2.3.4');
  assert.equal(R.clientAddress(r('6.6.6.6, 1.2.3.4'), true), '1.2.3.4', 'הכתובת שהפרוקסי הוסיף, לא מה שהלקוח שלח');
  assert.equal(R.clientAddress(r(''), true), '127.0.0.1');
});

test('ממצא 8: ספק הבדיקות לא נדלק בטעות בשרת אמיתי', () => {
  assert.throws(() => R.assertPaymentConfig({ pay: 'test', publicUrl: 'http://localhost:8443', env: {} }), /SS_ALLOW_TEST_PAYMENTS/);
  const ok = { SS_ALLOW_TEST_PAYMENTS: '1' };
  assert.doesNotThrow(() => R.assertPaymentConfig({ pay: 'test', publicUrl: 'http://localhost:8443', env: ok }));
  assert.doesNotThrow(() => R.assertPaymentConfig({ pay: 'test', publicUrl: 'https://relay.test', env: ok }));
  assert.throws(() => R.assertPaymentConfig({ pay: 'test', publicUrl: 'https://license.example.org', env: ok }), /כתובת מקומית/);
  assert.throws(() => R.assertPaymentConfig({ pay: 'test', cert: 'cert.pem', publicUrl: 'http://localhost', env: ok }), /תעודת HTTPS/);
  assert.doesNotThrow(() => R.assertPaymentConfig({ pay: undefined, env: {} }), 'בלי תשלום — אין מה לבדוק');
});
