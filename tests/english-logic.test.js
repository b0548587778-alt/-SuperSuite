// מודול האנגלית: חזרה מרווחת, בדיקת תשובות, יצירת שאלות, נתוני המילים וניקוי נתונים שמורים
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'modules', 'english');
const L = require(path.join(DIR, 'logic.js'));
const W = require(path.join(DIR, 'words.js'));
const G = require(path.join(DIR, 'grammar.js'));

const T = 20000; // יום קבוע לבדיקות

// ---------- חזרה מרווחת ----------
test('חזרה מרווחת: תשובה נכונה מקדמת קופסה ומרחיקה את החזרה', () => {
  let c = L.review(null, true, T);
  assert.deepStrictEqual([c.b, c.d, c.s, c.c, c.w, c.f], [1, T + 1, 1, 1, 0, T]);
  c = L.review(c, true, T + 1);
  assert.deepStrictEqual([c.b, c.d], [2, T + 1 + 2]);
  c = L.review(c, true, T + 3);
  assert.deepStrictEqual([c.b, c.d], [3, T + 3 + 4]);
  assert.strictEqual(c.f, T, 'יום הלימוד הראשון נשמר');
  // כל חזרה בזמנה (ביום שנקבע לה) — עד הקופסה האחרונה ולא מעבר לה
  for (let i = 0; i < 10; i++) c = L.review(c, true, c.d);
  assert.strictEqual(c.b, L.MAX_BOX, 'לא עובר את הקופסה האחרונה');
  assert.strictEqual(c.d - c.l, L.INTERVALS[L.MAX_BOX]);
});

test('חזרה מרווחת: טעות מחזירה לקופסה 1 ולחזרה מחר, בלי לשנות את המקור', () => {
  const orig = { b: 5, d: T, c: 5, w: 0, s: 5 };
  const c = L.review(orig, false, T);
  assert.deepStrictEqual([c.b, c.d, c.w, c.s], [1, T + 1, 1, 6]);
  assert.strictEqual(orig.b, 5);
});

test('תור יומי: מילים שהגיע זמנן קודם, מילים חדשות לפי מכסה, ומסנן', () => {
  const words = [
    { id: 'a', level: 1, topic: 'x' }, { id: 'b', level: 1, topic: 'x' }, { id: 'c', level: 2, topic: 'y' },
    { id: 'd', level: 3, topic: 'x' }, { id: 'e', level: 1, topic: 'x' }
  ];
  const cards = { a: { b: 2, d: T - 1, s: 2, c: 2, w: 0 }, b: { b: 3, d: T + 3, s: 3, c: 3, w: 0 }, c: { b: 1, d: T - 5, s: 1, c: 0, w: 1 } };
  const q = L.dailyQueue(words, cards, T, { newLimit: 1 });
  assert.deepStrictEqual(q.due.map(w => w.id), ['c', 'a'], 'הוותיקה ביותר קודם');
  assert.deepStrictEqual(q.fresh.map(w => w.id), ['e'], 'רמה נמוכה קודם, עד המכסה');
  const f = L.dailyQueue(words, cards, T, { newLimit: 5, filter: w => w.topic === 'x' });
  assert.deepStrictEqual(f.due.map(w => w.id), ['a']);
  assert.deepStrictEqual(f.fresh.map(w => w.id).sort(), ['d', 'e']);
  assert.deepStrictEqual(L.dailyQueue(words, cards, T, { newLimit: 0 }).fresh, []);
});

test('מכסת מילים חדשות: סופרת רק מילים שנלמדו לראשונה היום', () => {
  const cards = { a: L.review(null, true, T), b: L.review(null, false, T), c: L.review(null, true, T - 1) };
  assert.strictEqual(L.newToday(cards, T), 2);
});

test('בוחן: טעות במילה שנלמדה מחזירה לקופסה 1 ולחזרה היום ונספרת כמילה קשה; תשובה נכונה לא מזיזה', () => {
  const c = L.quizAnswer({ b: 4, d: T + 8, s: 4, c: 4, w: 0 }, false, T);
  assert.deepStrictEqual([c.b, c.d, c.q], [1, T, 1]);
  const ok = L.quizAnswer({ b: 4, d: T + 8, s: 4, c: 4, w: 0 }, true, T);
  assert.deepStrictEqual([ok.b, ok.d], [4, T + 8]);
  const fresh = L.quizAnswer(undefined, false, T);
  assert.strictEqual(fresh.s, 0, 'מילה שלא נלמדה נשארת חדשה');
  const hard = L.hardWords([{ id: 'x', en: 'x' }], { x: L.quizAnswer(fresh, false, T) });
  assert.strictEqual(hard.length, 1);
});

