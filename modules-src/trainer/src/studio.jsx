// ניהול סטודיו (PLAN.md 9.11): מסכי המאמן (יומן, מנויים וגבייה, תזכורות) ומסכי המתאמן
// (מנוי ותשלומים בכרטיס המתאמן, כרטיס ודוח התקדמות להדפסה ולשליחה). הלוגיקה ב-lib/studio.js.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Btn, Card, Field, Input, Textarea, Badge, Modal, Toggle, PageHeader, FONT_HEADING, FONT_BODY } from './components/ui.jsx';
import { S, K } from './lib/db.js';
import * as St from './lib/studio.js';
import { whatsappShareUrl, copyToClipboard } from './lib/sharing.js';
import { askConfirm } from './lib/dialog.js';
import { savePdf, printNow } from './lib/print.js';

// ═══════════════════════════════════════════════════════════════════
//                      נתוני הסטודיו
// ═══════════════════════════════════════════════════════════════════

export function useStudio(clients) {
  const [plans, setPlans] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [memberships, setMemberships] = useState({});
  const [lastByClient, setLastByClient] = useState({});
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const p = await S.get(K.plans);
    setPlans(Array.isArray(p) ? p : St.DEFAULT_PLANS);
    const sch = (await S.get(K.schedule)) || [];
    setSchedule(sch);
    const mm = {};
    const last = {};
    for (const c of clients) {
      mm[c.id] = (await S.get(K.memberships(c.id))) || [];
      last[c.id] = St.lastTrainingDate(sch, (await S.get(K.sessions(c.id))) || [], c.id);
    }
    setMemberships(mm);
    setLastByClient(last);
    setReady(true);
  }, [clients]);

  useEffect(() => { load(); }, [load]);

  const savePlans = async (list) => { await S.set(K.plans, list); setPlans(list); };
  const saveSchedule = async (list) => { await S.set(K.schedule, list); setSchedule(list); };
  const saveMemberships = async (clientId, list) => {
    await S.set(K.memberships(clientId), list);
    setMemberships((prev) => ({ ...prev, [clientId]: list }));
  };

  // שינוי נוכחות: "הגיע" מנכה אימון מהמנוי הפעיל (פעם אחת לכל פגישה), שינוי חזרה — מחזיר אותו
  const changeAttendance = async (appt, clientId, status) => {
    const prev = appt.participants.find((p) => p.clientId === clientId)?.status;
    await saveSchedule(St.setAttendance(schedule, appt.id, clientId, status));
    const ref = St.attendanceRef(appt.id, clientId);
    const list = memberships[clientId] || [];
    if (status === 'attended' && prev !== 'attended') {
      const r = St.recordUse(list, { date: appt.date, ref, source: 'schedule' }, appt.date);
      if (r.membership) { await saveMemberships(clientId, r.list); return { deducted: r.membership }; }
      return { deducted: null, already: r.already };
    }
    if (prev === 'attended' && status !== 'attended') await saveMemberships(clientId, St.removeUseByRef(list, ref));
    return {};
  };

  return { ready, plans: plans || [], schedule, memberships, lastByClient, savePlans, saveSchedule, saveMemberships, changeAttendance, reload: load };
}

const clientName = (clients, id) => clients.find((c) => c.id === id)?.name || 'מתאמן שנמחק';

