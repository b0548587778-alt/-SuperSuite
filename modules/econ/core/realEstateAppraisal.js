// שמאות מקרקעין: נכס, עסקאות השוואה עם התאמות, שלוש גישות (השוואה, היוון הכנסות, עלות), שקלול, נעילה ודוח שמאי.
// פונקציות טהורות, בלי Electron. כסף באגורות שלמות, התאמות ושיעורים בנקודות בסיס (1% = 100), שטח במ"ר (עד 2 ספרות).
// אין רשת: עסקאות ההשוואה מוקלדות או נקלטות מקובץ CSV שהמשתמש הוריד בעצמו.
// מבנה הדוח וההגדרות נכתבו בניסוח עצמאי. התאמה לתקני מועצת השמאים — לבירור (לא אומתה מול נוסח התקנים).
const X = require('./exports');

const esc = X.esc;
const MAX_CASES = 5000;
const MAX_COMPS = 60;
// צילומים: כל שמירה במסד כותבת את כל האוספים — לכן תקרה לתמונה, לתיק ולסך הכול
const PHOTO_MAX_CHARS = 280000;   // כ-200KB אחרי הקטנה בממשק
const PHOTOS_PER_CASE = 6;
const PHOTOS_TOTAL_CHARS = 20000000; // כ-15MB לכל התיקים יחד
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_ADJ_BP = 5000; // התאמה בודדת: עד ±50%

const PURPOSES = {
  sale: 'מכירה או קנייה', mortgage: 'בטוחה למשכנתא', estate: 'עיזבון וירושה', division: 'פירוק שיתוף וחלוקה',
  tax: 'מיסוי (שבח / רכישה)', betterment: 'היטל השבחה', compensation: 'פיצויים והפקעה', court: 'הליך משפטי', other: 'אחר',
};
const PROPERTY_TYPES = {
  apartment: 'דירה', garden: 'דירת גן', penthouse: 'פנטהאוז / דירת גג', house: 'בית צמוד קרקע', land: 'מגרש',
  shop: 'חנות', office: 'משרד', industrial: 'מבנה תעשייה / מלאכה', storage: 'מחסן', other: 'אחר',
};
const RIGHTS = { ownership: 'בעלות', lease: 'חכירה', leaseCapitalized: 'חכירה מהוונת', other: 'אחר' };
const CONDITIONS = { new: 'חדש', renovated: 'משופץ', good: 'טוב', fair: 'סביר', poor: 'דורש שיפוץ' };
// סוגי התאמה לעסקת השוואה
const ADJ_FACTORS = {
  time: 'מועד', location: 'מיקום', size: 'גודל', floor: 'קומה', condition: 'מצב', age: 'גיל המבנה',
  view: 'נוף וכיווני אוויר', parking: 'חניה ומחסן', rights: 'זכויות', other: 'אחר',
};
const APPROACHES = { sales: 'גישת ההשוואה', income: 'גישת היוון הכנסות', cost: 'גישת העלות' };
// ספי אזהרה פנימיים של התוכנה — לא דרישה של תקן
const WARN = { minComps: 3, grossAdjBp: 2500, maxAgeMonths: 24, spreadPct: 30 };
// ניתוח רגישות: שינויים בשיעור ההיוון סביב השיעור שנבחר — בחירה של התוכנה לתצוגה, לא דרישה של תקן
const SENS_CAP_STEPS_BP = [-100, -50, 0, 50, 100];

const DEFAULT_ASSUMPTIONS = [
  'השומה נכונה למועד הקובע בלבד.',
  'הנתונים על הנכס, הזכויות והמצב התכנוני נמסרו לשמאי או נבדקו על ידיו כמפורט בדוח. אם יתברר שהם שונים — השומה עשויה להשתנות.',
  'הנכס הוערך כפנוי, נקי מחובות, שעבודים ועיקולים, אלא אם צוין אחרת.',
  'עסקאות ההשוואה נלקחו מהמקורות שמצוינים לצד כל עסקה, ולא נבדקו פרטי כל עסקה מול הצדדים לה.',
  'הדוח מיועד למזמין ולמטרה שמצוינים בו בלבד.',
].join('\n');
const DEFAULT_DECLARATION = 'אני הח"מ ביקרתי בנכס וערכתי את השומה לפי מיטב ידיעתי, ניסיוני ושיקול דעתי המקצועי. אין לי עניין אישי בנכס או בצדדים לו.';

const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
// תאריך אמיתי בלבד: 2026-02-30 נדחה (Date.parse מגלגל אותו למרץ)
const isDay = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const pick = (map, v, def) => (Object.prototype.hasOwnProperty.call(map, v) ? v : def);

// סכום בשקלים מהקלדה ("1,250,000", "₪ 980000.50") או מספר אגורות שלם ← אגורות. ריק ← null
function toAg(v, label) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label}: סכום לא תקין`);
    return v;
  }
  const s = String(v).replace(/[₪,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`${label}: יש להזין סכום`);
  const [a, b = ''] = s.split('.');
  const ag = Number(a) * 100 + Number((b + '00').slice(0, 2));
  if (!Number.isSafeInteger(ag) || ag > 1e14) throw new Error(`${label}: סכום גדול מדי`);
  return ag;
}

// שטח במ"ר, עד 2 ספרות אחרי הנקודה. ריק ← null
function toArea(v, label, { max = 1000000 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[\s,]/g, (m) => (m === ',' ? '.' : ''));
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`${label}: יש להזין שטח במ"ר`);
  const n = Number(s);
  if (!(n > 0 && n <= max)) throw new Error(`${label}: שטח מחוץ לטווח`);
  return n;
}

// אחוז מהקלדה ("-5", "2.5", "+3") ← נקודות בסיס שלמות. ריק ← 0
function pctToBp(v, label, { min = -MAX_ADJ_BP, max = MAX_ADJ_BP } = {}) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isInteger(v)) { if (v < min || v > max) throw new Error(`${label}: מחוץ לטווח`); return v; }
  const s = String(v).trim().replace(/%/g, '').replace(',', '.');
  const m = s.match(/^([+-]?)(\d{1,4})(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`${label}: יש להזין אחוז`);
  const bp = (Number(m[2]) * 100 + Number(((m[3] || '') + '00').slice(0, 2))) * (m[1] === '-' ? -1 : 1);
  if (bp < min || bp > max) throw new Error(`${label}: ${bp / 100}% מחוץ לטווח (${min / 100}% עד ${max / 100}%)`);
  return bp;
}

