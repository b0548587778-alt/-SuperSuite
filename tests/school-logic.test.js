// מודול ניהול מוסד חינוכי — לוגיקה טהורה (modules/school/logic.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../modules/school/logic.js');

const TODAY = '2026-11-15';

function base() {
  const d = L.emptyData();
  d.classes.push({ id: 'c1', name: 'כיתה א׳', grade: 'א׳', teacherId: '' });
  d.students.push(
    L.normStudent({ id: 's1', first: 'משה', last: 'כהן', classId: 'c1' }),
    L.normStudent({ id: 's2', first: 'יעקב', last: 'לוי', classId: 'c1' }),
    L.normStudent({ id: 's3', first: 'אהרן', last: 'פרידמן', classId: 'c1', specialEd: true })
  );
  return d;
}

test('ת"ז: ספרת ביקורת', () => {
  assert.equal(L.isValidIsraeliId('000000018'), true);
  assert.equal(L.isValidIsraeliId('18'), false);          // קצר מדי
  assert.equal(L.isValidIsraeliId('123456782'), true);
  assert.equal(L.isValidIsraeliId('123456789'), false);
  assert.equal(L.isValidIsraeliId('12345'), false);
  assert.equal(L.isValidIsraeliId('000000000'), false);
  assert.equal(L.isValidIsraeliId('abc'), false);
  assert.equal(L.idError(''), null);
  assert.match(L.idError('12'), /5–9/);
  assert.match(L.idError('123456789'), /ספרת ביקורת/);
  assert.equal(L.idError('123456782'), null);
});

test('כסף: פענוח ותצוגה באגורות', () => {
  assert.equal(L.parseShekels('1,234.50'), 123450);
  assert.equal(L.parseShekels('0.1'), 10);
  assert.equal(L.parseShekels('₪ 75'), 7500);
  assert.equal(L.parseShekels('12,34'), null);
  assert.equal(L.parseShekels('-5'), null);
  assert.equal(L.parseShekels('1.234'), null);
  assert.equal(L.parseShekels(''), null);
  assert.equal(L.fmtMoney(123456), '₪1,234.56');
  assert.equal(L.fmtMoney(-5), '-₪0.05');
  assert.equal(L.fmtMoney(0), '₪0.00');
});

test('נוכחות: אחוזים, מוצדק לא נספר, סיכום חודשי ונוכחות נמוכה', () => {
  const d = base();
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  days.forEach(day => L.markAll(d, day, 'day', ['s1', 's2', 's3'], 'P'));
  L.setMark(d, '2026-11-02', 'day', 's2', 'A');
  L.setMark(d, '2026-11-03', 'day', 's2', 'A');
  L.setMark(d, '2026-11-04', 'day', 's2', 'E');
  L.setMark(d, '2026-11-04', 'day', 's1', 'L');
  const s1 = L.attendanceStats(d, { sids: ['s1'] });
  assert.deepEqual([s1.P, s1.L, s1.pct], [3, 1, 100]);
  const s2 = L.attendanceStats(d, { sids: ['s2'] });
  assert.equal(s2.pct, 33.3); // 1 מתוך 3 (מוצדק לא נספר)
  const sum = L.monthSummary(d, '2026-11', 'c1');
  assert.equal(sum.rows.length, 3);
  assert.equal(sum.class.total, 12);
  const low = L.lowAttendance(d, '2026-11', 85);
  assert.deepEqual(low.map(r => r.student.id), ['s2']);
  // markAll בלי overwrite לא דורס סימון קיים
  assert.equal(L.markAll(d, '2026-11-02', 'day', ['s1', 's2'], 'P'), 0);
  assert.equal(d.attendance['2026-11-02'].day.s2, 'A');
  // מחיקת סימון
  L.setMark(d, '2026-11-02', 'day', 's2', '');
  assert.equal(d.attendance['2026-11-02'].day.s2, undefined);
  assert.equal(L.setMark(d, '2026-02-31', 'day', 's1', 'P'), false);
  assert.equal(L.setMark(d, '2026-11-05', 'day', 's1', 'X'), false);
});

