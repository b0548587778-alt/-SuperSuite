// ייעוץ משכנתאות: תיקי לקוחות, מסלולים ולוח סילוקין, השוואת הצעות בנקים, עמלת ייעוץ ורשימת מסמכים.
// פונקציות טהורות. הלוח מחושב בשלמי אגורות: כל תשלום, ריבית והצמדה מעוגלים לאגורה בכל חודש.
// שמירה: סכומים בשלמי אגורות (שדות *Ag). clientView מחזיר שקלים לתצוגה ולייבוא/ייצוא,
// ו-clientStored / offerStored ממירים כל צורה (גם רשומה ישנה בשקלים) לצורה השמורה.
// הנחת עבודה מוצהרת: ריבית במסלול משתנה/פריים נשארת קבועה לאורך התקופה, והמדד הוא הנחה שהיועץ מזין.

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

const TRACKS = {
  'fixed-indexed': { label: 'קבועה צמודה', indexed: true },
  'fixed-unindexed': { label: 'קבועה לא צמודה', indexed: false },
  'variable-5': { label: 'משתנה כל 5 שנים', indexed: false },
  'prime': { label: 'פריים', indexed: false }
};
const TRACK_KEYS = Object.keys(TRACKS);

// שלבי התיק בצנרת המשרד, לפי הסדר. closed / lost — תיק סגור (לא נספר כתקוע)
const CLIENT_STATUSES = {
  lead: 'פנייה',
  meeting: 'פגישת היכרות',
  documents: 'איסוף מסמכים',
  submitted: 'הוגש לבנקים',
  principle: 'אישורים עקרוניים',
  negotiation: 'משא ומתן',
  final: 'אישור סופי',
  signing: 'חתימה וביצוע',
  closed: 'הסתיים',
  lost: 'לא התקדם'
};
const STAGE_KEYS = Object.keys(CLIENT_STATUSES);
const CLOSED_STAGES = new Set(['closed', 'lost']);
// סטטוסים מהגרסה הקודמת (ארבעה שלבים) ← השלב המקביל
// (גם התוויות הישנות — קובץ שיוצא מהגרסה הקודמת)
const LEGACY_STATUS = { preparing: 'documents', 'approved-principle': 'principle', 'approved-final': 'final',
  'בהכנה': 'documents', 'הוגש': 'submitted', 'אושר עקרונית': 'principle', 'אושר סופי': 'final' };
const DEFAULT_STAGE = 'lead';

function normalizeStage(v) {
  const s = String(v ?? '');
  if (CLIENT_STATUSES[s]) return s;
  if (LEGACY_STATUS[s.trim()]) return LEGACY_STATUS[s.trim()];
  const byLabel = STAGE_KEYS.find(k => CLIENT_STATUSES[k] === s.trim());
  return byLabel || null;
}

// פרופיל הלווה קובע אילו מסמכים נדרשים. זו רשימת עבודה מקובלת — לא דרישה של בנק מסוים;
// כל בנק עשוי לבקש מסמכים נוספים, והיועץ מסמן "לא רלוונטי" לפי הצורך.
const EMPLOYMENT = { employee: 'שכיר', selfEmployed: 'עצמאי', mixed: 'שכיר ועצמאי', pension: 'פנסיונר' };
const DEALS = { secondHand: 'דירה יד שנייה', contractor: 'דירה מקבלן', upgrader: 'משפר דיור (מוכר דירה קיימת)', refinance: 'מחזור משכנתא' };
const DEFAULT_PROFILE = { employment: 'employee', deal: 'secondHand' };
const SALARIED = ['employee', 'mixed'];
const SELF = ['selfEmployed', 'mixed'];

