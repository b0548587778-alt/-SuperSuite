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
