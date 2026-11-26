// מצב פשוט במסכים עצמם (26.11.2026): חלקים משניים (קמפיינים, מס"ב, דוח לרשם, הצעת מחיר...) מוסתרים,
// "הצגת כל חלקי המסך" בתחתית מגלה אותם ונזכר לכל מסך, והכפתור הראשי אומר מה הוא עושה ("לרשום תרומה").
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/econ-a11y-harness');
const EconUI = require('./helpers/econ-ui');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-screens-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* EBUSY ב-Windows */ } });

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
// בוט אחד לכל מצב — השרת האמיתי עם נתוני הדוגמה (עמותה, גמ"ח, עסק)
let simpleBoot = null;
async function simple() {
  if (!simpleBoot) {
    fs.mkdirSync(path.join(DIR, 'a'), { recursive: true });
    simpleBoot = await H.boot({ real: path.join(DIR, 'a'), simple: true });
    simpleBoot.context.localStorage = memoryStorage();
  }
  return simpleBoot;
}
const visibleText = (el) => el.textContent.replace(/\s+/g, ' ');
const hiddenParts = (view) => view.querySelectorAll('.ss-advanced');
const headings = (view, sel) => view.querySelectorAll(sel).map(h => visibleText(h).trim());
function inHidden(el) {
  for (let e = el; e && e.classList; e = e.parentNode) if (e.classList.contains('ss-advanced')) return true;
  return false;
}

test('עמותה במצב פשוט: רשימת התרומות גלויה; קמפיינים, הוראות קבע, מס"ב, קרנות ודוח לרשם — מוסתרים כשהם ריקים', async () => {
  const s = await simple();
  await s.go('npo');
  await s.settle(30);
  const view = s.view();
  const h3 = view.querySelectorAll('h3');
  const byTitle = (re) => h3.find(h => re.test(visibleText(h)));
  assert.ok(byTitle(/תרומות וקבלות/) && !inHidden(byTitle(/תרומות וקבלות/)), 'רשימת התרומות גלויה');
  assert.ok(byTitle(/תורמים/) && !inHidden(byTitle(/^\s*תורמים/)), 'רשימת התורמים גלויה');
  for (const re of [/קמפיינים/, /הוראות קבע/, /מס"ב/, /הכנסות לפי קרן/, /דוח שנתי לרשם/]) {
    const h = byTitle(re);
    assert.ok(h, 'החלק קיים ב-DOM (לא נמחק): ' + re);
    assert.ok(inHidden(h), 'מוסתר במצב פשוט: ' + re);
  }
  // שלושה מדדים גלויים (מתוך שבעה)
  const kpis = view.querySelectorAll('.kpi');
  assert.equal(kpis.filter(k => !inHidden(k)).length, 3, headings(view, '.kpi small').join(' | '));
  // עמודות "קרן" ו"סעיף 46" בטבלה
  const th = view.querySelectorAll('th').filter(t => /^(קרן|סעיף 46)$/.test(visibleText(t).trim()));
  assert.equal(th.length, 2);
  assert.ok(th.every(inHidden));
});

test('"הצגת כל חלקי המסך": מגלה הכול, מסתיר שוב, ונזכר לאותו מסך בלבד', async () => {
  const s = await simple();
  await s.go('npo');
  await s.settle(30);
  let view = s.view();
  const btn = view.querySelector('.ss-show-all');
  assert.ok(btn, 'יש כפתור בתחתית המסך');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.textContent, 'הצגת כל חלקי המסך');
  const before = hiddenParts(view).length;
  assert.ok(before >= 5);
  btn.click();
  assert.equal(hiddenParts(view).length, 0, 'הכול גלוי');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.textContent, 'הסתרת החלקים הנוספים');
  // נזכר: מעבר למסך אחר וחזרה — עדיין גלוי; במסך אחר — מוסתר
  await s.go('gemach');
  await s.settle(30);
  assert.ok(hiddenParts(s.view()).length > 0, 'בגמ"ח — עדיין מוסתר');
  await s.go('npo');
  await s.settle(30);
  view = s.view();
  assert.equal(hiddenParts(view).length, 0, 'בעמותה — נזכר');
  assert.equal(view.querySelector('.ss-show-all').getAttribute('aria-expanded'), 'true');
  // הסתרה חוזרת — אותו מספר חלקים כמו בהתחלה
  view.querySelector('.ss-show-all').click();
  assert.equal(hiddenParts(view).length, before);
  assert.deepEqual(JSON.parse(s.context.localStorage.getItem('econ.simpleShowAll')), []);
  // קלט לא מהימן באחסון — לא מפיל, ומסך לא מוכר נזרק
  s.context.localStorage.setItem('econ.simpleShowAll', '{"x":1}');
  assert.deepEqual(s.run('showAllViews()'), []);
  s.context.localStorage.setItem('econ.simpleShowAll', '["npo","no-such-view",5]');
  assert.deepEqual([...s.run('showAllViews()')], ['npo']);
  s.context.localStorage.setItem('econ.simpleShowAll', '[]');
});

