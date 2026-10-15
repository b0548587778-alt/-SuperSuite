// לוח בוקר למנהל העמותה (core/dashboard.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../modules/econ/core/dashboard');
const G = require('../modules/econ/core/gemach');
const M = require('../modules/econ/core/memorials');
const SO = require('../modules/econ/core/standingOrders');

const TODAY = '2026-10-01';
const loan = (name, issueDate, paid = 0) => {
  const schedule = G.buildSchedule(3000, 3, issueDate).map((s, i) => (i < paid ? { ...s, paidAg: s.amountAg, status: 'paid' } : s));
  return { ...G.validateLoanInput({ borrowerName: name, amount: 3000, installments: 3, issueDate }), id: name, status: 'active', schedule };
};

function sample() {
  return {
    npo: {
      grants: [
        { id: 'g1', source: 'משרד החינוך', program: 'תמיכה בתלמודי תורה', status: 'requested', deadline: '2026-09-20', documents: [{ name: 'דוח כספי', done: false }] },
        { id: 'g2', source: 'עיריית בני ברק', program: 'חסד', status: 'requested', deadline: '2026-10-15', documents: [] },
        { id: 'g3', source: 'קרן ותיקה', program: '', status: 'received', deadline: '2026-10-05' },
      ],
      donations: [
        { id: 'd1', donorName: 'משה כהן', donorId: '', amount: 500, date: '2026-09-10', receipt: { number: 1, sec46: true } },
        { id: 'd2', donorName: 'שמואל לוי', donorId: '000000018', amount: 360, date: '2026-09-11', receipt: { number: 2, sec46: true }, taxReport: { registrationNumber: 'A123' } },
      ],
      standingOrders: [
        { ...SO.validateStandingOrder({ donorName: 'אהרן גולד', amount: 100, dayOfMonth: 1, startMonth: '2026-07' }), id: 'so1',
          history: [{ month: '2026-07', status: 'received' }, { month: '2026-08', status: 'failed' }, { month: '2026-09', status: 'failed' }] },
        { ...SO.validateStandingOrder({ donorName: 'בנימין רוזן', amount: 50, dayOfMonth: 1, startMonth: '2026-09' }), id: 'so2', history: [] },
      ],
      memorials: [M.validateMemorial({ name: 'אברהם', parentName: 'יצחק', deathDate: '2025-10-20', contactName: 'יעקב', contactPhone: '050-1234567' })],
    },
    gemach: {
      loans: [loan('יוסף פרידמן', '2026-06-01'), loan('דוד שפירא', '2026-06-01', 3)],
      items: [{ id: 'i1', name: 'עגלת תינוק', condition: 'good' }],
      lendings: [{ id: 'le1', itemId: 'i1', borrowerName: 'חיים ברגר', date: '2026-09-01', dueDate: '2026-09-15' }],
      applications: [{ id: 'a1', status: 'interview' }, { id: 'a2', status: 'approved' }],
    },
    chesed: { rounds: [{ id: 'r1', name: 'חלוקת סוכות', status: 'open' }, { id: 'r2', name: 'פסח', status: 'closed' }] },
  };
}

const titles = (b) => b.items.map(i => i.title);

test('ממיין לפי דחיפות ומפנה כל שורה למסך שלה', () => {
  const b = D.morningBrief(sample(), TODAY);
  const order = b.items.map(i => i.level);
  assert.deepEqual(order, [...order].sort((a, c) => ['urgent', 'soon', 'info'].indexOf(a) - ['urgent', 'soon', 'info'].indexOf(c)));
  assert.ok(b.items.every(i => ['npo', 'gemach', 'chesed'].includes(i.view)));
  assert.equal(b.total, b.counts.urgent + b.counts.soon + b.counts.info);
});

test('תמיכות: מועד שעבר — דחוף; מועד קרוב — בקרוב; תמיכה שהתקבלה — לא מופיעה', () => {
  const b = D.morningBrief(sample(), TODAY);
  const g1 = b.items.find(i => i.title.includes('תלמודי תורה'));
  assert.equal(g1.level, 'urgent');
  assert.match(g1.detail, /מסמך אחד/);
  assert.equal(b.items.find(i => i.title.includes('עיריית בני ברק')).level, 'soon');
  assert.ok(!titles(b).some(t => t.includes('קרן ותיקה')));
});

test('דיווח ל"תרומות ישראל": רק מה שממתין, עם אזהרה על ת.ז חסרה', () => {
  const t = D.morningBrief(sample(), TODAY).items.find(i => i.title.includes('תרומות ישראל'));
  assert.equal(t.count, 1);
  assert.match(t.detail, /בלי ת.ז תקינה/);
});

test('הוראות קבע: שני כישלונות רצופים — דחוף; חודש שלא סומן — בקרוב, בלי ספירה כפולה', () => {
  const b = D.morningBrief(sample(), TODAY);
  assert.equal(b.items.find(i => i.title.includes('אהרן גולד')).level, 'urgent');
  const missed = b.items.find(i => i.title.includes('לא סומן'));
  assert.equal(missed.count, 1, 'רק החודש של בנימין רוזן — החודשים של אהרן כבר בשורה הדחופה');
});

test('גמ"ח: פיגור — דחוף; הלוואה ששולמה — לא מופיעה; חפץ באיחור; בקשה ממתינה', () => {
  const b = D.morningBrief(sample(), TODAY);
  const late = b.items.find(i => i.title.includes('יוסף פרידמן'));
  assert.equal(late.level, 'urgent');
  assert.match(late.detail, /3 תשלומים/);
  assert.ok(!titles(b).some(t => t.includes('דוד שפירא')));
  assert.ok(titles(b).some(t => t.includes('עגלת תינוק')));
  assert.equal(b.items.find(i => i.title.includes('בקשת הלוואה')).count, 1);
});

test('יארצייט: רק בשבוע הקרוב, עם איש הקשר; יום לפני — "בקרוב"', { skip: !M.upcoming([], TODAY).available && 'אין לוח עברי ב-Intl' }, () => {
  const data = sample();
  const date = M.upcoming(data.npo.memorials, TODAY, 30).rows[0].date; // היארצייט הבא
  const shift = (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
  const find = (day) => D.morningBrief(data, day).items.find(i => i.title.startsWith('יארצייט'));
  assert.equal(find(shift(date, -(D.MEMORIAL_DAYS + 1))), undefined, 'מחוץ לשבוע — לא מופיע');
  const week = find(shift(date, -5));
  assert.equal(week.level, 'info');
  assert.match(week.title, /בעוד 5 ימים: אברהם ב"ר יצחק/);
  assert.match(week.detail, /יעקב 050-1234567/);
  const eve = find(shift(date, -1));
  assert.equal(eve.level, 'soon');
  assert.match(eve.title, /מחר/);
});

test('סבב חלוקה פתוח בלבד', () => {
  const t = titles(D.morningBrief(sample(), TODAY));
  assert.ok(t.includes('סבב חלוקה פתוח: חלוקת סוכות'));
  assert.ok(!t.some(x => x.includes('פסח')));
});

test('רישיון: תחום סגור לא מופיע בלוח', () => {
  const b = D.morningBrief(sample(), TODAY, { sources: ['npo'] });
  assert.ok(b.items.every(i => i.area === 'npo'));
  assert.deepEqual(D.morningBrief(sample(), TODAY, { sources: [] }).items, []);
});

test('נתונים ריקים ותאריך שגוי', () => {
  assert.equal(D.morningBrief({}, TODAY).total, 0);
  assert.throws(() => D.morningBrief({}, '1.10.2026'), /תאריך/);
});
