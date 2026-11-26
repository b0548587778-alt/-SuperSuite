// סקירה 2.11.2026 — שרת הרישוי ותנאי ההפעלה:
// f3  בקשת send אחת טענה לזיכרון עד 50 תיבות מלאות יחד (OOM). עכשיו: תיבה אחת בכל פעם, עד SEND_MAX_BOXES נמענים,
//     והמכסות נבדקות לפני קריאה מהדיסק
// f16 מכסות לפי כתובת — כל לקוחות NetFree חולקים כתובת יציאה. עכשיו: לפי המפתח המאומת, ולכתובת — מכסה גבוהה
// f17 קבצי prekey לא נמחקו לעולם — עכשיו נמחקים אחרי 30 יום, ויש מכסה ליצירה
// f18 כתובת אחת מילאה את כל האחסון — עכשיו מכסת נפח, תפוגה של 7 ימים לתיבה מתה, ומקום שמור לרכישה
// f19 הגוף נקרא כולו לפני הגבלת הקצב — עכשיו הגבלה ובקשות במקביל לפני קריאת הגוף
// f89 פרטי ההרשמה (ת.ז, טלפון, תמונת חתימה) נשמרו בשרת בגלוי — עכשיו מוצפנים למנהל-העל
// f67 המדריך הבטיח "לא צריך אינטרנט"; החלטת הבעלים: 30–60 יום בלי חיבור — צפייה בלבד, אחרי 60 — נעול
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const L = require('../shell/licensing/license');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const M = require('../shell/licensing/messages');
const LG = require('../shell/licensing/gate');
const R = require('../server/license-relay');
const { createOwnerCore } = require('../shell/licensing/owner-core');

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* run-tests מנקה */ } } });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-review-relay-')); dirs.push(d); return d; };

const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const owner = createOwnerCore({ storage: mem() });
const rootPub = owner.init('menahel-al-review-2026').publicKey;
const ownerId = L.keyId(rootPub);
const TERMS = 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n2. התשלום מראש לתקופה שנבחרה.\n'.repeat(3);
owner.setOffer({
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['econ', 'shamai'], limits: { maxUsers: 10, maxChildren: 3 } },
    { id: 'free', name: 'בסיסי', priceAgorot: 0, months: 12, features: ['econ'], limits: { maxUsers: 1, maxChildren: 0 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: TERMS },
});
const offerText = owner.offer().text;
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };

const req = (kp, op, payload, ts = Date.now()) => {
  const pub = kp.publicJwk, nonce = crypto.randomBytes(18).toString('base64url');
  return { pub, ts, nonce, op, payload, sig: L.signObject({ pub, ts, nonce, op, payload }, kp.privateJwk) };
};
function fakeProvider() {
  let n = 0;
  return { name: 'fake', calls: [], async createCheckout(x) { this.calls.push(x); const id = 'c' + (++n); return { checkoutId: id, url: 'https://pay.example/' + id }; },
    parseWebhook: ({ rawBody }) => JSON.parse(rawBody) };
}
const relayWith = (opts = {}) => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'offer.json'), JSON.stringify({ text: offerText, issuedAt: JSON.parse(offerText).payload.issuedAt }));
  const provider = opts.provider || fakeProvider();
  return { dir, provider, relay: R.createRelay({ dataDir: dir, billing: { rootKeys: [rootPub], provider }, ...opts }) };
};
const randomBox = () => crypto.randomBytes(16).toString('base64url');
const boxFile = (dir, id) => path.join(dir, id + '.json');
const box = (dir, id) => { try { return JSON.parse(fs.readFileSync(boxFile(dir, id), 'utf8')); } catch { return []; } };
// כל הקבצים בתיקייה, כטקסט אחד — לבדוק שאין בהם פרטים מזהים
function allText(dir) {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out += e.isDirectory() ? allText(p) : fs.readFileSync(p, 'utf8');
  }
  return out;
}

// ---------- f3 ----------
test('f3: יותר מ-SEND_MAX_BOXES נמענים בבקשה — נדחה בלי לקרוא אף תיבה', () => {
  const { dir, relay } = relayWith();
  const boxes = Array.from({ length: R.SEND_MAX_BOXES + 1 }, randomBox);
  for (const b of boxes) fs.writeFileSync(boxFile(dir, b), JSON.stringify([{ id: 'a', from: 'x', kind: 'message', body: 'y', at: Date.now() }]));
  const orig = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (f, ...rest) { if (boxes.some(b => path.resolve(String(f)) === boxFile(dir, b))) reads++; return orig.call(this, f, ...rest); };
  try {
    assert.throws(() => relay.handle(req(L.generateKeyPair(), 'send', { items: boxes.map(to => ({ to, kind: 'message', body: 'x' })) }), '198.51.100.1'),
      (e) => e.status === 400 && /יותר מדי נמענים/.test(e.message));
  } finally { fs.readFileSync = orig; }
  assert.equal(reads, 0);
});

test('f3: שליחה לכמה תיבות — כל תיבה נקראת ונכתבת לפני שהבאה נקראת (אף פעם לא כמה תיבות בזיכרון יחד)', () => {
  const { dir, relay } = relayWith();
  const boxes = Array.from({ length: R.SEND_MAX_BOXES }, randomBox);
  // תיבות קיימות, ואינדקס שעוד לא בזיכרון (השרת "הופעל מחדש")
  for (const b of boxes) fs.writeFileSync(boxFile(dir, b), JSON.stringify([{ id: 'old-' + b, from: L.generateKeyPair().keyId, kind: 'message', body: 'z'.repeat(1000), at: Date.now() }]));
  const events = [];
  const origRead = fs.readFileSync, origWrite = fs.writeFileSync, origOpen = fs.openSync;
  const which = (f) => boxes.find(b => path.resolve(String(f)).startsWith(boxFile(dir, b)));
  fs.readFileSync = function (f, ...rest) { const b = which(f); const out = origRead.call(this, f, ...rest); if (b) events.push(['r', b]); return out; };
  fs.writeFileSync = function (f, ...rest) { const b = which(f); if (b) events.push(['w', b]); return origWrite.call(this, f, ...rest); };
  // כתיבה עמידה (f88): הקובץ הזמני נפתח לכתיבה ב-openSync
  fs.openSync = function (f, flags, ...rest) { const b = flags === 'w' && which(f); if (b) events.push(['w', b]); return origOpen.call(this, f, flags, ...rest); };
  try {
    const r = relay.handle(req(L.generateKeyPair(), 'send', { items: boxes.map(to => ({ to, kind: 'message', body: 'x' })) }), '198.51.100.2');
    assert.equal(r.sent, boxes.length);
  } finally { fs.readFileSync = origRead; fs.writeFileSync = origWrite; fs.openSync = origOpen; }
  // שלב הכתיבה: אחרי כל קריאה של תיבה — הכתיבה שלה, לפני קריאה של תיבה אחרת
  const firstWrite = events.findIndex(e => e[0] === 'w');
  const phase = events.slice(firstWrite - 1);
  for (let i = 0; i < phase.length; i += 2) {
    assert.equal(phase[i][0], 'r');
    assert.deepEqual(phase[i + 1], ['w', phase[i][1]], 'הכתיבה של אותה תיבה מיד אחרי הקריאה');
  }
  for (const b of boxes) assert.equal(box(dir, b).length, 2);
});

