// ייבוא וייצוא אחידים לכל סוגי הנתונים במערכת הכלכלית (CSV, ולאנשי קשר גם vCard).
// פונקציות טהורות: מקבלות את אובייקט הנתונים מהמסד ומחזירות טבלה / רשומות מאומתות.
// הכתיבה למסד נעשית ב-ipc.js בשמירה אחת (בתוך enqueue) — ייבוא הוא "הכל או כלום" לרשומות התקינות.
const crypto = require('crypto');
const F = require('./features');
const PR = require('./pricing');
const N = require('./npo');
const M = require('./mortgageAdvisor');

const MAX_IMPORT_ROWS = 5000;
const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// ---------- מבני אחסון: גישה אחידה לרשימה בתוך אובייקט הנתונים ----------
const listIn = (key, inner) => ({
  get: (data) => {
    const v = data[key];
    if (inner) return v && Array.isArray(v[inner]) ? v[inner] : (Array.isArray(v) ? v : []);
    return Array.isArray(v) ? v : (v && Array.isArray(v[key]) ? v[key] : []);
  },
  set: (data, list) => {
    if (inner) data[key] = { ...(data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] : {}), [inner]: list };
    else data[key] = list;
  }
});

const text = (max) => (v) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`ארוך מדי (עד ${max} תווים)`);
  return s;
};
const required = (fn, label) => (v) => { const s = fn(v); if (!s) throw new Error(`${label} חובה`); return s; };
const money = (label, { allowZero = true } = {}) => (v) => {
  if (v === '' || v === null || v === undefined) { if (allowZero) return 0; throw new Error(`${label} חובה`); }
  const n = Number(String(v).replace(/[₪,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e10 || (!allowZero && n === 0)) throw new Error(`${label} אינו תקין`);
  return fromAg(toAg(n));
};
// ערך מתוך רשימה סגורה: מקבל את הקוד או את התווית בעברית
const oneOf = (map, fallback) => (v) => {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  if (map[s]) return s;
  const hit = Object.entries(map).find(([, label]) => label === s);
  if (hit) return hit[0];
  throw new Error(`ערך לא מוכר: "${s}"`);
};
const dateOrEmpty = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!isDate(s)) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
  return s;
};