// for: { employment?: [...], deal?: [...] } — בלי מפתח = לכולם
const DOCUMENTS = [
  { key: 'id', label: 'תעודות זהות + ספח של כל הלווים' },
  { key: 'payslips', label: 'תלושי שכר — 3 חודשים אחרונים', for: { employment: SALARIED } },
  { key: 'form106', label: 'טופס 106 לשנה האחרונה', for: { employment: SALARIED } },
  { key: 'employer', label: 'אישור העסקה ממעסיק', for: { employment: SALARIED } },
  { key: 'selfTax', label: 'שומות מס / דוחות שנתיים — שנתיים אחרונות', for: { employment: SELF } },
  { key: 'cpaLetter', label: 'אישור רואה חשבון על הכנסה שוטפת', for: { employment: SELF } },
  { key: 'pensionSlip', label: 'אישור קצבה / תלוש פנסיה', for: { employment: ['pension'] } },
  { key: 'bank', label: 'דפי עו"ש — 3 חודשים אחרונים' },
  { key: 'loans', label: 'פירוט הלוואות קיימות' },
  { key: 'equity', label: 'אישור הון עצמי', for: { deal: ['secondHand', 'contractor', 'upgrader'] } },
  { key: 'contract', label: 'חוזה רכישה / זיכרון דברים', for: { deal: ['secondHand', 'contractor', 'upgrader'] } },
  { key: 'tabu', label: 'נסח טאבו / אישור זכויות', for: { deal: ['secondHand', 'upgrader', 'refinance'] } },
  { key: 'contractorDocs', label: 'מסמכי הקבלן: אישור ליווי בנקאי / מכתב החרגה / ערבות חוק מכר', for: { deal: ['contractor'] } },
  { key: 'saleContract', label: 'חוזה מכירת הדירה הקיימת', for: { deal: ['upgrader'] } },
  { key: 'payoffReport', label: 'דוח יתרה לסילוק מהבנק הנוכחי', for: { deal: ['upgrader', 'refinance'] } },
  { key: 'appraisal', label: 'דוח שמאי' },
  { key: 'insurance', label: 'ביטוח חיים וביטוח מבנה' }
];
const DOC_KEYS = new Set(DOCUMENTS.map(d => d.key));

function normalizeProfile(p) {
  const x = p && typeof p === 'object' ? p : {};
  return { employment: EMPLOYMENT[x.employment] ? x.employment : DEFAULT_PROFILE.employment, deal: DEALS[x.deal] ? x.deal : DEFAULT_PROFILE.deal };
}

function docApplies(d, profile) {
  const f = d.for || {};
  return (!f.employment || f.employment.includes(profile.employment)) && (!f.deal || f.deal.includes(profile.deal));
}

function validateClient(input) {
  if (!input || typeof input !== 'object') throw new Error('תיק לא תקין');
  const name = str(input.name, 200, 'שם הלקוח');
  if (!name) throw new Error('שם הלקוח חובה');
  const requestedAmount = Number(input.requestedAmount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 1e9) throw new Error('הסכום המבוקש אינו תקין');
  const propertyValue = Number(input.propertyValue || 0);
  if (!Number.isFinite(propertyValue) || propertyValue < 0 || propertyValue > 1e10) throw new Error('שווי הנכס אינו תקין');
  const feeType = input.feeType === 'fixed' ? 'fixed' : 'percent';
  const feeValue = Number(input.feeValue || 0);
  if (!Number.isFinite(feeValue) || feeValue < 0 || (feeType === 'percent' ? feeValue > 10 : feeValue > 1e7)) throw new Error('עמלת הייעוץ אינה תקינה');
  const out = {
    name,
    phone: str(input.phone, 30, 'הטלפון'),
    bank: str(input.bank, 100, 'שם הבנק'),
    requestedAmountAg: toAg(requestedAmount),
    propertyValueAg: toAg(propertyValue),
    status: normalizeStage(input.status) || DEFAULT_STAGE,
    feeType,
    notes: str(input.notes, 2000, 'ההערות')
  };
  out.lostReason = out.status === 'lost' ? str(input.lostReason, 300, 'סיבת הסגירה') : '';
  // הטופס שולח employment / deal שטוחים; רשומה שמורה מחזיקה profile
  const p = input.profile && typeof input.profile === 'object' ? input.profile : {};
  out.profile = normalizeProfile({ employment: input.employment ?? p.employment, deal: input.deal ?? p.deal });
  if (feeType === 'percent') out.feePercent = Math.round(feeValue * 1000) / 1000;
  else out.feeFixedAg = toAg(feeValue);
  const deposit = Number(input.feeDeposit || 0);
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > 1e7) throw new Error('סכום המקדמה אינו תקין');
  out.feeDepositAg = toAg(deposit);
  return out;
}

const SHEKEL_CLIENT_FIELDS = ['requestedAmount', 'propertyValue', 'feeValue'];
const isAg = (v) => Number.isInteger(v);
const agOf = (v) => { const n = Number(v); return Number.isFinite(n) ? toAg(n) : 0; };

// רשומה שמורה (או ישנה בשקלים) ← צורה שמורה באגורות. לא זורקת: ערך פגום ברשומה ישנה ← 0
function clientStored(c) {
  if (!c || typeof c !== 'object') return c;
  const out = { ...c };
  out.status = normalizeStage(c.status) || DEFAULT_STAGE;
  out.profile = normalizeProfile(c.profile);
  delete out.employment; delete out.deal;
  if (!isAg(out.requestedAmountAg)) out.requestedAmountAg = agOf(c.requestedAmount);
  if (!isAg(out.propertyValueAg)) out.propertyValueAg = agOf(c.propertyValue || 0);
  out.feeType = out.feeType === 'fixed' ? 'fixed' : 'percent';
  if (out.feeType === 'percent') {
    if (!Number.isFinite(out.feePercent)) out.feePercent = Number.isFinite(Number(c.feeValue)) ? Math.round(Number(c.feeValue) * 1000) / 1000 : 0;
    delete out.feeFixedAg;
  } else {
    if (!isAg(out.feeFixedAg)) out.feeFixedAg = agOf(c.feeValue || 0);
    delete out.feePercent;
  }
  for (const k of SHEKEL_CLIENT_FIELDS) delete out[k];
  return out;
}

