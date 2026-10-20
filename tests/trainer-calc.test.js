// מודול האימונים (PLAN.md 6.3): חישובי גוף, מחולל התוכניות, ושמירה ושחזור — על קוד המקור (modules-src/trainer)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'modules-src', 'trainer', 'src');
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
let P, N, C, Kn, Co, E, Db;
test.before(async () => {
  [P, N, C, Kn, Co, E, Db] = await Promise.all(['lib/program.js', 'data/nutrition.js', 'data/cardio.js', 'data/knowledge.js',
    'data/constants.js', 'data/exercises.js', 'lib/db.js'].map(load));
});

// אקראיות קבועה (mulberry32) — אותה תוכנית בכל הרצה
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ALL_EQ = () => Co.EQUIPMENT.map(e => e.id);
const client = (over = {}) => ({ goal: 'health', level: 'intermediate', daysPerWeek: 3, medical: [], equipment: ALL_EQ(), ...over });
const exById = (id) => E.EXERCISES.find(e => e.id === id);
const picked = (prog) => prog.days.flatMap(d => d.exercises.map(x => exById(x.exerciseId)));

test('BMR (Mifflin-St Jeor), TDEE ויעד קלוריות', () => {
  assert.equal(N.calculateBMR({ weight: 80, height: 180, age: 30, gender: 'male' }), 1780);
  assert.equal(N.calculateBMR({ weight: 60, height: 165, age: 40, gender: 'female' }), 1270); // 600+1031.25-200-161
  assert.equal(N.calculateBMR({ weight: 80, height: 180, age: 0 }), 0, 'נתון חסר — 0, לא NaN');
  assert.equal(N.calculateTDEE(1780, 1.55), 2759);
  assert.equal(N.calculateGoalCalories(2759, 'weight-loss'), 2259);
  assert.equal(N.calculateGoalCalories(2759, 'muscle'), 3059);
  assert.equal(N.calculateGoalCalories(2759, 'לא-קיים'), 2759);
  // לכל רמת פעילות במסך יש מכפיל סביר
  for (const a of Co.ACTIVITY_LEVELS) assert.ok(a.mult >= 1.2 && a.mult <= 1.9, a.id);
});

test('חלוקת חלבון/שומן/פחמימה: סכום הקלוריות שווה ליעד (עד עיגול)', () => {
  for (const goal of Co.GOALS.map(g => g.id)) {
    const m = N.calculateMacros(2400, 75, goal);
    const kcal = m.protein * 4 + m.carbs * 4 + m.fat * 9;
    assert.ok(Math.abs(kcal - 2400) <= 10, `${goal}: ${kcal}`);
    assert.ok(m.protein > 0 && m.carbs > 0 && m.fat > 0, goal);
  }
  assert.equal(N.calculateMacros(2000, 80, 'muscle').protein, 160, '2 גרם לק"ג');
  assert.equal(N.calculateMacros(2000, 80, 'health').protein, 128, '1.6 גרם לק"ג');
});

test('דופק מרבי (Tanaka) ואזורי דופק', () => {
  assert.equal(C.calculateMaxHR(30), 187);
  assert.equal(C.calculateMaxHR(60), 166);
  assert.deepEqual(C.calculateZoneHR(187, 2), { min: 112, max: 131 });
  assert.equal(C.calculateZoneHR(187, 9), null);
  // האזורים רציפים, עולים, ובין 50% ל-100%
  const z = C.HEART_RATE_ZONES;
  assert.equal(z[0].pctMin, 50);
  assert.equal(z[z.length - 1].pctMax, 100);
  for (let i = 1; i < z.length; i++) assert.equal(z[i].pctMin, z[i - 1].pctMax);
});