test('f3: מכסה שנגמרה — נדחה לפני שנקראת תיבה מהדיסק', () => {
  const { dir, relay } = relayWith();
  const to = randomBox();
  fs.writeFileSync(boxFile(dir, to), JSON.stringify([]));
  const ip = '10.41.0.1';
  // ממלאים את המכסה לכתובת (מפתח חדש לכל בקשה)
  let sent = 0;
  for (let i = 0; sent < R.SEND_PER_IP_HOUR; i++) {
    sent += relay.handle(req(L.generateKeyPair(), 'send', { items: Array.from({ length: R.SEND_MAX_BOXES }, () => ({ to: randomBox(), kind: 'message', body: 'x' })) }), ip).sent;
  }
  const orig = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (f, ...rest) { if (path.resolve(String(f)) === boxFile(dir, to)) reads++; return orig.call(this, f, ...rest); };
  try {
    assert.throws(() => relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to, kind: 'message', body: 'x' }] }), ip), (e) => e.status === 429);
  } finally { fs.readFileSync = orig; }
  assert.equal(reads, 0, 'נדחה לפני קריאת התיבה');
});

// ---------- f16 ----------
test('f16: מכסת הבקשות לדקה — לפי המפתח המאומת; מכשירים אחרים מאותה כתובת (NetFree) לא נחסמים', () => {
  const { relay } = relayWith();
  const busy = L.generateKeyPair();
  const ip = '203.0.113.50';
  let err = null, n = 0;
  for (let i = 0; i < R.RATE.perMinute + 5 && !err; i++) { try { relay.handle(req(busy, 'fetch', {}), ip); n++; } catch (e) { err = e; } }
  assert.equal(n, R.RATE.perMinute);
  assert.equal(err.status, 429);
  // 200 מכשירים אחרים מאותה כתובת — כל אחד מקבל תשובה
  for (let i = 0; i < 200; i++) assert.equal(relay.handle(req(L.generateKeyPair(), 'fetch', {}), ip).ok, true);
});

test('f16: בקשות לא חתומות — מכסה נמוכה לכשלי אימות, ובקשה חתומה מאותה כתובת עדיין עוברת עד המכסה הגבוהה', () => {
  const { relay } = relayWith();
  const ip = '203.0.113.60';
  let last = null;
  for (let i = 0; i < R.RATE.authFailPerIpMinute; i++) { try { relay.handle({}, ip); } catch (e) { last = e; } }
  assert.equal(last.status, 401);
  assert.throws(() => relay.handle({}, ip), (e) => e.status === 429 && /לא תקינות/.test(e.message));
  // כשלים של כתובת אחרת לא משפיעים
  assert.throws(() => relay.handle({}, '203.0.113.61'), (e) => e.status === 401);
  assert.ok(R.RATE.perIpMinute >= 1000, 'מכסה לכתובת לפני האימות — גבוהה (כתובת משותפת)');
});

// ---------- f17 ----------
function prekeyBundle(kp, createdAt = Date.now()) {
  const payload = { type: 'supersuite-prekey', owner: kp.keyId, id: 'pk1', pub: crypto.randomBytes(32).toString('base64url'), createdAt };
  return { ...payload, sig: L.signObject(payload, kp.privateJwk) };
}
test('f17: מפתח זמני שלא חודש 30 יום — לא מוגש ונמחק בסבב היומי, והמקום מתפנה', () => {
  let t = Date.now();
  const dir = tmp();
  const relay = R.createRelay({ dataDir: dir, clock: () => t });
  const kp = L.generateKeyPair();
  // createdAt של הלקוח בעתיד הרחוק — לא משנה: הזמן של השרת קובע
  relay.handle(req(kp, 'setPrekey', { bundle: prekeyBundle(kp, t + 3650 * DAY) }, t), '10.50.0.1');
  assert.ok(relay.handle(req(L.generateKeyPair(), 'getPrekey', { id: kp.keyId }, t), '10.50.0.2').bundle);
  t += 31 * DAY;
  assert.equal(relay.handle(req(L.generateKeyPair(), 'getPrekey', { id: kp.keyId }, t), '10.50.0.3').bundle, null, 'מפתח ישן לא מוגש');
  relay.expireMessages();
  assert.equal(fs.existsSync(path.join(dir, 'prekeys', kp.keyId + '.json')), false, 'הקובץ נמחק');
  // המכשיר מפרסם שוב — נחשב חדש ונספר מחדש
  relay.handle(req(kp, 'setPrekey', { bundle: prekeyBundle(kp, t) }, t), '10.50.0.1');
  assert.ok(relay.handle(req(L.generateKeyPair(), 'getPrekey', { id: kp.keyId }, t), '10.50.0.4').bundle);
});

test('f17: מכשירים חדשים — מכסה לכתובת ביום; החלפה שבועית של מפתח קיים לא נספרת', () => {
  const { relay } = relayWith();
  const ip = '203.0.113.70';
  const first = L.generateKeyPair();
  relay.handle(req(first, 'setPrekey', { bundle: prekeyBundle(first) }), ip);
  let err = null, n = 1;
  for (let i = 0; i < R.NEW_PREKEYS_PER_IP_DAY + 5 && !err; i++) {
    const k = L.generateKeyPair();
    try { relay.handle(req(k, 'setPrekey', { bundle: prekeyBundle(k) }), ip); n++; } catch (e) { err = e; }
  }
  assert.equal(n, R.NEW_PREKEYS_PER_IP_DAY);
  assert.equal(err.status, 429);
  // מפתח קיים מתחלף — לא נחסם
  assert.equal(relay.handle(req(first, 'setPrekey', { bundle: prekeyBundle(first) }), ip).ok, true);
});

// ---------- f18 ----------
test('f18: נפח שנשמר ביממה — מכסה למפתח שולח ולכתובת (גם כשכל תיבה וכל שעה בתוך המכסות)', () => {
  assert.ok(R.STORE_BYTES_PER_KEY_DAY < R.STORE_BYTES_PER_IP_DAY);
  // מכסות קטנות לבדיקה (אותו קוד); ברירת המחדל — R.STORE_BYTES_PER_KEY_DAY / R.STORE_BYTES_PER_IP_DAY
  const { relay } = relayWith({ storeBytesPerKeyDay: 1024 * 1024, storeBytesPerIpDay: 3 * 1024 * 1024 });
  const body = 'x'.repeat(200 * 1024);
  const kp = L.generateKeyPair();
  let err = null, n = 0;
  for (let i = 0; i < 20 && !err; i++) {
    try { relay.handle(req(kp, 'send', { items: [{ to: randomBox(), kind: 'message', body }] }), '10.60.' + i + '.1'); n++; } catch (e) { err = e; }
  }
  assert.equal(err && err.status, 429);
  assert.match(err.message, /נפח גדול מדי מהמכשיר הזה/);
  assert.ok(n * body.length <= 1024 * 1024 && n >= 4);
  // כתובת אחת, מפתח חדש לכל בקשה
  err = null; n = 0;
  for (let i = 0; i < 40 && !err; i++) {
    try { relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body }] }), '203.0.113.80'); n++; } catch (e) { err = e; }
  }
  assert.equal(err && err.status, 429);
  assert.match(err.message, /נפח גדול מדי מהכתובת הזו/);
  assert.ok(n * body.length <= 3 * 1024 * 1024 && n >= 14);
});

