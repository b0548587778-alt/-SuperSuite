import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';


import {
  MEDICAL_CONDITIONS, GOALS, EQUIPMENT, LEVELS, ACTIVITY_LEVELS,
} from './data/constants.js';
import { EXERCISES, GOAL_PARAMS } from './data/exercises.js';
import {
  FOODS, calculateBMR, calculateTDEE, calculateGoalCalories, calculateMacros,
  MEAL_PLANS, NUTRITION_TIPS,
} from './data/nutrition.js';
import {
  WARMUP_PROTOCOLS, INJURIES, TRAINING_PRINCIPLES, ADVANCED_TECHNIQUES,
  ASSESSMENTS, calculate1RM, calculatePercentages, PARQ_QUESTIONS,
} from './data/knowledge.js';
import {
  MOBILITY_ROUTINES, YOGA_FLOWS, RECOVERY_METHODS,
} from './data/mobility.js';
import {
  HEART_RATE_ZONES, calculateMaxHR, calculateZoneHR,
  HIIT_PROTOCOLS, RUNNING_PROGRAMS, LISS_PROTOCOLS,
} from './data/cardio.js';
import { PROGRAM_TEMPLATES } from './data/program-templates.js';
import {
  programToPlainText, whatsappShareUrl, shareNative, copyToClipboard,
  formatDateHe, printPage, downloadText,
} from './lib/sharing.js';


// ═══════════════════════════════════════════════════════════════════
//                      STORAGE LAYER
// ═══════════════════════════════════════════════════════════════════

import { S, K } from './lib/db.js';
import { removeClientEverywhere } from './lib/studio.js';
import { ScheduleView, MembershipsView, RemindersView, ClientMembershipTab, ClientReport, TodayPanel } from './studio.jsx';

// ═══════════════════════════════════════════════════════════════════
//                   BUSINESS LOGIC
// ═══════════════════════════════════════════════════════════════════

function filterExercises(client) {
  return EXERCISES.filter((ex) => {
    if (ex.contra.some((c) => client.medical?.includes(c))) return false;
    if (!ex.eq.some((eq) => client.equipment?.includes(eq))) return false;
    if (client.level === 'beginner' && ex.lvl === 'advanced') return false;
    return true;
  });
}

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

// Core program generator — multi-day split
function generateProgram(client) {
  const days = parseInt(client.daysPerWeek || 3, 10);
  const available = filterExercises(client);
  const params = GOAL_PARAMS[client.goal] || GOAL_PARAMS.health;

  // Categorize available pool
  const byPart = {
    legs: available.filter((e) => ['רגליים', 'ירך אחורית'].includes(e.part) && e.cat === 'compound'),
    legsIso: available.filter((e) => ['רגליים', 'ירך אחורית'].includes(e.part) && e.cat === 'isolation'),
    chest: available.filter((e) => e.part === 'חזה'),
    back: available.filter((e) => e.part === 'גב'),
    shoulders: available.filter((e) => e.part === 'כתפיים'),
    arms: available.filter((e) => e.part === 'ידיים'),
    core: available.filter((e) => e.cat === 'core'),
    cardio: available.filter((e) => e.cat === 'cardio'),
    flex: available.filter((e) => e.cat === 'flex'),
  };

  // Decide split based on days/week + goal
  let splits;
  if (days <= 2) {
    splits = [
      { name: 'אימון גוף מלא A', blocks: ['legs', 'chest', 'back', 'core'] },
      { name: 'אימון גוף מלא B', blocks: ['legs', 'shoulders', 'back', 'core'] },
    ].slice(0, days);
  } else if (days === 3) {
    splits = [
      { name: 'יום A — גוף מלא', blocks: ['legs', 'chest', 'back', 'core'] },
      { name: 'יום B — גוף מלא', blocks: ['legs', 'shoulders', 'back', 'arms', 'core'] },
      { name: 'יום C — גוף מלא', blocks: ['legs', 'chest', 'back', 'core', 'flex'] },
    ];
  } else if (days === 4) {
    splits = [
      { name: 'יום A — פלג עליון', blocks: ['chest', 'back', 'shoulders', 'arms'] },
      { name: 'יום B — פלג תחתון', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום C — פלג עליון', blocks: ['back', 'chest', 'arms', 'shoulders'] },
      { name: 'יום D — פלג תחתון', blocks: ['legs', 'legsIso', 'core', 'flex'] },
    ];
  } else {
    // 5+ days PPL + extras
    splits = [
      { name: 'יום A — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום B — משיכה', blocks: ['back', 'arms'] },
      { name: 'יום C — רגליים', blocks: ['legs', 'legsIso', 'core'] },
      { name: 'יום D — דחיפה', blocks: ['chest', 'shoulders', 'arms'] },
      { name: 'יום E — משיכה ורגליים', blocks: ['back', 'legs', 'core'] },
    ].slice(0, days);
  }

  // Build each day
  const seenInWeek = new Set();
  const program = splits.map((split) => {
    const dayExercises = [];
    split.blocks.forEach((blockKey) => {
      const pool = byPart[blockKey].filter((e) => !seenInWeek.has(e.id));
      const pickCount = blockKey === 'legs' || blockKey === 'chest' || blockKey === 'back' ? 1 :
                        blockKey === 'core' ? 2 : 1;
      const picked = pickN(pool.length > 0 ? pool : byPart[blockKey], pickCount);
      picked.forEach((ex) => {
        seenInWeek.add(ex.id);
        const isTimed = ex.cat === 'core' || ex.cat === 'flex' || ex.id === 'plank' || ex.id === 'side-plank';
        dayExercises.push({
          exerciseId: ex.id,
          sets: ex.cat === 'flex' ? 2 : params.sets,
          reps: isTimed ? null : `${params.repsMin}-${params.repsMax}`,
          duration: isTimed ? (ex.cat === 'flex' ? 30 : 40) : null,
          rest: params.rest,
          weight: '',
          notes: '',
        });
      });
    });

    // Add cardio if appropriate
    if (params.cardioMin > 0 && byPart.cardio.length > 0) {
      const cardio = byPart.cardio[0];
      dayExercises.push({
        exerciseId: cardio.id,
        sets: 1,
        reps: null,
        duration: params.cardioMin * 60,
        rest: 0,
        weight: '',
        notes: `${params.cardioMin} דקות בעצימות מתונה`,
      });
    }

    return { name: split.name, exercises: dayExercises };
  });

  return { days: program, createdAt: new Date().toISOString(), goal: client.goal };
}

function getMedicalWarnings(client) {
  return MEDICAL_CONDITIONS
    .filter((c) => client.medical?.includes(c.id))
    .map((c) => ({ condition: c.label, warning: c.warning }));
}

function calcBMI(h, w) {
  if (!h || !w) return null;
  return (w / ((h / 100) ** 2)).toFixed(1);
}

function bmiCategory(bmi) {
  if (!bmi) return '';
  const n = parseFloat(bmi);
  if (n < 18.5) return 'תת-משקל';
  if (n < 25) return 'תקין';
  if (n < 30) return 'עודף משקל';
  return 'השמנה';
}

// ═══════════════════════════════════════════════════════════════════
//                      DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════

const FONT_HEADING = '"Frank Ruhl Libre", "David Libre", serif';
const FONT_BODY = '"Heebo", "Assistant", system-ui, sans-serif';

function Btn({ children, onClick, variant = 'primary', disabled, size = 'md', className = '', type, title }) {
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3',
  };
  const variants = {
    primary: 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20 font-semibold',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
    ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
    outline: 'bg-transparent hover:bg-slate-800 text-slate-200 border border-slate-700',
    danger: 'bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-900/60',
    success: 'bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold',
  };
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      style={{ fontFamily: FONT_BODY }}
    >
      {children}
    </button>
  );
}

