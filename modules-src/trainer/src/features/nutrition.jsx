// מודול האימונים — nutrition.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState } from 'react';
import { GOALS, ACTIVITY_LEVELS } from '../data/constants.js';
import { FOODS, calculateBMR, calculateTDEE, calculateGoalCalories, calculateMacros, MEAL_PLANS, NUTRITION_TIPS } from '../data/nutrition.js';
import { FONT_HEADING, FONT_BODY, Btn, Card, Field, Input, Badge, Modal, Toggle } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                   NEW: NUTRITION VIEW (global)
// ═══════════════════════════════════════════════════════════════════

export function NutritionView() {
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
//             NEW: PER-CLIENT NUTRITION TAB
// ═══════════════════════════════════════════════════════════════════

export function ClientNutritionTab({ client }) {
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