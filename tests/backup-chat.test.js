// תיבת ההודעות בגיבוי המלא ובשחזור המלא (החלטת הבעלים): הודעות, תוויות, הערות פנימיות והגדרות העסק; תוכן הקבצים
// המצורפים עד תקרה (מעבר לה — רק פרטי הקובץ). גיבוי לא חלקי: תיבה שלא נקראה ← module-read-failed. שחזור: בדיקה לפני
// כל שינוי, החזרה למצב שלפני בכשל, גיבוי ישן בלי הודעות לא נוגע בתיבה, ותיבת מנהל-העל לא בגיבוי ולא משתנה.
// main.js האמיתי נטען עם Electron מדומה (כמו tests/audit-backup-startup.test.js); main-android.js — עם מודול כלכלי מדומה
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const BK = require('../modules/econ/core/backupCrypto');
const Chat = require('../shell/licensing/chat');
const { createChatStore, mailboxFromBackup, BACKUP_ATTACHMENT_CHARS } = Chat;
const { encryptedChatStorage, webChatStorage } = require('../shell/licensing/chat-storage');

const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bk-chat-' + p + '-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* מסד שעוד פתוח */ } } });

const PASS = 'sismat-gibui-aruka-2026';
const PEER = 'snifBneiBrak0000000001';
const PEER2 = 'gemachElad000000000002';
const busy = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
// שעון נשלט: זמן הקבלה של הודעה נכנסת קובע את מקומה בתיבה
let NOW = 1000;
const clock = () => NOW;
// טיימר ידני — הכתיבה המאוחרת לא רצה ברקע
const manual = () => { const q = []; const s = (fn) => { q.push(fn); return q.length; }; s.q = q; return s; };
function memStorage(init = null) {
  const s = { value: init, failWrite: null };
  s.read = () => s.value;
  s.write = (t) => { if (s.failWrite) throw s.failWrite; s.value = t; };
  return s;
}
// תיבה עם הודעות, קבצים, תוויות, הערה פנימית והגדרות עסק
function seedBox(box, t0 = 1000) {
  NOW = t0;
  box.addIncoming({ mid: 'in-old-0001', peer: PEER, text: 'בקשה לקבלה על תרומה', sentAt: t0,
    att: { name: 'אישור-העברה.pdf', type: 'application/pdf', size: 6, data: 'JVBERi0xLjQ=' } });
  box.addOutgoing({ mid: 'out-0001', peer: PEER, text: 'הקבלה תישלח מחר בעזרת השם', sentAt: t0 + 10,
    att: { name: 'קבלה.pdf', type: 'application/pdf', size: 3, data: 'QUJDREVG' } });
  box.saveSettings({ ...box.settings(), profile: { name: 'קופת צדקה בני ברק', about: 'קופה שכונתית', address: 'רחוב רבי עקיבא 1, בני ברק', phone: '03-5555555', email: '', website: '' },
    quickReplies: [{ shortcut: 'kabala', text: 'הקבלה נשלחה, תזכו למצוות' }], away: { enabled: true, text: 'נחזור אחרי השבת', always: false } });
  box.setMeta(PEER, { labels: ['pay'], note: 'תורם קבוע — לברר כתובת למשלוח', pinned: true });
}

/* ================= chat.js: ייצוא, בדיקה ושחזור ================= */

