// הודעות מאובטחות בין המערכות: הצפנה מקצה לקצה, חתימה, אנשי קשר לפי העץ, סטטוס מסירה/קריאה, ומסך ההודעות
const test = require('node:test');
const EconUI = require('./helpers/econ-ui');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const C = require('../shell/licensing/crypto-lite');
const L = require('../shell/licensing/license');
const M = require('../shell/licensing/messages');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createChatStore } = require('../shell/licensing/chat');
const { createServer } = require('../server/license-relay');

const PASS = 'menahel-al-chat-2026';
const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const H = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const hex = (u) => Buffer.from(u).toString('hex');

test('crypto-lite: וקטורי בדיקה רשמיים — X25519 (RFC 7748), HMAC (RFC 4231), HKDF (RFC 5869)', () => {
  assert.equal(hex(C.x25519.scalarMult(H('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'),
    H('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'))), 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  const a = H('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const B = C.x25519.scalarMult(H('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb'), C.x25519.BASE);
  assert.equal(hex(C.x25519.scalarMult(a, B)), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  assert.equal(hex(C.hmacSha256(C.utf8('Jefe'), C.utf8('what do ya want for nothing?'))), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  assert.equal(hex(C.hkdfSha256(H('0b'.repeat(22)), H('000102030405060708090a0b0c'), H('f0f1f2f3f4f5f6f7f8f9'), 42)),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  assert.throws(() => C.x25519.scalarMult(a, new Uint8Array(32)), /לא תקין/, 'נקודה בעלת סדר נמוך נדחית');
});

test('הודעה: מוצפנת (אין טקסט גלוי), נפתחת רק אצל הנמען, ושינוי/זיוף שולח נתפסים', () => {
  const a = L.generateKeyPair(); const b = L.generateKeyPair(); const eve = L.generateKeyPair();
  const contactsB = [{ id: a.keyId, name: 'הנהלת הרשת', publicKey: a.publicJwk }];
  const { envelope } = M.seal(a.privateJwk, b.publicJwk, { subject: 'ישיבת הנהלה', text: 'הישיבה תתקיים ביום שלישי', sentAt: 1 });
  assert.doesNotMatch(envelope, /ישיבה|שלישי/);
  const got = M.open(b.privateJwk, envelope, contactsB);
  assert.equal(got.text, 'הישיבה תתקיים ביום שלישי');
  assert.equal(got.fromName, 'הנהלת הרשת');
  assert.throws(() => M.open(eve.privateJwk, envelope, contactsB), /אינה מיועדת/);
  const tampered = JSON.parse(envelope); tampered.ct = tampered.ct.slice(0, -3) + 'AAA';
  assert.throws(() => M.open(b.privateJwk, JSON.stringify(tampered), contactsB), /לא ניתן לפענח/);
  // מישהו שמכיר את המפתח הציבורי של א' לא יכול להתחזות לו: ההודעה נחתמת במפתח הפרטי
  const forged = M.seal(eve.privateJwk, b.publicJwk, { text: 'העבירו כסף', sentAt: 2 }).envelope;
  const f = JSON.parse(forged); f.from = a.keyId;
  assert.throws(() => M.open(b.privateJwk, JSON.stringify(f), contactsB), /לא ניתן לפענח|חתימת/);
  assert.throws(() => M.open(b.privateJwk, envelope, []), /אינה מוכרת/);
  assert.throws(() => M.seal(a.privateJwk, b.publicJwk, { text: '   ', sentAt: 3 }), /ריקה/);
});

test('אנשי קשר לפי העץ: הורה ישיר, ילדים ישירים ומנהל-העל בלבד', () => {
  const root = L.generateKeyPair();
  const chain = [{ payload: { id: 'P'.repeat(22), name: 'רשת', publicKey: root.publicJwk } }, { payload: { id: 'Q'.repeat(22), name: 'אני' } }];
  const ids = M.contactsOf({ chain, children: [{ id: 'K'.repeat(22), name: 'סניף', publicKey: root.publicJwk }], rootKeys: [root.publicJwk] }).map(c => c.role);
  assert.deepEqual(ids, ['owner', 'parent', 'child']);
});

test('תיבה מקומית: שיחות, לא-נקראו, סטטוס, חיפוש, ואין כפילויות', () => {
  const box = createChatStore({ storage: one(), clock: () => 100 });
  box.addOutgoing({ mid: 'm1', peer: 'p1', text: 'שלום', sentAt: 1 });
  assert.equal(box.addIncoming({ mid: 'm2', peer: 'p1', text: 'שלום וברכה', sentAt: 2 }), true);
  assert.equal(box.addIncoming({ mid: 'm2', peer: 'p1', text: 'שלום וברכה', sentAt: 2 }), false);
  const conv = box.conversations([{ id: 'p1', name: 'א' }, { id: 'p2', name: 'ב' }]);
  assert.equal(conv[0].unread, 1);
  assert.equal(box.unreadTotal(), 1);
  assert.deepEqual(box.markRead('p1'), ['m2']);
  box.setStatus(['m1'], 'read');
  assert.equal(box.thread('p1')[0].status, 'read');
  assert.equal(box.search('וברכה').length, 1);
});

test('שיחה מלאה דרך שרת אמיתי: מנהל-העל ↔ לקוח ↔ מערכת בת, סטטוס נקרא, והשרת לא רואה תוכן', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chat-relay-'));
  const server = createServer({ dataDir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init(PASS).publicKey];
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      const chat = createChatStore({ storage: one() });
      const ownerChat = withOwner ? createChatStore({ storage: one() }) : null;
      return { store, chat, ownerChat, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch, chat, ownerChat }) };
    };
    const O = mk(true); const T = mk(false); const K = mk(false);
    // הקמת העץ: לקוח ומערכת בת (כמו בבדיקות הרישוי מרחוק)
    await T.sync.sendLicenseRequest('רשת מוסדות');
    await O.sync.ownerReceive();
    let m = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(m.from, 'license', owner.issue({ request: m.body, features: ['econ'], limits: { maxChildren: 1, maxUsers: 5, maxStorageMb: 10, maxDepth: 2 } }).package);
    await T.sync.receive();
    await T.sync.sendApprovalRequest({ request: JSON.stringify(K.store.request('סניף צפון')), name: 'סניף צפון', features: ['econ'],
      limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 5, maxDepth: 2 } });
    await O.sync.ownerReceive();
    m = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(m.from, 'approval', owner.approve({ request: m.body }).package);
    await T.sync.receive();
    await K.sync.receive();
    assert.equal(K.store.current().status, 'active');

    // אנשי קשר: הלקוח רואה את מנהל-העל ואת מערכת הבת; מערכת הבת — את מנהל-העל ואת הלקוח
    assert.deepEqual(T.sync.myContacts().map(c => c.role).sort(), ['child', 'owner']);
    assert.deepEqual(K.sync.myContacts().map(c => c.role).sort(), ['owner', 'parent']);
    assert.equal(owner.contacts().length, 2);

    // מערכת הבת כותבת ללקוח
    const parentId = K.sync.myContacts().find(c => c.role === 'parent').id;
    await K.sync.chatSend(parentId, { subject: 'דוח חודשי', text: 'הדוח החודשי מוכן לעיון' });
    assert.equal(K.chat.thread(parentId)[0].status, 'delivered');
    // השרת מחזיק רק טקסט מוצפן
    // כולל תיקיות משנה (prekeys/, signups/)
    const onDisk = fs.readdirSync(dataDir, { recursive: true }).map(f => path.join(dataDir, f)).filter(f => fs.statSync(f).isFile())
      .map(f => fs.readFileSync(f, 'utf8')).join('');
    assert.doesNotMatch(onDisk, /הדוח החודשי|דוח חודשי/);

    await T.sync.receive();
    const childId = T.sync.myContacts().find(c => c.role === 'child').id;
    assert.equal(T.chat.unreadTotal(), 1);
    assert.equal(T.chat.thread(childId)[0].text, 'הדוח החודשי מוכן לעיון');
    // קריאה ← אישור קריאה אצל השולח
    await T.sync.chatMarkRead(childId);
    await K.sync.receive();
    assert.equal(K.chat.thread(parentId)[0].status, 'read');

    // מנהל-העל כותב ללקוח, והלקוח עונה
    await O.sync.ownerChatSend(T.store.syncInfo().nodeId, { text: 'חג שמח לכל הצוות' });
    await T.sync.receive();
    const ownerId = T.sync.myContacts().find(c => c.role === 'owner').id;
    assert.equal(T.chat.thread(ownerId)[0].text, 'חג שמח לכל הצוות');
    await T.sync.chatSend(ownerId, { text: 'תודה רבה, גם לכם' });
    assert.equal((await O.sync.ownerReceive()).messages, 1);
    assert.equal(O.ownerChat.thread(T.store.syncInfo().nodeId).find(x => x.dir === 'in').text, 'תודה רבה, גם לכם');

    // אי אפשר לכתוב למי שאינו איש קשר (מערכת בת לא כותבת ללקוח אחר)
    await assert.rejects(K.sync.chatSend('Z'.repeat(22), { text: 'x' }), /אינו מוכר/);
  } finally { await new Promise(r => server.close(r)); }
});