// צורה שמורה ← שקלים לתצוגה (השדות שהמסך והייבוא מכירים)
function clientView(c) {
  const s = clientStored(c);
  const { requestedAmountAg, propertyValueAg, feePercent, feeFixedAg, feeDepositAg, approvals, feePayments, ...rest } = s;
  return {
    ...rest,
    feeDeposit: fromAg(isAg(feeDepositAg) ? feeDepositAg : 0),
    employment: s.profile.employment,
    deal: s.profile.deal,
    requestedAmount: fromAg(requestedAmountAg),
    propertyValue: fromAg(propertyValueAg),
    feeValue: s.feeType === 'fixed' ? fromAg(feeFixedAg) : feePercent
  };
}

// אחוז מימון (LTV) — אחוז עם שתי ספרות
function ltv(client) {
  const c = clientStored(client);
  if (!c.propertyValueAg) return null;
  return Math.round((c.requestedAmountAg * 10000) / c.propertyValueAg) / 100;
}

// עמלת ייעוץ: אחוז מהסכום המבוקש או סכום קבוע, ועליה מע"מ לפי שיעור המע"מ בהגדרות העסק
function advisoryFee(client, vatRate) {
  const rate = Number.isFinite(Number(vatRate)) && vatRate >= 0 && vatRate < 1 ? Number(vatRate) : 0.18;
  const c = clientStored(client);
  const netAg = c.feeType === 'fixed'
    ? c.feeFixedAg
    : Math.round(c.requestedAmountAg * Number(c.feePercent || 0) / 100);
  const vatAg = Math.round(netAg * rate);
  return { net: fromAg(netAg), vat: fromAg(vatAg), total: fromAg(netAg + vatAg), netAg, vatAg, totalAg: netAg + vatAg, vatRate: rate };
}

// מצב מסמך: received (docs — כמו בגרסה הקודמת) / na (docsNa) / missing. נספרים רק מסמכים שחלים על הפרופיל
function docsProgress(client) {
  const profile = normalizeProfile(client.profile);
  const done = new Set((Array.isArray(client.docs) ? client.docs : []).filter(k => DOC_KEYS.has(k)));
  const na = new Set((Array.isArray(client.docsNa) ? client.docsNa : []).filter(k => DOC_KEYS.has(k) && !done.has(k)));
  const items = DOCUMENTS.filter(d => docApplies(d, profile) || done.has(d.key))
    .map(({ for: _f, ...d }) => ({ ...d, done: done.has(d.key), na: na.has(d.key), state: done.has(d.key) ? 'received' : na.has(d.key) ? 'na' : 'missing' }));
  const relevant = items.filter(d => !d.na);
  return { done: relevant.filter(d => d.done).length, total: relevant.length, missing: relevant.filter(d => !d.done).map(d => d.label), profile, items };
}

const DOC_STATES = new Set(['received', 'na', 'missing']);

// קביעת מצב מסמך. בלי state — החלפה בין התקבל / חסר (התנהגות הכפתור הישן)
function setDocState(client, key, state) {
  if (!DOC_KEYS.has(key)) throw new Error('מסמך לא מוכר');
  const docs = new Set(Array.isArray(client.docs) ? client.docs : []);
  const na = new Set(Array.isArray(client.docsNa) ? client.docsNa : []);
  const next = state === undefined || state === null || state === '' ? (docs.has(key) ? 'missing' : 'received') : state;
  if (!DOC_STATES.has(next)) throw new Error('מצב מסמך לא מוכר');
  docs.delete(key); na.delete(key);
  if (next === 'received') docs.add(key);
  if (next === 'na') na.add(key);
  const order = DOCUMENTS.map(d => d.key);
  return { docs: order.filter(k => docs.has(k)), docsNa: order.filter(k => na.has(k)) };
}

function toggleDoc(client, key) {
  return setDocState(client, key).docs;
}