test('רצף ימים ומילים קשות', () => {
  assert.strictEqual(L.streak({ [T]: 3, [T - 1]: 1, [T - 2]: 2, [T - 4]: 1 }, T), 3);
  assert.strictEqual(L.streak({ [T - 1]: 1, [T - 2]: 2 }, T), 2, 'היום עוד לא תורגל — הרצף נשמר');
  assert.strictEqual(L.streak({ [T - 2]: 2 }, T), 0);
  const words = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const cards = { a: { b: 1, d: T, s: 4, c: 1, w: 3 }, b: { b: 4, d: T, s: 8, c: 7, w: 1 }, c: { b: 3, d: T, s: 6, c: 2, w: 4 } };
  assert.deepStrictEqual(L.hardWords(words, cards).map(h => h.word.id), ['a', 'c']);
});

test('סטטיסטיקה: נלמדו, דיוק ושליטה לפי נושא', () => {
  const words = [{ id: 'a', topic: 't1' }, { id: 'b', topic: 't1' }, { id: 'c', topic: 't2' }];
  const p = L.emptyProgress();
  p.cards = { a: { b: 6, d: T + 30, s: 6, c: 6, w: 0 }, b: { b: 1, d: T, s: 2, c: 1, w: 1 } };
  p.quiz = { c: 2, t: 4 };
  L.bumpDay(p, T, 5);
  const st = L.stats(words, p, T);
  assert.strictEqual(st.learned, 1);
  assert.strictEqual(st.seen, 2);
  assert.strictEqual(st.due, 1);
  assert.strictEqual(st.accuracy, Math.round((7 + 2) / (8 + 4) * 100));
  assert.strictEqual(st.mastery.t1.pct, Math.round(((6 + 1) / 6 / 2) * 100));
  assert.strictEqual(st.mastery.t2.pct, 0);
  assert.strictEqual(st.todayCount, 5);
  assert.strictEqual(st.streak, 1);
});

test('dayIndex לפי התאריך המקומי', () => {
  assert.strictEqual(L.dayIndex(new Date(2026, 10, 1, 0, 30)), L.dayIndex(new Date(2026, 10, 1, 23, 50)));
  assert.strictEqual(L.dayIndex(new Date(2026, 10, 2, 0, 1)) - L.dayIndex(new Date(2026, 10, 1, 23, 59)), 1);
});

// ---------- בדיקת תשובות ----------
test('נרמול: אותיות, רווחים, פיסוק בקצוות וגרשיים', () => {
  assert.strictEqual(L.normalize('  Good   Morning! '), 'good morning');
  assert.strictEqual(L.normalize('DOESN’T'), "doesn't");
  assert.strictEqual(L.normalize(null), '');
  assert.ok(L.checkAnswer('  APPLE ', 'apple').correct);
  assert.ok(L.checkAnswer('thank   you', ['thank you']).correct);
  assert.ok(L.checkAnswer('does not', ["doesn't", 'does not']).correct);
});

test('בדיקת איות: טעות של אות אחת = "כמעט", עם השוואה לפי אותיות', () => {
  const r = L.checkAnswer('aple', 'apple');
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.close, true);
  assert.deepStrictEqual(r.diff.map(d => d.t), ['ok', 'ok', 'miss', 'ok', 'ok']);
  const far = L.checkAnswer('banana', 'apple');
  assert.strictEqual(far.close, false);
  const empty = L.checkAnswer('   ', 'apple');
  assert.ok(empty.empty && !empty.correct);
  const extra = L.diffChars('catt', 'cat');
  assert.deepStrictEqual(extra.filter(d => d.t === 'extra').length, 1);
  // השוואה משחזרת את התשובה הנכונה כשמסירים את האותיות המיותרות
  const d = L.diffChars('hous', 'mouse');
  assert.strictEqual(d.filter(x => x.t !== 'extra').map(x => x.ch).join(''), 'mouse');
  assert.strictEqual(d.filter(x => x.t !== 'miss').map(x => x.ch).join(''), 'hous');
});

