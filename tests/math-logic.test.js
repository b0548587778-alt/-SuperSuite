// מודול החשבון — לוגיקה טהורה (modules/math/logic.js): מחוללים לכל נושא, שברים, פענוח תשובות,
// רמה מסתגלת, ונתונים פגומים באחסון.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../modules/math/logic.js');

const SEEDS = 150;
const F = (n, d) => M.frac(n, d);
const Q = (q, s) => M.checkAnswer(q, s).status;

// כל שילוב נושא × כיתה × רמה מותרת × זרעים
function* allQuestions(seeds = SEEDS) {
  for (const t of M.TOPICS) {
    for (let g = 1; g <= 8; g++) {
      const max = M.maxLevelFor(t.id, g);
      for (let lv = 1; lv <= max; lv++) {
        const R = M.seeded(1000 * g + 17 * lv + t.id.length);
        for (let i = 0; i < seeds; i++) yield { q: M.generate(t.id, lv, { grade: g, random: R }), grade: g, level: lv };
      }
    }
  }
}
// הערכה עצמאית של ביטוי שלם (בלי סוגריים) — לבדיקה הצולבת
function intEval(a, op, b) { return op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a / b; }

test('gcd / lcm / frac reduce', () => {
  assert.equal(M.gcd(12, 18), 6);
  assert.equal(M.gcd(0, 5), 5);
  assert.equal(M.gcd(-8, 12), 4);
  assert.equal(M.lcm(4, 6), 12);
  assert.deepEqual(F(6, 8), { n: 3, d: 4 });
  assert.deepEqual(F(3, -9), { n: -1, d: 3 });
  assert.deepEqual(F(0, 7), { n: 0, d: 1 });
  assert.throws(() => F(1, 0));
  assert.throws(() => F(1.5, 2));
  assert.equal(M.isReduced(3, 4), true);
  assert.equal(M.isReduced(6, 8), false);
});

test('fraction compare / add / sub / mixed / decimal strings are exact', () => {
  assert.equal(M.fracCompare(F(1, 2), F(2, 4)), 0);
  assert.equal(M.fracCompare(F(2, 3), F(3, 4)), -1);
  assert.equal(M.fracCompare(F(5, 6), F(4, 5)), 1);
  assert.deepEqual(M.fracAdd(F(1, 2), F(1, 3)), { n: 5, d: 6 });
  assert.deepEqual(M.fracAdd(F(1, 4), F(3, 4)), { n: 1, d: 1 });
  assert.deepEqual(M.fracSub(F(3, 4), F(1, 6)), { n: 7, d: 12 });
  // 0.1 + 0.2 = 0.3 בדיוק (לא נקודה צפה)
  assert.ok(M.fracEq(M.fracAdd(F(1, 10), F(2, 10)), F(3, 10)));
  assert.equal(M.mixedStr(F(7, 2)), '3 1/2');
  assert.equal(M.mixedStr(F(4, 2)), '2');
  assert.equal(M.decStr(F(5, 2)), '2.5');
  assert.equal(M.decStr(F(1, 3)), null);
  assert.equal(M.fmtMoney(1350), '13.50 ₪');
  assert.equal(M.fmtMoney(1200), '12 ₪');
});

test('parseNumber normalises user input', () => {
  const eq = (s, n, d) => assert.deepEqual(M.parseNumber(s), { n, d }, s);
  eq('3/4', 3, 4);
  eq(' 12 ', 12, 1);
  eq('1,000', 1000, 1);
  eq('12,345.5', 24691, 2);
  eq('2.50', 5, 2);
  eq('.5', 1, 2);
  eq('2,5', 5, 2);
  eq('1 1/2', 3, 2);
  eq('6/8', 3, 4);
  eq('−7', -7, 1);
  eq('13.50 ₪', 27, 2);
  eq('‏42‎', 42, 1);
  for (const bad of ['', '   ', 'abc', '3/0', '1/2/3', '1 5/3', '1..2', null, undefined, '9'.repeat(20)]) assert.equal(M.parseNumber(bad), null, String(bad));
  assert.deepEqual(M.parseDivRem('7 ש 2'), { q: 7, r: 2 });
  assert.deepEqual(M.parseDivRem('7 שארית 2'), { q: 7, r: 2 });
  assert.deepEqual(M.parseDivRem('7 (2)'), { q: 7, r: 2 });
  assert.deepEqual(M.parseDivRem('7 r 2'), { q: 7, r: 2 });
  assert.deepEqual(M.parseDivRem(' 9 '), { q: 9, r: 0 });
  assert.equal(M.parseDivRem('x'), null);
  assert.equal(M.parseChoice(' > '), '>');
  assert.equal(M.parseChoice('?'), null);
});

