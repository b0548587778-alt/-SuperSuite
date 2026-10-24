// רגרסיה — בדיקת הקוד 23.10.2026, קבוצת "הודעות": ממצאים 49, 50, 51, החלק של ההודעות בממצא 26,
// וחלון העריכה/המחיקה מרחוק (נמוך, chat.js:197)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('../shell/licensing/license');
const C = require('../shell/licensing/crypto');
const M = require('../shell/licensing/messages');
const PK = require('../shell/licensing/prekeys');
const { createChatStore, EDIT_WINDOW_MS } = require('../shell/licensing/chat');
const { encryptedChatStorage, webChatStorage } = require('../shell/licensing/chat-storage');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createServer } = require('../server/license-relay');
const AR = require('../modules/econ/core/atRest');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const tmpDirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmpDirs.push(d); return d; };
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// אחסון בזיכרון עם מונים ותקלות לפי בקשה
function memStorage(init = null) {
  const s = { value: init, reads: 0, writes: 0, failRead: null, failWrite: null, asides: [] };
  s.read = () => { s.reads++; if (s.failRead) throw s.failRead; return s.value; };
  s.write = (t) => { if (s.failWrite) throw s.failWrite; s.writes++; s.value = t; };
  return s;
}
const busy = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
// טיימר ידני: הכתיבה המאוחרת רצה רק כשהבדיקה מפעילה אותה
function manualSchedule() {
  const q = [];
  const schedule = (fn) => { q.push(fn); return q.length; };
  schedule.runAll = () => { for (const fn of q.splice(0)) fn(); }; // רק מה שכבר תוזמן (ניסיון חוזר — בסבב הבא)
  schedule.pending = () => q.length;
  return schedule;
}

// מעטפה חתומה ומוצפנת (גרסה 1) עם גוף לבחירת הבדיקה — כמו ששולח עם לקוח ששונה היה בונה
function forgedEnvelope(sender, recipientPub, body) {
  const full = { v: 1, from: L.keyId(sender.privateJwk), to: L.keyId(recipientPub), ...body };
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const secret = C.x25519.scalarMult(C.x25519.fromEdSeed(C.b64uDecode(sender.privateJwk.d)), C.x25519.fromEdPublic(C.b64uDecode(recipientPub.x)));
  const key = C.hkdfSha256(secret, salt, C.utf8('supersuite-message-v1'), 32);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ ...full, sig: L.signObject(full, sender.privateJwk) }), 'utf8'), c.final()]);
  return JSON.stringify({ type: 'supersuite-message', v: 1, from: full.from, to: full.to, salt: C.b64uEncode(salt), iv: C.b64uEncode(iv),
    ct: C.b64uEncode(ct), tag: C.b64uEncode(c.getAuthTag()) });
}

// ---------- ממצא 49 ----------
test('49: הודעה חתומה עם שדות חריגים — open מנקה אותם, ומסך ההודעות והחיפוש ממשיכים לעבוד', () => {
  const a = L.generateKeyPair(), b = L.generateKeyPair();
  const contacts = [{ id: a.keyId, name: 'סניף בני ברק', publicKey: a.publicJwk }];
  const bad = M.open(b.privateJwk, forgedEnvelope(a, b.publicJwk, { kind: 'text', mid: 'abcdefgh1234', sentAt: 5, subject: { x: 1 }, text: 12345 }), contacts);
  assert.equal(typeof bad.text, 'string');
  assert.equal(bad.text, '12345');
  assert.equal(typeof bad.subject, 'string');
  const long = M.open(b.privateJwk, forgedEnvelope(a, b.publicJwk, { kind: 'text', mid: 'abcdefgh5678', sentAt: 6, text: 'א'.repeat(M.MAX_TEXT + 50), subject: 'ב'.repeat(500) }), contacts);
  assert.equal(long.text.length, M.MAX_TEXT, 'אורך מוגבל כמו ב-seal');
  assert.equal(long.subject.length, M.MAX_SUBJECT);

  // מזהה לא תקין, זמן שאינו מספר, סוג לא מוכר וגוף שאינו אובייקט — נדחים
  assert.equal(M.open(b.privateJwk, forgedEnvelope(a, b.publicJwk, { kind: 'text', mid: 12345678, sentAt: 1, text: 'א' }), contacts).mid, '12345678', 'מזהה תמיד מחרוזת');
  for (const body of [{ kind: 'text', mid: 'bad mid!', sentAt: 1, text: 'א' }, { kind: 'text', mid: { x: 1 }, sentAt: 1, text: 'א' },
    { kind: 'text', mid: 'abcdefgh0001', sentAt: '1', text: 'א' }, { kind: 'text', mid: 'abcdefgh0002', text: 'א' },
    { kind: 'text', mid: 'abcdefgh0003', sentAt: null, text: 'א' }, { kind: 'bomb', mid: 'abcdefgh0004', sentAt: 1, text: 'א' }]) {
    assert.throws(() => M.open(b.privateJwk, forgedEnvelope(a, b.publicJwk, body), contacts), /לא תקינה/, JSON.stringify(body));
  }
  // אישור קריאה: רק מזהים תקינים
  const rc = M.open(b.privateJwk, forgedEnvelope(a, b.publicJwk, { kind: 'receipt', mid: 'abcdefgh0005', sentAt: 1, mids: ['abcdefgh0006', 7, { a: 1 }, 'x y'] }), contacts);
  assert.deepEqual(rc.mids, ['abcdefgh0006']);

  // ההודעה (המנוקה) נשמרת ומוצגת; גם החיפוש עובד
  const box = createChatStore({ storage: memStorage(), schedule: manualSchedule() });
  box.addIncoming({ mid: bad.mid, peer: a.keyId, subject: bad.subject, text: bad.text, sentAt: bad.sentAt });
  assert.equal(box.conversations([{ id: a.keyId, name: 'א' }])[0].last.text, '12345');
  assert.equal(box.search('123').length, 1);
});

