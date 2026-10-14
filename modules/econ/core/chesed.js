// חסד וחלוקות: נזקקים (עם רמת חיסיון), מתנדבים (עם מחלקות), וסבבי חלוקה —
// שיוך מנות לפי משפחה או לפי גודל משפחה, שיבוץ מתנדב, ורישום מסירה.
// פונקציות טהורות, בלי גישה למסד הנתונים. ערך מנה מחושב בשלמי אגורות.
// נפרד מהעמותה (npo) ומהגמ"ח: חלוקה אינה תרומה רשומה ואינה הלוואה.

const toAg = (n) => Math.round(Number(n) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const { assertIsraeliId } = require('./israeliId');
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};

const TIERS = { regular: 'רגיל', confidential: 'חסוי' };
// 'none' ולא מחרוזת ריקה: הטופס משמיט שדות ריקים, ואז לא ניתן היה לחזור ל"ללא הפרדה" בעריכה
const DIVISIONS = { none: 'ללא הפרדה', men: 'מחלקת גברים', women: 'מחלקת נשים' };
const division = (v) => (Object.prototype.hasOwnProperty.call(DIVISIONS, v) ? v : 'none');
const ROUND_STATUSES = { open: 'פתוח', closed: 'סגור' };
const RULES = { perFamily: 'מנה אחת לכל משפחה', bySize: 'לפי גודל המשפחה' };
const MAX_BENEFICIARIES = 20000;
const MAX_VOLUNTEERS = 5000;
const MAX_ROUNDS = 2000;

function validateBeneficiary(input, prev = {}) {
  if (!input || typeof input !== 'object') throw new Error('פרטי נזקק לא תקינים');
  const familyName = str(input.familyName, 200, 'שם המשפחה');
  if (!familyName) throw new Error('שם המשפחה חובה');
  const idNumber = str(input.idNumber, 12, 'מספר הזהות');
  assertIsraeliId(idNumber, 'מספר הזהות', prev.idNumber);
  const familySize = input.familySize === '' || input.familySize == null ? 1 : Number(input.familySize);
  if (!Number.isInteger(familySize) || familySize < 1 || familySize > 30) throw new Error('גודל המשפחה חייב להיות מספר שלם בין 1 ל-30');
  return {
    familyName, idNumber, familySize,
    headName: str(input.headName, 200, 'שם ראש המשפחה'),
    phone: str(input.phone, 30, 'הטלפון'),
    address: str(input.address, 300, 'הכתובת'),
    area: str(input.area, 100, 'האזור'),
    tier: TIERS[input.tier] ? input.tier : 'regular',
    active: input.active === undefined ? true : input.active === true || input.active === 'true' || input.active === 'yes',
    notes: str(input.notes, 1000, 'ההערות')
  };
}

function validateVolunteer(input) {
  if (!input || typeof input !== 'object') throw new Error('פרטי מתנדב לא תקינים');
  const name = str(input.name, 200, 'שם המתנדב');
  if (!name) throw new Error('שם המתנדב חובה');
  return {
    name,
    phone: str(input.phone, 30, 'הטלפון'),
    division: division(input.division),
    area: str(input.area, 100, 'האזור'),
    availability: str(input.availability, 200, 'הזמינות'),
    active: input.active === undefined ? true : input.active === true || input.active === 'true' || input.active === 'yes',
    notes: str(input.notes, 500, 'ההערות')
  };
}

function validateRound(input) {
  if (!input || typeof input !== 'object') throw new Error('סבב חלוקה לא תקין');
  const name = str(input.name, 200, 'שם הסבב');
  if (!name) throw new Error('שם הסבב חובה (למשל: קמחא דפסחא)');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error('תאריך החלוקה אינו תקין (YYYY-MM-DD)');
  const unitValue = input.unitValue === '' || input.unitValue == null ? 0 : Number(input.unitValue);
  if (!Number.isFinite(unitValue) || unitValue < 0 || unitValue > 1e6) throw new Error('ערך המנה אינו תקין');
  const rule = RULES[input.rule] ? input.rule : 'perFamily';
  const personsPerUnit = input.personsPerUnit === '' || input.personsPerUnit == null ? 4 : Number(input.personsPerUnit);
  if (!Number.isInteger(personsPerUnit) || personsPerUnit < 1 || personsPerUnit > 30) throw new Error('מספר נפשות למנה חייב להיות שלם בין 1 ל-30');
  return {
    name, date, rule, personsPerUnit,
    item: str(input.item, 200, 'תיאור המנה'),
    unitValue: fromAg(toAg(unitValue)),
    division: division(input.division),
    notes: str(input.notes, 1000, 'ההערות')
  };
}

// מספר מנות למשפחה לפי כלל הסבב. לפי גודל: מנה לכל X נפשות, מעוגל כלפי מעלה, לפחות אחת
function unitsFor(beneficiary, round) {
  if (round.rule === 'bySize') return Math.max(1, Math.ceil(beneficiary.familySize / round.personsPerUnit));
  return 1;
}

// שיוך כל הנזקקים הפעילים שעדיין לא שויכו לסבב. נזקק שכבר שויך — לא משתנה (גם אם גודל המשפחה עודכן)
function allocate(round, beneficiaries) {
  if (round.status === 'closed') throw new Error('הסבב סגור — לא ניתן לשייך נזקקים');
  const existing = new Set((round.allocations || []).map(a => a.beneficiaryId));
  const added = beneficiaries
    .filter(b => b.active !== false && !existing.has(b.id))
    .map(b => ({ beneficiaryId: b.id, units: unitsFor(b, round), volunteerId: '', delivered: false, deliveredAt: '' }));
  return { round: { ...round, allocations: [...(round.allocations || []), ...added] }, added: added.length };
}

