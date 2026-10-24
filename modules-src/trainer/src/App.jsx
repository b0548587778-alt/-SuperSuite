import React, { useState, useEffect } from 'react';
import { S, K } from './lib/db.js';
import { removeClientEverywhere } from './lib/studio.js';
import { ScheduleView, MembershipsView, RemindersView } from './studio.jsx';
import { FONT_HEADING, FONT_BODY } from './components/legacy-ui.jsx';
import { TrainerSetup, Dashboard, TrainerSettings } from './features/home.jsx';
import { ClientsList, ClientForm, ClientDetail } from './features/clients.jsx';
import { LibraryView } from './features/library.jsx';
import { NutritionView } from './features/nutrition.jsx';
import { KnowledgeView } from './features/knowledge.jsx';
import { ToolsView } from './features/tools.jsx';
import { MobilityView } from './features/mobility.jsx';
import { CardioView } from './features/cardio.jsx';
import { TemplatesView } from './features/templates.jsx';


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

  // השמירות מחזירות true / false. שמירה שנדחתה (צפייה בלבד, הכניסה פגה, אין מקום — ההודעה מ-lib/storage.js)
  // לא מעדכנת את המסך: אחרת הוא מציג שינוי שנעלם בטעינה הבאה (בדיקת קוד 23.10.2026, ממצא 3)
  const saveTrainer = async (t) => {
    if (!(await S.set(K.trainer, t))) return false;
    setTrainer(t);
    return true;
  };

  const saveClient = async (c) => {
    if (!(await S.set(K.client(c.id), c))) return false;
    const idx = (await S.get(K.clientIndex)) || [];
    if (!idx.includes(c.id)) {
      idx.push(c.id);
      if (!(await S.set(K.clientIndex, idx))) return false;
    }
    setClients((prev) => {
      const filtered = prev.filter((p) => p.id !== c.id);
      return [...filtered, c];
    });
    return true;
  };

  // קודם מהרשימה: מחיקה שנדחתה לא משנה דבר. אחר כך הנתונים — מה שלא נמחק (ההודעה כבר הוצגה) כבר לא מוצג בשום מקום
  const deleteClient = async (id) => {
    const idx = (await S.get(K.clientIndex)) || [];
    if (!(await S.set(K.clientIndex, idx.filter((i) => i !== id)))) return false;
    setClients((prev) => prev.filter((c) => c.id !== id));
    const sch = (await S.get(K.schedule)) || [];
    if (!(await S.set(K.schedule, removeClientEverywhere(sch, id)))) return true;
    for (const key of [K.client(id), K.program(id), K.sessions(id), K.measurements(id), K.assessments(id), K.memberships(id)]) {
      if (!(await S.del(key))) break;
    }
    return true;
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-indigo-400 flex items-center justify-center" style={{ fontFamily: FONT_BODY }}>טוען...</div>;
  }

  if (view.name === 'trainer-setup') {
    return <TrainerSetup onSave={async (t) => { if (await saveTrainer(t)) setView({ name: 'dashboard' }); }} />;
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
          {view.name === 'client-new' && <ClientForm onSave={async (c) => { if (await saveClient(c)) setView({ name: 'client-detail', id: c.id }); }} onCancel={() => setView({ name: 'clients' })} />}
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
    // הטקסט הוא מפתח הניווט מול shell/catalog.js (TRAINER_LABELS); הסרגל הזה מוסתר ב-SuperSuite (preload),
    // והמשתמש רואה "גמישות ומתיחות". שינוי הטקסט — יחד עם הקטלוג ועם בנייה חדשה של החבילה (tests/trainer-nav.test.js)
    { id: 'mobility', label: 'גמישות ומתיחות', icon: '🤸' },
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