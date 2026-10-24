// בדיקות רגרסיה לסקירת הקוד (docs/CODE-AUDIT-2026-10-23.md) — עמותה, גמ"ח, חסד, משכנתאות ו"היום" בשירותים:
// ממצאים 9 (היום לפי UTC), 11 (פסיק עשרוני בייבוא), 12 (הכפלה כפולה בקמפיין), 13 (שדות בדוח המשכנתא),
// 53 (תווים זרים במכתב), 54 (תמיכות שנדחו כ"התקבלו"), והנמוכים: מכתב תודה, כותרת ה-PDF, עוסק פטור בעמלה.
process.env.TZ = 'Asia/Jerusalem';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const econ = (p) => require(path.join(ROOT, 'modules/econ', p));
const SO = econ('core/standingOrders');
const GX = econ('core/gemachExtra');
const C = econ('core/chesed');
const M = econ('core/mortgageAdvisor');
const E = econ('core/mixEngine');
const P = econ('core/people');
const N = econ('core/npo');
const DI = econ('core/donationImport');
const CL = econ('core/collect');
const CMP = econ('core/campaigns');
const MR = econ('core/mortgageReport');
const L = econ('core/npoLetters');
const { NpoService } = econ('services/npoService');
const { GemachService } = econ('services/gemachService');
const { MortgageAdvisorService } = econ('services/mortgageAdvisorService');
const { MortgageLabService } = econ('services/mortgageLabService');

const tmpDirs = [];
test.after(() => {
  // המסד של בדיקת ה-IPC פתוח — סוגרים אותו, אחרת Windows לא מאפשר למחוק את התיקייה
  try { const d = ipc.getDb(); if (d && d.db) d.db.close(); } catch { /* כבר סגור */ }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* run-tests מוחק את התיקייה הזמנית בסוף */ } }
});

// ---------- 9. "היום" מקומי ----------
// 1.11.2026 בשעה 00:30 בישראל = 31.10 בשעה 22:30 UTC: toISOString עדיין מחזיר 31.10
const RealDate = Date;
const NIGHT = RealDate.parse('2026-10-31T22:30:00Z');
async function atNight(fn) {
  class NightDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [NIGHT])); }
    static now() { return NIGHT; }
  }
  global.Date = NightDate;
  try { return await fn(); } finally { global.Date = RealDate; }
}
// מסד מדומה: load מחזיר עותק, save שומר עותק (כמו המסד האמיתי)
const fakeDb = (data = {}) => ({
  data,
  async load() { return JSON.parse(JSON.stringify(this.data)); },
  async save(d) { this.data = JSON.parse(JSON.stringify(d)); }
});

test('9: הסביבה של הבדיקה — בחצות וחצי בישראל UTC עדיין ביום הקודם', async () => {
  await atNight(() => {
    assert.equal(new Date().toISOString().slice(0, 10), '2026-10-31');
    assert.equal(new Date().getDate(), 1, 'אזור הזמן של הבדיקה הוא ישראל');
  });
});

test('9: ברירות המחדל של התאריך בליבה — היום המקומי (1.11), לא אתמול לפי UTC', async () => {
  await atNight(() => {
    assert.equal(SO.validateStandingOrder({ donorName: 'משה כהן', amount: 100 }).startMonth, '2026-11', 'הוראת קבע שנוצרה ב-1.11 — חודש התחלה נובמבר');

    const app = GX.validateApplication({ borrowerName: 'יעקב לוי', amount: 1000, installments: 10, guarantorsText: 'משה, 000000018, 050' });
    assert.equal(app.requestDate, '2026-11-01');
    assert.equal(app.issueDate, '2026-11-01');
    const item = { id: 'i1', ...GX.validateItem({ name: 'עגלת תינוק', deposit: 200 }) };
    const lending = GX.validateLending({ borrowerName: 'שרה' }, item, []);
    assert.equal(lending.date, '2026-11-01');
    assert.equal(GX.applyReturn(lending, {}).returnedAt, '2026-11-01');

    const round = { id: 'r1', status: 'open', ...C.validateRound({ name: 'קמחא דפסחא' }), allocations: [{ beneficiaryId: 'b1', units: 1 }] };
    assert.equal(round.date, '2026-11-01');
    assert.equal(C.markDelivered(round, 'b1', true).allocations[0].deliveredAt, '2026-11-01');

    const offer = M.validateOffer({ clientId: 'c1', bank: 'בנק א', tracks: [{ type: 'prime', amount: 500000, rate: 5, years: 25 }] }, [{ id: 'c1' }]);
    assert.equal(offer.date, '2026-11-01');

    const mix = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 500000, termMonths: 300, annualRate: 0.045 }], { forecast: E.DEMO_FORECAST });
    assert.equal(mix.assumptions.asOf, '2026-11-01');
    assert.equal(MortgageLabService._ctx({ mortgageLab: { verifications: [] } }).asOf, '2026-11-01', 'מעבדת התמהיל');

    // תשלום שמועדו 31.10 ולא שולם — בפיגור ב-1.11 (לפי UTC "היום" היה עדיין 31.10, בלי פיגור)
    const loan = { id: 'L1', borrowerName: 'אברהם', borrowerId: '000000018', amount: 100, installments: 1, issueDate: '2026-10-01', status: 'active',
      schedule: [{ seq: 1, dueDate: '2026-10-31', amountAg: 10000, paidAg: 0 }] };
    const ref = P.collect({ gemach: { loans: [loan] } }, { sources: ['gemach'] }).find(x => x.role === 'borrower').ref;
    assert.equal(ref.lateCount, 1);
  });
});