const intOrNull = (v, label, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: מספר לא תקין`);
  return n;
};

// ספרת ביקורת של מספר זהות (משלימים ל-9 ספרות)
function validIsraeliId(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{5,9}$/.test(s) || /^0+$/.test(s)) return false;
  const id = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) { let d = Number(id[i]) * ((i % 2) + 1); if (d > 9) d -= 9; sum += d; }
  return sum % 10 === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  אימות קלט
// ─────────────────────────────────────────────────────────────────────────────

function validateClient(c = {}) {
  const out = { name: txt(c.name, 80), idNumber: txt(c.idNumber, 9), phone: txt(c.phone, 30), email: txt(c.email, 80), address: txt(c.address, 120) };
  if (out.idNumber) {
    if (!validIsraeliId(out.idNumber)) throw new Error('מספר הזהות של המזמין אינו תקין');
    out.idNumber = out.idNumber.padStart(9, '0');
  }
  return out;
}

function validateProperty(p = {}) {
  return {
    address: txt(p.address, 160), city: txt(p.city, 60),
    block: txt(p.block, 12), parcel: txt(p.parcel, 12), subParcel: txt(p.subParcel, 12),
    type: pick(PROPERTY_TYPES, p.type, 'apartment'), rights: pick(RIGHTS, p.rights, 'ownership'),
    condition: pick(CONDITIONS, p.condition, 'good'),
    area: toArea(p.area, 'שטח הנכס'), equivArea: toArea(p.equivArea, 'שטח אקוויוולנטי'),
    landArea: toArea(p.landArea, 'שטח הקרקע'),
    rooms: p.rooms === '' || p.rooms === undefined || p.rooms === null ? null : toArea(p.rooms, 'מספר חדרים', { max: 100 }),
    floor: intOrNull(p.floor, 'קומה', -5, 200), floors: intOrNull(p.floors, 'מספר קומות בבניין', 0, 200),
    yearBuilt: intOrNull(p.yearBuilt, 'שנת בנייה', 1800, 2100),
    parking: txt(p.parking, 60), storage: txt(p.storage, 60),
    description: txt(p.description, 4000), environment: txt(p.environment, 4000),
    planning: txt(p.planning, 4000), legal: txt(p.legal, 4000), considerations: txt(p.considerations, 4000),
  };
}

function validateComparable(c = {}, n = 1) {
  const where = `עסקה ${n}`;
  const date = txt(c.date, 10);
  if (!isDay(date)) throw new Error(`${where}: תאריך העסקה אינו תקין`);
  const priceAg = toAg(c.priceAg ?? c.price, `${where}: מחיר`);
  if (!(priceAg > 0)) throw new Error(`${where}: יש להזין מחיר`);
  const area = toArea(c.area, `${where}: שטח`);
  if (!area) throw new Error(`${where}: יש להזין שטח`);
  const adjustments = (Array.isArray(c.adjustments) ? c.adjustments : [])
    .filter(a => a && (a.pct !== '' && a.pct !== undefined && a.pct !== null || Number.isInteger(a.bp)))
    .slice(0, 12)
    .map((a, i) => ({
      factor: pick(ADJ_FACTORS, a.factor, 'other'),
      bp: Number.isInteger(a.bp) ? pctToBp(a.bp, `${where}, התאמה ${i + 1}`) : pctToBp(a.pct, `${where}, התאמה ${i + 1}`),
      note: txt(a.note, 120),
    }));
  // נבדק כאן ולא רק בחישוב: אחרת התיק נשמר, והטעינה שלו נכשלת עד שמתקנים אותו (בדיקה 21.10.2026, ממצא 2)
  const netBp = adjustments.reduce((s, a) => s + a.bp, 0);
  if (netBp <= -10000) throw new Error(`${where}: סך ההתאמות (${netBp / 100}%) מאפס את מחיר העסקה`);
  return {
    id: txt(c.id, 40) || null,
    date, priceAg, area,
    address: txt(c.address, 160), city: txt(c.city, 60),
    block: txt(c.block, 12), parcel: txt(c.parcel, 12), subParcel: txt(c.subParcel, 12),
    rooms: c.rooms === '' || c.rooms === undefined || c.rooms === null ? null : toArea(c.rooms, `${where}: חדרים`, { max: 100 }),
    floor: intOrNull(c.floor, `${where}: קומה`, -5, 200),
    yearBuilt: intOrNull(c.yearBuilt, `${where}: שנת בנייה`, 1800, 2100),
    source: txt(c.source, 80), notes: txt(c.notes, 300),
    included: c.included !== false,
    weight: intOrNull(c.weight, `${where}: משקל`, 0, 100),
    adjustments,
  };
}

function validateIncome(i = {}) {
  return {
    enabled: i.enabled === true,
    monthlyRentAg: toAg(i.monthlyRentAg ?? i.monthlyRent, 'שכר דירה חודשי'),
    vacancyBp: pctToBp(i.vacancyPct ?? i.vacancyBp, 'שיעור אי-תפוסה', { min: 0, max: 5000 }),
    annualExpensesAg: toAg(i.annualExpensesAg ?? i.annualExpenses, 'הוצאות שנתיות') || 0,
    capRateBp: pctToBp(i.capRatePct ?? i.capRateBp, 'שיעור היוון', { min: 0, max: 3000 }),
    note: txt(i.note, 1000),
  };
}

function validateCost(c = {}) {
  return {
    enabled: c.enabled === true,
    landAg: toAg(c.landAg ?? c.land, 'שווי הקרקע') || 0,
    buildArea: toArea(c.buildArea, 'שטח בנוי לחישוב העלות'),
    costPerSqmAg: toAg(c.costPerSqmAg ?? c.costPerSqm, 'עלות הקמה למ"ר'),
    profitBp: pctToBp(c.profitPct ?? c.profitBp, 'רווח יזמי', { min: 0, max: 5000 }),
    depreciationBp: pctToBp(c.depreciationPct ?? c.depreciationBp, 'פחת', { min: 0, max: 10000 }),
    note: txt(c.note, 1000),
  };
}

// שקלול: משקל לכל גישה (אחוזים שלמים), עיגול, ושווי סופי ידני עם נימוק
function validateReconcile(r = {}) {
  const w = r.weights || {};
  const weights = {};
  for (const k of Object.keys(APPROACHES)) weights[k] = intOrNull(w[k], `משקל ${APPROACHES[k]}`, 0, 100) ?? 0;
  const roundTo = [0, 100, 1000, 5000, 10000].includes(Number(r.roundToIls)) ? Number(r.roundToIls) : 1000;
  return {
    weights, roundToIls: roundTo,
    overrideAg: toAg(r.overrideAg ?? r.override, 'שווי סופי שנקבע'),
    overrideReason: txt(r.overrideReason, 1000),
    note: txt(r.note, 2000),
  };
}

function validateCase(input = {}, today) {
  const comps = (Array.isArray(input.comparables) ? input.comparables : []);
  if (comps.length > MAX_COMPS) throw new Error(`עד ${MAX_COMPS} עסקאות השוואה בתיק`);
  return {
    client: validateClient(input.client),
    purpose: pick(PURPOSES, input.purpose, 'sale'), purposeOther: txt(input.purposeOther, 120),
    visitDate: isDay(input.visitDate) ? input.visitDate : today,
    effectiveDate: isDay(input.effectiveDate) ? input.effectiveDate : today,
    property: validateProperty(input.property),
    comparables: comps.map((c, i) => validateComparable(c, i + 1)),
    income: validateIncome(input.income),
    cost: validateCost(input.cost),
    reconcile: validateReconcile(input.reconcile),
    assumptions: input.assumptions === undefined ? DEFAULT_ASSUMPTIONS : txt(input.assumptions, 4000),
    reportLang: input.reportLang === 'he-en' ? 'he-en' : 'he',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  חישובים
// ─────────────────────────────────────────────────────────────────────────────

const monthsBetween = (from, to) => {
  const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

// עסקה בודדת: מחיר למ"ר, התאמה נטו (סכום) וגולמית (סכום ערכים מוחלטים), ומחיר מותאם למ"ר — באגורות
function comparableResult(c) {
  const perSqmAg = Math.round(c.priceAg / c.area);
  const netBp = c.adjustments.reduce((s, a) => s + a.bp, 0);
  const grossBp = c.adjustments.reduce((s, a) => s + Math.abs(a.bp), 0);
  // תיק שנשמר לפני הבדיקה ב-validateComparable: העסקה לא נכנסת לחישוב (אזהרה ב-salesApproach), והתיק נטען
  if (netBp <= -10000) return { perSqmAg, netBp, grossBp, adjustedPerSqmAg: null, invalid: true };
  return { perSqmAg, netBp, grossBp, adjustedPerSqmAg: Math.round(perSqmAg * (10000 + netBp) / 10000) };
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// גישת ההשוואה: ממוצע משוקלל של המחיר המותאם למ"ר × השטח האקוויוולנטי (או הבנוי)
function salesApproach(cs) {
  const area = cs.property.equivArea || cs.property.area;
  const rows = cs.comparables.map((c, i) => ({ n: i + 1, included: c.included, ...comparableResult(c), ageMonths: monthsBetween(c.date, cs.effectiveDate) }));
  const used = rows.filter(r => r.included && !r.invalid);
  const warnings = rows.filter(r => r.included && r.invalid).map(r => `עסקה ${r.n}: סך ההתאמות מאפס את מחיר העסקה — לא נכללה בחישוב`);
  if (!used.length) return { ok: false, rows, warnings: [...warnings, 'אין עסקאות השוואה בחישוב'], valueAg: null };
  if (!area) return { ok: false, rows, warnings: ['חסר שטח הנכס'], valueAg: null };
  const weights = used.map(r => cs.comparables[r.n - 1].weight);
  const explicit = weights.some(w => w !== null && w > 0);
  let w = explicit ? weights.map(x => x || 0) : used.map(() => 1);
  const sumW = w.reduce((a, b) => a + b, 0);
  if (explicit && sumW !== 100) warnings.push(`סך המשקלות של העסקאות הוא ${sumW}% — החישוב מנרמל ל-100%`);
  const perSqmAg = Math.round(used.reduce((s, r, i) => s + r.adjustedPerSqmAg * w[i], 0) / sumW);
  const adj = used.map(r => r.adjustedPerSqmAg);
  if (used.length < WARN.minComps) warnings.push(`פחות מ-${WARN.minComps} עסקאות השוואה`);
  for (const r of used) {
    if (r.grossBp > WARN.grossAdjBp) warnings.push(`עסקה ${r.n}: התאמה גולמית של ${r.grossBp / 100}% — כדאי לשקול עסקה דומה יותר`);
    if (r.ageMonths > WARN.maxAgeMonths) warnings.push(`עסקה ${r.n}: ${r.ageMonths} חודשים לפני המועד הקובע`);
    if (r.ageMonths < 0) warnings.push(`עסקה ${r.n}: אחרי המועד הקובע`);
  }
  const min = Math.min(...adj), max = Math.max(...adj);
  if (min > 0 && (max - min) * 100 / min > WARN.spreadPct) warnings.push(`פיזור גדול בין המחירים המותאמים (${Math.round((max - min) * 100 / min)}%)`);
  return {
    ok: true, rows, warnings, area, perSqmAg, valueAg: Math.round(perSqmAg * area),
    stats: { count: used.length, minAg: min, maxAg: max, medianAg: median(adj), weighted: explicit },
  };
}

// היוון הכנסות: הכנסה שנתית × (1 − אי-תפוסה) − הוצאות = NOI; שווי = NOI / שיעור ההיוון
function incomeApproach(i) {
  if (!i.enabled) return { ok: false, valueAg: null, warnings: [] };
  if (!(i.monthlyRentAg > 0)) return { ok: false, valueAg: null, warnings: ['גישת ההכנסות: חסר שכר דירה'] };
  if (!(i.capRateBp > 0)) return { ok: false, valueAg: null, warnings: ['גישת ההכנסות: חסר שיעור היוון'] };
  const grossAg = i.monthlyRentAg * 12;
  const effectiveAg = Math.round(grossAg * (10000 - i.vacancyBp) / 10000);
  const noiAg = effectiveAg - i.annualExpensesAg;
  if (noiAg <= 0) return { ok: false, valueAg: null, warnings: ['גישת ההכנסות: ההוצאות גבוהות מההכנסה'] };
  return { ok: true, grossAg, effectiveAg, noiAg, valueAg: Math.round(noiAg * 10000 / i.capRateBp), warnings: [] };
}

// גישת העלות: קרקע + עלות הקמה × (1 + רווח יזמי) × (1 − פחת)
function costApproach(c, property) {
  if (!c.enabled) return { ok: false, valueAg: null, warnings: [] };
  const area = c.buildArea || property.area;
  if (!area || !(c.costPerSqmAg > 0)) return { ok: false, valueAg: null, warnings: ['גישת העלות: חסרים שטח או עלות הקמה למ"ר'] };
  const buildAg = Math.round(area * c.costPerSqmAg);
  const withProfitAg = Math.round(buildAg * (10000 + c.profitBp) / 10000);
  const depreciatedAg = Math.round(withProfitAg * (10000 - c.depreciationBp) / 10000);
  return { ok: true, area, buildAg, withProfitAg, depreciatedAg, landAg: c.landAg, valueAg: c.landAg + depreciatedAg, warnings: [] };
}

// שקלול הגישות: רק גישות עם תוצאה; בלי משקלות — גישה יחידה מקבלת 100%
function reconcile(cs, results) {
  const r = cs.reconcile;
  const avail = Object.keys(APPROACHES).filter(k => results[k].ok);
  const warnings = [];
  if (!avail.length) return { ok: false, valueAg: null, warnings: ['אין גישה עם תוצאה'] };
  let weights = {};
  const given = avail.reduce((s, k) => s + (r.weights[k] || 0), 0);
  if (given === 0) {
    if (avail.length > 1) warnings.push('לא נקבעו משקלות לגישות — נלקח ממוצע פשוט');
    for (const k of avail) weights[k] = 100 / avail.length;
  } else {
    if (given !== 100) warnings.push(`סך המשקלות של הגישות הוא ${given}% — החישוב מנרמל ל-100%`);
    for (const k of avail) weights[k] = (r.weights[k] || 0) * 100 / given;
  }
  for (const k of Object.keys(APPROACHES)) if (!results[k].ok && r.weights[k] > 0) warnings.push(`ל${APPROACHES[k]} נקבע משקל אבל אין לה תוצאה`);
  const rawAg = Math.round(avail.reduce((s, k) => s + results[k].valueAg * weights[k] / 100, 0));
  const step = r.roundToIls * 100;
  const roundedAg = step ? Math.round(rawAg / step) * step : rawAg;
  const valueAg = r.overrideAg !== null ? r.overrideAg : roundedAg;
  if (r.overrideAg !== null && !r.overrideReason) warnings.push('שווי סופי שנקבע ידנית מחייב נימוק');
  const area = cs.property.equivArea || cs.property.area;
  return { ok: true, weights, rawAg, roundedAg, valueAg, perSqmAg: area ? Math.round(valueAg / area) : null, warnings };
}

// ניתוח רגישות — לבחינה בלבד, לא משנה את השווי: שווי בגישת ההכנסות לפי שיעורי היוון סביב השיעור שנבחר,
// וטווח בגישת ההשוואה לפי המחיר המותאם הנמוך, החציון והגבוה × השטח לחישוב (משתי עסקאות ומעלה)
function sensitivity(cs, r) {
  const out = { income: null, sales: null };
  const inc = r && r.income;
  if (inc && inc.ok && inc.noiAg > 0 && cs.income.capRateBp > 0) {
    out.income = SENS_CAP_STEPS_BP.map(d => cs.income.capRateBp + d).filter(c => c > 0)
      .map(c => ({ capRateBp: c, valueAg: Math.round(inc.noiAg * 10000 / c), base: c === cs.income.capRateBp }));
  }
  const s = r && r.sales;
  if (s && s.ok && s.stats && s.stats.count >= 2 && s.area) {
    out.sales = { lowAg: Math.round(s.stats.minAg * s.area), medianAg: Math.round(s.stats.medianAg * s.area), highAg: Math.round(s.stats.maxAg * s.area) };
  }
  return out;
}

function computeCase(cs) {
  const results = { sales: salesApproach(cs), income: incomeApproach(cs.income), cost: costApproach(cs.cost, cs.property) };
  const final = reconcile(cs, results);
  return { ...results, final, sensitivity: sensitivity(cs, results), warnings: [...results.sales.warnings, ...results.income.warnings, ...results.cost.warnings, ...final.warnings] };
}

// יומן שומות לקובץ CSV — תיקים ממוינים לפי מספר וגרסה; שווי בשקלים עם שתי ספרות (מאגורות)
const STATUS_LABELS = { draft: 'טיוטה', final: 'סופי' };
const REGISTER_HEADERS = ['מספר דוח', 'מצב', 'המועד הקובע', 'המזמין', 'כתובת', 'גוש', 'חלקה', 'מטרת השומה', 'שווי (₪)', 'עסקאות השוואה', 'אזהרות', 'עדכון אחרון'];
function registerExport(summaries, today) {
  const rows = [...summaries].sort((a, b) => (a.no - b.no) || ((a.rev || 0) - (b.rev || 0))).map(c => [
    c.reportNo, STATUS_LABELS[c.status] || c.status, c.effectiveDate || '', c.client || '', c.address || '', c.block || '', c.parcel || '',
    c.purpose || '', Number.isSafeInteger(c.valueAg) ? (c.valueAg / 100).toFixed(2) : '', c.comps, c.warnings,
    String(c.updatedAt || '').slice(0, 10),
  ]);
  return { headers: REGISTER_HEADERS, rows, name: `יומן-שומות-${today}` };
}

// מה חסר לפני נעילה
function finalizeProblems(cs, today) {
  const out = [];
  if (!cs.client.name) out.push('יש להזין את שם המזמין');
  if (cs.purpose === 'other' && !cs.purposeOther) out.push('מטרה "אחר" — יש לפרט');
  if (!cs.property.address) out.push('יש להזין את כתובת הנכס');
  if (!cs.property.block || !cs.property.parcel) out.push('יש להזין גוש וחלקה');
  if (!cs.property.area) out.push('יש להזין את שטח הנכס');
  if (cs.effectiveDate > today) out.push('המועד הקובע אחרי היום');
  if (cs.visitDate > today) out.push('תאריך הביקור אחרי היום');
  const r = computeCase(cs);
  if (!r.final.ok) out.push('אין שווי: יש להשלים לפחות גישה אחת');
  for (const x of r.sales.rows) if (x.included && x.invalid) out.push(`עסקה ${x.n}: סך ההתאמות מאפס את מחיר העסקה — יש לתקן או להוציא מהחישוב`);
  if (cs.reconcile.overrideAg !== null && !cs.reconcile.overrideReason) out.push('שווי סופי שנקבע ידנית מחייב נימוק');
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  קליטת עסקאות מקובץ CSV — זיהוי עמודות לפי כותרת (עברית / אנגלית)
//  פורמט הייצוא של מאגרי העסקאות הרשמיים לא אומת כאן (לבירור) — לכן זיהוי גמיש לפי שם העמודה
// ─────────────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = {
  date: ['תאריך', 'תאריך עסקה', 'יום מכירה', 'תאריך מכירה', 'מועד עסקה', 'date', 'sale date'],
  price: ['מחיר', 'מחיר עסקה', 'מחיר מוצהר', 'מחיר מכירה', 'שווי', 'שווי עסקה', 'שווי מכירה', 'שווי מוצהר', 'סכום', 'סכום עסקה', 'price', 'value'],
  area: ['שטח', 'שטח במ"ר', 'שטח במר', 'מ"ר', 'שטח בנוי', 'area', 'sqm', 'size'],
  address: ['כתובת', 'רחוב', 'address', 'street'],
  city: ['עיר', 'ישוב', 'יישוב', 'city'],
  rooms: ['חדרים', 'מספר חדרים', 'rooms'],
  floor: ['קומה', 'floor'],
  yearBuilt: ['שנת בנייה', 'שנת בניה', 'שנה', 'year built', 'year'],
  block: ['גוש', 'block'],
  parcel: ['חלקה', 'parcel'],
  subParcel: ['תת חלקה', 'תת-חלקה', 'sub parcel', 'subparcel'],
  gushHelka: ['גוש/חלקה', 'גוש חלקה', 'גוש-חלקה', 'גוש חלקה תת חלקה'],
  notes: ['הערות', 'notes'],
};
const MAX_CSV = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 500;

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    // גרשיים פותחים רק בתחילת תא ("שטח במ"ר" בכותרת הוא טקסט רגיל)
    if (!q && ch === '"' && cur.trim()) { cur += ch; continue; }
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const normHead = (h) => String(h || '').replace(/^﻿/, '').replace(/[״"׳'`]/g, '"')
  // יחידה בסוגריים או בסוף הכותרת: "מחיר (₪)", "שטח (מ"ר)", "מחיר בש"ח"
  .replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*(₪|בש"ח|ש"ח|nis|ils)\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normDate = (v) => {
  const s = String(v || '').trim();
  if (isDay(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDay(d) ? d : null;
};

// מחזיר { rows, errors, columns }: שורה לא תקינה מדווחת עם מספר השורה ולא נקלטת; קובץ בלי עמודות חובה — שגיאה
function parseComparablesCsv(text, { source = '' } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('הקובץ ריק');
  if (raw.length > MAX_CSV) throw new Error('הקובץ גדול מדי (עד 2MB)');
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const sep = [',', ';', '\t'].map(s => [s, splitCsvLine(lines[0], s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitCsvLine(lines[0], sep).map(normHead);
  const col = {};
  for (const [k, names] of Object.entries(CSV_COLUMNS)) {
    const idx = head.findIndex(h => names.map(normHead).includes(h));
    if (idx >= 0) col[k] = idx;
  }
  const missing = ['date', 'price', 'area'].filter(k => col[k] === undefined);
  if (missing.length) throw new Error('לא נמצאו עמודות חובה בקובץ: ' + missing.map(k => ({ date: 'תאריך', price: 'מחיר', area: 'שטח' })[k]).join(', '));
  const rows = [], errors = [];
  let i = 1;
  for (; i < lines.length && rows.length < MAX_CSV_ROWS; i++) {
    const cells = splitCsvLine(lines[i], sep);
    const get = (k) => (col[k] === undefined ? '' : cells[col[k]] || '');
    let block = get('block'), parcel = get('parcel'), subParcel = get('subParcel');
    if (!block && get('gushHelka')) [block = '', parcel = '', subParcel = ''] = get('gushHelka').split(/[-/\s]+/);
    const input = {
      date: normDate(get('date')) || get('date'), price: get('price'), area: get('area'),
      address: get('address'), city: get('city'), rooms: get('rooms'), floor: get('floor').replace(/[^\d-]/g, ''),
      yearBuilt: get('yearBuilt'), block, parcel, subParcel, notes: get('notes'), source: txt(source, 80) || 'קובץ',
    };
    try { rows.push(validateComparable(input, i + 1)); }
    catch (e) { errors.push(`שורה ${i + 1}: ${String(e.message).replace(/^עסקה \d+: /, '')}`); }
  }
  // שורות אחרי התקרה לא נקראות — נספרות, כדי שיוצגו כ"מעבר למגבלה" ולא ייעלמו בשקט (בדיקת קוד 21.10.2026)
  return { rows, errors, unread: lines.length - i, columns: Object.keys(col) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  נעילה וגרסאות
// ─────────────────────────────────────────────────────────────────────────────

// settings — פרטי השמאי בזמן הנעילה: נשמרים בתיק, כדי שהדוח שנמסר לא ישתנה כששם המשרד / הרישיון / ההצהרה משתנים
function finalizeCase(cs, today, settings = {}) {
  const problems = finalizeProblems(cs, today);
  if (problems.length) throw new Error(problems.join('\n'));
  return { ...cs, status: 'final', reportDate: today, finalizedAt: new Date().toISOString(), frozen: computeCase(cs), frozenSettings: validateSettings(settings) };
}

// גרסאות קודמות ששמורות במלואן (הדוח שנמסר אפשר להפיק שוב). ישנות יותר — רק תקציר
const MAX_FULL_REVISIONS = 10;

// הגרסה הנעולה עוברת להיסטוריה במלואה — הערכים, העסקאות, החישוב הנעול ופרטי השמאי (בדיקה 21.10.2026, ממצא 5)
function reopenCase(cs) {
  if (cs.status !== 'final') throw new Error('התיק אינו נעול');
  const { history: _h, ...snapshot } = cs;
  const prev = (cs.history || []).map((h, i, all) => (i < all.length - (MAX_FULL_REVISIONS - 1) ? (({ snapshot: _s, ...short }) => short)(h) : h));
  const history = [...prev, { rev: cs.rev || 0, reportDate: cs.reportDate, valueAg: cs.frozen.final.valueAg, finalizedAt: cs.finalizedAt, snapshot }];
  const { frozen, reportDate, finalizedAt, frozenSettings, ...rest } = cs;
  return { ...rest, status: 'draft', rev: (cs.rev || 0) + 1, history };
}

// הגרסה שנמסרה, כפי שהייתה בנעילה — לדוח מחדש. null = גרסה ישנה שלא נשמרה במלואה
function revisionCase(cs, rev) {
  const h = (cs.history || []).find(x => x.rev === rev);
  return h && h.snapshot ? { ...h.snapshot, history: [] } : null;
}

const reportNo = (cs) => String(cs.no) + (cs.rev ? '-' + cs.rev : '');

// ─────────────────────────────────────────────────────────────────────────────
//  דוח שמאי (HTML להדפסה / PDF)
// ─────────────────────────────────────────────────────────────────────────────

const money = (ag) => (ag === null || ag === undefined ? '—' : '₪' + (ag / 100).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
const pct = (bp) => `${bp > 0 ? '+' : ''}${(bp / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}%`;
const day = (d) => (isDay(d) ? `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}` : '—');
const area = (a) => (a ? a.toLocaleString('he-IL', { maximumFractionDigits: 2 }) + ' מ"ר' : '—');
const row = (l, v) => (v === '' || v === null || v === undefined ? '' : `<tr><th>${esc(l)}</th><td>${v}</td></tr>`);
const para = (title, body) => (body ? `<h2>${esc(title)}</h2><div class="text">${esc(body).replace(/\n/g, '<br>')}</div>` : '');
const gushText = (p) => [p.block && `גוש ${p.block}`, p.parcel && `חלקה ${p.parcel}`, p.subParcel && `תת-חלקה ${p.subParcel}`].filter(Boolean).join(', ');

// דוח דו-לשוני: אנגלית לתוויות הקבועות ולערכי הרשימות. תרגום של התוכנה — לא מינוח רשמי של תקן (לבירור)
const EN = {
  'שומת מקרקעין': 'Real Estate Appraisal Report', 'טיוטה — לא לשימוש': 'DRAFT — not for use',
  'מספר דוח': 'Report No.', 'תאריך הדוח': 'Report date', 'המועד הקובע': 'Effective date', 'תאריך הביקור בנכס': 'Inspection date',
  'גרסה מתוקנת של דוח': 'Revision of report', 'המזמין ומטרת השומה': 'Client and purpose', 'המזמין': 'Client', 'מספר זהות': 'ID No.',
  'טלפון': 'Phone', 'מטרת השומה': 'Purpose', 'השמאי': 'Appraiser', 'שם': 'Name', 'מספר רישיון': 'License No.', 'משרד': 'Firm',
  'כתובת': 'Address', 'דוא"ל': 'Email', 'זיהוי הנכס': 'Subject property', 'גוש / חלקה / תת-חלקה': 'Block / Parcel / Sub-parcel',
  'סוג הנכס': 'Property type', 'הזכויות בנכס': 'Property rights', 'שטח': 'Area', 'שטח אקוויוולנטי': 'Equivalent area',
  'שטח הקרקע': 'Land area', 'חדרים': 'Rooms', 'קומה': 'Floor', 'מתוך': 'of', 'שנת בנייה': 'Year built', 'מצב': 'Condition',
  'חניה': 'Parking', 'מחסן': 'Storage', 'תיאור הנכס': 'Description', 'הסביבה': 'Surroundings', 'המצב התכנוני': 'Planning status',
  'המצב המשפטי': 'Legal status', 'גורמים ושיקולים': 'Factors and considerations', 'עסקאות השוואה': 'Comparable sales',
  'תאריך': 'Date', 'מחיר': 'Price', '₪ למ"ר': '₪ per sqm', 'התאמות': 'Adjustments', 'נטו': 'Net', '₪ למ"ר מותאם': 'Adjusted ₪ per sqm',
  'מקור': 'Source', 'לא הוזנו עסקאות.': 'No comparables entered.', 'לא חושבה.': 'Not calculated.',
  'מספר עסקאות בחישוב': 'Comparables used', 'טווח מחירים מותאמים למ"ר': 'Adjusted price range per sqm', 'חציון': 'Median',
  'ממוצע משוקלל למ"ר': 'Weighted average per sqm', 'ממוצע למ"ר': 'Average per sqm', 'שטח לחישוב': 'Area used',
  'שווי לפי גישת ההשוואה': 'Value — sales comparison', 'הכנסה שנתית ברוטו': 'Gross annual income', 'אחרי אי-תפוסה': 'After vacancy',
  'הוצאות שנתיות': 'Annual expenses', 'הכנסה נקייה (NOI)': 'Net operating income (NOI)', 'שיעור היוון': 'Capitalization rate',
  'שווי לפי גישת ההכנסות': 'Value — income capitalization', 'שווי הקרקע': 'Land value', 'שטח בנוי': 'Built area',
  'עלות הקמה למ"ר': 'Construction cost per sqm', 'עלות הקמה': 'Construction cost', 'רווח יזמי': 'Entrepreneurial profit',
  'פחת': 'Depreciation', 'מבנה אחרי פחת': 'Depreciated improvements', 'שווי לפי גישת העלות': 'Value — cost approach',
  'שקלול ושומה סופית': 'Reconciliation and final value', 'גישה': 'Approach', 'שווי': 'Value', 'משקל': 'Weight',
  'השווי נקבע על ידי השמאי:': 'Value set by the appraiser:', 'שווי הנכס במועד הקובע:': 'Market value at the effective date:',
  'צילומים': 'Photographs', 'הנחות ומגבלות': 'Assumptions and limiting conditions', 'הצהרת השמאי': "Appraiser's declaration",
  'חתימת השמאי': "Appraiser's signature", 'חותמת': 'Stamp',
  'ניתוח רגישות': 'Sensitivity analysis', 'שווי לפי גישת ההכנסות בשיעורי היוון שונים': 'Income value at alternative capitalization rates',
  'טווח לפי עסקאות ההשוואה': 'Range from comparable sales', 'נמוך': 'Low', 'גבוה': 'High', 'השיעור שנבחר': 'Selected rate',
  'הטבלה לבחינה בלבד ואינה חלק מקביעת השווי.': 'For review only; not part of the value conclusion.',
};
const VALUE_MAPS = { purposes: PURPOSES, types: PROPERTY_TYPES, rights: RIGHTS, conditions: CONDITIONS, factors: ADJ_FACTORS, approaches: APPROACHES };
const EN_VALUES = {
  purposes: { sale: 'Sale or purchase', mortgage: 'Mortgage security', estate: 'Estate and inheritance', division: 'Partition of co-ownership', tax: 'Taxation', betterment: 'Betterment levy', compensation: 'Compensation and expropriation', court: 'Legal proceedings', other: 'Other' },
  types: { apartment: 'Apartment', garden: 'Garden apartment', penthouse: 'Penthouse / roof apartment', house: 'Detached house', land: 'Land plot', shop: 'Shop', office: 'Office', industrial: 'Industrial / workshop', storage: 'Storage unit', other: 'Other' },
  rights: { ownership: 'Freehold', lease: 'Leasehold', leaseCapitalized: 'Capitalized leasehold', other: 'Other' },
  conditions: { new: 'New', renovated: 'Renovated', good: 'Good', fair: 'Fair', poor: 'Requires renovation' },
  factors: { time: 'Time', location: 'Location', size: 'Size', floor: 'Floor', condition: 'Condition', age: 'Age', view: 'View and exposure', parking: 'Parking and storage', rights: 'Rights', other: 'Other' },
  approaches: { sales: 'Sales comparison approach', income: 'Income capitalization approach', cost: 'Cost approach' },
};
const DEFAULT_DECLARATION_EN = 'I, the undersigned, have inspected the property and prepared this appraisal to the best of my knowledge, experience and professional judgment. I have no personal interest in the property or in the parties.';

const REPORT_CSS = `
.en { display: block; font-size: 0.78em; color: dimgray; direction: ltr; unicode-bidi: isolate; font-weight: normal; }
.en-i { font-size: 0.85em; color: dimgray; direction: ltr; unicode-bidi: isolate; font-weight: normal; }
h1 .en, h2 .en, h3 .en, .final .en { display: inline; margin-right: 12px; }
.en-block { direction: ltr; text-align: left; color: dimgray; margin-top: 6px; }
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'David', 'Times New Roman', serif; color: black; line-height: 1.55; font-size: 13.5px; }
h1 { font-size: 24px; border-bottom: 3px double black; padding-bottom: 6px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 18px 0 6px; border-bottom: 1px solid gray; padding-bottom: 2px; page-break-after: avoid; }
h3 { font-size: 14px; margin: 10px 0 4px; page-break-after: avoid; }
.sub { color: dimgray; margin-bottom: 10px; }
.draft { border: 2px dashed firebrick; color: firebrick; text-align: center; font-weight: bold; padding: 6px; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
.kv th { text-align: right; width: 34%; font-weight: normal; color: dimgray; padding: 3px 6px; border-bottom: 1px dotted silver; }
.kv td { padding: 3px 6px; border-bottom: 1px dotted silver; font-weight: bold; }
.grid th, .grid td { border: 1px solid silver; padding: 3px 5px; text-align: right; font-size: 12px; vertical-align: top; }
.grid th { background: whitesmoke; }
.grid .n { text-align: left; direction: ltr; }
.grid tr.excluded td { color: gray; text-decoration: line-through; }
.text { white-space: normal; }
.final { border: 2px solid black; padding: 10px 14px; margin: 12px 0; font-size: 16px; }
.final strong { font-size: 20px; }
.warn { color: firebrick; font-size: 12px; }
.sign { margin-top: 48px; display: flex; justify-content: space-between; }
.sign div { border-top: 1px solid black; width: 40%; text-align: center; padding-top: 4px; font-size: 12px; }
.photos { display: flex; flex-wrap: wrap; gap: 8px; }
.photos figure { margin: 0; width: 48%; page-break-inside: avoid; }
.photos img { width: 100%; max-height: 300px; object-fit: contain; border: 1px solid silver; }
.photos figcaption { font-size: 11px; color: dimgray; text-align: center; }
.foot { margin-top: 24px; border-top: 1px solid gray; padding-top: 6px; font-size: 11px; color: dimgray; text-align: center; }
`;

// settings — פרטי השמאי (name, license, office, phone, address, email, declaration); photos — [{ data, caption }] שכבר אומתו
function renderReportHtml(cs, settings = {}, today, photos = []) {
  const en = cs.reportLang === 'he-en';
  // תווית: עברית, ובדוח דו-לשוני גם אנגלית מתחת (רק תוויות קבועות — מה שהשמאי הקליד נשאר כפי שהוא)
  const L = (he) => (en && EN[he] ? `${esc(he)}<span class="en">${esc(EN[he])}</span>` : esc(he));
  const V = (map, k) => (en && EN_VALUES[map][k] ? `${esc(VALUE_MAPS[map][k])} <span class="en-i">${esc(EN_VALUES[map][k])}</span>` : esc(VALUE_MAPS[map][k]));
  const enOf = (v) => (en && v ? ` <span class="en-i">${esc(v)}</span>` : '');
  const row = (l, v) => (v === '' || v === null || v === undefined ? '' : `<tr><th>${L(l)}</th><td>${v}</td></tr>`);
  const para = (title, body) => (body ? `<h2>${L(title)}</h2><div class="text">${esc(body).replace(/\n/g, '<br>')}</div>` : '');
  const final = cs.status === 'final' && cs.frozen;
  const r = final ? cs.frozen : computeCase(cs);
  // דוח נעול — פרטי השמאי מהנעילה (תיק שננעל לפני 21.10.2026 — הפרטים הנוכחיים, אין אחרים)
  const p = cs.property, cl = cs.client, s = (final && cs.frozenSettings) || settings || {};
  const repDate = final ? cs.reportDate : today;
  const compRows = cs.comparables.map((c, i) => {
    const x = r.sales.rows[i];
    return `<tr class="${c.included ? '' : 'excluded'}"><td>${i + 1}</td><td>${esc([c.address, c.city].filter(Boolean).join(', '))}${gushText(c) ? `<br><small>${esc(gushText(c))}</small>` : ''}</td>
      <td>${day(c.date)}</td><td class="n">${money(c.priceAg)}</td><td class="n">${esc(String(c.area))}</td>
      <td>${c.rooms ?? '—'}</td><td>${c.floor ?? '—'}</td><td class="n">${money(x.perSqmAg)}</td>
      <td>${c.adjustments.map(a => `${V('factors', a.factor)} <bdi dir="ltr">${pct(a.bp)}</bdi>${a.note ? ` (${esc(a.note)})` : ''}`).join('<br>') || '—'}</td>
      <td class="n"><bdi dir="ltr">${pct(x.netBp)}</bdi></td><td class="n">${money(x.adjustedPerSqmAg)}</td><td>${esc(c.source)}</td></tr>`;
  }).join('');
  const sales = r.sales;
  const salesHtml = sales.ok ? `
    <table class="kv">
      ${row('מספר עסקאות בחישוב', String(sales.stats.count))}
      ${row('טווח מחירים מותאמים למ"ר', `${money(sales.stats.minAg)} – ${money(sales.stats.maxAg)}`)}
      ${row('חציון', money(sales.stats.medianAg))}
      ${row(sales.stats.weighted ? 'ממוצע משוקלל למ"ר' : 'ממוצע למ"ר', money(sales.perSqmAg))}
      ${row('שטח לחישוב', area(sales.area))}
      ${row('שווי לפי גישת ההשוואה', money(sales.valueAg))}
    </table>` : `<p>${L('לא חושבה.')}</p>`;
  const inc = r.income, cost = r.cost;
  const fin = r.final;
  const approachRows = Object.keys(APPROACHES).filter(k => r[k].ok)
    .map(k => `<tr><td>${V('approaches', k)}</td><td class="n">${money(r[k].valueAg)}</td><td class="n">${Math.round(fin.weights[k] * 100) / 100}%</td></tr>`).join('');
  const sens = r.sensitivity || sensitivity(cs, r);
  const sensHtml = sens.income || sens.sales ? `<h2>${L('ניתוח רגישות')}</h2>
  ${sens.income ? `<h3>${L('שווי לפי גישת ההכנסות בשיעורי היוון שונים')}</h3><table class="grid"><thead><tr><th>${L('שיעור היוון')}</th><th>${L('שווי')}</th></tr></thead><tbody>${sens.income.map(x => `<tr><td><bdi dir="ltr">${pct(x.capRateBp).replace('+', '')}</bdi>${x.base ? ` (${L('השיעור שנבחר')})` : ''}</td><td class="n">${money(x.valueAg)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${sens.sales ? `<h3>${L('טווח לפי עסקאות ההשוואה')}</h3><table class="kv">${row('נמוך', money(sens.sales.lowAg))}${row('חציון', money(sens.sales.medianAg))}${row('גבוה', money(sens.sales.highAg))}</table>` : ''}
  <p class="text">${L('הטבלה לבחינה בלבד ואינה חלק מקביעת השווי.')}</p>` : '';
  const body = `
  <h1>${L('שומת מקרקעין')}</h1>
  <div class="sub">${esc([p.address, p.city].filter(Boolean).join(', '))}${gushText(p) ? ' · ' + esc(gushText(p)) : ''}</div>
  ${final ? '' : `<div class="draft">${L('טיוטה — לא לשימוש')}</div>`}
  <table class="kv">
    ${row('מספר דוח', esc(reportNo(cs)))}
    ${row('תאריך הדוח', day(repDate))}
    ${row('המועד הקובע', day(cs.effectiveDate))}
    ${row('תאריך הביקור בנכס', day(cs.visitDate))}
    ${cs.rev ? row('גרסה מתוקנת של דוח', esc(String(cs.no) + (cs.rev > 1 ? '-' + (cs.rev - 1) : ''))) : ''}
  </table>

  <h2>${L('המזמין ומטרת השומה')}</h2>
  <table class="kv">
    ${row('המזמין', esc(cl.name))}
    ${row('מספר זהות', esc(cl.idNumber))}
    ${row('טלפון', esc(cl.phone))}
    ${row('מטרת השומה', V('purposes', cs.purpose) + (cs.purpose === 'other' && cs.purposeOther ? ' — ' + esc(cs.purposeOther) : ''))}
  </table>

  <h2>${L('השמאי')}</h2>
  <table class="kv">
    ${row('שם', s.name ? esc(s.name) + enOf(s.nameEn) : '')}${row('מספר רישיון', esc(s.license))}${row('משרד', s.office ? esc(s.office) + enOf(s.officeEn) : '')}
    ${row('טלפון', esc(s.phone))}${row('כתובת', s.address ? esc(s.address) + enOf(s.addressEn) : '')}${row('דוא"ל', esc(s.email))}
  </table>

  <h2>${L('זיהוי הנכס')}</h2>
  <table class="kv">
    ${row('כתובת', esc([p.address, p.city].filter(Boolean).join(', ')))}
    ${row('גוש / חלקה / תת-חלקה', esc(gushText(p)))}
    ${row('סוג הנכס', V('types', p.type))}
    ${row('הזכויות בנכס', V('rights', p.rights))}
    ${row('שטח', area(p.area))}${p.equivArea ? row('שטח אקוויוולנטי', area(p.equivArea)) : ''}${p.landArea ? row('שטח הקרקע', area(p.landArea)) : ''}
    ${row('חדרים', p.rooms === null ? '' : esc(String(p.rooms)))}
    ${row('קומה', p.floor === null ? '' : esc(String(p.floor)) + (p.floors ? ` ${L('מתוך')} ${esc(String(p.floors))}` : ''))}
    ${row('שנת בנייה', p.yearBuilt ? esc(String(p.yearBuilt)) : '')}
    ${row('מצב', V('conditions', p.condition))}
    ${row('חניה', esc(p.parking))}${row('מחסן', esc(p.storage))}
  </table>
  ${para('תיאור הנכס', p.description)}
  ${para('הסביבה', p.environment)}
  ${para('המצב התכנוני', p.planning)}
  ${para('המצב המשפטי', p.legal)}
  ${para('גורמים ושיקולים', p.considerations)}

  <h2>${L('עסקאות השוואה')}</h2>
  ${cs.comparables.length ? `<table class="grid"><thead><tr><th>#</th>${['כתובת', 'תאריך', 'מחיר', 'שטח', 'חדרים', 'קומה', '₪ למ"ר', 'התאמות', 'נטו', '₪ למ"ר מותאם', 'מקור'].map(h => `<th>${L(h)}</th>`).join('')}</tr></thead><tbody>${compRows}</tbody></table>` : `<p>${L('לא הוזנו עסקאות.')}</p>`}

  <h2>${V('approaches', 'sales')}</h2>
  ${salesHtml}
  ${inc.ok ? `<h2>${V('approaches', 'income')}</h2><table class="kv">
    ${row('הכנסה שנתית ברוטו', money(inc.grossAg))}${row('אחרי אי-תפוסה', money(inc.effectiveAg))}
    ${row('הוצאות שנתיות', money(cs.income.annualExpensesAg))}${row('הכנסה נקייה (NOI)', money(inc.noiAg))}
    ${row('שיעור היוון', pct(cs.income.capRateBp).replace('+', ''))}${row('שווי לפי גישת ההכנסות', money(inc.valueAg))}</table>
    ${cs.income.note ? `<div class="text">${esc(cs.income.note)}</div>` : ''}` : ''}
  ${cost.ok ? `<h2>${V('approaches', 'cost')}</h2><table class="kv">
    ${row('שווי הקרקע', money(cost.landAg))}${row('שטח בנוי', area(cost.area))}${row('עלות הקמה למ"ר', money(cs.cost.costPerSqmAg))}
    ${row('עלות הקמה', money(cost.buildAg))}${row('רווח יזמי', pct(cs.cost.profitBp).replace('+', ''))}${row('פחת', pct(cs.cost.depreciationBp).replace('+', ''))}
    ${row('מבנה אחרי פחת', money(cost.depreciatedAg))}${row('שווי לפי גישת העלות', money(cost.valueAg))}</table>
    ${cs.cost.note ? `<div class="text">${esc(cs.cost.note)}</div>` : ''}` : ''}

  ${sensHtml}

  <h2>${L('שקלול ושומה סופית')}</h2>
  ${approachRows ? `<table class="grid"><thead><tr><th>${L('גישה')}</th><th>${L('שווי')}</th><th>${L('משקל')}</th></tr></thead><tbody>${approachRows}</tbody></table>` : ''}
  ${cs.reconcile.note ? `<div class="text">${esc(cs.reconcile.note)}</div>` : ''}
  ${cs.reconcile.overrideAg !== null ? `<p>${L('השווי נקבע על ידי השמאי:')} ${esc(cs.reconcile.overrideReason)}</p>` : ''}
  <div class="final">${L('שווי הנכס במועד הקובע:')} <strong>${money(fin.valueAg)}</strong>${fin.perSqmAg ? ` <small>(${money(fin.perSqmAg)} למ"ר)</small>` : ''}</div>
  ${final ? '' : r.warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}

  ${photos.length ? `<h2>${L('צילומים')}</h2><div class="photos">${photos.filter(ph => PHOTO_RE.test(ph.data)).map(ph => `<figure><img src="${ph.data}" alt="${esc(ph.caption || 'צילום')}">${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}

  ${para('הנחות ומגבלות', cs.assumptions)}
  ${para('הצהרת השמאי', s.declaration || DEFAULT_DECLARATION)}
  ${en ? `<div class="text en-block" dir="ltr">${esc(s.declarationEn || DEFAULT_DECLARATION_EN).replace(/\n/g, '<br>')}</div>` : ''}
  <div class="sign"><div>${L('חתימת השמאי')}${s.name ? ' — ' + esc(s.name) : ''}${enOf(s.nameEn)}</div><div>${L('חותמת')}</div></div>
  <div class="foot">${esc(s.office || s.name || '')} · שומה מספר ${esc(reportNo(cs))} · ${day(repDate)}</div>`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>שומה ${esc(reportNo(cs))}</title>
<style>${REPORT_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

// תמונה מהממשק: רק data:image בפורמט מוכר, בגודל מוגבל; כיתוב קצר
function validatePhoto(p = {}) {
  const data = String(p.data || '');
  if (!PHOTO_RE.test(data)) throw new Error('הקובץ אינו תמונה נתמכת (JPG, PNG או WEBP)');
  if (data.length > PHOTO_MAX_CHARS) throw new Error('התמונה גדולה מדי');
  return { data, caption: txt(p.caption, 120) };
}

function validateSettings(s = {}) {
  return {
    name: txt(s.name, 80), license: txt(s.license, 30), office: txt(s.office, 120), phone: txt(s.phone, 30),
    address: txt(s.address, 160), email: txt(s.email, 80), declaration: txt(s.declaration, 2000),
    nameEn: txt(s.nameEn, 80), officeEn: txt(s.officeEn, 120), addressEn: txt(s.addressEn, 160), declarationEn: txt(s.declarationEn, 2000),
  };
}

module.exports = {
  PURPOSES, PROPERTY_TYPES, RIGHTS, CONDITIONS, ADJ_FACTORS, APPROACHES, WARN, DEFAULT_ASSUMPTIONS, DEFAULT_DECLARATION, DEFAULT_DECLARATION_EN, EN, EN_VALUES,
  MAX_CASES, MAX_COMPS, PHOTO_MAX_CHARS, PHOTOS_PER_CASE, PHOTOS_TOTAL_CHARS, validatePhoto,
  toAg, toArea, pctToBp, validIsraeliId, validateCase, validateComparable, validateSettings,
  comparableResult, salesApproach, incomeApproach, costApproach, reconcile, computeCase, finalizeProblems, sensitivity, SENS_CAP_STEPS_BP,
  registerExport, REGISTER_HEADERS, STATUS_LABELS,
  parseComparablesCsv, MAX_CSV_ROWS, finalizeCase, reopenCase, revisionCase, MAX_FULL_REVISIONS, reportNo, renderReportHtml,
};
