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
  // kind / ref — לסדר היום של המצב הפשוט (agenda): איזה סוג פריט, ולאיזו רשומה הוא מתייחס
  const add = (area, level, title, detail, view, count = 1, kind = '', ref = '') => items.push({ area, level, levelLabel: LEVELS[level], title, detail, view, count, ...(kind ? { kind } : {}), ...(ref ? { ref } : {}) });

  if (open.has('npo')) {
    const npo = data.npo || {};
    for (const a of N.grantAlerts(npo.grants || [], today)) {
      const name = [a.source, a.program].filter(Boolean).join(' — ') || 'תמיכה';
      const docs = a.missingDocuments ? ` · חסרים ${plural(a.missingDocuments, 'מסמך אחד', 'מסמכים')}` : '';
      if (a.overdue) add('npo', 'urgent', `מועד ההגשה עבר: ${name}`, `המועד היה ${a.deadline}${docs}`, 'npo', 1, 'grant');
      else if (a.soon) add('npo', 'soon', `מועד הגשה מתקרב: ${name}`, `עד ${a.deadline}${docs}`, 'npo', 1, 'grant');
      else add('npo', 'info', `מסמכים חסרים לתמיכה: ${name}`, `מועד ${a.deadline}${docs}`, 'npo', 1, 'grant');
    }
    const tax = N.taxSummary(npo.donations || []);
    if (tax.toReport) {
      const bad = tax.missingDonorId + tax.invalidDonorId;
      add('npo', 'soon', `${plural(tax.toReport, 'תרומה אחת ממתינה', 'תרומות ממתינות')} לדיווח ל"תרומות ישראל"`,
        bad ? `מתוכן ${bad} בלי ת.ז תקינה — יש להשלים לפני הדיווח` : 'דיווח ידני במערכת רשות המסים, ואז רישום מספר האישור', 'npo', tax.toReport, 'tax-report');
    }
    const so = SO.summarize(npo.standingOrders || [], today);
    const risky = so.rows.filter(r => !r.ended && r.failures >= 2);
    for (const r of risky) add('npo', 'urgent', `הוראת קבע נכשלה ${r.failures} פעמים ברצף: ${r.donorName}`, 'כדאי ליצור קשר עם התורם', 'npo', 1, 'standing-failed');
    const missed = so.missedCount - risky.reduce((t, r) => t + r.openMonths.length, 0);
    if (missed > 0) add('npo', 'soon', `${plural(missed, 'חיוב אחד של הוראת קבע לא סומן', 'חיובים של הוראות קבע לא סומנו')}`, 'יש לסמן "התקבל" או "נכשל" לפי דף הבנק', 'npo', missed, 'standing-missed');

    const mem = M.upcoming(npo.memorials || [], today, MEMORIAL_DAYS);
    for (const r of mem.rows) {
      const when = r.daysLeft === 0 ? 'היום' : r.daysLeft === 1 ? 'מחר' : `בעוד ${r.daysLeft} ימים`;
      const who = r.parentName ? `${r.name} ב"ר ${r.parentName}` : r.name;
      const contact = r.contactName ? ` · ${r.contactName}${r.contactPhone ? ' ' + r.contactPhone : ''}` : '';
      add('npo', r.daysLeft <= 1 ? 'soon' : 'info', `יארצייט ${when}: ${who}`,
        `${r.hebrew}${r.uncertain ? ' (התאריך לבירור)' : ''}${contact}`, 'npo', 1, 'yahrzeit');
    }
  }

  if (open.has('gemach')) {
    const gm = data.gemach || {};
    const late = (gm.loans || []).map(l => G.loanSummary(l, today)).filter(s => s.lateCount > 0)
      .sort((a, b) => b.lateAmount - a.lateAmount);
    for (const s of late) {
      add('gemach', 'urgent', `פיגור בהלוואה: ${s.borrowerName}`,
        `${plural(s.lateCount, 'תשלום אחד', 'תשלומים')} בפיגור, ₪${s.lateAmount.toLocaleString('he-IL')}${s.guarantorsCount ? ` · ${s.guarantorsCount} ערבים` : ''}`, 'gemach', 1, 'loan-late', s.id);
    }
    const items = GX.itemsOverview(gm.items || [], gm.lendings || [], today);
    for (const r of items.rows.filter(x => x.overdue)) {
      add('gemach', 'soon', `חפץ לא הוחזר במועד: ${r.name}`, `אצל ${r.lending.borrowerName} מאז ${r.lending.date}, היה להחזיר עד ${r.lending.dueDate}`, 'gemach', 1, 'item-late');
    }
    const waiting = (gm.applications || []).filter(a => a.status === 'interview' || a.status === 'verified');
    if (waiting.length) add('gemach', 'info', `${plural(waiting.length, 'בקשת הלוואה אחת ממתינה', 'בקשות הלוואה ממתינות')} לטיפול`, 'ראיון או אימות ערבים', 'gemach', waiting.length, 'applications');
  }

  if (open.has('chesed')) {
    const rounds = ((data.chesed || {}).rounds || []).filter(r => r.status !== 'closed');
    for (const r of rounds) add('chesed', 'info', `סבב חלוקה פתוח: ${r.name || r.title || 'סבב'}`, r.date ? `תאריך ${r.date}` : 'יש לסגור אחרי שהמסירה הושלמה', 'chesed', 1, 'round');
  }

  if (acct) {
    const pending = AL.pendingList(data.invoices || []);
    if (pending.length) {
      const nums = pending.slice(0, 5).map(p => p.number).join(', ') + (pending.length > 5 ? ' ועוד' : '');
      add('acct', 'soon', `${plural(pending.length, 'חשבונית אחת ממתינה', 'חשבוניות ממתינות')} למספר הקצאה`,
        `חשבוניות ${nums} · לבקש באתר רשות המסים ולהקליד, או לסמן "לא נדרש"`, 'acct-invoices', pending.length, 'allocation');
    }
    // חשבוניות חוזרות שממתינות לאישור (טיוטות מחושבות — לא מופקות לבד)
    const due = RC.drafts(data.recurringInvoices || [], today, 0.18);
    if (due.length) {
      const names = [...new Set(due.map(d => d.customer))].slice(0, 3).join(', ') + (new Set(due.map(d => d.customer)).size > 3 ? ' ועוד' : '');
      add('acct', 'soon', `${plural(due.length, 'חשבונית חוזרת ממתינה', 'חשבוניות חוזרות ממתינות')} לאישור`, `${names} · לבדוק ולהפיק במסך החשבוניות`, 'acct-invoices', due.length, 'recurring');
    }
  }

  items.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const counts = { urgent: 0, soon: 0, info: 0 };
  for (const it of items) counts[it.level] += 1;
  return { date: today, items, counts, total: items.length };
}

