// "מה תרצה לעשות?" (סבב 5): המטען מהמעטפת למודול הכלכלי עובר גבול אמון — main.js האמיתי (Electron מדומה)
// מאמת אותו (משימה ושדות מוכרים, סוגים, אורך), בודק רישיון ותפקיד, ושולח econ:goto עם { view, task, prefill }.
// אותו דבר באנדרואיד (main-android.js מעל התחליפים). לא נשמר כלום — רק נפתח טופס
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { bundle } = require('../android/lib/bundle');
const { createNodeShims } = require('../android/web/node-shims');

const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r5-cmd-'));
test.after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* */ } });

/* ---------- main.js עם Electron מדומה (כמו tests/main-behavior.test.js) ---------- */
const handlers = {};
const created = { views: [], windows: [] };
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
  constructor() {
    this.id = created.views.length + 100;
    this.sent = [];
    created.views.push(this);
    this.webContents = chainable({ id: this.id, isDestroyed: () => false, isLoading: () => false, send: (...a) => this.sent.push(a) });
  }
  setVisible(v) { this.visible = v; }
  setBounds() {}
}
class BrowserWindowStub {
  constructor() { created.windows.push(this); this.contentView = { addChildView() {} }; this.webContents = chainable({ id: 1, isDestroyed: () => false }); }
  isDestroyed() { return false; } isMaximized() { return false; } isMinimized() { return false; }
  getBounds() { return { x: 0, y: 0, width: 1500, height: 940 }; }
  getNormalBounds() { return this.getBounds(); } getContentBounds() { return this.getBounds(); }
  getContentSize() { return [1500, 940]; }
  on() {} removeMenu() {} loadFile(p) { this.file = String(p); } maximize() {}
}
const electronStub = {
  app: chainable({ requestSingleInstanceLock: () => true, whenReady: () => ({ then: (fn) => { readyCallback = fn; return { catch() {} }; } }),
    getPath: () => userData, on() {}, exit() {}, quit() {}, isPackaged: false }),
  BrowserWindow: BrowserWindowStub, WebContentsView: WebContentsViewStub,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {} },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 1 }), showErrorBox() {} },
  protocol: chainable(), net: chainable(), session: chainable(), shell: chainable(), Menu: chainable(),
  safeStorage: chainable({ isEncryptionAvailable: () => false }),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? '/__electron_stub_r5cmd__.js' : origResolve.call(this, req, ...rest);
};
require.cache['/__electron_stub_r5cmd__.js'] = { id: '/__electron_stub_r5cmd__.js', filename: '/__electron_stub_r5cmd__.js', loaded: true, exports: electronStub };
const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms, ...rest).unref();
global.setInterval = (fn, ms, ...rest) => realSetInterval(fn, ms, ...rest).unref();

const shell = () => ({ sender: { id: 1 } });
const econView = () => created.views[0];
const asView = () => ({ sender: { id: econView().id } });
const flush = () => new Promise(r => realSetTimeout(r, 5));
let econ = null;

test.before(async () => {
  require(path.join(ROOT, 'main.js'));
  await readyCallback();
  econ = require(path.join(ROOT, 'modules/econ/ipc'));
  await handlers['shell:switch'](shell(), 'econ');
  await handlers['auth:setup'](asView(), 'menahel', 'menahel-pass-long-1'); // מחבר את המנהל הראשון
  await handlers['users:create'](asView(), { username: 'tzofe', password: 'tzofe-pass-long-1', role: 'viewer' });
});
const logout = () => require(path.join(ROOT, 'modules/econ/services/authService')).AuthService.sessions.clear();
const login = (u, p) => handlers['auth:login'](asView(), u, p);

test('main.js: מטען תקין ← econ:goto עם { view, task, prefill } (רק השדות שאומתו)', async () => {
  await login('menahel', 'menahel-pass-long-1');
  const before = econView().sent.length;
  const r = await handlers['shell:start-task'](shell(), 'donation', { name: '  משה   כהן ', amount: '500', date: '2026-11-05' });
  assert.deepEqual(r, { ok: true });
  await flush();
  const msg = econView().sent.slice(before).find(a => a[0] === 'econ:goto');
  assert.deepEqual(msg, ['econ:goto', { view: 'npo', task: 'donation', prefill: { name: 'משה כהן', amount: '500', date: '2026-11-05' } }]);
  // תצוגה רגילה (מחרוזת) — כמו קודם
  await handlers['shell:open'](shell(), 'econ', 'acct-invoices');
  await flush();
  assert.deepEqual(econView().sent.at(-1), ['econ:goto', 'acct-invoices']);
});

