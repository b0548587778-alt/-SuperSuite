// הצפנת מסד הנתונים במחשב (PLAN.md 3.1): אין שמות או ת"ז קריאים בקובץ, שדרוג מ-3.10.0 שומר על הכול,
// מפתח שאבד נפתח בקוד השחזור, ולעולם לא נוצר מפתח חדש בשקט מעל נתונים מוצפנים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const { initializeDatabase, setAsideLockedDatabase } = require('../modules/econ/core/database');
const AR = require('../modules/econ/core/atRest');
const { resolveDbKey } = require('../shell/db-key');
const AutoBk = require('../shell/auto-backup');
const BK = require('../modules/econ/core/backupCrypto');

const SECRET_NAME = 'יעקב אברהמי';
const SECRET_ID = '039337423';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-atrest-' + p + '-'));
const backupKey = () => crypto.randomBytes(32).toString('base64');
const fixedCipher = (key) => ({ resolveCipher: async () => ({ key: AR.deriveDbKey(key), status: 'encrypted' }) });

// DPAPI מדומה: "הצפנה" הפיכה עם סימון, כדי שקובץ המפתח לא יהיה טקסט המפתח עצמו
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('DPAPI:' + Buffer.from(s).toString('hex')),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith('DPAPI:')) throw new Error('bad');
      return Buffer.from(t.slice(6), 'hex').toString();
    }
  };
}

// כל הבתים בקובץ המסד ובקבצי ה-WAL שלו
function rawBytes(dir) {
  return ['', '-wal', '-shm'].map(ext => path.join(dir, 'unified_economics.db' + ext))
    .filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f)).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0));
}
const containsText = (buf, text) => buf.includes(Buffer.from(text, 'utf8'));

async function seed(db) {
  const data = await db.load();
  data.donors = [{ id: 'd1', name: SECRET_NAME, idNumber: SECRET_ID }];
  data.organization = { name: 'גמ"ח אור החסד', type: 'עמותה' };
  await db.save(data);
  await db.audit(null, 'test.event', JSON.stringify({ donor: SECRET_NAME }));
}

test('AES-GCM: הצפנה ופענוח, ערך גלוי ישן נקרא כמו שהוא, מפתח שגוי נכשל', () => {
  const c = AR.createCipher(AR.deriveDbKey(backupKey()));
  const sealed = c.seal('{"a":1}');
  assert.ok(AR.isSealed(sealed));
  assert.equal(c.open(sealed), '{"a":1}');
  assert.notEqual(c.seal('x'), c.seal('x'), 'IV אקראי בכל כתיבה');
  assert.equal(c.open('{"old":true}'), '{"old":true}');
  const other = AR.createCipher(AR.deriveDbKey(backupKey()));
  assert.throws(() => other.open(sealed), (e) => e.code === 'db-key-wrong');
  // בלי מפתח: ערך מוצפן לא הופך לריק בשקט
  assert.throws(() => AR.createCipher(null).open(sealed), (e) => e.code === 'db-key-missing');
});

test('מפתח המסד שונה ממפתח הגיבוי ונגזר ממנו באופן קבוע', () => {
  const k = backupKey();
  assert.deepEqual(AR.deriveDbKey(k), AR.deriveDbKey(k));
  assert.notDeepEqual(AR.deriveDbKey(k), Buffer.from(k, 'base64'));
  assert.throws(() => AR.deriveDbKey('short'), (e) => e.code === 'db-key-invalid');
});

test('מסד חדש עם מפתח: אין שם או ת"ז קריאים בקובץ, והנתונים נטענים', async () => {
  const dir = tmp('new');
  const key = backupKey();
  const db = await initializeDatabase(dir, fixedCipher(key));
  await seed(db);
  assert.equal(db.atRestStatus, 'encrypted');
  db.db.close();
  const raw = rawBytes(dir);
  assert.ok(!containsText(raw, SECRET_NAME), 'שם התורם לא מופיע בקובץ');
  assert.ok(!containsText(raw, SECRET_ID), 'ת"ז לא מופיעה בקובץ');
  assert.ok(!containsText(raw, 'אור החסד'), 'שם הארגון לא מופיע בקובץ');

  const again = await initializeDatabase(dir, fixedCipher(key));
  const data = await again.load();
  assert.equal(data.donors[0].name, SECRET_NAME);
  const audit = await again.listAudit({ action: 'test.' });
  assert.match(audit[0].details, new RegExp(SECRET_NAME));
  again.db.close();
});

test('בלי מפתח (אין DPAPI): עובד כמו פעם, גלוי', async () => {
  const dir = tmp('plain');
  const db = await initializeDatabase(dir, { resolveCipher: async () => ({ key: null, status: 'plain-no-dpapi' }) });
  await seed(db);
  assert.equal(db.atRestStatus, 'plain-no-dpapi');
  assert.equal((await db.load()).donors[0].name, SECRET_NAME);
  db.db.close();
});

