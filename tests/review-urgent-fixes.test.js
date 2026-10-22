'use strict';
// רגרסיה לסקירת הקוד (23.10.2026) — שבעת הממצאים הדחופים: חישוב חשבונית, לוח סילוקין בגמ"ח,
// אוסף פגום במסד, ייבוא בשמאי (נבדק ב-shamai-report.test.js), פסיקים במספרים בשמאי והרשאות הגדרות הנהלת החשבונות
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../modules/econ/core/accounting');
const G = require('../modules/econ/core/gemach');
const { initializeDatabase } = require('../modules/econ/core/database');
const Module = require('module');

// ipc.js דורש electron — מספיק ipcMain מדומה כדי לקרוא את permissionFor
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_review__.js' : resolve.call(this, req, ...rest); };
require.cache['/__electron_stub_review__.js'] = { id: '/__electron_stub_review__.js', filename: '/__electron_stub_review__.js', loaded: true,
  exports: { ipcMain: { handle() {} } } };
const { permissionFor } = require('../modules/econ/ipc');
const { loadShamai } = require('./helpers/shamai-src');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-review-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ממצא 1: מחיר היחידה עוגל לאגורות לפני ההכפלה בכמות
test('חשבונית: עיגול אחד לשורה, אחרי ההכפלה בכמות', () => {
  const c = A.computeInvoice({ items: [{ quantity: 1000, unitPrice: 0.125 }] }, 0.18);
  assert.equal(c.net, 125);
  assert.equal(c.vat, 22.5);
  assert.equal(c.total, 147.5);
  // שארית נקודה צפה לא מורידה אגורה: 1.005 ₪ = 100.5 אגורות ← 101
  assert.equal(A.computeInvoice({ items: [{ quantity: 1, unitPrice: 1.005 }] }, 0).net, 1.01);
  // מחירים רגילים — ללא שינוי
  assert.equal(A.computeInvoice({ items: [{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 99.99 }] }, 0.18).net, 100.29);
});

// ממצא 2: יום 31 גלש לחודש הבא — פברואר בלי תשלום ומרץ עם שניים
test('גמ"ח: הלוואה מ-31 בחודש — תשלום אחד בכל חודש, ביום האחרון כשאין 31', () => {
  const s = G.buildSchedule(300, 3, '2026-01-31');
  assert.deepEqual(s.map(x => x.dueDate), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(G.buildSchedule(100, 1, '2027-12-31').map(x => x.dueDate), ['2028-01-31']);
  assert.deepEqual(G.buildSchedule(100, 2, '2027-12-30').map(x => x.dueDate), ['2028-01-30', '2028-02-29']);
  assert.equal(s.reduce((t, x) => t + x.amountAg, 0), 30000);
});

// ממצא 3: אוסף שלא נקרא הוחלף ברשימה ריקה, והשמירה הבאה מחקה אותו
test('מסד: אוסף פגום — שגיאה בעברית, והנתונים לא נדרסים', async () => {
  const db = await initializeDatabase(fs.mkdtempSync(path.join(tmp, 'db-')));
  const data = await db.load();
  data.invoices = [{ id: 'inv-1', number: 1 }];
  await db.save(data);
  await db.run("UPDATE collections SET payload = '{not json' WHERE collection = 'invoices'");
  await assert.rejects(db.load(), (e) => e.code === 'db-collection-corrupt' && e.collection === 'invoices' && /פגום/.test(e.message));
  const row = await db.all("SELECT payload FROM collections WHERE collection = 'invoices'");
  assert.equal(row[0].payload, '{not json', 'הנתונים הפגומים נשארים לשחזור — לא הוחלפו ברשימה ריקה');
  db.db.close();
});

// ממצאים 5–6: "1,000" גרם נקרא כגרם אחד, ו-"4665,5" במחיר — כ-46655
test('שמאי: פסיק — מפריד אלפים לפני 3 ספרות, אחרת נקודה עשרונית', () => {
  const { run } = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']);
  assert.equal(run("normalizeNumText('1,000')"), '1000');
  assert.equal(run("normalizeNumText('12,345,678.5')"), '12345678.5');
  assert.equal(run("normalizeNumText('4665,5')"), '4665.5');
  assert.equal(run("normalizeNumText('0,1')"), '0.1');
  assert.equal(run("normalizeNumText('₪ 1,250')"), '1250');
  assert.equal(run("normalizeNumText('1,2,3')"), null);
  assert.equal(run("normalizeNumText('abc')"), null);
  assert.equal(run("caseNum('1,000')"), 1000);
  assert.equal(run("caseNum('0,5')"), 0.5);
  assert.equal(run("parseAgorot('1,000')"), 100000);
  assert.equal(run("parseAgorot('12,5')"), 1250);
  assert.equal(run("checkPrice('gold', '4665,5')"), 4665.5);
  assert.equal(run("checkPrice('gold', '4,665.5')"), 4665.5);
  // שורת קנייה: 1,000 גרם — אלף גרם, לא גרם אחד
  run("var P = { gold: 3110.35, usdIls: 4 };");
  const kg = run("purchaseLineAg({ metal: 'gold', purityPpt: 999, grams: '1,000' }, P)");
  const one = run("purchaseLineAg({ metal: 'gold', purityPpt: 999, grams: '1' }, P)");
  assert.ok(JSON.stringify(kg) !== JSON.stringify(one));
});

// ממצא 7: עורך יכול היה לפתוח תקופה נעולה ולשנות שיעור מע"מ ומספר עוסק
test('הרשאות: הגדרות הנהלת החשבונות ושיעור המע"מ — מנהל בלבד', () => {
  assert.equal(permissionFor('acct:saveSettings'), 'users.manage');
  assert.equal(permissionFor('acct:setVatRate'), 'users.manage');
  assert.equal(permissionFor('acct:getSettings'), 'data.view');
});
