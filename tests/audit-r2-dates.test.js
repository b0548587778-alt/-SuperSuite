// בדיקה חוזרת 24.10.2026 — רגרסיות של עוזר ה-AI, שאריות UTC, בדיקת תאריך מול הלוח ומיפוי תיבות ההודעות בפרטיות.
// 1  „מעשרות” / „השלושים” אינם מספר מומצא (ובכל זאת „עשרות שקלים” נדחה)
// 2  „השנה הקודמת” = השנה שעברה (גם בשנת התרומות)
// 3  „3 החודשים האחרונים” — שלושה חודשים, לא רק הנוכחי
// 4  תאריך ישראלי („24.10.2026”) נבדק כתאריך שלם, לא כ„24.10” מומצא
// 5/7 ברירות מחדל של "היום" — מקומיות, לא toISOString
// 6  (מתאמן יחיד — הוסר עם מודול האימונים, שעבר למוצר נפרד)
// 8  2026-02-31 נדחה בכל הבדיקות שנשארו עם regex בלבד
// 9  תיבות ההודעות במיפוי המאגרים
process.env.TZ = 'Asia/Jerusalem'; // לפני כל שימוש בתאריך — כך „בין חצות ל-03:00” נבדק באמת
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const { checkGrounded, numberWords } = require(path.join(ROOT, 'shell/ai/grounding'));
const R = require(path.join(ROOT, 'shell/ai/rules'));
const DATES = require(path.join(ROOT, 'modules/econ/core/dates'));
const X = require(path.join(ROOT, 'modules/econ/core/exports'));
const PCN = require(path.join(ROOT, 'modules/econ/core/pcn874'));
const UF = require(path.join(ROOT, 'modules/econ/core/uniformFile'));
const MB = require(path.join(ROOT, 'modules/econ/core/dashboard'));
const HS = require(path.join(ROOT, 'modules/econ/core/homeSummary'));
const RI = require(path.join(ROOT, 'modules/econ/core/realtyInvest'));
const PR = require(path.join(ROOT, 'modules/econ/core/privacy'));
const PD = require(path.join(ROOT, 'modules/econ/core/privacyDocs'));

// ================= 1: מעשרות / השלושים =================
test('1: „מכספי מעשרות” — תשובה תקינה עוברת (המקרה מהבדיקה)', () => {
  const src = [{ total: '₪1,234.50' }];
  const r = checkGrounded('תרומתך בסך ₪1,234.50 מכספי מעשרות', src, { evidence: src });
  assert.deepEqual(r, { ok: true, invented: [], cited: true });
});

test('1: כל צורות המעשר ו„השלושים” אינן מספר; סכום במילים עדיין נדחה', () => {
  for (const w of ['מעשר', 'מעשרות', 'המעשר', 'ממעשר', 'ומעשרות', 'במעשרות', 'המעשרות', 'למעשר']) {
    assert.deepEqual(numberWords(`הפרשת ${w} — ₪1,234.50 בסך הכול`), [], w);
    assert.deepEqual(numberWords(`בסך 500 ${w}`), [], `${w} ליד ספרה`);
  }
  assert.deepEqual(numberWords('אזכרת השלושים תתקיים ב-15.11'), []);
  assert.deepEqual(numberWords('והשלושים יחול בעוד 20 יום'), []);
  // סכומים במילים — כמו קודם
  assert.deepEqual(numberWords('נכנסו עשרות שקלים'), ['עשרות']);
  assert.deepEqual(numberWords('בעשרות שקלים'), ['בעשרות']);
  assert.deepEqual(numberWords('יותר מעשרות שקלים'), ['מעשרות'], 'מעשרות + יחידה במילים — מספר');
  assert.deepEqual(numberWords('השלושים שקלים שנותרו'), ['השלושים']);
  assert.deepEqual(numberWords('נותרו שלושים שקלים'), ['שלושים']);
  assert.deepEqual(numberWords('יש לך שלושים חשבוניות'), ['שלושים'], 'בלי ה — עדיין מספר');
  assert.deepEqual(numberWords('מעשרים שקלים'), ['מעשרים'], '„מעשרים” אינו מעשר');
  assert.ok(numberWords('מעשרות אלפי שקלים').length > 0, 'מילת מספר נוספת — עדיין נדחה');
  assert.equal(checkGrounded('המעשר שלך: עשרות שקלים', []).ok, false);
});