test('f18: תיבה שאיש לא משך ממנה ובלי מפתח זמני — ההודעות נמחקות אחרי 7 ימים; תיבה חיה ותיבת מנהל-העל — לא', () => {
  let t = Date.now();
  const dir = tmp();
  // שרת שכבר עוקב אחרי משיכות (תיקיית seen קיימת מגרסה זו). בשדרוג — ראו "סקירה 5.11.2026 (4א)"
  fs.mkdirSync(path.join(dir, 'seen'));
  const relay = R.createRelay({ dataDir: dir, clock: () => t, billing: { rootKeys: [rootPub], provider: null } });
  const dead = randomBox();
  const live = L.generateKeyPair();
  const withPrekey = L.generateKeyPair();
  const sender = L.generateKeyPair();
  relay.handle(req(withPrekey, 'setPrekey', { bundle: prekeyBundle(withPrekey, t) }, t), '10.70.0.9');
  relay.handle(req(sender, 'send', { items: [dead, live.keyId, withPrekey.keyId, ownerId].map(to => ({ to, kind: 'license-request', body: 'x' })) }, t), '10.70.0.1');
  relay.handle(req(live, 'fetch', {}, t), '10.70.0.8'); // התיבה נמשכה פעם — חיה
  t += R.DEAD_BOX_TTL_MS + DAY;
  relay.expireMessages();
  assert.equal(box(dir, dead).length, 0, 'תיבה מתה — נמחקה');
  assert.equal(box(dir, live.keyId).length, 1, 'תיבה שנמשכה — נשארת עד 60 יום');
  assert.equal(box(dir, withPrekey.keyId).length, 1, 'תיבה עם מפתח זמני — נשארת');
  assert.equal(box(dir, ownerId).length, 1, 'בקשת רישיון למנהל-העל — נשארת');
});

test('f18: השרת מלא בהודעות — רכישה והרשמה חינם עדיין עוברות (מקום שמור לרכישה)', async () => {
  const { relay } = relayWith({ maxStoreBytes: 64 * 1024 });
  let err = null;
  for (let i = 0; i < 200 && !err; i++) {
    try { relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body: 'x'.repeat(4000) }] }), '10.80.' + i + '.1'); } catch (e) { err = e; }
  }
  assert.equal(err && err.status, 507);
  const buyer = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: buyer.privateJwk, offerText, rootKeys: [rootPub], planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: buyer.privateJwk, signup: su, ownerPub: rootPub });
  assert.equal((await relay.handle(req(buyer, 'checkout', { public: sealed.publicText, sealed: sealed.sealed }), '198.51.100.90')).status, 'pending');
  const freeKp = L.generateKeyPair();
  const fsu = SU.createSignup({ deviceJwk: freeKp.privateJwk, offerText, rootKeys: [rootPub], planId: 'free', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const fs2 = SU.sealSignup({ deviceJwk: freeKp.privateJwk, signup: fsu, ownerPub: rootPub });
  assert.equal((await relay.handle(req(freeKp, 'checkout', { public: fs2.publicText, sealed: fs2.sealed }), '198.51.100.91')).free, true);
});

test('f18: בשרת — הסבב היומי רץ מחוץ לבקשה (בחלקים), לא בתוך הבקשה שהפעילה אותו', async () => {
  let t = Date.now();
  const dir = tmp();
  const relay = R.createRelay({ dataDir: dir, clock: () => t, background: true });
  const dead = randomBox();
  relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: dead, kind: 'message', body: 'x' }] }, t), '10.90.0.1');
  t += R.MESSAGE_TTL_MS + DAY;
  relay.handle(req(L.generateKeyPair(), 'fetch', {}, t), '10.90.0.2'); // מפעיל את הסבב
  assert.equal(box(dir, dead).length, 1, 'עוד לא נמחק — הסבב לא רץ בתוך הבקשה');
  await new Promise(r => setImmediate(() => setImmediate(r)));
  assert.equal(box(dir, dead).length, 0, 'נמחק ברקע');
});

// ---------- f19 ----------
function rawPost(port, headers, body = null) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1', headers }, (res) => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (body != null) r.end(body); else r.flushHeaders(); // בלי גוף — רק הכותרות (השרת עונה לפני הגוף)
  });
}
test('f19: בקשות במקביל מכתובת אחת — נחסמות לפני קריאת הגוף; גודל מוצהר גדול — 413 מיד; maxConnections מוגדר', async () => {
  const dir = tmp();
  const server = R.createServer({ dataDir: dir, maxConnPerIp: 2 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(server.maxConnections > 0 && server.maxConnections <= 2048);
  const hanging = [];
  try {
    // שתי בקשות שהגוף שלהן לא מסתיים
    for (let i = 0; i < 2; i++) {
      const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1', headers: { 'content-type': 'application/json', 'content-length': '100000' } });
      r.on('error', () => {});
      r.write('{"a":');
      hanging.push(r);
    }
    await new Promise(r => setTimeout(r, 100));
    const third = await rawPost(port, { 'content-type': 'application/json', 'content-length': '2' }, '{}');
    assert.equal(third.status, 429);
    assert.match(JSON.parse(third.body).error, /במקביל/);
    const big = await rawPost(port, { 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) });
    assert.equal(big.status, 413);
  } finally {
    for (const r of hanging) r.destroy();
    await new Promise(r => server.close(r));
  }
});

test('f19: Caddy — גודל בקשה מרבי עד 600KB (מעט מעל MAX_BODY)', () => {
  for (const f of ['deploy/relay/Caddyfile', 'server/deploy/Caddyfile.template']) {
    const m = /max_size\s+(\d+)(KB|MB)/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.ok(m, f);
    const kb = Number(m[1]) * (m[2] === 'MB' ? 1024 : 1);
    assert.ok(kb >= 512 && kb <= 600, f + ': ' + m[0]);
  }
});

// ---------- f89 ----------
test('f89: הרשמה בתשלום — השרת שומר ומוסר רק מעטפה מוצפנת וחלק גלוי מצומצם; מנהל-העל פותח במפתח השורש', async () => {
  const { dir, relay, provider } = relayWith();
  const kp = L.generateKeyPair();
  const customer = { ...CUSTOMER, taxId: '000000018' };
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'pro', customer, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  // החלק הגלוי: בלי איש קשר ובלי תמונת החתימה (פרטי החשבונית — רק לספק הסליקה)
  assert.ok(!sealed.publicText.includes(CUSTOMER.contact));
  assert.ok(!sealed.publicText.includes('iVBORw0KGgo'));
  assert.ok(!sealed.sealed.includes(CUSTOMER.phone) && !sealed.sealed.includes('iVBORw0KGgo'));
  const co = await relay.handle(req(kp, 'checkout', { public: sealed.publicText, sealed: sealed.sealed }), '198.51.100.100');
  assert.equal(co.status, 'pending');
  assert.equal(provider.calls[0].customer.taxId, '000000018', 'פרטי החשבונית מגיעים לספק');
  assert.equal(provider.calls[0].amountAgorot, 49900);
  let disk = allText(dir);
  assert.ok(!disk.includes(CUSTOMER.contact) && !disk.includes('iVBORw0KGgo'), 'בשרת אין איש קשר ותמונת חתימה');
  const checkoutId = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].checkoutId;
  relay.webhook({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'r' }), headers: {} });
  disk = allText(dir);
  assert.ok(!disk.includes(CUSTOMER.contact) && !disk.includes('iVBORw0KGgo'), 'גם אחרי המסירה');
  const [m] = box(dir, ownerId).filter(x => x.kind === 'signup');
  assert.equal(JSON.parse(m.body).signup, undefined);
  // מנהל-העל קולט — כמו בסנכרון (sync.js ← owner.addSignup)
  const r = owner.addSignup(m.body, { at: m.at });
  assert.equal(r.added, true);
  const x = owner.signups().find(y => y.id === r.id);
  assert.equal(x.customer.contact, CUSTOMER.contact);
  assert.equal(x.payment.amountAgorot, 49900);
  assert.match(owner.signedDocument(x.id).html, /משה כהן/);
});

