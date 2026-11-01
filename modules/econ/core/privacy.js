// כלי עזר לתיקון 13 לחוק הגנת הפרטיות — לא ייעוץ משפטי.
// מיפוי מאגרים (מה נשמר, כמה, מי רואה, איפה), מזעור נזקקים לא פעילים לפי בקשת מנהל, ורשימת בדיקה לאירוע אבטחה.
// אין כאן פעולה אוטומטית: המזעור רץ רק כשמנהל מאשר רשימה מוצגת מראש.
// PLAN.md 9.15: הצעת רמת אבטחה, מדיניות שמירה גם לתורמים/לווים/תיקי משכנתאות, ויומן בקשות עיון ותיקון.
// המקורות: docs/LEGAL-REQUIREMENTS.md, סעיף 4.

const SENSITIVITY = { regular: 'רגיל', sensitive: 'רגיש — מצב כלכלי', high: 'רגיש מאוד — מתן בסתר' };
const len = (v) => (Array.isArray(v) ? v.length : 0);

// ---------- תיבות ההודעות שבתוכנה (ממצא 26) — אינן במסד, ולכן מגיעות מבחוץ (ipc.js, privacy:getMap).
// mailboxes: { platform: 'win' | 'android', system?: { count }, owner?: { count } }. תיבה מופיעה רק כשהיא קיימת במחשב הזה
// (המערכת: שרת ההודעות מוגדר או שיש בה שיחות; מנהל-העל: המצב הוגדר כאן). count — מספר השיחות, null — לא נספר
const MAILBOX_RETENTION = 'בשרת ההודעות — מוצפנות מקצה לקצה, והודעה שלא נקראה נמחקת אחרי 60 יום; במחשב — נשמרות עד שנמחקות (עד 5,000 ההודעות האחרונות בכל תיבה)';
function mailboxRows(mb) {
  if (!mb || typeof mb !== 'object') return [];
  const android = mb.platform === 'android';
  const encryption = android ? 'באחסון של האפליקציה במכשיר, בלי הצפנה נוספת של התוכנה'
    : 'מוצפן (AES-256-GCM) במפתח שנגזר ממפתח הגיבוי האוטומטי (DPAPI); בלי הצפנת מערכת — גלוי, כמו המסד';
  const count = (x) => (x && Number.isSafeInteger(x.count) && x.count >= 0 ? x.count : null);
  const where = (file) => (android ? 'האחסון המקומי של האפליקציה' : `הקובץ ${file} בתיקיית נתוני התוכנה`);
  const rows = [];
  if (mb.system) {
    rows.push({ area: 'הודעות בתוכנה — תיבת המערכת', count: count(mb.system),
      fields: 'לכל שיחה: שם המערכת או איש הקשר, תוכן ההודעות והקבצים המצורפים (עשויים לכלול פרטים אישיים), פרופיל עסקי (טלפון, דוא"ל, כתובת), תוויות והערות פנימיות',
      sensitivity: 'regular', access: 'כל המשתמשים המחוברים — קריאה; שליחה — עורך ומנהל',
      storedAt: where('messages.bin'), encryption, retention: MAILBOX_RETENTION, backup: 'נכלל בגיבוי המלא של התוכנה (מוצפן)' });
  }
  if (mb.owner) {
    rows.push({ area: 'הודעות בתוכנה — תיבת מנהל-העל', count: count(mb.owner),
      fields: 'לכל שיחה: שם המערכת (הלקוח) או איש הקשר, תוכן ההודעות והקבצים המצורפים, פרופיל עסקי, תוויות והערות פנימיות',
      sensitivity: 'regular', access: 'מנהל בלבד, אחרי פתיחת מצב מנהל-העל בסיסמה',
      storedAt: where('owner/messages.bin'), encryption, retention: MAILBOX_RETENTION, backup: 'לא נכלל בגיבוי של הארגון (כמו שאר קבצי מנהל-העל)' });
  }
  return rows;
}

