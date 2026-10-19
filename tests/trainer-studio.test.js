'use strict';
// ניהול סטודיו במודול האימונים (PLAN.md 9.11): מנויים וכרטיסיות, יומן, תשלומים, תזכורות ודוח התקדמות.
// הלוגיקה ב-modules-src/trainer/src/lib/studio.js (ESM, בלי DOM) — נבדקת כאן ישירות, לפני בניית המודול.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'modules-src', 'trainer', 'src');
let St;
test.before(async () => { St = await import(pathToFileURL(path.join(SRC, 'lib', 'studio.js')).href); });

const plan10 = { id: 'p10', name: 'כרטיסיית 10 אימונים', kind: 'punch', sessions: 10, validDays: 120, priceAg: 60000, active: true };

test('תאריכים מקומיים: ימים, שבוע ראשון–שישי בלי שבת, זיהוי שבת', () => {
  assert.equal(St.addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(St.daysBetween('2026-10-19', '2026-10-26'), 7);
  assert.deepEqual(St.weekDays('2026-10-21'), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.equal(St.isShabbat('2026-10-24'), true);
  assert.equal(St.isDateStr('2026-02-30'), false);
  assert.equal(St.todayStr(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('כסף באגורות: קלט בשקלים ותצוגה', () => {
  assert.equal(St.parseShekels('1,250.5'), 125050);
  assert.equal(St.parseShekels('₪ 99'), 9900);
  assert.equal(St.parseShekels('0.07'), 7);
  for (const bad of ['', '-5', 'abc', '1.234']) assert.equal(St.parseShekels(bad), null, bad);
  assert.equal(St.fmtAg(125050), '₪1,250.50');
  assert.equal(St.fmtAg(60000), '₪600');
});

test('סוג מנוי: בדיקות קלט', () => {
  assert.equal(St.validatePlan(plan10), null);
  assert.match(St.validatePlan({ ...plan10, name: ' ' }), /שם/);
  assert.match(St.validatePlan({ ...plan10, sessions: 0 }), /אימונים/);
  assert.match(St.validatePlan({ name: 'חודשי', kind: 'period', sessions: null, validDays: null, priceAg: 0 }), /ימים/);
  assert.equal(St.validatePlan({ name: 'חודשי ללא הגבלה', kind: 'period', sessions: null, validDays: 30, priceAg: 35000 }), null);
  assert.match(St.validatePlan({ ...plan10, priceAg: 12.5 }), /מחיר/);
});

test('כרטיסייה של 10: עשר נוכחויות ← "נוצל" ותזכורת; אימון 11 לא מנוכה', () => {
  let list = [St.newMembership(plan10, '2026-10-01')];
  assert.equal(list[0].end, '2027-01-28');
  for (let i = 0; i < 10; i++) {
    const r = St.recordUse(list, { date: '2026-10-05', ref: 'ap' + i, source: 'schedule' }, '2026-10-05');
    assert.ok(r.membership, 'ניצול ' + (i + 1));
    list = r.list;
    if (i === 7) assert.equal(St.membershipStatus(list[0], '2026-10-05').state, 'ending', 'נותרו 2 — עומד להסתיים');
  }
  const st = St.membershipStatus(list[0], '2026-10-05');
  assert.deepEqual([st.used, st.left, st.state], [10, 0, 'ended']);
  const r11 = St.recordUse(list, { date: '2026-10-06', ref: 'ap10' }, '2026-10-06');
  assert.equal(r11.membership, null);
  const rem = St.reminders({ clients: [{ id: 'c1', name: 'יוסף לוי' }], membershipsByClient: { c1: list }, schedule: [], today: '2026-10-06' });
  assert.ok(rem.some((x) => x.kind === 'ended' && /יוסף/.test(x.message)));
});

test('ניצול: אותה פגישה לא מנוכה פעמיים, ביטול נוכחות מחזיר את האימון, מנוי ותיק קודם', () => {
  const older = { ...St.newMembership(plan10, '2026-09-01'), id: 'old' };
  const newer = { ...St.newMembership(plan10, '2026-10-01'), id: 'new' };
  let list = [newer, older];
  let r = St.recordUse(list, { date: '2026-10-05', ref: 'ap1:c1' }, '2026-10-05');
  assert.equal(r.membership.id, 'old');
  list = r.list;
  r = St.recordUse(list, { date: '2026-10-05', ref: 'ap1:c1' }, '2026-10-05');
  assert.equal(r.already, true);
  list = St.removeUseByRef(list, 'ap1:c1');
  assert.equal(St.membershipStatus(list.find((m) => m.id === 'old'), '2026-10-05').used, 0);
});

test('תוקף: מנוי שפג לא מנוכה, ומנוי עתידי לא פעיל עדיין', () => {
  const m = St.newMembership({ ...plan10, validDays: 10 }, '2026-10-01');
  assert.equal(St.membershipStatus(m, '2026-10-11').state, 'expired');
  assert.equal(St.recordUse([m], { date: '2026-10-11' }, '2026-10-11').membership, null);
  assert.equal(St.membershipStatus(m, '2026-09-30').state, 'future');
  assert.equal(St.membershipStatus(m, '2026-10-04').state, 'ending', 'שבוע לסוף התוקף');
});

test('תשלומים: יתרה באגורות, אין תשלום מעל היתרה, אמצעי תשלום חובה', () => {
  let list = [{ ...St.newMembership(plan10, '2026-10-01'), id: 'm1' }];
  list = St.addPayment(list, 'm1', { date: '2026-10-01', amountAg: 25050, method: 'cash' });
  assert.equal(St.membershipStatus(list[0], '2026-10-02').dueAg, 34950);
  assert.throws(() => St.addPayment(list, 'm1', { date: '2026-10-02', amountAg: 34951, method: 'cash' }), /גבוה מהיתרה/);
  assert.throws(() => St.addPayment(list, 'm1', { date: '2026-10-02', amountAg: 100, method: 'x' }), /אמצעי/);
  list = St.addPayment(list, 'm1', { date: '2026-10-02', amountAg: 34950, method: 'transfer' });
  assert.equal(St.membershipStatus(list[0], '2026-10-02').dueAg, 0);
  const pid = list[0].payments[0].id;
  assert.equal(St.membershipStatus(St.removePayment(list, 'm1', pid)[0], '2026-10-02').dueAg, 25050);
});

test('יומן: אין אימון בשבת, סדרה שבועית, מקומות בשיעור וחפיפה', () => {
  assert.throws(() => St.makeAppointments({ date: '2026-10-24', time: '10:00', minutes: 60, kind: 'personal', clientIds: ['c1'] }), /שבת/);
  const series = St.makeAppointments({ date: '2026-10-19', time: '18:30', minutes: 60, kind: 'group', title: 'כושר לגברים', capacity: 2, clientIds: ['c1'], weeks: 4 });
  assert.deepEqual(series.map((a) => a.date), ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
  assert.ok(series.every((a) => a.seriesId === series[0].seriesId));
  let sch = St.addParticipant(series, series[0].id, 'c2');
  assert.throws(() => St.addParticipant(sch, series[0].id, 'c3'), /מלא/);
  assert.throws(() => St.makeAppointments({ date: '2026-10-20', time: '9:00', minutes: 60, kind: 'personal' }), /שעה/);
  const p = St.makeAppointments({ date: '2026-10-19', time: '19:00', minutes: 30, kind: 'personal', clientIds: ['c3'] })[0];
  assert.equal(St.overlaps(sch, p).length, 1);
  sch = St.setAttendance(sch, series[0].id, 'c1', 'attended');
  sch = St.setAttendance(sch, series[1].id, 'c1', 'noshow');
  const stats = St.attendanceStats(sch, 'c1');
  assert.deepEqual([stats.attended, stats.noshow, stats.rate], [1, 1, 50]);
  assert.equal(St.lastTrainingDate(sch, [], 'c1'), '2026-10-19');
  const without = St.removeClientEverywhere([p], 'c3');
  assert.equal(without.length, 0, 'אימון אישי בלי מתאמן נמחק');
});

test('תזכורות: עומד להסתיים, חוב, לא התאמן, ואימון מחר — עם הודעה מוכנה', () => {
  let list = [{ ...St.newMembership(plan10, '2026-10-01'), id: 'm1' }];
  for (let i = 0; i < 9; i++) list = St.recordUse(list, { date: '2026-10-02' }, '2026-10-02').list;
  const sch = St.makeAppointments({ date: '2026-10-20', time: '08:00', minutes: 45, kind: 'personal', clientIds: ['c1'] });
  const rem = St.reminders({
    clients: [{ id: 'c1', name: 'שמואל כהן' }], membershipsByClient: { c1: list },
    lastSessionByClient: { c1: '2026-10-02' }, schedule: sch, today: '2026-10-19', trainer: { name: 'המאמן דוד' },
  });
  const kinds = rem.map((r) => r.kind);
  assert.deepEqual(kinds, ['debt', 'ending', 'tomorrow', 'inactive']);
  assert.match(rem[0].message, /₪600/);
  assert.match(rem[1].detail, /נותרו 1/);
  assert.match(rem[2].message, /08:00/);
  assert.ok(rem.every((r) => r.message.endsWith('המאמן דוד')));
});

test('דוח התקדמות: השוואה ראשונה מול אחרונה, כיוון רצוי, נקודות לגרף וטקסט לשליחה', () => {
  const ms = [
    { date: '2026-09-01T10:00:00.000Z', weight: 92, waist: 104 },
    { date: '2026-10-01T10:00:00.000Z', weight: 88.5, waist: 99.5, bodyFat: 25 },
  ];
  const sum = St.measurementSummary(ms);
  const w = sum.find((s) => s.k === 'weight');
  assert.deepEqual([w.first, w.last, w.diff, w.good, w.count], [92, 88.5, -3.5, true, 2]);
  assert.equal(sum.find((s) => s.k === 'bodyFat').count, 1);
  const pts = St.chartPoints([92, 90, 88.5], 200, 100);
  assert.deepEqual(pts[0], { x: 8, y: 10 });
  assert.deepEqual(pts[2], { x: 192, y: 90 });
  assert.equal(St.pathOf(pts.slice(0, 2)), 'M8 10 L100 55.7');
  const text = St.progressText({ client: { name: 'שמואל כהן' }, trainer: { name: 'דוד' }, summary: sum, stats: { attended: 7, rate: 88 }, membership: null, today: '2026-10-19' });
  assert.match(text, /משקל: 92 ← 88.5 ק"ג \(▼ 3.5\)/);
  assert.match(text, /נוכחות 88%/);
  assert.doesNotMatch(text, /אחוז שומן/, 'מדידה אחת — אין השוואה');
});