test('checkAnswer: exact equivalence, reduced form, unparsed is not a mistake', () => {
  const q = { kind: 'number', answer: F(3, 4), requireReduced: true };
  assert.equal(Q(q, '3/4'), 'correct');
  assert.equal(Q(q, '0.75'), 'correct');
  assert.equal(Q(q, '6/8'), 'not-reduced');
  assert.equal(Q(q, '2/3'), 'wrong');
  assert.equal(Q(q, 'שלושה רבעים'), 'unparsed');
  const big = { kind: 'number', answer: F(1000, 1) };
  assert.equal(Q(big, '1,000'), 'correct');
  assert.equal(Q(big, ' 1000 '), 'correct');
  const dr = { kind: 'divrem', answer: { q: 6, r: 3 } };
  assert.equal(Q(dr, '6 ש 3'), 'correct');
  assert.equal(Q(dr, '6'), 'wrong');
  assert.equal(Q({ kind: 'divrem', answer: { q: 6, r: 0 } }, '6'), 'correct');
  assert.equal(Q({ kind: 'choice', answer: '<' }, '<'), 'correct');
  assert.equal(Q({ kind: 'choice', answer: '<' }, '>'), 'wrong');
  assert.equal(Q(null, '1'), 'unparsed');
});

test('every topic: generated answers are correct (independent recomputation) for many seeds', () => {
  let count = 0;
  for (const { q, grade } of allQuestions()) {
    count++;
    const d = q.data, ctx = q.topic + ' ' + (q.expr || q.prompt);
    assert.ok(q.answer, ctx);
    assert.ok(Array.isArray(q.steps) && q.steps.length > 0, 'steps ' + ctx);
    assert.ok(q.answerText, ctx);
    // התשובה שמוצגת מתקבלת בבדיקה (הקלדה של answerText בלי יחידה)
    if (q.kind === 'number') {
      const typed = String(q.answerText).replace(/\s*\(.*\)$/, '').replace(/ ₪$| ספרים$| [א-ת]+$/, '').replace(/%$/, '');
      assert.equal(Q(q, typed), 'correct', 'answerText accepted: ' + ctx + ' → ' + typed);
      assert.ok(M.isReduced(q.answer.n, q.answer.d), 'answer reduced ' + ctx);
    }
    switch (q.topic) {
      case 'add': assert.ok(M.fracEq(q.answer, F(d.a + d.b))); break;
      case 'sub': assert.ok(M.fracEq(q.answer, F(d.a - d.b))); assert.ok(d.a - d.b >= 0, 'no negatives ' + ctx); break;
      case 'multable': assert.ok(M.fracEq(q.answer, F(d.missing === 'a' ? d.a : d.missing === 'b' ? d.b : d.a * d.b))); assert.ok(d.a >= 1 && d.a <= 10 && d.b >= 1 && d.b <= 10); break;
      case 'longmul': assert.ok(M.fracEq(q.answer, F(d.a * d.b))); break;
      case 'div':
        assert.equal(d.N, d.d * d.q + d.r, ctx); assert.ok(d.r >= 0 && d.r < d.d, 'remainder < divisor ' + ctx);
        if (q.kind === 'divrem') assert.deepEqual(q.answer, { q: d.q, r: d.r });
        else { assert.equal(d.r, 0, 'exact division ' + ctx); assert.ok(M.fracEq(q.answer, F(d.q))); }
        break;
      case 'order': {
        const r = M.evalExpr(d.expr); assert.ok(r && M.fracEq(q.answer, F(r.value)), ctx);
        assert.ok(r.value >= 0 && Number.isInteger(r.value)); break;
      }
      case 'frac':
        if (d.kind === 'simplify') assert.ok(M.fracEq(q.answer, F(d.n, d.d)) && q.requireReduced);
        else if (q.kind === 'choice') assert.equal(q.answer, ['<', '=', '>'][M.fracCompare(d.a, d.b) + 1]);
        else if (d.kind === 'ofQty') assert.ok(M.fracEq(q.answer, F(d.q * d.n, d.d)));
        else { const r = d.op === '+' ? M.fracAdd(d.a, d.b) : M.fracSub(d.a, d.b); assert.ok(M.fracEq(q.answer, r)); assert.ok(r.n >= 0, 'no negative fractions ' + ctx); }
        break;
      case 'dec':
        if (q.kind === 'choice') assert.equal(q.answer, ['<', '=', '>'][M.fracCompare(d.a, d.b) + 1]);
        else if (d.op) { const r = d.op === '+' ? M.fracAdd(d.a, d.b) : M.fracSub(d.a, d.b); assert.ok(M.fracEq(q.answer, r)); assert.ok(r.n >= 0); }
        else if (d.m) assert.ok(M.fracEq(q.answer, M.fracMul(d.a, F(d.m))));
        else if (d.b) assert.ok(M.fracEq(q.answer, M.fracMul(d.a, F(d.b))));
        else assert.ok(M.fracEq(q.answer, M.fracDiv(d.N, F(d.d))));
        assert.notEqual(M.decStr(q.kind === 'choice' ? d.a : q.answer), null, 'terminating decimal ' + ctx);
        break;
      case 'pct':
        if (d.base != null) assert.ok(M.fracEq(q.answer, F(d.base * d.p, 100)));
        else if (d.price != null) assert.ok(M.fracEq(q.answer, F(d.price * (100 - d.p), 100)));
        else assert.ok(M.fracEq(F(d.a * 100, d.b), q.answer));
        assert.equal(q.answer.d, 1, 'integer percent answer ' + ctx);
        break;
      case 'word':
        if (d.op === 'two') assert.ok(q.answer.n >= 0 && q.answer.d === 1);
        else { const sym = { add: '+', sub: '-', mul: '×', div: '÷' }[d.op]; const v = intEval(d.a, sym, d.b); assert.ok(Number.isInteger(v) && v >= 0, ctx); assert.ok(M.fracEq(q.answer, F(v))); }
        break;
      case 'round':
        if (d.unit) { assert.ok(M.fracEq(q.answer, F(M.roundInt(d.n, d.unit)))); assert.ok(Math.abs(q.answer.n - d.n) <= d.unit / 2); }
        else { const step = d.toTenth ? F(1, 10) : F(1); const diff = M.fracSub(d.a, q.answer); assert.ok(M.fracCompare(F(Math.abs(diff.n), diff.d), M.fracMul(step, F(1, 2))) <= 0, ctx); }
        break;
      case 'money':
        assert.ok(q.answer.n >= 0, ctx);
        // כסף — עד אגורה, לא שברירי אגורה
        assert.equal(100 % q.answer.d, 0, 'whole agorot ' + ctx);
        if (d.bill && d.price) assert.ok(M.fracEq(q.answer, F(d.bill * 100 - d.price, 100)));
        break;
    }
  }
  assert.ok(count > 20000, 'covered ' + count);
});

