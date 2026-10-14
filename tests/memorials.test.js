// הנצחות ויארצייטים: המרת תאריך פטירה לעברי (כולל אחרי השקיעה), אדר בשנה פשוטה/מעוברת,
// יום ל׳ שאינו קיים בכל שנה, טווח קרוב, ו-IPC עם הרשאות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const M = require('../modules/econ/core/memorials');
const H = require('../modules/econ/core/hebcal');

const mem = (x) => ({ id: x.name, ...M.validateMemorial(x) });
const has = H.available();

test('שנה מעוברת לפי מחזור 19', () => {
  assert.equal(M.isLeap(5784), true);
  assert.equal(M.isLeap(5786), false);
  assert.equal(M.isLeap(5787), true);
});

test('ולידציה: שם, חודש, יום ל׳, אדר לפי סוג השנה, ת.ז', () => {
  assert.throws(() => M.validateMemorial({ name: '', hebrewDay: 1, hebrewMonth: 'Nisan' }), /שם הנפטר/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 1, hebrewMonth: 'X' }), /חודש/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 30, hebrewMonth: 'Elul' }), /אין יום ל׳/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 5, hebrewMonth: 'Adar I', hebrewYear: 5786 }), /אין אדר א׳/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 5, hebrewMonth: 'Adar', hebrewYear: 5787, adarRule: 'adar2' }), /מעוברת/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 5, hebrewMonth: 'Adar' }), /באיזה אדר/);
  assert.throws(() => M.validateMemorial({ name: 'א', hebrewDay: 5, hebrewMonth: 'Nisan', contactId: '123456789' }), /ספרת ביקורת/);
  assert.equal(M.validateMemorial({ name: 'א', hebrewDay: 5, hebrewMonth: 'Nisan' }).hebrewYear, null);
});

test('תאריך פטירה לועזי מומר לעברי; אחרי השקיעה — היום הבא', { skip: !has }, () => {
  const a = M.validateMemorial({ name: 'ר׳ יצחק', deathDate: '2025-10-14' });
  const b = M.validateMemorial({ name: 'ר׳ יצחק', deathDate: '2025-10-14', afterSunset: '1' });
  assert.deepEqual([a.hebrewDay, a.hebrewMonth, a.hebrewYear], [22, 'Tishri', 5786]);
  assert.deepEqual([b.hebrewDay, b.hebrewMonth, b.hebrewYear], [23, 'Tishri', 5786]);
  assert.equal(M.validateMemorial({ name: 'א', deathDate: '2025-10-14', afterSunset: '0' }).afterSunset, false);
});

test('יארצייט קרוב: מספר שנים וימים שנותרו', { skip: !has }, () => {
  const u = M.upcoming([mem({ name: 'ר׳ יצחק', hebrewDay: 23, hebrewMonth: 'Tishri', hebrewYear: 5786 })], '2027-10-01', 60);
  assert.equal(u.rows.length, 1);
  assert.equal(u.rows[0].date, '2027-10-24');
  assert.equal(u.rows[0].years, 2);
  assert.equal(u.rows[0].daysLeft, 23);
  assert.equal(u.rows[0].uncertain, false);
});

test('ל׳ חשוון בשנה שבה לחשוון 29 יום — שני תאריכים, מסומנים לבירור', { skip: !has }, () => {
  const m = mem({ name: 'מרת שרה', hebrewDay: 30, hebrewMonth: 'Heshvan' });
  assert.deepEqual(M.upcoming([m], '2027-10-14', 60).rows.map(r => [r.date, r.uncertain]), [['2027-11-30', false]]);
  assert.deepEqual(M.upcoming([m], '2028-10-14', 60).rows.map(r => [r.date, r.uncertain]), [['2028-11-18', true], ['2028-11-19', true]]);
});

