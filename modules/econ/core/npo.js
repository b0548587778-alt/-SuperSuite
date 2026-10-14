// עמותות: תרומות וקבלות לפי סעיף 46, קרנות ייעודיות/כללי, תמיכות ומענקים, ונתוני בסיס לדוח השנתי.
// פונקציות טהורות. כל הסכומים מחושבים בשלמי אגורות; נשמרים בשקלים מעוגלים לשתי ספרות.
// הנתונים נפרדים לחלוטין מהיומן העסקי (journal) — עמותה אינה עוסק, והתרומה אינה עסקה.

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const { assertIsraeliId, isValidIsraeliId } = require('./israeliId');
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};

const GENERAL_FUND = { id: 'general', name: 'כללי', restricted: false };
const VAT_STATUSES = {
  exempt: 'עמותה פטורה ממע"מ',
  malkar: 'מלכ"ר — אינו גובה מע"מ',
  osek: 'עוסק מורשה'
};
const METHODS = { cash: 'מזומן', check: 'המחאה', transfer: 'העברה בנקאית', card: 'כרטיס אשראי', standing: 'הוראת קבע' };
const GRANT_STATUSES = { requested: 'הוגשה בקשה', approved: 'אושרה', paid: 'שולמה', rejected: 'נדחתה' };
const MAX_DONATIONS = 50000;
const MAX_GRANTS = 5000;

const DEFAULT_SETTINGS = {
  orgName: '', regNumber: '', address: '', phone: '',
  sec46Number: '', sec46ValidUntil: '',
  vatStatus: 'exempt', vatNumber: '',
  largeDonorThreshold: 20000,
  funds: [],
  receiptSeq: 0
};

function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.funds = Array.isArray(s.funds) ? s.funds.filter(f => f && typeof f === 'object' && f.id && f.name) : [];
  s.receiptSeq = Number.isInteger(s.receiptSeq) && s.receiptSeq >= 0 ? s.receiptSeq : 0;
  if (!VAT_STATUSES[s.vatStatus]) s.vatStatus = 'exempt';
  return s;
}

// כל הקרנות, כולל הכללית (תמיד קיימת ואינה ניתנת למחיקה)
function allFunds(settings) {
  return [GENERAL_FUND, ...normalizeSettings(settings).funds];
}

// שמירת הגדרות: קרנות ייעודיות מוזנות כשורות טקסט. קרן קיימת נשמרת לפי שמה (המזהה לא משתנה);
// קרן שהוסרה מהרשימה אך יש לה תנועות — מסומנת כארכיון ולא נמחקת, כדי שהדוחות לא יאבדו אותה.
function applySettings(current, input, usedFundIds = new Set(), newId) {
  const cur = normalizeSettings(current);
  const next = { ...cur };
  next.orgName = str(input.orgName, 200, 'שם העמותה');
  if (!next.orgName) throw new Error('שם העמותה חובה');
  next.regNumber = str(input.regNumber, 20, 'מספר העמותה');
  if (next.regNumber && !/^\d{9}$/.test(next.regNumber)) throw new Error('מספר עמותה (ע"ר) חייב להכיל 9 ספרות');
  next.address = str(input.address, 300, 'הכתובת');
  next.phone = str(input.phone, 30, 'הטלפון');
  next.sec46Number = str(input.sec46Number, 30, 'מספר אישור סעיף 46');
  next.sec46ValidUntil = str(input.sec46ValidUntil, 10, 'תוקף האישור');
  if (next.sec46ValidUntil && !isDate(next.sec46ValidUntil)) throw new Error('תוקף אישור סעיף 46 אינו תאריך תקין');
  next.vatStatus = VAT_STATUSES[input.vatStatus] ? input.vatStatus : 'exempt';
  next.vatNumber = next.vatStatus === 'osek' ? str(input.vatNumber, 20, 'מספר העוסק') : '';
  if (next.vatStatus === 'osek' && !/^\d{9}$/.test(next.vatNumber)) throw new Error('בעוסק מורשה יש להזין מספר עוסק בן 9 ספרות');
  const th = Number(input.largeDonorThreshold === '' || input.largeDonorThreshold == null ? cur.largeDonorThreshold : input.largeDonorThreshold);
  if (!Number.isFinite(th) || th < 0 || th > 1e9) throw new Error('סף תורם גדול אינו תקין');
  next.largeDonorThreshold = fromAg(toAg(th));

  const names = String(input.fundsText ?? cur.funds.filter(f => !f.archived).map(f => f.name).join('\n'))
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (names.length > 100) throw new Error('ניתן להגדיר עד 100 קרנות ייעודיות');
  const seen = new Set();
  const funds = [];
  for (const name of names) {
    if (name.length > 100) throw new Error('שם קרן ארוך מדי');
    if (name === GENERAL_FUND.name || seen.has(name)) continue;
    seen.add(name);
    const existing = cur.funds.find(f => f.name === name);
    funds.push(existing ? { ...existing, archived: false } : { id: newId(), name, restricted: true });
  }
  for (const f of cur.funds) {
    if (!seen.has(f.name) && usedFundIds.has(f.id)) funds.push({ ...f, archived: true });
  }
  next.funds = funds;
  return next;
}

