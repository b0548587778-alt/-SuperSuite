// גבייה מלקוחות של הארגון: קישור תשלום לחשבון הסוחר של הארגון, וקליטת דוח הסליקה —
// התשלום נרשם במקומו (חשבונית / תרומה עם קבלה / תשלום בגמ"ח), בלי פרטי אשראי ובלי רשת
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../modules/econ/core/collect');
const { initializeDatabase } = require('../modules/econ/core/database');

const settings = (over = {}) => P.normalizeSettings({ linkTemplate: 'https://pay.example.co.il/p?sum={amount}&ref={ref}&n={name}', ...over });

test('תבנית הקישור: https בלבד, בלי פרטי כניסה, רק משתנים מוכרים; ערכים מקודדים', () => {
  assert.throws(() => P.validateTemplate('http://pay.example.co.il'), /https/);
  assert.throws(() => P.validateTemplate('https://u:p@pay.example.co.il'), /שם משתמש/);
  assert.throws(() => P.validateTemplate('https://pay.example.co.il/?x={secret}'), /לא מוכר/);
  assert.throws(() => P.validateTemplate('javascript:alert(1)'), /https|תקינה/);
  assert.equal(P.validateTemplate(''), '');
  const { req } = P.createRequest({ kind: 'other', amount: 99.9, payerName: 'כהן & בניו?x=1#' }, settings(), 0);
  assert.equal(req.ref, 'P00001');
  assert.equal(req.amountAg, 9990, 'אגורות שלמות');
  const u = new URL(req.link);
  assert.equal(u.searchParams.get('sum'), '99.90');
  assert.equal(u.searchParams.get('n'), 'כהן & בניו?x=1#', 'שם עם תווים מיוחדים לא שובר את הכתובת');
  assert.equal(u.hash, '');
});

test('דרישה: סכום, שם ושיוך נבדקים; המספור רץ', () => {
  const s = settings();
  assert.throws(() => P.createRequest({ kind: 'other', amount: 0, payerName: 'א' }, s, 0), /סכום/);
  assert.throws(() => P.createRequest({ kind: 'other', amount: 10, payerName: ' ' }, s, 0), /שם/);
  assert.throws(() => P.createRequest({ kind: 'invoice', amount: 10, payerName: 'א' }, s, 0), /שיוך/);
  assert.throws(() => P.createRequest({ kind: 'gemach', amount: 10, payerName: 'א', targetId: 'L1' }, s, 0), /לוח הסילוקין/);
  assert.throws(() => P.createRequest({ kind: 'stocks', amount: 10, payerName: 'א' }, s, 0), /עבור מה/);
  const a = P.createRequest({ kind: 'donation', amount: 180, payerName: 'יעקב לוי', donorId: '0000-00018' }, s, 0);
  assert.equal(a.req.target.donorId, '000000018');
  assert.equal(a.settings.nextNumber, 2);
  const msg = P.messageText(a.req, { ...s, instructions: 'לשאלות: 03-1234567' }, 'עמותת חסדי אבות');
  assert.match(msg, /שלום יעקב לוי/);
  assert.match(msg, /180\.00 ₪/);
  assert.match(msg, /P00001/);
  assert.match(msg, /עמותת חסדי אבות/);
});

test('התאמת דוח: לפי מספר הדרישה, אחרת לפי שם וסכום ייחודיים; נכשלו וכפולים מדולגים', () => {
  const s = settings();
  const reqs = [];
  const add = (input) => { const r = P.createRequest(input, s, reqs.length); s.nextNumber = r.settings.nextNumber; reqs.push(r.req); };
  add({ kind: 'other', amount: 100, payerName: 'משה כהן' });     // P00001
  add({ kind: 'other', amount: 50, payerName: 'יעקב לוי' });     // P00002
  add({ kind: 'other', amount: 50, payerName: 'יעקב לוי' });     // P00003 — אותו שם וסכום
  add({ kind: 'other', amount: 70, payerName: 'אברהם שטרן' });   // P00004
  const csv = [
    'תאריך,סכום,שם,הערה,מספר עסקה,סטטוס',
    '15/10/2026,100,משה כהן,תשלום P00001,T1,הצליח',
    '15/10/2026,50,יעקב לוי,,T2,הצליח',          // שתי דרישות אפשריות — לא מנחשים
    '15/10/2026,70,אברהם  שטרן,,T3,',            // סטטוס ריק = הצליח; רווח כפול בשם
    '15/10/2026,99,משה כהן,P00001,T4,הצליח',      // אותה דרישה פעם שנייה — חשד לחיוב כפול
    '15/10/2026,55,אברהם שטרן,P00004,T7,הצליח',   // מספר נכון אבל סכום אחר
    '15/10/2026,70,אברהם שטרן,,T5,נדחה',
    'לא תאריך,10,x,,T6,',
  ].join('\n');
  const pv = P.previewImport(csv, s);
  assert.deepEqual(pv.mapping, { date: 'תאריך', amount: 'סכום', name: 'שם', ref: 'הערה', txId: 'מספר עסקה', status: 'סטטוס' });
  const m = P.matchReport(csv, pv.mapping, reqs);
  assert.deepEqual(m.matched.map(x => x.ref + ':' + x.how), ['P00001:ref', 'P00004:name']);
  assert.equal(m.unmatched.length, 3);
  assert.match(m.unmatched.find(u => u.txId === 'T2').reason, /2 דרישות/);
  assert.match(m.unmatched.find(u => u.txId === 'T4').reason, /חיוב כפול/);
  assert.match(m.unmatched.find(u => u.txId === 'T7').reason, /חיוב כפול|הסכום שונה/);
  assert.equal(m.skipped, 1, 'עסקה שנדחתה');
  assert.equal(m.errors.length, 1);
  // עסקה שכבר נקלטה — לא שוב
  reqs[0].status = 'paid'; reqs[0].payment = { txId: 'T1' };
  assert.equal(P.matchReport(csv, pv.mapping, reqs).skipped, 2);
});

