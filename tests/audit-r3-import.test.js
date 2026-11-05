// סקירת קוד 2.11.2026 — ייבוא וייצוא: קליטת דוח סליקה בשמירה אחת, מנתח ה-CSV, דף בנק, ייבוא תרומות ומחירון
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeDatabase } = require('../modules/econ/core/database');

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function services() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r3-import-'));
  dirs.push(dir);
  const db = await initializeDatabase(dir);
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

test('קליטת דוח סליקה: שמירה אחת למסד לכל הדוח, ושורה שנכשלה באמצע לא משאירה שאריות', async () => {
  const { db, acc, npo, col } = await services();
  await npo.saveSettings({ orgName: 'עמותת חסדי אבות', regNumber: '580000003' });
  const reqs = [];
  for (let i = 0; i < 4; i++) {
    const inv = await acc.createInvoice({ customer: 'לקוח ' + i, items: [{ description: 'שירות', quantity: 1, unitPrice: 100 + i }] });
    reqs.push(await col.createRequest({ kind: 'invoice', targetId: inv.id, amount: inv.total, payerName: 'לקוח ' + i }));
  }
  const don = await col.createRequest({ kind: 'donation', amount: 180, payerName: 'יעקב לוי' });
  const amountOf = (r) => (r.amountAg / 100).toFixed(2);
  const csv = 'date,amount,name,reference,txid\n'
    + reqs.map((r, i) => `2026-10-15,${amountOf(r)},לקוח ${i},${r.ref},T${i}`).join('\n')
    + `\n2026-10-15,180,יעקב לוי,${don.ref},TD\n`;
  const pv = await col.previewImport(csv);
  assert.equal(pv.match.matched.length, 5);

  // השורה של התרומה נכשלת אחרי שהקבלה כבר "נשמרה" — הכישלון לא משאיר תרומה ולא פוגע בשאר
  const origSetPaid = col._setPaid;
  col._setPaid = async function (id, payment) {
    if (id === don.id) throw new Error('תקלה מדומה');
    return origSetPaid.call(this, id, payment);
  };
  let saves = 0;
  const origSave = db.save;
  db.save = async function (...a) { saves++; return origSave.apply(this, a); };
  let res;
  try { res = await col.importReport(csv, pv.mapping); }
  finally { db.save = origSave; col._setPaid = origSetPaid; }

  assert.equal(saves, 1, 'שמירה אחת למסד לכל הדוח');
  assert.deepEqual(res.recorded.map(r => r.ref).sort(), reqs.map(r => r.ref).sort());
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].ref, don.ref);
  assert.equal((await npo._load()).npo.donations.length, 0, 'התרומה של השורה שנכשלה לא נשמרה');
  const ov = await col.getOverview();
  assert.equal(ov.requests.find(r => r.id === don.id).status, 'open');
  for (const r of reqs) assert.equal(ov.requests.find(x => x.id === r.id).status, 'paid');
  for (const inv of (await acc.getInvoices())) assert.equal(inv.status, 'paid');
});

test('התאמת בנק: כל רשומת יומן וחשבונית נבדקות פעם אחת לתצוגה (אינדקס לפי סכום), וההצעות לא השתנו', () => {
  const BRk = require('../modules/econ/core/bankReconcile');
  let entryReads = 0, invReads = 0;
  const journal = [], invoices = [];
  for (let i = 0; i < 40; i++) {
    const lines = [{ account: '1000', debit: 100 + i, credit: 0 }, { account: '4000', debit: 0, credit: 100 + i }];
    journal.push({ id: 'e' + i, date: '2026-10-01', description: 'גבייה ' + i, get lines() { entryReads++; return lines; } });
    invoices.push({ id: 'i' + i, number: 1000 + i, customer: 'לקוח ' + i, date: '2026-09-20', status: 'open', get balance() { invReads++; return 200 + i; } });
  }
  const bankLines = [];
  for (let i = 0; i < 30; i++) bankLines.push({ key: 'k' + i, date: '2026-10-02', amountAg: (i % 2 ? 100 + i : 200 + i) * 100, description: 'לקוח ' + i, reference: '' });
  const v = BRk.view({ journal, bankLines }, invoices);
  assert.ok(entryReads <= journal.length, `רשומות יומן נקראו ${entryReads} פעמים`);
  assert.ok(invReads <= invoices.length, `חשבוניות נקראו ${invReads} פעמים`);
  const byKey = new Map(v.lines.map(l => [l.key, l]));
  assert.equal(byKey.get('k1').suggestions[0].id, 'e1');
  assert.equal(byKey.get('k2').suggestions[0].id, 'i2');
  // suggest בלי אינדקס — אותה תוצאה
  assert.deepEqual(BRk.suggest(bankLines[2], { invoices, journal }).map(s => s.id), byKey.get('k2').suggestions.map(s => s.id));
});