test('גמ"ח, חשבוניות ולוח הבקרה במצב פשוט: העיקר גלוי, המשני מוסתר', async () => {
  const s = await simple();
  await s.go('gemach');
  await s.settle(30);
  let view = s.view();
  const h3 = (re) => view.querySelectorAll('h3').find(h => re.test(visibleText(h)));
  assert.ok(!inHidden(h3(/^\s*הלוואות \(/)), 'רשימת ההלוואות גלויה');
  assert.ok(!inHidden(h3(/^\s*הפקדות/)), 'ההפקדות גלויות');
  for (const re of [/בקשות הלוואה/, /גמ"ח חפצים/, /מס"ב/]) assert.ok(inHidden(h3(re)), re);
  assert.equal(view.querySelectorAll('.kpi').filter(k => !inHidden(k)).length, 3);

  await s.go('acct-invoices');
  await s.settle(30);
  view = s.view();
  const quote = view.querySelector('[data-doc-new="quote"]');
  assert.ok(quote && inHidden(quote), 'הצעת מחיר / הזמנה / תעודת משלוח — מאחורי "הצגת כל חלקי המסך"');
  assert.ok(inHidden(view.querySelector('#acctRecurringNew')), 'חשבוניות חוזרות בלי תבניות — מוסתר');
  assert.ok(!inHidden(view.querySelector('#acctDocSearch')), 'החיפוש גלוי');

  await s.go('dashboard');
  await s.settle(30);
  view = s.view();
  const modules = view.querySelector('.modules');
  if (modules) assert.ok(inHidden(modules), '"מודולים נוספים בחבילה" — מוסתר (הם במסך הבית)');
  const quick = view.querySelectorAll('h3').find(h => /מסכים מהירים/.test(visibleText(h)));
  if (quick) assert.ok(inHidden(quick));
});

test('הכפתור הראשי במצב פשוט אומר מה הוא עושה — וגם ההסבר בראש המסך והכפתור במצב ריק', async () => {
  const s = await simple();
  const add = () => visibleText(s.doc.getElementById('addBtn')).trim();
  await s.go('npo');
  assert.equal(add(), '＋ לרשום תרומה');
  assert.match(s.doc.getElementById('pageHelp').textContent, /"＋ לרשום תרומה"/);
  assert.doesNotMatch(s.doc.getElementById('pageHelp').textContent, /הוספת רשומה/);
  await s.go('gemach');
  assert.equal(add(), '＋ לרשום הלוואה חדשה');
  await s.go('acct-invoices');
  assert.equal(add(), '＋ להוציא חשבונית');
  // מסך בלי משימה מוגדרת — השם הרגיל
  await s.go('tasks');
  assert.equal(add(), '＋ הוספת רשומה');
  // מצב ריק: הכפתור באותו שם
  s.run(`state.currentView = 'acct-invoices'`);
  const html = s.run(`renderEmpty('אין חשבוניות עדיין — לחץ "＋ הוספת רשומה" כדי להתחיל')`);
  assert.match(html, /data-empty-add>＋ להוציא חשבונית</);
});

test('תצוגה מלאה (לא פשוט): אין כפתור "הצגת כל חלקי המסך", והכפתור הראשי — "הוספת רשומה"', async () => {
  fs.mkdirSync(path.join(DIR, 'b'), { recursive: true });
  const s = await H.boot({ real: path.join(DIR, 'b'), simple: false });
  for (const v of ['npo', 'gemach', 'acct-invoices', 'dashboard']) {
    await s.go(v);
    await s.settle(30);
    assert.equal(s.view().querySelector('.ss-show-all'), null, v);
  }
  await s.go('npo');
  assert.equal(visibleText(s.doc.getElementById('addBtn')).trim(), '＋ הוספת רשומה');
  assert.match(s.doc.getElementById('pageHelp').textContent, /הוספת רשומה/);
});

test('simpleHide — מחלקה אחת, ותנאי false משאיר גלוי', () => {
  const src = EconUI.source();
  assert.match(src, /function simpleHide\(cond = true\)/);
  // כל מסך שמשתמש בו נטען אחרי core.js — שם יחיד בטווח הגלובלי
  assert.equal((src.match(/function simpleHide\(/g) || []).length, 1);
});
