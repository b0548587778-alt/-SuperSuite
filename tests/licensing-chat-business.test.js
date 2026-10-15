// הודעות בסגנון "וואטסאפ ביזנס": תגובה, עריכה ומחיקה, כוכב, נעיצה/ארכיון/השתקה, תוויות והערות,
// פרופיל עסקי, תשובות מהירות, הודעות פתיחה והיעדרות (לא בשבת), רשימות תפוצה וקבצים מצורפים
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const L = require('../shell/licensing/license');
const M = require('../shell/licensing/messages');
const PK = require('../shell/licensing/prekeys');
const { createChatStore, isOpenAt } = require('../shell/licensing/chat');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createServer } = require('../server/license-relay');

const one = (init = null) => { let v = init; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// יום שלישי 10:00 / 22:00 לפי השעון המקומי
const tuesdayAt = (h) => { const d = new Date(2026, 9, 13, h, 0, 0); return d.getTime(); };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c00000000049454e44ae426082', 'hex').toString('base64');

test('תיבה: פורמט ישן נקרא, נעיצה עד 3, ארכיון, השתקה, תוויות והערה פנימית', () => {
  const legacy = JSON.stringify([{ mid: 'm1', peer: 'p1', dir: 'in', text: 'הודעה ישנה', sentAt: 1, read: false }]);
  const box = createChatStore({ storage: one(legacy) });
  assert.equal(box.thread('p1')[0].text, 'הודעה ישנה', 'תאימות לאחור');
  const contacts = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, name: 'סניף ' + (i + 1), role: 'child' }));
  for (const id of ['p2', 'p3', 'p4']) box.setMeta(id, { pinned: true });
  assert.throws(() => box.setMeta('p1', { pinned: true }), /עד 3/);
  assert.deepEqual(box.conversations(contacts).slice(0, 3).map(c => c.id).sort(), ['p2', 'p3', 'p4'], 'נעוצות ראשונות');
  box.setMeta('p2', { archived: true });
  assert.equal(box.meta('p2').pinned, false, 'ארכיון מבטל נעיצה');
  assert.ok(!box.conversations(contacts).some(c => c.id === 'p2'));
  assert.deepEqual(box.conversations(contacts, 'archived').map(c => c.id), ['p2']);
  assert.equal(box.unreadTotal(), 1);
  box.setMeta('p1', { muted: true, labels: ['paid', 'no-such-label'], note: 'לקוח ותיק — להציע הנחה' });
  assert.equal(box.unreadTotal(), 0, 'שיחה מושתקת לא נספרת במונה הכללי');
  assert.deepEqual(box.meta('p1').labels, ['paid'], 'תווית לא מוכרת נדחית');
  assert.deepEqual(box.conversations(contacts, 'label:paid').map(c => c.id), ['p1']);
  assert.deepEqual(box.conversations(contacts, 'unread').map(c => c.id), ['p1']);
  // הודעה חדשה מוציאה שיחה מהארכיון
  box.addIncoming({ mid: 'm2xxxxxxxx', peer: 'p2', text: 'שאלה חדשה', sentAt: 5 });
  assert.equal(box.meta('p2').archived, false);
});

