// בדיקת קוד 23.10.2026 — סנכרון ברשת המקומית (ממצאים נמוכים; ממצא 55 — ב-tests/main-behavior.test.js).
// חיבורים אמיתיים על 127.0.0.1; safeStorage מדומה. כל בדיקה כאן נכשלת על הקוד שלפני התיקון.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Identity = require(path.join(ROOT, 'shell/sync/identity.js'));
const Pairing = require(path.join(ROOT, 'shell/sync/pairing.js'));
const Cert = require(path.join(ROOT, 'shell/sync/cert.js'));
const Envelope = require(path.join(ROOT, 'shell/sync/envelope.js'));
const D = require(path.join(ROOT, 'shell/sync/discovery.js'));
const T = require(path.join(ROOT, 'shell/sync/transport.js'));
const { createSyncService } = require(path.join(ROOT, 'shell/sync/service.js'));

const HOST = '127.0.0.1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { for (let t = 0; t < ms; t += 25) { if (fn()) return true; await sleep(25); } return false; };
const once = (em, ev) => new Promise((r) => em.once(ev, (...a) => r(a)));
// חיבורים אמיתיים: בדיקה שנתקעת נכשלת בזמן ולא תוקעת את כל ההרצה
const ttest = (name, fn) => test(name, { timeout: 20000 }, fn);

const nodes = [];
const services = [];
const dirs = [];
test.after(async () => {
  await Promise.all([...nodes.map(n => n.close()), ...services.map(s => s.close())]);
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* run-tests ינקה */ } }
});
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sync-lan-')); dirs.push(d); return d; };

function device(name, limits = {}) {
  const identity = Identity.createIdentity(name);
  const dev = { identity, peers: [], states: [] };
  dev.node = T.createPeerNode({
    identity, getPeers: () => dev.peers, savePeers: (l) => { dev.peers = l; },
    state: null, onState: (s) => dev.states.push(s), limits: { handshakeMs: 3000, pairingMs: 3000, ...limits },
  });
  nodes.push(dev.node);
  return dev;
}
// חיבור TCP גולמי (בלי TLS) — כמו מי שפותח חיבורים לפורט כדי לתפוס את כל המקומות
function rawTcp(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, HOST, () => resolve(s));
    s.closedAt = null;
    s.on('close', () => { s.closedAt = Date.now(); });
    s.on('error', () => {});
  });
}
function rawTls(port, identity = Identity.createIdentity('זר')) {
  const { cert, key } = Cert.selfSignedCert(identity.tls, { commonName: 'x' });
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: HOST, port, cert, key, ALPNProtocols: [T.ALPN], rejectUnauthorized: false, minVersion: 'TLSv1.3', checkServerIdentity: () => undefined });
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
}

const fakeSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(s).map(b => b ^ 0x5a)]),
  decryptString: (b) => { if (b.subarray(0, 4).toString() !== 'ENC:') throw new Error('x'); return Buffer.from(b.subarray(4).map(c => c ^ 0x5a)).toString(); },
});
const freePort = () => new Promise((resolve) => { const srv = net.createServer().listen(0, HOST, () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });
async function service(opts = {}) {
  const dir = tmp();
  const svc = createSyncService({ dir, safeStorage: fakeSafeStorage(), discovery: false, limits: { handshakeMs: 3000, pairingMs: 3000 }, ...opts });
  services.push(svc);
  await svc.init();
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  return { svc, dir };
}
const readState = (dir) => JSON.parse(fakeSafeStorage().decryptString(fs.readFileSync(path.join(dir, 'sync-state.bin'))));
async function pair(a, b) {
  const inv = a.createInvite(HOST);
  const joined = await b.join(inv.code);
  assert.ok(await until(() => a.status().approvals.length === 1));
  await a.approve(a.status().approvals[0].reqId);
  await b.approve(joined.reqId);
}

// ── חסימת הסנכרון בלי אימות ──
ttest('transport: כתובת אחת לא תופסת את כל החיבורים — מעבר למגבלה לכתובת החיבור נסגר מיד', async () => {
  const a = device('מחשב', { maxPerAddress: 3 });
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const socks = [];
  // החיבורים נסגרים גם כשבדיקה נכשלת — אחרת חיבור פתוח מחזיק את התהליך
  try {
    for (let i = 0; i < 6; i++) socks.push(await rawTcp(port));
    assert.ok(await until(() => socks.filter(s => s.closedAt).length === 3, 1500), 'שלושה חיבורים מעבר למגבלה נסגרו');
    assert.equal(socks.slice(0, 3).filter(s => s.closedAt).length, 0, 'שלושת הראשונים עדיין פתוחים (ממתינים ללחיצת היד)');
    // חיבור שנסגר מפנה מקום
    socks[0].destroy();
    await until(() => socks[0].closedAt);
    await sleep(50);
    const next = await rawTcp(port);
    socks.push(next);
    await sleep(200);
    assert.equal(next.closedAt, null, 'אחרי שחיבור נסגר — חיבור חדש מתקבל');
  } finally { for (const s of socks) s.destroy(); }
});

ttest('transport: חיבור צימוד נסגר בתום הזמן הכולל, גם כשהצד השני שולח בית כל כמה רגעים', async () => {
  const a = device('מחשב', { pairingMs: 400 });
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  a.node.openPairing({ host: HOST, port });
  const s = await rawTls(port);
  s.on('error', () => {});
  let closedAt = null;
  const started = Date.now();
  s.on('close', () => { closedAt = Date.now(); });
  // כותרת של מסגרת באורך 1000, ואז בית אחד כל 100ms — זמן הסרק (400ms) לא מגיע לעולם
  const head = Buffer.alloc(4); head.writeUInt32BE(1000);
  s.write(head);
  const drip = setInterval(() => { if (!s.destroyed) s.write(Buffer.from(' ')); }, 100);
  try {
    assert.ok(await until(() => closedAt, 2000), 'החיבור נסגר');
    assert.ok(closedAt - started < 1500, `נסגר אחרי ${closedAt - started}ms`);
  } finally { clearInterval(drip); s.destroy(); }
});

// ── אישור צימוד אחרי הפעלה מחדש של הרשת ──
ttest('transport: צומת שנסגר לא כותב מצב סנכרון — גם כשמאשרים בקשת צימוד שהתקבלה בו', async () => {
  const a = device('מחשב'), b = device('טלפון');
  const { port } = await a.node.listen({ host: HOST, port: 0 });
  const pairOnce = async () => {
    const code = a.node.openPairing({ host: HOST, port });
    const req = once(a.node, 'pair-request');
    const joined = await b.node.joinPairing(code);
    const [request] = await req;
    joined.approve();
    return request;
  };
  (await pairOnce()).approve();
  // הודעה מ-b — אצל a נוצר חלון שידור חוזר של b (בלעדיו האישור לא כותב כלום גם בקוד הישן)
  const got = once(a.node, 'message');
  await b.node.connect(a.identity.id, { host: HOST, port });
  b.node.send(a.identity.id, { type: 'ping', nonce: 'n1' });
  await got;
  // צימוד מחדש של b: הבקשה מתקבלת, ואז הרשת של a נסגרת לפני האישור
  a.node.revoke(b.identity.id);
  const request = await pairOnce();
  await a.node.close();
  const before = a.states.length;
  request.approve();
  assert.equal(a.states.length, before, 'אין כתיבה של המצב הישן');
  assert.ok(a.peers.some(p => p.id === b.identity.id && !p.revoked), 'המכשיר עדיין נשמר ברשימה');
});

ttest('service: אישור צימוד אחרי הפעלה מחדש של הרשת לא מחזיר את מצב הסנכרון אחורה, והאיפוס חל על הצומת הפעיל', async () => {
  const { svc: a, dir } = await service(), { svc: b } = await service(), { svc: c } = await service();
  await pair(a, b);
  await pair(a, c);
  const aId = a.status().device.id, bId = b.status().device.id, cId = c.status().device.id;
  assert.ok(await until(() => b.status().peers[0].connected));
  await b.ping(aId); // יש חלון שידור חוזר של b אצל a
  // צימוד מחדש של b: ביטול, קוד חדש, והבקשה ממתינה לאישור
  a.revoke(bId);
  const joined = await b.join(a.createInvite(HOST).code);
  assert.ok(joined.reqId);
  assert.ok(await until(() => a.status().approvals.length === 1));
  const reqId = a.status().approvals[0].reqId;
  // הרשת של a מופעלת מחדש (שינוי פורט / יציאת שבת), ואז תעבורה עם c מקדמת את המצב
  const newPort = await freePort();
  await a.setPort(newPort);
  await c.connect(aId, `${HOST}:${newPort}`);
  await c.ping(aId);
  await c.ping(aId);
  const before = readState(dir).transport;
  assert.ok(before.replay[cId], 'המצב העדכני נשמר');
  await a.approve(reqId);
  const after = readState(dir).transport;
  assert.ok(after.outSeq >= before.outSeq, `המונה לא חזר אחורה (${after.outSeq} < ${before.outSeq})`);
  assert.ok(after.replay[cId] && after.replay[cId].max >= before.replay[cId].max, 'חלון השידור החוזר של c לא חזר אחורה');
  assert.equal(after.replay[bId], undefined, 'החלון של b אופס בצומת הפעיל');
  assert.ok(a.status().peers.some(p => p.id === bId && !p.revoked), 'b מצומד מחדש');
});

// מכשיר מצומד שבוטל, בקשת צימוד חדשה שלו ממתינה לאישור אצל a, ויש אצל a חלון שידור חוזר ישן שלו
async function pendingRepair(opts) {
  const { svc: a, dir } = await service(opts), { svc: b } = await service();
  await pair(a, b);
  const aId = a.status().device.id, bId = b.status().device.id;
  assert.ok(await until(() => b.status().peers[0].connected));
  await b.ping(aId);
  a.revoke(bId);
  const joined = await b.join(a.createInvite(HOST).code);
  assert.ok(joined.reqId);
  assert.ok(await until(() => a.status().approvals.length === 1));
  return { a, dir, bId, reqId: a.status().approvals[0].reqId };
}

ttest('service: אישור צימוד כשהרשת עצורה (הפורט תפוס) — המכשיר נשמר, החלון שלו מתאפס במצב השמור, והמונה לא חוזר אחורה', async () => {
  const { a, dir, bId, reqId } = await pendingRepair();
  // הרשת נעצרת: הפורט החדש תפוס בתוכנה אחרת, וההאזנה נכשלת
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '0.0.0.0', r));
  try {
    await a.setPort(blocker.address().port);
    assert.equal(a.status().listening, null, 'הרשת עצורה');
    assert.match(a.status().error, /תפוס/);
    const before = readState(dir).transport;
    assert.ok(before.replay[bId], 'יש חלון ישן של b');
    await a.approve(reqId);
    const after = readState(dir).transport;
    assert.equal(after.replay[bId], undefined, 'החלון של b אופס במצב השמור');
    assert.equal(after.outSeq, before.outSeq, 'המונה לא השתנה');
    assert.ok(a.status().peers.some(p => p.id === bId && !p.revoked), 'b מצומד מחדש');
  } finally { await new Promise((r) => blocker.close(r)); }
});