test('מסד מוצפן נפתח במפתח שגוי או בלי מפתח ← שגיאה, לא נתונים ריקים', async () => {
  const dir = tmp('wrong');
  const db = await initializeDatabase(dir, fixedCipher(backupKey()));
  await seed(db);
  db.db.close();
  await assert.rejects(initializeDatabase(dir, { resolveCipher: async () => ({ key: null, status: 'missing' }) }), (e) => e.code === 'db-key-missing');
  await assert.rejects(initializeDatabase(dir), (e) => e.code === 'db-key-missing');
  // מפתח שגוי: verify דוחה אותו — resolveCipher לא מחזיר אותו
  let verified;
  await assert.rejects(initializeDatabase(dir, { resolveCipher: async ({ hasSealedData, verify }) => {
    verified = { hasSealedData, ok: verify(AR.deriveDbKey(backupKey())) };
    return { key: null, status: 'missing' };
  } }));
  assert.deepEqual(verified, { hasSealedData: true, ok: false });
});

test('המרה: גיבוי לפני, ואם הגיבוי נכשל — אין המרה והנתונים נשארים', async () => {
  const dir = tmp('convert');
  const plainDb = await initializeDatabase(dir);
  await seed(plainDb);
  plainDb.db.close();

  const key = backupKey();
  const failing = await initializeDatabase(dir, { ...fixedCipher(key), beforeEncrypt: async () => { throw new Error('disk full'); } });
  assert.equal(failing.atRestStatus, 'pending-backup');
  assert.equal((await failing.load()).donors[0].name, SECRET_NAME);
  failing.db.close();
  assert.ok(containsText(rawBytes(dir), SECRET_NAME), 'בלי גיבוי — לא ממירים');

  let backedUp = null;
  const ok = await initializeDatabase(dir, { ...fixedCipher(key), beforeEncrypt: async (db) => { backedUp = await db.backup(); } });
  assert.equal(backedUp.donors[0].name, SECRET_NAME, 'הגיבוי נלקח מהנתונים לפני ההמרה');
  assert.equal(ok.atRestStatus, 'encrypted');
  assert.equal((await ok.load()).donors[0].name, SECRET_NAME);
  ok.db.close();
  assert.ok(!containsText(rawBytes(dir), SECRET_NAME), 'אחרי ההמרה וה-VACUUM — אין שאריות גלויות');
});

test('שדרוג ממסד שנוצר בקוד של גרסה 3.10.0: הכול נשאר, ושחזור גיבוי ישן עובד', async () => {
  const dir = tmp('upgrade');
  const oldDir = tmp('v3100');
  // הקוד של 3.10.0 כמו שהוא, מתוך ההיסטוריה
  const oldSrc = execFileSync('git', ['show', '7a9b98a:modules/econ/core/database.js'], { cwd: ROOT, encoding: 'utf8' });
  fs.writeFileSync(path.join(oldDir, 'database.js'), oldSrc);
  const Old = require(path.join(oldDir, 'database.js'));
  const old = await Old.initializeDatabase(dir);
  await old.setupAdmin('admin_old', 'a-very-long-pass-2026');
  await seed(old);
  const oldBackup = await old.backup();
  old.db.close();
  assert.ok(containsText(rawBytes(dir), SECRET_NAME), 'ב-3.10.0 הנתונים גלויים');

  const key = backupKey();
  const db = await initializeDatabase(dir, { ...fixedCipher(key), beforeEncrypt: async () => {} });
  const data = await db.load();
  assert.equal(data.donors[0].name, SECRET_NAME);
  assert.equal(data.organization.name, 'גמ"ח אור החסד');
  const user = await db.authenticate('admin_old', 'a-very-long-pass-2026');
  assert.equal(user.username, 'admin_old', 'המשתמשים והסיסמאות נשמרו');
  assert.match((await db.listAudit({ action: 'test.' }))[0].details, new RegExp(SECRET_NAME));

  // גיבוי שנוצר ב-3.10.0 משוחזר לתוך המסד המוצפן
  oldBackup.donors = [{ id: 'd2', name: 'שמעון לוי' }];
  await db.restore(oldBackup);
  assert.equal((await db.load()).donors[0].name, 'שמעון לוי');
  db.db.close();
  assert.ok(!containsText(rawBytes(dir), 'שמעון לוי'));
});

test('resolveDbKey: מסד חדש יוצר מפתח; קוד השחזור הקיים פותח את המסד', async () => {
  const dir = tmp('key');
  const file = path.join(dir, 'autobackup.key');
  const ss = fakeSafeStorage();
  const r = await resolveDbKey({ fs, file, safeStorage: ss, hasSealedData: false, verify: () => true, promptRecoveryCode: async () => assert.fail('לא שואלים') });
  assert.equal(r.status, 'encrypted');
  const stored = ss.decryptString(fs.readFileSync(file));
  assert.deepEqual(r.key, AR.deriveDbKey(stored), 'מפתח המסד נגזר ממפתח הגיבוי — קוד שחזור אחד לשניהם');
});

