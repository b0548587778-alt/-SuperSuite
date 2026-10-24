// ═══════════════════════════════════════════════════════════════════
//                   FOOD DATABASE — Israeli/Kosher
// ═══════════════════════════════════════════════════════════════════
// Per 100g unless specified. ערכים ממוצעים לפי טבלאות תזונה מקובלות — למוצר מסוים קובעת התווית שלו.
// kcal, p (protein g), c (carbs g), f (fat g)
import { ACTIVITY_LEVELS } from './constants.js';

export const FOODS = [
  // === חלבונים ===
  { id: 'chicken-breast', name: 'חזה עוף', cat: 'protein', kcal: 165, p: 31, c: 0, f: 3.6, unit: '100 גרם' },
  { id: 'chicken-thigh', name: 'ירך עוף', cat: 'protein', kcal: 209, p: 26, c: 0, f: 11, unit: '100 גרם' },
  { id: 'turkey-breast', name: 'חזה הודו', cat: 'protein', kcal: 135, p: 30, c: 0, f: 1, unit: '100 גרם' },
  { id: 'beef-lean', name: 'בקר רזה', cat: 'protein', kcal: 250, p: 26, c: 0, f: 17, unit: '100 גרם' },
  { id: 'salmon', name: 'סלמון', cat: 'protein', kcal: 208, p: 20, c: 0, f: 13, unit: '100 גרם' },
  { id: 'tuna-water', name: 'טונה במים', cat: 'protein', kcal: 116, p: 26, c: 0, f: 1, unit: '100 גרם' },
  { id: 'tilapia', name: 'אמנון (טילפיה)', cat: 'protein', kcal: 96, p: 20, c: 0, f: 2, unit: '100 גרם' },
  { id: 'egg', name: 'ביצה גדולה', cat: 'protein', kcal: 70, p: 6, c: 0.5, f: 5, unit: 'יחידה (50 גרם)' },
  { id: 'egg-whites', name: 'חלבון ביצה', cat: 'protein', kcal: 17, p: 3.6, c: 0.2, f: 0, unit: 'יחידה' },
  { id: 'cottage-5', name: 'קוטג׳ 5%', cat: 'protein', kcal: 105, p: 11, c: 3, f: 5, unit: '100 גרם' },
  { id: 'cottage-3', name: 'קוטג׳ 3%', cat: 'protein', kcal: 88, p: 11, c: 3, f: 3, unit: '100 גרם' },
  { id: 'cottage-9', name: 'קוטג׳ 9%', cat: 'protein', kcal: 130, p: 11, c: 3, f: 9, unit: '100 גרם' },
  { id: 'yogurt-plain', name: 'יוגורט לבן 3%', cat: 'protein', kcal: 60, p: 4, c: 5, f: 3, unit: '100 גרם' },
  { id: 'greek-yogurt', name: 'יוגורט יווני 0%', cat: 'protein', kcal: 60, p: 10, c: 4, f: 0, unit: '100 גרם' },
  { id: 'feta', name: 'גבינה בולגרית 5%', cat: 'protein', kcal: 75, p: 12, c: 1, f: 5, unit: '100 גרם' },
  { id: 'tofu', name: 'טופו', cat: 'protein', kcal: 76, p: 8, c: 1.9, f: 4.8, unit: '100 גרם' },
  { id: 'protein-powder', name: 'אבקת חלבון (מנה)', cat: 'protein', kcal: 120, p: 24, c: 3, f: 1.5, unit: 'מנה (30 גרם)' },

  // === קטניות ===
  { id: 'lentils-cooked', name: 'עדשים מבושלות', cat: 'protein', kcal: 116, p: 9, c: 20, f: 0.4, unit: '100 גרם' },
  { id: 'chickpeas-cooked', name: 'חומוס מבושל', cat: 'protein', kcal: 164, p: 9, c: 27, f: 2.6, unit: '100 גרם' },
  { id: 'black-beans', name: 'שעועית שחורה', cat: 'protein', kcal: 132, p: 9, c: 24, f: 0.5, unit: '100 גרם' },

  // === פחמימות ===
  { id: 'rice-white-cooked', name: 'אורז לבן מבושל', cat: 'carb', kcal: 130, p: 2.7, c: 28, f: 0.3, unit: '100 גרם' },
  { id: 'rice-brown-cooked', name: 'אורז מלא מבושל', cat: 'carb', kcal: 111, p: 2.6, c: 23, f: 0.9, unit: '100 גרם' },
  { id: 'pasta-cooked', name: 'פסטה מבושלת', cat: 'carb', kcal: 131, p: 5, c: 25, f: 1.1, unit: '100 גרם' },
  { id: 'whole-pasta', name: 'פסטה מחיטה מלאה', cat: 'carb', kcal: 124, p: 5, c: 26, f: 1.1, unit: '100 גרם' },
  { id: 'potato', name: 'תפוח אדמה מבושל', cat: 'carb', kcal: 87, p: 1.9, c: 20, f: 0.1, unit: '100 גרם' },
  { id: 'sweet-potato', name: 'בטטה מבושלת', cat: 'carb', kcal: 86, p: 1.6, c: 20, f: 0.1, unit: '100 גרם' },
  { id: 'oats', name: 'שיבולת שועל יבשה', cat: 'carb', kcal: 389, p: 17, c: 66, f: 7, unit: '100 גרם' },
  { id: 'oats-50g', name: 'שיבולת שועל (מנה 50 גרם)', cat: 'carb', kcal: 195, p: 8.5, c: 33, f: 3.5, unit: 'מנה (50 גרם)' },
  { id: 'pita', name: 'פיתה לבנה', cat: 'carb', kcal: 165, p: 5.5, c: 33, f: 1, unit: 'יחידה (60 גרם)' },
  { id: 'pita-whole', name: 'פיתה מחיטה מלאה', cat: 'carb', kcal: 145, p: 6, c: 28, f: 1.5, unit: 'יחידה (60 גרם)' },
  { id: 'bread-white', name: 'לחם לבן', cat: 'carb', kcal: 75, p: 2.5, c: 14, f: 1, unit: 'פרוסה (28 גרם)' },
  { id: 'bread-whole', name: 'לחם מחיטה מלאה', cat: 'carb', kcal: 70, p: 3.5, c: 12, f: 1, unit: 'פרוסה (28 גרם)' },
  { id: 'matza', name: 'מצה', cat: 'carb', kcal: 110, p: 3, c: 23, f: 0.3, unit: 'יחידה (28 גרם)' },
  { id: 'couscous-cooked', name: 'קוסקוס מבושל', cat: 'carb', kcal: 112, p: 3.8, c: 23, f: 0.2, unit: '100 גרם' },
  { id: 'bulgur-cooked', name: 'בורגול מבושל', cat: 'carb', kcal: 83, p: 3, c: 19, f: 0.2, unit: '100 גרם' },
  { id: 'quinoa-cooked', name: 'קינואה מבושלת', cat: 'carb', kcal: 120, p: 4.4, c: 21, f: 1.9, unit: '100 גרם' },

  // === ירקות ===
  { id: 'cucumber', name: 'מלפפון', cat: 'veg', kcal: 15, p: 0.7, c: 3.6, f: 0.1, unit: '100 גרם' },
  { id: 'tomato', name: 'עגבנייה', cat: 'veg', kcal: 18, p: 0.9, c: 3.9, f: 0.2, unit: '100 גרם' },
  { id: 'pepper', name: 'פלפל', cat: 'veg', kcal: 31, p: 1, c: 6, f: 0.3, unit: '100 גרם' },
  { id: 'lettuce', name: 'חסה', cat: 'veg', kcal: 15, p: 1.4, c: 2.9, f: 0.2, unit: '100 גרם' },
  { id: 'onion', name: 'בצל', cat: 'veg', kcal: 40, p: 1.1, c: 9, f: 0.1, unit: '100 גרם' },
  { id: 'carrot', name: 'גזר', cat: 'veg', kcal: 41, p: 0.9, c: 10, f: 0.2, unit: '100 גרם' },
  { id: 'broccoli', name: 'ברוקולי', cat: 'veg', kcal: 34, p: 2.8, c: 7, f: 0.4, unit: '100 גרם' },
  { id: 'cauliflower', name: 'כרובית', cat: 'veg', kcal: 25, p: 1.9, c: 5, f: 0.3, unit: '100 גרם' },
  { id: 'spinach', name: 'תרד', cat: 'veg', kcal: 23, p: 2.9, c: 3.6, f: 0.4, unit: '100 גרם' },
  { id: 'zucchini', name: 'קישוא', cat: 'veg', kcal: 17, p: 1.2, c: 3.1, f: 0.3, unit: '100 גרם' },
  { id: 'eggplant', name: 'חציל', cat: 'veg', kcal: 25, p: 1, c: 6, f: 0.2, unit: '100 גרם' },

  // === פירות ===
  { id: 'apple', name: 'תפוח', cat: 'fruit', kcal: 52, p: 0.3, c: 14, f: 0.2, unit: '100 גרם' },
  { id: 'banana', name: 'בננה', cat: 'fruit', kcal: 89, p: 1.1, c: 23, f: 0.3, unit: '100 גרם' },
  { id: 'orange', name: 'תפוז', cat: 'fruit', kcal: 47, p: 0.9, c: 12, f: 0.1, unit: '100 גרם' },
  { id: 'strawberry', name: 'תות', cat: 'fruit', kcal: 32, p: 0.7, c: 8, f: 0.3, unit: '100 גרם' },
  { id: 'grape', name: 'ענבים', cat: 'fruit', kcal: 67, p: 0.6, c: 17, f: 0.4, unit: '100 גרם' },
  { id: 'date', name: 'תמר', cat: 'fruit', kcal: 277, p: 1.8, c: 75, f: 0.2, unit: '100 גרם' },
  { id: 'blueberry', name: 'אוכמניות', cat: 'fruit', kcal: 57, p: 0.7, c: 14, f: 0.3, unit: '100 גרם' },
  { id: 'avocado', name: 'אבוקדו', cat: 'fat', kcal: 160, p: 2, c: 9, f: 15, unit: '100 גרם' },

  // === שומנים ===
  { id: 'olive-oil', name: 'שמן זית', cat: 'fat', kcal: 119, p: 0, c: 0, f: 14, unit: 'כף (15 מ"ל)' },
  { id: 'tahini', name: 'טחינה גולמית', cat: 'fat', kcal: 595, p: 17, c: 21, f: 53, unit: '100 גרם' },
  { id: 'tahini-tbsp', name: 'טחינה (כף)', cat: 'fat', kcal: 89, p: 2.5, c: 3, f: 8, unit: 'כף (15 גרם)' },
  { id: 'almonds', name: 'שקדים', cat: 'fat', kcal: 579, p: 21, c: 22, f: 50, unit: '100 גרם' },
  { id: 'almonds-30g', name: 'שקדים (חופן)', cat: 'fat', kcal: 174, p: 6.3, c: 6.6, f: 15, unit: 'חופן (30 גרם)' },
  { id: 'walnuts', name: 'אגוזי מלך', cat: 'fat', kcal: 654, p: 15, c: 14, f: 65, unit: '100 גרם' },
  { id: 'peanut-butter', name: 'חמאת בוטנים', cat: 'fat', kcal: 588, p: 25, c: 20, f: 50, unit: '100 גרם' },
  { id: 'peanut-butter-tbsp', name: 'חמאת בוטנים (כף)', cat: 'fat', kcal: 94, p: 4, c: 3.2, f: 8, unit: 'כף (16 גרם)' },
  { id: 'butter', name: 'חמאה', cat: 'fat', kcal: 717, p: 0.9, c: 0.1, f: 81, unit: '100 גרם' },

  // === מזונות מוכנים נפוצים בישראל ===
  { id: 'hummus', name: 'חומוס מוכן', cat: 'mixed', kcal: 166, p: 8, c: 14, f: 10, unit: '100 גרם' },
  { id: 'shakshuka', name: 'שקשוקה (2 ביצים, רוטב)', cat: 'mixed', kcal: 280, p: 16, c: 12, f: 18, unit: 'מנה' },
  { id: 'falafel-ball', name: 'פלאפל (כדור)', cat: 'mixed', kcal: 60, p: 2.5, c: 5, f: 4, unit: 'כדור (17 גרם)' },
  { id: 'salad-israeli', name: 'סלט ישראלי (200 גרם)', cat: 'veg', kcal: 80, p: 2, c: 10, f: 4, unit: 'מנה' },
  { id: 'cholent', name: 'חמין (מנה)', cat: 'shabbat', kcal: 450, p: 25, c: 50, f: 18, unit: 'מנה' },
  { id: 'kugel-potato', name: 'קוגל תפוח אדמה (פרוסה)', cat: 'shabbat', kcal: 200, p: 4, c: 22, f: 10, unit: 'פרוסה' },
  { id: 'gefilte', name: 'גפילטע פיש', cat: 'shabbat', kcal: 84, p: 9, c: 5, f: 3, unit: '100 גרם' },
  { id: 'milk-3', name: 'חלב 3%', cat: 'protein', kcal: 60, p: 3.4, c: 4.9, f: 3, unit: '100 מ"ל' },
  { id: 'milk-1', name: 'חלב 1%', cat: 'protein', kcal: 42, p: 3.4, c: 5, f: 1, unit: '100 מ"ל' },

  // === מוצרי חלב נוספים ===
  { id: 'white-cheese-5', name: 'גבינה לבנה 5%', cat: 'protein', kcal: 95, p: 9, c: 4, f: 5, unit: '100 גרם' },
  { id: 'yellow-cheese-28', name: 'גבינה צהובה 28%', cat: 'protein', kcal: 356, p: 27, c: 0, f: 28, unit: '100 גרם' },
  { id: 'labane-5', name: 'לבנה 5%', cat: 'protein', kcal: 103, p: 6, c: 4, f: 5, unit: '100 גרם' },

  // === חלבונים נוספים ===
  { id: 'tuna-oil', name: 'טונה בשמן (מסוננת)', cat: 'protein', kcal: 198, p: 29, c: 0, f: 8, unit: '100 גרם' },
  { id: 'chicken-roast', name: 'עוף בתנור עם עור', cat: 'protein', kcal: 239, p: 27, c: 0, f: 14, unit: '100 גרם' },
  { id: 'schnitzel', name: 'שניצל עוף מטוגן', cat: 'protein', kcal: 260, p: 18, c: 13, f: 15, unit: '100 גרם' },

  // === פחמימות נוספות ===
  { id: 'challah', name: 'חלה', cat: 'shabbat', kcal: 287, p: 7.6, c: 48, f: 7.3, unit: '100 גרם' },
  { id: 'rye-bread', name: 'לחם שיפון', cat: 'carb', kcal: 259, p: 8.5, c: 48, f: 3.3, unit: '100 גרם' },
  { id: 'rice-cake', name: 'פריכית אורז', cat: 'carb', kcal: 35, p: 0.7, c: 7.3, f: 0.3, unit: 'יחידה (9 גרם)' },
  { id: 'ptitim-dry', name: 'פתיתים (יבש)', cat: 'carb', kcal: 357, p: 12, c: 74, f: 1.5, unit: '100 גרם' },
  { id: 'corn', name: 'תירס', cat: 'carb', kcal: 86, p: 3.3, c: 19, f: 1.4, unit: '100 גרם' },

  // === ירקות נוספים ===
  { id: 'cabbage', name: 'כרוב', cat: 'veg', kcal: 25, p: 1.3, c: 6, f: 0.1, unit: '100 גרם' },
  { id: 'beet', name: 'סלק', cat: 'veg', kcal: 43, p: 1.6, c: 10, f: 0.2, unit: '100 גרם' },
  { id: 'mushrooms', name: 'פטריות', cat: 'veg', kcal: 22, p: 3.1, c: 3.3, f: 0.3, unit: '100 גרם' },
  { id: 'green-beans', name: 'שעועית ירוקה', cat: 'veg', kcal: 31, p: 1.8, c: 7, f: 0.2, unit: '100 גרם' },
  { id: 'peas', name: 'אפונה ירוקה', cat: 'veg', kcal: 81, p: 5.4, c: 14, f: 0.4, unit: '100 גרם' },

  // === פירות נוספים ===
  { id: 'watermelon', name: 'אבטיח', cat: 'fruit', kcal: 30, p: 0.6, c: 7.6, f: 0.2, unit: '100 גרם' },
  { id: 'melon', name: 'מלון', cat: 'fruit', kcal: 34, p: 0.8, c: 8, f: 0.2, unit: '100 גרם' },
  { id: 'mango', name: 'מנגו', cat: 'fruit', kcal: 60, p: 0.8, c: 15, f: 0.4, unit: '100 גרם' },
  { id: 'clementine', name: 'קלמנטינה', cat: 'fruit', kcal: 53, p: 0.8, c: 13, f: 0.3, unit: '100 גרם' },
  { id: 'peach', name: 'אפרסק', cat: 'fruit', kcal: 39, p: 0.9, c: 10, f: 0.3, unit: '100 גרם' },
  { id: 'pear', name: 'אגס', cat: 'fruit', kcal: 57, p: 0.4, c: 15, f: 0.1, unit: '100 גרם' },
  { id: 'plum', name: 'שזיף', cat: 'fruit', kcal: 46, p: 0.7, c: 11, f: 0.3, unit: '100 גרם' },

  // === שומנים נוספים ===
  { id: 'olives', name: 'זיתים שחורים', cat: 'fat', kcal: 115, p: 0.8, c: 6.3, f: 10.7, unit: '100 גרם' },
  { id: 'pumpkin-seeds', name: 'גרעיני דלעת', cat: 'fat', kcal: 559, p: 30, c: 11, f: 49, unit: '100 גרם' },
  { id: 'cashew', name: 'אגוזי קשיו', cat: 'fat', kcal: 553, p: 18, c: 30, f: 44, unit: '100 גרם' },

  // === משקאות ===
  { id: 'orange-juice', name: 'מיץ תפוזים טבעי', cat: 'mixed', kcal: 45, p: 0.7, c: 10, f: 0.2, unit: '100 מ"ל' },
];

