// מטמון האוספים ושמירה חלקית במסד הכלכלי (docs/AUDIT-2026-11-02-PLANS.md ג; סקירת קוד 2.11.2026).
// load() לא מפענח אוסף שהערך המוצפן שלו לא השתנה; save() כותב רק אוספים שהשתנו, בטרנזקציה אחת;
// המטמון מתעדכן רק אחרי COMMIT. אין שינוי בפורמט על הדיסק.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const nodeCrypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { initializeDatabase } = require('../modules/econ/core/database');
const AR = require('../modules/econ/core/atRest');
const { inOneSave } = require('../modules/econ/services/oneSave');

const ROOT = path.join(__dirname, '..');
const KEY = crypto.randomBytes(32).toString('base64');
const cipherOpts = () => ({ resolveCipher: async () => ({ key: AR.deriveDbKey(KEY), status: 'encrypted' }) });
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r4-dbcache-')); dirs.push(d); return d; };
const open = [];
test.after(() => {
  for (const db of open) { try { db.db.close(); } catch {} }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

async function freshDb(dir = tmp()) {
  const db = await initializeDatabase(dir, cipherOpts());
  open.push(db);
  return db;
}

// סופר כתיבות של שורות לטבלת האוספים
function countWrites(db) {
  const counter = { rows: [] };
  const orig = db.run;
  db.run = (sql, params = []) => {
    if (/INTO collections/i.test(sql)) counter.rows.push(params[0]);
    return orig(sql, params);
  };
  counter.restore = () => { db.run = orig; };
  return counter;
}

// סופר פענוחים: עוטף את open של אותו אובייקט cipher (המטמון קשור לזהות שלו)
function countDecrypts(db) {
  const c = { n: 0 };
  const orig = db.cipher.open;
  db.cipher.open = (t) => { c.n++; return orig(t); };
  return c;
}

const donation = (i) => ({ id: 'd' + i, donorName: 'תורם ' + i, amount: 100 + (i % 50), date: '2026-01-01', receipt: { number: i + 1 } });
const invoice = (i) => ({ id: 'i' + i, number: i + 1, customer: 'לקוח ' + i, date: '2026-02-01', items: [{ desc: 'שירות', qty: 1, price: 250 }], totalAg: 29250 });

test('שמירה של אוסף אחד שהשתנה כותבת שורה אחת בלבד', async () => {
  const db = await freshDb();
  const data = await db.load();
  data.invoices.push(invoice(1));
  const w = countWrites(db);
  await db.save(data);
  w.restore();
  assert.deepEqual(w.rows, ['invoices']);
  // שמירה בלי שינוי — אף שורה
  const w2 = countWrites(db);
  await db.save(await db.load());
  w2.restore();
  assert.deepEqual(w2.rows, []);
  assert.equal((await db.load()).invoices.length, 1);
});

test('load מחזיר עותק טרי — שינוי בתוצאה לא משנה את המטמון', async () => {
  const db = await freshDb();
  const a = await db.load();
  a.invoices.push(invoice(9));
  a.settings.injected = true;
  const b = await db.load();
  assert.equal(b.invoices.length, 0);
  assert.equal(b.settings.injected, undefined);
});

test('כתיבה מבחוץ (שחזור במופע אחר על אותו קובץ, או כתיבה ישירה) — load ו-save רואים אותה', async () => {
  const dir = tmp();
  const db = await freshDb(dir);
  const d0 = await db.load();
  d0.invoices.push(invoice(1));
  await db.save(d0);
  await db.load(); // המטמון חם

  const other = await freshDb(dir);
  const ext = await other.load();
  ext.invoices = [invoice(1), invoice(2), invoice(3)];
  ext.npo.donations.push(donation(1));
  await other.restore(ext);

  const seen = await db.load();
  assert.equal(seen.invoices.length, 3);
  assert.equal(seen.npo.donations.length, 1);

  // המופע הראשון שומר נתונים שונים מהמסד, כשהמטמון שלו ישן: חייב לכתוב (לא לדלג לפי מטמון)
  const stale = structuredClone(seen);
  await db.load();
  await other.save({ ...(await other.load()), invoices: [] }); // שינוי מבחוץ אחרי ה-load
  const w = countWrites(db);
  await db.save(stale);
  w.restore();
  assert.ok(w.rows.includes('invoices'), 'השורה שהשתנתה מבחוץ נכתבת מחדש');
  assert.equal((await other.load()).invoices.length, 3);

  // כתיבה ישירה פגומה — לא נבלעת במטמון
  await db.run("UPDATE collections SET payload = '{not json' WHERE collection = 'invoices'");
  await assert.rejects(db.load(), (e) => e.code === 'db-collection-corrupt');
});

test('restore על אותו מופע: הנתונים החדשים נטענים וכל האוספים נכתבים', async () => {
  const db = await freshDb();
  const d = await db.load();
  d.invoices.push(invoice(1));
  await db.save(d);
  await db.load();
  const backup = structuredClone(d);
  backup.invoices = [invoice(1), invoice(5)];
  backup.npo.donations = [donation(1)];
  const w = countWrites(db);
  await db.restore(backup);
  w.restore();
  assert.ok(w.rows.length > 10, 'שחזור לא מסתמך על המטמון');
  const after = await db.load();
  assert.deepEqual(after.invoices.map(i => i.id), ['i1', 'i5']);
  assert.equal(after.npo.donations.length, 1);
});

test('ROLLBACK לא משאיר מטמון מלוכלך', async () => {
  const db = await freshDb();
  const base = await db.load();
  const changed = structuredClone(base);
  changed.invoices.push(invoice(1));
  changed.npo.donations.push(donation(1));

  // כשל באמצע הטרנזקציה, אחרי שהחשבוניות כבר נכתבו
  const orig = db.run;
  let n = 0;
  db.run = (sql, params = []) => {
    if (/INTO collections/i.test(sql) && ++n === 2) return Promise.reject(new Error('כשל מדומה'));
    return orig(sql, params);
  };
  await assert.rejects(db.save(changed), /כשל מדומה/);
  db.run = orig;

  const now = await db.load();
  assert.equal(now.invoices.length, 0, 'השינוי בוטל');
  assert.equal(now.npo.donations.length, 0);

  // שמירה חוזרת של אותם נתונים — חייבת לכתוב את שני האוספים (המטמון לא "זוכר" כתיבה שבוטלה)
  const w = countWrites(db);
  await db.save(changed);
  w.restore();
  assert.deepEqual([...w.rows].sort(), ['invoices', 'npo']);
  const final = await db.load();
  assert.equal(final.invoices.length, 1);
  assert.equal(final.npo.donations.length, 1);
});

test('ההצפנה במנוחה נשמרת: אין טקסט גלוי בקובץ המסד אחרי שמירות חלקיות', async () => {
  const dir = tmp();
  const db = await freshDb(dir);
  const d = await db.load();
  d.invoices.push({ ...invoice(1), customer: 'סימן-גלוי-ייחודי-4471' });
  await db.save(d);
  const d2 = await db.load();
  d2.npo.donations.push({ ...donation(1), donorName: 'תורם-גלוי-ייחודי-8812' });
  await db.save(d2);
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const raw = new DatabaseSync(path.join(dir, 'unified_economics.db'));
  const rows = raw.prepare('SELECT collection, payload FROM collections').all();
  raw.close();
  assert.ok(rows.length > 10);
  for (const r of rows) assert.ok(r.payload.startsWith('SSDB1:'), `${r.collection} מוצפן`);
  const bytes = Buffer.concat(['unified_economics.db', 'unified_economics.db-wal']
    .map(f => path.join(dir, f)).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f)));
  for (const s of ['סימן-גלוי-ייחודי-4471', 'תורם-גלוי-ייחודי-8812']) {
    assert.equal(bytes.includes(Buffer.from(s, 'utf8')), false, s);
  }
});