test('1RM (Brzycki) וטבלת האחוזים', () => {
  assert.equal(Kn.calculate1RM(100, 1), 100);
  assert.equal(Kn.calculate1RM(100, 5), 113);
  assert.equal(Kn.calculate1RM(100, 10), 133);
  assert.equal(Kn.calculate1RM(100, 13), null, 'מעל 12 חזרות הנוסחה לא מדויקת');
  assert.equal(Kn.calculate1RM(0, 5), null);
  assert.equal(Kn.calculate1RM(100, 0), null);
  const t = Kn.calculatePercentages(113);
  assert.equal(t[0].weight, 113);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].pct < t[i - 1].pct && t[i].weight <= t[i - 1].weight);
  assert.deepEqual(Kn.calculatePercentages(null), []);
});

test('BMI וקטגוריה', () => {
  assert.equal(P.calcBMI(180, 81), '25.0');
  assert.equal(P.calcBMI(0, 80), null);
  assert.equal(P.bmiCategory('18.4'), 'תת-משקל');
  assert.equal(P.bmiCategory('24.9'), 'תקין');
  assert.equal(P.bmiCategory('25.0'), 'עודף משקל');
  assert.equal(P.bmiCategory('30'), 'השמנה');
  assert.equal(P.bmiCategory(null), '');
});

test('נתוני התרגילים: כל התוויית נגד וכל ציוד מוכרים', () => {
  const med = new Set(Co.MEDICAL_CONDITIONS.map(c => c.id));
  const eq = new Set(ALL_EQ());
  const ids = new Set();
  for (const ex of E.EXERCISES) {
    assert.ok(!ids.has(ex.id), 'מזהה כפול: ' + ex.id); ids.add(ex.id);
    for (const c of [...ex.contra, ...(ex.cautions || [])]) assert.ok(med.has(c), `${ex.id}: מצב לא מוכר ${c}`);
    for (const e of ex.eq) assert.ok(eq.has(e), `${ex.id}: ציוד לא מוכר ${e}`);
  }
  for (const g of Co.GOALS) assert.ok(E.GOAL_PARAMS[g.id], 'פרמטרים למטרה: ' + g.id);
});

