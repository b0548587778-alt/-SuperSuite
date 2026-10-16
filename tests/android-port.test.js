// גרסת אנדרואיד: הקוד הכלכלי המקורי רץ דרך התחליפים (android/web/node-shims.js) מעל גשר Java מדומה.
// הגשר המדומה ממומש כאן על node:sqlite ו-crypto של Node — כך נבדקים ה-shims, המאגד והחיבור של main-android.js.
// מה שלא נבדק כאן (דורש מכשיר): קוד ה-Java עצמו, ה-WebView וה-iframes.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { bundle } = require('../android/lib/bundle');
const { createNodeShims } = require('../android/web/node-shims');
const BKnode = require('../modules/econ/core/backupCrypto');

const ROOT = path.join(__dirname, '..');

function fakeBridge() {
  let db = null;
  const ok = r => JSON.stringify({ r });
  const fail = e => JSON.stringify({ e: e.message });
  const wrap = fn => (...a) => { try { return ok(fn(...a)); } catch (e) { return fail(e); } };
  const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.t === 'b' ? Buffer.from(p.v, 'base64') : p.v));
  const calls = [];
  return {
    calls,
    randomBytes: wrap(n => nodeCrypto.randomBytes(n).toString('base64')),
    scrypt: wrap((pw, salt, N, r, p, len) => nodeCrypto.scryptSync(Buffer.from(pw, 'base64'), Buffer.from(salt, 'base64'), len, { N, r, p, maxmem: 256 * 1024 * 1024 }).toString('base64')),
    aesGcm: wrap((enc, key, iv, data) => {
      const k = Buffer.from(key, 'base64'), v = Buffer.from(iv, 'base64'), d = Buffer.from(data, 'base64');
      if (enc) {
        const c = nodeCrypto.createCipheriv('aes-256-gcm', k, v);
        return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]).toString('base64');
      }
      const c = nodeCrypto.createDecipheriv('aes-256-gcm', k, v);
      c.setAuthTag(d.subarray(d.length - 16));
      return Buffer.concat([c.update(d.subarray(0, d.length - 16)), c.final()]).toString('base64');
    }),
    dbOpen: wrap(name => { calls.push(['open', name]); db = new DatabaseSync(':memory:'); return true; }),
    dbExec: wrap(sql => { db.exec(sql); return true; }),
    dbRun: wrap((sql, params) => { db.prepare(sql).run(...decode(params)); return true; }),
    dbAll: wrap((sql, params) => db.prepare(sql).all(...decode(params)).map(r => ({ ...r }))),
    writeUri: wrap((uri, b64) => { calls.push(['write', uri, Buffer.from(b64, 'base64').toString('utf8')]); return true; }),
    printHtml: wrap((html) => { calls.push(['print', html]); return true; })
  };
}

function loadHost() {
  const { code } = bundle({
    'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'),
    'main-android': path.join(ROOT, 'android/web/main-android.js')
  }, { root: ROOT, globalName: '__ssTestHost' });
  new Function(code)();
  const host = globalThis.__ssTestHost;
  delete globalThis.__ssTestHost;
  return host;
}

async function boot() {
  const bridge = fakeBridge();
  const shims = createNodeShims(bridge);
  const handlers = new Map();
  const saved = [];
  const electron = {
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} },
    dialog: {
      async showSaveDialog(o) { const name = o.defaultPath; shims.fs._register(name, 'content://test/' + name); saved.push(name); return { canceled: false, filePath: name }; },
      async showOpenDialog() { return { canceled: true, filePaths: [] }; }
    },
    BrowserWindow: class { constructor() { this.webContents = { printToPDF: async () => ({ __printHtml: this.html }) }; } async loadURL(u) { this.html = shims.Buffer.from(u.split(',')[1], 'base64').toString('utf8'); } destroy() {} }
  };
  const ext = { electron, fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url };
  const host = loadHost();
  const econ = host.require('econ-ipc', ext);
  await econ.initEcon('/data');
  const call = (sender, ch, ...a) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error('no handler ' + ch);
    return fn({ sender: { id: sender } }, ...a);
  };
  return { bridge, shims, handlers, econ, host, ext, call, saved };
}

