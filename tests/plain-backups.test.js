// גיבויים ישנים לא מוצפנים בתיקיית הגיבוי (PLAN.md 3.6): נמצאים, מוצפנים (ורק אז המקור נמחק), ולא נמחקים לבד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PB = require('../shell/plain-backups');
const BK = require('../modules/econ/core/backupCrypto');

const ROOT = path.join(__dirname, '..');
const KEY = 'auto-backup-key-for-tests-0123456789';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-plain-'));
const write = (dir, name, data) => { const t = typeof data === 'string' ? data : JSON.stringify(data); fs.writeFileSync(path.join(dir, name), t); return t; };

const suite = { suite: 'SuperSuite', version: 2, scope: 'all', econ: { version: 4, settings: {} }, localStorage: {} };
const econOld = { version: 4, organization: { name: 'גמ"ח אור' }, settings: {}, records: [] };
const trainerOld = { 'trainer:profile': '{"name":"משה כהן"}', 'clients:index': '[]' };

test('סריקה: גיבויים גלויים נמצאים — SuperSuite, כלכלי ישן; שאר הקבצים לא (גם לא גיבוי ישן של מודול האימונים, שעבר למוצר נפרד)', () => {
  const dir = tmp();
  write(dir, 'auto-2026-01-01.json', suite);
  write(dir, 'גיבוי-מערכת-כלכלית-2026-01-02.json', econOld);
  write(dir, 'trainer-pro-backup-2026-01-03.json', trainerOld);
  write(dir, 'auto-2026-01-04.ssbk', BK.encryptBackup(JSON.stringify(suite), KEY));
  write(dir, 'settings.json', { theme: 'light' });
  write(dir, 'broken.json', '{"suite": "SuperSuite", ');
  write(dir, 'notes.txt', JSON.stringify(suite));
  fs.mkdirSync(path.join(dir, 'sub.json'));
  const names = PB.scan(dir).map(f => f.name);
  assert.deepEqual(names.sort(), ['auto-2026-01-01.json', 'גיבוי-מערכת-כלכלית-2026-01-02.json'].sort());
});

test('סריקה: תיקייה שלא קיימת או ריקה — רשימה ריקה, בלי שגיאה', () => {
  assert.deepEqual(PB.scan(path.join(os.tmpdir(), 'no-such-dir-ss-' + Date.now())), []);
  assert.deepEqual(PB.scan(''), []);
  assert.deepEqual(PB.scan(tmp()), []);
});

test('הצפנה: נוצר .ssbk שנפתח במפתח לתוכן זהה, ורק אז המקור נמחק', () => {
  const dir = tmp();
  const text = write(dir, 'auto-2026-01-01.json', suite);
  const r = PB.encryptFile({ dir, name: 'auto-2026-01-01.json', key: KEY });
  assert.equal(r.file, 'auto-2026-01-01.ssbk');
  assert.ok(!fs.existsSync(path.join(dir, 'auto-2026-01-01.json')));
  const enc = fs.readFileSync(path.join(dir, r.file), 'utf8');
  assert.ok(BK.isEncryptedBackup(enc));
  assert.equal(BK.decryptBackup(enc, KEY), text);
  assert.deepEqual(PB.scan(dir), []);
});

test('הצפנה: קובץ .ssbk קיים באותו שם לא נדרס', () => {
  const dir = tmp();
  write(dir, 'auto-2026-01-01.json', suite);
  write(dir, 'auto-2026-01-01.ssbk', 'OLD');
  const r = PB.encryptFile({ dir, name: 'auto-2026-01-01.json', key: KEY });
  assert.equal(r.file, 'auto-2026-01-01-2.ssbk');
  assert.equal(fs.readFileSync(path.join(dir, 'auto-2026-01-01.ssbk'), 'utf8'), 'OLD');
});

