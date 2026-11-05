// סקירת קוד 2.11.2026 — "רישוי, גיבוי והודעות" (ממצאים נמוכים) והחלטת הבעלים על סיום רישיון (סעיף 8 בהסכם)
// docs/CODE-AUDIT-2026-11-02.md
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const L = require('../shell/licensing/license');
const S = require('../shell/licensing/status');
const LG = require('../shell/licensing/gate');
const OC = require('../shell/licensing/owner-core');
const OF = require('../shell/licensing/offer');
const SU = require('../shell/licensing/signup');
const { createLicenseStore, fileStorage, PKG_NOTICES } = require('../shell/licensing/store');
const AB = require('../modules/econ/core/features');
const BK = require('../modules/econ/core/backupCrypto');
const AutoBk = require('../shell/auto-backup');
const DbRecovery = require('../shell/db-recovery');
const { redact } = require('../shell/logger');
const { createCrashGuard } = require('../shell/crash');
const Layout = require('../shell/layout');
const { initializeDatabase } = require('../modules/econ/core/database');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3-ls-' + p + '-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* מסד שעוד פתוח */ } } });
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const memDir = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };

/* ---------- license-key.bin לקריאה בלבד ---------- */

test('license-key.bin לקריאה בלבד: הודעת השעיה לא נקלטת רק בקובץ הגלוי — מחיקתה מהקובץ לא מחזירה "פעיל"', () => {
  const root = L.generateKeyPair();
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'ישיבת אור החיים', publicKey: node.publicJwk, slot: 1, features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 }, issuedAt: T0, expiresAt: T0 + 400 * DAY, graceDays: 7,
  });
  const file = path.join(tmp('ro'), 'license.json');
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [] }));
  let readOnly = false;
  const inner = mem();
  inner.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  const secret = { read: () => inner.read(), write: (t) => { if (readOnly) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); inner.write(t); } };
  const store = createLicenseStore({ storage: fileStorage(fs, file), secret, rootKeys: [root.publicJwk], clock: () => T0 + DAY });
  assert.equal(store.current().status, 'active');
  readOnly = true;
  const hold = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: lic.payload.id, kind: 'suspended', source: 'owner', reason: 'חוב פתוח', issuedAt: T0 + DAY });
  assert.throws(() => store.importNotices(JSON.stringify({ type: PKG_NOTICES, v: 1, notices: [hold] })));
  // ההודעה לא נכתבה לקובץ הגלוי (אחרת מחיקה ידנית שלה הייתה מחזירה "פעיל", כי השומר לא ידע עליה)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notices.length, 0);
  readOnly = false;
  store.importNotices(JSON.stringify({ type: PKG_NOTICES, v: 1, notices: [hold] }));
  store.invalidate();
  assert.equal(store.current().status, 'suspended');
  // עכשיו השומר יודע על ההודעה: מחיקתה מהקובץ — נעול
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...d, notices: [] }));
  store.invalidate();
  assert.equal(store.current().status, 'locked');
});

test('כשל בכתיבת license.json אחרי השומר — השומר חוזר לקודם (אין נעילה בגלל קובץ תפוס)', () => {
  const root = L.generateKeyPair();
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'כולל', publicKey: node.publicJwk, slot: 1, features: ['econ'],
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 }, issuedAt: T0, expiresAt: T0 + 400 * DAY, graceDays: 7,
  });
  let failFile = false;
  const fileMem = mem();
  fileMem.write(JSON.stringify({ chain: [lic], notices: [] }));
  const storage = { read: () => fileMem.read(), write: (t) => { if (failFile) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); fileMem.write(t); } };
  const secret = mem();
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  const store = createLicenseStore({ storage, secret, rootKeys: [root.publicJwk], clock: () => T0 + DAY });
  assert.equal(store.current().status, 'active');
  const before = secret.read();
  failFile = true;
  const hold = S.createNotice({ privateJwk: root.privateJwk }, { type: 'hold', target: lic.payload.id, kind: 'suspended', source: 'owner', reason: 'חוב', issuedAt: T0 + DAY });
  assert.throws(() => store.importNotices(JSON.stringify({ type: PKG_NOTICES, v: 1, notices: [hold] })), /EBUSY/);
  assert.equal(secret.read(), before);
  failFile = false;
  store.invalidate();
  assert.equal(store.current().status, 'active');
});

