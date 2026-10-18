// קבצים במבנה אחיד (PLAN.md 9.1, הוראות 1.31): אורך כל רשומה, קידוד, סכומים, ספירות, ZIP, דוח ההפקה,
// ומספור חשבוניות שלא חוזר אחורה. בלי רשת.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const UF = require('../modules/econ/core/uniformFile');
const A = require('../modules/econ/core/accounting');
const X = require('../modules/econ/core/exports');

const BUSINESS = { name: 'ספרי קודש בני ברק', taxId: '123456782', address: 'רחוב רבי עקיבא 1, בני ברק' };
const NOW = new Date(2026, 6, 15, 9, 5).getTime(); // 15.7.2026 09:05 שעון מקומי

function sampleData() {
  const accounts = A.DEFAULT_CHART.map(a => ({ ...a }));
  const journal = [
    { id: 'e0', date: '2025-12-31', description: 'יתרת פתיחה', createdAt: '2025-12-31T08:00:00.000Z',
      lines: [{ account: '1100', debit: 1000, credit: 0 }, { account: '3000', debit: 0, credit: 1000 }] },
    { id: 'e1', date: '2026-07-01', description: 'חשבונית 1', createdAt: '2026-07-01T08:00:00.000Z',
      lines: [{ account: '1200', debit: 1180, credit: 0 }, { account: '4000', debit: 0, credit: 1000 }, { account: '2200', debit: 0, credit: 180 }] },
    { id: 'e2', date: '2026-07-02', description: 'חשבונית 2', createdAt: '2026-07-02T08:00:00.000Z',
      lines: [{ account: '1200', debit: 59, credit: 0 }, { account: '4100', debit: 0, credit: 50 }, { account: '2200', debit: 0, credit: 9 }] },
    { id: 'e3', date: '2026-07-02', description: 'גבייה חשבונית 2', createdAt: '2026-07-02T09:00:00.000Z',
      lines: [{ account: '1100', debit: 59, credit: 0 }, { account: '1200', debit: 0, credit: 59 }] }
  ];
  const invoices = [
    { id: 'i1', number: 1, date: '2026-07-01', customer: 'ישיבת אור התורה', customerTaxId: '123456782', net: 1000, vat: 180, total: 1180,
      status: 'open', entryId: 'e1', createdAt: '2026-07-01T08:00:00.000Z',
      items: [{ description: 'סט שס', quantity: 2, unitPrice: 500, lineNet: 1000, account: '4000' }] },
    { id: 'i2', number: 2, date: '2026-07-02', customer: 'כולל חזון איש', net: 50, vat: 9, total: 59, kind: 'tax-invoice-receipt',
      status: 'paid', entryId: 'e2', paymentEntryId: 'e3', paidAt: '2026-07-02', createdAt: '2026-07-02T08:00:00.000Z',
      items: [{ description: 'כריכה', quantity: 1, unitPrice: 50, lineNet: 50, account: '4100' }] },
    { id: 'i3', number: 3, date: '2027-01-05', customer: 'מחוץ לטווח', net: 10, vat: 1.8, total: 11.8, status: 'open', items: [] }
  ];
  return { accounts, journal, invoices, settings: {} };
}

const build = (over = {}) => UF.buildUniformFile({ data: sampleData(), business: BUSINESS, range: { from: '2026-01-01', to: '2026-12-31' },
  now: NOW, user: 'יעקב', primaryId: '123456789012345', ...over });

// פירוק הקובץ לרשומות לפי CRLF
function records(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) { out.push(buf.subarray(start, i)); start = i + 2; i++; }
  }
  assert.equal(start, buf.length, 'הקובץ חייב להסתיים ב-CRLF');
  return out;
}
const ascii = (b, from, to) => Buffer.from(b.subarray(from - 1, to)).toString('latin1');

test('מבני הרשומות מסתכמים לאורכים שבטבלת סעיף 2.5', () => {
  for (const [kind, layout] of Object.entries(UF.LAYOUTS)) {
    assert.equal(layout.reduce((t, f) => t + f[2], 0), UF.RECORD_LENGTHS[kind], kind);
  }
});