test('grade ranges: first grade stays small, no negative results for low grades', () => {
  for (const { q, grade } of allQuestions(200)) {
    if (grade > 2) continue;
    if (q.kind === 'number') assert.ok(q.answer.n >= 0, 'negative ' + q.expr);
    if (grade === 1 && (q.topic === 'add' || q.topic === 'sub')) {
      assert.ok(q.data.a <= 20 && q.data.b <= 20 && q.answer.n <= 20, 'grade 1 within 20: ' + q.expr);
    }
    if (grade === 1 && (q.topic === 'word' || q.topic === 'money')) assert.ok(q.answer.n <= 20 && q.answer.d === 1, q.prompt);
    if (grade === 2 && q.topic === 'add') assert.ok(q.answer.n < 100, q.expr);
  }
  // נושאים שעוד לא נלמדו בכיתה
  assert.equal(M.maxLevelFor('pct', 1), 0);
  assert.equal(M.maxLevelFor('frac', 2), 0);
  assert.ok(M.topicsForGrade(1).every(t => ['add', 'sub', 'word', 'money'].includes(t.id)));
  assert.equal(M.topicsForGrade(8).length, M.TOPICS.length);
  // הכיתה מגבילה רמה גבוהה שהתבקשה
  const q = M.generate('add', 6, { grade: 1, random: M.seeded(1) });
  assert.ok(q.level <= 2 && q.answer.n <= 20);
});

