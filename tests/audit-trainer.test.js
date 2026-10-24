'use strict';
// מודול האימונים — תיקונים מבדיקת הקוד 23.10.2026 (docs/CODE-AUDIT-2026-10-23.md): ממצאים 41, 42, 43,
// ושלושת הממצאים הנמוכים: שבת וחג ביומן, parseShekels, 6–7 ימים במחולל ורמת פעילות בתזונה.
// הלוגיקה הטהורה נבדקת מהמקור (ESM דרך import()); את הממשק (JSX) אי אפשר להריץ בלי בנייה — נבדק בקריאת המקור.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'modules-src', 'trainer', 'src');
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const Heb = require('../shell/hebcal');

let N, St, P, M, T, Co;
test.before(async () => {
  [N, St, P, M, T, Co] = await Promise.all(['data/nutrition.js', 'lib/studio.js', 'lib/program.js', 'data/mobility.js',
    'data/program-templates.js', 'data/constants.js'].map(load));
});

// ─── ממצא 41: יעד קלוריות עם רצפה, ובלי מקרו שלילי ───
test('ממצא 41: אישה 50 ק"ג, 150 ס"מ, גיל 60 — לא 672 קלוריות; היעד לא יורד מתחת לרצפה ולא עולה מעל התצרוכת', () => {
  const base = { weight: 50, height: 150, age: 60, gender: 'female', goal: 'weight-loss' };
  const sedentary = N.clientNutrition({ ...base, activityLevel: 'sedentary' });
  assert.equal(sedentary.tdee, 1172);
  assert.equal(sedentary.targetCal, 1172, 'התצרוכת נמוכה מהרצפה — היעד הוא התצרוכת, בלי גירעון (לא 672)');
  assert.equal(sedentary.limited, true);
  const moderate = N.clientNutrition({ ...base, activityLevel: 'moderate' });
  assert.equal(moderate.tdee, 1514);
  assert.equal(moderate.targetCal, N.MIN_CALORIES.female, 'רצפה של 1,200 לאישה');
  assert.equal(moderate.limited, true);
  // גבר — רצפה של 1,500
  assert.deepEqual(N.goalCalories(1800, 'weight-loss', { gender: 'male' }), { calories: 1500, limited: true });
  assert.equal(N.calculateGoalCalories(1800, 'weight-loss'), 1500, 'בלי מין — כמו בחישוב ה-BMR: גבר');
  // בלי הגבלה: כמו קודם
  assert.deepEqual(N.goalCalories(2759, 'weight-loss', { gender: 'male' }), { calories: 2259, limited: false });
  assert.deepEqual(N.goalCalories(1300, 'weight-loss', { gender: 'female' }), { calories: 1200, limited: true });
  // הרצפה לא מכריחה עודף: תצרוכת 1,100 ומטרת בריאות — 1,100
  assert.deepEqual(N.goalCalories(1100, 'health', { gender: 'female' }), { calories: 1100, limited: false });
});

test('ממצא 41: מקרו — חלבון עד 35% מהקלוריות, פחמימות ושומן לעולם לא שליליים, והסכום שווה ליעד', () => {
  // לפני: 150 ק"ג, ירידה במשקל, 1,500 קלוריות — 300 גרם חלבון (1,200 קלוריות) ופחמימות שליליות
  const m = N.calculateMacros(1500, 150, 'weight-loss');
  assert.ok(m.carbs > 0, JSON.stringify(m));
  assert.ok(m.protein * 4 <= 1500 * N.MAX_PROTEIN_SHARE, 'חלבון עד 35%');
  for (const goal of Co.GOALS.map((g) => g.id)) {
    for (const weight of [20, 45, 70, 110, 150, 220, 350]) {
      for (const cal of [0, 800, 1200, 1500, 2200, 3500]) {
        const x = N.calculateMacros(cal, weight, goal);
        assert.ok(x.protein >= 0 && x.carbs >= 0 && x.fat >= 0, `${goal}/${weight}/${cal}: ${JSON.stringify(x)}`);
        const kcal = x.protein * 4 + x.carbs * 4 + x.fat * 9;
        if (cal) assert.ok(Math.abs(kcal - cal) <= 10, `${goal}/${weight}/${cal}: ${kcal}`);
      }
    }
  }
  // קלט מופרך — 0, לא יעד שלילי
  assert.equal(N.calculateBMR({ weight: 20, height: 100, age: 200, gender: 'female' }), 0);
  assert.equal(N.clientNutrition({ weight: 20, height: 100, age: 200, gender: 'female', goal: 'health' }).targetCal, 0);
});

