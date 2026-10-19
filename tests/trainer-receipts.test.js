// תשלומי מנויים ממודול האימונים ← חשבונית מס/קבלה במערכת הכלכלית (PLAN.md 9.11).
// הנתונים נקראים מהמחסן של מודול האימונים ב-main.js, רק מתצוגת המודול הכלכלי; הערוצים — דרך handle() (כניסה, הרשאה, רישיון),
// הפקה רק באישור מפורש, פעם אחת לכל תשלום, והסכום תמיד מהמחסן ולא מהממשק
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};
const Module = require('module');
Module._resolveFilename_trp = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_trp__.js' : Module._resolveFilename_trp.call(this, req, ...rest); };
require.cache['/__electron_stub_trp__.js'] = { id: '/__electron_stub_trp__.js', filename: '/__electron_stub_trp__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } } };

const TP = require('../modules/econ/core/trainerPayments');
const ipc = require('../modules/econ/ipc');
const ROOT = path.join(__dirname, '..');
const ev = (id) => ({ sender: { id } });

// נתוני מודול האימונים כפי שהם במחסן: מפתח ← מחרוזת JSON (modules-src/trainer/src/lib/db.js → K)
function trainerItems() {
  const m1 = { id: 'm_1', planId: 'plan_punch10', name: 'כרטיסיית 10 אימונים', kind: 'punch', sessions: 10, start: '2026-10-01', end: '2027-01-29', priceAg: 60000,
    payments: [{ id: 'p_1', date: '2026-10-01', amountAg: 35000, method: 'cash', note: '' }, { id: 'p_2', date: '2026-10-12', amountAg: 25000, method: 'app', note: 'העברה בביט' }], uses: [] };
  return {
    'clients:index': JSON.stringify(['c_1', 'c_2', 'c_bad', '../x']),
    'client:c_1': JSON.stringify({ id: 'c_1', name: 'יוסף כהן', phone: '050-1234567' }),
    'memberships:c_1': JSON.stringify([m1]),
    'client:c_2': JSON.stringify({ id: 'c_2', name: 'שמעון לוי' }),
    'memberships:c_2': JSON.stringify([{ id: 'm_2', name: 'מנוי חודשי', payments: [
      { id: 'p_3', date: '2026-09-20', amountAg: 12345, method: 'card' },
      { id: 'p_bad1', date: '2026-09-21', amountAg: 10.5, method: 'cash' },   // לא אגורות שלמות
      { id: 'p_bad2', date: '20/09/2026', amountAg: 100, method: 'cash' },    // תאריך לא תקין
      { id: 'p_bad3', date: '2026-09-22', amountAg: -100, method: 'cash' },
    ] }]),
    'client:c_bad': '{not json',
    'memberships:c_bad': JSON.stringify([{ id: 'm_3', payments: [{ id: 'p_9', date: '2026-10-01', amountAg: 100, method: 'cash' }] }]),
  };
}

test('קריאת התשלומים: רק רשומות תקינות, מהחדש לישן, אמצעי תשלום ממופה', () => {
  const list = TP.readPayments(trainerItems());
  assert.deepEqual(list.map(p => p.key), ['c_1/m_1/p_2', 'c_1/m_1/p_1', 'c_2/m_2/p_3']);
  const [p2, p1, p3] = list;
  assert.equal(p1.clientName, 'יוסף כהן');
  assert.equal(p1.membershipName, 'כרטיסיית 10 אימונים');
  assert.equal(p3.amountAg, 12345);
  assert.equal(p2.methodLabel, 'אפליקציית תשלום');
  assert.equal(TP.invoiceInput(p2).method, 'other', 'אפליקציה ← "אחר" בקבלה');
  assert.equal(TP.invoiceInput(p1).method, 'cash');
  assert.equal(TP.invoiceInput(p2).reference, 'העברה בביט');
  assert.equal(TP.invoiceInput(p3).grossAgorot, 12345, 'אגורות שלמות, בלי נקודה צפה');
  assert.deepEqual(TP.readPayments(null), []);
  assert.deepEqual(TP.readPayments({ 'clients:index': '"x"' }), []);
});

test('שיוך לחשבוניות: חשבונית שבוטלה לא נחשבת', () => {
  const list = TP.readPayments(trainerItems());
  const invs = [{ id: 'i1', number: 7, status: 'paid', trainerPayment: { key: 'c_1/m_1/p_1' } },
    { id: 'i2', number: 8, status: 'cancelled', trainerPayment: { key: 'c_2/m_2/p_3' } }];
  const v = TP.withReceipts(list, invs);
  assert.equal(v.find(p => p.key === 'c_1/m_1/p_1').invoiceNumber, 7);
  assert.equal(v.find(p => p.key === 'c_2/m_2/p_3').invoiceNumber, undefined);
  assert.equal(v.find(p => p.key === 'c_2/m_2/p_3').amount, 123.45);
});

test('ערוצים: אישור מפורש, פעם אחת לכל תשלום, הסכום מהמחסן; חשבונית מס/קבלה ששולמה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-trp-'));
  let items = trainerItems();
  const asked = [];
  await ipc.initEcon(dir, { trainerData: (senderId) => { asked.push(senderId); if (senderId !== 1) throw new Error('תשלומי האימונים זמינים רק מתוך המערכת הכלכלית'); return items; } });
  // בלי כניסה — כלום, וגם מקור הנתונים לא נקרא
  await assert.rejects(handlers['collect:getTrainerPayments'](ev(1)), /נדרשת כניסה/);
  assert.equal(asked.length, 0);
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');

  const r = await handlers['collect:getTrainerPayments'](ev(1));
  assert.equal(r.available, true);
  assert.equal(r.payments.length, 3);
  assert.ok(r.payments.every(p => !p.invoiceNumber));

  const key = 'c_1/m_1/p_1';
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(1), key), /אישור מפורש/);
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(1), key, { confirmed: 'yes' }), /אישור מפורש/);
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(1), 'c_1/m_1/nope', { confirmed: true }), /לא נמצא/);
  assert.equal((await handlers['acct:getInvoices'](ev(1))).length, 0, 'שום חשבונית לא נוצרה בלי אישור');

  // סכום שנשלח מהממשק לא משנה דבר — רק המפתח נקרא
  const inv = await handlers['collect:issueTrainerReceipt'](ev(1), key, { confirmed: true, amountAg: 1 });
  assert.equal(inv.total, 350);
  assert.equal(inv.customer, 'יוסף כהן');
  const stored = (await handlers['acct:getInvoices'](ev(1))).find(i => i.id === inv.id);
  assert.equal(stored.kind, 'tax-invoice-receipt');
  assert.equal(stored.status, 'paid');
  assert.equal(stored.date, '2026-10-01');
  assert.equal(stored.paymentMethod, 'cash');
  assert.equal(Math.round(stored.net * 100) + Math.round(stored.vat * 100), 35000, 'נטו + מע"מ = הסכום ששולם, עד האגורה');
  assert.equal(stored.trainerPayment.key, key);

  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(1), key, { confirmed: true }), /כבר הופקה חשבונית/);
  const after = await handlers['collect:getTrainerPayments'](ev(1));
  assert.equal(after.payments.find(p => p.key === key).invoiceNumber, inv.number);

  // התשלום נמחק במודול האימונים — אי אפשר להפיק עליו; החשבונית שכבר הופקה נשארת
  items = { ...items, 'memberships:c_2': JSON.stringify([]) };
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(1), 'c_2/m_2/p_3', { confirmed: true }), /לא נמצא/);

  // תצוגה אחרת (לא המודול הכלכלי): בלי כניסה שלה — נדחה עוד לפני מקור הנתונים
  await assert.rejects(handlers['collect:getTrainerPayments'](ev(2)), /נדרשת כניסה/);
  assert.ok(asked.every(id => id === 1));

  const audit = await handlers['audit:list'](ev(1), {});
  const rows = Array.isArray(audit) ? audit : (audit.rows || audit.events || []);
  assert.ok(JSON.stringify(rows).includes('acct.invoice.create'), 'ההפקה נרשמה ביומן הפעולות');

  // צופה: רואה את הרשימה, לא מפיק
  await handlers['users:create'](ev(1), { username: 'tzofeh', password: 'tzofeh-pass-long-1', role: 'viewer' });
  await handlers['auth:login'](ev(3), 'tzofeh', 'tzofeh-pass-long-1');
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(3), 'c_1/m_1/p_2', { confirmed: true }), /אין הרשאה/);
});