// ================= 2 + 3: טווחים =================
test('2: „השנה הקודמת” ודומיה — השנה שעברה, גם בשנת התרומות; „השנה” — הנוכחית', () => {
  const today = '2026-10-24';
  for (const q of ['מה ההכנסות של השנה הקודמת?', 'כמה גבייתי בשנה הקודמת', 'הכנסות מהשנה הקודמת', 'רווח לשנה הקודמת', 'מה היה בשנה קודמת?', 'מע"מ בשנת המס הקודמת']) {
    assert.deepEqual(R.resolveRange(q, today), { from: '2025-01-01', to: '2025-12-31', label: 'שנת 2025' }, q);
  }
  for (const q of ['אילו תורמים תרמו השנה הקודמת?', 'מי תרם בשנה הקודמת', 'תרומות מהשנה הקודמת', 'תרומות שנה קודמת', 'תרומות אשתקד']) {
    assert.equal(R.donorYear(q, today), 2025, q);
  }
  assert.equal(R.donorYear('אילו תורמים תרמו השנה?', today), 2026);
  assert.equal(R.resolveRange('כמה הכנסתי השנה?', today).from, '2026-01-01');
  const a = R.runRules('אילו תורמים תרמו בשנה הקודמת?', { today, opened: { npo: true }, npo: { year: R.donorYear('אילו תורמים תרמו בשנה הקודמת?', today), donors: [] } });
  assert.match(a.text, /2025/);
});

test('3: „3 החודשים האחרונים” — שלושה חודשים; „בחודש הקודם” — החודש הקודם', () => {
  const today = '2026-10-24';
  assert.deepEqual(R.resolveRange('הכנסות 3 החודשים האחרונים', today), { from: '2026-08-01', to: today, label: '3 החודשים האחרונים' });
  assert.equal(R.resolveRange('הוצאות ב-12 החודשים האחרונים', today).from, '2025-11-01');
  assert.equal(R.resolveRange('הכנסות 3 חודשים', today).from, '2026-08-01', 'בלי ה — כמו קודם');
  assert.deepEqual(R.resolveRange('כמה גבייתי בחודש הקודם?', today), { from: '2026-09-01', to: '2026-09-30', label: 'ספטמבר 2026' });
  assert.equal(R.resolveRange('כמה גבייתי החודש?', today).from, '2026-10-01');
});

// ================= 4: תאריך ישראלי =================
test('4: „נכון ל-24.10.2026” — היום מהמקור מותר; תאריך שלא במקור או שאינו קיים — מומצא', () => {
  const ev = [{ total: '₪1,234.50' }];
  const src = ['כמה נותר לגבות?', '2026-10-24', ...ev];
  assert.deepEqual(checkGrounded('נכון ל-24.10.2026 נותרו ₪1,234.50 לגבייה', src, { evidence: ev }), { ok: true, invented: [], cited: true });
  assert.equal(checkGrounded('נכון ל-24/10/2026 נותרו ₪1,234.50', src, { evidence: ev }).ok, true, 'גם עם לוכסן');
  assert.equal(checkGrounded('נכון ל-01.10.2026 נותרו ₪1,234.50', src, { evidence: ev }).ok, false);
  assert.deepEqual(checkGrounded('נכון ל-25.10.2026 נותרו ₪1,234.50', src, { evidence: ev }).invented, ['25.10.2026']);
  assert.deepEqual(checkGrounded('נכון ל-31.02.2026 נותרו ₪1,234.50', ['31.02.2026', ...src], { evidence: ev }).invented, ['31.02.2026'], 'אינו קיים בלוח');
  // תאריך מתוצאת הכלי הוא ציטוט; התאריך של היום (מהשאלה) — לא
  const inv = [{ number: 7, date: '2026-10-01' }];
  const s2 = ['מתי הונפקה?', '2026-10-24', ...inv];
  assert.deepEqual(checkGrounded('החשבונית הונפקה ב-1.10.2026', s2, { evidence: inv }), { ok: true, invented: [], cited: true });
  assert.equal(checkGrounded('היום 24.10.2026', s2, { evidence: inv }).cited, false);
  // תאריך בתקופה (period) — אינו ציטוט, כמו שאר שדות התקופה
  const per = [{ period: { from: '2026-10-01' } }];
  assert.equal(checkGrounded('מאז 1.10.2026', ['q', ...per], { evidence: per }).cited, false);
  // „24.10” לבד (בלי שנה) — כמו קודם, מספר שנבדק
  assert.equal(checkGrounded('נכון ל-24.10', src, { evidence: ev }).ok, false);
});