test('carrying / borrowing levels and step-by-step explanations', () => {
  const R = M.seeded(42);
  for (let i = 0; i < 300; i++) {
    const a3 = M.generate('add', 3, { random: R }); assert.equal(a3.data.carry, false, a3.expr);
    const a4 = M.generate('add', 4, { random: R }); assert.equal(a4.data.carry, true, a4.expr);
    const s3 = M.generate('sub', 3, { random: R }); assert.equal(s3.data.borrow, false, s3.expr);
    const s4 = M.generate('sub', 4, { random: R }); assert.equal(s4.data.borrow, true, s4.expr);
    assert.ok(a4.steps.some(s => s.includes('מעבירים 1')), 'carry explained');
    assert.ok(s4.steps.some(s => s.includes('פורטים')), 'borrow explained');
  }
  // צמצום — מרמה 3 (כיתה ד'); רמה 1 היא שבר מכמות והשוואת שברי יחידה (סקירה 11.2026, f49)
  const fr = M.seeded(5), f = Array.from({ length: 40 }, () => M.generate('frac', 3, { random: fr })).find(q => q.requireReduced);
  assert.ok(f && f.steps.join(' ').includes('מחלק'));
  // ⟦...⟧ מאוזנים בכל ההסברים
  for (const { q } of allQuestions(5)) for (const s of q.steps) assert.equal((s.match(/⟦/g) || []).length, (s.match(/⟧/g) || []).length, s);
});

test('order of operations evaluator', () => {
  assert.equal(M.evalExpr('2 + 3 × 4').value, 14);
  assert.equal(M.evalExpr('(2 + 3) × 4').value, 20);
  assert.equal(M.evalExpr('20 ÷ 4 − 3').value, 2);
  assert.equal(M.evalExpr('((1 + 2) × 4 − 2) ÷ 5').value, 2);
  assert.equal(M.evalExpr('7 ÷ 2'), null, 'non-exact division rejected');
  assert.equal(M.evalExpr('2 − 5'), null, 'negative rejected');
  assert.deepEqual(M.evalExpr('2 + 3 × 4').seq, ['2 + 3 × 4', '2 + 12', '14']);
});

test('generation is deterministic with an injected random and handles a bad random', () => {
  const a = M.generateSet('frac', 4, 20, { random: M.seeded(7) }).map(q => q.expr);
  const b = M.generateSet('frac', 4, 20, { random: M.seeded(7) }).map(q => q.expr);
  assert.deepEqual(a, b);
  const set = M.generateSet('longmul', 3, 30, { random: M.seeded(3) });
  assert.equal(new Set(set.map(q => q.expr)).size, 30, 'no duplicates in a worksheet');
  for (const t of M.TOPIC_IDS) {
    for (const bad of [() => 1, () => NaN, () => -3, 'x']) {
      const q = M.generate(t, 9, { random: bad });
      assert.ok(q.answer, t);
    }
  }
  assert.throws(() => M.generate('nope', 1, {}));
  // עובדת כפל מסוימת
  const q = M.generate('multable', 3, { fact: [7, 8], random: M.seeded(1) });
  assert.equal(q.answer.n, 56);
});

