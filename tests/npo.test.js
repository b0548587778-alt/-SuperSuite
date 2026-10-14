// עמותות: לוגיקה טהורה (קבלות סעיף 46, קרנות, דוח שנתי) + ערוצי IPC מול מסד אמיתי
// (הרשאות, הפרדה מהיומן העסקי, גיבוי מוצפן וייצוא).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const N = require('../modules/econ/core/npo');
const BK = require('../modules/econ/core/backupCrypto');

let nextId = 0;
const newId = () => 'f' + (++nextId);
const SETTINGS = N.applySettings({}, {
  orgName: 'עמותת חסד ותורה', regNumber: '580123456', sec46Number: '4321', sec46ValidUntil: '2026-12-31',
  fundsText: 'בניין בית המדרש\nקופת צדקה'
}, new Set(), newId);

// ---------- לוגיקה ----------

test('עמותה: ברירת המחדל היא פטורה ממע"מ; עוסק מורשה מחייב מספר עוסק', () => {
  assert.equal(N.normalizeSettings({}).vatStatus, 'exempt');
  assert.equal(SETTINGS.vatStatus, 'exempt');
  assert.throws(() => N.applySettings(SETTINGS, { orgName: 'א', vatStatus: 'osek' }, new Set(), newId), /מספר עוסק/);
  const osek = N.applySettings(SETTINGS, { orgName: 'א', vatStatus: 'osek', vatNumber: '512345678' }, new Set(), newId);
  assert.equal(osek.vatStatus, 'osek');
  const malkar = N.applySettings(SETTINGS, { orgName: 'א', vatStatus: 'malkar', vatNumber: '512345678' }, new Set(), newId);
  assert.equal(malkar.vatNumber, '', 'מספר עוסק לא נשמר כשאין מעמד עוסק');
  assert.throws(() => N.applySettings({}, { orgName: 'א', regNumber: '123' }, new Set(), newId), /9 ספרות/);
});

test('קבלות: מספור רץ, וזכאות סעיף 46 לפי תוקף האישור ביום התרומה', () => {
  const d1 = N.validateDonation({ date: '2026-03-01', donorName: 'משה כהן', amount: 180 }, SETTINGS);
  const a = N.issueReceipt(d1, SETTINGS);
  assert.equal(a.receipt.number, 1);
  assert.equal(a.receipt.sec46, true);
  assert.equal(a.receipt.sec46Number, '4321');
  const d2 = N.validateDonation({ date: '2027-01-05', donorName: 'משה כהן', amount: 180 }, a.settings);
  const b = N.issueReceipt(d2, a.settings);
  assert.equal(b.receipt.number, 2);
  assert.equal(b.receipt.sec46, false, 'אחרי תום תוקף האישור — הקבלה אינה מזכה');
  const noApproval = N.applySettings(SETTINGS, { orgName: 'א', sec46Number: '' }, new Set(), newId);
  assert.equal(N.sec46Eligible(noApproval, '2026-01-01'), false);
});

test('תרומה: ולידציה בעברית, וסכומים מעוגלים לאגורה', () => {
  assert.throws(() => N.validateDonation({ donorName: '', amount: 10 }, SETTINGS), /שם התורם/);
  assert.throws(() => N.validateDonation({ donorName: 'א', amount: -1 }, SETTINGS), /סכום/);
  assert.throws(() => N.validateDonation({ donorName: 'א', amount: 5, fundId: 'nope' }, SETTINGS), /הקרן/);
  assert.throws(() => N.validateDonation({ donorName: 'א', amount: 5, donorId: '12ab' }, SETTINGS), /זהות/);
  assert.equal(N.validateDonation({ donorName: 'א', amount: 10.005 }, SETTINGS).amount, 10.01);
});

test('קרנות: הפרדה בין ייעודי לכללי, וסכומים מדויקים באגורות (0.1+0.2)', () => {
  const building = SETTINGS.funds.find(f => f.name === 'בניין בית המדרש');
  const donations = [
    { date: '2026-01-01', amount: 0.1, fundId: 'general', receipt: {} },
    { date: '2026-01-02', amount: 0.2, fundId: 'general', receipt: {} },
    { date: '2026-01-03', amount: 1000, fundId: building.id, receipt: {} },
    { date: '2026-01-04', amount: 500, fundId: building.id, status: 'cancelled', receipt: {} },
    { date: '2025-12-31', amount: 99, fundId: 'general', receipt: {} }
  ];
  const grants = [{ year: 2026, received: 250.5, fundId: building.id }];
  const s = N.fundSummary(donations, grants, SETTINGS, 2026);
  assert.equal(s.generalTotal, 0.3);
  assert.equal(s.restrictedTotal, 1250.5, 'תרומה מבוטלת לא נספרת; תמיכה נכנסת לקרן שלה');
  assert.equal(s.total, 1250.8);
});

