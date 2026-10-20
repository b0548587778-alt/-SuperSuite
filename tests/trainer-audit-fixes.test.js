// מודול האימונים — תיקונים לפי בדיקת הקוד מ-20.10.2026 (docs/audit-parts/audit-trainer-tools.md), ממצאים 3, 4, 5, 7, 8, 9, 11.
// הלוגיקה הטהורה נבדקת ישירות מהמקור (modules-src/trainer — ESM דרך import()), ותשלומי האימונים במערכת הכלכלית (CommonJS)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
const TP = require('../modules/econ/core/trainerPayments');
const { checkTrainerItems, legacyTrainerBackup } = require('../shell/trainer-backup-check');

let St, P;
test.before(async () => { [St, P] = await Promise.all(['lib/studio.js', 'lib/program.js'].map(load)); });

const J = (v) => JSON.stringify(v);

// ─── ממצא 3: חשבונית כפולה אחרי מחיקה והזנה מחדש של תשלום ───
function itemsWith(payments, clientId = 'c_1') {
  return {
    'clients:index': J([clientId, 'c_2']),
    [`client:${clientId}`]: J({ id: clientId, name: 'יוסף כהן' }),
    [`memberships:${clientId}`]: J([{ id: 'mb_1', name: 'מנוי חודשי', priceAg: 60000, payments, uses: [] }]),
    'client:c_2': J({ id: 'c_2', name: 'שמעון לוי' }),
    'memberships:c_2': J([{ id: 'mb_2', name: 'כרטיסייה', priceAg: 60000, payments: [{ id: 'p_9', date: '2026-10-01', amountAg: 60000, method: 'cash' }], uses: [] }]),
  };
}
const invoice = (over = {}) => ({ id: 'inv_1', number: 1001, status: 'paid', date: '2026-10-01', total: 600,
  trainerPayment: { key: 'c_1/mb_1/p_old', clientId: 'c_1', membershipId: 'mb_1', paymentId: 'p_old' }, ...over });

test('ממצא 3: תשלום שנמחק והוזן מחדש (גם בתאריך אחר) — מסומן כחשד לכפילות, עם מספר החשבונית הקודמת', () => {
  // לפני: p_old עם חשבונית 1001. אחרי: p_old נמחק ו-p_new הוזן מחדש לתיקון התאריך
  const before = TP.withReceipts(TP.readPayments(itemsWith([{ id: 'p_old', date: '2026-10-01', amountAg: 60000, method: 'cash' }])), [invoice()]);
  assert.equal(before.find(p => p.key === 'c_1/mb_1/p_old').invoiceNumber, 1001);
  assert.equal(before.find(p => p.key === 'c_1/mb_1/p_old').duplicateWarning, undefined, 'לתשלום שיש לו חשבונית — אין אזהרה');

  const payments = TP.readPayments(itemsWith([{ id: 'p_new', date: '2026-10-02', amountAg: 60000, method: 'transfer' }]));
  const after = TP.withReceipts(payments, [invoice()]);
  const p = after.find(x => x.key === 'c_1/mb_1/p_new');
  assert.equal(p.invoiceNumber, undefined, 'עדיין בלי חשבונית — ההפקה לא נחסמת');
  assert.deepEqual(p.possibleDuplicateOf, [{ invoiceId: 'inv_1', invoiceNumber: 1001, date: '2026-10-01', reason: 'orphan' }]);
  assert.match(p.duplicateWarning, /1001/);
  assert.match(p.duplicateWarning, /נמחק במודול האימונים/);
  assert.match(p.duplicateWarning, /אין להפיק שוב/);
  assert.deepEqual(TP.orphanReceipts(payments, [invoice()]).map(i => i.number), [1001], 'החשבונית שהתשלום שלה נמחק');
  // מתאמן אחר באותו סכום ותאריך — לא מסומן
  assert.equal(after.find(x => x.clientId === 'c_2').duplicateWarning, undefined);
});

test('ממצא 3: אין אזהרת שווא — חשבונית שבוטלה, סכום אחר, ותשלום חודשי חוזר כשהקודם עדיין קיים', () => {
  const cur = [{ id: 'p_new', date: '2026-10-02', amountAg: 60000, method: 'cash' }];
  const none = (invs, pays = cur) => TP.withReceipts(TP.readPayments(itemsWith(pays)), invs).every(p => !p.possibleDuplicateOf);
  assert.ok(none([invoice({ status: 'cancelled' })]), 'חשבונית שבוטלה');
  assert.ok(none([invoice({ total: 500 })]), 'סכום אחר');
  assert.ok(none([invoice({ trainerPayment: { key: 'c_9/mb_1/p_old', clientId: 'c_9' } })]), 'מתאמן אחר');
  assert.ok(none([]), 'בלי חשבוניות');
  // תשלום של חודש קודם (קיים, עם חשבונית) ותשלום חדש באותו סכום בתאריך אחר — תשלום אמיתי נוסף
  const monthly = [{ id: 'p_old', date: '2026-09-01', amountAg: 60000, method: 'cash' }, { id: 'p_next', date: '2026-10-01', amountAg: 60000, method: 'cash' }];
  assert.ok(none([invoice({ date: '2026-09-01' })], monthly));
  assert.deepEqual(TP.orphanReceipts(TP.readPayments(itemsWith(monthly)), [invoice()]), []);
});

