// "מה תרצה לעשות?" (סבב 5): הבנת בקשה בעברית פשוטה — shell/intents.js — ורשימת המשימות והאימות — shell/tasks.js.
// טבלת ביטויים: משימות עם סכום / שם / תאריך, שאלות, דו-משמעות ← "התכוונת ל...?", ושטויות ← הצעות. בלי רשת ובלי מודל
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../shell/intents');
const T = require('../shell/tasks');
const S = require('../shell/simple-mode');
const CAT = require('../shell/catalog');

const TODAY = '2026-11-05'; // שעון קבוע — לא היום האמיתי
const parse = (q) => I.parse(q, { today: TODAY });

// [ביטוי, משימה, prefill מצופה (חלקי — רק השדות שנבדקים)]
const TASK_TABLE = [
  ['תרשום תרומה ממשה כהן 500 שקל', 'donation', { name: 'משה כהן', amount: '500' }],
  ['רשום תרומה של 1,500 ש"ח ממנחם פרידמן', 'donation', { name: 'מנחם פרידמן', amount: '1500' }],
  ['משה כהן תרם 180', 'donation', { name: 'משה כהן', amount: '180' }],
  ['תרומה 12.5 שקל מיעקב לוי', 'donation', { name: 'יעקב לוי', amount: '12.50' }],
  ['תרומה ממנחם 50 ב-3.11', 'donation', { name: 'מנחם', amount: '50', date: '2026-11-03' }],
  ['תרומה חמש מאות שקל מיעקב', 'donation', { name: 'יעקב', amount: '500' }],
  ['רשום תרומה אלף שקל ממשפחת וייס', 'donation', { name: 'משפחת וייס', amount: '1000' }],
  ['תרומה ממשה 100 שקל על בניין בית הכנסת', 'donation', { name: 'משה', amount: '100', note: 'בניין בית הכנסת' }],
  ['תוסיף נדבה מרבקה 36 ש״ח אתמול', 'donation', { name: 'רבקה', amount: '36', date: '2026-11-04' }],
  ['תרומה מ-מאיר 2,500.50 ₪', 'donation', { name: 'מאיר', amount: '2500.50' }],
  ['תרומה ממרדכי אלפיים שקל', 'donation', { name: 'מרדכי', amount: '2000' }],
  ['תרומה ₪360 מלאה שפירא היום', 'donation', { amount: '360', date: '2026-11-05' }],
  ['לרשום תרומה מאברהם לוי 5 אלף', 'donation', { name: 'אברהם לוי', amount: '5000' }],
  ['תרומה מר כהן 200 שקל בתאריך 1.10.2026', 'donation', { amount: '200', date: '2026-10-01' }],
  ['קבלה לרבקה לוי', 'receipt', { name: 'רבקה לוי' }],
  ['תן קבלה ללוי על 360', 'receipt', { name: 'לוי', amount: '360' }],
  ['תוציא קבלה לשרה ברגר 250 ש"ח', 'receipt', { name: 'שרה ברגר', amount: '250' }],
  ['הוצאה 200 על חשמל', 'expense', { amount: '200', note: 'חשמל' }],
  ['הוצאה 99.90 לחברת החשמל אתמול', 'expense', { amount: '99.90', name: 'חברת החשמל', date: '2026-11-04' }],
  ['רשום הוצאה 1,200 ש"ח עבור שכירות', 'expense', { amount: '1200', note: 'שכירות' }],
  ['שילמתי 45 שקל על דואר', 'expense', { amount: '45', note: 'דואר' }],
  ['הוצאות 300 חשמל', 'expense', { amount: '300', note: 'חשמל' }],
  ['חשבונית לכהן על שיפוץ 3,000 ש"ח', 'invoice', { name: 'כהן', amount: '3000', note: 'שיפוץ' }],
  ['תוציא חשבונית ליוסף פרץ 750 שקל על הובלה', 'invoice', { name: 'יוסף פרץ', amount: '750', note: 'הובלה' }],
  ['להפיק חשבונית למשה כהן', 'invoice', { name: 'משה כהן' }],
  ['תשלום הלוואה מיוסי לוי 300', 'loanPayment', { name: 'יוסי לוי', amount: '300' }],
  ['החזר מדוד 250', 'loanPayment', { name: 'דוד', amount: '250' }],
  ['תרשום החזר הלוואה של חיים ביטון 400 שקל', 'loanPayment', { name: 'חיים ביטון', amount: '400' }],
  ['שמואל שילם 150 על ההלוואה', 'loanPayment', { amount: '150' }],
  ['הלוואה חדשה לשרה ברגר 5000 ב-10 תשלומים', 'gemachLoan', { name: 'שרה ברגר', amount: '5000', installments: 10 }],
  ['תן הלוואה ליצחק 3,000 ש"ח', 'gemachLoan', { name: 'יצחק', amount: '3000' }],
  ['להלוות למנחם 1000', 'gemachLoan', { name: 'מנחם', amount: '1000' }],
  ['תוסיף איש קשר דוד לוי 052-1234567', 'contact', { name: 'דוד לוי', phone: '0521234567' }],
  ['איש קשר חדש שלמה ברגר 03-5551234', 'contact', { name: 'שלמה ברגר', phone: '035551234' }],
  ['תגבה את הנתונים', 'backup', {}],
  ['גיבוי', 'backup', {}],
];

