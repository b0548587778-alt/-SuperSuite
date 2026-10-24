'use strict';
// רגרסיה לבדיקת הקוד 23.10.2026 — הרשאות, פרטיות ונתונים במודול הכלכלי:
// ממצא 6 (financial:exportCSV), 21 (גיבוי וקוד שחזור — מנהל בלבד), 22 (ייצוא תיקי משכנתא ו-ownOnly),
// 23 (ערוצי הגדרות), 25 (התוכנית הפיננסית וההוצאות האישיות — מנהל בלבד) והממצאים הנמוכים של אותו תחום
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-perm-'));
test.after(() => {
  // ב-Windows קובץ מסד פתוח נעול — סוגרים את המסד של ה-IPC לפני המחיקה
  try { ipc.getDb().db.close(); } catch { /* כבר סגור */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Electron מדומה: לוכדים את הערוצים, וחלון השמירה מחזיר קובץ בתיקייה הזמנית (כדי לקרוא מה נכתב בפועל)
const handlers = {};
let saveSeq = 0;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_audit_perm__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_audit_perm__.js'] = { id: '/__electron_stub_audit_perm__.js', filename: '/__electron_stub_audit_perm__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmp, `save-${++saveSeq}.csv`) }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    }
  } };

const ipc = require('../modules/econ/ipc');
const { AuthService: auth } = require('../modules/econ/services/authService');
const { initializeDatabase } = require('../modules/econ/core/database');
const DP = require('../modules/econ/core/dataPorts');
const AR = require('../modules/econ/core/atRest');
const { editable } = require('../modules/econ/core/editable');
const ev = (id) => ({ sender: { id } });
const denied = /אין הרשאה/;
const PASS = { admin: 'menahel-strong-pass-1', a: 'yoetz-a-strong-pass', b: 'yoetz-b-strong-pass', v: 'tsofe-strong-pass-1', r: 'roeh-cheshbon-pass-1' };
// כל ההרשאות חוץ מ-users.manage — כמו עורך ותיק שקיבל גם מחיקה ושחזור
const ALL_BUT_ADMIN = ['data.view', 'data.create', 'data.edit', 'data.delete', 'data.export', 'data.backup', 'data.restore'];

let users = null;
async function boot() {
  if (users) return users;
  // בלי רשת: אף בדיקה כאן לא פונה לשרת הרישוי
  await ipc.initEcon(fs.mkdtempSync(path.join(tmp, 'econ-')), { relayUrl: '', fetchImpl: async () => { throw new Error('אין רשת בבדיקות'); } });
  await handlers['auth:setup'](ev(1), 'menahel', PASS.admin);
  await handlers['auth:login'](ev(1), 'menahel', PASS.admin);
  const ua = await handlers['users:create'](ev(1), { username: 'yoetz_a', password: PASS.a, role: 'editor' });
  const ub = await handlers['users:create'](ev(1), { username: 'yoetz_b', password: PASS.b, role: 'editor' });
  await handlers['users:create'](ev(1), { username: 'tsofe_1', password: PASS.v, role: 'viewer' });
  await handlers['users:create'](ev(1), { username: 'roeh_1', password: PASS.r, role: 'accountant' });
  await handlers['auth:login'](ev(2), 'yoetz_a', PASS.a);
  await handlers['auth:login'](ev(3), 'yoetz_b', PASS.b);
  await handlers['auth:login'](ev(4), 'tsofe_1', PASS.v);
  await handlers['auth:login'](ev(5), 'roeh_1', PASS.r);
  users = { ua, ub };
  return users;
}
const readCsv = (r) => fs.readFileSync(r.path, 'utf8');

// ---------- ממצא נמוך: כללי "מנהל בלבד" ב-permissionFor ----------

test('permissionFor: ערוצי בעלים, יומן ביקורת, הגדרות מתקדמות ועדכוני גרסה — מנהל בלבד', () => {
  const { permissionFor } = ipc;
  // בלי הכללים המפורשים, השם היה נופל ל-data.view (get/list), data.export, data.backup או data.edit
  for (const ch of ['owner:getState', 'owner:inbox', 'owner:releases', 'owner:exportBackup', 'owner:importBackup', 'owner:recoveryCodes',
    'audit:list', 'audit:export', 'settings:saveAdvanced', 'update:download', 'update:fromFile', 'update:install', 'users:list', 'users:create']) {
    assert.equal(permissionFor(ch), 'users.manage', ch);
  }
  assert.equal(permissionFor('update:getStatus'), 'data.view', 'כל משתמש רואה שיש עדכון');
});