test('49: תיבה שכבר מכילה הודעה פגומה (לפני התיקון) — המסך, השיחה והחיפוש לא נשברים', () => {
  const stored = JSON.stringify({ v: 2, messages: [
    { mid: 'm1aaaaaaaa', peer: 'p1', dir: 'in', text: 12345, subject: null, sentAt: 'אתמול', read: false, att: { name: 7, type: 'image/png', data: 5 } },
    { mid: 'm2aaaaaaaa', peer: 'p1', dir: 'in', text: { a: 1 }, sentAt: 3, read: true },
    null, 'זבל', { peer: 'p1', text: 'בלי מזהה' },
  ], meta: {}, settings: {} });
  const box = createChatStore({ storage: memStorage(stored), schedule: manualSchedule() });
  const conv = box.conversations([{ id: 'p1', name: 'סניף' }]);
  assert.equal(typeof conv[0].last.text, 'string');
  assert.equal(box.thread('p1').length, 2, 'רשומות בלי מזהה מושמטות');
  assert.ok(box.thread('p1').every(m => typeof m.text === 'string' && Number.isFinite(m.sentAt)));
  assert.doesNotThrow(() => box.search('קובץ'));
  assert.equal(box.search('12345').length, 1);
  assert.equal(box.unreadTotal(), 1);
});

// ---------- ממצא 50 ----------
test('50: קריאה כושלת (קובץ תפוס) — שגיאה בעברית, ושום דבר לא נכתב מעל ההיסטוריה', () => {
  const history = JSON.stringify({ v: 2, messages: [{ mid: 'old1aaaaaa', peer: 'p1', dir: 'in', text: 'הודעה ישנה וחשובה', sentAt: 1, read: true }],
    meta: { p1: { labels: ['paid'], note: 'לקוח ותיק' } }, settings: { autoFetch: true } });
  const st = memStorage(history);
  st.failRead = busy();
  const sched = manualSchedule();
  const box = createChatStore({ storage: st, schedule: sched });
  for (const op of [() => box.addIncoming({ mid: 'new1aaaaaa', peer: 'p1', text: 'חדשה', sentAt: 2 }), () => box.setMeta('p1', { note: 'x' }),
    () => box.saveSettings({}), () => box.thread('p1'), () => box.settings()]) {
    assert.throws(op, (e) => e.code === 'chat-unavailable' && /אינה זמינה/.test(e.message));
  }
  sched.runAll();
  assert.equal(box.flush(), false);
  assert.equal(st.writes, 0, 'לא נכתב דבר');
  assert.equal(st.value, history, 'הקובץ לא נגע');
  // הקובץ השתחרר — הכול חוזר, כולל התוויות וההערה הפנימית
  st.failRead = null;
  assert.equal(box.thread('p1')[0].text, 'הודעה ישנה וחשובה');
  assert.equal(box.meta('p1').note, 'לקוח ותיק');
  assert.equal(box.settings().autoFetch, true);
});

test('50: קובץ פגום — מועבר הצידה (לא נמחק) ומתחילים תיבה חדשה; בלי אפשרות להעביר — לא דורסים', () => {
  const st = memStorage('{"v":2,"messages":[{"mid":"x"');
  st.setAside = () => { st.asides.push(st.value); st.value = null; };
  const box = createChatStore({ storage: st, schedule: manualSchedule() });
  assert.deepEqual(box.thread('p1'), []);
  assert.deepEqual(st.asides, ['{"v":2,"messages":[{"mid":"x"'], 'התוכן הפגום נשמר בצד');
  box.addIncoming({ mid: 'n1aaaaaaaa', peer: 'p1', text: 'שלום', sentAt: 1 });
  box.flush();
  assert.match(st.value, /שלום/);

  const noAside = memStorage('5');
  const box2 = createChatStore({ storage: noAside, schedule: manualSchedule() });
  assert.throws(() => box2.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'א', sentAt: 1 }), (e) => e.code === 'chat-unavailable');
  box2.flush();
  assert.equal(noAside.value, '5');
  assert.equal(noAside.writes, 0);

  // אנדרואיד: התוכן הפגום עובר למפתח צדדי
  const ls = new Map([['supersuite.chat', 'not json']]);
  const web = webChatStorage({ getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) }, 'supersuite.chat', () => 77);
  const box3 = createChatStore({ storage: web, schedule: manualSchedule() });
  assert.deepEqual(box3.thread('p1'), []);
  assert.equal(ls.get('supersuite.chat.unreadable-77'), 'not json');
});

// ---------- ממצא 51 ----------
test('51: התיבה נקראת פעם אחת, ושינויים רבים נכתבים בכתיבה אחת', () => {
  const st = memStorage();
  const sched = manualSchedule();
  const box = createChatStore({ storage: st, schedule: sched, clock: () => 1000 });
  for (let i = 0; i < 40; i++) box.addIncoming({ mid: 'in' + String(i).padStart(8, '0'), peer: 'p1', text: 'הודעה ' + i, sentAt: i });
  box.markRead('p1');
  box.setMeta('p1', { labels: ['paid'] });
  for (let i = 0; i < 20; i++) box.thread('p1');
  box.conversations([{ id: 'p1', name: 'א' }]);
  box.unreadTotal();
  assert.equal(st.reads, 1, 'קריאה אחת מהדיסק');
  assert.equal(st.writes, 0, 'עדיין לא נכתב');
  assert.equal(sched.pending(), 1, 'טיימר אחד לכל השינויים');
  sched.runAll();
  assert.equal(st.writes, 1, 'כתיבה אחת');
  // מה שנכתב הוא התיבה המלאה — מחסן חדש על אותו אחסון רואה הכול
  const again = createChatStore({ storage: st, schedule: manualSchedule() });
  assert.equal(again.thread('p1').length, 40);
  assert.deepEqual(again.meta('p1').labels, ['paid']);
  assert.equal(again.unreadTotal(), 0);
});