// האם תרומה בתאריך נתון מזכה לפי סעיף 46: יש מספר אישור, והתאריך בתוך התוקף (אם הוגדר)
function sec46Eligible(settings, date) {
  const s = normalizeSettings(settings);
  if (!s.sec46Number) return false;
  if (s.sec46ValidUntil && date > s.sec46ValidUntil) return false;
  return true;
}

function validateDonation(input, settings, count = 0) {
  if (!input || typeof input !== 'object') throw new Error('תרומה לא תקינה');
  if (count >= MAX_DONATIONS) throw new Error('הגעת למספר המקסימלי של תרומות');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error('תאריך לא תקין (YYYY-MM-DD)');
  const donorName = str(input.donorName, 200, 'שם התורם');
  if (!donorName) throw new Error('שם התורם חובה');
  const donorId = str(input.donorId, 12, 'מספר הזהות');
  assertIsraeliId(donorId, 'מספר זהות / ח"פ של התורם');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error('סכום התרומה אינו תקין');
  const method = METHODS[input.method] ? input.method : 'transfer';
  const fundId = input.fundId || GENERAL_FUND.id;
  const fund = allFunds(settings).find(f => f.id === fundId && !f.archived);
  if (!fund) throw new Error('הקרן שנבחרה אינה קיימת');
  return {
    date, donorName, donorId,
    donorAddress: str(input.donorAddress, 300, 'כתובת התורם'),
    donorPhone: str(input.donorPhone, 30, 'טלפון התורם'),
    amount: fromAg(toAg(amount)), method, fundId,
    purpose: str(input.purpose, 300, 'ייעוד התרומה'),
    reference: str(input.reference, 60, 'אסמכתא')
  };
}

// הפקת קבלה: מספור רץ שאינו חוזר על עצמו גם אחרי ביטול. הקבלה "מקפיאה" את פרטי העמותה
// ואת זכאות סעיף 46 ביום התרומה — שינוי הגדרות מאוחר לא משנה קבלה שכבר הופקה.
function issueReceipt(donation, settings) {
  const s = normalizeSettings(settings);
  const number = s.receiptSeq + 1;
  const eligible = sec46Eligible(s, donation.date);
  return {
    receipt: {
      number,
      sec46: eligible,
      sec46Number: eligible ? s.sec46Number : '',
      sec46ValidUntil: eligible ? s.sec46ValidUntil : '',
      org: { name: s.orgName, regNumber: s.regNumber, address: s.address, phone: s.phone, vatStatus: s.vatStatus, vatNumber: s.vatNumber },
      fundName: (allFunds(s).find(f => f.id === donation.fundId) || GENERAL_FUND).name
    },
    settings: { ...s, receiptSeq: number }
  };
}