test('IPC: כל ערוץ owner/audit/users/update והגדרות מתקדמות נדחה למי שיש לו כל ההרשאות חוץ מ-users.manage', async () => {
  await boot();
  const channels = Object.keys(handlers).filter(ch => /^(owner|audit|users):/.test(ch) || ch === 'settings:saveAdvanced'
    || (ch.startsWith('update:') && ch !== 'update:getStatus'));
  for (const prefix of ['owner:', 'audit:', 'users:', 'update:']) assert.ok(channels.some(ch => ch.startsWith(prefix)), prefix);
  auth.setSession(90, { id: 'almost-admin', username: 'almost', permissions: ALL_BUT_ADMIN });
  for (const ch of channels) {
    assert.equal(ipc.permissionFor(ch), 'users.manage', ch);
    await assert.rejects(handlers[ch](ev(90), {}), denied, ch);
  }
  auth.sessions.delete(90);
});

// ---------- ממצא 6: financial:exportCSV ----------

test('ממצא 6: אין ערוץ שכותב קובץ לנתיב שהמסך בוחר, ואין ערוצים חשופים בלי מסך', async () => {
  await boot();
  for (const ch of ['financial:exportCSV', 'auth:change-password', 'personalFinance:calculateLoan', 'mortgage:calculateLoan', 'acct:setVatRate']) {
    assert.equal(handlers[ch], undefined, ch);
  }
  assert.equal(typeof require('../modules/econ/core/financial').exportToCSV, 'undefined');
  assert.equal(typeof require('../modules/econ/services/financialService').FinancialService.exportToCSV, 'undefined');
  // ה-preload: אין פונקציות לערוצים שהוסרו
  const exposed = {};
  const calls = [];
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } }, ipcRenderer: { invoke: (...a) => { calls.push(a); return Promise.resolve(); }, on() {} } };
    return origLoad.call(this, req, ...rest);
  };
  const preloadPath = require.resolve('../modules/econ/preload.js');
  try { delete require.cache[preloadPath]; require(preloadPath); } finally { Module._load = origLoad; delete require.cache[preloadPath]; }
  for (const fn of ['exportToCSV', 'changePassword', 'calculateLoan', 'calculateMortgageLoan', 'setVatRate']) {
    assert.equal(fn in exposed.systemAPI, false, fn);
  }
  // כל ערוץ שה-preload קורא לו רשום בתהליך הראשי (ערוץ שהוסר מ-ipc.js לא נשאר חשוף)
  const src = fs.readFileSync(preloadPath, 'utf8');
  for (const [, ch] of src.matchAll(/invoke\('([a-z]+:[A-Za-z:-]+)'/g)) {
    if (ch.startsWith('shell:')) continue;
    assert.ok(handlers[ch], `ערוץ חשוף בלי מימוש: ${ch}`);
  }
});

// ---------- ממצא 21: גיבוי, שחזור וקוד השחזור — מנהל בלבד ----------

test('ממצא 21: עורך לא מגבה ולא משחזר; מנהל — כן', async () => {
  await boot();
  assert.equal(auth.getSession(2).permissions.includes('data.backup'), false, 'לעורך אין הרשאת גיבוי (מיגרציה 10)');
  assert.equal(auth.getSession(1).permissions.includes('data.backup'), true);
  for (const sender of [2, 4, 5]) {
    await assert.rejects(handlers['data:backupEncrypted'](ev(sender), 'backup-pass-123456'), denied, `גיבוי (${sender})`);
    await assert.rejects(handlers['data:restoreEncrypted'](ev(sender), 'SSBK1:x', 'backup-pass-123456'), denied, `שחזור (${sender})`);
    await assert.rejects(handlers['data:restore'](ev(sender), {}), denied, `שחזור ישן (${sender})`);
    // המעטפת (גיבוי/שחזור כולל, גיבויים גלויים) בודקת את אותן הרשאות דרך assertAccess
    assert.throws(() => ipc.assertAccess(sender, 'data.backup'), denied);
    assert.throws(() => ipc.assertAccess(sender, 'data.restore'), denied);
    assert.throws(() => ipc.assertAccess(sender, 'users.manage'), denied, 'קוד השחזור ויעד הגיבוי');
  }
  const enc = await handlers['data:backupEncrypted'](ev(1), 'backup-pass-123456');
  assert.match(enc, /^SSBK1:/);
  // ההרשאה לפי סוג הפעולה נשארת data.backup — כך הגיבוי מותר גם במצב "קריאה בלבד" של הרישיון
  assert.equal(ipc.permissionFor('data:backupEncrypted'), 'data.backup');
});

