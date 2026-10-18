// קטלוג אחיד של כל מה שיש בתוכנה — מקור אמת יחיד לסרגל, למסך הבית, לחיפוש ולאימות ב-main.js.
// המשתמש רואה "תוכנה אחת" עם תחומים; החלוקה הפנימית למודולים (econ/shamai/trainer/tools) נשארת שקופה.
// כל פריט: mod = המודול שמארח אותו, view = תצוגה פנימית (במודול הכלכלי ובמודול האימונים).
// במודול האימונים (חבילה מהודרת) label = הטקסט של הכפתור בסרגל הפנימי שלו — ה-preload לוחץ עליו.
(function (root) {
  const GROUPS = [
    {
      id: 'money', title: 'כספים והנהלת חשבונות', hue: 'blue',
      items: [
        { mod: 'econ', view: 'dashboard',        icon: '◈',  name: 'לוח בקרה',            desc: 'תמונת מצב של העסק במבט אחד' },
        { mod: 'econ', view: 'acct-invoices',    icon: '🧾', name: 'חשבוניות מס',          desc: 'הפקה, תשלום וביטול' },
        { mod: 'econ', view: 'collect',          icon: '💳', name: 'גבייה וקישורי תשלום',   desc: 'קישור תשלום ללקוח, לתורם או ללווה, וקליטת דוח הסליקה' },
        { mod: 'econ', view: 'acct-reports',     icon: '📈', name: 'דוחות ומע"מ',          desc: 'רווח והפסד, מאזן בוחן ודוח מע"מ' },
        { mod: 'econ', view: 'acct-bank',        icon: '🏦', name: 'התאמת בנק',            desc: 'קליטת דף בנק מקובץ והתאמה לחשבוניות' },
        { mod: 'econ', view: 'acct-journal',     icon: '📒', name: 'יומן חשבונאי',         desc: 'פקודות יומן בהנה"ח כפולה' },
        { mod: 'econ', view: 'acct-chart',       icon: '🗂',  name: 'תוכנית חשבונות',       desc: 'מבנה החשבונות של העסק' },
        { mod: 'econ', view: 'acct-pricing',     icon: '🏷',  name: 'מחירון ותמחור',        desc: 'מחשבון תמחור ורווחיות' },
        { mod: 'econ', view: 'business',         icon: '▣',  name: 'עסקים ולקוחות',        desc: 'תוכניות עסקיות ולקוחות' },
        { mod: 'econ', view: 'market-intel',     icon: '📊', name: 'מודיעין שוק',          desc: 'מתחרים, מחירים ומגמות' },
        { mod: 'econ', view: 'acct-settings',    icon: '🏢', name: 'הגדרות עסק ומע"מ',     desc: 'פרטי העסק ושיעור המע"מ' }
      ]
    },
    {
      id: 'home', title: 'משק בית ותכנון', hue: 'green',
      items: [
        { mod: 'econ', view: 'personal-finance', icon: '💰', name: 'התוכנית הפיננסית',     desc: 'הכנסות, הוצאות והשקעות' },
        { mod: 'econ', view: 'finance',          icon: '₪',  name: 'תמונת מצב פיננסית',    desc: 'מדדים מחושבים מהתוכנית' },
        { mod: 'econ', view: 'acct-personal',    icon: '🏠', name: 'הוצאות הבית',          desc: 'הוצאות אישיות ומשפחתיות' },
        { mod: 'econ', view: 'npo',              icon: '🤝', name: 'עמותה וצדקה',          desc: 'תרומות, קבלות סעיף 46 וקרנות' },
        { mod: 'econ', view: 'gemach',           icon: '🫱', name: 'גמ"ח',                 desc: 'הלוואות, ערבים והפקדות' },
        { mod: 'econ', view: 'chesed',           icon: '📦', name: 'חסד וחלוקות',          desc: 'נזקקים, מתנדבים וסבבי חלוקה' },
        { mod: 'econ', view: 'people',           icon: '👥', name: 'מאגר אנשים',           desc: 'כרטיס אחד: תרומות, גמ"ח וחסד' }
      ]
    },
    {
      id: 'realty', title: 'משכנתאות ונדל"ן', hue: 'gold',
      items: [
        { mod: 'econ', view: 'mortgage',         icon: '🏛',  name: 'משכנתאות והלוואות',    desc: 'תרחישים ולוחות סילוקין' },
        { mod: 'econ', view: 'mortgage-advisor', icon: '🏦', name: 'ייעוץ משכנתאות',       desc: 'תיקי לקוחות ומסמכים' },
        { mod: 'econ', view: 'mortgage-lab',     icon: '🧮', name: 'מעבדת תמהיל',          desc: 'סימולטור, סלים ואופטימייזר' },
        { mod: 'shamai',                         icon: '💎', name: 'שמאות נכסים',          desc: 'הערכת שווי נכסים' }
      ]
    },
    {
      id: 'org', title: 'ארגון ועבודה', hue: 'purple',
      items: [
        { mod: 'econ', view: 'tasks',            icon: '📋', name: 'משימות',               desc: 'מה צריך לעשות ומתי' },
        { mod: 'econ', view: 'contacts',         icon: '👥', name: 'אנשי קשר',             desc: 'ספר טלפונים וכרטיסי לקוח' },
        { mod: 'econ', view: 'voice-notes',      icon: '🎙',  name: 'הערות קוליות',         desc: 'הקלטה ותזכורות' },
        { mod: 'econ', view: 'canvas',           icon: '✏',  name: 'לוח לבן',              desc: 'שרטוט ורעיונות' },
        { mod: 'tools',                          icon: '🧰', name: 'ארגז כלים',            desc: 'מחשבונים וכלי עזר' }
      ]
    },
    {
      id: 'health', title: 'בריאות וכושר', hue: 'teal',
      items: [
        { mod: 'econ', view: 'fitness',          icon: '💪', name: 'כושר ובריאות',         desc: 'יומן אישי: אימונים, תזונה ומדדים' }
      ]
    },
    {
      id: 'trainer', title: 'ניהול אימונים (למאמנים)', hue: 'teal',
      items: [
        { mod: 'trainer', view: 'dashboard',   label: 'לוח בקרה',        icon: '🏋', name: 'לוח בקרת אימונים',  desc: 'מתאמנים פעילים, אימונים ומי שדורש תשומת לב' },
        { mod: 'trainer', view: 'clients',     label: 'מתאמנים',         icon: '🧑', name: 'מתאמנים',            desc: 'רשימה, כרטיס מתאמן ומעקב התקדמות' },
        { mod: 'trainer', view: 'programs',    label: 'תוכניות מוכנות',  icon: '📋', name: 'תוכניות מוכנות',     desc: '5×5, PPL, Upper/Lower ועוד' },
        { mod: 'trainer', view: 'exercises',   label: 'ספריית תרגילים',  icon: '≣',  name: 'ספריית תרגילים',     desc: 'תרגילים לפי שריר וציוד' },
        { mod: 'trainer', view: 'nutrition',   label: 'תזונה',           icon: '🥗', name: 'תזונה למתאמנים',     desc: 'מחשבון קלוריות, מאגר מאכלים ותפריטים' },
        { mod: 'trainer', view: 'flexibility', label: 'גמישות ויוגה',    icon: '🤸', name: 'גמישות ומתיחות',     desc: 'שגרות גמישות והתאוששות' },
        { mod: 'trainer', view: 'cardio',      label: 'קרדיו',           icon: '🏃', name: 'קרדיו',              desc: 'HIIT, ריצה ואזורי דופק' },
        { mod: 'trainer', view: 'martial',     label: 'אומנויות לחימה',  icon: '🥊', name: 'אומנויות לחימה',     desc: 'טכניקות, תרגילי אימון וכושר ייעודי' },
        { mod: 'trainer', view: 'knowledge',   label: 'ידע מקצועי',      icon: '📚', name: 'ידע מקצועי',         desc: 'פציעות, עקרונות אימון ומקורות' },
        { mod: 'trainer', view: 'tools',       label: 'כלים',            icon: '🛠', name: 'כלי מאמן',           desc: '1RM, טיימר, הערכת תנועה ו-PAR-Q' },
        { mod: 'trainer', view: 'settings',    label: 'הגדרות',          icon: '⚙',  name: 'הגדרות אימונים',     desc: 'פרופיל המאמן, גיבוי ושחזור' }
      ]
    },
    {
      id: 'system', title: 'מערכת', hue: 'slate',
      items: [
        { mod: 'econ', view: 'settings',         icon: '⚙',  name: 'הגדרות ומשתמשים',      desc: 'הרשאות, ייבוא/ייצוא ויומן ביקורת' },
        { mod: 'econ', view: 'licensing',        icon: '🔑', name: 'רישוי ומערכות',        desc: 'רישיון, מערכות בת ואישורים' },
        { mod: 'econ', view: 'messages',         icon: '💬', name: 'הודעות',               desc: 'תקשורת מאובטחת בין המערכות' }
      ]
    }
  ];

  const keyOf = (it) => it.view ? it.mod + ':' + it.view : it.mod;
  const ITEMS = GROUPS.flatMap(g => g.items.map(it => ({ ...it, key: keyOf(it), group: g.id, hue: g.hue })));
  // תצוגות פנימיות שמותר לפתוח במודול הכלכלי (main.js מאמת מולן)
  const ECON_VIEWS = ITEMS.filter(it => it.mod === 'econ').map(it => it.view);
  // מודול האימונים: תצוגה ← הטקסט בסרגל הפנימי שלו (main.js מאמת מול הרשימה ושולח את הטקסט ל-preload)
  const TRAINER_VIEWS = ITEMS.filter(it => it.mod === 'trainer' && it.view).map(it => it.view);
  const TRAINER_LABELS = Object.fromEntries(ITEMS.filter(it => it.mod === 'trainer' && it.view).map(it => [it.view, it.label]));

  // סנכרון אוטומטי: תצוגה שנוספה לסרגל הפנימי של המודול הכלכלי (views/index.html) ועדיין לא לקטלוג —
  // מזוהה כאן ומוצגת בסרגל האחיד תחת "נוספו לאחרונה", כדי שלא תיעלם. main.js מריץ זאת בעלייה.
  const NAV_RE = /<button[^>]*data-view="([a-z0-9-]+)"[^>]*>\s*([^<]*?)\s*<span>([^<]+)<\/span>/g;
  function extrasFromHtml(html) {
    const out = [];
    for (const m of String(html).matchAll(NAV_RE)) {
      const [, view, icon, name] = m;
      if (ECON_VIEWS.includes(view) || out.some(x => x.view === view)) continue;
      out.push({ mod: 'econ', view, icon: icon.trim() || '•', name: name.trim(), desc: 'מסך חדש',
        key: 'econ:' + view, group: 'new', hue: 'gold' });
    }
    return out;
  }
  const NEW_GROUP = { id: 'new', title: 'נוספו לאחרונה', hue: 'gold' };

  const api = { GROUPS, ITEMS, ECON_VIEWS, TRAINER_VIEWS, TRAINER_LABELS, keyOf, extrasFromHtml, NEW_GROUP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_CATALOG = api;
})(typeof window !== 'undefined' ? window : this);