test('9: השירותים — בלי "היום" מה-IPC מחושב היום המקומי', async () => {
  await atNight(async () => {
    NpoService.initialize(fakeDb({ npo: { standingOrders: [{ id: 's1', donorName: 'משה כהן', amount: 100, dayOfMonth: 1, startMonth: '2026-11', history: [] }],
      campaigns: [{ id: 'c1', name: 'בניין בית המדרש', goal: 1000, startDate: '2026-11-01', endDate: '2026-11-30', ambassadors: [] }] } }));
    const so = await NpoService.getStandingOrders();
    assert.equal(so.month, '2026-11');
    assert.equal(so.rows[0].status, 'due', 'ההוראה כבר התחילה — לא "עתידית"');
    const ov = await NpoService.getOverview(2026);
    assert.equal(ov.campaigns[0].status, 'active', 'קמפיין שמתחיל היום — פעיל');

    const loan = { id: 'L1', borrowerName: 'אברהם', borrowerId: '000000018', amount: 100, installments: 1, issueDate: '2026-10-01', status: 'active',
      schedule: [{ seq: 1, dueDate: '2026-10-31', amountAg: 10000, paidAg: 0 }], guarantors: [] };
    GemachService.initialize(fakeDb({ gemach: { loans: [loan] } }));
    const g = await GemachService.getOverview();
    assert.equal(g.loans[0].lateCount, 1);

    MortgageAdvisorService.initialize(fakeDb({}));
    const c = await MortgageAdvisorService.createClient({ name: 'משפחת גולד', requestedAmount: 1000000 }, null);
    const TR = [{ type: 'FIXED_UNLINKED', repayment: 'SPITZER', share: 100, years: 25, ratePct: 4.8 }];
    const saved = await MortgageAdvisorService.saveApprovals(c.id, [{ lender: 'בנק א', validUntil: '2026-10-31', tracks: TR }], null);
    assert.equal(saved[0].receivedAt, '2026-11-01', 'תאריך קבלת האישור — היום המקומי');
    assert.equal(saved[0].expired, true, 'אישור שתוקפו 31.10 — פג ב-1.11');
    const chosen = await MortgageAdvisorService.chooseApproval(c.id, saved[0].id, null);
    assert.equal(chosen[0].expired, true);
    const madv = await MortgageAdvisorService.getOverview(null);
    assert.equal(madv.clients[0].approvals[0].expired, true);
  });
});

