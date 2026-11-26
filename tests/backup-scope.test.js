'use strict';
// סימוני הרישוי (licenseMarks) נקלטים בשחזור רק מגיבוי מוצפן של התוכנה הזו — shell/backup-scope.js.
// אותו כלל כמו ב-SuperSuite לימוד (שם: f76 — גיבוי של המוצר האחר נעל את הניסיון; f167 — JSON גלוי שנערך).
// חלק ראשון — הפונקציות הטהורות; חלק שני — main.js האמיתי עם Electron מדומה (tests/helpers/secure-store-main.js):
// שאר הגיבוי משוחזר כרגיל בכל המקרים, ורק הסימונים לא נקלטים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMainHarness } = require('./helpers/secure-store-main');
const BK = require('../modules/econ/core/backupCrypto');
const Scope = require('../shell/backup-scope');
const Products = require('../shell/licensing/products');

const DAY = 24 * 60 * 60 * 1000;
const MARKS = { hadLicense: true, trialStart: 1 };

/* ================= הפונקציות הטהורות ================= */

test('backup-scope: המוצר שנרשם בגיבוי הוא המוצר של התוכנה הזו בקטלוג המוצרים', () => {
  assert.equal(Scope.PRODUCT, Products.THIS_PRODUCT);
  assert.ok(Products.isProduct(Scope.PRODUCT));
});

test('backup-scope: גיבוי מוצפן של התוכנה הזו — הסימונים נקלטים, עם product או בלעדיו (גיבוי ישן)', () => {
  assert.deepEqual(Scope.licenseMarksToMerge({ suite: 'SuperSuite', product: Scope.PRODUCT, licenseMarks: MARKS }, { encrypted: true }), MARKS);
  // גיבוי מלפני שהשדה נוסף: בלי product — מלא, של מודול, ועם מודול האימונים שהיה כאן פעם
  assert.deepEqual(Scope.licenseMarksToMerge({ suite: 'SuperSuite', scope: 'all', localStorage: { shamai: {}, tools: {} }, licenseMarks: MARKS }, { encrypted: true }), MARKS);
  assert.deepEqual(Scope.licenseMarksToMerge({ suite: 'SuperSuite', scope: 'all', localStorage: { shamai: {}, trainer: {}, tools: {} }, licenseMarks: MARKS }, { encrypted: true }), MARKS);
  assert.deepEqual(Scope.licenseMarksToMerge({ suite: 'SuperSuite', scope: 'econ', econ: {}, localStorage: {}, licenseMarks: MARKS }, { encrypted: true }), MARKS);
  assert.deepEqual(Scope.licenseMarksToMerge({ suite: 'SuperSuite', licenseMarks: MARKS }, { encrypted: true }), MARKS);
});

test('backup-scope: גיבוי של מוצר אחר — הסימונים לא נקלטים', () => {
  // עם product של מוצר אחר (SuperSuite לימוד רושמת supersuite-learn), גם כשהוא מזהה מהקטלוג
  for (const product of ['supersuite-learn', 'learn', 'shir-studio', 'vidlearn', 'super-suite', '', 0, false, {}]) {
    assert.equal(Scope.licenseMarksToMerge({ suite: 'SuperSuite', product, licenseMarks: MARKS }, { encrypted: true }), null, JSON.stringify(product));
  }
  // SuperSuite לימוד מלפני שנרשם בה המוצר: המודולים שלה בגיבוי המלא תמיד (גם ריקים), או גיבוי של מודול שלה
  assert.equal(Scope.licenseMarksToMerge({ suite: 'SuperSuite', scope: 'all', localStorage: { trainer: {}, tools: {}, english: {}, math: {}, school: {} }, licenseMarks: MARKS }, { encrypted: true }), null);
  assert.equal(Scope.licenseMarksToMerge({ suite: 'SuperSuite', localStorage: { school: {} }, licenseMarks: MARKS }, { encrypted: true }), null);
  assert.equal(Scope.licenseMarksToMerge({ suite: 'SuperSuite', scope: 'math', localStorage: {}, licenseMarks: MARKS }, { encrypted: true }), null);
  // product של התוכנה הזו גובר על סימני המודולים (השדה הוא המקור כשהוא קיים)
  assert.equal(Scope.isOwnProduct({ product: Scope.PRODUCT, localStorage: { english: {} } }), true);
});

