'use strict';
// סקירת קוד 2.11.2026 — משתמשים באנדרואיד (main-android.js מעל הקוד הכלכלי האמיתי והתחליפים, כמו audit-android):
// יציאה / "👤 משתמש" / ניתוק אוטומטי כשהמסך הכלכלי פעיל ← econ:auth-check; משתמשים ויומן בגיבוי המלא ובשחזור
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { bundle } = require('../android/lib/bundle');
const { createNodeShims, createElectronShims } = require('../android/web/node-shims');
const BK = require('../modules/econ/core/backupCrypto');
const ZMANI_PASS = 'zmani-pass-long-1';

const ROOT = path.join(__dirname, '..');
const PASS = 'סיסמה-חזקה-123';
const BPASS = 'backup-pass-123';
const SENDERS = { econ: 2, shamai: 3, tools: 5 };

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
      if (enc) { const c = nodeCrypto.createCipheriv('aes-256-gcm', k, v); return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]).toString('base64'); }
      const c = nodeCrypto.createDecipheriv('aes-256-gcm', k, v);
      c.setAuthTag(d.subarray(d.length - 16));
      return Buffer.concat([c.update(d.subarray(0, d.length - 16)), c.final()]).toString('base64');
    }),
    dbOpen: wrap(() => { db = new DatabaseSync(':memory:'); return true; }),
    dbExec: wrap(sql => { db.exec(sql); return true; }),
    dbRun: wrap((sql, params) => { db.prepare(sql).run(...decode(params)); return true; }),
    dbAll: wrap((sql, params) => db.prepare(sql).all(...decode(params)).map(r => ({ ...r }))),
    writeUri: wrap(() => true), printHtml: wrap(() => true), exit: wrap(() => true),
    treeExists: wrap(() => false), treeMkdirs: wrap(() => true), treeWrite: wrap(() => true),
  };
}

async function bootAndroid() {
  const shims = createNodeShims(fakeBridge());
  const handlers = new Map();
  const electron = Object.assign({ ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} } },
    createElectronShims(shims, { bridgeAsync: async () => null }));
  const ext = { electron, fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url };
  const { code } = bundle({ 'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'), 'main-android': path.join(ROOT, 'android/web/main-android.js'),
    'auth-service': path.join(ROOT, 'modules/econ/services/authService.js') }, { root: ROOT, globalName: '__ssR3UsersAndroid' });
  new Function(code)();
  const host = globalThis.__ssR3UsersAndroid;
  delete globalThis.__ssR3UsersAndroid;
  const econ = host.require('econ-ipc', ext);
  await econ.initEcon('/data', { relayUrl: '' });
  const auth = host.require('auth-service', ext).AuthService;
  const sent = [], alerts = [], timers = {};
  const io = { openText: null, saved: null };
  const frames = {
    _f: new Set(), exists: id => frames._f.has(id), ensure: id => frames._f.add(id), setVisible() {}, setWriteBlock() {},
    onActivity() {}, whenReady: () => Promise.resolve(), send: (id, ch) => sent.push([id, ch]),
    request: async (id, type) => (type === 'ls-dump' ? {} : true), reloadAll() {},
    moduleSenderIds: () => [...frames._f].map(id => SENDERS[id]),
  };
  const api = host.require('main-android', ext).start({
    ipcMain: ext.electron.ipcMain, econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async (m, name, type, text) => {
      if (m === 'openText') return { text: io.openText };
      if (m === 'saveText') io.saved = text;
      return { ok: true };
    },
    senderOf: id => SENDERS[id], version: '9.9.9', ui: (() => { let o = {}; return { load: () => o, save: v => { o = v; } }; })(),
    alert: m => alerts.push(m), confirm: () => true, exit() {},
    setInterval: (fn, ms) => { timers[ms] = fn; return 0; },
  });
  const call = async (s, ch, ...a) => handlers.get(ch)({ sender: { id: s } }, ...a);
  return { econ, auth, api, call, frames, sent, alerts, timers, io };
}