/* ---------- הרשמות אצל מנהל-העל ---------- */

const OFFER = {
  seller: { name: 'בונים סלר בע"מ' },
  plans: [
    { id: 'free', name: 'גמ"ח קטן', priceAgorot: 0, months: 12, features: ['econ.gemach'], limits: { maxUsers: 2 } },
    { id: 'pro', name: 'מוסדות', priceAgorot: 49900, months: 12, features: ['econ', 'econ.npo'], limits: { maxUsers: 10, maxChildren: 3 } },
  ],
  terms: { version: '1.0', title: 'תקנון ותנאי שימוש', text: 'תקנון השימוש במערכת SuperSuite.\n1. השימוש במערכת כפוף לתנאים אלה.\n'.repeat(3) },
};
const CUSTOMER = { org: 'ישיבת תורת חיים', contact: 'משה כהן', phone: '050-1234567', email: 'office@example.org', taxId: '' };
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40);
const OWNER_PASS = 'menahel-al-r3-2026-sod';

test('הרשמות: חיתוך הרשימה מוחק רק הרשמות שהונפקו — הרשמה בתשלום שלא טופלה לא נעלמת', () => {
  const o = OC.createOwnerCore({ storage: memDir(), maxSignups: 3 });
  const keys = [o.init(OWNER_PASS).publicKey];
  const offer = o.setOffer(OFFER).text;
  o.offerPublished();
  const add = (paid) => {
    const text = SU.createSignup({ deviceJwk: L.generateKeyPair().privateJwk, offerText: offer, rootKeys: keys, planId: paid ? 'pro' : 'free',
      customer: CUSTOMER, signatureImage: SIG, scrolledToEnd: true, accepted: true }).text;
    return o.addSignup(JSON.stringify({ type: 'supersuite-signup-delivery', signup: text, payment: paid ? { amountAgorot: 49900, providerRef: 'r' + Math.random() } : null })).id;
  };
  const paid1 = add(true);
  const paid2 = add(true);
  const free1 = add(false);
  o.issueSignup(free1);
  const paid3 = add(true);
  const paid4 = add(true);
  const ids = o.signups().map(x => x.id);
  // הונפקה אחת בלבד — היא נחתכה; ארבע שלא טופלו נשמרות (גם מעבר לתקרה)
  assert.deepEqual(ids, [paid1, paid2, paid3, paid4]);
});

test('אישור תשלום לא חתום: הנפקה בתשלום רק אחרי אימות מפורש של מנהל-העל מול חברת הסליקה', () => {
  const x = { payment: { amountAgorot: 49900, providerRef: 'CC-77' } };
  assert.match(OC.signupPaymentProblem(x), /נדרש אימות התשלום.*499.*CC-77/);
  assert.equal(OC.signupPaymentProblem(x, { paymentConfirmed: true }), null);
  assert.equal(OC.signupPaymentProblem({ ...x, invoice: { id: 'i', number: 1 } }), null, 'כבר הופקה חשבונית (אושר קודם)');
  assert.equal(OC.signupPaymentProblem({ payment: null }), null, 'חינם');
  // הערוץ בודק לפני החשבונית וההנפקה, והמסך שואל ושולח paymentConfirmed
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const body = src.slice(src.indexOf("handleNet('owner:signupIssue'"), src.indexOf("handleSave('owner:signupDocument'"));
  // מאז 5.11.2026 — signupPaymentCode (אותה בדיקה, עם אימות מול Cardcom כשמוגדר; tests/r4-payments-cardcom.test.js)
  assert.ok(body.indexOf('signupPaymentCode') > 0 && body.indexOf('signupPaymentCode') < body.indexOf('createPaidInvoice'));
  const ui = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/licensing-actions.js'), 'utf8');
  assert.match(ui, /opts\.paymentConfirmed = true/);
});