// ═══════════════════════════════════════════════════════════════════
// Calorie & Macro Calculator (Mifflin-St Jeor + activity multiplier)
// ═══════════════════════════════════════════════════════════════════

export function calculateBMR({ weight, height, age, gender }) {
  if (!(weight > 0 && height > 0 && age > 0)) return 0;
  // Mifflin-St Jeor
  const bmr = gender === 'female'
    ? Math.round(10 * weight + 6.25 * height - 5 * age - 161)
    : Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  // קלט מופרך (גיל 200 וכד') נותן מספר שלילי — אין חישוב, לא יעד שלילי
  return bmr > 0 ? bmr : 0;
}

export function calculateTDEE(bmr, activityMult) {
  return Math.round(bmr * activityMult);
}

const GOAL_ADJUST = {
  'weight-loss': -500,    // 500 cal deficit
  muscle: 300,            // 300 cal surplus
  strength: 200,          // small surplus
  endurance: 0,
  health: 0,
  rehab: 0,
  performance: 100,
  mobility: 0,
};

// רצפה ליעד היומי בלי ליווי רפואי: 1,200 קלוריות לאישה, 1,500 לגבר (המלצה מקובלת).
// הרצפה לא מעלה את היעד מעל התצרוכת — מי שהתצרוכת שלו נמוכה ממנה מקבל את התצרוכת, בלי גירעון.
// לפני כן אישה של 50 ק"ג, 150 ס"מ, גיל 60, יושבנית — קיבלה יעד של 672 קלוריות (בדיקת קוד 23.10.2026)
export const MIN_CALORIES = { female: 1200, male: 1500 };

