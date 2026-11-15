// מצב פשוט (נגישות, סבב 4): מסך הבית מציג משימות גדולות בפעלים פשוטים, והסרגל — רק את המסכים הנפוצים
// (שאר התחומים מאחורי "עוד מסכים"). קובץ טהור, משותף למעטפת במחשב ובאנדרואיד.
// כל משימה מפנה לפריט בקטלוג (key) או לפעולה של המעטפת (action); task — משימה ב-shell/tasks.js (הטופס נפתח מיד,
// ריק, דרך shell:start-task — כמו בתיבת "מה תרצה לעשות?"). מוצגות רק משימות שהפריט שלהן קיים
// ופתוח ברישיון; משימה של מנהל (admin) — רק למנהל.
(function (root) {
  'use strict';

  // tone — הצבע הקבוע של המשימה (primary / success / info / warning): אותו צבע בכל מקום שהיא מופיעה, כדי שיזהו אותה במבט.
  // רק ערכות צבע מ-design-tokens.css (יש להן גם גרסה כהה)
  const TONES = ['primary', 'success', 'info', 'warning'];
  const TASKS = [
    { id: 'invoice', tone: 'primary', key: 'econ:acct-invoices', task: 'invoice', icon: 'invoice', verb: 'להוציא חשבונית או קבלה', hint: 'ללקוח של העסק' },
    { id: 'donation', tone: 'success', key: 'econ:npo', task: 'donation', icon: 'heart', verb: 'לרשום תרומה ולתת קבלה', hint: 'לתורם של העמותה' },
    { id: 'income', tone: 'info', key: 'econ:dashboard', icon: 'chart-bar', verb: 'לראות כמה כסף נכנס החודש', hint: 'תמונת מצב במבט אחד' },
    { id: 'collect', tone: 'warning', key: 'econ:collect', icon: 'card', verb: 'לבקש תשלום (לגבות)', hint: 'קישור תשלום ללקוח או לתורם' },
    { id: 'loan', tone: 'success', key: 'econ:gemach', icon: 'hand-coin', verb: 'לרשום הלוואה או החזר בגמ"ח', hint: 'הלוואות, ערבים והפקדות' },
    { id: 'appraise', tone: 'warning', key: 'shamai', icon: 'gem', verb: 'להעריך שווי של זהב או תכשיט', hint: 'שמאות נכסים' },
    { id: 'calc', tone: 'info', key: 'tools', icon: 'calculator', verb: 'לחשב משהו', hint: 'מחשבון וכלי עזר' },
    { id: 'find', tone: 'primary', action: 'search', icon: 'search', verb: 'לחפש מסך אחר', hint: 'מקלידים מילה אחת ולוחצים Enter' },
    { id: 'backup', tone: 'success', action: 'backup', icon: 'download', verb: 'לשמור גיבוי של הנתונים', hint: 'עותק מוצפן — לשמור במקום בטוח', admin: true },
    { id: 'help', tone: 'info', action: 'help', icon: 'help', verb: 'עזרה והסבר', hint: 'איך עושים מה' },
  ];

  // has(key) — הפריט קיים בקטלוג; open(key) — פתוח ברישיון; admin — המשתמש מנהל
  function tasksFor({ has = () => true, open = () => true, admin = false } = {}) {
    return TASKS.filter(t => (t.admin ? admin : true) && (!t.key || (has(t.key) && open(t.key))));
  }

  // תחומים בסרגל שמוצגים תמיד במצב פשוט: הפריטים של המשימות + האחרונים. כל השאר — מאחורי "עוד מסכים"
  function sidebarKeys(tasks, recent) {
    const keys = [];
    for (const k of [...tasks.map(t => t.key).filter(Boolean), ...(Array.isArray(recent) ? recent : [])]) if (!keys.includes(k)) keys.push(k);
    return keys;
  }

  // תפריט "כמו ברכב": שלושה עיגולים גדולים בכל פעם, ומעבר לבאים בחץ מכל צד ("הקודם" / "הבא").
  // מספר עמוד לא תקין (קלט מהמסך) ← העמוד הקרוב ביותר שקיים
  const PAGE_SIZE = 3;
  function pageOf(tasks, page, size = PAGE_SIZE) {
    const list = Array.isArray(tasks) ? tasks : [];
    const per = Number.isInteger(size) && size > 0 ? size : PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const p = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
    return { items: list.slice(p * per, p * per + per), page: p, pages };
  }

  // "העיגולים לומדים": סופרים כמה פעמים נבחרה כל משימה, ומה שנבחר הכי הרבה עולה ראשון.
  // העדפת תצוגה בלבד (localStorage של המעטפת) — לא נתוני משתמש. הקלט מהאחסון לא מהימן: רק מזהים מוכרים ושלמים חיוביים.
  const USE_MAX = 100000;
  function normalizeUse(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const t of TASKS) {
      const n = Object.prototype.hasOwnProperty.call(raw, t.id) ? raw[t.id] : 0;
      if (Number.isInteger(n) && n > 0) out[t.id] = Math.min(n, USE_MAX);
    }
    return out;
  }
  function bumpUse(raw, id) {
    const use = normalizeUse(raw);
    if (TASKS.some(t => t.id === id)) use[id] = Math.min((use[id] || 0) + 1, USE_MAX);
    return use;
  }
  // מיון יציב: מספר שימושים גבוה קודם; שוויון — הסדר המקורי. המסך מסדר רק לפי המצב שנקרא בעלייה,
  // כדי שעיגול לא "יברח" למשתמש באמצע העבודה
  function orderByUse(tasks, raw) {
    const use = normalizeUse(raw);
    return (Array.isArray(tasks) ? tasks : []).map((t, i) => ({ t, i, n: use[t.id] || 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.t);
  }

  const api = { TASKS, TONES, PAGE_SIZE, tasksFor, pageOf, sidebarKeys, normalizeUse, bumpUse, orderByUse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_SIMPLE = api;
})(typeof window !== 'undefined' ? window : this);