const TASK = {
  category: { work: 'עבודה', personal: 'אישי', finance: 'כספים', other: 'אחר' },
  priority: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
  status: { todo: 'לביצוע', 'in-progress': 'בתהליך', done: 'הושלם' }
};
const INTEL = {
  sourceType: { news: 'חדשות', report: 'דוח', social: 'רשתות', internal: 'פנימי', other: 'אחר' },
  credibility: { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' },
  impactDirection: { positive: 'חיובי', neutral: 'ניטרלי', negative: 'שלילי' }
};
const FREQ = { monthly: 'חודשי', yearly: 'שנתי', weekly: 'שבועי', daily: 'יומי' };
const KIND = { income: 'הכנסה', expense: 'הוצאה' };

// כל סוג: תווית, מיקום, עמודות (מפתח, כותרת בעברית, מנתח לייבוא), ומפתח כפילות (דילוג בייבוא)
const KINDS = {
  contacts: {
    label: 'אנשי קשר', store: listIn('contacts'),
    columns: [
      ['name', 'שם', required(text(200), 'שם')], ['phone', 'טלפון', text(40)], ['email', 'דוא"ל', text(200)],
      ['company', 'חברה', text(200)], ['role', 'תפקיד', text(100)], ['address', 'כתובת', text(300)], ['notes', 'הערות', text(2000)]
    ],
    dupKey: (r) => `${r.name.trim().toLowerCase()}|${String(r.phone || '').replace(/\D/g, '')}`,
    extra: () => ({ tags: [] })
  },
  tasks: {
    label: 'משימות', store: listIn('tasks'),
    columns: [
      ['title', 'כותרת', required(text(300), 'כותרת')], ['description', 'תיאור', text(2000)],
      ['category', 'קטגוריה', oneOf(TASK.category, 'other'), TASK.category], ['priority', 'עדיפות', oneOf(TASK.priority, 'medium'), TASK.priority],
      ['status', 'סטטוס', oneOf(TASK.status, 'todo'), TASK.status], ['dueDate', 'תאריך יעד', dateOrEmpty]
    ],
    dupKey: (r) => `${r.title.trim().toLowerCase()}|${r.dueDate || ''}`
  },
  businessPlans: {
    label: 'תוכניות עסקיות', store: listIn('businessPlans'),
    columns: [
      ['name', 'שם התוכנית', required(text(200), 'שם התוכנית')], ['description', 'תיאור', text(2000)], ['industry', 'תעשייה', text(200)],
      ['targetMarket', 'שוק יעד', text(300)], ['startupCost', 'עלות הקמה', money('עלות הקמה')], ['projectedRevenue', 'הכנסה צפויה', money('הכנסה צפויה')]
    ],
    dupKey: (r) => r.name.trim().toLowerCase(),
    extra: () => ({ goals: [], financialProjections: [] })
  },
  marketIntel: {
    label: 'מודיעין שוק', store: listIn('marketIntel', 'entries'),
    columns: [
      ['title', 'כותרת', required(text(300), 'כותרת')], ['description', 'תיאור', text(2000)],
      ['sourceType', 'סוג מקור', oneOf(INTEL.sourceType, 'other'), INTEL.sourceType], ['credibility', 'אמינות', oneOf(INTEL.credibility, 'medium'), INTEL.credibility],
      ['impactDirection', 'כיוון השפעה', oneOf(INTEL.impactDirection, 'neutral'), INTEL.impactDirection]
    ],
    dupKey: (r) => r.title.trim().toLowerCase(),
    extra: () => ({ tags: [], potentialImpact: '', date: new Date().toISOString(), updatedAt: new Date().toISOString() })
  },
  personal: {
    label: 'הוצאות אישיות ומשפחה', store: listIn('personal'),
    columns: [
      ['date', 'תאריך'], ['kind', 'סוג', null, KIND], ['category', 'קטגוריה'], ['amount', 'סכום'], ['note', 'הערה']
    ],
    // ולידציה קיימת ומלאה של הרשומות האישיות
    validate: (raw, count) => F.validatePersonalEntry({ ...raw, kind: oneOf(KIND, '')(raw.kind), amount: String(raw.amount ?? '').replace(/[₪,\s]/g, '') }, count),
    dupKey: (r) => `${r.date}|${r.kind}|${r.category}|${r.amount}`
  },
  financeIncomes: {
    label: 'הכנסות בתוכנית הפיננסית', store: listIn('personalFinance', 'incomes'),
    columns: [
      ['source', 'מקור', required(text(200), 'מקור ההכנסה')], ['category', 'קטגוריה', text(100)],
      ['amount', 'סכום', money('סכום', { allowZero: false })], ['frequency', 'תדירות', oneOf(FREQ, 'monthly'), FREQ], ['notes', 'הערות', text(1000)]
    ],
    dupKey: (r) => `${r.source}|${r.amount}|${r.frequency}`
  },
  financeExpenses: {
    label: 'הוצאות בתוכנית הפיננסית', store: listIn('personalFinance', 'expenses'),
    columns: [
      ['category', 'קטגוריה', required(text(100), 'קטגוריה')], ['description', 'תיאור', text(300)],
      ['amount', 'סכום', money('סכום', { allowZero: false })], ['frequency', 'תדירות', oneOf(FREQ, 'monthly'), FREQ],
      ['isFixed', 'קבועה', (v) => !/^(לא|no|false|0|משתנה)$/i.test(String(v ?? '').trim()), { true: 'כן', false: 'לא' }], ['notes', 'הערות', text(1000)]
    ],
    dupKey: (r) => `${r.category}|${r.description}|${r.amount}`
  },
  mortgageClients: {
    // נשמר באגורות; הייצוא והבדיקה לכפילויות רואים שקלים (clientView), והשמירה ממירה חזרה (clientStored)
    label: 'תיקי לקוחות משכנתא', store: {
      get: (data) => listIn('mortgageAdvisor', 'clients').get(data).map(M.clientView),
      set: (data, list) => listIn('mortgageAdvisor', 'clients').set(data, list.map(M.clientStored))
    },
    columns: [
      ['name', 'שם'], ['phone', 'טלפון'], ['bank', 'בנק'], ['requestedAmount', 'סכום מבוקש'], ['propertyValue', 'שווי נכס'],
      ['status', 'סטטוס', null, M.CLIENT_STATUSES], ['feeType', 'סוג עמלה', null, { percent: 'אחוז', fixed: 'קבוע' }], ['feeValue', 'עמלה'], ['notes', 'הערות']
    ],
    validate: (raw) => M.validateClient({
      ...raw,
      status: (() => {
        const s = String(raw.status ?? '').trim();
        if (!s) return M.DEFAULT_STAGE;
        const k = M.normalizeStage(s);
        if (!k) throw new Error(`ערך לא מוכר: "${s}"`);
        return k;
      })(),
      feeType: oneOf({ percent: 'אחוז', fixed: 'קבוע' }, 'percent')(raw.feeType),
      requestedAmount: String(raw.requestedAmount ?? '').replace(/[₪,\s]/g, ''),
      propertyValue: String(raw.propertyValue ?? '').replace(/[₪,\s]/g, '')
    }),
    dupKey: (r) => `${r.name.trim().toLowerCase()}|${String(r.phone || '').replace(/\D/g, '')}`,
    extra: () => ({ docs: [] })
  },
  npoGrants: {
    label: 'תמיכות ומענקים (עמותה)', store: listIn('npo', 'grants'),
    columns: [
      ['source', 'גורם מממן'], ['program', 'תוכנית'], ['year', 'שנה'], ['status', 'סטטוס', null, N.GRANT_STATUSES],
      ['approved', 'אושר'], ['received', 'התקבל'], ['reference', 'מס\' תיק'], ['notes', 'הערות']
    ],
    validate: (raw) => N.validateGrant({ ...raw, status: oneOf(N.GRANT_STATUSES, 'requested')(raw.status), fundId: 'general' }),
    dupKey: (r) => `${r.source}|${r.program}|${r.year}`
  },
  products: {
    label: 'מחירון', store: listIn('products'),
    columns: [['name', 'name'], ['kind', 'kind'], ['cost', 'cost'], ['markupPct', 'markupPct'], ['vatExempt', 'vatExempt']],
    validate: (raw) => PR.validateProduct({ ...raw, vatExempt: /^(1|yes|true|כן)$/i.test(String(raw.vatExempt || '')) }),
    dupKey: (r) => r.name.trim().toLowerCase()
  }
};

const kindDef = (kind) => {
  const k = KINDS[kind];
  if (!k) throw new Error('סוג נתונים לא נתמך לייבוא/ייצוא');
  return k;
};

// ---------- ייצוא ----------
function exportTable(kind, data) {
  const k = kindDef(kind);
  const headers = k.columns.map(c => c[1]);
  const rows = k.store.get(data).map(r => k.columns.map(([key, , , labels]) => {
    const v = r[key];
    if (labels && v !== undefined && v !== null && labels[String(v)]) return labels[String(v)];
    return v === undefined || v === null ? '' : v;
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  return { name: `${k.label}-${stamp}`, headers, rows };
}

// ---------- ייבוא ----------
// כותרות מתקבלות בעברית (כפי שמיוצאות) או כמפתח באנגלית. עמודה לא מוכרת — מתעלמים ממנה.
function parseImport(kind, csvText, data) {
  const k = kindDef(kind);
  const rows = F.parseCsv(csvText);
  if (rows.length < 2) throw new Error('הקובץ ריק או חסר שורות נתונים');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`ניתן לייבא עד ${MAX_IMPORT_ROWS} שורות בכל פעם`);
  const head = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  const colIndex = {};
  for (const [key, label] of k.columns) {
    const i = head.findIndex(h => h === label || h.toLowerCase() === key.toLowerCase());
    if (i >= 0) colIndex[key] = i;
  }
  if (Object.keys(colIndex).length === 0) {
    throw new Error(`לא זוהו עמודות. כותרות אפשריות: ${k.columns.map(c => c[1]).join(', ')}`);
  }
  const existing = k.store.get(data);
  const seen = new Set(existing.map(r => { try { return k.dupKey(r); } catch { return ''; } }));
  const records = [], errors = [];
  let skipped = 0;
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const raw = {};
    for (const [key, i] of Object.entries(colIndex)) raw[key] = r[i] ?? '';
    try {
      let rec;
      if (k.validate) rec = k.validate(raw, existing.length + records.length);
      else {
        rec = {};
        for (const [key, label, parse] of k.columns) {
          try { rec[key] = parse(raw[key]); }
          catch (e) { throw new Error(`${label}: ${e.message}`); }
        }
      }
      const dk = k.dupKey(rec);
      if (seen.has(dk)) { skipped++; return; }
      seen.add(dk);
      records.push({ id: crypto.randomUUID(), ...(k.extra ? k.extra() : {}), ...rec, createdAt: new Date().toISOString() });
    } catch (e) {
      errors.push({ line, message: e.message });
    }
  });
  return { records, errors, skipped };
}

function applyImport(kind, data, records) {
  const k = kindDef(kind);
  k.store.set(data, [...k.store.get(data), ...records]);
  return data;
}

// ---------- vCard (אנשי קשר מהטלפון / תוכנת דואר) ----------
function unfold(s) { return String(s || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, ''); }
function vUnescape(s) { return String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function vEscape(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }

// ממיר קבצי vCard (2.1/3.0/4.0) לשורות בפורמט של ייבוא אנשי הקשר
function vcardToRows(textIn) {
  const out = [];
  const cards = unfold(textIn).split(/BEGIN:VCARD/i).slice(1);
  if (cards.length > MAX_IMPORT_ROWS) throw new Error(`ניתן לייבא עד ${MAX_IMPORT_ROWS} אנשי קשר בכל פעם`);
  for (const card of cards) {
    const c = { name: '', phone: '', email: '', company: '', role: '', address: '', notes: '' };
    for (const line of card.split(/\r?\n/)) {
      const m = line.match(/^([^:;]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      const prop = m[1].toUpperCase().replace(/^ITEM\d+\./, '');
      const val = m[2] && /QUOTED-PRINTABLE/i.test(m[2])
        ? Buffer.from(m[3].replace(/=\r?$/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
        : vUnescape(m[3]);
      if (prop === 'FN' && !c.name) c.name = val.trim();
      else if (prop === 'N' && !c.name) c.name = val.split(';').slice(0, 2).reverse().filter(Boolean).join(' ').trim();
      else if (prop === 'TEL' && !c.phone) c.phone = val.trim();
      else if (prop === 'EMAIL' && !c.email) c.email = val.trim();
      else if (prop === 'ORG' && !c.company) c.company = val.split(';')[0].trim();
      else if (prop === 'TITLE' && !c.role) c.role = val.trim();
      else if (prop === 'ADR' && !c.address) c.address = val.split(';').filter(Boolean).join(', ').trim();
      else if (prop === 'NOTE' && !c.notes) c.notes = val.trim();
    }
    out.push(c);
  }
  return out;
}

function importContactsVcard(textIn, data) {
  const rows = vcardToRows(textIn);
  if (rows.length === 0) throw new Error('לא נמצאו אנשי קשר בקובץ (vCard)');
  const head = KINDS.contacts.columns.map(c => c[1]);
  const csvLike = [head, ...rows.map(r => KINDS.contacts.columns.map(([key]) => r[key]))];
  // עוברים באותו מסלול ולידציה וכפילויות כמו CSV
  const X = require('./exports');
  return parseImport('contacts', X.toCsv(csvLike[0], csvLike.slice(1)), data);
}

function contactsToVcard(data) {
  return KINDS.contacts.store.get(data).map(c => [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${vEscape(c.name)}`, `N:${vEscape(c.name)};;;;`,
    c.phone ? `TEL;TYPE=CELL:${vEscape(c.phone)}` : '',
    c.email ? `EMAIL:${vEscape(c.email)}` : '',
    c.company ? `ORG:${vEscape(c.company)}` : '',
    c.role ? `TITLE:${vEscape(c.role)}` : '',
    c.address ? `ADR:;;${vEscape(c.address)};;;;` : '',
    c.notes ? `NOTE:${vEscape(c.notes)}` : '',
    'END:VCARD'
  ].filter(Boolean).join('\r\n')).join('\r\n') + '\r\n';
}

// תבנית ריקה לייבוא — שורת כותרות בלבד, כדי שהמשתמש ידע אילו עמודות למלא
function templateTable(kind) {
  const k = kindDef(kind);
  return { name: `תבנית-${k.label}`, headers: k.columns.map(c => c[1]), rows: [] };
}

const listKinds = () => Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label, columns: k.columns.map(c => c[1]) }));

module.exports = {
  KINDS, MAX_IMPORT_ROWS, listKinds, exportTable, parseImport, applyImport, templateTable,
  vcardToRows, importContactsVcard, contactsToVcard
};