test('ייצוא: הודעות, תוויות, הערה פנימית והגדרות העסק; קבצים עד התקרה — החדשים קודם, ומעבר לה רק פרטי הקובץ', () => {
  const box = createChatStore({ storage: memStorage(), schedule: manual(), clock });
  seedBox(box);
  const full = box.exportMailbox();
  assert.deepEqual(full.messages.map(m => [m.mid, m.dir, m.text]), [
    ['in-old-0001', 'in', 'בקשה לקבלה על תרומה'], ['out-0001', 'out', 'הקבלה תישלח מחר בעזרת השם']]);
  assert.deepEqual(full.messages.map(m => m.att.data), ['JVBERi0xLjQ=', 'QUJDREVG']);
  assert.deepEqual(full.meta[PEER].labels, ['pay']);
  assert.equal(full.meta[PEER].note, 'תורם קבוע — לברר כתובת למשלוח');
  assert.equal(full.settings.profile.name, 'קופת צדקה בני ברק');
  assert.deepEqual(full.settings.quickReplies, [{ shortcut: 'kabala', text: 'הקבלה נשלחה, תזכו למצוות' }]);
  assert.equal(full.settings.away.text, 'נחזור אחרי השבת');
  // תקרה של 8 תווים: הקובץ החדש (8 תווים) נכנס, הישן — רק השם, הסוג והגודל
  const capped = box.exportMailbox({ attachmentChars: 8 });
  assert.deepEqual(capped.messages[1].att, { name: 'קבלה.pdf', type: 'application/pdf', size: 3, data: 'QUJDREVG' });
  assert.deepEqual(capped.messages[0].att, { name: 'אישור-העברה.pdf', type: 'application/pdf', size: 6, data: null, omitted: true });
  // עותק — שינוי בו לא נוגע בתיבה
  capped.messages[0].text = 'שונה';
  assert.equal(box.exportMailbox().messages[0].text, 'בקשה לקבלה על תרומה');
  assert.ok(BACKUP_ATTACHMENT_CHARS > 0 && BACKUP_ATTACHMENT_CHARS < 40 * 1024 * 1024, 'תקרה קטנה מהתקרה של התיבה עצמה');
});

test('ייצוא: תיבה שלא נקראה (קובץ תפוס) ← שגיאה, לא תיבה ריקה; מה שעוד בזיכרון נכתב לפני העותק', () => {
  const st = memStorage();
  st.read = () => { throw busy(); };
  const box = createChatStore({ storage: st, schedule: manual() });
  assert.throws(() => box.exportMailbox(), (e) => e.code === 'chat-unavailable');
  const st2 = memStorage();
  const sched = manual();
  const box2 = createChatStore({ storage: st2, schedule: sched });
  box2.addIncoming({ mid: 'in-0002', peer: PEER, text: 'שלום', sentAt: 5 });
  assert.equal(st2.value, null, 'עוד לא נכתב (כתיבה מאוחרת)');
  assert.equal(box2.exportMailbox().messages.length, 1);
  assert.equal(JSON.parse(st2.value).messages.length, 1, 'flush לפני הקריאה');
});

test('בדיקת הגיבוי: מבנה לא תקין ← שגיאה בעברית; הודעה פגומה או כפולה מדולגת; הגדרה פגומה ← ברירת המחדל שלה בלבד', () => {
  for (const bad of ['טקסט', 5, null, { messages: 'x' }, { messages: [], meta: [] }, { messages: [], settings: 'x' }]) {
    assert.throws(() => mailboxFromBackup(bad), /נתוני ההודעות בקובץ הגיבוי אינם תקינים/, JSON.stringify(bad));
  }
  const raw = JSON.parse(`{"messages":[
    {"mid":"in-0001","peer":"${PEER}","dir":"in","text":"תקינה","sentAt":1},
    {"mid":"in-0001","peer":"${PEER}","dir":"in","text":"כפולה","sentAt":2},
    {"mid":"x-0002","peer":"${PEER}","dir":"sideways","text":"כיוון לא מוכר","sentAt":3},
    {"peer":"${PEER}","dir":"in","text":"בלי מזהה"},
    {"mid":"in-0003","peer":"${PEER}","dir":"in","text":${JSON.stringify('א'.repeat(9000))},"sentAt":4}],
    "meta":{"${PEER}":{"labels":["pay","no-such-label"],"note":"הערה","pinned":true,"evil":"x"},"__proto__":{"labels":[]}},
    "settings":{"profile":{"name":"גמ\\"ח חסדי אבות","website":"http://x"},"quickReplies":[{"shortcut":"shalom","text":"שלום וברכה"}],"hours":"כל הזמן"}}`);
  const clean = mailboxFromBackup(raw);
  assert.deepEqual(clean.messages.map(m => m.mid), ['in-0001', 'in-0003']);
  assert.equal(clean.messages[0].text, 'תקינה', 'הראשונה נשמרת');
  assert.equal(clean.messages[1].text.length, 4000, 'אורך מוגבל');
  assert.deepEqual(clean.meta[PEER], { labels: ['pay'], pinned: true, note: 'הערה' });
  assert.equal(Object.getPrototypeOf(clean.meta), Object.prototype, '__proto__ לא משנה את האובייקט');
  assert.equal(Object.keys(clean.meta).length, 1);
  // פרופיל עם כתובת אתר לא תקינה ← הפרופיל הריק; תשובות מהירות תקינות נשמרות; שעות לא תקינות ← ברירת המחדל
  assert.equal(clean.settings.profile.name, '');
  assert.deepEqual(clean.settings.quickReplies, [{ shortcut: 'shalom', text: 'שלום וברכה' }]);
  assert.equal(clean.settings.hours.length, 7);
  // פורמט ישן של התיבה (מערך הודעות)
  assert.equal(mailboxFromBackup([{ mid: 'in-0009', peer: PEER, dir: 'in', text: 'ישן', sentAt: 1 }]).messages.length, 1);
});