test('Buffer בתחליף: hex/base64/utf8/latin1 זהים ל-Node', () => {
  const { Buffer: B } = createNodeShims(fakeBridge());
  for (const s of ['', 'a', 'ab', 'abc', 'שלום עולם ✓', '\u0000ÿ']) {
    const nb = Buffer.from(s, 'utf8');
    const sb = B.from(s, 'utf8');
    assert.strictEqual(sb.toString('base64'), nb.toString('base64'));
    assert.strictEqual(sb.toString('hex'), nb.toString('hex'));
    assert.strictEqual(B.from(nb.toString('base64'), 'base64').toString('utf8'), s);
    assert.strictEqual(B.from(nb.toString('hex'), 'hex').toString(), s);
  }
  assert.strictEqual(B.from('é', 'latin1').toString('utf8'), Buffer.from('é', 'latin1').toString('utf8'));
});

test('גיבוי מוצפן: תואם בשני הכיוונים בין אנדרואיד לשולחן העבודה', () => {
  const shims = createNodeShims(fakeBridge());
  const host = bundle({ bk: path.join(ROOT, 'modules/econ/core/backupCrypto.js') }, { root: ROOT, globalName: '__ssBk' });
  new Function(host.code)();
  const BKa = globalThis.__ssBk.require('bk', { crypto: shims.crypto });
  delete globalThis.__ssBk;
  const plain = JSON.stringify({ שם: 'ישראל', n: 42 });
  assert.strictEqual(BKnode.decryptBackup(BKa.encryptBackup(plain, 'pass-word-1'), 'pass-word-1'), plain);
  assert.strictEqual(BKa.decryptBackup(BKnode.encryptBackup(plain, 'pass-word-1'), 'pass-word-1'), plain);
  assert.throws(() => BKa.decryptBackup(BKnode.encryptBackup(plain, 'pass-word-1'), 'wrong-pass-1'), /שגויה/);
});

test('המודול הכלכלי עולה מעל ה-shims: הקמת מנהל, כניסה, הרשאות, נתונים', async () => {
  const { call, bridge } = await boot();
  assert.deepStrictEqual(bridge.calls[0], ['open', '/data/unified_economics.db']);
  const S = 2;
  await assert.rejects(() => call(S, 'contacts:get'), /נדרשת כניסה/);
  await call(S, 'auth:setup', 'admin', 'סיסמה-חזקה-123');
  // יצירת המנהל הראשון מחברת אותו; אחרי יציאה — שוב נדרשת כניסה
  await call(S, 'auth:logout');
  await assert.rejects(() => call(S, 'contacts:get'), /נדרשת כניסה/);
  await assert.rejects(() => call(S, 'auth:login', 'admin', 'wrong-password-xx'), /.+/);
  await call(S, 'auth:login', 'admin', 'סיסמה-חזקה-123');
  await call(S, 'contacts:create', { name: 'משה כהן', phone: '050-0000000' });
  const contacts = await call(S, 'contacts:get');
  assert.ok(contacts.contacts.some(c => c.name === 'משה כהן'));
  // שולח אחר (iframe אחר) לא יורש את הכניסה
  await assert.rejects(() => call(3, 'contacts:get'), /נדרשת כניסה/);
});