test('החלפת מפתח מבטלת את המטמון', async () => {
  const db = await freshDb();
  await db.load();
  const before = db.cipher;
  db.cipher = AR.createCipher(crypto.randomBytes(32)); // מפתח אחר
  await assert.rejects(db.load(), (e) => String(e.code).startsWith('db-key'));
  db.cipher = before;
  assert.ok(await db.load());
});

test('10,000 תרומות ו-3,000 חשבוניות: פענוח והצפנה רק של מה שהשתנה', async () => {
  const db = await freshDb();
  const d = await db.load();
  for (let i = 0; i < 10000; i++) d.npo.donations.push(donation(i));
  for (let i = 0; i < 3000; i++) d.invoices.push(invoice(i));
  await db.save(d);

  const dec = countDecrypts(db);
  const encBefore = db.stats.encrypts;
  // עשר פעולות "הפקת חשבונית": load ← שינוי ← save
  for (let k = 0; k < 10; k++) {
    const cur = await db.load();
    cur.invoices.push(invoice(3000 + k));
    await db.save(cur);
  }
  const final = await db.load();
  assert.equal(final.invoices.length, 3010);
  assert.equal(final.npo.donations.length, 10000);
  // בלי מטמון: 11 טעינות × כל האוספים (~45) = מאות פענוחים, ו-10 שמירות × כל האוספים הצפנות
  assert.equal(dec.n, 0, 'אין פענוח כשהמסד לא השתנה מבחוץ');
  assert.equal(db.stats.encrypts - encBefore, 10, 'הצפנה אחת לכל שמירה — רק החשבוניות');
});