// ================= 6: מתאמן יחיד =================
// ================= 5 + 7: "היום" מקומי =================
// 00:30 בלילה, 24.10.2026 בשעון ישראל — ב-UTC עדיין 23.10
const LOCAL_0030 = new Date(2026, 9, 24, 0, 30).getTime();
const LOCAL_DAY = '2026-10-24';
const UTC_DAY = new Date(LOCAL_0030).toISOString().slice(0, 10);
function atLocal0030(fn) {
  const real = Date.now;
  Date.now = () => LOCAL_0030;
  try { return fn(); } finally { Date.now = real; }
}

test('5/7: ברירת המחדל של "היום" — מקומית (תנועת תזרים, "הופק:" בסיכום השנתי לתורם)', async () => {
  assert.notEqual(UTC_DAY, LOCAL_DAY, 'אזור הזמן של הבדיקה הוחל — ב-UTC זה עדיין אתמול');
  assert.equal(atLocal0030(() => DATES.localDay()), LOCAL_DAY);
  const { PersonalFinanceService: pf } = require(path.join(ROOT, 'modules/econ/services/personalFinanceService'));
  assert.equal(atLocal0030(() => pf._validateItem('cashFlowEntries', { type: 'income', amount: 100 })).date, LOCAL_DAY);
  assert.throws(() => pf._validateItem('cashFlowEntries', { type: 'income', amount: 100, date: '2026-02-31' }), /תאריך לא תקין/);

  const st = { year: 2026, org: { name: 'עמותת חסדי אבות' }, donor: { name: 'משה כהן' }, receipts: [], total: 0 };
  const html = atLocal0030(() => X.renderDonorStatementHtml(st));
  assert.ok(html.includes(`הופק: ${LOCAL_DAY}`), 'התאריך המקומי');
  assert.ok(!html.includes(`הופק: ${UTC_DAY}`));
});

test('5/7: אין במודול הכלכלי "היום" לפי UTC (new Date().toISOString().slice(0, 10) / split(\'T\')[0])', () => {
  const bad = /new Date\(\)\.toISOString\(\)\s*\.\s*(?:slice\(0,\s*10\)|substring\(0,\s*10\)|split\(['"]T['"]\)\[0\])/;
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (bad.test(line)) hits.push(`${path.relative(ROOT, p)}:${i + 1}`); });
    }
  };
  walk(path.join(ROOT, 'modules/econ'));
  assert.deepEqual(hits, []);
});

// ================= 8: תאריך שקיים בלוח =================
test('8: dates.js — isDay מול הלוח, dayOr: ריק ← היום / ברירת מחדל, אחר ← שגיאה בעברית', () => {
  assert.equal(DATES.isDay('2026-02-28'), true);
  assert.equal(DATES.isDay('2028-02-29'), true, 'שנה מעוברת');
  for (const v of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-10-24', '2026-1-5', ' 2026-10-24', 20261024, null]) {
    assert.equal(DATES.isDay(v), false, String(v));
  }
  assert.equal(atLocal0030(() => DATES.dayOr(undefined)), LOCAL_DAY);
  assert.equal(atLocal0030(() => DATES.dayOr('')), LOCAL_DAY);
  assert.equal(DATES.dayOr('', null), null);
  assert.equal(DATES.dayOr('2026-10-01'), '2026-10-01');
  assert.throws(() => DATES.dayOr('2026-02-31'), /תאריך לא תקין/);
  assert.throws(() => DATES.dayOr('אתמול'), /תאריך לא תקין/);
});