test('51: כתיבה שנכשלה נשמרת בזיכרון ומנוסה שוב; ערכים שמוחזרים הם עותק', () => {
  const st = memStorage();
  const sched = manualSchedule();
  const errors = [];
  const box = createChatStore({ storage: st, schedule: sched, onError: (scope) => errors.push(scope) });
  st.failWrite = busy();
  box.addOutgoing({ mid: 'out1aaaaaa', peer: 'p1', text: 'שלום', sentAt: 1 });
  sched.runAll();
  assert.deepEqual(errors, ['chat-write']);
  assert.equal(sched.pending(), 1, 'ניסיון חוזר מתוזמן');
  st.failWrite = null;
  sched.runAll();
  assert.match(st.value, /שלום/);
  const s = box.settings();
  s.labels.length = 0;
  s.profile.name = 'שונה מבחוץ';
  assert.ok(box.settings().labels.length > 0, 'שינוי בעותק לא משנה את התיבה');
  const m = box.get('out1aaaaaa');
  m.text = 'זיוף';
  assert.equal(box.get('out1aaaaaa').text, 'שלום');
});

// ---------- נמוך: חלון עריכה/מחיקה מרחוק ----------
test('עריכה ומחיקה מרחוק: החלון נבדק גם לפי מועד ההגעה — זמנים שהשולח כתב לא מספיקים', () => {
  let now = 50 * DAY;
  const box = createChatStore({ storage: memStorage(), clock: () => now, schedule: manualSchedule() });
  const T0 = now - 2 * MIN;
  box.addIncoming({ mid: 'inAaaaaaaa', peer: 'p1', text: 'מחיר: 100', sentAt: T0, relayAt: T0 });
  // שנה אחר כך: השולח טוען שהעריכה נשלחה דקה אחרי ההודעה — נדחה לפי מועד ההגעה לשרת
  now += 365 * DAY;
  assert.equal(box.applyRemoteEdit('p1', 'inAaaaaaaa', 'מחיר: 1', T0 + MIN, now), false, 'עריכה של הודעה ישנה נדחית');
  assert.equal(box.applyRemoteDelete('p1', 'inAaaaaaaa', T0 + MIN, now), false, 'מחיקה של הודעה ישנה נדחית');
  assert.equal(box.get('inAaaaaaaa').text, 'מחיר: 100');
  // עריכה שהגיעה לשרת בזמן, גם אם המחשב שלנו קיבל אותה מאוחר — מתקבלת
  assert.equal(box.applyRemoteEdit('p1', 'inAaaaaaaa', 'מחיר: 120', T0 + 3 * MIN, T0 + 3 * MIN), true);
  assert.equal(box.get('inAaaaaaaa').text, 'מחיר: 120');
  // זמן שרת בעתיד אינו סביר — נחשב כעכשיו
  box.addIncoming({ mid: 'inBaaaaaaa', peer: 'p1', text: 'שאלה', sentAt: now, relayAt: now + 10 * 365 * DAY });
  assert.equal(box.get('inBaaaaaaa').arrivedAt, now);
  // מחיקה בתוך יומיים — מתקבלת; אחרי — נדחית
  box.addIncoming({ mid: 'inCaaaaaaa', peer: 'p1', text: 'למחיקה', sentAt: now, relayAt: now });
  assert.equal(box.applyRemoteDelete('p1', 'inCaaaaaaa', now + 3 * DAY, now + 3 * DAY), false);
  assert.equal(box.applyRemoteDelete('p1', 'inCaaaaaaa', now + DAY, now + DAY), true);
  // הודעה מלפני התיקון (בלי arrivedAt) — לפי זמן הקבלה אצלנו
  const legacy = createChatStore({ clock: () => now, schedule: manualSchedule(), storage: memStorage(JSON.stringify({ v: 2, messages: [
    { mid: 'oldaaaaaaa', peer: 'p1', dir: 'in', text: 'ישנה', sentAt: now - 30 * DAY, receivedAt: now - 30 * DAY, read: true }] })) });
  assert.equal(legacy.applyRemoteEdit('p1', 'oldaaaaaaa', 'חדשה', now - 30 * DAY + MIN, now), false);
  assert.equal(legacy.applyRemoteDelete('p1', 'oldaaaaaaa', now - 30 * DAY + MIN), false);
  assert.ok(EDIT_WINDOW_MS < DAY);
});

test('אישור קריאה מאיש קשר חל רק על הודעות שנשלחו אליו', () => {
  const box = createChatStore({ storage: memStorage(), schedule: manualSchedule() });
  box.addOutgoing({ mid: 'toP1aaaaaa', peer: 'p1', text: 'א', sentAt: 1 });
  box.addOutgoing({ mid: 'toP2aaaaaa', peer: 'p2', text: 'ב', sentAt: 1 });
  box.setStatus(['toP1aaaaaa', 'toP2aaaaaa'], 'read', 'p1');
  assert.equal(box.get('toP1aaaaaa').status, 'read');
  assert.equal(box.get('toP2aaaaaa').status, 'sent');
});

// ---------- ממצא 26 (ההודעות) ----------
const keyB64 = () => crypto.randomBytes(32).toString('base64');
function storageIn(dir, key, scope = 'system') {
  const getBackupKey = typeof key === 'function' ? key : () => key;
  return encryptedChatStorage({ fs, file: path.join(dir, 'messages.bin'), legacyFile: path.join(dir, 'messages.json'), getBackupKey, scope, clock: () => 4242 });
}