// ---------- "מה יש לעשות היום" (מצב פשוט): עד AGENDA_MAX פריטים במילים פשוטות, לכל אחד פעולה אחת ----------
// קריאה בלבד — מחשב רשימה לאדם, לא מבצע דבר (כלל השבת). task — מזהה אשף במודול הכלכלי (ui/wizards.js),
// prefill — מזהה רשומה בלבד (לא סכומים): האשף בודק אותו מול הנתונים לפני שהוא משתמש בו
const AGENDA_MAX = 5;
const AGENDA_TEXT = {
  // prefill בחוזה של המעטפת (shell/tasks.js: name עד 80 תווים) — האשף בוחר את ההלוואה רק כשהשם יחיד; ref — מזהה ההלוואה למודול הכלכלי
  'loan-late': (it) => {
    const name = it.title.replace(/^פיגור בהלוואה: /, '').slice(0, 80).trim();
    return { text: 'הלוואה שלא הוחזרה בזמן: ' + name, task: 'loanPayment', prefill: name ? { name } : undefined, ref: it.ref };
  },
  'tax-report': (it) => ({ text: it.count === 1 ? 'תרומה אחת שצריך לדווח לרשות המסים' : `${it.count} תרומות שצריך לדווח לרשות המסים` }),
  'grant': (it) => ({ text: it.title.replace(/^מועד ההגשה עבר: /, 'תמיכה שעבר מועד ההגשה שלה: ').replace(/^מועד הגשה מתקרב: /, 'תמיכה לדווח בקרוב: ') }),
};
// openInvoices: { count, late } מחשבוניות פתוחות (homeSummary.openInvoices) — רק כשהנהלת החשבונות פתוחה
function agenda(brief, { openInvoices = null } = {}) {
  const list = [];
  for (const it of (brief && Array.isArray(brief.items) ? brief.items : [])) {
    const extra = AGENDA_TEXT[it.kind] ? AGENDA_TEXT[it.kind](it) : {};
    list.push({ kind: it.kind || '', level: it.level, text: extra.text || it.title, detail: it.detail || '', view: it.view,
      ...(extra.task ? { task: extra.task } : {}), ...(extra.prefill ? { prefill: extra.prefill } : {}), ...(extra.ref ? { ref: extra.ref } : {}) });
  }
  if (openInvoices && openInvoices.count > 0) {
    const n = openInvoices.count;
    const late = openInvoices.late || 0;
    list.push({ kind: 'open-invoices', level: late ? 'urgent' : 'info',
      text: n === 1 ? 'חשבונית אחת עוד לא שולמה' : `${n} חשבוניות עוד לא שולמו`,
      detail: late ? (late === 1 ? 'אחת מהן כבר באיחור' : `${late} מהן כבר באיחור`) : 'כשהלקוח משלם — רושמים קבלה',
      view: 'acct-invoices', task: 'receipt' });
  }
  list.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return { total: list.length, items: list.slice(0, AGENDA_MAX) };
}

module.exports = { LEVELS, SOURCES, MEMORIAL_DAYS, AGENDA_MAX, morningBrief, agenda };