test('כולל: מינימום נוכחים בכל סדר', () => {
  const d = base();
  d.settings.type = 'kollel';
  d.settings.kollelMinPresent = 2;
  assert.deepEqual(L.slotsFor(d.settings), ['s0', 's1']);
  L.markAll(d, '2026-11-02', 's0', ['s1', 's2', 's3'], 'P');
  L.setMark(d, '2026-11-02', 's1', 's1', 'P');
  L.setMark(d, '2026-11-02', 's1', 's2', 'A');
  const chk = L.kollelDayCheck(d, '2026-11-02');
  assert.equal(chk[0].ok, true);
  assert.equal(chk[1].ok, false);
  assert.equal(chk[1].present, 1);
});

test('ציונים: ממוצע משוקלל, ממוצע כללי ודירוג', () => {
  assert.equal(L.weightedAverage([{ score: 80, max: 100, weight: 1 }, { score: 100, max: 100, weight: 3 }]), 95);
  assert.equal(L.weightedAverage([{ score: 15, max: 20, weight: 1 }]), 75);
  assert.equal(L.weightedAverage([]), null);
  const d = base();
  d.assessments.push(
    { id: 'a1', title: 'מבחן', subject: 'גמרא', classId: 'c1', term: 'מחצית א׳', weight: 2, max: 100, scores: { s1: 90, s2: 70 } },
    { id: 'a2', title: 'בוחן', subject: 'גמרא', classId: 'c1', term: 'מחצית א׳', weight: 1, max: 100, scores: { s1: 60, s2: 70 } },
    { id: 'a3', title: 'מבחן', subject: 'חשבון', classId: 'c1', term: 'מחצית ב׳', weight: 1, max: 50, scores: { s1: 50 } }
  );
  const avg = L.studentSubjectAverages(d, 's1', 'מחצית א׳');
  assert.equal(avg['גמרא'].average, 80);
  assert.equal(avg['חשבון'], undefined);
  const all = L.studentSubjectAverages(d, 's1');
  assert.equal(L.overallAverage(all), 90); // (80 + 100) / 2
  const rank = L.classRanking(d, 'c1', 'מחצית א׳');
  assert.deepEqual(rank.map(r => [r.student.id, r.rank]), [['s1', 1], ['s2', 2]]);
  assert.equal(L.verbalGrade(96), 'מצוין מאוד');
});

