// בדיקת קוד 22.10.2026 (audit-changes-since-20-10.md, ממצאים 4–5): שחזור גיבוי ישן החזיר אחורה את מספרי
// שטרי הקנייה, התיקים והדוחות בשמאות (keepCounters כיסה רק את הכספים), ולא הזהיר שמסמכים שהופקו אחרי
// הגיבוי ייעלמו. החלק הראשון — פונקציות טהורות; השני — main.js האמיתי עם Electron מדומה; השלישי — המסך הכלכלי.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const MC = require('../shell/module-counters');
const { issuedAfter } = require('../modules/econ/core/database');
const BK = require('../modules/econ/core/backupCrypto');
const SecureStore = require('../shell/secure-store');
const AutoBk = require('../shell/auto-backup');

test('ממצא 4: מוני השמאות — הגדול מבין הגיבוי למצב הנוכחי; שאר הערכים מהגיבוי', () => {
  const next = { shamai_v2_purchaseSeq: '5', shamai_v2_caseSeq: '9', shamai_v2_props: '[1]' };
  const cur = { shamai_v2_purchaseSeq: '8', shamai_v2_caseSeq: '3', shamai_v2_reportSeq: '12', shamai_v2_props: '[1,2]' };
  assert.deepEqual(MC.keepModuleCounters('shamai', next, cur),
    { shamai_v2_purchaseSeq: '8', shamai_v2_caseSeq: '9', shamai_v2_reportSeq: '12', shamai_v2_props: '[1]' });
  assert.equal(next.shamai_v2_purchaseSeq, '5', 'הקלט לא משתנה');
  assert.deepEqual(MC.keepModuleCounters('shamai', next, null), next, 'מודול ריק (שחזור אחרי תקלה) — כמו בגיבוי');
  assert.deepEqual(MC.keepModuleCounters('shamai', next, { shamai_v2_purchaseSeq: 'not-json' }), next, 'ערך פגום לא מוריד ולא מפיל');
  assert.deepEqual(MC.keepModuleCounters('tools', { a: '1' }, { a: '2' }), { a: '1' }, 'מודול בלי מונים');
});

test('ממצא 5: מה הופק אחרי הגיבוי — לפי מספרים, לא לפי מספר הרשומות', () => {
  const backup = { settings: { invoiceSeq: 1231, docSeq: { receipt: 560 } }, invoices: [{ number: 1231 }], salesDocs: [], npo: { donations: [] } };
  const current = {
    invoices: [{ number: 1231 }, { number: 1232 }, { number: 1234 }],
    salesDocs: [{ kind: 'receipt', number: 566 }, { kind: 'receipt', number: 567 }, { kind: 'quote', number: 4 }],
    npo: { donations: [{ receipt: { number: 3 } }, { receipt: { external: true, number: null } }] },
    realEstate: { cases: [] },
  };
  assert.deepEqual(issuedAfter(backup, current), [
    { label: 'חשבוניות', count: 2, last: 1234 },
    { label: 'קבלות', count: 2, last: 567 },
    { label: 'הצעות מחיר', count: 1, last: 4 },
    { label: 'קבלות תרומה', count: 1, last: 3 },
  ]);
  assert.deepEqual(issuedAfter(current, current), [], 'גיבוי עדכני — אין אזהרה');
  const text = MC.issuedAfterText([...issuedAfter(backup, current), ...MC.moduleIssuedAfter('shamai', { shamai_v2_purchaseSeq: '5' }, { shamai_v2_purchaseSeq: '8' })]);
  assert.match(text, /^בגיבוי חסרים 9 מסמכים שהופקו אחריו: חשבוניות — 2 \(אחרון: 1234\); קבלות — 2 \(אחרון: 567\);.*שטרי קנייה — 3 \(אחרון: 8\)/);
  assert.match(text, /המספרים שלהם לא יינתנו שוב/);
  assert.equal(MC.issuedAfterText([]), '');
});