test('כל רשומה בקבצים באורך המדויק, ומספרי הרשומות רצים', () => {
  const out = build();
  const data = records(out.dataTxt);
  data.forEach((r, i) => {
    const code = ascii(r, 1, 4);
    assert.equal(r.length, UF.RECORD_LENGTHS[code], `רשומה ${i + 1} (${code})`);
    assert.equal(Number(ascii(r, 5, 13)), i + 1);
    assert.equal(ascii(r, 14, 22), '123456782');
  });
  assert.equal(ascii(data[0], 1, 4), 'A100');
  assert.equal(ascii(data[data.length - 1], 1, 4), 'Z900');
  const ini = records(out.iniTxt);
  assert.equal(ini[0].length, 466);
  ini.slice(1).forEach(r => assert.equal(r.length, 19));
});

test('מזהה ראשי, קבוע מערכת וסך הרשומות זהים בין INI ל-BKMVDATA', () => {
  const out = build();
  const data = records(out.dataTxt);
  const [ini0, ...summary] = records(out.iniTxt);
  const z = data[data.length - 1];
  assert.equal(ascii(ini0, 34, 48), '123456789012345');
  assert.equal(ascii(data[0], 23, 37), '123456789012345');
  assert.equal(ascii(z, 23, 37), '123456789012345');
  assert.equal(ascii(data[0], 38, 45), '&OF1.31&');
  assert.equal(Number(ascii(ini0, 10, 24)), data.length);
  assert.equal(Number(ascii(z, 46, 60)), data.length);
  // רשומות סיכום: כמות לכל סוג רשומה
  const counted = Object.fromEntries(summary.map(r => [ascii(r, 1, 4), Number(ascii(r, 5, 19))]));
  const actual = {};
  data.forEach(r => { const c = ascii(r, 1, 4); actual[c] = (actual[c] || 0) + 1; });
  for (const [k, n] of Object.entries(counted)) assert.equal(n, actual[k], k);
  assert.deepEqual(Object.keys(counted).sort(), ['B100', 'B110', 'C100', 'D110', 'D120']);
});

test('נתיב ההפקה: OPENFRMT\\8 ספרות.שנה\\MMDDhhmm, ושדות קבועים ב-A000', () => {
  const out = build();
  assert.equal(out.relPath, 'OPENFRMT\\12345678.26\\07150905');
  const ini0 = records(out.iniTxt)[0];
  assert.equal(ascii(ini0, 134, 134), '2'); // 1011 — רב שנתית
  assert.equal(ascii(ini0, 135, 184).trim(), 'OPENFRMT\\12345678.26\\07150905');
  assert.equal(ascii(ini0, 185, 185), '2'); // 1013 — כפולה
  assert.equal(ascii(ini0, 396, 396), '1'); // 1029 — ISO-8859-8-i
  assert.equal(ascii(ini0, 367, 374), '20260101');
  assert.equal(ascii(ini0, 375, 382), '20261231');
  assert.equal(ascii(ini0, 383, 390), '20260715');
});

test('עברית בקידוד ISO-8859-8 בסדר לוגי, ניקוד מוסר ותו לא מוכר הופך ל-?', () => {
  assert.deepEqual(UF.toIso8859_8('אבת'), [0xe0, 0xe1, 0xfa]);
  assert.deepEqual(UF.toIso8859_8('שָׁלוֹם'), UF.toIso8859_8('שלום'));
  assert.deepEqual(UF.toIso8859_8('״₪'), [0x22, 0xf9]);
  assert.deepEqual(UF.toIso8859_8('€'), [0x3f]);
  const c100 = records(build().dataTxt).find(r => ascii(r, 1, 4) === 'C100');
  assert.deepEqual([...c100.subarray(57, 57 + 15)], UF.toIso8859_8('ישיבת אור התורה'));
});