/* ---------- גיבוי אוטומטי: תאריך עתידי בשם הקובץ ---------- */

test('סבב הגיבויים: קובץ עם תאריך עתידי (שעון שגוי) לא דוחק גיבויים אמיתיים, ונמחק כשיש keep גיבויים', () => {
  const dir = tmp('future');
  const tag = 'abcdef12';
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(path.join(dir, `auto-2031-01-01-${tag}.ssbk`), 'x');
  const w = (day) => AB.writeEncryptedAutoBackup({ dir, plainText: '{}', key, keep: 3, today: day, tag });
  w('2026-11-01'); w('2026-11-02');
  assert.ok(fs.existsSync(path.join(dir, `auto-2026-11-01-${tag}.ssbk`)), 'בעבר נמחק הגיבוי האמיתי, כי העתידי נחשב "החדש ביותר"');
  assert.ok(fs.existsSync(path.join(dir, `auto-2031-01-01-${tag}.ssbk`)));
  const r = w('2026-11-03');
  assert.ok(r.removed.includes(`auto-2031-01-01-${tag}.ssbk`), JSON.stringify(r));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-11-01', '2026-11-02', '2026-11-03'].map(d => `auto-${d}-${tag}.ssbk`));
});

test('התאוששות: "הגיבוי האחרון" לא נבחר לפי תאריך עתידי בשם', () => {
  const dir = tmp('future-rec');
  for (const n of ['auto-2026-10-30.ssbk', 'auto-2026-11-01.ssbk', 'auto-2031-01-01.ssbk']) fs.writeFileSync(path.join(dir, n), n);
  assert.equal(DbRecovery.latestAutoBackup(dir, { today: '2026-11-02' }).day, '2026-11-01');
  const open = (f) => ({ suite: 'SuperSuite', econ: {}, f: path.basename(f) });
  assert.equal(DbRecovery.latestUsableAutoBackup(dir, open, { today: '2026-11-02' }).day, '2026-11-01');
  // אם רק העתידי נפתח — הוא עדיין משמש (עדיף על כלום)
  const onlyFuture = (f) => (/2031/.test(f) ? open(f) : null);
  assert.equal(DbRecovery.latestUsableAutoBackup(dir, onlyFuture, { today: '2026-11-02' }).day, '2031-01-01');
});

/* ---------- גיבוי שדולג ---------- */

test('גיבוי אוטומטי שדולג ("כבר קיים") — הזמן של הקובץ הקיים, לא של הסבב', async () => {
  const dir = tmp('skip');
  const key = crypto.randomBytes(32).toString('base64');
  const name = `auto-2026-11-02-${AutoBk.installTag(key)}.ssbk`;
  fs.writeFileSync(path.join(dir, name), 'x');
  const written = new Date(Date.UTC(2026, 10, 2, 6, 0));
  fs.utimesSync(path.join(dir, name), written, written);
  const now = new Date(2026, 10, 2, 20, 0);
  const st = await AutoBk.runAutoBackup({ encryptionAvailable: true, customTarget: dir, defaultTarget: dir, collect: () => ({}), getKey: () => key, write: AB.writeEncryptedAutoBackup, now });
  assert.equal(st.skipped, true);
  assert.equal(st.at, written.toISOString());
});

/* ---------- קובץ מצורף: Zone.Identifier ---------- */

test('קובץ מצורף מהודעות: סימון "הגיע מהאינטרנט" (ZoneId=3) ב-Windows בלבד', () => {
  const econ = require('../modules/econ/ipc.js');
  const writes = [];
  const fsx = { writeFileSync: (f, t) => writes.push([f, t]) };
  assert.equal(econ.markFromInternet('C:\\x\\a.exe', { platform: 'win32', fsx }), true);
  assert.deepEqual(writes, [['C:\\x\\a.exe:Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n']]);
  assert.equal(econ.markFromInternet('/x/a.exe', { platform: 'linux', fsx }), false);
  assert.equal(writes.length, 1);
  // כונן בלי NTFS — לא מפיל את השמירה
  assert.equal(econ.markFromInternet('E:\\a.exe', { platform: 'win32', fsx: { writeFileSync() { throw new Error('EINVAL'); } } }), false);
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  const body = src.slice(src.indexOf("handleLong('chat:saveAttachment'"), src.indexOf("handleNet('chat:refresh'"));
  assert.match(body, /markFromInternet\(file\)/);
});

