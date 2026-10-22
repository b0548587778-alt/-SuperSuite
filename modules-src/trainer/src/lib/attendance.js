// ניתוח נוכחות ונטישה, הודעות מוכנות ללקוח והתאמת תוכנית לפרופיל המתאמן (מוקד 3 בתוכנית: trainer).
// טהור: בלי React, בלי DOM ובלי אחסון — נבדק ב-tests/trainer-attendance.test.js.
// אין שום שליחה אוטומטית: ההודעות מחושבות ומוצגות, והמאמן בוחר אם לשלוח.
import { daysBetween, isDateStr, relativeDaysHe } from './studio.js';
import { filterExercises, getMedicalWarnings } from './program.js';

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// ספים של הדוח — של התוכנה, לא של תקן
export const ATTENDANCE_LIMITS = {
  noshowStreak: 3, // שלוש היעדרויות רצופות
  noshowWeeks: 3, // על פני שלושה שבועות ומעלה
  droppedDays: 21, // לא התאמן שלושה שבועות
};

// רשומות הנוכחות של מתאמן, ממוינות לפי תאריך ושעה. תאריך לא תקין או עתידי (כש-to) — מדולג
export function participationLog(schedule, clientId, { to } = {}) {
  const out = [];
  const seen = new Set();
  for (const a of schedule || []) {
    if (!isDateStr(a?.date)) continue;
    if (to && a.date > to) continue;
    const p = (a.participants || []).find((x) => x.clientId === clientId);
    if (!p) continue;
    // רשומה כפולה של אותו מועד (אותו id) — פעם אחת
    if (a.id && seen.has(a.id)) continue;
    if (a.id) seen.add(a.id);
    out.push({ id: a.id, date: a.date, time: a.time || '', status: p.status });
  }
  return out.sort((x, y) =>
    x.date === y.date ? String(x.time).localeCompare(String(y.time)) : (x.date < y.date ? -1 : 1));
}

// רצף ההיעדרויות האחרון, מהסוף אחורה עד ההגעה האחרונה.
// "ביטל" לא נחשב היעדרות ולא עוצר את הרצף; "רשום" לא עוצר — הוא עדיין לא קרה בפועל
export function noshowRun(log) {
  let count = 0;
  let first = null;
  let last = null;
  for (let i = (log || []).length - 1; i >= 0; i--) {
    const r = log[i];
    if (r.status === 'attended') break;
    if (r.status !== 'noshow') continue;
    count++;
    first = r.date;
    if (!last) last = r.date;
  }
  return { count, first, last, days: count ? daysBetween(first, last) : 0 };
}

// "מזה שלושה שבועות" / "בשבועיים האחרונים" — צורת הביטוי של המשפט
function spanHe(days) {
  if (days >= 30) return 'מזה חודש ומעלה';
  const w = Math.floor(days / 7);
  if (w >= 3) return `מזה ${w} שבועות`;
  if (w === 2) return 'בשבועיים האחרונים';
  if (w === 1) return 'בשבוע שעבר';
  return 'בימים האחרונים';
}

// תאריך של רישום "ביצוע" בתוכנית (sessions) — גבול היום המקומי, לא UTC
const localDay = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// דוח נוכחות לכל מתאמן. סופרים רק רשומות שהתקיימו (עד today): attended / noshow / cancelled / booked.
// atRisk — 3 היעדרויות רצופות על פני 3 שבועות ומעלה; dropped — לא התאמן 21 יום ומעלה (כמו trainingOverview)
export function attendanceAnalysis({ clients, schedule, sessionsByClient = {}, today }) {
  const rows = [];
  for (const c of clients || []) {
    const log = participationLog(schedule, c.id, { to: today });
    const counts = { attended: 0, noshow: 0, cancelled: 0, booked: 0 };
    for (const r of log) if (r.status in counts) counts[r.status]++;
    const decided = counts.attended + counts.noshow;
    const run = noshowRun(log);

    let last = null;
    for (const r of log) if (r.status === 'attended' && (!last || r.date > last)) last = r.date;
    for (const s of sessionsByClient[c.id] || []) {
      const day = s?.completedAt ? localDay(s.completedAt) : null;
      if (day && day <= today && (!last || day > last)) last = day;
    }
    const lastDays = last ? daysBetween(last, today) : null;

    // שבועות שהרצף מכסה, כולל שבוע ההיעדרות הראשונה: שלוש היעדרויות שבועיות (8, 15, 22) = 3 שבועות
    const runWeeks = run.count ? Math.floor(run.days / 7) + 1 : 0;
    const atRisk = run.count >= ATTENDANCE_LIMITS.noshowStreak
      && runWeeks >= ATTENDANCE_LIMITS.noshowWeeks;
    // בלי שום ביקור אי-אפשר לקבוע נטישה (מתאמן חדש); מי שיש לו נוכחות היסטורית ואין לו תאריך — נשר
    const hasHistory = log.some((r) => r.status === 'attended');
    const dropped = lastDays === null ? hasHistory : lastDays >= ATTENDANCE_LIMITS.droppedDays;

    rows.push({
      ...c, ...counts,
      rate: decided ? Math.round((counts.attended / decided) * 100) : null,
      lastDate: last, lastDays,
      noshowStreak: run.count, noshowStreakDays: run.days,
      atRisk, dropped,
      level: atRisk ? 'atRisk' : dropped ? 'dropped' : 'ok',
    });
  }
  return rows;
}

