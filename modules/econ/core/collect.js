// גבייה מלקוחות של הארגון: דרישת תשלום לחשבונית / תרומה / החזר הלוואה בגמ"ח, עם קישור לדף התשלום
// של חברת הסליקה **של הארגון** (חשבון הסוחר שלו). הכסף עובר ישירות לארגון — לא דרכנו.
// התוכנה לא נוגעת בפרטי אשראי ולא פונה לרשת: הקישור נבנה מתבנית שהארגון קיבל מחברת הסליקה,
// והתשלומים שהתקבלו נקלטים מקובץ הדוח של החברה (התאמה לפי מספר הדרישה, או לפי סכום ושם).
const { parseCsv } = require('./features');
const { parseDate, parseAmount, amountCurrency } = require('./donationImport');

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const MAX_REQUESTS = 20000;
const MAX_ROWS = 5000;

// חברות סליקה נפוצות — רק לתצוגה ולהצעת שמות עמודות. הקישור עצמו תמיד מהארגון (אין כאן כתובות קבועות)
const PROVIDERS = {
  cardcom: 'Cardcom', tranzila: 'Tranzila', grow: 'Grow (משולם)', payplus: 'PayPlus', icount: 'iCount',
  nedarim: 'נדרים פלוס', other: 'אחר',
};
const KINDS = { invoice: 'חשבונית', donation: 'תרומה', gemach: 'החזר הלוואה (גמ"ח)', license: 'רישיון שנתי למערכת בת', other: 'אחר' };
const STATUSES = { open: 'ממתין לתשלום', paid: 'שולם', cancelled: 'בוטל' };
// משתנים בתבנית הקישור — מקודדים תמיד (encodeURIComponent), כך ששם לקוח לא יכול לשבור את הכתובת
const PLACEHOLDERS = ['{amount}', '{agorot}', '{ref}', '{name}', '{desc}'];

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// תבנית קישור: https בלבד, בלי פרטי כניסה, רק המשתנים המוכרים
function validateTemplate(t) {
  const s = clean(t, 1000);
  if (!s) return '';
  let u;
  try { u = new URL(s.replace(/\{[a-z]+\}/g, 'x')); } catch { throw new Error('קישור התשלום אינו כתובת תקינה'); }
  if (u.protocol !== 'https:') throw new Error('קישור התשלום חייב להתחיל ב-https://');
  if (u.username || u.password) throw new Error('קישור התשלום לא יכול לכלול שם משתמש או סיסמה');
  const unknown = (s.match(/\{[^}]*\}/g) || []).filter(p => !PLACEHOLDERS.includes(p));
  if (unknown.length) throw new Error('משתנה לא מוכר בקישור: ' + unknown.join(', ') + ' (מותר: ' + PLACEHOLDERS.join(' ') + ')');
  return s;
}

function normalizeSettings(s) {
  const v = s && typeof s === 'object' ? s : {};
  const out = {
    provider: PROVIDERS[v.provider] ? v.provider : 'other',
    linkTemplate: '', // ריק = אין קישור; התבנית נבדקת בשמירה
    instructions: clean(v.instructions, 1000),
    nextNumber: Number.isSafeInteger(v.nextNumber) && v.nextNumber > 0 ? v.nextNumber : 1,
    importMapping: v.importMapping && typeof v.importMapping === 'object' ? v.importMapping : {},
  };
  try { out.linkTemplate = validateTemplate(v.linkTemplate); } catch { out.linkTemplate = ''; }
  return out;
}
function validateSettings(input, prev) {
  const merged = { ...prev, ...(input || {}) };
  const out = normalizeSettings(merged);
  out.linkTemplate = validateTemplate(merged.linkTemplate); // כאן — עם הודעת שגיאה למשתמש
  out.nextNumber = prev.nextNumber; // המספור לא משתנה מבחוץ
  return out;
}

// מספר דרישה קריא, להקלדה בדף התשלום ("מספר אסמכתא") ולהתאמה בדוח
const refOf = (n) => 'P' + String(n).padStart(5, '0');

function buildLink(template, req) {
  if (!template) return '';
  const vals = { '{amount}': fromAg(req.amountAg).toFixed(2), '{agorot}': String(req.amountAg), '{ref}': req.ref,
    '{name}': req.payerName, '{desc}': req.description };
  return template.replace(/\{amount\}|\{agorot\}|\{ref\}|\{name\}|\{desc\}/g, (p) => encodeURIComponent(vals[p]));
}