test('ממצא 21: במסד — רק לתפקיד מנהל יש הרשאות גיבוי ושחזור', async () => {
  await boot();
  const rows = await ipc.getDb().all("SELECT rp.role_id AS role FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.name IN ('data.backup', 'data.restore')");
  assert.deepEqual([...new Set(rows.map(r => r.role))], ['admin']);
});

test('ממצא 21: מסד ישן שבו לעורך הייתה הרשאת גיבוי — ההרשאה מוסרת בעלייה, ושאר ההרשאות נשארות', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'old-roles-'));
  const db = await initializeDatabase(dir);
  await db.setupAdmin('menahel', PASS.admin);
  await db.createUser('orech_1', PASS.a, 'editor');
  // מצב לפני מיגרציה 10 (גרסה קודמת)
  await db.run("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT 'editor', id FROM permissions WHERE name = 'data.backup'");
  await db.run('DELETE FROM schema_migrations WHERE version = 10');
  assert.ok((await db.authenticate('orech_1', PASS.a)).permissions.includes('data.backup'));
  db.db.close();
  const reopened = await initializeDatabase(dir);
  const editor = await reopened.authenticate('orech_1', PASS.a);
  assert.equal(editor.permissions.includes('data.backup'), false);
  assert.deepEqual(editor.permissions.slice().sort(), ['data.create', 'data.edit', 'data.export', 'data.view']);
  assert.ok((await reopened.authenticate('menahel', PASS.admin)).permissions.includes('data.backup'), 'למנהל — נשאר');
  reopened.db.close();
});

test('ממצא 21: קוד השחזור ויעד הגיבוי במעטפת — מנהל בלבד, ובלי העתקה ללוח', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const body = (ch) => { const i = MAIN.indexOf(`ipcMain.handle('${ch}'`); assert.ok(i >= 0, ch); return MAIN.slice(i, i + 300); };
  for (const ch of ['shell:get-recovery-code', 'shell:recovery-code-saved', 'shell:pick-backup-target']) {
    assert.match(body(ch), /shellGuard\(e, 'users\.manage'\)/, ch);
  }
  const shellJs = fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.js'), 'utf8');
  const fn = shellJs.slice(shellJs.indexOf('async function showRecoveryCode'), shellJs.indexOf('$(\'rk\').onclick'));
  assert.doesNotMatch(fn, /clipboard/, 'הקוד לא מועתק ללוח (היסטוריית הלוח של Windows וסנכרון לענן)');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'shell', 'shell.html'), 'utf8'), /id="rkCopy"/);
});

// ---------- ממצא 22: ייצוא תיקי משכנתא ו-ownOnly ----------

test('ממצא 22: יועץ מייצא רק את התיקים שהוא רואה במסך; מנהל — את כולם', async () => {
  await boot();
  await handlers['madv:createClient'](ev(2), { name: 'משפחת כץ', requestedAmount: 800000 });
  await handlers['madv:createClient'](ev(3), { name: 'משפחת שפירא', requestedAmount: 600000 });
  const csvA = readCsv(await handlers['ports:export'](ev(2), 'mortgageClients'));
  assert.match(csvA, /משפחת כץ/);
  assert.doesNotMatch(csvA, /משפחת שפירא/, 'התיק של יועץ ב לא יוצא בייצוא של יועץ א');
  const csvM = readCsv(await handlers['ports:export'](ev(1), 'mortgageClients'));
  assert.match(csvM, /משפחת כץ/);
  assert.match(csvM, /משפחת שפירא/);
  // הייבוא לא מוחק תיקים שהיועץ לא רואה (applyImport עובד על כל הרשימה)
  await handlers['ports:import'](ev(2), 'mortgageClients', 'שם,סכום מבוקש\nמשפחת לוי,500000\n');
  const all = (await ipc.getDb().load()).mortgageAdvisor.clients.map(c => c.name).sort();
  assert.deepEqual(all, ['משפחת כץ', 'משפחת לוי', 'משפחת שפירא'].sort());
});