// ---------- מסך ההודעות ----------
function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({ id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(e, fn) { (listeners[e] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; }, setAttribute() {}, focus() {}, remove() {} }, extra);
}
async function render(responses) {
  const ROOT = path.join(__dirname, '..');
  const UI_SRC = EconUI.source();
  const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
  const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];
  const elements = {};
  const systemAPI = new Proxy({}, { get(_t, name) {
    if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
    return () => Promise.resolve(name in responses ? responses[name] : {});
  } });
  const navButtons = VIEWS.map(v => fakeElement('', { dataset: { view: v } }));
  const document = { readyState: 'complete', getElementById(id) { return (elements[id] ||= fakeElement(id)); }, querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; }, addEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement() };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context; context.window.systemAPI = systemAPI;
  vm.createContext(context);
  EconUI.run(context);
  for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r));
  navButtons[VIEWS.indexOf('messages')]._listeners.click[0]();
  for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r));
  return elements.view.innerHTML;
}

test('מסך הודעות: בלי שרת — הסבר; עם שרת — אנשי קשר, לא-נקראו וכפתור קבלה', async () => {
  assert.match(await render({ chatOverview: { conversations: [], remote: false, unread: 0 }, getOwnerState: {} }), /יש להגדיר שרת/);
  const html = await render({ chatOverview: { remote: true, unread: 2, conversations: [
    { id: 'o1', name: 'מנהל-העל', role: 'owner', unread: 2, last: { text: 'שלום', at: 1, dir: 'in' } },
    { id: 'c1', name: 'סניף דרום', role: 'child', unread: 0, last: null }] }, getOwnerState: { unlocked: true } });
  assert.match(html, /chatRefreshBtn/);
  assert.match(html, /סניף דרום/);
  assert.match(html, /chat-badge">2/);
  assert.match(html, /בשם מנהל-העל/, 'בחירת "בשם מנהל-העל" כשמצב מנהל-העל פתוח');
  assert.match(html, /בחרו איש קשר/);
});