/* ---------- crash.log ---------- */

test('crash.log: נתיבי קבצים, IBAN ומספרי כרטיס מוסרים; קבצי הקוד במחסנית נשארים', () => {
  const line = redact("EBUSY: resource busy or locked, open 'D:\\גיבויים\\חשבונית משה כהן.pdf.tmp'\n    at Object.openSync (node:fs:573:3)\n    at save (C:\\Program Files\\SuperSuite\\resources\\app.asar\\main.js:120:7)"
    + ' IBAN IL62 0108 0000 0009 9999 999 card 4580-1234-5678-9012 acct 12345678901', { home: '' });
  assert.doesNotMatch(line, /משה|כהן/);
  assert.match(line, /'<path>'/);
  assert.match(line, /app\.asar\\main\.js:120:7/);
  assert.doesNotMatch(line, /IL62|0108/);
  assert.doesNotMatch(line, /4580|9012/);
  assert.doesNotMatch(line, /12345678901/);
  assert.match(redact("ENOENT: no such file, open '/home/user/דוח-אהרן.csv'", { home: '' }), /'<path>'/);
  // שמירת קובץ שנכשלה — ליומן רק הקוד, לא ההודעה (עם הנתיב)
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ipc.js'), 'utf8');
  assert.match(src, /errorLogger\('econ-save-file', \{ code:/);
});

/* ---------- קריסת מסך בזמן שחלון קריסה פתוח ---------- */

test('מסך שקרס בזמן שחלון קריסה אחר פתוח — נטען מחדש כשהחלון נסגר', async () => {
  let release;
  const dialog = { showMessageBox: () => new Promise((r) => { release = r; }) };
  const logger = { error() {}, warn() {}, report: () => '' };
  const g = createCrashGuard({ logger, dialog, app: {}, getWin: () => null });
  const reloads = [];
  const first = g.onRenderGone('econ', { reason: 'crashed' }, () => reloads.push('econ'));
  assert.equal(g.onRenderGone('shamai', { reason: 'crashed' }, () => reloads.push('shamai')), null);
  assert.deepEqual(reloads, []);
  release({ response: 0 });
  await first;
  assert.deepEqual(reloads.sort(), ['econ', 'shamai']);
});

/* ---------- מיקום החלון ---------- */

test('מיקום החלון השמור: מחוץ לכל המסכים (מסך שני נותק) — בלי x/y (ממורכז)', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  assert.deepEqual(Layout.restorePosition({ x: 2200, y: 100, width: 1500, height: 940 }, displays), {});
  assert.deepEqual(Layout.restorePosition({ x: 100, y: 50, width: 1500, height: 940 }, displays), { x: 100, y: 50 });
  assert.deepEqual(Layout.restorePosition({ x: -1480, y: 50, width: 1500, height: 940 }, displays), {}, 'רק 20 פיקסלים נראים');
  assert.deepEqual(Layout.restorePosition({ x: 2200, y: 100, width: 1500, height: 940 }, [...displays, { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }]), { x: 2200, y: 100 });
  assert.deepEqual(Layout.restorePosition({}, displays), {});
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(src, /Layout\.restorePosition\(st, displays\)/);
});

/* ---------- סיום רישיון = קריאה בלבד (החלטת הבעלים) ---------- */

test('סיום (terminated): צפייה, ייצוא וגיבוי — בלי כתיבה; מסכי הרישוי וההודעות פתוחים; עם נעילה — חסום', () => {
  const root = L.generateKeyPair();
  const node = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'עמותת חסד', publicKey: node.publicJwk, slot: 1, features: ['econ', 'econ.accounting', 'shamai'],
    limits: { maxChildren: 0, maxUsers: 2, maxStorageMb: 100, maxDepth: 1 }, issuedAt: T0, expiresAt: T0 + 400 * DAY, graceDays: 7,
  });
  const term = S.createNotice({ privateJwk: root.privateJwk }, { type: 'terminate', target: lic.payload.id, reason: 'ההסכם הסתיים', issuedAt: T0 + DAY });
  const storage = mem();
  storage.write(JSON.stringify({ chain: [lic], notices: [term] }));
  const secret = mem();
  secret.write(JSON.stringify({ v: 2, key: node.privateJwk, guard: { lastSeen: 0, notices: [] } }));
  const st = createLicenseStore({ storage, secret, rootKeys: [root.publicJwk], clock: () => T0 + 2 * DAY }).current();
  assert.equal(st.status, 'terminated');
  assert.equal(LG.checkChannel(st, 'acct:getInvoices', 'data.view'), null);
  assert.equal(LG.checkChannel(st, 'export:csv', 'data.export'), null);
  assert.equal(LG.checkChannel(st, 'backup:create', 'data.backup'), null);
  assert.match(LG.checkChannel(st, 'acct:createInvoice', 'data.edit'), /השימוש במערכת הסתיים/);
  assert.match(LG.checkChannel(st, 'acct:deleteInvoice', 'data.delete'), /הסתיים/);
  assert.equal(LG.checkChannel(st, 'license:getStatus', null), null);
  assert.equal(LG.checkChannel(st, 'chat:send', 'data.edit'), null);
  assert.equal(LG.moduleAllowed(st, 'econ'), true);
  assert.equal(LG.moduleAllowed(st, 'shamai'), true);
  assert.equal(LG.viewAllowed(st, 'econ', 'licensing'), true);
  const sh = LG.shellState(st);
  assert.equal(sh.level, 'limited');
  assert.equal(sh.modules.econ, true);
  // סיום + נעילה — הנעילה קובעת
  const both = { ...st, reasons: [...st.reasons, { kind: 'locked', reason: 'הפרת תנאים' }] };
  assert.match(LG.checkChannel(both, 'acct:getInvoices', 'data.view'), /הסתיים/);
  assert.equal(LG.moduleAllowed(both, 'econ'), false);
  assert.equal(LG.shellState(both).level, 'blocked');
});