test('levenshtein', () => {
  assert.strictEqual(L.levenshtein('kitten', 'sitting'), 3);
  assert.strictEqual(L.levenshtein('', 'abc'), 3);
  assert.strictEqual(L.levenshtein('same', 'same'), 0);
});

// ---------- יצירת שאלות ----------
test('שאלת בחירה: 4 אפשרויות שונות, כולל הנכונה, בשני הכיוונים, בכל המילים', () => {
  const rand = L.rng(42);
  for (const w of W.WORDS) {
    for (const dir of ['en-he', 'he-en']) {
      const q = L.buildChoice(w, W.WORDS, dir, rand, 4);
      assert.strictEqual(q.options.length, 4, w.id);
      assert.strictEqual(new Set(q.options.map(L.normalize)).size, 4, 'אפשרויות שונות: ' + w.id);
      const key = dir === 'en-he' ? 'he' : 'en';
      assert.strictEqual(q.options[q.answerIndex], w[key]);
      assert.strictEqual(q.options.filter(o => o === w[key]).length, 1);
      // אין מסיח שהשאלה שלו זהה (שתי תשובות נכונות)
      const promptKey = dir === 'en-he' ? 'en' : 'he';
      for (const o of q.options) {
        if (o === w[key]) continue;
        const other = W.WORDS.find(x => x[key] === o);
        assert.notStrictEqual(L.normalize(other[promptKey]), L.normalize(w[promptKey]), w.id);
      }
    }
  }
});

test('שאלת בחירה עם מאגר קטן — לא נתקעת ולא משכפלת', () => {
  const pool = [{ id: 'a', en: 'a', he: 'א' }, { id: 'b', en: 'b', he: 'א' }, { id: 'c', en: 'c', he: 'ג' }];
  const q = L.buildChoice(pool[0], pool, 'en-he', L.rng(1), 4);
  assert.deepStrictEqual(q.options.slice().sort(), ['א', 'ג']);
});

test('סידור משפט: אותן מילים בסדר אחר, ובדיקה סלחנית לרישיות ולנקודה', () => {
  const rand = L.rng(7);
  for (const w of W.WORDS.filter(x => x.ex)) {
    const o = L.buildOrder(w.ex, rand);
    assert.deepStrictEqual(o.tokens.slice().sort(), L.tokenize(w.ex).sort(), w.id);
    if (new Set(L.tokenize(w.ex)).size > 1) assert.notStrictEqual(o.tokens.join(' '), o.sentence, 'מעורבב: ' + w.id);
    assert.ok(L.checkOrder(L.tokenize(w.ex), w.ex));
  }
  assert.ok(L.checkOrder(['i', 'eat', 'an', 'apple'], 'I eat an apple.'));
  assert.ok(!L.checkOrder(['an', 'eat', 'I', 'apple.'], 'I eat an apple.'));
});

test('בחירת מילים לבוחן: בלי כפילויות ובגודל המבוקש', () => {
  const ws = L.pickQuizWords(W.WORDS, {}, 10, L.rng(3));
  assert.strictEqual(ws.length, 10);
  assert.strictEqual(new Set(ws.map(w => w.id)).size, 10);
  assert.strictEqual(L.pickQuizWords(W.WORDS.slice(0, 3), {}, 10).length, 3);
});

test('shuffle ו-rng ניתנים לשחזור', () => {
  const a = L.shuffle([1, 2, 3, 4, 5, 6], L.rng(9));
  const b = L.shuffle([1, 2, 3, 4, 5, 6], L.rng(9));
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a.slice().sort(), [1, 2, 3, 4, 5, 6]);
});

// ---------- נתוני המילים ----------
test('אוצר המילים: לפחות 400 מילים, לכל אחת en/he/נושא/רמה, בלי כפילויות', () => {
  assert.ok(W.WORDS.length >= 400, 'מספר מילים: ' + W.WORDS.length);
  assert.deepStrictEqual(L.validateWords(W.WORDS, W.TOPICS), []);
  const ids = W.WORDS.map(w => w.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const w of W.WORDS) {
    assert.ok(w.en && w.he && w.topic && w.level, JSON.stringify(w));
    assert.strictEqual(w.id, w.en.toLowerCase());
  }
  for (const t of W.TOPICS) assert.ok(W.WORDS.filter(w => w.topic === t.id).length >= 10, 'נושא דל: ' + t.id);
  for (const lv of [1, 2, 3]) assert.ok(W.WORDS.filter(w => w.level === lv).length >= 80, 'רמה ' + lv);
  assert.ok(W.WORDS.filter(w => w.ex).length >= W.WORDS.length / 2, 'משפטי דוגמה לרוב המילים');
});