test('f89: החלק הגלוי שונה, מעטפה של מכשיר אחר, או מעטפה שהוחלפה — נדחים', async () => {
  const { relay } = relayWith();
  const kp = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  // מחיר שונה בחלק הגלוי — החתימה לא תואמת
  const p = JSON.parse(sealed.publicText); p.body.priceAgorot = 100;
  await assert.rejects(async () => relay.handle(req(kp, 'checkout', { public: JSON.stringify(p), sealed: sealed.sealed }), '10.1.0.1'), (e) => e.status === 400);
  // מעטפה אחרת — התמצית לא תואמת
  const other = M.sealData(kp.privateJwk, rootPub, su.text, SU.SEALED_PURPOSE);
  await assert.rejects(async () => relay.handle(req(kp, 'checkout', { public: sealed.publicText, sealed: other }), '10.1.0.2'), (e) => e.status === 400 && /שונתה/.test(e.message));
  // מכשיר אחר שולח את ההרשמה — נדחה
  await assert.rejects(async () => relay.handle(req(L.generateKeyPair(), 'checkout', { public: sealed.publicText, sealed: sealed.sealed }), '10.1.0.3'), (e) => e.status === 403);
  // אצל מנהל-העל: חלק גלוי של הרשמה אחרת עם המעטפה — לא נפתח
  const su2 = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'free', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at: Date.now() + 1 });
  const s2 = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su2, ownerPub: rootPub });
  assert.throws(() => owner.addSignup(JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: sealed.sealed, public: s2.publicText, payment: null })),
    (e) => e.code === 'signup-invalid');
});

test('f89: התיעוד לא טוען שאין בשרת נתוני לקוחות בלי הסבר', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/RELAY-DEPLOY.md'), 'utf8');
  assert.match(doc, /מוצפנת\s+למנהל-העל/);
  assert.ok(!/אין: תוכן הודעות, סיסמאות, מפתחות פרטיים, נתוני לקוחות\./.test(doc));
});

// ---------- תנאי ההפעלה: 'offline' ----------
test('החלטת הבעלים: offline (30–60 יום בלי חיבור) — צפייה בלבד בשער, במעטפת ובאנדרואיד; locked — חסום', () => {
  const offline = { mode: 'licensed', status: 'offline', features: ['econ', 'shamai'], reasons: [{ kind: 'offline', reason: 'לא היה חיבור לשרת ב-30 הימים האחרונים' }] };
  assert.ok(LG.READ_ONLY_STATUS.has('offline'));
  assert.equal(LG.checkChannel(offline, 'tasks:get', 'data.view'), null, 'קריאה פתוחה');
  assert.equal(LG.checkChannel(offline, 'tasks:backup', 'data.backup'), null, 'גיבוי פתוח');
  assert.match(LG.checkChannel(offline, 'tasks:create', 'data.edit'), /אין חיבור לשרת הרישוי/);
  assert.equal(LG.shellState(offline).level, 'limited');
  assert.equal(LG.moduleAllowed(offline, 'shamai'), true, 'המודול נפתח לצפייה');
  const AND = require('../android/web/main-android');
  assert.match(AND.licenseWriteBlock(offline, 'shamai'), /אין חיבור לשרת הרישוי/, 'אנדרואיד: כתיבה במודול חסומה');
  const locked = { ...offline, status: 'locked' };
  assert.equal(LG.shellState(locked).level, 'blocked');
  assert.equal(LG.moduleAllowed(locked, 'shamai'), false);
});

// ---------- f67 ----------
test('f67: המדריך והמסך הראשי — מערכת ברישיון צריכה חיבור לשרת הרישוי פעם בחודש; בניסיון — לא', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'shell/guide/index.html'), 'utf8');
  assert.ok(!/הכול עובד במחשב, גם בלי חיבור\.<\/dd>/.test(guide), 'אין עוד "לא צריך אינטרנט" גורף');
  assert.match(guide, /פעם בחודש/);
  assert.match(guide, /צפייה בלבד/);
  assert.match(guide, /ספק הסינון/);
  assert.match(guide, /תקופת הניסיון[^<]*אין צורך בחיבור|בתקופת הניסיון[^<]*לא צריך/);
  const shell = fs.readFileSync(path.join(ROOT, 'shell/shell.html'), 'utf8');
  assert.ok(!/אין צורך בחיבור לרשת/.test(shell));
});

// ---------- סקירה 5.11.2026: תיקונים לנושא 3 (אחרי אימות) ----------
// 1  f16: כל 401 מכתובת נספר, והמכסה נבדקה לפני האימות — 120 בקשות זבל חסמו את כל המכשירים החתומים מאותה כתובת
//    (NetFree). כך גם המכסה לפני קריאת הגוף. עכשיו: המכסה חלה רק על בקשות שנכשלו; מעל perIpMinute — מכשירים מוכרים עוברים
// 2  שרת חדש + מנהל-על ישן: המסירה המוצפנת (v2) לא נפתחה, נדחתה כ"פגומה", אושרה — והשרת מחק הרשמה ששולמה
// 3  f18: מי שמשך פעם את התיבה של עצמו קיבל 60 יום — 200MB ליום מכתובת מילאו את השרת. עכשיו: נפח שממתין לפי מקור
// 4  (א) שדרוג בלי seen — מערכת שלא התחברה 30–60 יום איבדה הודעות; (ב) תקרות seen / מפתחות זמניים הפכו מכשיר חדש ל"מת";
//    (ג) מערכת בצפייה בלבד או נעולה עדיין הנפיקה מערכות בת
// 5  המדריך: מערכת שקיבלה רישיון צריכה להתחבר לשרת פעם אחת לפני השימוש
const LS = require('../shell/licensing/store');
const CK = require('../shell/licensing/checkin');
const { createRemote, mailboxOf } = require('../shell/licensing/remote');
const { createLicenseSync } = require('../shell/licensing/sync');
const { markSynced } = require('./helpers/activation');
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; }; // אחסון של ערך אחד (מחסן הרישוי)

test('5.11 (1): בקשות זבל מאותה כתובת — לא חוסמות מכשיר שחותם כראוי; הזבל עצמו מקבל 429 מעל המכסה', () => {
  const { relay } = relayWith();
  const ip = '203.0.113.200';
  const kp = L.generateKeyPair();
  for (let i = 0; i < R.RATE.authFailPerIpMinute * 2; i++) { try { relay.handle({}, ip); } catch { /* זבל */ } }
  // חתימה פגומה ושידור חוזר — גם נספרים, ועדיין לא חוסמים
  const bad = req(kp, 'fetch', {}); bad.sig = req(L.generateKeyPair(), 'fetch', {}).sig;
  assert.throws(() => relay.handle(bad, ip), (e) => e.status === 429);
  assert.equal(relay.handle(req(kp, 'fetch', {}), ip).ok, true, 'מכשיר חתום מאותה כתובת — עובר');
  const once = req(kp, 'fetch', {});
  relay.handle(once, ip);
  assert.throws(() => relay.handle(once, ip), (e) => e.status === 429, 'שידור חוזר — נכשל (ונספר)');
  assert.equal(relay.handle(req(L.generateKeyPair(), 'fetch', {}), ip).ok, true, 'גם מכשיר אחר');
});

