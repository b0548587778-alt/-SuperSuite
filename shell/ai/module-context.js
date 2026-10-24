// נתוני השמאות והאימונים לעוזר ה-AI — פונקציות טהורות מעל תמונת המחסן המוצפן של המודול (מפתח ← מחרוזת JSON).
// התהליך הראשי קורא את התמונה רק לבקשת המודול הכלכלי (main.js: trainerDataForEcon / shamaiDataForEcon), ו-ipc.js
// מעביר לכאן רק כשהתחום פתוח לרישיון ולהרשאה. בלי זה שאלות הדוגמה על השמאות והאימונים נענו תמיד „אין נתונים”.
// הנתונים הגיעו מעמוד — קלט לא מהימן: רשומה פגומה מדולגת, לא מפילה. קריאה בלבד.
// בלי מידע רפואי, מדידות, ופרטי הלקוח של השמאות (שם, ת״ז) — רק מה שהתשובה צריכה. כסף באגורות שלמות.
'use strict';

const { nis } = require('./rules');

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_AG = 100_000_000_000; // כמו clipAg ב-ipc.js
const MAX_ALERTS = 50;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const okAg = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_AG;

// תאריך מקומי YYYY-MM-DD אמיתי (2026-02-31 נדחה). בלי toISOString — UTC מזיז את היום בלילה
function isDay(v) {
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}
const dayIndex = (s) => Math.round(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000);
const daysBetween = (a, b) => dayIndex(b) - dayIndex(a);
const shortHe = (s) => `${Number(s.slice(8, 10))}.${Number(s.slice(5, 7))}.${s.slice(0, 4)}`;
function localDayOf(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parse(items, key) {
  const v = items[key];
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ---------- אימונים ----------
// מצב מנוי ביום today — כמו membershipStatus במודול (modules-src/trainer/src/lib/studio.js)
function membershipState(m, today) {
  const used = Array.isArray(m.uses) ? m.uses.length : 0;
  const sessions = Number.isSafeInteger(m.sessions) && m.sessions >= 0 ? m.sessions : null;
  const left = sessions === null ? null : Math.max(0, sessions - used);
  const paidAg = (Array.isArray(m.payments) ? m.payments : []).reduce((t, p) => t + (p && okAg(p.amountAg) ? p.amountAg : 0), 0);
  const priceAg = okAg(m.priceAg) ? m.priceAg : 0;
  const dueAg = m.cancelledAt ? 0 : Math.max(0, priceAg - paidAg);
  const start = isDay(m.start) ? m.start : '';
  const end = isDay(m.end) ? m.end : '';
  const daysLeft = end ? daysBetween(today, end) : null;
  let state = 'active';
  if (m.cancelledAt) state = 'cancelled';
  else if (start && today < start) state = 'future';
  else if (left === 0) state = 'ended';
  else if (end && today > end) state = 'expired';
  else if ((left !== null && left <= 2) || (daysLeft !== null && daysLeft <= 7)) state = 'ending';
  return { left, dueAg, start, end, state };
}

// היום האחרון שהמתאמן התאמן בו (עד היום): נוכחות ביומן, או אימון שסומן כבוצע בתוכנית
function lastTraining(schedule, sessions, clientId, today) {
  let last = null;
  for (const a of schedule) {
    if (!a || !isDay(a.date) || a.date > today || !Array.isArray(a.participants)) continue;
    if (a.participants.some(p => p && p.clientId === clientId && p.status === 'attended') && (!last || a.date > last)) last = a.date;
  }
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const d = s && s.completedAt ? localDayOf(s.completedAt) : null;
    if (d && d <= today && (!last || d > last)) last = d;
  }
  return last;
}

// מתאמנים שדורשים תשומת לב — אותם סוגים כמו התזכורות במודול: אין מנוי פעיל, יתרה לתשלום, מנוי שמסתיים,
// ומתאמן עם מנוי פעיל שלא התאמן 14 יום. מחזיר { clients, alerts: [{ title, detail, tone }] } או null
function trainerContext(items, today) {
  if (!items || typeof items !== 'object' || !isDay(today)) return null;
  const index = parse(items, 'clients:index');
  const ids = [...new Set(Array.isArray(index) ? index.filter(id => typeof id === 'string' && ID.test(id)) : [])];
  const scheduleRaw = parse(items, 'studio:schedule');
  const schedule = Array.isArray(scheduleRaw) ? scheduleRaw : [];
  const alerts = [];
  let clients = 0;
  for (const id of ids) {
    const client = parse(items, `client:${id}`);
    if (!client || typeof client !== 'object') continue;
    const name = clip(client.name, 60);
    if (!name) continue;
    clients++;
    const raw = parse(items, `memberships:${id}`);
    const list = (Array.isArray(raw) ? raw : []).filter(m => m && typeof m === 'object' && ID.test(String(m.id || '')))
      .map(m => ({ m, st: membershipState(m, today), name: clip(m.name, 60) || 'המנוי' }));
    // המנוי שבשימוש: מבין הפעילים — זה שתוקפו מסתיים ראשון (בלי תוקף — אחרון)
    const current = list.filter(x => x.st.state === 'active' || x.st.state === 'ending')
      .sort((a, b) => (a.st.end === b.st.end ? (a.st.start < b.st.start ? -1 : 1) : !a.st.end ? 1 : !b.st.end ? -1 : a.st.end < b.st.end ? -1 : 1))[0];
    if (current) {
      if (current.st.state === 'ending') {
        const why = current.st.left !== null && current.st.left <= 2 ? `נותרו ${current.st.left} אימונים` : `בתוקף עד ${shortHe(current.st.end)}`;
        alerts.push({ order: 2, title: `${name} — ${current.name} עומד להסתיים`, detail: why, tone: 'yellow' });
      }
    } else {
      const latest = list.filter(x => x.st.state !== 'cancelled').sort((a, b) => (a.st.start < b.st.start ? 1 : -1))[0];
      if (latest && (latest.st.state === 'ended' || latest.st.state === 'expired')) {
        const detail = latest.st.state === 'ended' ? 'כל האימונים נוצלו' : `התוקף הסתיים ב-${shortHe(latest.st.end)}`;
        alerts.push({ order: 0, title: `${name} — אין מנוי פעיל`, detail, tone: 'red' });
      }
    }
    const dueAg = list.reduce((t, x) => t + x.st.dueAg, 0);
    if (dueAg > 0) alerts.push({ order: 1, title: `${name} — יתרה לתשלום`, detail: nis(dueAg), tone: 'red' });
    if (current) {
      const last = lastTraining(schedule, parse(items, `sessions:${id}`), id, today);
      const days = last ? daysBetween(last, today) : null;
      if (days === null || days >= 14) {
        alerts.push({ order: 3, title: `${name} — ${days === null ? 'עדיין לא התאמן' : `לא התאמן ${days} ימים`}`, detail: 'יש מנוי פעיל', tone: 'yellow' });
      }
    }
  }
  alerts.sort((a, b) => a.order - b.order);
  return { clients, alerts: alerts.slice(0, MAX_ALERTS).map(({ order, ...a }) => a) };
}

// ---------- שמאות ----------
const SHAMAI_CASES = 'shamai_v2_cases'; // Storage.prefix + 'cases' (modules/shamai/src/core.js, casefile.js)
const BASIS_HE = { market: 'שווי שוק', replacement: 'שווי החלפה', liquidation: 'שווי מימוש', melt: 'ערך התכה' };

// הערכת השווי האחרונה = תיק השמאות האחרון שננעל (finalizeCase: frozen.totalAg בשקלים, באגורות).
// בלי שם הלקוח ובלי ת״ז — רק מספר התיק, התאריך, מספר הפריטים ובסיס השווי. אין תיק סופי — null
function shamaiContext(items) {
  if (!items || typeof items !== 'object') return null;
  const list = parse(items, SHAMAI_CASES);
  if (!Array.isArray(list)) return null;
  const when = (c) => String(c.finalizedAt || c.reportDate || '');
  const finals = list.filter(c => c && typeof c === 'object' && c.status === 'final' && c.frozen && typeof c.frozen === 'object' && okAg(c.frozen.totalAg));
  if (!finals.length) return null;
  const c = finals.reduce((a, b) => (when(b) > when(a) ? b : a));
  const rev = Number.isSafeInteger(c.rev) && c.rev > 0 ? `-${c.rev}` : '';
  const parts = [`תיק ${clip(c.no, 20)}${rev}`];
  if (isDay(c.reportDate)) parts.push(`מ-${shortHe(c.reportDate)}`);
  const count = Array.isArray(c.items) ? c.items.length : 0;
  const details = [count === 1 ? 'פריט אחד' : `${count} פריטים`];
  if (BASIS_HE[c.basis]) details.push(BASIS_HE[c.basis]);
  const warnings = [];
  if (c.currency && c.currency !== 'ILS') warnings.push('הדוח הופק במטבע זר — הסכום כאן בשקלים, לפי השער שנשמר בנעילה.');
  const finalizedAt = when(c);
  if (list.some(d => d && typeof d === 'object' && d.status === 'draft' && String(d.created || '') > finalizedAt)) {
    warnings.push('יש תיק טיוטה חדש יותר שטרם ננעל — הוא אינו כלול בתשובה.');
  }
  return { label: `${parts.join(' ')}, ${details.join(', ')}`, valueAg: c.frozen.totalAg, confidence: null, factors: [], warnings };
}

module.exports = { trainerContext, shamaiContext, membershipState, SHAMAI_CASES };
