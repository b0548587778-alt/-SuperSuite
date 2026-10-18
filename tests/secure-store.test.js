// מחסן מוצפן לשמאות ולאימונים (PLAN.md 3.2): הקובץ לא מכיל שמות, העברה חד-פעמית עם גיבוי לפני,
// קובץ שלא נפתח לא נדרס, ורק התצוגה של המודול עצמו ניגשת לנתונים שלו.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createSecureStore } = require('../shell/secure-store');
const AutoBk = require('../shell/auto-backup');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-secure-'));
const newKey = () => crypto.randomBytes(32).toString('base64');
const now = (fn) => { fn(); return 0; }; // כתיבה מיידית בבדיקות
const make = (dir, key, mod = 'trainer', extra = {}) => createSecureStore({ fs, dir, mod, getBackupKey: () => key, schedule: now, ...extra });
const NAME = 'רחל כהן';

test('כתיבה וקריאה: הקובץ מוצפן ואין בו שמות', () => {
  const dir = tmp();
  const key = newKey();
  const s = make(dir, key);
  assert.equal(s.state, 'encrypted');
  assert.ok(s.set('trainees', JSON.stringify([{ name: NAME, note: 'כאב ברך' }])));
  const raw = fs.readFileSync(s.file);
  assert.ok(!raw.includes(Buffer.from(NAME)), 'שם לא מופיע בקובץ');
  assert.ok(!raw.includes(Buffer.from('כאב ברך')), 'מידע רפואי לא מופיע בקובץ');
  const again = make(dir, key);
  assert.equal(JSON.parse(again.snapshot().trainees)[0].name, NAME);
  assert.ok(again.remove('trainees'));
  assert.deepEqual(make(dir, key).snapshot(), {});
});

test('מודולים נפרדים: מפתח וקובץ שונים לכל מודול', () => {
  const dir = tmp();
  const key = newKey();
  const a = make(dir, key, 'trainer');
  const b = make(dir, key, 'shamai');
  a.set('x', '1');
  assert.notEqual(a.file, b.file);
  assert.deepEqual(make(dir, key, 'shamai').snapshot(), {});
  assert.throws(() => make(dir, key, 'econ'), /מודול לא מוכר/);
});

test('העברה: גיבוי לפני, ואם הגיבוי נכשל — אין העברה', () => {
  const dir = tmp();
  const s = make(dir, newKey());
  const old = { shamai_v2_props: JSON.stringify([{ owner: NAME }]) };
  const failed = s.migrate(old, () => { throw new Error('disk full'); });
  assert.deepEqual(failed, { ok: false, reason: 'backup-failed' });
  assert.equal(s.migrated, false);
  assert.deepEqual(s.snapshot(), {});
  let backedUp = null;
  const ok = s.migrate(old, (items) => { backedUp = items; });
  assert.equal(ok.ok, true);
  assert.deepEqual(backedUp, old, 'הגיבוי קיבל בדיוק את הנתונים הישנים');
  assert.deepEqual(s.snapshot(), old);
  assert.equal(s.migrate({ y: '2' }, () => assert.fail('לא מגבים שוב')).already, true, 'העברה פעם אחת בלבד');
});

test('העברה לא דורסת נתונים שכבר במחסן, ומסננת ערכים לא תקינים', () => {
  const dir = tmp();
  const s = make(dir, newKey());
  s.set('a', 'new');
  s.migrate({ a: 'old', b: 'keep', c: 5, ['x'.repeat(300)]: 'long-key' }, () => {});
  assert.deepEqual(s.snapshot(), { a: 'new', b: 'keep' });
});

