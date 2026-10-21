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
  // מכתובות שונות — מכתובת אחת לתיבה אחת יש מכסה נמוכה יותר (relay-owner-box.test.js)
  for (let i = 0; i < 5; i++) relay.handle(signed(eve, 'send', { items: items(b.keyId, 20) }), '10.0.0.' + i);
  // מכסת שולח בתיבה מלאה — וגם ההודעה ל-c באותה בקשה לא נשלחה
  assert.throws(() => relay.handle(signed(eve, 'send', { items: [{ to: c.keyId, kind: 'message', body: 'x' }, ...items(b.keyId, 1)] }), '10.0.0.9'), /שטרם נקראו/);
  assert.equal(relay.handle(signed(c, 'fetch', {})).messages.length, 0, 'אין כתיבה חלקית');
  // שולח אחר עדיין מגיע לנמען
  assert.equal(relay.handle(signed(a, 'send', { items: items(b.keyId, 1) })).sent, 1);
  // אחרי שהנמען קרא ומחק — אפשר שוב
  const got = relay.handle(signed(b, 'fetch', {})).messages;
  relay.handle(signed(b, 'ack', { ids: got.map(m => m.id) }));
  assert.equal(relay.handle(signed(eve, 'send', { items: items(b.keyId, 1) }), '10.0.0.8').sent, 1);
  // שליחה לעצמי — לא
  assert.throws(() => relay.handle(signed(a, 'send', { items: items(a.keyId, 1) })), /לא תקינה/);
});

test('מכסת הודעות לשעה למפתח שולח', () => {
  let t = Date.now();
  const relay = newRelay({ clock: () => t });
  const eve = L.generateKeyPair();
  const targets = Array.from({ length: 6 }, () => L.generateKeyPair().keyId);
  for (let i = 0; i < 25; i++) relay.handle(signed(eve, 'send', { items: items(targets[i % 5], 20) }, t), '10.1.0.' + i);
  assert.throws(() => relay.handle(signed(eve, 'send', { items: items(targets[5], 1) }, t), '10.1.1.1'), /בשעה האחרונה/);
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

// הלוגיקה עצמה נבדקת ב-relay-security-review.test.js (clientAddress). כאן: שתי צורות הדגל (Docker: 1, התקנה ב-Linux: yes)
test('כתובת הלקוח מאחורי שרת קדמי: X-Forwarded-For רק עם trustProxy, והכתובת האחרונה בלבד', () => {
  const { clientAddress } = require('../server/license-relay');
  const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientAddress(req('127.0.0.1', '1.1.1.1, 9.9.9.9'), true), '9.9.9.9', 'הכתובת שהשרת הקדמי הוסיף (האחרונה)');
  assert.equal(clientAddress(req('127.0.0.1', '9.9.9.9'), false), '127.0.0.1', 'בלי trustProxy — מתעלמים מהכותרת');
  assert.equal(clientAddress(req('127.0.0.1', ''), true), '127.0.0.1');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'license-relay.js'), 'utf8');
  assert.ok(src.includes("a['trust-proxy'] === '1' || a['trust-proxy'] === 'yes'"), 'שתי צורות הדגל נתמכות');
});

test('הגבלת קצב מאחורי שרת קדמי: לכל לקוח בנפרד ולא לכולם יחד', async () => {
  const server = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-relay-h-')), trustProxy: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const k = L.generateKeyPair();
  const call = (ip) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(signed(k, 'fetch', {})) }).then(r => r.status);
  try {
    for (let i = 0; i < 60; i++) assert.equal(await call('10.0.0.1'), 200);
    assert.equal(await call('10.0.0.1'), 429, 'לקוח אחד שעבר את המכסה נחסם');
    assert.equal(await call('10.0.0.2'), 200, 'לקוח אחר לא נפגע');
  } finally { await new Promise(r => server.close(r)); }
});

test('חבילת השרת להתקנה: כוללת כל קובץ שהשרת טוען ואת קבצי ההתקנה', () => {
  const { serverFiles } = require('../tools/pack-relay');
  const files = serverFiles();
  for (const f of ['server/license-relay.js', 'shell/licensing/license.js', 'server/deploy/install.sh', 'server/deploy/supersuite-relay.service', 'server/deploy/Caddyfile.template']) {
    assert.ok(files.includes(f), 'חסר: ' + f);
  }
  assert.ok(!files.some(f => /owner|root-keys|\.env|node_modules/.test(f)), 'אין בחבילה מפתחות או סודות');
  const sh = fs.readFileSync(path.join(__dirname, '..', 'server', 'deploy', 'install.sh'), 'utf8');
  assert.ok(!sh.includes('\r'), 'install.sh בשורות של Linux (LF) — אחרת לא ירוץ');
  const unit = fs.readFileSync(path.join(__dirname, '..', 'server', 'deploy', 'supersuite-relay.service'), 'utf8');
  assert.match(unit, /--host 127\.0\.0\.1/, 'השירות לא חשוף ישירות לאינטרנט');
  assert.match(unit, /--trust-proxy yes/);
});

test('סקריפט Google Cloud: מסלול חינמי (e2-micro, דיסק Standard), IP קבוע, ובדיקת הדומיין לפני שימוש בו', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'server', 'deploy', 'gcp-create.sh'), 'utf8');
  assert.ok(!sh.includes('\r'), 'שורות Linux (LF)');
  assert.match(sh, /--machine-type e2-micro/);
  assert.match(sh, /--boot-disk-type pd-standard/, 'SSD אינו במסלול החינמי');
  assert.match(sh, /us-central1\|us-east1\|us-west1/, 'אזהרה על אזור מחוץ למסלול החינמי');
  assert.match(sh, /addresses create/);
  assert.ok(sh.indexOf('DOMAIN" =~') < sh.indexOf('install.sh \''), 'הדומיין נבדק לפני שהוא נשלח לפקודה בשרת');
});