// נוסח ללקוח עם רשימת המסמכים החסרים — להעתקה בלבד; התוכנה לא שולחת דבר
function missingDocsMessage(client, officeName) {
  const p = docsProgress(client);
  if (!p.missing.length) return '';
  const lines = [`שלום ${client.name || ''},`.trim(), 'להמשך הטיפול בתיק המשכנתא חסרים המסמכים הבאים:', ...p.missing.map((m, i) => `${i + 1}. ${m}`), '', 'תודה רבה,'];
  if (officeName) lines.push(String(officeName));
  return lines.join('\n');
}

// ---------- אישורים עקרוניים מהבנקים ----------
// נשמרים בתיק (approvals) בצורת הקלט של מעבדת התמהיל: חלקים מהסכום (%), ריבית/מרווח באחוזים, שנים.
// ההשוואה עצמה נעשית במנוע המעבדה (compareApprovals) — אין חישוב שני.
const MAX_APPROVALS = 10;
const APPROVAL_TRACK_TYPES = new Set(['PRIME', 'FIXED_UNLINKED', 'FIXED_LINKED', 'VARIABLE_UNLINKED', 'VARIABLE_LINKED', 'ELIGIBILITY', 'BRIDGE']);
const REPAYMENT_KEYS = new Set(['SPITZER', 'EQUAL_PRINCIPAL', 'BULLET']);