// שיבוץ מתנדב: אם לסבב יש מחלקה — רק מתנדב מאותה מחלקה. מחרוזת ריקה מבטלת שיבוץ
function assignVolunteer(round, beneficiaryId, volunteer) {
  if (round.status === 'closed') throw new Error('הסבב סגור — לא ניתן לשבץ');
  const i = (round.allocations || []).findIndex(a => a.beneficiaryId === beneficiaryId);
  if (i < 0) throw new Error('הנזקק אינו משויך לסבב זה');
  if (volunteer) {
    if (volunteer.active === false) throw new Error('המתנדב אינו פעיל');
    if (division(round.division) !== 'none' && division(volunteer.division) !== round.division) {
      throw new Error(`הסבב מיועד ל${DIVISIONS[round.division]} — המתנדב שנבחר אינו משויך אליה`);
    }
  }
  const allocations = round.allocations.map((a, j) => j === i ? { ...a, volunteerId: volunteer ? volunteer.id : '' } : a);
  return { ...round, allocations };
}

function markDelivered(round, beneficiaryId, delivered, date) {
  if (round.status === 'closed') throw new Error('הסבב סגור — לא ניתן לעדכן מסירה');
  const i = (round.allocations || []).findIndex(a => a.beneficiaryId === beneficiaryId);
  if (i < 0) throw new Error('הנזקק אינו משויך לסבב זה');
  const when = delivered ? (date && isDate(date) ? date : new Date().toISOString().slice(0, 10)) : '';
  const allocations = round.allocations.map((a, j) => j === i ? { ...a, delivered: !!delivered, deliveredAt: when } : a);
  return { ...round, allocations };
}

function roundSummary(round) {
  const allocs = round.allocations || [];
  const units = allocs.reduce((t, a) => t + a.units, 0);
  const deliveredUnits = allocs.filter(a => a.delivered).reduce((t, a) => t + a.units, 0);
  return {
    families: allocs.length,
    delivered: allocs.filter(a => a.delivered).length,
    unassigned: allocs.filter(a => !a.volunteerId).length,
    units, deliveredUnits,
    totalValue: fromAg(units * toAg(round.unitValue)),
    deliveredValue: fromAg(deliveredUnits * toAg(round.unitValue))
  };
}

// הסתרת פרטים מזהים של נזקק חסוי (מתן בסתר) למי שאינו מורשה. המזהה נשאר — לשיבוץ ולמסירה
function maskBeneficiary(b, canSeeConfidential) {
  if (canSeeConfidential || b.tier !== 'confidential') return { ...b, masked: false };
  return {
    id: b.id, tier: b.tier, active: b.active, familySize: b.familySize, area: b.area,
    familyName: 'משפחה חסויה', headName: '', idNumber: '', phone: '', address: '', notes: '', masked: true
  };
}

// טבלאות ייצוא. רשימת החלוקה ממוינת לפי מתנדב ואזור — כך שכל מתנדב מקבל רשימה רציפה
function exportTable(kind, data, canSeeConfidential, roundId) {
  const bens = data.beneficiaries.map(b => maskBeneficiary(b, canSeeConfidential));
  const benById = Object.fromEntries(bens.map(b => [b.id, b]));
  const volById = Object.fromEntries(data.volunteers.map(v => [v.id, v]));
  if (kind === 'beneficiaries') {
    const rows = bens.map(b => [b.familyName, b.headName, b.idNumber, b.familySize, b.phone, b.address, b.area, TIERS[b.tier], b.active ? 'פעיל' : 'לא פעיל']);
    return { name: 'נזקקים', headers: ['משפחה', 'ראש המשפחה', 'ת.ז', 'נפשות', 'טלפון', 'כתובת', 'אזור', 'רמת חיסיון', 'סטטוס'], rows };
  }
  if (kind === 'volunteers') {
    const rows = data.volunteers.map(v => [v.name, v.phone, DIVISIONS[v.division], v.area, v.availability, v.active ? 'פעיל' : 'לא פעיל']);
    return { name: 'מתנדבים', headers: ['שם', 'טלפון', 'מחלקה', 'אזור', 'זמינות', 'סטטוס'], rows };
  }
  if (kind === 'round') {
    const round = data.rounds.find(r => r.id === roundId);
    if (!round) throw new Error('סבב החלוקה לא נמצא');
    const rows = (round.allocations || [])
      .map(a => ({ a, b: benById[a.beneficiaryId] || { familyName: '(נמחק)', area: '', address: '', phone: '' }, v: volById[a.volunteerId] }))
      .sort((x, y) => (x.v ? x.v.name : '￿').localeCompare(y.v ? y.v.name : '￿', 'he') || String(x.b.area).localeCompare(String(y.b.area), 'he'))
      .map(({ a, b, v }) => [v ? v.name : 'לא שובץ', b.area, b.familyName, b.address, b.phone, a.units, a.delivered ? 'נמסר' : '', a.deliveredAt]);
    return { name: `חלוקה-${round.name}`, headers: ['מתנדב', 'אזור', 'משפחה', 'כתובת', 'טלפון', 'מנות', 'נמסר', 'תאריך מסירה'], rows };
  }
  throw new Error('סוג ייצוא לא נתמך');
}

module.exports = {
  TIERS, DIVISIONS, ROUND_STATUSES, RULES, MAX_BENEFICIARIES, MAX_VOLUNTEERS, MAX_ROUNDS,
  validateBeneficiary, validateVolunteer, validateRound, unitsFor, allocate, assignVolunteer,
  markDelivered, roundSummary, maskBeneficiary, exportTable
};
