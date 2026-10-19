// מודול האימונים — home.jsx: הועבר מ-App.jsx כמו שהוא (PLAN.md 6.2)
import React, { useState, useEffect, useMemo } from 'react';
import { GOALS } from '../data/constants.js';
import { S, K } from '../lib/db.js';
import { TodayPanel } from '../studio.jsx';
import { FONT_HEADING, FONT_BODY, Btn, Card, Field, Input, Textarea } from '../components/legacy-ui.jsx';


// ═══════════════════════════════════════════════════════════════════
//                      TRAINER SETUP (onboarding)
// ═══════════════════════════════════════════════════════════════════

export function TrainerSetup({ onSave }) {
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

export function Dashboard({ clients, trainer, setView }) {
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
//                      TRAINER SETTINGS
// ═══════════════════════════════════════════════════════════════════

export function TrainerSettings({ trainer, onSave }) {
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