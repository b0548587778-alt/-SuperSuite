// מודול האימונים — cardio.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState, useEffect, useRef } from 'react';
import { HEART_RATE_ZONES, calculateMaxHR, calculateZoneHR, HIIT_PROTOCOLS, RUNNING_PROGRAMS, LISS_PROTOCOLS } from '../data/cardio.js';
import { FONT_HEADING, Btn, Card, Field, Input, Badge, Modal } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                   NEW: CARDIO VIEW
// ═══════════════════════════════════════════════════════════════════

export function CardioView() {
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

export function IntervalTimer() {
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