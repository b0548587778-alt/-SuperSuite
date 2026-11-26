// סקירת קוד 11.2026 — מודול החשבון: תוכן לכיתות ו'–ח', פדגוגיה, פענוח תשובות ונגישות.
// הלוגיקה נבדקת ישירות; הממשק (app.js) רץ ב-vm עם DOM מדומה מינימלי, שעון מזויף ו-localStorage שאפשר להכשיל.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../modules/math/logic.js');

const DIR = path.join(__dirname, '..', 'modules', 'math');
const APP_SRC = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const Q = (q, s) => M.checkAnswer(q, s);
const F = (n, d) => M.frac(n, d);

const { makeApp, solveAdult } = require('./helpers/math-ui.js');
const learnersStore = (list, active) => ({ 'math:learners': JSON.stringify({ v: 1, active: active || list[0].id, list }) });
const securityError = () => Object.assign(new Error('השינוי לא נשמר: תקופת הניסיון הסתיימה'), { name: 'SecurityError' });

// ---------------------------------------------------------------- f82: תוכן לכיתות ז'–ח'
test('f82: כל כיתה מוסיפה תוכן על הכיתה שלפניה, וז\'–ח\' כוללות נושאים משלהן', () => {
  const sum = g => M.TOPICS.reduce((s, t) => s + M.maxLevelFor(t.id, g), 0);
  for (let g = 2; g <= 8; g++) assert.ok(sum(g) > sum(g - 1), 'כיתה ' + g + ' מוסיפה על ' + (g - 1));
  for (const t of M.TOPICS) for (let g = 2; g <= 8; g++) assert.ok(M.maxLevelFor(t.id, g) >= M.maxLevelFor(t.id, g - 1), t.id + ' לא יורד בכיתה ' + g);
  for (const id of ['neg', 'eq', 'pow']) {
    assert.equal(M.maxLevelFor(id, 6), 0, id + ' — מכיתה ז\'');
    assert.ok(M.maxLevelFor(id, 7) > 0 && M.maxLevelFor(id, 8) > M.maxLevelFor(id, 7), id);
  }
  for (const id of ['ratio', 'geo']) assert.ok(M.maxLevelFor(id, 8) > M.maxLevelFor(id, 7), id);
  for (const id of ['neg', 'eq', 'pow', 'ratio', 'geo']) assert.equal(M.MAX_LEVEL[id], Math.max(...M.topicById(id).maxLevel), id);
});

