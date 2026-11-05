// סקירת קוד 2.11.2026 — אנדרואיד: פסי המערכת (מקצה לקצה), גרסת WebView, configChanges וסגירת המסד,
// וגיבוי ושחזור למנהל בלבד. קוד ה-Java לא מהודר כאן (אין JDK) — נבדק רק טקסטואלית; הבדיקה בפועל ב-build-apk.bat ועל מכשיר.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { bundle } = require('../android/lib/bundle');
const { createNodeShims } = require('../android/web/node-shims');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const JAVA = 'android/app/java/com/bunimseller/supersuite/';

/* ---------- אנדרואיד 15: תוכן מתחת לפסי המערכת ---------- */

// גוף הכלל (בלי @media) של בורר מסוים — כל ההופעות
function rulesFor(css, selector) {
  const out = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].trim().split(',').map(s => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

test('mobile.css: ריפוד env(safe-area-inset-*) ב-.ss-top, .side ו-.ss-frames', () => {
  const css = read('android/web/mobile.css');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${side}`), side);
  }
  const top = rulesFor(css, '.ss-top');
  assert.match(top, /height:var\(--ss-top-h\)/, '.ss-top גבוה בגובה פס הסטטוס');
  assert.match(top, /padding:var\(--ss-inset-t\)/, '.ss-top — הכפתורים מתחת לפס הסטטוס');
  const side = rulesFor(css, '.side');
  assert.match(side, /padding-top:var\(--ss-inset-t\)/);
  assert.match(side, /padding-bottom:var\(--ss-inset-b\)/, 'שורת הכלים (גיבוי ושחזור) מעל פס הניווט');
  const frames = rulesFor(css, '.ss-frames');
  assert.match(frames, /inset:var\(--ss-top-h\) var\(--ss-inset-r\) var\(--ss-inset-b\) var\(--ss-inset-l\)/);
  assert.match(css, /--ss-top-h:calc\(var\(--ss-top\) \+ var\(--ss-inset-t\)\)/);
  assert.match(rulesFor(css, 'body'), /padding-top:var\(--ss-top-h\)/);
});

test('MainActivity: ריפוד לפי WindowInsets (מקצה לקצה) וסגירת המסד ב-onDestroy', () => {
  const act = read(JAVA + 'MainActivity.java');
  assert.match(act, /setOnApplyWindowInsetsListener/);
  assert.match(act, /WindowInsets\.Type\.systemBars\(\)/);
  assert.match(act, /WindowInsets\.Type\.ime\(\)/, 'מקצה לקצה adjustResize לא פועל — המקלדת בריפוד');
  assert.match(act, /setContentView\(edgeToEdgeRoot\(web\)\)/);
  const destroy = /protected void onDestroy\(\) \{([\s\S]*?)\n {4}\}/.exec(act);
  assert.ok(destroy, 'onDestroy');
  assert.match(destroy[1], /bridge\.close\(\)/);
  assert.match(read(JAVA + 'Bridge.java'), /void close\(\) \{ sql\.close\(\); \}/);
  // close לא נחשף ל-JS
  assert.doesNotMatch(read(JAVA + 'Bridge.java'), /@JavascriptInterface\s+void close/);
  assert.match(read(JAVA + 'SqlBridge.java'), /synchronized void close\(\) \{[\s\S]*?db\.close\(\)/);
});

test('AndroidManifest: גודל גופן, שפה וכיוון לא יוצרים את המסך מחדש', () => {
  const manifest = read('android/app/AndroidManifest.xml');
  const cfg = /android:configChanges="([^"]+)"/.exec(manifest)[1].split('|');
  for (const k of ['fontScale', 'locale', 'layoutDirection', 'orientation', 'screenSize', 'uiMode', 'density']) {
    assert.ok(cfg.includes(k), k);
  }
});

/* ---------- גרסת WebView מינימלית ---------- */

test('webview-check.js: WebView ישן (בלי structuredClone) ← הודעה בעברית על כל המסך', () => {
  const W = require('../android/web/webview-check.js');
  // WebView מודרני (Node כאן) — אין חסרים
  assert.deepEqual(W.missingFeatures(globalThis), []);
  // WebView 95 בערך: אין structuredClone
  const appended = [];
  const el = () => ({ style: {}, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.kids.push(c); } });
  const doc = { body: { appendChild: n => appended.push(n) }, createElement: el, createTextNode: t => ({ text: t }) };
  const old = { Object, Array, String, Promise, Intl, document: doc };
  const missing = W.check(old);
  assert.deepEqual(missing, ['structuredClone']);
  assert.deepEqual(old.__ssWebViewTooOld, ['structuredClone']);
  assert.equal(appended.length, 1);
  const text = JSON.stringify(appended[0]);
  assert.match(text, /Android System WebView/);
  assert.match(text, /לעדכן/);
  assert.equal(appended[0].attrs.dir, 'rtl');
  // מסמך שעוד לא נטען — ההודעה אחרי DOMContentLoaded
  let onReady = null;
  const doc2 = { body: null, documentElement: { appendChild: n => appended.push(n) }, createElement: el, createTextNode: t => ({ text: t }),
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') onReady = fn; } };
  W.check({ Object, Array, String, Promise, Intl, document: doc2 });
  assert.equal(typeof onReady, 'function');
  doc2.body = { appendChild: n => appended.push(n) };
  onReady();
  assert.equal(appended.length, 2);
});

test('webview-check.js: תחביר ישן (רץ גם ב-WebView ישן) ונטען לפני כל סקריפט במעטפת של אנדרואיד', () => {
  const src = read('android/web/webview-check.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|`|\?\.|\?\?|\bclass\b/, 'ES5 בלבד');
  // כסקריפט רגיל בדפדפן: this = window, בלי module
  const win = { Object, Array, String, Promise, Intl };
  vm.runInNewContext(src, Object.assign(win, { window: win }), { filename: 'webview-check.js' });
  const apk = read('android/build-apk.js');
  assert.match(apk, /\['webview-check\.js', 'node-shims\.js', 'host\.js', 'mobile\.js'\]/, 'הקובץ מועתק');
  // מוזרק לראש העמוד — לפני כל <script> של shell.html (כולן בגוף העמוד)
  const inject = /html = html\.replace\(\/<\\\/head>\/i, `([^`]*)`\)/.exec(apk);
  assert.ok(inject, 'הזרקה ל-</head>');
  assert.match(inject[1], /<script src="webview-check\.js"><\/script>/);
  const shell = read('shell/shell.html');
  assert.ok(shell.indexOf('</head>') < shell.indexOf('<script'), 'ב-shell.html אין סקריפט בראש העמוד');
});

/* ---------- גיבוי ושחזור — מנהל בלבד, גם באנדרואיד ---------- */

function fakeBridge() {
  let db = null;
  const ok = r => JSON.stringify({ r });
  const fail = e => JSON.stringify({ e: e.message });
  const wrap = fn => (...a) => { try { return ok(fn(...a)); } catch (e) { return fail(e); } };
  const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.t === 'b' ? Buffer.from(p.v, 'base64') : p.v));
  return {
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
    dbOpen: wrap(() => { db = new DatabaseSync(':memory:'); return true; }),
    dbExec: wrap(sql => { db.exec(sql); return true; }),
    dbRun: wrap((sql, params) => { db.prepare(sql).run(...decode(params)); return true; }),
    dbAll: wrap((sql, params) => db.prepare(sql).all(...decode(params)).map(r => ({ ...r }))),
    writeUri: wrap(() => true),
    printHtml: wrap(() => true)
  };
}

const ADMIN = ['admin', 'סיסמה-חזקה-123'];
const EDITOR = ['orech', 'orech-pass-long-12'];
const VIEWER = ['tsofe', 'tsofe-pass-long-12'];
let H = null;

test.before(async () => {
  const shims = createNodeShims(fakeBridge());
  const handlers = new Map();
  const ext = {
    electron: { ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} }, dialog: {}, BrowserWindow: class {} },
    fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url
  };
  const { code } = bundle({
    'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'),
    'main-android': path.join(ROOT, 'android/web/main-android.js')
  }, { root: ROOT, globalName: '__ssR3Host' });
  new Function(code)();
  const host = globalThis.__ssR3Host;
  delete globalThis.__ssR3Host;
  const econ = host.require('econ-ipc', ext);
  await econ.initEcon('/data');
  const ids = { econ: 2, shamai: 3, tools: 5 };
  const f = new Set(['econ']);
  const frames = {
    exists: id => f.has(id), ensure: id => f.add(id), setVisible() {}, whenReady: () => Promise.resolve(),
    send() {}, request: async () => true, reloadAll() {}, moduleSenderIds: () => [...f].map(id => ids[id])
  };
  const bridgeCalls = [];
  host.require('main-android', ext).start({
    ipcMain: ext.electron.ipcMain, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (...a) => { bridgeCalls.push(a); return { ok: true, name: 'x' }; },
    senderOf: id => ids[id],
    ui: (() => { let o = {}; return { load: () => o, save: v => { o = v; } }; })(),
    alert() {}, confirm: () => true, exit() {}
  });
  // שגיאה סינכרונית של השומר הופכת לדחייה
  const call = async (s, ch, ...a) => handlers.get(ch)({ sender: { id: s } }, ...a);
  await call(2, 'auth:setup', ...ADMIN);
  await call(2, 'auth:login', ...ADMIN);
  await call(2, 'users:create', { username: EDITOR[0], password: EDITOR[1], role: 'editor' });
  await call(2, 'users:create', { username: VIEWER[0], password: VIEWER[1], role: 'viewer' });
  H = { call, bridgeCalls };
});

for (const [label, who] of [['עורך', EDITOR], ['צופה', VIEWER]]) {
  test(`אנדרואיד: ${label} מחובר — גיבוי ידני, שחזור, קוד השחזור ויעד הגיבוי נדחים; is-admin = false`, async () => {
    await H.call(2, 'auth:login', ...who);
    const before = H.bridgeCalls.length;
    for (const [ch, ...args] of [['shell:backup-all', 'backup-pass-123', 'all'], ['shell:backup-all', 'backup-pass-123', 'econ'],
      ['shell:restore-all', 'backup-pass-123'], ['shell:get-recovery-code'], ['shell:recovery-code-saved'], ['shell:pick-backup-target']]) {
      await assert.rejects(H.call(1, ch, ...args), /אין הרשאה/, ch);
    }
    assert.equal(H.bridgeCalls.length, before, 'לא נפתח בוחר קבצים');
    assert.equal(await H.call(1, 'shell:is-admin'), false);
  });
}

test('אנדרואיד: מנהל מחובר — הגיבוי מותר (השומר עובר) ו-is-admin = true', async () => {
  await H.call(2, 'auth:login', ...ADMIN);
  assert.equal(await H.call(1, 'shell:is-admin'), true);
  const r = await H.call(1, 'shell:backup-all', 'backup-pass-123', 'all');
  assert.equal(r.ok, true);
});