test('שכר לימוד: חלוקה לתשלומים — סכום שווה לכולל, שארית באחרון', () => {
  assert.deepEqual(L.splitEven(1000, 3), [333, 333, 334]);
  assert.deepEqual(L.splitEven(5, 10), [0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
  for (let i = 0; i < 300; i++) {
    const total = Math.floor(Math.random() * 10000000);
    const n = 1 + Math.floor(Math.random() * 24);
    const parts = L.splitEven(total, n);
    assert.equal(parts.length, n);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    assert.ok(parts.every(p => Number.isInteger(p) && p >= 0));
    assert.ok(parts[n - 1] >= parts[0]);
  }
  const d = base();
  d.plans.s1 = L.normPlan({
    items: [{ category: 'tuition', amountAg: 600001 }, { category: 'registration', amountAg: 15000 }, { category: 'talan', amountAg: 33333 }, { category: 'optional', amountAg: 100001 }],
    discounts: [{ label: 'הנחת אחים', pctBp: 1000 }, { label: 'מלגה', amountAg: 50000 }], installments: 11, startMonth: '2026-09'
  });
  const s = L.installmentSchedule(d.plans.s1, d.students[0]);
  const t = s.totals;
  assert.equal(t.discountAg, 60000 + 50000);
  assert.equal(t.netAg, 600001 - 110000 + 15000 + 33333 + 100001);
  assert.equal(s.rows.length, 11);
  assert.equal(s.rows.reduce((a, r) => a + r.amountAg, 0), t.netAg);
  assert.equal(s.rows.reduce((a, r) => a + r.optionalAg, 0), 100001);
  assert.equal(s.rows[0].month, '2026-09');
  assert.equal(s.rows[10].month, '2027-07');
  assert.ok(s.rows.every(r => Number.isInteger(r.amountAg) && r.amountAg >= 0));
});

test('שכר לימוד: יתרה ופיגור (רשות לא נכנס לפיגור), רשימת חייבים', () => {
  const d = base();
  d.plans.s1 = L.normPlan({ items: [{ category: 'tuition', amountAg: 100000 }, { category: 'optional', amountAg: 50000 }], installments: 10, startMonth: '2026-09' });
  // נובמבר: 3 תשלומי חובה של 10,000 אגורות עברו
  let b = L.studentBalance(d, 's1', TODAY);
  assert.equal(b.dueMandatoryAg, 30000);
  assert.equal(b.arrearsAg, 30000);
  assert.equal(b.balanceAg, 150000);
  L.addPayment(d, { sid: 's1', amountAg: 25000, date: TODAY, method: 'cash' });
  b = L.studentBalance(d, 's1', TODAY);
  assert.equal(b.arrearsAg, 5000);
  assert.equal(b.balanceAg, 125000);
  assert.deepEqual(L.debtors(d, TODAY).map(r => r.student.id), ['s1']);
  const sum = L.tuitionSummary(d, TODAY);
  assert.deepEqual([sum.plannedAg, sum.paidAg, sum.arrearsAg], [150000, 25000, 5000]);
});

test('חינוך מיוחד: פטור משכר לימוד ודמי רישום כברירת מחדל', () => {
  const d = base();
  const plan = L.normPlan({ items: [{ category: 'tuition', amountAg: 500000 }, { category: 'registration', amountAg: 10000 }, { category: 'optional', amountAg: 20000 }], installments: 5, startMonth: '2026-09' });
  d.plans.s3 = plan;
  const t = L.planTotals(plan, d.students[2]);
  assert.equal(t.exempt, true);
  assert.equal(t.exemptAg, 510000);
  assert.equal(t.mandatoryAg, 0);
  assert.equal(t.netAg, 20000);
  assert.equal(L.studentBalance(d, 's3', TODAY).arrearsAg, 0);
  // ביטול הפטור במפורש
  plan.exemptOverride = false;
  assert.equal(L.planTotals(plan, d.students[2]).mandatoryAg, 510000);
  // תלמיד רגיל לא פטור
  assert.equal(L.isExempt(d.students[0], plan), false);
});

test('דמי רישום: אזהרה מעל הנמוך מבין 5% ו-150 ₪', () => {
  const ok = L.normPlan({ items: [{ category: 'tuition', amountAg: 600000 }, { category: 'registration', amountAg: 15000 }] });
  assert.equal(L.registrationWarning(ok), null);
  const high = L.normPlan({ items: [{ category: 'tuition', amountAg: 200000 }, { category: 'registration', amountAg: 15000 }] });
  assert.match(L.registrationWarning(high), /לבדיקה/);
});

test('מספור תשלומים: עולה תמיד, ביטול לא ממחזר מספר', () => {
  const d = base();
  const p1 = L.addPayment(d, { sid: 's1', amountAg: 100, date: TODAY });
  const p2 = L.addPayment(d, { sid: 's2', amountAg: 200, date: TODAY, method: 'check', ref: '1234' });
  assert.deepEqual([p1.no, p2.no], [1, 2]);
  assert.equal(L.cancelPayment(d, p2.id, 'המחאה חזרה'), true);
  assert.equal(L.cancelPayment(d, p2.id), false);
  const p3 = L.addPayment(d, { sid: 's1', amountAg: 300, date: TODAY });
  assert.equal(p3.no, 3);
  assert.equal(L.studentBalance(d, 's2', TODAY).paidAg, 0);
  // גם אחרי שמירה וטעינה, ואחרי הסרת תשלומים — המספר לא יורד
  const re = L.normalizeData(JSON.stringify(d));
  re.payments = [];
  assert.equal(L.nextPaymentNo(re), 4);
  // paySeq נמוך מהמספר הגבוה בקובץ (עריכה ידנית) — המספור ממשיך מהגבוה
  const tampered = JSON.parse(JSON.stringify(d)); tampered.paySeq = 0;
  assert.equal(L.nextPaymentNo(L.normalizeData(tampered)), 4);
  assert.throws(() => L.addPayment(d, { sid: 's1', amountAg: 10.5, date: TODAY }), /סכום/);
  assert.throws(() => L.addPayment(d, { sid: 's1', amountAg: 0, date: TODAY }), /סכום/);
  assert.throws(() => L.addPayment(d, { sid: 'nope', amountAg: 10, date: TODAY }), /לא נמצא/);
  assert.throws(() => L.addPayment(d, { sid: 's1', amountAg: 10, date: '2026-13-01' }), /תאריך/);
});

test('CSV: הגנת נוסחאות ומירכאות', () => {
  assert.equal(L.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(L.csvCell('+972'), "'+972");
  assert.equal(L.csvCell('@x'), "'@x");
  assert.equal(L.csvCell('-x'), "'-x");
  assert.equal(L.csvCell('-12.5'), '-12.5');
  assert.equal(L.csvCell('-12'), '-12');
  assert.equal(L.csvCell('\tא'), "'\tא");
  assert.equal(L.csvCell('א,ב'), '"א,ב"');
  assert.equal(L.csvCell('אמר "שלום"'), '"אמר ""שלום"""');
  assert.equal(L.csvCell(null), '');
  assert.equal(L.csvCell('=1,2'), `"'=1,2"`);
  const d = base();
  d.students[0].notes = '=HYPERLINK("x")';
  const csv = L.studentsCsv(d);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  d.plans.s1 = L.normPlan({ items: [{ category: 'tuition', amountAg: 120005 }], installments: 1, startMonth: '2026-09' });
  assert.match(L.debtsCsv(d, TODAY), /1200\.05/);
  L.markAll(d, '2026-11-02', 'day', ['s1'], 'P');
  assert.match(L.attendanceCsv(d, '2026-11'), /משה כהן/);
});

test('עמידות: נתונים פגומים באחסון לא מפילים', () => {
  const bad = [null, undefined, '', '{', 'null', '[]', '42', 'true', '"x"', '{"v":"x"}',
    JSON.stringify({ students: 'x', classes: [null, 1, 'a', { id: '__proto__', name: 'x' }], attendance: [] }),
    JSON.stringify({ settings: { type: 'evil', subjects: 'x', lowAttendancePct: 'NaN' }, plans: { s1: { items: [{ category: 'x', amountAg: -1 }, { category: 'tuition', amountAg: 1.5 }] } } }),
    JSON.stringify({ attendance: { '2026-11-01': { day: { s1: 'P', s2: 'Z', 'a b': 'P' }, evil: { s1: 'P' } }, 'not-a-day': {} } }),
    JSON.stringify({ payments: [{ id: 'p1', sid: 's1', no: 5, amountAg: 100, date: '2026-11-01' }, { id: 'p2', sid: 's1', no: 'x', amountAg: 100, date: '2026-11-01' }, { id: 'p1', sid: 's1', no: 6, amountAg: 1, date: '2026-11-01' }], paySeq: -3 }),
    JSON.stringify({ assessments: [{ id: 'a1', title: 't', subject: 'גמרא', scores: { s1: 101, s2: 50, s3: 'x' } }] }),
    JSON.stringify({ students: [{ id: 's1', first: 'משה', birth: '2020-02-31', idNum: '<script>', status: 'x', specialEd: 'yes' }] })
  ];
  for (const raw of bad) {
    const d = L.normalizeData(raw);
    assert.equal(d.v, L.SCHEMA_VERSION);
    assert.ok(Array.isArray(d.students) && Array.isArray(d.payments));
    assert.equal(typeof d.attendance, 'object');
    // כל החישובים רצים על התוצאה
    L.tuitionSummary(d, TODAY); L.monthSummary(d, '2026-11'); L.upcomingBirthdays(d, TODAY); L.studentsCsv(d);
  }
  const s = L.normalizeData(bad[bad.length - 1]).students[0];
  assert.deepEqual([s.birth, s.idNum, s.status, s.specialEd], ['', '', 'active', false]);
  const p = L.normalizeData(bad[13]);
  assert.equal(p.payments.length, 1);
  assert.equal(p.paySeq, 5);
  const att = L.normalizeData(bad[12]).attendance;
  assert.deepEqual(att, { '2026-11-01': { day: { s1: 'P' } } });
  const a = L.normalizeData(bad[14]).assessments[0];
  assert.deepEqual(a.scores, { s2: 50 });
  const pl = L.normalizeData(bad[11]).plans.s1;
  assert.equal(pl.items.length, 0);
  assert.equal(Object.getPrototypeOf(L.normalizeData(bad[10])), Object.prototype);
  assert.equal(L.normalizeData(bad[10]).classes.length, 0);
});

test('נתוני דוגמה: נטענים רק בקריאה מפורשת, ומוסרים בלי להשאיר עקבות', () => {
  const d = base();
  // תשלום אמיתי חוסם טעינת דוגמה (סקירה 11.2026, f34 — tests/review-2026-11-school.test.js); כאן — תוכנית אמיתית
  d.plans.s1 = L.normPlan({ items: [{ category: 'tuition', label: 'שכר לימוד', amountAg: 100000 }], installments: 10, startMonth: '2026-09' });
  const before = JSON.parse(JSON.stringify(d));
  assert.equal(L.loadDemo(d, TODAY), true);
  assert.equal(L.loadDemo(d, TODAY), false); // לא פעמיים
  assert.ok(d.students.length > 3);
  assert.ok(d.payments.some(p => p.demo));
  const seq = d.paySeq;
  L.removeDemo(d);
  assert.deepEqual(d.students, before.students);
  assert.deepEqual(d.payments, before.payments);
  assert.deepEqual(d.plans, before.plans);
  assert.deepEqual(d.attendance, before.attendance);
  assert.deepEqual(d.classes, before.classes);
  assert.equal(d.assessments.length, 0);
  assert.equal(d.paySeq, seq); // המספור לא חוזר אחורה
});

test('ימי הולדת קרובים, חיפוש ומחיקת תלמיד', () => {
  const d = base();
  d.students[0].birth = '2018-11-20';
  d.students[1].birth = '2018-10-01';
  const up = L.upcomingBirthdays(d, TODAY, 14);
  assert.deepEqual(up.map(u => [u.student.id, u.inDays, u.age]), [['s1', 5, 8]]);
  assert.equal(L.upcomingBirthdays(d, '2026-12-30', 30).length, 0);
  assert.deepEqual(L.searchStudents(d, { q: 'לוי' }).map(s => s.id), ['s2']);
  assert.deepEqual(L.searchStudents(d, { specialEd: true }).map(s => s.id), ['s3']);
  L.addPayment(d, { sid: 's2', amountAg: 100, date: TODAY });
  assert.equal(L.deleteStudent(d, 's2'), false);
  assert.equal(L.deleteStudent(d, 's1'), true);
  assert.equal(d.students.length, 2);
});

test('המודול: CSP, סדר סקריפטים, בלי רשת ובלי חלונות דפדפן', () => {
  const dir = path.join(__dirname, '..', 'modules', 'school');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const tools = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'index.html'), 'utf8');
  const csp = m => (/<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(m) || [])[0];
  assert.equal(csp(html), csp(tools));
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.match(scripts[0][1], /\/screen-guard\.js/);
  assert.ok(scripts.every(m => /src=/.test(m[1]) && !m[2].trim()), 'אין סקריפט מוטבע');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'אין מטפלי אירועים מוטבעים');
  for (const f of fs.readdirSync(dir).filter(f => /\.(js|html|css)$/.test(f))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|window\.open|\beval\(|new Function|https?:\/\//, f);
    assert.doesNotMatch(src, /(^|[^.\w])(alert|confirm|prompt)\(/m, f);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/, f + ': צבע hex');
    // k — מפתח נתונים שעבר את L.isDataKey (האחסון המפוצל, persist / readStored ב-app.js)
    assert.doesNotMatch(src, /localStorage\.(get|set|remove)Item\((?!\s*(KEY|UI_KEY|L\.STORAGE_KEY|'school:|k\b))/, f + ': מפתח בלי school:');
  }
  for (const k of ['school:core', 'school:data', 'school:pay:y1', 'school:grades:y1', 'school:att:2026-11']) assert.ok(L.isDataKey(k), k);
  for (const k of ['school:ui', 'english:x', 'school:att:2026-13', 'school:pay:', 'school:pay:a b', 'trainer:clients:index']) assert.equal(L.isDataKey(k), false, k);
});

test('תאריך עברי באותיות', () => {
  assert.equal(L.hebrewNumber(15), 'ט״ו');
  assert.equal(L.hebrewNumber(16), 'ט״ז');
  assert.equal(L.hebrewNumber(5787), 'תשפ״ז');
  assert.equal(L.hebrewNumber(1), 'א׳');
  assert.equal(L.hebrewNumber(0), '');
  const d = L.hebrewDate('2026-09-12');
  // בסביבה בלי לוח עברי ב-Intl — מחרוזת ריקה ולא חריגה
  assert.ok(d === '' || /^א׳ תשרי תשפ״ז$/.test(d), d);
  assert.equal(L.hebrewDate('bad'), '');
});

test('נתוני דוגמה בכולל: חבורות ואברכים בוגרים', () => {
  const d = L.emptyData();
  d.settings.type = 'kollel';
  L.loadDemo(d, TODAY);
  assert.ok(d.classes.every(c => c.name.startsWith('חבורה')));
  assert.ok(d.students.every(s => Number(TODAY.slice(0, 4)) - Number(s.birth.slice(0, 4)) >= 20));
  assert.ok(Object.keys(d.attendance[TODAY] || {}).includes('s0'));
});