test('inOneSave: פעולה שחוצה שירותים — שמירה אחת שכותבת רק את האוספים שהשתנו', async () => {
  const db = await freshDb();
  await db.load();
  const a = { db, async run() { const x = await this.db.load(); x.invoices.push(invoice(1)); await this.db.save(x); } };
  const b = { db, async run() { const x = await this.db.load(); x.npo.donations.push(donation(1)); await this.db.save(x); } };
  const w = countWrites(db);
  await inOneSave([a, b], async () => { await a.run(); await b.run(); });
  w.restore();
  assert.deepEqual([...w.rows].sort(), ['invoices', 'npo']);
  const d = await db.load();
  assert.equal(d.invoices.length, 1);
  assert.equal(d.npo.donations.length, 1);
  // כשל ב-fn ← שום דבר לא נכתב
  const w2 = countWrites(db);
  await assert.rejects(inOneSave([a], async () => { await a.run(); throw new Error('עצירה'); }), /עצירה/);
  w2.restore();
  assert.deepEqual(w2.rows, []);
  assert.equal((await db.load()).invoices.length, 1);
});

test('אנדרואיד: אותו מסד מעל התחליפים והגשר — בלי UPSERT (SQLite 3.22 ב-minSdk 28), שמירה חלקית עובדת', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/core/database.js'), 'utf8');
  assert.equal(/ON\s+CONFLICT/i.test(src), false, 'אין ON CONFLICT — לא נתמך ב-SQLite של אנדרואיד 9');

  const { bundle } = require('../android/lib/bundle');
  const { createNodeShims } = require('../android/web/node-shims');
  let sdb = null;
  const runs = [];
  const ok = r => JSON.stringify({ r });
  const wrap = fn => (...a) => { try { return ok(fn(...a)); } catch (e) { return JSON.stringify({ e: e.message }); } };
  const decode = json => JSON.parse(json).map(p => (p.t === 'n' ? null : p.t === 'i' ? Number(p.v) : p.t === 'f' ? p.v : p.v));
  const bridge = {
    randomBytes: wrap(n => nodeCrypto.randomBytes(n).toString('base64')),
    dbOpen: wrap(() => { sdb = new DatabaseSync(':memory:'); return true; }),
    dbExec: wrap(sql => { sdb.exec(sql); return true; }),
    dbRun: wrap((sql, params) => { runs.push(sql); sdb.prepare(sql).run(...decode(params)); return true; }),
    dbAll: wrap((sql, params) => sdb.prepare(sql).all(...decode(params)).map(r => ({ ...r })))
  };
  const shims = createNodeShims(bridge);
  const { code } = bundle({ database: path.join(ROOT, 'modules/econ/core/database.js') }, { root: ROOT, globalName: '__ssR4Db' });
  new Function(code)();
  const host = globalThis.__ssR4Db;
  delete globalThis.__ssR4Db;
  const D = host.require('database', { fs: shims.fs, path: shims.path, crypto: shims.crypto, 'node:sqlite': shims['node:sqlite'] });
  const db = await D.initializeDatabase('/data');
  const d = await db.load();
  d.invoices.push(invoice(1));
  runs.length = 0;
  await db.save(d);
  assert.equal(runs.filter(s => /INTO collections/i.test(s)).length, 1);
  const again = await db.load();
  assert.equal(again.invoices.length, 1);
  again.npo.donations.push(donation(1));
  await db.restore(again);
  const r = await db.load();
  assert.equal(r.npo.donations.length, 1);
  assert.equal(r.invoices.length, 1);
});
