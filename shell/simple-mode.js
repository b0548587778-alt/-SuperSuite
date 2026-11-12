// מצב פשוט (נגישות, סבב 4): מסך הבית מציג משימות גדולות בפעלים פשוטים, והסרגל — רק את המסכים הנפוצים
// (שאר התחומים מאחורי "עוד מסכים"). קובץ טהור, משותף למעטפת במחשב ובאנדרואיד.
// כל משימה מפנה לפריט בקטלוג (key) או לפעולה של המעטפת (action); task — משימה ב-shell/tasks.js (הטופס נפתח מיד,
// ריק, דרך shell:start-task — כמו בתיבת "מה תרצה לעשות?"). מוצגות רק משימות שהפריט שלהן קיים
// ופתוח ברישיון; משימה של מנהל (admin) — רק למנהל.
(function (root) {
  'use strict';

  const TASKS = [
    { id: 'invoice', key: 'econ:acct-invoices', task: 'invoice', icon: 'invoice', verb: 'להוציא חשבונית או קבלה', hint: 'ללקוח של העסק' },
    { id: 'donation', key: 'econ:npo', task: 'donation', icon: 'heart', verb: 'לרשום תרומה ולתת קבלה', hint: 'לתורם של העמותה' },
    { id: 'income', key: 'econ:dashboard', icon: 'chart-bar', verb: 'לראות כמה כסף נכנס החודש', hint: 'תמונת מצב במבט אחד' },
    { id: 'collect', key: 'econ:collect', icon: 'card', verb: 'לבקש תשלום (לגבות)', hint: 'קישור תשלום ללקוח או לתורם' },
    { id: 'loan', key: 'econ:gemach', icon: 'hand-coin', verb: 'לרשום הלוואה או החזר בגמ"ח', hint: 'הלוואות, ערבים והפקדות' },
    { id: 'appraise', key: 'shamai', icon: 'gem', verb: 'להעריך שווי של זהב או תכשיט', hint: 'שמאות נכסים' },
    { id: 'calc', key: 'tools', icon: 'calculator', verb: 'לחשב משהו', hint: 'מחשבון וכלי עזר' },
    { id: 'find', action: 'search', icon: 'search', verb: 'לחפש מסך אחר', hint: 'מקלידים מילה אחת ולוחצים Enter' },
    { id: 'backup', action: 'backup', icon: 'download', verb: 'לשמור גיבוי של הנתונים', hint: 'עותק מוצפן — לשמור במקום בטוח', admin: true },
    { id: 'help', action: 'help', icon: 'help', verb: 'עזרה והסבר', hint: 'איך עושים מה' },
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

  // תפריט "כמו ברכב": מעט משימות גדולות בכל פעם, ומעבר לבאות בכפתורים "הקודם" / "הבא".
  // מספר עמוד לא תקין (קלט מהמסך) ← העמוד הקרוב ביותר שקיים
  const PAGE_SIZE = 4;
  function pageOf(tasks, page, size = PAGE_SIZE) {
    const list = Array.isArray(tasks) ? tasks : [];
    const per = Number.isInteger(size) && size > 0 ? size : PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const p = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
    return { items: list.slice(p * per, p * per + per), page: p, pages };
  }

  const api = { TASKS, PAGE_SIZE, tasksFor, pageOf, sidebarKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_SIMPLE = api;
})(typeof window !== 'undefined' ? window : this);