test('26: קובץ ההודעות הגלוי מומר לקובץ מוצפן ונמחק; הכתיבות הבאות מוצפנות', () => {
  const dir = tmp('ss-chat-enc-');
  const legacy = JSON.stringify({ v: 2, messages: [{ mid: 'm1aaaaaaaa', peer: 'p1', dir: 'in', text: 'דוח רווח והפסד של הגמ"ח', sentAt: 1, read: false }], meta: {}, settings: {} });
  fs.writeFileSync(path.join(dir, 'messages.json'), legacy);
  const key = keyB64();
  const box = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  assert.equal(box.thread('p1')[0].text, 'דוח רווח והפסד של הגמ"ח');
  assert.equal(fs.existsSync(path.join(dir, 'messages.json')), false, 'הקובץ הגלוי נמחק אחרי ההמרה');
  const sealed = fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8');
  assert.match(sealed, /^SSDB1:/);
  // לא "p1" לבד: הוא יכול להופיע במקרה בתוך base64 (בדיקה שנכשלה לפעמים)
  assert.doesNotMatch(sealed, /רווח|"peer"|m1aaaaaaaa/);
  box.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'רשימת התורמים מצורפת', sentAt: 2 });
  box.flush();
  const after = fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8');
  assert.doesNotMatch(after, /תורמים/);
  assert.equal(fs.existsSync(path.join(dir, 'messages.json')), false);
  // נפתח שוב באותו מפתח (כמו בהפעלה הבאה)
  const again = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  assert.equal(again.thread('p1').length, 2);
  // מפתח נפרד לתיבת מנהל-העל: אותו קובץ לא נפתח בה
  assert.throws(() => storageIn(dir, key, 'owner').read(), (e) => e.code === 'chat-damaged');
});

test('26: תקלה זמנית במפתח — הקובץ המוצפן לא נדרס; מפתח שאינו מתאים — הקובץ מועבר הצידה ולא נמחק', () => {
  const dir = tmp('ss-chat-key-');
  const key = keyB64();
  const box = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  box.addIncoming({ mid: 'm1aaaaaaaa', peer: 'p1', text: 'שלום', sentAt: 1 });
  box.flush();
  const bin = path.join(dir, 'messages.bin');
  const bytes = fs.readFileSync(bin, 'utf8');

  // תקלה שאינה של המפתח עצמו (קובץ תפוס) — "לא זמינה", ושום דבר לא נכתב
  const busyKey = createChatStore({ storage: storageIn(dir, () => { throw busy(); }), schedule: manualSchedule() });
  assert.throws(() => busyKey.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'x', sentAt: 2 }), (e) => e.code === 'chat-unavailable');
  busyKey.flush();
  assert.equal(fs.readFileSync(bin, 'utf8'), bytes, 'הקובץ המוצפן לא השתנה');
  assert.equal(fs.existsSync(path.join(dir, 'messages.json')), false, 'לא נכתב קובץ גלוי');

  const wrongKey = createChatStore({ storage: storageIn(dir, keyB64()), schedule: manualSchedule() });
  assert.deepEqual(wrongKey.thread('p1'), []);
  assert.equal(fs.readFileSync(bin + '.unreadable-4242', 'utf8'), bytes, 'הקובץ הישן נשמר בצד כמו שהוא');
});

// ---------- סקירה: תיבה שלא נפתחת לעולם ----------
test('סקירה: מפתח הגיבוי אבד בחשבון הזה — הקובץ מועבר הצידה (לא נמחק) והתיבה ממשיכה לעבוד, במקום "לא זמינה" לתמיד', () => {
  for (const code of ['key-unreadable', 'no-key', 'no-encryption']) {
    const dir = tmp('ss-chat-lost-');
    const key = keyB64();
    const first = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
    first.addIncoming({ mid: 'm1aaaaaaaa', peer: 'p1', text: 'שלום', sentAt: 1 });
    first.flush();
    const bin = path.join(dir, 'messages.bin');
    const bytes = fs.readFileSync(bin, 'utf8');

    const errors = [];
    const lost = createChatStore({ storage: storageIn(dir, () => { throw Object.assign(new Error('DPAPI'), { code }); }),
      schedule: manualSchedule(), onError: (scope) => errors.push(scope) });
    assert.doesNotThrow(() => lost.addIncoming({ mid: 'm2aaaaaaaa', peer: 'p1', text: 'הודעה חדשה', sentAt: 2 }), code);
    assert.ok(lost.flush(), code);
    assert.equal(fs.readFileSync(bin + '.unreadable-4242', 'utf8'), bytes, code + ': הקובץ נשמר בצד כמו שהוא — קוד השחזור פותח אותו');
    assert.ok(errors.includes('chat-damaged'), code + ': נרשם ביומן');
    // בלי מפתח — גלוי, כמו המסד (plain-key-unreadable / plain-no-dpapi)
    assert.match(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), /הודעה חדשה/, code);
    // קוד השחזור (המפתח הישן) עדיין פותח את הקובץ שהועבר הצידה
    const back = encryptedChatStorage({ fs, file: bin + '.unreadable-4242', legacyFile: path.join(dir, 'none.json'), getBackupKey: () => key, scope: 'system' });
    assert.match(back.read(), /שלום/);
  }
});

test('26: בלי הצפנת מערכת ובלי קובץ מוצפן — עובדים גלוי כמו קודם (כמו המסד)', () => {
  const dir = tmp('ss-chat-plain-');
  const box = createChatStore({ storage: storageIn(dir, () => { throw Object.assign(new Error('no DPAPI'), { code: 'no-encryption' }); }), schedule: manualSchedule() });
  box.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'שלום', sentAt: 1 });
  box.flush();
  assert.match(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), /שלום/);
  assert.equal(fs.existsSync(path.join(dir, 'messages.bin')), false);
  // כשההצפנה זמינה — ההמרה קורית בקריאה הבאה
  const key = keyB64();
  const later = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  assert.equal(later.thread('p1')[0].text, 'שלום');
  assert.equal(fs.existsSync(path.join(dir, 'messages.json')), false);
  assert.match(fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8'), /^SSDB1:/);
});