test('ממצא 41: המסך מציג הערה כשהיעד הוגבל — במחשבון, בלשונית המתאמן ובדוח ה-PDF', () => {
  const src = read('features/nutrition.jsx');
  assert.match(src, /goalCalories\(tdee, data\.goal, \{ gender: data\.gender \}\)/, 'המחשבון מעביר את המין');
  assert.match(src, /\{goalInfo\.limited && <CalorieFloorNote \/>\}/);
  assert.match(src, /\{limited && <CalorieFloorNote \/>\}/);
  assert.match(src, /\{limited && \(\s*<div style=/, 'גם בדוח המודפס');
  assert.doesNotMatch(src, /calculateGoalCalories\(/, 'אין חישוב יעד בלי הרצפה');
});

// ─── נמוך: רמת פעילות בתזונה (פעם תמיד ×1.55) ───
test('רמת פעילות: מכרטיס המתאמן; כרטיס ישן — "בינוני" עם סימון; ערך לא מוכר נדחה בטופס', () => {
  const c = { weight: 80, height: 180, age: 30, gender: 'male', goal: 'health' };
  const active = N.clientNutrition({ ...c, activityLevel: 'active' });
  const sedentary = N.clientNutrition({ ...c, activityLevel: 'sedentary' });
  assert.equal(active.tdee, Math.round(1780 * 1.725));
  assert.equal(sedentary.tdee, Math.round(1780 * 1.2));
  assert.equal(active.activity.assumed, false);
  const old = N.clientNutrition(c);
  assert.equal(old.activity.id, 'moderate');
  assert.equal(old.activity.assumed, true, 'המסך מבקש לעדכן בכרטיס');
  assert.equal(old.tdee, Math.round(1780 * 1.55));

  const ok = { age: 30, daysPerWeek: 3, equipment: ['bw'] };
  assert.deepEqual(P.validateClient(ok), [], 'בלי רמת פעילות (כרטיס ישן) — תקין');
  assert.deepEqual(P.validateClient({ ...ok, activityLevel: 'light' }), []);
  assert.ok(P.validateClient({ ...ok, activityLevel: 'xyz' }).some((e) => /רמת הפעילות/.test(e)));

  const form = read('features/clients.jsx');
  assert.match(form, /activityLevel: 'moderate',/, 'מתאמן חדש — ברירת מחדל');
  assert.match(form, /<select value=\{d\.activityLevel \|\| ''\} onChange=\{\(e\) => update\('activityLevel', e\.target\.value\)\}/);
  assert.match(form, /ACTIVITY_LEVELS\.map\(/);
  // התיאור מוצג ליד "ימי אימון בשבוע (עד 6 — בלי שבת)" — לא "6-7 אימונים", וטווחים בלי חפיפה
  for (const a of Co.ACTIVITY_LEVELS) assert.doesNotMatch(a.desc, /7/, `${a.id}: ${a.desc}`);
  const ranges = Co.ACTIVITY_LEVELS.map((a) => a.desc.match(/^(\d+)(?:-(\d+))? אימונים/))
    .filter(Boolean).map((m) => [Number(m[1]), Number(m[2] || m[1])]);
  assert.ok(ranges.length >= 3);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1], JSON.stringify(ranges));
  assert.ok(ranges.every(([, hi]) => hi <= P.MAX_TRAINING_DAYS));
  const tab = read('features/nutrition.jsx');
  assert.match(tab, /= clientNutrition\(client\);/);
  assert.doesNotMatch(tab, /client\.activityLevel \|\| 'moderate'/);
});

// ─── ממצא 42: הקצאת תבנית רק בלחיצה, ועם אישור כשיש תוכנית ───
test('ממצא 42: תוכנית מתבנית — עותק של הימים בלי משקלים, והתבנית עצמה לא משתנה', () => {
  const tpl = T.PROGRAM_TEMPLATES.find((t) => t.id === 'ppl');
  const before = JSON.stringify(tpl);
  const prog = P.programFromTemplate(tpl, new Date(2026, 9, 23, 10));
  assert.equal(prog.templateId, 'ppl');
  assert.equal(prog.daysPerWeek, 6);
  assert.equal(prog.days.length, tpl.days.length);
  assert.ok(prog.days.every((d) => d.exercises.every((e) => e.weight === '')));
  prog.days[0].exercises[0].sets = 99;
  assert.equal(JSON.stringify(tpl), before, 'עותק — לא הפניה לתבנית');
});

// תחליפים ל-S.get / S.set / askConfirm — רושמים כל קריאה, לפי הסדר
function assignFakes({ existing = null, confirmAnswer = true, setResult = true } = {}) {
  const calls = [];
  const store = new Map(existing ? [['program:c1', existing]] : []);
  return {
    calls, store,
    get: async (key) => { calls.push(['get', key]); return store.has(key) ? store.get(key) : null; },
    set: async (key, value) => { calls.push(['set', key]); if (setResult) store.set(key, value); return setResult; },
    askConfirm: async (msg, opts) => { calls.push(['confirm', msg, opts]); return confirmAnswer; },
  };
}

test('ממצא 42: assignTemplate — תוכנית קיימת נדרסת רק אחרי אישור; בלי תוכנית אין שאלה; שמירה שנכשלה = failed', async () => {
  const tpl = T.PROGRAM_TEMPLATES.find((t) => t.id === 'ppl');
  const client = { id: 'c1', name: 'יוסף כהן' };
  const old = { templateId: 'old', days: [{ name: 'ישן', exercises: [] }] };
  const now = new Date(2026, 9, 23, 10);

  // יש תוכנית והמשתמש ביטל — אין שמירה, והתוכנית הישנה נשארת
  let f = assignFakes({ existing: old, confirmAnswer: false });
  assert.equal(await P.assignTemplate({ template: tpl, client, ...f, now }), 'cancelled');
  assert.deepEqual(f.calls.map((c) => c[0]), ['get', 'confirm'], 'set לא נקרא');
  assert.equal(f.store.get('program:c1'), old);
  const [, msg, opts] = f.calls[1];
  assert.match(msg, /יוסף כהן/);
  assert.ok(msg.includes(tpl.name));
  assert.equal(opts.danger, true);

  // יש תוכנית והמשתמש אישר — האישור לפני השמירה, והתוכנית מהתבנית נשמרת במפתח של המתאמן
  f = assignFakes({ existing: old, confirmAnswer: true });
  assert.equal(await P.assignTemplate({ template: tpl, client, ...f, now }), 'saved');
  assert.deepEqual(f.calls.map((c) => c[0]), ['get', 'confirm', 'set']);
  assert.deepEqual(f.store.get('program:c1'), P.programFromTemplate(tpl, now));

  // אין תוכנית — אין שאלה, שמירה ישירה
  f = assignFakes();
  assert.equal(await P.assignTemplate({ template: tpl, client, ...f, now }), 'saved');
  assert.deepEqual(f.calls.map((c) => c[0]), ['get', 'set'], 'confirm לא נקרא');
  assert.equal(f.calls[0][1], 'program:c1');

  // השמירה נכשלה (אחסון מלא, צפייה בלבד) — failed, והמסך לא עובר לכרטיס המתאמן
  f = assignFakes({ setResult: false });
  assert.equal(await P.assignTemplate({ template: tpl, client, ...f, now }), 'failed');
  f = assignFakes({ existing: old, confirmAnswer: true, setResult: false });
  assert.equal(await P.assignTemplate({ template: tpl, client, ...f, now }), 'failed');
  assert.equal(f.store.get('program:c1'), old);

  // מתאמן שלא נמצא — כלום לא נקרא
  f = assignFakes();
  assert.equal(await P.assignTemplate({ template: tpl, client: undefined, ...f, now }), 'cancelled');
  assert.deepEqual(f.calls, []);
});

test('ממצא 42: assignTemplate עם S האמיתי (lib/db.js) — האחסון שדחה את השמירה מחזיר failed', async () => {
  const Db = await load('lib/db.js');
  const mem = new Map();
  let reject = false;
  global.window = { storage: {
    get: async (k) => (mem.has(k) ? { key: k, value: mem.get(k) } : null),
    set: async (k, v) => { if (reject) return null; mem.set(k, v); return { key: k, value: v }; },
  } };
  try {
    const tpl = T.PROGRAM_TEMPLATES[0];
    const client = { id: 'c9', name: 'שמעון לוי' };
    const deps = { get: Db.S.get, set: Db.S.set, askConfirm: async () => true };
    assert.equal(await P.assignTemplate({ template: tpl, client, ...deps }), 'saved');
    assert.equal((await Db.S.get(Db.K.program('c9'))).templateId, tpl.id);
    reject = true;
    assert.equal(await P.assignTemplate({ template: T.PROGRAM_TEMPLATES[1], client, ...deps }), 'failed');
    assert.equal((await Db.S.get(Db.K.program('c9'))).templateId, tpl.id, 'התוכנית הקודמת לא נדרסה');
  } finally { delete global.window; }
});

test('ממצא 42: במסך — רשימת המתאמנים רק בוחרת, ההקצאה בכפתור דרך assignTemplate', () => {
  const src = read('features/templates.jsx');
  assert.equal(src.match(/<select\b/g).length, 1, 'רשימת בחירה אחת (המתאמן)');
  // ב-onChange יש "=>" — לכן לא [^>]*
  const select = src.match(/<select\b[\s\S]*?onChange=\{([^{}]*)\}/);
  assert.ok(select, 'רשימת בחירה');
  assert.doesNotMatch(select[1], /assignToClient|assignTemplate|S\.set/, 'onChange לא שומר (גם מעבר בחצים במקלדת היה דורס)');
  assert.match(select[1], /setAssignTo\(e\.target\.value\)/);
  assert.match(src, /<Btn[^>]*disabled=\{!assignTo\}[^>]*onClick=\{\(\) => assignToClient\(open, assignTo\)\}/);
  const fn = src.slice(src.indexOf('const assignToClient'), src.indexOf('if (printMode && open)'));
  assert.match(fn, /await assignTemplate\(\{ template, client, get: S\.get, set: S\.set, askConfirm \}\)/);
  assert.doesNotMatch(fn, /S\.set\(/, 'שמירה רק דרך assignTemplate');
  // showSaveError — אותה הודעה, בלי חלון שני כשהסיבה כבר מוצגת מ-lib/storage.js
  assert.match(fn, /if \(result === 'failed'\) \{ showSaveError\(/);
  const nav = fn.indexOf('setView(');
  assert.ok(nav > fn.indexOf("if (result !== 'saved') return;"), 'מעבר לכרטיס המתאמן רק אחרי שמירה');
});

// ─── ממצא 43: תוכן לקהל היעד ───
test('ממצא 43: אין יוגה ו"ברכת השמש" במודול — רצפי מתיחות בשמות עבריים', () => {
  assert.equal(M.YOGA_FLOWS, undefined);
  assert.ok(M.STRETCH_FLOWS.length >= 3);
  for (const f of M.STRETCH_FLOWS) {
    assert.ok(f.name && f.purpose && f.duration && f.steps.length >= 4, f.id);
    for (const s of f.steps) assert.ok(/[א-ת]/.test(s.name) && !/[A-Za-z]/.test(s.name), `${f.id}: ${s.name}`);
  }
  // גם שמות התנוחות בעברית (ספריית התרגילים, שגרות הגמישות, הקירור) — ה-id נשאר, רק השם התחלף
  const BAD = /יוגה|Surya|Namaskar|ברכת השמש|Tadasana|Chaturanga|Savasana|Trikonasana|לוחם \d|🧘|תנוחת הילד|כלב הפוך|כלב למעלה|היונה|פיגיון/;
  const walk = (dir) => fs.readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return fs.statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(SRC).filter((f) => /\.(jsx?|css)$/.test(f))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      assert.doesNotMatch(line, BAD, `${path.relative(SRC, file)}:${i + 1}`);
    });
  }
});

// זיהוי בשר וחלב בטקסט של פריט. "חלבון" (חלבון ביצה / אבקה) ו"חמאת בוטנים" אינם חלב; אבקת חלבון — חלבית אלא אם צוין פרווה/צמחית
const HE = '[\\u05D0-\\u05EA]';
const word = (w) => new RegExp(`(^|[^\\u05D0-\\u05EA])${w}($|${HE === '' ? '' : '[^\\u05D0-\\u05EA]'})`);
const MEAT = [/עוף/, /בקר/, /הודו/, /בשר/, /חמין/, /שניצל/, /קציצ/];
const DAIRY = [word('חלב'), /גבינ/, /יוגורט/, /קוטג/, /לבנה \d/, /שמנת/, word('חמאה'), /אבקת חלבון(?! (פרווה|צמחית))/];
const isMeat = (t) => MEAT.some((r) => r.test(t));
const isDairy = (t) => DAIRY.some((r) => r.test(t));
const timeOf = (name) => { const m = /\((\d{1,2}):(\d{2})\)/.exec(name); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

test('ממצא 43: תרגילי הגמישות שהיו בשמות תנוחות — אותו id (תבניות ותוכניות שמורות), שם תיאורי, ואותו שם בשגרות', async () => {
  const { EXERCISES } = await load('data/exercises.js');
  const Kn = await load('data/knowledge.js');
  const byId = (id) => EXERCISES.find((e) => e.id === id);
  assert.equal(byId('child-pose').name, 'מתיחת גב בכריעה');
  assert.equal(byId('downward-dog').name, 'מתיחת שרשרת אחורית — אגן למעלה');
  assert.equal(byId('pigeon').name, 'מתיחת ישבן — שוק מקופלת לפנים');
  const names = new Set(EXERCISES.map((e) => e.name));
  assert.equal(names.size, EXERCISES.length, 'שם תרגיל ייחודי בספרייה');
  const routineNames = [...M.MOBILITY_ROUTINES.flatMap((r) => r.exercises), ...Object.values(Kn).filter(Array.isArray)
    .flat().flatMap((x) => x?.steps || [])].map((s) => s.name);
  for (const id of ['child-pose', 'downward-dog', 'pigeon']) {
    assert.ok(routineNames.includes(byId(id).name), `השם החדש של ${id} בשימוש גם בשגרות`);
  }
});

test('ממצא 43: זיהוי בשר וחלב בבדיקה עצמה (חלבון / חמאת בוטנים — לא חלב)', () => {
  assert.equal(isDairy('3 חלבונים + 1 ביצה שלמה'), false);
  assert.equal(isDairy('2 כפות חמאת בוטנים'), false);
  assert.equal(isDairy('אבקת חלבון'), true);
  assert.equal(isDairy('אבקת חלבון צמחית'), false);
  assert.equal(isDairy('שיבולת שועל עם חלב 1%'), true);
  assert.equal(isDairy('קוטג׳ 5%'), true);
  assert.equal(isMeat('בקר רזה (200 גרם)'), true);
  assert.equal(isMeat('פילה אמנון'), false);
});

test('ממצא 43: התפריטים — אין חלב בארוחה בשרית, ואחרי ארוחה בשרית אין חלב באותו יום (לפחות 6 שעות לפי השעות שבתפריט)', () => {
  for (const plan of N.MEAL_PLANS) {
    for (const day of plan.days) {
      let lastMeat = null; // שעת הארוחה הבשרית האחרונה, או -1 כשאין שעה
      for (const meal of day.meals) {
        const where = `${plan.id} / ${meal.name}`;
        const meat = meal.items.some(isMeat);
        const dairy = meal.items.some(isDairy);
        assert.ok(!(meat && dairy), `בשר וחלב באותה ארוחה: ${where}`);
        assert.ok(N.MEAL_KINDS[meal.kind], `סוג ארוחה (בשרי/חלבי/פרווה): ${where}`);
        assert.equal(meal.kind, meat ? 'meat' : dairy ? 'dairy' : 'parve', `הסוג תואם לפריטים: ${where}`);
        const t = timeOf(meal.name);
        if (dairy && lastMeat !== null) {
          assert.ok(t !== null && lastMeat >= 0 && t - lastMeat >= 6 * 60, `חלב אחרי בשר בלי 6 שעות: ${where}`);
        }
        if (meat) lastMeat = t === null ? -1 : t;
      }
    }
  }
  // דג בארוחה בשרית — מנה נפרדת, לפני הבשר (לא באותה מנה)
  const FISH = /דג|פיש|סלמון|טונה|אמנון/;
  for (const plan of N.MEAL_PLANS) {
    for (const day of plan.days) {
      for (const meal of day.meals.filter((m) => m.items.some(isMeat))) {
        meal.items.forEach((item, i) => {
          if (!FISH.test(item)) return;
          assert.ok(!isMeat(item), `דג ובשר באותה מנה: ${plan.id} / ${item}`);
          assert.match(item, /מנה נפרדת/, `${plan.id} / ${item}`);
          assert.ok(i < meal.items.findIndex(isMeat), `הדג לפני הבשר: ${plan.id} / ${meal.name}`);
        });
      }
    }
  }
  // הממצאים עצמם
  const loss = N.MEAL_PLANS.find((p) => p.id === 'weight-loss-1800').days[0].meals;
  assert.equal(loss.find((m) => m.name.includes('16:00')).items.some(isDairy), false, 'לא קוטג׳ שלוש שעות אחרי עוף');
  const muscle = N.MEAL_PLANS.find((p) => p.id === 'muscle-2800').days[0].meals;
  const post = muscle.find((m) => m.name.includes('19:30'));
  assert.equal(post.items.some(isMeat), true);
  assert.equal(post.items.some(isDairy), false, 'לא אבקת חלבון (חלבית) עם בקר');
});

test('ממצא 43: דוגמת הארוחות בדוח התזונה המודפס והטיפים — בלי חלב אחרי בשר ובלי שילוב באותה הצעה', () => {
  const src = read('features/nutrition.jsx');
  const block = src.slice(src.indexOf('דוגמת ארוחות יומית'), src.indexOf('תוכנית זו מבוססת'));
  const lines = [...block.matchAll(/<strong>([^<]+)<\/strong>([^<]+)</g)].map((m) => m[2]);
  assert.ok(lines.length >= 5, 'נמצאו שורות הדוגמה');
  let meatSeen = false;
  for (const l of lines) {
    assert.ok(!(isMeat(l) && isDairy(l)), l);
    if (meatSeen) assert.equal(isDairy(l), false, 'חלב אחרי ארוחה בשרית: ' + l);
    if (isMeat(l)) meatSeen = true;
  }
  for (const tip of N.NUTRITION_TIPS) {
    for (const option of tip.body.split(/,? או /)) assert.ok(!(isMeat(option) && isDairy(option)), `${tip.title}: ${option}`);
  }
});

// ─── נמוך: שבת ויום טוב ביומן לפי הלוח העברי ───
const appt = (date, time, minutes = 60) => ({ date, time, minutes, kind: 'personal', capacity: 1, participants: [{ clientId: 'c1', status: 'booked' }] });

test('שבת: שישי 21:30 נדחה, שישי בבוקר מותר; מוצאי שבת 20:00 מותר באוקטובר ונדחה ביוני', () => {
  assert.match(St.validateAppointment(appt('2026-10-23', '21:30')), /בערב שבת האימון צריך להסתיים עד 15:00/);
  assert.equal(St.validateAppointment(appt('2026-10-23', '10:00')), null);
  assert.match(St.validateAppointment(appt('2026-10-23', '14:30', 60)), /עד 15:00/, 'מסתיים אחרי השעה');
  assert.equal(St.validateAppointment(appt('2026-10-23', '14:00', 60)), null, 'מסתיים בדיוק בשעה');
  assert.equal(St.validateAppointment(appt('2026-10-22', '23:30', 120)), null, 'חמישי בלילה, עד אחרי חצות — לא נוגע בשבת');
  assert.equal(St.validateAppointment(appt('2026-10-24', '20:00')), null, 'מוצאי שבת באוקטובר');
  assert.match(St.validateAppointment(appt('2026-10-24', '19:30')), /במוצאי שבת אפשר לקבוע מ-20:00/);
  assert.match(St.validateAppointment(appt('2026-10-24', '10:00')), /לא קובעים אימונים בשבת/);
  assert.match(St.validateAppointment(appt('2027-06-26', '20:00')), /מ-21:45/, 'בקיץ השבת יוצאת מאוחר');
  assert.equal(St.validateAppointment(appt('2027-06-26', '21:45')), null);
});

test('יום טוב לפי הלוח העברי: יום כיפור, ערב יום כיפור, ראש השנה שאחרי שבת, שבועות ביום שישי', () => {
  assert.equal(St.yomTovName('2026-09-21'), 'יום הכיפורים');
  assert.match(St.validateAppointment(appt('2026-09-21', '10:00')), /לא קובעים אימונים ביום הכיפורים/);
  assert.equal(St.validateAppointment(appt('2026-09-21', '21:00')), null, 'במוצאי יום הכיפורים');
  assert.match(St.validateAppointment(appt('2026-09-20', '18:00')), /בערב יום הכיפורים/);
  // שבת וראש השנה, ומחר עוד יום ראש השנה — אין מוצאי באותו יום
  assert.deepEqual(St.dayRule('2026-09-12'), { kind: 'closed', name: 'שבת וראש השנה' });
  assert.match(St.validateAppointment(appt('2026-09-12', '22:30')), /לא קובעים אימונים בשבת וראש השנה/);
  assert.equal(St.dayRule('2026-09-13').kind, 'motzaei');
  assert.deepEqual(St.dayRule('2027-06-11'), { kind: 'closed', name: 'שבועות' }, 'שבועות ביום שישי, ואחריו שבת');
  assert.equal(St.dayRule('2027-06-10').kind, 'erev');
  assert.equal(St.dayRule('2026-09-28').kind, 'open', 'חול המועד — יום רגיל');
  assert.equal(St.isHolyDay('2026-10-21'), false);
});

test('סדרה שבועית: שבוע שנופל על חג מדולג עם הסיבה, והתאריך הראשון חייב להיות תקין', () => {
  const r = St.planAppointments({ date: '2026-09-14', time: '18:00', minutes: 60, kind: 'personal', clientIds: ['c1'], weeks: 3 });
  assert.deepEqual(r.list.map((a) => a.date), ['2026-09-14', '2026-09-28']);
  assert.deepEqual(r.skipped.map((s) => s.date), ['2026-09-21']);
  assert.match(r.skipped[0].reason, /יום הכיפורים/);
  assert.ok(r.list.every((a) => a.seriesId === r.list[0].seriesId));
  assert.deepEqual(St.makeAppointments({ date: '2026-09-14', time: '18:00', minutes: 60, kind: 'personal', clientIds: ['c1'], weeks: 3 }).map((a) => a.date), ['2026-09-14', '2026-09-28']);
  assert.throws(() => St.planAppointments({ date: '2026-09-21', time: '18:00', minutes: 60, kind: 'personal', clientIds: ['c1'], weeks: 3 }), /יום הכיפורים/);
});

test('תזכורות: ביום שישי — גם אימון במוצאי שבת וגם של יום ראשון; לפני חג — היום שאחרי החג', () => {
  const plan = { id: 'm', name: 'חודשי', kind: 'period', sessions: null, validDays: 30, priceAg: 0 };
  const sch = [
    ...St.makeAppointments({ date: '2026-10-24', time: '20:30', minutes: 45, kind: 'personal', clientIds: ['c1'] }),
    ...St.makeAppointments({ date: '2026-10-25', time: '09:00', minutes: 45, kind: 'personal', clientIds: ['c1'] }),
  ];
  const rem = St.reminders({ clients: [{ id: 'c1', name: 'משה לוי' }], membershipsByClient: { c1: [St.newMembership(plan, '2026-10-01')] },
    lastSessionByClient: { c1: '2026-10-22' }, schedule: sch, today: '2026-10-23' }).filter((r) => r.kind === 'tomorrow');
  assert.deepEqual(rem.map((r) => r.title.replace(/^.* — אימון אישי /, '')), ['במוצאי שבת ב-20:30', 'ביום ראשון ב-09:00']);
  assert.deepEqual(St.nextTrainingDay('2026-09-11'), { date: '2026-09-14', label: 'ביום שני' }, 'שבת וראש השנה — יום שני');
  assert.deepEqual(St.nextTrainingDay('2026-09-20'), { date: '2026-09-22', label: 'ביום שלישי' }, 'ערב יום כיפור');
  assert.equal(St.defaultTime('2026-10-24'), '20:00');
  assert.equal(St.defaultTime('2026-10-23'), '10:00');
  assert.equal(St.defaultTime('2026-10-21'), '18:00');
});

test('השעות השמרניות לכל הארץ מכסות כל עיר ב-shell/hebcal.js, בכל יום, 2026–2035 (כולל מעבר שעון)', () => {
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });
  const local = (ms) => { const [h, m] = fmt.format(new Date(ms)).split(':').map(Number); return h * 60 + m; };
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let checked = 0;
  for (let y = 2026; y <= 2035; y++) {
    for (let mo = 0; mo < 12; mo++) {
      const erevEnd = mins(St.EREV_END[mo]);
      const motzaeiFrom = mins(St.MOTZAEI_FROM[mo]);
      for (let d = 1; d <= 31; d++) {
        const dt = new Date(Date.UTC(y, mo, d, 12));
        if (dt.getUTCMonth() !== mo) continue;
        const day = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        for (const city of Heb.CITIES) {
          const z = Heb.zmanim(day, { city: city.id });
          const candles = local(z.sunset - 40 * 60000); // 40 דקות לפני השקיעה בכל עיר — שמרני
          assert.ok(erevEnd <= candles - 45, `${day} ${city.id}: ערב עד ${St.EREV_END[mo]}, הדלקה ${candles}`);
          const zmaniyot = z.sunset + (72 * (z.sunset - z.sunrise)) / 720;
          const out = Math.max(local(z.tzeit), local(z.tzeitRT), local(zmaniyot));
          assert.ok(motzaeiFrom >= out + 10, `${day} ${city.id}: מוצאי מ-${St.MOTZAEI_FROM[mo]}, צאת ${out}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 50000, 'נבדקו ' + checked);
});

test('היומן מציג את עמודת שבת ואת כלל היום, ומודיע על שבועות שדולגו', () => {
  const src = read('studio.jsx');
  assert.match(src, /const days = St\.weekDays\(anchor\);/);
  assert.doesNotMatch(src, /days\[5\]/, 'השבוע הוא ראשון עד שבת');
  assert.match(src, /xl:grid-cols-7/);
  assert.match(src, /const rule = St\.dayRule\(d\);/);
  assert.match(src, /\{rule\.kind !== 'closed' && \(/, 'אין "+ הוספה" ביום שאין בו אימונים');
  assert.match(src, /const \{ list, skipped \} = St\.planAppointments\(/);
  assert.match(src, /onSave\(list, skipped\);/);
  assert.match(src, /דולגו בגלל שבת\/חג/);
});

// ─── נמוך: parseShekels ───
test('parseShekels: פסיק רק כמפריד אלפים — "12,34" נדחה ולא נקלט כ-1234', () => {
  assert.equal(St.parseShekels('12,34'), null);
  assert.equal(St.parseShekels('1,25'), null);
  assert.equal(St.parseShekels('12,3456'), null);
  assert.equal(St.parseShekels(',123'), null);
  assert.equal(St.parseShekels('1,250'), 125000);
  assert.equal(St.parseShekels('1,250.5'), 125050);
  assert.equal(St.parseShekels('1,234,567.89'), 123456789);
  assert.equal(St.parseShekels('₪ 1,250'), 125000);
  assert.equal(St.parseShekels('1250'), 125000);
  assert.equal(St.parseShekels('99999999999999999'), null, 'מעבר לדיוק — נדחה');
});

// ─── נמוך: 6 ו-7 ימים במחולל ───
test('מחולל: 6 ימים — תוכנית של 6 ימים בלי תרגיל כפול ביום; 7 ימים — נדחה בהודעה ולא "בשקט" 5', () => {
  const ALL = Co.EQUIPMENT.map((e) => e.id);
  for (const equipment of [ALL, ['bw', 'bands']]) {
    for (let seed = 1; seed <= 10; seed++) {
      let s = seed;
      const random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const prog = P.generateProgram({ goal: 'muscle', level: 'intermediate', daysPerWeek: 6, medical: [], equipment }, { random });
      assert.equal(prog.days.length, 6);
      assert.equal(new Set(prog.days.map((d) => d.name)).size, 6, 'שמות ימים שונים');
      for (const d of prog.days) {
        const ids = d.exercises.map((x) => x.exerciseId);
        assert.equal(new Set(ids).size, ids.length, `כפילות ב${d.name}`);
        assert.ok(ids.length >= 3, d.name);
      }
    }
  }
  for (const missing of [undefined, null, '']) {
    assert.equal(P.generateProgram({ goal: 'health', level: 'beginner', daysPerWeek: missing, medical: [], equipment: ['bw'] }).days.length, 3, 'כרטיס ישן בלי ערך — 3 ימים');
  }
  for (const bad of [7, 0, -1, 'abc']) {
    assert.throws(() => P.generateProgram({ goal: 'health', level: 'beginner', daysPerWeek: bad, medical: [], equipment: ['bw'] }), /בין 1 ל-6/, String(bad));
  }
  assert.ok(P.validateClient({ age: 30, daysPerWeek: 7, equipment: ['bw'] }).some((e) => /בין 1 ל-6 \(בלי שבת\)/.test(e)));
  assert.match(read('features/clients.jsx'), /type="number" min="1" max="6" value=\{d\.daysPerWeek\}/);
});