test('ממצא 3: אותו מתאמן, אותו תאריך ואותו סכום כשהתשלום הקודם קיים — "same-date" (הוזן פעמיים?)', () => {
  const twice = [{ id: 'p_old', date: '2026-10-01', amountAg: 60000, method: 'cash' }, { id: 'p_dup', date: '2026-10-01', amountAg: 60000, method: 'cash' }];
  const list = TP.withReceipts(TP.readPayments(itemsWith(twice)), [invoice()]);
  const dup = list.find(p => p.key === 'c_1/mb_1/p_dup');
  assert.deepEqual(dup.possibleDuplicateOf.map(d => [d.invoiceNumber, d.reason]), [[1001, 'same-date']]);
  assert.match(dup.duplicateWarning, /באותו תאריך ובאותו סכום/);
  assert.equal(TP.duplicateWarning([]), '');
});

// ─── ממצא 4: ביום שישי — תזכורת לאימונים של יום ראשון ───
test('ממצא 4: ביום שישי "אימונים ביום ראשון"; בשאר הימים — מחר', () => {
  const plan = { id: 'plan_m', name: 'חודשי', kind: 'monthly', sessions: null, validDays: 30, priceAg: 0 };
  const memberships = { c1: [St.newMembership(plan, '2026-10-01')] };
  const sunday = St.makeAppointments({ date: '2026-10-25', time: '09:00', minutes: 45, kind: 'personal', clientIds: ['c1'] });
  const base = { clients: [{ id: 'c1', name: 'משה לוי' }], membershipsByClient: memberships, lastSessionByClient: { c1: '2026-10-22' }, schedule: sunday };
  assert.equal(St.weekday('2026-10-23'), 5, '23.10.2026 — יום שישי');
  const fri = St.reminders({ ...base, today: '2026-10-23' }).filter(r => r.kind === 'tomorrow');
  assert.equal(fri.length, 1, 'ביום שישי מופיע האימון של יום ראשון');
  assert.match(fri[0].title, /ביום ראשון ב-09:00/);
  assert.match(fri[0].message, /ביום ראשון \(/);
  assert.doesNotMatch(fri[0].message, /מחר/);
  assert.deepEqual(St.nextTrainingDay('2026-10-23'), { date: '2026-10-25', label: 'ביום ראשון' });
  assert.deepEqual(St.nextTrainingDay('2026-10-24'), { date: '2026-10-25', label: 'מחר' }, 'במוצאי שבת — מחר');
  assert.deepEqual(St.nextTrainingDay('2026-10-21'), { date: '2026-10-22', label: 'מחר' });
  // ביום חמישי — האימון של יום ראשון עוד לא
  assert.equal(St.reminders({ ...base, today: '2026-10-22' }).filter(r => r.kind === 'tomorrow').length, 0);
});

// ─── ממצא 5: סדר הניכוי — מדיניות מתועדת בקוד, לא שונתה ───
test('ממצא 5: הניכוי נשאר מהמנוי הוותיק (מדיניות שמוצהרת בהערה בקוד) — לא שונה בתיקון הזה', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(SRC, 'lib', 'studio.js'), 'utf8');
  assert.match(src, /המנוי שממנו מנכים אימון: הוותיק מבין הפעילים/);
  const punch = { id: 'p10', name: 'כרטיסייה 10', kind: 'punch', sessions: 10, validDays: null, priceAg: 0 };
  const monthly = { id: 'm8', name: 'חודשי 8', kind: 'punch', sessions: 8, validDays: 30, priceAg: 0 };
  const list = [St.newMembership(punch, '2026-09-01'), St.newMembership(monthly, '2026-10-01')];
  assert.equal(St.activeMembership(list, '2026-10-05').name, 'כרטיסייה 10');
});

