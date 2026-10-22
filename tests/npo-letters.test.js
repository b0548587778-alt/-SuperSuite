// מכתבים ותבניות לעמותה (שלב 3) — מכתב תודה, נרטיב לדוח שנתי, טיוטת בקשת מענק.
// הבדיקות רצות על פלט אמיתי של המנוע (core/npo.js) ולא על נתונים מומצאים.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const N = require(path.join(ROOT, 'modules/econ/core/npo'));
const L = require(path.join(ROOT, 'modules/econ/core/npoLetters'));

// ---------- נתוני דוגמה — בצורה שהמנוע צורך ומחזיר (תרומות בשקלים, סעיף 46 ב-receipt) ----------
const SETTINGS = {
  orgName: 'עמותת חסד ואמת', regNumber: '580123456', address: 'רחוב החזון 12, בני ברק',
  phone: '03-1234567', sec46Number: '12345', sec46ValidUntil: '2027-06-30',
  funds: [{ id: 'yeshiva', name: 'קרן הישיבה', restricted: true }]
};
const DONATIONS = [
  { id: 'd1', date: '2026-01-15', donorName: 'משפחת כהן', amount: 1000, method: 'cash', fundId: 'yeshiva', receipt: { number: 101, sec46: true, fundName: 'קרן הישיבה' } },
  { id: 'd2', date: '2026-03-02', donorName: 'משפחת כהן', amount: 500, method: 'transfer', fundId: 'yeshiva', receipt: { number: 102, sec46: true, fundName: 'קרן הישיבה' } },
  { id: 'd3', date: '2026-05-20', donorName: 'משפחת לוי', amount: 250, method: 'cash', fundId: 'general', receipt: { number: 103, sec46: false } },
  // שנה אחרת — לא אמורה להיכלל
  { id: 'd4', date: '2025-12-31', donorName: 'משפחת כהן', amount: 9999, method: 'cash', fundId: 'general', receipt: { number: 90, sec46: true } },
];
const GRANTS = [
  { id: 'g1', source: 'קרן התמיכות העירונית', approved: 2000, received: 2000, year: 2026 },
  { id: 'g2', source: 'משרד הרווחה', approved: 1500, received: 0, year: 2026 },
];

// המזהה של התורם — כמו שהממשק מוסר אותו: מתוך donorSummary, לא מנוחש
const keyOf = (name) => N.donorSummary(DONATIONS, 2026).find(d => d.name === name).key;
const statement = () => N.donorAnnualStatement(DONATIONS, SETTINGS, keyOf('משפחת כהן'), 2026);
const report = () => N.annualReport(DONATIONS, GRANTS, SETTINGS, 2026);

test('טוהר: npoLetters.js בלי require, בלי רשת ובלי כתיבה לדיסק', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/econ/core/npoLetters.js'), 'utf8');
  assert.ok(!/\brequire\s*\(/.test(src), 'אין require');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|https?:\/\//.test(src), 'אין רשת');
  assert.ok(!/\bfs\.|process\./.test(src), 'אין גישה לסביבה');
  // הקובץ נטען מחדש בלי אם אחרת — מה שהוא יודע, זה רק מה שהוא מחשיב בעצמו
  assert.deepEqual(Object.keys(L).sort(), ['annualNarrative', 'grantDraft', 'pct', 'renderLetterHtml', 'thankYouLetter']);
});

test('מכתב תודה — הסכומים של אותה שנה בלבד, ושקלים בפורמט של המערכת', () => {
  const st = statement();
  const letter = L.thankYouLetter(st);
  assert.equal(letter.kind, 'thank-you');
  assert.equal(letter.year, 2026);
  assert.equal(letter.amounts.receipts, 2, 'שתי תרומות בשנת 2026');
  assert.equal(letter.amounts.total, 1500, 'הסכום מהמנוע — בשקלים');
  assert.equal(letter.amounts.sec46, 1500);
  assert.ok(letter.text.includes('₪1,500.00'), 'הסכום מוצג בשקלים');
  assert.ok(!letter.text.includes('₪9,999.00'), 'תרומת שנה אחרת אינה נספרת');
  assert.ok(letter.text.includes('משפחת כהן'), 'התורם נקרא בשמו');
  assert.ok(letter.text.includes('עמותת חסד ואמת'));
  assert.ok(letter.text.includes('סעיף 46'), 'הזכות לזיכוי ממס מוזכרת');
  assert.match(letter.title, /משפחת כהן/);
});

test('מכתב תודה — התוספת של המשתמש מופיעה, והודעה ארוכה נחתכת בלי לשבור את המכתב', () => {
  const a = L.thankYouLetter(statement(), { message: 'ויישר כוח על הסיוע בקמפיין.' });
  assert.ok(a.text.includes('ויישר כוח על הסיוע בקמפיין.'));
  const b = L.thankYouLetter(statement(), { message: 'א'.repeat(5000) });
  assert.ok(b.text.length < 4000, 'קלט ארוך נחתך');
  assert.ok(b.text.includes('בכבוד רב ובהערכה,'), 'החתימה נשמרה');
});