test('26: initEcon מצפין את תיבות ההודעות במפתח הגיבוי שמגיע מ-main.js, ו-flushChat מיוצא', () => {
  const dir = tmp('ss-chat-ipc-');
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify({ v: 2, messages: [{ mid: 'm1aaaaaaaa', peer: 'p1', dir: 'in', text: 'רשימת נזקקים', sentAt: 1, read: false }] }));
  const script = `
const Module = require('module');
const handlers = {};
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__e_chat__.js' : orig.call(this, req, ...rest); };
require.cache['/__e_chat__.js'] = { id: '/__e_chat__.js', filename: '/__e_chat__.js', loaded: true, exports: { ipcMain: { handle: (c, f) => { handlers[c] = f; } } } };
const ipc = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'econ', 'ipc'))});
const key = ${JSON.stringify(keyB64())};
(async () => {
  await ipc.initEcon(${JSON.stringify(dir)}, { getBackupKey: () => key, relayUrl: '' });
  const ev = { sender: { id: 5 } };
  await handlers['auth:setup'](ev, 'admin_first', 'a-very-long-pass-2026');
  const ov = await handlers['chat:overview'](ev, '', 'all');
  ipc.flushChat();
  process.stdout.write(JSON.stringify({ ok: true, unread: ov.unread, flush: typeof ipc.flushChat }));
})().catch(e => { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message) })); });
`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 });
  const out = JSON.parse(r.stdout || '{}');
  assert.equal(out.ok, true, r.stderr + (out.error || ''));
  assert.equal(out.unread, 1);
  assert.equal(out.flush, 'function');
  assert.equal(fs.existsSync(path.join(dir, 'messages.json')), false, 'הקובץ הגלוי הומר');
  const sealed = fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8');
  assert.match(sealed, /^SSDB1:/);
  assert.doesNotMatch(sealed, /נזקקים/);
});

// ---------- סקירה: קובץ גלוי שנשאר ליד המוצפן ----------
const msg = (mid, text, sentAt) => ({ mid, peer: 'p1', dir: 'in', text, sentAt, receivedAt: sentAt, read: false });
test('סקירה: גרסה ישנה כתבה messages.json אחרי ההמרה — ההודעה שלה מוצגת ונשמרת גם אחרי כתיבה והפעלות נוספות', () => {
  const dir = tmp('ss-chat-newer-');
  const key = keyB64();
  const plainFile = path.join(dir, 'messages.json');
  fs.writeFileSync(plainFile, JSON.stringify({ v: 2, messages: [msg('m1aaaaaaaa', 'ישנה', 1)], meta: {}, settings: {} }));
  // הפעלה 1: ההמרה
  assert.equal(createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() }).thread('p1').length, 1);
  assert.equal(fs.existsSync(plainFile), false);
  // גרסה ישנה רצה (התחילה מתיבה ריקה — הגלוי נמחק), קיבלה הודעה ואישרה אותה לשרת
  fs.writeFileSync(plainFile, JSON.stringify({ v: 2, messages: [msg('m2aaaaaaaa', 'קיבלה הגרסה הישנה', 5)],
    meta: { p2: { labels: [], note: 'לקוח מהגרסה הישנה' } }, settings: { autoFetch: true } }));
  // הפעלה 2: ההודעה מוצגת, הגלוי נמחק רק אחרי שהתיבה הממוזגת נכתבה
  const box2 = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  assert.deepEqual(box2.thread('p1').map(m => m.text), ['ישנה', 'קיבלה הגרסה הישנה']);
  assert.equal(box2.meta('p2').note, 'לקוח מהגרסה הישנה');
  assert.equal(box2.settings().autoFetch, false, 'ההגדרות — של התיבה המוצפנת');
  assert.equal(fs.existsSync(plainFile), false, 'הגלוי נמחק אחרי המיזוג');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8'), /הגרסה הישנה/);
  box2.markRead('p1');
  box2.flush();
  // הפעלה 3: עדיין שם, בלי כפילות
  const box3 = createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() });
  assert.deepEqual(box3.thread('p1').map(m => m.text), ['ישנה', 'קיבלה הגרסה הישנה']);
  assert.equal(box3.unreadTotal(), 0);
});

test('סקירה: גלוי שנשאר אחרי ההמרה (המחיקה נכשלה) — נמחק בלי כפילויות; גלוי פגום — הצידה, לא נמחק', () => {
  const dir = tmp('ss-chat-left-');
  const key = keyB64();
  const plainFile = path.join(dir, 'messages.json');
  const legacy = JSON.stringify({ v: 2, messages: [msg('m1aaaaaaaa', 'ישנה', 1)] });
  fs.writeFileSync(plainFile, legacy);
  createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() }).thread('p1');
  fs.writeFileSync(plainFile, legacy); // כאילו המחיקה נכשלה
  const st = storageIn(dir, key);
  let writes = 0;
  const write = st.write;
  st.write = (t) => { writes++; write(t); };
  const box = createChatStore({ storage: st, schedule: manualSchedule() });
  assert.equal(box.thread('p1').length, 1, 'בלי כפילות');
  assert.equal(writes, 0, 'אין מה להוסיף — לא נכתב');
  assert.equal(fs.existsSync(plainFile), false);

  fs.writeFileSync(plainFile, '{"v":2,"messages":[');
  assert.equal(createChatStore({ storage: storageIn(dir, key), schedule: manualSchedule() }).thread('p1').length, 1);
  assert.equal(fs.readFileSync(plainFile + '.unreadable-4242', 'utf8'), '{"v":2,"messages":[');
});