test('קרן שהוסרה מההגדרות אך יש לה תנועות — נשמרת כארכיון ולא נמחקת', () => {
  const building = SETTINGS.funds.find(f => f.name === 'בניין בית המדרש');
  const next = N.applySettings(SETTINGS, { orgName: 'א', fundsText: 'קופת צדקה' }, new Set([building.id]), newId);
  const kept = next.funds.find(f => f.id === building.id);
  assert.ok(kept && kept.archived, 'הקרן נשמרת בארכיון');
  assert.throws(() => N.validateDonation({ donorName: 'א', amount: 5, fundId: building.id }, next), /הקרן/, 'לא ניתן לתרום לקרן בארכיון');
  const tz = next.funds.find(f => f.name === 'קופת צדקה');
  assert.equal(tz.id, SETTINGS.funds.find(f => f.name === 'קופת צדקה').id, 'מזהה קרן קיימת אינו משתנה');
});

test('דוח שנתי: תורמים גדולים לפי סף, תמיכות לפי גורם, ותורם מזוהה לפי ת.ז', () => {
  const s = { ...SETTINGS, largeDonorThreshold: 1000 };
  const donations = [
    { date: '2026-02-01', donorName: 'יעקב לוי', donorId: '123456789', amount: 600, method: 'transfer', fundId: 'general', receipt: { sec46: true } },
    { date: '2026-05-01', donorName: 'יעקב לוי (שם מעודכן)', donorId: '123456789', amount: 600, method: 'cash', fundId: 'general', receipt: { sec46: false } },
    { date: '2026-06-01', donorName: 'אברהם שטרן', amount: 50, method: 'cash', fundId: 'general', receipt: { sec46: true } }
  ];
  const grants = [
    { year: 2026, source: 'משרד החינוך', approved: 10000, received: 4000 },
    { year: 2026, source: 'משרד החינוך', approved: 2000, received: 2000 },
    { year: 2025, source: 'עירייה', approved: 1, received: 1 }
  ];
  const r = N.annualReport(donations, grants, s, 2026);
  assert.equal(r.donationsTotal, 1250);
  assert.equal(r.sec46Total, 650);
  assert.equal(r.donorsCount, 2);
  assert.equal(r.largeDonors.length, 1);
  assert.equal(r.largeDonors[0].name, 'יעקב לוי (שם מעודכן)', 'הפרטים מהתרומה האחרונה');
  assert.deepEqual(r.grants, [{ source: 'משרד החינוך', count: 2, approved: 12000, received: 6000 }]);
  const t = N.exportTable('summary', donations, grants, s, 2026);
  assert.ok(t.rows.some(row => row[0] === 'סה"כ תרומות' && row[1] === 1250));
});

// ---------- IPC מול מסד אמיתי ----------

const handlers = {};
const saved = [];
let saveTarget = null;
Module._resolveFilename_orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'electron' ? '/__electron_stub_npo__.js' : Module._resolveFilename_orig.call(this, req, ...rest); };
require.cache['/__electron_stub_npo__.js'] = {
  id: '/__electron_stub_npo__.js', filename: '/__electron_stub_npo__.js', loaded: true,
  exports: {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showSaveDialog: async (opts) => { saved.push(opts); return saveTarget ? { canceled: false, filePath: saveTarget } : { canceled: true }; } }
  }
};
const ipc = require('../modules/econ/ipc');
const { AuthService } = require('../modules/econ/services/authService');
const ev = (id) => ({ sender: { id } });

async function freshLogin(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npo-'));
  await ipc.initEcon(dir);
  await handlers['auth:setup'](ev(id), 'npo_admin', 'npo-strong-pass-2026');
  await handlers['auth:login'](ev(id), 'npo_admin', 'npo-strong-pass-2026');
  return dir;
}