const optNum = (v, label, min, max) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} אינו תקין`);
  return n;
};

function validateApprovalTrack(t, i, lender) {
  const where = `${lender} — מסלול ${i + 1}`;
  if (!t || typeof t !== 'object' || !APPROVAL_TRACK_TYPES.has(t.type)) throw new Error(`${where}: סוג מסלול לא מוכר`);
  const share = optNum(t.share, `${where}: החלק מהסכום`, 0.01, 100);
  if (share === undefined) throw new Error(`${where}: חסר החלק מהסכום (%)`);
  const years = optNum(t.years, `${where}: התקופה`, 1, 50);
  if (years === undefined) throw new Error(`${where}: חסרה תקופה בשנים`);
  const out = { type: t.type, repayment: REPAYMENT_KEYS.has(t.repayment) ? t.repayment : 'SPITZER', share, years };
  const ratePct = optNum(t.ratePct, `${where}: הריבית`, -5, 30);
  const spreadPct = optNum(t.spreadPct, `${where}: המרווח`, -10, 20);
  const resetMonths = optNum(t.resetMonths, `${where}: תדירות השינוי`, 1, 600);
  const graceMonths = optNum(t.graceMonths, `${where}: חודשי הגרייס`, 0, 600);
  if (ratePct !== undefined) out.ratePct = ratePct;
  if (spreadPct !== undefined) out.spreadPct = spreadPct;
  if (resetMonths !== undefined) out.resetMonths = Math.round(resetMonths);
  if (graceMonths) { out.graceMonths = Math.round(graceMonths); out.graceType = t.graceType === 'FULL' ? 'FULL' : 'PARTIAL'; }
  if (t.anchorKey) out.anchorKey = str(t.anchorKey, 40, 'העוגן');
  return out;
}

function validateApproval(input, i = 0) {
  if (!input || typeof input !== 'object') throw new Error('אישור לא תקין');
  const lender = str(input.lender, 100, 'שם הבנק');
  if (!lender) throw new Error(`אישור ${i + 1}: שם הבנק חובה`);
  const validUntil = input.validUntil ? String(input.validUntil) : '';
  if (validUntil && !isDate(validUntil)) throw new Error(`${lender}: תאריך התוקף אינו תקין`);
  const receivedAt = input.receivedAt ? String(input.receivedAt) : '';
  if (receivedAt && !isDate(receivedAt)) throw new Error(`${lender}: תאריך הקבלה אינו תקין`);
  const fees = optNum(input.fees, `${lender}: העמלות`, 0, 1e7);
  const maxAmount = optNum(input.maxAmount, `${lender}: הסכום המאושר`, 1, 1e10);
  const raw = Array.isArray(input.tracks) ? input.tracks : [];
  if (!raw.length) throw new Error(`${lender}: יש להזין לפחות מסלול אחד`);
  if (raw.length > 12) throw new Error(`${lender}: עד 12 מסלולים`);
  const tracks = raw.map((t, k) => validateApprovalTrack(t, k, lender));
  const totalShare = Math.round(tracks.reduce((s, t) => s + t.share * 100, 0));
  if (totalShare !== 10000) throw new Error(`${lender}: חלקי המסלולים חייבים להסתכם ב-100% (עכשיו ${totalShare / 100}%)`);
  const id = /^[A-Za-z0-9-]{1,60}$/.test(String(input.id || '')) ? String(input.id) : null;
  return { id, lender, receivedAt, validUntil, feesAg: fees === undefined ? 0 : toAg(fees), maxAmountAg: maxAmount === undefined ? null : toAg(maxAmount),
    tracks, notes: str(input.notes, 500, 'ההערות') };
}

// אישור שמור ← שקלים לתצוגה ולמעבדה
function approvalView(a) {
  const { feesAg, maxAmountAg, ...rest } = a;
  return { ...rest, fees: fromAg(feesAg || 0), maxAmount: maxAmountAg == null ? '' : fromAg(maxAmountAg) };
}

// קלט ל-mlab calcApprovals: הסכום של התיק, וכל אישור כהצעה
function approvalsForLab(client) {
  const c = clientStored(client);
  return {
    amount: fromAg(c.requestedAmountAg),
    offers: (Array.isArray(c.approvals) ? c.approvals : []).map(a => {
      const v = approvalView(a);
      return { id: v.id, lender: v.lender, validUntil: v.validUntil, fees: v.fees, maxAmount: v.maxAmount, tracks: v.tracks };
    })
  };
}

function approvalsSummary(client, asOf) {
  const list = Array.isArray(client.approvals) ? client.approvals : [];
  return list.map(a => ({ ...approvalView(a), expired: !!(a.validUntil && a.validUntil < asOf), chosen: client.chosenApprovalId === a.id }));
}

// סכום מסלול באגורות — מצורה שמורה (amountAg) או מטופס / רשומה ישנה (amount בשקלים)
const trackAg = (t) => (isAg(t.amountAg) ? t.amountAg : agOf(t.amount));

function validateTrack(t) {
  const meta = TRACKS[t.type];
  if (!meta) throw new Error('סוג מסלול לא מוכר');
  const amount = isAg(t.amountAg) ? t.amountAg / 100 : Number(t.amount), rate = Number(t.rate), years = Number(t.years);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error(`סכום במסלול ${meta.label} אינו תקין`);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error(`ריבית במסלול ${meta.label} אינה תקינה`);
  if (!Number.isInteger(years) || years < 1 || years > 35) throw new Error(`תקופה במסלול ${meta.label} חייבת להיות 1–35 שנים`);
  return { type: t.type, amountAg: toAg(amount), rate: Math.round(rate * 1000) / 1000, years };
}

// הצעה מתקבלת מהטופס כשדות שטוחים: <type>_amount / _rate / _years. מסלול בלי סכום — לא נכלל.
function tracksFromForm(input) {
  const tracks = [];
  for (const type of TRACK_KEYS) {
    const amount = input[`${type}_amount`];
    if (amount === undefined || amount === null || amount === '' || Number(amount) === 0) continue;
    tracks.push({ type, amount, rate: input[`${type}_rate`], years: input[`${type}_years`] });
  }
  return tracks;
}

function validateOffer(input, clients) {
  if (!input || typeof input !== 'object') throw new Error('הצעה לא תקינה');
  const client = clients.find(c => c.id === input.clientId);
  if (!client) throw new Error('יש לבחור תיק לקוח קיים');
  const bank = str(input.bank, 100, 'שם הבנק');
  if (!bank) throw new Error('שם הבנק חובה');
  const raw = Array.isArray(input.tracks) ? input.tracks : tracksFromForm(input);
  if (raw.length === 0) throw new Error('יש להזין לפחות מסלול אחד (סכום, ריבית ותקופה)');
  const tracks = raw.map(validateTrack);
  const cpi = validateCpi(input.cpi);
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error('תאריך לא תקין');
  return { clientId: client.id, bank, date, tracks, cpi, notes: str(input.notes, 1000, 'ההערות') };
}

// הנחת מדד שנתית באחוזים: ריק = 0, בין −5 ל-20, עד שתי ספרות אחרי הנקודה. משותף להצעה ולמחשבון
function validateCpi(value) {
  const cpi = Number(value === '' || value == null ? 0 : value);
  if (!Number.isFinite(cpi) || cpi < -5 || cpi > 20) throw new Error('הנחת המדד השנתית אינה תקינה (בין −5% ל-20%)');
  return Math.round(cpi * 100) / 100;
}

// הצעה שמורה (או ישנה בשקלים) ← מסלולים באגורות
function offerStored(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.tracks)) return o;
  return { ...o, tracks: o.tracks.map(t => { const { amount, ...rest } = t; return { ...rest, amountAg: trackAg(t) }; }) };
}

// לוח סילוקין חודשי למסלול (שפיצר). במסלול צמוד: הקרן מוצמדת למדד בכל חודש ולפני חישוב התשלום,
// והתשלום מחושב מחדש על היתרה המוצמדת — כך שהתשלום עולה עם המדד.
function trackSchedule(track, cpiAnnualPct = 0) {
  const meta = TRACKS[track.type];
  const n = track.years * 12;
  const r = Number(track.rate) / 100 / 12;
  const monthlyIndex = meta.indexed ? Math.pow(1 + Number(cpiAnnualPct) / 100, 1 / 12) - 1 : 0;
  let balance = trackAg(track);
  const rows = [];
  for (let m = 1; m <= n; m++) {
    const indexation = Math.round(balance * monthlyIndex);
    balance += indexation;
    const remaining = n - m + 1;
    const interest = Math.round(balance * r);
    let payment;
    if (remaining === 1) payment = balance + interest;
    else if (r === 0) payment = Math.round(balance / remaining);
    else payment = Math.round(balance * r / (1 - Math.pow(1 + r, -remaining)));
    const principal = payment - interest;
    balance -= principal;
    rows.push({ month: m, paymentAg: payment, interestAg: interest, principalAg: principal, indexationAg: indexation, balanceAg: balance });
  }
  return rows;
}

// לוח מאוחד להצעה (כל המסלולים יחד) + סיכום
function offerSchedule(offer) {
  const perTrack = offer.tracks.map(t => trackSchedule(t, offer.cpi));
  const months = Math.max(...perTrack.map(s => s.length));
  const rows = [];
  for (let i = 0; i < months; i++) {
    const row = { month: i + 1, paymentAg: 0, interestAg: 0, principalAg: 0, indexationAg: 0, balanceAg: 0 };
    for (const s of perTrack) {
      const x = s[i];
      if (!x) continue;
      row.paymentAg += x.paymentAg; row.interestAg += x.interestAg; row.principalAg += x.principalAg;
      row.indexationAg += x.indexationAg; row.balanceAg += x.balanceAg;
    }
    rows.push(row);
  }
  return rows;
}

function offerSummary(offer) {
  const rows = offerSchedule(offer);
  const principalAg = offer.tracks.reduce((t, x) => t + trackAg(x), 0);
  const paidAg = rows.reduce((t, r) => t + r.paymentAg, 0);
  return {
    principal: fromAg(principalAg),
    months: rows.length,
    firstPayment: fromAg(rows[0] ? rows[0].paymentAg : 0),
    maxPayment: fromAg(rows.reduce((m, r) => Math.max(m, r.paymentAg), 0)),
    totalPaid: fromAg(paidAg),
    totalInterest: fromAg(rows.reduce((t, r) => t + r.interestAg, 0)),
    totalIndexation: fromAg(rows.reduce((t, r) => t + r.indexationAg, 0)),
    costOfCredit: fromAg(paidAg - principalAg),
    tracks: offer.tracks.map(t => { const { amountAg, ...rest } = t; return { ...rest, amount: fromAg(trackAg(t)), label: TRACKS[t.type].label }; })
  };
}

// סיכום שנתי לתצוגה (לוח חודשי מלא נשמר לייצוא)
function yearlySchedule(offer) {
  const out = [];
  for (const r of offerSchedule(offer)) {
    const y = Math.ceil(r.month / 12);
    const cur = out[y - 1] || (out[y - 1] = { year: y, paymentAg: 0, interestAg: 0, principalAg: 0, indexationAg: 0, balanceAg: 0 });
    cur.paymentAg += r.paymentAg; cur.interestAg += r.interestAg; cur.principalAg += r.principalAg;
    cur.indexationAg += r.indexationAg; cur.balanceAg = r.balanceAg;
  }
  return out.map(y => ({ year: y.year, payment: fromAg(y.paymentAg), interest: fromAg(y.interestAg), principal: fromAg(y.principalAg), indexation: fromAg(y.indexationAg), balance: fromAg(y.balanceAg) }));
}

// השוואת הצעות של לקוח אחד: ממוין לפי עלות כוללת, ומסומנות ההצעה הזולה וזו עם ההחזר הראשון הנמוך
function compareOffers(offers) {
  const rows = offers.map(o => ({ id: o.id, bank: o.bank, date: o.date, ...offerSummary(o) }))
    .sort((a, b) => a.totalPaid - b.totalPaid || a.firstPayment - b.firstPayment);
  if (rows.length) {
    rows[0].cheapest = true;
    const minFirst = Math.min(...rows.map(r => r.firstPayment));
    rows.forEach(r => { if (r.firstPayment === minFirst) r.lowestFirstPayment = true; });
    const base = toAg(rows[0].totalPaid);
    rows.forEach(r => { r.diffFromBest = fromAg(toAg(r.totalPaid) - base); });
  }
  return rows;
}

function scheduleTable(offer, clientName) {
  const headers = ['חודש', 'תשלום', 'ריבית', 'קרן', 'הצמדה', 'יתרה'];
  const rows = offerSchedule(offer).map(r => [r.month, fromAg(r.paymentAg), fromAg(r.interestAg), fromAg(r.principalAg), fromAg(r.indexationAg), fromAg(r.balanceAg)]);
  return { name: `לוח-סילוקין-${clientName || ''}-${offer.bank}`.replace(/[\\/:*?"<>|]/g, '_'), headers, rows };
}

// ---------- עמלות והכנסות המשרד ----------
// תשלומי עמלה נשמרים בתיק (feePayments, באגורות כולל מע"מ). הדוח לפי תאריך התשלום (בסיס מזומן).
const MAX_FEE_PAYMENTS = 50;
const FEE_METHODS = { transfer: 'העברה בנקאית', check: 'המחאה', cash: 'מזומן', card: 'כרטיס אשראי', other: 'אחר' };

function validateFeePayment(input) {
  if (!input || typeof input !== 'object') throw new Error('תשלום לא תקין');
  const date = String(input.date || '');
  if (!isDate(date)) throw new Error('תאריך התשלום אינו תקין');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e7) throw new Error('סכום התשלום אינו תקין');
  return { date, amountAg: toAg(amount), method: FEE_METHODS[input.method] ? input.method : 'transfer', note: str(input.note, 200, 'ההערה') };
}

// מצב העמלה: none (אין עמלה) / open / partial / paid. מקדמה (feeDepositAg) — הסכום שמבקשים מראש
function feeStatus(client, vatRate) {
  const c = clientStored(client);
  const fee = advisoryFee(c, vatRate);
  const paidAg = (Array.isArray(c.feePayments) ? c.feePayments : []).reduce((t, p) => t + (isAg(p.amountAg) ? p.amountAg : 0), 0);
  const depositAg = isAg(c.feeDepositAg) ? Math.min(c.feeDepositAg, fee.totalAg) : 0;
  const balanceAg = Math.max(0, fee.totalAg - paidAg);
  const state = fee.totalAg === 0 ? 'none' : paidAg === 0 ? 'open' : balanceAg === 0 ? 'paid' : 'partial';
  return { totalAg: fee.totalAg, paidAg, balanceAg, depositAg, depositDueAg: Math.max(0, depositAg - paidAg), overpaidAg: Math.max(0, paidAg - fee.totalAg), state,
    total: fromAg(fee.totalAg), paid: fromAg(paidAg), balance: fromAg(balanceAg), deposit: fromAg(depositAg) };
}

const FEE_STATES = { none: 'אין עמלה', open: 'טרם שולם', partial: 'שולם חלקית', paid: 'שולם' };

// הכנסות המשרד בשנה: התקבל לפי חודש וליועץ, יתרות פתוחות (תיקים שלא "לא התקדם"), וצפי מתיקים פתוחים
function officeIncome(clients, { year, vatRate, advisorName = () => '' } = {}) {
  const y = String(year || new Date().getFullYear());
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, receivedAg: 0 }));
  const by = new Map();
  const row = (id) => {
    if (!by.has(id)) by.set(id, { advisorId: id, name: id ? advisorName(id) : 'ללא שיוך', receivedAg: 0, outstandingAg: 0, cases: 0, closedCases: 0 });
    return by.get(id);
  };
  let outstandingAg = 0;
  for (const raw of clients) {
    const c = clientStored(raw);
    const r = row(c.advisorId || '');
    r.cases++;
    if (c.status === 'closed') r.closedCases++;
    for (const p of Array.isArray(c.feePayments) ? c.feePayments : []) {
      if (!String(p.date).startsWith(y + '-')) continue;
      months[Number(p.date.slice(5, 7)) - 1].receivedAg += p.amountAg;
      r.receivedAg += p.amountAg;
    }
    if (c.status !== 'lost') {
      const st = feeStatus(c, vatRate);
      r.outstandingAg += st.balanceAg;
      outstandingAg += st.balanceAg;
    }
  }
  const advisors = [...by.values()].sort((a, b) => b.receivedAg - a.receivedAg);
  const receivedAg = months.reduce((t, m) => t + m.receivedAg, 0);
  return {
    year: y,
    months: months.map(m => ({ ...m, received: fromAg(m.receivedAg) })),
    advisors: advisors.map(a => ({ ...a, received: fromAg(a.receivedAg), outstanding: fromAg(a.outstandingAg) })),
    receivedAg, outstandingAg, received: fromAg(receivedAg), outstanding: fromAg(outstandingAg)
  };
}

// ---------- משרד: יועצים, הרשאות וצנרת תיקים ----------
// actor = { id, username, isManager }. בלי actor (קריאה פנימית / בדיקות) — גישה מלאה.

const DEFAULT_SETTINGS = { ownOnly: true, stuckDays: 14 };

function normalizeSettings(s) {
  const x = s && typeof s === 'object' ? s : {};
  const d = Number(x.stuckDays);
  return {
    ownOnly: x.ownOnly !== false,
    stuckDays: Number.isInteger(d) && d >= 1 && d <= 365 ? d : DEFAULT_SETTINGS.stuckDays
  };
}

// יועץ רואה את התיקים שלו ותיקים שלא שויכו; מנהל רואה הכול. ownOnly כבוי — כולם רואים הכול
function canSee(client, actor, settings) {
  if (!actor || actor.isManager) return true;
  if (!normalizeSettings(settings).ownOnly) return true;
  return !client.advisorId || client.advisorId === actor.id;
}

// שיוך יועץ: מנהל — לכל יועץ פעיל או בלי שיוך; יועץ — רק לעצמו (או השארת השיוך הקיים)
function resolveAdvisor(requested, current, actor, advisorIds) {
  const want = requested === undefined ? current : String(requested || '');
  if (want === (current || '')) return want || '';
  if (!actor || actor.isManager) {
    if (want && !advisorIds.includes(want)) throw new Error('היועץ שנבחר אינו משתמש פעיל במערכת');
    return want;
  }
  if (want === actor.id) return want;
  throw new Error('רק מנהל יכול לשייך תיק ליועץ אחר');
}

// שינוי שלב נרשם בהיסטוריה — ממנה מחושבים הימים בשלב
function withStage(prev, next, actor, at) {
  const history = Array.isArray(prev.stageHistory) ? prev.stageHistory.slice(-100) : [];
  if (!history.length || prev.status !== next.status) history.push({ stage: next.status, at, by: actor ? actor.id : null });
  return { ...next, stageHistory: history };
}

const DAY_MS = 86400000;
function stageSince(c) {
  const h = Array.isArray(c.stageHistory) ? c.stageHistory : [];
  const last = h.length && h[h.length - 1].stage === c.status ? h[h.length - 1].at : null;
  return last || c.updatedAt || c.createdAt || null;
}

function daysInStage(c, nowMs) {
  const since = Date.parse(stageSince(c));
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, Math.floor((nowMs - since) / DAY_MS));
}

// לוח העמודות: עמודה לכל שלב, כרטיס לכל תיק. "תקוע" = תיק פתוח שעבר את מספר הימים בהגדרות.
// קריאה בלבד — אין שום פעולה אוטומטית.
function pipelineBoard(clients, { nowMs = Date.now(), settings, advisorName = () => '' } = {}) {
  const st = normalizeSettings(settings);
  const columns = STAGE_KEYS.map(k => ({ stage: k, label: CLIENT_STATUSES[k], closed: CLOSED_STAGES.has(k), cards: [], totalAg: 0 }));
  const byStage = new Map(columns.map(c => [c.stage, c]));
  for (const raw of clients) {
    const c = clientStored(raw);
    const col = byStage.get(c.status) || byStage.get(DEFAULT_STAGE);
    const days = daysInStage(c, nowMs);
    const stuck = !col.closed && days > st.stuckDays;
    col.cards.push({ id: c.id, name: c.name, advisorId: c.advisorId || '', advisorName: c.advisorId ? advisorName(c.advisorId) : '',
      requestedAmount: fromAg(c.requestedAmountAg), days, stuck, lostReason: c.lostReason || '' });
    col.totalAg += c.requestedAmountAg;
  }
  for (const col of columns) {
    col.cards.sort((a, b) => b.days - a.days);
    col.total = fromAg(col.totalAg);
  }
  const open = columns.filter(c => !c.closed);
  return {
    columns,
    stuckCount: open.reduce((t, c) => t + c.cards.filter(x => x.stuck).length, 0),
    openCount: open.reduce((t, c) => t + c.cards.length, 0),
    stuckDays: st.stuckDays
  };
}

module.exports = {
  TRACKS, TRACK_KEYS, CLIENT_STATUSES, STAGE_KEYS, CLOSED_STAGES, DEFAULT_STAGE, DOCUMENTS, DEFAULT_SETTINGS,
  normalizeStage, normalizeSettings, canSee, resolveAdvisor, withStage, daysInStage, pipelineBoard,
  EMPLOYMENT, DEALS, normalizeProfile, setDocState, missingDocsMessage,
  MAX_APPROVALS, validateApproval, approvalView, approvalsForLab, approvalsSummary,
  MAX_FEE_PAYMENTS, FEE_METHODS, FEE_STATES, validateFeePayment, feeStatus, officeIncome,
  validateClient, clientStored, clientView, offerStored, ltv, advisoryFee, docsProgress, toggleDoc,
  validateTrack, tracksFromForm, validateOffer, validateCpi, trackSchedule, offerSchedule, offerSummary,
  yearlySchedule, compareOffers, scheduleTable
};
