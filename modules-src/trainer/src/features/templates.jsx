// מודול האימונים — templates.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState } from 'react';
import { GOALS, LEVELS } from '../data/constants.js';
import { EXERCISES } from '../data/exercises.js';
import { PROGRAM_TEMPLATES } from '../data/program-templates.js';
import { S, K } from '../lib/db.js';
import { FONT_HEADING, FONT_BODY, Btn, Badge, Modal } from '../components/legacy-ui.jsx';
import { savePdf, printNow } from '../lib/print.js';


// ═══════════════════════════════════════════════════════════════════
//             NEW: PROGRAM TEMPLATES VIEW
// ═══════════════════════════════════════════════════════════════════

export function TemplatesView({ clients, setView, saveClient }) {
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
            <Btn variant="primary" onClick={() => savePdf(template.name)}>⎙ שמירה כ-PDF</Btn>
            <Btn variant="outline" onClick={printNow}>🖨 הדפסה</Btn>
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