test('סקירה: המוצפן לא נפתח (מפתח אחר) ויש לידו גלוי — הגלוי הוא ההיסטוריה, ולא נמחק בכתיבה הראשונה', () => {
  const dir = tmp('ss-chat-aside-legacy-');
  const oldKey = keyB64(), newKey = keyB64();
  const plainFile = path.join(dir, 'messages.json');
  const box = createChatStore({ storage: storageIn(dir, oldKey), schedule: manualSchedule() });
  box.addIncoming({ mid: 'm9aaaaaaaa', peer: 'p1', text: 'מוצפנת', sentAt: 9 });
  box.flush();
  fs.writeFileSync(plainFile, JSON.stringify({ v: 2, messages: [msg('m1aaaaaaaa', 'היסטוריה גלויה', 1)] }));
  const bytes = fs.readFileSync(path.join(dir, 'messages.bin'), 'utf8');

  const box2 = createChatStore({ storage: storageIn(dir, newKey), schedule: manualSchedule() });
  assert.deepEqual(box2.thread('p1').map(m => m.text), ['היסטוריה גלויה']);
  box2.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'תשובה', sentAt: 10 });
  box2.flush();
  const box3 = createChatStore({ storage: storageIn(dir, newKey), schedule: manualSchedule() });
  assert.deepEqual(box3.thread('p1').map(m => m.text), ['היסטוריה גלויה', 'תשובה'], 'ההיסטוריה נשארה אחרי כתיבה והפעלה נוספת');
  assert.equal(fs.existsSync(plainFile), false, 'הומר להצפנה');
  assert.equal(fs.readFileSync(path.join(dir, 'messages.bin.unreadable-4242'), 'utf8'), bytes, 'המוצפן הישן בצד');
});

// ---------- סקירה: אנדרואיד ----------
function fakeLs({ quota = Infinity } = {}) {
  const m = new Map();
  const size = () => [...m.values()].reduce((n, v) => n + v.length, 0);
  return { m, failNext: null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
      if (size() - (m.has(k) ? m.get(k).length : 0) + String(v).length > quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k) };
}
test('סקירה (אנדרואיד): תוכן פגום כשהמכסה מלאה — התיבה לא נתקעת', () => {
  const ls = fakeLs({ quota: 30 });
  ls.m.set('supersuite.chat', '{"broken": [ 1, 2, 3, 4, 5');
  const errors = [];
  const box = createChatStore({ storage: webChatStorage(ls, 'supersuite.chat', () => 1, (scope) => errors.push(scope)), schedule: manualSchedule() });
  assert.deepEqual(box.thread('p1'), []);
  assert.ok(errors.includes('chat-damaged'), 'נרשם ביומן');
  assert.equal(ls.getItem('supersuite.chat'), null);
});

test('סקירה (אנדרואיד): writeDelayMs: 0 — כל שינוי נמצא באחסון מיד אחרי הפעולה; כשל — ניסיון חוזר בלי לולאה', () => {
  const ls = fakeLs();
  const sched = manualSchedule();
  const errors = [];
  const box = createChatStore({ storage: webChatStorage(ls, 'supersuite.chat'), schedule: sched, writeDelayMs: 0, onError: (s) => errors.push(s) });
  box.addOutgoing({ mid: 'o1aaaaaaaa', peer: 'p1', text: 'נשלחה לשרת', sentAt: 1 });
  assert.match(ls.getItem('supersuite.chat'), /נשלחה לשרת/);
  box.saveSettings({ profile: { name: 'גמ"ח חסדי אבות' } });
  assert.match(ls.getItem('supersuite.chat'), /חסדי אבות/);
  assert.equal(sched.pending(), 0, 'בלי טיימר');
  ls.failNext = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
  box.setMeta('p1', { note: 'הערה' });
  assert.deepEqual(errors, ['chat-write']);
  assert.equal(sched.pending(), 1, 'ניסיון חוזר אחד');
  box.markRead('p1'); // שינוי נוסף — נכתב מיד, יחד עם ההערה
  assert.match(ls.getItem('supersuite.chat'), /הערה/);
});

// מריץ קוד מול ipc.js בתהליך נפרד (ה-electron המדומה וה-window לא נוגעים בתהליך הבדיקות)
function runIpc(body, { android = false } = {}) {
  const script = `
const Module = require('module');
const handlers = {};
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__e_chat2__.js' : orig.call(this, req, ...rest); };
require.cache['/__e_chat2__.js'] = { id: '/__e_chat2__.js', filename: '/__e_chat2__.js', loaded: true, exports: { ipcMain: { handle: (c, f) => { handlers[c] = f; } } } };
const lsMap = new Map();
if (${android}) global.window = { localStorage: { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) } };
global.setTimeout = ((st) => (fn, ms, ...r) => (ms === 300 ? { unref() {} } : st(fn, ms, ...r)))(global.setTimeout); // הכתיבה המאוחרת לא רצה
const ipc = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'econ', 'ipc'))});
(async () => { const out = await (async () => { ${body} })(); process.stdout.write('RESULT' + JSON.stringify({ ok: true, ...out })); })()
  .catch(e => { process.stdout.write('RESULT' + JSON.stringify({ ok: false, error: String(e && e.stack) })); });
`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  const out = JSON.parse(r.stdout.slice(i + 6));
  assert.equal(out.ok, true, out.error);
  return out;
}

test('סקירה (אנדרואיד): initEcon — שמירת הגדרות בתיבה נמצאת ב-localStorage מיד, בלי לחכות לטיימר', () => {
  const dir = tmp('ss-chat-android-');
  const out = runIpc(`
    await ipc.initEcon(${JSON.stringify(dir)}, { relayUrl: '' });
    const ev = { sender: { id: 5 } };
    await handlers['auth:setup'](ev, 'admin_first', 'a-very-long-pass-2026');
    await handlers['chat:saveSettings'](ev, { profile: { name: 'קופת צדקה אור' } });
    return { stored: lsMap.get('supersuite.chat') || '' };`, { android: true });
  assert.match(out.stored, /קופת צדקה אור/);
});