test('שדות: נומרי באפסים משמאל, אלפאנומרי ברווחים מימין, סכום עם סימן; ערך ארוך מדי נכשל', () => {
  assert.equal(Buffer.from(UF.field('N', 5, 42)).toString(), '00042');
  assert.equal(Buffer.from(UF.field('X', 5, 'ab')).toString(), 'ab   ');
  assert.equal(Buffer.from(UF.field('S', 15, 123456)).toString(), '+00000000123456');
  assert.equal(Buffer.from(UF.field('S', 15, -5)).toString(), '-00000000000005');
  assert.throws(() => UF.field('N', 3, 1234), /ארוך מדי/);
  assert.throws(() => UF.field('N', 3, '1a'), /לא חוקיים/);
});

test('C100 ו-D110: סוג מסמך, סכומים באגורות, שיעור מע"מ וכמות; מחוץ לטווח — לא נכלל', () => {
  const data = records(build().dataTxt);
  const c = data.filter(r => ascii(r, 1, 4) === 'C100');
  assert.equal(c.length, 2);
  assert.equal(ascii(c[0], 23, 25), '305');
  assert.equal(ascii(c[1], 23, 25), '320');
  // 1219 סכום לפני הנחה (עמודה 288) ו-1223 סכום כולל מע"מ (עמודה 348)
  assert.equal(ascii(c[0], 288, 302), '+00000000100000');
  assert.equal(ascii(c[0], 348, 362), '+00000000118000');
  assert.equal(ascii(c[0], 253, 261), '123456782'); // 1215 מספר עוסק של הלקוח
  const d = data.find(r => ascii(r, 1, 4) === 'D110');
  assert.equal(ascii(d, 224, 240), '+0000000000020000'); // 2 יחידות × 10000
  assert.equal(ascii(d, 286, 289), '1800');
  assert.equal(data.filter(r => ascii(r, 1, 4) === 'D120').length, 1);
});

test('B100: חובה/זכות בשדה 1366 והסכום חיובי; B110: יתרת פתיחה וסכומי התקופה', () => {
  const data = records(build().dataTxt);
  const b = data.filter(r => ascii(r, 1, 4) === 'B100');
  assert.equal(b.length, 8); // 3+3+2 שורות; תנועת הפתיחה מ-2025 מחוץ לטווח
  b.forEach(r => assert.equal(ascii(r, 203, 203) === '1' || ascii(r, 203, 203) === '2', true));
  b.forEach(r => assert.equal(ascii(r, 207, 207), '+'));
  const cash = data.find(r => ascii(r, 1, 4) === 'B110' && ascii(r, 23, 37).trim() === '1100');
  assert.equal(ascii(cash, 278, 292), '+00000000100000'); // יתרת פתיחה 1,000
  assert.equal(ascii(cash, 293, 307), '+00000000005900'); // חובה 59
  const equity = data.find(r => ascii(r, 1, 4) === 'B110' && ascii(r, 23, 37).trim() === '3000');
  assert.equal(ascii(equity, 278, 292), '-00000000100000');
});

test('דוח ההפקה: סוגי נספח 1, כמות וסך; מבוטל נספר וסכומו לא', () => {
  const d = sampleData();
  d.invoices[0].status = 'cancelled';
  const out = UF.buildUniformFile({ data: d, business: BUSINESS, range: { from: '2026-01-01', to: '2026-12-31' }, now: NOW, primaryId: '123456789012345' });
  const byCode = Object.fromEntries(out.report.documents.map(x => [x.code, x]));
  assert.deepEqual([byCode[305].count, byCode[305].total], [1, 0]);
  assert.deepEqual([byCode[320].count, byCode[320].total], [1, 59]);
  assert.equal(byCode[400].count, 0);
  const html = X.renderUniformReportHtml(out.report);
  assert.match(html, /הפקת קבצים במבנה אחיד/);
  assert.match(html, /טרם נרשמה/);
  assert.match(html, /12345678\.26/);
});

