// כלי עזר לתיקון 13: מיפוי מאגרים, מזעור נזקקים לא פעילים (תצוגה מקדימה + בדיקה חוזרת בשרת),
// רישום צפייה בנזקק חסוי ביומן, והרשאת מנהל בלבד.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const PR = require('../modules/econ/core/privacy');

const ch = {
  beneficiaries: [
    { id: 'old', familyName: 'כהן', headName: 'יעקב', idNumber: '000000018', phone: '050', address: 'רחוב', notes: 'מצב קשה', familySize: 5, area: 'צפון', tier: 'regular', active: false, createdAt: '2015-01-01T00:00:00Z' },
    { id: 'roundRecent', familyName: 'לוי', tier: 'regular', active: false, createdAt: '2015-01-01T00:00:00Z' },
    { id: 'active', familyName: 'גרוס', tier: 'regular', active: true, createdAt: '2015-01-01T00:00:00Z' },
    { id: 'done', familyName: 'רוזן', tier: 'regular', active: false, minimized: true, createdAt: '2015-01-01T00:00:00Z' }
  ],
  rounds: [{ id: 'r', date: '2024-03-01', allocations: [{ beneficiaryId: 'roundRecent' }] }]
};

test('מיפוי: ספירה לפי מאגר, נזקקים חסויים בנפרד, משתמשים לפי תפקיד', () => {
  const m = PR.dataMap({ chesed: { beneficiaries: [{ tier: 'confidential' }, { tier: 'regular' }] }, npo: { donations: [1, 2] } }, { admin: 1, viewer: 2 });
  const row = (a) => m.rows.find(r => r.area.startsWith(a));
  assert.equal(row('חסד — נזקקים חסויים').count, 1);
  assert.equal(row('חסד — נזקקים (רגילים)').count, 1);
  assert.equal(row('עמותה — תורמים').count, 2);
  assert.equal(row('חסד — נזקקים חסויים').sensitivity, 'high');
  assert.deepEqual(m.users, { admin: 1, editor: 0, viewer: 2 });
  assert.match(m.disclaimer, /אינו ייעוץ משפטי/);
});

test('מועמדים למזעור: לא פעיל, ללא פעילות (כולל סבב חלוקה) לפני התקופה, לא מוזער כבר', () => {
  assert.equal(PR.retentionCutoff('2026-10-14', 7), '2019-10-14');
  assert.throws(() => PR.retentionCutoff('2026-10-14', 0), /בין 1 ל-50/);
  assert.deepEqual(PR.retentionCandidates(ch, '2026-10-14', 7).map(x => x.id), ['old']);
  assert.deepEqual(PR.retentionCandidates(ch, '2026-10-14', 1).map(x => x.id).sort(), ['old', 'roundRecent']);
});

test('מזעור: פרטים מזהים נמחקים, שם משפחה/גודל/אזור נשמרים', () => {
  const m = PR.minimize(ch.beneficiaries[0], '2026-10-14T00:00:00Z');
  assert.deepEqual([m.headName, m.idNumber, m.phone, m.address, m.notes], ['', '', '', '', '']);
  assert.deepEqual([m.familyName, m.familySize, m.area, m.minimized, m.active], ['כהן', 5, 'צפון', true, false]);
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_pr = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_pr__.js' : Module._resolveFilename_pr.call(this, req, ...rest); };
require.cache['/__electron_stub_pr__.js'] = {
  id: '/__electron_stub_pr__.js', filename: '/__electron_stub_pr__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: צפייה בחסוי נרשמת ביומן; מזעור רק על מועמדים; למנהל בלבד', async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pr-')));
  await handlers['auth:setup'](ev(101), 'pr_admin', 'pr-strong-pass-2026');
  await handlers['auth:login'](ev(101), 'pr_admin', 'pr-strong-pass-2026');
  const conf = await handlers['chesed:addBeneficiary'](ev(101), { familyName: 'ברגר', headName: 'אהרן', idNumber: '000000018', familySize: 3, tier: 'confidential' });
  const reg = await handlers['chesed:addBeneficiary'](ev(101), { familyName: 'שפירא', headName: 'דוד', familySize: 2 });
  await handlers['chesed:getOverview'](ev(101));
  const log = await handlers['audit:list'](ev(101), { action: 'chesed.confidential' });
  assert.equal(log.length, 1);
  assert.match(log[0].details, /"count":1/);

  const map = await handlers['privacy:getMap'](ev(101));
  assert.equal(map.users.admin, 1);
  assert.ok(map.checklist.length >= 5);

  // הנזקק הרגיל נוצר עכשיו — אינו מועמד גם אם מסומן לא פעיל; בקשה למזער אותו נדחית בשרת
  await handlers['chesed:updateBeneficiary'](ev(101), reg.id, { active: false });
  assert.equal((await handlers['privacy:retentionPreview'](ev(101), 1)).rows.length, 0);
  const r = await handlers['privacy:minimize'](ev(101), [reg.id, conf.id], 1);
  assert.deepEqual(r, { minimized: 0, skipped: 2 });
  await assert.rejects(handlers['privacy:minimize'](ev(101), [], 1), /לא נבחרו/);

  AuthService.getSession(101).permissions = ['data.view', 'data.edit', 'data.export'];
  await assert.rejects(handlers['privacy:getMap'](ev(101)), /אין הרשאה/);
  await assert.rejects(handlers['privacy:minimize'](ev(101), [reg.id], 1), /אין הרשאה/);
  await handlers['chesed:getOverview'](ev(101));
  AuthService.getSession(101).permissions = ['users.manage', 'data.view'];
  assert.equal((await handlers['audit:list'](ev(101), { action: 'chesed.confidential' })).length, 1, 'מי שלא רואה חסויים — לא נרשם');
});

test('שירות: מזעור בפועל של מועמד שאושר, ושמירה אחת', async () => {
  const { PrivacyService: svc } = require('../modules/econ/services/privacyService');
  let data = { chesed: structuredClone(ch) };
  let saves = 0;
  const original = svc.db;
  svc.db = { load: async () => structuredClone(data), save: async (d) => { data = d; saves += 1; } };
  try {
    const r = await svc.minimize(['old', 'active'], 7, '2026-10-14');
    assert.deepEqual(r, { minimized: 1, skipped: 1 });
    assert.equal(saves, 1);
    const b = data.chesed.beneficiaries.find(x => x.id === 'old');
    assert.equal(b.minimized, true);
    assert.equal(b.idNumber, '');
    assert.equal(data.chesed.beneficiaries.find(x => x.id === 'active').minimized, undefined);
  } finally { svc.db = original; }
});