const QUESTIONS = ['כמה נכנס החודש?', 'מי חייב לי כסף?', 'כמה תרמו השנה?', 'מתי היארצייט של אברהם כהן', 'מי לא שילם',
  'תרומות השנה', 'הכנסות החודש שעבר', 'איך מוציאים חשבונית?', 'מה דוח המע"מ של החודש?', 'תראה לי את התרומות של החודש'];

test('טבלת משימות: משימה נכונה, שם בלי מילת היחס, סכום כמחרוזת שקלים ותאריך מקומי', () => {
  for (const [q, task, want] of TASK_TABLE) {
    const r = parse(q);
    assert.equal(r.kind, 'task', `${q} → ${JSON.stringify(r)}`);
    assert.equal(r.task, task, q);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(r.prefill[k], v, `${q}: ${k}`);
    // כל מה שהמפרש מחזיר עובר את אותו אימות של main.js
    assert.ok(T.validateTask(r.task, r.prefill), `${q}: prefill תקין`);
  }
});

test('טבלת שאלות: נענות בעוזר (לא נפתח טופס)', () => {
  for (const q of QUESTIONS) assert.equal(parse(q).kind, 'question', q);
  assert.ok(TASK_TABLE.length + QUESTIONS.length >= 40);
});

test('סכומים: פסיקים, נקודה עשרונית, ₪, "אלף", ובמילים — באגורות שלמות', () => {
  const amt = (q) => parse(q).prefill.amount;
  assert.equal(amt('תרומה ממשה 1,500'), '1500');
  assert.equal(amt('תרומה ממשה 1,234,567 שקל'), '1234567');
  assert.equal(amt('תרומה ממשה 12.5'), '12.50');
  assert.equal(amt('תרומה ממשה 12,5 ש"ח'), '12.50', 'פסיק עשרוני');
  assert.equal(amt('תרומה ממשה 0.10 ש"ח'), '0.10');
  assert.equal(amt('תרומה ממשה אלף וחמש מאות שקל'), '1500');
  assert.equal(amt('תרומה ממשה שלושת אלפים שקל'), '3000');
  assert.equal(T.amountToAg('12.50'), 1250);
  assert.equal(T.amountToAg('0.1'), 10);
  assert.equal(T.amountToAg('19.99'), 1999, 'בלי שגיאת נקודה צפה');
  assert.equal(T.amountToAg('1e3'), null);
  assert.equal(T.amountToAg('-5'), null);
  assert.equal(T.amountToAg('0'), null);
  assert.equal(T.formatAg(150050), '₪1,500.50');
  // שני סכומים בלי מטבע — לא מנחשים
  const two = parse('תרומה ממשה 100 200');
  assert.equal(two.prefill.amount, undefined);
  assert.deepEqual(two.unclear, ['amount']);
  // אחד עם מטבע — הוא הסכום
  assert.equal(parse('תרומה 18 ממשה 100 שקל').prefill.amount, '100');
  // "שני" אינו סכום
  assert.equal(parse('תרומה משני כהן').prefill.amount, undefined);
});

