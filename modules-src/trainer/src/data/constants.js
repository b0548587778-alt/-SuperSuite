export const MEDICAL_CONDITIONS = [
  { id: 'back', label: 'גב תחתון', warning: 'הימנע מדדליפט קונבנציונלי כבד, סקוואט עמוק ומעומסים ציריים. הדגש על חיזוק ליבה ושרירי גב עמוקים.' },
  { id: 'knee', label: 'ברכיים', warning: 'הימנע מסקוואט עמוק, לאנג׳ים עמוקים, קפיצות וחבטות. העדף מנופים ארוכים ותרגילים סגורי-שרשרת.' },
  { id: 'shoulder', label: 'כתפיים', warning: 'הימנע מלחיצה מעל הראש, שכיבות סמיכה עמוקות ומשיכות כבדות. התחל בטווחים חלקיים.' },
  { id: 'hypertension', label: 'יתר לחץ דם', warning: 'ללא תרגילים איזומטריים ארוכים, ללא Valsalva. אינטנסיביות מתונה בלבד.' },
  { id: 'heart', label: 'לב', warning: 'חובה אישור רופא. עצימות נמוכה-בינונית, ללא HIIT.' },
  { id: 'diabetes', label: 'סוכרת', warning: 'ודא רמת גלוקוז לפני ואחרי. הזמן ארוחה 60-90 דק׳ לפני אימון.' },
  { id: 'pregnancy', label: 'הריון', warning: 'ללא שכיבה על הגב אחרי טרימסטר ראשון. ללא בטן ישרה. דגש על רצפת אגן וליבה רוחבית.' },
  { id: 'asthma', label: 'אסתמה', warning: 'משאף זמין. חימום ארוך (10+ דק׳). הימנע מעצימות מקסימלית.' },
  { id: 'obesity', label: 'השמנה', warning: 'תרגילים סגורי-שרשרת ללא קפיצות. דגש על בריאות מפרקים ועומסים הדרגתיים.' },
  { id: 'osteoporosis', label: 'אוסטאופורוזיס', warning: 'ללא כפיפות קדימה עם עומס, ללא פיתולים אגרסיביים. דגש על תרגילי עמידות והעמסה ציר.' },
  { id: 'disc', label: 'פריצת דיסק', warning: 'ללא כפיפות קדימה, ללא דדליפט קונבנציונלי, ללא עומס צירי. פרוטוקול מקנג׳י לפי אבחון.' },
  { id: 'hip', label: 'ירכיים', warning: 'הימנע מכפיפה עמוקה מעבר ל-90°. סקוואט חלקי ומנופים מוגבלים.' },
];

export const GOALS = [
  { id: 'weight-loss', label: 'ירידה במשקל', desc: 'גירעון קלורי + שמירה על מסה' },
  { id: 'muscle', label: 'היפרטרופיה', desc: 'בניית מסת שריר' },
  { id: 'strength', label: 'כוח', desc: 'כוח מקסימלי' },
  { id: 'endurance', label: 'סיבולת', desc: 'סיבולת שרירית וקרדיו' },
  { id: 'health', label: 'בריאות כללית', desc: 'שיפור כללי ואיכות חיים' },
  { id: 'rehab', label: 'שיקומי', desc: 'חזרה מפציעה / שיקום' },
  { id: 'performance', label: 'ביצועים ספורטיביים', desc: 'ספציפי לענף ספורט' },
  { id: 'mobility', label: 'ניידות וגמישות', desc: 'טווחי תנועה וגמישות' },
];

export const EQUIPMENT = [
  { id: 'bw', label: 'משקל גוף' },
  { id: 'dumbbells', label: 'משקולות יד' },
  { id: 'barbell', label: 'מוט ופלטות' },
  { id: 'bands', label: 'גומיות התנגדות' },
  { id: 'kettlebell', label: 'קטלבל' },
  { id: 'cable', label: 'כבלים' },
  { id: 'machines', label: 'מכונות' },
  { id: 'bench', label: 'ספסל' },
  { id: 'pull-up', label: 'מתח' },
  { id: 'cardio', label: 'ציוד קרדיו' },
];

export const LEVELS = [
  { id: 'beginner', label: 'מתחיל' },
  { id: 'intermediate', label: 'בינוני' },
  { id: 'advanced', label: 'מתקדם' },
];

export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'יושבני', mult: 1.2, desc: 'עבודת משרד, ללא פעילות' },
  { id: 'light', label: 'קל', mult: 1.375, desc: '1-2 אימונים בשבוע' },
  { id: 'moderate', label: 'בינוני', mult: 1.55, desc: '3-5 אימונים בשבוע' },
  // עד 6 אימונים — בלי שבת (MAX_TRAINING_DAYS ב-lib/program.js)
  { id: 'active', label: 'פעיל', mult: 1.725, desc: '6 אימונים בשבוע (כל ימי החול)' },
  { id: 'very-active', label: 'פעיל מאוד', mult: 1.9, desc: 'עבודה פיזית + אימונים' },
];