// רשימת מסמכים לתמיכה: שורה לכל מסמך. מסמך שכבר סומן כ"הוגש" שומר את הסימון לפי שמו
function parseDocuments(text, prev = []) {
  const done = new Map((Array.isArray(prev) ? prev : []).map(d => [d.name, !!d.done]));
  const names = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (names.length > 50) throw new Error('ניתן להגדיר עד 50 מסמכים לתמיכה');
  const seen = new Set();
  const out = [];
  for (const name of names) {
    if (name.length > 150) throw new Error('שם מסמך ארוך מדי');
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, done: done.get(name) || false });
  }
  return out;
}

function validateGrant(input, prevDocuments = []) {
  if (!input || typeof input !== 'object') throw new Error('רשומה לא תקינה');
  const source = str(input.source, 200, 'הגורם המממן');
  if (!source) throw new Error('הגורם המממן (משרד/רשות) חובה');
  const program = str(input.program, 200, 'שם התמיכה');
  const year = Number(input.year || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('שנת התמיכה אינה תקינה');
  const approved = Number(input.approved || 0);
  const received = Number(input.received || 0);
  for (const [v, label] of [[approved, 'הסכום שאושר'], [received, 'הסכום שהתקבל']]) {
    if (!Number.isFinite(v) || v < 0 || v > 1e10) throw new Error(`${label} אינו תקין`);
  }
  const status = GRANT_STATUSES[input.status] ? input.status : 'requested';
  const deadline = str(input.deadline, 10, 'מועד ההגשה');
  if (deadline && !isDate(deadline)) throw new Error('מועד ההגשה אינו תאריך תקין');
  const matchingPercent = input.matchingPercent === '' || input.matchingPercent == null ? 0 : Number(input.matchingPercent);
  if (!Number.isFinite(matchingPercent) || matchingPercent < 0 || matchingPercent > 100) throw new Error('אחוז המימון התואם חייב להיות בין 0 ל-100');
  const documents = typeof input.documentsText === 'string'
    ? parseDocuments(input.documentsText, prevDocuments)
    : (Array.isArray(input.documents) ? input.documents.filter(d => d && d.name).map(d => ({ name: String(d.name).slice(0, 150), done: !!d.done })) : []);
  return {
    source, program, year, status, deadline, matchingPercent, documents,
    fundId: input.fundId || GENERAL_FUND.id,
    approved: fromAg(toAg(approved)), received: fromAg(toAg(received)),
    reference: str(input.reference, 60, 'מספר תיק'),
    notes: str(input.notes, 1000, 'ההערות')
  };
}

const live = (donations) => donations.filter(d => d.status !== 'cancelled');
const inYear = (date, year) => !year || String(date).slice(0, 4) === String(year);

// רשימת תורמים נגזרת מהתרומות: מפתח = מספר זהות, ואם אין — השם. הפרטים מהתרומה האחרונה.
function donorSummary(donations, year) {
  const map = new Map();
  for (const d of live(donations).filter(d => inYear(d.date, year))) {
    const key = d.donorId ? 'id:' + d.donorId : 'name:' + d.donorName.trim().toLowerCase();
    const cur = map.get(key) || { key, name: d.donorName, donorId: d.donorId || '', address: '', phone: '', count: 0, totalAg: 0, lastDate: '' };
    cur.count += 1;
    cur.totalAg += toAg(d.amount);
    if (d.date >= cur.lastDate) {
      cur.lastDate = d.date; cur.name = d.donorName;
      cur.address = d.donorAddress || cur.address; cur.phone = d.donorPhone || cur.phone;
    }
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ totalAg, ...r }) => ({ ...r, total: fromAg(totalAg) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'he'));
}

