// לוגיקת מחולל התוכניות וחישובי גוף (PLAN.md 6.3) — בלי React, נבדקת ב-tests/trainer-calc.test.js.
// הועבר מ-App.jsx כמו שהוא; random — להזרקה בבדיקות (ברירת מחדל Math.random)
import { MEDICAL_CONDITIONS } from '../data/constants.js';
import { EXERCISES, GOAL_PARAMS } from '../data/exercises.js';

export function filterExercises(client) {
  return EXERCISES.filter((ex) => {
    if (ex.contra.some((c) => client.medical?.includes(c))) return false;
    if (!ex.eq.some((eq) => client.equipment?.includes(eq))) return false;
    if (client.level === 'beginner' && ex.lvl === 'advanced') return false;
    return true;
  });
}

export function pickN(arr, n, random = Math.random) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

// Core program generator — multi-day split
export function generateProgram(client, { random = Math.random } = {}) {
  const days = parseInt(client.daysPerWeek || 3, 10);
  const available = filterExercises(client);
  const params = GOAL_PARAMS[client.goal] || GOAL_PARAMS.health;

  // Categorize available pool
  const byPart = {
    legs: available.filter((e) => ['רגליים', 'ירך אחורית'].includes(e.part) && e.cat === 'compound'),
    legsIso: available.filter((e) => ['רגליים', 'ירך אחורית'].includes(e.part) && e.cat === 'isolation'),
    chest: available.filter((e) => e.part === 'חזה'),
    back: available.filter((e) => e.part === 'גב'),
    shoulders: available.filter((e) => e.part === 'כתפיים'),
    arms: available.filter((e) => e.part === 'ידיים'),
    core: available.filter((e) => e.cat === 'core'),
    cardio: available.filter((e) => e.cat === 'cardio'),
    flex: available.filter((e) => e.cat === 'flex'),
  };

  // Decide split based on days/week + goal
  let splits;
  if (days <= 2) {
    splits = [
      { name: 'אימון גוף מלא A', blocks: ['legs', 'chest', 'back', 'core'] },
      { name: 'אימון גוף מלא B', blocks: ['legs', 'shoulders', 'back', 'core'] },
    ].slice(0, days);
  } else if (days === 3) {
    splits = [
      { name: 'יום A — גוף מלא', blocks: ['legs', 'chest', 'back', 'core'] },
      { name: 'יום B — גוף מלא', blocks: ['legs', 'shoulders', 'back', 'arms', 'core'] },
      { name: 'יום C — גוף מלא', blocks: ['legs', 'chest', 'back', 'core', 'flex'] },
    ];
  } else if (days === 4) {
    splits = [
      { name: 'יום A — פלג עליון', blocks: ['chest', 'back', 'shoulders', 'arms'] },
      { name: 'יום B — פלג תחתון', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום C — פלג עליון', blocks: ['back', 'chest', 'arms', 'shoulders'] },
      { name: 'יום D — פלג תחתון', blocks: ['legs', 'legsIso', 'core', 'flex'] },
    ];
  } else {
    // 5+ days PPL + extras
    splits = [
      { name: 'יום A — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום B — משיכה', blocks: ['back', 'arms'] },
      { name: 'יום C — רגליים', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום D — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום E — משיכה ורגליים', blocks: ['back', 'legs', 'core'] },
    ].slice(0, days);
  }

  // Build each day
  const seenInWeek = new Set();
  const program = splits.map((split) => {
    const dayExercises = [];
    split.blocks.forEach((blockKey) => {
      const pool = byPart[blockKey].filter((e) => !seenInWeek.has(e.id));
      const pickCount = blockKey === 'legs' || blockKey === 'chest' || blockKey === 'back' ? 1 :
                        blockKey === 'core' ? 2 : 1;
      const picked = pickN(pool.length > 0 ? pool : byPart[blockKey], pickCount, random);
      picked.forEach((ex) => {
        seenInWeek.add(ex.id);
        const isTimed = ex.cat === 'core' || ex.cat === 'flex' || ex.id === 'plank' || ex.id === 'side-plank';
        dayExercises.push({
          exerciseId: ex.id,
          sets: ex.cat === 'flex' ? 2 : params.sets,
          reps: isTimed ? null : `${params.repsMin}-${params.repsMax}`,
          duration: isTimed ? (ex.cat === 'flex' ? 30 : 40) : null,
          rest: params.rest,
          weight: '',
          notes: '',
        });
      });
    });

    // Add cardio if appropriate
    if (params.cardioMin > 0 && byPart.cardio.length > 0) {
      const cardio = byPart.cardio[0];
      dayExercises.push({
        exerciseId: cardio.id,
        sets: 1,
        reps: null,
        duration: params.cardioMin * 60,
        rest: 0,
        weight: '',
        notes: `${params.cardioMin} דקות בעצימות מתונה`,
      });
    }

    return { name: split.name, exercises: dayExercises };
  });

  return { days: program, createdAt: new Date().toISOString(), goal: client.goal };
}

export function getMedicalWarnings(client) {
  return MEDICAL_CONDITIONS
    .filter((c) => client.medical?.includes(c.id))
    .map((c) => ({ condition: c.label, warning: c.warning }));
}

export function calcBMI(h, w) {
  if (!h || !w) return null;
  return (w / ((h / 100) ** 2)).toFixed(1);
}

export function bmiCategory(bmi) {
  if (!bmi) return '';
  const n = parseFloat(bmi);
  if (n < 18.5) return 'תת-משקל';
  if (n < 25) return 'תקין';
  if (n < 30) return 'עודף משקל';
  return 'השמנה';
}
