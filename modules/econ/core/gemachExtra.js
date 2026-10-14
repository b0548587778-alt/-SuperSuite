// הרחבות גמ"ח: תהליך בקשת הלוואה, גמ"ח חפצים, ופיגורים לפי ערב. פונקציות טהורות.
// ההלוואה עצמה נוצרת רק באישור בקשה, דרך validateLoanInput הקיים — אותם כללים כמו בהלוואה ישירה.
const G = require('./gemach');
const { assertIsraeliId } = require('./israeliId');

const toAg = (n) => Math.round(Number(n || 0) * 100);
const fromAg = (a) => Math.round(a) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new Error(`${label} ארוך מדי (עד ${max} תווים)`);
  return s;
};

/* ---------- בקשות הלוואה ---------- */
const APP_STATUSES = { draft: 'טיוטה', interview: 'ראיון', verified: 'ערבים אומתו', approved: 'אושרה', rejected: 'נדחתה' };
// מעברים מותרים. אישור — רק אחרי אימות ערבים; דחייה — מכל שלב פתוח
const NEXT = { draft: ['interview', 'rejected'], interview: ['verified', 'draft', 'rejected'], verified: ['approved', 'interview', 'rejected'], approved: [], rejected: [] };
const MAX_APPLICATIONS = 20000;

// הבקשה נבדקת באותם כללים של הלוואה (שם, ת.ז, סכום, תשלומים, ערבים) כבר בשמירה
function validateApplication(input, count = 0) {
  if (count >= MAX_APPLICATIONS) throw new Error('הגעת למספר המקסימלי של בקשות');
  const loan = G.validateLoanInput({ ...input, issueDate: input.issueDate || new Date().toISOString().slice(0, 10) });
  return {
    ...loan,
    requestDate: isDate(input.requestDate) ? input.requestDate : new Date().toISOString().slice(0, 10),
    interviewNotes: str(input.interviewNotes, 2000, 'סיכום הראיון')
  };
}

function assertTransition(app, to) {
  if (!APP_STATUSES[to]) throw new Error('שלב לא מוכר');
  if (!(NEXT[app.status] || []).includes(to)) throw new Error(`לא ניתן לעבור מ"${APP_STATUSES[app.status]}" ל"${APP_STATUSES[to]}"`);
  if (to === 'verified' && !(app.guarantors || []).length) throw new Error('אין ערבים בבקשה — יש להוסיף ערבים לפני האימות');
}

/* ---------- גמ"ח חפצים ---------- */
const CONDITIONS = { new: 'חדש', good: 'תקין', worn: 'משומש', repair: 'בתיקון', retired: 'יצא משימוש' };
const MAX_ITEMS = 5000;
const MAX_LENDINGS = 50000;

function validateItem(input, count = 0) {
  if (count >= MAX_ITEMS) throw new Error('הגעת למספר המקסימלי של פריטים');
  const name = str(input.name, 120, 'שם הפריט');
  if (!name) throw new Error('שם הפריט חובה');
  const deposit = input.deposit === '' || input.deposit === undefined ? 0 : Number(input.deposit);
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > 1e6) throw new Error('סכום הפיקדון אינו תקין');
  return {
    name, category: str(input.category, 80, 'הקטגוריה'), code: str(input.code, 30, 'המק"ט'),
    condition: CONDITIONS[input.condition] ? input.condition : 'good',
    deposit: fromAg(toAg(deposit)), location: str(input.location, 120, 'המיקום'), notes: str(input.notes, 500, 'הערות')
  };
}

const openLending = (lendings, itemId) => (lendings || []).find(l => l.itemId === itemId && !l.returnedAt);

function validateLending(input, item, lendings, count = 0) {
  if (count >= MAX_LENDINGS) throw new Error('הגעת למספר המקסימלי של השאלות');
  if (!item) throw new Error('הפריט לא נמצא');
  if (item.condition === 'retired' || item.condition === 'repair') throw new Error(`הפריט "${item.name}" ${CONDITIONS[item.condition]} — לא ניתן להשאיל`);
  if (openLending(lendings, item.id)) throw new Error(`הפריט "${item.name}" כבר מושאל`);
  const borrowerName = str(input.borrowerName, 200, 'שם השואל');
  if (!borrowerName) throw new Error('שם השואל חובה');
  const borrowerId = str(input.borrowerId, 12, 'ת.ז של השואל');
  assertIsraeliId(borrowerId, 'ת.ז של השואל');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error('תאריך ההשאלה אינו תקין');
  const dueDate = str(input.dueDate, 10, 'תאריך ההחזרה');
  if (dueDate && (!isDate(dueDate) || dueDate < date)) throw new Error('תאריך ההחזרה אינו תקין או לפני תאריך ההשאלה');
  const depositHeld = input.depositHeld === '' || input.depositHeld === undefined ? item.deposit : Number(input.depositHeld);
  if (!Number.isFinite(depositHeld) || depositHeld < 0) throw new Error('סכום הפיקדון אינו תקין');
  return {
    itemId: item.id, borrowerName, borrowerId, borrowerPhone: str(input.borrowerPhone, 30, 'טלפון'),
    date, dueDate, depositHeld: fromAg(toAg(depositHeld)), notes: str(input.notes, 500, 'הערות'),
    returnedAt: '', returnCondition: '', depositReturned: 0
  };
}