test('ממצא 22: exportTable מסנן לפי actor רק כש-ownOnly פעיל', () => {
  const data = { mortgageAdvisor: { settings: {}, clients: [
    { id: '1', name: 'א', advisorId: 'A', requestedAmountAg: 100, docs: [] },
    { id: '2', name: 'ב', advisorId: 'B', requestedAmountAg: 100, docs: [] },
    { id: '3', name: 'ג', advisorId: '', requestedAmountAg: 100, docs: [] }] } };
  const names = (opts, d = data) => DP.exportTable('mortgageClients', d, opts).rows.map(r => r[0]);
  assert.deepEqual(names({ actor: { id: 'A' } }), ['א', 'ג']);
  assert.deepEqual(names({ actor: { id: 'A', isManager: true } }), ['א', 'ב', 'ג']);
  assert.deepEqual(names({}), ['א', 'ב', 'ג'], 'בלי actor (קריאה פנימית) — הכול');
  const open = { mortgageAdvisor: { ...data.mortgageAdvisor, settings: { ownOnly: false } } };
  assert.deepEqual(names({ actor: { id: 'A' } }, open), ['א', 'ב', 'ג']);
});

// ---------- ממצא 23: ערוצי הגדרות ----------

test('ממצא 23: הגדרות עמותה, גמ"ח, מס"ב ולוגו — מנהל בלבד', async () => {
  await boot();
  for (const ch of ['npo:saveSettings', 'gemach:saveSettings', 'npo:saveMasavSettings', 'gemach:saveMasavSettings', 'acct:setLogo']) {
    assert.equal(ipc.permissionFor(ch), 'users.manage', ch);
    await assert.rejects(handlers[ch](ev(2), {}), denied, ch);
  }
  const s = await handlers['npo:saveSettings'](ev(1), { orgName: 'עמותת חסדי אבות' });
  assert.equal(s.orgName, 'עמותת חסדי אבות');
  assert.equal((await handlers['gemach:saveSettings'](ev(1), { fundName: 'גמ"ח יד אהרן' })).fundName, 'גמ"ח יד אהרן');
  assert.deepEqual(await handlers['acct:setLogo'](ev(1)), { canceled: true }, 'מנהל עובר את ההרשאה (החלון המדומה בוטל)');
});

test('ממצא 23: תחזית "מאומתת" — מנהל בלבד; תחזית רגילה — גם עורך', async () => {
  await boot();
  const input = { source: 'תחזית לבדיקה', publishedAt: '2026-10-01', boiPct: '3', inflationAnnualPct: '0', anchorKey: 'GOV_BOND_5Y', anchorPct: '3' };
  await assert.rejects(handlers['mlab:saveForecast'](ev(2), { ...input, verified: true }), /רק מנהל/);
  assert.equal((await ipc.getDb().load()).mortgageLab.forecast, null, 'לא נשמר דבר');
  assert.equal((await handlers['mlab:saveForecast'](ev(2), input)).ok, true);
  assert.equal((await ipc.getDb().load()).mortgageLab.forecast.needsVerification, true);
  await handlers['mlab:saveForecast'](ev(1), { ...input, verified: true });
  assert.equal((await ipc.getDb().load()).mortgageLab.forecast.needsVerification, false);
  await handlers['mlab:resetForecast'](ev(1));
});

// ---------- ממצא 25: התוכנית הפיננסית וההוצאות האישיות ----------

