// בדיקת קוד 23.10.2026 — אנדרואיד: ממצאים 32, 56, 57 והממצאים הנמוכים של אנדרואיד.
// host.js רץ כאן כמו שהוא (vm עם window/document מדומים) מעל הקוד הכלכלי האמיתי והתחליפים (node-shims.js),
// כך שגם ה-Buffer המדומה הוא ה-Buffer של הקוד הכלכלי — כמו ב-WebView.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { bundle } = require('../android/lib/bundle');
const { createNodeShims, createElectronShims } = require('../android/web/node-shims');
const { createRelayFetch, relayOrigin } = require('../android/web/relay-fetch');
const MA = require('../android/web/main-android');
const BK = require('../modules/econ/core/backupCrypto');
const UF = require('../modules/econ/core/uniformFile');
const LG = require('../shell/licensing/gate');
const { createRemote } = require('../shell/licensing/remote');
const L = require('../shell/licensing/license');
const { DEFAULT_RELAY_URL } = require('../shell/licensing/default-relay');
const EconUI = require('./helpers/econ-ui');

const ROOT = path.join(__dirname, '..');
const DOMAIN = 'supersuite.androidplatform.net';
const origin = id => `https://${id}.${DOMAIN}`;
const PASS = 'סיסמה-חזקה-123';

/* ---------- גשר Java מדומה (node:sqlite + crypto של Node) ---------- */
function fakeBridge() {
  let db = null;
  const ok = r => JSON.stringify({ r });
  const fail = e => JSON.stringify({ e: e.message });
  const wrap = fn => (...a) => { try { return ok(fn(...a)); } catch (e) { return fail(e); } };
  const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.t === 'b' ? Buffer.from(p.v, 'base64') : p.v));
  const writes = [];
  const tree = new Map(); // uri|נתיב ← בתים
  const dirs = new Set();
  const prints = [];
  return {
    writes, tree, dirs, prints,
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
    writeUri: wrap((uri, b64) => { writes.push([uri, Buffer.from(b64, 'base64')]); return true; }),
    printHtml: wrap(html => { prints.push(html); return true; }),
    exit: wrap(() => true),
    treeExists: wrap((uri, rel) => tree.has(uri + '|' + rel) || dirs.has(uri + '|' + rel)),
    treeMkdirs: wrap((uri, rel) => { dirs.add(uri + '|' + rel); return true; }),
    treeWrite: wrap((uri, rel, b64) => { tree.set(uri + '|' + rel, Buffer.from(b64, 'base64')); return true; }),
  };
}

/* ---------- host.js בתוך vm ---------- */
const TOKEN = 'a'.repeat(64);
let hostCode = null;
function hostBundle() {
  if (!hostCode) {
    hostCode = bundle({
      'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'),
      'main-android': path.join(ROOT, 'android/web/main-android.js'),
      'shell-preload': path.join(ROOT, 'shell/preload.js'),
      // אותו מופע ש-ipc.js משתמש בו (לבדיקת הפגישה)
      'auth-service': path.join(ROOT, 'modules/econ/services/authService.js'),
    }, { root: ROOT, globalName: '__ssHost' }).code;
  }
  return hostCode;
}

function loadHost({ relay, folder = 'Download' } = {}) {
  const base = fakeBridge();
  const asyncCalls = [];
  let sandbox;
  const later = (cb, value) => setTimeout(() => sandbox.__ssAndroidCb(cb, JSON.stringify(value)), 5);
  // פעולות אסינכרוניות (בוחר קבצים, שרת הרישוי): התשובה חוזרת ב-__ssAndroidCb, כמו ב-MainActivity
  const ASYNC = {
    saveText: (cb, name, mime, text) => { asyncCalls.push(['saveText', name, text]); later(cb, { ok: true, name }); },
    saveBytes: (cb, name) => { asyncCalls.push(['saveBytes', name]); later(cb, { ok: true, name }); },
    createDocument: (cb, name) => { asyncCalls.push(['createDocument', name]); later(cb, { uri: 'content://doc/' + name, name }); },
    openText: cb => { asyncCalls.push(['openText']); later(cb, {}); },
    pickFolder: cb => { asyncCalls.push(['pickFolder']); later(cb, { uri: 'content://tree/' + folder, name: folder }); },
    relayPost: (cb, o, body) => { asyncCalls.push(['relayPost', o, body]); later(cb, relay ? relay(o, body) : { error: 'אין רשת' }); },
  };
  const bridge = {};
  for (const [k, fn] of Object.entries(base)) if (typeof fn === 'function') bridge[k] = (t, ...a) => (t === TOKEN ? fn(...a) : JSON.stringify({ e: 'forbidden' }));
  for (const [k, fn] of Object.entries(ASYNC)) bridge[k] = (t, ...a) => { if (t !== TOKEN) return JSON.stringify({ e: 'forbidden' }); fn(...a); return JSON.stringify({ r: true }); };

  const created = [];
  const storage = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(String(k), String(v)),
    removeItem: k => storage.delete(k), clear: () => storage.clear(), key: i => [...storage.keys()][i] ?? null,
    get length() { return storage.size; },
  };
  const listeners = {};
  sandbox = {
    console, setTimeout, clearTimeout, clearInterval, queueMicrotask, structuredClone, TextEncoder, TextDecoder, URL, AbortController,
    crypto: nodeCrypto.webcrypto,
    setInterval: () => ({ unref() {} }), // בלי טיימרים אמיתיים בבדיקה
    localStorage,
    location: { host: 'shell.' + DOMAIN, protocol: 'https:' },
    document: {
      addEventListener() {},
      createElement() {
        const el = { posted: [], hidden: false, setAttribute() {} };
        el.contentWindow = { postMessage: (msg, o) => el.posted.push({ msg, o }) };
        created.push(el);
        return el;
      },
      getElementById: () => ({ appendChild() {} }),
      body: { appendChild() {} },
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    alerts: [],
    SuperSuiteBridge: bridge,
    __ssBuildInfo: { version: '9.9.9', econExtras: [], about: { license: 'רישיון', eula: 'הסכם', notices: 'רכיבים' } },
  };
  sandbox.window = sandbox;
  sandbox.alert = m => sandbox.alerts.push(m);
  sandbox.confirm = () => true;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'android/web/node-shims.js'), 'utf8'), sandbox);
  vm.runInContext(hostBundle(), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'android/web/host.js'), 'utf8'), sandbox);

  const frameOf = id => created.find(el => String(el.src || '').startsWith(origin(id)));
  const post = (id, data) => listeners.message({ source: frameOf(id).contentWindow, origin: origin(id), data });
  const wait = async (cond, what) => {
    for (let i = 0; i < 400; i++) { const v = cond(); if (v) return v; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('timeout: ' + what);
  };
  let seq = 1000;
  // קריאה מתוך iframe של מודול (כמו frame.js) — מחזירה את התשובה של המעטפת
  async function frameInvoke(id, channel, ...args) {
    const rid = ++seq;
    post(id, { ss: 'invoke', id: rid, channel, args });
    const r = await wait(() => frameOf(id).posted.find(p => p.msg.ss === 'reply' && p.msg.id === rid), channel);
    return r.msg;
  }
  // המודול נטען (frame.js שולח ready)
  const ready = async id => { await wait(() => frameOf(id), 'frame ' + id); post(id, { ss: 'ready' }); };
  return { sandbox, base, asyncCalls, created, frameOf, post, wait, frameInvoke, ready, shellAPI: () => sandbox.shellAPI };
}

async function bootHost(opts) {
  const h = loadHost(opts);
  h.sandbox.__ssSetToken(TOKEN);
  await h.shellAPI().isLoggedIn(); // ממתין ש-initEcon ו-main-android יסיימו
  await h.shellAPI().open('econ', null);
  await h.ready('econ');
  const setup = await h.frameInvoke('econ', 'auth:setup', 'admin', PASS);
  assert.equal(setup.ok, true, setup.error);
  return h;
}