test('resolveDbKey: מפתח אבד (Windows הותקן מחדש) ← קוד השחזור פותח ונשמר מחדש', async () => {
  const original = backupKey();
  const realKey = AR.deriveDbKey(original);
  const code = AutoBk.recoveryCodeFromKey(original);
  const dir = tmp('lost');
  const file = path.join(dir, 'autobackup.key');
  fs.writeFileSync(file, 'not-readable-on-this-account');
  const prompts = [];
  const answers = ['abc', AutoBk.recoveryCodeFromKey(backupKey()), code];
  const r = await resolveDbKey({ fs, file, safeStorage: fakeSafeStorage(), hasSealedData: true,
    verify: (k) => k.equals(realKey),
    promptRecoveryCode: async (p) => { prompts.push(p); return answers.shift(); } });
  assert.equal(r.status, 'encrypted');
  assert.ok(r.key.equals(realKey));
  assert.equal(prompts.length, 3);
  assert.match(prompts[1].message, /קוד השחזור/, 'קוד בצורה שגויה — הודעה בעברית');
  assert.match(prompts[2].message, /אינו של הנתונים/, 'קוד של מחשב אחר — הודעה בעברית');
  // המפתח נשמר בחשבון הזה; הקובץ הישן נשמר בצד ולא נמחק
  assert.equal(fakeSafeStorage().decryptString(fs.readFileSync(file)), original);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('autobackup.key.old-')));
});

test('resolveDbKey: לעולם לא נוצר מפתח חדש בשקט כשיש נתונים מוצפנים', async () => {
  const dir = tmp('nosilent');
  const file = path.join(dir, 'autobackup.key');
  const r = await resolveDbKey({ fs, file, safeStorage: fakeSafeStorage(), hasSealedData: true, verify: () => false,
    promptRecoveryCode: async () => null });
  assert.deepEqual(r, { key: null, status: 'missing' });
  assert.ok(!fs.existsSync(file), 'לא נוצר קובץ מפתח חדש');
});

test('resolveDbKey: אין DPAPI ← גלוי עם סטטוס לאזהרה; מפתח לא קריא בלי נתונים מוצפנים ← לא דורסים אותו', async () => {
  const dir = tmp('nodpapi');
  const file = path.join(dir, 'autobackup.key');
  const r = await resolveDbKey({ fs, file, safeStorage: fakeSafeStorage(false), hasSealedData: false, verify: () => true, promptRecoveryCode: async () => null });
  assert.deepEqual(r, { key: null, status: 'plain-no-dpapi' });
  fs.writeFileSync(file, 'garbage');
  const r2 = await resolveDbKey({ fs, file, safeStorage: fakeSafeStorage(), hasSealedData: false, verify: () => true, promptRecoveryCode: async () => null });
  assert.equal(r2.status, 'plain-key-unreadable');
  assert.equal(fs.readFileSync(file, 'utf8'), 'garbage', 'קובץ המפתח הקיים לא נדרס');
});

test('מסד נעול בלי קוד: מועבר הצידה עם קבצי WAL, לא נמחק', async () => {
  const dir = tmp('aside');
  const db = await initializeDatabase(dir, fixedCipher(backupKey()));
  await seed(db);
  db.db.close();
  const target = setAsideLockedDatabase(dir, 123);
  assert.ok(fs.existsSync(target));
  assert.ok(!fs.existsSync(path.join(dir, 'unified_economics.db')));
  const fresh = await initializeDatabase(dir, fixedCipher(backupKey()));
  assert.deepEqual((await fresh.load()).donors, []);
  fresh.db.close();
});

test('גיבוי לפני ההמרה ב-main.js: מוצפן במפתח הגיבוי ונבדק בפתיחה לפני ההמרה', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const block = src.slice(src.indexOf('beforeEncrypt:'), src.indexOf('function promptRecoveryCode'));
  assert.match(block, /BK\.encryptBackup\(/, 'הגיבוי מוצפן');
  assert.match(block, /BK\.decryptBackup\(/, 'הגיבוי נבדק לפני ההמרה');
  assert.doesNotMatch(block, /writeFileSync\([^)]*JSON\.stringify\(out\)\s*\)/, 'אין כתיבה גלויה');
  // קובץ שנכתב כך נפתח במפתח הגיבוי ובקוד השחזור
  const key = backupKey();
  const enc = BK.encryptBackup('{"suite":"SuperSuite"}', key);
  assert.equal(BK.decryptBackup(enc, AutoBk.keyFromRecoveryCode(AutoBk.recoveryCodeFromKey(key))), '{"suite":"SuperSuite"}');
});

test('חלון קוד השחזור: CSP מחמיר, עברית RTL, preload בלי Node', () => {
  const html = fs.readFileSync(path.join(ROOT, 'shell', 'recovery.html'), 'utf8');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-eval|https?:\/\//);
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const win = main.slice(main.indexOf('function promptRecoveryCode'), main.indexOf('/* גיבוי אוטומטי יומי'));
  assert.match(win, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.match(win, /e\.sender\.id === w\.webContents\.id/, 'רק החלון הזה יכול לשלוח קוד');
});