test('אדר: לפי הבחירה בשנה מעוברת, ואדר רגיל בשנה פשוטה', { skip: !has }, () => {
  const both = mem({ name: 'ר׳ משה', hebrewDay: 7, hebrewMonth: 'Adar', adarRule: 'both' });
  const second = mem({ name: 'ר׳ אהרן', hebrewDay: 7, hebrewMonth: 'Adar', adarRule: 'adar2' });
  assert.deepEqual(M.upcoming([both], '2027-01-01', 120).rows.map(r => r.date), ['2027-02-14', '2027-03-16']);
  assert.deepEqual(M.upcoming([second], '2027-01-01', 120).rows.map(r => r.date), ['2027-03-16']);
  assert.deepEqual(M.upcoming([second], '2028-01-01', 120).rows.map(r => r.date), ['2028-03-05']);
  const fromLeap = mem({ name: 'ר׳ שמואל', hebrewDay: 7, hebrewMonth: 'Adar II', hebrewYear: 5787 });
  assert.deepEqual(M.upcoming([fromLeap], '2028-01-01', 120).rows.map(r => r.date), ['2028-03-05'], 'נפטר באדר ב׳ — בשנה פשוטה באדר');
});

test('ייצוא: שורה לכל רשומה עם היארצייט הקרוב', { skip: !has }, () => {
  const m = mem({ name: 'מרת שרה', hebrewDay: 30, hebrewMonth: 'Heshvan', contactName: 'יוסף', contactPhone: '050-0000000' });
  const t = M.exportRows([m], M.upcoming([m], '2028-10-14', 60).rows);
  assert.equal(t.rows.length, 1);
  assert.match(t.rows[0][3], /2028-11-18 \(לבירור\)/);
  assert.equal(t.rows[0][2], 'ל׳ חשוון');
});

// ---------- IPC ----------
const handlers = {};
Module._resolveFilename_mem = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_mem__.js' : Module._resolveFilename_mem.call(this, req, ...rest); };
require.cache['/__electron_stub_mem__.js'] = {
  id: '/__electron_stub_mem__.js', filename: '/__electron_stub_mem__.js', loaded: true,
  exports: { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog: { showSaveDialog: async () => ({ canceled: true }) } }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

test('IPC: יצירה, עריכה שמרוקנת שדה, רשימה קרובה, מחיקה והרשאות', { skip: !has }, async () => {
  await ipc.initEcon(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mem-')));
  await handlers['auth:setup'](ev(95), 'mem_admin', 'mem-strong-pass-2026');
  await handlers['auth:login'](ev(95), 'mem_admin', 'mem-strong-pass-2026');
  const m = await handlers['npo:saveMemorial'](ev(95), null, { name: 'ר׳ יצחק', parentName: 'בן אברהם', deathDate: '2025-10-14', afterSunset: '1', plaque: 'לוח 3' });
  assert.equal(m.hebrewDay, 23);
  const u = await handlers['npo:saveMemorial'](ev(95), m.id, { plaque: '', deathDate: '', hebrewDay: 24, hebrewMonth: 'Tishri', hebrewYear: '' });
  assert.equal(u.plaque, '');
  assert.equal(u.deathDate, '');
  assert.equal(u.hebrewDay, 24);
  assert.equal(u.hebrewYear, null);
  const r = await handlers['npo:getMemorials'](ev(95), '2027-10-01', 60);
  assert.equal(r.list.length, 1);
  assert.equal(r.rows[0].date, '2027-10-25');
  assert.equal(r.list[0].hebrewLabel, 'כ״ד תשרי');
  await assert.rejects(handlers['npo:saveMemorial'](ev(95), 'nope', { name: 'א' }), /לא נמצאה/);
  AuthService.getSession(95).permissions = ['data.view'];
  await assert.rejects(handlers['npo:deleteMemorial'](ev(95), m.id), /אין הרשאה/);
  AuthService.getSession(95).permissions = ['data.view', 'data.edit', 'data.delete'];
  await handlers['npo:deleteMemorial'](ev(95), m.id);
  assert.equal((await handlers['npo:getMemorials'](ev(95))).list.length, 0);
});
