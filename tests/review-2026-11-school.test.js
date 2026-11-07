// סקירת קוד 11.2026 — ניהול מוסד (u02): פיצול האחסון, שנת לימודים, עזב, מחיקת כיתה, הסרת דוגמה, מגבלות,
// כותרות CSV בכולל, הרשאות ייצוא / מחיקה, הדפסה בערכה בהירה, ובדיקות ממשק (app.js ב-vm עם DOM מדומה).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../modules/school/logic.js');
const MC = require('../shell/module-counters');
const { createSchoolUI } = require('./helpers/school-ui');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plan = (ag, start = '2025-09', n = 10) => L.normPlan({ items: [{ category: 'tuition', label: 'שכר לימוד', amountAg: ag }], installments: n, startMonth: start });
function base() {
  const d = L.emptyData();
  d.settings.year = 'תשפ"ו';
  d.settings.yearStartMonth = '2025-09';
  d.classes.push({ id: 'c1', name: 'כיתה א׳', grade: '', teacherId: '' }, { id: 'c2', name: 'כיתה ב׳', grade: '', teacherId: '' });
  d.students.push(L.normStudent({ id: 's1', first: 'משה', last: 'כהן', classId: 'c1' }), L.normStudent({ id: 's2', first: 'יעקב', last: 'לוי', classId: 'c1' }));
  return d;
}

// ---------- f4 / f30: פיצול האחסון ----------
test('f4/f30: 400 תלמידים ושלוש שנות נוכחות — כל מפתח מתחת לתקרת המחסן, והנתונים חוזרים זהים', () => {
  const d = L.emptyData();
  for (let i = 0; i < 400; i++) d.students.push(L.normStudent({ id: 'stu' + String(i).padStart(10, '0'), first: 'תלמיד', last: 'מספר ' + i }));
  const sids = d.students.map(s => s.id);
  let days = 0;
  for (let t = Date.UTC(2023, 8, 1); t < Date.UTC(2026, 6, 1); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (new Date(t).getUTCDay() === 6) continue;
    L.markAll(d, day, 'day', sids, 'P');
    days++;
  }
  assert.ok(days > 800);
  const items = L.splitData(d);
  const total = Object.values(items).reduce((a, v) => a + v.length, 0);
  assert.ok(total > L.ITEM_MAX, 'כל הנתונים יחד גדולים מפריט אחד (כך המבנה הישן נחסם)');
  for (const [k, v] of Object.entries(items)) assert.ok(v.length < L.ITEM_MAX * 0.7, k + ' ' + v.length);
  const back = L.joinData(items);
  assert.equal(Object.keys(back.attendance).length, days, 'אף יום לא נקטע (LIMITS.days)');
  assert.deepEqual(back.students, d.students);
  assert.deepEqual(L.sizeWarnings(items), []);
  assert.equal(L.sizeWarnings({ 'school:core': 'x'.repeat(Math.ceil(L.ITEM_MAX * 0.71)) })[0].pct, 71);
});

test('f4: המבנה הישן (school:data) נקרא, ומונה הקבלות — הגבוה מבין הישן לבין school:core', () => {
  const d = base();
  L.addPayment(d, { sid: 's1', amountAg: 5000, date: '2025-10-01' });
  const legacy = JSON.stringify(Object.assign({}, d, { yearId: undefined, payments: d.payments.map(p => Object.assign({}, p, { yearId: undefined })) }));
  const j = L.joinData({ 'school:data': legacy, 'school:core': JSON.stringify({ paySeq: 9 }) });
  assert.equal(j.paySeq, 9);
  assert.equal(j.payments.length, 1);
  assert.equal(j.payments[0].yearId, j.yearId, 'תשלום ישן שייך לשנה הנוכחית');
  assert.equal(L.nextPaymentNo(j), 10);
  // מונה המודול לשחזור — קורא את שני המפתחות
  assert.deepEqual(MC.moduleIssuedAfter('school', { 'school:data': legacy }, L.splitData(j)), [{ label: 'קבלות שכר לימוד', count: 8, last: 9 }]);
});