// דרישת תשלום חדשה. target: { kind, id, seq } — לאן נרשם התשלום כשיתקבל
function createRequest(input, settings, count) {
  if (count >= MAX_REQUESTS) throw new Error('הגעתם למספר המרבי של דרישות תשלום');
  const v = input || {};
  const kind = KINDS[v.kind] ? v.kind : null;
  if (!kind) throw new Error('יש לבחור עבור מה התשלום');
  const amountAg = toAg(v.amount);
  if (!Number.isSafeInteger(amountAg) || amountAg <= 0) throw new Error('סכום לא תקין');
  if (amountAg > toAg(1_000_000)) throw new Error('הסכום גבוה מדי');
  const payerName = clean(v.payerName, 120);
  if (!payerName) throw new Error('יש למלא שם משלם');
  // היעד: חשבונית / תשלום בלוח הסילוקין — רשומה קיימת. תרומה — נוצרת כשהתשלום מתקבל (קרן וקמפיין אופציונליים)
  let target = null;
  if (kind === 'invoice' || kind === 'gemach') {
    target = { kind, id: clean(v.targetId, 64) };
    if (!target.id) throw new Error('חסר שיוך לרשומה');
    if (kind === 'gemach') {
      target.seq = Number(v.seq);
      if (!Number.isSafeInteger(target.seq)) throw new Error('יש לבחור תשלום בלוח הסילוקין');
    }
  } else if (kind === 'license') {
    // רישיון למערכת בת: היעד הוא קוד המערכת (מזהה המפתח שלה) ומשך הרישיון ששולם. ראו ipc → requireChildPayment
    target = { kind, id: clean(v.targetId, 64), months: v.months == null ? 12 : Number(v.months) };
    if (!/^[A-Za-z0-9_-]{22}$/.test(target.id)) throw new Error('קוד מערכת הבת אינו תקין');
    if (!Number.isSafeInteger(target.months) || target.months < 12 || target.months > 60) throw new Error('הרישיון שנתי (12–60 חודשים)');
  } else if (kind === 'donation') {
    target = { kind, fundId: clean(v.fundId, 64), campaignId: clean(v.campaignId, 64), donorId: clean(v.donorId, 12).replace(/\D/g, '') };
  }
  const number = settings.nextNumber;
  const req = {
    number, ref: refOf(number), kind, target, amountAg, payerName,
    payerPhone: clean(v.payerPhone, 30).replace(/[^\d+\-() ]/g, ''),
    payerEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(v.payerEmail, 120)) ? clean(v.payerEmail, 120) : '',
    description: clean(v.description, 200) || KINDS[kind],
    status: 'open', createdAt: new Date().toISOString(),
  };
  req.link = buildLink(settings.linkTemplate, req);
  return { req, settings: { ...settings, nextNumber: number + 1 } };
}

// נוסח הודעה ללקוח (להעתקה לדוא"ל / הודעה) — הקישור ומספר האסמכתא
function messageText(req, settings, orgName) {
  const lines = [`שלום ${req.payerName},`, '', `${req.description}: ${fromAg(req.amountAg).toFixed(2)} ₪`];
  if (req.link) lines.push('', 'לתשלום מאובטח:', req.link);
  lines.push('', `מספר אסמכתא: ${req.ref}`);
  if (settings.instructions) lines.push('', settings.instructions);
  if (orgName) lines.push('', 'בברכה,', orgName);
  return lines.join('\n');
}

