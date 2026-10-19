// מודול האימונים — clients.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MEDICAL_CONDITIONS, GOALS, EQUIPMENT, LEVELS } from '../data/constants.js';
import { S, K } from '../lib/db.js';
import { ClientMembershipTab, ClientReport } from '../studio.jsx';
import { generateProgram, getMedicalWarnings, calcBMI, bmiCategory } from '../lib/program.js';
import { FONT_HEADING, Btn, Card, Field, Input, Textarea, Badge, Toggle } from '../components/legacy-ui.jsx';
import { ProgramTab } from './program.jsx';
import { ClientNutritionTab } from './nutrition.jsx';
import { ClientAssessmentTab } from './tools.jsx';
import { askConfirm } from '../lib/dialog.js';


// ═══════════════════════════════════════════════════════════════════
//                      CLIENTS LIST
// ═══════════════════════════════════════════════════════════════════

export function ClientsList({ clients, setView, onDelete }) {
  const [search, setSearch] = useState('');
  const [filterGoal, setFilterGoal] = useState('all');

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (filterGoal !== 'all' && c.goal !== filterGoal) return false;
      if (search && !c.name?.includes(search) && !c.phone?.includes(search)) return false;
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [clients, search, filterGoal]);

  return (
    <div className="p-4 md:p-8">
      <header className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>מתאמנים</h1>
          <div className="text-sm text-slate-400">{clients.length} מתאמנים במערכת</div>
        </div>
        <Btn variant="primary" onClick={() => setView({ name: 'client-new' })}>+ מתאמן חדש</Btn>
      </header>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <Input value={search} onChange={setSearch} placeholder="חיפוש לפי שם או טלפון..." className="flex-1" />
        <select
          value={filterGoal}
          onChange={(e) => setFilterGoal(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">כל המטרות</option>
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-slate-400 mb-4">
            {clients.length === 0 ? 'עדיין אין מתאמנים. התחל בהוספת הראשון!' : 'לא נמצאו מתאמנים תואמים לחיפוש'}
          </div>
          {clients.length === 0 && <Btn variant="primary" onClick={() => setView({ name: 'client-new' })}>+ הוסף מתאמן ראשון</Btn>}
        </Card>
      ) : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="border-b border-slate-800 text-xs text-slate-400">
              <tr>
                <th className="text-right p-4 font-normal">שם</th>
                <th className="text-right p-4 font-normal">גיל</th>
                <th className="text-right p-4 font-normal">מטרה</th>
                <th className="text-right p-4 font-normal">רמה</th>
                <th className="text-right p-4 font-normal">הצטרף</th>
                <th className="text-right p-4 font-normal">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                  <td className="p-4">
                    <button onClick={() => setView({ name: 'client-detail', id: c.id })} className="text-right hover:text-indigo-300">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.phone || '—'}</div>
                    </button>
                  </td>
                  <td className="p-4 text-slate-300">{c.age || '—'}</td>
                  <td className="p-4"><Badge tone="indigo">{GOALS.find((g) => g.id === c.goal)?.label || '—'}</Badge></td>
                  <td className="p-4 text-slate-300">{LEVELS.find((l) => l.id === c.level)?.label || '—'}</td>
                  <td className="p-4 text-slate-500 text-xs">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('he-IL') : '—'}</td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <Btn size="sm" variant="outline" onClick={() => setView({ name: 'client-detail', id: c.id })}>פתח</Btn>
                      <Btn size="sm" variant="danger" onClick={async () => { if (await askConfirm(`למחוק את ${c.name}?`, { danger: true })) onDelete(c.id); }} title="מחק">✕</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      CLIENT FORM (new / edit)
// ═══════════════════════════════════════════════════════════════════

