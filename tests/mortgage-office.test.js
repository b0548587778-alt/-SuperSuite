// משרד ייעוץ משכנתאות (שלב 1): כמה יועצים, מי רואה אילו תיקים, שלבי תיק, ימים בשלב ולוח עמודות.
// כולל IPC מול מסד אמיתי עם שני יועצים ומנהל.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const M = require('../modules/econ/core/mortgageAdvisor');

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// ---------- לוגיקה ----------

test('שלבים: סטטוס ישן מומר לשלב המקביל, תווית בעברית מזוהה, וערך לא מוכר ← פנייה', () => {
  assert.equal(M.normalizeStage('preparing'), 'documents');
  assert.equal(M.normalizeStage('approved-principle'), 'principle');
  assert.equal(M.normalizeStage('approved-final'), 'final');
  assert.equal(M.normalizeStage('אישורים עקרוניים'), 'principle');
  assert.equal(M.normalizeStage('הוגש'), 'submitted', 'קובץ שיוצא מהגרסה הקודמת');
  const P = require('../modules/econ/core/dataPorts');
  const parsed = P.parseImport('mortgageClients', 'שם,סכום מבוקש,סטטוס\nא,1,אושר סופי\nב,1,\nג,1,משהו אחר\n', { mortgageAdvisor: { clients: [] } });
  assert.deepEqual(parsed.records.map(r => r.status), ['final', 'lead']);
  assert.equal(parsed.errors.length, 1);
  assert.equal(M.validateClient({ name: 'א', requestedAmount: 1, status: 'zzz' }).status, 'lead');
  assert.equal(M.clientStored({ id: 'x', name: 'א', requestedAmount: 1, status: 'approved-final' }).status, 'final');
  const lost = M.validateClient({ name: 'א', requestedAmount: 1, status: 'lost', lostReason: 'בחר בנק אחר' });
  assert.equal(lost.lostReason, 'בחר בנק אחר');
  assert.equal(M.validateClient({ name: 'א', requestedAmount: 1, status: 'meeting', lostReason: 'x' }).lostReason, '', 'סיבה רק לתיק שלא התקדם');
});

test('מי רואה: יועץ — שלו ולא משויכים; מנהל — הכול; ownOnly כבוי — כולם הכול', () => {
  const a = { id: 'A' }, b = { id: 'B' }, mgr = { id: 'M', isManager: true };
  const mine = { advisorId: 'A' }, other = { advisorId: 'B' }, free = { advisorId: '' };
  assert.equal(M.canSee(mine, a, {}), true);
  assert.equal(M.canSee(free, a, {}), true);
  assert.equal(M.canSee(other, a, {}), false);
  assert.equal(M.canSee(other, mgr, {}), true);
  assert.equal(M.canSee(other, b, { ownOnly: false }), true);
  assert.equal(M.canSee(other, a, { ownOnly: false }), true);
});

test('שיוך: יועץ משייך רק לעצמו; מנהל — לכל יועץ פעיל; שיוך קיים נשמר', () => {
  const ids = ['A', 'B'];
  assert.equal(M.resolveAdvisor('A', '', { id: 'A' }, ids), 'A');
  assert.throws(() => M.resolveAdvisor('B', '', { id: 'A' }, ids), /רק מנהל/);
  assert.equal(M.resolveAdvisor(undefined, 'B', { id: 'A' }, ids), 'B', 'בלי שינוי — השיוך נשאר');
  assert.equal(M.resolveAdvisor('B', 'A', { id: 'M', isManager: true }, ids), 'B');
  assert.throws(() => M.resolveAdvisor('ghost', '', { id: 'M', isManager: true }, ids), /אינו משתמש פעיל/);
  assert.equal(M.resolveAdvisor('', 'A', { id: 'M', isManager: true }, ids), '', 'מנהל מבטל שיוך');
});

test('היסטוריית שלבים וימים בשלב', () => {
  const t0 = Date.parse('2026-10-01T08:00:00Z');
  let c = M.withStage({}, { status: 'lead' }, { id: 'A' }, iso(t0));
  c = M.withStage(c, { ...c, status: 'lead' }, { id: 'A' }, iso(t0 + 2 * DAY));
  assert.equal(c.stageHistory.length, 1, 'עדכון בלי שינוי שלב לא נרשם');
  c = M.withStage(c, { ...c, status: 'documents' }, { id: 'A' }, iso(t0 + 3 * DAY));
  assert.deepEqual(c.stageHistory.map(h => h.stage), ['lead', 'documents']);
  assert.equal(M.daysInStage(c, t0 + 10 * DAY), 7);
  assert.equal(M.daysInStage({ status: 'lead', createdAt: iso(t0) }, t0 + 5 * DAY), 5, 'תיק ישן בלי היסטוריה — מתאריך היצירה');
});

test('לוח עמודות: כל השלבים, תקוע רק בתיק פתוח, סיכום סכומים באגורות', () => {
  const now = Date.parse('2026-10-20T08:00:00Z');
  const mk = (id, status, daysAgo, amount) => ({ id, name: 'תיק ' + id, status, requestedAmount: amount, stageHistory: [{ stage: status, at: iso(now - daysAgo * DAY) }] });
  const b = M.pipelineBoard([mk('1', 'lead', 30, 100000.1), mk('2', 'lead', 2, 200000.2), mk('3', 'closed', 90, 1), mk('4', 'documents', 15, 5)],
    { nowMs: now, settings: { stuckDays: 14 } });
  assert.deepEqual(b.columns.map(c => c.stage), M.STAGE_KEYS);
  const lead = b.columns.find(c => c.stage === 'lead');
  assert.deepEqual(lead.cards.map(c => c.id), ['1', '2'], 'הוותיק ראשון');
  assert.equal(lead.total, 300000.3);
  assert.equal(b.stuckCount, 2, 'תיק 1 ותיק 4 — לא התיק הסגור');
  assert.equal(b.openCount, 3);
});