test('5.11 (1): כתובת עמוסה (מעל perIpMinute) — מכשיר מוכר (מפתח זמני בשרת) עובר, מפתח חדש נדחה; מעל התקרה הקשיחה — הכול', () => {
  const { relay } = relayWith();
  const ip = '203.0.113.201';
  const known = L.generateKeyPair();
  relay.handle(req(known, 'setPrekey', { bundle: prekeyBundle(known) }), ip);
  for (let i = 0; i < R.RATE.perIpMinute + 50; i++) { try { relay.handle({}, ip); } catch { /* זבל מאותה כתובת */ } }
  assert.equal(relay.handle(req(known, 'fetch', {}), ip).ok, true, 'מכשיר מוכר — עובר למרות העומס');
  assert.throws(() => relay.handle(req(L.generateKeyPair(), 'fetch', {}), ip), (e) => e.status === 429 && /מהכתובת הזו/.test(e.message));
  // לפני קריאת הגוף (createServer): rateLimit מחזיר "עמוסה", ונזרק רק מעל התקרה הקשיחה
  assert.ok(R.RATE.perIpHardMinute >= 10 * R.RATE.perIpMinute);
  assert.equal(relay.rateLimit('203.0.113.202'), false);
  assert.equal(relay.rateLimit(ip), true);
});

const SEALED_PREFIX = '{"type":"supersuite-signup-delivery","v":2,';
test('5.11 (2): מנהל-על בגרסה קודמת (בלי caps) לא מקבל מסירה מוצפנת — היא ממתינה בשרת ולא נמחקת; מנהל-על מעודכן מקבל וקולט', async () => {
  const { dir, relay } = relayWith();
  const kp = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const sealed = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  await relay.handle(req(kp, 'checkout', { public: sealed.publicText, sealed: sealed.sealed }), '198.51.100.120');
  const checkoutId = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].checkoutId;
  relay.webhook({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'r' }), headers: {} });
  const ownerKp = { publicJwk: rootPub, privateJwk: owner.rootSigner() };
  // מנהל-העל הישן: משיכה בלי caps ← אין הרשמה; ack על כל מה שקיבל ← ההרשמה עדיין בשרת
  const old = relay.handle(req(ownerKp, 'fetch', {}), '198.51.100.121');
  assert.equal(old.messages.filter(m => m.kind === 'signup').length, 0);
  relay.handle(req(ownerKp, 'ack', { ids: old.messages.map(m => m.id) }), '198.51.100.121');
  const [held] = box(dir, ownerId).filter(m => m.kind === 'signup');
  assert.ok(held && held.body.startsWith(SEALED_PREFIX), 'ממתינה בשרת');
  // מעודכן: מודיע signup-v2 ← מקבל וקולט
  const now = relay.handle(req(ownerKp, 'fetch', { caps: [R.CAP_SIGNUP_V2] }), '198.51.100.121');
  const [m] = now.messages.filter(x => x.kind === 'signup');
  assert.equal(m.id, held.id);
  assert.equal(owner.addSignup(m.body, { at: m.at }).added, true);
});

test('5.11 (2): הלקוח מודיע signup-v2 בכל משיכה, ומנהל-העל לא מאשר לשרת הרשמה שלא קלט בגלל תקלה אצלו (נעול / פורמט חדש)', async () => {
  const payloads = [];
  const kp = L.generateKeyPair();
  const msg = { id: 'sig-x', from: 'relay', kind: 'signup', body: SEALED_PREFIX + '"sealed":"zz"}', at: Date.now() };
  const acks = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.op === 'fetch') payloads.push(b.payload);
    if (b.op === 'ack') acks.push(b.payload);
    const r = b.op === 'fetch' ? { ok: true, messages: [msg], more: false } : { ok: true };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  };
  await createRemote({ url: 'https://relay.test', fetchImpl }).fetch(kp.privateJwk);
  assert.ok(payloads[0].caps.includes(R.CAP_SIGNUP_V2));
  const store = LS.createLicenseStore({ storage: one(), secret: one(), rootKeys: [rootPub] });
  store.setRemoteSettings({ url: 'https://relay.test' });
  const fakeOwner = { rootSigner: () => kp.privateJwk, inbox: () => [], contacts: () => [],
    addSignup: () => { throw Object.assign(new Error('פורמט לא מוכר'), { code: 'signup-unknown-format' }); },
    quarantineSignup: () => { throw new Error('לא אמור להיקרא'); } };
  const r = await createLicenseSync({ store, owner: fakeOwner, rootKeys: [rootPub], fetchImpl }).ownerReceive();
  assert.equal(r.signupsHeld, 1);
  assert.equal(acks.length, 0, 'לא אושר — ההרשמה נשארת בשרת לסבב הבא');
});

test('5.11 (3): נפח שממתין לפי כתובת — לאורך כל תקופת השמירה; משיכה שמחזיקה את התיבות "חיות" לא עוזרת, וקריאה ומחיקה מפנות', () => {
  let t = Date.now();
  const dir = tmp();
  const relay = R.createRelay({ dataDir: dir, clock: () => t, storedBytesPerIp: 1024 * 1024 });
  const ip = '203.0.113.210';
  const body = 'x'.repeat(200 * 1024);
  const boxes = [];
  let err = null;
  for (let i = 0; i < 20 && !err; i++) {
    const to = L.generateKeyPair();
    try { relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: to.keyId, kind: 'message', body }] }, t), ip); boxes.push(to); } catch (e) { err = e; }
  }
  assert.equal(err && err.status, 429);
  assert.match(err.message, /שטרם נקראו/);
  assert.ok(boxes.length >= 4 && boxes.length * body.length <= 1024 * 1024);
  // התוקף "מושך" את התיבות כדי שלא יפוגו — ועדיין חסום, גם אחרי יום (לא חלון של 24 שעות)
  for (const b of boxes) {
    const got = relay.handle(req(b, 'fetch', {}, t), '198.51.100.1');
    assert.equal(got.messages[0].s, undefined, 'תג המקור לא יוצא ללקוח');
  }
  t += 2 * DAY;
  assert.throws(() => relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body }] }, t), ip), (e) => e.status === 429);
  // אחרי הפעלה מחדש — הספירה נבנית מהתיבות
  const again = R.createRelay({ dataDir: dir, clock: () => t, storedBytesPerIp: 1024 * 1024 });
  assert.throws(() => again.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body }] }, t), ip), (e) => e.status === 429);
  // נמען אחד קרא ומחק — המקום מתפנה
  const got = again.handle(req(boxes[0], 'fetch', {}, t), '198.51.100.1');
  again.handle(req(boxes[0], 'ack', { items: got.messages.map(m => [m.id, CK.messageDigest(m)]) }, t), '198.51.100.1');
  assert.equal(again.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body }] }, t), ip).ok, true);
  // כתובת אחרת — לא מושפעת
  assert.equal(again.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body }] }, t), '203.0.113.211').ok, true);
  assert.ok(R.STORED_BYTES_PER_IP * 4 <= 2 * 1024 ** 3, 'כתובת אחת לא ממלאת את השרת');
});