test('עריכה ומחיקה: רק הודעה שלי, בחלון הזמן; עריכה מרחוק רק להודעה של השולח עצמו', () => {
  let t = 1_000_000;
  const box = createChatStore({ storage: one(), clock: () => t });
  box.addOutgoing({ mid: 'out1aaaaaa', peer: 'p1', text: 'מחיר: 100 ש"ח', sentAt: t });
  box.addIncoming({ mid: 'in1aaaaaaa', peer: 'p1', text: 'תודה', sentAt: t });
  box.addIncoming({ mid: 'in2aaaaaaa', peer: 'p2', text: 'של מישהו אחר', sentAt: t });
  assert.throws(() => box.editOwn('in1aaaaaaa', 'x'), /15 דקות/, 'לא עורכים הודעה נכנסת');
  box.editOwn('out1aaaaaa', 'מחיר: 120 ש"ח', t + 5 * MIN);
  assert.equal(box.get('out1aaaaaa').text, 'מחיר: 120 ש"ח');
  assert.throws(() => box.editOwn('out1aaaaaa', 'y', t + 16 * MIN), /15 דקות/);
  assert.equal(box.applyRemoteEdit('p1', 'in2aaaaaaa', 'זיוף', t), false, 'איש קשר לא עורך הודעה של אחר');
  assert.equal(box.applyRemoteEdit('p1', 'in1aaaaaaa', 'תודה רבה', t + MIN), true);
  assert.equal(box.applyRemoteEdit('p1', 'in1aaaaaaa', 'מאוחר', t + 60 * MIN), false, 'עריכה מאוחרת נדחית');
  box.star('in1aaaaaaa', true);
  assert.equal(box.starred().length, 1);
  assert.equal(box.applyRemoteDelete('p1', 'in1aaaaaaa'), true);
  const del = box.get('in1aaaaaaa');
  assert.equal(del.deleted, true);
  assert.equal(del.text, '', 'התוכן נמחק בפועל');
  assert.equal(box.starred().length, 0);
  assert.throws(() => box.deleteOwnForAll('out1aaaaaa', t + 3 * DAY), /יומיים/);
  box.deleteOwnForAll('out1aaaaaa', t + DAY);
  assert.equal(box.deleteForMe(['in2aaaaaaa']), 1);
  assert.equal(box.thread('p2').length, 0);
});