// ─── ממצא 7: לוח הבקרה סופר גם נוכחות ביומן ───
test('ממצא 7: מתאמן שהגיע אתמול ביומן — נספר השבוע ולא מופיע "טרם התאמן"', () => {
  const today = '2026-10-20';
  let sch = St.makeAppointments({ date: '2026-10-19', time: '08:00', minutes: 45, kind: 'personal', clientIds: ['c1'] });
  sch = St.setAttendance(sch, sch[0].id, 'c1', 'attended');
  const old = St.makeAppointments({ date: '2026-09-01', time: '08:00', minutes: 45, kind: 'personal', clientIds: ['c2'] });
  const sch2 = [...sch, ...St.setAttendance(old, old[0].id, 'c2', 'attended')];
  const r = St.trainingOverview({
    clients: [{ id: 'c1', name: 'א' }, { id: 'c2', name: 'ב' }, { id: 'c3', name: 'ג' }],
    schedule: sch2,
    // רישום בתוכנית באותו יום של הנוכחות — אימון אחד; ורישום לפני 10 ימים
    sessionsByClient: { c1: [{ completedAt: new Date(2026, 9, 19, 9).toISOString() }, { completedAt: new Date(2026, 9, 10, 9).toISOString() }], c3: [{ completedAt: 'לא תאריך' }] },
    today,
  });
  assert.equal(r.sessionsWeek, 1, 'אימון אתמול — פעם אחת (יומן + תוכנית באותו יום)');
  assert.equal(r.sessionsMonth, 2, 'אתמול ולפני 10 ימים; לפני 49 יום — לא בחודש');
  assert.deepEqual(r.inactive.map(c => [c.id, c.lastDate, c.lastDays]), [['c2', '2026-09-01', 49], ['c3', null, null]]);
  assert.equal(St.relativeDaysHe(1), 'אתמול');
  assert.equal(St.relativeDaysHe(8), 'לפני שבוע');
  assert.equal(St.relativeDaysHe(49), 'לפני חודש');
  assert.equal(St.relativeDaysHe(70), 'לפני 2 חודשים');
});

// ─── ממצא 8: מאגר האנשים — כרטיסייה שנוצלה כולה אינה "פעיל", ומנוי שבוטל בלי חוב ───
test('ממצא 8: readClients — "פעיל" כמו membershipStatus, ובלי חוב בשורה של מנוי שבוטל', () => {
  const uses = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, date: '2026-10-0' + ((i % 9) + 1) }));
  const items = {
    'clients:index': J(['c1']),
    'client:c1': J({ id: 'c1', name: 'אהרן פרידמן' }),
    'memberships:c1': J([
      { id: 'm_used', name: 'כרטיסייה 10', sessions: 10, start: '2026-09-01', end: null, priceAg: 50000, payments: [], uses: uses(10) },
      { id: 'm_left', name: 'כרטיסייה 5', sessions: 5, start: '2026-09-01', end: null, priceAg: 0, payments: [], uses: uses(4) },
      { id: 'm_cancel', name: 'חודשי', start: '2026-10-01', end: '2026-10-30', priceAg: 30000, payments: [], uses: [], cancelledAt: '2026-10-05' },
    ]),
  };
  const [c] = TP.readClients(items, '2026-10-19');
  const by = Object.fromEntries(c.memberships.map(m => [m.id, m]));
  assert.equal(by.m_used.active, false, 'כרטיסייה שנוצלה כולה');
  assert.equal(by.m_used.dueAg, 50000, 'חוב על מנוי שלא בוטל — נשאר');
  assert.equal(by.m_left.active, true);
  assert.deepEqual([by.m_cancel.active, by.m_cancel.cancelled, by.m_cancel.dueAg], [false, true, 0]);
  // אותה הכרעה כמו במודול
  const studioState = St.membershipStatus({ sessions: 10, start: '2026-09-01', end: null, uses: uses(10), payments: [] }, '2026-10-19').state;
  assert.equal(studioState, 'ended');
});