test('ממצא 25: עורך, צופה ורואה חשבון לא רואים ולא משנים נתונים אישיים; מנהל — כן', async () => {
  await boot();
  const channels = [['personalFinance:get'], ['personalFinance:update', { planName: 'x' }], ['personalFinance:addItem', 'incomes', { source: 'משכורת', amount: 1 }],
    ['personalFinance:updateItem', 'incomes', 'x', {}], ['personalFinance:deleteItem', 'incomes', 'x'],
    ['personalFinance:addIncome', { source: 'משכורת', amount: 1 }], ['personal:getEntries', {}], ['personal:getSummary', {}],
    ['personal:addEntry', { date: '2026-03-02', kind: 'expense', amount: 250, category: 'חשמל' }], ['personal:deleteEntry', 'x']];
  for (const sender of [2, 4, 5]) {
    for (const [ch, ...args] of channels) await assert.rejects(handlers[ch](ev(sender), ...args), denied, `${ch} (${sender})`);
    await assert.rejects(handlers['acct:exportCsv'](ev(sender), 'personal', {}), denied);
    await assert.rejects(handlers['ports:export'](ev(sender), 'personal'), denied);
    await assert.rejects(handlers['ports:export'](ev(sender), 'financeIncomes'), denied);
    await assert.rejects(handlers['ports:exportTemplate'](ev(sender), 'financeExpenses'), denied);
    const kinds = (await handlers['ports:listKinds'](ev(sender))).map(k => k.id);
    for (const k of ['personal', 'financeIncomes', 'financeExpenses']) assert.equal(kinds.includes(k), false, k);
    assert.ok(kinds.includes('contacts'));
  }
  await assert.rejects(handlers['ports:import'](ev(2), 'personal', 'תאריך,סוג,קטגוריה,סכום\n2026-03-02,הוצאה,חשמל,250\n'), denied);
  // ייצוא שאינו אישי — עובר את ההרשאה
  assert.equal((await handlers['acct:exportCsv'](ev(2), 'journal', {})).ok, true);

  // מנהל
  const it = await handlers['personalFinance:addItem'](ev(1), 'incomes', { source: 'משכורת', amount: 12000 });
  assert.equal((await handlers['personalFinance:get'](ev(1))).incomes.length, 1);
  await handlers['personal:addEntry'](ev(1), { date: '2026-03-02', kind: 'expense', amount: 250, category: 'חשמל' });
  assert.equal((await handlers['personal:getSummary'](ev(1), {})).expense, 250);
  assert.match(readCsv(await handlers['ports:export'](ev(1), 'financeIncomes')), /משכורת/);
  assert.ok((await handlers['ports:listKinds'](ev(1))).some(k => k.id === 'personal'));
  // הרשאת הסוג נשארת צפייה/עריכה — כך מנהל רואה את הנתונים גם במצב "קריאה בלבד" של הרישיון
  assert.equal(ipc.permissionFor('personal:getEntries'), 'data.view');
  assert.equal(ipc.requiresAdmin('personal:getEntries'), true);
  assert.equal(ipc.requiresAdmin('personalFinance:get'), true);
  await handlers['personalFinance:deleteItem'](ev(1), 'incomes', it.id);
});

// סוקר: מסך פתיחה אישי שהמנהל קבע הנחית כל עורך על "אין הרשאה"; ובהגדרות — הכמות של הנתונים האישיים
test('ממצא 25 (סוקר): הגדרות מתקדמות למי שאינו מנהל — מסך פתיחה אישי חוזר ללוח הבקרה, ובלי סוגי הנתונים האישיים', async () => {
  await boot();
  const adv = await handlers['settings:getAdvanced'](ev(1));
  await handlers['settings:saveAdvanced'](ev(1), { idleMinutes: adv.idleMinutes, startView: 'personal-finance' });
  try {
    const admin = await handlers['settings:getAdvanced'](ev(1));
    assert.equal(admin.startView, 'personal-finance');
    assert.ok(admin.kinds.some(k => k.id === 'personal'));
    assert.ok('financeIncomes' in admin.counts);
    for (const sender of [2, 4, 5]) {
      const st = await handlers['settings:getAdvanced'](ev(sender));
      assert.equal(st.isAdmin, false);
      assert.equal(st.startView, 'dashboard', `${sender}: מסך הפתיחה`);
      for (const k of ['personal', 'financeIncomes', 'financeExpenses']) {
        assert.equal(st.kinds.some(x => x.id === k), false, k);
        assert.equal(k in st.counts, false, `${k}: בלי כמות`);
      }
      assert.ok(st.kinds.some(x => x.id === 'contacts'));
    }
    // מסך פתיחה רגיל — אותו מסך לכולם
    await handlers['settings:saveAdvanced'](ev(1), { idleMinutes: adv.idleMinutes, startView: 'tasks' });
    assert.equal((await handlers['settings:getAdvanced'](ev(2))).startView, 'tasks');
  } finally {
    await handlers['settings:saveAdvanced'](ev(1), { idleMinutes: adv.idleMinutes, startView: adv.startView });
  }
});

test('ממצא נמוך: personalFinance:update משנה רק שם ומטבע — לא מחליף את רשימות הפריטים', async () => {
  await boot();
  const a = await handlers['personalFinance:addItem'](ev(1), 'expenses', { category: 'שכר דירה', amount: 4000 });
  const r = await handlers['personalFinance:update'](ev(1), { planName: 'תוכנית משפחת כהן', currency: 'USD', expenses: [], incomes: [{ id: 'zz', source: 'מזויף', amount: -5 }] });
  assert.equal(r.planName, 'תוכנית משפחת כהן');
  assert.equal(r.currency, 'USD');
  const plan = await handlers['personalFinance:get'](ev(1));
  assert.deepEqual(plan.expenses.map(x => x.id), [a.id], 'ההוצאה לא נמחקה');
  assert.equal(plan.incomes.some(x => x.id === 'zz'), false, 'לא נוסף פריט בלי ולידציה');
  await assert.rejects(handlers['personalFinance:update'](ev(1), { planName: 'x', currency: 'BTC' }), /מטבע/);
  await assert.rejects(handlers['personalFinance:update'](ev(1), { planName: 'א'.repeat(201) }), /ארוך מדי/);
  await handlers['personalFinance:deleteItem'](ev(1), 'expenses', a.id);
});

