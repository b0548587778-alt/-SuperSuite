// מודול האימונים — tools.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState, useEffect } from 'react';
import { ASSESSMENTS, calculate1RM, calculatePercentages, PARQ_QUESTIONS } from '../data/knowledge.js';
import { S } from '../lib/db.js';
import { FONT_HEADING, FONT_BODY, Btn, Card, Field, Input, Badge } from '../components/legacy-ui.jsx';
import { IntervalTimer } from './cardio.jsx';
import { savePdf, printNow } from '../lib/print.js';
import { todayStr } from '../lib/studio.js';


// ═══════════════════════════════════════════════════════════════════
//                   NEW: TOOLS VIEW
// ═══════════════════════════════════════════════════════════════════

export function ToolsView() {
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
  const [date, setDate] = useState(todayStr()); // היום המקומי (לא UTC — שאלון חתום בין חצות ל-03:00)
  const [answers, setAnswers] = useState({});

  return (
    <div>
      <Card className="mb-4 no-print">
        <h3 className="font-semibold mb-3" style={{ fontFamily: FONT_HEADING }}>טופס שאלון בריאות (PAR-Q)</h3>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          טופס סטנדרטי שמלא כל מתאמן לפני תחילת תוכנית אימונים. תשובה "כן" לאחת השאלות מחייבת אישור רופא לפני התחלת אימונים.
        </p>
        <div className="flex gap-3">
          <Btn variant="primary" onClick={printNow}>🖨 הדפסה</Btn>
          <Btn variant="outline" onClick={() => savePdf(`שאלון PAR-Q — ${name || ''}`)}>⎙ שמירה כ-PDF</Btn>
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
//             NEW: PER-CLIENT ASSESSMENT TAB
// ═══════════════════════════════════════════════════════════════════

export function ClientAssessmentTab({ client }) {
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