/* ---------- ממצא 56: קידוד בכתיבת קובץ ---------- */
test('ממצא 56: writeFileSync מכבד latin1 / ascii — קובץ מס"ב נשמר בית לכל תו (128 תווים = 128 בתים)', () => {
  const bridge = fakeBridge();
  const shims = createNodeShims(bridge);
  // תווי CP862 (0x80–0x9A) כמו בקובץ החיובים, ותו לטיני מעל 0x7F
  const line = 'K' + String.fromCharCode(0x80, 0x8a, 0x9a) + 'é'.padEnd(124, ' ');
  assert.equal(line.length, 128);
  shims.fs._register('masav.txt', 'content://doc/masav.txt');
  shims.fs.writeFileSync('masav.txt', line, 'latin1');
  shims.fs._register('masav2.txt', 'content://doc/masav2.txt');
  shims.fs.writeFileSync('masav2.txt', line, { encoding: 'latin1' });
  shims.fs._register('pcn.txt', 'content://doc/pcn.txt');
  shims.fs.writeFileSync('pcn.txt', 'O123', 'ascii');
  const [a, b, c] = bridge.writes.map(w => w[1]);
  assert.equal(a.length, 128);
  assert.deepEqual(a, Buffer.from(line, 'latin1'));
  assert.deepEqual(b, Buffer.from(line, 'latin1'));
  assert.deepEqual(c, Buffer.from('O123', 'ascii'));
  // בלי קידוד — UTF-8 כמו ב-Node
  shims.fs._register('u.csv', 'content://doc/u.csv');
  shims.fs.writeFileSync('u.csv', 'שלום');
  assert.deepEqual(bridge.writes.at(-1)[1], Buffer.from('שלום', 'utf8'));
});

