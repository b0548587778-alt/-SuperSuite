// לוגיקת מחולל התוכניות וחישובי גוף (PLAN.md 6.3) — בלי React, נבדקת ב-tests/trainer-calc.test.js.
// הועבר מ-App.jsx כמו שהוא; random — להזרקה בבדיקות (ברירת מחדל Math.random)
import { MEDICAL_CONDITIONS, ACTIVITY_LEVELS } from '../data/constants.js';
import { EXERCISES, GOAL_PARAMS } from '../data/exercises.js';
import { K } from './db.js';

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
  // בלי ערך (כרטיס ישן) — 3; 0 אינו "בלי ערך" ונדחה
  const days = client.daysPerWeek == null || client.daysPerWeek === '' ? 3 : parseInt(client.daysPerWeek, 10);
  // עד 6 ימים (ראשון–שישי, בלי שבת). פעם 6 ו-7 נתנו בשקט תוכנית של 5 ימים (בדיקת קוד 23.10.2026)
  if (!Number.isInteger(days) || days < 1 || days > MAX_TRAINING_DAYS) {
    throw new Error(`מספר ימי האימון בכרטיס המתאמן צריך להיות בין 1 ל-${MAX_TRAINING_DAYS} (בלי שבת). יש לעדכן בעריכת המתאמן ולנסות שוב.`);
  }
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
  } else if (days === 5) {
    // 5 days PPL + extras
    splits = [
      { name: 'יום A — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום B — משיכה', blocks: ['back', 'arms'] },
      { name: 'יום C — רגליים', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום D — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום E — משיכה ורגליים', blocks: ['back', 'legs', 'core'] },
    ];
  } else {
    // 6 ימים: דחיפה / משיכה / רגליים פעמיים בשבוע
    splits = [
      { name: 'יום A — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום B — משיכה', blocks: ['back', 'arms', 'core'] },
      { name: 'יום C — רגליים', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום D — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום E — משיכה', blocks: ['back', 'arms', 'core'] },
      { name: 'יום F — רגליים', blocks: ['legs', 'legsIso', 'core', 'flex'] },
    ];
  }

  // Build each day
  const seenInWeek = new Set();
  const program = splits.map((split) => {
    const dayExercises = [];
    split.blocks.forEach((blockKey) => {
      const pool = byPart[blockKey].filter((e) => !seenInWeek.has(e.id));
      const pickCount = blockKey === 'legs' || blockKey === 'chest' || blockKey === 'back' ? 1 :
                        blockKey === 'core' ? 2 : 1;
      // מאגר שנגמר בשבוע (6 ימים, מעט ציוד) — חוזרים על תרגיל משבוע, אבל לא על תרגיל שכבר באותו יום
      const fallback = byPart[blockKey].filter((e) => !dayExercises.some((x) => x.exerciseId === e.id));
      const picked = pickN(pool.length > 0 ? pool : fallback, pickCount, random);
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

  // בלי ציוד מתאים (או שכל התרגילים נפסלו בגלל המצב הרפואי) — לא תוכנית ריקה שמוצגת "פעילה"
  if (!program.some((d) => d.exercises.length > 0)) {
    throw new Error('אין תרגילים שמתאימים לציוד ולמצב הרפואי של המתאמן. יש לסמן ציוד זמין בכרטיס המתאמן ולנסות שוב.');
  }
  return { days: program, createdAt: new Date().toISOString(), goal: client.goal };
}

// תוכנית מתבנית מוכנה (features/templates.jsx): עותק של הימים והתרגילים, בלי משקלים
export function programFromTemplate(template, now = new Date()) {
  return {
    goal: template.category,
    level: template.level,
    daysPerWeek: template.daysPerWeek,
    createdAt: now.toISOString(),
    templateId: template.id,
    templateName: template.name,
    days: template.days.map((d) => ({
      name: d.name,
      exercises: d.exercises.map((e) => ({ ...e, weight: '' })),
    })),
  };
}

// הקצאת תבנית למתאמן (features/templates.jsx). תוכנית קיימת נדרסת רק אחרי אישור מפורש.
// get / set / askConfirm מוזרקים: במסך — S.get, S.set ו-askConfirm מ-lib/dialog.js; בבדיקות — תחליפים.
// 'cancelled' — אין מתאמן או שהמשתמש ביטל; 'failed' — השמירה נכשלה (set החזיר false); 'saved' — נשמר
export async function assignTemplate({ template, client, get, set, askConfirm, now = new Date() }) {
  if (!template || !client) return 'cancelled';
  const key = K.program(client.id);
  const existing = await get(key);
  if (existing && !(await askConfirm(
    `להחליף את התוכנית הנוכחית של ${client.name} בתוכנית "${template.name}"?\nהתוכנית הקיימת תימחק, ואימונים שכבר נרשמו לא יהיו מקושרים לימי התוכנית החדשה.`,
    { danger: true, okText: 'החלפת התוכנית' },
  ))) return 'cancelled';
  return (await set(key, programFromTemplate(template, now))) ? 'saved' : 'failed';
}

export function getMedicalWarnings(client) {
  return MEDICAL_CONDITIONS
    .filter((c) => client.medical?.includes(c.id))
    .map((c) => ({ condition: c.label, warning: c.warning }));
}

// למה תרגיל לא מתאים למתאמן הזה — רשימת סיבות בעברית, תחת אותו תנאי של filterExercises.
// למסך התוכנית: תרגיל שנשאר בתוכנית ישנה אחרי שינוי מצב רפואי מסומן, לא מוסר לבד
export function exclusionReasons(client, ex) {
  if (!ex) return [];
  const reasons = [];
  const hit = (ex.contra || []).filter((id) => client.medical?.includes(id));
  for (const id of hit) {
    const cond = MEDICAL_CONDITIONS.find((c) => c.id === id);
    reasons.push(`מגבלה רפואית: ${cond?.label || id}`);
  }
  if (!(ex.eq || []).some((eq) => client.equipment?.includes(eq))) reasons.push('אין ציוד מתאים');
  if (client.level === 'beginner' && ex.lvl === 'advanced') reasons.push('רמה גבוהה מדי למתחיל');
  return reasons;
}

// ראשון עד שישי — אין אימונים בשבת
export const MAX_TRAINING_DAYS = 6;

// טווחים סבירים לכרטיס המתאמן (גובה בס"מ, משקל בק"ג)
export const CLIENT_LIMITS = {
  age: { min: 5, max: 120, label: 'גיל', unit: '' },
  height: { min: 100, max: 250, label: 'גובה', unit: ' ס"מ' },
  weight: { min: 20, max: 350, label: 'משקל', unit: ' ק"ג' },
  daysPerWeek: { min: 1, max: MAX_TRAINING_DAYS, label: 'ימי אימון בשבוע', unit: ' (בלי שבת)' },
};
const inRange = (v, { min, max }) => Number.isFinite(v) && v >= min && v <= max;

// בדיקת טופס המתאמן לפני שמירה: רשימת הודעות בעברית (ריקה = תקין). גובה ומשקל — רשות, אבל אם הוזנו — בטווח
export function validateClient(d) {
  const errors = [];
  const check = (key, required) => {
    const raw = d?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (required) errors.push(`${CLIENT_LIMITS[key].label} — שדה חובה`);
      return;
    }
    const lim = CLIENT_LIMITS[key];
    if (!inRange(Number(raw), lim)) errors.push(`${lim.label} צריך להיות בין ${lim.min} ל-${lim.max}${lim.unit}`);
  };
  check('age', true);
  check('height', false);
  check('weight', false);
  check('daysPerWeek', true);
  if (!Array.isArray(d?.equipment) || d.equipment.length === 0) errors.push('יש לסמן לפחות פריט ציוד אחד (גם "משקל גוף")');
  // רמת פעילות — רשות (כרטיס ישן בלי הערך), אבל אם יש — מהרשימה
  if (d?.activityLevel && !ACTIVITY_LEVELS.some((a) => a.id === d.activityLevel)) errors.push('רמת הפעילות אינה מוכרת');
  return errors;
}

export function calcBMI(h, w) {
  if (!h || !w) return null;
  // ערך מחוץ לטווח (גובה במטרים, משקל שלילי) — אין BMI, לא מספר מופרך
  if (!inRange(Number(h), CLIENT_LIMITS.height) || !inRange(Number(w), CLIENT_LIMITS.weight)) return null;
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
