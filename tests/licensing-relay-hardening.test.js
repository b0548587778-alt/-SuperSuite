// הקשחת שרת הממסר: מכסות לשולח, זיכרון חסום, מפתחות זמניים תקינים, וזמני המתנה לחיבורים איטיים
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const PK = require('../shell/licensing/prekeys');
const { createRelay, createServer } = require('../server/license-relay');

let seq = 0;
const signed = (k, op, payload, ts = Date.now()) => {
  const req = { pub: L.publicOf(k.privateJwk), ts, nonce: 'hard-nonce-' + (++seq) + '-abcdef', op, payload };
  req.sig = L.signObject({ pub: req.pub, ts: req.ts, nonce: req.nonce, op, payload }, k.privateJwk);
  return req;
};
const newRelay = (opts = {}) => createRelay({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-h-')), ...opts });
const items = (to, n) => Array.from({ length: n }, () => ({ to, kind: 'message', body: 'x' }));

test('שולח אחד לא ממלא תיבה של אחר; שליחה שנדחתה לא נכתבת בחלקה', () => {
  const relay = newRelay();
  const a = L.generateKeyPair(), b = L.generateKeyPair(), c = L.generateKeyPair(), eve = L.generateKeyPair();
  relay.handle(signed(eve, 'send', { items: items(b.keyId, 50) }));
  relay.handle(signed(eve, 'send', { items: items(b.keyId, 50) }));
  // מכסת שולח בתיבה מלאה — וגם ההודעה ל-c באותה בקשה לא נשלחה
  assert.throws(() => relay.handle(signed(eve, 'send', { items: [{ to: c.keyId, kind: 'message', body: 'x' }, ...items(b.keyId, 1)] })), /שטרם נקראו/);
  assert.equal(relay.handle(signed(c, 'fetch', {})).messages.length, 0, 'אין כתיבה חלקית');
  // שולח אחר עדיין מגיע לנמען
  assert.equal(relay.handle(signed(a, 'send', { items: items(b.keyId, 1) })).sent, 1);
  // אחרי שהנמען קרא ומחק — אפשר שוב
  const got = relay.handle(signed(b, 'fetch', {})).messages;
  relay.handle(signed(b, 'ack', { ids: got.map(m => m.id) }));
  assert.equal(relay.handle(signed(eve, 'send', { items: items(b.keyId, 1) })).sent, 1);
  // שליחה לעצמי — לא
  assert.throws(() => relay.handle(signed(a, 'send', { items: items(a.keyId, 1) })), /לא תקינה/);
});

test('מכסת הודעות לשעה למפתח שולח', () => {
  let t = Date.now();
  const relay = newRelay({ clock: () => t });
  const eve = L.generateKeyPair();
  const targets = Array.from({ length: 6 }, () => L.generateKeyPair().keyId);
  for (let i = 0; i < 10; i++) relay.handle(signed(eve, 'send', { items: items(targets[i % 5], 50) }, t));
  assert.throws(() => relay.handle(signed(eve, 'send', { items: items(targets[5], 1) }, t)), /בשעה האחרונה/);
  t += 61 * 60 * 1000;
  assert.equal(relay.handle(signed(eve, 'send', { items: items(targets[5], 1) }, t)).sent, 1, 'מתאפס אחרי שעה');
});

test('מפתח זמני: נדחה אם המבנה פגום או חתום בשם אחר; תקין — נשמר ונקרא', () => {
  const relay = newRelay();
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const bundle = PK.createPrekeyStore({ storage: { read: () => null, write: () => {} } }).bundle(a.privateJwk);
  assert.throws(() => relay.handle(signed(b, 'setPrekey', { bundle })), /לא תקין/, 'של מפתח אחר');
  const bad = { ...bundle, pub: 'short' };
  const { sig, ...p } = bad;
  assert.throws(() => relay.handle(signed(a, 'setPrekey', { bundle: { ...p, sig: L.signObject(p, a.privateJwk) } })), /לא תקין/, 'מפתח באורך שגוי');
  assert.equal(relay.handle(signed(a, 'setPrekey', { bundle })).ok, true);
  assert.deepEqual(relay.handle(signed(b, 'getPrekey', { id: a.keyId })).bundle, bundle);
});

test('בקשה כפולה נדחית גם אחרי ניקוי תקופתי של הזיכרון', () => {
  let t = Date.now();
  const relay = newRelay({ clock: () => t });
  const a = L.generateKeyPair();
  const req = signed(a, 'fetch', {}, t);
  relay.handle(req);
  t += 60 * 1000; // ניקוי תקופתי רץ — אבל ה-nonce עדיין בתוקף
  relay.handle(signed(a, 'fetch', {}, t));
  assert.throws(() => relay.handle(req), /כפולה/);
});

test('שרת: זמני המתנה לחיבורים איטיים מוגדרים', () => {
  const server = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-h-')) });
  assert.ok(server.headersTimeout > 0 && server.headersTimeout <= 30000);
  assert.ok(server.requestTimeout > 0 && server.requestTimeout <= 60000);
});