test('הגדרות העסק: בדיקת קלט, ותווית שנמחקה יורדת מהשיחות', () => {
  const box = createChatStore({ storage: one() });
  const s = box.settings();
  assert.throws(() => box.saveSettings({ ...s, hours: [...s.hours.slice(0, 6), { open: '18:00', close: '09:00' }] }), /אחרי שעת הפתיחה/);
  assert.throws(() => box.saveSettings({ ...s, profile: { email: 'לא-דואל' } }), /דוא"ל/);
  assert.throws(() => box.saveSettings({ ...s, profile: { website: 'http://x.co.il' } }), /https/);
  assert.throws(() => box.saveSettings({ ...s, quickReplies: [{ shortcut: 'מחיר', text: 'א' }, { shortcut: '/מחיר', text: 'ב' }] }), /פעמיים/);
  assert.throws(() => box.saveSettings({ ...s, quickReplies: [{ shortcut: 'שני מילים', text: 'א' }] }), /בלי רווחים/);
  assert.throws(() => box.saveSettings({ ...s, greeting: { enabled: true, text: '  ' } }), /ריקה/);
  box.setMeta('p1', { labels: ['paid', 'new'] });
  const saved = box.saveSettings({ ...s, labels: s.labels.filter(l => l.id !== 'paid'), quickReplies: [{ shortcut: 'שעות', text: 'א-ה 9:00-17:00' }],
    lists: [{ name: 'כל הסניפים', members: ['A'.repeat(22), 'לא-מזהה'] }] });
  assert.deepEqual(box.meta('p1').labels, ['new']);
  assert.deepEqual(saved.lists[0].members, ['A'.repeat(22)], 'מזהה לא תקין נדחה');
  assert.ok(saved.lists[0].id);
});

test('הודעות אוטומטיות: פתיחה לפונה חדש בלבד, היעדרות מחוץ לשעות פעם ב-12 שעות, ולא עונים להודעה אוטומטית', () => {
  const box = createChatStore({ storage: one() });
  const s = box.settings();
  box.saveSettings({ ...s, greeting: { ...s.greeting, enabled: true }, away: { ...s.away, enabled: true } });
  assert.equal(isOpenAt(box.settings().hours, tuesdayAt(10)), true);
  assert.equal(isOpenAt(box.settings().hours, tuesdayAt(22)), false);
  const msg = (mid, at, extra = {}) => { const m = { mid, peer: 'p1', text: 'שלום', sentAt: at, ...extra }; box.addIncoming(m); return m; };
  // פנייה ראשונה בשעות הפעילות — רק פתיחה
  assert.deepEqual(box.autoReplies('p1', msg('a1aaaaaaaa', tuesdayAt(10)), tuesdayAt(10)).map(r => r.auto), ['greeting']);
  assert.deepEqual(box.autoReplies('p1', msg('a2aaaaaaaa', tuesdayAt(11)), tuesdayAt(11)), [], 'לא פעם שנייה');
  // בלילה — היעדרות, ושוב רק אחרי 12 שעות
  assert.deepEqual(box.autoReplies('p1', msg('a3aaaaaaaa', tuesdayAt(22)), tuesdayAt(22)).map(r => r.auto), ['away']);
  assert.deepEqual(box.autoReplies('p1', msg('a4aaaaaaaa', tuesdayAt(23)), tuesdayAt(23)), []);
  // הודעה אוטומטית מהצד השני — לא עונים (מונע לולאה בין שתי מערכות)
  assert.deepEqual(box.autoReplies('p1', msg('a5aaaaaaaa', tuesdayAt(22) + DAY, { auto: 'away' }), tuesdayAt(22) + DAY), []);
  // אחרי 14 יום בלי קשר — שוב הודעת פתיחה
  const later = tuesdayAt(10) + 21 * DAY;
  assert.deepEqual(box.autoReplies('p1', msg('a6aaaaaaaa', later), later).map(r => r.auto), ['greeting']);
});

test('קבצים מצורפים: סוג מרשימה סגורה, גודל מוגבל, שם בלי נתיב', () => {
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const contacts = [{ id: a.keyId, name: 'א', publicKey: a.publicJwk }];
  assert.throws(() => M.seal(a.privateJwk, b.publicJwk, { text: '', sentAt: 1, att: { name: 'x.exe', type: 'application/x-msdownload', data: 'AAAA' } }), /אינו נתמך/);
  assert.throws(() => M.seal(a.privateJwk, b.publicJwk, { sentAt: 1, att: { name: 'big.pdf', type: 'application/pdf', data: Buffer.alloc(M.MAX_ATTACHMENT + 1).toString('base64') } }), /גדול מדי/);
  assert.throws(() => M.seal(a.privateJwk, b.publicJwk, { sentAt: 1, att: { name: 'svg.png', type: 'image/svg+xml', data: 'AAAA' } }), /אינו נתמך/, 'SVG (עלול להכיל סקריפט) — לא');
  const r = M.seal(a.privateJwk, b.publicJwk, { sentAt: 1, replyTo: 'not valid!!', att: { name: '..\\..\\Windows\\קבלה', type: 'image/png', data: PNG } });
  const got = M.open(b.privateJwk, r.envelope, contacts);
  assert.equal(got.att.name, '.._.._Windows_קבלה.png'.replace(/^\.+/, ''));
  assert.ok(!/[\\/]/.test(got.att.name));
  assert.equal(got.att.data, PNG);
  assert.equal(got.replyTo, undefined, 'מזהה תגובה לא תקין נדחה');
  // המעטפה של הקובץ הגדול ביותר נכנסת בתקרת השרת
  const max = M.seal(a.privateJwk, b.publicJwk, { text: 'א'.repeat(M.MAX_TEXT), sentAt: 1, att: { name: 'f.pdf', type: 'application/pdf', data: Buffer.alloc(M.MAX_ATTACHMENT).toString('base64') } });
  assert.ok(max.envelope.length < 256 * 1024, 'גודל המעטפה ' + max.envelope.length);
});

test('מסלול מלא דרך השרת: תגובה וקובץ, עריכה, מחיקה אצל כולם, פרופיל, תפוצה, העברה ותשובות אוטומטיות (לא בשבת)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-biz-'));
  let shabbat = false;
  let now = tuesdayAt(10);
  const server = createServer({ dataDir, clock: () => now });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init('menahel-al-biz-2026').publicKey];
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      const chat = createChatStore({ storage: one(), clock: () => now });
      const ownerChat = withOwner ? createChatStore({ storage: one(), clock: () => now }) : null;
      return { store, chat, ownerChat, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch, chat, ownerChat, clock: () => now,
        prekeys: PK.createPrekeyStore({ storage: one(), clock: () => now }), ownerPrekeys: withOwner ? PK.createPrekeyStore({ storage: one(), clock: () => now }) : null,
        isRestTime: () => shabbat }) };
    };
    const O = mk(true);
    const tenants = [mk(false), mk(false)];
    for (const [i, T] of tenants.entries()) {
      await T.sync.sendLicenseRequest('ישיבה ' + (i + 1));
      await O.sync.ownerReceive();
      const m = owner.takeFromInbox(owner.inbox()[0].id);
      await O.sync.ownerReply(m.from, 'license', owner.issue({ request: m.body, features: ['econ'], limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 10, maxDepth: 1 } }).package);
      await T.sync.receive();
    }
    const [T1, T2] = tenants;
    const t1 = T1.store.syncInfo().nodeId, t2 = T2.store.syncInfo().nodeId;
    const ownerId = T1.sync.myContacts().find(c => c.role === 'owner').id;
    const ops = O.sync.chatOps(true);

    // הגדרות מנהל-העל: פתיחה + היעדרות + פרופיל + רשימת תפוצה
    const s = O.ownerChat.settings();
    O.ownerChat.saveSettings({ ...s, greeting: { ...s.greeting, enabled: true, text: 'ברוכים הבאים לשירות הלקוחות' },
      away: { ...s.away, enabled: true, text: 'נחזור אליכם מחר בבוקר' },
      profile: { name: 'סופר סוויט — שירות', phone: '03-1234567', about: 'תמיכה ורישוי' }, lists: [{ name: 'כל הלקוחות', members: [t1, t2] }] });

    // 1. לקוח פונה בשעות הפעילות — מקבל הודעת פתיחה בלבד
    await T1.sync.chatSend(ownerId, { text: 'שלום, יש לי שאלה על החשבונית', att: { name: 'חשבונית.png', type: 'image/png', data: PNG } });
    await O.sync.ownerReceive();
    const inbound = O.ownerChat.thread(t1)[0];
    assert.equal(inbound.att.name, 'חשבונית.png');
    assert.equal(inbound.att.data, PNG, 'תמונה מוצגת ישירות');
    await T1.sync.receive();
    const autoMsgs = T1.chat.thread(ownerId).filter(m => m.dir === 'in');
    assert.deepEqual(autoMsgs.map(m => m.auto), ['greeting']);
    assert.equal(autoMsgs[0].text, 'ברוכים הבאים לשירות הלקוחות');

    // 2. תגובה לציטוט, ואז עריכה
    const { mid } = await ops.send(t1, { text: 'המחיר הוא 100 ש"ח', replyTo: inbound.mid });
    now += 2 * MIN;
    await ops.edit(mid, 'המחיר הוא 120 ש"ח');
    await T1.sync.receive();
    const reply = T1.chat.get(mid);
    assert.equal(reply.text, 'המחיר הוא 120 ש"ח');
    assert.ok(reply.editedAt);
    assert.equal(reply.replyTo, inbound.mid);

    // 3. מחיקה אצל כולם
    await ops.deleteForAll(mid);
    await T1.sync.receive();
    assert.equal(T1.chat.get(mid).deleted, true);
    assert.equal(T1.chat.get(mid).text, '');

    // 4. פרופיל עסקי מגיע ללקוחות
    assert.equal((await ops.publishProfile()).sent, 2);
    await T2.sync.receive();
    assert.equal(T2.chat.meta(ownerId).profile.phone, '03-1234567');

    // 5. תפוצה — כל לקוח מקבל הודעה נפרדת
    const listId = O.ownerChat.settings().lists[0].id;
    const bc = await ops.broadcast(listId, { text: 'מועדים לשמחה! המשרד סגור בחול המועד' });
    assert.equal(bc.sent, 2);
    await T1.sync.receive(); await T2.sync.receive();
    for (const T of tenants) assert.ok(T.chat.thread(ownerId).some(m => m.bc && m.text.includes('מועדים')));

    // 6. העברה — עם הקובץ ועם סימון
    await ops.forward(inbound.mid, t2);
    await T2.sync.receive();
    const fwd = T2.chat.thread(ownerId).find(m => m.forwarded);
    assert.equal(fwd.att.name, 'חשבונית.png');

    // 7. בלילה — היעדרות; בשבת — שום תשובה אוטומטית
    now = tuesdayAt(22);
    shabbat = true;
    await T2.sync.chatSend(ownerId, { text: 'שאלה בלילה' });
    await O.sync.ownerReceive();
    await T2.sync.receive();
    assert.ok(!T2.chat.thread(ownerId).some(m => m.auto === 'away'), 'במצב שבת לא נשלחת הודעה אוטומטית');
    shabbat = false;
    now += MIN;
    await T2.sync.chatSend(ownerId, { text: 'עוד שאלה' });
    await O.sync.ownerReceive();
    await T2.sync.receive();
    assert.ok(T2.chat.thread(ownerId).some(m => m.auto === 'away'));
  } finally { await new Promise(r => server.close(r)); }
});

