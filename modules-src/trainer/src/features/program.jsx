// מודול האימונים — program.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState, useMemo } from 'react';
import { GOALS, LEVELS } from '../data/constants.js';
import { EXERCISES, GOAL_PARAMS } from '../data/exercises.js';
import { programToPlainText, whatsappShareUrl, copyToClipboard, downloadText } from '../lib/sharing.js';
import { filterExercises, getMedicalWarnings } from '../lib/program.js';
import { FONT_HEADING, FONT_BODY, Btn, Card, Field, Input, Textarea, Badge, Modal } from '../components/legacy-ui.jsx';


// ─── Program tab ───
export function ProgramTab({ client, program, trainer, onGenerate, onSave, onLogSession }) {
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