test('גיבוי/שחזור מהמודול הכלכלי וייצוא CSV דרך בוחר הקבצים', async () => {
  const { call, bridge, saved } = await boot();
  await call(2, 'auth:setup', 'admin', 'סיסמה-חזקה-123');
  await call(2, 'auth:login', 'admin', 'סיסמה-חזקה-123');
  await call(2, 'contacts:create', { name: 'אהרן לוי' });
  const enc = await call(2, 'data:backupEncrypted', 'backup-pass-1');
  assert.ok(BKnode.isEncryptedBackup(enc));
  const data = JSON.parse(BKnode.decryptBackup(enc, 'backup-pass-1')); // נפתח בשולחן העבודה
  assert.ok(JSON.stringify(data.contacts).includes('אהרן לוי'));
  await call(2, 'data:restoreEncrypted', enc, 'backup-pass-1');
  const r = await call(2, 'acct:exportCsv', 'journal', {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(saved.length, 1);
  const w = bridge.calls.find(c => c[0] === 'write');
  assert.ok(w && w[1].startsWith('content://test/'));
});

test('main-android: ניווט, הרשאת מעטפת וגיבוי מוצפן בלבד', async () => {
  const { econ, host, ext, handlers } = await boot();
  const visible = {}, sent = [], emitted = [];
  const frames = {
    _f: new Set(),
    exists: id => frames._f.has(id),
    ensure: id => frames._f.add(id),
    setVisible: (id, on) => { visible[id] = on; },
    whenReady: () => Promise.resolve(),
    send: (id, ch, ...a) => sent.push([id, ch, ...a]),
    request: async (id, type) => (type === 'ls-dump' ? { k: 'v-' + id } : true),
    reloadAll() {},
    moduleSenderIds: () => [...frames._f].map(id => ({ econ: 2, shamai: 3, trainer: 4, tools: 5 })[id])
  };
  let savedText = null;
  host.require('main-android', ext).start({
    ipcMain: ext.electron.ipcMain, econ, frames, SHELL_ID: 1,
    emitShell: (...a) => emitted.push(a),
    bridgeAsync: async (m, name, mime, text) => { savedText = { m, name, text }; return { ok: true, name }; },
    senderOf: id => ({ econ: 2, shamai: 3, trainer: 4, tools: 5 })[id],
    ui: (() => { let o = {}; return { load: () => o, save: v => { o = v; } }; })(),
    alert() {}, confirm: () => true, exit() {}
  });
  const call = async (s, ch, ...a) => handlers.get(ch)({ sender: { id: s } }, ...a);
  // מודול לא יכול להשתמש בערוצי המעטפת
  assert.strictEqual(await call(3, 'shell:switch', 'econ'), false);
  assert.strictEqual(await call(1, 'shell:open', 'econ', 'acct-invoices'), true);
  assert.strictEqual(visible.econ, true);
  assert.deepStrictEqual(sent.at(-1), ['econ', 'econ:goto', 'acct-invoices']);
  assert.strictEqual(await call(1, 'shell:open', 'econ', 'no-such-view'), false);
  // תצוגה ממודול אחר לא מתקבלת כדיווח של הכלכלי
  assert.strictEqual(await call(3, 'shell:econ-view', 'acct-invoices'), false);
  // גיבוי מהמעטפת דורש כניסה במודול הכלכלי
  await assert.rejects(() => call(1, 'shell:backup-all', 'backup-pass-1', 'all'), /נדרשת כניסה/);
  await call(2, 'auth:setup', 'admin', 'סיסמה-חזקה-123');
  await call(2, 'auth:login', 'admin', 'סיסמה-חזקה-123');
  await assert.rejects(() => call(3, 'shell:backup-all', 'backup-pass-1', 'all'), /מתוך המעטפת/);
  assert.deepStrictEqual(await call(1, 'shell:backup-all', 'backup-pass-1', 'all'), { ok: true });
  assert.ok(BKnode.isEncryptedBackup(savedText.text), 'הגיבוי נשמר מוצפן בלבד');
  const full = JSON.parse(BKnode.decryptBackup(savedText.text, 'backup-pass-1'));
  assert.strictEqual(full.suite, 'SuperSuite');
  assert.deepStrictEqual(full.localStorage.shamai, { k: 'v-shamai' });
  await assert.rejects(() => call(1, 'shell:pick-backup-target'), /אין גיבוי אוטומטי/);
});

test('frame.js ו-host.js: אימות origin בהודעות', () => {
  const frame = fs.readFileSync(path.join(ROOT, 'android/web/frame.js'), 'utf8');
  assert.match(frame, /e\.source !== window\.parent \|\| e\.origin !== SHELL_ORIGIN/);
  const host = fs.readFileSync(path.join(ROOT, 'android/web/host.js'), 'utf8');
  assert.match(host, /e\.origin !== originOf\(id\)/);
  // כל קריאה לגשר עוברת עם האסימון
  assert.match(host, /BRIDGE\[m\]\(token, \.\.\.a\)/);
});

test('בניית קבצי ה-web לאנדרואיד: הזרקה למודולים ו-CSP של המעטפת', () => {
  const B = require('../android/build-apk');
  B.buildWeb();
  const shell = fs.readFileSync(path.join(B.WWW, 'shell', 'shell.html'), 'utf8');
  assert.match(shell, /frame-src https:\/\/econ\.supersuite\.androidplatform\.net/);
  assert.doesNotMatch(shell, /unsafe-eval/);
  assert.ok(shell.indexOf('host.js') < shell.indexOf('shell.js'));
  for (const [mod, entry] of [['econ', 'views/index.html'], ['shamai', 'index.html'], ['trainer', 'index.html'], ['tools', 'index.html']]) {
    const html = fs.readFileSync(path.join(B.WWW, mod, entry), 'utf8');
    const i = html.indexOf('/ss-android/frame.js');
    assert.ok(i > 0, mod + ': frame.js מוזרק');
    assert.ok(i < html.search(/<script[^>]+src="(?!\/ss-android)/), mod + ': frame.js לפני סקריפטים של הדף');
  }
  // אין קוד צד-שרת של הכלכלי בתוך ה-iframe
  assert.ok(!fs.existsSync(path.join(B.WWW, 'econ', 'core')));
});
