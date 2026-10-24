// בדיקת קוד 22.10.2026 — הערות מהבדיקה החוזרת (docs/audit-parts/audit-recheck-fixes.md, "הערות קטנות"):
// 1. מפתח הגיבוי האוטומטי נכתב בבת אחת, בלי קובץ זמני  2. זכות עיון: תיק משכנתא בתחום סגור, ותיקי שומה חסרים
// 3. ערכי src של תמונות בשמאות לא קודדו
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AutoBk = require('../shell/auto-backup');
const PD = require('../modules/econ/core/privacyDocs');
const { loadShamai } = require('./helpers/shamai-src');

const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* run-tests ינקה */ } } });

test('מפתח הגיבוי האוטומטי: כתיבה שנקטעה באמצע לא משאירה קובץ מפתח שבור', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-akey-')); dirs.push(dir);
  const file = path.join(dir, 'autobackup.key');
  const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('K:' + s), decryptString: (b) => { const t = Buffer.from(b).toString(); if (!t.startsWith('K:')) throw new Error('x'); return t.slice(2); } };
  const orig = { writeFileSync: fs.writeFileSync, writeSync: fs.writeSync };
  const half = (b) => Buffer.from(b).subarray(0, Math.max(1, Buffer.from(b).length >> 1));
  fs.writeFileSync = function (f, data, ...rest) { if (String(f) === file) { orig.writeFileSync.call(fs, f, half(data)); throw Object.assign(new Error('EIO'), { code: 'EIO' }); } return orig.writeFileSync.call(this, f, data, ...rest); };
  fs.writeSync = function (fd, data) { orig.writeSync.call(fs, fd, half(data)); throw Object.assign(new Error('EIO'), { code: 'EIO' }); };
  try { assert.throws(() => AutoBk.loadAutoBackupKey({ file, safeStorage: ss, create: true })); }
  finally { Object.assign(fs, orig); }
  assert.equal(fs.existsSync(file), false, 'אין קובץ מפתח חלקי');
  const k = AutoBk.loadAutoBackupKey({ file, safeStorage: ss, create: true });
  assert.equal(AutoBk.loadAutoBackupKey({ file, safeStorage: ss, create: false }), k, 'הניסיון הבא יוצר מפתח תקין');
});

const subjectData = () => ({
  realty: { clients: [{ id: 'k', name: 'יעקב לוי', role: 'buyer', idNumber: '000000018' }], deals: [{ id: 'd1', buyerClientId: 'k', mortgageCaseId: 'c1' }], orders: [] },
  mortgageAdvisor: { clients: [{ id: 'c1', name: 'יעקב לוי', phone: '050-1111111', realtyDealId: 'd1' }] },
  realEstate: { cases: [
    { id: 'r1', no: 7, rev: 1, status: 'final', effectiveDate: '2026-09-01', createdAt: '2026-08-20T08:00:00.000Z',
      client: { name: 'יעקב לוי', idNumber: '000000018', phone: '050-1111111' }, property: { address: 'רחוב רבי עקיבא 10', city: 'בני ברק' }, comparables: [] },
    { id: 'r2', no: 8, status: 'draft', client: { name: 'אחר', idNumber: '000000026' }, property: {}, comparables: [] },
  ] },
});

test('זכות עיון: תיק משכנתא מקושר — רק כשגם ייעוץ המשכנתאות פתוח ברישיון', () => {
  const titles = (opts) => PD.subjectReport(subjectData(), '000000018', opts).sections.map(s => s.title);
  assert.ok(!titles({ realty: true }).some(t => /ייעוץ משכנתאות/.test(t)), 'הייעוץ סגור — לא נכלל');
  assert.ok(titles({ realty: true, madv: true }).some(t => /ייעוץ משכנתאות/.test(t)));
});

test('זכות עיון: תיקי שמאות מקרקעין לפי ת"ז המזמין, רק כשהתחום פתוח', () => {
  const r = PD.subjectReport(subjectData(), '000000018', { realestate: true });
  const cs = r.sections.filter(s => /שמאות מקרקעין/.test(s.title));
  assert.equal(cs.length, 1);
  assert.equal(cs[0].title, 'תיק שמאות מקרקעין 7-1');
  const f = Object.fromEntries(cs[0].fields.map(x => [x.label, x.value]));
  assert.equal(f['כתובת הנכס'], 'רחוב רבי עקיבא 10, בני ברק');
  assert.equal(f['מצב התיק'], 'נעול');
  assert.equal(f['ת.ז'], '000000018');
  assert.ok(!PD.subjectReport(subjectData(), '000000018', {}).sections.some(s => /שמאות מקרקעין/.test(s.title)), 'התחום סגור — לא נכלל');
  assert.match(r.notCovered, /מזמיני שומה/);
});

test('זכות עיון: הערוץ מעביר את מצב הרישיון של הייעוץ ושל שמאות המקרקעין', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ipc.js'), 'utf8');
  const block = src.slice(src.indexOf("handleSave('privacy:exportSubjectPdf'"), src.indexOf("handle('privacy:addRequest'"));
  assert.ok(block.length > 0, 'הערוץ נמצא');
  assert.match(block, /madv: !LG\.checkChannel\(licenseState\(\), 'madv:getOverview'/);
  assert.match(block, /realestate: !LG\.checkChannel\(licenseState\(\), 'realestate:getOverview'/);
});

const EVIL = 'data:image/png;base64,AAAA" onerror="x" data-x="';
const GOOD = 'data:image/png;base64,iVBORw0KGgo=';

test('שמאות: תמונה בדוח התיק — רק data:image תקינה, ומקודדת', () => {
  const s = loadShamai(['core', 'calc', 'prices', 'ledger', 'report', 'purchase', 'casefile', 'case-report']);
  s.ctx.__photos = [EVIL, GOOD];
  const html = s.run(`caseItemHtml({ desc: 'טבעת', category: 'jewelry' }, { metals: [], stones: [], valueAg: 0 }, 1, false, __photos)`);
  assert.ok(!html.includes('onerror'), 'ערך עם מירכאות לא נכנס');
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.ok(html.includes(`src="${GOOD}"`));
});

test('שמאות: תמונה בקטלוג המלאי — רק data:image תקינה', () => {
  // inventory.js תלוי במודולים רבים (contacts.js ואחרים) — טוענים רק את printCatalog מתוכו
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'shamai', 'src', 'inventory.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function printCatalog(');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 3);
  assert.ok(start > 0 && fn.includes('openPrintPreview(html)'));
  const s = loadShamai(['core']);
  let printed = '';
  s.ctx.__print = (html) => { printed = html; };
  s.run(`var openPrintPreview = __print; var toast = () => {}; var OPP_CATEGORIES = []; var shortDate = (d) => d;`);
  s.run(fn);
  s.run(`state.opportunities = [{ id: 'a', name: 'שעון', status: 'watching', photo: ${JSON.stringify(EVIL)}, created: '2026-10-01' },
    { id: 'b', name: 'טבעת', status: 'watching', photo: ${JSON.stringify(GOOD)}, created: '2026-10-01' }]; printCatalog('all');`);
  assert.ok(printed.length > 0);
  assert.ok(!printed.includes('onerror'));
  assert.equal((printed.match(/<img /g) || []).length, 1);
});
