// משרד ייעוץ (שלב 2): אישורים עקרוניים בתיק והשוואה במנוע המעבדה, ומסמכים לפי פרופיל הלווה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const M = require('../modules/econ/core/mortgageAdvisor');

const TRACKS = [
  { type: 'FIXED_UNLINKED', repayment: 'SPITZER', share: 50, years: 25, ratePct: 4.8 },
  { type: 'PRIME', repayment: 'SPITZER', share: 50, years: 25, spreadPct: -0.5 }
];

// ---------- מסמכים ----------

test('מסמכים לפי פרופיל: שכיר ביד שנייה מול עצמאי מקבלן', () => {
  const emp = M.docsProgress({ profile: { employment: 'employee', deal: 'secondHand' } });
  const keys = emp.items.map(d => d.key);
  assert.ok(keys.includes('payslips') && keys.includes('tabu'));
  assert.ok(!keys.includes('selfTax') && !keys.includes('contractorDocs'));
  const self = M.docsProgress({ profile: { employment: 'selfEmployed', deal: 'contractor' } }).items.map(d => d.key);
  assert.ok(self.includes('selfTax') && self.includes('contractorDocs'));
  assert.ok(!self.includes('payslips') && !self.includes('tabu'));
  assert.deepEqual(M.normalizeProfile({ employment: 'x' }), { employment: 'employee', deal: 'secondHand' });
});

test('מצב מסמך: התקבל / לא רלוונטי / חסר; לא רלוונטי לא נספר; מסמך שהתקבל מוצג גם אם לא חל', () => {
  let c = { name: 'משפחת לוי', profile: { employment: 'employee', deal: 'secondHand' }, docs: [], docsNa: [] };
  const total = M.docsProgress(c).total;
  Object.assign(c, M.setDocState(c, 'id', 'received'));
  Object.assign(c, M.setDocState(c, 'appraisal', 'na'));
  let p = M.docsProgress(c);
  assert.equal(p.done, 1);
  assert.equal(p.total, total - 1);
  assert.ok(!p.missing.includes('דוח שמאי'));
  Object.assign(c, M.setDocState(c, 'appraisal', 'received'));
  assert.deepEqual(c.docsNa, [], 'התקבל מבטל "לא רלוונטי"');
  Object.assign(c, M.setDocState(c, 'id'));
  assert.ok(!c.docs.includes('id'), 'בלי מצב — החלפה (התנהגות ישנה)');
  c = { profile: { employment: 'employee', deal: 'secondHand' }, docs: ['selfTax'] };
  assert.ok(M.docsProgress(c).items.some(d => d.key === 'selfTax' && d.done));
  assert.throws(() => M.setDocState(c, 'nope', 'na'), /לא מוכר/);
  assert.throws(() => M.setDocState(c, 'id', 'x'), /מצב מסמך/);
});

test('נוסח ללקוח: רק המסמכים החסרים, ממוספרים, עם שם המשרד', () => {
  const c = { name: 'אהרן ברגר', profile: { employment: 'pension', deal: 'refinance' }, docs: ['id', 'bank', 'loans', 'tabu', 'payoffReport', 'appraisal'] };
  const text = M.missingDocsMessage(c, 'משרד דוגמה');
  assert.match(text, /^שלום אהרן ברגר,/);
  assert.match(text, /1\. אישור קצבה/);
  assert.match(text, /ביטוח חיים/);
  assert.doesNotMatch(text, /תעודות זהות/);
  assert.match(text, /משרד דוגמה$/);
  assert.equal(M.missingDocsMessage({ ...c, docs: M.docsProgress(c).items.map(d => d.key) }), '', 'אין חסרים — אין נוסח');
});

// ---------- אישורים עקרוניים ----------

test('אישור: ולידציה בעברית, חלקים מסתכמים ל-100%, סכומים באגורות', () => {
  const a = M.validateApproval({ lender: 'בנק א', validUntil: '2026-12-31', fees: '360.5', maxAmount: 900000, tracks: TRACKS });
  assert.equal(a.feesAg, 36050);
  assert.equal(a.maxAmountAg, 90000000);
  assert.equal(a.tracks[1].spreadPct, -0.5);
  assert.equal(M.approvalView(a).fees, 360.5);
  assert.throws(() => M.validateApproval({ lender: '', tracks: TRACKS }), /שם הבנק/);
  assert.throws(() => M.validateApproval({ lender: 'ב', tracks: [] }), /לפחות מסלול/);
  assert.throws(() => M.validateApproval({ lender: 'ב', tracks: [{ ...TRACKS[0], share: 60 }, TRACKS[1]] }), /100%.*110%/);
  assert.throws(() => M.validateApproval({ lender: 'ב', tracks: [{ ...TRACKS[0], type: 'X' }] }), /סוג מסלול/);
  assert.throws(() => M.validateApproval({ lender: 'ב', validUntil: '31/12', tracks: TRACKS }), /תוקף/);
});

test('אישורים בתצוגה: פג תוקף ונבחר; קלט למעבדה בשקלים לפי סכום התיק', () => {
  const c = M.clientStored({ id: 'c', name: 'א', requestedAmount: 800000, chosenApprovalId: 'b',
    approvals: [{ ...M.validateApproval({ lender: 'א', validUntil: '2026-01-01', tracks: TRACKS }), id: 'a' }, { ...M.validateApproval({ lender: 'ב', fees: 100, tracks: TRACKS }), id: 'b' }] });
  const s = M.approvalsSummary(c, '2026-10-20');
  assert.deepEqual(s.map(x => [x.expired, x.chosen]), [[true, false], [false, true]]);
  const lab = M.approvalsForLab(c);
  assert.equal(lab.amount, 800000);
  assert.equal(lab.offers[1].fees, 100);
  assert.equal('approvals' in M.clientView(c), false, 'האישורים לא יוצאים בייבוא/ייצוא');
});