// ---------- main.js האמיתי: שחזור מהמעטפת ----------
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rmc-'));
test.after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* המסד פתוח */ } });
fs.writeFileSync(path.join(userData, 'backup-settings.json'), JSON.stringify({ targetDir: path.join(userData, 'bk') }));
fs.writeFileSync(path.join(userData, 'ui-settings.json'), JSON.stringify({ calendar: { shabbatMode: false } }));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('K:' + s),
  decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('not ours'); return t.slice(2); }
};
// המחסן המוצפן של השמאות לפני העלייה: כבר נמסרו שטרי קנייה עד 8, תיקים עד 3 ודוחות עד 12
const keyFile = path.join(userData, 'autobackup.key');
const getKey = (create) => AutoBk.loadAutoBackupKey({ file: keyFile, safeStorage, create });
const openShamai = () => SecureStore.createSecureStore({ fs, dir: userData, mod: 'shamai', getBackupKey: getKey, schedule: () => null });
{
  const s = openShamai();
  for (const [k, v] of Object.entries({ shamai_v2_purchaseSeq: '8', shamai_v2_caseSeq: '3', shamai_v2_reportSeq: '12', shamai_v2_props: '["חדש"]' })) s.set(k, v);
  s.flush();
}

const handlers = {};
const created = { views: [] };
let readyCallback = null;
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
class WebContentsViewStub {
  constructor(opts = {}) {
    this.id = created.views.length + 100;
    this.opts = opts;
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send() {}, reload() {}, executeJavaScript: async () => '{}' });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}
class BrowserWindowStub {
  constructor() { this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; }
  isMaximized() { return false; }
  isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); }
  getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; }
  on() {}
  removeMenu() {}
  loadFile() {}
  maximize() {}
}
const ui = { open: null, boxes: [], errors: [], answer: 0 };
const electronStub = {
  app: chainable({
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false,
  }),
  BrowserWindow: BrowserWindowStub, WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} },
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => (ui.open ? { canceled: false, filePaths: [ui.open] } : { canceled: true, filePaths: [] }),
    showMessageBox: async (_w, o) => { const b = o || _w; ui.boxes.push(b); return { response: /השחזור יחליף/.test(b.message) ? ui.answer : 0 }; },
    showErrorBox(t, m) { ui.errors.push(m); },
  },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(), safeStorage,
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_rmc__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_rmc__.js'] = { id: '/__electron_stub_rmc__.js', filename: '/__electron_stub_rmc__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => (ms === 15000 && fn && fn.name === 'autoBackup' ? { unref() {}, ref() {} } : realSetTimeout(fn, ms, ...rest).unref());
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

let ready = null;
const shellSender = () => ({ sender: { id: 1 } });
const econView = () => created.views.find(v => /econ[\\/]preload\.js$/.test((v.opts.webPreferences || {}).preload || ''));
function boot() {
  ready = ready || (async () => {
    require(path.join(__dirname, '..', 'main.js'));
    await readyCallback();
    await handlers['shell:switch'](shellSender(), 'econ');
    await handlers['auth:setup']({ sender: { id: econView().id } }, 'menahel', 'menahel-pass-long-1');
  })();
  return ready;
}
const PASS = 'sismat-gibui-aruka-2026';
function backupFile(name, payload) {
  const f = path.join(userData, name);
  fs.writeFileSync(f, BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, createdAt: '2026-09-01T10:00:00.000Z', ...payload }), PASS));
  return f;
}