test('הבודק של נתוני המילים תופס שגיאות', () => {
  const bad = [
    { id: 'a', en: 'a', he: 'א', topic: 'family', level: 1 },
    { id: 'a', en: 'a', he: 'א', topic: 'family', level: 1 },
    { id: 'b', en: 'b', he: '', topic: 'nope', level: 4, ex: 'no capital' }
  ];
  const errs = L.validateWords(bad, W.TOPICS);
  assert.ok(errs.some(e => e.includes('כפילות')));
  assert.ok(errs.some(e => e.includes('חסר he')));
  assert.ok(errs.some(e => e.includes('נושא')));
  assert.ok(errs.some(e => e.includes('רמה')));
  assert.ok(errs.some(e => e.includes('משפט')));
});

test('תוכן הולם: בלי מילים מתחומים שאינם מתאימים לקהל היעד', () => {
  const banned = /\b(music|song|sing|movie|film|tv|television|cinema|party|dance|dancing|christmas|easter|halloween|church|pig|pork|bacon|ham|wine|beer|girlfriend|boyfriend|date night|kiss|football|soccer|basketball|team|guitar|piano|radio|internet|video|game)\b/i;
  for (const w of W.WORDS) {
    assert.doesNotMatch(w.en, banned, w.en);
    if (w.ex) assert.doesNotMatch(w.ex, banned, w.ex);
  }
  for (const l of G.LESSONS) for (const r of l.rules.concat(l.exercises)) assert.doesNotMatch(r.en || r.q, banned);
});

test('שיעורי הדקדוק: שבעה שיעורים, לכל תרגיל מקום חסר ותשובה שנבדקת כנכונה', () => {
  const ids = G.LESSONS.map(l => l.id);
  for (const id of ['to-be', 'present-simple', 'plurals', 'a-an', 'pronouns', 'questions', 'past-simple']) assert.ok(ids.includes(id), id);
  for (const l of G.LESSONS) {
    assert.ok(l.title && l.intro && l.rules.length >= 3 && l.exercises.length >= 4, l.id);
    for (const ex of l.exercises) {
      assert.strictEqual(ex.q.split('___').length, 2, ex.q);
      assert.ok(Array.isArray(ex.a) && ex.a.length, ex.q);
      assert.ok(L.checkAnswer(ex.a[0].toUpperCase(), ex.a).correct, ex.q);
      if (ex.options) assert.ok(ex.options.some(o => L.checkAnswer(o, ex.a).correct), 'תשובה בין האפשרויות: ' + ex.q);
    }
  }
});

// ---------- נתונים שמורים פגומים ----------
test('התקדמות שמורה פגומה — מתאפסת או מנוקה בלי לזרוק', () => {
  const ids = new Set(['apple', 'cat']);
  for (const raw of [null, undefined, 5, 'x', [], [1, 2], { cards: 'no' }, { cards: [], days: 7, quiz: null, grammar: [] }]) {
    const p = L.sanitizeProgress(raw, ids);
    assert.deepStrictEqual(p, L.emptyProgress());
  }
  const p = L.sanitizeProgress({
    cards: { apple: { b: 99, d: 'abc', c: -4, w: 2.6, s: 3, q: 'x', evil: '<img>' }, cat: 'bad', unknown: { b: 1 }, __proto__x: { b: 1 } },
    days: { 20000: 3, '-1': 4, abc: 5, 20001: 'NaN', 20002: -3 },
    quiz: { c: 50, t: 10 },
    grammar: { 'to-be': { best: 9, total: 6 }, 'BAD KEY': { best: 1, total: 1 }, plurals: 'x' }
  }, ids);
  assert.deepStrictEqual(Object.keys(p.cards), ['apple']);
  assert.strictEqual(p.cards.apple.b, L.MAX_BOX);
  assert.strictEqual(p.cards.apple.d, 0);
  assert.strictEqual(p.cards.apple.c, 0);
  assert.strictEqual(p.cards.apple.w, 3);
  assert.strictEqual(p.cards.apple.evil, undefined);
  assert.deepStrictEqual(p.days, { 20000: 3 });
  assert.deepStrictEqual(p.quiz, { c: 10, t: 10 }, 'נכונות לא עולות על סך התשובות');
  assert.deepStrictEqual(p.grammar, { 'to-be': { best: 6, total: 6 } });
  // אחרי הניקוי — כל הפונקציות עובדות
  assert.doesNotThrow(() => L.stats([{ id: 'apple', topic: 't' }], p, T));
  assert.doesNotThrow(() => L.review(p.cards.apple, true, T));
});

