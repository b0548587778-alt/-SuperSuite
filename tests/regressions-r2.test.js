const test = require('node:test');
const { shamaiSource } = require('./helpers/shamai-src');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r2__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_r2__.js'] = { id: '/__electron_stub_r2__.js', filename: '/__electron_stub_r2__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: {}, BrowserWindow: function () {} } };
const ipc = require('../modules/econ/ipc');
const { AuthService: auth } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });
const PASS = 'owner-pass-2026-long';

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function adminSession(id) {
  await handlers['auth:login'](ev(id), 'owner_r2', PASS);
}

test('תיקון: מי שרק צופה (data.view) לא יכול לגבות או לשחזר', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r2-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(3), 'owner_r2', PASS);
  auth.setSession(31, { id: 'viewer', permissions: ['data.view'] });
  await assert.rejects(handlers['data:backupEncrypted'](ev(31), 'pass-12345'), /אין הרשאה/);
  await assert.rejects(handlers['data:restoreEncrypted'](ev(31), 'SSBK1:x', 'pass-12345'), /אין הרשאה/);
  // ומי שיש לו data.backup כן מקבל טקסט מוצפן
  auth.setSession(32, { id: 'backuper', permissions: ['data.backup'] });
  const text = await handlers['data:backupEncrypted'](ev(32), 'pass-12345');
  assert.ok(text.startsWith('SSBK1:'));
  assert.doesNotMatch(text, /owner_r2/, 'הטקסט הגלוי אינו נראה בקובץ');
  // assertAccess מהמעטפת: בלי כניסה נחסם, עם הרשאה לא
  assert.throws(() => ipc.assertAccess(999, 'data.backup'), /נדרשת כניסה/);
  assert.throws(() => ipc.assertAccess(31, 'data.backup'), /אין הרשאה/);
  assert.equal(ipc.assertAccess(32, 'data.backup').id, 'backuper');
});

test('שחזור מוצפן: סיסמה שגויה נדחית, וגיבוי גלוי (JSON) לא מתקבל בערוץ המוצפן', async () => {
  await adminSession(40);
  const text = await handlers['data:backupEncrypted'](ev(40), 'pass-12345');
  await assert.rejects(handlers['data:restoreEncrypted'](ev(40), text, 'wrong-pass-999'), /סיסמת הגיבוי שגויה/);
  await assert.rejects(handlers['data:restoreEncrypted'](ev(40), '{"suite":"SuperSuite"}', 'pass-12345'), /אינו גיבוי מוצפן/);
  assert.equal(await handlers['data:restoreEncrypted'](ev(40), text, 'pass-12345'), true);
});

test('תיקון: אי אפשר לגבות חשבונית שבוטלה', async () => {
  await adminSession(50);
  const inv = await handlers['acct:createInvoice'](ev(50), { customer: 'לקוח א', items: [{ unitPrice: 100 }] });
  await handlers['acct:cancelInvoice'](ev(50), inv.id);
  await assert.rejects(handlers['acct:recordPayment'](ev(50), inv.id, {}), /לא ניתן לגבות חשבונית שבוטלה/);
  const invoices = await handlers['acct:getInvoices'](ev(50));
  assert.equal(invoices.find(i => i.id === inv.id).status, 'cancelled');
  const r = await handlers['acct:getReports'](ev(50), {});
  assert.equal(r.openInvoices, 0, 'חשבונית שבוטלה לא נשארת בחוב פתוח');
});

test('תיקון: אי אפשר לבטל רשומה של חשבונית ישירות (הסטטוס היה נשאר לא מסונכרן)', async () => {
  await adminSession(60);
  const inv = await handlers['acct:createInvoice'](ev(60), { customer: 'לקוח ב', items: [{ unitPrice: 50 }] });
  const journal = await handlers['acct:getJournal'](ev(60), {});
  const invEntry = journal.find(e => e.id === inv.entryId);
  await assert.rejects(handlers['acct:reverseEntry'](ev(60), invEntry.id), /בטל את החשבונית במקום/);
  // ביטול דרך החשבונית עובד ורושם היפוך אחד
  await handlers['acct:cancelInvoice'](ev(60), inv.id);
  const after = await handlers['acct:getJournal'](ev(60), {});
  assert.equal(after.filter(e => e.reversalOf === invEntry.id).length, 1);
});