/* ---------- ממצא 39: חלון השמירה והכתיבה כבר לא ברצף אחד בתור (handleSave) ---------- */
test('ממצא 39 (סקירה): שני ייצואי PDF במקביל — שני החלונות ואחריהם שתי הכתיבות, שתיהן מגיעות למסך ההדפסה', async () => {
  const bridge = fakeBridge();
  const shims = createNodeShims(bridge);
  const { dialog, BrowserWindow } = createElectronShims(shims, { bridgeAsync: async () => null });
  const pdf = async (html) => {
    const w = new BrowserWindow();
    await w.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
    return w.webContents.printToPDF();
  };
  const a = await dialog.showSaveDialog({ defaultPath: 'דוח-א.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  const b = await dialog.showSaveDialog({ defaultPath: 'דוח-ב.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  assert.equal(a.canceled, false);
  assert.equal(b.canceled, false);
  shims.fs.writeFileSync(a.filePath, await pdf('<p>דוח א</p>'));
  shims.fs.writeFileSync(b.filePath, await pdf('<p>דוח ב</p>'));
  assert.deepEqual(bridge.prints, ['<p>דוח א</p>', '<p>דוח ב</p>']);
  assert.equal(bridge.writes.length, 0, 'PDF — רק דרך מסך ההדפסה');
  // כתיבה רגילה (לא PDF) לשם שלא נבחר בחלון — עדיין נדחית
  assert.throws(() => shims.fs.writeFileSync(a.filePath, 'טקסט'), /אינה נתמכת/);
});

/* ---------- סקירה: תיקייה שנבחרה בשם "data" לא משתלטת על תיקיית הנתונים ---------- */
test('סקירה: תיקייה שנבחרה בשם data — לא מקבלת את /data, וכתיבה לתיקיית הנתונים לא יוצאת לתיקייה המשותפת', async () => {
  const bridge = fakeBridge();
  const shims = createNodeShims(bridge);
  assert.equal(shims.DATA_ROOT, '/data');
  const picks = [];
  const { dialog } = createElectronShims(shims, { bridgeAsync: async m => { picks.push(m); return { uri: 'content://tree/data', name: ' data ' }; } });
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  assert.deepEqual(picks, ['pickFolder']);
  assert.equal(r.canceled, false);
  assert.notEqual(r.filePaths[0], '/data');
  assert.equal(r.filePaths[0], '/data (2)');
  // תיקיית הנתונים (למשל הגדרות העוזר) — לא לתיקייה שנבחרה: אין treeWrite / treeExists / treeMkdirs
  assert.throws(() => shims.fs.writeFileSync('/data/ai-prefs.json', '{"x":1}'), /אינה נתמכת/);
  assert.equal(shims.fs.existsSync('/data/ai-prefs.json'), false);
  shims.fs.mkdirSync('/data/updates', { recursive: true });
  assert.equal(bridge.tree.size, 0);
  assert.equal(bridge.dirs.size, 0);
  // התיקייה שנבחרה עצמה — עובדת בנתיב שלה
  shims.fs.writeFileSync('/data (2)/OPENFRMT/INI.TXT', 'A000');
  assert.deepEqual([...bridge.tree.keys()], ['content://tree/data|OPENFRMT/INI.TXT']);
  // בחירה חוזרת של אותה תיקייה — אותו נתיב; תיקייה אחרת בשם זהה — נתיב חדש
  shims.fs._registerDir('data', 'content://tree/data');
  assert.equal(shims.fs._registerDir('data', 'content://tree/data'), '/data (2)');
  assert.equal(shims.fs._registerDir('data', 'content://tree/other/data'), '/data (3)');
});

test('סקירה: host.js — מצב הכתיבה של השמאות עובר בכתובת ה-iframe, נשלח שוב בכל טעינה, ושינוי מגיע למסגרת', async () => {
  const h = await bootHost();
  // אותו מופע של ipc.js שבתוך ה-vm (המאגד שומר מטמון) — מצב רישיון מדומה
  const econ = h.sandbox.__ssHost.require('econ-ipc', {});
  const ended = { mode: 'licensed', status: 'trial_ended', features: ['econ', 'shamai', 'trainer', 'tools'], reasons: [] };
  const MSG = 'השינוי לא נשמר: ' + LG.statusMessage(ended);
  econ.licenseState = () => ended;
  assert.equal(await h.shellAPI().open('shamai', null), true);
  const el = await h.wait(() => h.frameOf('shamai'), 'frame shamai');
  assert.equal(new URL(el.src).searchParams.get('ss-ro'), MSG, 'בתוקף כבר בטעינה הראשונה');
  await h.ready('shamai');
  const blocks = () => el.posted.filter(p => p.msg.ss === 'write-block');
  assert.equal(blocks().at(-1).msg.message, MSG);
  assert.equal(blocks().at(-1).o, origin('shamai'), 'רק ל-origin של המודול');
  // רישיון חודש — ההודעה מגיעה למסגרת הקיימת (בלי טעינה מחדש)
  econ.licenseState = () => ({ mode: 'unlicensed' });
  await h.shellAPI().open('tools', null);
  assert.equal(blocks().at(-1).msg.message, null);
  // הכלכלי וארגז הכלים — בלי ss-ro ובלי הודעות
  assert.equal(new URL(h.frameOf('econ').src).searchParams.get('ss-ro'), null);
  await h.ready('tools');
  assert.equal(h.frameOf('tools').posted.filter(p => p.msg.ss === 'write-block').length, 0);
});

test('סקירה: host.js — ייצוא למבנה אחיד לתיקייה בשם data נכתב לתיקייה שנבחרה, בנתיב שאינו תיקיית הנתונים', async () => {
  const h = await bootHost({ folder: 'data' });
  const s = await h.frameInvoke('econ', 'acct:saveSettings', { business: { name: 'מאפיית אברהם', taxId: '123456782' } });
  assert.equal(s.ok, true, s.error);
  const r = await h.frameInvoke('econ', 'acct:exportUniformFile', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(r.ok, true, r.error);
  assert.match(r.value.path, /^\/data \(2\)\/OPENFRMT\//);
  assert.ok([...h.base.tree.keys()].some(k => k.startsWith('content://tree/data|OPENFRMT/') && k.endsWith('/INI.TXT')));
});

/* ---------- Buffer מדומה: מספרים בבתים (ZIP של המבנה האחיד) ---------- */
test('Buffer מדומה: writeUInt16LE / writeUInt32LE / read* זהים ל-Node, וחריגה — RangeError', () => {
  const { Buffer: B } = createNodeShims(fakeBridge());
  const vals16 = [0, 1, 255, 256, 0xabcd, 0xffff];
  const vals32 = [0, 1, 0x04034b50, 0x06054b50, 0xedb88320, 0xffffffff];
  for (const v of vals16) {
    const s = B.alloc(4), n = Buffer.alloc(4);
    assert.equal(s.writeUInt16LE(v, 1), n.writeUInt16LE(v, 1));
    assert.deepEqual([...s], [...n]);
    s.writeUInt16BE(v, 2); n.writeUInt16BE(v, 2);
    assert.deepEqual([...s], [...n]);
    assert.equal(s.readUInt16LE(1), n.readUInt16LE(1));
    assert.equal(s.readUInt16BE(2), n.readUInt16BE(2));
  }
  for (const v of vals32) {
    const s = B.alloc(6), n = Buffer.alloc(6);
    assert.equal(s.writeUInt32LE(v, 2), n.writeUInt32LE(v, 2));
    assert.deepEqual([...s], [...n]);
    assert.equal(s.readUInt32LE(2), v);
    s.writeUInt32BE(v, 0); n.writeUInt32BE(v, 0);
    assert.deepEqual([...s], [...n]);
    assert.equal(s.readUInt32BE(0), n.readUInt32BE(0));
  }
  assert.throws(() => B.alloc(2).writeUInt32LE(1, 0), RangeError);
  assert.throws(() => B.alloc(4).writeUInt16LE(70000, 0), RangeError);
  assert.equal(B.from('ab', 'ascii').toString('ascii'), 'ab');
});

/* ---------- relay-fetch: הפנייה היחידה לרשת ---------- */
test('ממצא 32: relay-fetch — רק POST https://<שרת>/v1, דרך הגשר; כל כתובת אחרת נדחית בלי פנייה', async () => {
  const calls = [];
  const fetchImpl = createRelayFetch(async (m, o, body) => { calls.push([m, o, body]); return { status: 200, body: '{"ok":true,"x":1}' }; });
  const res = await fetchImpl('https://relay.example:8443/v1', { method: 'POST', body: '{"a":1}' });
  assert.deepEqual(calls, [['relayPost', 'https://relay.example:8443', '{"a":1}']]);
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { ok: true, x: 1 });
  for (const [url, method] of [['https://relay.example/v1', 'GET'], ['http://relay.example/v1', 'POST'], ['https://relay.example/v2', 'POST'],
    ['https://u:p@relay.example/v1', 'POST'], ['https://relay.example/v1?x=1', 'POST'], ['https://accounts.google.com/o/oauth2/token', 'POST'], ['not a url', 'POST']]) {
    await assert.rejects(() => fetchImpl(url, { method }), /רק לשרת הרישוי/, url);
  }
  assert.equal(calls.length, 1, 'כתובת אסורה לא מגיעה לגשר');
  assert.equal(relayOrigin('https://relay.example/v1'), 'https://relay.example');
  // ביטול (AbortController של remote.js) ותשובת שגיאה מהגשר
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => fetchImpl('https://relay.example/v1', { method: 'POST', signal: ctrl.signal }), /בוטלה/);
  const failing = createRelayFetch(async () => ({ error: 'אין חיבור לשרת הרישוי' }));
  await assert.rejects(() => failing('https://relay.example/v1', { method: 'POST', body: '' }), /אין חיבור/);
});

test('ממצא 32: remote.js של הרישוי עובד מעל relay-fetch (בקשה חתומה ל-/v1 ותשובה)', async () => {
  const seen = [];
  const fetchImpl = createRelayFetch(async (m, o, body) => { seen.push({ o, req: JSON.parse(body) }); return { status: 200, body: JSON.stringify({ ok: true, offer: { plan: 'שנתי' } }) }; });
  const { privateJwk } = L.generateKeyPair();
  const rm = createRemote({ url: 'https://relay.example', fetchImpl });
  assert.deepEqual(await rm.getOffer(privateJwk), { plan: 'שנתי' });
  assert.equal(seen[0].o, 'https://relay.example');
  assert.equal(seen[0].req.op, 'getOffer');
  assert.ok(seen[0].req.sig, 'בקשה חתומה');
  // שרת שדוחה — הודעה בעברית
  const rejecting = createRemote({ url: 'https://relay.example', fetchImpl: createRelayFetch(async () => ({ status: 403, body: '{"ok":false}' })) });
  await assert.rejects(() => rejecting.getOffer(privateJwk), /שרת הרישוי דחה/);
});

test('ממצא 32: econOptions — fetch לשרת הרישוי בלבד, בלי סנכרון בשבת (כשמצב שבת פעיל), ומודולים לפי הרישיון', async () => {
  const calls = [];
  let cal = { shabbatMode: true };
  const ui = { load: () => ({ calendar: cal }), save() {} };
  let state = { mode: 'licensed', status: 'active', features: ['econ', 'tools'] };
  const o = MA.econOptions({ ui, bridgeAsync: async (...a) => { calls.push(a); return { status: 200, body: '{}' }; }, version: '9.9.9', licenseState: () => state });
  await o.fetchImpl('https://relay.example/v1', { method: 'POST', body: 'x' });
  assert.equal(calls[0][0], 'relayPost');
  assert.equal(o.appVersion, '9.9.9');
  assert.equal(o.moduleLicensed('tools'), true);
  assert.equal(o.moduleLicensed('shamai'), false);
  state = { mode: 'unlicensed' };
  assert.equal(o.moduleLicensed('shamai'), true);
  const saturday = Date.parse('2026-10-24T11:00:00Z'), wednesday = Date.parse('2026-10-21T11:00:00Z');
  assert.equal(MA.restTime(ui, saturday), true);
  assert.equal(MA.restTime(ui, wednesday), false);
  cal = { shabbatMode: false };
  assert.equal(MA.restTime(ui, saturday), false);
  assert.equal(typeof o.isRestTime(), 'boolean');
});

/* ---------- main-android: שער המודולים ---------- */
async function bootEcon() {
  const bridge = fakeBridge();
  const shims = createNodeShims(bridge);
  const handlers = new Map();
  const electron = Object.assign({ ipcMain: { handle: (c, fn) => handlers.set(c, fn), on() {} } },
    createElectronShims(shims, { bridgeAsync: async () => null }));
  const ext = { electron, fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'], url: shims.url };
  // auth-service — אותו מופע ש-ipc.js משתמש בו (אותו קובץ במאגד), לשליטה בשעון של הניתוק האוטומטי
  const { code } = bundle({ 'econ-ipc': path.join(ROOT, 'modules/econ/ipc.js'), 'main-android': path.join(ROOT, 'android/web/main-android.js'),
    'auth-service': path.join(ROOT, 'modules/econ/services/authService.js') },
  { root: ROOT, globalName: '__ssAuditAndroid' });
  new Function(code)();
  const host = globalThis.__ssAuditAndroid;
  delete globalThis.__ssAuditAndroid;
  const econ = host.require('econ-ipc', ext);
  await econ.initEcon('/data', { relayUrl: '' });
  const auth = host.require('auth-service', ext).AuthService;
  return { econ, host, ext, handlers, auth };
}

const SENDERS = { econ: 2, shamai: 3, trainer: 4, tools: 5 };
function startAndroid({ econ, host, ext, handlers }, { license, about } = {}) {
  const visible = {}, sent = [], emitted = [], ensured = [], alerts = [], blocks = [];
  const licListeners = [], activityListeners = [];
  let state = license || { mode: 'unlicensed' };
  const frames = {
    _f: new Set(),
    exists: id => frames._f.has(id),
    ensure: id => { frames._f.add(id); ensured.push(id); },
    setVisible: (id, on) => { visible[id] = on; },
    setWriteBlock: (id, m) => blocks.push([id, m]),
    onActivity: fn => activityListeners.push(fn),
    whenReady: () => Promise.resolve(),
    send: (id, ch, ...a) => sent.push([id, ch, ...a]),
    request: async (id, type) => (type === 'ls-dump' ? {} : true),
    reloadAll() {},
    moduleSenderIds: () => [...frames._f].map(id => SENDERS[id]),
  };
  const intervals = [], timers = {};
  const wrapped = { ...econ, licenseState: () => state, onLicenseChange: fn => licListeners.push(fn) };
  const api = host.require('main-android', ext).start({
    ipcMain: ext.electron.ipcMain, econ: wrapped, frames, SHELL_ID: 1,
    emitShell: (...a) => emitted.push(a), bridgeAsync: async () => ({ ok: true }),
    senderOf: id => SENDERS[id], version: '9.9.9', about,
    ui: (() => { let o = {}; return { load: () => o, save: v => { o = v; } }; })(),
    alert: m => alerts.push(m), confirm: () => true, exit() {},
    setInterval: (fn, ms) => { intervals.push(ms); timers[ms] = fn; return 0; },
  });
  const call = async (s, ch, ...a) => handlers.get(ch)({ sender: { id: s } }, ...a);
  const setLicense = st => { state = st; for (const fn of licListeners) fn(st); };
  // שינוי בלי הודעה למאזינים (למשל תחומים בלי שינוי סטטוס — licenseState ב-ipc.js מודיע רק על סטטוס)
  const setLicenseQuiet = st => { state = st; };
  // פעילות במסגרת של מודול (host.js ← frame.js)
  const activity = id => { for (const fn of activityListeners) fn(id); };
  return { api, call, frames, visible, sent, emitted, ensured, alerts, setLicense, setLicenseQuiet, intervals, timers, blocks, activity };
}

test('ממצא 32: מודול שאינו ברישיון לא נפתח באנדרואיד, ותצוגה כלכלית סגורה עוברת למסך הרישוי', async () => {
  const b = await bootEcon();
  const t = startAndroid(b, { license: { mode: 'licensed', status: 'active', features: ['econ'] } });
  // שמאי וארגז הכלים אינם ברישיון — לא נטענים ולא מוצגים, והמעטפת מקבלת את מצב הרישוי
  assert.equal(await t.call(1, 'shell:open', 'shamai', null), true);
  assert.equal(await t.call(1, 'shell:switch', 'tools'), true);
  assert.ok(!t.ensured.includes('shamai') && !t.ensured.includes('tools'), 'מודול סגור לא נטען');
  assert.equal(t.api.active, null);
  const lic = t.emitted.filter(e => e[0] === 'shell:license').at(-1);
  assert.equal(lic[1].modules.shamai, false);
  assert.equal(lic[1].modules.econ, true);
  // מודול מתוך מודול (shell:open-module) — אותו שער
  await t.call(1, 'shell:open', 'econ', 'dashboard');
  assert.equal(await t.call(2, 'shell:open-module', 'trainer'), true);
  assert.equal(t.api.active, 'econ');
  assert.ok(!t.ensured.includes('trainer'));
  // תצוגת אימונים של מודול סגור — לא נטענת ברקע
  await t.call(1, 'shell:open', 'trainer', 'clients');
  assert.ok(!t.ensured.includes('trainer'));
  // shell:license-state — רק למעטפת
  assert.deepEqual(await t.call(1, 'shell:license-state'), LG.shellState({ mode: 'licensed', status: 'active', features: ['econ'] }));
  assert.equal(await t.call(3, 'shell:license-state'), null);

  // מערכת נעולה: הכלכלי נפתח במסך הרישוי, ודיווח על תצוגה אחרת מחזיר לשם
  t.setLicense({ mode: 'licensed', status: 'locked', features: ['econ'], reasons: [{ reason: 'לא נמצא חיבור לשרת' }] });
  await t.call(1, 'shell:open', 'econ', 'acct-invoices');
  assert.deepEqual(t.sent.at(-1), ['econ', 'econ:goto', 'licensing']);
  assert.equal(await t.call(2, 'shell:econ-view', 'acct-invoices'), false);
  assert.deepEqual(t.sent.at(-1), ['econ', 'econ:goto', 'licensing']);
  assert.equal(await t.call(2, 'shell:econ-view', 'licensing'), true);
  // סנכרון עם שרת הרישוי כל 3 דקות ובדיקת המצב כל דקה (כמו main.js)
  assert.deepEqual(t.intervals.sort(), [180000, 60000].sort());
});

test('ממצא 32: שינוי ברישיון בזמן עבודה מוציא ממודול שנסגר (enforceLicense)', async () => {
  const b = await bootEcon();
  const t = startAndroid(b, { license: { mode: 'licensed', status: 'active', features: ['econ', 'tools'] } });
  await t.call(1, 'shell:switch', 'tools');
  assert.equal(t.api.active, 'tools');
  assert.equal(t.visible.tools, true);
  t.setLicense({ mode: 'licensed', status: 'active', features: ['econ'] });
  assert.equal(t.api.active, null, 'חזרה למסך הבית');
  assert.equal(t.visible.tools, false);
  assert.equal(t.emitted.filter(e => e[0] === 'shell:license').at(-1)[1].modules.tools, false);
  // בלי רישוי (התקנה בלי מפתח שורש) — הכול פתוח, כמו בשולחן העבודה
  t.setLicense({ mode: 'unlicensed' });
  await t.call(1, 'shell:switch', 'tools');
  assert.equal(t.api.active, 'tools');
});

/* ---------- סקירה: קריאה בלבד לפי הרישיון בשמאות ובאימונים (כמו secureWriteBlock ב-main.js) ---------- */
test('סקירה: licenseWriteBlock — סוף ניסיון / ממתין לתשלום / מושעה חוסמים כתיבה, בדיוק כמו חלק הרישוי של main.js', () => {
  const ALL = ['econ', 'shamai', 'trainer', 'tools'];
  assert.equal(MA.licenseWriteBlock({ mode: 'unlicensed' }, 'shamai'), null);
  assert.equal(MA.licenseWriteBlock(null, 'trainer'), null);
  assert.equal(MA.licenseWriteBlock({ mode: 'licensed', status: 'active', features: ALL }, 'shamai'), null);
  for (const status of ['trial_ended', 'pending_payment', 'suspended']) {
    const st = { mode: 'licensed', status, features: ALL, reasons: [{ reason: 'סיבה לדוגמה' }] };
    assert.equal(LG.moduleAllowed(st, 'shamai'), true, 'המודול נשאר פתוח לצפייה');
    assert.equal(MA.licenseWriteBlock(st, 'shamai'), 'השינוי לא נשמר: ' + LG.statusMessage(st), status);
    assert.equal(MA.licenseWriteBlock(st, 'trainer'), 'השינוי לא נשמר: ' + LG.statusMessage(st), status);
  }
  assert.equal(MA.licenseWriteBlock({ mode: 'licensed', status: 'active', features: ['econ', 'shamai'] }, 'trainer'), 'השינוי לא נשמר: המודול אינו כלול ברישיון');
  assert.equal(MA.licenseWriteBlock({ mode: 'licensed', status: 'locked', features: ALL }, 'shamai'), 'השינוי לא נשמר: המודול אינו כלול ברישיון');
});

const NO_SESSION = 'השינוי לא נשמר: הכניסה למערכת פגה — יש להיכנס שוב';
const VIEW_ONLY = 'השינוי לא נשמר: לתפקיד שלך יש הרשאת צפייה בלבד';

test('סקירה: main-android שולח את מצב הכתיבה לשמאות ולאימונים — בהפעלה, בכניסה, בשינוי סטטוס, בבדיקה של כל דקה ובפתיחת מודול', async () => {
  const b = await bootEcon();
  const ALL = ['econ', 'shamai', 'trainer', 'tools'];
  const t = startAndroid(b, { license: { mode: 'licensed', status: 'active', features: ALL } });
  // לפני כניסה — חסום, כמו secureWriteBlock ב-main.js (ממצא 24)
  assert.deepEqual(t.blocks, [['shamai', NO_SESSION], ['trainer', NO_SESSION]], 'מצב התחלתי');
  t.frames.ensure('econ');
  await t.call(2, 'auth:setup', 'admin', PASS);
  assert.deepEqual(t.blocks.slice(2), [['shamai', null], ['trainer', null]], 'כניסת מנהל משחררת מיד');
  // סוף תקופת הניסיון — המודולים נשארים פתוחים, הכתיבה נחסמת
  const ended = { mode: 'licensed', status: 'trial_ended', features: ALL, reasons: [] };
  t.setLicense(ended);
  const msg = 'השינוי לא נשמר: ' + LG.statusMessage(ended);
  assert.deepEqual(t.blocks.slice(4), [['shamai', msg], ['trainer', msg]]);
  assert.equal(t.emitted.filter(e => e[0] === 'shell:license').at(-1)[1].level, 'limited');
  // בלי שינוי — לא נשלח שוב
  t.timers[60000]();
  assert.equal(t.blocks.length, 6);
  // רישיון חודש, אבל האימונים הוצאו מהתחומים בלי שינוי סטטוס — נקלט בבדיקה של כל דקה
  t.setLicenseQuiet({ mode: 'licensed', status: 'active', features: ['econ', 'shamai'] });
  t.timers[60000]();
  assert.deepEqual(t.blocks.slice(6), [['shamai', null], ['trainer', 'השינוי לא נשמר: המודול אינו כלול ברישיון']]);
  // ובפתיחת מודול (לפני יצירת ה-iframe — כך הכתובת שלו כבר נושאת את המצב העדכני)
  t.setLicenseQuiet({ mode: 'licensed', status: 'active', features: ALL });
  await t.call(1, 'shell:switch', 'tools');
  assert.deepEqual(t.blocks.slice(8), [['trainer', null]]);
});

/* ---------- ממצא 24 באנדרואיד: כניסה פעילה והרשאת עריכה בשמאות ובאימונים ---------- */
test('ממצא 24 (אנדרואיד): צופה ורואה חשבון — כתיבה חסומה בשמאות ובאימונים; יציאה חוסמת; כניסה עם הרשאת עריכה משחררת', async () => {
  const b = await bootEcon();
  const t = startAndroid(b); // בלי רישוי — רק הכניסה והתפקיד קובעים
  t.frames.ensure('econ');
  const last = () => t.blocks.slice(-2);
  await t.call(2, 'auth:setup', 'admin', PASS);
  assert.deepEqual(last(), [['shamai', null], ['trainer', null]]);
  for (const [username, role] of [['yosef', 'viewer'], ['reuven', 'accountant'], ['shimon', 'editor']]) {
    await t.call(2, 'users:create', { username, password: PASS, role });
  }
  // יציאה — חסום מיד (לא רק בבדיקה של כל דקה)
  await t.call(2, 'auth:logout');
  assert.deepEqual(last(), [['shamai', NO_SESSION], ['trainer', NO_SESSION]]);
  for (const username of ['yosef', 'reuven']) {
    await t.call(2, 'auth:login', username, PASS);
    assert.deepEqual(last(), [['shamai', VIEW_ONLY], ['trainer', VIEW_ONLY]], username);
    // גם הבדיקה של כל דקה לא משחררת
    t.timers[60000]();
    assert.deepEqual(last(), [['shamai', VIEW_ONLY], ['trainer', VIEW_ONLY]], username);
    await t.call(2, 'auth:logout');
  }
  // עורך — מותר; ואז רישיון שמגביל — הודעת הרישיון אחרי שהכניסה וההרשאה תקינות (כמו main.js)
  await t.call(2, 'auth:login', 'shimon', PASS);
  assert.deepEqual(last(), [['shamai', null], ['trainer', null]]);
  const ended = { mode: 'licensed', status: 'trial_ended', features: ['econ', 'shamai', 'trainer', 'tools'], reasons: [] };
  t.setLicense(ended);
  assert.deepEqual(last(), [['shamai', 'השינוי לא נשמר: ' + LG.statusMessage(ended)], ['trainer', 'השינוי לא נשמר: ' + LG.statusMessage(ended)]]);
  // צופה ברישיון מוגבל — הודעת התפקיד (כמו הסדר ב-secureWriteBlock)
  await t.call(2, 'auth:login', 'yosef', PASS);
  assert.deepEqual(last(), [['shamai', VIEW_ONLY], ['trainer', VIEW_ONLY]]);
});

test('ממצא 24 (אנדרואיד): עבודה בשמאות מאריכה את הכניסה; אחרי זמן הניתוק בלי פעולה — חסימה ומסך הכניסה, ואחרי הכניסה חזרה למודול', async () => {
  const b = await bootEcon();
  const t = startAndroid(b);
  let now = Date.now();
  b.auth.now = () => now;
  const MIN = 60 * 1000;
  t.frames.ensure('econ');
  await t.call(2, 'auth:setup', 'admin', PASS);
  assert.equal(await t.call(1, 'shell:switch', 'shamai'), true);
  assert.equal(t.api.active, 'shamai');
  const before = t.blocks.length;
  // 10 דקות, פעולה בשמאות, ועוד 10 — 20 דקות מהכניסה, אבל רק 10 מהפעולה האחרונה: עדיין בפנים
  now += 10 * MIN;
  t.activity('shamai');
  now += 10 * MIN;
  t.timers[60000]();
  assert.equal(t.api.active, 'shamai', 'פעילות במודול מאריכה את הפגישה');
  assert.equal(t.blocks.length, before, 'הכתיבה לא נחסמה');
  // פעולה בארגז הכלים (אינו דורש כניסה) או במסגרת הכלכלית — אינה פעילות של מודול נעול
  now += 4 * MIN;
  t.activity('tools');
  t.activity('econ');
  now += 2 * MIN; // 16 דקות מהפעולה האחרונה בשמאות — מעבר ל-15 של ברירת המחדל
  t.timers[60000]();
  assert.deepEqual(t.blocks.slice(-2), [['shamai', NO_SESSION], ['trainer', NO_SESSION]]);
  assert.equal(t.api.active, 'econ', 'חזרה למסך הכניסה');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(t.sent.at(-1), ['econ', 'econ:auth-check']);
  // פעולה אחרי שהפגישה פגה לא מחיה אותה
  t.activity('shamai');
  assert.equal(b.econ.hasSession(2), false);
  // כניסה — הכתיבה משתחררת וחוזרים לשמאות (ה-iframe לא נטען מחדש)
  await t.call(2, 'auth:login', 'admin', PASS);
  assert.deepEqual(t.blocks.slice(-2), [['shamai', null], ['trainer', null]]);
  assert.equal(t.api.active, 'shamai');
});

/* ---------- ערוצי המעטפת באנדרואיד ---------- */
test('כל ערוץ בממשק המעטפת (shell/preload.js) רשום באנדרואיד — בלי שגיאה גולמית באנגלית', async () => {
  const b = await bootEcon();
  const t = startAndroid(b, { about: { license: 'רישיון', eula: 'הסכם', notices: 'רכיבים' } });
  const preload = fs.readFileSync(path.join(ROOT, 'shell/preload.js'), 'utf8');
  const channels = [...new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]))];
  assert.ok(channels.length > 30);
  const missing = channels.filter(ch => !b.handlers.has(ch));
  assert.deepEqual(missing, [], 'ערוץ חדש במעטפת — לרשום גם ב-android/web/main-android.js');
  // אין מקבילה — הודעה בעברית, ורק מהמעטפת
  for (const ch of Object.keys(MA.NOT_ON_ANDROID)) {
    await assert.rejects(() => t.call(1, ch), /אינה זמינה בגרסת אנדרואיד/, ch);
    await assert.rejects(() => t.call(3, ch), /מתוך המעטפת בלבד/, ch);
  }
  assert.equal(await t.call(1, 'shell:plain-backups'), null);
  assert.deepEqual(await t.call(1, 'shell:get-about'), { version: '9.9.9', license: 'רישיון', eula: 'הסכם', notices: 'רכיבים' });
  assert.equal(await t.call(3, 'shell:get-about'), null);
  // מסך הבית ושאלה לעוזר — דרך הכניסה של המודול הכלכלי
  t.frames.ensure('econ');
  assert.equal(await t.call(1, 'shell:get-home-summary'), null);
  await assert.rejects(() => t.call(1, 'shell:ai-ask', 'כמה גביתי החודש?'), /להיכנס למערכת הכספים/);
  assert.equal(await t.call(1, 'shell:is-admin'), false, 'בלי כניסה');
  await t.call(2, 'auth:setup', 'admin', PASS);
  assert.equal(await t.call(1, 'shell:is-admin'), true);
  assert.equal(await t.call(3, 'shell:is-admin'), false, 'רק המעטפת');
  const home = await t.call(1, 'shell:get-home-summary');
  assert.ok(home && typeof home === 'object');
  await assert.rejects(() => t.call(3, 'shell:get-home-summary'), /מתוך המעטפת בלבד/);
  // קוד שחזור ויעד גיבוי — מנהל בלבד (החלטת הבעלים); אצל המנהל — ההסבר שאין גיבוי אוטומטי באנדרואיד
  await assert.rejects(() => t.call(1, 'shell:get-recovery-code'), /אין גיבוי אוטומטי/);
  await assert.rejects(() => t.call(1, 'shell:pick-backup-target'), /אין גיבוי אוטומטי/);
  await t.call(2, 'auth:logout');
  await assert.rejects(() => t.call(1, 'shell:get-recovery-code'), /נדרשת כניסה/);
});

