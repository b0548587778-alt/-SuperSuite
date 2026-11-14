// תפריט "כמו ברכב" במסך הבית הפשוט: מעט משימות גדולות בכל פעם, ומעבר ב"הקודם" / "הבא".
// הלוגיקה הטהורה (pageOf) נבדקת כאן; ההתנהגות במעטפת — ב-tests/r4-a11y-shell.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Simple = require('../shell/simple-mode');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('pageOf: שלוש משימות בעמוד, וכל המשימות מופיעות בדיוק פעם אחת', () => {
  assert.equal(Simple.PAGE_SIZE, 3);
  const all = Simple.tasksFor({ admin: true });
  const first = Simple.pageOf(all, 0);
  const seen = [];
  for (let p = 0; p < first.pages; p++) {
    const pg = Simple.pageOf(all, p);
    assert.ok(pg.items.length >= 1 && pg.items.length <= Simple.PAGE_SIZE);
    seen.push(...pg.items.map(t => t.id));
  }
  assert.deepEqual(seen, all.map(t => t.id), 'אף משימה לא אבדה ולא הוכפלה');
});

test('pageOf: מספר עמוד לא תקין ← העמוד הקרוב ביותר; רשימה ריקה ← עמוד אחד ריק', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(Simple.pageOf(list, -3).page, 0);
  assert.equal(Simple.pageOf(list, 99, 4).page, 2);
  assert.deepEqual(Simple.pageOf(list, 99, 4).items, [9]);
  assert.equal(Simple.pageOf(list, 'x').page, 0);
  assert.equal(Simple.pageOf(list, 1.5).page, 0);
  assert.deepEqual(Simple.pageOf([], 0), { items: [], page: 0, pages: 1 });
  assert.deepEqual(Simple.pageOf(null, 2), { items: [], page: 0, pages: 1 });
  assert.equal(Simple.pageOf(list, 0, 0).items.length, Simple.PAGE_SIZE, 'גודל עמוד לא תקין ← ברירת המחדל');
});

test('מסך הבית: כפתורי המעבר עם מילים בעברית, מוסתרים כשיש עמוד אחד, והכפתור "בצע" לא נחתך', () => {
  const html = read('shell/shell.html');
  assert.match(html, /id="taskPrev" hidden>.*?<\/span>הקודם<\/button>/);
  assert.match(html, /id="taskNext" hidden>.*?<\/span>הבא<\/button>/);
  assert.match(html, /\.task-nav\[hidden\]\{display:none\}/, 'display:flex גובר על hidden בלי הכלל הזה');
  assert.match(html, /id="taskPageInfo"[^>]*aria-live="polite"/);
  // רוחב הכפתור "בצע" לפי התוכן: flex-basis קבוע של 44px חתך את המילה
  assert.match(html, /\.ask \.ask-go\{[^}]*flex:0 0 auto/);
});

test('העיגולים לומדים: מה שנבחר הכי הרבה עולה ראשון, שוויון שומר על הסדר, וקלט פגום מהאחסון לא שובר', () => {
  const all = Simple.tasksFor({ admin: true });
  assert.deepEqual(Simple.orderByUse(all, {}).map(t => t.id), all.map(t => t.id), 'בלי היסטוריה — הסדר הקבוע');
  const ordered = Simple.orderByUse(all, { calc: 5, loan: 2 }).map(t => t.id);
  assert.deepEqual(ordered.slice(0, 3), ['calc', 'loan', 'invoice']);
  assert.equal(ordered.length, all.length, 'אף משימה לא נעלמה');
  for (const bad of [null, 'x', [], { calc: -3, loan: 1.5, evil: 9, invoice: '7', __proto__: { calc: 9 } }]) {
    assert.deepEqual(Simple.orderByUse(all, bad).map(t => t.id), all.map(t => t.id));
  }
  assert.deepEqual(Simple.bumpUse({ calc: 2 }, 'calc'), { calc: 3 });
  assert.deepEqual(Simple.bumpUse({}, 'no-such-task'), {}, 'מזהה לא מוכר לא נשמר');
  assert.equal(Simple.bumpUse({ calc: 1e9 }, 'calc').calc, 100000, 'תקרה');
});

test('העיגולים לומדים במעטפת: הסדר נקבע בעלייה בלבד, והספירה נשמרת כהעדפת תצוגה', () => {
  const js = read('shell/shell.js');
  assert.match(js, /const taskUseAtStart = readTaskUse\(\);/);
  assert.match(js, /orderByUse\(SIMPLE\.tasksFor\([^\n]*\), taskUseAtStart\)/, 'לא לפי הספירה החיה — עיגול לא זז באמצע העבודה');
  assert.match(js, /countTaskUse\(t\.id\);/);
});

test('צבע קבוע לכל משימה: כל משימה עם tone מוכר, ולכל tone יש כלל במסך הבית', () => {
  const html = read('shell/shell.html');
  for (const t of Simple.TASKS) assert.ok(Simple.TONES.includes(t.tone), t.id);
  for (const tone of Simple.TONES.filter(x => x !== 'primary')) assert.ok(html.includes('.task.tone-' + tone + '{--tone:var(--ss-' + tone + '-ink)'), tone);
});
