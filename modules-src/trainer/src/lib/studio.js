// ניהול סטודיו (PLAN.md 9.11) — פונקציות טהורות, בלי DOM ובלי אחסון. נבדק ב-tests/trainer-studio.test.js.
// כסף באגורות שלמות. תאריכים כמחרוזת מקומית YYYY-MM-DD (לא toISOString — UTC מזיז את היום בלילה).
// אין שום פעולה אוטומטית: תזכורות מחושבות ומוצגות, והמאמן בוחר אם לשלוח.

// ─── תאריכים ───
const pad = (n) => String(n).padStart(2, '0');
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export function addDays(s, n) {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}
export const weekday = (s) => toDate(s).getDay(); // 0 = ראשון, 6 = שבת
export const isShabbat = (s) => weekday(s) === 6;
export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// ימי העבודה בשבוע של התאריך: ראשון עד שישי (בלי שבת)
export function weekDays(s) {
  const sunday = addDays(s, -weekday(s));
  return [0, 1, 2, 3, 4, 5].map((i) => addDays(sunday, i));
}

export function isTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function formatDayHe(s) {
  return toDate(s).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function formatShortHe(s) {
  return toDate(s).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
}

// ─── כסף ───
// "1,250.5" ← 125050. ריק / לא תקין / שלילי ← null
export function parseShekels(str) {
  const t = String(str ?? '').replace(/[,\s₪]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [i, f = ''] = t.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}
export function fmtAg(ag) {
  const n = Math.round(Number(ag) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const sh = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = abs % 100;
  return `${sign}₪${sh}${rest ? '.' + pad(rest) : ''}`;
}

export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ─── סוגי מנוי ───
// kind: 'punch' — כרטיסייה (sessions אימונים, בתוקף validDays ימים); 'period' — מנוי תקופתי (validDays, sessions = מגבלה או null ללא הגבלה)
export const PLAN_KINDS = [
  { id: 'punch', label: 'כרטיסייה' },
  { id: 'period', label: 'מנוי תקופתי' },
];
export const DEFAULT_PLANS = [
  { id: 'plan_punch10', name: 'כרטיסיית 10 אימונים', kind: 'punch', sessions: 10, validDays: 120, priceAg: 0, active: true },
  { id: 'plan_month', name: 'מנוי חודשי — 8 אימונים', kind: 'period', sessions: 8, validDays: 30, priceAg: 0, active: true },
];

export function validatePlan(p) {
  const name = String(p?.name || '').trim();
  if (!name) return 'יש להזין שם לסוג המנוי';
  if (!PLAN_KINDS.some((k) => k.id === p.kind)) return 'סוג מנוי לא מוכר';
  const sessions = p.sessions === null || p.sessions === '' || p.sessions === undefined ? null : Number(p.sessions);
  if (p.kind === 'punch' && !(Number.isInteger(sessions) && sessions > 0)) return 'בכרטיסייה יש להזין מספר אימונים';
  if (sessions !== null && !(Number.isInteger(sessions) && sessions > 0 && sessions <= 500)) return 'מספר האימונים אינו תקין';
  const validDays = p.validDays === null || p.validDays === '' || p.validDays === undefined ? null : Number(p.validDays);
  if (p.kind === 'period' && !(Number.isInteger(validDays) && validDays > 0)) return 'במנוי תקופתי יש להזין משך בימים';
  if (validDays !== null && !(Number.isInteger(validDays) && validDays > 0 && validDays <= 3660)) return 'התוקף אינו תקין';
  if (!Number.isInteger(p.priceAg) || p.priceAg < 0) return 'המחיר אינו תקין';
  return null;
}

// ─── מנוי של מתאמן ───
// { id, planId, name, kind, sessions|null, start, end|null, priceAg, payments:[{id,date,amountAg,method,note}], uses:[{id,date,ref,source}], cancelledAt? }
export const PAY_METHODS = [
  { id: 'cash', label: 'מזומן' },
  { id: 'transfer', label: 'העברה בנקאית' },
  { id: 'card', label: 'כרטיס אשראי (במסוף)' },
  { id: 'check', label: 'שיק' },
  { id: 'app', label: 'אפליקציית תשלום' },
];

export function newMembership(plan, start, priceAg = plan.priceAg) {
  if (!isDateStr(start)) throw new Error('תאריך ההתחלה אינו תקין');
  if (!Number.isInteger(priceAg) || priceAg < 0) throw new Error('המחיר אינו תקין');
  return {
    id: uid('mb'),
    planId: plan.id,
    name: plan.name,
    kind: plan.kind,
    sessions: plan.sessions ?? null,
    start,
    end: plan.validDays ? addDays(start, plan.validDays - 1) : null,
    priceAg,
    payments: [],
    uses: [],
  };
}

const sumAg = (list) => (list || []).reduce((s, p) => s + (p.amountAg || 0), 0);

// מצב המנוי ביום today
export function membershipStatus(m, today) {
  const used = (m.uses || []).length;
  const left = m.sessions == null ? null : Math.max(0, m.sessions - used);
  const paidAg = sumAg(m.payments);
  const dueAg = Math.max(0, (m.priceAg || 0) - paidAg);
  const daysLeft = m.end ? daysBetween(today, m.end) : null;
  let state = 'active';
  if (m.cancelledAt) state = 'cancelled';
  else if (today < m.start) state = 'future';
  else if (left === 0) state = 'ended';
  else if (m.end && today > m.end) state = 'expired';
  else if ((left !== null && left <= 2) || (daysLeft !== null && daysLeft <= 7)) state = 'ending';
  return { used, left, paidAg, dueAg, daysLeft, state };
}

export const STATE_LABEL = {
  active: { label: 'פעיל', tone: 'emerald' },
  ending: { label: 'עומד להסתיים', tone: 'amber' },
  ended: { label: 'נוצל', tone: 'slate' },
  expired: { label: 'פג תוקף', tone: 'red' },
  future: { label: 'מתחיל בהמשך', tone: 'indigo' },
  cancelled: { label: 'בוטל', tone: 'slate' },
};

const usable = (m, today) => ['active', 'ending'].includes(membershipStatus(m, today).state);

// המנוי שממנו מנכים אימון: מבין הפעילים — זה שתוקפו מסתיים ראשון (בלי תוקף — אחרון),
// כדי שמנוי שעומד לפוג לא יפוג עם אימונים ששולמו; בתוקף זהה — הוותיק
const byEndThenStart = (a, b) => {
  if (a.end !== b.end) return !a.end ? 1 : !b.end ? -1 : a.end < b.end ? -1 : 1;
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
};
export function activeMembership(list, today) {
  return [...(list || [])].filter((m) => usable(m, today)).sort(byEndThenStart)[0] || null;
}

// ניצול אימון. ref — מזהה הפגישה ביומן (או null לניצול ידני); אותו ref לא נוצל פעמיים
export function recordUse(list, { date, ref = null, source = 'manual' }, today = date) {
  if (!isDateStr(date)) throw new Error('התאריך אינו תקין');
  if (ref && (list || []).some((m) => (m.uses || []).some((u) => u.ref === ref))) return { list, membership: null, already: true };
  const m = activeMembership(list, today);
  if (!m) return { list, membership: null, already: false };
  const next = { ...m, uses: [...(m.uses || []), { id: uid('u'), date, ref, source }] };
  return { list: list.map((x) => (x.id === m.id ? next : x)), membership: next, already: false };
}

export function removeUseByRef(list, ref) {
  return (list || []).map((m) => (m.uses || []).some((u) => u.ref === ref) ? { ...m, uses: m.uses.filter((u) => u.ref !== ref) } : m);
}
export function removeUse(list, membershipId, useId) {
  return (list || []).map((m) => (m.id === membershipId ? { ...m, uses: (m.uses || []).filter((u) => u.id !== useId) } : m));
}

export function addPayment(list, membershipId, { date, amountAg, method, note = '' }, today) {
  const m = (list || []).find((x) => x.id === membershipId);
  if (!m) throw new Error('המנוי לא נמצא');
  if (!isDateStr(date)) throw new Error('התאריך אינו תקין');
  if (!Number.isInteger(amountAg) || amountAg <= 0) throw new Error('יש להזין סכום חיובי');
  if (!PAY_METHODS.some((p) => p.id === method)) throw new Error('יש לבחור אמצעי תשלום');
  const { dueAg } = membershipStatus(m, today || date);
  if (amountAg > dueAg) throw new Error(`הסכום גבוה מהיתרה לתשלום (${fmtAg(dueAg)})`);
  const pay = { id: uid('p'), date, amountAg, method, note: String(note).slice(0, 200) };
  return list.map((x) => (x.id === membershipId ? { ...x, payments: [...(x.payments || []), pay] } : x));
}
export function removePayment(list, membershipId, paymentId) {
  return (list || []).map((m) => (m.id === membershipId ? { ...m, payments: (m.payments || []).filter((p) => p.id !== paymentId) } : m));
}

// ─── יומן ───
// פגישה: { id, date, time, minutes, kind:'personal'|'group', title, capacity, participants:[{clientId,status}], seriesId? }
// status: booked / attended / noshow / cancelled
export const ATTENDANCE = {
  booked: { label: 'רשום', tone: 'slate' },
  attended: { label: 'הגיע', tone: 'emerald' },
  noshow: { label: 'לא הגיע', tone: 'red' },
  cancelled: { label: 'ביטל', tone: 'amber' },
};

export function validateAppointment(a) {
  if (!isDateStr(a.date)) return 'יש לבחור תאריך';
  if (isShabbat(a.date)) return 'לא קובעים אימונים בשבת';
  if (!isTime(a.time)) return 'יש להזין שעה (למשל 18:30)';
  if (!(Number.isInteger(a.minutes) && a.minutes >= 10 && a.minutes <= 600)) return 'משך האימון אינו תקין';
  if (!['personal', 'group'].includes(a.kind)) return 'סוג האימון אינו תקין';
  const cap = a.kind === 'personal' ? 1 : a.capacity;
  if (!(Number.isInteger(cap) && cap >= 1 && cap <= 200)) return 'מספר המקומות אינו תקין';
  if ((a.participants || []).length > cap) return `יש יותר משתתפים (${a.participants.length}) ממספר המקומות (${cap})`;
  if (a.kind === 'group' && !String(a.title || '').trim()) return 'יש להזין שם לשיעור';
  return null;
}

// יצירת פגישה, או סדרה שבועית (weeks > 1) באותו יום ושעה
export function makeAppointments({ date, time, minutes, kind, title = '', capacity = 1, clientIds = [], weeks = 1 }) {
  const seriesId = weeks > 1 ? uid('ser') : null;
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const a = {
      id: uid('ap'),
      date: addDays(date, 7 * w),
      time,
      minutes: Number(minutes),
      kind,
      title: String(title).trim().slice(0, 80),
      capacity: kind === 'personal' ? 1 : Number(capacity),
      participants: [...new Set(clientIds)].map((clientId) => ({ clientId, status: 'booked' })),
      ...(seriesId ? { seriesId } : {}),
    };
    const err = validateAppointment(a);
    if (err) throw new Error(err);
    out.push(a);
  }
  return out;
}

export function appointmentsOn(schedule, date) {
  return (schedule || []).filter((a) => a.date === date).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// פגישות שחופפות בזמן (אותו יום)
export function overlaps(schedule, a) {
  const s = minutesOf(a.time);
  const e = s + a.minutes;
  return (schedule || []).filter((b) => b.id !== a.id && b.date === a.date && minutesOf(b.time) < e && s < minutesOf(b.time) + b.minutes);
}

export function setAttendance(schedule, apptId, clientId, status) {
  if (!ATTENDANCE[status]) throw new Error('סטטוס לא מוכר');
  return (schedule || []).map((a) => a.id !== apptId ? a : {
    ...a, participants: a.participants.map((p) => (p.clientId === clientId ? { ...p, status } : p)),
  });
}

export function addParticipant(schedule, apptId, clientId) {
  return (schedule || []).map((a) => {
    if (a.id !== apptId || a.participants.some((p) => p.clientId === clientId)) return a;
    if (a.participants.length >= a.capacity) throw new Error('השיעור מלא');
    return { ...a, participants: [...a.participants, { clientId, status: 'booked' }] };
  });
}
export function removeParticipant(schedule, apptId, clientId) {
  return (schedule || []).map((a) => (a.id !== apptId ? a : { ...a, participants: a.participants.filter((p) => p.clientId !== clientId) }));
}
export function removeClientEverywhere(schedule, clientId) {
  return (schedule || []).map((a) => ({ ...a, participants: a.participants.filter((p) => p.clientId !== clientId) }))
    .filter((a) => a.kind === 'group' || a.participants.length > 0);
}

// ref של ניצול מהיומן — פגישה + מתאמן (בשיעור קבוצתי כל משתתף מנצל בנפרד)
export const attendanceRef = (apptId, clientId) => `${apptId}:${clientId}`;

export function attendanceStats(schedule, clientId, from = '0000-00-00', to = '9999-99-99') {
  const r = { attended: 0, noshow: 0, cancelled: 0, booked: 0 };
  for (const a of schedule || []) {
    if (a.date < from || a.date > to) continue;
    const p = a.participants.find((x) => x.clientId === clientId);
    if (p) r[p.status]++;
  }
  const decided = r.attended + r.noshow;
  return { ...r, rate: decided ? Math.round((r.attended / decided) * 100) : null };
}

// ─── תזכורות (מחושבות, לא נשלחות לבד) ───
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// היום שאחרי today שיש בו אימונים: מחר, ואם מחר שבת — יום ראשון ("ביום ראשון" במקום "מחר")
export function nextTrainingDay(today) {
  const tomorrow = addDays(today, 1);
  if (!isShabbat(tomorrow)) return { date: tomorrow, label: 'מחר' };
  return { date: addDays(today, 2), label: 'ביום ראשון' };
}

export function reminders({ clients, membershipsByClient, lastSessionByClient = {}, schedule, today, trainer }) {
  const out = [];
  const sign = trainer?.name ? `\n${trainer.name}` : '';
  for (const c of clients || []) {
    const list = membershipsByClient[c.id] || [];
    const current = activeMembership(list, today);
    const latest = [...list].filter((m) => !m.cancelledAt).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
    if (current) {
      const st = membershipStatus(current, today);
      if (st.state === 'ending') {
        const why = st.left !== null && st.left <= 2 ? `נותרו ${st.left} אימונים` : `בתוקף עד ${formatShortHe(current.end)}`;
        out.push({ kind: 'ending', clientId: c.id, tone: 'amber', title: `${c.name} — ${current.name} עומד להסתיים`, detail: why,
          message: `שלום ${firstName(c.name)},\nרציתי לעדכן שב${current.name} ${why}. נשמח לחדש כדי להמשיך ברצף 💪${sign}` });
      }
    } else if (latest) {
      const st = membershipStatus(latest, today);
      if (st.state === 'ended' || st.state === 'expired') {
        out.push({ kind: st.state, clientId: c.id, tone: 'red', title: `${c.name} — אין מנוי פעיל`, detail: st.state === 'ended' ? 'כל האימונים נוצלו' : `התוקף הסתיים ב-${formatShortHe(latest.end)}`,
          message: `שלום ${firstName(c.name)},\n${latest.name} הסתיים. אשמח לחדש ולהמשיך יחד באימונים.${sign}` });
      }
    }
    const due = list.filter((m) => !m.cancelledAt).reduce((s, m) => s + membershipStatus(m, today).dueAg, 0);
    if (due > 0) {
      out.push({ kind: 'debt', clientId: c.id, tone: 'red', title: `${c.name} — יתרה לתשלום`, detail: fmtAg(due), amountAg: due,
        message: `שלום ${firstName(c.name)},\nתזכורת ידידותית: נותרה יתרה של ${fmtAg(due)} לתשלום עבור האימונים. תודה רבה!${sign}` });
    }
    const last = lastSessionByClient[c.id] || null;
    const lastDays = last ? daysBetween(last, today) : null;
    if (current && (lastDays === null || lastDays >= 14)) {
      out.push({ kind: 'inactive', clientId: c.id, tone: 'amber', title: `${c.name} — לא התאמן ${lastDays === null ? 'עדיין' : lastDays + ' ימים'}`, detail: 'יש מנוי פעיל',
        message: `שלום ${firstName(c.name)},\nמתגעגעים אליך באימונים! מתי נוח לך לקבוע את האימון הבא?${sign}` });
    }
  }
  // יום האימונים הבא: מחר, וביום שישי — יום ראשון (בשבת אין אימונים)
  const { date: nextDay, label: nextLabel } = nextTrainingDay(today);
  for (const a of appointmentsOn(schedule, nextDay)) {
    for (const p of a.participants.filter((x) => x.status === 'booked')) {
      const c = (clients || []).find((x) => x.id === p.clientId);
      if (!c) continue;
      out.push({ kind: 'tomorrow', clientId: c.id, tone: 'indigo', title: `${c.name} — ${a.kind === 'group' ? a.title : 'אימון אישי'} ${nextLabel} ב-${a.time}`, detail: formatDayHe(nextDay),
        message: `שלום ${firstName(c.name)},\nתזכורת: ${a.kind === 'group' ? a.title : 'אימון'} ${nextLabel} (${formatDayHe(nextDay)}) בשעה ${a.time}. נתראה!${sign}` });
    }
  }
  const order = { ended: 0, expired: 0, debt: 1, ending: 2, tomorrow: 3, inactive: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

// התאריך האחרון שהמתאמן התאמן בו: נוכחות ביומן או אימון שנרשם בתוכנית
export function lastTrainingDate(schedule, sessions, clientId) {
  let last = null;
  for (const a of schedule || []) {
    if (a.participants.some((p) => p.clientId === clientId && p.status === 'attended') && (!last || a.date > last)) last = a.date;
  }
  for (const s of sessions || []) {
    const d = s.completedAt ? todayStr(new Date(s.completedAt)) : null;
    if (d && (!last || d > last)) last = d;
  }
  return last;
}

// לוח הבקרה: אימונים ב-7 / 30 הימים האחרונים ומי לא התאמן 7 ימים ומעלה — מנוכחות ביומן ומרישום ביצוע בתוכנית.
// נספר יום אימון אחד למתאמן ביום (נוכחות ביומן ורישום בתוכנית באותו יום = אותו אימון). תאריך עתידי לא נספר
export function trainingOverview({ clients, schedule, sessionsByClient = {}, today }) {
  let sessionsWeek = 0;
  let sessionsMonth = 0;
  const inactive = [];
  for (const c of clients || []) {
    const days = new Set();
    for (const a of schedule || []) {
      if ((a?.participants || []).some((p) => p.clientId === c.id && p.status === 'attended') && isDateStr(a.date)) days.add(a.date);
    }
    for (const s of sessionsByClient[c.id] || []) {
      const d = s?.completedAt ? todayStr(new Date(s.completedAt)) : null;
      if (d && isDateStr(d)) days.add(d);
    }
    let last = null;
    for (const d of days) {
      if (d > today) continue;
      const ago = daysBetween(d, today);
      if (ago < 7) sessionsWeek++;
      if (ago < 30) sessionsMonth++;
      if (!last || d > last) last = d;
    }
    const lastDays = last ? daysBetween(last, today) : null;
    if (lastDays === null || lastDays >= 7) inactive.push({ ...c, lastDate: last, lastDays });
  }
  return { sessionsWeek, sessionsMonth, inactive };
}

// "היום" / "אתמול" / "לפני 3 ימים" / "לפני שבוע" / "לפני 2 שבועות" / "לפני חודש"
export function relativeDaysHe(days) {
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 30) { const w = Math.floor(days / 7); return w === 1 ? 'לפני שבוע' : `לפני ${w} שבועות`; }
  const m = Math.floor(days / 30);
  return m === 1 ? 'לפני חודש' : `לפני ${m} חודשים`;
}

// ─── דוח התקדמות ───
export const MEASURE_FIELDS = [
  { k: 'weight', label: 'משקל', unit: 'ק"ג', better: 'down' },
  { k: 'bodyFat', label: 'אחוז שומן', unit: '%', better: 'down' },
  { k: 'waist', label: 'מותן', unit: 'ס"מ', better: 'down' },
  { k: 'hips', label: 'ירכיים', unit: 'ס"מ', better: 'down' },
  { k: 'chest', label: 'חזה', unit: 'ס"מ', better: null },
  { k: 'arm', label: 'זרוע', unit: 'ס"מ', better: null },
  { k: 'thigh', label: 'ירך', unit: 'ס"מ', better: null },
];

// השוואת המדידה הראשונה והאחרונה לכל שדה שיש לו לפחות ערך אחד
export function measurementSummary(measurements) {
  const sorted = [...(measurements || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  return MEASURE_FIELDS.map((f) => {
    const vals = sorted.filter((m) => typeof m[f.k] === 'number' && isFinite(m[f.k]));
    if (!vals.length) return null;
    const first = vals[0][f.k];
    const last = vals[vals.length - 1][f.k];
    const diff = Math.round((last - first) * 10) / 10;
    const good = f.better === null || diff === 0 ? null : (f.better === 'down' ? diff < 0 : diff > 0);
    return { ...f, first, last, diff, good, count: vals.length, points: vals.map((m) => ({ date: m.date, v: m[f.k] })) };
  }).filter(Boolean);
}

// נתיב SVG לגרף קו: נקודות בסדר הזמן, ציר y מתוח בין המינימום למקסימום (עם שוליים)
export function chartPoints(values, w, h, padX = 8, padY = 10) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - 2 * padX) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: Math.round((values.length > 1 ? padX + i * stepX : w / 2) * 10) / 10,
    y: Math.round((h - padY - ((v - min) / span) * (h - 2 * padY)) * 10) / 10,
  }));
}
export const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

// טקסט קצר לשליחה למתאמן (וואטסאפ / העתקה)
export function progressText({ client, trainer, summary, stats, membership, today }) {
  const lines = [`📈 דוח התקדמות — ${client.name}`, `תאריך: ${formatShortHe(today)}`, ''];
  if (stats) lines.push(`🏋 אימונים שהגעת אליהם: ${stats.attended}${stats.rate !== null ? ` (נוכחות ${stats.rate}%)` : ''}`);
  for (const s of summary) {
    if (s.count < 2) continue;
    const arrow = s.diff === 0 ? '=' : s.diff > 0 ? '▲' : '▼';
    lines.push(`${s.label}: ${s.first} ← ${s.last} ${s.unit} (${arrow} ${Math.abs(s.diff)})`);
  }
  if (membership) {
    const st = membershipStatus(membership, today);
    lines.push('', `🎟 ${membership.name}: ${st.left === null ? 'ללא הגבלת אימונים' : `נותרו ${st.left} אימונים`}${membership.end ? `, בתוקף עד ${formatShortHe(membership.end)}` : ''}`);
  }
  lines.push('', 'כל הכבוד על ההתמדה! 💪');
  if (trainer?.name) lines.push(trainer.name);
  return lines.join('\n');
}