test('moduleMayInvoke: שמאות וארגז הכלים — בלי ערוצים; אימונים — רק של ה-preload שלו; הכלכלי — בלי ערוצי מעטפת', () => {
  for (const ch of ['auth:login', 'contacts:get', 'shell:switch', 'shell:backup-all']) {
    assert.equal(MA.moduleMayInvoke('shamai', ch), false, ch);
    assert.equal(MA.moduleMayInvoke('tools', ch), false, ch);
    assert.equal(MA.moduleMayInvoke('trainer', ch), false, ch);
  }
  assert.equal(MA.moduleMayInvoke('trainer', 'shell:trainer-view'), true);
  assert.equal(MA.moduleMayInvoke('trainer', 'trainer:save-pdf'), true);
  assert.equal(MA.moduleMayInvoke('econ', 'auth:login'), true);
  assert.equal(MA.moduleMayInvoke('econ', 'npo:createMasavFile'), true);
  assert.equal(MA.moduleMayInvoke('econ', 'shell:econ-view'), true);
  assert.equal(MA.moduleMayInvoke('econ', 'shell:open-module'), true);
  for (const ch of ['shell:backup-all', 'shell:restore-all', 'shell:switch', 'sync:status', 'shell:trainer-view', 'trainer:save-pdf']) {
    assert.equal(MA.moduleMayInvoke('econ', ch), false, ch);
  }
  assert.equal(MA.moduleMayInvoke('nope', 'auth:login'), false);
});