test('הרשאות ערוצי ההודעות', () => {
  const handlers = {};
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_biz__.js' : orig.call(this, req, ...rest); };
  require.cache['/__electron_stub_biz__.js'] = { id: '/__electron_stub_biz__.js', filename: '/__electron_stub_biz__.js', loaded: true,
    exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } } };
  try {
    const { permissionFor } = require('../modules/econ/ipc');
    assert.equal(permissionFor('chat:thread'), 'data.view');
    assert.equal(permissionFor('chat:saveAttachment'), 'data.view');
    assert.equal(permissionFor('chat:send'), 'data.edit');
    assert.equal(permissionFor('chat:broadcast'), 'data.edit');
    assert.equal(permissionFor('chat:setMeta'), 'data.edit');
    assert.equal(permissionFor('chat:deleteForAll'), 'data.delete');
    assert.equal(permissionFor('chat:deleteForMe'), 'data.delete');
    assert.equal(permissionFor('chat:saveSettings'), 'users.manage', 'תשובות אוטומטיות ופרופיל — מנהל בלבד');
    assert.equal(permissionFor('chat:publishProfile'), 'users.manage');
  } finally { Module._resolveFilename = orig; }
});

// ---------- מסך ההודעות ----------
function fakeElement(id = '', extra = {}) {
  const listeners = {};
  return Object.assign({ id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(e, fn) { (listeners[e] ||= []).push(fn); }, _listeners: listeners,
    appendChild() {}, append() {}, querySelector() { return fakeElement(); }, querySelectorAll() { return []; }, setAttribute() {}, focus() {}, remove() {} }, extra);
}
async function render(responses, setup) {
  const ROOT = path.join(__dirname, '..');
  const UI_SRC = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
  const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, { get(_t, name) {
    if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
    return (...args) => { calls.push([name, ...args]); return Promise.resolve(name in responses ? responses[name] : {}); };
  } });
  const navButtons = VIEWS.map(v => fakeElement('', { dataset: { view: v } }));
  const document = { readyState: 'complete', getElementById(id) { return (elements[id] ||= fakeElement(id)); }, querySelector() { return fakeElement(); },
    querySelectorAll(sel) { return sel === '.nav' ? navButtons : []; }, addEventListener() {}, removeEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement() };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context; context.window.systemAPI = systemAPI;
  vm.createContext(context);
  vm.runInContext(UI_SRC, context, { filename: 'unified-ui.js' });
  for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r));
  navButtons[VIEWS.indexOf('messages')]._listeners.click[0]();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return { html: elements.view.innerHTML, calls };
}