test('לומדים שמורים פגומים — מסוננים, והלומד הפעיל תמיד קיים', () => {
  assert.deepStrictEqual(L.sanitizeLearners(null), { list: [], active: null });
  assert.deepStrictEqual(L.sanitizeLearners({ list: 'x' }), { list: [], active: null });
  const r = L.sanitizeLearners({
    list: [
      { id: 'abcd1234', name: '  יוסי  <b>' }, { id: 'abcd1234', name: 'כפול' }, { id: '../x', name: 'רע' },
      { id: 'zzzz9999', name: '' }, null, 'str', { id: 'qqqq1111', name: 'שרה', created: 'x' }
    ],
    active: 'nope'
  });
  assert.deepStrictEqual(r.list.map(l => [l.id, l.name]), [['abcd1234', 'יוסי b'], ['qqqq1111', 'שרה']]);
  assert.strictEqual(r.active, 'abcd1234');
  assert.strictEqual(r.list[1].created, 0);
  assert.strictEqual(L.sanitizeLearners({ list: r.list, active: 'qqqq1111' }).active, 'qqqq1111');
  assert.ok(L.cleanName('x'.repeat(100)).length <= 30);
});

test('הגדרות שמורות פגומות — ברירת מחדל ותחום מותר', () => {
  assert.deepStrictEqual(L.sanitizeSettings('junk'), L.DEFAULT_SETTINGS);
  const s = L.sanitizeSettings({ dailyGoal: 100000, newPerDay: -5, cardDir: 'x', levels: [7, 'a'], topic: '<script>', autoSpeak: 'yes' });
  assert.deepStrictEqual(s, { dailyGoal: 200, newPerDay: 0, cardDir: 'en-he', levels: [1, 2, 3], topic: 'all', autoSpeak: false });
  assert.deepStrictEqual(L.sanitizeSettings({ levels: [3, 1, 3] }).levels, [1, 3]);
  assert.strictEqual(L.parseJSON('{bad'), null);
  assert.strictEqual(L.parseJSON(undefined), null);
  assert.deepStrictEqual(L.parseJSON('{"a":1}'), { a: 1 });
});

test('bumpDay שומר עד 400 ימים', () => {
  const p = L.emptyProgress();
  for (let d = 0; d < 450; d++) L.bumpDay(p, T + d, 1);
  assert.strictEqual(Object.keys(p.days).length, 400);
  assert.ok(!(T in p.days) && (T + 449) in p.days);
});

// ---------- חוזה המודול ----------
test('index.html: CSP, ערכת העיצוב, screen-guard ראשון, בלי קוד מוטבע', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const tools = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'index.html'), 'utf8');
  const csp = m => (m.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/) || [])[0];
  assert.strictEqual(csp(html), csp(tools));
  assert.match(html, /<html lang="he" dir="rtl">/);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.match(scripts[0][1], /src="\/screen-guard\.js"/);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src="/);
    assert.strictEqual(body.trim(), '');
    assert.doesNotMatch(attrs, /type="module"/);
  }
  assert.match(html, /href="\/design-tokens\.css"/);
  assert.match(html, /href="\/ui-kit\.css"/);
  assert.match(html, /<script src="\/ss-dialog\.js"><\/script>/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'בלי מאזינים מוטבעים');
});

test('קבצי המודול: בלי רשת, בלי חלונות דפדפן, בלי hex ובלי eval; אחסון רק בתחילית english:', () => {
  for (const f of fs.readdirSync(DIR)) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|window\.open/, f);
    assert.doesNotMatch(src, /(^|[^.\w])(alert|confirm|prompt)\s*\(/, f);
    assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(|innerHTML|outerHTML|insertAdjacentHTML/, f);
    if (/\.(css|html)$/.test(f)) assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, f);
  }
  const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  for (const m of app.matchAll(/localStorage\.(getItem|setItem|removeItem)\(([^)]*)\)/g)) assert.match(m[2], /^'english:'/, m[0]);
});