/* ---------- שחזור: מכסת localStorage במכשיר ---------- */
test('שחזור באנדרואיד: מודול בלי מקום ב-localStorage לא מבטל את כל השחזור — הכספים ושאר המודולים משוחזרים', async () => {
  const b = await bootEcon();
  const restores = [];
  const alerts = [];
  let openText = null;
  const frames = {
    _f: new Set(), exists: id => frames._f.has(id), ensure: id => frames._f.add(id), setVisible() {},
    whenReady: () => Promise.resolve(), send() {}, reloadAll() {},
    request: async (id, type, data) => {
      if (type === 'ls-dump') return { k: 'ישן-' + id };
      restores.push([id, data]);
      // לנתוני השמאות מהגיבוי אין מקום; החזרת הנתונים הקודמים מצליחה
      return id === 'shamai' && data.a === 'חדש' ? { error: 'QuotaExceededError', quota: true } : true;
    },
    moduleSenderIds: () => [...frames._f].map(id => SENDERS[id]),
  };
  b.host.require('main-android', b.ext).start({
    ipcMain: b.ext.electron.ipcMain, econ: b.econ, frames, SHELL_ID: 1, emitShell() {},
    bridgeAsync: async m => (m === 'openText' ? { text: openText } : { ok: true }),
    senderOf: id => SENDERS[id], ui: { load: () => ({}), save() {} },
    alert: m => alerts.push(m), confirm: () => true, exit() {}, setInterval: () => 0,
  });
  const call = async (s, ch, ...a) => b.handlers.get(ch)({ sender: { id: s } }, ...a);
  frames.ensure('econ');
  await call(2, 'auth:setup', 'admin', PASS);
  const db = b.econ.getDb();
  const cur = await db.backup();
  cur.organization = { ...(cur.organization || {}), name: 'קופת צדקה — לפני' };
  await db.restore(cur);
  const incoming = { ...cur, organization: { ...cur.organization, name: 'קופת צדקה — מהגיבוי' } };
  openText = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', econ: incoming,
    localStorage: { shamai: { a: 'חדש' }, tools: { b: 'חדש' } } }), 'backup-pass-123');

  assert.deepEqual(await call(1, 'shell:restore-all', 'backup-pass-123'), { ok: true, skipped: ['shamai'] });
  assert.equal((await db.backup()).organization.name, 'קופת צדקה — מהגיבוי', 'הכספים שוחזרו');
  assert.deepEqual(restores, [['shamai', { a: 'חדש' }], ['shamai', { k: 'ישן-shamai' }], ['tools', { b: 'חדש' }]]);
  assert.match(alerts.at(-1), /השחזור הושלם, חוץ מנתוני השמאות.*הנתונים הקודמים שלהם נשארו/s);
});