test('f82: הנושאים החדשים — תשובה נכונה (חישוב עצמאי), הסבר, ותשובה מוצגת שמתקבלת', () => {
  const calc = js => Function('"use strict"; return (' + js + ');')();
  let neg = 0, count = 0;
  for (const id of ['neg', 'pow', 'eq', 'ratio', 'geo']) {
    for (let lv = 1; lv <= M.MAX_LEVEL[id]; lv++) {
      const R = M.seeded(31 * lv + id.length);
      for (let i = 0; i < 200; i++) {
        const q = M.generate(id, lv, { random: R }), d = q.data, ctx = id + ' ' + lv + ' ' + (q.expr || q.prompt);
        count++;
        assert.ok(q.steps.length > 0, 'הסבר ' + ctx);
        for (const s of q.steps) assert.equal((s.match(/⟦/g) || []).length, (s.match(/⟧/g) || []).length, s);
        const typed = q.unit ? q.answerText.replace(' ' + q.unit, '') : q.answerText;
        assert.equal(Q(q, typed).status, 'correct', 'התשובה המוצגת מתקבלת: ' + ctx + ' → ' + typed);
        assert.ok(q.prompt, ctx);
        if (q.answer.n < 0) neg++;
        if (id === 'neg' || id === 'pow') {
          assert.equal(calc(d.js), q.answer.n, ctx);
          assert.equal(q.answer.d, 1, ctx);
          assert.match(q.expr, / = \?$/, ctx);
        } else if (id === 'eq') {
          const x = q.answer.n, js = s => calc(s.replace(/x/g, '(' + x + ')'));
          assert.equal(js(d.lhs), js(d.rhs), 'הצבה ' + ctx);
          assert.equal(q.blank, 'x =');
        } else if (id === 'ratio') {
          const v = q.answer.n;
          if (d.kind === 'unit') assert.equal(v * d.k, d.total);
          else if (d.kind === 'rate') assert.equal(v, d.total / d.k * d.m);
          else if (d.kind === 'split') assert.equal(v, d.total / (d.a + d.b) * (d.second ? d.b : d.a));
          else if (d.kind === 'prop') assert.equal(d.a * d.d, d.b * d.c);
          else if (d.kind === 'inverse') assert.equal(v * d.n2, d.n1 * d.t1);
          else if (d.kind === 'scale') assert.equal(v * 100000, d.scale * d.cm);
          else assert.fail('kind ' + d.kind);
        } else {
          const want = { rectP: x => 2 * (x.a + x.b), rectA: x => x.a * x.b, tri: x => x.b * x.h / 2, para: x => x.b * x.h, trap: x => (x.a + x.c) * x.h / 2,
            rectSide: x => x.area / x.a, boxV: x => x.a * x.b * x.c, boxS: x => 2 * (x.a * x.b + x.b * x.c + x.a * x.c) }[d.kind];
          if (want) { assert.ok(M.fracEq(q.answer, F(want(d))), ctx); assert.equal(q.answer.d, 1, ctx); }
          else { const k = d.kind === 'circA' ? 314 * d.r * d.r : 628 * d.r; assert.ok(M.fracEq(q.answer, F(k, 100)), ctx); }
          assert.ok(q.unit, 'יחידה ' + ctx);
        }
      }
    }
  }
  assert.ok(neg > 100, 'יש תשובות שליליות במספרים מכוונים ובמשוואות');
  assert.ok(count > 4000);
  // תוכן הולם: שמות ומקומות מהסביבה, בלי תוכן לועזי
  const all = [];
  for (const id of ['ratio', 'geo']) for (let lv = 1; lv <= 5; lv++) { const R = M.seeded(lv); for (let i = 0; i < 40; i++) all.push(M.generate(id, lv, { random: R }).prompt); }
  assert.ok(all.some(p => /בית המדרש/.test(p)));
});

test('f82: מספרים שליליים מוצגים במינוס אמיתי ובסוגריים, וחזקות בכתב עילי', () => {
  assert.equal(M.evalTokens([10, '−', -9]).value, 19);
  assert.deepEqual(M.evalTokens([2, '×', '(', 3, '−', 5, ')']).seq, ['2 × (3 − 5)', '2 × (−2)', '−4']);
  assert.deepEqual(M.evalTokens(['(', 3, '+', 2, ')', '^', 2]).seq, ['(3 + 2)²', '5²', '25']);
  assert.equal(M.evalTokens([-3, '^', 2]).value, 9, '(−3)² = 9');
  assert.equal(M.evalTokens([-3, '^', 2]).seq[0], '(−3)²');
  assert.equal(M.evalTokens([{ root: 50 }]), null, 'שורש לא שלם נדחה');
  assert.equal(M.evalTokens([7, '÷', 2]), null, 'חילוק לא שלם נדחה');
  assert.equal(Q(M.generate('neg', 1, { random: M.seeded(2) }), '-999').status, 'wrong');
});

