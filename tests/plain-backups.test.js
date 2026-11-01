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

test('סריקה: גיבויים גלויים נמצאים — SuperSuite, כלכלי ישן ואימונים ישן (נתוני בריאות); שאר הקבצים לא', () => {
  const dir = tmp();
  write(dir, 'auto-2026-01-01.json', suite);
  write(dir, 'גיבוי-מערכת-כלכלית-2026-01-02.json', econOld);
  write(dir, 'trainer-pro-backup-2026-01-03.json', trainerOld);
  write(dir, 'auto-2026-01-04.ssbk', BK.encryptBackup(JSON.stringify(suite), KEY));
  write(dir, 'settings.json', { theme: 'light' });
  write(dir, 'broken.json', '{"suite": "SuperSuite", ');
  write(dir, 'notes.txt', JSON.stringify(suite));
  fs.mkdirSync(path.join(dir, 'sub.json'));
  const found = PB.scan(dir);
  assert.deepEqual(found.map(f => f.name).sort(), ['auto-2026-01-01.json', 'trainer-pro-backup-2026-01-03.json', 'גיבוי-מערכת-כלכלית-2026-01-02.json'].sort());
  // רק גיבוי האימונים מסומן כנתוני בריאות
  assert.deepEqual(found.filter(f => f.trainer).map(f => f.name), ['trainer-pro-backup-2026-01-03.json']);
});

test('גיבוי אימונים ישן: זוהה גם בשם אחר ובכל מפתח של המודול; קובץ JSON אחר שמזכיר אותו — לא', () => {
  const dir = tmp();
  write(dir, 'מתאמנים-שמור.json', { 'client:c1': '{"name":"דוד לוי","weight":82}', 'measurements:c1': '[{"date":"2026-01-01","weight":82}]' });
  write(dir, 'studio.json', { 'studio:plans': '[]' });
  write(dir, 'other.json', { 'trainer:profile': 'לא JSON' });
  write(dir, 'array.json', [{ 'trainer:profile': '{}' }]);
  write(dir, 'random.json', { clients: [], profile: {} });
  assert.deepEqual(PB.scan(dir).map(f => [f.name, f.trainer]).sort(), [['studio.json', true], ['מתאמנים-שמור.json', true]].sort());
});

test('גיבוי מלא גלוי עם נתוני אימונים (localStorage.trainer) — מסומן כנתוני בריאות', () => {
  const dir = tmp();
  write(dir, 'auto-2025-12-01.json', { ...suite, localStorage: { trainer: { 'trainer:profile': '{"name":"משה"}' } } });
  write(dir, 'auto-2025-12-02.json', { ...suite, localStorage: { trainer: {} } });
  assert.deepEqual(PB.scan(dir).map(f => [f.name, f.trainer]), [['auto-2025-12-01.json', true], ['auto-2025-12-02.json', false]]);
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

test('מחיקה: גיבוי גלוי נמחק — גם גיבוי אימונים ישן, רק בבקשה מפורשת', () => {
  const dir = tmp();
  write(dir, 'גיבוי-מערכת-כלכלית-2026-01-02.json', econOld);
  assert.deepEqual(PB.deleteFile({ dir, name: 'גיבוי-מערכת-כלכלית-2026-01-02.json' }), { deleted: 'גיבוי-מערכת-כלכלית-2026-01-02.json' });
  assert.deepEqual(fs.readdirSync(dir), []);
  write(dir, 'trainer-pro-backup-2026-01-03.json', trainerOld);
  assert.deepEqual(PB.deleteFile({ dir, name: 'trainer-pro-backup-2026-01-03.json' }), { deleted: 'trainer-pro-backup-2026-01-03.json' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('הצפנה: גיבוי אימונים ישן — עותק מוצפן זהה, והמקור הגלוי נמחק רק אחרי האימות', () => {
  const dir = tmp();
  const text = write(dir, 'trainer-pro-backup-2026-01-03.json', trainerOld);
  const r = PB.encryptFile({ dir, name: 'trainer-pro-backup-2026-01-03.json', key: KEY });
  assert.equal(r.file, 'trainer-pro-backup-2026-01-03.ssbk');
  assert.equal(BK.decryptBackup(fs.readFileSync(path.join(dir, r.file), 'utf8'), KEY), text);
  assert.deepEqual(fs.readdirSync(dir), ['trainer-pro-backup-2026-01-03.ssbk']);
  assert.ok(!fs.readFileSync(path.join(dir, r.file), 'utf8').includes('משה כהן'), 'אין שם גלוי בקובץ המוצפן');
});

test('טקסט האזהרה בעברית, לפי מספר הקבצים', () => {
  assert.equal(PB.warningText([]), '');
  assert.match(PB.warningText([{}]), /קובץ גיבוי אחד לא מוצפן/);
  assert.match(PB.warningText([{}, {}, {}]), /3 קבצי גיבוי לא מוצפנים/);
  assert.doesNotMatch(PB.warningText([{}, {}]), /בריאות/);
  assert.match(PB.warningText([{}, { trainer: true }]), /2 קבצי גיבוי לא מוצפנים, כולל נתוני בריאות של מתאמנים/);
});

test('ממשק: קובץ אימונים מסומן ברשימה, וההסבר מפנה ל-SuperSuite לימוד לפני הצפנה או מחיקה', () => {
  const js = read('shell/shell.js');
  const html = read('shell/shell.html');
  assert.match(js, /if \(f\.trainer\)/);
  assert.match(js, /\$\('pbTrainer'\)\.hidden = !files\.some\(f => f\.trainer\)/);
  assert.match(html, /<p id="pbTrainer" hidden>[^<]*<b>נתוני אימונים ובריאות<\/b>[^<]*SuperSuite לימוד/);
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
