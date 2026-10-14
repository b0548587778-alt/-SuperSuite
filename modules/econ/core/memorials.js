// הנצחות ויארצייטים: רישום נפטרים לפי תאריך עברי, ומציאת התאריך האזרחי הקרוב של יום הזיכרון.
// ההמרה נעשית דרך core/hebcal (Intl, לוח עברי). אין כאן פסיקה: נפטר באדר של שנה פשוטה — הבחירה
// באיזה אדר מציינים בשנה מעוברת נשמרת ברשומה; יום ל׳ שאינו קיים בשנה מסוימת — מוצגים שני התאריכים
// האפשריים ומסומן "לבירור".
const H = require('./hebcal');
const { assertIsraeliId } = require('./israeliId');

const DAY = 86400000;
const MAX_MEMORIALS = 20000;
const MONTHS = [
  ['Tishri', 'תשרי'], ['Heshvan', 'חשוון'], ['Kislev', 'כסלו'], ['Tevet', 'טבת'], ['Shevat', 'שבט'],
  ['Adar', 'אדר (שנה פשוטה)'], ['Adar I', 'אדר א׳'], ['Adar II', 'אדר ב׳'],
  ['Nisan', 'ניסן'], ['Iyar', 'אייר'], ['Sivan', 'סיוון'], ['Tamuz', 'תמוז'], ['Av', 'אב'], ['Elul', 'אלול']
];
const MONTH_NAMES = Object.fromEntries(MONTHS);
const ADAR_RULES = { adar1: 'באדר א׳', adar2: 'באדר ב׳', both: 'בשניהם' };

const isLeap = (y) => ((7 * y + 1) % 19) < 7;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};

// תאריך פטירה אזרחי → עברי. אחרי השקיעה היום העברי כבר התחלף
function hebrewOfDeath(date, afterSunset) {
  if (!H.available()) throw new Error('הלוח העברי אינו זמין במחשב זה');
  if (!isDate(date)) throw new Error('תאריך הפטירה אינו תקין');
  const h = H.hebrewDate(H.civil(date) + (afterSunset ? DAY : 0));
  return { day: h.day, month: h.month, year: h.year };
}

function validateMemorial(input, { count = 0 } = {}) {
  if (!input || typeof input !== 'object') throw new Error('רשומת הנצחה לא תקינה');
  if (count >= MAX_MEMORIALS) throw new Error('הגעת למספר המקסימלי של רשומות הנצחה');
  const name = str(input.name, 200, 'שם הנפטר');
  if (!name) throw new Error('שם הנפטר חובה');
  let { hebrewDay: day, hebrewMonth: month, hebrewYear: year } = input;
  const deathDate = str(input.deathDate, 10, 'תאריך הפטירה');
  const afterSunset = input.afterSunset === true || input.afterSunset === '1' || input.afterSunset === 'true';
  if (deathDate) ({ day, month, year } = hebrewOfDeath(deathDate, afterSunset));
  day = Number(day);
  year = year === '' || year === undefined || year === null ? null : Number(year);
  if (!MONTH_NAMES[month]) throw new Error('יש לבחור חודש עברי');
  if (!Number.isInteger(day) || day < 1 || day > 30) throw new Error('יום בחודש העברי חייב להיות בין 1 ל-30');
  if (['Tevet', 'Iyar', 'Tamuz', 'Elul', 'Adar', 'Adar II'].includes(month) && day === 30) throw new Error(`בחודש ${MONTH_NAMES[month]} אין יום ל׳`);
  if (year !== null) {
    if (!Number.isInteger(year) || year < 5000 || year > 6000) throw new Error('שנה עברית לא תקינה (למשל 5786)');
    if ((month === 'Adar I' || month === 'Adar II') && !isLeap(year)) throw new Error('בשנה זו אין אדר א׳/ב׳ — יש לבחור "אדר"');
    if (month === 'Adar' && isLeap(year)) throw new Error('שנה זו מעוברת — יש לבחור אדר א׳ או אדר ב׳');
  }
  const adarRule = month === 'Adar' ? input.adarRule : '';
  if (month === 'Adar' && !ADAR_RULES[adarRule]) throw new Error('נפטר באדר של שנה פשוטה — יש לבחור באיזה אדר מציינים בשנה מעוברת (לפי המנהג)');
  const contactId = str(input.contactId, 12, 'מספר הזהות');
  assertIsraeliId(contactId, 'ת.ז של איש הקשר');
  return {
    name, parentName: str(input.parentName, 200, 'שם האב / האם'),
    hebrewDay: day, hebrewMonth: month, hebrewYear: year, adarRule,
    deathDate, afterSunset: deathDate ? afterSunset : false,
    contactName: str(input.contactName, 200, 'שם איש הקשר'), contactId,
    contactPhone: str(input.contactPhone, 30, 'טלפון'),
    plaque: str(input.plaque, 200, 'מיקום הלוח / הנר'),
    notes: str(input.notes, 500, 'הערות')
  };
}