// החזרה: הפיקדון מוחזר במלואו או בחלקו (ניכוי על נזק), ומצב הפריט מתעדכן
function applyReturn(lending, input) {
  if (lending.returnedAt) throw new Error('הפריט כבר הוחזר');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date) || date < lending.date) throw new Error('תאריך ההחזרה אינו תקין');
  const condition = CONDITIONS[input.condition] ? input.condition : 'good';
  const back = input.depositReturned === '' || input.depositReturned === undefined ? lending.depositHeld : Number(input.depositReturned);
  if (!Number.isFinite(back) || back < 0 || toAg(back) > toAg(lending.depositHeld)) throw new Error('הפיקדון המוחזר אינו יכול לעלות על הפיקדון שהתקבל');
  return { ...lending, returnedAt: date, returnCondition: condition, depositReturned: fromAg(toAg(back)), returnNotes: str(input.notes, 500, 'הערות') };
}

function itemsOverview(items, lendings, today) {
  const rows = (items || []).map(it => {
    const open = openLending(lendings, it.id);
    return {
      ...it, conditionLabel: CONDITIONS[it.condition] || it.condition,
      lending: open || null,
      overdue: !!(open && open.dueDate && open.dueDate < today),
      timesLent: (lendings || []).filter(l => l.itemId === it.id).length
    };
  }).sort((a, b) => (b.overdue - a.overdue) || (!!b.lending - !!a.lending) || a.name.localeCompare(b.name, 'he'));
  const open = (lendings || []).filter(l => !l.returnedAt);
  return {
    rows,
    lentCount: open.length,
    overdueCount: rows.filter(r => r.overdue).length,
    depositsHeld: fromAg(open.reduce((t, l) => t + toAg(l.depositHeld), 0))
  };
}

/* ---------- פיגורים לפי ערב ---------- */
// לכל ערב: ההלוואות בפיגור שהוא ערב להן — כדי לפנות אליו. ערב מזוהה לפי ת.ז, ובלי ת.ז לפי שם וטלפון
function arrearsByGuarantor(loans, asOf) {
  const map = new Map();
  for (const l of loans || []) {
    if (l.status !== 'active') continue;
    const late = G.arrears(l, asOf);
    if (!late.length) continue;
    const lateAg = late.reduce((t, s) => t + (s.amountAg - s.paidAg), 0);
    const oldest = late.map(s => s.dueDate).sort()[0];
    for (const g of l.guarantors || []) {
      const key = g.id ? 'id:' + g.id.padStart(9, '0') : 'n:' + g.name.trim().toLowerCase() + '|' + (g.phone || '');
      if (!map.has(key)) map.set(key, { name: g.name, id: g.id || '', phone: g.phone || '', loans: [], lateAg: 0 });
      const e = map.get(key);
      if (!e.phone && g.phone) e.phone = g.phone;
      e.loans.push({ loanId: l.id, borrowerName: l.borrowerName, borrowerPhone: l.borrowerPhone || '', lateCount: late.length, lateAmount: fromAg(lateAg), oldestDue: oldest });
      e.lateAg += lateAg;
    }
  }
  return [...map.values()].map(e => ({ name: e.name, id: e.id, phone: e.phone, loans: e.loans, lateAmount: fromAg(e.lateAg) }))
    .sort((a, b) => b.lateAmount - a.lateAmount || a.name.localeCompare(b.name, 'he'));
}

function exportExtra(kind, gemach, asOf) {
  if (kind === 'guarantor-arrears') {
    const rows = arrearsByGuarantor(gemach.loans, asOf).flatMap(g => g.loans.map(l => [g.name, g.id, g.phone, l.borrowerName, l.borrowerPhone, l.lateCount, l.lateAmount, l.oldestDue]));
    return { name: 'פיגורים-לפי-ערב', headers: ['ערב', 'ת.ז ערב', 'טלפון ערב', 'לווה', 'טלפון לווה', 'תשלומים בפיגור', 'סכום בפיגור', 'הפיגור הוותיק'], rows };
  }
  if (kind === 'items') {
    const ov = itemsOverview(gemach.items, gemach.lendings, asOf);
    const rows = ov.rows.map(r => [r.name, r.category, r.code, r.conditionLabel, r.deposit, r.lending ? r.lending.borrowerName : '', r.lending ? r.lending.borrowerPhone : '', r.lending ? r.lending.dueDate : '', r.overdue ? 'כן' : '', r.location]);
    return { name: 'גמח-חפצים', headers: ['פריט', 'קטגוריה', 'מק"ט', 'מצב', 'פיקדון', 'מושאל ל', 'טלפון', 'להחזרה עד', 'באיחור', 'מיקום'], rows };
  }
  return null;
}

module.exports = {
  APP_STATUSES, CONDITIONS, MAX_APPLICATIONS, MAX_ITEMS, MAX_LENDINGS,
  validateApplication, assertTransition, validateItem, validateLending, applyReturn, openLending, itemsOverview,
  arrearsByGuarantor, exportExtra
};