test('מסך הודעות: ציטוט, קובץ, נמחקה, אוטומטית, תוויות, פרופיל והערה; כפתור הגדרות למנהל בלבד', async () => {
  const now = Date.now();
  const convs = [{ id: 'o1', name: 'מנהל-העל', role: 'owner', unread: 0, pinned: true, muted: true, labels: ['paid'], hasNote: true, last: { text: 'שלום', at: now, dir: 'in' } }];
  const thread = { now, meta: { labels: ['paid'], note: 'לקוח ותיק', profile: { name: 'שירות', phone: '03-1234567' } }, messages: [
    { mid: 'q1aaaaaaaa', dir: 'in', text: 'יש לי שאלה', sentAt: now - 5000, att: { name: 'קבלה.png', type: 'image/png', size: 70, data: PNG, available: true } },
    { mid: 'r1aaaaaaaa', dir: 'out', text: 'התשובה <b>כאן</b>', sentAt: now - 1000, replyTo: 'q1aaaaaaaa', status: 'read', editedAt: now },
    { mid: 'd1aaaaaaaa', dir: 'in', text: '', sentAt: now - 900, deleted: true },
    { mid: 'g1aaaaaaaa', dir: 'in', text: 'ברוכים הבאים', sentAt: now - 800, auto: 'greeting' },
    { mid: 'f1aaaaaaaa', dir: 'in', text: '', sentAt: now - 700, att: { name: 'דוח.pdf', type: 'application/pdf', size: 4096, data: null, available: false } }] };
  const base = { chatOverview: { remote: true, unread: 0, conversations: convs, contacts: convs, labels: [{ id: 'paid', name: 'שולם', color: '#16a34a' }],
    quickReplies: [{ shortcut: 'שעות', text: 'א-ה 9-17' }], lists: [{ id: 'l1', name: 'כולם', count: 1 }] }, chatThread: thread, getOwnerState: {} };
  // בלי איש קשר פתוח — רק הרשימה
  const { html: list } = await render({ ...base, getAdvancedSettings: { isAdmin: false } });
  assert.match(list, /📌 מנהל-העל/);
  assert.match(list, /🔕/);
  assert.match(list, /chat-label[^>]*>שולם/);
  assert.match(list, /📢 הודעת תפוצה/);
  assert.doesNotMatch(list, /הגדרות העסק/, 'משתמש רגיל לא רואה הגדרות עסק');
  const { html: adminList } = await render({ ...base, getAdvancedSettings: { isAdmin: true } });
  assert.match(adminList, /⚙ הגדרות העסק/);
});