test('הצפנה: כישלון בכתיבה או באימות ← המקור נשאר, ואין שארית', () => {
  const dir = tmp();
  const text = write(dir, 'auto-2026-01-01.json', suite);
  // הכתיבה עוברת דרך writeSync + fsync (בדיקת קוד 23.10.2026) — הכשל מדומה שם
  const failWrite = { ...fs, writeSync: () => { const e = new Error('full'); e.code = 'ENOSPC'; throw e; } };
  assert.throws(() => PB.encryptFile({ dir, name: 'auto-2026-01-01.json', key: KEY, fsx: failWrite }), /המקורי לא נמחק.*ENOSPC/);
  // אימות שנכשל: הקובץ שנכתב אינו מה שנקרא בחזרה
  const badRead = { ...fs, readFileSync: (f, enc) => (String(f).endsWith('.tmp') ? 'SSBK1:garbage' : fs.readFileSync(f, enc)) };
  assert.throws(() => PB.encryptFile({ dir, name: 'auto-2026-01-01.json', key: KEY, fsx: badRead }), /המקורי לא נמחק/);
  assert.equal(fs.readFileSync(path.join(dir, 'auto-2026-01-01.json'), 'utf8'), text);
  assert.deepEqual(fs.readdirSync(dir), ['auto-2026-01-01.json']);
});

test('הצפנה ומחיקה: רק שם קובץ בתיקייה, ורק קובץ שהוא באמת גיבוי גלוי', () => {
  const dir = tmp();
  write(dir, 'settings.json', { theme: 'light' });
  for (const bad of ['../x.json', 'a/b.json', 'C:\\x.json', 'x.txt', '']) {
    assert.throws(() => PB.encryptFile({ dir, name: bad, key: KEY }), /שם קובץ לא תקין/, bad);
    assert.throws(() => PB.deleteFile({ dir, name: bad }), /שם קובץ לא תקין/, bad);
  }
  assert.throws(() => PB.deleteFile({ dir, name: 'settings.json' }), /אינו גיבוי גלוי/);
  assert.throws(() => PB.encryptFile({ dir, name: 'settings.json', key: KEY }), /אינו גיבוי גלוי/);
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
});

test('מחיקה: גיבוי גלוי נמחק; קובץ של מודול האימונים (מוצר נפרד) לא נמחק', () => {
  const dir = tmp();
  write(dir, 'גיבוי-מערכת-כלכלית-2026-01-02.json', econOld);
  assert.deepEqual(PB.deleteFile({ dir, name: 'גיבוי-מערכת-כלכלית-2026-01-02.json' }), { deleted: 'גיבוי-מערכת-כלכלית-2026-01-02.json' });
  assert.deepEqual(fs.readdirSync(dir), []);
  write(dir, 'trainer-pro-backup-2026-01-03.json', trainerOld);
  assert.throws(() => PB.deleteFile({ dir, name: 'trainer-pro-backup-2026-01-03.json' }), /אינו גיבוי גלוי/);
  assert.deepEqual(fs.readdirSync(dir), ['trainer-pro-backup-2026-01-03.json']);
});

test('טקסט האזהרה בעברית, לפי מספר הקבצים', () => {
  assert.equal(PB.warningText([]), '');
  assert.match(PB.warningText([{}]), /קובץ גיבוי אחד לא מוצפן/);
  assert.match(PB.warningText([{}, {}, {}]), /3 קבצי גיבוי לא מוצפנים/);
});

test('main.js: הערוצים דורשים הרשאת גיבוי מהמעטפת; אין מחיקה אוטומטית', () => {
  const src = read('main.js');
  for (const ch of ['shell:plain-backups', 'shell:plain-backup-encrypt', 'shell:plain-backup-delete']) {
    const i = src.indexOf(`ipcMain.handle('${ch}'`);
    assert.ok(i > 0, ch);
    assert.match(src.slice(i, i + 200), /shellGuard\(e, 'data\.backup'\)/, ch);
  }
  // בסבב הגיבוי האוטומטי — רק ספירה
  const auto = src.slice(src.indexOf('async function autoBackup'), src.indexOf('async function backupAll'));
  assert.match(auto, /PlainBk\.scan\(/);
  assert.ok(!/PlainBk\.(deleteFile|encryptFile)/.test(auto));
  // אחרי שחזור מקובץ גלוי — הצעה (לא פעולה אוטומטית)
  const restore = src.slice(src.indexOf('async function restoreAll'));
  assert.match(restore, /if \(!BK\.isEncryptedBackup\(text\)\) await offerPlainFile/);
});

function read(...p) { return fs.readFileSync(path.join(ROOT, ...p), 'utf8'); }