test('הגדרות משרד: ברירת מחדל — יועץ רואה רק שלו, 14 ימים; ערכים לא תקינים נדחים', () => {
  assert.deepEqual(M.normalizeSettings(undefined), { ownOnly: true, stuckDays: 14 });
  assert.deepEqual(M.normalizeSettings({ ownOnly: false, stuckDays: 0 }), { ownOnly: false, stuckDays: 14 });
  assert.deepEqual(M.normalizeSettings({ stuckDays: 30 }), { ownOnly: true, stuckDays: 30 });
});

// ---------- IPC מול מסד אמיתי: מנהל ושני יועצים ----------

const handlers = {};
Module._resolveFilename_orig_office = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_office__.js' : Module._resolveFilename_orig_office.call(this, req, ...rest); };
require.cache['/__electron_stub_office__.js'] = {
  id: '/__electron_stub_office__.js', filename: '/__electron_stub_office__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const ev = (id) => ({ sender: { id } });

test('IPC משרד: יועץ רואה ומשנה רק את שלו, מנהל רואה הכול ומשייך, והגדרות — למנהל בלבד', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-office-')));
  await handlers['auth:setup'](ev(61), 'menahel', 'menahel-strong-pass-1');
  await handlers['auth:login'](ev(61), 'menahel', 'menahel-strong-pass-1');
  const ua = await handlers['users:create'](ev(61), { username: 'yoetz_a', password: 'yoetz-a-strong-pass', role: 'editor' });
  const ub = await handlers['users:create'](ev(61), { username: 'yoetz_b', password: 'yoetz-b-strong-pass', role: 'editor' });
  await handlers['auth:login'](ev(62), 'yoetz_a', 'yoetz-a-strong-pass');
  await handlers['auth:login'](ev(63), 'yoetz_b', 'yoetz-b-strong-pass');

  const ca = await handlers['madv:createClient'](ev(62), { name: 'משפחת כץ', requestedAmount: 800000 });
  assert.equal(ca.advisorId, ua.id, 'תיק של יועץ משויך אליו');
  assert.equal(ca.status, 'lead');
  await assert.rejects(handlers['madv:createClient'](ev(62), { name: 'א', requestedAmount: 1, advisorId: ub.id }), /רק מנהל/);
  const cb = await handlers['madv:createClient'](ev(63), { name: 'משפחת שפירא', requestedAmount: 600000 });

  const ovA = await handlers['madv:getOverview'](ev(62));
  assert.deepEqual(ovA.clients.map(c => c.name), ['משפחת כץ'], 'יועץ א לא רואה את התיק של ב');
  assert.equal(ovA.me.isManager, false);
  assert.equal(ovA.board.openCount, 1);
  await assert.rejects(handlers['madv:updateClient'](ev(62), cb.id, { status: 'meeting' }), /לא נמצא/);
  await assert.rejects(handlers['madv:deleteClient'](ev(62), cb.id), /אין הרשאה|לא נמצא/, 'עורך אינו מוחק בכלל');
  await assert.rejects(handlers['madv:toggleDoc'](ev(62), cb.id, 'id'), /לא נמצא/);
  await assert.rejects(handlers['madv:addOffer'](ev(62), { clientId: cb.id, bank: 'בנק', prime_amount: 1, prime_rate: 1, prime_years: 1 }), /תיק לקוח/);

  const ovM = await handlers['madv:getOverview'](ev(61));
  assert.equal(ovM.clients.length, 2, 'מנהל רואה הכול');
  assert.ok(ovM.advisors.some(a => a.name === 'yoetz_a') && ovM.advisors.some(a => a.name === 'menahel'));
  assert.equal(ovM.clients.find(c => c.id === cb.id).advisorName, 'yoetz_b');

  // מנהל מעביר את תיק ב ליועץ א — עכשיו א רואה אותו ומקדם שלב
  await handlers['madv:updateClient'](ev(61), cb.id, { advisorId: ua.id });
  const moved = await handlers['madv:updateClient'](ev(62), cb.id, { status: 'documents' });
  assert.equal(moved.status, 'documents');
  assert.deepEqual(moved.stageHistory.map(h => h.stage), ['lead', 'documents']);
  assert.equal((await handlers['madv:getOverview'](ev(63))).clients.length, 0, 'יועץ ב כבר לא רואה את התיק');

  await assert.rejects(handlers['madv:saveSettings'](ev(62), { ownOnly: false }), /אין הרשאה/);
  await handlers['madv:saveSettings'](ev(61), { ownOnly: false });
  assert.equal((await handlers['madv:getOverview'](ev(63))).clients.length, 2, 'אחרי כיבוי — כולם רואים הכול');
});

test('המסך: לוח עמודות, יועץ וימים בשלב; הגדרות רק למנהל; שדה היועץ מוגבל ליועץ עצמו', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'ui', 'mortgage-advisor.js'), 'utf8');
  assert.match(src, /ss-board/);
  assert.match(src, /saveMortgageOfficeSettings/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'modules', 'econ', 'preload.js'), 'utf8');
  assert.match(preload, /saveMortgageOfficeSettings: \(input\) => ipcRenderer\.invoke\('madv:saveSettings', input\)/);
  const kit = fs.readFileSync(path.join(__dirname, '..', 'shell', 'ui-kit.css'), 'utf8');
  for (const c of ['.ss-board', '.ss-board-col', '.ss-board-card', '.is-stuck']) assert.ok(kit.includes(c), c);
});