// ---------------------------------------------------------------- f46 / f47 / f132: פענוח תשובות
test('f46: מקלדת עברית — "3.4" לשבר 3/4 מקבל רמז ולא נספר כטעות; ץ ו-ת מתפרשים כנקודה ופסיק', () => {
  const q = { topic: 'frac', kind: 'number', answer: F(3, 4) };
  assert.deepEqual(Q(q, '3.4'), { status: 'unparsed', hint: 'hebrew-slash' });
  assert.equal(Q(q, '3/4').status, 'correct');
  assert.equal(Q(q, '0.75').status, 'correct');
  assert.equal(Q(q, '2.3').status, 'wrong');
  const mixed = { topic: 'frac', kind: 'number', answer: F(3, 2) };
  assert.deepEqual(Q(mixed, '1 1.2'), { status: 'unparsed', hint: 'hebrew-slash' });
  assert.deepEqual(M.parseNumber('2ץ5'), { n: 5, d: 2 });
  assert.deepEqual(M.parseNumber('1ת000'), { n: 1000, d: 1 });
  assert.equal(Q({ topic: 'dec', kind: 'number', answer: F(5, 2) }, '2ץ5').status, 'correct');
  // "שארית" נשארת מילה (ת לא הופכת לפסיק בתוכה)
  assert.deepEqual(M.parseDivRem('7 שארית 2'), { q: 7, r: 2 });
});

test('f47: שבר שמשכתב תרגיל עם תשובה שלמה ("56/7") לא מתקבל', () => {
  const div = M.generate('div', 1, { random: M.seeded(4) });
  const { N, d } = div.data;
  assert.deepEqual(Q(div, N + '/' + d), { status: 'unparsed', hint: 'whole' });
  assert.equal(Q(div, String(div.answer.n)).status, 'correct');
  assert.deepEqual(Q({ topic: 'word', kind: 'number', answer: F(5) }, '35 / 7'), { status: 'unparsed', hint: 'whole' });
  assert.deepEqual(Q({ topic: 'frac', kind: 'number', answer: F(15), data: { kind: 'ofQty' } }, '60/4'), { status: 'unparsed', hint: 'whole' });
  // בחיבור שברים שתוצאתו שלם — "4/4" עדיין תשובה לגיטימית
  assert.equal(Q({ topic: 'frac', kind: 'number', answer: F(1), data: { kind: 'addSame' } }, '4/4').status, 'correct');
  assert.equal(Q({ topic: 'add', kind: 'number', answer: F(8) }, '8/1').status, 'correct');
});

test('f132: "30%" מתקבל בשאלת "כמה אחוזים"', () => {
  let q;
  for (const R = M.seeded(9); !q || !/%$/.test(q.answerText);) q = M.generate('pct', 4, { random: R });
  assert.equal(Q(q, q.answerText).status, 'correct');
  assert.equal(Q(q, q.answer.n + ' %').status, 'correct');
  assert.equal(Q(q, String(q.answer.n)).status, 'correct');
});

