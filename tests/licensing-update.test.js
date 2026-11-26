// עדכוני גרסה חתומים: תעודה במפתח השורש, אימות קובץ (SHA-256 + גודל), אין שנמוך, הורדה, התקנה מקובץ, ופרסום דרך השרת
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../shell/licensing/license');
const UP = require('../shell/licensing/update');
const { createLicenseStore } = require('../shell/licensing/store');
const { createOwnerCore } = require('../shell/licensing/owner-core');
const { createLicenseSync } = require('../shell/licensing/sync');
const { createServer } = require('../server/license-relay');

const one = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };
const mem = () => { const m = new Map(); return { read: (n) => (m.has(n) ? m.get(n) : null), write: (n, t) => m.set(n, t) }; };
const root = L.generateKeyPair();
const BIN = crypto.randomBytes(4096);
const sha = crypto.createHash('sha256').update(BIN).digest('hex');
const rel = (over = {}) => UP.createRelease(root.privateJwk, { version: '3.9.0', fileName: 'SuperSuite-Setup-3.9.0.exe', size: BIN.length, sha256: sha,
  url: 'https://updates.example.org/SuperSuite-Setup-3.9.0.exe', notes: 'שיפורים במסך הגמ"ח', ...over }, { issuedAt: 1000 });
function manager(extra = {}) {
  const saved = {};
  const m = UP.createUpdateManager({ storage: one(), rootKeys: [root.publicJwk], currentVersion: '3.8.0', platform: 'win',
    saveFile: async (name, bytes) => { saved[name] = Buffer.from(bytes); return '/updates/' + name; }, clock: () => 5, ...extra });
  return { m, saved };
}

test('השוואת גרסאות וזיהוי פלטפורמה', () => {
  assert.equal(UP.compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(UP.compareVersions('3.8.0', '3.8.0'), 0);
  assert.equal(UP.compareVersions('2.99.99', '3.0.0'), -1);
  assert.throws(() => UP.compareVersions('3.8', '3.8.0'), /גרסה/);
  assert.equal(UP.platformOf('a.EXE'), 'win');
  assert.equal(UP.platformOf('a.apk'), 'android');
  assert.throws(() => UP.platformOf('a.zip'), /EXE או APK/);
});

test('תעודת גרסה: חתימה תקינה נקלטת; שינוי, מפתח זר, קישור http ופלטפורמה לא תואמת — נדחים', () => {
  const p = UP.verifyRelease(rel(), [root.publicJwk]);
  assert.equal(p.version, '3.9.0');
  assert.equal(p.platform, 'win');
  const t = JSON.parse(rel()); t.payload.sha256 = 'a'.repeat(64);
  assert.throws(() => UP.verifyRelease(JSON.stringify(t), [root.publicJwk]), /חתימת העדכון/);
  const evil = L.generateKeyPair();
  assert.throws(() => UP.verifyRelease(UP.createRelease(evil.privateJwk, { version: '9.9.9', fileName: 'x.exe', size: 1, sha256: sha }), [root.publicJwk]), /חתימת העדכון/);
  assert.throws(() => UP.verifyRelease(rel(), []), /אינו מוגדר/);
  assert.throws(() => rel({ url: 'http://updates.example.org/x.exe' }), /https/);
  assert.throws(() => rel({ platform: 'android' }), /אינה תואמת/);
  assert.equal(UP.verifyRelease(rel({ fileName: '..\\..\\evil.exe' }), [root.publicJwk]).fileName, 'evil.exe', 'נתיב מוסר משם הקובץ');
});

test('מנהל עדכונים: הצעה, אין שנמוך, הורדה עם בדיקת תמצית, וקובץ מזויף לא נשמר', async () => {
  let body = BIN;
  const { m, saved } = manager({ fetchImpl: async (url) => ({ ok: true, status: 200, headers: { get: () => String(body.length) }, arrayBuffer: async () => body }) });
  assert.equal(m.offer(rel({ version: '3.7.0' })).added, false, 'גרסה ישנה לא מוצעת');
  assert.equal(m.offer(rel({ fileName: 'a.apk' })).reason, 'platform');
  assert.equal(m.offer(rel()).added, true);
  assert.equal(m.status().available.version, '3.9.0');
  assert.throws(() => m.readyToInstall(), /אין עדכון מוכן/);

  body = Buffer.from(BIN); body[10] ^= 1; // הקובץ בשרת הוחלף
  await assert.rejects(m.download(), /אינו תואם/);
  assert.deepEqual(Object.keys(saved), [], 'קובץ מזויף לא נשמר');

  body = BIN;
  const r = await m.download();
  assert.equal(r.version, '3.9.0');
  assert.ok(saved['SuperSuite-Setup-3.9.0.exe'].equals(BIN));
  assert.equal(m.readyToInstall().path, '/updates/SuperSuite-Setup-3.9.0.exe');
});

test('התקנה מקובץ (USB): נבדק מול התעודה; קובץ אחר / גרסה ישנה / מערכת אחרת נדחים', async () => {
  const { m } = manager();
  await assert.rejects(m.fromFile(rel(), crypto.randomBytes(BIN.length)), /אינו תואם/);
  await assert.rejects(m.fromFile(rel({ version: '3.8.0' }), BIN), /אינה חדשה/);
  await assert.rejects(m.fromFile(rel({ fileName: 'SuperSuite.apk' }), BIN), /לאנדרואיד/);
  const r = await m.fromFile(rel(), BIN);
  assert.equal(r.version, '3.9.0');
  assert.equal(m.status().downloaded.version, '3.9.0');
});

test('פרסום דרך שרת אמיתי: מנהל-העל שולח, הלקוח מקבל בסנכרון; תעודה מזויפת דרך השרת נדחית', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-upd-relay-'));
  const server = createServer({ dataDir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const owner = createOwnerCore({ storage: mem() });
    const rootKeys = [owner.init('menahel-al-update-2026').publicKey];
    const mk = (withOwner) => {
      const store = createLicenseStore({ storage: one(), secret: one(), rootKeys });
      store.setRemoteSettings({ url });
      const updates = UP.createUpdateManager({ storage: one(), rootKeys, currentVersion: '3.8.0', platform: 'win', saveFile: async () => '' });
      return { store, updates, sync: createLicenseSync({ store, owner: withOwner ? owner : null, rootKeys, fetchImpl: fetch, updates }) };
    };
    const O = mk(true); const T = mk(false);
    await T.sync.sendLicenseRequest('ישיבת אור התורה');
    await O.sync.ownerReceive();
    const m = owner.takeFromInbox(owner.inbox()[0].id);
    await O.sync.ownerReply(m.from, 'license', owner.issue({ request: m.body, features: ['econ'], limits: { maxChildren: 0, maxUsers: 3, maxStorageMb: 10, maxDepth: 1 } }).package);
    await T.sync.receive();

    const text = UP.createRelease(owner.rootSigner(), { version: '3.9.0', fileName: 'S.exe', size: BIN.length, sha256: sha, url: 'https://u.example.org/S.exe' });
    owner.addRelease(text, UP.verifyRelease(text, rootKeys));
    assert.equal(owner.releases().length, 1);
    assert.equal((await O.sync.ownerPublishUpdate(text)).sent, 1);
    // תוקף מזויף: מישהו עם גישה לשרת שולח "עדכון" חתום במפתח אחר
    const evil = L.generateKeyPair();
    const { createRemote } = require('../shell/licensing/remote');
    await createRemote({ url, fetchImpl: fetch }).send(evil.privateJwk, [{ to: T.store.syncInfo().nodeId, kind: 'update',
      body: UP.createRelease(evil.privateJwk, { version: '9.0.0', fileName: 'evil.exe', size: 1, sha256: sha, url: 'https://evil.example.org/e.exe' }) }]);
    const r = await T.sync.receive();
    assert.equal(T.updates.status().available.version, '3.9.0', 'רק העדכון החתום נקלט');
    assert.ok(r.errors.some(e => /חתימת העדכון/.test(e)), 'המזויף נדחה: ' + r.errors);
  } finally { await new Promise(r => server.close(r)); }
});

test('הרשאות: מצב עדכון לכל משתמש, הורדה/התקנה למנהל; עדכון זמין גם במערכת נעולה', () => {
  const LG = require('../shell/licensing/gate');
  assert.equal(LG.checkChannel({ mode: 'licensed', status: 'locked', features: [] }, 'update:install', 'users.manage'), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  assert.match(src, /channel === 'update:getStatus'\) return 'data\.view'/);
  assert.match(src, /channel\.startsWith\('update:'\)\) return 'users\.manage'/);
  for (const ch of ['update:getStatus', 'update:download', 'update:fromFile', 'update:install', 'owner:releaseCreate', 'owner:releases', 'owner:releasePublish']) {
    // handleNet / handleLong — ההורדה וחלונות הבחירה מחוץ לתור (ממצא 39), אותו שומר
    assert.match(src, new RegExp(`handle(?:Net|Long)?\\('${ch}'`), ch + ' דרך השומר');
  }
});

