// שירות הסנכרון (shell/sync/service.js): הפעלה, צימוד מקצה לקצה עם אישור, בדיקת חיבור, ביטול ומצב שבת.
// שני שירותים אמיתיים מתקשרים על 127.0.0.1; safeStorage מדומה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createSyncService, parseEndpoint } = require(path.join(ROOT, 'shell/sync/service.js'));

const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(s).map(b => b ^ 0x5a)]),
  decryptString: (b) => { if (b.subarray(0, 4).toString() !== 'ENC:') throw new Error('x'); return Buffer.from(b.subarray(4).map(c => c ^ 0x5a)).toString(); },
});

const services = [];
const dirs = [];
test.after(async () => {
  await Promise.all(services.map(s => s.close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

async function makeService({ paused = { value: false }, available = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-svc-'));
  dirs.push(dir);
  const svc = createSyncService({
    dir, safeStorage: fakeSafeStorage(available), isPaused: () => paused.value,
    discovery: false, limits: { handshakeMs: 3000, pairingMs: 3000 },
  });
  services.push(svc);
  await svc.init();
  return { svc, dir, paused };
}
// פורט פנוי מהמערכת — פורט "אקראי" קבוע מתנגש לפעמים כשכל הבדיקות רצות במקביל
const net = require('net');
const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const until = async (fn, ms = 3000) => {
  for (let t = 0; t < ms; t += 50) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return false;
};

test('כתובות: host:port, ברירת מחדל לפורט, IPv6 בסוגריים; קלט זדוני נדחה', () => {
  assert.deepEqual(parseEndpoint('192.168.1.20:5000'), { host: '192.168.1.20', port: 5000 });
  assert.deepEqual(parseEndpoint('office.local'), { host: 'office.local', port: 47700 });
  assert.deepEqual(parseEndpoint('[fe80::1]:6000'), { host: 'fe80::1', port: 6000 });
  for (const bad of ['', 'a b', 'host:0', 'host:70000', 'http://x', 'x;rm -rf', 'א.ב']) assert.equal(parseEndpoint(bad), null, bad);
});

test('כבוי כברירת מחדל: לא מאזין, אין זהות; בלי DPAPI — לא ניתן להפעיל', async () => {
  const { svc, dir } = await makeService();
  const st = svc.status();
  assert.equal(st.enabled, false);
  assert.equal(st.listening, null);
  assert.equal(st.device, null);
  assert.ok(!fs.existsSync(path.join(dir, 'sync-identity.bin')));

  const { svc: noEnc } = await makeService({ available: false });
  assert.equal(noEnc.status().available, false);
  await assert.rejects(noEnc.setEnabled(true), { code: 'no-encryption' });
});

test('הפעלה: מאזין, הזהות והמצב נשמרים מוצפנים, ונטענים אחרי הפעלה מחדש', async () => {
  const { svc, dir } = await makeService();
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  const st = svc.status();
  assert.equal(st.enabled, true);
  assert.ok(st.listening);
  assert.ok(st.device && st.device.id);
  const raw = fs.readFileSync(path.join(dir, 'sync-state.bin'), 'utf8');
  assert.ok(raw.startsWith('ENC:') && !raw.includes('"enabled"'), 'המצב מוצפן');
  await svc.close();

  const again = createSyncService({ dir, safeStorage: fakeSafeStorage(), discovery: false });
  services.push(again);
  await again.init();
  assert.equal(again.status().enabled, true);
  assert.equal(again.status().device.id, st.device.id, 'אותה זהות');
});

async function twoEnabled() {
  const a = await makeService(), b = await makeService();
  await a.svc.setPort(await freePort());
  await b.svc.setPort(await freePort());
  await a.svc.setEnabled(true); await b.svc.setEnabled(true);
  return { a: a.svc, b: b.svc };
}

async function pairServices(a, b) {
  const inv = a.createInvite('127.0.0.1');
  const joined = await b.join(inv.code);
  assert.ok(await until(() => a.status().approvals.length === 1));
  const incoming = a.status().approvals[0];
  return { joined, incoming };
}

test('צימוד מקצה לקצה: אותו קוד בשני המכשירים, נשמר רק אחרי אישור בשניהם, ואז מתחברים', async () => {
  const { a, b } = await twoEnabled();
  assert.ok(a.status().pairing === null);
  const { joined, incoming } = await pairServices(a, b);
  assert.match(joined.code, /^\d{6}$/);
  assert.equal(incoming.code, joined.code);
  assert.equal(incoming.direction, 'incoming');
  assert.equal(incoming.name, b.status().device.name);
  assert.equal(a.status().peers.length, 0, 'לא נשמר לפני אישור');
  assert.equal(b.status().peers.length, 0);

  await a.approve(incoming.reqId);
  await b.approve(joined.reqId);
  assert.equal(a.status().peers.length, 1);
  assert.equal(b.status().peers.length, 1);
  assert.equal(a.status().pairing, null, 'ההזמנה נסגרה');
  assert.ok(await until(() => b.status().peers[0].connected), 'המצטרף מתחבר מיד');
  const r = await b.ping(a.status().device.id);
  assert.ok(r.ms >= 0);
  const r2 = await a.ping(b.status().device.id);
  assert.ok(r2.ms >= 0, 'גם בכיוון ההפוך');
});

test('דחייה: "המספרים שונים" — המכשיר לא נשמר; אישור שפג — נדחה', async () => {
  const { a, b } = await twoEnabled();
  const { joined, incoming } = await pairServices(a, b);
  a.reject(incoming.reqId);
  b.reject(joined.reqId);
  assert.equal(a.status().peers.length, 0);
  assert.equal(b.status().peers.length, 0);
  await assert.rejects(a.approve(incoming.reqId), { code: 'approval-expired' });
});

test('ביטול מכשיר: מנותק מיד, לא מתחבר שוב, והכתובת נמחקת', async () => {
  const { a, b } = await twoEnabled();
  const { joined, incoming } = await pairServices(a, b);
  await a.approve(incoming.reqId); await b.approve(joined.reqId);
  const bId = b.status().device.id, aId = a.status().device.id;
  assert.ok(await until(() => a.status().peers[0].connected));
  a.revoke(bId);
  const peer = a.status().peers[0];
  assert.equal(peer.revoked, true);
  assert.equal(peer.connected, false);
  await assert.rejects(b.ping(aId));
  assert.throws(() => a.revoke('לא-קיים'), { code: 'unknown' });
});

test('מצב שבת: הסנכרון מושהה (לא מאזין), וחוזר אחרי צאת השבת', async () => {
  const paused = { value: true };
  const { svc } = await makeService({ paused });
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  let st = svc.status();
  assert.equal(st.enabled, true);
  assert.equal(st.paused, true);
  assert.equal(st.listening, null, 'בשבת לא מאזינים');
  assert.throws(() => svc.createInvite('127.0.0.1'), { code: 'disabled' });
  paused.value = false;
  await svc.setEnabled(true); // כמו הבדיקה התקופתית: מחיל מחדש
  st = svc.status();
  assert.equal(st.paused, false);
  assert.ok(st.listening);
});

test('קלט מהמעטפת: שם ריק, פורט לא חוקי וכתובת זדונית — נדחים בעברית', async () => {
  const { svc } = await makeService();
  assert.throws(() => svc.rename('   '), { code: 'bad-name' });
  await assert.rejects(svc.setPort(80), { code: 'bad-port' });
  await assert.rejects(svc.setPort('47700'), { code: 'bad-port' });
  await svc.setPort(await freePort());
  await svc.setEnabled(true);
  assert.throws(() => svc.createInvite('x;y'), { code: 'bad-endpoint' });
  await assert.rejects(svc.join('SSPAIR1.xyz', 'a b'), { code: 'bad-endpoint' });
  assert.equal(svc.rename('מחשב\u0007 המשרד').device.name, 'מחשב המשרד', 'תווי בקרה מוסרים');
});