test('adaptive level: up after a streak, down after mistakes, clamped to grade', () => {
  let s = M.newTopicState('add', 2);
  assert.equal(s.level, 2);
  for (let i = 0; i < M.UP_AFTER; i++) s = M.updateAdaptive(s, true, 'add', 2).state;
  assert.equal(s.level, 3);
  for (let i = 0; i < 30; i++) s = M.updateAdaptive(s, true, 'add', 2).state;
  assert.equal(s.level, 4, 'grade 2 caps addition at level 4');
  assert.equal(s.best, 33);
  let r = M.updateAdaptive(s, false, 'add', 2); assert.equal(r.change, 0); s = r.state;
  r = M.updateAdaptive(s, false, 'add', 2); assert.equal(r.change, -1); s = r.state;
  assert.equal(s.level, 3);
  assert.equal(s.total, 35); assert.equal(s.correct, 33);
  // לא יורד מתחת ל-1
  let low = { level: 1, streak: 0, miss: 0, correct: 0, total: 0, best: 0 };
  for (let i = 0; i < 6; i++) low = M.updateAdaptive(low, false, 'sub', 1).state;
  assert.equal(low.level, 1);
  // תשובה נכונה מאפסת את מונה הטעויות
  let m = M.updateAdaptive({ level: 3, miss: 1 }, true, 'add', 5).state;
  m = M.updateAdaptive(m, false, 'add', 5).state;
  assert.equal(m.level, 3);
  assert.equal(M.clampLevel('add', 1, 99), 2);
  assert.equal(M.clampLevel('pct', 1, 3), 0);
  assert.equal(M.clampLevel('add', 4, 'x'), 1);
});

test('multiplication facts: status, recording and weak-first picking', () => {
  let f = {};
  assert.equal(M.factStatus(f['7x8']), 'new');
  f = M.recordFact(f, 8, 7, true);
  assert.equal(M.factStatus(f['7x8']), 'learning');
  f = M.recordFact(f, 7, 8, true); f = M.recordFact(f, 7, 8, true);
  assert.equal(M.factStatus(f['7x8']), 'mastered');
  f = M.recordFact(f, 7, 8, false);
  assert.equal(M.factStatus(f['7x8']), 'weak');
  f = M.recordFact(f, 6, 9, false);
  const picked = M.pickFacts(f, 10, M.seeded(2));
  assert.equal(picked.length, 10);
  assert.deepEqual(picked.slice(0, 2).map(x => M.factKey(x[0], x[1])).sort(), ['6x9', '7x8']);
  const sum = M.factSummary(f);
  assert.equal(sum.total, 55); assert.equal(sum.weak, 2);
});