test('עוסק פטור: חשבונית עסקה בלי מע"מ וקבלה רשמית; ההפקה הבאה מוצעת באותו סוג', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-trp3-'));
  await ipc.initEcon(dir, { trainerData: () => trainerItems() });
  await handlers['auth:setup'](ev(7), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(7), 'menahel', 'menahel-pass-long-1');
  assert.equal((await handlers['collect:getTrainerPayments'](ev(7))).exemptDefault, false);
  // רק true מפורש — לא מחרוזת
  const taxed = await handlers['collect:issueTrainerReceipt'](ev(7), 'c_1/m_1/p_1', { confirmed: true, exempt: 'yes' });
  assert.equal(taxed.exempt, false);

  const r = await handlers['collect:issueTrainerReceipt'](ev(7), 'c_2/m_2/p_3', { confirmed: true, exempt: true });
  assert.equal(r.exempt, true);
  assert.equal(r.total, 123.45);
  assert.ok(r.receiptNumber, 'הופקה קבלה');
  const inv = (await handlers['acct:getInvoices'](ev(7))).find(i => i.id === r.id);
  assert.equal(inv.vatExempt, true);
  assert.equal(inv.vat, 0);
  assert.equal(inv.net, 123.45);
  assert.equal(inv.status, 'paid');
  assert.notEqual(inv.kind, 'tax-invoice-receipt', 'לא חשבונית מס/קבלה');
  assert.equal(require('../modules/econ/core/exports').renderInvoiceHtml(inv).includes('חשבונית עסקה'), true);
  assert.equal((await handlers['collect:getTrainerPayments'](ev(7))).exemptDefault, true);
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(7), 'c_2/m_2/p_3', { confirmed: true, exempt: true }), /כבר הופקה/);
});