function Card({ children, className = '', padded = true }) {
  return (
    <div className={`bg-slate-900/60 backdrop-blur border border-slate-800 rounded-xl ${padded ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, className = '', ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none ${className}`}
      {...rest}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none resize-y"
    />
  );
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300',
    indigo: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    red: 'bg-red-500/15 text-red-300 border border-red-500/30',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${tones[tone]}`}>{children}</span>;
}

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className={`bg-slate-900 border border-slate-700 rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-xl'} w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
          <h3 className="text-xl font-bold" style={{ fontFamily: FONT_HEADING }}>{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Toggle({ options, value, onChange, multi = false }) {
  const selected = multi ? (value || []) : [value];
  const handle = (v) => {
    if (multi) {
      const cur = value || [];
      onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    } else {
      onChange(v);
    }
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            onClick={() => handle(o.id)}
            className={`text-right text-sm px-3 py-2 rounded-lg border transition ${on ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      ROOT APP
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const [view, setView] = useState({ name: 'loading' });
  const [trainer, setTrainer] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // RTL. גופנים: מקומיים בלבד (index.html) — אין טעינה מהרשת (SuperSuite, כלל 6)
  useEffect(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'he';

    // Print styles
    const printStyle = document.createElement('style');
    printStyle.textContent = `
      @media print {
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        body { background: white !important; color: black !important; }
        .print-page { page-break-after: always; background: white !important; }
        @page { size: A4; margin: 15mm; }
      }
      .print-only { display: none; }
    `;
    document.head.appendChild(printStyle);
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      const t = await S.get(K.trainer);
      setTrainer(t);
      const idx = (await S.get(K.clientIndex)) || [];
      const allClients = await Promise.all(idx.map((id) => S.get(K.client(id))));
      setClients(allClients.filter(Boolean));
      setLoading(false);
      if (!t) {
        setView({ name: 'trainer-setup' });
      } else {
        setView({ name: 'dashboard' });
      }
    })();
  }, []);

  const saveTrainer = async (t) => {
    await S.set(K.trainer, t);
    setTrainer(t);
  };

  const saveClient = async (c) => {
    await S.set(K.client(c.id), c);
    const idx = (await S.get(K.clientIndex)) || [];
    if (!idx.includes(c.id)) {
      idx.push(c.id);
      await S.set(K.clientIndex, idx);
    }
    setClients((prev) => {
      const filtered = prev.filter((p) => p.id !== c.id);
      return [...filtered, c];
    });
  };

  const deleteClient = async (id) => {
    await S.del(K.client(id));
    await S.del(K.program(id));
    await S.del(K.sessions(id));
    await S.del(K.measurements(id));
    await S.del(K.assessments(id));
    await S.del(K.memberships(id));
    const sch = (await S.get(K.schedule)) || [];
    await S.set(K.schedule, removeClientEverywhere(sch, id));
    const idx = (await S.get(K.clientIndex)) || [];
    await S.set(K.clientIndex, idx.filter((i) => i !== id));
    setClients((prev) => prev.filter((c) => c.id !== id));
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-indigo-400 flex items-center justify-center" style={{ fontFamily: FONT_BODY }}>טוען...</div>;
  }

  if (view.name === 'trainer-setup') {
    return <TrainerSetup onSave={async (t) => { await saveTrainer(t); setView({ name: 'dashboard' }); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: FONT_BODY }}>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden no-print" onClick={() => setSidebarOpen(false)} />
      )}
      <div className="flex">
        <Sidebar view={view} setView={(v) => { setView(v); setSidebarOpen(false); }} trainer={trainer} clientCount={clients.length} mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 min-h-screen md:mr-0">
          {/* Mobile top bar with hamburger */}
          <div className="md:hidden sticky top-0 z-20 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between no-print">
            <button onClick={() => setSidebarOpen(true)} className="text-slate-200 p-2 -mr-2" aria-label="פתח תפריט">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="flex items-center gap-2 text-indigo-400">
              <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor">
                <path d="M4 10 L10 10 L10 22 L4 22 Z M12 6 L18 6 L18 26 L12 26 Z M22 10 L28 10 L28 22 L22 22 Z" />
              </svg>
              <span className="font-bold" style={{ fontFamily: FONT_HEADING }}>TrainerPro</span>
            </div>
            <div className="w-8" />
          </div>

          {view.name === 'dashboard' && <Dashboard clients={clients} trainer={trainer} setView={setView} />}
          {view.name === 'schedule' && <ScheduleView clients={clients} setView={setView} />}
          {view.name === 'memberships' && <MembershipsView clients={clients} setView={setView} />}
          {view.name === 'reminders' && <RemindersView clients={clients} trainer={trainer} setView={setView} />}
          {view.name === 'clients' && <ClientsList clients={clients} setView={setView} onDelete={deleteClient} />}
          {view.name === 'client-new' && <ClientForm onSave={async (c) => { await saveClient(c); setView({ name: 'client-detail', id: c.id }); }} onCancel={() => setView({ name: 'clients' })} />}
          {view.name === 'client-detail' && <ClientDetail key={view.id + (view.tab || '')} clientId={view.id} initialTab={view.tab} clients={clients} trainer={trainer} setView={setView} saveClient={saveClient} onDelete={deleteClient} />}
          {view.name === 'library' && <LibraryView />}
          {view.name === 'templates' && <TemplatesView clients={clients} setView={setView} saveClient={saveClient} />}
          {view.name === 'nutrition' && <NutritionView />}
          {view.name === 'mobility' && <MobilityView />}
          {view.name === 'cardio' && <CardioView />}
          {view.name === 'knowledge' && <KnowledgeView />}
          {view.name === 'tools' && <ToolsView />}
          {view.name === 'settings' && <TrainerSettings trainer={trainer} onSave={saveTrainer} />}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      SIDEBAR
// ═══════════════════════════════════════════════════════════════════

function Sidebar({ view, setView, trainer, clientCount, mobileOpen, onClose }) {
  const items = [
    { id: 'dashboard', label: 'לוח בקרה', icon: '◉' },
    { id: 'clients', label: 'מתאמנים', icon: '❏', badge: clientCount },
    { id: 'schedule', label: 'יומן אימונים', icon: '📅' },
    { id: 'memberships', label: 'מנויים וגבייה', icon: '🎟' },
    { id: 'reminders', label: 'תזכורות', icon: '🔔' },
    { id: 'templates', label: 'תוכניות מוכנות', icon: '📋' },
    { id: 'library', label: 'ספריית תרגילים', icon: '≣' },
    { id: 'nutrition', label: 'תזונה', icon: '🥗' },
    { id: 'mobility', label: 'גמישות ויוגה', icon: '🧘' },
    { id: 'cardio', label: 'קרדיו', icon: '🏃' },
    { id: 'knowledge', label: 'ידע מקצועי', icon: '📚' },
    { id: 'tools', label: 'כלים', icon: '🛠' },
    { id: 'settings', label: 'הגדרות', icon: '⚙' },
  ];

  return (
    <aside className={`fixed md:static w-64 bg-slate-900 border-l border-slate-800 min-h-screen flex flex-col no-print z-40 transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`} style={{ right: 0 }}>
      <div className="p-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M4 10 L10 10 L10 22 L4 22 Z M12 6 L18 6 L18 26 L12 26 Z M22 10 L28 10 L28 22 L22 22 Z" fill="currentColor" />
            </svg>
            <span className="text-lg font-bold" style={{ fontFamily: FONT_HEADING }}>TrainerPro</span>
          </div>
          {trainer && <div className="text-xs text-slate-500 mt-2">{trainer.businessName || trainer.name}</div>}
        </div>
        <button onClick={onClose} className="md:hidden text-slate-400 hover:text-slate-200 text-2xl leading-none" aria-label="סגור תפריט">×</button>
      </div>

      <nav className="flex-1 p-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setView({ name: item.id })}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg mb-1 transition ${view.name === item.id || (item.id === 'clients' && view.name.startsWith('client')) ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg text-indigo-400">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </div>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{item.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
        <div>גרסה 1.0</div>
        <div className="mt-1">כלי ניהול למאמני כושר</div>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      TRAINER SETUP (onboarding)
// ═══════════════════════════════════════════════════════════════════

function TrainerSetup({ onSave }) {
  const [data, setData] = useState({
    name: '',
    businessName: '',
    phone: '',
    email: '',
    certification: '',
    bio: '',
  });
  const canSave = data.name.trim();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8" style={{ fontFamily: FONT_BODY }}>
      <div className="max-w-xl w-full">
        <div className="text-indigo-400 mb-8">
          <div className="text-3xl font-bold mb-2" style={{ fontFamily: FONT_HEADING }}>ברוך הבא ל-TrainerPro</div>
          <div className="text-sm text-slate-400">הגדרה ראשונית של הפרופיל שלך</div>
        </div>

        <Card>
          <div className="space-y-4">
            <Field label="שם מלא" required>
              <Input value={data.name} onChange={(v) => setData({ ...data, name: v })} placeholder="השם שלך" />
            </Field>
            <Field label="שם עסק / סטודיו">
              <Input value={data.businessName} onChange={(v) => setData({ ...data, businessName: v })} placeholder='לדוגמה: "סטודיו כושר שמחה"' />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="טלפון">
                <Input value={data.phone} onChange={(v) => setData({ ...data, phone: v })} type="tel" />
              </Field>
              <Field label="אימייל">
                <Input value={data.email} onChange={(v) => setData({ ...data, email: v })} type="email" />
              </Field>
            </div>
            <Field label="הסמכות מקצועיות">
              <Input value={data.certification} onChange={(v) => setData({ ...data, certification: v })} placeholder='לדוגמה: "מאמן כושר מוסמך וינגייט, מעסה רפואי"' />
            </Field>
            <Field label="משפט קצר על עצמך (מופיע ב-PDF)">
              <Textarea value={data.bio} onChange={(v) => setData({ ...data, bio: v })} placeholder="למשל: מתמחה באימונים פונקציונליים ושיקומיים" />
            </Field>
          </div>

          <div className="mt-6 text-xs text-slate-500 leading-relaxed">
            ✓ כל הנתונים נשמרים מקומית בדפדפן. שום דבר לא נשלח לשרת.
          </div>

          <div className="mt-6 flex justify-end">
            <Btn variant="primary" disabled={!canSave} onClick={() => onSave(data)}>
              שמור והמשך ←
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function Dashboard({ clients, trainer, setView }) {
  const [stats, setStats] = useState({ sessionsWeek: 0, sessionsMonth: 0, inactive: [] });

  useEffect(() => {
    (async () => {
      let weekCount = 0, monthCount = 0;
      const inactive = [];
      const now = Date.now();
      const week = 7 * 24 * 3600 * 1000;
      const month = 30 * 24 * 3600 * 1000;

      for (const c of clients) {
        const sess = (await S.get(K.sessions(c.id))) || [];
        let lastSession = 0;
        sess.forEach((s) => {
          const t = new Date(s.completedAt).getTime();
          if (now - t < week) weekCount++;
          if (now - t < month) monthCount++;
          if (t > lastSession) lastSession = t;
        });
        if (lastSession === 0 || (now - lastSession > 7 * 24 * 3600 * 1000)) {
          inactive.push({ ...c, lastSession });
        }
      }
      setStats({ sessionsWeek: weekCount, sessionsMonth: monthCount, inactive: inactive.slice(0, 5) });
    })();
  }, [clients]);

  const goalCounts = useMemo(() => {
    const counts = {};
    clients.forEach((c) => { counts[c.goal] = (counts[c.goal] || 0) + 1; });
    return counts;
  }, [clients]);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6 md:mb-8">
        <div className="text-xs text-indigo-400 tracking-widest mb-1">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: FONT_HEADING }}>לוח בקרה</h1>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <StatCard title="מתאמנים פעילים" value={clients.length} onClick={() => setView({ name: 'clients' })} />
        <StatCard title="אימונים השבוע" value={stats.sessionsWeek} />
        <StatCard title="אימונים החודש" value={stats.sessionsMonth} />
        <StatCard title="לא התאמנו 7+ ימים" value={stats.inactive.length} tone={stats.inactive.length > 0 ? 'amber' : 'normal'} />
      </div>

      <TodayPanel clients={clients} trainer={trainer} setView={setView} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6 md:mb-8">
        {/* Goal distribution */}
        <Card>
          <h3 className="text-sm text-slate-400 mb-4 tracking-wide">פילוח לפי מטרה</h3>
          {Object.keys(goalCounts).length === 0 ? (
            <div className="text-slate-500 text-sm">אין נתונים עדיין</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(goalCounts).sort((a, b) => b[1] - a[1]).map(([g, n]) => {
                const goal = GOALS.find((x) => x.id === g);
                const pct = (n / clients.length) * 100;
                return (
                  <div key={g}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{goal?.label || g}</span>
                      <span className="text-slate-400">{n}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Inactive clients */}
        <Card>
          <h3 className="text-sm text-slate-400 mb-4 tracking-wide">דורשים תשומת לב</h3>
          {stats.inactive.length === 0 ? (
            <div className="text-slate-500 text-sm">
              {clients.length === 0 ? 'אין מתאמנים עדיין' : 'כל המתאמנים פעילים ✓'}
            </div>
          ) : (
            <div className="space-y-2">
              {stats.inactive.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setView({ name: 'client-detail', id: c.id })}
                  className="w-full flex justify-between items-center text-right p-2 hover:bg-slate-800 rounded-lg transition"
                >
                  <div>
                    <div className="text-sm">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {c.lastSession === 0 ? 'טרם התאמן' : `אימון אחרון: ${formatRelative(c.lastSession)}`}
                    </div>
                  </div>
                  <span className="text-amber-400 text-xs">←</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => setView({ name: 'client-new' })}>+ מתאמן חדש</Btn>
        <Btn variant="outline" onClick={() => setView({ name: 'schedule' })}>יומן אימונים</Btn>
        <Btn variant="outline" onClick={() => setView({ name: 'memberships' })}>מנויים וגבייה</Btn>
        <Btn variant="outline" onClick={() => setView({ name: 'clients' })}>רשימת מתאמנים</Btn>
        <Btn variant="outline" onClick={() => setView({ name: 'library' })}>ספריית תרגילים</Btn>
        <Btn variant="outline" onClick={() => setView({ name: 'tools' })}>טיימר</Btn>
      </div>

      <div className="mt-8">
        <h3 className="text-sm text-slate-400 tracking-wide mb-3">גישה מהירה</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button onClick={() => setView({ name: 'templates' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">📋</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>תוכניות מוכנות</div>
            <div className="text-xs text-slate-500">5×5, PPL, Upper/Lower ועוד</div>
          </button>
          <button onClick={() => setView({ name: 'nutrition' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">🥗</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>תזונה</div>
            <div className="text-xs text-slate-500">קלוריות, מקרו, תפריטים</div>
          </button>
          <button onClick={() => setView({ name: 'mobility' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">🧘</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>גמישות ויוגה</div>
            <div className="text-xs text-slate-500">שגרות והתאוששות</div>
          </button>
          <button onClick={() => setView({ name: 'cardio' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">🏃</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>קרדיו</div>
            <div className="text-xs text-slate-500">HIIT, ריצה, אזורי דופק</div>
          </button>
          <button onClick={() => setView({ name: 'knowledge' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">📚</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>ידע מקצועי</div>
            <div className="text-xs text-slate-500">פציעות, עקרונות, חימום</div>
          </button>
          <button onClick={() => setView({ name: 'tools' })} className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="text-2xl mb-1">🛠</div>
            <div className="font-semibold" style={{ fontFamily: FONT_HEADING }}>כלים</div>
            <div className="text-xs text-slate-500">1RM, טיימר, FMS, PAR-Q</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, tone = 'normal', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`bg-slate-900/60 border border-slate-800 rounded-xl p-5 text-right w-full ${onClick ? 'hover:border-indigo-600 transition cursor-pointer' : ''}`}>
      <div className={`text-3xl font-bold mb-1 ${tone === 'amber' ? 'text-amber-400' : 'text-indigo-400'}`} style={{ fontFamily: FONT_HEADING }}>{value}</div>
      <div className="text-xs text-slate-400">{title}</div>
    </Tag>
  );
}

function formatRelative(ts) {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 3600 * 1000));
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
  return `לפני ${Math.floor(days / 30)} חודשים`;
}

// ═══════════════════════════════════════════════════════════════════
//                      CLIENTS LIST
// ═══════════════════════════════════════════════════════════════════

function ClientsList({ clients, setView, onDelete }) {
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
                      <Btn size="sm" variant="danger" onClick={() => { if (confirm(`למחוק את ${c.name}?`)) onDelete(c.id); }} title="מחק">✕</Btn>
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

function ClientForm({ initial, onSave, onCancel }) {
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

function ClientDetail({ clientId, initialTab, clients, trainer, setView, saveClient, onDelete }) {
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
          <Btn variant="danger" onClick={() => { if (confirm(`למחוק לצמיתות את ${client.name} וכל הנתונים הקשורים?`)) { onDelete(client.id); setView({ name: 'clients' }); } }}>מחק</Btn>
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

// ─── Program tab ───
function ProgramTab({ client, program, trainer, onGenerate, onSave, onLogSession }) {
  const [logOpen, setLogOpen] = useState(null); // dayIndex
  const [logNotes, setLogNotes] = useState('');
  const [printMode, setPrintMode] = useState(false);

  if (!program) {
    return (
      <Card className="text-center py-12">
        <div className="text-slate-400 mb-4">טרם נוצרה תוכנית אימון עבור {client.name}</div>
        <Btn variant="primary" onClick={onGenerate}>✨ צור תוכנית אוטומטית</Btn>
        <div className="text-xs text-slate-500 mt-4">
          התוכנית תיבנה על בסיס המטרה, רמת הכושר, המצב הרפואי והציוד הזמין
        </div>
      </Card>
    );
  }

  const updateExercise = (dayIdx, exIdx, field, value) => {
    const newDays = [...program.days];
    newDays[dayIdx].exercises[exIdx] = { ...newDays[dayIdx].exercises[exIdx], [field]: value };
    onSave({ ...program, days: newDays });
  };

  const removeExercise = (dayIdx, exIdx) => {
    const newDays = [...program.days];
    newDays[dayIdx].exercises = newDays[dayIdx].exercises.filter((_, i) => i !== exIdx);
    onSave({ ...program, days: newDays });
  };

  return (
    <div>
      {/* Print mode */}
      {printMode && <PrintableProgram client={client} program={program} trainer={trainer} onClose={() => setPrintMode(false)} />}

      <div className="flex justify-between items-center mb-4 no-print flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold" style={{ fontFamily: FONT_HEADING }}>תוכנית אימון פעילה</h3>
          <div className="text-xs text-slate-500">עודכן: {new Date(program.createdAt).toLocaleDateString('he-IL')}</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="outline" size="sm" onClick={async () => {
            const text = programToPlainText(client, program, trainer);
            const ok = await copyToClipboard(text);
            alert(ok ? 'התוכנית הועתקה ללוח' : 'העתקה נכשלה');
          }}>📋 העתק</Btn>
          <Btn variant="outline" size="sm" onClick={() => {
            const text = programToPlainText(client, program, trainer);
            window.open(whatsappShareUrl(text, client.phone), '_blank');
          }}>💬 וואטסאפ</Btn>
          <Btn variant="outline" size="sm" onClick={() => {
            const text = programToPlainText(client, program, trainer);
            downloadText(text, `תוכנית-${client.name}-${new Date().toISOString().split('T')[0]}.txt`);
          }}>⬇ הורדה</Btn>
          <Btn variant="outline" onClick={() => setPrintMode(true)}>⎙ ייצוא PDF</Btn>
          <Btn variant="secondary" onClick={() => { if (confirm('ליצור תוכנית חדשה? הקיימת תימחק.')) onGenerate(); }}>↻ בנה מחדש</Btn>
        </div>
      </div>

      <div className="space-y-4 no-print">
        {program.days.map((day, dayIdx) => (
          <Card key={dayIdx}>
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-semibold text-indigo-300" style={{ fontFamily: FONT_HEADING }}>{day.name}</h4>
              <div className="flex gap-2">
                <Btn size="sm" variant="outline" onClick={() => { setLogOpen(dayIdx); setLogNotes(''); }}>
                  ✓ רישום ביצוע
                </Btn>
                <AddExerciseButton client={client} onAdd={(ex) => {
                  const newDays = [...program.days];
                  newDays[dayIdx].exercises.push(ex);
                  onSave({ ...program, days: newDays });
                }} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="text-right py-2 font-normal">תרגיל</th>
                    <th className="text-right py-2 font-normal w-16">סטים</th>
                    <th className="text-right py-2 font-normal w-24">חזרות/זמן</th>
                    <th className="text-right py-2 font-normal w-20">משקל</th>
                    <th className="text-right py-2 font-normal w-20">מנוחה</th>
                    <th className="text-right py-2 font-normal">הערות</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {day.exercises.map((ex, exIdx) => {
                    const data = EXERCISES.find((e) => e.id === ex.exerciseId);
                    if (!data) return null;
                    return (
                      <tr key={exIdx} className="border-b border-slate-800/50">
                        <td className="py-2">
                          <div className="font-semibold">{data.name}</div>
                          <div className="text-xs text-slate-500">{data.muscles.join(' · ')}</div>
                        </td>
                        <td><input type="number" value={ex.sets} onChange={(e) => updateExercise(dayIdx, exIdx, 'sets', parseInt(e.target.value, 10))} className="w-14 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" /></td>
                        <td>
                          {ex.duration !== null && ex.duration !== undefined ? (
                            <input type="number" value={ex.duration} onChange={(e) => updateExercise(dayIdx, exIdx, 'duration', parseInt(e.target.value, 10))} className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" title="שניות" />
                          ) : (
                            <input value={ex.reps || ''} onChange={(e) => updateExercise(dayIdx, exIdx, 'reps', e.target.value)} className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" placeholder="8-12" />
                          )}
                        </td>
                        <td><input value={ex.weight || ''} onChange={(e) => updateExercise(dayIdx, exIdx, 'weight', e.target.value)} className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" placeholder="ק&quot;ג" /></td>
                        <td><input type="number" value={ex.rest || 0} onChange={(e) => updateExercise(dayIdx, exIdx, 'rest', parseInt(e.target.value, 10))} className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" title="שניות" /></td>
                        <td><input value={ex.notes || ''} onChange={(e) => updateExercise(dayIdx, exIdx, 'notes', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" placeholder="טמפו, וריאציה..." /></td>
                        <td><button onClick={() => removeExercise(dayIdx, exIdx)} className="text-slate-500 hover:text-red-400 p-1" title="הסר">✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={logOpen !== null} onClose={() => setLogOpen(null)} title={logOpen !== null ? `רישום אימון — ${program.days[logOpen]?.name}` : ''}>
        <div className="space-y-4">
          <div className="text-sm text-slate-400">
            רישום ביצוע אימון בתאריך {new Date().toLocaleDateString('he-IL')}
          </div>
          <Field label="הערות מהאימון">
            <Textarea value={logNotes} onChange={setLogNotes} placeholder="איך הרגיש המתאמן, שיפורים, בעיות..." rows={5} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setLogOpen(null)}>ביטול</Btn>
            <Btn variant="success" onClick={() => { onLogSession(logOpen, logNotes); setLogOpen(null); }}>✓ רשום אימון</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AddExerciseButton({ client, onAdd }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const available = useMemo(() => filterExercises(client), [client]);
  const filtered = search
    ? available.filter((e) => e.name.includes(search) || e.muscles.some((m) => m.includes(search)))
    : available;

  return (
    <>
      <Btn size="sm" variant="outline" onClick={() => setOpen(true)}>+ הוסף תרגיל</Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="בחר תרגיל להוספה" wide>
        <Input value={search} onChange={setSearch} placeholder="חיפוש..." className="mb-4" />
        <div className="max-h-96 overflow-y-auto space-y-2">
          {filtered.map((ex) => (
            <button
              key={ex.id}
              onClick={() => {
                const params = GOAL_PARAMS[client.goal];
                const isTimed = ex.cat === 'core' || ex.cat === 'flex';
                onAdd({
                  exerciseId: ex.id,
                  sets: params.sets,
                  reps: isTimed ? null : `${params.repsMin}-${params.repsMax}`,
                  duration: isTimed ? 40 : null,
                  rest: params.rest,
                  weight: '',
                  notes: '',
                });
                setOpen(false);
              }}
              className="w-full text-right p-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold">{ex.name}</div>
                  <div className="text-xs text-slate-400">{ex.muscles.join(' · ')}</div>
                </div>
                <Badge tone="slate">{ex.part}</Badge>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
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

// ═══════════════════════════════════════════════════════════════════
//                      PRINTABLE PROGRAM (PDF export)
// ═══════════════════════════════════════════════════════════════════

function PrintableProgram({ client, program, trainer, onClose }) {
  const [showDetails, setShowDetails] = useState(true);
  const [showCover, setShowCover] = useState(true);

  return (
    <div>
      {/* Screen view: preview + controls */}
      <div className="fixed inset-0 bg-slate-900 z-40 overflow-y-auto no-print">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center z-10 flex-wrap gap-2">
          <div className="text-sm text-slate-400">תצוגה מקדימה — הדפסה / שמירה כ-PDF</div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={showCover} onChange={(e) => setShowCover(e.target.checked)} /> דף שער
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} /> כולל הוראות
            </label>
            <Btn variant="primary" onClick={() => window.print()}>⎙ הדפס / PDF</Btn>
            <Btn variant="outline" onClick={onClose}>סגור</Btn>
          </div>
        </div>
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          <div style={{ background: 'white', color: '#1e293b', padding: '40px', borderRadius: '8px' }}>
            <PrintContent client={client} program={program} trainer={trainer} showDetails={showDetails} showCover={showCover} />
          </div>
        </div>
      </div>

      {/* Print view */}
      <div className="print-only" style={{ background: 'white', color: '#1e293b', padding: '0', direction: 'rtl' }}>
        <PrintContent client={client} program={program} trainer={trainer} showDetails={showDetails} showCover={showCover} />
      </div>
    </div>
  );
}

function PrintContent({ client, program, trainer, showDetails = true, showCover = true }) {
  const warnings = getMedicalWarnings(client);
  return (
    <div style={{ fontFamily: FONT_BODY, color: '#0f172a', direction: 'rtl', lineHeight: 1.5 }}>
      {/* COVER PAGE */}
      {showCover && (
        <div className="print-page" style={{ minHeight: '90vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '40px 20px', borderBottom: '1px dashed #cbd5e1' }}>
          <div>
            <div style={{ borderBottom: '4px solid #4f46e5', paddingBottom: '12px', marginBottom: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: 900, fontFamily: FONT_HEADING, color: '#1e293b' }}>
                {trainer?.businessName || 'תוכנית אימון אישית'}
              </div>
              {trainer?.name && <div style={{ fontSize: '15px', color: '#475569', marginTop: '4px' }}>{trainer.name}</div>}
              {trainer?.certification && <div style={{ fontSize: '12px', color: '#64748b' }}>{trainer.certification}</div>}
            </div>
          </div>

          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '10px' }}>תוכנית אימון אישית עבור</div>
            <div style={{ fontSize: '48px', fontWeight: 900, fontFamily: FONT_HEADING, color: '#4f46e5', marginBottom: '20px' }}>
              {client.name}
            </div>
            <div style={{ display: 'inline-block', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '12px 24px', borderRadius: '8px' }}>
              <div style={{ fontSize: '13px', color: '#4338ca', marginBottom: '4px' }}>מטרה</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#3730a3' }}>{GOALS.find(g => g.id === client.goal)?.label}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '30px' }}>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>רמה</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{LEVELS.find(l => l.id === client.level)?.label}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>ימי אימון</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{client.daysPerWeek} בשבוע</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>תאריך</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{new Date().toLocaleDateString('he-IL')}</div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '30px', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
            {trainer?.phone && <div>{trainer.phone}</div>}
            {trainer?.email && <div>{trainer.email}</div>}
            <div style={{ marginTop: '6px', fontStyle: 'italic' }}>תוכנית זו הותאמה אישית ואינה תחליף להתייעצות רפואית.</div>
          </div>
        </div>
      )}

      {/* Compact header (when no cover) */}
      {!showCover && (
        <div style={{ borderBottom: '3px solid #4f46e5', paddingBottom: '16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: FONT_HEADING, color: '#1e293b' }}>
              {client.name}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>{trainer?.businessName || trainer?.name}</div>
          </div>
          <div style={{ textAlign: 'left', fontSize: '11px', color: '#64748b' }}>
            <div>{new Date().toLocaleDateString('he-IL')}</div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ border: '1px solid #fbbf24', background: '#fef3c7', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, marginBottom: '6px', color: '#92400e', fontSize: '14px' }}>⚠ הנחיות רפואיות חשובות</div>
          <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#78350f' }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: '3px' }}><strong>{w.condition}:</strong> {w.warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Days */}
      {program.days.map((day, dayIdx) => (
        <div key={dayIdx} style={{ marginBottom: '30px', pageBreakInside: 'avoid' }}>
          <div style={{ background: '#4f46e5', color: 'white', padding: '10px 16px', borderRadius: '6px', fontSize: '17px', fontWeight: 700, fontFamily: FONT_HEADING, marginBottom: '14px' }}>
            יום {dayIdx + 1} · {day.name}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: showDetails ? '12px' : '0' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', color: '#475569' }}>
                <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>תרגיל</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '50px' }}>סטים</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '80px' }}>חזרות</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '60px' }}>משקל</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '60px' }}>מנוחה</th>
              </tr>
            </thead>
            <tbody>
              {day.exercises.map((ex, exIdx) => {
                const data = EXERCISES.find((e) => e.id === ex.exerciseId);
                if (!data) return null;
                return (
                  <tr key={exIdx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{exIdx + 1}. {data.name}</div>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>{data.muscles.join(' · ')}</div>
                      {ex.notes && <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '3px' }}>📝 {ex.notes}</div>}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700 }}>{ex.sets}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>{ex.duration ? `${ex.duration}״` : ex.reps || '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>{ex.weight || '___'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>{ex.rest ? `${ex.rest}״` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Detailed instructions per exercise */}
          {showDetails && (
            <div style={{ background: '#f8fafc', borderRadius: '6px', padding: '12px', fontSize: '11px', pageBreakInside: 'auto' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#334155', marginBottom: '8px' }}>📖 הוראות ביצוע</div>
              {day.exercises.map((ex, exIdx) => {
                const data = EXERCISES.find((e) => e.id === ex.exerciseId);
                if (!data || !data.instructions) return null;
                return (
                  <div key={exIdx} style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: exIdx < day.exercises.length - 1 ? '1px dashed #cbd5e1' : 'none' }}>
                    <div style={{ fontWeight: 700, color: '#4f46e5', marginBottom: '4px' }}>{exIdx + 1}. {data.name}</div>
                    <ol style={{ margin: 0, paddingRight: '18px', color: '#334155' }}>
                      {data.instructions.map((s, i) => <li key={i} style={{ marginBottom: '2px' }}>{s}</li>)}
                    </ol>
                    {data.tips && (
                      <div style={{ marginTop: '6px', padding: '6px 8px', background: '#ecfdf5', borderRight: '3px solid #10b981', fontSize: '10px', color: '#064e3b' }}>
                        💡 {data.tips}
                      </div>
                    )}
                    {data.mistakes && data.mistakes.length > 0 && (
                      <div style={{ marginTop: '4px', fontSize: '10px', color: '#991b1b' }}>
                        <strong>טעויות נפוצות:</strong> {data.mistakes.join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Bio */}
      {trainer?.bio && (
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginTop: '24px', fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
          {trainer.bio}
        </div>
      )}

      {/* Footer disclaimer */}
      <div style={{ marginTop: '16px', fontSize: '10px', color: '#94a3b8', textAlign: 'center', borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
        תוכנית זו הותאמה אישית ואינה מהווה תחליף להתייעצות רפואית. יש לבצע חימום לפני כל אימון.
        {trainer?.phone && ` · לשאלות: ${trainer.phone}`}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      EXERCISE LIBRARY
// ═══════════════════════════════════════════════════════════════════

function LibraryView() {
  const [search, setSearch] = useState('');
  const [filterPart, setFilterPart] = useState('all');
  const [filterEq, setFilterEq] = useState('all');
  const [selected, setSelected] = useState(null);

  const parts = ['all', ...Array.from(new Set(EXERCISES.map((e) => e.part)))];

  const filtered = EXERCISES.filter((e) => {
    if (filterPart !== 'all' && e.part !== filterPart) return false;
    if (filterEq !== 'all' && !e.eq.includes(filterEq)) return false;
    if (search && !e.name.includes(search) && !e.muscles.some((m) => m.includes(search))) return false;
    return true;
  });

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>ספריית תרגילים</h1>
        <div className="text-sm text-slate-400">{EXERCISES.length} תרגילים · סינון לפי שריר וציוד</div>
      </header>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Input value={search} onChange={setSearch} placeholder="חיפוש לפי שם או שריר..." className="flex-1 min-w-[200px]" />
        <select value={filterPart} onChange={(e) => setFilterPart(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          {parts.map((p) => <option key={p} value={p}>{p === 'all' ? 'כל חלקי הגוף' : p}</option>)}
        </select>
        <select value={filterEq} onChange={(e) => setFilterEq(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">כל הציוד</option>
          {EQUIPMENT.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {filtered.map((ex) => (
          <button key={ex.id} onClick={() => setSelected(ex)}
            className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="flex justify-between items-start mb-2">
              <Badge tone="slate">{ex.part}</Badge>
              <Badge tone={ex.lvl === 'beginner' ? 'emerald' : ex.lvl === 'intermediate' ? 'amber' : 'red'}>
                {LEVELS.find((l) => l.id === ex.lvl)?.label}
              </Badge>
            </div>
            <div className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{ex.name}</div>
            <div className="text-xs text-slate-400">{ex.muscles.join(' · ')}</div>
          </button>
        ))}
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || ''} wide>
        {selected && (
          <div className="space-y-5">
            <div className="flex gap-2 flex-wrap">
              <Badge tone="indigo">{selected.part}</Badge>
              <Badge tone="slate">{selected.cat}</Badge>
              <Badge tone={selected.lvl === 'beginner' ? 'emerald' : selected.lvl === 'intermediate' ? 'amber' : 'red'}>
                {LEVELS.find((l) => l.id === selected.lvl)?.label}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-slate-400 text-xs mb-2">שרירים מעורבים</div>
                <div className="flex flex-wrap gap-1">{selected.muscles.map((m, i) => <Badge key={i} tone="slate">{m}</Badge>)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-2">ציוד נדרש</div>
                <div className="flex flex-wrap gap-1">{selected.eq.map((e) => <Badge key={e} tone="slate">{EQUIPMENT.find((x) => x.id === e)?.label}</Badge>)}</div>
              </div>
              {selected.contra?.length > 0 && (
                <div className="md:col-span-2">
                  <div className="text-red-400 text-xs mb-2">⛔ התוויות נגד</div>
                  <div className="flex flex-wrap gap-1">{selected.contra.map((c) => <Badge key={c} tone="red">{MEDICAL_CONDITIONS.find((m) => m.id === c)?.label}</Badge>)}</div>
                </div>
              )}
              {selected.cautions?.length > 0 && (
                <div className="md:col-span-2">
                  <div className="text-amber-400 text-xs mb-2">⚠ זהירות</div>
                  <div className="flex flex-wrap gap-1">{selected.cautions.map((c) => <Badge key={c} tone="amber">{MEDICAL_CONDITIONS.find((m) => m.id === c)?.label}</Badge>)}</div>
                </div>
              )}
            </div>

            {selected.instructions?.length > 0 && (
              <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
                <div className="text-indigo-300 font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>הוראות ביצוע</div>
                <ol className="space-y-2 text-sm text-slate-200">
                  {selected.instructions.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 text-xs flex items-center justify-center mt-0.5">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {selected.mistakes?.length > 0 && (
              <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-4">
                <div className="text-red-300 font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>טעויות נפוצות</div>
                <ul className="space-y-2 text-sm text-red-100/90">
                  {selected.mistakes.map((m, i) => (
                    <li key={i} className="flex gap-2"><span className="text-red-400">⚠</span><span>{m}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {selected.tips && (
              <div className="bg-emerald-950/20 border border-emerald-900/50 rounded-xl p-4">
                <div className="text-emerald-300 font-semibold mb-2" style={{ fontFamily: FONT_HEADING }}>💡 טיפים</div>
                <div className="text-sm text-emerald-100/90 leading-relaxed">{selected.tips}</div>
              </div>
            )}

            {selected.variations?.length > 0 && (
              <div>
                <div className="text-slate-400 text-xs mb-2">וריאציות</div>
                <div className="flex flex-wrap gap-2">
                  {selected.variations.map((v, i) => (
                    <span key={i} className="text-sm bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">{v}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.anatomy && (
              <div className="bg-slate-800/40 border-r-4 border-indigo-500 rounded p-3">
                <div className="text-xs text-slate-400 mb-1">אנטומיה</div>
                <div className="text-sm text-slate-200 leading-relaxed">{selected.anatomy}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                      TRAINER SETTINGS
// ═══════════════════════════════════════════════════════════════════

function TrainerSettings({ trainer, onSave }) {
  const [d, setD] = useState(trainer);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSave(d);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // גיבוי ושחזור — רק דרך הגיבוי המוצפן של SuperSuite (PLAN.md 3.4).
  // הייצוא הישן (JSON גלוי) הוסר; קבצים ישנים משוחזרים מהשחזור של התוכנה, אחרי בדיקת מבנה.

  const handleResetAll = () => {
    if (!confirm('פעולה זו תמחק את כל הנתונים — מתאמנים, תוכניות, מדידות, היסטוריה. האם להמשיך?')) return;
    if (!confirm('בטוח לחלוטין? הפעולה בלתי הפיכה.')) return;
    localStorage.clear();
    window.location.reload();
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-3xl md:text-4xl font-bold mb-6" style={{ fontFamily: FONT_HEADING }}>הגדרות</h1>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-4 tracking-wide">פרופיל מאמן</h3>
        <div className="space-y-3">
          <Field label="שם מלא">
            <Input value={d.name} onChange={(v) => setD({ ...d, name: v })} />
          </Field>
          <Field label="שם עסק / סטודיו">
            <Input value={d.businessName} onChange={(v) => setD({ ...d, businessName: v })} />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="טלפון"><Input type="tel" value={d.phone} onChange={(v) => setD({ ...d, phone: v })} /></Field>
            <Field label="אימייל"><Input type="email" value={d.email} onChange={(v) => setD({ ...d, email: v })} /></Field>
          </div>
          <Field label="הסמכות מקצועיות">
            <Input value={d.certification} onChange={(v) => setD({ ...d, certification: v })} />
          </Field>
          <Field label="משפט קצר על עצמך (מופיע ב-PDF)">
            <Textarea value={d.bio} onChange={(v) => setD({ ...d, bio: v })} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end items-center gap-3">
          {saved && <span className="text-emerald-400 text-sm">✓ נשמר</span>}
          <Btn variant="primary" onClick={handleSave}>שמור</Btn>
        </div>
      </Card>

      <Card className="mb-4">
        <h3 className="text-sm text-slate-400 mb-2 tracking-wide">גיבוי ושחזור</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          כל הנתונים שלך נשמרים במכשיר הזה בלבד, מוצפנים. לגיבוי: כפתור "גיבוי מוצפן" (⬇) בסרגל של התוכנה או Ctrl+Shift+B, ובחירה ב"ניהול אימונים בלבד". לשחזור: הכפתור ↥ לידו או Ctrl+Shift+R.
          הגיבוי מוצפן בסיסמה, ומאפשר להעביר נתונים בין מכשירים (מחשב ↔ טלפון). גם קובץ גיבוי ישן (JSON) של ניהול האימונים משוחזר משם.
        </p>
      </Card>

      <Card className="border-red-900/40">
        <h3 className="text-sm text-red-400 mb-2 tracking-wide">אזור מסוכן</h3>
        <p className="text-xs text-slate-500 mb-4">
          מחיקה מלאה של כל הנתונים. מומלץ ליצור גיבוי לפני.
        </p>
        <Btn variant="danger" onClick={handleResetAll}>מחק הכל</Btn>
      </Card>

      <div className="mt-6 text-xs text-slate-600 text-center leading-relaxed">
        <p>TrainerPro · גרסה 1.0</p>
        <p>כל הנתונים מאוחסנים מקומית במכשיר. שום מידע לא נשלח לשרת.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: NUTRITION VIEW (global)
// ═══════════════════════════════════════════════════════════════════

function NutritionView() {
  const [tab, setTab] = useState('calculator');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>תזונה</h1>
        <div className="text-sm text-slate-400">מחשבון קלוריות, מאגר מאכלים, תפריטים וטיפים</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: 'calculator', label: 'מחשבון' },
          { id: 'foods', label: 'מאגר מאכלים' },
          { id: 'plans', label: 'תפריטים לדוגמה' },
          { id: 'tips', label: 'טיפים' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calculator' && <NutritionCalculator />}
      {tab === 'foods' && <FoodDatabase />}
      {tab === 'plans' && <MealPlansList />}
      {tab === 'tips' && <NutritionTipsList />}
    </div>
  );
}

function NutritionCalculator() {
  const [data, setData] = useState({
    gender: 'male', age: 30, weight: 75, height: 175,
    activity: 'moderate', goal: 'health',
  });

  const bmr = calculateBMR({ weight: +data.weight, height: +data.height, age: +data.age, gender: data.gender });
  const activity = ACTIVITY_LEVELS.find(a => a.id === data.activity);
  const tdee = bmr ? calculateTDEE(bmr, activity?.mult || 1.2) : 0;
  const targetCal = tdee ? calculateGoalCalories(tdee, data.goal) : 0;
  const macros = targetCal ? calculateMacros(targetCal, +data.weight, data.goal) : { protein: 0, carbs: 0, fat: 0 };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>פרטים</h3>
        <div className="space-y-4">
          <Field label="מין">
            <Toggle options={[{ id: 'male', label: 'זכר' }, { id: 'female', label: 'נקבה' }]} value={data.gender} onChange={(v) => setData({ ...data, gender: v })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="גיל"><Input type="number" value={data.age} onChange={(v) => setData({ ...data, age: v })} /></Field>
            <Field label="משקל (ק״ג)"><Input type="number" value={data.weight} onChange={(v) => setData({ ...data, weight: v })} /></Field>
            <Field label="גובה (ס״מ)"><Input type="number" value={data.height} onChange={(v) => setData({ ...data, height: v })} /></Field>
          </div>
          <Field label="רמת פעילות">
            <select value={data.activity} onChange={(e) => setData({ ...data, activity: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm">
              {ACTIVITY_LEVELS.map(a => <option key={a.id} value={a.id}>{a.label} - {a.desc}</option>)}
            </select>
          </Field>
          <Field label="מטרה">
            <select value={data.goal} onChange={(e) => setData({ ...data, goal: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm">
              {GOALS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>תוצאות</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/40 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-400">BMR</div>
              <div className="text-2xl font-bold text-indigo-300">{bmr}</div>
              <div className="text-xs text-slate-500">קלוריות במנוחה</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-400">TDEE</div>
              <div className="text-2xl font-bold text-indigo-300">{tdee}</div>
              <div className="text-xs text-slate-500">תצרוכת יומית</div>
            </div>
            <div className="bg-emerald-900/30 rounded-lg p-3 text-center border border-emerald-800/50">
              <div className="text-xs text-emerald-400">יעד</div>
              <div className="text-2xl font-bold text-emerald-300">{targetCal}</div>
              <div className="text-xs text-emerald-500/70">קלוריות ליום</div>
            </div>
          </div>

          <div>
            <div className="text-sm text-slate-400 mb-2">חלוקת מקרו-נוטריינטים</div>
            <div className="space-y-2">
              <div className="bg-slate-800/40 rounded-lg p-3 flex justify-between items-center">
                <div><div className="font-semibold">חלבון</div><div className="text-xs text-slate-400">{(macros.protein * 4)} קלוריות</div></div>
                <div className="text-2xl font-bold text-red-300">{macros.protein}<span className="text-sm text-slate-400 mr-1">גרם</span></div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 flex justify-between items-center">
                <div><div className="font-semibold">פחמימות</div><div className="text-xs text-slate-400">{(macros.carbs * 4)} קלוריות</div></div>
                <div className="text-2xl font-bold text-amber-300">{macros.carbs}<span className="text-sm text-slate-400 mr-1">גרם</span></div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 flex justify-between items-center">
                <div><div className="font-semibold">שומן</div><div className="text-xs text-slate-400">{(macros.fat * 9)} קלוריות</div></div>
                <div className="text-2xl font-bold text-emerald-300">{macros.fat}<span className="text-sm text-slate-400 mr-1">גרם</span></div>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-800">
            ⓘ נוסחת Mifflin-St Jeor. תוצאות אינן תחליף לייעוץ דיאטני מקצועי.
          </div>
        </div>
      </Card>
    </div>
  );
}

function FoodDatabase() {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const cats = [
    { id: 'all', label: 'הכל' },
    { id: 'protein', label: 'חלבונים' },
    { id: 'carb', label: 'פחמימות' },
    { id: 'veg', label: 'ירקות' },
    { id: 'fruit', label: 'פירות' },
    { id: 'fat', label: 'שומנים' },
    { id: 'mixed', label: 'מנות מוכנות' },
    { id: 'shabbat', label: 'שבת וחג' },
  ];
  const filtered = FOODS.filter(f => {
    if (cat !== 'all' && f.cat !== cat) return false;
    if (search && !f.name.includes(search)) return false;
    return true;
  });
  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <Input value={search} onChange={setSearch} placeholder="חיפוש מאכל..." className="flex-1 min-w-[200px]" />
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div className="text-sm text-slate-400 mb-3">{filtered.length} פריטים · ערכים ממוצעים — למוצר מסוים קובעת התווית שלו</div>
      <Card padded={false} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400 text-xs">
            <tr>
              <th className="text-right px-3 py-2">מאכל</th>
              <th className="text-right px-3 py-2">מנה</th>
              <th className="text-center px-3 py-2">קלוריות</th>
              <th className="text-center px-3 py-2">חלבון</th>
              <th className="text-center px-3 py-2">פחמ׳</th>
              <th className="text-center px-3 py-2">שומן</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => (
              <tr key={f.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-medium">{f.name}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{f.unit}</td>
                <td className="px-3 py-2 text-center text-indigo-300 font-semibold">{f.kcal}</td>
                <td className="px-3 py-2 text-center text-red-300">{f.p}</td>
                <td className="px-3 py-2 text-center text-amber-300">{f.c}</td>
                <td className="px-3 py-2 text-center text-emerald-300">{f.f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function MealPlansList() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {MEAL_PLANS.map(plan => (
          <button key={plan.id} onClick={() => setOpen(plan)}
            className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-indigo-600 transition">
            <Badge tone="indigo">{GOALS.find(g => g.id === plan.goal)?.label}</Badge>
            <div className="font-semibold mt-3 mb-1" style={{ fontFamily: FONT_HEADING }}>{plan.name}</div>
            <div className="text-xs text-slate-400">יעד: {plan.targetCal} קלוריות ליום</div>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name || ''} wide>
        {open && (
          <div className="space-y-4">
            <Badge tone="indigo">{open.targetCal} קלוריות ליום</Badge>
            {open.days.map((day, di) => (
              <div key={di}>
                <h4 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>{day.name}</h4>
                <div className="space-y-3">
                  {day.meals.map((meal, mi) => (
                    <div key={mi} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-semibold text-indigo-300">{meal.name}</div>
                        <div className="text-sm text-slate-400">
                          {meal.kcal} קלו׳ · {meal.p}ח · {meal.c}פ · {meal.f}ש
                        </div>
                      </div>
                      <ul className="text-sm space-y-1 text-slate-200">
                        {meal.items.map((item, ii) => (
                          <li key={ii} className="flex gap-2"><span className="text-slate-500">·</span>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {day.notes && (
                  <div className="mt-3 bg-amber-950/20 border border-amber-900/40 rounded-lg p-3 text-sm text-amber-100/80">
                    💡 {day.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function NutritionTipsList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {NUTRITION_TIPS.map((tip, i) => (
        <Card key={i}>
          <h4 className="font-semibold text-indigo-300 mb-2" style={{ fontFamily: FONT_HEADING }}>{tip.title}</h4>
          <p className="text-sm text-slate-300 leading-relaxed">{tip.body}</p>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════

function KnowledgeView() {
  const [tab, setTab] = useState('warmup');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>ידע מקצועי</h1>
        <div className="text-sm text-slate-400">חימום, פציעות, עקרונות אימון וטכניקות מתקדמות</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: 'warmup', label: 'חימום וקירור' },
          { id: 'injuries', label: 'פציעות' },
          { id: 'principles', label: 'עקרונות אימון' },
          { id: 'techniques', label: 'טכניקות מתקדמות' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'warmup' && <WarmupList />}
      {tab === 'injuries' && <InjuriesList />}
      {tab === 'principles' && <PrinciplesList />}
      {tab === 'techniques' && <TechniquesList />}
    </div>
  );
}

function WarmupList() {
  return (
    <div className="space-y-4">
      {WARMUP_PROTOCOLS.map(p => (
        <Card key={p.id}>
          <div className="flex justify-between items-start mb-3">
            <div>
              <h4 className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{p.name}</h4>
              <Badge tone="indigo">{p.suitable}</Badge>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400">
                <tr><th className="text-right py-1">תרגיל</th><th className="text-right py-1">משך</th><th className="text-right py-1 hidden md:table-cell">הערות</th></tr>
              </thead>
              <tbody>
                {p.steps.map((s, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="py-2 font-medium">{s.name}</td>
                    <td className="py-2 text-indigo-300">{s.duration}</td>
                    <td className="py-2 text-xs text-slate-400 hidden md:table-cell">{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function InjuriesList() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-4 mb-4 text-sm text-amber-100/80">
        ⚠ המידע כאן מיועד לידע כללי. בכל מקרה של כאב מתמשך או חמור — הפנה את המתאמן לרופא או פיזיותרפיסט מוסמך.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {INJURIES.map(inj => (
          <button key={inj.id} onClick={() => setOpen(inj)}
            className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-indigo-600 transition">
            <div className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{inj.name}</div>
            <div className="text-xs text-slate-400">{inj.causes.split(',')[0]}...</div>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name || ''} wide>
        {open && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-slate-400 mb-1">סיבות נפוצות</div>
              <div className="text-slate-200">{open.causes}</div>
            </div>
            <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3">
              <div className="text-xs text-red-300 mb-1">🚩 דגלים אדומים — דורש בדיקה רפואית</div>
              <div className="text-red-100/90">{open.redFlags}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-2">פעולה מיידית</div>
              <ol className="space-y-1">
                {open.immediateAction.map((a, i) => (
                  <li key={i} className="flex gap-2"><span className="text-indigo-400 font-semibold">{i + 1}.</span>{a}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className="text-xs text-emerald-400 mb-2">תרגילי שיקום</div>
              <div className="flex flex-wrap gap-2">
                {open.rehabExercises.map((e, i) => (
                  <span key={i} className="bg-emerald-900/30 border border-emerald-800/40 px-3 py-1 rounded-lg text-emerald-200 text-sm">{e}</span>
                ))}
              </div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">💡 מניעה</div>
              <div className="text-slate-200">{open.preventionTips}</div>
            </div>
            <div>
              <div className="text-xs text-red-400 mb-2">⛔ תרגילים להימנע</div>
              <div className="flex flex-wrap gap-1">
                {open.avoidExercises.map((e, i) => <Badge key={i} tone="red">{e}</Badge>)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrinciplesList() {
  return (
    <div className="space-y-3">
      {TRAINING_PRINCIPLES.map(p => (
        <Card key={p.id}>
          <h4 className="font-semibold mb-2 text-indigo-300" style={{ fontFamily: FONT_HEADING }}>{p.title}</h4>
          <p className="text-sm text-slate-300 leading-relaxed">{p.body}</p>
        </Card>
      ))}
    </div>
  );
}

function TechniquesList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {ADVANCED_TECHNIQUES.map(t => (
        <Card key={t.id}>
          <h4 className="font-semibold mb-2" style={{ fontFamily: FONT_HEADING }}>{t.title}</h4>
          <p className="text-sm text-slate-300 leading-relaxed mb-3">{t.body}</p>
          <Badge tone="indigo">מתי להשתמש: {t.when}</Badge>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: TOOLS VIEW
// ═══════════════════════════════════════════════════════════════════

function ToolsView() {
  const [tab, setTab] = useState('1rm');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>כלים מקצועיים</h1>
        <div className="text-sm text-slate-400">מחשבון 1RM, הערכות תפקודיות, טפסי PAR-Q</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: '1rm', label: 'מחשבון 1RM' },
          { id: 'timer', label: 'טיימר אימון' },
          { id: 'fms', label: 'הערכת תנועה (FMS-Lite)' },
          { id: 'parq', label: 'טופס PAR-Q' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === '1rm' && <OneRMCalculator />}
      {tab === 'timer' && <IntervalTimer />}
      {tab === 'fms' && <FMSAssessment />}
      {tab === 'parq' && <PARQForm />}
    </div>
  );
}

function OneRMCalculator() {
  const [weight, setWeight] = useState(80);
  const [reps, setReps] = useState(5);
  const oneRM = calculate1RM(+weight, +reps);
  const pcts = calculatePercentages(oneRM);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card>
        <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>חישוב 1RM</h3>
        <div className="space-y-4">
          <Field label="משקל (ק״ג)"><Input type="number" value={weight} onChange={setWeight} /></Field>
          <Field label="חזרות (1-12)"><Input type="number" value={reps} onChange={setReps} /></Field>
          <div className="bg-emerald-900/30 border border-emerald-800/50 rounded-lg p-4 text-center">
            <div className="text-xs text-emerald-400 mb-1">1RM משוער</div>
            <div className="text-4xl font-bold text-emerald-300">{oneRM || '—'}</div>
            <div className="text-xs text-emerald-500/70">ק״ג</div>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed">
            ⓘ נוסחת Brzycki. דיוק יורד מעל 5-6 חזרות. ב-12+ חזרות הנוסחה לא רלוונטית.
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>טבלת אחוזים מ-1RM</h3>
        {oneRM ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-right py-2">אחוז</th>
                  <th className="text-right py-2">משקל</th>
                  <th className="text-right py-2">חזרות</th>
                  <th className="text-right py-2 hidden md:table-cell">מטרה</th>
                </tr>
              </thead>
              <tbody>
                {pcts.map(p => (
                  <tr key={p.pct} className="border-b border-slate-800/50">
                    <td className="py-2 text-indigo-300 font-semibold">{p.pct}%</td>
                    <td className="py-2">{p.weight} ק״ג</td>
                    <td className="py-2">{p.reps}</td>
                    <td className="py-2 text-xs text-slate-400 hidden md:table-cell">{p.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">הזן משקל וחזרות לקבלת חישוב</div>
        )}
      </Card>
    </div>
  );
}

function FMSAssessment() {
  const [scores, setScores] = useState({});
  const total = Object.values(scores).reduce((a, b) => a + (b || 0), 0);
  const max = ASSESSMENTS.length * 3;
  const pct = Math.round((total / max) * 100);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 flex justify-between items-center">
        <div>
          <div className="text-sm text-slate-400">ציון כולל</div>
          <div className="text-3xl font-bold text-indigo-300">{total}/{max} <span className="text-base text-slate-400">({pct}%)</span></div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">{Object.keys(scores).length}/{ASSESSMENTS.length} מבחנים הושלמו</div>
          {pct >= 80 && <Badge tone="emerald">ציון מעולה</Badge>}
          {pct >= 60 && pct < 80 && <Badge tone="indigo">ציון טוב</Badge>}
          {pct >= 40 && pct < 60 && <Badge tone="amber">דורש שיפור</Badge>}
          {pct < 40 && Object.keys(scores).length === ASSESSMENTS.length && <Badge tone="red">סיכון גבוה</Badge>}
        </div>
      </div>

      {ASSESSMENTS.map(a => (
        <Card key={a.id}>
          <h4 className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{a.name}</h4>
          <div className="text-xs text-slate-400 mb-3">{a.purpose}</div>
          <div className="bg-slate-800/40 rounded-lg p-3 mb-3">
            <div className="text-xs text-slate-400 mb-2">הוראות ביצוע</div>
            <ol className="text-sm space-y-1 text-slate-200">
              {a.instructions.map((s, i) => <li key={i} className="flex gap-2"><span className="text-indigo-400">{i + 1}.</span>{s}</li>)}
            </ol>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-2">ציון</div>
            <div className="space-y-1">
              {a.scoring.map(s => (
                <button key={s.score} onClick={() => setScores({ ...scores, [a.id]: s.score })}
                  className={`w-full text-right px-3 py-2 rounded-lg border transition ${scores[a.id] === s.score ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800/30 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
                  <div className="flex gap-3 items-start">
                    <span className="font-bold text-lg">{s.score}</span>
                    <span className="text-sm">{s.criteria}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function PARQForm() {
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [answers, setAnswers] = useState({});

  const printForm = () => window.print();

  return (
    <div>
      <Card className="mb-4 no-print">
        <h3 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>טופס שאלון בריאות (PAR-Q)</h3>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          טופס סטנדרטי שמלא כל מתאמן לפני תחילת תוכנית אימונים. תשובה "כן" לאחת השאלות מחייבת אישור רופא לפני התחלת אימונים.
        </p>
        <div className="flex gap-3">
          <Btn variant="primary" onClick={printForm}>🖨 הדפסה</Btn>
        </div>
      </Card>

      <div className="bg-white text-slate-900 p-8 rounded-xl print-page" style={{ fontFamily: FONT_BODY }}>
        <h2 className="text-2xl font-bold mb-2 text-center" style={{ fontFamily: FONT_HEADING }}>שאלון התאמה לפעילות גופנית</h2>
        <div className="text-center text-sm text-slate-600 mb-6">PAR-Q — Physical Activity Readiness Questionnaire</div>
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <label className="block text-xs text-slate-500 mb-1">שם מלא</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-slate-300 px-3 py-1.5 rounded text-slate-900" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">תאריך</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-300 px-3 py-1.5 rounded text-slate-900" />
          </div>
        </div>

        <div className="text-sm text-slate-700 mb-4">
          השב על השאלות הבאות בכן או לא:
        </div>

        <div className="space-y-3 mb-6">
          {PARQ_QUESTIONS.map((q, i) => (
            <div key={i} className="border border-slate-200 rounded p-3">
              <div className="text-sm mb-2"><strong>{i + 1}.</strong> {q}</div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" name={`q${i}`} checked={answers[i] === 'yes'} onChange={() => setAnswers({ ...answers, [i]: 'yes' })} /> כן
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" name={`q${i}`} checked={answers[i] === 'no'} onChange={() => setAnswers({ ...answers, [i]: 'no' })} /> לא
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t-2 border-slate-300 pt-4 text-xs text-slate-600 leading-relaxed">
          <p className="mb-2"><strong>הצהרה:</strong> אני מצהיר/ה כי המידע שמסרתי בטופס זה נכון. אני מבין/ה כי תשובה חיובית לאחת השאלות מחייבת אישור רופא לפני התחלת תוכנית אימונים.</p>
          <div className="grid grid-cols-2 gap-8 mt-6">
            <div>
              <div className="border-t border-slate-400 pt-1">חתימת המתאמן</div>
            </div>
            <div>
              <div className="border-t border-slate-400 pt-1">תאריך</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//             NEW: PER-CLIENT NUTRITION TAB
// ═══════════════════════════════════════════════════════════════════

function ClientNutritionTab({ client }) {
  const [printMode, setPrintMode] = useState(false);
  const activity = ACTIVITY_LEVELS.find(a => a.id === (client.activityLevel || 'moderate'));
  const bmr = calculateBMR({
    weight: +client.weight, height: +client.height, age: +client.age, gender: client.gender,
  });
  const tdee = bmr ? calculateTDEE(bmr, activity?.mult || 1.55) : 0;
  const targetCal = tdee ? calculateGoalCalories(tdee, client.goal) : 0;
  const macros = targetCal ? calculateMacros(targetCal, +client.weight, client.goal) : { protein: 0, carbs: 0, fat: 0 };

  const hasData = client.weight && client.height && client.age;

  if (!hasData) {
    return (
      <Card>
        <div className="text-sm text-slate-400">חסר משקל / גובה / גיל לחישוב יעדי תזונה. עדכן בעריכת המתאמן.</div>
      </Card>
    );
  }

  if (printMode) {
    return <PrintableNutrition client={client} bmr={bmr} tdee={tdee} targetCal={targetCal} macros={macros} activity={activity} onClose={() => setPrintMode(false)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 flex-wrap">
        <Btn variant="outline" size="sm" onClick={() => setPrintMode(true)}>⎙ ייצוא PDF תזונתי</Btn>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-800/40 rounded-lg p-4 text-center">
          <div className="text-xs text-slate-400">BMR (במנוחה)</div>
          <div className="text-3xl font-bold text-indigo-300 mt-1">{bmr}</div>
          <div className="text-xs text-slate-500">קלוריות ליום</div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-4 text-center">
          <div className="text-xs text-slate-400">TDEE (תצרוכת)</div>
          <div className="text-3xl font-bold text-indigo-300 mt-1">{tdee}</div>
          <div className="text-xs text-slate-500">לפי {activity?.label}</div>
        </div>
        <div className="bg-emerald-900/30 border border-emerald-800/50 rounded-lg p-4 text-center">
          <div className="text-xs text-emerald-400">יעד יומי</div>
          <div className="text-3xl font-bold text-emerald-300 mt-1">{targetCal}</div>
          <div className="text-xs text-emerald-500/70">{GOALS.find(g => g.id === client.goal)?.label}</div>
        </div>
      </div>

      <Card>
        <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>חלוקת מקרו-נוטריינטים</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/40 rounded-lg p-4 text-center">
            <div className="text-xs text-red-400 mb-1">חלבון</div>
            <div className="text-2xl font-bold text-red-300">{macros.protein}</div>
            <div className="text-xs text-slate-500">גרם · {macros.protein * 4} קל׳</div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-4 text-center">
            <div className="text-xs text-amber-400 mb-1">פחמימות</div>
            <div className="text-2xl font-bold text-amber-300">{macros.carbs}</div>
            <div className="text-xs text-slate-500">גרם · {macros.carbs * 4} קל׳</div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-4 text-center">
            <div className="text-xs text-emerald-400 mb-1">שומן</div>
            <div className="text-2xl font-bold text-emerald-300">{macros.fat}</div>
            <div className="text-xs text-slate-500">גרם · {macros.fat * 9} קל׳</div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>הנחיות אישיות</h3>
        <ul className="space-y-2 text-sm text-slate-300">
          <li>· חלבון: {Math.round(macros.protein / +client.weight * 10) / 10} גרם לק״ג משקל גוף</li>
          <li>· פיזור חלבון על פני 4-5 ארוחות ({Math.round(macros.protein / 4)} גרם לארוחה)</li>
          <li>· מים: {Math.round(+client.weight * 35 / 100) / 10} ליטר ביום + 500 מ״ל לכל שעת אימון</li>
          {client.goal === 'weight-loss' && <li>· גירעון של 500 קל׳ ליום ⇐ ירידה צפויה של ~0.4 ק״ג בשבוע</li>}
          {client.goal === 'muscle' && <li>· עודף של 300 קל׳ ליום ⇐ עלייה צפויה של ~0.3 ק״ג בשבוע</li>}
        </ul>
      </Card>
    </div>
  );
}

function PrintableNutrition({ client, bmr, tdee, targetCal, macros, activity, onClose }) {
  const waterL = Math.round(+client.weight * 35 / 100) / 10;
  const proteinPerMeal = Math.round(macros.protein / 4);

  return (
    <div>
      <div className="fixed inset-0 bg-slate-900 z-40 overflow-y-auto no-print">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center z-10">
          <div className="text-sm text-slate-400">תוכנית תזונה — תצוגה מקדימה</div>
          <div className="flex gap-2">
            <Btn variant="primary" onClick={() => window.print()}>⎙ הדפס / PDF</Btn>
            <Btn variant="outline" onClick={onClose}>סגור</Btn>
          </div>
        </div>
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          <div style={{ background: 'white', color: '#1e293b', padding: '40px', borderRadius: '8px' }}>
            <NutritionPrintContent client={client} bmr={bmr} tdee={tdee} targetCal={targetCal} macros={macros} activity={activity} waterL={waterL} proteinPerMeal={proteinPerMeal} />
          </div>
        </div>
      </div>
      <div className="print-only" style={{ background: 'white', color: '#1e293b', padding: '0', direction: 'rtl' }}>
        <NutritionPrintContent client={client} bmr={bmr} tdee={tdee} targetCal={targetCal} macros={macros} activity={activity} waterL={waterL} proteinPerMeal={proteinPerMeal} />
      </div>
    </div>
  );
}

function NutritionPrintContent({ client, bmr, tdee, targetCal, macros, activity, waterL, proteinPerMeal }) {
  return (
    <div style={{ fontFamily: FONT_BODY, color: '#0f172a', direction: 'rtl', lineHeight: 1.6 }}>
      <div style={{ borderBottom: '3px solid #10b981', paddingBottom: '12px', marginBottom: '20px' }}>
        <div style={{ fontSize: '28px', fontWeight: 900, fontFamily: FONT_HEADING, color: '#1e293b' }}>תוכנית תזונה אישית</div>
        <div style={{ fontSize: '18px', color: '#10b981', fontWeight: 700, marginTop: '4px' }}>{client.name}</div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>תאריך: {new Date().toLocaleDateString('he-IL')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <div style={{ background: '#f0fdf4', padding: '14px', borderRadius: '8px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: '11px', color: '#15803d' }}>קלוריות במנוחה (BMR)</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#14532d' }}>{bmr}</div>
        </div>
        <div style={{ background: '#f0fdf4', padding: '14px', borderRadius: '8px', textAlign: 'center', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: '11px', color: '#15803d' }}>תצרוכת יומית (TDEE)</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#14532d' }}>{tdee}</div>
        </div>
        <div style={{ background: '#10b981', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#d1fae5' }}>יעד יומי</div>
          <div style={{ fontSize: '28px', fontWeight: 900, color: 'white' }}>{targetCal}</div>
        </div>
      </div>

      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', color: '#334155', marginBottom: '12px', fontFamily: FONT_HEADING }}>חלוקת מקרו-נוטריינטים יומית</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ background: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center', borderTop: '4px solid #dc2626' }}>
            <div style={{ fontSize: '11px', color: '#991b1b' }}>חלבון</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#7f1d1d' }}>{macros.protein}<span style={{ fontSize: '12px', fontWeight: 400 }}> ג׳</span></div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{macros.protein * 4} קלוריות</div>
          </div>
          <div style={{ background: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center', borderTop: '4px solid #d97706' }}>
            <div style={{ fontSize: '11px', color: '#92400e' }}>פחמימות</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#78350f' }}>{macros.carbs}<span style={{ fontSize: '12px', fontWeight: 400 }}> ג׳</span></div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{macros.carbs * 4} קלוריות</div>
          </div>
          <div style={{ background: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center', borderTop: '4px solid #059669' }}>
            <div style={{ fontSize: '11px', color: '#065f46' }}>שומן</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#064e3b' }}>{macros.fat}<span style={{ fontSize: '12px', fontWeight: 400 }}> ג׳</span></div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{macros.fat * 9} קלוריות</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', color: '#334155', marginBottom: '10px', fontFamily: FONT_HEADING }}>📋 הנחיות אישיות</div>
        <ul style={{ margin: 0, paddingRight: '20px', fontSize: '13px', color: '#334155', lineHeight: 1.7 }}>
          <li><strong>חלבון:</strong> פיזור על 4 ארוחות ביום (~{proteinPerMeal} ג׳ לכל ארוחה)</li>
          <li><strong>מים:</strong> {waterL} ליטר ביום + 500 מ״ל לכל שעת אימון</li>
          <li><strong>תזמון לפני אימון:</strong> ארוחה קלה 60-90 דקות לפני (פחמימות + חלבון)</li>
          <li><strong>תזמון אחרי אימון:</strong> תוך 1-2 שעות — חלבון ופחמימות ביחס 1:2</li>
          <li><strong>סיבים:</strong> 25-35 גרם ביום (ירקות, שיבולת שועל, קטניות)</li>
        </ul>
      </div>

      <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', padding: '14px', borderRadius: '8px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>🍽 דוגמת ארוחות יומית</div>
        <div style={{ fontSize: '12px', color: '#78350f', lineHeight: 1.6 }}>
          <div><strong>בוקר:</strong> 3 ביצים + 2 פרוסות לחם מחיטה מלאה + ירקות (~450 קל׳, 25ג׳ חלבון)</div>
          <div><strong>ביניים:</strong> יוגורט יווני 0% + חופן שקדים + פרי (~300 קל׳, 20ג׳ חלבון)</div>
          <div><strong>צהריים:</strong> 150ג׳ חזה עוף + ½ כוס אורז + סלט גדול (~500 קל׳, 45ג׳ חלבון)</div>
          <div><strong>ביניים:</strong> קוטג׳ 5% + ירקות (~200 קל׳, 18ג׳ חלבון)</div>
          <div><strong>ערב:</strong> 150ג׳ דג + תפוח אדמה אפוי + ירקות (~450 קל׳, 35ג׳ חלבון)</div>
        </div>
      </div>

      <div style={{ marginTop: '16px', fontSize: '10px', color: '#94a3b8', textAlign: 'center', borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
        תוכנית זו מבוססת על נוסחת Mifflin-St Jeor. אינה תחליף לייעוץ דיאטני מקצועי.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//             NEW: PER-CLIENT ASSESSMENT TAB
// ═══════════════════════════════════════════════════════════════════

function ClientAssessmentTab({ client }) {
  const [scores, setScores] = useState({});
  const [history, setHistory] = useState([]);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    (async () => {
      const h = (await S.get(`assessments:${client.id}`)) || [];
      setHistory(h);
    })();
  }, [client.id]);

  const total = Object.values(scores).reduce((a, b) => a + (b || 0), 0);
  const max = ASSESSMENTS.length * 3;
  const allDone = Object.keys(scores).length === ASSESSMENTS.length;

  const saveAssessment = async () => {
    const entry = { id: `a_${Date.now()}`, date: new Date().toISOString(), scores, total, max };
    const newHistory = [...history, entry];
    await S.set(`assessments:${client.id}`, newHistory);
    setHistory(newHistory);
    setScores({});
    setSavedMsg('ההערכה נשמרה');
    setTimeout(() => setSavedMsg(''), 3000);
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>הערכה תפקודית (FMS-Lite)</h3>
        <p className="text-sm text-slate-400 mb-4">בצעו את 5 המבחנים, סמנו ציון לכל אחד. שמרו את ההערכה בסיום למעקב לאורך זמן.</p>
        <div className="bg-slate-800/40 rounded-lg p-3 flex justify-between items-center">
          <div className="text-sm text-slate-400">ציון נוכחי</div>
          <div className="text-2xl font-bold text-indigo-300">{total}/{max}</div>
        </div>
      </Card>

      {ASSESSMENTS.map(a => (
        <Card key={a.id}>
          <h4 className="font-semibold mb-1" style={{ fontFamily: FONT_HEADING }}>{a.name}</h4>
          <div className="text-xs text-slate-400 mb-3">{a.purpose}</div>
          <details className="mb-3">
            <summary className="text-xs text-indigo-400 cursor-pointer">הוראות ביצוע</summary>
            <ol className="mt-2 text-sm space-y-1 text-slate-200 bg-slate-800/40 rounded-lg p-3">
              {a.instructions.map((s, i) => <li key={i} className="flex gap-2"><span className="text-indigo-400">{i + 1}.</span>{s}</li>)}
            </ol>
          </details>
          <div className="space-y-1">
            {a.scoring.map(s => (
              <button key={s.score} onClick={() => setScores({ ...scores, [a.id]: s.score })}
                className={`w-full text-right px-3 py-2 rounded-lg border transition text-sm ${scores[a.id] === s.score ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800/30 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
                <div className="flex gap-3 items-start"><span className="font-bold">{s.score}</span><span>{s.criteria}</span></div>
              </button>
            ))}
          </div>
        </Card>
      ))}

      <div className="sticky bottom-4 bg-slate-900 border border-slate-700 rounded-xl p-4 flex justify-between items-center">
        <div className="text-sm">
          {savedMsg && <span className="text-emerald-400">✓ {savedMsg}</span>}
          {!savedMsg && <span className="text-slate-400">{Object.keys(scores).length}/{ASSESSMENTS.length} מבחנים</span>}
        </div>
        <Btn variant="primary" disabled={!allDone} onClick={saveAssessment}>שמור הערכה</Btn>
      </div>

      {history.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>היסטוריית הערכות</h3>
          <div className="space-y-2">
            {history.slice().reverse().map(h => (
              <div key={h.id} className="bg-slate-800/40 rounded-lg p-3 flex justify-between items-center">
                <div className="text-sm">{new Date(h.date).toLocaleDateString('he-IL')}</div>
                <div className="text-indigo-300 font-semibold">{h.total}/{h.max}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: MOBILITY VIEW
// ═══════════════════════════════════════════════════════════════════

function MobilityView() {
  const [tab, setTab] = useState('routines');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>גמישות, יוגה והתאוששות</h1>
        <div className="text-sm text-slate-400">שגרות מובנות, יוגה, שיטות התאוששות</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: 'routines', label: 'שגרות מובילות' },
          { id: 'yoga', label: 'יוגה' },
          { id: 'recovery', label: 'התאוששות' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'routines' && <MobilityRoutinesList />}
      {tab === 'yoga' && <YogaList />}
      {tab === 'recovery' && <RecoveryList />}
    </div>
  );
}

function MobilityRoutinesList() {
  return (
    <div className="space-y-4">
      {MOBILITY_ROUTINES.map(r => (
        <Card key={r.id}>
          <div className="mb-3">
            <div className="flex justify-between items-start mb-1 flex-wrap gap-2">
              <h4 className="font-semibold" style={{ fontFamily: FONT_HEADING }}>{r.name}</h4>
              <Badge tone="indigo">{r.when}</Badge>
            </div>
            <div className="text-xs text-slate-400">🎯 {r.purpose}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 border-b border-slate-800">
                <tr><th className="text-right py-2">תרגיל</th><th className="text-right py-2">משך</th><th className="text-right py-2 hidden md:table-cell">הערות</th></tr>
              </thead>
              <tbody>
                {r.exercises.map((e, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    <td className="py-2 font-medium">{e.name}</td>
                    <td className="py-2 text-indigo-300">{e.duration}</td>
                    <td className="py-2 text-xs text-slate-400 hidden md:table-cell">{e.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function YogaList() {
  return (
    <div className="space-y-4">
      {YOGA_FLOWS.map(f => (
        <Card key={f.id}>
          <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
            <h4 className="font-semibold" style={{ fontFamily: FONT_HEADING }}>{f.name}</h4>
            <Badge tone="indigo">{f.duration}</Badge>
          </div>
          <div className="text-xs text-slate-400 mb-3">🎯 {f.purpose}</div>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-2">רצף תנוחות</div>
            <div className="space-y-1 text-sm">
              {f.poses.map((p, i) => (
                <div key={i} className="flex justify-between border-b border-slate-800/50 py-1">
                  <span className="text-slate-200">{i + 1}. {p.name}</span>
                  <span className="text-indigo-300 text-xs">{p.breath}</span>
                </div>
              ))}
            </div>
          </div>
          {f.tips && (
            <div className="mt-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-3 text-sm text-emerald-100/90">
              💡 {f.tips}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RecoveryList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {RECOVERY_METHODS.map(m => (
        <Card key={m.id}>
          <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
            <h4 className="font-semibold" style={{ fontFamily: FONT_HEADING }}>{m.name}</h4>
            <Badge tone="indigo">{m.importance}</Badge>
          </div>
          <p className="text-sm text-slate-300 mb-3 leading-relaxed">{m.body}</p>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-2">פרוטוקול</div>
            <ul className="space-y-1 text-sm text-slate-200">
              {m.protocols.map((p, i) => <li key={i} className="flex gap-2"><span className="text-indigo-400">·</span>{p}</li>)}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: CARDIO VIEW
// ═══════════════════════════════════════════════════════════════════

function CardioView() {
  const [tab, setTab] = useState('zones');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>קרדיו וסיבולת</h1>
        <div className="text-sm text-slate-400">אזורי דופק, פרוטוקולים, תוכניות ריצה</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: 'zones', label: 'אזורי דופק' },
          { id: 'hiit', label: 'HIIT' },
          { id: 'liss', label: 'LISS' },
          { id: 'running', label: 'תוכניות ריצה' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'zones' && <HRZonesCalc />}
      {tab === 'hiit' && <HIITList />}
      {tab === 'liss' && <LISSList />}
      {tab === 'running' && <RunningProgramsList />}
    </div>
  );
}

function HRZonesCalc() {
  const [age, setAge] = useState(30);
  const maxHR = calculateMaxHR(+age);
  const zoneColors = ['emerald', 'indigo', 'indigo', 'amber', 'red'];
  return (
    <div className="space-y-4">
      <Card>
        <Field label="גיל"><Input type="number" value={age} onChange={setAge} /></Field>
        <div className="mt-3 bg-emerald-900/30 border border-emerald-800/50 rounded-lg p-3 text-center">
          <div className="text-xs text-emerald-400">דופק מקסימלי משוער</div>
          <div className="text-3xl font-bold text-emerald-300">{maxHR}</div>
          <div className="text-xs text-emerald-500/70">פעימות לדקה (נוסחת Tanaka)</div>
        </div>
      </Card>

      <Card padded={false} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-xs text-slate-400">
            <tr>
              <th className="text-right px-3 py-2">אזור</th>
              <th className="text-right px-3 py-2">שם</th>
              <th className="text-right px-3 py-2">% מקס</th>
              <th className="text-right px-3 py-2">דופק</th>
              <th className="text-right px-3 py-2 hidden md:table-cell">תחושה</th>
              <th className="text-right px-3 py-2 hidden lg:table-cell">מטרה</th>
            </tr>
          </thead>
          <tbody>
            {HEART_RATE_ZONES.map(z => {
              const hr = calculateZoneHR(maxHR, z.zone);
              return (
                <tr key={z.zone} className="border-t border-slate-800">
                  <td className="px-3 py-3">
                    <Badge tone={zoneColors[z.zone - 1]}>Z{z.zone}</Badge>
                  </td>
                  <td className="px-3 py-3 font-medium">{z.name}</td>
                  <td className="px-3 py-3 text-slate-300">{z.pctMin}-{z.pctMax}%</td>
                  <td className="px-3 py-3 text-indigo-300 font-semibold">{hr.min}-{hr.max}</td>
                  <td className="px-3 py-3 text-xs text-slate-400 hidden md:table-cell">{z.feels}</td>
                  <td className="px-3 py-3 text-xs text-slate-400 hidden lg:table-cell">{z.purpose}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function HIITList() {
  return (
    <div className="space-y-4">
      {HIIT_PROTOCOLS.map(p => (
        <Card key={p.id}>
          <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
            <h4 className="font-semibold text-lg" style={{ fontFamily: FONT_HEADING }}>{p.name}</h4>
            <Badge tone="indigo">{p.duration}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-3">
            <div className="bg-slate-800/40 rounded p-2"><div className="text-xs text-slate-400">מבנה</div><div>{p.structure}</div></div>
            <div className="bg-slate-800/40 rounded p-2"><div className="text-xs text-slate-400">עוצמה</div><div>{p.intensity}</div></div>
            <div className="bg-slate-800/40 rounded p-2"><div className="text-xs text-slate-400">מתאים ל</div><div>{p.suitable}</div></div>
          </div>
          <div className="text-xs text-emerald-400 mb-2">🎯 {p.purpose}</div>
          <div className="bg-slate-800/40 rounded-lg p-3 mb-2">
            <div className="text-xs text-slate-400 mb-2">דוגמאות תרגילים</div>
            <ul className="space-y-1 text-sm">
              {p.exercises.map((e, i) => <li key={i} className="flex gap-2"><span className="text-indigo-400">·</span>{e}</li>)}
            </ul>
          </div>
          {p.notes && <div className="text-xs text-slate-400 italic">💡 {p.notes}</div>}
        </Card>
      ))}
    </div>
  );
}

function LISSList() {
  return (
    <div>
      <div className="bg-slate-800/40 rounded-lg p-4 mb-4 text-sm text-slate-300">
        <strong>LISS — Low Intensity Steady State.</strong> פעילות אירובית בעצימות נמוכה לפרק זמן ארוך.
        אידיאלי לשריפת שומן, התאוששות אקטיבית, ובניית בסיס אירובי.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {LISS_PROTOCOLS.map((l, i) => (
          <Card key={i}>
            <h4 className="font-semibold mb-2" style={{ fontFamily: FONT_HEADING }}>{l.name}</h4>
            <Badge tone="indigo">{l.duration}</Badge>
            <div className="mt-2 text-xs text-slate-400">{l.intensity}</div>
            <p className="text-sm text-slate-300 mt-3">{l.purpose}</p>
            <div className="text-xs text-slate-500 mt-3">{l.notes}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RunningProgramsList() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {RUNNING_PROGRAMS.map(p => (
          <button key={p.id} onClick={() => setOpen(p)}
            className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-indigo-600 transition">
            <Badge tone="indigo">{p.weeks.length} שבועות</Badge>
            <div className="font-semibold mt-3 mb-1" style={{ fontFamily: FONT_HEADING }}>{p.name}</div>
            <div className="text-xs text-slate-400">🎯 {p.target}</div>
            <div className="text-xs text-slate-500 mt-1">{p.suitable}</div>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name || ''} wide>
        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-xs text-slate-400">
                <tr><th className="text-right px-3 py-2">שבוע</th><th className="text-right px-3 py-2">אימונים</th><th className="text-right px-3 py-2">תוכנית</th></tr>
              </thead>
              <tbody>
                {open.weeks.map(w => (
                  <tr key={w.week} className="border-t border-slate-800">
                    <td className="px-3 py-2 font-bold text-indigo-300">{w.week}</td>
                    <td className="px-3 py-2">{w.sessions}</td>
                    <td className="px-3 py-2 text-slate-200">{w.plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//                   NEW: INTERVAL TIMER
// ═══════════════════════════════════════════════════════════════════

function IntervalTimer() {
  const [config, setConfig] = useState({
    rounds: 8,
    workSec: 30,
    restSec: 15,
    prepareSec: 10,
  });
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | prepare | work | rest | done
  const [round, setRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const intervalRef = useRef(null);

  const beep = (freq = 800, duration = 200) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.3;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch (e) { /* audio not supported */ }
  };

  useEffect(() => {
    if (!running) return;

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev > 1) return prev - 1;

        // Phase transition
        if (phase === 'prepare') {
          setPhase('work');
          setRound(1);
          beep(1000, 300);
          return config.workSec;
        }
        if (phase === 'work') {
          if (round >= config.rounds) {
            setPhase('done');
            setRunning(false);
            beep(600, 600);
            return 0;
          }
          setPhase('rest');
          beep(500, 200);
          return config.restSec;
        }
        if (phase === 'rest') {
          setPhase('work');
          setRound(r => r + 1);
          beep(1000, 300);
          return config.workSec;
        }
        return 0;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [running, phase, round, config]);

  // Beep at last 3 seconds
  useEffect(() => {
    if (running && timeLeft <= 3 && timeLeft > 0) beep(700, 100);
  }, [timeLeft, running]);

  const start = () => {
    setPhase('prepare');
    setRound(0);
    setTimeLeft(config.prepareSec);
    setRunning(true);
  };

  const stop = () => {
    setRunning(false);
    setPhase('idle');
    setRound(0);
    setTimeLeft(0);
  };

  const phaseColor = {
    idle: 'bg-slate-800',
    prepare: 'bg-amber-600',
    work: 'bg-emerald-600',
    rest: 'bg-indigo-600',
    done: 'bg-purple-600',
  }[phase];

  const phaseLabel = {
    idle: 'מוכן',
    prepare: 'הכנה',
    work: 'עבודה',
    rest: 'מנוחה',
    done: 'סיום!',
  }[phase];

  // Quick presets
  const presets = [
    { name: 'טבטה', rounds: 8, workSec: 20, restSec: 10, prepareSec: 10 },
    { name: 'HIIT 30/30', rounds: 10, workSec: 30, restSec: 30, prepareSec: 10 },
    { name: 'אגרוף 3 דק׳', rounds: 5, workSec: 180, restSec: 60, prepareSec: 10 },
    { name: 'EMOM', rounds: 12, workSec: 40, restSec: 20, prepareSec: 10 },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card>
          <h3 className="font-semibold mb-4" style={{ fontFamily: FONT_HEADING }}>הגדרות</h3>
          <div className="space-y-3">
            <Field label="סבבים">
              <Input type="number" value={config.rounds} onChange={(v) => setConfig({ ...config, rounds: +v || 1 })} />
            </Field>
            <Field label="זמן עבודה (שניות)">
              <Input type="number" value={config.workSec} onChange={(v) => setConfig({ ...config, workSec: +v || 1 })} />
            </Field>
            <Field label="זמן מנוחה (שניות)">
              <Input type="number" value={config.restSec} onChange={(v) => setConfig({ ...config, restSec: +v || 0 })} />
            </Field>
            <Field label="זמן הכנה (שניות)">
              <Input type="number" value={config.prepareSec} onChange={(v) => setConfig({ ...config, prepareSec: +v || 5 })} />
            </Field>
            <div className="text-xs text-slate-400 pt-2 border-t border-slate-800">
              סה״כ: {Math.round((config.prepareSec + (config.workSec + config.restSec) * config.rounds) / 60 * 10) / 10} דקות
            </div>
          </div>
        </Card>

        <Card>
          <div className="text-xs text-slate-400 mb-2">הגדרות מהירות</div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p, i) => (
              <button key={i} onClick={() => setConfig({ rounds: p.rounds, workSec: p.workSec, restSec: p.restSec, prepareSec: p.prepareSec })}
                className="text-right px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm transition">
                {p.name}
                <div className="text-xs text-slate-500">{p.rounds}×({p.workSec}/{p.restSec})</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className={`${phaseColor} transition-colors duration-300 text-white`}>
        <div className="text-center py-4">
          <div className="text-2xl font-bold mb-2 opacity-90">{phaseLabel}</div>
          {phase !== 'idle' && phase !== 'done' && (
            <div className="text-sm opacity-80 mb-4">סבב {round}/{config.rounds}</div>
          )}
          <div className="text-9xl font-black my-6 tabular-nums" style={{ fontFamily: FONT_HEADING }}>
            {String(Math.floor(timeLeft / 60)).padStart(2, '0')}:{String(timeLeft % 60).padStart(2, '0')}
          </div>
          <div className="flex gap-2 justify-center">
            {!running && phase !== 'done' && (
              <Btn variant="success" size="lg" onClick={start}>▶ התחל</Btn>
            )}
            {running && (
              <Btn variant="danger" size="lg" onClick={stop}>■ עצור</Btn>
            )}
            {(phase === 'done' || (!running && phase !== 'idle')) && (
              <Btn variant="secondary" size="lg" onClick={stop}>↺ אפס</Btn>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//             NEW: PROGRAM TEMPLATES VIEW
// ═══════════════════════════════════════════════════════════════════

function TemplatesView({ clients, setView, saveClient }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [printMode, setPrintMode] = useState(false);

  const cats = [
    { id: 'all', label: 'הכל' },
    { id: 'strength', label: 'כוח' },
    { id: 'muscle', label: 'בנייה' },
    { id: 'weight-loss', label: 'ירידה במשקל' },
    { id: 'health', label: 'בריאות כללית' },
  ];

  const filtered = filter === 'all' ? PROGRAM_TEMPLATES : PROGRAM_TEMPLATES.filter(t => t.category === filter);

  const assignToClient = async (template, clientId) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const newProgram = {
      goal: template.category,
      level: template.level,
      daysPerWeek: template.daysPerWeek,
      createdAt: new Date().toISOString(),
      templateId: template.id,
      templateName: template.name,
      days: template.days.map(d => ({
        name: d.name,
        exercises: d.exercises.map(e => ({ ...e, weight: '' })),
      })),
    };
    await S.set(K.program(client.id), newProgram);
    setView({ name: 'client-detail', id: client.id });
  };

  if (printMode && open) {
    return <PrintableTemplate template={open} onClose={() => setPrintMode(false)} />;
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>תוכניות אימון מוכנות</h1>
        <div className="text-sm text-slate-400">{PROGRAM_TEMPLATES.length} תוכניות מקצועיות מוכנות לשימוש</div>
      </header>

      <div className="flex gap-2 mb-4 flex-wrap">
        {cats.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${filter === c.id ? 'bg-indigo-500/15 border-indigo-500 text-indigo-200' : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(t => (
          <button key={t.id} onClick={() => setOpen(t)}
            className="text-right bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-indigo-600 transition">
            <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
              <Badge tone="indigo">{GOALS.find(g => g.id === t.category)?.label || t.category}</Badge>
              <div className="flex gap-2">
                <Badge tone="slate">{t.daysPerWeek} ימים/שבוע</Badge>
                <Badge tone={t.level === 'beginner' ? 'emerald' : t.level === 'intermediate' ? 'amber' : 'red'}>
                  {LEVELS.find(l => l.id === t.level)?.label}
                </Badge>
              </div>
            </div>
            <div className="font-bold text-lg mb-2" style={{ fontFamily: FONT_HEADING }}>{t.name}</div>
            <p className="text-sm text-slate-400 line-clamp-2">{t.description}</p>
          </button>
        ))}
      </div>

      <Modal open={!!open && !printMode} onClose={() => setOpen(null)} title={open?.name || ''} wide>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="indigo">{GOALS.find(g => g.id === open.category)?.label || open.category}</Badge>
              <Badge tone="slate">{open.daysPerWeek} ימים/שבוע</Badge>
              <Badge tone={open.level === 'beginner' ? 'emerald' : open.level === 'intermediate' ? 'amber' : 'red'}>
                {LEVELS.find(l => l.id === open.level)?.label}
              </Badge>
            </div>

            <p className="text-sm text-slate-300">{open.description}</p>

            <div className="bg-slate-800/40 rounded-lg p-3 text-sm">
              <div className="text-slate-400 text-xs mb-1">מבנה השבוע</div>
              <div>{open.schedule}</div>
            </div>

            <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-lg p-3 text-sm">
              <div className="text-emerald-300 text-xs mb-1">📈 התקדמות</div>
              <div className="text-emerald-100/90">{open.progression}</div>
            </div>

            {open.days.map((d, di) => (
              <div key={di}>
                <h4 className="font-semibold text-indigo-300 mb-2" style={{ fontFamily: FONT_HEADING }}>{d.name}</h4>
                <div className="bg-slate-800/40 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800/50 text-xs text-slate-400">
                      <tr>
                        <th className="text-right px-3 py-2">תרגיל</th>
                        <th className="text-center px-3 py-2">סטים</th>
                        <th className="text-center px-3 py-2">חזרות</th>
                        <th className="text-center px-3 py-2">מנוחה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.exercises.map((ex, ei) => {
                        const data = EXERCISES.find(e => e.id === ex.exerciseId);
                        return (
                          <tr key={ei} className="border-t border-slate-800">
                            <td className="px-3 py-2">{data?.name || ex.exerciseId}</td>
                            <td className="px-3 py-2 text-center">{ex.sets}</td>
                            <td className="px-3 py-2 text-center">{ex.reps}</td>
                            <td className="px-3 py-2 text-center">{ex.rest}״</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <div className="border-t border-slate-800 pt-4 flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => setPrintMode(true)}>⎙ ייצוא PDF</Btn>
              {clients.length > 0 && (
                <select onChange={(e) => { if (e.target.value) assignToClient(open, e.target.value); }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" defaultValue="">
                  <option value="">הקצה למתאמן...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrintableTemplate({ template, onClose }) {
  return (
    <div>
      <div className="fixed inset-0 bg-slate-900 z-40 overflow-y-auto no-print">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center z-10">
          <div className="text-sm text-slate-400">תצוגה מקדימה — {template.name}</div>
          <div className="flex gap-2">
            <Btn variant="primary" onClick={() => window.print()}>⎙ הדפס / PDF</Btn>
            <Btn variant="outline" onClick={onClose}>סגור</Btn>
          </div>
        </div>
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          <div style={{ background: 'white', color: '#1e293b', padding: '40px', borderRadius: '8px' }}>
            <TemplatePrintContent template={template} />
          </div>
        </div>
      </div>
      <div className="print-only" style={{ background: 'white', color: '#1e293b', padding: '0', direction: 'rtl' }}>
        <TemplatePrintContent template={template} />
      </div>
    </div>
  );
}

function TemplatePrintContent({ template }) {
  return (
    <div style={{ fontFamily: FONT_BODY, color: '#0f172a', direction: 'rtl', lineHeight: 1.6 }}>
      <div style={{ borderBottom: '3px solid #4f46e5', paddingBottom: '12px', marginBottom: '20px' }}>
        <div style={{ fontSize: '28px', fontWeight: 900, fontFamily: FONT_HEADING }}>{template.name}</div>
        <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          {template.daysPerWeek} ימים בשבוע · {LEVELS.find(l => l.id === template.level)?.label}
        </div>
      </div>

      <div style={{ background: '#eff6ff', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px' }}>
        <div style={{ fontWeight: 700, marginBottom: '6px', color: '#1e40af' }}>על התוכנית</div>
        <div style={{ color: '#1e3a8a' }}>{template.description}</div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#3730a3' }}>
          <strong>מבנה:</strong> {template.schedule}
        </div>
      </div>

      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px' }}>
        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#15803d' }}>📈 התקדמות</div>
        <div style={{ color: '#166534' }}>{template.progression}</div>
      </div>

      {template.days.map((d, di) => (
        <div key={di} style={{ marginBottom: '24px', pageBreakInside: 'avoid' }}>
          <div style={{ background: '#4f46e5', color: 'white', padding: '8px 14px', borderRadius: '6px', fontSize: '15px', fontWeight: 700, fontFamily: FONT_HEADING, marginBottom: '10px' }}>
            {d.name}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', color: '#475569' }}>
                <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>#</th>
                <th style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>תרגיל</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '50px' }}>סטים</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '60px' }}>חזרות</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '60px' }}>משקל</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600, width: '60px' }}>מנוחה</th>
              </tr>
            </thead>
            <tbody>
              {d.exercises.map((ex, ei) => {
                const data = EXERCISES.find(e => e.id === ex.exerciseId);
                return (
                  <tr key={ei} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px', fontWeight: 700, color: '#4f46e5' }}>{ei + 1}</td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 600 }}>{data?.name}</div>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>{data?.muscles?.join(' · ')}</div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{ex.sets}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{ex.reps}</td>
                    <td style={{ padding: '8px', textAlign: 'center', color: '#94a3b8' }}>____</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{ex.rest}״</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: '20px', fontSize: '10px', color: '#94a3b8', textAlign: 'center', borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
        חימום של 5-10 דקות לפני כל אימון. תוכנית זו אינה תחליף לייעוץ מקצועי אישי.
      </div>
    </div>
  );
}
