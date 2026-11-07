// חשבון לילדים שמתרגלים לבד (תוכנית "כל אחד מסתדר", WP6 / WP3 / WP8 / WP11): פעולות הורים מאחורי תרגיל של מבוגרים
// וביטול אחרי מחיקה, אתגר בלי שעון, "הבנתי" אחרי טעות, הקראה בקול עברי מקומי בלבד, קישור ישיר לפעולה והודעות.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp, solveAdult, learnersStore, M } = require('./helpers/math-ui.js');

const MATH = path.join(__dirname, '..', 'modules', 'math');
const two = () => {
  const s = learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }, { id: 'b2', name: 'דוד', grade: 4 }]);
  s['math:progress:a1'] = JSON.stringify({ stars: 9, topics: { add: { level: 3, correct: 8, total: 10 } } });
  return s;
};
const learners = app => M.sanitizeLearners(M.safeParse(app.store['math:learners']));

test('מחיקת ילד — רק אחרי תרגיל של מבוגרים; תשובה שגויה או ביטול לא מוחקים', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: ['5', null] } });
  app.click('del-learner', { id: 'a1' });
  await app.settle();
  assert.match(app.prompts[0], /רק להורים|זו פעולה להורים/);
  assert.match(app.prompts[0], /\d+ × \d+/);
  assert.equal(learners(app).list.length, 2, 'תשובה שגויה — לא נמחק');
  assert.match(app.alerts[0], /לא נכונה/);
  app.click('del-learner', { id: 'a1' });
  await app.settle();
  assert.equal(learners(app).list.length, 2, 'ביטול — לא נמחק');
  assert.ok(app.store['math:progress:a1']);
});

test('מחיקת ילד — אחרי התרגיל נמחק, ו"ביטול" בהודעה מחזיר אותו עם ההתקדמות שלו', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: [solveAdult] } });
  const progressBefore = app.store['math:progress:a1'];
  app.click('del-learner', { id: 'a1' });
  await app.settle();
  assert.deepEqual(learners(app).list.map(l => l.id), ['b2']);
  assert.equal(app.store['math:progress:a1'], undefined);
  assert.match(app.toastText(), /נמחק: יוסי/);
  assert.match(app.el('toast').innerHTML, /data-act="undo"/);
  app.click('undo');
  await app.settle();
  assert.deepEqual(learners(app).list.map(l => l.id), ['a1', 'b2'], 'חוזר למקומו');
  assert.equal(app.store['math:progress:a1'], progressBefore, 'ההתקדמות חזרה');
  assert.match(app.toastText(), /הוחזר: יוסי/);
});

test('אחרי 10 שניות אין ביטול: ההודעה נעלמת והכפתור לא מחזיר דבר', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: [solveAdult] } });
  app.click('del-learner', { id: 'a1' });
  await app.settle();
  app.advance(10500);
  app.click('undo');
  await app.settle();
  assert.deepEqual(learners(app).list.map(l => l.id), ['b2']);
});

test('שינוי כיתה — רק אחרי תרגיל המבוגרים; בלי התרגיל רק השם משתנה', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: ['יוסף', null], choose: [5] } });
  app.click('edit-learner', { id: 'a1' });
  await app.settle();
  const l = learners(app).list.find(x => x.id === 'a1');
  assert.equal(l.name, 'יוסף');
  assert.equal(l.grade, 3, 'הכיתה לא השתנתה');
  const app2 = makeApp({ storage: two(), dialog: { prompt: ['יוסי', solveAdult], choose: [5] } });
  app2.click('edit-learner', { id: 'a1' });
  await app2.settle();
  assert.equal(learners(app2).list.find(x => x.id === 'a1').grade, 5);
  // אותה כיתה — בלי תרגיל
  const app3 = makeApp({ storage: two(), dialog: { prompt: ['יוסי'], choose: [3] } });
  app3.click('edit-learner', { id: 'a1' });
  await app3.settle();
  assert.equal(app3.prompts.length, 1);
});