test('שחזור: התיבה מהגיבוי מחליפה את הנוכחית, הודעות שיש רק כאן נשמרות, וקובץ שלא נכלל בגיבוי — מהתיבה הנוכחית', () => {
  const st = memStorage();
  const box = createChatStore({ storage: st, schedule: manual(), clock });
  seedBox(box);
  const backup = mailboxFromBackup(box.exportMailbox({ attachmentChars: 8 })); // הקובץ הישן לא בגיבוי
  // אחרי הגיבוי: הודעה חדשה, תווית חדשה, הערה והגדרות אחרות
  NOW = 5000;
  box.addIncoming({ mid: 'in-new-0002', peer: PEER2, text: 'הגיעה אחרי הגיבוי', sentAt: 5000 });
  box.saveSettings({ ...box.settings(), profile: { ...box.settings().profile, name: 'שם אחר' },
    labels: [...box.settings().labels, { id: 'vip', name: 'תורם חשוב', color: '#2563eb' }] });
  box.setMeta(PEER, { labels: ['done'], note: 'שונתה אחרי הגיבוי' });
  box.setMeta(PEER2, { labels: ['new', 'vip'], note: 'איש קשר חדש' });
  assert.equal(box.restoreMailbox(backup).kept, 1);
  const again = createChatStore({ storage: memStorage(st.value), schedule: manual() }); // נכתב מיד
  assert.deepEqual(again.exportMailbox().messages.map(m => m.mid), ['in-old-0001', 'out-0001', 'in-new-0002']);
  assert.equal(again.attachment('in-old-0001').data, 'JVBERi0xLjQ=', 'התוכן הושלם מהתיבה הנוכחית');
  assert.equal(again.meta(PEER).note, 'תורם קבוע — לברר כתובת למשלוח');
  assert.deepEqual(again.meta(PEER).labels, ['pay']);
  assert.deepEqual(again.meta(PEER2).labels, ['new'], 'נתוני שיחה של איש קשר שאינו בגיבוי נשמרים — רק עם תוויות שקיימות בגיבוי');
  assert.equal(again.meta(PEER2).note, 'איש קשר חדש');
  assert.ok(!again.settings().labels.some(l => l.id === 'vip'));
  assert.equal(again.settings().profile.name, 'קופת צדקה בני ברק');
  // קובץ שלא בגיבוי ואינו בתיבה — "אינו זמין", לא קריסה
  const fresh = createChatStore({ storage: memStorage(), schedule: manual(), clock });
  fresh.restoreMailbox(backup);
  assert.equal(fresh.thread(PEER)[0].att.available, false);
  assert.throws(() => fresh.attachment('in-old-0001'), /אינו זמין/);
});

test('שחזור: כתיבה שנכשלה נזרקת; ההחזרה (except) מחזירה את המצב שלפני — בלי מה שהגיע מהגיבוי, עם מה שהגיע בינתיים', () => {
  const st = memStorage();
  const box = createChatStore({ storage: st, schedule: manual(), clock });
  seedBox(box);
  const before = box.exportMailbox();
  const backup = mailboxFromBackup({ messages: [{ mid: 'in-bk-0001', peer: PEER, dir: 'in', text: 'רק בגיבוי', sentAt: 1 }],
    meta: { [PEER2]: { labels: [], note: 'רק בגיבוי' } }, settings: { profile: { name: 'מהגיבוי' } } });
  const onDisk = st.value;
  st.failWrite = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  assert.throws(() => box.restoreMailbox(backup), /disk full/);
  assert.equal(st.value, onDisk, 'הדיסק לא השתנה');
  NOW = 2000;
  box.addIncoming({ mid: 'in-mid-0003', peer: PEER, text: 'התקבלה באמצע', sentAt: 2000 });
  st.failWrite = null;
  box.restoreMailbox(before, { except: backup });
  const after = box.exportMailbox();
  assert.deepEqual(after.messages.map(m => m.mid), ['in-old-0001', 'out-0001', 'in-mid-0003']);
  assert.equal(after.settings.profile.name, 'קופת צדקה בני ברק');
  assert.equal(after.meta[PEER2], undefined, 'נתוני שיחה שהגיעו רק מהגיבוי — לא נשארים');
  assert.equal(after.meta[PEER].note, 'תורם קבוע — לברר כתובת למשלוח');
  assert.deepEqual(JSON.parse(st.value).messages.map(m => m.mid), ['in-old-0001', 'out-0001', 'in-mid-0003']);
});