// ---------- מנתח ה-CSV ומספרי שורות ----------
const F = require('../modules/econ/core/features');
const BR = require('../modules/econ/core/bankReconcile');
const DI = require('../modules/econ/core/donationImport');
const DP = require('../modules/econ/core/dataPorts');

test('CSV: מרכאה באמצע תא לא מצוטט (בע"מ, ש"ח, גמ"ח) היא טקסט — השורות לא מתאחדות', () => {
  const rows = F.parseCsv('name,note\nכהן בע"מ,ש"ח 100\nגמ"ח אבות,x\n"מצוטט, עם פסיק",y\n');
  assert.deepEqual(rows, [['name', 'note'], ['כהן בע"מ', 'ש"ח 100'], ['גמ"ח אבות', 'x'], ['מצוטט, עם פסיק', 'y']]);
});

test('הודעות שגיאה בייבוא — מספר השורה הפיזית בקובץ (אחרי שורה ריקה ותא רב-שורתי)', () => {
  const csv = 'name,kind,cost\n\nקפה,goods,10\n"תה\nירוק",goods,abc\nעוגה,goods,zz\n';
  assert.deepEqual(F.parseProductsCsv(csv).errors.map(e => e.line), [4, 6]);
  // ייבוא כללי (אנשי קשר)
  const imp = DP.parseImport('contacts', 'שם,טלפון\n\n"משה\nכהן",050\n,052\n', { contacts: [] });
  assert.deepEqual(imp.errors.map(e => e.line), [5]);
  // דף בנק
  const bank = BR.buildLines('תאריך,סכום,תיאור\n\n01/10/2026,100,"העברה\nמלקוח"\n02/10/2026,abc,x\n', { date: 'תאריך', amount: 'סכום', description: 'תיאור' });
  assert.deepEqual(bank.errors.map(e => e.line), [5]);
});

test('דף בנק: פסיק עשרוני נקרא כמו בייבוא התרומות — לא פי 100', () => {
  const csv = 'תאריך,סכום\n01/10/2026,"12,5"\n02/10/2026,"1.234,56"\n03/10/2026,"-1.234,56"\n04/10/2026,"1,234.50"\n05/10/2026,"1,234"\n';
  const r = BR.buildLines(csv, { date: 'תאריך', amount: 'סכום' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.lines.map(l => l.amountAg), [1250, 123456, -123456, 123450, 123400]);
  assert.equal(BR.parseSignedAg('0,00'), 0);
  assert.ok(Number.isNaN(BR.parseSignedAg('1.234')), 'דו-משמעי — לא מנחשים');
});

test('ייבוא תרומות: תרומות זהות אמיתיות באותו קובץ נקלטות, וקליטה חוזרת לא מכפילה', () => {
  const csv = 'תאריך,שם,סכום\n01/10/2026,משה כהן,180\n01/10/2026,משה כהן,180\n';
  const mapping = { date: 'תאריך', donorName: 'שם', amount: 'סכום' };
  const first = DI.buildRecords(csv, { source: 'nedarim', mapping }, [], {});
  assert.equal(first.records.length, 2);
  assert.equal(first.skipped, 0);
  const again = DI.buildRecords(csv, { source: 'nedarim', mapping }, first.records, {});
  assert.equal(again.records.length, 0);
  assert.equal(again.skipped, 2);
  const more = DI.buildRecords(csv + '01/10/2026,משה כהן,180\n', { source: 'nedarim', mapping }, first.records, {});
  assert.equal(more.records.length, 1, 'המופע השלישי — חדש');
});

test('ייבוא מחירון: ייבוא חוזר לא מכפיל מוצרים, והגרש של הגנת הנוסחאות מוסר', async () => {
  const { acc } = await services();
  const csv = "name,kind,cost,markupPct\nקפה,goods,10,50\n'-הנחה מיוחדת,service,5,0\nקפה,goods,12,50\n";
  const first = await acc.importProducts(csv);
  assert.equal(first.added, 2);
  assert.equal(first.skipped, 1, 'כפילות בתוך הקובץ');
  const again = await acc.importProducts(csv);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 3);
  const names = (await acc._load()).products.map(p => p.name).sort();
  assert.deepEqual(names, ['-הנחה מיוחדת', 'קפה'].sort());
});