// לוח עברי לטווח ימים, פעם אחת לכל הרשומות. לכל יום: התאריך העברי והאם זה היום האחרון בחודש
function calendar(fromIso, days) {
  const start = H.civil(fromIso);
  const out = [];
  let prev = null;
  for (let i = 0; i <= days + 1; i++) {
    const t = start + i * DAY;
    const h = H.hebrewDate(t);
    const cur = { t, date: iso(t), day: h.day, month: h.month, year: h.year, weekday: h.weekday, text: h.text, last: false };
    if (prev && prev.month !== cur.month) prev.last = true;
    out.push(cur);
    prev = cur;
  }
  out.pop(); // היום הנוסף שימש רק לזיהוי סוף החודש
  return out;
}

// באיזה חודש חל היארצייט בשנה עברית נתונה
function targetMonths(m, year) {
  const leap = isLeap(year);
  if (m.hebrewMonth === 'Adar') return !leap ? ['Adar'] : m.adarRule === 'adar1' ? ['Adar I'] : m.adarRule === 'adar2' ? ['Adar II'] : ['Adar I', 'Adar II'];
  if (m.hebrewMonth === 'Adar I' || m.hebrewMonth === 'Adar II') return leap ? [m.hebrewMonth] : ['Adar'];
  return [m.hebrewMonth];
}

// מופעים בטווח: יום תואם, או — כשאין יום ל׳ בחודש השנה — סוף החודש ותחילת הבא, שניהם מסומנים "לבירור"
function occurrences(m, cal) {
  const out = [];
  cal.forEach((c, i) => {
    if (!targetMonths(m, c.year).includes(c.month)) return;
    if (c.day === m.hebrewDay) out.push({ ...c, uncertain: false });
    else if (m.hebrewDay === 30 && c.day === 29 && c.last) {
      out.push({ ...c, uncertain: true });
      const next = cal[i + 1];
      if (next) out.push({ ...next, uncertain: true });
    }
  });
  return out;
}

// יארצייטים קרובים: מהיום ועד days ימים קדימה, ממוינים לפי תאריך
function upcoming(memorials, todayIso, days = 30) {
  if (!H.available()) return { available: false, rows: [] };
  const d = Math.max(1, Math.min(400, Number(days) || 30));
  const cal = calendar(todayIso, d);
  const today = H.civil(todayIso);
  const rows = [];
  for (const m of memorials || []) {
    for (const o of occurrences(m, cal)) {
      rows.push({
        id: m.id, name: m.name, parentName: m.parentName || '', contactName: m.contactName || '', contactPhone: m.contactPhone || '',
        plaque: m.plaque || '', date: o.date, weekday: o.weekday, hebrew: o.text, uncertain: o.uncertain,
        daysLeft: Math.round((o.t - today) / DAY),
        years: m.hebrewYear ? o.year - m.hebrewYear : null
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'he'));
  return { available: true, rows };
}

function hebrewLabel(m) {
  return `${H.gematria(m.hebrewDay)} ${MONTH_NAMES[m.hebrewMonth] === 'אדר (שנה פשוטה)' ? 'אדר' : MONTH_NAMES[m.hebrewMonth]}${m.hebrewYear ? ' ' + H.gematria(m.hebrewYear) : ''}`;
}

function exportRows(memorials, upcomingRows) {
  const next = new Map();
  for (const r of upcomingRows || []) if (!next.has(r.id)) next.set(r.id, r);
  return {
    name: 'הנצחות',
    headers: ['שם הנפטר', 'בן/בת', 'תאריך פטירה עברי', 'יארצייט קרוב', 'איש קשר', 'טלפון', 'מיקום', 'הערות'],
    rows: [...memorials].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(m => {
      const n = next.get(m.id);
      return [m.name, m.parentName || '', hebrewLabel(m), n ? `${n.date}${n.uncertain ? ' (לבירור)' : ''}` : '', m.contactName || '', m.contactPhone || '', m.plaque || '', m.notes || ''];
    })
  };
}

module.exports = { MONTHS, MONTH_NAMES, ADAR_RULES, MAX_MEMORIALS, isLeap, hebrewOfDeath, validateMemorial, calendar, occurrences, upcoming, hebrewLabel, exportRows };