// ---------- f5: שנת לימודים ----------
test('f5: תשלום מלא בשנה א\' לא מכסה את שנה ב\'; יתרה עוברת כשורה מפורשת; השנה הקודמת נשארת לצפייה', () => {
  const d = base();
  d.plans.s1 = plan(600000);
  d.plans.s2 = plan(600000);
  L.addPayment(d, { sid: 's1', amountAg: 600000, date: '2026-06-01' });  // שילם הכול
  L.addPayment(d, { sid: 's2', amountAg: 500000, date: '2026-06-01' });  // חוב 1,000 ₪
  const r = L.openNewYear(d, { name: 'תשפ"ז', startMonth: '2026-09' });
  assert.equal(r.carried, 1);
  assert.deepEqual(d.carry, { s2: 100000 });
  // שנה ב': אותה תוכנית לשניהם
  d.plans.s1 = plan(600000, '2026-09');
  d.plans.s2 = plan(600000, '2026-09');
  const b1 = L.studentBalance(d, 's1', '2027-06-15');
  assert.equal(b1.paidAg, 0, 'התשלום של שנה א\' לא נספר');
  assert.equal(b1.arrearsAg, 600000, 'חוב מלא בשנה ב\'');
  const b2 = L.studentBalance(d, 's2', '2026-09-15');
  assert.equal(b2.carryAg, 100000);
  assert.equal(b2.arrearsAg, 100000 + 60000, 'יתרה משנה קודמת + התשלום הראשון');
  assert.ok(L.debtors(d, '2027-06-15').some(x => x.student.id === 's1'));
  // תשלום בשנה ב' מקזז את היתרה
  L.addPayment(d, { sid: 's2', amountAg: 100000, date: '2026-09-20' });
  assert.equal(L.studentBalance(d, 's2', '2026-09-20').arrearsAg, 60000);
  // השנה הקודמת — לצפייה, עם המצב שלה
  const prev = d.years[0];
  assert.equal(prev.name, 'תשפ"ו');
  assert.equal(L.studentBalance(d, 's1', '2027-01-01', prev.id).balanceAg, 0);
  assert.equal(L.studentBalance(d, 's2', '2027-01-01', prev.id).balanceAg, 100000);
  assert.deepEqual(L.yearsList(d).map(y => y.name), ['תשפ"ז', 'תשפ"ו']);
  // זכות עוברת כשלילית; החלפת התוכנית בשנה החדשה לא מוחקת את היתרה
  const z = base(); z.plans.s1 = plan(100000); L.addPayment(z, { sid: 's1', amountAg: 150000, date: '2026-01-01' });
  L.openNewYear(z, { name: 'תשפ"ז', startMonth: '2026-09' });
  assert.equal(z.carry.s1, -50000);
  z.plans.s1 = plan(100000, '2026-09');
  assert.equal(L.studentBalance(z, 's1', '2027-08-01').balanceAg, 50000);
  // נשמר ונטען דרך האחסון המפוצל
  const j = L.joinData(L.splitData(d));
  assert.equal(j.years.length, 1);
  assert.equal(L.studentBalance(j, 's2', '2026-09-20').arrearsAg, 60000);
  assert.ok(Object.keys(L.splitData(d)).some(k => k === 'school:pay:' + prev.id));
  assert.throws(() => L.openNewYear(d, { name: 'תשפ"ח', startMonth: '2026-08' }), /אחרי חודש הפתיחה/);
  // אימות הסקירה: פריט רשות שלא שולם לא עובר כחוב חובה לשנה החדשה (בשנה החדשה היתרה נספרת בפיגור)
  const o = base();
  o.plans.s1 = L.normPlan({ items: [{ category: 'tuition', label: 'שכר לימוד', amountAg: 600000 }, { category: 'optional', label: 'הסעה', amountAg: 100000 }], installments: 10, startMonth: '2025-09' });
  o.plans.s2 = L.normPlan({ items: [{ category: 'tuition', label: 'שכר לימוד', amountAg: 600000 }, { category: 'optional', label: 'הסעה', amountAg: 100000 }], installments: 10, startMonth: '2025-09' });
  L.addPayment(o, { sid: 's1', amountAg: 600000, date: '2026-06-01' });  // החובה שולמה, הרשות לא
  L.addPayment(o, { sid: 's2', amountAg: 550000, date: '2026-06-01' });  // חוב חובה 500 ₪
  assert.equal(L.debtors(o, '2026-08-15').filter(x => x.student.id === 's1').length, 0);
  L.openNewYear(o, { name: 'תשפ"ז', startMonth: '2026-09' });
  assert.deepEqual(o.carry, { s2: 50000 });
  assert.deepEqual(L.debtors(o, '2026-09-01').map(x => [x.student.id, x.arrearsAg]), [['s2', 50000]]);
  assert.equal(L.studentBalance(o, 's1', '2027-01-01', o.years[0].id).balanceAg, 100000, 'החוב על הרשות נשאר בשנה הקודמת');
  assert.throws(() => L.openNewYear(d, { name: '', startMonth: '2027-09' }), /שם/);
});

