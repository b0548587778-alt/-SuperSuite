// ממצא 2 בדוח הבדיקה (docs/CODE-AUDIT-2026-10-20.md): ייבוא/ייצוא כללי ומסך הגבייה עקפו את הרישיון של התחומים.
// ממצא 5: שחזור ממסך המערכת הכלכלית — קובץ של התוכנה כולה, או קובץ שאינו גיבוי כלכלי, לא מוחק את הנתונים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../shell/licensing/license');
const BK = require('../modules/econ/core/backupCrypto');
const DP = require('../modules/econ/core/dataPorts');
const { fileStorage } = require('../shell/licensing/store');
const { markActivated } = require('./helpers/activation');

const handlers = {};
let saved = [];
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_lp__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_lp__.js'] = { id: '/__electron_stub_lp__.js', filename: '/__electron_stub_lp__.js', loaded: true, exports: {
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: { showSaveDialog: async (o) => { const p = path.join(os.tmpdir(), 'ss-lp-' + Date.now() + '-' + saved.length + '.csv'); saved.push(p); return { canceled: false, filePath: p }; } }
} };
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

const DAY = L.DAY_MS;
const T0 = Date.UTC(2026, 9, 1);
const root = L.generateKeyPair();
const mem = () => { let v = null; return { read: () => v, write: (t) => { v = t; } }; };

async function boot(features) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-lic-ports-'));
  const file = path.join(dir, 'license.json');
  const keys = L.generateKeyPair();
  const lic = L.issueLicense({ privateJwk: root.privateJwk }, {
    name: 'קופת צדקה אהבת חסד', publicKey: keys.publicJwk, slot: 1, features,
    limits: { maxChildren: 0, maxUsers: 5, maxStorageMb: 100, maxDepth: 1 },
    issuedAt: T0, expiresAt: T0 + 365 * DAY, graceDays: 7,
  });
  const secret = mem(); secret.write(JSON.stringify(keys.privateJwk));
  fs.writeFileSync(file, JSON.stringify({ chain: [lic], notices: [] }));
  markActivated(dir, T0 + DAY);
  await ipc.initEcon(dir, { rootKeys: [root.publicJwk], clock: () => T0 + DAY, licenseStorage: fileStorage(fs, file), licenseSecret: secret, relayUrl: '' });
  await handlers['auth:setup'](ev(9), 'menahel_1', 'a-very-long-pass-2026');
  await handlers['auth:login'](ev(9), 'menahel_1', 'a-very-long-pass-2026');
}

// דרישות תשלום מכל התחומים — נכתבות ישירות לאוסף (כאילו נוצרו כשהתחומים היו פתוחים)
async function seedRequests() {
  const data = await ipc.getDb().load();
  const req = (n, kind, amountAg) => ({ id: 'r' + n, number: n, ref: 'P' + String(n).padStart(5, '0'), kind, amountAg, status: 'open',
    payerName: 'משה כהן', description: 'בדיקה', createdAt: '2026-10-01T08:00:00.000Z', target: {} });
  await ipc.getDb().save({ ...data, payments: { settings: {}, requests: [req(1, 'invoice', 11700), req(2, 'donation', 18000), req(3, 'gemach', 50000), req(4, 'other', 2500)] } });
}

test('dataPorts: לכל סוג שנשמר באוסף של תחום ברישיון יש domain, ו-listKinds מסנן לפיו', () => {
  assert.equal(DP.kindDomain('products'), 'acct');
  assert.equal(DP.kindDomain('mortgageClients'), 'madv');
  assert.equal(DP.kindDomain('npoGrants'), 'npo');
  for (const k of ['contacts', 'tasks', 'businessPlans', 'marketIntel', 'personal', 'financeIncomes', 'financeExpenses']) assert.equal(DP.kindDomain(k), null, k);
  assert.equal(DP.kindDomain('constructor'), null);
  assert.throws(() => DP.templateTable('constructor'), /לא נתמך/);
  const ids = DP.listKinds(() => false).map(k => k.id);
  assert.ok(ids.includes('contacts') && !ids.includes('products') && !ids.includes('npoGrants') && !ids.includes('mortgageClients'));
  assert.equal(DP.listKinds().length, Object.keys(DP.KINDS).length, 'בלי מסנן — הכול, כמו קודם');
});

