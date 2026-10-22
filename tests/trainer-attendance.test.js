// ניתוח נוכחות ונטישה, הודעות מוכנות והתאמת תוכנית לפרופיל (מודול האימונים) —
// על קוד המקור ב-modules-src/trainer, בלי רשת ובלי שליחה של שום הודעה.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
let A, P, Co, E;
test.before(async () => {
  [A, P, Co, E] = await Promise.all(['lib/attendance.js', 'lib/program.js', 'data/constants.js', 'data/exercises.js'].map(load));
});

// מועד ביומן: { id, date, time, kind, capacity, participants:[{clientId,status}] }
const appt = (id, date, status, clientId = 'c1', time = '18:00') => ({
  id, date, time, minutes: 60, kind: 'personal', title: '', capacity: 1,
  participants: [{ clientId, status }],
});
const client = (over = {}) => ({
  id: 'c1', name: 'משה כהן', goal: 'health', level: 'intermediate', daysPerWeek: 3,
  medical: [], equipment: Co.EQUIPMENT.map((e) => e.id), ...over,
});

test('participationLog — ממוין, מסונן עד היום ומדלג על רשומות כפולות', () => {
  const schedule = [
    appt('a3', '2026-10-20', 'noshow'),
    appt('a1', '2026-10-01', 'attended'),
    { ...appt('a2', '2026-10-20', 'attended'), time: '09:00' },
    appt('future', '2026-10-25', 'booked'),
    appt('bad', '2026-13-40', 'attended'),
    appt('other', '2026-10-19', 'attended', 'c2'),
  ];
  const log = A.participationLog([...schedule, schedule[0]], 'c1', { to: '2026-10-20' });
  assert.deepEqual(log.map((r) => r.id), ['a1', 'a2', 'a3'], 'ממוין לפי תאריך ושעה, בלי עתיד ובלי כפילות');
});

test('noshowRun — רצף היעדרויות מהסוף; "ביטל" לא עוצר, "רשום" עדיין לא נחשב', () => {
  const log = [
    { date: '2026-09-01', time: '', status: 'attended' },
    { date: '2026-09-08', time: '', status: 'noshow' },
    { date: '2026-09-15', time: '', status: 'cancelled' },
    { date: '2026-09-22', time: '', status: 'noshow' },
    { date: '2026-09-29', time: '', status: 'noshow' },
    { date: '2026-10-06', time: '', status: 'booked' },
  ];
  const run = A.noshowRun(log);
  assert.equal(run.count, 3);
  assert.equal(run.first, '2026-09-08');
  assert.equal(run.last, '2026-09-29');
  assert.equal(run.days, 21);
  assert.deepEqual(A.noshowRun([]), { count: 0, first: null, last: null, days: 0 });
});

test('שלוש היעדרויות על פני שלושה שבועות — "בסיכון"; 21 יום בלי אימון — "נשר"', () => {
  const atRisk = A.attendanceAnalysis({
    clients: [client()],
    schedule: [
      appt('1', '2026-09-01', 'attended'),
      appt('2', '2026-09-08', 'noshow'),
      appt('3', '2026-09-15', 'noshow'),
      appt('4', '2026-09-22', 'noshow'),
    ],
    today: '2026-09-22',
  })[0];
  assert.equal(atRisk.noshowStreak, 3);
  assert.equal(atRisk.atRisk, true);
  assert.equal(atRisk.level, 'atRisk');
  assert.equal(A.attendanceHeadline(atRisk), '3 היעדרויות רצופות — 3 שבועות');

  const dropped = A.attendanceAnalysis({
    clients: [client()],
    schedule: [appt('1', '2026-08-20', 'attended')],
    today: '2026-10-20',
  })[0];
  assert.equal(dropped.lastDays, 61);
  assert.equal(dropped.atRisk, false);
  assert.equal(dropped.dropped, true);
  assert.equal(A.attendanceHeadline(dropped), 'לא התאמן מזה 2 חודשים');
});

test('מתאמן חדש אינו "נשר", ומועד עתידי אינו נספר', () => {
  const fresh = A.attendanceAnalysis({
    clients: [client({ id: 'new' })],
    schedule: [appt('f', '2026-11-01', 'booked', 'new')],
    today: '2026-10-22',
  })[0];
  assert.equal(fresh.dropped, false);
  assert.equal(fresh.booked, 0, 'פגישה עתידית אינה נוכחות');
  assert.equal(fresh.rate, null);
  assert.equal(A.attendanceHeadline(fresh), 'אין נתוני נוכחות');
});