// { calories, limited } — limited: היעד הוגבל ברצפה, והמסך מציג הערה
export function goalCalories(tdee, goal, { gender } = {}) {
  const raw = tdee + (GOAL_ADJUST[goal] || 0);
  const floor = MIN_CALORIES[gender === 'female' ? 'female' : 'male'];
  if (raw >= floor) return { calories: raw, limited: false };
  const calories = Math.min(floor, Math.max(tdee, raw));
  return { calories, limited: calories !== raw };
}

export function calculateGoalCalories(tdee, goal, opts) {
  return goalCalories(tdee, goal, opts).calories;
}

// חלבון לכל היותר 35% מהקלוריות (הטווח המקובל 10%–35%): במשקל גבוה וביעד נמוך החלבון לפי ק"ג
// "בלע" את כל היעד, והפחמימות יצאו שליליות בדוח למתאמן
export const MAX_PROTEIN_SHARE = 0.35;

export function calculateMacros(calories, weight, goal) {
  let proteinPerKg;

  // Protein per kg body weight
  if (goal === 'weight-loss' || goal === 'muscle') proteinPerKg = 2.0;
  else if (goal === 'strength' || goal === 'performance') proteinPerKg = 1.8;
  else proteinPerKg = 1.6;

  const cal = calories > 0 ? calories : 0;
  const protein = Math.min(Math.round((weight || 70) * proteinPerKg), Math.floor((cal * MAX_PROTEIN_SHARE) / 4));
  const proteinCal = protein * 4;

  // Fat as % of total
  const fatPercent = goal === 'weight-loss' ? 0.30 : 0.25;
  const fatCal = cal * fatPercent;
  const fat = Math.round(fatCal / 9);

  // Carbs fill the rest (לעולם לא שלילי)
  const carbCal = cal - proteinCal - fatCal;
  const carbs = Math.max(0, Math.round(carbCal / 4));

  return { protein, carbs, fat };
}