test('main.js: מטען לא תקין נדחה כולו, ולא נשלח דבר למודול', async () => {
  await login('menahel', 'menahel-pass-long-1');
  const before = econView().sent.length;
  const bad = [
    ['evil', {}], ['toString', {}], [null, {}], [{ id: 'donation' }, {}],
    ['donation', { name: 'x', evil: 1 }], ['donation', { phone: '0521234567' }], ['donation', { amount: 500 }],
    ['donation', { amount: '1e9' }], ['donation', { date: '2026-13-01' }], ['donation', { name: 'א'.repeat(500) }],
    ['donation', JSON.parse('{"__proto__":{"admin":true}}')], ['donation', ['x']], ['donation', 'name=x'],
    ['backup', {}], // פעולת מעטפת — אין טופס
  ];
  for (const [id, p] of bad) assert.deepEqual(await handlers['shell:start-task'](shell(), id, p), { ok: false, reason: 'invalid' }, JSON.stringify([id, p]));
  await flush();
  assert.equal(econView().sent.length, before);
});

test('main.js: רק מהמעטפת — מודול לא מתחיל משימה ולא שואל מה מותר', async () => {
  assert.deepEqual(await handlers['shell:start-task'](asView(), 'donation', {}), { ok: false, reason: 'sender' });
  assert.deepEqual(await handlers['shell:start-task']({ sender: { id: 999 } }, 'donation', {}), { ok: false, reason: 'sender' });
  assert.deepEqual(await handlers['shell:task-access'](asView()), []);
});

test('main.js: תפקיד — מנהל: הכול כולל גיבוי; צופה: כלום (וגם לא נפתח); לפני כניסה — בלי גיבוי', async () => {
  await login('menahel', 'menahel-pass-long-1');
  assert.deepEqual(await handlers['shell:task-access'](shell()), ['donation', 'receipt', 'expense', 'invoice', 'loanPayment', 'gemachLoan', 'contact', 'backup']);
  logout();
  await login('tzofe', 'tzofe-pass-long-1');
  assert.deepEqual(await handlers['shell:task-access'](shell()), []);
  assert.deepEqual(await handlers['shell:start-task'](shell(), 'donation', { name: 'משה' }), { ok: false, reason: 'not-allowed' });
  logout();
  const anon = await handlers['shell:task-access'](shell());
  assert.ok(anon.includes('donation') && !anon.includes('backup'), JSON.stringify(anon));
});

test('main.js: רישיון — רק התחומים שברישיון; קריאה בלבד — אין משימות', async () => {
  await login('menahel', 'menahel-pass-long-1');
  const orig = econ.licenseState;
  try {
    econ.licenseState = () => ({ mode: 'licensed', status: 'active', features: ['econ', 'econ.npo'] });
    const ids = await handlers['shell:task-access'](shell());
    assert.ok(ids.includes('donation') && ids.includes('contact'), JSON.stringify(ids));
    for (const id of ['invoice', 'receipt', 'expense', 'loanPayment', 'gemachLoan']) assert.ok(!ids.includes(id), id);
    assert.deepEqual(await handlers['shell:start-task'](shell(), 'invoice', {}), { ok: false, reason: 'not-allowed' });
    econ.licenseState = () => ({ mode: 'licensed', status: 'trial_ended', features: ['econ', 'econ.npo', 'econ.accounting'] });
    assert.deepEqual((await handlers['shell:task-access'](shell())).filter(id => id !== 'backup'), []);
  } finally { econ.licenseState = orig; }
});