test('שמות: מילת יחס נחתכת, אבל לא אות מהשם עצמו', () => {
  const name = (q) => parse(q).prefill.name;
  assert.equal(name('תרומה ממשה 10'), 'משה');
  assert.equal(name('תרומה מנחם 10'), 'מנחם', '"מנחם" — שם שמתחיל ב-מ');
  assert.equal(name('תרומה ממנחם 10'), 'מנחם');
  assert.equal(name('קבלה ללאה 10'), 'לאה');
  assert.equal(name('קבלה לאה 10'), 'לאה');
  assert.equal(name('קבלה ללוי 10'), 'לוי');
  assert.equal(name('תרומה מגולדשטיין 10'), 'גולדשטיין', 'שם לא מוכר — מילת היחס נחתכת');
  assert.equal(name('תרומה מאת יוסף 10'), 'יוסף');
  assert.equal(name('תרומה מ-משה 10'), 'משה');
  assert.ok(name('תרומה ממשה כהן לוי ביטון פרץ שפירא 10').split(' ').length <= 4, 'עד 4 מילים בשם');
});

test('תאריכים: היום / אתמול / שלשום / ב-d.m / d/m/yyyy; תאריך שאינו קיים — לא נלקח', () => {
  const date = (q) => parse(q).prefill.date;
  assert.equal(date('תרומה ממשה 10 היום'), '2026-11-05');
  assert.equal(date('תרומה ממשה 10 אתמול'), '2026-11-04');
  assert.equal(date('תרומה ממשה 10 שלשום'), '2026-11-03');
  assert.equal(date('תרומה ממשה 10 ב-1.1'), '2026-01-01');
  assert.equal(date('תרומה ממשה 10 ב 31.12.2025'), '2025-12-31');
  assert.equal(date('תרומה ממשה 10 שקל 7/10/2026'), '2026-10-07');
  assert.equal(date('תרומה ממשה 10 ב-31.2'), undefined, '31 בפברואר');
  assert.equal(I.parse('תרומה ממשה 10 אתמול', { today: '2026-03-01' }).prefill.date, '2026-02-28');
});

test('דו-משמעות ← "התכוונת ל...?" עם האפשרויות (והפרטים שזוהו נשמרים בהן)', () => {
  const loan = parse('הלוואה למשה 1000');
  assert.equal(loan.kind, 'choose');
  assert.deepEqual(loan.options.map(o => o.id).sort(), ['gemachLoan', 'loanPayment']);
  for (const o of loan.options) assert.deepEqual(o.prefill, { name: 'משה', amount: '1000' });
  const gv = parse('לגבות');
  assert.equal(gv.kind, 'choose');
  assert.deepEqual(gv.options.map(o => o.id || o.key).sort(), ['backup', 'econ:collect']);
  // מילה אחת בלי פרטים — המשימה או המסך
  const inv = parse('חשבוניות');
  assert.equal(inv.kind, 'choose');
  assert.deepEqual(inv.options, [{ type: 'task', id: 'invoice', prefill: {} }, { type: 'screen', key: 'econ:acct-invoices' }]);
  assert.equal(parse('גבייה').kind, 'screen');
  assert.equal(parse('לגבות כסף מכהן').key, 'econ:collect');
});

test('שטויות וטקסט ריק ← unknown, ו-suggest מציע עד 3 משימות / מסכים (לעולם לא ריק)', () => {
  for (const q of ['asdfgh', 'בלה בלה', '12345', '!!!', '', '   ', 'שלום', 'מזג האוויר מחר']) {
    assert.equal(parse(q).kind, 'unknown', q);
  }
  const tasks = T.tasksFor({ admin: true });
  const items = CAT.ITEMS;
  const g = I.suggest('asdfgh', { tasks, items });
  assert.equal(g.guess, true);
  assert.equal(g.list.length, 3);
  const near = I.suggest('דוחות מעמ', { tasks, items });
  assert.equal(near.guess, false);
  assert.ok(near.list.length >= 1 && near.list.length <= 3);
  assert.ok(near.list.some(x => x.key === 'econ:acct-reports'), JSON.stringify(near.list));
  const tr = I.suggest('נדבה', { tasks, items });
  assert.equal(tr.list[0].id, 'donation');
});

test('לא נשמר כלום: המפרש והאימות טהורים — אין קריאה לשום ממשק, ותוצאת parse היא נתונים בלבד', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../shell/intents.js'), 'utf8')
    + require('fs').readFileSync(require('path').join(__dirname, '../shell/tasks.js'), 'utf8');
  assert.doesNotMatch(src, /shellAPI|systemAPI|ipcRenderer|fetch\(|XMLHttpRequest|localStorage|Date\.now|new Date\(\)/);
  const r = parse('תרשום תרומה ממשה כהן 500 שקל');
  assert.deepEqual(Object.keys(r).sort(), ['kind', 'missing', 'prefill', 'task', 'unclear']);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(r))), JSON.stringify(r), 'אין פונקציות בתוצאה');
});