test('סקירה: initEcon ממיר את קבצי ההודעות הגלויים בעלייה — גם אופליין ובלי לפתוח את מסך ההודעות', () => {
  const dir = tmp('ss-chat-boot-');
  fs.mkdirSync(path.join(dir, 'owner'));
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify({ v: 2, messages: [msg('m1aaaaaaaa', 'רשימת תורמים', 1)] }));
  fs.writeFileSync(path.join(dir, 'owner', 'messages.json'), JSON.stringify({ v: 2, messages: [msg('m2aaaaaaaa', 'פרטי לקוח', 1)] }));
  const key = keyB64();
  runIpc(`await ipc.initEcon(${JSON.stringify(dir)}, { getBackupKey: () => ${JSON.stringify(key)}, relayUrl: '' }); return {};`);
  for (const sub of ['', 'owner']) {
    assert.equal(fs.existsSync(path.join(dir, sub, 'messages.json')), false, sub + ': לא נשאר גלוי');
    const sealed = fs.readFileSync(path.join(dir, sub, 'messages.bin'), 'utf8');
    assert.match(sealed, /^SSDB1:/);
    assert.doesNotMatch(sealed, /תורמים|לקוח/);
  }
});

// ---------- 50 + 51 דרך שרת אמיתי: הודעה לא מאושרת לשרת לפני שנשמרה ----------
test('קבלה: תיבה שלא נקראה או כתיבה שנכשלה — ההודעה נשארת בשרת ומתקבלת פעם אחת בסנכרון הבא', async () => {
  const dataDir = tmp('ss-chat-ack-');
  let now = Date.now();
  const server = createServer({ dataDir, clock: () => now });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
  const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init('menahel-al-chat-2026').publicKey];
    const ownerStore = createLicenseStore({ storage: one(), secret: one(), rootKeys });
    ownerStore.setRemoteSettings({ url });
    const ownerChat = createChatStore({ storage: memStorage(), clock: () => now });
    const O = createLicenseSync({ store: ownerStore, owner, rootKeys, fetchImpl: fetch, chat: createChatStore({ storage: memStorage() }), ownerChat,
      clock: () => now, prekeys: PK.createPrekeyStore({ storage: one() }), ownerPrekeys: PK.createPrekeyStore({ storage: one() }) });
    const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
    store.setRemoteSettings({ url });
    const st = memStorage();
    const chat = createChatStore({ storage: st, clock: () => now, schedule: manualSchedule() });
    const pks = PK.createPrekeyStore({ storage: one() });
    const T = createLicenseSync({ store, owner: null, rootKeys, fetchImpl: fetch, chat, clock: () => now, prekeys: pks });
    await T.sendLicenseRequest('ישיבת אור התורה');
    await O.ownerReceive();
    const req = owner.takeFromInbox(owner.inbox()[0].id);
    await O.ownerReply(req.from, 'license', owner.issue({ request: req.body, features: ['econ'], limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 10, maxDepth: 1 } }).package);
    await T.receive();
    const me = store.syncInfo().nodeId;
    const ops = O.chatOps(true);

    // 1. הקובץ תפוס בזמן הקבלה — ההודעה לא אושרה ולא אבדה
    await ops.send(me, { text: 'חג שמח לכל הצוות' });
    st.failRead = busy();
    const r1 = await T.receive();
    assert.ok(r1.errors.some(e => /אינה זמינה/.test(e)), JSON.stringify(r1.errors));
    st.failRead = null;
    await T.receive();
    const ownerId = T.myContacts().find(c => c.role === 'owner').id;
    assert.deepEqual(chat.thread(ownerId).map(m => m.text), ['חג שמח לכל הצוות']);
    assert.match(st.value, /חג שמח/, 'נשמר בדיסק לפני האישור לשרת');

    // 2. הכתיבה נכשלת — ההודעה לא מאושרת, ומתקבלת שוב בלי כפילות
    now += MIN;
    await ops.send(me, { text: 'תזכורת: ישיבת הנהלה ביום שלישי' });
    st.failWrite = busy();
    await T.receive();
    st.failWrite = null;
    await T.receive();
    await T.receive();
    assert.deepEqual(chat.thread(ownerId).map(m => m.text), ['חג שמח לכל הצוות', 'תזכורת: ישיבת הנהלה ביום שלישי']);
    assert.match(st.value, /ישיבת הנהלה/);

    // 3. (סקירה) מפתח ההצפנה של התיבה אבד בחשבון הזה — ההודעה נשמרת ומאושרת, ולא נערמת בשרת לתמיד
    //    (מעבר למכסה של שולח אחד השרת דוחה גם חבילות רישיון מאותו שולח)
    const lostDir = tmp('ss-chat-lost-sync-');
    const first = createChatStore({ storage: storageIn(lostDir, keyB64()), schedule: manualSchedule() });
    first.addIncoming({ mid: 'm1aaaaaaaa', peer: 'p1', text: 'היסטוריה', sentAt: 1 });
    first.flush();
    const lostBox = createChatStore({ storage: storageIn(lostDir, () => { throw Object.assign(new Error('DPAPI'), { code: 'key-unreadable' }); }),
      clock: () => now, schedule: manualSchedule() });
    const T2 = createLicenseSync({ store, owner: null, rootKeys, fetchImpl: fetch, chat: lostBox, clock: () => now, prekeys: pks });
    now += MIN;
    await ops.send(me, { text: 'ברכת מזל טוב' });
    const r3 = await T2.receive();
    assert.deepEqual(r3.errors, []);
    assert.deepEqual(lostBox.thread(ownerId).map(m => m.text), ['ברכת מזל טוב']);
    assert.equal((await T2.receive()).handled, 0, 'אושרה — לא נשארה בשרת');
    assert.ok(fs.existsSync(path.join(lostDir, 'messages.bin.unreadable-4242')), 'ההיסטוריה המוצפנת נשמרה בצד');
  } finally { await new Promise(r => server.close(r)); }
});