// יתרות לפי קרן: תרומות + תמיכות שהתקבלו, בהפרדה בין ייעודי לכללי
function fundSummary(donations, grants, settings, year) {
  const funds = allFunds(settings);
  const rows = new Map(funds.map(f => [f.id, { id: f.id, name: f.name, restricted: !!f.restricted, archived: !!f.archived, donationsAg: 0, grantsAg: 0 }]));
  const row = (id) => rows.get(id) || rows.get(GENERAL_FUND.id);
  for (const d of live(donations).filter(d => inYear(d.date, year))) row(d.fundId).donationsAg += toAg(d.amount);
  for (const g of grants.filter(g => !year || Number(g.year) === Number(year))) row(g.fundId).grantsAg += toAg(g.received);
  const list = [...rows.values()].map(({ donationsAg, grantsAg, ...r }) => ({
    ...r, donations: fromAg(donationsAg), grants: fromAg(grantsAg), total: fromAg(donationsAg + grantsAg)
  }));
  const sum = (pred) => fromAg(list.filter(pred).reduce((t, r) => t + toAg(r.total), 0));
  return { funds: list, restrictedTotal: sum(r => r.restricted), generalTotal: sum(r => !r.restricted), total: sum(() => true) };
}

// נתוני בסיס לדוח השנתי לרשם העמותות — ריכוז בלבד, לא הגשה. סף "תורם גדול" נקבע בהגדרות.
function annualReport(donations, grants, settings, year) {
  const s = normalizeSettings(settings);
  const yearDonations = live(donations).filter(d => inYear(d.date, year));
  const byMethodAg = {};
  let sec46Ag = 0;
  for (const d of yearDonations) {
    byMethodAg[d.method] = (byMethodAg[d.method] || 0) + toAg(d.amount);
    if (d.receipt && d.receipt.sec46) sec46Ag += toAg(d.amount);
  }
  const yearGrants = grants.filter(g => Number(g.year) === Number(year));
  const bySourceAg = new Map();
  for (const g of yearGrants) {
    const cur = bySourceAg.get(g.source) || { approvedAg: 0, receivedAg: 0, count: 0 };
    cur.approvedAg += toAg(g.approved); cur.receivedAg += toAg(g.received); cur.count += 1;
    bySourceAg.set(g.source, cur);
  }
  const donors = donorSummary(donations, year);
  const thAg = toAg(s.largeDonorThreshold);
  const funds = fundSummary(donations, grants, s, year);
  return {
    year: Number(year),
    org: { name: s.orgName, regNumber: s.regNumber, vatStatus: s.vatStatus, vatStatusLabel: VAT_STATUSES[s.vatStatus] },
    donationsCount: yearDonations.length,
    donationsTotal: fromAg(yearDonations.reduce((t, d) => t + toAg(d.amount), 0)),
    sec46Total: fromAg(sec46Ag),
    byMethod: Object.entries(byMethodAg).map(([m, ag]) => ({ method: m, label: METHODS[m] || m, total: fromAg(ag) })),
    grants: [...bySourceAg].map(([source, v]) => ({ source, count: v.count, approved: fromAg(v.approvedAg), received: fromAg(v.receivedAg) })),
    grantsReceived: fromAg(yearGrants.reduce((t, g) => t + toAg(g.received), 0)),
    donorsCount: donors.length,
    largeDonors: donors.filter(d => toAg(d.total) >= thAg),
    largeDonorThreshold: s.largeDonorThreshold,
    funds
  };
}

// ---------- תמיכות: התראות ומימון תואם ----------
// מימון תואם = החלק שהעמותה צריכה לגייס בעצמה מתוך הסכום שאושר
const matchingRequired = (g) => fromAg(Math.round(toAg(g.approved) * (Number(g.matchingPercent) || 0) / 100));

