// בדיקת קוד 22.10.2026 (audit-changes-since-20-10.md, ממצאים 1–2): התיבה של מנהל-העל ציבורית, ומפתח חדש לא
// עולה כלום — כתובת אחת מילאה אותה תוך 8 דקות וחסמה בקשות רישוי; תיבה של 125MB לא נמשכה בזמן הקצוב,
// וכל שליחה שנדחתה קראה ופענחה את כל התיבה
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const R = require('../server/license-relay');
const { createRemote } = require('../shell/licensing/remote');

const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* נשאר לניקוי של run-tests */ } } });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-ob-')); dirs.push(d); return d; };
const root = L.generateKeyPair();
const ownerId = L.keyId(root.publicJwk);
const rootKp = { publicJwk: root.publicJwk, privateJwk: root.privateJwk };
const relayAt = (dir) => R.createRelay({ dataDir: dir, billing: { rootKeys: [root.publicJwk], provider: null } });
const req = (kp, op, payload) => {
  const pub = L.publicOf(kp.privateJwk), ts = Date.now(), nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
const items = (to, n, kind = 'license-request', body = 'x') => Array.from({ length: n }, () => ({ to, kind, body }));
const send = (relay, kp, to, n, ip, kind) => relay.handle(req(kp, 'send', { items: items(to, n, kind) }), ip);
const boxLen = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')).length; } catch { return 0; } };
// ממלא את המכסה של שולחים לא מוכרים בתיבה של מנהל-העל: מפתח חדש וכתובת חדשה לכל 20
function floodOwner(relay) {
  let sent = 0, err = null;
  for (let i = 0; i < 40 && !err; i++) {
    const n = Math.min(R.SEND_PER_IP_TO_BOX_HOUR, R.MAX_UNKNOWN_IN_OWNER_BOX - sent) || 1; // בסוף — עוד אחת, שנדחית
    try { sent += send(relay, L.generateKeyPair(), ownerId, n, '10.20.' + i + '.1').sent; } catch (e) { err = e; }
  }
  return { sent, err };
}

test('ממצא 1א: כתובת אחת — עד 20 הודעות בשעה לתיבה אחת, גם עם מפתח חדש לכל בקשה', () => {
  const relay = relayAt(tmp());
  const to = L.generateKeyPair().keyId;
  let sent = 0, err = null;
  for (let i = 0; i < 10 && !err; i++) {
    try { sent += send(relay, L.generateKeyPair(), to, 5, '203.0.113.7').sent; } catch (e) { err = e; }
  }
  assert.equal(sent, 20);
  assert.equal(err && err.status, 429);
  assert.match(err.message, /לנמען הזה מהכתובת הזו/);
  // תיבה אחרת מאותה כתובת, ואותה תיבה מכתובת אחרת — לא נפגעות
  assert.equal(send(relay, L.generateKeyPair(), L.generateKeyPair().keyId, 1, '203.0.113.7').sent, 1);
  assert.equal(send(relay, L.generateKeyPair(), to, 1, '198.51.100.4').sent, 1);
});

test('ממצא 1א: מי שבעל התיבה כתב לו — לא כפוף למכסה לכתובת (שיחה רגילה)', () => {
  const relay = relayAt(tmp());
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  send(relay, b, a.keyId, 1, '198.51.100.1', 'message'); // b כתב ל-a
  assert.equal(send(relay, a, b.keyId, 25, '203.0.113.8', 'message').sent, 25, 'a עונה ל-b — יותר מ-20 מאותה כתובת');
});

test('ממצא 1ב: שולחים לא מוכרים תופסים רק חלק מהתיבה של מנהל-העל; לקוח שמנהל-העל כתב לו — עובר, גם אחרי הפעלה מחדש', () => {
  const dir = tmp();
  const relay = relayAt(dir);
  const customer = L.generateKeyPair();
  relay.handle(req(rootKp, 'send', { items: [{ to: customer.keyId, kind: 'license', body: '{}' }] }), '192.0.2.1'); // מנהל-העל שלח לו רישיון
  const { sent, err } = floodOwner(relay);
  assert.equal(sent, R.MAX_UNKNOWN_IN_OWNER_BOX, 'ההצפה נעצרה במכסה של הלא מוכרים');
  assert.equal(err && err.status, 507);
  assert.ok(R.MAX_UNKNOWN_IN_OWNER_BOX < R.MAX_MAILBOX);
  // הלקוח המוכר — עדיין מגיע, גם יותר מ-20 מאותה כתובת
  assert.equal(send(relay, customer, ownerId, 30, '10.20.0.1').sent, 30);
  // אחרי הפעלה מחדש של השרת — עדיין מוכר (נשמר בקובץ), והלא מוכרים עדיין חסומים
  const again = relayAt(dir);
  assert.equal(send(again, customer, ownerId, 1, '10.99.0.1').sent, 1);
  assert.throws(() => send(again, L.generateKeyPair(), ownerId, 1, '10.99.0.2'), (e) => e.status === 507);
  assert.equal(boxLen(dir, ownerId), R.MAX_UNKNOWN_IN_OWNER_BOX + 31);
});

test('ממצא 1ג: תקרת נפח לתיבה — 20MB של הודעות חוסמים גם כשמספר ההודעות נמוך מהתקרה', () => {
  const dir = tmp();
  const relay = relayAt(dir);
  const to = L.generateKeyPair().keyId;
  const big = Array.from({ length: 80 }, (_, i) => ({ id: 'b' + i, from: L.generateKeyPair().keyId, kind: 'message', body: 'x'.repeat(256 * 1024), at: Date.now() }));
  fs.writeFileSync(path.join(dir, to + '.json'), JSON.stringify(big));
  assert.ok(big.length < R.MAX_MAILBOX);
  assert.throws(() => send(relay, L.generateKeyPair(), to, 1, '198.51.100.7'), (e) => e.status === 507 && /מלאה/.test(e.message));
});

test('ממצא 1ד: משיכה בחלקים — הלקוח מקבל את כל התיבה בכמה בקשות, ואחרי האישור היא ריקה', async () => {
  const dir = tmp();
  const relay = relayAt(dir);
  const me = L.generateKeyPair();
  const msgs = Array.from({ length: 250 }, (_, i) => ({ id: 'm' + i, from: 'relay', kind: 'notices', body: 'y'.repeat(1000), at: Date.now() }));
  fs.writeFileSync(path.join(dir, me.keyId + '.json'), JSON.stringify(msgs));
  const first = relay.handle(req(me, 'fetch', {}), '127.0.0.1');
  assert.equal(first.messages.length, R.FETCH_MAX_MESSAGES);
  assert.equal(first.more, true);
  const second = relay.handle(req(me, 'fetch', { after: first.messages[first.messages.length - 1].id }), '127.0.0.1');
  assert.equal(second.messages[0].id, 'm' + R.FETCH_MAX_MESSAGES, 'ממשיך מאחרי ההודעה האחרונה');
  // הלקוח (remote.js) מחבר את החלקים
  const calls = [];
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body);
    calls.push(body.payload);
    let data, status = 200;
    try { data = await relay.handle(body, '127.0.0.2'); } catch (e) { status = e.status || 500; data = { ok: false, error: e.message }; }
    return { ok: status === 200, status, json: async () => data };
  };
  const rm = createRemote({ url: 'http://localhost:9', fetchImpl });
  const got = await rm.fetch(me.privateJwk);
  assert.equal(got.length, 250);
  assert.deepEqual(got.map(m => m.id), msgs.map(m => m.id));
  assert.equal(calls.length, 3);
  await rm.ack(me.privateJwk, got.map(m => m.id));
  assert.equal(boxLen(dir, me.keyId), 0);
});