test('אתגר: דקה / 2 דקות / בלי שעון; בלי שעון — אין שעון, מסיימים ב"סיום", והשיא לא משתנה', () => {
  const s = learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]);
  s['math:progress:a1'] = JSON.stringify({ bestTimed: { multable: 7 } });
  const app = makeApp({ storage: s });
  app.click('tab', { tab: 'timed' });
  assert.match(app.view().innerHTML, /data-act="timed-len" data-len="0"/);
  assert.match(app.view().innerHTML, /data-act="timed-len" data-len="120"/);
  app.click('timed-len', { len: '0' });
  app.click('timed-topic', { topic: 'multable' });
  app.click('timed-start');
  assert.doesNotMatch(app.view().innerHTML, /id="tClock"/);
  app.advance(5 * 60000);
  assert.doesNotMatch(app.view().innerHTML, /הזמן נגמר/, 'אין סוף זמן');
  for (let i = 0; i < 12; i++) {
    app.el('ans').value = '1'; app.click('check'); app.advance(300);
    if (/data-act="timed-next"/.test(app.view().innerHTML + app.el('tNext').innerHTML)) app.click('timed-next');
  }
  app.click('timed-stop');
  assert.match(app.view().innerHTML, /כל הכבוד!/);
  const p = M.sanitizeProgress(M.safeParse(app.store['math:progress:a1']));
  assert.equal(p.bestTimed.multable, 7, 'בלי שעון — השיא לא מתעדכן');
  assert.equal(p.sessions.at(-1).mode, 'practice', 'נרשם כתרגול (רצף ימים)');
  assert.equal(M.sanitizeProgress(M.safeParse(app.store['math:progress:a1'])).days.length, 1);
});

test('אתגר של 2 דקות — נגמר אחרי 120 שניות, לא נספר לשיא', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  app.click('timed-len', { len: '120' });
  app.click('timed-start');
  app.advance(90000);
  assert.doesNotMatch(app.view().innerHTML, /הזמן נגמר/);
  app.el('ans').value = '99999'; app.click('check');
  app.advance(31000);
  assert.match(app.view().innerHTML, /הזמן נגמר/);
  const p = M.sanitizeProgress(M.safeParse(app.store['math:progress:a1']));
  assert.deepEqual(p.bestTimed, {});
});

test('טעות באתגר: התשובה הנכונה נשארת עד "הבנתי" — אין מעבר אוטומטי', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  app.click('timed-len', { len: '60' });
  app.click('timed-start');
  app.el('ans').value = '99999';
  app.click('check');
  const html = app.view().innerHTML;
  assert.match(app.el('tNext').innerHTML, /הבנתי/);
  app.advance(5000);
  assert.equal(app.view().innerHTML, html, 'השאלה לא הוחלפה לבד');
  app.click('timed-next');
  assert.notEqual(app.view().innerHTML, html);
  assert.equal(app.el('tNext').innerHTML, '');
});

test('קורא מסך: הזמן שנשאר מוכרז רק כל 10 שניות', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  app.click('timed-len', { len: '60' });
  app.click('timed-start');
  const said = [];
  for (let i = 0; i < 25; i++) { app.advance(1000); said.push(app.el('live').textContent); }
  const uniq = [...new Set(said.filter(x => /נשארו/.test(x)))];
  assert.deepEqual(uniq, ['נשארו 50 שניות', 'נשארו 40 שניות']);
});

test('הקראה: רק קול עברי מקומי; בלי קול כזה — הכפתור מוסתר (m-no-he-voice)', () => {
  const none = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]), voices: [{ lang: 'en-US', localService: true }, { lang: 'he-IL', localService: false }] });
  assert.equal(none.bodyClasses['m-no-he-voice'], true, 'קול ברשת אינו קול מקומי');
  const html = fs.readFileSync(path.join(MATH, 'index.html'), 'utf8');
  assert.match(html, /<body class="m-no-he-voice">/, 'מוסתר כבר בטעינה');
  assert.match(fs.readFileSync(path.join(MATH, 'style.css'), 'utf8'), /\.m-no-he-voice \.m-say \{ display: none; \}/);
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]), voices: [{ lang: 'he-IL', localService: true, name: 'Asaf' }] });
  assert.equal(app.bodyClasses['m-no-he-voice'], false);
  app.click('start', { topic: 'add' });
  assert.match(app.view().innerHTML, /data-act="say"/);
  app.click('say');
  assert.equal(app.spoken.length, 1);
  assert.match(app.spoken[0].text, /ועוד/);
  assert.equal(app.spoken[0].lang, 'he-IL');
});

test('spokenText: סימנים במילים, שברים ואחוזים', () => {
  assert.equal(M.spokenText({ prompt: 'כמה זה?', expr: '12 + 5 = ?' }), 'כמה זה? 12 ועוד 5 שווה כמה');
  assert.equal(M.spokenText({ prompt: 'בחרו את הסימן המתאים', expr: '1/2 ☐ 3/4' }), 'בחרו את הסימן המתאים. 1 חלקי 2 איזה סימן 3 חלקי 4');
  assert.equal(M.spokenText({ prompt: '', expr: '30% × 20 = ?' }), '30 אחוז כפול 20 שווה כמה');
  assert.equal(M.spokenText({ prompt: 'כמה חלות?', expr: null }), 'כמה חלות?');
  assert.equal(M.spokenText(null), '');
});