function grantAlerts(grants, today, days = 30) {
  const limit = new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  return grants
    .filter(g => g.status === 'requested' || g.status === 'approved')
    .map(g => {
      const docs = Array.isArray(g.documents) ? g.documents : [];
      const missing = docs.filter(d => !d.done).length;
      const overdue = !!(g.deadline && g.deadline < today && g.status === 'requested');
      const soon = !!(g.deadline && g.deadline >= today && g.deadline <= limit);
      return { id: g.id, source: g.source, program: g.program, deadline: g.deadline || '', overdue, soon, missingDocuments: missing, matchingRequired: matchingRequired(g) };
    })
    .filter(a => a.overdue || a.soon || (a.missingDocuments > 0 && a.deadline))
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
}

// ---------- דיווח לרשות המסים ("תרומות ישראל") ----------
// מאז 1.1.2026 עמותה עם אישור סעיף 46 מדווחת על כל תרומה, כולל ביטולים, ומקבלת מספר רישום.
// כאן נשמר רק מעקב: מה דווח, מה ממתין, ומה בוטל אחרי שדווח. הדיווח עצמו נעשה במערכת רשות המסים.
const TAX_STATUSES = {
  pending: 'ממתין לדיווח', reported: 'דווח', 'cancel-pending': 'ביטול ממתין לדיווח',
  'cancel-reported': 'ביטול דווח', 'not-required': 'לא נדרש'
};

function taxStatus(d) {
  const t = d.taxReport || {};
  if (!(d.receipt && d.receipt.sec46)) return 'not-required';
  if (d.status === 'cancelled') {
    if (!t.registrationNumber) return 'not-required'; // בוטלה לפני שדווחה — אין מה לבטל
    return t.cancelReportedAt ? 'cancel-reported' : 'cancel-pending';
  }
  return t.registrationNumber ? 'reported' : 'pending';
}

// רישום דיווח: לתרומה פעילה — מספר הרישום שהתקבל; לתרומה שבוטלה — אישור שהביטול דווח
function recordTaxReport(d, input = {}, today) {
  const st = taxStatus(d);
  const date = today || new Date().toISOString().slice(0, 10);
  if (st === 'pending') {
    const reg = str(input.registrationNumber, 30, 'מספר הרישום');
    if (!/^[0-9A-Za-z-]{3,30}$/.test(reg)) throw new Error('מספר הרישום מרשות המסים אינו תקין');
    return { ...d, taxReport: { registrationNumber: reg, reportedAt: date } };
  }
  if (st === 'cancel-pending') {
    return { ...d, taxReport: { ...d.taxReport, cancelReportedAt: date } };
  }
  throw new Error(st === 'not-required' ? 'התרומה אינה דורשת דיווח' : 'הדיווח כבר נרשם');
}

function taxSummary(donations) {
  const counts = Object.fromEntries(Object.keys(TAX_STATUSES).map(k => [k, 0]));
  let missingDonorId = 0;
  let invalidDonorId = 0;
  for (const d of donations) {
    const st = taxStatus(d);
    counts[st] += 1;
    if (st === 'pending' && !d.donorId) missingDonorId += 1;
    // נתונים ישנים שנשמרו לפני בדיקת ספרת הביקורת — השיוך ב"תרומות ישראל" ייכשל
    if (st === 'pending' && d.donorId && !isValidIsraeliId(d.donorId)) invalidDonorId += 1;
  }
  return { counts, missingDonorId, invalidDonorId, toReport: counts.pending + counts['cancel-pending'] };
}