// SuperSuite לימוד ו-SuperSuite הכלכלית חתומות באותו מפתח שורש — עדכון של מוצר אחד לא מוצע לשני
test('מוצר: עדכון של מוצר אחר נדחה גם כשהגרסה שלו גבוהה; תעודה בלי מוצר — של SuperSuite הכלכלית', () => {
  const learn = manager({ product: 'supersuite-learn', currentVersion: '1.0.0' }).m;
  assert.deepEqual(learn.offer(rel()), { added: false, reason: 'product' }, 'תעודה ישנה בלי מוצר — לא ל-SuperSuite לימוד');
  assert.equal(learn.offer(rel({ product: 'super-suite', version: '9.0.0' })).reason, 'product');
  assert.equal(learn.offer(rel({ product: 'supersuite-learn', version: '1.0.1' })).added, true);
  const econ = manager().m;
  assert.equal(econ.offer(rel()).added, true, 'ברירת המחדל — כמו קודם');
  assert.equal(econ.offer(rel({ product: 'supersuite-learn', version: '3.9.1' })).reason, 'product');
  // המוצר חלק מהחתימה: שינוי שלו שובר אותה
  const t = JSON.parse(rel({ product: 'supersuite-learn' }));
  t.payload.product = 'super-suite';
  assert.throws(() => UP.verifyRelease(JSON.stringify(t), [root.publicJwk]), /חתימת העדכון/);
  assert.throws(() => rel({ product: 'Bad Name!' }), /שם המוצר/);
  // שחרור גרסה ממצב מנהל-העל חותם את המוצר של ההתקנה
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'modules/econ/ipc.js'), 'utf8');
  assert.match(ipc, /UP\.createRelease\(ownerCore\.rootSigner\(\), \{.*product: appProductOf\(\)/);
  assert.match(ipc, /product: opts\.appProduct \|\| appProductOf\(\)/);
});