// ---------------------------------------------------------------- f48: פריטה דרך אפס
test('f48: הסבר החיסור לא מציג ספרה שלילית כשפורטים דרך אפס', () => {
  let zeroBorrow = 0;
  for (const lv of [5, 6]) {
    const R = M.seeded(lv * 3);
    for (let i = 0; i < 3000; i++) {
      const q = M.generate('sub', lv, { random: R });
      for (const s of q.steps) assert.doesNotMatch(s, /[⟦=(]\s*-\d|מ-⟦-/, q.expr + ': ' + s);
      if (q.steps.some(s => /נשארות ⟦9⟧/.test(s))) zeroBorrow++;
    }
  }
  assert.ok(zeroBorrow > 20, 'נבדקו תרגילים עם פריטה דרך אפס: ' + zeroBorrow);
});

// ---------------------------------------------------------------- f49: שברים בכיתה ג'
test('f49: שברים בכיתה ג\' — שבר מכמות והשוואת שברי יחידה, בלי צמצום ובלי "מחלק משותף"', () => {
  assert.equal(M.startLevel('frac', 3), 1);
  const kinds = new Set();
  for (let lv = 1; lv <= M.maxLevelFor('frac', 3); lv++) {
    const R = M.seeded(lv);
    for (let i = 0; i < 300; i++) {
      const q = M.generate('frac', lv, { grade: 3, random: R });
      kinds.add(q.data.kind);
      assert.ok(!q.requireReduced, q.expr);
      assert.doesNotMatch(q.steps.join(' '), /מחלק המשותף/, q.expr);
      if (q.data.kind === 'ofQty') assert.ok(q.data.d <= 4, 'מכנים קטנים ' + q.expr);
    }
  }
  assert.ok(kinds.has('unitCmp') && kinds.has('ofQty'));
  const R = M.seeded(3), lv3 = Array.from({ length: 80 }, () => M.generate('frac', 3, { random: R }));
  assert.ok(lv3.some(q => q.requireReduced), 'צמצום מכיתה ד\' (רמה 3)');
});

// ---------------------------------------------------------------- f50: כסף בכיתות א'–ג'
test('f50: כסף בכיתות א\'–ג\' — כל התשובות בשלמים; עודף עשרוני מכיתה ד\'', () => {
  for (let g = 1; g <= 3; g++) {
    for (let lv = 1; lv <= M.maxLevelFor('money', g); lv++) {
      const R = M.seeded(g * 10 + lv);
      for (let i = 0; i < 300; i++) {
        const q = M.generate('money', lv, { grade: g, random: R });
        assert.equal(q.answer.d, 1, 'כיתה ' + g + ': ' + q.prompt);
        assert.equal(Q(q, q.answerText.replace(/ (₪|אגורות)$/, '')).status, 'correct', q.prompt);
      }
    }
  }
  const R = M.seeded(4), dec = Array.from({ length: 100 }, () => M.generate('money', 4, { grade: 4, random: R }));
  assert.ok(dec.some(q => q.answer.d > 1), 'עודף עשרוני בכיתה ד\'');
});

// ---------------------------------------------------------------- f133 / f134 / f135 / f136: שאלות
test('f133: אין "חברותות" בשאלות החילוק — קבוצות', () => {
  const src = fs.readFileSync(path.join(DIR, 'logic.js'), 'utf8');
  assert.doesNotMatch(src, /חברות(?:ות|א)/);
  const R = M.seeded(1), texts = Array.from({ length: 400 }, () => M.generate('word', 4, { random: R }).prompt);
  assert.ok(texts.some(t => t.includes('לקבוצות של')));
});

test('f134: שאלות מילוליות בכיתה ב\' (רמה 3) — עד 100', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const R = M.seeded(seed);
    for (let i = 0; i < 2000; i++) {
      const q = M.generate('word', 3, { grade: 2, random: R });
      assert.ok(q.answer.n <= 100 && q.data.a <= 100, q.prompt);
      assert.ok(q.data.b >= 5, 'b בטווח ' + q.prompt);
    }
  }
});

test('f135: "עגלו לאלף הקרוב" (זכר), "לעשרת הקרובה", "למאה הקרובה"', () => {
  const p = lv => M.generate('round', lv, { random: M.seeded(1) }).prompt;
  assert.equal(p(4), 'עגלו לאלף הקרוב');
  assert.equal(p(3), 'עגלו למאה הקרובה');
  assert.equal(p(1), 'עגלו לעשרת הקרובה');
});

test('f136: עיגול עשרוני — המספר בשאלה לא מעוגל כבר', () => {
  const R = M.seeded(11);
  for (let i = 0; i < 3000; i++) {
    const q = M.generate('round', 5, { random: R });
    const places = q.data.toTenth ? 2 : 1;
    assert.match(q.expr, new RegExp('^\\d+\\.\\d{' + places + '} ≈ \\?$'), q.expr);
  }
});

// ---------------------------------------------------------------- f137 / f129: לוגיקת התקדמות
test('f137: "תרגול העובדות שלי" בוחר גם עובדות של 1', () => {
  let f = {};
  for (let a = 2; a <= 10; a++) for (let b = a; b <= 10; b++) for (let k = 0; k < 3; k++) f = M.recordFact(f, a, b, true);
  const picked = M.pickFacts(f, 10, M.seeded(3));
  assert.equal(picked.length, 10);
  assert.ok(picked.every(x => x[0] === 1 || x[1] === 1), 'העובדות החדשות של 1 קודם: ' + JSON.stringify(picked));
  assert.ok(M.pickFacts({}, 60, M.seeded(1)).some(x => x[0] === 1));
});