// ---------- 11. סכום בייבוא: פסיק עשרוני ----------
test('11: פסיק עשרוני ומפרידי אלפים — "100,50" הוא 100.50, לא 10,050', () => {
  assert.equal(DI.parseAmount('100,50'), 100.5);
  assert.equal(DI.parseAmount('100,5'), 100.5);
  assert.equal(DI.parseAmount('1.234,56'), 1234.56);
  assert.equal(DI.parseAmount('1,234.56'), 1234.56);
  assert.equal(DI.parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(DI.parseAmount('₪1,800.50'), 1800.5);
  assert.equal(DI.parseAmount('1,234'), 1234, 'פסיק ואחריו 3 ספרות — אלפים');
  assert.equal(DI.parseAmount('10.25'), 10.25);
  // דו-משמעי — לא מנחשים
  assert.equal(DI.parseAmount('1.234'), null);
  assert.match(DI.amountIssue('1.234'), /דו-משמעי/);
  assert.equal(DI.parseAmount('12,34.56'), null);
  assert.match(DI.amountIssue('abc'), /סכום לא תקין/);
});

test('11: ייבוא תרומות — "100,50" נקלט כ-100.50, ושורה דו-משמעית נדחית עם הסבר', () => {
  const csv = 'תאריך,שם,סכום\n01/10/2026,משה כהן,"100,50"\n02/10/2026,יעקב לוי,1.234\n';
  const { records, errors } = DI.buildRecords(csv, { source: 'nedarim', mapping: { date: 'תאריך', donorName: 'שם', amount: 'סכום' } }, [], { orgName: 'עמותה' });
  assert.equal(records.length, 1);
  assert.equal(records[0].amount, 100.5);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 3);
  assert.match(errors[0].message, /דו-משמעי/);
});

test('11: גם התאמת דוח הסליקה (collect) קוראת פסיק עשרוני נכון', () => {
  const r = CL.matchReport('תאריך,סכום,אסמכתא\n01/10/2026,"100,50",P00001\n', { date: 'תאריך', amount: 'סכום', ref: 'אסמכתא' },
    [{ id: 'q1', ref: 'P00001', status: 'open', amountAg: 10050, createdAt: '2026-09-01T10:00:00.000Z' }]);
  assert.deepEqual(r.errors, []);
  const row = [...r.matched, ...r.unmatched][0];
  assert.ok(row, 'השורה נקראה');
  assert.equal(row.amountAg, 10050);
});

// ---------- 12. קמפיין: תרומות המכפיל לא נספרות פעמיים ----------
test('12: 50 אלף מתורמים ו-50 אלף מהמכפיל — סך 100 אלף, לא 150 אלף', () => {
  const c = { id: 'c1', ...CMP.validateCampaign({ name: 'בניין בית המדרש', goal: 200000, startDate: '2026-10-01', endDate: '2026-10-31', matchDonor: 'קרן משפחת ברגר', matchRatio: 1, matchCap: 50000 }) };
  const donors = [{ id: 'd1', campaignId: 'c1', donorName: 'משה כהן', amount: 30000 }, { id: 'd2', campaignId: 'c1', donorName: 'יעקב לוי', amount: 20000 }];
  const before = CMP.progress(c, donors, '2026-10-15');
  assert.equal(before.raised, 50000);
  assert.equal(before.matched, 50000);
  assert.equal(before.total, 100000, 'ההתחייבות של המכפיל נספרת לפני שהכסף הגיע');
  const paid = CMP.progress(c, [...donors, { id: 'd3', campaignId: 'c1', donorName: ' קרן  משפחת ברגר ', amount: 50000 }], '2026-10-15');
  assert.equal(paid.raised, 100000, 'נאסף בפועל — כולל כסף המכפיל');
  assert.equal(paid.matched, 50000, 'ההכפלה על תרומות האחרים בלבד');
  assert.equal(paid.total, 100000, 'לא 150 אלף');
  assert.equal(paid.remaining, 100000);
  const partial = CMP.progress(c, [...donors, { id: 'd3', campaignId: 'c1', donorName: 'קרן משפחת ברגר', amount: 20000 }], '2026-10-15');
  assert.equal(partial.total, 100000, 'מכפיל ששילם חלק — עדיין 100 אלף');
});

// ---------- 13. דוח המשכנתא ללקוח ----------
test('13: דוח המשכנתא מציג את סך התשלומים ואת הלוח השנתי מתוצאת המנוע', () => {
  const mix = E.calculateMix([{ type: 'FIXED_UNLINKED', principal: 500000, termMonths: 24, annualRate: 0.045 }], { asOf: '2026-10-01', forecast: E.DEMO_FORECAST });
  const html = MR.renderClientReportHtml({
    client: { name: 'משפחת לוי', requestedAmount: 500000 }, brand: {},
    chosen: { lender: 'בנק א', tracks: [{ type: 'FIXED_UNLINKED', share: 100, years: 2, ratePct: 4.5 }] },
    chosenResult: { summary: mix.summary, yearly: mix.yearly }
  }, '');
  const money = (n) => Number(n).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
  assert.ok(html.includes(money(mix.summary.totalPayments)), 'סך כל התשלומים');
  assert.ok(html.includes(money(mix.yearly[0].payments)), 'תשלומים בשנה');
  assert.ok(html.includes(money(mix.yearly[0].closingBalance)), 'יתרה בסוף השנה');
  assert.ok(!/<td class="n">—<\/td>/.test(html), 'אין "—" במקום הסכומים');
});

