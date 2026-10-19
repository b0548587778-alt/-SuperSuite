// מודול האימונים — library.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState } from 'react';
import { MEDICAL_CONDITIONS, EQUIPMENT, LEVELS } from '../data/constants.js';
import { EXERCISES } from '../data/exercises.js';
import { FONT_HEADING, Input, Badge, Modal } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                      EXERCISE LIBRARY
// ═══════════════════════════════════════════════════════════════════

export function LibraryView() {
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