test('5.11 (3): נפח שממתין לפי מפתח שולח — גם מכתובות שונות', () => {
  const { relay } = relayWith({ storedBytesPerKey: 600 * 1024 });
  const kp = L.generateKeyPair();
  const body = 'x'.repeat(200 * 1024);
  let err = null, n = 0;
  for (let i = 0; i < 10 && !err; i++) {
    try { relay.handle(req(kp, 'send', { items: [{ to: randomBox(), kind: 'message', body }] }), '10.120.' + i + '.1'); n++; } catch (e) { err = e; }
  }
  assert.equal(n, 2);
  assert.match(err.message, /מהמכשיר הזה שטרם נקראו/);
});

test('5.11 (4א): שדרוג משרת בלי seen — תיבה של מערכת שלא התחברה 30–60 יום לא נחשבת "מתה", וההודעות שלה נשארות', () => {
  let t = Date.now();
  const dir = tmp();
  const offline = L.generateKeyPair().keyId;
  const sender = L.generateKeyPair().keyId;
  // נתונים מהגרסה הקודמת: הודעה מלפני 10 ימים, בלי seen ובלי מפתח זמני
  fs.writeFileSync(boxFile(dir, offline), JSON.stringify([{ id: 'old-1', from: sender, kind: 'license', body: 'x', at: t - 10 * DAY }]));
  const relay = R.createRelay({ dataDir: dir, clock: () => t });
  relay.expireMessages();
  t += 15 * DAY;
  relay.expireMessages();
  assert.equal(box(dir, offline).length, 1, 'לא נמחקה אחרי 25 יום');
  assert.ok(fs.existsSync(path.join(dir, 'seen-since')));
  // התקופה של "לא ידוע" נגמרת — ועדיין רק לפי 60 יום להודעה עצמה
  t += 40 * DAY;
  relay.expireMessages();
  assert.equal(box(dir, offline).length, 0, 'אחרי 65 יום — פגה כמו כל הודעה');
});

test('5.11 (4ב): תקרת seen מלאה — מכשיר חדש עדיין "חי"; מפתח חדש שמושך תיבה ריקה לא תופס סימון', () => {
  let t = Date.now();
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'seen'));
  const relay = R.createRelay({ dataDir: dir, clock: () => t, maxSeen: 3 });
  for (let i = 0; i < 5; i++) relay.handle(req(L.generateKeyPair(), 'fetch', {}, t), '10.130.0.1');
  assert.equal(fs.readdirSync(path.join(dir, 'seen')).length, 0, 'תיבות ריקות — בלי סימון בדיסק');
  // הצפה: תיבות עם הודעות ממלאות את התקרה
  const spam = L.generateKeyPair();
  for (let i = 0; i < 4; i++) {
    const b = L.generateKeyPair();
    relay.handle(req(spam, 'send', { items: [{ to: b.keyId, kind: 'message', body: 'x' }] }, t), '10.130.0.2');
    relay.handle(req(b, 'fetch', {}, t), '10.130.0.2');
  }
  assert.equal(fs.readdirSync(path.join(dir, 'seen')).length, 3);
  // מכשיר חדש (בלי מפתח זמני — מכסת המכשירים החדשים נגמרה) מקבל רישיון ומושך — לא נמחק אחרי 7 ימים
  const fresh = L.generateKeyPair();
  relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: fresh.keyId, kind: 'license', body: 'x' }] }, t), '10.130.0.3');
  relay.handle(req(fresh, 'fetch', {}, t), '10.130.0.4');
  t += R.DEAD_BOX_TTL_MS + DAY;
  relay.expireMessages();
  assert.equal(box(dir, fresh.keyId).length, 1);
  // הודעה ממי שבעל התיבה כתב לו (קשר קיים) — לא פגה אחרי 7 ימים גם בתיבה שלא נמשכה
  const parent = L.generateKeyPair();
  const child = L.generateKeyPair();
  relay.handle(req(child, 'send', { items: [{ to: parent.keyId, kind: 'license-request', body: 'x' }] }, t), '10.130.0.5');
  relay.handle(req(parent, 'send', { items: [{ to: child.keyId, kind: 'license', body: 'x' }] }, t), '10.130.0.6');
  t += R.DEAD_BOX_TTL_MS + DAY;
  relay.expireMessages();
  assert.equal(box(dir, child.keyId).length, 1);
  assert.ok(R.NEW_PREKEYS_PER_DAY >= 20000);
});

// מערכת ברישיון שנתי מהשורש: מצב החיבור לפי הזמן ב-clock (השומר מגרסה קודמת נספר עד LEGACY_SYNC_CUTOFF)
function licensedStore(clockRef) {
  const root = L.generateKeyPair();
  const node = L.generateKeyPair();
  const at = LS.LEGACY_SYNC_CUTOFF - 5 * DAY;
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, { name: 'קהילת אור', publicKey: node.publicJwk, slot: 1, features: ['econ'],
    limits: { maxChildren: 3, maxUsers: 5, maxStorageMb: 100, maxDepth: 2 }, issuedAt: at, expiresAt: at + 365 * DAY, graceDays: 7 });
  const storage = one(), secret = one();
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  storage.write(JSON.stringify({ chain: [lic], notices: [], children: [] }));
  const store = LS.createLicenseStore({ storage, secret, rootKeys: [root.publicJwk], clock: () => clockRef.t });
  markSynced(secret, LS.LEGACY_SYNC_CUTOFF);
  return { store, rootKeys: [root.publicJwk] };
}

test('5.11 (4ג): מערכת בצפייה בלבד (30–60 יום בלי חיבור) או נעולה — לא מנפיקה מערכות בת, גם לא בסנכרון; האישור נשאר בשרת', async () => {
  const clk = { t: LS.LEGACY_SYNC_CUTOFF + 5 * DAY };
  const { store, rootKeys } = licensedStore(clk);
  assert.doesNotThrow(() => store.assertCanIssue(), 'מחוברת — מותר');
  clk.t = LS.LEGACY_SYNC_CUTOFF + 40 * DAY;
  store.invalidate();
  assert.equal(store.current().status, 'active', 'הסטטוס הגולמי עדיין פעיל — הבדיקה הייתה רק עליו');
  assert.throws(() => store.assertCanIssue(), (e) => e.code === LS.ACTIVATION_REQUIRED && /צפייה בלבד/.test(e.message));
  clk.t = LS.LEGACY_SYNC_CUTOFF + 70 * DAY;
  store.invalidate();
  assert.throws(() => store.assertCanIssue(), (e) => e.code === LS.ACTIVATION_REQUIRED);
  // סנכרון: אישור ממנהל-העל לא מונפק ולא מאושר לשרת (שרת בלי בדיקה חתומה — החיבור לא מתחדש)
  store.setRemoteSettings({ url: 'https://relay.test' });
  // מתיבת מנהל-העל — אישור משולח אחר נמחק עוד לפני בדיקת תנאי ההפעלה (f12)
  const boxMsgs = [{ id: 'ap-1', from: mailboxOf(rootKeys[0]), kind: 'approval', body: '{}', at: clk.t }];
  const acks = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.op === 'ack') acks.push(...b.payload.ids);
    const r = b.op === 'fetch' ? { ok: true, messages: b.payload.after ? [] : boxMsgs, more: false } : { ok: true };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  };
  const r = await createLicenseSync({ store, rootKeys, fetchImpl, clock: () => clk.t }).receive();
  assert.ok(r.errors.some(e => /לא ניתן להנפיק מערכות בת/.test(e)));
  assert.ok(!acks.includes('ap-1'), 'האישור נשאר בשרת');
  assert.equal(store.listChildren().length, 0);
  // ערוצי ה-IPC — אותה בדיקה לפני ההנפקה ולפני בקשת האישור
  const ipc = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  for (const ch of ['license:issueChild', 'license:requestChildApproval']) {
    const at = ipc.indexOf("'" + ch + "'");
    assert.ok(at > 0 && /licenseStore\.assertCanIssue\(\)/.test(ipc.slice(at, at + 400)), ch);
  }
});