// frame.js בתוך vm: iframe של מודול (חלון אב = המעטפת), localStorage מדומה, ובלי fetch בכלל בסביבה.
// mod — המודול (לפי ה-host), search — כתובת ה-iframe (ss-ro מ-host.js), session — sessionStorage קיים (טעינה מחדש)
function loadFrame({ quota = false, mod = 'shamai', search = '', session = {} } = {}) {
  const posted = [];
  const listeners = {};
  // Storage מדומה כמו בדפדפן: הפעולות על אב-הטיפוס (Storage.prototype, משותף ל-localStorage ול-sessionStorage),
  // הפריטים — מאפיינים של האובייקט (כך Object.entries מחזיר אותם, כמו ls-dump)
  class FakeStorage {
    getItem(k) { return Object.prototype.hasOwnProperty.call(this, String(k)) ? this[String(k)] : null; }
    setItem(k, v) {
      if (quota && this === ls) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      Object.defineProperty(this, String(k), { value: String(v), enumerable: true, configurable: true, writable: true });
    }
    removeItem(k) { delete this[String(k)]; }
    clear() { for (const k of Object.keys(this)) delete this[k]; }
  }
  const ls = new FakeStorage();
  const ss = new FakeStorage();
  for (const [k, v] of Object.entries(session)) ss.setItem(k, v);
  const SHELL = 'https://shell.' + DOMAIN;
  const parent = { postMessage: (msg, o) => posted.push({ msg, o }) };
  class Anchor {
    constructor(href, download) { this.href = href; this.dl = download; }
    hasAttribute(n) { return n === 'download' && this.dl != null; }
    getAttribute(n) { return n === 'download' ? this.dl : null; }
  }
  Anchor.prototype.click = function () {};
  const sandbox = {
    console, setTimeout, Blob, TextEncoder, atob, btoa, URLSearchParams, DOMException,
    parent,
    location: { protocol: 'https:', host: mod + '.' + DOMAIN, href: origin(mod) + '/index.html' + search, search },
    navigator: {},
    URL: { createObjectURL: () => 'blob:' + origin(mod) + '/1' },
    HTMLAnchorElement: Anchor,
    document: { addEventListener() {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    localStorage: ls,
    sessionStorage: ss,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'android/web/frame.js'), 'utf8'), sandbox);
  const fromShell = data => listeners.message({ source: parent, origin: SHELL, data });
  return { sandbox, posted, ls, ss, fromShell, Anchor, SHELL, listeners };
}

test('frame.js: אין מקום ב-localStorage — התשובה מסומנת quota (ולא נתקעת); שחזור רגיל — true', () => {
  const full = loadFrame({ quota: true });
  full.fromShell({ ss: 'ls-restore', id: 7, data: { a: 'חדש' } });
  const r = full.posted.find(p => p.msg.ss === 'ls' && p.msg.id === 7);
  assert.equal(r.o, full.SHELL, 'התשובה רק למעטפת');
  assert.equal(r.msg.data.quota, true);
  assert.match(r.msg.data.error, /quota/);
  const ok = loadFrame();
  ok.fromShell({ ss: 'ls-restore', id: 8, data: { a: 'חדש' } });
  assert.equal(ok.posted.find(p => p.msg.id === 8).msg.data, true);
  assert.equal(ok.ls.getItem('a'), 'חדש');
});

test('סקירה: frame.js — קריאה בלבד לפי הרישיון בשמאות: כתיבה זורקת SecurityError בעברית, הנתונים לא משתנים, השחזור מהמעטפת עובר', () => {
  const MSG = 'השינוי לא נשמר: תקופת הניסיון הסתיימה';
  const f = loadFrame({ mod: 'shamai', search: '?ss-ro=' + encodeURIComponent(MSG) });
  const blocked = fn => assert.throws(fn, e => e.name === 'SecurityError' && e.message === MSG);
  const page = f.sandbox.localStorage; // מה שקוד המודול רואה
  // החסימה על אב-הטיפוס — גם קריאה ישירה לפעולה של Storage נחסמת
  blocked(() => Object.getPrototypeOf(page).setItem.call(page, 'items', 'ישן'));
  blocked(() => page.setItem('items', 'חדש'));
  blocked(() => page.removeItem('items'));
  blocked(() => page.clear());
  assert.equal(Object.keys(f.ls).length, 0);
  // sessionStorage חולק את אב-הטיפוס — לא נחסם
  f.sandbox.sessionStorage.setItem('x', '1');
  assert.equal(f.ss.getItem('x'), '1');
  // השחזור מהמעטפת כותב גם במצב קריאה בלבד (כמו בשולחן העבודה)
  f.fromShell({ ss: 'ls-restore', id: 9, data: { items: 'מהגיבוי' } });
  assert.equal(f.posted.find(p => p.msg.ss === 'ls' && p.msg.id === 9).msg.data, true);
  assert.equal(f.ls.getItem('items'), 'מהגיבוי');
  blocked(() => page.setItem('items', 'אחרי השחזור'));
  // רישיון חודש — הכתיבה חוזרת, והמצב נשמר ל-sessionStorage (לטעינה מחדש)
  f.fromShell({ ss: 'write-block', message: null });
  page.setItem('items', 'חדש');
  assert.equal(f.ls.getItem('items'), 'חדש');
  assert.equal(f.ss.getItem('ss-write-block'), '');
  f.fromShell({ ss: 'write-block', message: MSG });
  blocked(() => page.setItem('items', 'שוב'));
  assert.equal(f.ss.getItem('ss-write-block'), MSG);
});

test('סקירה: frame.js — טעינה מחדש לוקחת את המצב מ-sessionStorage (עדכני יותר מכתובת ה-iframe); ארגז הכלים והכלכלי — בלי חסימה', () => {
  const MSG = 'השינוי לא נשמר: ממתין לתשלום';
  // נחסם אחרי היצירה (הכתובת בלי ss-ro) ואז נטען מחדש
  const reloaded = loadFrame({ mod: 'trainer', search: '', session: { 'ss-write-block': MSG } });
  assert.throws(() => reloaded.sandbox.localStorage.setItem('clients:index', '[]'), e => e.name === 'SecurityError' && e.message === MSG);
  // נפתח אחרי היצירה (הכתובת עם ss-ro) ואז נטען מחדש
  const reopened = loadFrame({ mod: 'trainer', search: '?ss-ro=' + encodeURIComponent(MSG), session: { 'ss-write-block': '' } });
  reopened.sandbox.localStorage.setItem('clients:index', '[]');
  assert.equal(reopened.ls.getItem('clients:index'), '[]');
  // מודולים שאין להם קריאה בלבד בשולחן העבודה (ארגז הכלים) או שנאכפים בשרת (הכלכלי)
  for (const mod of ['tools', 'econ']) {
    const f = loadFrame({ mod, search: '?ss-ro=' + encodeURIComponent(MSG) });
    f.fromShell({ ss: 'write-block', message: MSG });
    f.sandbox.localStorage.setItem('k', 'v');
    assert.equal(f.ls.getItem('k'), 'v', mod);
  }
});

