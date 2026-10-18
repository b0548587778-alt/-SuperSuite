// ═══════════════════════════════════════════════════════════════════
//                  PROGRAM TEMPLATES (pre-made)
// ═══════════════════════════════════════════════════════════════════

export const PROGRAM_TEMPLATES = [
  // === STRENGTH ===
  {
    id: 'starting-strength',
    name: 'Starting Strength (5×5)',
    category: 'strength',
    level: 'beginner',
    daysPerWeek: 3,
    description: 'תוכנית הכוח הקלאסית למתחילים. שני אימונים מתחלפים A/B, 3 פעמים בשבוע. הוספת 2.5 ק"ג כל אימון.',
    schedule: 'A-B-A בשבוע 1 / B-A-B בשבוע 2',
    progression: 'הוספת 2.5 ק"ג בכל אימון. בכשל — חזרה על אותו משקל. בכשל פעמיים — הורד 10%.',
    days: [
      {
        name: 'אימון A',
        exercises: [
          { exerciseId: 'back-squat', sets: 5, reps: 5, rest: 180, notes: 'הוסף 2.5 ק״ג מאימון אחרון' },
          { exerciseId: 'bench-press', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'barbell-row', sets: 5, reps: 5, rest: 180, notes: '' },
        ],
      },
      {
        name: 'אימון B',
        exercises: [
          { exerciseId: 'back-squat', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'ohp', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'deadlift', sets: 1, reps: 5, rest: 240, notes: 'סט אחד בלבד, כבד' },
        ],
      },
    ],
  },
  {
    id: 'stronglifts-5x5',
    name: 'StrongLifts 5×5',
    category: 'strength',
    level: 'beginner',
    daysPerWeek: 3,
    description: 'דומה ל-Starting Strength עם הוספת חתירה. גרסה פופולרית מאוד.',
    schedule: 'A-B-A / B-A-B',
    progression: 'הוספת 2.5 ק"ג בכל אימון',
    days: [
      {
        name: 'אימון A',
        exercises: [
          { exerciseId: 'back-squat', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'bench-press', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'barbell-row', sets: 5, reps: 5, rest: 180, notes: '' },
        ],
      },
      {
        name: 'אימון B',
        exercises: [
          { exerciseId: 'back-squat', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'ohp', sets: 5, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'deadlift', sets: 1, reps: 5, rest: 240, notes: '' },
        ],
      },
    ],
  },

  // === HYPERTROPHY ===
  {
    id: 'ppl',
    name: 'Push / Pull / Legs (PPL)',
    category: 'muscle',
    level: 'intermediate',
    daysPerWeek: 6,
    description: 'תוכנית פיצול קלאסית. כל קבוצת שריר פעמיים בשבוע. הקצב: דחיפה / משיכה / רגליים.',
    schedule: 'PPL × 2 בשבוע, מנוחה ביום 7',
    progression: 'הוספת חזרה כשמצליח את כל הסטים. כשמגיע לטווח עליון — הוסף משקל וחזור לטווח תחתון.',
    days: [
      {
        name: 'יום דחיפה (חזה / כתפיים / טריצפס)',
        exercises: [
          { exerciseId: 'bench-press', sets: 4, reps: 8, rest: 90, notes: '' },
          { exerciseId: 'incline-db-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'db-shoulder-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'lateral-raise', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'tricep-pushdown', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'cable-fly', sets: 3, reps: 12, rest: 60, notes: 'finisher' },
        ],
      },
      {
        name: 'יום משיכה (גב / ביצפס)',
        exercises: [
          { exerciseId: 'pull-up', sets: 4, reps: 8, rest: 90, notes: 'או lat-pulldown' },
          { exerciseId: 'barbell-row', sets: 4, reps: 8, rest: 90, notes: '' },
          { exerciseId: 'seated-row', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'face-pull', sets: 3, reps: 15, rest: 60, notes: 'בריאות כתף' },
          { exerciseId: 'bicep-curl', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'hammer-curl', sets: 3, reps: 12, rest: 60, notes: '' },
        ],
      },
      {
        name: 'יום רגליים',
        exercises: [
          { exerciseId: 'back-squat', sets: 4, reps: 8, rest: 120, notes: '' },
          { exerciseId: 'romanian-dl', sets: 3, reps: 10, rest: 120, notes: '' },
          { exerciseId: 'leg-press', sets: 3, reps: 12, rest: 90, notes: '' },
          { exerciseId: 'leg-curl', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'leg-extension', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'calf-raise', sets: 4, reps: 15, rest: 45, notes: '' },
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower (4 ימים)',
    category: 'muscle',
    level: 'intermediate',
    daysPerWeek: 4,
    description: 'פלג עליון / פלג תחתון, פעמיים בשבוע כל אחד. איזון מצוין בין נפח ותדירות.',
    schedule: 'יום 1: עליון / יום 2: תחתון / יום 3: מנוחה / יום 4: עליון / יום 5: תחתון',
    progression: 'הוסף חזרה כל שבוע. כשמגיע לטווח עליון — הוסף משקל.',
    days: [
      {
        name: 'פלג עליון A',
        exercises: [
          { exerciseId: 'bench-press', sets: 4, reps: 6, rest: 120, notes: '' },
          { exerciseId: 'barbell-row', sets: 4, reps: 8, rest: 120, notes: '' },
          { exerciseId: 'ohp', sets: 3, reps: 8, rest: 90, notes: '' },
          { exerciseId: 'pull-up', sets: 3, reps: 8, rest: 90, notes: '' },
          { exerciseId: 'tricep-pushdown', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'bicep-curl', sets: 3, reps: 12, rest: 60, notes: '' },
        ],
      },
      {
        name: 'פלג תחתון A',
        exercises: [
          { exerciseId: 'back-squat', sets: 4, reps: 6, rest: 150, notes: '' },
          { exerciseId: 'romanian-dl', sets: 3, reps: 8, rest: 120, notes: '' },
          { exerciseId: 'lunge-reverse', sets: 3, reps: 10, rest: 90, notes: 'לכל רגל' },
          { exerciseId: 'leg-curl', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'calf-raise', sets: 4, reps: 15, rest: 45, notes: '' },
          { exerciseId: 'plank', sets: 3, reps: 45, rest: 45, notes: 'שניות' },
        ],
      },
      {
        name: 'פלג עליון B',
        exercises: [
          { exerciseId: 'incline-db-press', sets: 4, reps: 8, rest: 90, notes: '' },
          { exerciseId: 'lat-pulldown', sets: 4, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'db-shoulder-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'seated-row', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'lateral-raise', sets: 3, reps: 15, rest: 45, notes: '' },
          { exerciseId: 'face-pull', sets: 3, reps: 15, rest: 45, notes: '' },
        ],
      },
      {
        name: 'פלג תחתון B',
        exercises: [
          { exerciseId: 'deadlift', sets: 4, reps: 5, rest: 180, notes: '' },
          { exerciseId: 'leg-press', sets: 3, reps: 12, rest: 90, notes: '' },
          { exerciseId: 'bulgarian-split', sets: 3, reps: 10, rest: 90, notes: 'לכל רגל' },
          { exerciseId: 'hip-thrust', sets: 3, reps: 12, rest: 90, notes: '' },
          { exerciseId: 'calf-raise', sets: 4, reps: 15, rest: 45, notes: '' },
          { exerciseId: 'hanging-leg-raise', sets: 3, reps: 10, rest: 60, notes: 'או leg-raise' },
        ],
      },
    ],
  },

  // === FULL BODY ===
  {
    id: 'full-body-3',
    name: 'גוף מלא 3×בשבוע',
    category: 'muscle',
    level: 'beginner',
    daysPerWeek: 3,
    description: 'תוכנית גוף מלא, 3 פעמים בשבוע. אידיאלית למתחילים ולמתאמנים עם זמן מוגבל.',
    schedule: 'ב/ד/ו או ראשון/שלישי/חמישי',
    progression: 'הוסף חזרה כל אימון. כשמגיע לטווח עליון — הוסף 2.5 ק"ג.',
    days: [
      {
        name: 'אימון גוף מלא A',
        exercises: [
          { exerciseId: 'goblet-squat', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'db-bench-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'db-row', sets: 3, reps: 10, rest: 90, notes: 'לכל יד' },
          { exerciseId: 'romanian-dl', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'plank', sets: 3, reps: 30, rest: 45, notes: 'שניות' },
        ],
      },
      {
        name: 'אימון גוף מלא B',
        exercises: [
          { exerciseId: 'lunge-reverse', sets: 3, reps: 10, rest: 90, notes: 'לכל רגל' },
          { exerciseId: 'db-shoulder-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'lat-pulldown', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'hip-thrust', sets: 3, reps: 12, rest: 90, notes: '' },
          { exerciseId: 'dead-bug', sets: 3, reps: 10, rest: 45, notes: 'לכל צד' },
        ],
      },
      {
        name: 'אימון גוף מלא C',
        exercises: [
          { exerciseId: 'leg-press', sets: 3, reps: 12, rest: 90, notes: '' },
          { exerciseId: 'incline-db-press', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'seated-row', sets: 3, reps: 10, rest: 90, notes: '' },
          { exerciseId: 'leg-curl', sets: 3, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'side-plank', sets: 3, reps: 30, rest: 30, notes: 'שניות לכל צד' },
        ],
      },
    ],
  },

  // === HOME / NO EQUIPMENT ===
  {
    id: 'home-bodyweight',
    name: 'אימון בית (משקל גוף)',
    category: 'health',
    level: 'beginner',
    daysPerWeek: 4,
    description: 'אימון משקל גוף שלם, ללא ציוד. 4 ימים בשבוע, 30-40 דקות.',
    schedule: 'יום 1: A / יום 2: B / יום 3: מנוחה / יום 4: A / יום 5: B',
    progression: 'הוסף חזרה כל שבוע. כשקל מדי — עבור לוריאציה קשה יותר.',
    days: [
      {
        name: 'יום A — דחיפה ורגליים',
        exercises: [
          { exerciseId: 'bw-squat', sets: 3, reps: 15, rest: 60, notes: '' },
          { exerciseId: 'pushup', sets: 3, reps: 10, rest: 60, notes: 'או knee-pushup' },
          { exerciseId: 'lunge-reverse', sets: 3, reps: 10, rest: 60, notes: 'לכל רגל' },
          { exerciseId: 'plank', sets: 3, reps: 30, rest: 45, notes: 'שניות' },
          { exerciseId: 'glute-bridge', sets: 3, reps: 15, rest: 45, notes: '' },
        ],
      },
      {
        name: 'יום B — משיכה וליבה',
        exercises: [
          { exerciseId: 'bulgarian-split', sets: 3, reps: 10, rest: 60, notes: 'לכל רגל' },
          { exerciseId: 'pushup', sets: 3, reps: 10, rest: 60, notes: '' },
          { exerciseId: 'superman', sets: 3, reps: 12, rest: 45, notes: '' },
          { exerciseId: 'dead-bug', sets: 3, reps: 10, rest: 45, notes: 'לכל צד' },
          { exerciseId: 'side-plank', sets: 3, reps: 30, rest: 30, notes: 'שניות לכל צד' },
          { exerciseId: 'mountain-climber', sets: 3, reps: 30, rest: 45, notes: 'שניות' },
        ],
      },
    ],
  },

  // === FAT LOSS ===
  {
    id: 'fat-loss-circuit',
    name: 'מעגל לירידה במשקל',
    category: 'weight-loss',
    level: 'intermediate',
    daysPerWeek: 4,
    description: 'אימון מעגלי בעצימות גבוהה. סטים ארוכים, מנוחות קצרות, שריפת קלוריות מקסימלית.',
    schedule: '4 פעמים בשבוע, אופציה לקרדיו ביום מנוחה',
    progression: 'הוסף סבב למעגל כל שבועיים. החזק טכניקה, לא מהירות.',
    days: [
      {
        name: 'מעגל גוף מלא A',
        exercises: [
          { exerciseId: 'goblet-squat', sets: 4, reps: 15, rest: 30, notes: '' },
          { exerciseId: 'pushup', sets: 4, reps: 12, rest: 30, notes: '' },
          { exerciseId: 'db-row', sets: 4, reps: 12, rest: 30, notes: '' },
          { exerciseId: 'lunge-reverse', sets: 4, reps: 12, rest: 30, notes: 'לכל רגל' },
          { exerciseId: 'mountain-climber', sets: 4, reps: 30, rest: 30, notes: 'שניות' },
          { exerciseId: 'plank', sets: 4, reps: 45, rest: 30, notes: 'שניות' },
        ],
      },
      {
        name: 'מעגל גוף מלא B',
        exercises: [
          { exerciseId: 'kb-swing', sets: 4, reps: 20, rest: 30, notes: '' },
          { exerciseId: 'db-shoulder-press', sets: 4, reps: 12, rest: 30, notes: '' },
          { exerciseId: 'romanian-dl', sets: 4, reps: 12, rest: 30, notes: '' },
          { exerciseId: 'lat-pulldown', sets: 4, reps: 12, rest: 30, notes: '' },
          { exerciseId: 'jumping-jacks', sets: 4, reps: 45, rest: 30, notes: 'שניות' },
          { exerciseId: 'russian-twist', sets: 4, reps: 20, rest: 30, notes: 'סה״כ' },
        ],
      },
    ],
  },

  // === SENIOR / REHAB ===
  {
    id: 'senior-friendly',
    name: 'תוכנית למבוגרים',
    category: 'health',
    level: 'beginner',
    daysPerWeek: 3,
    description: 'תוכנית בטוחה ועדינה למבוגרים או חוזרים אחרי תקופת אי-פעילות. דגש על ניידות, יציבות וכוח בסיסי.',
    schedule: '3 פעמים בשבוע עם יום מנוחה בין אימונים',
    progression: 'אדאג להוספת זמן/חזרות הדרגתית. אין צורך להוסיף משקל מהר.',
    days: [
      {
        name: 'אימון יציבות וכוח A',
        exercises: [
          { exerciseId: 'chair-squat', sets: 2, reps: 10, rest: 60, notes: '' },
          { exerciseId: 'wall-pushup', sets: 2, reps: 10, rest: 60, notes: '' },
          { exerciseId: 'glute-bridge', sets: 2, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'bird-dog', sets: 2, reps: 8, rest: 45, notes: 'לכל צד' },
          { exerciseId: 'march-place', sets: 2, reps: 60, rest: 45, notes: 'שניות' },
          { exerciseId: 'cat-cow', sets: 2, reps: 10, rest: 30, notes: 'תרגיל גמישות' },
        ],
      },
      {
        name: 'אימון יציבות וכוח B',
        exercises: [
          { exerciseId: 'step-up', sets: 2, reps: 10, rest: 60, notes: 'גובה נמוך' },
          { exerciseId: 'band-row', sets: 2, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'wall-pushup', sets: 2, reps: 12, rest: 60, notes: '' },
          { exerciseId: 'dead-bug', sets: 2, reps: 8, rest: 45, notes: 'לכל צד' },
          { exerciseId: 'walk', sets: 1, reps: 600, rest: 0, notes: '10 דקות הליכה' },
        ],
      },
    ],
  },
];