test('ממצא 1ד: חלק אחד לא עובר את תקרת הנפח של משיכה', () => {
  const dir = tmp();
  const relay = relayAt(dir);
  const me = L.generateKeyPair();
  const msgs = Array.from({ length: 12 }, (_, i) => ({ id: 'g' + i, from: 'relay', kind: 'license', body: 'z'.repeat(256 * 1024), at: Date.now() }));
  fs.writeFileSync(path.join(dir, me.keyId + '.json'), JSON.stringify(msgs));
  const page = relay.handle(req(me, 'fetch', {}), '127.0.0.1');
  assert.ok(page.messages.length >= 1 && page.messages.length < 12);
  assert.ok(Buffer.byteLength(JSON.stringify(page.messages)) <= R.FETCH_MAX_BYTES + 1024);
  assert.equal(page.more, true);
});

test('ממצא 2: שליחה שנדחתה לתיבה מלאה לא קוראת את התיבה', () => {
  const dir = tmp();
  const relay = relayAt(dir);
  floodOwner(relay);
  const file = path.join(dir, ownerId + '.json');
  const orig = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (f, ...rest) { if (path.resolve(String(f)) === path.resolve(file)) reads++; return orig.call(this, f, ...rest); };
  try {
    for (let i = 0; i < 5; i++) assert.throws(() => send(relay, L.generateKeyPair(), ownerId, 1, '10.30.' + i + '.1'), (e) => e.status === 507);
  } finally { fs.readFileSync = orig; }
  assert.equal(reads, 0, 'נבדק מול האינדקס בלבד');
});
