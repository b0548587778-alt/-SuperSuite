// חסד וחלוקות: לוגיקה טהורה (שיוך מנות, שיבוץ לפי מחלקה, מסירה, הסתרת חסויים)
// + ערוצי IPC מול מסד אמיתי (הרשאות, חיסיון בצד השרת, גיבוי מוצפן וייצוא).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const C = require('../modules/econ/core/chesed');
const BK = require('../modules/econ/core/backupCrypto');

const ben = (id, extra = {}) => ({ id, ...C.validateBeneficiary({ familyName: 'משפחה ' + id, ...extra }) });
const vol = (id, extra = {}) => ({ id, ...C.validateVolunteer({ name: 'מתנדב ' + id, ...extra }) });
const round = (extra = {}) => ({ id: 'R1', ...C.validateRound({ name: 'קמחא דפסחא', date: '2026-03-20', unitValue: 150, ...extra }), status: 'open', allocations: [] });

// ---------- לוגיקה ----------

test('ולידציה: שם משפחה חובה, גודל משפחה תקין, ת.ז ספרות בלבד', () => {
  assert.throws(() => C.validateBeneficiary({ familyName: '' }), /שם המשפחה/);
  assert.throws(() => C.validateBeneficiary({ familyName: 'א', familySize: 0 }), /גודל המשפחה/);
  assert.throws(() => C.validateBeneficiary({ familyName: 'א', idNumber: '12ab' }), /זהות/);
  assert.equal(C.validateBeneficiary({ familyName: 'א' }).familySize, 1);
  assert.equal(C.validateBeneficiary({ familyName: 'א', active: 'no' }).active, false);
  assert.throws(() => C.validateRound({ name: '' }), /שם הסבב/);
  assert.equal(C.validateVolunteer({ name: 'א', division: '' }).division, 'none', 'מחלקה ריקה = ללא הפרדה');
});

test('שיוך: מנה לכל משפחה, או לפי גודל (מעוגל למעלה); לא פעילים ומשויכים כבר — מדולגים', () => {
  const bens = [ben('a', { familySize: 9 }), ben('b', { familySize: 2 }), ben('c', { active: 'no' })];
  const r1 = C.allocate(round(), bens);
  assert.equal(r1.added, 2);
  assert.deepEqual(r1.round.allocations.map(a => a.units), [1, 1]);
  const r2 = C.allocate(round({ rule: 'bySize', personsPerUnit: 4 }), bens);
  assert.deepEqual(r2.round.allocations.map(a => a.units), [3, 1], '9 נפשות = 3 מנות; 2 נפשות = מנה אחת');
  const again = C.allocate(r2.round, [...bens, ben('d')]);
  assert.equal(again.added, 1, 'רק משפחה חדשה נוספת');
  assert.throws(() => C.allocate({ ...r2.round, status: 'closed' }, bens), /סגור/);
});

test('שיבוץ מתנדב: סבב עם מחלקה מקבל רק מתנדב מאותה מחלקה; מתנדב לא פעיל נדחה', () => {
  const r = C.allocate(round({ division: 'women' }), [ben('a')]).round;
  assert.throws(() => C.assignVolunteer(r, 'a', vol('m', { division: 'men' })), /מחלקת נשים/);
  assert.throws(() => C.assignVolunteer(r, 'a', vol('w2', { division: 'women', active: 'no' })), /אינו פעיל/);
  const ok = C.assignVolunteer(r, 'a', vol('w', { division: 'women' }));
  assert.equal(ok.allocations[0].volunteerId, 'w');
  assert.equal(C.assignVolunteer(ok, 'a', null).allocations[0].volunteerId, '', 'ביטול שיבוץ');
  const open = C.allocate(round(), [ben('a')]).round;
  assert.equal(C.assignVolunteer(open, 'a', vol('m', { division: 'men' })).allocations[0].volunteerId, 'm', 'בלי מחלקה — כל מתנדב');
});

test('מסירה וסיכום: שווי מנות מדויק באגורות', () => {
  let r = C.allocate(round({ unitValue: 0.1, rule: 'bySize', personsPerUnit: 1 }), [ben('a', { familySize: 3 }), ben('b')]).round;
  r = C.markDelivered(r, 'a', true, '2026-03-21');
  const s = C.roundSummary(r);
  assert.equal(s.units, 4);
  assert.equal(s.totalValue, 0.4);
  assert.equal(s.deliveredValue, 0.3);
  assert.equal(s.delivered, 1);
  assert.equal(r.allocations[0].deliveredAt, '2026-03-21');
  assert.equal(C.markDelivered(r, 'a', false).allocations[0].deliveredAt, '', 'ביטול מסירה מנקה תאריך');
});

test('חיסיון: נזקק חסוי מוסתר למי שאינו מורשה — גם בייצוא', () => {
  const b = ben('a', { familyName: 'לוי', idNumber: '123456782', address: 'רחוב א 1', tier: 'confidential' });
  const masked = C.maskBeneficiary(b, false);
  assert.equal(masked.familyName, 'משפחה חסויה');
  assert.equal(masked.idNumber, '');
  assert.equal(masked.address, '');
  assert.equal(C.maskBeneficiary(b, true).familyName, 'לוי');
  const t = C.exportTable('beneficiaries', { beneficiaries: [b], volunteers: [], rounds: [] }, false);
  assert.ok(!JSON.stringify(t.rows).includes('לוי'));
  assert.ok(!JSON.stringify(t.rows).includes('123456782'));
});

// ---------- IPC מול מסד אמיתי ----------