test('נרטיב לדוח שנתי — הפילוח, הקרנות והתמיכות מתוך annualReport', () => {
  const r = report();
  const doc = L.annualNarrative(r);
  assert.equal(doc.kind, 'annual-narrative');
  assert.equal(doc.year, 2026);
  const t = doc.text;
  assert.ok(t.includes('₪1,750.00'), 'סך התרומות בשנת 2026 (1750 ש"ח)');
  assert.ok(t.includes('סעיף 46'));
  assert.ok(t.includes('קרן הישיבה'), 'פירוט הקרנות');
  assert.ok(t.includes('קרן התמיכות העירונית') || t.includes('משרד הרווחה'), 'מקורות התמיכות');
  assert.ok(t.includes('3 תרומות מ-2 תורמים'));
  assert.ok(!t.includes('₪9,999.00'));
  assert.match(t, /אינו מחליף את הדוח הכספי המבוקר/, 'הסתייגות מפורשת');
});

test('נרטיב — דוח בלי תמיכות ובלי נתונים אינו ממציא מספרים', () => {
  const empty = N.annualReport([], [], SETTINGS, 2026);
  const doc = L.annualNarrative(empty);
  assert.ok(!/1,000|undefined|NaN/.test(doc.text), 'בלי מספרים מומצאים');
  assert.ok(doc.text.includes('0 תרומות'));
});

test('טיוטת בקשת מענק — בלי שם קרן נזרקת שגיאה בעברית', () => {
  assert.throws(() => L.grantDraft(report(), {}), /שם הקרן/);
  assert.throws(() => L.grantDraft(report(), { fundName: '   ' }), /שם הקרן/);
});

test('טיוטת בקשת מענק — הסכום מוקלד בשקלים ונשמר באגורות; הייעודים ממוספרים', () => {
  const doc = L.grantDraft(report(), {
    fundName: 'קרן הצדקה הכללית', program: 'תמיכה במשפחות נזקקות', amount: 1500.5,
    purpose: 'חלוקת סלי מזון\nסיוע בשכר דירה', period: 'שנת תשפ"ז', contactName: 'הרב אברהם כהן', contactPhone: '052-1234567'
  });
  assert.equal(doc.amountAg, 150050, 'המרה מעגלית לאגורות');
  assert.equal(doc.fundName, 'קרן הצדקה הכללית');
  assert.ok(doc.text.includes('₪1,500.50'));
  assert.ok(doc.text.includes('1. חלוקת סלי מזון'));
  assert.ok(doc.text.includes('2. סיוע בשכר דירה'));
  assert.ok(doc.text.includes('הרב אברהם כהן'));
  assert.ok(doc.text.includes('סעיף 46'), 'מציעים לצרף אישורים');
});

test('טיוטת מענק — קלט לא־מהימן אינו משתלט על המכתב (שורות בקרה, אורך)', () => {
  const doc = L.grantDraft(report(), { fundName: 'קרן\nעסקים\r\nמזויפים', purpose: Array.from({ length: 40 }, (_, i) => 'סעיף ' + i).join('\n') });
  assert.ok(!/קרן\s*\n\s*עסקים/.test(doc.title), 'שורות בקרה הוחלפו ברווח');
  const numbered = doc.text.split('\n').filter(l => /^\d+\. /.test(l));
  assert.equal(numbered.length, 10, 'לכל היותר 10 ייעודים');
  assert.ok(numbered[numbered.length - 1].startsWith('10. '));
});

test('renderLetterHtml — HTML מלא, RTL, וכל הטקסט מוברח', () => {
  const html = L.renderLetterHtml(L.thankYouLetter(statement()), SETTINGS);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.ok(html.includes('עמותת חסד ואמת'), 'כותרת המעטפת');
  assert.ok(html.includes('₪1,500.00'));
  assert.ok(html.includes('pre-wrap'), 'שמירת השורות והחלוקה לפסקאות');
  assert.ok(html.includes('אינו מחליף מסמך חתום'));

  // שמות בבעלות המשתמש — מוברחים
  const evil = L.renderLetterHtml({
    title: '<script>x</script>', text: '</div><img src=x onerror="alert(1)">'
  }, { name: '<b>עמותה</b>', address: '"><i>', phone: "'" });
  assert.ok(!evil.includes('<script>') && !evil.includes('</div><img'), 'אין HTML גולמי');
  assert.ok(!evil.includes('<b>') && !evil.includes('<i>'), 'הכותרת מוברחת');
  assert.ok(evil.includes('&lt;script&gt;'));
  assert.ok(evil.includes('&#39;'), 'גרש בודד מוברח');
});

test('pct — חלוקה בטוחה, בלי NaN ובלי אפס מיותר', () => {
  assert.equal(L.pct(1, 4), '25%');
  assert.equal(L.pct(1, 3), '33.3%');
  assert.equal(L.pct(1, 0), '—');
  assert.equal(L.pct(5, 100), '5%');
});
