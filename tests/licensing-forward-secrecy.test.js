// סודיות קדימה בהודעות: מפתח חד-פעמי לכל הודעה + מפתח זמני שבועי של הנמען, שנמחק אחרי 30 יום
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const M = require('../shell/licensing/messages');
const PK = require('../shell/licensing/prekeys');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createChatStore } = require('../shell/licensing/chat');
const { createServer } = require('../server/license-relay');

const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const DAY = 24 * 60 * 60 * 1000;

test('מפתח זמני: מתחלף כל שבוע, נמחק אחרי 30 יום, וחבילה חתומה מאומתת רק מול הבעלים', () => {
  let t = 1_000_000;
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const pks = PK.createPrekeyStore({ storage: one(), clock: () => t });
  const k1 = pks.current();
  assert.equal(pks.current().id, k1.id, 'יציב בתוך השבוע');
  t += 8 * DAY;
  const k2 = pks.current();
  assert.notEqual(k2.id, k1.id, 'התחלף אחרי שבוע');
  assert.ok(pks.privOf(k1.id), 'הישן נשמר לפענוח הודעות בדרך');
  t += 31 * DAY;
  pks.current();
  assert.equal(pks.privOf(k1.id), null, 'נמחק אחרי 30 יום');
  const bundle = pks.bundle(a.privateJwk);
  assert.ok(PK.verifyBundle(bundle, a.publicJwk, t));
  assert.equal(PK.verifyBundle(bundle, b.publicJwk, t), null, 'חבילה של אחר');
  assert.equal(PK.verifyBundle({ ...bundle, pub: bundle.pub.replace(/^./, c => (c === 'A' ? 'B' : 'A')) }, a.publicJwk, t), null, 'החלפת מפתח בשרת');
  assert.equal(PK.verifyBundle(bundle, a.publicJwk, t + 25 * DAY), null, 'חבילה ישנה מדי');
});

test('הודעה v2: נפתחת עם המפתח הזמני; אחרי שנמחק — גם גניבת המפתח הקבוע לא מפענחת', () => {
  let t = 5_000_000;
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const pksB = PK.createPrekeyStore({ storage: one(), clock: () => t });
  const prekey = PK.verifyBundle(pksB.bundle(b.privateJwk), b.publicJwk, t);
  const contacts = [{ id: a.keyId, name: 'א', publicKey: a.publicJwk }];
  const r = M.seal(a.privateJwk, b.publicJwk, { text: 'סוד מסחרי', sentAt: t }, { prekey });
  assert.equal(r.forwardSecret, true);
  const env = JSON.parse(r.envelope);
  assert.equal(env.v, 2);
  assert.equal(env.pk, prekey.id);
  assert.equal(M.open(b.privateJwk, r.envelope, contacts, { prekeyPriv: (id) => pksB.privOf(id) }).text, 'סוד מסחרי');
  // בלי המפתח הזמני (נמחק / תוקף שגנב רק את המפתח הקבוע) — לא נפתח
  assert.throws(() => M.open(b.privateJwk, r.envelope, contacts), /ישנה מדי/);
  t += 40 * DAY;
  pksB.current();
  assert.throws(() => M.open(b.privateJwk, r.envelope, contacts, { prekeyPriv: (id) => pksB.privOf(id) }), /ישנה מדי/);
  // שתי הודעות זהות — מוצפנות שונה (מפתח חד-פעמי חדש)
  const r2 = M.seal(a.privateJwk, b.publicJwk, { text: 'סוד מסחרי', sentAt: t }, { prekey });
  assert.notEqual(JSON.parse(r2.envelope).eph, env.eph);
});