// כותרת קצרה לשורה בדוח — בשפה שהמאמן מבין מיד
export function attendanceHeadline(row) {
  if (!row) return '';
  if (row.atRisk) {
    const weeks = Math.max(3, Math.floor((row.noshowStreakDays || 0) / 7));
    return `${row.noshowStreak} היעדרויות רצופות — ${weeks} שבועות`;
  }
  if (row.dropped) {
    if (row.lastDays === null) return 'לא הגיע לאף אימון';
    const ago = relativeDaysHe(row.lastDays);
    return `לא התאמן ${ago.startsWith('לפני') ? 'מזה' + ago.slice('לפני'.length) : ago}`;
  }
  if (row.rate !== null) return `נוכחות ${row.rate}%`;
  return 'אין נתוני נוכחות';
}

// הודעה מוכנה ללקוח — אותה תבנית של reminders(): פנייה בשם הפרטי וחתימת המאמן
export function readyMessage({ row, client, trainer }) {
  const c = client || row;
  if (!c) return null;
  const sign = trainer?.name ? `\n${trainer.name}` : '';
  const name = firstName(c.name);
  if (row?.atRisk) {
    return {
      kind: 'comeback', tone: 'amber', clientId: c.id,
      title: 'חזרה לשגרה',
      message: `שלום ${name},\nשמתי לב שלא הצלחת להגיע לאימונים ${spanHe(row.noshowStreakDays)}. אשמח שנחזור לשגרה בקצב שנוח לך — מתי מתאים לך להיפגש?${sign}`,
    };
  }
  if (row?.dropped) {
    return {
      kind: 'comeback', tone: 'amber', clientId: c.id,
      title: 'חזרה לאימונים',
      message: `שלום ${name},\nכבר זמן מה לא נפגשנו לאימון. אשמח לקבוע איתך פגישה לחזרה הדרגתית, בקצב שמתאים לך. מתי נוח?${sign}`,
    };
  }
  return null;
}

// עיצוב תוכנית לפי הפרופיל: אזהרות רפואיות, גודל מאגר התרגילים המתאים, ותרגילים שנשארו
// בתוכנית קיימת למרות שינוי במצב הרפואי או בציוד. מסומנים בלבד — לא מוסרים לבד
export function profileFit(client, program) {
  if (!client) return { warnings: [], available: 0, exclusions: [], summary: '' };
  const warnings = getMedicalWarnings(client);
  const available = filterExercises(client).length;
  const exclusions = [];
  const seen = new Set();
  for (const day of program?.days || []) {
    for (const ex of day.exercises || []) {
      if (!ex?.exerciseId || seen.has(ex.exerciseId)) continue;
      const reasons = Array.isArray(ex.exclusionReasons) ? ex.exclusionReasons : [];
      if (!reasons.length) continue;
      seen.add(ex.exerciseId);
      exclusions.push({ exerciseId: ex.exerciseId, day: day.name, reasons });
    }
  }
  const lines = warnings.map((w) => `${w.condition}: ${w.warning}`);
  if (available === 0) lines.push('אין תרגילים שמתאימים לציוד ולמצב הרפואי — יש לעדכן את כרטיס המתאמן.');
  if (exclusions.length) lines.push(`${exclusions.length} תרגילים בתוכנית הנוכחית אינם מתאימים עוד — מומלץ לבנות תוכנית מחדש.`);
  return { warnings, available, exclusions, summary: lines.join('\n') };
}

// סיכום ללוח הבקרה: מי בסיכון, מי נשר, וממוצע נוכחות
export function attendanceSummary({ clients, schedule, sessionsByClient = {}, today }) {
  const rows = attendanceAnalysis({ clients, schedule, sessionsByClient, today });
  const atRisk = rows.filter((r) => r.atRisk);
  const dropped = rows.filter((r) => r.dropped && !r.atRisk);
  const withData = rows.filter((r) => r.rate !== null);
  const avgRate = withData.length
    ? Math.round(withData.reduce((s, r) => s + r.rate, 0) / withData.length)
    : null;
  return { rows, atRisk, dropped, avgRate };
}