// רמת הפעילות של מתאמן: מהכרטיס; בלי ערך (כרטיס ישן) — "בינוני", מסומן assumed כדי שהמסך יבקש לעדכן
export function clientActivity(client) {
  const found = ACTIVITY_LEVELS.find((a) => a.id === client?.activityLevel);
  if (found) return { ...found, assumed: false };
  return { ...ACTIVITY_LEVELS.find((a) => a.id === 'moderate'), assumed: true };
}

// יעדי התזונה של מתאמן — מה שלשונית התזונה ודוח ה-PDF מציגים
export function clientNutrition(client) {
  const activity = clientActivity(client);
  const weight = +client?.weight;
  const bmr = calculateBMR({ weight, height: +client?.height, age: +client?.age, gender: client?.gender });
  const tdee = bmr ? calculateTDEE(bmr, activity.mult) : 0;
  const goal = tdee ? goalCalories(tdee, client.goal, { gender: client.gender }) : { calories: 0, limited: false };
  const macros = goal.calories ? calculateMacros(goal.calories, weight, client.goal) : { protein: 0, carbs: 0, fat: 0 };
  return { activity, bmr, tdee, targetCal: goal.calories, limited: goal.limited, macros };
}

// ═══════════════════════════════════════════════════════════════════
// Sample meal plans by goal & calorie level
// ═══════════════════════════════════════════════════════════════════