// ---------- f33: עזב ----------
test('f33: תלמיד שעזב לא צובר פיגור אחרי חודש העזיבה', () => {
  const d = base();
  d.plans.s1 = plan(1000000, '2025-09', 10);
  L.addPayment(d, { sid: 's1', amountAg: 300000, date: '2025-11-01' });
  d.students[0].status = 'left';
  d.students[0].leftOn = '2025-11-20';
  const b = L.studentBalance(d, 's1', '2026-06-15');
  assert.equal(b.arrearsAg, 0);
  assert.equal(b.chargeAg, 300000);
  assert.ok(!L.debtors(d, '2026-06-15').length);
  assert.equal(L.tuitionSummary(d, '2026-06-15').arrearsAg, 0);
  // נתונים ישנים בלי תאריך עזיבה (אימות הסקירה): אין ניחוש שמוחק חוב אמיתי — החיוב לפי כל הלוח, כמו לפני התיקון
  const n = L.normStudent(Object.assign({}, d.students[0], { leftOn: '' }));
  d.students[0] = n;
  const nb = L.studentBalance(d, 's1', '2025-12-15');
  assert.equal(nb.arrearsAg, 400000 - 300000, 'ספטמבר–דצמבר, פחות מה ששולם');
  assert.equal(nb.leftNoDate, true);
  assert.equal(nb.left, false);
  const z = base();
  z.plans.s1 = plan(600000, '2025-09', 10);
  z.students[0] = L.normStudent(Object.assign({}, z.students[0], { status: 'left' }));
  assert.equal(L.studentBalance(z, 's1', '2025-12-15').arrearsAg, 240000, 'בלי תשלומים — החוב לא נמחק');
  assert.equal(L.debtors(z, '2025-12-15').length, 1);
  // תאריך עזיבה נשמר רק למי שעזב
  assert.equal(L.normStudent({ id: 'x', first: 'א', status: 'active', leftOn: '2025-01-01' }).leftOn, '');
});