// ---------- ממצא נמוך: update* בשירותים הישנים דורס מזהה ומועד יצירה ----------

test('ממצא נמוך: editable מסנן מזהה, מועדים ומפתחות מיוחדים', () => {
  const parsed = JSON.parse('{"__proto__": {"polluted": 1}, "id": "x", "createdAt": "1999", "updatedAt": "1999", "name": "א"}');
  const out = editable(parsed);
  assert.deepEqual(Object.keys(out), ['name']);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(editable(null), {});
  assert.deepEqual(editable([1, 2]), {});
});

test('ממצא נמוך: עדכון בשירותים הישנים לא משנה מזהה או מועד יצירה (שבעה שירותים)', async () => {
  await boot();
  const db = ipc.getDb();
  const data = await db.load();
  const rec = (id, extra) => ({ id, createdAt: '2026-01-01T00:00:00.000Z', ...extra });
  data.contacts = [rec('c1', { name: 'אברהם' }), rec('c2', { name: 'יצחק' })];
  data.tasks = [rec('t1', { title: 'הכנת דוח', status: 'todo' }), rec('t2', { title: 'תשלום חשבון', status: 'todo' })];
  data.canvasBoards = { userId: '', boards: [rec('b1', { name: 'לוח א' }), rec('b2', { name: 'לוח ב' })] };
  data.voiceNotes = { userId: '', notes: [rec('n1', { title: 'הקלטה א' }), rec('n2', { title: 'הקלטה ב' })] };
  data.businessPlans = [rec('p1', { name: 'תוכנית א' }), rec('p2', { name: 'תוכנית ב' })];
  data.mortgageScenarios = { userId: '', scenarios: [rec('s1', { name: 'תרחיש א' }), rec('s2', { name: 'תרחיש ב' })] };
  data.marketIntel = { userId: '', entries: [rec('m1', { title: 'ידיעה א', date: '2026-01-01' }), rec('m2', { title: 'ידיעה ב', date: '2026-01-01' })] };
  await db.save(data);
  const evil = (field, value) => ({ id: 'X2', createdAt: '1999-01-01', [field]: value });
  await handlers['contacts:update'](ev(1), 'c1', evil('name', 'אברהם כהן'));
  await handlers['tasks:update'](ev(1), 't1', evil('title', 'הכנת דוח שנתי'));
  await handlers['canvas:updateBoard'](ev(1), 'b1', evil('name', 'לוח מעודכן'));
  await handlers['voiceNotes:update'](ev(1), 'n1', evil('title', 'הקלטה מעודכנת'));
  await handlers['business:updatePlan'](ev(1), 'p1', evil('name', 'תוכנית מעודכנת'));
  await handlers['mortgage:updateScenario'](ev(1), 's1', evil('name', 'תרחיש מעודכן'));
  await handlers['marketIntel:updateEntry'](ev(1), 'm1', evil('title', 'ידיעה מעודכנת'));
  const after = await db.load();
  const lists = { contacts: after.contacts, tasks: after.tasks, boards: after.canvasBoards.boards, notes: after.voiceNotes.notes,
    plans: after.businessPlans, scenarios: after.mortgageScenarios.scenarios, entries: after.marketIntel.entries };
  for (const [name, list] of Object.entries(lists)) {
    assert.equal(list.length, 2, name);
    assert.equal(new Set(list.map(x => x.id)).size, 2, `${name}: אין מזהה כפול`);
    assert.equal(list.some(x => x.id === 'X2'), false, name);
    assert.ok(list.every(x => x.createdAt === '2026-01-01T00:00:00.000Z'), `${name}: מועד היצירה נשמר`);
  }
  assert.equal(after.contacts[0].name, 'אברהם כהן', 'השדות לעריכה כן מתעדכנים');
  assert.equal(after.tasks[0].title, 'הכנת דוח שנתי');
  // מחיקה של אחת לא מוחקת את השנייה
  await handlers['contacts:delete'](ev(1), 'c1');
  assert.deepEqual((await db.load()).contacts.map(c => c.id), ['c2']);
});