test('f129: סשן בלי אף תשובה לא נרשם (לא רצף ימים ולא תג "צעד ראשון")', () => {
  const p0 = M.emptyProgress();
  const r = M.recordSession(p0, { mode: 'timed', topic: 'multable', total: 0, correct: 0 }, '2026-11-05');
  assert.equal(r.stars, 0);
  assert.deepEqual(r.progress.days, []);
  assert.deepEqual(r.progress.sessions, []);
  assert.deepEqual(M.earnedBadges(r.progress, '2026-11-05'), []);
});

// ---------------------------------------------------------------- f127: תשובה עם יחידה בעברית
test('f127: answerMarkup — רק המספר משמאל לימין, המילה בעברית בכיוון הרגיל', () => {
  assert.equal(M.answerMarkup({ answerText: '12 ספרים', unit: 'ספרים' }), '⟦12⟧ ספרים');
  assert.equal(M.answerMarkup({ answerText: '7 (שארית 2)' }), '⟦7⟧ (שארית ⟦2⟧)');
  assert.equal(M.answerMarkup({ answerText: '3/4 < 5/6' }), '⟦3/4 < 5/6⟧');
  assert.equal(M.answerMarkup({ answerText: '72', unit: 'סמ״ר' }), '⟦72⟧ סמ״ר');
  assert.equal(M.answerMarkup({ answerText: '−4', blank: 'x =' }), '⟦x = −4⟧');
  assert.equal(M.answerMarkup({ answerText: '1 1/2 (3/2)' }), '⟦1 1/2 (3/2)⟧');
});

test('f123: saveErrorText — הסיבה האמיתית בעברית ולפי הפעולה', () => {
  // בלי כפילות: הודעת המחסן פותחת ב"השינוי לא נשמר:" (main.js rejectWrite)
  assert.equal(M.saveErrorText(securityError(), 'הילד לא נוסף'), 'הילד לא נוסף — תקופת הניסיון הסתיימה');
  assert.equal(M.saveErrorText({ name: 'SecurityError', message: 'השינוי לא נשמר: המודול אינו כלול ברישיון' }, 'ההתקדמות לא נשמרה'), 'ההתקדמות לא נשמרה — המודול אינו כלול ברישיון');
  assert.equal(M.saveErrorText({ name: 'SecurityError', message: 'השינוי לא נשמר:' }, 'ההתקדמות לא נשמרה'), 'ההתקדמות לא נשמרה');
  assert.equal(M.saveErrorText({ name: 'QuotaExceededError', message: 'x' }, 'ההתקדמות לא נשמרה'), 'ההתקדמות לא נשמרה — אין מספיק מקום לשמירה');
  assert.equal(M.saveErrorText(new Error('EPERM boom'), 'ההתקדמות לא נשמרה'), 'ההתקדמות לא נשמרה');
});

// ---------------------------------------------------------------- ממשק (vm)
test('f123: ברישיון לקריאה בלבד — אין הודעת כשל בפתיחה ובמעבר לשונית; בהוספת ילד — "הילד לא נוסף" והסיבה', async () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]), failWrites: securityError() });
  assert.equal(app.toastText(), '', 'בלי הודעה בפתיחה (שמירת העדפות)');
  app.click('tab', { tab: 'learners' });
  assert.equal(app.toastText(), '', 'בלי הודעה במעבר לשונית');
  app.el('newName').value = 'דוד';
  app.click('add-learner');
  await app.settle();
  assert.match(app.toastText(), /^הילד לא נוסף — תקופת הניסיון/);
  assert.doesNotMatch(app.toastText(), /לא נשמר:/);
  // שגיאה נשארת עד "סגירה" (לא נעלמת לבד)
  assert.match(app.el('toast').innerHTML, /data-act="toast-close"/);
  app.advance(60000);
  assert.match(app.toastText(), /^הילד לא נוסף/);
});