/* ================= main.js האמיתי, בתהליך הזה ================= */

const SHABBAT = Date.parse('2026-10-24T09:00:00Z'); // שבת, 12:00 בירושלים
async function atTime(ms, fn) {
  const Real = Date;
  class FakeDate extends Real { constructor(...a) { super(...(a.length ? a : [ms])); } static now() { return ms; } }
  global.Date = FakeDate;
  try { return await fn(); } finally { global.Date = Real; }
}
const fakeSS = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};
const userData = tmp('main');
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: tmp('main-bk') }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
fs.writeFileSync(path.join(userData, 'autobackup.key'), fakeSS.encryptString(crypto.randomBytes(32).toString('base64')));
const handlers = {};
const created = { views: [] };
let readyCallback = null;
const dialogPlan = { open: null };
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
    const self = this;
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {},
      loadURL: (u) => { self.url = String(u); }, executeJavaScript: async () => '{}', executeJavaScriptInIsolatedWorld: async () => '{}' });
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
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: () => dialogPlan.open || Promise.resolve({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 1 }),
    showErrorBox() {},
  },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { fetch: async () => ({}) },
  session: chainable(), shell: chainable(), Menu: chainable(), safeStorage: fakeSS,
};
const STUB = '/__electron_stub_r3_ls__.js';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? STUB : origResolve.call(this, req, ...rest); };
require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => {
  if (ms === 15000 && fn && fn.name === 'autoBackup') return { unref() {}, ref() {} };
  return realSetTimeout(fn, ms, ...rest).unref();
};
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();
const shell = () => ({ sender: { id: 1 } });
const econView = () => created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
let ready = null;
function boot() {
  ready = ready || (async () => {
    const origOn = process.on;
    process.on = function (ev, fn) { if (ev === 'uncaughtException' || ev === 'unhandledRejection') return process; return origOn.call(this, ev, fn); };
    try { require(path.join(ROOT, 'main.js')); } finally { process.on = origOn; }
    await readyCallback();
    await handlers['shell:switch'](shell(), 'econ');
    await handlers['auth:setup']({ sender: { id: econView().id } }, 'menahel', 'menahel-pass-long-1');
  })();
  return ready;
}
test.before(() => boot());