// ---------- 53, 54 ונמוכים: מכתבים לעמותה ----------
const ALLOWED = /^[֐-׿A-Za-z0-9\s!-/:-@[-`{-~₪–—…·‎‏]*$/;
const strangeChars = (s) => [...new Set([...String(s)].filter(ch => !ALLOWED.test(ch)))];

const SETTINGS = { orgName: 'עמותת חסד ואמת', regNumber: '580123456', address: 'רחוב החזון 12, בני ברק', phone: '03-1234567', sec46Number: '99999', sec46ValidUntil: '2028-12-31' };
const REPORT_GRANTS = [
  { id: 'g1', source: 'קרן התמיכות העירונית', approved: 2000, received: 2000, year: 2026, status: 'paid' },
  { id: 'g2', source: 'משרד הרווחה', approved: 0, received: 0, year: 2026, status: 'rejected' },
  { id: 'g3', source: 'קרן הצדקה', approved: 0, received: 0, year: 2026, status: 'requested' },
  { id: 'g4', source: 'רשות מקומית', approved: 3000, received: 1000, year: 2026, status: 'approved' }
];

test('53: במכתבים ובקוד המכתבים רק עברית, לטינית, ספרות ופיסוק', () => {
  // הקוד בלי ההערות (בהערות מותר חץ וכדומה) — כל מחרוזת שעלולה להגיע למכתב
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/core/npoLetters.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.deepEqual(strangeChars(src), [], 'תווים זרים בקובץ npoLetters.js');
  const donations = [{ id: 'd1', date: '2026-01-15', donorName: 'משפחת כהן', donorId: '000000018', amount: 1000, method: 'cash', fundId: 'general', receipt: { number: 1, sec46: true, sec46Number: '12345' } }];
  const report = N.annualReport(donations, REPORT_GRANTS, SETTINGS, 2026);
  const docs = [
    L.thankYouLetter(N.donorAnnualStatement(donations, SETTINGS, 'id:000000018', 2026), { message: 'יישר כוח' }),
    L.annualNarrative({ ...report, grantItems: REPORT_GRANTS }),
    L.grantDraft(report, { fundName: 'קרן הצדקה', program: 'סלי מזון', amount: 5000, purpose: 'חלוקה', contactName: 'הרב כהן', contactPhone: '050-0000000' })
  ];
  for (const d of docs) assert.deepEqual(strangeChars(d.text), [], d.kind);
  assert.ok(docs[2].text.includes('בברכת יישר כוח על השותפות במעשי החסד.'));
});

test('54: נרטיב שנתי — רק תמיכות שהתקבלו בפועל "התקבלו"; שנדחו לא מוזכרות; ממתינות בנפרד; הכנסות ולא "מצב הקרנות"', () => {
  const report = N.annualReport([], REPORT_GRANTS, SETTINGS, 2026);
  const t = L.annualNarrative({ ...report, grantItems: REPORT_GRANTS }).text;
  assert.match(t, /התקבלו בפועל תמיכות מ-2 מקורות בסך ₪3,000\.00/, 'שולמה + אושרה חלקית שהתקבל בה כסף');
  assert.ok(!t.includes('משרד הרווחה'), 'תמיכה שנדחתה לא מוזכרת');
  assert.match(t, /רשות מקומית — יתרה של ₪2,000\.00/);
  assert.match(t, /בקשת תמיכה אחת ממתינה להחלטה/);
  assert.ok(!t.includes('מצב הקרנות בתום השנה'), 'הכנסות השנה אינן יתרות');
  assert.match(t, /הכנסות השנה לפי קרנות/);
  // בלי פירוט סטטוס (פלט annualReport בלבד) — לא נספרים מקורות שלא נכנס מהם כסף
  const plain = L.annualNarrative(report).text;
  assert.match(plain, /התקבלו בפועל תמיכות מ-2 מקורות/);
  assert.ok(!/מ-4 מקורות/.test(plain));
});

test('54: השירות מעביר לנרטיב ולטיוטת המענק את הסטטוס של כל תמיכה', async () => {
  NpoService.initialize(fakeDb({ npo: { settings: SETTINGS, grants: REPORT_GRANTS } }));
  const { letter } = await NpoService.getAnnualNarrative(2026);
  assert.ok(!letter.text.includes('משרד הרווחה'));
  assert.match(letter.text, /ממתינה להחלטה/);
});

test('נמוך: מכתב התודה — מספר אישור סעיף 46 מהקבלות של אותה שנה, ובלי "מוכרות לזיכוי" לתורם זר או אנונימי', async () => {
  const old = { id: 'd1', date: '2024-05-01', donorName: 'משפחת כהן', donorId: '000000018', amount: 1000, method: 'cash', fundId: 'general', status: 'active',
    receipt: { number: 7, sec46: true, sec46Number: '12345', sec46ValidUntil: '2024-12-31', fundName: 'כללי' } };
  NpoService.initialize(fakeDb({ npo: { settings: SETTINGS, donations: [old] } }));
  const { letter } = await NpoService.getThankYouLetter('id:000000018', 2024);
  assert.match(letter.text, /אישור מס׳ 12345, בתוקף עד 2024-12-31/, 'האישור שעל הקבלה');
  assert.ok(!letter.text.includes('99999'), 'לא האישור שבתוקף היום');

  const foreign = { ...old, id: 'd2', donorId: '', donorName: 'Mr. Gold', donorType: 'foreign' };
  NpoService.initialize(fakeDb({ npo: { settings: SETTINGS, donations: [foreign] } }));
  const key = N.donorSummary([foreign], 2024)[0].key;
  const f = await NpoService.getThankYouLetter(key, 2024);
  assert.ok(!f.letter.text.includes('מוכרות לזיכוי'), 'תושב חוץ אינו זכאי לזיכוי לפי סעיף 46');
  // פונקציה טהורה: גם בלי פירוט אישורים — לא מצטטים את האישור הנוכחי מההגדרות
  const pure = L.thankYouLetter({ year: 2024, donor: { name: 'משפחת כהן' }, org: SETTINGS, receipts: [{}], total: 1000, sec46Total: 1000 });
  assert.match(pure.text, /סעיף 46/);
  assert.ok(!pure.text.includes('99999'));
  assert.ok(!L.thankYouLetter({ year: 2024, donor: { name: 'א' }, org: SETTINGS, receipts: [{}], total: 1, sec46Total: 1, donorType: 'anonymous' }).text.includes('מוכרות לזיכוי'));
});

test('נמוך: renderLetterHtml — הגדרות העמותה (orgName) ממלאות את כותרת המסמך', () => {
  const html = L.renderLetterHtml({ title: 'מכתב', text: 'גוף' }, SETTINGS);
  assert.match(html, /<h2>עמותת חסד ואמת<\/h2>/);
});

// ---------- IPC: כותרת ה-PDF של המכתבים, "היום" מה-IPC, ועוסק פטור בעמלת הייעוץ ----------
const handlers = {};
const pdfHtml = [];
Module._resolveFilename_orig_npoaudit = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_npoaudit__.js' : Module._resolveFilename_orig_npoaudit.call(this, req, ...rest); };
require.cache['/__electron_stub_npoaudit__.js'] = {
  id: '/__electron_stub_npoaudit__.js', filename: '/__electron_stub_npoaudit__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    BrowserWindow: function () {
      return { loadURL: async (u) => { pdfHtml.push(Buffer.from(u.split(',')[1], 'base64').toString('utf8')); },
        webContents: { printToPDF: async () => Buffer.from('') }, destroy() {} };
    },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
  }
};
const ipc = econ('ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: כותרת PDF של מכתב תודה עם שם העמותה; עוסק פטור — עמלה בלי מע"מ וחשבונית עסקה', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npo-audit-'));
  tmpDirs.push(dir);
  await ipc.initEcon(dir, { relayUrl: '' });
  await handlers['auth:setup'](ev(91), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(91), 'menahel', 'menahel-strong-pass-1');

  await handlers['npo:saveSettings'](ev(91), { orgName: 'עמותת חסד ואמת', regNumber: '580123456', address: 'רחוב החזון 12, בני ברק' });
  await handlers['npo:addDonation'](ev(91), { donorName: 'משפחת כהן', donorId: '000000018', amount: 180, date: '2026-10-01', method: 'cash' });
  const r = await handlers['npo:exportThankYouPdf'](ev(91), 'id:000000018', 2026);
  assert.equal(r.ok, false, 'חלון השמירה בוטל');
  assert.match(pdfHtml.at(-1), /<h2>עמותת חסד ואמת<\/h2>/, 'שם העמותה בכותרת');

  const so = await handlers['npo:getStandingOrders'](ev(91));
  const d = new Date();
  assert.equal(so.month, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 'החודש המקומי');

  await handlers['madv:saveSettings'](ev(91), { vatExempt: true });
  const c = await handlers['madv:createClient'](ev(91), { name: 'משפחת שפירא', requestedAmount: 800000, feeType: 'fixed', feeValue: 4000 });
  let ov = await handlers['madv:getOverview'](ev(91));
  assert.equal(ov.settings.vatExempt, true);
  const fee = ov.clients.find(x => x.id === c.id).fee;
  assert.equal(fee.vatAg, 0);
  assert.equal(fee.totalAg, 400000, 'עוסק פטור — העמלה בלי מע"מ');
  const pay = await handlers['madv:addFeePayment'](ev(91), c.id, { date: '2026-10-01', amount: 4000, method: 'transfer' });
  assert.equal(pay.status.state, 'paid');
  const inv = await handlers['madv:issueFeeInvoice'](ev(91), c.id, pay.payment.id, { confirmed: true });
  const invoices = await handlers['acct:getInvoices'](ev(91));
  const stored = (invoices.invoices || invoices).find(i => i.id === inv.id);
  assert.equal(stored.vatExempt, true, 'חשבונית עסקה בלי מע"מ');
  assert.notEqual(stored.kind, 'tax-invoice-receipt');
  assert.equal(Math.round(stored.total * 100), 400000);
});

// ---------- סבב סקירה שני ----------
test('12 (סקירה): הכפלה בלי שם המכפיל נדחית; קמפיין ישן בלי שם מסומן; הסכום שזוהה מהמכפיל מוחזר', () => {
  const base = { name: 'בניין בית המדרש', goal: 200000, startDate: '2026-10-01', endDate: '2026-10-31', matchRatio: 1, matchCap: 50000 };
  assert.throws(() => CMP.validateCampaign(base), /שם התורם המכפיל/);
  assert.throws(() => CMP.validateCampaign({ ...base, matchDonor: '   ' }), /שם התורם המכפיל/);
  const donors = [{ id: 'd1', campaignId: 'c1', donorName: 'משה כהן', amount: 50000 }, { id: 'd2', campaignId: 'c1', donorName: 'קרן ברגר', amount: 50000 }];
  // קמפיין שנשמר לפני התיקון — בלי שם המכפיל: מסומן, כדי שהמשתמש יידע שההכפלה עלולה להיספר פעמיים
  const legacy = CMP.progress({ id: 'c1', ...base, matchDonor: '', ambassadors: [] }, donors, '2026-10-15');
  assert.equal(legacy.matchDonorMissing, true);
  // שם שנכתב אחרת בתרומות — לא זוהה, וזה גלוי: 0 מהמכפיל
  const c = { id: 'c1', ...CMP.validateCampaign({ ...base, matchDonor: 'משפחת ברגר' }) };
  const other = CMP.progress(c, donors, '2026-10-15');
  assert.equal(other.matchDonorMissing, false);
  assert.equal(other.matcherRaised, 0);
  assert.equal(other.matcherCount, 0);
  const ok = CMP.progress({ ...c, matchDonor: 'קרן ברגר' }, donors, '2026-10-15');
  assert.equal(ok.matcherRaised, 50000);
  assert.equal(ok.matcherCount, 1);
  assert.equal(ok.total, 100000, 'לא 150 אלף');
  // קמפיין בלי הכפלה — אין דרישה לשם ואין סימון
  const plain = CMP.progress({ id: 'c2', ...CMP.validateCampaign({ ...base, matchRatio: '', matchCap: '' }) }, [], '2026-10-15');
  assert.equal(plain.matchDonorMissing, false);
});

test('12 (סקירה): שורת הקמפיין במסך — כמה התקבל מהמכפיל, ואזהרה כשחסר שמו', () => {
  const vm = require('vm');
  const EconUI = require('./helpers/econ-ui');
  const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, appendChild() {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  // readyState "loading" — boot.js לא מאתחל את המסך; קוראים לפונקציית הרינדור ישירות
  const document = { readyState: 'loading', getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: () => el(), body: el() };
  const context = { document, console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' } };
  context.window = context;
  context.window.systemAPI = new Proxy({}, { get: () => () => Promise.resolve(null) });
  vm.createContext(context);
  EconUI.run(context);
  const base = { name: 'בניין בית המדרש', goal: 200000, startDate: '2026-10-01', endDate: '2026-10-31', matchRatio: 1, matchCap: 50000, ambassadors: [] };
  const donors = [{ id: 'd1', campaignId: 'c1', donorName: 'משה כהן', amount: 50000 }, { id: 'd2', campaignId: 'c1', donorName: 'קרן ברגר', amount: 50000 }];
  const okHtml = context.renderNpoCampaigns([CMP.progress({ id: 'c1', ...base, matchDonor: 'קרן ברגר' }, donors, '2026-10-15')]);
  assert.match(okHtml, /מהמכפיל התקבלו ₪50,000\.00 \(1 תרומות\)/);
  assert.doesNotMatch(okHtml, /חסר שם התורם המכפיל/);
  const legacyHtml = context.renderNpoCampaigns([CMP.progress({ id: 'c1', ...base, matchDonor: '' }, donors, '2026-10-15')]);
  assert.match(legacyHtml, /חסר שם התורם המכפיל/);
  assert.doesNotMatch(legacyHtml, /מהמכפיל התקבלו/);
});

test('54 (סקירה): תמיכה ש"שולמה" חלקית (הגורם המממן קיצץ) — אינה יתרה צפויה', () => {
  const grants = [
    { source: 'קרן החינוך', approved: 5000, received: 4000, year: 2026, status: 'paid' },
    { source: 'רשות מקומית', approved: 3000, received: 1000, year: 2026, status: 'approved' }
  ];
  const t = L.annualNarrative({ ...N.annualReport([], grants, SETTINGS, 2026), grantItems: grants }).text;
  assert.doesNotMatch(t, /קרן החינוך — יתרה/, 'תמיכה ששולמה היא סופית');
  assert.match(t, /רשות מקומית — יתרה של ₪2,000\.00/);
  assert.match(t, /קרן החינוך — ₪4,000\.00/, 'מה שהתקבל בפועל');
});

test('נמוך (סקירה): מכתב תודה לתורם עם תרומה ישראלית ותרומת חוץ — זיכוי רק על הישראלית, בלי תלות בסדר', async () => {
  const base = { donorName: 'משפחת גולד', amount: 100, method: 'cash', fundId: 'general', status: 'active' };
  const il = { ...base, id: 'd1', date: '2026-02-01', receipt: { number: 1, sec46: true, sec46Number: '12345', fundName: 'כללי' } };
  const fr = { ...base, id: 'd2', date: '2026-03-01', donorType: 'foreign', receipt: { number: 2, sec46: true, sec46Number: '77777', fundName: 'כללי' } };
  // האחרונה ישראלית / האחרונה זרה
  for (const donations of [[{ ...fr, date: '2026-01-01' }, il], [il, fr]]) {
    NpoService.initialize(fakeDb({ npo: { settings: SETTINGS, donations } }));
    const key = N.donorSummary(donations, 2026)[0].key;
    const { letter } = await NpoService.getThankYouLetter(key, 2026);
    assert.equal(letter.amounts.total, 200);
    assert.equal(letter.amounts.sec46, 100, 'רק התרומה של תושב ישראל');
    assert.match(letter.text, /מתוך הסכום, ₪100\.00 הינם תרומות מוכרות לזיכוי/);
    assert.match(letter.text, /אישור מס׳ 12345/);
    assert.ok(!letter.text.includes('77777'), 'האישור שעל קבלת תרומת החוץ לא מצוטט');
  }
  // כל התרומות של תושב חוץ — בלי משפט הזיכוי
  const only = [fr, { ...fr, id: 'd3', date: '2026-04-01' }];
  NpoService.initialize(fakeDb({ npo: { settings: SETTINGS, donations: only } }));
  const { letter } = await NpoService.getThankYouLetter(N.donorSummary(only, 2026)[0].key, 2026);
  assert.ok(!letter.text.includes('מוכרות לזיכוי'));
});

test('נמוך (סקירה): כיבוי "עוסק פטור" לא מחשב מחדש עמלה, מצב תשלום והכנסות של תיק ששולם', async () => {
  MortgageAdvisorService.initialize(fakeDb({ settings: { vatRate: 0.18 }, mortgageAdvisor: { settings: { vatExempt: true } } }));
  const paid = await MortgageAdvisorService.createClient({ name: 'משפחת שפירא', requestedAmount: 800000, feeType: 'fixed', feeValue: 4000 }, null);
  const r = await MortgageAdvisorService.addFeePayment(paid.id, { date: '2026-03-01', amount: 4000, method: 'transfer' }, null);
  assert.equal(r.status.state, 'paid');
  const open = await MortgageAdvisorService.createClient({ name: 'משפחת רוזן', requestedAmount: 500000, feeType: 'fixed', feeValue: 4000 }, null);
  // העסק עבר את התקרה ונעשה עוסק מורשה
  await MortgageAdvisorService.saveSettings({ vatExempt: false });
  const ov = await MortgageAdvisorService.getOverview(null);
  const a = ov.clients.find(x => x.id === paid.id);
  assert.equal(a.feeStatus.state, 'paid', 'התיק ששולם נשאר "שולם", בלי יתרת מע"מ');
  assert.equal(a.fee.vatAg, 0);
  assert.equal(a.feeExempt, true);
  const b = ov.clients.find(x => x.id === open.id);
  assert.equal(b.fee.totalAg, 472000, 'תיק בלי תשלומים — לפי ההגדרה החדשה');
  assert.equal(b.feeExempt, false);
  const inc = await MortgageAdvisorService.getIncome(2026, null);
  assert.equal(inc.receivedAg, 400000);
  assert.equal(inc.outstandingAg, 472000, 'רק התיק הפתוח');
  const forInvoice = await MortgageAdvisorService.feePaymentForInvoice(paid.id, r.payment.id, null);
  assert.equal(forInvoice.exempt, true, 'החשבונית לתשלום — לפי המעמד שננעל בתיק');
  // מחיקת התשלום היחיד — התיק חוזר להגדרה הנוכחית
  await MortgageAdvisorService.deleteFeePayment(paid.id, r.payment.id, null);
  const after = (await MortgageAdvisorService.getOverview(null)).clients.find(x => x.id === paid.id);
  assert.equal(after.feeExempt, false);
  assert.equal(after.fee.totalAg, 472000);
});

test('נמוך (סקירה): נתונים ישנים — תיק ששולם עם מע"מ ננעל בטעינה, לפני שההגדרה משתנה', async () => {
  const old = { id: 'c1', name: 'משפחת לוי', requestedAmountAg: 50000000, feeType: 'fixed', feeFixedAg: 400000,
    feePayments: [{ id: 'p1', date: '2026-02-01', amountAg: 472000, method: 'transfer' }] };
  MortgageAdvisorService.initialize(fakeDb({ settings: { vatRate: 0.18 }, mortgageAdvisor: { clients: [old] } }));
  await MortgageAdvisorService.saveSettings({ vatExempt: true });
  const c = (await MortgageAdvisorService.getOverview(null)).clients[0];
  assert.equal(c.feeExempt, false);
  assert.equal(c.feeStatus.state, 'paid');
  assert.equal(c.feeStatus.overpaidAg, 0, 'לא "שולם ביתר" אחרי המעבר לפטור');
  // הליבה: מעמד נעול גובר על השיעור שהשירות מעביר
  assert.equal(M.caseVatRate({ feeVatExempt: true }, 0.18, 0.18), 0);
  assert.equal(M.caseVatRate({ feeVatExempt: false }, 0, 0.18), 0.18);
  assert.equal(M.caseVatRate({}, 0, 0.18), 0);
});

test('11 (סקירה): התאמת דוח הסליקה — סכום דו-משמעי מקבל את ההסבר המפורט', () => {
  const r = CL.matchReport('תאריך,סכום,אסמכתא\n01/10/2026,1.234,P00001\n02/10/2026,"1234,567",P00002\n03/10/2026,abc,P00003\n',
    { date: 'תאריך', amount: 'סכום', ref: 'אסמכתא' }, []);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0].message, /דו-משמעי: "1\.234"/);
  assert.match(r.errors[1].message, /דו-משמעי: "1234,567"/);
  assert.match(r.errors[2].message, /^סכום לא תקין: "abc"$/);
});