test('f125: כשל בהוספת ילד לא מחליף את הילד הפעיל', async () => {
  const storage = learnersStore([{ id: 'a1', name: 'אברהם', grade: 3 }, { id: 'b2', name: 'בנימין', grade: 3 }], 'b2');
  storage['math:progress:b2'] = JSON.stringify({ stars: 7 });
  const app = makeApp({ storage, failWrites: securityError() });
  app.click('tab', { tab: 'learners' });
  app.el('newName').value = 'גדליה';
  app.click('add-learner');
  await app.settle();
  app.click('tab', { tab: 'practice' });
  assert.match(app.view().innerHTML, /שלום בנימין/);
  assert.doesNotMatch(app.view().innerHTML, /שלום אברהם/);
});

test('f124: שינוי כיתה והחזרתה לא מורידים את הרמות; בחלון הכיתה הכפתור הראשון הוא הכיתה הנוכחית', async () => {
  const storage = learnersStore([{ id: 'a1', name: 'יוסי', grade: 5 }]);
  storage['math:progress:a1'] = JSON.stringify({ topics: { add: { level: 6, correct: 10, total: 10 }, frac: { level: 4, correct: 5, total: 5 } } });
  const app = makeApp({ storage, dialog: { prompt: ['יוסי', solveAdult, 'יוסי', solveAdult], choose: [1, 5] } });
  app.click('edit-learner', { id: 'a1' });
  await app.settle();
  assert.equal(app.chooseCalls[0][0].value, 5, 'Enter משאיר את הכיתה');
  assert.match(app.view().innerHTML, /כיתה א&#39;/);
  app.click('edit-learner', { id: 'a1' });
  await app.settle();
  assert.match(app.view().innerHTML, /רמה 6 מתוך 6/);
  assert.match(app.view().innerHTML, /רמה 4 מתוך 4/);
});

test('f128: המשך של אתגר שהסתיים לא מחליף שאלה באתגר חדש', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  app.click('timed-start');
  app.advance(59500);
  app.el('ans').value = '99999';
  app.click('check');
  app.advance(550); // הזמן נגמר
  assert.match(app.view().innerHTML, /הזמן נגמר/);
  app.click('timed-start');
  const writes = app.view().writes, html = app.view().innerHTML;
  app.advance(800); // ה-setTimeout הישן (1.1 שניות אחרי הטעות) עובר כאן
  assert.equal(app.view().writes, writes, 'השאלה של האתגר החדש לא הוחלפה');
  assert.equal(app.view().innerHTML, html);
});

test('f129: אתגר דקה שנעצר בלי תשובה לא נרשם', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 3 }]) });
  app.click('timed-start');
  app.click('timed-stop');
  const p = M.sanitizeProgress(M.safeParse(app.store['math:progress:a1']));
  assert.deepEqual(p.days, []);
  assert.deepEqual(p.sessions, []);
  assert.match(app.view().innerHTML, /לא נרשם/);
});

test('f130: דף עבודה — מקום התשובה במקום ה-? (אחוזים: "= ____%", מספר חסר: "____ × 7")', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 6 }]) });
  const make = (topic, level) => {
    app.click('tab', { tab: 'sheet' });
    app.el('wsTopic').value = topic; app.el('wsLevel').value = String(level); app.el('wsCount').value = '20'; app.el('wsKey').checked = false;
    app.click('ws-make');
    return app.view().innerHTML;
  };
  const pct = make('pct', 4);
  assert.doesNotMatch(pct, /=%/);
  assert.match(pct, /= <span class="m-blank"><\/span>%/);
  const mul = make('multable', 4);
  const sheet = mul.slice(mul.indexOf('id="sheet"'));
  assert.doesNotMatch(sheet, /q-mark/, 'אין ? קטן בדף');
  assert.match(sheet, /<span class="m-blank"><\/span> × \d+|\d+ × <span class="m-blank"><\/span>/);
});