test('בלי מקור נתונים (אנדרואיד) — "לא זמין", בלי שגיאה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-trp2-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(5), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(5), 'menahel', 'menahel-pass-long-1');
  const r = await handlers['collect:getTrainerPayments'](ev(5));
  assert.equal(r.available, false);
  assert.match(r.reason, /אינם זמינים/);
  await assert.rejects(handlers['collect:issueTrainerReceipt'](ev(5), 'c_1/m_1/p_1', { confirmed: true }), /אינם זמינים/);
});

test('הרשאות: רשימה — צפייה; הפקה — עריכה (צופה לא מפיק)', () => {
  assert.equal(ipc.permissionFor('collect:getTrainerPayments'), 'data.view');
  assert.equal(ipc.permissionFor('collect:issueTrainerReceipt'), 'data.edit');
});

test('main.js: הנתונים רק לתצוגת המודול הכלכלי, רק עם רישיון לאימונים ורק ממחסן מוצפן', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const i = MAIN.indexOf('function trainerDataForEcon');
  assert.ok(i > 0);
  const body = MAIN.slice(i, MAIN.indexOf('\n}', i));
  assert.match(body, /fromView\(\{ sender: \{ id: senderId \} \}, 'econ'\)/);
  assert.match(body, /LG\.moduleAllowed\(licenseNow\(\), 'trainer'\)/);
  assert.match(body, /s\.state !== 'encrypted'/);
  assert.match(body, /snapshot\(\)/);
  assert.doesNotMatch(body, /\.set\(|\.remove\(|\.clear\(/, 'קריאה בלבד');
  assert.equal((MAIN.match(/trainerData: trainerDataForEcon/g) || []).length, 1, 'מוגדר במקום אחד — econInitOptions');
  const calls = MAIN.match(/econ\.initEcon\([^\n]*/g) || [];
  assert.ok(calls.length >= 2 && calls.every(c => c.includes('econInitOptions()')), 'כל קריאה ל-initEcon עוברת דרך econInitOptions: ' + calls.join(' | '));
});

test('ממשק: כפתור במסך הגבייה, אישור לפני הפקה, וחשיפה ב-preload', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/collect.js'), 'utf8');
  assert.match(ui, /id="collectTrainerBtn"/);
  assert.match(ui, /on\('collectTrainerBtn', collectTrainerPayments\)/);
  const fn = ui.slice(ui.indexOf('async function collectTrainerPayments'));
  assert.ok(fn.indexOf("licForm('אישור הפקה'") > 0 && fn.indexOf("licForm('אישור הפקה'") < fn.indexOf('collectIssueTrainerReceipt('), 'אישור לפני ההפקה');
  assert.match(fn, /if \(!v\) continue;/, 'ביטול החלון — אין הפקה');
  assert.match(fn, /collectIssueTrainerReceipt\(p\.key, \{ confirmed: true, exempt: v\.doc === 'exempt' \}\)/);
  const pre = fs.readFileSync(path.join(ROOT, 'modules/econ/preload.js'), 'utf8');
  assert.match(pre, /collectTrainerPayments: \(\) => ipcRenderer\.invoke\('collect:getTrainerPayments'\)/);
  assert.match(pre, /collectIssueTrainerReceipt: \(key, opts\) => ipcRenderer\.invoke\('collect:issueTrainerReceipt', key, opts\)/);
});

// הזרימה בממשק עצמו (ui/collect.js בתוך כל קבצי הממשק): ביטול באישור = אין הפקה; בחירת עוסק פטור עוברת לערוץ
test('ממשק — הזרימה: רשימה ← הפקה ← אישור; ביטול לא מפיק, והבחירה נשלחת כמו שהיא', async () => {
  const vm = require('vm');
  const EconUI = require('./helpers/econ-ui');
  const ctx = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  EconUI.run(ctx);
  const payment = { key: 'c_1/m_1/p_1', date: '2026-10-01', clientName: 'יוסף כהן', membershipName: '<b>כרטיסייה</b>', amount: 350, methodLabel: 'מזומן' };
  const issued = [], toasts = [], forms = [];
  let listHtml = '';
  let picks = [];      // מה המשתמש לוחץ ברשימה, לפי הסדר (null = סגירה)
  let answers = [];    // מה עונה חלון האישור, לפי הסדר (null = ביטול)
  ctx.systemAPI = {
    collectTrainerPayments: async () => ({ available: true, exemptDefault: true, payments: [payment] }),
    collectIssueTrainerReceipt: async (key, opts) => { issued.push({ key, opts }); return { number: 12, receiptNumber: 4, exempt: opts.exempt }; },
  };
  vm.runInContext('openDialog = (build) => new Promise((resolve) => { const card = { style: {}, set innerHTML(v) { __list(v); }, querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [] }; build(card, resolve); __pick(resolve); });', ctx);
  ctx.__list = (h) => { listHtml = h; };
  ctx.__pick = (resolve) => resolve(picks.shift() ?? null);
  vm.runInContext('licForm = async (title, fields, submit, intro) => __form(title, fields, intro); showToast = (m) => __toast(m); showError = (m) => { throw new Error(m); };', ctx);
  ctx.__form = (title, fields, intro) => { forms.push({ title, fields, intro }); return answers.shift() ?? null; };
  ctx.__toast = (m) => toasts.push(m);

  // ביטול בחלון האישור — אין הפקה, חוזרים לרשימה וסוגרים
  picks = [payment.key, null];
  answers = [null];
  assert.equal(await vm.runInContext('collectTrainerPayments()', ctx), true);
  assert.equal(issued.length, 0, 'ביטול — שום הפקה');
  assert.match(listHtml, /data-trainer-issue="c_1\/m_1\/p_1"/);
  assert.doesNotMatch(listHtml, /<b>כרטיסייה<\/b>/, 'שם המנוי מנוטרל');
  const f = forms[0];
  assert.equal(f.title, 'אישור הפקה');
  assert.match(f.intro, /יוסף כהן/);
  assert.match(f.intro, /350/);
  assert.equal(f.fields[0].value, 'exempt', 'ברירת המחדל לפי ההפקה האחרונה');

  // אישור עם עוסק פטור
  picks = [payment.key, null];
  answers = [{ doc: 'exempt' }];
  await vm.runInContext('collectTrainerPayments()', ctx);
  assert.equal(JSON.stringify(issued), JSON.stringify([{ key: 'c_1/m_1/p_1', opts: { confirmed: true, exempt: true } }]));
  assert.match(toasts.at(-1), /חשבונית עסקה 12 וקבלה 4/);
});
