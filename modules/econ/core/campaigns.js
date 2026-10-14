// קמפיינים לעמותה: יעד, תקופה, ותורם מכפיל אופציונלי (יחס ותקרה). תרומה משויכת לקמפיין בשדה campaignId.
// ההכפלה היא חישוב תצוגה בלבד — הכסף של התורם המכפיל נרשם כתרומה רגילה (עם קבלה) כשהוא מתקבל בפועל.
const MAX_CAMPAIGNS = 500;
const MAX_AMBASSADORS = 300;

// שגרירים: שורה לכל שגריר — "שם, קוד, יעד אישי" (קוד ויעד לא חובה). שגריר קיים נשמר לפי הקוד (או השם),
// כדי שהמזהה שלו — והשיוך בתרומות — לא ישתנה בעריכה. שגריר שהוסר ויש לו תרומות לא נמחק.
function parseAmbassadorsText(text) {
  return String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
    const [name = '', code = '', goal = ''] = line.split(',').map(s => s.trim());
    return { name, code, goal };
  });
}

function validateAmbassadors(list, prev = [], usedIds = new Set(), newId = () => Math.random().toString(36).slice(2)) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > MAX_AMBASSADORS) throw new Error(`ניתן להגדיר עד ${MAX_AMBASSADORS} שגרירים`);
  const codes = new Set();
  const out = arr.map((a, i) => {
    const name = str(a && a.name, 120, 'שם השגריר');
    if (!name) throw new Error(`שורה ${i + 1} ברשימת השגרירים: חסר שם`);
    let code = str(a.code, 30, 'קוד השגריר') || String(i + 1);
    if (!/^[\w\u0590-\u05FF-]+$/.test(code)) throw new Error(`קוד השגריר "${code}" יכול להכיל אותיות, ספרות ומקף בלבד`);
    if (codes.has(code.toLowerCase())) throw new Error(`הקוד "${code}" מופיע פעמיים ברשימת השגרירים`);
    codes.add(code.toLowerCase());
    const goal = num(a.goal, `היעד של ${name}`);
    const old = prev.find(p => p.code.toLowerCase() === code.toLowerCase()) || prev.find(p => p.name === name);
    return { id: (a.id || (old && old.id)) || newId(), name, code, goal: fromAg(toAg(goal)) };
  });
  const kept = new Set(out.map(a => a.id));
  for (const p of prev) if (!kept.has(p.id) && usedIds.has(p.id)) throw new Error(`לשגריר "${p.name}" יש תרומות משויכות — לא ניתן להסיר אותו מהרשימה`);
  return out;
}