test('רישיון בסיסי בלבד: ייבוא/ייצוא של מחירון, תיקי משכנתא ותמיכות נחסם; מסך הגבייה בלי חשבוניות/תרומות/גמ"ח', async () => {
  await boot(['econ']);
  for (const kind of ['products', 'mortgageClients', 'npoGrants']) {
    await assert.rejects(handlers['ports:export'](ev(9), kind), /אינו כלול ברישיון/, 'ייצוא ' + kind);
    await assert.rejects(handlers['ports:exportTemplate'](ev(9), kind), /אינו כלול ברישיון/, 'תבנית ' + kind);
    await assert.rejects(handlers['ports:import'](ev(9), kind, 'a,b\n1,2'), /אינו כלול ברישיון/, 'ייבוא ' + kind);
  }
  const before = (await ipc.getDb().load()).products.length;
  await assert.rejects(handlers['ports:import'](ev(9), 'products', 'name,kind,cost,markupPct,vatExempt\nספר תהילים,product,20,10,0'), /אינו כלול/);
  assert.equal((await ipc.getDb().load()).products.length, before, 'לא נוסף מוצר');

  // סוג של המערכת הבסיסית — עובד כרגיל
  const r = await handlers['ports:import'](ev(9), 'tasks', 'כותרת,תיאור\nהכנת סדר יום לאסיפה,');
  assert.equal(r.added, 1);
  assert.equal((await handlers['ports:export'](ev(9), 'tasks')).ok, true);
  const kinds = (await handlers['ports:listKinds'](ev(9))).map(k => k.id);
  assert.ok(kinds.includes('tasks') && !kinds.includes('products') && !kinds.includes('npoGrants') && !kinds.includes('mortgageClients'), kinds.join(','));

  await seedRequests();
  const ov = await handlers['collect:getOverview'](ev(9));
  assert.deepEqual(ov.requests.map(x => x.kind), ['other']);
  assert.equal(ov.summary.open, 1);
  assert.equal(ov.summary.openAmount, 25);
  assert.deepEqual(Object.keys(ov.kinds).sort(), ['license', 'other']);
  // דרישה קיימת של תחום סגור — לא נפתחת, לא מבוטלת ולא מסומנת
  await assert.rejects(handlers['collect:getMessage'](ev(9), 'r1'), /אינו כלול ברישיון/);
  await assert.rejects(handlers['collect:cancelRequest'](ev(9), 'r2'), /אינו כלול ברישיון/);
  await assert.rejects(handlers['collect:markPaid'](ev(9), 'r3', {}), /אינו כלול ברישיון/);
  // תצוגה מקדימה של דוח סליקה — בלי התאמה לדרישה של תחום סגור
  const csv = 'תאריך,סכום,שם,אסמכתא\n2026-10-05,117,משה כהן,P00001\n2026-10-05,25,משה כהן,P00004';
  const pv = await handlers['collect:previewImport'](ev(9), csv);
  assert.ok(!pv.match.error, pv.match.error);
  assert.deepEqual(pv.match.matched.map(m => m.ref), ['P00004'], 'דרישה של חשבונית (P00001) לא מותאמת בתצוגה המקדימה');
});

