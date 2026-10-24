// קמפיינים: ולידציה, התקדמות עם תורם מכפיל ותקרה, שיוך תרומה (ידני וייבוא) לפי תקופה, מחיקה וסגירה.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const C = require('../modules/econ/core/campaigns');

const base = { name: 'בניין בית המדרש', goal: 100000, startDate: '2026-10-01', endDate: '2026-10-31' };

test('ולידציה: שם, יעד, תאריכים, הכפלה דורשת תקרה', () => {
  assert.throws(() => C.validateCampaign({ ...base, name: '' }), /שם הקמפיין/);
  assert.throws(() => C.validateCampaign({ ...base, goal: 0 }), /יעד/);
  assert.throws(() => C.validateCampaign({ ...base, endDate: '2026-09-01' }), /לפני/);
  assert.throws(() => C.validateCampaign({ ...base, matchRatio: 1 }), /תקרה/);
  assert.throws(() => C.validateCampaign({ ...base, fundId: 'x' }, { fundIds: ['general'] }), /הקרן/);
  const c = C.validateCampaign({ ...base, matchDonor: 'קרן משפחת ברגר', matchCap: 5000 });
  assert.equal(c.matchDonor, '', 'בלי יחס — אין הכפלה');
  assert.equal(c.matchCap, 0);
});

test('התקדמות: הכפלה עד התקרה, מבוטלות לא נספרות, תורמים ייחודיים', () => {
  const c = { id: 'c1', ...C.validateCampaign({ ...base, goal: 10000, matchDonor: 'מכפיל', matchRatio: 1, matchCap: 3000 }) };
  const ds = [
    { campaignId: 'c1', donorName: 'יעקב', donorId: '000000018', amount: 2000, status: 'active' },
    { campaignId: 'c1', donorName: 'יעקב', donorId: '000000018', amount: 500, status: 'active' },
    { campaignId: 'c1', donorName: 'משה', donorId: '', amount: 1000, status: 'active' },
    { campaignId: 'c1', donorName: 'אהרן', donorId: '', amount: 9999, status: 'cancelled' },
    { campaignId: 'other', donorName: 'שמעון', donorId: '', amount: 50, status: 'active' }
  ];
  const p = C.progress(c, ds, '2026-10-14');
  assert.equal(p.raised, 3500);
  assert.equal(p.matched, 3000, 'נעצר בתקרה');
  assert.equal(p.matchLeft, 0);
  assert.equal(p.total, 6500);
  assert.equal(p.percent, 65);
  assert.equal(p.remaining, 3500);
  assert.equal(p.donorsCount, 2);
  assert.equal(p.status, 'active');
  assert.equal(p.daysLeft, 17);
  assert.deepEqual(p.topDonors.map(t => [t.name, t.amount]), [['יעקב', 2500], ['משה', 1000]]);
});

test('סטטוס ומיון: פעיל, טרם התחיל, הסתיים, סגור', () => {
  const mk = (id, s, e, closed) => ({ id, ...C.validateCampaign({ ...base, name: id, startDate: s, endDate: e, closed }) });
  const r = C.summarize([mk('ended', '2026-01-01', '2026-01-31'), mk('closed', '2026-10-01', '2026-10-31', true), mk('soon', '2026-11-01', '2026-11-30'), mk('now', '2026-10-01', '2026-10-31')], [], '2026-10-14');
  assert.deepEqual(r.map(x => [x.name, x.status]), [['now', 'active'], ['soon', 'upcoming'], ['ended', 'ended'], ['closed', 'closed']]);
});

