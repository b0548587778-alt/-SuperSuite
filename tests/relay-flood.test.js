// רגרסיה לבדיקת האבטחה 21.10.2026 — שרת הרישוי: הצפה ממפתחות חדשים (שאינם עולים כלום)
// 1. דיסק שמתמלא מהודעות לתיבות שאין להן בעלים  2. דפי תשלום בלי הגבלה
// 3. קובץ שלא נקרא נדרס כאילו היה ריק          4. הרשמות חינם שממלאות את תיבת מנהל-העל
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

const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n3. הנתונים נשמרים במחשב הלקוח.\n'.repeat(3);
const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['econ', 'econ.npo'], limits: { maxUsers: 10, maxChildren: 3 } },
    { id: 'free', name: 'גמ"ח קטן', priceAgorot: 0, months: 12, features: ['econ', 'econ.gemach'], limits: { maxUsers: 1, maxChildren: 0 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
};
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };

const root = L.generateKeyPair();
const ownerId = L.keyId(root.publicJwk);
const offerText = OF.createOffer(root.privateJwk, OFFER);
const req = (kp, op, payload) => {
  const pub = kp.publicJwk, ts = Date.now(), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
const signupOf = (kp, planId = 'pro', org = CUSTOMER.org) => SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [root.publicJwk], planId,
  customer: { ...CUSTOMER, org }, signatureImage: SIG, scrolledToEnd: true, accepted: true }).text;
function fakeProvider() {
  let n = 0;
  return {
    name: 'fake', created: () => n,
    async createCheckout() { const id = 'c' + (++n); return { checkoutId: id, url: 'https://pay.example/' + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody),
  };
}
// הבדיקות מנקות את התיקייה הזמנית שלהן
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-fl-')); dirs.push(d); return d; };
const relayWith = (opts = {}) => {
  const dir = tmp();
  return { dir, relay: R.createRelay({ dataDir: dir, billing: { rootKeys: [root.publicJwk], provider: opts.provider || fakeProvider() }, ...opts }) };
};
const box = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return []; } };
const randomBox = () => crypto.randomBytes(16).toString('base64url');
const paidEvent = (checkoutId) => ({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'r1' }), headers: {} });

test('ממצא 1: כתובת אחת עם מפתח חדש לכל בקשה — עוצרת אחרי מכסת השעה', () => {
  const { relay } = relayWith();
  let sent = 0, err = null;
  for (let i = 0; i < 40 && !err; i++) {
    try { sent += relay.handle(req(L.generateKeyPair(), 'send', { items: Array.from({ length: 50 }, () => ({ to: randomBox(), kind: 'message', body: 'x' })) }), '203.0.113.7').sent; }
    catch (e) { err = e; }
  }
  assert.ok(err && err.status === 429, 'נעצר במכסה');
  assert.match(err.message, /מהכתובת הזו/);
  assert.ok(sent <= 1000, 'לא יותר מ-1,000 הודעות בשעה מכתובת אחת');
  // כתובת אחרת לא נפגעת
  assert.equal(relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body: 'x' }] }), '198.51.100.2').sent, 1);
});

test('ממצא 1: תקרת אחסון — שליחה רגילה נדחית, הרשמה ששולמה עדיין נמסרת (מקום שמור)', async () => {
  const provider = fakeProvider();
  const { dir, relay } = relayWith({ provider, maxStoreBytes: 64 * 1024 });
  const buyer = L.generateKeyPair();
  const co = await relay.handle(req(buyer, 'checkout', { signup: signupOf(buyer) }), '198.51.100.9');
  assert.equal(co.status, 'pending');
  let err = null;
  for (let i = 0; i < 200 && !err; i++) {
    try { relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body: 'x'.repeat(4000) }] }), '10.1.' + i + '.1'); }
    catch (e) { err = e; }
  }
  assert.ok(err && err.status === 507, 'השרת מלא — נדחה');
  assert.match(err.message, /השרת מלא/);
  const checkoutId = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].checkoutId;
  assert.equal(relay.webhook(paidEvent(checkoutId)).ok, true);
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 1, 'הלקוח ששילם מקבל רישיון גם כשהשרת מלא');
});

test('ממצא 1: הודעה שלא נקראה 60 יום נמחקת; מסירה של השרת לא נמחקת', () => {
  let t = Date.now();
  const dir = tmp();
  const relay = R.createRelay({ dataDir: dir, clock: () => t, billing: { rootKeys: [root.publicJwk], provider: fakeProvider() } });
  const to = randomBox();
  relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to, kind: 'message', body: 'x' }] }), '10.2.0.1');
  fs.writeFileSync(path.join(dir, ownerId + '.json'), JSON.stringify([{ id: 'sys', from: 'relay', kind: 'signup', body: '{}', at: t }]));
  assert.equal(box(dir, to).length, 1);
  t += 61 * 24 * 3600 * 1000;
  relay.expireMessages();
  assert.equal(fs.existsSync(path.join(dir, to + '.json')), false, 'התיבה הנטושה נמחקה');
  assert.equal(box(dir, ownerId).length, 1, 'הרשמה ששולמה נשארת');
});