test('קובץ שלא נפתח במפתח (Windows הותקן מחדש): נעול לקריאה, לא נדרס ולא נוצר מפתח חדש', () => {
  const dir = tmp();
  const s = make(dir, newKey());
  s.set('a', NAME);
  const before = fs.readFileSync(s.file, 'utf8');
  let created = null;
  const errors = [];
  const other = make(dir, newKey(), 'trainer', { getBackupKey: (create) => { created = create; return newKey(); }, onError: (_s, e) => errors.push(e) });
  assert.equal(created, false, 'קובץ קיים — מבקשים מפתח בלי ליצור חדש');
  assert.equal(other.state, 'locked');
  assert.equal(other.set('a', 'x'), false);
  assert.equal(other.clear(), false);
  assert.deepEqual(other.migrate({ a: 'x' }, () => {}), { ok: false, reason: 'locked' });
  assert.equal(fs.readFileSync(s.file, 'utf8'), before, 'הקובץ נשאר כמו שהוא');
  assert.equal(errors.length, 1);
});

test('קוד השחזור פותח את המחסן אחרי שהמפתח שוחזר', () => {
  const dir = tmp();
  const key = newKey();
  make(dir, key).set('a', NAME);
  const restored = AutoBk.keyFromRecoveryCode(AutoBk.recoveryCodeFromKey(key));
  assert.equal(make(dir, restored).snapshot().a, NAME);
});

test('בלי DPAPI (אין מפתח ואין קובץ): מצב plain — המודול ממשיך עם האחסון הרגיל', () => {
  const dir = tmp();
  const s = make(dir, null, 'shamai', { getBackupKey: () => { throw Object.assign(new Error('x'), { code: 'no-encryption' }); } });
  assert.equal(s.state, 'plain');
  assert.equal(s.set('a', 'b'), false);
  assert.ok(!fs.existsSync(s.file));
});

test('גבולות: מפתח או ערך ענקיים נדחים', () => {
  const s = make(tmp(), newKey());
  assert.equal(s.set('k'.repeat(257), 'v'), false);
  assert.equal(s.set('k', 'v'.repeat(5 * 1024 * 1024 + 1)), false);
  assert.equal(s.set('k', 5), false);
});

test('כתיבה נדחית ומאוחדת (debounce), ו-flush כותב מיד', () => {
  const dir = tmp();
  const key = newKey();
  const queued = [];
  const s = make(dir, key, 'trainer', { schedule: (fn) => { queued.push(fn); return 1; } });
  s.set('a', '1'); s.set('b', '2');
  assert.equal(queued.length, 1, 'שינויים רצופים — כתיבה אחת');
  assert.ok(!fs.existsSync(s.file));
  s.flush();
  assert.deepEqual(make(dir, key).snapshot(), { a: '1', b: '2' });
});

test('main.js: כל ערוץ של המחסן בודק שהשולח הוא התצוגה של אותו מודול, והגיבוי שלפני ההעברה מוצפן', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const block = src.slice(src.indexOf('function wireSecureStore'), src.indexOf('/* גיבוי אוטומטי יומי'));
  for (const ch of ['secure-store:load', 'secure-store:migrate', 'secure-store:write']) {
    const i = block.indexOf(`'${ch}'`);
    assert.ok(i > 0, ch);
    assert.match(block.slice(i, i + 200), /fromModuleView\(e, mod\)/, ch + ' בודק את השולח');
  }
  assert.match(block, /BK\.encryptBackup\(/);
  assert.match(block, /BK\.decryptBackup\(/, 'הגיבוי נבדק לפני ההעברה');
  assert.match(src, /e\.sender\.id === views\[mod\]\.webContents\.id/);
  assert.match(src, /for \(const s of Object\.values\(secureStores\)\) s\.flush\(\)/, 'כתיבה אחרונה ביציאה');
});

test('preload: פועל רק בשמאות ובאימונים, במסגרת העליונה, ומוחק את הישן רק אחרי העברה מוצלחת', () => {
  const src = fs.readFileSync(path.join(ROOT, 'shell', 'secure-ls-preload.js'), 'utf8');
  assert.match(src, /\{ 'shamai': 'shamai', 'trainer': 'trainer' \}/);
  assert.match(src, /window === window\.top/);
  assert.match(src, /if \(r && r\.ok\) \{\s*localStorage\.clear\(\)/);
  assert.doesNotMatch(src, /exposeInMainWorld/, 'אין אובייקט חדש בעמוד');
});