// ---------- סקירה: main.js האמיתי — יציאה והפעלה מחדש אחרי קריסה כותבות את מה שממתין בתיבה ----------
// הכתיבה המאוחרת (300ms) לא רצה בתהליך הזה; מה שנמצא בקובץ נכתב רק דרך will-quit / beforeExit של הקריסה
test('סקירה: will-quit ו"הפעלה מחדש" אחרי קריסה ב-main.js כותבים את השינוי האחרון בתיבה לפני הטיימר', () => {
  const dir = tmp('ss-chat-main-');
  const KEY = keyB64();
  fs.writeFileSync(path.join(dir, 'autobackup.key'), Buffer.from('K:' + KEY));
  fs.writeFileSync(path.join(dir, 'backup-settings.json'), JSON.stringify({ targetDir: path.join(dir, 'bk') }));
  fs.writeFileSync(path.join(dir, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
  const bin = path.join(dir, 'messages.bin');
  const script = `
const Module = require('module'), fs = require('fs');
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => (k in p ? p[k] : (k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => 0 : ch()))), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
const read = () => (fs.existsSync(${JSON.stringify(bin)}) ? fs.readFileSync(${JSON.stringify(bin)}, 'utf8') : null);
let ready = null, uncaught = null, atExit = null, nextView = 100;
const appOn = {}, ipc = {}, views = [];
class Win { constructor() { this.contentView = { addChildView() {} }; this.webContents = ch({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; } on() {} once() {} removeMenu() {} loadFile() { return Promise.resolve(); } maximize() {} show() {} focus() {} close() {} destroy() {}
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; } getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); } getContentSize() { return [1500, 940]; } }
class View { constructor(opts = {}) { this.opts = opts; const id = nextView++; this.id = id; views.push(this);
  this.webContents = ch({ id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {}, loadURL() {}, executeJavaScript: async () => '{}', executeJavaScriptInIsolatedWorld: async () => '{}' }); }
  setVisible() {} setBounds() {} }
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch() {} }; } }),
    getPath: () => ${JSON.stringify(dir)}, on: (ev, fn) => { (appOn[ev] = appOn[ev] || []).push(fn); },
    exit: () => { atExit = read(); }, quit() {}, relaunch() {}, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: Win, WebContentsView: View,
  ipcMain: { handle: (c, fn) => { ipc[c] = fn; }, on: (c, fn) => { ipc[c] = fn; }, removeHandler() {} },
  dialog: { showMessageBox: async (a, b) => { const o = b || a; return { response: o.message === 'אירעה תקלה בלתי צפויה' ? 2 : (o.buttons || []).length - 1 }; },
    showErrorBox() {}, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: ch(), net: ch(), session: ch(), shell: ch({ openPath: () => {} }), Menu: ch(), safeStorage: ss
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? '/__e_chat_main__.js' : orig.call(this, r, ...a); };
require.cache['/__e_chat_main__.js'] = { id: '/__e_chat_main__.js', filename: '/__e_chat_main__.js', loaded: true, exports: stub };
global.setTimeout = ((st) => (fn, ms, ...r) => ((ms === 300 || ms === 15000) ? { unref() {}, ref() {} } : st(fn, ms, ...r).unref()))(global.setTimeout);
global.setInterval = ((si) => (fn, ms, ...r) => si(fn, ms, ...r).unref())(global.setInterval);
const origOn = process.on;
process.on = function (ev, fn) { if (ev === 'uncaughtException') { uncaught = fn; return process; } if (ev === 'unhandledRejection') return process; return origOn.call(this, ev, fn); };
try { require(${JSON.stringify(path.join(__dirname, '..', 'main.js'))}); } finally { process.on = origOn; }
(async () => {
  await ready();
  const shell = { sender: { id: 1 } };
  await ipc['shell:switch'](shell, 'econ');
  const econ = views.find(v => /econ[\\\\/]preload\\.js$/.test((v.opts.webPreferences || {}).preload || ''));
  const ev = { sender: { id: econ.id } };
  await ipc['auth:setup'](ev, 'menahel', 'menahel-pass-long-1');
  await ipc['chat:saveSettings'](ev, { profile: { name: 'שלב א' } });
  const beforeQuit = read();
  (appOn['will-quit'] || []).forEach(f => f());
  const afterQuit = read();
  await ipc['chat:saveSettings'](ev, { profile: { name: 'שלב ב' } });
  const beforeCrash = read();
  uncaught(new Error('תקלה לדוגמה'));
  for (let i = 0; i < 200 && atExit === null; i++) await new Promise(r => setImmediate(r));
  process.stdout.write('RESULT' + JSON.stringify({ beforeQuit, afterQuit, beforeCrash, atExit, quitHandlers: (appOn['will-quit'] || []).length }));
  process.exit(0);
})().catch(e => { process.stdout.write('RESULT' + JSON.stringify({ fatal: String(e && e.stack) })); process.exit(0); });
`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  const out = JSON.parse(r.stdout.slice(i + 6));
  assert.ok(!out.fatal, out.fatal);
  assert.ok(out.quitHandlers > 0);
  const cipher = AR.createCipher(AR.deriveDbKey(KEY, 'SuperSuite chat store v1:system'));
  const nameIn = (text) => (text ? JSON.parse(cipher.open(text)).settings.profile.name : null);
  assert.notEqual(nameIn(out.beforeQuit), 'שלב א', 'הטיימר לא רץ — עוד לא נכתב');
  assert.equal(nameIn(out.afterQuit), 'שלב א', 'will-quit כתב את מה שממתין');
  assert.equal(nameIn(out.beforeCrash), 'שלב א');
  assert.equal(nameIn(out.atExit), 'שלב ב', 'app.exit מדלג על will-quit — התיבה נכתבה לפני');
});