test('backup-scope: קובץ גלוי (JSON שאפשר לערוך) — הסימונים לא נקלטים, גם כשהוא של התוכנה הזו', () => {
  const own = { suite: 'SuperSuite', product: Scope.PRODUCT, licenseMarks: MARKS };
  assert.equal(Scope.licenseMarksToMerge(own, { encrypted: false }), null);
  assert.equal(Scope.licenseMarksToMerge(own, {}), null);
  assert.equal(Scope.licenseMarksToMerge(own), null);
  // רק true ממש — ערך "אמיתי" אחר אינו הוכחה שהקובץ היה מוצפן
  assert.equal(Scope.licenseMarksToMerge(own, { encrypted: 'yes' }), null);
  assert.equal(Scope.licenseMarksToMerge(own, { encrypted: 1 }), null);
});

test('backup-scope: קלט לא תקין — null, בלי חריגה', () => {
  for (const data of [null, undefined, 'x', 5, [], [{ licenseMarks: MARKS }]]) {
    assert.equal(Scope.isOwnProduct(data), false);
    assert.equal(Scope.licenseMarksToMerge(data, { encrypted: true }), null);
  }
  // גיבוי ישן בלי סימונים, או סימונים שאינם אובייקט — אין מה לקלוט
  for (const licenseMarks of [undefined, null, 'x', 7, true, [], [MARKS]]) {
    assert.equal(Scope.licenseMarksToMerge({ suite: 'SuperSuite', product: Scope.PRODUCT, licenseMarks }, { encrypted: true }), null, JSON.stringify(licenseMarks));
  }
  // localStorage שאינו אובייקט לא מפיל את הבדיקה
  assert.equal(Scope.isOwnProduct({ suite: 'SuperSuite', localStorage: ['english'] }), true);
  assert.equal(Scope.isOwnProduct({ suite: 'SuperSuite', localStorage: 'english' }), true);
});

/* ================= main.js האמיתי ================= */

const H = createMainHarness();
const { handlers, boot, loginAs, shellSender, ADMIN, dialogPlan, userData, ROOT } = H;
const econApi = require(path.join(ROOT, 'modules', 'econ', 'ipc'));
const electron = require('electron'); // ה-stub של הרתמה
const PASS = 'sismat-gibui-aruka-2026';

test.before(async () => { await boot(); });

let seq = 0;
// שחזור מקובץ: text — תוכן הקובץ כמו שהוא (מוצפן או JSON גלוי)
async function restoreText(text, ext) {
  await loginAs(ADMIN[0]);
  const file = path.join(userData, `scope-restore-${++seq}.${ext}`);
  fs.writeFileSync(file, text);
  const orig = electron.dialog.showOpenDialog;
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  dialogPlan.log.length = 0;
  try { return await handlers['shell:restore-all'](shellSender(), PASS); }
  finally { electron.dialog.showOpenDialog = orig; }
}
const payload = async (donor, extra) => {
  const econ = await econApi.getDb().backup();
  econ.donors = [{ id: 'd-' + donor, name: donor }];
  return { suite: 'SuperSuite', version: 2, scope: 'all', createdAt: new Date().toISOString(), econ, localStorage: {}, ...extra };
};
const restoreEncrypted = async (donor, extra) => restoreText(BK.encryptBackup(JSON.stringify(await payload(donor, extra)), PASS), 'ssbk');
const restorePlain = async (donor, extra) => restoreText(JSON.stringify(await payload(donor, extra)), 'json');
const donors = async () => (await econApi.getDb().load()).donors.map(d => d.name);
const marks = () => econApi.licenseMarks();

test('main.js: הגיבוי נושא את המוצר של התוכנה הזו, ונשאר מוצפן', async () => {
  await loginAs(ADMIN[0]);
  const file = path.join(userData, 'scope-full.ssbk');
  dialogPlan.save = { canceled: false, filePath: file };
  try { assert.deepEqual(await handlers['shell:backup-all'](shellSender(), PASS, 'all'), { ok: true }); }
  finally { dialogPlan.save = { canceled: true }; }
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(BK.isEncryptedBackup(text), 'אין מסלול כתיבה גלוי');
  const data = JSON.parse(BK.decryptBackup(text, PASS));
  assert.equal(data.product, Scope.PRODUCT);
  assert.equal(data.suite, 'SuperSuite');
  assert.ok(data.licenseMarks && typeof data.licenseMarks === 'object');
  assert.equal(Scope.isOwnProduct(data), true);
});