function Notice({ notice, onClose }) {
  if (!notice) return null;
  const tones = { ok: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', warn: 'bg-amber-500/15 border-amber-500/30 text-amber-300', err: 'bg-red-500/15 border-red-500/30 text-red-300' };
  return (
    <div className={`mb-4 border rounded-xl px-4 py-3 text-sm flex justify-between items-center gap-3 ${tones[notice.tone || 'ok']}`}>
      <span>{notice.text}</span>
      <button onClick={onClose} className="text-lg leading-none opacity-70 hover:opacity-100" aria-label="סגור">×</button>
    </div>
  );
}

function Stat({ label, value, hint, tone = 'normal', onClick }) {
  const color = { normal: 'text-slate-100', amber: 'text-amber-300', red: 'text-red-300', green: 'text-emerald-300', indigo: 'text-indigo-300' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 md:p-5 ${onClick ? 'hover:border-indigo-600 transition' : ''}`}>
      <div className="text-xs text-slate-400 mb-2">{label}</div>
      <div className={`text-2xl md:text-3xl font-bold ${color}`} style={{ fontFamily: FONT_HEADING }}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </Tag>
  );
}

// טבעת התקדמות של מנוי (כמה אימונים נוצלו)
function Ring({ used, total, size = 92 }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? Math.min(1, used / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ss-border, #334155)" strokeWidth="8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ss-primary, #6366f1)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="47%" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{total ? total - used : '∞'}</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize="10" fill="currentColor" opacity=".6">{total ? 'נותרו' : 'ללא הגבלה'}</text>
    </svg>
  );
}

function Bar({ value, max }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full ${pct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function shareWhatsApp(text, phone) {
  window.open(whatsappShareUrl(text, phone), '_blank');
}

// ═══════════════════════════════════════════════════════════════════
//                      יומן אימונים (למאמן)
// ═══════════════════════════════════════════════════════════════════

export function ScheduleView({ clients, setView }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const [anchor, setAnchor] = useState(today);
  const [editing, setEditing] = useState(null); // תבנית לפגישה חדשה
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState(null);
  const days = St.weekDays(St.isShabbat(anchor) ? St.addDays(anchor, 1) : anchor);
  const open = studio.schedule.find((a) => a.id === openId) || null;

  const weekCount = studio.schedule.filter((a) => a.date >= days[0] && a.date <= days[5]).length;
  const todayList = St.appointmentsOn(studio.schedule, today);

  return (
    <div className="p-4 md:p-8 max-w-7xl">
      <PageHeader title="יומן אימונים" subtitle="אימונים אישיים ושיעורים קבוצתיים, נוכחות וניצול מנויים"
        action={<Btn onClick={() => setEditing({ date: St.isShabbat(today) ? St.addDays(today, 1) : today })}>+ אימון חדש</Btn>} />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="אימונים היום" value={todayList.length} tone="indigo" />
        <Stat label="אימונים השבוע" value={weekCount} />
        <Stat label="מתאמנים" value={clients.length} onClick={() => setView({ name: 'clients' })} />
        <Stat label="שיעורים קבוצתיים השבוע" value={studio.schedule.filter((a) => a.kind === 'group' && a.date >= days[0] && a.date <= days[5]).length} />
      </div>

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex gap-2">
          <Btn variant="outline" size="sm" onClick={() => setAnchor(St.addDays(days[0], -7))}>→ שבוע קודם</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setAnchor(today)}>היום</Btn>
          <Btn variant="outline" size="sm" onClick={() => setAnchor(St.addDays(days[0], 7))}>שבוע הבא ←</Btn>
        </div>
        <div className="text-sm text-slate-400">{St.formatShortHe(days[0])} – {St.formatShortHe(days[5])}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {days.map((d) => {
          const list = St.appointmentsOn(studio.schedule, d);
          const isToday = d === today;
          return (
            <div key={d} className={`bg-slate-900/60 border rounded-xl p-3 min-h-[160px] flex flex-col ${isToday ? 'border-indigo-500' : 'border-slate-800'}`}>
              <div className="flex justify-between items-baseline mb-3">
                <div className={`font-semibold ${isToday ? 'text-indigo-300' : ''}`} style={{ fontFamily: FONT_HEADING }}>{St.DAY_NAMES[St.weekday(d)]}</div>
                <div className="text-xs text-slate-500">{d.slice(8)}/{d.slice(5, 7)}</div>
              </div>
              <div className="space-y-2 flex-1">
                {list.length === 0 && <div className="text-xs text-slate-600">אין אימונים</div>}
                {list.map((a) => {
                  const attended = a.participants.filter((p) => p.status === 'attended').length;
                  return (
                    <button key={a.id} onClick={() => setOpenId(a.id)}
                      className={`w-full text-right rounded-lg px-3 py-2 border transition ${a.kind === 'group' ? 'bg-indigo-500/15 border-indigo-500/30' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'}`}>
                      <div className="flex justify-between text-xs text-slate-400"><span>{a.time}</span><span>{a.minutes} ד׳</span></div>
                      <div className="text-sm font-medium truncate">
                        {a.kind === 'group' ? a.title : (a.participants[0] ? clientName(clients, a.participants[0].clientId) : 'ללא מתאמן')}
                      </div>
                      <div className="text-xs text-slate-500">
                        {a.kind === 'group' ? `${a.participants.length}/${a.capacity} רשומים` : St.ATTENDANCE[a.participants[0]?.status || 'booked'].label}
                        {a.kind === 'group' && attended > 0 && ` · ${attended} הגיעו`}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setEditing({ date: d })} className="mt-2 text-xs text-slate-500 hover:text-indigo-300 transition">+ הוספה</button>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-slate-500 mt-3">אין קביעת אימונים בשבת. סימון "הגיע" מנכה אימון מהמנוי הפעיל של המתאמן.</div>

      {editing && (
        <AppointmentForm clients={clients} initial={editing} schedule={studio.schedule}
          onCancel={() => setEditing(null)}
          onSave={async (list) => {
            await studio.saveSchedule([...studio.schedule, ...list]);
            setEditing(null);
            setNotice({ tone: 'ok', text: list.length > 1 ? `נקבעו ${list.length} אימונים (סדרה שבועית)` : 'האימון נקבע' });
          }} />
      )}
      {open && (
        <AppointmentDetail appt={open} clients={clients} studio={studio} onClose={() => setOpenId(null)} onNotice={setNotice} setView={setView} />
      )}
    </div>
  );
}

function AppointmentForm({ clients, initial, schedule, onSave, onCancel }) {
  const [f, setF] = useState({ date: initial.date, time: '18:00', minutes: '60', kind: 'personal', title: '', capacity: '10', clientIds: [], weeks: '1' });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const probe = { id: '_', date: f.date, time: f.time, minutes: Number(f.minutes) || 0 };
  const clash = St.isDateStr(f.date) && St.isTime(f.time) ? St.overlaps(schedule, probe) : [];
  const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const submit = () => {
    try {
      const list = St.makeAppointments({
        date: f.date, time: f.time, minutes: Number(f.minutes), kind: f.kind, title: f.title,
        capacity: Number(f.capacity), clientIds: f.kind === 'personal' ? f.clientIds.slice(0, 1) : f.clientIds, weeks: Math.min(52, Math.max(1, Number(f.weeks) || 1)),
      });
      if (f.kind === 'personal' && !f.clientIds.length) throw new Error('יש לבחור מתאמן לאימון אישי');
      onSave(list);
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal open onClose={onCancel} title="אימון חדש" wide>
      <div className="space-y-4">
        <Field label="סוג">
          <Toggle options={[{ id: 'personal', label: 'אימון אישי' }, { id: 'group', label: 'שיעור קבוצתי' }]} value={f.kind}
            onChange={(v) => setF((x) => ({ ...x, kind: v, clientIds: v === 'personal' ? x.clientIds.slice(0, 1) : x.clientIds }))} />
        </Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="תאריך" required><Input type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="שעה" required><Input type="time" value={f.time} onChange={set('time')} /></Field>
          <Field label="משך (דקות)"><Input type="number" min="10" step="5" value={f.minutes} onChange={set('minutes')} /></Field>
          <Field label="חזרה שבועית (מספר שבועות)"><Input type="number" min="1" max="52" value={f.weeks} onChange={set('weeks')} /></Field>
        </div>
        {f.kind === 'group' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="שם השיעור" required><Input value={f.title} onChange={set('title')} placeholder="למשל: כושר בוקר" /></Field>
            <Field label="מספר מקומות"><Input type="number" min="1" value={f.capacity} onChange={set('capacity')} /></Field>
          </div>
        )}
        <Field label={f.kind === 'personal' ? 'מתאמן' : `משתתפים (${f.clientIds.length})`}>
          {sortedClients.length === 0 ? <div className="text-sm text-slate-500">אין מתאמנים עדיין</div> : (
            <div className="max-h-52 overflow-y-auto">
              <Toggle multi={f.kind === 'group'} options={sortedClients.map((c) => ({ id: c.id, label: c.name }))}
                value={f.kind === 'group' ? f.clientIds : f.clientIds[0]}
                onChange={(v) => setF((x) => ({ ...x, clientIds: Array.isArray(v) ? v : [v] }))} />
            </div>
          )}
        </Field>
        {clash.length > 0 && (
          <div className="text-sm bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-lg px-3 py-2">
            ⚠ חופף ל-{clash.map((a) => `${a.time} ${a.kind === 'group' ? a.title : clientName(clients, a.participants[0]?.clientId)}`).join(', ')}
          </div>
        )}
        {err && <div className="text-sm text-red-300">{err}</div>}
        <div className="flex gap-2 justify-end">
          <Btn variant="outline" onClick={onCancel}>ביטול</Btn>
          <Btn onClick={submit}>שמירה</Btn>
        </div>
      </div>
    </Modal>
  );
}

function AppointmentDetail({ appt, clients, studio, onClose, onNotice, setView }) {
  const [adding, setAdding] = useState('');
  const free = clients.filter((c) => !appt.participants.some((p) => p.clientId === c.id));

  const mark = async (clientId, status) => {
    const r = await studio.changeAttendance(appt, clientId, status);
    if (status === 'attended') {
      if (r.deducted) {
        const st = St.membershipStatus(r.deducted, appt.date);
        onNotice({ tone: st.left === 0 ? 'warn' : 'ok', text: `${clientName(clients, clientId)}: נוכה אימון מ${r.deducted.name}${st.left !== null ? ` — נותרו ${st.left}` : ''}` });
      } else if (!r.already) {
        onNotice({ tone: 'warn', text: `${clientName(clients, clientId)}: אין מנוי פעיל — האימון נרשם בלי ניכוי` });
      }
    }
  };

  const remove = async (scope) => {
    const ids = scope === 'series' ? studio.schedule.filter((a) => a.seriesId === appt.seriesId && a.date >= appt.date).map((a) => a.id) : [appt.id];
    const attendedRefs = studio.schedule.filter((a) => ids.includes(a.id)).flatMap((a) => a.participants.filter((p) => p.status === 'attended').map((p) => [p.clientId, St.attendanceRef(a.id, p.clientId)]));
    if (!(await askConfirm(scope === 'series' ? `למחוק ${ids.length} אימונים בסדרה (מהיום הזה והלאה)?` : 'למחוק את האימון?', { danger: true }))) return;
    // כמה ניצולים של אותו מתאמן — מצטברים לפני שמירה אחת לכל מתאמן
    const byClient = {};
    for (const [cid, ref] of attendedRefs) byClient[cid] = St.removeUseByRef(byClient[cid] || studio.memberships[cid] || [], ref);
    for (const [cid, list] of Object.entries(byClient)) await studio.saveMemberships(cid, list);
    await studio.saveSchedule(studio.schedule.filter((a) => !ids.includes(a.id)));
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={appt.kind === 'group' ? appt.title : 'אימון אישי'}>
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Badge tone="indigo">{St.formatDayHe(appt.date)}</Badge>
          <Badge tone="slate">{appt.time} · {appt.minutes} דקות</Badge>
          {appt.kind === 'group' && <Badge tone="slate">{appt.participants.length}/{appt.capacity} רשומים</Badge>}
          {appt.seriesId && <Badge tone="slate">סדרה שבועית</Badge>}
        </div>
        <div className="space-y-2">
          {appt.participants.length === 0 && <div className="text-sm text-slate-500">אין משתתפים</div>}
          {appt.participants.map((p) => (
            <div key={p.clientId} className="flex items-center justify-between gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 flex-wrap">
              <button className="text-sm font-medium hover:text-indigo-300" onClick={() => setView({ name: 'client-detail', id: p.clientId })}>{clientName(clients, p.clientId)}</button>
              <div className="flex gap-1 flex-wrap">
                {Object.entries(St.ATTENDANCE).map(([k, v]) => (
                  <button key={k} onClick={() => mark(p.clientId, k)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition ${p.status === k ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>{v.label}</button>
                ))}
                {appt.kind === 'group' && (
                  <button title="הסרה מהשיעור" className="text-xs px-2 py-1 text-slate-500 hover:text-red-300"
                    onClick={async () => { if (p.status === 'attended') await studio.changeAttendance(appt, p.clientId, 'cancelled'); await studio.saveSchedule(St.removeParticipant(studio.schedule, appt.id, p.clientId)); }}>✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {appt.kind === 'group' && free.length > 0 && appt.participants.length < appt.capacity && (
          <div className="flex gap-2">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
              <option value="">הוספת משתתף...</option>
              {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Btn size="sm" disabled={!adding} onClick={async () => { await studio.saveSchedule(St.addParticipant(studio.schedule, appt.id, adding)); setAdding(''); }}>הוספה</Btn>
          </div>
        )}
        <div className="flex gap-2 justify-between pt-2 border-t border-slate-800 flex-wrap">
          <div className="flex gap-2">
            <Btn variant="danger" size="sm" onClick={() => remove('one')}>מחיקת האימון</Btn>
            {appt.seriesId && <Btn variant="danger" size="sm" onClick={() => remove('series')}>מחיקת הסדרה מכאן</Btn>}
          </div>
          <Btn variant="outline" size="sm" onClick={onClose}>סגירה</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      מנויים וגבייה (למאמן)
// ═══════════════════════════════════════════════════════════════════

export function MembershipsView({ clients, setView }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const [filter, setFilter] = useState('all');
  const [planEdit, setPlanEdit] = useState(null);

  const rows = useMemo(() => clients.map((c) => {
    const list = studio.memberships[c.id] || [];
    const current = St.activeMembership(list, today) || [...list].filter((m) => !m.cancelledAt).sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null;
    const st = current ? St.membershipStatus(current, today) : null;
    const dueAg = list.filter((m) => !m.cancelledAt).reduce((s, m) => s + St.membershipStatus(m, today).dueAg, 0);
    return { c, current, st, dueAg };
  }), [clients, studio.memberships, today]);

  const month = today.slice(0, 7);
  const incomeAg = Object.values(studio.memberships).flat().flatMap((m) => m.payments || []).filter((p) => p.date.startsWith(month)).reduce((s, p) => s + p.amountAg, 0);
  const activeCount = rows.filter((r) => r.st && ['active', 'ending'].includes(r.st.state)).length;
  const endingCount = rows.filter((r) => r.st?.state === 'ending').length;
  const totalDue = rows.reduce((s, r) => s + r.dueAg, 0);

  const shown = rows.filter((r) => filter === 'all' || (filter === 'active' && r.st && ['active', 'ending'].includes(r.st.state))
    || (filter === 'ending' && r.st?.state === 'ending') || (filter === 'none' && (!r.st || ['ended', 'expired'].includes(r.st.state))) || (filter === 'debt' && r.dueAg > 0));

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <PageHeader title="מנויים וגבייה" subtitle="כרטיסיות, מנויים תקופתיים, יתרות ותשלומים" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="מנויים פעילים" value={activeCount} tone="green" onClick={() => setFilter('active')} />
        <Stat label="עומדים להסתיים" value={endingCount} tone={endingCount ? 'amber' : 'normal'} onClick={() => setFilter('ending')} />
        <Stat label="יתרה לגבייה" value={St.fmtAg(totalDue)} tone={totalDue ? 'red' : 'normal'} onClick={() => setFilter('debt')} />
        <Stat label="התקבל החודש" value={St.fmtAg(incomeAg)} tone="indigo" />
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {[['all', 'הכול'], ['active', 'פעילים'], ['ending', 'עומדים להסתיים'], ['debt', 'עם יתרה'], ['none', 'בלי מנוי פעיל']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition ${filter === k ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>{l}</button>
        ))}
      </div>

      <Card padded={false} className="mb-8 overflow-x-auto">
        {shown.length === 0 ? <div className="p-8 text-center text-slate-500 text-sm">{clients.length ? 'אין מתאמנים בסינון הזה' : 'אין מתאמנים עדיין'}</div> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="text-right p-3 font-normal">מתאמן</th>
                <th className="text-right p-3 font-normal">מנוי</th>
                <th className="text-right p-3 font-normal w-40">ניצול</th>
                <th className="text-right p-3 font-normal">בתוקף עד</th>
                <th className="text-right p-3 font-normal">יתרה</th>
                <th className="text-right p-3 font-normal">מצב</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, current, st, dueAg }) => (
                <tr key={c.id} onClick={() => setView({ name: 'client-detail', id: c.id, tab: 'membership' })} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-slate-300">{current?.name || '—'}</td>
                  <td className="p-3">
                    {st ? (st.left === null ? <span className="text-xs text-slate-400">{st.used} אימונים</span> : (
                      <div><Bar value={st.used} max={current.sessions} /><div className="text-xs text-slate-500 mt-1">{st.used}/{current.sessions}</div></div>
                    )) : '—'}
                  </td>
                  <td className="p-3 text-slate-400 text-xs">{current?.end ? St.formatShortHe(current.end) : '—'}</td>
                  <td className={`p-3 ${dueAg ? 'text-red-300 font-semibold' : 'text-slate-500'}`}>{dueAg ? St.fmtAg(dueAg) : '—'}</td>
                  <td className="p-3">{st ? <Badge tone={St.STATE_LABEL[st.state].tone}>{St.STATE_LABEL[st.state].label}</Badge> : <Badge tone="slate">אין מנוי</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold" style={{ fontFamily: FONT_HEADING }}>סוגי מנוי</h3>
        <Btn size="sm" variant="outline" onClick={() => setPlanEdit({ id: '', name: '', kind: 'punch', sessions: '10', validDays: '90', price: '', active: true })}>+ סוג מנוי</Btn>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {studio.plans.map((p) => (
          <button key={p.id} onClick={() => setPlanEdit({ ...p, sessions: p.sessions ?? '', validDays: p.validDays ?? '', price: p.priceAg ? String(p.priceAg / 100) : '' })}
            className={`text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition ${p.active ? '' : 'opacity-50'}`}>
            <div className="flex justify-between items-start mb-2">
              <Badge tone="indigo">{St.PLAN_KINDS.find((k) => k.id === p.kind)?.label}</Badge>
              {!p.active && <Badge tone="slate">לא בשימוש</Badge>}
            </div>
            <div className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{p.name}</div>
            <div className="text-xs text-slate-400">
              {p.sessions ? `${p.sessions} אימונים` : 'ללא הגבלת אימונים'}{p.validDays ? ` · ${p.validDays} ימים` : ''}
            </div>
            <div className="text-lg font-bold text-indigo-300 mt-2">{p.priceAg ? St.fmtAg(p.priceAg) : 'מחיר לא נקבע'}</div>
          </button>
        ))}
      </div>

      {planEdit && <PlanForm initial={planEdit} plans={studio.plans} onClose={() => setPlanEdit(null)} onSave={async (list) => { await studio.savePlans(list); setPlanEdit(null); }} />}
    </div>
  );
}

function PlanForm({ initial, plans, onSave, onClose }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = () => {
    const priceAg = f.price === '' ? 0 : St.parseShekels(f.price);
    if (priceAg === null) { setErr('המחיר אינו תקין'); return; }
    const plan = {
      id: f.id || St.uid('plan'), name: String(f.name).trim(), kind: f.kind,
      sessions: f.sessions === '' ? null : Number(f.sessions), validDays: f.validDays === '' ? null : Number(f.validDays),
      priceAg, active: f.active !== false,
    };
    const e = St.validatePlan(plan);
    if (e) { setErr(e); return; }
    onSave(f.id ? plans.map((p) => (p.id === f.id ? plan : p)) : [...plans, plan]);
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'עריכת סוג מנוי' : 'סוג מנוי חדש'}>
      <div className="space-y-4">
        <Field label="שם" required><Input value={f.name} onChange={set('name')} placeholder="למשל: כרטיסיית 12 אימונים" /></Field>
        <Field label="סוג"><Toggle options={St.PLAN_KINDS} value={f.kind} onChange={set('kind')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={f.kind === 'punch' ? 'מספר אימונים' : 'מגבלת אימונים (ריק = ללא)'}><Input type="number" min="1" value={f.sessions} onChange={set('sessions')} /></Field>
          <Field label={f.kind === 'punch' ? 'תוקף בימים (ריק = ללא)' : 'משך בימים'}><Input type="number" min="1" value={f.validDays} onChange={set('validDays')} /></Field>
          <Field label="מחיר (₪)"><Input value={f.price} onChange={set('price')} placeholder="0" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={f.active !== false} onChange={(e) => set('active')(e.target.checked)} /> בשימוש (מוצג בבחירת מנוי חדש)
        </label>
        {err && <div className="text-sm text-red-300">{err}</div>}
        <div className="flex gap-2 justify-end"><Btn variant="outline" onClick={onClose}>ביטול</Btn><Btn onClick={submit}>שמירה</Btn></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      תזכורות (למאמן)
// ═══════════════════════════════════════════════════════════════════

export function RemindersView({ clients, trainer, setView }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const [copied, setCopied] = useState('');
  const list = studio.ready ? St.reminders({ clients, membershipsByClient: studio.memberships, lastSessionByClient: studio.lastByClient, schedule: studio.schedule, today, trainer }) : [];
  const groups = [
    ['מנוי ותשלום', list.filter((r) => ['ended', 'expired', 'ending', 'debt'].includes(r.kind))],
    ['אימונים מחר', list.filter((r) => r.kind === 'tomorrow')],
    ['לא התאמנו לאחרונה', list.filter((r) => r.kind === 'inactive')],
  ];
  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <PageHeader title="תזכורות" subtitle="מי צריך לחדש מנוי, למי יש יתרה, מי מגיע מחר ומי לא התאמן — עם הודעה מוכנה" />
      <div className="text-xs text-slate-500 mb-6">שום הודעה לא נשלחת לבד: ההודעה נפתחת בוואטסאפ או מועתקת, ואתה מחליט אם לשלוח.</div>
      {studio.ready && list.length === 0 && <Card className="text-center py-12 text-slate-400">אין תזכורות כרגע ✓</Card>}
      {groups.filter(([, items]) => items.length).map(([title, items]) => (
        <div key={title} className="mb-6">
          <h3 className="text-sm text-slate-400 tracking-wide mb-3">{title} ({items.length})</h3>
          <div className="space-y-2">
            {items.map((r, i) => {
              const c = clients.find((x) => x.id === r.clientId);
              const key = r.kind + r.clientId + i;
              return (
                <Card key={key} className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-10 rounded-full ${r.tone === 'red' ? 'bg-red-500' : r.tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'}`} />
                    <div>
                      <button className="font-medium hover:text-indigo-300 text-right" onClick={() => setView({ name: 'client-detail', id: r.clientId, tab: 'membership' })}>{r.title}</button>
                      <div className="text-xs text-slate-500">{r.detail}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" variant="outline" onClick={async () => { if (await copyToClipboard(r.message)) { setCopied(key); setTimeout(() => setCopied(''), 1500); } }}>{copied === key ? '✓ הועתק' : 'העתקה'}</Btn>
                    <Btn size="sm" variant="success" disabled={!c?.phone} title={c?.phone ? '' : 'אין מספר טלפון למתאמן'} onClick={() => shareWhatsApp(r.message, c.phone)}>וואטסאפ</Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//            כרטיס המתאמן — מנוי ותשלומים (לשונית בכרטיס)
// ═══════════════════════════════════════════════════════════════════

export function ClientMembershipTab({ client, clients, onReport }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const list = studio.memberships[client.id] || [];
  const [newOpen, setNewOpen] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [msg, setMsg] = useState(null);
  const current = St.activeMembership(list, today);
  const sorted = [...list].sort((a, b) => (a.start < b.start ? 1 : -1));
  const save = (l) => studio.saveMemberships(client.id, l);
  const upcoming = studio.schedule.filter((a) => a.date >= today && a.participants.some((p) => p.clientId === client.id && p.status === 'booked')).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 5);
  const stats = St.attendanceStats(studio.schedule, client.id);

  const useNow = async () => {
    const r = St.recordUse(list, { date: today, source: 'manual' }, today);
    if (!r.membership) { setMsg({ tone: 'warn', text: 'אין מנוי פעיל לניכוי' }); return; }
    await save(r.list);
    const st = St.membershipStatus(r.membership, today);
    setMsg({ tone: 'ok', text: `נוכה אימון${st.left !== null ? ` — נותרו ${st.left}` : ''}` });
  };

  return (
    <div className="space-y-4">
      <Notice notice={msg} onClose={() => setMsg(null)} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          {current ? (() => {
            const st = St.membershipStatus(current, today);
            return (
              <div className="flex gap-5 items-center flex-wrap">
                <div className="text-indigo-300"><Ring used={st.used} total={current.sessions} /></div>
                <div className="flex-1 min-w-[180px]">
                  <div className="flex gap-2 items-center mb-1">
                    <div className="text-xl font-bold" style={{ fontFamily: FONT_HEADING }}>{current.name}</div>
                    <Badge tone={St.STATE_LABEL[st.state].tone}>{St.STATE_LABEL[st.state].label}</Badge>
                  </div>
                  <div className="text-sm text-slate-400">
                    נוצלו {st.used}{current.sessions ? ` מתוך ${current.sessions}` : ''} · מ-{St.formatShortHe(current.start)}{current.end ? ` עד ${St.formatShortHe(current.end)}` : ''}
                    {st.daysLeft !== null && st.daysLeft >= 0 && ` (${st.daysLeft} ימים)`}
                  </div>
                  <div className={`text-sm mt-1 ${st.dueAg ? 'text-red-300' : 'text-emerald-300'}`}>{st.dueAg ? `יתרה לתשלום: ${St.fmtAg(st.dueAg)}` : 'שולם במלואו ✓'}</div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Btn size="sm" onClick={useNow}>✓ רישום אימון היום</Btn>
                    {st.dueAg > 0 && <Btn size="sm" variant="success" onClick={() => setPayFor(current)}>רישום תשלום</Btn>}
                  </div>
                </div>
              </div>
            );
          })() : (
            <div className="text-center py-6">
              <div className="text-slate-400 mb-3">אין מנוי פעיל</div>
              <Btn onClick={() => setNewOpen(true)}>+ מנוי חדש</Btn>
            </div>
          )}
        </Card>
        <Card>
          <h3 className="text-sm text-slate-400 mb-3 tracking-wide">נוכחות ביומן</h3>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div><div className="text-2xl font-bold text-emerald-300">{stats.attended}</div><div className="text-xs text-slate-500">הגיע</div></div>
            <div><div className="text-2xl font-bold text-red-300">{stats.noshow}</div><div className="text-xs text-slate-500">לא הגיע</div></div>
            <div><div className="text-2xl font-bold text-amber-300">{stats.cancelled}</div><div className="text-xs text-slate-500">ביטל</div></div>
          </div>
          {stats.rate !== null && <><Bar value={stats.rate} max={100} /><div className="text-xs text-slate-500 mt-1">{stats.rate}% נוכחות</div></>}
          <Btn size="sm" variant="outline" className="w-full mt-4" onClick={onReport}>📈 כרטיס ודוח למתאמן</Btn>
        </Card>
      </div>

      {upcoming.length > 0 && (
        <Card>
          <h3 className="text-sm text-slate-400 mb-3 tracking-wide">אימונים קרובים</h3>
          <div className="flex gap-2 flex-wrap">
            {upcoming.map((a) => <Badge key={a.id} tone="indigo">{St.DAY_NAMES[St.weekday(a.date)]} {St.formatShortHe(a.date)} · {a.time}{a.kind === 'group' ? ` · ${a.title}` : ''}</Badge>)}
          </div>
        </Card>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold" style={{ fontFamily: FONT_HEADING }}>היסטוריית מנויים</h3>
        {current && <Btn size="sm" variant="outline" onClick={() => setNewOpen(true)}>+ מנוי חדש</Btn>}
      </div>
      {sorted.length === 0 && <Card className="text-center py-8 text-slate-500 text-sm">עדיין לא נרשם מנוי</Card>}
      {sorted.map((m) => {
        const st = St.membershipStatus(m, today);
        return (
          <Card key={m.id} padded={false}>
            <div className="p-4 flex justify-between items-center gap-2 flex-wrap border-b border-slate-800">
              <div className="flex gap-2 items-center flex-wrap">
                <span className="font-semibold">{m.name}</span>
                <Badge tone={St.STATE_LABEL[st.state].tone}>{St.STATE_LABEL[st.state].label}</Badge>
                <span className="text-xs text-slate-500">{St.formatShortHe(m.start)}{m.end ? ` – ${St.formatShortHe(m.end)}` : ''}</span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-slate-400">{St.fmtAg(st.paidAg)} / {St.fmtAg(m.priceAg)}</span>
                {st.dueAg > 0 && !m.cancelledAt && <Btn size="sm" variant="success" onClick={() => setPayFor(m)}>תשלום</Btn>}
                {!m.cancelledAt && st.state !== 'ended' && (
                  <Btn size="sm" variant="ghost" onClick={async () => { if (await askConfirm(`לבטל את ${m.name}? האימונים והתשלומים שנרשמו נשמרים.`)) await save(list.map((x) => (x.id === m.id ? { ...x, cancelledAt: today } : x))); }}>ביטול מנוי</Btn>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 text-sm">
              <div className="p-4 md:border-l border-slate-800">
                <div className="text-xs text-slate-500 mb-2">אימונים שנוצלו ({st.used})</div>
                {(m.uses || []).length === 0 ? <div className="text-xs text-slate-600">—</div> : (
                  <div className="flex gap-1 flex-wrap">
                    {[...m.uses].reverse().map((u) => (
                      <span key={u.id} className="inline-flex items-center gap-1 text-xs bg-slate-800 text-slate-300 rounded px-2 py-0.5">
                        {St.formatShortHe(u.date)}{u.source === 'schedule' ? ' 📅' : ''}
                        {u.source !== 'schedule' && <button title="ביטול הניצול" className="text-slate-500 hover:text-red-300" onClick={() => save(St.removeUse(list, m.id, u.id))}>×</button>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="text-xs text-slate-500 mb-2">תשלומים</div>
                {(m.payments || []).length === 0 ? <div className="text-xs text-slate-600">—</div> : (m.payments || []).map((p) => (
                  <div key={p.id} className="flex justify-between text-xs py-1 border-b border-slate-800/50">
                    <span>{St.formatShortHe(p.date)} · {St.PAY_METHODS.find((x) => x.id === p.method)?.label}{p.note ? ` · ${p.note}` : ''}</span>
                    <span className="flex gap-2"><span className="text-emerald-300">{St.fmtAg(p.amountAg)}</span>
                      <button title="מחיקת התשלום" className="text-slate-500 hover:text-red-300" onClick={async () => { if (await askConfirm('למחוק את התשלום?', { danger: true })) save(St.removePayment(list, m.id, p.id)); }}>×</button></span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        );
      })}

      {newOpen && <NewMembershipForm plans={studio.plans.filter((p) => p.active)} onClose={() => setNewOpen(false)}
        onSave={async (m, pay) => {
          let l = [...list, m];
          if (pay) l = St.addPayment(l, m.id, pay, today);
          await save(l); setNewOpen(false); setMsg({ tone: 'ok', text: `נפתח ${m.name}` });
        }} />}
      {payFor && <PaymentForm membership={payFor} today={today} onClose={() => setPayFor(null)}
        onSave={async (pay) => { await save(St.addPayment(list, payFor.id, pay, today)); setPayFor(null); setMsg({ tone: 'ok', text: `נרשם תשלום של ${St.fmtAg(pay.amountAg)}` }); }} />}
    </div>
  );
}

function NewMembershipForm({ plans, onSave, onClose }) {
  const [planId, setPlanId] = useState(plans[0]?.id || '');
  const plan = plans.find((p) => p.id === planId);
  const [start, setStart] = useState(St.todayStr());
  const [price, setPrice] = useState(plan?.priceAg ? String(plan.priceAg / 100) : '');
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState('cash');
  const [err, setErr] = useState('');
  useEffect(() => { setPrice(plan?.priceAg ? String(plan.priceAg / 100) : ''); }, [planId]);
  const submit = () => {
    try {
      if (!plan) throw new Error('יש לבחור סוג מנוי (אפשר להוסיף במסך "מנויים וגבייה")');
      const priceAg = price === '' ? 0 : St.parseShekels(price);
      if (priceAg === null) throw new Error('המחיר אינו תקין');
      const m = St.newMembership(plan, start, priceAg);
      onSave(m, paidNow && priceAg > 0 ? { date: St.todayStr(), amountAg: priceAg, method } : null);
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal open onClose={onClose} title="מנוי חדש">
      <div className="space-y-4">
        <Field label="סוג מנוי">
          {plans.length === 0 ? <div className="text-sm text-slate-500">אין סוגי מנוי פעילים</div> :
            <Toggle options={plans.map((p) => ({ id: p.id, label: p.name }))} value={planId} onChange={setPlanId} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="תאריך התחלה"><Input type="date" value={start} onChange={setStart} /></Field>
          <Field label="מחיר (₪)"><Input value={price} onChange={setPrice} placeholder="0" /></Field>
        </div>
        {plan && <div className="text-xs text-slate-500">{plan.sessions ? `${plan.sessions} אימונים` : 'ללא הגבלת אימונים'}{plan.validDays && St.isDateStr(start) ? ` · בתוקף עד ${St.formatShortHe(St.addDays(start, plan.validDays - 1))}` : ''}</div>}
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> שולם עכשיו במלואו
        </label>
        {paidNow && <Field label="אמצעי תשלום"><Toggle options={St.PAY_METHODS} value={method} onChange={setMethod} /></Field>}
        {err && <div className="text-sm text-red-300">{err}</div>}
        <div className="flex gap-2 justify-end"><Btn variant="outline" onClick={onClose}>ביטול</Btn><Btn onClick={submit}>פתיחת מנוי</Btn></div>
      </div>
    </Modal>
  );
}

function PaymentForm({ membership, today, onSave, onClose }) {
  const due = St.membershipStatus(membership, today).dueAg;
  const [amount, setAmount] = useState(String(due / 100));
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    const amountAg = St.parseShekels(amount);
    if (!amountAg) { setErr('יש להזין סכום חיובי'); return; }
    if (amountAg > due) { setErr(`הסכום גבוה מהיתרה (${St.fmtAg(due)})`); return; }
    if (!St.isDateStr(date)) { setErr('התאריך אינו תקין'); return; }
    onSave({ date, amountAg, method, note });
  };
  return (
    <Modal open onClose={onClose} title={`תשלום — ${membership.name}`}>
      <div className="space-y-4">
        <div className="text-sm text-slate-400">יתרה לתשלום: <span className="text-red-300 font-semibold">{St.fmtAg(due)}</span></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סכום (₪)" required><Input value={amount} onChange={setAmount} /></Field>
          <Field label="תאריך"><Input type="date" value={date} onChange={setDate} /></Field>
        </div>
        <Field label="אמצעי תשלום"><Toggle options={St.PAY_METHODS} value={method} onChange={setMethod} /></Field>
        <Field label="הערה (מספר אסמכתה, קבלה...)"><Input value={note} onChange={setNote} maxLength={200} /></Field>
        <div className="text-xs text-slate-500">רישום בלבד — הכסף לא עובר דרך התוכנה. קבלה רשמית מפיקים במערכת הכלכלית.</div>
        {err && <div className="text-sm text-red-300">{err}</div>}
        <div className="flex gap-2 justify-end"><Btn variant="outline" onClick={onClose}>ביטול</Btn><Btn variant="success" onClick={submit}>רישום תשלום</Btn></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
//         כרטיס ודוח התקדמות למתאמן (הדפסה / PDF / וואטסאפ)
// ═══════════════════════════════════════════════════════════════════

const P = { ink: '#14213d', muted: '#5d6b85', faint: '#8a96ad', line: '#e3e7f0', soft: '#f4f6fb', brand: '#24479e', brandSoft: '#eaf0fb', gold: '#b8860b', good: '#13865b', bad: '#c43c3c' };

function MiniChart({ points, w = 300, h = 90 }) {
  const pts = St.chartPoints(points.map((p) => p.v), w, h);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden="true">
      {[0.25, 0.5, 0.75].map((t) => <line key={t} x1="0" x2={w} y1={h * t} y2={h * t} stroke={P.line} strokeWidth="1" />)}
      {pts.length > 1 && <path d={`${St.pathOf(pts)} L${pts[pts.length - 1].x} ${h} L${pts[0].x} ${h} Z`} fill={P.brandSoft} />}
      {pts.length > 1 && <path d={St.pathOf(pts)} fill="none" stroke={P.brand} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke={P.brand} strokeWidth="2" />)}
    </svg>
  );
}

function ReportContent({ client, trainer, summary, stats, membership, upcoming, note, today }) {
  const st = membership ? St.membershipStatus(membership, today) : null;
  const box = { border: `1px solid ${P.line}`, borderRadius: 12, padding: 14, background: '#fff' };
  return (
    <div style={{ fontFamily: FONT_BODY, color: P.ink, direction: 'rtl', lineHeight: 1.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `4px solid ${P.brand}`, paddingBottom: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: P.muted }}>כרטיס ודוח התקדמות</div>
          <div style={{ fontSize: 34, fontWeight: 900, fontFamily: FONT_HEADING, color: P.brand }}>{client.name}</div>
        </div>
        <div style={{ textAlign: 'left', fontSize: 12, color: P.muted }}>
          {trainer?.businessName && <div style={{ fontWeight: 700, color: P.ink, fontSize: 14 }}>{trainer.businessName}</div>}
          {trainer?.name && <div>{trainer.name}</div>}
          {trainer?.phone && <div>{trainer.phone}</div>}
          <div>{St.formatShortHe(today)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
        <div style={{ ...box, background: P.soft }}>
          <div style={{ fontSize: 11, color: P.muted }}>אימונים שהגעת אליהם</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: P.brand }}>{stats.attended}</div>
          {stats.rate !== null && <div style={{ fontSize: 11, color: P.muted }}>נוכחות {stats.rate}%</div>}
        </div>
        <div style={{ ...box, background: P.soft }}>
          <div style={{ fontSize: 11, color: P.muted }}>{membership ? membership.name : 'מנוי'}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: P.brand }}>{st ? (st.left === null ? '∞' : st.left) : '—'}</div>
          <div style={{ fontSize: 11, color: P.muted }}>{st ? (st.left === null ? 'ללא הגבלה' : 'אימונים שנותרו') : 'אין מנוי פעיל'}{membership?.end ? ` · עד ${St.formatShortHe(membership.end)}` : ''}</div>
        </div>
        <div style={{ ...box, background: P.soft }}>
          <div style={{ fontSize: 11, color: P.muted }}>מטרה</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: P.ink, marginTop: 6 }}>{client.goalLabel || '—'}</div>
        </div>
      </div>

      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_HEADING, margin: '6px 0 10px' }}>מדדים לאורך זמן</div>
      {summary.length === 0 ? <div style={{ ...box, color: P.faint, textAlign: 'center' }}>עדיין לא נרשמו מדידות</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 18 }}>
          {summary.map((s) => (
            <div key={s.k} style={{ ...box, breakInside: 'avoid' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: P.muted }}>
                  {s.count > 1 ? <>{s.first} ← <b style={{ color: P.ink }}>{s.last}</b> {s.unit}{' '}
                    <span style={{ color: s.good === null ? P.muted : s.good ? P.good : P.bad, fontWeight: 700 }}>({s.diff > 0 ? '+' : ''}{s.diff})</span></> : <>{s.last} {s.unit}</>}
                </div>
              </div>
              {s.count > 1 ? <MiniChart points={s.points} /> : <div style={{ fontSize: 11, color: P.faint }}>מדידה אחת — הגרף יופיע מהמדידה הבאה</div>}
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 && <>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_HEADING, margin: '6px 0 10px' }}>האימונים הבאים שלך</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {upcoming.map((a) => (
            <div key={a.id} style={{ border: `1px solid ${P.line}`, borderRadius: 10, padding: '8px 12px', background: P.brandSoft, fontSize: 13 }}>
              <b>{St.DAY_NAMES[St.weekday(a.date)]} {St.formatShortHe(a.date)}</b> · {a.time}{a.kind === 'group' ? ` · ${a.title}` : ''}
            </div>
          ))}
        </div>
      </>}

      {note && <>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: FONT_HEADING, margin: '6px 0 10px' }}>מילה מהמאמן</div>
        <div style={{ ...box, borderRight: `4px solid ${P.gold}`, whiteSpace: 'pre-wrap', marginBottom: 18 }}>{note}</div>
      </>}

      <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10, fontSize: 11, color: P.faint, textAlign: 'center' }}>
        כל הכבוד על ההתמדה! {trainer?.name ? `· ${trainer.name}` : ''}
      </div>
    </div>
  );
}

export function ClientReport({ client, clients, trainer, measurements, goalLabel, onClose }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const summary = St.measurementSummary(measurements);
  const stats = St.attendanceStats(studio.schedule, client.id);
  const membership = St.activeMembership(studio.memberships[client.id] || [], today);
  const upcoming = studio.schedule.filter((a) => a.date >= today && a.participants.some((p) => p.clientId === client.id && p.status === 'booked'))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 6);
  const props = { client: { ...client, goalLabel }, trainer, summary, stats, membership, upcoming, note, today };
  const text = St.progressText({ client, trainer, summary, stats, membership, today }) + (note ? `\n\n${note}` : '');

  return (
    <div>
      <div className="fixed inset-0 bg-slate-900 z-40 overflow-y-auto no-print">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center z-10 flex-wrap gap-2">
          <div className="text-sm text-slate-400">כרטיס ודוח התקדמות למתאמן — הדפסה, PDF או שליחה</div>
          <div className="flex gap-2 flex-wrap">
            <Btn onClick={() => savePdf(`דוח התקדמות — ${client.name || ''}`)}>⎙ שמירה כ-PDF</Btn>
            <Btn variant="outline" onClick={printNow}>🖨 הדפסה</Btn>
            <Btn variant="success" disabled={!client.phone} title={client.phone ? '' : 'אין מספר טלפון'} onClick={() => shareWhatsApp(text, client.phone)}>וואטסאפ</Btn>
            <Btn variant="outline" onClick={async () => { if (await copyToClipboard(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? '✓ הועתק' : 'העתקת סיכום'}</Btn>
            <Btn variant="outline" onClick={onClose}>סגירה</Btn>
          </div>
        </div>
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          <Field label="מילה מהמאמן (אופציונלי — מופיעה בדוח)"><Textarea value={note} onChange={(v) => setNote(v.slice(0, 600))} rows={2} /></Field>
          <div className="mt-4" style={{ background: 'white', padding: 36, borderRadius: 12 }}>
            <ReportContent {...props} />
          </div>
        </div>
      </div>
      <div className="print-only" style={{ background: 'white' }}><ReportContent {...props} /></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      לוח הבקרה — היום ביומן
// ═══════════════════════════════════════════════════════════════════

export function TodayPanel({ clients, trainer, setView }) {
  const studio = useStudio(clients);
  const today = St.todayStr();
  const list = St.appointmentsOn(studio.schedule, today);
  const rem = studio.ready ? St.reminders({ clients, membershipsByClient: studio.memberships, lastSessionByClient: studio.lastByClient, schedule: studio.schedule, today, trainer }) : [];
  const urgent = rem.filter((r) => ['ended', 'expired', 'debt', 'ending'].includes(r.kind)).length;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6 md:mb-8">
      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm text-slate-400 tracking-wide">היום ביומן</h3>
          <button onClick={() => setView({ name: 'schedule' })} className="text-xs text-indigo-400 hover:text-indigo-300">ליומן ←</button>
        </div>
        {list.length === 0 ? <div className="text-slate-500 text-sm">{St.isShabbat(today) ? 'שבת שלום' : 'אין אימונים היום'}</div> : (
          <div className="space-y-2">
            {list.map((a) => (
              <div key={a.id} className="flex justify-between items-center text-sm">
                <span><span className="text-indigo-300 font-semibold ml-2">{a.time}</span>{a.kind === 'group' ? a.title : clientName(clients, a.participants[0]?.clientId)}</span>
                <span className="text-xs text-slate-500">{a.kind === 'group' ? `${a.participants.length}/${a.capacity}` : St.ATTENDANCE[a.participants[0]?.status || 'booked'].label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm text-slate-400 tracking-wide">מנויים ותזכורות</h3>
          <button onClick={() => setView({ name: 'reminders' })} className="text-xs text-indigo-400 hover:text-indigo-300">לכל התזכורות ←</button>
        </div>
        {rem.length === 0 ? <div className="text-slate-500 text-sm">הכול מסודר ✓</div> : (
          <div className="space-y-2">
            {rem.slice(0, 4).map((r, i) => (
              <button key={i} onClick={() => setView({ name: 'client-detail', id: r.clientId, tab: 'membership' })} className="w-full text-right flex justify-between items-center text-sm hover:bg-slate-800 rounded-lg p-1.5 transition">
                <span>{r.title}</span><span className={r.tone === 'red' ? 'text-red-300 text-xs' : 'text-amber-400 text-xs'}>{r.detail}</span>
              </button>
            ))}
            {urgent > 4 && <div className="text-xs text-slate-500">ועוד {urgent - 4}...</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