test('שיוך: מחוץ לתקופה או לקמפיין סגור — נדחה', () => {
  const c = { id: 'c1', ...C.validateCampaign(base) };
  assert.throws(() => C.assertCanAssign(c, '2026-09-30'), /מחוץ לתקופת/);
  assert.throws(() => C.assertCanAssign({ ...c, closed: true }, '2026-10-10'), /סגור/);
  assert.throws(() => C.assertCanAssign(null, '2026-10-10'), /לא נמצא/);
  C.assertCanAssign(c, '2026-10-31');
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_cmp = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_cmp__.js' : Module._resolveFilename_cmp.call(this, req, ...rest); };
require.cache['/__electron_stub_cmp__.js'] = {
  id: '/__electron_stub_cmp__.js', filename: '/__electron_stub_cmp__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

// המסד, המנהל והגדרות העמותה — לפני כל הבדיקות (ולא בתוך הראשונה): כל בדיקה רצה גם לבד או בסדר אחר
test.before(async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cmp-')));
  await handlers['auth:setup'](ev(99), 'cmp_admin', 'cmp-strong-pass-2026');
  await handlers['auth:login'](ev(99), 'cmp_admin', 'cmp-strong-pass-2026');
  await handlers['npo:saveSettings'](ev(99), { orgName: 'עמותת תורה וחסד' });
});

test('IPC: תרומה ידנית וייבוא משויכים לקמפיין, שורה מחוץ לתקופה נדחית, קמפיין עם תרומות לא נמחק', async () => {
  AuthService.getSession(99).permissions = ['data.view', 'data.edit', 'data.delete'];
  const c = await handlers['npo:saveCampaign'](ev(99), null, { ...base, matchRatio: 1, matchCap: 1000, matchDonor: 'קרן ברגר' });
  await assert.rejects(handlers['npo:addDonation'](ev(99), { donorName: 'יעקב', amount: 100, date: '2026-09-01', campaignId: c.id }), /מחוץ לתקופת/);
  await assert.rejects(handlers['npo:addDonation'](ev(99), { donorName: 'יעקב', amount: 100, date: '2026-10-02', campaignId: 'nope' }), /לא נמצא/);
  const d = await handlers['npo:addDonation'](ev(99), { donorName: 'יעקב', amount: 360, date: '2026-10-02', campaignId: c.id });
  assert.equal(d.campaignId, c.id);

  const csv = 'תאריך,שם,סכום,מספר עסקה\n05/10/2026,משה לוי,180,T1\n05/11/2026,אהרן,50,T2';
  const r = await handlers['npo:importDonations'](ev(99), csv, { source: 'nedarim', mapping: { date: 'תאריך', donorName: 'שם', amount: 'סכום', externalId: 'מספר עסקה' }, receipts: 'external', campaignId: c.id });
  assert.equal(r.imported, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /מחוץ לתקופת/);
  assert.equal(r.errors[0].line, 3);

  const ov = await handlers['npo:getOverview'](ev(99), 2026);
  const p = ov.campaigns.find(x => x.id === c.id);
  assert.equal(p.raised, 540);
  assert.equal(p.matched, 540);
  assert.equal(p.total, 1080);

  await assert.rejects(handlers['npo:saveCampaign'](ev(99), c.id, { startDate: '2026-10-03' }), /מחוץ לתקופה החדשה/);
  await assert.rejects(handlers['npo:deleteCampaign'](ev(99), c.id), /סגור/);
  const closed = await handlers['npo:saveCampaign'](ev(99), c.id, { closed: 'true' });
  assert.equal(closed.closed, true);
  await assert.rejects(handlers['npo:addDonation'](ev(99), { donorName: 'יעקב', amount: 1, date: '2026-10-03', campaignId: c.id }), /סגור/);
  await assert.rejects(handlers['npo:importDonations'](ev(99), csv, { source: 'nedarim', mapping: { date: 'תאריך', donorName: 'שם', amount: 'סכום' }, campaignId: c.id }), /סגור/);

  const empty = await handlers['npo:saveCampaign'](ev(99), null, { ...base, name: 'קמפיין ריק' });
  await handlers['npo:deleteCampaign'](ev(99), empty.id);
  AuthService.getSession(99).permissions = ['data.view'];
  await assert.rejects(handlers['npo:saveCampaign'](ev(99), null, base), /אין הרשאה/);
});

test('שגרירים: פענוח שורות, קודים ייחודיים, מזהה נשמר בעריכה, שגריר עם תרומות לא מוסר', () => {
  assert.deepEqual(C.parseAmbassadorsText('יוסי, Y1, 5000\nדוד'), [{ name: 'יוסי', code: 'Y1', goal: '5000' }, { name: 'דוד', code: '', goal: '' }]);
  assert.throws(() => C.validateAmbassadors([{ name: 'א', code: 'A' }, { name: 'ב', code: 'a' }]), /פעמיים/);
  assert.throws(() => C.validateAmbassadors([{ name: 'א', code: 'a b' }]), /אותיות/);
  let n = 0;
  const first = C.validateAmbassadors(C.parseAmbassadorsText('יוסי, Y1, 5000\nדוד, D2'), [], new Set(), () => 'id' + (++n));
  assert.deepEqual(first.map(a => [a.id, a.code, a.goal]), [['id1', 'Y1', 5000], ['id2', 'D2', 0]]);
  const again = C.validateAmbassadors(C.parseAmbassadorsText('יוסי פרידמן, Y1, 6000'), first, new Set(), () => 'new');
  assert.equal(again[0].id, 'id1', 'אותו קוד — אותו מזהה');
  assert.throws(() => C.validateAmbassadors([], first, new Set(['id2'])), /דוד.*תרומות/);
  const c = { ambassadors: first };
  assert.equal(C.findAmbassador(c, 'd2').id, 'id2');
  assert.equal(C.findAmbassador(c, 'יוסי').id, 'id1');
  assert.equal(C.findAmbassador(c, 'אחר'), null);
});

test('IPC: תרומה וייבוא עם שגריר; שגריר לא מוכר בייבוא — אזהרה; טבלת שגרירים', async () => {
  AuthService.getSession(99).permissions = ['data.view', 'data.edit', 'data.delete'];
  const c = await handlers['npo:saveCampaign'](ev(99), null, { ...base, name: 'קמפיין שגרירים', ambassadorsText: 'יוסי, Y1, 1000\nדוד, D2' });
  const yossi = c.ambassadors.find(a => a.code === 'Y1');
  await handlers['npo:addDonation'](ev(99), { donorName: 'חיים', amount: 200, date: '2026-10-05', campaignId: c.id, ambassadorId: yossi.id });
  await assert.rejects(handlers['npo:addDonation'](ev(99), { donorName: 'חיים', amount: 1, date: '2026-10-05', campaignId: c.id, ambassadorId: 'x' }), /אינו שייך/);
  const csv = 'תאריך,שם,סכום,שגריר\n06/10/2026,נחום,300,y1\n06/10/2026,ברוך,50,זלמן';
  const r = await handlers['npo:importDonations'](ev(99), csv, { source: 'other', mapping: { date: 'תאריך', donorName: 'שם', amount: 'סכום', ambassador: 'שגריר' }, campaignId: c.id });
  assert.equal(r.imported, 2);
  assert.deepEqual(r.errors.map(e => [e.line, !!e.warning]), [[3, true]]);
  const ov = await handlers['npo:getOverview'](ev(99), 2026);
  const rows = ov.campaigns.find(x => x.id === c.id).ambassadorRows;
  assert.deepEqual(rows.map(a => [a.code, a.raised, a.percent]), [['Y1', 500, 50], ['D2', 0, null]]);
  await assert.rejects(handlers['npo:saveCampaign'](ev(99), c.id, { ambassadorsText: 'דוד, D2' }), /יוסי.*תרומות/);
});