test('ממצאים 4–5 (main.js): שחזור גיבוי ישן של השמאות — אזהרה בחלון האישור, והמונים לא חוזרים אחורה', async () => {
  await boot();
  ui.open = backupFile('old-shamai.ssbk', { scope: 'shamai', econ: null, localStorage: { shamai: { shamai_v2_purchaseSeq: '5', shamai_v2_caseSeq: '3', shamai_v2_props: '["ישן"]' } } });
  // ביטול: רק האזהרה, בלי שינוי
  ui.answer = 1; ui.boxes = []; ui.errors = [];
  assert.deepEqual(await handlers['shell:restore-all'](shellSender(), PASS), { ok: false });
  const confirm = ui.boxes.find(b => /השחזור יחליף/.test(b.message));
  assert.match(confirm.detail, /⚠ בגיבוי חסרים 15 מסמכים שהופקו אחריו: שטרי קנייה — 3 \(אחרון: 8\); דוחות שמאות — 12 \(אחרון: 12\)/);
  assert.equal(openShamai().snapshot().shamai_v2_props, '["חדש"]', 'ביטול — לא שוחזר');
  // אישור: הנתונים מהגיבוי, המונים — הגדולים
  ui.answer = 0; ui.boxes = [];
  assert.deepEqual(await handlers['shell:restore-all'](shellSender(), PASS), { ok: true }, ui.errors.join(' | '));
  const after = openShamai().snapshot();
  assert.equal(after.shamai_v2_props, '["ישן"]', 'הנתונים מהגיבוי');
  assert.equal(after.shamai_v2_purchaseSeq, '8', 'שטר הקנייה הבא — 9, לא 6');
  assert.equal(after.shamai_v2_caseSeq, '3');
  assert.equal(after.shamai_v2_reportSeq, '12', 'מונה שלא היה בגיבוי נשמר');
});

test('ממצא 5 (main.js): גיבוי כלכלי ישן — האזהרה מונה את החשבוניות שהופקו אחריו', async () => {
  await boot();
  const db = require('../modules/econ/ipc').getDb();
  const old = await db.backup();
  const cur = await db.load();
  cur.invoices = [{ id: 'i1', number: 1, date: '2026-10-01', total: 100 }, { id: 'i2', number: 2, date: '2026-10-02', total: 100 }];
  cur.settings = { ...cur.settings, invoiceSeq: 2 };
  await db.save(cur);
  ui.open = backupFile('old-econ.ssbk', { scope: 'all', econ: old, localStorage: {} });
  ui.answer = 1; ui.boxes = [];
  await handlers['shell:restore-all'](shellSender(), PASS);
  assert.match(ui.boxes.find(b => /השחזור יחליף/.test(b.message)).detail, /חשבוניות — 2 \(אחרון: 2\)/);
});

test('ממצא 5 (המסך הכלכלי): שחזור גיבוי ישן מחזיר בקשת אישור ולא משחזר; אחרי האישור — משחזר', async () => {
  await boot();
  const db = require('../modules/econ/ipc').getDb();
  const ev = { sender: { id: econView().id } };
  await handlers['auth:login'](ev, 'menahel', 'menahel-pass-long-1');
  const cur = await db.load();
  assert.equal(cur.invoices.length, 2, 'מהבדיקה הקודמת');
  const oldEcon = { ...(await db.backup()), invoices: [], settings: { ...cur.settings, invoiceSeq: 0 } };
  const enc = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: oldEcon, localStorage: {} }), PASS);
  const r = await handlers['data:restoreEncrypted'](ev, enc, PASS);
  assert.equal(r.needsConfirm, true);
  assert.match(r.message, /חשבוניות — 2 \(אחרון: 2\)/);
  assert.equal((await db.load()).invoices.length, 2, 'לא שוחזר');
  assert.equal(await handlers['data:restoreEncrypted'](ev, enc, PASS, { confirmedOld: true }), true);
  const after = await db.load();
  assert.equal(after.invoices.length, 0);
  assert.equal(after.settings.invoiceSeq, 2, 'המונה נשמר (keepCounters)');
  // גיבוי עדכני — בלי בקשת אישור
  const fresh = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: await db.backup(), localStorage: {} }), PASS);
  assert.equal(await handlers['data:restoreEncrypted'](ev, fresh, PASS), true);
  const forms = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'forms.js'), 'utf8');
  assert.ok(forms.includes('r.needsConfirm') && forms.includes('confirmedOld: true'), 'המסך מבקש אישור ושולח שוב');
});