// ---------- קליטת דוח התשלומים מחברת הסליקה ----------
const FIELDS = {
  date:   { label: 'תאריך', required: true,  hints: ['תאריך', 'תאריךעסקה', 'date', 'transactiondate', 'createdat'] },
  amount: { label: 'סכום', required: true,  hints: ['סכום', 'סכוםעסקה', 'amount', 'total', 'sum'] },
  name:   { label: 'שם המשלם', required: false, hints: ['שם', 'שםלקוח', 'שםהמשלם', 'שםבעלהכרטיס', 'name', 'customer', 'fullname', 'cardholder'] },
  ref:    { label: 'אסמכתא / הערה (מספר הדרישה)', required: false, hints: ['אסמכתא', 'הערה', 'הערות', 'תיאור', 'פרטים', 'reference', 'ref', 'comment', 'description', 'note', 'notes'] },
  txId:   { label: 'מספר עסקה', required: false, hints: ['מספרעסקה', 'עסקה', 'מספראישור', 'אישור', 'transactionid', 'transaction', 'approval', 'confirmation'] },
  status: { label: 'סטטוס', required: false, hints: ['סטטוס', 'מצב', 'status', 'result'] },
};
const norm = (h) => String(h ?? '').replace(/^﻿/, '').toLowerCase().replace(/[\s"'`׳״.\-_:()/\\]/g, '');
// סטטוס בדוח — רשימה לבנה: ריק (דוחות רבים כוללים רק עסקאות שעברו) או מילת הצלחה מוכרת = תשלום.
// עסקה שנכשלה — מדולגת; כל סטטוס אחר ("ממתין לאישור", pending) — לא נרשם, ומוצג ברשימת "לא זוהו"
const FAILED = /נכשל|נדחה|בוטל|זיכוי|החזר|failed|declined|cancel|refund|void|error/i;
const SUCCEEDED = new Set(['הצליח', 'הצליחה', 'אושר', 'אושרה', 'שולם', 'בוצע', 'success', 'succeeded', 'approved', 'completed', 'paid']);
const isSuccessStatus = (s) => !s || SUCCEEDED.has(String(s).trim().toLowerCase());

function guessMapping(headers, saved = {}) {
  const map = {};
  const used = new Set();
  const nh = headers.map(norm);
  for (const [field, def] of Object.entries(FIELDS)) {
    if (saved[field] && headers.includes(saved[field])) { map[field] = saved[field]; used.add(saved[field]); continue; }
    let i = nh.findIndex((h, k) => !used.has(headers[k]) && def.hints.includes(h));
    if (i < 0) i = nh.findIndex((h, k) => !used.has(headers[k]) && def.hints.some(x => x.length >= 3 && h.startsWith(x)));
    if (i >= 0) { map[field] = headers[i]; used.add(headers[i]); }
  }
  return map;
}

function readFile(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('הקובץ ריק או חסר שורות נתונים');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`ניתן לקלוט עד ${MAX_ROWS} שורות בכל פעם`);
  const headers = rows[0].map(h => String(h).replace(/^﻿/, '').trim());
  if (new Set(headers).size !== headers.length) throw new Error('בקובץ יש שתי עמודות עם אותה כותרת');
  return { headers, rows: rows.slice(1) };
}

function previewImport(csvText, settings) {
  const { headers, rows } = readFile(csvText);
  return { headers, mapping: guessMapping(headers, settings.importMapping), sample: rows.slice(0, 5), total: rows.length, fields: FIELDS };
}

const nameKey = (s) => String(s || '').replace(/[\s"'`׳״.\-]/g, '').toLowerCase();
// היום המקומי שבו נוצרה הדרישה (createdAt נשמר ב-UTC). דרישה ישנה בלי תאריך — '' (לא מסננת)
const localDayOf = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* התאמת שורות הדוח לדרישות פתוחות:
   1. מספר הדרישה (P00012) מופיע באסמכתא / בהערה — התאמה ודאית, אם הסכום זהה.
      מספר של דרישה ששולמה או בוטלה — לא עוברים לשלב 2 (אחרת אותו תשלום נרשם לדרישה אחרת של אותו אדם).
   2. אחרת — סכום זהה ושם זהה, ורק אם יש בדיוק דרישה פתוחה אחת כזו.
   עסקה שכבר נקלטה (לפי מספר עסקה) — מדולגת. מחזיר הצעה בלבד; השירות רושם אחרי אישור המשתמש. */
function matchReport(csvText, mapping, requests) {
  const { headers, rows } = readFile(csvText);
  for (const [f, def] of Object.entries(FIELDS)) {
    if (mapping[f] && !headers.includes(mapping[f])) throw new Error(`העמודה "${mapping[f]}" לא נמצאה בקובץ`);
    if (def.required && !mapping[f]) throw new Error(`יש לבחור עמודה עבור "${def.label}"`);
  }
  const col = Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([f, h]) => [f, headers.indexOf(h)]));
  const seenTx = new Set(requests.filter(r => r.payment && r.payment.txId).map(r => r.payment.txId));
  const open = requests.filter(r => r.status === 'open');
  const taken = new Set();
  const matched = [], unmatched = [], errors = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const line = i + 2;
    const get = (f) => (col[f] === undefined ? '' : String(r[col[f]] ?? '').trim());
    if (!r.some(c => String(c).trim())) return;
    if (get('status') && FAILED.test(get('status'))) { skipped++; return; }
    const date = parseDate(get('date'));
    const amount = parseAmount(get('amount'));
    if (!date || amount === null) { errors.push({ line, message: !date ? `תאריך לא מזוהה: "${get('date')}"` : `סכום לא תקין: "${get('amount')}"` }); return; }
    // הדרישות בשקלים: סכום במטבע זר לא מותאם (parseAmount מסיר את הסימן — 100$ היה נקלט כ-100 ₪)
    if (amountCurrency(get('amount'))) { errors.push({ line, message: `סכום במטבע זר (${amountCurrency(get('amount'))}): "${get('amount')}" — הגבייה בשקלים בלבד` }); return; }
    const amountAg = toAg(amount);
    const txId = get('txId').slice(0, 80);
    if (txId && seenTx.has(txId)) { skipped++; return; }
    const row = { line, date, amountAg, name: get('name').slice(0, 120), txId, refText: get('ref').slice(0, 200) };
    const status = get('status');
    if (!isSuccessStatus(status)) { unmatched.push({ ...row, reason: `סטטוס לא מוכר: ${status.slice(0, 40)}` }); return; }
    const refs = (row.refText.match(/P\d{5,}/gi) || []).map(x => x.toUpperCase());
    const dup = refs.find(x => taken.has(x));
    let req = open.find(q => !taken.has(q.ref) && refs.includes(q.ref));
    let how = 'ref';
    if (!req && dup) {
      unmatched.push({ ...row, reason: `הדרישה ${dup} כבר שויכה לשורה אחרת בדוח — ייתכן חיוב כפול` });
      return;
    }
    if (!req) {
      const closed = requests.find(q => refs.includes(q.ref));
      if (closed) {
        unmatched.push({ ...row, reason: closed.status === 'cancelled' ? `הדרישה בוטלה (${closed.ref})` : `הדרישה כבר סומנה כשולמה (${closed.ref})` });
        return;
      }
    }
    if (req && req.amountAg !== amountAg) {
      unmatched.push({ ...row, reason: `מספר הדרישה ${req.ref} נמצא, אבל הסכום שונה (${fromAg(req.amountAg)} ₪ בדרישה)` });
      return;
    }
    if (!req && row.name) {
      // דוח שחופף לתקופה של דוח קודם: אותו תאריך, שם וסכום כבר נרשמו לדרישה אחרת (ואין מספר עסקה שמבדיל ביניהם)
      const same = requests.find(q => q.status === 'paid' && q.payment && q.payment.date === date && q.amountAg === amountAg
        && nameKey(q.payment.name || q.payerName) === nameKey(row.name) && !(txId && q.payment.txId && q.payment.txId !== txId));
      if (same) { unmatched.push({ ...row, reason: `ייתכן שהתשלום כבר נקלט (${same.ref}, ${date}) — יש לבדוק ולשייך ידנית` }); return; }
      // תשלום מלפני היום שבו נוצרה הדרישה אינו התשלום שלה
      const cands = open.filter(q => !taken.has(q.ref) && q.amountAg === amountAg && nameKey(q.payerName) === nameKey(row.name)
        && !(localDayOf(q.createdAt) > date));
      if (cands.length === 1) { req = cands[0]; how = 'name'; }
      else if (cands.length > 1) { unmatched.push({ ...row, reason: `${cands.length} דרישות פתוחות באותו שם וסכום — יש לשייך ידנית` }); return; }
    }
    if (!req) { unmatched.push({ ...row, reason: 'לא נמצאה דרישה פתוחה מתאימה' }); return; }
    taken.add(req.ref);
    if (txId) seenTx.add(txId);
    matched.push({ ...row, ref: req.ref, number: req.number, payerName: req.payerName, how });
  });
  return { matched, unmatched, errors, skipped };
}

function summary(requests) {
  const sum = (st) => requests.filter(r => r.status === st).reduce((t, r) => t + r.amountAg, 0);
  return { open: requests.filter(r => r.status === 'open').length, openAmount: fromAg(sum('open')),
    paid: requests.filter(r => r.status === 'paid').length, paidAmount: fromAg(sum('paid')) };
}

module.exports = { PROVIDERS, KINDS, STATUSES, PLACEHOLDERS, FIELDS, MAX_REQUESTS, normalizeSettings, validateSettings, validateTemplate,
  buildLink, createRequest, messageText, previewImport, matchReport, summary, refOf, toAg, fromAg };