/* ================= main.js האמיתי ================= */

const fakeSS = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};
const userData = tmp('main');
const bkDir = tmp('main-bk');
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
const KEY = crypto.randomBytes(32).toString('base64');
fs.writeFileSync(path.join(userData, 'autobackup.key'), fakeSS.encryptString(KEY));
const SYS_FILE = path.join(userData, 'messages.bin');
const OWNER_FILE = path.join(userData, 'owner', 'messages.bin');
const sysBox = (clk) => createChatStore({ schedule: manual(), clock: clk, storage: encryptedChatStorage({ fs, file: SYS_FILE, legacyFile: path.join(userData, 'messages.json'), getBackupKey: () => KEY, scope: 'system' }) });
const OWNER_TEXT = 'הודעה פנימית של מנהל-העל ללקוח';
{
  const box = sysBox(clock);
  seedBox(box);
  box.flush();
  const owner = createChatStore({ schedule: manual(), storage: encryptedChatStorage({ fs, file: OWNER_FILE, legacyFile: path.join(userData, 'owner', 'messages.json'), getBackupKey: () => KEY, scope: 'owner' }) });
  owner.addOutgoing({ mid: 'own-0001', peer: PEER, text: OWNER_TEXT, sentAt: 1 });
  owner.flush();
}

const handlers = {};
const created = { views: [] };
let readyCallback = null, autoBackupFn = null;
const dialogPlan = { save: { canceled: true }, open: { canceled: true, filePaths: [] }, box: 1 };
const dialogLog = [];
function chainable(props = {}) {
  const target = function () { return chainable(); };
  return new Proxy(target, {
    get(_t, key) {
      if (key in props) return props[key];
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 0;
      return chainable();
    },
    apply() { return chainable(); },
  });
}
class ViewStub {
  constructor(opts = {}) {
    this.id = created.views.length + 100;
    this.opts = opts;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {},
      executeJavaScript: async () => '{}', executeJavaScriptInIsolatedWorld: async () => '{}' });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}
class WinStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; } on() {} removeMenu() {} loadFile() {} maximize() {}
}
const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, quit() {}, relaunch() {}, exit() {}, isPackaged: false, getVersion: () => '0',
  }),
  BrowserWindow: WinStub, WebContentsView: ViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} },
  dialog: {
    showSaveDialog: async () => dialogPlan.save,
    showOpenDialog: async () => dialogPlan.open,
    showMessageBox: async (_w, o) => { const b = o || _w; dialogLog.push(['box', b.message, b.detail || '']); return { response: dialogPlan.box }; },
    showErrorBox(t, m) { dialogLog.push(['error', m]); },
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(), safeStorage: fakeSS,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_bk_chat__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_bk_chat__.js'] = { id: '/__electron_stub_bk_chat__.js', filename: '/__electron_stub_bk_chat__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => {
  if (ms === 15000 && fn && fn.name === 'autoBackup') { autoBackupFn = fn; return { unref() {}, ref() {} }; }
  return realSetTimeout(fn, ms, ...rest).unref();
};
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

const shell = () => ({ sender: { id: 1 } });
const ipc = () => require(path.join(ROOT, 'modules', 'econ', 'ipc.js'));
const econView = () => created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
let ready = null;
function boot() {
  ready = ready || (async () => {
    require(path.join(ROOT, 'main.js'));
    await readyCallback();
    await handlers['shell:switch'](shell(), 'econ');
    await handlers['auth:setup']({ sender: { id: econView().id } }, 'menahel', 'menahel-pass-long-1');
  })();
  return ready;
}
// שחזור מקובץ: האישור — "שחזר"
async function restoreFile(content) {
  const file = path.join(userData, 'restore-' + crypto.randomBytes(4).toString('hex') + '.ssbk');
  fs.writeFileSync(file, BK.encryptBackup(JSON.stringify(content), PASS));
  dialogPlan.open = { canceled: false, filePaths: [file] };
  dialogPlan.box = 0;
  dialogLog.length = 0;
  try { return await handlers['shell:restore-all'](shell(), PASS); }
  finally { dialogPlan.open = { canceled: true, filePaths: [] }; dialogPlan.box = 1; }
}
async function econBackup(donor) {
  const d = await ipc().getDb().backup();
  d.donors = [{ id: 'd-' + donor, name: donor }];
  return d;
}
const donors = async () => (await ipc().getDb().load()).donors.map(d => d.name);

test('main.js: גיבוי מלא כולל את תיבת ההודעות (מוצפן), עם תקרת הקבצים; תיבת מנהל-העל ותיבה בגיבוי של מודול — לא', async () => {
  await boot();
  const calls = [];
  const orig = ipc().chatBackup;
  ipc().chatBackup = (o) => { calls.push(o); return orig(o); };
  const file = path.join(bkDir, 'manual-all.ssbk');
  dialogPlan.save = { canceled: false, filePath: file };
  try { assert.deepEqual(await handlers['shell:backup-all'](shell(), PASS, 'all'), { ok: true }); }
  finally { ipc().chatBackup = orig; dialogPlan.save = { canceled: true }; }
  assert.deepEqual(calls, [{ attachmentChars: BACKUP_ATTACHMENT_CHARS }]);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(BK.isEncryptedBackup(raw), 'SSBK1');
  assert.doesNotMatch(raw, /בקשה לקבלה/);
  const data = JSON.parse(BK.decryptBackup(raw, PASS));
  assert.deepEqual(data.chat.messages.map(m => m.text), ['בקשה לקבלה על תרומה', 'הקבלה תישלח מחר בעזרת השם']);
  assert.deepEqual(data.chat.messages.map(m => m.att.data), ['JVBERi0xLjQ=', 'QUJDREVG']);
  assert.deepEqual(data.chat.meta[PEER].labels, ['pay']);
  assert.equal(data.chat.meta[PEER].note, 'תורם קבוע — לברר כתובת למשלוח');
  assert.equal(data.chat.settings.profile.name, 'קופת צדקה בני ברק');
  assert.ok(!JSON.stringify(data).includes(OWNER_TEXT), 'תיבת מנהל-העל אינה בגיבוי של הארגון');
  // גיבוי של המערכת הכלכלית בלבד — בלי התיבה (רק בגיבוי המלא)
  const econFile = path.join(bkDir, 'manual-econ.ssbk');
  dialogPlan.save = { canceled: false, filePath: econFile };
  try { await handlers['shell:backup-all'](shell(), PASS, 'econ'); } finally { dialogPlan.save = { canceled: true }; }
  assert.equal(JSON.parse(BK.decryptBackup(fs.readFileSync(econFile, 'utf8'), PASS)).chat, undefined);
});

test('main.js: תיבה שלא נקראה ← הגיבוי האוטומטי לא נשמר (module-read-failed) ושום גיבוי לא נמחק; אחר כך — גיבוי עם ההודעות', async () => {
  await boot();
  const before = fs.readdirSync(bkDir).sort();
  const busyBox = createChatStore({ storage: { read() { throw busy(); }, write() {} }, schedule: manual() });
  const orig = ipc().chatBackup;
  ipc().chatBackup = (o) => busyBox.exportMailbox(o);
  let st;
  try { st = await autoBackupFn(); } finally { ipc().chatBackup = orig; }
  assert.equal(st.ok, false);
  assert.equal(st.reason, 'module-read-failed');
  assert.deepEqual(fs.readdirSync(bkDir).sort(), before);
  const ok = await autoBackupFn();
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const data = JSON.parse(BK.decryptBackup(fs.readFileSync(ok.file, 'utf8'), KEY));
  assert.deepEqual(data.chat.messages.map(m => m.mid), ['in-old-0001', 'out-0001']);
});

test('main.js: שחזור מלא — התיבה מהגיבוי (הודעות, תוויות, הערה, הגדרות), הודעה שיש רק כאן נשמרת, מוצפן בדיסק; מנהל-העל לא משתנה', async () => {
  await boot();
  const ownerBefore = fs.readFileSync(OWNER_FILE);
  const chat = {
    v: 2,
    messages: [
      { mid: 'in-old-0001', peer: PEER, dir: 'in', text: 'בקשה לקבלה על תרומה', sentAt: 1000, receivedAt: 1000, read: true,
        att: { name: 'אישור-העברה.pdf', type: 'application/pdf', size: 6, data: null, omitted: true } },
      { mid: 'in-bk-0002', peer: PEER2, dir: 'in', text: 'שאלה על הלוואה מהגמ"ח', sentAt: 1500, receivedAt: 1500, read: false },
    ],
    meta: { [PEER]: { labels: ['done'], note: 'טופל — נשלחה קבלה' } },
    settings: { profile: { name: 'גמ״ח חסדי אבות' }, quickReplies: [{ shortcut: 'shalom', text: 'שלום וברכה' }] },
  };
  const r = await restoreFile({ suite: 'SuperSuite', version: 2, scope: 'all', econ: await econBackup('שמעון כהן'),
    localStorage: { shamai: {}, trainer: {}, tools: {} }, chat });
  assert.deepEqual(r, { ok: true }, JSON.stringify(dialogLog));
  assert.ok(dialogLog.some(x => x[0] === 'box' && /תיבת ההודעות תשוחזר מהגיבוי/.test(x[2])), 'חלון האישור מסביר מה קורה להודעות');
  assert.ok(dialogLog.some(x => x[1] === 'השחזור הושלם'));
  assert.deepEqual(await donors(), ['שמעון כהן']);
  const box = sysBox(); // מהדיסק
  assert.deepEqual(box.exportMailbox().messages.map(m => m.mid), ['in-old-0001', 'out-0001', 'in-bk-0002'], 'out-0001 נשלחה "אחרי הגיבוי" — נשמרת, לפי הסדר');
  assert.equal(box.attachment('in-old-0001').data, 'JVBERi0xLjQ=', 'תוכן הקובץ שלא נכלל בגיבוי — מהתיבה שבמחשב');
  assert.deepEqual(box.meta(PEER).labels, ['done']);
  assert.equal(box.meta(PEER).note, 'טופל — נשלחה קבלה');
  assert.equal(box.settings().profile.name, 'גמ״ח חסדי אבות');
  assert.deepEqual(box.settings().quickReplies, [{ shortcut: 'shalom', text: 'שלום וברכה' }]);
  assert.deepEqual(ipc().chatBackup().messages.map(m => m.mid), ['in-old-0001', 'out-0001', 'in-bk-0002'], 'גם התיבה שבזיכרון');
  const disk = fs.readFileSync(SYS_FILE, 'utf8');
  assert.match(disk, /^SSDB1:/);
  assert.doesNotMatch(disk, /הגמ"ח|חסדי אבות/);
  assert.deepEqual(fs.readFileSync(OWNER_FILE), ownerBefore, 'תיבת מנהל-העל לא נגעה');
});

test('main.js: גיבוי ישן בלי הודעות — הכספים משוחזרים והתיבה לא משתנה', async () => {
  await boot();
  const chatBefore = ipc().chatBackup();
  const diskBefore = fs.readFileSync(SYS_FILE, 'utf8');
  const r = await restoreFile({ suite: 'SuperSuite', version: 2, scope: 'all', econ: await econBackup('לוי יצחק'), localStorage: { shamai: {}, trainer: {}, tools: {} } });
  assert.deepEqual(r, { ok: true }, JSON.stringify(dialogLog));
  assert.deepEqual(await donors(), ['לוי יצחק']);
  assert.deepEqual(ipc().chatBackup(), chatBefore);
  assert.equal(fs.readFileSync(SYS_FILE, 'utf8'), diskBefore, 'לא נכתב');
  assert.ok(!dialogLog.some(x => /תיבת ההודעות/.test(x[2] || '')));
});

test('main.js: הודעות פגומות בגיבוי ← שגיאה לפני האישור, ושום דבר לא השתנה', async () => {
  await boot();
  const donorsBefore = await donors();
  const chatBefore = ipc().chatBackup();
  const r = await restoreFile({ suite: 'SuperSuite', version: 2, scope: 'all', econ: await econBackup('לא אמור להשתחזר'),
    localStorage: {}, chat: { messages: 'לא רשימה' } });
  assert.deepEqual(r, { ok: false });
  assert.equal(dialogLog.length, 1, JSON.stringify(dialogLog));
  assert.equal(dialogLog[0][0], 'error');
  assert.match(dialogLog[0][1], /נתוני ההודעות בקובץ הגיבוי אינם תקינים.*לא שוחזר דבר/);
  assert.deepEqual(await donors(), donorsBefore);
  assert.deepEqual(ipc().chatBackup(), chatBefore);
});

test('main.js: כתיבת התיבה נכשלת באמצע השחזור ← הכספים והתיבה חוזרים למצב שלפני', async () => {
  await boot();
  const donorsBefore = await donors();
  const chatBefore = ipc().chatBackup();
  const origOpen = fs.openSync;
  let failed = 0;
  fs.openSync = function (p, ...rest) {
    if (!failed && String(p) === SYS_FILE + '.tmp') { failed++; throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); }
    return origOpen.call(this, p, ...rest);
  };
  let r;
  try {
    r = await restoreFile({ suite: 'SuperSuite', version: 2, scope: 'all', econ: await econBackup('לא אמור להישאר'),
      localStorage: {}, chat: { messages: [{ mid: 'in-bk-9999', peer: PEER, dir: 'in', text: 'לא אמורה להישאר', sentAt: 9 }], settings: { profile: { name: 'לא אמור להישאר' } } } });
  } finally { fs.openSync = origOpen; }
  assert.equal(failed, 1);
  assert.deepEqual(r, { ok: false });
  const err = dialogLog.find(x => x[0] === 'error');
  assert.ok(err && /לא ניתן היה לשמור את תיבת ההודעות \(ENOSPC\)/.test(err[1]) && /הוחזרו למצב שלפני השחזור/.test(err[1]), JSON.stringify(dialogLog));
  assert.deepEqual(await donors(), donorsBefore);
  assert.deepEqual(ipc().chatBackup(), chatBefore);
  assert.deepEqual(sysBox().exportMailbox(), chatBefore, 'גם בדיסק');
});

/* ================= main-android.js ================= */

function startAndroid({ econ, openText, alerts = [], confirms = [], saved = [] }) {
  const MA = require('../android/web/main-android.js');
  const h = new Map();
  const frames = {
    _f: new Set(['econ']), exists: (id) => frames._f.has(id), ensure: (id) => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {}, moduleSenderIds: () => [],
    request: async (id, type) => (type === 'ls-dump' ? {} : true),
  };
  MA.start({
    ipcMain: { handle: (c, fn) => h.set(c, fn), on() {} }, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m, name, mime, text) => { if (m === 'openText') return { text: openText }; saved.push({ name, text }); return { ok: true, name }; },
    senderOf: (id) => ({ econ: 2, shamai: 3, trainer: 4, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: (v) => { o = v; } }; })(),
    alert: (m) => alerts.push(m), confirm: (m) => { confirms.push(m); return true; }, exit() {}
  });
  return (ch, ...a) => h.get(ch)({ sender: { id: 1 } }, ...a);
}
// localStorage של המעטפת (WebView) עם מכסה
function quotaLs(limit) {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k),
    setItem: (k, v) => { if (String(v).length > limit) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 }); m.set(k, String(v)); } };
}
const androidEcon = (box, extra = {}) => ({ assertAccess() {}, getDb: () => ({ backup: async () => ({ donors: [] }), restore: async () => {} }),
  chatBackup: (o) => box.exportMailbox(o), chatRestore: (d, o) => box.restoreMailbox(d, o), ...extra });