test('5.11 (5): המדריך — מערכת שקיבלה רישיון צריכה להתחבר לשרת הרישוי פעם אחת לפני שאפשר לעבוד בה', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'shell/guide/index.html'), 'utf8');
  assert.match(guide, /רישיון חדש[^<]*להתחבר לשרת הרישוי פעם אחת/);
});

test('5.11: התיעוד — סדר הפריסה (שרת לפני גרסה, מנהל-על ישן), והמחיר של הגבלת הקצב לכתובת משותפת', () => {
  const deploy = fs.readFileSync(path.join(ROOT, 'docs/RELAY-DEPLOY.md'), 'utf8');
  const act = fs.readFileSync(path.join(ROOT, 'docs/LICENSING-ACTIVATION.md'), 'utf8');
  assert.match(deploy, /signup-v2/);
  assert.match(deploy, /perIpHardMinute/);
  assert.match(deploy, /STORED_BYTES_PER_IP/);
  assert.match(act, /signup-v2/);
});

// ---------- אימות נושא 3 (סקירה 5.11.2026, סבב שני) ----------
// (1) הרשמת זבל: חלק גלוי תקין ומעטפה עם תוכן זבל — נשמרה בשרת לתמיד (מנהל-העל לא אישר שום כישלון), ומילאה את
//     MAX_FREE_IN_BOX: הרשמות חינם אמיתיות קיבלו 507
// (2) מכשיר שחזר אחרי יותר מ-30 יום בלי חיבור — המפתח הזמני נמחק, ובכתובת עמוסה נדחה כמו מפתח חדש
// (3) takeBytes נספר לפני התקרות של התיבה — ניסיונות חוזרים לתיבה מלאה שרפו את מכסת הנפח של הכתובת המשותפת
// (4) פרטי החשבונית בחלק הגלוי — השרת צריך אותם (Cardcom); התיעוד אומר שהם שמורים בדיסק בגלוי
const relayFetch = (relay, ip) => async (url, init) => {
  const b = JSON.parse(init.body);
  let r, status = 200;
  try { r = await relay.handle(b, ip); } catch (e) { status = e.status || 500; r = { ok: false, error: e.message }; }
  return { ok: status === 200, status, headers: { get: () => null }, json: async () => r };
};
function junkSignup(relay, i, { purpose = SU.SEALED_PURPOSE, anonymous = false } = {}) {
  const kp = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'free', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const s = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  // מעטפה תקינה במבנה, עם תוכן זבל, והחלק הגלוי חתום על התמצית שלה
  const sealed = M.sealData(anonymous ? null : kp.privateJwk, rootPub, 'זבל', purpose);
  const pub = JSON.parse(s.publicText);
  pub.body.sealedSha256 = L.sha256Hex(sealed);
  pub.sig = L.signObject(pub.body, kp.privateJwk);
  return relay.handle(req(kp, 'checkout', { public: JSON.stringify(pub), sealed }), '10.77.' + (i >> 6) + '.' + (i & 63));
}
function freeSignup(relay, ip) {
  const kp = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'free', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true });
  const s = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  return relay.handle(req(kp, 'checkout', { public: s.publicText, sealed: s.sealed }), ip);
}
const ownerStore = () => {
  const store = LS.createLicenseStore({ storage: one(), secret: one(), rootKeys: [rootPub] });
  store.setRemoteSettings({ url: 'https://relay.test' });
  return store;
};

test('5.11-v (1): הרשמת זבל (חלק גלוי תקין, מעטפה עם תוכן זבל) — מנהל-העל שומר בהסגר המוצפן, מאשר לשרת, והיא נמחקת שם', async () => {
  const { dir, relay } = relayWith();
  for (let i = 0; i < 3; i++) assert.equal((await junkSignup(relay, i)).free, true, 'השרת לא יכול לפתוח את המעטפה — מקבל');
  assert.equal((await freeSignup(relay, '198.51.100.140')).free, true);
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 4);
  const before = owner.rejectedSignups().length;
  const r = await createLicenseSync({ store: ownerStore(), owner, rootKeys: [rootPub], fetchImpl: relayFetch(relay, '198.51.100.141') }).ownerReceive();
  assert.equal(r.signups, 1, 'ההרשמה האמיתית נקלטה');
  assert.equal(r.signupsRejected, 3);
  assert.equal(r.signupsHeld, undefined);
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 0, 'הזבל נמחק מהשרת — לא תופס את MAX_FREE_IN_BOX');
  const rejected = owner.rejectedSignups().slice(before);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every(x => !x.paid && x.delivery === undefined && typeof x.error === 'string'), 'חינם — פרטים בלבד, לא המסירה כולה');
});

test('5.11-v (1): הסיווג אצל מנהל-העל — זבל ← signup-invalid; פורמט חדש ← signup-unknown-format; נעול ← שגיאה רגילה (נשאר בשרת)', () => {
  const o = createOwnerCore({ storage: mem() });
  const pub = o.init('menahel-al-classify-2026').publicKey;
  const garbage = JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: M.sealData(null, pub, 'זבל', SU.SEALED_PURPOSE), payment: null });
  assert.throws(() => o.addSignup(garbage), (e) => e.code === 'signup-invalid');
  assert.throws(() => o.addSignup('{"type":"supersuite-signup-delivery","v":3,"x":1}'), (e) => e.code === 'signup-unknown-format');
  const futureEnv = JSON.stringify({ ...JSON.parse(M.sealData(null, pub, 'x', SU.SEALED_PURPOSE)), v: 2 });
  assert.throws(() => o.addSignup(JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: futureEnv, payment: null })), (e) => e.code === 'signup-unknown-format');
  // בתשלום — המסירה כולה נשמרת בהסגר (מוצפן במפתח השורש), לבדיקה ידנית
  const paid = JSON.stringify({ type: 'supersuite-signup-delivery', v: 2, sealed: M.sealData(null, pub, 'זבל', SU.SEALED_PURPOSE), payment: { id: 'p1', amountAgorot: 100 } });
  assert.throws(() => o.addSignup(paid), (e) => e.code === 'signup-invalid');
  assert.equal(o.quarantineSignup(paid, { at: 5, error: 'x' }), true);
  const [q] = o.rejectedSignups();
  assert.equal(q.paid, true);
  assert.equal(q.delivery, paid);
  o.lock();
  assert.throws(() => o.addSignup(garbage), (e) => e.code !== 'signup-invalid' && e.code !== 'signup-unknown-format');
  assert.throws(() => o.quarantineSignup(garbage), /לפתוח את מצב מנהל-העל/);
});