test('frame.js: הורדת קישור data: (טקסט ו-base64) נשמרת דרך המעטפת — בלי fetch', async () => {
  const f = loadFrame();
  assert.equal(typeof f.sandbox.fetch, 'undefined', 'אין fetch בסביבת הבדיקה');
  new f.Anchor('data:text/csv;charset=utf-8,' + encodeURIComponent('שם,סכום\nמשה,100'), 'תרומות.csv').click();
  const bytes = Buffer.from([0, 255, 128, 7]);
  new f.Anchor('data:application/octet-stream;base64,' + bytes.toString('base64'), 'קובץ.bin').click();
  for (let i = 0; i < 100 && f.posted.filter(p => p.msg.ss === 'save').length < 2; i++) await new Promise(r => setTimeout(r, 5));
  const saves = f.posted.filter(p => p.msg.ss === 'save').map(p => p.msg);
  assert.equal(saves.length, 2);
  assert.deepEqual(saves.map(s => [s.name, s.mime]), [['תרומות.csv', 'text/csv'], ['קובץ.bin', 'application/octet-stream']]);
  assert.equal(Buffer.from(saves[0].b64, 'base64').toString('utf8'), 'שם,סכום\nמשה,100');
  assert.deepEqual(Buffer.from(saves[1].b64, 'base64'), bytes);
});

/* ---------- host.js (vm): ערוצים לכל מודול, תשובות גיבוי, ערוץ לא מוכר ---------- */
test('host.js: תשובת גיבוי מתקבלת רק מהמסגרת שנשאלה — מודול אחר לא מזייף נתונים', async () => {
  const h = await bootHost();
  const backup = h.shellAPI().backupAll('backup-pass-123', 'all');
  const answer = async (id, data) => {
    await h.ready(id);
    const req = await h.wait(() => h.frameOf(id).posted.find(p => p.msg.ss === 'ls-dump'), 'ls-dump ' + id);
    // הכלכלי (מסגרת מוכרת אחרת) מנסה לענות במקום המודול
    h.post('econ', { ss: 'ls', id: req.msg.id, data: { forged: 'מזויף' } });
    h.post(id, { ss: 'ls', id: req.msg.id, data });
  };
  await answer('shamai', { item: 'שמאי אמיתי' });
  await answer('trainer', {});
  await answer('tools', { t: '1' });
  await backup;
  const saved = h.asyncCalls.find(c => c[0] === 'saveText');
  const data = JSON.parse(BK.decryptBackup(saved[2], 'backup-pass-123'));
  assert.deepEqual(data.localStorage.shamai, { item: 'שמאי אמיתי' });
  assert.deepEqual(data.localStorage.tools, { t: '1' });
});

test('host.js: ערוצים לכל מודול — שמאות לא מנסה כניסה בשם המנהל, הכלכלי לא מפעיל ערוצי מעטפת, ערוץ לא מוכר בעברית', async () => {
  const h = await bootHost();
  // השמאות נפתח (אחרי כניסה), ואז המנהל יוצא — והשמאות מנסה לנעול אותו בניסיונות כניסה
  assert.equal(await h.shellAPI().open('shamai', null), true);
  await h.ready('shamai');
  await h.frameInvoke('econ', 'auth:logout');
  for (let i = 0; i < 6; i++) {
    const r = await h.frameInvoke('shamai', 'auth:login', 'admin', 'wrong-password-1');
    assert.equal(r.ok, false);
    assert.match(r.error, /אינה מותרת מתוך המודול/);
  }
  // גם ערוץ מעטפת ו-preload של מודול אחר — לא מהשמאות
  for (const ch of ['shell:switch', 'shell:trainer-view', 'contacts:get']) {
    const r = await h.frameInvoke('shamai', ch, 'econ');
    assert.equal(r.ok, false, ch);
    assert.match(r.error, /אינה מותרת מתוך המודול/, ch);
  }
  const login = await h.frameInvoke('econ', 'auth:login', 'admin', PASS);
  assert.equal(login.ok, true, login.error);
  const bk = await h.frameInvoke('econ', 'shell:backup-all', 'backup-pass-123', 'all');
  assert.equal(bk.ok, false);
  assert.match(bk.error, /אינה מותרת מתוך המודול/);
  const unknown = await h.frameInvoke('econ', 'econ:no-such-channel');
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /אינה זמינה בגרסת אנדרואיד/);
  assert.doesNotMatch(unknown.error, /No handler/);
  await assert.rejects(() => h.shellAPI().saveCrashReport(), /אינה זמינה בגרסת אנדרואיד/);
  // אודות — מהטקסטים שנארזו בבנייה
  assert.deepEqual(await h.shellAPI().getAbout(), { version: '9.9.9', license: 'רישיון', eula: 'הסכם', notices: 'רכיבים' });
});

test('host.js: ייצוא קבצים במבנה אחיד — בחירת תיקייה וכתיבת INI.TXT ו-BKMVDATA.zip תקין (Buffer מדומה)', async () => {
  const h = await bootHost();
  const s = await h.frameInvoke('econ', 'acct:saveSettings', { business: { name: 'מאפיית אברהם', taxId: '123456782' } });
  assert.equal(s.ok, true, s.error);
  const r = await h.frameInvoke('econ', 'acct:exportUniformFile', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.value.ok, 'הייצוא הסתיים');
  assert.match(r.value.path, /^\/Download\/OPENFRMT\//);
  const files = [...h.base.tree.keys()];
  const ini = files.find(k => k.endsWith('/INI.TXT'));
  const zipKey = files.find(k => k.endsWith('/BKMVDATA.zip'));
  assert.ok(ini && zipKey, files.join(', '));
  assert.ok(ini.startsWith('content://tree/Download|OPENFRMT/'));
  // ZIP תקין: כותרת מקומית, שיטה 0 (באנדרואיד אין zlib), CRC ותוכן
  const z = h.base.tree.get(zipKey);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt16LE(8), 0);
  const size = z.readUInt32LE(18), nameLen = z.readUInt16LE(26);
  assert.equal(z.toString('ascii', 30, 30 + nameLen), 'BKMVDATA.TXT');
  const content = z.subarray(30 + nameLen, 30 + nameLen + size);
  assert.equal(z.readUInt32LE(14), UF.crc32(content));
  const end = z.subarray(z.length - 22);
  assert.equal(end.readUInt32LE(0), 0x06054b50);
  // דוח ההפקה (PDF) — מסך ההדפסה של המכשיר
  assert.equal(h.base.prints.length, 1);
});

test('host.js: הרישוי מסתנכרן עם השרת דרך הגשר (relayPost) — כתובת ברירת המחדל, POST חתום ל-/v1', async () => {
  const h = await bootHost({ relay: () => ({ status: 200, body: JSON.stringify({ ok: true, messages: [] }) }) });
  const r = await h.frameInvoke('econ', 'license:remoteSync');
  const relay = h.asyncCalls.filter(c => c[0] === 'relayPost');
  assert.ok(relay.length >= 1, 'פנייה לשרת הרישוי: ' + JSON.stringify(r));
  // כל הפניות — לשרת ברירת המחדל בלבד, חתומות; ביניהן משיכת התיבה (fetch)
  for (const c of relay) {
    assert.equal(c[1], new URL(DEFAULT_RELAY_URL).origin);
    const req = JSON.parse(c[2]);
    assert.ok(req.sig && req.pub, 'בקשה חתומה: ' + req.op);
  }
  assert.ok(relay.some(c => JSON.parse(c[2]).op === 'fetch'), relay.map(c => JSON.parse(c[2]).op).join(','));
});

/* ---------- אין shell באנדרואיד: תשלום על הרשמה והתקנת עדכון ---------- */
test('אנדרואיד: license:openPayment ו-update:install — הודעה בעברית (לא "שגיאה פנימית"), בלי פנייה לשרת ובלי לגעת בעדכון', async () => {
  const h = await bootHost({ relay: () => ({ status: 200, body: JSON.stringify({ ok: true, messages: [] }) }) });
  const relayCalls = () => h.asyncCalls.filter(c => c[0] === 'relayPost').length;
  const before = relayCalls();
  const pay = await h.frameInvoke('econ', 'license:openPayment');
  assert.equal(pay.ok, false);
  assert.match(pay.error, /התשלום נפתח רק בגרסת המחשב/);
  assert.doesNotMatch(pay.error, /שגיאה פנימית|TypeError|openExternal/);
  assert.equal(relayCalls(), before, 'הבדיקה לפני הפנייה לשרת (paymentUrl)');
  const inst = await h.frameInvoke('econ', 'update:install');
  assert.equal(inst.ok, false);
  assert.match(inst.error, /באנדרואיד מתקינים את קובץ ה-APK ידנית/);
  assert.doesNotMatch(inst.error, /שגיאה פנימית|אין עדכון מוכן|openPath/);
});