// ---------- IPC מול מסד אמיתי ----------

const handlers = {};
Module._resolveFilename_orig_appr = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_appr__.js' : Module._resolveFilename_orig_appr.call(this, req, ...rest); };
require.cache['/__electron_stub_appr__.js'] = {
  id: '/__electron_stub_appr__.js', filename: '/__electron_stub_appr__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC: שמירת אישורים בתיק, בחירה, השוואה במנוע המעבדה, מסמכים ונוסח; יועץ אחר לא רואה', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-appr-')));
  await handlers['auth:setup'](ev(71), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(71), 'menahel', 'menahel-strong-pass-1');
  const ub = await handlers['users:create'](ev(71), { username: 'yoetz_b', password: 'yoetz-b-strong-pass', role: 'editor' });
  await handlers['auth:login'](ev(72), 'yoetz_b', 'yoetz-b-strong-pass');

  const c = await handlers['madv:createClient'](ev(71), { name: 'משפחת גולד', requestedAmount: 1000000, employment: 'selfEmployed', deal: 'contractor' });
  assert.equal(c.employment, 'selfEmployed');
  await assert.rejects(handlers['madv:calcApprovals'](ev(71), c.id), /אין אישורים/);

  const saved = await handlers['madv:saveApprovals'](ev(71), c.id, [
    { lender: 'בנק א', fees: 360, tracks: TRACKS },
    { lender: 'בנק ב', fees: 0, maxAmount: 900000, tracks: TRACKS.map(t => ({ ...t, ratePct: t.ratePct && 5.2 })) }
  ]);
  assert.equal(saved.length, 2);
  await handlers['madv:chooseApproval'](ev(71), c.id, saved[0].id);
  // שמירה חוזרת עם אותו מזהה שומרת את הבחירה; מזהה שהוסר — מבטל אותה
  const again = await handlers['madv:saveApprovals'](ev(71), c.id, [{ ...saved[0], tracks: TRACKS }]);
  assert.equal(again[0].id, saved[0].id);
  assert.equal(again[0].chosen, true);
  await handlers['madv:saveApprovals'](ev(71), c.id, [{ ...saved[0], tracks: TRACKS }, { lender: 'בנק ב', maxAmount: 900000, tracks: TRACKS }]);
  await assert.rejects(handlers['madv:chooseApproval'](ev(71), c.id, 'ghost'), /לא נמצא/);

  const cmp = await handlers['madv:calcApprovals'](ev(71), c.id);
  assert.equal(cmp.offers.length, 2);
  assert.equal(cmp.offers.find(x => x.offer.lender === 'בנק ב').overMax, true, 'הסכום המבוקש מעל המאושר');
  assert.equal(cmp.byTotalCost.length, 1);

  await handlers['madv:toggleDoc'](ev(71), c.id, 'selfTax', 'received');
  await handlers['madv:toggleDoc'](ev(71), c.id, 'appraisal', 'na');
  const ov = await handlers['madv:getOverview'](ev(71));
  const cc = ov.clients[0];
  assert.equal(cc.docs.done, 1);
  assert.equal(cc.approvals.length, 2);
  assert.ok(ov.employment && ov.deals);
  const msg = await handlers['madv:getMissingDocsMessage'](ev(71), c.id);
  assert.match(msg.text, /מסמכי הקבלן/);
  assert.doesNotMatch(msg.text, /דוח שמאי/);

  // יועץ ב — התיק של המנהל משויך למנהל ולכן מוסתר ממנו, גם במעבדה
  await assert.rejects(handlers['madv:saveApprovals'](ev(72), c.id, []), /לא נמצא/);
  await assert.rejects(handlers['madv:calcApprovals'](ev(72), c.id), /לא נמצא/);
  await assert.rejects(handlers['madv:getMissingDocsMessage'](ev(72), c.id), /לא נמצא/);
  const lab = await handlers['mlab:getOverview'](ev(72));
  assert.equal(lab.clients.length, 0, 'מעבדת התמהיל לא מציגה תיק של יועץ אחר');
  await assert.rejects(handlers['mlab:saveScenario'](ev(72), { name: 'ת', clientId: c.id, tracks: [] }), /לא נמצא/);
  assert.equal((await handlers['mlab:getOverview'](ev(71))).clients.length, 1);
  assert.ok(ub.id);
});

test('המסך: כפתורי אישורים, "לא רלוונטי" ונוסח ללקוח; ערוצים חשופים ב-preload', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-advisor.js'), 'utf8');
  for (const s of ['data-madv-docna', 'data-madv-missing', 'data-madv-appr-cmp', 'data-madv-choose', 'madvOpenApprovalsInLab']) assert.ok(ui.includes(s), s);
  const lab = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-lab.js'), 'utf8');
  assert.match(lab, /labSaveApprToClient/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  for (const ch of ['madv:getMissingDocsMessage', 'madv:saveApprovals', 'madv:chooseApproval', 'madv:calcApprovals']) assert.ok(preload.includes(`'${ch}'`), ch);
});