ttest('service: בשבת וביום טוב אין אישור צימוד — גם לבקשה שהתקבלה לפני כניסתם', async () => {
  let paused = false;
  const { a, dir, bId, reqId } = await pendingRepair({ isPaused: () => paused });
  // השבת נכנסה; בדיקת השירות (פעם בדקה) עוד לא רצה — האישור נבדק מול המצב הנוכחי
  paused = true;
  const before = fs.readFileSync(path.join(dir, 'sync-state.bin'));
  await assert.rejects(a.approve(reqId), (err) => err.code === 'paused' && /שבת/.test(err.message));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'sync-state.bin')), before, 'המצב השמור לא השתנה');
  assert.ok(a.status().peers.some(p => p.id === bId && p.revoked), 'b לא צומד');
  // הבקשה לא נצרכה: אחרי צאת השבת (בתוך זמן התוקף) אפשר לאשר
  paused = false;
  await a.approve(reqId);
  assert.ok(a.status().peers.some(p => p.id === bId && !p.revoked), 'b מצומד אחרי צאת השבת');
});

// ── מספר המכשירים במשואה ──
ttest('discovery: מספר התגיות במשואה קבוע — לא חושף כמה מכשירים מצומדים, גם מעל 8', () => {
  const self = Identity.createIdentity('מחשב');
  const lengths = new Set();
  const counts = new Set();
  for (const n of [1, 8, 9, 20, 64]) {
    let peers = [];
    for (let i = 0; i < n; i++) peers = Pairing.addPeer(peers, Identity.publicInfo(Identity.createIdentity('עמית ' + i)));
    const beacon = D.buildBeacon(D.discoveryKeys(self, peers), 47700, 1792000000000);
    counts.add(JSON.parse(beacon.toString()).t.length);
    lengths.add(beacon.length);
  }
  assert.equal(counts.size, 1, 'אותו מספר תגיות: ' + [...counts].join(','));
  assert.equal(lengths.size, 1, 'אותו אורך: ' + [...lengths].join(','));
  // והמשואה עדיין נכנסת במגבלה של המקבל ובמנה אחת של UDP
  assert.ok([...lengths][0] <= 1400, String([...lengths][0]));
});