test('8: core — pcn874, מבנה אחיד, לוח בוקר, מסך הבית ומס רכישה דוחים 2026-02-31', () => {
  assert.throws(() => PCN.validateVatDoc({ supplierTaxId: '000000018', docDate: '2026-02-31' }), /תאריך חשבונית הספק אינו תקין/);
  assert.equal(PCN.validateVatDoc({ supplierTaxId: '000000018', docDate: '2026-02-28' }).docDate, '2026-02-28');
  const business = { taxId: '000000018', name: 'עסק לדוגמה' };
  assert.throws(() => UF.buildUniformFile({ data: {}, business, range: { from: '2026-02-01', to: '2026-02-31' } }), /טווח תאריכים לא תקין/);
  assert.throws(() => UF.buildUniformFile({ data: {}, business, range: { from: '2026-02-30', to: '2026-03-31' } }), /טווח תאריכים לא תקין/);
  assert.throws(() => MB.morningBrief({}, '2026-02-31'), /תאריך לא תקין/);
  assert.throws(() => HS.homeSummary({}, '2026-02-31', {}), /תאריך לא תקין/);
  const table = { year: 2026, kind: 'single', bracketsText: '1000000, 0\nמעל, 3.5' };
  assert.equal(RI.validateTaxTable({ ...table, validFrom: '2026-01-16' }).validFrom, '2026-01-16');
  assert.throws(() => RI.validateTaxTable({ ...table, validFrom: '2026-02-31' }), /תאריך התחולה אינו תקין/);
});

// ---------- IPC: bizDay, שירותים, רשומות במסד ותיבות ההודעות במיפוי ----------
const handlers = {};
Module._resolveFilename_r2d = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_r2d__.js' : Module._resolveFilename_r2d.call(this, req, ...rest); };
require.cache['/__electron_stub_r2d__.js'] = {
  id: '/__electron_stub_r2d__.js', filename: '/__electron_stub_r2d__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } }
};
const ipc = require(path.join(ROOT, 'modules/econ/ipc'));
const { MortgageAdvisorService: madv } = require(path.join(ROOT, 'modules/econ/services/mortgageAdvisorService'));
const ev = (id) => ({ sender: { id } });
ipc.setErrorLogger(() => {});

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r2-dates-'));
let dirN = 0;
const closeDb = () => { try { const db = ipc.getDb(); if (db && db.db) db.db.close(); } catch { /* כבר סגור */ } };
test.after(() => { closeDb(); fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); });
const noNet = async () => { throw new Error('אין רשת בבדיקות'); };

async function freshEcon(opts = {}, prepare) {
  closeDb();
  const dir = path.join(TMP, 'd' + (++dirN));
  fs.mkdirSync(dir, { recursive: true });
  if (prepare) prepare(dir);
  await ipc.initEcon(dir, { relayUrl: '', fetchImpl: noNet, ...opts });
  await handlers['auth:setup'](ev(1), 'menahel', 'menahel-pass-long-1');
  await handlers['auth:login'](ev(1), 'menahel', 'menahel-pass-long-1');
}