test('מסך הודעות: שיחה פתוחה מציגה את כל סוגי ההודעות, בלי HTML מההודעה', async () => {
  const now = Date.now();
  const convs = [{ id: 'o1', name: 'מנהל-העל', role: 'owner', unread: 0, labels: [], last: null }];
  const thread = { now, meta: { labels: [], note: 'לקוח ותיק', profile: { name: 'שירות', phone: '03-1234567', about: 'תמיכה' } }, messages: [
    { mid: 'q1aaaaaaaa', dir: 'in', text: 'יש לי שאלה', sentAt: now - 5000, att: { name: 'קבלה.png', type: 'image/png', size: 70, data: PNG, available: true } },
    { mid: 'r1aaaaaaaa', dir: 'out', text: 'התשובה <b>כאן</b>', sentAt: now - 1000, replyTo: 'q1aaaaaaaa', status: 'read', editedAt: now },
    { mid: 'd1aaaaaaaa', dir: 'in', text: '', sentAt: now - 900, deleted: true },
    { mid: 'g1aaaaaaaa', dir: 'in', text: 'ברוכים הבאים', sentAt: now - 800, auto: 'greeting' },
    { mid: 'x1aaaaaaaa', dir: 'in', text: '', sentAt: now - 700, att: { name: 'דוח.pdf', type: 'application/pdf', size: 4096, data: null, available: false } },
    { mid: 'z1aaaaaaaa', dir: 'in', text: '', sentAt: now - 600, att: { name: 'רע.png', type: 'image/svg+xml', size: 10, data: 'PHN2Zz4=', available: true } }] };
  // לחיצה על איש הקשר דרך ה-state: מדמים בחירה ע"י render חוזר עם chatPeer
  const ROOT = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
  assert.match(src, /state\.chatPeer = b\.dataset\.chatOpen/);
  const { html, calls } = await renderWithPeer({ chatOverview: { remote: true, unread: 0, conversations: convs, contacts: convs, labels: [], quickReplies: [], lists: [] },
    chatThread: thread, getOwnerState: {}, getAdvancedSettings: { isAdmin: true } });
  assert.ok(calls.some(c => c[0] === 'chatThread' && c[1] === 'o1'));
  assert.match(html, /chat-quote[^>]*><b>מנהל-העל<\/b> יש לי שאלה/, 'ציטוט ההודעה המקורית');
  assert.match(html, /התשובה &lt;b&gt;כאן&lt;\/b&gt;/, 'HTML מהודעה מוצג כטקסט');
  assert.match(html, /נערכה/);
  assert.match(html, /🚫 ההודעה נמחקה/);
  assert.match(html, /🤖 הודעה אוטומטית/);
  assert.match(html, /<img class="chat-img"[^>]*src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /data:image\/svg/, 'SVG לא מוצג כתמונה');
  assert.match(html, /הקובץ אינו זמין עוד/);
  assert.match(html, /data-chat-edit="r1aaaaaaaa"/, 'עריכה — להודעה שלי בחלון הזמן');
  assert.doesNotMatch(html, /data-chat-edit="q1aaaaaaaa"/);
  assert.match(html, /הערה פנימית/);
  assert.match(html, /03-1234567/);
  assert.match(html, /chatAttachBtn/);
});

