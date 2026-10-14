// הגדרות מתקדמות: ייבוא/ייצוא, ניהול משתמשים, ניתוק אוטומטי, פריטי תוכנית פיננסית ושגיאות בעברית
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../modules/econ/core/dataPorts');
const X = require('../modules/econ/core/exports');
const { initializeDatabase } = require('../modules/econ/core/database');

const csv = (headers, rows) => X.toCsv(headers, rows);

// ---------- ייבוא/ייצוא ----------

test('ייבוא אנשי קשר: כותרות בעברית, דילוג על כפולים ודיווח שורות שגויות', () => {
  const data = { contacts: [{ id: 'a', name: 'משה כהן', phone: '050-1234567' }] };
  const text = csv(['שם', 'טלפון', 'דוא"ל'], [
    ['משה כהן', '0501234567', ''],      // כפול (אותו טלפון בספרות)
    ['יוסף לוי', '052-7654321', 'y@example.com'],
    ['', '053-0000000', '']              // חסר שם
  ]);
  const r = P.parseImport('contacts', text, data);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].name, 'יוסף לוי');
  assert.equal(r.skipped, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 4);
  assert.match(r.errors[0].message, /[א-ת]/);
  P.applyImport('contacts', data, r.records);
  assert.equal(data.contacts.length, 2);
});

test('ייצוא וייבוא חוזר של משימות: תוויות בעברית חוזרות לקוד', () => {
  const data = { tasks: [{ id: 't', title: 'הכנת דוח מע"מ', priority: 'high', status: 'todo', category: 'finance', dueDate: '2026-11-01' }] };
  const t = P.exportTable('tasks', data);
  const row = t.rows[0];
  assert.ok(row.includes('גבוהה'), 'עדיפות מיוצאת בעברית');
  const fresh = { tasks: [] };
  const r = P.parseImport('tasks', csv(t.headers, t.rows), fresh);
  assert.equal(r.errors.length, 0);
  assert.equal(r.records[0].priority, 'high');
  assert.equal(r.records[0].category, 'finance');
});

test('ייבוא: קובץ ללא עמודות מוכרות נדחה בהודעה בעברית; תבנית מכילה כותרות בלבד', () => {
  assert.throws(() => P.parseImport('contacts', csv(['foo'], [['x']]), {}), /לא זוהו עמודות/);
  assert.throws(() => P.parseImport('contacts', '', {}), /ריק/);
  const tpl = P.templateTable('contacts');
  assert.equal(tpl.rows.length, 0);
  assert.ok(tpl.headers.includes('שם'));
  assert.throws(() => P.exportTable('nope', {}));
});

test('vCard: ייבוא (כולל קיפול שורות) וייצוא הלוך-חזור', () => {
  const v = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:אהרן\r\n  שטרן\r\nTEL;TYPE=CELL:054-1112233\r\nORG:ישיבת אור;\r\nEND:VCARD\r\n';
  const rows = P.vcardToRows(v);
  assert.equal(rows[0].phone, '054-1112233');
  assert.equal(rows[0].company, 'ישיבת אור');
  const data = { contacts: [] };
  const r = P.importContactsVcard(v, data);
  assert.equal(r.records.length, 1);
  P.applyImport('contacts', data, r.records);
  const out = P.contactsToVcard(data);
  const back = P.vcardToRows(out);
  assert.equal(back[0].name, data.contacts[0].name);
  assert.equal(back[0].phone, '054-1112233');
  assert.throws(() => P.importContactsVcard('שלום', {}), /לא נמצאו/);
});

// ---------- משתמשים ותפקידים ----------

async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-adv-'));
  return initializeDatabase(dir);
}