test('ZIP תקין: קובץ BKMVDATA.TXT אחד שנפתח לתוכן המקורי', () => {
  const out = build();
  const z = out.zip;
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const nameLen = z.readUInt16LE(26);
  assert.equal(z.subarray(30, 30 + nameLen).toString(), 'BKMVDATA.TXT');
  const size = z.readUInt32LE(18);
  const inflated = zlib.inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size));
  assert.deepEqual(inflated, out.dataTxt);
  assert.equal(z.readUInt32LE(14), UF.crc32(out.dataTxt));
  if (zlib.crc32) assert.equal(UF.crc32(out.dataTxt), zlib.crc32(out.dataTxt));
});

test('ZIP בלי zlib (אנדרואיד): נשמר בלי דחיסה ועדיין תקין', () => {
  const Module = require('module');
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) { if (id === 'zlib') throw new Error('אין zlib'); return orig.apply(this, arguments); };
  let z;
  try { z = UF.zipSingle('BKMVDATA.TXT', Buffer.from('A100')); } finally { Module.prototype.require = orig; }
  assert.equal(z.readUInt16LE(8), 0);
  assert.equal(z.subarray(42, 46).toString(), 'A100');
  assert.equal(z.readUInt32LE(14), UF.crc32(Buffer.from('A100')));
});

test('קלט שגוי: בלי מספר עוסק תקין או טווח הפוך — שגיאה בעברית', () => {
  assert.throws(() => build({ business: { ...BUSINESS, taxId: '' } }), /מספר עוסק מורשה/);
  assert.throws(() => build({ business: { ...BUSINESS, taxId: '123456789' } }), /מספר עוסק מורשה/);
  assert.throws(() => build({ range: { from: '2026-12-31', to: '2026-01-01' } }), /טווח/);
  assert.match(UF.newPrimaryId(), /^[1-9]\d{14}$/);
});

test('מספור חשבוניות לא חוזר אחורה (מונה ב-settings.invoiceSeq), והשירות מפיק קבצים', async () => {
  assert.equal(A.nextInvoiceNumber([], 0), 1);
  assert.equal(A.nextInvoiceNumber([{ number: 2 }], 5), 6);
  assert.equal(A.nextInvoiceNumber([{ number: 7 }], 5), 8);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-uf-'));
  const { initializeDatabase } = require('../modules/econ/core/database');
  const { AccountingService } = require('../modules/econ/services/accountingService');
  const db = await initializeDatabase(dir);
  AccountingService.initialize(db);
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  const a = await AccountingService.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 100 }] });
  const b = await AccountingService.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 100 }] });
  assert.equal(b.number, a.number + 1);
  // גם אם רשומת החשבונית האחרונה נעלמה מהנתונים — המספר הבא לא חוזר על מספר שכבר הופק
  const data = await db.load();
  data.invoices = data.invoices.filter(i => i.id !== b.id);
  await db.save(data);
  const c = await AccountingService.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 100 }] });
  assert.equal(c.number, b.number + 1);
  // שמירת הגדרות לא מאפסת את המונה
  await AccountingService.saveSettings({ business: BUSINESS, vatRate: 0.18 });
  const d = await AccountingService.createInvoice({ customer: 'ישיבת אור התורה', date: '2026-07-01', items: [{ description: 'ספרים', quantity: 1, unitPrice: 100 }] });
  assert.equal(d.number, c.number + 1);
  const out = await AccountingService.getUniformFile({ from: '2026-01-01', to: '2026-12-31' }, { user: 'יעקב', now: NOW });
  assert.equal(out.report.documents.find(x => x.code === 305).count, 3);
  assert.equal(records(out.iniTxt)[0].length, 466);
});

test('ערוץ ההפקה: הרשאת ייצוא, חשיפה ב-preload וכפתור במסך הדוחות', () => {
  const ipc = fs.readFileSync(path.join(__dirname, '../modules/econ/ipc.js'), 'utf8');
  assert.match(ipc, /handle\('acct:exportUniformFile'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/preload.js'), 'utf8'), /exportUniformFile: \(range\) => ipcRenderer\.invoke\('acct:exportUniformFile', range\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/ui/accounting.js'), 'utf8'), /id="acctUniformFile"/);
  assert.match(fs.readFileSync(path.join(__dirname, '../modules/econ/ui/forms.js'), 'utf8'), /acctUniformFile/);
});