function findAmbassador(c, value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!c || !v) return null;
  const list = c.ambassadors || [];
  return list.find(a => a.id === value) || list.find(a => a.code.toLowerCase() === v) || list.find(a => a.name.trim().toLowerCase() === v) || null;
}
const toAg = (n) => Math.round(Number(n || 0) * 100);
const fromAg = (a) => a / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};
const num = (v, label, { min = 0, max = 1e9 } = {}) => {
  if (v === '' || v === undefined || v === null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} אינו תקין`);
  return n;
};

function validateCampaign(input, { count = 0, fundIds, prev, usedAmbassadorIds, newId } = {}) {
  if (!input || typeof input !== 'object') throw new Error('קמפיין לא תקין');
  if (count >= MAX_CAMPAIGNS) throw new Error('הגעת למספר המקסימלי של קמפיינים');
  const name = str(input.name, 120, 'שם הקמפיין');
  if (!name) throw new Error('שם הקמפיין חובה');
  const goal = num(input.goal, 'יעד הקמפיין', { min: 1 });
  if (!goal) throw new Error('יעד הקמפיין חובה');
  const startDate = str(input.startDate, 10, 'תאריך ההתחלה');
  const endDate = str(input.endDate, 10, 'תאריך הסיום');
  if (!isDate(startDate)) throw new Error('תאריך ההתחלה אינו תקין');
  if (!isDate(endDate)) throw new Error('תאריך הסיום אינו תקין');
  if (endDate < startDate) throw new Error('תאריך הסיום לפני תאריך ההתחלה');
  const matchRatio = num(input.matchRatio, 'יחס ההכפלה', { max: 10 });
  const matchCap = num(input.matchCap, 'תקרת ההכפלה');
  const matchDonor = str(input.matchDonor, 200, 'שם התורם המכפיל');
  if (matchRatio && !matchCap) throw new Error('יש לקבוע תקרה להכפלה (הסכום המרבי שהתורם המכפיל התחייב אליו)');
  const fundId = str(input.fundId, 60, 'הקרן') || 'general';
  if (fundIds && !fundIds.includes(fundId)) throw new Error('הקרן שנבחרה אינה קיימת');
  return {
    name, goal: fromAg(toAg(goal)), startDate, endDate, fundId,
    matchDonor: matchRatio ? matchDonor : '', matchRatio: matchRatio ? Math.round(matchRatio * 100) / 100 : 0, matchCap: matchRatio ? fromAg(toAg(matchCap)) : 0,
    closed: input.closed === true || input.closed === 'true' || input.closed === '1',
    notes: str(input.notes, 500, 'הערות'),
    ambassadors: validateAmbassadors(input.ambassadorsText !== undefined ? parseAmbassadorsText(input.ambassadorsText) : input.ambassadors,
      (prev && prev.ambassadors) || [], usedAmbassadorIds, newId)
  };
}

// האם אפשר לשייך תרומה בתאריך נתון לקמפיין
function assertCanAssign(c, date) {
  if (!c) throw new Error('הקמפיין לא נמצא');
  if (c.closed) throw new Error(`הקמפיין "${c.name}" סגור`);
  if (date < c.startDate || date > c.endDate) throw new Error(`תאריך התרומה מחוץ לתקופת הקמפיין "${c.name}" (${c.startDate} – ${c.endDate})`);
}

function progress(c, donations, today) {
  const rows = (donations || []).filter(d => d.campaignId === c.id && d.status !== 'cancelled');
  const raisedAg = rows.reduce((t, d) => t + toAg(d.amount), 0);
  const matchedAg = c.matchRatio ? Math.min(Math.round(raisedAg * c.matchRatio), toAg(c.matchCap)) : 0;
  const totalAg = raisedAg + matchedAg;
  const donors = new Set(rows.map(d => d.donorId ? 'id:' + d.donorId : 'name:' + String(d.donorName).trim().toLowerCase()));
  const day = (s) => Date.parse(s + 'T00:00:00Z');
  const status = c.closed ? 'closed' : today < c.startDate ? 'upcoming' : today > c.endDate ? 'ended' : 'active';
  const top = new Map();
  for (const d of rows) {
    const k = d.donorId ? 'id:' + d.donorId : 'name:' + String(d.donorName).trim().toLowerCase();
    const cur = top.get(k) || { name: d.donorName, ag: 0 };
    cur.ag += toAg(d.amount);
    top.set(k, cur);
  }
  return {
    ...c, status,
    raised: fromAg(raisedAg), matched: fromAg(matchedAg), total: fromAg(totalAg),
    percent: c.goal ? Math.round((totalAg / toAg(c.goal)) * 1000) / 10 : 0,
    remaining: fromAg(Math.max(0, toAg(c.goal) - totalAg)),
    matchLeft: c.matchRatio ? fromAg(Math.max(0, toAg(c.matchCap) - matchedAg)) : 0,
    donationsCount: rows.length, donorsCount: donors.size,
    daysLeft: status === 'active' ? Math.round((day(c.endDate) - day(today)) / 86400000) : null,
    ambassadorRows: (c.ambassadors || []).map(a => {
      const ag = rows.filter(d => d.ambassadorId === a.id).reduce((t, d) => t + toAg(d.amount), 0);
      return { id: a.id, name: a.name, code: a.code, goal: a.goal, raised: fromAg(ag), count: rows.filter(d => d.ambassadorId === a.id).length,
        percent: a.goal ? Math.round((ag / toAg(a.goal)) * 1000) / 10 : null };
    }).sort((a, b) => b.raised - a.raised),
    topDonors: [...top.values()].sort((a, b) => b.ag - a.ag).slice(0, 5).map(x => ({ name: x.name, amount: fromAg(x.ag) }))
  };
}

const STATUS_ORDER = { active: 0, upcoming: 1, ended: 2, closed: 3 };
function summarize(campaigns, donations, today) {
  return (campaigns || []).map(c => progress(c, donations, today))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.startDate.localeCompare(a.startDate));
}

module.exports = { MAX_AMBASSADORS, parseAmbassadorsText, validateAmbassadors, findAmbassador, MAX_CAMPAIGNS, validateCampaign, assertCanAssign, progress, summarize };