test('f33 (ממשק): עריכת תלמיד שעזב בלי תאריך עזיבה לא ממציאה "היום"; סימון עזיבה חדש — היום', async () => {
  const d = base();
  d.students[0] = L.normStudent(Object.assign({}, d.students[0], { status: 'left' }));
  const u = createSchoolUI({ items: Object.assign(L.splitData(d), { 'school:ui': JSON.stringify({ tab: 'students', statusFilter: 'all' }) }) });
  const rowBtn = () => u.view.querySelectorAll('button').filter(b => b.textContent === 'עריכה');
  assert.equal(rowBtn().length, 2);
  rowBtn()[0].click(); await u.tick();
  await u.submitDialog({ 'טלפון': '02-5555555' }, 'שמירה');
  const saved = JSON.parse(u.store.map.get('school:core')).students;
  assert.equal(saved.find(s => s.id === 's1').phone1, '02-5555555');
  assert.equal(saved.find(s => s.id === 's1').leftOn, '', 'לא נקבע תאריך עזיבה מומצא');
  rowBtn()[1].click(); await u.tick();
  await u.submitDialog({ 'מצב': 'left' }, 'שמירה');
  const s2 = JSON.parse(u.store.map.get('school:core')).students.find(s => s.id === 's2');
  assert.equal(s2.status, 'left');
  assert.match(s2.leftOn, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- f32: כיתה ----------
test('f32: תלמיד שעבר כיתה — ציוני הכיתה הקודמת בתעודה; מחיקת כיתה מוחקת את המבחנים שלה', () => {
  const d = base();
  d.assessments.push({ id: 'a1', title: 'מבחן', subject: 'גמרא', classId: 'c1', term: 'מחצית א׳', date: '2025-10-01', weight: 1, max: 100, scores: { s1: 90 }, yearId: d.yearId });
  d.students[0].classId = 'c2';
  assert.equal(L.studentSubjectAverages(d, 's1')['גמרא'].average, 90);
  const n = L.deleteClass(d, 'c1');
  assert.deepEqual(n, { students: 1, assessments: 1 });
  assert.equal(d.assessments.length, 0);
  assert.equal(d.students[1].classId, '');
});

// ---------- f34: הסרת נתוני הדוגמה ----------
test('f34: הסרת הדוגמה שומרת נתונים אמיתיים שנקשרו לרשומות דוגמה, ודוגמה לא נטענת אחרי תשלום אמיתי', () => {
  const d = base();
  assert.equal(L.loadDemo(d, '2026-11-15'), true);
  const demoClass = d.classes.find(c => c.demo);
  const demoStudent = d.students.find(s => s.demo && s.classId !== demoClass.id);
  const demoAssess = d.assessments.find(a => a.classId === demoClass.id);
  d.students[0].classId = demoClass.id;                    // תלמיד אמיתי בכיתת דוגמה
  demoAssess.scores.s1 = 88;                               // ציון אמיתי במבחן דוגמה
  const real = L.addPayment(d, { sid: demoStudent.id, amountAg: 1000, date: '2026-11-15' }); // תשלום אמיתי לתלמיד דוגמה
  L.removeDemo(d);
  assert.ok(d.classes.some(c => c.id === demoClass.id && !c.demo), 'הכיתה נשארה כרגילה');
  assert.equal(d.students.find(s => s.id === 's1').classId, demoClass.id);
  assert.ok(d.assessments.some(a => a.id === demoAssess.id && a.scores.s1 === 88 && Object.keys(a.scores).length === 1));
  assert.ok(d.students.some(s => s.id === demoStudent.id && !s.demo), 'תלמיד עם תשלום אמיתי נשאר');
  assert.ok(d.payments.some(p => p.id === real.id));
  assert.ok(!d.payments.some(p => p.demo));
  const teachers = new Set(d.teachers.map(t => t.id));
  assert.ok(d.classes.every(c => !c.teacherId || teachers.has(c.teacherId)), 'אין הפניה למלמד שנמחק');
  const classes = new Set(d.classes.map(c => c.id));
  assert.ok(d.students.every(s => !s.classId || classes.has(s.classId)), 'אין הפניה לכיתה שנמחקה');
  assert.throws(() => L.loadDemo(d, '2026-11-15'), /אחרי שנרשמו תשלומים/);
});

// ---------- f109: מגבלות ----------
test('f109: חריגה ממגבלה נדחית בהוספה, ולא נעלמת בשקט בטעינה הבאה', () => {
  const d = base();
  d.payments = Array.from({ length: L.LIMITS.payments }, (_, i) => ({ id: 'p' + i, no: i + 1, sid: 's1', amountAg: 1, date: '2025-10-01', yearId: d.yearId }));
  assert.throws(() => L.addPayment(d, { sid: 's1', amountAg: 100, date: '2025-10-02' }), /50,000/);
  const e = L.emptyData();
  e.assessments = new Array(L.LIMITS.assessments).fill(0).map(() => ({ yearId: e.yearId }));
  assert.throws(() => L.assertRoom(e, 'assessments'), /5,000/);
  // אימות הסקירה: המגבלה לכל שנת לימודים — מבחנים ותשלומים של שנים קודמות (קריאה בלבד) לא חוסמים את השנה החדשה
  L.openNewYear(d, { name: 'תשפ"ז', startMonth: '2026-09' });
  assert.doesNotThrow(() => L.addPayment(d, { sid: 's1', amountAg: 100, date: '2026-09-02' }));
  const g = L.emptyData();
  g.assessments = new Array(L.LIMITS.assessments).fill(0).map(() => ({ yearId: 'old' }));
  assert.doesNotThrow(() => L.assertRoom(g, 'assessments'));
  // ובטעינה — התקרה לכל שנה, כך שלא נמחקת שנה שלמה בשקט
  const raw = L.emptyData();
  raw.years = [{ id: 'yold', name: 'ישנה', startMonth: '2024-09', plans: {}, carry: {} }];
  raw.assessments = [];
  for (const y of ['yold', raw.yearId]) for (let i = 0; i < L.LIMITS.assessments; i++) raw.assessments.push({ id: y + 'a' + i, title: 'מבחן', subject: 'גמרא', yearId: y });
  const back = L.normalizeData(JSON.parse(JSON.stringify(raw)));
  assert.equal(back.assessments.length, 2 * L.LIMITS.assessments);
  assert.doesNotThrow(() => L.assertRoom(L.emptyData(), 'students'));
});

// ---------- f110: כותרות ה-CSV ----------
test('f110: בכולל — "שם האשה", "איש קשר נוסף" ו"חבורה" בכותרות הייצוא', () => {
  const d = base();
  d.settings.type = 'kollel';
  const head = L.studentsCsv(d).split('\r\n')[0];
  assert.match(head, /,חבורה,שם האשה,איש קשר נוסף,/);
  assert.doesNotMatch(head, /שם האב/);
  assert.match(L.attendanceCsv(d, '2025-10').split('\r\n')[0], /,חבורה,/);
  d.settings.type = 'tt';
  assert.match(L.studentsCsv(d).split('\r\n')[0], /,כיתה,שם האב,שם האם,/);
});

// ---------- f108: ביטול קבלה ----------
test('f108: ביטול תשלום שומר מתי ומי ביטל, ונשמר באחסון', () => {
  const d = base();
  const p = L.addPayment(d, { sid: 's1', amountAg: 100, date: '2025-10-01' });
  assert.equal(L.cancelPayment(d, p.id, 'טעות', { at: '2025-10-02 10:30', by: 'מזכירה' }), true);
  const j = L.joinData(L.splitData(d));
  assert.deepEqual([j.payments[0].cancelledAt, j.payments[0].cancelledBy, j.payments[0].cancelReason], ['2025-10-02 10:30', 'מזכירה', 'טעות']);
});

// ---------- f31 / f108: הרשאות הפגישה מהמעטפת ----------
test('f31/f108: main.js מעביר הרשאות ייצוא ומחיקה למודול הנעול וחוסם הורדה בלי data.export', () => {
  const main = read('main.js');
  assert.match(main, /perms: modulePerms\(mod\)/);
  assert.match(main, /export: !!econ\.sessionCan\(id, 'data\.export'\), delete: !!econ\.sessionCan\(id, 'data\.delete'\)/);
  assert.match(main, /'will-download'[\s\S]{0,400}e\.preventDefault\(\)/);
  // אימות הסקירה: החסימה רק במודול שהממשק שלו מודיע על ההרשאה (באימונים "הורדת התוכנית" לא יודעת עליה)
  assert.match(main, /const EXPORT_GUARDED_MODS = \['school'\];/);
  assert.match(main, /EXPORT_GUARDED_MODS\.find\(/);
  assert.match(read('shell/secure-ls-preload.js'), /defineProperty\(window, 'ssModulePerms'/);
  // אנדרואיד — מודולי הלימוד לא בגרסת האנדרואיד של SuperSuite המלאה בשלב הזה (החלטת הבעלים)
});

// ---------- f172: ממשק (app.js) ----------
const UI_TABS = ['dash', 'students', 'classes', 'att', 'grades', 'tuition', 'settings'];

test('f172: כל הלשוניות נטענות בלי שגיאה — ריק, עם נתוני דוגמה, ובכולל', async () => {
  const u = createSchoolUI();
  for (const t of UI_TABS) await u.go(t);
  await u.go('dash');
  await u.click('טעינת נתוני דוגמה');
  assert.deepEqual(u.log.alerts, []);
  for (const t of UI_TABS) { await u.go(t); assert.ok(u.text().length > 20, t); }
  await u.go('grades');
  for (const v of ['גיליון ציונים', 'תעודה']) await u.click(v);
  await u.go('tuition');
  for (const v of ['חייבים', 'תשלומים שהתקבלו']) await u.click(v);
  // הנתונים נשמרו במפתחות המפוצלים
  const keys = [...u.store.map.keys()];
  assert.ok(keys.includes('school:core') && keys.some(k => k.startsWith('school:pay:')) && keys.some(k => k.startsWith('school:att:')), keys.join());
  assert.ok(!keys.includes('school:data'));
});

test('f172: רישום תשלום שהשמירה שלו נדחתה — הנתונים חוזרים, בלי "נרשם" ובלי מספר שנבלע', async () => {
  const u = createSchoolUI();
  await u.click('טעינת נתוני דוגמה');
  const before = JSON.parse(u.store.map.get('school:core')).paySeq;
  const payKeys = [...u.store.map.keys()].filter(k => k.startsWith('school:pay:'));
  const payBefore = payKeys.map(k => u.store.map.get(k));
  await u.go('tuition');
  // התשלומים נכתבים, אבל school:core נדחה — גם מה שנכתב חוזר
  u.store.setFail((op, k) => (k === 'school:core' ? 'QuotaExceededError' : null));
  const btn = u.view.querySelectorAll('button').find(b => b.textContent === 'תשלום');
  btn.click(); await u.tick();
  await u.submitDialog({ 'סכום (₪)': '100' }, 'רישום התשלום');
  assert.ok(u.log.alerts.some(a => /אין מספיק מקום/.test(a)), u.log.alerts.join());
  assert.ok(!u.log.toasts.some(t => /נרשם/.test(t)));
  assert.equal(JSON.parse(u.store.map.get('school:core')).paySeq, before);
  assert.deepEqual(payKeys.map(k => u.store.map.get(k)), payBefore, 'התשלומים חזרו למצב הקודם');
  // אחרי שהכתיבה חוזרת לעבוד — המספר הבא הוא הבא ברצף
  u.store.setFail(null);
  u.view.querySelectorAll('button').find(b => b.textContent === 'תשלום').click(); await u.tick();
  await u.submitDialog({ 'סכום (₪)': '100' }, 'רישום התשלום');
  assert.ok(u.log.toasts.includes(`תשלום מס׳ ${before + 1} נרשם`), u.log.toasts.join());
});

test('f172: המרה של school:data למפתחות המפוצלים בטעינה, ובלי הרשאת כתיבה — הישן נשאר', async () => {
  const d = base();
  d.plans.s1 = plan(100000);
  L.addPayment(d, { sid: 's1', amountAg: 5000, date: '2025-10-01' });
  L.setMark(d, '2025-10-05', 'day', 's1', 'P');
  const legacy = JSON.stringify(d);
  const ro = createSchoolUI({ items: { 'school:data': legacy }, fail: () => 'SecurityError' });
  assert.deepEqual([...ro.store.map.keys()], ['school:data']);
  assert.match(ro.text(), /2/, 'הנתונים מוצגים');
  const u = createSchoolUI({ items: { 'school:data': legacy } });
  const keys = [...u.store.map.keys()].sort();
  assert.deepEqual(keys, ['school:att:2025-10', 'school:core', 'school:pay:' + d.yearId]);
  assert.equal(JSON.parse(u.store.map.get('school:core')).paySeq, 1);
});

// אימות הסקירה: באנדרואיד ובלי הצפנת Windows הנתונים ב-localStorage של הדפדפן, עם מכסה לכל המקור —
// school:data גדול ועוד עותק מלא במפתחות החדשים לא נכנסים יחד. ההמרה מוחקת קודם את הישן, ובכשל הכול חוזר
test('f4: המרה של school:data גדול במכסה של כל המקור — מצליחה בלי שני עותקים מלאים, ובכשל הישן חוזר', async () => {
  const d = base();
  d.plans.s1 = plan(100000);
  for (let i = 0; i < 40; i++) L.addPayment(d, { sid: 's1', amountAg: 100 + i, date: '2025-10-01', note: 'תשלום מספר ' + i });
  for (let day = 1; day <= 28; day++) L.setMark(d, '2025-10-' + String(day).padStart(2, '0'), 'day', 's1', 'P');
  const legacy = JSON.stringify(d);
  const total = m => [...m.entries()].reduce((a, [k, v]) => a + k.length + v.length, 0);
  // מכסה: הישן ועוד חצי ממנו — עותק שני מלא לא נכנס
  const quotaFail = cap => (op, k, v, m) => {
    if (op !== 'set') return null;
    const after = total(m) - (m.has(k) ? k.length + m.get(k).length : 0) + k.length + v.length;
    return after > cap ? 'QuotaExceededError' : null;
  };
  const cap = Math.round(legacy.length * 1.5);
  const u = createSchoolUI({ items: { 'school:data': legacy }, fail: quotaFail(cap) });
  const keys = [...u.store.map.keys()].sort();
  assert.ok(!keys.includes('school:data'), keys.join());
  assert.ok(keys.includes('school:core'));
  assert.equal(L.joinData(Object.fromEntries(u.store.map)).payments.length, 40);
  // ושמירה רגילה אחר כך עובדת
  await u.go('tuition');
  u.view.querySelectorAll('button').find(b => b.textContent === 'תשלום').click(); await u.tick();
  await u.submitDialog({ 'סכום (₪)': '5' }, 'רישום התשלום');
  assert.deepEqual(u.log.alerts, []);
  assert.equal(L.joinData(Object.fromEntries(u.store.map)).payments.length, 41);
  // מכסה קטנה מדי גם לעותק אחד: ההמרה נכשלת, והמבנה הישן נשאר כמו שהוא (לא נמחק)
  const tiny = createSchoolUI({ items: { 'school:data': legacy }, fail: quotaFail(legacy.length + 20) });
  assert.deepEqual([...tiny.store.map.keys()], ['school:data']);
  assert.equal(tiny.store.map.get('school:data'), legacy);
});

// אימות הסקירה: העברה מה-localStorage הישן שנכשלה (מצב plain) — ההרשאות מהטעינה הראשונה נשמרות
test('f31: secure-ls-preload — העברה שנכשלה לא מוחקת את הרשאות הפגישה (window.ssModulePerms)', () => {
  const vm = require('node:vm');
  const src = read('shell/secure-ls-preload.js');
  const page = vm.createContext({ DOMException });
  page.window = page;
  const browser = new Map([['school:data', '{}']]);
  const ls = { get length() { return browser.size; }, key: i => [...browser.keys()][i] ?? null, getItem: k => browser.get(k) ?? null, setItem: (k, v) => browser.set(k, v), removeItem: k => browser.delete(k), clear: () => browser.clear() };
  const electron = {
    ipcRenderer: {
      sendSync: (ch) => ch === 'secure-store:load' ? { state: 'encrypted', migrated: false, data: {}, perms: { export: true, delete: true, user: 'מנהל' } }
        : ch === 'secure-store:migrate' ? { ok: false } : { ok: true },
      send() {}
    },
    contextBridge: { executeInMainWorld: ({ func, args }) => vm.runInContext('(' + func.toString() + ')', page)(...args) }
  };
  const iso = { location: { protocol: 'app:', host: 'school' } };
  iso.top = iso;
  vm.runInNewContext(src, { require: () => electron, location: iso.location, localStorage: ls, window: iso });
  const p = vm.runInContext('window.ssModulePerms', page);
  assert.equal(p.export, true);
  assert.equal(p.delete, true);
  assert.equal(vm.runInContext('localStorage.getItem("school:data")', page), '{}', 'ממשיכים עם האחסון הישן');
});

test('f31: בלי הרשאת ייצוא אין כפתורי ייצוא, וייצוא לא יוצר קובץ', async () => {
  const u = createSchoolUI({ perms: { export: false, delete: false, user: 'צופה' }, items: { 'school:core': JSON.stringify({ students: [{ id: 's1', first: 'משה', last: 'כהן' }] }) } });
  for (const t of ['students', 'att', 'tuition', 'settings']) {
    await u.go(t);
    assert.ok(!u.buttonTexts(u.view).some(x => /ייצוא/.test(x)), t + ': ' + u.buttonTexts(u.view).join());
  }
  const ok = createSchoolUI({ items: { 'school:core': JSON.stringify({ students: [{ id: 's1', first: 'משה', last: 'כהן' }] }) } });
  await ok.go('students');
  await ok.click('ייצוא CSV');
  assert.equal(ok.log.downloads.length, 1);
  assert.match(ok.log.toasts.join(), /חלון השמירה/, 'f107: ההודעה לא טוענת שהקובץ כבר נשמר בתיקיית ההורדות');
  assert.ok(!ok.log.toasts.some(t => /נשמר בתיקיית ההורדות/.test(t)));
  // בלי מידע על הרשאות (null) — אין ייצוא
  const none = createSchoolUI({ perms: null });
  await none.go('settings');
  assert.ok(!none.buttonTexts(none.view).some(x => /ייצוא/.test(x)));
});

test('f108: עורך בלי data.delete — אין "מחיקת כל הנתונים" ואין ביטול קבלה; עם הרשאה — הביטול נרשם עם שם המשתמש', async () => {
  const d = base();
  const p = L.addPayment(d, { sid: 's1', amountAg: 5000, date: '2025-10-01' });
  const items = L.splitData(d);
  const ed = createSchoolUI({ items, perms: { export: true, delete: false, user: 'עורך' } });
  await ed.go('settings');
  assert.ok(!ed.hasButton('מחיקת כל הנתונים'));
  await ed.go('tuition');
  await ed.click('תשלומים שהתקבלו');
  assert.ok(!ed.hasButton('ביטול', ed.view));
  const ad = createSchoolUI({ items: L.splitData(d), perms: { export: true, delete: true, user: 'מנהל' } });
  await ad.go('tuition');
  await ad.click('תשלומים שהתקבלו');
  ad.answers.prompt.push('טעות בסכום');
  await ad.click('ביטול', ad.view);
  const saved = L.joinData(Object.fromEntries(ad.store.map)).payments.find(x => x.id === p.id);
  assert.equal(saved.cancelled, true);
  assert.equal(saved.cancelledBy, 'מנהל');
  assert.match(saved.cancelledAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await ad.go('settings');
  assert.ok(ad.hasButton('מחיקת כל הנתונים'));
});

test('f4: אזהרת נפח במסך הבית כשפריט עובר 70% מהתקרה', async () => {
  const core = JSON.parse(L.splitData(base())['school:core']);
  core.settings.name = 'ת"ת';
  core.students[0].notes = '';
  const big = JSON.stringify(Object.assign(core, { pad: 'x'.repeat(Math.ceil(L.ITEM_MAX * 0.72)) }));
  const u = createSchoolUI({ items: { 'school:core': big } });
  assert.match(u.text(), /תופסים 7\d% מהנפח המרבי/);
});

test('f170: הדפסה בערכה כהה — המסמך מודפס בערכה הבהירה, והערכה חוזרת אחרי ההדפסה', async () => {
  const d = base();
  const p = L.addPayment(d, { sid: 's1', amountAg: 5000, date: '2025-10-01' });
  const u = createSchoolUI({ items: L.splitData(d), theme: 'dark' });
  await u.go('tuition');
  await u.click('תשלומים שהתקבלו');
  await u.click('אישור', u.view);
  await u.click('🖨 הדפסת אישור התשלום');
  assert.deepEqual(u.log.prints, ['light']);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(u.doc.documentElement.getAttribute('data-ss-theme'), 'dark');
  assert.ok(p.no);
});

test('f5 (ממשק): פתיחת שנת לימודים מההגדרות, ובשנה הקודמת — צפייה בלבד', async () => {
  const d = base();
  d.plans.s1 = plan(600000);
  L.addPayment(d, { sid: 's1', amountAg: 100000, date: '2026-01-01' });
  const u = createSchoolUI({ items: L.splitData(d) });
  await u.go('settings');
  await u.click('פתיחת שנת לימודים');
  await u.submitDialog({ 'שם השנה החדשה': 'תשפ"ז', 'חודש הפתיחה': '2026-09' }, 'פתיחת השנה');
  assert.ok(u.log.toasts.some(t => /נפתחה שנת הלימודים תשפ"ז/.test(t)), u.log.toasts.join() + u.log.alerts.join());
  const j = L.joinData(Object.fromEntries(u.store.map));
  assert.equal(j.settings.year, 'תשפ"ז');
  assert.equal(j.carry.s1, 500000);
  await u.go('tuition');
  const sel = u.view.querySelectorAll('select').find(s => s.getAttribute('aria-label') === 'שנת לימודים');
  assert.ok(sel, 'בורר השנה');
  sel.value = j.years[0].id;
  sel.dispatch('change', { target: sel });
  await u.tick();
  assert.match(u.text(), /לקריאה בלבד/);
  assert.ok(!u.hasButton('תשלום', u.view) && !u.hasButton('החלת תוכנית על כיתה', u.view));
});