async function setup() {
  const db = await initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-collect-')));
  const fresh = (n) => { delete require.cache[require.resolve('../modules/econ/services/' + n)]; };
  for (const n of ['collectService', 'accountingService', 'npoService', 'gemachService']) fresh(n);
  const S = (n, k) => require('../modules/econ/services/' + n)[k];
  const acc = S('accountingService', 'AccountingService');
  const npo = S('npoService', 'NpoService');
  const gem = S('gemachService', 'GemachService');
  const col = S('collectService', 'CollectService');
  for (const s of [acc, npo, gem, col]) s.initialize(db);
  return { db, acc, npo, gem, col };
}

test('מסלול מלא: חשבונית, תרומה וגמ"ח — דוח אחד רושם כל תשלום במקומו, וקליטה חוזרת לא כופלת', async () => {
  const { acc, npo, gem, col } = await setup();
  await npo.saveSettings({ orgName: 'עמותת חסדי אבות', regNumber: '580000003' });
  await col.saveSettings({ provider: 'cardcom', linkTemplate: 'https://pay.example.co.il/p?sum={amount}&ref={ref}' });
  const inv = await acc.createInvoice({ customer: 'משה כהן', items: [{ description: 'שירות', quantity: 1, unitPrice: 100 }] });
  await assert.rejects(col.createRequest({ kind: 'invoice', targetId: inv.id, amount: 1, payerName: 'משה כהן' }), /סכום החשבונית/);
  const r1 = await col.createRequest({ kind: 'invoice', targetId: inv.id, amount: inv.total, payerName: 'משה כהן' });
  await assert.rejects(col.createRequest({ kind: 'invoice', targetId: inv.id, amount: inv.total, payerName: 'משה כהן' }), /כבר קיימת דרישה/);
  const r2 = await col.createRequest({ kind: 'donation', amount: 180, payerName: 'יעקב לוי', description: 'תרומה לחג' });
  const loan = await gem.addLoan({ borrowerName: 'אברהם שטרן', borrowerId: '000000018', amount: 1200, installments: 12, issueDate: '2026-09-01' });
  await assert.rejects(col.createRequest({ kind: 'gemach', targetId: loan.id, seq: 1, amount: 101, payerName: 'אברהם שטרן' }), /גבוה מהנותר/);
  const r3 = await col.createRequest({ kind: 'gemach', targetId: loan.id, seq: 1, amount: 100, payerName: 'אברהם שטרן' });
  assert.match(r1.link, /sum=118\.00&ref=P00001$/);

  const csv = 'תאריך,סכום,שם,הערה,מספר עסקה\n'
    + `15/10/2026,${inv.total},משה כהן,${r1.ref},T1\n15/10/2026,180,יעקב לוי,,T2\n15/10/2026,100,אברהם שטרן,${r3.ref},T3\n`;
  const pv = await col.previewImport(csv);
  assert.equal(pv.match.matched.length, 3);
  const res = await col.importReport(csv, pv.mapping);
  assert.equal(res.recorded.length, 3);
  assert.deepEqual(res.failed, []);

  assert.equal((await acc.getInvoice(inv.id)).status, 'paid', 'החשבונית נגבתה ביומן');
  const donations = (await npo._load()).npo.donations;
  assert.equal(donations.length, 1);
  assert.equal(donations[0].amount, 180);
  assert.equal(donations[0].method, 'card');
  assert.ok(donations[0].receipt.number, 'הופקה קבלה');
  assert.equal(donations[0].reference, 'T2');
  assert.equal((await gem.getLoan(loan.id)).schedule[0].status, 'paid');
  const ov = await col.getOverview();
  assert.equal(ov.summary.paid, 3);
  assert.equal(ov.summary.open, 0);

  const again = await col.importReport(csv, pv.mapping);
  assert.equal(again.recorded.length, 0, 'קליטה חוזרת של אותו דוח לא רושמת פעמיים');
  assert.equal((await npo._load()).npo.donations.length, 1);
});