test('גיבוי ידני מלא לא רץ באמצע שחזור (backupBusy)', async () => {
  let pick;
  dialogPlan.open = new Promise((r) => { pick = r; });
  const restoring = handlers['shell:restore-all'](shell(), 'sismat-gibui-aruka-2026');
  await new Promise((r) => realSetTimeout(r, 20));
  await assert.rejects(() => handlers['shell:backup-all'](shell(), 'sismat-gibui-aruka-2026', 'all'), /שחזור רץ כרגע/);
  pick({ canceled: true, filePaths: [] });
  dialogPlan.open = null;
  assert.deepEqual(await restoring, { ok: false });
  // אחרי השחזור — הגיבוי הידני פתוח שוב (חלון השמירה בוטל)
  assert.deepEqual(await handlers['shell:backup-all'](shell(), 'sismat-gibui-aruka-2026', 'all'), { ok: false });
});

test('מצב שבת: "בית" לא מבטל את הכיסוי — מודול שנפתח אחר כך לא מופיע מעל מסך השבת', async () => {
  handlers['shell:save-calendar'](shell(), { shabbatMode: true });
  try {
    await atTime(SHABBAT, async () => {
      await handlers['shell:overlay'](shell(), true);
      await handlers['shell:home'](shell());
      await handlers['shell:switch'](shell(), 'econ');
      assert.equal(econView().visible, false, 'המודול מוסתר מתחת למסך השבת');
    });
    await handlers['shell:overlay'](shell(), false);
    // ביום חול — "בית" מאפס את הכיסוי כמו קודם
    await atTime(SHABBAT + 3 * DAY, async () => {
      await handlers['shell:overlay'](shell(), true);
      await handlers['shell:home'](shell());
      await handlers['shell:switch'](shell(), 'econ');
      assert.equal(econView().visible, true);
    });
  } finally { handlers['shell:save-calendar'](shell(), { shabbatMode: false }); }
});

/* ================= התאוששות ממסד פגום — main.js בתהליך נפרד ================= */

