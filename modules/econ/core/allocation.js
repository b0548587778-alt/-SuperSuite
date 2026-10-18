// חשבוניות ישראל — מספר הקצאה בנתיב הידני (PLAN.md 9.2א), בלי רשת: בעל העסק מבקש את המספר בשירות של
// רשות המסים ל"תוכנה שאינה מחוברת לשירות" ומקליד אותו כאן. מקור הספים: docs/LEGAL-REQUIREMENTS.md, סעיף 1.
// פונקציות טהורות. סכומים באגורות.

// הסף לפי תאריך החשבונית: נדרש מספר כשהסכום לפני מע"מ *גבוה* מהסף (לא שווה לו)
// לפני 2025 — לא בודקים (לא מסמנים חשבוניות ישנות). מקור: דף השירות ב-gov.il
const THRESHOLDS = [
  { from: '2025-01-01', agorot: 2000000 }, // 20,000 ₪
  { from: '2026-01-01', agorot: 1000000 }, // 10,000 ₪
  { from: '2026-06-01', agorot: 500000 }   // 5,000 ₪
];

const STATE_LABELS = {
  'not-required': 'לא נדרש מספר הקצאה',
  pending: 'דרוש מספר הקצאה',
  assigned: 'יש מספר הקצאה',
  waived: 'סומן "לא נדרש"'
};

// מספר נדרש רק כשהלקוח עוסק מורשה ודרש אותו (מסמך ה-API, סעיף 1.2) — את זה התוכנה לא יודעת, ולכן המשתמש מסמן
const WAIVE_REASONS = {
  customer: 'הלקוח אינו עוסק מורשה או לא דרש מספר הקצאה'
};

// השירות של רשות המסים לתוכנה שאינה מחוברת — מוצג כטקסט בלבד, התוכנה לא פונה אליו
const MANUAL_SERVICE_URL = 'https://www.gov.il/he/service/request-assignment-number-for-tax-invoice';

function thresholdFor(date) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : '9999-12-31';
  let t = null;
  for (const x of THRESHOLDS) if (d >= x.from) t = x;
  return t ? t.agorot : Infinity;
}

// האם החשבונית עוברת את תנאי הסכום: יש מע"מ, לא פטורה, והנטו מעל הסף של תאריכה
function overThreshold(inv) {
  if (!inv || inv.vatExempt) return false;
  if (!(Math.round(Number(inv.vat) * 100) > 0)) return false;
  return Math.round(Number(inv.net) * 100) > thresholdFor(inv.date);
}

// מצב ההקצאה לתצוגה: assigned / waived / pending / not-required. חשבונית שבוטלה — לא דורשת טיפול
function allocationState(inv) {
  if (inv && inv.allocationNumber) return 'assigned';
  if (!overThreshold(inv) || (inv && inv.status === 'cancelled')) return 'not-required';
  if (inv && inv.allocationWaived) return 'waived';
  return 'pending';
}

// המספר המלא נשמר כמו שהתקבל; על החשבונית מודפסות 9 הספרות הימניות (מסמך ה-API, סעיף 2.2.1)
function normalizeAllocationNumber(v) {
  const s = String(v ?? '').replace(/[\s-]/g, '');
  if (!/^\d{9,20}$/.test(s)) throw new Error('מספר הקצאה חייב להכיל 9 ספרות לפחות (ספרות בלבד)');
  if (/^0+$/.test(s)) throw new Error('מספר הקצאה אינו תקין');
  return s;
}

const printedDigits = (n) => String(n || '').slice(-9);

// רשימת החשבוניות שממתינות למספר — ללוח הבוקר ולמסך החשבוניות
function pendingList(invoices) {
  return (invoices || []).filter(i => allocationState(i) === 'pending')
    .map(i => ({ id: i.id, number: i.number, customer: i.customer, date: i.date, net: i.net }))
    .sort((a, b) => a.number - b.number);
}

module.exports = { THRESHOLDS, STATE_LABELS, WAIVE_REASONS, MANUAL_SERVICE_URL, thresholdFor, overThreshold, allocationState, normalizeAllocationNumber, printedDigits, pendingList };
