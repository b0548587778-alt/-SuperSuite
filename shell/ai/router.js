// מסנן המחשבה של עוזר ה-AI: איזה מנוע יענה על השאלה.
// פונקציה טהורה — בלי Electron, בלי קבצים ובלי רשת. לכן אפשר לבדוק אותה במלואה.
//
//   'cloud' — מודל שפה בענן; רק בהסכמה מפורשת, בזכאות רישיון ובלغة „מוכן”.
//   'local' — מודל שפה מקומי (GGUF) אם ארוז והוא מוכן.
//   'rules' — מנוע הכללים הדטרמיניסטי. תמיד עובד, גם בלי רשת ובלי מודל.
const LOCAL_MODES = new Set(['ready', 'degraded']);

function normalizePrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  return {
    engine: p.engine === 'cloud-when-available' ? 'cloud-when-available' : 'local-only',
    conceal: p.conceal !== false, // ברירת מחדל: הסתרת מזהים
    consent: p.consent && p.consent.cloud === true ? true : false,
  };
}

// status = { local: { mode }, cloud: { ready, eligible }, task }
function choose({ task, prefs, status } = {}) {
  const p = normalizePrefs(prefs);
  if (task === 'explain' || task === 'rules') return 'rules';
  const s = status && typeof status === 'object' ? status : {};
  const cloud = s.cloud && typeof s.cloud === 'object' ? s.cloud : {};
  const local = s.local && typeof s.local === 'object' ? s.local : {};

  // הענן הוא „שדרוג”: בלי הסכמה ובלי זכאות הוא לא נבחר, גם אם המשתמש ביקש
  if (p.engine === 'cloud-when-available' && p.consent && cloud.eligible === true && cloud.ready === true) return 'cloud';
  // 'degraded' — המודל המקומי טעון חלקית; עדיין מקומי, ועדיף על כללים
  if (LOCAL_MODES.has(local.mode)) return 'local';
  return 'rules';
}

// תשובה ידידותית למשתמש שלא קרה כלום — בלי לחשוף מונחים טכניים
function engineLabel(engine) {
  return engine === 'cloud' ? 'ענן (בהסכמה)' : engine === 'local' ? 'מקומי' : 'כללי המערכת';
}

// זכאות למודל המקומי: תוסף בתשלום — רק רישיון פעיל עם 'ai.local'. בלי רישיון (מצב פתוח) — אין מודל
function localLicensed(state) {
  return !!state && state.mode === 'licensed' && state.status === 'active'
    && Array.isArray(state.features) && state.features.includes('ai.local');
}

// סוג המשימה מתוך השאלה: ניסוח מכתב/קבלה, סיכום דוח, או שאלה רגילה
const TASK_WORDS = [
  { task: 'letter', re: /מכתב תודה|מכתב הוקרה|נסח(?:ו|י)? (?:מכתב|קבלה|נוסח)|נוסח (?:קבלה|תודה)|טקסט לקבלה/ },
  { task: 'summary', re: /סכם|סכמו|סכמי|תסכם|סיכום (?:של )?(?:ה)?דוח|תקציר/ },
];
function detectTask(question) {
  const q = String(question || '');
  for (const t of TASK_WORDS) if (t.re.test(q)) return t.task;
  return 'answer';
}

// „כללים קודם”: שאלה שמנוע הכללים מזהה (כוונה או תחום) נענית בו — דטרמיניסטי ומהיר.
// המודל המקומי עונה רק על מה שהכללים לא מבינים, ועל ניסוח וסיכום — ורק כשהוא מוכן
function routeQuestion({ task, intent, domain, localReady } = {}) {
  if (!localReady) return 'rules';
  if (task === 'letter' || task === 'summary') return 'local';
  if (intent && intent !== 'general') return 'rules';
  if (domain) return 'rules';
  return 'local';
}

module.exports = { choose, normalizePrefs, engineLabel, localLicensed, detectTask, routeQuestion };