test('הודעה v2 בלי מפתח זמני ותאימות להודעות v1 ישנות', () => {
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const contacts = [{ id: a.keyId, name: 'א', publicKey: a.publicJwk }];
  const r = M.seal(a.privateJwk, b.publicJwk, { text: 'שלום', sentAt: 1 });
  assert.equal(r.forwardSecret, false);
  assert.equal(JSON.parse(r.envelope).pk, null);
  assert.equal(M.open(b.privateJwk, r.envelope, contacts).text, 'שלום');
  // הודעה בפורמט הישן (v1: X25519 בין המפתחות הקבועים) — עדיין נפתחת אחרי השדרוג
  const C = require('../shell/licensing/crypto');
  const nc = require('crypto');
  // מזהה באורך האמיתי (16 תווים, כמו ש-seal תמיד יצר) — open דוחה מזהה לא תקין (בדיקת הקוד 23.10.2026, ממצא 49)
  const body = { v: 1, kind: 'text', mid: 'old1aaaaaaaaaaaa', from: a.keyId, to: b.keyId, sentAt: 3, subject: '', text: 'הודעה ישנה' };
  const salt = nc.randomBytes(16), iv = nc.randomBytes(12);
  const secret = C.x25519.scalarMult(C.x25519.fromEdSeed(C.b64uDecode(a.privateJwk.d)), C.x25519.fromEdPublic(C.b64uDecode(b.publicJwk.x)));
  const key = C.hkdfSha256(secret, new Uint8Array(salt), C.utf8('supersuite-message-v1'), 32);
  const ci = nc.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([ci.update(JSON.stringify({ ...body, sig: L.signObject(body, a.privateJwk) })), ci.final()]);
  const v1 = JSON.stringify({ type: 'supersuite-message', v: 1, from: a.keyId, to: b.keyId, salt: C.b64uEncode(salt), iv: C.b64uEncode(iv),
    ct: C.b64uEncode(ct), tag: C.b64uEncode(ci.getAuthTag()) });
  assert.equal(M.open(b.privateJwk, v1, contacts).text, 'הודעה ישנה');
  // מישהו שאינו השולח לא יכול לייצר הודעה "ממנו" — DH3 קשור למפתח הקבוע של השולח
  const eve = L.generateKeyPair();
  const forged = JSON.parse(M.seal(eve.privateJwk, b.publicJwk, { text: 'x', sentAt: 2 }).envelope);
  forged.from = a.keyId;
  assert.throws(() => M.open(b.privateJwk, JSON.stringify(forged), contacts), /לא ניתן לפענח|חתימת/);
});

test('מסלול מלא בשרת: מפתחות זמניים מתפרסמים בסנכרון, ההודעות נשלחות עם סודיות קדימה', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-fs-relay-'));
  const server = createServer({ dataDir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init('menahel-al-fs-2026').publicKey];
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      const chat = createChatStore({ storage: one() });
      const ownerChat = withOwner ? createChatStore({ storage: one() }) : null;
      return { store, chat, ownerChat, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch, chat, ownerChat,
        prekeys: PK.createPrekeyStore({ storage: one() }), ownerPrekeys: withOwner ? PK.createPrekeyStore({ storage: one() }) : null }) };
    };
    const O = mk(true), T = mk(false);
    await T.sync.sendLicenseRequest('בית מדרש');
    await O.sync.ownerReceive();
    const m = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(m.from, 'license', owner.issue({ request: m.body, features: ['econ'], limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 10, maxDepth: 1 } }).package);
    await T.sync.receive(); // מפרסם את המפתח הזמני של הלקוח
    const tid = T.store.syncInfo().nodeId;
    await O.sync.ownerChatSend(tid, { text: 'הודעה מוגנת' });
    const onDisk = fs.readFileSync(path.join(dataDir, tid + '.json'), 'utf8');
    const env = JSON.parse(JSON.parse(onDisk)[0].body);
    assert.equal(env.v, 2);
    assert.ok(env.pk, 'נשלחה עם המפתח הזמני של הלקוח');
    await T.sync.receive();
    const ownerId = T.sync.myContacts().find(c => c.role === 'owner').id;
    assert.equal(T.chat.thread(ownerId)[0].text, 'הודעה מוגנת');
    // ובכיוון ההפוך — מנהל-העל פרסם את שלו ב-ownerReceive
    await T.sync.chatSend(ownerId, { text: 'תשובה מוגנת' });
    const ownerBox = JSON.parse(fs.readFileSync(path.join(dataDir, ownerId + '.json'), 'utf8'));
    assert.ok(JSON.parse(ownerBox[ownerBox.length - 1].body).pk, 'גם ללקוח היה מפתח זמני של מנהל-העל');
    assert.equal((await O.sync.ownerReceive()).messages, 1);
  } finally { await new Promise(r => server.close(r)); }
});