test('המודול הכלכלי: preload מעביר גם אובייקט; core.js — econStartTask אם קיים, אחרת התצוגה; אחרי כניסה — המשימה', () => {
  const pre = fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(pre, /typeof view === 'string' \|\| \(!!view && typeof view === 'object' && typeof view\.view === 'string'\)/);
  const core = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/core.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(core, /function openShellRequest\(req\) \{\n\s+if \(req\.task && typeof window\.econStartTask === 'function'\) return window\.econStartTask\(req\.task, req\.prefill \|\| \{\}, req\.view\);\n\s+return switchView\(req\.view, \{ focus: true \}\);/);
  assert.match(core, /state\.requestedTask = req\.task \? req : null/);
  assert.match(core, /if \(task\) await openShellRequest\(task\);/);
});

/* ---------- אנדרואיד: אותם כללים ---------- */
function fakeBridge() {
  let db = null;
  const ok = r => JSON.stringify({ r });
  const fail = e => JSON.stringify({ e: e.message });
  const wrap = fn => (...a) => { try { return ok(fn(...a)); } catch (e) { return fail(e); } };
  const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.t === 'b' ? Buffer.from(p.v, 'base64') : p.v));
  return {
    calls: [],
    randomBytes: wrap(n => nodeCrypto.randomBytes(n).toString('base64')),
    scrypt: wrap((pw, salt, N, r, p, len) => nodeCrypto.scryptSync(Buffer.from(pw, 'base64'), Buffer.from(salt, 'base64'), len, { N, r, p, maxmem: 256 * 1024 * 1024 }).toString('base64')),
    aesGcm: wrap((enc, key, iv, data) => {
      const k = Buffer.from(key, 'base64'), v = Buffer.from(iv, 'base64'), d = Buffer.from(data, 'base64');
      if (enc) { const c = nodeCrypto.createCipheriv('aes-256-gcm', k, v); return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]).toString('base64'); }
      const c = nodeCrypto.createDecipheriv('aes-256-gcm', k, v);
      c.setAuthTag(d.subarray(d.length - 16));
      return Buffer.concat([c.update(d.subarray(0, d.length - 16)), c.final()]).toString('base64');
    }),
    dbOpen: wrap(() => { db = new DatabaseSync(':memory:'); return true; }),
    dbExec: wrap(sql => { db.exec(sql); return true; }),
    dbRun: wrap((sql, params) => { db.prepare(sql).run(...decode(params)); return true; }),
    dbAll: wrap((sql, params) => db.prepare(sql).all(...decode(params)).map(r => ({ ...r }))),
    writeUri: wrap(() => true), printHtml: wrap(() => true),
  };
}

test('אנדרואיד: shell:start-task / shell:task-access — אותו אימות, אותה הרשאה, אותו econ:goto', async () => {
  const shims = createNodeShims(fakeBridge());
  const amap = new Map();
  const electron = { ipcMain: { handle: (c, fn) => amap.set(c, fn), on() {} },
    dialog: { async showSaveDialog() { return { canceled: true }; }, async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    BrowserWindow: class {} };
  const ext = { electron, fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url };
  const { code } = bundle({ 'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'), 'main-android': path.join(ROOT, 'android/web/main-android.js') },
    { root: ROOT, globalName: '__ssR5Cmd' });
  new Function(code)();
  const host = globalThis.__ssR5Cmd; delete globalThis.__ssR5Cmd;
  const aecon = host.require('econ-ipc', ext);
  await aecon.initEcon('/data');
  const sent = [];
  const frames = { _f: new Set(), exists: id => frames._f.has(id), ensure: id => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send: (id, ch, ...a) => sent.push([id, ch, ...a]), request: async () => true, reloadAll() {},
    moduleSenderIds: () => [...frames._f].map(id => ({ econ: 2, shamai: 3, tools: 5 })[id]) };
  host.require('main-android', ext).start({ ipcMain: electron.ipcMain, econ: aecon, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async () => ({ ok: true }), senderOf: id => ({ econ: 2, shamai: 3, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: v => { o = v; } }; })(), alert() {}, confirm: () => true, exit() {} });
  const call = (s, ch, ...a) => amap.get(ch)({ sender: { id: s } }, ...a);
  await call(1, 'shell:switch', 'econ');
  await call(2, 'auth:setup', 'admin', 'סיסמה-חזקה-123');
  assert.ok((await call(1, 'shell:task-access')).includes('backup'));
  assert.deepEqual(await call(3, 'shell:start-task', 'donation', {}), { ok: false, reason: 'sender' });
  assert.deepEqual(await call(1, 'shell:start-task', 'donation', { evil: 1 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await call(1, 'shell:start-task', 'donation', { amount: 5 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await call(1, 'shell:start-task', 'expense', { amount: '200', note: 'חשמל' }), { ok: true });
  await new Promise(r => realSetTimeout(r, 5));
  assert.deepEqual(sent.at(-1), ['econ', 'econ:goto', { view: 'acct-journal', task: 'expense', prefill: { amount: '200', note: 'חשמל' } }]);
  // הקבצים נארזים לאנדרואיד ונטענים לפני shell.js
  const apk = fs.readFileSync(path.join(ROOT, 'android/build-apk.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(apk, /'simple-mode\.js', 'tasks\.js', 'intents\.js'[,\]]/);
  // המהדורה (shell/edition.js) — tasks.js, catalog.js ו-onboarding.js נשענים עליה גם באנדרואיד
  assert.match(apk, /'edition-id\.js', 'edition\.js'\]/);
  const html = fs.readFileSync(path.join(ROOT, 'shell/shell.html'), 'utf8').replace(/\r\n/g, '\n');
  for (const f of ['tasks.js', 'intents.js']) assert.ok(html.indexOf(`src="${f}"`) > 0 && html.indexOf(`src="${f}"`) < html.indexOf('src="shell.js"'), f);
  assert.ok(html.indexOf('src="tasks.js"') < html.indexOf('src="intents.js"'));
});