test('רישיון מלא: הכול פתוח, כולל כל הדרישות בגבייה', async () => {
  await boot(['econ', 'econ.accounting', 'econ.npo', 'econ.gemach', 'econ.mortgage-advisor']);
  for (const kind of ['products', 'mortgageClients', 'npoGrants']) assert.equal((await handlers['ports:export'](ev(9), kind)).ok, true, kind);
  assert.equal((await handlers['ports:listKinds'](ev(9))).length, Object.keys(DP.KINDS).length);
  await seedRequests();
  const ov = await handlers['collect:getOverview'](ev(9));
  assert.equal(ov.requests.length, 4);
  assert.equal(ov.summary.open, 4);
  const pv = await handlers['collect:previewImport'](ev(9), 'תאריך,סכום,שם,אסמכתא\n2026-10-05,117,משה כהן,P00001\n2026-10-05,25,משה כהן,P00004');
  assert.deepEqual(pv.match.matched.map(m => m.ref).sort(), ['P00001', 'P00004']);
});

test('בלי רישוי: הכול פתוח כמו קודם', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-unlic-ports-'));
  await ipc.initEcon(dir, {});
  await handlers['auth:setup'](ev(11), 'menahel_1', 'a-very-long-pass-2026');
  assert.equal((await handlers['ports:listKinds'](ev(11))).length, Object.keys(DP.KINDS).length);
  assert.equal((await handlers['ports:export'](ev(11), 'products')).ok, true);
  await seedRequests();
  assert.equal((await handlers['collect:getOverview'](ev(11))).requests.length, 4);
});

test('שחזור ממסך המערכת הכלכלית: קובץ של התוכנה כולה משחזר את החלק הכלכלי, וקובץ אחר לא מוחק דבר', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-econ-restore-'));
  await ipc.initEcon(dir, {});
  await handlers['auth:setup'](ev(12), 'menahel_1', 'a-very-long-pass-2026');
  await handlers['tasks:create'](ev(12), { title: 'הזמנת ספרים לבית המדרש' });
  const econ = await ipc.getDb().backup();
  await handlers['tasks:create'](ev(12), { title: 'תיקון הארון' });
  const tasks = async () => (await ipc.getDb().load()).tasks.map(t => t.title).sort();
  assert.equal((await tasks()).length, 2);

  // גיבוי של התוכנה כולה (מהמסך הראשי) — מוצפן
  const pass = 'sismat-gibui-aruka-2026';
  const full = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'all', createdAt: '2026-10-20T10:00:00.000Z', econ, localStorage: {} }), pass);
  assert.equal(await handlers['data:restoreEncrypted'](ev(12), full, pass), true);
  assert.deepEqual(await tasks(), ['הזמנת ספרים לבית המדרש'], 'שוחזר החלק הכלכלי — לא מסד ריק');

  // גיבוי של מודול אחר (בלי נתונים כלכליים) — נדחה, והנתונים נשארים
  const shamaiOnly = BK.encryptBackup(JSON.stringify({ suite: 'SuperSuite', version: 2, scope: 'shamai', econ: null, localStorage: { shamai: {} } }), pass);
  await assert.rejects(handlers['data:restoreEncrypted'](ev(12), shamaiOnly, pass), /אין נתונים כלכליים/);
  // קובץ JSON שאינו גיבוי כלכלי — נדחה
  await assert.rejects(handlers['data:restore'](ev(12), { hello: 'world' }), /אינו גיבוי של המערכת הכלכלית/);
  await assert.rejects(handlers['data:restore'](ev(12), [1, 2]), /אינו תקין/);
  assert.deepEqual(await tasks(), ['הזמנת ספרים לבית המדרש']);

  // גיבוי כלכלי ישן (JSON גלוי) — עדיין משוחזר
  await handlers['tasks:create'](ev(12), { title: 'תיקון הארון' });
  assert.equal(await handlers['data:restore'](ev(12), econ), true);
  assert.deepEqual(await tasks(), ['הזמנת ספרים לבית המדרש']);
  // גיבוי כלכלי מוצפן מהמסך הכלכלי — כמו קודם
  const econEnc = await handlers['data:backupEncrypted'](ev(12), pass);
  assert.equal(await handlers['data:restoreEncrypted'](ev(12), econEnc, pass), true);
});

test.after(() => { for (const p of saved) fs.rmSync(p, { force: true }); });
