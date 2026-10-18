// ═══════════════════════════════════════════════════════════════════
//                    CARDIO PROTOCOLS
// ═══════════════════════════════════════════════════════════════════

export const HEART_RATE_ZONES = [
  { zone: 1, name: 'התאוששות', pctMin: 50, pctMax: 60, purpose: 'חימום, התאוששות אקטיבית', feels: 'קל מאוד, יכול לדבר רגיל' },
  { zone: 2, name: 'אירובי קל', pctMin: 60, pctMax: 70, purpose: 'בניית בסיס אירובי, שריפת שומן', feels: 'יכול לדבר במשפטים מלאים' },
  { zone: 3, name: 'אירובי', pctMin: 70, pctMax: 80, purpose: 'שיפור סיבולת, יעילות לב-ריאה', feels: 'יכול לדבר במשפטים קצרים' },
  { zone: 4, name: 'סף לקטטי', pctMin: 80, pctMax: 90, purpose: 'שיפור סף לקטטי, ביצועים תחרותיים', feels: 'קושי לדבר, מילים בודדות' },
  { zone: 5, name: 'מקסימלי', pctMin: 90, pctMax: 100, purpose: 'מהירות מקסימלית, VO2max', feels: 'לא יכול לדבר, מאמץ עליון' },
];

export function calculateMaxHR(age) {
  // Tanaka formula (more accurate than 220-age)
  return Math.round(208 - 0.7 * age);
}

export function calculateZoneHR(maxHR, zone) {
  const z = HEART_RATE_ZONES.find(x => x.zone === zone);
  if (!z) return null;
  return {
    min: Math.round(maxHR * z.pctMin / 100),
    max: Math.round(maxHR * z.pctMax / 100),
  };
}

export const HIIT_PROTOCOLS = [
  {
    id: 'tabata',
    name: 'טבטה (Tabata)',
    duration: '4 דקות',
    structure: '20 שניות עבודה / 10 שניות מנוחה × 8 סבבים',
    intensity: 'מקסימלית — Zone 5',
    purpose: 'שיפור VO2max, יעילות לב-ריאה',
    suitable: 'מתאמנים מנוסים בלבד',
    exercises: [
      'ספרינטים על אופניים נייחים',
      'ספרינטים בריצה',
      'ברפי מהיר',
      'קפיצות מקבץ',
      'ג׳מפינג ג׳קס מהירים',
      'מאונטיין קליימבר',
    ],
    notes: 'פרוטוקול הקצר והאינטנסיבי ביותר. דורש חימום של 5+ דקות.',
  },
  {
    id: 'classic-hiit',
    name: 'HIIT קלאסי',
    duration: '20-30 דקות',
    structure: '30 שניות עבודה / 30 שניות מנוחה × 10-20 סבבים',
    intensity: 'גבוהה — Zone 4-5',
    purpose: 'שריפת קלוריות יעילה, סיבולת אנאירובית',
    suitable: 'מתאמנים בינוניים+',
    exercises: [
      'ריצה / הליכה במעלה',
      'אופניים',
      'חתירה',
      'תרגילי גוף שלם (ברפי, סקוואט קפיצה)',
    ],
    notes: 'פרוטוקול גמיש. מתאים לרוב המתאמנים אחרי בנייה.',
  },
  {
    id: 'emom',
    name: 'EMOM (Every Minute On the Minute)',
    duration: '10-20 דקות',
    structure: 'בתחילת כל דקה — בצע X חזרות, מנוחה לסיום הדקה',
    intensity: 'בינונית-גבוהה',
    purpose: 'בניית קצב, סיבולת',
    suitable: 'כל הרמות',
    exercises: [
      '10 שכיבות סמיכה — כל דקה למשך 10 דקות',
      '5 ברפי + 10 סקוואט — כל דקה למשך 12 דקות',
      '15 קפיצות חבל מהירות + 5 שכיבות',
    ],
    notes: 'עוצמה הולכת ועולה כי המנוחה מתקצרת ככל שהביצוע איטי יותר.',
  },
  {
    id: 'amrap',
    name: 'AMRAP (As Many Rounds As Possible)',
    duration: '10-20 דקות',
    structure: 'בצע מעגל של תרגילים. כמה סבבים שלמים שתספיק בזמן הנתון',
    intensity: 'בינונית-גבוהה',
    purpose: 'מדידה והתקדמות, שריפת קלוריות',
    suitable: 'בינוני+',
    exercises: [
      '20 דקות: 5 מתחים + 10 שכיבות + 15 סקוואט',
      '15 דקות: 10 ברפי + 20 סקוואט + 30 ג׳מפינג ג׳קס',
    ],
    notes: 'רישום תוצאה מאפשר השוואה ובחינת התקדמות לאורך זמן.',
  },
  {
    id: 'fartlek',
    name: 'פארטלק (Fartlek)',
    duration: '20-40 דקות',
    structure: 'ריצה רציפה עם החלפות קצב לא מתוכננות',
    intensity: 'משתנה — Zone 2-4',
    purpose: 'שיפור גמישות אירובית, סיבולת',
    suitable: 'רצים',
    exercises: [
      'ריצה רגילה עם ספרינטים בזמנים אקראיים',
      'דוגמה: ריצה 5 דקות → ספרינט עד עץ → ריצה → ספרינט עד שלט',
    ],
    notes: 'שוודית במקור — "משחק מהירויות". מהנה ויעיל.',
  },
];