test('סימון ידני, ביטול, ותשלום שנכשל ברישום לא עוצר את השאר', async () => {
  const { acc, col } = await setup();
  const a = await acc.createInvoice({ customer: 'לקוח א', items: [{ description: 'x', quantity: 1, unitPrice: 50 }] });
  const b = await acc.createInvoice({ customer: 'לקוח ב', items: [{ description: 'y', quantity: 1, unitPrice: 80 }] });
  const ra = await col.createRequest({ kind: 'invoice', targetId: a.id, amount: a.total, payerName: 'לקוח א' });
  const rb = await col.createRequest({ kind: 'invoice', targetId: b.id, amount: b.total, payerName: 'לקוח ב' });
  const other = await col.createRequest({ kind: 'other', amount: 20, payerName: 'לקוח ג' });
  // חשבונית א שולמה בינתיים בדרך אחרת — הדוח לא יכשיל את חשבונית ב
  await acc.recordPayment(a.id, {});
  const csv = `date,amount,name,reference\n2026-10-15,${a.total},לקוח א,${ra.ref}\n2026-10-15,${b.total},לקוח ב,${rb.ref}\n`;
  const pv = await col.previewImport(csv);
  const res = await col.importReport(csv, pv.mapping);
  assert.deepEqual(res.recorded.map(x => x.ref), [rb.ref]);
  assert.equal(res.failed.length, 1);
  assert.match(res.failed[0].message, /כבר שולמה/);
  // סימון ידני
  const paid = await col.markPaid(other.id, { date: '2026-10-16', txId: 'A77' });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payment.source, 'manual');
  await assert.rejects(col.markPaid(other.id, {}), /אינה ממתינה/);
  await assert.rejects(col.cancelRequest(other.id), /רק דרישה שממתינה/);
  await col.cancelRequest(ra.id);
  assert.equal((await col.getOverview()).requests.find(r => r.id === ra.id).status, 'cancelled');
});

test('הרשאות וערוצים: הגדרות הקישור — מנהל בלבד; ביטול — מחיקה; התחום של התשלום נבדק ברישיון', () => {
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_collect__.js' : orig.call(this, req, ...rest); };
  require.cache['/__electron_stub_collect__.js'] = { id: '/__electron_stub_collect__.js', filename: '/__electron_stub_collect__.js', loaded: true,
    exports: { ipcMain: { handle() {} } } };
  try {
    const { permissionFor } = require('../modules/econ/ipc');
    assert.equal(permissionFor('collect:saveSettings'), 'users.manage', 'הקישור קובע לאן נכנס הכסף');
    assert.equal(permissionFor('collect:getOverview'), 'data.view');
    assert.equal(permissionFor('collect:getMessage'), 'data.view');
    assert.equal(permissionFor('collect:createRequest'), 'data.edit');
    assert.equal(permissionFor('collect:markPaid'), 'data.edit');
    assert.equal(permissionFor('collect:importReport'), 'data.edit');
    assert.equal(permissionFor('collect:cancelRequest'), 'data.delete');
  } finally { Module._resolveFilename = orig; }
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  assert.match(src, /COLLECT_DOMAIN = \{ invoice: 'acct:x', donation: 'npo:x', gemach: 'gemach:x' \}/);
  const LG = require('../shell/licensing/gate');
  const state = { mode: 'licensed', status: 'active', features: ['econ', 'econ.accounting'] };
  assert.equal(LG.checkChannel(state, 'acct:x', 'data.edit'), null);
  assert.ok(LG.checkChannel(state, 'npo:x', 'data.edit'), 'תרומה דרך הגבייה לא עוקפת רישיון עמותה');
});

test('מסך הגבייה רשום בכל המקומות: סרגל פנימי, קטלוג, כותרת, טעינה ורינדור', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'modules/econ/views/index.html'), 'utf8');
  const ui = require('./helpers/econ-ui').source();
  const catalog = require('../shell/catalog');
  assert.match(html, /data-view="collect"/);
  assert.match(ui, /'collect': 'גבייה וקישורי תשלום'/);
  assert.match(ui, /case 'collect':\r?\n\s+html = renderCollect\(data\)/);
  assert.match(ui, /if \(viewName === 'collect'\) attachCollectHandlers\(\)/);
  const all = JSON.stringify(catalog);
  assert.ok(all.includes('גבייה וקישורי תשלום') || fs.readFileSync(path.join(root, 'shell/catalog.js'), 'utf8').includes("view: 'collect'"));
});