test('5.11-v (1): השרת בודק את מבנה המעטפה — מטרה אחרת או מעטפה אנונימית מהלקוח נדחות (לא מגיעות למנהל-העל)', async () => {
  const { dir, relay } = relayWith();
  await assert.rejects(async () => junkSignup(relay, 1, { purpose: 'message' }), (e) => e.status === 400);
  await assert.rejects(async () => junkSignup(relay, 2, { anonymous: true }), (e) => e.status === 400);
  assert.equal(box(dir, ownerId).length, 0);
});

test('5.11-v (1): הרשמה חינם "תקועה" 60 יום — נמחקת רק אחרי שמנהל-על מעודכן משך את התיבה; אצל מנהל-על ישן ובתשלום — לא', async () => {
  let t = Date.now();
  const { dir, relay } = relayWith({ clock: () => t });
  const ownerKp = { publicJwk: rootPub, privateJwk: owner.rootSigner() };
  await freeSignup(relay, '198.51.100.150');
  const kp = L.generateKeyPair();
  const su = SU.createSignup({ deviceJwk: kp.privateJwk, offerText, rootKeys: [rootPub], planId: 'pro', customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true, at: t });
  const sealed = SU.sealSignup({ deviceJwk: kp.privateJwk, signup: su, ownerPub: rootPub });
  await relay.handle(req(kp, 'checkout', { public: sealed.publicText, sealed: sealed.sealed }, t), '198.51.100.151');
  const checkoutId = JSON.parse(fs.readFileSync(path.join(dir, 'payments.json'), 'utf8'))[0].checkoutId;
  relay.webhook({ rawBody: JSON.stringify({ checkoutId, status: 'paid', amountAgorot: 49900, providerRef: 'r' }), headers: {} });
  // מנהל-על ישן (בלי caps) — 61 יום: לא נמחק דבר
  t += 1000;
  relay.handle(req(ownerKp, 'fetch', {}, t), '198.51.100.152');
  t += 61 * DAY;
  relay.expireMessages();
  assert.equal(box(dir, ownerId).filter(m => m.kind === 'signup').length, 2, 'מנהל-על ישן — שתיהן ממתינות');
  // מנהל-על מעודכן משך ולא קלט — ההרשמה חינם תקועה ונמחקת; ששולמה — נשארת
  relay.handle(req(ownerKp, 'fetch', { caps: [R.CAP_SIGNUP_V2] }, t), '198.51.100.152');
  t += DAY;
  relay.expireMessages();
  const left = box(dir, ownerId).filter(m => m.kind === 'signup');
  assert.equal(left.length, 1);
  assert.equal(left[0].free, undefined, 'ההרשמה ששולמה לא פגה');
});

test('5.11-v (2): מכשיר שחזר אחרי 40 יום בלי חיבור — עדיין מוכר: עובר בכתובת עמוסה, והמפתח הזמני שלו לא נספר כמכשיר חדש', () => {
  let t = Date.now();
  const dir = tmp();
  const relay = R.createRelay({ dataDir: dir, clock: () => t });
  const dev = L.generateKeyPair();
  relay.handle(req(dev, 'setPrekey', { bundle: prekeyBundle(dev, t) }, t), '198.51.100.160');
  t += 40 * DAY;
  relay.expireMessages();
  assert.equal(fs.existsSync(path.join(dir, 'prekeys', dev.keyId + '.json')), false, 'המפתח הזמני נמחק (30 יום)');
  const ip = '198.51.100.161';
  for (let i = 0; i < R.RATE.perIpMinute + 10; i++) relay.rateLimit(ip);
  assert.equal(relay.handle(req(dev, 'fetch', {}, t), ip, { preCounted: true, overloaded: true }).ok, true, 'מוכר — עובר בכתובת עמוסה');
  assert.throws(() => relay.handle(req(L.generateKeyPair(), 'fetch', {}, t), ip, { preCounted: true, overloaded: true }), (e) => e.status === 429);
  // מכסת המכשירים החדשים של הכתובת מלאה — המכשיר שחזר עדיין מפרסם מפתח זמני
  const ip2 = '198.51.100.162';
  for (let i = 0; i < R.NEW_PREKEYS_PER_IP_DAY; i++) { const k = L.generateKeyPair(); relay.handle(req(k, 'setPrekey', { bundle: prekeyBundle(k, t) }, t), ip2); }
  const k = L.generateKeyPair();
  assert.throws(() => relay.handle(req(k, 'setPrekey', { bundle: prekeyBundle(k, t) }, t), ip2), (e) => e.status === 429);
  assert.equal(relay.handle(req(dev, 'setPrekey', { bundle: prekeyBundle(dev, t) }, t), ip2).ok, true);
  // אחרי KNOWN_KEEP_MS בלי חידוש — הסימון נמחק (תקרת זיכרון/דיסק)
  assert.ok(R.KNOWN_KEEP_MS > 60 * DAY);
  const gone = L.generateKeyPair();
  relay.handle(req(gone, 'setPrekey', { bundle: prekeyBundle(gone, t) }, t), '198.51.100.163');
  t += 31 * DAY; relay.expireMessages();
  assert.ok(fs.existsSync(path.join(dir, 'known', gone.keyId)));
  t += R.KNOWN_KEEP_MS; relay.expireMessages();
  assert.equal(fs.existsSync(path.join(dir, 'known', gone.keyId)), false);
});

test('5.11-v (3): ניסיונות חוזרים לתיבה מלאה (507) — לא שורפים את מכסת הנפח היומית של הכתובת', () => {
  let t = Date.now();
  const dir = tmp();
  const full = randomBox();
  fs.writeFileSync(boxFile(dir, full), JSON.stringify(Array.from({ length: R.MAX_MAILBOX }, (_, i) => ({ id: 'm' + i, from: 's' + i, kind: 'message', body: 'y', at: t }))));
  const relay = R.createRelay({ dataDir: dir, storeBytesPerIpDay: 400 * 1024, clock: () => t });
  const ip = '203.0.113.230';
  const body = 'x'.repeat(8000);
  let full507 = 0;
  for (let i = 0; i < 55; i++) {
    t += 1500;
    try { relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: full, kind: 'message', body }] }, t), ip); } catch (e) { if (e.status === 507) full507++; else throw e; }
  }
  assert.equal(full507, 55, 'כולם נדחו כי התיבה מלאה — לא בגלל מכסת הנפח');
  assert.equal(relay.handle(req(L.generateKeyPair(), 'send', { items: [{ to: randomBox(), kind: 'message', body: 'שלום' }] }, t), ip).ok, true);
});

test('5.11-v (4): פרטי החשבונית בחלק הגלוי — השרת צריך אותם לספק הסליקה; התיעוד אומר שהם שמורים בשרת בגלוי', () => {
  const deploy = fs.readFileSync(path.join(ROOT, 'docs/RELAY-DEPLOY.md'), 'utf8');
  const signup = fs.readFileSync(path.join(ROOT, 'shell/licensing/signup.js'), 'utf8');
  const cardcom = fs.readFileSync(path.join(ROOT, 'server/payments/cardcom-provider.js'), 'utf8');
  assert.match(cardcom, /TaxId:[^\n]*customer\.taxId/);
  assert.match(cardcom, /Mobile: customer\.phone/);
  assert.match(deploy, /`TaxId`[\s\S]{0,200}בגלוי/);
  assert.match(signup, /cardcom-provider\.js[\s\S]{0,200}בגלוי/);
});