test('אנדרואיד: גיבוי מלא כולל את התיבה (מוצפן); תיבה שלא נקראה ← module-read-failed ושום קובץ לא נשמר', async () => {
  const box = createChatStore({ storage: webChatStorage(quotaLs(1e7), 'supersuite.chat'), schedule: manual(), writeDelayMs: 0 });
  seedBox(box);
  const saved = [];
  const call = startAndroid({ econ: androidEcon(box), saved });
  assert.deepEqual(await call('shell:backup-all', PASS, 'all'), { ok: true });
  assert.ok(BK.isEncryptedBackup(saved[0].text));
  const data = JSON.parse(BK.decryptBackup(saved[0].text, PASS));
  assert.deepEqual(data.chat.messages.map(m => m.mid), ['in-old-0001', 'out-0001']);
  assert.equal(data.chat.meta[PEER].note, 'תורם קבוע — לברר כתובת למשלוח');
  const busyBox = createChatStore({ storage: { read() { throw busy(); }, write() {} }, schedule: manual() });
  const saved2 = [];
  const call2 = startAndroid({ econ: androidEcon(busyBox), saved: saved2 });
  await assert.rejects(() => call2('shell:backup-all', PASS, 'all'), (e) => e.code === 'module-read-failed' && /תיבת ההודעות/.test(e.message));
  assert.deepEqual(saved2, []);
});