// סוג כל ארוחה: בשרי / חלבי / פרווה (דג וביצים — פרווה). התפריטים מסודרים בהפרדה בין בשר לחלב:
// אין חלב בארוחה בשרית, ואחרי ארוחה בשרית — שאר היום פרווה או בשרי (נבדק ב-tests/audit-trainer.test.js)
export const MEAL_KINDS = {
  meat: { label: 'בשרי', tone: 'red' },
  dairy: { label: 'חלבי', tone: 'indigo' },
  parve: { label: 'פרווה', tone: 'emerald' },
};

export const MEAL_PLANS = [
  {
    id: 'weight-loss-1800',
    name: 'ירידה במשקל - 1800 קלוריות',
    goal: 'weight-loss',
    targetCal: 1800,
    days: [
      {
        name: 'יום קלאסי',
        meals: [
          {
            name: 'בוקר (7:00)', kind: 'parve',
            items: ['3 חלבונים + 1 ביצה שלמה (אומלט)', '2 פרוסות לחם מחיטה מלאה', '1 עגבנייה ומלפפון', 'קפה שחור'],
            kcal: 380, p: 28, c: 32, f: 14,
          },
          {
            name: 'ביניים (10:30)', kind: 'dairy',
            items: ['יוגורט יווני 0% (200 גרם)', 'חופן שקדים', 'תפוח'],
            kcal: 320, p: 26, c: 28, f: 12,
          },
          {
            name: 'צהריים (13:00)', kind: 'meat',
            items: ['חזה עוף בגריל (150 גרם)', '½ כוס אורז מלא מבושל', 'סלט ירקות גדול עם שמן זית', 'ברוקולי מאודה'],
            kcal: 530, p: 48, c: 50, f: 14,
          },
          {
            name: 'ביניים (16:00)', kind: 'parve',
            items: ['2 ביצים קשות', 'ירקות חתוכים (מלפפון ופלפל)', '10 שקדים'],
            kcal: 240, p: 16, c: 11, f: 16,
          },
          {
            name: 'ערב (19:30)', kind: 'parve',
            items: ['פילה אמנון בתנור (150 גרם)', 'בטטה אפויה (150 גרם)', 'סלט ירוק עם טחינה (כף)'],
            kcal: 420, p: 38, c: 35, f: 12,
          },
        ],
      },
    ],
  },
  {
    id: 'muscle-2800',
    name: 'בנייה - 2800 קלוריות',
    goal: 'muscle',
    targetCal: 2800,
    days: [
      {
        name: 'יום בנייה',
        meals: [
          {
            name: 'בוקר (7:00)', kind: 'dairy',
            items: ['שיבולת שועל 60 גרם עם חלב 1% (200 מ"ל)', 'בננה', '2 כפות חמאת בוטנים', 'אבקת חלבון (מנה)'],
            kcal: 720, p: 48, c: 80, f: 22,
          },
          {
            name: 'ביניים (10:30)', kind: 'parve',
            items: ['5 ביצים (3 שלמות + 2 חלבונים)', '2 פרוסות לחם', 'אבוקדו (חצי)'],
            kcal: 540, p: 32, c: 30, f: 30,
          },
          {
            name: 'צהריים (13:00)', kind: 'meat',
            items: ['חזה עוף (200 גרם)', 'אורז לבן מבושל (150 גרם)', 'סלט עם שמן זית'],
            kcal: 600, p: 60, c: 65, f: 12,
          },
          {
            name: 'לפני אימון (17:00)', kind: 'parve',
            items: ['תפוח', '20 שקדים', 'פרוסת לחם מחיטה מלאה עם ביצה קשה'],
            kcal: 360, p: 15, c: 39, f: 18,
          },
          {
            name: 'אחרי אימון (19:30)', kind: 'meat',
            items: ['בקר רזה (200 גרם)', 'תפוח אדמה אפוי גדול (250 גרם)', 'סלט ירוק'],
            kcal: 590, p: 58, c: 56, f: 15,
          },
        ],
      },
    ],
  },
  {
    id: 'kosher-shabbat',
    name: 'תפריט שבת מאוזן',
    goal: 'health',
    targetCal: 2200,
    days: [
      {
        name: 'שבת',
        meals: [
          {
            name: 'ארוחת שבת בוקר', kind: 'dairy',
            items: ['2 ביצים', 'סלט ירקות חתוכים', 'גבינה בולגרית 5% (50 גרם)', '2 פרוסות לחם / חלה'],
            kcal: 480, p: 28, c: 35, f: 22,
          },
          {
            name: 'ארוחת שבת צהריים', kind: 'meat',
            // דג ובשר אוכלים בנפרד — הדג מנה ראשונה, לפני הבשר
            items: ['גפילטע פיש (מנה נפרדת בתחילת הסעודה)', 'חמין מנה (כוס)', 'סלט ירקות', 'מנה קטנה של קוגל'],
            kcal: 850, p: 40, c: 75, f: 35,
          },
          {
            name: 'סעודה שלישית', kind: 'parve',
            items: ['סלט טונה במים (100 גרם)', 'סלט גדול', 'פיתה'],
            kcal: 360, p: 34, c: 43, f: 6,
          },
          {
            name: 'מוצאי שבת', kind: 'parve',
            items: ['2 ביצים קשות', 'פרוסת לחם מחיטה מלאה', 'ירקות חתוכים'],
            kcal: 240, p: 17, c: 19, f: 11,
          },
        ],
        notes: 'חשוב: אכילה איטית והדרגתית. שתיית מים בין מנות. הימנעות ממאכלים מטוגנים.',
      },
    ],
  },
];