// ─── ממצא 9: טווחים בכרטיס המתאמן, BMI ותוכנית ריקה ───
test('ממצא 9: validateClient — גיל, גובה בס"מ, משקל, ימים וציוד', () => {
  const ok = { name: 'דוד', age: '30', height: '175', weight: '80', daysPerWeek: 3, equipment: ['bw'] };
  assert.deepEqual(P.validateClient(ok), []);
  assert.deepEqual(P.validateClient({ ...ok, height: '', weight: '' }), [], 'גובה ומשקל — רשות');
  const errs = (over) => P.validateClient({ ...ok, ...over }).join(' | ');
  assert.match(errs({ height: '1.75' }), /גובה צריך להיות בין 100 ל-250 ס"מ/, 'גובה במטרים');
  assert.match(errs({ weight: '-70' }), /משקל צריך להיות בין 20 ל-350/);
  assert.match(errs({ age: '' }), /גיל — שדה חובה/);
  assert.match(errs({ age: '300' }), /גיל צריך להיות בין 5 ל-120/);
  assert.match(errs({ daysPerWeek: '-1' }), /ימי אימון בשבוע צריך להיות בין 1 ל-7/);
  assert.match(errs({ equipment: [] }), /לפחות פריט ציוד אחד/);
});

test('ממצא 9: calcBMI — null מחוץ לטווח; generateProgram — שגיאה בעברית בלי תרגילים מתאימים', () => {
  assert.equal(P.calcBMI(1, 70), null, 'גובה 1 (מ"1.75") — לא BMI של 700,000');
  assert.equal(P.calcBMI(175, -70), null);
  assert.equal(P.calcBMI(180, 81), '25.0', 'ערך תקין — כמו קודם');
  const client = { goal: 'health', level: 'intermediate', daysPerWeek: 3, medical: [], equipment: [] };
  assert.throws(() => P.generateProgram(client, { random: () => 0.5 }), /אין תרגילים שמתאימים לציוד/);
  const prog = P.generateProgram({ ...client, equipment: ['bw'] }, { random: () => 0.5 });
  assert.ok(prog.days.some(d => d.exercises.length > 0));
});

// ─── ממצא 11: בדיקת השחזור — ערכי הרשימות חייבים להיות רשימות ───
test('ממצא 11: memberships/sessions/measurements/assessments שאינם רשימה — הקובץ נדחה לפני מחיקה', () => {
  const good = {
    'clients:index': J(['c_1']), 'trainer:profile': J({ name: 'דוד' }), 'client:c_1': J({ id: 'c_1', name: 'יוסף' }),
    'program:c_1': J({ days: [] }), 'memberships:c_1': J([]), 'sessions:c_1': J([]), 'measurements:c_1': J([]), 'assessments:c_1': J([]),
    'studio:plans': J([]), 'studio:schedule': J([]),
  };
  assert.equal(checkTrainerItems(good).ok, true);
  for (const k of ['memberships:c_1', 'sessions:c_1', 'measurements:c_1', 'assessments:c_1']) {
    const r = checkTrainerItems({ ...good, [k]: J({}) });
    assert.equal(r.ok, false, k);
    assert.match(r.error, new RegExp('הערך של ' + k + ' אינו תקין'));
  }
  for (const k of ['client:c_1', 'program:c_1', 'trainer:profile']) {
    assert.equal(checkTrainerItems({ ...good, [k]: J([]) }).ok, false, k + ' — רשימה במקום רשומה');
  }
  assert.equal(legacyTrainerBackup({ ...good, 'memberships:c_1': '{}' }), null, 'קובץ JSON ישן ופגום — לא מומר לשחזור');
  assert.ok(legacyTrainerBackup(good));
});

// ממצא 3 (המשך): האזהרה מחושבת בשרת — וחייבת להגיע למסך: בשורה ובחלון האישור לפני ההפקה
test('מסך הגבייה: חשד לחשבונית כפולה מוצג בשורת התשלום ובראש נוסח האישור', async () => {
  const vm = require('vm');
  const EconUI = require('./helpers/econ-ui');
  const context = { console, setTimeout, clearTimeout, Date, Intl, URLSearchParams, location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } } };
  context.window = context;
  vm.createContext(context);
  EconUI.run(context);
  const warning = TP.duplicateWarning([{ invoiceNumber: 17, reason: 'orphan' }]);
  const base = { key: 'c1/m1/p2', date: '2026-10-18', clientName: 'יוסף כהן', membershipName: 'כרטיסייה 10', amount: 350, methodLabel: 'מזומן' };
  context.__p = { ...base, duplicateWarning: warning };
  const text = vm.runInContext('collectTrainerConfirmText(__p)', context);
  assert.ok(text.startsWith(warning), 'האזהרה בראש נוסח האישור');
  context.__p = base;
  assert.doesNotMatch(vm.runInContext('collectTrainerConfirmText(__p)', context), /⚠/, 'בלי חשד — בלי אזהרה');

  let html = '';
  context.systemAPI = { collectTrainerPayments: async () => ({ available: true,
    payments: [{ ...base, duplicateWarning: warning }, { ...base, key: 'c1/m1/p1', invoiceNumber: 17 }] }) };
  context.openDialog = (build) => {
    const card = { style: {}, innerHTML: '', querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [] };
    build(card, () => {});
    html = card.innerHTML;
    return Promise.resolve(null);
  };
  await vm.runInContext('collectTrainerPayments()', context);
  const rows = html.split('<tr>').filter(r => r.includes('data-trainer-issue') || r.includes('חשבונית 17'));
  const pending = rows.find(r => r.includes('data-trainer-issue="c1/m1/p2"'));
  assert.ok(pending, 'שורת התשלום בלי חשבונית');
  assert.match(pending, /ss-badge-warning/);
  assert.match(pending, /ייתכן שכבר הופקה/);
  assert.ok(pending.includes('מספר 17'), 'מספר החשבונית החשודה מופיע (בכותרת התגית)');
  const done = rows.find(r => r.includes('ss-badge-success'));
  assert.ok(done && !done.includes('ss-badge-warning'), 'לתשלום שכבר יש לו חשבונית — בלי אזהרה');
});