test('קישור ישיר: #ss-action=practice-today פותח תרגול ומוחק את ה-hash; פעולה לא מוכרת — מתעלמים', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]), hash: '#ss-action=practice-today' });
  assert.match(app.view().innerHTML, /id="qcard"/, 'תרגול פתוח');
  assert.equal(app.location.hash, '');
  const store = JSON.stringify(app.store);
  const other = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  const before = other.view().innerHTML;
  other.setHash('#ss-action=delete-everything');
  assert.equal(other.view().innerHTML, before);
  assert.equal(other.location.hash, '');
  other.setHash('#ss-action=practice-today');
  assert.match(other.view().innerHTML, /id="qcard"/, 'גם ב-hashchange');
  // הפעולה רק פותחת מסך — לא נשמר שום דבר חדש מלבד העדפות התצוגה
  const after = JSON.parse(JSON.stringify(app.store)); const prev = JSON.parse(store);
  delete after['math:prefs']; delete prev['math:prefs'];
  assert.deepEqual(after, prev);
  // בלי ילד — מסך ההוספה
  const empty = makeApp({ hash: '#ss-action=practice-today' });
  assert.match(empty.view().innerHTML, /הוספת ילד|ברוכים הבאים/);
});

test('"לבחירת תרגול" תמיד בכותרת, והודעת הצלחה נשארת 6 שניות לפחות', async () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  assert.match(app.el('who').innerHTML, /data-act="home"/);
  app.click('start', { topic: 'add' });
  app.click('home');
  await app.settle();
  assert.match(app.view().innerHTML, /בחרו נושא לתרגול/);
  app.click('tab', { tab: 'learners' });
  app.el('newName').value = 'דוד';
  app.click('add-learner');
  await app.settle();
  assert.match(app.toastText(), /נוסף: דוד/);
  const src = fs.readFileSync(path.join(MATH, 'app.js'), 'utf8');
  assert.match(src, /Math\.max\(6000,/);
});

test('יעד מגע: כפתורים קטנים ושבבים — 44px לפחות; לשוניות עם חצים', () => {
  const css = fs.readFileSync(path.join(MATH, 'style.css'), 'utf8');
  assert.match(css, /\.ss-btn-sm, \.ss-chip \{ min-height: max\(44px, var\(--ss-ctl-h\)\); \}/);
  const src = fs.readFileSync(path.join(MATH, 'app.js'), 'utf8');
  assert.match(src, /ArrowLeft/);
  assert.match(src, /b\.tabIndex = on \? 0 : -1/);
});

test('אתגר בלי שעון / 2 דקות: אין כוכבים בלי 10 תרגילים לפחות (תרגיל אחד ו"סיום" — 0, לא 3)', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  const stars = () => M.sanitizeProgress(M.safeParse(app.store['math:progress:a1'])).stars;
  // התשובה מתוך התרגיל: a × b = ?, או גורם חסר (? × b = p / a × ? = p)
  const solve = h => { let m = /(\d+) × (\d+) = /.exec(h); if (m) return String(m[1] * m[2]); m = /× (\d+) = (\d+)|(\d+) × .*?= (\d+)/.exec(h); return m ? (m[1] ? String(m[2] / m[1]) : String(m[4] / m[3])) : '0'; };
  const answerRight = () => { app.el('ans').value = solve(app.view().innerHTML); app.click('check'); app.advance(300); if (/data-act="timed-next"/.test(app.el('tNext').innerHTML)) app.click('timed-next'); };
  app.click('timed-len', { len: '0' });
  app.click('timed-topic', { topic: 'multable' });
  for (let round = 0; round < 20; round++) { app.click('timed-start'); answerRight(); app.click('timed-stop'); }
  assert.equal(stars(), 0, '20 סבבים של תרגיל אחד — בלי כוכבים');
  assert.match(app.view().innerHTML, /כוכבים מקבלים אחרי 10 תרגילים לפחות/);
  assert.equal(M.sanitizeProgress(M.safeParse(app.store['math:progress:a1'])).days.length, 1, 'הרצף נרשם');
  // 2 דקות — אותו כלל
  app.click('timed-len', { len: '120' });
  app.click('timed-start'); answerRight(); app.click('timed-stop');
  assert.equal(stars(), 0);
  // 10 תרגילים ומעלה — כוכבים לפי אחוז ההצלחה
  app.click('timed-len', { len: '0' });
  app.click('timed-start');
  for (let i = 0; i < 10; i++) answerRight();
  app.click('timed-stop');
  assert.ok(stars() > 0 && stars() <= 3, String(stars()));
  assert.doesNotMatch(app.view().innerHTML, /כוכבים מקבלים אחרי/);
});

