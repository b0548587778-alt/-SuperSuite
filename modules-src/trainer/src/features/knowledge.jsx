// מודול האימונים — knowledge.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState } from 'react';
import { WARMUP_PROTOCOLS, INJURIES, TRAINING_PRINCIPLES, ADVANCED_TECHNIQUES } from '../data/knowledge.js';
import { FONT_HEADING, Card, Badge, Modal } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                   NEW: KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════

export function KnowledgeView() {
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