test('sessions, stars, day streak and badges', () => {
  assert.equal(M.starsFor(10, 10), 3); assert.equal(M.starsFor(7, 10), 2); assert.equal(M.starsFor(5, 10), 1); assert.equal(M.starsFor(2, 10), 0); assert.equal(M.starsFor(0, 0), 0);
  assert.equal(M.dayStreak(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-03'), 3);
  assert.equal(M.dayStreak(['2026-03-01', '2026-03-02'], '2026-03-03'), 2, 'yesterday keeps the streak');
  assert.equal(M.dayStreak(['2026-03-01'], '2026-03-03'), 0);
  assert.equal(M.dayStreak(['2026-02-28', '2026-03-01'], '2026-03-01'), 2, 'across month end');
  let p = M.emptyProgress();
  p.topics.add = { level: 2, streak: 0, miss: 0, correct: 10, total: 10, best: 10 };
  let r = M.recordSession(p, { mode: 'practice', topic: 'add', total: 10, correct: 10, level: 2 }, '2026-03-01');
  assert.equal(r.stars, 3); p = r.progress;
  p = M.recordSession(p, { mode: 'timed', topic: 'multable', total: 25, correct: 21 }, '2026-03-02').progress;
  p = M.recordSession(p, { mode: 'practice', topic: 'add', total: 10, correct: 4 }, '2026-03-03').progress;
  assert.equal(p.stars, 6);
  assert.equal(p.bestTimed.multable, 21);
  assert.deepEqual(p.days, ['2026-03-01', '2026-03-02', '2026-03-03']);
  const b = M.earnedBadges(p, '2026-03-03');
  for (const id of ['first', 'perfect', 'streak10', 'days3', 'timed20']) assert.ok(b.includes(id), id);
  assert.ok(!b.includes('days7') && !b.includes('factsAll'));
  // לא מקלקל את המקור
  assert.equal(M.emptyProgress().sessions.length, 0);
});

test('malformed stored data is reset gracefully', () => {
  for (const raw of ['', 'not json', '{', 'null', '[]', '42', '"x"', '{"list":5}', '{"__proto__":{"x":1}}']) {
    const parsed = M.safeParse(raw);
    const l = M.sanitizeLearners(parsed);
    assert.deepEqual(l.list, []); assert.equal(l.active, null);
    const p = M.sanitizeProgress(parsed);
    assert.deepEqual(p, M.emptyProgress());
  }
  assert.equal(M.safeParse(undefined), null);
  const l = M.sanitizeLearners({ active: 'zzz', list: [
    { id: 'a1', name: '  יוסי  ', grade: 3 }, { id: 'a1', name: 'כפול', grade: 2 }, { id: 'bad id!', name: 'x', grade: 1 },
    { id: 'b2', name: '', grade: 4 }, { id: 'c3', name: 'רבקה'.repeat(20), grade: 99 }, null, 'str', { id: 'd4', name: '<img src=x>', grade: '5' }
  ] });
  assert.deepEqual(l.list.map(x => x.id), ['a1', 'c3', 'd4']);
  assert.equal(l.list[0].name, 'יוסי');
  assert.equal(l.list[1].grade, 1, 'out of range grade → 1');
  assert.ok(l.list[1].name.length <= 30);
  assert.equal(l.list[2].grade, 5);
  assert.equal(l.active, 'a1', 'unknown active → first');
  const p = M.sanitizeProgress({
    topics: { add: { level: 99, correct: 50, total: 10, streak: -4 }, evil: { level: 1 }, sub: 'x' },
    facts: { '7x8': { c: '3', w: -1, last: 1 }, '8x7': { c: 9 }, 'x': 1 },
    sessions: [{ day: '2026-13-45', total: 1 }, { day: '2026-02-31' }, { day: '2026-03-01', mode: 'hack', topic: 'zz', total: 5, correct: 9, stars: 9 }, 7],
    days: ['2026-03-01', '2026-03-01', 'bad', 5], stars: -3, bestTimed: { add: 'NaN', zz: 4 }
  });
  assert.deepEqual(Object.keys(p.topics), ['add']);
  assert.equal(p.topics.add.level, 6);
  assert.equal(p.topics.add.correct, 10, 'correct ≤ total');
  assert.equal(p.topics.add.streak, 0);
  assert.deepEqual(p.facts, { '7x8': { c: 3, w: 0, last: 1 } });
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(p.sessions[0], { day: '2026-03-01', at: 0, mode: 'practice', topic: 'multable', total: 5, correct: 5, stars: 3, level: 0 });
  assert.deepEqual(p.days, ['2026-03-01']);
  assert.equal(p.stars, 0);
  assert.deepEqual(p.bestTimed, { add: 0 });
  // נתונים מנוקים עוברים דרך הלוגיקה בלי לקרוס
  assert.doesNotThrow(() => { M.earnedBadges(p, '2026-03-02'); M.totals(p); M.factSummary(p.facts); });
});

test('module contract: CSP, scripts, storage keys, no network / eval / native dialogs / hex colours', () => {
  const dir = path.join(__dirname, '..', 'modules', 'math');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const tools = fs.readFileSync(path.join(__dirname, '..', 'modules', 'tools', 'index.html'), 'utf8');
  const csp = s => (s.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/) || [])[0];
  assert.equal(csp(html), csp(tools));
  assert.match(html, /<html lang="he" dir="rtl">/);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts[0][0], '<script src="/screen-guard.js"></script>');
  for (const s of scripts) { assert.match(s[0], /src="/); assert.equal(s[1].trim(), '', 'no inline script'); assert.doesNotMatch(s[0], /type="module"/); }
  assert.match(html, /<script src="\/ss-dialog\.js"><\/script>/);
  assert.ok(html.indexOf('/design-tokens.css') < html.indexOf('/ui-kit.css'));
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline handlers');
  const code = ['logic.js', 'app.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\beval\s*\(/, /new Function/, /window\.open/, /https?:\/\//, /(^|[^.\w])(alert|confirm|prompt)\s*\(/m, /indexedDB/]) assert.doesNotMatch(code, re, String(re));
  for (const m of code.matchAll(/LS\.(?:read|write|remove)\(([^)]*)\)/g)) assert.match(m[1], /^(KEY_|keyProgress)/, m[0]);
  assert.match(code, /'math:learners'/); assert.match(code, /'math:progress:'/);
  const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8') + (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'tokens only');
  // תוכן הולם — אין שמות לועזיים בשאלות
  assert.match(code, /שרה'לה/); assert.match(code, /צדקה/);
});