test('recordSession: תרגול קצר מ-10 — בלי כוכבים; דקה — לפי timedStars', () => {
  const p = M.emptyProgress();
  assert.equal(M.MIN_STAR_TOTAL, 10);
  assert.equal(M.recordSession(p, { mode: 'practice', topic: 'add', total: 1, correct: 1 }, '2026-11-05').stars, 0);
  assert.equal(M.recordSession(p, { mode: 'practice', topic: 'add', total: 9, correct: 9 }, '2026-11-05').stars, 0);
  assert.equal(M.recordSession(p, { mode: 'practice', topic: 'add', total: 10, correct: 10 }, '2026-11-05').stars, 3);
  assert.equal(M.recordSession(p, { mode: 'timed', topic: 'add', total: 1, correct: 1 }, '2026-11-05').stars, 0);
});

test('קישור ישיר practice-today בוחר את לשונית "תרגול" (גם כשנשמרה לשונית אחרת), ו"חזרה" מחזירה אליה', async () => {
  const s = learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]);
  s['math:prefs'] = JSON.stringify({ tab: 'progress' });
  const app = makeApp({ storage: s, hash: '#ss-action=practice-today' });
  assert.match(app.view().innerHTML, /id="qcard"/);
  assert.equal(JSON.parse(app.store['math:prefs']).tab, 'practice');
  app.click('quit');
  await app.settle();
  assert.match(app.view().innerHTML, /בחרו נושא לתרגול/, 'חזרה למסך התרגול, לא להתקדמות');
});

test('הודעה: הצלחה נעלמת אחרי 6 שניות בדיוק (לא לפני); ביטול — 10 שניות; הודעה שנעלמה מתרוקנת', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: [solveAdult] } });
  app.click('del-learner', { id: 'a1' });
  await app.settle();
  app.advance(9999);
  assert.match(app.el('toast').innerHTML, /data-act="undo"/, 'עד 10 שניות');
  app.advance(1);
  assert.equal(app.el('toast').innerHTML, '', 'אחרי 10 שניות — בלי כפתורי "ביטול" / "סגירה" שקופים');
  app.click('tab', { tab: 'learners' });
  app.el('newName').value = 'דוד';
  app.click('add-learner');
  await app.settle();
  assert.match(app.toastText(), /נוסף: דוד/);
  app.advance(5999);
  assert.match(app.toastText(), /נוסף: דוד/);
  app.advance(1);
  assert.equal(app.el('toast').innerHTML, '');
});

test('תרגיל ההורים: שני גורמים דו-ספרתיים 13–29 (בלי 20) — לא כפל של הכיתות הנמוכות', async () => {
  const app = makeApp({ storage: two(), dialog: { prompt: Array(40).fill(null) } });
  for (let i = 0; i < 40; i++) { app.click('del-learner', { id: 'a1' }); await app.settle(); }
  assert.equal(app.prompts.length, 40);
  for (const p of app.prompts) {
    const [, a, b] = /(\d+) × (\d+)/.exec(p).map(Number);
    for (const n of [a, b]) assert.ok(n >= 13 && n <= 29 && n !== 20, p);
  }
});

test('spokenText: בערך, שורש, חזקות, פאי, יחס וסימני כיוון — במילים', () => {
  assert.equal(M.spokenText({ prompt: 'עגלו לעשרות', expr: '47 ≈ ?' }), 'עגלו לעשרות. 47 בערך כמה');
  assert.equal(M.spokenText({ prompt: '', expr: '√49 = ?' }), 'שורש של 49 שווה כמה');
  assert.equal(M.spokenText({ prompt: '', expr: '5² = ?' }), '5 בריבוע שווה כמה');
  assert.equal(M.spokenText({ prompt: '', expr: '2³ = ?' }), '2 בחזקת 3 שווה כמה');
  assert.equal(M.spokenText({ prompt: 'קנה מידה ⁦1 : 100,000⁩. כמה?', expr: null }), 'קנה מידה 1 ל 100,000. כמה?');
  assert.equal(M.spokenText({ prompt: 'כמה אחוזים?', expr: '8 / 10 = ?%' }), 'כמה אחוזים? 8 חלקי 10 שווה כמה אחוז');
  assert.match(M.spokenText({ prompt: 'מה ההיקף? (השתמשו ב-π = 3.14)', expr: null }), /פאי/);
  // בכל הנושאים — בלי סימן שהקול מדלג עליו
  for (const t of M.TOPIC_IDS) for (let l = 1; l <= 5; l++) for (let i = 0; i < 10; i++) {
    let q; try { q = M.generate(t, l, { grade: 8 }); } catch (_) { continue; }
    assert.doesNotMatch(M.spokenText(q), /[≈√²³⁰¹⁴-⁹π‎‏‪-‮⁦-⁩]/, t);
  }
});