/* ---------- host.js + main-android: פעילות בשמאות מאריכה את הכניסה ---------- */
test('host.js: activity מהשמאות מאריך את הפגישה; מארגז הכלים / מהכלכלי — לא; כל מסגרת רק בשם עצמה', async () => {
  const h = await bootHost();
  const auth = h.sandbox.__ssHost.require('auth-service', {}).AuthService;
  assert.equal(await h.shellAPI().open('shamai', null), true);
  await h.ready('shamai');
  await h.shellAPI().open('tools', null);
  await h.ready('tools');
  const seen = () => auth.sessions.get(2).lastSeen;
  const t0 = seen();
  let now = t0 + 60 * 1000;
  auth.now = () => now;
  h.post('tools', { ss: 'activity' });
  h.post('econ', { ss: 'activity' });
  assert.equal(seen(), t0, 'ארגז הכלים והכלכלי — לא פעילות של מודול נעול');
  h.post('shamai', { ss: 'activity' });
  assert.equal(seen(), now, 'פעילות בשמאות מאריכה את הכניסה');
  // אחרי יציאה — המסגרת של השמאות מקבלת מיד את החסימה
  await h.frameInvoke('econ', 'auth:logout');
  const blocks = h.frameOf('shamai').posted.filter(p => p.msg.ss === 'write-block');
  assert.equal(blocks.at(-1).msg.message, NO_SESSION);
});

/* ---------- frame.js: אות פעילות בשמאות ובאימונים ---------- */
test('frame.js: לחיצה / מקש / מגע בשמאות ובאימונים שולחים activity למעטפת (לכל היותר פעם ב-2 שניות); ארגז הכלים והכלכלי — לא', async () => {
  for (const mod of ['shamai', 'trainer']) {
    const f = loadFrame({ mod });
    const acts = () => f.posted.filter(p => p.msg.ss === 'activity');
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) assert.equal(typeof f.listeners[type], 'function', mod + ' ' + type);
    f.listeners.pointerdown();
    f.listeners.keydown();
    assert.equal(acts().length, 1, 'רצף מהיר — הודעה אחת');
    // ההודעה נוצרה בתוך ה-vm (אב-טיפוס אחר) — השוואה לפי JSON
    assert.equal(JSON.stringify(acts()[0]), JSON.stringify({ msg: { ss: 'activity' }, o: f.SHELL }), 'רק "הייתה פעילות", ורק למעטפת');
  }
  for (const mod of ['tools', 'econ']) {
    const f = loadFrame({ mod });
    assert.equal(f.listeners.pointerdown, undefined, mod);
  }
});

/* ---------- מסך הרישוי באנדרואיד: בלי כפתורי תשלום והתקנה ---------- */
function econUiContext() {
  const el = () => ({ id: '', textContent: '', value: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, appendChild() {}, append() {},
    querySelector: () => el(), querySelectorAll: () => [], setAttribute() {}, focus() {}, remove() {} });
  const document = { readyState: 'loading', getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => el(), body: el() };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl };
  context.window = context;
  context.systemAPI = new Proxy({}, { get: () => () => Promise.resolve({}) });
  vm.createContext(context);
  EconUI.run(context);
  return context;
}

test('מסך הרישוי באנדרואיד: בכרטיס ההרשמה אין "מעבר לתשלום", ובכרטיס העדכונים אין הורדה / קובץ / התקנה — במחשב הכול נשאר', () => {
  const ui = econUiContext();
  const pending = { planName: 'בסיסית', priceAgorot: 120000, status: 'pending' };
  // במחשב — כמו קודם
  const desk = ui.renderSignupCard(pending, false);
  assert.match(desk, /id="signupPayBtn"/);
  assert.doesNotMatch(desk, /רק בגרסת המחשב/);
  // באנדרואיד — בלי כפתור התשלום, עם הסבר; בדיקת המצב והרשמה מחדש נשארות
  const and = ui.renderSignupCard(pending, true);
  assert.doesNotMatch(and, /signupPayBtn/);
  assert.match(and, /id="signupCheckBtn"/);
  assert.match(and, /id="signupStartBtn"/);
  assert.match(and, /התשלום נפתח רק בגרסת המחשב/);
  assert.match(ui.renderSignupCard(null, true), /התשלום נפתח רק בגרסת המחשב/);
  // הדגל — לפי platform של update:getStatus (const ברמה העליונה — לא מאפיין של window, ולכן דרך runInContext)
  const licOnAndroid = vm.runInContext('licOnAndroid', ui);
  assert.equal(licOnAndroid({ update: { platform: 'android' } }), true);
  assert.equal(licOnAndroid({ update: { platform: 'win' } }), false);
  assert.equal(licOnAndroid({ update: null }), false);

  const av = { version: '9.9.10', issuedAt: Date.now(), url: 'https://example.org/a' };
  const upd = (platform, downloaded) => ui.renderUpdateCard({ currentVersion: '9.9.9', platform, available: av, downloaded }, true);
  assert.match(upd('win', null), /id="updDownloadBtn"/);
  assert.match(upd('win', null), /id="updFileBtn"/);
  assert.match(upd('win', { version: '9.9.10', path: 'x' }), /id="updInstallBtn"/);
  for (const html of [upd('android', null), upd('android', { version: '9.9.10', path: 'x' })]) {
    assert.doesNotMatch(html, /updDownloadBtn|updInstallBtn|updFileBtn/);
    assert.match(html, /מתקינים את קובץ ה-APK של הגרסה החדשה ידנית/);
  }
});

/* ---------- ממצא 57 ו-Java ---------- */
test('ממצא 57: minSdk 28 — חלון הקריאה של 64MB תמיד פעיל (אין יותר תנאי גרסה)', () => {
  const B = require('../android/build-apk');
  assert.ok(B.MIN_SDK >= 28);
  const sql = fs.readFileSync(path.join(ROOT, 'android/app/java/com/bunimseller/supersuite/SqlBridge.java'), 'utf8');
  assert.match(sql, /cursor\.setWindow\(new CursorWindow\("supersuite", 64L \* 1024 \* 1024\)\)/);
  assert.doesNotMatch(sql, /SDK_INT/);
});

test('ממצא 32: הרשאת INTERNET לשרת הרישוי בלבד — ה-WebView חסום לרשת, http חסום, ו-connect-src של המעטפת נשאר self', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'android/app/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /<uses-permission android:name="android\.permission\.INTERNET" \/>/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  const act = fs.readFileSync(path.join(ROOT, 'android/app/java/com/bunimseller/supersuite/MainActivity.java'), 'utf8');
  assert.equal((act.match(/setBlockNetworkLoads\(true\)/g) || []).length, 2, 'המעטפת וחלון ההדפסה חסומים לרשת');
  assert.doesNotMatch(act, /setBlockNetworkLoads\(false\)/);
  // הקוד היחיד שפותח חיבור — RelayClient, רק POST ל-/v1 ב-https
  const javaDir = path.join(ROOT, 'android/app/java/com/bunimseller/supersuite');
  const openers = fs.readdirSync(javaDir).filter(f => /openConnection|Socket\(|HttpURLConnection/.test(fs.readFileSync(path.join(javaDir, f), 'utf8')));
  assert.deepEqual(openers, ['RelayClient.java']);
  const relay = fs.readFileSync(path.join(javaDir, 'RelayClient.java'), 'utf8');
  assert.match(relay, /new URL\("https", host, u\.getPort\(\), "\/v1"\)/);
  assert.match(relay, /setInstanceFollowRedirects\(false\)/);
  assert.match(relay, /instanceof HttpsURLConnection/);
  // ה-CSP של המעטפת אחרי הבנייה (connect-src 'self') ואודות — נבדקים ב-tests/android-port.test.js באותה בנייה:
  // שתי בדיקות שמריצות buildWeb במקביל מוחקות זו לזו את android/build
});

test('MainActivity: תקרת פתיחת קובץ לפי הזיכרון, ו-OutOfMemoryError נתפס (לא קריסה)', () => {
  const act = fs.readFileSync(path.join(ROOT, 'android/app/java/com/bunimseller/supersuite/MainActivity.java'), 'utf8');
  assert.match(act, /MAX_OPEN_BYTES = 64L \* 1024 \* 1024/);
  assert.match(act, /Runtime\.getRuntime\(\)\.maxMemory\(\)/);
  assert.ok((act.match(/catch \(OutOfMemoryError e\)/g) || []).length >= 2);
});