test('f126 / f122 / f131 / f127: כיוון מונים, שברים לקורא מסך, אזור חי ייעודי ותשובה עם יחידה', () => {
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 5 }]) });
  // f126 — מונה השאלות משמאל לימין
  app.click('start', { topic: 'add' });
  assert.match(app.view().innerHTML, /<span dir="ltr">1 \/ 10<\/span>/);
  // f122 — שבר עם טקסט לקורא מסך, תיבת סימן עם role
  app.click('start', { topic: 'frac' });
  const fr = app.view().innerHTML;
  assert.match(fr, /<span class="fr">.*<span class="m-sr">\d+ חלקי \d+<\/span>/);
  if (fr.includes('q-box')) assert.match(fr, /class="q-box" role="img" aria-label=/);
  // f127 + f131 — תשובה שגויה בשאלה מילולית
  app.click('start', { topic: 'word' });
  app.el('ans').value = '99999';
  app.click('check');
  const fb = app.el('feedback').innerHTML;
  assert.match(fb, /התשובה הנכונה: <b><span class="expr" dir="ltr">\d+<\/span>(?: [א-ת]+| ₪)/);
  assert.match(app.el('live').textContent, /^לא נכון\. התשובה הנכונה: \d+/);
  // f126 — טבלת ההתקדמות ומונה התגים
  app.click('tab', { tab: 'progress' });
  assert.match(app.view().innerHTML, /רמה <span dir="ltr">\d+ \/ \d+<\/span>/);
  assert.match(app.view().innerHTML, /ss-badge-warning"><span dir="ltr">\d+ \/ \d+<\/span>/);
});

test('f131: התוכן הראשי אינו אזור חי; יש אזור חי קטן להודעות', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const main = html.match(/<main[^>]*>/)[0];
  assert.doesNotMatch(main, /aria-live/);
  assert.match(html, /<div class="m-sr" id="live" role="status" aria-live="polite"><\/div>/);
});

test('f138: הדפסה בערכה כהה — צבעי הטקסט והקווים בדף העבודה חוזרים לכהים', () => {
  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  const sheet = print.slice(print.indexOf('.m-sheet'));
  for (const v of ['--ss-text', '--ss-text-2', '--ss-navy-2', '--ss-border', '--ss-success-ink']) assert.match(sheet, new RegExp(v + ':\\s*(var\\(--ss-side-top\\)|color-mix)'), v);
  assert.doesNotMatch(print, /#[0-9a-f]{3,8}\b/i);
});

test('f82: משוואות — "x = 12" מתקבל כמו "12", ולפני השדה מוצג "x ="', () => {
  const q = M.generate('eq', 3, { random: M.seeded(4), grade: 8 });
  const x = q.answerText.replace('−', '-');
  for (const inp of [x, 'x = ' + x, 'x=' + x, 'X =' + x, '\u200Fx = ' + x]) assert.equal(M.checkAnswer(q, inp).status, 'correct', inp);
  assert.equal(M.checkAnswer(q, 'x = ' + (Number(x) + 1)).status, 'wrong');
  assert.equal(M.checkAnswer(q, 'y = ' + x).status, 'unparsed');
  // בנושא אחר "x =" אינו תשובה
  const a = M.generate('add', 1, { random: M.seeded(1), grade: 1 });
  assert.equal(M.checkAnswer(a, 'x = ' + a.answerText).status, 'unparsed');
  const app = makeApp({ storage: learnersStore([{ id: 'a1', name: 'יוסי', grade: 8 }]) });
  app.click('start', { topic: 'eq' });
  assert.match(app.view().innerHTML, /id="ans"[^>]*><span class="m-unit" dir="ltr">x =<\/span>/);
  app.el('ans').value = 'x = שלוש';
  app.click('check');
  assert.match(app.el('hint').textContent, /x שווה לו/);
});