// opts.mailboxes — תיבות ההודעות (mailboxRows למעלה); בלעדיו — רק המאגרים שבמסד
function dataMap(data, userCounts = {}, opts = {}) {
  const npo = data.npo || {};
  const gm = data.gemach || {};
  const ch = data.chesed || {};
  const bens = Array.isArray(ch.beneficiaries) ? ch.beneficiaries : [];
  const conf = bens.filter(b => b.tier === 'confidential').length;
  const all = 'כל המשתמשים המחוברים (צופה, עורך, מנהל)';
  const rows = [
    { area: 'עמותה — תורמים וקבלות', count: len(npo.donations), fields: 'שם, ת.ז, טלפון, כתובת, סכום', sensitivity: 'regular', access: all },
    { area: 'עמותה — הוראות קבע', count: len(npo.standingOrders), fields: 'שם, ת.ז, טלפון, כתובת, סכום חודשי; בהוראה בנקאית במס"ב — בנק, סניף וחשבון (בלי פרטי אשראי)', sensitivity: 'regular', access: all },
    { area: 'עמותה — הנצחות', count: len(npo.memorials), fields: 'שם הנפטר, איש קשר, ת.ז וטלפון של איש הקשר', sensitivity: 'regular', access: all },
    { area: 'גמ"ח — לווים וערבים', count: len(gm.loans), fields: 'שם, ת.ז, טלפון, סכום הלוואה, פיגורים, ערבים; בחיוב במס"ב — בנק, סניף וחשבון', sensitivity: 'sensitive', access: all },
    { area: 'גמ"ח — מפקידים', count: len(gm.deposits), fields: 'שם, סכום', sensitivity: 'regular', access: all },
    { area: 'גמ"ח — בקשות הלוואה', count: len(gm.applications), fields: 'פרטי המבקש והערבים (שם, ת.ז, טלפון), סכום מבוקש, מצב הבקשה והערות הראיון', sensitivity: 'sensitive', access: all },
    { area: 'גמ"ח חפצים — שואלים', count: len(gm.lendings), fields: 'שם, ת.ז, טלפון, הפריט שהושאל, פיקדון ותאריכים', sensitivity: 'regular', access: all },
    { area: 'חסד — נזקקים (רגילים)', count: bens.length - conf, fields: 'משפחה, ראש משפחה, ת.ז, נפשות, טלפון, כתובת, הערות', sensitivity: 'sensitive', access: all },
    { area: 'חסד — נזקקים חסויים', count: conf, fields: 'כמו נזקקים — מוסתר בשרת', sensitivity: 'high', access: 'מנהל בלבד (צפייה נרשמת ביומן הביקורת)' },
    { area: 'חסד — מתנדבים', count: len(ch.volunteers), fields: 'שם, טלפון, אזור, זמינות', sensitivity: 'regular', access: all },
    { area: 'ייעוץ משכנתאות — תיקי לקוחות', count: len(data.mortgageAdvisor && data.mortgageAdvisor.clients), fields: 'פרטי לקוח, נכס והצעות משכנתא', sensitivity: 'sensitive', access: all },
    { area: 'נדל"ן ותיווך — לקוחות', count: len(data.realty && data.realty.clients), fields: 'שם, ת.ז (רשות), טלפון, דוא"ל, תקציב ודרישות', sensitivity: 'regular', access: all },
    { area: 'נדל"ן ותיווך — הזמנות שירותי תיווך', count: len(data.realty && data.realty.orders), fields: 'לקוח (מהרשימה), כתובת הלקוח, תיאור הנכס, מחיר ועמלה', sensitivity: 'regular', access: all },
    { area: 'נדל"ן ותיווך — עסקאות', count: len(data.realty && data.realty.deals), fields: 'קונה ומוכר (מהרשימה), מחיר, מועדים, עמלות ותשלומים; קישור לתיק משכנתא', sensitivity: 'regular', access: all },
    { area: 'שמאות מקרקעין — תיקי שומה', count: len(data.realEstate && data.realEstate.cases), fields: 'שם מזמין השומה, ת.ז, טלפון, כתובת הנכס, גוש/חלקה ושווי', sensitivity: 'sensitive', access: all },
    { area: 'אנשי קשר', count: len(data.contacts), fields: 'שם, טלפון, דוא"ל, כתובת', sensitivity: 'regular', access: all },
    { area: 'הנהלת חשבונות — לקוחות בחשבוניות', count: len(data.invoices), fields: 'שם הלקוח, ע.מ / ת.ז (רשות), כתובת, פריטים וסכומים', sensitivity: 'regular', access: all },
    { area: 'הנהלת חשבונות — ספקים ביומן', count: (Array.isArray(data.journal) ? data.journal : []).filter(e => e && (e.vatDoc || e.supplierDoc)).length,
      fields: 'שם הספק, ע.מ (בעוסק שהוא יחיד — מספר ת.ז), מספר החשבונית, תאריך וסכומים', sensitivity: 'regular', access: all },
    { area: 'שמאות (במחסן המוצפן של המודול)', count: null,
      fields: 'פרטי לקוחות, פריטים, שטרי קנייה ותמונות', sensitivity: 'sensitive', access: 'משתמשים מחוברים עם רישיון למודול' }
  ];
  const mail = mailboxRows(opts && opts.mailboxes);
  rows.push(...mail);
  return {
    rows: rows.map(r => ({ ...r, sensitivityLabel: SENSITIVITY[r.sensitivity] })),
    users: { admin: userCounts.admin || 0, editor: userCounts.editor || 0, viewer: userCounts.viewer || 0, accountant: userCounts.accountant || 0 },
    storage: [
      'מסד נתונים מקומי במחשב (תיקיית נתוני המשתמש של התוכנה) — לא נשלח לאינטרנט',
      'גיבוי ידני ואוטומטי — מוצפן בסיסמה (קובץ ‎.ssbk)',
      'קובצי ייצוא (CSV / PDF) — נשמרים במקום שהמשתמש בוחר, ללא הצפנה. יש לשמור ולמחוק אותם בהתאם',
      ...mail.map(r => `${r.area}: ${r.storedAt}; ${r.encryption}. ${r.retention}. גיבוי: ${r.backup}`)
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

// ---------- רמת אבטחה (תקנות הגנת הפרטיות (אבטחת מידע), 2017 — לפי דף הרשות להגנת הפרטיות)
// יחיד: עד 2 מורשי גישה נוספים ופחות מ-10,000 איש. בינונית: בין היתר מאגר עם מידע רגיש.
// גבוהה: מידע רגיש על 100,000 איש ומעלה, או יותר מ-100 מורשי גישה. בסיסית: כל השאר.
const LEVELS = { individual: 'מאגר בידי יחיד', basic: 'רמת אבטחה בסיסית', medium: 'רמת אבטחה בינונית', high: 'רמת אבטחה גבוהה' };
const LEVEL_SOURCE = 'https://www.gov.il/he/pages/protection_of_privacy_regulations_data_security';

function suggestLevel(map) {
  const rows = (map && map.rows) || [];
  const u = (map && map.users) || {};
  const users = ['admin', 'editor', 'viewer', 'accountant'].reduce((t, k) => t + (Number(u[k]) || 0), 0);
  const total = rows.reduce((t, r) => t + (Number(r.count) || 0), 0);
  const sensitive = rows.filter(r => r.sensitivity !== 'regular' && Number(r.count) > 0);
  const sensitiveCount = sensitive.reduce((t, r) => t + Number(r.count), 0);
  const reasons = [];
  let level;
  if (sensitiveCount >= 100000 || users > 100) {
    level = 'high';
    if (sensitiveCount >= 100000) reasons.push(`מידע רגיש על כ-${sensitiveCount.toLocaleString('he-IL')} רשומות (100,000 ומעלה)`);
    if (users > 100) reasons.push(`${users} מורשי גישה (יותר מ-100)`);
  } else if (sensitive.length) {
    level = 'medium';
    reasons.push('יש במאגר מידע שסומן רגיש: ' + sensitive.map(r => r.area).join('; '));
  } else if (users <= 3 && total < 10000) {
    level = 'individual';
    reasons.push(`${users} מורשי גישה (עד 3) ו-${total.toLocaleString('he-IL')} רשומות (פחות מ-10,000), בלי מידע רגיש`);
  } else {
    level = 'basic';
    reasons.push(users > 3 ? `${users} מורשי גישה (יותר מ-3)` : `${total.toLocaleString('he-IL')} רשומות (10,000 ומעלה)`);
  }
  return {
    level, label: LEVELS[level], reasons, users, records: total, sensitiveRecords: sensitiveCount,
    reportBreach: level === 'medium' || level === 'high',
    note: 'הצעה בלבד, לפי מספר הרשומות (אדם אחד יכול להופיע בכמה רשומות, ולכן זו הערכה מלמעלה), הרגישות שסומנה ומספר המשתמשים בתוכנה. ' +
      'השאלה אם נתוני גמ"ח וחסד הם "מידע בעל רגישות מיוחדת" — לבירור עם עורך דין.',
    source: LEVEL_SOURCE
  };
}

// ---------- מדיניות שמירה לכל סוג רשומה. בכל הסוגים: רק תצוגה מקדימה ואישור מנהל, והשרת בודק מחדש
const idKey = (raw) => { const d = String(raw ?? '').replace(/\D/g, ''); return d && !/^0+$/.test(d) ? d.padStart(9, '0') : ''; };
const normName = (v) => String(v ?? '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim();
const day = (v) => String(v || '').slice(0, 10);
const maxDay = (...vals) => vals.map(day).filter(Boolean).sort().pop() || '';

const RETENTION_KINDS = {
  beneficiaries: { label: 'נזקקים לא פעילים (חסד)', minYears: 1,
    removes: 'ראש המשפחה, ת.ז, טלפון, כתובת והערות. נשמרים: שם המשפחה, גודל המשפחה והאזור (להיסטוריית החלוקות).' },
  donors: { label: 'תורמים שלא תרמו בתקופה (עמותה)', minYears: 7,
    removes: 'טלפון וכתובת בכל התרומות של התורם ובהוראות קבע שהסתיימו, ומספר ההמחאה, הבנק והסניף בהמחאות דחויות. ' +
      'נשמרים: שם, ת.ז, סכום, תאריכי הפירעון ומספר הקבלה. ' +
      'קבלה שתודפס מחדש תצא בלי כתובת. מינימום 7 שנים — כמו תקופת השמירה של קבלות.' },
  borrowers: { label: 'לווים בהלוואות שנפרעו או בוטלו (גמ"ח)', minYears: 1,
    removes: 'טלפון, כתובת והערות של הלווה, וטלפון הערבים. נשמרים: שמות, ת.ז, סכום ולוח התשלומים.' },
  mortgageClients: { label: 'תיקי ייעוץ משכנתאות שלא עודכנו', minYears: 1,
    removes: 'טלפון והערות. נשמרים: שם הלקוח, הבנק, הסכומים וההצעות.' },
  itemBorrowers: { label: 'שואלי חפצים שהחזירו (גמ"ח חפצים)', minYears: 1,
    removes: 'הטלפון וההערות בהשאלות שהוחזרו. נשמרים: שם, ת.ז, הפריט, התאריכים והפיקדון (להיסטוריית הפריט).' },
  realtyClients: { label: 'לקוחות נדל"ן שלא עודכנו (תיווך)', minYears: 1,
    removes: 'ת.ז, טלפון, דוא"ל, הערות ודרישות החיפוש, וכתובת הלקוח בהזמנות שירותי התיווך. נשמרים: השם, סוג הלקוח והעסקאות. לקוח עם עסקה פתוחה אינו נכלל.' }
};

function retentionKind(kind) {
  const k = kind || 'beneficiaries';
  if (!RETENTION_KINDS[k]) throw new Error('סוג רשומות לא מוכר');
  return k;
}

function cutoffFor(kind, today, years) {
  const k = RETENTION_KINDS[retentionKind(kind)];
  if (Number(years) < k.minYears) throw new Error(`ב${k.label} תקופת השמירה היא לפחות ${k.minYears} שנים`);
  return retentionCutoff(today, years);
}

// מפתח תורם: ת.ז, ובלעדיה — השם
const donorKey = (d) => (idKey(d.donorId) ? 'id:' + idKey(d.donorId) : 'name:' + normName(d.donorName));

function candidatesFor(data, kind, today, years) {
  const k = retentionKind(kind);
  const cutoff = cutoffFor(k, today, years);
  if (k === 'beneficiaries') {
    return retentionCandidates(data.chesed || {}, today, years).map(x => ({ ...x, label: x.familyName }));
  }
  if (k === 'donors') {
    const npo = data.npo || {};
    const thisMonth = String(today).slice(0, 7);
    const byDonor = new Map();
    for (const d of npo.donations || []) {
      if (!normName(d.donorName) && !idKey(d.donorId)) continue;
      const key = donorKey(d);
      const cur = byDonor.get(key) || { id: key, label: normName(d.donorName), last: '', contact: false };
      cur.last = maxDay(cur.last, d.date);
      if (d.donorPhone || d.donorAddress) cur.contact = true;
      if (Array.isArray(d.cheques) && d.cheques.some(c => c.number || c.bank || c.branch)) cur.contact = true;
      byDonor.set(key, cur);
    }
    for (const o of npo.standingOrders || []) {
      const key = donorKey(o);
      const cur = byDonor.get(key);
      if (!cur) continue;
      // הוראת קבע פעילה — התורם פעיל
      if (!o.endMonth || o.endMonth >= thisMonth) cur.active = true;
      else if (o.donorPhone || o.donorAddress) cur.contact = true;
    }
    return [...byDonor.values()].filter(x => !x.active && x.contact && x.last && x.last < cutoff)
      .map(({ id, label, last }) => ({ id, label, last })).sort((a, b) => a.last.localeCompare(b.last));
  }
  if (k === 'borrowers') {
    return ((data.gemach && data.gemach.loans) || [])
      .filter(l => (l.status === 'closed' || l.status === 'cancelled') && !l.privacyMinimizedAt)
      .filter(l => l.borrowerPhone || l.borrowerAddress || l.notes || (l.guarantors || []).some(g => g.phone))
      .map(l => ({ id: l.id, label: normName(l.borrowerName), last: maxDay(l.issueDate, l.updatedAt, l.cancelledAt, ...(l.schedule || []).map(x => x.paidDate)) }))
      .filter(x => x.last && x.last < cutoff).sort((a, b) => a.last.localeCompare(b.last));
  }
  if (k === 'itemBorrowers') {
    // רק השאלה שהוחזרה; השאלה פתוחה — השואל עדיין פעיל
    return ((data.gemach && data.gemach.lendings) || [])
      .filter(l => l && l.id && l.returnedAt && !l.privacyMinimizedAt && (l.borrowerPhone || l.notes))
      .map(l => ({ id: l.id, label: normName(l.borrowerName), last: maxDay(l.returnedAt, l.date) }))
      .filter(x => x.last && x.last < cutoff).sort((a, b) => a.last.localeCompare(b.last));
  }
  if (k === 'realtyClients') {
    const r = data.realty || {};
    const deals = r.deals || [];
    const busy = new Set(deals.filter(d => d.stage !== 'closed' && d.stage !== 'lost').flatMap(d => [d.buyerClientId, d.sellerClientId]));
    return (r.clients || [])
      .filter(c => !c.privacyMinimizedAt && !busy.has(c.id) && (c.idNumber || c.phone || c.email || c.notes))
      .map(c => ({ id: c.id, label: normName(c.name),
        last: maxDay(c.updatedAt, c.createdAt, ...deals.filter(d => d.buyerClientId === c.id || d.sellerClientId === c.id).map(d => d.updatedAt)) }))
      .filter(x => x.last && x.last < cutoff).sort((a, b) => a.last.localeCompare(b.last));
  }
  return ((data.mortgageAdvisor && data.mortgageAdvisor.clients) || [])
    .filter(c => !c.privacyMinimizedAt && (c.phone || c.notes))
    .map(c => ({ id: c.id, label: normName(c.name), last: maxDay(c.updatedAt, c.createdAt) }))
    .filter(x => x.last && x.last < cutoff).sort((a, b) => a.last.localeCompare(b.last));
}

// פרטי חשבון לחיוב (מס"ב) נמחקים במזעור — ההוראה או ההלוואה כבר לא פעילה
const withoutBank = ({ bankAccount, ...rest }) => rest;

// מזעור בפועל — רק מזהים שעדיין מועמדים ברגע הביצוע. מחזיר כמה מוזערו
function applyRetention(data, kind, ids, today, years, at) {
  const k = retentionKind(kind);
  const allowed = new Set(candidatesFor(data, k, today, years).map(x => x.id));
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!wanted.size) throw new Error('לא נבחרו רשומות למזעור');
  const ok = (id) => wanted.has(id) && allowed.has(id);
  let done = 0;
  if (k === 'beneficiaries') {
    data.chesed.beneficiaries = data.chesed.beneficiaries.map(b => (ok(b.id) ? (done++, minimize(b, at)) : b));
  } else if (k === 'donors') {
    const hit = new Set();
    data.npo.donations = data.npo.donations.map(d => {
      const key = donorKey(d);
      if (!ok(key)) return d;
      hit.add(key);
      // המחאות דחויות: נשמרים הפירעון והסכום (הקבלה); מספר ההמחאה, הבנק והסניף נמחקים
      const cheques = Array.isArray(d.cheques) ? { cheques: d.cheques.map(c => ({ number: '', bank: '', branch: '', dueDate: c.dueDate, amountAg: c.amountAg })), reference: '' } : {};
      const bounced = d.bouncedCheque ? { bouncedCheque: { number: '', bank: '', dueDate: d.bouncedCheque.dueDate } } : {};
      return { ...d, ...cheques, ...bounced, donorPhone: '', donorAddress: '', privacyMinimizedAt: at };
    });
    data.npo.standingOrders = (data.npo.standingOrders || []).map(o => (ok(donorKey(o)) ? { ...withoutBank(o), donorPhone: '', donorAddress: '', privacyMinimizedAt: at } : o));
    done = hit.size;
  } else if (k === 'borrowers') {
    data.gemach.loans = data.gemach.loans.map(l => (ok(l.id)
      ? (done++, { ...withoutBank(l), borrowerPhone: '', borrowerAddress: '', notes: '', guarantors: (l.guarantors || []).map(g => ({ ...g, phone: '' })), privacyMinimizedAt: at })
      : l));
  } else if (k === 'itemBorrowers') {
    data.gemach.lendings = data.gemach.lendings.map(l => (ok(l.id) ? (done++, { ...l, borrowerPhone: '', notes: '', privacyMinimizedAt: at }) : l));
  } else if (k === 'realtyClients') {
    data.realty.clients = data.realty.clients.map(c => {
      if (!ok(c.id)) return c;
      done++;
      const { areas, types, minRooms, maxRooms, budgetMinAg, budgetMaxAg, needsMortgage, ...rest } = c;
      return { ...rest, idNumber: '', phone: '', email: '', notes: '', active: false, privacyMinimizedAt: at };
    });
    // כתובת הלקוח בהזמנות שירותי התיווך שלו
    const gone = new Set(data.realty.clients.filter(c => c.privacyMinimizedAt === at && ok(c.id)).map(c => c.id));
    data.realty.orders = (data.realty.orders || []).map(o => (gone.has(o.clientId) && o.clientAddress ? { ...o, clientAddress: '' } : o));
  } else {
    data.mortgageAdvisor.clients = data.mortgageAdvisor.clients.map(c => (ok(c.id) ? (done++, { ...c, phone: '', notes: '', privacyMinimizedAt: at }) : c));
  }
  return { minimized: done, skipped: wanted.size - done };
}

// ---------- יומן בקשות של נושאי מידע (עיון — סעיף 13, תיקון — סעיף 14)
const REQUEST_TYPES = { access: 'עיון במידע', correction: 'תיקון מידע', deletion: 'מחיקת מידע', other: 'אחר' };
const REQUEST_STATUSES = { open: 'פתוחה', done: 'טופלה', rejected: 'נדחתה' };
// מועד יעד לתשובה: 30 יום מהקבלה — לבדוק מול התקנות ועם עורך דין
const RESPONSE_DAYS = 30;
const MAX_REQUESTS = 5000;
// תאריך אמיתי בלבד: 2026-02-31 נדחה (Date.parse מגלגל אותו ל-3.3)
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10))).toISOString().slice(0, 10) === v;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function addDays(isoDay, n) {
  const d = new Date(isoDay + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function validateRequest(input, count = 0) {
  if (!input || typeof input !== 'object') throw new Error('בקשה לא תקינה');
  if (count >= MAX_REQUESTS) throw new Error('הגעת למספר המקסימלי של בקשות');
  const type = REQUEST_TYPES[input.type] ? input.type : '';
  if (!type) throw new Error('יש לבחור את סוג הבקשה');
  const name = clip(input.name, 120);
  if (!name) throw new Error('שם המבקש חובה');
  const receivedDate = String(input.receivedDate || '');
  if (!isDay(receivedDate)) throw new Error('תאריך קבלת הבקשה אינו תקין');
  return { type, name, idNumber: clip(String(input.idNumber || '').replace(/\D/g, ''), 9), receivedDate,
    dueDate: addDays(receivedDate, RESPONSE_DAYS), status: 'open', notes: clip(input.notes, 1000) };
}

function closeRequest(req, input = {}) {
  if (req.status !== 'open') throw new Error('הבקשה כבר נסגרה');
  const status = input.status === 'rejected' ? 'rejected' : 'done';
  const handledDate = String(input.handledDate || '');
  if (!isDay(handledDate)) throw new Error('תאריך הטיפול אינו תקין');
  if (handledDate < req.receivedDate) throw new Error('תאריך הטיפול לפני תאריך קבלת הבקשה');
  const notes = clip(input.notes, 1000);
  if (status === 'rejected' && !notes) throw new Error('בדחיית בקשה יש לרשום את הסיבה');
  return { ...req, status, handledDate, notes: notes || req.notes };
}

// תצוגה: תוויות, ובקשה פתוחה שעבר המועד שלה — באיחור
function requestView(req, today) {
  return { ...req, typeLabel: REQUEST_TYPES[req.type] || req.type, statusLabel: REQUEST_STATUSES[req.status] || req.status,
    overdue: req.status === 'open' && !!today && req.dueDate < today };
}

const INCIDENT_CHECKLIST = [
  'לעצור את הדליפה: לנתק את המחשב מהרשת, להחליף סיסמאות של משתמשי התוכנה ולחסום משתמש חשוד',
  'לתעד: מה קרה, מתי התגלה, אילו סוגי מידע נחשפו (לפי מיפוי המאגרים), כמה אנשים',
  'לשמור ראיות: לייצא את יומן הביקורת ולא למחוק קבצים',
  'לבדוק מול עורך דין / ממונה הגנת הפרטיות אם נדרש דיווח לרשות להגנת הפרטיות ולאנשים שנפגעו, ובאיזה מועד. במאגר ברמה בינונית או גבוהה — אירוע חמור מדווח מיד (תקנה 11(ד)(1)), בטופס: https://www.gov.il/he/service/report-of-data-breach',
  'לשחזר מגיבוי מוצפן תקין אם הנתונים שובשו',
  'לסכם לקחים: הרשאות, סיסמאות, היכן נשמרו קובצי ייצוא'
];

module.exports = {
  SENSITIVITY, INCIDENT_CHECKLIST, LEVELS, RETENTION_KINDS, REQUEST_TYPES, REQUEST_STATUSES, RESPONSE_DAYS,
  dataMap, suggestLevel, lastActivity, retentionCutoff, retentionCandidates, minimize, candidatesFor, applyRetention,
  validateRequest, closeRequest, requestView, addDays
};