// ---------- ממצא נמוך: load() העתיק את ברירות המחדל העתקה רדודה ----------

test('ממצא נמוך: אוסף חסר לא חולק מערכים עם ברירת המחדל', async () => {
  const D = require('../modules/econ/core/database');
  const db = await initializeDatabase(fs.mkdtempSync(path.join(tmp, 'defaults-')));
  await db.run("DELETE FROM collections WHERE collection IN ('personalFinance', 'records', 'meta')");
  const first = await db.load();
  first.personalFinance.incomes.push({ id: 'leak' });
  first.records.push({ id: 'leak' });
  first.settings.vatRate = 0.5;
  const second = await db.load();
  assert.deepEqual(second.personalFinance.incomes, []);
  assert.deepEqual(second.records, []);
  assert.equal(second.settings.vatRate, 0.18);
  assert.deepEqual(D.defaults.personalFinance.incomes, [], 'ברירת המחדל לא השתנתה');
  assert.deepEqual(D.defaults.records, []);
  assert.equal(D.defaults.settings.vatRate, 0.18);
  db.db.close();
});

// ---------- ממצא נמוך: VACUUM אחרי הצפנת מסד ישן לא חודש אחרי קריסה ----------

test('ממצא נמוך: קריסה בין COMMIT ל-VACUUM — ה-VACUUM רץ בעלייה הבאה והטקסט הגלוי נעלם מהקובץ', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'vacuum-'));
  const MARK = 'PLAINTEXT-MARKER-7f3a9c';
  // מסד ישן, גלוי
  const plain = await initializeDatabase(dir);
  const data = await plain.load();
  data.contacts = Array.from({ length: 50 }, (_, i) => ({ id: 'c' + i, name: `${MARK}-${i}` }));
  await plain.save(data);
  await plain.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  plain.db.close();
  const fileText = () => ['', '-wal'].map(ext => { try { return fs.readFileSync(path.join(dir, 'unified_economics.db' + ext)).toString('latin1'); } catch { return ''; } }).join('');
  assert.ok(fileText().includes(MARK));

  const key = AR.deriveDbKey(Buffer.alloc(32, 7).toString('base64'));
  const opts = { resolveCipher: async () => ({ key, status: 'encrypted' }) };
  // "קריסה": ה-VACUUM הראשון נכשל אחרי שההמרה נשמרה. הכשל לא מפיל את העלייה — הערכים כבר מוצפנים
  const origExec = DatabaseSync.prototype.exec;
  let failed = false;
  DatabaseSync.prototype.exec = function (sql) {
    if (!failed && /^\s*VACUUM\s*$/i.test(sql)) { failed = true; throw new Error('simulated crash'); }
    return origExec.call(this, sql);
  };
  let first;
  try { first = await initializeDatabase(dir, opts); }
  finally { DatabaseSync.prototype.exec = origExec; }
  assert.ok(failed);
  assert.match(first.atRestVacuumError.message, /simulated crash/);
  assert.deepEqual((await first.all('SELECT task FROM maintenance')).map(r => r.task), ['vacuum'], 'הסימון נשאר');
  first.db.close();
  assert.ok(fileText().includes(MARK), 'לפני התיקון — העותקים הגלויים עדיין בקובץ');

  const db = await initializeDatabase(dir, opts);
  assert.deepEqual(await db.all("SELECT task FROM maintenance"), [], 'הסימון נמחק אחרי VACUUM');
  assert.equal(db.atRestVacuumError, null);
  assert.equal((await db.load()).contacts.length, 50, 'הנתונים נקראים כרגיל');
  db.db.close();
  assert.equal(fileText().includes(MARK), false, 'אחרי העלייה הבאה אין טקסט גלוי בקובץ');
});

