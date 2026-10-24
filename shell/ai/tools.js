// הכלים (tools) שהמודל המקומי רשאי לקרוא. פונקציות טהורות מעל ההקשר שהקורא (ipc.js) כבר אסף
// לפי הרשאות ורישיון — המודל לא ניגש למסד, ותחום סגור מחזיר { error } ולא נתונים.
// כל סכום מחושב כאן (באגורות שלמות) ומוחזר כמחרוזת מוכנה להצגה: המודל רק מעתיק, לא מחשב.
const R = require('./rules');

const nis = R.nis;
const open = (ctx, id) => !!(ctx && ctx.opened && ctx.opened[id] === true);
const ag = (v) => Math.round(Number(v || 0) * 100);
const CLOSED = (label) => ({ error: `התחום „${label}” אינו פתוח למשתמש הזה` });
const norm = (s) => String(s || '').toLowerCase().replace(/["'״׳]/g, '').trim();

// מסכים ש-Ctrl+K יכול לפתוח — אותה רשימה סגורה כמו ai:open ב-ipc.js
const SCREENS = Object.freeze([
  { view: 'acct-invoices', domain: 'acct', label: 'חשבוניות', words: ['חשבונית', 'חשבוניות', 'לקוח', 'לקוחות', 'גבייה', 'חוב', 'לא שילם', 'קבלה'] },
  { view: 'acct-reports', domain: 'acct', label: 'דוחות', words: ['דוח', 'דוחות', 'מע"מ', 'מעמ', 'רווח', 'הפסד', 'הכנסות', 'הוצאות', 'מאזן'] },
  { view: 'npo', domain: 'npo', label: 'עמותה ותרומות', words: ['עמותה', 'תרומה', 'תרומות', 'תורם', 'תורמים', 'מכתב תודה', 'סעיף 46'] },
  { view: 'realestate', domain: 'shamai', label: 'שמאות', words: ['שמאות', 'שמאי', 'הערכת שווי', 'שווי', 'דירה', 'נכס'] },
  { view: 'trainer', domain: 'trainer', label: 'אימונים', words: ['אימון', 'אימונים', 'מתאמן', 'מתאמנים', 'מנוי', 'סטודיו'] },
]);

const TOOL_DEFS = Object.freeze([
  { name: 'period_summary', domain: 'acct', description: 'סיכום החשבונות לתקופה שבשאלה: הכנסות, הוצאות, רווח ומע"מ. הסכומים מוכנים — יש להעתיק אותם כפי שהם.', params: { type: 'object', properties: {} } },
  { name: 'unpaid_invoices', domain: 'acct', description: 'חשבוניות פתוחות לגבייה (מי לא שילם), מהגדולה לקטנה, עם הסך הכול.', params: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'repeat_customers', domain: 'acct', description: 'לקוחות חוזרים: מספר חשבוניות וסך הכול לכל לקוח.', params: { type: 'object', properties: {} } },
  { name: 'donors_summary', domain: 'npo', description: 'סיכום התרומות של השנה שבשדה year בלבד: מספר תרומות, תורמים וסך הכול, והתורמים הגדולים.', params: { type: 'object', properties: {} } },
  { name: 'donor_record', domain: 'npo', description: 'פרטי תורם אחד לפי שם (לניסוח מכתב תודה או נוסח קבלה): מספר התרומות וסך הכול בשנה שבשדה year בלבד.', params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'appraisal_last', domain: 'shamai', description: 'הערכת השווי האחרונה: שווי, רמת ביטחון וגורמים.', params: { type: 'object', properties: {} } },
  { name: 'trainer_alerts', domain: 'trainer', description: 'מתאמנים שדורשים תשומת לב (מנוי מסתיים, יתרה, היעדרות).', params: { type: 'object', properties: {} } },
  { name: 'find_screen', domain: null, description: 'חיפוש מסך בתוכנה לפי תיאור חופשי (לחיפוש Ctrl+K). מחזיר מסכים מתאימים בלבד.', params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'search_records', domain: null, description: 'חיפוש לקוח או תורם לפי שם או חלק משם. מחזיר רשומות מתאימות.', params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
]);

const DOMAIN_LABEL = { acct: 'חשבונאות', npo: 'עמותה', shamai: 'שמאות', trainer: 'אימונים' };

function periodSummary(ctx) {
  const s = ctx.summary;
  if (!s) return { error: 'אין סיכום חשבונות לתקופה הזו' };
  const income = ag(s.income), expenses = Math.abs(ag(s.expenses)), vat = ag(s.vatPayable);
  return {
    period: ctx.range ? ctx.range.label : '', income: nis(income), expenses: nis(expenses),
    result: (income - expenses) >= 0 ? 'רווח' : 'הפסד', profit: nis(Math.abs(income - expenses)),
    vat: vat >= 0 ? `לתשלום ${nis(vat)}` : `להחזר ${nis(-vat)}`, note: 'לפני מע"מ',
  };
}

function unpaid(ctx, args) {
  const { rows, totalAg } = R.unpaidInvoices(ctx.invoices);
  const limit = Math.max(1, Math.min(10, Math.round(Number(args && args.limit) || 5)));
  return { count: rows.length, total: nis(totalAg), top: rows.slice(0, limit).map(r => ({ customer: r.customer, invoice: String(r.number), date: r.date, balance: nis(r.balanceAg) })) };
}

function repeatCustomers(ctx) {
  const a = ctx.analytics;
  if (!a) return { error: 'נתוני הניתוח אינם זמינים' };
  const list = Array.isArray(a.repeatCustomers) ? a.repeatCustomers.slice(0, 5) : [];
  return { customers: Number(a.customers) || 0, repeat: list.map(c => ({ customer: c.customer, invoices: Number(c.count) || 0, total: nis(ag(c.total)) })) };
}

// ctx.npo.donors — התרומות של שנה אחת בלבד (ctx.npo.year), לא של כל השנים: מכתב תודה „על תרומותיך השנה”
// היה מבוסס על הסכום הכולל (ממצא 46)
const npoYearOf = (ctx) => String((ctx.npo && ctx.npo.year) || (ctx.today ? String(ctx.today).slice(0, 4) : ''));

function donors(ctx) {
  const n = ctx.npo;
  if (!n || !Array.isArray(n.donors)) return { error: 'נתוני העמותה אינם זמינים' };
  const totalAg = n.donors.reduce((t, d) => t + ag(d.total), 0);
  const count = n.donors.reduce((t, d) => t + (Number(d.count) || 0), 0);
  const top = [...n.donors].sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 5)
    .map(d => ({ name: d.name, donations: Number(d.count) || 0, total: nis(ag(d.total)) }));
  return { year: npoYearOf(ctx), donations: count, donors: n.donors.length, total: nis(totalAg), top };
}

function donorRecord(ctx, args) {
  const n = ctx.npo;
  if (!n || !Array.isArray(n.donors)) return { error: 'נתוני העמותה אינם זמינים' };
  const q = norm(args && args.name);
  if (!q) return { error: 'חסר שם תורם' };
  const hits = n.donors.filter(d => norm(d.name).includes(q)).slice(0, 3);
  if (!hits.length) return { error: `לא נמצאו תרומות של תורם בשם הזה בשנת ${npoYearOf(ctx)}` };
  return { matches: hits.map(d => ({ name: d.name, donations: Number(d.count) || 0, total: nis(ag(d.total)) })), year: npoYearOf(ctx) };
}

function appraisal(ctx) {
  const s = ctx.shamai;
  if (!s) return { error: 'אין הערכת שווי אחרונה' };
  return { label: s.label || '', value: nis(s.valueAg), confidence: s.confidence == null ? null : `${s.confidence} מתוך 100`,
    factors: (s.factors || []).filter(f => Number(f.bp)).map(f => ({ name: f.name, effect: `${(Number(f.bp) / 100).toFixed(1).replace(/\.0$/, '')}%` })),
    warnings: s.warnings || [], note: 'ההערכה אינה ייעוץ מקצועי' };
}

function trainerAlerts(ctx) {
  const t = ctx.trainer;
  if (!t || !Array.isArray(t.alerts)) return { error: 'נתוני האימונים אינם זמינים' };
  return { clients: t.clients == null ? null : Number(t.clients), alerts: t.alerts.slice(0, 8).map(a => ({ name: a.title, detail: a.detail, urgent: a.tone === 'red' })) };
}

// Ctrl+K: התאמה לפי מילים — רק מסכים שפתוחים למשתמש
function findScreen(ctx, args) {
  const q = norm(args && args.text);
  const hits = SCREENS.filter(s => open(ctx, s.domain) && s.words.some(w => q.includes(norm(w))));
  return { screens: hits.map(s => ({ view: s.view, label: s.label })) };
}

function searchRecords(ctx, args) {
  const q = norm(args && args.text);
  if (q.length < 2) return { records: [] };
  const out = [];
  if (open(ctx, 'acct')) {
    const seen = new Set();
    for (const i of ctx.invoices || []) {
      const name = String(i.customer || '').trim();
      if (name && norm(name).includes(q) && !seen.has(name)) { seen.add(name); out.push({ kind: 'customer', name, view: 'acct-invoices' }); }
    }
  }
  // חיפוש תורם — בכל השנים (names), לא רק בתורמי השנה
  if (open(ctx, 'npo') && ctx.npo && (Array.isArray(ctx.npo.names) || Array.isArray(ctx.npo.donors))) {
    const names = Array.isArray(ctx.npo.names) ? ctx.npo.names : ctx.npo.donors.map(d => d.name);
    for (const name of new Set(names)) if (norm(name).includes(q)) out.push({ kind: 'donor', name, view: 'npo' });
  }
  return { records: out.slice(0, 10) };
}

const IMPL = {
  period_summary: periodSummary, unpaid_invoices: unpaid, repeat_customers: repeatCustomers,
  donors_summary: donors, donor_record: donorRecord, appraisal_last: appraisal, trainer_alerts: trainerAlerts,
  find_screen: findScreen, search_records: searchRecords,
};

// הכלים שמותרים בהקשר הזה — כלי של תחום סגור לא מוצג למודל בכלל
function toolsFor(ctx, names = null) {
  return TOOL_DEFS.filter(t => (!t.domain || open(ctx, t.domain)) && (!names || names.includes(t.name)));
}

function callTool(name, args, ctx) {
  const def = TOOL_DEFS.find(t => t.name === name);
  if (!def) return { error: 'כלי לא מוכר' };
  if (def.domain && !open(ctx, def.domain)) return CLOSED(DOMAIN_LABEL[def.domain]);
  try { return IMPL[name](ctx || {}, args && typeof args === 'object' ? args : {}); }
  catch { return { error: 'הכלי נכשל' }; }
}

module.exports = { TOOL_DEFS, SCREENS, toolsFor, callTool };
