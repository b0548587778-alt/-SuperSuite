// חבילת סוף שנה לתורמים: סיכום שנתי לכל התורמים בבת אחת (PDF אחד, עמוד לתורם) ורשימת דיוור (CSV).
// בלי תורמים בעילום שם; סינון לפי סכום מינימלי ו"רק סעיף 46"; הסכומים באגורות כמו בסיכום הבודד
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const core = p => require(path.join(__dirname, '..', 'modules', 'econ', 'core', p));
const N = core('npo');
const X = core('exports');

const settings = { orgName: 'עמותת חסד ואמת', regNumber: '580000000', sec46Number: '4455', funds: [] };
const don = (n, date, amount, extra = {}) => ({ id: 'd' + n, date, donorName: 'יעקב לוי', donorId: '123456782', donorAddress: 'רחוב הרב קוק 5, בני ברק', amount,
  method: 'transfer', status: 'active', receipt: { number: n, sec46: true, fundName: 'כללי' }, ...extra });

const donations = [
  don(1, '2026-01-10', 100.10),
  don(2, '2026-06-01', 200.20, { receipt: { number: 2, sec46: false, fundName: 'כללי' } }),
  don(3, '2026-07-01', 999, { status: 'cancelled' }),
  don(4, '2025-12-31', 50),
  don(5, '2026-03-01', 70, { donorId: '000000018', donorName: 'אברהם כהן', donorAddress: '', receipt: { number: 5, sec46: false, fundName: 'כללי' } }),
  { id: 'n1', date: '2026-02-02', donorName: 'משה <b>כהן</b>', donorId: '', amount: 36, method: 'cash', status: 'active', receipt: { number: 6, sec46: true } },
  { id: 'a1', date: '2026-04-04', donorName: 'עילום שם', donorId: '', donorType: 'anonymous', amount: 500, method: 'cash', status: 'active', receipt: { number: 7, sec46: false } },
];

test('כל התורמים של השנה, לפי סכום יורד; בלי עילום שם ובלי מבוטלות; הסכומים זהים לסיכום הבודד', () => {
  const pack = N.yearEndPack(donations, settings, 2026);
  assert.deepEqual(pack.statements.map(s => s.donor.name), ['יעקב לוי', 'אברהם כהן', 'משה <b>כהן</b>']);
  assert.equal(pack.skipped.anonymous, 1);
  const yaakov = pack.statements[0];
  assert.deepEqual(yaakov, { ...N.donorAnnualStatement(donations, settings, 'id:123456782', 2026), key: 'id:123456782', phone: '' });
  assert.deepEqual(pack.totals, { donors: 3, total: 406.3, sec46Total: 136.1 });
});

test('סינון: סכום מינימלי ורק סעיף 46', () => {
  const min = N.yearEndPack(donations, settings, 2026, { minTotal: '70' });
  assert.deepEqual(min.statements.map(s => s.donor.name), ['יעקב לוי', 'אברהם כהן']);
  assert.equal(min.skipped.belowMin, 1);
  const s46 = N.yearEndPack(donations, settings, 2026, { onlySec46: true });
  assert.deepEqual(s46.statements.map(s => s.donor.name), ['יעקב לוי', 'משה <b>כהן</b>']);
  assert.equal(s46.skipped.noSec46, 1);
  assert.equal(N.yearEndPack(donations, settings, 2026, { onlySec46: 'כן' }).statements.length, 3, 'רק true מסנן');
  assert.equal(N.yearEndPack(donations, settings, 2027).statements.length, 0);
  assert.throws(() => N.yearEndPack(donations, settings, 2026, { minTotal: '-5' }), /הסכום המינימלי/);
  assert.throws(() => N.yearEndPack(donations, settings, 'abc'), /שנה לא תקינה/);
});

test('PDF: עמוד לכל תורם, שבירת עמוד בין תורמים, ושמות עוברים esc', () => {
  const html = X.renderYearEndPackHtml(N.yearEndPack(donations, settings, 2026));
  assert.equal((html.match(/<section class="ye-page">/g) || []).length, 3);
  assert.match(html, /\.ye-page \{ page-break-after: always/);
  assert.match(html, /\.ye-page:last-child \{ page-break-after: auto/);
  assert.match(html, /משה &lt;b&gt;כהן&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>כהן<\/b>/);
  assert.equal((html.match(/סיכום תרומות לשנת 2026/g) || []).length, 3);
});

test('רשימת דיוור: שורה לכל תורם בחבילה, עם כתובת וסכומים; CSV מנוטרל מנוסחאות', () => {
  const t = N.yearEndMailingRows(N.yearEndPack(donations, settings, 2026));
  assert.deepEqual(t.headers, ['שם', 'ת.ז / ח.פ', 'כתובת', 'טלפון', 'מספר קבלות', 'סה"כ תרומות', 'מוכר לסעיף 46']);
  assert.deepEqual(t.rows[0], ['יעקב לוי', '123456782', 'רחוב הרב קוק 5, בני ברק', '', 2, 300.3, 100.1]);
  assert.equal(t.name, 'רשימת-דיוור-תורמים-2026');
  const csv = X.toCsv(t.headers, [['=HYPERLINK("x")', '', '', '', 1, 1, 0]]);
  assert.doesNotMatch(csv, /\n=HYPERLINK/, 'ערך שמתחיל ב-= מנוטרל');
});

// ערוצים: הרשאה, preload, וחבילה ריקה נדחית לפני חלון השמירה
const handlers = {};
let savePath = null;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_yearend__.js' : origResolve.call(this, req, ...rest); };
require.cache['/__electron_stub_yearend__.js'] = {
  id: '/__electron_stub_yearend__.js', filename: '/__electron_stub_yearend__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => (savePath ? { canceled: false, filePath: savePath } : { canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  }
};
const ipc = require('../modules/econ/ipc');
const ev = { sender: { id: 91 } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-yearend-'));

test.before(async () => {
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev, 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev, 'menahel', 'menahel-strong-pass-1');
  await handlers['npo:saveSettings'](ev, { orgName: 'עמותת חסד לדוגמה', vatStatus: 'exempt' });
});

test('ערוצים: הרשאת ייצוא, חשיפה ב-preload, ורשימת דיוור נשמרת כ-CSV', async () => {
  assert.equal(ipc.permissionFor('npo:exportYearEndPackPdf'), 'data.export');
  assert.equal(ipc.permissionFor('npo:exportYearEndListCsv'), 'data.export');
  const preload = fs.readFileSync(path.join(__dirname, '../modules/econ/preload.js'), 'utf8');
  assert.match(preload, /exportNpoYearEndPackPdf: \(year, opts\) => ipcRenderer\.invoke\('npo:exportYearEndPackPdf', year, opts\)/);
  assert.match(preload, /exportNpoYearEndListCsv: \(year, opts\) => ipcRenderer\.invoke\('npo:exportYearEndListCsv', year, opts\)/);

  await assert.rejects(handlers['npo:exportYearEndListCsv'](ev, 2026, {}), /אין תורמים לחבילה/);
  await handlers['npo:addDonation'](ev, { date: '2026-05-05', donorName: 'יצחק שטרן', donorId: '000000018', amount: 180, method: 'cash' });
  savePath = path.join(dir, 'list.csv');
  const r = await handlers['npo:exportYearEndListCsv'](ev, 2026, { minTotal: '0' });
  assert.equal(r.ok, true);
  const csv = fs.readFileSync(savePath, 'utf8');
  assert.match(csv, /יצחק שטרן/);
  assert.match(csv, /180/);
});