test('8: IPC ושירותים — טווח הכרטסת, "היום" של עמותה / גמ"ח / ייעוץ משכנתאות ורשומה במסד', async () => {
  await freshEcon();
  await assert.rejects(handlers['acct:getCustomerLedger'](ev(1), 'משפחת כהן', { from: '2026-02-31' }), /תאריך לא תקין/);
  await assert.rejects(handlers['acct:getCustomerLedger'](ev(1), 'משפחת כהן', { from: '2026-01-01', to: '2026-02-30' }), /תאריך לא תקין/);
  const l = await handlers['acct:getCustomerLedger'](ev(1), 'משפחת כהן', { from: '', to: '' });
  assert.equal(l.from, null, 'ריק — בלי גבול');
  assert.equal((await handlers['acct:getCustomerLedger'](ev(1), 'משפחת כהן', { from: '2026-01-01', to: '2026-02-28' })).to, '2026-02-28');

  await assert.rejects(handlers['npo:getStandingOrders'](ev(1), '2026-02-31'), /תאריך לא תקין/);
  await assert.rejects(handlers['npo:getMemorials'](ev(1), '2026-02-31'), /תאריך לא תקין/);
  await assert.rejects(handlers['gemach:getOverview'](ev(1), '2026-02-31'), /תאריך לא תקין/);
  assert.ok(await handlers['gemach:getOverview'](ev(1)), 'בלי תאריך — היום');
  await assert.rejects(madv.getOverview(null, { today: '2026-02-31' }), /תאריך לא תקין/);

  const db = ipc.getDb();
  await assert.rejects(db.createRecord({ name: 'הכנסה', amount: 10, date: '2026-02-31' }), /תאריך לא תקין/);
  const rec = await db.createRecord({ name: 'הכנסה', amount: 10, date: '2026-02-28' });
  await assert.rejects(db.updateRecord(rec.id, { date: '2026-04-31' }), /תאריך לא תקין/);
  assert.equal((await db.updateRecord(rec.id, { date: '2026-04-30' })).date, '2026-04-30');
});

// ================= 9: תיבות ההודעות במיפוי =================
test('9: dataMap — תיבות ההודעות רק כשנמסרו, עם המידע, מקום השמירה, ההצפנה, תקופת השמירה והגיבוי', () => {
  const plain = PR.dataMap({}, { admin: 1 });
  assert.ok(!plain.rows.some(r => /הודעות/.test(r.area)), 'בלי תיבות — כמו קודם');
  const m = PR.dataMap({}, { admin: 1 }, { mailboxes: { platform: 'win', system: { count: 2 }, owner: { count: null } } });
  const sys = m.rows.find(r => r.area === 'הודעות בתוכנה — תיבת המערכת');
  const own = m.rows.find(r => r.area === 'הודעות בתוכנה — תיבת מנהל-העל');
  assert.equal(sys.count, 2);
  assert.equal(own.count, null, 'לא נספר');
  assert.match(sys.fields, /תוכן ההודעות/);
  assert.match(sys.storedAt, /messages\.bin/);
  assert.match(own.storedAt, /owner\/messages\.bin/);
  assert.match(sys.encryption, /AES-256-GCM/);
  assert.match(sys.retention, /60 יום/);
  assert.match(sys.retention, /עד שנמחקות/);
  assert.match(sys.backup, /נכלל בגיבוי המלא/);
  assert.match(own.backup, /לא נכלל בגיבוי של הארגון/);
  assert.match(own.access, /מנהל-העל/);
  assert.equal(sys.sensitivityLabel, PR.SENSITIVITY.regular);
  assert.ok(m.storage.some(s => s.startsWith('הודעות בתוכנה — תיבת המערכת') && /60 יום/.test(s) && /גיבוי/.test(s)));
  assert.equal(PR.suggestLevel(m).records, 2, 'תיבה שלא נספרה — 0 ברשומות');
  const android = PR.dataMap({}, {}, { mailboxes: { platform: 'android', system: { count: 0 } } });
  assert.match(android.rows.find(r => /תיבת המערכת/.test(r.area)).encryption, /בלי הצפנה נוספת/);
  // מסמך הגדרות המאגר: השורות והמקום — ו„—” למספר שלא נספר
  const html = PD.renderDefinitionHtml(m, PR.suggestLevel(m), { name: 'עמותת חסדי אבות' }, '2026-10-24');
  assert.ok(html.includes('הודעות בתוכנה — תיבת מנהל-העל'));
  assert.ok(html.includes('<td>—</td>'));
});