// Electron זורק על רישום שני של אותו ערוץ (ipcMain.handle) — כמו כאן
const RECOVERY_SCRIPT = (dir, plan) => `
const Module = require('module'), path = require('path'), fs = require('fs');
const log = []; const plan = ${JSON.stringify(plan)};
const ch = (p = {}) => new Proxy(function () {}, { get: (t, k) => k in p ? p[k] : (k === 'then' ? undefined : ch()), apply: () => ch() });
const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
const registered = new Set();
let ready;
const stub = {
  app: ch({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { ready = fn; return { catch() {} }; } }),
    getPath: () => ${JSON.stringify(dir)}, on() {}, exit() {}, quit() { log.push(['quit']); }, isPackaged: false, getVersion: () => '0' }),
  BrowserWindow: class { constructor() { this.webContents = ch({ id: 1, isDestroyed: () => false }); this.contentView = { addChildView() {} }; } isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; } on() {} once() {} removeMenu() {} maximize() {} show() {} focus() {} setMenu() {} getNormalBounds() { return this.getContentBounds(); } getContentSize() { return [1000, 800]; } loadFile() {} getContentBounds() { return { x: 0, y: 0, width: 1000, height: 800 }; } getBounds() { return this.getContentBounds(); } },
  WebContentsView: class { constructor() { this.webContents = ch({ id: 9, isDestroyed: () => false, isLoading: () => false }); } setVisible() {} setBounds() {} },
  ipcMain: { handle(c) { if (registered.has(c)) throw new Error("Attempted to register a second handler for '" + c + "'"); registered.add(c); }, on() {}, removeHandler(c) { registered.delete(c); } },
  dialog: { showMessageBox: async (a, b) => { const o = b || a; log.push(['box', o.message, (o.buttons || []).join('|')]); const r = plan.shift(); return { response: r === undefined ? (o.buttons || []).length - 1 : r }; },
    showErrorBox: (t, m) => log.push(['error', t, m]), showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  protocol: ch(), net: ch(), session: ch(), shell: ch(), Menu: ch(), safeStorage: ss, screen: ch()
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? '/__e__.js' : orig.call(this, r, ...a); };
require.cache['/__e__.js'] = { id: '/__e__.js', filename: '/__e__.js', loaded: true, exports: stub };
global.setTimeout = ((st) => (fn, ms, ...r) => st(fn, ms, ...r).unref())(global.setTimeout);
global.setInterval = ((si) => (fn, ms, ...r) => si(fn, ms, ...r).unref())(global.setInterval);
require(${JSON.stringify(path.join(ROOT, 'main.js'))});
(async () => {
  await ready();
  process.stdout.write('RESULT' + JSON.stringify({ log, files: fs.readdirSync(${JSON.stringify(dir)}) }));
})().catch(e => process.stdout.write('RESULT' + JSON.stringify({ log, fatal: String(e && e.stack) })));
`;
function runRecovery(dir, plan) {
  const r = spawnSync(process.execPath, ['-e', RECOVERY_SCRIPT(dir, plan)], { encoding: 'utf8', timeout: 90000 });
  const i = (r.stdout || '').indexOf('RESULT');
  assert.ok(i >= 0, (r.stderr || '').slice(-1500));
  return JSON.parse(r.stdout.slice(i + 6));
}

test('שחזור שנכשל בהתאוששות ממסד פגום: ניסיון חוזר נכשל באותה סיבה (לא "רישום כפול"), והמסד הפגום חוזר למקומו', async () => {
  const dir = tmp('rec');
  const db = await initializeDatabase(dir);
  for (let i = 0; i < 2000; i++) await db.audit(null, 'test', 'פרטים ' + i);
  db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.db.close();
  const f = path.join(dir, DbRecovery.DB_NAME);
  const b = fs.readFileSync(f);
  for (let i = 8192; i < b.length; i += 5) b[i] = 0x55;
  fs.writeFileSync(f, b);
  const damaged = fs.readFileSync(f);
  // גיבוי שנפתח אבל השחזור ממנו נכשל (econ אינו אובייקט)
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(path.join(dir, 'autobackup.key'), Buffer.from('K:' + key));
  const bkDir = path.join(dir, 'bk');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(dir, 'backup-settings.json'), JSON.stringify({ targetDir: bkDir }));
  fs.writeFileSync(path.join(bkDir, 'auto-2026-10-17.ssbk'), BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: 5, localStorage: {} }), key));
  const res = runRecovery(dir, [0, 0]);
  assert.ok(!res.fatal, res.fatal);
  const errors = res.log.filter(l => l[0] === 'error');
  assert.equal(errors.length, 2, JSON.stringify(res.log));
  for (const e of errors) { assert.match(e[2], /קובץ הגיבוי אינו תקין/); assert.doesNotMatch(e[2], /second handler/); }
  const boxes = res.log.filter(l => l[0] === 'box');
  assert.ok(boxes.length >= 3 && boxes.every(x => /שחזור מהגיבוי/.test(x[2])), 'כל ניסיון — שוב הצעת שחזור');
  assert.deepEqual(fs.readFileSync(f), damaged, 'המסד הפגום חזר למקומו — ההפעלה הבאה תציע שוב שחזור');
  assert.ok(res.files.some(x => x.startsWith(DbRecovery.DB_NAME + '.restore-failed-')), res.files.join(','));
});