test('משתמשים: יצירה עם תפקיד, אסור להסיר את המנהל האחרון, איפוס סיסמה', async () => {
  const db = await freshDb();
  const admin = await db.createUser('admin_one', 'strong-pass-2026!', 'admin');
  const ed = await db.createUser('editor_one', 'strong-pass-2026!', 'editor');
  await assert.rejects(db.createUser('editor_one', 'strong-pass-2026!', 'editor'), /כבר קיים/);
  await assert.rejects(db.createUser('x_user', 'strong-pass-2026!', 'god'), /תפקיד/);
  await assert.rejects(db.updateUser(admin.id, { role: 'viewer' }), /המנהל הפעיל האחרון/);
  await assert.rejects(db.updateUser(admin.id, { active: false }), /המנהל הפעיל האחרון/);
  const up = await db.updateUser(ed.id, { role: 'viewer', active: false });
  assert.equal(up.role, 'viewer');
  assert.equal(up.active, false);
  await db.updateUser(ed.id, { role: 'admin', active: true });
  await db.updateUser(admin.id, { role: 'editor' }); // עכשיו יש מנהל אחר — מותר
  assert.equal(await db.resetPassword(ed.id, 'another-strong-pass-1'), true);
  await assert.rejects(db.resetPassword('missing', 'another-strong-pass-1'), /לא נמצא/);
});

test('יומן ביקורת: סינון לפי קידומת פעולה', async () => {
  const db = await freshDb();
  await db.audit(null, 'users:create', 'א');
  await db.audit(null, 'ports:import', 'ב');
  const all = await db.listAudit({});
  assert.equal(all.length, 2);
  const f = await db.listAudit({ action: 'ports' });
  assert.deepEqual(f.map(a => a.action), ['ports:import']);
});

test('גיבוי כללי כולל את כל האוספים, כולל עמותה וייעוץ משכנתאות', async () => {
  const db = await freshDb();
  const b = await db.backup();
  const keys = JSON.stringify(Object.keys(b.data || b));
  for (const k of ['contacts', 'tasks', 'npo', 'mortgageAdvisor', 'personalFinance']) assert.ok(keys.includes(k), k);
});

// ---------- ניתוק אוטומטי ----------

test('ניתוק אוטומטי: טווח 5–240 דקות, ערך שגוי חוזר ל-15; חסימת משתמש סוגרת את הפגישות שלו', () => {
  const { AuthService } = require('../modules/econ/services/authService');
  const a = AuthService;
  assert.equal(a.setIdleMinutes(30), 30);
  assert.equal(a.idleMs, 30 * 60 * 1000);
  assert.equal(a.setIdleMinutes(1), 15);
  assert.equal(a.setIdleMinutes('abc'), 15);
  a.sessions.set(7, { id: 'u1' }); a.sessions.set(8, { id: 'u2' });
  a.dropUser('u1');
  assert.equal(a.sessions.has(7), false);
  assert.equal(a.sessions.has(8), true);
  a.sessions.clear();
});

// ---------- תוכנית פיננסית ----------

test('תוכנית פיננסית: הוספה, עריכה ומחיקה של פריט; ולידציה בעברית', async () => {
  const db = await freshDb();
  const { PersonalFinanceService: s } = require('../modules/econ/services/personalFinanceService');
  await s.initialize(db);
  const it = await s.addItem('u', 'incomes', { source: 'משכורת', amount: '12000.456' });
  assert.equal(it.amount, 12000.46);
  const up = await s.updateItem('u', 'incomes', it.id, { amount: 13000 });
  assert.equal(up.amount, 13000);
  assert.equal(up.source, 'משכורת');
  await assert.rejects(s.addItem('u', 'expenses', { amount: 5 }), /קטגוריית ההוצאה חובה/);
  await assert.rejects(s.addItem('u', 'bogus', {}), /לא מוכר/);
  assert.equal(await s.deleteItem('u', 'incomes', it.id), true);
  await assert.rejects(s.deleteItem('u', 'incomes', it.id), /לא נמצא/);
});

// ---------- שגיאות בעברית ----------

test('toUserError: שגיאה פנימית באנגלית מוחלפת בהודעה בעברית, שגיאה בעברית נשמרת', () => {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { ipcMain: { handle() {} }, dialog: {}, app: { getPath: () => os.tmpdir() }, BrowserWindow: {}, safeStorage: {} };
    return orig.call(this, req, ...rest);
  };
  try {
    const { toUserError } = require('../modules/econ/ipc');
    const errLog = console.error; console.error = () => {};
    try { assert.match(toUserError(new Error('SQLITE_BUSY')).message, /שגיאה פנימית/); }
    finally { console.error = errLog; }
    assert.equal(toUserError(new Error('הפריט לא נמצא')).message, 'הפריט לא נמצא');
  } finally { Module._load = orig; }
});