test('אחוז נוכחות מתוך הגעות מול היעדרויות; ביטול אינו משפיע', () => {
  const row = A.attendanceAnalysis({
    clients: [client()],
    schedule: [
      appt('1', '2026-10-01', 'attended'),
      appt('2', '2026-10-08', 'attended'),
      appt('3', '2026-10-15', 'attended'),
      appt('4', '2026-10-22', 'noshow'),
      appt('5', '2026-10-20', 'cancelled'),
    ],
    today: '2026-10-22',
  })[0];
  assert.equal(row.attended, 3);
  assert.equal(row.noshow, 1);
  assert.equal(row.cancelled, 1);
  assert.equal(row.rate, 75);
  assert.equal(A.attendanceHeadline(row), 'נוכחות 75%');
});

test('readyMessage — פנייה בשם הפרטי, בקשת המשך הדרגתית, וחתימת המאמן', () => {
  const c = client();
  const atRisk = { ...c, atRisk: true, dropped: false, noshowStreakDays: 21 };
  const m = A.readyMessage({ row: atRisk, trainer: { name: 'יצחק לוי' } });
  assert.equal(m.kind, 'comeback');
  assert.equal(m.clientId, 'c1');
  assert.match(m.message, /^שלום משה,/);
  assert.match(m.message, /מזה 3 שבועות/);
  assert.ok(m.message.endsWith('\nיצחק לוי'));

  const dropped = A.readyMessage({ row: { ...c, dropped: true, lastDays: 40 }, trainer: null });
  assert.match(dropped.message, /^שלום משה,/);
  assert.doesNotMatch(dropped.message, /\n$/, 'בלי חתימה כשאין שם מאמן');

  assert.equal(A.readyMessage({ row: { ...c, atRisk: false, dropped: false } }), null, 'מתאמן פעיל — אין הודעה');
});

test('profileFit — אזהרות רפואיות, מאגר מתאים ותרגילים שאינם מתאימים עוד', () => {
  const c = client({ medical: ['knee'] });
  const fit = A.profileFit(c, null);
  assert.equal(fit.warnings.length, 1);
  assert.match(fit.summary, /ברכיים/);
  assert.ok(fit.available > 0);
  assert.ok(fit.available < E.EXERCISES.length, 'המגבלה מצמצמת את המאגר');

  assert.deepEqual(P.exclusionReasons(c, { eq: ['bw'], lvl: 'beginner', contra: ['knee'] }), ['מגבלה רפואית: ברכיים']);
  assert.ok(P.exclusionReasons({ ...c, equipment: ['bw'] }, { eq: ['barbell'], lvl: 'beginner', contra: [] }).includes('אין ציוד מתאים'));
  assert.deepEqual(P.exclusionReasons(c, { eq: ['bw'], lvl: 'beginner', contra: [] }), [], 'ציוד מתאים — אין סיבה');
  assert.ok(P.exclusionReasons(client({ level: 'beginner' }), { eq: ['bw'], lvl: 'advanced', contra: [] }).includes('רמה גבוהה מדי למתחיל'));
  assert.ok(!P.exclusionReasons(client(), { eq: ['bw'], lvl: 'advanced', contra: [] }).includes('רמה גבוהה מדי למתחיל'), 'בינוני — אין חסימת רמה');

  // תרגיל שנשאר בתוכנית ישנה עם סיבה שמורה — מסומן, ולא מוסר לבד
  const stored = { days: [{ name: 'יום A', exercises: [{ exerciseId: 'squat-back' }, { exerciseId: 'squat-back' },
    { exerciseId: 'pushup', exclusionReasons: ['מגבלה רפואית: ברכיים'] }] }] };
  const flagged = A.profileFit(c, stored);
  assert.equal(flagged.exclusions.length, 1);
  assert.deepEqual(flagged.exclusions[0].reasons, ['מגבלה רפואית: ברכיים']);
});

test('attendanceSummary — ממוצע, ובסיכון לא נספר פעמיים כנשר', () => {
  const today = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'][4];
  const s = A.attendanceSummary({
    clients: [client(), client({ id: 'c2', name: 'אברהם דוד' }), client({ id: 'c3', name: 'חדש' })],
    schedule: [
      appt('1', '2026-09-01', 'attended'),
      appt('2', '2026-09-08', 'attended'),
      appt('3', '2026-09-15', 'noshow'),
      appt('4', '2026-09-22', 'noshow'),
      appt('5', '2026-09-29', 'noshow'),
      // c2 התאמן לאחרונה ב-1.9 — 28 יום לפני today, נשר בלי רצף היעדרויות
      appt('6', '2026-09-01', 'attended', 'c2'),
      appt('7', '2026-08-25', 'attended', 'c2'),
    ],
    today,
  });
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.atRisk.map((r) => r.id), ['c1']);
  assert.deepEqual(s.dropped.map((r) => r.id), ['c2'], 'c1 בסיכון, לא נשר');
  assert.equal(s.avgRate, Math.round((40 + 100) / 2));
});