test('תיקון: אי אפשר לבטל גבייה ישירות, אבל ביטול תשלום דרך החשבונית מחזיר אותה לפתוחה', async () => {
  await adminSession(70);
  const inv = await handlers['acct:createInvoice'](ev(70), { customer: 'לקוח ג', items: [{ unitPrice: 100 }] });
  await handlers['acct:recordPayment'](ev(70), inv.id, {});
  const journal = await handlers['acct:getJournal'](ev(70), {});
  const payEntry = journal.find(e => e.description.startsWith('גביית חשבונית ' + inv.number));
  await assert.rejects(handlers['acct:reverseEntry'](ev(70), payEntry.id), /בטל את הגבייה במקום/);

  const unpaid = await handlers['acct:unrecordPayment'](ev(70), inv.id);
  assert.equal(unpaid.status, 'open');
  const r = await handlers['acct:getReports'](ev(70), {});
  assert.equal(r.openInvoices, 118, 'החוב הפתוח חזר למלוא סכום החשבונית');
  await assert.rejects(handlers['acct:unrecordPayment'](ev(70), inv.id), /אינה משולמת/);
});

test('תיקון: אי אפשר לבטל רשומת ביטול (למנוע "ביטול של ביטול" שמשנה את היתרות)', async () => {
  await adminSession(80);
  const e = await handlers['acct:createEntry'](ev(80), { date: '2026-02-01', description: 'הוצאה', lines: [
    { account: '5000', debit: 10, credit: 0 }, { account: '1000', debit: 0, credit: 10 }] });
  const rev = await handlers['acct:reverseEntry'](ev(80), e.id);
  await assert.rejects(handlers['acct:reverseEntry'](ev(80), rev.id), /לא ניתן לבטל רשומת ביטול/);
});

test('תיקון: רשומה עם שדה lines חסר מקבלת הודעה בעברית ולא TypeError', async () => {
  await adminSession(90);
  await assert.rejects(handlers['acct:createEntry'](ev(90), { date: '2026-02-01', description: 'x' }), /לפחות שתי שורות/);
});

test('הוצאות אישיות: נשמרות בנפרד, לא משפיעות על היומן, המע"מ או הרווח העסקי', async () => {
  await adminSession(100);
  const before = await handlers['acct:getReports'](ev(100), {});
  const journalBefore = (await handlers['acct:getJournal'](ev(100), {})).length;
  const p = await handlers['personal:addEntry'](ev(100), { date: '2026-03-02', kind: 'expense', amount: 250, category: 'חשמל', note: 'דירה' });
  await handlers['personal:addEntry'](ev(100), { date: '2026-03-03', kind: 'income', amount: 1000, category: 'משכורת' });
  assert.equal((await handlers['acct:getJournal'](ev(100), {})).length, journalBefore, 'לא נוספה שום רשומת יומן');
  const after = await handlers['acct:getReports'](ev(100), {});
  assert.deepEqual(after.incomeStatement.totalRevenue, before.incomeStatement.totalRevenue);
  assert.deepEqual(after.vat, before.vat);
  const sum = await handlers['personal:getSummary'](ev(100), {});
  assert.equal(sum.expense, 250);
  assert.equal(sum.balance, 750);
  await handlers['personal:deleteEntry'](ev(100), p.id);
  assert.equal((await handlers['personal:getSummary'](ev(100), {})).expense, 0);
});