test('9: privacy:getMap — תיבת המערכת כשיש בה שיחות או כששרת ההודעות מוגדר; תיבת מנהל-העל כשהמצב הוגדר', async () => {
  // אופליין, תיבה ריקה, בלי מנהל-על — אין שורות הודעות
  await freshEcon({ chatStorage: { read: () => null, write: () => {} } });
  let map = await handlers['privacy:getMap'](ev(1));
  assert.ok(!map.rows.some(r => /הודעות בתוכנה/.test(r.area)));

  // שלוש הודעות משתי מערכות — שתי שיחות
  const msgs = [
    { mid: 'm1', peer: 'sys-a', dir: 'in', text: 'שלום וברכה', sentAt: 1 },
    { mid: 'm2', peer: 'sys-b', dir: 'out', text: 'תודה', sentAt: 2 },
    { mid: 'm3', peer: 'sys-a', dir: 'out', text: 'בשמחה', sentAt: 3 },
  ];
  await freshEcon({ chatStorage: { read: () => JSON.stringify(msgs), write: () => {} } });
  map = await handlers['privacy:getMap'](ev(1));
  const sys = map.rows.find(r => r.area === 'הודעות בתוכנה — תיבת המערכת');
  assert.equal(sys.count, 2);
  assert.match(sys.backup, /נכלל בגיבוי המלא/);
  assert.ok(!map.rows.some(r => /מנהל-העל/.test(r.area)));

  // שרת ההודעות מוגדר — התיבה מופיעה גם כשהיא ריקה; מצב מנהל-העל הוגדר (נעול) — שורה בלי מספר
  await freshEcon({ relayUrl: 'https://relay.example.test', chatStorage: { read: () => null, write: () => {} } }, (dir) => {
    fs.mkdirSync(path.join(dir, 'owner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'owner', 'root.key'), 'x');
  });
  map = await handlers['privacy:getMap'](ev(1));
  assert.equal(map.rows.find(r => r.area === 'הודעות בתוכנה — תיבת המערכת').count, 0);
  const own = map.rows.find(r => r.area === 'הודעות בתוכנה — תיבת מנהל-העל');
  assert.ok(own, 'מצב מנהל-העל הוגדר במחשב הזה');
  assert.equal(own.count, null, 'נעול — לא נספר');
  assert.match(own.backup, /לא נכלל/);
});

// 8 (השלמה): הבדיקות האחרונות שנשארו עם regex בלבד — מספר הקצאה, כללי התמהיל, מסך הבית ותקופת הדוחות בממשק
test('8: 2026-02-31 נדחה גם בספי ההקצאה, בכללי התמהיל, במסך הבית ובתקופת הדוחות', () => {
  const AL = require(path.join(ROOT, 'modules/econ/core/allocation'));
  // תאריך לא קיים ← הסף המחמיר (כמו תאריך חסר), לא סף של "פברואר"
  assert.equal(AL.thresholdFor('2026-02-31'), AL.thresholdFor('9999-12-31'));
  assert.equal(AL.thresholdFor('2026-02-28'), 1000000);
  const MR = require(path.join(ROOT, 'modules/econ/core/mortgageRules'));
  const id = MR.RULE_CATALOG[0].id;
  assert.throws(() => MR.defaultRuleSet.get(id, '2026-02-31'), /תאריך חישוב לא תקין/);
  assert.doesNotThrow(() => MR.defaultRuleSet.get(id, '2026-02-28'));
  assert.throws(() => new MR.RuleSet([{ ...MR.RULE_CATALOG[0], effectiveFrom: '2026-13-01' }]), /תאריך תחולה לא תקין/);
  // הממשק (סקריפט רגיל): isoOk
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/ui/accounting.js'), 'utf8');
  const m = /const isoOk = \(s\) => \{[\s\S]*?\n\};/.exec(src);
  assert.ok(m, 'isoOk בודקת מול הלוח');
  const isoOk = new Function(m[0] + '; return isoOk;')();
  assert.equal(isoOk('2026-02-31'), false);
  assert.equal(isoOk('2026-02-28'), true);
  assert.equal(isoOk('2026-2-28'), false);
  // מסך הבית ושירות העמותה — דרך העזר המשותף, בלי regex משלהם
  for (const f of ['modules/econ/core/homeSummary.js', 'modules/econ/services/npoService.js', 'modules/econ/core/allocation.js', 'modules/econ/core/mortgageRules.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /\/\^\d\{4\}-\d\{2\}-\d\{2\}\$\//, f + ': בלי בדיקת regex בלבד');
  }
});