test('אנדרואיד: אין מקום לתיבה מהגיבוי ← התיבה נשארת כמו שהייתה, ושאר הנתונים משוחזרים', async () => {
  const ls = quotaLs(20000);
  const box = createChatStore({ storage: webChatStorage(ls, 'supersuite.chat'), schedule: manual(), writeDelayMs: 0 });
  box.addIncoming({ mid: 'in-live-0001', peer: PEER, text: 'הודעה במכשיר', sentAt: 1 });
  const stored = ls.getItem('supersuite.chat');
  let restoredEcon = null;
  const econ = androidEcon(box, { getDb: () => ({ backup: async () => ({ donors: [] }), restore: async (d) => { restoredEcon = d; } }) });
  const big = Array.from({ length: 30 }, (_, i) => ({ mid: 'in-big-' + i, peer: PEER, dir: 'in', text: 'ת'.repeat(3000), sentAt: 10 + i }));
  const openText = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] },
    localStorage: {}, chat: { messages: big } }), PASS);
  const alerts = [], confirms = [];
  const call = startAndroid({ econ, openText, alerts, confirms });
  const r = await call('shell:restore-all', PASS);
  assert.deepEqual(r, { ok: true, skipped: ['chat'] }, alerts.join(' | '));
  assert.match(confirms[0], /תיבת ההודעות תשוחזר מהגיבוי/);
  assert.deepEqual(restoredEcon.donors.map(d => d.name), ['אהרן לוי']);
  assert.match(alerts.at(-1), /חוץ מנתוני תיבת ההודעות/);
  assert.deepEqual(JSON.parse(ls.getItem('supersuite.chat')), JSON.parse(stored), 'התיבה במכשיר כמו שהייתה');
  assert.deepEqual(box.exportMailbox().messages.map(m => m.mid), ['in-live-0001']);
});