test('IPC עמותה: דורש כניסה; צפייה בלבד לא יכולה להפיק קבלה או לבטל', async () => {
  await freshLogin(41);
  await assert.rejects(handlers['npo:getOverview'](ev(99), 2026), /נדרשת כניסה/);
  await assert.rejects(handlers['npo:addDonation'](ev(99), { donorName: 'א', amount: 1 }), /נדרשת כניסה/);
  await handlers['npo:saveSettings'](ev(41), { orgName: 'עמותת חסד ותורה' });
  const d = await handlers['npo:addDonation'](ev(41), { date: '2026-04-01', donorName: 'א', amount: 1 });
  AuthService.getSession(41).permissions = ['data.view'];
  const o = await handlers['npo:getOverview'](ev(41), 2026);
  assert.equal(o.donations.length, 1, 'צפייה מותרת');
  await assert.rejects(handlers['npo:addDonation'](ev(41), { donorName: 'א', amount: 1 }), /אין הרשאה/);
  await assert.rejects(handlers['npo:cancelDonation'](ev(41), d.id), /אין הרשאה/);
  await assert.rejects(handlers['npo:exportCsv'](ev(41), 'donations', 2026), /אין הרשאה/);
});

test('IPC עמותה: קבלה מחייבת פרטי עמותה; ביטול שורף את המספר; לא נוגע ביומן העסקי', async () => {
  await freshLogin(42);
  await assert.rejects(handlers['npo:addDonation'](ev(42), { donorName: 'א', amount: 5 }), /פרטי העמותה/);
  await handlers['npo:saveSettings'](ev(42), { orgName: 'עמותת חסד ותורה', sec46Number: '1', fundsText: 'קופת צדקה' });
  const journalBefore = (await handlers['acct:getJournal'](ev(42), {})).length;
  const a = await handlers['npo:addDonation'](ev(42), { date: '2026-04-01', donorName: 'משה', amount: 100 });
  await handlers['npo:cancelDonation'](ev(42), a.id);
  await assert.rejects(handlers['npo:cancelDonation'](ev(42), a.id), /כבר בוטלה/);
  const b = await handlers['npo:addDonation'](ev(42), { date: '2026-04-02', donorName: 'משה', amount: 100 });
  assert.equal(b.receipt.number, 2, 'מספר קבלה שבוטלה לא חוזר');
  assert.equal((await handlers['acct:getJournal'](ev(42), {})).length, journalBefore, 'תרומה אינה נרשמת ביומן העסקי');
  const o = await handlers['npo:getOverview'](ev(42), 2026);
  assert.equal(o.report.donationsTotal, 100);
  assert.equal(o.donations.length, 2, 'הקבלה המבוטלת נשארת ברשימה');
});

test('IPC עמותה: הנתונים נכנסים לגיבוי המוצפן הקיים ומשוחזרים ממנו', async () => {
  await freshLogin(43);
  await handlers['npo:saveSettings'](ev(43), { orgName: 'עמותת חסד ותורה' });
  await handlers['npo:addDonation'](ev(43), { date: '2026-04-01', donorName: 'אהרן', amount: 360 });
  await handlers['npo:addGrant'](ev(43), { source: 'משרד הרווחה', year: 2026, approved: 1000, received: 500 });
  const enc = await handlers['data:backupEncrypted'](ev(43), 'backup-pass-123');
  assert.ok(BK.isEncryptedBackup(enc));
  assert.doesNotMatch(enc, /אהרן/, 'אין טקסט גלוי בגיבוי');
  const plain = JSON.parse(BK.decryptBackup(enc, 'backup-pass-123'));
  assert.equal(plain.npo.donations[0].donorName, 'אהרן');

  await freshLogin(44);
  assert.equal((await handlers['npo:getOverview'](ev(44), 2026)).donations.length, 0);
  await handlers['data:restoreEncrypted'](ev(44), enc, 'backup-pass-123');
  const o = await handlers['npo:getOverview'](ev(44), 2026);
  assert.equal(o.donations.length, 1);
  assert.equal(o.report.grantsReceived, 500);
});

test('IPC עמותה: ייצוא CSV בעברית עם BOM, ונטרול נוסחאות בשמות תורמים', async () => {
  await freshLogin(45);
  await handlers['npo:saveSettings'](ev(45), { orgName: 'עמותת חסד ותורה' });
  await handlers['npo:addDonation'](ev(45), { date: '2026-04-01', donorName: '=HYPERLINK("x")', amount: 1 });
  saveTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npo-csv-')), 'd.csv');
  const r = await handlers['npo:exportCsv'](ev(45), 'donations', 2026);
  saveTarget = null;
  assert.equal(r.ok, true);
  const csv = fs.readFileSync(r.path, 'utf8');
  assert.ok(csv.startsWith('﻿'), 'BOM לאקסל');
  assert.match(csv, /מס' קבלה/);
  assert.match(csv, /'=HYPERLINK/, 'נוסחה מנוטרלת');
  await assert.rejects(handlers['npo:exportCsv'](ev(45), 'unknown', 2026), /לא נתמך/);
});
