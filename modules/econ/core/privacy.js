// כלי עזר לתיקון 13 לחוק הגנת הפרטיות — לא ייעוץ משפטי.
// מיפוי מאגרים (מה נשמר, כמה, מי רואה, איפה), מזעור נזקקים לא פעילים לפי בקשת מנהל, ורשימת בדיקה לאירוע אבטחה.
// אין כאן פעולה אוטומטית: המזעור רץ רק כשמנהל מאשר רשימה מוצגת מראש.

const SENSITIVITY = { regular: 'רגיל', sensitive: 'רגיש — מצב כלכלי', high: 'רגיש מאוד — מתן בסתר' };
const len = (v) => (Array.isArray(v) ? v.length : 0);

function dataMap(data, userCounts = {}) {
  const npo = data.npo || {};
  const gm = data.gemach || {};
  const ch = data.chesed || {};
  const bens = Array.isArray(ch.beneficiaries) ? ch.beneficiaries : [];
  const conf = bens.filter(b => b.tier === 'confidential').length;
  const all = 'כל המשתמשים המחוברים (צופה, עורך, מנהל)';
  const rows = [
    { area: 'עמותה — תורמים וקבלות', count: len(npo.donations), fields: 'שם, ת.ז, טלפון, כתובת, סכום', sensitivity: 'regular', access: all },
    { area: 'עמותה — הוראות קבע', count: len(npo.standingOrders), fields: 'שם, ת.ז, טלפון, כתובת, סכום חודשי (בלי פרטי אשראי/חשבון)', sensitivity: 'regular', access: all },
    { area: 'עמותה — הנצחות', count: len(npo.memorials), fields: 'שם הנפטר, איש קשר, ת.ז וטלפון של איש הקשר', sensitivity: 'regular', access: all },
    { area: 'גמ"ח — לווים וערבים', count: len(gm.loans), fields: 'שם, ת.ז, טלפון, סכום הלוואה, פיגורים, ערבים', sensitivity: 'sensitive', access: all },
    { area: 'גמ"ח — מפקידים', count: len(gm.deposits), fields: 'שם, סכום', sensitivity: 'regular', access: all },
    { area: 'חסד — נזקקים (רגילים)', count: bens.length - conf, fields: 'משפחה, ראש משפחה, ת.ז, נפשות, טלפון, כתובת, הערות', sensitivity: 'sensitive', access: all },
    { area: 'חסד — נזקקים חסויים', count: conf, fields: 'כמו נזקקים — מוסתר בשרת', sensitivity: 'high', access: 'מנהל בלבד (צפייה נרשמת ביומן הביקורת)' },
    { area: 'חסד — מתנדבים', count: len(ch.volunteers), fields: 'שם, טלפון, אזור, זמינות', sensitivity: 'regular', access: all },
    { area: 'ייעוץ משכנתאות — תיקי לקוחות', count: len(data.mortgageAdvisor && data.mortgageAdvisor.clients), fields: 'פרטי לקוח, נכס והצעות משכנתא', sensitivity: 'sensitive', access: all },
    { area: 'אנשי קשר', count: len(data.contacts), fields: 'שם, טלפון, דוא"ל, כתובת', sensitivity: 'regular', access: all }
  ].map(r => ({ ...r, sensitivityLabel: SENSITIVITY[r.sensitivity] }));
  return {
    rows,
    users: { admin: userCounts.admin || 0, editor: userCounts.editor || 0, viewer: userCounts.viewer || 0 },
    storage: [
      'מסד נתונים מקומי במחשב (תיקיית נתוני המשתמש של התוכנה) — לא נשלח לאינטרנט',
      'גיבוי ידני ואוטומטי — מוצפן בסיסמה (קובץ ‎.ssbk)',
      'קובצי ייצוא (CSV / PDF) — נשמרים במקום שהמשתמש בוחר, ללא הצפנה. יש לשמור ולמחוק אותם בהתאם'
    ],
    disclaimer: 'כלי עזר בלבד ואינו ייעוץ משפטי. לבירור החובות של המוסד לפי תיקון 13 — יש לפנות לעורך דין או לממונה הגנת הפרטיות.'
  };
}

// פעילות אחרונה של נזקק: עדכון הרשומה או שיוך לסבב חלוקה
function lastActivity(b, rounds) {
  let last = String(b.updatedAt || b.createdAt || '').slice(0, 10);
  for (const r of rounds || []) {
    if ((r.allocations || []).some(a => a.beneficiaryId === b.id) && String(r.date || '') > last) last = String(r.date);
  }
  return last;
}

function retentionCutoff(today, years) {
  const y = Number(years);
  if (!Number.isInteger(y) || y < 1 || y > 50) throw new Error('תקופת השמירה חייבת להיות בין 1 ל-50 שנים');
  const [yy, mm, dd] = String(today).split('-').map(Number);
  return `${yy - y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// נזקקים לא פעילים שהפעילות האחרונה שלהם לפני התקופה, ושלא מוזערו כבר
function retentionCandidates(chesed, today, years) {
  const cutoff = retentionCutoff(today, years);
  const rounds = chesed.rounds || [];
  return (chesed.beneficiaries || [])
    .filter(b => b.active === false && !b.minimized)
    .map(b => ({ id: b.id, familyName: b.familyName, tier: b.tier, last: lastActivity(b, rounds) }))
    .filter(x => x.last && x.last < cutoff)
    .sort((a, b) => a.last.localeCompare(b.last));
}

// מזעור: שם המשפחה, גודל ואזור נשמרים לסטטיסטיקה ולהיסטוריית החלוקות; פרטים מזהים נמחקים
function minimize(b, at) {
  return {
    id: b.id, familyName: b.familyName, familySize: b.familySize, area: b.area || '', tier: b.tier,
    headName: '', idNumber: '', phone: '', address: '', notes: '',
    active: false, minimized: true, minimizedAt: at, createdAt: b.createdAt
  };
}

const INCIDENT_CHECKLIST = [
  'לעצור את הדליפה: לנתק את המחשב מהרשת, להחליף סיסמאות של משתמשי התוכנה ולחסום משתמש חשוד',
  'לתעד: מה קרה, מתי התגלה, אילו סוגי מידע נחשפו (לפי מיפוי המאגרים), כמה אנשים',
  'לשמור ראיות: לייצא את יומן הביקורת ולא למחוק קבצים',
  'לבדוק מול עורך דין / ממונה הגנת הפרטיות אם נדרש דיווח לרשות להגנת הפרטיות ולאנשים שנפגעו, ובאיזה מועד',
  'לשחזר מגיבוי מוצפן תקין אם הנתונים שובשו',
  'לסכם לקחים: הרשאות, סיסמאות, היכן נשמרו קובצי ייצוא'
];

module.exports = { SENSITIVITY, INCIDENT_CHECKLIST, dataMap, lastActivity, retentionCutoff, retentionCandidates, minimize };