test('אנדרואיד: גיבוי ישן בלי הודעות לא נוגע בתיבה; הודעות פגומות ← לא שוחזר דבר', async () => {
  const touched = [];
  const box = createChatStore({ storage: memStorage(), schedule: manual() });
  const econ = androidEcon(box, { chatBackup: () => { touched.push('backup'); return box.exportMailbox(); }, chatRestore: () => { touched.push('restore'); } });
  let restoredEcon = null;
  econ.getDb = () => ({ backup: async () => ({ donors: [] }), restore: async (d) => { restoredEcon = d; } });
  const old = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [{ id: 'd1', name: 'אהרן לוי' }] }, localStorage: {} }), PASS);
  assert.deepEqual(await startAndroid({ econ, openText: old })('shell:restore-all', PASS), { ok: true });
  assert.deepEqual(restoredEcon.donors.map(d => d.name), ['אהרן לוי']);
  assert.deepEqual(touched, [], 'התיבה לא נקראה ולא נכתבה');
  restoredEcon = null;
  const alerts = [], confirms = [];
  const bad = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: { donors: [] }, localStorage: {}, chat: { meta: 'x' } }), PASS);
  assert.deepEqual(await startAndroid({ econ, openText: bad, alerts, confirms })('shell:restore-all', PASS), { ok: false });
  assert.match(alerts[0], /נתוני ההודעות בקובץ הגיבוי אינם תקינים.*לא שוחזר דבר/);
  assert.deepEqual(confirms, []);
  assert.equal(restoredEcon, null);
  assert.deepEqual(touched, []);
});