test('tasks.js: אימות המטען — משימה ושדות מוכרים בלבד, כל ערך מהסוג שלו, כל חריגה דוחה את הכול', () => {
  assert.ok(T.validateTask('donation', { name: 'משה', amount: '500', date: '2026-11-05', note: 'בניין' }));
  assert.ok(T.validateTask('donation', {}));
  assert.ok(T.validateTask('donation'));
  assert.equal(T.validateTask('evil', {}), null);
  assert.equal(T.validateTask('toString', {}), null);
  assert.equal(T.validateTask('__proto__', {}), null);
  assert.equal(T.validateTask(['donation'], {}), null);
  assert.equal(T.validateTask('donation', { name: 'משה', evil: 1 }), null, 'שדה לא מוכר');
  assert.equal(T.validateTask('donation', { phone: '0521234567' }), null, 'שדה של משימה אחרת');
  assert.equal(T.validateTask('donation', { amount: 500 }), null, 'סכום חייב להיות מחרוזת');
  assert.equal(T.validateTask('donation', { amount: '500.123' }), null);
  assert.equal(T.validateTask('donation', { amount: '0' }), null);
  assert.equal(T.validateTask('donation', { date: '2026-02-31' }), null);
  assert.equal(T.validateTask('donation', { name: 'א'.repeat(81) }), null);
  assert.equal(T.validateTask('donation', { name: '' }), null);
  assert.equal(T.validateTask('donation', { name: 'משה\u0000' }), null);
  assert.equal(T.validateTask('donation', { name: 'משה\u202e' }), null, 'תו כיוון');
  assert.equal(T.validateTask('donation', { name: { toString: () => 'x' } }), null);
  assert.equal(T.validateTask('donation', JSON.parse('{"__proto__":{"x":1}}')), null);
  assert.equal(T.validateTask('donation', Object.create({ name: 'x' })), null, 'אובייקט לא רגיל');
  assert.equal(T.validateTask('donation', []), null);
  assert.equal(T.validateTask('donation', 'name=x'), null);
  assert.equal(T.validateTask('gemachLoan', { installments: 0 }), null);
  assert.equal(T.validateTask('gemachLoan', { installments: 1.5 }), null);
  assert.ok(T.validateTask('gemachLoan', { installments: 12 }));
  assert.equal(T.validateTask('contact', { phone: 'abc' }), null);
  assert.deepEqual(T.validateTask('donation', { name: '  משה   כהן ' }).prefill, { name: 'משה כהן' });
});

test('tasks.js: החוזה — מזהים, מסכים בקטלוג, הרשאה ושדות; גיבוי — פעולת מעטפת למנהל', () => {
  assert.deepEqual(T.TASKS.map(t => t.id), ['donation', 'receipt', 'expense', 'invoice', 'loanPayment', 'gemachLoan', 'contact', 'backup']);
  const keys = new Set(CAT.ITEMS.map(i => i.key));
  for (const t of T.TASKS) {
    for (const f of t.fields) assert.ok(T.FIELDS[f], `${t.id}.${f}`);
    if (t.action) { assert.equal(t.action, 'backup'); assert.equal(t.admin, true); continue; }
    assert.ok(keys.has(t.key), t.key);
    assert.equal(t.key, 'econ:' + t.view);
    assert.equal(t.perm, 'data.edit');
    assert.ok(t.domain, t.id);
  }
  // משימות מצב פשוט שמפנות לחוזה — מזהים קיימים
  for (const s of S.TASKS.filter(x => x.task)) assert.ok(T.getTask(s.task), s.task);
  // tasksFor: רישיון, מנהל והרשאה מהתהליך הראשי
  assert.ok(!T.tasksFor({ admin: false }).some(t => t.id === 'backup'));
  assert.deepEqual(T.tasksFor({ open: (k) => k === 'econ:npo' }).map(t => t.id), ['donation']);
  assert.deepEqual(T.tasksFor({ admin: true, allowed: ['invoice'] }).map(t => t.id), ['invoice']);
  // תיאור לאישור — סכום ותאריך בעברית
  assert.deepEqual(T.describe('donation', { name: 'משה', amount: '1500.5', date: '2026-11-05' }).map(r => r.value), ['משה', '₪1,500.50', '5.11.2026']);
});