export const RUNNING_PROGRAMS = [
  {
    id: 'couch-to-5k',
    name: 'מהספה ל-5 ק״מ (8 שבועות)',
    target: 'ריצה רציפה של 5 ק״מ',
    suitable: 'מתחילים לחלוטין',
    weeks: [
      { week: 1, sessions: 3, plan: 'הליכה 5 דק׳ → 1 דק׳ ריצה / 2 דק׳ הליכה (8 חזרות) → הליכה 5 דק׳' },
      { week: 2, sessions: 3, plan: '1.5 דק׳ ריצה / 2 דק׳ הליכה (6 חזרות)' },
      { week: 3, sessions: 3, plan: '2 דק׳ ריצה / 2 דק׳ הליכה (5 חזרות)' },
      { week: 4, sessions: 3, plan: '3 דק׳ ריצה / 2 דק׳ הליכה (4 חזרות)' },
      { week: 5, sessions: 3, plan: '5 דק׳ ריצה / 2 דק׳ הליכה (3 חזרות)' },
      { week: 6, sessions: 3, plan: '8 דק׳ ריצה / 2 דק׳ הליכה (2 חזרות) + 5 דק׳ ריצה' },
      { week: 7, sessions: 3, plan: '15 דק׳ ריצה / 2 דק׳ הליכה / 10 דק׳ ריצה' },
      { week: 8, sessions: 3, plan: '5 ק״מ ריצה רציפה' },
    ],
  },
  {
    id: 'beginner-10k',
    name: 'הכנה ל-10 ק״מ (10 שבועות)',
    target: 'ריצה רציפה של 10 ק״מ',
    suitable: 'רצים שכבר רצים 5 ק״מ',
    weeks: [
      { week: 1, sessions: 3, plan: '5+5+3 ק״מ' },
      { week: 2, sessions: 3, plan: '5+6+4 ק״מ' },
      { week: 3, sessions: 3, plan: '5+7+5 ק״מ' },
      { week: 4, sessions: 3, plan: '5+8+5 ק״מ' },
      { week: 5, sessions: 3, plan: '6+9+5 ק״מ' },
      { week: 6, sessions: 4, plan: '6+10+5+3 ק״מ' },
      { week: 7, sessions: 4, plan: '6+10+5+4 ק״מ' },
      { week: 8, sessions: 4, plan: '6+12+5+4 ק״מ' },
      { week: 9, sessions: 3, plan: '6+8+5 ק״מ (טייפר)' },
      { week: 10, sessions: 2, plan: '5 ק״מ + מירוץ 10 ק״מ' },
    ],
  },
];

// LISS = Low Intensity Steady State
export const LISS_PROTOCOLS = [
  {
    name: 'הליכה ארוכה',
    duration: '45-60 דקות',
    intensity: 'Zone 2',
    purpose: 'שריפת שומן, התאוששות',
    notes: 'יכול להיות בכל יום, גם ביום מנוחה',
  },
  {
    name: 'אופניים נייחים',
    duration: '30-45 דקות',
    intensity: 'Zone 2',
    purpose: 'קרדיו ידידותי למפרקים',
    notes: 'אידיאלי לאחר אימון כוח כדי לעזור להתאוששות',
  },
  {
    name: 'שחיה',
    duration: '30 דקות',
    intensity: 'Zone 2-3',
    purpose: 'גוף מלא, אפס עומס',
    notes: 'מצוין ליום מנוחה אקטיבי',
  },
];
