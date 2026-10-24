// מודול האימונים — mobility.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState } from 'react';
import { MOBILITY_ROUTINES, STRETCH_FLOWS, RECOVERY_METHODS } from '../data/mobility.js';
import { FONT_HEADING, Card, Badge } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                   NEW: MOBILITY VIEW
// ═══════════════════════════════════════════════════════════════════

export function MobilityView() {
  const [tab, setTab] = useState('routines');
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: FONT_HEADING }}>גמישות, מתיחות והתאוששות</h1>
        <div className="text-sm text-slate-400">שגרות מובנות, רצפי מתיחות, שיטות התאוששות</div>
      </header>

      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {[
          { id: 'routines', label: 'שגרות מובילות' },
          { id: 'flows', label: 'רצפי מתיחות' },
          { id: 'recovery', label: 'התאוששות' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'routines' && <MobilityRoutinesList />}
      {tab === 'flows' && <StretchFlowList />}
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

function StretchFlowList() {
  return (
    <div className="space-y-4">
      {STRETCH_FLOWS.map(f => (
        <Card key={f.id}>
          <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
            <h4 className="font-semibold" style={{ fontFamily: FONT_HEADING }}>{f.name}</h4>
            <Badge tone="indigo">{f.duration}</Badge>
          </div>
          <div className="text-xs text-slate-400 mb-3">🎯 {f.purpose}</div>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <div className="text-xs text-slate-400 mb-2">סדר התרגילים</div>
            <div className="space-y-1 text-sm">
              {f.steps.map((p, i) => (
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