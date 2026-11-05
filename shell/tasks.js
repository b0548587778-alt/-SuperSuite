// רשימת המשימות של "מה תרצה לעשות?" (תיבת הפקודה במסך הבית) — מקור אחד, טהור, משותף:
//   המעטפת (intents.js מפרש טקסט חופשי למשימה; משימות מצב פשוט), main.js ו-main-android.js (אימות המטען
//   לפני שהוא עובר למודול הכלכלי), והמודול הכלכלי (econStartTask פותח את הטופס מלא מראש).
// החוזה: המעטפת שולחת { task: '<id>', prefill: {...} } ← main.js מאמת (validateTask) ← econ:goto עם
//   { view, task, prefill }. **שום דבר לא נשמר אוטומטית**: הטופס נפתח מלא, והמשתמש שומר בעצמו אחרי בדיקה.
// סכום — מחרוזת בשקלים ("1500" / "12.50"), לא מספר צף; ההמרה לאגורות — amountToAg (חשבון שלמים).
(function (root) {
  'use strict';

  // סוגי השדות במטען. כל שדה אחר נדחה, וכך גם ערך שאינו מהסוג
  const FIELDS = Object.freeze({
    name: { type: 'text', max: 80, label: 'שם' },
    amount: { type: 'amount', label: 'סכום' },
    date: { type: 'date', label: 'תאריך' },
    note: { type: 'text', max: 200, label: 'פירוט' },
    phone: { type: 'phone', label: 'טלפון' },
    installments: { type: 'int', min: 1, max: 360, label: 'מספר תשלומים' },
  });

  // id — מזהה בחוזה; verb — פועל קצר לכפתור; label — שם הפעולה לאישור; key — פריט בקטלוג (shell/catalog.js);
  // view — התצוגה במודול הכלכלי; domain — תחילית הערוצים של התחום (בדיקת הרישיון ב-gate.checkChannel); perm — ההרשאה שנדרשת כדי לשמור; action — פעולה של המעטפת (בלי טופס);
  // words — מילים לזיהוי ולהצעות "התכוונת ל...?"; fields — השדות שמותר למלא מראש
  const TASKS = Object.freeze([
    { id: 'donation', verb: 'לרשום תרומה', label: 'רישום תרומה (עם קבלה)', key: 'econ:npo', view: 'npo', domain: 'npo', perm: 'data.edit',
      words: ['תרומה', 'תרומות', 'נדבה', 'צדקה', 'תורם'], fields: ['name', 'amount', 'date', 'note'] },
    { id: 'receipt', verb: 'להוציא קבלה', label: 'הוצאת קבלה', key: 'econ:acct-invoices', view: 'acct-invoices', domain: 'acct', perm: 'data.edit',
      words: ['קבלה', 'קבלות'], fields: ['name', 'amount', 'date', 'note'] },
    { id: 'expense', verb: 'לרשום הוצאה', label: 'רישום הוצאה', key: 'econ:acct-journal', view: 'acct-journal', domain: 'acct', perm: 'data.edit',
      words: ['הוצאה', 'הוצאות', 'שילמתי', 'קניתי'], fields: ['amount', 'note', 'date', 'name'] },
    { id: 'invoice', verb: 'להוציא חשבונית', label: 'הוצאת חשבונית', key: 'econ:acct-invoices', view: 'acct-invoices', domain: 'acct', perm: 'data.edit',
      words: ['חשבונית', 'חשבוניות'], fields: ['name', 'amount', 'note', 'date'] },
    { id: 'loanPayment', verb: 'לרשום החזר הלוואה', label: 'רישום תשלום על הלוואה', key: 'econ:gemach', view: 'gemach', domain: 'gemach', perm: 'data.edit',
      words: ['החזר', 'פירעון', 'תשלום הלוואה'], fields: ['name', 'amount', 'date'] },
    { id: 'gemachLoan', verb: 'לתת הלוואה מהגמ"ח', label: 'הלוואה חדשה בגמ"ח', key: 'econ:gemach', view: 'gemach', domain: 'gemach', perm: 'data.edit',
      words: ['הלוואה', 'להלוות', 'גמ"ח'], fields: ['name', 'amount', 'date', 'installments'] },
    { id: 'contact', verb: 'להוסיף איש קשר', label: 'איש קשר חדש', key: 'econ:contacts', view: 'contacts', domain: 'contacts', perm: 'data.edit',
      words: ['איש קשר', 'אנשי קשר', 'טלפון'], fields: ['name', 'phone', 'note'] },
    { id: 'backup', verb: 'לשמור גיבוי', label: 'גיבוי של כל הנתונים', action: 'backup', admin: true,
      words: ['גיבוי', 'לגבות', 'גבה'], fields: [] },
  ]);
  const BY_ID = new Map(TASKS.map(t => [t.id, t]));
  const getTask = (id) => (typeof id === 'string' && BY_ID.has(id) ? BY_ID.get(id) : null);

  // ---------- ערכים ----------
  const CONTROL = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;
  const AMOUNT_RE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
  const MAX_AG = 100000000000; // מיליארד שקל — תקרה סבירה לטופס

  // "1500" / "12.5" / "12.50" ← אגורות שלמות, בלי נקודה צפה. לא תקין ← null
  function amountToAg(s) {
    const m = AMOUNT_RE.exec(String(s == null ? '' : s));
    if (!m) return null;
    const ag = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
    return ag > 0 && ag <= MAX_AG ? ag : null;
  }
  // אגורות ← "₪1,500.00" (תצוגה בלבד)
  function formatAg(ag) {
    const v = Math.round(Number(ag) || 0);
    const sh = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `₪${sh}.${String(v % 100).padStart(2, '0')}`;
  }
  // תאריך קפדני: YYYY-MM-DD שקיים בלוח (2026-02-31 נדחה)
  function isDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
  }

  function cleanValue(def, v) {
    if (def.type === 'text') {
      if (typeof v !== 'string' || CONTROL.test(v)) return undefined;
      const s = v.replace(/\s+/g, ' ').trim();
      return s && s.length <= def.max ? s : undefined;
    }
    if (def.type === 'amount') return typeof v === 'string' && amountToAg(v) != null ? v : undefined;
    if (def.type === 'date') return typeof v === 'string' && isDay(v) ? v : undefined;
    if (def.type === 'phone') return typeof v === 'string' && /^\+?[0-9][0-9\- ]{6,18}$/.test(v) ? v.replace(/[\s-]/g, '') : undefined;
    if (def.type === 'int') return Number.isInteger(v) && v >= def.min && v <= def.max ? v : undefined;
    return undefined;
  }

  // אימות המטען שעובר מהמעטפת למודול (גבול אמון): משימה מוכרת, אובייקט רגיל, רק השדות של המשימה,
  // כל ערך מהסוג שלו. כל חריגה ← null (המטען כולו נדחה, לא "מתוקן" בשקט)
  function validateTask(id, prefill) {
    const task = getTask(id);
    if (!task) return null;
    const p = prefill == null ? {} : prefill;
    if (typeof p !== 'object' || Array.isArray(p)) return null;
    const proto = Object.getPrototypeOf(p);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Object.keys(p);
    if (keys.length > task.fields.length) return null;
    const out = {};
    for (const k of keys) {
      if (!task.fields.includes(k)) return null;
      const v = cleanValue(FIELDS[k], p[k]);
      if (v === undefined) return null;
      out[k] = v;
    }
    return { task, prefill: out };
  }

  // שורות לאישור: מה ייכנס לטופס, בעברית
  function describe(id, prefill) {
    const task = getTask(id);
    if (!task) return [];
    const p = prefill || {};
    return task.fields.filter(k => p[k] != null && p[k] !== '').map(k => {
      let value = String(p[k]);
      if (k === 'amount') value = formatAg(amountToAg(p[k]));
      if (k === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (m) value = `${Number(m[3])}.${Number(m[2])}.${m[1]}`; }
      return { field: k, label: FIELDS[k].label, value };
    });
  }

  // המשימות שמותר להציע למשתמש: has(key) — בקטלוג; open(key) — ברישיון; admin — מנהל;
  // allowed(id) — ההרשאה מהתהליך הראשי (shell:task-access), אם ידועה
  function tasksFor({ has = () => true, open = () => true, admin = false, allowed = null } = {}) {
    return TASKS.filter(t => (t.admin ? admin : true) && (!t.key || (has(t.key) && open(t.key)))
      && (!allowed || allowed.includes(t.id)));
  }

  const api = { FIELDS, TASKS, getTask, validateTask, describe, tasksFor, amountToAg, formatAg, isDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUITE_TASKS = api;
})(typeof window !== 'undefined' ? window : this);