// רינדור עם איש קשר פתוח: אחרי הטעינה לוחצים על כפתור איש הקשר
async function renderWithPeer(responses) {
  const ROOT = path.join(__dirname, '..');
  const UI_SRC = fs.readFileSync(path.join(ROOT, 'modules/econ/unified-ui.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(ROOT, 'modules/econ/views/index.html'), 'utf8');
  const VIEWS = [...new Set([...HTML.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]))];
  const elements = {};
  const calls = [];
  const systemAPI = new Proxy({}, { get(_t, name) {
    if (name === 'authStatus') return () => Promise.resolve({ user: { id: 'u1' }, configured: true });
    return (...args) => { calls.push([name, ...args]); return Promise.resolve(name in responses ? responses[name] : {}); };
  } });
  const navButtons = VIEWS.map(v => fakeElement('', { dataset: { view: v } }));
  let openBtn = null;
  const document = { readyState: 'complete', getElementById(id) { return (elements[id] ||= fakeElement(id)); }, querySelector() { return fakeElement(); },
    querySelectorAll(sel) {
      if (sel === '.nav') return navButtons;
      if (sel === '[data-chat-open]') { openBtn = fakeElement('', { dataset: { chatOpen: 'o1' } }); return [openBtn]; }
      return [];
    }, addEventListener() {}, removeEventListener() {}, createElement() { return fakeElement(); }, body: fakeElement() };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context; context.window.systemAPI = systemAPI;
  vm.createContext(context);
  vm.runInContext(UI_SRC, context, { filename: 'unified-ui.js' });
  for (let i = 0; i < 14; i++) await new Promise(r => setImmediate(r));
  navButtons[VIEWS.indexOf('messages')]._listeners.click[0]();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  openBtn._listeners.click[0]();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return { html: elements.view.innerHTML, calls };
}