// ── מגבלת המעטפה מול מגבלת המסגרת ──
ttest('envelope: הודעה בגודל המרבי של המעטפה נכנסת במסגרת; גדולה ממנו — נדחית כבר במעטפה', () => {
  const a = Identity.createIdentity('א'), b = Identity.createIdentity('ב');
  const pb = Identity.publicInfo(b);
  assert.ok(Number.isInteger(Envelope.MAX_BODY) && Envelope.MAX_BODY > 0);
  const body = 'x'.repeat(Envelope.MAX_BODY - 2); // JSON של מחרוזת = שני מרכאות
  const env = Envelope.seal({ identity: a, peer: pb, seq: 1, body });
  const frame = T.encodeFrame({ t: 'env', env });
  assert.ok(frame.length - 4 <= T.MAX_FRAME);
  assert.throws(() => Envelope.seal({ identity: a, peer: pb, seq: 2, body: body + 'x' }), { code: 'too-large' });
});

// ── הזמנה שפגה באמצע הצימוד ──
ttest('service.join: הזמנה שפג תוקפה אחרי שהצימוד כבר הושלם — הבקשה לאישור נוצרת', async () => {
  const clock = { offset: 0 };
  const { svc: a } = await service();
  const { svc: b } = await service({ now: () => Date.now() + clock.offset });
  // הרגע שבו המזמין סיים את הצימוד (ושולח pair-ok) — השעון אצל המצטרף עובר את תוקף ההזמנה
  a.on('changed', () => { if (a.status().approvals.length) clock.offset = Pairing.INVITE_TTL_MS + 60 * 1000; });
  const inv = a.createInvite(HOST);
  const joined = await b.join(inv.code);
  assert.match(joined.code, /^\d{6}$/);
  assert.equal(b.status().approvals.length, 1);
  await b.approve(joined.reqId);
  const peer = b.status().peers[0];
  assert.equal(peer.endpoint, inv.endpoint, 'הכתובת מההזמנה נשמרה');
});

