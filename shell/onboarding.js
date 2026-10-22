// אשף התחלה: המשתמש בוחר מה הוא עושה (עמותה, גמ"ח, עסק...) ומקבל מסך בית מותאם —
// "המסכים שלי" וצעדים ראשונים. רק בחירת מסכים והמלצות; שום נתון לא נוצר או נמחק.
// כמו catalog.js: נטען גם בדפדפן (window.SUITE_ONBOARDING) וגם ב-Node (בדיקות).
(function (root) {
  const PROFILES = [
    { id: 'npo', icon: '🤝', name: 'עמותה / מוסד תורני', desc: 'תרומות, קבלות סעיף 46, תמיכות והנצחות',
      screens: ['econ:npo', 'econ:people'],
      steps: [
        { id: 'npo-settings', title: 'הגדרות העמותה', detail: 'מספר עמותה, אישור סעיף 46 וקרנות — לפני הקבלה הראשונה', key: 'econ:npo' },
        { id: 'npo-first-receipt', title: 'קבלה ראשונה', detail: 'בלוח הבקרה: "הפקת קבלה ראשונה". רוצים קודם לראות איך זה נראה? "הכנסת נתוני דוגמה" — ומחיקה בלחיצה', key: 'econ:dashboard' },
        { id: 'npo-import', title: 'ייבוא תרומות קיימות', detail: 'קובץ CSV מנדרים פלוס, קהילות, Charidy או דף בנק — במסך העמותה', key: 'econ:npo' },
      ] },
    { id: 'gemach', icon: '🫱', name: 'גמ"ח', desc: 'הלוואות ללא ריבית, ערבים וגמ"ח חפצים',
      screens: ['econ:gemach', 'econ:people'],
      steps: [{ id: 'gemach-settings', title: 'הגדרות הגמ"ח', detail: 'שם הגמ"ח ותקרות — ואז ההלוואה הראשונה', key: 'econ:gemach' }] },
    { id: 'chesed', icon: '📦', name: 'חסד וחלוקות', desc: 'נזקקים, מתנדבים וסבבי חלוקה',
      screens: ['econ:chesed', 'econ:people'],
      steps: [{ id: 'chesed-first', title: 'רישום נזקקים ומתנדבים', detail: 'נזקק חסוי מוסתר מכל מי שאינו מנהל', key: 'econ:chesed' }] },
    { id: 'business', icon: '🧾', name: 'עסק', desc: 'חשבוניות מס, מע"מ, מחירון ודוחות',
      screens: ['econ:dashboard', 'econ:acct-invoices', 'econ:acct-reports', 'econ:acct-pricing', 'econ:contacts'],
      steps: [
        { id: 'acct-settings', title: 'פרטי העסק', detail: 'סוג עוסק, מספר עוסק ומספור חשבוניות', key: 'econ:acct-settings' },
        { id: 'acct-pricing', title: 'מחירון', detail: 'הקלדה או ייבוא מקובץ CSV', key: 'econ:acct-pricing' },
      ] },
    { id: 'household', icon: '🏠', name: 'משק בית', desc: 'תקציב משפחתי, הוצאות ותכנון',
      screens: ['econ:personal-finance', 'econ:finance', 'econ:acct-personal', 'econ:tasks'],
      steps: [{ id: 'household-plan', title: 'התוכנית הפיננסית', detail: 'הכנסות והוצאות קבועות — ומהן תמונת המצב החודשית', key: 'econ:personal-finance' }] },
    { id: 'mortgage', icon: '🏦', name: 'ייעוץ משכנתאות', desc: 'תיקי לקוחות, תמהיל ומחזור',
      screens: ['econ:mortgage-advisor', 'econ:mortgage-lab', 'econ:mortgage'],
      steps: [{ id: 'madv-first', title: 'תיק לקוח ראשון', detail: 'ואז מעבדת התמהיל להשוואת מסלולים', key: 'econ:mortgage-advisor' }] },
    { id: 'appraiser', icon: '🏢', name: 'שמאות נכסים', desc: 'הערכות שווי ודוחות',
      screens: ['shamai'], steps: [] },
    { id: 'trainer', icon: '🏋', name: 'מאמן כושר', desc: 'מתאמנים, תכניות ותזונה',
      screens: ['trainer:dashboard', 'trainer:clients', 'trainer:programs'], steps: [] },
  ];
  const BY_ID = new Map(PROFILES.map(p => [p.id, p]));

  // צעדים שמתאימים לכולם — בסוף, כי הם חשובים אבל לא דחופים ביום הראשון
  const COMMON_STEPS = [
    { id: 'users', title: 'משתמשים נוספים', detail: 'לכל עובד משתמש משלו; לרואה החשבון — תפקיד "רואה חשבון" (צפייה וייצוא בלבד)', key: 'econ:settings' },
    { id: 'backup-target', title: 'יעד לגיבוי האוטומטי', detail: 'עדיף כונן USB — כפתור 💾 בתחתית הסרגל', action: 'backup-target' },
    { id: 'recovery-code', title: 'קוד שחזור', detail: 'בלעדיו לא ניתן לפתוח גיבוי אוטומטי במחשב אחר — כפתור 🔑', action: 'recovery-code' },
  ];
  const MAX_SCREENS = 8;

  // סיור קצר אחרי האשף — 3 שלבים, כל אחד מצביע על אזור במעטפת (sel: בורר CSS ב-shell.html)
  const TOUR = [
    { sel: '#nav', title: 'כל המסכים — בסרגל אחד', text: 'המסכים מסודרים לפי תחומים: כספים, משק בית, ארגון ועוד. הכפתור "מסך הבית" בתחתית מחזיר לכאן מכל מקום.' },
    { sel: '.search', title: 'חיפוש מהיר', text: 'Ctrl+K מכל מסך: מקלידים כמה אותיות ולוחצים Enter — והמסך נפתח.' },
    { sel: '#askForm', title: 'שאל את התוכנה', text: 'שאלות בשפה פשוטה על החשבונות, התרומות והגמ"ח. התשובה מחושבת במחשב שלך, בלי רשת.' },
  ];

  // profiles: מזהי פרופילים שנבחרו. validKeys: מפתחות הקטלוג הקיימים (מסך שלא קיים — מושמט)
  function plan(profiles, validKeys) {
    const valid = new Set(validKeys || []);
    const chosen = [...new Set(Array.isArray(profiles) ? profiles : [])].filter(id => BY_ID.has(id));
    const screens = [], steps = [];
    const seen = new Set();
    for (const id of chosen) {
      for (const k of BY_ID.get(id).screens) if (valid.has(k) && !screens.includes(k)) screens.push(k);
      for (const s of BY_ID.get(id).steps) if (!seen.has(s.id) && (!s.key || valid.has(s.key))) { seen.add(s.id); steps.push(s); }
    }
    for (const s of COMMON_STEPS) if (!s.key || valid.has(s.key)) steps.push(s);
    return { profiles: chosen, screens: screens.slice(0, MAX_SCREENS), steps };
  }

  // מצב שנשמר (localStorage): { profiles, done: [stepId], dismissed } — קלט לא מהימן, מנורמל
  function normalizeState(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      profiles: Array.isArray(s.profiles) ? s.profiles.filter(id => BY_ID.has(id)) : [],
      done: Array.isArray(s.done) ? s.done.filter(x => typeof x === 'string').slice(0, 50) : [],
      dismissed: s.dismissed === true,
      completed: s.completed === true,
    };
  }

  const api = { PROFILES, COMMON_STEPS, MAX_SCREENS, TOUR, plan, normalizeState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_ONBOARDING = api;
})(typeof window !== 'undefined' ? window : this);