test('מחולל: תרגיל עם התוויית נגד לא מוצע למתאמן עם המצב הזה — לכל מצב, מטרה ומספר ימים', () => {
  let n = 0;
  for (const cond of Co.MEDICAL_CONDITIONS) {
    for (const goal of Co.GOALS.map(g => g.id)) {
      for (const days of [2, 3, 4, 5]) {
        for (let seed = 1; seed <= 5; seed++) {
          const c = client({ medical: [cond.id], goal, daysPerWeek: days });
          for (const ex of picked(P.generateProgram(c, { random: seeded(seed) }))) {
            assert.ok(!ex.contra.includes(cond.id), `${cond.id} / ${goal} / ${days}: ${ex.id}`);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 1000, 'נבדקו מספיק תרגילים: ' + n);
  // כמה מצבים יחד
  const multi = client({ medical: ['back', 'knee', 'shoulder', 'disc'], daysPerWeek: 4 });
  for (const ex of picked(P.generateProgram(multi, { random: seeded(7) }))) assert.deepEqual(ex.contra.filter(c => multi.medical.includes(c)), [], ex.id);
});

test('מחולל: רק ציוד שיש למתאמן, ולמתחיל אין תרגיל מתקדם', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const c = client({ equipment: ['bw', 'bands'], level: 'beginner', daysPerWeek: 1 + (seed % 5) });
    for (const ex of picked(P.generateProgram(c, { random: seeded(seed) }))) {
      assert.ok(ex.eq.some(e => c.equipment.includes(e)), ex.id);
      assert.notEqual(ex.lvl, 'advanced', ex.id);
    }
  }
  // filterExercises עצמה
  const only = P.filterExercises(client({ equipment: ['bw'], medical: ['knee'] }));
  assert.ok(only.length > 0);
  assert.ok(only.every(e => e.eq.includes('bw') && !e.contra.includes('knee')));
  assert.deepEqual(P.filterExercises(client({ equipment: [] })), [], 'בלי ציוד — אין תרגילים');
});

test('מחולל: מספר הימים, סטים וחזרות לפי המטרה, בלי תרגיל כפול באותו יום, ותוצאה קבועה לאותו seed', () => {
  for (const days of [1, 2, 3, 4, 5, 6]) {
    const prog = P.generateProgram(client({ daysPerWeek: days }), { random: seeded(3) });
    assert.equal(prog.days.length, Math.min(days, 5), 'ימים: ' + days);
    for (const d of prog.days) {
      assert.ok(d.name && d.exercises.length >= 3, d.name);
      const ids = d.exercises.map(x => x.exerciseId);
      assert.equal(new Set(ids).size, ids.length, 'כפילות ביום ' + d.name);
    }
  }
  const strength = P.generateProgram(client({ goal: 'strength' }), { random: seeded(1) });
  const lift = strength.days[0].exercises.find(x => x.reps);
  assert.equal(lift.sets, 5);
  assert.equal(lift.reps, '3-6');
  assert.equal(lift.rest, 180);
  assert.ok(!strength.days[0].exercises.some(x => x.notes.includes('דקות')), 'כוח — בלי אירובי');
  const loss = P.generateProgram(client({ goal: 'weight-loss' }), { random: seeded(1) });
  assert.ok(loss.days.every(d => d.exercises.some(x => x.duration === 20 * 60)), 'ירידה במשקל — 20 דקות אירובי בכל יום');
  assert.equal(strength.goal, 'strength');
  const a = P.generateProgram(client(), { random: seeded(42) });
  const b = P.generateProgram(client(), { random: seeded(42) });
  assert.deepEqual(a.days, b.days);
});

test('אזהרות רפואיות: לכל מצב שנבחר — אזהרה בעברית', () => {
  const w = P.getMedicalWarnings(client({ medical: ['heart', 'pregnancy'] }));
  assert.deepEqual(w.map(x => x.condition), ['לב', 'הריון']);
  assert.ok(w.every(x => x.warning.length > 10));
  assert.deepEqual(P.getMedicalWarnings(client()), []);
  assert.deepEqual(P.getMedicalWarnings({}), []);
});

test('שמירה ושחזור: S שומר JSON ומחזיר אותו, וכל מפתח של K מוכר לבדיקת השחזור', async () => {
  const mem = new Map();
  global.window = { storage: {
    get: async (k) => (mem.has(k) ? { key: k, value: mem.get(k) } : null),
    set: async (k, v) => { mem.set(k, v); return { key: k, value: v }; },
    delete: async (k) => { mem.delete(k); return { key: k, deleted: true }; },
    list: async (p) => ({ keys: [...mem.keys()].filter(k => k.startsWith(p)) }),
  } };
  try {
    const { S, K } = Db;
    const c = { id: 'c1', name: 'יוסף כהן', medical: ['back'], weight: 82.5 };
    await S.set(K.client('c1'), c);
    await S.set(K.clientIndex, ['c1']);
    assert.deepEqual(await S.get(K.client('c1')), c);
    assert.deepEqual(await S.list('client:'), ['client:c1']);
    await S.del(K.client('c1'));
    assert.equal(await S.get(K.client('c1')), null);
    mem.set('client:bad', '{לא json');
    assert.equal(await S.get('client:bad'), null, 'ערך פגום — null, לא קריסה');

    // כל מפתח שהמודול כותב ייקלט בשחזור (shell/trainer-backup-check.js)
    const { checkTrainerItems, isKnownKey } = require('../shell/trainer-backup-check');
    const keys = Object.values(K).map(k => (typeof k === 'function' ? k('abc') : k));
    for (const k of keys) assert.ok(isKnownKey(k), 'לא ישוחזר: ' + k);
    // רשימות: plans, schedule ו-sessions/measurements/assessments/memberships; השאר — אובייקט
    const items = Object.fromEntries(keys.map(k => [k, JSON.stringify(k === K.clientIndex ? ['abc'] : (/plans|schedule|^(sessions|measurements|assessments|memberships):/.test(k) ? [] : {}))]));
    const r = checkTrainerItems(items);
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally { delete global.window; }
});