// סוקר: כשל קבוע ב-VACUUM (כונן מלא — SQLITE_FULL, או TEMP שאינו ניתן לכתיבה) הפיל כל עלייה, והנתונים הכספיים ננעלו
test('ממצא נמוך (סוקר): VACUUM שנכשל בכל עלייה — המערכת עולה בכל פעם, הנתונים מוצפנים, והסימון נשאר לניסיון הבא', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'vacuum-full-'));
  const plain = await initializeDatabase(dir);
  const data = await plain.load();
  data.contacts = [{ id: 'c1', name: 'משה כהן' }];
  await plain.save(data);
  plain.db.close();

  const key = AR.deriveDbKey(Buffer.alloc(32, 9).toString('base64'));
  const opts = { resolveCipher: async () => ({ key, status: 'encrypted' }) };
  const origExec = DatabaseSync.prototype.exec;
  let attempts = 0;
  DatabaseSync.prototype.exec = function (sql) {
    if (/^\s*VACUUM\s*$/i.test(sql)) { attempts++; throw Object.assign(new Error('database or disk is full'), { errcode: 13 }); }
    return origExec.call(this, sql);
  };
  try {
    for (let boot = 0; boot < 2; boot++) {
      const db = await initializeDatabase(dir, opts);
      assert.equal(db.atRestStatus, 'encrypted', `עלייה ${boot + 1}`);
      assert.match(db.atRestVacuumError.message, /disk is full/);
      assert.deepEqual((await db.all('SELECT task FROM maintenance')).map(r => r.task), ['vacuum']);
      assert.equal((await db.load()).contacts[0].name, 'משה כהן', 'הנתונים נקראים');
      const raw = await db.all("SELECT COUNT(*) AS n FROM collections WHERE payload NOT LIKE 'SSDB1:%'");
      assert.equal(raw[0].n, 0, 'כל הערכים מוצפנים');
      db.db.close();
    }
  } finally { DatabaseSync.prototype.exec = origExec; }
  assert.equal(attempts, 2, 'ניסיון אחד בכל עלייה');
  // אחרי שהתפנה מקום — ה-VACUUM מצליח והסימון נמחק
  const db = await initializeDatabase(dir, opts);
  assert.deepEqual(await db.all('SELECT task FROM maintenance'), []);
  db.db.close();
});

// סוקר: מסד שהומר והקריס בין COMMIT ל-VACUUM לפני התיקון — אין בו סימון; מיגרציה 11 מסמנת כל מסד מוצפן
test('ממצא נמוך (סוקר): מסד מוצפן מלפני התיקון (בלי סימון) עובר VACUUM בעלייה הראשונה אחרי מיגרציה 11', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'vacuum-legacy-'));
  const MARK = 'LEGACY-PLAINTEXT-4b81d2';
  const plain = await initializeDatabase(dir);
  const data = await plain.load();
  data.contacts = Array.from({ length: 50 }, (_, i) => ({ id: 'c' + i, name: `${MARK}-${i}` }));
  await plain.save(data);
  plain.db.close();
  const key = AR.deriveDbKey(Buffer.alloc(32, 5).toString('base64'));
  const cipher = AR.createCipher(key);
  // המצב של לפני התיקון: הערכים הוצפנו (UPDATE), ה-VACUUM לא רץ, ואין טבלת תחזוקה ולא מיגרציה 11
  const raw = new DatabaseSync(path.join(dir, 'unified_economics.db'));
  raw.exec('BEGIN');
  for (const row of raw.prepare("SELECT collection, payload FROM collections WHERE payload NOT LIKE 'SSDB1:%'").all()) {
    raw.prepare('UPDATE collections SET payload = ? WHERE collection = ?').run(cipher.seal(row.payload), row.collection);
  }
  for (const row of raw.prepare("SELECT id, details FROM audit_events WHERE details IS NOT NULL AND details <> '' AND details NOT LIKE 'SSDB1:%'").all()) {
    raw.prepare('UPDATE audit_events SET details = ? WHERE id = ?').run(cipher.seal(row.details), row.id);
  }
  raw.exec('DROP TABLE maintenance; DELETE FROM schema_migrations WHERE version = 11; COMMIT');
  raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  raw.close();
  const fileText = () => ['', '-wal'].map(ext => { try { return fs.readFileSync(path.join(dir, 'unified_economics.db' + ext)).toString('latin1'); } catch { return ''; } }).join('');
  assert.ok(fileText().includes(MARK), 'העותקים הגלויים עדיין בדפים הפנויים');

  const db = await initializeDatabase(dir, { resolveCipher: async () => ({ key, status: 'encrypted' }) });
  assert.deepEqual(await db.all('SELECT task FROM maintenance'), [], 'ה-VACUUM רץ והסימון נמחק');
  assert.equal((await db.load()).contacts.length, 50);
  db.db.close();
  assert.equal(fileText().includes(MARK), false, 'אין טקסט גלוי בקובץ');
});

test('מיגרציה 11: מסד חדש או גלוי — בלי סימון VACUUM (אין מה לנקות)', async () => {
  const db = await initializeDatabase(fs.mkdtempSync(path.join(tmp, 'vacuum-fresh-')));
  assert.deepEqual(await db.all('SELECT task FROM maintenance'), []);
  db.db.close();
});
