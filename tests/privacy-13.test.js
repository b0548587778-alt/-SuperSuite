// תיקון 13 — השלמת כלי הפרטיות (PLAN.md 9.15): רמת אבטחה מוצעת, מסמך הגדרות מאגר, נוהל אבטחה, הודעת יידוע,
// זכות עיון לפי ת"ז (תחומים פתוחים ברישיון, בלי חסוי למי שאינו מורשה), יומן בקשות, ומדיניות שמירה לכל סוג רשומה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const PR = require('../modules/econ/core/privacy');
const PD = require('../modules/econ/core/privacyDocs');

const ORG = { name: 'עמותת חסדי אבות', id: '580000011', address: 'רחוב הרב קוק 3, בני ברק' };
const mapWith = (counts, users) => PR.dataMap({
  npo: { donations: Array(counts.donations || 0).fill({}) },
  gemach: { loans: Array(counts.loans || 0).fill({}) }
}, users);

test('רמת אבטחה: יחיד, בסיסית, בינונית וגבוהה לפי הרגישות, מספר הרשומות והמורשים', () => {
  assert.equal(PR.suggestLevel(mapWith({ donations: 50 }, { admin: 1, editor: 2 })).level, 'individual');
  assert.equal(PR.suggestLevel(mapWith({ donations: 50 }, { admin: 1, editor: 3 })).level, 'basic');
  assert.equal(PR.suggestLevel(mapWith({ donations: 10000 }, { admin: 1 })).level, 'basic');
  const medium = PR.suggestLevel(mapWith({ donations: 5, loans: 3 }, { admin: 1 }));
  assert.equal(medium.level, 'medium');
  assert.equal(medium.reportBreach, true);
  assert.match(medium.reasons[0], /גמ"ח/);
  assert.equal(PR.suggestLevel(mapWith({ loans: 100000 }, { admin: 1 })).level, 'high');
  assert.equal(PR.suggestLevel(mapWith({ donations: 1 }, { editor: 101 })).level, 'high');
  assert.match(PR.suggestLevel(mapWith({}, {})).note, /עורך דין/);
});

test('מסמך הגדרות מאגר: כל המאגרים מהמיפוי, רמת האבטחה, פרטי הארגון וחלקים למילוי', () => {
  const map = mapWith({ donations: 4, loans: 2 }, { admin: 1, editor: 1 });
  const html = PD.renderDefinitionHtml(map, PR.suggestLevel(map), ORG, '2026-10-18');
  for (const r of map.rows) assert.ok(html.includes(r.area.replace(/"/g, '&quot;')), r.area);
  assert.match(html, /עמותת חסדי אבות/);
  assert.match(html, /רמת אבטחה בינונית/);
  assert.match(html, /למילוי/);
  assert.match(html, /אינה ייעוץ משפטי/);
  const proc = PD.renderProcedureHtml(map, PR.suggestLevel(map), ORG, '2026-10-18');
  assert.match(proc, /טיוטת נוהל אבטחת מידע/);
  assert.match(proc, /הרשאות גישה/);
  assert.match(proc, /מדווח לרשות להגנת הפרטיות מיד/);
  assert.match(proc, /לפחות 7 שנים/);
});

test('הודעת יידוע: מטרה, חובה/רצון, למי נמסר, וזכויות העיון והתיקון', () => {
  const lines = PD.noticeText('donor', ORG);
  const text = lines.join('\n');
  assert.match(text, /עמותת חסדי אבות/);
  assert.match(text, /סעיף 46/);
  assert.match(text, /סעיף 13/);
  assert.match(text, /סעיף 14/);
  for (const k of Object.keys(PD.NOTICE_KINDS)) assert.match(PD.renderNoticeHtml(k, ORG, '2026-10-18'), /הודעה לפי סעיף 11/);
  assert.throws(() => PD.noticeText('x', ORG), /לא מוכר/);
});

function subjectData() {
  return {
    npo: {
      donations: [
        { id: 'd1', donorName: 'יוסף כהן', donorId: '000000018', donorPhone: '050-1111111', donorAddress: 'רחוב הנביאים 4', date: '2026-01-05', amount: 180, purpose: 'כללי' },
        { id: 'd2', donorName: 'יוסף כהן', date: '2026-02-05', amount: 50 },
        { id: 'd3', donorName: 'אחר', donorId: '000000026', date: '2026-02-05', amount: 10 }
      ],
      standingOrders: [], memorials: []
    },
    gemach: {
      loans: [{ id: 'l1', borrowerName: 'משה לוי', borrowerId: '000000034', amount: 3000, issueDate: '2026-01-01', status: 'active', installments: 3,
        schedule: [], guarantors: [{ name: 'יוסף כהן', id: '000000018', phone: '050-1111111' }] }],
      lendings: [], deposits: [], applications: []
    },
    chesed: {
      beneficiaries: [{ id: 'b1', familyName: 'כהן', headName: 'יוסף כהן', idNumber: '000000018', tier: 'confidential', familySize: 4 }],
      volunteers: [], rounds: []
    },
    invoices: [{ id: 'i1', number: 12, customer: 'יוסף כהן', customerTaxId: '000000018', date: '2026-03-01', net: 100, vat: 18, total: 118, items: [] }]
  };
}

test('זכות עיון: כל התחומים לפי ת"ז, כולל שיוך לפי שם, ובלי מידע של אחרים', () => {
  const r = PD.subjectReport(subjectData(), '000000018', { canSeeConfidential: true, acct: true });
  const titles = r.sections.map(s => s.title);
  assert.deepEqual(titles.sort(), ['ערבות להלוואה בגמ"ח', 'חשבונית 12', 'משפחה נתמכת', 'תרומה', 'תרומה'].sort());
  assert.equal(r.sections.filter(s => s.byName).length, 1, 'התרומה בלי ת"ז שויכה לפי שם ומסומנת');
  const all = JSON.stringify(r);
  assert.ok(!all.includes('000000026'));
  assert.match(all, /רחוב הנביאים 4/);
  const html = PD.renderSubjectHtml(r, ORG, '2026-10-18');
  assert.match(html, /שויך לפי שם/);
  assert.match(html, /לא נכללים/);
  assert.throws(() => PD.subjectReport(subjectData(), '12'), /מספר זהות/);
});

test('זכות עיון: נזקק חסוי רק למורשה, תחום סגור ברישיון והנהלת חשבונות סגורה — לא נכללים', () => {
  const noConf = PD.subjectReport(subjectData(), '000000018', { canSeeConfidential: false, acct: true });
  assert.ok(!noConf.sections.some(s => s.title === 'משפחה נתמכת'));
  const npoOnly = PD.subjectReport(subjectData(), '000000018', { canSeeConfidential: true, sources: ['npo'], acct: false });
  assert.deepEqual(npoOnly.sections.map(s => s.title), ['תרומה', 'תרומה']);
});

test('יומן בקשות: מועד יעד 30 יום, דחייה מחייבת סיבה, ובאיחור מסומן', () => {
  assert.throws(() => PR.validateRequest({ type: 'x', name: 'א', receivedDate: '2026-10-01' }), /סוג הבקשה/);
  assert.throws(() => PR.validateRequest({ type: 'access', name: '', receivedDate: '2026-10-01' }), /שם המבקש/);
  const req = PR.validateRequest({ type: 'access', name: 'יוסף כהן', idNumber: '000-000-018', receivedDate: '2026-10-01' });
  assert.equal(req.dueDate, '2026-10-31');
  assert.equal(req.idNumber, '000000018');
  assert.equal(PR.requestView(req, '2026-11-01').overdue, true);
  assert.equal(PR.requestView(req, '2026-10-31').overdue, false);
  assert.throws(() => PR.closeRequest(req, { status: 'rejected', handledDate: '2026-10-05' }), /הסיבה/);
  assert.throws(() => PR.closeRequest(req, { handledDate: '2026-09-30' }), /לפני/);
  const done = PR.closeRequest(req, { handledDate: '2026-10-05', notes: 'נשלח PDF' });
  assert.equal(done.status, 'done');
  assert.equal(PR.requestView(done, '2027-01-01').overdue, false);
  assert.throws(() => PR.closeRequest(done, { handledDate: '2026-10-06' }), /כבר נסגרה/);
});

function retentionData() {
  return {
    npo: {
      donations: [
        { id: 'a', donorName: 'ישן', donorId: '000000018', donorPhone: '050', donorAddress: 'רחוב', date: '2015-01-01', amount: 10 },
        { id: 'b', donorName: 'ישן', donorId: '000000018', date: '2016-01-01', amount: 10 },
        { id: 'c', donorName: 'חדש', donorPhone: '052', date: '2026-01-01', amount: 10 },
        { id: 'd', donorName: 'קבע', donorPhone: '053', date: '2014-01-01', amount: 10 }
      ],
      standingOrders: [{ id: 's', donorName: 'קבע', amount: 20, startMonth: '2014-01' }]
    },
    gemach: { loans: [
      { id: 'closed', borrowerName: 'סגור', borrowerPhone: '054', borrowerAddress: 'כתובת', notes: 'הערה', status: 'closed', issueDate: '2015-01-01',
        schedule: [{ paidDate: '2016-01-01', status: 'paid' }], guarantors: [{ name: 'ערב', id: '000000026', phone: '055' }] },
      { id: 'active', borrowerName: 'פעיל', borrowerPhone: '056', status: 'active', issueDate: '2010-01-01', schedule: [] },
      { id: 'recent', borrowerName: 'נפרע לאחרונה', borrowerPhone: '057', status: 'closed', issueDate: '2015-01-01', schedule: [{ paidDate: '2025-06-01', status: 'paid' }] }
    ] },
    mortgageAdvisor: { clients: [
      { id: 'm1', name: 'לקוח ישן', phone: '058', notes: 'הערה', bank: 'בנק', createdAt: '2016-01-01T00:00:00Z', updatedAt: '2017-01-01T00:00:00Z' },
      { id: 'm2', name: 'לקוח חדש', phone: '059', createdAt: '2026-01-01T00:00:00Z' }
    ] },
    chesed: { beneficiaries: [], rounds: [] }
  };
}

test('שמירה לתורמים: מינימום 7 שנים, תורם עם הוראת קבע פעילה אינו מועמד, נשמרים שם ות"ז', () => {
  const data = retentionData();
  assert.throws(() => PR.candidatesFor(data, 'donors', '2026-10-18', 5), /לפחות 7/);
  const c = PR.candidatesFor(data, 'donors', '2026-10-18', 7);
  assert.deepEqual(c.map(x => x.id), ['id:000000018']);
  const r = PR.applyRetention(data, 'donors', ['id:000000018', 'name:חדש'], '2026-10-18', 7, '2026-10-18T10:00:00Z');
  assert.deepEqual(r, { minimized: 1, skipped: 1 });
  const a = data.npo.donations.find(x => x.id === 'a');
  assert.deepEqual([a.donorPhone, a.donorAddress, a.donorName, a.donorId, a.amount], ['', '', 'ישן', '000000018', 10]);
  assert.equal(data.npo.donations.find(x => x.id === 'c').donorPhone, '052');
  assert.equal(data.npo.donations.find(x => x.id === 'd').donorPhone, '053');
});

test('שמירה ללווים ולתיקי משכנתאות: רק הלוואה שנפרעה/בוטלה ותיק שלא עודכן, ושוב לא מועמד אחרי מזעור', () => {
  const data = retentionData();
  assert.deepEqual(PR.candidatesFor(data, 'borrowers', '2026-10-18', 3).map(x => x.id), ['closed']);
  PR.applyRetention(data, 'borrowers', ['closed', 'active'], '2026-10-18', 3, 'now');
  const l = data.gemach.loans.find(x => x.id === 'closed');
  assert.deepEqual([l.borrowerPhone, l.borrowerAddress, l.notes, l.guarantors[0].phone, l.guarantors[0].id, l.borrowerName], ['', '', '', '', '000000026', 'סגור']);
  assert.equal(data.gemach.loans.find(x => x.id === 'active').borrowerPhone, '056');
  assert.equal(PR.candidatesFor(data, 'borrowers', '2026-10-18', 3).length, 0);
  assert.deepEqual(PR.candidatesFor(data, 'mortgageClients', '2026-10-18', 5).map(x => x.id), ['m1']);
  PR.applyRetention(data, 'mortgageClients', ['m1', 'm2'], '2026-10-18', 5, 'now');
  const m = data.mortgageAdvisor.clients;
  assert.deepEqual([m[0].phone, m[0].notes, m[0].name, m[0].bank, m[1].phone], ['', '', 'לקוח ישן', 'בנק', '059']);
  assert.throws(() => PR.candidatesFor(data, 'other', '2026-10-18', 5), /לא מוכר/);
});

// ---------- IPC ----------
const handlers = {};
const saved = [];
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_pv13__.js' : resolve.call(this, req, ...rest); };
class FakeWindow {
  constructor() { this.webContents = { printToPDF: async () => Buffer.from(this.html || '', 'utf8') }; }
  async loadURL(u) { this.html = Buffer.from(u.split(',')[1], 'base64').toString('utf8'); }
  destroy() {}
}
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pv13-out-'));
require.cache['/__electron_stub_pv13__.js'] = {
  id: '/__electron_stub_pv13__.js', filename: '/__electron_stub_pv13__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, BrowserWindow: FakeWindow,
    dialog: { showSaveDialog: async (o) => { const p = path.join(outDir, `${saved.length}.html`); saved.push({ name: o.defaultPath, p }); return { canceled: false, filePath: p }; } }
  }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: מסמכים, זכות עיון ויומן בקשות — למנהל בלבד, נשמרים ונרשמים ביומן', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pv13-')));
  await handlers['auth:setup'](ev(201), 'pv_admin', 'pv-strong-pass-2026');
  await handlers['auth:login'](ev(201), 'pv_admin', 'pv-strong-pass-2026');
  await handlers['chesed:addBeneficiary'](ev(201), { familyName: 'ברגר', headName: 'אהרן ברגר', idNumber: '000000018', familySize: 3, tier: 'confidential' });

  const map = await handlers['privacy:getMap'](ev(201));
  assert.equal(map.level.level, 'medium');
  assert.ok(map.retentionKinds.donors && map.noticeKinds.donor && map.requestTypes.access);

  for (const [ch, arg] of [['privacy:exportDefinitionPdf'], ['privacy:exportProcedurePdf'], ['privacy:exportNoticePdf', 'borrower']]) {
    assert.equal((await handlers[ch](ev(201), arg)).ok, true, ch);
  }
  const subj = await handlers['privacy:exportSubjectPdf'](ev(201), '000000018');
  assert.equal(subj.ok, true);
  assert.equal(subj.count, 1);
  assert.match(fs.readFileSync(saved[saved.length - 1].p, 'utf8'), /אהרן ברגר/);
  assert.match(saved[0].name, /מסמך-הגדרות-מאגר/);

  const req = await handlers['privacy:addRequest'](ev(201), { type: 'access', name: 'אהרן ברגר', receivedDate: '2026-10-01' });
  assert.equal(req.dueDate, '2026-10-31');
  const closed = await handlers['privacy:closeRequest'](ev(201), req.id, { handledDate: '2026-10-02', notes: 'נמסר' });
  assert.equal(closed.status, 'done');
  assert.equal((await handlers['privacy:getMap'](ev(201))).requests[0].status, 'done', 'הבקשה נשמרה במסד');

  const log = await handlers['audit:list'](ev(201), { action: 'privacy.' });
  const actions = log.map(x => x.action);
  for (const a of ['privacy.doc.export', 'privacy.subject.export', 'privacy.request.add', 'privacy.request.close']) assert.ok(actions.includes(a), a);
  assert.match(log.find(x => x.action === 'privacy.subject.export').details, /000000018/);

  assert.deepEqual(await handlers['privacy:minimize'](ev(201), ['name:x'], 7, 'donors'), { minimized: 0, skipped: 1 });

  AuthService.getSession(201).permissions = ['data.view', 'data.edit', 'data.export', 'data.delete'];
  for (const ch of ['privacy:exportSubjectPdf', 'privacy:exportDefinitionPdf', 'privacy:addRequest', 'privacy:closeRequest']) {
    await assert.rejects(handlers[ch](ev(201), '18'), /אין הרשאה/, ch);
  }
});

test('ממשק: כפתורי הכרטיס, החשיפה ב-preload ואוסף privacy במסד', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const ui = read('modules/econ/ui/settings.js');
  for (const id of ['privacyDefinitionBtn', 'privacyProcedureBtn', 'privacyNoticeBtn', 'privacySubjectBtn', 'privacyRequestBtn', 'privacyRetentionKind']) assert.ok(ui.includes(`id="${id}"`), id);
  const pre = read('modules/econ/preload.js');
  for (const ch of ['exportDefinitionPdf', 'exportProcedurePdf', 'exportNoticePdf', 'exportSubjectPdf', 'addRequest', 'closeRequest']) assert.ok(pre.includes(`'privacy:${ch}'`), ch);
  assert.match(read('modules/econ/core/database.js'), /'privacy'/);
});