// טבלאות לייצוא CSV (הכותרות בעברית)
function exportTable(kind, donations, grants, settings, year) {
  const r = annualReport(donations, grants, settings, year);
  if (kind === 'donations') {
    const funds = Object.fromEntries(allFunds(settings).map(f => [f.id, f.name]));
    const rows = donations.filter(d => inYear(d.date, year)).sort((a, b) => a.date.localeCompare(b.date) || a.receipt.number - b.receipt.number)
      .map(d => [d.receipt.number, d.date, d.donorName, d.donorId, d.amount, METHODS[d.method] || d.method, funds[d.fundId] || '', d.receipt.sec46 ? 'כן' : 'לא', d.status === 'cancelled' ? 'בוטלה' : 'פעילה', d.purpose]);
    return { name: `תרומות-${year}`, headers: ['מס\' קבלה', 'תאריך', 'תורם', 'ת.ז/ח.פ', 'סכום', 'אמצעי תשלום', 'קרן', 'סעיף 46', 'סטטוס', 'ייעוד'], rows };
  }
  if (kind === 'grants') {
    const rows = grants.filter(g => Number(g.year) === Number(year))
      .map(g => [g.year, g.source, g.program, GRANT_STATUSES[g.status] || g.status, g.approved, g.received, g.reference,
        g.deadline || '', Number(g.matchingPercent) || 0, matchingRequired(g),
        (g.documents || []).filter(x => !x.done).map(x => x.name).join('; ')]);
    return { name: `תמיכות-${year}`, headers: ['שנה', 'גורם מממן', 'תוכנית', 'סטטוס', 'אושר', 'התקבל', 'מס\' תיק', 'מועד הגשה', 'מימון תואם %', 'מימון תואם ₪', 'מסמכים חסרים'], rows };
  }
  if (kind === 'tax') {
    // רשימת עבודה לדיווח ידני — כל השנים, כי דיווח שלא נעשה אינו "נסגר" עם סוף השנה
    const rows = donations.filter(d => ['pending', 'cancel-pending'].includes(taxStatus(d)))
      .sort((a, b) => a.receipt.number - b.receipt.number)
      .map(d => [taxStatus(d) === 'pending' ? 'דיווח תרומה' : 'דיווח ביטול', d.receipt.number, d.date, d.donorName, d.donorId || 'חסר', d.amount, (d.taxReport && d.taxReport.registrationNumber) || '']);
    return { name: 'דיווח-תרומות-ישראל', headers: ['פעולה', 'מס\' קבלה', 'תאריך', 'תורם', 'ת.ז/ח.פ', 'סכום', 'מס\' רישום קודם'], rows };
  }
  if (kind === 'funds') {
    const rows = r.funds.funds.map(f => [f.name, f.restricted ? 'ייעודי' : 'כללי', f.donations, f.grants, f.total]);
    rows.push(['סה"כ ייעודי', '', '', '', r.funds.restrictedTotal], ['סה"כ כללי', '', '', '', r.funds.generalTotal]);
    return { name: `קרנות-${year}`, headers: ['קרן', 'סוג', 'תרומות', 'תמיכות', 'סה"כ'], rows };
  }
  if (kind === 'summary') {
    const rows = [
      ['שם העמותה', r.org.name], ['מספר עמותה', r.org.regNumber], ['שנה', r.year], ['מעמד מע"מ', r.org.vatStatusLabel],
      ['מספר תרומות', r.donationsCount], ['סה"כ תרומות', r.donationsTotal], ['מתוכן עם קבלה לפי סעיף 46', r.sec46Total],
      ['סה"כ תמיכות שהתקבלו', r.grantsReceived], ['מספר תורמים', r.donorsCount],
      [`תורמים מעל ${r.largeDonorThreshold} ₪`, r.largeDonors.length],
      ...r.largeDonors.map(d => [`  ${d.name}${d.donorId ? ' (' + d.donorId + ')' : ''}`, d.total])
    ];
    return { name: `ריכוז-שנתי-${year}`, headers: ['נתון', 'ערך'], rows };
  }
  throw new Error('סוג ייצוא לא נתמך');
}

module.exports = {
  GENERAL_FUND, VAT_STATUSES, METHODS, GRANT_STATUSES, TAX_STATUSES, DEFAULT_SETTINGS, MAX_DONATIONS, MAX_GRANTS,
  parseDocuments, matchingRequired, grantAlerts, taxStatus, recordTaxReport, taxSummary,
  normalizeSettings, allFunds, applySettings, sec46Eligible, validateDonation, issueReceipt,
  validateGrant, donorSummary, fundSummary, annualReport, exportTable
};