const handlers = {};
let saveTarget = null;
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_chesed__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_chesed__.js'] = {
  id: '/__electron_stub_chesed__.js', filename: '/__electron_stub_chesed__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async () => (saveTarget ? { canceled: false, filePath: saveTarget } : { canceled: true }) }
  }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chesed-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(id), 'chesed_admin', 'chesed-strong-pass-2026');
  await handlers['auth:login'](ev(id), 'chesed_admin', 'chesed-strong-pass-2026');
  return dir;
}

test('IPC חסד: דורש כניסה; צפייה בלבד לא משבצת ולא מסמנת מסירה', async () => {
  await freshLogin(71);
  await assert.rejects(handlers['chesed:getOverview'](ev(199)), /נדרשת כניסה/);
  const b = await handlers['chesed:addBeneficiary'](ev(71), { familyName: 'כהן' });
  const r = await handlers['chesed:addRound'](ev(71), { name: 'סוכות', date: '2026-10-01' });
  await handlers['chesed:allocateRound'](ev(71), r.id);
  AuthService.getSession(71).permissions = ['data.view'];
  const o = await handlers['chesed:getOverview'](ev(71));
  assert.equal(o.rounds[0].allocations.length, 1, 'צפייה מותרת');
  await assert.rejects(handlers['chesed:markDelivered'](ev(71), r.id, b.id, true), /אין הרשאה/);
  await assert.rejects(handlers['chesed:addVolunteer'](ev(71), { name: 'א' }), /אין הרשאה/);
  await assert.rejects(handlers['chesed:deleteBeneficiary'](ev(71), b.id), /אין הרשאה/);
});

test('IPC חסד: חסוי מוסתר בצד השרת למשתמש שאינו מנהל, ואינו ניתן לעריכה על ידו', async () => {
  await freshLogin(72);
  const b = await handlers['chesed:addBeneficiary'](ev(72), { familyName: 'שטרן', idNumber: '111222337', tier: 'confidential' });
  assert.equal((await handlers['chesed:getOverview'](ev(72))).beneficiaries[0].familyName, 'שטרן', 'מנהל רואה');
  AuthService.getSession(72).permissions = ['data.view', 'data.edit', 'data.export', 'data.delete'];
  const o = await handlers['chesed:getOverview'](ev(72));
  assert.equal(o.canSeeConfidential, false);
  assert.equal(o.beneficiaries[0].familyName, 'משפחה חסויה');
  assert.equal(o.beneficiaries[0].idNumber, '');
  await assert.rejects(handlers['chesed:updateBeneficiary'](ev(72), b.id, { familyName: 'x' }), /חסוי/);
  saveTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chesed-csv-')), 'b.csv');
  const r = await handlers['chesed:exportCsv'](ev(72), 'beneficiaries');
  saveTarget = null;
  const csv = fs.readFileSync(r.path, 'utf8');
  assert.doesNotMatch(csv, /שטרן|111222337/, 'הייצוא אינו חושף נזקק חסוי');
});

test('IPC חסד: סבב מלא — שיוך, שיבוץ, מסירה, סגירה; אין מחיקה של מה שכבר נמסר', async () => {
  await freshLogin(73);
  const a = await handlers['chesed:addBeneficiary'](ev(73), { familyName: 'אברהם', familySize: 8 });
  const v = await handlers['chesed:addVolunteer'](ev(73), { name: 'יצחק', division: 'men' });
  const r = await handlers['chesed:addRound'](ev(73), { name: 'קמחא דפסחא', date: '2026-03-20', rule: 'bySize', personsPerUnit: 4, unitValue: 200, division: 'men' });
  assert.equal((await handlers['chesed:allocateRound'](ev(73), r.id)).added, 1);
  await handlers['chesed:assignVolunteer'](ev(73), r.id, a.id, v.id);
  await assert.rejects(handlers['chesed:deleteVolunteer'](ev(73), v.id), /משובץ בסבב פתוח/);
  const s = await handlers['chesed:markDelivered'](ev(73), r.id, a.id, true, '2026-03-21');
  assert.equal(s.deliveredValue, 400, '2 מנות × 200 ₪');
  await assert.rejects(handlers['chesed:deleteRound'](ev(73), r.id), /נרשמו מסירות/);
  await assert.rejects(handlers['chesed:deleteBeneficiary'](ev(73), a.id), /לא פעיל/);
  await handlers['chesed:closeRound'](ev(73), r.id);
  await assert.rejects(handlers['chesed:markDelivered'](ev(73), r.id, a.id, false), /סגור/);
  saveTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chesed-csv-')), 'r.csv');
  const ex = await handlers['chesed:exportCsv'](ev(73), 'round', r.id);
  saveTarget = null;
  const csv = fs.readFileSync(ex.path, 'utf8');
  assert.match(csv, /יצחק/);
  assert.match(csv, /נמסר/);
});

test('IPC חסד: הנתונים נכנסים לגיבוי המוצפן הקיים ומשוחזרים ממנו', async () => {
  await freshLogin(74);
  await handlers['chesed:addBeneficiary'](ev(74), { familyName: 'ברגר' });
  const enc = await handlers['data:backupEncrypted'](ev(74), 'backup-pass-123');
  assert.ok(BK.isEncryptedBackup(enc));
  assert.doesNotMatch(enc, /ברגר/, 'אין טקסט גלוי בגיבוי');
  await freshLogin(75);
  await handlers['data:restoreEncrypted'](ev(75), enc, 'backup-pass-123');
  assert.equal((await handlers['chesed:getOverview'](ev(75))).beneficiaries[0].familyName, 'ברגר');
});