let A;
test.before(async () => {
  A = await bootAndroid();
  A.frames.ensure('econ');
  await A.call(2, 'auth:setup', 'admin', PASS);
});
const flush = () => new Promise(r => setImmediate(r));
const authChecks = () => A.sent.filter(s => s[0] === 'econ' && s[1] === 'econ:auth-check').length;

test('אנדרואיד: יציאה ("👤 משתמש") כשהמסך הכלכלי פעיל ← econ:auth-check, והמסך מתרוקן', async () => {
  await A.call(2, 'auth:login', 'admin', PASS);
  assert.equal(await A.call(1, 'shell:switch', 'econ'), true);
  assert.equal(A.api.active, 'econ');
  const before = authChecks();
  await A.call(2, 'auth:logout');
  await flush();
  assert.equal(authChecks(), before + 1);
  // כניסה מחדש — לא שולחים
  await A.call(2, 'auth:login', 'admin', PASS);
  await flush();
  assert.equal(authChecks(), before + 1);
});

test('אנדרואיד: ניתוק אוטומטי כשהמסך הכלכלי פעיל ← econ:auth-check בבדיקה של כל דקה', async () => {
  await A.call(2, 'auth:login', 'admin', PASS);
  await A.call(1, 'shell:switch', 'econ');
  A.timers[60000](); // מצב התחלתי: מחובר
  let now = Date.now();
  const origNow = A.auth.now;
  A.auth.now = () => now;
  try {
    const before = authChecks();
    now += 16 * 60 * 1000;
    A.timers[60000]();
    await flush();
    assert.equal(A.api.active, 'econ');
    assert.equal(authChecks(), before + 1, 'המסך הכלכלי מקבל בדיקת כניסה ומרוקן את עצמו');
  } finally { A.auth.now = origNow; }
  await A.call(2, 'auth:login', 'admin', PASS);
});

test('אנדרואיד: הגיבוי המלא כולל משתמשים ויומן; השחזור ממזג, וגיבוי ישן בלעדיהם לא נוגע במשתמשים', async () => {
  await A.call(2, 'auth:login', 'admin', PASS);
  await A.call(2, 'users:create', { username: 'zmani', password: ZMANI_PASS, role: 'viewer' });
  assert.deepEqual(await A.call(1, 'shell:backup-all', BPASS, 'all'), { ok: true });
  const data = JSON.parse(BK.decryptBackup(A.io.saved, BPASS));
  assert.ok(data.users.users.some(u => u.username === 'zmani'));
  assert.ok(data.users.audit.some(a => a.action === 'users.create'));
  delete data.chat; // תיבת ההודעות (localStorage של ה-WebView) אינה בסביבת הבדיקה — נבדקת ב-backup-chat
  const db = A.econ.getDb();
  const names = async () => (await db.listUsers()).map(u => u.username).sort();
  const dropZmani = async () => { const z = (await db.listUsers()).find(u => u.username === 'zmani'); await db.run('DELETE FROM auth_users WHERE id = ?', [z.id]); };
  // גיבוי ישן בלי users
  await dropZmani();
  const old = { ...data };
  delete old.users;
  A.io.openText = BK.encryptBackup(JSON.stringify(old), BPASS);
  const r0 = await A.call(1, 'shell:restore-all', BPASS);
  assert.equal(r0.ok, true, JSON.stringify([r0, A.alerts.at(-1)]));
  assert.deepEqual(await names(), ['admin']);
  // הגיבוי המלא — המשתמש חוזר, המנהל נשאר
  A.io.openText = BK.encryptBackup(JSON.stringify(data), BPASS);
  assert.equal((await A.call(1, 'shell:restore-all', BPASS)).ok, true);
  assert.deepEqual(await names(), ['admin', 'zmani']);
  assert.match(A.alerts.at(-1), /השחזור הושלם[\s\S]*נוספו 1 משתמשים/);
  await assert.doesNotReject(A.call(5, 'auth:login', 'zmani', 'zmani-pass-long-1'));
  await assert.doesNotReject(A.call(2, 'auth:login', 'admin', PASS));
});
