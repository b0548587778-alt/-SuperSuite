// לוח בוקר למנהל העמותה: כל מה שדורש טיפול היום, ממקום אחד — תמיכות, דיווח ל"תרומות ישראל",
// הוראות קבע, גמ"ח, חסד והנצחות. קריאה בלבד: הנתונים נשארים במודולים שלהם, וכל שורה מפנה למסך שלה.
// אין כאן פנייה אוטומטית לאיש — רק רשימת עבודה לאדם.
const N = require('./npo');
const SO = require('./standingOrders');
const G = require('./gemach');
const GX = require('./gemachExtra');
const M = require('./memorials');
const AL = require('./allocation');
const RC = require('./recurring');
const { isDay } = require('./dates');

const LEVELS = { urgent: 'דחוף', soon: 'בקרוב', info: 'לידיעה' };
const ORDER = { urgent: 0, soon: 1, info: 2 };
const SOURCES = ['npo', 'gemach', 'chesed'];
const MEMORIAL_DAYS = 7;

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

// data: כל הנתונים (db.load). sources: התחומים הפתוחים ברישיון (gate.peopleSources), ברירת מחדל — כולם.
// acct: הנהלת החשבונות פתוחה ברישיון (חשבוניות שממתינות למספר הקצאה)
function morningBrief(data, today, { sources = SOURCES, acct = false } = {}) {
  if (!isDay(today)) throw new Error('תאריך לא תקין');
  const open = new Set(sources);
  const items = [];
  const add = (area, level, title, detail, view, count = 1) => items.push({ area, level, levelLabel: LEVELS[level], title, detail, view, count });

  if (open.has('npo')) {
    const npo = data.npo || {};
    for (const a of N.grantAlerts(npo.grants || [], today)) {
      const name = [a.source, a.program].filter(Boolean).join(' — ') || 'תמיכה';
      const docs = a.missingDocuments ? ` · חסרים ${plural(a.missingDocuments, 'מסמך אחד', 'מסמכים')}` : '';
      if (a.overdue) add('npo', 'urgent', `מועד ההגשה עבר: ${name}`, `המועד היה ${a.deadline}${docs}`, 'npo');
      else if (a.soon) add('npo', 'soon', `מועד הגשה מתקרב: ${name}`, `עד ${a.deadline}${docs}`, 'npo');
      else add('npo', 'info', `מסמכים חסרים לתמיכה: ${name}`, `מועד ${a.deadline}${docs}`, 'npo');
    }
    const tax = N.taxSummary(npo.donations || []);
    if (tax.toReport) {
      const bad = tax.missingDonorId + tax.invalidDonorId;
      add('npo', 'soon', `${plural(tax.toReport, 'תרומה אחת ממתינה', 'תרומות ממתינות')} לדיווח ל"תרומות ישראל"`,
        bad ? `מתוכן ${bad} בלי ת.ז תקינה — יש להשלים לפני הדיווח` : 'דיווח ידני במערכת רשות המסים, ואז רישום מספר האישור', 'npo', tax.toReport);
    }
    const so = SO.summarize(npo.standingOrders || [], today);
    const risky = so.rows.filter(r => !r.ended && r.failures >= 2);
    for (const r of risky) add('npo', 'urgent', `הוראת קבע נכשלה ${r.failures} פעמים ברצף: ${r.donorName}`, 'כדאי ליצור קשר עם התורם', 'npo');
    const missed = so.missedCount - risky.reduce((t, r) => t + r.openMonths.length, 0);
    if (missed > 0) add('npo', 'soon', `${plural(missed, 'חיוב אחד של הוראת קבע לא סומן', 'חיובים של הוראות קבע לא סומנו')}`, 'יש לסמן "התקבל" או "נכשל" לפי דף הבנק', 'npo', missed);

    const mem = M.upcoming(npo.memorials || [], today, MEMORIAL_DAYS);
    for (const r of mem.rows) {
      const when = r.daysLeft === 0 ? 'היום' : r.daysLeft === 1 ? 'מחר' : `בעוד ${r.daysLeft} ימים`;
      const who = r.parentName ? `${r.name} ב"ר ${r.parentName}` : r.name;
      const contact = r.contactName ? ` · ${r.contactName}${r.contactPhone ? ' ' + r.contactPhone : ''}` : '';
      add('npo', r.daysLeft <= 1 ? 'soon' : 'info', `יארצייט ${when}: ${who}`,
        `${r.hebrew}${r.uncertain ? ' (התאריך לבירור)' : ''}${contact}`, 'npo');
    }
  }

  if (open.has('gemach')) {
    const gm = data.gemach || {};
    const late = (gm.loans || []).map(l => G.loanSummary(l, today)).filter(s => s.lateCount > 0)
      .sort((a, b) => b.lateAmount - a.lateAmount);
    for (const s of late) {
      add('gemach', 'urgent', `פיגור בהלוואה: ${s.borrowerName}`,
        `${plural(s.lateCount, 'תשלום אחד', 'תשלומים')} בפיגור, ₪${s.lateAmount.toLocaleString('he-IL')}${s.guarantorsCount ? ` · ${s.guarantorsCount} ערבים` : ''}`, 'gemach');
    }
    const items = GX.itemsOverview(gm.items || [], gm.lendings || [], today);
    for (const r of items.rows.filter(x => x.overdue)) {
      add('gemach', 'soon', `חפץ לא הוחזר במועד: ${r.name}`, `אצל ${r.lending.borrowerName} מאז ${r.lending.date}, היה להחזיר עד ${r.lending.dueDate}`, 'gemach');
    }
    const waiting = (gm.applications || []).filter(a => a.status === 'interview' || a.status === 'verified');
    if (waiting.length) add('gemach', 'info', `${plural(waiting.length, 'בקשת הלוואה אחת ממתינה', 'בקשות הלוואה ממתינות')} לטיפול`, 'ראיון או אימות ערבים', 'gemach', waiting.length);
  }

  if (open.has('chesed')) {
    const rounds = ((data.chesed || {}).rounds || []).filter(r => r.status !== 'closed');
    for (const r of rounds) add('chesed', 'info', `סבב חלוקה פתוח: ${r.name || r.title || 'סבב'}`, r.date ? `תאריך ${r.date}` : 'יש לסגור אחרי שהמסירה הושלמה', 'chesed');
  }

  if (acct) {
    const pending = AL.pendingList(data.invoices || []);
    if (pending.length) {
      const nums = pending.slice(0, 5).map(p => p.number).join(', ') + (pending.length > 5 ? ' ועוד' : '');
      add('acct', 'soon', `${plural(pending.length, 'חשבונית אחת ממתינה', 'חשבוניות ממתינות')} למספר הקצאה`,
        `חשבוניות ${nums} · לבקש באתר רשות המסים ולהקליד, או לסמן "לא נדרש"`, 'acct-invoices', pending.length);
    }
    // חשבוניות חוזרות שממתינות לאישור (טיוטות מחושבות — לא מופקות לבד)
    const due = RC.drafts(data.recurringInvoices || [], today, 0.18);
    if (due.length) {
      const names = [...new Set(due.map(d => d.customer))].slice(0, 3).join(', ') + (new Set(due.map(d => d.customer)).size > 3 ? ' ועוד' : '');
      add('acct', 'soon', `${plural(due.length, 'חשבונית חוזרת ממתינה', 'חשבוניות חוזרות ממתינות')} לאישור`, `${names} · לבדוק ולהפיק במסך החשבוניות`, 'acct-invoices', due.length);
    }
  }

  items.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const counts = { urgent: 0, soon: 0, info: 0 };
  for (const it of items) counts[it.level] += 1;
  return { date: today, items, counts, total: items.length };
}

module.exports = { LEVELS, SOURCES, MEMORIAL_DAYS, morningBrief };