export function ClientForm({ initial, onSave, onCancel }) {
  const [d, setD] = useState(initial || {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    age: '',
    gender: 'male',
    phone: '',
    email: '',
    height: '',
    weight: '',
    level: 'beginner',
    goal: 'health',
    medical: [],
    medicalNotes: '',
    equipment: ['bw'],
    daysPerWeek: 3,
    notes: '',
    createdAt: new Date().toISOString(),
  });

  const canSave = d.name.trim() && d.age && d.goal && d.level;

  const update = (k, v) => setD({ ...d, [k]: v });

  const handleSave = () => {
    if (!canSave) return;
    const prepared = {
      ...d,
      age: parseInt(d.age, 10),
      height: d.height ? parseInt(d.height, 10) : null,
      weight: d.weight ? parseFloat(d.weight) : null,
      daysPerWeek: parseInt(d.daysPerWeek, 10),
    };
    onSave(prepared);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <header className="mb-6">
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-200 mb-4">← חזרה</button>
        <h1 className="text-3xl font-bold" style={{ fontFamily: FONT_HEADING }}>{initial ? 'עריכת מתאמן' : 'מתאמן חדש'}</h1>
      </header>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">פרטים אישיים</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="שם מלא" required>
            <Input value={d.name} onChange={(v) => update('name', v)} />
          </Field>
          <Field label="גיל" required>
            <Input type="number" value={d.age} onChange={(v) => update('age', v)} />
          </Field>
          <Field label="מין">
            <div className="flex gap-2">
              {[{ id: 'male', label: 'זכר' }, { id: 'female', label: 'נקבה' }].map((g) => (
                <button key={g.id} onClick={() => update('gender', g.id)}
                  className={`flex-1 py-2 rounded-lg border text-sm ${d.gender === g.id ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="טלפון">
            <Input type="tel" value={d.phone} onChange={(v) => update('phone', v)} />
          </Field>
          <Field label="אימייל">
            <Input type="email" value={d.email} onChange={(v) => update('email', v)} />
          </Field>
          <div />
          <Field label='גובה (ס"מ)'>
            <Input type="number" value={d.height} onChange={(v) => update('height', v)} />
          </Field>
          <Field label='משקל (ק"ג)'>
            <Input type="number" step="0.1" value={d.weight} onChange={(v) => update('weight', v)} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">מטרה ורמה</h3>
        <div className="space-y-4">
          <Field label="רמת כושר" required>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => update('level', l.id)}
                  className={`py-2 rounded-lg border text-sm ${d.level === l.id ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                  {l.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="מטרת אימון" required>
            <Toggle options={GOALS} value={d.goal} onChange={(v) => update('goal', v)} />
          </Field>
          <Field label="ימי אימון בשבוע">
            <Input type="number" min="1" max="7" value={d.daysPerWeek} onChange={(v) => update('daysPerWeek', v)} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">מצב רפואי</h3>
        <Field label="בחר את כל המצבים הרלוונטיים">
          <Toggle options={MEDICAL_CONDITIONS} value={d.medical} onChange={(v) => update('medical', v)} multi />
        </Field>
        <div className="mt-3">
          <Field label="הערות רפואיות נוספות">
            <Textarea value={d.medicalNotes} onChange={(v) => update('medicalNotes', v)} placeholder="פרטים נוספים, תרופות, אישור רופא וכו׳" />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">ציוד זמין</h3>
        <Toggle options={EQUIPMENT} value={d.equipment} onChange={(v) => update('equipment', v)} multi />
      </Card>

      <Card className="mb-6">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">הערות כלליות</h3>
        <Textarea value={d.notes} onChange={(v) => update('notes', v)} rows={4} placeholder="זמינות, העדפות, הערות אישיות..." />
      </Card>

      <div className="flex justify-between">
        <Btn variant="ghost" onClick={onCancel}>ביטול</Btn>
        <Btn variant="primary" disabled={!canSave} onClick={handleSave}>שמירה</Btn>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      CLIENT DETAIL (with tabs)
// ═══════════════════════════════════════════════════════════════════

export function ClientDetail({ clientId, initialTab, clients, trainer, setView, saveClient, onDelete }) {
  const [client, setClient] = useState(null);
  const [program, setProgram] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [tab, setTab] = useState(initialTab || 'overview');
  const [editing, setEditing] = useState(false);
  const [report, setReport] = useState(false);

  const reload = async () => {
    const c = await S.get(K.client(clientId));
    const p = await S.get(K.program(clientId));
    const s = (await S.get(K.sessions(clientId))) || [];
    const m = (await S.get(K.measurements(clientId))) || [];
    setClient(c);
    setProgram(p);
    setSessions(s);
    setMeasurements(m);
  };

  useEffect(() => { reload(); }, [clientId]);

  if (!client) return <div className="p-8 text-slate-400">טוען...</div>;

  if (editing) {
    return (
      <ClientForm
        initial={client}
        onSave={async (c) => { await saveClient(c); setEditing(false); reload(); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // הדוח למתאמן מחליף את כל המסך (גם בהדפסה — בלי כרטיס המתאמן מאחוריו)
  if (report) {
    return <ClientReport client={client} clients={clients} trainer={trainer} measurements={measurements} goalLabel={GOALS.find((g) => g.id === client.goal)?.label} onClose={() => setReport(false)} />;
  }

  const warnings = getMedicalWarnings(client);
  const bmi = calcBMI(client.height, client.weight);

  const handleGenerate = async () => {
    const newProgram = generateProgram(client);
    await S.set(K.program(client.id), newProgram);
    setProgram(newProgram);
    setTab('program');
  };

  const handleSaveProgram = async (p) => {
    await S.set(K.program(client.id), p);
    setProgram(p);
  };

  const handleLogSession = async (dayIndex, notes) => {
    const newSess = [
      ...sessions,
      { id: `s_${Date.now()}`, dayIndex, completedAt: new Date().toISOString(), notes: notes || '' },
    ];
    await S.set(K.sessions(client.id), newSess);
    setSessions(newSess);
  };

  const handleAddMeasurement = async (m) => {
    const newM = [...measurements, { ...m, id: `m_${Date.now()}`, date: new Date().toISOString() }];
    await S.set(K.measurements(client.id), newM);
    setMeasurements(newM);
    if (m.weight) {
      const updated = { ...client, weight: m.weight };
      await saveClient(updated);
      setClient(updated);
    }
  };

  const tabs = [
    { id: 'overview', label: 'סקירה' },
    { id: 'membership', label: 'מנוי ותשלומים' },
    { id: 'program', label: 'תוכנית אימון' },
    { id: 'nutrition', label: 'תזונה' },
    { id: 'assessment', label: 'הערכה' },
    { id: 'progress', label: 'התקדמות' },
    { id: 'sessions', label: `אימונים (${sessions.length})` },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <button onClick={() => setView({ name: 'clients' })} className="text-sm text-slate-400 hover:text-slate-200 mb-4">← חזרה לרשימה</button>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>{client.name}</h1>
          <div className="flex gap-2 items-center text-sm text-slate-400 flex-wrap">
            <span>{client.age} שנים</span>
            <span>·</span>
            <span>{client.gender === 'female' ? 'נקבה' : 'זכר'}</span>
            {client.phone && <><span>·</span><span>{client.phone}</span></>}
          </div>
        </div>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={() => setReport(true)}>📈 כרטיס ודוח למתאמן</Btn>
          <Btn variant="outline" onClick={() => setEditing(true)}>עריכה</Btn>
          <Btn variant="danger" onClick={async () => { if (await askConfirm(`למחוק לצמיתות את ${client.name} וכל הנתונים הקשורים?`, { danger: true })) { onDelete(client.id); setView({ name: 'clients' }); } }}>מחק</Btn>
        </div>
      </div>

      {/* Quick badges */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Badge tone="indigo">{GOALS.find((g) => g.id === client.goal)?.label}</Badge>
        <Badge tone="slate">{LEVELS.find((l) => l.id === client.level)?.label}</Badge>
        {bmi && <Badge tone="slate">BMI {bmi} ({bmiCategory(bmi)})</Badge>}
        {client.medical?.length > 0 && <Badge tone="amber">⚠ {client.medical.length} מצבים רפואיים</Badge>}
        <Badge tone="slate">{client.daysPerWeek} ימי אימון בשבוע</Badge>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="mb-6 bg-amber-950/20 border-amber-800/50">
          <h3 className="font-semibold text-amber-300 mb-2 text-sm">⚠ התוויות והנחיות רפואיות</h3>
          <ul className="space-y-1 text-sm text-amber-100/80">
            {warnings.map((w, i) => (
              <li key={i}><strong>{w.condition}:</strong> {w.warning}</li>
            ))}
          </ul>
          {client.medicalNotes && (
            <div className="mt-3 pt-3 border-t border-amber-800/30 text-sm text-amber-100/70">
              <strong>הערות נוספות:</strong> {client.medicalNotes}
            </div>
          )}
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto no-print">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'membership' && <ClientMembershipTab client={client} clients={clients} onReport={() => setReport(true)} />}
      {tab === 'overview' && <OverviewTab client={client} program={program} sessionCount={sessions.length} />}
      {tab === 'program' && <ProgramTab client={client} program={program} trainer={trainer} onGenerate={handleGenerate} onSave={handleSaveProgram} onLogSession={handleLogSession} />}
      {tab === 'nutrition' && <ClientNutritionTab client={client} />}
      {tab === 'assessment' && <ClientAssessmentTab client={client} />}
      {tab === 'progress' && <ProgressTab client={client} measurements={measurements} onAdd={handleAddMeasurement} />}
      {tab === 'sessions' && <SessionsTab sessions={sessions} program={program} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      CLIENT DETAIL TABS
// ═══════════════════════════════════════════════════════════════════

function OverviewTab({ client, program, sessionCount }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <Card>
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">נתונים אישיים</h3>
        <dl className="space-y-2 text-sm">
          {client.height && <Row label="גובה" value={`${client.height} ס"מ`} />}
          {client.weight && <Row label="משקל" value={`${client.weight} ק"ג`} />}
          {client.email && <Row label="אימייל" value={client.email} />}
          <Row label="הצטרף" value={new Date(client.createdAt).toLocaleDateString('he-IL')} />
          <Row label="אימונים הושלמו" value={sessionCount} />
        </dl>
      </Card>
      <Card>
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">ציוד זמין</h3>
        <div className="flex flex-wrap gap-2">
          {client.equipment.map((eq) => {
            const item = EQUIPMENT.find((e) => e.id === eq);
            return <Badge key={eq} tone="slate">{item?.label || eq}</Badge>;
          })}
        </div>
        <h3 className="text-sm text-slate-400 mt-6 mb-4 tracking-wide">סטטוס תוכנית</h3>
        {program ? (
          <div className="text-sm text-slate-300">
            <div className="text-emerald-400 mb-1">✓ תוכנית פעילה — {program.days.length} ימי אימון</div>
            <div className="text-xs text-slate-500">נוצרה: {new Date(program.createdAt).toLocaleDateString('he-IL')}</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">טרם נוצרה תוכנית אימון</div>
        )}
      </Card>
      {client.notes && (
        <Card className="col-span-2">
          <h3 className="text-sm text-slate-400 mb-2 tracking-wide">הערות</h3>
          <div className="text-sm text-slate-300 whitespace-pre-wrap">{client.notes}</div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-800 last:border-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}

// ─── Progress tab ───
function ProgressTab({ client, measurements, onAdd }) {
  const [form, setForm] = useState({ weight: '', bodyFat: '', chest: '', waist: '', hips: '', arm: '', thigh: '' });

  const handleSubmit = () => {
    const m = {};
    Object.entries(form).forEach(([k, v]) => { if (v) m[k] = parseFloat(v); });
    if (Object.keys(m).length === 0) return;
    onAdd(m);
    setForm({ weight: '', bodyFat: '', chest: '', waist: '', hips: '', arm: '', thigh: '' });
  };

  const weightData = measurements
    .filter((m) => m.weight)
    .map((m) => ({
      date: new Date(m.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
      weight: m.weight,
    }));

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">מדידה חדשה</h3>
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2 mb-3">
          <Field label='משקל'>
            <Input type="number" step="0.1" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} />
          </Field>
          <Field label='% שומן'>
            <Input type="number" step="0.1" value={form.bodyFat} onChange={(v) => setForm({ ...form, bodyFat: v })} />
          </Field>
          <Field label='חזה'>
            <Input type="number" step="0.5" value={form.chest} onChange={(v) => setForm({ ...form, chest: v })} />
          </Field>
          <Field label='מותן'>
            <Input type="number" step="0.5" value={form.waist} onChange={(v) => setForm({ ...form, waist: v })} />
          </Field>
          <Field label='ירכיים'>
            <Input type="number" step="0.5" value={form.hips} onChange={(v) => setForm({ ...form, hips: v })} />
          </Field>
          <Field label='זרוע'>
            <Input type="number" step="0.5" value={form.arm} onChange={(v) => setForm({ ...form, arm: v })} />
          </Field>
          <Field label='ירך'>
            <Input type="number" step="0.5" value={form.thigh} onChange={(v) => setForm({ ...form, thigh: v })} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Btn variant="primary" size="sm" onClick={handleSubmit}>+ הוסף מדידה</Btn>
        </div>
      </Card>

      {weightData.length > 1 && (
        <Card>
          <h3 className="text-sm text-slate-400 mb-4 tracking-wide">מגמת משקל</h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={weightData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} domain={['dataMin - 2', 'dataMax + 2']} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#cbd5e1' }} />
                <Line type="monotone" dataKey="weight" stroke="#818cf8" strokeWidth={2} dot={{ fill: '#818cf8', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5 border-b border-slate-800">
          <h3 className="text-sm text-slate-400 tracking-wide">היסטוריית מדידות</h3>
        </div>
        {measurements.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">אין מדידות עדיין</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="text-right p-3 font-normal">תאריך</th>
                <th className="text-right p-3 font-normal">משקל</th>
                <th className="text-right p-3 font-normal">% שומן</th>
                <th className="text-right p-3 font-normal">חזה</th>
                <th className="text-right p-3 font-normal">מותן</th>
                <th className="text-right p-3 font-normal">ירכיים</th>
                <th className="text-right p-3 font-normal">זרוע</th>
                <th className="text-right p-3 font-normal">ירך</th>
              </tr>
            </thead>
            <tbody>
              {[...measurements].reverse().map((m) => (
                <tr key={m.id} className="border-b border-slate-800/50">
                  <td className="p-3 text-slate-400 text-xs">{new Date(m.date).toLocaleDateString('he-IL')}</td>
                  <td className="p-3">{m.weight ?? '—'}</td>
                  <td className="p-3">{m.bodyFat ?? '—'}</td>
                  <td className="p-3">{m.chest ?? '—'}</td>
                  <td className="p-3">{m.waist ?? '—'}</td>
                  <td className="p-3">{m.hips ?? '—'}</td>
                  <td className="p-3">{m.arm ?? '—'}</td>
                  <td className="p-3">{m.thigh ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── Sessions tab ───
function SessionsTab({ sessions, program }) {
  if (sessions.length === 0) {
    return <Card className="text-center py-12 text-slate-500">טרם נרשמו אימונים</Card>;
  }

  return (
    <Card padded={false}>
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="text-right p-4 font-normal">תאריך</th>
            <th className="text-right p-4 font-normal">יום אימון</th>
            <th className="text-right p-4 font-normal">הערות</th>
          </tr>
        </thead>
        <tbody>
          {[...sessions].reverse().map((s) => (
            <tr key={s.id} className="border-b border-slate-800/50">
              <td className="p-4">
                <div>{new Date(s.completedAt).toLocaleDateString('he-IL')}</div>
                <div className="text-xs text-slate-500">{new Date(s.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
              </td>
              <td className="p-4">{program?.days?.[s.dayIndex]?.name || '—'}</td>
              <td className="p-4 text-slate-400 text-xs max-w-lg">{s.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}