test('ממצא 2: דפי תשלום — מכסה לכתובת, והרשמה זהה לא פותחת דף שני', async () => {
  const provider = fakeProvider();
  const { dir, relay } = relayWith({ provider });
  const kp = L.generateKeyPair();
  const su = signupOf(kp);
  const a = await relay.handle(req(kp, 'checkout', { signup: su }), '203.0.113.9');
  const b = await relay.handle(req(kp, 'checkout', { signup: su }), '203.0.113.9');
  assert.equal(b.paymentId, a.paymentId, 'אותה הרשמה — אותו תשלום');
  assert.equal(provider.created(), 1);
  let err = null, ok = 1;
  for (let i = 0; i < 40 && !err; i++) {
    const k = L.generateKeyPair();
    try { await relay.handle(req(k, 'checkout', { signup: signupOf(k) }), '203.0.113.9'); ok++; } catch (e) { err = e; }
  }
  assert.ok(err && err.status === 429, 'נעצר במכסה');
  assert.ok(ok <= 20 && provider.created() <= 20, 'עד 20 דפי תשלום ביום מכתובת אחת');
  // payments.json מחזיק רק פרטי תשלום — חבילת ההרשמה בקובץ נפרד
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'));
  assert.ok(list.every(x => x.signup === undefined));
  assert.ok(fs.statSync(path.join(dir, 'payments.json')).size < 400 * list.length);
});

test('ממצא 2: חבילת ההרשמה נמסרת מהקובץ הנפרד, ונמחקת אחרי המסירה; רשומה ישנה עם signup בתוכה עדיין נמסרת', async () => {
  const { dir, relay } = relayWith();
  const kp = L.generateKeyPair();
  await relay.handle(req(kp, 'checkout', { signup: signupOf(kp) }), '198.51.100.3');
  const x = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0];
  assert.equal(fs.existsSync(path.join(dir, 'signups', x.id + '.json')), true);
  relay.webhook(paidEvent(x.checkoutId));
  const got = box(dir, ownerId).filter(m => m.kind === 'signup');
  assert.equal(got.length, 1);
  assert.equal(SU.verifySignup(JSON.parse(got[0].body).signup, [root.publicJwk]).body.keyId, kp.keyId);
  assert.equal(fs.existsSync(path.join(dir, 'signups', x.id + '.json')), false);
  // רשומה מלפני השינוי (signup בתוך payments.json)
  const old = L.generateKeyPair();
  fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify([{ id: 'old1', keyId: old.keyId, signupId: 's-old', amountAgorot: 49900, checkoutId: 'c-old', status: 'pending', createdAt: Date.now(), signup: signupOf(old) }]));
  relay.webhook(paidEvent('c-old'));
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 2);
});

test('ממצא 3: קובץ תשלומים שאינו קריא — שגיאה, ולא נדרס', async () => {
  const { dir, relay } = relayWith();
  const real = L.generateKeyPair();
  await relay.handle(req(real, 'checkout', { signup: signupOf(real) }), '198.51.100.1');
  const f = path.join(dir, 'payments.json');
  const before = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, before.slice(0, -5)); // נקטע באמצע (תקלת דיסק / קובץ שלא נקרא)
  const atk = L.generateKeyPair();
  await assert.rejects(() => relay.handle(req(atk, 'checkout', { signup: signupOf(atk) }), '203.0.113.9'), (e) => e.status === 503);
  assert.equal(fs.readFileSync(f, 'utf8'), before.slice(0, -5), 'הקובץ לא נדרס');
  // אחרי תיקון הקובץ — התשלום של הלקוח האמיתי עדיין שם
  fs.writeFileSync(f, before);
  assert.equal(relay.webhook(paidEvent(JSON.parse(before)[0].checkoutId)).ok, true);
});

test('ממצא 3: תיבה פגומה — שליחה אליה נדחית ולא מוחקת את ההודעות', () => {
  const { dir, relay } = relayWith();
  const to = randomBox();
  fs.writeFileSync(path.join(dir, to + '.json'), '[{"id":"a","from":"x"');
  assert.throws(() => relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to, kind: 'message', body: 'x' }] }), '10.3.0.1'), (e) => e.status === 503);
  assert.equal(fs.readFileSync(path.join(dir, to + '.json'), 'utf8'), '[{"id":"a","from":"x"');
});

test('ממצא 4: הרשמות חינם — מכסה לכתובת, ולא חוסמות הרשמה ששולמה', async () => {
  const { dir, relay } = relayWith();
  let err = null, ok = 0;
  for (let i = 0; i < 10 && !err; i++) {
    const k = L.generateKeyPair();
    try { assert.equal((await relay.handle(req(k, 'checkout', { signup: signupOf(k, 'free', 'גמ"ח ' + i) }), '203.0.113.5')).free, true); ok++; }
    catch (e) { err = e; }
  }
  assert.equal(ok, 3);
  assert.equal(err.status, 429);
  const frees = box(dir, ownerId).filter(m => m.free);
  assert.equal(frees.length, 3);
  // תקרת הרשמות חינם בתיבה: גם מכתובות רבות — לא נכנסות מעבר לה, והרשמה ששולמה עדיין נמסרת
  fs.writeFileSync(path.join(dir, ownerId + '.json'), JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: 'f' + i, from: 'relay', kind: 'signup', body: '{}', at: Date.now(), free: true }))));
  const late = L.generateKeyPair();
  await assert.rejects(() => relay.handle(req(late, 'checkout', { signup: signupOf(late, 'free') }), '10.4.0.1'), (e) => e.status === 507);
  const buyer = L.generateKeyPair();
  await relay.handle(req(buyer, 'checkout', { signup: signupOf(buyer) }), '10.5.0.1');
  const x = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0];
  assert.equal(relay.webhook(paidEvent(x.checkoutId)).ok, true);
  assert.equal(box(dir, ownerId).filter(m => !m.free).length, 1);
});