// Nutrition tips
export const NUTRITION_TIPS = [
  {
    title: 'תזמון חלבון',
    body: 'פיזור חלבון של 25-40 גרם בכל 3-4 שעות לאורך היום מקסם את סינתזת השריר. לא צריך לאכול הכל מיד אחרי האימון.',
  },
  {
    title: 'מים',
    body: 'שתה 30-40 מ"ל לכל ק"ג משקל גוף ביום. מתאמן של 70 ק"ג צריך 2.1-2.8 ליטר. הוסף 500 מ"ל לכל שעת אימון.',
  },
  {
    title: 'לפני אימון',
    body: 'ארוחה 60-90 דקות לפני אימון: פחמימות + חלבון, מעט שומן. למשל: בננה + יוגורט יווני, או פרוסת לחם + קוטג׳.',
  },
  {
    title: 'אחרי אימון',
    body: 'תוך 1-2 שעות אחרי: 20-40 גרם חלבון + פחמימות. למשל: חזה עוף עם אורז, או אבקת חלבון עם בננה.',
  },
  {
    title: 'גירעון לירידה במשקל',
    body: 'גירעון של 300-500 קלוריות ליום = ירידה של 0.3-0.5 ק"ג בשבוע. אל תרד מהר מדי — תאבד גם שריר.',
  },
  {
    title: 'עודף לבנייה',
    body: 'עודף של 200-400 קלוריות ליום = עלייה של 0.2-0.4 ק"ג בשבוע. עלייה מהירה יותר = יותר שומן.',
  },
  {
    title: 'סיבים',
    body: 'יעד: 25-35 גרם סיבים ליום. מקורות עיקריים: שיבולת שועל, קטניות, ירקות מבושלים, פירות עם קליפה.',
  },
  {
    title: 'אלכוהול',
    body: 'אלכוהול מעכב סינתזת חלבון ל-24 שעות. ממעיט תוצאות אימון. מומלץ למזער במיוחד בתקופות בנייה.',
  },
];
