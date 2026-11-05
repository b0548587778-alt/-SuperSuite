// פעולה שחוצה כמה שירותים — בשמירה אחת: הכול או כלום (הוכלל מ-collectService; סקירת קוד 2.11.2026).
// כל שירות טוען ושומר בעצמו (this.db.load / this.db.save), ולכן בזמן fn השירותים המשתתפים שחולקים את אותו מסד
// מקבלים עטיפה שעובדת על עותק בזיכרון, והכתיבה האמיתית אחת בסוף. בטוח כי כל פעולה במסד רצה בתור אחד (enqueue).
// אובייקט המסד עצמו לא משתנה: גיבוי שרץ מחוץ לתור רואה רק נתונים שנשמרו. שגיאה ב-fn ← שום דבר לא נכתב.
// שאר הפעולות של המסד (למשל listUsers) עוברות למסד האמיתי.
// fn מקבל ctl: mark() / restore(m) — נקודת חזרה בזיכרון לבידוד כשל של שורה (קליטת דוח סליקה).
// העותק בזיכרון לעולם לא משתנה במקום (load מחזיר עותק, save מחליף), ולכן נקודת חזרה = הפניה בלבד
const ACTIVE = new WeakMap();

async function inOneSave(services, fn) {
  const list = (services || []).filter(Boolean);
  if (!list.length) return fn({ mark: () => null, restore: () => {} });
  const base = list[0].db;
  // כבר בתוך שמירה אחת (קריאה מקוננת) — ממשיכים באותה עטיפה
  if (ACTIVE.has(base)) return fn(ACTIVE.get(base));
  let work = null, dirty = false;
  const tx = new Proxy(base, {
    get(target, prop) {
      if (prop === 'load') return async () => structuredClone(work || (work = await target.load()));
      if (prop === 'save') return async (value) => { work = structuredClone(value); dirty = true; };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
  const ctl = { mark: () => ({ work, dirty }), restore: (m) => { work = m.work; dirty = m.dirty; } };
  ACTIVE.set(tx, ctl);
  // שירות עם מסד אחר (לא אמור לקרות) נשאר על המסד שלו — לא כותבים את הנתונים שלו למסד הזה
  const swapped = list.filter((s, i, all) => s.db === base && all.indexOf(s) === i);
  for (const s of swapped) s.db = tx;
  let out;
  try { out = await fn(ctl); }
  finally {
    for (const s of swapped) s.db = base;
    ACTIVE.delete(tx);
  }
  if (dirty) await base.save(work);
  return out;
}

module.exports = { inOneSave };