// ── חלון המכשירים במצב שבת ──
function loadDevices({ shabbat = false, observer = false } = {}) {
  const els = {};
  const fakeEl = () => ({
    hidden: false, textContent: '', children: [], style: {},
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    replaceChildren(...c) { this.children = c; }, append(...c) { this.children.push(...c); },
    setAttribute() {}, focus() {}, select() {},
    close() { this.closed = (this.closed || 0) + 1; },
    showModal() { this.opened = (this.opened || 0) + 1; },
  });
  const bodyClasses = new Set(shabbat ? ['shabbat'] : []);
  // MutationObserver מדומה: שינוי מחלקה ב-body מפעיל את כל המאזינים
  const mutations = [];
  const extra = observer ? {
    MutationObserver: function MutationObserver(cb) { this.observe = (target, opts) => mutations.push({ cb, target, opts }); },
  } : {};
  const setBodyClass = (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); for (const m of mutations) m.cb([]); };
  let onChanged = null;
  const status = { value: null };
  const api = {
    status: async () => status.value,
    onChanged: (cb) => { onChanged = cb; },
  };
  const document = {
    getElementById: (id) => (els[id] = els[id] || fakeEl()),
    createElement: () => fakeEl(),
    createTextNode: (t) => ({ t }),
    body: { classList: { contains: (c) => bodyClasses.has(c) } },
    execCommand() {},
  };
  const window = { shellAPI: { sync: api, setOverlay() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'shell/devices.js'), 'utf8'), {
    window, document, ssDialog: { confirm: async () => true }, Option: function Option() {}, setInterval, clearInterval, console, ...extra,
  });
  const st = (over = {}) => ({
    available: true, enabled: true, paused: false, listening: null, port: 47700, addresses: [], device: null, error: null,
    identityUnreadable: false, stateUnreadable: false, pairing: null, peers: [],
    approvals: [{ reqId: 'r1', name: 'מחשב הבית', deviceId: 'x', code: '123456', direction: 'incoming' }], ...over,
  });
  const fire = async () => { onChanged(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  return { dlg: () => els.devDlg, status, st, fire, bodyClasses, setBodyClass, mutations };
}

ttest('devices.js: בקשת צימוד לא פותחת את חלון המכשירים מעל מסך השבת', async () => {
  const shab = loadDevices({ shabbat: true });
  shab.status.value = shab.st();
  await shab.fire();
  assert.equal(shab.dlg().opened, undefined, 'במצב שבת החלון לא נפתח מעצמו');
  // השירות מדווח "מושהה" (שבת) גם אם מסך השבת עוד לא עודכן
  const paused = loadDevices();
  paused.status.value = paused.st({ paused: true });
  await paused.fire();
  assert.equal(paused.dlg().opened, undefined);
  // ביום חול — נפתח, כדי שהמשתמש יראה את הקוד להשוואה
  const weekday = loadDevices();
  weekday.status.value = weekday.st();
  await weekday.fire();
  assert.equal(weekday.dlg().opened, 1);
});

ttest('devices.js: חלון שנפתח ביום שישי נסגר כשהשבת נכנסת — לא נשאר מעל מסך השבת', async () => {
  // מסך השבת עלה, ואז השירות שולח "changed" (הרשת נעצרה)
  const shab = loadDevices();
  shab.status.value = shab.st();
  await shab.fire();
  assert.equal(shab.dlg().opened, 1, 'ביום חול החלון נפתח');
  await shab.fire();
  assert.equal(shab.dlg().closed, undefined, 'עוד יום חול — רק רענון');
  shab.bodyClasses.add('shabbat');
  await shab.fire();
  assert.equal(shab.dlg().closed, 1, 'במסך השבת החלון נסגר');
  // השירות מדווח "מושהה" לפני שמסך השבת עודכן
  const paused = loadDevices();
  paused.status.value = paused.st();
  await paused.fire();
  paused.status.value = paused.st({ paused: true });
  await paused.fire();
  assert.equal(paused.dlg().closed, 1);
  // מסך השבת עולה בלי אירוע של הסנכרון (למשל הסנכרון כבוי) — נסגר דרך שינוי המחלקה ב-body
  const quiet = loadDevices({ observer: true });
  assert.equal(quiet.mutations.length, 1, 'נרשם מאזין');
  assert.deepEqual([...quiet.mutations[0].opts.attributeFilter], ['class']);
  quiet.status.value = quiet.st();
  await quiet.fire();
  assert.equal(quiet.dlg().opened, 1);
  quiet.setBodyClass('other', true);
  assert.equal(quiet.dlg().closed, undefined, 'מחלקה אחרת — לא נסגר');
  quiet.setBodyClass('shabbat', true);
  assert.equal(quiet.dlg().closed, 1, 'מסך השבת — נסגר');
  quiet.setBodyClass('shabbat', true);
  assert.equal(quiet.dlg().closed, 1, 'חלון סגור לא נסגר שוב');
});