test('דוח סיכום תקופתי ואנליטיקה נגישים דרך ה-IPC לאחר כניסה', async () => {
  await adminSession(110);
  const before = await handlers['acct:getPeriodSummary'](ev(110), {});
  const inv = await handlers['acct:createInvoice'](ev(110), { customer: 'לקוח חוזר', items: [{ unitPrice: 100 }] });
  await handlers['acct:createInvoice'](ev(110), { customer: 'לקוח חוזר', items: [{ unitPrice: 200 }] });
  const s = await handlers['acct:getPeriodSummary'](ev(110), {});
  assert.equal(s.income - before.income, 300, 'ההכנסות גדלו בסכום החשבוניות (נטו)');
  assert.equal(s.outputVat - before.outputVat, 54);
  const a = await handlers['acct:getInvoiceAnalytics'](ev(110));
  assert.ok(a.repeatCustomers.some(c => c.customer === 'לקוח חוזר' && c.count >= 2));
  assert.ok(inv.number >= 1);
});

test('ייבוא מחירון דרך ה-IPC: שורות תקינות נשמרות ושגויות מדווחות', async () => {
  await adminSession(120);
  const r = await handlers['acct:importProducts'](ev(120), 'name,cost,markupPct\nמוצר טוב,10,50\n,5,5\n');
  assert.equal(r.added, 1);
  assert.equal(r.errors[0].line, 3);
  const products = await handlers['acct:getProducts'](ev(120));
  assert.ok(products.some(p => p.name === 'מוצר טוב'));
});

test('הרשאות חדשות: ערוצי הגיבוי/הייצוא/ביטול תשלום מוגנים לפי שם הפעולה', async () => {
  auth.setSession(130, { id: 'viewer2', permissions: ['data.view'] });
  await assert.rejects(handlers['acct:unrecordPayment'](ev(130), 'x'), /אין הרשאה/);
  await assert.rejects(handlers['personal:deleteEntry'](ev(130), 'x'), /אין הרשאה/);
  await assert.rejects(handlers['acct:importProducts'](ev(130), 'name\nx'), /אין הרשאה/);
});

test('תיקון: אין תלות ברשת חיצונית באף מודול — האפליקציה עובדת בסביבה מסוננת', () => {
  const mods = ['trainer', 'shamai'];
  for (const m of mods) {
    const html = read(`modules/${m}/index.html`);
    // אין קישור/סקריפט לגוגל פונטים או ל-CDN
    assert.doesNotMatch(html, /fonts\.googleapis\.com/, `${m}/index.html לא יפנה ל-Google Fonts`);
    assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//, `${m}/index.html לא יפנה החוצה`);
  }
  // הבאנדל של TrainerPro לא מזריק גוגל פונטים בזמן ריצה
  // שם החבילה משתנה בכל בנייה מהמקור (modules-src/trainer) — נלקח מ-index.html
  const trainerJs = read('modules/trainer/' + read('modules/trainer/index.html').match(/src="\/(assets\/index-[^"]+\.js)"/)[1]);
  assert.doesNotMatch(trainerJs, /fonts\.googleapis\.com/, 'הבאנדל של trainer לא מזריק גוגל פונטים');
  // גופן ה-OCR נטען מקומית, לא מ-CDN, וההודעה אינה מפנה לאינטרנט
  const shamaiApp = shamaiSource();
  assert.doesNotMatch(shamaiApp, /cdn\.jsdelivr\.net/, 'שַׁמַּאי לא טוען tesseract מ-CDN');
  assert.match(shamaiApp, /script\.src = 'lib\/tesseract\//, 'הגופן/מנוע ה-OCR נטען מהעותק המקומי');
  assert.doesNotMatch(shamaiApp, /check internet/, 'ההודעה לא מפנה את המשתמש לאינטרנט');
  // ה-service worker לא מטפל יותר בבקשות גופן חיצוניות
  const sw = read('modules/shamai/sw.js');
  assert.doesNotMatch(sw, /fonts\.googleapis\.com/, 'sw.js לא מטפל בגוגל פונטים');
});