test('main.js: גיבוי מוצפן של מוצר אחר — הנתונים משוחזרים, סימוני הרישוי שלו לא נקלטים', async () => {
  const foreign = { hadLicense: true, trialStart: Date.now() - 400 * DAY };
  const before = marks();
  // SuperSuite לימוד עם product
  assert.deepEqual(await restoreEncrypted('יעקב כהן', { product: 'supersuite-learn', licenseMarks: foreign }), { ok: true }, dialogPlan.log.join(' | '));
  assert.deepEqual(await donors(), ['יעקב כהן'], 'שאר הגיבוי שוחזר');
  assert.notEqual(marks().hadLicense, true, 'hadLicense של המוצר האחר לא נקלט');
  assert.equal(marks().trialStart, before.trialStart);
  // SuperSuite לימוד מלפני שנרשם בה המוצר (המודולים שלה קיימים בגיבוי המלא)
  assert.deepEqual(await restoreEncrypted('משה לוי', { localStorage: { trainer: {}, tools: {}, english: {}, math: {}, school: {} }, licenseMarks: foreign }),
    { ok: true }, dialogPlan.log.join(' | '));
  assert.deepEqual(await donors(), ['משה לוי']);
  assert.notEqual(marks().hadLicense, true);
  assert.equal(marks().trialStart, before.trialStart);
});

test('main.js: גיבוי גלוי (JSON) של התוכנה הזו — הנתונים משוחזרים, סימוני הרישוי שבו לא נקלטים', async () => {
  const edited = { hadLicense: true, trialStart: Date.now() - 400 * DAY };
  const before = marks();
  for (const extra of [{ product: Scope.PRODUCT }, {}]) {
    const name = extra.product ? 'אהרן פרידמן' : 'דוד שפירא';
    assert.deepEqual(await restorePlain(name, { ...extra, licenseMarks: edited }), { ok: true }, dialogPlan.log.join(' | '));
    assert.deepEqual(await donors(), [name], 'גיבוי גלוי ישן ממשיך להשתחזר');
    assert.notEqual(marks().hadLicense, true, 'סימון שנוסף בעורך טקסט לא נועל את ההתקנה');
    assert.equal(marks().trialStart, before.trialStart);
  }
});

test('main.js: גיבוי מוצפן של התוכנה הזו — סימוני הרישוי נקלטים (רק מחמירים); גיבוי ישן בלי product — גם', async () => {
  // תאריכים קרובים: הניסיון נשאר פעיל, והשחזור הבא לא נחסם ברישיון לקריאה בלבד
  const t1 = Date.now() - 3 * DAY, t2 = Date.now() - 4 * DAY;
  assert.deepEqual(await restoreEncrypted('שמעון רוזן', { product: Scope.PRODUCT, licenseMarks: { trialStart: t1 } }), { ok: true }, dialogPlan.log.join(' | '));
  assert.deepEqual(await donors(), ['שמעון רוזן']);
  assert.equal(marks().trialStart, t1, 'תחילת הניסיון מהגיבוי נקלטה');
  // גיבוי ישן של התוכנה הזו, מלפני שנרשם בו המוצר
  assert.deepEqual(await restoreEncrypted('לוי גולדברג', { localStorage: { shamai: {}, tools: {} }, licenseMarks: { trialStart: t2 } }), { ok: true }, dialogPlan.log.join(' | '));
  assert.deepEqual(await donors(), ['לוי גולדברג']);
  assert.equal(marks().trialStart, t2, 'גיבוי ישן בלי product ממשיך להעביר את הסימונים');
  // רק מחמיר: תאריך מאוחר יותר לא מאריך, וגיבוי בלי סימונים לא נוגע בהם
  assert.deepEqual(await restoreEncrypted('יוסף כץ', { product: Scope.PRODUCT, licenseMarks: { trialStart: t1 } }), { ok: true }, dialogPlan.log.join(' | '));
  assert.equal(marks().trialStart, t2);
  assert.deepEqual(await restoreEncrypted('בנימין הלוי', { product: Scope.PRODUCT }), { ok: true }, dialogPlan.log.join(' | '));
  assert.deepEqual(await donors(), ['בנימין הלוי']);
  assert.equal(marks().trialStart, t2);
  assert.notEqual(marks().hadLicense, true);
});
